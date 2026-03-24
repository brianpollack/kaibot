import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

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

function mockReq(method: string, url: string) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:8500" };
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
  return { projectDir, model: "claude-haiku-4-5" } as unknown as WebServer;
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
