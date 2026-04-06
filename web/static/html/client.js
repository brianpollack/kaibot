/* =========================================================================
   KaiBot Web UI — client.js
   Client-side JavaScript for WebSocket real-time updates and dashboard panels.
   No external CDN dependencies — plain DOM manipulation only.
   ========================================================================= */

"use strict";

// ---------------------------------------------------------------------------
// HMAC request signing
// ---------------------------------------------------------------------------

var _hmacKey = null;
var _hmacInitPromise = null;

function _initHmac() {
  if (_hmacInitPromise) return _hmacInitPromise;
  _hmacInitPromise = (function () {
    if (!window.__KAIBOT_KEY || typeof crypto === "undefined" || !crypto.subtle) {
      return Promise.resolve();
    }
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(window.__KAIBOT_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    ).then(function (key) {
      _hmacKey = key;
    }).catch(function () {});
  })();
  return _hmacInitPromise;
}

function _hmacSign(data) {
  if (!_hmacKey) return Promise.resolve("");
  return crypto.subtle.sign("HMAC", _hmacKey, new TextEncoder().encode(data))
    .then(function (buf) {
      return Array.from(new Uint8Array(buf))
        .map(function (b) { return b.toString(16).padStart(2, "0"); })
        .join("");
    });
}

function signedFetch(url, options) {
  return _initHmac().then(function () {
    options = Object.assign({}, options || {});
    var ts = Date.now().toString();
    var method = (options.method || "GET").toUpperCase();
    var body = typeof options.body === "string" ? options.body : "";
    var urlObj = new URL(url, window.location.origin);
    var pathAndSearch = urlObj.pathname + urlObj.search;
    var dataToSign = method + "\n" + pathAndSearch + "\n" + ts + "\n" + body;
    return _hmacSign(dataToSign).then(function (sig) {
      options.headers = Object.assign({}, options.headers, {
        "X-KaiBot-Timestamp": ts,
        "X-KaiBot-Signature": "sha256=" + sig,
      });
      return fetch(url, options);
    });
  });
}

function signedWsSend(msgObj) {
  if (!ws || ws.readyState !== 1) return Promise.resolve();
  return _initHmac().then(function () {
    var ts = Date.now().toString();
    var dataToSign = ts + "\n" + JSON.stringify(msgObj);
    return _hmacSign(dataToSign).then(function (sig) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(Object.assign({}, msgObj, { ts: ts, sig: sig })));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Global state (mirrors server-side UIState / WebUIState)
// ---------------------------------------------------------------------------

let state = {
  status: "idle",
  projectDir: "",
  model: "",
  provider: "anthropic",
  featureName: null,
  featureStage: null,
  featureStartTime: null,
  featureEndTime: null,
  thinkingLines: [],
  commands: [],
  fileOps: [],
  planLines: [],
  planCostInfo: "",
  conversationItems: [],
  statusMessage: "Connecting…",
  todaySpend: 0,
  followupFeatureId: null,
  welcomeText: "",
  kaibotVersion: "",
};

// ---------------------------------------------------------------------------
// DOM references — header / footer
// ---------------------------------------------------------------------------

const $botStatus    = document.getElementById("bot-status");
const $projectDir   = document.getElementById("project-dir");
const $currentModel = document.getElementById("current-model");
const $todaySpend   = document.getElementById("today-spend");
const $statusMsg    = document.getElementById("status-message");

// Panel content areas
const $conversationContent = document.getElementById("conversation-content");
const $fileopsContent      = document.getElementById("fileops-content");
const $statusContent       = document.getElementById("status-content");
const $planContent         = document.getElementById("plan-content");

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getCssVar(name, fallback) {
  var value = getComputedStyle(document.documentElement).getPropertyValue(name || "").trim();
  return value || fallback || "";
}

function getActiveAceThemeName() {
  return window.__KAIBOT_ACE_THEME_NAME || "ace/theme/tomorrow_night";
}

function applyAceThemeToAllEditors() {
  var theme = getActiveAceThemeName();
  var editors = [nfAceEditor, settingsAceEditor];
  Object.keys(_dynTabEditors || {}).forEach(function (key) {
    if (_dynTabEditors[key]) editors.push(_dynTabEditors[key]);
  });
  editors.forEach(function (editor) {
    if (!editor || !editor.setTheme) return;
    try { editor.setTheme(theme); } catch (e) {}
  });
}

function reloadThemeAssets() {
  return new Promise(function (resolve) {
    var cssLink = document.getElementById("kaibot-theme-css");
    if (cssLink) {
      cssLink.setAttribute("href", "/theme.css?v=" + Date.now());
    }

    var aceScript = document.getElementById("kaibot-ace-theme-script");
    if (!aceScript) {
      applyAceThemeToAllEditors();
      resolve();
      return;
    }

    var nextScript = document.createElement("script");
    nextScript.id = "kaibot-ace-theme-script";
    nextScript.src = "/theme/ace.js?v=" + Date.now();
    nextScript.onload = function () {
      applyAceThemeToAllEditors();
      resolve();
    };
    nextScript.onerror = function () {
      resolve();
    };
    aceScript.parentNode.replaceChild(nextScript, aceScript);
  });
}

// ---------------------------------------------------------------------------
// Thinking content renderer — parses ```lang code fences into highlighted blocks
// ---------------------------------------------------------------------------

function renderThinkingLines(text) {
  var html = "";
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim()) {
      var escaped = escHtml(line);
      // escaped = escaped.replace(/([.!?;:,])([A-Za-z])/g, "$1<br>$2");
      html += '<div class="conv-thinking-line">' + escaped + "</div>";
    } else {
      html += '<div class="conv-thinking-gap"></div>';
    }
  }
  return html;
}

function renderThinkingContent(text) {
  var html = "";
  var fenceRe = /```(\w*)\n([\s\S]*?)```/g;
  var lastIndex = 0;
  var match;
  while ((match = fenceRe.exec(text)) !== null) {
    html += renderThinkingLines(text.slice(lastIndex, match.index));
    var lang = match[1] || "";
    var langClass = lang ? ' class="language-' + escHtml(lang) + '"' : "";
    html += "<pre><code" + langClass + ">" + escHtml(match[2]) + "</code></pre>";
    lastIndex = match.index + match[0].length;
  }
  html += renderThinkingLines(text.slice(lastIndex));
  return html;
}

// ---------------------------------------------------------------------------
// Unified ConversationBlockRenderer — modular, DRY renderers for each block type.
// Both the live conversation feed and the feature-detail history dialog use
// these same methods.  A `mode` string ("live" | "history") controls minor
// visual differences (timestamps in history, active indicators in live).
// ---------------------------------------------------------------------------

var ConversationBlockRenderer = {

  /** Render a single conversation item.  Delegates to a type-specific method. */
  render: function (item, mode) {
    var renderer = this["_" + (item.type || "unknown")];
    if (renderer) return renderer.call(this, item, mode);
    return "";
  },

  /** Wrap content with an optional timestamp header for history mode. */
  _wrapBlock: function (item, mode, innerHtml) {
    if (mode !== "history") return innerHtml;
    var ts = this._fmtTime(item.timestamp);
    if (!ts) return innerHtml;
    return '<div class="conv-block-ts">' + escHtml(ts) + '</div>' + innerHtml;
  },

  _fmtTime: function (ts) {
    if (!ts) return "";
    try {
      var dt = new Date(ts);
      return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) { return ""; }
  },

  // -- Thinking block -------------------------------------------------------
  _thinking: function (item, mode) {
    var html = '<div class="conv-thinking">' +
      '<img class="conv-thinking-icon" src="/static/images/thinking64x64.png" alt="thinking" />' +
      '<div class="conv-thinking-body">' + renderThinkingContent(String(item.content || "")) + '</div>' +
      "</div>";
    return this._wrapBlock(item, mode, html);
  },

  // -- Command block --------------------------------------------------------
  _command: function (item, mode) {
    var isActive = mode === "live" && item.active;
    var cls = "conv-command" + (isActive ? " active" : "");
    var html =
      '<div class="' + cls + '">' +
        '<div class="conv-command-header">' +
          '<span>' + (isActive ? "\u25B6" : "$") + "</span>" +
          (isActive ? '<span class="conv-command-running">running\u2026</span>' : "") +
        "</div>" +
        '<pre class="conv-command-code">' + escHtml(String(item.content || "")) + "</pre>" +
      "</div>";
    return this._wrapBlock(item, mode, html);
  },

  // -- Agent tool-use block -------------------------------------------------
  _agent: function (item, mode) {
    var agentType = item.agentType || "Agent";
    var agentDesc = item.agentDescription || "";
    var html =
      '<div class="conv-agent">' +
        '<div class="conv-agent-header">' +
          '<span class="conv-agent-type">' + escHtml(agentType) + "</span>" +
          (agentDesc
            ? '<span class="conv-agent-sep"> \u2014 </span>' +
              '<span class="conv-agent-desc">' + escHtml(agentDesc) + "</span>"
            : "") +
        "</div>" +
        '<pre class="conv-agent-prompt">' + escHtml(String(item.content || "")) + "</pre>" +
      "</div>";
    return this._wrapBlock(item, mode, html);
  },

  // -- Git commit block -----------------------------------------------------
  _git: function (item, mode) {
    var html =
      '<div class="conv-git">' +
        '<div class="conv-git-header">&#x1F4BE; git commit</div>' +
        '<pre class="conv-git-message">' + escHtml(String(item.content || "")) + "</pre>" +
      "</div>";
    return this._wrapBlock(item, mode, html);
  },

  // -- System message -------------------------------------------------------
  _system: function (item, mode) {
    var html = '<div class="conv-system">' + escHtml(String(item.content || "")) + "</div>";
    return this._wrapBlock(item, mode, html);
  },

  // -- User follow-up message -----------------------------------------------
  _user: function (item, mode) {
    var html =
      '<div class="conv-user-row">' +
        '<div class="conv-user-bubble">' + escHtml(String(item.content || "")) + '</div>' +
      '</div>';
    return this._wrapBlock(item, mode, html);
  },

  // -- Clarification question from agent -----------------------------------
  "clarify-question": function (item, mode) {
    var html =
      '<div class="conv-clarify-question">' +
        '<div class="conv-clarify-header">&#x2753; Agent needs clarification</div>' +
        '<div class="conv-clarify-text">' + escHtml(String(item.content || "")) + '</div>' +
      '</div>';
    return this._wrapBlock(item, mode, html);
  },

  // -- Clarification answer (user or fallback) ------------------------------
  "clarify-answer": function (item, mode) {
    var html =
      '<div class="conv-clarify-answer">' +
        '<div class="conv-clarify-header">&#x1F4AC; Clarification response</div>' +
        '<div class="conv-clarify-text">' + escHtml(String(item.content || "")) + '</div>' +
      '</div>';
    return this._wrapBlock(item, mode, html);
  },

  // -- File operation block -------------------------------------------------
  _file: function (item, mode) {
    var fd = {};
    try { fd = JSON.parse(String(item.content || "{}")); } catch (e) {}
    var fTool = (fd.tool || "file").toLowerCase();
    var fPath = fd.path || "";
    var inner = '<div class="conv-file-header">' +
      '<span class="conv-file-op ' + escHtml(fTool) + '">' + escHtml(fd.tool || "File") + '</span>' +
      '<span class="conv-file-path">' + escHtml(fPath) + '</span>' +
      '</div>';
    var hasBody = fd.old != null || fd.new != null || fd.preview;
    if (hasBody) {
      inner += '<div class="conv-file-body">';

      // Context line for Edit operations
      if (fTool === "edit" && (fd.linesChanged || fd.className || fd.fnName)) {
        var verb = fd.isInsert ? "Inserted" : "Replaced";
        var n = fd.linesChanged || 1;
        var ctx = verb + " " + n + " line" + (n === 1 ? "" : "s");
        var fnWord = (fd.ext === "ex" || fd.ext === "exs") ? "def" : "function";
        if (fd.className) ctx += " in class " + fd.className;
        if (fd.fnName) ctx += ", " + fnWord + " " + fd.fnName;
        if (fd.startLine) ctx += " (line " + fd.startLine + ")";
        inner += '<div class="conv-file-context">' + escHtml(ctx) + '</div>';
      }

      // Side-by-side diff for Edit (old + new), stacked for Write (preview)
      if ((fd.old != null || fd.new != null) && fTool === "edit") {
        inner += '<div class="conv-file-diff">';
        inner += '<div class="conv-file-diff-col">' +
          '<div class="conv-file-section-label">replaced</div>' +
          '<div class="conv-file-snippet old">' + escHtml(fd.old || "") + '</div>' +
          '</div>';
        inner += '<div class="conv-file-diff-col">' +
          '<div class="conv-file-section-label">with</div>' +
          '<div class="conv-file-snippet new">' + escHtml(fd.new || "") + '</div>' +
          '</div>';
        inner += '</div>';
      } else if (fd.preview) {
        inner += '<div class="conv-file-section-label">' + (fd.lines ? fd.lines + ' lines' : 'content') + '</div>' +
          '<div class="conv-file-snippet content">' + escHtml(fd.preview) + '</div>';
      }

      inner += '</div>';
    }
    var html = '<div class="conv-file">' + inner + '</div>';
    return this._wrapBlock(item, mode, html);
  },

  // -- Render a full list of items ------------------------------------------
  renderAll: function (items, mode) {
    var self = this;
    return items.map(function (item) {
      return self.render(item, mode);
    }).join("");
  }
};

// ---------------------------------------------------------------------------
// Conversation feed renderer
// ---------------------------------------------------------------------------

function renderWelcomeContent() {
  if (!state.welcomeText) return "";
  var lines = state.welcomeText.split("\n");
  var html = '<div class="welcome-screen">';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith("# ")) {
      html += '<h1 class="welcome-h1">' + escHtml(line.slice(2)) + "</h1>";
    } else if (line.startsWith("## ")) {
      html += '<h2 class="welcome-h2">' + escHtml(line.slice(3)) + "</h2>";
    } else if (/^\|[\s-|]+\|$/.test(line)) {
      // Skip table separator rows (rendered as part of the table)
      continue;
    } else if (line.startsWith("|")) {
      // Table row — simple rendering
      var cells = line.split("|").filter(function (c) { return c.trim(); });
      html += '<div class="welcome-table-row">';
      for (var j = 0; j < cells.length; j++) {
        html += '<span class="welcome-table-cell">' + escHtml(cells[j].trim()) + "</span>";
      }
      html += "</div>";
    } else if (/^\d+\./.test(line.trim())) {
      html += '<div class="welcome-step">' + escHtml(line.trim()) + "</div>";
    } else if (line.trim() === "") {
      html += "<br>";
    } else {
      html += '<p class="welcome-text">' + escHtml(line) + "</p>";
    }
  }
  html += '<div class="welcome-version">You are running KaiBot v' +
    escHtml(state.kaibotVersion) + " in " + escHtml(state.projectDir) + "</div>";
  html += "</div>";
  return html;
}

function renderConversationContent() {
  var items = state.conversationItems || [];
  if (items.length === 0) {
    return '<div class="empty-state">(waiting for feature processing\u2026)</div>';
  }
  return ConversationBlockRenderer.renderAll(items, "live");
}

// ---------------------------------------------------------------------------
// Feature status renderer
// ---------------------------------------------------------------------------

function formatElapsed(startTime, endTime) {
  if (!startTime) return "—";
  var elapsed = Math.floor(((endTime || Date.now()) - startTime) / 1000);
  var mins = Math.floor(elapsed / 60);
  var secs = elapsed % 60;
  if (mins > 0) {
    return mins + "m " + (secs < 10 ? "0" : "") + secs + "s";
  }
  return secs + "s";
}

