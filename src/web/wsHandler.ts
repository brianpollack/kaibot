import type { WebSocket, WebSocketServer } from "ws";

import { uiStore, type UIState } from "../ui/store.js";
import { getTodaySpend } from "./spendTracker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the state object sent to browser clients. */
export interface WebUIState {
  status: UIState["status"];
  projectDir: string;
  model: string;
  featureName: string | null;
  featureStage: UIState["featureStage"];
  thinkingLines: string[];
  commands: UIState["commands"];
  fileOps: UIState["fileOps"];
  planLines: UIState["planLines"];
  planCostInfo: string;
  statusMessage: string;
  todaySpend: number;
}

// ---------------------------------------------------------------------------
// Connected clients
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();

// ---------------------------------------------------------------------------
// Build the web-safe state snapshot
// ---------------------------------------------------------------------------

export function getWebState(): WebUIState {
  const s = uiStore.getState();
  return {
    status: s.status,
    projectDir: s.projectDir,
    model: s.model,
    featureName: s.featureName,
    featureStage: s.featureStage,
    thinkingLines: s.thinkingLines,
    commands: s.commands,
    fileOps: s.fileOps,
    planLines: s.planLines,
    planCostInfo: s.planCostInfo,
    statusMessage: s.statusMessage,
    todaySpend: getTodaySpend(s.projectDir),
  };
}

// ---------------------------------------------------------------------------
// Broadcast state to all connected clients
// ---------------------------------------------------------------------------

function broadcast(): void {
  if (clients.size === 0) return;

  const msg = JSON.stringify({ type: "state", data: getWebState() });

  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Register WebSocket handlers and subscribe to uiStore changes.
 * Call once during server startup.
 */
export function setupWebSocketHandler(wss: WebSocketServer): void {
  // Subscribe to uiStore changes and broadcast to all clients
  uiStore.on("change", broadcast);

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);

    // Send current state immediately on connect
    const msg = JSON.stringify({ type: "state", data: getWebState() });
    ws.send(msg);

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });
}
