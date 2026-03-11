import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLinearCompletionComment,
  buildLinearPlanComment,
  cleanupMaterializedLinearWorkfile,
  cleanupStaleLinearWorkfiles,
  LocalLinearClient,
} from "../linear.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (obj: unknown): any => obj;
let tmpDir = "";

afterEach(() => {
  if (!tmpDir) return;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  tmpDir = "";
});

describe("LocalLinearClient.resolveTeamSetup", () => {
  it("resolves by team key and finds started/completed states", async () => {
    const team = {
      id: "team-1",
      key: "ENG",
      name: "Engineering",
      startWorkflowState: undefined,
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: "st-triage", type: "triage" },
          { id: "st-started", type: "started" },
          { id: "st-done", type: "completed" },
        ],
      }),
    };
    const sdk = {
      teams: vi.fn().mockResolvedValue({ nodes: [team] }),
    };

    const client = new LocalLinearClient("test-api-key");
    priv(client).client = sdk;

    const setup = await client.resolveTeamSetup("eng");

    expect(setup).toEqual({
      teamId: "team-1",
      teamLabel: "ENG (Engineering)",
      startedStateId: "st-started",
      completedStateId: "st-done",
    });
    expect(sdk.teams).toHaveBeenCalledTimes(1);
    expect(team.states).toHaveBeenCalledOnce();
  });

  it("falls back to team name and team.startWorkflowState when needed", async () => {
    const team = {
      id: "team-2",
      key: "KAI",
      name: "Kai Team",
      startWorkflowState: Promise.resolve({ id: "st-started-fallback" }),
      states: vi.fn().mockResolvedValue({
        nodes: [{ id: "st-backlog", type: "backlog" }, { id: "st-done", type: "completed" }],
      }),
    };
    const sdk = {
      teams: vi
        .fn()
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValueOnce({ nodes: [team] }),
    };

    const client = new LocalLinearClient("test-api-key");
    priv(client).client = sdk;

    const setup = await client.resolveTeamSetup("kai team");

    expect(setup).toEqual({
      teamId: "team-2",
      teamLabel: "KAI (Kai Team)",
      startedStateId: "st-started-fallback",
      completedStateId: "st-done",
    });
    expect(sdk.teams).toHaveBeenCalledTimes(2);
  });

  it("throws when the team cannot be found", async () => {
    const sdk = {
      teams: vi.fn().mockResolvedValue({ nodes: [] }),
    };

    const client = new LocalLinearClient("test-api-key");
    priv(client).client = sdk;

    await expect(client.resolveTeamSetup("missing-team")).rejects.toThrow(
      "Linear team not found: missing-team",
    );
  });
});

describe("cleanupMaterializedLinearWorkfile", () => {
  it("removes a Linear workfile and prunes empty .kaibot/linear", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-cleanup-"));
    const linearDir = join(tmpDir, ".kaibot", "linear");
    const workfile = join(linearDir, "kai-1_kai_1_complete.md");
    mkdirSync(linearDir, { recursive: true });
    writeFileSync(workfile, "test\n");

    cleanupMaterializedLinearWorkfile(tmpDir, workfile);

    expect(existsSync(workfile)).toBe(false);
    expect(existsSync(linearDir)).toBe(false);
  });

  it("does nothing for files outside .kaibot/linear", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-cleanup-"));
    const outsideFile = join(tmpDir, "features", "my_feature_complete.md");
    mkdirSync(join(tmpDir, "features"), { recursive: true });
    writeFileSync(outsideFile, "test\n");

    cleanupMaterializedLinearWorkfile(tmpDir, outsideFile);

    expect(existsSync(outsideFile)).toBe(true);
  });
});

describe("cleanupStaleLinearWorkfiles", () => {
  it("removes stale .kaibot/linear directory recursively", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-cleanup-"));
    const nestedDir = join(tmpDir, ".kaibot", "linear", "nested");
    const nestedFile = join(nestedDir, "leftover_complete.md");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(nestedFile, "old work\n");

    cleanupStaleLinearWorkfiles(tmpDir);

    expect(existsSync(join(tmpDir, ".kaibot", "linear"))).toBe(false);
  });

  it("is a no-op when .kaibot/linear does not exist", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-cleanup-"));
    expect(() => cleanupStaleLinearWorkfiles(tmpDir)).not.toThrow();
  });
});

describe("Linear comments", () => {
  it("formats a plan comment", () => {
    const comment = buildLinearPlanComment(
      "ENG-101",
      "- [ ] 1. Add API endpoint\n- [ ] 2. Add UI wiring",
    );
    expect(comment).toContain("KaiBot started work on ENG-101.");
    expect(comment).toContain("### Plan");
    expect(comment).toContain("- [ ] 1. Add API endpoint");
  });

  it("formats completion comment with changed files and metadata", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kaibot-linear-comment-"));
    const filePath = join(tmpDir, "feature_complete.md");
    writeFileSync(
      filePath,
      [
        "Implement login flow with MFA",
        "",
        "## Summary",
        "",
        "Added MFA login flow and validation.",
        "",
        "## Metadata",
        "",
        "- **Model:** claude-opus-4-6",
        "- **Cost:** $0.1234",
        "- **Turns:** 7",
        "- **Time:** 12.4s",
      ].join("\n"),
    );

    const comment = buildLinearCompletionComment(
      { name: "feature", state: "complete", filePath },
      "ENG-101",
      ["src/auth.ts", "src/ui/Login.tsx"],
    );

    expect(comment).toContain("KaiBot completed ENG-101.");
    expect(comment).toContain("### Summary");
    expect(comment).toContain("Added MFA login flow and validation.");
    expect(comment).toContain("### Changed Files");
    expect(comment).toContain("- `src/auth.ts`");
    expect(comment).toContain("- `src/ui/Login.tsx`");
    expect(comment).toContain("### Run Metadata");
    expect(comment).toContain("- **Cost:** $0.1234");
    expect(comment).toContain("- **Turns:** 7");
  });
});
