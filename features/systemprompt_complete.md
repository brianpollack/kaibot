Include project CLAUDE.md in the agent system prompt

When processing a feature, KaiClient should read the target project's `CLAUDE.md` (if it exists) and include its contents in the system prompt passed to the Claude Agent SDK. This gives the agent project-specific context about conventions, patterns, and instructions.

## Plan

- [x] 1. Add a helper function in KaiClient.ts that reads `{projectDir}/CLAUDE.md` if it exists — added `loadClaudeMd()` and `buildSystemPrompt()` exported functions
- [x] 2. Update `buildOptions()` to append the CLAUDE.md content to the system prompt — `buildOptions()` now calls `buildSystemPrompt(this.projectDir)`
- [x] 3. Add tests for the CLAUDE.md loading logic — created `src/__tests__/systemprompt.test.ts` with tests for `loadClaudeMd()` and `buildSystemPrompt()`
- [x] 4. Run typecheck and existing tests to verify nothing is broken — typecheck clean, all 165 tests pass (12 smoke tests skipped as expected)

## Summary

Implemented automatic inclusion of the target project's `CLAUDE.md` file in the agent system prompt. When KaiBot processes a feature, `KaiClient` now reads `{projectDir}/CLAUDE.md` (if it exists) and appends its content to the base system prompt with an "OVERRIDE" instruction header. This gives the agent project-specific context about conventions, patterns, and build instructions.

**Files changed:**
- `src/KaiClient.ts` — added exported `loadClaudeMd()` and `buildSystemPrompt()` functions; `buildOptions()` now uses `buildSystemPrompt()` instead of a hardcoded string
- `src/__tests__/systemprompt.test.ts` — new test file with 8 tests covering CLAUDE.md loading and system prompt construction

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.6595
- **Turns:** 28
- **Time:** 175.9s
