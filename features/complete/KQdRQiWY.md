Feature ID: KQdRQiWY

When the KaiBot agent writes or edits files in the target project, it tracks those operations via `routeToolUse()` in `KaiAgent.ts`. If the agent modifies `package.json` (e.g., adding new scripts), the browser's npm commands list should reliably refresh. Currently, `NpmCommandRunner` uses `fs.watch` on `package.json` to detect changes and emit a `scripts-changed` event, but `fs.watch` is not always reliable (particularly when changes come through the Claude Agent SDK's sandboxed file tools). The fix should add an explicit, event-driven notification path so that when the agent touches `package.json`, the server proactively broadcasts the updated script list to all connected browser clients.

**Current flow (unreliable):**
1. Agent writes/edits `package.json` via SDK tool
2. `fs.watch` in `NpmCommandRunner.watchPackageJson()` _may_ fire
3. `scripts-changed` event → WebServer broadcasts `npm-scripts-updated` → client calls `loadNpmScripts()`

**Desired flow (add explicit trigger):**
1. Agent writes/edits `package.json` via SDK tool
2. `routeToolUse()` in `KaiAgent.ts` detects the file path ends with `package.json`
3. An event or direct call notifies the WebServer to broadcast `npm-scripts-updated`
4. Client calls `loadNpmScripts()` and re-renders the commands list

**Implementation notes:**
- In `routeToolUse()` (`src/KaiAgent.ts`), when a Write or Edit tool targets a path ending in `package.json`, emit an event or call a method that triggers the npm scripts refresh. The `uiStore` (from `src/ui/store.ts`) already emits events and is the natural place to add a new event (e.g., `"package-json-changed"`), or you could add a dedicated method.
- In `src/web/wsHandler.ts` or `src/web/WebServer.ts`, listen for that event and broadcast `{ type: "npm-scripts-updated" }` to all WebSocket clients — the same message the existing `fs.watch` path sends.
- Keep the existing `fs.watch` mechanism as a fallback; it costs nothing and covers cases outside the agent (manual edits, git operations, etc.).
- Add a small debounce (~300ms, matching the existing `pkgDebounceTimer`) to avoid duplicate refreshes if both `fs.watch` and the explicit trigger fire for the same edit.

**Acceptance criteria:**
- [ ] When the agent edits or writes `package.json` in the target project, the browser npm commands list updates within ~1 second without requiring a page reload.
- [ ] The existing `fs.watch` fallback remains functional.
- [ ] No duplicate `npm-scripts-updated` broadcasts when both triggers fire (debounce).
- [ ] Add a test verifying that a Write or Edit to a `package.json` path triggers the refresh event/broadcast.

## Plan

- [x] 1. Add a `"package-json-changed"` event emission to `uiStore` in `routeToolUse()` when Write/Edit targets a path ending in `package.json` — added detection in `routeToolUse()` in `src/KaiAgent.ts`
- [x] 2. In `wsHandler.ts`, listen for `"package-json-changed"` on `uiStore` and broadcast `{ type: "npm-scripts-updated" }` with a 300ms debounce — also routed `fs.watch` path through same debounce in `WebServer.ts`
- [x] 3. Add a test verifying that `routeToolUse()` emits `"package-json-changed"` when a Write/Edit targets `package.json`, and does NOT emit for other files — added `src/__tests__/routeToolUse.test.ts` with 5 tests (all passing)

## Summary

Added an explicit, event-driven notification path so that when the Claude agent writes or edits `package.json` via SDK tools, the browser npm commands list refreshes reliably. In `routeToolUse()` (KaiAgent.ts), Write/Edit operations targeting a path ending in `package.json` now emit a `"package-json-changed"` event on `uiStore`. In `wsHandler.ts`, a debounced listener broadcasts `{ type: "npm-scripts-updated" }` to all WebSocket clients. The existing `fs.watch` fallback in `NpmCommandRunner` was rerouted through the same `uiStore` event and debounce window (300ms), ensuring no duplicate broadcasts when both triggers fire for the same edit. Five unit tests verify the detection logic.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.7088
- **Turns:** 24
- **Time:** 143.5s
