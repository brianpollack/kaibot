Create a Tech Debt feature activated with the S key.  This will use a prompt to scan all of the existing code and create a TODO list of suggestions based on security, refactoring, documenting, code cleanup, duplicate code removal, and other code quality suggestions.  The todo list will be saved as a markdown file as todo.md

## Plan

- [x] 1. Create `src/tech_debt.ts` with `runTechDebtScan(projectDir, model)` that prompts the agent to scan the codebase and write `todo.md` — created src/tech_debt.ts
- [x] 2. Update `src/ui/store.ts` to add `isScanningTechDebt` state and `startTechDebtScan` / `finishTechDebtScan` methods — added to UIState interface, initial value, two methods, and reset
- [x] 3. Update `src/ui/App.tsx` to add the S hotkey, update `HotkeyBar` display, and wire up the scan flow — added S key handler, isScanningTechDebt to hotkeyActive guard, spinner/flash in HotkeyBar, and [S] Tech Debt button

## Summary

Implemented the Tech Debt scan feature activated by pressing **S** in the watching state.

**Files changed:**
- `src/tech_debt.ts` (new) — `runTechDebtScan(projectDir, model)` builds a detailed prompt instructing the agent to scan all source files and write a prioritized `todo.md` covering security, refactoring, documentation, code cleanup, duplicate code, performance, and dependencies
- `src/ui/store.ts` — added `isScanningTechDebt: boolean` to `UIState`, `startTechDebtScan()` / `finishTechDebtScan()` methods, and reset in `resetFeature()`
- `src/ui/App.tsx` — wired **S** hotkey to `runTechDebtScan()` with loading/done flash messages, added `isScanningTechDebt` to the `hotkeyActive` guard to prevent concurrent actions, updated `HotkeyBar` to show a spinner while scanning and display `[S] Tech Debt` in the idle hotkey bar

## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.7341
- **Turns:** 25
- **Time:** 234.6s
