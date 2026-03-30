import { execSync } from "child_process";

import type { Feature } from "./feature.js";
import { uiStore } from "./ui/store.js";
import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a meaningful single-line error message from an execSync failure.
 * execSync errors carry stderr as a Buffer on the thrown Error object.
 */
function extractGitError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
    const stderr = e.stderr ? String(e.stderr).trim() : "";
    if (stderr) return stderr.split("\n").filter(Boolean)[0] ?? stderr;
    return err.message.split("\n").filter(Boolean)[0] ?? err.message;
  }
  return String(err).split("\n")[0];
}

/** Returns true if there is a configured git remote named "origin". */
function hasRemote(cwd: string): boolean {
  try {
    const out = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 10_000,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

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
      timeout: 10_000,
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
      timeout: 10_000,
    });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Extracts the original user-written description from a feature file for use
 * as a git commit message.
 *
 * Returns all non-empty content lines before any `## Plan`, `## Summary`, or
 * `## Metadata` section, joined into a single string. This preserves the
 * original intent as written before the agent ran.
 *
 * See also: `extractDescription` in changelog.ts, which instead prefers the
 * agent-written `## Summary` section for use in the changelog and Linear.
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
export function buildCommitMessage(feature: Feature, featureId?: string): string {
  let description = feature.name;
  try {
    const content = readFileSync(feature.filePath, "utf8");
    description = extractFeatureDescription(content, feature.name);
  } catch {
    // Fall back to feature name
  }
  if (featureId) {
    return `${description} [${featureId}]`;
  }
  return description;
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
  featureId?: string,
): Promise<boolean> {
  if (!isGitRepo(projectDir)) {
    return false;
  }

  if (!hasChanges(projectDir)) {
    return false;
  }

  const message = buildCommitMessage(feature, featureId);

  uiStore.setStatusMessage(`Commit: "${message}"`);
  const shouldCommit = await uiStore.showCommitPrompt(message);

  if (!shouldCommit) {
    uiStore.setStatusMessage("Commit skipped by user.");
    return false;
  }

  try {
    execSync("git add -A", { cwd: projectDir, stdio: "pipe", timeout: 30_000 });
    execSync(`git commit -m ${JSON.stringify(message)}`, {
      cwd: projectDir,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (err) {
    const errMsg = extractGitError(err);
    uiStore.setStatusMessage(`Commit failed: ${errMsg}`);
    uiStore.pushConversationSystem(`⚠️ Git commit failed: ${errMsg}`);
    return false;
  }

  // Attempt git push if a remote is configured — failure is non-fatal.
  if (hasRemote(projectDir)) {
    try {
      execSync("git push", { cwd: projectDir, stdio: "pipe", timeout: 60_000 });
      uiStore.setStatusMessage(`Committed and pushed: "${message}"`);
    } catch (err) {
      const errMsg = extractGitError(err);
      uiStore.setStatusMessage(`Committed (push failed): "${message}"`);
      uiStore.pushConversationSystem(`⚠️ Git push failed: ${errMsg}`);
    }
  } else {
    uiStore.setStatusMessage(`Committed: "${message}"`);
  }

  return true;
}
