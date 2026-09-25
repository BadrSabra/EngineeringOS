import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJsonHash,
} from "./contract-utils.js";

export const ObservationKindSchema = z.enum([
  "SOURCE",
  "TEST",
  "RUNTIME",
  "DATABASE",
  "GIT",
  "BROWSER",
  "DELIVERY",
  "EXTERNAL",
]);
export type ObservationKind = z.infer<typeof ObservationKindSchema>;

export const ObservationCompletenessSchema = z.enum(["complete", "partial", "failed"]);
export type ObservationCompleteness = z.infer<typeof ObservationCompletenessSchema>;

export const ObservationFreshnessSchema = z.enum(["fresh", "stale", "unknown"]);
export type ObservationFreshness = z.infer<typeof ObservationFreshnessSchema>;

export const ObservationProvenanceSchema = z.enum([
  "DIRECT_OBSERVATION",
  "SERVER_DERIVED",
  "MODEL_INFERRED",
]).default("SERVER_DERIVED");
export type ObservationProvenance = z.infer<typeof ObservationProvenanceSchema>;

export const AgentObservationSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  observationId: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  episodeId: boundedString(200),
  kind: ObservationKindSchema,
  provenance: ObservationProvenanceSchema,
  observationRole: boundedString(100),
  sourceType: boundedString(120),
  sourceId: boundedString(256),
  sourceVersion: boundedString(200).optional(),
  subject: boundedString(256),
  predicate: boundedString(256),
  value: boundedJsonSchema(AGENT_STATE_LIMITS.observationValueBytes),
  sourceRefs: z.array(boundedString(256)).max(AGENT_STATE_LIMITS.observationReferences),
  observedAt: z.string().datetime(),
  projectRevision: boundedString(200).optional(),
  environmentRevision: boundedString(200).optional(),
  environmentFreshness: ObservationFreshnessSchema.optional(),
  completeness: ObservationCompletenessSchema,
  freshness: ObservationFreshnessSchema,
  evidenceRefs: z.array(boundedString(256)).max(AGENT_STATE_LIMITS.observationReferences),
}).strict(), AGENT_STATE_LIMITS.observationValueBytes);
export type AgentObservation = z.infer<typeof AgentObservationSchema>;

export function hashObservationValue(value: AgentObservation["value"]): string {
  return canonicalJsonHash(value as Parameters<typeof canonicalJsonHash>[0]);
}

export function parseAgentObservation(value: unknown): AgentObservation {
  return AgentObservationSchema.parse(value);
}