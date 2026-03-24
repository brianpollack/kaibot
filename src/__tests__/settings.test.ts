import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSettings, saveSettings, type KaiBotSettings } from "../settings.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kaibot-settings-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadSettings
// ---------------------------------------------------------------------------

describe("loadSettings", () => {
  it("returns empty object when settings file does not exist", () => {
    const settings = loadSettings(tmpDir);
    expect(settings).toEqual({});
  });

  it("returns empty object when settings file is empty", () => {
    mkdirSync(join(tmpDir, ".kaibot"), { recursive: true });
    writeFileSync(join(tmpDir, ".kaibot/settings.json"), "");
    const settings = loadSettings(tmpDir);
    expect(settings).toEqual({});
  });

  it("returns empty object when settings file contains invalid JSON", () => {
    mkdirSync(join(tmpDir, ".kaibot"), { recursive: true });
    writeFileSync(join(tmpDir, ".kaibot/settings.json"), "not-json{{{");
    const settings = loadSettings(tmpDir);
    expect(settings).toEqual({});
  });

  it("returns empty object when settings file contains a JSON array", () => {
    mkdirSync(join(tmpDir, ".kaibot"), { recursive: true });
    writeFileSync(join(tmpDir, ".kaibot/settings.json"), "[]");
    const settings = loadSettings(tmpDir);
    expect(settings).toEqual({});
  });

  it("returns stored model when settings file is valid", () => {
    mkdirSync(join(tmpDir, ".kaibot"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".kaibot/settings.json"),
      JSON.stringify({ model: "claude-haiku-4-5" }),
    );
    const settings = loadSettings(tmpDir);
    expect(settings.model).toBe("claude-haiku-4-5");
  });

  it("returns stored provider when settings file is valid", () => {
    mkdirSync(join(tmpDir, ".kaibot"), { recursive: true });
    writeFileSync(
      join(tmpDir, ".kaibot/settings.json"),
      JSON.stringify({ provider: "anthropic", model: "claude-opus-4-6" }),
    );
    const settings = loadSettings(tmpDir);
    expect(settings.provider).toBe("anthropic");
    expect(settings.model).toBe("claude-opus-4-6");
  });
});

// ---------------------------------------------------------------------------
// saveSettings
// ---------------------------------------------------------------------------

describe("saveSettings", () => {
  it("creates the .kaibot directory if it does not exist", () => {
    saveSettings(tmpDir, { model: "claude-opus-4-6" });
    const raw = readFileSync(join(tmpDir, ".kaibot/settings.json"), "utf8");
    expect(raw).toBeTruthy();
  });

  it("writes model to the settings file", () => {
    saveSettings(tmpDir, { model: "claude-haiku-4-5" });
    const raw = readFileSync(join(tmpDir, ".kaibot/settings.json"), "utf8");
    const parsed = JSON.parse(raw) as KaiBotSettings;
    expect(parsed.model).toBe("claude-haiku-4-5");
  });

  it("writes provider to the settings file", () => {
    saveSettings(tmpDir, { provider: "anthropic", model: "claude-opus-4-6" });
    const raw = readFileSync(join(tmpDir, ".kaibot/settings.json"), "utf8");
    const parsed = JSON.parse(raw) as KaiBotSettings;
    expect(parsed.provider).toBe("anthropic");
  });

  it("overwrites existing settings", () => {
    saveSettings(tmpDir, { model: "claude-haiku-4-5" });
    saveSettings(tmpDir, { model: "claude-opus-4-6" });
    const settings = loadSettings(tmpDir);
    expect(settings.model).toBe("claude-opus-4-6");
  });
});

// ---------------------------------------------------------------------------
// round-trip: saveSettings → loadSettings
// ---------------------------------------------------------------------------

describe("settings round-trip", () => {
  it("loadSettings returns what saveSettings wrote", () => {
    const original: KaiBotSettings = { model: "claude-sonnet-4-5", provider: "anthropic" };
    saveSettings(tmpDir, original);
    const loaded = loadSettings(tmpDir);
    expect(loaded).toEqual(original);
  });
});
