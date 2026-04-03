import { appendFileSync, existsSync, readFileSync } from "fs";
import { basename, extname } from "path";

import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import { type Feature } from "./feature.js";
import { KaiClient } from "./KaiClient.js";
import type { ProviderName } from "./models.js";
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
  /** SDK session ID — can be used to resume the conversation later. */
  sessionId?: string;
}

export interface ProcessFeatureOptions {
  onPlanCreated?: (planSection: string) => Promise<void> | void;
  provider?: ProviderName;
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
  existingClient?: KaiClient,
): Promise<AgentStats> {
  const client = existingClient ?? KaiClient.create(projectDir, model, options.provider);
  const startTime = Date.now();

  uiStore.startConversation();
  uiStore.setFeatureName(feature.name);
  uiStore.setFeatureStage("reading");
  uiStore.setFeatureStartTime(startTime);
  uiStore.setStatusMessage(`Starting feature: ${feature.name}`);

  // These persist across clarification rounds
  let hasSeenToolUse = false;
  let hasSeenEdit = false;
  let hasNotifiedPlan = false;
  let sessionId: string | undefined;

  // Accumulated stats across all rounds (including clarification turns)
  let accCostUsd = 0;
  let accTurns = 0;
  let accTokensIn = 0;
  let accTokensOut = 0;
  let accCacheRead = 0;
  let accCacheWrite = 0;

  // First round uses the full feature prompt; clarification rounds send the answer
  let queryPrompt: string = buildPrompt(feature, projectDir);

  // Outer loop: re-runs the agent after each clarification exchange
  while (true) {
    let clarifyQuestion: string | undefined;
    let accumulatedText = "";

    for await (const msg of client.query(queryPrompt, sessionId)) {
      // Capture session ID (needed to resume the session for follow-up queries)
      if (!sessionId && (msg as Record<string, unknown>).session_id) {
        sessionId = (msg as Record<string, unknown>).session_id as string;
      }

      if (msg.type === "assistant") {
        const { message } = msg as SDKAssistantMessage;
        for (const block of message.content) {
          const b = block as unknown as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            if (!hasSeenToolUse) uiStore.setFeatureStage("thinking");
            if (b.text.includes("## Plan")) uiStore.setFeatureStage("planning");
            uiStore.appendThinking(b.text);
            uiStore.pushConversationThinking(b.text);

            // Accumulate to detect CLARIFY across streamed chunks
            accumulatedText += b.text;
            if (!clarifyQuestion) {
              const m = accumulatedText.match(CLARIFY_RE);
              if (m) clarifyQuestion = m[1].trim();
            }
          } else if (b.type === "tool_use" && typeof b.name === "string") {
            hasSeenToolUse = true;
            if (!hasSeenEdit && (b.name === "Edit" || b.name === "Write")) {
              hasSeenEdit = true;
              uiStore.setFeatureStage("executing");
            }
            if (!hasSeenEdit && (b.name === "Read" || b.name === "Glob" || b.name === "Grep")) {
              uiStore.setFeatureStage("reading");
            }
            const input = b.input as Record<string, unknown> | undefined;
            routeToolUse(b.name, input);
          }
        }
      }

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

        // Accumulate stats for this round
        accCostUsd += result.total_cost_usd;
        accTurns += result.num_turns;
        accTokensIn += result.usage.input_tokens;
        accTokensOut += result.usage.output_tokens;
        accCacheRead += result.usage.cache_read_input_tokens ?? 0;
        accCacheWrite += result.usage.cache_creation_input_tokens ?? 0;

        // If the agent asked for clarification, break inner loop to handle it
        if (clarifyQuestion) break;

        // Normal completion path
        uiStore.setFeatureStage("complete");
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const costStr = `$${accCostUsd.toFixed(4)}`;
        const costInfo = `Cost: ${costStr}  Turns: ${accTurns}  Time: ${elapsedSec}s`;
        uiStore.setStatusMessage(`Done — ${costInfo}`);
        uiStore.setPlanCostInfo(costInfo);
        uiStore.completeConversationCommand();
        uiStore.pushConversationSystem(`✅ Feature complete — ${costInfo}`);
        appendFileSync(
          feature.filePath,
          `\n## Metadata\n\n- **Model:** ${model}\n- **Cost:** ${costStr}\n- **Turns:** ${accTurns}\n- **Time:** ${elapsedSec}s\n`,
        );

        const planPoints = parsePlanLines(safeReadFileContent(feature.filePath)).map((l) => l.text);
        return {
          durationMs: Date.now() - startTime,
          totalCostUsd: accCostUsd,
          numTurns: accTurns,
          tokensIn: accTokensIn,
          tokensOut: accTokensOut,
          cacheReadTokens: accCacheRead,
          cacheWriteTokens: accCacheWrite,
          planPoints,
          sessionId,
        };
      }
    }

    if (!clarifyQuestion) {
      // Stream ended without a result — should not happen normally
      throw new Error("[KaiAgent] Stream ended without a result message");
    }

    // Pause and ask the user; fall back if no browser client responds in time
    const answer = await requestClarification(clarifyQuestion);
    queryPrompt = answer;
    // sessionId is already set — next query() call will resume the same session
  }
}

