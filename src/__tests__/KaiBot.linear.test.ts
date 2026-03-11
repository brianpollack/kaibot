import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KaiBot } from "../KaiBot.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (obj: unknown): any => obj;

let tmpDir: string;
let oldLinearApiKey: string | undefined;
let oldLinearTeamKey: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-test-"));
  oldLinearApiKey = process.env.LINEAR_API_KEY;
  oldLinearTeamKey = process.env.LINEAR_TEAM_KEY;

  process.env.LINEAR_API_KEY = "lin_test_key";
  process.env.LINEAR_TEAM_KEY = "ENG";
});

afterEach(() => {
  process.env.LINEAR_API_KEY = oldLinearApiKey;
  process.env.LINEAR_TEAM_KEY = oldLinearTeamKey;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("KaiBot linear init", () => {
  it("loads team and state ids from the Linear client", async () => {
    const mockLinearClient = {
      resolveTeamSetup: vi.fn().mockResolvedValue({
        teamId: "team-123",
        teamLabel: "ENG (Engineering)",
        startedStateId: "state-started",
        completedStateId: "state-completed",
      }),
    };

    const bot = new KaiBot(tmpDir);
    priv(bot).linearClient = mockLinearClient;

    await priv(bot).initLinearMode();

    expect(mockLinearClient.resolveTeamSetup).toHaveBeenCalledWith("ENG");
    expect(priv(bot).linearTeamId).toBe("team-123");
    expect(priv(bot).linearTeamLabel).toBe("ENG (Engineering)");
    expect(priv(bot).linearStartedStateId).toBe("state-started");
    expect(priv(bot).linearCompletedStateId).toBe("state-completed");
  });
});
