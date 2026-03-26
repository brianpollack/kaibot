import { existsSync, readFileSync } from "fs";
import { join } from "path";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { KaiClient } from "./KaiClient.js";
import { routeToolUse } from "./KaiAgent.js";
import { uiStore } from "./ui/store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoItem {
  id: number;
  priority: "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  file: string | null;
  line?: number | null;
  lines?: number[];
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

export function todoExists(projectDir: string): boolean {
  return existsSync(join(projectDir, "todo.json"));
}

export function loadTodoItems(projectDir: string): TodoItem[] {
  try {
    const raw = readFileSync(join(projectDir, "todo.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj["items"])) return [];
    return obj["items"] as TodoItem[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Run a TODO resolution plan via Claude agent
// ---------------------------------------------------------------------------

/**
 * Ask the Claude agent to review a TODO item and produce a resolution plan.
 * Streams progress to the uiStore conversation view.
 * Returns the full plan text on completion.
 */
export async function runTodoPlan(
  item: TodoItem,
  projectDir: string,
  model: string,
): Promise<string> {
  const client = KaiClient.create(projectDir, model);

  const filePart = item.file
    ? `\n\n**File:** ${item.file}` +
      (item.line != null
        ? ` (line ${item.line})`
        : item.lines
          ? ` (lines ${item.lines.join(", ")})`
          : "")
    : "";

  const prompt =
    `The following problem or recommendation was made for this project. ` +
    `Review and write a resolution plan.\n\n` +
    `**Title:** ${item.title}\n\n` +
    `**Description:** ${item.description}${filePart}`;

  const startTime = Date.now();

  uiStore.startConversation();
  uiStore.setFeatureName(`TODO: ${item.title}`);
  uiStore.setFeatureStage("thinking");
  uiStore.setFeatureStartTime(startTime);
  uiStore.setStatusMessage(`Planning resolution for: ${item.title}`);

  let planText = "";

  try {
    for await (const msg of client.query(prompt)) {
      if (msg.type === "assistant") {
        const { message } = msg as SDKAssistantMessage;
        for (const block of message.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            planText += b.text;
            uiStore.appendThinking(b.text);
            uiStore.pushConversationThinking(b.text);
          } else if (b.type === "tool_use" && typeof b.name === "string") {
            const input = b.input as Record<string, unknown> | undefined;
            routeToolUse(b.name, input);
          }
        }
      }

      if (msg.type === "result") {
        const result = msg as SDKResultMessage;
        if (result.subtype !== "success") {
          const errStr = result.errors.join(", ");
          uiStore.setStatusMessage(`TODO plan failed: ${errStr}`);
          throw new Error(`TODO plan failed (${result.subtype}): ${errStr}`);
        }

        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        uiStore.setFeatureStage("complete");
        uiStore.setStatusMessage(`Plan ready (${elapsedSec}s)`);
        uiStore.pushConversationSystem(`✅ Resolution plan ready — review and submit as a feature`);
      }
    }
  } catch (err) {
    uiStore.setFeatureStage(null);
    throw err;
  }

  return planText;
}
