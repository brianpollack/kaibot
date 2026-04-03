import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Global KaiBot settings, shared across all projects.
 * Stored in ~/.kaibot/settings.json (or %APPDATA%\kaibot\settings.json on Windows).
 */
export interface GlobalKaiBotSettings {
  /** Whether anonymous usage tracking via Matomo is enabled. Default: true. */
  matomoEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Storage path
// ---------------------------------------------------------------------------

export function getGlobalSettingsDir(): string {
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "kaibot");
  }
  return join(homedir(), ".kaibot");
}

export function getGlobalSettingsPath(): string {
  return join(getGlobalSettingsDir(), "settings.json");
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load global KaiBot settings. Returns defaults if missing or unparseable.
 */
export function loadGlobalSettings(): GlobalKaiBotSettings {
  const path = getGlobalSettingsPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as GlobalKaiBotSettings;
  } catch {
    return {};
  }
}

/**
 * Persist global KaiBot settings. Creates the settings directory if needed.
 */
export function saveGlobalSettings(settings: GlobalKaiBotSettings): void {
  const dir = getGlobalSettingsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getGlobalSettingsPath(), JSON.stringify(settings, null, 2) + "\n");
}
