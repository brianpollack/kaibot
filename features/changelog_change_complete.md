The changelog is written as the feature is typed.  Example of something you added:
Let's update the UI to use the node ink (inkjs) library for a full screen colorful interface.

Instead it should be written as a summary without personal note.  A better way to say the above is
Updatd UI to use inkjs (https://github.com/vadimdemedes/ink)

## Plan

- [x] 1. Update `extractDescription` in `changelog.ts` to prefer the `## Summary` section content over the first content line — extracted logic into `extractDescription()` function, exported for testing
- [x] 2. Update existing tests and add new tests for Summary-based extraction in `changelog.test.ts` — added integration tests for Summary preference, fallback, and heading stop; added unit tests for `extractDescription`
- [x] 3. Run tests to verify everything passes — all 15 tests pass, typecheck and lint clean

## Summary

Changed changelog description extraction to prefer the `## Summary` section (written by the agent after completing a feature) over the raw first content line from the feature file. This produces concise, impersonal changelog entries instead of conversational descriptions. Added `extractDescription()` as an exported helper in `changelog.ts` with full test coverage.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.4301
- **Turns:** 23
- **Time:** 143.5s
