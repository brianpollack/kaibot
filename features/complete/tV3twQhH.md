Feature ID: tV3twQhH

If we click the word "Project" in the top bar it should return to the project selection.  This should not be clickable while the agent is currently processing a feature.

## Plan

- [x] 1. Add `deactivateProject()` method to WebServer that resets state to "waiting" — added to WebServer.ts, stops NpmCommandRunner, resets state, notifies WS clients
- [x] 2. Add `/api/deselect-project` POST endpoint in routes.ts — HMAC-protected, blocks if processing or already waiting
- [x] 3. Listen for "project-deactivated" event in kai_bot.ts to stop the bot and reset UI state — stops bot, resets feature/conversation/status in uiStore
- [x] 4. Make the "Project" `<kbd>` element clickable in templates.ts — added role="button", tabindex, id, and project-selector class
- [x] 5. Add client-side click handler in client.js — deselectProject() function, WS project-deactivated handler for reload, updateDOM toggles disabled state
- [x] 6. Add CSS styling for the clickable Project label — cursor, hover, and disabled state with opacity and not-allowed cursor

## Summary

Implemented clickable "Project" label in the top status bar that returns the user to the project selection screen. Changes span the full stack:

- **WebServer.ts**: Added `deactivateProject()` method that stops the NpmCommandRunner, resets server state to "waiting", and broadcasts a `project-deactivated` WebSocket message to all clients.
- **routes.ts**: Added HMAC-protected `POST /api/deselect-project` endpoint that validates the server isn't already waiting and the agent isn't processing before calling `deactivateProject()`.
- **kai_bot.ts**: Added `project-deactivated` event handler that stops the current bot, cleans up event listeners, and resets the UI store state. Tracked the current bot instance via a `let` variable.
- **templates.ts**: Added `role="button"`, `tabindex="0"`, `id="project-trigger"`, and `project-selector` class to the Project status item.
- **client.js**: Added `deselectProject()` function that blocks when `state.status === "processing"`, a WS handler for `project-deactivated` that reloads the page, and `updateDOM` logic to toggle the disabled appearance.
- **main.css**: Added `.project-selector` styles with cursor pointer, hover background, and `.disabled` state with reduced opacity and `cursor: not-allowed`.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $2.1133
- **Turns:** 74
- **Time:** 400.6s
