import { and, eq, inArray } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
} from "@workspace/db";
import {
  GoalNextActionSchema,
  type ApplyChangesRequirement,
} from "@workspace/ai-orchestrator";

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Goal = typeof aiGoalsTable.$inferSelect;
type Mission = typeof aiMissionsTable.$inferSelect;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function sameRequirement(left: unknown, right: ApplyChangesRequirement): boolean {
  const value = record(left);
  return Object.keys(value).length === 9
    && value.kind === right.kind
    && value.version === right.version
    && value.sourceStepId === right.sourceStepId
    && value.proposalId === right.proposalId
    && value.baseRevision === right.baseRevision
    && value.candidateTreeHash === right.candidateTreeHash
    && value.changeSetHash === right.changeSetHash
    && value.from === right.from
    && value.to === right.to;
}

function parseRequirement(value: unknown): ApplyChangesRequirement | undefined {
  const item = record(value);
  if (
    Object.keys(item).length !== 9
    || item.kind !== "apply.changes"
    || item.version !== 1
    || item.sourceStepId !== "apply-changes"
    || typeof item.proposalId !== "string"
    || item.proposalId.trim().length === 0
    || typeof item.baseRevision !== "string"
    || item.baseRevision.trim().length === 0
    || typeof item.candidateTreeHash !== "string"
    || !/^[a-f0-9]{64}$/.test(item.candidateTreeHash)
    || typeof item.changeSetHash !== "string"
    || !/^[a-f0-9]{64}$/.test(item.changeSetHash)
    || item.from !== "candidate"
    || item.to !== "applied"
  ) return undefined;
  return {
    kind: "apply.changes",
    version: 1,
    sourceStepId: "apply-changes",
    proposalId: item.proposalId,
    baseRevision: item.baseRevision,
    candidateTreeHash: item.candidateTreeHash,
    changeSetHash: item.changeSetHash,
    from: "candidate",
    to: "applied",
  };
}

export type ApplyChangesMissionRequirement =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "valid";
      requirement: ApplyChangesRequirement;
      planRevision: string;
      candidateIdentity: string;
    };

export function applyChangesMissionRequirement(
  goal: Goal,
  mission: Mission,
  activePlanRevision: string | undefined,
): ApplyChangesMissionRequirement {
  const criteria = record(goal.successCriteria);
  const outcome = record(goal.outcomeContract);
  const autonomyPolicy = record(mission.autonomyPolicy);
  const applyMission = record(autonomyPolicy.applyMission);
  if (
    criteria.stepId === "report-applied"
    && outcome.stepId === "report-applied"
    && !Object.hasOwn(criteria, "applyRequirement")
    && !Object.hasOwn(outcome, "applyRequirement")
  ) return { kind: "none" };
  const hasRequirement = Object.hasOwn(criteria, "applyRequirement")
    || Object.hasOwn(outcome, "applyRequirement")
    || Object.hasOwn(autonomyPolicy, "applyMission");
  if (!hasRequirement) return { kind: "none" };

  const requirement = parseRequirement(criteria.applyRequirement);
  if (
    !requirement
    || !sameRequirement(outcome.applyRequirement, requirement)
    || criteria.stepId !== "apply-changes"
    || outcome.stepId !== "apply-changes"
  ) {
    return { kind: "invalid", reason: "apply_requirement_invalid" };
  }

  const criteriaPlan = record(criteria.planRevision);
  const outcomePlan = record(outcome.planRevision);
  const planRevision = typeof criteriaPlan.hash === "string" ? criteriaPlan.hash : "";
  if (
    !/^[a-f0-9]{64}$/.test(planRevision)
    || planRevision !== activePlanRevision
    || outcomePlan.hash !== planRevision
    || !sameRequirement(criteriaPlan.applyRequirement, requirement)
    || !sameRequirement(outcomePlan.applyRequirement, requirement)
    || applyMission.proposalId !== requirement.proposalId
    || !sameRequirement(applyMission.requirement, requirement)
  ) {
    return { kind: "invalid", reason: "apply_plan_binding_invalid" };
  }

  const steps = Array.isArray(criteriaPlan.steps) ? criteriaPlan.steps.map(record) : [];
  const stepIds = steps.map((step) => step.id).sort();
  const applyStep = steps.find((step) => step.id === "apply-changes");
  const reportStep = steps.find((step) => step.id === "report-applied");
  const reportDependencies = Array.isArray(reportStep?.dependencies)
    ? reportStep.dependencies
    : [];
  const action = GoalNextActionSchema.safeParse(goal.nextAction);
  if (
    steps.length !== 2
    || stepIds.join(",") !== "apply-changes,report-applied"
    || !applyStep
    || !reportStep
    || !reportDependencies.includes("apply-changes")
    || !action.success
    || action.data.kind !== "wait"
    || outcome.candidateIdentity !== `${requirement.proposalId}:${requirement.candidateTreeHash}`
  ) {
    return { kind: "invalid", reason: "apply_plan_shape_invalid" };
  }
  return {
    kind: "valid",
    requirement,
    planRevision,
    candidateIdentity: `${requirement.proposalId}:${requirement.candidateTreeHash}`,
  };
}

