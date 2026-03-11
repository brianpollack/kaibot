# Feature: Subtract 4 from Ink Screen Width

When using ink's terminal width detection, the reported value is consistently too large, causing layout overflow or wrapping issues. Every place that reads the terminal column width should subtract 4 from the raw value to provide a safe margin.

## Locations to Update

1. **`src/ui/App.tsx`** — `App` component:
   - Line ~591: `useState(stdout.columns ?? 80)` → subtract 4
   - Line ~596 (resize handler): `setCols(stdout.columns ?? 80)` → subtract 4

2. **`src/ui/store.ts`** — `UIStore`:
   - Line ~105 (initial state): `process.stdout.columns ?? 80` → subtract 4
   - Line ~152 (`updateTerminalSize`): `process.stdout.columns ?? 80` → subtract 4

## Implementation Notes

- Apply the subtraction **at the point of reading** the raw columns value, so all downstream consumers automatically get the corrected width.
- Use `(stdout.columns ?? 80) - 4` (or `(process.stdout.columns ?? 80) - 4`) consistently at each site.
- Ensure the fallback of 80 also has 4 subtracted (i.e., the effective fallback becomes 76).

## Acceptance Criteria

- Every place that reads `stdout.columns` or `process.stdout.columns` for layout purposes subtracts 4 from the value.
- The ink UI renders without overflow or unexpected wrapping at standard terminal widths.

## Testing

This is a UI/layout adjustment only — **do not add tests** for this change.

## Plan

- [x] 1. Update `src/ui/App.tsx` — subtract 4 from `stdout.columns` in initial `useState` — changed to `(stdout.columns ?? 80) - 4`
- [x] 2. Update `src/ui/App.tsx` — subtract 4 from `stdout.columns` in resize handler — changed to `(stdout.columns ?? 80) - 4`
- [x] 3. Update `src/ui/store.ts` — subtract 4 from `process.stdout.columns` in initial state — changed to `(process.stdout.columns ?? 80) - 4`
- [x] 4. Update `src/ui/store.ts` — subtract 4 from `process.stdout.columns` in `updateTerminalSize` — changed to `(process.stdout.columns ?? 80) - 4`
- [x] 5. Run typecheck to verify no errors — `npm run typecheck` passed cleanly

## Summary

Subtracted 4 from the raw terminal column width at all four reading sites — two in `src/ui/App.tsx` (initial `useState` and resize handler) and two in `src/ui/store.ts` (initial state and `updateTerminalSize`). This provides a safe 4-column margin so the Ink UI no longer overflows or wraps at standard terminal widths. The effective fallback is now 76 columns (80 − 4). TypeScript typecheck passes with no errors.

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.2823
- **Turns:** 13
- **Time:** 101.6s
