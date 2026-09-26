import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
} from "@workspace/db";
import {
  invalidateContextSlice,
} from "@workspace/ai-orchestrator";
import { getProjectWorldState, materializeWorldStateForProject } from "./world-state.js";
import { logger } from "../logger.js";

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
    && state.runtimeStatus === "stopped"
    && state.inventoryComplete === true
    && Array.isArray(state.unknownListenerPorts)
    && state.unknownListenerPorts.length === 0
    && state.sessionId === null
    && typeof state.environmentRevision === "string"
    && /^env-v1:[a-f0-9]{64}$/.test(state.environmentRevision)
    && typeof state.observedAt === "string"
    && Number.isFinite(Date.parse(state.observedAt));
}

function validAfterObservation(value: unknown, input: {
  projectId: string;
  sourceRevision: string;
  environmentRevision: string;
}): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.status === "passed"
    && state.runtimeStatus === "running"
    && state.projectId === input.projectId
    && state.revision === input.sourceRevision
    && typeof state.sessionId === "string"
    && state.sessionId.trim().length > 0
    && state.environmentRevision === input.environmentRevision
    && state.processAlive === true
    && state.portReady === true
    && Number.isInteger(state.pid)
    && Number.isInteger(state.port)
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
  leaseUntil: Date,
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
      eq(aiWorldTransitionsTable.status, "retrying"),
      eq(aiWorldTransitionsTable.nextRetryAt, leaseUntil),
    ));
}

async function markRetryableFailure(
  transitionId: string,
  code: string,
  leaseUntil: Date,
  retryCount: number,
): Promise<boolean> {
  const nextRetryAt = new Date(Date.now() + Math.min(10 * 60_000, 15_000 * 2 ** retryCount));
  const updated = await db.update(aiWorldTransitionsTable)
    .set({
      status: "retrying",
      failureCode: code,
      retryCount: retryCount + 1,
      nextRetryAt,
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiWorldTransitionsTable.id, transitionId),
      eq(aiWorldTransitionsTable.status, "retrying"),
      eq(aiWorldTransitionsTable.nextRetryAt, leaseUntil),
    ))
    .returning({ id: aiWorldTransitionsTable.id });
  return updated.length > 0;
}

type RuntimeStartTransitionClaim =
  | { kind: "claimed"; transition: typeof aiWorldTransitionsTable.$inferSelect; leaseUntil: Date }
  | { kind: "materialized"; worldRevision: string }
  | { kind: "terminal_failed"; failureCode: string }
  | { kind: "pending"; failureCode?: string };

async function claimRuntimeStartTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<RuntimeStartTransitionClaim> {
  return db.transaction(async (tx) => {
    const [transition] = await tx.select()
      .from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.projectId, input.projectId),
        eq(aiWorldTransitionsTable.executionId, input.executionId),
        eq(aiWorldTransitionsTable.attempt, input.attempt),
        eq(aiWorldTransitionsTable.episodeId, input.episodeId),
        eq(aiWorldTransitionsTable.actionId, input.actionId),
      ))
      .for("update")
      .limit(1);
    if (!transition || transition.effectBundleId !== input.effectBundleId) {
      throw new Error("runtime_start_transition_identity_missing");
    }
    if (transition.status === "materialized" && transition.resultingWorldRevision) {
      return { kind: "materialized", worldRevision: transition.resultingWorldRevision };
    }
    if (transition.status === "terminal_failed") {
      return {
        kind: "terminal_failed",
        failureCode: transition.failureCode ?? "transition_terminal_failed",
      };
    }
    const now = new Date();
    if (transition.nextRetryAt && transition.nextRetryAt > now) {
      return {
        kind: "pending",
        ...(transition.failureCode ? { failureCode: transition.failureCode } : {}),
      };
    }
    if (transition.retryCount >= 8) {
      await tx.update(aiWorldTransitionsTable)
        .set({
          status: "terminal_failed",
          failureCode: "world_state_materialization_retry_exhausted",
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(and(
          eq(aiWorldTransitionsTable.id, transition.id),
          inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
        ));
      return {
        kind: "terminal_failed",
        failureCode: "world_state_materialization_retry_exhausted",
      };
    }
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claimed = await tx.update(aiWorldTransitionsTable)
      .set({ status: "retrying", nextRetryAt: leaseUntil, updatedAt: now })
      .where(and(
        eq(aiWorldTransitionsTable.id, transition.id),
        inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
      ))
      .returning({ id: aiWorldTransitionsTable.id });
    if (claimed.length === 0) {
      return { kind: "pending" };
    }
    return { kind: "claimed", transition, leaseUntil };
  });
}

