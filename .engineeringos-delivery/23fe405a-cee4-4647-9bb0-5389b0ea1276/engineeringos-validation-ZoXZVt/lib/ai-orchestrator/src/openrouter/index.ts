export { FREE_MODELS } from "./model-catalog.js";
export type { ModelCapability, OpenRouterFreeModel } from "./model-catalog.js";

export {
  resolveModel,
  resolveFallbackChain,
  buildFallbackChainFromId,
  emitModelDecisionTrace,
} from "./model-resolver.js";
export type { ResolvedModel, ResolveModelOpts, ModelDecisionTrace } from "./model-resolver.js";

// PR-002: dynamic catalog
export {
  refreshDynamicCatalog,
  getDynamicModelIds,
  getUsableDynamicModelIds,
  isDynamicCatalogLoaded,
  getDynamicCatalogStatus,
  auditStaticCatalog,
} from "./dynamic-catalog.js";
export type { DynamicCatalogStatus } from "./dynamic-catalog.js";

// PR-07: circuit breaker
export {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState,
  _resetCircuitsForTest,
} from "./circuit-breaker.js";
