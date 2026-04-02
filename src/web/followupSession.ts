import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { addFollowupCost } from "../featureDb.js";
import { routeToolUse } from "../KaiAgent.js";
import { KaiClient } from "../KaiClient.js";
import type { ProviderName } from "../models.js";
import type { ConversationLogEntry } from "../ui/store.js";
import { uiStore } from "../ui/store.js";

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

export interface FollowupSession {
  featureId: string;
  client: KaiClient;
  logPath: string;
  projectDir: string;
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
  projectDir: string,
  onClose: () => void,
): void {
  sessions.set(featureId, { featureId, client, logPath, projectDir, onClose });
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
          const b = block as unknown as Record<string, unknown>;
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
          appendToFeatureLog(session.logPath, result.total_cost_usd, result.num_turns, newEntries, session.projectDir);
        } else {
          const errMsg = `Follow-up failed: ${result.errors.join(", ")}`;
          uiStore.pushConversationSystem(errMsg);
          newEntries.push({ type: "system", content: errMsg, timestamp: new Date().toISOString() });
          appendToFeatureLog(session.logPath, 0, 0, newEntries, session.projectDir);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const msg2 = `Follow-up error: ${errMsg}`;
    uiStore.pushConversationSystem(msg2);
    newEntries.push({ type: "system", content: msg2, timestamp: new Date().toISOString() });
    appendToFeatureLog(session.logPath, 0, 0, newEntries, session.projectDir);
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
  projectDir?: string,
): void {
  try {
    const raw = readFileSync(logPath, "utf-8");
    const record = JSON.parse(raw) as Record<string, unknown>;
    record.totalCostUsd = ((record.totalCostUsd as number) || 0) + extraCostUsd;
    record.numTurns = ((record.numTurns as number) || 0) + extraTurns;
    const existing = (record.conversationHistory as ConversationLogEntry[]) || [];
    record.conversationHistory = [...existing, ...newEntries];
    writeFileSync(logPath, JSON.stringify(record, null, 2) + "\n");
    // Keep .kaibot/features.json in sync so todaySpend reflects follow-up costs
    if (projectDir && extraCostUsd && typeof record.id === "string") {
      addFollowupCost(projectDir, record.id, extraCostUsd);
    }
    // Signal browser clients to refresh the features list
    uiStore.emit("features-updated");
  } catch {
    // Non-critical — don't crash on log update failure
  }
}

// ---------------------------------------------------------------------------
// Resume a session from feature history
// ---------------------------------------------------------------------------

/**
 * Resumes a completed feature's agent session by session ID and sends the
 * first follow-up message.  Creates a new KaiClient with the resume option,
 * registers it as a follow-up session, and loads the conversation history
 * into the live conversation feed.
 */
export async function resumeSession(
  featureId: string,
  sessionId: string,
  message: string,
  projectDir: string,
  model: string,
  provider: ProviderName = "anthropic",
): Promise<void> {
  // If there's already an active session for this feature, just send a follow-up
  if (hasSession(featureId)) {
    await sendFollowup(featureId, message);
    return;
  }

  const logDir = join(projectDir, "features", "log");
  const logPath = join(logDir, `${featureId}.json`);

  // Load the existing conversation history into the live feed
  if (existsSync(logPath)) {
    try {
      const raw = readFileSync(logPath, "utf-8");
      const record = JSON.parse(raw) as Record<string, unknown>;
      const history = (record.conversationHistory as ConversationLogEntry[]) || [];

      // Populate the live conversation feed with history
      uiStore.startConversation();
      uiStore.setFeatureName((record.title as string) || featureId);
      uiStore.setFeatureStage("executing");
      uiStore.setStatusMessage(`Resuming session for: ${(record.title as string) || featureId}`);

      for (const entry of history) {
        switch (entry.type) {
          case "thinking":
            uiStore.pushConversationThinking(entry.content);
            break;
          case "command":
            uiStore.pushConversationCommand(entry.content);
            uiStore.completeConversationCommand();
            break;
          case "system":
            uiStore.pushConversationSystem(entry.content);
            break;
          case "user":
            uiStore.pushConversationUser(entry.content);
            break;
          case "git":
            uiStore.pushConversationGit(entry.content);
            break;
          default:
            // agent, file — push as appropriate type
            if (entry.type === "file") {
              // File entries store JSON content
              uiStore.pushConversationFileOp("File", "", {});
            }
            break;
        }
      }
    } catch {
      // Non-critical — proceed without loading history
    }
  }

  // Create a new client that resumes the previous session
  const client = KaiClient.create(projectDir, model, provider);

  // Set up follow-up session infrastructure
  uiStore.setFollowupFeatureId(featureId);
  uiStore.setStatus("processing");

  // Register session — the onClose callback will be used when the user closes it
  registerSession(featureId, client, logPath, projectDir, () => {
    const doneName = uiStore.getState().featureName;
    uiStore.setFollowupFeatureId(null);
    uiStore.resetFeature();
    uiStore.setFeatureName(doneName);
    uiStore.setStatus("watching");
    uiStore.setStatusMessage("Watching for new features…");
  });

  // Send the first message using the resumed session
  await sendFollowupWithResume(featureId, message, sessionId);
}

/**
 * Like sendFollowup, but passes the sessionId to client.query() for session
 * resumption on the first message.
 */
async function sendFollowupWithResume(
  featureId: string,
  message: string,
  sessionId: string,
): Promise<void> {
  const session = sessions.get(featureId);
  if (!session) return;

  const newEntries: ConversationLogEntry[] = [
    { type: "user", content: message, timestamp: new Date().toISOString() },
  ];

  uiStore.pushConversationUser(message);

  try {
    for await (const msg of session.client.query(message, sessionId)) {
      if (msg.type === "assistant") {
        const { message: sdkMsg } = msg as SDKAssistantMessage;
        for (const block of sdkMsg.content) {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            uiStore.appendThinking(b.text);
            uiStore.pushConversationThinking(b.text);
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
          const info = `Resumed session complete — Cost: ${costStr}  Turns: ${result.num_turns}`;
          uiStore.pushConversationSystem(info);
          uiStore.setStatusMessage(info);
          newEntries.push({ type: "system", content: info, timestamp: new Date().toISOString() });
          appendToFeatureLog(session.logPath, result.total_cost_usd, result.num_turns, newEntries, session.projectDir);
        } else {
          const errMsg = `Resumed session failed: ${result.errors.join(", ")}`;
          uiStore.pushConversationSystem(errMsg);
          newEntries.push({ type: "system", content: errMsg, timestamp: new Date().toISOString() });
          appendToFeatureLog(session.logPath, 0, 0, newEntries, session.projectDir);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const msg2 = `Resume error: ${errMsg}`;
    uiStore.pushConversationSystem(msg2);
    newEntries.push({ type: "system", content: msg2, timestamp: new Date().toISOString() });
    appendToFeatureLog(session.logPath, 0, 0, newEntries, session.projectDir);
  }
}
