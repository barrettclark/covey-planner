import { useState, useRef, useEffect, useMemo } from "react";
import { fmtDate, weekDates, effectivePriority, sortedTxt } from "./todotxt.js";
import { startDropboxAuth } from "./dropbox.js";
import { useTaskManager } from "./useTaskManager.js";
import { C, FONT_SERIF } from "./theme.js";
import {
  PMETA,
  DailyView,
  WeeklyView,
  UpcomingView,
  SomedayView,
  HBtn,
  SBtn,
  Chip,
  HelpSection,
  HelpDivider,
  Code,
  hp,
  ul,
  li,
} from "./components.jsx";

const QUOTES = [
  {
    text: "The key is not to prioritize what's on your schedule, but to schedule your priorities.",
    author: "Stephen Covey",
  },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  {
    text: "Do the hard jobs first. The easy jobs will take care of themselves.",
    author: "Dale Carnegie",
  },
  {
    text: "It is not enough to be busy. The question is: what are we busy about?",
    author: "Henry David Thoreau",
  },
  {
    text: "You don't have to see the whole staircase, just take the first step.",
    author: "Martin Luther King Jr.",
  },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Either you run the day or the day runs you.", author: "Jim Rohn" },
  {
    text: "Efficiency is doing things right. Effectiveness is doing the right things.",
    author: "Peter Drucker",
  },
  {
    text: "The great dividing line between success and failure: I did not have time.",
    author: "Franklin Field",
  },
  { text: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker" },
  { text: "Plans are nothing; planning is everything.", author: "Dwight D. Eisenhower" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Well begun is half done.", author: "Aristotle" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "Lost time is never found again.", author: "Benjamin Franklin" },
  {
    text: "The best time to plant a tree was 20 years ago. The second best time is now.",
    author: "Chinese Proverb",
  },
  {
    text: "Amateurs sit and wait for inspiration. The rest of us just get up and go to work.",
    author: "Stephen King",
  },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Small deeds done are better than great deeds planned.", author: "Peter Marshall" },
  {
    text: "The most difficult thing is the decision to act. The rest is merely tenacity.",
    author: "Amelia Earhart",
  },
  { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
  {
    text: "Motivation is what gets you started. Habit is what keeps you going.",
    author: "Jim Ryun",
  },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Plans are useless, but planning is indispensable.", author: "Dwight D. Eisenhower" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
  { text: "Perfection is the enemy of progress.", author: "Winston Churchill" },
  {
    text: "If you want to make an easy job seem hard, just keep putting it off.",
    author: "Olin Miller",
  },
  { text: "The art of being wise is knowing what to overlook.", author: "William James" },
];

export default function App() {
  const mgr = useTaskManager();
  const {
    tasks,
    editingId,
    setEditingId,
    addingFor,
    setAddingFor,
    form,
    setForm,
    dbxConnected,
    dbxStatus,
    fileHandle,
    saveMsg,
    isEditing,
    dragId,
    setDragId,
    dragOverId,
    setDragOverId,
    dragOverGroup,
    setDragOverGroup,
    reschedulePrompt,
    setReschedulePrompt,
    rescheduleDate,
    setRescheduleDate,
    undoToast,
    setUndoToast,
    planningMode,
    setPlanningMode,
    planStep,
    setPlanStep,
    planRolloverIds,
    allCtx,
    allProj,
    getFilteredViews,
    toggleDone,
    deleteTask,
    toggleInProgress,
    saveEdit,
    addTask,
    addSomedayTask,
    changePriority,
    promoteToDaily,
    makeVisible,
    openFile,
    saveFile,
    disconnectDropbox,
    doUndo,
    handleTouchDragStart,
    handleTouchDragMove,
    handleTouchDragEnd,
    onDrop,
    onDropGroup,
    confirmReschedule,
    startPlanningMode,
    planRolloverTask,
    advancePlanStep,
  } = mgr;

  // ── View / search / focus state (render-only, not in hook) ──────────────────
  const [view, setView] = useState("daily");
  const [showDone, setShowDone] = useState(false);
  const [filterCtx, setFilterCtx] = useState(null);
  const [filterProj, setFilterProj] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState(null);
  const searchRef = useRef(null);
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // ── Notification permission request (mobile) ────────────────────────────────
  useEffect(() => {
    if (!isMobile) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      const t = setTimeout(() => {
        Notification.requestPermission().catch(() => {});
      }, 3000);
      return () => clearTimeout(t);
    }
  }, []);

  // ── NASA APOD ────────────────────────────────────────────────────────────────
  const [apod, setApod] = useState(null);
  const [apodError, setApodError] = useState(false);
  useEffect(() => {
    const TODAY = mgr.TODAY();
    const cacheKey = `apod_${TODAY}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setApod(JSON.parse(cached));
        return;
      } catch {}
    }
    fetch(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&date=${TODAY}`)
      .then(r => {
        if (r.status === 429) {
          setApodError(true);
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (data.media_type === "image") {
          setApod(data);
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } else {
          return fetch(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=8`)
            .then(r => {
              if (r.status === 429) {
                setApodError(true);
                return null;
              }
              return r.json();
            })
            .then(arr => {
              if (!arr) return;
              const photo = arr.find(d => d.media_type === "image");
              if (photo) {
                setApod(photo);
                localStorage.setItem(cacheKey, JSON.stringify(photo));
              } else setApodError(true);
            });
        }
      })
      .catch(() => setApodError(true));
  }, []);

  // ── Derived views ────────────────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const { somedayTasks, upcomingTasks, visibleActive, doneTasks, groups, orderedTasks, dayTasks } =
    getFilteredViews({ searchQuery: q, showDone, filterCtx, filterProj });

  const weekDays = useMemo(() => weekDates(), []);
  const exportTxt = useMemo(() => (tasks ? sortedTxt(tasks).trimEnd() : ""), [tasks]);
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );
  const todayQuote = useMemo(() => {
    const dayOfYear = Math.floor(
      (new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000,
    );
    return QUOTES[dayOfYear % QUOTES.length];
  }, []);
  const TODAY = mgr.TODAY();

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      const tag = document.activeElement?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
          searchRef.current?.blur();
        }
        if (editingId) setEditingId(null);
        if (addingFor) setAddingFor(null);
        if (planningMode) setPlanningMode(false);
        return;
      }
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
        setForm(f => ({ ...f, priority: "A" }));
        setAddingFor("A");
      } else if (["1", "2", "3", "4"].includes(e.key) && focusedTaskId) {
        const pMap = { 1: "A", 2: "B", 3: "C", 4: null };
        changePriority(focusedTaskId, pMap[e.key]);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusedTaskId, orderedTasks, editingId, addingFor, searchQuery, planningMode, tasks]);

  return (
    <div
      style={{
        fontFamily: FONT_SERIF,
        minHeight: "100vh",
        width: "100%",
        background: C.parchment,
        color: C.ink,
        overflowX: "hidden",
      }}
    >
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
          <div style={{ background: "#1e1810", color: "#f2ede4" }}>
            <div className="task-col-inner" style={{ padding: "20px 24px 0" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                  paddingBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.25em",
                      textTransform: "uppercase",
                      color: "#c8b89a",
                      marginBottom: 3,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <a
                      href="https://blog.franklinplanner.com/wp-content/uploads/sites/2/2015/01/1412030-GO-Community-Spring-2015-Final.pdf"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "#e8d8b8",
                        textDecoration: "none",
                        borderBottom: "1px solid #8a7060",
                        letterSpacing: "0.25em",
                      }}
                    >
                      Franklin Covey
                    </a>
                    <span style={{ color: "#8a7060" }}>+</span>
                    <a
                      href="https://github.com/todotxt/todo.txt"
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "#e8d8b8",
                        textDecoration: "none",
                        borderBottom: "1px solid #8a7060",
                        letterSpacing: "0.25em",
                      }}
                    >
                      todo.txt
                    </a>
                  </div>
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: "normal" }}>
                    Daily Task Planner
                  </h1>
                  <div style={{ fontSize: 12, color: "#c8b89a", marginTop: 2 }}>{todayLabel}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {dbxConnected ? (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        color:
                          dbxStatus === "error"
                            ? "#e07070"
                            : dbxStatus === "saving"
                              ? "#e8c97a"
                              : isEditing
                                ? "#a89878"
                                : "#7ec8a0",
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          display: "inline-block",
                          background:
                            dbxStatus === "error"
                              ? "#e07070"
                              : dbxStatus === "saving"
                                ? "#e8c97a"
                                : isEditing
                                  ? "#a89878"
                                  : "#7ec8a0",
                          animation: dbxStatus === "saving" ? "pulse 1s infinite" : "none",
                        }}
                      />
                      {dbxStatus === "loading"
                        ? "Loading…"
                        : dbxStatus === "saving"
                          ? "Saving…"
                          : dbxStatus === "error"
                            ? "Sync error"
                            : isEditing
                              ? "Sync paused"
                              : "Dropbox live"}
                    </span>
                  ) : (
                    saveMsg && <span style={{ fontSize: 11, color: "#7ec8a0" }}>{saveMsg}</span>
                  )}
                  {dbxConnected ? (
                    <HBtn onClick={disconnectDropbox}>⏏ Disconnect</HBtn>
                  ) : (
                    <>
                      <HBtn onClick={startDropboxAuth}>🔗 Connect Dropbox</HBtn>
                      {!isMobile && <HBtn onClick={openFile}>📂 Open</HBtn>}
                      {!isMobile && (
                        <HBtn onClick={saveFile}>{fileHandle ? "💾 Save" : "⬇ Download"}</HBtn>
                      )}
                    </>
                  )}
                  <HBtn onClick={startPlanningMode}>📋 Plan My Day</HBtn>
                  <HBtn onClick={() => setShowDone(!showDone)}>
                    {showDone ? "Hide Done" : `Done (${(tasks || []).filter(t => t.done).length})`}
                  </HBtn>
                  <HBtn onClick={() => setShowExport(!showExport)}>View todo.txt</HBtn>
                  <button
                    onClick={() => setShowHelp(true)}
                    title="Help"
                    style={{
                      background: "none",
                      border: "1px solid #3a2e20",
                      borderRadius: "50%",
                      color: "#8a7060",
                      cursor: "pointer",
                      width: 26,
                      height: 26,
                      fontSize: 13,
                      fontFamily: "inherit",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    ?
                  </button>
                </div>
              </div>

              {/* Search bar */}
              <div style={{ paddingBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 9,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "#6a5040",
                      fontSize: 13,
                      pointerEvents: "none",
                    }}
                  >
                    ⌕
                  </span>
                  <input
                    ref={searchRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="Search tasks… ( / )"
                    style={{
                      width: "100%",
                      background: "#2e2010",
                      border: `1px solid ${searchFocused ? "#c8b89a" : "#3a2e20"}`,
                      borderRadius: 6,
                      padding: "6px 28px 6px 28px",
                      fontSize: 12,
                      color: "#f2ede4",
                      fontFamily: "inherit",
                      outline: "none",
                      transition: "border-color 0.15s",
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        searchRef.current?.blur();
                      }}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateX(0) translateY(-50%)",
                        background: "none",
                        border: "none",
                        color: "#6a5040",
                        cursor: "pointer",
                        fontSize: 14,
                        lineHeight: 1,
                        padding: 0,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {searchQuery && (
                  <span style={{ fontSize: 11, color: "#8a7060" }}>
                    {visibleActive.length + doneTasks.length} result
                    {visibleActive.length + doneTasks.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", borderTop: "1px solid #2e2010" }}>
                {[
                  ["daily", "📋 Today"],
                  ["weekly", "📅 Week Ahead"],
                  [
                    "upcoming",
                    `⏳ Upcoming${upcomingTasks.length > 0 ? ` (${upcomingTasks.length})` : ""}`,
                  ],
                  [
                    "someday",
                    `💭 Someday/Maybe${somedayTasks.length > 0 ? ` (${somedayTasks.length})` : ""}`,
                  ],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    style={{
                      background: view === v ? "#f2ede4" : "transparent",
                      color: view === v ? "#1e1810" : "#a89070",
                      border: "none",
                      cursor: "pointer",
                      padding: "9px 18px",
                      fontSize: 11,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontFamily: "inherit",
                      borderRadius: "4px 4px 0 0",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter bar */}
            {(allCtx.length > 0 || allProj.length > 0) && (
              <div style={{ background: "#160e08", borderTop: "1px solid #2e2010" }}>
                <div
                  className="task-col-inner"
                  style={{
                    padding: "6px 24px",
                    display: "flex",
                    gap: 5,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "#8a7060",
                      letterSpacing: "0.15em",
                      textTransform: "uppercase",
                      marginRight: 4,
                    }}
                  >
                    Filter
                  </span>
                  {allCtx.map(c => (
                    <Chip
                      key={c}
                      label={`@${c}`}
                      active={filterCtx === c}
                      color="#7ec8a0"
                      onClick={() => setFilterCtx(filterCtx === c ? null : c)}
                    />
                  ))}
                  {allProj.map(p => (
                    <Chip
                      key={p}
                      label={`+${p}`}
                      active={filterProj === p}
                      color="#7ab8e8"
                      onClick={() => setFilterProj(filterProj === p ? null : p)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Main content ── */}
          <div className="task-col-inner" style={{ padding: "22px 24px 80px", flex: 1 }}>
            {/* Loading skeleton */}
            {tasks === null && (
              <div style={{ opacity: 0.5 }}>
                {["A", "B", "C"].map(p => (
                  <div key={p} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#d8d0c4",
                        }}
                      />
                      <div
                        style={{ width: 120, height: 12, borderRadius: 4, background: "#d8d0c4" }}
                      />
                    </div>
                    <div
                      style={{
                        background: "#ede8de",
                        border: "1px solid #d8d0c4",
                        borderRadius: 6,
                        padding: "10px 14px",
                      }}
                    >
                      {[80, 55, 70].map((w, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 0",
                            borderTop: i > 0 ? "1px solid #d8d0c4" : "none",
                          }}
                        >
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 3,
                              background: "#d8d0c4",
                              flexShrink: 0,
                            }}
                          />
                          <div
                            style={{
                              height: 12,
                              borderRadius: 4,
                              background: "#d8d0c4",
                              width: `${w}%`,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Export panel */}
            {showExport && (
              <div
                style={{ background: "#1e1810", borderRadius: 6, padding: 16, marginBottom: 20 }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "#6a5040",
                    marginBottom: 8,
                  }}
                >
                  todo.txt
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: "#c8b89a",
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontFamily: "monospace",
                  }}
                >
                  {exportTxt}
                </pre>
                <button
                  onClick={() => navigator.clipboard?.writeText(exportTxt)}
                  style={{
                    marginTop: 10,
                    background: "#2e2010",
                    color: "#c8b89a",
                    border: "none",
                    borderRadius: 4,
                    padding: "5px 12px",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "inherit",
                  }}
                >
                  Copy to Clipboard
                </button>
              </div>
            )}

            {/* ── DAILY VIEW ── */}
            {view === "daily" && tasks !== null && (
              <DailyView
                tasks={tasks}
                groups={groups}
                doneTasks={doneTasks}
                reschedulePrompt={reschedulePrompt}
                rescheduleDate={rescheduleDate}
                setRescheduleDate={setRescheduleDate}
                confirmReschedule={confirmReschedule}
                setReschedulePrompt={setReschedulePrompt}
                addingFor={addingFor}
                setAddingFor={setAddingFor}
                form={form}
                setForm={setForm}
                addTask={addTask}
                editingId={editingId}
                setEditingId={setEditingId}
                toggleDone={toggleDone}
                toggleInProgress={toggleInProgress}
                deleteTask={deleteTask}
                saveEdit={saveEdit}
                dragId={dragId}
                dragOverId={dragOverId}
                dragOverGroup={dragOverGroup}
                setDragOverGroup={setDragOverGroup}
                setDragId={setDragId}
                setDragOverId={setDragOverId}
                onDrop={onDrop}
                onDropGroup={onDropGroup}
                handleTouchDragStart={handleTouchDragStart}
                handleTouchDragMove={handleTouchDragMove}
                handleTouchDragEnd={handleTouchDragEnd}
                allProj={allProj}
                allCtx={allCtx}
                focusedTaskId={focusedTaskId}
                setFocusedTaskId={setFocusedTaskId}
                showDone={showDone}
                searchQuery={q}
                TODAY={TODAY}
              />
            )}

            {/* ── WEEKLY VIEW ── */}
            {view === "weekly" && tasks !== null && (
              <WeeklyView tasks={tasks} weekDays={weekDays} dayTasks={dayTasks} TODAY={TODAY} />
            )}

            {/* ── UPCOMING VIEW ── */}
            {view === "upcoming" && tasks !== null && (
              <UpcomingView
                upcomingTasks={upcomingTasks}
                editingId={editingId}
                setEditingId={setEditingId}
                saveEdit={saveEdit}
                deleteTask={deleteTask}
                makeVisible={makeVisible}
                allProj={allProj}
                allCtx={allCtx}
                searchQuery={q}
                TODAY={TODAY}
              />
            )}

            {/* ── SOMEDAY/MAYBE VIEW ── */}
            {view === "someday" && tasks !== null && (
              <SomedayView
                somedayTasks={somedayTasks}
                editingId={editingId}
                setEditingId={setEditingId}
                saveEdit={saveEdit}
                deleteTask={deleteTask}
                promoteToDaily={promoteToDaily}
                addingFor={addingFor}
                setAddingFor={setAddingFor}
                form={form}
                setForm={setForm}
                addSomedayTask={addSomedayTask}
                allProj={allProj}
                allCtx={allCtx}
                searchQuery={q}
              />
            )}

            {/* Quote footer */}
            <div
              style={{
                borderTop: "1px solid #d8d0c4",
                marginTop: 32,
                padding: "20px 0 8px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontStyle: "italic",
                  color: "#5a4a38",
                  lineHeight: 1.6,
                  maxWidth: 560,
                  margin: "0 auto",
                }}
              >
                "{todayQuote.text}"
              </div>
              <div
                style={{ fontSize: 11, color: "#9a8a78", marginTop: 6, letterSpacing: "0.08em" }}
              >
                — {todayQuote.author}
              </div>
            </div>
          </div>
        </div>

        {/* ── NASA APOD panel ── */}
        <div className="photo-col" style={{ background: "#111" }}>
          {apod ? (
            <>
              <img
                src={apod.url}
                alt={apod.title}
                style={{
                  width: "100%",
                  height: "72vh",
                  objectFit: "cover",
                  display: "block",
                  animation: "fadein 1s ease",
                }}
              />
              <div
                style={{
                  flex: 1,
                  padding: "16px 18px 20px",
                  background: "#111",
                  overflowY: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#a89878",
                    marginBottom: 5,
                  }}
                >
                  NASA · Astronomy Picture of the Day
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#f2ede4",
                    lineHeight: 1.5,
                    fontWeight: "normal",
                    marginBottom: 8,
                  }}
                >
                  {apod.title}
                </div>
                {apod.copyright && (
                  <div style={{ fontSize: 10, color: "#a89878" }}>
                    © {apod.copyright.replace("\n", " ")}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#9a8a70", marginTop: 8, lineHeight: 1.6 }}>
                  {apod.explanation?.slice(0, 200)}
                  {apod.explanation?.length > 200 ? "…" : ""}
                </div>
                <a
                  href={apod.hdurl || apod.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-block",
                    marginTop: 10,
                    fontSize: 10,
                    color: "#c8b89a",
                    letterSpacing: "0.08em",
                    textDecoration: "none",
                    borderBottom: "1px solid #6a5040",
                  }}
                >
                  View full image ↗
                </a>
              </div>
            </>
          ) : apodError ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 8,
                color: "#3a3020",
                padding: 24,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 28 }}>🌌</div>
              <div style={{ fontSize: 12, color: "#5a5040" }}>NASA photo unavailable today</div>
            </div>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  border: "2px solid #3a3020",
                  borderTopColor: "#8a7060",
                  borderRadius: "50%",
                  animation: "pulse 1s infinite",
                }}
              />
              <div style={{ fontSize: 11, color: "#3a3020", letterSpacing: "0.1em" }}>Loading…</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Undo toast ── */}
      {undoToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1e1810",
            color: "#f2ede4",
            borderRadius: 8,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            zIndex: 300,
            animation: "slideup 0.2s ease",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "#c8b89a" }}>{undoToast.msg}</span>
          <button
            onClick={doUndo}
            style={{
              background: "#b07010",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "3px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              fontWeight: "bold",
            }}
          >
            Undo
          </button>
          <button
            onClick={() => setUndoToast(null)}
            style={{
              background: "none",
              border: "none",
              color: "#6a5040",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Planning mode modal ── */}
      {planningMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fdf6ed",
              borderRadius: 10,
              maxWidth: 520,
              width: "100%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                background: "#1e1810",
                color: "#f2ede4",
                padding: "18px 24px",
                borderRadius: "10px 10px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "#6a5040",
                    marginBottom: 2,
                  }}
                >
                  Franklin Covey
                </div>
                <div style={{ fontSize: 18, fontWeight: "normal" }}>
                  {planStep === 0
                    ? "📋 Roll Over Incomplete Tasks"
                    : planStep === 1
                      ? "↺ Review Recurring Tasks"
                      : "✓ Confirm Today's Priorities"}
                </div>
                <div style={{ fontSize: 11, color: "#6a5040", marginTop: 2 }}>
                  Step {planStep + 1} of 3
                </div>
              </div>
              <button
                onClick={() => setPlanningMode(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6a5040",
                  fontSize: 22,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "20px 24px" }}>
              {planStep === 0 && (
                <>
                  <p style={{ fontSize: 13, color: "#5a4a38", marginTop: 0, lineHeight: 1.6 }}>
                    These tasks were due before today. For each one, decide: keep it on today's
                    list, defer it, or drop it.
                  </p>
                  {planRolloverIds.length === 0 ? (
                    <div
                      style={{
                        padding: "20px 0",
                        textAlign: "center",
                        color: "#8a7060",
                        fontSize: 14,
                        fontStyle: "italic",
                      }}
                    >
                      ✓ No overdue tasks — you're caught up!
                    </div>
                  ) : (
                    planRolloverIds.map(id => {
                      const t = (tasks || []).find(x => x.id === id);
                      if (!t) return null;
                      const m = PMETA[t.priority] || PMETA["?"];
                      return (
                        <div
                          key={id}
                          style={{
                            background: m.bg,
                            border: `1px solid ${m.border}`,
                            borderRadius: 6,
                            padding: "12px 14px",
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                background: m.accent,
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                fontWeight: "bold",
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {t.priority || "?"}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, color: "#1e1810", lineHeight: 1.4 }}>
                                {t.cleanText}
                              </div>
                              <div style={{ fontSize: 11, color: "#9a8a78", marginTop: 2 }}>
                                Due: {fmtDate(t.dueDate)}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                            <SBtn onClick={() => planRolloverTask(id, "keep")} color="#b33020">
                              Keep (today)
                            </SBtn>
                            <SBtn onClick={() => planRolloverTask(id, "defer")} color="#b07010">
                              Defer (tomorrow)
                            </SBtn>
                            <SBtn onClick={() => planRolloverTask(id, "drop")} color="#999">
                              Drop
                            </SBtn>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                    <SBtn onClick={advancePlanStep} color="#2a7048">
                      Next →
                    </SBtn>
                  </div>
                </>
              )}
              {planStep === 1 && (
                <>
                  <p style={{ fontSize: 13, color: "#5a4a38", marginTop: 0, lineHeight: 1.6 }}>
                    These recurring tasks are due today or tomorrow. Review them before starting
                    your day.
                  </p>
                  {(() => {
                    const recurringDue = (tasks || []).filter(
                      t =>
                        !t.done &&
                        t.priority === "R" &&
                        (effectivePriority(t, TODAY) === "A" ||
                          effectivePriority(t, TODAY) === "B"),
                    );
                    if (recurringDue.length === 0)
                      return (
                        <div
                          style={{
                            padding: "20px 0",
                            textAlign: "center",
                            color: "#8a7060",
                            fontSize: 14,
                            fontStyle: "italic",
                          }}
                        >
                          No recurring tasks due today or tomorrow.
                        </div>
                      );
                    return recurringDue.map(t => {
                      const ep = effectivePriority(t, TODAY);
                      const m = PMETA[ep] || PMETA["?"];
                      return (
                        <div
                          key={t.id}
                          style={{
                            background: m.bg,
                            border: `1px solid ${m.border}`,
                            borderRadius: 6,
                            padding: "10px 14px",
                            marginBottom: 8,
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: m.accent,
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: "bold",
                              flexShrink: 0,
                            }}
                          >
                            {ep}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: "#1e1810" }}>{t.cleanText}</div>
                            <div style={{ fontSize: 11, color: "#9a8a78", marginTop: 1 }}>
                              ↺ {t.recurrence} · due {fmtDate(t.dueDate)}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div
                    style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}
                  >
                    <SBtn onClick={() => setPlanStep(0)} color="#aaa">
                      ← Back
                    </SBtn>
                    <SBtn onClick={advancePlanStep} color="#2a7048">
                      Next →
                    </SBtn>
                  </div>
                </>
              )}
              {planStep === 2 && (
                <>
                  <p style={{ fontSize: 13, color: "#5a4a38", marginTop: 0, lineHeight: 1.6 }}>
                    These are your vital tasks for today. Are you happy with this list? You can
                    close this and adjust priorities by dragging or using keys 1–4.
                  </p>
                  {groups["A"].length === 0 ? (
                    <div
                      style={{
                        padding: "16px 0",
                        textAlign: "center",
                        color: "#8a7060",
                        fontSize: 14,
                        fontStyle: "italic",
                      }}
                    >
                      No A tasks yet — consider promoting your most important tasks.
                    </div>
                  ) : (
                    groups["A"].map((t, idx) => (
                      <div
                        key={t.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 14px",
                          background: "#fdf0ee",
                          border: "1px solid #ddb5b0",
                          borderRadius: 6,
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            background: "#b33020",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontWeight: "bold",
                            flexShrink: 0,
                          }}
                        >
                          A{idx + 1}
                        </div>
                        <span style={{ fontSize: 13, color: "#1e1810", flex: 1 }}>
                          {t.cleanText}
                        </span>
                        {t.dueDate && (
                          <span style={{ fontSize: 10, color: "#b33020", fontFamily: "monospace" }}>
                            {fmtDate(t.dueDate)}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                  <div
                    style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}
                  >
                    <SBtn onClick={() => setPlanStep(1)} color="#aaa">
                      ← Back
                    </SBtn>
                    <SBtn
                      onClick={() => {
                        setPlanningMode(false);
                        setPlanStep(0);
                      }}
                      color="#b33020"
                    >
                      Start My Day →
                    </SBtn>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Help modal ── */}
      {showHelp && (
        <div
          onClick={() => setShowHelp(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fdf6ed",
              borderRadius: 10,
              maxWidth: 640,
              width: "100%",
              maxHeight: "88vh",
              overflowY: "auto",
              boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
              fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
            }}
          >
            <div
              style={{
                background: "#1e1810",
                color: "#f2ede4",
                padding: "18px 24px",
                borderRadius: "10px 10px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "#6a5040",
                    marginBottom: 2,
                  }}
                >
                  Franklin Covey
                </div>
                <div style={{ fontSize: 18, fontWeight: "normal" }}>Daily Task Planner — Help</div>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6a5040",
                  fontSize: 22,
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "24px 28px 28px" }}>
              <HelpSection title="Priority System">
                <p style={hp}>
                  Tasks are grouped into four priority levels, following the Franklin Covey method:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                  {[
                    {
                      p: "A",
                      color: "#b33020",
                      bg: "#fdf0ee",
                      border: "#ddb5b0",
                      desc: "Vital — must be done today. Critical, high-stakes tasks.",
                    },
                    {
                      p: "B",
                      color: "#b07010",
                      bg: "#fdf6ed",
                      border: "#ddc898",
                      desc: "Important — should be done today, but won't cause a crisis if deferred.",
                    },
                    {
                      p: "C",
                      color: "#2a7048",
                      bg: "#eef7f2",
                      border: "#9ecfb5",
                      desc: "Nice to Do — worth doing, but low consequence if skipped.",
                    },
                    {
                      p: "R",
                      color: "#3558b0",
                      bg: "#eef2fb",
                      border: "#9db5e0",
                      desc: "Recurring — repeating tasks with a rec: tag. They surface automatically as A (due today) or B (due tomorrow) and stay hidden until then.",
                    },
                  ].map(({ p, color, bg, border, desc }) => (
                    <div
                      key={p}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        background: bg,
                        border: `1px solid ${border}`,
                        borderRadius: 6,
                        padding: "10px 14px",
                      }}
                    >
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: "bold",
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      >
                        {p}
                      </div>
                      <div style={{ fontSize: 13, color: "#2a1e10", lineHeight: 1.5 }}>{desc}</div>
                    </div>
                  ))}
                </div>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Upcoming Tab">
                <p style={hp}>
                  The <strong>⏳ Upcoming</strong> tab shows all tasks that have a future threshold
                  date (<Code>t:</Code>). These tasks exist in your file but are intentionally
                  hidden from the daily view until the threshold date arrives.
                </p>
                <p style={hp}>
                  Tasks are grouped by their threshold date so you can see what becomes active and
                  when. You can edit any upcoming task freely — change its description, due date,
                  priority, or threshold. Click <strong>Show now</strong> to remove the threshold
                  and make a task immediately visible.
                </p>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Threshold Dates (t:)">
                <p style={hp}>
                  Add a <Code>t:</Code> tag to hide a task until a future date. Use the{" "}
                  <strong>Visible from</strong> field when adding or editing any task. The task
                  exists in your file but won't appear in the daily or weekly view until the
                  threshold date arrives.
                </p>
                <p style={hp}>
                  Example: <Code>t:2026-04-01 due:2026-04-07</Code> — the task becomes visible on
                  April 1st, due April 7th.
                </p>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Search">
                <p style={hp}>
                  Press <Code>/</Code> anywhere to jump to the search bar. Type to filter tasks by
                  description, project, context, or due date. Press <Code>Escape</Code> to clear.
                </p>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Keyboard Shortcuts">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: "6px 16px",
                    marginTop: 8,
                  }}
                >
                  {[
                    ["/", "Focus search bar"],
                    ["Escape", "Clear search / cancel edit"],
                    ["j / ↓", "Move focus down"],
                    ["k / ↑", "Move focus up"],
                    ["x", "Toggle done on focused task"],
                    ["d", "Delete focused task"],
                    ["e", "Edit focused task"],
                    ["n", "New task in A group"],
                    ["1", "Set focused task priority → A"],
                    ["2", "Set focused task priority → B"],
                    ["3", "Set focused task priority → C"],
                    ["4", "Remove priority (unsorted)"],
                  ].map(([key, desc]) => (
                    <>
                      <Code key={key + "-k"}>{key}</Code>
                      <span
                        key={key + "-d"}
                        style={{ fontSize: 12, color: "#5a4a38", alignSelf: "center" }}
                      >
                        {desc}
                      </span>
                    </>
                  ))}
                </div>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Dropbox Sync Pause">
                <p style={hp}>
                  While you are editing or adding a task, Dropbox polling is automatically paused —
                  the status indicator shows <strong>Sync paused</strong>. This prevents a remote
                  change from overwriting your in-progress edits. Polling resumes as soon as you
                  save or cancel.
                </p>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="Drag to Reprioritize">
                <p style={hp}>
                  Every task has a <Code>⠿</Code> drag handle on the left. Drag within a group to
                  reorder, or across groups to reprioritize. The new order is saved via the{" "}
                  <Code>seq:</Code> tag so it persists across devices.
                </p>
              </HelpSection>
              <HelpDivider />
              <HelpSection title="todo.txt Format">
                <p style={hp}>
                  Compatible with SwiftDo, vim, and the Obsidian todo.txt plugin. Each task is one
                  line:
                </p>
                <div
                  style={{
                    background: "#1e1810",
                    borderRadius: 6,
                    padding: "12px 16px",
                    margin: "12px 0",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "#c8b89a",
                      lineHeight: 2,
                      fontFamily: "monospace",
                      whiteSpace: "pre-wrap",
                    }}
                  >{`(A) Task description +Project @context due:2026-03-07
(B) Another task +Work @computer
(R) Weekly standup due:2026-03-07 rec:1w +Work @computer
(A) Task hidden until ready t:2026-03-10 due:2026-03-15
x 2026-03-05 Task text pri:A`}</pre>
                </div>
                <ul style={ul}>
                  <li style={li}>
                    <Code>(A)</Code> — priority letter in parentheses at the start
                  </li>
                  <li style={li}>
                    <Code>+Project</Code> — project tag
                  </li>
                  <li style={li}>
                    <Code>@context</Code> — context tag
                  </li>
                  <li style={li}>
                    <Code>due:YYYY-MM-DD</Code> — due date
                  </li>
                  <li style={li}>
                    <Code>t:YYYY-MM-DD</Code> — threshold date: task is hidden until this date
                  </li>
                  <li style={li}>
                    <Code>rec:1w</Code> — recurrence
                  </li>
                  <li style={li}>
                    <Code>x 2026-03-05 … pri:A</Code> — completed tasks
                  </li>
                </ul>
              </HelpSection>
            </div>
            <div
              style={{
                padding: "14px 28px 20px",
                borderTop: "1px solid #e8e0d0",
                textAlign: "center",
              }}
            >
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  background: "#1e1810",
                  color: "#c8b89a",
                  border: "none",
                  borderRadius: 4,
                  padding: "8px 24px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
