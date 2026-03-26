import { EventEmitter } from "events";
import { existsSync, readFileSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import { spawn, type ChildProcess } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NpmScript {
  name: string;
  command: string;
}

export type NpmScriptStatus = "idle" | "running" | "stopped" | "exited";

export interface NpmScriptInfo {
  name: string;
  status: NpmScriptStatus;
  exitCode: number | null;
}

// ---------------------------------------------------------------------------
// NpmCommandRunner
// ---------------------------------------------------------------------------

/**
 * Manages spawned npm script processes. Buffers output per script and emits
 * "output" and "status" events for WebSocket broadcasting.
 */
export class NpmCommandRunner extends EventEmitter {
  private readonly projectDir: string;
  private readonly processes = new Map<string, ChildProcess>();
  private readonly outputBuffers = new Map<string, string>();
  private readonly scriptInfos = new Map<string, NpmScriptInfo>();
  private static readonly MAX_BUFFER = 256 * 1024; // 256 KB per script
  private pkgWatcher: FSWatcher | null = null;
  private pkgDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectDir: string) {
    super();
    this.projectDir = projectDir;
    this.watchPackageJson();
  }

  /** Watch package.json for changes and emit "scripts-changed" when it's modified. */
  private watchPackageJson(): void {
    const pkgPath = join(this.projectDir, "package.json");
    if (!existsSync(pkgPath)) return;
    try {
      this.pkgWatcher = watch(pkgPath, () => {
        // Debounce: ignore rapid successive events (editors often write multiple times)
        if (this.pkgDebounceTimer) clearTimeout(this.pkgDebounceTimer);
        this.pkgDebounceTimer = setTimeout(() => {
          this.pkgDebounceTimer = null;
          this.emit("scripts-changed");
        }, 300);
      });
      this.pkgWatcher.on("error", () => { /* ignore watch errors */ });
    } catch {
      // fs.watch unsupported or file disappeared — non-critical
    }
  }

  /** Read npm scripts from the project's package.json. */
  getScripts(): NpmScript[] {
    const pkgPath = join(this.projectDir, "package.json");
    if (!existsSync(pkgPath)) return [];
    try {
      const raw = readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const scripts = pkg["scripts"];
      if (!scripts || typeof scripts !== "object") return [];
      return Object.entries(scripts as Record<string, string>).map(([name, command]) => ({
        name,
        command,
      }));
    } catch {
      return [];
    }
  }

  /** Current status info for a script. */
  getInfo(name: string): NpmScriptInfo {
    return this.scriptInfos.get(name) ?? { name, status: "idle", exitCode: null };
  }

  /** Buffered output for a script (last MAX_BUFFER bytes). */
  getOutput(name: string): string {
    return this.outputBuffers.get(name) ?? "";
  }

  /** Whether the script process is currently alive. */
  isRunning(name: string): boolean {
    const proc = this.processes.get(name);
    return proc !== undefined && !proc.killed && proc.exitCode === null;
  }

  /** Start a script. No-ops if already running. */
  start(name: string): void {
    if (this.isRunning(name)) return;

    const info: NpmScriptInfo = { name, status: "running", exitCode: null };
    this.scriptInfos.set(name, info);
    this.emit("status", { script: name, status: "running", exitCode: null });

    const child = spawn("npm", ["run", name], {
      cwd: this.projectDir,
      shell: true,
    });

    this.processes.set(name, child);

    const append = (chunk: string) => {
      const prev = this.outputBuffers.get(name) ?? "";
      const next = prev + chunk;
      this.outputBuffers.set(
        name,
        next.length > NpmCommandRunner.MAX_BUFFER
          ? next.slice(next.length - NpmCommandRunner.MAX_BUFFER)
          : next,
      );
      this.emit("output", { script: name, chunk });
    };

    child.stdout?.on("data", (d: Buffer) => append(d.toString()));
    child.stderr?.on("data", (d: Buffer) => append(d.toString()));

    child.on("exit", (code) => {
      this.processes.delete(name);
      info.status = "exited";
      info.exitCode = code;
      append(`\r\n[Process exited with code ${code ?? "?"}]\r\n`);
      this.emit("status", { script: name, status: "exited", exitCode: code });
    });

    child.on("error", (err) => {
      this.processes.delete(name);
      info.status = "exited";
      info.exitCode = -1;
      append(`\r\n[Error: ${err.message}]\r\n`);
      this.emit("status", { script: name, status: "exited", exitCode: -1 });
    });
  }

  /** Send SIGTERM to a running script (SIGKILL after 3 s). */
  stop(name: string): void {
    const proc = this.processes.get(name);
    if (!proc) return;
    proc.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      if (this.processes.has(name)) proc.kill("SIGKILL");
    }, 3000);
    proc.once("exit", () => clearTimeout(killTimer));
    const info = this.scriptInfos.get(name);
    if (info) {
      info.status = "stopped";
      this.emit("status", { script: name, status: "stopped", exitCode: null });
    }
  }

  /** Clear output buffer then stop + restart the script. */
  restart(name: string): void {
    this.outputBuffers.delete(name);
    this.emit("clear", { script: name });

    if (this.isRunning(name)) {
      const proc = this.processes.get(name)!;
      const killTimer = setTimeout(() => {
        if (this.processes.has(name)) proc.kill("SIGKILL");
      }, 2000);
      proc.kill("SIGTERM");
      proc.once("exit", () => {
        clearTimeout(killTimer);
        setTimeout(() => this.start(name), 100);
      });
    } else {
      this.start(name);
    }
  }

  /** Stop all running processes and the package.json watcher (call on server shutdown). */
  stopAll(): void {
    for (const name of [...this.processes.keys()]) {
      this.stop(name);
    }
    if (this.pkgDebounceTimer) clearTimeout(this.pkgDebounceTimer);
    this.pkgWatcher?.close();
    this.pkgWatcher = null;
  }
}
