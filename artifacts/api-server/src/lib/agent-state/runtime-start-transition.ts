import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentEpisodeEventsTable,
  aiAgentObservationsTable,
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  projectsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  eventsTable,
  db,
} from "@workspace/db";
import {
  ApplyWorldTransitionIntentSchema,
  hashEffectContract,
  invalidateContextSlice,
  parseAgentActionRequestedPayload,
} from "@workspace/ai-orchestrator";
import type { ApplyWorldTransitionIntent } from "@workspace/ai-orchestrator";
import { childProcessBindingDigest } from "./child-process-attestation.js";
import { getProjectWorldState, materializeWorldStateForProject } from "./world-state.js";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  APPLY_CHANGE_EFFECT_ID,
  buildApplyChangeEffectProofExpectation,
  isBoundApplyChangeEffectBundle,
} from "./apply-change-effect.js";
import { logger } from "../logger.js";
import { establishProjectRoot } from "../project-root.js";
import { hashDeliveryTree } from "../delivery-workspace.js";

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

export type GitHubDeliveryTransitionIntent = {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  workerId: string;
  operationId: string;
  proposalId: string;
  remoteUrl: string;
  branch: string;
  parentWorldRevision: string;
  parentFactRefs: readonly string[];
  taskScope: string;
  beforeObservationIds: readonly string[];
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

/**
 * Builds the immutable, server-owned parent binding recorded on ACTION_REQUESTED.
 * Fact references are canonicalized once here; the shared contract enforces
 * uniqueness, bounds, and revision shape before the event is appended.
 */
export function buildApplyChangesWorldTransitionIntent(input: {
  projectId: string;
  proposalId: string;
  goalId: string;
  planRevision: string;
  parentWorldRevision: string;
  parentFactRefs: readonly string[];
}): ApplyWorldTransitionIntent {
  return ApplyWorldTransitionIntentSchema.parse({
    schemaVersion: 1,
    projectId: input.projectId,
    proposalId: input.proposalId,
    goalId: input.goalId,
    planRevision: input.planRevision,
    parentWorldRevision: input.parentWorldRevision,
    parentFactRefs: [...input.parentFactRefs].sort(),
  });
}

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


export type AcceptedApplyTransitionRecoveryResult =
  | { kind: "created" | "existing"; transitionId: string; goalId: string; userId: string }
  | { kind: "blocked"; reason: string };

/**
 * Rebuilds only the missing durable World Transition for an already accepted
 * Mission-linked Apply. This is separate from the live-worker creator: it
 * requires a completed Execution, its exact Acceptance, and the persisted
 * ACTION_REQUESTED parent intent. It never writes project files.
 */
export async function recoverAcceptedApplyChangesTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  proposalId: string;
}): Promise<AcceptedApplyTransitionRecoveryResult> {
  try {
    return await db.transaction(async (tx) => {
      // Materialization locks Project before Execution. Keep the same leading
      // order so recovery cannot deadlock with the existing CAS finalizer.
      const [project] = await tx.select({
        id: projectsTable.id,
        rootPath: projectsTable.rootPath,
      }).from(projectsTable)
        .where(eq(projectsTable.id, input.projectId))
        .for("update")
        .limit(1);
      if (!project) return { kind: "blocked", reason: "apply_recovery_project_missing" } as const;

      const [episodeSnapshot] = await tx.select({
        id: aiAgentEpisodesTable.id,
        missionId: aiAgentEpisodesTable.missionId,
        goalId: aiAgentEpisodesTable.goalId,
      }).from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
        eq(aiAgentEpisodesTable.executionId, input.executionId),
        eq(aiAgentEpisodesTable.attempt, input.attempt),
      )).limit(1);
      if (!episodeSnapshot?.missionId || !episodeSnapshot.goalId) {
        return { kind: "blocked", reason: "apply_recovery_episode_scope_missing" } as const;
      }

      // Match Mission runtime's Mission -> Goal -> Execution lock order.
      const [mission] = await tx.select().from(aiMissionsTable).where(and(
        eq(aiMissionsTable.id, episodeSnapshot.missionId),
        eq(aiMissionsTable.projectId, input.projectId),
      )).for("update").limit(1);
      const [goal] = await tx.select().from(aiGoalsTable).where(and(
        eq(aiGoalsTable.id, episodeSnapshot.goalId),
        eq(aiGoalsTable.missionId, episodeSnapshot.missionId),
        eq(aiGoalsTable.projectId, input.projectId),
      )).for("update").limit(1);
      if (!mission || !goal) {
        return { kind: "blocked", reason: "apply_recovery_mission_scope_missing" } as const;
      }

      const [execution] = await tx.select().from(aiExecutionsTable).where(and(
        eq(aiExecutionsTable.id, input.executionId),
        eq(aiExecutionsTable.projectId, input.projectId),
        eq(aiExecutionsTable.attempt, input.attempt),
      )).for("update").limit(1);
      if (!execution || execution.status !== "completed"
        || execution.goalId !== goal.id || execution.proposalId !== input.proposalId
        || !execution.operationId) {
        return { kind: "blocked", reason: "apply_recovery_execution_binding_invalid" } as const;
      }

      const [acceptance] = await tx.select().from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, input.executionId),
        eq(aiExecutionAcceptancesTable.projectId, input.projectId),
        eq(aiExecutionAcceptancesTable.attempt, input.attempt),
      )).for("update").limit(1);
      if (!acceptance || acceptance.outcome !== "SUCCEEDED"
        || acceptance.terminalStatus !== "completed"
        || acceptance.operationId !== execution.operationId
        || !acceptance.effectBundleId
        || acceptance.candidateIdentity == null) {
        return { kind: "blocked", reason: "apply_recovery_acceptance_unproven" } as const;
      }

      const [episode] = await tx.select().from(aiAgentEpisodesTable).where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
        eq(aiAgentEpisodesTable.executionId, input.executionId),
        eq(aiAgentEpisodesTable.attempt, input.attempt),
        eq(aiAgentEpisodesTable.missionId, mission.id),
        eq(aiAgentEpisodesTable.goalId, goal.id),
      )).for("update").limit(1);
      if (!episode || episode.intentKind !== "APPLY_CHANGES") {
        return { kind: "blocked", reason: "apply_recovery_episode_binding_invalid" } as const;
      }

      const actionEvents = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, input.attempt),
        eq(aiAgentEpisodeEventsTable.episodeId, input.episodeId),
        eq(aiAgentEpisodeEventsTable.eventType, "ACTION_REQUESTED"),
      ));
      const matchingEvents = actionEvents.filter((event) => {
        try {
          const payload = parseAgentActionRequestedPayload(event.payload);
          return payload.action.actionId === input.actionId;
        } catch {
          return false;
        }
      });
      if (matchingEvents.length !== 1) {
        return { kind: "blocked", reason: "apply_recovery_action_event_missing_or_ambiguous" } as const;
      }

      let requestedPayload: ReturnType<typeof parseAgentActionRequestedPayload>;
      try {
        requestedPayload = parseAgentActionRequestedPayload(matchingEvents[0]!.payload);
      } catch {
        return { kind: "blocked", reason: "apply_recovery_action_event_invalid" } as const;
      }
      const action = requestedPayload.action;
      const scope = action.scope && typeof action.scope === "object" && !Array.isArray(action.scope)
        ? action.scope as Record<string, unknown>
        : {};
      const intentResult = ApplyWorldTransitionIntentSchema.safeParse(requestedPayload.worldTransitionIntent);
      if (!intentResult.success) {
        return { kind: "blocked", reason: "apply_recovery_parent_intent_missing_or_invalid" } as const;
      }
      const intent = intentResult.data;
      const actionEventPayload = asRecord(matchingEvents[0]!.payload) ?? {};
      const persistedEffectContract = actionEventPayload.effectContract;
      const expectedEffect = typeof scope.candidateTreeHash === "string"
        ? buildApplyChangeEffectProofExpectation({
            executionId: input.executionId,
            attempt: input.attempt,
            proposalId: input.proposalId,
            candidateTreeHash: scope.candidateTreeHash,
          })
        : undefined;
      let persistedEffectContractHash: string | undefined;
      try {
        if (persistedEffectContract && typeof persistedEffectContract === "object"
          && !Array.isArray(persistedEffectContract)) {
          persistedEffectContractHash = hashEffectContract(persistedEffectContract as Parameters<typeof hashEffectContract>[0]);
        }
      } catch {
        persistedEffectContractHash = undefined;
      }
      if (
        action.episodeId !== episode.id
        || action.capabilityId !== APPLY_CHANGE_CAPABILITY_ID
        || action.expectedEffects.length !== 1
        || action.expectedEffects[0] !== APPLY_CHANGE_EFFECT_ID
        || scope.projectId !== input.projectId
        || scope.proposalId !== input.proposalId
        || scope.attemptId !== execution.operationId
        || typeof scope.operationId !== "string"
        || typeof scope.baseTreeHash !== "string"
        || typeof scope.candidateTreeHash !== "string"
        || typeof scope.changeSetHash !== "string"
        || typeof scope.sourceRevision !== "string"
        || !Array.isArray(scope.approvedPaths)
        || scope.approvedPaths.length === 0
        || new Set(scope.approvedPaths).size !== scope.approvedPaths.length
        || !expectedEffect
        || persistedEffectContractHash !== expectedEffect.effectContractHash
        || intent.projectId !== input.projectId
        || intent.proposalId !== input.proposalId
        || intent.goalId !== goal.id
        || intent.planRevision !== episode.planRevision
        || intent.parentWorldRevision !== episode.worldRevision
      ) {
        return { kind: "blocked", reason: "apply_recovery_action_or_intent_binding_invalid" } as const;
      }

      const [proposal] = await tx.select().from(aiChangeProposalsTable).where(and(
        eq(aiChangeProposalsTable.id, input.proposalId),
        eq(aiChangeProposalsTable.projectId, input.projectId),
      )).for("update").limit(1);
      const criteria = goal.successCriteria && typeof goal.successCriteria === "object" && !Array.isArray(goal.successCriteria)
        ? goal.successCriteria as Record<string, unknown>
        : {};
      const outcome = goal.outcomeContract && typeof goal.outcomeContract === "object" && !Array.isArray(goal.outcomeContract)
        ? goal.outcomeContract as Record<string, unknown>
        : {};
      const criteriaPlan = criteria.planRevision && typeof criteria.planRevision === "object" && !Array.isArray(criteria.planRevision)
        ? criteria.planRevision as Record<string, unknown>
        : {};
      const outcomePlan = outcome.planRevision && typeof outcome.planRevision === "object" && !Array.isArray(outcome.planRevision)
        ? outcome.planRevision as Record<string, unknown>
        : {};
      const autonomyPolicy = mission.autonomyPolicy && typeof mission.autonomyPolicy === "object" && !Array.isArray(mission.autonomyPolicy)
        ? mission.autonomyPolicy as Record<string, unknown>
        : {};
      const activePlanRevision = autonomyPolicy.activePlanRevision;
      const applyMission = autonomyPolicy.applyMission && typeof autonomyPolicy.applyMission === "object"
        && !Array.isArray(autonomyPolicy.applyMission)
        ? autonomyPolicy.applyMission as Record<string, unknown>
        : {};
      if (
        !proposal
        || proposal.status !== "applied"
        || !["applied", "blocked"].includes(proposal.lifecycle)
        || proposal.operationId !== scope.operationId
        || proposal.baseRevision !== scope.sourceRevision
        || proposal.baseTreeHash !== scope.baseTreeHash
        || proposal.candidateTreeHash !== scope.candidateTreeHash
        || proposal.changeSetHash !== scope.changeSetHash
        || proposal.promotedTreeHash !== scope.candidateTreeHash
        || execution.operationId !== scope.attemptId
        || execution.workspaceRoot == null
        || acceptance.sourceRevision !== proposal.baseRevision
        || acceptance.candidateIdentity !== (proposal.id + ":" + proposal.candidateTreeHash)
        || intent.planRevision !== activePlanRevision
        || criteriaPlan.hash !== intent.planRevision
        || outcomePlan.hash !== intent.planRevision
        || episode.planRevision !== intent.planRevision
        || applyMission.proposalId !== proposal.id
        || applyMission.proposalRevision !== proposal.revision
        || applyMission.baseTreeHash !== proposal.baseTreeHash
        || applyMission.operationId !== proposal.operationId
        || applyMission.candidateIdentity !== (proposal.id + ":" + proposal.candidateTreeHash)
        || applyMission.baseRevision !== proposal.baseRevision
        || applyMission.candidateTreeHash !== proposal.candidateTreeHash
        || applyMission.changeSetHash !== proposal.changeSetHash
        || !applyRequirementMatches(applyMission.requirement, {
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision ?? "",
          candidateTreeHash: proposal.candidateTreeHash ?? "",
          changeSetHash: proposal.changeSetHash ?? "",
        })
        || !applyRequirementMatches(criteria.applyRequirement, {
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision ?? "",
          candidateTreeHash: proposal.candidateTreeHash ?? "",
          changeSetHash: proposal.changeSetHash ?? "",
        })
        || !applyRequirementMatches(outcome.applyRequirement, {
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision ?? "",
          candidateTreeHash: proposal.candidateTreeHash ?? "",
          changeSetHash: proposal.changeSetHash ?? "",
        })
      ) {
        return { kind: "blocked", reason: "apply_recovery_proposal_or_plan_binding_invalid" } as const;
      }

      if (goal.status === "needs_replan" && goal.blockedReason === "apply_transition_missing") {
        if (!["needs_replan", "waiting"].includes(mission.status)) {
          return { kind: "blocked", reason: "apply_recovery_mission_not_recoverable" } as const;
        }
        const missionGoals = await tx.select({
          id: aiGoalsTable.id,
          status: aiGoalsTable.status,
          blockedReason: aiGoalsTable.blockedReason,
        }).from(aiGoalsTable).where(and(
          eq(aiGoalsTable.missionId, mission.id),
          eq(aiGoalsTable.projectId, input.projectId),
        )).for("update");
        const otherBlockers = missionGoals.filter((candidate) =>
          candidate.id !== goal.id
          && ["needs_replan", "blocked", "failed", "cancelled"].includes(candidate.status)
        );
        if (otherBlockers.length > 0) {
          return { kind: "blocked", reason: "apply_recovery_other_mission_blocker_present" } as const;
        }
      } else if (goal.status !== "waiting_for_event" || goal.blockedReason !== "apply_changes_pending") {
        return { kind: "blocked", reason: "apply_recovery_goal_not_pending" } as const;
      }
      if (mission.status === "blocked" || mission.status === "failed" || mission.status === "completed"
        || (goal.status === "waiting_for_event" && mission.status === "needs_replan")) {
        return { kind: "blocked", reason: "apply_recovery_mission_operator_or_terminal_state" } as const;
      }

      const root = await establishProjectRoot(project.rootPath);
      if (!root.ok || root.canonicalPath !== execution.workspaceRoot) {
        return { kind: "blocked", reason: "apply_recovery_project_root_binding_invalid" } as const;
      }
      const liveTreeHash = await hashDeliveryTree(root.canonicalPath).catch(() => null);
      if (!liveTreeHash || liveTreeHash !== proposal.candidateTreeHash) {
        return { kind: "blocked", reason: "apply_recovery_live_tree_mismatch" } as const;
      }

      const beforeSourceId = "apply:" + input.executionId + ":" + input.attempt + ":before:live-tree";
      const afterSourceId = "apply:" + input.executionId + ":" + input.attempt + ":after:live-tree";
      const worldObservations = await tx.select().from(aiAgentObservationsTable).where(and(
        eq(aiAgentObservationsTable.projectId, input.projectId),
        eq(aiAgentObservationsTable.executionId, input.executionId),
        eq(aiAgentObservationsTable.episodeId, input.episodeId),
        inArray(aiAgentObservationsTable.sourceId, [beforeSourceId, afterSourceId]),
      ));
      const beforeRows = worldObservations.filter((row) => row.sourceId === beforeSourceId);
      const afterRows = worldObservations.filter((row) => row.sourceId === afterSourceId);
      if (beforeRows.length !== 1 || afterRows.length !== 1) {
        return { kind: "blocked", reason: "apply_recovery_world_observations_missing_or_ambiguous" } as const;
      }
      const before = beforeRows[0]!;
      const after = afterRows[0]!;
      const environmentRevision = before.environmentRevision;
      if (
        !environmentRevision
        || !/^env-v1:[a-f0-9]{64}$/.test(environmentRevision)
        || after.environmentRevision !== environmentRevision
        || [before, after].some((row) =>
          row.provenance !== "DIRECT_OBSERVATION"
          || row.completeness !== "complete"
          || row.freshness !== "fresh"
          || row.environmentFreshness !== "fresh"
          || row.taskScope !== "project"
          || row.subject !== ("project:" + input.projectId)
          || row.predicate !== "workspace.tree_hash"
        )
        || before.observationRole !== "before"
        || after.observationRole !== "after"
        || before.projectRevision !== proposal.baseTreeHash
        || before.sourceVersion !== proposal.baseTreeHash
        || before.value !== proposal.baseTreeHash
        || after.projectRevision !== proposal.candidateTreeHash
        || after.sourceVersion !== proposal.candidateTreeHash
        || after.value !== proposal.candidateTreeHash
      ) {
        return { kind: "blocked", reason: "apply_recovery_world_observation_binding_invalid" } as const;
      }

      const [bundle] = await tx.select().from(aiAgentEffectBundlesTable).where(and(
        eq(aiAgentEffectBundlesTable.id, acceptance.effectBundleId),
        eq(aiAgentEffectBundlesTable.projectId, input.projectId),
        eq(aiAgentEffectBundlesTable.executionId, input.executionId),
        eq(aiAgentEffectBundlesTable.attempt, input.attempt),
        eq(aiAgentEffectBundlesTable.episodeId, input.episodeId),
      )).for("update").limit(1);
      const effectIds = Array.isArray(bundle?.effectIds)
        ? bundle.effectIds.filter((value): value is string => typeof value === "string")
        : [];
      const effects = effectIds.length > 0
        ? await tx.select().from(aiAgentEffectsTable).where(and(
            eq(aiAgentEffectsTable.projectId, input.projectId),
            eq(aiAgentEffectsTable.executionId, input.executionId),
            eq(aiAgentEffectsTable.attempt, input.attempt),
            eq(aiAgentEffectsTable.episodeId, input.episodeId),
            inArray(aiAgentEffectsTable.id, effectIds),
          )).for("update")
        : [];
      if (!bundle || !isBoundApplyChangeEffectBundle({
        bundle,
        effects,
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        episodeId: input.episodeId,
        actionId: input.actionId,
        proposalId: input.proposalId,
        candidateTreeHash: proposal.candidateTreeHash!,
      })) {
        return { kind: "blocked", reason: "apply_recovery_effect_bundle_unproven" } as const;
      }

      // This uses the same exclusion rule as the original capture. The Project
      // row lock serializes the read against World State materialization.
      const currentParent = await getProjectWorldState(input.projectId, {
        excludeEpisodeIds: [input.episodeId],
      }, tx);
      const currentFactRefs = currentParent.facts.map((fact) => fact.id).sort();
      if (
        currentParent.worldRevision !== intent.parentWorldRevision
        || JSON.stringify(currentFactRefs) !== JSON.stringify(intent.parentFactRefs)
      ) {
        return { kind: "blocked", reason: "apply_recovery_parent_snapshot_changed" } as const;
      }

      const idempotencyKey = applyTransitionIdempotencyKey({
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        episodeId: input.episodeId,
        actionId: input.actionId,
        effectBundleId: acceptance.effectBundleId,
        proposalId: input.proposalId,
        goalId: goal.id,
        planRevision: intent.planRevision,
        workerId: "",
        parentWorldRevision: intent.parentWorldRevision,
        parentFactRefs: intent.parentFactRefs,
        beforeObservationIds: [before.id],
        afterObservationIds: [after.id],
        evidenceRefs: [],
        environmentRevision,
        promotedTreeHash: proposal.candidateTreeHash!,
      });
      const bindingRef = "apply-binding:v1:" + JSON.stringify({
        proposalId: input.proposalId,
        goalId: goal.id,
        planRevision: intent.planRevision,
        promotedTreeHash: proposal.candidateTreeHash,
      });
      const evidenceRefs = unique([
        "apply:" + input.executionId + ":" + input.attempt + ":before",
        "apply:" + input.executionId + ":" + input.attempt + ":after",
        before.id,
        after.id,
        bindingRef,
      ]);

      const sameAttemptRows = await tx.select().from(aiWorldTransitionsTable).where(and(
        eq(aiWorldTransitionsTable.projectId, input.projectId),
        eq(aiWorldTransitionsTable.executionId, input.executionId),
        eq(aiWorldTransitionsTable.attempt, input.attempt),
      )).for("update");
      if (sameAttemptRows.length > 0) {
        const existing = sameAttemptRows.find((row) => row.idempotencyKey === idempotencyKey);
        if (
          sameAttemptRows.length !== 1
          || !existing
          || existing.episodeId !== input.episodeId
          || existing.actionId !== input.actionId
          || existing.effectBundleId !== acceptance.effectBundleId
          || existing.parentWorldRevision !== intent.parentWorldRevision
          || existing.environmentRevision !== environmentRevision
          || JSON.stringify(existing.parentFactRefs) !== JSON.stringify(intent.parentFactRefs)
          || JSON.stringify(existing.beforeObservationIds) !== JSON.stringify([before.id])
          || JSON.stringify(existing.afterObservationIds) !== JSON.stringify([after.id])
          || JSON.stringify(unique(existing.evidenceRefs as string[])) !== JSON.stringify(evidenceRefs)
        ) {
          return { kind: "blocked", reason: "apply_recovery_existing_transition_conflict" } as const;
        }
        return { kind: "existing", transitionId: existing.id, goalId: goal.id, userId: mission.userId } as const;
      }

      const transitionId = randomUUID();
      await tx.insert(aiWorldTransitionsTable).values({
        id: transitionId,
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        episodeId: input.episodeId,
        actionId: input.actionId,
        effectBundleId: acceptance.effectBundleId,
        parentWorldRevision: intent.parentWorldRevision,
        taskScope: "project",
        environmentRevisionKey: "revision:" + environmentRevision,
        environmentRevision,
        freshness: "unknown",
        beforeObservationIds: [before.id],
        afterObservationIds: [after.id],
        materializedObservationIds: [],
        parentFactRefs: intent.parentFactRefs,
        changedFactRefs: [],
        evidenceRefs,
        status: "pending",
        idempotencyKey,
        retryCount: 0,
        failureCode: null,
        nextRetryAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (goal.status === "needs_replan" && goal.blockedReason === "apply_transition_missing") {
        await tx.update(aiGoalsTable).set({
          status: "waiting_for_event",
          blockedReason: "apply_changes_pending",
          nextWakeAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(aiGoalsTable.id, goal.id),
          eq(aiGoalsTable.status, "needs_replan"),
          eq(aiGoalsTable.blockedReason, "apply_transition_missing"),
        ));
        if (mission.status === "needs_replan") {
          await tx.update(aiMissionsTable).set({
            status: "waiting",
            updatedAt: new Date(),
          }).where(and(
            eq(aiMissionsTable.id, mission.id),
            eq(aiMissionsTable.status, "needs_replan"),
          ));
        }
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiGoalApplyChangesTransitionRecoveryQueued",
          projectId: input.projectId,
          goalId: goal.id,
          severity: "info",
          message: "An accepted Apply Changes World Transition was reconstructed from its original snapshot and retained proof.",
          payload: {
            missionId: mission.id,
            executionId: input.executionId,
            attempt: input.attempt,
            episodeId: input.episodeId,
            transitionId,
            planRevision: intent.planRevision,
            parentWorldRevision: intent.parentWorldRevision,
            recoverySource: "accepted_apply_snapshot_intent",
            noFilesystemWrites: true,
          },
        });
      }

      return { kind: "created", transitionId, goalId: goal.id, userId: mission.userId } as const;
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "apply_recovery_unexpected";
    logger.warn({
      scope: "apply-transition-recovery",
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      episodeId: input.episodeId,
      reason: code.slice(0, 120),
    }, "accepted Apply Changes transition recovery failed closed");
    return { kind: "blocked", reason: "apply_recovery_transaction_failed" };
  }
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

