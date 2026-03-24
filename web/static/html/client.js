/* =========================================================================
   KaiBot Web UI — client.js
   Client-side JavaScript for WebSocket real-time updates and dashboard panels.
   No external CDN dependencies — plain DOM manipulation only.
   ========================================================================= */

"use strict";

// ---------------------------------------------------------------------------
// Global state (mirrors server-side UIState / WebUIState)
// ---------------------------------------------------------------------------

let state = {
  status: "idle",
  projectDir: "",
  model: "",
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

      case "git":
        return (
          '<div class="conv-git">' +
            '<div class="conv-git-header">&#x1F4BE; git commit</div>' +
            '<pre class="conv-git-message">' + escHtml(item.content) + "</pre>" +
          "</div>"
        );

      case "system":
        return '<div class="conv-system">' + escHtml(item.content) + "</div>";

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
  if ($todaySpend) $todaySpend.textContent = "$" + (state.todaySpend || 0).toFixed(2);
  if ($statusMsg) $statusMsg.textContent = state.statusMessage || " ";

  updatePanelContent($conversationContent, renderConversationContent);
  updatePanelContent($fileopsContent,      renderFileOpsContent);
  updatePanelContent($statusContent,       renderFeatureStatusContent);
  updatePanelContent($planContent,         renderPlanContent);
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
        state = Object.assign({}, state, msg.data);
        updateDOM();
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
        if (item.id !== state.model && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "select-model", model: item.id }));
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
    fetch("/api/models")
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
// View switching — Dashboard vs Features
// ---------------------------------------------------------------------------

var currentView = "dashboard";

function showDashboardView() {
  var dock = document.getElementById("dock-container");
  var featuresView = document.getElementById("features-view");
  if (dock) dock.style.display = "";
  if (featuresView) featuresView.style.display = "none";
  currentView = "dashboard";

  // Update nav active states
  var navDash = document.getElementById("nav-dashboard");
  var navFeatures = document.getElementById("nav-features");
  if (navDash) navDash.classList.add("active");
  if (navFeatures) navFeatures.classList.remove("active");
}

function showFeaturesView() {
  var dock = document.getElementById("dock-container");
  var featuresView = document.getElementById("features-view");
  if (dock) dock.style.display = "none";
  if (featuresView) featuresView.style.display = "";
  currentView = "features";

  // Update nav active states
  var navDash = document.getElementById("nav-dashboard");
  var navFeatures = document.getElementById("nav-features");
  if (navDash) navDash.classList.remove("active");
  if (navFeatures) navFeatures.classList.add("active");

  // Load features data
  loadFeaturesData();
  makeDraggable("drag-features", "panel-pending", "vertical");
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

function renderCompleteFeatures(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-state">(no complete features)</div>';
  }
  return items.map(function (item) {
    var desc = item.description || item.summary || "";
    var maxDesc = desc.length > 100 ? desc.slice(0, 100) + "…" : desc;
    return (
      '<div class="feature-list-item">' +
        '<span class="feature-list-badge ' + escHtml(item.status) + '">' + escHtml(item.status) + '</span>' +
        '<div class="feature-list-body">' +
          '<div class="feature-list-title">' + escHtml(maxDesc) + '</div>' +
          '<div class="feature-list-meta">' + escHtml(formatDate(item.completedAt)) + '</div>' +
          (item.summary ? '<div class="feature-list-summary">' + escHtml(item.summary.slice(0, 120)) + '</div>' : '') +
        '</div>' +
      '</div>'
    );
  }).join("");
}

function loadFeaturesData() {
  var $pending = document.getElementById("pending-content");
  var $complete = document.getElementById("complete-features-content");

  if ($pending) $pending.innerHTML = '<div class="empty-state">Loading…</div>';
  if ($complete) $complete.innerHTML = '<div class="empty-state">Loading…</div>';

  fetch("/api/features")
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
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", function (e) {
  if (activePopup) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case "d":
      e.preventDefault();
      showDashboardView();
      break;
    case "f":
      e.preventDefault();
      showFeaturesView();
      break;
    case "n": {
      e.preventDefault();
      var navFeature = document.getElementById("nav-feature");
      if (navFeature) navFeature.click();
      break;
    }
    case "m":
      e.preventDefault();
      openModelSelector();
      break;
  }
});

document.addEventListener("click", function (e) {
  var trigger = document.getElementById("model-trigger");
  if (trigger && trigger.contains(e.target)) {
    e.preventDefault();
    openModelSelector();
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
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

fetch("/api/state")
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
  });
