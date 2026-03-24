import { basename } from "path";

import type { WebServer } from "./WebServer.js";
import { getTodaySpend } from "./spendTracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Main dashboard page
// ---------------------------------------------------------------------------

/**
 * Render the full HTML for the main dashboard page.
 * All content is server-side generated; client-side JS handles WebSocket
 * updates and rc-dock panel management.
 */
export function renderMainPage(server: WebServer): string {
  const projectName = basename(server.projectDir);
  const projectPath = server.projectDir;
  const model = server.model;
  const provider = "Anthropic";
  const todaySpend = getTodaySpend(server.projectDir);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KaiBot — ${esc(projectName)}</title>

  <!-- rc-dock: React + ReactDOM + rc-dock from CDN -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <link rel="stylesheet" href="https://unpkg.com/rc-dock@3/dist/rc-dock.css" />
  <script src="https://unpkg.com/rc-dock@3/dist/rc-dock.min.js"></script>

  <!-- App styles -->
  <link rel="stylesheet" href="/static/css/main.css" />
</head>
<body>

  <!-- ── Top Status Bar ─────────────────────────────────────────────── -->
  <header id="top-status" role="banner">
    <div class="status-left">
      <span class="logo" aria-label="KaiBot">&#x1F916; KaiBot</span>
      <span id="bot-status" class="badge badge-idle" role="status" aria-live="polite">IDLE</span>
    </div>
    <div class="status-right">
      <span class="status-item" title="Current project directory">
        <kbd>Project</kbd>
        <span id="project-dir">${esc(projectPath)}</span>
      </span>
      <span class="status-item" title="Active Claude model">
        <kbd id="model-hotkey" aria-label="Press M to change model">M</kbd>
        <span id="current-model">${esc(model)}</span>
      </span>
      <span class="status-item" title="LLM provider">
        <kbd id="provider-hotkey" aria-label="Press P to change provider (future)">P</kbd>
        <span id="current-provider">${esc(provider)}</span>
      </span>
      <span class="status-item" title="Estimated spend today">
        <span class="spend-label">Spend Today</span>
        <span id="today-spend">$${todaySpend.toFixed(2)}</span>
      </span>
    </div>
  </header>

  <!-- ── Main layout: nav + content ─────────────────────────────────── -->
  <div id="app-layout">

    <!-- Left navigation -->
    <nav id="side-nav" role="navigation" aria-label="Main navigation">
      <ul>
        <li>
          <a href="/main" class="nav-item active" aria-current="page"
             accesskey="d" title="Dashboard [D]">
            <span class="nav-icon" aria-hidden="true">&#x1F4CA;</span>
            <span class="nav-label">Dashboard</span>
            <kbd aria-hidden="true">D</kbd>
          </a>
        </li>
        <li>
          <a href="#features" class="nav-item"
             accesskey="f" title="New Feature [F]"
             id="nav-feature">
            <span class="nav-icon" aria-hidden="true">&#x2728;</span>
            <span class="nav-label">New Feature</span>
            <kbd aria-hidden="true">F</kbd>
          </a>
        </li>
        <li>
          <a href="#tech-debt" class="nav-item"
             accesskey="s" title="Tech Debt Scan [S]"
             id="nav-scan">
            <span class="nav-icon" aria-hidden="true">&#x1F50D;</span>
            <span class="nav-label">Tech Debt</span>
            <kbd aria-hidden="true">S</kbd>
          </a>
        </li>
        <li>
          <a href="#models" class="nav-item"
             accesskey="m" title="Select Model [M]"
             id="nav-models">
            <span class="nav-icon" aria-hidden="true">&#x1F9E0;</span>
            <span class="nav-label">Model</span>
            <kbd aria-hidden="true">M</kbd>
          </a>
        </li>
      </ul>

      <div class="nav-footer">
        <span class="nav-version">v0.1.0</span>
      </div>
    </nav>

    <!-- Content area — rc-dock container -->
    <main id="dock-container" role="main" aria-label="Dashboard panels">
    </main>

  </div>

  <!-- ── Bottom status bar ──────────────────────────────────────────── -->
  <footer id="bottom-status" role="contentinfo">
    <span id="status-message" aria-live="polite">Connecting…</span>
  </footer>

  <!-- Client-side JavaScript -->
  <script src="/static/html/client.js"></script>

</body>
</html>`;
}
