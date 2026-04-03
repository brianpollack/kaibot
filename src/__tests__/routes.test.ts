import { createHmac } from "crypto";
import { EventEmitter } from "events";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as models from "../models.js";
import { handleRequest } from "../web/routes.js";
import type { WebServer } from "../web/WebServer.js";

// ---------------------------------------------------------------------------
// Helpers — lightweight mocks for IncomingMessage / ServerResponse
// ---------------------------------------------------------------------------

interface MockRes {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  statusCode?: number;
  headers: Record<string, string | number | string[]>;
}

function signHeaders(secret: string, method: string, pathAndSearch: string, body = ""): Record<string, string> {
  const ts = Date.now().toString();
  const dataToSign = `${method}\n${pathAndSearch}\n${ts}\n${body}`;
  const sig = `sha256=${createHmac("sha256", secret).update(dataToSign).digest("hex")}`;
  return { "x-kaibot-timestamp": ts, "x-kaibot-signature": sig };
}

function mockReq(method: string, url: string, extraHeaders: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:8500", ...extraHeaders };
  return req;
}

function mockRes(): MockRes {
  const headers: Record<string, string | number | string[]> = {};
  return {
    headers,
    writeHead: vi.fn((status: number, hdrs?: Record<string, string>) => {
      if (hdrs) Object.assign(headers, hdrs);
    }),
    end: vi.fn(),
  };
}

function fakeServer(projectDir = "/tmp/test-project"): WebServer {
  return { projectDir, model: "claude-haiku-4-5", hmacSecret: "" } as unknown as WebServer;
}

// ---------------------------------------------------------------------------
// No-cache headers — expected on every response
// ---------------------------------------------------------------------------

const NO_CACHE_KEYS = ["Cache-Control", "Pragma", "Expires"] as const;

function expectNoCacheHeaders(res: MockRes) {
  expect(res.writeHead).toHaveBeenCalled();
  const hdrs = res.writeHead.mock.calls[0]?.[1] as Record<string, string> | undefined;
  expect(hdrs).toBeDefined();
  for (const key of NO_CACHE_KEYS) {
    expect(hdrs![key]).toBeDefined();
  }
  expect(hdrs!["Cache-Control"]).toContain("no-cache");
  expect(hdrs!["Cache-Control"]).toContain("no-store");
  expect(hdrs!["Cache-Control"]).toContain("must-revalidate");
  expect(hdrs!["Pragma"]).toBe("no-cache");
  expect(hdrs!["Expires"]).toBe("0");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routes — robots.txt", () => {
  it("returns a disallow-all robots.txt with no-cache headers", () => {
    const req = mockReq("GET", "/robots.txt");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/plain; charset=utf-8",
    }));
    expect(res.end).toHaveBeenCalledWith("User-agent: *\nDisallow: /\n");
    expectNoCacheHeaders(res);
  });
});

describe("routes — no-cache headers", () => {
  it("sets no-cache headers on redirect responses", () => {
    const req = mockReq("GET", "/");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());

    expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: "/main",
    }));
    expectNoCacheHeaders(res);
  });

  it("sets no-cache headers on /main", () => {
    const req = mockReq("GET", "/main");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/html; charset=utf-8",
    }));
    expectNoCacheHeaders(res);
  });

  it("sets no-cache headers on API routes", () => {
    const req = mockReq("GET", "/api/models");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "application/json",
    }));
    expectNoCacheHeaders(res);
  });

  it("sets no-cache headers on 404", () => {
    const req = mockReq("GET", "/nonexistent");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
    expectNoCacheHeaders(res);
  });
});

