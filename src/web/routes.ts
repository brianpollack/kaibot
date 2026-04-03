import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { type IncomingMessage, type ServerResponse } from "http";
import { homedir } from "os";
import { extname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { verifyRequestHmac } from "./hmac.js";
import { renderMainPage, renderProjectSelectionPage } from "./templates.js";
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
import { loadPathHistory, addToPathHistory } from "../pathHistory.js";
import { loadProjectEnv } from "../env.js";
import { loadCodeAssistOptions, loadPromptContent, runCodeAssist } from "../codeAssist.js";
import { KaiClient } from "../KaiClient.js";
import type { SDKAssistantMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { todoExists, loadTodoItems, removeTodoItem, runTodoPlan } from "../todoAssist.js";
import { loadGlobalSettings, saveGlobalSettings } from "../globalSettings.js";

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

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 * Node's `path.resolve` does not handle tilde expansion.
 */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Guard helper: returns false and sends a 503 when no project is selected.
 */
function requireProject(server: WebServer, res: ServerResponse): boolean {
  if (server.state === "waiting" || !server.projectDir) {
    res.writeHead(503, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify({ error: "No project selected" }));
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

  // ── favicon.ico — serve the KaiBot logo icon ──────────────────────
  if (pathname === "/favicon.ico") {
    serveStatic("/static/favicon.ico", res);
    return;
  }

  // ── Static files: /static/* and /vendor/* — always available ───────
  if (pathname.startsWith("/static/") || pathname.startsWith("/vendor/")) {
    serveStatic(pathname, res);
    return;
  }

  // ── Path history API — available even in waiting state ─────────────
  if (pathname === "/api/path-history" && req.method === "GET") {
    const paths = loadPathHistory();
    const result = paths.map((p) => ({
      path: p,
      exists: existsSync(p) && statSync(p).isDirectory(),
    }));
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify({ paths: result }));
    return;
  }

  // ── Browse folders API — lists subdirectories for the folder browser ─
  if (pathname === "/api/browse-folders" && req.method === "GET") {
    const rawPath = url.searchParams.get("path") || homedir();
    const resolvedPath = resolve(expandTilde(rawPath));

    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Invalid directory" }));
      return;
    }

    try {
      const entries = readdirSync(resolvedPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));

      // Resolve the parent path; null when already at filesystem root
      const parentPath = resolve(resolvedPath, "..");
      const parent = parentPath !== resolvedPath ? parentPath : null;

      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ path: resolvedPath, parent, dirs }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Could not read directory" }));
    }
    return;
  }

  // ── Deselect project API — transitions server from active to waiting ─
  if (pathname === "/api/deselect-project" && req.method === "POST") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (server.state === "waiting") {
      res.writeHead(409, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "No project is currently selected" }));
      return;
    }
    if (uiStore.getState().status === "processing") {
      res.writeHead(409, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Cannot deselect while a feature is being processed" }));
      return;
    }
    server.deactivateProject();
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Select project API — transitions server from waiting to active ─
  if (pathname === "/api/select-project" && req.method === "POST") {
    if (server.state === "active") {
      res.writeHead(409, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Project already selected" }));
      return;
    }
    readBody(req)
      .then((body) => {
        const data = JSON.parse(body) as Record<string, unknown>;
        const rawPath = String(data["path"] ?? "").trim();
        if (!rawPath) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Path is required" }));
          return;
        }
        const resolvedDir = resolve(expandTilde(rawPath));
        if (!existsSync(resolvedDir)) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `Directory does not exist: ${resolvedDir}` }));
          return;
        }
        if (!statSync(resolvedDir).isDirectory()) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `Path is not a directory: ${resolvedDir}` }));
          return;
        }

        // Load project-specific .env
        loadProjectEnv(resolvedDir);

        if (!process.env.ANTHROPIC_API_KEY) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({
            error: "ANTHROPIC_API_KEY not set. Add it to the project's .env file or export it in your shell.",
            needsApiKey: true,
            projectDir: resolvedDir,
          }));
          return;
        }

        addToPathHistory(resolvedDir);
        server.activateProject(resolvedDir);

        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true, projectDir: resolvedDir }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── Save API key — validates with Anthropic, writes to project .env ──
  if (pathname === "/api/save-api-key" && req.method === "POST") {
    readBody(req)
      .then(async (body) => {
        const data = JSON.parse(body) as Record<string, unknown>;
        const apiKey = String(data["apiKey"] ?? "").trim();
        const projectDir = String(data["projectDir"] ?? "").trim();

        if (!apiKey) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "API key is required" }));
          return;
        }
        if (!projectDir || !existsSync(projectDir)) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Invalid project directory" }));
          return;
        }

        // Validate key by calling the Anthropic models endpoint
        try {
          const resp = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
            res.end(JSON.stringify({ error: `Invalid API key (${resp.status}): ${text.slice(0, 200)}` }));
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `Failed to validate key: ${msg}` }));
          return;
        }

        // Append to (or create) the project's .env file
        const envPath = join(projectDir, ".env");
        let envContent = "";
        if (existsSync(envPath)) {
          envContent = readFileSync(envPath, "utf-8");
          // Replace existing key if present
          if (/^ANTHROPIC_API_KEY=.*/m.test(envContent)) {
            envContent = envContent.replace(/^ANTHROPIC_API_KEY=.*/m, `ANTHROPIC_API_KEY=${apiKey}`);
          } else {
            envContent = envContent.trimEnd() + `\nANTHROPIC_API_KEY=${apiKey}\n`;
          }
        } else {
          envContent = `ANTHROPIC_API_KEY=${apiKey}\n`;
        }
        writeFileSync(envPath, envContent, "utf-8");

        // Also set in process.env so the next select-project call succeeds
        process.env.ANTHROPIC_API_KEY = apiKey;

        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── When in waiting state: serve project selection page ─────────────
  if (server.state === "waiting") {
    if (pathname === "/" || pathname === "/login" || pathname === "/main") {
      const html = renderProjectSelectionPage(server);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...NO_CACHE_HEADERS });
      res.end(html);
      return;
    }
    // All other API routes unavailable while waiting
    if (pathname.startsWith("/api/")) {
      res.writeHead(503, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "No project selected" }));
      return;
    }
    // Fallthrough to 404
    res.writeHead(404, { "Content-Type": "text/plain", ...NO_CACHE_HEADERS });
    res.end("Not Found");
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

  // ── API: code assist options ─────────────────────────────────────────
  if (pathname === "/api/code-assist/options" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(loadCodeAssistOptions()));
    return;
  }

  // ── API: code assist prompt preview ────────────────────────────────
  if (pathname === "/api/code-assist/prompt" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const file = url.searchParams.get("file") ?? "";
    if (!file) {
      res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "file parameter required" }));
      return;
    }
    try {
      const content = loadPromptContent(file);
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ content }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Prompt file not found" }));
    }
    return;
  }

  // ── API: run code assist ──────────────────────────────────────────
  if (pathname === "/api/code-assist/run" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const name = String(data["name"] ?? "").trim();
        if (!name) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "name is required" }));
          return;
        }
        const options = loadCodeAssistOptions();
        const option = options.find((o) => o.name === name);
        if (!option) {
          res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `Option not found: ${name}` }));
          return;
        }
        const model = uiStore.getState().model || "claude-opus-4-6";
        // Fire and forget — streaming happens via WebSocket state broadcast
        runCodeAssist(option, server.projectDir!, model).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          uiStore.setStatusMessage(`Code assist error: ${msg}`);
        });
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: code assist result file reader ─────────────────────────────
  if (pathname === "/api/code-assist/result-file" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const filePath = url.searchParams.get("path") ?? "";
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "path parameter required" }));
      return;
    }
    // Security: ensure the path is within the project directory
    const resolvedPath = resolve(filePath);
    if (!resolvedPath.startsWith(server.projectDir!)) {
      res.writeHead(403, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Path outside project directory" }));
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

  // ── API: TODO exists check ─────────────────────────────────────────
  if (pathname === "/api/todo/exists" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify({ exists: todoExists(server.projectDir!) }));
    return;
  }

  // ── API: TODO items list ───────────────────────────────────────────
  if (pathname === "/api/todo/items" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(loadTodoItems(server.projectDir!)));
    return;
  }

  // ── API: remove a TODO item ───────────────────────────────────────
  if (pathname === "/api/todo/item" && req.method === "DELETE") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const id = Number(data["id"]);
        if (!Number.isFinite(id)) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Invalid id" }));
          return;
        }
        const removed = removeTodoItem(server.projectDir!, id);
        if (!removed) {
          res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `TODO item not found: ${id}` }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: run TODO plan via Claude agent ───────────────────────────
  if (pathname === "/api/todo/plan" && req.method === "POST") {
    readBody(req)
      .then(async (body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const id = Number(data["id"]);
        const items = loadTodoItems(server.projectDir!);
        const item = items.find((i) => i.id === id);
        if (!item) {
          res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: `TODO item not found: ${id}` }));
          return;
        }
        const model = uiStore.getState().model || "claude-opus-4-6";
        const plan = await runTodoPlan(item, server.projectDir!, model);
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ plan, title: item.title }));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        uiStore.setStatusMessage(`TODO plan error: ${msg}`);
        try {
          res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: msg }));
        } catch {
          // Response may already be sent if the agent threw mid-stream
        }
      });
    return;
  }

  // ── API: feature statistics ───────────────────────────────────────
  if (pathname === "/api/stats" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const logDir = join(server.projectDir!, "features", "log");
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(computeStats(logDir)));
    return;
  }

  // ── API: features list (pending + complete) ────────────────────────
  if (pathname === "/api/features" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(getFeaturesList(server.projectDir!)));
    return;
  }

  // ── API: hold feature file — read ────────────────────────────────────────────
  if (pathname === "/api/features/hold-file" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const filename = url.searchParams.get("filename") ?? "";
    if (!filename || !filename.endsWith(".md") || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Invalid filename" }));
      return;
    }
    const holdPath = join(server.projectDir!, "features", "hold", filename);
    if (!existsSync(holdPath)) {
      res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    try {
      const raw = readFileSync(holdPath, "utf-8");
      // Parse "Feature ID:" and "Title:" headers, then extract body
      const lines = raw.split("\n");
      let featureId = "";
      let title = "";
      let bodyStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("Feature ID:")) {
          featureId = lines[i].replace("Feature ID:", "").trim();
          bodyStart = i + 1;
        } else if (lines[i].startsWith("Title:")) {
          title = lines[i].replace("Title:", "").trim();
          bodyStart = i + 1;
        } else if (bodyStart > 0) {
          // First non-header line — skip leading blanks then treat rest as body
          while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
          break;
        }
      }
      if (!title) title = extractFeatureTitle(holdPath, filename.replace(/\.md$/, ""));
      const body = lines.slice(bodyStart).join("\n").trimEnd();
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ featureId, title, body, filename }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Failed to read file" }));
    }
    return;
  }

  // ── API: hold feature file — update (and optionally move to pending) ──
  if (pathname === "/api/features/hold-file" && req.method === "PUT") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const filename = String(data["filename"] ?? "").trim();
        const featureId = String(data["featureId"] ?? "").trim();
        const title = String(data["title"] ?? "").trim();
        const description = String(data["description"] ?? "");
        const moveToPending = Boolean(data["moveToPending"]);

        if (!filename || !filename.endsWith(".md") || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Invalid filename" }));
          return;
        }

        const holdPath = join(server.projectDir!, "features", "hold", filename);
        const titleLine = title ? `\nTitle: ${title}` : "";
        const newContent = `Feature ID: ${featureId}${titleLine}\n\n${description}`;

        if (moveToPending) {
          const pendingPath = join(server.projectDir!, "features", filename);
          // Write updated content then atomically move out of hold
          writeFileSync(holdPath, newContent, "utf-8");
          renameSync(holdPath, pendingPath);
        } else {
          if (!existsSync(holdPath)) {
            res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
            res.end(JSON.stringify({ error: "File not found in hold folder" }));
            return;
          }
          writeFileSync(holdPath, newContent, "utf-8");
        }

        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: feature detail ────────────────────────────────────────────
  const featureDetailMatch = /^\/api\/features\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  if (featureDetailMatch && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const id = featureDetailMatch[1];
    const logDir = join(server.projectDir!, "features", "log");
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
    if (!requireProject(server, res)) return;
    const id = featureGitMatch[1];
    const logDir = join(server.projectDir!, "features", "log");
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
      const gitDir = server.projectDir!;
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

  // ── API: feature assist — refine title/description via AI ─────────
  if (pathname === "/api/features/assist" && req.method === "POST") {
    readBody(req)
      .then(async (body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const title = String(data["title"] ?? "").trim();
        const description = String(data["description"] ?? "").trim();

        if (!title) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Title is required" }));
          return;
        }

        // Load prompt template and replace markers
        const promptTemplate = loadPromptContent("feature_assist.md");
        const prompt = promptTemplate
          .replace(/\{featureName\}/g, title)
          .replace(/\{details\}/g, description || "(no details provided)");

        const model = uiStore.getState().model || "claude-opus-4-6";
        const client = KaiClient.create(server.projectDir!, model);

        // Clear any stale thinking lines and stream new ones via WebSocket
        uiStore.clearThinking();
        let response = "";
        let assistResult: SDKResultMessage | null = null;
        const assistStart = Date.now();
        for await (const msg of client.query(prompt)) {
          if (msg.type === "assistant") {
            const { message } = msg as SDKAssistantMessage;
            for (const block of message.content) {
              const b = block as unknown as Record<string, unknown>;
              if (b.type === "thinking" && typeof b.thinking === "string") {
                uiStore.appendThinking(b.thinking);
              } else if (b.type === "text" && typeof b.text === "string") {
                uiStore.appendThinking(b.text);
              }
            }
          } else if (msg.type === "result") {
            const result = msg as SDKResultMessage;
            if (result.subtype === "success") {
              response = result.result;
              assistResult = result;
            } else {
              throw new Error(`Query failed (${result.subtype}): ${result.errors.join(", ")}`);
            }
          }
        }
        if (!response) throw new Error("Query completed without a result message");

        // Parse the response — expect FEATURE TITLE: and DESCRIPTION: sections
        const parsed = parseFeatureAssistResponse(response);

        // Append accounting note to the description shown in the editor
        if (assistResult) {
          const totalMs = Date.now() - assistStart;
          const totalSec = Math.round(totalMs / 1000);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          const duration = mins > 0
            ? `${mins} minute${mins !== 1 ? "s" : ""}, ${secs} second${secs !== 1 ? "s" : ""}`
            : `${secs} second${secs !== 1 ? "s" : ""}`;
          const totalTokens = assistResult.usage.input_tokens + assistResult.usage.output_tokens;
          const tokenStr = totalTokens >= 1000
            ? `${(totalTokens / 1000).toFixed(1)}k`
            : String(totalTokens);
          const cost = `$${assistResult.total_cost_usd.toFixed(2)}`;
          parsed.description +=
            `\n\n## Accounting Note\n\nKaiBot Assistant took ${duration}, used ${tokenStr} tokens, cost ${cost}`;
        }

        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify(parsed));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          res.writeHead(500, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: msg }));
        } catch {
          // Response may already be sent
        }
      });
    return;
  }

  // ── API: create new feature ───────────────────────────────────────
  if (pathname === "/api/features" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
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
        const featuresDir = join(server.projectDir!, "features");
        const targetDir = hold ? join(featuresDir, "hold") : featuresDir;
        mkdirSync(targetDir, { recursive: true });

        const content = `Feature ID: ${featureId}\nTitle: ${title}\n\n${description}`;
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

  // ── API: move a hold feature to pending ──────────────────────────
  if (pathname === "/api/features/move-to-pending" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const filename = String(data["filename"] ?? "").trim();

        if (!filename || !filename.endsWith(".md") || filename.includes("/") || filename.includes("\\")) {
          res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "Invalid filename" }));
          return;
        }

        const holdPath = join(server.projectDir!, "features", "hold", filename);
        const pendingPath = join(server.projectDir!, "features", filename);

        if (!existsSync(holdPath)) {
          res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
          res.end(JSON.stringify({ error: "File not found in hold folder" }));
          return;
        }

        renameSync(holdPath, pendingPath);
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true, filename }));
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ error: "Invalid request body" }));
      });
    return;
  }

  // ── API: global settings read ─────────────────────────────────────
  if (pathname === "/api/global-settings" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    const settings = loadGlobalSettings();
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(settings));
    return;
  }

  // ── API: global settings write ────────────────────────────────────
  if (pathname === "/api/global-settings" && req.method === "POST") {
    readBody(req)
      .then((body) => {
        if (!checkHmac(req, url, body, server.hmacSecret, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const current = loadGlobalSettings();
        if (typeof data["matomoEnabled"] === "boolean") {
          current.matomoEnabled = data["matomoEnabled"];
        }
        saveGlobalSettings(current);
        res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
        res.end(JSON.stringify({ ok: true }));
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
    if (!requireProject(server, res)) return;
    const fileKey = url.searchParams.get("path") ?? "";
    const resolvedPath = resolveSettingsFilePath(fileKey, server.projectDir!);
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
        if (!requireProject(server, res)) return;
        const data = JSON.parse(body) as Record<string, unknown>;
        const fileKey = String(data["path"] ?? "").trim();
        const content = String(data["content"] ?? "");
        const resolvedPath = resolveSettingsFilePath(fileKey, server.projectDir!);
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
    if (!requireProject(server, res)) return;
    res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
    res.end(JSON.stringify(server.npmRunner!.getScripts()));
    return;
  }

  // ── API: npm script control & output ──────────────────────────────
  const npmMatch = pathname.match(/^\/api\/npm-scripts\/([^/]+)\/(start|stop|restart|output)$/);
  if (npmMatch) {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const name = decodeURIComponent(npmMatch[1]);
    const action = npmMatch[2];

    if (action === "output" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({
        output: server.npmRunner!.getOutput(name),
        info: server.npmRunner!.getInfo(name),
      }));
      return;
    }

    if (req.method === "POST") {
      if (action === "start")   server.npmRunner!.start(name);
      if (action === "stop")    server.npmRunner!.stop(name);
      if (action === "restart") server.npmRunner!.restart(name);
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  // ── API: read file content for Changed Files viewer ──────────────
  if (pathname === "/api/file-content" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const rawPath = url.searchParams.get("path") ?? "";
    // Resolve relative to project dir and ensure it stays within project dir
    const resolvedPath = rawPath.startsWith("/")
      ? rawPath
      : join(server.projectDir!, rawPath);
    const projectDir = server.projectDir!;
    if (!resolvedPath.startsWith(projectDir) && !existsSync(resolvedPath)) {
      res.writeHead(403, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "Access denied" }));
      return;
    }
    try {
      const content = readFileSync(resolvedPath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ content, path: resolvedPath }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ error: "File not found or unreadable" }));
    }
    return;
  }

  // ── API: git diff for Changed Files viewer ────────────────────────
  if (pathname === "/api/git-diff" && req.method === "GET") {
    if (!checkHmac(req, url, "", server.hmacSecret, res)) return;
    if (!requireProject(server, res)) return;
    const rawPath = url.searchParams.get("path") ?? "";
    const resolvedPath = rawPath.startsWith("/")
      ? rawPath
      : join(server.projectDir!, rawPath);
    try {
      // Try `git diff HEAD -- <file>` first; fall back to `git diff -- <file>` for untracked
      let diff = "";
      try {
        diff = execFileSync("git", ["diff", "HEAD", "--", resolvedPath], {
          cwd: server.projectDir!,
          encoding: "utf-8",
          timeout: 10000,
        });
      } catch {
        diff = execFileSync("git", ["diff", "--", resolvedPath], {
          cwd: server.projectDir!,
          encoding: "utf-8",
          timeout: 10000,
        });
      }
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ diff, path: resolvedPath }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json", ...NO_CACHE_HEADERS });
      res.end(JSON.stringify({ diff: null, path: resolvedPath, unavailable: true }));
    }
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

