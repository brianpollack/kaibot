import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFeatureFromDescription } from "../feature_creator.js";
import { uiStore } from "../ui/store.js";

// ---------------------------------------------------------------------------
// writeFeatureFromDescription
// ---------------------------------------------------------------------------

describe("writeFeatureFromDescription", () => {
  const tmpDir = join(import.meta.dirname ?? ".", "__tmp_hotkey_test__");
  const featuresDir = join(tmpDir, "features");

  beforeEach(() => {
    mkdirSync(featuresDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a feature file from a description", () => {
    const result = writeFeatureFromDescription(tmpDir, "Add dark mode toggle");
    expect(result).toBe("features/add_dark_mode_toggle.md");
    const content = readFileSync(join(featuresDir, "add_dark_mode_toggle.md"), "utf8");
    expect(content).toBe("Add dark mode toggle\n");
  });

  it("returns null for empty description", () => {
    expect(writeFeatureFromDescription(tmpDir, "")).toBeNull();
    expect(writeFeatureFromDescription(tmpDir, "   ")).toBeNull();
  });

  it("trims trailing whitespace from description", () => {
    const result = writeFeatureFromDescription(tmpDir, "  Add logging  \n  ");
    expect(result).toBe("features/add_logging.md");
    const content = readFileSync(join(featuresDir, "add_logging.md"), "utf8");
    expect(content).toBe("Add logging\n");
  });

  it("appends numeric suffix when slug already exists", () => {
    // Create first file
    writeFeatureFromDescription(tmpDir, "Add search");
    expect(existsSync(join(featuresDir, "add_search.md"))).toBe(true);

    // Create second file with same name
    const result2 = writeFeatureFromDescription(tmpDir, "Add search bar");
    // "Add search bar" derives to "add_search_bar" which is different
    expect(result2).toBe("features/add_search_bar.md");

    // Create an exact duplicate
    const result3 = writeFeatureFromDescription(tmpDir, "Add search");
    expect(result3).toBe("features/add_search_2.md");
    expect(existsSync(join(featuresDir, "add_search_2.md"))).toBe(true);
  });

  it("creates features/ directory if missing", () => {
    rmSync(featuresDir, { recursive: true, force: true });
    const result = writeFeatureFromDescription(tmpDir, "New feature");
    expect(result).toBe("features/new_feature.md");
    expect(existsSync(join(featuresDir, "new_feature.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UIStore hotkey state
// ---------------------------------------------------------------------------

describe("UIStore hotkey state", () => {
  afterEach(() => {
    uiStore.resetFeature();
  });

  it("starts with hotkeyInputActive = false", () => {
    expect(uiStore.getState().hotkeyInputActive).toBe(false);
    expect(uiStore.getState().hotkeyInputLines).toEqual([]);
  });

  it("startHotkeyInput activates input mode", () => {
    uiStore.startHotkeyInput();
    expect(uiStore.getState().hotkeyInputActive).toBe(true);
    expect(uiStore.getState().hotkeyInputLines).toEqual([]);
  });

  it("appendHotkeyInputLine adds lines", () => {
    uiStore.startHotkeyInput();
    uiStore.appendHotkeyInputLine("Hello");
    uiStore.appendHotkeyInputLine("World");
    expect(uiStore.getState().hotkeyInputLines).toEqual(["Hello", "World"]);
  });

  it("finishHotkeyInput deactivates and clears lines", () => {
    uiStore.startHotkeyInput();
    uiStore.appendHotkeyInputLine("test");
    uiStore.finishHotkeyInput();
    expect(uiStore.getState().hotkeyInputActive).toBe(false);
    expect(uiStore.getState().hotkeyInputLines).toEqual([]);
  });

  it("setFlashMessage / clearFlashMessage", () => {
    uiStore.setFlashMessage("Feature created!");
    expect(uiStore.getState().flashMessage).toBe("Feature created!");
    uiStore.clearFlashMessage();
    expect(uiStore.getState().flashMessage).toBe("");
  });

  it("resetFeature clears hotkey state", () => {
    uiStore.startHotkeyInput();
    uiStore.appendHotkeyInputLine("line");
    uiStore.setFlashMessage("msg");
    uiStore.resetFeature();
    expect(uiStore.getState().hotkeyInputActive).toBe(false);
    expect(uiStore.getState().hotkeyInputLines).toEqual([]);
    expect(uiStore.getState().flashMessage).toBe("");
  });
});