describe("routes — /api/models", () => {
  it("returns live OpenRouter models when provider=openrouter", async () => {
    const fetchSpy = vi.spyOn(models, "fetchOpenRouterModels").mockResolvedValue([
      {
        type: "model",
        id: "anthropic/claude-sonnet-4",
        display_name: "Claude Sonnet 4",
        created_at: "",
      },
    ]);
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const req = mockReq("GET", "/api/models?provider=openrouter");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy).toHaveBeenCalledWith("sk-or-test");
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "application/json",
    }));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify([
      { id: "anthropic/claude-sonnet-4", description: "Claude Sonnet 4" },
    ]));

    fetchSpy.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  });

  it("falls back to static models when live OpenRouter fetch fails", async () => {
    const fetchSpy = vi.spyOn(models, "fetchOpenRouterModels").mockRejectedValue(new Error("boom"));
    process.env.OPENROUTER_API_KEY = "sk-or-test";

    const req = mockReq("GET", "/api/models?provider=openrouter");
    const res = mockRes();
    handleRequest(req as any, res as any, fakeServer());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.end).toHaveBeenCalledWith(JSON.stringify(models.OPENROUTER_MODELS));

    fetchSpy.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  });
});

// ---------------------------------------------------------------------------
// Tests — /api/features/hold-file (GET)
// ---------------------------------------------------------------------------

describe("routes — /api/features/hold-file GET", () => {
  const SECRET = "test-secret-key";
  const tmpDir = "/tmp/kai-hold-route-test";
  const holdDir = join(tmpDir, "features", "hold");

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function holdServer(secret = "", dir = tmpDir): ReturnType<typeof fakeServer> {
    return { projectDir: dir, model: "claude-haiku-4-5", hmacSecret: secret, state: "ready" } as unknown as ReturnType<typeof fakeServer>;
  }

  it("returns 401 when secret is set and no HMAC headers are sent (browser-tab access)", () => {
    // This reproduces the exact failure: opening the URL in a browser tab
    const req = mockReq("GET", "/api/features/hold-file?filename=test.md");
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer(SECRET));

    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 for missing filename", () => {
    const url = "/api/features/hold-file";
    const req = mockReq("GET", url, signHeaders("", "GET", url));
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer());

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });

  it("returns 400 for filename with path traversal", () => {
    const url = "/api/features/hold-file?filename=../evil.md";
    const req = mockReq("GET", url, signHeaders("", "GET", url));
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer());

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });

  it("returns 404 when file does not exist in features/hold/", () => {
    mkdirSync(holdDir, { recursive: true });
    const url = "/api/features/hold-file?filename=missing.md";
    const req = mockReq("GET", url, signHeaders("", "GET", url));
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer());

    expect(res.writeHead).toHaveBeenCalledWith(404, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as { error: string };
    expect(body.error).toBe("File not found");
  });

  it("returns 200 with parsed content when file exists (no secret)", () => {
    mkdirSync(holdDir, { recursive: true });
    const filename = "abc123.md";
    writeFileSync(join(holdDir, filename), "Feature ID: FID-42\nTitle: My Feature\n\nDo the thing.\n");

    const url = `/api/features/hold-file?filename=${filename}`;
    const req = mockReq("GET", url, signHeaders("", "GET", url));
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer());

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "application/json" }));
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as Record<string, string>;
    expect(body.featureId).toBe("FID-42");
    expect(body.title).toBe("My Feature");
    expect(body.filename).toBe(filename);
    expect(body.body).toContain("Do the thing.");
    expect(body.body).not.toContain("Title:");
  });

  it("returns 200 when properly HMAC-signed with a secret", () => {
    mkdirSync(holdDir, { recursive: true });
    const filename = "signed.md";
    writeFileSync(join(holdDir, filename), "Feature ID: FID-99\nTitle: Signed Feature\n\nSigned content.\n");

    const url = `/api/features/hold-file?filename=${filename}`;
    const req = mockReq("GET", url, signHeaders(SECRET, "GET", url));
    const res = mockRes();
    handleRequest(req as any, res as any, holdServer(SECRET));

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything());
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as Record<string, string>;
    expect(body.featureId).toBe("FID-99");
    expect(body.title).toBe("Signed Feature");
  });
});
