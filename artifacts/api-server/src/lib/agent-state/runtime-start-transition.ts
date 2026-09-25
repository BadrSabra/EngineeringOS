import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiWorldTransitionsTable,
  db,
} from "@workspace/db";
import {
  invalidateContextSlice,
} from "@workspace/ai-orchestrator";
import { getProjectWorldState, materializeWorldStateForProject } from "./world-state.js";

export type RuntimeStartTransitionIntent = {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
  workerId: string;
  parentWorldRevision: string;
  parentFactRefs: readonly string[];
  beforeObservationIds: readonly string[];
  afterObservationIds: readonly string[];
  evidenceRefs: readonly string[];
  environmentRevision: string | null;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function transitionIdempotencyKey(input: RuntimeStartTransitionIntent): string {
  return `runtime.start:${input.executionId}:${input.attempt}:${input.episodeId}:${input.actionId}`;
}

export async function createPendingRuntimeStartTransition(
  input: RuntimeStartTransitionIntent,
): Promise<string> {
  const idempotencyKey = transitionIdempotencyKey(input);
  const beforeObservationIds = unique(input.beforeObservationIds);
  const afterObservationIds = unique(input.afterObservationIds);
  return db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, input.executionId),
        eq(aiExecutionsTable.projectId, input.projectId),
        eq(aiExecutionsTable.attempt, input.attempt),
      ))
      .for("update")
      .limit(1);
    if (
      !execution
      || execution.status !== "running"
      || execution.workerId !== input.workerId
      || !execution.leaseUntil
      || execution.leaseUntil <= new Date()
    ) {
      throw new Error("runtime_start_transition_owner_stale");
    }

    const [existing] = await tx
      .select()
      .from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.projectId, input.projectId),
        eq(aiWorldTransitionsTable.idempotencyKey, idempotencyKey),
      ))
      .for("update")
      .limit(1);
    if (existing) {
      if (
        existing.executionId !== input.executionId
        || existing.attempt !== input.attempt
        || existing.episodeId !== input.episodeId
        || existing.actionId !== input.actionId
        || existing.effectBundleId !== input.effectBundleId
        || existing.parentWorldRevision !== input.parentWorldRevision
        || JSON.stringify(existing.beforeObservationIds) !== JSON.stringify(beforeObservationIds)
        || JSON.stringify(existing.afterObservationIds) !== JSON.stringify(afterObservationIds)
      ) {
        throw new Error("runtime_start_transition_idempotency_conflict");
      }
      return existing.id;
    }

    const transitionId = randomUUID();
    await tx.insert(aiWorldTransitionsTable).values({
      id: transitionId,
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      episodeId: input.episodeId,
      actionId: input.actionId,
      effectBundleId: input.effectBundleId,
      parentWorldRevision: input.parentWorldRevision,
      taskScope: "project",
      environmentRevisionKey: input.environmentRevision
        ? `revision:${input.environmentRevision}`
        : "unknown",
      environmentRevision: input.environmentRevision,
      freshness: "unknown",
      beforeObservationIds,
      afterObservationIds,
      materializedObservationIds: [],
      parentFactRefs: unique(input.parentFactRefs),
      changedFactRefs: [],
      evidenceRefs: unique(input.evidenceRefs),
      status: "pending",
      idempotencyKey,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return transitionId;
  });
}

function validBeforeObservation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.status === "observed"
    && (state.runtimeStatus === "stopped" || state.runtimeStatus === "running")
    && state.inventoryComplete === true
    && Array.isArray(state.unknownListenerPorts)
    && state.unknownListenerPorts.length === 0
    && typeof state.observedAt === "string"
    && Number.isFinite(Date.parse(state.observedAt));
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("parent_revision_mismatch")) return "parent_world_revision_mismatch";
  if (message.includes("observation_scope_incomplete")) return "transition_observations_incomplete";
  if (message.startsWith("runtime_start_transition_")) return message.slice(0, 80);
  return "world_state_materialization_failed";
}

async function markTerminalFailure(
  transitionId: string,
  code: string,
): Promise<void> {
  await db.update(aiWorldTransitionsTable)
    .set({
      status: "terminal_failed",
      failureCode: code,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiWorldTransitionsTable.id, transitionId),
      inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
    ));
}

