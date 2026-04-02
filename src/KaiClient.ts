import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

import {
  query,
  type Options,
  type Query,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { bashSecurityHook } from "./security.js";
import type { ProviderName } from "./models.js";

// ---------------------------------------------------------------------------
// Shell environment resolution
// ---------------------------------------------------------------------------

/**
 * Captures the user's full shell environment once at module load by spawning
 * a login shell that also sources the interactive RC file.
 *
 * Why this is needed:
 *   macOS .app bundles launched from Finder/Dock receive only the minimal
 *   launchd environment — no Homebrew, no nvm, no pyenv, etc. A login shell
 *   (-l) sources /etc/zprofile and ~/.zprofile. Explicitly sourcing ~/.zshrc
 *   (or ~/.bashrc) on top of that picks up nvm, volta, and anything else the
 *   user configured for interactive sessions.
 *
 * The result is merged over process.env so Electron-specific vars are kept
 * but PATH and tool-specific vars come from the real user environment.
 */
const SHELL_ENV: NodeJS.ProcessEnv = (() => {
  if (process.platform === "win32") return { ...process.env };

  const shell = process.env.SHELL ?? "/bin/zsh";
  const shellName = shell.split("/").pop() ?? "";

  // Source the interactive RC file on top of the login environment so that
  // nvm, volta, and similar per-session tools are included.
  const sourceRc =
    shellName === "zsh"
      ? '[ -f ~/.zshrc ] && . ~/.zshrc 2>/dev/null;'
      : shellName === "bash"
        ? '[ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null;'
        : "";

  try {
    const raw = execSync(`${shell} -l -c '${sourceRc} env'`, {
      encoding: "utf8",
      timeout: 8000,
    });

    const shellEnv: NodeJS.ProcessEnv = {};
    for (const line of raw.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) shellEnv[line.slice(0, eq)] = line.slice(eq + 1);
    }
    // Prefer the shell's values (PATH etc.) but keep Electron-injected vars.
    return { ...process.env, ...shellEnv };
  } catch {
    return { ...process.env };
  }
})();

// ---------------------------------------------------------------------------
// Tool lists
// ---------------------------------------------------------------------------

const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"];

// ---------------------------------------------------------------------------
// Security settings written to disk so Claude Code respects sandbox / permissions
// ---------------------------------------------------------------------------

/**
 * Package-manager and build-tool commands that need outbound network access
 * (registry fetches, dependency downloads, etc.).  These are excluded from
 * the sandbox's network restrictions while every other command remains fully
 * sandboxed.  The list is intentionally narrow — only tools whose primary job
 * requires the network are included.
 */
const SANDBOX_NETWORK_COMMANDS = [
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
  "mix",
  "hex",
];

interface SecuritySettings {
  sandbox: {
    enabled: boolean;
    autoAllowBashIfSandboxed: boolean;
    excludedCommands: string[];
  };
  permissions: { defaultMode: string; allow: string[] };
  autoMemoryEnabled: boolean;
}

function buildSecuritySettings(): SecuritySettings {
  return {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      excludedCommands: SANDBOX_NETWORK_COMMANDS,
    },
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
// Claude executable resolution
// ---------------------------------------------------------------------------

/**
 * Returns the path to the native `claude` binary if it can be found at one
 * of the standard install locations, or `undefined` to let the SDK fall back
 * to `node cli.js`.
 *
 * In a packaged Electron app `node` is not on the spawned-process PATH, so we
 * need the self-contained native binary instead.
 */
export function findClaudeExecutable(): string | undefined {
  const home = homedir();
  const candidates =
    process.platform === "win32"
      ? [
          join(home, ".local", "bin", "claude.exe"),
          join(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
          join(home, ".claude", "local", "claude.exe"),
          "C:\\Program Files\\Claude\\claude.exe",
        ]
      : [
          join(home, ".local", "bin", "claude"),
          join(home, ".claude", "local", "claude"),
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
          "/usr/bin/claude",
        ];

  return candidates.find((p) => existsSync(p));
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
  readonly provider: ProviderName;

  private readonly settingsFile: string;

  /** Saved env values to restore when switching away from OpenRouter. */
  private savedEnv: { apiKey?: string; baseUrl?: string; authToken?: string } = {};

  constructor(projectDir: string, model: string, provider: ProviderName = "anthropic") {
    this.provider = provider;

    // For OpenRouter, configure the SDK to use OpenRouter's API
    if (provider === "openrouter") {
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error(
          "OPENROUTER_API_KEY environment variable not set.\n" +
            "Get your API key from: https://openrouter.ai/keys",
        );
      }
      // Save current env values for potential restoration
      this.savedEnv = {
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        authToken: process.env.ANTHROPIC_AUTH_TOKEN,
      };
      // Configure env vars for Claude Agent SDK to use OpenRouter
      process.env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
      process.env.ANTHROPIC_AUTH_TOKEN = process.env.OPENROUTER_API_KEY;
      process.env.ANTHROPIC_API_KEY = "";
    } else {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          "ANTHROPIC_API_KEY environment variable not set.\n" +
            "Get your API key from: https://console.anthropic.com/",
        );
      }
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
  static create(projectDir: string, model: string, provider: ProviderName = "anthropic"): KaiClient {
    const client = new KaiClient(projectDir, model, provider);
    client.init();
    return client;
  }

  /**
   * Restore environment variables to their pre-OpenRouter state.
   * Call this when switching back from OpenRouter to Anthropic.
   */
  restoreEnv(): void {
    if (this.provider === "openrouter" && this.savedEnv.apiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = this.savedEnv.apiKey;
      if (this.savedEnv.baseUrl !== undefined) {
        process.env.ANTHROPIC_BASE_URL = this.savedEnv.baseUrl;
      } else {
        delete process.env.ANTHROPIC_BASE_URL;
      }
      if (this.savedEnv.authToken !== undefined) {
        process.env.ANTHROPIC_AUTH_TOKEN = this.savedEnv.authToken;
      } else {
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      }
    }
  }

  /**
   * Runs a prompt and returns the raw async message stream.
   * Use this when you need full control over individual messages.
   *
   * @param resumeSessionId  Optional session ID to resume a previous conversation.
   */
  query(prompt: string, resumeSessionId?: string): Query {
    const opts = this.buildOptions();
    if (resumeSessionId) {
      opts.resume = resumeSessionId;
    }
    return query({ prompt, options: opts });
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
      // In a packaged Electron app, `node` is not on the spawned-process PATH.
      // Pointing to the native claude binary avoids the node-in-PATH requirement.
      pathToClaudeCodeExecutable: findClaudeExecutable(),
      // Use the full login-shell environment so npm, git, nvm-managed node,
      // etc. resolve correctly when launched from a GUI context.
      env: SHELL_ENV,
    };
  }
}
