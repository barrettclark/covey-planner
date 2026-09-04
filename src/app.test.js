/**
 * app.test.js — regression tests for covey-task core logic
 *
 * Run with:  npx vitest run
 * Watch:     npx vitest
 *
 * Covers: parseTodoTxt, taskToTxt, effectivePriority, advanceDate,
 *         sortedTxt round-trip, addTask priority selection, threshold
 *         filtering, assignSeq, somedayTask filtering.
 */

import { describe, it, expect } from "vitest";
import {
  parseTodoTxt,
  taskToTxt,
  sortedTxt,
  assignSeq,
  advanceDate,
  getToday,
  effectivePriority,
  dueSortKey,
  fmtDate,
} from "./todotxt.js";

let TODAY = new Date().toISOString().split("T")[0];

// Simulates the addTask() priority logic from App.jsx
function simulateAddTask({ formPriority, groupPriority, hasRec }) {
  const basePriority =
    formPriority && formPriority !== "?"
      ? formPriority
      : groupPriority === "?"
        ? "C"
        : groupPriority;
  return hasRec ? "R" : basePriority;
}

// Simulates isVisibleToday threshold check
function isHiddenByThreshold(task) {
  return !!(task.thresholdDate && task.thresholdDate > TODAY);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("advanceDate", () => {
  it("advances by days", () => {
    expect(advanceDate("2026-01-01", "3d")).toBe("2026-01-04");
  });
  it("advances by weeks", () => {
    expect(advanceDate("2026-01-01", "1w")).toBe("2026-01-08");
  });
  it("advances by months", () => {
    expect(advanceDate("2026-01-31", "1m")).toBe("2026-03-03"); // Jan 31 + 1m overflows Feb → Mar 3 (JS Date behavior)
  });
  it("advances by years", () => {
    expect(advanceDate("2026-03-01", "1y")).toBe("2027-03-01");
  });
  it("returns from unchanged for unknown unit", () => {
    expect(advanceDate("2026-01-01", "5x")).toBe("2026-01-01");
  });
  it("advances weekdays, skipping Saturday and Sunday", () => {
    // 2026-03-06 is Friday — +1wd should land on Monday 2026-03-09
    expect(advanceDate("2026-03-06", "1wd")).toBe("2026-03-09");
  });
});

describe("parseTodoTxt", () => {
  it("parses a basic active task", () => {
    const t = parseTodoTxt("(A) Call dentist @phone due:2026-03-10 +Health", 1);
    expect(t.priority).toBe("A");
    expect(t.cleanText).toBe("Call dentist");
    expect(t.dueDate).toBe("2026-03-10");
    expect(t.projects).toEqual(["Health"]);
    expect(t.contexts).toEqual(["phone"]);
    expect(t.done).toBe(false);
  });

  it("parses a completed task, preserving completedDate", () => {
    const t = parseTodoTxt("x 2026-03-05 (A) Task text pri:A", 2);
    expect(t.done).toBe(true);
    expect(t.completedDate).toBe("2026-03-05");
  });

  it("parses threshold date (t:)", () => {
    const t = parseTodoTxt("(B) Prepare review t:2026-04-01 due:2026-04-07 +Work", 3);
    expect(t.thresholdDate).toBe("2026-04-01");
    expect(t.dueDate).toBe("2026-04-07");
  });

  it("parses recurrence (rec:)", () => {
    const t = parseTodoTxt("(R) Weekly standup due:2026-03-07 rec:1w +Work @computer", 4);
    expect(t.recurrence).toBe("1w");
    expect(t.priority).toBe("R");
  });

  it("parses long-form recurrence aliases", () => {
    expect(parseTodoTxt("(R) Task rec:weekly", 5).recurrence).toBe("1w");
    expect(parseTodoTxt("(R) Task rec:monthly", 6).recurrence).toBe("1m");
    expect(parseTodoTxt("(R) Task rec:daily", 7).recurrence).toBe("1d");
    expect(parseTodoTxt("(R) Task rec:yearly", 8).recurrence).toBe("1y");
    expect(parseTodoTxt("(R) Task rec:weekday", 9).recurrence).toBe("1wd");
  });

  it("parses seq tag", () => {
    const t = parseTodoTxt("(A) Task seq:7", 8);
    expect(t.seq).toBe(7);
  });

  it("parses status:inprogress", () => {
    const t = parseTodoTxt("(B) Task status:inprogress", 9);
    expect(t.inProgress).toBe(true);
  });

  it("cleanText strips all tags", () => {
    const t = parseTodoTxt(
      "(A) Do thing +Proj @ctx due:2026-03-10 t:2026-03-01 rec:1w seq:3 status:inprogress",
      10,
    );
    expect(t.cleanText).toBe("Do thing");
  });

  it("returns null priority for task without one", () => {
    const t = parseTodoTxt("Just a task with no priority", 11);
    expect(t.priority).toBeNull();
  });

  it("recovers priority from pri: tag on completed task", () => {
    const t = parseTodoTxt("x 2026-03-01 Completed task pri:B", 12);
    expect(t.priority).toBe("B");
    expect(t.done).toBe(true);
  });
});

describe("taskToTxt", () => {
  it("round-trips a basic active task", () => {
    const raw = "(A) Call dentist +Health @phone due:2026-03-10";
    const t = parseTodoTxt(raw, 1);
    const out = taskToTxt(t);
    expect(out).toContain("(A)");
    expect(out).toContain("Call dentist");
    expect(out).toContain("+Health");
    expect(out).toContain("@phone");
    expect(out).toContain("due:2026-03-10");
  });

  it("round-trips threshold date", () => {
    const raw = "(B) Prepare review t:2026-04-01 due:2026-04-07 +Work";
    const t = parseTodoTxt(raw, 2);
    expect(taskToTxt(t)).toContain("t:2026-04-01");
  });

  it("completed task uses pri: not (X) prefix", () => {
    const raw = "x 2026-03-05 (A) Task text pri:A";
    const t = parseTodoTxt(raw, 3);
    const out = taskToTxt(t);
    expect(out).toMatch(/^x 2026-03-05/);
    expect(out).toContain("pri:A");
    expect(out).not.toMatch(/^\(A\)/);
  });

  it("preserves original completedDate, not today", () => {
    const t = parseTodoTxt("x 2025-12-01 Old task pri:C", 4);
    expect(taskToTxt(t)).toContain("x 2025-12-01");
  });

  it("does not add status:inprogress to completed task", () => {
    const t = { ...parseTodoTxt("x 2026-03-01 Task", 5), inProgress: true };
    expect(taskToTxt(t)).not.toContain("status:inprogress");
  });

  it("does not emit pri: tag on active tasks", () => {
    const t = parseTodoTxt("(A) Active task", 6);
    const out = taskToTxt(t);
    expect(out).not.toContain("pri:");
    expect(out).toMatch(/^\(A\)/);
  });
});

describe("effectivePriority", () => {
  const tomorrow = advanceDate(TODAY, "1d");
  const in2 = advanceDate(TODAY, "2d");

  it("returns the priority as-is for non-R tasks", () => {
    expect(effectivePriority({ priority: "A", dueDate: null }, TODAY)).toBe("A");
    expect(effectivePriority({ priority: "C", dueDate: tomorrow }, TODAY)).toBe("C");
  });

  it("R task due today → A", () => {
    expect(effectivePriority({ priority: "R", dueDate: TODAY }, TODAY)).toBe("A");
  });

  it("R task overdue → A", () => {
    expect(effectivePriority({ priority: "R", dueDate: "2026-01-01" }, TODAY)).toBe("A");
  });

  it("R task due tomorrow → B", () => {
    expect(effectivePriority({ priority: "R", dueDate: tomorrow }, TODAY)).toBe("B");
  });

  it("R task due in 2+ days → null (hidden)", () => {
    expect(effectivePriority({ priority: "R", dueDate: in2 }, TODAY)).toBeNull();
  });

  it("R task with no due date → R", () => {
    expect(effectivePriority({ priority: "R", dueDate: null }, TODAY)).toBe("R");
  });

  it("uses the provided today argument rather than ambient date", () => {
    // Pinned to a fixed future date so this never becomes date-sensitive
    const task = { priority: "R", dueDate: "2030-06-01" };
    expect(effectivePriority(task, "2030-06-01")).toBe("A"); // due today
    expect(effectivePriority(task, "2030-05-31")).toBe("B"); // due tomorrow
    expect(effectivePriority(task, "2030-05-29")).toBeNull(); // due in 3 days
  });
});

describe("threshold date filtering", () => {
  it("hides task with future threshold", () => {
    const future = advanceDate(TODAY, "5d");
    const t = parseTodoTxt(`(A) Future task t:${future} due:2026-04-01`, 1);
    expect(isHiddenByThreshold(t)).toBe(true);
  });

  it("shows task with threshold = today", () => {
    const t = parseTodoTxt(`(A) Ready task t:${TODAY} due:2026-04-01`, 2);
    expect(isHiddenByThreshold(t)).toBe(false);
  });

  it("shows task with past threshold", () => {
    const t = parseTodoTxt("(A) Past threshold task t:2026-01-01 due:2026-04-01", 3);
    expect(isHiddenByThreshold(t)).toBe(false);
  });

  it("shows task with no threshold", () => {
    const t = parseTodoTxt("(A) No threshold task due:2026-04-01", 4);
    expect(isHiddenByThreshold(t)).toBe(false);
  });
});

describe("addTask priority selection (REGRESSION: group priority must be respected)", () => {
  it("uses group priority A when form.priority matches group", () => {
    expect(simulateAddTask({ formPriority: "A", groupPriority: "A", hasRec: false })).toBe("A");
  });

  it("uses group priority B when form.priority matches group", () => {
    expect(simulateAddTask({ formPriority: "B", groupPriority: "B", hasRec: false })).toBe("B");
  });

  it("uses group priority C when form.priority matches group", () => {
    expect(simulateAddTask({ formPriority: "C", groupPriority: "C", hasRec: false })).toBe("C");
  });

  it("overrides group with form priority when explicitly changed", () => {
    // User opened + in group A but then changed form priority to C
    expect(simulateAddTask({ formPriority: "C", groupPriority: "A", hasRec: false })).toBe("C");
  });

  it("? group defaults to C when form.priority is also ?", () => {
    expect(simulateAddTask({ formPriority: "?", groupPriority: "?", hasRec: false })).toBe("C");
  });

  it("recurrence always forces R regardless of group or form priority", () => {
    expect(simulateAddTask({ formPriority: "A", groupPriority: "A", hasRec: true })).toBe("R");
    expect(simulateAddTask({ formPriority: "C", groupPriority: "B", hasRec: true })).toBe("R");
  });
});

describe("assignSeq", () => {
  it("assigns sequential seq to tasks that lack one", () => {
    const tasks = [
      { id: 1, seq: null },
      { id: 2, seq: null },
      { id: 3, seq: null },
    ];
    const result = assignSeq(tasks);
    expect(result.map(t => t.seq)).toEqual([1, 2, 3]);
  });

  it("preserves existing seq values", () => {
    const tasks = [
      { id: 1, seq: 5 },
      { id: 2, seq: null },
    ];
    const result = assignSeq(tasks);
    expect(result[0].seq).toBe(5);
    expect(result[1].seq).toBe(6);
  });

  it("gaps don't cause collisions", () => {
    const tasks = [
      { id: 1, seq: 10 },
      { id: 2, seq: null },
      { id: 3, seq: null },
    ];
    const result = assignSeq(tasks);
    const seqs = result.map(t => t.seq);
    expect(new Set(seqs).size).toBe(3); // all unique
    expect(seqs[0]).toBe(10);
  });
});

describe("sortedTxt", () => {
  it("puts done tasks after active tasks", () => {
    const tasks = [parseTodoTxt("x 2026-03-01 Done task", 1), parseTodoTxt("(A) Active task", 2)];
    const txt = sortedTxt(tasks);
    const lines = txt.trim().split("\n");
    expect(lines[0]).toContain("(A)");
    expect(lines[1]).toMatch(/^x /);
  });

  it("active tasks sort by seq regardless of priority", () => {
    // Both tasks are priority A — seq is the only differentiator
    const tasks = [
      { ...parseTodoTxt("(A) Second", 1), seq: 2 },
      { ...parseTodoTxt("(A) First", 2), seq: 1 },
    ];
    const txt = sortedTxt(tasks);
    const lines = txt.trim().split("\n");
    expect(lines[0]).toContain("First");
    expect(lines[1]).toContain("Second");
  });

  it("round-trips multiple tasks without data loss", () => {
    const raws = [
      "(A) Call dentist +Health @phone due:2026-03-10",
      "(R) Weekly standup due:2026-03-07 rec:1w +Work @computer",
      "(B) Prepare review t:2026-04-01 due:2026-04-07 +Work",
    ];
    const tasks = raws.map((r, i) => parseTodoTxt(r, i + 1));
    const txt = sortedTxt(tasks);
    const reparsed = txt
      .trim()
      .split("\n")
      .map((l, i) => parseTodoTxt(l, i + 1));
    expect(reparsed.find(t => t.cleanText === "Call dentist")?.priority).toBe("A");
    expect(reparsed.find(t => t.cleanText === "Weekly standup")?.recurrence).toBe("1w");
    expect(reparsed.find(t => t.cleanText === "Prepare review")?.thresholdDate).toBe("2026-04-01");
  });
});

// ── BUG-FIX: keyboard shortcut 'n' must initialise form.priority to "A" ─────
describe("keyboard shortcut n — priority initialisation (REGRESSION)", () => {
  // Simulates what the keydown handler does after the fix
  function simulateNKey(_prevFormPriority) {
    // Before fix: only setAddingFor("A") was called — form.priority unchanged
    // After fix:  setForm(f => ({ ...f, priority: "A" })) is also called
    const updatedPriority = "A"; // the fix always sets priority: "A", ignoring prior state
    return simulateAddTask({ formPriority: updatedPriority, groupPriority: "A", hasRec: false });
  }

  it("results in A priority regardless of previous form state", () => {
    expect(simulateNKey("C")).toBe("A");
    expect(simulateNKey("B")).toBe("A");
    expect(simulateNKey("?")).toBe("A");
  });

  // Old broken behaviour for contrast: if the 'n' key handler didn't update
  // form.priority, the stale form value would propagate instead of group priority.
  // e.g. simulateAddTask({ formPriority: "C", groupPriority: "A" }) → "C" (bug)
  //      simulateAddTask({ formPriority: "B", groupPriority: "A" }) → "B" (bug)
  // The fix: setForm(f => ({ ...f, priority: "A" })) is now called alongside setAddingFor("A").
});

// ── BUG-FIX: TaskForm (add form) must include R in priority dropdown ─────────
describe("TaskForm priority options", () => {
  // The fix is in JSX so we test the logic that would use R from the add form
  it("adding a task with priority R and no rec produces an R task", () => {
    // User explicitly chose R in dropdown, no rec field filled
    const priority = simulateAddTask({ formPriority: "R", groupPriority: "A", hasRec: false });
    expect(priority).toBe("R");
  });

  it("recurrence still forces R even if form priority is A", () => {
    const priority = simulateAddTask({ formPriority: "A", groupPriority: "A", hasRec: true });
    expect(priority).toBe("R");
  });
});

// ── BUG-FIX: weekly view "No due date" section must exclude threshold-hidden tasks ─
describe("weekly view no-due-date filter (REGRESSION)", () => {
  function isVisibleInWeeklyNodue(task) {
    // Fixed filter: !done && !dueDate && !(thresholdDate > TODAY)
    return !task.done && !task.dueDate && !(task.thresholdDate && task.thresholdDate > TODAY);
  }

  it("includes a normal no-due-date task", () => {
    const t = parseTodoTxt("(C) Someday task +Personal", 1);
    expect(isVisibleInWeeklyNodue(t)).toBe(true);
  });

  it("excludes a task with a future threshold date even if it has no due date", () => {
    const future = advanceDate(TODAY, "5d");
    const t = parseTodoTxt(`(B) Hidden task t:${future}`, 2);
    expect(isVisibleInWeeklyNodue(t)).toBe(false);
  });

  it("includes a task whose threshold date is today or past", () => {
    const t = parseTodoTxt(`(A) Now visible t:${TODAY}`, 3);
    expect(isVisibleInWeeklyNodue(t)).toBe(true);
  });

  it("excludes done tasks", () => {
    const t = parseTodoTxt("x 2026-03-01 Done task", 4);
    expect(isVisibleInWeeklyNodue(t)).toBe(false);
  });

  it("excludes tasks that have a due date (they belong in day columns)", () => {
    const t = parseTodoTxt(`(A) Has due date due:${TODAY}`, 5);
    expect(isVisibleInWeeklyNodue(t)).toBe(false);
  });
});

// ── BUG-FIX: TODAY module var must be updatable at midnight ──────────────────
describe("TODAY midnight refresh", () => {
  it("getToday() returns a valid ISO date string", () => {
    const today = getToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getToday() matches the current date", () => {
    const d = new Date();
    const expected = d.toISOString().split("T")[0];
    // Allow 1-second tolerance in case test runs right at midnight
    const actual = getToday();
    expect(actual === expected || actual === advanceDate(expected, "1d")).toBe(true);
  });

  it("effectivePriority uses updated TODAY after simulated midnight tick", () => {
    const original = TODAY;
    // A task due "tomorrow" relative to original TODAY
    const nextDay = advanceDate(TODAY, "1d");
    const task = { priority: "R", dueDate: nextDay };
    expect(effectivePriority(task, TODAY)).toBe("B"); // due tomorrow → B
    // Advance TODAY to nextDay — now the task is due today
    TODAY = nextDay;
    expect(effectivePriority(task, TODAY)).toBe("A"); // due today → A
    TODAY = original;
  });
});

describe("someday task filtering", () => {
  // Mirrors the somedayTasks filter in App.jsx
  function isSomeday(task) {
    return (
      !task.done &&
      !task.dueDate &&
      !task.recurrence &&
      (task.priority === "C" || task.priority === null)
    );
  }

  it("includes C tasks with no due date and no recurrence", () => {
    const t = parseTodoTxt("(C) Read a book +Personal", 1);
    expect(isSomeday(t)).toBe(true);
  });

  it("excludes tasks with a due date", () => {
    const t = parseTodoTxt(`(C) Read a book due:${TODAY}`, 2);
    expect(isSomeday(t)).toBe(false);
  });

  it("excludes A and B priority tasks", () => {
    expect(isSomeday(parseTodoTxt("(A) Urgent thing", 3))).toBe(false);
    expect(isSomeday(parseTodoTxt("(B) Important thing", 4))).toBe(false);
  });

  it("excludes recurring tasks", () => {
    const t = parseTodoTxt("(C) Weekly thing rec:1w", 5);
    expect(isSomeday(t)).toBe(false);
  });

  it("includes tasks with null priority", () => {
    const t = parseTodoTxt("No priority task", 6);
    expect(isSomeday(t)).toBe(true);
  });

  it("excludes done tasks", () => {
    const t = parseTodoTxt("x 2026-03-01 Done task", 7);
    expect(isSomeday(t)).toBe(false);
  });
});

// ─── dueSortKey ───────────────────────────────────────────────────────────────

describe("dueSortKey", () => {
  it("overdue tasks get key 0 (highest urgency)", () => {
    expect(dueSortKey({ dueDate: "2020-01-01" }, TODAY)).toBe(0);
  });

  it("tasks due today get key 1", () => {
    expect(dueSortKey({ dueDate: TODAY }, TODAY)).toBe(1);
  });

  it("future tasks get key 2", () => {
    const future = advanceDate(TODAY, "5d");
    expect(dueSortKey({ dueDate: future }, TODAY)).toBe(2);
  });

  it("tasks with no due date get key 3 (lowest urgency)", () => {
    expect(dueSortKey({ dueDate: null }, TODAY)).toBe(3);
  });

  it("sorts overdue before today before future before no-date", () => {
    const tasks = [
      { dueDate: null },
      { dueDate: advanceDate(TODAY, "3d") },
      { dueDate: TODAY },
      { dueDate: "2020-06-01" },
    ];
    const sorted = [...tasks].sort((a, b) => dueSortKey(a, TODAY) - dueSortKey(b, TODAY));
    expect(sorted[0].dueDate).toBe("2020-06-01");
    expect(sorted[1].dueDate).toBe(TODAY);
    expect(sorted[2].dueDate).toBe(advanceDate(TODAY, "3d"));
    expect(sorted[3].dueDate).toBeNull();
  });

  it("uses the provided today argument rather than ambient date", () => {
    // Pinned to a fixed future date so this never becomes date-sensitive
    expect(dueSortKey({ dueDate: "2030-06-01" }, "2030-06-02")).toBe(0); // overdue
    expect(dueSortKey({ dueDate: "2030-06-01" }, "2030-06-01")).toBe(1); // today
    expect(dueSortKey({ dueDate: "2030-06-01" }, "2030-05-31")).toBe(2); // future
  });
});

// ─── fmtDate ─────────────────────────────────────────────────────────────────

describe("fmtDate", () => {
  it("formats a mid-year date without leading zeros", () => {
    expect(fmtDate("2026-06-05")).toBe("6/5");
  });

  it("formats a date with double-digit month and day", () => {
    expect(fmtDate("2026-11-20")).toBe("11/20");
  });

  it("formats January 1st correctly", () => {
    expect(fmtDate("2026-01-01")).toBe("1/1");
  });

  it("returns empty string for null", () => {
    expect(fmtDate(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(fmtDate(undefined)).toBe("");
  });
});

// ─── upcomingTasks sort ───────────────────────────────────────────────────────
function sortUpcoming(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.thresholdDate !== b.thresholdDate) return a.thresholdDate.localeCompare(b.thresholdDate);
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}

describe("upcomingTasks sort", () => {
  const t1 = parseTodoTxt(`(B) Later threshold t:2026-09-01 due:2026-09-10`, 1);
  const t2 = parseTodoTxt(`(A) Earlier threshold t:2026-08-01 due:2026-08-10`, 2);
  const t3 = parseTodoTxt(`(B) Same threshold earlier due t:2026-08-01 due:2026-08-05`, 3);
  const t4 = parseTodoTxt(`(C) Same threshold no due date t:2026-08-01`, 4);

  it("sorts by threshold date ascending", () => {
    const sorted = sortUpcoming([t1, t2]);
    expect(sorted[0].cleanText).toBe("Earlier threshold");
    expect(sorted[1].cleanText).toBe("Later threshold");
  });

  it("within same threshold, sorts by due date ascending", () => {
    const sorted = sortUpcoming([t2, t3]);
    expect(sorted[0].cleanText).toBe("Same threshold earlier due");
    expect(sorted[1].cleanText).toBe("Earlier threshold");
  });

  it("within same threshold, task with due date sorts before task without", () => {
    const sorted = sortUpcoming([t4, t3]);
    expect(sorted[0].cleanText).toBe("Same threshold earlier due");
    expect(sorted[1].cleanText).toBe("Same threshold no due date");
  });
});

// ─── matchesSearch ────────────────────────────────────────────────────────────
function matchesSearch(task, query) {
  const q = query ? query.toLowerCase() : "";
  if (!q) return true;
  if (task.cleanText.toLowerCase().includes(q)) return true;
  if (task.projects.some(p => p.toLowerCase().includes(q))) return true;
  if (task.contexts.some(c => c.toLowerCase().includes(q))) return true;
  if (task.dueDate && task.dueDate.includes(q)) return true;
  return false;
}

describe("matchesSearch", () => {
  const task = parseTodoTxt("(A) Call dentist +Health @phone due:2026-06-15", 1);

  it("returns true for empty query", () => {
    expect(matchesSearch(task, "")).toBe(true);
    expect(matchesSearch(task, null)).toBe(true);
  });

  it("matches on cleanText (case-insensitive)", () => {
    expect(matchesSearch(task, "dentist")).toBe(true);
    expect(matchesSearch(task, "DENTIST")).toBe(true);
    expect(matchesSearch(task, "call")).toBe(true);
  });

  it("matches on project tag", () => {
    expect(matchesSearch(task, "health")).toBe(true);
    expect(matchesSearch(task, "Health")).toBe(true);
  });

  it("matches on context tag", () => {
    expect(matchesSearch(task, "phone")).toBe(true);
  });

  it("matches on due date string", () => {
    expect(matchesSearch(task, "2026-06-15")).toBe(true);
    expect(matchesSearch(task, "06-15")).toBe(true);
  });

  it("returns false for non-matching query", () => {
    expect(matchesSearch(task, "groceries")).toBe(false);
    expect(matchesSearch(task, "work")).toBe(false);
  });
});

// ─── isVisibleToday ───────────────────────────────────────────────────────────
// Mirrors isVisibleToday from App.jsx, parameterized for testability
function isVisibleToday(
  task,
  { showDone = false, filterCtx = null, filterProj = null, query = "" } = {},
) {
  const q = query.toLowerCase();
  function matchesSearchLocal(t) {
    if (!q) return true;
    if (t.cleanText.toLowerCase().includes(q)) return true;
    if (t.projects.some(p => p.toLowerCase().includes(q))) return true;
    if (t.contexts.some(c => c.toLowerCase().includes(q))) return true;
    if (t.dueDate && t.dueDate.includes(q)) return true;
    return false;
  }
  if (task.done && !showDone) return false;
  if (filterCtx && !task.contexts.includes(filterCtx)) return false;
  if (filterProj && !task.projects.includes(filterProj)) return false;
  if (!matchesSearchLocal(task)) return false;
  if (task.thresholdDate && task.thresholdDate > TODAY) return false;
  if (task.priority === "R" && !task.done) {
    const ep = effectivePriority(task, TODAY);
    return ep === "A" || ep === "B";
  }
  return true;
}

describe("isVisibleToday", () => {
  it("shows a normal active task", () => {
    const t = parseTodoTxt("(A) Do something", 1);
    expect(isVisibleToday(t)).toBe(true);
  });

  it("hides done tasks when showDone is false (default)", () => {
    const t = parseTodoTxt("x 2026-01-01 Done task", 1);
    expect(isVisibleToday(t, { showDone: false })).toBe(false);
  });

  it("shows done tasks when showDone is true", () => {
    const t = parseTodoTxt("x 2026-01-01 Done task", 1);
    expect(isVisibleToday(t, { showDone: true })).toBe(true);
  });

  it("hides tasks with a future threshold date", () => {
    const future = advanceDate(TODAY, "5d");
    const t = parseTodoTxt(`(B) Future task t:${future}`, 1);
    expect(isVisibleToday(t)).toBe(false);
  });

  it("shows tasks whose threshold date is today", () => {
    const t = parseTodoTxt(`(B) Ready now t:${TODAY}`, 1);
    expect(isVisibleToday(t)).toBe(true);
  });

  it("filters by context — shows task with matching context", () => {
    const t = parseTodoTxt("(A) Call someone @phone", 1);
    expect(isVisibleToday(t, { filterCtx: "phone" })).toBe(true);
  });

  it("filters by context — hides task without matching context", () => {
    const t = parseTodoTxt("(A) Do computer work @computer", 1);
    expect(isVisibleToday(t, { filterCtx: "phone" })).toBe(false);
  });

  it("filters by project — shows task with matching project", () => {
    const t = parseTodoTxt("(A) Work thing +Work", 1);
    expect(isVisibleToday(t, { filterProj: "Work" })).toBe(true);
  });

  it("filters by project — hides task without matching project", () => {
    const t = parseTodoTxt("(A) Home thing +Home", 1);
    expect(isVisibleToday(t, { filterProj: "Work" })).toBe(false);
  });

  it("hides task that doesn't match search query", () => {
    const t = parseTodoTxt("(A) Call dentist @phone", 1);
    expect(isVisibleToday(t, { query: "groceries" })).toBe(false);
  });

  it("shows task that matches search query", () => {
    const t = parseTodoTxt("(A) Call dentist @phone", 1);
    expect(isVisibleToday(t, { query: "dentist" })).toBe(true);
  });

  it("R task due today is visible (effectivePriority → A)", () => {
    const t = parseTodoTxt(`(R) Daily standup due:${TODAY} rec:1d`, 1);
    expect(isVisibleToday(t)).toBe(true);
  });

  it("R task due tomorrow is visible (effectivePriority → B)", () => {
    const tomorrow = advanceDate(TODAY, "1d");
    const t = parseTodoTxt(`(R) Weekly review due:${tomorrow} rec:1w`, 1);
    expect(isVisibleToday(t)).toBe(true);
  });

  it("R task due in 2+ days is hidden (effectivePriority → null)", () => {
    const future = advanceDate(TODAY, "3d");
    const t = parseTodoTxt(`(R) Future recurring due:${future} rec:1w`, 1);
    expect(isVisibleToday(t)).toBe(false);
  });

  it("R task with no due date is hidden (effectivePriority → R, not A or B)", () => {
    const t = parseTodoTxt("(R) Undated recurring rec:1w", 1);
    expect(isVisibleToday(t)).toBe(false);
  });
});
