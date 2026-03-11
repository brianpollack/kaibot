Let's update the UI to use the node ink (inkjs) library for a full screen colorful interface.

The top should indicate that KaiBot is running and the folder.
Next we should have 6 lines to indicate the thinking process where the lines scroll leaving the latest output and past output above it.
We should have another section to clearly indicate command(s) being run and recent command history
We should show a few lines of the current Read/Write output with colors for Read and Write

While waiting for a file, clearly indicate "Watching folder xxxx for Feature"

## Plan

- [x] 1. Install dependencies: `ink`, `react`, `@types/react` and update tsconfig for JSX — added ink@6.8.0, react, @types/react; set `"jsx": "react-jsx"` in tsconfig.json
- [x] 2. Create `src/ui/store.ts` — centralized UI state store with event emitter for thinking lines, commands, file ops, status — created singleton UIStore
- [x] 3. Create `src/ui/App.tsx` — main Ink component with Header, ThinkingPanel, CommandPanel, FileOpsPanel, and StatusBar — all sections with colors
- [x] 4. Create `src/ui/render.ts` — entry point to mount/unmount the Ink app — mountUI/unmountUI with singleton Instance
- [x] 5. Update `src/KaiAgent.ts` — feed streamed messages into the UI store (thinking, tool calls, file ops) — routes text→thinking, Bash→commands, Read/Write/Edit→fileOps
- [x] 6. Update `src/KaiBot.ts` — replace console.log with UI store updates for status and feature lifecycle — all log calls replaced with uiStore methods
- [x] 7. Update `src/kai_bot.ts` — render the Ink app at startup, unmount on exit — mountUI() at start, unmountUI() on SIGINT/SIGTERM
- [x] 8. Run typecheck, lint, and tests to ensure everything passes — all 106 tests pass, typecheck clean, lint clean

## Summary

Implemented a full-screen colorful terminal UI using Ink (React for CLI) with the following components:

- **`src/ui/store.ts`** — Singleton `UIStore` (EventEmitter-based) managing all UI state: bot status, project info, thinking lines (last 6), command history (last 5), file operations (last 4), and status messages.
- **`src/ui/App.tsx`** — Ink React component with 5 panels: Header (bot status + project/model), ThinkingPanel (6 scrolling lines of assistant text), CommandPanel (active/recent Bash commands), FileOpsPanel (color-coded Read/Write/Edit operations), and StatusBar (bottom status line with "Watching folder xxx for features" message).
- **`src/ui/render.ts`** — `mountUI()`/`unmountUI()` functions for starting/stopping the Ink renderer.
- **`src/KaiAgent.ts`** — Updated to route streamed SDK messages into the UI store: text blocks → thinking panel, Bash tool calls → command panel, Read/Write/Edit → file ops panel.
- **`src/KaiBot.ts`** — Replaced all `console.log` calls with `uiStore` method calls for status tracking.
- **`src/kai_bot.ts`** — Mounts the Ink UI at startup and unmounts on SIGINT/SIGTERM.
- **Dependencies**: Added `ink@6.8.0`, `react`, `@types/react`; added `"jsx": "react-jsx"` to tsconfig.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $2.0899
- **Turns:** 75
- **Time:** 456.8s
