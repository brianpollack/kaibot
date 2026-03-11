When committing the changes to git at the end of a feature, use the feature description as the git commit text instead of whatever summary is being used now.

## Plan

- [x] 1. Update `buildCommitMessage` in `src/commit.ts` to return the feature description directly without the `feat: ` prefix — removed `feat: ` prefix from return value
- [x] 2. Update tests in `src/__tests__/commit.test.ts` to match the new commit message format — removed `feat: ` prefix expectations from all test assertions
- [x] 3. Run tests to verify everything passes — all 171 tests pass (12 smoke tests skipped as expected)

## Summary

Updated `buildCommitMessage` in `src/commit.ts` to return the feature description directly as the commit message, removing the `feat: ` prefix that was previously prepended. The commit message now uses the raw feature description extracted from the feature file content (text before any `## Plan`, `## Summary`, or `## Metadata` sections). Updated all corresponding test assertions in `src/__tests__/commit.test.ts` to match.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.5369
- **Turns:** 17
- **Time:** 167.8s
