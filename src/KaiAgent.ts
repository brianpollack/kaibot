import { appendFileSync, readFileSync } from "fs";
import { basename } from "path";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { type Feature } from "./feature.js";
import { KaiClient } from "./KaiClient.js";
import { type PlanLine, uiStore } from "./ui/store.js";

// ---------------------------------------------------------------------------
// AgentStats — returned by processFeature for tracking purposes
// ---------------------------------------------------------------------------

export interface AgentStats {
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Plan checkbox item labels collected at end of run */
  planPoints: string[];
}

export interface ProcessFeatureOptions {
  onPlanCreated?: (planSection: string) => Promise<void> | void;
}

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

Keep the feature file updated as you work — progress should be visible in real time.

## Testing guidelines

- **Do NOT add tests** for features that are primarily User Interface work (CLI apps, React components, styling, layout, or other UI changes).
- **Do NOT add tests** if the feature does not change any logic (e.g. prompt changes, configuration, cosmetic updates).
- **Only add tests** when the feature introduces or modifies business logic, data transformations, or algorithmic behavior.`;
}

// ---------------------------------------------------------------------------
// processFeature
// ---------------------------------------------------------------------------

/**
 * Runs the agent against a single feature file from start (planning) to
 * finish (all steps executed), streaming output to the console.
 *
 * Returns AgentStats for the completed run.
 * Throws if the agent ends with an error result.
 */
export async function processFeature(
  feature: Feature,
  projectDir: string,
  model: string,
  options: ProcessFeatureOptions = {},
): Promise<AgentStats> {
  const client = KaiClient.create(projectDir, model);
  const prompt = buildPrompt(feature, projectDir);
  const startTime = Date.now();

  uiStore.setFeatureName(feature.name);
  uiStore.setFeatureStage("reading");
  uiStore.setFeatureStartTime(startTime);
  uiStore.setStatusMessage(`Starting feature: ${feature.name}`);

  let hasSeenToolUse = false;
  let hasSeenEdit = false;
  let hasNotifiedPlan = false;

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

    // After each message, refresh plan lines from the feature file
    refreshPlanLines(feature.filePath);
    if (!hasNotifiedPlan && options.onPlanCreated) {
      const planSection = readPlanSection(feature.filePath);
      if (planSection) {
        hasNotifiedPlan = true;
        try {
          await options.onPlanCreated(planSection);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[KaiAgent] Failed to send plan callback: ${errMsg}`);
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
      const costInfo = `Cost: ${costStr}  Turns: ${result.num_turns}  Time: ${elapsedSec}s`;
      uiStore.setStatusMessage(`Done — ${costInfo}`);
      uiStore.setPlanCostInfo(costInfo);
      appendFileSync(
        feature.filePath,
        `\n## Metadata\n\n- **Model:** ${model}\n- **Cost:** ${costStr}\n- **Turns:** ${result.num_turns}\n- **Time:** ${elapsedSec}s\n`,
      );

      const planPoints = parsePlanLines(safeReadFileContent(feature.filePath)).map((l) => l.text);
      return {
        durationMs: result.duration_ms,
        totalCostUsd: result.total_cost_usd,
        numTurns: result.num_turns,
        tokensIn: result.usage.input_tokens,
        tokensOut: result.usage.output_tokens,
        cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: result.usage.cache_creation_input_tokens ?? 0,
        planPoints,
      };
    }
  }

  // Should not be reachable — SDK always emits a result message
  throw new Error("[KaiAgent] Stream ended without a result message");
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

// ---------------------------------------------------------------------------
// Plan parsing — reads the feature file and extracts checkbox lines
// ---------------------------------------------------------------------------

const CHECKBOX_RE = /^- \[([ xX])\] (.+)$/;

/** Parse plan checkbox lines from file content. */
export function parsePlanLines(content: string): PlanLine[] {
  const lines: PlanLine[] = [];
  let inPlan = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Detect start of plan section
    if (trimmed === "## Plan") {
      inPlan = true;
      continue;
    }

    // Stop at the next heading (## Summary, ## Metadata, etc.)
    if (inPlan && /^## /.test(trimmed)) {
      break;
    }

    if (inPlan) {
      const match = CHECKBOX_RE.exec(trimmed);
      if (match) {
        lines.push({
          checked: match[1] !== " ",
          text: match[2],
        });
      }
    }
  }

  return lines;
}

/** Read the feature file and update the plan panel in the UI store. */
function refreshPlanLines(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = parsePlanLines(content);
    if (lines.length > 0) {
      uiStore.setPlanLines(lines);
    }
  } catch {
    // File may not exist yet or may be mid-rename; ignore
  }
}

function safeReadFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Summary generation — uses a cheap model to produce a 2-3 sentence summary
// ---------------------------------------------------------------------------

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/**
 * Calls a low-cost model to produce a concise 2-3 sentence summary of what
 * was implemented.  Returns an empty string on any error so callers can
 * gracefully degrade.
 */
export async function generateSummary(
  feature: Feature,
  projectDir: string,
): Promise<string> {
  const content = safeReadFileContent(feature.filePath);
  if (!content) return "";

  const prompt =
    `The following is a completed software feature file. ` +
    `Write a concise 2-3 sentence plain-English summary of what was implemented. ` +
    `Do not use bullet points. Output only the summary, nothing else.\n\n` +
    `<feature>\n${content}\n</feature>`;

  try {
    const client = new KaiClient(projectDir, SUMMARY_MODEL);
    return (await client.run(prompt)).trim();
  } catch {
    return "";
  }
}

function readPlanSection(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const startIdx = lines.findIndex((line) => line.trim() === "## Plan");
    if (startIdx === -1) return null;

    const section: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("## ")) break;
      section.push(line);
    }

    const trimmed = section.join("\n").trim();
    if (trimmed.length === 0) return null;
    if (!/- \[[ xX]\]\s+/.test(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}
