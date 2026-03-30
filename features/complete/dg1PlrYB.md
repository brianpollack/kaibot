Feature ID: dg1PlrYB

Currently when no feature is running, we have a blank conversation window, blank plan, etc.  Instead add a welcome screen that shows WELCOME.md from the KaiBot folder.  This file is no, create a welcome message for us here.   After showing the Welcome screen, show the from KaiBot's package file as "You are running KaiBot v1.2.3 in <Project Folder>"

## Plan

- [x] 1. Create WELCOME.md in the KaiBot root folder with a welcome message — created WELCOME.md with usage guide and hotkey reference
- [x] 2. Add a version utility (`src/version.ts`) that reads KaiBot's package.json version — created src/version.ts with getKaiBotVersion() and getKaiBotRoot()
- [x] 3. Add `welcomeText` to UIStore state, and a method to set it on startup — added welcomeText + kaibotVersion to UIState, with setWelcomeText() and setKaibotVersion() methods
- [x] 4. Load WELCOME.md content + version string on bot startup and push to store — added loading in startBotWithProject() in kai_bot.ts
- [x] 5. Update Ink terminal UI (App.tsx) to show welcome screen when status is "watching" and no feature is processing — added WelcomePanel component and conditional rendering
- [x] 6. Update Web UI (client.js) to show welcome screen in conversation panel when idle — added renderWelcomeContent() function and CSS styles
- [x] 7. Add `welcomeText` to WebUIState so the web client receives it — added welcomeText + kaibotVersion to WebUIState and getWebState()
- [x] 8. Fix hardcoded version in web templates nav footer to use dynamic version — replaced hardcoded "v0.1.0" with getKaiBotVersion() call

## Summary

Added a welcome screen that displays when KaiBot is watching for features and no feature is currently being processed. The welcome screen shows the content of `WELCOME.md` (a new file with a usage guide, how-it-works steps, and hotkey reference table) along with a version banner: "You are running KaiBot v0.9.0 in /path/to/project".

**Files created:**
- `WELCOME.md` — welcome message content
- `src/version.ts` — utility to read KaiBot's version from package.json

**Files modified:**
- `src/ui/store.ts` — added `welcomeText` and `kaibotVersion` to UIState
- `src/kai_bot.ts` — loads WELCOME.md and version on startup
- `src/ui/App.tsx` — added WelcomePanel component, shown when watching with no active feature
- `web/static/html/client.js` — added welcome screen rendering in conversation panel
- `web/static/css/main.css` — added welcome screen CSS styles
- `src/web/wsHandler.ts` — added welcomeText/kaibotVersion to WebUIState
- `src/web/templates.ts` — replaced hardcoded nav version with dynamic getKaiBotVersion()
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $2.2290
- **Turns:** 65
- **Time:** 409.7s
