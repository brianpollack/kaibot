import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BotStatus = "watching" | "processing" | "idle" | "error";

export type FeatureStage =
  | "reading"
  | "thinking"
  | "planning"
  | "executing"
  | "complete"
  | null;

export interface FileOp {
  type: "read" | "write" | "edit";
  path: string;
  preview: string;
  /** Unix ms timestamp when the file operation was recorded. */
  timestamp: number;
}

export interface CommandEntry {
  command: string;
  /** Whether the command is currently running. */
  active: boolean;
}

export interface CommitPromptState {
  /** Whether the commit prompt is currently visible. */
  visible: boolean;
  /** The proposed commit message to display. */
  message: string;
  /** Countdown seconds remaining (starts at 5). */
  countdown: number;
}

export interface PlanLine {
  /** Whether this step is checked (complete). */
  checked: boolean;
  /** The text of the plan step (e.g. "1. Brief step description — note"). */
  text: string;
}

export type ConversationItemType = "thinking" | "command" | "agent" | "git" | "system" | "user" | "file" | "clarify-question" | "clarify-answer";

export interface ConversationItem {
  type: ConversationItemType;
  content: string;
  /** For "command" items only: whether the command is still running. */
  active?: boolean;
  /** Unix ms timestamp — used to coalesce rapid commands into one block. */
  timestamp?: number;
  /** For "agent" items: the subagent type (e.g. "Explore", "Plan"). */
  agentType?: string;
  /** For "agent" items: the short description passed to the subagent. */
  agentDescription?: string;
}

/** Serializable conversation entry written to log JSON files. */
export interface ConversationLogEntry {
  type: ConversationItemType;
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  agentType?: string;
  agentDescription?: string;
}

/** Serializable file-activity entry written to log JSON files. */
export interface FileActivityLogEntry {
  type: "read" | "write" | "edit";
  path: string;
  preview: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

export interface UIState {
  // Header
  status: BotStatus;
  projectDir: string;
  model: string;
  featureName: string | null;
  featureStage: FeatureStage;
  /** Timestamp (Date.now()) when the current feature started processing, or null. */
  featureStartTime: number | null;
  /** Timestamp (Date.now()) when the current feature finished processing, or null while still running. */
  featureEndTime: number | null;

  // Terminal dimensions
  terminalColumns: number;
  terminalRows: number;

  // Thinking panel — last N lines of assistant text
  thinkingLines: string[];

  // Command panel
  commands: CommandEntry[];

  // File operations panel
  fileOps: FileOp[];

  // Plan panel (right side) — checkbox steps from the feature file
  planLines: PlanLine[];
  /** Cost/metadata summary shown in the plan panel once the feature is complete. */
  planCostInfo: string;

  // Unified conversation feed — thinking text, commands, git commits, system msgs
  conversationItems: ConversationItem[];

  // Commit prompt
  commitPrompt: CommitPromptState;

  // Hotkey input mode (inline feature creation)
  hotkeyInputActive: boolean;
  hotkeyInputLines: string[];
  /** Whether the agent is currently reviewing a feature description from the hotkey input. */
  featureReviewActive: boolean;
  /** Temporary flash message shown after hotkey actions (e.g. "Feature created: …"). */
  flashMessage: string;

  // Model selector
  /** Whether the model selector overlay is currently open. */
  isSelectingModel: boolean;

  // Provider selector
  /** The current provider name (e.g. "anthropic", "openrouter"). */
  provider: string;
  /** Whether the provider selector overlay is currently open. */
  isSelectingProvider: boolean;

  // Tech debt scan (legacy — kept for Ink hotkey compatibility)
  /** Whether a tech debt scan is currently running. */
  isScanningTechDebt: boolean;

  // Code Assist
  /** Whether a code assist run is in progress. */
  codeAssistActive: boolean;
  /** Result of the last code assist run (button label + file path), or null. */
  codeAssistResult: { action: string; path: string } | null;

  // Status message (bottom bar)
  statusMessage: string;

  /** Feature ID currently awaiting follow-up prompts from the user, or null. */
  followupFeatureId: string | null;

