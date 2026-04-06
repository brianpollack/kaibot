Feature ID: 83vPuOMZ
Title: Theme Selection

Add a **Theme** option to the Global Settings area of the web-based Settings screen. This lets users change KaiBot's color scheme and icon theme by browsing VS Code Marketplace themes, or reset to the built-in default.

### Current State
- Global settings live in `~/.kaibot/settings.json` (managed by `src/globalSettings.ts`); currently only holds `matomoEnabled`.
- The web UI is vanilla HTML/JS served by `src/web/WebServer.ts` with templates in `src/web/templates.ts` and styles in `web/static/css/main.css`.
- All colors are hard-coded in `main.css` (dark theme, blue/gray palette). No CSS custom-property system exists yet.
- Ace Editor is loaded from CDN (`v1.32.7`) and used for editing settings files and feature descriptions.

### Requirements

**1. Refactor existing CSS to use CSS custom properties**
- Extract every color value in `web/static/css/main.css` into CSS custom properties (e.g. `--kb-bg-primary`, `--kb-text`, `--kb-accent`, `--kb-sidebar-bg`, etc.) on `:root`.
- Replace all hard-coded color references with the corresponding `var(--kb-*)` tokens.
- This becomes the built-in "KaiBot" default theme — visually identical to today.

**2. Global Settings — Theme section**
- In the Settings screen's "Global Settings" area, add a **Theme** card/section.
- Show the currently active theme name (default: "KaiBot").
- Provide a **Browse Themes…** button that opens a theme-browse modal/view.
- Persist the selected theme identifier in `~/.kaibot/settings.json` under a `theme` key (e.g. `{ "matomoEnabled": true, "theme": { "id": "dracula-theme.theme-dracula", "name": "Dracula Official" } }`). When `theme` is absent or `null`, use the built-in KaiBot default.

**3. Theme Browse view (modal/overlay)**
- **Reset to Default KaiBot Theme** button at the top of the modal.
- **Filter / Search** text input that searches the VS Code Marketplace API by keyword, restricted to the "Themes" category.
- Results list showing for each extension:
  - Theme name
  - Last updated date (formatted nicely, e.g. "Mar 12, 2025")
  - Install count (formatted with commas or abbreviation, e.g. "1.2M")
  - A **Select** button
- Paginate or lazy-load if results exceed a reasonable page size.

**4. VS Code Marketplace API integration**
- Use the public VS Code Marketplace REST API (`https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery`) to search extensions.
  - POST with `filters[0].criteria` containing `filterType: 8` (target: `Microsoft.VisualStudio.Code`), `filterType: 5` (category: `"Themes"`), and `filterType: 10` (search text from the keyword filter).
  - Request `flags: 0x192` (or equivalent) to include statistics and version info.
- Add a server-side proxy route (e.g. `POST /api/themes/search`) in `WebServer.ts` so the browser doesn't hit CORS issues. The route accepts `{ query: string, page?: number }` and returns the normalized results.

**5. Theme application**
- When the user selects a marketplace theme:
  1. Download the extension's `.vsix` package (it's a ZIP) from the version's `assetUri` or `fallbackAssetUri`.
  2. Extract the theme JSON/JSONC file from the package (look inside `extension/themes/` for `.json` or `.tmTheme` files referenced in `package.json`'s `contributes.themes`).
  3. Map VS Code theme token colors and workbench colors to KaiBot's CSS custom properties as best as possible:
     - `editor.background` → `--kb-bg-primary`
     - `editor.foreground` → `--kb-text`
     - `sideBar.background` → `--kb-sidebar-bg`
     - `activityBar.background` → `--kb-header-bg`
     - `button.background` → `--kb-accent`
     - `statusBar.background` → `--kb-status-bg`
     - Map additional workbench colors to other custom properties where a sensible mapping exists; unmapped properties fall back to the KaiBot defaults.
  4. Write the generated CSS to `~/.kaibot/theme.css`.
  5. The web server should serve this file (e.g. `GET /theme.css`) and the HTML template should include `<link rel="stylesheet" href="/theme.css">` **after** `main.css` so it overrides the defaults.
- Also generate an Ace Editor theme from the same source colors. Write it as a JS module or inline `<style>` that defines an `ace/theme/kaibot-custom` theme, and apply it to all Ace Editor instances when a custom theme is active.
- 
Make sure to use an expire setting headers so that changes in theme.css can be live reloaded.

**6. Reset to default**
- Remove the `theme` key from global settings.
- Delete (or empty) `~/.kaibot/theme.css`.
- Revert Ace editors to their current default theme.

### Technical Notes
- This is primarily UI and styling work. **Do not add unit tests** for this feature.
- All new server routes should follow the existing Express patterns in `WebServer.ts`.
- Use `fetch` (Node 18+ built-in) for Marketplace API calls from the server side.
- The `.vsix` file is a standard ZIP — use the `unzipper` or `adm-zip` npm package (or Node's built-in `zlib` if preferred) to extract theme files. If adding a dependency, install it and add to `package.json`.
- Ensure the feature degrades gracefully: if the Marketplace API is unreachable or a theme can't be parsed, show an error message and keep the current theme.
- The theme browse modal styling should match the existing modal patterns (e.g. the "New Feature" dialog in `templates.ts`).

### Acceptance Criteria
- [ ] All hard-coded colors in `main.css` are replaced with CSS custom properties; the app looks identical with no theme selected.
- [ ] Global Settings shows the active theme name and a Browse button.
- [ ] The Browse modal searches the VS Code Marketplace filtered to Themes and displays name, date, installs, and a Select button.
- [ ] A keyword filter narrows marketplace search results.
- [ ] Selecting a theme generates `~/.kaibot/theme.css` with mapped CSS custom properties and applies it to the UI without a full page reload (or with a minimal reload).
- [ ] Ace Editor instances pick up colors from the selected theme.
- [ ] "Reset to Default KaiBot Theme" reverts everything to the built-in palette.
- [ ] The chosen theme persists in `~/.kaibot/settings.json` and is re-applied on next server start.
- [ ] Errors from the Marketplace API or theme parsing are shown to the user gracefully.

## Accounting Note

KaiBot Assistant took 1 minute, 42 seconds, used 2.0k tokens, cost $0.34