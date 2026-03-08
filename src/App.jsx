import { useState, useRef, useEffect, useCallback } from "react";

// ─── Dropbox PKCE OAuth ───────────────────────────────────────────────────────

const DBX_APP_KEY    = "fc5cp3nk989ym1q";
const DBX_FILE_PATH  = "/Apps/Obsidian/v1/todo.todotxt";
const DBX_REDIRECT   = window.location.origin + window.location.pathname;
const DBX_AUTH_URL   = "https://www.dropbox.com/oauth2/authorize";
const DBX_TOKEN_URL  = "https://api.dropboxapi.com/oauth2/token";
const DBX_UPLOAD_URL   = "https://content.dropboxapi.com/2/files/upload";
const DBX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const DBX_LIST_URL     = "https://api.dropboxapi.com/2/files/list_folder";
const DBX_LONGPOLL_URL = "https://notify.dropboxapi.com/2/files/list_folder/longpoll";

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function pkceChallenge() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}
async function startDropboxAuth() {
  const { verifier, challenge } = await pkceChallenge();
  sessionStorage.setItem("dbx_verifier", verifier);
  const params = new URLSearchParams({
    client_id: DBX_APP_KEY, response_type: "code", redirect_uri: DBX_REDIRECT,
    code_challenge: challenge, code_challenge_method: "S256", token_access_type: "offline",
  });
  window.location.href = `${DBX_AUTH_URL}?${params}`;
}
async function exchangeCode(code) {
  const verifier = sessionStorage.getItem("dbx_verifier");
  sessionStorage.removeItem("dbx_verifier");
  const res = await fetch(DBX_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code",
      client_id: DBX_APP_KEY, redirect_uri: DBX_REDIRECT, code_verifier: verifier }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function refreshToken(refresh_token) {
  const res = await fetch(DBX_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: DBX_APP_KEY }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function loadTokens() {
  try { return JSON.parse(localStorage.getItem("dbx_tokens") || "null"); } catch { return null; }
}
function saveTokens(tokens) { localStorage.setItem("dbx_tokens", JSON.stringify(tokens)); }
async function getAccessToken() {
  let tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    try {
      const fresh = await refreshToken(tokens.refresh_token);
      tokens = { ...tokens, access_token: fresh.access_token,
        expires_at: Date.now() + (fresh.expires_in || 14400) * 1000 };
      saveTokens(tokens);
    } catch { return null; }
  }
  return tokens.access_token;
}
async function dbxGetCursor(accessToken) {
  // Get a cursor for the folder containing the todo file
  const folder = DBX_FILE_PATH.split("/").slice(0, -1).join("/") || "";
  const res = await fetch(DBX_LIST_URL + "/get_latest_cursor", {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: folder, recursive: false }),
  });
  if (!res.ok) throw new Error(`cursor failed: ${res.status}`);
  const data = await res.json();
  return data.cursor;
}

async function dbxLongpoll(cursor) {
  const res = await fetch(DBX_LONGPOLL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor, timeout: 30 }),
  });
  if (!res.ok) throw new Error(`longpoll failed: ${res.status}`);
  return res.json(); // { changes: bool, backoff?: number }
}

async function dbxDownload(accessToken) {
  const res = await fetch(DBX_DOWNLOAD_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_FILE_PATH }) },
  });
  if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
  return res.text();
}
async function dbxUpload(accessToken, content) {
  const res = await fetch(DBX_UPLOAD_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DBX_FILE_PATH, mode: "overwrite", autorename: false, mute: true }),
      "Content-Type": "application/octet-stream" },
    body: content,
  });
  if (!res.ok) throw new Error(`Dropbox upload failed: ${res.status}`);
  return res.json();
}

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
  if (!priority) { const priM = raw.match(/\bpri:([A-Z])\b/); if (priM) priority = priM[1]; }

  const crM = text.match(/^(\d{4}-\d{2}-\d{2})\s/);
  if (crM) text = text.slice(11);

  const dueM   = raw.match(/due:(\d{4}-\d{2}-\d{2})/);
  const threshM = raw.match(/t:(\d{4}-\d{2}-\d{2})/);
  const seqM   = raw.match(/\bseq:(\d+)\b/);
  const dueDate       = dueM    ? dueM[1]    : null;
  const thresholdDate = threshM ? threshM[1] : null;
  const seq           = seqM    ? parseInt(seqM[1]) : null;
  const recurrence = parseRecurrence(raw);
  const projects = [...raw.matchAll(/\+(\S+)/g)].map(m => m[1]);
  const contexts = [...raw.matchAll(/@(\S+)/g)].map(m => m[1]);

  const cleanText = text
    .replace(/due:\d{4}-\d{2}-\d{2}/g, "")
    .replace(/t:\d{4}-\d{2}-\d{2}/g, "")
    .replace(/rec:\S+/g, "")
    .replace(/status:\S+/g, "")
    .replace(/pri:[A-Z]/g, "")
    .replace(/\bseq:\d+\b/g, "")
    .replace(/\+\S+/g, "")
    .replace(/@\S+/g, "")
    .replace(/\s+/g, " ").trim();

  const inProgress = raw.includes("status:inprogress");
  return { id, priority, cleanText, dueDate, thresholdDate, recurrence, projects, contexts, done, completedDate, inProgress, seq };
}

function taskToTxt(task) {
  // BUG-02: use original completion date, not today
  let line = task.done ? `x ${task.completedDate || new Date().toISOString().split("T")[0]} ` : "";
  if (task.done) {
    // BUG-15: strip any orphaned pri: from cleanText before appending canonical pri:X
    const cleanedText = task.cleanText.replace(/\bpri:[A-Z]\b/g, "").replace(/\s+/g, " ").trim();
    line += task.priority ? `${cleanedText} pri:${task.priority}` : cleanedText;
  } else {
    // BUG-15: active tasks must never carry a pri: tag in text
    if (task.priority) line += `(${task.priority}) `;
    line += task.cleanText.replace(/\bpri:[A-Z]\b/g, "").replace(/\s+/g, " ").trim();
  }
  if (task.projects.length)  line += " " + task.projects.map(p => `+${p}`).join(" ");
  if (task.contexts.length)  line += " " + task.contexts.map(c => `@${c}`).join(" ");
  if (task.dueDate)          line += ` due:${task.dueDate}`;
  if (task.thresholdDate)    line += ` t:${task.thresholdDate}`;
  if (task.recurrence)       line += ` rec:${task.recurrence}`;
  if (task.inProgress && !task.done) line += ` status:inprogress`;
  if (task.seq != null)      line += ` seq:${task.seq}`;
  return line;
}

function sortedTxt(tasks) {
  // Assign seq to any task that doesn't have one yet (new tasks)
  const withSeq = assignSeq(tasks);
  return withSeq.map(taskToTxt).sort((a, b) => {
    const aDone = a.startsWith("x "), bDone = b.startsWith("x ");
    if (aDone !== bDone) return aDone ? 1 : -1;
    // Within active tasks, preserve seq order
    const aSeq = (a.match(/\bseq:(\d+)\b/) || [])[1];
    const bSeq = (b.match(/\bseq:(\d+)\b/) || [])[1];
    if (aSeq && bSeq) return parseInt(aSeq) - parseInt(bSeq);
    return a.localeCompare(b);
  }).join("\n") + "\n";
}

// Assign sequential seq numbers to tasks that lack them, preserving existing order
function assignSeq(tasks) {
  let next = 1;
  // First pass: find highest existing seq
  tasks.forEach(t => { if (t.seq != null && t.seq >= next) next = t.seq + 1; });
  // Second pass: assign seq to tasks missing it
  return tasks.map(t => t.seq != null ? t : { ...t, seq: next++ });
}

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
function fmtDayNum(iso) { return parseInt(iso.split("-")[2]); }

// ─── Priority helpers ─────────────────────────────────────────────────────────

function effectivePriority(task) {
  if (task.priority !== "R") return task.priority;
  if (!task.dueDate) return "R";
  const tomorrow = advanceDate(TODAY, "1d");
  if (task.dueDate <= TODAY) return "A";
  if (task.dueDate === tomorrow) return "B";
  return null;
}

// Sort key within a group: overdue=0, today=1, future=2 (then by date), none=3
function dueSortKey(task) {
  if (!task.dueDate) return 3;
  if (task.dueDate < TODAY) return 0;
  if (task.dueDate === TODAY) return 1;
  return 2;
}

// Highlight search terms in text
function highlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background:"#ffe082", color:"#1e1810", borderRadius:2, padding:"0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
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
  A:   { label:"A — Vital",      accent:"#b33020", bg:"#fdf0ee", border:"#ddb5b0", dot:"#b33020" },
  B:   { label:"B — Important",  accent:"#b07010", bg:"#fdf6ed", border:"#ddc898", dot:"#b07010" },
  C:   { label:"C — Nice to Do", accent:"#2a7048", bg:"#eef7f2", border:"#9ecfb5", dot:"#2a7048" },
  R:   { label:"R — Recurring",  accent:"#3558b0", bg:"#eef2fb", border:"#9db5e0", dot:"#3558b0" },
  "?": { label:"Unsorted",       accent:"#888",    bg:"#f5f4f0", border:"#d8d5ce", dot:"#888"    },
};

const QUOTES = [
  { text:"The key is not to prioritize what's on your schedule, but to schedule your priorities.", author:"Stephen Covey" },
  { text:"Action is the foundational key to all success.", author:"Pablo Picasso" },
  { text:"Do the hard jobs first. The easy jobs will take care of themselves.", author:"Dale Carnegie" },
  { text:"It is not enough to be busy. The question is: what are we busy about?", author:"Henry David Thoreau" },
  { text:"You don't have to see the whole staircase, just take the first step.", author:"Martin Luther King Jr." },
  { text:"Simplicity is the ultimate sophistication.", author:"Leonardo da Vinci" },
  { text:"The secret of getting ahead is getting started.", author:"Mark Twain" },
  { text:"Focus on being productive instead of busy.", author:"Tim Ferriss" },
  { text:"Either you run the day or the day runs you.", author:"Jim Rohn" },
  { text:"Efficiency is doing things right. Effectiveness is doing the right things.", author:"Peter Drucker" },
  { text:"The great dividing line between success and failure: I did not have time.", author:"Franklin Field" },
  { text:"Until we can manage time, we can manage nothing else.", author:"Peter Drucker" },
  { text:"Plans are nothing; planning is everything.", author:"Dwight D. Eisenhower" },
  { text:"Your future is created by what you do today, not tomorrow.", author:"Robert Kiyosaki" },
  { text:"The way to get started is to quit talking and begin doing.", author:"Walt Disney" },
  { text:"Well begun is half done.", author:"Aristotle" },
  { text:"Don't count the days, make the days count.", author:"Muhammad Ali" },
  { text:"Lost time is never found again.", author:"Benjamin Franklin" },
  { text:"The best time to plant a tree was 20 years ago. The second best time is now.", author:"Chinese Proverb" },
  { text:"Amateurs sit and wait for inspiration. The rest of us just get up and go to work.", author:"Stephen King" },
  { text:"Start where you are. Use what you have. Do what you can.", author:"Arthur Ashe" },
  { text:"It always seems impossible until it's done.", author:"Nelson Mandela" },
  { text:"Small deeds done are better than great deeds planned.", author:"Peter Marshall" },
  { text:"The most difficult thing is the decision to act. The rest is merely tenacity.", author:"Amelia Earhart" },
  { text:"Do what you can, with what you have, where you are.", author:"Theodore Roosevelt" },
  { text:"Motivation is what gets you started. Habit is what keeps you going.", author:"Jim Ryun" },
  { text:"You miss 100% of the shots you don't take.", author:"Wayne Gretzky" },
  { text:"The only way to do great work is to love what you do.", author:"Steve Jobs" },
  { text:"Plans are useless, but planning is indispensable.", author:"Dwight D. Eisenhower" },
  { text:"The future depends on what you do today.", author:"Mahatma Gandhi" },
  { text:"A year from now you may wish you had started today.", author:"Karen Lamb" },
  { text:"Done is better than perfect.", author:"Sheryl Sandberg" },
  { text:"Perfection is the enemy of progress.", author:"Winston Churchill" },
  { text:"If you want to make an easy job seem hard, just keep putting it off.", author:"Olin Miller" },
  { text:"The art of being wise is knowing what to overlook.", author:"William James" },
];