function renderFeatureStatusContent() {
  var html = "";

  html += '<div class="status-section">';
  html += '<div class="status-label">Feature</div>';
  if (state.featureName) {
    html += '<div class="status-value feature-value">' + escHtml(state.featureName) + "</div>";
  } else {
    html += '<div class="status-value dim">No feature in progress</div>';
  }
  html += "</div>";

  html += '<div class="status-section">';
  html += '<div class="status-label">Stage</div>';
  if (state.featureStage) {
    html +=
      '<div class="status-value">' +
      '<span class="stage-badge stage-' + state.featureStage + '">' +
      state.featureStage.toUpperCase() +
      "</span></div>";
  } else {
    html += '<div class="status-value dim">—</div>';
  }
  html += "</div>";

  html += '<div class="status-section">';
  html += '<div class="status-label">Runtime</div>';
  html += '<div class="status-value runtime-value">' + formatElapsed(state.featureStartTime, state.featureEndTime) + "</div>";
  html += "</div>";

  html += '<div class="status-section">';
  html += '<div class="status-label">Model</div>';
  html += '<div class="status-value">' + escHtml(state.model || "—") + "</div>";
  html += "</div>";

  html += '<div class="status-section">';
  html += '<div class="status-label">Bot Status</div>';
  html +=
    '<div class="status-value">' +
    '<span class="badge badge-' + state.status + '">' +
    state.status.toUpperCase() +
    "</span></div>";
  html += "</div>";

  return html;
}

// ---------------------------------------------------------------------------
// File operations renderer
// ---------------------------------------------------------------------------

