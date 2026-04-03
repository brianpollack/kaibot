import { describe, expect, it } from "vitest";

import { bashSecurityHook } from "../security.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build the minimal PreToolUseHookInput that bashSecurityHook inspects.
 * The hook only reads `tool_input.command` — all other fields are irrelevant.
 */
function makeInput(command: string): object {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
  };
}

async function callHook(command: string) {
  // HookCallback signature: (input, toolUseID, options) — only input is used by bashSecurityHook
  return bashSecurityHook(
    makeInput(command) as Parameters<typeof bashSecurityHook>[0],
    undefined,
    { signal: new AbortController().signal },
  );
}

// ---------------------------------------------------------------------------
// Allowed commands
// ---------------------------------------------------------------------------

describe("bashSecurityHook — allowed commands", () => {
  const allowed = [
    // Filesystem
    "ls -la",
    "cat package.json",
    "echo hello",
    "find . -name '*.ts'",
    "mkdir -p dist",
    "cp src/a.ts src/b.ts",
    "mv old.ts new.ts",
    "rm -rf dist",          // rm IS allowed (command-level allowlist, not arg-level)
    "touch .env.local",
    "chmod +x script.sh",
    // Search
    "grep -r 'TODO' src/",
    "rg 'import' --type ts",
    "awk '{print $1}'",
    "sed -i 's/foo/bar/g' file.ts",
    // Node / package management
    "node dist/index.js",
    "npm install",
    "npm run test",
    "npx tsx src/kai_bot.ts .",
    "tsx src/index.ts",
    "tsc --noEmit",
    // Python
    "python -m pytest",
    "python3 script.py",
    "pip install requests",
    "pip3 install -r requirements.txt",
    // Git
    "git status",
    "git add -A",
    "git commit -m 'feat: add feature'",
    // Network
    "curl https://example.com",
    "wget https://example.com/file.zip",
  ];

  for (const cmd of allowed) {
    it(`allows: ${cmd.split(" ")[0]}`, async () => {
      const result = await callHook(cmd);
      expect(result).toEqual({});
    });
  }
});

// ---------------------------------------------------------------------------
// Blocked commands
// ---------------------------------------------------------------------------

describe("bashSecurityHook — blocked commands", () => {
  const blocked = [
    "sudo apt-get install vim",
    "eval 'rm -rf /'",
    "dd if=/dev/zero of=/dev/sda",
    "bash -c 'echo pwned'",
    "sh exploit.sh",
    "zsh -c 'cat /etc/passwd'",
    "python2 legacy.py",       // python2 not in list
    // yarn and pnpm are intentionally allowed in ALLOWED_UNIX
    "kill -9 1234",
    "pkill node",
    "shutdown -h now",
    "reboot",
    "cron",
    "nc -lvnp 4444",
    "ncat 192.168.1.1",
  ];

  for (const cmd of blocked) {
    it(`blocks: ${cmd.split(" ")[0]}`, async () => {
      const result = await callHook(cmd) as { decision?: string; reason?: string };
      expect(result.decision).toBe("block");
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("bashSecurityHook — edge cases", () => {
  it("blocks an empty command string", async () => {
    const result = await callHook("") as { decision?: string };
    expect(result.decision).toBe("block");
  });

  it("blocks a command with only whitespace", async () => {
    const result = await callHook("   ") as { decision?: string };
    expect(result.decision).toBe("block");
  });

  it("allows commands with leading whitespace by trimming", async () => {
    // command.trim() is applied before split
    const result = await callHook("  ls -la  ");
    expect(result).toEqual({});
  });

  it("blocks when tool_input is missing command property", async () => {
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {},
    };
    const result = await bashSecurityHook(
      input as Parameters<typeof bashSecurityHook>[0],
      undefined,
      { signal: new AbortController().signal },
    ) as { decision?: string };
    expect(result.decision).toBe("block");
  });

  it("blocks when tool_input is undefined", async () => {
    const input = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
    };
    const result = await bashSecurityHook(
      input as Parameters<typeof bashSecurityHook>[0],
      undefined,
      { signal: new AbortController().signal },
    ) as { decision?: string };
    expect(result.decision).toBe("block");
  });

  it("reason string mentions the blocked command name", async () => {
    const result = await callHook("sudo rm -rf /") as { reason?: string };
    expect(result.reason).toContain("sudo");
  });
});
