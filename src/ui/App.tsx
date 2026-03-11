import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";

import {
  type CommitPromptState,
  type FeatureStage,
  type PlanLine,
  type UIState,
  uiStore,
} from "./store.js";

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
    <Box flexDirection="column">
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
      <Box>
        <Text dimColor>{"  📁 " + truncate(projectDir, dividerWidth - 20)}</Text>
        <Text dimColor>{"  🧠 " + model}</Text>
      </Box>
      <Text dimColor>{"─".repeat(dividerWidth)}</Text>
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
  const lineWidth = Math.max(cols - 4, 40);

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
  const cmdWidth = Math.max(cols - 8, 40);

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">
        {"⚡ Commands"}
      </Text>
      {commands.length === 0 ? (
        <Text dimColor>{"  (no commands yet)"}</Text>
      ) : (
        commands.map((cmd, i) => (
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
  cols,
}: {
  fileOps: UIState["fileOps"];
  cols: number;
}): React.JSX.Element {
  const typeColor = (t: string): string =>
    t === "read" ? "blue" : t === "write" ? "green" : "yellow";

  const typeLabel = (t: string): string =>
    t === "read" ? "READ " : t === "write" ? "WRITE" : "EDIT ";

  // On wider terminals, show longer file paths and previews
  const pathWidth = cols >= 120 ? 70 : cols >= 100 ? 60 : 50;
  const previewWidth = cols >= 120 ? 40 : cols >= 100 ? 30 : 20;

  return (
    <Box flexDirection="column">
      <Text bold color="blue">
        {"📄 File Operations"}
      </Text>
      {fileOps.length === 0 ? (
        <Text dimColor>{"  (no file ops yet)"}</Text>
      ) : (
        fileOps.map((op, i) => (
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
  const lineWidth = Math.max(cols - 4, 20);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold color="cyan">
        {"📋 Plan"}
      </Text>
      <Text dimColor>{"─".repeat(Math.max(cols - 2, 20))}</Text>
      {planLines.length === 0 ? (
        <Text dimColor>{"  (no plan yet)"}</Text>
      ) : (
        planLines.map((line, i) => (
          <Box key={i}>
            <Text color={line.checked ? "green" : "white"}>
              {"  " + (line.checked ? "✅" : "⬜") + " "}
            </Text>
            <Text
              color={line.checked ? "green" : "white"}
              dimColor={line.checked}
            >
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
// Main App
// ---------------------------------------------------------------------------

export function App(): React.JSX.Element {
  const state = useUIState();
  const { stdout } = useStdout();

  // Track terminal resize
  const [cols, setCols] = useState(stdout.columns ?? 80);
  const [rows, setRows] = useState(stdout.rows ?? 24);

  useEffect(() => {
    const onResize = () => {
      setCols(stdout.columns ?? 80);
      setRows(stdout.rows ?? 24);
      uiStore.updateTerminalSize();
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  // Split columns: left 60%, right 40%
  const leftCols = Math.floor(cols * 0.6);
  const rightCols = cols - leftCols;

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
      <StatusBar statusMessage={state.statusMessage} cols={cols} />
    </Box>
  );
}
