When adding a feature that is related to User Interface, either CLI apps or React apps, do not add test cases.   If We are not changing logic, do not add new tests

## Plan

- [x] 1. Add a testing guideline to the `buildPrompt` function in `src/KaiAgent.ts` — added "Testing guidelines" section to the agent prompt with rules for UI/non-logic features
- [x] 2. Add a similar testing guideline to the `buildReviewPrompt` function in `src/feature_creator.ts` — added instruction to note when tests should be skipped in feature specs
- [x] 3. Run typecheck and lint to verify no errors — both pass cleanly

## Summary

Added testing guidelines to the KaiBot agent system so that UI-related features (CLI apps, React components, styling, layout) and features that don't change logic will not have tests added automatically. The guidelines were added in two places:

1. **`src/KaiAgent.ts`** — A new "Testing guidelines" section in the `buildPrompt` function tells the implementing agent when to skip or add tests.
2. **`src/feature_creator.ts`** — The `buildReviewPrompt` function now instructs the review agent to note in the feature spec when tests should be skipped.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.3450
- **Turns:** 18
- **Time:** 80.0s
