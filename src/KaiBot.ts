import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

import { isNewFeatureFile, markComplete, markInProgress, parseFeature } from "./feature.js";
import { processFeature } from "./KaiAgent.js";

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
 * Each feature is processed concurrently; errors are logged and the file is
 * left as _inprogress for manual inspection / retry.
 */
export class KaiBot {
  private readonly projectDir: string;
  private readonly featuresDir: string;
  private readonly model: string;

  /** Names of features currently being processed — prevents double-processing. */
  private readonly processing = new Set<string>();

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

    console.log(`KaiBot started`);
    console.log(`  Project : ${this.projectDir}`);
    console.log(`  Watching: ${this.featuresDir}`);
    console.log(`  Model   : ${this.model}`);
    console.log(`\nDrop a .md file into ${this.featuresDir} to queue a feature.\n`);

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
      console.log(`Created: ${this.featuresDir}`);
    }
  }

  private async checkForNewFeatures(): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(this.featuresDir);
    } catch {
      return; // directory temporarily unavailable
    }

    for (const file of files) {
      if (!isNewFeatureFile(file)) continue;

      const feature = parseFeature(join(this.featuresDir, file));
      if (this.processing.has(feature.name)) continue;

      console.log(`Found new feature file: ${file}`);
      this.processing.add(feature.name);
      void this.handleFeature(join(this.featuresDir, file));
    }
  }

  private async handleFeature(filePath: string): Promise<void> {
    let feature = parseFeature(filePath);

    try {
      console.log(`\n>>> New feature: ${feature.name}`);

      feature = markInProgress(feature);
      console.log(`    Renamed to: ${feature.filePath}`);

      await processFeature(feature, this.projectDir, this.model);

      feature = markComplete(feature);
      console.log(`\n>>> Complete: ${feature.filePath}\n`);
    } catch (err) {
      if (isAuthError(err)) {
        console.error(`\n>>> Authentication error: ${err}`);
        console.error(
          "    Check that ANTHROPIC_API_KEY is valid at https://console.anthropic.com/",
        );
        this.stop();
        process.exit(1);
      }
      console.error(`\n>>> Error processing "${feature.name}": ${err}`);
      console.error(`    File left at: ${feature.filePath} for inspection.\n`);
    } finally {
      this.processing.delete(feature.name);
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
