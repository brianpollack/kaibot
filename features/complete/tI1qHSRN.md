Feature ID: klZiGiQo

Feature ID: tI1qHSRN

OpenRouter is an alternative to Anthropic for models.   OpenRouter support should be enabled if the env key is setup before starting the KaiBot.  Check for the key OPENROUTER_API_KEY

If set, we should be able to switch providers from Anthropic to OpenRouter by pressing the P key in the Web UI.   This will use a menu exactly like the model selection.

When we activate OpenRouter we should update the list of available models.   

According to the Claude Agent SDK, we need to close the SDK agent and re-open it with these settings:

# Add these lines to the file:
export OPENROUTER_API_KEY="<your-openrouter-api-key>"
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_API_KEY="" # Important: Must be explicitly empty

Add a command "npm run testOpenrouter" that will switch the OpenRouter mode and list the available models to the console.

## Plan

- [x] 1. Add provider concept to models.ts — added ProviderName type, PROVIDERS list, OpenRouter models, fetchOpenRouterModels(), getModelsForProvider(), updated printModels() for provider param
- [x] 2. Add provider state to UIStore — added provider/isSelectingProvider to UIState, default values, setProvider/startProviderSelection/finishProviderSelection/selectProvider methods
- [x] 3. Add provider support to KaiClient — added provider param to constructor/create, sets ANTHROPIC_BASE_URL/AUTH_TOKEN for openrouter, restoreEnv() method
- [x] 4. Add provider selector to terminal UI (App.tsx) — added ProviderSelector component, P hotkey, updated HotkeyBar and ModelSelector to use provider-aware model list
- [x] 5. Add provider selector to Web UI — added openProviderSelector in client.js, P key handler, select-provider WebSocket msg, /api/providers endpoint, clickable provider badge in template
- [x] 6. Wire provider changes through kai_bot.ts and KaiBot.ts — added provider to KaiBot constructor, provider-changed listener, passed provider through processFeature to KaiClient
- [x] 7. Update web templates and wsHandler — added provider to WebUIState, updated wsHandler broadcast, made provider badge clickable in templates (done in step 5)
- [x] 8. Add "npm run testOpenrouter" script — added testOpenrouter subcommand in kai_bot.ts and npm script in package.json
- [x] 9. Update CLAUDE.md and README.md — documented OPENROUTER_API_KEY, testOpenrouter command in both files

## Summary

Implemented OpenRouter as an alternative provider to Anthropic's direct API. When `OPENROUTER_API_KEY` is set in the environment, users can switch between providers by pressing **P** in both the terminal UI and web UI. The provider selector uses the same popup menu pattern as the existing model selector. When switching providers, the model list automatically updates to show provider-appropriate models (e.g. `anthropic/claude-opus-4` for OpenRouter vs `claude-opus-4-6` for Anthropic). The `KaiClient` configures the Claude Agent SDK to route through OpenRouter by setting `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and clearing `ANTHROPIC_API_KEY` as specified. Provider selection is persisted in `.kaibot/settings.json`. A new `npm run testOpenrouter` command validates the OpenRouter API key and lists available models.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $6.7895
- **Turns:** 117
- **Time:** 665.4s
