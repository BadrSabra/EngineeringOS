import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  sanitizeMissionWorldStatePlanningRead,
  type MissionWorldStatePlanningRead,
} from "@workspace/ai-orchestrator";
import {
  getProjectWorldState,
  type ProjectWorldStateProjection,
  type WorldStateFactProjection,
} from "./agent-state/world-state.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";

type MissionWorldStateReplanTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EpisodeBinding = Pick<
  typeof aiAgentEpisodesTable.$inferSelect,
  | "id"
  | "projectId"
  | "executionId"
  | "attempt"
  | "missionId"
  | "goalId"
  | "projectRevision"
  | "environmentRevision"
  | "worldRevision"
  | "scope"
  | "state"
  | "verdict"
  | "closedAt"
>;

type ObservationEvidence = Pick<
  typeof aiAgentObservationsTable.$inferSelect,
  | "id"
  | "projectId"
  | "executionId"
  | "episodeId"
  | "taskScope"
  | "environmentRevisionKey"
  | "subject"
  | "predicate"
  | "valueHash"
  | "sourceType"
  | "sourceId"
  | "provenance"
  | "projectRevision"
  | "environmentRevision"
  | "completeness"
  | "freshness"
  | "environmentFreshness"
>;

type WorldStateFactEvidence = Pick<
  WorldStateFactProjection,
  | "id"
  | "subject"
  | "predicate"
  | "value"
  | "valueHash"
  | "taskScope"
  | "environmentRevision"
  | "status"
  | "environmentFreshness"
  | "sourceObservationIds"
  | "projectRevision"
>;

