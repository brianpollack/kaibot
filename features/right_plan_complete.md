Reserve the right 40% of the screen UI to show the current plan.  This is the plan that is also updated in the inprogress file.  This plan should show the complete checkbox / no checkbox as we go.

Once complete the plan window should show in green "Feature Complete" and the list the cost information under while scanning for new files.

Once a new feature file is found, clear the entire plan area so we can have room for the next.

## Plan

- [x] 1. Add plan state to UIStore — planLines array, costInfo string, and methods to set/clear them — added PlanLine interface, planLines/planCostInfo to UIState, setPlanLines/setPlanCostInfo methods, and clear in resetFeature
- [x] 2. Parse plan from feature file edits in KaiAgent — added parsePlanLines(), refreshPlanLines() in KaiAgent.ts, called after each streamed message; cost info fed to store on completion
- [x] 3. Create PlanPanel component — added PlanPanel in App.tsx with checkbox display, "Feature Complete" in green, and cost info
- [x] 4. Restructure App layout — split App into left 60% / right 40% using Ink Box width props in App.tsx
- [x] 5. Clear plan state on resetFeature — already done in step 1, planLines and planCostInfo cleared in resetFeature()
- [x] 6. Run typecheck and lint to verify everything compiles — both pass clean, all non-smoke tests pass

## Summary

Implemented a right-side plan panel occupying 40% of the terminal width. Changes across 3 files:

- **`src/ui/store.ts`**: Added `PlanLine` interface, `planLines` and `planCostInfo` state fields, `setPlanLines()` and `setPlanCostInfo()` methods, and clearing in `resetFeature()`.
- **`src/KaiAgent.ts`**: Added `parsePlanLines()` to extract checkbox lines from the `## Plan` section of feature files, `refreshPlanLines()` called after each streamed message to keep the UI in sync, and cost info pushed to the store on completion.
- **`src/ui/App.tsx`**: Added `PlanPanel` component showing checkboxes (✅/⬜), "Feature Complete" in green with cost info when done. Restructured `App` layout into a left (60%) / right (40%) split using Ink `Box` width props. Header and status bar remain full-width.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.9476
- **Turns:** 35
- **Time:** 235.1s
