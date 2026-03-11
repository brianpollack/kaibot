import { execSync } from "child_process";
import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

import type { Feature } from "./feature.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the current git branch name, or "unknown" if not in a git repo. */
function getGitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Returns the current system user from environment variables. */
function getUser(): string {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}

/**
 * Formats a date as "Month Dth, YYYY" (e.g. "March 10th, 2025").
 */
function formatDate(date: Date): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th";

  return `${month} ${day}${suffix}, ${year}`;
}

// ---------------------------------------------------------------------------
// Description extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a changelog description from the feature file content.
 *
 * Preference order:
 *   1. First non-empty line from the `## Summary` section (written by the
 *      agent after completing the feature — concise and impersonal).
 *   2. First non-empty content line that isn't a heading or checkbox.
 *   3. The feature name as a last-resort fallback.
 */
export function extractDescription(content: string, fallback: string): string {
  const lines = content.split("\n");

  // 1. Try the ## Summary section
  const summaryIdx = lines.findIndex((l) => /^##\s+Summary/i.test(l));
  if (summaryIdx !== -1) {
    for (let i = summaryIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      // Stop at the next heading (any level)
      if (/^#{1,6}\s/.test(line)) break;
      if (line.length > 0) return line;
    }
  }

  // 2. Fall back to first non-header, non-checkbox content line
  const firstContentLine = lines.find(
    (line) =>
      line.trim().length > 0 &&
      !line.startsWith("#") &&
      !line.startsWith("- ["),
  );
  if (firstContentLine) return firstContentLine.trim();

  // 3. Last resort
  return fallback;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Appends a changelog entry to `CHANGELOG.md` in the given project directory.
 *
 * Format:
 * ```
 * March 10th, 2025: main: brian
 * Description of the feature from the feature file.
 * ```
 */
export function appendChangelog(
  feature: Feature,
  projectDir: string,
  date: Date = new Date(),
): void {
  const changelogPath = join(projectDir, "CHANGELOG.md");
  const branch = getGitBranch(projectDir);
  const user = getUser();
  const dateStr = formatDate(date);

  // Read the feature file content for the description.
  // Prefer the ## Summary section (written by the agent after completing the
  // feature) over the raw first content line, which tends to be conversational.
  // Falls back to the feature name if the file can't be read.
  let description = feature.name;
  try {
    const content = readFileSync(feature.filePath, "utf8");
    description = extractDescription(content, feature.name);
  } catch {
    // Feature file may have been moved; use feature name as description
  }

  const header = existsSync(changelogPath) ? "" : "# Changelog\n\n";
  const entry = `${header}${dateStr}: ${branch}: ${user}\n${description}\n\n`;

  appendFileSync(changelogPath, entry);
}
