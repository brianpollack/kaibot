import type { WebSocket, WebSocketServer } from "ws";

import { uiStore, type ConversationItem, type UIState } from "../ui/store.js";
import { getTodaySpend } from "./spendTracker.js";
import type { NpmCommandRunner } from "./NpmCommandRunner.js";
import type { WebServer } from "./WebServer.js";
import { closeSession, hasSession, sendFollowup } from "./followupSession.js";
import { verifyWsHmac } from "./hmac.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the state object sent to browser clients. */
export interface WebUIState {
  status: UIState["status"];
  projectDir: string;
  model: string;
  provider: string;
  featureName: string | null;
  featureStage: UIState["featureStage"];
  featureStartTime: number | null;
  thinkingLines: string[];
  commands: UIState["commands"];
  fileOps: UIState["fileOps"];
  planLines: UIState["planLines"];
  planCostInfo: string;
  conversationItems: ConversationItem[];
  statusMessage: string;
  todaySpend: number;
  followupFeatureId: string | null;
  codeAssistActive: boolean;
  codeAssistResult: { action: string; path: string } | null;
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
    provider: s.provider,
    featureName: s.featureName,
    featureStage: s.featureStage,
    featureStartTime: s.featureStartTime,
    thinkingLines: s.thinkingLines,
    commands: s.commands,
    fileOps: s.fileOps,
    planLines: s.planLines,
    planCostInfo: s.planCostInfo,
    conversationItems: s.conversationItems,
    statusMessage: s.statusMessage,
    todaySpend: getTodaySpend(s.projectDir),
    followupFeatureId: s.followupFeatureId,
    codeAssistActive: s.codeAssistActive,
    codeAssistResult: s.codeAssistResult,
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

function broadcastRaw(payload: unknown): void {
  if (clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Wire npm runner events to broadcast. Called when npmRunner becomes available
 * (either at startup or after project activation).
 */
function wireNpmEvents(npmRunner: NpmCommandRunner): void {
  npmRunner.on("output", ({ script, chunk }: { script: string; chunk: string }) => {
    broadcastRaw({ type: "npm-output", script, chunk });
  });
  npmRunner.on("status", ({ script, status, exitCode }: { script: string; status: string; exitCode: number | null }) => {
    broadcastRaw({ type: "npm-status", script, status, exitCode });
  });
  npmRunner.on("clear", ({ script }: { script: string }) => {
    broadcastRaw({ type: "npm-clear", script });
  });
}

/**
 * Register WebSocket handlers and subscribe to uiStore + NpmCommandRunner changes.
 * Call once during server startup.
 */
export function setupWebSocketHandler(
  wss: WebSocketServer,
  npmRunner: NpmCommandRunner | null,
  hmacSecret: string,
  server: WebServer,
): void {
  // Subscribe to uiStore changes and broadcast to all clients
  uiStore.on("change", broadcast);

  // Subscribe to npm runner events if already available
  if (npmRunner) {
    wireNpmEvents(npmRunner);
  }

  // When a project is activated later, wire up the new npm runner
  server.on("project-activated", () => {
    if (server.npmRunner) {
      wireNpmEvents(server.npmRunner);
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);

    // Send current state immediately on connect
    const msg = JSON.stringify({ type: "state", data: getWebState() });
    ws.send(msg);

    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        if (!verifyWsHmac(hmacSecret, msg as Record<string, unknown>)) return;
        if (msg.type === "select-model" && typeof msg.model === "string") {
          uiStore.selectModel(msg.model);
        }
        if (msg.type === "select-provider" && typeof msg.provider === "string") {
          uiStore.selectProvider(msg.provider);
        }
        // npm commands — only when a project is active
        if (server.npmRunner) {
          if (msg.type === "npm-start" && typeof msg.script === "string") {
            server.npmRunner.start(msg.script);
          }
          if (msg.type === "npm-stop" && typeof msg.script === "string") {
            server.npmRunner.stop(msg.script);
          }
          if (msg.type === "npm-restart" && typeof msg.script === "string") {
            server.npmRunner.restart(msg.script);
          }
        }
        if (msg.type === "feature-followup" && typeof msg.featureId === "string" && typeof msg.message === "string") {
          if (hasSession(msg.featureId)) {
            sendFollowup(msg.featureId, msg.message).catch(() => {});
          }
        }
        if (msg.type === "feature-close" && typeof msg.featureId === "string") {
          closeSession(msg.featureId);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });
}