function githubDeliveryTransitionKey(input: Pick<GitHubDeliveryTransitionIntent, "executionId" | "operationId">): string {
  return `github.delivery:${input.executionId}:${input.operationId}`;
}

function githubDeliveryBindingRef(input: Pick<GitHubDeliveryTransitionIntent, "operationId" | "proposalId" | "remoteUrl" | "branch">): string {
  return `github-delivery-binding:v1:${JSON.stringify({
    operationId: input.operationId,
    proposalId: input.proposalId,
    remoteUrl: input.remoteUrl,
    branch: input.branch,
  })}`;
}

function parseGitHubDeliveryBinding(refs: unknown): {
  operationId: string;
  proposalId: string;
  remoteUrl: string;
  branch: string;
} | undefined {
  if (!Array.isArray(refs)) return undefined;
  const candidates = refs.filter((value): value is string =>
    typeof value === "string" && value.startsWith("github-delivery-binding:v1:"));
  if (candidates.length !== 1) return undefined;
  try {
    const parsed: unknown = JSON.parse(candidates[0]!.slice("github-delivery-binding:v1:".length));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = parsed as Record<string, unknown>;
    return typeof value.operationId === "string"
      && typeof value.proposalId === "string"
      && typeof value.remoteUrl === "string"
      && typeof value.branch === "string"
      ? {
          operationId: value.operationId,
          proposalId: value.proposalId,
          remoteUrl: value.remoteUrl,
          branch: value.branch,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function createPendingGitHubDeliveryTransition(
  input: GitHubDeliveryTransitionIntent,
): Promise<string> {
  const idempotencyKey = githubDeliveryTransitionKey(input);
  const bindingRef = githubDeliveryBindingRef(input);
  const beforeObservationIds = unique(input.beforeObservationIds);
  if (
    !/^[a-f0-9]{64}$/.test(input.parentWorldRevision)
    || beforeObservationIds.length !== 1
    || !input.operationId
    || !input.proposalId
    || !input.remoteUrl
    || !input.branch
  ) {
    throw new Error("github_delivery_transition_intent_invalid");
  }
  return db.transaction(async (tx) => {
    const [execution] = await tx.select().from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.attempt, input.attempt),
    )).for("update").limit(1);
    if (
      !execution || execution.status !== "running" || execution.workerId !== input.workerId
      || !execution.leaseUntil || execution.leaseUntil <= new Date()
    ) {
      throw new Error("github_delivery_transition_owner_stale");
    }
    const [existing] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.idempotencyKey, idempotencyKey),
    )).for("update").limit(1);
    if (existing) {
      const binding = parseGitHubDeliveryBinding(existing.evidenceRefs);
      if (
        existing.executionId !== input.executionId
        || !binding
        || JSON.stringify(binding) !== JSON.stringify({
          operationId: input.operationId,
          proposalId: input.proposalId,
          remoteUrl: input.remoteUrl,
          branch: input.branch,
        })
      ) {
        throw new Error("github_delivery_transition_idempotency_conflict");
      }
      if (existing.status === "terminal_failed") {
        throw new Error("github_delivery_transition_already_terminal");
      }
      return existing.id;
    }
    const id = randomUUID();
    await tx.insert(aiWorldTransitionsTable).values({
      id,
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      episodeId: input.episodeId,
      actionId: input.actionId,
      effectBundleId: null,
      parentWorldRevision: input.parentWorldRevision,
      taskScope: input.taskScope,
      environmentRevisionKey: "unknown",
      environmentRevision: null,
      freshness: "unknown",
      beforeObservationIds,
      afterObservationIds: [],
      materializedObservationIds: [],
      parentFactRefs: unique(input.parentFactRefs),
      changedFactRefs: [],
      evidenceRefs: [bindingRef, `github-delivery-before:v1:${beforeObservationIds[0]}`],
      status: "pending",
      idempotencyKey,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  });
}

