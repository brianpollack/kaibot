import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

import {
  MODELS,
  DEFAULT_MODEL,
  MODEL_PRICING,
  getPricing,
  fetchModels,
  fetchOpenRouterModels,
  printModels,
  type ApiModel,
} from "../models.js";

// ---------------------------------------------------------------------------
// MODELS constant
// ---------------------------------------------------------------------------

describe("MODELS", () => {
  it("contains at least one model", () => {
    expect(MODELS.length).toBeGreaterThan(0);
  });

  it("each entry has a non-empty id and description", () => {
    for (const model of MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.description).toBeTruthy();
    }
  });

  it("includes the default model", () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain(DEFAULT_MODEL);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MODEL
// ---------------------------------------------------------------------------

describe("DEFAULT_MODEL", () => {
  it("is claude-opus-4-6", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-4-6");
  });
});

// ---------------------------------------------------------------------------
// MODEL_PRICING
// ---------------------------------------------------------------------------

describe("MODEL_PRICING", () => {
  it("has pricing entries for known model families", () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
  });

  it("each entry has positive input and output prices", () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.input).toBeGreaterThan(0);
      expect(pricing.output).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getPricing
// ---------------------------------------------------------------------------

describe("getPricing", () => {
  it("returns pricing for a known model", () => {
    const pricing = getPricing("claude-opus-4-6");
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(15.0);
    expect(pricing!.output).toBe(75.0);
  });

  it("returns pricing for a dated model variant", () => {
    const pricing = getPricing("claude-sonnet-4-5-20250929");
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(3.0);
  });

  it("returns undefined for an unknown model", () => {
    expect(getPricing("some-unknown-model")).toBeUndefined();
  });

  it("matches the most specific prefix", () => {
    // claude-3-haiku should match "claude-3-haiku" not "claude-haiku-4"
    const pricing = getPricing("claude-3-haiku-20240307");
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// fetchModels
// ---------------------------------------------------------------------------

describe("fetchModels", () => {
  const mockModels: ApiModel[] = [
    {
      type: "model",
      id: "claude-opus-4-6",
      display_name: "Claude Opus 4.6",
      created_at: "2026-01-15T00:00:00Z",
    },
    {
      type: "model",
      id: "claude-sonnet-4-6",
      display_name: "Claude Sonnet 4.6",
      created_at: "2026-02-17T00:00:00Z",
    },
  ];

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns models on success", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockModels }),
    } as Response);

    const result = await fetchModels("sk-test-key");
    expect(result).toEqual(mockModels);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: {
          "x-api-key": "sk-test-key",
          "anthropic-version": "2023-06-01",
        },
      }),
    );
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"unauthorized"}',
    } as Response);

    await expect(fetchModels("bad-key")).rejects.toThrow(
      "Anthropic API error (401)",
    );
  });
});

// ---------------------------------------------------------------------------
// fetchOpenRouterModels (uses node:https)
// ---------------------------------------------------------------------------

vi.mock("node:https", () => ({
  default: { get: vi.fn() },
}));

import https from "node:https";

