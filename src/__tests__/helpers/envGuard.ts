/**
 * Utility for skipping test suites when required environment variables are absent.
 *
 * Usage:
 *   import { skipIfMissingEnv } from "./helpers/envGuard.js";
 *   skipIfMissingEnv("ANTHROPIC_API_KEY")("suite name", () => { ... });
 */

import { describe } from "vitest";

/**
 * Returns `describe.skip` when any of the listed env vars are unset,
 * otherwise returns `describe`. The test suite is skipped silently
 * (not run, not a failure) when keys are absent.
 */
export function skipIfMissingEnv(...vars: string[]): typeof describe {
  const missing = vars.filter((v) => !process.env[v]);
  return missing.length > 0 ? (describe.skip as typeof describe) : describe;
}