export async function bindGitHubDeliveryTransitionEffect(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
  workerId: string;
  operationId: string;
  afterObservationIds: readonly string[];
}): Promise<string | undefined> {
  const afterObservationIds = unique(input.afterObservationIds);
  if (!input.effectBundleId || afterObservationIds.length !== 1) {
    throw new Error("github_delivery_transition_after_state_missing");
  }
  return db.transaction(async (tx) => {
    const [execution] = await tx.select().from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.attempt, input.attempt),
    )).for("update").limit(1);
    if (
      !execution || execution.status !== "running" || execution.workerId !== input.workerId
      || !execution.leaseUntil || execution.leaseUntil <= new Date()
    ) {
      throw new Error("github_delivery_transition_owner_stale");
    }
    const [transition] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.idempotencyKey, `github.delivery:${input.executionId}:${input.operationId}`),
    )).for("update").limit(1);
    if (!transition) return undefined;
    const binding = parseGitHubDeliveryBinding(transition.evidenceRefs);
    if (!binding || binding.operationId !== input.operationId) {
      throw new Error("github_delivery_transition_binding_invalid");
    }
    if (transition.status === "materialized") return undefined;
    if (transition.status === "terminal_failed" || unique(transition.beforeObservationIds as string[]).length !== 1) {
      throw new Error("github_delivery_transition_not_rebindable");
    }
    const updated = await tx.update(aiWorldTransitionsTable).set({
      attempt: input.attempt,
      episodeId: input.episodeId,
      actionId: input.actionId,
      effectBundleId: input.effectBundleId,
      afterObservationIds,
      status: "pending",
      failureCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, transition.id))
      .returning({ id: aiWorldTransitionsTable.id });
    return updated[0]?.id;
  });
}

