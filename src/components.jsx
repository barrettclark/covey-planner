import { useState, useRef } from "react";
import { fmtDate, fmtWeekday, fmtDayNum, effectivePriority } from "./todotxt.js";
import { C, RADIUS } from "./theme.js";

// ─── Shared style constants ───────────────────────────────────────────────────

export const mini = {
  fontSize: 12,
  padding: "4px 8px",
  border: `1px solid ${C.disabledDeep}`,
  borderRadius: RADIUS.md,
  fontFamily: "monospace",
  background: C.white,
  color: C.ink,
};

// ─── Priority metadata ────────────────────────────────────────────────────────

export const PMETA = {
  A: {
    label: "A — Vital",
    accent: C.redAccent,
    bg: C.redBg,
    border: C.redBorder,
    dot: C.redAccent,
  },
  B: {
    label: "B — Important",
    accent: C.amberAccent,
    bg: C.amberBg,
    border: C.amberBorder,
    dot: C.amberAccent,
  },
  C: {
    label: "C — Nice to Do",
    accent: C.greenAccent,
    bg: C.greenBg,
    border: C.greenBorder,
    dot: C.greenAccent,
  },
  R: {
    label: "R — Recurring",
    accent: C.blueAccent,
    bg: C.blueBg,
    border: C.blueBorder,
    dot: C.blueAccent,
  },
  "?": { label: "Unsorted", accent: C.neutral, bg: "#f5f4f0", border: "#d8d5ce", dot: C.neutral },
};

// Upcoming tab meta (for edit form theming)
export const UPCOMING_META = {
  accent: C.purpleAccent,
  bg: C.purpleBg,
  border: C.purpleBorder,
  dot: C.purpleAccent,
};

// ─── highlight ────────────────────────────────────────────────────────────────

export function highlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "#ffe082", color: "#1e1810", borderRadius: 2, padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── TaskForm (unified add + edit form) ──────────────────────────────────────
//
// When `task` is provided the form initialises from the task's existing values
// (edit mode).  When omitted it reads from the external `form` / `setForm`
// state passed in by the parent (add mode).
//
// Props:
//   task?          — existing task object (edit mode)
//   meta           — PMETA entry for accent colours
//   form?          — external controlled form state (add mode)
//   setForm?       — setter for external form state (add mode)
//   onSubmit       — called with the serialised todo.txt string (edit) or
//                    with no args (add, parent owns serialisation)
//   onCancel       — close / cancel handler
//   submitLabel    — button label (defaults to "Save")
//   allProjects    — string[] of known projects for chip toggle
//   allContexts    — string[] of known contexts for chip toggle

