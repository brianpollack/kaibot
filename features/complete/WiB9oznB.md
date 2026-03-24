Feature ID: Xbp0-Iob

Feature ID: WiB9oznB

When using OpenRouter, look for the ENV Value OPENROUTER_MODEL
if not set, default to z-ai/glm-5-turbo

Update "npm run openRoutertest" to spawn an agent using OpenRouter, select the model, and ask the agent "Tell me about yourself" and then output the result to the console.

## Plan

- [x] 1. Add OPENROUTER_MODEL env var support in models.ts — added `DEFAULT_OPENROUTER_MODEL` constant and `getOpenRouterModel()` helper
- [x] 2. Wire OPENROUTER_MODEL into kai_bot.ts model resolution — updated model resolution to use `getOpenRouterModel()` when provider is openrouter
- [x] 3. Update the testOpenrouter subcommand in kai_bot.ts — now spawns a KaiClient with OpenRouter, queries "Tell me about yourself", and prints the result
- [x] 4. Update documentation — CLAUDE.md and README.md updated with OPENROUTER_MODEL env var and new testOpenrouter description
- [x] 5. Run typecheck and lint to verify correctness — both pass (lint warnings are pre-existing)

## Summary

Added `OPENROUTER_MODEL` environment variable support for OpenRouter provider. When using OpenRouter, the model is resolved from `OPENROUTER_MODEL` (defaulting to `z-ai/glm-5-turbo`). The `npm run testOpenrouter` command now spawns an actual agent via `KaiClient` using the selected OpenRouter model, sends "Tell me about yourself", and prints the response to the console. Documentation updated in both CLAUDE.md and README.md.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.9363
- **Turns:** 28
- **Time:** 187.4s
