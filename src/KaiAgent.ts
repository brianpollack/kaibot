import { appendFileSync } from "fs";
import { basename } from "path";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { type Feature } from "./feature.js";
import { KaiClient } from "./KaiClient.js";
import { uiStore } from "./ui/store.js";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildPrompt(feature: Feature, projectDir: string): string {
  return `You are implementing a software feature in an existing codebase.

**Project directory:** ${projectDir}
**Feature file:** ${feature.filePath}

## Your task

1. **Read the feature file** at \`${feature.filePath}\` to understand what needs to be built.

2. **Explore the project** — read existing code to understand patterns, conventions, and structure before writing anything.

3. **Append a \`## Plan\` section** to the feature file listing the implementation steps as checkboxes:
   \`\`\`markdown
   ## Plan

   - [ ] 1. Brief step description
   - [ ] 2. Brief step description
   \`\`\`

4. **Execute each step** in order. After completing each step, edit the feature file to mark it done and add a short note:
   \`- [x] 1. Brief step description — what was done / file changed\`

5. When all steps are finished, **append a \`## Summary\` section** to the feature file with a brief description of what was implemented.

Keep the feature file updated as you work — progress should be visible in real time.`;
}

// ---------------------------------------------------------------------------
// processFeature
// ---------------------------------------------------------------------------

/**
 * Runs the agent against a single feature file from start (planning) to
 * finish (all steps executed), streaming output to the console.
 *
 * Throws if the agent ends with an error result.
 */
export async function processFeature(
  feature: Feature,
  projectDir: string,
  model: string,
): Promise<void> {
  const client = KaiClient.create(projectDir, model);
  const prompt = buildPrompt(feature, projectDir);
  const startTime = Date.now();

  uiStore.setFeatureName(feature.name);
  uiStore.setFeatureStage("reading");
  uiStore.setStatusMessage(`Starting feature: ${feature.name}`);

  let hasSeenToolUse = false;
  let hasSeenEdit = false;

  for await (const msg of client.query(prompt)) {
    // Stream assistant text and log tool calls
    if (msg.type === "assistant") {
      const { message } = msg as SDKAssistantMessage;
      for (const block of message.content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          // Transition to "thinking" once the agent starts producing text
          if (!hasSeenToolUse) {
            uiStore.setFeatureStage("thinking");
          }
          // Detect plan section being written
          if (b.text.includes("## Plan")) {
            uiStore.setFeatureStage("planning");
          }
          uiStore.appendThinking(b.text);
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          hasSeenToolUse = true;
          // Transition to "executing" once edits/writes start (past planning)
          if (!hasSeenEdit && (b.name === "Edit" || b.name === "Write")) {
            hasSeenEdit = true;
            uiStore.setFeatureStage("executing");
          }
          // Stay in "reading" stage while only reading files
          if (!hasSeenEdit && (b.name === "Read" || b.name === "Glob" || b.name === "Grep")) {
            uiStore.setFeatureStage("reading");
          }
          const input = b.input as Record<string, unknown> | undefined;
          routeToolUse(b.name, input);
        }
      }
    }

    // Handle completion
    if (msg.type === "result") {
      const result = msg as SDKResultMessage;
      if (result.subtype !== "success") {
        uiStore.setStatusMessage(
          `Feature failed (${result.subtype}): ${result.errors.join(", ")}`,
        );
        throw new Error(
          `[KaiAgent] Feature failed (${result.subtype}): ${result.errors.join(", ")}`,
        );
      }
      uiStore.setFeatureStage("complete");
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const costStr = `$${result.total_cost_usd.toFixed(4)}`;
      uiStore.setStatusMessage(
        `Done — cost: ${costStr}, turns: ${result.num_turns}, time: ${elapsedSec}s`,
      );
      appendFileSync(
        feature.filePath,
        `\n## Metadata\n\n- **Model:** ${model}\n- **Cost:** ${costStr}\n- **Turns:** ${result.num_turns}\n- **Time:** ${elapsedSec}s\n`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Route tool-use blocks to the appropriate UI panels
// ---------------------------------------------------------------------------

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

function routeToolUse(name: string, input: Record<string, unknown> | undefined): void {
  if (name === "Bash") {
    const cmd = typeof input?.command === "string" ? input.command : "(unknown)";
    uiStore.pushCommand(cmd);
  } else if (FILE_TOOLS.has(name)) {
    const filePath =
      typeof input?.file_path === "string" ? input.file_path : "(unknown)";
    const opType = name.toLowerCase() as "read" | "write" | "edit";
    const preview = getFileOpPreview(name, input);
    uiStore.pushFileOp({ type: opType, path: basename(filePath), preview });
  } else {
    // Other tools (Glob, Grep, etc.) show as commands
    const inputStr = JSON.stringify(input);
    const preview = inputStr.length > 60 ? `${inputStr.slice(0, 60)}…` : inputStr;
    uiStore.pushCommand(`${name}: ${preview}`);
  }
}

function getFileOpPreview(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (toolName === "Edit") {
    return typeof input.old_string === "string"
      ? input.old_string.slice(0, 30).replace(/\n/g, " ")
      : "";
  }
  if (toolName === "Write") {
    return typeof input.content === "string"
      ? input.content.slice(0, 30).replace(/\n/g, " ")
      : "";
  }
  return "";
}
