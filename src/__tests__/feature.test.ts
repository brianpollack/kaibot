import { mkdtempSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isNewFeatureFile,
  markComplete,
  markInProgress,
  parseFeature,
} from "../feature.js";

// ---------------------------------------------------------------------------
// isNewFeatureFile
// ---------------------------------------------------------------------------

describe("isNewFeatureFile", () => {
  it("accepts plain .md files", () => {
    expect(isNewFeatureFile("new_user.md")).toBe(true);
    expect(isNewFeatureFile("add-auth.md")).toBe(true);
    expect(isNewFeatureFile("feature.md")).toBe(true);
  });

  it("rejects _inprogress.md files", () => {
    expect(isNewFeatureFile("new_user_inprogress.md")).toBe(false);
    expect(isNewFeatureFile("add-auth_inprogress.md")).toBe(false);
  });

  it("rejects _complete.md files", () => {
    expect(isNewFeatureFile("new_user_complete.md")).toBe(false);
    expect(isNewFeatureFile("add-auth_complete.md")).toBe(false);
  });

  it("rejects non-.md files", () => {
    expect(isNewFeatureFile("feature.txt")).toBe(false);
    expect(isNewFeatureFile("feature.ts")).toBe(false);
    expect(isNewFeatureFile("feature")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseFeature
// ---------------------------------------------------------------------------

describe("parseFeature", () => {
  const dir = "/some/project/features";

  it("parses a new feature file", () => {
    const f = parseFeature(join(dir, "new_user.md"));
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("new");
    expect(f.filePath).toBe(join(dir, "new_user.md"));
  });

  it("parses an inprogress feature file", () => {
    const f = parseFeature(join(dir, "new_user_inprogress.md"));
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("inprogress");
    expect(f.filePath).toBe(join(dir, "new_user_inprogress.md"));
  });

  it("parses a complete feature file", () => {
    const f = parseFeature(join(dir, "new_user_complete.md"));
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("complete");
    expect(f.filePath).toBe(join(dir, "new_user_complete.md"));
  });

  it("handles hyphenated feature names", () => {
    const f = parseFeature(join(dir, "add-auth-flow.md"));
    expect(f.name).toBe("add-auth-flow");
    expect(f.state).toBe("new");
  });

  it("preserves the directory in filePath", () => {
    const f = parseFeature("/absolute/path/to/features/my_feature.md");
    expect(f.filePath).toBe("/absolute/path/to/features/my_feature.md");
  });
});

// ---------------------------------------------------------------------------
// markInProgress / markComplete — require real files
// ---------------------------------------------------------------------------

describe("markInProgress", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-test-"));
  });

  afterEach(() => {
    // Clean up any leftover files; ignore errors if already gone
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("renames .md to _inprogress.md and returns updated Feature", () => {
    const src = join(tmpDir, "my_feature.md");
    writeFileSync(src, "# My Feature\n");

    const original = { name: "my_feature", state: "new" as const, filePath: src };
    const updated = markInProgress(original);

    const expectedPath = join(tmpDir, "my_feature_inprogress.md");
    expect(updated.state).toBe("inprogress");
    expect(updated.name).toBe("my_feature");
    expect(updated.filePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("throws if source file does not exist", () => {
    const missing = join(tmpDir, "ghost.md");
    const feature = { name: "ghost", state: "new" as const, filePath: missing };
    expect(() => markInProgress(feature)).toThrow();
  });
});

describe("markComplete", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("renames _inprogress.md to _complete.md and returns updated Feature", () => {
    const src = join(tmpDir, "my_feature_inprogress.md");
    writeFileSync(src, "# My Feature\n## Plan\n- [x] Done\n");

    const inprogress = { name: "my_feature", state: "inprogress" as const, filePath: src };
    const updated = markComplete(inprogress);

    const expectedPath = join(tmpDir, "my_feature_complete.md");
    expect(updated.state).toBe("complete");
    expect(updated.name).toBe("my_feature");
    expect(updated.filePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("throws if source file does not exist", () => {
    const missing = join(tmpDir, "ghost_inprogress.md");
    const feature = { name: "ghost", state: "inprogress" as const, filePath: missing };
    expect(() => markComplete(feature)).toThrow();
  });
});