function renderFileOpsContent() {
  var ops = state.fileOps;
  if (ops.length === 0) {
    return '<div class="empty-state">(no file operations yet)</div>';
  }
  return ops
    .map(function (op) {
      return (
        '<div class="file-op">' +
        '<span class="file-op-type ' + op.type + '">' + op.type.toUpperCase() + "</span>" +
        '<span class="file-op-path">' + escHtml(op.path) + "</span>" +
        (op.preview
          ? '<span class="file-op-preview">' + escHtml(op.preview) + "</span>"
          : "") +
        "</div>"
      );
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Plan renderer
// ---------------------------------------------------------------------------

function renderPlanContent() {
  var lines = state.planLines;
  var isComplete = state.featureStage === "complete";
  var html = "";

  if (state.featureName) {
    html += '<div class="feature-name">' + escHtml(state.featureName);
    if (state.featureStage) {
      html +=
        ' <span class="stage-badge stage-' + state.featureStage + '">' +
        state.featureStage.toUpperCase() +
        "</span>";
    }
    html += "</div>";
  }

  if (lines.length === 0) {
    html += '<div class="empty-state">(no plan yet)</div>';
  } else {
    lines.forEach(function (line) {
      var cls = line.checked ? "checked" : "unchecked";
      var icon = line.checked ? "&#x2705;" : "&#x2B1C;";
      html +=
        '<div class="plan-step ' + cls + '">' +
        '<span class="plan-checkbox">' + icon + "</span>" +
        '<span class="plan-text">' + escHtml(line.text) + "</span>" +
        "</div>";
    });
  }

  if (isComplete && state.planCostInfo) {
    html +=
      '<div class="plan-complete">' +
      '<div class="plan-complete-title">&#x1F389; Feature Complete</div>' +
      '<div class="plan-cost">' + escHtml(state.planCostInfo) + "</div>" +
      "</div>";
  }

  return html;
}

// ---------------------------------------------------------------------------
// Panel content updater — preserves near-bottom scroll position
// ---------------------------------------------------------------------------

function updatePanelContent(el, renderFn) {
  if (!el) return;
  var isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = renderFn();
  if (isNearBottom) {
    el.scrollTop = el.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Runtime timer — keeps elapsed time ticking every second
// ---------------------------------------------------------------------------

var runtimeTimer = null;

function startRuntimeTimer() {
  if (runtimeTimer) return;
  runtimeTimer = setInterval(function () {
    if (state.featureStartTime && $statusContent) {
      $statusContent.innerHTML = renderFeatureStatusContent();
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// DOM update — called on every WebSocket state message
// ---------------------------------------------------------------------------

function updateDOM() {
  // Auto-navigate to processing view when a feature starts
  var justStarted = state.featureName !== null && _prevFeatureName === null;
  _prevFeatureName = state.featureName;
  if (justStarted && currentView !== "processing") {
    showProcessingView();
  }

  // Keep processing nav item in sync
  updateProcessingNavItem();

  if ($botStatus) {
    $botStatus.textContent = state.status.toUpperCase();
    $botStatus.className = "badge badge-" + state.status;
  }
  if ($projectDir) $projectDir.textContent = state.projectDir;
  var $projectTrigger = document.getElementById("project-trigger");
  if ($projectTrigger) {
    var isProcessing = state.status === "processing";
    $projectTrigger.classList.toggle("disabled", isProcessing);
    $projectTrigger.setAttribute("aria-disabled", isProcessing ? "true" : "false");
    $projectTrigger.title = isProcessing
      ? "Cannot change project while processing"
      : "Click to return to project selection";
  }
  if ($currentModel) $currentModel.textContent = state.model;
  var $currentProvider = document.getElementById("current-provider");
  if ($currentProvider) $currentProvider.textContent = state.provider === "openrouter" ? "OpenRouter" : "Anthropic";
  if ($todaySpend) $todaySpend.textContent = "$" + (state.todaySpend || 0).toFixed(2);
  if ($statusMsg) $statusMsg.textContent = state.statusMessage || " ";

  updatePanelContent($conversationContent, renderConversationContent);
  updatePanelContent($fileopsContent,      renderFileOpsContent);
  updatePanelContent($statusContent,       renderFeatureStatusContent);
  updatePanelContent($planContent,         renderPlanContent);
  if (typeof hljs !== "undefined") { hljs.highlightAll(); }

  // Show/hide follow-up input based on whether the agent is awaiting prompts
  var followupArea = document.getElementById("followup-input-area");
  if (followupArea) {
    followupArea.style.display = state.followupFeatureId ? "" : "none";
  }
  var followupTextarea = document.getElementById("followup-textarea");
  var followupSendBtn = document.getElementById("followup-send-btn");
  // Disabled when there is no active follow-up session OR the agent is currently processing
  var followupDisabled = !state.followupFeatureId || state.status === "processing";
  if (followupTextarea) followupTextarea.disabled = followupDisabled;
  if (followupSendBtn) followupSendBtn.disabled = followupDisabled;

  // Code assist result bar
  var existingBar = document.getElementById("ca-result-bar");
  if (state.codeAssistResult && !state.codeAssistActive) {
    if (!existingBar) {
      var bar = document.createElement("div");
      bar.id = "ca-result-bar";
      bar.className = "ca-result-bar";
      bar.innerHTML =
        '<button class="ca-result-btn" id="ca-result-open">' + escHtml(state.codeAssistResult.action) + '</button>' +
        '<span class="ca-result-cost">' + escHtml(state.statusMessage || "") + '</span>';
      var convPanel = document.getElementById("panel-conversation");
      if (convPanel) convPanel.appendChild(bar);

      document.getElementById("ca-result-open").addEventListener("click", function () {
        var path = state.codeAssistResult ? state.codeAssistResult.path : "";
        if (path) {
          signedFetch("/api/code-assist/result-file?path=" + encodeURIComponent(path))
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.content != null) openCodeAssistResultViewer(state.codeAssistResult.action, data.content);
            })
            .catch(function () {});
        }
      });

      // Refresh left-menu items that may have changed as a result of the run
      loadTodoNavItem();
      loadNpmScripts();
    }
  } else if (existingBar) {
    existingBar.remove();
  }
}

function openCodeAssistResultViewer(title, content) {
  var overlay = document.createElement("div");
  overlay.className = "ca-overlay ca-preview-overlay";
  overlay.innerHTML =
    '<div class="ca-card ca-preview-card">' +
      '<div class="ca-header">' +
        '<h2>' + escHtml(title) + '</h2>' +
        '<button class="dialog-close ca-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ca-body ca-preview-body">' +
        '<div class="conv-thinking">' + renderThinkingContent(content) + '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector(".ca-close").addEventListener("click", function () { overlay.remove(); });
  overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
  function handleKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", handleKey); }
  }
  document.addEventListener("keydown", handleKey);
}

// ---------------------------------------------------------------------------
// Drag-to-resize handles
// ---------------------------------------------------------------------------

function makeDraggable(handleId, targetId, direction) {
  var handle = document.getElementById(handleId);
  if (!handle) return;

  handle.addEventListener("mousedown", function (e) {
    e.preventDefault();

    var target = document.getElementById(targetId);
    if (!target) return;

    handle.classList.add("dragging");
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    var startPos = direction === "horizontal" ? e.clientX : e.clientY;
    var rect = target.getBoundingClientRect();
    var startSize = direction === "horizontal" ? rect.width : rect.height;

    function onMove(e) {
      var delta = (direction === "horizontal" ? e.clientX : e.clientY) - startPos;
      var newSize = Math.max(80, startSize + delta);
      if (direction === "horizontal") {
        target.style.width = newSize + "px";
        target.style.flex = "none";
      } else {
        target.style.height = newSize + "px";
        target.style.flex = "none";
      }
    }

    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function initResizeHandles() {
  // Left conversation column width
  makeDraggable("drag-main", "panels-left", "horizontal");
  // Feature Status height within right column
  makeDraggable("drag-status-fileops", "panel-status", "vertical");
}

// ---------------------------------------------------------------------------
// Plan / File Operations tab switching
// ---------------------------------------------------------------------------

function switchPlanFileopsTab(tabName) {
  var planTab           = document.getElementById("tab-plan");
  var fileopsTab        = document.getElementById("tab-fileops");
  var changedfilesTab   = document.getElementById("tab-changedfiles");
  var planContent       = document.getElementById("plan-content");
  var fileopsContent    = document.getElementById("fileops-content");
  var changedContent    = document.getElementById("changedfiles-content");
  if (!planTab || !fileopsTab || !planContent || !fileopsContent) return;

  planTab.classList.toggle("active", tabName === "plan");
  fileopsTab.classList.toggle("active", tabName === "fileops");
  if (changedfilesTab) changedfilesTab.classList.toggle("active", tabName === "changedfiles");

  planContent.style.display    = tabName === "plan"         ? "" : "none";
  fileopsContent.style.display = tabName === "fileops"      ? "" : "none";
  if (changedContent) changedContent.style.display = tabName === "changedfiles" ? "" : "none";

  if (tabName === "changedfiles" && changedContent) {
    changedContent.innerHTML = renderChangedFilesContent();
  }
}

// ---------------------------------------------------------------------------
// Changed Files renderer
// ---------------------------------------------------------------------------

function renderChangedFilesContent() {
  // Deduplicate fileOps: keep last op per path (write/edit take precedence over read)
  var seen = {};
  var ops = state.fileOps;
  for (var i = ops.length - 1; i >= 0; i--) {
    var op = ops[i];
    if (!seen[op.path]) {
      seen[op.path] = op;
    } else if (op.type !== "read" && seen[op.path].type === "read") {
      seen[op.path] = op;
    }
  }
  var unique = Object.values(seen);

  if (unique.length === 0) {
    return '<div class="empty-state">(no files touched yet)</div>';
  }

  var rows = unique.map(function(op) {
    var fullPath = op.path;
    var displayPath = (state.projectDir && fullPath.startsWith(state.projectDir))
      ? fullPath.slice(state.projectDir.length).replace(/^[/\\]/, "")
      : fullPath;
    var escapedDisplay = escHtml(displayPath);
    var safeFullPath = fullPath.replace(/"/g, "&quot;");
    var diffBtn = op.type === "edit"
      ? '<button class="cf-btn cf-btn-diff" data-cf-action="diff" data-cf-path="' + safeFullPath + '">Git Diff</button>'
      : '';
    return '<tr>' +
      '<td><span class="cf-type ' + op.type + '">' + op.type.toUpperCase() + '</span></td>' +
      '<td class="cf-path" title="' + safeFullPath + '">' + escapedDisplay + '</td>' +
      '<td class="cf-actions">' +
        diffBtn +
        '<button class="cf-btn cf-btn-open" data-cf-action="open" data-cf-path="' + safeFullPath + '">Open</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<table class="changed-files-table">' +
    '<thead><tr><th>Type</th><th>File</th><th>Actions</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>';
}

// ---------------------------------------------------------------------------
// Dynamic conversation tabs (file viewer / git diff)
// ---------------------------------------------------------------------------

var _dynTabEditors = {}; // key -> ace editor instance

function _convTabKey(action, filePath) {
  return action + ':' + filePath;
}

function _shortName(filePath) {
  return filePath.split('/').pop() || filePath;
}

function openConvDynamicTab(action, filePath) {
  var key = _convTabKey(action, filePath);
  var tabBar = document.getElementById("conv-tab-bar");
  var convPanel = document.getElementById("panel-conversation");
  if (!tabBar || !convPanel) return;

  // If tab already exists, just activate it
  var existingTab = tabBar.querySelector('[data-conv-tab="' + key + '"]');
  if (existingTab) {
    activateConvTab(key);
    return;
  }

  var shortName = _shortName(filePath);
  var label = action === "diff" ? "Git Diff: " + shortName : shortName;

  // Create tab button
  var tabSpan = document.createElement("span");
  tabSpan.className = "panel-tab conv-dynamic-tab";
  tabSpan.setAttribute("data-conv-tab", key);
  var labelNode = document.createTextNode(label + " ");
  tabSpan.appendChild(labelNode);

  var closeBtn = document.createElement("button");
  closeBtn.className = "conv-dynamic-tab-close";
  closeBtn.title = "Close tab";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("data-conv-tab-close", key);
  tabSpan.appendChild(closeBtn);
  tabBar.appendChild(tabSpan);

  // Create content div
  var contentDiv = document.createElement("div");
  contentDiv.className = "panel-content dynamic-tab-content";
  contentDiv.id = "conv-tab-content-" + key.replace(/[^a-zA-Z0-9]/g, "_");
  contentDiv.style.display = "none";
  contentDiv.style.padding = "0";

  if (action === "diff") {
    contentDiv.innerHTML = '<div class="diff-viewer"><span class="diff-meta">Loading diff…</span></div>';
  } else {
    contentDiv.innerHTML = '<div class="dynamic-tab-ace" id="ace-' + key.replace(/[^a-zA-Z0-9]/g, "_") + '"></div>';
  }

  // Insert before followup-input-area
  var followupArea = document.getElementById("followup-input-area");
  var container = followupArea ? followupArea.parentNode : convPanel;
  if (followupArea && followupArea.parentNode) {
    followupArea.parentNode.insertBefore(contentDiv, followupArea);
  } else {
    convPanel.appendChild(contentDiv);
  }

  activateConvTab(key);

  // Load content
  if (action === "diff") {
    loadGitDiffIntoTab(filePath, contentDiv);
  } else {
    loadFileIntoTab(filePath, key, contentDiv);
  }
}

function activateConvTab(key) {
  var tabBar = document.getElementById("conv-tab-bar");
  var convPanel = document.getElementById("panel-conversation");
  if (!tabBar || !convPanel) return;

  // Deactivate all tabs
  var allTabs = tabBar.querySelectorAll("[data-conv-tab]");
  allTabs.forEach(function(t) { t.classList.remove("active"); });

  // Hide all content: conversation-content and all dynamic tab content
  var convContent = document.getElementById("conversation-content");
  if (convContent) convContent.style.display = "none";
  var allContent = convPanel.querySelectorAll(".dynamic-tab-content");
  allContent.forEach(function(c) { c.style.display = "none"; });

  // Activate chosen tab
  var activeTab = tabBar.querySelector('[data-conv-tab="' + key + '"]');
  if (activeTab) activeTab.classList.add("active");

  if (key === "conversation") {
    if (convContent) convContent.style.display = "";
  } else {
    var safeKey = key.replace(/[^a-zA-Z0-9]/g, "_");
    var targetContent = document.getElementById("conv-tab-content-" + safeKey);
    if (targetContent) {
      targetContent.style.display = "";
      // Resize ace editor if present
      var editor = _dynTabEditors[key];
      if (editor) editor.resize();
    }
  }
}

function closeConvDynamicTab(key) {
  var tabBar = document.getElementById("conv-tab-bar");
  var convPanel = document.getElementById("panel-conversation");
  if (!tabBar || !convPanel) return;

  var tab = tabBar.querySelector('[data-conv-tab="' + key + '"]');
  var safeKey = key.replace(/[^a-zA-Z0-9]/g, "_");
  var content = document.getElementById("conv-tab-content-" + safeKey);

  // Destroy ace editor if exists
  if (_dynTabEditors[key]) {
    try { _dynTabEditors[key].destroy(); } catch(e) {}
    delete _dynTabEditors[key];
  }

  if (tab) tab.remove();
  if (content) content.remove();

  // Go back to conversation tab
  activateConvTab("conversation");
}

function loadFileIntoTab(filePath, key, contentDiv) {
  signedFetch("/api/file-content?path=" + encodeURIComponent(filePath), { method: "GET" })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        contentDiv.innerHTML = '<div class="empty-state" style="color:#ef4444">' + escHtml(data.error) + '</div>';
        return;
      }
      var safeKey = key.replace(/[^a-zA-Z0-9]/g, "_");
      var aceEl = document.getElementById("ace-" + safeKey);
      if (!aceEl || typeof ace === "undefined") {
        contentDiv.innerHTML = '<pre style="padding:12px;color:' + escHtml(getCssVar("--kb-text-soft", "#e2e8f0")) + ';overflow:auto;height:100%">' + escHtml(data.content) + '</pre>';
        return;
      }
      var editor = ace.edit(aceEl);
      editor.setTheme(getActiveAceThemeName());
      editor.setReadOnly(true);
      editor.setShowPrintMargin(false);
      editor.setOptions({ fontSize: "12px", wrap: false });
      var ext = filePath.split('.').pop().toLowerCase();
      var modeMap = {
        js: "javascript", ts: "typescript", py: "python",
        rb: "ruby", go: "golang", rs: "rust", md: "markdown",
        json: "json", html: "html", css: "css", sh: "sh",
        yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml",
        ex: "elixir", exs: "elixir"
      };
      var mode = modeMap[ext] || "text";
      editor.session.setMode("ace/mode/" + mode);
      editor.setValue(data.content, -1);
      _dynTabEditors[key] = editor;
    })
    .catch(function() {
      contentDiv.innerHTML = '<div class="empty-state" style="color:' + escHtml(getCssVar("--kb-error", "#ef4444")) + '">Failed to load file.</div>';
    });
}

function loadGitDiffIntoTab(filePath, contentDiv) {
  signedFetch("/api/git-diff?path=" + encodeURIComponent(filePath), { method: "GET" })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.unavailable || data.diff === null) {
        contentDiv.innerHTML = '<div class="diff-unavailable">Git Diff Unavailable</div>';
        return;
      }
      if (!data.diff || data.diff.trim() === "") {
        contentDiv.innerHTML = '<div class="diff-unavailable">No changes detected (file matches HEAD)</div>';
        return;
      }
      var lines = data.diff.split('\n');
      var html = '<div class="diff-viewer">';
      lines.forEach(function(line) {
        var cls = "diff-meta";
        if (line.startsWith('+++') || line.startsWith('---')) cls = "diff-header";
        else if (line.startsWith('+'))  cls = "diff-add";
        else if (line.startsWith('-'))  cls = "diff-remove";
        else if (line.startsWith('@@')) cls = "diff-hunk";
        else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('Binary')) cls = "diff-header";
        html += '<span class="diff-line ' + cls + '">' + escHtml(line) + '</span>\n';
      });
      html += '</div>';
      contentDiv.innerHTML = html;
    })
    .catch(function() {
      contentDiv.innerHTML = '<div class="diff-unavailable">Git Diff Unavailable</div>';
    });
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

var ws = null;
var reconnectTimer = null;

function connectWebSocket() {
  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var wsUrl = protocol + "//" + location.host + "/ws";

  ws = new WebSocket(wsUrl);

  ws.onopen = function () {
    if ($statusMsg) $statusMsg.textContent = "Connected";
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = function (event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === "state") {
        var nextProvider = msg.data && msg.data.provider ? msg.data.provider : state.provider;
        if (nextProvider !== state.provider) {
          cachedModels = null;
        }
        state = Object.assign({}, state, msg.data);
        updateDOM();
        // Update thinking line in busy dialog if it is visible
        var workingOverlay = document.getElementById("working-overlay");
        var workingThinkingEl = document.getElementById("working-thinking");
        if (workingOverlay && workingOverlay.style.display !== "none" && workingThinkingEl) {
          var tLines = state.thinkingLines;
          if (tLines && tLines.length > 0) {
            workingThinkingEl.textContent = tLines[tLines.length - 1];
          }
        }
      } else if (msg.type === "npm-output" || msg.type === "npm-status" || msg.type === "npm-clear") {
        handleNpmMessage(msg);
      } else if (msg.type === "npm-scripts-updated") {
        loadNpmScripts();
      } else if (msg.type === "features-updated") {
        if (currentView === "features") {
          loadFeaturesData();
        } else if (currentView === "dashboard") {
          loadDashboardStats();
        }
      } else if (msg.type === "todo-updated" || msg.type === "project-activated") {
        loadTodoNavItem();
      } else if (msg.type === "project-deactivated") {
        // Server has returned to "waiting" state — reload to show project selection
        window.location.reload();
      } else if (msg.type === "clarify-request") {
        showClarifyModal(msg.question || "");
      }
    } catch (e) {
      // Ignore malformed messages
    }
  };

  ws.onclose = function () {
    if ($statusMsg) $statusMsg.textContent = "Disconnected — reconnecting…";
    scheduleReconnect();
  };

  ws.onerror = function () {
    ws.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connectWebSocket();
  }, 2000);
}

// ---------------------------------------------------------------------------
// Reusable Popup Menu
// ---------------------------------------------------------------------------

var activePopup = null;

function showPopupMenu(opts) {
  closePopupMenu();

  var items = opts.items || [];
  var anchorEl = opts.anchorEl;
  var onSelect = opts.onSelect || function () {};
  var onClose = opts.onClose || function () {};

  var overlay = document.createElement("div");
  overlay.className = "popup-overlay";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closePopupMenu();
  });

  var menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("tabindex", "-1");

  if (anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.right = (window.innerWidth - rect.right) + "px";
  }

  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  activePopup = {
    overlay: overlay,
    menu: menu,
    items: items,
    selectedIndex: items.findIndex(function (it) { return it.active; }),
    scrollOffset: 0,
    onSelect: onSelect,
    onClose: onClose,
  };

  if (activePopup.selectedIndex < 0) activePopup.selectedIndex = 0;
  renderPopupItems();

  menu.addEventListener("click", function (e) {
    if (!activePopup) return;
    var item = e.target.closest(".popup-item");
    if (!item) return;
    var idx = parseInt(item.getAttribute("data-index"), 10);
    if (!isNaN(idx) && idx >= 0 && idx < activePopup.items.length) {
      activePopup.onSelect(activePopup.items[idx]);
      closePopupMenu();
    }
  });

  menu.addEventListener("mouseover", function (e) {
    if (!activePopup) return;
    var item = e.target.closest(".popup-item");
    if (!item) return;
    var idx = parseInt(item.getAttribute("data-index"), 10);
    if (!isNaN(idx) && idx !== activePopup.selectedIndex) {
      activePopup.selectedIndex = idx;
      renderPopupItems();
    }
  });

  menu.focus();
}

function renderPopupItems() {
  if (!activePopup) return;

  var menu = activePopup.menu;
  var items = activePopup.items;
  var selected = activePopup.selectedIndex;
  var maxVisible = 9;
  var scrollOffset = activePopup.scrollOffset;

  if (selected < scrollOffset) scrollOffset = selected;
  else if (selected >= scrollOffset + maxVisible) scrollOffset = selected - maxVisible + 1;
  activePopup.scrollOffset = scrollOffset;

  var visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  var html = "";

  if (scrollOffset > 0) {
    html += '<div class="popup-scroll-indicator">&#x25B2; more</div>';
  }

  visibleItems.forEach(function (item, i) {
    var globalIndex = scrollOffset + i;
    var isSelected = globalIndex === selected;
    var cls = "popup-item" + (isSelected ? " selected" : "") + (item.active ? " current" : "");

    html +=
      '<div class="' + cls + '" data-index="' + globalIndex + '" role="option"' +
      (isSelected ? ' aria-selected="true"' : "") + ">" +
      '<span class="popup-key">' + (i + 1) + "</span>" +
      '<span class="popup-label">' + escHtml(item.label) + "</span>";
    if (item.description) {
      html += '<span class="popup-desc">' + escHtml(item.description) + "</span>";
    }
    if (item.active) {
      html += '<span class="popup-active-badge">active</span>';
    }
    html += "</div>";
  });

  if (scrollOffset + maxVisible < items.length) {
    html += '<div class="popup-scroll-indicator">&#x25BC; more</div>';
  }

  menu.innerHTML = html;
}

function closePopupMenu() {
  if (!activePopup) return;
  if (activePopup.overlay && activePopup.overlay.parentNode) {
    activePopup.overlay.parentNode.removeChild(activePopup.overlay);
  }
  var onClose = activePopup.onClose;
  activePopup = null;
  if (onClose) onClose();
}

document.addEventListener("keydown", function (e) {
  if (!activePopup) return;

  var items = activePopup.items;
  var maxVisible = 9;

  switch (e.key) {
    case "Escape":
      e.preventDefault();
      closePopupMenu();
      break;
    case "ArrowUp":
      e.preventDefault();
      activePopup.selectedIndex =
        activePopup.selectedIndex > 0 ? activePopup.selectedIndex - 1 : items.length - 1;
      renderPopupItems();
      break;
    case "ArrowDown":
      e.preventDefault();
      activePopup.selectedIndex =
        activePopup.selectedIndex < items.length - 1 ? activePopup.selectedIndex + 1 : 0;
      renderPopupItems();
      break;
    case "Enter":
      e.preventDefault();
      if (items[activePopup.selectedIndex]) {
        activePopup.onSelect(items[activePopup.selectedIndex]);
        closePopupMenu();
      }
      break;
    default: {
      var num = parseInt(e.key, 10);
      if (num >= 1 && num <= maxVisible) {
        e.preventDefault();
        var globalIdx = activePopup.scrollOffset + num - 1;
        if (globalIdx < items.length) {
          activePopup.onSelect(items[globalIdx]);
          closePopupMenu();
        }
      }
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Project Deselection
// ---------------------------------------------------------------------------

function deselectProject() {
  // Block navigation while the agent is processing
  if (state.status === "processing") return;

  signedFetch("/api/deselect-project", { method: "POST" })
    .then(function (res) {
      if (!res.ok) return res.json().then(function (d) { throw new Error(d.error); });
      // Server will broadcast project-deactivated via WS, triggering a reload
    })
    .catch(function (err) {
      console.error("Failed to deselect project:", err);
    });
}

// ---------------------------------------------------------------------------
// Model Selector
// ---------------------------------------------------------------------------

var cachedModels = null;

function openModelSelector() {
  if (activePopup) return;

  var trigger = document.getElementById("model-trigger");
  var provider = state.provider || "anthropic";

  function showWithModels(models) {
    var items = models.map(function (m) {
      return {
        id: m.id,
        label: m.id,
        description: m.description,
        active: m.id === state.model,
      };
    });

    showPopupMenu({
      items: items,
      anchorEl: trigger,
      onSelect: function (item) {
        if (item.id !== state.model) {
          signedWsSend({ type: "select-model", model: item.id });
        }
      },
      onClose: function () {
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      },
    });

    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  if (cachedModels) {
    showWithModels(cachedModels);
  } else {
    signedFetch("/api/models?provider=" + encodeURIComponent(provider))
      .then(function (res) { return res.json(); })
      .then(function (models) {
        cachedModels = models;
        showWithModels(models);
      })
      .catch(function () {
        showWithModels([{ id: state.model, description: "Current model" }]);
      });
  }
}

// ---------------------------------------------------------------------------
// Provider Selector
// ---------------------------------------------------------------------------

var cachedProviders = null;

function openProviderSelector() {
  if (activePopup) return;

  var trigger = document.getElementById("provider-trigger");

  function showWithProviders(providers) {
    var items = providers.map(function (p) {
      return {
        id: p.id,
        label: p.label,
        description: p.description,
        active: p.id === state.provider,
      };
    });

    showPopupMenu({
      items: items,
      anchorEl: trigger,
      onSelect: function (item) {
        if (item.id !== state.provider) {
          signedWsSend({ type: "select-provider", provider: item.id });
          // Clear cached models so they refresh for the new provider
          cachedModels = null;
        }
      },
      onClose: function () {
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      },
    });

    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  if (cachedProviders) {
    showWithProviders(cachedProviders);
  } else {
    signedFetch("/api/providers")
      .then(function (res) { return res.json(); })
      .then(function (providers) {
        cachedProviders = providers;
        showWithProviders(providers);
      })
      .catch(function () {
        showWithProviders([
          { id: "anthropic", label: "Anthropic", description: "Direct Anthropic API" },
        ]);
      });
  }
}

// ---------------------------------------------------------------------------
// Code Assist menu
// ---------------------------------------------------------------------------

var _codeAssistOverlay = null;

function openCodeAssistMenu() {
  if (_codeAssistOverlay) return;

  // Create overlay
  var overlay = document.createElement("div");
  overlay.className = "ca-overlay";
  overlay.innerHTML =
    '<div class="ca-card">' +
      '<div class="ca-header">' +
        '<h2>Code Assist</h2>' +
        '<button class="dialog-close ca-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ca-body"><div class="empty-state">Loading…</div></div>' +
    '</div>';
  document.body.appendChild(overlay);
  _codeAssistOverlay = overlay;

  overlay.querySelector(".ca-close").addEventListener("click", closeCodeAssistMenu);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeCodeAssistMenu();
  });

  // Fetch options
  signedFetch("/api/code-assist/options")
    .then(function (r) { return r.json(); })
    .then(function (options) {
      var body = overlay.querySelector(".ca-body");
      if (!options || options.length === 0) {
        body.innerHTML = '<div class="empty-state">No code assist options configured</div>';
        return;
      }
      var html = '';
      options.forEach(function (opt, i) {
        html +=
          '<div class="ca-option" data-index="' + i + '">' +
            '<div class="ca-option-info">' +
              '<div class="ca-option-name">' + escHtml(opt.name) + '</div>' +
              '<div class="ca-option-author">by ' + escHtml(opt.author) + '</div>' +
              '<div class="ca-option-desc">' + escHtml(opt.description) + '</div>' +
            '</div>' +
            '<div class="ca-option-actions">' +
              '<button class="ca-btn ca-btn-preview" data-prompt="' + escHtml(opt.prompt) + '">Preview</button>' +
              '<button class="ca-btn ca-btn-run" data-name="' + escHtml(opt.name) + '">Run</button>' +
            '</div>' +
          '</div>';
      });
      body.innerHTML = html;

      // Wire up buttons
      body.querySelectorAll(".ca-btn-preview").forEach(function (btn) {
        btn.addEventListener("click", function () {
          openCodeAssistPreview(btn.getAttribute("data-prompt"));
        });
      });
      body.querySelectorAll(".ca-btn-run").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var name = btn.getAttribute("data-name");
          closeCodeAssistMenu();
          runCodeAssistFromWeb(name);
        });
      });
    })
    .catch(function () {
      var body = overlay.querySelector(".ca-body");
      body.innerHTML = '<div class="empty-state">Failed to load options</div>';
    });

  // Escape to close
  function handleKey(e) {
    if (e.key === "Escape") {
      closeCodeAssistMenu();
      document.removeEventListener("keydown", handleKey);
    }
  }
  document.addEventListener("keydown", handleKey);
}

function closeCodeAssistMenu() {
  if (_codeAssistOverlay) {
    _codeAssistOverlay.remove();
    _codeAssistOverlay = null;
  }
}

function openCodeAssistPreview(promptFile) {
  var overlay = document.createElement("div");
  overlay.className = "ca-overlay ca-preview-overlay";
  overlay.innerHTML =
    '<div class="ca-card ca-preview-card">' +
      '<div class="ca-header">' +
        '<h2>Prompt Preview</h2>' +
        '<button class="dialog-close ca-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ca-body ca-preview-body"><div class="empty-state">Loading…</div></div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector(".ca-close").addEventListener("click", function () { overlay.remove(); });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  signedFetch("/api/code-assist/prompt?file=" + encodeURIComponent(promptFile))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var body = overlay.querySelector(".ca-preview-body");
      body.innerHTML = '<div class="conv-thinking">' + renderThinkingContent(data.content || "") + '</div>';
    })
    .catch(function () {
      overlay.querySelector(".ca-preview-body").innerHTML = '<div class="empty-state">Failed to load prompt</div>';
    });

  function handleKey(e) {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", handleKey);
    }
  }
  document.addEventListener("keydown", handleKey);
}

