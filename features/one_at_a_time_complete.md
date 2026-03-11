Only run one feature at a time for a given folder.   It is okay to keep a queue and run other features in order but no need to scan for files while running a feature.

## Plan

- [x] 1. Refactor `checkForNewFeatures` in KaiBot.ts to await `handleFeature` instead of fire-and-forget, processing only the first new feature found per poll cycle — changed to `await` + `return` after first feature
- [x] 2. Remove the `processing` Set since sequential execution eliminates the need for double-processing prevention — removed Set and finally block
- [x] 3. Update tests in KaiBot.test.ts to reflect sequential one-at-a-time behavior — replaced concurrency/double-processing tests with sequential processing tests
- [x] 4. Run typecheck and tests to verify everything passes — all 13 tests pass, typecheck and lint clean

## Summary

Changed KaiBot from concurrent fire-and-forget feature processing to sequential one-at-a-time execution. `checkForNewFeatures()` now awaits `handleFeature()` for the first ready feature it finds then returns, so no scanning occurs while a feature is being processed. The `processing` Set was removed since sequential execution makes double-processing impossible. Tests were updated to verify single-feature-per-poll-cycle behavior and sequential ordering.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.4741
- **Turns:** 18
- **Time:** 135.8s
