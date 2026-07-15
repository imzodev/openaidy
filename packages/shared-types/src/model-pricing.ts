/**
 * Model pricing and cost estimation.
 *
 * Static reference pricing for common models plus a pure cost calculation.
 * Prices are USD per 1,000 tokens. This is a best-effort reference — users
 * can override or extend it via `modelPricing` in their app config (custom
 * providers, corrected/updated rates). Cost is always an estimate; when a
 * model has no known pricing, cost is `null` rather than a wrong number.
 */

export type ModelPricing = {
  /** USD per 1k prompt (input) tokens, excluding cache reads */
  promptPer1k: number;
  /** USD per 1k completion (output) tokens */
  completionPer1k: number;
  /** USD per 1k cache-read tokens (usually a discount; defaults to prompt rate) */
  cacheReadPer1k?: number;
  /** USD per 1k cache-creation tokens (Anthropic; usually a premium) */
  cacheCreationPer1k?: number;
};

/** Token usage shape needed for cost calculation. */
export type CostUsage = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

/**
 * Reference pricing keyed by model id. Keys are matched case-insensitively
 * and by longest known prefix (see {@link resolveModelPricing}), so dated
 * snapshots like `gpt-4o-2024-08-06` resolve to the `gpt-4o` entry.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': {
    promptPer1k: 0.0025,
    completionPer1k: 0.01,
    cacheReadPer1k: 0.00125,
  },
  'gpt-4o-mini': {
    promptPer1k: 0.00015,
    completionPer1k: 0.0006,
    cacheReadPer1k: 0.000075,
  },
  'gpt-4.1': {
    promptPer1k: 0.002,
    completionPer1k: 0.008,
    cacheReadPer1k: 0.0005,
  },
  'gpt-4.1-mini': {
    promptPer1k: 0.0004,
    completionPer1k: 0.0016,
    cacheReadPer1k: 0.0001,
  },
  'gpt-4.1-nano': {
    promptPer1k: 0.0001,
    completionPer1k: 0.0004,
    cacheReadPer1k: 0.000025,
  },
  'o3-mini': {
    promptPer1k: 0.0011,
    completionPer1k: 0.0044,
    cacheReadPer1k: 0.00055,
  },

  // Anthropic (cache creation ~1.25x prompt, cache read ~0.1x prompt)
  'claude-opus-4': {
    promptPer1k: 0.015,
    completionPer1k: 0.075,
    cacheReadPer1k: 0.0015,
    cacheCreationPer1k: 0.01875,
  },
  'claude-sonnet-4': {
    promptPer1k: 0.003,
    completionPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheCreationPer1k: 0.00375,
  },
  'claude-3-5-sonnet': {
    promptPer1k: 0.003,
    completionPer1k: 0.015,
    cacheReadPer1k: 0.0003,
    cacheCreationPer1k: 0.00375,
  },
  'claude-3-5-haiku': {
    promptPer1k: 0.0008,
    completionPer1k: 0.004,
    cacheReadPer1k: 0.00008,
    cacheCreationPer1k: 0.001,
  },
  'claude-3-haiku': {
    promptPer1k: 0.00025,
    completionPer1k: 0.00125,
    cacheReadPer1k: 0.00003,
    cacheCreationPer1k: 0.0003,
  },

  // Google Gemini
  'gemini-2.5-pro': { promptPer1k: 0.00125, completionPer1k: 0.01 },
  'gemini-2.5-flash': { promptPer1k: 0.0003, completionPer1k: 0.0025 },
  'gemini-2.0-flash': { promptPer1k: 0.0001, completionPer1k: 0.0004 },

  // DeepSeek
  'deepseek-chat': {
    promptPer1k: 0.00027,
    completionPer1k: 0.0011,
    cacheReadPer1k: 0.00007,
  },
  'deepseek-reasoner': {
    promptPer1k: 0.00055,
    completionPer1k: 0.00219,
    cacheReadPer1k: 0.00014,
  },
};

/**
 * Resolve pricing for a model id. Checks (1) the provided overrides, then
 * (2) the static table — each first by exact (case-insensitive) match, then
 * by the longest key that is a prefix of the model id (so dated snapshots
 * and vendor prefixes still resolve). Returns null when unknown.
 */
export function resolveModelPricing(
  modelId: string,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | null {
  const id = modelId.toLowerCase();

  const lookup = (table: Record<string, ModelPricing>): ModelPricing | null => {
    // Exact (case-insensitive) match wins.
    for (const [key, pricing] of Object.entries(table)) {
      if (key.toLowerCase() === id) return pricing;
    }
    // Longest prefix match (e.g. 'gpt-4o' matches 'gpt-4o-2024-08-06').
    let best: { key: string; pricing: ModelPricing } | null = null;
    for (const [key, pricing] of Object.entries(table)) {
      const lowerKey = key.toLowerCase();
      if (
        id.startsWith(lowerKey) &&
        (!best || lowerKey.length > best.key.length)
      ) {
        best = { key: lowerKey, pricing };
      }
    }
    return best?.pricing ?? null;
  };

  if (overrides) {
    const fromOverride = lookup(overrides);
    if (fromOverride) return fromOverride;
  }
  return lookup(MODEL_PRICING);
}

/**
 * Estimate the USD cost of a run from its token usage and pricing.
 *
 * Prompt tokens are billed at the prompt rate, minus cache-read tokens
 * which are billed at the (usually cheaper) cache-read rate. Cache-creation
 * tokens (Anthropic) are billed on top at their own rate. Returns a
 * non-negative number.
 */
export function calculateCost(usage: CostUsage, pricing: ModelPricing): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  // Non-cached prompt tokens (guard against providers where promptTokens
  // already excludes cache reads producing a negative remainder).
  const freshPrompt = Math.max(
    0,
    usage.promptTokens - cacheRead - cacheCreation,
  );

  const promptCost = (freshPrompt / 1000) * pricing.promptPer1k;
  const cacheReadCost =
    (cacheRead / 1000) * (pricing.cacheReadPer1k ?? pricing.promptPer1k);
  const cacheCreationCost =
    (cacheCreation / 1000) *
    (pricing.cacheCreationPer1k ?? pricing.promptPer1k);
  const completionCost =
    (usage.completionTokens / 1000) * pricing.completionPer1k;

  return promptCost + cacheReadCost + cacheCreationCost + completionCost;
}

/**
 * Convenience: resolve pricing for a model and compute cost in one step.
 * Returns null when the model has no known pricing.
 */
export function estimateCost(
  modelId: string,
  usage: CostUsage,
  overrides?: Record<string, ModelPricing>,
): number | null {
  const pricing = resolveModelPricing(modelId, overrides);
  if (!pricing) return null;
  return calculateCost(usage, pricing);
}
