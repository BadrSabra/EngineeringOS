import type { ProviderId } from "../provider-registry.js";

export type CapabilityRecoveryProviderCandidate = {
  provider: ProviderId;
  model?: string;
};

/**
 * Product recovery starting from OpenRouter must remain inside OpenRouter,
 * even when its credential is missing. Internal calls starting from another
 * provider retain their explicit, caller-owned fallback list.
 */
export function selectCapabilityRecoveryCandidates<T extends CapabilityRecoveryProviderCandidate>(
  primary: T,
  fallbacks: readonly T[] = [],
): T[] {
  const eligibleFallbacks = primary.provider === "openrouter"
    ? fallbacks.filter((candidate) => candidate.provider === "openrouter")
    : fallbacks;
  const candidates = [primary, ...eligibleFallbacks];
  return candidates.filter((candidate, index, all) =>
    all.findIndex((item) =>
      item.provider === candidate.provider &&
      (item.model ?? "") === (candidate.model ?? ""),
    ) === index,
  );
}