export async function finalizeRuntimeStartTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<{
  status: "materialized" | "terminal_failed" | "pending";
  worldRevision?: string;
  failureCode?: string;
}> {
  const claim = await claimRuntimeStartTransition(input);
  if (claim.kind === "materialized") {
    return { status: "materialized", worldRevision: claim.worldRevision };
  }
  if (claim.kind === "terminal_failed") {
    return { status: "terminal_failed", failureCode: claim.failureCode };
  }
  if (claim.kind === "pending") {
    return { status: "pending", ...(claim.failureCode ? { failureCode: claim.failureCode } : {}) };
  }
  const { transition, leaseUntil } = claim;

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
    if (
      !/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)
      || !transition.environmentRevision
      || !/^env-v1:[a-f0-9]{64}$/.test(transition.environmentRevision)
    ) {
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
    const directBeforeState = beforeRows.find((observation) =>
      observation.predicate === "runtime.before_state" && validBeforeObservation(observation.value),
    );
    const beforeValue = directBeforeState?.value as Record<string, unknown> | undefined;
    const sourceRevision = typeof beforeValue?.revision === "string"
      ? beforeValue.revision
      : undefined;
    const directAfterState = sourceRevision
      ? afterRows.find((observation) =>
          observation.predicate === "runtime.after_state"
          && validAfterObservation(observation.value, {
            projectId: input.projectId,
            sourceRevision,
            environmentRevision: transition.environmentRevision!,
          }),
        )
      : undefined;
    if (
      !directBeforeState
      || beforeValue?.projectId !== input.projectId
      || beforeValue?.environmentRevision !== transition.environmentRevision
      || !directAfterState
      || directAfterState.projectRevision !== directBeforeState.projectRevision
      || !afterRows.some((observation) => observation.predicate === "runtime.status" && observation.value === "running")
    ) {
      throw new Error("runtime_start_transition_observations_unproven");
    }

    const materialized = await materializeWorldStateForProject(input.projectId, {
      observationIds,
      expectedWorldRevision: transition.parentWorldRevision,
      expectedRevisionExcludeEpisodeIds: [input.episodeId],
    }, async (tx, result) => {
      const selected = new Set(observationIds);
      const facts = await tx.select({
        id: aiWorldFactsTable.id,
        sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
      }).from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, input.projectId));
      const changedFactRefs = facts
        .filter((fact) => Array.isArray(fact.sourceObservationIds)
          && fact.sourceObservationIds.some((id: unknown) => (
            typeof id === "string" && selected.has(id)
          )))
        .map((fact) => fact.id);
      const updated = await tx.update(aiWorldTransitionsTable)
        .set({
          resultingWorldRevision: result.worldRevision,
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
          eq(aiWorldTransitionsTable.status, "retrying"),
          eq(aiWorldTransitionsTable.nextRetryAt, leaseUntil),
        ))
        .returning({ id: aiWorldTransitionsTable.id });
      if (updated.length === 0) {
        throw new Error("runtime_start_transition_owner_stale");
      }
    });
    try {
      invalidateContextSlice(input.projectId, "worldState");
    } catch (error) {
      logger.warn(
        {
          scope: "runtime-start-transition",
          code: "world_state_context_invalidation_failed",
          executionId: input.executionId,
          attempt: input.attempt,
          episodeId: input.episodeId,
          error,
        },
        "World State materialized but context invalidation failed",
      );
    }
    return { status: "materialized", worldRevision: materialized.worldRevision };
  } catch (error) {
    const code = failureCode(error);
    if (code === "world_state_materialization_failed") {
      const retryScheduled = await markRetryableFailure(
        transition.id,
        code,
        leaseUntil,
        transition.retryCount,
      );
      if (retryScheduled) {
        return { status: "pending", failureCode: code };
      }
    }
    await markTerminalFailure(transition.id, code, leaseUntil);
    return { status: "terminal_failed", failureCode: code };
  }
}

export async function retryPendingRuntimeStartTransitions(limit = 32): Promise<number> {
  const now = new Date();
  const candidates = await db.select({
    projectId: aiWorldTransitionsTable.projectId,
    executionId: aiWorldTransitionsTable.executionId,
    attempt: aiWorldTransitionsTable.attempt,
    episodeId: aiWorldTransitionsTable.episodeId,
    actionId: aiWorldTransitionsTable.actionId,
    effectBundleId: aiWorldTransitionsTable.effectBundleId,
  })
    .from(aiWorldTransitionsTable)
    .where(and(
      inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
      or(
        isNull(aiWorldTransitionsTable.nextRetryAt),
        lte(aiWorldTransitionsTable.nextRetryAt, now),
      ),
    ))
    .orderBy(aiWorldTransitionsTable.createdAt)
    .limit(Math.max(1, Math.min(limit, 100)));

  let attempted = 0;
  for (const candidate of candidates) {
    if (!candidate.effectBundleId) continue;
    try {
      await finalizeRuntimeStartTransition({
        ...candidate,
        effectBundleId: candidate.effectBundleId,
      });
      attempted += 1;
    } catch (error) {
      logger.warn(
        {
          scope: "runtime-start-transition",
          code: "runtime_start_transition_retry_failed",
          executionId: candidate.executionId,
          attempt: candidate.attempt,
          episodeId: candidate.episodeId,
          actionId: candidate.actionId,
          error,
        },
        "Pending runtime start transition retry failed",
      );
    }
  }
  return attempted;
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