export async function terminalizeUnmutatedGitHubDeliveryTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  operationId: string;
  workerId: string;
  failureCode: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [execution] = await tx.select().from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.attempt, input.attempt),
    )).for("update").limit(1);
    if (
      !execution || execution.status !== "running" || execution.workerId !== input.workerId
      || !execution.leaseUntil || execution.leaseUntil <= new Date()
    ) return;
    const [transition] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.idempotencyKey, `github.delivery:${input.executionId}:${input.operationId}`),
    )).for("update").limit(1);
    if (!transition || transition.effectBundleId || transition.status === "materialized") return;
    await tx.update(aiWorldTransitionsTable).set({
      status: "terminal_failed",
      failureCode: input.failureCode.slice(0, 80),
      nextRetryAt: null,
      updatedAt: new Date(),
    }).where(eq(aiWorldTransitionsTable.id, transition.id));
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

type GitHubDeliveryTransitionClaim =
  | { kind: "claimed"; transition: typeof aiWorldTransitionsTable.$inferSelect; leaseUntil: Date }
  | { kind: "materialized"; worldRevision: string }
  | { kind: "terminal_failed"; failureCode: string }
  | { kind: "pending"; failureCode?: string };

function githubDeliveryRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validCredentialFreeGitHubRemote(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname.split("/").filter(Boolean).length === 2;
  } catch {
    return false;
  }
}

