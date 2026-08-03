import { discoverProviders, type ProviderId } from "../provider-registry.js";
import type { ExecutionPlan } from "./execution-plan.js";

export type ExecutionProviderDecision = {
  providerId: ProviderId;
  candidates: ProviderId[];
  source: "preferred" | "strict" | "relaxed" | "fallback";
};

export function resolveExecutionProvider(
  plan: ExecutionPlan,
  preferredProvider?: ProviderId,
): ExecutionProviderDecision {
  if (preferredProvider) {
    return {
      providerId: preferredProvider,
      candidates: [preferredProvider],
      source: "preferred",
    };
  }

  const strictCandidates = discoverProviders(plan.strictHints).map((provider) => provider.providerId);
  if (strictCandidates.length > 0) {
    return {
      providerId: strictCandidates[0],
      candidates: strictCandidates,
      source: "strict",
    };
  }

  const relaxedCandidates = discoverProviders(plan.relaxedHints).map((provider) => provider.providerId);
  if (relaxedCandidates.length > 0) {
    return {
      providerId: relaxedCandidates[0],
      candidates: relaxedCandidates,
      source: "relaxed",
    };
  }

  return {
    providerId: "groq",
    candidates: ["groq"],
    source: "fallback",
  };
}
