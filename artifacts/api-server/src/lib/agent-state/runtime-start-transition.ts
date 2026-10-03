import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiAgentEffectBundlesTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
} from "@workspace/db";
import {
  invalidateContextSlice,
} from "@workspace/ai-orchestrator";
import { childProcessBindingDigest } from "./child-process-attestation.js";
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
  taskScope?: string;
  beforeObservationIds: readonly string[];
  afterObservationIds: readonly string[];
  evidenceRefs: readonly string[];
  environmentRevision: string | null;
};

export type ApplyChangesTransitionIntent = {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
  proposalId: string;
  goalId: string;
  planRevision: string;
  workerId: string;
  parentWorldRevision: string;
  parentFactRefs: readonly string[];
  beforeObservationIds: readonly string[];
  afterObservationIds: readonly string[];
  evidenceRefs: readonly string[];
  environmentRevision: string | null;
  promotedTreeHash: string;
};

const ACTIVE_EXECUTION_STATUSES = new Set(["queued", "running", "paused", "cancelling"]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function transitionIdempotencyKey(input: RuntimeStartTransitionIntent): string {
  return `runtime.start:${input.executionId}:${input.attempt}:${input.episodeId}:${input.actionId}`;
}

function applyTransitionIdempotencyKey(input: ApplyChangesTransitionIntent): string {
  return `apply.changes:${input.executionId}:${input.attempt}:${input.episodeId}:${input.actionId}:${input.proposalId}:${input.planRevision}`;
}

export async function createPendingApplyChangesTransition(
  input: ApplyChangesTransitionIntent,
): Promise<string> {
  const idempotencyKey = applyTransitionIdempotencyKey(input);
  if (!input.goalId.trim()) throw new Error("apply_transition_goal_required");
  const refs = unique([
    ...input.evidenceRefs,
    `apply-binding:v1:${JSON.stringify({
      proposalId: input.proposalId,
      goalId: input.goalId,
      planRevision: input.planRevision,
      promotedTreeHash: input.promotedTreeHash,
    })}`,
  ]);
  return db.transaction(async (tx) => {
    const [execution] = await tx.select().from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.attempt, input.attempt),
    )).for("update").limit(1);
    if (!execution || execution.status !== "running"
      || execution.workerId !== input.workerId
      || !execution.leaseUntil || execution.leaseUntil <= new Date()) {
      throw new Error("apply_transition_owner_stale");
    }
    const [existing] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      const existingRefs = unique(existing.evidenceRefs as string[]);
      if (
        existing.executionId !== input.executionId
        || existing.attempt !== input.attempt
        || existing.episodeId !== input.episodeId
        || existing.actionId !== input.actionId
        || existing.effectBundleId !== input.effectBundleId
        || existing.parentWorldRevision !== input.parentWorldRevision
        || existing.environmentRevision !== input.environmentRevision
        || JSON.stringify(existing.parentFactRefs) !== JSON.stringify(unique(input.parentFactRefs))
        || JSON.stringify(existing.beforeObservationIds) !== JSON.stringify(unique(input.beforeObservationIds))
        || JSON.stringify(existing.afterObservationIds) !== JSON.stringify(unique(input.afterObservationIds))
        || JSON.stringify(existingRefs) !== JSON.stringify(refs)
      ) throw new Error("apply_transition_idempotency_conflict");
      return existing.id;
    }
    const id = randomUUID();
    await tx.insert(aiWorldTransitionsTable).values({
      id, projectId: input.projectId, executionId: input.executionId,
      attempt: input.attempt, episodeId: input.episodeId, actionId: input.actionId,
      effectBundleId: input.effectBundleId, parentWorldRevision: input.parentWorldRevision,
      taskScope: "project",
      environmentRevisionKey: input.environmentRevision ? `revision:${input.environmentRevision}` : "unknown",
      environmentRevision: input.environmentRevision,
      freshness: "unknown", beforeObservationIds: unique(input.beforeObservationIds),
      afterObservationIds: unique(input.afterObservationIds), materializedObservationIds: [],
      parentFactRefs: unique(input.parentFactRefs), changedFactRefs: [],
      evidenceRefs: refs, status: "pending", idempotencyKey, retryCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
    });
    return id;
  });
}