  /** Welcome screen markdown text (loaded from WELCOME.md on startup). */
  welcomeText: string;
  /** KaiBot version string (e.g. "0.9.0"). */
  kaibotVersion: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_THINKING_LINES = 200;
const MAX_COMMANDS = 100;
const MAX_FILE_OPS = 100;
const MAX_CONVERSATION_ITEMS = 500;

// ---------------------------------------------------------------------------
// Store (singleton)
// ---------------------------------------------------------------------------

class UIStore extends EventEmitter {
  private state: UIState = {
    status: "idle",
    projectDir: "",
    model: "",
    featureName: null,
    featureStage: null,
    featureStartTime: null,
    featureEndTime: null,
    terminalColumns: (process.stdout.columns ?? 80) - 4,
    terminalRows: process.stdout.rows ?? 24,
    thinkingLines: [],
    commands: [],
    fileOps: [],
    planLines: [],
    planCostInfo: "",
    conversationItems: [],
    commitPrompt: { visible: false, message: "", countdown: 0 },
    hotkeyInputActive: false,
    hotkeyInputLines: [],
    featureReviewActive: false,
    flashMessage: "",
    isSelectingModel: false,
    provider: "anthropic",
    isSelectingProvider: false,
    isScanningTechDebt: false,
    codeAssistActive: false,
    codeAssistResult: null,
    statusMessage: "",
    followupFeatureId: null,
    welcomeText: "",
    kaibotVersion: "",
  };

  getState(): Readonly<UIState> {
    return this.state;
  }

  // -- Header / Status ----------------------------------------------------

  setProjectDir(dir: string): void {
    this.state.projectDir = dir;
    this.emitChange();
  }

  setModel(model: string): void {
    this.state.model = model;
    this.emitChange();
  }

  setStatus(status: BotStatus): void {
    this.state.status = status;
    this.emitChange();
  }

  setFeatureName(name: string | null): void {
    this.state.featureName = name;
    this.emitChange();
  }

  setFeatureStage(stage: FeatureStage): void {
    this.state.featureStage = stage;
    this.emitChange();
  }

  setFeatureStartTime(time: number | null): void {
    this.state.featureStartTime = time;
    this.state.featureEndTime = null; // clear end time whenever a new run starts
    this.emitChange();
  }

  setFeatureEndTime(time: number | null): void {
    this.state.featureEndTime = time;
    this.emitChange();
  }

  updateTerminalSize(): void {
    this.state.terminalColumns = (process.stdout.columns ?? 80) - 4;
    this.state.terminalRows = process.stdout.rows ?? 24;
    this.emitChange();
  }

  setStatusMessage(msg: string): void {
    this.state.statusMessage = msg;
    this.emitChange();
  }

  // -- Thinking -----------------------------------------------------------

  appendThinking(text: string): void {
    // Split by newlines and append; keep only last N lines
    const newLines = text.split("\n").filter((l) => l.length > 0);
    if (newLines.length === 0) return;

    this.state.thinkingLines = [
      ...this.state.thinkingLines,
      ...newLines,
    ].slice(-MAX_THINKING_LINES);
    this.emitChange();
  }

  clearThinking(): void {
    this.state.thinkingLines = [];
    this.emitChange();
  }

  // -- Commands -----------------------------------------------------------

  pushCommand(command: string): void {
    // Mark all existing commands as inactive
    for (const cmd of this.state.commands) {
      cmd.active = false;
    }
    this.state.commands = [
      ...this.state.commands,
      { command, active: true },
    ].slice(-MAX_COMMANDS);
    this.emitChange();
  }

  completeCommand(): void {
    const last = this.state.commands.at(-1);
    if (last) {
      last.active = false;
      this.emitChange();
    }
  }

  // -- File ops -----------------------------------------------------------

  pushFileOp(op: Omit<FileOp, "timestamp"> & { timestamp?: number }): void {
    const stamped: FileOp = { ...op, timestamp: op.timestamp ?? Date.now() };
    this.state.fileOps = [...this.state.fileOps, stamped].slice(-MAX_FILE_OPS);
    this.emitChange();
  }

  // -- Plan panel ----------------------------------------------------------

