import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJson,
  canonicalJsonHash,
} from "./contract-utils.js";
import type { AgentObservation } from "./observation-contract.js";

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
  "UNKNOWN",
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

export type EffectClassification = {
  status: EffectStatus;
  missingEffects: string[];
  contradictionRefs: string[];
  evidenceRefs: string[];
  observedEffectCount: number;
};

function stateKey(subject: string, predicate: string): string {
  return `${subject}\u0000${predicate}`;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as Parameters<typeof canonicalJson>[0])
      === canonicalJson(right as Parameters<typeof canonicalJson>[0]);
  } catch {
    return false;
  }
}

/**
 * Classifies an effect only from complete, fresh, direct before/after
 * observations. Acceptance, receipts, and model output are intentionally not
 * accepted as observation inputs here.
 */
export function classifyEffect(input: {
  contract: EffectContract;
  before: readonly AgentObservation[];
  after: readonly AgentObservation[];
}): EffectClassification {
  const beforeByKey = new Map(input.before.map((observation) => [
    stateKey(observation.subject, observation.predicate),
    observation,
  ]));
  const afterByKey = new Map(input.after.map((observation) => [
    stateKey(observation.subject, observation.predicate),
    observation,
  ]));
  const missingEffects: string[] = [];
  const contradictionRefs: string[] = [];
  const evidenceRefs = new Set<string>();
  let observedEffectCount = 0;
  let unknownCount = 0;

  for (const expected of input.contract.expectedStateChanges) {
    const label = `${expected.subject}.${expected.predicate}`;
    const before = beforeByKey.get(stateKey(expected.subject, expected.predicate));
    const after = afterByKey.get(stateKey(expected.subject, expected.predicate));
    for (const observation of [before, after]) {
      for (const ref of observation?.evidenceRefs ?? []) evidenceRefs.add(ref);
    }

    const completeDirect = (observation: AgentObservation | undefined): boolean =>
      Boolean(
        observation
        && observation.provenance === "DIRECT_OBSERVATION"
        && observation.completeness === "complete"
        && observation.freshness === "fresh",
      );
    if (!completeDirect(before) || !completeDirect(after)) {
      missingEffects.push(label);
      continue;
    }
    if (expected.expectedValue === undefined) {
      if (jsonEquals(before!.value, after!.value)) {
        unknownCount++;
      } else {
        observedEffectCount++;
      }
      continue;
    }
    if (!jsonEquals(after!.value, expected.expectedValue)) {
      contradictionRefs.push(after!.observationId);
      continue;
    }
    if (jsonEquals(before!.value, expected.expectedValue)) {
      unknownCount++;
      continue;
    }
    observedEffectCount++;
  }

  let status: EffectStatus;
  if (contradictionRefs.length > 0) {
    status = observedEffectCount > 0 ? "partial" : "contradicted";
  } else if (missingEffects.length > 0) {
    status = observedEffectCount > 0 ? "partial" : "not_observed";
  } else if (unknownCount > 0) {
    status = observedEffectCount > 0 ? "partial" : "unknown";
  } else {
    status = "observed";
  }

  return {
    status,
    missingEffects: [...new Set(missingEffects)].slice(0, 64),
    contradictionRefs: [...new Set(contradictionRefs)].slice(0, 64),
    evidenceRefs: [...evidenceRefs].slice(0, AGENT_STATE_LIMITS.observationReferences),
    observedEffectCount,
  };
}

export function hashEffectContract(value: EffectContract): string {
  return canonicalJsonHash(value as Parameters<typeof canonicalJsonHash>[0]);
}

export function parseEffectContract(value: unknown): EffectContract {
  return EffectContractSchema.parse(value);
}

export function parseAgentEffect(value: unknown): AgentEffect {
  return AgentEffectSchema.parse(value);
}