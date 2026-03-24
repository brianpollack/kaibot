import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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

  // ── API: features list (pending + complete) ────────────────────────
  if (pathname === "/api/features") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getFeaturesList(server.projectDir)));
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
// Features list
// ---------------------------------------------------------------------------

interface PendingFeature {
  filename: string;
  title: string;
  status: "pending" | "hold";
}

interface CompleteFeature {
  id: string;
  description: string;
  summary: string;
  completedAt: string;
  status: string;
}

interface FeaturesList {
  pending: PendingFeature[];
  complete: CompleteFeature[];
}

/**
 * Extract a readable title from a feature markdown file's content.
 * Skips the "Feature ID: xxx" header line and returns the first meaningful line.
 */
function extractFeatureTitle(filePath: string, fallback: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("Feature ID:")) continue;
      if (trimmed.startsWith("##")) continue;
      // Strip leading markdown heading markers
      const clean = trimmed.replace(/^#+\s*/, "");
      if (clean) return clean.length > 80 ? clean.slice(0, 80) + "…" : clean;
    }
  } catch {
    // Fall through to filename
  }
  return fallback;
}

/** Read all pending and complete features from the project's features directories. */
function getFeaturesList(projectDir: string): FeaturesList {
  const pending: PendingFeature[] = [];
  const complete: CompleteFeature[] = [];

  // Pending: features/*.md (root level)
  const featuresDir = join(projectDir, "features");
  if (existsSync(featuresDir)) {
    try {
      for (const filename of readdirSync(featuresDir)) {
        if (!filename.endsWith(".md")) continue;
        const fallback = filename.replace(/\.md$/, "").replace(/_/g, " ");
        pending.push({
          filename,
          title: extractFeatureTitle(join(featuresDir, filename), fallback),
          status: "pending",
        });
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  // Pending (hold): features/hold/*.md
  const holdDir = join(projectDir, "features", "hold");
  if (existsSync(holdDir)) {
    try {
      for (const filename of readdirSync(holdDir)) {
        if (!filename.endsWith(".md")) continue;
        const fallback = filename.replace(/\.md$/, "").replace(/_/g, " ");
        pending.push({
          filename,
          title: extractFeatureTitle(join(holdDir, filename), fallback),
          status: "hold",
        });
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  // Complete: features/log/*.json
  const logDir = join(projectDir, "features", "log");
  if (existsSync(logDir)) {
    try {
      for (const filename of readdirSync(logDir)) {
        if (!filename.endsWith(".json")) continue;
        try {
          const raw = readFileSync(join(logDir, filename), "utf-8");
          const data = JSON.parse(raw) as Record<string, unknown>;
          complete.push({
            id: String(data["id"] ?? filename.replace(/\.json$/, "")),
            description: String(data["description"] ?? ""),
            summary: String(data["summary"] ?? ""),
            completedAt: String(data["completedAt"] ?? ""),
            status: String(data["status"] ?? "unknown"),
          });
        } catch {
          // Skip malformed log files
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  // Sort complete features newest first
  complete.sort((a, b) => {
    const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return tb - ta;
  });

  return { pending, complete };
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
