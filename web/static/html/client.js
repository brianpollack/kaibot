/* =========================================================================
   KaiBot Web UI — client.js
   Client-side JavaScript for WebSocket real-time updates and rc-dock panels.
   ========================================================================= */

"use strict";

// ---------------------------------------------------------------------------
// Global state (mirrors server-side UIState)
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
  statusMessage: "Connecting…",
  todaySpend: 0,
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $botStatus    = document.getElementById("bot-status");
const $projectDir   = document.getElementById("project-dir");
const $currentModel = document.getElementById("current-model");
const $todaySpend   = document.getElementById("today-spend");
const $statusMsg    = document.getElementById("status-message");
const $dockContainer = document.getElementById("dock-container");

// ---------------------------------------------------------------------------
// Panel rendering helpers
// ---------------------------------------------------------------------------

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Runtime timer — ticks every second to update the Feature Status panel
// ---------------------------------------------------------------------------

let runtimeTimer = null;

function startRuntimeTimer() {
  if (runtimeTimer) return;
  runtimeTimer = setInterval(function () {
    // Only re-render the feature-status panel if a feature is processing
    if (state.featureStartTime && dockLayout) {
      var tab = dockLayout.find("feature-status");
      if (tab) {
        dockLayout.updateTab("feature-status", null, true);
      }
    }
  }, 1000);
}

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

  // Feature name
  html += '<div class="status-section">';
  html += '<div class="status-label">Feature</div>';
  if (state.featureName) {
    html += '<div class="status-value feature-value">' + escHtml(state.featureName) + "</div>";
  } else {
    html += '<div class="status-value dim">No feature in progress</div>';
  }
  html += "</div>";

  // Stage
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

  // Runtime
  html += '<div class="status-section">';
  html += '<div class="status-label">Runtime</div>';
  html += '<div class="status-value runtime-value">' + formatElapsed(state.featureStartTime) + "</div>";
  html += "</div>";

  // Model
  html += '<div class="status-section">';
  html += '<div class="status-label">Model</div>';
  html += '<div class="status-value">' + escHtml(state.model || "—") + "</div>";
  html += "</div>";

  // Bot status
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

function renderThinkingContent() {
  const lines = state.thinkingLines;
  if (lines.length === 0) {
    return '<div class="empty-state">(no thinking output yet)</div>';
  }
  return lines
    .map((line) =>
      line
        ? '<div class="thinking-line">' + escHtml(line) + "</div>"
        : '<div class="thinking-line empty">&middot;</div>'
    )
    .join("");
}

function renderCommandsContent() {
  const cmds = state.commands;
  if (cmds.length === 0) {
    return '<div class="empty-state">(no commands yet)</div>';
  }
  return cmds
    .map(
      (cmd) =>
        '<div class="command-entry ' +
        (cmd.active ? "active" : "inactive") +
        '">' +
        escHtml(cmd.command) +
        "</div>"
    )
    .join("");
}

function renderFileOpsContent() {
  const ops = state.fileOps;
  if (ops.length === 0) {
    return '<div class="empty-state">(no file operations yet)</div>';
  }
  return ops
    .map(
      (op) =>
        '<div class="file-op">' +
        '<span class="file-op-type ' + op.type + '">' + op.type.toUpperCase() + "</span>" +
        '<span class="file-op-path">' + escHtml(op.path) + "</span>" +
        (op.preview
          ? '<span class="file-op-preview">' + escHtml(op.preview) + "</span>"
          : "") +
        "</div>"
    )
    .join("");
}

function renderPlanContent() {
  const lines = state.planLines;
  const isComplete = state.featureStage === "complete";

  let html = "";

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
      const cls = line.checked ? "checked" : "unchecked";
      const icon = line.checked ? "&#x2705;" : "&#x2B1C;";
      html +=
        '<div class="plan-step ' + cls + '">' +
        '<span class="plan-checkbox">' + icon + "</span>" +
        '<span class="plan-text">' + escHtml(line.text) + "</span>" +
        "</div>";
    });
  }

  if (isComplete) {
    html +=
      '<div class="plan-complete">' +
      '<div class="plan-complete-title">&#x1F389; Feature Complete</div>';
    if (state.planCostInfo) {
      html += '<div class="plan-cost">' + escHtml(state.planCostInfo) + "</div>";
    }
    html += "</div>";
  }

  return html;
}

// ---------------------------------------------------------------------------
// rc-dock layout setup
// ---------------------------------------------------------------------------

let dockLayout = null;

