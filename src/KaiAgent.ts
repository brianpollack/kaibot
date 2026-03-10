import { appendFileSync } from "fs";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { type Feature } from "./feature.js";
import { KaiClient } from "./KaiClient.js";

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

  console.log(`\n[KaiAgent] Starting feature: ${feature.name}`);
  console.log(`[KaiAgent] File: ${feature.filePath}\n`);

  for await (const msg of client.query(prompt)) {
    // Stream assistant text and log tool calls
    if (msg.type === "assistant") {
      const { message } = msg as SDKAssistantMessage;
      for (const block of message.content) {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          process.stdout.write(b.text);
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          const inputStr = JSON.stringify(b.input);
          const preview = inputStr.length > 120 ? `${inputStr.slice(0, 120)}…` : inputStr;
          console.log(`\n  [Tool: ${b.name}] ${preview}`);
        }
      }
    }

    // Handle completion
    if (msg.type === "result") {
      const result = msg as SDKResultMessage;
      console.log(); // newline after streamed text
      if (result.subtype !== "success") {
        throw new Error(
          `[KaiAgent] Feature failed (${result.subtype}): ${result.errors.join(", ")}`,
        );
      }
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const costStr = `$${result.total_cost_usd.toFixed(4)}`;
      console.log(
        `[KaiAgent] Done — cost: ${costStr}, turns: ${result.num_turns}, time: ${elapsedSec}s`,
      );
      appendFileSync(
        feature.filePath,
        `\n## Metadata\n\n- **Model:** ${model}\n- **Cost:** ${costStr}\n- **Turns:** ${result.num_turns}\n- **Time:** ${elapsedSec}s\n`,
      );
    }
  }
}
