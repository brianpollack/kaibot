# Cost Tracking

Track token usage and wall-clock time for each feature run, then append a `## Cost` section to the completed feature file summarising the session.

## Background

`SDKResultSuccess` already exposes `total_cost_usd`, `num_turns`, and `usage` (which contains `input_tokens` and `output_tokens`). The agent also knows the start time. This data should be captured in `processFeature` and written back into the feature file before `KaiBot` renames it to `_complete`.

## Acceptance Criteria

1. Every `_complete.md` file ends with a `## Cost` section in this format:

   ```markdown
   ## Cost

   | Field            | Value              |
   | ---------------- | ------------------ |
   | Model            | claude-opus-4-6    |
   | Input tokens     | 12,345             |
   | Output tokens    | 1,234              |
   | Total cost (USD) | $0.0742            |
   | Turns            | 8                  |
   | Wall time        | 2m 14s             |
   ```

2. The section is appended to the `_inprogress.md` file (i.e. the same file the agent has been editing) immediately after `processFeature` resolves successfully — before `KaiBot` calls `markComplete`.

3. If `total_cost_usd` is zero or unavailable the cost row still appears (show `$0.0000`) so the table is always present.

4. Wall time is the elapsed time from when `processFeature` was called to when it returns, formatted as `Xm Ys` (e.g. `0m 5s`, `2m 14s`).

5. Token counts are formatted with thousands separators for readability.

## Implementation Notes

- `SDKResultSuccess.usage` shape: `{ input_tokens: number, output_tokens: number }` (plus possibly cache fields — ignore those).
- Capture `Date.now()` at the top of `processFeature` and compute elapsed on return.
- Write the section with `appendFileSync` (or `writeFileSync` with a read-modify-write) at the end of `processFeature`, after the result is confirmed successful.
- The model string is already available as a parameter to `processFeature`.
- Keep the helper function (`formatCostSection`) in `KaiAgent.ts` — no new file needed.
