import { readFileSync, writeFileSync } from "fs";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { routeToolUse } from "../KaiAgent.js";
import type { KaiClient } from "../KaiClient.js";
import type { ConversationLogEntry } from "../ui/store.js";
import { uiStore } from "../ui/store.js";

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

export interface FollowupSession {
  featureId: string;
  client: KaiClient;
  logPath: string;
  /** Resolves the Promise in KaiBot so it returns to watching. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Session registry
// ---------------------------------------------------------------------------

const sessions = new Map<string, FollowupSession>();

export function registerSession(
  featureId: string,
  client: KaiClient,
  logPath: string,
  onClose: () => void,
): void {
  sessions.set(featureId, { featureId, client, logPath, onClose });
}

export function hasSession(featureId: string): boolean {
  return sessions.has(featureId);
}

export function closeSession(featureId: string): void {
  const session = sessions.get(featureId);
  if (!session) return;
  sessions.delete(featureId);
  session.onClose();
}

// ---------------------------------------------------------------------------
// Send a follow-up prompt to the running agent
// ---------------------------------------------------------------------------

export async function sendFollowup(featureId: string, message: string): Promise<void> {
  const session = sessions.get(featureId);
  if (!session) return;

  const newEntries: ConversationLogEntry[] = [
    { type: "user", content: message, timestamp: new Date().toISOString() },
  ];

  // Display the user message in the live conversation feed
  uiStore.pushConversationUser(message);

  try {
    for await (const msg of session.client.query(message)) {
      if (msg.type === "assistant") {
        const { message: sdkMsg } = msg as SDKAssistantMessage;
        for (const block of sdkMsg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            uiStore.appendThinking(b.text);
            uiStore.pushConversationThinking(b.text);
            // Coalesce adjacent thinking chunks in the log entries
            const last = newEntries.at(-1);
            if (last?.type === "thinking") {
              last.content += b.text;
            } else {
              newEntries.push({ type: "thinking", content: b.text, timestamp: new Date().toISOString() });
            }
          } else if (b.type === "tool_use" && typeof b.name === "string") {
            const input = b.input as Record<string, unknown> | undefined;
            routeToolUse(b.name, input);
            newEntries.push({
              type: "command",
              content: `${b.name}: ${JSON.stringify(input)}`,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      if (msg.type === "result") {
        const result = msg as SDKResultMessage;
        if (result.subtype === "success") {
          const costStr = `$${result.total_cost_usd.toFixed(4)}`;
          const info = `Follow-up complete — Cost: ${costStr}  Turns: ${result.num_turns}`;
          uiStore.pushConversationSystem(info);
          uiStore.setStatusMessage(info);
          newEntries.push({ type: "system", content: info, timestamp: new Date().toISOString() });
          appendToFeatureLog(session.logPath, result.total_cost_usd, result.num_turns, newEntries);
        } else {
          const errMsg = `Follow-up failed: ${result.errors.join(", ")}`;
          uiStore.pushConversationSystem(errMsg);
          newEntries.push({ type: "system", content: errMsg, timestamp: new Date().toISOString() });
          appendToFeatureLog(session.logPath, 0, 0, newEntries);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const msg2 = `Follow-up error: ${errMsg}`;
    uiStore.pushConversationSystem(msg2);
    newEntries.push({ type: "system", content: msg2, timestamp: new Date().toISOString() });
    appendToFeatureLog(session.logPath, 0, 0, newEntries);
  }
}

// ---------------------------------------------------------------------------
// Persist follow-up conversation to the feature log JSON
// ---------------------------------------------------------------------------

function appendToFeatureLog(
  logPath: string,
  extraCostUsd: number,
  extraTurns: number,
  newEntries: ConversationLogEntry[],
): void {
  try {
    const raw = readFileSync(logPath, "utf-8");
    const record = JSON.parse(raw) as Record<string, unknown>;
    record.totalCostUsd = ((record.totalCostUsd as number) || 0) + extraCostUsd;
    record.numTurns = ((record.numTurns as number) || 0) + extraTurns;
    const existing = (record.conversationHistory as ConversationLogEntry[]) || [];
    record.conversationHistory = [...existing, ...newEntries];
    writeFileSync(logPath, JSON.stringify(record, null, 2) + "\n");
  } catch {
    // Non-critical — don't crash on log update failure
  }
}
