// ─── Theme tokens ─────────────────────────────────────────────────────────────
// Single source of truth for the app's warm parchment/sepia palette.
// Import named tokens instead of using raw hex values.

// ── Base palette ──────────────────────────────────────────────────────────────

export const C = {
  // Dark browns / ink
  ink: "#1e1810", // primary text, header bg
  inkDeep: "#160e08", // filter bar bg
  inkMid: "#2e2010", // header button bg, input bg, dark separators
  inkLight: "#3a2e20", // borders in dark areas
  inkFaint: "#6a5040", // muted text in dark context

  // Parchment / cream
  parchment: "#f2ede4", // app background, active tab bg
  parchmentMid: "#ede8de", // card / done-list bg
  parchmentDeep: "#e0d8cc", // weekly mobile header bg

  // Sand / warm neutrals
  sand: "#c8b89a", // header text, links
  sandMid: "#a89878", // muted sand
  sandDim: "#9a8a78", // sub-labels
  sandFaint: "#8a7060", // placeholder, light labels

  // Text levels
  textPrimary: "#1e1810",
  textSecondary: "#5a4a38",
  textMuted: "#3a2e20",
  textFaint: "#8a7060",

  // Priority: A (vital / red)
  redAccent: "#b33020",
  redBg: "#fdf0ee",
  redBorder: "#ddb5b0",

  // Priority: B (important / amber)
  amberAccent: "#b07010",
  amberBg: "#fdf6ed",
  amberBorder: "#ddc898",

  // Priority: C (nice-to-do / green)
  greenAccent: "#2a7048",
  greenBg: "#eef7f2",
  greenBorder: "#9ecfb5",

  // Priority: R (recurring / blue)
  blueAccent: "#3558b0",
  blueBg: "#eef2fb",
  blueBorder: "#9db5e0",

  // Upcoming view (purple)
  purpleAccent: "#7a5ca0",
  purpleBg: "#f5f0fb",
  purpleBorder: "#c9b8e8",

  // Status / utility
  white: "#fff",
  disabled: "#aaa",
  disabledAlt: "#bbb",
  disabledFaint: "#ccc",
  disabledDeep: "#ddd",
  neutral: "#888",
  neutralDark: "#999",

  // Project / context tag colours
  projText: "#3558b0",
  projBg: "#e8f0fe",
  projBorder: "#b8d0f0",
  ctxText: "#2a7048",
  ctxBg: "#eef7f2",
  ctxBorder: "#9ecfb5",

  // Due-date badge colours
  overdueText: "#b33020",
  overdueBg: "#fde8e5",
  overdueBorder: "#f5c2bc",
  dueTodayText: "#856404",
  dueTodayBg: "#fff3cd",
  dueTodayBorder: "#ffc107",
  dueFutureBg: "#e8f0fe",
  dueFutureText: "#3558b0",
  dueFutureBorder: "#b8d0f0",

  // Dropbox status indicator
  syncOk: "#7ec8a0",
  syncSaving: "#e8c97a",
  syncError: "#e07070",
};

// ── Shared font stack ─────────────────────────────────────────────────────────

export const FONT_SERIF = "'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif";

// ── Shared radius / spacing tokens ────────────────────────────────────────────

export const RADIUS = {
  sm: 3,
  md: 4,
  lg: 6,
  xl: 8,
  xxl: 10,
  pill: 20,
  full: "50%",
};