function runCodeAssistFromWeb(name) {
  // Switch to dashboard to show conversation
  showDashboardView();

  signedFetch("/api/code-assist/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name }),
  }).catch(function () {
    // Error will show via WebSocket state updates
  });
}

// ---------------------------------------------------------------------------
// TODO List menu
// ---------------------------------------------------------------------------

var _todoOverlay = null;

function openTodoMenu() {
  if (_todoOverlay) return;

  var overlay = document.createElement("div");
  overlay.className = "ca-overlay";
  overlay.innerHTML =
    '<div class="ca-card ca-card--wide">' +
      '<div class="ca-header">' +
        '<h2>&#x2714;&#xFE0F; TODO List</h2>' +
        '<button class="dialog-close ca-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ca-body"><div class="empty-state">Loading\u2026</div></div>' +
    '</div>';
  document.body.appendChild(overlay);
  _todoOverlay = overlay;

  overlay.querySelector(".ca-close").addEventListener("click", closeTodoMenu);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeTodoMenu();
  });

  signedFetch("/api/todo/items")
    .then(function (r) { return r.json(); })
    .then(function (items) {
      var body = overlay.querySelector(".ca-body");
      if (!items || items.length === 0) {
        body.innerHTML = '<div class="empty-state">No TODO items found</div>';
        return;
      }
      var html = '';
      items.forEach(function (item) {
        var priorityClass = 'todo-priority-' + (item.priority || 'low');
        var fileRef = item.file
          ? '<div class="ca-option-author">' + escHtml(item.file) +
            (item.line != null ? ':' + item.line : '') + '</div>'
          : '';
        html +=
          '<div class="ca-option">' +
            '<div class="ca-option-info">' +
              '<div class="ca-option-name">' +
                '<span class="todo-priority-badge ' + escHtml(priorityClass) + '">' + escHtml(item.priority) + '</span>' +
                '<span class="todo-category">' + escHtml(item.category) + '</span> ' +
                escHtml(item.title) +
              '</div>' +
              fileRef +
              '<div class="ca-option-desc">' + escHtml(item.description) + '</div>' +
            '</div>' +
            '<div class="ca-option-actions">' +
              '<button class="ca-btn ca-btn-preview" data-id="' + item.id + '">Preview</button>' +
              '<button class="ca-btn ca-btn-run" data-id="' + item.id + '">Open</button>' +
              '<button class="ca-btn ca-btn-remove" data-id="' + item.id + '">Remove</button>' +
            '</div>' +
          '</div>';
      });
      body.innerHTML = html;

      body.querySelectorAll(".ca-btn-preview").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = parseInt(btn.getAttribute("data-id"), 10);
          var item = items.find(function (i) { return i.id === id; });
          if (item) openTodoItemPreview(item);
        });
      });
      body.querySelectorAll(".ca-btn-run").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = parseInt(btn.getAttribute("data-id"), 10);
          var item = items.find(function (i) { return i.id === id; });
          if (item) {
            closeTodoMenu();
            runTodoPlanFromWeb(item);
          }
        });
      });
      body.querySelectorAll(".ca-btn-remove").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = parseInt(btn.getAttribute("data-id"), 10);
          btn.disabled = true;
          signedFetch("/api/todo/item", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: id }),
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                var row = btn.closest(".ca-option");
                if (row) row.remove();
                items = items.filter(function (i) { return i.id !== id; });
                if (items.length === 0) {
                  body.innerHTML = '<div class="empty-state">No TODO items found</div>';
                }
              } else {
                btn.disabled = false;
              }
            })
            .catch(function () { btn.disabled = false; });
        });
      });
    })
    .catch(function () {
      var body = overlay.querySelector(".ca-body");
      body.innerHTML = '<div class="empty-state">Failed to load TODO items</div>';
    });

  function handleKey(e) {
    if (e.key === "Escape") {
      closeTodoMenu();
      document.removeEventListener("keydown", handleKey);
    }
  }
  document.addEventListener("keydown", handleKey);
}

function closeTodoMenu() {
  if (_todoOverlay) {
    _todoOverlay.remove();
    _todoOverlay = null;
  }
}

function openTodoItemPreview(item) {
  var overlay = document.createElement("div");
  overlay.className = "ca-overlay ca-preview-overlay";
  var fileInfo = item.file
    ? '<div class="todo-preview-field"><span class="todo-preview-label">File:</span> ' + escHtml(item.file) +
      (item.line != null ? ' &nbsp;<span class="todo-preview-label">Line:</span> ' + item.line : '') +
      (item.lines ? ' &nbsp;<span class="todo-preview-label">Lines:</span> ' + item.lines.join(', ') : '') +
      '</div>'
    : '';
  overlay.innerHTML =
    '<div class="ca-card ca-preview-card">' +
      '<div class="ca-header">' +
        '<h2>TODO Item</h2>' +
        '<button class="dialog-close ca-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ca-body ca-preview-body">' +
        '<div class="todo-preview">' +
          '<div class="todo-preview-title">' +
            '<span class="todo-priority-badge todo-priority-' + escHtml(item.priority) + '">' + escHtml(item.priority) + '</span>' +
            '<span class="todo-category">' + escHtml(item.category) + '</span> ' +
            escHtml(item.title) +
          '</div>' +
          fileInfo +
          '<div class="todo-preview-desc">' + escHtml(item.description) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector(".ca-close").addEventListener("click", function () { overlay.remove(); });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });

  function handleKey(e) {
    if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", handleKey); }
  }
  document.addEventListener("keydown", handleKey);
}

function runTodoPlanFromWeb(item) {
  showDashboardView();

  signedFetch("/api/todo/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: item.id }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) return; // visible via status bar WS update
      openNewFeatureWithPlan("Resolve TODO: " + item.title, data.plan || "");
    })
    .catch(function () {});
}

function openNewFeatureWithPlan(title, description) {
  openNewFeatureDialog();
  setTimeout(function () {
    var titleInput = document.getElementById("nf-title");
    if (titleInput) titleInput.value = title;
    if (nfAceEditor) nfAceEditor.setValue(description, -1);
  }, 100);
}

function loadTodoNavItem() {
  signedFetch("/api/todo/exists")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var navItem = document.getElementById("nav-todo-item");
      if (navItem) navItem.style.display = data.exists ? "" : "none";
    })
    .catch(function () {});
}

// ---------------------------------------------------------------------------
// View switching — Dashboard / Features / Command / Settings
// ---------------------------------------------------------------------------

var currentView = "welcome";

// Track previous featureName to detect when processing starts
var _prevFeatureName = null;

function hideAllViews() {
  var welcome = document.getElementById("welcome-view");
  var dashView = document.getElementById("dashboard-view");
  var dock = document.getElementById("dock-container");
  var featuresView = document.getElementById("features-view");
  var commandView = document.getElementById("command-view");
  var settingsView = document.getElementById("settings-view");
  if (welcome) welcome.style.display = "none";
  if (dashView) dashView.style.display = "none";
  if (dock) dock.style.display = "none";
  if (featuresView) featuresView.style.display = "none";
  if (commandView) commandView.style.display = "none";
  if (settingsView) settingsView.style.display = "none";
  var navDash = document.getElementById("nav-dashboard");
  var navProcessing = document.getElementById("nav-processing");
  var navFeatures = document.getElementById("nav-features");
  var navSettings = document.getElementById("nav-settings");
  var navCodereview = document.getElementById("nav-codereview");
  if (navDash) navDash.classList.remove("active");
  if (navProcessing) { navProcessing.classList.remove("active"); navProcessing.classList.remove("complete"); }
  if (navFeatures) navFeatures.classList.remove("active");
  if (navSettings) navSettings.classList.remove("active");
  if (navCodereview) navCodereview.classList.remove("active");
}

function showWelcomeView() {
  hideAllViews();
  var welcome = document.getElementById("welcome-view");
  if (welcome) {
    welcome.style.display = "";
    var content = document.getElementById("welcome-content");
    if (content) content.innerHTML = renderWelcomeContent();
  }
  currentView = "welcome";
  updateNpmCommandsListActive(null);
}

function showDashboardView() {
  hideAllViews();
  var dashView = document.getElementById("dashboard-view");
  if (dashView) dashView.style.display = "";
  currentView = "dashboard";
  var navDash = document.getElementById("nav-dashboard");
  if (navDash) navDash.classList.add("active");
  updateNpmCommandsListActive(null);
  loadDashboardStats();
}

function showProcessingView() {
  hideAllViews();
  var dock = document.getElementById("dock-container");
  if (dock) dock.style.display = "";
  currentView = "processing";
  var navProcessing = document.getElementById("nav-processing");
  if (navProcessing) {
    var isActive = state.status === "processing";
    navProcessing.classList.toggle("active", isActive);
    navProcessing.classList.toggle("complete", !isActive);
  }
  updateNpmCommandsListActive(null);
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function loadDashboardStats() {
  var content = document.getElementById("dashboard-content");
  if (content) content.innerHTML = '<div class="empty-state">Loading stats\u2026</div>';
  signedFetch("/api/stats")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (content) content.innerHTML = renderDashboardStats(data);
    })
    .catch(function () {
      if (content) content.innerHTML = '<div class="dashboard-empty">Could not load statistics.</div>';
    });
}

function renderDashboardStats(d) {
  if (!d || d.totalFeatures === 0) {
    return '<div class="dashboard-header">Dashboard</div>' +
           '<div class="dashboard-empty">No features processed yet.<br>Create a feature to get started.</div>';
  }

  var successRate = d.totalFeatures > 0
    ? Math.round((d.successCount / d.totalFeatures) * 100)
    : 0;
  var totalTokens = (d.totalTokensIn || 0) + (d.totalTokensOut || 0);

  function tile(icon, value, label, accent) {
    return '<div class="dashboard-tile' + (accent ? ' accent-' + accent : '') + '">' +
      '<div class="dashboard-tile-icon">' + icon + '</div>' +
      '<div class="dashboard-tile-value">' + escHtml(String(value)) + '</div>' +
      '<div class="dashboard-tile-label">' + escHtml(label) + '</div>' +
    '</div>';
  }

  var html = '<div class="dashboard-header">Dashboard</div>' +
    '<div class="dashboard-subheader">Feature processing summary for this project</div>';

  html += '<div class="dashboard-section-title">Activity</div>';
  html += '<div class="dashboard-tiles">' +
    tile('📊', d.totalFeatures, 'Total Features', '') +
    tile('📅', d.featuresThisWeek, 'This Week', 'blue') +
    tile('🔥', d.featuresToday, 'Today', 'amber') +
    tile('✅', successRate + '%', 'Success Rate', successRate >= 80 ? 'green' : 'amber') +
  '</div>';

  html += '<div class="dashboard-section-title">Tokens</div>';
  html += '<div class="dashboard-tiles">' +
    tile('🔡', formatNumber(totalTokens), 'Total Tokens', '') +
    tile('📥', formatNumber(d.totalTokensIn || 0), 'Tokens In', '') +
    tile('📤', formatNumber(d.totalTokensOut || 0), 'Tokens Out', '') +
    tile('💾', formatNumber(d.totalCacheTokens || 0), 'Cache Tokens', 'blue') +
  '</div>';

  html += '<div class="dashboard-section-title">Cost</div>';
  html += '<div class="dashboard-tiles">' +
    tile('💰', '$' + (d.totalCostUsd || 0).toFixed(2), 'Total Spend', 'green') +
    tile('📉', '$' + (d.avgCostUsd || 0).toFixed(4), 'Avg per Feature', '') +
    tile('🔄', Math.round(d.avgTurns || 0), 'Avg Turns', '') +
  '</div>';

  return html;
}

// ---------------------------------------------------------------------------
// Processing nav item — show/hide and label based on state
// ---------------------------------------------------------------------------

function updateProcessingNavItem() {
  var navItem = document.getElementById("nav-processing-item");
  var navEl = document.getElementById("nav-processing");
  var iconEl = document.getElementById("nav-processing-icon");
  var labelEl = document.getElementById("nav-processing-label");
  if (!navItem) return;

  var hasFeature = state.featureName !== null || state.followupFeatureId !== null;
  navItem.style.display = hasFeature ? "" : "none";

  if (!hasFeature) return;

  var isProcessing = state.status === "processing";
  if (iconEl) {
    iconEl.innerHTML = isProcessing ? '&#x2699;&#xFE0F;' : '&#x2705;';
    iconEl.classList.toggle("nav-icon-spin", isProcessing);
  }
  if (labelEl) labelEl.textContent = isProcessing ? "Processing" : "Waiting";

  // Keep active state if on processing view
  if (navEl && currentView === "processing") {
    navEl.classList.toggle("active", isProcessing);
    navEl.classList.toggle("complete", !isProcessing);
  }
}

function showFeaturesView() {
  hideAllViews();
  var featuresView = document.getElementById("features-view");
  if (featuresView) featuresView.style.display = "";
  currentView = "features";
  var navFeatures = document.getElementById("nav-features");
  if (navFeatures) navFeatures.classList.add("active");
  updateNpmCommandsListActive(null);
  loadFeaturesData();
  makeDraggable("drag-pending-hold", "panel-pending", "horizontal");
  makeDraggable("drag-features", "features-top-panels", "vertical");
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------

var nfAceEditor = null;
var settingsAceEditor = null;
var settingsCurrentFile = null;
var settingsCurrentPanel = null; // "kaibot-settings" or null (file editor)
var settingsDirtyFiles = {};
var settingsOriginalContent = {};
var settingsCurrentContent = {};
var globalThemeSettings = { theme: null };
var themeBrowserState = {
  open: false,
  query: "",
  page: 1,
  hasMore: false,
  loading: false,
  results: [],
  debounceTimer: null,
};

function showSettingsView() {
  hideAllViews();
  var settingsView = document.getElementById("settings-view");
  if (settingsView) settingsView.style.display = "";
  currentView = "settings";
  var navSettings = document.getElementById("nav-settings");
  if (navSettings) navSettings.classList.add("active");
  updateNpmCommandsListActive(null);
  initSettingsEditor();
  if (!settingsCurrentFile && !settingsCurrentPanel) {
    selectKaiBotSettingsPanel();
  }
}

function initNFEditor() {
  if (nfAceEditor) return;
  if (typeof ace === "undefined") return;
  nfAceEditor = ace.edit("nf-description-editor");
  nfAceEditor.setTheme(getActiveAceThemeName());
  nfAceEditor.session.setMode("ace/mode/markdown");
  nfAceEditor.setOptions({
    fontSize: "13px",
    showLineNumbers: true,
    showPrintMargin: false,
    wrap: true,
  });
}

function initSettingsEditor() {
  if (settingsAceEditor) return;
  if (typeof ace === "undefined") return;
  settingsAceEditor = ace.edit("settings-editor");
  settingsAceEditor.setTheme(getActiveAceThemeName());
  settingsAceEditor.session.setMode("ace/mode/markdown");
  settingsAceEditor.setOptions({
    fontSize: "13px",
    showLineNumbers: true,
    showPrintMargin: false,
    wrap: false,
  });
  settingsAceEditor.commands.addCommand({
    name: "saveSettings",
    bindKey: { win: "Ctrl-S", mac: "Cmd-S" },
    exec: function () { saveSettingsFile(); },
  });
  settingsAceEditor.on("change", function () {
    if (!settingsCurrentFile) return;
    var curr = settingsAceEditor.getValue();
    var isDirty = curr !== (settingsOriginalContent[settingsCurrentFile] || "");
    settingsDirtyFiles[settingsCurrentFile] = isDirty;
    updateSettingsTabDirty(settingsCurrentFile, isDirty);
  });
}

function selectKaiBotSettingsPanel() {
  if (settingsCurrentFile && settingsAceEditor) {
    settingsCurrentContent[settingsCurrentFile] = settingsAceEditor.getValue();
  }
  settingsCurrentFile = null;
  settingsCurrentPanel = "kaibot-settings";
  document.querySelectorAll(".settings-tab").forEach(function (tab) {
    tab.classList.toggle("active", tab.getAttribute("data-panel") === "kaibot-settings");
  });
  var panel = document.getElementById("kaibot-settings-panel");
  var editorArea = document.getElementById("settings-editor-area");
  if (panel) panel.style.display = "";
  if (editorArea) editorArea.style.display = "none";
  loadKaiBotSettingsPanel();
}

function loadKaiBotSettingsPanel() {
  signedFetch("/api/global-settings")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      globalThemeSettings = data || {};
      var toggle = document.getElementById("setting-matomo-enabled");
      if (toggle) {
        // Default is enabled (true) when key is absent
        toggle.checked = data.matomoEnabled !== false;
      }
      updateThemeSettingLabel();
    })
    .catch(function () {});
}

