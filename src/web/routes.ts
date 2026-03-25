import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { type IncomingMessage, type ServerResponse } from "http";
import { extname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { verifyRequestHmac } from "./hmac.js";
import { renderMainPage } from "./templates.js";
import { getWebState } from "./wsHandler.js";
import type { WebServer } from "./WebServer.js";
import {
  fetchOpenRouterModels,
  getAvailableProviders,
  getModelsForProvider,
  type ProviderName,
} from "../models.js";
import { uiStore } from "../ui/store.js";
import { generateFeatureId } from "../feature.js";

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
const KAIBOT_ROOT = resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// No-cache headers — ensure every response expires immediately
// ---------------------------------------------------------------------------

const NO_CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma":        "no-cache",
  "Expires":       "0",
};

function isProviderName(value: string): value is ProviderName {
  return value === "anthropic" || value === "openrouter";
}

// ---------------------------------------------------------------------------
// HMAC verification helper
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC signature on an API request. Sends a 401 and returns false
 * when verification fails. Returns true (and does nothing) when it passes or
 * when the server has no secret configured (test mode).
 */
function checkHmac(
  req: IncomingMessage,
  url: URL,
  body: string,
  secret: string,
  res: ServerResponse,
): boolean {
  const timestamp = String(req.headers["x-kaibot-timestamp"] ?? "");
  const signature = String(req.headers["x-kaibot-signature"] ?? "");
  if (!verifyRequestHmac(secret, req.method ?? "GET", url.pathname + url.search, timestamp, body, signature)) {
    res.writeHead(401, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }
  return true;
}

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

  // ── robots.txt — disallow all robots ───────────────────────────────
  if (pathname === "/robots.txt") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      ...NO_CACHE_HEADERS,
    });
    res.end("User-agent: *\nDisallow: /\n");
    return;
  }

  // ── Login placeholder: redirect / and /login to /main ──────────────
  if (pathname === "/" || pathname === "/login") {
    res.writeHead(302, { Location: "/main", ...NO_CACHE_HEADERS });
    res.end();
    return;
  }

  // ── Main dashboard page ────────────────────────────────────────────
  if (pathname === "/main") {
    const html = renderMainPage(server);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...NO_CACHE_HEADERS });
    res.end(html);
    return;
  }

  // ── API: current state (for initial load) ──────────────────────────
  if (pathname === "/api/state") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(getWebState()));
    return;
  }

  // ── API: available models (returns models for the current provider) ─
  if (pathname === "/api/models") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const providerParam = url.searchParams.get("provider");
    const provider = providerParam && isProviderName(providerParam)
      ? providerParam
      : (uiStore.getState().provider as ProviderName);

    if (provider === "openrouter" && process.env.OPENROUTER_API_KEY) {
      fetchOpenRouterModels(process.env.OPENROUTER_API_KEY)
        .then((models) => {
          res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify(models.map((model) => ({
            id: model.id,
            description: model.display_name || model.id,
          }))));
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify(getModelsForProvider(provider)));
        });
      return;
    }

    const models = getModelsForProvider(provider);
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(models));
    return;
  }

  // ── API: available providers ─────────────────────────────────────────
  if (pathname === "/api/providers") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(getAvailableProviders()));
    return;
  }

  // ── API: features list (pending + complete) ────────────────────────
  if (pathname === "/api/features" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(getFeaturesList(server.projectDir)));
    return;
  }

  // ── API: feature detail ────────────────────────────────────────────
  const featureDetailMatch = /^\/api\/features\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  if (featureDetailMatch && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const id = featureDetailMatch[1];
    const logDir = join(server.projectDir, "features", "log");
    const filePath = join(logDir, `${id}.json`);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return;
    }
    try {
      const raw = readFileSync(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(raw);
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Failed to read feature" }));
    }
    return;
  }

  // ── API: feature git info ──────────────────────────────────────────
  const featureGitMatch = /^\/api\/features\/([a-zA-Z0-9_-]+)\/git$/.exec(pathname);
  if (featureGitMatch && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const id = featureGitMatch[1];
    const logDir = join(server.projectDir, "features", "log");
    const filePath = join(logDir, `${id}.json`);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return;
    }
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const hash = String(data["gitCommitHash"] ?? "").trim();
      if (!hash) {
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "No commit hash recorded for this feature" }));
        return;
      }
      const gitDir = server.projectDir;
      const runGit = (...args: string[]) => {
        try {
          return execFileSync("git", args, { cwd: gitDir, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
        } catch {
          return "";
        }
      };
      const show = runGit("show", "--stat", "--format=fuller", hash);
      const diff = runGit("show", "--format=", hash);
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ hash, show, diff }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Failed to read git info" }));
    }
    return;
  }

  // ── API: create new feature ───────────────────────────────────────
  if (pathname === "/api/features" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const title = String(data["title"] ?? "").trim();
        const description = String(data["description"] ?? "").trim();
        const hold = Boolean(data["hold"]);

        if (!title) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Title is required" }));
          return;
        }

        const featureId = generateFeatureId();
        const featuresDir = join(server.projectDir, "features");
        const targetDir = hold ? join(featuresDir, "hold") : featuresDir;
        mkdirSync(targetDir, { recursive: true });

        const content = `Feature ID: ${featureId}\n\n${description}`;
        const filePath = join(targetDir, `${featureId}.md`);
        writeFileSync(filePath, content, "utf-8");

        res.writeHead(201, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ id: featureId, title, hold, filePath: filePath }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: settings file read ───────────────────────────────────────
  if (pathname === "/api/settings/file" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const fileKey = url.searchParams.get("path") ?? "";
    const resolvedPath = resolveSettingsFilePath(fileKey, server.projectDir);
    if (!resolvedPath) {
      res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Invalid file path" }));
      return;
    }
    try {
      const content = existsSync(resolvedPath) ? readFileSync(resolvedPath, "utf-8") : "";
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ content }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Failed to read file" }));
    }
    return;
  }

  // ── API: settings file write ──────────────────────────────────────
  if (pathname === "/api/settings/file" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const fileKey = String(data["path"] ?? "").trim();
        const content = String(data["content"] ?? "");
        const resolvedPath = resolveSettingsFilePath(fileKey, server.projectDir);
        if (!resolvedPath) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Invalid file path" }));
          return;
        }
        try {
          mkdirSync(resolve(resolvedPath, ".."), { recursive: true });
          writeFileSync(resolvedPath, content, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Failed to write file" }));
        }
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: npm scripts list ─────────────────────────────────────────
  if (pathname === "/api/npm-scripts" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(server.npmRunner.getScripts()));
    return;
  }

  // ── API: npm script control & output ──────────────────────────────
  const npmMatch = pathname.match(/^\/api\/npm-scripts\/([^/]+)\/(start|stop|restart|output)$/);
  if (npmMatch) {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const name = decodeURIComponent(npmMatch[1]);
    const action = npmMatch[2];

    if (action === "output" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({
        output: server.npmRunner.getOutput(name),
        info: server.npmRunner.getInfo(name),
      }));
      return;
    }

    if (req.method === "POST") {
      if (action === "start")   server.npmRunner.start(name);
      if (action === "stop")    server.npmRunner.stop(name);
      if (action === "restart") server.npmRunner.restart(name);
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  // ── Static files: /static/* and /vendor/* ──────────────────────────
  if (pathname.startsWith("/static/") || pathname.startsWith("/vendor/")) {
    serveStatic(pathname, res);
    return;
  }

  // ── 404 ────────────────────────────────────────────────────────────
  res.writeHead(404, { "Content-Type": "text/plain", ...NO_CACHE_HEADERS });
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
  title: string;
  description: string;
  summary: string;
  completedAt: string;
  status: string;
  totalCostUsd: number;
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
            title: String(data["title"] ?? ""),
            description: String(data["description"] ?? ""),
            summary: String(data["summary"] ?? ""),
            completedAt: String(data["completedAt"] ?? ""),
            status: String(data["status"] ?? "unknown"),
            totalCostUsd: Number(data["totalCostUsd"] ?? 0),
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
// Settings file path resolver — strict allowlist, no path traversal possible
// ---------------------------------------------------------------------------

const SETTINGS_FILE_KEYS: Record<string, (projectDir: string) => string> = {
  "CLAUDE.md":           (projectDir) => join(projectDir, "CLAUDE.md"),
  "README.md":           (projectDir) => join(projectDir, "README.md"),
  ".kaibot/PROMPT.md":   (projectDir) => join(projectDir, ".kaibot", "PROMPT.md"),
  "system_prompt.md":    (_projectDir) => join(KAIBOT_ROOT, "prompts", "system_prompt.md"),
};

function resolveSettingsFilePath(key: string, projectDir: string): string | null {
  const resolver = SETTINGS_FILE_KEYS[key];
  if (!resolver) return null;
  return resolver(projectDir);
}

// ---------------------------------------------------------------------------
// Request body helper
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
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
    res.writeHead(403, { "Content-Type": "text/plain", ...NO_CACHE_HEADERS });
    res.end("Forbidden");
    return;
  }

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain", ...NO_CACHE_HEADERS });
    res.end("Not Found");
    return;
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  const body = readFileSync(resolved);
  res.writeHead(200, {
    "Content-Type": contentType,
    ...NO_CACHE_HEADERS,
  });
  res.end(body);
}
