import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Load key/value pairs from <projectDir>/.env into process.env.
 * Project-specific values override existing process env values.
 */
export function loadProjectEnv(projectDir: string): void {
  const envPath = join(projectDir, ".env");
  if (!existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  const vars = parseDotEnv(raw);

  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}
