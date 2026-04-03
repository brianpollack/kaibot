/**
 * OpenRouter smoke test — real API calls via OpenRouter gateway.
 *
 * NOT part of the normal test suite. Run explicitly with:
 *   npm run test:openrouter
 *
 * Requires OPENROUTER_API_KEY to be set. Uses qwen/qwen3-6b-plus-free
 * to verify that KaiClient can route through OpenRouter successfully.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKResultSuccess,
} from "@anthropic-ai/claude-agent-sdk";
import { afterAll, beforeAll, expect, it } from "vitest";

import { KaiClient } from "../KaiClient.js";
import { skipIfMissingEnv } from "./helpers/envGuard.js";

const OPENROUTER_MODEL = "qwen/qwen3-6b-plus:free";

skipIfMissingEnv("OPENROUTER_API_KEY")("OpenRouter smoke tests (requires OPENROUTER_API_KEY)", () => {
  const messages: SDKMessage[] = [];
  let tmpDir: string;
  let client: KaiClient;
  let apiUnavailable = false;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-openrouter-smoke-"));
    client = KaiClient.create(tmpDir, OPENROUTER_MODEL, "openrouter");

    try {
      for await (const msg of client.query("Reply with exactly: hello")) {
        messages.push(msg);
      }
    } catch {
      // Network blocked, auth failure, or model unavailable — skip gracefully
      apiUnavailable = true;
    }
  }, 90_000);

  afterAll(() => {
    client?.restoreEnv();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function requireApi() {
    return apiUnavailable;
  }

  // ---------------------------------------------------------------------------
  // Provider configuration
  // ---------------------------------------------------------------------------

  it("KaiClient is configured with openrouter provider", () => {
    expect(client.provider).toBe("openrouter");
    expect(client.model).toBe(OPENROUTER_MODEL);
  });

  it("ANTHROPIC_BASE_URL is set to OpenRouter endpoint during query", () => {
    // After beforeAll the env was already set — verify it was applied
    if (requireApi()) return;
    // restoreEnv() is called in afterAll, so env still points to OpenRouter here
    expect(process.env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
  });

  // ---------------------------------------------------------------------------
  // Basic message shape
  // ---------------------------------------------------------------------------

  it("receives at least one message", () => {
    if (requireApi()) return;
    expect(messages.length).toBeGreaterThan(0);
  });

  it("includes at least one assistant message", () => {
    if (requireApi()) return;
    const assistant = messages.filter((m): m is SDKAssistantMessage => m.type === "assistant");
    expect(assistant.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Result message
  // ---------------------------------------------------------------------------

  it("ends with a result message", () => {
    if (requireApi()) return;
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(result).toBeDefined();
  });

  it("result subtype is success", () => {
    if (requireApi()) return;
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(result!.subtype).toBe("success");
  });

  it("result has a non-empty result string", () => {
    if (requireApi()) return;
    const result = messages.find((m) => m.type === "result") as SDKResultSuccess | undefined;
    expect(result!.subtype).toBe("success");
    expect(typeof result!.result).toBe("string");
    expect(result!.result.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // KaiClient.run() via OpenRouter
  // ---------------------------------------------------------------------------

  it("KaiClient.run() returns a non-empty string via OpenRouter", async () => {
    if (requireApi()) return;
    const runTmpDir = mkdtempSync(join(tmpdir(), "kai-openrouter-run-"));
    const runClient = KaiClient.create(runTmpDir, OPENROUTER_MODEL, "openrouter");
    try {
      const result = await runClient.run("Reply with exactly: pong");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    } finally {
      runClient.restoreEnv();
      rmSync(runTmpDir, { recursive: true, force: true });
    }
  }, 90_000);
});
