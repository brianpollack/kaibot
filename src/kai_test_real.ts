/**
 * kai_test_real — smoke test that proves the Claude agent SDK is working.
 *
 * Launches a real agent against the current working directory. The agent
 * runs `git status` and `git diff` to review uncommitted changes, then
 * suggests a concise git commit message.
 *
 * Usage:
 *   npm run test:real
 *
 * Requires ANTHROPIC_API_KEY. Uses KAI_MODEL if set, otherwise defaults
 * to claude-haiku-4-5 (cheap and fast — good for a smoke test).
 */

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "path";

import { KaiClient } from "./KaiClient.js";

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  console.error("Get your API key from: https://console.anthropic.com/");
  process.exit(1);
}

const projectDir = resolve(".");
const model = process.env.KAI_MODEL ?? "claude-haiku-4-5";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PROMPT = `You are a helpful git assistant. Your only job is to review the
current uncommitted changes in this repository and suggest a commit message.

Steps:
1. Run \`git status\` to see what files have changed.
2. Run \`git diff\` to read the actual diff of unstaged changes.
3. Run \`git diff --cached\` to read any staged changes.
4. Run \`git log --oneline -5\` to understand the recent commit style.

Then output:
- A one-line conventional commit message (e.g. "feat: add CSV export").
- A short bulleted list (3–5 items max) of the most notable changes.
- Nothing else — no commentary, no preamble.

If there are no changes, say so clearly and stop.`;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`\nkai_test_real`);
console.log(`  Model   : ${model}`);
console.log(`  Project : ${projectDir}`);
console.log(`\nConnecting to Claude...\n`);

const client = KaiClient.create(projectDir, model);
let gotResult = false;

for await (const msg of client.query(PROMPT)) {
  if (msg.type === "assistant") {
    const { message } = msg as SDKAssistantMessage;
    for (const block of message.content) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        process.stdout.write(b.text);
      }
    }
  }

  if (msg.type === "result") {
    const result = msg as SDKResultMessage;
    console.log(); // newline after streamed text

    if (result.subtype !== "success") {
      console.error(`\nAgent failed (${result.subtype}): ${result.errors.join(", ")}`);
      process.exit(1);
    }

    console.log(
      `\n  cost: $${result.total_cost_usd.toFixed(4)}  turns: ${result.num_turns}`,
    );
    gotResult = true;
  }
}

if (!gotResult) {
  console.error("\nNo result received from agent.");
  process.exit(1);
}