export function TaskForm({
  task,
  meta,
  form: externalForm,
  setForm: setExternalForm,
  onSubmit,
  onCancel,
  submitLabel = "Save",
  allProjects = [],
  allContexts = [],
}) {
  // Edit mode: local state initialised from the task.
  // Add mode: use the external form state.
  const isEditMode = !!task;

  const [localForm, setLocalForm] = useState(() =>
    isEditMode
      ? {
          text: task.cleanText,
          due: task.dueDate || "",
          threshold: task.thresholdDate || "",
          rec: task.recurrence || "",
          priority: task.priority || "C",
          project: task.projects.join(" "),
          context: task.contexts.join(" "),
          inProgress: task.inProgress || false,
        }
      : null,
  );

  const f = isEditMode ? localForm : externalForm;
  const setF = isEditMode ? setLocalForm : setExternalForm;

  const toggleTag = (field, val) => {
    const cur = (f[field] || "").split(" ").filter(Boolean);
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val];
    setF(prev => ({ ...prev, [field]: next.join(" ") }));
  };

  const selProj = (f.project || "").split(" ").filter(Boolean);
  const selCtx = (f.context || "").split(" ").filter(Boolean);

  function handleSubmit() {
    if (isEditMode) {
      // Serialise and hand the raw string back to the caller.
      const hasRec = !!f.rec.trim();
      const assignedPriority = hasRec ? "R" : f.priority || "C";
      const parts = [`(${assignedPriority})`, f.text.trim()];
      f.project
        .trim()
        .split(" ")
        .filter(Boolean)
        .forEach(p => parts.push(`+${p}`));
      f.context
        .trim()
        .split(" ")
        .filter(Boolean)
        .forEach(c => parts.push(`@${c}`));
      if (f.due) parts.push(`due:${f.due}`);
      if (f.threshold) parts.push(`t:${f.threshold}`);
      if (f.rec.trim()) parts.push(`rec:${f.rec.trim()}`);
      if (f.inProgress) parts.push(`status:inprogress`);
      onSubmit(parts.join(" "));
    } else {
      // Add mode: parent owns state, just notify.
      onSubmit();
    }
  }

  return (
    <div
      style={{
        background: meta?.bg || "#f5f0e8",
        border: `1px solid ${meta?.border || "#ddd"}`,
        borderRadius: 6,
        padding: 14,
        marginBottom: 8,
      }}
    >
      <input
        value={f.text}
        onChange={e => setF(p => ({ ...p, text: e.target.value }))}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task description…"
        autoFocus
        style={{
          width: "100%",
          border: `1px solid ${meta?.border || "#ddd"}`,
          borderRadius: 4,
          padding: "7px 10px",
          fontSize: 14,
          fontFamily: "inherit",
          background: "#fff",
          color: "#1e1810",
          boxSizing: "border-box",
          marginBottom: 10,
        }}
      />

      {/* Date + priority fields */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a7060",
            }}
          >
            Due date
          </span>
          <input
            value={f.due}
            type="date"
            onChange={e => setF(p => ({ ...p, due: e.target.value }))}
            style={{ ...mini, color: "#1e1810" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a7060",
            }}
          >
            Visible from (t:)
          </span>
          <input
            value={f.threshold || ""}
            type="date"
            onChange={e => setF(p => ({ ...p, threshold: e.target.value }))}
            style={{ ...mini, color: "#1e1810" }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a7060",
            }}
          >
            Priority
          </span>
          <select
            value={f.priority || "C"}
            onChange={e => setF(p => ({ ...p, priority: e.target.value }))}
            style={{ ...mini, color: "#1e1810", cursor: "pointer" }}
          >
            <option value="A">A — Vital</option>
            <option value="B">B — Important</option>
            <option value="C">C — Nice to Do</option>
            <option value="R">R — Recurring</option>
            <option value="?">? — Unsorted</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8a7060",
            }}
          >
            Recurrence
          </span>
          <input
            value={f.rec}
            onChange={e => setF(p => ({ ...p, rec: e.target.value }))}
            placeholder="e.g. 1w, 1m"
            style={{ ...mini, width: 90, color: "#1e1810" }}
          />
        </label>
      </div>

      {/* Projects */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#8a7060",
            marginBottom: 5,
          }}
        >
          +Projects
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {allProjects.map(p => (
            <button
              key={p}
              onClick={() => toggleTag("project", p)}
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                padding: "2px 8px",
                borderRadius: 12,
                border: "1px solid",
                cursor: "pointer",
                background: selProj.includes(p) ? "#3558b0" : "#e8f0fe",
                color: selProj.includes(p) ? "#fff" : "#3558b0",
                borderColor: selProj.includes(p) ? "#3558b0" : "#b8d0f0",
              }}
            >
              +{p}
            </button>
          ))}
          <input
            value={f.project}
            onChange={e => setF(p => ({ ...p, project: e.target.value }))}
            placeholder="New project…"
            style={{ ...mini, fontFamily: "monospace", width: 120, fontSize: 11, color: "#1e1810" }}
          />
        </div>
      </div>

      {/* Contexts */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#8a7060",
            marginBottom: 5,
          }}
        >
          @Contexts
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
          {allContexts.map(c => (
            <button
              key={c}
              onClick={() => toggleTag("context", c)}
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                padding: "2px 8px",
                borderRadius: 12,
                border: "1px solid",
                cursor: "pointer",
                background: selCtx.includes(c) ? "#2a7048" : "#eef7f2",
                color: selCtx.includes(c) ? "#fff" : "#2a7048",
                borderColor: selCtx.includes(c) ? "#2a7048" : "#9ecfb5",
              }}
            >
              @{c}
            </button>
          ))}
          <input
            value={f.context}
            onChange={e => setF(p => ({ ...p, context: e.target.value }))}
            placeholder="New context…"
            style={{ ...mini, fontFamily: "monospace", width: 120, fontSize: 11, color: "#1e1810" }}
          />
        </div>
      </div>

      {/* In progress */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginBottom: isEditMode ? 10 : 12,
        }}
      >
        <div
          onClick={() => setF(p => ({ ...p, inProgress: !p.inProgress }))}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              border: "2px solid",
              borderColor: f.inProgress ? "#b07010" : "#bbb",
              background: f.inProgress ? "#b07010" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {f.inProgress && <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>▶</span>}
          </div>
          <span style={{ fontSize: 12, color: "#5a4a38" }}>Mark as in progress</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <SBtn onClick={handleSubmit} color={meta?.accent || "#888"}>
          {submitLabel}
        </SBtn>
        <SBtn onClick={onCancel} color="#aaa">
          Cancel
        </SBtn>
      </div>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

