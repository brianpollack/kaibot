Create a command line (npm run feature) or (tsx kai_bot.ts feature) that reads the feature name from the
command line and forms a slug.  Example "kai_bot.ts feature This is a new feature" creates a feature called
feature/this_is_a_new_feature.md

Allow the user to type in details of a feature.

The agent should review the details and determine if they make sense or if clarification is needed.
If clarification is needed, it should be asked.

Then full details and instructions should be written to the feature md file and the command kai_bot should exit.

## Plan

- [x] 1. Create `src/slugify.ts` — regex-based slug conversion utility
- [x] 2. Create `src/feature_creator.ts` — interactive readline flow with agent review/clarification loop via KaiClient
- [x] 3. Add `feature` subcommand to `src/kai_bot.ts` — routes to createFeature(), validates args/API key
- [x] 4. Add `npm run feature` script to `package.json` — added "feature": "tsx src/kai_bot.ts feature"
- [x] 5. Write tests for slugify in `src/__tests__/slugify.test.ts` — 10 test cases covering edge cases
- [x] 6. Write tests for feature_creator in `src/__tests__/feature_creator.test.ts` — 7 tests for parseReviewResponse
- [x] 7. Update `README.md` and `CLAUDE.md` with the new command — added feature command to both docs
- [x] 8. Run typecheck, lint, and tests to verify everything passes — all 136 tests pass, 0 lint/type errors

## Summary

Implemented the `npm run feature` CLI command for interactive feature file creation. The user provides a feature name via CLI args (e.g., `npm run feature -- Add user authentication`), which gets slugified into a filename (`add_user_authentication.md`). The user then enters feature details via multiline stdin input. A Claude agent reviews the details and either asks clarifying questions (up to 3 rounds) or writes a polished feature specification to `features/<slug>.md`. New files: `src/slugify.ts` (slug utility), `src/feature_creator.ts` (interactive flow with agent review), plus 17 new tests across two test files.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.4252
- **Turns:** 52
- **Time:** 263.4s