export type ApplyChangesD2Evaluation =
  | { state: "not_applicable" }
  | { state: "pending"; reason: string }
  | { state: "failed"; reason: string }
  | {
      state: "proven";
      executionId: string;
      attempt: number;
      acceptanceId: string;
      operationId: string;
      transitionId: string;
      effectBundleId: string;
      resultingWorldRevision: string;
      environmentRevision: string;
      beforeObservationIds: string[];
      afterObservationIds: string[];
      requirement: ApplyChangesRequirement;
      planRevision: string;
      candidateIdentity: string;
    };

type ApplyBinding = {
  proposalId: string;
  goalId: string;
  planRevision: string;
  promotedTreeHash: string;
};

function readApplyBinding(value: unknown): ApplyBinding | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value.filter((item): item is string =>
    typeof item === "string" && item.startsWith("apply-binding:v1:"),
  );
  if (refs.length !== 1) return undefined;
  try {
    const parsed = record(JSON.parse(refs[0].slice("apply-binding:v1:".length)));
    if (
      Object.keys(parsed).length !== 4
      || typeof parsed.proposalId !== "string"
      || typeof parsed.goalId !== "string"
      || typeof parsed.planRevision !== "string"
      || typeof parsed.promotedTreeHash !== "string"
    ) return undefined;
    return {
      proposalId: parsed.proposalId,
      goalId: parsed.goalId,
      planRevision: parsed.planRevision,
      promotedTreeHash: parsed.promotedTreeHash,
    };
  } catch {
    return undefined;
  }
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string =>
        typeof id === "string" && id.trim().length > 0,
      ))]
    : [];
}

function observedTreeHash(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const treeHash = record(value).treeHash;
  return typeof treeHash === "string" ? treeHash : undefined;
}

/**
 * Evaluates the live-root D2 proof independently of Gate-C acceptance. The
 * caller owns Mission/Goal completion and may only release the successor when
 * this exact durable transition is materialized and bound to the active plan.
 */
