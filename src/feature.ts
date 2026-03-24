import { randomBytes } from "crypto";
import { basename, dirname, join } from "path";
import { mkdirSync, renameSync } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureState = "new" | "inprogress" | "complete" | "hold";

export interface Feature {
  /** Base name without state suffix or extension, e.g. "new_user" */
  name: string;
  state: FeatureState;
  /** Absolute path to the current file on disk */
  filePath: string;
  /** Unique short ID assigned when processing begins (URL-safe) */
  featureId?: string;
}

// ---------------------------------------------------------------------------
// Feature ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a short, URL-safe unique ID (8 characters, base64url-encoded).
 *
 * Uses `crypto.randomBytes` — no external dependency needed.
 */
export function generateFeatureId(): string {
  return randomBytes(6).toString("base64url");
}

// ---------------------------------------------------------------------------
// File name helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for plain .md files in the features root directory that
 * haven't been picked up yet.
 *
 * Rejects files whose names match legacy suffixes (_inprogress, _complete)
 * and also rejects directory entries that match state subdirectory names.
 */
export function isNewFeatureFile(filename: string): boolean {
  if (!filename.endsWith(".md")) return false;
  // Legacy suffix check for backward compatibility
  if (filename.endsWith("_inprogress.md")) return false;
  if (filename.endsWith("_complete.md")) return false;
  return true;
}

/** Parse a feature from an absolute file path. */
export function parseFeature(filePath: string): Feature {
  const filename = basename(filePath);
  const dir = dirname(filePath);
  const parentDir = basename(dir);
  const name = filename.replace(/\.md$/, "");

  // Detect state from parent directory name
  if (parentDir === "inprogress") {
    return { name, state: "inprogress", filePath };
  }

  if (parentDir === "complete") {
    return { name, state: "complete", filePath };
  }

  if (parentDir === "hold") {
    return { name, state: "hold", filePath };
  }

  // Legacy filename-based detection (backward compatibility)
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

  // Plain .md — treat as new
  return {
    name,
    state: "new",
    filePath: join(dir, filename),
  };
}

// ---------------------------------------------------------------------------
// State transitions (move on disk + return updated Feature)
// ---------------------------------------------------------------------------

/**
 * Moves  features/my_feature.md  →  features/inprogress/my_feature.md
 *
 * Creates the `inprogress/` subdirectory if it doesn't already exist.
 */
export function markInProgress(feature: Feature): Feature {
  const featuresDir = dirname(feature.filePath);
  const inprogressDir = join(featuresDir, "inprogress");
  mkdirSync(inprogressDir, { recursive: true });
  const newPath = join(inprogressDir, `${feature.name}.md`);
  renameSync(feature.filePath, newPath);
  return { ...feature, state: "inprogress", filePath: newPath };
}

/**
 * Moves  features/inprogress/my_feature.md  →  features/complete/my_feature.md
 *
 * Creates the `complete/` subdirectory if it doesn't already exist.
 * Handles files from both `inprogress/` subdirectory and the features root.
 */
export function markComplete(feature: Feature): Feature {
  // Navigate to the features root: if in inprogress/, go up one level
  const parentDir = basename(dirname(feature.filePath));
  const featuresRoot =
    parentDir === "inprogress" || parentDir === "hold"
      ? dirname(dirname(feature.filePath))
      : dirname(feature.filePath);
  const completeDir = join(featuresRoot, "complete");
  mkdirSync(completeDir, { recursive: true });
  const newPath = join(completeDir, `${feature.name}.md`);
  renameSync(feature.filePath, newPath);
  return { ...feature, state: "complete", filePath: newPath };
}

/**
 * Moves a feature file to  features/hold/my_feature.md
 *
 * Creates the `hold/` subdirectory if it doesn't already exist.
 * Used when a feature fails or requires additional information.
 */
export function markHold(feature: Feature): Feature {
  // Navigate to the features root: if in inprogress/, go up one level
  const parentDir = basename(dirname(feature.filePath));
  const featuresRoot =
    parentDir === "inprogress"
      ? dirname(dirname(feature.filePath))
      : dirname(feature.filePath);
  const holdDir = join(featuresRoot, "hold");
  mkdirSync(holdDir, { recursive: true });
  const newPath = join(holdDir, `${feature.name}.md`);
  renameSync(feature.filePath, newPath);
  return { ...feature, state: "hold", filePath: newPath };
}
