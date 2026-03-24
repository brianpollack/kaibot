Feature ID: wo0y5QVZ

Update the WebUI
- Remove Model from the left, we already have it on the top.
- Create a reusable popup menu where each selectable item have a keyboard values from 1 to 9
  and up and down arrows to scroll if the list is longer than 9.  It should be mouse compatible
  as well.

  This popup menu should be tied to the M key or clicking on the model at the top.
  It should function like the InkUI version.
  Get a list of available models and present that to the user
  communicate back to the web server / KaiBot  and update the webui and InkJS

## Plan

- [x] 1. Remove the "Model" nav item from the left sidebar — removed from templates.ts
- [x] 2. Make the model display in the top bar clickable — added role=button, tabindex, aria attrs in templates.ts
- [x] 3. Create the reusable popup menu component in client.js — PopupMenu with 1-9 keys, arrows, Enter/Escape, mouse hover/click
- [x] 4. Wire up M key and model click to open the popup — openModelSelector() fetches /api/models, opens popup anchored to trigger
- [x] 5. Add API endpoint for model list and model change WebSocket message handling — /api/models route + ws "select-model" handler
- [x] 6. Add CSS styles for the popup menu overlay — dark theme popup with scroll indicators, active badge, key badges
- [x] 7. Handle model selection: send to server via WebSocket, update uiStore and web UI — ws.send select-model, uiStore.selectModel() broadcasts

## Summary

Updated the Web UI to remove the duplicate "Model" entry from the left sidebar navigation and made the model display in the top status bar clickable.

Created a reusable `PopupMenu` component in `client.js` that supports:
- **Keyboard**: Number keys 1–9 for quick selection, Up/Down arrows to navigate (with scrolling for lists > 9 items), Enter to confirm, Escape to close
- **Mouse**: Click to select, hover to highlight, click overlay to dismiss

The model selector popup is triggered by pressing **M** or clicking the model in the top bar. It fetches available models from a new `/api/models` endpoint, displays them with descriptions and an "active" badge for the current model, and sends the selection back to the server via WebSocket (`select-model` message). The server updates `uiStore.selectModel()` which broadcasts the change to all connected clients (web UI and Ink terminal).

**Files changed:**
- `src/web/templates.ts` — removed Model nav item, made top-bar model clickable
- `src/web/routes.ts` — added `/api/models` API endpoint
- `src/web/wsHandler.ts` — added `select-model` WebSocket message handler
- `web/static/html/client.js` — added reusable PopupMenu, model selector, M key binding
- `web/static/css/main.css` — added popup menu styles (dark theme, key badges, scroll indicators)

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.1440
- **Turns:** 26
- **Time:** 232.1s
