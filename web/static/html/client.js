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
  thinkingLines: [],
  commands: [],
  fileOps: [],
  planLines: [],
  planCostInfo: "",
  conversationItems: [],
  statusMessage: "Connecting…",
  todaySpend: 0,
  followupFeatureId: null,
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

// ---------------------------------------------------------------------------
// Conversation feed renderer
// ---------------------------------------------------------------------------

function renderConversationContent() {
  var items = state.conversationItems || [];
  if (items.length === 0) {
    return '<div class="empty-state">(waiting for feature processing…)</div>';
  }

  return items.map(function (item) {
    switch (item.type) {

      case "thinking": {
        // Render each line; blank lines become small spacers
        var lines = item.content.split("\n");
        var html = '<div class="conv-thinking">';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.trim()) {
            html += '<div class="conv-thinking-line">' + escHtml(line) + "</div>";
          } else {
            html += '<div class="conv-thinking-gap"></div>';
          }
        }
        html += "</div>";
        return html;
      }

      case "command": {
        var cls = "conv-command" + (item.active ? " active" : "");
        return (
          '<div class="' + cls + '">' +
            '<div class="conv-command-header">' +
              '<span>' + (item.active ? "▶" : "$") + "</span>" +
              (item.active ? '<span class="conv-command-running">running…</span>' : "") +
            "</div>" +
            '<pre class="conv-command-code">' + escHtml(item.content) + "</pre>" +
          "</div>"
        );
      }

      case "agent": {
        var agentType = item.agentType || "Agent";
        var agentDesc = item.agentDescription || "";
        return (
          '<div class="conv-agent">' +
            '<div class="conv-agent-header">' +
              '<img class="conv-agent-favicon" src="https://claude.ai/favicon.ico"' +
                ' alt="Claude" onerror="this.style.display=\'none\'">' +
              '<span class="conv-agent-type">' + escHtml(agentType) + "</span>" +
              (agentDesc
                ? '<span class="conv-agent-sep"> — </span>' +
                  '<span class="conv-agent-desc">' + escHtml(agentDesc) + "</span>"
                : "") +
            "</div>" +
            '<pre class="conv-agent-prompt">' + escHtml(item.content) + "</pre>" +
          "</div>"
        );
      }

      case "git":
        return (
          '<div class="conv-git">' +
            '<div class="conv-git-header">&#x1F4BE; git commit</div>' +
            '<pre class="conv-git-message">' + escHtml(item.content) + "</pre>" +
          "</div>"
        );

      case "system":
        return '<div class="conv-system">' + escHtml(item.content) + "</div>";

      case "user":
        return (
          '<div class="conv-user-row">' +
            '<div class="conv-user-bubble">' + escHtml(item.content) + '</div>' +
          '</div>'
        );

      case "file": {
        var fd = {};
        try { fd = JSON.parse(item.content); } catch (e) {}
        var fTool = (fd.tool || "file").toLowerCase();
        var fPath = fd.path || "";
        var inner = '<div class="conv-file-header">' +
          '<span class="conv-file-op ' + escHtml(fTool) + '">' + escHtml(fd.tool || "File") + '</span>' +
          '<span class="conv-file-path">' + escHtml(fPath) + '</span>' +
          '</div>';
        var hasBody = fd.old || fd.new || fd.preview;
        if (hasBody) {
          inner += '<div class="conv-file-body">';
          if (fd.old) {
            inner += '<div class="conv-file-section-label">replaced</div>' +
              '<div class="conv-file-snippet old">' + escHtml(fd.old) + '</div>';
          }
          if (fd.new) {
            inner += '<div class="conv-file-section-label">with</div>' +
              '<div class="conv-file-snippet new">' + escHtml(fd.new) + '</div>';
          }
          if (fd.preview) {
            inner += '<div class="conv-file-section-label">' + (fd.lines ? fd.lines + ' lines' : 'content') + '</div>' +
              '<div class="conv-file-snippet content">' + escHtml(fd.preview) + '</div>';
          }
          inner += '</div>';
        }
        return '<div class="conv-file">' + inner + '</div>';
      }

      default:
        return "";
    }
  }).join("");
}

// ---------------------------------------------------------------------------
// Feature status renderer
// ---------------------------------------------------------------------------

