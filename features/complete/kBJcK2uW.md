Feature ID: kBJcK2uW

Implement a "Working" / "Busy" modal dialog in the web UI that displays while the "Submit to Assistant" API call (`/api/features/assist`) is processing, replacing the current inline "Working…" button text with a visually engaging overlay.

**Visual Design:**
- Full-screen semi-transparent overlay (same pattern as the existing `#new-feature-overlay` modal in `client.js`)
- Centered card/panel containing:
  1. The image `images/robot_working.png` (asset must be created or placed in `web/static/images/`)
  2. A CSS-animated spinning cursor/spinner beneath or beside the image
  3. A randomly cycling phrase displayed below the spinner, updating every 3–4 seconds

**Cycling Phrases:**
Pre-populate an array of ~100 humorous/nonsensical phrases. Examples:
- "Thinking hard…"
- "Updating the rule book…"
- "Learning to spell…"
- "Reticulating splines…"
- "Consulting the oracle…"
- "Untangling spaghetti code…"
- "Polishing the pixels…"
- "Feeding the hamsters…"
- "Calibrating the flux capacitor…"
- "Asking the rubber duck…"
- "Herding semicolons…"
- "Compiling excuses…"
- (add ~90 more in this style)

A `setInterval` (every 3–4 seconds) randomly selects a new phrase from the array (avoiding consecutive repeats).

**Lifecycle / Integration:**
- **Open:** Call `showWorkingDialog()` at the start of `submitToAssistant()` in `web/static/html/client.js`, right before the `signedFetch` call to `/api/features/assist`.
- **Close:** Call `hideWorkingDialog()` when the fetch resolves (success or error), before updating the form fields or showing error messages.
- The existing button-disable logic and "Working…" text on `#nf-assist` can remain as a fallback, or be removed in favor of the dialog — implementer's choice.
- Ensure the working dialog sits above the new-feature overlay in z-index stacking order.
- Clear the phrase-cycling interval on close to avoid memory leaks.

**Acceptance Criteria:**
1. A `robot_working.png` image exists in `web/static/images/` (the developer must supply or generate this asset; if it doesn't exist at implementation time, use a placeholder or the existing `thinking64x64.png` and leave a TODO comment).
2. The working dialog appears immediately when "Submit to Assistant" is clicked and disappears when the API response is received.
3. The spinner animates continuously via CSS (no JS animation frames needed).
4. The phrase text changes every 3–4 seconds to a random entry from the phrases array, never showing the same phrase twice in a row.
5. If the API call errors out, the dialog still closes and the error is shown to the user.
6. The dialog is styled consistently with the existing dark-themed UI (see `web/static/html/kaibot.css` and the existing new-feature overlay styles).
7. The dialog cannot be dismissed by clicking outside it — it only closes programmatically when the API call finishes.

**Technical Notes:**
- All changes are in the web UI layer: `web/static/html/client.js` (dialog logic + phrases array) and `web/static/html/kaibot.css` (styles + spinner animation).
- Follow the existing modal pattern from `openNewFeatureDialog()` / `closeNewFeatureDialog()` for DOM structure and overlay behavior.
- This is purely UI work — **tests should NOT be added**.

## Plan

- [x] 1. Add CSS styles for the working dialog (overlay, card, spinner animation, phrase text) to `web/static/css/main.css` — added `.working-overlay`, `.working-card`, `.working-spinner` (with `@keyframes working-spin`), `.working-phrase` styles at z-index 1300
- [x] 2. Add the working dialog HTML markup to the template in `src/web/templates.ts` — added `#working-overlay` div with image (using `thinking64x64.png` placeholder with TODO), spinner, and phrase element
- [x] 3. Add the phrases array (~100 entries) and `showWorkingDialog()` / `hideWorkingDialog()` functions to `web/static/html/client.js` — added 100 humorous phrases, show/hide functions with setInterval cycling (3.5s), no consecutive repeats, opacity fade transition, interval cleanup on close
- [x] 4. Integrate `showWorkingDialog()` / `hideWorkingDialog()` into `submitToAssistant()` in `client.js` — `showWorkingDialog()` called before `signedFetch`, `hideWorkingDialog()` called in `.finally()` block
- [x] 5. Verify with typecheck and lint — passes with zero new errors

## Summary

Implemented a "Working" modal dialog that displays a full-screen overlay when the user clicks "Submit to Assistant". The overlay includes the existing `thinking64x64.png` image (with a TODO to replace with `robot_working.png`), a CSS-animated spinner, and a randomly cycling phrase from an array of 100 humorous messages that updates every 3.5 seconds with a fade transition. The dialog opens immediately before the `/api/features/assist` API call and closes programmatically when the response arrives (success or error). It sits above all other overlays at z-index 1300 and cannot be dismissed by clicking outside. Files changed: `web/static/css/main.css`, `src/web/templates.ts`, `web/static/html/client.js`.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.6513
- **Turns:** 37
- **Time:** 167.5s