// Contexts that sink to the bottom of their priority group
const SINK_CONTEXTS = new Set(["delegated", "waiting"]);

export default function App() {
  const hasDropbox = !!loadTokens();
  const [tasks,   setTasks]   = useState(() =>
    hasDropbox ? null : SAMPLE.map((raw, i) => parseTodoTxt(raw, i + 1))
  );
  const [view,          setView]          = useState("daily");
  const [showDone,      setShowDone]      = useState(false);
  const [filterCtx,     setFilterCtx]     = useState(null);
  const [filterProj,    setFilterProj]    = useState(null);
  const [editingId,     setEditingId]     = useState(null);
  const [addingFor,     setAddingFor]     = useState(null);
  const [form,          setForm]          = useState({ text:"", due:"", project:"", context:"", rec:"", inProgress:false });
  const [showHelp,      setShowHelp]      = useState(false);
  const [showExport,    setShowExport]    = useState(false);
  const [dbxConnected,  setDbxConnected]  = useState(!!loadTokens());
  const [dbxStatus,     setDbxStatus]     = useState(null);
  const [fileHandle,    setFileHandle]    = useState(null);
  const [saveMsg,       setSaveMsg]       = useState(null);
  const [dragId,        setDragId]        = useState(null);
  const [dragOverId,    setDragOverId]    = useState(null);
  const [dragOverGroup, setDragOverGroup] = useState(null);
  const [reschedulePrompt, setReschedulePrompt] = useState(null);
  const [rescheduleDate,   setRescheduleDate]   = useState("");
  // FEAT-02: Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef(null);
  // FEAT-06: Undo
  const [undoStack, setUndoStack] = useState([]);
  const [undoToast, setUndoToast] = useState(null);
  const undoTimerRef = useRef(null);
  // FEAT-12: Planning mode
  const [planningMode, setPlanningMode] = useState(false);
  const [planStep, setPlanStep] = useState(0);
  const [planRolloverIds, setPlanRolloverIds] = useState([]);
  // FEAT-11: Keyboard nav
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  // BUG-06: Touch drag state (shared across all rows via ref, not state — no re-renders during drag)
  const touchDrag = useRef({ id: null, startY: 0, lastOverId: null, lastOverGroup: null });
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const nextId = useRef(500);

  const allCtx  = [...new Set((tasks||[]).flatMap(t => t.contexts))].sort();
  const allProj = [...new Set((tasks||[]).flatMap(t => t.projects))].sort();

  // ── iOS notification permission (required for badge on iOS 16.4+) ─────────
  useEffect(() => {
    if (!isMobile) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      // Request after a short delay so it doesn't fire on first load
      const t = setTimeout(() => {
        Notification.requestPermission().catch(() => {});
      }, 3000);
      return () => clearTimeout(t);
    }
  }, []);

  // ── App badging ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    const count = (tasks||[]).filter(t => {
      if (t.done) return false;
      if (t.thresholdDate && t.thresholdDate > TODAY) return false;
      if (t.priority === "R") {
        const ep = effectivePriority(t);
        return ep === "A" || ep === "B";
      }
      // Only count tasks that are due today or overdue (not future-dated or undated)
      if (!t.dueDate) return false;
      return t.dueDate <= TODAY;
    }).length;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [tasks]);

  // ── Dropbox OAuth callback ─────────────────────────────────────────────────
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
      nextId.current = parsed.length + 100;
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
      // Advance the poll cursor to after this write so the longpoll
      // doesn't detect our own upload as a remote change
      try {
        const freshToken = await getAccessToken();
        if (freshToken) pollCursor.current = await dbxGetCursor(freshToken);
      } catch {}
      setDbxStatus("saved");
    } catch(e) { setDbxStatus("error"); console.error("Dropbox save error:", e); }
  }, []);

  const saveTimer = useRef(null);
  const lastSavedAt = useRef(0);
  const pollCursor  = useRef(null); // shared between saveToDropbox and the poll loop
  useEffect(() => {
    if (!dbxConnected || tasks === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToDropbox(tasks), 1500);
    return () => clearTimeout(saveTimer.current);
  }, [tasks, dbxConnected]);

  // ── Dropbox longpoll: real-time updates on desktop ─────────────────────────
  useEffect(() => {
    if (!dbxConnected) return;
    let cancelled = false;

    async function poll() {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        // Use shared cursor if saveToDropbox already advanced it, otherwise fetch fresh
        if (!pollCursor.current) {
          pollCursor.current = await dbxGetCursor(token);
        }
        while (!cancelled) {
          const cursor = pollCursor.current;
          const result = await dbxLongpoll(cursor);
          if (cancelled) break;
          if (result.backoff) await new Promise(r => setTimeout(r, result.backoff * 1000));
          if (result.changes) {
            // 10s guard: covers 1.5s debounce + upload time + any slow connection
            const msSinceSave = Date.now() - lastSavedAt.current;
            if (msSinceSave > 10000) {
              await loadFromDropbox();
            }
            // Always advance cursor past this change (our write or theirs)
            // so we don't re-detect it on the next loop iteration
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

  // ── Local file fallback ────────────────────────────────────────────────────
  async function openFile() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description:"todo.txt / todo.todotxt", accept:{ "text/plain":[".txt",".todotxt"] } }],
      });
      const file = await handle.getFile();
      const text = await file.text();
      const parsed = text.split("\n").filter(l => l.trim()).map((raw, i) => parseTodoTxt(raw, i + 1));
      setTasks(parsed); nextId.current = parsed.length + 100;
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

  function disconnectDropbox() { localStorage.removeItem("dbx_tokens"); setDbxConnected(false); setDbxStatus(null); }
  function flash(msg) { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), 2500); }

  // ── FEAT-06: Undo helpers ─────────────────────────────────────────────────
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

  // ── Mutations ─────────────────────────────────────────────────────────────
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
    const assignedPriority = hasRec ? "R" : (priority === "?" ? "C" : priority);
    const parts = [`(${assignedPriority})`, form.text.trim()];
    if (form.project.trim()) parts.push(`+${form.project.trim()}`);
    if (form.context.trim()) parts.push(`@${form.context.trim()}`);
    if (form.due)            parts.push(`due:${form.due}`);
    if (form.rec.trim())     parts.push(`rec:${form.rec.trim()}`);
    if (form.inProgress)     parts.push(`status:inprogress`);
    setTasks(prev => {
      const maxSeq = prev.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
      const parsed = parseTodoTxt(parts.join(" "), id);
      return [...prev, { ...parsed, seq: maxSeq + 1 }];
    });
    setForm({ text:"", due:"", project:"", context:"", rec:"", inProgress:false });
    setAddingFor(null);
  }

  function changePriority(id, newPriority) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, priority: newPriority || null } : t));
  }

  // ── FEAT-02: Search filtering ─────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  function matchesSearch(task) {
    if (!q) return true;
    if (task.cleanText.toLowerCase().includes(q)) return true;
    if (task.projects.some(p => p.toLowerCase().includes(q))) return true;
    if (task.contexts.some(c => c.toLowerCase().includes(q))) return true;
    if (task.dueDate && task.dueDate.includes(q)) return true;
    return false;
  }

  // FEAT-03: Someday/Maybe — tasks with no due date, no recurrence, priority C or none
  const somedayTasks = (tasks||[]).filter(t =>
    !t.done && !t.dueDate && !t.recurrence &&
    (t.priority === "C" || t.priority === null) &&
    matchesSearch(t)
  );

  function promoteToDaily(id) {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, dueDate: TODAY, priority: t.priority || "C" } : t
    ));
    flash("✓ Moved to today's list");
  }

  // ── Filtering + grouping ──────────────────────────────────────────────────
  function isVisibleToday(task) {
    if (task.done && !showDone) return false;
    if (filterCtx  && !task.contexts.includes(filterCtx))  return false;
    if (filterProj && !task.projects.includes(filterProj)) return false;
    if (!matchesSearch(task)) return false;
    // Threshold: hide tasks whose threshold date is in the future
    if (task.thresholdDate && task.thresholdDate > TODAY)  return false;
    if (task.priority === "R" && !task.done) {
      const ep = effectivePriority(task);
      return ep === "A" || ep === "B";
    }
    return true;
  }

  const todayVisible = (tasks||[]).filter(isVisibleToday);
  const visibleActive = todayVisible.filter(t => !t.done);
  const doneTasks     = todayVisible.filter(t =>  t.done);

  const groups = { A:[], B:[], C:[], "?":[] };
  visibleActive.forEach(t => {
    const ep = effectivePriority(t);
    const k = ep && PMETA[ep] && ep !== "R" ? ep
            : (t.priority && PMETA[t.priority] && t.priority !== "R" ? t.priority : "?");
    groups[k].push(t);
  });
  Object.keys(groups).forEach(k => {
    groups[k].sort((a, b) => {
      const aDel = a.contexts.some(c => SINK_CONTEXTS.has(c)) ? 1 : 0;
      const bDel = b.contexts.some(c => SINK_CONTEXTS.has(c)) ? 1 : 0;
      if (aDel !== bDel) return aDel - bDel;          // sink contexts go last
      const ka = dueSortKey(a), kb = dueSortKey(b);
      if (ka !== kb) return ka - kb;                   // overdue/today first
      if (ka === 2) return a.dueDate.localeCompare(b.dueDate); // future: by date
      // Same tier: preserve drag order via seq
      const as = a.seq ?? 99999, bs = b.seq ?? 99999;
      return as - bs;
    });
  });

  // Ordered flat list of visible active tasks for keyboard nav
  const orderedTasks = ["A","B","C","?"].flatMap(k => groups[k]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const weekDays = weekDates();

  function dayTasks(date) {
    return (tasks||[]).filter(t => {
      if (t.done) return false;
      if (t.priority === "R" && t.dueDate && t.dueDate > date) return false;
      if (t.dueDate === date) return true;
      if (date === TODAY && t.dueDate && t.dueDate < TODAY) return true;
      return false;
    });
  }

  // After any drag reorder, write fresh seq numbers so the new order persists to Dropbox
  function resequence(arr) {
    return arr.map((t, i) => ({ ...t, seq: i + 1 }));
  }

  // ── BUG-06: Touch drag handlers (passed to each Row) ─────────────────────
  function handleTouchDragStart(taskId, e) {
    touchDrag.current = { id: taskId, startY: e.touches[0].clientY, lastOverId: null, lastOverGroup: null };
    setDragId(taskId);
  }

  function handleTouchDragMove(e) {
    const touch = e.touches[0];
    // Find element under finger (must ignore the dragged element itself)
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;

    // Walk up to find a data-taskid or data-group attribute
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

  function onDrop(targetId) {
    if (!tasks || !dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const dragged = tasks.find(t => t.id === dragId);
    const target  = tasks.find(t => t.id === targetId);
    if (!dragged || !target) { setDragId(null); setDragOverId(null); return; }
    const draggedEP = effectivePriority(dragged) || dragged.priority || "?";
    const targetEP  = effectivePriority(target)  || target.priority  || "?";
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
    const draggedEP = effectivePriority(dragged) || dragged.priority || "?";
    if (draggedEP !== targetPriority) applyReprioritize(dragged, targetPriority, null);
    setDragId(null); setDragOverGroup(null);
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

  // ── FEAT-11: Keyboard navigation ──────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      // Don't steal keys when typing in an input/textarea or editing
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // / to focus search (always)
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // Escape: clear search or exit modal states
      if (e.key === "Escape") {
        if (searchQuery) { setSearchQuery(""); searchRef.current?.blur(); }
        if (editingId) setEditingId(null);
        if (addingFor) setAddingFor(null);
        if (planningMode) setPlanningMode(false);
        return;
      }
      // All remaining shortcuts need no input focused
      if (inInput || editingId || addingFor) return;

      const idx = orderedTasks.findIndex(t => t.id === focusedTaskId);

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = orderedTasks[Math.min(idx + 1, orderedTasks.length - 1)];
        if (next) setFocusedTaskId(next.id);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = orderedTasks[Math.max(idx - 1, 0)];
        if (prev) setFocusedTaskId(prev.id);
      } else if (e.key === "x" && focusedTaskId) {
        toggleDone(focusedTaskId);
      } else if (e.key === "d" && focusedTaskId) {
        deleteTask(focusedTaskId);
        const next = orderedTasks[Math.min(idx + 1, orderedTasks.length - 1)];
        setFocusedTaskId(next?.id || null);
      } else if (e.key === "e" && focusedTaskId) {
        setEditingId(focusedTaskId);
      } else if (e.key === "n") {
        setAddingFor("A");
      } else if (["1","2","3","4"].includes(e.key) && focusedTaskId) {
        const pMap = { "1":"A", "2":"B", "3":"C", "4":null };
        changePriority(focusedTaskId, pMap[e.key]);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusedTaskId, orderedTasks, editingId, addingFor, searchQuery, planningMode, tasks]);

  // ── FEAT-12: Planning mode ────────────────────────────────────────────────
  function startPlanningMode() {
    // Step 0: identify incomplete tasks from yesterday (overdue, non-recurring)
    const overdue = (tasks||[]).filter(t =>
      !t.done && t.dueDate && t.dueDate < TODAY && t.priority !== "R"
    );
    setPlanRolloverIds(overdue.map(t => t.id));
    setPlanStep(0);
    setPlanningMode(true);
  }

  function planRolloverTask(id, action) {
    // action: "keep" (push to today), "defer" (push to tomorrow), "drop"
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      if (action === "drop") return { ...t, done: true, completedDate: TODAY };
      if (action === "defer") return { ...t, dueDate: advanceDate(TODAY, "1d") };
      return { ...t, dueDate: TODAY }; // keep = today
    }));
    setPlanRolloverIds(ids => ids.filter(i => i !== id));
  }

  function advancePlanStep() {
    setPlanStep(s => {
      if (s >= 2) { setPlanningMode(false); return 0; }
      return s + 1;
    });
  }

  // ── Misc ───────────────────────────────────────────────────────────────────
  const exportTxt  = tasks ? sortedTxt(tasks).trimEnd() : "";
  const todayLabel = new Date().toLocaleDateString("en-US",
    { weekday:"long", month:"long", day:"numeric", year:"numeric" });
  const dayOfYear  = Math.floor((new Date() - new Date(new Date().getFullYear(),0,0)) / 86400000);
  const todayQuote = QUOTES[dayOfYear % QUOTES.length];

  const [apod, setApod]         = useState(null);
  const [apodError, setApodError] = useState(false);
  useEffect(() => {
    const cacheKey = `apod_${TODAY}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { try { setApod(JSON.parse(cached)); return; } catch {} }
    fetch(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&date=${TODAY}`)
      .then(r => r.json())
      .then(data => {
        if (data.media_type === "image") {
          setApod(data); localStorage.setItem(cacheKey, JSON.stringify(data));
        } else {
          return fetch(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=8`)
            .then(r => r.json())
            .then(arr => {
              const photo = arr.find(d => d.media_type === "image");
              if (photo) { setApod(photo); localStorage.setItem(cacheKey, JSON.stringify(photo)); }
              else setApodError(true);
            });
        }
      }).catch(() => setApodError(true));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
      minHeight:"100vh", width:"100%", background:"#f2ede4", color:"#1e1810", overflowX:"hidden" }}>
      <style>{`
        * { box-sizing: border-box; }
        body, html { margin:0; padding:0; width:100%; }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadein { from{opacity:0} to{opacity:1} }
        @keyframes slideup { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
        .app-layout { display:flex; min-height:100vh; width:100vw; align-items:stretch; }
        .task-col { flex:1; min-width:0; overflow-x:hidden; }
        .task-col-inner { width:100%; padding-left:24px; padding-right:24px; box-sizing:border-box; }
        .photo-col { display:none; }
        @media (min-width:1100px) {
          .photo-col { display:flex; flex-direction:column; width:340px; min-width:340px; flex-shrink:0;
            position:sticky; top:0; height:100vh; overflow:hidden; }
        }
        @media (max-width:639px) {
          .week-grid { display:none !important; }
          .week-stack { display:flex !important; flex-direction:column; gap:8px; }
          .nodue-grid { display:none !important; }
          .nodue-stack { display:block !important; }
        }
        @media (min-width:640px) {
          .week-grid { display:grid !important; grid-template-columns:repeat(7,1fr); gap:8px; }
          .week-stack { display:none !important; }
          .nodue-grid { display:flex !important; }
          .nodue-stack { display:none !important; }
        }
        input, textarea, select {
          color:#1e1810 !important;
          -webkit-text-fill-color:#1e1810 !important;
        }
        input::placeholder, textarea::placeholder {
          color:#9a8a78 !important;
          -webkit-text-fill-color:#9a8a78 !important;
          opacity:1;
        }
        .task-row-focused { outline:2px solid #b07010 !important; outline-offset:-2px; border-radius:4px; }
      `}</style>

      <div className="app-layout">
        <div className="task-col">

          {/* ── Header ── */}
          <div style={{ background:"#1e1810", color:"#f2ede4" }}>
            <div className="task-col-inner" style={{ padding:"20px 24px 0" }}>
              <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:12, paddingBottom:14 }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:"0.25em", textTransform:"uppercase", color:"#c8b89a", marginBottom:3, display:"flex", alignItems:"center", gap:6 }}>
                    <a href="https://blog.franklinplanner.com/wp-content/uploads/sites/2/2015/01/1412030-GO-Community-Spring-2015-Final.pdf"
                      target="_blank" rel="noreferrer"
                      style={{ color:"#e8d8b8", textDecoration:"none", borderBottom:"1px solid #8a7060", letterSpacing:"0.25em" }}>
                      Franklin Covey
                    </a>
                    <span style={{ color:"#8a7060" }}>+</span>
                    <a href="https://github.com/todotxt/todo.txt" target="_blank" rel="noreferrer"
                      style={{ color:"#e8d8b8", textDecoration:"none", borderBottom:"1px solid #8a7060", letterSpacing:"0.25em" }}>
                      todo.txt
                    </a>
                  </div>
                  <h1 style={{ margin:0, fontSize:24, fontWeight:"normal" }}>Daily Task Planner</h1>
                  <div style={{ fontSize:12, color:"#c8b89a", marginTop:2 }}>{todayLabel}</div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                  {dbxConnected ? (
                    <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:11,
                      color: dbxStatus==="error" ? "#e07070" : dbxStatus==="saving" ? "#e8c97a" : "#7ec8a0" }}>
                      <span style={{ width:7, height:7, borderRadius:"50%", display:"inline-block",
                        background: dbxStatus==="error" ? "#e07070" : dbxStatus==="saving" ? "#e8c97a" : "#7ec8a0",
                        animation: dbxStatus==="saving" ? "pulse 1s infinite" : "none" }} />
                      {dbxStatus==="loading" ? "Loading…" : dbxStatus==="saving" ? "Saving…"
                        : dbxStatus==="error" ? "Sync error" : "Dropbox live"}
                    </span>
                  ) : (
                    saveMsg && <span style={{ fontSize:11, color:"#7ec8a0" }}>{saveMsg}</span>
                  )}
                  {dbxConnected
                    ? <HBtn onClick={disconnectDropbox}>⏏ Disconnect</HBtn>
                    : <>
                        <HBtn onClick={startDropboxAuth}>🔗 Connect Dropbox</HBtn>
                        {!isMobile && <HBtn onClick={openFile}>📂 Open</HBtn>}
                        {!isMobile && <HBtn onClick={saveFile}>{fileHandle ? "💾 Save" : "⬇ Download"}</HBtn>}
                      </>
                  }
                  <HBtn onClick={startPlanningMode}>📋 Plan My Day</HBtn>
                  <HBtn onClick={() => setShowDone(!showDone)}>
                    {showDone ? "Hide Done" : `Done (${(tasks||[]).filter(t=>t.done).length})`}
                  </HBtn>
                  <HBtn onClick={() => setShowExport(!showExport)}>View todo.txt</HBtn>
                  <button onClick={() => setShowHelp(true)} title="Help" style={{
                    background:"none", border:"1px solid #3a2e20", borderRadius:"50%",
                    color:"#8a7060", cursor:"pointer", width:26, height:26, fontSize:13,
                    fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, lineHeight:1
                  }}>?</button>
                </div>
              </div>

              {/* FEAT-02: Search bar */}
              <div style={{ paddingBottom:10, display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ position:"relative", flex:1, maxWidth:340 }}>
                  <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)",
                    color:"#6a5040", fontSize:13, pointerEvents:"none" }}>⌕</span>
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="Search tasks… ( / )"
                    style={{ width:"100%", background:"#2e2010", border:`1px solid ${searchFocused ? "#c8b89a" : "#3a2e20"}`,
                      borderRadius:6, padding:"6px 28px 6px 28px", fontSize:12, color:"#f2ede4",
                      fontFamily:"inherit", outline:"none", transition:"border-color 0.15s" }}
                  />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(""); searchRef.current?.blur(); }}
                      style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                        background:"none", border:"none", color:"#6a5040", cursor:"pointer", fontSize:14, lineHeight:1, padding:0 }}>✕</button>
                  )}
                </div>
                {searchQuery && (
                  <span style={{ fontSize:11, color:"#8a7060" }}>
                    {visibleActive.length + doneTasks.length} result{visibleActive.length + doneTasks.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display:"flex", borderTop:"1px solid #2e2010" }}>
                {[
                  ["daily",   "📋 Today"],
                  ["weekly",  "📅 Week Ahead"],
                  ["someday", `💭 Someday/Maybe${somedayTasks.length > 0 ? ` (${somedayTasks.length})` : ""}`],
                ].map(([v,label]) => (
                  <button key={v} onClick={() => setView(v)} style={{
                    background: view===v ? "#f2ede4" : "transparent",
                    color: view===v ? "#1e1810" : "#a89070",
                    border:"none", cursor:"pointer", padding:"9px 18px", fontSize:11,
                    letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"inherit",
                    borderRadius:"4px 4px 0 0",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Filter bar */}
            {(allCtx.length > 0 || allProj.length > 0) && (
              <div style={{ background:"#160e08", borderTop:"1px solid #2e2010" }}>
                <div className="task-col-inner" style={{ padding:"6px 24px", display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ fontSize:10, color:"#8a7060", letterSpacing:"0.15em", textTransform:"uppercase", marginRight:4 }}>Filter</span>
                  {allCtx.map(c => (
                    <Chip key={c} label={`@${c}`} active={filterCtx===c} color="#7ec8a0"
                      onClick={() => setFilterCtx(filterCtx===c ? null : c)} />
                  ))}
                  {allProj.map(p => (
                    <Chip key={p} label={`+${p}`} active={filterProj===p} color="#7ab8e8"
                      onClick={() => setFilterProj(filterProj===p ? null : p)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Main content ── */}
          <div className="task-col-inner" style={{ padding:"22px 24px 80px", flex:1 }}>

            {/* Loading skeleton */}
            {tasks === null && (
              <div style={{ opacity:0.5 }}>
                {["A","B","C"].map(p => (
                  <div key={p} style={{ marginBottom:16 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <div style={{ width:22, height:22, borderRadius:"50%", background:"#d8d0c4" }} />
                      <div style={{ width:120, height:12, borderRadius:4, background:"#d8d0c4" }} />
                    </div>
                    <div style={{ background:"#ede8de", border:"1px solid #d8d0c4", borderRadius:6, padding:"10px 14px" }}>
                      {[80,55,70].map((w,i) => (
                        <div key={i} style={{ display:"flex", alignItems:"center", gap:10,
                          padding:"8px 0", borderTop: i>0 ? "1px solid #d8d0c4" : "none" }}>
                          <div style={{ width:16, height:16, borderRadius:3, background:"#d8d0c4", flexShrink:0 }} />
                          <div style={{ height:12, borderRadius:4, background:"#d8d0c4", width:`${w}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Export panel */}
            {showExport && (
              <div style={{ background:"#1e1810", borderRadius:6, padding:16, marginBottom:20 }}>
                <div style={{ fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#6a5040", marginBottom:8 }}>todo.txt</div>
                <pre style={{ margin:0, fontSize:11, color:"#c8b89a", lineHeight:1.8, whiteSpace:"pre-wrap", wordBreak:"break-all", fontFamily:"monospace" }}>{exportTxt}</pre>
                <button onClick={() => navigator.clipboard?.writeText(exportTxt)}
                  style={{ marginTop:10, background:"#2e2010", color:"#c8b89a", border:"none", borderRadius:4,
                    padding:"5px 12px", cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>
                  Copy to Clipboard
                </button>
              </div>
            )}

            {/* ── DAILY VIEW ── */}
            {view === "daily" && tasks !== null && (
              <>
                {/* Reschedule modal */}
                {reschedulePrompt && (
                  <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:100,
                    display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <div style={{ background:"#fdf6ed", border:"2px solid #ddc898", borderRadius:8,
                      padding:24, maxWidth:380, width:"90%", boxShadow:"0 8px 32px rgba(0,0,0,0.25)" }}>
                      <div style={{ fontSize:12, letterSpacing:"0.1em", textTransform:"uppercase", color:"#b07010", marginBottom:6 }}>Reschedule Recurring Task</div>
                      <div style={{ fontSize:14, color:"#1e1810", marginBottom:16, lineHeight:1.5 }}>
                        {(tasks||[]).find(t => t.id === reschedulePrompt.id)?.cleanText}
                      </div>
                      <div style={{ fontSize:12, color:"#7a5a30", marginBottom:8 }}>
                        New due date — reanchors the recurrence chain from this date forward:
                      </div>
                      <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
                        style={{ ...mini, fontSize:14, padding:"7px 10px", marginBottom:16, display:"block" }} />
                      <div style={{ display:"flex", gap:8 }}>
                        <SBtn onClick={confirmReschedule} color="#b07010">Confirm Reschedule</SBtn>
                        <SBtn onClick={() => { setReschedulePrompt(null); setRescheduleDate(""); }} color="#aaa">Cancel</SBtn>
                      </div>
                    </div>
                  </div>
                )}

                {/* Groups */}
                {["A","B","C","?"].map(p => (
                  <Group key={p} priority={p} meta={PMETA[p]} tasks={groups[p]||[]}
                    addingFor={addingFor} setAddingFor={setAddingFor}
                    form={form} setForm={setForm} onAdd={addTask}
                    editingId={editingId} setEditingId={setEditingId}
                    onToggle={toggleDone} onToggleInProgress={toggleInProgress}
                    onDelete={deleteTask} onSaveEdit={saveEdit}
                    dragId={dragId} dragOverId={dragOverId}
                    dragOverGroup={dragOverGroup} setDragOverGroup={setDragOverGroup}
                    setDragId={setDragId} setDragOverId={setDragOverId}
                    onDrop={onDrop} onDropGroup={onDropGroup}
                    onTouchDragStart={handleTouchDragStart}
                    onTouchDragMove={handleTouchDragMove}
                    onTouchDragEnd={handleTouchDragEnd}
                    allProjects={allProj} allContexts={allCtx}
                    focusedTaskId={focusedTaskId} setFocusedTaskId={setFocusedTaskId}
                    searchQuery={q}
                  />
                ))}

                {/* Done section */}
                {showDone && doneTasks.length > 0 && (
                  <div style={{ marginTop:28 }}>
                    <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:"#999", marginBottom:6 }}>
                      ✓ Completed ({doneTasks.length})
                    </div>
                    <div style={{ background:"#ede8de", border:"1px solid #ccc8be", borderRadius:6, overflow:"hidden" }}>
                      {doneTasks.map((task, idx) => (
                        <Row key={task.id} task={task} idx={idx}
                          meta={{ accent:"#aaa", bg:"#ede8de", border:"#ccc8be", dot:"#aaa" }}
                          groupPriority={null}
                          editingId={editingId} setEditingId={setEditingId}
                          onToggle={() => toggleDone(task.id)}
                          onToggleInProgress={() => toggleInProgress(task.id)}
                          onDelete={() => deleteTask(task.id)}
                          onSaveEdit={raw => saveEdit(task.id, raw)}
                          onCancelEdit={() => setEditingId(null)}
                          dragId={null} dragOverId={null}
                          onDragStart={()=>{}} onDragOver={()=>{}} onDrop={()=>{}}
                          allProjects={allProj} allContexts={allCtx}
                          focusedTaskId={focusedTaskId} setFocusedTaskId={setFocusedTaskId}
                          searchQuery={q}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── WEEKLY VIEW ── */}
            {view === "weekly" && tasks !== null && (
              <>
                <div style={{ fontSize:12, color:"#8a7060", marginBottom:14 }}>
                  Tasks due in the next 7 days. Overdue tasks surface under today.
                </div>

                {/* Desktop 7-column grid */}
                <div className="week-grid">
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
                        <div style={{ fontSize:20, fontWeight:"normal", marginBottom:8, color: today ? "#f2ede4" : "#1e1810" }}>{fmtDayNum(date)}</div>
                        {dt.length === 0
                          ? <div style={{ fontSize:11, color: today ? "#3a2e20" : "#bbb", fontStyle:"italic" }}>—</div>
                          : dt.map(task => {
                              const m = PMETA[effectivePriority(task)] || PMETA[task.priority] || PMETA["?"];
                              return (
                                <div key={task.id} style={{ marginBottom:5 }}>
                                  <div style={{ display:"flex", alignItems:"flex-start", gap:5 }}>
                                    <span style={{ width:6, height:6, borderRadius:"50%", background:m.dot, flexShrink:0, marginTop:4 }} />
                                    <span style={{ fontSize:11, lineHeight:1.35, color: today ? "#c8b89a" : "#3a2e22" }}>
                                      {task.cleanText}
                                    </span>
                                  </div>
                                  {task.inProgress && <div style={{ fontSize:9, color:"#fff", background:"#b07010", borderRadius:3, padding:"1px 5px", marginLeft:11, display:"inline-block", marginTop:2 }}>▶ in progress</div>}
                                  {task.recurrence && <div style={{ fontSize:9, color: today ? "#5a4030" : "#bbb", marginLeft:11 }}>↺ {task.recurrence}</div>}
                                </div>
                              );
                            })}
                      </div>
                    );
                  })}
                </div>

                {/* Mobile stack */}
                <div className="week-stack">
                  {weekDays.map(date => {
                    const dt = dayTasks(date);
                    const today = date === TODAY;
                    const fullDate = new Date(date + "T12:00:00").toLocaleDateString("en-US",
                      { weekday:"long", month:"long", day:"numeric" });
                    return (
                      <div key={date} style={{ background: today ? "#1e1810" : "#ede8de",
                        border: today ? "2px solid #b33020" : "1px solid #ccc8be", borderRadius:8, overflow:"hidden" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
                          borderBottom: dt.length > 0 ? `1px solid ${today ? "#2e2010" : "#ccc8be"}` : "none",
                          background: today ? "#2e2010" : "#e0d8cc" }}>
                          <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0,
                            background: today ? "#b33020" : "#c8bfb0",
                            display:"flex", alignItems:"center", justifyContent:"center",
                            fontSize:18, fontWeight:"normal", color: today ? "#fff" : "#5a4a38" }}>
                            {fmtDayNum(date)}
                          </div>
                          <div>
                            <div style={{ fontSize:13, color: today ? "#f2ede4" : "#1e1810", lineHeight:1.2 }}>{fullDate.split(",")[0]}</div>
                            <div style={{ fontSize:11, color:"#8a7060" }}>{fullDate.split(",").slice(1).join(",").trim()}</div>
                          </div>
                          <div style={{ marginLeft:"auto", fontSize:11, color: today ? "#6a5040" : "#aaa", fontStyle: dt.length===0 ? "italic" : "normal" }}>
                            {dt.length===0 ? "nothing due" : `${dt.length} task${dt.length>1?"s":""}`}
                          </div>
                        </div>
                        {dt.length > 0 && (
                          <div style={{ padding:"8px 14px 10px" }}>
                            {dt.map(task => {
                              const m = PMETA[effectivePriority(task)] || PMETA[task.priority] || PMETA["?"];
                              return (
                                <div key={task.id} style={{ display:"flex", alignItems:"flex-start", gap:10,
                                  padding:"7px 0", borderBottom:`1px solid ${today ? "#2e2010" : "#d8d0c4"}` }}>
                                  <span style={{ width:8, height:8, borderRadius:"50%", background:m.dot, flexShrink:0, marginTop:5 }} />
                                  <div style={{ flex:1 }}>
                                    <div style={{ fontSize:14, color: today ? "#f2ede4" : "#1e1810", lineHeight:1.4 }}>{task.cleanText}</div>
                                    <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:3 }}>
                                      <span style={{ fontSize:10, fontWeight:"bold", color:m.accent,
                                        background: today ? "#2e2010" : "#e8e2d8", padding:"1px 6px", borderRadius:3 }}>
                                        {effectivePriority(task) || task.priority || "?"}
                                      </span>
                                      {task.inProgress && <span style={{ fontSize:10, color:"#fff", background:"#b07010", borderRadius:3, padding:"1px 6px" }}>▶ in progress</span>}
                                      {task.recurrence && <span style={{ fontSize:10, color: today ? "#6a5040" : "#aaa" }}>↺ {task.recurrence}</span>}
                                      {task.projects.map(p => <span key={p} style={{ fontSize:10, fontFamily:"monospace", color:"#3558b0", background:"#e8f0fe", padding:"1px 5px", borderRadius:3 }}>+{p}</span>)}
                                      {task.contexts.map(c => <span key={c} style={{ fontSize:10, fontFamily:"monospace", color:"#2a7048", background:"#eef7f2", padding:"1px 5px", borderRadius:3 }}>@{c}</span>)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* No-due tasks */}
                {(tasks||[]).filter(t => !t.done && !t.dueDate).length > 0 && (
                  <div style={{ marginTop:24 }}>
                    <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:"#999", marginBottom:10 }}>No due date</div>
                    <div className="nodue-grid" style={{ flexWrap:"wrap", gap:6 }}>
                      {(tasks||[]).filter(t => !t.done && !t.dueDate).map(task => {
                        const m = PMETA[effectivePriority(task)] || PMETA[task.priority] || PMETA["?"];
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
                    <div className="nodue-stack" style={{ background:"#ede8de", border:"1px solid #ccc8be", borderRadius:8, overflow:"hidden" }}>
                      {(tasks||[]).filter(t => !t.done && !t.dueDate).map((task, idx) => {
                        const m = PMETA[effectivePriority(task)] || PMETA[task.priority] || PMETA["?"];
                        return (
                          <div key={task.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px",
                            borderTop: idx>0 ? "1px solid #d0c8bc" : "none" }}>
                            <div style={{ width:22, height:22, borderRadius:"50%", background:m.accent,
                              color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                              fontSize:11, fontWeight:"bold", flexShrink:0 }}>{task.priority||"?"}</div>
                            <span style={{ fontSize:14, color:"#1e1810", flex:1 }}>{task.cleanText}</span>
                            {task.projects.map(p => <span key={p} style={{ fontSize:10, fontFamily:"monospace", color:"#3558b0", background:"#e8f0fe", padding:"1px 5px", borderRadius:3 }}>+{p}</span>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── SOMEDAY/MAYBE VIEW ── */}
            {view === "someday" && tasks !== null && (
              <>
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:13, color:"#5a4a38", lineHeight:1.6, maxWidth:560, marginBottom:16 }}>
                    Tasks here have no due date and no priority pressure — things you might want to do someday,
                    but aren't committing to yet. Promote any to today's list when you're ready to act on it.
                  </div>

                  {/* Add to Someday form */}
                  {addingFor === "someday" ? (
                    <TaskForm
                      meta={PMETA["C"]} form={form} setForm={setForm}
                      onSubmit={() => {
                        if (!form.text.trim()) return;
                        const id = nextId.current++;
                        const parts = ["(C)", form.text.trim()];
                        if (form.project.trim()) parts.push(`+${form.project.trim()}`);
                        if (form.context.trim()) parts.push(`@${form.context.trim()}`);
                        // Intentionally no due date — that's the point of Someday
                        setTasks(prev => {
                          const maxSeq = prev.reduce((m, t) => Math.max(m, t.seq ?? 0), 0);
                          const parsed = parseTodoTxt(parts.join(" "), id);
                          return [...prev, { ...parsed, seq: maxSeq + 1 }];
                        });
                        setForm({ text:"", due:"", project:"", context:"", rec:"", inProgress:false });
                        setAddingFor(null);
                      }}
                      onCancel={() => setAddingFor(null)}
                      submitLabel="Add to Someday"
                      allProjects={allProj} allContexts={allCtx}
                    />
                  ) : (
                    <button onClick={() => setAddingFor("someday")}
                      style={{ display:"flex", alignItems:"center", gap:6, background:"#eef7f2",
                        border:"1px dashed #9ecfb5", borderRadius:6, padding:"8px 14px",
                        cursor:"pointer", fontSize:13, color:"#2a7048", fontFamily:"inherit" }}>
                      <span style={{ fontSize:18, lineHeight:1 }}>+</span> Add to Someday/Maybe
                    </button>
                  )}
                </div>

                {somedayTasks.length === 0 ? (
                  <div style={{ padding:"40px 0", textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>💭</div>
                    <div style={{ fontSize:15, color:"#8a7060", marginBottom:6 }}>
                      {searchQuery ? "No Someday tasks match your search." : "Your Someday/Maybe list is empty."}
                    </div>
                    {!searchQuery && (
                      <div style={{ fontSize:13, color:"#aaa", maxWidth:400, margin:"0 auto", lineHeight:1.6 }}>
                        Capture ideas, vague intentions, and "one day" goals here without the pressure of a deadline.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:10 }}>
                    {somedayTasks.map(task => {
                      const isEdit = editingId === task.id;
                      return (
                        <div key={task.id} style={{ background:"#fdf6ed", border:"1px solid #ddc898",
                          borderRadius:8, overflow:"hidden",
                          boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                          {isEdit ? (
                            <div style={{ padding:12 }}>
                              <TaskForm
                                meta={PMETA["C"]} form={(() => {
                                  // Inline edit form bootstrap — use task values if editForm not ready
                                  return {
                                    text: task.cleanText, due: task.dueDate||"",
                                    rec: task.recurrence||"",
                                    project: task.projects.join(" "),
                                    context: task.contexts.join(" "),
                                    inProgress: task.inProgress||false,
                                  };
                                })()}
                                setForm={() => {}}  // handled by Row's internal state
                                onSubmit={() => {}} onCancel={() => setEditingId(null)}
                                submitLabel="Save" allProjects={allProj} allContexts={allCtx}
                              />
                            </div>
                          ) : (
                            <>
                              <div style={{ padding:"12px 14px 8px" }}>
                                <div style={{ fontSize:14, color:"#1e1810", lineHeight:1.5, marginBottom:6,
                                  cursor:"pointer" }}
                                  onClick={() => setEditingId(task.id)}>
                                  {searchQuery ? highlight(task.cleanText, searchQuery) : task.cleanText}
                                </div>
                                {(task.projects.length > 0 || task.contexts.length > 0) && (
                                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                                    {task.projects.map(p => (
                                      <span key={p} style={{ fontSize:10, fontFamily:"monospace",
                                        color:"#3558b0", background:"#e8f0fe", padding:"1px 5px", borderRadius:3 }}>
                                        {searchQuery ? highlight(`+${p}`, searchQuery) : `+${p}`}
                                      </span>
                                    ))}
                                    {task.contexts.map(c => (
                                      <span key={c} style={{ fontSize:10, fontFamily:"monospace",
                                        color:"#2a7048", background:"#eef7f2", padding:"1px 5px", borderRadius:3 }}>
                                        {searchQuery ? highlight(`@${c}`, searchQuery) : `@${c}`}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div style={{ borderTop:"1px solid #e8d8b0", display:"flex", alignItems:"center", padding:"6px 10px", gap:6 }}>
                                <button onClick={() => promoteToDaily(task.id)}
                                  style={{ flex:1, background:"#2a7048", color:"#fff", border:"none",
                                    borderRadius:4, padding:"5px 8px", cursor:"pointer", fontSize:11,
                                    fontFamily:"inherit", textAlign:"center" }}>
                                  📋 Do Today
                                </button>
                                <button onClick={() => setEditingId(task.id)}
                                  style={{ background:"none", border:"1px solid #ddc898", borderRadius:4,
                                    padding:"5px 8px", cursor:"pointer", fontSize:11,
                                    color:"#8a7060", fontFamily:"inherit" }}>
                                  Edit
                                </button>
                                <button onClick={() => deleteTask(task.id)}
                                  style={{ background:"none", border:"none", cursor:"pointer",
                                    fontSize:14, color:"#ccc", padding:"0 4px" }} title="Delete">✕</button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Quote footer */}
            <div style={{ borderTop:"1px solid #d8d0c4", marginTop:32, padding:"20px 0 8px", textAlign:"center" }}>
              <div style={{ fontSize:14, fontStyle:"italic", color:"#5a4a38", lineHeight:1.6, maxWidth:560, margin:"0 auto" }}>
                "{todayQuote.text}"
              </div>
              <div style={{ fontSize:11, color:"#9a8a78", marginTop:6, letterSpacing:"0.08em" }}>— {todayQuote.author}</div>
            </div>
          </div>
        </div>

        {/* ── NASA APOD panel ── */}
        <div className="photo-col" style={{ background:"#111" }}>
          {apod ? (
            <>
              <img src={apod.url} alt={apod.title}
                style={{ width:"100%", height:"72vh", objectFit:"cover", display:"block", animation:"fadein 1s ease" }} />
              <div style={{ flex:1, padding:"16px 18px 20px", background:"#111", overflowY:"auto" }}>
                <div style={{ fontSize:10, letterSpacing:"0.18em", textTransform:"uppercase", color:"#a89878", marginBottom:5 }}>NASA · Astronomy Picture of the Day</div>
                <div style={{ fontSize:14, color:"#f2ede4", lineHeight:1.5, fontWeight:"normal", marginBottom:8 }}>{apod.title}</div>
                {apod.copyright && <div style={{ fontSize:10, color:"#a89878" }}>© {apod.copyright.replace("\n"," ")}</div>}
                <div style={{ fontSize:11, color:"#9a8a70", marginTop:8, lineHeight:1.6 }}>
                  {apod.explanation?.slice(0,200)}{apod.explanation?.length > 200 ? "…" : ""}
                </div>
                <a href={apod.hdurl||apod.url} target="_blank" rel="noreferrer"
                  style={{ display:"inline-block", marginTop:10, fontSize:10, color:"#c8b89a",
                    letterSpacing:"0.08em", textDecoration:"none", borderBottom:"1px solid #6a5040" }}>
                  View full image ↗
                </a>
              </div>
            </>
          ) : apodError ? (
            <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
              flexDirection:"column", gap:8, color:"#3a3020", padding:24, textAlign:"center" }}>
              <div style={{ fontSize:28 }}>🌌</div>
              <div style={{ fontSize:12, color:"#5a5040" }}>NASA photo unavailable today</div>
            </div>
          ) : (
            <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
              <div style={{ width:32, height:32, border:"2px solid #3a3020", borderTopColor:"#8a7060", borderRadius:"50%", animation:"pulse 1s infinite" }} />
              <div style={{ fontSize:11, color:"#3a3020", letterSpacing:"0.1em" }}>Loading…</div>
            </div>
          )}
        </div>
      </div>

      {/* ── FEAT-06: Undo toast ── */}
      {undoToast && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"#1e1810", color:"#f2ede4", borderRadius:8, padding:"10px 16px",
          display:"flex", alignItems:"center", gap:12, boxShadow:"0 4px 20px rgba(0,0,0,0.4)",
          zIndex:300, animation:"slideup 0.2s ease", fontSize:13, whiteSpace:"nowrap" }}>
          <span style={{ color:"#c8b89a" }}>{undoToast.msg}</span>
          <button onClick={doUndo} style={{ background:"#b07010", color:"#fff", border:"none",
            borderRadius:4, padding:"3px 10px", cursor:"pointer", fontSize:12, fontFamily:"inherit", fontWeight:"bold" }}>
            Undo
          </button>
          <button onClick={() => setUndoToast(null)} style={{ background:"none", border:"none",
            color:"#6a5040", cursor:"pointer", fontSize:16, lineHeight:1, padding:"0 2px" }}>✕</button>
        </div>
      )}

      {/* ── FEAT-12: Planning mode modal ── */}
      {planningMode && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:200,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fdf6ed", borderRadius:10, maxWidth:520, width:"100%",
            maxHeight:"85vh", overflowY:"auto", boxShadow:"0 16px 48px rgba(0,0,0,0.35)" }}>
            <div style={{ background:"#1e1810", color:"#f2ede4", padding:"18px 24px",
              borderRadius:"10px 10px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#6a5040", marginBottom:2 }}>Franklin Covey</div>
                <div style={{ fontSize:18, fontWeight:"normal" }}>
                  {planStep===0 ? "📋 Roll Over Incomplete Tasks"
                    : planStep===1 ? "↺ Review Recurring Tasks"
                    : "✓ Confirm Today's Priorities"}
                </div>
                <div style={{ fontSize:11, color:"#6a5040", marginTop:2 }}>Step {planStep+1} of 3</div>
              </div>
              <button onClick={() => setPlanningMode(false)} style={{ background:"none", border:"none",
                color:"#6a5040", fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>✕</button>
            </div>

            <div style={{ padding:"20px 24px" }}>
              {/* Step 0: Roll over overdue tasks */}
              {planStep === 0 && (
                <>
                  <p style={{ fontSize:13, color:"#5a4a38", marginTop:0, lineHeight:1.6 }}>
                    These tasks were due before today. For each one, decide: keep it on today's list, defer it, or drop it.
                  </p>
                  {planRolloverIds.length === 0 ? (
                    <div style={{ padding:"20px 0", textAlign:"center", color:"#8a7060", fontSize:14, fontStyle:"italic" }}>
                      ✓ No overdue tasks — you're caught up!
                    </div>
                  ) : (
                    planRolloverIds.map(id => {
                      const t = (tasks||[]).find(x => x.id === id);
                      if (!t) return null;
                      const m = PMETA[t.priority] || PMETA["?"];
                      return (
                        <div key={id} style={{ background:m.bg, border:`1px solid ${m.border}`,
                          borderRadius:6, padding:"12px 14px", marginBottom:8 }}>
                          <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                            <div style={{ width:20, height:20, borderRadius:"50%", background:m.accent,
                              color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                              fontSize:10, fontWeight:"bold", flexShrink:0, marginTop:1 }}>{t.priority||"?"}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:14, color:"#1e1810", lineHeight:1.4 }}>{t.cleanText}</div>
                              <div style={{ fontSize:11, color:"#9a8a78", marginTop:2 }}>Due: {fmtDate(t.dueDate)}</div>
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:6, marginTop:10 }}>
                            <SBtn onClick={() => planRolloverTask(id, "keep")}  color="#b33020">Keep (today)</SBtn>
                            <SBtn onClick={() => planRolloverTask(id, "defer")} color="#b07010">Defer (tomorrow)</SBtn>
                            <SBtn onClick={() => planRolloverTask(id, "drop")}  color="#999">Drop</SBtn>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
                    <SBtn onClick={advancePlanStep} color="#2a7048">Next →</SBtn>
                  </div>
                </>
              )}

              {/* Step 1: Review today's recurring tasks */}
              {planStep === 1 && (
                <>
                  <p style={{ fontSize:13, color:"#5a4a38", marginTop:0, lineHeight:1.6 }}>
                    These recurring tasks are due today or tomorrow. Review them before starting your day.
                  </p>
                  {(tasks||[]).filter(t => !t.done && t.priority === "R" &&
                    (effectivePriority(t) === "A" || effectivePriority(t) === "B")).length === 0 ? (
                    <div style={{ padding:"20px 0", textAlign:"center", color:"#8a7060", fontSize:14, fontStyle:"italic" }}>
                      No recurring tasks due today or tomorrow.
                    </div>
                  ) : (tasks||[]).filter(t => !t.done && t.priority === "R" &&
                    (effectivePriority(t) === "A" || effectivePriority(t) === "B")).map(t => {
                    const ep = effectivePriority(t);
                    const m = PMETA[ep] || PMETA["?"];
                    return (
                      <div key={t.id} style={{ background:m.bg, border:`1px solid ${m.border}`,
                        borderRadius:6, padding:"10px 14px", marginBottom:8,
                        display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:20, height:20, borderRadius:"50%", background:m.accent,
                          color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:10, fontWeight:"bold", flexShrink:0 }}>{ep}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13, color:"#1e1810" }}>{t.cleanText}</div>
                          <div style={{ fontSize:11, color:"#9a8a78", marginTop:1 }}>↺ {t.recurrence} · due {fmtDate(t.dueDate)}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:8 }}>
                    <SBtn onClick={() => setPlanStep(0)} color="#aaa">← Back</SBtn>
                    <SBtn onClick={advancePlanStep} color="#2a7048">Next →</SBtn>
                  </div>
                </>
              )}

              {/* Step 2: Confirm today's A priorities */}
              {planStep === 2 && (
                <>
                  <p style={{ fontSize:13, color:"#5a4a38", marginTop:0, lineHeight:1.6 }}>
                    These are your vital tasks for today. Are you happy with this list?
                    You can close this and adjust priorities by dragging or using keys 1–4.
                  </p>
                  {groups["A"].length === 0 ? (
                    <div style={{ padding:"16px 0", textAlign:"center", color:"#8a7060", fontSize:14, fontStyle:"italic" }}>
                      No A tasks yet — consider promoting your most important tasks.
                    </div>
                  ) : groups["A"].map((t, idx) => (
                    <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10,
                      padding:"10px 14px", background:"#fdf0ee", border:"1px solid #ddb5b0",
                      borderRadius:6, marginBottom:6 }}>
                      <div style={{ width:20, height:20, borderRadius:"50%", background:"#b33020",
                        color:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:10, fontWeight:"bold", flexShrink:0 }}>A{idx+1}</div>
                      <span style={{ fontSize:13, color:"#1e1810", flex:1 }}>{t.cleanText}</span>
                      {t.dueDate && <span style={{ fontSize:10, color:"#b33020", fontFamily:"monospace" }}>{fmtDate(t.dueDate)}</span>}
                    </div>
                  ))}
                  <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:8 }}>
                    <SBtn onClick={() => setPlanStep(1)} color="#aaa">← Back</SBtn>
                    <SBtn onClick={() => { setPlanningMode(false); setPlanStep(0); }} color="#b33020">Start My Day →</SBtn>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Help modal ── */}
      {showHelp && (
        <div onClick={() => setShowHelp(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fdf6ed", borderRadius:10,
            maxWidth:640, width:"100%", maxHeight:"88vh", overflowY:"auto",
            boxShadow:"0 16px 48px rgba(0,0,0,0.35)",
            fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif" }}>
            <div style={{ background:"#1e1810", color:"#f2ede4", padding:"18px 24px",
              borderRadius:"10px 10px 0 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase", color:"#6a5040", marginBottom:2 }}>Franklin Covey</div>
                <div style={{ fontSize:18, fontWeight:"normal" }}>Daily Task Planner — Help</div>
              </div>
              <button onClick={() => setShowHelp(false)} style={{ background:"none", border:"none",
                color:"#6a5040", fontSize:22, cursor:"pointer", lineHeight:1, padding:"0 4px" }}>✕</button>
            </div>

            <div style={{ padding:"24px 28px 28px" }}>

              <HelpSection title="Priority System">
                <p style={hp}>Tasks are grouped into four priority levels, following the Franklin Covey method:</p>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:10 }}>
                  {[
                    { p:"A", color:"#b33020", bg:"#fdf0ee", border:"#ddb5b0", desc:"Vital — must be done today. Critical, high-stakes tasks." },
                    { p:"B", color:"#b07010", bg:"#fdf6ed", border:"#ddc898", desc:"Important — should be done today, but won't cause a crisis if deferred." },
                    { p:"C", color:"#2a7048", bg:"#eef7f2", border:"#9ecfb5", desc:"Nice to Do — worth doing, but low consequence if skipped." },
                    { p:"R", color:"#3558b0", bg:"#eef2fb", border:"#9db5e0", desc:"Recurring — repeating tasks with a rec: tag. They surface automatically as A (due today) or B (due tomorrow) and stay hidden until then." },
                  ].map(({ p, color, bg, border, desc }) => (
                    <div key={p} style={{ display:"flex", gap:12, alignItems:"flex-start",
                      background:bg, border:`1px solid ${border}`, borderRadius:6, padding:"10px 14px" }}>
                      <div style={{ width:24, height:24, borderRadius:"50%", background:color, color:"#fff",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:12, fontWeight:"bold", flexShrink:0, marginTop:1 }}>{p}</div>
                      <div style={{ fontSize:13, color:"#2a1e10", lineHeight:1.5 }}>{desc}</div>
                    </div>
                  ))}
                </div>
                <p style={{ ...hp, marginTop:10 }}>Within each group, tasks due today or overdue sort to the top automatically. Drag to reorder within that.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Search">
                <p style={hp}>Press <Code>/</Code> anywhere to jump to the search bar. Type to filter tasks by description, project, context, or due date. Press <Code>Escape</Code> to clear.</p>
                <p style={hp}>Search matches are highlighted in yellow across all visible tasks and groups.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Keyboard Shortcuts">
                <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:"6px 16px", marginTop:8 }}>
                  {[
                    ["/",        "Focus search bar"],
                    ["Escape",   "Clear search / cancel edit"],
                    ["j / ↓",   "Move focus down"],
                    ["k / ↑",   "Move focus up"],
                    ["x",        "Toggle done on focused task"],
                    ["d",        "Delete focused task"],
                    ["e",        "Edit focused task"],
                    ["n",        "New task in A group"],
                    ["1",        "Set focused task priority → A"],
                    ["2",        "Set focused task priority → B"],
                    ["3",        "Set focused task priority → C"],
                    ["4",        "Remove priority (unsorted)"],
                  ].map(([key, desc]) => (
                    <><Code key={key+"-k"}>{key}</Code><span key={key+"-d"} style={{ fontSize:12, color:"#5a4a38", alignSelf:"center" }}>{desc}</span></>
                  ))}
                </div>
                <p style={{ ...hp, marginTop:10 }}>Keyboard shortcuts are inactive while typing in any input field or editing a task.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Undo">
                <p style={hp}>Completing or deleting a task shows an <strong>Undo</strong> toast at the bottom of the screen for 5 seconds. Click it to restore the previous state. The last 10 actions are kept in the undo stack.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Plan My Day">
                <p style={hp}>The <strong>📋 Plan My Day</strong> button opens a 3-step guided review:</p>
                <ul style={ul}>
                  <li style={li}><strong>Step 1 — Roll Over:</strong> For each overdue task, choose Keep (move to today), Defer (push to tomorrow), or Drop.</li>
                  <li style={li}><strong>Step 2 — Review Recurring:</strong> See all recurring tasks due today or tomorrow so nothing is overlooked.</li>
                  <li style={li}><strong>Step 3 — Confirm Priorities:</strong> Review your A tasks before starting the day.</li>
                </ul>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Someday / Maybe">
                <p style={hp}>The <strong>💭 Someday/Maybe</strong> tab holds tasks with no due date and no priority pressure — ideas, vague intentions, and "one day" goals you're not committing to yet. They don't appear in the daily list and have no deadline.</p>
                <ul style={ul}>
                  <li style={li}>Click <strong>+ Add to Someday/Maybe</strong> to capture a thought without scheduling it.</li>
                  <li style={li}>Click <strong>📋 Do Today</strong> on any card to move it to today's active list (sets due date to today, keeps C priority).</li>
                  <li style={li}>Click the task text to edit it inline, or ✕ to delete.</li>
                  <li style={li}>Tasks automatically graduate from Someday to the daily list when you give them a due date from the edit form.</li>
                </ul>
                <p style={hp}>A task with priority A or B, or a recurring task, will never appear in Someday — those always live in the daily list.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Drag to Reprioritize">
                <p style={hp}>Every task has a <Code>⠿</Code> drag handle on the left. You can:</p>
                <ul style={ul}>
                  <li style={li}><strong>Reorder within a group</strong> — drag a task up or down. The new order is saved to Dropbox via the <Code>seq:</Code> tag so it persists across devices.</li>
                  <li style={li}><strong>Move between groups</strong> — drag onto a different group's header or between tasks in another group. Priority letter updates automatically.</li>
                  <li style={li}><strong>Recurring tasks</strong> — dragging an R task to a new group opens a reschedule prompt. Enter a new due date to shift the recurrence chain forward.</li>
                  <li style={li}><strong>iOS touch drag</strong> — press and hold the <Code>⠿</Code> handle, then drag. Move slowly; the target row highlights as you hover over it. Release to drop.</li>
                </ul>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="todo.txt Format">
                <p style={hp}>Compatible with SwiftDo, vim, and the Obsidian todo.txt plugin. Each task is one line:</p>
                <div style={{ background:"#1e1810", borderRadius:6, padding:"12px 16px", margin:"12px 0" }}>
                  <pre style={{ margin:0, fontSize:12, color:"#c8b89a", lineHeight:2, fontFamily:"monospace", whiteSpace:"pre-wrap" }}>{
`(A) Task description +Project @context due:2026-03-07
(B) Another task +Work @computer
(R) Weekly standup due:2026-03-07 rec:1w +Work @computer
(A) Task hidden until ready t:2026-03-10 due:2026-03-15
x 2026-03-05 Task text pri:A`
                  }</pre>
                </div>
                <ul style={ul}>
                  <li style={li}><Code>(A)</Code> — priority letter in parentheses at the start</li>
                  <li style={li}><Code>+Project</Code> — project tag (no spaces)</li>
                  <li style={li}><Code>@context</Code> — context tag, e.g. @phone, @computer, @home</li>
                  <li style={li}><Code>due:YYYY-MM-DD</Code> — due date</li>
                  <li style={li}><Code>t:YYYY-MM-DD</Code> — threshold date: task is hidden until this date</li>
                  <li style={li}><Code>rec:1w</Code> — recurrence (see below)</li>
                  <li style={li}><Code>x 2026-03-05 … pri:A</Code> — completed tasks; priority preserved as <Code>pri:</Code> tag</li>
                </ul>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Threshold Dates (t:)">
                <p style={hp}>Add a <Code>t:</Code> tag to hide a task until a future date. The task exists in your file but won't appear in the daily or weekly view until the threshold date arrives. This is useful for tasks you've planned ahead but don't want cluttering today's list.</p>
                <p style={hp}>Example: <Code>t:2026-04-01 due:2026-04-07</Code> — the task becomes visible on April 1st, due April 7th.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Recurring Task Syntax">
                <p style={hp}>Add a <Code>rec:</Code> tag to make a task repeat. When checked off, the next occurrence is created automatically.</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 20px", marginTop:10 }}>
                  {[["rec:1d","Every day"],["rec:2d","Every 2 days"],["rec:1w","Every week"],
                    ["rec:2w","Every 2 weeks"],["rec:1m","Every month"],["rec:3m","Every 3 months"],
                    ["rec:1y","Every year"],["rec:1wd","Every weekday"]].map(([tag,desc]) => (
                    <div key={tag} style={{ display:"flex", gap:8, alignItems:"center", padding:"5px 0", borderBottom:"1px solid #e8e0d0" }}>
                      <Code>{tag}</Code><span style={{ fontSize:12, color:"#5a4a38" }}>{desc}</span>
                    </div>
                  ))}
                </div>
                <p style={{ ...hp, marginTop:12 }}>Recurring tasks use <Code>(R)</Code> in the file. The planner promotes them to <strong>A</strong> on their due date and <strong>B</strong> the day before.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Home Screen Badge (iOS)">
                <p style={hp}>To show a task count badge on the app icon when installed to your iPhone home screen, iOS requires notification permission — even though this app doesn't send notifications. Apple tied badge display to notification permission in iOS 16.4.</p>
                <p style={hp}>When you first open the app, it will request permission after a few seconds. Tap <strong>Allow</strong> to enable badges. If you tapped Don't Allow, go to <strong>Settings → [app name] → Notifications</strong> and turn on <strong>Allow Notifications</strong>. The badge shows the count of active tasks visible today.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Sink Contexts (@delegated, @waiting)">
                <p style={hp}>Tasks tagged <Code>@delegated</Code> or <Code>@waiting</Code> automatically sort to the bottom of their priority group, below all other tasks regardless of due date. This keeps them out of the way while still visible.</p>
                <ul style={ul}>
                  <li style={li}><Code>@delegated</Code> — you've handed this off; you're watching for completion.</li>
                  <li style={li}><Code>@waiting</Code> — you're blocked until someone else acts. (Dependency tracking for waiting tasks is on the future roadmap.)</li>
                </ul>
                <p style={hp}>Within the sink group, tasks still sort overdue → today → future → no date, so you'll notice if something becomes urgent.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Cross-Device Order (seq:)">
                <p style={hp}>When you drag to reorder, the app writes a <Code>seq:N</Code> tag to every task in the file. Other todo.txt apps silently ignore this tag. When you open the app on another device, it reads the seq numbers and restores your exact drag order — no manual resorting needed.</p>
              </HelpSection>

              <HelpDivider />

              <HelpSection title="Dropbox Setup & Reconnecting">
                <ul style={ul}>
                  <li style={li}>Click <strong>🔗 Connect Dropbox</strong> to authorize. You'll be redirected to Dropbox and back — this only happens once.</li>
                  <li style={li}>Your file at <Code>/Apps/Obsidian/v1/todo.todotxt</Code> loads on every visit and saves silently after each change (1.5s debounce).</li>
                  <li style={li}>Status dot: <span style={{ color:"#7ec8a0" }}>● live</span> · <span style={{ color:"#e8c97a" }}>● saving</span> · <span style={{ color:"#e07070" }}>● error</span>.</li>
                  <li style={li}>If you get a sync error, click <strong>⏏ Disconnect</strong> then reconnect to re-authorize.</li>
                  <li style={li}>Auth token is stored in localStorage — clearing browser data requires reconnecting.</li>
                </ul>
              </HelpSection>

            </div>

            <div style={{ padding:"14px 28px 20px", borderTop:"1px solid #e8e0d0", textAlign:"center" }}>
              <button onClick={() => setShowHelp(false)} style={{ background:"#1e1810", color:"#c8b89a",
                border:"none", borderRadius:4, padding:"8px 24px", cursor:"pointer", fontSize:13, fontFamily:"inherit" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group ────────────────────────────────────────────────────────────────────

function Group({ priority, meta, tasks, addingFor, setAddingFor, form, setForm, onAdd,
  editingId, setEditingId, onToggle, onToggleInProgress, onDelete, onSaveEdit,
  dragId, dragOverId, dragOverGroup, setDragOverGroup, setDragId, setDragOverId, onDrop, onDropGroup,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd,
  allProjects, allContexts, focusedTaskId, setFocusedTaskId, searchQuery }) {
  const headerIsTarget = dragOverGroup === priority;
  return (
    <div style={{ marginBottom:16 }}>
      <div
        data-group={priority}
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
            {priority==="?" ? "?" : priority}
          </div>
          <span style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:meta.accent }}>{meta.label}</span>
          <span style={{ fontSize:11, color:"#aaa", background:"#e5e0d5", borderRadius:10, padding:"1px 7px" }}>{tasks.length}</span>
          {headerIsTarget && <span style={{ fontSize:10, color:meta.accent, fontStyle:"italic" }}>Drop to reprioritize →</span>}
        </div>
        <button onClick={() => setAddingFor(addingFor===priority ? null : priority)}
          style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:meta.accent,
            lineHeight:1, padding:"0 6px", fontFamily:"inherit" }}>+</button>
      </div>

      {addingFor === priority && (
        <TaskForm meta={meta} form={form} setForm={setForm}
          onSubmit={() => onAdd(priority)} onCancel={() => setAddingFor(null)}
          submitLabel="Add" allProjects={allProjects} allContexts={allContexts} />
      )}

      <div style={{ background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:6, overflow:"hidden" }}>
        {tasks.length === 0
          ? <div style={{ padding:"12px 16px", fontSize:13, color:"#ccc", fontStyle:"italic" }}>No tasks</div>
          : tasks.map((task, idx) => (
              <Row key={task.id} task={task} idx={idx} meta={meta} groupPriority={priority}
                editingId={editingId} setEditingId={setEditingId}
                onToggle={() => onToggle(task.id)}
                onToggleInProgress={() => onToggleInProgress(task.id)}
                onDelete={() => onDelete(task.id)}
                onSaveEdit={raw => onSaveEdit(task.id, raw)}
                onCancelEdit={() => setEditingId(null)}
                dragId={dragId} dragOverId={dragOverId}
                onDragStart={() => setDragId(task.id)}
                onDragOver={() => setDragOverId(task.id)}
                onDrop={() => onDrop(task.id)}
                onTouchDragStart={onTouchDragStart}
                onTouchDragMove={onTouchDragMove}
                onTouchDragEnd={onTouchDragEnd}
                allProjects={allProjects} allContexts={allContexts}
                focusedTaskId={focusedTaskId} setFocusedTaskId={setFocusedTaskId}
                searchQuery={searchQuery}
              />
            ))}
      </div>
    </div>
  );
}

// ─── TaskForm ─────────────────────────────────────────────────────────────────

function TaskForm({ meta, form, setForm, onSubmit, onCancel, submitLabel, allProjects, allContexts }) {
  const toggleTag = (field, val) => {
    const cur = (form[field]||"").split(" ").filter(Boolean);
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    setForm(f => ({ ...f, [field]: next.join(" ") }));
  };
  const selProj = (form.project||"").split(" ").filter(Boolean);
  const selCtx  = (form.context||"").split(" ").filter(Boolean);

  return (
    <div style={{ background: meta?.bg||"#f5f0e8", border:`1px solid ${meta?.border||"#ddd"}`,
      borderRadius:6, padding:14, marginBottom:8 }}>
      <input value={form.text} onChange={e => setForm(f => ({...f, text:e.target.value}))}
        onKeyDown={e => { if (e.key==="Enter"&&!e.shiftKey) onSubmit(); if (e.key==="Escape") onCancel(); }}
        placeholder="Task description…" autoFocus
        style={{ width:"100%", border:`1px solid ${meta?.border||"#ddd"}`, borderRadius:4,
          padding:"7px 10px", fontSize:14, fontFamily:"inherit", background:"#fff",
          color:"#1e1810", boxSizing:"border-box", marginBottom:10 }} />
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"#8a7060" }}>Due date</span>
          <input value={form.due} type="date" onChange={e => setForm(f => ({...f, due:e.target.value}))}
            style={{ ...mini, color:"#1e1810" }} />
        </label>
        <label style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <span style={{ fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"#8a7060" }}>Recurrence</span>
          <input value={form.rec} onChange={e => setForm(f => ({...f, rec:e.target.value}))}
            placeholder="e.g. 1w, 1m" style={{ ...mini, width:90, color:"#1e1810" }} />
        </label>
      </div>
      <div style={{ marginBottom:8 }}>
        <div style={{ fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"#8a7060", marginBottom:5 }}>+Projects</div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
          {allProjects.map(p => (
            <button key={p} onClick={() => toggleTag("project", p)}
              style={{ fontSize:11, fontFamily:"monospace", padding:"2px 8px", borderRadius:12, border:"1px solid", cursor:"pointer",
                background: selProj.includes(p) ? "#3558b0" : "#e8f0fe",
                color:       selProj.includes(p) ? "#fff" : "#3558b0",
                borderColor: selProj.includes(p) ? "#3558b0" : "#b8d0f0" }}>+{p}</button>
          ))}
          <input value={form.project} onChange={e => setForm(f => ({...f, project:e.target.value}))}
            placeholder="New project…" style={{ ...mini, fontFamily:"monospace", width:120, fontSize:11, color:"#1e1810" }} />
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"#8a7060", marginBottom:5 }}>@Contexts</div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
          {allContexts.map(c => (
            <button key={c} onClick={() => toggleTag("context", c)}
              style={{ fontSize:11, fontFamily:"monospace", padding:"2px 8px", borderRadius:12, border:"1px solid", cursor:"pointer",
                background: selCtx.includes(c) ? "#2a7048" : "#eef7f2",
                color:       selCtx.includes(c) ? "#fff" : "#2a7048",
                borderColor: selCtx.includes(c) ? "#2a7048" : "#9ecfb5" }}>@{c}</button>
          ))}
          <input value={form.context} onChange={e => setForm(f => ({...f, context:e.target.value}))}
            placeholder="New context…" style={{ ...mini, fontFamily:"monospace", width:120, fontSize:11, color:"#1e1810" }} />
        </div>
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:12 }}>
        <div onClick={() => setForm(f => ({...f, inProgress:!f.inProgress}))}
          style={{ cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:16, height:16, borderRadius:3, border:"2px solid",
            borderColor: form.inProgress ? "#b07010" : "#bbb",
            background:  form.inProgress ? "#b07010" : "transparent",
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            {form.inProgress && <span style={{ color:"#fff", fontSize:11, lineHeight:1 }}>▶</span>}
          </div>
          <span style={{ fontSize:12, color:"#5a4a38" }}>Mark as in progress</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:6 }}>
        <SBtn onClick={onSubmit} color={meta?.accent||"#888"}>{submitLabel}</SBtn>
        <SBtn onClick={onCancel} color="#aaa">Cancel</SBtn>
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function Row({ task, idx, meta, groupPriority, editingId, setEditingId,
  onToggle, onToggleInProgress, onDelete, onSaveEdit, onCancelEdit,
  dragId, dragOverId, onDragStart, onDragOver, onDrop,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd,
  allProjects, allContexts, focusedTaskId, setFocusedTaskId, searchQuery }) {
  const isEditing  = editingId === task.id;
  const isFocused  = focusedTaskId === task.id;
  const overdue    = task.dueDate && task.dueDate < TODAY && !task.done;
  const dueToday   = task.dueDate === TODAY && !task.done;

  // BUG-06: Proper touch drag — attach touchmove to window while dragging this row
  const isTouchDragging = useRef(false);
  function handleTouchStart(e) {
    isTouchDragging.current = true;
    onTouchDragStart(task.id, e);
    // Attach move listener globally so it tracks finger even outside this element
    window.addEventListener("touchmove", handleGlobalTouchMove, { passive: false });
    window.addEventListener("touchend",  handleGlobalTouchEnd,  { once: true });
  }
  function handleGlobalTouchMove(e) {
    e.preventDefault(); // prevent page scroll while dragging
    onTouchDragMove(e);
  }
  function handleGlobalTouchEnd() {
    isTouchDragging.current = false;
    window.removeEventListener("touchmove", handleGlobalTouchMove);
    onTouchDragEnd();
  }

  const [editForm, setEditForm] = useState(null);
  useEffect(() => {
    if (isEditing && !editForm) {
      setEditForm({ text: task.cleanText, due: task.dueDate||"", rec: task.recurrence||"",
        project: task.projects.join(" "), context: task.contexts.join(" "), inProgress: task.inProgress||false });
    }
    if (!isEditing) setEditForm(null);
  }, [isEditing]);

  function submitEdit() {
    if (!editForm) return;
    const hasRec = !!editForm.rec.trim();
    const assignedPriority = hasRec ? "R" : (task.priority || "C");
    const parts = [`(${assignedPriority})`, editForm.text.trim()];
    editForm.project.trim().split(" ").filter(Boolean).forEach(p => parts.push(`+${p}`));
    editForm.context.trim().split(" ").filter(Boolean).forEach(c => parts.push(`@${c}`));
    if (editForm.due)        parts.push(`due:${editForm.due}`);
    if (editForm.rec.trim()) parts.push(`rec:${editForm.rec.trim()}`);
    if (editForm.inProgress) parts.push(`status:inprogress`);
    onSaveEdit(parts.join(" "));
  }

  return (
    <div draggable={!isEditing}
      data-taskid={task.id}
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver(); }}
      onDrop={onDrop}
      onClick={() => setFocusedTaskId(task.id)}
      className={isFocused ? "task-row-focused" : ""}
      style={{ borderTop: idx>0 ? `1px solid ${meta.border}` : "none",
        background: dragOverId===task.id ? meta.border+"88" : "transparent",
        opacity: dragId===task.id ? 0.4 : 1 }}>
      {isEditing && editForm ? (
        <div style={{ padding:"10px 12px" }}>
          <div style={{ fontSize:11, color:"#8a7060", marginBottom:8, letterSpacing:"0.05em" }}>Editing task</div>
          <TaskForm meta={meta} form={editForm} setForm={setEditForm}
            onSubmit={submitEdit} onCancel={onCancelEdit}
            submitLabel="Save" allProjects={allProjects} allContexts={allContexts} />
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"flex-start", padding:"9px 12px", gap:8, transition:"background 0.1s" }}
          onMouseEnter={e => e.currentTarget.style.background = meta.border+"44"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          {/* Drag handle — onTouchStart fires only on the handle so accidental scrolls don't trigger drag */}
          <div
            onTouchStart={handleTouchStart}
            style={{ color:"#ccc", fontSize:11, paddingTop:3, cursor:"grab", userSelect:"none", flexShrink:0, touchAction:"none" }}>⠿</div>
          <div style={{ minWidth:24, textAlign:"center", fontSize:11, fontWeight:"bold",
            color: task.done ? "#bbb" : meta.accent, paddingTop:3, flexShrink:0 }}>
            {task.done ? "✓" : `${groupPriority || effectivePriority(task) || task.priority || "?"}${idx+1}`}
          </div>
          <div onClick={onToggle} style={{ marginTop:3, flexShrink:0, cursor:"pointer",
            width:16, height:16, borderRadius:3,
            border: task.done ? `2px solid ${meta.accent}` : "2px solid #bbb",
            background: task.done ? meta.accent : "transparent",
            display:"flex", alignItems:"center", justifyContent:"center" }}>
            {task.done && <span style={{ color:"#fff", fontSize:11, lineHeight:1 }}>✓</span>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div onClick={() => setEditingId(task.id)}
              style={{ fontSize:14, lineHeight:1.4, cursor:"pointer",
                textDecoration: task.done ? "line-through" : "none",
                color: task.done ? "#aaa" : "#1e1810" }}
              title="Click to edit">
              {searchQuery ? highlight(task.cleanText, searchQuery) : task.cleanText}
              {task.inProgress && !task.done && (
                <span style={{ marginLeft:7, fontSize:10, color:"#fff", background:"#b07010", borderRadius:3, padding:"1px 6px" }}>▶ in progress</span>
              )}
              {task.recurrence && !task.done && (
                <span style={{ marginLeft:7, fontSize:10, color:PMETA["R"].accent, opacity:0.75, background:"#eef2fb", borderRadius:3, padding:"1px 5px" }}>↺ rec</span>
              )}
            </div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:3 }}>
              {task.dueDate && (
                <span style={{ fontSize:10, fontFamily:"monospace", padding:"1px 5px", borderRadius:3,
                  background: overdue ? "#fde8e5" : dueToday ? "#fff3cd" : "#e8f0fe",
                  color:      overdue ? "#b33020" : dueToday ? "#856404" : "#3558b0",
                  border: `1px solid ${overdue ? "#f5c2bc" : dueToday ? "#ffc107" : "#b8d0f0"}` }}>
                  {overdue?"⚠ ":dueToday?"⏰ ":""}{fmtDate(task.dueDate)}
                </span>
              )}
              {task.projects.map(p => (
                <span key={p} style={{ fontSize:10, fontFamily:"monospace", color:"#3558b0", background:"#e8f0fe", padding:"1px 5px", borderRadius:3 }}>
                  {searchQuery ? highlight(`+${p}`, searchQuery) : `+${p}`}
                </span>
              ))}
              {task.contexts.map(c => (
                <span key={c} style={{ fontSize:10, fontFamily:"monospace", color:"#2a7048", background:"#eef7f2", padding:"1px 5px", borderRadius:3 }}>
                  {searchQuery ? highlight(`@${c}`, searchQuery) : `@${c}`}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0, alignItems:"center" }}>
            <button onClick={onToggleInProgress} title={task.inProgress ? "Clear in-progress" : "Mark in-progress"}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:13,
                color: task.inProgress ? "#b07010" : "#ddd", padding:"2px 4px" }}>▶</button>
            <button onClick={onDelete} title="Delete"
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:13,
                color:"#ddd", padding:"2px 4px" }}>✕</button>
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
    <button onClick={onClick} style={{ background:color||"#888", color:"#fff", border:"none",
      borderRadius:4, padding:"4px 10px", cursor:"pointer", fontSize:12, fontFamily:"inherit" }}>{children}</button>
  );
}
function Chip({ label, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{ fontSize:10, padding:"2px 8px", borderRadius:20,
      border:"1px solid", cursor:"pointer", fontFamily:"monospace",
      borderColor: active ? color : "#3a2810",
      background:  active ? color : "transparent",
      color:       active ? "#1e1810" : "#6a5040" }}>{label}</button>
  );
}

const mini = {
  fontSize:12, padding:"4px 8px", border:"1px solid #ddd",
  borderRadius:4, fontFamily:"monospace", background:"#fff", color:"#1e1810",
};

// ─── Help modal helpers ───────────────────────────────────────────────────────

function HelpSection({ title, children }) {
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ fontSize:13, fontWeight:"bold", letterSpacing:"0.05em", textTransform:"uppercase",
        color:"#1e1810", marginBottom:10, paddingBottom:4, borderBottom:"2px solid #e8e0d0" }}>
        {title}
      </div>
      {children}
    </div>
  );
}
function HelpDivider() { return <div style={{ margin:"20px 0" }} />; }
function Code({ children }) {
  return (
    <code style={{ background:"#e8e0d0", borderRadius:3, padding:"1px 5px",
      fontSize:11, fontFamily:"monospace", color:"#3a2810" }}>{children}</code>
  );
}

const hp = { fontSize:13, color:"#3a2e20", lineHeight:1.6, margin:"0 0 4px" };
const ul = { margin:"8px 0 0 0", paddingLeft:20 };
const li = { fontSize:13, color:"#3a2e20", lineHeight:1.7, marginBottom:2 };