async function claimGitHubDeliveryTransition(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
}): Promise<GitHubDeliveryTransitionClaim> {
  return db.transaction(async (tx) => {
    const [transition] = await tx.select().from(aiWorldTransitionsTable).where(and(
      eq(aiWorldTransitionsTable.projectId, input.projectId),
      eq(aiWorldTransitionsTable.executionId, input.executionId),
      eq(aiWorldTransitionsTable.attempt, input.attempt),
      eq(aiWorldTransitionsTable.episodeId, input.episodeId),
      eq(aiWorldTransitionsTable.actionId, input.actionId),
    )).for("update").limit(1);
    if (!transition || transition.effectBundleId !== input.effectBundleId) {
      throw new Error("github_delivery_transition_identity_missing");
    }
    if (transition.status === "materialized" && transition.resultingWorldRevision) {
      return { kind: "materialized", worldRevision: transition.resultingWorldRevision };
    }
    if (transition.status === "terminal_failed") {
      return {
        kind: "terminal_failed",
        failureCode: transition.failureCode ?? "github_delivery_transition_terminal_failed",
      };
    }
    const binding = parseGitHubDeliveryBinding(transition.evidenceRefs);
    if (!binding || transition.idempotencyKey !== githubDeliveryTransitionKey({
      executionId: input.executionId,
      operationId: binding.operationId,
    })) {
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: "github_delivery_transition_binding_invalid",
        nextRetryAt: null,
        updatedAt: new Date(),
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: "github_delivery_transition_binding_invalid" };
    }
    const now = new Date();
    const [acceptance] = await tx.select({
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      operationId: aiExecutionAcceptancesTable.operationId,
    }).from(aiExecutionAcceptancesTable).where(and(
      eq(aiExecutionAcceptancesTable.executionId, input.executionId),
      eq(aiExecutionAcceptancesTable.attempt, input.attempt),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    )).limit(1);
    if (!acceptance) {
      const [execution] = await tx.select({
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
      }).from(aiExecutionsTable).where(and(
        eq(aiExecutionsTable.id, input.executionId),
        eq(aiExecutionsTable.projectId, input.projectId),
      )).limit(1);
      if (execution && execution.attempt > input.attempt) {
        await tx.update(aiWorldTransitionsTable).set({
          status: "retrying",
          failureCode: "github_delivery_transition_awaiting_retry_binding",
          nextRetryAt: new Date(now.getTime() + 60_000),
          updatedAt: now,
        }).where(eq(aiWorldTransitionsTable.id, transition.id));
        return { kind: "pending", failureCode: "github_delivery_transition_awaiting_retry_binding" };
      }
      if (
        execution
        && execution.attempt === input.attempt
        && ACTIVE_EXECUTION_STATUSES.has(execution.status)
      ) return { kind: "pending" };
      const failureCode = "github_delivery_transition_acceptance_missing";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode,
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode };
    }
    if (
      acceptance.effectBundleId !== input.effectBundleId
      || acceptance.operationId !== binding.operationId
    ) {
      const failureCode = "github_delivery_transition_acceptance_binding_mismatch";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode,
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode };
    }
    if (transition.nextRetryAt && transition.nextRetryAt > now) {
      return {
        kind: "pending",
        ...(transition.failureCode ? { failureCode: transition.failureCode } : {}),
      };
    }
    if (transition.retryCount >= 8) {
      const failureCode = "world_state_materialization_retry_exhausted";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode,
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode };
    }
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claimed = await tx.update(aiWorldTransitionsTable).set({
      status: "retrying",
      nextRetryAt: leaseUntil,
      updatedAt: now,
    }).where(and(
      eq(aiWorldTransitionsTable.id, transition.id),
      inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
    )).returning({ id: aiWorldTransitionsTable.id });
    return claimed.length > 0
      ? { kind: "claimed", transition, leaseUntil }
      : { kind: "pending" };
  });
}

