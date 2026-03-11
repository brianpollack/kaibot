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

March 10th, 2026: main: brian
Implemented the `npm run feature` CLI command for interactive feature file creation. The user provides a feature name via CLI args (e.g., `npm run feature -- Add user authentication`), which gets slugified into a filename (`add_user_authentication.md`). The user then enters feature details via multiline stdin input. A Claude agent reviews the details and either asks clarifying questions (up to 3 rounds) or writes a polished feature specification to `features/<slug>.md`. New files: `src/slugify.ts` (slug utility), `src/feature_creator.ts` (interactive flow with agent review), plus 17 new tests across two test files.

March 10th, 2026: main: brian
Implemented auto-generation of feature names from descriptions when `npm run feature` is invoked without a name argument. Changes:

March 10th, 2026: main: brian
Implemented a hotkey menu system for KaiBot's watching state:

March 10th, 2026: main: brian
Added testing guidelines to the KaiBot agent system so that UI-related features (CLI apps, React components, styling, layout) and features that don't change logic will not have tests added automatically. The guidelines were added in two places:

March 10th, 2026: main: brian
Implemented agent review for the F-hotkey feature creation flow. When the user presses F and submits a description, it now goes through the same `buildReviewPrompt` → `KaiClient.run()` pipeline used by `npm run feature`, producing a well-structured specification instead of writing the raw description.

