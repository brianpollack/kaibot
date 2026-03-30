import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { createInterface } from "readline";
import { join, resolve } from "path";
import { spawn } from "child_process";

import { loadProjectEnv } from "./env.js";
import { KaiBot } from "./KaiBot.js";
import { createFeature } from "./feature_creator.js";
import { getOpenRouterModel, printModels, type ProviderName } from "./models.js";
import { loadSettings, saveSettings } from "./settings.js";
import { addToPathHistory } from "./pathHistory.js";
import { mountUI, unmountUI } from "./ui/render.js";
import { uiStore } from "./ui/store.js";
import { WebServer } from "./web/WebServer.js";
import { getKaiBotVersion, getKaiBotRoot } from "./version.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const subcommand = process.argv[2];

if (subcommand === "models") {
  loadProjectEnv(resolve("."));
  const providerArg = process.argv[3];
  if (providerArg === "openrouter" || providerArg === "anthropic") {
    await printModels(providerArg as ProviderName);
  } else {
    await printModels();
    if (process.env.OPENROUTER_API_KEY) {
      console.log("---\nOpenRouter is also available. Run: npm run models -- openrouter\n");
    }
  }
  process.exit(0);
}

if (subcommand === "testOpenrouter") {
  // Load .env from current directory
  const { loadProjectEnv: loadEnv } = await import("./env.js");
  loadEnv(resolve("."));

  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY environment variable is not set.");
    console.error("Set it in your project's .env file or export it in your shell.");
    process.exit(1);
  }

  const { KaiClient } = await import("./KaiClient.js");

  const openRouterModel = getOpenRouterModel();
  console.log(`OpenRouter API key detected. Using model: ${openRouterModel}\n`);
  console.log("Spawning agent and asking: \"Tell me about yourself\"\n");

  try {
    const client = KaiClient.create(resolve("."), openRouterModel, "openrouter");
    const result = await client.run("Tell me about yourself");
    console.log("Agent response:\n");
    console.log(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  process.exit(0);
}

if (subcommand === "feature") {
  const nameWords = process.argv.slice(3);
  const featureProjectDir = resolve(".");

  loadProjectEnv(featureProjectDir);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    console.error("Get your API key from: https://console.anthropic.com/");
    process.exit(1);
  }

  const featureModel = process.env.KAI_MODEL ?? "claude-opus-4-6";

  await createFeature(featureProjectDir, nameWords, featureModel);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const allArgs = process.argv.slice(2);
const useLinear = allArgs.includes("--linear");
const useInk = allArgs.includes("--ink");
const useDaemon = allArgs.includes("--daemon");
const projectDir = allArgs.find((arg) => !arg.startsWith("--"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 * Node's `path.resolve` does not handle tilde expansion.
 */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

const webPort = process.env.KAI_WEB_PORT ? parseInt(process.env.KAI_WEB_PORT, 10) : 8500;
const webHost = process.env.KAI_WEB_HOST ?? "127.0.0.1";

/**
 * Start the bot and wire up all events for a given project directory.
 * Called either immediately (when projectDir is provided) or after
 * project selection (when started in waiting mode).
 */
function startBotWithProject(
  resolvedDir: string,
  model: string,
  provider: ProviderName,
  webServer: WebServer,
  ink: boolean,
): KaiBot {
  const bot = new KaiBot(resolvedDir, model, useLinear, provider);

  if (ink) {
    mountUI();
  }

  // Load welcome screen content
  const kaibotVersion = getKaiBotVersion();
  uiStore.setKaibotVersion(kaibotVersion);
  try {
    const welcomePath = join(getKaiBotRoot(), "WELCOME.md");
    const welcomeText = readFileSync(welcomePath, "utf-8");
    uiStore.setWelcomeText(welcomeText);
  } catch {
    // WELCOME.md missing — leave blank
  }

  // Keep webServer model in sync with UI model changes; persist to settings file
  uiStore.on("model-changed", (newModel: string) => {
    webServer.model = newModel;
    saveSettings(resolvedDir, { ...loadSettings(resolvedDir), model: newModel });
  });

  // Keep provider in sync with UI provider changes; persist to settings file
  uiStore.on("provider-changed", (newProvider: string) => {
    saveSettings(resolvedDir, { ...loadSettings(resolvedDir), provider: newProvider });
  });

  const shutdown = () => {
    if (ink) unmountUI();
    bot.stop();
    webServer.stop().finally(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  uiStore.on("quit", shutdown);

  uiStore.setStatusMessage(`Web UI: ${webServer.url}  |  Watching for features…`);

  // Start bot (fire-and-forget — it awaits internally)
  bot.start().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Bot error: ${msg}`);
  });

  return bot;
}

// ---------------------------------------------------------------------------
// Daemon mode — fork and exit parent
// ---------------------------------------------------------------------------

if (useDaemon) {
  if (!projectDir) {
    console.error("Error: Daemon mode requires a project directory.");
    console.error("Usage: tsx src/kai_bot.ts <project-directory> --daemon");
    process.exit(1);
  }

  const childArgs = allArgs.filter((a) => a !== "--daemon");
  const child = spawn(process.execPath, [process.argv[1], ...childArgs], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.error(`KaiBot daemon started (PID ${child.pid}). Web UI: http://${webHost}:${webPort}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Project dir provided — start immediately
// ---------------------------------------------------------------------------

if (projectDir) {
  const resolvedDir = resolve(expandTilde(projectDir));

  if (!existsSync(resolvedDir)) {
    console.error(`Project directory does not exist: ${resolvedDir}`);
    process.exit(1);
  }

  loadProjectEnv(resolvedDir);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    console.error("Get your API key from: https://console.anthropic.com/");
    process.exit(1);
  }

  const savedSettings = loadSettings(resolvedDir);
  const provider: ProviderName = (savedSettings.provider as ProviderName) ?? "anthropic";
  const model =
    provider === "openrouter"
      ? getOpenRouterModel()
      : process.env.KAI_MODEL ?? savedSettings.model ?? "claude-opus-4-6";

  addToPathHistory(resolvedDir);

  const webServer = new WebServer({
    port: webPort,
    host: webHost,
    projectDir: resolvedDir,
    model,
  });

  await webServer.start();

  if (!useInk) {
    console.error(`KaiBot Web UI: ${webServer.url}`);
  }

  startBotWithProject(resolvedDir, model, provider, webServer, useInk);
}

// ---------------------------------------------------------------------------
// No project dir — Ink mode: prompt in terminal
// ---------------------------------------------------------------------------

else if (useInk) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const askPath = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question("Enter project directory path: ", (answer) => resolve(answer.trim()));
    });

  let resolvedDir = "";
  while (true) {
    const input = await askPath();
    if (!input) {
      console.error("Path is required.");
      continue;
    }
    resolvedDir = resolve(expandTilde(input));
    if (!existsSync(resolvedDir)) {
      console.error(`Directory does not exist: ${resolvedDir}`);
      continue;
    }
    loadProjectEnv(resolvedDir);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Error: ANTHROPIC_API_KEY not set. Add it to the project's .env or export it.");
      continue;
    }
    break;
  }
  rl.close();

  addToPathHistory(resolvedDir);

  const savedSettings = loadSettings(resolvedDir);
  const provider: ProviderName = (savedSettings.provider as ProviderName) ?? "anthropic";
  const model =
    provider === "openrouter"
      ? getOpenRouterModel()
      : process.env.KAI_MODEL ?? savedSettings.model ?? "claude-opus-4-6";

  const webServer = new WebServer({
    port: webPort,
    host: webHost,
    projectDir: resolvedDir,
    model,
  });

  await webServer.start();
  startBotWithProject(resolvedDir, model, provider, webServer, true);
}

// ---------------------------------------------------------------------------
// No project dir — WebUI mode (default): start server in waiting state
// ---------------------------------------------------------------------------

else {
  const defaultModel = process.env.KAI_MODEL ?? "claude-opus-4-6";

  const webServer = new WebServer({
    port: webPort,
    host: webHost,
    model: defaultModel,
  });

  await webServer.start();
  console.error(`KaiBot waiting for project selection at ${webServer.url}`);

  let currentBot: KaiBot | null = null;

  // When a project is selected via the web UI, start the bot
  webServer.on("project-activated", (resolvedDir: string) => {
    addToPathHistory(resolvedDir);

    const savedSettings = loadSettings(resolvedDir);
    const provider: ProviderName = (savedSettings.provider as ProviderName) ?? "anthropic";
    const model =
      provider === "openrouter"
        ? getOpenRouterModel()
        : process.env.KAI_MODEL ?? savedSettings.model ?? "claude-opus-4-6";

    webServer.model = model;

    currentBot = startBotWithProject(resolvedDir, model, provider, webServer, false);
  });

  // When a project is deselected via the web UI, stop the bot and reset state
  webServer.on("project-deactivated", () => {
    if (currentBot) {
      currentBot.stop();
      currentBot = null;
    }
    // Remove listeners added by startBotWithProject to prevent accumulation
    uiStore.removeAllListeners("model-changed");
    uiStore.removeAllListeners("provider-changed");
    uiStore.removeAllListeners("quit");

    uiStore.resetFeature();
    uiStore.setStatus("idle");
    uiStore.setProjectDir("");
    uiStore.startConversation();
  });

  // Graceful shutdown while waiting
  const shutdown = () => {
    if (currentBot) currentBot.stop();
    webServer.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