export async function finalizeGitHubDeliveryTransition(input: {
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
  const claim = await claimGitHubDeliveryTransition(input);
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
    const binding = parseGitHubDeliveryBinding(transition.evidenceRefs);
    if (!binding || !validCredentialFreeGitHubRemote(binding.remoteUrl) || !binding.branch.trim()) {
      throw new Error("github_delivery_transition_binding_invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)) {
      throw new Error("github_delivery_transition_parent_unavailable");
    }
    const [acceptance] = await db.select()
      .from(aiExecutionAcceptancesTable).where(and(
        eq(aiExecutionAcceptancesTable.executionId, input.executionId),
        eq(aiExecutionAcceptancesTable.attempt, input.attempt),
        eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
      )).limit(1);
    if (
      !acceptance
      || acceptance.effectBundleId !== input.effectBundleId
      || acceptance.operationId !== binding.operationId
    ) throw new Error("github_delivery_transition_acceptance_missing");

    const beforeObservationIds = unique(transition.beforeObservationIds as string[]);
    const afterObservationIds = unique(transition.afterObservationIds as string[]);
    if (beforeObservationIds.length !== 1 || afterObservationIds.length !== 1) {
      throw new Error("github_delivery_transition_observations_missing");
    }
    const observationIds = unique([...beforeObservationIds, ...afterObservationIds]);
    const observations = await db.select().from(aiAgentObservationsTable).where(and(
      eq(aiAgentObservationsTable.projectId, input.projectId),
      inArray(aiAgentObservationsTable.id, observationIds),
    ));
    if (observations.length !== observationIds.length || observations.some((observation) => (
      observation.executionId !== input.executionId
      || observation.provenance !== "DIRECT_OBSERVATION"
      || observation.completeness !== "complete"
      || observation.freshness !== "fresh"
      || observation.environmentFreshness === "stale"
    ))) throw new Error("github_delivery_transition_observations_incomplete");

    const beforeObservation = observations.find((observation) => beforeObservationIds.includes(observation.id));
    const afterObservation = observations.find((observation) => afterObservationIds.includes(observation.id));
    if (!beforeObservation || !afterObservation) {
      throw new Error("github_delivery_transition_observations_missing");
    }
    const episodeIds = unique([beforeObservation.episodeId, afterObservation.episodeId]);
    const episodes = await db.select({
      id: aiAgentEpisodesTable.id,
      projectId: aiAgentEpisodesTable.projectId,
      executionId: aiAgentEpisodesTable.executionId,
      attempt: aiAgentEpisodesTable.attempt,
    }).from(aiAgentEpisodesTable).where(and(
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      inArray(aiAgentEpisodesTable.id, episodeIds),
    ));
    const beforeEpisode = episodes.find((episode) => episode.id === beforeObservation.episodeId);
    const afterEpisode = episodes.find((episode) => episode.id === afterObservation.episodeId);
    if (
      episodes.length !== episodeIds.length
      || episodes.some((episode) => episode.executionId !== input.executionId)
      || !beforeEpisode
      || !afterEpisode
      || beforeEpisode.attempt > input.attempt
      || afterEpisode.attempt !== input.attempt
      || afterEpisode.id !== input.episodeId
      || transition.episodeId !== input.episodeId
    ) throw new Error("github_delivery_transition_episode_binding_mismatch");

    const before = githubDeliveryRecord(beforeObservation.value);
    const after = githubDeliveryRecord(afterObservation.value);
    const sameIdentity = (state: Record<string, unknown>, episodeAttempt: number) => (
      state.projectId === input.projectId
      && state.operationId === binding.operationId
      && state.executionId === input.executionId
      && state.executionAttempt === episodeAttempt
      && state.proposalId === binding.proposalId
      && state.remoteUrl === binding.remoteUrl
      && state.branch === binding.branch
      && typeof state.sourceRevision === "string"
      && state.sourceRevision.length > 0
      && typeof state.expectedCommitHash === "string"
      && typeof state.expectedParentHash === "string"
      && typeof state.expectedTreeHash === "string"
      && typeof state.observedAt === "string"
      && Number.isFinite(Date.parse(state.observedAt))
    );
    if (
      !before || !after
      || beforeObservation.predicate !== "delivery.remote_branch_state"
      || afterObservation.predicate !== "delivery.remote_branch_state"
      || beforeObservation.subject !== `github:${binding.remoteUrl}:${binding.branch}`
      || afterObservation.subject !== beforeObservation.subject
      || beforeObservation.projectRevision !== before.remoteCommitHash
      || afterObservation.projectRevision !== after.remoteCommitHash
      || !sameIdentity(before, beforeEpisode.attempt)
      || !sameIdentity(after, afterEpisode.attempt)
      || before.status !== "observed"
      || before.remoteCommitHash !== before.expectedParentHash
      || before.remoteTreeHash !== before.expectedParentTreeHash
      || before.expectedParentHash !== after.expectedParentHash
      || before.expectedCommitHash !== after.expectedCommitHash
      || before.expectedTreeHash !== after.expectedTreeHash
      || before.sourceRevision !== after.sourceRevision
      || after.status !== "passed"
      || after.remoteCommitHash !== after.expectedCommitHash
      || after.remoteParentHash !== after.expectedParentHash
      || after.remoteTreeHash !== after.expectedTreeHash
      || after.remoteParentCount !== 1
      || after.markerMatched !== true
      || after.operationMarker !== `EngineeringOS-Operation: ${binding.operationId}`
      || after.candidateTreeHash !== after.committedTreeHash
    ) throw new Error("github_delivery_transition_observations_unproven");

    const materialized = await materializeWorldStateForProject(input.projectId, {
      observationIds,
      expectedWorldRevision: transition.parentWorldRevision,
      expectedRevisionExcludeEpisodeIds: episodeIds,
    }, async (tx, result) => {
      const selected = new Set(observationIds);
      const facts = await tx.select({
        id: aiWorldFactsTable.id,
        sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
      }).from(aiWorldFactsTable).where(eq(aiWorldFactsTable.projectId, input.projectId));
      const changedFactRefs = facts.filter((fact) =>
        Array.isArray(fact.sourceObservationIds)
        && fact.sourceObservationIds.some((id: unknown) => typeof id === "string" && selected.has(id)),
      ).map((fact) => fact.id).sort((left, right) => left.localeCompare(right));
      const updated = await tx.update(aiWorldTransitionsTable).set({
        resultingWorldRevision: result.worldRevision,
        materializedObservationIds: observationIds,
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
      if (updated.length === 0) throw new Error("github_delivery_transition_owner_stale");
    });
    try {
      invalidateContextSlice(input.projectId, "worldState");
    } catch (error) {
      logger.warn(
        { scope: "github-delivery-transition", code: "context_invalidation_failed", executionId: input.executionId, error },
        "GitHub delivery World State materialized but cache invalidation failed",
      );
    }
    return { status: "materialized", worldRevision: materialized.worldRevision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message.startsWith("github_delivery_transition_")
      ? message.slice(0, 80)
      : message.includes("parent_revision_mismatch")
        ? "parent_world_revision_mismatch"
        : "world_state_materialization_failed";
    if (code === "world_state_materialization_failed") {
      if (await markRetryableFailure(transition.id, code, leaseUntil, transition.retryCount)) {
        return { status: "pending", failureCode: code };
      }
    }
    await markTerminalFailure(transition.id, code, leaseUntil);
    return { status: "terminal_failed", failureCode: code };
  }
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
          .map((fact) => fact.id)
          .sort((left, right) => left.localeCompare(right));
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

function hasRetryablePostgresTransactionError(error: unknown): boolean {
  const retryableSqlStates = new Set([
    "40001", // serialization_failure
    "40P01", // deadlock_detected
    "55P03", // lock_not_available
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "08000", // connection_exception
    "08003", // connection_does_not_exist
    "08006", // connection_failure
  ]);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const wrapped = current as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string" && retryableSqlStates.has(wrapped.code)) return true;
    current = wrapped.cause;
  }
  return false;
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
    const [episode] = await tx.select({ id: aiAgentEpisodesTable.id })
      .from(aiAgentEpisodesTable)
      .where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
        eq(aiAgentEpisodesTable.executionId, input.executionId),
        eq(aiAgentEpisodesTable.attempt, input.attempt),
      ))
      .for("update")
      .limit(1);
    if (!episode) {
      const code = "apply_transition_episode_identity_mismatch";
      await tx.update(aiWorldTransitionsTable).set({
        status: "terminal_failed",
        failureCode: code,
        nextRetryAt: null,
        updatedAt: now,
      }).where(eq(aiWorldTransitionsTable.id, transition.id));
      return { kind: "terminal_failed", failureCode: code };
    }
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claimed = await tx.update(aiWorldTransitionsTable).set({
      status: "retrying",
      nextRetryAt: leaseUntil,
      updatedAt: now,
    }).where(and(
      eq(aiWorldTransitionsTable.id, transition.id),
      inArray(aiWorldTransitionsTable.status, ["pending", "retrying"]),
    )).returning({
      id: aiWorldTransitionsTable.id,
      leaseUntil: aiWorldTransitionsTable.nextRetryAt,
    });
    if (claimed.length === 0) return { kind: "pending" };
    const claimedLeaseUntil = claimed[0]?.leaseUntil;
    if (!claimedLeaseUntil) return { kind: "pending" };
    return { kind: "claimed", transition, leaseUntil: claimedLeaseUntil, binding };
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
    const [project] = await db.select({ rootPath: projectsTable.rootPath })
      .from(projectsTable)
      .where(eq(projectsTable.id, input.projectId))
      .limit(1);
    if (!project) throw new Error("apply_transition_project_missing");
    const root = await establishProjectRoot(project.rootPath);
    if (!root.ok) throw new Error("apply_transition_project_root_unavailable");
    let liveTreeHash: string;
    try {
      liveTreeHash = await hashDeliveryTree(root.canonicalPath);
    } catch {
      throw new Error("apply_transition_live_tree_unavailable");
    }
    if (liveTreeHash !== binding.promotedTreeHash) {
      throw new Error("apply_transition_live_tree_mismatch");
    }
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
      // Acceptance proof replay locks Execution before Acceptance, Episode, and
      // the effect bundle. Match that order so replay cannot deadlock against
      // this transaction's later Episode update.
      const [execution] = await tx.select({
        id: aiExecutionsTable.id,
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        goalId: aiExecutionsTable.goalId,
        proposalId: aiExecutionsTable.proposalId,
      }).from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, input.executionId),
          eq(aiExecutionsTable.projectId, input.projectId),
          eq(aiExecutionsTable.attempt, input.attempt),
        ))
        .for("update")
        .limit(1);
      if (
        !execution
        || execution.status !== "completed"
        || execution.goalId !== binding.goalId
        || execution.proposalId !== binding.proposalId
      ) throw new Error("apply_transition_execution_binding_mismatch");

      const [bundle] = await tx.select()
        .from(aiAgentEffectBundlesTable)
        .where(and(
          eq(aiAgentEffectBundlesTable.id, input.effectBundleId),
          eq(aiAgentEffectBundlesTable.projectId, input.projectId),
          eq(aiAgentEffectBundlesTable.executionId, input.executionId),
          eq(aiAgentEffectBundlesTable.attempt, input.attempt),
          eq(aiAgentEffectBundlesTable.episodeId, input.episodeId),
        ))
        .for("update")
        .limit(1);
      const effectIds = Array.isArray(bundle?.effectIds)
        ? bundle.effectIds.filter((id): id is string => typeof id === "string")
        : [];
      const effects = effectIds.length > 0
        ? await tx.select().from(aiAgentEffectsTable)
          .where(and(
            eq(aiAgentEffectsTable.projectId, input.projectId),
            eq(aiAgentEffectsTable.executionId, input.executionId),
            eq(aiAgentEffectsTable.attempt, input.attempt),
            eq(aiAgentEffectsTable.episodeId, input.episodeId),
            inArray(aiAgentEffectsTable.id, effectIds),
          ))
          .for("update")
        : [];
      if (!bundle || !isBoundApplyChangeEffectBundle({
        bundle,
        effects,
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        episodeId: input.episodeId,
        actionId: input.actionId,
        proposalId: binding.proposalId,
        candidateTreeHash: binding.promotedTreeHash,
      })) throw new Error("apply_transition_effect_unproven");

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
      const [boundEpisode] = await tx.update(aiAgentEpisodesTable).set({
        worldRevision: result.worldRevision,
        updatedAt: new Date(),
      }).where(and(
        eq(aiAgentEpisodesTable.id, input.episodeId),
        eq(aiAgentEpisodesTable.projectId, input.projectId),
        eq(aiAgentEpisodesTable.executionId, input.executionId),
        eq(aiAgentEpisodesTable.attempt, input.attempt),
        eq(aiAgentEpisodesTable.missionId, mission.id),
        eq(aiAgentEpisodesTable.goalId, goal.id),
        eq(aiAgentEpisodesTable.planRevision, binding.planRevision),
      )).returning({ id: aiAgentEpisodesTable.id });
      if (!boundEpisode) throw new Error("apply_transition_episode_scope_mismatch");
    });
    try { invalidateContextSlice(input.projectId, "worldState"); } catch { /* projection remains authoritative */ }
    return { status: "materialized", worldRevision: materialized.worldRevision };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const retryable = message.includes("parent_revision_mismatch")
      || message.includes("world_state_materialization_failed")
      || message.includes("owner_stale")
      || hasRetryablePostgresTransactionError(error);
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
        : transition?.idempotencyKey.startsWith("github.delivery:")
          ? finalizeGitHubDeliveryTransition
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