const CONCRETE_ENVIRONMENT_REVISION = /^env-v1:[a-f0-9]{64}$/i;
const FAILED_EPISODE_VERDICTS = new Set([
  "failed",
  "incomplete",
  "blocked",
  "replan_required",
  "world_changed",
]);

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function containsCandidateMarker(value: unknown, depth = 0): boolean {
  if (depth > 6) return true;
  if (typeof value === "string") return /candidate|overlay/i.test(value);
  if (Array.isArray(value)) return value.some((item) => containsCandidateMarker(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    /candidate|overlay/i.test(key)
    || containsCandidateMarker(item, depth + 1),
  );
}

function containsRuntimeStartRequirement(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === "string") return value === "runtime.start";
  if (Array.isArray(value)) return value.some((item) => containsRuntimeStartRequirement(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    (["kind", "recipeId", "actionKind", "transitionKind", "executionTaskType", "tool"].includes(key)
      && item === "runtime.start")
    || containsRuntimeStartRequirement(item, depth + 1),
  );
}

function isTrustedObservationSource(observation: ObservationEvidence): boolean {
  return observation.completeness === "complete"
    && observation.freshness === "fresh"
    && observation.environmentFreshness === "fresh"
    && (observation.provenance === "DIRECT_OBSERVATION"
      || observation.provenance === "SERVER_DERIVED")
    && observation.environmentRevisionKey !== "unknown"
    && observation.environmentRevisionKey.length > 0
    && !containsCandidateMarker(observation.sourceType)
    && !containsCandidateMarker(observation.sourceId);
}

function factSourcesMatch(
  fact: WorldStateFactEvidence,
  rows: readonly ObservationEvidence[],
  input: {
    projectId: string;
    executionId: string;
    episodeId: string;
    taskScope: string;
    projectRevision: string;
    environmentRevision: string;
    episodeObservationIds: ReadonlySet<string>;
  },
): boolean {
  if (fact.sourceObservationIds.length === 0 || fact.sourceObservationIds.length > 16) return false;
  const sourceRows = fact.sourceObservationIds.map((id) => rows.find((row) => row.id === id));
  if (sourceRows.some((row) => !row)) return false;
  const resolvedRows = sourceRows as ObservationEvidence[];
  return resolvedRows.every((row) => input.episodeObservationIds.has(row.id))
    && resolvedRows.every((row) =>
      row.projectId === input.projectId
      && row.executionId === input.executionId
      && row.episodeId === input.episodeId
      && row.taskScope === input.taskScope
      && row.projectRevision === input.projectRevision
      && row.environmentRevision === input.environmentRevision
      && row.environmentRevisionKey !== "unknown"
      && isTrustedObservationSource(row)
      && row.subject === fact.subject
      && row.predicate === fact.predicate
      && row.valueHash === fact.valueHash
      && !containsCandidateMarker(row.sourceType)
      && !containsCandidateMarker(row.sourceId),
    );
}

export function buildMissionWorldStatePlanningRead(input: {
  episode: EpisodeBinding;
  taskScope: string;
  worldState: ProjectWorldStateProjection;
  episodeObservations: readonly ObservationEvidence[];
  sourceObservations: readonly ObservationEvidence[];
}): MissionWorldStatePlanningRead | undefined {
  const { episode, taskScope, worldState } = input;
  const environmentRevision = episode.environmentRevision;
  if (
    !taskScope
    || taskScope.startsWith("unscoped:")
    || !environmentRevision
    || !CONCRETE_ENVIRONMENT_REVISION.test(environmentRevision)
    || !episode.projectRevision
    || worldState.projectId !== episode.projectId
  ) {
    return undefined;
  }

  const expectedTaskScope = taskScopeIdentity(episode);
  if (taskScope !== expectedTaskScope) return undefined;
  const episodeObservations = input.episodeObservations.filter((observation) =>
    observation.projectId === episode.projectId
    && observation.executionId === episode.executionId
    && observation.episodeId === episode.id
    && observation.taskScope === taskScope
    && observation.projectRevision === episode.projectRevision
    && observation.environmentRevision === environmentRevision
    && isTrustedObservationSource(observation),
  );
  if (episodeObservations.length === 0) return undefined;
  const episodeObservationIds = new Set(episodeObservations.map((observation) => observation.id));

  const facts = worldState.currentFacts
    .filter((fact) =>
      (fact.status === "believed" || fact.status === "confirmed")
      && fact.environmentFreshness === "fresh"
      && fact.taskScope === taskScope
      && fact.projectRevision === episode.projectRevision
      && fact.environmentRevision === environmentRevision
      && fact.sourceObservationIds.length > 0
      && factSourcesMatch(fact, input.sourceObservations, {
        projectId: episode.projectId,
        executionId: episode.executionId,
        episodeId: episode.id,
        taskScope,
        projectRevision: episode.projectRevision,
        environmentRevision,
        episodeObservationIds,
      }),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 8)
    .map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      valueHash: fact.valueHash,
      value: fact.value,
      status: fact.status as "believed" | "confirmed",
      sourceObservationIds: fact.sourceObservationIds,
    }));
  if (facts.length === 0) return undefined;

  const normalized = sanitizeMissionWorldStatePlanningRead({
    kind: "advisory_world_state_read",
    planningReadRevision: "0".repeat(64),
    worldRevision: worldState.worldRevision,
    sourceEpisodeId: episode.id,
    sourceExecutionId: episode.executionId,
    sourceAttempt: episode.attempt,
    ...(episode.worldRevision ? { sourceEpisodeWorldRevision: episode.worldRevision } : {}),
    taskScope,
    projectRevision: episode.projectRevision,
    environmentRevision: episode.environmentRevision,
    facts,
  });
  if (!normalized) return undefined;
  const { planningReadRevision: _placeholder, ...revisionInput } = normalized;
  const planningReadRevision = createReadRevision(revisionInput);
  return { ...normalized, planningReadRevision };
}

