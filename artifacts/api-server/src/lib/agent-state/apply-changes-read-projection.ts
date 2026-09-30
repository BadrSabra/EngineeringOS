import { and, eq } from "drizzle-orm";
import {
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  type aiExecutionsTable,
  type aiExecutionAcceptancesTable,
} from "@workspace/db";
import {
  applyChangesMissionRequirement,
  readApplyBinding,
} from "./apply-changes-mission-gate.js";
import type { RuntimeWorldTransitionReadProjection } from "./world-transition-read-projection.js";

type Execution = Pick<typeof aiExecutionsTable.$inferSelect,
  "id" | "attempt" | "projectId" | "goalId" | "proposalId" | "operationId">;
type Acceptance = typeof aiExecutionAcceptancesTable.$inferSelect;
type Transition = typeof aiWorldTransitionsTable.$inferSelect;
type Goal = typeof aiGoalsTable.$inferSelect;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type ApplyMissionLink = {
  kind: "valid";
  goal: Goal;
  successor: Goal;
  missionId: string;
  planRevision: string;
  proposalId: string;
  baseRevision: string;
  candidateTreeHash: string;
  candidateIdentity: string;
};

export type BlockedApplyMissionLink = {
  kind: "blocked";
  goalId: string;
  missionId: string;
  planRevision: string;
  reason: string;
};

/**
 * Read-only counterpart to D2's locked gate. This finds the active-plan
 * successor, but never re-evaluates D2 or creates acceptance.
 */
export async function loadApplyMissionLink(
  execution: Execution,
  userId: string,
): Promise<ApplyMissionLink | BlockedApplyMissionLink | null> {
  if (!execution.goalId || !execution.proposalId) return null;
  const [linked] = await db.select({ goal: aiGoalsTable, mission: aiMissionsTable })
    .from(aiGoalsTable)
    .innerJoin(aiMissionsTable, eq(aiMissionsTable.id, aiGoalsTable.missionId))
    .where(and(
      eq(aiGoalsTable.id, execution.goalId),
      eq(aiGoalsTable.projectId, execution.projectId),
      eq(aiMissionsTable.projectId, execution.projectId),
      eq(aiMissionsTable.userId, userId),
    ))
    .limit(1);
  if (!linked) return null;
  const criteria = record(linked.goal.successCriteria);
  if (
    criteria.stepId !== "apply-changes"
    || record(criteria.applyRequirement).proposalId !== execution.proposalId
  ) return null;
  const criteriaPlan = record(criteria.planRevision);
  const blocked = (reason: string): BlockedApplyMissionLink => ({
    kind: "blocked",
    goalId: linked.goal.id,
    missionId: linked.mission.id,
    planRevision: typeof criteriaPlan.hash === "string" ? criteriaPlan.hash : "",
    reason,
  });
  const policy = record(linked.mission.autonomyPolicy);
  const binding = applyChangesMissionRequirement(
    linked.goal,
    linked.mission,
    typeof policy.activePlanRevision === "string" ? policy.activePlanRevision : undefined,
  );
  if (binding.kind !== "valid") {
    return blocked(binding.kind === "invalid" ? binding.reason : "apply_requirement_invalid");
  }
  if (binding.requirement.proposalId !== execution.proposalId) return blocked("apply_requirement_invalid");
  const dependencies = await db.select()
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.projectId, execution.projectId),
      eq(aiGoalDependenciesTable.missionId, linked.mission.id),
      eq(aiGoalDependenciesTable.dependsOnGoalId, linked.goal.id),
      eq(aiGoalDependenciesTable.planRevision, binding.planRevision),
    ));
  if (dependencies.length !== 1) return blocked("apply_successor_dependency_invalid");
  const [successor] = await db.select().from(aiGoalsTable).where(and(
    eq(aiGoalsTable.id, dependencies[0].goalId),
    eq(aiGoalsTable.projectId, execution.projectId),
    eq(aiGoalsTable.missionId, linked.mission.id),
  )).limit(1);
  const successorCriteria = record(successor?.successCriteria);
  if (
    !successor
    || successorCriteria.stepId !== "report-applied"
    || record(successorCriteria.planRevision).hash !== binding.planRevision
  ) return blocked("apply_successor_binding_invalid");
  const successorDependencies = await db.select().from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.projectId, execution.projectId),
      eq(aiGoalDependenciesTable.missionId, linked.mission.id),
      eq(aiGoalDependenciesTable.goalId, successor.id),
      eq(aiGoalDependenciesTable.planRevision, binding.planRevision),
    ));
  if (
    successorDependencies.length !== 1
    || successorDependencies[0].dependsOnGoalId !== linked.goal.id
  ) return blocked("apply_successor_dependency_invalid");
  return {
    kind: "valid",
    goal: linked.goal,
    successor,
    missionId: linked.mission.id,
    planRevision: binding.planRevision,
    proposalId: binding.requirement.proposalId,
    baseRevision: binding.requirement.baseRevision,
    candidateTreeHash: binding.requirement.candidateTreeHash,
    candidateIdentity: binding.candidateIdentity,
  };
}

