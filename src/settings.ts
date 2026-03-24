import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Persistent settings for a KaiBot project run.
 * Stored in `.kaibot/settings.json` within the project directory.
 */
export interface KaiBotSettings {
  /** Claude model ID, e.g. "claude-opus-4-6". */
  model?: string;
  /** Provider name, e.g. "anthropic". */
  provider?: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SETTINGS_RELATIVE_PATH = ".kaibot/settings.json";

function settingsPath(projectDir: string): string {
  return join(projectDir, SETTINGS_RELATIVE_PATH);
}

/**
 * Load settings from `.kaibot/settings.json` in the given project directory.
 * Returns an empty object `{}` if the file is missing, empty, or unparseable.
 */
export function loadSettings(projectDir: string): KaiBotSettings {
  const path = settingsPath(projectDir);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as KaiBotSettings;
  } catch {
    return {};
  }
}

/**
 * Persist settings to `.kaibot/settings.json` in the given project directory.
 * Creates the `.kaibot/` directory if it does not exist.
 */
export function saveSettings(projectDir: string, settings: KaiBotSettings): void {
  mkdirSync(join(projectDir, ".kaibot"), { recursive: true });
  writeFileSync(settingsPath(projectDir), JSON.stringify(settings, null, 2) + "\n");
}
