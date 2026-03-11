When committing the changes to git at the end of a feature, use the feature description as the git commit text instead of whatever summary is being used now.

## Plan

- [x] 1. Verify `buildCommitMessage` in `src/commit.ts` uses the feature description (content before ## Plan/Summary/Metadata) — confirmed: `extractFeatureDescription()` extracts pre-section content, `buildCommitMessage()` calls it with `feature.name` as fallback
- [x] 2. Verify all commit tests pass — 12/12 tests pass in `src/__tests__/commit.test.ts`
- [x] 3. Confirm no other commit paths bypass this logic — only one `git commit` call in production code (`src/commit.ts:116`), all other references are in tests

## Summary

This feature was already fully implemented in prior commits. The `buildCommitMessage()` function in `src/commit.ts` uses `extractFeatureDescription()` to extract the original feature description (all non-empty content lines before any `## Plan`, `## Summary`, or `## Metadata` section) and uses that as the git commit message. The feature name is used as a fallback if the file is unreadable or has no description content. All 12 existing tests pass and confirm this behavior.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.3787
- **Turns:** 12
- **Time:** 124.2s