function updateThemeSettingLabel() {
  var label = document.getElementById("setting-theme-name");
  if (!label) return;
  var activeTheme = globalThemeSettings && globalThemeSettings.theme;
  label.textContent = activeTheme && activeTheme.name ? activeTheme.name : "KaiBot";
}

function openThemeBrowser() {
  var overlay = document.getElementById("theme-browser-overlay");
  if (!overlay) return;
  overlay.style.display = "";
  themeBrowserState.open = true;
  themeBrowserState.page = 1;
  themeBrowserState.results = [];
  themeBrowserState.hasMore = false;
  renderThemeResults();
  var input = document.getElementById("theme-search-input");
  if (input) {
    input.value = themeBrowserState.query || "";
    setTimeout(function () { input.focus(); }, 0);
  }
  searchThemes(themeBrowserState.query || "", 1, false);
}

function closeThemeBrowser() {
  var overlay = document.getElementById("theme-browser-overlay");
  if (overlay) overlay.style.display = "none";
  themeBrowserState.open = false;
  hideThemeBrowserError();
}

function setThemeBrowserLoading(isLoading) {
  themeBrowserState.loading = isLoading;
  var summary = document.getElementById("theme-browser-summary");
  if (summary) {
    summary.textContent = isLoading ? "Searching marketplace…" : "";
  }
  var loadMoreBtn = document.getElementById("theme-load-more-btn");
  if (loadMoreBtn) loadMoreBtn.disabled = isLoading;
}

function showThemeBrowserError(message) {
  var errorEl = document.getElementById("theme-browser-error");
  if (!errorEl) return;
  errorEl.textContent = message || "Theme request failed.";
  errorEl.style.display = "";
}

function hideThemeBrowserError() {
  var errorEl = document.getElementById("theme-browser-error");
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.style.display = "none";
}

function renderThemeResults() {
  var container = document.getElementById("theme-browser-results");
  var summary = document.getElementById("theme-browser-summary");
  var loadMoreBtn = document.getElementById("theme-load-more-btn");
  if (!container) return;

  if (themeBrowserState.loading && themeBrowserState.results.length === 0) {
    container.innerHTML = '<div class="empty-state">Searching themes…</div>';
  } else if (themeBrowserState.results.length === 0) {
    container.innerHTML = '<div class="empty-state">No themes found.</div>';
  } else {
    container.innerHTML = themeBrowserState.results.map(function (item) {
      return (
        '<div class="theme-result-card">' +
          '<div class="theme-result-copy">' +
            '<div class="theme-result-name">' + escHtml(item.name) + '</div>' +
            '<div class="theme-result-meta">' +
              '<span>' + escHtml(formatThemeDate(item.lastUpdated)) + '</span>' +
              '<span>' + escHtml(formatNumber(item.installCount || 0)) + ' installs</span>' +
              '<span>' + escHtml(item.publisher) + "</span>" +
            "</div>" +
          "</div>" +
          '<button class="dialog-btn dialog-btn-primary theme-select-btn" type="button" data-theme-id="' + escHtml(item.id) + '">Select</button>' +
        "</div>"
      );
    }).join("");
  }

  if (summary && !themeBrowserState.loading) {
    summary.textContent = themeBrowserState.results.length
      ? "Showing " + themeBrowserState.results.length + (themeBrowserState.hasMore ? "+" : "") + " theme" + (themeBrowserState.results.length === 1 ? "" : "s")
      : "";
  }
  if (loadMoreBtn) {
    loadMoreBtn.style.display = themeBrowserState.hasMore ? "" : "none";
  }
}

function searchThemes(query, page, append) {
  hideThemeBrowserError();
  themeBrowserState.query = query || "";
  themeBrowserState.page = page || 1;
  setThemeBrowserLoading(true);
  if (!append) {
    themeBrowserState.results = [];
    renderThemeResults();
  }

  signedFetch("/api/themes/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: themeBrowserState.query, page: themeBrowserState.page }),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      themeBrowserState.results = append
        ? themeBrowserState.results.concat(data.results || [])
        : (data.results || []);
      themeBrowserState.hasMore = !!data.hasMore;
      renderThemeResults();
    })
    .catch(function (err) {
      showThemeBrowserError((err && err.message) || "Unable to search the marketplace.");
      renderThemeResults();
    })
    .finally(function () {
      setThemeBrowserLoading(false);
    });
}

function queueThemeSearch(query) {
  if (themeBrowserState.debounceTimer) {
    clearTimeout(themeBrowserState.debounceTimer);
  }
  themeBrowserState.debounceTimer = setTimeout(function () {
    searchThemes(query, 1, false);
  }, 250);
}

function applyThemeSelectionById(themeId) {
  var selected = null;
  themeBrowserState.results.forEach(function (item) {
    if (item.id === themeId) selected = item;
  });
  if (!selected) return;
  hideThemeBrowserError();
  setThemeBrowserLoading(true);
  signedFetch("/api/themes/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selected),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      globalThemeSettings = data.settings || {};
      updateThemeSettingLabel();
      return reloadThemeAssets();
    })
    .then(function () {
      if ($statusMsg) $statusMsg.textContent = "Theme updated.";
      closeThemeBrowser();
    })
    .catch(function (err) {
      showThemeBrowserError((err && err.message) || "Unable to apply theme.");
    })
    .finally(function () {
      setThemeBrowserLoading(false);
    });
}

function resetThemeSelection() {
  hideThemeBrowserError();
  setThemeBrowserLoading(true);
  signedFetch("/api/themes/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      globalThemeSettings = data.settings || {};
      updateThemeSettingLabel();
      return reloadThemeAssets();
    })
    .then(function () {
      if ($statusMsg) $statusMsg.textContent = "Using the default KaiBot theme.";
      closeThemeBrowser();
    })
    .catch(function (err) {
      showThemeBrowserError((err && err.message) || "Unable to reset theme.");
    })
    .finally(function () {
      setThemeBrowserLoading(false);
    });
}

function formatThemeDate(value) {
  if (!value) return "Unknown date";
  try {
    return new Date(value).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch (e) {
    return value;
  }
}

function selectSettingsTab(filePath) {
  if (settingsCurrentFile && settingsAceEditor) {
    settingsCurrentContent[settingsCurrentFile] = settingsAceEditor.getValue();
  }
  settingsCurrentFile = filePath;
  settingsCurrentPanel = null;
  document.querySelectorAll(".settings-tab").forEach(function (tab) {
    tab.classList.toggle("active", tab.getAttribute("data-file") === filePath);
  });
  var panel = document.getElementById("kaibot-settings-panel");
  var editorArea = document.getElementById("settings-editor-area");
  if (panel) panel.style.display = "none";
  if (editorArea) editorArea.style.display = "";
  var label = document.getElementById("settings-file-label");
  if (label) label.textContent = filePath;
  if (settingsCurrentContent[filePath] !== undefined) {
    if (settingsAceEditor) settingsAceEditor.setValue(settingsCurrentContent[filePath], -1);
    updateSettingsTabDirty(filePath, settingsDirtyFiles[filePath] || false);
  } else {
    signedFetch("/api/settings/file?path=" + encodeURIComponent(filePath))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var content = data.content || "";
        settingsOriginalContent[filePath] = content;
        settingsCurrentContent[filePath] = content;
        if (settingsAceEditor) settingsAceEditor.setValue(content, -1);
        updateSettingsTabDirty(filePath, false);
      })
      .catch(function () {
        if (settingsAceEditor) settingsAceEditor.setValue("", -1);
      });
  }
}

function updateSettingsTabDirty(filePath, isDirty) {
  document.querySelectorAll(".settings-tab").forEach(function (tab) {
    if (tab.getAttribute("data-file") === filePath) {
      tab.classList.toggle("dirty", isDirty);
    }
  });
}

function saveSettingsFile() {
  if (!settingsCurrentFile || !settingsAceEditor) return;
  var content = settingsAceEditor.getValue();
  signedFetch("/api/settings/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: settingsCurrentFile, content: content }),
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        settingsOriginalContent[settingsCurrentFile] = content;
        settingsCurrentContent[settingsCurrentFile] = content;
        settingsDirtyFiles[settingsCurrentFile] = false;
        updateSettingsTabDirty(settingsCurrentFile, false);
      }
    });
}

// ---------------------------------------------------------------------------
// Features list rendering
// ---------------------------------------------------------------------------

function formatDate(isoString) {
  if (!isoString) return "";
  try {
    var d = new Date(isoString);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return isoString;
  }
}

function renderPendingFeatures(items) {
  var pending = (items || []).filter(function (i) { return i.status === "pending"; });
  if (pending.length === 0) {
    return '<div class="empty-state">(no pending features)</div>';
  }
  return pending.map(function (item) {
    return (
      '<div class="feature-list-item">' +
        '<span class="feature-list-badge pending">pending</span>' +
        '<div class="feature-list-body">' +
          '<div class="feature-list-title">' + escHtml(item.title) + '</div>' +
          '<div class="feature-list-meta">' + escHtml(item.filename) + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

function renderHoldFeatures(items) {
  var hold = (items || []).filter(function (i) { return i.status === "hold"; });
  if (hold.length === 0) {
    return '<div class="empty-state">(no backlog features)</div>';
  }
  return hold.map(function (item) {
    return (
      '<div class="feature-list-item" draggable="true" data-filename="' + escHtml(item.filename) + '" title="Drag to Pending to queue for processing">' +
        '<span class="feature-list-badge hold">hold</span>' +
        '<div class="feature-list-body">' +
          '<div class="feature-list-title">' + escHtml(item.title) + '</div>' +
          '<div class="feature-list-meta">' + escHtml(item.filename) + '</div>' +
        '</div>' +
        '<button class="hold-edit-btn" data-edit-filename="' + escHtml(item.filename) + '" draggable="false" title="Edit feature">&#x270F;&#xFE0F;</button>' +
      '</div>'
    );
  }).join("");
}

function formatCost(cost) {
  if (!cost || cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return "$" + cost.toFixed(2);
}

function renderCompleteFeatures(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-state">(no complete features)</div>';
  }
  return items.map(function (item) {
    var desc = item.title || item.description || item.summary || "";
    var maxDesc = desc.length > 100 ? desc.slice(0, 100) + "…" : desc;
    return (
      '<div class="feature-list-item" data-feature-id="' + escHtml(item.id) + '" style="cursor:pointer" title="Click to view details">' +
        '<span class="feature-list-badge ' + escHtml(item.status) + '">' + escHtml(item.status) + '</span>' +
        '<div class="feature-list-body">' +
          '<div class="feature-list-title">' + escHtml(maxDesc) + '</div>' +
          '<div class="feature-list-meta">' + escHtml(formatDate(item.completedAt)) + '</div>' +
          (item.summary ? '<div class="feature-list-summary">' + escHtml(item.summary.slice(0, 120)) + '</div>' : '') +
        '</div>' +
        '<span class="feature-list-cost">' + formatCost(item.totalCostUsd) + '</span>' +
      '</div>'
    );
  }).join("");
}

// ---------------------------------------------------------------------------
// Feature Detail Dialog
// ---------------------------------------------------------------------------

var featureDetailActiveTab = "details";
var _featureDetailData = null;

function openFeatureDetailDialog(id) {
  var overlay = document.getElementById("feature-detail-overlay");
  if (!overlay) return;
  overlay.style.display = "";
  featureDetailActiveTab = "details";
  setFeatureDetailTab("details");
  var body = document.getElementById("fd-body");
  if (body) body.innerHTML = '<div class="empty-state">Loading\u2026</div>';
  signedFetch("/api/features/" + encodeURIComponent(id))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      _featureDetailData = data;
      var titleEl = document.getElementById("fd-dialog-title");
      if (titleEl) {
        var t = data.title || data.description || data.id || "Feature Detail";
        titleEl.textContent = t.length > 70 ? t.slice(0, 70) + "\u2026" : t;
      }
      renderFeatureDetailContent(featureDetailActiveTab);
    })
    .catch(function () {
      if (body) body.innerHTML = '<div class="empty-state">(error loading feature)</div>';
    });
}

function closeFeatureDetailDialog() {
  var overlay = document.getElementById("feature-detail-overlay");
  if (overlay) overlay.style.display = "none";
  _featureDetailData = null;
}

function setFeatureDetailTab(tab) {
  featureDetailActiveTab = tab;
  var tabs = document.querySelectorAll(".fd-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute("data-tab") === tab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
  if (_featureDetailData) {
    renderFeatureDetailContent(tab);
  }
}

function renderFeatureDetailContent(tab) {
  var body = document.getElementById("fd-body");
  if (!body || !_featureDetailData) return;
  var d = _featureDetailData;
  if (tab === "details") {
    body.innerHTML = renderFdDetails(d);
  } else if (tab === "request") {
    body.innerHTML = renderFdRequest(d);
  } else if (tab === "plan") {
    body.innerHTML = renderFdPlan(d);
  } else if (tab === "files") {
    body.innerHTML = renderFdFiles(d);
  } else if (tab === "conversation") {
    body.innerHTML = renderFdConversation(d);
    if (typeof hljs !== "undefined") { hljs.highlightAll(); }
  } else if (tab === "git") {
    body.innerHTML = '<div class="empty-state">Loading git info\u2026</div>';
    signedFetch("/api/features/" + encodeURIComponent(d.id) + "/git")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (featureDetailActiveTab === "git") {
          body.innerHTML = data.error
            ? '<div class="empty-state">' + escHtml(data.error) + '</div>'
            : renderFdGit(data);
        }
      })
      .catch(function () {
        if (featureDetailActiveTab === "git") {
          body.innerHTML = '<div class="empty-state">(error loading git info)</div>';
        }
      });
  }
}

function fmtMs(ms) {
  if (!ms) return "\u2014";
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  var m = Math.floor(ms / 60000);
  return m + "m " + Math.round((ms % 60000) / 1000) + "s";
}

function fmtNum(n) {
  if (!n && n !== 0) return "\u2014";
  return Number(n).toLocaleString();
}

function renderFdDetails(d) {
  var rows = [
    ["Status", '<span class="feature-list-badge ' + escHtml(d.status || "unknown") + '">' + escHtml(d.status || "unknown") + '</span>'],
    ["Provider", escHtml(d.provider || "\u2014")],
    ["Model", escHtml(d.model || "\u2014")],
    ["Completed", escHtml(formatDate(d.completedAt))],
    ["Requested", escHtml(formatDate(d.requestedAt))],
    ["Duration", escHtml(fmtMs(d.executionTimeMs))],
    ["Turns", escHtml(String(d.numTurns ?? "\u2014"))],
    ["Cost", escHtml(formatCost(d.totalCostUsd))],
    ["Tokens In", escHtml(fmtNum(d.tokensIn))],
    ["Tokens Out", escHtml(fmtNum(d.tokensOut))],
    ["Cache Read", escHtml(fmtNum(d.cacheReadTokens))],
    ["Cache Write", escHtml(fmtNum(d.cacheWriteTokens))],
    ["Git Branch", escHtml(d.gitBranch || "\u2014")],
    ["Commit", d.gitCommitHash ? '<span style="font-family:monospace;font-size:11px">' + escHtml(d.gitCommitHash.slice(0, 8)) + '</span>' : "\u2014"],
  ];
  if (d.errorMessage) {
    rows.push(["Error", '<span style="color:#EF4444">' + escHtml(d.errorMessage) + '</span>']);
  }
  var grid = rows.map(function (r) {
    return '<div class="fd-detail-item">' +
      '<span class="fd-detail-label">' + r[0] + '</span>' +
      '<span class="fd-detail-value">' + r[1] + '</span>' +
      '</div>';
  }).join("");
  return '<div class="fd-detail-grid">' + grid + '</div>';
}

function renderFdRequest(d) {
  var text = d.description || "(no description)";
  return '<pre class="fd-pre">' + escHtml(text) + '</pre>';
}

function renderFdPlan(d) {
  var points = d.planPoints;
  if (!points || points.length === 0) {
    return '<div class="empty-state">(no plan recorded)</div>';
  }
  var items = points.map(function (p, i) {
    return '<li class="fd-plan-item">' +
      '<span class="fd-plan-num">' + (i + 1) + '.</span>' +
      '<span>' + escHtml(String(p)) + '</span>' +
      '</li>';
  }).join("");
  return '<ol class="fd-plan-list">' + items + '</ol>';
}

function renderFdFiles(d) {
  var files = d.filesChanged;
  if (!files || files.length === 0) {
    return '<div class="empty-state">(no file changes recorded)</div>';
  }
  var items = files.map(function (f) {
    return '<li class="fd-file-item">' + escHtml(String(f)) + '</li>';
  }).join("");
  return '<ul class="fd-file-list">' + items + '</ul>';
}

function renderFdConversation(d) {
  var items = d.conversationHistory;
  if (!items || items.length === 0) {
    return '<div class="empty-state">(no conversation recorded)</div>';
  }

  var html = '<div class="fd-conv-list">' +
    ConversationBlockRenderer.renderAll(items, "history") +
    '</div>';

  // Follow-up input area for resuming the session from history
  if (d.sessionId) {
    html += '<div class="fd-followup-area" data-session-id="' + escHtml(d.sessionId) + '"' +
      ' data-feature-id="' + escHtml(d.id || "") + '">' +
      '<div class="fd-followup-inner">' +
        '<textarea class="fd-followup-textarea" rows="3"' +
          ' placeholder="Resume conversation\u2026 (Ctrl+Enter to send)"></textarea>' +
        '<div class="fd-followup-buttons">' +
          '<button class="fd-followup-send" title="Resume session and send (Ctrl+Enter)">Resume &amp; Send</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  return html;
}

// Matches LSP/protocol debug log lines: "HH:MM:SS.mmm instance_id=... [debug|info|warn]..."
var NOISE_LINE_RE = /^\d{2}:\d{2}:\d{2}\.\d+\s+\S*instance_id=/;

function isNoiseDiffLine(rawLine) {
  var content = rawLine.length > 1 ? rawLine.slice(1) : "";
  return NOISE_LINE_RE.test(content);
}

function renderFdGit(data) {
  var stat = data.show || "";
  var diff = data.diff || "";

  // Split diff into per-file sections so we can drop entirely-noise sections
  var lines = diff.split("\n");
  var sections = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.startsWith("diff --git")) {
      current = { header: [line], body: [] };
      sections.push(current);
    } else if (current) {
      if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") ||
          line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("@@")) {
        current.header.push(line);
      } else {
        current.body.push(line);
      }
    }
  }

  // Drop sections where every changed line is noise; strip individual noise lines from the rest
  var filteredLines = [];
  var skippedCount = 0;

  sections.forEach(function (section) {
    var changedLines = section.body.filter(function (l) { return l.startsWith("+") || l.startsWith("-"); });
    if (changedLines.length > 0 && changedLines.every(isNoiseDiffLine)) {
      skippedCount++;
      return;
    }
    var filteredBody = section.body.filter(function (l) {
      return !((l.startsWith("+") || l.startsWith("-")) && isNoiseDiffLine(l));
    });
    section.header.concat(filteredBody).forEach(function (l) { filteredLines.push(l); });
  });

  var diffHtml = filteredLines.map(function (line) {
    var cls = "plain";
    if (line.startsWith("diff --git") || line.startsWith("--- ") || line.startsWith("+++ ") ||
        line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) {
      cls = "file";
    } else if (line.startsWith("@@")) {
      cls = "hunk";
    } else if (line.startsWith("+")) {
      cls = "add";
    } else if (line.startsWith("-")) {
      cls = "remove";
    }
    return '<span class="fd-diff-line ' + cls + '">' + escHtml(line) + '</span>';
  }).join("");

  var skipNote = skippedCount > 0
    ? '<div class="fd-git-skip-note">' + skippedCount + ' log/protocol file' + (skippedCount > 1 ? 's' : '') + ' omitted</div>'
    : '';

  return '<pre class="fd-git-stat">' + escHtml(stat) + '</pre>' +
    skipNote +
    '<pre class="fd-git-diff">' + diffHtml + '</pre>';
}

