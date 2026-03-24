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

  <!-- App styles (no external CDN dependencies) -->
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
      <span class="status-item model-selector-trigger" id="model-trigger"
            title="Click or press M to change model" role="button" tabindex="0"
            aria-haspopup="listbox" aria-expanded="false">
        <kbd id="model-hotkey" aria-label="Press M to change model">M</kbd>
        <span id="current-model">${esc(model)}</span>
      </span>
      <span class="status-item model-selector-trigger" id="provider-trigger"
            title="Click or press P to change provider" role="button" tabindex="0"
            aria-haspopup="listbox" aria-expanded="false">
        <kbd id="provider-hotkey" aria-label="Press P to change provider">P</kbd>
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
             accesskey="d" title="Dashboard [D]" id="nav-dashboard">
            <span class="nav-icon" aria-hidden="true">&#x1F4CA;</span>
            <span class="nav-label">Dashboard</span>
            <kbd aria-hidden="true">D</kbd>
          </a>
        </li>
        <li>
          <a href="#features-view" class="nav-item"
             accesskey="f" title="Features [F]"
             id="nav-features">
            <span class="nav-icon" aria-hidden="true">&#x1F4CB;</span>
            <span class="nav-label">Features</span>
            <kbd aria-hidden="true">F</kbd>
          </a>
        </li>
        <li>
          <a href="#new-feature" class="nav-item"
             accesskey="n" title="New Feature [N]"
             id="nav-feature">
            <span class="nav-icon" aria-hidden="true">&#x2728;</span>
            <span class="nav-label">New Feature</span>
            <kbd aria-hidden="true">N</kbd>
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
      </ul>

      <div class="nav-footer">
        <span class="nav-version">v0.1.0</span>
      </div>
    </nav>

    <!-- ── Dashboard panels (resizable, no external dependencies) ──── -->
    <main id="dock-container" role="main" aria-label="Dashboard panels">

      <!-- Left column: unified conversation feed (thinking + commands + git) -->
      <div id="panels-left">
        <div class="panel" id="panel-conversation">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x1F4AC; Conversation</span>
          </div>
          <div class="panel-content" id="conversation-content"
               role="region" aria-label="Agent conversation feed"></div>
        </div>
      </div>

      <!-- Main vertical resize handle -->
      <div class="resize-handle resize-handle-v" id="drag-main"
           aria-hidden="true" title="Drag to resize"></div>

      <!-- Right column: Feature Status + File Operations + Plan stacked -->
      <div id="panels-right">
        <div class="panel" id="panel-status">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x1F4E1; Feature Status</span>
          </div>
          <div class="panel-content" id="status-content"
               role="region" aria-label="Feature status panel"></div>
        </div>
        <div class="resize-handle resize-handle-h" id="drag-status-fileops"
             aria-hidden="true" title="Drag to resize"></div>
        <div class="panel" id="panel-fileops">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x1F4C4; File Operations</span>
          </div>
          <div class="panel-content" id="fileops-content"
               role="region" aria-label="File operations panel"></div>
        </div>
        <div class="resize-handle resize-handle-h" id="drag-fileops-plan"
             aria-hidden="true" title="Drag to resize"></div>
        <div class="panel" id="panel-plan">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x1F4CB; Plan</span>
          </div>
          <div class="panel-content" id="plan-content"
               role="region" aria-label="Plan panel"></div>
        </div>
      </div>

    </main>

    <!-- ── Features view (hidden by default, toggled by F key / nav) ─── -->
    <main id="features-view" style="display:none" role="main" aria-label="Features list">
      <div id="features-panels">
        <div class="panel" id="panel-pending">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x23F3; Pending Features</span>
          </div>
          <div class="panel-content" id="pending-content"
               role="region" aria-label="Pending features"></div>
        </div>
        <div class="resize-handle resize-handle-h" id="drag-features"
             aria-hidden="true" title="Drag to resize"></div>
        <div class="panel" id="panel-complete-features">
          <div class="panel-tab-bar">
            <span class="panel-tab">&#x2705; Complete Features</span>
          </div>
          <div class="panel-content" id="complete-features-content"
               role="region" aria-label="Complete features"></div>
        </div>
      </div>
    </main>

  </div>

  <!-- ── Bottom status bar ──────────────────────────────────────────── -->
  <footer id="bottom-status" role="contentinfo">
    <span id="status-message" aria-live="polite">Connecting…</span>
  </footer>

  <!-- ── New Feature Dialog ──────────────────────────────────────────── -->
  <div id="new-feature-overlay" class="dialog-overlay" style="display:none"
       role="dialog" aria-modal="true" aria-labelledby="nf-dialog-title">
    <div class="dialog-box">
      <div class="dialog-header">
        <h2 id="nf-dialog-title">&#x2728; New Feature</h2>
        <button class="dialog-close" id="nf-close" aria-label="Close">&times;</button>
      </div>
      <div class="dialog-body">
        <label class="dialog-label" for="nf-title">Title</label>
        <input type="text" id="nf-title" class="dialog-input"
               placeholder="Feature title…" autocomplete="off" />

        <label class="dialog-label" for="nf-description">Description</label>
        <div class="md-toolbar">
          <button type="button" class="md-btn" data-md="bold" title="Bold (Ctrl+B)"><b>B</b></button>
          <button type="button" class="md-btn" data-md="italic" title="Italic (Ctrl+I)"><i>I</i></button>
          <button type="button" class="md-btn" data-md="heading" title="Heading">#</button>
          <button type="button" class="md-btn" data-md="ul" title="Bullet list">•</button>
          <button type="button" class="md-btn" data-md="ol" title="Numbered list">1.</button>
          <button type="button" class="md-btn" data-md="code" title="Code">&lt;/&gt;</button>
          <button type="button" class="md-btn" data-md="link" title="Link">&#x1F517;</button>
        </div>
        <textarea id="nf-description" class="dialog-textarea"
                  placeholder="Describe the feature in Markdown…" rows="12"></textarea>

        <div id="nf-error" class="dialog-error" style="display:none"></div>
      </div>
      <div class="dialog-footer">
        <button class="dialog-btn dialog-btn-secondary" id="nf-hold">Hold</button>
        <button class="dialog-btn dialog-btn-primary" id="nf-save">Save</button>
      </div>
    </div>
  </div>

  <!-- Client-side JavaScript (no external CDN dependencies) -->
  <script src="/static/html/client.js"></script>

</body>
</html>`;
}
