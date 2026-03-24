Feature ID: Mvt1ERao

Update the menu on the left of the WebUI for a new menu item "Features"
which appears just under Dashboard.

Change the hot key for "New Feature" to "N"
Add the key "F" for the Features list.

Pressing "F" or selecting Features from the menu will hide the Dashbaord converation
and open a list of features.   The features list is a dock with 2 parts,
the top is Pending  features and the bottom is Complete features.

Complete features is taken from the json files in features/log/
Pending is taken from the list of files in features/ and features/hold/

## Plan

- [x] 1. Add `/api/features` endpoint in `routes.ts` to serve pending and complete feature lists — added `getFeaturesList()` helper and `/api/features` route in `routes.ts`
- [x] 2. Update `templates.ts`: add "Features" nav item after Dashboard, change "New Feature" hotkey kbd to "N", add hidden `#features-view` HTML — updated `templates.ts` nav and added features-view main element
- [x] 3. Add CSS for the features view (two-panel dock) to `main.css` — added `#features-view`, `#features-panels`, feature list item styles to `main.css`
- [x] 4. Update `client.js`: change F hotkey to open features view, add N hotkey for new feature, add view switching logic and features rendering — added `showDashboardView()`, `showFeaturesView()`, `loadFeaturesData()`, render helpers, and updated keyboard/click handlers in `client.js`

## Summary

Added a "Features" menu item to the left nav (between Dashboard and New Feature) with hotkey **F**. The hotkey for "New Feature" was changed from **F** to **N** throughout the nav and keyboard handler.

Pressing **F** (or clicking Features in the nav) hides the Dashboard panels and opens a two-panel features dock:
- **Pending Features** (top): reads `features/*.md` and `features/hold/*.md`, displays filename and extracted title with a colour-coded "pending" or "hold" badge
- **Complete Features** (bottom): reads `features/log/*.json`, sorted newest-first, shows description, completion date, and summary excerpt with a status badge

The `/api/features` endpoint was added in `routes.ts` backed by a `getFeaturesList()` helper. CSS for the features view panels and list items was added to `main.css`. Pressing **D** or clicking Dashboard returns to the standard dashboard view.
## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.7921
- **Turns:** 26
- **Time:** 282.2s
