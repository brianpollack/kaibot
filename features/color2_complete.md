Update the UI/InkJS

- Clear the screen on startup
- Measure the available terminal size to take advage of the terminal better
- Display more information on what commands are executing if there is more screen space
- Reserve a spot to indicate the feature being read and the stage such as reading, thinking, changelog, complete
- Add a spinner to indicate waiting for new features

This is a GUI update, do not add or write test cases.

## Plan

- [x] 1. Add terminal size tracking and feature stage to the UI store — added FeatureStage type, terminalColumns/terminalRows, setFeatureStage(), updateTerminalSize() to store.ts
- [x] 2. Clear the screen on startup in render.ts — added ANSI clear+home escape sequence before inkRender()
- [x] 3. Create a Spinner component for the watching/idle state — added Spinner (braille frames) and StageBadge components in App.tsx
- [x] 4. Add feature stage indicator to the Header component — added StageBadge and Spinner to Header, dynamic divider width
- [x] 5. Make layout responsive — all panels now accept cols/rows, wider terminals show longer commands/paths/previews, taller terminals show more thinking lines
- [x] 6. Update KaiAgent to set feature stage transitions (reading → thinking → planning → executing → complete) — KaiAgent.ts now calls setFeatureStage() based on tool use and text content
- [x] 7. Wire up stage transitions in KaiBot for the watching/complete states — resetFeature() already clears featureStage; no additional changes needed in KaiBot.ts
- [x] 8. Verify typecheck passes — tsc --noEmit and eslint both pass with no errors

## Summary

Updated the Ink-based UI with the following improvements:

- **Clear screen on startup**: Terminal is cleared with ANSI escape sequences before mounting the Ink app (`render.ts`).
- **Terminal size tracking**: The store now tracks `terminalColumns`/`terminalRows` and updates on resize. All panels use these dimensions to adapt their content widths — wider terminals show longer command strings, file paths, and previews; taller terminals show more thinking lines (6/8/10 depending on height).
- **Feature stage indicator**: A new `FeatureStage` type (`reading` → `thinking` → `planning` → `executing` → `complete`) is tracked in the store. The Header displays a colored badge with icon showing the current stage. `KaiAgent` sets the stage based on what the agent is doing (reading files, producing text, writing plan, editing code, finishing).
- **Spinner**: A braille-character spinner animates in the header when the bot is in "watching" mode, indicating it's waiting for new features.
- **Responsive layout**: Dividers, truncation widths, and panel sizes all scale with the terminal width/height instead of being hardcoded to 80 columns.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0903
- **Turns:** 45
- **Time:** 243.2s
