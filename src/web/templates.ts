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
  <!-- Ace Editor for settings file editing -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/ace.min.js"></script>
  <!-- Session signing key — injected server-side, used for HMAC request signing -->
  <script>window.__KAIBOT_KEY = "${server.hmacSecret}";</script>
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
        <li class="nav-divider" role="separator"></li>
        <li>
          <a href="#settings" class="nav-item"
             title="Settings [*]"
             id="nav-settings">
            <span class="nav-icon" aria-hidden="true">&#x2699;&#xFE0F;</span>
            <span class="nav-label">Settings</span>
            <kbd aria-hidden="true">*</kbd>
          </a>
        </li>
        <li>
          <a href="#code-review" class="nav-item"
             title="Code Review [^]"
             id="nav-codereview">
            <span class="nav-icon" aria-hidden="true">&#x1F4DD;</span>
            <span class="nav-label">Code Review</span>
            <kbd aria-hidden="true">^</kbd>
          </a>
        </li>
      </ul>

      <!-- npm commands section (populated by client.js) -->
      <div class="npm-section" id="npm-section">
        <div class="npm-section-header">
          <span class="npm-section-title">npm commands</span>
          <kbd class="npm-section-key">!</kbd>
        </div>
        <ul id="npm-commands-list">
          <!-- populated dynamically -->
        </ul>
      </div>

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
          <!-- Follow-up input: shown after feature completes, while agent awaits prompts -->
          <div id="followup-input-area" style="display:none" aria-label="Follow-up prompt">
            <div id="followup-input-inner">
              <textarea id="followup-textarea" rows="3"
                placeholder="Send a follow-up message to the agent… (Ctrl+Enter to send)"></textarea>
              <div id="followup-buttons">
                <button id="followup-send-btn" title="Send (Ctrl+Enter)">Send</button>
                <button id="followup-close-btn" title="Close agent and return to watching">Close Agent</button>
              </div>
            </div>
          </div>
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

    <!-- ── Command terminal view (hidden by default, shown when npm script selected) -->
    <main id="command-view" style="display:none" role="main" aria-label="Command terminal">
      <div id="command-toolbar">
        <span id="command-title" class="cmd-title">—</span>
        <span id="command-status-badge" class="npm-run-badge npm-run-idle">idle</span>
        <div class="cmd-toolbar-spacer"></div>
        <button id="cmd-stop-btn" class="cmd-action-btn">&#x23F9; Stop</button>
        <button id="cmd-restart-btn" class="cmd-action-btn">&#x21BA; Restart</button>
      </div>
      <div id="command-terminal">
        <pre id="command-output"></pre>
      </div>
    </main>

    <!-- ── Settings view (hidden by default, shown when Settings selected) -->
    <main id="settings-view" style="display:none" role="main" aria-label="Settings">
      <div id="settings-container">
        <div id="settings-tab-bar">
          <button class="settings-tab active" data-file="CLAUDE.md">CLAUDE.md</button>
          <button class="settings-tab" data-file="README.md">README.md</button>
          <button class="settings-tab" data-file=".kaibot/PROMPT.md">.kaibot/PROMPT.md</button>
          <button class="settings-tab" data-file="system_prompt.md">system_prompt.md</button>
        </div>
        <div id="settings-editor-area">
          <div id="settings-editor-toolbar">
            <span id="settings-file-label"></span>
            <button id="settings-save-btn" class="settings-save-btn">&#x1F4BE; Save</button>
          </div>
          <div id="settings-editor"></div>
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

  <!-- ── Feature Detail Dialog ──────────────────────────────────────── -->
  <div id="feature-detail-overlay" class="dialog-overlay" style="display:none"
       role="dialog" aria-modal="true" aria-labelledby="fd-dialog-title">
    <div class="dialog-box fd-dialog-box">
      <div class="dialog-header">
        <h2 id="fd-dialog-title">Feature Detail</h2>
        <button class="dialog-close" id="fd-close" aria-label="Close">&times;</button>
      </div>
      <div class="fd-tab-bar">
        <button class="fd-tab active" data-tab="details">Details</button>
        <button class="fd-tab" data-tab="request">Original Request</button>
        <button class="fd-tab" data-tab="plan">Plan</button>
        <button class="fd-tab" data-tab="files">File Changes</button>
        <button class="fd-tab" data-tab="conversation">Conversation</button>
        <button class="fd-tab" data-tab="git">Git</button>
      </div>
      <div class="dialog-body fd-dialog-body" id="fd-body">
        <div class="empty-state">Loading&#x2026;</div>
      </div>
    </div>
  </div>

  <!-- Client-side JavaScript (no external CDN dependencies) -->
  <script src="/static/html/client.js"></script>

</body>
</html>`;
}
