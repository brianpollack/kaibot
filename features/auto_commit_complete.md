When the feature is complete, summarize the change for the Changelog and suggest the user
Would you like to commit with <Text>.  If the user selects Yes (default) or if there is a timeout
of 5 seconds waiting for input then commit the change.  If No is selected then do not commit

## Plan

- [x] 1. Add commit prompt state to UI store (prompt visibility, message, countdown, resolution) — added CommitPromptState interface, showCommitPrompt/resolveCommitPrompt/setCommitCountdown methods to src/ui/store.ts
- [x] 2. Create CommitPrompt Ink component in App.tsx with Yes/No input + 5s countdown — added CommitPrompt component with useInput hook, countdown timer, and auto-commit on timeout
- [x] 3. Create `src/commit.ts` module — git add & commit logic, prompt orchestration — created src/commit.ts with isGitRepo, hasChanges, buildCommitMessage, and promptAndCommit
- [x] 4. Integrate auto-commit into KaiBot.handleFeature after markComplete/appendChangelog — added promptAndCommit call in KaiBot.ts handleFeature
- [x] 5. Write tests for the commit module — created src/__tests__/commit.test.ts with tests for buildCommitMessage and promptAndCommit
- [x] 6. Run typecheck, lint, and tests to ensure everything passes — typecheck clean, lint clean, all 119 tests pass (12 smoke tests skipped as expected)

## Summary

Added auto-commit functionality that prompts the user after a feature completes. The commit prompt displays the proposed commit message (extracted from the feature's Summary section) and offers a Yes/No choice with a 5-second countdown that defaults to committing. New files: `src/commit.ts` (git operations and prompt orchestration), `src/__tests__/commit.test.ts` (6 tests). Modified: `src/ui/store.ts` (commit prompt state and resolution), `src/ui/App.tsx` (CommitPrompt Ink component with countdown timer and keyboard input), `src/KaiBot.ts` (integration point after feature completion).
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.2762
- **Turns:** 50
- **Time:** 266.4s
