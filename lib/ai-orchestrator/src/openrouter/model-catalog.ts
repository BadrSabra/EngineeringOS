/**
 * OpenRouter Free-Tier Model Catalog (STORY-06)
 *
 * Single source of truth for OpenRouter model metadata.
 * Registry and execution paths must never hardcode OpenRouter model IDs —
 * they derive them from this catalog via model-resolver.ts.
 *
 * Adding a model: add one entry here. Nothing else changes.
 * Removing a model: delete the entry. The resolver automatically skips it.
 *
 * Ordering convention within each quality tier:
 *   Smaller / more stable models listed FIRST so the first request (before the
 *   dynamic catalog has loaded) is less likely to hit a "paid version" 404.
 *   Large models that periodically flip from free → paid are listed LAST within
 *   their tier — the dynamic catalog (which filters by live pricing = $0) will
 *   exclude them automatically after the first refresh.
 */

export type ModelCapability =
  | "chat"          // General conversational tasks
  | "coding"        // Code generation, analysis, debugging
  | "tool_calling"  // Function/tool call protocol (native JSON)
  | "reasoning"     // Multi-step reasoning, chain-of-thought
  | "json"          // Reliable structured JSON output
  | "long_context"; // Large context window tasks (>64k tokens)

export type OpenRouterFreeModel = {
  id: string;
  label: string;
  capabilities: ModelCapability[];
  /** Max context window in tokens. */
  context: number;
  /** Supports native OpenAI tool_calls protocol. */
  supportsTools: boolean;
  /** Supports response_format: { type: "json_object" }. */
  supportsJson: boolean;
  free: true;
  /** Primary quality tier — fast=lightweight, powerful=high-capability. */
  quality: "fast" | "powerful";
};

/**
 * Ordered list of OpenRouter free-tier model candidates.
 *
 * Models removed/repriced by OpenRouter trigger MODEL_NOT_FOUND (404) or
 * PLAN_RESTRICTED (402) — the fallback engine in model-resolver.ts advances
 * to the next candidate automatically. The dynamic catalog (dynamic-catalog.ts)
 * pre-filters this list to only models currently priced at $0 so the chain
 * stays short and reliable after the first request.
 */
export const FREE_MODELS: readonly OpenRouterFreeModel[] = [
  // ── Fast tier — small models, historically most stable on free tier ────────
  {
    id: "meta-llama/llama-3.1-8b-instruct:free",
    label: "Llama 3.1 8B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 131_072,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "qwen/qwen-2.5-7b-instruct:free",
    label: "Qwen 2.5 7B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 131_072,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "qwen/qwen3-8b:free",
    label: "Qwen3 8B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 131_072,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "mistralai/mistral-7b-instruct:free",
    label: "Mistral 7B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 32_768,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "google/gemma-3-4b-it:free",
    label: "Gemma 3 4B",
    capabilities: ["chat", "coding"],
    context: 131_072,
    supportsTools: false,
    supportsJson: false,
    free: true,
    quality: "fast",
  },
  {
    id: "meta-llama/llama-3.2-3b-instruct:free",
    label: "Llama 3.2 3B",
    capabilities: ["chat", "coding", "json"],
    context: 131_072,
    supportsTools: false,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  // Larger fast-tier — stable but occasionally restricted
  {
    id: "google/gemma-3-12b-it:free",
    label: "Gemma 3 12B",
    capabilities: ["chat", "coding"],
    context: 131_072,
    supportsTools: false,
    supportsJson: false,
    free: true,
    quality: "fast",
  },
  {
    id: "qwen/qwen3-30b-a3b:free",
    label: "Qwen3 30B",
    capabilities: ["chat", "coding", "reasoning", "tool_calling", "json"],
    context: 131_072,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },

  // ── Powerful tier — high-capability but more likely to move to paid ────────
  // Listed last within the tier; dynamic catalog filters them out when repriced.
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B",
    capabilities: ["chat", "coding", "tool_calling", "reasoning", "json"],
    context: 131_072,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "qwen/qwen3-235b-a22b:free",
    label: "Qwen3 235B",
    capabilities: ["chat", "reasoning", "coding", "json", "long_context"],
    context: 65_536,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "google/gemma-3-27b-it:free",
    label: "Gemma 3 27B",
    capabilities: ["chat", "reasoning"],
    context: 131_072,
    supportsTools: false,
    supportsJson: false,
    free: true,
    quality: "powerful",
  },
  {
    id: "deepseek/deepseek-r1:free",
    label: "DeepSeek R1",
    capabilities: ["reasoning", "coding", "json"],
    context: 65_536,
    supportsTools: false,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
] as const;
