import { execSync } from "child_process";

import type { Feature } from "./feature.js";
import { uiStore } from "./ui/store.js";
import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether the project directory is inside a git repository. */
function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** Check whether there are staged or unstaged changes to commit. */
function hasChanges(cwd: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Extracts the original feature description from a feature file.
 *
 * Returns all non-empty content lines before any `## Plan`, `## Summary`, or
 * `## Metadata` section, joined into a single string. Falls back to the
 * provided fallback value if no description is found.
 */
export function extractFeatureDescription(
  content: string,
  fallback: string,
): string {
  const lines = content.split("\n");
  const descriptionLines: string[] = [];

  for (const line of lines) {
    // Stop at agent-generated sections
    if (/^##\s+(Plan|Summary|Metadata)/i.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      descriptionLines.push(trimmed);
    }
  }

  return descriptionLines.length > 0
    ? descriptionLines.join(" ")
    : fallback;
}

/** Build a commit message from the completed feature. */
export function buildCommitMessage(feature: Feature): string {
  let description = feature.name;
  try {
    const content = readFileSync(feature.filePath, "utf8");
    description = extractFeatureDescription(content, feature.name);
  } catch {
    // Fall back to feature name
  }
  return `feat: ${description}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * After a feature completes, propose a git commit to the user.
 *
 * Shows the commit message in the UI and waits up to 5 seconds for the user
 * to confirm (Yes is the default). If the user selects No, the commit is
 * skipped.
 *
 * Returns true if a commit was created, false otherwise.
 */
export async function promptAndCommit(
  feature: Feature,
  projectDir: string,
): Promise<boolean> {
  if (!isGitRepo(projectDir)) {
    return false;
  }

  if (!hasChanges(projectDir)) {
    return false;
  }

  const message = buildCommitMessage(feature);

  uiStore.setStatusMessage(`Commit: "${message}"`);
  const shouldCommit = await uiStore.showCommitPrompt(message);

  if (!shouldCommit) {
    uiStore.setStatusMessage("Commit skipped by user.");
    return false;
  }

  try {
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
    execSync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: projectDir,
      stdio: "pipe",
    });
    uiStore.setStatusMessage(`Committed: "${message}"`);
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    uiStore.setStatusMessage(`Commit failed: ${errMsg}`);
    return false;
  }
}