export async function evaluateApplyChangesD2(
  tx: MissionTransaction,
  input: {
    goal: Goal;
    mission: Mission;
    activePlanRevision: string | undefined;
  },
): Promise<ApplyChangesD2Evaluation> {
  const binding = applyChangesMissionRequirement(
    input.goal,
    input.mission,
    input.activePlanRevision,
  );
  if (binding.kind === "none") return { state: "not_applicable" };
  if (binding.kind === "invalid") return { state: "failed", reason: binding.reason };

  const { requirement, planRevision, candidateIdentity } = binding;
  const dependencies = await tx.select()
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.projectId, input.goal.projectId),
      eq(aiGoalDependenciesTable.missionId, input.goal.missionId),
      eq(aiGoalDependenciesTable.dependsOnGoalId, input.goal.id),
      eq(aiGoalDependenciesTable.planRevision, planRevision),
    ))
    .for("update");
  if (dependencies.length !== 1) {
    return { state: "failed", reason: "apply_successor_dependency_invalid" };
  }
  const [successor] = await tx.select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, dependencies[0].goalId),
      eq(aiGoalsTable.projectId, input.goal.projectId),
      eq(aiGoalsTable.missionId, input.goal.missionId),
    ))
    .for("update");
  const successorCriteria = record(successor?.successCriteria);
  if (
    !successor
    || successorCriteria.stepId !== "report-applied"
    || record(successorCriteria.planRevision).hash !== planRevision
  ) return { state: "failed", reason: "apply_successor_binding_invalid" };
  const successorDependencies = await tx.select()
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.projectId, input.goal.projectId),
      eq(aiGoalDependenciesTable.missionId, input.goal.missionId),
      eq(aiGoalDependenciesTable.goalId, successor.id),
      eq(aiGoalDependenciesTable.planRevision, planRevision),
    ));
  if (
    successorDependencies.length !== 1
    || successorDependencies[0].dependsOnGoalId !== input.goal.id
  ) return { state: "failed", reason: "apply_successor_dependency_invalid" };

  const executions = await tx.select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.projectId, input.goal.projectId),
      eq(aiExecutionsTable.goalId, input.goal.id),
      eq(aiExecutionsTable.proposalId, requirement.proposalId),
    ))
    .for("update");
  const execution = executions.sort((left, right) =>
    right.createdAt.getTime() - left.createdAt.getTime()
    || right.attempt - left.attempt
    || right.id.localeCompare(left.id),
  )[0];
  if (!execution) return { state: "pending", reason: "apply_execution_missing" };
  if (execution.status === "queued" || execution.status === "running"
    || execution.status === "paused" || execution.status === "cancelling") {
    return { state: "pending", reason: "apply_execution_active" };
  }
  if (execution.status !== "completed") {
    return { state: "failed", reason: "apply_execution_not_accepted" };
  }

  const [proposal] = await tx.select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, requirement.proposalId),
      eq(aiChangeProposalsTable.projectId, input.goal.projectId),
    ))
    .for("update");
  if (
    !proposal
    || proposal.status !== "applied"
    || proposal.lifecycle !== "applied"
    || proposal.baseRevision !== requirement.baseRevision
    || proposal.candidateTreeHash !== requirement.candidateTreeHash
    || proposal.changeSetHash !== requirement.changeSetHash
    || proposal.promotedTreeHash !== requirement.candidateTreeHash
    || typeof proposal.baseTreeHash !== "string"
    || !/^[a-f0-9]{64}$/.test(proposal.baseTreeHash)
  ) return { state: "failed", reason: "apply_proposal_binding_invalid" };

  const [acceptance] = await tx.select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    ))
    .for("update");
  if (!acceptance) return { state: "failed", reason: "apply_acceptance_missing" };
  if (
    acceptance.terminalStatus !== "completed"
    || !acceptance.operationId
    || acceptance.operationId !== execution.operationId
    || !acceptance.effectBundleId
  ) return { state: "failed", reason: "apply_acceptance_binding_invalid" };

  const transitions = await tx.select()
    .from(aiWorldTransitionsTable)
    .where(and(
      eq(aiWorldTransitionsTable.projectId, input.goal.projectId),
      eq(aiWorldTransitionsTable.executionId, execution.id),
      eq(aiWorldTransitionsTable.attempt, execution.attempt),
    ))
    .for("update");
  const transition = transitions.find((candidate) => {
    const parsed = readApplyBinding(candidate.evidenceRefs);
    return candidate.idempotencyKey.startsWith("apply.changes:")
      && candidate.episodeId.length > 0
      && candidate.actionId.length > 0
      && candidate.effectBundleId === acceptance.effectBundleId
      && parsed?.proposalId === requirement.proposalId
      && parsed.goalId === input.goal.id
      && parsed.planRevision === planRevision
      && parsed.promotedTreeHash === requirement.candidateTreeHash;
  });
  if (!transition) return { state: "failed", reason: "apply_transition_missing" };
  if (transition.status === "pending" || transition.status === "retrying") {
    return { state: "pending", reason: "apply_transition_pending" };
  }
  if (
    transition.status !== "materialized"
    || transition.freshness !== "fresh"
    || transition.taskScope !== "project"
    || !transition.resultingWorldRevision
    || !/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)
    || !/^[a-f0-9]{64}$/.test(transition.resultingWorldRevision)
    || !transition.environmentRevision
    || !/^env-v1:[a-f0-9]{64}$/.test(transition.environmentRevision)
    || transition.environmentRevisionKey !== `revision:${transition.environmentRevision}`
  ) return { state: "failed", reason: "apply_transition_not_materialized" };

  const beforeIds = ids(transition.beforeObservationIds);
  const afterIds = ids(transition.afterObservationIds);
  const materializedIds = new Set(ids(transition.materializedObservationIds));
  if (
    beforeIds.length === 0
    || afterIds.length === 0
    || ![...beforeIds, ...afterIds].every((id) => materializedIds.has(id))
  ) return { state: "failed", reason: "apply_transition_observation_set_invalid" };
  const observationIds = [...new Set([...beforeIds, ...afterIds])];
  const observations = await tx.select()
    .from(aiAgentObservationsTable)
    .where(and(
      eq(aiAgentObservationsTable.projectId, input.goal.projectId),
      inArray(aiAgentObservationsTable.id, observationIds),
    ))
    .for("update");
  if (
    observations.length !== observationIds.length
    || observations.some((observation) => (
      observation.executionId !== execution.id
      || observation.episodeId !== transition.episodeId
      || observation.provenance !== "DIRECT_OBSERVATION"
      || observation.completeness !== "complete"
      || observation.freshness !== "fresh"
      || observation.environmentFreshness !== "fresh"
      || observation.environmentRevision !== transition.environmentRevision
      || observation.subject !== `project:${input.goal.projectId}`
    ))
  ) return { state: "failed", reason: "apply_transition_observations_invalid" };
  const beforeTree = observations.find((row) =>
    beforeIds.includes(row.id)
    && row.predicate === "workspace.tree_hash"
    && row.projectRevision === proposal.baseTreeHash
    && observedTreeHash(row.value) === proposal.baseTreeHash,
  );
  const afterTree = observations.find((row) =>
    afterIds.includes(row.id)
    && row.predicate === "workspace.tree_hash"
    && row.projectRevision === requirement.candidateTreeHash
    && observedTreeHash(row.value) === requirement.candidateTreeHash,
  );
  if (!beforeTree || !afterTree) {
    return { state: "failed", reason: "apply_transition_tree_observations_invalid" };
  }

  const [bundle] = await tx.select()
    .from(aiAgentEffectBundlesTable)
    .where(and(
      eq(aiAgentEffectBundlesTable.id, acceptance.effectBundleId),
      eq(aiAgentEffectBundlesTable.projectId, input.goal.projectId),
      eq(aiAgentEffectBundlesTable.executionId, execution.id),
      eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
      eq(aiAgentEffectBundlesTable.episodeId, transition.episodeId),
    ))
    .for("update");
  if (!bundle || bundle.verdict !== "OBSERVED") {
    return { state: "failed", reason: "apply_effect_unproven" };
  }

  return {
    state: "proven",
    executionId: execution.id,
    attempt: execution.attempt,
    acceptanceId: acceptance.id,
    operationId: acceptance.operationId,
    transitionId: transition.id,
    effectBundleId: acceptance.effectBundleId,
    resultingWorldRevision: transition.resultingWorldRevision,
    environmentRevision: transition.environmentRevision,
    beforeObservationIds: beforeIds,
    afterObservationIds: afterIds,
    requirement,
    planRevision,
    candidateIdentity,
  };
}