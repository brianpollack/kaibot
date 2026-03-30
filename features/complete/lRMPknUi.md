Feature ID: lRMPknUi

KaiBot's web UI uses the ACE editor (v1.32.7, loaded from CDN) in two places — the **New Feature description editor** and the **Settings file editor**. Both currently use the `ace/theme/monokai` theme. Update both instances to use the `ace/theme/tomorrow_night` (Midnight-style dark theme) instead.

**Files to modify:**

- `web/static/html/client.js`
  - In `initNFEditor()` (~line 1423): change `nfAceEditor.setTheme("ace/theme/monokai")` → `nfAceEditor.setTheme("ace/theme/tomorrow_night")`
  - In `initSettingsEditor()` (~line 1437): change `settingsAceEditor.setTheme("ace/theme/monokai")` → `settingsAceEditor.setTheme("ace/theme/tomorrow_night")`

**Acceptance criteria:**

1. Both ACE editor instances (`nfAceEditor` and `settingsAceEditor`) use the `ace/theme/tomorrow_night` theme.
2. No other editor options (fontSize, showLineNumbers, showPrintMargin, wrap, mode) are changed.
3. The ACE CDN already bundles `tomorrow_night` — no additional script tags are needed.
4. The editors render correctly in the web UI with the new dark theme.

**Technical notes:**

- The `tomorrow_night` theme is a built-in ACE theme available from the same CDN and does not require an extra `<script>` import — ACE lazy-loads themes by convention. If you prefer an alternative dark/midnight theme (e.g., `ace/theme/twilight`, `ace/theme/clouds_midnight`), that is also acceptable as long as it is a dark theme.
- This is purely a UI/styling change — **do not add tests**.

## Plan

- [x] 1. Update `nfAceEditor` theme from `monokai` to `tomorrow_night` in `initNFEditor()` — changed line 1422 in `web/static/html/client.js`
- [x] 2. Update `settingsAceEditor` theme from `monokai` to `tomorrow_night` in `initSettingsEditor()` — changed line 1436 in `web/static/html/client.js`

## Summary

Updated both ACE editor instances in `web/static/html/client.js` to use the `ace/theme/tomorrow_night` theme instead of `ace/theme/monokai`. The New Feature description editor (`nfAceEditor`) and Settings file editor (`settingsAceEditor`) now render with the Tomorrow Night dark theme. No other editor options were modified.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.1422
- **Turns:** 10
- **Time:** 37.3s
