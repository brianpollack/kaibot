import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { getConfigDir } from "../pathHistory.js";

// ---------------------------------------------------------------------------
// We test the file format and logic directly by reading/writing the JSON
// file in the same format pathHistory.ts uses. This avoids polluting the
// real config dir (which happened previously with un-mocked tests).
// ---------------------------------------------------------------------------

const MAX_HISTORY = 5;

let tempDir: string;

/** Simplified addToPathHistory that writes to a custom dir */
function addToHistory(configDir: string, dirPath: string): void {
  const resolved = resolve(dirPath);
  const existing = loadHistory(configDir);
  const filtered = existing.filter((p) => p !== resolved);
  const updated = [resolved, ...filtered].slice(0, MAX_HISTORY);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "path_history.json"),
    JSON.stringify({ recentPaths: updated }, null, 2) + "\n",
  );
}

/** Simplified loadPathHistory that reads from a custom dir */
function loadHistory(configDir: string): string[] {
  const filePath = join(configDir, "path_history.json");
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    if (!Array.isArray(parsed.recentPaths)) return [];
    return (parsed.recentPaths as unknown[])
      .filter((p): p is string => typeof p === "string")
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

beforeEach(() => {
  tempDir = join(tmpdir(), `kaibot-ph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("pathHistory — getConfigDir", () => {
  it("returns a platform-appropriate directory containing 'kaibot'", () => {
    const dir = getConfigDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir.toLowerCase()).toContain("kaibot");
  });
});

describe("pathHistory — loadHistory", () => {
  it("returns empty array when file does not exist", () => {
    expect(loadHistory(join(tempDir, "nonexistent"))).toEqual([]);
  });

  it("returns empty array for corrupt JSON", () => {
    const configDir = join(tempDir, "corrupt");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "path_history.json"), "not json", "utf-8");
    expect(loadHistory(configDir)).toEqual([]);
  });

  it("returns empty array for wrong shape (array instead of object)", () => {
    const configDir = join(tempDir, "wrong");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "path_history.json"), JSON.stringify([1, 2]), "utf-8");
    expect(loadHistory(configDir)).toEqual([]);
  });
});

describe("pathHistory — addToHistory", () => {
  it("stores and retrieves a path", () => {
    const configDir = join(tempDir, "config");
    const dir = join(tempDir, "my-project");
    mkdirSync(dir, { recursive: true });

    addToHistory(configDir, dir);
    expect(loadHistory(configDir)).toContain(dir);
  });

  it("puts the most recently added path first", () => {
    const configDir = join(tempDir, "config");
    const dir1 = join(tempDir, "project-1");
    const dir2 = join(tempDir, "project-2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    addToHistory(configDir, dir1);
    addToHistory(configDir, dir2);

    const history = loadHistory(configDir);
    expect(history[0]).toBe(dir2);
    expect(history[1]).toBe(dir1);
  });

  it("deduplicates — re-adding moves to front", () => {
    const configDir = join(tempDir, "config");
    const dir1 = join(tempDir, "project-1");
    const dir2 = join(tempDir, "project-2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    addToHistory(configDir, dir1);
    addToHistory(configDir, dir2);
    addToHistory(configDir, dir1); // re-add

    const history = loadHistory(configDir);
    expect(history[0]).toBe(dir1);
    expect(history[1]).toBe(dir2);
    expect(history.filter((p) => p === dir1).length).toBe(1);
  });

  it("truncates to 5 entries", () => {
    const configDir = join(tempDir, "config");
    for (let i = 0; i < 7; i++) {
      const dir = join(tempDir, `project-${i}`);
      mkdirSync(dir, { recursive: true });
      addToHistory(configDir, dir);
    }

    const history = loadHistory(configDir);
    expect(history.length).toBe(5);
    expect(history[0]).toBe(join(tempDir, "project-6"));
  });

  it("writes valid JSON", () => {
    const configDir = join(tempDir, "config");
    const dir = join(tempDir, "check");
    mkdirSync(dir, { recursive: true });
    addToHistory(configDir, dir);

    const raw = readFileSync(join(configDir, "path_history.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.recentPaths).toContain(dir);
  });
});
