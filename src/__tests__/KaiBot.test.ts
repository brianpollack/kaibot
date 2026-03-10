import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock KaiAgent before importing KaiBot so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock("../KaiAgent.js", () => ({
  processFeature: vi.fn(),
}));

import { KaiBot } from "../KaiBot.js";
import { processFeature } from "../KaiAgent.js";

const mockProcessFeature = vi.mocked(processFeature);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Allow fire-and-forget async operations to settle. */
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 50));

/** Access private members for testing via any-cast. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (obj: unknown): any => obj;

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
  it("creates features/ dir if it does not exist", () => {
    rmSync(featuresDir, { recursive: true, force: true });
    expect(existsSync(featuresDir)).toBe(false);

    const bot = new KaiBot(tmpDir);
    priv(bot).ensureFeaturesDir();

    expect(existsSync(featuresDir)).toBe(true);
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
  it("ignores _inprogress.md files", async () => {
    writeFileSync(join(featuresDir, "my_feature_inprogress.md"), "# Feature\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).not.toHaveBeenCalled();
  });

  it("ignores _complete.md files", async () => {
    writeFileSync(join(featuresDir, "my_feature_complete.md"), "# Feature\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).not.toHaveBeenCalled();
  });

  it("ignores non-.md files", async () => {
    writeFileSync(join(featuresDir, "notes.txt"), "some text");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).not.toHaveBeenCalled();
  });

  it("prints the filename when a new feature file is found", async () => {
    mockProcessFeature.mockResolvedValueOnce(undefined);
    const spy = vi.spyOn(console, "log");

    writeFileSync(join(featuresDir, "new_user.md"), "# New User\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(spy).toHaveBeenCalledWith("Found new feature file: new_user.md");
    spy.mockRestore();
  });

  it("detects a new .md file and calls processFeature", async () => {
    mockProcessFeature.mockResolvedValueOnce(undefined);
    writeFileSync(join(featuresDir, "new_user.md"), "# New User\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).toHaveBeenCalledOnce();
    const [feature, projectDir] = mockProcessFeature.mock.calls[0];
    expect(feature.name).toBe("new_user");
    expect(projectDir).toBe(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// Double-processing prevention
// ---------------------------------------------------------------------------

describe("KaiBot — double-processing prevention", () => {
  it("does not process the same feature twice if already in processing set", async () => {
    // Never resolve — simulates a long-running agent
    mockProcessFeature.mockImplementation(() => new Promise(() => {}));

    writeFileSync(join(featuresDir, "slow_feature.md"), "# Slow\n");

    const bot = new KaiBot(tmpDir);

    // First poll
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    // Second poll — feature is now _inprogress but name still in processing set
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// handleFeature — state transitions
// ---------------------------------------------------------------------------

describe("KaiBot — handleFeature state transitions", () => {
  it("renames .md to _inprogress before calling processFeature", async () => {
    let capturedFilePath: string | undefined;
    let inprogressExistedDuringCall = false;
    let originalExistedDuringCall = false;

    mockProcessFeature.mockImplementation(async (feature) => {
      capturedFilePath = feature.filePath;
      // Check file state at the moment processFeature is called
      inprogressExistedDuringCall = existsSync(join(featuresDir, "auth_flow_inprogress.md"));
      originalExistedDuringCall = existsSync(join(featuresDir, "auth_flow.md"));
    });

    writeFileSync(join(featuresDir, "auth_flow.md"), "# Auth Flow\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(capturedFilePath).toMatch(/_inprogress\.md$/);
    expect(inprogressExistedDuringCall).toBe(true);
    expect(originalExistedDuringCall).toBe(false);
  });

  it("renames _inprogress to _complete on success", async () => {
    mockProcessFeature.mockResolvedValueOnce(undefined);

    writeFileSync(join(featuresDir, "auth_flow.md"), "# Auth Flow\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(existsSync(join(featuresDir, "auth_flow_complete.md"))).toBe(true);
    expect(existsSync(join(featuresDir, "auth_flow_inprogress.md"))).toBe(false);
  });

  it("leaves file as _inprogress on processFeature error", async () => {
    mockProcessFeature.mockRejectedValueOnce(new Error("agent failure"));

    writeFileSync(join(featuresDir, "broken_feature.md"), "# Broken\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(existsSync(join(featuresDir, "broken_feature_inprogress.md"))).toBe(true);
    expect(existsSync(join(featuresDir, "broken_feature_complete.md"))).toBe(false);
  });

  it("removes feature name from processing set after completion", async () => {
    // Use a deferred promise so we can observe the processing set mid-flight
    let resolveFeature!: () => void;
    const featurePromise = new Promise<void>((r) => { resolveFeature = r; });
    mockProcessFeature.mockReturnValueOnce(featurePromise);

    writeFileSync(join(featuresDir, "cleanup.md"), "# Cleanup\n");

    const bot = new KaiBot(tmpDir);
    const processing = priv(bot).processing as Set<string>;

    await priv(bot).checkForNewFeatures();
    // After checkForNewFeatures the name is in the set (handleFeature still running)
    expect(processing.has("cleanup")).toBe(true);

    // Let handleFeature complete
    resolveFeature();
    await flushPromises();
    expect(processing.has("cleanup")).toBe(false);
  });

  it("removes feature name from processing set after error", async () => {
    let rejectFeature!: (err: Error) => void;
    const featurePromise = new Promise<void>((_, r) => { rejectFeature = r; });
    mockProcessFeature.mockReturnValueOnce(featurePromise);

    writeFileSync(join(featuresDir, "errored.md"), "# Errored\n");

    const bot = new KaiBot(tmpDir);
    const processing = priv(bot).processing as Set<string>;

    await priv(bot).checkForNewFeatures();
    expect(processing.has("errored")).toBe(true);

    rejectFeature(new Error("fail"));
    await flushPromises();
    expect(processing.has("errored")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple features
// ---------------------------------------------------------------------------

describe("KaiBot — multiple features", () => {
  it("processes multiple new features concurrently", async () => {
    mockProcessFeature.mockResolvedValue(undefined);

    writeFileSync(join(featuresDir, "feature_a.md"), "# A\n");
    writeFileSync(join(featuresDir, "feature_b.md"), "# B\n");
    writeFileSync(join(featuresDir, "feature_c.md"), "# C\n");

    const bot = new KaiBot(tmpDir);
    await priv(bot).checkForNewFeatures();
    await flushPromises();

    expect(mockProcessFeature).toHaveBeenCalledTimes(3);
    const names = mockProcessFeature.mock.calls.map((c) => c[0].name).sort();
    expect(names).toEqual(["feature_a", "feature_b", "feature_c"]);
  });
});
