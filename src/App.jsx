import { useState, useRef } from "react";

// ─── todo.txt parser ──────────────────────────────────────────────────────────

function parseRecurrence(raw) {
  const m = raw.match(/rec:(\d+)(d|w|m|y|wd)|rec:(daily|weekly|monthly|yearly|weekday)/i);
  if (!m) return null;
  if (m[3]) {
    const map = { daily:"1d", weekly:"1w", monthly:"1m", yearly:"1y", weekday:"1wd" };
    return map[m[3].toLowerCase()];
  }
  return `${m[1]}${m[2]}`;
}

function parseTodoTxt(raw, id) {
  let text = raw.trim();
  const done = text.startsWith("x ");
  if (done) text = text.slice(2).trim();

  let completedDate = null;
  const cdM = done && text.match(/^(\d{4}-\d{2}-\d{2})\s/);
  if (cdM) { completedDate = cdM[1]; text = text.slice(11); }

  let priority = null;
  const prM = text.match(/^\(([A-Z])\)\s/);
  if (prM) { priority = prM[1]; text = text.slice(4); }

  const crM = text.match(/^(\d{4}-\d{2}-\d{2})\s/);
  if (crM) text = text.slice(11);

  const dueM = raw.match(/due:(\d{4}-\d{2}-\d{2})/);
  const dueDate = dueM ? dueM[1] : null;
  const recurrence = parseRecurrence(raw);
  const projects = [...raw.matchAll(/\+(\S+)/g)].map(m => m[1]);
  const contexts = [...raw.matchAll(/@(\S+)/g)].map(m => m[1]);

  const cleanText = text
    .replace(/due:\d{4}-\d{2}-\d{2}/g, "")
    .replace(/rec:\S+/g, "")
    .replace(/\+\S+/g, "")
    .replace(/@\S+/g, "")
    .replace(/\s+/g, " ").trim();

  return { id, priority, cleanText, dueDate, recurrence, projects, contexts, done, completedDate };
}

function taskToTxt(task) {
  let line = task.done ? `x ${new Date().toISOString().split("T")[0]} ` : "";
  // Always write the stored priority — R tasks stay (R) in the file
  if (task.priority) line += `(${task.priority}) `;
  line += task.cleanText;
  if (task.projects.length) line += " " + task.projects.map(p => `+${p}`).join(" ");
  if (task.contexts.length) line += " " + task.contexts.map(c => `@${c}`).join(" ");
  if (task.dueDate) line += ` due:${task.dueDate}`;
  if (task.recurrence) line += ` rec:${task.recurrence}`;
  return line;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().split("T")[0];

function advanceDate(from, rec) {
  const d = new Date(from + "T12:00:00");
  const m = rec.match(/^(\d+)(d|w|m|y|wd)$/);
  if (!m) return from;
  const n = parseInt(m[1]), u = m[2];
  if (u === "d") d.setDate(d.getDate() + n);
  else if (u === "w") d.setDate(d.getDate() + n * 7);
  else if (u === "m") d.setMonth(d.getMonth() + n);
  else if (u === "y") d.setFullYear(d.getFullYear() + n);
  else if (u === "wd") {
    let a = 0;
    while (a < n) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) a++; }
  }
  return d.toISOString().split("T")[0];
}

function weekDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