export async function createPendingRuntimeStartTransition(
  input: RuntimeStartTransitionIntent,
): Promise<string> {
  const idempotencyKey = transitionIdempotencyKey(input);
  const parentFactRefs = unique(input.parentFactRefs);
  const beforeObservationIds = unique(input.beforeObservationIds);
  const afterObservationIds = unique(input.afterObservationIds);
  const evidenceRefs = unique(input.evidenceRefs);
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
        || existing.taskScope !== (input.taskScope ?? "project")
        || existing.environmentRevision !== input.environmentRevision
        || JSON.stringify(existing.parentFactRefs) !== JSON.stringify(parentFactRefs)
        || JSON.stringify(existing.beforeObservationIds) !== JSON.stringify(beforeObservationIds)
        || JSON.stringify(existing.afterObservationIds) !== JSON.stringify(afterObservationIds)
        || JSON.stringify(existing.evidenceRefs) !== JSON.stringify(evidenceRefs)
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
      taskScope: input.taskScope ?? "project",
      environmentRevisionKey: input.environmentRevision
        ? `revision:${input.environmentRevision}`
        : "unknown",
      environmentRevision: input.environmentRevision,
      freshness: "unknown",
      beforeObservationIds,
      afterObservationIds,
      materializedObservationIds: [],
      parentFactRefs,
      changedFactRefs: [],
      evidenceRefs,
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
    const terminalizeBeforeClaim = async (
      failureCode: string,
    ): Promise<RuntimeStartTransitionClaim> => {
      await tx.update(aiWorldTransitionsTable)
        .set({
          status: "terminal_failed",
          failureCode,
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode };
    };
    const [acceptance] = await tx.select({
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    })
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, input.executionId),
        eq(aiExecutionAcceptancesTable.attempt, input.attempt),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      ))
      .limit(1);
    if (!acceptance) {
      const [execution] = await tx.select({
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
      })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, input.executionId),
          eq(aiExecutionsTable.projectId, input.projectId),
        ))
        .limit(1);
      if (
        execution
        && execution.attempt === input.attempt
        && ACTIVE_EXECUTION_STATUSES.has(execution.status)
      ) {
        return { kind: "pending" };
      }
      return terminalizeBeforeClaim("runtime_start_transition_acceptance_missing");
    }
    if (acceptance.effectBundleId !== input.effectBundleId) {
      return terminalizeBeforeClaim("runtime_start_transition_acceptance_effect_bundle_mismatch");
    }
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
    const afterStateValue = directAfterState?.value
      && typeof directAfterState.value === "object"
      && !Array.isArray(directAfterState.value)
      ? directAfterState.value as Record<string, unknown>
      : undefined;
    const runtimeSessionId = typeof afterStateValue?.sessionId === "string"
      ? afterStateValue.sessionId
      : undefined;
    const childProcessObservation = afterRows.find((observation) => (
      observation.sourceType === "child_process_attestation"
      && observation.predicate === "runtime.child_process_environment"
    ));
    const childProcessValue = childProcessObservation?.value
      && typeof childProcessObservation.value === "object"
      && !Array.isArray(childProcessObservation.value)
      ? childProcessObservation.value as Record<string, unknown>
      : undefined;
    const expectedChildBindingDigest = sourceRevision
      && runtimeSessionId
      && acceptance.operationId
      ? childProcessBindingDigest({
          projectId: input.projectId,
          sessionId: runtimeSessionId,
          executionId: input.executionId,
          executionAttempt: input.attempt,
          episodeId: input.episodeId,
          operationId: acceptance.operationId,
          revision: sourceRevision,
        })
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
    if (!childProcessObservation) {
      throw new Error("runtime_start_transition_child_process_attestation_missing");
    }
    if (
      !runtimeSessionId
      || !acceptance.operationId
      || !expectedChildBindingDigest
      || childProcessObservation.sourceId !== `runtime-child-process:${runtimeSessionId}`
      || childProcessObservation.subject !== `runtime:${runtimeSessionId}`
      || childProcessObservation.projectRevision !== sourceRevision
      || childProcessObservation.environmentRevision !== transition.environmentRevision
      || childProcessObservation.freshness !== "fresh"
      || childProcessObservation.environmentFreshness !== "fresh"
      || childProcessObservation.completeness !== "complete"
      || childProcessValue?.status !== "known"
      || childProcessValue.reasonCode !== "child_process_observed"
      || childProcessValue.sessionId !== runtimeSessionId
      || childProcessValue.operationId !== acceptance.operationId
      || childProcessValue.bindingDigest !== expectedChildBindingDigest
      || typeof childProcessValue.attestationDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(childProcessValue.attestationDigest)
      || typeof childProcessValue.processEnvironmentDigest !== "string"
      || !/^[a-f0-9]{64}$/.test(childProcessValue.processEnvironmentDigest)
    ) {
      throw new Error("runtime_start_transition_child_process_attestation_unproven");
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

type ApplyBinding = {
  proposalId: string;
  goalId: string;
  planRevision: string;
  promotedTreeHash: string;
};

function applyBindingFromRefs(refs: unknown): ApplyBinding | undefined {
  if (!Array.isArray(refs)) return undefined;
  const bindingRefs = refs.filter((value): value is string =>
    typeof value === "string" && value.startsWith("apply-binding:v1:"));
  if (bindingRefs.length !== 1) return undefined;
  const ref = bindingRefs[0];
  try {
    const parsed: unknown = JSON.parse(ref.slice("apply-binding:v1:".length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = parsed as Record<string, unknown>;
    return typeof value.proposalId === "string"
      && typeof value.goalId === "string"
      && typeof value.planRevision === "string"
      && typeof value.promotedTreeHash === "string"
      ? {
          proposalId: value.proposalId,
          goalId: value.goalId,
          planRevision: value.planRevision,
          promotedTreeHash: value.promotedTreeHash,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function applyRequirementMatches(value: unknown, expected: {
  proposalId: string;
  baseRevision: string;
  candidateTreeHash: string;
  changeSetHash: string;
}): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const requirement = value as Record<string, unknown>;
  const keys = Object.keys(requirement).sort();
  if (keys.join(",") !== "baseRevision,candidateTreeHash,changeSetHash,from,kind,proposalId,sourceStepId,to,version") {
    return false;
  }
  return requirement.kind === "apply.changes"
    && requirement.version === 1
    && requirement.sourceStepId === "apply-changes"
    && requirement.proposalId === expected.proposalId
    && requirement.baseRevision === expected.baseRevision
    && requirement.candidateTreeHash === expected.candidateTreeHash
    && requirement.changeSetHash === expected.changeSetHash
    && requirement.from === "candidate"
    && requirement.to === "applied";
}

type ApplyTransitionClaim =
  | { kind: "claimed"; transition: typeof aiWorldTransitionsTable.$inferSelect; leaseUntil: Date; binding: ApplyBinding }
  | { kind: "materialized"; worldRevision: string }
  | { kind: "terminal_failed"; failureCode: string }
  | { kind: "pending"; failureCode?: string };

async function claimApplyChangesTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<ApplyTransitionClaim> {
  return db.transaction(async (tx) => {
    const [transition] = await tx.select().from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.projectId, input.projectId),
        eq(aiWorldTransitionsTable.executionId, input.executionId),
        eq(aiWorldTransitionsTable.attempt, input.attempt),
        eq(aiWorldTransitionsTable.episodeId, input.episodeId),
        eq(aiWorldTransitionsTable.actionId, input.actionId),
      )).for("update").limit(1);
    if (!transition || transition.effectBundleId !== input.effectBundleId) {
      throw new Error("apply_transition_identity_missing");
    }
    if (transition.status === "materialized" && transition.resultingWorldRevision) {
      return { kind: "materialized", worldRevision: transition.resultingWorldRevision };
    }
    if (transition.status === "terminal_failed") {
      return { kind: "terminal_failed", failureCode: transition.failureCode ?? "apply_transition_terminal_failed" };
    }
    const binding = applyBindingFromRefs(transition.evidenceRefs);
    if (!binding || !transition.environmentRevision
      || !/^env-v1:[a-f0-9]{64}$/.test(transition.environmentRevision)) {
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: "apply_transition_binding_invalid",
        nextRetryAt: null,
        updatedAt: new Date(),
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: "apply_transition_binding_invalid" };
    }
    const now = new Date();
    const expectedKey = applyTransitionIdempotencyKey({
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      episodeId: input.episodeId,
      actionId: input.actionId,
      effectBundleId: input.effectBundleId,
      proposalId: binding.proposalId,
      goalId: binding.goalId,
      planRevision: binding.planRevision,
      workerId: "",
      parentWorldRevision: transition.parentWorldRevision,
      parentFactRefs: [],
      beforeObservationIds: [],
      afterObservationIds: [],
      evidenceRefs: [],
      environmentRevision: transition.environmentRevision,
      promotedTreeHash: binding.promotedTreeHash,
    });
    if (transition.idempotencyKey !== expectedKey) {
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: "apply_transition_idempotency_key_mismatch",
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: "apply_transition_idempotency_key_mismatch" };
    }
    if (transition.nextRetryAt && transition.nextRetryAt > now) {
      return { kind: "pending", failureCode: transition.failureCode ?? undefined };
    }
    const [execution] = await tx.select({
      status: aiExecutionsTable.status,
      attempt: aiExecutionsTable.attempt,
      goalId: aiExecutionsTable.goalId,
      proposalId: aiExecutionsTable.proposalId,
      operationId: aiExecutionsTable.operationId,
    }).from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
    )).limit(1);
    const [acceptance] = await tx.select({
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
      operationId: aiExecutionAcceptancesTable.operationId,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, input.executionId),
      eq(aiExecutionAcceptancesTable.attempt, input.attempt),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    )).limit(1);
    if (!acceptance) {
      if (execution && execution.attempt === input.attempt && ACTIVE_EXECUTION_STATUSES.has(execution.status)) {
        return { kind: "pending" };
      }
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: "apply_transition_acceptance_missing",
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: "apply_transition_acceptance_missing" };
    }
    if (acceptance.effectBundleId !== input.effectBundleId || acceptance.terminalStatus !== "completed") {
      const code = "apply_transition_acceptance_mismatch";
      await tx.update(aiWorldTransitionsTable).set({ status: "terminal_failed", failureCode: code, nextRetryAt: null, updatedAt: now })
        .where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: code };
    }
    if (!execution || execution.goalId !== binding.goalId || execution.proposalId !== binding.proposalId
      || typeof execution.operationId !== "string" || acceptance.operationId !== execution.operationId) {
      const code = "apply_transition_execution_binding_mismatch";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed", failureCode: code, nextRetryAt: null, updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: code };
    }
    if (!execution || execution.attempt !== input.attempt || execution.status !== "completed") {
      const code = "apply_transition_execution_not_completed";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: code,
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: code };
    }
    const claimed = await tx.update(aiWorldTransitionsTable).set({
      status: "retrying",
      nextRetryAt: new Date(now.getTime() + 60_000),
      updatedAt: now,
    }).where(and(
      eq(aiWorldTransitionsTable.id, transition.id),
      inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
    )).returning({ id: aiWorldTransitionsTable.id });
    if (claimed.length === 0) return { kind: "pending" };
    return { kind: "claimed", transition, leaseUntil: new Date(now.getTime() + 60_000), binding };
  });
}