  /** Replace the full set of plan lines (parsed from the feature file). */
  setPlanLines(lines: PlanLine[]): void {
    this.state.planLines = lines;
    this.emitChange();
  }

  /** Set the cost/metadata info shown after feature completion. */
  setPlanCostInfo(info: string): void {
    this.state.planCostInfo = info;
    this.emitChange();
  }

  // -- Conversation feed ---------------------------------------------------

  /**
   * Clear the conversation feed.  Call at the START of a new feature so the
   * previous run's history is wiped before new output begins.
   */
  startConversation(): void {
    this.state.conversationItems = [];
    this.emitChange();
  }

  /**
   * Append assistant thinking text.  Adjacent thinking chunks are merged into
   * a single item so the feed stays compact.
   */
  pushConversationThinking(text: string): void {
    if (!text) return;
    const items = this.state.conversationItems;
    const last = items.at(-1);
    if (last?.type === "thinking") {
      last.content += text;
    } else {
      items.push({ type: "thinking", content: text });
    }
    if (items.length > MAX_CONVERSATION_ITEMS) {
      this.state.conversationItems = items.slice(-MAX_CONVERSATION_ITEMS);
    }
    this.emitChange();
  }

  /**
   * Append a command (Bash or tool call) to the conversation.
   * Commands that arrive within 5 seconds of the previous command are merged
   * into the same code block so rapid bursts (e.g. many ls calls) stay tidy.
   */
  pushConversationCommand(command: string): void {
    const now = Date.now();
    const items = this.state.conversationItems;
    const last = items.at(-1);

    // Coalesce into the previous block if it's still "fresh" (≤ 5 s)
    if (last?.type === "command" && last.active && now - (last.timestamp ?? 0) <= 5_000) {
      last.content += "\n" + command;
      last.timestamp = now;
      this.emitChange();
      return;
    }

    // Otherwise close any active command and start a new block
    for (const item of items) {
      if (item.type === "command" && item.active) item.active = false;
    }
    items.push({ type: "command", content: command, active: true, timestamp: now });
    if (items.length > MAX_CONVERSATION_ITEMS) {
      this.state.conversationItems = items.slice(-MAX_CONVERSATION_ITEMS);
    }
    this.emitChange();
  }

  /**
   * Append an Agent tool-use block to the conversation.
   * Rendered as a distinct yellow-tinted panel with the Claude favicon.
   */
  pushConversationAgent(agentType: string, description: string, prompt: string): void {
    const items = this.state.conversationItems;
    // Close any active command before the agent block
    for (const item of items) {
      if (item.type === "command" && item.active) item.active = false;
    }
    items.push({
      type: "agent" as const,
      content: prompt,
      agentType,
      agentDescription: description,
      timestamp: Date.now(),
    });
    if (items.length > MAX_CONVERSATION_ITEMS) {
      this.state.conversationItems = items.slice(-MAX_CONVERSATION_ITEMS);
    }
    this.emitChange();
  }

  /** Mark the most recently active command as complete. */
  completeConversationCommand(): void {
    const items = this.state.conversationItems;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === "command" && items[i].active) {
        items[i].active = false;
        this.emitChange();
        return;
      }
    }
  }

  /**
   * Append a file change event (Write or Edit) to the conversation.
   * `details` is a plain object that will be JSON-serialised as the content.
   */
  pushConversationFileOp(tool: string, filePath: string, details: Record<string, unknown>): void {
    const content = JSON.stringify({ tool, path: filePath, ...details });
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "file" as const, content, timestamp: Date.now() },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  /** Append a user follow-up message to the conversation. */
  pushConversationUser(message: string): void {
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "user" as const, content: message, timestamp: Date.now() },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  /** Set the feature ID awaiting follow-up, or null to clear. */
  setFollowupFeatureId(id: string | null): void {
    this.state.followupFeatureId = id;
    this.emitChange();
  }

