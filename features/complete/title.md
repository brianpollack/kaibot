Feature ID: OR9qi3Np

When a new feature request comes in, use the Claude Agent SDK to
create a short title of 20-80 letters that title the
change.  Add the title to the WebUI and InkJS UI while processing.
Add the title to the log json file as well.

## Plan

- [x] 1. Add a `generateTitle()` function in KaiAgent.ts that uses the SDK (cheap model) to create a 20-80 character title from feature file content — added in src/KaiAgent.ts using claude-haiku-4-5
- [x] 2. Add a `title` field to the `FeatureRecord` interface in featureDb.ts — added `title: string` field
- [x] 3. Call `generateTitle()` early in `handleFeatureFile()` in KaiBot.ts and update uiStore.featureName with the generated title — generates title before agent starts, updates UI
- [x] 4. Call `generateTitle()` early in `handleLinearIssue()` in KaiBot.ts (supplement with AI title if Linear title is just an identifier) — added title generation, falls back to issue.title
- [x] 5. Pass the generated title into the feature record and log JSON output — title field added to both file and Linear records, and to CompleteFeature in routes.ts
- [x] 6. Verify Web UI and Ink UI already display featureName — both UIs auto-update via uiStore; also updated client.js renderCompleteFeatures to prefer title field
- [x] 7. Add tests for the `generateTitle()` function — 7 unit tests in src/__tests__/generateTitle.test.ts, all passing

## Summary

Added AI-powered feature title generation using the Claude Agent SDK. When a new feature request arrives (from a file or Linear issue), a `generateTitle()` function calls `claude-haiku-4-5` to produce a concise 20-80 character title from the feature content. This title is immediately displayed in both the Ink terminal UI and Web UI via `uiStore.setFeatureName()`, and is persisted as a `title` field in the feature record database (`.kaibot/features.json`) and individual log JSON files (`features/log/<id>.json`). The Web UI's completed features list now prefers the AI-generated title over the raw description. Seven unit tests cover the title generation logic including edge cases for empty content, truncation, and error handling.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $2.3838
- **Turns:** 53
- **Time:** 345.7s
