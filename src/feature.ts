import { basename, dirname, join } from "path";
import { renameSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureState = "new" | "inprogress" | "complete";

export interface Feature {
  /** Base name without state suffix or extension, e.g. "new_user" */
  name: string;
  state: FeatureState;
  /** Absolute path to the current file on disk */
  filePath: string;
}

// ---------------------------------------------------------------------------
// File name helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for plain .md files that haven't been picked up yet.
 * Ignores _inprogress.md and _complete.md files.
 */
export function isNewFeatureFile(filename: string): boolean {
  return (
    filename.endsWith(".md") &&
    !filename.endsWith("_inprogress.md") &&
    !filename.endsWith("_complete.md")
  );
}

/** Parse a feature from an absolute file path. */
export function parseFeature(filePath: string): Feature {
  const filename = basename(filePath);
  const dir = dirname(filePath);

  if (filename.endsWith("_inprogress.md")) {
    return {
      name: filename.replace(/_inprogress\.md$/, ""),
      state: "inprogress",
      filePath,
    };
  }

  if (filename.endsWith("_complete.md")) {
    return {
      name: filename.replace(/_complete\.md$/, ""),
      state: "complete",
      filePath,
    };
  }

  // Plain .md — treat as new regardless of dir
  return {
    name: filename.replace(/\.md$/, ""),
    state: "new",
    filePath: join(dir, filename),
  };
}

// ---------------------------------------------------------------------------
// State transitions (rename on disk + return updated Feature)
// ---------------------------------------------------------------------------

/**
 * Renames  features/my_feature.md  →  features/my_feature_inprogress.md
 */
export function markInProgress(feature: Feature): Feature {
  const newPath = join(dirname(feature.filePath), `${feature.name}_inprogress.md`);
  renameSync(feature.filePath, newPath);
  return { ...feature, state: "inprogress", filePath: newPath };
}

/**
 * Renames  features/my_feature_inprogress.md  →  features/my_feature_complete.md
 */
export function markComplete(feature: Feature): Feature {
  const newPath = join(dirname(feature.filePath), `${feature.name}_complete.md`);
  renameSync(feature.filePath, newPath);
  return { ...feature, state: "complete", filePath: newPath };
}