// ---------------------------------------------------------------------------
// Follow-up session helpers
// ---------------------------------------------------------------------------

function sendFollowupMessage() {
  var featureId = state.followupFeatureId;
  if (!featureId) return;
  var textarea = document.getElementById("followup-textarea");
  if (!textarea) return;
  var message = textarea.value.trim();
  if (!message) return;

  // Clear the input immediately
  textarea.value = "";

  // Send via WebSocket
  signedWsSend({ type: "feature-followup", featureId: featureId, message: message });
}

function closeFollowupSession() {
  var featureId = state.followupFeatureId;
  if (!featureId) return;
  signedWsSend({ type: "feature-close", featureId: featureId });
  // Hide the input immediately (server will broadcast state update too)
  var followupArea = document.getElementById("followup-input-area");
  if (followupArea) followupArea.style.display = "none";
}

// ---------------------------------------------------------------------------
// Clarification modal — shown when the agent needs a user response
// ---------------------------------------------------------------------------

var _clarifyModal = null;

function showClarifyModal(question) {
  // Only one clarify modal at a time
  if (_clarifyModal) return;

  var TIMEOUT_SEC = 60;
  var remaining = TIMEOUT_SEC;
  var timerInterval = null;
  var userStartedTyping = false;

  var overlay = document.createElement("div");
  overlay.className = "clarify-overlay";
  overlay.id = "clarify-overlay";

  overlay.innerHTML =
    '<div class="clarify-modal">' +
      '<div class="clarify-header">' +
        '<span class="clarify-icon">&#x2753;</span>' +
        '<span class="clarify-title">Agent needs clarification</span>' +
        '<span class="clarify-countdown" id="clarify-countdown">' + remaining + 's</span>' +
      '</div>' +
      '<div class="clarify-question" id="clarify-question-text"></div>' +
      '<textarea class="clarify-textarea" id="clarify-textarea" rows="4"' +
        ' placeholder="Type your answer here\u2026"></textarea>' +
      '<div class="clarify-actions">' +
        '<button class="clarify-send-btn" id="clarify-send-btn">Send Answer</button>' +
        '<button class="clarify-skip-btn" id="clarify-skip-btn">Skip (use best judgement)</button>' +
      '</div>' +
    '</div>';

  // Set question text safely
  overlay.querySelector("#clarify-question-text").textContent = question;

  document.body.appendChild(overlay);
  _clarifyModal = overlay;

  var textarea = overlay.querySelector("#clarify-textarea");
  var countdownEl = overlay.querySelector("#clarify-countdown");
  var sendBtn = overlay.querySelector("#clarify-send-btn");
  var skipBtn = overlay.querySelector("#clarify-skip-btn");

  function sendAnswer(answer) {
    clearInterval(timerInterval);
    signedWsSend({ type: "clarify-response", answer: answer });
    closeClarifyModal();
  }

  // Countdown tick
  timerInterval = setInterval(function () {
    if (userStartedTyping) return;
    remaining -= 1;
    if (countdownEl) countdownEl.textContent = remaining + "s";
    if (remaining <= 0) {
      clearInterval(timerInterval);
      closeClarifyModal(); // server timeout fires its own fallback
    }
  }, 1000);

  // Typing clears the countdown
  textarea.addEventListener("input", function () {
    if (!userStartedTyping) {
      userStartedTyping = true;
      clearInterval(timerInterval);
      if (countdownEl) countdownEl.style.display = "none";
    }
  });

  // Ctrl+Enter sends
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      var answer = textarea.value.trim();
      if (answer) sendAnswer(answer);
    }
  });

  sendBtn.addEventListener("click", function () {
    var answer = textarea.value.trim();
    if (answer) sendAnswer(answer);
  });

  skipBtn.addEventListener("click", function () {
    clearInterval(timerInterval);
    closeClarifyModal(); // server will use fallback since no clarify-response sent
  });

  // Focus textarea
  setTimeout(function () { textarea.focus(); }, 50);
}

function closeClarifyModal() {
  if (_clarifyModal) {
    _clarifyModal.remove();
    _clarifyModal = null;
  }
}

// ---------------------------------------------------------------------------
// Feature-assist clarification modal — shown when the AI needs answers before
// it can write a full feature spec (separate from the agent CLARIFY flow)
// ---------------------------------------------------------------------------

function showNfClarifyModal(questions, onSubmit) {
  var overlay = document.createElement("div");
  overlay.className = "clarify-overlay";

  overlay.innerHTML =
    '<div class="clarify-modal">' +
      '<div class="clarify-header">' +
        '<span class="clarify-icon">&#x2753;</span>' +
        '<span class="clarify-title">Assistant needs clarification</span>' +
      '</div>' +
      '<div class="clarify-question" id="nf-clarify-q"></div>' +
      '<textarea class="clarify-textarea" id="nf-clarify-textarea" rows="5"' +
        ' placeholder="Type your answers here\u2026"></textarea>' +
      '<div class="clarify-actions">' +
        '<button class="clarify-send-btn" id="nf-clarify-send">Submit Answers</button>' +
        '<button class="clarify-skip-btn" id="nf-clarify-cancel">Cancel</button>' +
      '</div>' +
    '</div>';

  overlay.querySelector("#nf-clarify-q").textContent = questions;
  document.body.appendChild(overlay);

  var textarea = overlay.querySelector("#nf-clarify-textarea");

  function close() { overlay.remove(); }

  function send() {
    var answers = textarea.value.trim();
    if (!answers) return;
    close();
    onSubmit(answers);
  }

  overlay.querySelector("#nf-clarify-send").addEventListener("click", send);
  overlay.querySelector("#nf-clarify-cancel").addEventListener("click", close);

  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });

  setTimeout(function () { textarea.focus(); }, 50);
}

// ---------------------------------------------------------------------------
// Feature detail — resume session follow-up
// ---------------------------------------------------------------------------

function sendFdResumeMessage() {
  var area = document.querySelector(".fd-followup-area");
  if (!area) return;
  var sessionId = area.getAttribute("data-session-id");
  var featureId = area.getAttribute("data-feature-id");
  var textarea = area.querySelector(".fd-followup-textarea");
  if (!textarea || !sessionId || !featureId) return;
  var message = textarea.value.trim();
  if (!message) return;

  // Clear input and disable send button while processing
  textarea.value = "";
  var sendBtn = area.querySelector(".fd-followup-send");
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending\u2026";
  }

  // Send resume request via WebSocket
  signedWsSend({ type: "feature-resume", featureId: featureId, sessionId: sessionId, message: message })
    .then(function () {
      // Close the feature detail dialog and switch to dashboard to see the live conversation
      closeFeatureDetailDialog();
      showDashboardView();
    });
}

function loadFeaturesData() {
  var $pending = document.getElementById("pending-content");
  var $hold = document.getElementById("hold-content");
  var $complete = document.getElementById("complete-features-content");

  if ($pending) $pending.innerHTML = '<div class="empty-state">Loading…</div>';
  if ($hold) $hold.innerHTML = '<div class="empty-state">Loading…</div>';
  if ($complete) $complete.innerHTML = '<div class="empty-state">Loading…</div>';

  signedFetch("/api/features")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if ($pending) $pending.innerHTML = renderPendingFeatures(data.pending);
      if ($hold) {
        $hold.innerHTML = renderHoldFeatures(data.pending);
        wireHoldDragAndDrop($hold, $pending);
      }
      if ($complete) $complete.innerHTML = renderCompleteFeatures(data.complete);
    })
    .catch(function () {
      if ($pending) $pending.innerHTML = '<div class="empty-state">(error loading features)</div>';
      if ($hold) $hold.innerHTML = '<div class="empty-state">(error loading features)</div>';
      if ($complete) $complete.innerHTML = '<div class="empty-state">(error loading features)</div>';
    });
}

function wireHoldDragAndDrop($holdContent, $pendingContent) {
  // Wire drag start on each hold item
  var items = $holdContent.querySelectorAll(".feature-list-item[draggable]");
  for (var i = 0; i < items.length; i++) {
    items[i].addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", this.getAttribute("data-filename"));
      e.dataTransfer.effectAllowed = "move";
    });
  }

  // Wire drop target on the pending panel content
  if (!$pendingContent) return;

  $pendingContent.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    $pendingContent.classList.add("drag-over");
  });

  $pendingContent.addEventListener("dragleave", function (e) {
    if (!$pendingContent.contains(e.relatedTarget)) {
      $pendingContent.classList.remove("drag-over");
    }
  });

  $pendingContent.addEventListener("drop", function (e) {
    e.preventDefault();
    $pendingContent.classList.remove("drag-over");
    var filename = e.dataTransfer.getData("text/plain");
    if (!filename) return;
    signedFetch("/api/features/move-to-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: filename }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          loadFeaturesData();
        }
      })
      .catch(function () {});
  });
}

// ---------------------------------------------------------------------------
// Working / Busy Dialog
// ---------------------------------------------------------------------------

var workingPhraseInterval = null;

