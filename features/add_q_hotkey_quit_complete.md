# Add Q hotkey quit

## Description
Add a **Q** keyboard shortcut to gracefully quit KaiBot while it is in the "watching" state. This mirrors the existing **F** hotkey pattern and gives users a discoverable way to exit without reaching for Ctrl+C.

## Requirements

1. **Q hotkey** — When the user presses `Q` (or `q`) while the bot is in the idle "watching" state (same guard conditions as the existing `F` hotkey: no feature input active, no feature review active, no commit prompt visible), initiate a graceful shutdown.

2. **Graceful shutdown** — The Q handler should perform the same cleanup as the existing SIGINT handler in `src/kai_bot.ts`: call `unmountUI()`, call `bot.stop()`, and `process.exit(0)`.

3. **Hotkey bar hint** — Add `[Q] Quit` to the hotkey bar in `src/ui/App.tsx` alongside the existing `[F] New Feature` hint, so the shortcut is discoverable.

4. **Guard conditions** — Q must be **ignored** when:
   - The bot is processing a feature (`status !== "watching"`)
   - The user is typing a feature description (`hotkeyInputActive`)
   - The agent is reviewing a feature (`featureReviewActive`)
   - A commit prompt is visible (`commitPrompt.visible`)

## Technical Notes

- The existing `useInput()` hook in `src/ui/App.tsx` already handles the `F` hotkey under the `hotkeyActive` guard — add the `Q` handler under the same guard.
- For shutdown, emit an event from the UI store (e.g., `"quit"`) and listen for it in `src/kai_bot.ts` where `unmountUI`, `bot`, and `process.exit` are in scope. Alternatively, accept a quit callback prop through the Ink component tree — follow whichever pattern is simpler and consistent with the existing codebase.
- This is purely UI/UX work — **do not add tests** for this feature.

## Acceptance Criteria

- [ ] Pressing Q while watching exits the bot cleanly (exit code 0)
- [ ] Q is ignored during feature input, feature review, and commit prompts
- [ ] `[Q] Quit` appears in the hotkey bar when the bot is idle/watching

## Plan

- [x] 1. Add a "quit" event emission to UIStore so the UI layer can signal a quit request — added `requestQuit()` method to `src/ui/store.ts`
- [x] 2. Add Q hotkey handler in App.tsx alongside the existing F hotkey under the same `hotkeyActive` guard — added `q` branch in `handleHotkey` callback in `src/ui/App.tsx`
- [x] 3. Add `[Q] Quit` hint to the HotkeyBar component next to `[F] New Feature` — updated `HotkeyBar` in `src/ui/App.tsx`
- [x] 4. Listen for the "quit" event in kai_bot.ts and perform graceful shutdown (unmountUI, bot.stop, process.exit) — added `uiStore.on("quit", …)` handler in `src/kai_bot.ts`

## Summary

Added a **Q** keyboard shortcut to gracefully quit KaiBot while in the "watching" state. The implementation follows the same pattern as the existing **F** hotkey:

- **`src/ui/store.ts`** — Added `requestQuit()` method that emits a `"quit"` event on the UIStore singleton.
- **`src/ui/App.tsx`** — Added `q` key handling in the `handleHotkey` callback (under the same `hotkeyActive` guard that protects the F key), and added a `[Q] Quit` hint in the `HotkeyBar` component alongside `[F] New Feature`.
- **`src/kai_bot.ts`** — Imported `uiStore` and added a `"quit"` event listener that performs the same graceful shutdown as SIGINT/SIGTERM (unmountUI → bot.stop → process.exit(0)).

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.5121
- **Turns:** 22
- **Time:** 104.0s
