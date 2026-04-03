import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum length a .env value must have to be treated as a secret.
 * Short values like port numbers, "true", "8080" are skipped.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Values that are obviously configuration rather than secrets, even if they
 * appear in a .env file and are long enough.
 */
const SAFE_VALUES = new Set([
  "true", "false", "yes", "no",
  "local", "localhost",
  "development", "production", "staging", "testing", "test",
  "debug", "info", "warn", "error",
]);

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _cachedDir = "";
let _secrets: string[] = [];

function loadSecrets(projectDir: string): void {
  if (projectDir === _cachedDir) return; // already loaded for this project

  _cachedDir = projectDir;
  _secrets = [];

  const envPath = join(projectDir, ".env");
  if (!existsSync(envPath)) return;

  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;

    let value = trimmed.slice(idx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value.length >= MIN_SECRET_LENGTH && !SAFE_VALUES.has(value.toLowerCase())) {
      _secrets.push(value);
    }
  }

  // Sort longest first so a longer secret wins over a prefix that is also a secret
  _secrets.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace every occurrence of a secret value from <projectDir>/.env with ***
 * in the given text. Safe to call on serialised JSON strings.
 *
 * - Secrets shorter than MIN_SECRET_LENGTH characters are ignored.
 * - Trivially non-secret values ("true", "localhost", …) are ignored.
 * - The secret list is cached per-projectDir and reloaded on project change.
 */
export function redactSecrets(text: string, projectDir: string): string {
  if (!projectDir || !text) return text;

  loadSecrets(projectDir);
  if (_secrets.length === 0) return text;

  for (const secret of _secrets) {
    let pos = text.indexOf(secret);
    while (pos !== -1) {
      text = text.slice(0, pos) + "***" + text.slice(pos + secret.length);
      // Advance past the replacement so we don't loop on a shorter result
      pos = text.indexOf(secret, pos + 3);
    }
  }

  return text;
}

/**
 * Force the cache to reload on the next call.  Call this when the project
 * directory changes or when the .env file may have been edited.
 */
export function invalidateSecretsCache(): void {
  _cachedDir = "";
  _secrets = [];
}

// Exported for tests only
export { loadSecrets as _loadSecrets, MIN_SECRET_LENGTH, SAFE_VALUES };