interface FeatureStats {
  totalFeatures: number;
  featuresThisWeek: number;
  featuresToday: number;
  successCount: number;
  errorCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheTokens: number;
  totalCostUsd: number;
  avgCostUsd: number;
  avgTurns: number;
}

/** Aggregate statistics from all feature log files in the given directory. */
function computeStats(logDir: string): FeatureStats {
  const stats: FeatureStats = {
    totalFeatures: 0,
    featuresThisWeek: 0,
    featuresToday: 0,
    successCount: 0,
    errorCount: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCacheTokens: 0,
    totalCostUsd: 0,
    avgCostUsd: 0,
    avgTurns: 0,
  };

  if (!existsSync(logDir)) return stats;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let totalTurns = 0;

  try {
    for (const filename of readdirSync(logDir)) {
      if (!filename.endsWith(".json")) continue;
      try {
        const raw = readFileSync(join(logDir, filename), "utf-8");
        const record = JSON.parse(raw) as Record<string, unknown>;
        stats.totalFeatures++;
        if (String(record["status"] ?? "") === "success") stats.successCount++;
        else stats.errorCount++;
        const completedAt = String(record["completedAt"] ?? "");
        if (completedAt) {
          if (completedAt.startsWith(todayStr)) stats.featuresToday++;
          if (new Date(completedAt) >= weekAgo) stats.featuresThisWeek++;
        }
        stats.totalTokensIn += Number(record["tokensIn"] ?? 0);
        stats.totalTokensOut += Number(record["tokensOut"] ?? 0);
        stats.totalCacheTokens +=
          Number(record["cacheReadTokens"] ?? 0) + Number(record["cacheWriteTokens"] ?? 0);
        stats.totalCostUsd += Number(record["totalCostUsd"] ?? 0);
        totalTurns += Number(record["numTurns"] ?? 0);
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Ignore unreadable directory
  }

  if (stats.totalFeatures > 0) {
    stats.avgCostUsd = stats.totalCostUsd / stats.totalFeatures;
    stats.avgTurns = totalTurns / stats.totalFeatures;
  }

  return stats;
}

/**
 * Extract a readable title from a feature markdown file's content.
 * Skips the "Feature ID: xxx" header line and returns the first meaningful line.
 */
function extractFeatureTitle(filePath: string, fallback: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    // Prefer an explicit Title: header
    for (const line of lines) {
      if (line.startsWith("Title:")) {
        const t = line.replace("Title:", "").trim();
        if (t) return t.length > 80 ? t.slice(0, 80) + "…" : t;
        break;
      }
    }
    // Fall back to first meaningful content line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("Feature ID:")) continue;
      if (trimmed.startsWith("Title:")) continue;
      if (trimmed.startsWith("##")) continue;
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
// Feature assist response parser
// ---------------------------------------------------------------------------

/**
 * Parses the AI response from the feature_assist.md prompt.
 * Expects sections: FEATURE TITLE:, DESCRIPTION:, and optionally CLARIFY.
 */
function parseFeatureAssistResponse(response: string): {
  title: string;
  description: string;
  clarify?: string;
} {
  const trimmed = response.trim();

  let title = "";
  let description = "";
  let clarify: string | undefined;

  // Extract FEATURE TITLE:
  const titleMatch = trimmed.match(/FEATURE TITLE:\s*\n([\s\S]*?)(?=\nDESCRIPTION:|\n*$)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Extract DESCRIPTION:
  const descMatch = trimmed.match(/DESCRIPTION:\s*\n([\s\S]*?)(?=\nCLARIFY\b|$)/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Extract optional CLARIFY section
  const clarifyMatch = trimmed.match(/CLARIFY\s*\n([\s\S]*?)$/i);
  if (clarifyMatch) {
    clarify = clarifyMatch[1].trim();
  }

  return { title, description, ...(clarify ? { clarify } : {}) };
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
