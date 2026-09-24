import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const StrategyEvaluationStatusSchema = z.enum([
  "discovered",
  "pending_replay",
  "replay_passed",
  "replay_failed",
  "canary",
  "promoted",
  "revoked",
  "superseded",
]);
export type StrategyEvaluationStatus = z.infer<typeof StrategyEvaluationStatusSchema>;

/**
 * Accepted episode support may queue a discovered candidate for replay, but
 * cannot promote it or change any later lifecycle state.
 */
export function strategyStatusAfterAcceptedSupport(
  currentStatus: StrategyEvaluationStatus,
  supportingEpisodeIds: readonly string[],
): StrategyEvaluationStatus {
  if (currentStatus !== "discovered") return currentStatus;
  return new Set(supportingEpisodeIds).size >= 2 ? "pending_replay" : "discovered";
}

export const StrategyCandidateSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  candidateId: boundedString(200),
  triggerConditions: z.array(boundedJsonSchema(8 * 1024)).max(32),
  preconditions: z.array(boundedJsonSchema(8 * 1024)).max(32),
  observationRequirements: z.array(boundedJsonSchema(8 * 1024)).max(32).optional(),
  recommendedActionOrder: z.array(boundedString(200)).max(64),
  expectedEffects: z.array(boundedString(200)).max(64),
  failureSemantics: z.array(boundedString(512)).max(32).optional(),
  supportingEpisodeIds: z.array(boundedString(200)).max(AGENT_STATE_LIMITS.strategyEpisodes),
  contradictingEpisodeIds: z.array(boundedString(200)).max(AGENT_STATE_LIMITS.strategyEpisodes),
  applicableScopes: z.array(boundedString(256)).max(32),
  confidence: z.number().min(0).max(1),
  evaluationStatus: StrategyEvaluationStatusSchema,
}).strict(), AGENT_STATE_LIMITS.strategyCandidateBytes);
export type StrategyCandidate = z.infer<typeof StrategyCandidateSchema>;

export function hashStrategyCandidate(value: StrategyCandidate): string {
  return canonicalJsonHash(value as Parameters<typeof canonicalJsonHash>[0]);
}

export function parseStrategyCandidate(value: unknown): StrategyCandidate {
  return StrategyCandidateSchema.parse(value);
}