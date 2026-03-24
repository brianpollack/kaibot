Feature ID: gHUzW8-6

Feature ID: N7HnKv9C

When the job finishes and the log is written to features/log in json format, include the Provider name which is either Anthropic or OpenRouter

## Plan

- [x] 1. Add `provider` field to `FeatureRecord` interface in `src/featureDb.ts` — added `provider: string` field
- [x] 2. Include `provider` in the file-source record construction in `KaiBot.ts` (handleFeatureFile) — added provider label lookup
- [x] 3. Include `provider` in the Linear-source record construction in `KaiBot.ts` (handleLinearIssue) — added provider label lookup
- [x] 4. Add a test for the `provider` field in the FeatureRecord — skipped, this is a data record shape change with no complex logic
- [x] 5. Run typecheck and tests to verify — all 228 tests pass, typecheck clean

## Summary

Added a `provider` field to the `FeatureRecord` interface in `src/featureDb.ts` and populated it in both the file-source and Linear-source record constructions in `src/KaiBot.ts`. The field stores the human-readable provider label ("Anthropic" or "OpenRouter") by looking up the active `ProviderName` in the `PROVIDERS` array. This means the JSON log files written to `features/log/` now include a `provider` key indicating which API provider was used for the agent run.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.5146
- **Turns:** 31
- **Time:** 195.1s
