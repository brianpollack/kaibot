import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { KaiClient } from "./KaiClient.js";
import { slugify } from "./slugify.js";

// ---------------------------------------------------------------------------
// Name derivation from description
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "in", "on", "with",
  "is", "it", "of", "by", "as", "at", "be", "if", "so", "no",
  "not", "but", "from", "that", "this", "then", "than", "into",
]);

/**
 * Derives a short feature name from the first line/sentence of a description.
 *
 * Takes the first ~5 meaningful words (filtering out stop words) from the
 * first line of the description text.
 */
export function deriveFeatureName(description: string): string {
  // Use the first line (or first sentence) of the description
  const firstLine = description.split("\n")[0].trim();

  const words = firstLine
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((w) => w.length > 0);

  const meaningful = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));

  // Take at most 5 meaningful words; fall back to all words if none are meaningful
  const selected = meaningful.length > 0 ? meaningful.slice(0, 5) : words.slice(0, 5);

  return selected.join(" ");
}

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
// Headless feature-file creation (for Ink UI hotkey flow)
// ---------------------------------------------------------------------------

/**
 * Writes a feature `.md` file from a raw description string, without any
 * readline interaction.  Reuses `deriveFeatureName` + `slugify` for naming.
 *
 * If a file with the derived slug already exists, a numeric suffix (`_2`, `_3`,
 * …) is appended to avoid collisions.
 *
 * @returns The relative path `features/{slug}.md` of the created file, or
 *          `null` if the description was empty.
 */
export function writeFeatureFromDescription(
  projectDir: string,
  description: string,
): string | null {
  const text = description.trim();
  if (!text) return null;

  const featuresDir = join(projectDir, "features");
  mkdirSync(featuresDir, { recursive: true });

  const name = deriveFeatureName(text);
  const slug = slugify(name);
  if (!slug) return null;

  // Deduplicate: if slug.md exists, try slug_2.md, slug_3.md, …
  let filePath = join(featuresDir, `${slug}.md`);
  let suffix = 1;
  while (existsSync(filePath)) {
    suffix++;
    filePath = join(featuresDir, `${slug}_${suffix}.md`);
  }

  writeFileSync(filePath, text + "\n");

  // Return a short display path
  const finalSlug = suffix > 1 ? `${slug}_${suffix}` : slug;
  return `features/${finalSlug}.md`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interactive feature creation flow:
 * 1. Slugify the feature name from CLI args (or derive from description)
 * 2. Prompt user for feature details (multi-line)
 * 3. Send to agent for review / clarification
 * 4. Write the final feature .md file
 *
 * @param projectDir - Absolute path to the target project
 * @param nameWords  - The feature name words from CLI args (may be empty to auto-derive)
 * @param model      - Claude model to use for agent review
 */
export async function createFeature(
  projectDir: string,
  nameWords: string[],
  model: string,
): Promise<string> {
  const hasName = nameWords.length > 0;

  const featuresDir = join(projectDir, "features");

  // Ensure features/ directory exists
  mkdirSync(featuresDir, { recursive: true });

  const rl = createRL();

  try {
    let featureName: string;
    let slug: string;
    let details: string;

    if (hasName) {
      // Name provided on CLI — existing flow
      featureName = nameWords.join(" ");
      slug = slugify(featureName);

      if (!slug) {
        console.error("Error: Feature name is empty after slugification.");
        process.exit(1);
      }

      const filePath = join(featuresDir, `${slug}.md`);
      if (existsSync(filePath)) {
        console.error(`Error: Feature file already exists: ${filePath}`);
        process.exit(1);
      }

      console.log(`\nCreating feature: "${featureName}"`);
      console.log(`File: features/${slug}.md\n`);
      console.log("Describe the feature details:");

      details = await readMultiLine(rl);

      if (!details.trim()) {
        console.error("Error: No feature details provided.");
        process.exit(1);
      }
    } else {
      // No name provided — collect description first, then derive name
      console.log("\nDescribe the feature details:");

      details = await readMultiLine(rl);

      if (!details.trim()) {
        console.error("Error: No feature details provided.");
        process.exit(1);
      }

      featureName = deriveFeatureName(details);
      slug = slugify(featureName);

      if (!slug) {
        console.error("Error: Could not derive a feature name from the description.");
        process.exit(1);
      }

      const filePath = join(featuresDir, `${slug}.md`);
      if (existsSync(filePath)) {
        console.error(`Error: Feature file already exists: ${filePath}`);
        process.exit(1);
      }

      console.log(`\nAuto-generated feature name: "${featureName}"`);
      console.log(`File: features/${slug}.md\n`);
    }

    const filePath = join(featuresDir, `${slug}.md`);

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
