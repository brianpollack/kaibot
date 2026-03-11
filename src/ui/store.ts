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

export interface UIState {
  // Header
  status: BotStatus;
  projectDir: string;
  model: string;
  featureName: string | null;
  featureStage: FeatureStage;

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

  // Commit prompt
  commitPrompt: CommitPromptState;

  // Hotkey input mode (inline feature creation)
  hotkeyInputActive: boolean;
  hotkeyInputLines: string[];
  /** Whether the agent is currently reviewing a feature description from the hotkey input. */
  featureReviewActive: boolean;
  /** Temporary flash message shown after hotkey actions (e.g. "Feature created: …"). */
  flashMessage: string;

  // Status message (bottom bar)
  statusMessage: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_THINKING_LINES = 6;
const MAX_COMMANDS = 5;
const MAX_FILE_OPS = 4;

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
    terminalColumns: process.stdout.columns ?? 80,
    terminalRows: process.stdout.rows ?? 24,
    thinkingLines: [],
    commands: [],
    fileOps: [],
    planLines: [],
    planCostInfo: "",
    commitPrompt: { visible: false, message: "", countdown: 0 },
    hotkeyInputActive: false,
    hotkeyInputLines: [],
    featureReviewActive: false,
    flashMessage: "",
    statusMessage: "",
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

  updateTerminalSize(): void {
    this.state.terminalColumns = process.stdout.columns ?? 80;
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

  pushFileOp(op: FileOp): void {
    this.state.fileOps = [...this.state.fileOps, op].slice(-MAX_FILE_OPS);
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

  // -- Commit prompt -------------------------------------------------------

  private commitResolve: ((commit: boolean) => void) | null = null;

  /**
   * Show the commit prompt and return a promise that resolves to true (commit)
   * or false (skip). Auto-commits after 5 seconds if no input is received.
   */
  showCommitPrompt(message: string): Promise<boolean> {
    this.state.commitPrompt = { visible: true, message, countdown: 5 };
    this.emitChange();

    return new Promise<boolean>((resolve) => {
      this.commitResolve = resolve;
    });
  }

  /** Called by the UI when the user answers or the countdown expires. */
  resolveCommitPrompt(commit: boolean): void {
    this.state.commitPrompt = { visible: false, message: "", countdown: 0 };
    this.emitChange();
    if (this.commitResolve) {
      this.commitResolve(commit);
      this.commitResolve = null;
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

  /** Emit a quit request so the CLI entry point can perform graceful shutdown. */
  requestQuit(): void {
    this.emit("quit");
  }

  // -- Reset for next feature ---------------------------------------------

  resetFeature(): void {
    this.state.featureName = null;
    this.state.featureStage = null;
    this.state.thinkingLines = [];
    this.state.commands = [];
    this.state.fileOps = [];
    this.state.planLines = [];
    this.state.planCostInfo = "";
    this.state.commitPrompt = { visible: false, message: "", countdown: 0 };
    this.state.hotkeyInputActive = false;
    this.state.hotkeyInputLines = [];
    this.state.featureReviewActive = false;
    this.state.flashMessage = "";
    this.state.statusMessage = "";
    this.emitChange();
  }

  // -- Internal -----------------------------------------------------------

  private emitChange(): void {
    this.emit("change");
  }
}

/** Singleton UI store — import this everywhere. */
export const uiStore = new UIStore();