describe("fetchOpenRouterModels", () => {
  afterEach(() => {
    vi.mocked(https.get).mockReset();
  });

  /** Helper: create a fake IncomingMessage that emits the given body. */
  function fakeResponse(statusCode: number, body: string): EventEmitter {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = statusCode;
    // Emit data + end on next tick so the listener is already attached
    process.nextTick(() => {
      res.emit("data", Buffer.from(body));
      res.emit("end");
    });
    return res;
  }

  it("returns filtered Claude models on success", async () => {
    const payload = {
      data: [
        { id: "anthropic/claude-opus-4", name: "Claude Opus 4" },
        { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
        { id: "google/gemini-pro", name: "Gemini Pro" },
      ],
    };
    vi.mocked(https.get).mockImplementation((_url, _opts, cb) => {
      (cb as (res: EventEmitter) => void)(fakeResponse(200, JSON.stringify(payload)));
      return new EventEmitter() as ReturnType<typeof https.get>;
    });

    const result = await fetchOpenRouterModels("sk-or-test");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("anthropic/claude-opus-4");
    expect(result[1].id).toBe("anthropic/claude-sonnet-4");
  });

  it("throws on non-2xx status", async () => {
    vi.mocked(https.get).mockImplementation((_url, _opts, cb) => {
      (cb as (res: EventEmitter) => void)(fakeResponse(401, "Unauthorized"));
      return new EventEmitter() as ReturnType<typeof https.get>;
    });

    await expect(fetchOpenRouterModels("bad-key")).rejects.toThrow(
      "OpenRouter API error (401)",
    );
  });

  it("throws when no Claude models are found", async () => {
    const payload = { data: [{ id: "google/gemini-pro", name: "Gemini Pro" }] };
    vi.mocked(https.get).mockImplementation((_url, _opts, cb) => {
      (cb as (res: EventEmitter) => void)(fakeResponse(200, JSON.stringify(payload)));
      return new EventEmitter() as ReturnType<typeof https.get>;
    });

    await expect(fetchOpenRouterModels("sk-or-test")).rejects.toThrow(
      "No Claude models found",
    );
  });

  it("throws on request error", async () => {
    vi.mocked(https.get).mockImplementation((_url, _opts, _cb) => {
      const req = new EventEmitter() as ReturnType<typeof https.get>;
      process.nextTick(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    });

    await expect(fetchOpenRouterModels("sk-or-test")).rejects.toThrow("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// printModels
// ---------------------------------------------------------------------------

describe("printModels", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const mockModels: ApiModel[] = [
    {
      type: "model",
      id: "claude-opus-4-6",
      display_name: "Claude Opus 4.6",
      created_at: "2026-01-15T00:00:00Z",
    },
    {
      type: "model",
      id: "claude-sonnet-4-6",
      display_name: "Claude Sonnet 4.6",
      created_at: "2026-02-17T00:00:00Z",
    },
    {
      type: "model",
      id: "claude-haiku-4-5-20251001",
      display_name: "Claude Haiku 4.5",
      created_at: "2025-10-01T00:00:00Z",
    },
  ];

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
    delete process.env.KAI_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
  });

  function getOutput(): string {
    return logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  }

  it("fetches live models when API key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockModels }),
    } as Response);

    await printModels();
    const output = getOutput();
    expect(output).toContain("live from API");
    expect(output).toContain("claude-opus-4-6");
    expect(output).toContain("claude-sonnet-4-6");
  });

  it("falls back to static list when API key is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await printModels();
    const output = getOutput();
    expect(output).not.toContain("live from API");
    for (const model of MODELS) {
      expect(output).toContain(model.id);
    }
  });

  it("falls back to static list on API error", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));

    await printModels();
    const output = getOutput();
    expect(output).not.toContain("live from API");
    for (const model of MODELS) {
      expect(output).toContain(model.id);
    }
  });

  it("displays pricing columns for known models", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockModels }),
    } as Response);

    await printModels();
    const output = getOutput();
    // Opus pricing: $15.00 / $75.00
    expect(output).toContain("$15.00");
    expect(output).toContain("$75.00");
    // Sonnet pricing: $3.00 / $15.00
    expect(output).toContain("$3.00");
  });

  it("marks the default model as active when KAI_MODEL is not set", async () => {
    delete process.env.KAI_MODEL;
    await printModels();
    const output = getOutput();
    expect(output).toContain(DEFAULT_MODEL);
    expect(output).toContain("(active)");
  });

  it("marks a custom KAI_MODEL as active", async () => {
    process.env.KAI_MODEL = "claude-haiku-4-5";
    await printModels();
    const haikuLine = logSpy.mock.calls
      .map((c) => c.join(" "))
      .find((line) => line.includes("claude-haiku-4-5"));
    expect(haikuLine).toContain("(active)");
    const opusLine = logSpy.mock.calls
      .map((c) => c.join(" "))
      .find((line) => line.includes("claude-opus-4-6"));
    expect(opusLine).not.toContain("(active)");
  });

  it("prints export copy-paste commands", async () => {
    await printModels();
    const output = getOutput();
    for (const model of MODELS) {
      expect(output).toContain(`export KAI_MODEL=${model.id}`);
    }
  });

  it("includes pricing header when pricing is available", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockModels }),
    } as Response);

    await printModels();
    expect(getOutput()).toContain("Input / Output per 1M tokens");
  });
});