var workingPhrases = [
  "Thinking hard…",
  "Updating the rule book…",
  "Learning to spell…",
  "Reticulating splines…",
  "Consulting the oracle…",
  "Untangling spaghetti code…",
  "Polishing the pixels…",
  "Feeding the hamsters…",
  "Calibrating the flux capacitor…",
  "Asking the rubber duck…",
  "Herding semicolons…",
  "Compiling excuses…",
  "Warming up the neurons…",
  "Counting backwards from infinity…",
  "Reversing the polarity…",
  "Aligning the stars…",
  "Waking up the interns…",
  "Consulting Stack Overflow…",
  "Googling the answer…",
  "Downloading more RAM…",
  "Defragmenting the cloud…",
  "Refactoring the universe…",
  "Optimizing the hamster wheel…",
  "Spinning up the flux drive…",
  "Rebooting the imagination…",
  "Summoning the code wizards…",
  "Negotiating with the compiler…",
  "Bribing the linter…",
  "Teaching robots to dream…",
  "Generating synthetic enthusiasm…",
  "Resolving merge conflicts in the space-time continuum…",
  "Asking ChatGPT for a second opinion…",
  "Translating to binary and back…",
  "Debugging the meaning of life…",
  "Searching for missing semicolons…",
  "Reorganizing the bit bucket…",
  "Tuning the hyperparameters…",
  "Feeding tokens to the model…",
  "Adjusting the reality distortion field…",
  "Recalibrating the sarcasm detector…",
  "Shuffling the deck chairs…",
  "Poking the API with a stick…",
  "Painting invisible pixels…",
  "Charging the creativity capacitor…",
  "Running on pure vibes…",
  "Converting caffeine to code…",
  "Wrangling the syntax tree…",
  "Massaging the data…",
  "Consulting the ancient scrolls…",
  "Performing arcane computations…",
  "Channeling the spirit of Turing…",
  "Rotating the endofunctor…",
  "Unwrapping the monads…",
  "Traversing the abstract syntax tree…",
  "Shaking the magic 8-ball…",
  "Reading the tea leaves…",
  "Phoning a friend…",
  "Waiting for inspiration to strike…",
  "Doing the robot dance…",
  "Stretching the imagination…",
  "Building a pillow fort for ideas…",
  "Herding cats…",
  "Sorting the unsortable…",
  "Dividing by almost zero…",
  "Measuring the immeasurable…",
  "Contemplating the void…",
  "Staring into the abyss of code…",
  "Asking for directions…",
  "Rearranging deck chairs on the Titanic…",
  "Polishing the crystal ball…",
  "Making it up as we go…",
  "Consulting the committee…",
  "Arguing with the type checker…",
  "Questioning life choices…",
  "Pretending to be productive…",
  "Loading loading screen…",
  "Inventing new algorithms…",
  "Folding the protein…",
  "Petting the Schrödinger's cat…",
  "Inflating the complexity bubble…",
  "Mining for insights…",
  "Constructing the answer matrix…",
  "Warming up the GPUs…",
  "Putting on the thinking cap…",
  "Consulting the hive mind…",
  "Running the gauntlet…",
  "Solving P vs NP real quick…",
  "Calculating the meaning of 42…",
  "Aligning the chakras…",
  "Brewing the secret sauce…",
  "Juggling priorities…",
  "Composing a symphony of bytes…",
  "Whispering to the electrons…",
  "Negotiating with entropy…",
  "Assembling the Avengers…",
  "Coaxing the bits into place…",
  "Painting by numbers…",
  "Knitting a sweater for the server…",
  "Watering the decision tree…",
  "Feeding the neural network…",
  "Rounding up the usual suspects…",
  "Checking under the couch cushions…",
];

function showWorkingDialog() {
  var overlay = document.getElementById("working-overlay");
  if (!overlay) return;
  overlay.style.display = "";

  var phraseEl = document.getElementById("working-phrase");
  var lastIndex = -1;

  function cyclePhrases() {
    if (!phraseEl) return;
    var idx;
    do {
      idx = Math.floor(Math.random() * workingPhrases.length);
    } while (idx === lastIndex && workingPhrases.length > 1);
    lastIndex = idx;
    phraseEl.style.opacity = "0";
    setTimeout(function () {
      phraseEl.textContent = workingPhrases[idx];
      phraseEl.style.opacity = "1";
    }, 200);
  }

  // Set initial phrase
  if (phraseEl) {
    var initIdx = Math.floor(Math.random() * workingPhrases.length);
    lastIndex = initIdx;
    phraseEl.textContent = workingPhrases[initIdx];
  }

  // Cycle every 3.5 seconds
  workingPhraseInterval = setInterval(cyclePhrases, 3500);
}

function hideWorkingDialog() {
  var overlay = document.getElementById("working-overlay");
  if (overlay) overlay.style.display = "none";
  if (workingPhraseInterval) {
    clearInterval(workingPhraseInterval);
    workingPhraseInterval = null;
  }
}

// ---------------------------------------------------------------------------
// New Feature Dialog
// ---------------------------------------------------------------------------

var newFeatureDialogOpen = false;
var _editingHoldFilename = null;  // filename of hold feature being edited
var _editingFeatureId = null;     // Feature ID string preserved across edits

function openNewFeatureDialog() {
  var overlay = document.getElementById("new-feature-overlay");
  if (!overlay || newFeatureDialogOpen) return;

  newFeatureDialogOpen = true;
  overlay.style.display = "";

  initNFEditor();

  var titleInput = document.getElementById("nf-title");
  var errorEl = document.getElementById("nf-error");

  // Reset fields
  if (titleInput) titleInput.value = "";
  if (nfAceEditor) nfAceEditor.setValue("", -1);
  if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

  // Focus the title input
  if (titleInput) setTimeout(function () { titleInput.focus(); }, 50);
}

function closeNewFeatureDialog() {
  var overlay = document.getElementById("new-feature-overlay");
  if (overlay) overlay.style.display = "none";
  newFeatureDialogOpen = false;
  if (_editingHoldFilename) {
    _editingHoldFilename = null;
    _editingFeatureId = null;
    var dialogTitle = document.getElementById("nf-dialog-title");
    var holdBtn = document.getElementById("nf-hold");
    var saveBtn = document.getElementById("nf-save");
    if (dialogTitle) dialogTitle.innerHTML = "&#x2728; New Feature";
    if (holdBtn) holdBtn.textContent = "Save to Backlog";
    if (saveBtn) saveBtn.textContent = "Save";
  }
}

function openHoldFeatureForEdit(filename) {
  signedFetch("/api/features/hold-file?filename=" + encodeURIComponent(filename))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) return;
      _editingHoldFilename = filename;
      _editingFeatureId = data.featureId || "";

      var overlay = document.getElementById("new-feature-overlay");
      if (!overlay || newFeatureDialogOpen) return;
      newFeatureDialogOpen = true;
      overlay.style.display = "";

      initNFEditor();

      var titleInput = document.getElementById("nf-title");
      var errorEl = document.getElementById("nf-error");
      var dialogTitle = document.getElementById("nf-dialog-title");
      var holdBtn = document.getElementById("nf-hold");
      var saveBtn = document.getElementById("nf-save");

      if (titleInput) titleInput.value = data.title || "";
      if (nfAceEditor) nfAceEditor.setValue(data.body || "", -1);
      if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
      if (dialogTitle) dialogTitle.innerHTML = "&#x270F;&#xFE0F; Edit Feature";
      if (holdBtn) holdBtn.textContent = "Update Backlog";
      if (saveBtn) saveBtn.textContent = "Move to Pending";

      if (titleInput) setTimeout(function () { titleInput.focus(); }, 50);
    })
    .catch(function () {});
}

function submitNewFeature(hold) {
  var titleInput = document.getElementById("nf-title");
  var errorEl = document.getElementById("nf-error");
  var saveBtn = document.getElementById("nf-save");
  var holdBtn = document.getElementById("nf-hold");
  var assistBtn = document.getElementById("nf-assist");

  var title = titleInput ? titleInput.value.trim() : "";
  var description = nfAceEditor ? nfAceEditor.getValue().trim() : "";

  if (!title) {
    if (errorEl) {
      errorEl.textContent = "Title is required.";
      errorEl.style.display = "";
    }
    if (titleInput) titleInput.focus();
    return;
  }

  // Disable buttons during submission
  if (saveBtn) saveBtn.disabled = true;
  if (holdBtn) holdBtn.disabled = true;
  if (assistBtn) assistBtn.disabled = true;
  if (errorEl) errorEl.style.display = "none";

  var fetchPromise;
  if (_editingHoldFilename) {
    // Editing an existing hold feature — update in place or move to pending
    fetchPromise = signedFetch("/api/features/hold-file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: _editingHoldFilename,
        featureId: _editingFeatureId,
        title: title,
        description: description,
        moveToPending: !hold,
      }),
    });
  } else {
    // Creating a new feature
    fetchPromise = signedFetch("/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, description: description, hold: !!hold }),
    });
  }

  fetchPromise
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.error || "Failed to save feature");
        });
      }
      return res.json();
    })
    .then(function () {
      closeNewFeatureDialog();
      if (currentView === "features") {
        loadFeaturesData();
      }
    })
    .catch(function (err) {
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to save feature";
        errorEl.style.display = "";
      }
    })
    .finally(function () {
      if (saveBtn) saveBtn.disabled = false;
      if (holdBtn) holdBtn.disabled = false;
      if (assistBtn) assistBtn.disabled = false;
    });
}

function submitToAssistant() {
  var titleInput = document.getElementById("nf-title");
  var errorEl = document.getElementById("nf-error");

  var title = titleInput ? titleInput.value.trim() : "";
  var description = nfAceEditor ? nfAceEditor.getValue().trim() : "";

  if (!title) {
    if (errorEl) {
      errorEl.textContent = "Title is required.";
      errorEl.style.display = "";
    }
    if (titleInput) titleInput.focus();
    return;
  }

  runFeatureAssist(title, description);
}

function runFeatureAssist(title, description) {
  var titleInput = document.getElementById("nf-title");
  var errorEl = document.getElementById("nf-error");
  var saveBtn = document.getElementById("nf-save");
  var holdBtn = document.getElementById("nf-hold");
  var assistBtn = document.getElementById("nf-assist");

  if (saveBtn) saveBtn.disabled = true;
  if (holdBtn) holdBtn.disabled = true;
  if (assistBtn) { assistBtn.disabled = true; assistBtn.textContent = "Working\u2026"; }
  if (errorEl) errorEl.style.display = "none";

  showWorkingDialog();

  signedFetch("/api/features/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title, description: description }),
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.error || "Failed to get assistant response");
        });
      }
      return res.json();
    })
    .then(function (data) {
      // Use the possibly-refined title for any re-submission
      var currentTitle = title;
      if (data.title && titleInput) {
        titleInput.value = data.title;
        currentTitle = data.title;
      }
      if (data.description && nfAceEditor) {
        nfAceEditor.setValue(data.description, -1);
      }
      if (data.clarify) {
        // Show interactive clarification modal instead of dumping text into the error div
        showNfClarifyModal(data.clarify, function (answers) {
          var augmented = (description ? description + "\n\n" : "") +
            "## Clarification\n\n**Questions:**\n" + data.clarify +
            "\n\n**Answers:**\n" + answers;
          runFeatureAssist(currentTitle, augmented);
        });
      }
    })
    .catch(function (err) {
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to get assistant response";
        errorEl.style.display = "";
      }
    })
    .finally(function () {
      hideWorkingDialog();
      if (saveBtn) saveBtn.disabled = false;
      if (holdBtn) holdBtn.disabled = false;
      if (assistBtn) { assistBtn.disabled = false; assistBtn.textContent = "Submit to Assistant"; }
    });
}

// Markdown toolbar actions
function applyMarkdownAction(textarea, action) {
  if (!textarea) return;

  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  var text = textarea.value;
  var selected = text.slice(start, end);
  var before = text.slice(0, start);
  var after = text.slice(end);
  var replacement = "";
  var cursorOffset = 0;

  switch (action) {
    case "bold":
      replacement = "**" + (selected || "bold text") + "**";
      cursorOffset = selected ? replacement.length : 2;
      break;
    case "italic":
      replacement = "_" + (selected || "italic text") + "_";
      cursorOffset = selected ? replacement.length : 1;
      break;
    case "heading":
      replacement = "## " + (selected || "Heading");
      cursorOffset = selected ? replacement.length : 3;
      break;
    case "ul":
      replacement = "- " + (selected || "List item");
      cursorOffset = selected ? replacement.length : 2;
      break;
    case "ol":
      replacement = "1. " + (selected || "List item");
      cursorOffset = selected ? replacement.length : 3;
      break;
    case "code":
      if (selected && selected.indexOf("\n") >= 0) {
        replacement = "```\n" + selected + "\n```";
      } else {
        replacement = "`" + (selected || "code") + "`";
      }
      cursorOffset = selected ? replacement.length : 1;
      break;
    case "link":
      replacement = "[" + (selected || "link text") + "](url)";
      cursorOffset = selected ? replacement.length - 4 : 1;
      break;
    default:
      return;
  }

  textarea.value = before + replacement + after;
  textarea.focus();
  var newPos = start + cursorOffset;
  textarea.setSelectionRange(newPos, newPos);
}

// ---------------------------------------------------------------------------
// ANSI → HTML converter (handles basic color / bold escape codes)
// ---------------------------------------------------------------------------

function ansiToHtml(text) {
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  var fgColors = {
    "30": "#555", "31": "#f55", "32": "#5d5", "33": "#cc5",
    "34": "#77f", "35": "#c5c", "36": "#5cc", "37": "#ccc", "39": "",
    "90": "#888", "91": "#f88", "92": "#8f8", "93": "#ff8",
    "94": "#88f", "95": "#f8f", "96": "#8ff", "97": "#fff"
  };

  var result = "";
  var pos = 0;
  var openSpan = false;

  while (pos < text.length) {
    var code = text.charCodeAt(pos);

    // ESC character
    if (code === 27 && pos + 1 < text.length && text[pos + 1] === "[") {
      var end = -1;
      for (var i = pos + 2; i < text.length && i < pos + 20; i++) {
        var ch = text[i];
        if (ch === "m") { end = i; break; }
        if (!/[0-9;]/.test(ch)) break;
      }
      if (end !== -1) {
        // Close open span
        if (openSpan) { result += "</span>"; openSpan = false; }

        var params = text.slice(pos + 2, end);
        var codes = params === "" ? ["0"] : params.split(";");
        pos = end + 1;

        var isReset = codes.some(function (c) { return c === "0" || c === ""; });
        if (!isReset) {
          var styles = [];
          for (var ci = 0; ci < codes.length; ci++) {
            var c = codes[ci];
            if (c === "1") styles.push("font-weight:bold");
            else if (c === "3") styles.push("font-style:italic");
            else if (c === "4") styles.push("text-decoration:underline");
            else if (fgColors[c]) styles.push("color:" + fgColors[c]);
          }
          if (styles.length > 0) {
            result += '<span style="' + styles.join(";") + '">';
            openSpan = true;
          }
        }
        continue;
      }
      // Unrecognised escape — skip ESC and the [
      pos += 2;
      while (pos < text.length && !/[A-Za-z]/.test(text[pos])) pos++;
      if (pos < text.length) pos++;
      continue;
    }

    // Regular character — HTML-escape
    var c2 = text[pos];
    if (c2 === "<") result += "&lt;";
    else if (c2 === ">") result += "&gt;";
    else if (c2 === "&") result += "&amp;";
    else result += c2;
    pos++;
  }

  if (openSpan) result += "</span>";
  return result;
}

// ---------------------------------------------------------------------------
// npm commands — state & data
// ---------------------------------------------------------------------------

var npmScripts = [];           // { name, command }[]
var npmScriptInfos = {};       // { [name]: { status, exitCode } }
var activeCommandScript = null; // currently shown script name
var npmMode = false;            // ! hotkey mode

function enterNpmMode() {
  npmMode = true;
  var nav = document.getElementById("side-nav");
  if (nav) nav.classList.add("npm-mode");
}

function exitNpmMode() {
  npmMode = false;
  var nav = document.getElementById("side-nav");
  if (nav) nav.classList.remove("npm-mode");
}

function loadNpmScripts() {
  signedFetch("/api/npm-scripts")
    .then(function (res) { return res.json(); })
    .then(function (scripts) {
      npmScripts = scripts || [];
      renderNpmCommandsList();
    })
    .catch(function () {
      npmScripts = [];
    });
}

function renderNpmCommandsList() {
  var list = document.getElementById("npm-commands-list");
  if (!list) return;

  if (npmScripts.length === 0) {
    list.innerHTML = '<li style="padding:6px 20px;font-size:11px;color:#6B7280;font-style:italic">(none)</li>';
    return;
  }

  list.innerHTML = npmScripts.map(function (script, idx) {
    var info = npmScriptInfos[script.name] || {};
    var status = info.status || "idle";
    var isActive = activeCommandScript === script.name;
    var numLabel = idx < 9 ? (idx + 1) : "";

    return (
      '<li class="npm-cmd-item' + (isActive ? " active" : "") + '"' +
        ' data-script="' + escHtml(script.name) + '">' +
        (numLabel ? '<span class="npm-cmd-num">' + numLabel + "</span>" : '<span class="npm-cmd-num"></span>') +
        '<span class="npm-cmd-name">npm run ' + escHtml(script.name) + "</span>" +
        '<span class="npm-cmd-indicator ' + (status !== "idle" ? status : "") + '"></span>' +
      "</li>"
    );
  }).join("");
}