// ---------------------------------------------------------------------------
// Route tool-use blocks to the appropriate UI panels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clarification request — pauses feature processing to ask the user a question
// ---------------------------------------------------------------------------

const CLARIFY_FALLBACK = "User is not available, follow your best judgement";
const CLARIFY_TIMEOUT_MS = 60_000;
const CLARIFY_RE = /(?:^|\n)CLARIFY:\s*(.+?)(?:\n|$)/;

/**
 * Emits a clarify-request event on uiStore (picked up by wsHandler and
 * broadcast to any connected browser clients), then waits up to
 * CLARIFY_TIMEOUT_MS for a clarify-response event.  Falls back to
 * CLARIFY_FALLBACK if no answer arrives in time.
 *
 * This function is a no-op for Ink/CLI users — they never emit
 * clarify-response, so the timeout path always fires.
 */
async function requestClarification(question: string): Promise<string> {
  uiStore.pushConversationClarifyQuestion(question);
  uiStore.emit("clarify-request", { question });

  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      uiStore.off("clarify-response", handler);
      const fallback = `${CLARIFY_FALLBACK} (no response after ${CLARIFY_TIMEOUT_MS / 1000}s)`;
      uiStore.pushConversationClarifyAnswer(fallback);
      resolve(CLARIFY_FALLBACK);
    }, CLARIFY_TIMEOUT_MS);

    function handler(answer: string) {
      clearTimeout(timer);
      uiStore.pushConversationClarifyAnswer(answer);
      resolve(answer);
    }

    uiStore.once("clarify-response", handler);
  });
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

// ---------------------------------------------------------------------------
// Edit context — find enclosing class/function by scanning backwards
// ---------------------------------------------------------------------------

interface EditContext {
  startLine: number;
  className: string;
  fnName: string;
  linesChanged: number;
  isInsert: boolean;
  ext: string;
}

function getEditContext(filePath: string, oldString: string, newString: string): EditContext {
  const isInsert = oldString === "";
  const linesChanged = isInsert
    ? newString.split("\n").length
    : oldString.split("\n").length;
  const ext = extname(filePath).toLowerCase().replace(".", "");
  const ctx: EditContext = { startLine: 0, className: "", fnName: "", linesChanged, isInsert, ext };

  if (!existsSync(filePath)) return ctx;
  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return ctx; }

  const searchStr = oldString || newString;
  const idx = searchStr ? content.indexOf(searchStr) : -1;
  const scanContent = idx !== -1 ? content.slice(0, idx) : content;
  if (idx !== -1) {
    ctx.startLine = scanContent.split("\n").length; // 1-based
  }

  const lines = scanContent.split("\n");

  let classPat: RegExp;
  let fnPat: RegExp;

  if (ext === "ex" || ext === "exs") {
    classPat = /^\s*defmodule\s+([\w.]+)\s+do/;
    fnPat = /^\s*defp?\s+(\w+)\s*[\s(]/;
  } else if (ext === "py") {
    classPat = /^\s*class\s+(\w+)\s*[(:]/;
    fnPat = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/;
  } else {
    // JS / TS / TSX
    classPat = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;
    // Three sub-patterns: named function keyword, access-modified method, bare method
    fnPat = new RegExp(
      [
        // function foo( / async function foo( / export function foo(
        "(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*(\\w+)\\s*[(<]",
        // public/private/etc. method: public async foo(
        "(?:(?:public|private|protected|static|override|get|set)\\s+)+(?:async\\s+)?(\\w+)\\s*[(<]",
        // bare method definition: foo( ... ) { or foo( ... ): ReturnType {
        "^\\s*(?:async\\s+)?(\\w+)\\s*\\(",
      ].join("|"),
    );
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!ctx.fnName) {
      const m = line.match(fnPat);
      if (m) ctx.fnName = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    }
    if (!ctx.className) {
      const m = line.match(classPat);
      if (m) ctx.className = (m[1] ?? "").trim();
    }
    if (ctx.fnName && ctx.className) break;
  }

  return ctx;
}

