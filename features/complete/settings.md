Feature ID: HkGGjo6I

Settings for the Model, Provider (Anthropic) and
any other settings we add should be saved to a .kaibot/settings.json file which
can be loaded upon project start to reload previous
settings.

## Plan

- [x] 1. Create `src/settings.ts` with `KaiBotSettings` type, `loadSettings`, and `saveSettings` functions — created src/settings.ts
- [x] 2. Update `src/kai_bot.ts` to load settings on startup and use saved model as fallback (env var > settings > default) — loadSettings called before model is resolved
- [x] 3. Save settings to disk when the model changes via the `model-changed` event in `src/kai_bot.ts` — saveSettings called inside model-changed handler
- [x] 4. Add tests for `src/settings.ts` in `src/__tests__/settings.test.ts` — 11 tests covering load/save/round-trip, all passing

## Summary

Implemented persistent settings storage in `.kaibot/settings.json`. Created `src/settings.ts` with a `KaiBotSettings` interface and `loadSettings`/`saveSettings` helpers (following the same pattern as `featureDb.ts`). Updated `src/kai_bot.ts` to load saved settings at startup — the model resolution priority is now `KAI_MODEL` env var → `settings.json` → default `"claude-opus-4-6"`. The `model-changed` event handler in `kai_bot.ts` now persists the new model to `settings.json`, so any model selection made via the UI is remembered across bot restarts. Added 11 unit tests covering all edge cases (missing file, empty file, invalid JSON, JSON array, valid model/provider, overwrite, and round-trip).
## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.5008
- **Turns:** 27
- **Time:** 148.5s
