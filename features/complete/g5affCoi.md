Feature ID: g5affCoi

The `#status-message` element inside the `#bottom-status` footer bar can display long text that wraps to the next line, breaking the fixed 30px height layout. Add CSS text-overflow ellipsis handling so long status text is truncated with "…" instead of wrapping.

**Current behavior:** Long status messages wrap onto multiple lines, overflowing the 30px footer height.

**Desired behavior:** Long status messages are truncated with an ellipsis (`…`) and stay on a single line within the footer.

**Implementation:**

In `web/static/css/main.css`, add the following CSS properties to the `#bottom-status` rule (or as a new `#status-message` rule):

- `white-space: nowrap` — prevent text from wrapping
- `overflow: hidden` — hide overflowing text
- `text-overflow: ellipsis` — show "…" when text is truncated

The most appropriate place is a new `#status-message` rule since the `#bottom-status` footer is a flex container and the span inside it should handle its own overflow. The `#status-message` span needs:

```css
#status-message {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
```

The `min-width: 0` is needed because flex children don't shrink below their content size by default — this allows the span to shrink and trigger ellipsis.

**Acceptance criteria:**
- The `#status-message` span never wraps text to a second line
- When the status text is too long for the available width, it is truncated with an ellipsis ("…")
- The `#bottom-status` footer maintains its fixed 30px height regardless of status text length
- Short status messages display normally with no truncation

**Technical notes:**
- File to modify: `web/static/css/main.css` (add rules near the existing `#bottom-status` block around line 1293)
- This is a CSS-only change — no JavaScript or TypeScript modifications needed
- Tests should NOT be added — this is a purely visual/styling fix

## Plan

- [x] 1. Add `#status-message` CSS rule after the `#bottom-status` block in `web/static/css/main.css` — added `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, and `min-width: 0` rules at line 1305

## Summary

Added a `#status-message` CSS rule in `web/static/css/main.css` immediately after the `#bottom-status` block. The rule applies `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, and `min-width: 0` to ensure long status messages are truncated with an ellipsis instead of wrapping and breaking the fixed 30px footer height. This is a CSS-only change with no logic modifications.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.1235
- **Turns:** 7
- **Time:** 30.7s