/** Tab content factory — returns a React element for each tab ID. */
function loadTab(tabData) {
  const id = tabData.id;
  let contentFn;

  switch (id) {
    case "feature-status":
      contentFn = renderFeatureStatusContent;
      break;
    case "thinking":
      contentFn = renderThinkingContent;
      break;
    case "commands":
      contentFn = renderCommandsContent;
      break;
    case "fileops":
      contentFn = renderFileOpsContent;
      break;
    case "plan":
      contentFn = renderPlanContent;
      break;
    default:
      contentFn = function () {
        return "<div>Unknown panel</div>";
      };
  }

  return {
    ...tabData,
    content: React.createElement(PanelWrapper, { id: id, renderFn: contentFn }),
  };
}

/** Simple React component wrapper that renders HTML content and re-renders on state changes. */
class PanelWrapper extends React.Component {
  constructor(props) {
    super(props);
    this._ref = React.createRef();
  }

  componentDidMount() {
    this._update();
  }

  componentDidUpdate() {
    this._update();
  }

  _update() {
    if (this._ref.current) {
      var el = this._ref.current;
      // Check if user is scrolled near the bottom before updating
      var isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      el.innerHTML = this.props.renderFn();
      // Auto-scroll to bottom for console-like panels if user was near bottom
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  render() {
    return React.createElement("div", {
      ref: this._ref,
      className: "panel-content",
      role: "region",
      "aria-label": this.props.id + " panel",
    });
  }
}

/** The default dock layout — four panels arranged in a split view. */
const defaultLayout = {
  dockbox: {
    mode: "horizontal",
    children: [
      {
        mode: "vertical",
        size: 600,
        children: [
          {
            tabs: [
              { id: "thinking", title: "\uD83D\uDCAD Thinking", closable: false },
            ],
            size: 400,
          },
          {
            mode: "horizontal",
            size: 300,
            children: [
              {
                tabs: [
                  { id: "commands", title: "\u26A1 Commands", closable: false },
                ],
                size: 300,
              },
              {
                tabs: [
                  { id: "fileops", title: "\uD83D\uDCC4 File Operations", closable: false },
                ],
                size: 300,
              },
            ],
          },
        ],
      },
      {
        mode: "vertical",
        size: 400,
        children: [
          {
            tabs: [
              { id: "feature-status", title: "\uD83D\uDCE1 Feature Status", closable: false },
            ],
            size: 200,
          },
          {
            tabs: [
              { id: "plan", title: "\uD83D\uDCCB Plan", closable: false },
            ],
            size: 400,
          },
        ],
      },
    ],
  },
};

function initDock() {
  if (!window.RcDock || !$dockContainer) return;

  const DockLayout = RcDock.DockLayout;

  const dockEl = React.createElement(DockLayout, {
    ref: function (r) {
      dockLayout = r;
    },
    defaultLayout: defaultLayout,
    loadTab: loadTab,
    style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  });

  ReactDOM.render(dockEl, $dockContainer);
}

// ---------------------------------------------------------------------------
// State update — DOM patching
// ---------------------------------------------------------------------------

function updateDOM() {
  // Status badge
  if ($botStatus) {
    $botStatus.textContent = state.status.toUpperCase();
    $botStatus.className = "badge badge-" + state.status;
  }

  // Header values
  if ($projectDir) $projectDir.textContent = state.projectDir;
  if ($currentModel) $currentModel.textContent = state.model;
  if ($todaySpend) $todaySpend.textContent = "$" + (state.todaySpend || 0).toFixed(2);

  // Status message
  if ($statusMsg) $statusMsg.textContent = state.statusMessage || " ";

  // Force rc-dock panels to re-render
  if (dockLayout) {
    // Touch each panel to trigger React re-render
    ["feature-status", "thinking", "commands", "fileops", "plan"].forEach(function (id) {
      const tab = dockLayout.find(id);
      if (tab) {
        dockLayout.updateTab(id, null, true);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = protocol + "//" + location.host + "/ws";

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
      const msg = JSON.parse(event.data);
      if (msg.type === "state") {
        state = { ...state, ...msg.data };
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

/**
 * PopupMenu — keyboard (1-9, arrows, Enter, Escape) and mouse compatible.
 * Items are numbered 1–9; arrow keys scroll if the list exceeds 9 items.
 *
 * Usage:
 *   showPopupMenu({
 *     items: [{ id: "foo", label: "Foo", description: "...", active: false }],
 *     anchorEl: document.getElementById("trigger"),
 *     onSelect: function(item) { ... },
 *     onClose: function() { ... },
 *   });
 */

let activePopup = null; // { el, onSelect, onClose, items, selectedIndex, scrollOffset }

function showPopupMenu(opts) {
  // Close any existing popup first
  closePopupMenu();

  var items = opts.items || [];
  var anchorEl = opts.anchorEl;
  var onSelect = opts.onSelect || function () {};
  var onClose = opts.onClose || function () {};

  // Create overlay
  var overlay = document.createElement("div");
  overlay.className = "popup-overlay";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closePopupMenu();
  });

  // Create menu container
  var menu = document.createElement("div");
  menu.className = "popup-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("tabindex", "-1");

  // Position near anchor
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
  menu.focus();
}

function renderPopupItems() {
  if (!activePopup) return;

  var menu = activePopup.menu;
  var items = activePopup.items;
  var selected = activePopup.selectedIndex;
  var maxVisible = 9;
  var scrollOffset = activePopup.scrollOffset;

  // Adjust scroll so selected item is visible
  if (selected < scrollOffset) {
    scrollOffset = selected;
  } else if (selected >= scrollOffset + maxVisible) {
    scrollOffset = selected - maxVisible + 1;
  }
  activePopup.scrollOffset = scrollOffset;

  var visibleItems = items.slice(scrollOffset, scrollOffset + maxVisible);
  var html = "";

  // Scroll-up indicator
  if (scrollOffset > 0) {
    html += '<div class="popup-scroll-indicator">▲ more</div>';
  }

  visibleItems.forEach(function (item, i) {
    var globalIndex = scrollOffset + i;
    var isSelected = globalIndex === selected;
    var keyNum = i + 1;
    var cls = "popup-item" + (isSelected ? " selected" : "") + (item.active ? " current" : "");

    html +=
      '<div class="' + cls + '" data-index="' + globalIndex + '" role="option"' +
      (isSelected ? ' aria-selected="true"' : "") + ">" +
      '<span class="popup-key">' + keyNum + "</span>" +
      '<span class="popup-label">' + escHtml(item.label) + "</span>";
    if (item.description) {
      html += '<span class="popup-desc">' + escHtml(item.description) + "</span>";
    }
    if (item.active) {
      html += '<span class="popup-active-badge">active</span>';
    }
    html += "</div>";
  });

  // Scroll-down indicator
  if (scrollOffset + maxVisible < items.length) {
    html += '<div class="popup-scroll-indicator">▼ more</div>';
  }

  menu.innerHTML = html;

  // Attach click handlers
  var itemEls = menu.querySelectorAll(".popup-item");
  itemEls.forEach(function (el) {
    el.addEventListener("click", function () {
      var idx = parseInt(el.getAttribute("data-index"), 10);
      if (!isNaN(idx) && idx >= 0 && idx < items.length) {
        activePopup.onSelect(items[idx]);
        closePopupMenu();
      }
    });
    el.addEventListener("mouseenter", function () {
      var idx = parseInt(el.getAttribute("data-index"), 10);
      if (!isNaN(idx)) {
        activePopup.selectedIndex = idx;
        renderPopupItems();
      }
    });
  });
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

// Global keydown handler for popup menu
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
        activePopup.selectedIndex > 0
          ? activePopup.selectedIndex - 1
          : items.length - 1;
      renderPopupItems();
      break;

    case "ArrowDown":
      e.preventDefault();
      activePopup.selectedIndex =
        activePopup.selectedIndex < items.length - 1
          ? activePopup.selectedIndex + 1
          : 0;
      renderPopupItems();
      break;

    case "Enter":
      e.preventDefault();
      if (items[activePopup.selectedIndex]) {
        activePopup.onSelect(items[activePopup.selectedIndex]);
        closePopupMenu();
      }
      break;

    default:
      // Number keys 1-9 select visible items
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
});

// ---------------------------------------------------------------------------
// Model Selector (uses PopupMenu)
// ---------------------------------------------------------------------------

var cachedModels = null;

function openModelSelector() {
  if (activePopup) return; // Already open

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

  // Use cached models or fetch fresh
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
        // Fallback: show current model only
        showWithModels([{ id: state.model, description: "Current model" }]);
      });
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", function (e) {
  // Don't intercept if popup is open (handled by popup keydown)
  if (activePopup) return;
  // Don't intercept if user is typing in an input
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case "d":
      // Dashboard — already on it
      e.preventDefault();
      break;
    case "m":
      e.preventDefault();
      openModelSelector();
      break;
    case "q":
      // Could send a quit command via WebSocket in the future
      break;
  }
});

// Click handler for model trigger in top bar
document.addEventListener("click", function (e) {
  var trigger = document.getElementById("model-trigger");
  if (trigger && trigger.contains(e.target)) {
    e.preventDefault();
    openModelSelector();
  }
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

// Fetch initial state, then set up WebSocket for live updates
fetch("/api/state")
  .then(function (res) {
    return res.json();
  })
  .then(function (data) {
    state = { ...state, ...data };
    updateDOM();
  })
  .catch(function () {
    // Will get state via WebSocket instead
  })
  .finally(function () {
    initDock();
    connectWebSocket();
    startRuntimeTimer();
  });
