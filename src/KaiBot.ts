import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

import { appendChangelog } from "./changelog.js";
import { promptAndCommit } from "./commit.js";
import { isNewFeatureFile, markComplete, markInProgress, parseFeature } from "./feature.js";
import { processFeature } from "./KaiAgent.js";
import { uiStore } from "./ui/store.js";

const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// KaiBot
// ---------------------------------------------------------------------------

/**
 * Watches a project's features/ directory for new .md files and processes
 * each one through the agent pipeline:
 *
 *   new_feature.md
 *     → new_feature_inprogress.md  (agent plans + executes)
 *     → new_feature_complete.md    (on success)
 *
 * Features are processed one at a time in the order they are discovered.
 * Errors are logged and the file is left as _inprogress for manual
 * inspection / retry.
 */
export class KaiBot {
  private readonly projectDir: string;
  private readonly featuresDir: string;
  private model: string;

  /** Timestamp (ms) when each feature file was first seen — used to enforce a
   *  minimum 2-second settle delay before processing begins. */
  private readonly seenAt = new Map<string, number>();

  private running = false;

  constructor(projectDir: string, model = "claude-opus-4-6") {
    this.projectDir = projectDir;
    this.featuresDir = join(projectDir, "features");
    this.model = model;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start the watch loop. Runs until stop() is called. */
  async start(): Promise<void> {
    this.ensureFeaturesDir();
    this.running = true;

    uiStore.setProjectDir(this.projectDir);
    uiStore.setModel(this.model);
    uiStore.setStatus("watching");
    uiStore.setStatusMessage(`Watching ${this.featuresDir} for features…`);

    // Listen for runtime model changes from the UI
    uiStore.on("model-changed", (newModel: string) => {
      this.model = newModel;
    });

    while (this.running) {
      await this.checkForNewFeatures();
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** Stop the watch loop after the current poll completes. */
  stop(): void {
    this.running = false;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private ensureFeaturesDir(): void {
    if (!existsSync(this.featuresDir)) {
      mkdirSync(this.featuresDir, { recursive: true });
    }
  }

  private async checkForNewFeatures(): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(this.featuresDir);
    } catch {
      return; // directory temporarily unavailable
    }

    const now = Date.now();

    for (const file of files) {
      if (!isNewFeatureFile(file)) continue;

      const feature = parseFeature(join(this.featuresDir, file));

      // Record first-seen timestamp; skip this cycle so the file can settle.
      if (!this.seenAt.has(feature.name)) {
        uiStore.setStatusMessage(`Found: ${file} (waiting for file to settle…)`);
        this.seenAt.set(feature.name, now);
        continue;
      }

      // Enforce at least 2 seconds since first seen.
      if (now - this.seenAt.get(feature.name)! < POLL_INTERVAL_MS) continue;

      // Check that the file has content; if empty, wait another cycle.
      const content = readFileSync(join(this.featuresDir, file), "utf8").trim();
      if (content.length === 0) {
        uiStore.setStatusMessage(`Feature file is empty, waiting: ${file}`);
        continue;
      }

      this.seenAt.delete(feature.name);
      uiStore.setStatusMessage(`Processing: ${file}`);

      // Process one feature at a time — await it before scanning for more.
      await this.handleFeature(join(this.featuresDir, file));
      return;
    }
  }

  private async handleFeature(filePath: string): Promise<void> {
    let feature = parseFeature(filePath);

    try {
      uiStore.setStatus("processing");
      uiStore.setFeatureName(feature.name);
      uiStore.setStatusMessage(`Processing: ${feature.name}`);

      feature = markInProgress(feature);

      await processFeature(feature, this.projectDir, this.model);

      feature = markComplete(feature);
      appendChangelog(feature, this.projectDir);

      // Offer to auto-commit; defaults to Yes after 5s timeout
      await promptAndCommit(feature, this.projectDir);

      uiStore.setStatusMessage(`Complete: ${feature.name}`);
      uiStore.resetFeature();
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(`Watching ${this.featuresDir} for features…`);
    } catch (err) {
      if (isAuthError(err)) {
        uiStore.setStatus("error");
        uiStore.setStatusMessage(
          "Authentication error — check ANTHROPIC_API_KEY at https://console.anthropic.com/",
        );
        this.stop();
        process.exit(1);
      }
      uiStore.setStatus("error");
      uiStore.setStatusMessage(
        `Error processing "${feature.name}" — file left at: ${feature.filePath}`,
      );
      // Reset to watching after a brief pause so the error is visible
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(`Watching ${this.featuresDir} for features…`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("401") || msg.includes("403") || msg.includes("authentication") || msg.includes("api key") || msg.includes("invalid x-api-key") || msg.includes("unauthorized")) {
      return true;
    }
  }
  // Anthropic SDK errors expose a numeric status property
  if (typeof err === "object" && err !== null) {
    const status = (err as Record<string, unknown>).status;
    if (status === 401 || status === 403) return true;
  }
  return false;
}