function createReadRevision(value: Omit<MissionWorldStatePlanningRead, "planningReadRevision">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Load a narrowly scoped advisory read for an automatic Mission replan.
 * No caller-supplied IDs are trusted: identity comes from the Goal's durable
 * acceptance projection and is checked through execution and Episode rows.
 */
export async function loadMissionWorldStatePlanningRead(
  tx: MissionWorldStateReplanTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    outcomeContract: unknown;
    nextAction: unknown;
    successCriteria: unknown;
  },
): Promise<MissionWorldStatePlanningRead | undefined> {
  const outcome = jsonRecord(input.outcomeContract);
  const acceptanceProjection = jsonRecord(outcome.acceptance);
  const receipt = jsonRecord(acceptanceProjection.receipt);
  if (
    Object.prototype.hasOwnProperty.call(outcome, "worldStateFailureDiagnosis")
    || containsRuntimeStartRequirement(input.nextAction)
    || containsRuntimeStartRequirement(input.successCriteria)
    || containsRuntimeStartRequirement(outcome.planRevision)
  ) {
    return undefined;
  }

  const executionId = nonEmptyString(acceptanceProjection.executionId);
  const acceptanceId = nonEmptyString(acceptanceProjection.acceptanceId)
    ?? (receipt.kind === "execution_acceptance" ? nonEmptyString(receipt.id) : undefined);
  if (!executionId || !acceptanceId || acceptanceProjection.candidateIdentity != null) {
    return undefined;
  }

  const acceptanceRows = await tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.projectId, input.projectId),
      eq(aiExecutionAcceptancesTable.executionId, executionId),
      eq(aiExecutionAcceptancesTable.id, acceptanceId),
    ))
    .limit(2);
  if (acceptanceRows.length !== 1) return undefined;
  const acceptance = acceptanceRows[0];
  if (
    !acceptance
    || acceptance.id !== acceptanceId
    || acceptance.outcome !== acceptanceProjection.outcome
    || (acceptance.outcome !== "FAILED" && acceptance.outcome !== "INTERRUPTED")
    || acceptance.candidateIdentity != null
  ) {
    return undefined;
  }

  const [execution] = await tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.goalId, input.goalId),
    ));
  if (
    !execution
    || execution.attempt !== acceptance.attempt
    || (execution.status !== "failed" && execution.status !== "completed")
  ) {
    return undefined;
  }

  const episodes = await tx
    .select()
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.executionId, executionId),
      eq(aiAgentEpisodesTable.attempt, acceptance.attempt),
    ))
    .limit(2);
  if (episodes.length !== 1) return undefined;
  const episode = episodes[0];
  if (
    !episode
    || episode.missionId !== input.missionId
    || episode.goalId !== input.goalId
    || episode.projectId !== input.projectId
    || (acceptance.sourceRevision != null
      && episode.projectRevision !== acceptance.sourceRevision)
    || !episode.closedAt
    || !["completed", "blocked", "failed"].includes(episode.state)
    || !episode.verdict
    || !FAILED_EPISODE_VERDICTS.has(episode.verdict)
    || containsCandidateMarker(episode.scope)
  ) {
    return undefined;
  }
  if (
    !episode.environmentRevision
    || !CONCRETE_ENVIRONMENT_REVISION.test(episode.environmentRevision)
  ) {
    return undefined;
  }

  const episodeBinding: EpisodeBinding = {
    id: episode.id,
    projectId: episode.projectId,
    executionId: episode.executionId,
    attempt: episode.attempt,
    missionId: episode.missionId,
    goalId: episode.goalId,
    projectRevision: episode.projectRevision,
    environmentRevision: episode.environmentRevision,
    worldRevision: episode.worldRevision,
    scope: episode.scope,
    state: episode.state,
    verdict: episode.verdict,
    closedAt: episode.closedAt,
  };
  const taskScope = taskScopeIdentity(episodeBinding);
  if (!taskScope || taskScope.startsWith("unscoped:")) return undefined;

  const episodeObservations = await tx
    .select()
    .from(aiAgentObservationsTable)
    .where(and(
      eq(aiAgentObservationsTable.projectId, input.projectId),
      eq(aiAgentObservationsTable.executionId, executionId),
      eq(aiAgentObservationsTable.episodeId, episode.id),
    ))
    .limit(513);
  if (
    episodeObservations.length === 0
    || episodeObservations.length > 512
    || episodeObservations.some((observation) => observation.taskScope !== taskScope)
  ) {
    return undefined;
  }

  const worldState = await getProjectWorldState(input.projectId, {
    taskScope,
    environmentRevision: episode.environmentRevision,
  }, tx);
  const candidateFacts = worldState.currentFacts
    .filter((fact) =>
      fact.taskScope === taskScope
      && fact.projectRevision === episode.projectRevision
      && fact.environmentRevision === episode.environmentRevision
      && fact.environmentFreshness === "fresh"
      && fact.sourceObservationIds.length > 0,
    )
    .slice(0, 32);
  const sourceObservationIds = [...new Set(candidateFacts.flatMap((fact) => fact.sourceObservationIds))];
  if (sourceObservationIds.length === 0) return undefined;
  const sourceObservations = await tx
    .select()
    .from(aiAgentObservationsTable)
    .where(and(
      eq(aiAgentObservationsTable.projectId, input.projectId),
      inArray(aiAgentObservationsTable.id, sourceObservationIds),
    ));

  return buildMissionWorldStatePlanningRead({
    episode: episodeBinding,
    taskScope,
    worldState,
    episodeObservations,
    sourceObservations,
  });
}