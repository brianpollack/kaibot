Feature ID: 4s9JgeuK

Feature ID: ro0clm2f

The command npm run testOpenrouter detects the Openrouter key but the model list is still from Anthropic.  Verify the way the model list is loaded should use the Openrouter settings.

## Plan

- [x] 1. Add error logging in `printModels` OpenRouter catch block so fetch failures aren't silent — added error message to catch block in models.ts
- [x] 2. Make the `models` subcommand load `.env` and support a provider argument so `npm run models` can show OpenRouter models — updated kai_bot.ts models subcommand to load env and accept provider arg
- [x] 3. Update `fetchOpenRouterModels` to not silently swallow errors and ensure response parsing is robust — added validation for data array and empty results in models.ts
- [x] 4. Add OpenRouter pricing support in `getPricing` for `anthropic/` prefixed model IDs — strip provider prefix before matching in getPricing
- [x] 5. Update the `models` npm script and CLAUDE.md/README.md docs to reflect new provider support — updated both docs
- [x] 6. Run typecheck and lint to verify changes — both pass clean, all tests pass

## Summary

Fixed `npm run testOpenrouter` model listing and improved the overall model discovery experience:

1. **Error visibility**: The OpenRouter fetch catch block now logs the error message instead of silently falling back to the static list, so users can see why the live fetch failed.
2. **Robust parsing**: `fetchOpenRouterModels` now validates the API response structure and reports when no Claude models are found.
3. **`npm run models` improved**: The `models` subcommand now loads `.env` (so API keys are available) and accepts an optional provider argument (`npm run models -- openrouter`). It also hints about OpenRouter availability when the key is detected.
4. **OpenRouter pricing**: `getPricing` now strips the `anthropic/` provider prefix from model IDs before matching, so OpenRouter models correctly display pricing info.
5. **Docs updated**: Both CLAUDE.md and README.md updated to reflect the new `models` command capabilities.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0579
- **Turns:** 27
- **Time:** 302.8s
