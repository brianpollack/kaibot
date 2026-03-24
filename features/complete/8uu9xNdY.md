Feature ID: 4IflsFcy

Feature ID: 8uu9xNdY

Add a cost column on the features history list table

## Plan

- [x] 1. Add `totalCostUsd` to the `CompleteFeature` interface and populate it in `getFeaturesList()` in `src/web/routes.ts` — added field to interface and populated from log JSON
- [x] 2. Update `renderCompleteFeatures()` in `web/static/html/client.js` to display the cost for each feature — added `formatCost()` helper and cost span to each item
- [x] 3. Add CSS styling for the cost display in `web/static/css/main.css` — added `.feature-list-cost` with green badge styling
- [x] 4. Verify typecheck and lint pass — typecheck clean, lint clean (only pre-existing warnings), routes tests pass

## Summary

Added a cost column to the features history list in the web UI. The `CompleteFeature` interface in `src/web/routes.ts` now includes `totalCostUsd`, which is read from the feature log JSON files. The client-side `renderCompleteFeatures()` in `web/static/html/client.js` displays the cost as a green badge on the right side of each feature item using a new `formatCost()` helper. CSS styling was added in `web/static/css/main.css` with the `.feature-list-cost` class matching the existing design language.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0604
- **Turns:** 28
- **Time:** 132.9s