  /** Append a git commit message to the conversation. */
  pushConversationGit(message: string): void {
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "git" as const, content: message },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  /** Append a system-level message (e.g. "✅ Feature complete"). */
  pushConversationSystem(message: string): void {
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "system" as const, content: message },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  pushConversationClarifyQuestion(question: string): void {
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "clarify-question" as const, content: question, timestamp: Date.now() },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  pushConversationClarifyAnswer(answer: string): void {
    this.state.conversationItems = [
      ...this.state.conversationItems,
      { type: "clarify-answer" as const, content: answer, timestamp: Date.now() },
    ].slice(-MAX_CONVERSATION_ITEMS);
    this.emitChange();
  }

  // -- Commit prompt -------------------------------------------------------

  private commitResolve: ((commit: boolean) => void) | null = null;

  /**
   * Show the commit prompt and return a promise that resolves to true (commit)
   * or false (skip). Auto-commits after 5 seconds if no input is received.
   *
   * A 15-second safety timeout ensures the promise always resolves even if
   * the Ink UI countdown stalls or never fires (e.g. no TTY, render error).
   */
  showCommitPrompt(message: string): Promise<boolean> {
    this.state.commitPrompt = { visible: true, message, countdown: 5 };
    this.emitChange();

    return new Promise<boolean>((resolve) => {
      let settled = false;

      // Safety net: resolve after 15s even if the UI never calls resolveCommitPrompt.
      // In web mode there is no Ink component to drive the countdown, so this is the
      // only path that will ever fire — auto-commit after 15 seconds.
      const safetyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.commitResolve = null;
          this.state.commitPrompt = { visible: false, message: "", countdown: 0 };
          this.emitChange();
          resolve(true);
        }
      }, 15_000);