function formatElapsed(startTime) {
  if (!startTime) return "—";
  var elapsed = Math.floor((Date.now() - startTime) / 1000);
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
  html += '<div class="status-value runtime-value">' + formatElapsed(state.featureStartTime) + "</div>";
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
  if ($botStatus) {
    $botStatus.textContent = state.status.toUpperCase();
    $botStatus.className = "badge badge-" + state.status;
  }
  if ($projectDir) $projectDir.textContent = state.projectDir;
  if ($currentModel) $currentModel.textContent = state.model;
  var $currentProvider = document.getElementById("current-provider");
  if ($currentProvider) $currentProvider.textContent = state.provider === "openrouter" ? "OpenRouter" : "Anthropic";
  if ($todaySpend) $todaySpend.textContent = "$" + (state.todaySpend || 0).toFixed(2);
  if ($statusMsg) $statusMsg.textContent = state.statusMessage || " ";

  updatePanelContent($conversationContent, renderConversationContent);
  updatePanelContent($fileopsContent,      renderFileOpsContent);
  updatePanelContent($statusContent,       renderFeatureStatusContent);
  updatePanelContent($planContent,         renderPlanContent);

  // Show/hide follow-up input based on whether the agent is awaiting prompts
  var followupArea = document.getElementById("followup-input-area");
  if (followupArea) {
    followupArea.style.display = state.followupFeatureId ? "" : "none";
  }
  var followupTextarea = document.getElementById("followup-textarea");
  var followupSendBtn = document.getElementById("followup-send-btn");
  if (followupTextarea) followupTextarea.disabled = !state.followupFeatureId;
  if (followupSendBtn) followupSendBtn.disabled = !state.followupFeatureId;
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
  // File Operations height within right column
  makeDraggable("drag-fileops-plan", "panel-fileops", "vertical");
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
      } else if (msg.type === "npm-output" || msg.type === "npm-status" || msg.type === "npm-clear") {
        handleNpmMessage(msg);
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
// Code Review submenu
// ---------------------------------------------------------------------------

function openCodeReviewMenu() {
  if (activePopup) return;
  var trigger = document.getElementById("nav-codereview");
  showPopupMenu({
    items: [
      { id: "code-review", label: "1. Code Review", description: "Review recent code changes", key: "1" },
    ],
    anchorEl: trigger,
    onSelect: function (item) {
      if (item.id === "code-review") {
        startCodeReview();
      }
    },
    onClose: function () {},
  });
}

function startCodeReview() {
  // TODO: implement code review feature
  var navCodereview = document.getElementById("nav-codereview");
  if (navCodereview) navCodereview.classList.add("active");
}

// ---------------------------------------------------------------------------
// View switching — Dashboard / Features / Command / Settings
// ---------------------------------------------------------------------------

var currentView = "dashboard";

function hideAllViews() {
  var dock = document.getElementById("dock-container");
  var featuresView = document.getElementById("features-view");
  var commandView = document.getElementById("command-view");
  var settingsView = document.getElementById("settings-view");
  if (dock) dock.style.display = "none";
  if (featuresView) featuresView.style.display = "none";
  if (commandView) commandView.style.display = "none";
  if (settingsView) settingsView.style.display = "none";
  var navDash = document.getElementById("nav-dashboard");
  var navFeatures = document.getElementById("nav-features");
  var navSettings = document.getElementById("nav-settings");
  var navCodereview = document.getElementById("nav-codereview");
  if (navDash) navDash.classList.remove("active");
  if (navFeatures) navFeatures.classList.remove("active");
  if (navSettings) navSettings.classList.remove("active");
  if (navCodereview) navCodereview.classList.remove("active");
}

function showDashboardView() {
  hideAllViews();
  var dock = document.getElementById("dock-container");
  if (dock) dock.style.display = "";
  currentView = "dashboard";
  var navDash = document.getElementById("nav-dashboard");
  if (navDash) navDash.classList.add("active");
  updateNpmCommandsListActive(null);
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
  makeDraggable("drag-features", "panel-pending", "vertical");
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------

var settingsAceEditor = null;
var settingsCurrentFile = null;
var settingsDirtyFiles = {};
var settingsOriginalContent = {};
var settingsCurrentContent = {};

function showSettingsView() {
  hideAllViews();
  var settingsView = document.getElementById("settings-view");
  if (settingsView) settingsView.style.display = "";
  currentView = "settings";
  var navSettings = document.getElementById("nav-settings");
  if (navSettings) navSettings.classList.add("active");
  updateNpmCommandsListActive(null);
  initSettingsEditor();
  if (!settingsCurrentFile) {
    selectSettingsTab("CLAUDE.md");
  }
}

function initSettingsEditor() {
  if (settingsAceEditor) return;
  if (typeof ace === "undefined") return;
  settingsAceEditor = ace.edit("settings-editor");
  settingsAceEditor.setTheme("ace/theme/monokai");
  settingsAceEditor.session.setMode("ace/mode/markdown");
  settingsAceEditor.setOptions({
    fontSize: "13px",
    showLineNumbers: true,
    wrap: false,
  });
  settingsAceEditor.on("change", function () {
    if (!settingsCurrentFile) return;
    var curr = settingsAceEditor.getValue();
    var isDirty = curr !== (settingsOriginalContent[settingsCurrentFile] || "");
    settingsDirtyFiles[settingsCurrentFile] = isDirty;
    updateSettingsTabDirty(settingsCurrentFile, isDirty);
  });
}

function selectSettingsTab(filePath) {
  if (settingsCurrentFile && settingsAceEditor) {
    settingsCurrentContent[settingsCurrentFile] = settingsAceEditor.getValue();
  }
  settingsCurrentFile = filePath;
  document.querySelectorAll(".settings-tab").forEach(function (tab) {
    tab.classList.toggle("active", tab.getAttribute("data-file") === filePath);
  });
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
  if (!items || items.length === 0) {
    return '<div class="empty-state">(no pending features)</div>';
  }
  return items.map(function (item) {
    return (
      '<div class="feature-list-item">' +
        '<span class="feature-list-badge ' + escHtml(item.status) + '">' + escHtml(item.status) + '</span>' +
        '<div class="feature-list-body">' +
          '<div class="feature-list-title">' + escHtml(item.title) + '</div>' +
          '<div class="feature-list-meta">' + escHtml(item.filename) + '</div>' +
        '</div>' +
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

  function fmtTime(ts) {
    if (!ts) return "";
    try {
      var dt = new Date(ts);
      return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) { return ""; }
  }

  var html = items.map(function (item) {
    var type = item.type || "assistant";
    var label = type;
    if (type === "agent" && item.agentDescription) {
      label = "agent";
    }
    var header = '<div class="fd-conv-header">' +
      '<span class="fd-conv-badge ' + escHtml(type) + '">' + escHtml(label) + '</span>';
    if (type === "agent" && item.agentDescription) {
      header += '<span class="fd-conv-agent-desc">' + escHtml(item.agentDescription) + '</span>';
    }
    if (type === "file") {
      // Show file path inline in the header
      var ffd = {};
      try { ffd = JSON.parse(item.content || "{}"); } catch (e) {}
      if (ffd.path) {
        header += '<span class="fd-conv-badge ' + escHtml((ffd.tool || "file").toLowerCase()) + '" style="font-weight:400;text-transform:none;letter-spacing:0">' +
          escHtml(ffd.tool || "file") + '</span>';
        header += '<span class="fd-conv-file-path">' + escHtml(ffd.path) + '</span>';
      }
    }
    header += '<span class="fd-conv-time">' + escHtml(fmtTime(item.timestamp)) + '</span>';
    header += '</div>';

    var content;
    if (type === "file") {
      var ffd2 = {};
      try { ffd2 = JSON.parse(item.content || "{}"); } catch (e) {}
      content = '<div class="fd-conv-content file" style="padding:0">';
      if (ffd2.old) {
        content += '<div style="padding:3px 10px 1px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6B7280">replaced</div>';
        content += '<div class="fd-conv-file-snippet old">' + escHtml(ffd2.old) + '</div>';
      }
      if (ffd2.new) {
        content += '<div style="padding:3px 10px 1px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6B7280">with</div>';
        content += '<div class="fd-conv-file-snippet new">' + escHtml(ffd2.new) + '</div>';
      }
      if (ffd2.preview) {
        content += '<div style="padding:3px 10px 1px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#6B7280">' +
          (ffd2.lines ? ffd2.lines + ' lines' : 'content') + '</div>';
        content += '<div class="fd-conv-file-snippet content">' + escHtml(ffd2.preview) + '</div>';
      }
      if (!ffd2.old && !ffd2.new && !ffd2.preview) {
        content += '<div style="padding:6px 10px;color:#6B7280;font-size:11px">(no preview)</div>';
      }
      content += '</div>';
    } else {
      content = '<div class="fd-conv-content ' + escHtml(type) + '">' + escHtml(String(item.content || "")) + '</div>';
    }
    return '<div class="fd-conv-item">' + header + content + '</div>';
  }).join("");

  return '<div class="fd-conv-list">' + html + '</div>';
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

function loadFeaturesData() {
  var $pending = document.getElementById("pending-content");
  var $complete = document.getElementById("complete-features-content");

  if ($pending) $pending.innerHTML = '<div class="empty-state">Loading…</div>';
  if ($complete) $complete.innerHTML = '<div class="empty-state">Loading…</div>';

  signedFetch("/api/features")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if ($pending) $pending.innerHTML = renderPendingFeatures(data.pending);
      if ($complete) $complete.innerHTML = renderCompleteFeatures(data.complete);
    })
    .catch(function () {
      if ($pending) $pending.innerHTML = '<div class="empty-state">(error loading features)</div>';
      if ($complete) $complete.innerHTML = '<div class="empty-state">(error loading features)</div>';
    });
}

// ---------------------------------------------------------------------------
// New Feature Dialog
// ---------------------------------------------------------------------------

var newFeatureDialogOpen = false;

function openNewFeatureDialog() {
  var overlay = document.getElementById("new-feature-overlay");
  if (!overlay || newFeatureDialogOpen) return;

  newFeatureDialogOpen = true;
  overlay.style.display = "";

  var titleInput = document.getElementById("nf-title");
  var descInput = document.getElementById("nf-description");
  var errorEl = document.getElementById("nf-error");

  // Reset fields
  if (titleInput) titleInput.value = "";
  if (descInput) descInput.value = "";
  if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }

  // Focus the title input
  if (titleInput) setTimeout(function () { titleInput.focus(); }, 50);
}

function closeNewFeatureDialog() {
  var overlay = document.getElementById("new-feature-overlay");
  if (overlay) overlay.style.display = "none";
  newFeatureDialogOpen = false;
}

function submitNewFeature(hold) {
  var titleInput = document.getElementById("nf-title");
  var descInput = document.getElementById("nf-description");
  var errorEl = document.getElementById("nf-error");
  var saveBtn = document.getElementById("nf-save");
  var holdBtn = document.getElementById("nf-hold");

  var title = titleInput ? titleInput.value.trim() : "";
  var description = descInput ? descInput.value.trim() : "";

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
  if (errorEl) errorEl.style.display = "none";

  signedFetch("/api/features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: title, description: description, hold: !!hold }),
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.error || "Failed to create feature");
        });
      }
      return res.json();
    })
    .then(function () {
      closeNewFeatureDialog();
      // If we're on the features view, refresh the list
      if (currentView === "features") {
        loadFeaturesData();
      }
    })
    .catch(function (err) {
      if (errorEl) {
        errorEl.textContent = err.message || "Failed to create feature";
        errorEl.style.display = "";
      }
    })
    .finally(function () {
      if (saveBtn) saveBtn.disabled = false;
      if (holdBtn) holdBtn.disabled = false;
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
  // Ctrl+Enter in follow-up textarea — send message
  if (e.target && e.target.id === "followup-textarea" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendFollowupMessage();
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
      openCodeReviewMenu();
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

  var navDash = document.getElementById("nav-dashboard");
  if (navDash && navDash.contains(e.target)) {
    e.preventDefault();
    showDashboardView();
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

  // Code Review nav item
  var navCodereview = document.getElementById("nav-codereview");
  if (navCodereview && navCodereview.contains(e.target)) {
    e.preventDefault();
    openCodeReviewMenu();
  }

  // Settings tab clicks
  var settingsTab = e.target.closest ? e.target.closest(".settings-tab") : null;
  if (settingsTab) {
    var fileKey = settingsTab.getAttribute("data-file");
    if (fileKey) selectSettingsTab(fileKey);
  }

  // Settings save button
  var saveBtn = document.getElementById("settings-save-btn");
  if (saveBtn && saveBtn.contains(e.target)) {
    saveSettingsFile();
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

  // New Feature dialog — Hold button
  var nfHold = document.getElementById("nf-hold");
  if (nfHold && nfHold.contains(e.target)) {
    submitNewFeature(true);
  }

  // Markdown toolbar buttons
  var mdBtn = e.target.closest ? e.target.closest(".md-btn") : null;
  if (mdBtn) {
    var action = mdBtn.getAttribute("data-md");
    var textarea = document.getElementById("nf-description");
    if (action && textarea) {
      applyMarkdownAction(textarea, action);
    }
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

  // Complete feature items — click to open detail
  var featureItem = e.target.closest ? e.target.closest("[data-feature-id]") : null;
  if (featureItem) {
    var fid = featureItem.getAttribute("data-feature-id");
    if (fid) openFeatureDetailDialog(fid);
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

signedFetch("/api/state")
  .then(function (res) { return res.json(); })
  .then(function (data) {
    state = Object.assign({}, state, data);
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
  });
