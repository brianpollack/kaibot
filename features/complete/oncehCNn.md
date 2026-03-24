Feature ID: FVDt4z6C

Feature ID: oncehCNn

The new feature window and editor is very small.  If the css detects a large enough screen size, then double the size of the new feature window.

## Plan

- [x] 1. Add a CSS media query for large screens (min-width: 1400px) that doubles the dialog box width and textarea height — added `@media (min-width: 1400px)` block to `web/static/css/main.css` doubling `.dialog-box` width (560px → 1120px) and `.dialog-textarea` min-height (180px → 360px)
- [x] 2. Verify the changes with typecheck/build — typecheck passes clean

## Summary

Added a CSS media query (`@media (min-width: 1400px)`) at the end of `web/static/css/main.css` that doubles the new feature dialog size on large screens:
- Dialog width: 560px → 1120px
- Textarea min-height: 180px → 360px

The existing `max-width: 90vw` constraint is preserved, so the dialog still adapts gracefully on intermediate screen sizes.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.3181
- **Turns:** 9
- **Time:** 94.3s
