# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run bot -- /path/to/project   # Start the feature watcher bot
npm run feature -- Feature name   # Create a new feature file interactively
npm run models       # List available Claude models
npm run build        # Compile TypeScript to dist/
npm run typecheck    # Type-check without emitting
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run format       # Prettier format src/
npm run test         # Run all tests (vitest run)
npm run test:watch   # Run tests in watch mode
```

Run a single test file:
```bash
npx vitest run src/__tests__/feature.test.ts
```

Set `ANTHROPIC_API_KEY` (required) and optionally `KAI_MODEL` (default: `claude-opus-4-6`) before running the bot or smoke tests.

> **Note:** Whenever a new npm script is added to `package.json`, update both the `## Commands` section above **and** the `## Usage` section in `README.md` with a brief description.

## Architecture

KaiBot watches a `features/` directory in a target project and processes each `.md` file through a Claude agent that plans and implements the feature autonomously.

### Feature file state machine

```
new_feature.md  →  new_feature_inprogress.md  →  new_feature_complete.md
```

`feature.ts` owns all state transitions: `isNewFeatureFile`, `parseFeature`, `markInProgress`, `markComplete`. These rename files on disk and return updated `Feature` objects.

### Component flow

```
kai_bot.ts (CLI entry)
  └─ KaiBot (polls features/ every 2s)
       └─ KaiAgent.processFeature()  — per-feature agent run
            └─ KaiClient.query()     — wraps @anthropic-ai/claude-agent-sdk query()
```

**`KaiBot`** (`src/KaiBot.ts`): Polls `{projectDir}/features/` with a `Set<string>` to prevent double-processing. Fires each feature as `void` (fire-and-forget). On error, leaves the file as `_inprogress` for manual inspection.

**`KaiClient`** (`src/KaiClient.ts`): Wraps `query()` from the agent SDK. Writes `.claude_settings.json` to the project dir (sandbox + permissions). Exposes `query()` for streaming and `run()` for simple completion. File ops are sandboxed to the project dir; Bash commands are validated by `bashSecurityHook`.

**`KaiAgent`** (`src/KaiAgent.ts`): Builds the agent prompt instructing it to read the feature file, explore the codebase, append a `## Plan` section with checkboxes, execute each step updating the checkboxes, then append `## Summary`. Streams assistant text and tool calls to stdout. Throws on non-success result subtypes.

**`security.ts`**: `bashSecurityHook` is a `PreToolUse` hook that validates the base command against `ALLOWED_COMMANDS`. Returns `{ decision: "block" }` for unlisted commands. Registered via `matcher: "Bash"` in KaiClient.

### Module resolution

ESM project (`"type": "module"`, NodeNext). All imports of local `.ts` files must use `.js` extension: `import { Feature } from "./feature.js"`.

### SDK notes

- Import types from `@anthropic-ai/claude-agent-sdk`; `@anthropic-ai/sdk` is bundled inside it, not a direct dependency
- `SDKResultMessage = SDKResultSuccess | SDKResultError` — narrow with `result.subtype === "success"`; `SDKResultSuccess` has `.result: string`, `SDKResultError` has `.errors: string[]`
- `message.content` blocks resolve to `any` — use duck-typed guards: `(b as Record<string, unknown>).type === "text"`
- `HookCallback` signature: `(input, toolUseID, options: { signal: AbortSignal }) => Promise<HookJSONOutput>`