export function isBoundApplyTransition(
  transition: Transition,
  execution: Execution,
  link: ApplyMissionLink,
  acceptance: Acceptance | undefined,
): boolean {
  const binding = readApplyBinding(transition.evidenceRefs);
  return Boolean(
    acceptance?.outcome === "SUCCEEDED"
    && acceptance.terminalStatus === "completed"
    && acceptance.operationId === execution.operationId
    && acceptance.effectBundleId
    && transition.projectId === execution.projectId
    && transition.executionId === execution.id
    && transition.attempt === execution.attempt
    && transition.idempotencyKey.startsWith("apply.changes:")
    && transition.effectBundleId === acceptance.effectBundleId
    && transition.episodeId
    && transition.actionId
    && binding?.proposalId === link.proposalId
    && binding.goalId === link.goal.id
    && binding.planRevision === link.planRevision
    && binding.promotedTreeHash === link.candidateTreeHash,
  );
}

export function projectApplyMissionLink(
  execution: Execution,
  link: ApplyMissionLink,
  acceptance: Acceptance | undefined,
  transition: Transition | undefined,
  publicTransition: RuntimeWorldTransitionReadProjection | undefined,
) {
  const outcome = record(link.goal.outcomeContract);
  const proof = record(outcome.acceptance);
  const scope = record(proof.scope);
  const state = record(proof.stateProjection);
  const receipt = record(proof.receipt);
  const refs = Array.isArray(proof.acceptedRefs) ? proof.acceptedRefs : [];
  const proven = Boolean(
    transition
    && acceptance?.outcome === "SUCCEEDED"
    && acceptance.terminalStatus === "completed"
    && acceptance.operationId === execution.operationId
    && acceptance.effectBundleId === transition.effectBundleId
    && link.goal.status === "completed"
    && proof.outcome === "SUCCEEDED"
    && proof.verdict === "PROVEN"
    && proof.reasonCode === "APPLY_CHANGES_D2_PROVEN"
    && proof.executionId === execution.id
    && proof.sourceRevision === link.baseRevision
    && proof.candidateIdentity === link.candidateIdentity
    && scope.projectId === execution.projectId
    && scope.missionId === link.missionId
    && scope.goalId === link.goal.id
    && scope.operationId === execution.operationId
    && scope.planRevision === link.planRevision
    && receipt.id === acceptance.id
    && receipt.executionId === execution.id
    && refs.includes(`execution:${execution.id}:${execution.attempt}`)
    && refs.includes(`effect-bundle:${acceptance.effectBundleId}`)
    && refs.includes(`world-transition:${transition.id}`)
    && state.transitionId === transition.id
    && state.worldRevision === transition.resultingWorldRevision
    && transition.status === "materialized"
    && transition.freshness === "fresh"
    && transition.resultingWorldRevision
    && publicTransition?.id === transition.id
    && publicTransition.effectBundle?.id === acceptance.effectBundleId
    && publicTransition.effectBundle.verdict === "OBSERVED"
    && [publicTransition.beforeObservations, publicTransition.afterObservations].every((side) =>
      side.some((observation) =>
        observation.predicate === "workspace.tree_hash"
        && observation.provenance === "DIRECT_OBSERVATION"
        && observation.completeness === "complete"
        && observation.freshness === "fresh"
        && observation.environmentFreshness === "fresh",
      )),
  );
  const action = record(link.successor.nextAction);
  return {
    goalId: link.goal.id,
    missionId: link.missionId,
    planRevision: link.planRevision,
    reason: null,
    d2: {
      state: proven ? "PROVEN" as const
        : link.goal.status === "blocked" || link.goal.status === "needs_replan"
          ? "BLOCKED" as const
          : "INCOMPLETE" as const,
      transitionId: proven ? transition!.id : null,
      resultingWorldRevision: proven ? transition!.resultingWorldRevision : null,
    },
    successor: {
      goalId: link.successor.id,
      status: link.successor.status,
      blockedReason: link.successor.blockedReason,
      taskId: action.kind === "task" && typeof action.taskId === "string" ? action.taskId : null,
    },
  };
}

export function projectBlockedApplyMissionLink(link: BlockedApplyMissionLink) {
  return {
    goalId: link.goalId,
    missionId: link.missionId,
    planRevision: link.planRevision,
    reason: link.reason,
    d2: { state: "BLOCKED" as const, transitionId: null, resultingWorldRevision: null },
    successor: null,
  };
}