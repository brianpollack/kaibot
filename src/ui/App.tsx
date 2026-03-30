import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";

import {
  type BotStatus,
  type CommitPromptState,
  type FeatureStage,
  type PlanLine,
  type UIState,
  uiStore,
} from "./store.js";
import { reviewAndWriteFeature } from "../feature_creator.js";
import { getAvailableProviders, getModelsForProvider, type ProviderName } from "../models.js";
import { loadCodeAssistOptions, runCodeAssist } from "../codeAssist.js";

// ---------------------------------------------------------------------------
// Hook: subscribe to UIStore changes
// ---------------------------------------------------------------------------

function useUIState(): UIState {
  const [state, setState] = useState<UIState>(uiStore.getState());

  useEffect(() => {
    const handler = () => setState({ ...uiStore.getState() });
    uiStore.on("change", handler);
    return () => {
      uiStore.off("change", handler);
    };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Helper: truncate a string to fit within a width
// ---------------------------------------------------------------------------

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

// ---------------------------------------------------------------------------
// Spinner — cycles through frames on an interval
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ color = "yellow" }: { color?: string }): React.JSX.Element {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
}

// ---------------------------------------------------------------------------
// Feature Stage Badge
// ---------------------------------------------------------------------------

const STAGE_CONFIG: Record<
  Exclude<FeatureStage, null>,
  { label: string; color: string; icon: string }
> = {
  reading: { label: "READING", color: "blue", icon: "📖" },
  thinking: { label: "THINKING", color: "magenta", icon: "💭" },
  planning: { label: "PLANNING", color: "cyan", icon: "📝" },
  executing: { label: "EXECUTING", color: "green", icon: "⚡" },
  complete: { label: "COMPLETE", color: "greenBright", icon: "✅" },
};

function StageBadge({ stage }: { stage: FeatureStage }): React.JSX.Element | null {
  if (!stage) return null;
  const cfg = STAGE_CONFIG[stage];
  return (
    <Box>
      <Text>{" " + cfg.icon + " "}</Text>
      <Text color={cfg.color} bold>
        {"[" + cfg.label + "]"}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  status,
  projectDir,
  model,
  featureName,
  featureStage,
  cols,
}: Pick<UIState, "status" | "projectDir" | "model" | "featureName" | "featureStage"> & {
  cols: number;
}): React.JSX.Element {
  const statusColor =
    status === "watching"
      ? "yellow"
      : status === "processing"
        ? "green"
        : status === "error"
          ? "red"
          : "gray";

  const statusLabel =
    status === "watching"
      ? "WATCHING"
      : status === "processing"
        ? "PROCESSING"
        : status === "error"
          ? "ERROR"
          : "IDLE";

  const dividerWidth = Math.max(cols, 40) - 4;

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box>
        <Text bold color="cyan">
          {"🤖 KaiBot "}
        </Text>
        {status === "watching" && <Spinner color="yellow" />}
        {status === "watching" && <Text> </Text>}
        <Text color={statusColor} bold>
          {"[" + statusLabel + "]"}
        </Text>
        {featureName && <Text color="white">{" → " + featureName}</Text>}
        <StageBadge stage={featureStage} />
      </Box>
      <Box flexDirection="row" alignItems="flex-end">
        <Text dimColor>{"  📁 " + truncate(projectDir, dividerWidth - 20)}</Text>
        <Text color="#202020">{" | "}</Text>
        <Text dimColor>{"  🧠 " + model}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Thinking Panel (6 scrolling lines)
// ---------------------------------------------------------------------------

function ThinkingPanel({
  lines,
  cols,
  rows,
}: {
  lines: string[];
  cols: number;
  rows: number;
}): React.JSX.Element {
  // Show more thinking lines on taller terminals
  const visibleLines = rows >= 40 ? 10 : rows >= 30 ? 8 : 6;
  const displayLines = lines.slice(-visibleLines);
  // Pad to target line count so the layout is stable
  const padded = [...displayLines];
  while (padded.length < visibleLines) padded.push("");
  const lineWidth = Math.max(cols - 4, 60);

  return (
    <Box flexDirection="column">
      <Text bold color="magenta">
        {"💭 Thinking"}
      </Text>
      {padded.map((line, i) => (
        <Text key={i} color="white" dimColor={line === ""}>
          {"  " + truncate(line || "·", lineWidth)}
        </Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Command Panel
// ---------------------------------------------------------------------------

function CommandPanel({
  commands,
  cols,
}: {
  commands: UIState["commands"];
  cols: number;
}): React.JSX.Element {
  // On wider terminals, show more of the command text
  const cmdWidth = Math.max(cols - 8, 60);

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        {"⚡ Commands"}
      </Text>
      {commands.length === 0 ? (
        <Text dimColor>{"  (no commands yet)"}</Text>
      ) : (
        commands.slice(-5).map((cmd, i) => (
          <Text key={i} color={cmd.active ? "green" : "gray"}>
            {"  " + (cmd.active ? "▶ " : "  ") + truncate(cmd.command, cmdWidth)}
          </Text>
        ))
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// File Operations Panel
// ---------------------------------------------------------------------------

function FileOpsPanel({
  fileOps,
  cols: _cols,
}: {
  fileOps: UIState["fileOps"];
  cols: number;
}): React.JSX.Element {
  const typeColor = (t: string): string =>
    t === "read" ? "blue" : t === "write" ? "green" : "yellow";

  const typeLabel = (t: string): string =>
    t === "read" ? "READ " : t === "write" ? "WRITE" : "EDIT ";

  // On wider terminals, show longer file paths and previews
  const pathWidth = 120;
  const previewWidth = 80;

  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        {"📄 File Operations"}
      </Text>
      {fileOps.length === 0 ? (
        <Text dimColor>{"  (no file ops yet)"}</Text>
      ) : (
        fileOps.slice(-4).map((op, i) => (
          <Box key={i}>
            <Text color={typeColor(op.type)} bold>
              {"  [" + typeLabel(op.type) + "] "}
            </Text>
            <Text color="white">{truncate(op.path, pathWidth)}</Text>
            {op.preview && <Text dimColor>{" " + truncate(op.preview, previewWidth)}</Text>}
          </Box>
        ))
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status Bar (bottom)
// ---------------------------------------------------------------------------

function StatusBar({
  statusMessage,
  cols,
}: {
  statusMessage: string;
  cols: number;
}): React.JSX.Element {
  const dividerWidth = Math.max(cols, 40);
  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      <Text color="cyan" bold>
        {statusMessage || " "}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Commit Prompt
// ---------------------------------------------------------------------------

function CommitPrompt({
  prompt,
  cols,
}: {
  prompt: CommitPromptState;
  cols: number;
}): React.JSX.Element | null {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef(prompt.countdown);

  // Start countdown timer when prompt becomes visible
  useEffect(() => {
    if (!prompt.visible) return;

    countdownRef.current = prompt.countdown;

    timerRef.current = setInterval(() => {
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        uiStore.resolveCommitPrompt(true); // auto-commit on timeout
      } else {
        uiStore.setCommitCountdown(countdownRef.current);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [prompt.visible]);

  const handleInput = useCallback(
    (input: string) => {
      if (!prompt.visible) return;
      if (timerRef.current) clearInterval(timerRef.current);

      if (input.toLowerCase() === "n") {
        uiStore.resolveCommitPrompt(false);
      } else {
        // "y", Enter, or any other key → commit
        uiStore.resolveCommitPrompt(true);
      }
    },
    [prompt.visible],
  );

  useInput(handleInput, { isActive: prompt.visible });

  if (!prompt.visible) return null;

  const dividerWidth = Math.max(cols, 40);

  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      <Text bold color="green">
        {"📦 Ready to commit"}
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color="white">{truncate(prompt.message, dividerWidth - 4)}</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold color="cyan">
          {"  Would you like to commit? "}
        </Text>
        <Text color="greenBright" bold>
          {"[Y]"}
        </Text>
        <Text color="white">{" / "}</Text>
        <Text color="red">{"n"}</Text>
        <Text dimColor>{`  (auto-commit in ${prompt.countdown}s)`}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Welcome Panel — shown when watching for features (idle state)
// ---------------------------------------------------------------------------

function WelcomePanel({
  welcomeText,
  kaibotVersion,
  projectDir,
  cols,
}: {
  welcomeText: string;
  kaibotVersion: string;
  projectDir: string;
  cols: number;
}): React.JSX.Element {
  const lineWidth = Math.max(cols - 6, 40);
  const lines = welcomeText.split("\n");

  return (
    <Box flexDirection="column" paddingX={1}>
      {lines.map((line, i) => {
        // Headings
        if (line.startsWith("# ")) {
          return (
            <Text key={i} bold color="cyan">
              {truncate(line.slice(2), lineWidth)}
            </Text>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <Text key={i} bold color="yellow">
              {"\n" + truncate(line.slice(3), lineWidth)}
            </Text>
          );
        }
        // Table header separator
        if (/^\|[\s-|]+\|$/.test(line)) {
          return <Text key={i} dimColor>{truncate(line, lineWidth)}</Text>;
        }
        // Table rows and numbered items
        if (line.startsWith("|") || /^\d+\./.test(line.trim())) {
          return (
            <Text key={i} color="white">
              {truncate(line, lineWidth)}
            </Text>
          );
        }
        // Blank lines
        if (line.trim() === "") {
          return <Text key={i}>{" "}</Text>;
        }
        // Regular text
        return (
          <Text key={i} color="white">
            {truncate(line, lineWidth)}
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text color="greenBright" bold>
          {`You are running KaiBot v${kaibotVersion} in ${projectDir}`}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Plan Panel (right side — 40% width)
// ---------------------------------------------------------------------------

function PlanPanel({
  planLines,
  planCostInfo,
  featureStage,
  cols,
}: {
  planLines: PlanLine[];
  planCostInfo: string;
  featureStage: FeatureStage;
  cols: number;
}): React.JSX.Element {
  const isComplete = featureStage === "complete";
  const lineWidth = Math.max(cols - 4, 60);

  return (
    <Box flexDirection="column" paddingLeft={1} borderColor="#404040" borderStyle="round">
      <Text bold color="cyan">
        {"📋 Plan"}
      </Text>
      <Text dimColor>{"─".repeat(Math.max(cols - 4, 20))}</Text>
      {planLines.length === 0 ? (
        <Text dimColor>{"  (no plan yet)"}</Text>
      ) : (
        planLines.map((line, i) => (
          <Box key={i}>
            <Text color={line.checked ? "green" : "white"}>
              {"  " + (line.checked ? "✅ " : "⬜ ") + "  "}
            </Text>
            <Text color={line.checked ? "green" : "white"} dimColor={line.checked}>
              {truncate(line.text, lineWidth)}
            </Text>
          </Box>
        ))
      )}
      {isComplete && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="greenBright">
            {"  🎉 Feature Complete"}
          </Text>
          {planCostInfo && (
            <Text dimColor color="green">
              {"  " + planCostInfo}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Hotkey Bar — visible only in "watching" state
// ---------------------------------------------------------------------------

function HotkeyBar({
  status,
  flashMessage,
  featureReviewActive,
  isScanningTechDebt,
  cols,
}: {
  status: BotStatus;
  flashMessage: string;
  featureReviewActive: boolean;
  isScanningTechDebt: boolean;
  cols: number;
}): React.JSX.Element | null {
  if (status !== "watching") return null;

  const dividerWidth = Math.max(cols, 40);

  const isSpinning = featureReviewActive || isScanningTechDebt;

  return (
    <Box flexDirection="column">
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      <Box>
        {isSpinning ? (
          <Box>
            <Spinner color="cyan" />
            <Text color="cyan" bold>
              {" " +
                (flashMessage ||
                  (isScanningTechDebt
                    ? "Scanning for tech debt…"
                    : "Reviewing feature with AI agent…"))}
            </Text>
          </Box>
        ) : flashMessage ? (
          <Text color="greenBright" bold>
            {flashMessage}
          </Text>
        ) : (
          <Box>
            <Text color="cyan" bold>
              {"[F]"}
            </Text>
            <Text dimColor>{" New Feature  "}</Text>
            <Text color="cyan" bold>
              {"[S]"}
            </Text>
            <Text dimColor>{" Code Assist  "}</Text>
            <Text color="cyan" bold>
              {"[M]"}
            </Text>
            <Text dimColor>{" Model  "}</Text>
            <Text color="cyan" bold>
              {"[P]"}
            </Text>
            <Text dimColor>{" Provider  "}</Text>
            <Text color="cyan" bold>
              {"[Q]"}
            </Text>
            <Text dimColor>{" Quit"}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Feature Input — multi-line text capture with 3-blank-line termination
// ---------------------------------------------------------------------------

function FeatureInput({ lines, cols }: { lines: string[]; cols: number }): React.JSX.Element {
  const [currentLine, setCurrentLine] = useState("");

  const blankCount = useRef(0);

  const handleInput = useCallback(
    (
      input: string,
      key: { return?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean },
    ) => {
      if (key.escape) {
        // Cancel input
        uiStore.finishHotkeyInput();
        uiStore.setFlashMessage("Cancelled");
        setTimeout(() => uiStore.clearFlashMessage(), 2000);
        return;
      }

      if (key.return) {
        const trimmed = currentLine.trim();
        uiStore.appendHotkeyInputLine(currentLine);

        if (trimmed === "") {
          blankCount.current += 1;
        } else {
          blankCount.current = 0;
        }

        setCurrentLine("");

        if (blankCount.current >= 3) {
          // Finalize input — trim trailing blank lines
          const allLines = [...lines, currentLine];
          while (allLines.length > 0 && allLines[allLines.length - 1].trim() === "") {
            allLines.pop();
          }
          const description = allLines.join("\n");

          uiStore.finishHotkeyInput();

          if (!description.trim()) {
            uiStore.setFlashMessage("Cancelled");
            setTimeout(() => uiStore.clearFlashMessage(), 2000);
            return;
          }

          const { projectDir, model } = uiStore.getState();

          // Run agent review asynchronously
          uiStore.setFeatureReviewActive(true);
          uiStore.setFlashMessage("Reviewing feature with AI agent…");

          reviewAndWriteFeature(projectDir, model, description)
            .then(({ path, reviewed }) => {
              uiStore.setFeatureReviewActive(false);
              if (path) {
                const note = reviewed ? "" : " (raw — agent review failed)";
                uiStore.setFlashMessage(`Feature created: ${path}${note}`);
              } else {
                uiStore.setFlashMessage("Cancelled — could not derive feature name");
              }
              setTimeout(() => uiStore.clearFlashMessage(), 4000);
            })
            .catch(() => {
              uiStore.setFeatureReviewActive(false);
              uiStore.setFlashMessage("Error creating feature");
              setTimeout(() => uiStore.clearFlashMessage(), 4000);
            });
        }
        return;
      }

      if (key.backspace || key.delete) {
        setCurrentLine((l) => l.slice(0, -1));
        return;
      }

      if (input) {
        setCurrentLine((l) => l + input);
      }
    },
    [currentLine, lines],
  );

  useInput(handleInput, { isActive: true });

  const dividerWidth = Math.max(cols, 40);
  const maxVisible = 10;
  const visibleLines = lines.slice(-maxVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        {"Enter feature description (3 blank lines to finish, Esc to cancel):"}
      </Text>
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      {visibleLines.map((line, i) => (
        <Text key={i} color="white">
          {"  " + (line || " ")}
        </Text>
      ))}
      <Box>
        <Text color="greenBright">{"> "}</Text>
        <Text color="white">{currentLine}</Text>
        <Text color="cyan">{"_"}</Text>
      </Box>
      <Box height={1} />
      <Text dimColor>
        {blankCount.current > 0
          ? `  (${blankCount.current}/3 blank lines entered)`
          : "  Type your feature description…"}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Model Selector — arrow/j/k navigation, Enter to confirm, Escape to cancel
// ---------------------------------------------------------------------------

function ModelSelector({
  currentModel,
  currentProvider,
  cols,
}: {
  currentModel: string;
  currentProvider: string;
  cols: number;
}): React.JSX.Element {
  const models = getModelsForProvider(currentProvider as ProviderName);
  const initialIndex = Math.max(
    models.findIndex((m) => m.id === currentModel),
    0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const handleInput = useCallback(
    (
      input: string,
      key: {
        upArrow?: boolean;
        downArrow?: boolean;
        return?: boolean;
        escape?: boolean;
      },
    ) => {
      if (key.escape) {
        uiStore.finishModelSelection();
        return;
      }

      if (key.return) {
        const chosen = models[selectedIndex];
        if (chosen.id !== currentModel) {
          uiStore.selectModel(chosen.id);
          uiStore.setFlashMessage(`Model changed to ${chosen.id}`);
          setTimeout(() => uiStore.clearFlashMessage(), 3000);
        } else {
          uiStore.finishModelSelection();
        }
        return;
      }

      if (key.upArrow || input.toLowerCase() === "k") {
        setSelectedIndex((i) => (i > 0 ? i - 1 : models.length - 1));
        return;
      }

      if (key.downArrow || input.toLowerCase() === "j") {
        setSelectedIndex((i) => (i < models.length - 1 ? i + 1 : 0));
        return;
      }
    },
    [selectedIndex, currentModel, models],
  );

  useInput(handleInput, { isActive: true });

  const dividerWidth = Math.max(cols, 40);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        {"🧠 Select Model (↑/↓ or J/K to navigate, Enter to confirm, Esc to cancel):"}
      </Text>
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      {models.map((model, i) => {
        const isSelected = i === selectedIndex;
        const isCurrent = model.id === currentModel;
        return (
          <Box key={model.id}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? "  ▸ " : "    "}
            </Text>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {model.id}
            </Text>
            <Text dimColor>{" — " + model.description}</Text>
            {isCurrent && (
              <Text color="green" bold>
                {" (active)"}
              </Text>
            )}
          </Box>
        );
      })}
      <Box height={1} />
      <Text dimColor>{"  Press Enter to select, Escape to cancel"}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Provider Selector — arrow/j/k navigation, Enter to confirm, Escape to cancel
// ---------------------------------------------------------------------------

function ProviderSelector({
  currentProvider,
  cols,
}: {
  currentProvider: string;
  cols: number;
}): React.JSX.Element {
  const providers = getAvailableProviders();
  const initialIndex = Math.max(
    providers.findIndex((p) => p.id === currentProvider),
    0,
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  const handleInput = useCallback(
    (
      input: string,
      key: {
        upArrow?: boolean;
        downArrow?: boolean;
        return?: boolean;
        escape?: boolean;
      },
    ) => {
      if (key.escape) {
        uiStore.finishProviderSelection();
        return;
      }

      if (key.return) {
        const chosen = providers[selectedIndex];
        if (chosen.id !== currentProvider) {
          uiStore.selectProvider(chosen.id);
          uiStore.setFlashMessage(`Provider changed to ${chosen.label}`);
          setTimeout(() => uiStore.clearFlashMessage(), 3000);
        } else {
          uiStore.finishProviderSelection();
        }
        return;
      }

      if (key.upArrow || input.toLowerCase() === "k") {
        setSelectedIndex((i) => (i > 0 ? i - 1 : providers.length - 1));
        return;
      }

      if (key.downArrow || input.toLowerCase() === "j") {
        setSelectedIndex((i) => (i < providers.length - 1 ? i + 1 : 0));
        return;
      }
    },
    [selectedIndex, currentProvider, providers],
  );

  useInput(handleInput, { isActive: true });

  const dividerWidth = Math.max(cols, 40);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        {"🔌 Select Provider (↑/↓ or J/K to navigate, Enter to confirm, Esc to cancel):"}
      </Text>
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
      {providers.map((provider, i) => {
        const isSelected = i === selectedIndex;
        const isCurrent = provider.id === currentProvider;
        return (
          <Box key={provider.id}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? "  ▸ " : "    "}
            </Text>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {provider.label}
            </Text>
            <Text dimColor>{" — " + provider.description}</Text>
            {isCurrent && (
              <Text color="green" bold>
                {" (active)"}
              </Text>
            )}
          </Box>
        );
      })}
      <Box height={1} />
      <Text dimColor>{"  Press Enter to select, Escape to cancel"}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export function App(): React.JSX.Element {
  const state = useUIState();
  const { stdout } = useStdout();

  // Track terminal resize
  const [cols, setCols] = useState((stdout.columns ?? 80) - 4);
  const [rows, setRows] = useState(stdout.rows ?? 24);

  useEffect(() => {
    const onResize = () => {
      setCols((stdout.columns ?? 80) - 4);
      setRows(stdout.rows ?? 24);
      uiStore.updateTerminalSize();
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Hotkey handler — only active when watching, not in input mode, and no
  // commit prompt is showing.
  const hotkeyActive =
    state.status === "watching" &&
    !state.hotkeyInputActive &&
    !state.isSelectingModel &&
    !state.isSelectingProvider &&
    !state.featureReviewActive &&
    !state.isScanningTechDebt &&
    !state.commitPrompt.visible;

  const handleHotkey = useCallback(
    (input: string, key: { shift?: boolean; ctrl?: boolean; meta?: boolean }) => {
      // Ignore if any modifier key is pressed
      if (key.ctrl || key.meta) return;

      if (input.toLowerCase() === "f") {
        uiStore.clearFlashMessage();
        uiStore.startHotkeyInput();
      }

      if (input.toLowerCase() === "q") {
        uiStore.requestQuit();
      }

      if (input.toLowerCase() === "m") {
        uiStore.clearFlashMessage();
        uiStore.startModelSelection();
      }

      if (input.toLowerCase() === "p") {
        const available = getAvailableProviders();
        if (available.length > 1) {
          uiStore.clearFlashMessage();
          uiStore.startProviderSelection();
        } else {
          uiStore.setFlashMessage("No alternate providers available (set OPENROUTER_API_KEY)");
          setTimeout(() => uiStore.clearFlashMessage(), 3000);
        }
      }

      if (input.toLowerCase() === "s") {
        const options = loadCodeAssistOptions();
        const firstOption = options[0];
        if (!firstOption) {
          uiStore.setFlashMessage("No code assist options found");
          setTimeout(() => uiStore.clearFlashMessage(), 3000);
          return;
        }

        uiStore.clearFlashMessage();
        uiStore.startTechDebtScan();
        uiStore.setFlashMessage(`Running: ${firstOption.name}…`);

        const { projectDir, model } = uiStore.getState();

        runCodeAssist(firstOption, projectDir, model)
          .then((result) => {
            uiStore.finishTechDebtScan();
            uiStore.setFlashMessage(`${firstOption.name} complete — ${result.costInfo}`);
            setTimeout(() => uiStore.clearFlashMessage(), 4000);
          })
          .catch(() => {
            uiStore.finishTechDebtScan();
            uiStore.setFlashMessage(`Error running ${firstOption.name}`);
            setTimeout(() => uiStore.clearFlashMessage(), 4000);
          });
      }
    },
    [],
  );

  useInput(handleHotkey, { isActive: hotkeyActive });

  // Split columns: left 60%, right 40%
  const leftCols = Math.floor(cols * 0.6);
  const rightCols = cols - leftCols;

  // When provider selector is active, show the provider selection overlay.
  if (state.isSelectingProvider) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header
          status={state.status}
          projectDir={state.projectDir}
          model={state.model}
          featureName={state.featureName}
          featureStage={state.featureStage}
          cols={cols}
        />
        <ProviderSelector currentProvider={state.provider} cols={cols} />
      </Box>
    );
  }

  // When model selector is active, show the model selection overlay.
  if (state.isSelectingModel) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header
          status={state.status}
          projectDir={state.projectDir}
          model={state.model}
          featureName={state.featureName}
          featureStage={state.featureStage}
          cols={cols}
        />
        <ModelSelector currentModel={state.model} currentProvider={state.provider} cols={cols} />
      </Box>
    );
  }

  // When hotkey input is active, show the feature input overlay instead of
  // the normal dashboard panels.
  if (state.hotkeyInputActive) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Header
          status={state.status}
          projectDir={state.projectDir}
          model={state.model}
          featureName={state.featureName}
          featureStage={state.featureStage}
          cols={cols}
        />
        <FeatureInput lines={state.hotkeyInputLines} cols={cols} />
      </Box>
    );
  }

  // Show welcome screen when watching and no feature is active
  const showWelcome = state.status === "watching" && !state.featureName && state.welcomeText;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        status={state.status}
        projectDir={state.projectDir}
        model={state.model}
        featureName={state.featureName}
        featureStage={state.featureStage}
        cols={cols}
      />
      {showWelcome ? (
        <Box flexDirection="column">
          <Box height={1} />
          <WelcomePanel
            welcomeText={state.welcomeText}
            kaibotVersion={state.kaibotVersion}
            projectDir={state.projectDir}
            cols={cols}
          />
        </Box>
      ) : (
        <Box>
          {/* Left side — activity panels (60%) */}
          <Box flexDirection="column" width={leftCols}>
            <Box height={1} />
            <ThinkingPanel lines={state.thinkingLines} cols={leftCols} rows={rows} />
            <Box height={1} />
            <CommandPanel commands={state.commands} cols={leftCols} />
            <Box height={1} />
            <FileOpsPanel fileOps={state.fileOps} cols={leftCols} />
            <Box height={1} />
            <CommitPrompt prompt={state.commitPrompt} cols={leftCols} />
          </Box>
          {/* Right side — plan panel (40%) */}
          <Box flexDirection="column" width={rightCols}>
            <Box height={1} />
            <PlanPanel
              planLines={state.planLines}
              planCostInfo={state.planCostInfo}
              featureStage={state.featureStage}
              cols={rightCols}
            />
          </Box>
        </Box>
      )}
      <HotkeyBar
        status={state.status}
        flashMessage={state.flashMessage}
        featureReviewActive={state.featureReviewActive}
        isScanningTechDebt={state.isScanningTechDebt}
        cols={cols}
      />
      <StatusBar statusMessage={state.statusMessage} cols={cols} />
    </Box>
  );
}
