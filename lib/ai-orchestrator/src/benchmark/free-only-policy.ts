import { FREE_MODELS } from "../openrouter/model-catalog.js";
import type { ModelCapability } from "../openrouter/model-catalog.js";

type FreeOnlyCatalogModel = {
  id: string;
  free: boolean;
  supportsTools: boolean;
  capabilities: readonly ModelCapability[];
};

export type FreeOnlyModelSelectionOptions = {
  liveModelIds: ReadonlySet<string>;
  requestedModels?: readonly string[];
  maxModels?: number;
  catalog?: readonly FreeOnlyCatalogModel[];
  requiredCapability?: ModelCapability;
};

export type FreeOnlyModelSelection = {
  models: string[];
  rejectedModels: string[];
};

/**
 * Select only models that are both in the local free catalog and in the live
 * free-priced catalog, and whose advertised chat/tool capabilities match the
 * OpenRouter chat-completions path. The benchmark must fail closed when a
 * requested model is incompatible or no longer free instead of allowing a
 * provider fallback to hide that fact.
 */
export function selectFreeOnlyBenchmarkModels(
  options: FreeOnlyModelSelectionOptions,
): FreeOnlyModelSelection {
  const catalog = options.catalog ?? FREE_MODELS;
  const maxModels = Math.max(1, Math.floor(options.maxModels ?? 4));
  const supported = catalog
    .filter((model) =>
      model.free &&
      model.supportsTools &&
      model.capabilities.includes("chat") &&
      options.liveModelIds.has(model.id) &&
      (!options.requiredCapability ||
        model.capabilities.includes(options.requiredCapability)),
    )
    .map((model) => model.id);
  const supportedSet = new Set(supported);
  const requested = [...(options.requestedModels ?? [])]
    .map((model) => model.trim())
    .filter(Boolean);
  const rejectedModels = requested.filter((model) => !supportedSet.has(model));
  const models = (requested.length > 0 ? requested.filter((model) => supportedSet.has(model)) : supported)
    .slice(0, maxModels);

  return { models, rejectedModels };
}