# Feature: Hotkey Menu While Watching

While KaiBot is in the "watching" state (polling for new feature files), display a hotkey menu bar along the bottom of the terminal UI and respond to registered hotkey presses.

## Hotkey Bar

- Display a horizontal menu of available hotkeys at the very bottom of the Ink UI, just above or replacing the current `StatusBar`, visible **only** when `uiStore` status is `"watching"`.
- Format each hotkey as: `[F] New Feature` — bracketed key followed by a short label, separated by spaces.
- Style the bracket/key in a contrasting color (e.g., bold cyan key, dim label) so it stands out.

## First Hotkey: `F` — New Feature

When the user presses **F** (case-insensitive) while in the watching state:

1. **Switch to input mode.** Replace the main content area (or overlay it) with a multi-line text input prompt:
   - Show a header like: `Enter feature description (3 blank lines to finish):`
   - Accept free-form text input line by line.
   - Terminate input when **three consecutive blank lines** are entered (matching the user's stated convention).
   - Trim any trailing blank lines from the collected text.

2. **Create the feature file** using the existing logic:
   - Derive the feature name from the description using `deriveFeatureName()` from `feature_creator.ts`.
   - Generate the slug via `slugify()`.
   - If a file with that slug already exists in `features/`, append a numeric suffix (e.g., `_2`) to avoid collisions.
   - Write the description text to `features/{slug}.md`.
   - Briefly flash a confirmation message (e.g., `Feature created: features/{slug}.md`) before returning to the watching UI.

3. **Resume watching.** The bot's existing poll loop will discover the new `.md` file on its next cycle and process it normally. No special signaling is needed.

## Keyboard Handling

- Use Ink's `useInput` hook (or `useStdin` with raw mode) to capture keypresses.
- Hotkeys should **only** be active when status is `"watching"` — ignore hotkey presses during `"processing"` or `"error"` states, or when the commit prompt is active.
- While in text-input mode (collecting the feature description), normal hotkey handling is suspended — all keystrokes go to the text input.

## UI State Integration

- Add new state to `UIStore`:
  - `hotkeyInputActive: boolean` — whether we're currently capturing feature text.
  - `hotkeyInputLines: string[]` — accumulated lines of input (optional, for display).
- Provide setter/reset methods on the store (e.g., `startHotkeyInput()`, `finishHotkeyInput()`).
- The `App.tsx` component should conditionally render the text input overlay vs. the normal dashboard based on `hotkeyInputActive`.

## Acceptance Criteria

1. When the bot is watching and idle, a hotkey bar reading at least `[F] New Feature` is visible at the bottom of the terminal.
2. Pressing `F` opens an inline text-input mode; the user can type multiple lines.
3. Entering three consecutive blank lines finalizes the input.
4. A feature `.md` file is written to `features/` with a properly slugified name derived from the description.
5. The bot picks up and processes the new feature file on its next poll cycle without any manual intervention.
6. Hotkey presses are ignored while a feature is being processed or the commit prompt is showing.
7. If the user presses `F` but provides no text (immediately enters 3 blank lines), no file is created and the UI returns to watching with a brief "Cancelled" message.

## Technical Notes

- Reuse `deriveFeatureName()` and `slugify()` from `feature_creator.ts` — do **not** duplicate that logic.
- The existing `createFeature()` function uses `readline` and is designed for the CLI subcommand flow; do **not** call it directly from the Ink UI. Instead, extract or reuse just the name-derivation + file-writing parts.
- Ink's `useInput` provides `(input, key)` — check `input.toLowerCase() === "f"` and ensure no modifier keys are pressed.
- The three-blank-line terminator means tracking a counter of consecutive empty `Enter` presses; reset the counter whenever a non-empty line is entered.
- All new modules must use ESM imports with `.js` extensions per project convention.

## Plan

- [x] 1. Add hotkey-related state to UIStore: `hotkeyInputActive`, `hotkeyInputLines`, `flashMessage`, plus setter/reset methods — added to `src/ui/store.ts`
- [x] 2. Create `writeFeatureFromDescription()` utility in `feature_creator.ts` that reuses `deriveFeatureName` + `slugify` to write a feature file without readline — added to `src/feature_creator.ts`
- [x] 3. Create `HotkeyBar` component in App.tsx showing `[F] New Feature` when status is "watching" — added `HotkeyBar` component with flash message support
- [x] 4. Create `FeatureInput` component in App.tsx for multi-line text input with 3-blank-line termination — added `FeatureInput` with cursor, blank-line counter, Esc to cancel
- [x] 5. Add hotkey handling in App.tsx: press F while watching triggers input mode; wire FeatureInput to create feature file and show flash message — `useInput` with `hotkeyActive` guard
- [x] 6. Integrate components in the main App layout — conditionally render FeatureInput overlay vs normal dashboard — overlay replaces panels when `hotkeyInputActive`
- [x] 7. Add tests for the new functionality — created `src/__tests__/hotkey_feature.test.ts` with tests for `writeFeatureFromDescription` and UIStore hotkey state
- [x] 8. Run typecheck, lint, and tests to verify everything passes — all pass (typecheck clean, lint clean, 157 tests pass; sdk.smoke.test skipped as pre-existing)

## Summary

Implemented a hotkey menu system for KaiBot's watching state:

- **UIStore** (`src/ui/store.ts`): Added `hotkeyInputActive`, `hotkeyInputLines`, and `flashMessage` state fields with `startHotkeyInput()`, `appendHotkeyInputLine()`, `finishHotkeyInput()`, `setFlashMessage()`, and `clearFlashMessage()` methods. State is also cleared in `resetFeature()`.

- **Feature file creation** (`src/feature_creator.ts`): Added `writeFeatureFromDescription()` — a headless utility that derives a feature name via `deriveFeatureName()`, slugifies it, handles filename collisions with numeric suffixes (`_2`, `_3`, …), and writes the `.md` file. No readline interaction needed.

- **HotkeyBar component** (`src/ui/App.tsx`): Renders `[F] New Feature` at the bottom of the UI when status is `"watching"`. Also displays flash messages (e.g. "Feature created: features/foo.md") in green.

- **FeatureInput component** (`src/ui/App.tsx`): Full multi-line text input overlay with a visible cursor, blank-line counter (3 consecutive blank lines to finish), and Esc to cancel. On completion, calls `writeFeatureFromDescription()` and shows a flash confirmation.

- **Hotkey handling** (`src/ui/App.tsx`): Press `F` (case-insensitive, no modifiers) while watching to enter input mode. Hotkeys are disabled during processing, error state, commit prompt, or when already in input mode.

- **Tests** (`src/__tests__/hotkey_feature.test.ts`): 11 tests covering `writeFeatureFromDescription` (file creation, empty input, trimming, deduplication, directory creation) and UIStore hotkey state transitions.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0292
- **Turns:** 35
- **Time:** 228.6s
