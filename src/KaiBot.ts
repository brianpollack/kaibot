import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { appendChangelog } from "./changelog.js";
import { extractFeatureDescription, promptAndCommit } from "./commit.js";
import { getGitBranch, getLastCommitHash } from "./git.js";
import {
  generateFeatureId,
  isNewFeatureFile,
  markComplete,
  markHold,
  markInProgress,
  parseFeature,
} from "./feature.js";
import { appendFeatureRecord } from "./featureDb.js";
import { generateSummary, generateTitle, processFeature } from "./KaiAgent.js";
import {
  buildLinearPlanComment,
  buildLinearCompletionComment,
  cleanupMaterializedLinearWorkfile,
  cleanupStaleLinearWorkfiles,
  getLinearConfigFromEnv,
  LocalLinearClient,
  type LinearIssue,
  materializeLinearIssue,
} from "./linear.js";
import { uiStore } from "./ui/store.js";

const POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// KaiBot
// ---------------------------------------------------------------------------

/**
 * Watches for new work and processes each item through the agent pipeline.
 *
 * Modes:
 * - File mode (default): watches {projectDir}/features/*.md
 * - Linear mode: polls a Linear team for triage/backlog/unstarted issues
 */
export class KaiBot {
  private readonly projectDir: string;
  private readonly featuresDir: string;
  private readonly linearClient: LocalLinearClient | null;
  private readonly linearTeamRef: string | null;
  private linearTeamId: string | null = null;
  private linearTeamLabel: string | null = null;
  private linearStartedStateId: string | null = null;
  private linearCompletedStateId: string | null = null;
  private model: string;

  /** Timestamp (ms) when each feature file was first seen — used to enforce a
   *  minimum 2-second settle delay before processing begins. */
  private readonly seenAt = new Map<string, number>();

  private running = false;

