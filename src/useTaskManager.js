import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  parseTodoTxt, sortedTxt, advanceDate, getToday,
  effectivePriority, dueSortKey,
} from "./todotxt.js";
import {
  loadTokens, saveTokens, getAccessToken, exchangeCode,
  dbxDownload, dbxUpload, dbxGetCursor, dbxLongpoll,
} from "./dropbox.js";

// Module-level TODAY — refreshed at midnight and on tab visibility change.
// Passed explicitly to effectivePriority(task, TODAY) and dueSortKey(task, TODAY).
let TODAY = new Date().toISOString().split("T")[0];

const SINK_CONTEXTS = new Set(["delegated", "waiting"]);

// ─── Sample data ──────────────────────────────────────────────────────────────

const tomorrow = advanceDate(TODAY, "1d");
const in2  = advanceDate(TODAY, "2d");
const in4  = advanceDate(TODAY, "4d");
const in6  = advanceDate(TODAY, "6d");
const in10 = advanceDate(TODAY, "10d");
const in14 = advanceDate(TODAY, "14d");

const SAMPLE = [
  `(A) Call dentist to schedule appointment due:${TODAY} +Health @phone`,
  `(A) Finish Q1 budget report due:${TODAY} +Work @computer`,
  `(B) Review team pull requests +Work @computer`,
  `(B) Order birthday gift for Sarah due:${in4} +Personal @online`,
  `(C) Clean out garage +Home @home`,
  `(R) Weekly team standup due:${TODAY} rec:1w +Work @computer`,
  `(R) Pay credit card due:${tomorrow} rec:1m +Finance @computer`,
  `(R) Take out trash due:${in2} rec:1w +Home @home`,
  `(R) Daily journal due:${TODAY} rec:1d +Personal @home`,
  `(A) Prepare slide deck for Monday meeting due:${in2} +Work @computer`,
  `(C) Read chapter 4 of Deep Work +Personal @home`,
  `(B) Schedule oil change due:${in6} +Home @phone`,
  `(B) Prepare quarterly review t:${in4} due:${in14} +Work @computer`,
  `(C) Research vacation destinations t:${in10} due:${in14} +Personal`,
];

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaskManager() {
  const hasDropbox = !!loadTokens();

  // ── Task state ──────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState(() =>
    hasDropbox ? null : SAMPLE.map((raw, i) => parseTodoTxt(raw, i + 1))
  );

  const nextId = useRef(
    Math.max(0, ...(hasDropbox ? [] : SAMPLE.map((_, i) => i + 1))) + 1
  );

  // ── UI state ────────────────────────────────────────────────────────────────
  const [editingId,     setEditingId]     = useState(null);
  const [addingFor,     setAddingFor]     = useState(null);
  const [form,          setForm]          = useState({
    text:"", due:"", threshold:"", project:"", context:"", rec:"", priority:"C", inProgress:false,
  });

  // ── Sync / file state ───────────────────────────────────────────────────────
  const [dbxConnected,  setDbxConnected]  = useState(!!loadTokens());
  const [dbxStatus,     setDbxStatus]     = useState(null);
  const [fileHandle,    setFileHandle]    = useState(null);
  const [saveMsg,       setSaveMsg]       = useState(null);

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragId,        setDragId]        = useState(null);
  const [dragOverId,    setDragOverId]    = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);
  const [reschedulePrompt, setReschedulePrompt] = useState(null);
  const [rescheduleDate,   setRescheduleDate]   = useState("");
  const touchDrag = useRef({ id: null, startY: 0, lastOverId: null, lastOverGroup: null });

  // ── Undo state ──────────────────────────────────────────────────────────────
  const [undoStack, setUndoStack] = useState([]);
  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);

  // ── Planning mode state ─────────────────────────────────────────────────────
  const [planningMode,    setPlanningMode]    = useState(false);
  const [planStep,        setPlanStep]        = useState(0);
  const [planRolloverIds, setPlanRolloverIds] = useState([]);

  // ── Keep TODAY in sync across midnight and tab focus ────────────────────────
  useEffect(() => {
    function refresh() { TODAY = getToday(); }
    function scheduleMidnight() {
      const now = new Date();
      const msUntilMidnight =
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
      return setTimeout(() => { refresh(); scheduleMidnight(); }, msUntilMidnight + 100);
    }
    const t = scheduleMidnight();
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  // ── Poll pause: suspend longpoll while editing ───────────────────────────────
  const isEditing = editingId !== null || addingFor !== null;
  const isEditingRef = useRef(isEditing);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  // ── App badge ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const count = (tasks||[]).filter(t => {
      if (t.done) return false;
      if (t.thresholdDate && t.thresholdDate > TODAY) return false;
      if (t.priority === "R") {
        const ep = effectivePriority(t, TODAY);
        return ep === "A" || ep === "B";
      }
      if (!t.dueDate) return false;
      return t.dueDate <= TODAY;
    }).length;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [tasks]);

  // ── Dropbox OAuth callback ───────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;
    window.history.replaceState({}, "", window.location.pathname);
    exchangeCode(code).then(tokens => {
      saveTokens({ access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in || 14400) * 1000 });
      setDbxConnected(true);
      loadFromDropbox();
    }).catch(e => { setDbxStatus("error"); console.error("Dropbox auth error:", e); });
  }, []);

  useEffect(() => { if (dbxConnected) loadFromDropbox(); }, [dbxConnected]);

  async function loadFromDropbox() {
    setDbxStatus("loading");
    try {
      const token = await getAccessToken();
      if (!token) { setDbxConnected(false); setDbxStatus(null); return; }
      const text = await dbxDownload(token);
      const parsed = text.split("\n").filter(l => l.trim()).map((raw, i) => parseTodoTxt(raw, i + 1));
      setTasks(parsed);
      nextId.current = Math.max(0, ...parsed.map(t => t.id)) + 1;
      setDbxStatus("saved");
      flash("✓ Loaded from Dropbox");
    } catch(e) {
      setDbxStatus("error"); flash("⚠ Dropbox load failed"); console.error(e);
    }
  }

  const saveToDropbox = useCallback(async (taskList) => {
    const token = await getAccessToken();
    if (!token) return;
    setDbxStatus("saving");
    try {
      await dbxUpload(token, sortedTxt(taskList));
      lastSavedAt.current = Date.now();
      try {
        const freshToken = await getAccessToken();
        if (freshToken) pollCursor.current = await dbxGetCursor(freshToken);
      } catch {}
      setDbxStatus("saved");
    } catch(e) { setDbxStatus("error"); console.error("Dropbox save error:", e); }
  }, []);

  const saveTimer   = useRef(null);
  const lastSavedAt = useRef(0);
  const pollCursor  = useRef(null);

  useEffect(() => {
    if (!dbxConnected || tasks === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToDropbox(tasks), 1500);
    return () => clearTimeout(saveTimer.current);
  }, [tasks, dbxConnected]);

  // ── Dropbox longpoll ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dbxConnected) return;
    let cancelled = false;

    async function poll() {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        if (!pollCursor.current) {
          pollCursor.current = await dbxGetCursor(token);
        }
        while (!cancelled) {
          if (isEditingRef.current) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          const cursor = pollCursor.current;
          const result = await dbxLongpoll(cursor);
          if (cancelled) break;
          if (result.backoff) await new Promise(r => setTimeout(r, result.backoff * 1000));
          if (result.changes) {
            const msSinceSave = Date.now() - lastSavedAt.current;
            if (msSinceSave > 10000 && !isEditingRef.current) {
              await loadFromDropbox();
            }
            try {
              const t = await getAccessToken();
              if (t) pollCursor.current = await dbxGetCursor(t);
            } catch {}
          }
        }
      } catch (e) {
        if (!cancelled) console.warn("Dropbox poll error:", e);
      }
    }
    poll();
    return () => { cancelled = true; pollCursor.current = null; };
  }, [dbxConnected]);

  // ── File I/O ─────────────────────────────────────────────────────────────────
  async function openFile() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description:"todo.txt / todo.todotxt", accept:{ "text/plain":[".txt",".todotxt"] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = text.split("\n").filter(l => l.trim()).map((raw, i) => parseTodoTxt(raw, i + 1));
      setTasks(parsed); nextId.current = Math.max(0, ...parsed.map(t => t.id)) + 1;
      setFileHandle(handle); flash("✓ Loaded");
    } catch (e) { if (e.name !== "AbortError") alert("Could not open: " + e.message); }
  }

  async function saveFile() {
    if (!tasks) return;
    const txt = sortedTxt(tasks);
    if (fileHandle) {
      try { const w = await fileHandle.createWritable(); await w.write(txt); await w.close(); flash("✓ Saved"); }
      catch (e) { alert("Save failed: " + e.message); }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type:"text/plain" }));
      a.download = "todo.todotxt"; a.click();
    }
  }

  function disconnectDropbox() {
    localStorage.removeItem("dbx_tokens");
    setDbxConnected(false);
    setDbxStatus(null);
  }

  // ── Flash messages ────────────────────────────────────────────────────────────
  function flash(msg) { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), 2500); }

  // ── Undo ─────────────────────────────────────────────────────────────────────
  function pushUndo(prevTasks, msg) {
    setUndoStack(s => [...s.slice(-9), { tasks: prevTasks, msg }]);
    clearTimeout(undoTimerRef.current);
    const key = Date.now();
    setUndoToast({ msg, key });
    undoTimerRef.current = setTimeout(() => setUndoToast(t => t?.key === key ? null : t), 5000);
  }

  function doUndo() {
    setUndoStack(s => {
      if (!s.length) return s;
      const last = s[s.length - 1];
      setTasks(last.tasks);
      setUndoToast(null);
      clearTimeout(undoTimerRef.current);
      return s.slice(0, -1);
    });
  }

  // ── Task mutations ────────────────────────────────────────────────────────────
  function toggleDone(id) {
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (!task) return prev;
      pushUndo(prev, task.done ? `Reopened: ${task.cleanText}` : `Completed: ${task.cleanText}`);
      if (!task.done && task.recurrence) {
        const nid = nextId.current++;
        const nextDue = advanceDate(task.dueDate || TODAY, task.recurrence);
        const next = { ...task, id: nid, done: false, completedDate: null, dueDate: nextDue };
        return prev.map(t => t.id === id ? { ...t, done: true, completedDate: TODAY } : t).concat(next);
      }
      return prev.map(t => t.id === id
        ? { ...t, done: !t.done, completedDate: !t.done ? TODAY : null }
        : t);
    });
  }

  function deleteTask(id) {
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (task) pushUndo(prev, `Deleted: ${task.cleanText}`);
      return prev.filter(t => t.id !== id);
    });
  }

  function toggleInProgress(id) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, inProgress: !t.inProgress } : t));
  }

  function saveEdit(id, raw) {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const parsed = parseTodoTxt(raw, id);
      return { ...parsed, done: t.done, completedDate: t.completedDate };
    }));
    setEditingId(null);
  }

  function addTask(priority) {
    if (!form.text.trim()) return;
    const id = nextId.current++;
    const hasRec = !!form.rec.trim();
    const basePriority = form.priority && form.priority !== "?" ? form.priority : (priority === "?" ? "C" : priority);
    const assignedPriority = hasRec ? "R" : basePriority;
    const parts = [`(${assignedPriority})`, form.text.trim()];
    if (form.project.trim()) parts.push(`+${form.project.trim()}`);
    if (form.context.trim()) parts.push(`@${form.context.trim()}`);
    if (form.due)            parts.push(`due:${form.due}`);
    if (form.threshold)      parts.push(`t:${form.threshold}`);
    if (form.rec.trim())     parts.push(`rec:${form.rec.trim()}`);
    if (form.inProgress)     parts.push(`status:inprogress`);
    setTasks(prev => {
      const maxSeq = prev.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
      const parsed = parseTodoTxt(parts.join(" "), id);
      return [...prev, { ...parsed, seq: maxSeq + 1 }];
    });
    setForm({ text:"", due:"", threshold:"", project:"", context:"", rec:"", priority:"C", inProgress:false });
    setAddingFor(null);
  }

  function addSomedayTask() {
    if (!form.text.trim()) return;
    const id = nextId.current++;
    const parts = ["(C)", form.text.trim()];
    if (form.project.trim()) parts.push(`+${form.project.trim()}`);
    if (form.context.trim()) parts.push(`@${form.context.trim()}`);
    setTasks(prev => {
      const maxSeq = prev.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
      const parsed = parseTodoTxt(parts.join(" "), id);
      return [...prev, { ...parsed, seq: maxSeq + 1 }];
    });
    setForm({ text:"", due:"", threshold:"", project:"", context:"", rec:"", priority:"C", inProgress:false });
    setAddingFor(null);
  }

  function changePriority(id, newPriority) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: newPriority || null } : t));
  }

  function promoteToDaily(id) {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, dueDate: TODAY, priority: t.priority || "C" } : t
    ));
    flash("✓ Moved to today's list");
  }

  function makeVisible(id) {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, thresholdDate: null } : t
    ));
    flash("✓ Task is now visible in daily view");
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────
  function resequence(arr) {
    return arr.map((t, i) => ({ ...t, seq: i + 1 }));
  }

  function handleTouchDragStart(taskId, e) {
    touchDrag.current = { id: taskId, startY: e.touches[0].clientY, lastOverId: null, lastOverGroup: null };
    setDragId(taskId);
  }

  function handleTouchDragMove(e) {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    let node = el;
    let foundTaskId = null, foundGroup = null;
    while (node && node !== document.body) {
      if (node.dataset?.taskid) { foundTaskId = parseInt(node.dataset.taskid); break; }
      if (node.dataset?.group)  { foundGroup  = node.dataset.group;            break; }
      node = node.parentElement;
    }
    if (foundTaskId && foundTaskId !== touchDrag.current.id) {
      if (touchDrag.current.lastOverId !== foundTaskId) {
        touchDrag.current.lastOverId = foundTaskId;
        touchDrag.current.lastOverGroup = null;
        setDragOverId(foundTaskId);
        setDragOverGroup(null);
      }
    } else if (foundGroup) {
      if (touchDrag.current.lastOverGroup !== foundGroup) {
        touchDrag.current.lastOverGroup = foundGroup;
        touchDrag.current.lastOverId = null;
        setDragOverGroup(foundGroup);
        setDragOverId(null);
      }
    }
  }

  function handleTouchDragEnd() {
    const { id, lastOverId, lastOverGroup } = touchDrag.current;
    touchDrag.current = { id: null, startY: 0, lastOverId: null, lastOverGroup: null };
    if (!id) { setDragId(null); setDragOverId(null); setDragOverGroup(null); return; }
    if (lastOverId) {
      onDrop(lastOverId);
    } else if (lastOverGroup) {
      onDropGroup(lastOverGroup);
    } else {
      setDragId(null); setDragOverId(null); setDragOverGroup(null);
    }
  }

  function applyReprioritize(dragged, newPriority, insertBeforeId) {
    if (dragged.priority === "R") {
      setReschedulePrompt({ id: dragged.id, newPriority, insertBeforeId });
      setRescheduleDate(dragged.dueDate || TODAY);
    } else {
      setTasks(prev => {
        let arr = prev.map(t => t.id === dragged.id ? { ...t, priority: newPriority === "?" ? null : newPriority } : t);
        if (insertBeforeId) {
          const fi = arr.findIndex(t => t.id === dragged.id);
          const ti = arr.findIndex(t => t.id === insertBeforeId);
          const [moved] = arr.splice(fi, 1); arr.splice(ti, 0, moved);
        }
        return resequence(arr);
      });
    }
  }

  function onDrop(targetId) {
    if (!tasks || !dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const dragged = tasks.find(t => t.id === dragId);
    const target  = tasks.find(t => t.id === targetId);
    if (!dragged || !target) { setDragId(null); setDragOverId(null); return; }
    const draggedEP = effectivePriority(dragged, TODAY) || dragged.priority || "?";
    const targetEP  = effectivePriority(target, TODAY)  || target.priority  || "?";
    if (draggedEP !== targetEP) {
      applyReprioritize(dragged, targetEP, targetId);
    } else {
      setTasks(prev => {
        const arr = [...prev];
        const fi = arr.findIndex(t => t.id === dragId);
        const ti = arr.findIndex(t => t.id === targetId);
        const [moved] = arr.splice(fi, 1); arr.splice(ti, 0, moved);
        return resequence(arr);
      });
    }
    setDragId(null); setDragOverId(null);
  }

  function onDropGroup(targetPriority) {
    if (!tasks || !dragId) { setDragOverGroup(null); return; }
    const dragged = tasks.find(t => t.id === dragId);
    if (!dragged) { setDragId(null); setDragOverGroup(null); return; }
    const draggedEP = effectivePriority(dragged, TODAY) || dragged.priority || "?";
    if (draggedEP !== targetPriority) applyReprioritize(dragged, targetPriority, null);
    setDragId(null); setDragOverGroup(null);
  }

  function confirmReschedule() {
    if (!reschedulePrompt || !rescheduleDate) return;
    const { id, insertBeforeId } = reschedulePrompt;
    setTasks(prev => {
      let arr = prev.map(t => t.id === id ? { ...t, dueDate: rescheduleDate } : t);
      if (insertBeforeId) {
        const fi = arr.findIndex(t => t.id === id);
        const ti = arr.findIndex(t => t.id === insertBeforeId);
        const [moved] = arr.splice(fi, 1); arr.splice(ti, 0, moved);
      }
      return resequence(arr);
    });
    setReschedulePrompt(null); setRescheduleDate("");
  }

  // ── Planning mode ─────────────────────────────────────────────────────────────
  function startPlanningMode() {
    const overdue = (tasks||[]).filter(t =>
      !t.done && t.dueDate && t.dueDate < TODAY && t.priority !== "R"
    );
    setPlanRolloverIds(overdue.map(t => t.id));
    setPlanStep(0);
    setPlanningMode(true);
  }

  function planRolloverTask(id, action) {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      if (action === "drop")  return { ...t, done: true, completedDate: TODAY };
      if (action === "defer") return { ...t, dueDate: advanceDate(TODAY, "1d") };
      return { ...t, dueDate: TODAY };
    }));
    setPlanRolloverIds(ids => ids.filter(i => i !== id));
  }

  function advancePlanStep() {
    setPlanStep(s => {
      if (s >= 2) { setPlanningMode(false); return 0; }
      return s + 1;
    });
  }

  // ── Derived views ─────────────────────────────────────────────────────────────
  const allCtx  = useMemo(() => [...new Set((tasks||[]).flatMap(t => t.contexts))].sort(), [tasks]);
  const allProj = useMemo(() => [...new Set((tasks||[]).flatMap(t => t.projects))].sort(), [tasks]);

  function matchesSearch(task, q) {
    if (!q) return true;
    if (task.cleanText.toLowerCase().includes(q)) return true;
    if (task.projects.some(p => p.toLowerCase().includes(q))) return true;
    if (task.contexts.some(c => c.toLowerCase().includes(q))) return true;
    if (task.dueDate && task.dueDate.includes(q)) return true;
    return false;
  }

  function getFilteredViews({ searchQuery, showDone, filterCtx, filterProj }) {
    const q = searchQuery.trim().toLowerCase();

    const somedayTasks = (tasks||[]).filter(t =>
      !t.done && !t.dueDate && !t.recurrence &&
      (t.priority === "C" || t.priority === null) &&
      matchesSearch(t, q)
    );

    const upcomingTasks = (tasks||[]).filter(t =>
      !t.done && t.thresholdDate && t.thresholdDate > TODAY && matchesSearch(t, q)
    ).sort((a, b) => {
      if (a.thresholdDate !== b.thresholdDate) return a.thresholdDate.localeCompare(b.thresholdDate);
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });

    function isVisibleToday(task) {
      if (task.done && !showDone) return false;
      if (filterCtx  && !task.contexts.includes(filterCtx))  return false;
      if (filterProj && !task.projects.includes(filterProj)) return false;
      if (!matchesSearch(task, q)) return false;
      if (task.thresholdDate && task.thresholdDate > TODAY)  return false;
      if (task.priority === "R" && !task.done) {
        const ep = effectivePriority(task, TODAY);
        return ep === "A" || ep === "B";
      }
      return true;
    }

    const todayVisible  = (tasks||[]).filter(isVisibleToday);
    const visibleActive = todayVisible.filter(t => !t.done);
    const doneTasks     = todayVisible.filter(t =>  t.done);

    const groups = { A:[], B:[], C:[], "?":[] };
    visibleActive.forEach(t => {
      const ep = effectivePriority(t, TODAY);
      const k = ep && ["A","B","C"].includes(ep) ? ep
              : (t.priority && ["A","B","C"].includes(t.priority) ? t.priority : "?");
      groups[k].push(t);
    });
    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => {
        const aDel = a.contexts.some(c => SINK_CONTEXTS.has(c)) ? 1 : 0;
        const bDel = b.contexts.some(c => SINK_CONTEXTS.has(c)) ? 1 : 0;
        if (aDel !== bDel) return aDel - bDel;
        const ka = dueSortKey(a, TODAY), kb = dueSortKey(b, TODAY);
        if (ka !== kb) return ka - kb;
        if (ka === 2) return a.dueDate.localeCompare(b.dueDate);
        const as = a.seq ?? 99999, bs = b.seq ?? 99999;
        return as - bs;
      });
    });

    const orderedTasks = ["A","B","C","?"].flatMap(k => groups[k]);

    function dayTasks(date) {
      return (tasks||[]).filter(t => {
        if (t.done) return false;
        if (t.priority === "R" && t.dueDate && t.dueDate > date) return false;
        if (t.dueDate === date) return true;
        if (date === TODAY && t.dueDate && t.dueDate < TODAY) return true;
        return false;
      });
    }

    return { somedayTasks, upcomingTasks, visibleActive, doneTasks, groups, orderedTasks, dayTasks };
  }

  return {
    // Raw state
    tasks,
    TODAY: () => TODAY,

    // UI state
    editingId, setEditingId,
    addingFor, setAddingFor,
    form, setForm,

    // Sync/file state
    dbxConnected, dbxStatus,
    fileHandle,
    saveMsg,
    isEditing,

    // Drag state
    dragId, setDragId,
    dragOverId, setDragOverId,
    dragOverGroup, setDragOverGroup,
    reschedulePrompt, setReschedulePrompt,
    rescheduleDate, setRescheduleDate,

    // Undo state
    undoToast, setUndoToast,

    // Planning state
    planningMode, setPlanningMode,
    planStep, setPlanStep,
    planRolloverIds,

    // Derived
    allCtx, allProj,
    getFilteredViews,

    // Actions
    toggleDone, deleteTask, toggleInProgress, saveEdit,
    addTask, addSomedayTask, changePriority,
    promoteToDaily, makeVisible,
    openFile, saveFile, disconnectDropbox,
    doUndo,
    handleTouchDragStart, handleTouchDragMove, handleTouchDragEnd,
    onDrop, onDropGroup, confirmReschedule,
    startPlanningMode, planRolloverTask, advancePlanStep,
  };
}
