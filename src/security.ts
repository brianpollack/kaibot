import { platform } from "os";

import type {
  HookCallback,
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Bash/shell commands permitted on Unix (Linux/macOS).
 */
const ALLOWED_UNIX = new Set([
  // Filesystem
  "ls",
  "cat",
  "echo",
  "find",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "touch",
  "chmod",
  "cd",
  // Search
  "grep",
  "rg",
  "awk",
  "sed",
  // Node / package management
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "tsx",
  "tsc",
  // Python
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  // Git
  "git",
  // Elixir
  "mix",
  "elixir",
  "iex",
  "hex",
  // Network (read-only)
  "curl",
  "wget",
  // Database
  "psql",
  // Graphics
  "sips",
  "convert",
]);

/**
 * Commands permitted on Windows (CMD / PowerShell / Git Bash).
 * Includes native Windows equivalents and cross-platform tools
 * commonly available via Git for Windows.
 */
const ALLOWED_WINDOWS = new Set([
  // Filesystem (CMD built-ins)
  "dir",
  "type",
  "copy",
  "move",
  "del",
  "md",
  "rd",
  "mkdir",
  "cd",
  "echo",
  // PowerShell executables
  "powershell",
  "pwsh",
  // Search / text processing
  "grep",
  "rg",
  "find",
  "findstr",
  "where",
  "awk",
  "sed",
  // Node / package management
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "tsx",
  "tsc",
  // Python
  "python",
  "python3",
  "pip",
  "pip3",
  "uv",
  // Git
  "git",
  // Elixir
  "mix",
  "elixir",
  "iex",
  "hex",
  // Network (curl is built into Windows 10+)
  "curl",
  // Database
  "psql",
  // Graphics (ImageMagick)
  "convert",
  "magick",
]);

const IS_WINDOWS = platform() === "win32";
const ALLOWED_COMMANDS = IS_WINDOWS ? ALLOWED_WINDOWS : ALLOWED_UNIX;

/**
 * PreToolUse hook that validates Bash/shell commands against an allowlist.
 * Commands not in ALLOWED_COMMANDS are blocked.
 *
 * On Windows, strips a leading `cmd /c` or `powershell -Command` wrapper
 * before extracting the base command.
 */
export const bashSecurityHook: HookCallback = async (input): Promise<SyncHookJSONOutput> => {
  const preToolInput = input as PreToolUseHookInput;
  const toolInput = preToolInput.tool_input as { command?: string } | undefined;
  const command = toolInput?.command?.trim() ?? "";

  // On Windows, strip a shell-launcher prefix so we validate the actual command.
  const normalized = IS_WINDOWS
    ? command
        .replace(
          /^(?:cmd(?:\.exe)?\s+\/[cC]\s+|powershell(?:\.exe)?\s+-(?:Command|c)\s+)/i,
          "",
        )
        .trim()
    : command;

  const baseCommand = (normalized.split(/\s+/)[0] ?? "").toLowerCase();

  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return {
      decision: "block",
      reason: `Command '${baseCommand}' is not in the allowed commands list. Add it to ALLOWED_COMMANDS in security.ts if needed.`,
    };
  }

  return {};
};
