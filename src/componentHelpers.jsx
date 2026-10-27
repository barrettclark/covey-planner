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

// Shared text style objects for help modal
export const hp = { fontSize: 13, color: C.textMuted, lineHeight: 1.6, margin: "0 0 4px" };
export const ul = { margin: "8px 0 0 0", paddingLeft: 20 };
export const li = { fontSize: 13, color: C.textMuted, lineHeight: 1.7, marginBottom: 2 };
