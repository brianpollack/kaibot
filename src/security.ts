import type {
  HookCallback,
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

/**
 * Bash commands that are permitted to run within the project sandbox.
 */
const ALLOWED_COMMANDS = new Set([
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
  "tsx",
  "tsc",
  // Python
  "python",
  "python3",
  "pip",
  "pip3",
  // Git
  "git",
  // Elixir
  "mix",
  "elixir",
  "iex",
  // Network (read-only)
  "curl",
  "wget",
]);

/**
 * PreToolUse hook that validates Bash commands against an allowlist.
 * Commands not in ALLOWED_COMMANDS are blocked.
 */
export const bashSecurityHook: HookCallback = async (input): Promise<SyncHookJSONOutput> => {
  const preToolInput = input as PreToolUseHookInput;
  const toolInput = preToolInput.tool_input as { command?: string } | undefined;
  const command = toolInput?.command?.trim() ?? "";
  const baseCommand = command.split(/\s+/)[0] ?? "";

  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return {
      decision: "block",
      reason: `Command '${baseCommand}' is not in the allowed commands list. Add it to ALLOWED_COMMANDS in security.ts if needed.`,
    };
  }

  return {};
};