function fmtWeekday(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

function fmtDayNum(iso) {
  return parseInt(iso.split("-")[2]);
}

// ─── Effective priority for recurring tasks ───────────────────────────────────
// R tasks are promoted at display time only. The file always stores (R).
//   due today or overdue → promoted to A
//   due tomorrow         → promoted to B
//   further out          → hidden from daily view

function effectivePriority(task) {
  if (task.priority !== "R") return task.priority;
  if (!task.dueDate) return "R"; // no due date, stay in R bucket
  const tomorrow = advanceDate(TODAY, "1d");
  if (task.dueDate <= TODAY) return "A";
  if (task.dueDate === tomorrow) return "B";
  return null; // not yet visible
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const tomorrow = advanceDate(TODAY, "1d");
const in2 = advanceDate(TODAY, "2d");
const in4 = advanceDate(TODAY, "4d");
const in6 = advanceDate(TODAY, "6d");

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
];

// ─── Priority metadata ────────────────────────────────────────────────────────

const PMETA = {
  A: { label: "A — Vital",      accent: "#b33020", bg: "#fdf0ee", border: "#ddb5b0", dot: "#b33020" },
  B: { label: "B — Important",  accent: "#b07010", bg: "#fdf6ed", border: "#ddc898", dot: "#b07010" },
  C: { label: "C — Nice to Do", accent: "#2a7048", bg: "#eef7f2", border: "#9ecfb5", dot: "#2a7048" },
  R: { label: "R — Recurring",  accent: "#3558b0", bg: "#eef2fb", border: "#9db5e0", dot: "#3558b0" },
  "?": { label: "Unsorted",     accent: "#888",    bg: "#f5f4f0", border: "#d8d5ce", dot: "#888"    },
};

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tasks, setTasks] = useState(() =>
    SAMPLE.map((raw, i) => parseTodoTxt(raw, i + 1))
  );
  const [view, setView] = useState("daily");
  const [showDone, setShowDone] = useState(false);
  const [filterCtx, setFilterCtx] = useState(null);
  const [filterProj, setFilterProj] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [addingFor, setAddingFor] = useState(null);
  const [form, setForm] = useState({ text:"", due:"", project:"", context:"", rec:"" });
  const [showExport, setShowExport] = useState(false);
  const [fileHandle, setFileHandle] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);
  // reschedule prompt: { id, newPriority } — shown when dragging a recurring task cross-group
  const [reschedulePrompt, setReschedulePrompt] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const nextId = useRef(500);

  const allCtx = [...new Set(tasks.flatMap(t => t.contexts))].sort();
  const allProj = [...new Set(tasks.flatMap(t => t.projects))].sort();

  // ── File I/O ───────────────────────────────────────────────────────────────

  async function openFile() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "todo.txt / todo.todotxt", accept: { "text/plain": [".txt", ".todotxt"] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = text.split("\n").filter(l => l.trim())
        .map((raw, i) => parseTodoTxt(raw, i + 1));
      setTasks(parsed);
      nextId.current = parsed.length + 100;
      setFileHandle(handle);
      setFileName(file.name);
      flash("✓ Loaded");
    } catch (e) { if (e.name !== "AbortError") alert("Could not open: " + e.message); }
  }

  async function saveFile() {
    const txt = tasks.map(taskToTxt).join("\n") + "\n";
    if (fileHandle) {
      try {
        const w = await fileHandle.createWritable();
        await w.write(txt); await w.close();
        flash("✓ Saved");
      } catch (e) { alert("Save failed: " + e.message); }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
      a.download = "todo.txt"; a.click();
    }
  }

  function flash(msg) { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), 2500); }

  // ── Mutations ──────────────────────────────────────────────────────────────

  function toggleDone(id) {
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (!task) return prev;
      if (!task.done && task.recurrence) {
        const nid = nextId.current++;
        const base = task.dueDate || TODAY;
        const nextDue = advanceDate(base, task.recurrence);
        const next = { ...task, id: nid, done: false, completedDate: null, dueDate: nextDue };
        return prev.map(t => t.id === id ? { ...t, done: true } : t).concat(next);
      }
      return prev.map(t => t.id === id ? { ...t, done: !t.done } : t);
    });
  }

  function deleteTask(id) { setTasks(prev => prev.filter(t => t.id !== id)); }

  function saveEdit(id, raw) {
    setTasks(prev => prev.map(t => t.id === id ? { ...parseTodoTxt(raw, id), done: t.done } : t));
    setEditingId(null);
  }

  function addTask(priority) {
    if (!form.text.trim()) return;
    const id = nextId.current++;
    const parts = [`(${priority === "?" ? "C" : priority})`, form.text.trim()];
    if (form.project.trim()) parts.push(`+${form.project.trim()}`);
    if (form.context.trim()) parts.push(`@${form.context.trim()}`);
    if (form.due) parts.push(`due:${form.due}`);
    if (form.rec.trim()) parts.push(`rec:${form.rec.trim()}`);
    setTasks(prev => [...prev, parseTodoTxt(parts.join(" "), id)]);
    setForm({ text:"", due:"", project:"", context:"", rec:"" });
    setAddingFor(null);
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  function isVisibleToday(task) {
    if (task.done && !showDone) return false;
    if (filterCtx && !task.contexts.includes(filterCtx)) return false;
    if (filterProj && !task.projects.includes(filterProj)) return false;
    // R tasks: only show if effectivePriority resolves to A or B (due today/tomorrow)
    if (task.priority === "R" && !task.done) {
      return effectivePriority(task) === "A" || effectivePriority(task) === "B";
    }
    return true;
  }

  const todayVisible = tasks.filter(isVisibleToday);
  const activeTasks = todayVisible.filter(t => !t.done);
  const doneTasks = todayVisible.filter(t => t.done);

  const groups = { A:[], B:[], C:[], "?":[],  };
  activeTasks.forEach(t => {
    const ep = effectivePriority(t);
    const k = ep && PMETA[ep] && ep !== "R" ? ep : (t.priority && PMETA[t.priority] && t.priority !== "R" ? t.priority : "?");
    groups[k].push(t);
  });

  // ── Weekly ─────────────────────────────────────────────────────────────────

  const weekDays = weekDates();

  function dayTasks(date) {
    return tasks.filter(t => {
      if (t.done) return false;
      if (t.priority === "R" && t.dueDate && t.dueDate > date) return false;
      if (t.dueDate === date) return true;
      if (date === TODAY && t.dueDate && t.dueDate < TODAY) return true;
      return false;
    });
  }

  // Drop onto a task (reorder within group, or cross-group reprioritize)
  function onDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const dragged = tasks.find(t => t.id === dragId);
    const target  = tasks.find(t => t.id === targetId);
    if (!dragged || !target) { setDragId(null); setDragOverId(null); return; }

    const draggedEP = effectivePriority(dragged) || dragged.priority || "?";
    const targetEP  = effectivePriority(target)  || target.priority  || "?";

    if (draggedEP !== targetEP) {
      // Cross-group drop — reprioritize
      applyReprioritize(dragged, targetEP, targetId);
    } else {
      // Same group — reorder only
      setTasks(prev => {
        const arr = [...prev];
        const fi = arr.findIndex(t => t.id === dragId);
        const ti = arr.findIndex(t => t.id === targetId);
        const [moved] = arr.splice(fi, 1);
        arr.splice(ti, 0, moved);
        return arr;
      });
    }
    setDragId(null); setDragOverId(null);
  }

  // Drop onto a group header
  function onDropGroup(targetPriority) {
    if (!dragId) { setDragOverGroup(null); return; }
    const dragged = tasks.find(t => t.id === dragId);
    if (!dragged) { setDragId(null); setDragOverGroup(null); return; }
    const draggedEP = effectivePriority(dragged) || dragged.priority || "?";
    if (draggedEP !== targetPriority) {
      applyReprioritize(dragged, targetPriority, null);
    }
    setDragId(null); setDragOverGroup(null);
  }

  function applyReprioritize(dragged, newPriority, insertBeforeId) {
    if (dragged.priority === "R") {
      // Recurring: show reschedule prompt instead of changing priority
      setReschedulePrompt({ id: dragged.id, newPriority, insertBeforeId });
      setRescheduleDate(dragged.dueDate || TODAY);
    } else {
      setTasks(prev => {
        let arr = prev.map(t => t.id === dragged.id ? { ...t, priority: newPriority === "?" ? null : newPriority } : t);
        if (insertBeforeId) {
          const fi = arr.findIndex(t => t.id === dragged.id);
          const ti = arr.findIndex(t => t.id === insertBeforeId);
          const [moved] = arr.splice(fi, 1);
          arr.splice(ti, 0, moved);
        }
        return arr;
      });
    }
  }

  function confirmReschedule() {
    if (!reschedulePrompt || !rescheduleDate) return;
    const { id, insertBeforeId } = reschedulePrompt;
    setTasks(prev => {
      let arr = prev.map(t => t.id === id ? { ...t, dueDate: rescheduleDate } : t);
      if (insertBeforeId) {
        const fi = arr.findIndex(t => t.id === id);
        const ti = arr.findIndex(t => t.id === insertBeforeId);
        const [moved] = arr.splice(fi, 1);
        arr.splice(ti, 0, moved);
      }
      return arr;
    });
    setReschedulePrompt(null);
    setRescheduleDate("");
  }

  const exportTxt = tasks.map(taskToTxt).join("\n");
  const todayLabel = new Date().toLocaleDateString("en-US",
    { weekday:"long", month:"long", day:"numeric", year:"numeric" });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif", minHeight:"100vh", background:"#f2ede4", color:"#1e1810" }}>

      {/* Header */}
      <div style={{ background:"#1e1810", color:"#f2ede4" }}>
        <div style={{ maxWidth:920, margin:"0 auto", padding:"20px 24px 0" }}>
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:12, paddingBottom:14 }}>
            <div>
              <div style={{ fontSize:10, letterSpacing:"0.25em", textTransform:"uppercase", color:"#6a5040", marginBottom:3 }}>Franklin Covey</div>
              <h1 style={{ margin:0, fontSize:24, fontWeight:"normal" }}>Daily Task Planner</h1>
              <div style={{ fontSize:12, color:"#5a4030", marginTop:2 }}>{todayLabel}</div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              {saveMsg && <span style={{ fontSize:11, color:"#7ec8a0", letterSpacing:"0.05em" }}>{saveMsg}</span>}
              {fileName && <span style={{ fontSize:11, color:"#6a5040", fontFamily:"monospace" }}>{fileName}</span>}
              <HBtn onClick={openFile}>📂 Open</HBtn>
              <HBtn onClick={saveFile}>{fileHandle ? "💾 Save" : "⬇ Download"}</HBtn>
              <HBtn onClick={() => setShowDone(!showDone)}>{showDone ? "Hide Done" : `Done (${tasks.filter(t=>t.done).length})`}</HBtn>
              <HBtn onClick={() => setShowExport(!showExport)}>Export</HBtn>
            </div>
          </div>
          {/* Tabs */}
          <div style={{ display:"flex", borderTop:"1px solid #2e2010" }}>
            {[["daily","📋 Today"],["weekly","📅 Week Ahead"]].map(([v,label]) => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view===v ? "#f2ede4" : "transparent",
                color: view===v ? "#1e1810" : "#6a5040",
                border:"none", cursor:"pointer", padding:"9px 18px",
                fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase",
                fontFamily:"inherit", borderRadius:"4px 4px 0 0",
              }}>{label}</button>
            ))}
          </div>
        </div>
        {/* Filter bar */}
        {(allCtx.length > 0 || allProj.length > 0) && (
          <div style={{ background:"#160e08", borderTop:"1px solid #2e2010" }}>
            <div style={{ maxWidth:920, margin:"0 auto", padding:"6px 24px", display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
              <span style={{ fontSize:10, color:"#4a3828", letterSpacing:"0.15em", textTransform:"uppercase", marginRight:4 }}>Filter</span>
              {allCtx.map(c => (
                <Chip key={c} label={`@${c}`} active={filterCtx===c} color="#7ec8a0" onClick={() => setFilterCtx(filterCtx===c ? null : c)} />
              ))}
              {allProj.map(p => (
                <Chip key={p} label={`+${p}`} active={filterProj===p} color="#7ab8e8" onClick={() => setFilterProj(filterProj===p ? null : p)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth:920, margin:"0 auto", padding:"22px 24px 60px" }}>

        {/* Export */}
        {showExport && (
          <div style={{ background:"#1e1810", borderRadius:6, padding:16, marginBottom:20 }}>
            <div style={{ fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#6a5040", marginBottom:8 }}>todo.txt</div>
            <pre style={{ margin:0, fontSize:11, color:"#c8b89a", lineHeight:1.8, whiteSpace:"pre-wrap", wordBreak:"break-all", fontFamily:"monospace" }}>{exportTxt}</pre>
            <button onClick={() => navigator.clipboard?.writeText(exportTxt)}
              style={{ marginTop:10, background:"#2e2010", color:"#c8b89a", border:"none", borderRadius:4, padding:"5px 12px", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
              Copy to Clipboard
            </button>
          </div>
        )}

        {/* ── DAILY VIEW ── */}
        {view === "daily" && (
          <>
            {/* Reschedule prompt for recurring tasks dragged cross-group */}
            {reschedulePrompt && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:100,
                display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ background:"#fdf6ed", border:"2px solid #ddc898", borderRadius:8,
                  padding:24, maxWidth:380, width:"90%", boxShadow:"0 8px 32px rgba(0,0,0,0.25)" }}>
                  <div style={{ fontSize:12, letterSpacing:"0.1em", textTransform:"uppercase",
                    color:"#b07010", marginBottom:6 }}>Reschedule Recurring Task</div>
                  <div style={{ fontSize:14, color:"#1e1810", marginBottom:16, lineHeight:1.5 }}>
                    {tasks.find(t => t.id === reschedulePrompt.id)?.cleanText}
                  </div>
                  <div style={{ fontSize:12, color:"#7a5a30", marginBottom:8 }}>
                    New due date — this reanchors the recurrence chain from this date forward:
                  </div>
                  <input type="date" value={rescheduleDate}
                    onChange={e => setRescheduleDate(e.target.value)}
                    style={{ ...mini, fontSize:14, padding:"7px 10px", marginBottom:16, display:"block" }} />
                  <div style={{ display:"flex", gap:8 }}>
                    <SBtn onClick={confirmReschedule} color="#b07010">Confirm Reschedule</SBtn>
                    <SBtn onClick={() => { setReschedulePrompt(null); setRescheduleDate(""); }} color="#aaa">Cancel</SBtn>
                  </div>
                </div>
              </div>
            )}

            {["A","B","C","?"].map(p => (
              <Group key={p} priority={p} meta={PMETA[p]} tasks={groups[p]||[]}
                addingFor={addingFor} setAddingFor={setAddingFor}
                form={form} setForm={setForm} onAdd={addTask}
                editingId={editingId} setEditingId={setEditingId}
                onToggle={toggleDone} onDelete={deleteTask} onSaveEdit={saveEdit}
                dragId={dragId} dragOverId={dragOverId}
                dragOverGroup={dragOverGroup} setDragOverGroup={setDragOverGroup}
                setDragId={setDragId} setDragOverId={setDragOverId}
                onDrop={onDrop} onDropGroup={onDropGroup}
              />
            ))}

            {showDone && doneTasks.length > 0 && (
              <div style={{ marginTop:28 }}>
                <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:"#999", marginBottom:6 }}>
                  ✓ Completed ({doneTasks.length})
                </div>
                <div style={{ background:"#ede8de", border:"1px solid #ccc8be", borderRadius:6, overflow:"hidden" }}>
                  {doneTasks.map((task,idx) => (
                    <Row key={task.id} task={task} idx={idx} meta={{ accent:"#aaa", bg:"#ede8de", border:"#ccc8be", dot:"#aaa" }}
                      editingId={editingId}
                      onToggle={() => toggleDone(task.id)} onDelete={() => deleteTask(task.id)}
                      onEdit={() => setEditingId(task.id)} onSaveEdit={raw => saveEdit(task.id, raw)}
                      onCancelEdit={() => setEditingId(null)}
                      dragId={null} dragOverId={null} onDragStart={()=>{}} onDragOver={()=>{}} onDrop={()=>{}}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── WEEKLY VIEW ── */}
        {view === "weekly" && (
          <>
            <div style={{ fontSize:12, color:"#8a7060", marginBottom:14 }}>
              Tasks due in the next 7 days. Overdue tasks surface under today.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
              {weekDays.map(date => {
                const dt = dayTasks(date);
                const today = date === TODAY;
                return (
                  <div key={date} style={{
                    background: today ? "#1e1810" : "#ede8de",
                    border: today ? "2px solid #b33020" : "1px solid #ccc8be",
                    borderRadius:6, padding:"10px 8px 12px", minHeight:120,
                  }}>
                    <div style={{ fontSize:9, fontWeight:"bold", letterSpacing:"0.1em", textTransform:"uppercase",
                      color: today ? "#b33020" : "#8a7060", marginBottom:1 }}>{fmtWeekday(date)}</div>
                    <div style={{ fontSize:20, fontWeight:"normal", marginBottom:8,
                      color: today ? "#f2ede4" : "#1e1810" }}>{fmtDayNum(date)}</div>
                    {dt.length === 0
                      ? <div style={{ fontSize:11, color: today ? "#3a2e20" : "#bbb", fontStyle:"italic" }}>—</div>
                      : dt.map(task => {
                          const m = PMETA[task.priority] || PMETA["?"];
                          return (
                            <div key={task.id} style={{ marginBottom:5 }}>
                              <div style={{ display:"flex", alignItems:"flex-start", gap:5 }}>
                                <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot, flexShrink:0, marginTop:4 }} />
                                <span style={{ fontSize:11, lineHeight:1.35, color: today ? "#c8b89a" : "#3a2e22" }}>
                                  {task.cleanText}
                                </span>
                              </div>
                              {task.recurrence && (
                                <div style={{ fontSize:9, color: today ? "#5a4030" : "#bbb", marginLeft:11 }}>↺ {task.recurrence}</div>
                              )}
                            </div>
                          );
                        })}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop:24 }}>
              <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:"#999", marginBottom:8 }}>No due date</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {tasks.filter(t => !t.done && !t.dueDate).map(task => {
                  const m = PMETA[task.priority] || PMETA["?"];
                  return (
                    <div key={task.id} style={{ background:"#ede8de", border:`1px solid ${m.border}`,
                      borderRadius:4, padding:"5px 10px", fontSize:12, display:"flex", gap:6, alignItems:"center" }}>
                      <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot, flexShrink:0 }} />
                      <span style={{ color:m.accent, fontSize:10, fontWeight:"bold" }}>{task.priority||"?"}</span>
                      <span>{task.cleanText}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Group ────────────────────────────────────────────────────────────────────

function Group({ priority, meta, tasks, addingFor, setAddingFor, form, setForm, onAdd,
  editingId, setEditingId, onToggle, onDelete, onSaveEdit,
  dragId, dragOverId, dragOverGroup, setDragOverGroup, setDragId, setDragOverId, onDrop, onDropGroup }) {
  const headerIsTarget = dragOverGroup === priority;
  return (
    <div style={{ marginBottom:16 }}>
      {/* Header — also a drop target */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOverGroup(priority); }}
        onDragLeave={() => setDragOverGroup(null)}
        onDrop={e => { e.preventDefault(); onDropGroup(priority); }}
        style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6,
          borderRadius:6, padding:"4px 6px", transition:"background 0.1s",
          background: headerIsTarget ? meta.border : "transparent",
          outline: headerIsTarget ? `2px dashed ${meta.accent}` : "2px dashed transparent" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:22, height:22, borderRadius:"50%", background:meta.accent, color:"#fff",
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:"bold", flexShrink:0 }}>
            {priority === "?" ? "?" : priority}
          </div>
          <span style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:meta.accent }}>{meta.label}</span>
          <span style={{ fontSize:11, color:"#aaa", background:"#e5e0d5", borderRadius:10, padding:"1px 7px" }}>{tasks.length}</span>
          {headerIsTarget && (
            <span style={{ fontSize:10, color:meta.accent, fontStyle:"italic" }}>Drop to reprioritize →</span>
          )}
        </div>
        <button onClick={() => setAddingFor(addingFor === priority ? null : priority)}
          style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:meta.accent, lineHeight:1, padding:"0 6px", fontFamily:"inherit" }}>+</button>
      </div>

      {addingFor === priority && (
        <div style={{ background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:6, padding:12, marginBottom:8 }}>
          <input value={form.text} onChange={e => setForm(f => ({...f, text:e.target.value}))}
            onKeyDown={e => { if (e.key==="Enter") onAdd(priority); if (e.key==="Escape") setAddingFor(null); }}
            placeholder="Task description…" autoFocus
            style={{ width:"100%", border:`1px solid ${meta.border}`, borderRadius:4, padding:"7px 10px",
              fontSize:14, fontFamily:"inherit", background:"#fff", boxSizing:"border-box", marginBottom:8 }} />
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <input value={form.due} type="date" onChange={e => setForm(f => ({...f, due:e.target.value}))} style={mini} />
            <input value={form.project} onChange={e => setForm(f => ({...f, project:e.target.value}))} placeholder="+Project" style={mini} />
            <input value={form.context} onChange={e => setForm(f => ({...f, context:e.target.value}))} placeholder="@context" style={mini} />
            <input value={form.rec} onChange={e => setForm(f => ({...f, rec:e.target.value}))} placeholder="rec: e.g. 1w, 1m (optional)" style={mini} />
            <SBtn onClick={() => onAdd(priority)} color={meta.accent}>Add</SBtn>
            <SBtn onClick={() => setAddingFor(null)} color="#aaa">Cancel</SBtn>
          </div>
        </div>
      )}

      <div style={{ background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:6, overflow:"hidden" }}>
        {tasks.length === 0
          ? <div style={{ padding:"12px 16px", fontSize:13, color:"#ccc", fontStyle:"italic" }}>No tasks</div>
          : tasks.map((task, idx) => (
              <Row key={task.id} task={task} idx={idx} meta={meta}
                editingId={editingId}
                onToggle={() => onToggle(task.id)} onDelete={() => onDelete(task.id)}
                onEdit={() => setEditingId(task.id)} onSaveEdit={raw => onSaveEdit(task.id, raw)}
                onCancelEdit={() => setEditingId(null)}
                dragId={dragId} dragOverId={dragOverId}
                onDragStart={() => setDragId(task.id)}
                onDragOver={() => setDragOverId(task.id)}
                onDrop={() => onDrop(task.id)}
              />
            ))}
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function Row({ task, idx, meta, editingId, onToggle, onDelete, onEdit, onSaveEdit, onCancelEdit,
  dragId, dragOverId, onDragStart, onDragOver, onDrop }) {
  const [editRaw, setEditRaw] = useState("");
  const isEditing = editingId === task.id;
  const overdue = task.dueDate && task.dueDate < TODAY && !task.done;
  const dueToday = task.dueDate === TODAY && !task.done;

  return (
    <div draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
      style={{ borderTop: idx > 0 ? `1px solid ${meta.border}` : "none",
        background: dragOverId === task.id ? meta.border + "88" : "transparent",
        opacity: dragId === task.id ? 0.4 : 1 }}>
      {isEditing ? (
        <div style={{ padding:"10px 12px" }}>
          <input value={editRaw} onChange={e => setEditRaw(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter") onSaveEdit(editRaw); if (e.key==="Escape") onCancelEdit(); }}
            autoFocus
            style={{ width:"100%", fontFamily:"monospace", fontSize:12, padding:"6px 8px",
              border:`1px solid ${meta.border}`, borderRadius:4, boxSizing:"border-box" }} />
          <div style={{ display:"flex", gap:6, marginTop:6 }}>
            <SBtn onClick={() => onSaveEdit(editRaw)} color={meta.accent}>Save</SBtn>
            <SBtn onClick={onCancelEdit} color="#aaa">Cancel</SBtn>
            <span style={{ fontSize:10, color:"#bbb", alignSelf:"center" }}>todo.txt format · Enter saves · Esc cancels</span>
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"flex-start", padding:"9px 12px", gap:8,
          transition:"background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.background = meta.border + "44"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ color:"#ccc", fontSize:11, paddingTop:3, cursor:"grab", userSelect:"none", flexShrink:0 }}>⠿</div>
          <div style={{ minWidth:24, textAlign:"center", fontSize:11, fontWeight:"bold",
            color: task.done ? "#bbb" : meta.accent, paddingTop:3, flexShrink:0 }}>
            {task.done ? "✓" : `${effectivePriority(task) || task.priority || "?"}${idx+1}`}
          </div>
          <input type="checkbox" checked={task.done} onChange={onToggle}
            style={{ marginTop:3, flexShrink:0, accentColor:meta.accent, cursor:"pointer", width:14, height:14 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, lineHeight:1.4,
              textDecoration: task.done ? "line-through" : "none",
              color: task.done ? "#aaa" : "#1e1810" }}>
              {task.cleanText}
              {task.recurrence && !task.done && (
                <span style={{ marginLeft:7, fontSize:10, color: PMETA["R"].accent, opacity:0.75,
                  background:"#eef2fb", borderRadius:3, padding:"1px 5px" }}>↺ rec</span>
              )}
            </div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:3 }}>
              {task.dueDate && (
                <span style={{ fontSize:10, fontFamily:"monospace", padding:"1px 5px", borderRadius:3,
                  background: overdue ? "#fde8e5" : dueToday ? "#fff3cd" : "#e8f0fe",
                  color: overdue ? "#b33020" : dueToday ? "#856404" : "#3558b0",
                  border: `1px solid ${overdue ? "#f5c2bc" : dueToday ? "#ffc107" : "#b8d0f0"}` }}>
                  {overdue ? "⚠ " : dueToday ? "⏰ " : ""}{fmtDate(task.dueDate)}
                </span>
              )}
              {task.projects.map(p => (
                <span key={p} style={{ fontSize:10, fontFamily:"monospace", color:"#3558b0", background:"#e8f0fe", padding:"1px 5px", borderRadius:3 }}>+{p}</span>
              ))}
              {task.contexts.map(c => (
                <span key={c} style={{ fontSize:10, fontFamily:"monospace", color:"#2a7048", background:"#eef7f2", padding:"1px 5px", borderRadius:3 }}>@{c}</span>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", gap:2, flexShrink:0 }}>
            <button onClick={() => { setEditRaw(taskToTxt(task)); onEdit(); }} title="Edit raw"
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#ccc", padding:"2px 4px" }}>✎</button>
            <button onClick={onDelete} title="Delete"
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, color:"#ddd", padding:"2px 4px" }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function HBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ background:"#2e2010", color:"#c8b89a", border:"none",
      borderRadius:4, padding:"5px 12px", cursor:"pointer", fontSize:11, fontFamily:"inherit",
      letterSpacing:"0.03em" }}>{children}</button>
  );
}

function SBtn({ children, onClick, color }) {
  return (
    <button onClick={onClick} style={{ background: color||"#888", color:"#fff", border:"none",
      borderRadius:4, padding:"4px 10px", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{children}</button>
  );
}

function Chip({ label, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{ fontSize:10, padding:"2px 8px", borderRadius:20,
      border:"1px solid", cursor:"pointer", fontFamily:"monospace",
      borderColor: active ? color : "#3a2810",
      background: active ? color : "transparent",
      color: active ? "#1e1810" : "#6a5040" }}>{label}</button>
  );
}

const mini = {
  fontSize:12, padding:"4px 8px", border:"1px solid #ddd",
  borderRadius:4, fontFamily:"monospace", background:"#fff"
};
