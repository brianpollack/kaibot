Feature ID: vfNy6--z

The WebUI is supposed to have resizing panels in the middle of the dashboard that
receive text updates from the server through the websocket.
This was described in the feature features/complete/web_ui.md

Missing
1. Claude SDK Thinking Output is missing
2. Claude SDK Commands List is missing
3. File Operations is missing
4. Current Feature Being Processed is missing
5. Current Run time for the feature is missing
6. Current Stage (Review, THinking, Executing plan) is missing
7. Current Plan is missing

These sections should be a in console-like scrollable sections with resizable areas
of the dashbaord.

## Plan

- [x] 1. Add `featureStartTime` to UIState/store and expose it in WebUIState so the client can compute a live runtime — added to store.ts, wsHandler.ts, KaiAgent.ts
- [x] 2. Increase store history limits (thinking lines, commands, file ops) so the web UI can show full scrollable history — store.ts limits raised to 200/100/100; terminal UI App.tsx now slices display locally
- [x] 3. Add a "Feature Status" panel to the rc-dock layout showing current feature name, stage badge, and live runtime timer — client.js: added renderFeatureStatusContent, formatElapsed, runtime timer, updated layout and loadTab
- [x] 4. Update client.js panel renderers to auto-scroll to bottom on new content (console-like behavior) — PanelWrapper._update() now checks scroll position and auto-scrolls to bottom
- [x] 5. Add CSS styles for the new Feature Status panel and console-like scrollable appearance — main.css: added .status-section, .status-label, .status-value, .runtime-value styles
- [x] 6. Verify typecheck passes and the build succeeds — typecheck, build, and lint all pass

## Summary

Implemented the missing streaming status panels for the KaiBot Web UI dashboard. Added a new "Feature Status" panel to the rc-dock layout that shows the current feature name, processing stage (with colored badge), live runtime timer (updates every second), active model, and bot status. Increased store history limits from 6/5/4 to 200/100/100 for thinking lines, commands, and file ops respectively, so the web UI can display full scrollable history in console-like panels while the terminal Ink UI continues to show only the last few items. Added auto-scroll behavior to all panels so they stay pinned to the bottom as new content streams in (unless the user has scrolled up). The `featureStartTime` timestamp is now tracked in UIState and broadcast via WebSocket to enable the client-side runtime timer.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.6547
- **Turns:** 38
- **Time:** 321.6s
