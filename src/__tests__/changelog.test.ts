import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Feature } from "../feature.js";
import { appendChangelog, extractDescription } from "../changelog.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kai-changelog-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFeature(name: string, content: string): Feature {
  const filePath = join(tmpDir, `${name}_complete.md`);
  writeFileSync(filePath, content);
  return { name, state: "complete", filePath };
}

function initGitRepo(branch = "main"): void {
  execSync(
    `git init -b ${branch} && git config user.email "test@test.com" && git config user.name "Test" && git commit --allow-empty -m "init"`,
    { cwd: tmpDir, stdio: "ignore" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendChangelog", () => {
  it("creates CHANGELOG.md with header if it does not exist", () => {
    initGitRepo();
    const feature = makeFeature("my_feature", "Add a cool widget\n");
    const date = new Date(2025, 2, 10); // March 10th, 2025

    appendChangelog(feature, tmpDir, date);

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("# Changelog");
    expect(changelog).toContain("March 10th, 2025");
    expect(changelog).toContain("main");
    expect(changelog).toContain("Add a cool widget");
  });

  it("appends to existing CHANGELOG.md without duplicating header", () => {
    initGitRepo();
    writeFileSync(join(tmpDir, "CHANGELOG.md"), "# Changelog\n\nPrevious entry\n\n");

    const feature = makeFeature("second", "Second feature description\n");
    const date = new Date(2025, 8, 21); // September 21st, 2025

    appendChangelog(feature, tmpDir, date);

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    // Should not have a second "# Changelog" header
    const headerCount = (changelog.match(/# Changelog/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(changelog).toContain("September 21st, 2025");
    expect(changelog).toContain("Second feature description");
  });

  it("includes the git branch name", () => {
    initGitRepo("test_branch");
    const feature = makeFeature("branched", "Branched feature\n");

    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("test_branch");
  });

  it("includes the current user", () => {
    initGitRepo();
    const feature = makeFeature("user_check", "User check feature\n");
    const expectedUser = process.env.USER ?? process.env.USERNAME ?? "unknown";

    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(expectedUser);
  });

  it("uses feature name as fallback when file cannot be read", () => {
    initGitRepo();
    // Create a feature pointing to a non-existent file
    const feature: Feature = {
      name: "missing_feature",
      state: "complete",
      filePath: join(tmpDir, "nonexistent.md"),
    };

    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("missing_feature");
  });

  it("prefers ## Summary section over first content line", () => {
    initGitRepo();
    const content = [
      "Let's update the UI to use the node ink library for a full screen colorful interface.",
      "",
      "## Plan",
      "- [x] 1. Step one",
      "",
      "## Summary",
      "",
      "Updated UI to use inkjs for full-screen rendering.",
    ].join("\n");

    const feature = makeFeature("with_summary", content);
    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Updated UI to use inkjs for full-screen rendering.");
    expect(changelog).not.toContain("Let's update the UI");
  });

  it("falls back to first content line when no ## Summary exists", () => {
    initGitRepo();
    const content = [
      "# My Feature",
      "",
      "This is the actual description.",
      "",
      "## Plan",
      "- [x] 1. Step one",
    ].join("\n");

    const feature = makeFeature("with_plan", content);
    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("This is the actual description.");
    expect(changelog).not.toContain("# My Feature");
    expect(changelog).not.toContain("Step one");
  });

  it("formats date ordinal suffixes correctly", () => {
    initGitRepo();
    const feature = makeFeature("suffix_test", "Test\n");

    // 1st
    appendChangelog(feature, tmpDir, new Date(2025, 0, 1));
    let changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("January 1st, 2025");

    // 2nd
    rmSync(join(tmpDir, "CHANGELOG.md"));
    appendChangelog(feature, tmpDir, new Date(2025, 0, 2));
    changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("January 2nd, 2025");

    // 3rd
    rmSync(join(tmpDir, "CHANGELOG.md"));
    appendChangelog(feature, tmpDir, new Date(2025, 0, 3));
    changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("January 3rd, 2025");

    // 11th (not 11st)
    rmSync(join(tmpDir, "CHANGELOG.md"));
    appendChangelog(feature, tmpDir, new Date(2025, 0, 11));
    changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("January 11th, 2025");
  });

  it("stops reading Summary at next heading", () => {
    initGitRepo();
    const content = [
      "Some conversational description.",
      "",
      "## Summary",
      "",
      "Concise summary line.",
      "",
      "## Metadata",
      "",
      "- **Cost:** $0.05",
    ].join("\n");

    const feature = makeFeature("summary_stop", content);
    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Concise summary line.");
    expect(changelog).not.toContain("$0.05");
  });

  it("handles non-git directories gracefully", () => {
    // No git init — should use "unknown" as branch
    const feature = makeFeature("no_git", "No git feature\n");

    appendChangelog(feature, tmpDir, new Date(2025, 2, 10));

    const changelog = readFileSync(join(tmpDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("unknown");
    expect(changelog).toContain("No git feature");
  });
});

// ---------------------------------------------------------------------------
// extractDescription (unit tests)
// ---------------------------------------------------------------------------

describe("extractDescription", () => {
  it("returns Summary content when present", () => {
    const content = "Let's do something cool.\n\n## Summary\n\nDid the cool thing.\n";
    expect(extractDescription(content, "fallback")).toBe("Did the cool thing.");
  });

  it("returns first content line when no Summary section", () => {
    const content = "# Title\n\nFirst real line.\n";
    expect(extractDescription(content, "fallback")).toBe("First real line.");
  });

  it("returns fallback when content is empty", () => {
    expect(extractDescription("", "my_fallback")).toBe("my_fallback");
  });

  it("returns fallback when content is only headings", () => {
    expect(extractDescription("# Heading\n## Another\n", "fb")).toBe("fb");
  });

  it("skips empty Summary section and falls back", () => {
    const content = "Description line.\n\n## Summary\n\n## Metadata\n\nstuff\n";
    expect(extractDescription(content, "fb")).toBe("Description line.");
  });
});
