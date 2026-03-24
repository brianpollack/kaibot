We are going to update how features are managed on the local file system.
Currently features are found in the features/ folder as markdown files.
When a feature is processed it's filename is changed to _inprogress and finally _complete.

TODO:

- Intsead of changing the name to _inprogress, use the folder features/inprogress/
- Instead of changing the name to _complete, use the folder features/complete/
- If a feature fails or requires additional information, use folder features/hold
- If you have questions leave the question as ## Information Needed in the hold file and when the user is ready, they can move the file with the answer back to the features/ folder.
- Assign each feature a unique ID using nanoid or another URL compatible short uuid format.   Add this to the files as they are prcoessed as Feature ID: <unique id>.  Add the same ID to git commits as well.
- When a feature is complete, add the complete summary package .json as features/log/<unique id>.json
- As you write to inprogress, add a ## Plan section with the complete plan in a standard markdown format.

## Plan

- [x] 1. Add nanoid dependency (or implement short URL-safe ID generator) for unique feature IDs — using `crypto.randomBytes` with base64url encoding (no new dependency needed)
- [x] 2. Update `feature.ts` — changed `markInProgress` to move to `features/inprogress/`, added `markHold` for `features/hold/`, added `generateFeatureId()` using `crypto.randomBytes`, updated `parseFeature` to detect state from parent dir name, kept legacy suffix detection for backward compat
- [x] 3. Update `KaiBot.ts` — ensureFeaturesDir creates inprogress/complete/hold/log subdirs, markHold on errors with `## Information Needed`, writeFeatureLog for `features/log/<id>.json`, feature ID assigned via generateFeatureId and prepended to file, passed to commit
- [x] 4. Update `commit.ts` — `buildCommitMessage` and `promptAndCommit` now accept optional featureId, appended as `[featureId]` to commit messages
- [x] 5. Update tests in `feature.test.ts` — adapted all tests to folder-based transitions, added `markHold` and `generateFeatureId` test suites, updated `parseFeature` tests for directory-based state detection
- [x] 6. Update tests in `KaiBot.test.ts` — adapted to inprogress/ folder moves, hold/ on error, ensureFeaturesDir creates all subdirs
- [x] 7. Run typecheck, lint, and tests to verify everything passes — all pass (190 tests, 12 skipped smoke tests unrelated to changes)

## Summary

Replaced the filename-based feature state machine (`_inprogress.md` / `_complete.md` suffixes) with a folder-based approach using `features/inprogress/`, `features/complete/`, and `features/hold/` subdirectories. Added a new `markHold()` function that moves failed features to `features/hold/` with an `## Information Needed` section containing the error message — users can resolve the issue and move the file back to `features/` to retry. Each feature is now assigned a unique 8-character URL-safe ID (generated via `crypto.randomBytes` base64url encoding) that is prepended to the feature file as `Feature ID: <id>`, included in git commit messages as `[<id>]`, and used as the filename for a completion summary JSON written to `features/log/<id>.json`. All existing tests were updated and new test suites added for `generateFeatureId`, `markHold`, and folder-based `parseFeature` detection. Legacy `_inprogress`/`_complete` filename detection is preserved in `parseFeature` for backward compatibility.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.8433
- **Turns:** 46
- **Time:** 325.5s
