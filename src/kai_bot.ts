import { existsSync } from "fs";
import { resolve } from "path";

import { KaiBot } from "./KaiBot.js";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const projectDir = process.argv[2];

if (!projectDir) {
  console.error("Usage: tsx src/kai_bot.ts <project-directory>");
  console.error("  Example: tsx src/kai_bot.ts /path/to/my-project");
  console.error("\nEnvironment variables:");
  console.error("  ANTHROPIC_API_KEY  (required)");
  console.error("  KAI_MODEL          (optional, default: claude-opus-4-6)");
  process.exit(1);
}

const resolvedDir = resolve(projectDir);

if (!existsSync(resolvedDir)) {
  console.error(`Project directory does not exist: ${resolvedDir}`);
  process.exit(1);
}

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

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bot.stop();
  process.exit(0);
});

await bot.start();
