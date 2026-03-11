The command "npx src/kai_bot.ts models" uses printModels from models.ts but it's static.  It should use the anthropic
key and the anthropic client SDK to list available models.  If possible list current token cost as well such as $5.000 / million

## Plan

- [x] 1. Add `fetchModels()` to `src/models.ts` — added async function calling GET /v1/models with API key
- [x] 2. Add static pricing map to `src/models.ts` — added MODEL_PRICING map with per-prefix input/output costs and getPricing() helper
- [x] 3. Rewrite `printModels()` to be async — fetches live models with pricing table, falls back to static list on API error
- [x] 4. Update `src/kai_bot.ts` — changed to `await printModels()`
- [x] 5. Update `src/__tests__/models.test.ts` — rewrote tests with fetch mocking, pricing, live/fallback coverage
- [x] 6. Run tests and typecheck to verify everything passes — 20 tests pass, lint clean, typecheck clean

## Summary

Replaced the static `printModels()` in `src/models.ts` with a live implementation that calls the Anthropic `GET /v1/models` API endpoint using the `ANTHROPIC_API_KEY` environment variable. The output now shows all models available to the user's API key, sorted alphabetically, with a pricing table showing input/output costs per million tokens. If the API key is not set or the API call fails, it gracefully falls back to the original static model list.

**Files changed:**
- `src/models.ts` — Added `fetchModels()`, `getPricing()`, `MODEL_PRICING` map, and made `printModels()` async with live API support
- `src/kai_bot.ts` — Updated to `await printModels()` (now async)
- `src/__tests__/models.test.ts` — Rewrote tests with fetch mocking covering live listing, pricing display, fallback behavior, and error handling (20 tests)
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0891
- **Turns:** 49
- **Time:** 279.4s
