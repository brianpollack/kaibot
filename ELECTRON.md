# Electron Packaging for KaiBot

This document describes how Electron was integrated into KaiBot, the design decisions made, and how to build distributable apps for macOS and Windows.

---

## Overview

KaiBot's web UI is served by a Node.js HTTP + WebSocket server (`WebServer`) that runs inside the Electron main process. A `BrowserWindow` loads `http://127.0.0.1:8500` — the same URL a regular browser would use. No special Electron IPC, preload scripts, or renderer-side Node integration is needed because the UI is a standard localhost web app.

The app opens in **waiting mode**: the user selects a project directory via the web UI, which triggers `project-activated` on the server, which starts the KaiBot feature watcher. This is identical to the CLI's no-argument mode.

---

## Files Added

### `electron/main.ts`

The Electron main process. Responsibilities:

1. **Build the application menu** — macOS-native app menu (with Hide, Services, Quit) plus standard File / Edit / View / Window menus. View menu includes Reload and zoom controls for debugging.

2. **Start the KaiBot web server** — imports `WebServer` from `../dist/web/WebServer.js` (the compiled TypeScript output) and starts it on `127.0.0.1:8500`. If the port is already in use, a native error dialog is shown and the app exits.

3. **Wire project activation** — listens to `project-activated` on the server and starts a `KaiBot` instance with the selected directory, model, and provider. Model/provider change events are persisted to the project's settings file, matching the CLI's behavior exactly.

4. **Create the BrowserWindow** — `1400×900` default, `900×600` minimum, dark `#0B0F1A` background (matches the app), no Node integration in the renderer (security default). Loads `http://127.0.0.1:8500`.

5. **Handle external links** — `setWindowOpenHandler` and `will-navigate` intercept any link that leaves `127.0.0.1:8500` and open it in the system browser instead of the Electron window.

6. **Graceful shutdown** — `before-quit` stops the web server. On macOS, closing the window does not quit the app (standard macOS behavior); clicking the dock icon re-opens the window.

### `tsconfig.electron.json`

A separate TypeScript configuration for the Electron entry point:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "electron",
    "outDir": "dist-electron",
    "noEmit": false
  },
  "include": ["electron"],
  "exclude": ["node_modules", "dist", "dist-electron"]
}
```

It extends the project's root `tsconfig.json` (ESM, NodeNext module resolution, ES2022 target) so the electron code shares the same compiler settings. The output goes to `dist-electron/` separately from the main `dist/` output.

The main `tsconfig.json` (which compiles `src/`) is not changed. Both compile steps are independent.

### `electron-builder.yml`

Packaging configuration for `electron-builder`. Key settings:

| Setting | Value | Reason |
|---------|-------|--------|
| `asar` | `false` | The existing code uses `import.meta.url` to resolve paths to `web/` and `prompts/`. With asar enabled, these paths would point inside the archive and ESM dynamic imports may not resolve correctly. Disabling asar keeps the filesystem transparent. |
| `files` | `dist/`, `dist-electron/`, `web/`, `prompts/`, `node_modules/`, `package.json` | Everything the running app needs. `web/` and `prompts/` must be at the same level as `dist/` because the server resolves them with `../../web` and `../prompts` relative to the compiled `.js` files. |
| macOS target | `dmg` (x64 + arm64) | Separate DMG files for Intel and Apple Silicon Macs. |
| Windows target | `nsis` (x64 + arm64) | NSIS installer with optional install directory, desktop shortcut, and Start Menu shortcut. |
| `output` | `release/` | All build artifacts land here. |

---

## How Path Resolution Works

KaiBot's existing code resolves `web/` and `prompts/` using `import.meta.url`:

```
src/web/routes.ts    →  dist/web/routes.js
  WEB_ROOT   = resolve(__dirname, "../../web")   →  <app_root>/web/
  KAIBOT_ROOT = resolve(__dirname, "../..")       →  <app_root>/

src/codeAssist.ts    →  dist/codeAssist.js
  PROMPTS_DIR = resolve(__dirname, "../prompts")  →  <app_root>/prompts/
```

The packaged app structure (`resources/app/`) mirrors the development structure:

```
resources/app/
  dist/               ← compiled KaiBot source (tsc)
  dist-electron/      ← compiled Electron main (tsc -p tsconfig.electron.json)
  web/                ← static HTML/CSS/JS/images
  prompts/            ← code assist prompt files
  node_modules/       ← npm dependencies
  package.json
