import { basename } from "path";

import type { WebServer } from "./WebServer.js";
import { getTodaySpend } from "./spendTracker.js";
import { getKaiBotVersion } from "../version.js";

// ---------------------------------------------------------------------------
// Project selection page (shown when no project directory is configured)
// ---------------------------------------------------------------------------

/**
 * Render the project selection page — shown when the server is in "waiting" state.
 * Displays a centered dialog over the KaiBot background image where users can
 * type a folder path or click a recent project.
 */
export function renderProjectSelectionPage(_server: WebServer): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Protovate KaiBot — Select Project</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%; width: 100%;
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
      color: #FFFFFF;
      background-color: #0B0F1A;
      background-image: url('/static/images/KaiBackground.jpg');
      background-size: cover;
      background-position: center;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(11, 15, 26, 0.92);
      border: 1px solid #1E293B;
      border-radius: 12px;
      padding: 40px 36px 32px;
      width: 520px;
      max-width: 92vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .logo {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      color: #60A5FA;
      margin-bottom: 8px;
    }
    .logo img {
      width: 48px;
      height: 48px;
      vertical-align: middle;
      margin-right: 10px;
    }
    .subtitle {
      text-align: center;
      color: #9CA3AF;
      font-size: 13px;
      margin-bottom: 28px;
    }
    label {
      display: block;
      font-size: 12px;
      color: #9CA3AF;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .input-row {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }
    input[type="text"] {
      flex: 1;
      background: #121826;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 14px;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }
    input[type="text"]:focus { border-color: #3B82F6; }
    input[type="text"]::placeholder { color: #4B5563; }
    .open-btn {
      background: #3B82F6;
      color: #FFFFFF;
      border: none;
      border-radius: 6px;
      padding: 10px 20px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .open-btn:hover { background: #2563EB; }
    .open-btn:disabled { opacity: 0.5; cursor: default; }
    .error-msg {
      color: #EF4444;
      font-size: 13px;
      margin-top: -16px;
      margin-bottom: 16px;
      display: none;
    }
    .recent-header {
      font-size: 12px;
      color: #9CA3AF;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
    }
    .recent-list {
      list-style: none;
    }
    .recent-list li {
      padding: 10px 14px;
      border-radius: 6px;
      cursor: pointer;
      color: #D1D5DB;
      font-size: 13px;
      transition: background 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .recent-list li:hover { background: #1E293B; color: #FFFFFF; }
    .recent-list li.missing { color: #6B7280; text-decoration: line-through; cursor: default; }
    .recent-list li.missing:hover { background: transparent; color: #6B7280; }
    .no-recent {
      color: #4B5563;
      font-size: 13px;
      text-align: center;
      padding: 20px 0;
    }
    .spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid #334155;
      border-top-color: #3B82F6;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .apikey-help-row { text-align: center; margin-bottom: 12px; }
    .help-btn {
      background: transparent;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #60A5FA;
      padding: 6px 16px;
      font-family: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .help-btn:hover { border-color: #3B82F6; background: rgba(59,130,246,0.08); }
    input[type="password"] {
      flex: 1;
      background: #121826;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 10px 14px;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 14px;
      outline: none;
    }
    input[type="password"]:focus { border-color: #3B82F6; }
    input[type="password"]::placeholder { color: #4B5563; }
    .apikey-hint {
      font-size: 11px;
      color: #6B7280;
      margin-top: 6px;
      margin-bottom: 8px;
    }
    #apikey-error { margin-top: 0; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="/static/images/KaiBotLogo64.png" alt="KaiBot Logo" /> Protovate KaiBot</div>
    <div class="subtitle">Select a project folder to get started</div>

    <label for="path-input">Project Folder</label>
    <div class="input-row">
      <input type="text" id="path-input" placeholder="/path/to/your/project" autocomplete="off" autofocus />
      <button class="open-btn" id="open-btn">Open</button>
    </div>
    <div class="error-msg" id="error-msg"></div>

    <!-- API key helper — shown when project needs ANTHROPIC_API_KEY -->
    <div id="apikey-section" style="display:none">
      <div class="apikey-help-row">
        <button class="help-btn" id="help-apikey-btn">Help me add it</button>
      </div>
      <div id="apikey-input-area" style="display:none">
        <label for="apikey-input">Anthropic API Key</label>
        <div class="input-row">
          <input type="password" id="apikey-input" placeholder="sk-ant-…" autocomplete="off" />
          <button class="open-btn" id="save-apikey-btn">Save &amp; Open</button>
        </div>
        <div class="apikey-hint">Your key will be validated and saved to the project's .env file</div>
        <div class="error-msg" id="apikey-error"></div>
      </div>
    </div>

    <div class="recent-header">Recent Projects</div>
    <ul class="recent-list" id="recent-list">
      <li class="no-recent">Loading…</li>
    </ul>
  </div>

  <script>
  (function() {
    const pathInput = document.getElementById('path-input');
    const openBtn = document.getElementById('open-btn');
    const errorMsg = document.getElementById('error-msg');
    const recentList = document.getElementById('recent-list');
    const apikeySection = document.getElementById('apikey-section');
    const helpApikeyBtn = document.getElementById('help-apikey-btn');
    const apikeyInputArea = document.getElementById('apikey-input-area');
    const apikeyInput = document.getElementById('apikey-input');
    const saveApikeyBtn = document.getElementById('save-apikey-btn');
    const apikeyError = document.getElementById('apikey-error');
    let pendingProjectDir = null;

    // Load recent paths
    fetch('/api/path-history')
      .then(r => r.json())
      .then(data => {
        const paths = data.paths || [];
        if (paths.length === 0) {
          recentList.innerHTML = '<li class="no-recent">No recent projects</li>';
          return;
        }
        recentList.innerHTML = '';
        paths.forEach(entry => {
          const li = document.createElement('li');
          li.textContent = entry.path;
          if (!entry.exists) {
            li.classList.add('missing');
            li.title = 'Directory no longer exists';
          } else {
            li.addEventListener('click', () => selectProject(entry.path));
          }
          recentList.appendChild(li);
        });
      })
      .catch(() => {
        recentList.innerHTML = '<li class="no-recent">Could not load history</li>';
      });

    function showError(msg) {
      errorMsg.textContent = msg;
      errorMsg.style.display = 'block';
    }
    function hideError() {
      errorMsg.style.display = 'none';
      apikeySection.style.display = 'none';
      apikeyInputArea.style.display = 'none';
      apikeyError.style.display = 'none';
    }

    function selectProject(path) {
      hideError();
      openBtn.disabled = true;
      openBtn.innerHTML = '<span class="spinner"></span>Opening…';

      fetch('/api/select-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            window.location.href = '/main';
          } else {
            showError(data.error || 'Unknown error');
            openBtn.disabled = false;
            openBtn.textContent = 'Open';
            if (data.needsApiKey) {
              pendingProjectDir = data.projectDir;
              apikeySection.style.display = 'block';
              apikeyInputArea.style.display = 'none';
            }
          }
        })
        .catch(() => {
          showError('Network error — is the server running?');
          openBtn.disabled = false;
          openBtn.textContent = 'Open';
        });
    }

    // "Help me add it" button — reveal the key input
    helpApikeyBtn.addEventListener('click', () => {
      apikeyInputArea.style.display = 'block';
      helpApikeyBtn.style.display = 'none';
      apikeyInput.focus();
    });

    // Save & validate the API key
    function saveApiKey() {
      const key = apikeyInput.value.trim();
      if (!key) {
        apikeyError.textContent = 'Please paste your API key';
        apikeyError.style.display = 'block';
        return;
      }
      apikeyError.style.display = 'none';
      saveApikeyBtn.disabled = true;
      saveApikeyBtn.innerHTML = '<span class="spinner"></span>Validating…';

      fetch('/api/save-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key, projectDir: pendingProjectDir })
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok) {
            // Key saved — retry opening the project
            hideError();
            selectProject(pendingProjectDir);
          } else {
            apikeyError.textContent = data.error || 'Validation failed';
            apikeyError.style.display = 'block';
            saveApikeyBtn.disabled = false;
            saveApikeyBtn.innerHTML = 'Save &amp; Open';
          }
        })
        .catch(() => {
          apikeyError.textContent = 'Network error';
          apikeyError.style.display = 'block';
          saveApikeyBtn.disabled = false;
          saveApikeyBtn.innerHTML = 'Save &amp; Open';
        });
    }

    saveApikeyBtn.addEventListener('click', saveApiKey);
    apikeyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveApiKey();
    });

    openBtn.addEventListener('click', () => {
      const path = pathInput.value.trim();
      if (!path) { showError('Please enter a folder path'); return; }
      selectProject(path);
    });

    pathInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const path = pathInput.value.trim();
        if (!path) { showError('Please enter a folder path'); return; }
        selectProject(path);
      }
    });
  })();
  </script>
</body>
</html>`;
}

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
  const projectName = basename(server.projectDir ?? "");
  const projectPath = server.projectDir ?? "";
  const model = server.model;
  const provider = "Anthropic";
  const todaySpend = getTodaySpend(server.projectDir ?? "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Protovate KaiBot — ${esc(projectName)}</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />

  <!-- App styles (no external CDN dependencies) -->
  <link rel="stylesheet" href="/static/css/main.css" />
  <!-- Ace Editor for settings file editing -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.7/ace.min.js"></script>
  <!-- Syntax highlighting for code blocks in conversation -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
  <!-- Session signing key — injected server-side, used for HMAC request signing -->
  <script>window.__KAIBOT_KEY = "${server.hmacSecret}";</script>
</head>
<body>

  <!-- ── Top Status Bar ─────────────────────────────────────────────── -->
  <header id="top-status" role="banner">
    <div class="status-left">
      <span class="logo" aria-label="Protovate KaiBot"><img src="/static/images/KaiBotLogo64.png" alt="KaiBot Logo" style="width:28px;height:28px;vertical-align:middle;margin-right:8px;" /> Protovate KaiBot</span>
      <span id="bot-status" class="badge badge-idle" role="status" aria-live="polite">IDLE</span>
    </div>
    <div class="status-right">
      <span class="status-item project-selector" id="project-trigger"
            title="Click to return to project selection" role="button" tabindex="0">
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
          <a href="/main" class="nav-item"
             accesskey="d" title="Dashboard [D]" id="nav-dashboard">
            <span class="nav-icon" aria-hidden="true">&#x1F4CA;</span>
            <span class="nav-label">Dashboard</span>
            <kbd aria-hidden="true">D</kbd>
          </a>
        </li>
        <li id="nav-processing-item" style="display:none">
          <a href="#processing" class="nav-item" id="nav-processing">
            <span class="nav-icon" id="nav-processing-icon" aria-hidden="true">&#x2699;&#xFE0F;</span>
            <span class="nav-label" id="nav-processing-label">Processing</span>
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
          <a href="#code-assist" class="nav-item"
             title="Code Assist [^]"
             id="nav-codereview">
            <span class="nav-icon" aria-hidden="true">&#x1F4DD;</span>
            <span class="nav-label">Code Assist</span>
            <kbd aria-hidden="true">^</kbd>
          </a>
        </li>
        <li id="nav-todo-item" style="display:none">
          <a href="#todo" class="nav-item"
             title="TODO List"
             id="nav-todo">
            <span class="nav-icon" aria-hidden="true">&#x2714;&#xFE0F;</span>
            <span class="nav-label">TODO List</span>
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
        <span class="nav-version">v${getKaiBotVersion()}</span>
      </div>
    </nav>

    <!-- ── Welcome view (shown on app load) ─────────────────────────── -->
    <main id="welcome-view" role="main" aria-label="Welcome">
      <div id="welcome-content"></div>
    </main>

    <!-- ── Dashboard (stats) view ───────────────────────────────────── -->
    <main id="dashboard-view" style="display:none" role="main" aria-label="Dashboard">
      <div id="dashboard-content">
        <div class="empty-state">Loading stats…</div>
      </div>
    </main>

    <!-- ── Processing panels (resizable, no external dependencies) ──── -->
    <main id="dock-container" style="display:none" role="main" aria-label="Processing panels">

      <!-- Left column: unified conversation feed (thinking + commands + git) -->
      <div id="panels-left">
        <div class="panel" id="panel-conversation">
          <div class="panel-tab-bar">
            <span class="panel-tab active">&#x1F4AC; Conversation</span>
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
            <span class="panel-tab active">&#x1F4E1; Feature Status</span>
          </div>
          <div class="panel-content" id="status-content"
               role="region" aria-label="Feature status panel"></div>
        </div>
        <div class="resize-handle resize-handle-h" id="drag-status-fileops"
             aria-hidden="true" title="Drag to resize"></div>
        <div class="panel" id="panel-plan-fileops">
          <div class="panel-tab-bar">
            <span class="panel-tab active" data-panel-tab="plan" id="tab-plan">&#x1F4CB; Plan</span>
            <span class="panel-tab" data-panel-tab="fileops" id="tab-fileops">&#x1F4C4; File Operations</span>
          </div>
          <div class="panel-content" id="plan-content"
               role="region" aria-label="Plan panel"></div>
          <div class="panel-content" id="fileops-content" style="display:none"
               role="region" aria-label="File operations panel"></div>
        </div>
      </div>

    </main>

    <!-- ── Features view (hidden by default, toggled by F key / nav) ─── -->
    <main id="features-view" style="display:none" role="main" aria-label="Features list">
      <div id="features-panels">
        <div id="features-top-panels">
          <div class="panel" id="panel-pending">
            <div class="panel-tab-bar">
              <span class="panel-tab active">&#x23F3; Pending Features</span>
            </div>
            <div class="panel-content" id="pending-content"
                 role="region" aria-label="Pending features"
                 data-drop-target="pending"></div>
          </div>
          <div class="resize-handle resize-handle-v" id="drag-pending-hold"
               aria-hidden="true" title="Drag to resize"></div>
          <div class="panel" id="panel-hold">
            <div class="panel-tab-bar">
              <span class="panel-tab active">&#x1F4E5; On Hold (Backlog)</span>
            </div>
            <div class="panel-content" id="hold-content"
                 role="region" aria-label="On hold features"></div>
          </div>
        </div>
        <div class="resize-handle resize-handle-h" id="drag-features"
             aria-hidden="true" title="Drag to resize"></div>
        <div class="panel" id="panel-complete-features">
          <div class="panel-tab-bar">
            <span class="panel-tab active">&#x2705; Complete Features</span>
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
            <button id="settings-save-btn" class="settings-save-btn">Save</button>
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

        <label class="dialog-label">Description</label>
        <div id="nf-description-editor"></div>

        <div id="nf-error" class="dialog-error" style="display:none"></div>
      </div>
      <div class="dialog-footer">
        <button class="dialog-btn dialog-btn-secondary" id="nf-hold">Save to Backlog</button>
        <button class="dialog-btn dialog-btn-primary" id="nf-assist">Submit to Assistant</button>
        <button class="dialog-btn dialog-btn-primary" id="nf-save">Save</button>
      </div>
    </div>
  </div>

  <!-- ── Working / Busy Dialog ────────────────────────────────────── -->
  <div id="working-overlay" class="working-overlay" style="display:none"
       role="dialog" aria-modal="true" aria-label="Processing">
    <div class="working-card">
      <video class="working-video" src="/static/images/busy.mp4" autoplay loop muted playsinline></video>
      <div class="working-spinner"></div>
      <div id="working-phrase" class="working-phrase">Thinking hard…</div>
      <div id="working-thinking" class="working-thinking"></div>
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