export function routeToolUse(name: string, input: Record<string, unknown> | undefined): void {
  if (name === "Bash") {
    const cmd = typeof input?.command === "string" ? input.command : "(unknown)";
    uiStore.pushCommand(cmd);
    uiStore.pushConversationCommand(cmd);
  } else if (FILE_TOOLS.has(name)) {
    const filePath =
      typeof input?.file_path === "string" ? input.file_path : "(unknown)";
    const opType = name.toLowerCase() as "read" | "write" | "edit";
    const preview = getFileOpPreview(name, input);
    uiStore.pushFileOp({ type: opType, path: filePath, preview });
    // Notify listeners when the agent writes/edits package.json so the npm
    // scripts list can be refreshed proactively (fs.watch is unreliable for
    // sandboxed SDK file tools).
    if ((name === "Write" || name === "Edit") && filePath.endsWith("package.json")) {
      uiStore.emit("package-json-changed");
    }
    // Record Write/Edit events in the conversation timeline, skipping features/ tracking files
    const inFeaturesDir = /[/\\]features[/\\]|^features[/\\]/.test(filePath);
    if (!inFeaturesDir && name === "Edit") {
      const oldStr = typeof input?.old_string === "string" ? input.old_string : "";
      const newStr = typeof input?.new_string === "string" ? input.new_string : "";
      const ctx = getEditContext(filePath, oldStr, newStr);
      uiStore.pushConversationFileOp("Edit", filePath, {
        old: oldStr,
        new: newStr,
        startLine: ctx.startLine,
        className: ctx.className,
        fnName: ctx.fnName,
        linesChanged: ctx.linesChanged,
        isInsert: ctx.isInsert,
        ext: ctx.ext,
      });
    } else if (!inFeaturesDir && name === "Write") {
      const content = typeof input?.content === "string" ? input.content : "";
      const lines = content.split("\n").length;
      uiStore.pushConversationFileOp("Write", filePath, {
        preview: content,
        lines,
      });
    }
  } else if (name === "Agent") {
    const subagentType =
      typeof input?.subagent_type === "string" ? input.subagent_type : "unknown";
    const description =
      typeof input?.description === "string" ? input.description : "";
    const prompt =
      typeof input?.prompt === "string" ? input.prompt : "";
    // Compact label for the InkJS commands panel
    uiStore.pushCommand(`Agent(${subagentType}): ${description}`);
    // Rich agent block for the web conversation feed
    uiStore.pushConversationAgent(subagentType, description, prompt);
  } else if (name === "Grep") {
    const pattern = typeof input?.pattern === "string" ? input.pattern : "(unknown)";
    const grepPath = typeof input?.path === "string" ? basename(input.path) : ".";
    const label = `Grepping for ${pattern} in ${grepPath}`;
    uiStore.pushCommand(label);
    uiStore.pushConversationCommand(label);
  } else {
    // Other tools (Glob, etc.) — truncate only for the narrow InkJS panel
    const inputStr = JSON.stringify(input);
    const inkLabel = `${name}: ${inputStr.length > 60 ? `${inputStr.slice(0, 60)}…` : inputStr}`;
    const fullLabel = `${name}: ${inputStr}`;
    uiStore.pushCommand(inkLabel);
    uiStore.pushConversationCommand(fullLabel);
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
    const timeout = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 30_000),
    );
    return (await Promise.race([client.run(prompt), timeout])).trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Title generation — uses a cheap model to produce a 20-80 char title
// ---------------------------------------------------------------------------

const TITLE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Calls a low-cost model to produce a concise title (20-80 characters) for a
 * feature based on its file content.  Returns an empty string on any error so
 * callers can gracefully degrade to the filename-derived name.
 */
export async function generateTitle(
  featureContent: string,
  projectDir: string,
): Promise<string> {
  if (!featureContent.trim()) return "";

  const prompt =
    `The following is a software feature request. ` +
    `Write a short title for this feature between 20 and 80 characters. ` +
    `The title should be a concise, descriptive phrase (not a sentence — no trailing period). ` +
    `Output only the title, nothing else.\n\n` +
    `<feature>\n${featureContent}\n</feature>`;

  try {
    const client = new KaiClient(projectDir, TITLE_MODEL);
    const timeout = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 30_000),
    );
    const raw = (await Promise.race([client.run(prompt), timeout])).trim();
    // Enforce the 20-80 character constraint
    if (raw.length < 20 || raw.length > 80) {
      // Truncate or return as-is if close enough
      if (raw.length > 80) return raw.slice(0, 80);
      if (raw.length > 0) return raw;
    }
    return raw;
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
