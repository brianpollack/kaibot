/**
 * SDK smoke tests — real API calls, skipped when ANTHROPIC_API_KEY is absent.
 *
 * Uses claude-haiku-4-5 with maxTurns: 1 to minimize cost.
 * Runs a single query in beforeAll and asserts on the collected messages.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKResultSuccess,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { beforeAll, describe, expect, it } from "vitest";

import { KaiClient } from "../KaiClient.js";

const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_API_KEY)("SDK smoke tests (requires ANTHROPIC_API_KEY)", () => {
  const messages: SDKMessage[] = [];
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "kai-smoke-"));

    const client = KaiClient.create(tmpDir, "claude-haiku-4-5");

    for await (const msg of client.query("Reply with exactly: hello")) {
      messages.push(msg);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  }, 60_000); // generous timeout for API call

  // ---------------------------------------------------------------------------
  // Basic shape
  // ---------------------------------------------------------------------------

  it("receives at least one message", () => {
    expect(messages.length).toBeGreaterThan(0);
  });

  it("includes a system init message", () => {
    const init = messages.find(
      (m): m is SDKSystemMessage => m.type === "system" && (m as SDKSystemMessage).subtype === "init",
    );
    expect(init).toBeDefined();
    expect(typeof init!.session_id).toBe("string");
    expect(init!.session_id.length).toBeGreaterThan(0);
  });

  it("includes at least one assistant message", () => {
    const assistant = messages.filter((m): m is SDKAssistantMessage => m.type === "assistant");
    expect(assistant.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Result message
  // ---------------------------------------------------------------------------

  it("ends with a result message", () => {
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(result).toBeDefined();
  });

  it("result subtype is success", () => {
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(result!.subtype).toBe("success");
  });

  it("result has a non-empty result string", () => {
    const result = messages.find((m) => m.type === "result") as SDKResultSuccess | undefined;
    expect(result!.subtype).toBe("success");
    expect(typeof result!.result).toBe("string");
    expect(result!.result.length).toBeGreaterThan(0);
  });

  it("result has total_cost_usd as a number", () => {
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(typeof result!.total_cost_usd).toBe("number");
    expect(result!.total_cost_usd).toBeGreaterThanOrEqual(0);
  });

  it("result has num_turns as a positive integer", () => {
    const result = messages.find((m) => m.type === "result") as SDKResultMessage | undefined;
    expect(Number.isInteger(result!.num_turns)).toBe(true);
    expect(result!.num_turns).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Assistant message content blocks
  // ---------------------------------------------------------------------------

  it("assistant messages have content arrays", () => {
    const assistants = messages.filter((m): m is SDKAssistantMessage => m.type === "assistant");
    for (const msg of assistants) {
      expect(Array.isArray(msg.message.content)).toBe(true);
    }
  });

  it("assistant messages contain at least one text block", () => {
    const assistants = messages.filter((m): m is SDKAssistantMessage => m.type === "assistant");
    const hasText = assistants.some((msg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      msg.message.content.some((b: any) => b.type === "text" && typeof b.text === "string"),
    );
    expect(hasText).toBe(true);
  });

  it("duck-typed text block guard works on real content", () => {
    const assistants = messages.filter((m): m is SDKAssistantMessage => m.type === "assistant");
    for (const msg of assistants) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const block of msg.message.content as any[]) {
        if (block.type === "text") {
          // Should not throw — text property must be a string
          expect(typeof block.text).toBe("string");
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // KaiClient.run() convenience method
  // ---------------------------------------------------------------------------

  it("KaiClient.run() returns a non-empty string", async () => {
    const runTmpDir = mkdtempSync(join(tmpdir(), "kai-smoke-run-"));
    try {
      const client = KaiClient.create(runTmpDir, "claude-haiku-4-5");
      const result = await client.run("Reply with exactly: pong");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    } finally {
      rmSync(runTmpDir, { recursive: true, force: true });
    }
  }, 60_000);
});