export async function finalizeRuntimeStartTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<{ status: "materialized" | "terminal_failed"; worldRevision?: string; failureCode?: string }> {
  const [transition] = await db.select()
    .from(aiWorldTransitionsTable)
    .where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.executionId, input.executionId),
      eq(aiWorldTransitionsTable.attempt, input.attempt),
      eq(aiWorldTransitionsTable.episodeId, input.episodeId),
      eq(aiWorldTransitionsTable.actionId, input.actionId),
    ))
    .limit(1);
  if (!transition || transition.effectBundleId !== input.effectBundleId) {
    throw new Error("runtime_start_transition_identity_missing");
  }
  if (transition.status === "materialized" && transition.resultingWorldRevision) {
    return { status: "materialized", worldRevision: transition.resultingWorldRevision };
  }
  if (transition.status === "terminal_failed") {
    return { status: "terminal_failed", failureCode: transition.failureCode ?? "transition_terminal_failed" };
  }

  let projected = false;
  try {
    const [acceptance] = await db.select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, input.executionId),
        eq(aiExecutionAcceptancesTable.attempt, input.attempt),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      ))
      .limit(1);
    if (acceptance?.effectBundleId !== input.effectBundleId) {
      throw new Error("runtime_start_transition_acceptance_missing");
    }
    const [episode] = await db.select({ id: aiAgentEpisodesTable.id })
      .from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
        eq(aiAgentEpisodesTable.executionId, input.executionId),
        eq(aiAgentEpisodesTable.attempt, input.attempt),
      ))
      .limit(1);
    if (!episode) throw new Error("runtime_start_transition_episode_binding_missing");
    if (!/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)) {
      throw new Error("runtime_start_transition_parent_unavailable");
    }

    const beforeObservationIds = unique(transition.beforeObservationIds as string[]);
    const afterObservationIds = unique(transition.afterObservationIds as string[]);
    const observationIds = unique([...beforeObservationIds, ...afterObservationIds]);
    if (beforeObservationIds.length === 0 || afterObservationIds.length === 0) {
      throw new Error("runtime_start_transition_observations_missing");
    }
    const observations = await db.select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, input.projectId),
        inArray(aiAgentObservationsTable.id, observationIds),
      ));
    if (observations.length !== observationIds.length || observations.some((observation) => (
      observation.executionId !== input.executionId
      || observation.episodeId !== input.episodeId
      || observation.provenance !== "DIRECT_OBSERVATION"
      || observation.completeness !== "complete"
      || observation.freshness !== "fresh"
      || observation.environmentFreshness !== "fresh"
    ))) {
      throw new Error("runtime_start_transition_observations_incomplete");
    }
    const beforeRows = observations.filter((observation) => beforeObservationIds.includes(observation.id));
    const afterRows = observations.filter((observation) => afterObservationIds.includes(observation.id));
    if (
      !beforeRows.some((observation) => observation.predicate === "runtime.before_state" && validBeforeObservation(observation.value))
      || !afterRows.some((observation) => observation.predicate === "runtime.status" && observation.value === "running")
    ) {
      throw new Error("runtime_start_transition_observations_unproven");
    }

    const materialized = await materializeWorldStateForProject(input.projectId, {
      observationIds,
      expectedWorldRevision: transition.parentWorldRevision,
      expectedRevisionExcludeEpisodeIds: [input.episodeId],
    });
    projected = true;
    const state = await getProjectWorldState(input.projectId);
    const selected = new Set(observationIds);
    const changedFactRefs = state.facts
      .filter((fact) => fact.sourceObservationIds.some((id) => selected.has(id)))
      .map((fact) => fact.id);
    const updated = await db.update(aiWorldTransitionsTable)
      .set({
        resultingWorldRevision: materialized.worldRevision,
        materializedObservationIds: observationIds,
        changedFactRefs,
        freshness: "fresh",
        status: "materialized",
        failureCode: null,
        nextRetryAt: null,
        materializedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(aiWorldTransitionsTable.id, transition.id),
        inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
      ))
      .returning({ id: aiWorldTransitionsTable.id });
    if (updated.length === 0) {
      throw new Error("runtime_start_transition_owner_stale");
    }
    invalidateContextSlice(input.projectId, "worldState");
    return { status: "materialized", worldRevision: materialized.worldRevision };
  } catch (error) {
    const code = failureCode(error);
    try {
      await markTerminalFailure(transition.id, code);
    } finally {
      if (projected) invalidateContextSlice(input.projectId, "worldState");
    }
    return { status: "terminal_failed", failureCode: code };
  }
}

export async function readWorldStateForDecision(input: {
  projectId: string;
  transitionId: string;
}): Promise<{
  transitionId: string;
  worldRevision: string;
  currentFacts: Awaited<ReturnType<typeof getProjectWorldState>>["currentFacts"];
  facts: Awaited<ReturnType<typeof getProjectWorldState>>["facts"];
}> {
  const [transition] = await db.select({
    id: aiWorldTransitionsTable.id,
    status: aiWorldTransitionsTable.status,
    resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
  })
    .from(aiWorldTransitionsTable)
    .where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.id, input.transitionId),
    ))
    .limit(1);
  if (transition?.status !== "materialized" || !transition.resultingWorldRevision) {
    throw new Error("world_state_transition_not_materialized");
  }
  const projection = await getProjectWorldState(input.projectId);
  if (projection.worldRevision !== transition.resultingWorldRevision) {
    throw new Error("world_state_transition_revision_not_current");
  }
  return {
    transitionId: transition.id,
    worldRevision: projection.worldRevision,
    currentFacts: projection.currentFacts,
    facts: projection.facts,
  };
}