function updateNpmCommandsListActive(scriptName) {
  activeCommandScript = scriptName;
  var items = document.querySelectorAll(".npm-cmd-item");
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.getAttribute("data-script") === scriptName) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  }
}

function updateNpmCommandIndicator(scriptName) {
  var info = npmScriptInfos[scriptName] || {};
  var status = info.status || "idle";
  var items = document.querySelectorAll(".npm-cmd-item");
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.getAttribute("data-script") === scriptName) {
      var ind = item.querySelector(".npm-cmd-indicator");
      if (ind) {
        ind.className = "npm-cmd-indicator" + (status !== "idle" ? " " + status : "");
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Command view
// ---------------------------------------------------------------------------

function updateCommandStatusBadge(status) {
  var badge = document.getElementById("command-status-badge");
  if (!badge) return;
  badge.textContent = status;
  badge.className = "npm-run-badge npm-run-" + (status || "idle");
}

function showCommandView(scriptName) {
  hideAllViews();
  var commandView = document.getElementById("command-view");
  if (commandView) commandView.style.display = "";
  currentView = "command";
  activeCommandScript = scriptName;
  updateNpmCommandsListActive(scriptName);

  // Update toolbar title
  var titleEl = document.getElementById("command-title");
  if (titleEl) titleEl.textContent = "npm run " + scriptName;

  // Fetch existing buffered output
  var outputEl = document.getElementById("command-output");
  if (outputEl) outputEl.innerHTML = "";

  signedFetch("/api/npm-scripts/" + encodeURIComponent(scriptName) + "/output")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var info = data.info || {};
      npmScriptInfos[scriptName] = info;
      updateCommandStatusBadge(info.status || "idle");
      updateNpmCommandIndicator(scriptName);

      if (outputEl && data.output) {
        outputEl.innerHTML = ansiToHtml(data.output);
        var terminal = document.getElementById("command-terminal");
        if (terminal) terminal.scrollTop = terminal.scrollHeight;
      }

      // Start automatically if this script has never been run
      if (!info.status || info.status === "idle") {
        signedWsSend({ type: "npm-start", script: scriptName });
      }
    })
    .catch(function () {
      updateCommandStatusBadge("idle");
      // Try to start anyway
      signedWsSend({ type: "npm-start", script: scriptName });
    });
}

// Handle incoming npm WebSocket messages
function handleNpmMessage(msg) {
  if (msg.type === "npm-output") {
    var script = msg.script;
    var chunk = msg.chunk || "";
    // Append to terminal if this script is currently displayed
    if (activeCommandScript === script) {
      var outputEl = document.getElementById("command-output");
      if (outputEl) {
        var span = document.createElement("span");
        span.innerHTML = ansiToHtml(chunk);
        outputEl.appendChild(span);
        var terminal = document.getElementById("command-terminal");
        if (terminal) {
          var isNearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 60;
          if (isNearBottom) terminal.scrollTop = terminal.scrollHeight;
        }
      }
    }
  }

  if (msg.type === "npm-status") {
    var info = { status: msg.status, exitCode: msg.exitCode };
    npmScriptInfos[msg.script] = info;
    updateNpmCommandIndicator(msg.script);
    if (activeCommandScript === msg.script) {
      updateCommandStatusBadge(msg.status);
    }
  }

  if (msg.type === "npm-clear") {
    npmScriptInfos[msg.script] = { status: "idle", exitCode: null };
    updateNpmCommandIndicator(msg.script);
    if (activeCommandScript === msg.script) {
      var outputEl2 = document.getElementById("command-output");
      if (outputEl2) outputEl2.innerHTML = "";
      updateCommandStatusBadge("idle");
    }
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", function (e) {
  // Ctrl+S in settings view — save current file
  if (currentView === "settings" && e.key === "s" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveSettingsFile();
    return;
  }

  // Ctrl+Enter in follow-up textarea — send message
  if (e.target && e.target.id === "followup-textarea" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendFollowupMessage();
    return;
  }

  // Ctrl+Enter in feature-detail resume textarea — send resume message
  if (e.target && e.target.classList && e.target.classList.contains("fd-followup-textarea") && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendFdResumeMessage();
    return;
  }

  // Close feature detail dialog on Escape
  var fdOverlayCheck = document.getElementById("feature-detail-overlay");
  if (fdOverlayCheck && fdOverlayCheck.style.display !== "none" && e.key === "Escape") {
    e.preventDefault();
    closeFeatureDetailDialog();
    return;
  }

  // Close new feature dialog on Escape
  if (newFeatureDialogOpen && e.key === "Escape") {
    e.preventDefault();
    closeNewFeatureDialog();
    return;
  }

  var themeOverlayCheck = document.getElementById("theme-browser-overlay");
  if (themeOverlayCheck && themeOverlayCheck.style.display !== "none" && e.key === "Escape") {
    e.preventDefault();
    closeThemeBrowser();
    return;
  }

  if (activePopup) return;
  if (newFeatureDialogOpen) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // npm mode: any key exits; 1-9 selects a script
  if (npmMode) {
    exitNpmMode();
    var num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      var script = npmScripts[num - 1];
      if (script) {
        e.preventDefault();
        showCommandView(script.name);
      }
    }
    return;
  }

  switch (e.key) {
    case "!":
      e.preventDefault();
      if (npmScripts.length > 0) enterNpmMode();
      break;
    case "*":
      e.preventDefault();
      showSettingsView();
      break;
    case "^":
      e.preventDefault();
      openCodeAssistMenu();
      break;
    default:
      switch (e.key.toLowerCase()) {
        case "d":
          e.preventDefault();
          showDashboardView();
          break;
        case "f":
          e.preventDefault();
          showFeaturesView();
          break;
        case "n":
          e.preventDefault();
          openNewFeatureDialog();
          break;
        case "m":
          e.preventDefault();
          openModelSelector();
          break;
        case "p":
          e.preventDefault();
          openProviderSelector();
          break;
      }
  }
});

document.addEventListener("click", function (e) {
  // Plan / File Operations / Changed Files tab switching
  var panelTab = e.target.closest ? e.target.closest("[data-panel-tab]") : null;
  if (panelTab) {
    var tabName = panelTab.getAttribute("data-panel-tab");
    if (tabName) switchPlanFileopsTab(tabName);
  }

  // Conversation panel dynamic tab switching
  var convTabClose = e.target.closest ? e.target.closest("[data-conv-tab-close]") : null;
  if (convTabClose) {
    e.stopPropagation();
    var closeKey = convTabClose.getAttribute("data-conv-tab-close");
    if (closeKey) closeConvDynamicTab(closeKey);
    return;
  }
  var convTab = e.target.closest ? e.target.closest("[data-conv-tab]") : null;
  if (convTab && !convTabClose) {
    var convKey = convTab.getAttribute("data-conv-tab");
    if (convKey) activateConvTab(convKey);
  }

  // Changed Files action buttons
  var cfBtn = e.target.closest ? e.target.closest("[data-cf-action]") : null;
  if (cfBtn) {
    var cfAction = cfBtn.getAttribute("data-cf-action");
    var cfPath   = cfBtn.getAttribute("data-cf-path");
    if (cfAction && cfPath) {
      // Switch to Processing view if not already there
      showProcessingView();
      openConvDynamicTab(cfAction, cfPath);
    }
    return;
  }

  var trigger = document.getElementById("model-trigger");
  if (trigger && trigger.contains(e.target)) {
    e.preventDefault();
    openModelSelector();
  }

  var providerTrigger = document.getElementById("provider-trigger");
  if (providerTrigger && providerTrigger.contains(e.target)) {
    e.preventDefault();
    openProviderSelector();
  }

  var projectTrigger = document.getElementById("project-trigger");
  if (projectTrigger && projectTrigger.contains(e.target)) {
    e.preventDefault();
    deselectProject();
  }

  var navDash = document.getElementById("nav-dashboard");
  if (navDash && navDash.contains(e.target)) {
    e.preventDefault();
    showDashboardView();
  }

  var navProcessing = document.getElementById("nav-processing");
  if (navProcessing && navProcessing.contains(e.target)) {
    e.preventDefault();
    showProcessingView();
  }

  var navFeatures = document.getElementById("nav-features");
  if (navFeatures && navFeatures.contains(e.target)) {
    e.preventDefault();
    showFeaturesView();
  }

  // New Feature nav item
  var navFeature = document.getElementById("nav-feature");
  if (navFeature && navFeature.contains(e.target)) {
    e.preventDefault();
    openNewFeatureDialog();
  }

  // Settings nav item
  var navSettings = document.getElementById("nav-settings");
  if (navSettings && navSettings.contains(e.target)) {
    e.preventDefault();
    showSettingsView();
  }

  // Code Assist nav item
  var navCodereview = document.getElementById("nav-codereview");
  if (navCodereview && navCodereview.contains(e.target)) {
    e.preventDefault();
    openCodeAssistMenu();
  }

  // TODO List nav item
  var navTodo = document.getElementById("nav-todo");
  if (navTodo && navTodo.contains(e.target)) {
    e.preventDefault();
    openTodoMenu();
  }

  // Settings tab clicks
  var settingsTab = e.target.closest ? e.target.closest(".settings-tab") : null;
  if (settingsTab) {
    var panelKey = settingsTab.getAttribute("data-panel");
    var fileKey = settingsTab.getAttribute("data-file");
    if (panelKey === "kaibot-settings") {
      selectKaiBotSettingsPanel();
    } else if (fileKey) {
      selectSettingsTab(fileKey);
    }
  }

  // Settings save button
  var saveBtn = document.getElementById("settings-save-btn");
  if (saveBtn && saveBtn.contains(e.target)) {
    saveSettingsFile();
  }

  var themeBrowseBtn = document.getElementById("theme-browse-btn");
  if (themeBrowseBtn && themeBrowseBtn.contains(e.target)) {
    openThemeBrowser();
  }

  var themeBrowserClose = document.getElementById("theme-browser-close");
  if (themeBrowserClose && themeBrowserClose.contains(e.target)) {
    closeThemeBrowser();
  }

  var themeBrowserOverlay = document.getElementById("theme-browser-overlay");
  if (themeBrowserOverlay && e.target === themeBrowserOverlay) {
    closeThemeBrowser();
  }

  var themeResetBtn = document.getElementById("theme-reset-btn");
  if (themeResetBtn && themeResetBtn.contains(e.target)) {
    resetThemeSelection();
  }

  var themeLoadMoreBtn = document.getElementById("theme-load-more-btn");
  if (themeLoadMoreBtn && themeLoadMoreBtn.contains(e.target)) {
    searchThemes(themeBrowserState.query || "", (themeBrowserState.page || 1) + 1, true);
    themeBrowserState.page = (themeBrowserState.page || 1) + 1;
  }

  var themeSelectBtn = e.target.closest ? e.target.closest(".theme-select-btn") : null;
  if (themeSelectBtn) {
    applyThemeSelectionById(themeSelectBtn.getAttribute("data-theme-id") || "");
  }

  // New Feature dialog — close button
  var nfClose = document.getElementById("nf-close");
  if (nfClose && nfClose.contains(e.target)) {
    closeNewFeatureDialog();
  }

  // New Feature dialog — overlay click to close
  var nfOverlay = document.getElementById("new-feature-overlay");
  if (nfOverlay && e.target === nfOverlay) {
    closeNewFeatureDialog();
  }

  // New Feature dialog — Save button
  var nfSave = document.getElementById("nf-save");
  if (nfSave && nfSave.contains(e.target)) {
    submitNewFeature(false);
  }

  // New Feature dialog — Hold (Save to Backlog) button
  var nfHold = document.getElementById("nf-hold");
  if (nfHold && nfHold.contains(e.target)) {
    submitNewFeature(true);
  }

  // New Feature dialog — Submit to Assistant button
  var nfAssist = document.getElementById("nf-assist");
  if (nfAssist && nfAssist.contains(e.target)) {
    submitToAssistant();
  }


  // npm command items in the side nav
  var npmItem = e.target.closest ? e.target.closest(".npm-cmd-item") : null;
  if (npmItem) {
    var scriptName = npmItem.getAttribute("data-script");
    if (scriptName) {
      e.preventDefault();
      exitNpmMode();
      showCommandView(scriptName);
    }
  }

  // Stop button
  var stopBtn = document.getElementById("cmd-stop-btn");
  if (stopBtn && stopBtn.contains(e.target)) {
    if (activeCommandScript) signedWsSend({ type: "npm-stop", script: activeCommandScript });
  }

  // Restart button
  var restartBtn = document.getElementById("cmd-restart-btn");
  if (restartBtn && restartBtn.contains(e.target)) {
    if (activeCommandScript) signedWsSend({ type: "npm-restart", script: activeCommandScript });
  }

  // Follow-up send button
  var followupSend = document.getElementById("followup-send-btn");
  if (followupSend && followupSend.contains(e.target)) {
    sendFollowupMessage();
  }

  // Follow-up close button
  var followupClose = document.getElementById("followup-close-btn");
  if (followupClose && followupClose.contains(e.target)) {
    closeFollowupSession();
  }

  // Feature detail dialog — close button
  var fdClose = document.getElementById("fd-close");
  if (fdClose && fdClose.contains(e.target)) {
    closeFeatureDetailDialog();
  }

  // Feature detail dialog — overlay click to close
  var fdOverlay = document.getElementById("feature-detail-overlay");
  if (fdOverlay && e.target === fdOverlay) {
    closeFeatureDetailDialog();
  }

  // Feature detail dialog — tab clicks
  var fdTab = e.target.closest ? e.target.closest(".fd-tab") : null;
  if (fdTab) {
    var tab = fdTab.getAttribute("data-tab");
    if (tab) setFeatureDetailTab(tab);
  }

  // Feature detail — resume send button
  var fdResumeBtn = e.target.closest ? e.target.closest(".fd-followup-send") : null;
  if (fdResumeBtn) {
    sendFdResumeMessage();
  }

  // Hold feature edit button
  var holdEditBtn = e.target.closest ? e.target.closest(".hold-edit-btn") : null;
  if (holdEditBtn) {
    e.stopPropagation();
    var editFilename = holdEditBtn.getAttribute("data-edit-filename");
    if (editFilename) openHoldFeatureForEdit(editFilename);
  }

  // Complete feature items — click to open detail
  var featureItem = e.target.closest ? e.target.closest("[data-feature-id]") : null;
  if (featureItem) {
    var fid = featureItem.getAttribute("data-feature-id");
    if (fid) openFeatureDetailDialog(fid);
  }
});

// KaiBot Settings toggles
document.addEventListener("change", function (e) {
  var toggle = e.target;
  if (toggle && toggle.id === "setting-matomo-enabled") {
    signedFetch("/api/global-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matomoEnabled: toggle.checked }),
    }).catch(function () {});
  }
});

document.addEventListener("input", function (e) {
  var input = e.target;
  if (input && input.id === "theme-search-input") {
    queueThemeSearch(input.value || "");
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

showWelcomeView();

signedFetch("/api/state")
  .then(function (res) { return res.json(); })
  .then(function (data) {
    state = Object.assign({}, state, data);
    // If a feature is already in progress when we load, go straight to processing view
    if (state.featureName !== null) {
      _prevFeatureName = state.featureName;
      showProcessingView();
    } else {
      // Refresh welcome content with the loaded state (welcomeText, etc.)
      if (currentView === "welcome") {
        var wc = document.getElementById("welcome-content");
        if (wc) wc.innerHTML = renderWelcomeContent();
      }
    }
    updateDOM();
  })
  .catch(function () {
    // State will arrive via WebSocket
  })
  .finally(function () {
    initResizeHandles();
    connectWebSocket();
    startRuntimeTimer();
    loadNpmScripts();
    loadTodoNavItem();
  });