```

Because `dist/web/routes.js` is at the same depth relative to `web/` in both dev and production, all paths resolve correctly without any code changes to the server.

The Electron main process at `dist-electron/main.js` imports from `../dist/web/WebServer.js`. This relative path is valid in dev (project root) and in the packaged app (`resources/app/`).

---

## Why No Preload Script

A preload script is used when the renderer process (browser window) needs to call Node.js APIs. KaiBot's renderer is a standard web page that communicates with the backend via HTTP and WebSocket — the same mechanism it uses in the browser. There is no need to expose any Electron or Node APIs to the renderer, so `contextIsolation: true` and no preload is the correct, secure configuration.

---

## Why Electron 33 (ESM Support)

KaiBot is an ESM project (`"type": "module"` in `package.json`). Electron 28+ added stable support for ESM main processes. Electron 33 is used because:

- ESM main processes work without workarounds
- The `"type": "module"` package.json causes all `.js` files to be treated as ESM, which Electron 33 handles correctly
- Native module rebuilding is not required (all dependencies are pure JS)

---

## Dependencies Added

Added to `devDependencies` in `package.json`:

```json
"electron": "^33.0.0",
"electron-builder": "^25.0.0"
```

Both are dev dependencies because `electron-builder` bundles the Electron binary directly into the packaged app — the npm `electron` package is only needed for local development and the build process.

---

## Scripts Added

| Script | What it does |
|--------|-------------|
| `npm run build:electron` | Compile `electron/main.ts` → `dist-electron/main.js` |
| `npm run build:all` | Run `build` (src → dist) then `build:electron` |
| `npm run electron` | Build everything and open the Electron window (development) |
| `npm run electron:pack` | Build and package for all configured platforms |
| `npm run electron:pack:mac` | Build and package macOS DMG only |
| `npm run electron:pack:win` | Build and package Windows NSIS installer only |

`npm run build:all` must be run before packaging because electron-builder packages the compiled output, not the TypeScript source.

---

## Changes to Existing Files

### `package.json`
- Added `"main": "dist-electron/main.js"` — tells Electron which file to run as the main process
- Added `"description"` and `"author"` fields (required by electron-builder)
- Added `electron` and `electron-builder` to devDependencies
- Added the five new npm scripts above

### `.gitignore`
Added two new entries:
```
dist-electron/
release/
```

`dist-electron/` is compiled output (same reason `dist/` is gitignored). `release/` contains the packaged app binaries — these are large binary artifacts that should not be committed.

---

## Building Distributable Apps

### Prerequisites

```bash
npm install        # installs electron and electron-builder
```

### Development (open the app locally)

```bash
npm run electron
```

This compiles both `src/` and `electron/`, then launches the Electron window. The web UI is available at `http://127.0.0.1:8500` and in the app window simultaneously.

### macOS DMG

Run on a Mac:

```bash
npm run electron:pack:mac
```

Output: `release/KaiBot-<version>-arm64.dmg` and `release/KaiBot-<version>-x64.dmg`

Drag KaiBot to Applications to install. No code signing is configured — Gatekeeper will block unsigned apps on macOS 10.15+. To bypass during testing, right-click → Open the first time.

### Windows NSIS Installer

Run on a Windows machine (or use a CI cross-compilation environment):

```bash
npm run electron:pack:win
```

Output: `release/KaiBot Setup <version>.exe`

The installer allows choosing the install directory, and creates Desktop and Start Menu shortcuts.

### Both Platforms

```bash
npm run electron:pack
```

Note: macOS DMGs can only be built on macOS. Windows installers can be built on Windows or Linux (with Wine). For cross-platform CI builds, run each platform's script on the appropriate OS.

---

## Adding App Icons

No icons are included. Without them, the default Electron icon is used. To add custom icons:

**macOS** — create `electron/icons/icon.icns` (1024×1024 px recommended). Generate with:
```bash
# From a 1024x1024 PNG:
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
cp icon.png           icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o electron/icons/icon.icns
```

**Windows** — create `electron/icons/icon.ico` (256×256 px). Many tools (e.g. ImageMagick, online converters) can generate `.ico` from a PNG.

Then uncomment the icon lines in `electron-builder.yml`:
```yaml
mac:
  icon: electron/icons/icon.icns

win:
  icon: electron/icons/icon.ico
```

---

## Code Signing

### macOS

Without a valid Apple Developer ID certificate, Gatekeeper will prevent users from opening the app. For internal / team use, recipients can bypass this once with right-click → Open. For public distribution, enroll in the Apple Developer Program and configure:

```yaml
# electron-builder.yml
mac:
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: electron/entitlements.mac.plist
  entitlementsInherit: electron/entitlements.mac.plist
afterSign: electron/notarize.js
```

Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` environment variables for notarization.

### Windows

Windows SmartScreen will warn about unsigned executables. For distribution, purchase a code signing certificate from a trusted CA (e.g. DigiCert, Sectigo) and configure:

```yaml
# electron-builder.yml
win:
  certificateFile: path/to/cert.pfx
  certificatePassword: ${env.WIN_CERT_PASSWORD}
```

---

## Troubleshooting

**Port 8500 already in use** — A native error dialog appears. Kill the other process (`lsof -ti:8500 | xargs kill` on Mac/Linux) and relaunch.

**App opens but shows blank/error page** — The web server may not have finished starting before the window loaded. This is handled by `await webServer.start()` before `loadURL()`. If it persists, check the Electron DevTools console (View → Toggle Developer Tools).

**`npm run electron:pack:win` fails on macOS** — Windows builds require Wine when cross-compiling from macOS. Install via Homebrew (`brew install --cask wine-stable`) or run the Windows build on a Windows machine or CI runner.

**TypeScript errors in `electron/main.ts`** — Run `npm run build` first. The electron tsconfig imports types from `../dist/*.d.ts` declaration files generated by the main build. If `dist/` is empty or stale, type resolution fails.

**Changes to `src/` not reflected in the Electron app** — Run `npm run build:all` to recompile both `src/` and `electron/` before relaunching.
