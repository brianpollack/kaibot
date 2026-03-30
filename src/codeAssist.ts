import { readFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { KaiClient } from "./KaiClient.js";
import { routeToolUse } from "./KaiAgent.js";
import { uiStore } from "./ui/store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeAssistOption {
  name: string;
  description: string;
  author: string;
  /** Filename in prompts/ directory (e.g. "tech_debt.md"). */
  prompt: string;
  /** Button label for viewing result (e.g. "View TODO.md"). */
  result_action: string;
  /** Path to result file with {projectDir} placeholder. */
  result_open: string;
}

export interface CodeAssistResult {
  costInfo: string;
  resultAction: string;
  resultPath: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "..", "prompts");

// ---------------------------------------------------------------------------
// Load code assist options from prompts/code_assist.json
// ---------------------------------------------------------------------------

export function loadCodeAssistOptions(): CodeAssistOption[] {
  try {
    const raw = readFileSync(join(PROMPTS_DIR, "code_assist.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CodeAssistOption[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Load and interpolate a prompt file
// ---------------------------------------------------------------------------

export function loadPromptContent(promptFile: string, projectDir?: string): string {
  // Prevent path traversal
  const safeName = promptFile.replace(/\.\./g, "").replace(/[/\\]/g, "");
  const filePath = join(PROMPTS_DIR, safeName);
  const content = readFileSync(filePath, "utf-8");
  if (projectDir) {
    return content.replace(/\{projectDir\}/g, projectDir);
  }
  return content;
}

// ---------------------------------------------------------------------------
// Run a code assist option — streams to uiStore conversation
// ---------------------------------------------------------------------------

/**
 * Execute a code assist prompt via the Claude agent, streaming progress
 * to the uiStore conversation view (same pattern as KaiAgent.processFeature).
 */
export async function runCodeAssist(
  option: CodeAssistOption,
  projectDir: string,
  model: string,
): Promise<CodeAssistResult> {
  const client = KaiClient.create(projectDir, model);
  const prompt = loadPromptContent(option.prompt, projectDir);
  const startTime = Date.now();

  uiStore.startConversation();
  uiStore.setFeatureName(option.name);
  uiStore.setFeatureStage("reading");
  uiStore.setFeatureStartTime(startTime);
  uiStore.setStatusMessage(`Running: ${option.name}`);
  uiStore.startCodeAssist();

  try {
    for await (const msg of client.query(prompt)) {
      if (msg.type === "assistant") {
        const { message } = msg as SDKAssistantMessage;
        for (const block of message.content) {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
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
          uiStore.setStatusMessage(`${option.name} failed: ${errStr}`);
          uiStore.finishCodeAssist(null);
          throw new Error(`Code assist failed (${result.subtype}): ${errStr}`);
        }

        uiStore.setFeatureStage("complete");
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const costStr = `$${result.total_cost_usd.toFixed(4)}`;
        const costInfo = `Cost: ${costStr}  Turns: ${result.num_turns}  Time: ${elapsedSec}s`;
        uiStore.setStatusMessage(`Done — ${costInfo}`);
        uiStore.completeConversationCommand();
        uiStore.pushConversationSystem(`✅ ${option.name} complete — ${costInfo}`);

        const resultPath = option.result_open.replace(/\{projectDir\}/g, projectDir);

        uiStore.finishCodeAssist({ action: option.result_action, path: resultPath });

        return { costInfo, resultAction: option.result_action, resultPath };
      }
    }
  } catch (err) {
    uiStore.finishCodeAssist(null);
    throw err;
  }

  uiStore.finishCodeAssist(null);
  throw new Error("Code assist completed without a result");
}
