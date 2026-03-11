// ---------------------------------------------------------------------------
// Supported Claude models
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  description: string;
}

/**
 * Claude models available for use with KaiBot (static fallback list).
 * Ordered from most capable to fastest/cheapest.
 */
export const MODELS: ModelInfo[] = [
  { id: "claude-opus-4-6",       description: "Most capable — deep analysis & complex coding" },
  { id: "claude-sonnet-4-6",     description: "Balanced — strong coding at lower cost" },
  { id: "claude-haiku-4-5",      description: "Fastest — quick tasks & lightweight agents" },
];

/** The model used when KAI_MODEL is not set. */
export const DEFAULT_MODEL = "claude-opus-4-6";

// ---------------------------------------------------------------------------
// Pricing (per million tokens)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  input: number;
  output: number;
}

/**
 * Known pricing per million tokens, keyed by model-ID prefix.
 * Prices sourced from Anthropic's public pricing page.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4":   { input: 15.0,  output: 75.0 },
  "claude-sonnet-4": { input: 3.0,   output: 15.0 },
  "claude-haiku-4":  { input: 0.8,   output: 4.0 },
  "claude-3-haiku":  { input: 0.25,  output: 1.25 },
};

/**
 * Look up pricing for a model ID by matching against known prefixes.
 * Returns undefined if no matching pricing is found.
 */
export function getPricing(modelId: string): ModelPricing | undefined {
  // Try longest prefix first for specificity
  const prefixes = Object.keys(MODEL_PRICING).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefix of prefixes) {
    if (modelId.startsWith(prefix)) {
      return MODEL_PRICING[prefix];
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

/** Shape returned by GET /v1/models for a single model. */
export interface ApiModel {
  type: string;
  id: string;
  display_name: string;
  created_at: string;
}

/** Shape of the list response from the Anthropic models endpoint. */
interface ApiModelListResponse {
  data: ApiModel[];
}

// ---------------------------------------------------------------------------
// Live model fetching
// ---------------------------------------------------------------------------

const MODELS_ENDPOINT = "https://api.anthropic.com/v1/models";

/**
 * Fetches the list of available models from the Anthropic API.
 * Requires ANTHROPIC_API_KEY to be set. Throws on network/auth errors.
 */
export async function fetchModels(apiKey: string): Promise<ApiModel[]> {
  const response = await fetch(MODELS_ENDPOINT, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Anthropic API error (${response.status}): ${body}`,
    );
  }

  const json = (await response.json()) as ApiModelListResponse;
  return json.data;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number): string {
  return `$${price.toFixed(price < 1 ? 3 : 2)}`;
}

function formatPricing(pricing: ModelPricing): string {
  return `${formatPrice(pricing.input)} / ${formatPrice(pricing.output)}`;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Prints the list of available models to stdout. Fetches live model data from
 * the Anthropic API when an API key is available; falls back to the static
 * MODELS list otherwise. Includes per-million-token pricing when known.
 */
export async function printModels(): Promise<void> {
  const current = process.env.KAI_MODEL ?? DEFAULT_MODEL;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let models: Array<{ id: string; displayName: string }>;
  let isLive = false;

  if (apiKey) {
    try {
      const apiModels = await fetchModels(apiKey);
      models = apiModels
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((m) => ({ id: m.id, displayName: m.display_name }));
      isLive = true;
    } catch {
      // Fall back to static list on API error
      models = MODELS.map((m) => ({
        id: m.id,
        displayName: m.description,
      }));
    }
  } else {
    models = MODELS.map((m) => ({
      id: m.id,
      displayName: m.description,
    }));
  }

  console.log(
    isLive
      ? "Available Claude models (live from API):\n"
      : "Available Claude models:\n",
  );

  // Calculate column widths for alignment
  const maxId = Math.max(...models.map((m) => m.id.length));
  const pricingEntries = models.map((m) => getPricing(m.id));
  const hasPricing = pricingEntries.some((p) => p !== undefined);

  // Header
  if (hasPricing) {
    const idHeader = "Model".padEnd(maxId);
    const priceHeader = "Input / Output per 1M tokens";
    console.log(`  ${idHeader}  ${priceHeader}`);
    console.log(`  ${"─".repeat(maxId)}  ${"─".repeat(priceHeader.length)}`);
  }

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const pricing = pricingEntries[i];
    const marker = model.id === current ? " (active)" : "";
    const padded = model.id.padEnd(maxId);

    if (hasPricing) {
      const priceStr = pricing ? formatPricing(pricing) : "";
      console.log(`  ${padded}  ${priceStr}${marker}`);
    } else {
      console.log(`  ${padded}  ${model.displayName}${marker}`);
    }
  }

  console.log("\nSet a model:");
  console.log(`  export KAI_MODEL=<model-id>\n`);
  console.log("Or pass it inline:");
  console.log(`  KAI_MODEL=<model-id> npm run bot -- /path/to/project\n`);
  console.log("Copy-paste commands:");
  for (const model of models) {
    console.log(`  export KAI_MODEL=${model.id}`);
  }
  console.log();
}
