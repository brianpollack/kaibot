import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock KaiAgent before importing KaiBot so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock("../KaiAgent.js", () => ({
  processFeature: vi.fn(),
  generateSummary: vi.fn().mockResolvedValue(""),
  generateTitle: vi.fn().mockResolvedValue(""),
}));

vi.mock("../changelog.js", () => ({
  appendChangelog: vi.fn(),
}));

vi.mock("../featureDb.js", () => ({
  appendFeatureRecord: vi.fn(),
}));

vi.mock("../web/followupSession.js", () => ({
  registerSession: vi.fn((_featureId: string, _client: unknown, _logPath: string, onClose: () => void) => {
    onClose();
  }),
  closeSession: vi.fn(),
}));

import { KaiBot } from "../KaiBot.js";
import { type AgentStats, processFeature } from "../KaiAgent.js";
import { uiStore } from "../ui/store.js";

const mockProcessFeature = vi.mocked(processFeature);

const stubStats: AgentStats = {
  durationMs: 1000,
  totalCostUsd: 0.001,
  numTurns: 3,
  tokensIn: 100,
  tokensOut: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  planPoints: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Access private members for testing via any-cast. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (obj: unknown): any => obj;

/**
 * Pre-seed the seenAt map with an old timestamp so the settle delay is
 * already satisfied on the next checkForNewFeatures() call.
 */
function bypassSettleDelay(bot: KaiBot, featureName: string): void {
  (priv(bot).seenAt as Map<string, number>).set(featureName, Date.now() - 10_000);
}

let tmpDir: string;
let featuresDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kaibot-test-"));
  featuresDir = join(tmpDir, "features");
  mkdirSync(featuresDir);
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
// ensureFeaturesDir — tested via private method access (start() re-sets running=true)
// ---------------------------------------------------------------------------

describe("KaiBot — ensureFeaturesDir", () => {
  it("creates features/ dir and subdirectories if they do not exist", () => {
    rmSync(featuresDir, { recursive: true, force: true });
    expect(existsSync(featuresDir)).toBe(false);

    const bot = new KaiBot(tmpDir);
    priv(bot).ensureFeaturesDir();

    expect(existsSync(featuresDir)).toBe(true);
    expect(existsSync(join(featuresDir, "inprogress"))).toBe(true);
    expect(existsSync(join(featuresDir, "complete"))).toBe(true);
    expect(existsSync(join(featuresDir, "hold"))).toBe(true);
    expect(existsSync(join(featuresDir, "log"))).toBe(true);
  });

  it("does not throw if features/ already exists", () => {
    const bot = new KaiBot(tmpDir);
    expect(() => priv(bot).ensureFeaturesDir()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// checkForNewFeatures — via private method access
// ---------------------------------------------------------------------------

describe("KaiBot — checkForNewFeatures", () => {
  it("ignores non-.md files", async () => {
    writeFileSync(join(featuresDir, "notes.txt"), "some text");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();

    expect(mockProcessFeature).not.toHaveBeenCalled();
  });

  it("updates UI status when a new feature file is found", async () => {
    let capturedStatus = "";
    mockProcessFeature.mockImplementation(async () => {
      // Capture the status message while the feature is being processed
      capturedStatus = uiStore.getState().statusMessage;
      return stubStats;
    });

    writeFileSync(join(featuresDir, "new_user.md"), "# New User\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "new_user");
    await priv(bot).checkForNewFeatures();

    expect(capturedStatus).toContain("new_user");
  });

  it("detects a new .md file and calls processFeature", async () => {
    mockProcessFeature.mockResolvedValueOnce(stubStats);
    writeFileSync(join(featuresDir, "new_user.md"), "# New User\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "new_user");
    await priv(bot).checkForNewFeatures();

    expect(mockProcessFeature).toHaveBeenCalledOnce();
    const [feature, projectDir] = mockProcessFeature.mock.calls[0];
    expect(feature.name).toBe("new_user");
    expect(projectDir).toBe(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// handleFeature — state transitions
// ---------------------------------------------------------------------------

describe("KaiBot — handleFeature state transitions", () => {
  it("moves .md to inprogress/ before calling processFeature", async () => {
    let capturedFilePath: string | undefined;
    let inprogressExistedDuringCall = false;
    let originalExistedDuringCall = false;

    mockProcessFeature.mockImplementation(async (feature) => {
      capturedFilePath = feature.filePath;
      // Check file state at the moment processFeature is called
      inprogressExistedDuringCall = existsSync(
        join(featuresDir, "inprogress", "auth_flow.md"),
      );
      originalExistedDuringCall = existsSync(join(featuresDir, "auth_flow.md"));
      return stubStats;
    });

    writeFileSync(join(featuresDir, "auth_flow.md"), "# Auth Flow\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "auth_flow");
    await priv(bot).checkForNewFeatures();

    expect(capturedFilePath).toContain(join("inprogress", "auth_flow.md"));
    expect(inprogressExistedDuringCall).toBe(true);
    expect(originalExistedDuringCall).toBe(false);
  });

  it("moves from inprogress/ to complete/ on success", async () => {
    mockProcessFeature.mockResolvedValueOnce(stubStats);

    writeFileSync(join(featuresDir, "auth_flow.md"), "# Auth Flow\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "auth_flow");
    await priv(bot).checkForNewFeatures();

    expect(existsSync(join(featuresDir, "complete", "auth_flow.md"))).toBe(true);
    expect(existsSync(join(featuresDir, "inprogress", "auth_flow.md"))).toBe(false);
  });

  it("moves file to hold/ on processFeature error", async () => {
    mockProcessFeature.mockRejectedValueOnce(new Error("agent failure"));

    writeFileSync(join(featuresDir, "broken_feature.md"), "# Broken\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "broken_feature");
    await priv(bot).checkForNewFeatures();

    expect(existsSync(join(featuresDir, "hold", "broken_feature.md"))).toBe(true);
    expect(existsSync(join(featuresDir, "inprogress", "broken_feature.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sequential processing — one at a time
// ---------------------------------------------------------------------------

describe("KaiBot — sequential processing", () => {
  it("processes only one feature per checkForNewFeatures call", async () => {
    mockProcessFeature.mockResolvedValue(stubStats);

    writeFileSync(join(featuresDir, "feature_a.md"), "# A\n");
    writeFileSync(join(featuresDir, "feature_b.md"), "# B\n");
    writeFileSync(join(featuresDir, "feature_c.md"), "# C\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "feature_a");
    bypassSettleDelay(bot, "feature_b");
    bypassSettleDelay(bot, "feature_c");

    // First poll — processes exactly one feature
    await priv(bot).checkForNewFeatures();
    expect(mockProcessFeature).toHaveBeenCalledTimes(1);
  });

  it("processes all features across multiple poll cycles", async () => {
    mockProcessFeature.mockResolvedValue(stubStats);

    writeFileSync(join(featuresDir, "feature_a.md"), "# A\n");
    writeFileSync(join(featuresDir, "feature_b.md"), "# B\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "feature_a");
    bypassSettleDelay(bot, "feature_b");

    // First poll — one feature
    await priv(bot).checkForNewFeatures();
    expect(mockProcessFeature).toHaveBeenCalledTimes(1);

    // Second poll — the other feature
    await priv(bot).checkForNewFeatures();
    expect(mockProcessFeature).toHaveBeenCalledTimes(2);

    const names = mockProcessFeature.mock.calls.map((c) => c[0].name).sort();
    expect(names).toEqual(["feature_a", "feature_b"]);
  });

  it("blocks the poll loop while a feature is being processed", async () => {
    const callOrder: string[] = [];

    mockProcessFeature.mockImplementation(async (feature) => {
      callOrder.push(`start:${feature.name}`);
      // Simulate some work
      await new Promise<void>((r) => setTimeout(r, 10));
      callOrder.push(`end:${feature.name}`);
      return stubStats;
    });

    writeFileSync(join(featuresDir, "feature_x.md"), "# X\n");
    writeFileSync(join(featuresDir, "feature_y.md"), "# Y\n");

    const bot = new KaiBot(tmpDir);
    bypassSettleDelay(bot, "feature_x");
    bypassSettleDelay(bot, "feature_y");

    // Two sequential polls
    await priv(bot).checkForNewFeatures();
    await priv(bot).checkForNewFeatures();

    // Each feature fully completes before the next starts
    expect(callOrder[0]).toMatch(/^start:/);
    expect(callOrder[1]).toMatch(/^end:/);
    expect(callOrder[2]).toMatch(/^start:/);
    expect(callOrder[3]).toMatch(/^end:/);
  });
});
