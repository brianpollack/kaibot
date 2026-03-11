import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCommitMessage } from "../commit.js";
import type { Feature } from "../feature.js";

// ---------------------------------------------------------------------------
// Mock the UI store so promptAndCommit can call showCommitPrompt
// ---------------------------------------------------------------------------

vi.mock("../ui/store.js", () => {
  const store = {
    setStatusMessage: vi.fn(),
    showCommitPrompt: vi.fn(),
    resolveCommitPrompt: vi.fn(),
  };
  return { uiStore: store };
});

import { uiStore } from "../ui/store.js";
import { promptAndCommit } from "../commit.js";

const mockStore = vi.mocked(uiStore);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
  // Create an initial commit so HEAD exists
  writeFileSync(join(dir, ".gitkeep"), "");
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" });
}

function makeFeature(dir: string, name: string, content: string): Feature {
  const filePath = join(dir, "features", `${name}_complete.md`);
  mkdirSync(join(dir, "features"), { recursive: true });
  writeFileSync(filePath, content);
  return { name, state: "complete", filePath };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kaibot-commit-test-"));
  vi.clearAllMocks();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// buildCommitMessage
// ---------------------------------------------------------------------------

describe("buildCommitMessage", () => {
  it("uses the Summary section from the feature file", () => {
    const feature = makeFeature(
      tmpDir,
      "my_feature",
      "# Feature\n\n## Summary\n\nAdded a cool widget to the dashboard.\n",
    );
    const msg = buildCommitMessage(feature);
    expect(msg).toBe("feat: Added a cool widget to the dashboard.");
  });

  it("falls back to feature name when file is unreadable", () => {
    const feature: Feature = {
      name: "missing_feature",
      state: "complete",
      filePath: join(tmpDir, "nonexistent.md"),
    };
    const msg = buildCommitMessage(feature);
    expect(msg).toBe("feat: missing_feature");
  });
});

// ---------------------------------------------------------------------------
// promptAndCommit
// ---------------------------------------------------------------------------

describe("promptAndCommit", () => {
  it("returns false when not in a git repo", async () => {
    const feature = makeFeature(tmpDir, "test", "# Test\n");
    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(false);
    expect(mockStore.showCommitPrompt).not.toHaveBeenCalled();
  });

  it("returns false when there are no changes", async () => {
    initGitRepo(tmpDir);
    // Stage and commit all existing files so there's nothing pending
    execSync("git add -A && git commit -m 'clean' --allow-empty", {
      cwd: tmpDir,
      stdio: "pipe",
    });

    const feature = makeFeature(tmpDir, "test", "# Test\n");
    // The makeFeature created a file — commit it too
    execSync("git add -A && git commit -m 'feature file'", {
      cwd: tmpDir,
      stdio: "pipe",
    });

    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(false);
  });

  it("commits when user confirms", async () => {
    initGitRepo(tmpDir);
    const feature = makeFeature(tmpDir, "widget", "# Widget\n\n## Summary\n\nAdded widget.\n");
    // Create an uncommitted file
    writeFileSync(join(tmpDir, "new_file.ts"), "export const x = 1;\n");

    mockStore.showCommitPrompt.mockResolvedValueOnce(true);

    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(true);

    // Verify the commit was created
    const log = execSync("git log --oneline -1", { cwd: tmpDir, encoding: "utf8" });
    expect(log).toContain("feat: Added widget.");
  });

  it("does not commit when user declines", async () => {
    initGitRepo(tmpDir);
    const feature = makeFeature(tmpDir, "widget", "# Widget\n\n## Summary\n\nAdded widget.\n");
    writeFileSync(join(tmpDir, "new_file.ts"), "export const x = 1;\n");

    mockStore.showCommitPrompt.mockResolvedValueOnce(false);

    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(false);

    // Verify no new commit was created (last commit should still be 'init')
    const log = execSync("git log --oneline -1", { cwd: tmpDir, encoding: "utf8" });
    expect(log).not.toContain("feat:");
  });
});
