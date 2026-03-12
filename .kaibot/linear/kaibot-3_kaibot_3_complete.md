Store Completed Features in a folder ./features/complete with the slugified title and complete feature detail once done.  This will replace the \_complete file that might have been created in manual mode.

## Plan

- [x] 1. Update `markComplete` in `src/feature.ts` to move the file to `features/complete/{slug}.md` instead of renaming to `_complete.md` in the same directory — moved to `complete/` subdir, creates dir if needed
- [x] 2. Update tests in `src/__tests__/feature.test.ts` for the new `markComplete` behavior — updated path expectations, added test for directory creation
- [x] 3. Update tests in `src/__tests__/KaiBot.test.ts` to expect files in `features/complete/` instead of `_complete.md` — updated path assertions
- [x] 4. Run tests and fix any issues — all 27 tests pass, typecheck clean

## Summary

Updated `markComplete` in `src/feature.ts` to move completed feature files into a `features/complete/` subdirectory (e.g., `features/complete/my_feature.md`) instead of renaming them with a `_complete` suffix in place. The `complete/` directory is created automatically if it doesn't exist. Updated tests in both `feature.test.ts` and `KaiBot.test.ts` to match the new behavior.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.6740
- **Turns:** 23
- **Time:** 96.9s
