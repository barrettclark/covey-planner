// ─── todo.txt pure functions ──────────────────────────────────────────────────
//
// All functions here are pure (no DOM, no React, no side effects).
// Functions that compare against "today" accept an explicit `today` parameter
// (ISO date string, e.g. "2026-06-12") so callers control the date context
// and tests can pin to any date without mocking.

export function parseRecurrence(raw) {
  const m = raw.match(/rec:(\d+)(d|w|m|y|wd)|rec:(daily|weekly|monthly|yearly|weekday)/i);
  if (!m) return null;
  if (m[3]) {
    const map = { daily:"1d", weekly:"1w", monthly:"1m", yearly:"1y", weekday:"1wd" };
    return map[m[3].toLowerCase()];
  }
  return `${m[1]}${m[2]}`;
}

export function parseTodoTxt(raw, id) {
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

  const dueM    = raw.match(/due:(\d{4}-\d{2}-\d{2})/);
  const threshM = raw.match(/t:(\d{4}-\d{2}-\d{2})/);
  const seqM    = raw.match(/\bseq:(\d+)\b/);
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

export function taskToTxt(task) {
  let line = task.done ? `x ${task.completedDate || new Date().toISOString().split("T")[0]} ` : "";
  if (task.done) {
    const cleanedText = task.cleanText.replace(/\bpri:[A-Z]\b/g, "").replace(/\s+/g, " ").trim();
    line += task.priority ? `${cleanedText} pri:${task.priority}` : cleanedText;
  } else {
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

export function assignSeq(tasks) {
  let next = 1;
  tasks.forEach(t => { if (t.seq != null && t.seq >= next) next = t.seq + 1; });
  return tasks.map(t => t.seq != null ? t : { ...t, seq: next++ });
}

export function sortedTxt(tasks) {
  const withSeq = assignSeq(tasks);
  return withSeq.map(taskToTxt).sort((a, b) => {
    const aDone = a.startsWith("x "), bDone = b.startsWith("x ");
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aSeq = (a.match(/\bseq:(\d+)\b/) || [])[1];
    const bSeq = (b.match(/\bseq:(\d+)\b/) || [])[1];
    if (aSeq && bSeq) return parseInt(aSeq) - parseInt(bSeq);
    return a.localeCompare(b);
  }).join("\n") + "\n";
}

export function getToday() {
  return new Date().toISOString().split("T")[0];
}

export function advanceDate(from, rec) {
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

export function weekDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().split("T")[0];
  });
}

export function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

export function fmtWeekday(iso) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

export function fmtDayNum(iso) {
  return parseInt(iso.split("-")[2]);
}

// today: ISO date string passed by the caller (App.jsx passes its module-level TODAY)
export function effectivePriority(task, today) {
  if (task.priority !== "R") return task.priority;
  if (!task.dueDate) return "R";
  const tomorrow = advanceDate(today, "1d");
  if (task.dueDate <= today) return "A";
  if (task.dueDate === tomorrow) return "B";
  return null;
}

// today: ISO date string passed by the caller
export function dueSortKey(task, today) {
  if (!task.dueDate) return 3;
  if (task.dueDate < today) return 0;
  if (task.dueDate === today) return 1;
  return 2;
}
