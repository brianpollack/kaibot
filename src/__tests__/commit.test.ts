import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCommitMessage, extractFeatureDescription } from "../commit.js";
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

describe("extractFeatureDescription", () => {
  it("extracts content before ## Plan section", () => {
    const content =
      "Add a dark mode toggle to settings\n\n## Plan\n\n- [x] 1. Do stuff\n\n## Summary\n\nDone.\n";
    expect(extractFeatureDescription(content, "fallback")).toBe(
      "Add a dark mode toggle to settings",
    );
  });

  it("extracts multi-line description joined with spaces", () => {
    const content =
      "When committing changes to git\nuse the feature description as commit text\n\n## Plan\n\n- [x] 1. Step\n";
    expect(extractFeatureDescription(content, "fallback")).toBe(
      "When committing changes to git use the feature description as commit text",
    );
  });

  it("stops at ## Summary if no ## Plan", () => {
    const content = "Fix the login bug\n\n## Summary\n\nFixed it.\n";
    expect(extractFeatureDescription(content, "fallback")).toBe(
      "Fix the login bug",
    );
  });

  it("stops at ## Metadata", () => {
    const content = "Update deps\n\n## Metadata\n\n- Model: opus\n";
    expect(extractFeatureDescription(content, "fallback")).toBe("Update deps");
  });

  it("returns fallback when content is empty", () => {
    expect(extractFeatureDescription("", "my_feature")).toBe("my_feature");
  });

  it("returns fallback when content is only sections", () => {
    const content = "## Plan\n\n- [x] 1. Step\n";
    expect(extractFeatureDescription(content, "my_feature")).toBe("my_feature");
  });
});

describe("buildCommitMessage", () => {
  it("uses the feature description (content before ## Plan)", () => {
    const feature = makeFeature(
      tmpDir,
      "my_feature",
      "Add a cool widget to the dashboard\n\n## Plan\n\n- [x] 1. Did it\n\n## Summary\n\nAdded a cool widget.\n",
    );
    const msg = buildCommitMessage(feature);
    expect(msg).toBe("Add a cool widget to the dashboard");
  });

  it("falls back to feature name when file is unreadable", () => {
    const feature: Feature = {
      name: "missing_feature",
      state: "complete",
      filePath: join(tmpDir, "nonexistent.md"),
    };
    const msg = buildCommitMessage(feature);
    expect(msg).toBe("missing_feature");
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
    const feature = makeFeature(
      tmpDir,
      "widget",
      "Add widget to the dashboard\n\n## Plan\n\n- [x] 1. Did it\n\n## Summary\n\nAdded widget.\n",
    );
    // Create an uncommitted file
    writeFileSync(join(tmpDir, "new_file.ts"), "export const x = 1;\n");

    mockStore.showCommitPrompt.mockResolvedValueOnce(true);

    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(true);

    // Verify the commit was created with the feature description (not the summary)
    const log = execSync("git log --oneline -1", { cwd: tmpDir, encoding: "utf8" });
    expect(log).toContain("Add widget to the dashboard");
  });

  it("does not commit when user declines", async () => {
    initGitRepo(tmpDir);
    const feature = makeFeature(
      tmpDir,
      "widget",
      "Add widget to the dashboard\n\n## Summary\n\nAdded widget.\n",
    );
    writeFileSync(join(tmpDir, "new_file.ts"), "export const x = 1;\n");

    mockStore.showCommitPrompt.mockResolvedValueOnce(false);

    const result = await promptAndCommit(feature, tmpDir);
    expect(result).toBe(false);

    // Verify no new commit was created (last commit should still be 'init')
    const log = execSync("git log --oneline -1", { cwd: tmpDir, encoding: "utf8" });
    expect(log).not.toContain("Add widget to the dashboard");
  });
});
