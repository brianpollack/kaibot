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
      this._ref.current.innerHTML = this.props.renderFn();
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
        tabs: [
          { id: "plan", title: "\uD83D\uDCCB Plan", closable: false },
        ],
        size: 400,
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
    ["thinking", "commands", "fileops", "plan"].forEach(function (id) {
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
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener("keydown", function (e) {
  // Don't intercept if user is typing in an input
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key.toLowerCase()) {
    case "d":
      // Dashboard — already on it
      e.preventDefault();
      break;
    case "q":
      // Could send a quit command via WebSocket in the future
      break;
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
  });
