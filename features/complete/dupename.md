Feature ID: CjTHaYWs

If a feature added the the features folder duplicates the filename in inprogress or complete
append the unique ID to the filename like "dupename-<unique id>.md" to avoid
overwriting historical feature files.

## Plan

- [x] 1. Add `deconflictPath` helper in `feature.ts` that appends featureId to filename when target already exists — added exported helper using `existsSync`; falls back to `name-<id>.md` on collision
- [x] 2. Apply deconfliction in `markInProgress`, `markComplete`, and `markHold` — all three transition functions now use `deconflictPath`; returned Feature reflects updated `name` and `filePath`
- [x] 3. Add tests for the duplicate-name collision behavior in `feature.test.ts` — added `deconflictPath` unit tests plus collision tests for all three transition functions (30 tests, all pass)

## Summary

Added duplicate filename protection to the feature state machine. The new exported `deconflictPath` helper checks whether a target path already exists before any move; if it does, it appends the feature's unique ID to the stem (`dupename-<id>.md`). This deconfliction is applied in `markInProgress`, `markComplete`, and `markHold` — the returned `Feature` object reflects the updated `name` and `filePath` so subsequent transitions chain correctly. Covered by 7 new tests in `feature.test.ts` (3 for `deconflictPath` directly, 1 collision test per transition function).
## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.4370
- **Turns:** 21
- **Time:** 148.5s
