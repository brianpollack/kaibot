import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import { EventEmitter } from "events";

import { WebSocketServer } from "ws";

import { NpmCommandRunner } from "./NpmCommandRunner.js";
import { handleRequest } from "./routes.js";
import { setupWebSocketHandler } from "./wsHandler.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type WebServerState = "waiting" | "active";

export interface WebServerOptions {
  /** Port to listen on. Defaults to 8500. */
  port?: number;
  /** Host to bind to. Defaults to "127.0.0.1". */
  host?: string;
  /** Absolute path to the target project directory. Optional — omit to start in "waiting" state. */
  projectDir?: string;
  /** Current Claude model ID. */
  model: string;
}

// ---------------------------------------------------------------------------
// WebServer
// ---------------------------------------------------------------------------

/**
 * Lightweight HTTP + WebSocket server for the KaiBot web UI.
 * Uses Node's built-in `http` module — no Express or other frameworks.
 *
 * Can start in "waiting" state (no project dir) and transition to "active"
 * once a project is selected via the web UI.
 */
export class WebServer extends EventEmitter {
  private readonly server: Server;
  readonly wss: WebSocketServer;
  private readonly port: number;
  private readonly host: string;
  projectDir: string | null;
  npmRunner: NpmCommandRunner | null;
  readonly hmacSecret: string;
  model: string;
  state: WebServerState;

  constructor(opts: WebServerOptions) {
    super();
    this.port = opts.port ?? 8500;
    this.host = opts.host ?? "127.0.0.1";
    this.projectDir = opts.projectDir ?? null;
    this.model = opts.model;
    this.hmacSecret = randomBytes(32).toString("hex");

    if (this.projectDir) {
      this.npmRunner = new NpmCommandRunner(this.projectDir);
      this.wireNpmRunner(this.npmRunner);
      this.state = "active";
    } else {
      this.npmRunner = null;
      this.state = "waiting";
    }

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, this);
    });

    this.wss = new WebSocketServer({ server: this.server });
    setupWebSocketHandler(this.wss, this.npmRunner, this.hmacSecret, this);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start listening. Returns a promise that resolves once the server is ready. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  /**
   * Transition from "waiting" to "active" state with a project directory.
   * Creates the NpmCommandRunner and notifies all WebSocket clients to reload.
   */
  activateProject(projectDir: string): void {
    this.projectDir = projectDir;
    this.npmRunner = new NpmCommandRunner(projectDir);
    this.wireNpmRunner(this.npmRunner);
    this.state = "active";

    // Notify WebSocket clients to reload
    for (const client of this.wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify({ type: "project-activated", projectDir }));
      }
    }

    this.emit("project-activated", projectDir);
  }

  /** Broadcast a message to all connected WebSocket clients. */
  private broadcast(msg: object): void {
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(payload);
    }
  }

  /** Wire package.json change events from an NpmCommandRunner to all WS clients. */
  private wireNpmRunner(runner: NpmCommandRunner): void {
    runner.on("scripts-changed", () => {
      this.broadcast({ type: "npm-scripts-updated" });
    });
  }

  /** Gracefully shut down the server. */
  stop(): Promise<void> {
    this.npmRunner?.stopAll();
    return new Promise((resolve) => {
      // Close all WebSocket connections
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.server.close(() => resolve());
    });
  }

  /** The URL the server is listening on. */
  get url(): string {
    return `http://${this.host}:${this.port}`;
  }
}
