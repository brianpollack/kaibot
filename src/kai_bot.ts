import { existsSync } from "fs";
import { resolve } from "path";

import { loadProjectEnv } from "./env.js";
import { KaiBot } from "./KaiBot.js";
import { createFeature } from "./feature_creator.js";
import { printModels, type ProviderName } from "./models.js";
import { loadSettings, saveSettings } from "./settings.js";
import { mountUI, unmountUI } from "./ui/render.js";
import { uiStore } from "./ui/store.js";
import { WebServer } from "./web/WebServer.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const subcommand = process.argv[2];

if (subcommand === "models") {
  await printModels();
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

  console.log("OpenRouter API key detected. Fetching available models…\n");
  await printModels("openrouter");
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
// Args
// ---------------------------------------------------------------------------

const useLinear = process.argv.includes("--linear");
const projectDir = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

if (!projectDir) {
  console.error("Usage: tsx src/kai_bot.ts <project-directory> [--linear]");
  console.error("       tsx src/kai_bot.ts feature <feature name words...>");
  console.error("       tsx src/kai_bot.ts models");
  console.error("  Example: tsx src/kai_bot.ts /path/to/my-project");
  console.error("  Example: tsx src/kai_bot.ts /path/to/my-project --linear");
  console.error("  Example: tsx src/kai_bot.ts feature Add user authentication");
  console.error("\nSubcommands:");
  console.error("  models    List available Claude models");
  console.error("  feature   Create a new feature file interactively");
  console.error("\nFlags:");
  console.error("  --linear  Enable Linear mode (requires LINEAR_API_KEY and LINEAR_TEAM_KEY)");
  console.error("\nEnvironment variables:");
  console.error("  ANTHROPIC_API_KEY  (required)");
  console.error("  KAI_MODEL          (optional, default: claude-opus-4-6)");
  console.error("  LINEAR_API_KEY     (required for --linear mode)");
  console.error("  LINEAR_TEAM_KEY    (required for --linear mode)");
  process.exit(1);
}

const resolvedDir = resolve(projectDir);

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
const model = process.env.KAI_MODEL ?? savedSettings.model ?? "claude-opus-4-6";
const provider: ProviderName = (savedSettings.provider as ProviderName) ?? "anthropic";

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const bot = new KaiBot(resolvedDir, model, useLinear, provider);

// Mount the Ink UI
mountUI();

// Start the web UI server
const webPort = process.env.KAI_WEB_PORT ? parseInt(process.env.KAI_WEB_PORT, 10) : 8500;
const webHost = process.env.KAI_WEB_HOST ?? "127.0.0.1";
const webServer = new WebServer({
  port: webPort,
  host: webHost,
  projectDir: resolvedDir,
  model,
});

webServer.start().then(() => {
  uiStore.setStatusMessage(`Web UI: ${webServer.url}  |  Watching for features…`);
}).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  uiStore.setStatusMessage(`Web UI failed to start: ${msg}`);
});

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
  unmountUI();
  bot.stop();
  webServer.stop().finally(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

uiStore.on("quit", shutdown);

await bot.start();
