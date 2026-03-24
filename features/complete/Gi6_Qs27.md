Feature ID: SrzuBphu

Feature ID: Gi6_Qs27

When using OpenRouter, the model list shuold be loaded using a request with node's http class.  Here is an example where token is the OPENROUTER_API_TOKEN we have set.   Test this to make sure it works and so you know the JSON return format before coding.

curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer <token>"

## Plan

- [x] 1. Replace `fetchOpenRouterModels` in `src/models.ts` to use Node's `https` module instead of `fetch` — rewrote using `https.get` with chunked response handling
- [x] 2. Update the test for `fetchOpenRouterModels` in `src/__tests__/models.test.ts` to mock `https.get` instead of `fetch` — added new test suite with mocked `node:https`
- [x] 3. Run tests and typecheck to verify everything works — all 232 tests pass, typecheck clean

## Summary

Replaced the `fetchOpenRouterModels` function in `src/models.ts` to use Node's native `https` module (`node:https`) instead of the global `fetch` API. The function now uses `https.get()` with chunked response buffering and manual JSON parsing. Added comprehensive tests in `src/__tests__/models.test.ts` covering success, HTTP errors, missing Claude models, and connection errors — all mocking `node:https` via `vi.mock`.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.0594
- **Turns:** 20
- **Time:** 149.8s