      this.commitResolve = (commit: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimer);
          resolve(commit);
        }
      };
    });
  }

  /** Called by the UI when the user answers or the countdown expires. */
  resolveCommitPrompt(commit: boolean): void {
    const message = this.state.commitPrompt.message;
    this.state.commitPrompt = { visible: false, message: "", countdown: 0 };
    this.emitChange();
    if (this.commitResolve) {
      this.commitResolve(commit);
      this.commitResolve = null;
    }
    // Surface the commit in the conversation feed
    if (commit && message) {
      this.pushConversationGit(message);
    }
  }

  /** Update the countdown display (called every second by the UI timer). */
  setCommitCountdown(seconds: number): void {
    this.state.commitPrompt.countdown = seconds;
    this.emitChange();
  }

  // -- Hotkey input --------------------------------------------------------

  /** Enter hotkey input mode (e.g. for inline feature creation). */
  startHotkeyInput(): void {
    this.state.hotkeyInputActive = true;
    this.state.hotkeyInputLines = [];
    this.emitChange();
  }

  /** Append a line to the hotkey input buffer. */
  appendHotkeyInputLine(line: string): void {
    this.state.hotkeyInputLines = [...this.state.hotkeyInputLines, line];
    this.emitChange();
  }

  /** Exit hotkey input mode and clear the input buffer. */
  finishHotkeyInput(): void {
    this.state.hotkeyInputActive = false;
    this.state.hotkeyInputLines = [];
    this.emitChange();
  }

  /** Mark that an agent review is in progress (or complete). */
  setFeatureReviewActive(active: boolean): void {
    this.state.featureReviewActive = active;
    this.emitChange();
  }

  /** Show a temporary flash message. */
  setFlashMessage(msg: string): void {
    this.state.flashMessage = msg;
    this.emitChange();
  }

  /** Clear the flash message. */
  clearFlashMessage(): void {
    this.state.flashMessage = "";
    this.emitChange();
  }

  // -- Model selector -------------------------------------------------------

  /** Open the model selector overlay. */
  startModelSelection(): void {
    this.state.isSelectingModel = true;
    this.emitChange();
  }

  /** Close the model selector overlay. */
  finishModelSelection(): void {
    this.state.isSelectingModel = false;
    this.emitChange();
  }

  /** Select a new model: update state, close overlay, and notify listeners. */
  selectModel(model: string): void {
    this.state.model = model;
    this.state.isSelectingModel = false;
    this.emitChange();
    this.emit("model-changed", model);
  }

  // -- Provider selector -----------------------------------------------------

  /** Set the current provider (e.g. on startup). */
  setProvider(provider: string): void {
    this.state.provider = provider;
    this.emitChange();
  }

  /** Open the provider selector overlay. */
  startProviderSelection(): void {
    this.state.isSelectingProvider = true;
    this.emitChange();
  }

  /** Close the provider selector overlay. */
  finishProviderSelection(): void {
    this.state.isSelectingProvider = false;
    this.emitChange();
  }

  /** Select a new provider: update state, close overlay, and notify listeners. */
  selectProvider(provider: string): void {
    this.state.provider = provider;
    this.state.isSelectingProvider = false;
    this.emitChange();
    this.emit("provider-changed", provider);
  }

  // -- Tech debt scan -------------------------------------------------------

  /** Mark that a tech debt scan is in progress. */
  startTechDebtScan(): void {
    this.state.isScanningTechDebt = true;
    this.emitChange();
  }

  /** Mark that the tech debt scan has finished. */
  finishTechDebtScan(): void {
    this.state.isScanningTechDebt = false;
    this.emitChange();
  }

  // -- Code Assist -----------------------------------------------------------

  /** Mark that a code assist run is in progress. */
  startCodeAssist(): void {
    this.state.codeAssistActive = true;
    this.state.codeAssistResult = null;
    this.emitChange();
  }

  /** Mark that a code assist run has finished. */
  finishCodeAssist(result: { action: string; path: string } | null): void {
    this.state.codeAssistActive = false;
    this.state.codeAssistResult = result;
    this.emitChange();
  }

  /** Clear the code assist result (e.g. when returning to dashboard). */
  clearCodeAssist(): void {
    this.state.codeAssistActive = false;
    this.state.codeAssistResult = null;
    this.emitChange();
  }

  // -- Welcome screen -------------------------------------------------------

  /** Set the welcome text (loaded from WELCOME.md on startup). */
  setWelcomeText(text: string): void {
    this.state.welcomeText = text;
    this.emitChange();
  }

  /** Set the KaiBot version string. */
  setKaibotVersion(version: string): void {
    this.state.kaibotVersion = version;
    this.emitChange();
  }

  /** Emit a quit request so the CLI entry point can perform graceful shutdown. */
  requestQuit(): void {
    this.emit("quit");
  }

  // -- Reset for next feature ---------------------------------------------

  resetFeature(): void {
    this.state.featureName = null;
    this.state.featureStage = null;
    this.state.featureStartTime = null;
    this.state.featureEndTime = null;
    this.state.thinkingLines = [];
    this.state.commands = [];
    this.state.fileOps = [];
    this.state.planLines = [];
    this.state.planCostInfo = "";
    // conversationItems intentionally NOT cleared here — they persist until
    // the next feature begins (via startConversation()).
    this.state.commitPrompt = { visible: false, message: "", countdown: 0 };
    this.state.hotkeyInputActive = false;
    this.state.hotkeyInputLines = [];
    this.state.featureReviewActive = false;
    this.state.flashMessage = "";
    this.state.isSelectingModel = false;
    this.state.isSelectingProvider = false;
    this.state.isScanningTechDebt = false;
    this.state.codeAssistActive = false;
    this.state.codeAssistResult = null;
    this.state.statusMessage = "";
    this.state.followupFeatureId = null;
    this.emitChange();
  }

  // -- Snapshots for log files --------------------------------------------

  /** Return a serializable snapshot of conversation history with ISO timestamps. */
  getConversationSnapshot(): ConversationLogEntry[] {
    return this.state.conversationItems.map((item) => ({
      type: item.type,
      content: item.content,
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
      ...(item.agentType ? { agentType: item.agentType } : {}),
      ...(item.agentDescription ? { agentDescription: item.agentDescription } : {}),
    }));
  }

  /** Return a serializable snapshot of file activity with ISO timestamps. */
  getFileActivitySnapshot(): FileActivityLogEntry[] {
    return this.state.fileOps.map((op) => ({
      type: op.type,
      path: op.path,
      preview: op.preview,
      timestamp: new Date(op.timestamp).toISOString(),
    }));
  }

  // -- Internal -----------------------------------------------------------

  private emitChange(): void {
    this.emit("change");
  }
}

/** Singleton UI store — import this everywhere. */
export const uiStore = new UIStore();
