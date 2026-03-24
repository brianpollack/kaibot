Feature ID: F5j4oopZ

# Web UI Feature

## Goal

Update the KaiBot node application to spawn a web server on port 8500 (default) and host 127.0.0.1 (default).
This should be a fast web server for KaiBot management with no large web frameworks.  The AI should generate
the HTML where possible and only use packages as needed.   All page should be server-side generated.

## Login

There will no login page for now.  In the future there may be so leave a placeholder for login but
redirect immediately to /main with the primary contents.

## Navigation Menu

The left side should feature a navigation menu with access to options we need in this website.  The navigations will follow the
existing KaiBot options.  Each navigation option should have a hot key and complete screen reader compatibility.

## Top Status

The top of the web ui should feature a status which shows the KaiBot name, a section for Current Project: <folder> which
shows us the activate folder, model which shows us the current model and provider which shows us the LLM provider.
Currently Anthropic is the supported provider and there are no options.  In the future "P" will be the hot key to change
provider.   M will be the hot key to select a model from the provider and function as the existing M key does in the Ink.js UI.
The WebUI will also have Estimated Spend Today: <Cost> which will be a total of features processed today.

## Main Page

While in "Dashbaord" mode, the default, we will copy the concept from the Ink.JS UI using Websock for fast realtime status update messages, bot thinking, and so on.

## Dockable Windows

Use a dockable window concept.  I suggest the rcdock component https: //github.com/ticlo/rc-dock.
This will allow the user to adjust the size of the window for plan, file operations, command, thinking, etc

## Folders

Design a folder concept for the website such as ./web/static/html ./web/static/images ./web/static/css and ./web/vendor/ for vendor specific modules that are not directly served from npm installed modules.

## Plan

- [x] 1. Create folder structure: web/static/css, web/static/html, web/static/images, web/vendor — created all directories
- [x] 2. Install `ws` package for WebSocket support — installed ws + @types/ws
- [x] 3. Create `src/web/WebServer.ts` — HTTP server using Node built-in `http` module on port 8500, host 127.0.0.1
- [x] 4. Create `src/web/routes.ts` — route handler with login redirect (/ → /main), static file serving, and page generation
- [x] 5. Create `src/web/templates.ts` — server-side HTML generation with top status, left nav, rc-dock container, and CDN imports for React + rc-dock
- [x] 6. Create `web/static/css/main.css` — dark theme styles for layout, nav, status bar, dockable panels with rc-dock overrides
- [x] 7. Create `web/static/html/client.js` — client-side JS with WebSocket reconnect, rc-dock layout (4 panels), real-time DOM updates
- [x] 8. Create `src/web/wsHandler.ts` — bridges uiStore change events to WebSocket clients, sends full state on connect
- [x] 9. Create `src/web/spendTracker.ts` — reads .kaibot/features.json, sums totalCostUsd for today's records
- [x] 10. Integrate WebServer into `kai_bot.ts` — starts on port 8500, syncs model changes, shuts down on SIGINT/SIGTERM/quit
- [x] 11. Run typecheck, lint, and fix any issues — all pass cleanly; existing tests still green

## Summary

Implemented a lightweight Web UI for KaiBot that runs alongside the existing Ink terminal UI. A Node.js `http` server starts on port 8500 (configurable via `KAI_WEB_PORT`/`KAI_WEB_HOST` env vars) and serves a server-side generated dashboard at `/main` (with `/` and `/login` redirecting there as a login placeholder). The UI features a dark-themed layout with a top status bar (project dir, model, provider, estimated daily spend), a left navigation menu with keyboard hotkeys and screen reader compatibility (accesskeys + ARIA), and four dockable panels (Thinking, Commands, File Operations, Plan) powered by rc-dock loaded from CDN. Real-time state updates flow from the `uiStore` singleton through WebSocket to all connected browser clients. New files: `src/web/WebServer.ts`, `src/web/routes.ts`, `src/web/templates.ts`, `src/web/wsHandler.ts`, `src/web/spendTracker.ts`, `web/static/css/main.css`, `web/static/html/client.js`, plus the static asset folders `web/static/images/` and `web/vendor/`.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $2.4560
- **Turns:** 52
- **Time:** 489.5s
