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

March 24th, 2026: main: brian
Fixed the Web UI dashboard panels (Thinking, Commands, File Operations, Plan, Feature Status) showing blank content by replacing the broken `dockLayout.updateTab(id, null, true)` re-render mechanism with a proper event-driven approach. A global `panelBus` EventTarget is now used: `updateDOM()` dispatches a `"state-change"` event whenever new WebSocket data arrives, and each `PanelWrapper` React component subscribes to this event and calls `forceUpdate()` to re-render its HTML content. The previous approach failed because rc-dock's `updateTab` with `null` tab data does not trigger React component re-renders.

March 24th, 2026: main: brian
The model selector popup couldn't be clicked because `renderPopupItems()` replaced the entire `menu.innerHTML` on every `mouseenter`, destroying the clicked item's DOM element mid-click (between `mousedown` and `mouseup`). Fixed by switching to event delegation: per-item click/mouseenter listeners were removed from `renderPopupItems()` and replaced with a single `click` + `mouseover` listener attached once to the stable `menu` element inside `showPopupMenu()`. These delegated listeners survive innerHTML re-renders, so mouse hover and mouse click now both work as expected.

March 24th, 2026: main: brian
Applied the new color system to `web/static/css/main.css`. All color values were updated:

March 24th, 2026: main: brian
Implemented persistent settings storage in `.kaibot/settings.json`. Created `src/settings.ts` with a `KaiBotSettings` interface and `loadSettings`/`saveSettings` helpers (following the same pattern as `featureDb.ts`). Updated `src/kai_bot.ts` to load saved settings at startup — the model resolution priority is now `KAI_MODEL` env var → `settings.json` → default `"claude-opus-4-6"`. The `model-changed` event handler in `kai_bot.ts` now persists the new model to `settings.json`, so any model selection made via the UI is remembered across bot restarts. Added 11 unit tests covering all edge cases (missing file, empty file, invalid JSON, JSON array, valid model/provider, overwrite, and round-trip).

March 24th, 2026: main: brian
Added a "Features" menu item to the left nav (between Dashboard and New Feature) with hotkey **F**. The hotkey for "New Feature" was changed from **F** to **N** throughout the nav and keyboard handler.

March 24th, 2026: main: brian
Added AI-powered feature title generation using the Claude Agent SDK. When a new feature request arrives (from a file or Linear issue), a `generateTitle()` function calls `claude-haiku-4-5` to produce a concise 20-80 character title from the feature content. This title is immediately displayed in both the Ink terminal UI and Web UI via `uiStore.setFeatureName()`, and is persisted as a `title` field in the feature record database (`.kaibot/features.json`) and individual log JSON files (`features/log/<id>.json`). The Web UI's completed features list now prefers the AI-generated title over the raw description. Seven unit tests cover the title generation logic including edge cases for empty content, truncation, and error handling.

March 24th, 2026: main: brian
Implemented a New Feature dialog popup in the KaiBot web UI. Pressing **N** or clicking the "New Feature" nav item opens a modal dialog with:

March 24th, 2026: main: brian
Added a CSS media query (`@media (min-width: 1400px)`) at the end of `web/static/css/main.css` that doubles the new feature dialog size on large screens:

March 24th, 2026: main: brian
Updated the internal web server (`src/web/routes.ts`) to add comprehensive no-cache headers to all HTTP responses. A `NO_CACHE_HEADERS` constant sets `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, and `Expires: 0` — applied to every route including HTML pages, API endpoints, static files (CSS, JS, images), redirects, and error responses. Added a new `/robots.txt` route that returns a `Disallow: /` response blocking all robots. Created `src/__tests__/routes.test.ts` with 5 tests verifying the robots.txt content and no-cache headers across multiple route types.

March 24th, 2026: main: brian
Added timestamped conversation history and file activity tracking to the feature log JSON files (`features/log/<featureId>.json`). The `FileOp` interface now includes a `timestamp` field that is auto-populated when file operations are recorded. Two new snapshot methods on `UIStore` (`getConversationSnapshot` and `getFileActivitySnapshot`) produce serializable arrays with ISO 8601 timestamps. The `FeatureRecord` type was extended with optional `conversationHistory` and `fileActivity` fields, and both the file-mode and Linear-mode processing paths in `KaiBot` now capture these snapshots before writing the log file. Nine new tests verify the snapshot methods and timestamp behavior.

March 24th, 2026: main: brian
Implemented OpenRouter as an alternative provider to Anthropic's direct API. When `OPENROUTER_API_KEY` is set in the environment, users can switch between providers by pressing **P** in both the terminal UI and web UI. The provider selector uses the same popup menu pattern as the existing model selector. When switching providers, the model list automatically updates to show provider-appropriate models (e.g. `anthropic/claude-opus-4` for OpenRouter vs `claude-opus-4-6` for Anthropic). The `KaiClient` configures the Claude Agent SDK to route through OpenRouter by setting `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and clearing `ANTHROPIC_API_KEY` as specified. Provider selection is persisted in `.kaibot/settings.json`. A new `npm run testOpenrouter` command validates the OpenRouter API key and lists available models.

March 24th, 2026: main: brian
Feature ID: H0owDjSb

March 24th, 2026: main: brian
Fixed `npm run testOpenrouter` model listing and improved the overall model discovery experience:

March 24th, 2026: main: brian
Added `OPENROUTER_MODEL` environment variable support for OpenRouter provider. When using OpenRouter, the model is resolved from `OPENROUTER_MODEL` (defaulting to `z-ai/glm-5-turbo`). The `npm run testOpenrouter` command now spawns an actual agent via `KaiClient` using the selected OpenRouter model, sends "Tell me about yourself", and prints the response to the console. Documentation updated in both CLAUDE.md and README.md.

March 24th, 2026: main: brian
Added a `provider` field to the `FeatureRecord` interface in `src/featureDb.ts` and populated it in both the file-source and Linear-source record constructions in `src/KaiBot.ts`. The field stores the human-readable provider label ("Anthropic" or "OpenRouter") by looking up the active `ProviderName` in the `PROVIDERS` array. This means the JSON log files written to `features/log/` now include a `provider` key indicating which API provider was used for the agent run.

March 24th, 2026: main: brian
Replaced the `fetchOpenRouterModels` function in `src/models.ts` to use Node's native `https` module (`node:https`) instead of the global `fetch` API. The function now uses `https.get()` with chunked response buffering and manual JSON parsing. Added comprehensive tests in `src/__tests__/models.test.ts` covering success, HTTP errors, missing Claude models, and connection errors — all mocking `node:https` via `vi.mock`.

