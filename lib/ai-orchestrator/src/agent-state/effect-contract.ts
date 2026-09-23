import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const EffectObservationProfileSchema = z.enum([
  "WORKSPACE",
  "TEST",
  "RUNTIME",
  "GIT",
  "DATABASE",
  "BROWSER",
  "DELIVERY",
]);
export type EffectObservationProfile = z.infer<typeof EffectObservationProfileSchema>;

export const EffectAllowedResultSchema = z.enum([
  "OBSERVED",
  "PARTIAL",
  "NOT_OBSERVED",
  "CONTRADICTED",
]);
export type EffectAllowedResult = z.infer<typeof EffectAllowedResultSchema>;

export const EffectStatusSchema = z.enum([
  "pending",
  "observed",
  "partial",
  "not_observed",
  "contradicted",
  "unknown",
]);
export type EffectStatus = z.infer<typeof EffectStatusSchema>;

export const ExpectedStateChangeSchema = z.object({
  subject: boundedString(256),
  predicate: boundedString(256),
  expectedValue: boundedJsonSchema(AGENT_STATE_LIMITS.effectPayloadBytes).optional(),
}).strict();

export const EffectContractSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  effectId: boundedString(200),
  expectedStateChanges: z.array(ExpectedStateChangeSchema).max(64),
  observationProfile: EffectObservationProfileSchema,
  requiredEvidence: z.array(boundedString(256)).max(AGENT_STATE_LIMITS.observationReferences),
  allowedResult: EffectAllowedResultSchema,
}).strict(), AGENT_STATE_LIMITS.effectPayloadBytes);
export type EffectContract = z.infer<typeof EffectContractSchema>;

export const AgentEffectSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  effectId: boundedString(200),
  projectId: boundedString(200),
  episodeId: boundedString(200),
  executionId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  actionId: boundedString(200),
  capabilityId: boundedString(200),
  effectContractHash: boundedString(128),
  beforeObservationIds: z.array(boundedString(200)).max(AGENT_STATE_LIMITS.observationReferences),
  afterObservationIds: z.array(boundedString(200)).max(AGENT_STATE_LIMITS.observationReferences),
  expectedEffects: boundedJsonSchema(AGENT_STATE_LIMITS.effectPayloadBytes),
  status: EffectStatusSchema,
  missingEffects: z.array(boundedString(256)).max(64),
  contradictionRefs: z.array(boundedString(256)).max(64),
  evidenceRefs: z.array(boundedString(256)).max(AGENT_STATE_LIMITS.observationReferences),
  createdAt: z.string().datetime(),
}).strict(), AGENT_STATE_LIMITS.effectPayloadBytes);
export type AgentEffect = z.infer<typeof AgentEffectSchema>;

export function hashEffectContract(value: EffectContract): string {
  return canonicalJsonHash(value as Parameters<typeof canonicalJsonHash>[0]);
}

export function parseEffectContract(value: unknown): EffectContract {
  return EffectContractSchema.parse(value);
}

export function parseAgentEffect(value: unknown): AgentEffect {
  return AgentEffectSchema.parse(value);
}