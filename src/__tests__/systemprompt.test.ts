import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSystemPrompt, loadClaudeMd } from "../KaiClient.js";

// ---------------------------------------------------------------------------
// Temp directory for test fixtures
// ---------------------------------------------------------------------------

const TEST_DIR = join(import.meta.dirname ?? ".", "__tmp_systemprompt_test__");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadClaudeMd
// ---------------------------------------------------------------------------

describe("loadClaudeMd", () => {
  it("returns undefined when CLAUDE.md does not exist", () => {
    expect(loadClaudeMd(TEST_DIR)).toBeUndefined();
  });

  it("returns undefined when CLAUDE.md is empty", () => {
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "");
    expect(loadClaudeMd(TEST_DIR)).toBeUndefined();
  });

  it("returns undefined when CLAUDE.md is only whitespace", () => {
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "   \n\n  ");
    expect(loadClaudeMd(TEST_DIR)).toBeUndefined();
  });

  it("returns trimmed content when CLAUDE.md has content", () => {
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "  # My Project\n\nSome instructions.\n  ");
    expect(loadClaudeMd(TEST_DIR)).toBe("# My Project\n\nSome instructions.");
  });

  it("returns undefined for a non-existent directory", () => {
    expect(loadClaudeMd(join(TEST_DIR, "nope"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  it("returns only the base prompt when no CLAUDE.md exists", () => {
    const prompt = buildSystemPrompt(TEST_DIR);
    expect(prompt).toContain("expert software developer");
    expect(prompt).not.toContain("CLAUDE.md");
    expect(prompt).not.toContain("OVERRIDE");
  });

  it("appends CLAUDE.md content to the system prompt", () => {
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "# Rules\n\n- Use tabs not spaces");
    const prompt = buildSystemPrompt(TEST_DIR);
    expect(prompt).toContain("expert software developer");
    expect(prompt).toContain("# Rules");
    expect(prompt).toContain("- Use tabs not spaces");
    expect(prompt).toContain("OVERRIDE");
  });

  it("does not append when CLAUDE.md is empty", () => {
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), "");
    const prompt = buildSystemPrompt(TEST_DIR);
    expect(prompt).not.toContain("OVERRIDE");
  });
});
