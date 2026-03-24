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

March 10th, 2026: main: brian
Added a **Q** keyboard shortcut to gracefully quit KaiBot while in the "watching" state. The implementation follows the same pattern as the existing **F** hotkey:

March 10th, 2026: main: brian
Subtracted 4 from the raw terminal column width at all four reading sites — two in `src/ui/App.tsx` (initial `useState` and resize handler) and two in `src/ui/store.ts` (initial state and `updateTerminalSize`). This provides a safe 4-column margin so the Ink UI no longer overflows or wraps at standard terminal widths. The effective fallback is now 76 columns (80 − 4). TypeScript typecheck passes with no errors.

March 11th, 2026: main: brian
Implemented automatic inclusion of the target project's `CLAUDE.md` file in the agent system prompt. When KaiBot processes a feature, `KaiClient` now reads `{projectDir}/CLAUDE.md` (if it exists) and appends its content to the base system prompt with an "OVERRIDE" instruction header. This gives the agent project-specific context about conventions, patterns, and build instructions.

March 11th, 2026: main: brian
Implemented the **M hotkey model selector** feature. When the bot is in the "watching" state, pressing **M** opens a full-screen model selection overlay showing the available Claude models from the static `MODELS` list. Users can navigate with **↑/↓ arrow keys** or **J/K**, confirm with **Enter**, or cancel with **Escape**. The currently active model is marked with "(active)".

March 11th, 2026: main: brian
Changed the git commit message to use the original feature description (the content at the top of the feature file, before `## Plan`/`## Summary`/`## Metadata` sections) instead of the agent-generated summary. Added `extractFeatureDescription()` function to `src/commit.ts` and removed the dependency on `extractDescription` from `changelog.ts`. Updated all tests in `src/__tests__/commit.test.ts` with 6 new unit tests for the extraction function.

March 11th, 2026: main: brian
Updated `buildCommitMessage` in `src/commit.ts` to return the feature description directly as the commit message, removing the `feat: ` prefix that was previously prepended. The commit message now uses the raw feature description extracted from the feature file content (text before any `## Plan`, `## Summary`, or `## Metadata` sections). Updated all corresponding test assertions in `src/__tests__/commit.test.ts` to match.

March 11th, 2026: main: brian
This feature was already fully implemented in prior commits. The `buildCommitMessage()` function in `src/commit.ts` uses `extractFeatureDescription()` to extract the original feature description (all non-empty content lines before any `## Plan`, `## Summary`, or `## Metadata` section) and uses that as the git commit message. The feature name is used as a fallback if the file is unreadable or has no description content. All 12 existing tests pass and confirm this behavior.

March 11th, 2026: main: brian
Implemented the Tech Debt scan feature activated by pressing **S** in the watching state.

March 12th, 2026: main: brian
Updated `markComplete` in `src/feature.ts` to move completed feature files into a `features/complete/` subdirectory (e.g., `features/complete/my_feature.md`) instead of renaming them with a `_complete` suffix in place. The `complete/` directory is created automatically if it doesn't exist. Updated tests in both `feature.test.ts` and `KaiBot.test.ts` to match the new behavior.

March 24th, 2026: main: brian
Replaced the filename-based feature state machine (`_inprogress.md` / `_complete.md` suffixes) with a folder-based approach using `features/inprogress/`, `features/complete/`, and `features/hold/` subdirectories. Added a new `markHold()` function that moves failed features to `features/hold/` with an `## Information Needed` section containing the error message — users can resolve the issue and move the file back to `features/` to retry. Each feature is now assigned a unique 8-character URL-safe ID (generated via `crypto.randomBytes` base64url encoding) that is prepended to the feature file as `Feature ID: <id>`, included in git commit messages as `[<id>]`, and used as the filename for a completion summary JSON written to `features/log/<id>.json`. All existing tests were updated and new test suites added for `generateFeatureId`, `markHold`, and folder-based `parseFeature` detection. Legacy `_inprogress`/`_complete` filename detection is preserved in `parseFeature` for backward compatibility.

March 24th, 2026: main: brian
Implemented a lightweight Web UI for KaiBot that runs alongside the existing Ink terminal UI. A Node.js `http` server starts on port 8500 (configurable via `KAI_WEB_PORT`/`KAI_WEB_HOST` env vars) and serves a server-side generated dashboard at `/main` (with `/` and `/login` redirecting there as a login placeholder). The UI features a dark-themed layout with a top status bar (project dir, model, provider, estimated daily spend), a left navigation menu with keyboard hotkeys and screen reader compatibility (accesskeys + ARIA), and four dockable panels (Thinking, Commands, File Operations, Plan) powered by rc-dock loaded from CDN. Real-time state updates flow from the `uiStore` singleton through WebSocket to all connected browser clients. New files: `src/web/WebServer.ts`, `src/web/routes.ts`, `src/web/templates.ts`, `src/web/wsHandler.ts`, `src/web/spendTracker.ts`, `web/static/css/main.css`, `web/static/html/client.js`, plus the static asset folders `web/static/images/` and `web/vendor/`.

March 24th, 2026: main: brian
Updated the Web UI to remove the duplicate "Model" entry from the left sidebar navigation and made the model display in the top status bar clickable.

March 24th, 2026: main: brian
Implemented the missing streaming status panels for the KaiBot Web UI dashboard. Added a new "Feature Status" panel to the rc-dock layout that shows the current feature name, processing stage (with colored badge), live runtime timer (updates every second), active model, and bot status. Increased store history limits from 6/5/4 to 200/100/100 for thinking lines, commands, and file ops respectively, so the web UI can display full scrollable history in console-like panels while the terminal Ink UI continues to show only the last few items. Added auto-scroll behavior to all panels so they stay pinned to the bottom as new content streams in (unless the user has scrolled up). The `featureStartTime` timestamp is now tracked in UIState and broadcast via WebSocket to enable the client-side runtime timer.

March 24th, 2026: main: brian
Added duplicate filename protection to the feature state machine. The new exported `deconflictPath` helper checks whether a target path already exists before any move; if it does, it appends the feature's unique ID to the stem (`dupename-<id>.md`). This deconfliction is applied in `markInProgress`, `markComplete`, and `markHold` — the returned `Feature` object reflects the updated `name` and `filePath` so subsequent transitions chain correctly. Covered by 7 new tests in `feature.test.ts` (3 for `deconflictPath` directly, 1 collision test per transition function).

