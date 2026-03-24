import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deconflictPath,
  generateFeatureId,
  isNewFeatureFile,
  markComplete,
  markHold,
  markInProgress,
  parseFeature,
} from "../feature.js";

// ---------------------------------------------------------------------------
// generateFeatureId
// ---------------------------------------------------------------------------

describe("generateFeatureId", () => {
  it("returns a non-empty string", () => {
    const id = generateFeatureId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("returns an 8-character base64url string", () => {
    const id = generateFeatureId();
    expect(id).toHaveLength(8);
    // base64url: only alphanumeric, -, _
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateFeatureId()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// deconflictPath
// ---------------------------------------------------------------------------

describe("deconflictPath", () => {
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

  it("returns the plain path when no collision", () => {
    const result = deconflictPath(tmpDir, "my_feature", "abc123");
    expect(result.name).toBe("my_feature");
    expect(result.path).toBe(join(tmpDir, "my_feature.md"));
  });

  it("appends featureId when target already exists", () => {
    writeFileSync(join(tmpDir, "my_feature.md"), "existing");
    const result = deconflictPath(tmpDir, "my_feature", "abc123");
    expect(result.name).toBe("my_feature-abc123");
    expect(result.path).toBe(join(tmpDir, "my_feature-abc123.md"));
  });

  it("generates an ID when none supplied and target exists", () => {
    writeFileSync(join(tmpDir, "my_feature.md"), "existing");
    const result = deconflictPath(tmpDir, "my_feature");
    expect(result.name).toMatch(/^my_feature-[A-Za-z0-9_-]+$/);
    expect(result.path).toMatch(/my_feature-[A-Za-z0-9_-]+\.md$/);
  });
});

// ---------------------------------------------------------------------------
// isNewFeatureFile
// ---------------------------------------------------------------------------

describe("isNewFeatureFile", () => {
  it("accepts plain .md files", () => {
    expect(isNewFeatureFile("new_user.md")).toBe(true);
    expect(isNewFeatureFile("add-auth.md")).toBe(true);
    expect(isNewFeatureFile("feature.md")).toBe(true);
  });

  it("rejects _inprogress.md files (legacy)", () => {
    expect(isNewFeatureFile("new_user_inprogress.md")).toBe(false);
    expect(isNewFeatureFile("add-auth_inprogress.md")).toBe(false);
  });

  it("rejects _complete.md files (legacy)", () => {
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
  it("parses a new feature file in features root", () => {
    const f = parseFeature("/some/project/features/new_user.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("new");
    expect(f.filePath).toBe("/some/project/features/new_user.md");
  });

  it("parses a feature in the inprogress/ directory", () => {
    const f = parseFeature("/some/project/features/inprogress/new_user.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("inprogress");
    expect(f.filePath).toBe("/some/project/features/inprogress/new_user.md");
  });

  it("parses a feature in the complete/ directory", () => {
    const f = parseFeature("/some/project/features/complete/new_user.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("complete");
    expect(f.filePath).toBe("/some/project/features/complete/new_user.md");
  });

  it("parses a feature in the hold/ directory", () => {
    const f = parseFeature("/some/project/features/hold/new_user.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("hold");
    expect(f.filePath).toBe("/some/project/features/hold/new_user.md");
  });

  it("handles legacy _inprogress.md filename", () => {
    const f = parseFeature("/some/project/features/new_user_inprogress.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("inprogress");
  });

  it("handles legacy _complete.md filename", () => {
    const f = parseFeature("/some/project/features/new_user_complete.md");
    expect(f.name).toBe("new_user");
    expect(f.state).toBe("complete");
  });

  it("handles hyphenated feature names", () => {
    const f = parseFeature("/some/project/features/add-auth-flow.md");
    expect(f.name).toBe("add-auth-flow");
    expect(f.state).toBe("new");
  });

  it("preserves the directory in filePath", () => {
    const f = parseFeature("/absolute/path/to/features/my_feature.md");
    expect(f.filePath).toBe("/absolute/path/to/features/my_feature.md");
  });
});

// ---------------------------------------------------------------------------
// markInProgress — moves to inprogress/ subdirectory
// ---------------------------------------------------------------------------

describe("markInProgress", () => {
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

  it("moves .md to inprogress/ subdirectory and returns updated Feature", () => {
    const src = join(tmpDir, "my_feature.md");
    writeFileSync(src, "# My Feature\n");

    const original = { name: "my_feature", state: "new" as const, filePath: src };
    const updated = markInProgress(original);

    const expectedPath = join(tmpDir, "inprogress", "my_feature.md");
    expect(updated.state).toBe("inprogress");
    expect(updated.name).toBe("my_feature");
    expect(updated.filePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("creates the inprogress/ directory if it does not exist", () => {
    const src = join(tmpDir, "new_feat.md");
    writeFileSync(src, "# New\n");

    const original = { name: "new_feat", state: "new" as const, filePath: src };
    markInProgress(original);

    expect(existsSync(join(tmpDir, "inprogress"))).toBe(true);
  });

  it("throws if source file does not exist", () => {
    const missing = join(tmpDir, "ghost.md");
    const feature = { name: "ghost", state: "new" as const, filePath: missing };
    expect(() => markInProgress(feature)).toThrow();
  });

  it("appends featureId to filename when inprogress/ target already exists", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    mkdirSync(inprogressDir, { recursive: true });
    writeFileSync(join(inprogressDir, "my_feature.md"), "old content");

    const src = join(tmpDir, "my_feature.md");
    writeFileSync(src, "new content");
    const original = {
      name: "my_feature",
      state: "new" as const,
      filePath: src,
      featureId: "testid1",
    };
    const updated = markInProgress(original);

    expect(updated.name).toBe("my_feature-testid1");
    expect(updated.filePath).toBe(join(inprogressDir, "my_feature-testid1.md"));
    expect(existsSync(join(inprogressDir, "my_feature-testid1.md"))).toBe(true);
    // Original file in inprogress/ should be preserved
    expect(existsSync(join(inprogressDir, "my_feature.md"))).toBe(true);
    expect(existsSync(src)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markComplete — moves to complete/ subdirectory
// ---------------------------------------------------------------------------

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

  it("moves file from inprogress/ to complete/ and returns updated Feature", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    mkdirSync(inprogressDir, { recursive: true });
    const src = join(inprogressDir, "my_feature.md");
    writeFileSync(src, "# My Feature\n## Plan\n- [x] Done\n");

    const inprogress = { name: "my_feature", state: "inprogress" as const, filePath: src };
    const updated = markComplete(inprogress);

    const expectedPath = join(tmpDir, "complete", "my_feature.md");
    expect(updated.state).toBe("complete");
    expect(updated.name).toBe("my_feature");
    expect(updated.filePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("creates the complete/ directory if it does not exist", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    mkdirSync(inprogressDir, { recursive: true });
    const src = join(inprogressDir, "new_feat.md");
    writeFileSync(src, "# New\n");

    const inprogress = { name: "new_feat", state: "inprogress" as const, filePath: src };
    markComplete(inprogress);

    expect(existsSync(join(tmpDir, "complete"))).toBe(true);
  });

  it("throws if source file does not exist", () => {
    const missing = join(tmpDir, "inprogress", "ghost.md");
    const feature = { name: "ghost", state: "inprogress" as const, filePath: missing };
    expect(() => markComplete(feature)).toThrow();
  });

  it("appends featureId to filename when complete/ target already exists", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    const completeDir = join(tmpDir, "complete");
    mkdirSync(inprogressDir, { recursive: true });
    mkdirSync(completeDir, { recursive: true });
    writeFileSync(join(completeDir, "my_feature.md"), "old complete");

    const src = join(inprogressDir, "my_feature.md");
    writeFileSync(src, "new content");
    const inprogress = {
      name: "my_feature",
      state: "inprogress" as const,
      filePath: src,
      featureId: "testid2",
    };
    const updated = markComplete(inprogress);

    expect(updated.name).toBe("my_feature-testid2");
    expect(updated.filePath).toBe(join(completeDir, "my_feature-testid2.md"));
    expect(existsSync(join(completeDir, "my_feature-testid2.md"))).toBe(true);
    // Original file in complete/ should be preserved
    expect(existsSync(join(completeDir, "my_feature.md"))).toBe(true);
    expect(existsSync(src)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markHold — moves to hold/ subdirectory
// ---------------------------------------------------------------------------

describe("markHold", () => {
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

  it("moves file from inprogress/ to hold/ and returns updated Feature", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    mkdirSync(inprogressDir, { recursive: true });
    const src = join(inprogressDir, "my_feature.md");
    writeFileSync(src, "# My Feature\n");

    const inprogress = { name: "my_feature", state: "inprogress" as const, filePath: src };
    const updated = markHold(inprogress);

    const expectedPath = join(tmpDir, "hold", "my_feature.md");
    expect(updated.state).toBe("hold");
    expect(updated.name).toBe("my_feature");
    expect(updated.filePath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("creates the hold/ directory if it does not exist", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    mkdirSync(inprogressDir, { recursive: true });
    const src = join(inprogressDir, "new_feat.md");
    writeFileSync(src, "# New\n");

    const inprogress = { name: "new_feat", state: "inprogress" as const, filePath: src };
    markHold(inprogress);

    expect(existsSync(join(tmpDir, "hold"))).toBe(true);
  });

  it("throws if source file does not exist", () => {
    const missing = join(tmpDir, "inprogress", "ghost.md");
    const feature = { name: "ghost", state: "inprogress" as const, filePath: missing };
    expect(() => markHold(feature)).toThrow();
  });

  it("appends featureId to filename when hold/ target already exists", () => {
    const inprogressDir = join(tmpDir, "inprogress");
    const holdDir = join(tmpDir, "hold");
    mkdirSync(inprogressDir, { recursive: true });
    mkdirSync(holdDir, { recursive: true });
    writeFileSync(join(holdDir, "my_feature.md"), "old held");

    const src = join(inprogressDir, "my_feature.md");
    writeFileSync(src, "new content");
    const inprogress = {
      name: "my_feature",
      state: "inprogress" as const,
      filePath: src,
      featureId: "testid3",
    };
    const updated = markHold(inprogress);

    expect(updated.name).toBe("my_feature-testid3");
    expect(updated.filePath).toBe(join(holdDir, "my_feature-testid3.md"));
    expect(existsSync(join(holdDir, "my_feature-testid3.md"))).toBe(true);
    // Original file in hold/ should be preserved
    expect(existsSync(join(holdDir, "my_feature.md"))).toBe(true);
    expect(existsSync(src)).toBe(false);
  });
});
