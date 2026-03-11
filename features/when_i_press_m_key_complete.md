# When I press M key

## Description
Add an **M** hotkey to the KaiBot watcher UI that opens an interactive model selector, allowing the user to switch the active Claude model at runtime without restarting the bot.

## Current Behavior
- The model is set once at startup via the `KAI_MODEL` environment variable (default: `claude-opus-4-6`).
- Changing the model requires stopping the bot, updating the env var, and restarting.
- The current model is displayed in the UI header (`🧠 <model-name>`).
- Hotkeys **F** (new feature) and **Q** (quit) are already handled in `App.tsx` when the bot is in the "watching" state.

## Requirements

1. **M hotkey**: When the bot is idle/watching (same guard as F and Q hotkeys), pressing **M** opens a model selection UI.
2. **Model list**: Display the available models from the static `MODELS` list in `src/models.ts`. Mark the currently active model. If the live API model list has already been fetched, prefer that.
3. **Selection UI**: Show a numbered or arrow-key-navigable list of models. The user can:
   - Use **Up/Down arrow keys** (or **J/K**) to highlight a model.
   - Press **Enter** to confirm the selection.
   - Press **Escape** to cancel and keep the current model.
4. **Apply selection**: On confirm, update the model in `KaiBot`'s state so the next feature processed uses the newly selected model. Update the UI header to reflect the new model.
5. **Block other hotkeys**: While the model selector is open, suppress F, Q, and other hotkeys (same pattern as feature input mode).
6. **Footer hint**: Add `[M] Model` to the hotkey hints shown in the footer bar alongside `[F] Feature` and `[Q] Quit`.

## Technical Notes

- Follow the existing hotkey pattern in `App.tsx` (lines ~608–631). Add an `isSelectingModel` state flag to gate input, similar to how `isInputMode` gates the feature input.
- Create a `ModelSelector` component (in `src/ui/`) that accepts the model list, current model, and `onSelect`/`onCancel` callbacks. Use Ink's `useInput` hook for keyboard navigation.
- The model string flows through `KaiBot` → `KaiAgent.processFeature()` → `KaiClient`. Updating `KaiBot`'s model property is sufficient for subsequent feature runs.
- `src/models.ts` already exports `MODELS` (static list) and `fetchModels()` (live API fetch) — reuse these.
- Update `uiStore.setModel()` after selection so the header reflects the change immediately.

## Acceptance Criteria

- [ ] Pressing **M** while watching opens the model selector overlay.
- [ ] Arrow keys / J/K navigate the list; Enter selects; Escape cancels.
- [ ] The selected model is used for the next feature processed.
- [ ] The UI header updates immediately to show the new model.
- [ ] Other hotkeys are suppressed while the selector is open.
- [ ] `[M] Model` appears in the footer hotkey hints.
- [ ] Pressing M during feature processing or other input modes does nothing.

## Testing Note
This feature is primarily UI/interaction work within the Ink terminal UI. **Tests should NOT be added** — the changes are in rendering and keyboard handling which are best verified manually.

## Plan

- [x] 1. Add `isSelectingModel` state flag and model-selection methods to UIStore (`src/ui/store.ts`) — added state, startModelSelection(), finishModelSelection(), and reset
- [x] 2. Make `KaiBot.model` mutable and add a `setModel()` method (`src/KaiBot.ts`) — removed readonly, listen for "model-changed" event from uiStore
- [x] 3. Create `ModelSelector` component in `src/ui/App.tsx` with arrow/j/k navigation, Enter/Escape handling — component with useInput, wrapping navigation
- [x] 4. Add M hotkey handler in App's `handleHotkey` and gate it with `isSelectingModel` — added to handleHotkey and hotkeyActive guard
- [x] 5. Render `ModelSelector` overlay when `isSelectingModel` is true (same pattern as `FeatureInput`) — overlay renders with Header above
- [x] 6. Add `[M] Model` hint to `HotkeyBar` footer — added between [F] and [Q]
- [x] 7. Wire model selection to update both `uiStore.setModel()` and `KaiBot` model via an event — selectModel() emits "model-changed", KaiBot listens
- [x] 8. Verify typecheck and lint pass — both pass cleanly

## Summary

Implemented the **M hotkey model selector** feature. When the bot is in the "watching" state, pressing **M** opens a full-screen model selection overlay showing the available Claude models from the static `MODELS` list. Users can navigate with **↑/↓ arrow keys** or **J/K**, confirm with **Enter**, or cancel with **Escape**. The currently active model is marked with "(active)".

**Files changed:**
- **`src/ui/store.ts`** — Added `isSelectingModel` state flag, `startModelSelection()`, `finishModelSelection()`, and `selectModel()` methods. The `selectModel()` method updates the model, closes the overlay, and emits a `"model-changed"` event.
- **`src/KaiBot.ts`** — Made `model` property mutable (removed `readonly`). Added a `"model-changed"` event listener in `start()` so runtime model changes from the UI are picked up for subsequent feature processing.
- **`src/ui/App.tsx`** — Created `ModelSelector` component with keyboard navigation. Added **M** to the hotkey handler. Added `isSelectingModel` to the hotkey guard to suppress other keys while selecting. Renders the model selector overlay (same pattern as `FeatureInput`). Added `[M] Model` to the `HotkeyBar` footer hints.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.8554
- **Turns:** 27
- **Time:** 187.6s
