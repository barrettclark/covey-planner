import "@testing-library/react/pure";

// Silence navigator.setAppBadge / clearAppBadge (not in jsdom)
Object.defineProperty(navigator, "setAppBadge", {
  value: () => Promise.resolve(),
  configurable: true,
});
Object.defineProperty(navigator, "clearAppBadge", {
  value: () => Promise.resolve(),
  configurable: true,
});
