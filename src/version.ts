import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Cached version string read from KaiBot's own package.json. */
let _version: string | null = null;

/**
 * Return KaiBot's version from its package.json (e.g. "0.9.0").
 * The value is cached after the first call.
 */
export function getKaiBotVersion(): string {
  if (_version) return _version;
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    _version = pkg.version ?? "unknown";
  } catch {
    _version = "unknown";
  }
  return _version;
}

/** Return the root directory of the KaiBot installation. */
export function getKaiBotRoot(): string {
  return join(__dirname, "..");
}
