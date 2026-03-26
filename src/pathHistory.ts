import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Config directory — OS-appropriate
// ---------------------------------------------------------------------------

const MAX_HISTORY = 5;

/**
 * Return the OS-appropriate config directory for KaiBot.
 *
 * - macOS:   ~/Library/Application Support/kaibot/
 * - Linux:   $XDG_CONFIG_HOME/kaibot/ or ~/.config/kaibot/
 * - Windows: %APPDATA%/kaibot/
 */
export function getConfigDir(): string {
  const p = platform();
  if (p === "darwin") {
    return join(homedir(), "Library", "Application Support", "kaibot");
  }
  if (p === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "kaibot");
  }
  // Linux and other Unix-like
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, "kaibot");
}

// ---------------------------------------------------------------------------
// Path history
// ---------------------------------------------------------------------------

function historyFilePath(): string {
  return join(getConfigDir(), "path_history.json");
}

/**
 * Load the most recent project folder paths (up to 5).
 * Returns an empty array if the file is missing or corrupt.
 */
export function loadPathHistory(): string[] {
  const filePath = historyFilePath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.recentPaths)) return [];
    return (obj.recentPaths as unknown[])
      .filter((p): p is string => typeof p === "string")
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

/**
 * Add a project folder to the front of the history list.
 * Deduplicates and truncates to 5 entries.
 */
export function addToPathHistory(dirPath: string): void {
  const resolved = resolve(dirPath);
  const existing = loadPathHistory();
  const filtered = existing.filter((p) => p !== resolved);
  const updated = [resolved, ...filtered].slice(0, MAX_HISTORY);

  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(historyFilePath(), JSON.stringify({ recentPaths: updated }, null, 2) + "\n");
}
