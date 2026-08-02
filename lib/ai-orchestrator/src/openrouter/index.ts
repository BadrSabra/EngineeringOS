export { FREE_MODELS } from "./model-catalog.js";
export type { ModelCapability, OpenRouterFreeModel } from "./model-catalog.js";

export {
  resolveModel,
  resolveFallbackChain,
  buildFallbackChainFromId,
  emitModelDecisionTrace,
} from "./model-resolver.js";
export type { ResolvedModel, ResolveModelOpts, ModelDecisionTrace } from "./model-resolver.js";