  constructor(projectDir: string, model = "claude-opus-4-6", useLinear = false) {
    this.projectDir = projectDir;
    this.featuresDir = join(projectDir, "features");
    this.model = model;

    if (useLinear) {
      const linearCfg = getLinearConfigFromEnv();
      this.linearClient = linearCfg ? new LocalLinearClient(linearCfg.apiKey) : null;
      this.linearTeamRef = linearCfg?.teamRef ?? null;
    } else {
      this.linearClient = null;
      this.linearTeamRef = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start the watch loop. Runs until stop() is called. */
  async start(): Promise<void> {
    if (this.isLinearMode()) {
      await this.initLinearMode();
    } else {
      this.ensureFeaturesDir();
    }

    this.running = true;

    uiStore.setProjectDir(this.projectDir);
    uiStore.setModel(this.model);
    uiStore.setStatus("watching");
    uiStore.setStatusMessage(this.getWatchingMessage());

    // Listen for runtime model changes from the UI
    uiStore.on("model-changed", (newModel: string) => {
      this.model = newModel;
    });

    while (this.running) {
      if (this.isLinearMode()) {
        await this.checkForNewLinearIssues();
      } else {
        await this.checkForNewFeatures();
      }
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

  private isLinearMode(): boolean {
    return Boolean(this.linearClient && this.linearTeamRef);
  }

  private async initLinearMode(): Promise<void> {
    if (!this.linearClient || !this.linearTeamRef) return;
    const setup = await this.linearClient.resolveTeamSetup(this.linearTeamRef);
    this.linearTeamId = setup.teamId;
    this.linearTeamLabel = setup.teamLabel;
    this.linearStartedStateId = setup.startedStateId;
    this.linearCompletedStateId = setup.completedStateId;
    cleanupStaleLinearWorkfiles(this.projectDir);
  }

  private getWatchingMessage(): string {
    if (this.isLinearMode()) {
      const target = LocalLinearClient.getMyProjectName() || "<Team LINEAR_PROJECT_NAME not set>";
      return `Watching Linear team '${target}' for new issues…`;
    }
    return `Watching ${this.featuresDir} for features…`;
  }

  private ensureFeaturesDir(): void {
    for (const sub of ["", "inprogress", "complete", "hold", "log"]) {
      const dir = sub ? join(this.featuresDir, sub) : this.featuresDir;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private async checkForNewLinearIssues(): Promise<void> {
    if (!this.linearClient || !this.linearTeamId) return;

    const issue = await this.linearClient.getNextReadyIssue();
    if (!issue) return;

    uiStore.setStatusMessage(`Processing: ${issue.identifier} ${issue.title}`);
    await this.handleLinearIssue(issue);
  }

  private async handleLinearIssue(issue: LinearIssue): Promise<void> {
    if (!this.linearClient) return;

    const issueId = issue.id;
    const issueIdentifier = issue.identifier;
    let feature = materializeLinearIssue(this.projectDir, issue);
    let shouldCleanupWorkfile = false;
    const preExistingChanges = getGitStatusPaths(this.projectDir);
    const gitBranch = getGitBranch(this.projectDir);

    try {
      uiStore.setStatus("processing");
      uiStore.setFeatureName(`${issueIdentifier} ${issue.title}`);
      uiStore.setStatusMessage(`Processing: ${issueIdentifier} ${issue.title}`);

      // Generate an AI title from the materialized feature content
      let featureTitle = "";
      try {
        const rawContent = readFileSync(feature.filePath, "utf8");
        featureTitle = await generateTitle(rawContent, this.projectDir);
        if (featureTitle) {
          uiStore.setFeatureName(`${issueIdentifier} ${featureTitle}`);
          uiStore.setStatusMessage(`Processing: ${issueIdentifier} ${featureTitle}`);
        }
      } catch { /* fall back to Linear issue title */ }

      if (this.linearStartedStateId) {
        await this.linearClient.updateIssueState(issueId, this.linearStartedStateId);
      }

      const stats = await processFeature(feature, this.projectDir, this.model, {
        onPlanCreated: async (planSection: string) => {
          if (!this.linearClient) return;
          const comment = buildLinearPlanComment(issueIdentifier, planSection);
          await this.linearClient.addComment(issueId, comment);
        },
      });

      feature = markComplete(feature);
      appendChangelog(feature, this.projectDir);
      const changedFiles = getNewlyChangedFiles(this.projectDir, preExistingChanges);
      const committed = await promptAndCommit(feature, this.projectDir);
      const gitCommitHash = committed ? getLastCommitHash(this.projectDir) : null;

      if (this.linearCompletedStateId) {
        await this.linearClient.updateIssueState(issueId, this.linearCompletedStateId);
        shouldCleanupWorkfile = true;
      }

      const comment = buildLinearCompletionComment(feature, issueIdentifier, changedFiles);
      await this.linearClient.addComment(issueId, comment);
      shouldCleanupWorkfile = true;

      const summary = await generateSummary(feature, this.projectDir);

      // Capture timestamped conversation history and file activity before reset
      const conversationHistory = uiStore.getConversationSnapshot();
      const fileActivity = uiStore.getFileActivitySnapshot();

      appendFeatureRecord(this.projectDir, {
        id: generateFeatureId(),
        requestedAt: issue.createdAt,
        completedAt: new Date().toISOString(),
        executionTimeMs: stats.durationMs,
        model: this.model,
        tokensIn: stats.tokensIn,
        tokensOut: stats.tokensOut,
        cacheReadTokens: stats.cacheReadTokens,
        cacheWriteTokens: stats.cacheWriteTokens,
        totalCostUsd: stats.totalCostUsd,
        numTurns: stats.numTurns,
        filesChanged: changedFiles,
        testsAdded: changedFiles.filter(isTestFile),
        gitBranch,
        gitCommitHash,
        description: issue.title,
        planPoints: stats.planPoints,
        source: "linear",
        linearIssueId: issueId,
        linearIdentifier: issueIdentifier,
        status: "success",
        errorMessage: null,
        title: featureTitle || issue.title,
        summary,
        conversationHistory,
        fileActivity,
      });

      uiStore.setStatusMessage(`Complete: ${issueIdentifier}`);
      uiStore.resetFeature();
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(this.getWatchingMessage());
    } catch (err) {
      if (isAuthError(err)) {
        uiStore.setStatus("error");
        uiStore.setStatusMessage(
          "Authentication error — check API keys (ANTHROPIC_API_KEY / LINEAR_API_KEY).",
        );
        this.stop();
        process.exit(1);
      }

      uiStore.setStatus("error");
      uiStore.setStatusMessage(
        `Error processing "${issueIdentifier}" — workfile left at: ${feature.filePath}`,
      );
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(this.getWatchingMessage());
    } finally {
      if (shouldCleanupWorkfile) {
        cleanupMaterializedLinearWorkfile(this.projectDir, feature.filePath);
      }
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

      const requestedAt = new Date(this.seenAt.get(feature.name)!).toISOString();
      this.seenAt.delete(feature.name);
      uiStore.setStatusMessage(`Processing: ${file}`);

      // Process one feature at a time — await it before scanning for more.
      await this.handleFeatureFile(join(this.featuresDir, file), requestedAt);
      return;
    }
  }

  private async handleFeatureFile(filePath: string, requestedAt: string): Promise<void> {
    let feature = parseFeature(filePath);

    // Assign a unique feature ID
    const featureId = generateFeatureId();
    feature.featureId = featureId;

    // Capture description and git branch before the agent modifies the file
    let featureDescription = feature.name;
    try {
      featureDescription = extractFeatureDescription(readFileSync(filePath, "utf8"), feature.name);
    } catch { /* ignore */ }
    const gitBranch = getGitBranch(this.projectDir);
    const preExistingChanges = getGitStatusPaths(this.projectDir);

    try {
      uiStore.setStatus("processing");
      uiStore.setFeatureName(feature.name);
      uiStore.setStatusMessage(`Processing: ${feature.name} [${featureId}]`);

      // Generate an AI title from the raw feature content before agent modifies it
      let featureTitle = "";
      try {
        const rawContent = readFileSync(filePath, "utf8");
        featureTitle = await generateTitle(rawContent, this.projectDir);
        if (featureTitle) {
          uiStore.setFeatureName(featureTitle);
          uiStore.setStatusMessage(`Processing: ${featureTitle} [${featureId}]`);
        }
      } catch { /* fall back to filename-derived name */ }

      feature = markInProgress(feature);
      feature.featureId = featureId;

      // Prepend Feature ID to the file content
      this.prependFeatureId(feature.filePath, featureId);

      const stats = await processFeature(feature, this.projectDir, this.model);

      feature = markComplete(feature);
      feature.featureId = featureId;
      appendChangelog(feature, this.projectDir);
      const changedFiles = getNewlyChangedFiles(this.projectDir, preExistingChanges);

      // Offer to auto-commit; defaults to Yes after 5s timeout
      const committed = await promptAndCommit(feature, this.projectDir, featureId);
      const gitCommitHash = committed ? getLastCommitHash(this.projectDir) : null;

      const summary = await generateSummary(feature, this.projectDir);

      // Capture timestamped conversation history and file activity before reset
      const conversationHistory = uiStore.getConversationSnapshot();
      const fileActivity = uiStore.getFileActivitySnapshot();

      const record = {
        id: featureId,
        requestedAt,
        completedAt: new Date().toISOString(),
        executionTimeMs: stats.durationMs,
        model: this.model,
        tokensIn: stats.tokensIn,
        tokensOut: stats.tokensOut,
        cacheReadTokens: stats.cacheReadTokens,
        cacheWriteTokens: stats.cacheWriteTokens,
        totalCostUsd: stats.totalCostUsd,
        numTurns: stats.numTurns,
        filesChanged: changedFiles,
        testsAdded: changedFiles.filter(isTestFile),
        gitBranch,
        gitCommitHash,
        description: featureDescription,
        planPoints: stats.planPoints,
        source: "file" as const,
        linearIssueId: null,
        linearIdentifier: null,
        status: "success" as const,
        errorMessage: null,
        title: featureTitle,
        summary,
        conversationHistory,
        fileActivity,
      };

      appendFeatureRecord(this.projectDir, record);

      // Write summary log JSON to features/log/<featureId>.json
      this.writeFeatureLog(featureId, record);

      const displayName = featureTitle || feature.name;
      uiStore.setStatusMessage(`Complete: ${displayName} [${featureId}]`);
      uiStore.resetFeature();
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(this.getWatchingMessage());
    } catch (err) {
      if (isAuthError(err)) {
        uiStore.setStatus("error");
        uiStore.setStatusMessage(
          "Authentication error — check ANTHROPIC_API_KEY at https://console.anthropic.com/",
        );
        this.stop();
        process.exit(1);
      }

      // Move to hold/ folder with an Information Needed section
      const errMsg = err instanceof Error ? err.message : String(err);
      try {
        this.appendInformationNeeded(feature.filePath, errMsg);
        feature = markHold(feature);
        feature.featureId = featureId;
      } catch {
        // If markHold fails, leave file where it is
      }

      uiStore.setStatus("error");
      uiStore.setStatusMessage(
        `Error processing "${feature.name}" — moved to hold: ${feature.filePath}`,
      );
      // Reset to watching after a brief pause so the error is visible
      uiStore.setStatus("watching");
      uiStore.setStatusMessage(this.getWatchingMessage());
    }
  }

  /** Prepend a Feature ID line to the top of a feature file. */
  private prependFeatureId(filePath: string, featureId: string): void {
    try {
      const content = readFileSync(filePath, "utf8");
      writeFileSync(filePath, `Feature ID: ${featureId}\n\n${content}`);
    } catch {
      // Ignore if file can't be read/written
    }
  }

  /** Append an ## Information Needed section to a feature file. */
  private appendInformationNeeded(filePath: string, errorMessage: string): void {
    try {
      const content = readFileSync(filePath, "utf8");
      const section = `\n\n## Information Needed\n\nProcessing failed with the following error:\n\n> ${errorMessage}\n\nPlease resolve the issue and move this file back to the \`features/\` folder to retry.\n`;
      writeFileSync(filePath, content + section);
    } catch {
      // Ignore if file can't be read/written
    }
  }

  /** Write a summary log JSON to features/log/<featureId>.json */
  private writeFeatureLog(featureId: string, record: Record<string, unknown>): void {
    try {
      const logDir = join(this.featuresDir, "log");
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, `${featureId}.json`);
      writeFileSync(logPath, JSON.stringify(record, null, 2) + "\n");
    } catch {
      // Non-critical — ignore errors
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
    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("authentication") ||
      msg.includes("api key") ||
      msg.includes("invalid x-api-key") ||
      msg.includes("unauthorized")
    ) {
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

function getGitStatusPaths(projectDir: string): Set<string> {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: projectDir, stdio: "pipe" });
    const status = execSync("git status --porcelain", {
      cwd: projectDir,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    if (!status) return new Set();

    const paths = status
      .split("\n")
      .map((line) => parsePorcelainPath(line))
      .filter((path): path is string => Boolean(path));
    return new Set(paths);
  } catch {
    return new Set();
  }
}

function parsePorcelainPath(line: string): string | null {
  const raw = line.slice(3).trim();
  if (!raw) return null;
  if (raw.includes(" -> ")) {
    const [, renamedTo] = raw.split(" -> ");
    return renamedTo?.trim() ?? null;
  }
  return raw;
}

function getNewlyChangedFiles(projectDir: string, baseline: Set<string>): string[] {
  const current = getGitStatusPaths(projectDir);
  const files = [...current]
    .filter((path) => !baseline.has(path))
    .filter((path) => !path.startsWith(".kaibot/linear/"))
    .sort((a, b) => a.localeCompare(b));
  return files;
}

/** Returns true for test files (*.test.*, *.spec.*, or inside __tests__/). */
function isTestFile(filePath: string): boolean {
  return /[._-]test\.[^./]+$|[._-]spec\.[^./]+$|__tests__[\\/]/.test(filePath);
}
