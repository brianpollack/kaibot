import { existsSync, readFileSync, statSync } from "fs";
import { type IncomingMessage, type ServerResponse } from "http";
import { extname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { renderMainPage } from "./templates.js";
import { getWebState } from "./wsHandler.js";
import type { WebServer } from "./WebServer.js";
import { MODELS } from "../models.js";

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf":  "font/ttf",
};

// ---------------------------------------------------------------------------
// Static file root — relative to this file's directory
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_ROOT = resolve(__dirname, "../../web");

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Handle an incoming HTTP request. No frameworks — just a simple URL switch.
 */
export function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  server: WebServer,
): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  // ── Login placeholder: redirect / and /login to /main ──────────────
  if (pathname === "/" || pathname === "/login") {
    res.writeHead(302, { Location: "/main" });
    res.end();
    return;
  }

  // ── Main dashboard page ────────────────────────────────────────────
  if (pathname === "/main") {
    const html = renderMainPage(server);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // ── API: current state (for initial load) ──────────────────────────
  if (pathname === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getWebState()));
    return;
  }

  // ── API: available models ──────────────────────────────────────────
  if (pathname === "/api/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(MODELS));
    return;
  }

  // ── Static files: /static/* and /vendor/* ──────────────────────────
  if (pathname.startsWith("/static/") || pathname.startsWith("/vendor/")) {
    serveStatic(pathname, res);
    return;
  }

  // ── 404 ────────────────────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

function serveStatic(pathname: string, res: ServerResponse): void {
  // Prevent path traversal
  const safePath = pathname.replace(/\.\./g, "");
  const filePath = join(WEB_ROOT, safePath);
  const resolved = resolve(filePath);

  // Must stay within WEB_ROOT
  if (!resolved.startsWith(WEB_ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  const body = readFileSync(resolved);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
  res.end(body);
}
