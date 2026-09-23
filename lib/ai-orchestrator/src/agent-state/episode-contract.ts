import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJsonHash,
  safePublicString,
} from "./contract-utils.js";

export { AGENT_STATE_SCHEMA_VERSION, canonicalJsonHash };

export const EpisodeStateSchema = z.enum([
  "created",
  "running",
  "paused",
  "effect_pending",
  "verifying",
  "waiting_approval",
  "needs_replan",
  "completed",
  "blocked",
  "failed",
  "cancelling",
  "cancelled",
]);
export type EpisodeState = z.infer<typeof EpisodeStateSchema>;

export const EpisodeVerdictSchema = z.enum([
  "achieved",
  "incomplete",
  "blocked",
  "replan_required",
  "world_changed",
  "needs_approval",
  "unsafe",
  "failed",
  "cancelled",
]);
export type EpisodeVerdict = z.infer<typeof EpisodeVerdictSchema>;

export const EpisodeEventTypeSchema = z.enum([
  "EPISODE_CREATED",
  "OBSERVATION_REQUESTED",
  "OBSERVATION_RECORDED",
  "PLAN_SELECTED",
  "ACTION_REQUESTED",
  "ACTION_COMMITTED",
  "EFFECT_PENDING",
  "EFFECT_CLASSIFIED",
  "CLAIM_UPDATED",
  "REPLAN_REQUESTED",
  "ACCEPTANCE_LINKED",
  "EPISODE_PAUSED",
  "EPISODE_RESUMED",
  "EPISODE_CANCELLED",
  "EPISODE_TERMINAL",
]);
export type EpisodeEventType = z.infer<typeof EpisodeEventTypeSchema>;

const EpisodeReferencesSchema = z.array(boundedString(256)).max(AGENT_STATE_LIMITS.episodeReferences);
const EpisodeScopeSchema = boundedJsonSchema(16 * 1024);

export const AgentEpisodeSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  episodeId: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  missionId: boundedString(200).optional(),
  goalId: boundedString(200).optional(),
  parentEpisodeId: boundedString(200).optional(),
  projectRevision: boundedString(200),
  worldRevision: boundedString(200).optional(),
  beliefRevision: boundedString(200).optional(),
  planRevision: boundedString(200).optional(),
  intentKind: boundedString(80),
  scope: EpisodeScopeSchema,
  objectiveContractId: boundedString(200).optional(),
  observationRefs: EpisodeReferencesSchema,
  actionRefs: EpisodeReferencesSchema,
  expectedEffectRefs: EpisodeReferencesSchema,
  observedEffectRefs: EpisodeReferencesSchema,
  evidenceRefs: EpisodeReferencesSchema,
  state: EpisodeStateSchema,
  verdict: EpisodeVerdictSchema.optional(),
  reasonCode: boundedString(120).optional(),
  nextActionCode: boundedString(120).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
}).strict(), 32 * 1024);
export type AgentEpisode = z.infer<typeof AgentEpisodeSchema>;

export const AgentEpisodeEventSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  eventId: boundedString(200),
  episodeId: boundedString(200),
  projectId: boundedString(200),
  executionId: boundedString(200),
  attempt: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  eventType: EpisodeEventTypeSchema,
  payload: boundedJsonSchema(AGENT_STATE_LIMITS.episodeEventPayloadBytes),
  actorType: z.enum(["server", "worker", "user", "system"]),
  actorId: boundedString(200).optional(),
  correlationId: boundedString(200).optional(),
  createdAt: z.string().datetime(),
}).strict(), AGENT_STATE_LIMITS.episodeEventPayloadBytes);
export type AgentEpisodeEvent = z.infer<typeof AgentEpisodeEventSchema>;

export type PublicAgentEpisode = Pick<
  AgentEpisode,
  | "schemaVersion"
  | "episodeId"
  | "projectId"
  | "executionId"
  | "attempt"
  | "state"
  | "createdAt"
  | "updatedAt"
> & {
  closedAt?: string;
  verdict?: EpisodeVerdict;
  reasonCode?: string;
  nextActionCode?: string;
  referenceCounts: {
    observations: number;
    actions: number;
    effects: number;
    evidence: number;
  };
};

export function toPublicAgentEpisode(episode: AgentEpisode): PublicAgentEpisode {
  return {
    schemaVersion: episode.schemaVersion,
    episodeId: episode.episodeId,
    projectId: episode.projectId,
    executionId: episode.executionId,
    attempt: episode.attempt,
    state: episode.state,
    ...(episode.verdict ? { verdict: episode.verdict } : {}),
    ...(episode.reasonCode ? { reasonCode: safePublicString(episode.reasonCode, 120) } : {}),
    ...(episode.nextActionCode ? { nextActionCode: safePublicString(episode.nextActionCode, 120) } : {}),
    createdAt: episode.createdAt,
    updatedAt: episode.updatedAt,
    ...(episode.closedAt ? { closedAt: episode.closedAt } : {}),
    referenceCounts: {
      observations: episode.observationRefs.length,
      actions: episode.actionRefs.length,
      effects: episode.expectedEffectRefs.length + episode.observedEffectRefs.length,
      evidence: episode.evidenceRefs.length,
    },
  };
}

export function parseAgentEpisode(value: unknown): AgentEpisode {
  return AgentEpisodeSchema.parse(value);
}

export function parseAgentEpisodeEvent(value: unknown): AgentEpisodeEvent {
  return AgentEpisodeEventSchema.parse(value);
}