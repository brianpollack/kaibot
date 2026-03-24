Feature ID: 1ndLYHYN

Selecting New Feature (N) from the web ui should open a popup dialog window.  This window should
ask for a feature title and description.

The feature description should be a Markdown editor such as ACE or any other light weight
markdown text editor.

The popup should have a Save button which submits it as a new feature to the server.
The server will then assign a unique ID and save it to the features folder by unique id.md file.
The popup also has a Hold button.  If hold is pressed, the file is still saved to the server but
placed in the features/hold/ folder instead.

## Plan

- [x] 1. Add POST /api/features endpoint in routes.ts to accept title+description, generate unique ID, and save to features/ or features/hold/ — added readBody helper, POST /api/features handler with generateFeatureId
- [x] 2. Add New Feature dialog HTML to templates.ts with title input, markdown textarea with toolbar, Save and Hold buttons — added dialog overlay with title input, md toolbar, textarea, Save/Hold buttons
- [x] 3. Add CSS styles for the new feature dialog in main.css — added dialog overlay, box, header, body, toolbar, textarea, buttons, error styles
- [x] 4. Add client-side JS in client.js for opening/closing the dialog, markdown toolbar actions, and submitting via fetch POST — added openNewFeatureDialog, closeNewFeatureDialog, submitNewFeature, applyMarkdownAction
- [x] 5. Wire up the N key shortcut and nav-feature click to open the new feature dialog — updated keydown handler, added click handlers for nav-feature, dialog buttons, overlay close, md toolbar
- [x] 6. Verify typecheck and lint pass — both npm run typecheck and npm run lint pass cleanly

## Summary

Implemented a New Feature dialog popup in the KaiBot web UI. Pressing **N** or clicking the "New Feature" nav item opens a modal dialog with:

- **Title field** — text input for the feature name
- **Markdown editor** — a textarea with a formatting toolbar (bold, italic, heading, bullet/numbered lists, code, link) that inserts Markdown syntax at the cursor
- **Save button** — submits the feature via `POST /api/features`, which generates a unique 8-char ID and saves as `features/<id>.md`
- **Hold button** — same submission but saves to `features/hold/<id>.md` instead

Files changed:
- `src/web/routes.ts` — added `POST /api/features` endpoint with `readBody` helper, uses `generateFeatureId()` from feature.ts
- `src/web/templates.ts` — added dialog HTML with title input, markdown toolbar, textarea, Save/Hold buttons
- `web/static/css/main.css` — added dialog overlay, box, header, body, toolbar, textarea, button, and error styles
- `web/static/html/client.js` — added `openNewFeatureDialog`, `closeNewFeatureDialog`, `submitNewFeature`, `applyMarkdownAction` functions; wired up N key, nav click, dialog buttons, and overlay dismiss


## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.2994
- **Turns:** 26
- **Time:** 254.8s
