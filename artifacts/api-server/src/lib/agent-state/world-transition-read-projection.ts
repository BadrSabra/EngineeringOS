import type {
  AiAgentEffectBundle,
  AiAgentObservation,
  AiWorldTransition,
} from "@workspace/db";

const MAX_OBSERVATIONS_PER_SIDE = 12;
export const MAX_WORLD_TRANSITIONS_PER_ATTEMPT = 8;
const OBSERVATION_PREDICATES = new Set([
  "runtime.before_state",
  "runtime.after_state",
  "runtime.status",
]);
const OBSERVATION_PROVENANCE = new Set([
  "DIRECT_OBSERVATION",
  "SERVER_DERIVED",
  "MODEL_INFERRED",
]);
const EFFECT_VERDICTS = new Set([
  "OBSERVED",
  "PARTIAL",
  "NOT_OBSERVED",
  "CONTRADICTED",
  "UNKNOWN",
]);

export type RuntimeWorldTransitionObservationProjection = {
  id: string;
  predicate: "runtime.before_state" | "runtime.after_state" | "runtime.status";
  provenance: "DIRECT_OBSERVATION" | "SERVER_DERIVED" | "MODEL_INFERRED";
  completeness: "complete" | "partial" | "failed";
  freshness: "fresh" | "stale" | "unknown";
  environmentFreshness: "fresh" | "stale" | "unknown";
  runtimeStatus: "stopped" | "running" | null;
  observedAt: string;
};

export type RuntimeWorldTransitionEffectVerdict =
  | "OBSERVED"
  | "PARTIAL"
  | "NOT_OBSERVED"
  | "CONTRADICTED"
  | "UNKNOWN";

export type RuntimeWorldTransitionReadProjection = {
  id: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  status: "pending" | "materialized" | "retrying" | "terminal_failed";
  parentWorldRevision: string | null;
  resultingWorldRevision: string | null;
  environmentRevision: string | null;
  freshness: "fresh" | "stale" | "unknown";
  beforeObservations: RuntimeWorldTransitionObservationProjection[];
  afterObservations: RuntimeWorldTransitionObservationProjection[];
  effectBundle: { id: string; verdict: RuntimeWorldTransitionEffectVerdict } | null;
  failureCode: string | null;
  createdAt: string;
  materializedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  )).slice(0, MAX_OBSERVATIONS_PER_SIDE);
}

export function linkedWorldTransitionObservationIds(
  transition: AiWorldTransition,
): string[] {
  return Array.from(new Set([
    ...observationIds(transition.beforeObservationIds),
    ...observationIds(transition.afterObservationIds),
  ]));
}

function timestamp(value: Date): string {
  return value.toISOString();
}

function runtimeStatusValue(
  observation: AiAgentObservation,
  transition: AiWorldTransition,
  sharedAcrossSides: boolean,
): "stopped" | "running" | null {
  const independentlyFresh = observation.provenance === "DIRECT_OBSERVATION"
    && observation.completeness === "complete"
    && observation.freshness === "fresh"
    && observation.environmentFreshness === "fresh"
    && transition.freshness === "fresh"
    && !sharedAcrossSides
    && Boolean(transition.environmentRevision)
    && observation.environmentRevision === transition.environmentRevision
    && observation.environmentRevisionKey === transition.environmentRevisionKey
    && observation.taskScope === transition.taskScope;
  if (!independentlyFresh) return null;

  if (observation.predicate === "runtime.status") {
    return observation.value === "stopped" || observation.value === "running"
      ? observation.value
      : null;
  }
  if (!isRecord(observation.value)) return null;
  return observation.value.runtimeStatus === "stopped" || observation.value.runtimeStatus === "running"
    ? observation.value.runtimeStatus
    : null;
}

function projectObservation(
  observation: AiAgentObservation | undefined,
  transition: AiWorldTransition,
  side: "before" | "after",
  sharedAcrossSides: boolean,
): RuntimeWorldTransitionObservationProjection | null {
  if (!observation
    || observation.projectId !== transition.projectId
    || observation.executionId !== transition.executionId
    || observation.episodeId !== transition.episodeId
    || !OBSERVATION_PREDICATES.has(observation.predicate)
    || (side === "before"
      ? !["runtime.before_state", "runtime.status"].includes(observation.predicate)
      : !["runtime.after_state", "runtime.status"].includes(observation.predicate))
    || !OBSERVATION_PROVENANCE.has(observation.provenance)
    || !["complete", "partial", "failed"].includes(observation.completeness)
    || !["fresh", "stale", "unknown"].includes(observation.freshness)
    || !["fresh", "stale", "unknown"].includes(observation.environmentFreshness)) {
    return null;
  }

  return {
    id: observation.id,
    predicate: observation.predicate as RuntimeWorldTransitionObservationProjection["predicate"],
    provenance: observation.provenance as RuntimeWorldTransitionObservationProjection["provenance"],
    completeness: observation.completeness,
    freshness: observation.freshness,
    environmentFreshness: observation.environmentFreshness,
    runtimeStatus: runtimeStatusValue(observation, transition, sharedAcrossSides),
    observedAt: timestamp(observation.observedAt),
  };
}

export function projectRuntimeWorldTransition(
  transition: AiWorldTransition,
  observations: AiAgentObservation[],
  effectBundle: AiAgentEffectBundle | null,
): RuntimeWorldTransitionReadProjection {
  const beforeIds = observationIds(transition.beforeObservationIds);
  const afterIds = observationIds(transition.afterObservationIds);
  const afterSet = new Set(afterIds);
  const sharedIds = new Set(beforeIds.filter((id) => afterSet.has(id)));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));

  const projectSide = (
    ids: string[],
    side: "before" | "after",
  ): RuntimeWorldTransitionObservationProjection[] => ids
    .map((id) => projectObservation(
      observationById.get(id),
      transition,
      side,
      sharedIds.has(id),
    ))
    .filter((observation): observation is RuntimeWorldTransitionObservationProjection => observation !== null);

  const linkedEffectBundle = effectBundle
    && transition.effectBundleId === effectBundle.id
    && effectBundle.projectId === transition.projectId
    && effectBundle.executionId === transition.executionId
    && effectBundle.attempt === transition.attempt
    && effectBundle.episodeId === transition.episodeId
    ? {
        id: effectBundle.id,
        verdict: EFFECT_VERDICTS.has(effectBundle.verdict)
          ? effectBundle.verdict as RuntimeWorldTransitionEffectVerdict
          : "UNKNOWN" as const,
      }
    : null;

  const failureCode = typeof transition.failureCode === "string"
    && /^[A-Z][A-Z0-9_]{0,79}$/.test(transition.failureCode)
    ? transition.failureCode
    : null;

  return {
    id: transition.id,
    executionId: transition.executionId,
    attempt: transition.attempt,
    episodeId: transition.episodeId,
    actionId: transition.actionId,
    status: transition.status,
    parentWorldRevision: transition.parentWorldRevision || null,
    resultingWorldRevision: transition.resultingWorldRevision || null,
    environmentRevision: transition.environmentRevision || null,
    freshness: transition.freshness,
    beforeObservations: projectSide(beforeIds, "before"),
    afterObservations: projectSide(afterIds, "after"),
    effectBundle: linkedEffectBundle,
    failureCode,
    createdAt: timestamp(transition.createdAt),
    materializedAt: transition.materializedAt ? timestamp(transition.materializedAt) : null,
  };
}