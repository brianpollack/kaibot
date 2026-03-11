import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { KaiClient } from "./KaiClient.js";
import { slugify } from "./slugify.js";

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

function createRL(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

/**
 * Reads multi-line input from stdin until the user enters a blank line.
 * Returns the collected lines joined by newlines.
 */
async function readMultiLine(rl: ReturnType<typeof createInterface>): Promise<string> {
  const lines: string[] = [];
  console.log("(Enter a blank line when done)\n");

  while (true) {
    const line = await ask(rl, "");
    if (line.trim() === "") break;
    lines.push(line);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Agent review prompt
// ---------------------------------------------------------------------------

function buildReviewPrompt(featureName: string, details: string): string {
  return `You are helping a developer write a feature specification.

The developer wants to create a feature called "${featureName}" with the following details:

---
${details}
---

Review the details above and determine if they are clear enough to implement.

If the details are clear and complete enough, respond with EXACTLY this format:

READY
<the full, well-structured feature specification to be written to a markdown file>

If clarification is needed, respond with EXACTLY this format:

CLARIFY
<your questions, one per line>

Important:
- When writing the specification (READY), include clear instructions, acceptance criteria, and any technical notes that would help an implementing agent.
- Do NOT include markdown headings like ## Plan or ## Summary — those are added later by the implementing agent.
- Keep your response concise and actionable.`;
}

function buildFollowUpPrompt(
  featureName: string,
  originalDetails: string,
  questions: string,
  answers: string,
): string {
  return `You are helping a developer write a feature specification.

Feature: "${featureName}"

Original details:
---
${originalDetails}
---

You asked for clarification:
---
${questions}
---

The developer answered:
---
${answers}
---

Now write the final feature specification. Respond with EXACTLY this format:

READY
<the full, well-structured feature specification>

Include clear instructions, acceptance criteria, and any technical notes.
Do NOT include markdown headings like ## Plan or ## Summary.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ReviewReady {
  type: "ready";
  content: string;
}

interface ReviewClarify {
  type: "clarify";
  questions: string;
}

type ReviewResponse = ReviewReady | ReviewClarify;

export function parseReviewResponse(response: string): ReviewResponse {
  const trimmed = response.trim();

  if (trimmed.startsWith("READY")) {
    return {
      type: "ready",
      content: trimmed.slice("READY".length).trim(),
    };
  }

  if (trimmed.startsWith("CLARIFY")) {
    return {
      type: "clarify",
      questions: trimmed.slice("CLARIFY".length).trim(),
    };
  }

  // Default: treat the whole response as ready content
  return { type: "ready", content: trimmed };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interactive feature creation flow:
 * 1. Slugify the feature name from CLI args
 * 2. Prompt user for feature details (multi-line)
 * 3. Send to agent for review / clarification
 * 4. Write the final feature .md file
 *
 * @param projectDir - Absolute path to the target project
 * @param nameWords  - The feature name words from CLI args (e.g. ["This", "is", "a", "feature"])
 * @param model      - Claude model to use for agent review
 */
export async function createFeature(
  projectDir: string,
  nameWords: string[],
  model: string,
): Promise<string> {
  const featureName = nameWords.join(" ");
  const slug = slugify(featureName);

  if (!slug) {
    console.error("Error: Feature name is empty after slugification.");
    process.exit(1);
  }

  const featuresDir = join(projectDir, "features");
  const filePath = join(featuresDir, `${slug}.md`);

  if (existsSync(filePath)) {
    console.error(`Error: Feature file already exists: ${filePath}`);
    process.exit(1);
  }

  // Ensure features/ directory exists
  mkdirSync(featuresDir, { recursive: true });

  const rl = createRL();

  try {
    console.log(`\nCreating feature: "${featureName}"`);
    console.log(`File: features/${slug}.md\n`);
    console.log("Describe the feature details:");

    const details = await readMultiLine(rl);

    if (!details.trim()) {
      console.error("Error: No feature details provided.");
      process.exit(1);
    }

    console.log("\nReviewing feature details with AI agent...\n");

    const client = KaiClient.create(projectDir, model);
    let prompt = buildReviewPrompt(featureName, details);
    let response = await client.run(prompt);
    let review = parseReviewResponse(response);

    // Clarification loop (max 3 rounds)
    let round = 0;
    while (review.type === "clarify" && round < 3) {
      round++;
      console.log("The agent has some questions:\n");
      console.log(review.questions);
      console.log("\nPlease provide answers:");

      const answers = await readMultiLine(rl);

      if (!answers.trim()) {
        console.log("No answers provided, proceeding with current details.\n");
        // Build a follow-up that just writes the spec with what we have
        prompt = buildFollowUpPrompt(featureName, details, review.questions, "(no additional details)");
      } else {
        prompt = buildFollowUpPrompt(featureName, details, review.questions, answers);
      }

      console.log("\nRefining feature specification...\n");
      response = await client.run(prompt);
      review = parseReviewResponse(response);
    }

    if (review.type !== "ready") {
      // After max rounds, use whatever we have
      console.log("Max clarification rounds reached. Writing feature with current details.\n");
      review = { type: "ready", content: details };
    }

    // Write the feature file
    writeFileSync(filePath, review.content + "\n");

    console.log(`\nFeature written to: ${filePath}`);
    console.log("Drop this file into features/ and run the bot to implement it.\n");

    return filePath;
  } finally {
    rl.close();
  }
}
