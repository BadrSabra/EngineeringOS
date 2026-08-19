import { FREE_MODELS } from "../openrouter/model-catalog.js";

type FreeOnlyCatalogModel = {
  id: string;
  free: boolean;
  supportsTools: boolean;
};

export type FreeOnlyModelSelectionOptions = {
  liveModelIds: ReadonlySet<string>;
  requestedModels?: readonly string[];
  maxModels?: number;
  catalog?: readonly FreeOnlyCatalogModel[];
};

export type FreeOnlyModelSelection = {
  models: string[];
  rejectedModels: string[];
};

/**
 * Select only models that are both in the local free catalog and in the live
 * free-priced catalog. The benchmark must fail closed when a requested model
 * is no longer free instead of allowing a provider fallback to hide that fact.
 */
export function selectFreeOnlyBenchmarkModels(
  options: FreeOnlyModelSelectionOptions,
): FreeOnlyModelSelection {
  const catalog = options.catalog ?? FREE_MODELS;
  const maxModels = Math.max(1, Math.floor(options.maxModels ?? 4));
  const supported = catalog
    .filter((model) => model.free && model.supportsTools && options.liveModelIds.has(model.id))
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