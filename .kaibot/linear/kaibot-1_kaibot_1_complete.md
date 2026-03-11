When committing the changes to git at the end of a feature, use the feature description as the git commit text instead of whatever summary is being used now.

## Plan

- [x] 1. Add `extractFeatureDescription` function to `commit.ts` that extracts the original feature description (content before `## Plan`/`## Summary` sections) — added to src/commit.ts
- [x] 2. Update `buildCommitMessage` to use `extractFeatureDescription` instead of `extractDescription` from changelog — updated in src/commit.ts
- [x] 3. Update tests in `commit.test.ts` to verify the new behavior — updated existing tests and added `extractFeatureDescription` unit tests
- [x] 4. Run typecheck, lint, and tests to ensure everything passes — typecheck clean, lint clean, all 171 tests pass (12 smoke tests skipped as expected)

## Summary

Changed the git commit message to use the original feature description (the content at the top of the feature file, before `## Plan`/`## Summary`/`## Metadata` sections) instead of the agent-generated summary. Added `extractFeatureDescription()` function to `src/commit.ts` and removed the dependency on `extractDescription` from `changelog.ts`. Updated all tests in `src/__tests__/commit.test.ts` with 6 new unit tests for the extraction function.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.7928
- **Turns:** 24
- **Time:** 203.3s
