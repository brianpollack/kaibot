import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";

import { WebSocketServer } from "ws";

import { handleRequest } from "./routes.js";
import { setupWebSocketHandler } from "./wsHandler.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WebServerOptions {
  /** Port to listen on. Defaults to 8500. */
  port?: number;
  /** Host to bind to. Defaults to "127.0.0.1". */
  host?: string;
  /** Absolute path to the target project directory. */
  projectDir: string;
  /** Current Claude model ID. */
  model: string;
}

// ---------------------------------------------------------------------------
// WebServer
// ---------------------------------------------------------------------------

/**
 * Lightweight HTTP + WebSocket server for the KaiBot web UI.
 * Uses Node's built-in `http` module — no Express or other frameworks.
 */
export class WebServer {
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly port: number;
  private readonly host: string;
  readonly projectDir: string;
  model: string;

  constructor(opts: WebServerOptions) {
    this.port = opts.port ?? 8500;
    this.host = opts.host ?? "127.0.0.1";
    this.projectDir = opts.projectDir;
    this.model = opts.model;

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, this);
    });

    this.wss = new WebSocketServer({ server: this.server });
    setupWebSocketHandler(this.wss);
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

  /** Gracefully shut down the server. */
  stop(): Promise<void> {
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