export function Row({
  task,
  idx,
  meta,
  groupPriority,
  editingId,
  setEditingId,
  onToggle,
  onToggleInProgress,
  onDelete,
  onSaveEdit,
  onCancelEdit,
  dragId,
  dragOverId,
  onDragStart,
  onDragOver,
  onDrop,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
  allProjects,
  allContexts,
  focusedTaskId,
  setFocusedTaskId,
  searchQuery,
  TODAY,
}) {
  const isEditing = editingId === task.id;
  const isFocused = focusedTaskId === task.id;
  const overdue = task.dueDate && task.dueDate < TODAY && !task.done;
  const dueToday = task.dueDate === TODAY && !task.done;

  const isTouchDragging = useRef(false);
  const touchMoveHandler = useRef(null);
  const touchEndHandler = useRef(null);

  function handleTouchStart(e) {
    isTouchDragging.current = true;
    onTouchDragStart(task.id, e);

    touchMoveHandler.current = ev => {
      ev.preventDefault();
      onTouchDragMove(ev);
    };
    touchEndHandler.current = () => {
      isTouchDragging.current = false;
      window.removeEventListener("touchmove", touchMoveHandler.current);
      touchMoveHandler.current = null;
      touchEndHandler.current = null;
      onTouchDragEnd();
    };

    window.addEventListener("touchmove", touchMoveHandler.current, { passive: false });
    window.addEventListener("touchend", touchEndHandler.current, { once: true });
  }

  return (
    <div
      draggable={!isEditing}
      data-taskid={task.id}
      onDragStart={onDragStart}
      onDragOver={e => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={onDrop}
      onClick={() => setFocusedTaskId(task.id)}
      className={isFocused ? "task-row-focused" : ""}
      style={{
        borderTop: idx > 0 ? `1px solid ${meta.border}` : "none",
        background: dragOverId === task.id ? meta.border + "88" : "transparent",
        opacity: dragId === task.id ? 0.4 : 1,
      }}
    >
      {isEditing ? (
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: "#8a7060", marginBottom: 8, letterSpacing: "0.05em" }}>
            Editing task
          </div>
          <TaskForm
            task={task}
            meta={meta}
            allProjects={allProjects}
            allContexts={allContexts}
            onSubmit={onSaveEdit}
            onCancel={onCancelEdit}
            submitLabel="Save"
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            padding: "9px 12px",
            gap: 8,
            transition: "background 0.1s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = meta.border + "44")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <div
            onTouchStart={handleTouchStart}
            style={{
              color: "#ccc",
              fontSize: 11,
              paddingTop: 3,
              cursor: "grab",
              userSelect: "none",
              flexShrink: 0,
              touchAction: "none",
            }}
          >
            ⠿
          </div>
          <div
            style={{
              minWidth: 24,
              textAlign: "center",
              fontSize: 11,
              fontWeight: "bold",
              color: task.done ? "#bbb" : meta.accent,
              paddingTop: 3,
              flexShrink: 0,
            }}
          >
            {task.done
              ? "✓"
              : `${groupPriority || effectivePriority(task, TODAY) || task.priority || "?"}${idx + 1}`}
          </div>
          <div
            onClick={onToggle}
            style={{
              marginTop: 3,
              flexShrink: 0,
              cursor: "pointer",
              width: 16,
              height: 16,
              borderRadius: 3,
              border: task.done ? `2px solid ${meta.accent}` : "2px solid #bbb",
              background: task.done ? meta.accent : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {task.done && <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              onClick={() => setEditingId(task.id)}
              style={{
                fontSize: 14,
                lineHeight: 1.4,
                cursor: "pointer",
                textDecoration: task.done ? "line-through" : "none",
                color: task.done ? "#aaa" : "#1e1810",
              }}
              title="Click to edit"
            >
              {searchQuery ? highlight(task.cleanText, searchQuery) : task.cleanText}
              {task.inProgress && !task.done && (
                <span
                  style={{
                    marginLeft: 7,
                    fontSize: 10,
                    color: "#fff",
                    background: "#b07010",
                    borderRadius: 3,
                    padding: "1px 6px",
                  }}
                >
                  ▶ in progress
                </span>
              )}
              {task.recurrence && !task.done && (
                <span
                  style={{
                    marginLeft: 7,
                    fontSize: 10,
                    color: PMETA["R"].accent,
                    opacity: 0.75,
                    background: "#eef2fb",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  ↺ rec
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 3 }}>
              {task.dueDate && (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: overdue ? "#fde8e5" : dueToday ? "#fff3cd" : "#e8f0fe",
                    color: overdue ? "#b33020" : dueToday ? "#856404" : "#3558b0",
                    border: `1px solid ${overdue ? "#f5c2bc" : dueToday ? "#ffc107" : "#b8d0f0"}`,
                  }}
                >
                  {overdue ? "⚠ " : dueToday ? "⏰ " : ""}
                  {fmtDate(task.dueDate)}
                </span>
              )}
              {task.projects.map(p => (
                <span
                  key={p}
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#3558b0",
                    background: "#e8f0fe",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  {searchQuery ? highlight(`+${p}`, searchQuery) : `+${p}`}
                </span>
              ))}
              {task.contexts.map(c => (
                <span
                  key={c}
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: "#2a7048",
                    background: "#eef7f2",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  {searchQuery ? highlight(`@${c}`, searchQuery) : `@${c}`}
                </span>
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flexShrink: 0,
              alignItems: "center",
            }}
          >
            <button
              onClick={onToggleInProgress}
              title={task.inProgress ? "Clear in-progress" : "Mark in-progress"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                color: task.inProgress ? "#b07010" : "#ddd",
                padding: "2px 4px",
              }}
            >
              ▶
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                color: "#ddd",
                padding: "2px 4px",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Group ────────────────────────────────────────────────────────────────────

export function Group({
  priority,
  meta,
  tasks,
  addingFor,
  setAddingFor,
  form,
  setForm,
  onAdd,
  editingId,
  setEditingId,
  onToggle,
  onToggleInProgress,
  onDelete,
  onSaveEdit,
  dragId,
  dragOverId,
  dragOverGroup,
  setDragOverGroup,
  setDragId,
  setDragOverId,
  onDrop,
  onDropGroup,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
  allProjects,
  allContexts,
  focusedTaskId,
  setFocusedTaskId,
  searchQuery,
  TODAY,
}) {
  const headerIsTarget = dragOverGroup === priority;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        data-group={priority}
        onDragOver={e => {
          e.preventDefault();
          setDragOverGroup(priority);
        }}
        onDragLeave={() => setDragOverGroup(null)}
        onDrop={e => {
          e.preventDefault();
          onDropGroup(priority);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          borderRadius: 6,
          padding: "4px 6px",
          transition: "background 0.1s",
          background: headerIsTarget ? meta.border : "transparent",
          outline: headerIsTarget ? `2px dashed ${meta.accent}` : "2px dashed transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: meta.accent,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: "bold",
              flexShrink: 0,
            }}
          >
            {priority === "?" ? "?" : priority}
          </div>
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: meta.accent,
            }}
          >
            {meta.label}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "#aaa",
              background: "#e5e0d5",
              borderRadius: 10,
              padding: "1px 7px",
            }}
          >
            {tasks.length}
          </span>
          {headerIsTarget && (
            <span style={{ fontSize: 10, color: meta.accent, fontStyle: "italic" }}>
              Drop to reprioritize →
            </span>
          )}
        </div>
        <button
          onClick={() => {
            if (addingFor === priority) {
              setAddingFor(null);
              return;
            }
            setAddingFor(priority);
            setForm(f => ({ ...f, priority: priority === "?" ? "?" : priority }));
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            color: meta.accent,
            lineHeight: 1,
            padding: "0 6px",
            fontFamily: "inherit",
          }}
        >
          +
        </button>
      </div>

      {addingFor === priority && (
        <TaskForm
          meta={meta}
          form={form}
          setForm={setForm}
          onSubmit={() => onAdd(priority)}
          onCancel={() => setAddingFor(null)}
          submitLabel="Add"
          allProjects={allProjects}
          allContexts={allContexts}
        />
      )}

      <div
        style={{
          background: meta.bg,
          border: `1px solid ${meta.border}`,
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {tasks.length === 0 ? (
          <div style={{ padding: "12px 16px", fontSize: 13, color: "#ccc", fontStyle: "italic" }}>
            No tasks
          </div>
        ) : (
          tasks.map((task, idx) => (
            <Row
              key={task.id}
              task={task}
              idx={idx}
              meta={meta}
              groupPriority={priority}
              editingId={editingId}
              setEditingId={setEditingId}
              onToggle={() => onToggle(task.id)}
              onToggleInProgress={() => onToggleInProgress(task.id)}
              onDelete={() => onDelete(task.id)}
              onSaveEdit={raw => onSaveEdit(task.id, raw)}
              onCancelEdit={() => setEditingId(null)}
              dragId={dragId}
              dragOverId={dragOverId}
              onDragStart={() => setDragId(task.id)}
              onDragOver={() => setDragOverId(task.id)}
              onDrop={() => onDrop(task.id)}
              onTouchDragStart={onTouchDragStart}
              onTouchDragMove={onTouchDragMove}
              onTouchDragEnd={onTouchDragEnd}
              allProjects={allProjects}
              allContexts={allContexts}
              focusedTaskId={focusedTaskId}
              setFocusedTaskId={setFocusedTaskId}
              searchQuery={searchQuery}
              TODAY={TODAY}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Small UI components ──────────────────────────────────────────────────────

export function HBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.inkMid,
        color: C.sand,
        border: "none",
        borderRadius: RADIUS.md,
        padding: "5px 12px",
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "inherit",
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </button>
  );
}

export function SBtn({ children, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: color || C.neutral,
        color: C.white,
        border: "none",
        borderRadius: RADIUS.md,
        padding: "4px 10px",
        cursor: "pointer",
        fontSize: 12,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export function Chip({ label, active, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: RADIUS.pill,
        border: "1px solid",
        cursor: "pointer",
        fontFamily: "monospace",
        borderColor: active ? color : C.inkLight,
        background: active ? color : "transparent",
        color: active ? C.ink : C.inkFaint,
      }}
    >
      {label}
    </button>
  );
}

// ─── Help modal sub-components ────────────────────────────────────────────────

export function HelpSection({ title, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: "bold",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: C.ink,
          marginBottom: 10,
          paddingBottom: 4,
          borderBottom: `2px solid ${C.e8e0d0 || "#e8e0d0"}`,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export function HelpDivider() {
  return <div style={{ margin: "20px 0" }} />;
}

export function Code({ children }) {
  return (
    <code
      style={{
        background: "#e8e0d0",
        borderRadius: RADIUS.sm,
        padding: "1px 5px",
        fontSize: 11,
        fontFamily: "monospace",
        color: C.inkLight,
      }}
    >
      {children}
    </code>
  );
}

// Shared text style objects for help modal
export const hp = { fontSize: 13, color: C.textMuted, lineHeight: 1.6, margin: "0 0 4px" };
export const ul = { margin: "8px 0 0 0", paddingLeft: 20 };
export const li = { fontSize: 13, color: C.textMuted, lineHeight: 1.7, marginBottom: 2 };

// ─── DailyView ────────────────────────────────────────────────────────────────

export function DailyView({
  tasks,
  groups,
  doneTasks,
  reschedulePrompt,
  rescheduleDate,
  setRescheduleDate,
  confirmReschedule,
  setReschedulePrompt,
  addingFor,
  setAddingFor,
  form,
  setForm,
  addTask,
  editingId,
  setEditingId,
  toggleDone,
  toggleInProgress,
  deleteTask,
  saveEdit,
  dragId,
  dragOverId,
  dragOverGroup,
  setDragOverGroup,
  setDragId,
  setDragOverId,
  onDrop,
  onDropGroup,
  handleTouchDragStart,
  handleTouchDragMove,
  handleTouchDragEnd,
  allProj,
  allCtx,
  focusedTaskId,
  setFocusedTaskId,
  showDone,
  searchQuery,
  TODAY,
}) {
  return (
    <>
      {reschedulePrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fdf6ed",
              border: "2px solid #ddc898",
              borderRadius: 8,
              padding: 24,
              maxWidth: 380,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#b07010",
                marginBottom: 6,
              }}
            >
              Reschedule Recurring Task
            </div>
            <div style={{ fontSize: 14, color: "#1e1810", marginBottom: 16, lineHeight: 1.5 }}>
              {(tasks || []).find(t => t.id === reschedulePrompt.id)?.cleanText}
            </div>
            <div style={{ fontSize: 12, color: "#7a5a30", marginBottom: 8 }}>
              New due date — reanchors the recurrence chain from this date forward:
            </div>
            <input
              type="date"
              value={rescheduleDate}
              onChange={e => setRescheduleDate(e.target.value)}
              style={{
                ...mini,
                fontSize: 14,
                padding: "7px 10px",
                marginBottom: 16,
                display: "block",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <SBtn onClick={confirmReschedule} color="#b07010">
                Confirm Reschedule
              </SBtn>
              <SBtn
                onClick={() => {
                  setReschedulePrompt(null);
                  setRescheduleDate("");
                }}
                color="#aaa"
              >
                Cancel
              </SBtn>
            </div>
          </div>
        </div>
      )}

      {["A", "B", "C", "?"].map(p => (
        <Group
          key={p}
          priority={p}
          meta={PMETA[p]}
          tasks={groups[p] || []}
          addingFor={addingFor}
          setAddingFor={setAddingFor}
          form={form}
          setForm={setForm}
          onAdd={addTask}
          editingId={editingId}
          setEditingId={setEditingId}
          onToggle={toggleDone}
          onToggleInProgress={toggleInProgress}
          onDelete={deleteTask}
          onSaveEdit={saveEdit}
          dragId={dragId}
          dragOverId={dragOverId}
          dragOverGroup={dragOverGroup}
          setDragOverGroup={setDragOverGroup}
          setDragId={setDragId}
          setDragOverId={setDragOverId}
          onDrop={onDrop}
          onDropGroup={onDropGroup}
          onTouchDragStart={handleTouchDragStart}
          onTouchDragMove={handleTouchDragMove}
          onTouchDragEnd={handleTouchDragEnd}
          allProjects={allProj}
          allContexts={allCtx}
          focusedTaskId={focusedTaskId}
          setFocusedTaskId={setFocusedTaskId}
          searchQuery={searchQuery}
          TODAY={TODAY}
        />
      ))}

      {showDone && doneTasks.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#999",
              marginBottom: 6,
            }}
          >
            ✓ Completed ({doneTasks.length})
          </div>
          <div
            style={{
              background: "#ede8de",
              border: "1px solid #ccc8be",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {doneTasks.map((task, idx) => (
              <Row
                key={task.id}
                task={task}
                idx={idx}
                meta={{ accent: "#aaa", bg: "#ede8de", border: "#ccc8be", dot: "#aaa" }}
                groupPriority={null}
                editingId={editingId}
                setEditingId={setEditingId}
                onToggle={() => toggleDone(task.id)}
                onToggleInProgress={() => toggleInProgress(task.id)}
                onDelete={() => deleteTask(task.id)}
                onSaveEdit={raw => saveEdit(task.id, raw)}
                onCancelEdit={() => setEditingId(null)}
                dragId={null}
                dragOverId={null}
                onDragStart={() => {}}
                onDragOver={() => {}}
                onDrop={() => {}}
                allProjects={allProj}
                allContexts={allCtx}
                focusedTaskId={focusedTaskId}
                setFocusedTaskId={setFocusedTaskId}
                searchQuery={searchQuery}
                TODAY={TODAY}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── WeeklyView ───────────────────────────────────────────────────────────────

export function WeeklyView({ tasks, weekDays, dayTasks, TODAY }) {
  return (
    <>
      <div style={{ fontSize: 12, color: "#8a7060", marginBottom: 14 }}>
        Tasks due in the next 7 days. Overdue tasks surface under today.
      </div>

      {/* Desktop grid */}
      <div className="week-grid">
        {weekDays.map(date => {
          const dt = dayTasks(date);
          const today = date === TODAY;
          return (
            <div
              key={date}
              style={{
                background: today ? "#1e1810" : "#ede8de",
                border: today ? "2px solid #b33020" : "1px solid #ccc8be",
                borderRadius: 6,
                padding: "10px 8px 12px",
                minHeight: 120,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: "bold",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: today ? "#b33020" : "#8a7060",
                  marginBottom: 1,
                }}
              >
                {fmtWeekday(date)}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: "normal",
                  marginBottom: 8,
                  color: today ? "#f2ede4" : "#1e1810",
                }}
              >
                {fmtDayNum(date)}
              </div>
              {dt.length === 0 ? (
                <div
                  style={{ fontSize: 11, color: today ? "#3a2e20" : "#bbb", fontStyle: "italic" }}
                >
                  —
                </div>
              ) : (
                dt.map(task => {
                  const m =
                    PMETA[effectivePriority(task, TODAY)] || PMETA[task.priority] || PMETA["?"];
                  return (
                    <div key={task.id} style={{ marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: m.dot,
                            flexShrink: 0,
                            marginTop: 4,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            lineHeight: 1.35,
                            color: today ? "#c8b89a" : "#3a2e22",
                          }}
                        >
                          {task.cleanText}
                        </span>
                      </div>
                      {task.inProgress && (
                        <div
                          style={{
                            fontSize: 9,
                            color: "#fff",
                            background: "#b07010",
                            borderRadius: 3,
                            padding: "1px 5px",
                            marginLeft: 11,
                            display: "inline-block",
                            marginTop: 2,
                          }}
                        >
                          ▶ in progress
                        </div>
                      )}
                      {task.recurrence && (
                        <div
                          style={{ fontSize: 9, color: today ? "#5a4030" : "#bbb", marginLeft: 11 }}
                        >
                          ↺ {task.recurrence}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile stack */}
      <div className="week-stack">
        {weekDays.map(date => {
          const dt = dayTasks(date);
          const today = date === TODAY;
          const fullDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          });
          return (
            <div
              key={date}
              style={{
                background: today ? "#1e1810" : "#ede8de",
                border: today ? "2px solid #b33020" : "1px solid #ccc8be",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom:
                    dt.length > 0 ? `1px solid ${today ? "#2e2010" : "#ccc8be"}` : "none",
                  background: today ? "#2e2010" : "#e0d8cc",
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: today ? "#b33020" : "#c8bfb0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: "normal",
                    color: today ? "#fff" : "#5a4a38",
                  }}
                >
                  {fmtDayNum(date)}
                </div>
                <div>
                  <div
                    style={{ fontSize: 13, color: today ? "#f2ede4" : "#1e1810", lineHeight: 1.2 }}
                  >
                    {fullDate.split(",")[0]}
                  </div>
                  <div style={{ fontSize: 11, color: "#8a7060" }}>
                    {fullDate.split(",").slice(1).join(",").trim()}
                  </div>
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    color: today ? "#6a5040" : "#aaa",
                    fontStyle: dt.length === 0 ? "italic" : "normal",
                  }}
                >
                  {dt.length === 0 ? "nothing due" : `${dt.length} task${dt.length > 1 ? "s" : ""}`}
                </div>
              </div>
              {dt.length > 0 && (
                <div style={{ padding: "8px 14px 10px" }}>
                  {dt.map(task => {
                    const m =
                      PMETA[effectivePriority(task, TODAY)] || PMETA[task.priority] || PMETA["?"];
                    return (
                      <div
                        key={task.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: "7px 0",
                          borderBottom: `1px solid ${today ? "#2e2010" : "#d8d0c4"}`,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: m.dot,
                            flexShrink: 0,
                            marginTop: 5,
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 14,
                              color: today ? "#f2ede4" : "#1e1810",
                              lineHeight: 1.4,
                            }}
                          >
                            {task.cleanText}
                          </div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: "bold",
                                color: m.accent,
                                background: today ? "#2e2010" : "#e8e2d8",
                                padding: "1px 6px",
                                borderRadius: 3,
                              }}
                            >
                              {effectivePriority(task, TODAY) || task.priority || "?"}
                            </span>
                            {task.inProgress && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "#fff",
                                  background: "#b07010",
                                  borderRadius: 3,
                                  padding: "1px 6px",
                                }}
                              >
                                ▶ in progress
                              </span>
                            )}
                            {task.recurrence && (
                              <span style={{ fontSize: 10, color: today ? "#6a5040" : "#aaa" }}>
                                ↺ {task.recurrence}
                              </span>
                            )}
                            {task.projects.map(p => (
                              <span
                                key={p}
                                style={{
                                  fontSize: 10,
                                  fontFamily: "monospace",
                                  color: "#3558b0",
                                  background: "#e8f0fe",
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                }}
                              >
                                +{p}
                              </span>
                            ))}
                            {task.contexts.map(c => (
                              <span
                                key={c}
                                style={{
                                  fontSize: 10,
                                  fontFamily: "monospace",
                                  color: "#2a7048",
                                  background: "#eef7f2",
                                  padding: "1px 5px",
                                  borderRadius: 3,
                                }}
                              >
                                @{c}
                              </span>
                            ))}
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

      {/* No-due-date section */}
      {(tasks || []).filter(
        t => !t.done && !t.dueDate && !(t.thresholdDate && t.thresholdDate > TODAY),
      ).length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#999",
              marginBottom: 10,
            }}
          >
            No due date
          </div>
          <div className="nodue-grid" style={{ flexWrap: "wrap", gap: 6 }}>
            {(tasks || [])
              .filter(t => !t.done && !t.dueDate && !(t.thresholdDate && t.thresholdDate > TODAY))
              .map(task => {
                const m =
                  PMETA[effectivePriority(task, TODAY)] || PMETA[task.priority] || PMETA["?"];
                return (
                  <div
                    key={task.id}
                    style={{
                      background: "#ede8de",
                      border: `1px solid ${m.border}`,
                      borderRadius: 4,
                      padding: "5px 10px",
                      fontSize: 12,
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: m.dot,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: m.accent, fontSize: 10, fontWeight: "bold" }}>
                      {task.priority || "?"}
                    </span>
                    <span>{task.cleanText}</span>
                  </div>
                );
              })}
          </div>
          <div
            className="nodue-stack"
            style={{
              background: "#ede8de",
              border: "1px solid #ccc8be",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {(tasks || [])
              .filter(t => !t.done && !t.dueDate && !(t.thresholdDate && t.thresholdDate > TODAY))
              .map((task, idx) => {
                const m =
                  PMETA[effectivePriority(task, TODAY)] || PMETA[task.priority] || PMETA["?"];
                return (
                  <div
                    key={task.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "11px 14px",
                      borderTop: idx > 0 ? "1px solid #d0c8bc" : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: m.accent,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: "bold",
                        flexShrink: 0,
                      }}
                    >
                      {task.priority || "?"}
                    </div>
                    <span style={{ fontSize: 14, color: "#1e1810", flex: 1 }}>
                      {task.cleanText}
                    </span>
                    {task.projects.map(p => (
                      <span
                        key={p}
                        style={{
                          fontSize: 10,
                          fontFamily: "monospace",
                          color: "#3558b0",
                          background: "#e8f0fe",
                          padding: "1px 5px",
                          borderRadius: 3,
                        }}
                      >
                        +{p}
                      </span>
                    ))}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </>
  );
}

// ─── UpcomingView ─────────────────────────────────────────────────────────────

export function UpcomingView({
  upcomingTasks,
  editingId,
  setEditingId,
  saveEdit,
  deleteTask,
  makeVisible,
  allProj,
  allCtx,
  searchQuery,
  TODAY,
}) {
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 13,
            color: "#5a4a38",
            lineHeight: 1.6,
            maxWidth: 560,
            marginBottom: 16,
          }}
        >
          These tasks have a threshold date (
          <code
            style={{ background: "#e8e0d0", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
          >
            t:
          </code>
          ) in the future — they're hidden from the daily view until that date arrives. Edit them
          freely here; they'll surface automatically when it's time.
        </div>
      </div>

      {upcomingTasks.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 15, color: "#8a7060", marginBottom: 6 }}>
            {searchQuery
              ? "No upcoming tasks match your search."
              : "No tasks with future threshold dates."}
          </div>
          {!searchQuery && (
            <div
              style={{
                fontSize: 13,
                color: "#aaa",
                maxWidth: 420,
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              Add a{" "}
              <code
                style={{ background: "#e8e0d0", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
              >
                t:YYYY-MM-DD
              </code>{" "}
              tag to any task to hide it until that date. Use the threshold date field when adding
              or editing tasks.
            </div>
          )}
        </div>
      ) : (
        <>
          {(() => {
            const byDate = {};
            upcomingTasks.forEach(t => {
              const k = t.thresholdDate;
              if (!byDate[k]) byDate[k] = [];
              byDate[k].push(t);
            });
            return Object.entries(byDate).map(([threshDate, dateTasks]) => {
              const daysUntil = Math.ceil(
                (new Date(threshDate + "T12:00:00") - new Date(TODAY + "T12:00:00")) / 86400000,
              );
              const label =
                daysUntil === 1 ? "tomorrow" : `in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
              return (
                <div key={threshDate} style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#7a5ca0",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "#7a5ca0",
                        fontWeight: "bold",
                      }}
                    >
                      Visible {label} ·{" "}
                      {new Date(threshDate + "T12:00:00").toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#aaa",
                        background: "#ede8f5",
                        borderRadius: 10,
                        padding: "1px 7px",
                      }}
                    >
                      {dateTasks.length}
                    </span>
                  </div>
                  <div
                    style={{
                      background: "#f5f0fb",
                      border: "1px solid #c9b8e8",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    {dateTasks.map((task, idx) => {
                      const m = PMETA[task.priority] || PMETA["?"];
                      const isEdit = editingId === task.id;
                      return (
                        <div
                          key={task.id}
                          style={{ borderTop: idx > 0 ? "1px solid #c9b8e8" : "none" }}
                        >
                          {isEdit ? (
                            <div style={{ padding: "10px 12px" }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#7a5ca0",
                                  marginBottom: 8,
                                  letterSpacing: "0.05em",
                                }}
                              >
                                Editing upcoming task
                              </div>
                              <TaskForm
                                task={task}
                                meta={UPCOMING_META}
                                allProjects={allProj}
                                allContexts={allCtx}
                                onSubmit={raw => saveEdit(task.id, raw)}
                                onCancel={() => setEditingId(null)}
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                padding: "10px 14px",
                                gap: 10,
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = "#ede8f5")}
                              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                            >
                              <div
                                style={{
                                  width: 22,
                                  height: 22,
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
                                {task.priority || "?"}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 14,
                                    color: "#1e1810",
                                    lineHeight: 1.4,
                                    cursor: "pointer",
                                  }}
                                  onClick={() => setEditingId(task.id)}
                                  title="Click to edit"
                                >
                                  {searchQuery
                                    ? highlight(task.cleanText, searchQuery)
                                    : task.cleanText}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    flexWrap: "wrap",
                                    marginTop: 4,
                                  }}
                                >
                                  {task.dueDate && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontFamily: "monospace",
                                        padding: "1px 5px",
                                        borderRadius: 3,
                                        background: "#e8e0f8",
                                        color: "#5a3a90",
                                        border: "1px solid #c0a8e0",
                                      }}
                                    >
                                      due {fmtDate(task.dueDate)}
                                    </span>
                                  )}
                                  {task.recurrence && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: PMETA["R"].accent,
                                        background: "#eef2fb",
                                        borderRadius: 3,
                                        padding: "1px 5px",
                                      }}
                                    >
                                      ↺ {task.recurrence}
                                    </span>
                                  )}
                                  {task.projects.map(p => (
                                    <span
                                      key={p}
                                      style={{
                                        fontSize: 10,
                                        fontFamily: "monospace",
                                        color: "#3558b0",
                                        background: "#e8f0fe",
                                        padding: "1px 5px",
                                        borderRadius: 3,
                                      }}
                                    >
                                      {searchQuery ? highlight(`+${p}`, searchQuery) : `+${p}`}
                                    </span>
                                  ))}
                                  {task.contexts.map(c => (
                                    <span
                                      key={c}
                                      style={{
                                        fontSize: 10,
                                        fontFamily: "monospace",
                                        color: "#2a7048",
                                        background: "#eef7f2",
                                        padding: "1px 5px",
                                        borderRadius: 3,
                                      }}
                                    >
                                      {searchQuery ? highlight(`@${c}`, searchQuery) : `@${c}`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexShrink: 0,
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  onClick={() => makeVisible(task.id)}
                                  title="Make visible now"
                                  style={{
                                    background: "none",
                                    border: "1px solid #c9b8e8",
                                    borderRadius: 4,
                                    padding: "3px 8px",
                                    cursor: "pointer",
                                    fontSize: 10,
                                    color: "#7a5ca0",
                                    fontFamily: "inherit",
                                  }}
                                >
                                  Show now
                                </button>
                                <button
                                  onClick={() => setEditingId(task.id)}
                                  title="Edit"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 13,
                                    color: "#c9b8e8",
                                    padding: "2px 4px",
                                  }}
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => deleteTask(task.id)}
                                  title="Delete"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 13,
                                    color: "#ddd",
                                    padding: "2px 4px",
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </>
      )}
    </>
  );
}

// ─── SomedayView ──────────────────────────────────────────────────────────────

export function SomedayView({
  somedayTasks,
  editingId,
  setEditingId,
  saveEdit,
  deleteTask,
  promoteToDaily,
  addingFor,
  setAddingFor,
  form,
  setForm,
  addSomedayTask,
  allProj,
  allCtx,
  searchQuery,
}) {
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 13,
            color: "#5a4a38",
            lineHeight: 1.6,
            maxWidth: 560,
            marginBottom: 16,
          }}
        >
          Tasks here have no due date and no priority pressure — things you might want to do
          someday, but aren't committing to yet. Promote any to today's list when you're ready to
          act on it.
        </div>
        {addingFor === "someday" ? (
          <TaskForm
            meta={PMETA["C"]}
            form={form}
            setForm={setForm}
            onSubmit={addSomedayTask}
            onCancel={() => setAddingFor(null)}
            submitLabel="Add to Someday"
            allProjects={allProj}
            allContexts={allCtx}
          />
        ) : (
          <button
            onClick={() => setAddingFor("someday")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#eef7f2",
              border: "1px dashed #9ecfb5",
              borderRadius: 6,
              padding: "8px 14px",
              cursor: "pointer",
              fontSize: 13,
              color: "#2a7048",
              fontFamily: "inherit",
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add to Someday/Maybe
          </button>
        )}
      </div>

      {somedayTasks.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>💭</div>
          <div style={{ fontSize: 15, color: "#8a7060", marginBottom: 6 }}>
            {searchQuery
              ? "No Someday tasks match your search."
              : "Your Someday/Maybe list is empty."}
          </div>
          {!searchQuery && (
            <div
              style={{
                fontSize: 13,
                color: "#aaa",
                maxWidth: 400,
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              Capture ideas, vague intentions, and "one day" goals here without the pressure of a
              deadline.
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 10,
          }}
        >
          {somedayTasks.map(task => {
            const isEdit = editingId === task.id;
            return (
              <div
                key={task.id}
                style={{
                  background: "#fdf6ed",
                  border: "1px solid #ddc898",
                  borderRadius: 8,
                  overflow: "hidden",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              >
                {isEdit ? (
                  <div style={{ padding: 12 }}>
                    <TaskForm
                      task={task}
                      meta={PMETA["C"]}
                      allProjects={allProj}
                      allContexts={allCtx}
                      onSubmit={raw => saveEdit(task.id, raw)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ padding: "12px 14px 8px" }}>
                      <div
                        style={{
                          fontSize: 14,
                          color: "#1e1810",
                          lineHeight: 1.5,
                          marginBottom: 6,
                          cursor: "pointer",
                        }}
                        onClick={() => setEditingId(task.id)}
                      >
                        {searchQuery ? highlight(task.cleanText, searchQuery) : task.cleanText}
                      </div>
                      {(task.projects.length > 0 || task.contexts.length > 0) && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {task.projects.map(p => (
                            <span
                              key={p}
                              style={{
                                fontSize: 10,
                                fontFamily: "monospace",
                                color: "#3558b0",
                                background: "#e8f0fe",
                                padding: "1px 5px",
                                borderRadius: 3,
                              }}
                            >
                              {searchQuery ? highlight(`+${p}`, searchQuery) : `+${p}`}
                            </span>
                          ))}
                          {task.contexts.map(c => (
                            <span
                              key={c}
                              style={{
                                fontSize: 10,
                                fontFamily: "monospace",
                                color: "#2a7048",
                                background: "#eef7f2",
                                padding: "1px 5px",
                                borderRadius: 3,
                              }}
                            >
                              {searchQuery ? highlight(`@${c}`, searchQuery) : `@${c}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid #e8d8b0",
                        display: "flex",
                        alignItems: "center",
                        padding: "6px 10px",
                        gap: 6,
                      }}
                    >
                      <button
                        onClick={() => promoteToDaily(task.id)}
                        style={{
                          flex: 1,
                          background: "#2a7048",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          padding: "5px 8px",
                          cursor: "pointer",
                          fontSize: 11,
                          fontFamily: "inherit",
                          textAlign: "center",
                        }}
                      >
                        📋 Do Today
                      </button>
                      <button
                        onClick={() => setEditingId(task.id)}
                        style={{
                          background: "none",
                          border: "1px solid #ddc898",
                          borderRadius: 4,
                          padding: "5px 8px",
                          cursor: "pointer",
                          fontSize: 11,
                          color: "#8a7060",
                          fontFamily: "inherit",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          color: "#ccc",
                          padding: "0 4px",
                        }}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
