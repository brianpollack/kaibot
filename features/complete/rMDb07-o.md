Feature ID: aw2b0fvP

Feature ID: rMDb07-o

Update the settings editor to add Ctrl+S as the hot key for Save and remove the icon on the save button.
Remove the page right margin line on the ace editor used in the settings.

## Plan

- [x] 1. Add Ctrl+S keyboard shortcut to save the settings file in client.js — added document-level Ctrl+S/Cmd+S handler for settings view + Ace editor command binding
- [x] 2. Remove the floppy disk icon from the save button in templates.ts — removed &#x1F4BE; emoji from button text
- [x] 3. Hide the print margin line in the Ace editor settings in client.js — added showPrintMargin: false to editor options

## Summary

Added Ctrl+S (Cmd+S on Mac) as a keyboard shortcut to save the current file in the settings editor, both at the document level and as an Ace editor command binding. Removed the floppy disk icon from the Save button in the settings toolbar. Disabled the print margin line in the Ace editor by setting `showPrintMargin: false`.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.6975
- **Turns:** 19
- **Time:** 136.6s
