import { existsSync } from "fs";
import { resolve } from "path";

import { loadProjectEnv } from "./env.js";
import { KaiBot } from "./KaiBot.js";
import { createFeature } from "./feature_creator.js";
import { printModels } from "./models.js";
import { mountUI, unmountUI } from "./ui/render.js";
import { uiStore } from "./ui/store.js";

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

const subcommand = process.argv[2];

if (subcommand === "models") {
  await printModels();
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

const projectDir = subcommand;

if (!projectDir) {
  console.error("Usage: tsx src/kai_bot.ts <project-directory>");
  console.error("       tsx src/kai_bot.ts feature <feature name words...>");
  console.error("       tsx src/kai_bot.ts models");
  console.error("  Example: tsx src/kai_bot.ts /path/to/my-project");
  console.error("  Example: tsx src/kai_bot.ts feature Add user authentication");
  console.error("\nSubcommands:");
  console.error("  models    List available Claude models");
  console.error("  feature   Create a new feature file interactively");
  console.error("\nEnvironment variables:");
  console.error("  ANTHROPIC_API_KEY  (required)");
  console.error("  KAI_MODEL          (optional, default: claude-opus-4-6)");
  console.error("  LINEAR_API_KEY     (optional, enables Linear mode)");
  console.error("  LINEAR_TEAM_KEY    (optional, team key/name for Linear mode)");
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

const model = process.env.KAI_MODEL ?? "claude-opus-4-6";

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const bot = new KaiBot(resolvedDir, model);

// Mount the Ink UI
mountUI();

process.on("SIGINT", () => {
  unmountUI();
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  unmountUI();
  bot.stop();
  process.exit(0);
});

uiStore.on("quit", () => {
  unmountUI();
  bot.stop();
  process.exit(0);
});

await bot.start();
