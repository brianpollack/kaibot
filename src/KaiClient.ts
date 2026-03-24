import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import {
  query,
  type Options,
  type Query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { bashSecurityHook } from "./security.js";

// ---------------------------------------------------------------------------
// Tool lists
// ---------------------------------------------------------------------------

const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

// ---------------------------------------------------------------------------
// Security settings written to disk so Claude Code respects sandbox / permissions
// ---------------------------------------------------------------------------

interface SecuritySettings {
  sandbox: { enabled: boolean; autoAllowBashIfSandboxed: boolean };
  permissions: { defaultMode: string; allow: string[] };
  autoMemoryEnabled: boolean;
}

function buildSecuritySettings(): SecuritySettings {
  return {
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true },
    permissions: {
      // Auto-approve file edits within the allowed directories below
      defaultMode: "acceptEdits",
      allow: [
        // Restrict all file operations to the project directory
        "Read(./**)",
        "Write(./**)",
        "Edit(./**)",
        "Glob(./**)",
        "Grep(./**)",
        // Bash is granted here; actual commands are validated by bashSecurityHook
        "Bash(*)",
      ],
    },
    autoMemoryEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT =
  "You are an expert software developer implementing features in an existing codebase. " +
  "Always read existing code to understand patterns and conventions before making changes.";

/**
 * Reads the project's CLAUDE.md file (if it exists) and returns its contents,
 * or `undefined` if the file is missing or unreadable.
 */
export function loadClaudeMd(projectDir: string): string | undefined {
  const claudeMdPath = join(projectDir, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return undefined;
  try {
    const content = readFileSync(claudeMdPath, "utf8").trim();
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the full system prompt: the base instructions plus any
 * project-specific context from CLAUDE.md.
 */
export function buildSystemPrompt(projectDir: string): string {
  const claudeMd = loadClaudeMd(projectDir);
  if (!claudeMd) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\nCodebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.\n\n${claudeMd}`;
}

// ---------------------------------------------------------------------------
// KaiClient
// ---------------------------------------------------------------------------

/**
 * Wraps the Claude Agent SDK client with project-scoped configuration:
 * a fixed working directory, model, system prompt, security sandbox,
 * Puppeteer MCP tools, and a Bash command allowlist hook.
 *
 * Security layers (defense in depth):
 *  1. Sandbox    — OS-level bash isolation prevents filesystem escape
 *  2. Permissions — file operations restricted to projectDir only
 *  3. Hook       — Bash commands validated against ALLOWED_COMMANDS (security.ts)
 */
export class KaiClient {
  readonly projectDir: string;
  readonly model: string;

  private readonly settingsFile: string;

  constructor(projectDir: string, model: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable not set.\n" +
          "Get your API key from: https://console.anthropic.com/",
      );
    }

    this.projectDir = resolve(projectDir);
    this.model = model;
    this.settingsFile = join(this.projectDir, ".kaibot", "settings.json");
  }

  /**
   * Writes the security settings file into the project directory.
   * Called automatically by create(). Safe to call on existing projects —
   * mkdirSync is a no-op if the directory already exists.
   */
  init(): void {
    mkdirSync(join(this.projectDir, ".kaibot"), { recursive: true });
    const settings = buildSecuritySettings();
    writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
  }

  /**
   * Convenience factory: constructs and initializes the client in one step.
   */
  static create(projectDir: string, model: string): KaiClient {
    const client = new KaiClient(projectDir, model);
    client.init();
    return client;
  }

  /**
   * Runs a prompt and returns the raw async message stream.
   * Use this when you need full control over individual messages.
   */
  query(prompt: string): Query {
    return query({ prompt, options: this.buildOptions() });
  }

  /**
   * Runs a prompt to completion and returns the final result string.
   * Throws if the query ends without a result or returns an error.
   */
  async run(prompt: string): Promise<string> {
    for await (const message of this.query(prompt)) {
      if (message.type === "result") {
        const result = message as SDKResultMessage;
        if (result.subtype === "success") {
          return result.result;
        }
        throw new Error(`Query failed (${result.subtype}): ${result.errors.join(", ")}`);
      }
    }
    throw new Error("Query completed without a result message");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildOptions(): Options {
    return {
      model: this.model,
      cwd: this.projectDir,
      settings: this.settingsFile,
      systemPrompt: buildSystemPrompt(this.projectDir),
      allowedTools: [...BUILTIN_TOOLS],
      settingSources: ["project"],
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [bashSecurityHook] }],
      },
      maxTurns: 1000,
      persistSession: true,
    };
  }
}
