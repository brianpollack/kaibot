# Feature: F-Hotkey Agent Review

## Description

Currently, the F hotkey in the bot watch UI writes the user's raw description directly to a feature file via `writeFeatureFromDescription()`. In contrast, `npm run feature` sends the description through an agent review loop (`buildReviewPrompt` → `KaiClient.run()`) that produces a well-structured specification. The F hotkey should use the same agent review process so both paths produce identical quality output.

## Current Behavior

- **`npm run feature`**: Collects description → sends to agent via `buildReviewPrompt()` → agent returns polished spec (with up to 3 clarification rounds) → writes to file.
- **F hotkey**: Collects description in `FeatureInput` overlay → calls `writeFeatureFromDescription()` → derives name and writes raw text directly to `features/{slug}.md`. No agent review.

## Desired Behavior

When the user presses F and submits a description, the system should:

1. Send the description through the same agent review pipeline used by `npm run feature` (i.e., call `buildReviewPrompt()` and `KaiClient.run()`).
2. Write the agent-refined specification to the feature file (not the raw input).
3. Show appropriate UI feedback while the agent is processing (e.g., a "Processing..." or spinner state in the flash message or overlay).

## Technical Notes

- The main change is in the code path triggered when `FeatureInput` completes (in `App.tsx` around line 593-606 and/or `store.ts` around line 254-274). Instead of calling `writeFeatureFromDescription()`, it should call a function that includes the agent review step.
- `feature_creator.ts` already has `createFeature()` with the full review loop and `writeFeatureFromDescription()` as the headless shortcut. Consider extracting or reusing the review logic from `createFeature()` so the F-hotkey path can call it.
- Since the agent review is async and takes several seconds, the UI must handle the waiting state gracefully — keep the user informed that processing is happening, and don't allow double-submission.
- Clarification rounds (the `CLARIFY` loop in `createFeature`) are not feasible in the hotkey UI context. If the agent responds with `CLARIFY`, either: (a) retry once asking the agent to do its best with the info provided, or (b) fall back to writing the raw description. Option (a) is preferred.
- The `KaiClient` instance and model name must be available in the UI/store context. Check how `projectDir` and `model` are currently passed and ensure `KaiClient` can be constructed or shared.

## Acceptance Criteria

- [ ] Pressing F, entering a description, and confirming produces the same quality feature file as `npm run feature -- <same description>`.
- [ ] The UI shows a loading/processing indicator while the agent is refining the spec.
- [ ] The user cannot submit another feature via F while one is being processed.
- [ ] If the agent review fails (network error, API error), the system falls back to writing the raw description (current behavior) and shows a warning.
- [ ] Existing `npm run feature` behavior is unchanged.

## Plan

- [x] 1. Export `buildReviewPrompt` and add `buildNoClarifyRetryPrompt` in `feature_creator.ts` — added `reviewAndWriteFeature()` async function that runs agent review, retries on CLARIFY, falls back to raw on error, writes file.
- [x] 2. Add `featureReviewActive` state to `store.ts` with setter/getter — added field, setter, and reset logic.
- [x] 3. Update `FeatureInput` in `App.tsx` to call `reviewAndWriteFeature()` instead of `writeFeatureFromDescription()`, show spinner in HotkeyBar while active, disable F key during review.
- [x] 4. Run typecheck and lint to verify correctness — both pass cleanly.

## Summary

Implemented agent review for the F-hotkey feature creation flow. When the user presses F and submits a description, it now goes through the same `buildReviewPrompt` → `KaiClient.run()` pipeline used by `npm run feature`, producing a well-structured specification instead of writing the raw description.

**Changes:**

- **`src/feature_creator.ts`**: Exported `buildReviewPrompt`. Added `buildNoClarifyRetryPrompt` (handles CLARIFY responses without interactive input) and `reviewAndWriteFeature()` — an async function that runs agent review, retries once on CLARIFY, falls back to raw description on any error, and writes the file.
- **`src/ui/store.ts`**: Added `featureReviewActive` boolean state with setter and reset support, used to show processing UI and prevent double-submission.
- **`src/ui/App.tsx`**: `FeatureInput` now calls `reviewAndWriteFeature()` instead of `writeFeatureFromDescription()`. `HotkeyBar` shows a spinner while the agent is reviewing. The F hotkey is disabled during review to prevent double-submission. On agent failure, falls back to writing the raw description with a warning note in the flash message.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.7474
- **Turns:** 27
- **Time:** 158.8s