export async function finalizeApplyChangesTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<{ status: "materialized" | "terminal_failed" | "pending"; worldRevision?: string; failureCode?: string }> {
  const claim = await claimApplyChangesTransition(input);
  if (claim.kind === "materialized") return { status: "materialized", worldRevision: claim.worldRevision };
  if (claim.kind === "terminal_failed") return { status: "terminal_failed", failureCode: claim.failureCode };
  if (claim.kind === "pending") return { status: "pending", ...(claim.failureCode ? { failureCode: claim.failureCode } : {}) };
  const { transition, leaseUntil, binding } = claim;
  try {
    const [proposal] = await db.select().from(aiChangeProposalsTable).where(and(
      eq(aiChangeProposalsTable.id, binding.proposalId),
      eq(aiChangeProposalsTable.projectId, input.projectId),
    )).limit(1);
    const [goal] = await db.select().from(aiGoalsTable).where(and(
      eq(aiGoalsTable.id, binding.goalId),
      eq(aiGoalsTable.projectId, input.projectId),
    )).limit(1);
    const [mission] = goal ? await db.select().from(aiMissionsTable).where(and(
      eq(aiMissionsTable.id, goal.missionId),
      eq(aiMissionsTable.projectId, input.projectId),
    )).limit(1) : [];
    const criteria = goal?.successCriteria;
    const requirement = criteria && typeof criteria === "object" && !Array.isArray(criteria)
      ? (criteria as Record<string, unknown>).applyRequirement
      : undefined;
    const plan = criteria && typeof criteria === "object" && !Array.isArray(criteria)
      ? (criteria as Record<string, unknown>).planRevision
      : undefined;
    const activeRevision = mission?.autonomyPolicy && typeof mission.autonomyPolicy === "object"
      ? (mission.autonomyPolicy as Record<string, unknown>).activePlanRevision
      : undefined;
    if (!proposal || proposal.status !== "applied" || proposal.lifecycle !== "applied"
      || proposal.candidateTreeHash !== binding.promotedTreeHash
      || proposal.promotedTreeHash !== binding.promotedTreeHash
      || !proposal.baseRevision || !proposal.changeSetHash
      || !goal || goal.status !== "waiting_for_event"
      || goal.blockedReason !== "apply_changes_pending"
      || !mission || activeRevision !== binding.planRevision
      || !plan || typeof plan !== "object" || (plan as Record<string, unknown>).hash !== binding.planRevision
      || !applyRequirementMatches(requirement, {
        proposalId: binding.proposalId,
        baseRevision: proposal.baseRevision ?? "",
        candidateTreeHash: proposal.candidateTreeHash ?? "",
        changeSetHash: proposal.changeSetHash ?? "",
      })) {
      throw new Error("apply_transition_goal_or_proposal_mismatch");
    }
    const [bundle] = await db.select({ id: aiAgentEffectBundlesTable.id, verdict: aiAgentEffectBundlesTable.verdict })
      .from(aiAgentEffectBundlesTable).where(and(
        eq(aiAgentEffectBundlesTable.id, input.effectBundleId),
        eq(aiAgentEffectBundlesTable.projectId, input.projectId),
        eq(aiAgentEffectBundlesTable.executionId, input.executionId),
        eq(aiAgentEffectBundlesTable.attempt, input.attempt),
        eq(aiAgentEffectBundlesTable.episodeId, input.episodeId),
      )).limit(1);
    if (!bundle || bundle.verdict !== "OBSERVED") throw new Error("apply_transition_effect_unproven");
    const beforeIds = unique(transition.beforeObservationIds as string[]);
    const afterIds = unique(transition.afterObservationIds as string[]);
    if (!transition.environmentRevision || beforeIds.length === 0 || afterIds.length === 0) {
      throw new Error("apply_transition_observations_missing");
    }
    const observations = await db.select().from(aiAgentObservationsTable).where(and(
      eq(aiAgentObservationsTable.projectId, input.projectId),
      inArray(aiAgentObservationsTable.id, unique([...beforeIds, ...afterIds])),
    ));
    if (observations.length !== unique([...beforeIds, ...afterIds]).length || observations.some((row) =>
      row.executionId !== input.executionId || row.episodeId !== input.episodeId
      || row.provenance !== "DIRECT_OBSERVATION" || row.completeness !== "complete"
      || row.freshness !== "fresh" || row.environmentFreshness !== "fresh"
      || row.environmentRevision !== transition.environmentRevision
      || row.subject !== `project:${input.projectId}`
    )) throw new Error("apply_transition_observations_incomplete");
    const treeValue = (row: typeof observations[number]): string | undefined => {
      if (typeof row.value === "string") return row.value;
      if (row.value && typeof row.value === "object" && !Array.isArray(row.value)
        && typeof (row.value as Record<string, unknown>).treeHash === "string") {
        return (row.value as Record<string, string>).treeHash;
      }
      return undefined;
    };
    const before = observations.find((row) => beforeIds.includes(row.id) && row.predicate === "workspace.tree_hash");
    const after = observations.find((row) => afterIds.includes(row.id) && row.predicate === "workspace.tree_hash");
    if (!before || !after
      || before.projectRevision !== proposal.baseTreeHash
      || before.sourceVersion !== proposal.baseTreeHash
      || after.projectRevision !== binding.promotedTreeHash
      || after.sourceVersion !== binding.promotedTreeHash
      || treeValue(before) !== proposal.baseTreeHash
      || treeValue(after) !== binding.promotedTreeHash) {
      throw new Error("apply_transition_tree_observations_unproven");
    }
    const materialized = await materializeWorldStateForProject(input.projectId, {
      observationIds: unique([...beforeIds, ...afterIds]),
      expectedWorldRevision: transition.parentWorldRevision,
      expectedRevisionExcludeEpisodeIds: [input.episodeId],
    }, async (tx, result) => {
      const materializedObservationIds = unique([...beforeIds, ...afterIds]);
      const selectedObservationIds = new Set(materializedObservationIds);
      const facts = await tx.select({
        id: aiWorldFactsTable.id,
        sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
      }).from(aiWorldFactsTable)
        .where(eq(aiWorldFactsTable.projectId, input.projectId));
      const changedFactRefs = facts
        .filter((fact) => Array.isArray(fact.sourceObservationIds)
          && fact.sourceObservationIds.some((id: unknown) => (
            typeof id === "string" && selectedObservationIds.has(id)
          )))
        .map((fact) => fact.id)
        .sort((left, right) => left.localeCompare(right));
      const changed = await tx.update(aiWorldTransitionsTable).set({
        resultingWorldRevision: result.worldRevision,
        materializedObservationIds,
        changedFactRefs,
        freshness: "fresh",
        status: "materialized",
        failureCode: null,
        nextRetryAt: null,
        materializedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(aiWorldTransitionsTable.id, transition.id),
        eq(aiWorldTransitionsTable.status, "retrying"),
        eq(aiWorldTransitionsTable.nextRetryAt, leaseUntil),
      )).returning({ id: aiWorldTransitionsTable.id });
      if (changed.length === 0) throw new Error("apply_transition_owner_stale");
    });
    try { invalidateContextSlice(input.projectId, "worldState"); } catch { /* projection remains authoritative */ }
    return { status: "materialized", worldRevision: materialized.worldRevision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const retryable = message.includes("parent_revision_mismatch")
      || message.includes("world_state_materialization_failed")
      || message.includes("owner_stale");
    const code = message.startsWith("apply_transition_") ? message.slice(0, 100) : "world_state_materialization_failed";
    if (retryable && transition.retryCount < 8) {
      const scheduled = await markRetryableFailure(transition.id, code, leaseUntil, transition.retryCount);
      if (scheduled) return { status: "pending", failureCode: code };
    }
    const terminalCode = retryable && transition.retryCount >= 8
      ? "world_state_materialization_retry_exhausted"
      : code;
    await markTerminalFailure(transition.id, terminalCode, leaseUntil);
    return { status: "terminal_failed", failureCode: terminalCode };
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
      const [transition] = await db.select({ idempotencyKey: aiWorldTransitionsTable.idempotencyKey })
        .from(aiWorldTransitionsTable).where(and(
          eq(aiWorldTransitionsTable.projectId, candidate.projectId),
          eq(aiWorldTransitionsTable.executionId, candidate.executionId),
          eq(aiWorldTransitionsTable.attempt, candidate.attempt),
          eq(aiWorldTransitionsTable.episodeId, candidate.episodeId),
          eq(aiWorldTransitionsTable.actionId, candidate.actionId),
        )).limit(1);
      const finalize = transition?.idempotencyKey.startsWith("apply.changes:")
        ? finalizeApplyChangesTransition
        : finalizeRuntimeStartTransition;
      await finalize({
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