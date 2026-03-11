When a feature is complete for a project, open CHANGELOG.md and add a line to describe the feature and any notes such as mew command lines.
Add the branch and date/time and current user from the system env.

Examples:

March 10th, 2025: main:
This is a new feature.  Test it with "npm run feature"

Sept 21st, 2025: test_branch:
New api /api/v1/something requires POST parameters
name :string = Name of user
age  :number = Age to set

## Plan

- [x] 1. Create `src/changelog.ts` with an `appendChangelog()` function — created with `getGitBranch`, `getUser`, `formatDate` helpers and `appendChangelog` export
- [x] 2. Integrate `appendChangelog()` into `KaiBot.ts` — imported and called after `markComplete` in `handleFeature`
- [x] 3. Create `src/__tests__/changelog.test.ts` — 8 tests covering creation, append, branch, user, fallbacks, date suffixes, non-git dirs
- [x] 4. Run typecheck, lint, and tests to ensure everything passes — all 107 tests pass, typecheck and lint clean. Also fixed pre-existing KaiBot test failures (settle delay not accounted for) and added changelog mock
- [x] 5. Verify the feature file examples format is matched correctly — output format matches examples: `Date: branch: user` on first line, description on next line

## Summary

Implemented automatic CHANGELOG.md updates when features complete. Added `src/changelog.ts` with an `appendChangelog()` function that:

- Gets the current git branch via `git rev-parse --abbrev-ref HEAD` (falls back to "unknown")
- Gets the current user from `USER`/`USERNAME` env vars (falls back to "unknown")
- Formats the date as "Month Dth, YYYY" with correct ordinal suffixes (1st, 2nd, 3rd, 4th, etc.)
- Extracts a description from the feature file content (skipping markdown headers and checkboxes)
- Creates `CHANGELOG.md` with a header if it doesn't exist, or appends to an existing one

The function is called in `KaiBot.ts` → `handleFeature()` immediately after `markComplete()`. Eight tests in `src/__tests__/changelog.test.ts` cover all cases. Also fixed pre-existing KaiBot test failures where the settle delay wasn't being accounted for in tests.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.2970
- **Turns:** 41
- **Time:** 289.1s
