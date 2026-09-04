# covey-task

A Franklin Covey-inspired daily planner built on the [todo.txt](https://github.com/todotxt/todo.txt) plain-text format. Tasks are prioritized A/B/C/R, synced via Dropbox, and designed to interoperate with SwiftDo, a vim todo.txt plugin, and the Obsidian todo.txt plugin.

**Live app:** https://covey-task.netlify.app/

## Local Development

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

## Environment Variables

The Dropbox OAuth client key is read from an environment variable at build time.

**Local dev** — create `.env.local` in the project root (gitignored):

```
VITE_DROPBOX_APP_KEY=your_app_key_here
```

**Netlify (production)** — add `VITE_DROPBOX_APP_KEY` in:
Site settings → Environment variables → Add variable

A new deploy must be triggered after setting the variable for it to take effect.

## todo.txt Extensions

This app uses the standard todo.txt format with the following custom tags:

| Tag       | Example             | Description                                                              |
| --------- | ------------------- | ------------------------------------------------------------------------ |
| `rec:`    | `rec:1w`            | Recurrence interval (`1d`, `1w`, `1m`, `1y`, `1wd`)                      |
| `t:`      | `t:2026-06-15`      | Threshold date — task hidden until this date (Simpletask-compatible)     |
| `seq:`    | `seq:3`             | Display order within a priority group (drag-and-drop position)           |
| `status:` | `status:inprogress` | In-progress indicator (stripped from display)                            |
| `pri:`    | `pri:A`             | Preserved priority on completed tasks for forensics (SwiftDo-compatible) |

Completed tasks serialize as `x DATE text pri:X` (not the canonical `x DATE (X) text` form) for SwiftDo round-trip compatibility.

The Dropbox sync path is `/Apps/Obsidian/v1/todo.todotxt`.
