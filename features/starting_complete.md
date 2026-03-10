# Starting Feature

When a new feature is found with an md file, print the name of the file.

## Plan

- [x] 1. Add a console.log in `checkForNewFeatures` to print the filename when a new `.md` feature file is detected — added `console.log` in `src/KaiBot.ts`
- [x] 2. Add a test to verify the filename is printed to the console — added test in `src/__tests__/KaiBot.test.ts`
- [x] 3. Run all tests to confirm nothing is broken — all 79 tests pass (12 smoke tests skipped, pre-existing)

## Summary

Added a `console.log` in `KaiBot.checkForNewFeatures()` that prints the filename (e.g., `Found new feature file: my_feature.md`) when a new `.md` feature file is detected in the `features/` directory. A corresponding test was added to verify the behavior.