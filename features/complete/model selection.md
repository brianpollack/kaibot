Feature ID: z_xXPSmU

When using the WebUI to change model, I can't click on the menu item.  I can only select it with the keyboard.  Fix to enable common web usage, mouse over, click, etc

## Plan

- [x] 1. Refactor `renderPopupItems()` to remove the per-item click/mouseenter listeners it re-attaches each render — removed per-item listener attachment from `renderPopupItems()` in `web/static/html/client.js`
- [x] 2. Add delegated `click` and `mouseover` listeners to the menu element once inside `showPopupMenu()`, so clicks survive innerHTML re-renders — added delegated listeners to the stable `menu` element in `showPopupMenu()` in `web/static/html/client.js`

## Summary

The model selector popup couldn't be clicked because `renderPopupItems()` replaced the entire `menu.innerHTML` on every `mouseenter`, destroying the clicked item's DOM element mid-click (between `mousedown` and `mouseup`). Fixed by switching to event delegation: per-item click/mouseenter listeners were removed from `renderPopupItems()` and replaced with a single `click` + `mouseover` listener attached once to the stable `menu` element inside `showPopupMenu()`. These delegated listeners survive innerHTML re-renders, so mouse hover and mouse click now both work as expected.
## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.4494
- **Turns:** 19
- **Time:** 183.8s
