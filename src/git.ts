import { execSync } from "child_process";

/** Returns the current git branch name, or "unknown" if not in a git repo. */
export function getGitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Returns the SHA of the most recent commit, or null if not in a git repo. */
export function getLastCommitHash(cwd: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return null;
  }
}
