import { z } from "zod";
import { canonicalJsonHash } from "./contract-utils.js";
import {
  MissionDecisionTraceSchema,
  MissionStrategyPlanOutcomeEvaluationSchema,
  type MissionStrategyPlanOutcomeEvaluation,
} from "./mission-decision-contract.js";

const boundedId = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const effectCodes = z.array(z.string().min(1).max(120)).max(32);
const PlanOutcomeEvidenceInputSchema = z.object({
  trace: MissionDecisionTraceSchema,
  persistedLifecycle: z.array(z.object({
    stage: z.enum([
      "PROPOSED",
      "EVALUATED",
      "SELECTED",
      "APPROVED",
      "PLAN_APPLIED",
      "DISPATCHED",
      "EXECUTED",
      "ACCEPTED",
      "VERIFIED",
      "EVALUATED_AFTER_EXECUTION",
    ]),
    sequence: z.number().int().positive(),
    referenceId: boundedId.nullable(),
  }).strict()).max(10),
  plan: z.object({
    projectId: boundedId,
    missionId: boundedId,
    sourceGoalId: boundedId,
    revision: boundedId,
    activeRevision: boundedId.nullable(),
    goalIds: z.array(boundedId).max(64),
    requiredGoalIds: z.array(boundedId).max(64),
    taskIds: z.array(boundedId).max(256),
    rootGoalIds: z.array(boundedId).max(64),
  }).strict(),
  dispatchBatch: z.object({
    decisionId: hash,
    projectId: boundedId,
    missionId: boundedId,
    planRevision: boundedId,
    id: boundedId,
    manifestHash: hash,
    state: z.enum(["dispatched", "partial"]),
    items: z.array(z.object({
      position: z.number().int().nonnegative(),
      goalId: boundedId,
      executionId: boundedId.nullable(),
      runStatus: z.enum(["scheduled", "waiting", "blocked", "completed", "conflict"]),
    }).strict()).max(64),
  }).strict(),
  goalStates: z.array(z.object({
    goalId: boundedId,
    terminal: z.boolean(),
    taskIds: z.array(boundedId).max(256),
    executionIds: z.array(boundedId).max(128),
  }).strict()).max(64),
  taskStates: z.array(z.object({
    taskId: boundedId,
    goalId: boundedId,
    terminal: z.boolean(),
    executionIds: z.array(boundedId).max(128),
  }).strict()).max(256),
  executions: z.array(z.object({
    goalId: boundedId,
    taskId: boundedId.nullable(),
    executionId: boundedId,
    attempt: z.number().int().nonnegative(),
    terminal: z.boolean(),
    acceptanceId: boundedId.nullable(),
    effectBundleId: boundedId.nullable(),
    canonicalProofId: boundedId.nullable(),
    canonicalProofHash: hash.nullable(),
    worldStateRevision: boundedId.nullable(),
    outcome: z.enum(["ACHIEVED", "NOT_ACHIEVED", "INCONCLUSIVE"]),
    evidenceHash: hash,
    observedEffectCodes: effectCodes,
    contradictedEffectCodes: effectCodes,
  }).strict()).max(512),
  finalWorldState: z.object({
    revision: boundedId.nullable(),
    continuityVerified: z.boolean(),
    evidenceHash: hash.nullable(),
    observedEffectCodes: effectCodes,
    contradictedEffectCodes: effectCodes,
  }).strict(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

export type MissionStrategyPlanOutcomeEvidence =
  z.infer<typeof PlanOutcomeEvidenceInputSchema>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = uniqueSorted(left);
  const rightSorted = uniqueSorted(right);
  return leftSorted.length === left.length
    && rightSorted.length === right.length
    && leftSorted.join("\n") === rightSorted.join("\n");
}

/**
 * Deterministic plan-level aggregation only. The caller must load and validate
 * every input row from the current server-owned plan and evidence tables.
 * This function does not load evidence, authorize mutation, or establish proof.
 */
export function evaluateMissionStrategyPlanOutcome(
  untrustedEvidence: unknown,
): MissionStrategyPlanOutcomeEvaluation {
  const evidence = PlanOutcomeEvidenceInputSchema.parse(untrustedEvidence);
  const trace = evidence.trace;
  const selectedStrategyId = trace.result.kind === "SELECTED"
    ? trace.result.selectedStrategyId
    : "no_selected_strategy";
  const selectedStrategy = trace.result.kind === "SELECTED"
    ? trace.alternatives.find(({ strategyId }) => strategyId === selectedStrategyId) ?? null
    : null;
  const expectedEffectCodes = uniqueSorted(selectedStrategy?.expectedEffectCodes ?? []);
  const limitations = new Set<string>();
  const identity = trace.context.identity;

  if (trace.result.kind !== "SELECTED" || !selectedStrategy) {
    limitations.add("decision_not_selected");
  }
  if (
    evidence.plan.projectId !== identity.projectId
    || evidence.plan.missionId !== identity.missionId
    || evidence.plan.sourceGoalId !== identity.goalId
  ) {
    limitations.add("plan_identity_mismatch");
  }
  if (
    evidence.plan.activeRevision !== evidence.plan.revision
    || trace.newPlanRevision !== evidence.plan.revision
    || evidence.dispatchBatch.planRevision !== evidence.plan.revision
  ) {
    limitations.add("plan_revision_not_current");
  }
  if (
    evidence.dispatchBatch.decisionId !== trace.decisionId
    || evidence.dispatchBatch.projectId !== evidence.plan.projectId
    || evidence.dispatchBatch.missionId !== evidence.plan.missionId
    || trace.dispatchRef !== evidence.dispatchBatch.id
  ) {
    limitations.add("dispatch_batch_identity_mismatch");
  }

  const needsApproval = selectedStrategy?.approvalRequirement !== "not_required"
    || trace.context.approval.status === "granted";
  const expectedStages = [
    "PROPOSED",
    "EVALUATED",
    "SELECTED",
    ...(needsApproval ? ["APPROVED"] : []),
    "PLAN_APPLIED",
    "DISPATCHED",
  ];
  const traceLifecycle = trace.lifecycle;
  const lifecycleMatches = evidence.persistedLifecycle.length === expectedStages.length
    && traceLifecycle.length === expectedStages.length
    && expectedStages.every((stage, index) =>
      evidence.persistedLifecycle[index]?.stage === stage
      && evidence.persistedLifecycle[index]?.sequence === index + 1
      && traceLifecycle[index]?.stage === stage
      && traceLifecycle[index]?.referenceId === evidence.persistedLifecycle[index]?.referenceId);
  if (!lifecycleMatches) limitations.add("lifecycle_not_at_dispatch_boundary");
  if (
    traceLifecycle.find(({ stage }) => stage === "SELECTED")?.referenceId
      !== selectedStrategyId
    || traceLifecycle.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId
      !== evidence.plan.revision
    || traceLifecycle.find(({ stage }) => stage === "DISPATCHED")?.referenceId
      !== evidence.dispatchBatch.id
    ||
    evidence.persistedLifecycle.find(({ stage }) => stage === "PLAN_APPLIED")?.referenceId
      !== evidence.plan.revision
    || evidence.persistedLifecycle.find(({ stage }) => stage === "DISPATCHED")?.referenceId
      !== evidence.dispatchBatch.id
  ) {
    limitations.add("lifecycle_reference_mismatch");
  }
  const approvedEvent = evidence.persistedLifecycle.find(({ stage }) => stage === "APPROVED");
  const selectedEvaluation = trace.evaluations.find(({ strategyId }) =>
    strategyId === selectedStrategyId);
  if (needsApproval && (
    !approvedEvent
    || approvedEvent.referenceId !== trace.context.approval.approvalRef
    || trace.context.approval.status !== "granted"
    || trace.context.approval.approvedStrategyId !== selectedStrategyId
    || trace.context.approval.approvedStrategyHash !== selectedEvaluation?.strategyHash
    || trace.context.approval.approvedPlanRevision !== evidence.plan.revision
  )) {
    limitations.add("approval_binding_mismatch");
  }

  const goalIds = uniqueSorted(evidence.plan.goalIds);
  const requiredGoalIds = uniqueSorted(evidence.plan.requiredGoalIds);
  const taskIds = uniqueSorted(evidence.plan.taskIds);
  const rootGoalIds = uniqueSorted(evidence.plan.rootGoalIds);
  const sourceLists = [
    evidence.plan.goalIds,
    evidence.plan.requiredGoalIds,
    evidence.plan.taskIds,
    evidence.plan.rootGoalIds,
    ...evidence.goalStates.flatMap((goal) => [goal.taskIds, goal.executionIds]),
    ...evidence.taskStates.map((task) => task.executionIds),
  ];
  if (sourceLists.some((values) => !sameSet(values, uniqueSorted(values)))) {
    limitations.add("duplicate_plan_identity");
  }
  const goalStates = [...evidence.goalStates]
    .sort((left, right) => left.goalId.localeCompare(right.goalId))
    .map((goal) => ({
      ...goal,
      taskIds: uniqueSorted(goal.taskIds),
      executionIds: uniqueSorted(goal.executionIds),
    }));
  const taskStates = [...evidence.taskStates]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((task) => ({
      ...task,
      executionIds: uniqueSorted(task.executionIds),
    }));
  const executions = [...evidence.executions]
    .sort((left, right) =>
      left.goalId.localeCompare(right.goalId)
      || (left.taskId ?? "").localeCompare(right.taskId ?? "")
      || left.executionId.localeCompare(right.executionId)
      || left.attempt - right.attempt)
    .map((execution) => ({
      ...execution,
      observedEffectCodes: uniqueSorted(execution.observedEffectCodes),
      contradictedEffectCodes: uniqueSorted(execution.contradictedEffectCodes),
    }));
  const dispatchItems = [...evidence.dispatchBatch.items]
    .sort((left, right) => left.position - right.position);

  if (
    !sameSet(goalIds, goalStates.map(({ goalId }) => goalId))
    || !sameSet(requiredGoalIds, requiredGoalIds.filter((goalId) => goalIds.includes(goalId)))
    || !sameSet(taskIds, taskStates.map(({ taskId }) => taskId))
  ) {
    limitations.add("plan_goal_or_task_set_incomplete");
  }
  if (
    requiredGoalIds.some((goalId) => !goalIds.includes(goalId))
    || rootGoalIds.some((goalId) => !goalIds.includes(goalId))
  ) {
    limitations.add("plan_goal_scope_mismatch");
  }
  const taskIdsByGoal = new Map<string, string[]>();
  for (const task of taskStates) {
    const ids = taskIdsByGoal.get(task.goalId) ?? [];
    ids.push(task.taskId);
    taskIdsByGoal.set(task.goalId, ids);
  }
  if (goalStates.some((goal) => !sameSet(goal.taskIds, taskIdsByGoal.get(goal.goalId) ?? []))) {
    limitations.add("goal_task_binding_mismatch");
  }
  if (taskStates.some((task) => !goalIds.includes(task.goalId))) {
    limitations.add("task_goal_binding_mismatch");
  }

  const executionIdentity = (id: string, attempt: number) => `${id}\n${attempt}`;
  const executionIdentities = new Set(executions.map(({ executionId, attempt }) =>
    executionIdentity(executionId, attempt)));
  if (executionIdentities.size !== executions.length) {
    throw new Error("duplicate execution-attempt identity in Mission plan outcome evidence");
  }
  const goalExecutionIds = new Map<string, string[]>();
  const taskExecutionIds = new Map<string, string[]>();
  for (const execution of executions) {
    if (!goalIds.includes(execution.goalId)) limitations.add("execution_goal_out_of_plan");
    if (execution.taskId === null) {
      const ids = goalExecutionIds.get(execution.goalId) ?? [];
      ids.push(execution.executionId);
      goalExecutionIds.set(execution.goalId, ids);
    } else {
      const task = taskStates.find(({ taskId }) => taskId === execution.taskId);
      if (!task || task.goalId !== execution.goalId) {
        limitations.add("execution_task_binding_mismatch");
      }
      const ids = taskExecutionIds.get(execution.taskId) ?? [];
      ids.push(execution.executionId);
      taskExecutionIds.set(execution.taskId, ids);
    }
  }
  if (
    goalStates.some((goal) =>
      !sameSet(goal.executionIds, goalExecutionIds.get(goal.goalId) ?? []))
    || taskStates.some((task) =>
      !sameSet(task.executionIds, taskExecutionIds.get(task.taskId) ?? []))
  ) {
    limitations.add("execution_set_incomplete");
  }

  const rootIdsFromBatch = dispatchItems.map(({ goalId }) => goalId);
  if (!sameSet(rootGoalIds, rootIdsFromBatch)) limitations.add("dispatch_root_set_mismatch");
  if (
    dispatchItems.some(({ position }, index) => position !== index)
    || dispatchItems.some(({ executionId }) => executionId === null)
    || dispatchItems.some((item) =>
      item.executionId !== null
      && !executions.some((execution) =>
        execution.goalId === item.goalId && execution.executionId === item.executionId))
  ) {
    limitations.add("dispatch_root_execution_incomplete");
  }
  const dispatchBatchState = dispatchItems.length > 0 && dispatchItems.every(({ executionId }) =>
    executionId !== null)
    ? "dispatched"
    : "partial";
  if (evidence.dispatchBatch.state !== dispatchBatchState) {
    limitations.add("dispatch_batch_state_mismatch");
  }

  if (goalStates.some(({ terminal }) => !terminal)) limitations.add("plan_goal_nonterminal");
  if (taskStates.some(({ terminal }) => !terminal)) limitations.add("plan_task_nonterminal");
  if (executions.some(({ terminal }) => !terminal)) limitations.add("plan_execution_nonterminal");
  if (expectedEffectCodes.length === 0) limitations.add("selected_effect_contract_missing");
  if (requiredGoalIds.length === 0) limitations.add("required_goal_set_empty");
  if (
    requiredGoalIds.some((goalId) =>
      !executions.some((execution) => execution.goalId === goalId))
  ) {
    limitations.add("required_goal_execution_missing");
  }
  if (
    requiredGoalIds.some((goalId) =>
      executions.some((execution) =>
        execution.goalId === goalId && execution.outcome === "INCONCLUSIVE"))
  ) {
    limitations.add("required_execution_evidence_inconclusive");
  }
  if (executions.some((execution) =>
    requiredGoalIds.includes(execution.goalId)
    && execution.outcome === "ACHIEVED"
    && (
      !execution.acceptanceId
      || !execution.effectBundleId
      || !execution.canonicalProofId
      || !execution.canonicalProofHash
      || !execution.worldStateRevision
    ))) {
    limitations.add("execution_proof_binding_missing");
  }
  if (executions.some((execution) =>
    requiredGoalIds.includes(execution.goalId)
    && execution.outcome === "NOT_ACHIEVED"
    && (
      !execution.acceptanceId
      || !execution.effectBundleId
      || execution.contradictedEffectCodes.length === 0
    ))) {
    limitations.add("execution_failure_evidence_incomplete");
  }
  if (!evidence.finalWorldState.continuityVerified
    || !evidence.finalWorldState.revision
    || !evidence.finalWorldState.evidenceHash) {
    limitations.add("final_world_state_unverified");
  }

  const observedEffectCodes = uniqueSorted([
    ...executions.flatMap(({ observedEffectCodes: codes }) => codes),
    ...evidence.finalWorldState.observedEffectCodes,
  ]);
  const contradictedEffectCodes = uniqueSorted([
    ...executions.flatMap(({ contradictedEffectCodes: codes }) => codes),
    ...evidence.finalWorldState.contradictedEffectCodes,
  ]);
  const hasExpectedEffectConflict = expectedEffectCodes.some((code) =>
    observedEffectCodes.includes(code) && contradictedEffectCodes.includes(code));
  if (hasExpectedEffectConflict) limitations.add("expected_effect_evidence_conflict");

  const requiredExecutions = executions.filter(({ goalId }) => requiredGoalIds.includes(goalId));
  const allExpectedEffectsObserved = expectedEffectCodes.length > 0
    && expectedEffectCodes.every((code) =>
      evidence.finalWorldState.observedEffectCodes.includes(code)
      && observedEffectCodes.includes(code));
  const allExpectedEffectsContradicted = expectedEffectCodes.length > 0
    && expectedEffectCodes.every((code) =>
      evidence.finalWorldState.contradictedEffectCodes.includes(code)
      && contradictedEffectCodes.includes(code));
  const allGoalsTerminal = goalStates.length === goalIds.length
    && goalStates.every(({ terminal }) => terminal);
  const allTasksTerminal = taskStates.length === taskIds.length
    && taskStates.every(({ terminal }) => terminal);
  const allRequiredGoalsResolved = requiredGoalIds.length > 0
    && requiredGoalIds.every((goalId) => {
      const outcomes = requiredExecutions.filter((execution) => execution.goalId === goalId);
      return outcomes.length > 0
        && outcomes.every(({ terminal, outcome }) => terminal && outcome !== "INCONCLUSIVE");
    });
  const noLimitations = limitations.size === 0;

  let outcome: MissionStrategyPlanOutcomeEvaluation["outcome"] = "INCONCLUSIVE";
  if (
    noLimitations
    && allGoalsTerminal
    && allTasksTerminal
    && allRequiredGoalsResolved
    && requiredExecutions.length > 0
    && requiredExecutions.every(({ outcome: executionOutcome }) => executionOutcome === "ACHIEVED")
    && allExpectedEffectsObserved
    && !hasExpectedEffectConflict
  ) {
    outcome = "ACHIEVED";
  } else if (
    noLimitations
    &&
    allGoalsTerminal
    && allTasksTerminal
    && allRequiredGoalsResolved
    && requiredExecutions.some(({ outcome: executionOutcome }) => executionOutcome === "NOT_ACHIEVED")
    && allExpectedEffectsContradicted
    && !hasExpectedEffectConflict
    && evidence.finalWorldState.continuityVerified
    && evidence.finalWorldState.revision
    && evidence.finalWorldState.evidenceHash
    && dispatchBatchState === "dispatched"
  ) {
    outcome = "NOT_ACHIEVED";
  } else if (limitations.size === 0) {
    limitations.add("plan_outcome_not_decisive");
  }

  const { evaluatedAt: _evaluatedAt, ...stableInputEvidence } = evidence;
  const evidenceBody = {
    decisionId: trace.decisionId,
    projectId: evidence.plan.projectId,
    missionId: evidence.plan.missionId,
    sourceGoalId: identity.goalId,
    planRevision: evidence.plan.revision,
    selectedStrategyId,
    dispatchBatchId: evidence.dispatchBatch.id,
    dispatchManifestHash: evidence.dispatchBatch.manifestHash,
    planGoalIds: goalIds,
    requiredGoalIds,
    planTaskIds: taskIds,
    rootGoalIds,
    goalStates,
    taskStates,
    dispatchItems,
    executions,
    expectedEffectCodes,
    observedEffectCodes,
    contradictedEffectCodes,
    finalWorldState: evidence.finalWorldState,
    sourceEvidenceHash: canonicalJsonHash(stableInputEvidence),
  };
  const limitationsList = [...limitations].sort((left, right) => left.localeCompare(right));
  return MissionStrategyPlanOutcomeEvaluationSchema.parse({
    schemaVersion: trace.schemaVersion,
    decisionId: trace.decisionId,
    projectId: evidence.plan.projectId,
    missionId: evidence.plan.missionId,
    sourceGoalId: identity.goalId,
    planRevision: evidence.plan.revision,
    selectedStrategyId,
    dispatchBatchId: evidence.dispatchBatch.id,
    dispatchManifestHash: evidence.dispatchBatch.manifestHash,
    dispatchBatchState,
    outcome,
    planGoalIds: goalIds,
    requiredGoalIds,
    planTaskIds: taskIds,
    rootGoalIds,
    goalStates,
    taskStates,
    dispatchItems,
    executions,
    expectedEffectCodes,
    observedEffectCodes,
    contradictedEffectCodes,
    finalWorldState: evidence.finalWorldState,
    evidenceSetHash: canonicalJsonHash(evidenceBody),
    evaluatedAt: evidence.evaluatedAt,
    limitationCodes: outcome === "INCONCLUSIVE"
      ? (limitationsList.length > 0 ? limitationsList : ["plan_outcome_not_decisive"])
      : [],
  });
}
