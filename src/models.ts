// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openrouter";

export interface ProviderInfo {
  id: ProviderName;
  label: string;
  description: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic",   label: "Anthropic",   description: "Direct Anthropic API" },
  { id: "openrouter",  label: "OpenRouter",  description: "OpenRouter multi-model gateway" },
];

export const DEFAULT_PROVIDER: ProviderName = "anthropic";

/**
 * Returns true if the OPENROUTER_API_KEY environment variable is set,
 * meaning OpenRouter is available as a provider option.
 */
export function isOpenRouterAvailable(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Returns only the providers that are currently available (i.e. have required API keys set).
 */
export function getAvailableProviders(): ProviderInfo[] {
  return PROVIDERS.filter((p) => {
    if (p.id === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
    if (p.id === "openrouter") return isOpenRouterAvailable();
    return false;
  });
}

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

/**
 * OpenRouter models available when using the OpenRouter provider.
 * These are the Claude models available through OpenRouter.
 */
export const OPENROUTER_MODELS: ModelInfo[] = [
  { id: "anthropic/claude-opus-4",   description: "Claude Opus 4 via OpenRouter" },
  { id: "anthropic/claude-sonnet-4", description: "Claude Sonnet 4 via OpenRouter" },
  { id: "anthropic/claude-haiku-4",  description: "Claude Haiku 4 via OpenRouter" },
];

/** The model used when KAI_MODEL is not set. */
export const DEFAULT_MODEL = "claude-opus-4-6";

/** The model used when OPENROUTER_MODEL is not set and provider is openrouter. */
export const DEFAULT_OPENROUTER_MODEL = "z-ai/glm-5-turbo";

/**
 * Returns the model to use for OpenRouter: OPENROUTER_MODEL env var, or the default.
 */
export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

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
  // Strip provider prefix (e.g. "anthropic/claude-opus-4" → "claude-opus-4")
  const bareId = modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId;

  // Try longest prefix first for specificity
  const prefixes = Object.keys(MODEL_PRICING).sort(
    (a, b) => b.length - a.length,
  );
  for (const prefix of prefixes) {
    if (bareId.startsWith(prefix)) {
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
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

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

/** Shape returned by the OpenRouter /api/v1/models endpoint. */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
}

interface OpenRouterModelListResponse {
  data: OpenRouterModel[];
}

/**
 * Fetches available models from the OpenRouter API.
 * Filters to only Claude/Anthropic models for relevance.
 */
export async function fetchOpenRouterModels(apiKey: string): Promise<ApiModel[]> {
  const response = await fetch(OPENROUTER_MODELS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${body}`);
  }

  const json = (await response.json()) as OpenRouterModelListResponse;

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error("Unexpected OpenRouter API response: missing data array");
  }

  // Filter to anthropic/claude models only for relevance
  const filtered = json.data
    .filter((m) => m.id.startsWith("anthropic/claude"))
    .map((m) => ({
      type: "model",
      id: m.id,
      display_name: m.name || m.id,
      created_at: "",
    }));

  if (filtered.length === 0) {
    throw new Error("No Claude models found in OpenRouter response");
  }

  return filtered;
}

/**
 * Returns the models list appropriate for the given provider.
 * Fetches live data when possible; falls back to static lists.
 */
export function getModelsForProvider(provider: ProviderName): ModelInfo[] {
  return provider === "openrouter" ? OPENROUTER_MODELS : MODELS;
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
export async function printModels(provider: ProviderName = "anthropic"): Promise<void> {
  const current = process.env.KAI_MODEL ?? DEFAULT_MODEL;

  let models: Array<{ id: string; displayName: string }>;
  let isLive = false;

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      try {
        const apiModels = await fetchOpenRouterModels(apiKey);
        models = apiModels
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((m) => ({ id: m.id, displayName: m.display_name }));
        isLive = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Warning: Failed to fetch models from OpenRouter API: ${msg}`);
        console.error("Falling back to static model list.\n");
        models = OPENROUTER_MODELS.map((m) => ({
          id: m.id,
          displayName: m.description,
        }));
      }
    } else {
      models = OPENROUTER_MODELS.map((m) => ({
        id: m.id,
        displayName: m.description,
      }));
    }
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const apiModels = await fetchModels(apiKey);
        models = apiModels
          .sort((a, b) => a.display_name.localeCompare(b.display_name))
          .map((m) => ({ id: m.id, displayName: m.display_name }));
        isLive = true;
      } catch {
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
  }

  const providerLabel = provider === "openrouter" ? "OpenRouter" : "Claude";
  console.log(
    isLive
      ? `Available ${providerLabel} models (live from API):\n`
      : `Available ${providerLabel} models:\n`,
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
