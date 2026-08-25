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
 *
 * Last refreshed: 2026-08-25 — verified against GET /api/v1/models (pricing=0).
 */
export const FREE_MODELS: readonly OpenRouterFreeModel[] = [
  // ── Fast tier — smaller / lighter models, listed first for cold-start requests
  //    (before the dynamic catalog has loaded). Smaller models are more likely
  //    to remain free longer; larger ones occasionally flip to paid.
  {
    id: "liquid/lfm-2.5-2.6b:free",
    label: "LFM 2.5 2.6B",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 65_536,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    label: "Nemotron 3.5 Lightning",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 1_000_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "dots-studio/dots-3-note-preview:free",
    label: "Dots3 Note Preview",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 512_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "thinkingmachines/inkling-small:free",
    label: "Inkling Small",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 1_048_576,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    label: "Laguna XS 2.1",
    capabilities: ["chat", "coding", "tool_calling", "json"],
    context: 262_144,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },
  {
    id: "thinkingmachines/inkling:free",
    label: "Inkling",
    capabilities: ["chat", "coding", "tool_calling", "json", "long_context"],
    context: 1_048_576,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "fast",
  },

  // ── Powerful tier — high-capability models; dynamic catalog filters them
  //    out if they move to paid between static refreshes.
  {
    id: "poolside/laguna-s-2.1:free",
    label: "Laguna S 2.1",
    capabilities: ["chat", "coding", "tool_calling", "json", "long_context"],
    context: 262_144,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "cohere/north-mini-code:free",
    label: "North Mini Code",
    capabilities: ["coding", "tool_calling", "json", "long_context"],
    context: 256_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "z-ai/glm-5.2:free",
    label: "GLM 5.2",
    capabilities: ["chat", "coding", "tool_calling", "json", "long_context"],
    context: 256_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B",
    capabilities: ["chat", "coding", "tool_calling", "json", "long_context"],
    context: 262_144,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B",
    capabilities: ["chat", "coding", "tool_calling", "json", "long_context"],
    context: 262_144,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    label: "Nemotron 3 Nano Omni Reasoning",
    capabilities: ["chat", "reasoning", "coding", "tool_calling", "json", "long_context"],
    context: 256_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super 120B",
    capabilities: ["chat", "reasoning", "coding", "tool_calling", "json", "long_context"],
    context: 262_144,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
  // Listed last — largest model, highest capability, most likely to move to paid
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra 550B",
    capabilities: ["chat", "reasoning", "coding", "tool_calling", "json", "long_context"],
    context: 1_000_000,
    supportsTools: true,
    supportsJson: true,
    free: true,
    quality: "powerful",
  },
] as const;
