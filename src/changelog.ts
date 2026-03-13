import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

import type { Feature } from "./feature.js";
import { getGitBranch } from "./git.js";

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
 * Extracts a description for use in the changelog and Linear comments.
 *
 * Prefers the agent-written `## Summary` section (polished, impersonal) over
 * the raw user description, since the summary is appended after the feature
 * is complete and tends to be more concise.
 *
 * Preference order:
 *   1. First non-empty line from the `## Summary` section.
 *   2. First non-empty content line that isn't a heading or checkbox.
 *   3. The feature name as a last-resort fallback.
 *
 * See also: `extractFeatureDescription` in commit.ts, which instead extracts
 * the original user-written description (text before `## Plan`) for use as
 * a git commit message.
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
