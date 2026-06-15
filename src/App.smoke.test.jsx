/**
 * App.smoke.test.jsx — component render smoke tests
 *
 * These tests mount the real App component and assert it renders without
 * throwing. They catch "X is not defined" runtime errors that pure-logic
 * tests cannot see (because those tests never touch React or the DOM).
 *
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

// ── Stub browser APIs not present in jsdom ──────────────────────────────────

// Dropbox / localStorage: return no stored tokens so the app loads sample data
// instead of trying to fetch from Dropbox
beforeEach(() => {
  localStorage.clear();
});

// window.location — jsdom sets origin/pathname, which dropbox.js reads for
// DBX_REDIRECT. No stubs needed; it just resolves to "http://localhost/".

// fetch — stub so NASA APOD and any Dropbox calls don't actually fire
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
));

// File System Access API — not in jsdom
vi.stubGlobal('showOpenFilePicker', vi.fn(() => Promise.reject(new DOMException('', 'AbortError'))));

// crypto.subtle — used by PKCE; jsdom has crypto but not subtle in all versions
if (!globalThis.crypto?.subtle) {
  vi.stubGlobal('crypto', {
    getRandomValues: (buf) => { buf.fill(1); return buf; },
    subtle: {
      digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
    },
  });
}

// ── Smoke tests ─────────────────────────────────────────────────────────────

describe('App smoke test', () => {
  it('renders without throwing', () => {
    // If any hook return value is missing from the destructure in App(),
    // this will throw a ReferenceError and fail the test.
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders the app header', () => {
    render(<App />);
    expect(screen.getByText('Daily Task Planner')).toBeTruthy();
  });

  it('renders the Daily tab by default', () => {
    render(<App />);
    expect(screen.getByText(/Today/i)).toBeTruthy();
  });

  it('renders priority group headers with sample data', () => {
    render(<App />);
    // PMETA labels rendered by Group component
    expect(screen.getByText(/A — Vital/i)).toBeTruthy();
    expect(screen.getByText(/B — Important/i)).toBeTruthy();
  });
});
