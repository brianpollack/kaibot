# Changelog

March 10th, 2026: main: brian
Only run one feature at a time for a given folder.   It is okay to keep a queue and run other features in order but no need to scan for files while running a feature.

March 10th, 2026: main: brian
Let's update the UI to use the node ink (inkjs) library for a full screen colorful interface.


March 10th, 2026: main: brian
Updated the Ink-based UI with the following improvements:

March 10th, 2026: main: brian
Added auto-commit functionality that prompts the user after a feature completes. The commit prompt displays the proposed commit message (extracted from the feature's Summary section) and offers a Yes/No choice with a 5-second countdown that defaults to committing. New files: `src/commit.ts` (git operations and prompt orchestration), `src/__tests__/commit.test.ts` (6 tests). Modified: `src/ui/store.ts` (commit prompt state and resolution), `src/ui/App.tsx` (CommitPrompt Ink component with countdown timer and keyboard input), `src/KaiBot.ts` (integration point after feature completion).

March 10th, 2026: main: brian
Implemented a right-side plan panel occupying 40% of the terminal width. Changes across 3 files:

