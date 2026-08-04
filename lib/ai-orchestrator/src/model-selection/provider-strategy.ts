import { discoverProviders, type ProviderId } from "../provider-registry.js";
import type { ExecutionPlan } from "./execution-plan.js";
import type { ContextIntensity, GraphMode } from "./execution-plan.js";

/** Explains which part of the ExecutionPlan drove the provider choice. */
export type ProviderDecisionRationale = {
  drivingField: "preferred" | "strictHints" | "relaxedHints" | "fallback";
  contextIntensity: ContextIntensity;
  graphMode: GraphMode;
};

export type ExecutionProviderDecision = {
  providerId: ProviderId;
  candidates: ProviderId[];
  source: "preferred" | "strict" | "relaxed" | "fallback";
  /** Traceable explanation of why this provider was chosen. */
  rationale: ProviderDecisionRationale;
};

export function resolveExecutionProvider(
  plan: ExecutionPlan,
  preferredProvider?: ProviderId,
): ExecutionProviderDecision {
  const { contextIntensity, graphMode } = plan.taskProfile;

  if (preferredProvider) {
    return {
      providerId: preferredProvider,
      candidates: [preferredProvider],
      source: "preferred",
      rationale: { drivingField: "preferred", contextIntensity, graphMode },
    };
  }

  const strictCandidates = discoverProviders(plan.strictHints).map((p) => p.providerId);
  if (strictCandidates.length > 0) {
    return {
      providerId: strictCandidates[0],
      candidates: strictCandidates,
      source: "strict",
      rationale: { drivingField: "strictHints", contextIntensity, graphMode },
    };
  }

  const relaxedCandidates = discoverProviders(plan.relaxedHints).map((p) => p.providerId);
  if (relaxedCandidates.length > 0) {
    return {
      providerId: relaxedCandidates[0],
      candidates: relaxedCandidates,
      source: "relaxed",
      rationale: { drivingField: "relaxedHints", contextIntensity, graphMode },
    };
  }

  return {
    providerId: "groq",
    candidates: ["groq"],
    source: "fallback",
    rationale: { drivingField: "fallback", contextIntensity, graphMode },
  };
}
