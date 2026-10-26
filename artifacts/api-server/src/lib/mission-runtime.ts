import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { and, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiExecutionAcceptancesTable,
  aiGoalDependenciesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionHandoffsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  GoalNextActionSchema,
  isCandidateVerificationRecipeId,
  RecipeReceiptSchema,
  type GoalNextAction,
} from "@workspace/ai-orchestrator";
import {
  diagnoseRuntimeStartWorldStateFailure,
  type WorldStateFailureDiagnosis,
  type WorldStateFailureReason,
} from "./world-state-failure-diagnosis.js";
import {
  deriveMissionStatusFromGoals,
  selectActiveMissionGoals,
} from "./ai-execution-acceptance.js";
import { projectGoalAcceptance } from "./mission-acceptance-projection.js";
import {
  evaluateApplyChangesD2,
  resolveApplyChangesMissionRequirement,
} from "./agent-state/apply-changes-mission-gate.js";
import {
  deliveryWorkspaceExists,
  materializeDisposableCandidateWorkspace,
  resolveWorkspaceTreeRevision,
} from "./delivery-workspace.js";
import { establishProjectRoot } from "./project-root.js";
import {
  createRuntimeStartRunner,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";
import { createControlledLocalBareGitHubRequest } from "./local-bare-github-adapter.js";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";
import {
  parseAiExecutionCheckpoint,
  requestAiExecutionCancel,
} from "./ai-execution-state.js";
import {
  CANONICAL_PROOF_CONTRACT_VERSION,
  loadCanonicalProof,
} from "./proof-foundation.js";
import { EXECUTION_PROOF_CONTRACT_VERSION } from "./execution-proof.js";
import { getProjectWorldState } from "./agent-state/world-state.js";
import { taskScopeIdentity } from "./agent-state/observation-materializer.js";
import { scheduleAiTaskExecution } from "../routes/ai/tasks.js";
import { createMissionEventEnvelope, type MissionEventEnvelope } from "./mission-events.js";
import {
  buildMissionDelegationBinding,
  validateMissionDelegationBinding,
  type MissionDelegationBinding,
} from "./mission-delegation.js";
import {
  requireActiveSkillRegistry,
  SkillRegistryRuntimeError,
} from "./skill-registry.js";
import {
  persistMissionAgentActionEffectReceipt,
  type MissionAgentActionReceiptIdentity,
} from "./mission-agent-action-receipt.js";
import { resolveMissionLineage } from "./mission-lineage.js";
import { checkMissionCandidateAcceptance } from "./mission-candidate-acceptance.js";
import { getLifecycleWorkerScopeProjectId } from "./worker-scope.js";

export type MissionGoalRunTrigger = "activation" | "wake" | "resume" | "replan";

export type MissionGoalRunResult = {
  status: "scheduled" | "waiting" | "blocked" | "completed" | "conflict";
  goalId: string;
  taskId?: string;
  executionId?: string;
  reason?: string;
  delegation?: MissionDelegationBinding;
  recipeDispatch?: RecipeDispatch;
};

const ACTIVE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
const RECIPE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
const MISSION_EXTERNAL_EVENT_TYPE = "AiMissionExternalEventReceived";
type RecipeGoalAction = Extract<GoalNextAction, { kind: "recipe" }>;
type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WorldStateRevisionMismatchDiagnostic = {
  expectedWorldRevision: string;
  actualWorldRevision: string;
  expectedRevisionSource: "episode" | "transition";
  transitionId: string | null;
  transitionStatus: string | null;
  projectId: string;
  missionId: string;
  dependencyGoalId: string;
  executionId: string;
  episodeId: string;
  attempt: number;
  planRevision: string | null;
  taskScopeIdentity: string;
  environmentRevisionAvailable: boolean;
};
type GoalDependencyProofDiagnostics = {
  worldStateRevisionMismatch?: WorldStateRevisionMismatchDiagnostic;
};
type UnprovenGoalDependency = {
  id: string;
  title: string;
  failedChecks?: string[];
  worldStateRevisionMismatch?: WorldStateRevisionMismatchDiagnostic;
};
export type GoalDependencyState = {
  planRevision?: string;
  dependencies: Array<{ dependsOnGoalId: string }>;
  dependencyGoals: Array<typeof aiGoalsTable.$inferSelect>;
  unprovenDependencies: UnprovenGoalDependency[];
};
export type MissionGoalContinuationDenial =
  | "mission_operator_owned"
  | "mission_not_active"
  | "mission_needs_replan"
  | "goal_operator_owned"
  | "goal_needs_replan"
  | "goal_terminal"
  | "stale_plan_revision"
  | "dependency_failed"
  | "dependency_invalid"
  | "dependency_proof_unproven"
  | "dependencies_pending";
export type MissionGoalContinuationAuthorization =
  | { allowed: true; reason: "authorized"; dependencyState: GoalDependencyState }
  | {
      allowed: false;
      reason: MissionGoalContinuationDenial;
      dependencyState?: GoalDependencyState;
      dependency?: UnprovenGoalDependency;
    };

async function findGoalDependencyGraphIssue(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goal: Pick<typeof aiGoalsTable.$inferSelect, "id" | "title" | "outcomeContract">,
  path = new Set<string>(),
  visited = new Set<string>(),
): Promise<{ id: string; title: string } | undefined> {
  if (path.has(goal.id)) return { id: goal.id, title: "Dependency cycle" };
  if (visited.has(goal.id)) return undefined;
  if (visited.size >= 256) {
    return { id: goal.id, title: "Dependency graph exceeds validation limit" };
  }
  visited.add(goal.id);
  const nextPath = new Set(path);
  nextPath.add(goal.id);
  const planRevision = goalPlanRevision(goal);
  const edges = await tx
    .select({ dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId })
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.goalId, goal.id),
      eq(aiGoalDependenciesTable.missionId, mission.id),
      eq(aiGoalDependenciesTable.projectId, mission.projectId),
      ...(planRevision ? [eq(aiGoalDependenciesTable.planRevision, planRevision)] : []),
    ))
    .for("update");
  const dependencyIds = [...new Set(edges.map((edge) => edge.dependsOnGoalId))];
  if (dependencyIds.length === 0) return undefined;

  const dependencyGoals = await tx
    .select({
      id: aiGoalsTable.id,
      title: aiGoalsTable.title,
      outcomeContract: aiGoalsTable.outcomeContract,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, mission.id),
      eq(aiGoalsTable.projectId, mission.projectId),
      inArray(aiGoalsTable.id, dependencyIds),
    ))
    .for("update");
  const goalsById = new Map(dependencyGoals.map((dependency) => [dependency.id, dependency]));
  for (const dependencyId of dependencyIds) {
    const dependencyGoal = goalsById.get(dependencyId);
    if (!dependencyGoal) {
      return { id: dependencyId, title: "Missing dependency Goal" };
    }
    if (nextPath.has(dependencyGoal.id)) {
      return { id: dependencyGoal.id, title: "Dependency cycle" };
    }
    const issue = await findGoalDependencyGraphIssue(
      tx,
      mission,
      dependencyGoal,
      nextPath,
      visited,
    );
    if (issue) return issue;
  }
  return undefined;
}

function goalPlanRevision(goal: Pick<typeof aiGoalsTable.$inferSelect, "outcomeContract">): string | undefined {
  const contract = goal.outcomeContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return undefined;
  const revision = (contract as { planRevision?: unknown }).planRevision;
  if (!revision || typeof revision !== "object" || Array.isArray(revision)) return undefined;
  const hash = (revision as { hash?: unknown }).hash;
  return typeof hash === "string" && hash.trim() ? hash : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function goalCandidateIdentity(goal: typeof aiGoalsTable.$inferSelect): string | null {
  const outcome = jsonRecord(goal.outcomeContract);
  const scope = jsonRecord(outcome.acceptance);
  const nestedScope = jsonRecord(scope.scope);
  return typeof nestedScope.candidateIdentity === "string"
    ? nestedScope.candidateIdentity
    : typeof outcome.candidateIdentity === "string"
      ? outcome.candidateIdentity
      : null;
}

async function candidateTreeHashForDependency(params: {
  tx: MissionTransaction;
  mission: typeof aiMissionsTable.$inferSelect;
  dependencyGoal: typeof aiGoalsTable.$inferSelect;
}): Promise<{ candidateTreeHash: string; proposalId: string } | { reason: string } | undefined> {
  if (!goalCandidateIdentity(params.dependencyGoal)) return undefined;
  const acceptance = jsonRecord(jsonRecord(params.dependencyGoal.outcomeContract).acceptance);
  const executionId = typeof acceptance.executionId === "string" ? acceptance.executionId : null;
  const acceptanceId = typeof acceptance.acceptanceId === "string" ? acceptance.acceptanceId : null;
  if (!executionId || !acceptanceId) {
    return { reason: "dependency_candidate_acceptance_missing" };
  }

  const [execution] = await params.tx
    .select({
      id: aiExecutionsTable.id,
      operationId: aiExecutionsTable.operationId,
      goalId: aiExecutionsTable.goalId,
      attempt: aiExecutionsTable.attempt,
      status: aiExecutionsTable.status,
      baseRevision: aiExecutionsTable.baseRevision,
      userId: aiExecutionsTable.userId,
      sessionId: aiExecutionsTable.sessionId,
      proposalId: aiExecutionsTable.proposalId,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.projectId, params.dependencyGoal.projectId),
      eq(aiExecutionsTable.goalId, params.dependencyGoal.id),
      eq(aiExecutionsTable.status, "completed"),
    ))
    .for("update")
    .limit(1);
  if (!execution?.proposalId) {
    return { reason: "dependency_candidate_proposal_link_missing" };
  }

  const [proposal] = await params.tx
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, execution.proposalId),
      eq(aiChangeProposalsTable.projectId, params.dependencyGoal.projectId),
    ))
    .for("update")
    .limit(1);
  if (!proposal || !proposal.candidateTreeHash) {
    return { reason: "dependency_candidate_proposal_missing" };
  }
  if (!["validated", "committed"].includes(proposal.lifecycle)) {
    return { reason: "dependency_candidate_not_validated" };
  }

  const verifiedCandidate = await checkMissionCandidateAcceptance({
    tx: params.tx,
    projectId: params.dependencyGoal.projectId,
    userId: params.mission.userId,
    proposal,
    sourceExecution: execution,
  });
  if (
    !verifiedCandidate.accepted
    || verifiedCandidate.sourceExecutionId !== execution.id
    || verifiedCandidate.sourceMissionId !== params.mission.id
    || verifiedCandidate.sourceGoalId !== params.dependencyGoal.id
    || verifiedCandidate.sourceAcceptanceId !== acceptanceId
  ) {
    return { reason: "dependency_candidate_proof_unavailable" };
  }
  return { candidateTreeHash: proposal.candidateTreeHash, proposalId: proposal.id };
}

async function bindCandidateVerifyActionToDependencies(params: {
  tx: MissionTransaction;
  mission: typeof aiMissionsTable.$inferSelect;
  action: RecipeGoalAction,
  dependencies: readonly (typeof aiGoalsTable.$inferSelect)[];
}): Promise<{ ok: true; action: RecipeGoalAction } | { ok: false; reason: string }> {
  if (!isCandidateVerificationRecipeId(params.action.recipeId)) {
    return { ok: true, action: params.action };
  }
  const dependencyCandidates: Array<{ candidateTreeHash: string; proposalId: string }> = [];
  for (const dependencyGoal of params.dependencies) {
    const candidate = await candidateTreeHashForDependency({
      tx: params.tx,
      mission: params.mission,
      dependencyGoal,
    });
    if (candidate && "reason" in candidate) {
      return { ok: false, reason: candidate.reason };
    }
    if (candidate) dependencyCandidates.push(candidate);
  }
  if (dependencyCandidates.length === 0) return { ok: true, action: params.action };
  const distinctTreeHashes = [...new Set(dependencyCandidates.map((candidate) => candidate.candidateTreeHash))];
  const distinctProposalIds = [...new Set(dependencyCandidates.map((candidate) => candidate.proposalId))];
  if (distinctTreeHashes.length !== 1 || distinctProposalIds.length !== 1) {
    return { ok: false, reason: "dependency_candidate_identity_ambiguous" };
  }
  const candidateTreeHash = distinctTreeHashes[0]!;
  const candidateProposalId = distinctProposalIds[0]!;
  if (
    params.action.candidateIdentity
    && params.action.candidateIdentity !== candidateTreeHash
  ) {
    return { ok: false, reason: "dependency_candidate_identity_mismatch" };
  }
  if (
    params.action.candidateProposalId
    && params.action.candidateProposalId !== candidateProposalId
  ) {
    return { ok: false, reason: "dependency_candidate_proposal_mismatch" };
  }
  return {
    ok: true,
    action: {
      ...params.action,
      candidateIdentity: candidateTreeHash,
      candidateProposalId,
    },
  };
}

async function hasCurrentGoalDependencyProof(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  dependencyGoal: typeof aiGoalsTable.$inferSelect,
  dependencyPlanRevision: string | undefined,
  diagnostics?: GoalDependencyProofDiagnostics,
): Promise<string[]> {
  const contract = jsonRecord(dependencyGoal.outcomeContract);
  const acceptanceProjection = jsonRecord(contract.acceptance);
  const acceptanceScope = jsonRecord(acceptanceProjection.scope);
  const executionId = typeof acceptanceProjection.executionId === "string"
    ? acceptanceProjection.executionId.trim()
    : "";
  const activePlanRevision =
    typeof mission.autonomyPolicy.activePlanRevision === "string"
      ? mission.autonomyPolicy.activePlanRevision
      : undefined;

  const initialChecks = {
    goal_completed: dependencyGoal.status === "completed",
    plan_revision_present: Boolean(dependencyPlanRevision),
    goal_plan_revision_matches: goalPlanRevision(dependencyGoal) === dependencyPlanRevision,
    active_plan_revision_matches:
      !activePlanRevision || activePlanRevision === dependencyPlanRevision,
    acceptance_execution_id_present: Boolean(executionId),
    acceptance_succeeded: acceptanceProjection.outcome === "SUCCEEDED",
    acceptance_proven: acceptanceProjection.verdict === "PROVEN",
  };
  const failedInitialChecks = Object.entries(initialChecks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  if (failedInitialChecks.length > 0) return failedInitialChecks;

  const expectedProjectionScope: Record<string, string | undefined> = {
    projectId: dependencyGoal.projectId,
    missionId: mission.id,
    goalId: dependencyGoal.id,
    planRevision: dependencyPlanRevision,
  };
  for (const [key, expectedValue] of Object.entries(expectedProjectionScope)) {
    if (acceptanceScope[key] !== undefined
      && acceptanceScope[key] !== null
      && acceptanceScope[key] !== expectedValue
    ) return [`acceptance_scope_${key}_mismatch`];
  }

  const [execution] = await tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.projectId, dependencyGoal.projectId),
      eq(aiExecutionsTable.goalId, dependencyGoal.id),
    ))
    .for("update");
  if (
    !execution
    || execution.status !== "completed"
    || !execution.operationId
    || !execution.baseRevision
  ) {
    return [
      ...(!execution ? ["execution_missing"] : []),
      ...(execution && execution.status !== "completed" ? ["execution_not_completed"] : []),
      ...(execution && !execution.operationId ? ["execution_operation_id_missing"] : []),
      ...(execution && !execution.baseRevision ? ["execution_base_revision_missing"] : []),
    ];
  }
  if (
    acceptanceScope.operationId !== undefined
    && acceptanceScope.operationId !== null
    && acceptanceScope.operationId !== execution.operationId
  ) return ["acceptance_scope_operation_id_mismatch"];

  const candidateIdentity = goalCandidateIdentity(dependencyGoal);
  const canonicalProof = await loadCanonicalProof({
    tx,
    executionId: execution.id,
    scope: {
      projectId: dependencyGoal.projectId,
      missionId: mission.id,
      goalId: dependencyGoal.id,
      executionId: execution.id,
      operationId: execution.operationId,
      planRevision: dependencyPlanRevision,
      activePlanRevision: activePlanRevision ?? dependencyPlanRevision,
      sourceRevisionBinding: "execution",
      candidateIdentityBinding: candidateIdentity ? "required" : "not_applicable",
      candidateIdentity,
    },
    goalStatus: dependencyGoal.status,
    deliveryRequired: jsonRecord(dependencyGoal.outcomeContract).deliveryRequired === true
      && !isCandidateVerificationRecipeId(jsonRecord(dependencyGoal.nextAction).recipeId),
  });
  const canonicalProofChecks = {
    accepted: canonicalProof.accepted,
    contractVersion: canonicalProof.contractVersion === CANONICAL_PROOF_CONTRACT_VERSION,
    verdict: canonicalProof.verdict === "PROVEN",
    executionId: canonicalProof.executionId === execution.id,
    attempt: canonicalProof.attempt === execution.attempt,
    operationId: canonicalProof.operationId === execution.operationId,
    sourceRevision: canonicalProof.sourceRevision === execution.baseRevision,
    projectionVersion:
      canonicalProof.projection?.contractVersion === EXECUTION_PROOF_CONTRACT_VERSION,
  };
  const failedCanonicalChecks = Object.entries(canonicalProofChecks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  if (failedCanonicalChecks.length > 0) {
    if (acceptanceProjection.reasonCode === "APPLY_CHANGES_D2_PROVEN") {
      logger.warn({
        missionId: mission.id,
        dependencyGoalId: dependencyGoal.id,
        executionId: execution.id,
        failedChecks: failedCanonicalChecks,
        failureReasons: canonicalProof.failureReasons,
      }, "Mission Apply Changes dependency failed Canonical Proof revalidation");
    }
    return failedCanonicalChecks.map((check) => `canonical_proof_${check}`);
  }

  if (acceptanceProjection.reasonCode === "APPLY_CHANGES_D2_PROVEN") {
    const applyProof = await evaluateApplyChangesD2(tx, {
      goal: dependencyGoal,
      mission,
      activePlanRevision,
    });
    const stateProjection = jsonRecord(acceptanceProjection.stateProjection);
    const applyProofChecks = {
      proven: applyProof.state === "proven",
      executionId: applyProof.state === "proven" && applyProof.executionId === execution.id,
      attempt: applyProof.state === "proven" && applyProof.attempt === execution.attempt,
      acceptanceId: applyProof.state === "proven"
        && applyProof.acceptanceId === canonicalProof.acceptanceId,
      operationId: applyProof.state === "proven" && applyProof.operationId === execution.operationId,
      planRevision: applyProof.state === "proven"
        && applyProof.planRevision === dependencyPlanRevision,
      baseRevision: applyProof.state === "proven"
        && applyProof.requirement.baseRevision === canonicalProof.sourceRevision,
      candidateIdentity: applyProof.state === "proven"
        && applyProof.candidateIdentity === candidateIdentity,
      transitionId: applyProof.state === "proven"
        && stateProjection.transitionId === applyProof.transitionId,
      worldRevision: applyProof.state === "proven"
        && stateProjection.worldRevision === applyProof.resultingWorldRevision,
      environmentRevision: applyProof.state === "proven"
        && stateProjection.environmentRevision === applyProof.environmentRevision,
    };
    const failedApplyChecks = Object.entries(applyProofChecks)
      .filter(([, passed]) => !passed)
      .map(([check]) => check);
    if (failedApplyChecks.length > 0) {
      logger.warn({
        missionId: mission.id,
        dependencyGoalId: dependencyGoal.id,
        executionId: execution.id,
        applyProofState: applyProof.state,
        applyProofReason: applyProof.state === "pending" || applyProof.state === "failed"
          ? applyProof.reason
          : null,
        failedChecks: failedApplyChecks,
      }, "Mission Apply Changes dependency proof no longer matches its accepted projection");
      return failedApplyChecks.map((check) => `apply_proof_${check}`);
    }
    return [];
  }

  // Transition claimers lock Transition before Episode; only probe Episode identity here.
  const [episodeIdentity] = await tx
    .select({ id: aiAgentEpisodesTable.id })
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.projectId, dependencyGoal.projectId),
      eq(aiAgentEpisodesTable.executionId, execution.id),
      eq(aiAgentEpisodesTable.attempt, execution.attempt),
    ))
    .limit(1);
  if (!episodeIdentity) return ["episode_missing"];

  const [transition] = await tx
    .select({
      id: aiWorldTransitionsTable.id,
      status: aiWorldTransitionsTable.status,
      parentWorldRevision: aiWorldTransitionsTable.parentWorldRevision,
      resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
      resultingScopedWorldRevision: aiWorldTransitionsTable.resultingScopedWorldRevision,
      taskScope: aiWorldTransitionsTable.taskScope,
      environmentRevisionKey: aiWorldTransitionsTable.environmentRevisionKey,
      environmentRevision: aiWorldTransitionsTable.environmentRevision,
    })
    .from(aiWorldTransitionsTable)
    .where(and(
      eq(aiWorldTransitionsTable.projectId, dependencyGoal.projectId),
      eq(aiWorldTransitionsTable.executionId, execution.id),
      eq(aiWorldTransitionsTable.attempt, execution.attempt),
      eq(aiWorldTransitionsTable.episodeId, episodeIdentity.id),
    ))
    .orderBy(desc(aiWorldTransitionsTable.createdAt), desc(aiWorldTransitionsTable.id))
    .limit(1)
    .for("update");

  const [episode] = await tx
    .select()
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.id, episodeIdentity.id),
      eq(aiAgentEpisodesTable.projectId, dependencyGoal.projectId),
      eq(aiAgentEpisodesTable.executionId, execution.id),
      eq(aiAgentEpisodesTable.attempt, execution.attempt),
    ))
    .for("update")
    .limit(1);
  if (!episode) return ["episode_missing"];
  const episodeChecks = {
    project_id_matches: episode.projectId === dependencyGoal.projectId,
    mission_id_matches: episode.missionId === mission.id,
    goal_id_matches: episode.goalId === dependencyGoal.id,
    execution_id_matches: episode.executionId === execution.id,
    attempt_matches: episode.attempt === execution.attempt,
    completed: episode.state === "completed",
    achieved: episode.verdict === "achieved",
    closed: Boolean(episode.closedAt),
    plan_revision_matches: episode.planRevision === dependencyPlanRevision,
    project_revision_matches: episode.projectRevision === execution.baseRevision,
    // A Transition has its own scoped-result requirement below. Do not let a
    // legacy null scoped result collapse into the Episode-level diagnostic.
    world_revision_present: transition ? true : Boolean(episode.worldRevision),
  };
  const failedEpisodeChecks = Object.entries(episodeChecks)
    .filter(([, passed]) => !passed)
    .map(([check]) => `episode_${check}`);
  if (failedEpisodeChecks.length > 0) return failedEpisodeChecks;

  const taskScope = taskScopeIdentity(episode);
  if (taskScope.startsWith("unscoped:")) return ["episode_task_scope_unscoped"];
  const rawObservationRefs = episode.observationRefs;
  if (!Array.isArray(rawObservationRefs) || rawObservationRefs.length > 128) {
    return ["episode_observation_refs_invalid"];
  }
  const observationRefs = rawObservationRefs.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (
    observationRefs.length !== rawObservationRefs.length
    || new Set(observationRefs).size !== observationRefs.length
  ) return ["episode_observation_refs_invalid"];
  if (observationRefs.length > 0) {
    const expectedEnvironmentRevisionKey = episode.environmentRevision
      ? `revision:${episode.environmentRevision}`
      : "unknown";
    const observations = await tx
      .select()
      .from(aiAgentObservationsTable)
      .where(and(
        eq(aiAgentObservationsTable.projectId, episode.projectId),
        eq(aiAgentObservationsTable.executionId, episode.executionId),
        eq(aiAgentObservationsTable.episodeId, episode.id),
        inArray(aiAgentObservationsTable.id, observationRefs),
      ))
      .for("update");
    const failedObservationChecks = [
      ...(observations.length !== observationRefs.length ? ["observation_refs_resolve"] : []),
      ...(observations.some((observation) => observation.taskScope !== taskScope)
        ? ["observation_task_scope_matches"] : []),
      ...(observations.some((observation) =>
        observation.environmentRevisionKey !== expectedEnvironmentRevisionKey)
        ? ["observation_environment_revision_key_matches"] : []),
      ...(observations.some((observation) =>
        observation.projectRevision !== episode.projectRevision)
        ? ["observation_project_revision_matches"] : []),
      ...(observations.some((observation) =>
        observation.environmentRevision !== episode.environmentRevision)
        ? ["observation_environment_revision_matches"] : []),
      ...(observations.some((observation) => observation.completeness !== "complete")
        ? ["observation_complete"] : []),
      ...(observations.some((observation) => observation.freshness !== "fresh")
        ? ["observation_fresh"] : []),
      ...(observations.some((observation) => observation.environmentFreshness === "stale")
        ? ["observation_environment_not_stale"] : []),
    ].map((check) => `episode_${check}`);
    if (failedObservationChecks.length > 0) return failedObservationChecks;
  }

  if (transition) {
    const transitionFailures: string[] = [];
    if (transition.status !== "materialized") {
      transitionFailures.push("world_transition_not_materialized");
    }
    if (!transition.resultingWorldRevision) {
      transitionFailures.push("world_transition_result_missing");
    } else if (!/^[a-f0-9]{64}$/.test(transition.resultingWorldRevision)) {
      transitionFailures.push("world_transition_result_invalid");
    }
    if (!transition.resultingScopedWorldRevision) {
      transitionFailures.push("world_transition_scoped_result_missing");
    } else if (!/^[a-f0-9]{64}$/.test(transition.resultingScopedWorldRevision)) {
      transitionFailures.push("world_transition_scoped_result_invalid");
    }
    // The parent is project-wide and is validated while materializing. It must
    // not be compared with the Episode's scope-bound revision.
    if (!/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)) {
      transitionFailures.push("world_transition_parent_revision_invalid");
    }
    if (transition.taskScope !== taskScope) {
      transitionFailures.push("world_transition_task_scope_mismatch");
    }
    if (
      transition.environmentRevision !== episode.environmentRevision
      || transition.environmentRevisionKey !== (episode.environmentRevision
        ? `revision:${episode.environmentRevision}`
        : "unknown")
    ) {
      transitionFailures.push("world_transition_environment_revision_mismatch");
    }
    if (transitionFailures.length > 0) return transitionFailures;
  }

  const expectedWorldRevision = transition
    ? transition.resultingScopedWorldRevision
    : episode.worldRevision;
  if (!expectedWorldRevision) return ["episode_world_revision_present"];
  const currentWorldState = await getProjectWorldState(
    episode.projectId,
    {
      taskScope,
      environmentRevision: episode.environmentRevision,
      ...(transition ? {} : { excludeEpisodeIds: [episode.id] }),
    },
    tx,
  );
  const actualWorldRevision = currentWorldState.worldRevision;
  if (actualWorldRevision === expectedWorldRevision) return [];
  if (diagnostics) {
    diagnostics.worldStateRevisionMismatch = {
      expectedWorldRevision,
      actualWorldRevision,
      expectedRevisionSource: transition ? "transition" : "episode",
      transitionId: transition?.id ?? null,
      transitionStatus: transition?.status ?? null,
      projectId: episode.projectId,
      missionId: mission.id,
      dependencyGoalId: dependencyGoal.id,
      executionId: episode.executionId,
      episodeId: episode.id,
      attempt: episode.attempt,
      planRevision: dependencyPlanRevision ?? null,
      taskScopeIdentity: taskScope,
      environmentRevisionAvailable: episode.environmentRevision !== null,
    };
  }
  return ["world_state_revision_mismatch"];
}

async function loadGoalDependencyState(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goal: typeof aiGoalsTable.$inferSelect,
  options: {
    targetExecutionId?: string;
    ancestorPath?: Set<string>;
  } = {},
): Promise<GoalDependencyState> {
  const planRevision = goalPlanRevision(goal);
  const ancestorPath = options.ancestorPath ?? new Set<string>();
  if (ancestorPath.has(goal.id)) {
    return {
      planRevision,
      dependencies: [],
      dependencyGoals: [],
      unprovenDependencies: [{ id: goal.id, title: goal.title }],
    };
  }
  const nextAncestorPath = new Set(ancestorPath);
  nextAncestorPath.add(goal.id);

  const dependencyRows = await tx
    .select({ dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId })
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.goalId, goal.id),
      eq(aiGoalDependenciesTable.missionId, goal.missionId),
      eq(aiGoalDependenciesTable.projectId, goal.projectId),
      ...(planRevision ? [eq(aiGoalDependenciesTable.planRevision, planRevision)] : []),
    ))
    .for("update");
  const dependencies = [...new Map(
    dependencyRows.map((dependency) => [dependency.dependsOnGoalId, dependency]),
  ).values()];
  if (dependencies.length === 0) {
    return { planRevision, dependencies, dependencyGoals: [], unprovenDependencies: [] };
  }
  const graphIssue = await findGoalDependencyGraphIssue(tx, mission, goal);
  const dependencyGoals = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, goal.missionId),
      eq(aiGoalsTable.projectId, goal.projectId),
      inArray(aiGoalsTable.id, dependencies.map((dependency) => dependency.dependsOnGoalId)),
    ))
    .for("update");
  const unprovenDependencies: GoalDependencyState["unprovenDependencies"] =
    graphIssue ? [graphIssue] : [];
  const dependencyGoalsById = new Map(dependencyGoals.map((dependency) => [dependency.id, dependency]));
  for (const dependency of dependencies) {
    if (!dependencyGoalsById.has(dependency.dependsOnGoalId)) {
      unprovenDependencies.push({
        id: dependency.dependsOnGoalId,
        title: "Missing dependency Goal",
        failedChecks: ["dependency_goal_missing"],
      });
    }
  }

  const [targetExecution] = options.targetExecutionId
    ? await tx
      .select({
        id: aiExecutionsTable.id,
        createdAt: aiExecutionsTable.createdAt,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, options.targetExecutionId),
        eq(aiExecutionsTable.projectId, goal.projectId),
        eq(aiExecutionsTable.goalId, goal.id),
      ))
      .for("update")
    : [];
  if (options.targetExecutionId && !targetExecution) {
    unprovenDependencies.push({
      id: goal.id,
      title: goal.title,
      failedChecks: ["target_execution_missing"],
    });
  }

  for (const dependencyGoal of dependencyGoals) {
    if (dependencyGoal.status !== "completed") continue;
    const proofDiagnostics: GoalDependencyProofDiagnostics = {};
    const failedChecks = await hasCurrentGoalDependencyProof(
      tx,
      mission,
      dependencyGoal,
      planRevision,
      proofDiagnostics,
    );
    if (failedChecks.length > 0) {
      unprovenDependencies.push({
        id: dependencyGoal.id,
        title: dependencyGoal.title,
        failedChecks,
        ...(proofDiagnostics.worldStateRevisionMismatch
          ? { worldStateRevisionMismatch: proofDiagnostics.worldStateRevisionMismatch }
          : {}),
      });
      continue;
    }

    const dependencyAcceptance = jsonRecord(
      jsonRecord(dependencyGoal.outcomeContract).acceptance,
    );
    const dependencyExecutionId = typeof dependencyAcceptance.executionId === "string"
      ? dependencyAcceptance.executionId
      : "";
    const [dependencyExecution] = dependencyExecutionId
      ? await tx
        .select({
          id: aiExecutionsTable.id,
          createdAt: aiExecutionsTable.createdAt,
          completedAt: aiExecutionsTable.completedAt,
        })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.id, dependencyExecutionId),
          eq(aiExecutionsTable.projectId, dependencyGoal.projectId),
          eq(aiExecutionsTable.goalId, dependencyGoal.id),
        ))
        .for("update")
      : [];
    if (
      !dependencyExecution
      || !dependencyExecution.completedAt
      || (
        targetExecution
        && dependencyExecution.completedAt.getTime() >= targetExecution.createdAt.getTime()
      )
    ) {
      unprovenDependencies.push({ id: dependencyGoal.id, title: dependencyGoal.title });
      continue;
    }

    const ancestorState = await loadGoalDependencyState(tx, mission, dependencyGoal, {
      targetExecutionId: dependencyExecution.id,
      ancestorPath: nextAncestorPath,
    });
    const ancestorPending =
      ancestorState.dependencies.length !== ancestorState.dependencyGoals.length
      || ancestorState.dependencyGoals.some((ancestor) => ancestor.status !== "completed");
    if (ancestorPending || ancestorState.unprovenDependencies.length > 0) {
      unprovenDependencies.push(
        ancestorState.unprovenDependencies[0]
        ?? {
          id: dependencyGoal.id,
          title: dependencyGoal.title,
          failedChecks: ["ancestor_dependency_unproven"],
        },
      );
    }
  }
  return {
    planRevision,
    dependencies,
    dependencyGoals,
    unprovenDependencies: [...new Map(
      unprovenDependencies.map((dependency) => [dependency.id, dependency]),
    ).values()],
  };
}

export async function evaluateGoalDependencyState(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goal: typeof aiGoalsTable.$inferSelect,
  options: { targetExecutionId?: string } = {},
): Promise<GoalDependencyState> {
  return loadGoalDependencyState(tx, mission, goal, options);
}

export async function authorizeMissionGoalContinuation(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goal: typeof aiGoalsTable.$inferSelect,
  options: {
    targetExecutionId?: string;
    allowDraftDependencyWait?: boolean;
  } = {},
): Promise<MissionGoalContinuationAuthorization> {
  const activePlanRevision = typeof mission.autonomyPolicy.activePlanRevision === "string"
    ? mission.autonomyPolicy.activePlanRevision
    : undefined;
  const goalRevision = goalPlanRevision(goal);
  const draftDependencyWait = mission.status === "draft" && options.allowDraftDependencyWait === true;
  if (["blocked", "cancelled", "completed", "failed"].includes(mission.status)) {
    return { allowed: false, reason: "mission_operator_owned" };
  }
  if (mission.status === "draft" && !draftDependencyWait) {
    return { allowed: false, reason: "mission_not_active" };
  }
  if (mission.status === "needs_replan") {
    return { allowed: false, reason: "mission_needs_replan" };
  }
  if (["blocked", "waiting_for_approval"].includes(goal.status)) {
    return { allowed: false, reason: "goal_operator_owned" };
  }
  if (goal.status === "needs_replan") {
    return { allowed: false, reason: "goal_needs_replan" };
  }
  if (["cancelled", "completed", "failed"].includes(goal.status)) {
    return { allowed: false, reason: "goal_terminal" };
  }
  if (activePlanRevision && goalRevision !== activePlanRevision) {
    return { allowed: false, reason: "stale_plan_revision" };
  }

  const dependencyState = await loadGoalDependencyState(tx, mission, goal, options);
  const failedDependency = dependencyState.dependencyGoals.find((dependency) =>
    ["failed", "cancelled", "blocked", "needs_replan"].includes(dependency.status),
  );
  if (failedDependency) {
    return {
      allowed: false,
      reason: "dependency_failed",
      dependencyState,
      dependency: { id: failedDependency.id, title: failedDependency.title },
    };
  }
  if (dependencyState.dependencies.length !== dependencyState.dependencyGoals.length) {
    return { allowed: false, reason: "dependency_invalid", dependencyState };
  }
  const invalidDependency = dependencyState.unprovenDependencies.find((dependency) =>
    dependency.title === "Missing dependency Goal"
    || dependency.title === "Dependency cycle"
    || dependency.title === "Dependency graph exceeds validation limit",
  );
  if (invalidDependency) {
    return {
      allowed: false,
      reason: "dependency_invalid",
      dependencyState,
      dependency: invalidDependency,
    };
  }
  if (dependencyState.unprovenDependencies.length > 0) {
    return {
      allowed: false,
      reason: "dependency_proof_unproven",
      dependencyState,
      dependency: dependencyState.unprovenDependencies[0],
    };
  }
  if (draftDependencyWait) {
    return {
      allowed: false,
      reason: dependencyState.dependencyGoals.some((dependency) => dependency.status !== "completed")
        ? "dependencies_pending"
        : "mission_not_active",
      dependencyState,
    };
  }
  if (dependencyState.dependencyGoals.some((dependency) => dependency.status !== "completed")) {
    return { allowed: false, reason: "dependencies_pending", dependencyState };
  }
  return { allowed: true, reason: "authorized", dependencyState };
}

type MissionGoalStatusRow = Pick<
  typeof aiGoalsTable.$inferSelect,
  "id" | "status" | "successCriteria" | "outcomeContract"
>;

export async function deriveProofGatedMissionStatus(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goals: MissionGoalStatusRow[],
): Promise<ReturnType<typeof deriveMissionStatusFromGoals>> {
  if (["blocked", "cancelled", "completed", "failed"].includes(mission.status)) {
    return mission.status;
  }
  const proposedStatus = deriveMissionStatusFromGoals(
    selectActiveMissionGoals({ mission, goals }).map((goal) => goal.status),
  );
  if (proposedStatus !== "completed") return proposedStatus;
  const { evaluateMissionCompletion } = await import("./mission-completion-gate.js");
  const completion = await evaluateMissionCompletion(tx, {
    missionId: mission.id,
    projectId: mission.projectId,
  });
  return completion.allowed ? "completed" : "needs_replan";
}

export async function persistGoalDependencyProofBlocked(
  tx: MissionTransaction,
  input: {
    goal: typeof aiGoalsTable.$inferSelect;
    mission: typeof aiMissionsTable.$inferSelect;
    planRevision?: string;
    dependency: UnprovenGoalDependency;
  },
): Promise<void> {
  const now = new Date();
  await tx.update(aiGoalsTable)
    .set({
      status: "needs_replan",
      blockedReason: "dependency_proof_unproven",
      nextWakeAt: null,
      updatedAt: now,
    })
    .where(eq(aiGoalsTable.id, input.goal.id));
  await tx.update(aiMissionsTable)
    .set({ status: "needs_replan", updatedAt: now })
    .where(eq(aiMissionsTable.id, input.mission.id));
  await persistGoalDependencyProofBlockedEvent(tx, input);
}

async function persistGoalDependencyProofBlockedEvent(
  tx: MissionTransaction,
  input: {
    goal: typeof aiGoalsTable.$inferSelect;
    mission: typeof aiMissionsTable.$inferSelect;
    planRevision?: string;
    dependency: UnprovenGoalDependency;
  },
): Promise<void> {
  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiGoalDependencyProofBlocked",
    projectId: input.goal.projectId,
    goalId: input.goal.id,
    severity: "warning",
    message: `AI goal "${input.goal.title}" requires a replan because a dependency proof is not current`,
    payload: {
      missionId: input.mission.id,
      planRevision: input.planRevision,
      dependencyGoalId: input.dependency.id,
      reasonCode: "dependency_proof_unproven",
      ...(input.dependency.failedChecks?.length
        ? { failedChecks: [...new Set(input.dependency.failedChecks)].slice(0, 32) }
        : {}),
      ...(input.dependency.worldStateRevisionMismatch
        ? { worldStateRevisionMismatch: input.dependency.worldStateRevisionMismatch }
        : {}),
    },
  });
}

type RuntimeStartTransitionRequirement = {
  kind: "runtime.start";
  version: 1;
  sourceStepId: "runtime-start";
  targetStepId: string;
  from: "stopped";
  to: "running";
};

type RuntimeStartRequirementState =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; requirement: RuntimeStartTransitionRequirement };

type RuntimeStartTransitionProof = {
  transitionId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  effectBundleId: string;
  parentWorldRevision: string;
  resultingWorldRevision: string;
  projectRevision: string;
  environmentRevision: string;
  beforeObservationIds: string[];
  afterObservationIds: string[];
  sourceStepId: string;
  targetStepId: string;
  activePlanHash: string;
};

type RuntimeStartGateResult =
  | { state: "ready"; proof: RuntimeStartTransitionProof }
  | { state: "pending" }
  | { state: "failed"; diagnosis: WorldStateFailureDiagnosis };

function runtimeStartRequirementForGoal(
  goal: typeof aiGoalsTable.$inferSelect,
  activePlanRevision: string | undefined,
): RuntimeStartRequirementState {
  const criteria = jsonRecord(goal.successCriteria);
  const plan = jsonRecord(criteria.planRevision);
  const rawRequirements = plan.transitionRequirements;
  const targetStepId = typeof criteria.stepId === "string" ? criteria.stepId : undefined;
  const targetRequirementExists = Array.isArray(rawRequirements)
    && rawRequirements.some((candidate) =>
      candidate
      && typeof candidate === "object"
      && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).kind === "runtime.start"
      && (candidate as Record<string, unknown>).targetStepId === targetStepId,
    );
  const directRequirementExists = Object.hasOwn(criteria, "transitionRequirement");
  if (!targetRequirementExists && !directRequirementExists) return { kind: "none" };
  if (
    !activePlanRevision
    || plan.hash !== activePlanRevision
    || !targetStepId
    || !Array.isArray(rawRequirements)
  ) {
    return { kind: "invalid" };
  }
  const direct = jsonRecord(criteria.transitionRequirement);
  const requirement = rawRequirements.find((candidate) =>
    candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && (candidate as Record<string, unknown>).kind === "runtime.start"
    && (candidate as Record<string, unknown>).targetStepId === targetStepId,
  );
  if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
    return { kind: "invalid" };
  }
  const normalized = requirement as Record<string, unknown>;
  if (
    normalized.kind !== "runtime.start"
    || normalized.version !== 1
    || normalized.sourceStepId !== "runtime-start"
    || normalized.targetStepId !== targetStepId
    || normalized.from !== "stopped"
    || normalized.to !== "running"
    || direct.kind !== normalized.kind
    || direct.version !== normalized.version
    || direct.sourceStepId !== normalized.sourceStepId
    || direct.targetStepId !== normalized.targetStepId
    || direct.from !== normalized.from
    || direct.to !== normalized.to
  ) {
    return { kind: "invalid" };
  }
  return {
    kind: "valid",
    requirement: normalized as RuntimeStartTransitionRequirement,
  };
}

async function persistRuntimeTransitionFailure(
  tx: MissionTransaction,
  input: {
    goal: typeof aiGoalsTable.$inferSelect;
    mission: typeof aiMissionsTable.$inferSelect;
    planRevision: string | undefined;
    requirement: RuntimeStartTransitionRequirement;
    diagnosis: WorldStateFailureDiagnosis;
  },
): Promise<void> {
  const now = new Date();
  await tx.update(aiGoalsTable)
    .set({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
      nextWakeAt: null,
      outcomeContract: {
        ...jsonRecord(input.goal.outcomeContract),
        worldStateFailureDiagnosis: input.diagnosis,
      },
      updatedAt: now,
    })
    .where(eq(aiGoalsTable.id, input.goal.id));
  await tx.update(aiMissionsTable)
    .set({ status: "needs_replan", updatedAt: now })
    .where(eq(aiMissionsTable.id, input.mission.id));
  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiGoalTransitionRequirementBlocked",
    projectId: input.goal.projectId,
    goalId: input.goal.id,
    severity: "warning",
    message: `AI goal "${input.goal.title}" requires a replan because its runtime transition was not proven`,
    payload: {
      missionId: input.mission.id,
      planRevision: input.planRevision ?? null,
      sourceStepId: input.requirement.sourceStepId,
      targetStepId: input.requirement.targetStepId,
      worldStateFailureDiagnosis: input.diagnosis,
    },
  });
}

async function evaluateRuntimeStartTransitionGate(
  tx: MissionTransaction,
  input: {
    goal: typeof aiGoalsTable.$inferSelect;
    activePlanRevision: string | undefined;
    requirement: RuntimeStartTransitionRequirement;
  },
): Promise<RuntimeStartGateResult> {
  const failed = (
    reasonCode: WorldStateFailureReason,
    evidence: {
      transition?: unknown;
      supportingObservationIds?: string[];
      contradictingObservationIds?: string[];
    } = {},
  ): RuntimeStartGateResult => ({
    state: "failed",
    diagnosis: diagnoseRuntimeStartWorldStateFailure({ reasonCode, ...evidence }),
  });
  const missionGoals = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, input.goal.missionId),
      eq(aiGoalsTable.projectId, input.goal.projectId),
    ))
    .for("update");
  const source = missionGoals.find((candidate) => {
    const criteria = jsonRecord(candidate.successCriteria);
    return criteria.stepId === input.requirement.sourceStepId
      && goalPlanRevision(candidate) === input.activePlanRevision;
  });
  if (!source || source.id === input.goal.id) return failed("source_step_missing");
  const sourceCriteria = jsonRecord(source.successCriteria);
  const sourcePlan = jsonRecord(sourceCriteria.planRevision);
  const parsedAction = GoalNextActionSchema.safeParse(source.nextAction);
  if (
    sourcePlan.hash !== input.activePlanRevision
    || !parsedAction.success
    || parsedAction.data.kind !== "recipe"
    || parsedAction.data.recipeId !== "runtime.start"
    || parsedAction.data.recipeVersion !== 1
  ) {
    return failed("source_action_mismatch");
  }
  if (source.status !== "completed") return { state: "pending" };

  const executions = await tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.projectId, input.goal.projectId),
      eq(aiExecutionsTable.goalId, source.id),
      eq(aiExecutionsTable.status, "completed"),
    ))
    .for("update");
  if (executions.length === 0) return failed("accepted_execution_missing");
  const executionIds = executions.map((execution) => execution.id);
  const acceptances = await tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      inArray(aiExecutionAcceptancesTable.executionId, executionIds),
      eq(aiExecutionAcceptancesTable.outcome, "SUCCEEDED"),
    ))
    .for("update");
  const transitions = await tx
    .select()
    .from(aiWorldTransitionsTable)
    .where(and(
      eq(aiWorldTransitionsTable.projectId, input.goal.projectId),
      inArray(aiWorldTransitionsTable.executionId, executionIds),
    ))
    .for("update");
  const transition = transitions
    .filter((candidate) => acceptances.some((acceptance) =>
      acceptance.executionId === candidate.executionId
      && acceptance.attempt === candidate.attempt
      && acceptance.effectBundleId !== null
      && acceptance.effectBundleId === candidate.effectBundleId,
    ))
    .sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime()
      || left.id.localeCompare(right.id),
    )[0];
  if (!transition) return failed("accepted_transition_missing");
  if (transition.status === "pending" || transition.status === "retrying") return { state: "pending" };
  if (transition.status !== "materialized") {
    return failed("transition_terminal_failure", { transition });
  }
  const [sourceEpisode] = await tx
    .select()
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.id, transition.episodeId),
      eq(aiAgentEpisodesTable.projectId, input.goal.projectId),
      eq(aiAgentEpisodesTable.executionId, transition.executionId),
      eq(aiAgentEpisodesTable.attempt, transition.attempt),
    ))
    .for("update")
    .limit(1);
  if (
    !sourceEpisode
    || sourceEpisode.missionId !== input.goal.missionId
    || sourceEpisode.goalId !== source.id
    || sourceEpisode.planRevision !== input.activePlanRevision
  ) {
    return failed("transition_identity_invalid", { transition });
  }
  const sourceEpisodeTaskScope = taskScopeIdentity(sourceEpisode);
  if (
    !transition.resultingWorldRevision
    || !/^[a-f0-9]{64}$/.test(transition.parentWorldRevision)
    || !/^[a-f0-9]{64}$/.test(transition.resultingWorldRevision)
    || transition.freshness !== "fresh"
    || transition.taskScope !== sourceEpisodeTaskScope
  ) {
    return failed("transition_identity_invalid", { transition });
  }
  if (
    !transition.environmentRevision
    || !/^env-v1:[a-f0-9]{64}$/.test(transition.environmentRevision)
  ) {
    return failed("environment_revision_mismatch", { transition });
  }

  const idsFromJson = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string =>
        typeof id === "string" && id.trim().length > 0,
      ))]
    : [];
  const beforeIds = idsFromJson(transition.beforeObservationIds);
  const afterIds = idsFromJson(transition.afterObservationIds);
  if (beforeIds.length === 0 || afterIds.length === 0) {
    return failed("transition_observation_set_missing", { transition });
  }
  const observationIds = [...new Set([...beforeIds, ...afterIds])];
  const observations = await tx
    .select()
    .from(aiAgentObservationsTable)
    .where(and(
      eq(aiAgentObservationsTable.projectId, input.goal.projectId),
      inArray(aiAgentObservationsTable.id, observationIds),
    ))
    .for("update");
  if (
    observations.length !== observationIds.length
    || observations.some((observation) => (
      observation.executionId !== transition.executionId
      || observation.episodeId !== transition.episodeId
      || observation.provenance !== "DIRECT_OBSERVATION"
      || observation.completeness !== "complete"
      || observation.freshness !== "fresh"
      || observation.environmentFreshness !== "fresh"
    ))
  ) {
    const foundIds = new Set(observations.map((observation) => observation.id));
    const invalidObservationIds = observations.filter((observation) => (
      observation.executionId !== transition.executionId
      || observation.episodeId !== transition.episodeId
      || observation.provenance !== "DIRECT_OBSERVATION"
      || observation.completeness !== "complete"
      || observation.freshness !== "fresh"
      || observation.environmentFreshness !== "fresh"
    )).map((observation) => observation.id);
    return failed("observation_rows_invalid", {
      transition,
      supportingObservationIds: observationIds.filter((id) => foundIds.has(id)),
      contradictingObservationIds: invalidObservationIds,
    });
  }
  const beforeRows = observations.filter((observation) => beforeIds.includes(observation.id));
  const afterRows = observations.filter((observation) => afterIds.includes(observation.id));
  const before = beforeRows.find((observation) => {
    const value = jsonRecord(observation.value);
    return observation.predicate === "runtime.before_state"
      && value.status === "observed"
      && value.runtimeStatus === "stopped"
      && value.projectId === input.goal.projectId
      && value.sessionId === null
      && value.environmentRevision === transition.environmentRevision
      && typeof value.revision === "string"
      && observation.projectRevision === value.revision;
  });
  if (!before) {
    const beforePredicateRows = beforeRows.filter(
      (observation) => observation.predicate === "runtime.before_state",
    );
    const environmentRevisionMismatches = beforePredicateRows.filter((observation) =>
      jsonRecord(observation.value).environmentRevision !== transition.environmentRevision
      || observation.environmentRevision !== transition.environmentRevision,
    );
    if (environmentRevisionMismatches.length > 0) {
      return failed("environment_revision_mismatch", {
        transition,
        contradictingObservationIds: environmentRevisionMismatches.map((observation) => observation.id),
      });
    }
    return failed(beforePredicateRows.length > 0 ? "before_state_contradicted" : "before_state_missing", {
      transition,
      contradictingObservationIds: beforePredicateRows.map((observation) => observation.id),
    });
  }
  const sourceRevision = jsonRecord(before.value).revision as string;
  const after = afterRows.find((observation) => {
    const value = jsonRecord(observation.value);
    return observation.predicate === "runtime.after_state"
      && value.status === "passed"
      && value.runtimeStatus === "running"
      && value.projectId === input.goal.projectId
      && value.revision === sourceRevision
      && observation.projectRevision === sourceRevision
      && typeof value.sessionId === "string"
      && value.sessionId.trim().length > 0
      && value.environmentRevision === transition.environmentRevision
      && value.processAlive === true
      && value.portReady === true
      && Number.isInteger(value.pid)
      && Number.isInteger(value.port)
      && typeof value.observedAt === "string"
      && Number.isFinite(Date.parse(value.observedAt));
  });
  if (!after) {
    const afterPredicateRows = afterRows.filter(
      (observation) => observation.predicate === "runtime.after_state",
    );
    if (afterPredicateRows.length === 0) {
      return failed("after_state_missing", {
        transition,
        supportingObservationIds: [before.id],
      });
    }
    const projectRevisionMismatches = afterPredicateRows.filter((observation) => {
      const value = jsonRecord(observation.value);
      return value.revision !== sourceRevision
        || observation.projectRevision !== sourceRevision;
    });
    if (projectRevisionMismatches.length > 0) {
      return failed("project_revision_mismatch", {
        transition,
        supportingObservationIds: [before.id],
        contradictingObservationIds: projectRevisionMismatches.map((observation) => observation.id),
      });
    }
    const environmentRevisionMismatches = afterPredicateRows.filter(
      (observation) => jsonRecord(observation.value).environmentRevision !== transition.environmentRevision,
    );
    if (environmentRevisionMismatches.length > 0) {
      return failed("environment_revision_mismatch", {
        transition,
        supportingObservationIds: [before.id],
        contradictingObservationIds: environmentRevisionMismatches.map((observation) => observation.id),
      });
    }
    const missingSessionRows = afterPredicateRows.filter((observation) => {
      const sessionId = jsonRecord(observation.value).sessionId;
      return typeof sessionId !== "string" || sessionId.trim().length === 0;
    });
    if (missingSessionRows.length > 0) {
      return failed("session_evidence_missing", {
        transition,
        supportingObservationIds: [before.id, ...missingSessionRows.map((observation) => observation.id)],
      });
    }
    return failed("after_state_contradicted", {
      transition,
      supportingObservationIds: [before.id],
      contradictingObservationIds: afterPredicateRows.map((observation) => observation.id),
    });
  }
  const afterSessionId = jsonRecord(after.value).sessionId as string;
  const statusRows = afterRows.filter((observation) => observation.predicate === "runtime.status");
  const runningStatus = statusRows.find((observation) => observation.value === "running");
  if (!runningStatus) {
    return failed(statusRows.length > 0 ? "runtime_status_contradicted" : "runtime_status_missing", {
      transition,
      supportingObservationIds: [before.id, after.id],
      contradictingObservationIds: statusRows.map((observation) => observation.id),
    });
  }
  const evidenceRefs = idsFromJson(transition.evidenceRefs);
  if (!evidenceRefs.includes(`runtime:${afterSessionId}`)) {
    return failed("session_evidence_missing", {
      transition,
      supportingObservationIds: [before.id, after.id, runningStatus.id],
    });
  }
  // D2 is event-scoped: consume the exact revision and observations recorded
  // by this locked transition, without invalidating it for unrelated project changes.
  return {
    state: "ready",
    proof: {
      transitionId: transition.id,
      executionId: transition.executionId,
      attempt: transition.attempt,
      episodeId: transition.episodeId,
      actionId: transition.actionId,
      effectBundleId: transition.effectBundleId!,
      parentWorldRevision: transition.parentWorldRevision,
      resultingWorldRevision: transition.resultingWorldRevision,
      projectRevision: sourceRevision,
      environmentRevision: transition.environmentRevision,
      beforeObservationIds: beforeIds,
      afterObservationIds: afterIds,
      sourceStepId: input.requirement.sourceStepId,
      targetStepId: input.requirement.targetStepId,
      activePlanHash: input.activePlanRevision!,
    },
  };
}

type RecipeDispatch = {
  goalId: string;
  userId: string;
  projectId: string;
  missionId: string;
  operationId: string;
  idempotencyKey: string;
  expectedExecutionId?: string;
  expectedAttempt?: number;
  action: RecipeGoalAction;
  delegation: MissionDelegationBinding;
};

type MissionQueryExecutor = Pick<typeof db, "select">;

async function recipeOperationIdentity(
  executor: MissionQueryExecutor,
  projectId: string,
  goalId: string,
  action: RecipeGoalAction,
): Promise<{
  operationId: string;
  idempotencyKey: string;
} | undefined> {
  if (action.recipeId === "delivery.push.github") {
    if (!action.proposalId) return undefined;
    const [proposal] = await executor
      .select({
        operationId: aiChangeProposalsTable.operationId,
        lifecycle: aiChangeProposalsTable.lifecycle,
      })
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, action.proposalId),
        eq(aiChangeProposalsTable.projectId, projectId),
      ))
      .limit(1);
    if (!proposal || proposal.lifecycle !== "committed" || !proposal.operationId) {
      return undefined;
    }
    return {
      operationId: proposal.operationId,
      idempotencyKey: `mission-delivery:${goalId}:${action.proposalId}:${proposal.operationId}`,
    };
  }
  const digest = createHash("sha256").update(JSON.stringify({
    goalId,
    recipeId: action.recipeId,
    recipeVersion: action.recipeVersion,
    approvedPaths: action.approvedPaths,
    candidateIdentity: action.candidateIdentity ?? null,
    ...(action.candidateProposalId ? { candidateProposalId: action.candidateProposalId } : {}),
    ...(action.skill ? { skill: action.skill } : {}),
  })).digest("hex");
  return {
    operationId: `mission-goal-${goalId}-${digest.slice(0, 16)}`,
    idempotencyKey: `mission-goal:${goalId}:${digest.slice(0, 32)}`,
  };
}

async function authorizeMissionRecipeDispatch(
  dispatch: RecipeDispatch,
  execution?: {
    id: string;
    attempt?: number;
    sourceRevision?: string;
    candidateWorkspace?: string | null;
  },
  transaction?: MissionTransaction,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const authorize = async (
    tx: MissionTransaction,
  ): Promise<{ allowed: true } | { allowed: false; reason: string }> => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, dispatch.missionId),
        eq(aiMissionsTable.projectId, dispatch.projectId),
        eq(aiMissionsTable.userId, dispatch.userId),
      ))
      .for("update");
    if (!mission) return { allowed: false, reason: "mission_not_found" };
    const lineageResolution = await resolveMissionLineage(tx, mission, {
      requireAcceptedSource: true,
    });
    if (lineageResolution.kind === "unresolved") {
      return { allowed: false, reason: "mission_lineage_unresolved" };
    }
    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, dispatch.goalId),
        eq(aiGoalsTable.missionId, dispatch.missionId),
        eq(aiGoalsTable.projectId, dispatch.projectId),
      ))
      .for("update");
    if (!goal) return { allowed: false, reason: "goal_not_found" };

    const authorization = await authorizeMissionGoalContinuation(
      tx,
      mission,
      goal,
      execution?.id ? { targetExecutionId: execution.id } : {},
    );
    if (!authorization.allowed) return authorization;

    const currentAction = GoalNextActionSchema.safeParse(goal.nextAction);
    if (!currentAction.success || currentAction.data.kind !== "recipe") {
      return { allowed: false, reason: "recipe_action_changed" };
    }
    const currentIdentity = await recipeOperationIdentity(
      tx,
      dispatch.projectId,
      dispatch.goalId,
      currentAction.data,
    );
    if (
      !currentIdentity
      || currentIdentity.operationId !== dispatch.operationId
      || currentIdentity.idempotencyKey !== dispatch.idempotencyKey
    ) {
      return { allowed: false, reason: "recipe_identity_changed" };
    }
    if (!execution?.id) return { allowed: true };
    if (
      dispatch.expectedExecutionId
      && dispatch.expectedExecutionId !== execution.id
    ) {
      return { allowed: false, reason: "execution_identity_changed" };
    }

    const [durableExecution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, execution.id),
        eq(aiExecutionsTable.projectId, dispatch.projectId),
        eq(aiExecutionsTable.userId, dispatch.userId),
        eq(aiExecutionsTable.goalId, dispatch.goalId),
        eq(aiExecutionsTable.operationId, dispatch.operationId),
        eq(aiExecutionsTable.idempotencyKey, dispatch.idempotencyKey),
      ))
      .for("update");
    if (
      !durableExecution
      || durableExecution.status !== "queued"
      || durableExecution.cancelRequestedAt
      || (
        execution.attempt !== undefined
        && durableExecution.attempt !== execution.attempt
      )
      || (
        dispatch.expectedAttempt !== undefined
        && durableExecution.attempt !== dispatch.expectedAttempt
      )
    ) {
      return { allowed: false, reason: "execution_identity_changed" };
    }
    const checkpoint = parseAiExecutionCheckpoint(durableExecution.checkpoint);
    const binding = checkpoint?.recipeBinding;
    let persistedRequest: Record<string, unknown> = {};
    try {
      persistedRequest = jsonRecord(JSON.parse(durableExecution.request));
    } catch {
      return { allowed: false, reason: "execution_request_invalid" };
    }
    if (
      !binding
      || binding.projectId !== dispatch.projectId
      || binding.operationId !== dispatch.operationId
      || (binding.candidateIdentity ?? null) !== (dispatch.action.candidateIdentity ?? null)
      || JSON.stringify(binding.approvedPaths) !== JSON.stringify(dispatch.action.approvedPaths)
      || !["planned", "queued"].includes(binding.phase)
      || persistedRequest.projectId !== dispatch.projectId
      || persistedRequest.operationId !== dispatch.operationId
      || persistedRequest.message !== `recipe:${dispatch.operationId}`
      || persistedRequest.workspaceRevision !== binding.sourceRevision
      || (
        durableExecution.baseRevision
        && durableExecution.baseRevision !== binding.sourceRevision
      )
    ) {
      return { allowed: false, reason: "recipe_binding_changed" };
    }
    if (dispatch.action.candidateIdentity) {
      const requestWorkspaceRoot = typeof persistedRequest.workspaceRoot === "string"
        ? persistedRequest.workspaceRoot
        : undefined;
      if (
        typeof binding.candidateWorkspace !== "string"
        || !binding.candidateWorkspace
        || !requestWorkspaceRoot
        || (
          execution?.candidateWorkspace !== undefined
          && execution.candidateWorkspace !== binding.candidateWorkspace
        )
      ) {
        return { allowed: false, reason: "candidate_workspace_changed" };
      }
      try {
        const [checkpointCandidateRoot, requestWorkspace] = await Promise.all([
          realpath(binding.candidateWorkspace),
          realpath(requestWorkspaceRoot),
        ]);
        if (checkpointCandidateRoot !== requestWorkspace) {
          return { allowed: false, reason: "candidate_workspace_changed" };
        }
      } catch {
        return { allowed: false, reason: "candidate_workspace_unavailable" };
      }
    } else if ((binding.candidateWorkspace ?? null) !== null) {
      return { allowed: false, reason: "candidate_workspace_changed" };
    }
    if (
      execution?.sourceRevision
      && (
        binding.sourceRevision !== execution.sourceRevision
        || persistedRequest.workspaceRevision !== execution.sourceRevision
      )
    ) {
      return { allowed: false, reason: "execution_revision_changed" };
    }
    if (
      execution.sourceRevision
      && durableExecution.baseRevision
      && durableExecution.baseRevision !== execution.sourceRevision
    ) {
      return { allowed: false, reason: "execution_revision_changed" };
    }
    return { allowed: true };
  };
  return transaction ? authorize(transaction) : db.transaction(authorize);
}

async function loadGitHubDeliveryContext(
  projectId: string,
  action: RecipeGoalAction,
): Promise<{ proposalId: string; operationId: string } | undefined> {
  if (action.recipeId !== "delivery.push.github" || !action.proposalId) return undefined;
  const [proposal] = await db
    .select({
      operationId: aiChangeProposalsTable.operationId,
      lifecycle: aiChangeProposalsTable.lifecycle,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, action.proposalId),
      eq(aiChangeProposalsTable.projectId, projectId),
    ))
    .limit(1);
  if (!proposal || proposal.lifecycle !== "committed" || !proposal.operationId) return undefined;
  return {
    proposalId: action.proposalId,
    operationId: proposal.operationId,
  };
}

async function loadRecipeCandidate(
  projectId: string,
  action: RecipeGoalAction,
  sourceRevision: string,
): Promise<
  | { available: true; candidateWorkspace: string; operationId: string }
  | {
      available: false;
      reasonCode:
        | "candidate_proposal_not_found"
        | "candidate_proposal_identity_mismatch"
        | "candidate_not_validated"
        | "candidate_revision_mismatch"
        | "candidate_workspace_unavailable";
    }
  | undefined
> {
  if (!action.candidateIdentity) {
    return action.candidateProposalId
      ? { available: false, reasonCode: "candidate_proposal_identity_mismatch" }
      : undefined;
  }
  const [proposal] = await db
    .select({
      id: aiChangeProposalsTable.id,
      operationId: aiChangeProposalsTable.operationId,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      lifecycle: aiChangeProposalsTable.lifecycle,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.projectId, projectId),
      action.candidateProposalId
        ? eq(aiChangeProposalsTable.id, action.candidateProposalId)
        : eq(aiChangeProposalsTable.candidateTreeHash, action.candidateIdentity),
    ))
    .limit(1);
  if (!proposal) return { available: false, reasonCode: "candidate_proposal_not_found" };
  if (!["validated", "committed"].includes(proposal.lifecycle)) {
    return { available: false, reasonCode: "candidate_not_validated" };
  }
  if (proposal.baseRevision !== sourceRevision) {
    return { available: false, reasonCode: "candidate_revision_mismatch" };
  }
  if (
    !proposal.operationId
    || !proposal.workspaceRoot
    || proposal.candidateTreeHash !== action.candidateIdentity
    || !await deliveryWorkspaceExists(proposal.workspaceRoot, proposal.operationId)
  ) {
    return {
      available: false,
      reasonCode: proposal.candidateTreeHash !== action.candidateIdentity
        ? "candidate_proposal_identity_mismatch"
        : "candidate_workspace_unavailable",
    };
  }
  const candidateWorkspace = await materializeDisposableCandidateWorkspace({
    proposalId: proposal.id,
    operationId: proposal.operationId,
    workspaceRoot: proposal.workspaceRoot,
    candidateTreeHash: proposal.candidateTreeHash,
  });
  if (!candidateWorkspace) return { available: false, reasonCode: "candidate_workspace_unavailable" };
  return {
    available: true,
    candidateWorkspace,
    operationId: proposal.operationId,
  };
}

async function syncRecipeObjectiveState(params: {
  goalId: string;
  missionId: string;
  projectId: string;
  userId: string;
  operationId: string;
  idempotencyKey: string;
  executionId?: string;
  expectedExecutionId?: string;
  expectedAttempt?: number;
  attempt?: number;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  status: "completed" | "blocked" | "failed" | "needs_replan" | "verifying";
  reason?: string;
  deliveryReceipt?: {
    kind: "recipe";
    status: "completed";
    executionId?: string | null;
    attempt?: number | null;
    operationId?: string | null;
    sourceRevision?: string | null;
    candidateTreeHash?: string | null;
    treeHash?: string | null;
    canonicalMissionId?: string | null;
    applyMissionId?: string | null;
    sourceExecutionId?: string | null;
    sourceGoalId?: string | null;
    proposalId?: string | null;
  };
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, params.missionId),
        eq(aiMissionsTable.projectId, params.projectId),
      ))
      .for("update");
    if (!mission) return;
    const lineageResolution = await resolveMissionLineage(tx, mission, {
      requireAcceptedSource: params.status === "completed" || Boolean(params.deliveryReceipt),
    });
    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, params.goalId),
        eq(aiGoalsTable.missionId, params.missionId),
        eq(aiGoalsTable.projectId, params.projectId),
      ))
      .for("update");
    if (!goal) return;

    if (
      ["blocked", "cancelled", "completed", "failed"].includes(mission.status)
      || ["blocked", "cancelled", "completed", "failed", "waiting_for_approval"].includes(goal.status)
    ) {
      return;
    }

    const [durableExecution] = params.executionId
      ? await tx
          .select({
            id: aiExecutionsTable.id,
            userId: aiExecutionsTable.userId,
            goalId: aiExecutionsTable.goalId,
            operationId: aiExecutionsTable.operationId,
            idempotencyKey: aiExecutionsTable.idempotencyKey,
            attempt: aiExecutionsTable.attempt,
            baseRevision: aiExecutionsTable.baseRevision,
            status: aiExecutionsTable.status,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, params.executionId),
            eq(aiExecutionsTable.projectId, params.projectId),
            eq(aiExecutionsTable.goalId, params.goalId),
            eq(aiExecutionsTable.userId, params.userId),
            eq(aiExecutionsTable.operationId, params.operationId),
            eq(aiExecutionsTable.idempotencyKey, params.idempotencyKey),
          ))
          .for("update")
          .limit(1)
      : [];
    const outcome = jsonRecord(goal.outcomeContract);
    const acceptance = jsonRecord(outcome.acceptance);
    const acceptanceScope = jsonRecord(acceptance.scope);
    const nextAction = jsonRecord(goal.nextAction);
    const recipeId = typeof nextAction.recipeId === "string" ? nextAction.recipeId : null;
    const requiresExternalDeliveryIdentity = outcome.deliveryRequired === true
      && !isCandidateVerificationRecipeId(recipeId);
    const proposalId = typeof nextAction.proposalId === "string" ? nextAction.proposalId : null;
    const [proposal] = proposalId
      ? await tx
          .select({
            baseRevision: aiChangeProposalsTable.baseRevision,
            candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
            promotedTreeHash: aiChangeProposalsTable.promotedTreeHash,
            committedTreeHash: aiChangeProposalsTable.committedTreeHash,
          })
          .from(aiChangeProposalsTable)
          .where(and(
            eq(aiChangeProposalsTable.id, proposalId),
            eq(aiChangeProposalsTable.projectId, params.projectId),
          ))
          .limit(1)
      : [];
    const canonicalDeliveryReceipt = params.deliveryReceipt
      ? {
          ...params.deliveryReceipt,
          canonicalMissionId: lineageResolution.kind === "verified"
            ? lineageResolution.lineage.canonicalMissionId
            : lineageResolution.kind === "not_required"
              ? mission.id
              : null,
          applyMissionId: lineageResolution.kind === "verified"
            ? lineageResolution.lineage.applyMissionId
            : null,
          sourceExecutionId: lineageResolution.kind === "verified"
            ? lineageResolution.lineage.sourceExecutionId
            : null,
          sourceGoalId: lineageResolution.kind === "verified"
            ? lineageResolution.lineage.sourceGoalId
            : null,
          proposalId: lineageResolution.kind === "verified"
            ? lineageResolution.lineage.proposalId
            : proposalId,
          executionId: params.deliveryReceipt.executionId
            ?? params.executionId
            ?? null,
          attempt: params.deliveryReceipt.attempt
            ?? durableExecution?.attempt
            ?? null,
          operationId: params.deliveryReceipt.operationId
            ?? durableExecution?.operationId
            ?? (typeof acceptanceScope.operationId === "string"
              ? acceptanceScope.operationId
              : null),
          sourceRevision: params.deliveryReceipt.sourceRevision
            ?? params.sourceRevision
            ?? (typeof proposal?.baseRevision === "string" ? proposal.baseRevision : null)
            ?? durableExecution?.baseRevision
            ?? null,
          candidateTreeHash: params.deliveryReceipt.candidateTreeHash
            ?? (typeof proposal?.candidateTreeHash === "string" ? proposal.candidateTreeHash : null)
            ?? (typeof acceptanceScope.candidateIdentity === "string"
              ? acceptanceScope.candidateIdentity
              : null),
          treeHash: params.deliveryReceipt.treeHash
            ?? (typeof proposal?.committedTreeHash === "string" ? proposal.committedTreeHash : null)
            ?? (typeof proposal?.promotedTreeHash === "string" ? proposal.promotedTreeHash : null),
        }
      : null;

    let nextGoalStatus = params.status;
    let completionReason = params.reason;
    let canonicalProofAccepted = params.status !== "completed";
    if (params.status === "completed" && params.executionId) {
      const resultAttempt = params.attempt ?? params.expectedAttempt;
      const lineageAcceptable = lineageResolution.kind !== "unresolved";
      const executionIdentityValid = Boolean(
        lineageAcceptable
        &&
        durableExecution
        && durableExecution.status === "completed"
        && durableExecution.goalId === goal.id
        && durableExecution.userId === params.userId
        && durableExecution.operationId === params.operationId
        && durableExecution.idempotencyKey === params.idempotencyKey
        && (!params.expectedExecutionId || params.expectedExecutionId === params.executionId)
        && (resultAttempt === undefined || resultAttempt === durableExecution.attempt),
      );
      const continuation = executionIdentityValid && durableExecution
        ? await authorizeMissionGoalContinuation(tx, mission, goal, {
            targetExecutionId: durableExecution.id,
          })
        : { allowed: false as const, reason: "execution_identity_changed" };
      let canonicalProof: Awaited<ReturnType<typeof loadCanonicalProof>> | undefined;
      if (continuation.allowed && durableExecution) {
        const policy = jsonRecord(mission.autonomyPolicy);
        canonicalProof = await loadCanonicalProof({
          tx,
          executionId: params.executionId,
          scope: {
            projectId: params.projectId,
            missionId: params.missionId,
            goalId: goal.id,
            operationId: params.operationId,
            planRevision: goalPlanRevision(goal) ?? null,
            activePlanRevision: typeof policy.activePlanRevision === "string"
              ? policy.activePlanRevision
              : null,
            sourceRevisionBinding: params.sourceRevision == null ? "execution" : "scope",
            candidateIdentityBinding: (
              params.candidateIdentity ?? goalCandidateIdentity(goal)
            ) == null
              ? "not_applicable"
              : "required",
            sourceRevision: params.sourceRevision ?? null,
            candidateIdentity: params.candidateIdentity ?? goalCandidateIdentity(goal),
          },
          goalStatus: "completed",
          deliveryRequired: requiresExternalDeliveryIdentity,
          deliveryReceipt: canonicalDeliveryReceipt,
        });
      }
      canonicalProofAccepted = continuation.allowed && canonicalProof?.accepted === true;
      if (!canonicalProofAccepted) {
        if (canonicalProof && !canonicalProof.accepted) {
          console.log("canonical recipe proof rejected", {
            executionId: params.executionId,
            failureReasons: canonicalProof.failureReasons,
            delivery: canonicalProof.delivery,
            sourceRevision: canonicalProof.sourceRevision,
            candidateIdentity: canonicalProof.candidateIdentity,
          });
        }
        if (lineageResolution.kind === "unresolved") {
          nextGoalStatus = "blocked";
          completionReason = `mission_lineage_${lineageResolution.reason}`;
        } else if (!continuation.allowed) {
          nextGoalStatus = "needs_replan";
          completionReason = `mission_goal_continuation_${continuation.reason}`;
          if (
            continuation.reason === "dependency_proof_unproven"
            && "dependency" in continuation
            && continuation.dependency
          ) {
            await persistGoalDependencyProofBlockedEvent(tx, {
              goal,
              mission,
              planRevision: goalPlanRevision(goal),
              dependency: continuation.dependency,
            });
          }
        } else {
          nextGoalStatus = "verifying";
          completionReason = `canonical_proof_${canonicalProof?.failureReasons[0] ?? "incomplete"}`;
        }
      }
    } else if (params.status === "completed") {
      nextGoalStatus = "verifying";
      completionReason = "canonical_proof_missing_execution";
    }
    if (params.executionId) {
      await projectGoalAcceptance(tx, {
        goalId: goal.id,
        projectId: params.projectId,
        projection: {
          executionId: params.executionId,
          outcome: params.status === "completed" ? "SUCCEEDED" : "FAILED",
          verdict: params.status === "completed" && canonicalProofAccepted
            ? "PROVEN"
            : params.status === "completed"
              ? "INCOMPLETE"
              : nextGoalStatus === "needs_replan"
              ? "INCOMPLETE"
              : "FAILED",
          scope: {
            projectId: params.projectId,
            operationId: params.operationId,
          },
          sourceRevision: params.sourceRevision ?? durableExecution?.baseRevision ?? null,
          candidateIdentity: params.candidateIdentity ?? goalCandidateIdentity(goal),
          acceptedRefs: [params.executionId],
          receipt: {
            kind: "recipe",
            executionId: params.executionId,
            status: params.status,
          },
          deliveryReceipt: canonicalDeliveryReceipt,
          reasonCode: completionReason,
          updatedAt: new Date(),
        },
      });
    }
    await tx.update(aiGoalsTable)
      .set({
        status: nextGoalStatus,
        blockedReason: nextGoalStatus === "completed" || nextGoalStatus === "verifying"
          ? null
          : (completionReason ?? "Recipe execution did not complete."),
        completedAt: nextGoalStatus === "completed" ? goal.completedAt ?? new Date() : null,
        nextWakeAt: null,
        updatedAt: new Date(),
      })
      .where(eq(aiGoalsTable.id, goal.id));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalRecipeStatusSynced",
      projectId: params.projectId,
      goalId: goal.id,
      severity: nextGoalStatus === "completed" ? "success" : "warning",
      message: `AI goal "${goal.title}" → ${nextGoalStatus}`,
      payload: {
        missionId: params.missionId,
        executionId: params.executionId,
        status: nextGoalStatus,
      },
    });

    const goals = await tx
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
      })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, params.missionId),
        eq(aiGoalsTable.projectId, params.projectId),
      ))
      .for("update");
    if (["blocked", "cancelled", "completed", "failed"].includes(mission.status)) return;
    const nextMissionStatus = await deriveProofGatedMissionStatus(tx, mission, goals);
    if (mission.status === nextMissionStatus) return;
    await tx.update(aiMissionsTable)
      .set({
        status: nextMissionStatus,
        completedAt: nextMissionStatus === "completed" ? mission.completedAt ?? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(aiMissionsTable.id, mission.id));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionStatusSynced",
      projectId: params.projectId,
      goalId: goal.id,
      severity: nextMissionStatus === "completed" ? "success" : "info",
      message: `AI mission "${mission.title}" → ${nextMissionStatus}`,
      payload: {
        executionId: params.executionId,
        goalId: goal.id,
        status: nextMissionStatus,
      },
    });
  });
}

async function executeMissionRecipe(dispatch: RecipeDispatch): Promise<void> {
  try {
    const preflight = await authorizeMissionRecipeDispatch(
      dispatch,
      dispatch.expectedExecutionId
        ? { id: dispatch.expectedExecutionId, attempt: dispatch.expectedAttempt }
        : undefined,
    );
    if (!preflight.allowed) {
      if (dispatch.expectedExecutionId) {
        await requestAiExecutionCancel({
          executionId: dispatch.expectedExecutionId,
          userId: dispatch.userId,
        }).catch(() => undefined);
      }
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: preflight.reason,
      });
      return;
    }
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(
        eq(projectsTable.id, dispatch.projectId),
        eq(projectsTable.ownerId, dispatch.userId),
      ))
      .limit(1);
    if (!project) {
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: "project_not_found",
      });
      return;
    }
    const rootResult = await establishProjectRoot(project.rootPath);
    if (!rootResult.ok) {
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: "project_root_unavailable",
      });
      return;
    }
    const sourceRevision = await resolveWorkspaceTreeRevision(rootResult.canonicalPath);
    const delivery = await loadGitHubDeliveryContext(dispatch.projectId, dispatch.action);
    if (dispatch.action.recipeId === "delivery.push.github") {
      if (
        !delivery
        || dispatch.operationId !== delivery.operationId
        || project.status === "archived"
        || !project.gitRemoteUrl
      ) {
        await syncRecipeObjectiveState({
          ...dispatch,
          status: "blocked",
          reason: !delivery
            ? "delivery_proposal_not_committed"
            : project.status === "archived"
              ? "project_archived"
              : !project.gitRemoteUrl
                ? "delivery_remote_not_configured"
                : "delivery_operation_mismatch",
        });
        return;
      }
    }
    const candidate = await loadRecipeCandidate(dispatch.projectId, dispatch.action, sourceRevision);
    if (
      dispatch.action.candidateIdentity
      && (!candidate || !candidate.available)
    ) {
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: candidate && !candidate.available
          ? candidate.reasonCode
          : "candidate_proposal_not_found",
      });
      return;
    }
    let skillBinding;
    if (dispatch.action.skill) {
      try {
        skillBinding = await requireActiveSkillRegistry({
          projectId: dispatch.projectId,
          skillId: dispatch.action.skill.skillId,
          skillVersion: dispatch.action.skill.skillVersion,
          candidateId: dispatch.action.candidateIdentity,
          sourceRevision,
          candidateTreeHash: dispatch.action.candidateIdentity,
        });
      } catch (error) {
        await syncRecipeObjectiveState({
          ...dispatch,
          sourceRevision,
          candidateIdentity: dispatch.action.candidateIdentity ?? null,
          status: "blocked",
          reason: error instanceof SkillRegistryRuntimeError
            ? "skill_registry_not_active"
            : "skill_registry_unavailable",
        });
        return;
      }
    }
    const result = await runRecipeOperation({
      projectId: dispatch.projectId,
      goalId: dispatch.goalId,
      operationId: dispatch.operationId,
      rootPath: rootResult.canonicalPath,
      sourceRevision,
      recipeId: dispatch.action.recipeId,
      recipeVersion: dispatch.action.recipeVersion,
      ...(delivery ? { deliveryProposalId: delivery.proposalId } : {}),
      approvedPaths: dispatch.action.approvedPaths,
      candidateIdentity: dispatch.action.candidateIdentity ?? null,
      candidateWorkspace: candidate?.available ? candidate.candidateWorkspace : null,
      userId: dispatch.userId,
      idempotencyKey: dispatch.idempotencyKey,
      missionId: dispatch.missionId,
      planRevision: dispatch.delegation.planRevision ?? undefined,
      runtimeStartRunner: createRuntimeStartRunner(),
      ...(skillBinding ? { skillBinding } : {}),
      parentExecutionId: dispatch.delegation.parentExecutionId,
      ...(dispatch.action.recipeId === "runtime.start" ? {} : { proofRequired: true }),
      ...(dispatch.expectedExecutionId
        ? { expectedExecutionId: dispatch.expectedExecutionId }
        : {}),
      beforeClaim: async (
        { executionId, attempt }: { executionId: string; attempt: number },
        transaction,
      ) => {
        const authorization = await authorizeMissionRecipeDispatch(dispatch, {
          id: executionId,
          attempt,
          sourceRevision,
          candidateWorkspace: candidate?.available ? candidate.candidateWorkspace : null,
        }, transaction);
        return authorization.allowed;
      },
      ...(delivery && project.gitRemoteUrl
        ? {
            githubDeliveryRunner: async ({
              rootPath,
              projectId,
              operationId,
              executionId,
              executionAttempt,
              sourceRevision,
              message,
              signal,
               beforeStateObserver,
            }) => executeVerifiedGitHubDelivery({
              rootPath,
              projectId,
              operationId,
              executionId,
              executionAttempt,
              sourceRevision,
              proposalId: delivery.proposalId,
              remoteUrl: project.gitRemoteUrl!,
              branch: project.gitDefaultBranch ?? "main",
              message,
              signal,
              beforeStateObserver,
              request: await createControlledLocalBareGitHubRequest(project.gitRemoteUrl!),
            }),
          }
        : {}),
    });
    if (
      dispatch.expectedExecutionId
      && result.executionId !== dispatch.expectedExecutionId
    ) {
      throw new Error("Recovered recipe execution identity changed.");
    }
    const parsedReceipt = RecipeReceiptSchema.safeParse(result.receipt).data;
    const receiptIsComplete = Boolean(parsedReceipt);
    const [goalAfterExecution] = await db
      .select({ outcomeContract: aiGoalsTable.outcomeContract })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, dispatch.goalId),
        eq(aiGoalsTable.missionId, dispatch.missionId),
        eq(aiGoalsTable.projectId, dispatch.projectId),
      ))
      .limit(1);
    const deliveryRequired = goalAfterExecution?.outcomeContract
      && typeof goalAfterExecution.outcomeContract === "object"
      && !Array.isArray(goalAfterExecution.outcomeContract)
      && (goalAfterExecution.outcomeContract as { deliveryRequired?: unknown }).deliveryRequired === true;
    const measurementContinuationRequiresReplan = Boolean(result.measurementContinuation);
    await syncRecipeObjectiveState({
      ...dispatch,
      executionId: result.executionId,
      attempt: parsedReceipt?.attempt,
      sourceRevision,
      candidateIdentity: dispatch.action.candidateIdentity ?? null,
      status: measurementContinuationRequiresReplan
        ? "needs_replan"
        : result.status === "completed" && receiptIsComplete
          ? "completed"
          : "blocked",
      reason: measurementContinuationRequiresReplan
        ? result.measurementContinuation?.reasonCode
        : result.status === "completed" && !receiptIsComplete
        ? "recipe_receipt_invalid"
        : result.status === "completed"
          ? undefined
          : "recipe_acceptance_blocked",
      ...(result.status === "completed" && receiptIsComplete && deliveryRequired
        ? {
            deliveryReceipt: {
              kind: "recipe" as const,
              status: "completed" as const,
              executionId: parsedReceipt?.executionId ?? result.executionId,
              attempt: parsedReceipt?.attempt ?? null,
              operationId: parsedReceipt?.operationId ?? dispatch.operationId,
              sourceRevision: parsedReceipt?.sourceRevision ?? sourceRevision,
              candidateTreeHash: parsedReceipt?.candidateTreeHash
                ?? dispatch.action.candidateIdentity
                ?? null,
              treeHash: parsedReceipt?.treeHash ?? null,
            },
          }
        : {}),
    });
  } catch (error) {
    logger.warn({
      goalId: dispatch.goalId,
      operationId: dispatch.operationId,
      error: error instanceof Error ? error.message.slice(0, 240) : "recipe_execution_failed",
    }, "Mission recipe execution failed");
    await syncRecipeObjectiveState({
      ...dispatch,
      status: "needs_replan",
      reason: "recipe_execution_failed",
    }).catch(() => undefined);
  }
}

/**
 * Re-dispatches Mission recipe executions that were durably created but had
 * not acquired a worker before the process stopped. Running/paused executions
 * are intentionally excluded: the shared AI execution reconciler owns those
 * uncertain leases and external-effect recovery.
 */
export async function dispatchPendingMissionRecipes(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const pending = await db
    .select({
      executionId: aiExecutionsTable.id,
      operationId: aiExecutionsTable.operationId,
      idempotencyKey: aiExecutionsTable.idempotencyKey,
      attempt: aiExecutionsTable.attempt,
      userId: aiExecutionsTable.userId,
      goalId: aiExecutionsTable.goalId,
      missionId: aiGoalsTable.missionId,
      projectId: aiExecutionsTable.projectId,
      checkpoint: aiExecutionsTable.checkpoint,
      nextAction: aiGoalsTable.nextAction,
      outcomeContract: aiGoalsTable.outcomeContract,
    })
    .from(aiExecutionsTable)
    .innerJoin(aiGoalsTable, eq(aiGoalsTable.id, aiExecutionsTable.goalId))
    .where(and(
      eq(aiExecutionsTable.status, "queued"),
      isNotNull(aiExecutionsTable.goalId),
      scopeProjectId ? eq(aiExecutionsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(aiExecutionsTable.createdAt, aiExecutionsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let dispatched = 0;
  for (const row of pending) {
    const action = GoalNextActionSchema.safeParse(row.nextAction);
    const checkpoint = parseAiExecutionCheckpoint(row.checkpoint);
    const binding = checkpoint?.recipeBinding;
    const recipeAction = action.success && action.data.kind === "recipe"
      ? action.data
      : undefined;
    if (
      !recipeAction
      || !row.operationId
      || !binding
      || binding.projectId !== row.projectId
      || binding.operationId !== row.operationId
    ) {
      continue;
    }
    const identity = await recipeOperationIdentity(db, row.projectId, row.goalId!, recipeAction);
    if (!identity) continue;
    if (
      identity.operationId !== row.operationId
      || identity.idempotencyKey !== row.idempotencyKey
    ) continue;
    const dispatch: RecipeDispatch = {
      goalId: row.goalId!,
      userId: row.userId,
      projectId: row.projectId,
      missionId: row.missionId,
      operationId: identity.operationId,
      idempotencyKey: identity.idempotencyKey,
      expectedExecutionId: row.executionId,
      expectedAttempt: row.attempt,
      action: recipeAction,
      delegation: buildMissionDelegationBinding({
        missionId: row.missionId,
        goalId: row.goalId!,
        taskId: null,
        planRevision: goalPlanRevision({
          outcomeContract: row.outcomeContract,
        } as typeof aiGoalsTable.$inferSelect),
        userId: row.userId,
        trigger: "resume",
      }),
    };
    const authorization = await authorizeMissionRecipeDispatch(dispatch, {
      id: row.executionId,
      attempt: row.attempt,
    });
    if (!authorization.allowed) {
      await requestAiExecutionCancel({
        executionId: row.executionId,
        userId: row.userId,
      }).catch(() => undefined);
      continue;
    }
    const added = heavyJobQueue.enqueueWithId(row.executionId, async () => {
      await executeMissionRecipe(dispatch);
    });
    if (added) dispatched += 1;
  }
  return dispatched;
}

/**
 * Dispatches one server-owned Goal action through the existing task lifecycle.
 *
 * This is deliberately a coordinator, not a second execution state machine:
 * task work still enters scheduleAiTaskExecution(), and acceptance remains the
 * source of Goal/Mission terminal status.
 */
export async function runMissionGoal(params: {
  goalId: string;
  userId: string;
  trigger: MissionGoalRunTrigger;
  actionReceipt?: MissionAgentActionReceiptIdentity;
  delegation?: MissionDelegationBinding;
  expectedHandoffBinding?: {
    handoffId: string;
    missionId: string;
    projectId: string;
    planRevision: string;
    dispatchGoalIds: string[];
  };
}): Promise<MissionGoalRunResult> {
  const decision = await db.transaction(async (tx): Promise<MissionGoalRunResult> => {
    const recordActionEffect = async <T extends MissionGoalRunResult>(run: T): Promise<T> => {
      if (
        params.actionReceipt
        && (run.status === "scheduled" || run.status === "completed")
      ) {
        await persistMissionAgentActionEffectReceipt(tx, params.actionReceipt, {
          outcome: run.status === "completed" ? "completed" : "accepted",
          operation: {
            goalId: run.goalId,
            ...(run.executionId ? { executionId: run.executionId } : {}),
            status: run.status,
          },
          run: {
            status: run.status,
            goalId: run.goalId,
            taskId: run.taskId ?? null,
            executionId: run.executionId ?? null,
            reason: run.reason ?? null,
          },
        });
      }
      return run;
    };
    const decision = await (async (): Promise<MissionGoalRunResult> => {
    const [goalIdentity] = await tx
      .select({
        missionId: aiGoalsTable.missionId,
        projectId: aiGoalsTable.projectId,
      })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, params.goalId))
      .limit(1);
    if (!goalIdentity) {
      return { status: "conflict" as const, goalId: params.goalId, reason: "goal_not_found" };
    }
    const workerScopeProjectId = getLifecycleWorkerScopeProjectId();
    if (workerScopeProjectId && goalIdentity.projectId !== workerScopeProjectId) {
      return {
        status: "conflict" as const,
        goalId: params.goalId,
        reason: "worker_project_scope_mismatch",
      };
    }

    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, goalIdentity.missionId),
        eq(aiMissionsTable.projectId, goalIdentity.projectId),
        eq(aiMissionsTable.userId, params.userId),
      ))
      .for("update");
    if (!mission) {
      return { status: "conflict" as const, goalId: params.goalId, reason: "mission_not_found" };
    }

    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, params.goalId),
        eq(aiGoalsTable.missionId, mission.id),
        eq(aiGoalsTable.projectId, mission.projectId),
      ))
      .for("update");
    if (!goal) {
      return { status: "conflict" as const, goalId: params.goalId, reason: "goal_not_found" };
    }

    if (params.expectedHandoffBinding) {
      const [handoff] = await tx
        .select()
        .from(aiMissionHandoffsTable)
        .where(and(
          eq(aiMissionHandoffsTable.id, params.expectedHandoffBinding.handoffId),
          eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
        ))
        .for("update");
      const planGoals = handoff?.activationPlan?.goals;
      const validPlanGoals = Array.isArray(planGoals)
        && planGoals.every((planGoal) => (
          Boolean(planGoal)
          && typeof planGoal.goalId === "string"
          && Boolean(planGoal.goalId.trim())
          && Array.isArray(planGoal.dependencies)
          && planGoal.dependencies.every((dependency) => typeof dependency === "string")
        ));
      const durableRootGoalIds = validPlanGoals
        ? planGoals
          .filter((planGoal) => planGoal.dependencies.length === 0)
          .map((planGoal) => planGoal.goalId)
        : [];
      if (
        !handoff
        || handoff.missionId !== params.expectedHandoffBinding.missionId
        || handoff.projectId !== params.expectedHandoffBinding.projectId
        || handoff.userId !== params.userId
        || handoff.planHash !== params.expectedHandoffBinding.planRevision
        || handoff.activationPlan.revision !== params.expectedHandoffBinding.planRevision
        || !validPlanGoals
        || JSON.stringify(handoff.dispatchGoalIds)
          !== JSON.stringify(params.expectedHandoffBinding.dispatchGoalIds)
        || JSON.stringify(durableRootGoalIds)
          !== JSON.stringify(params.expectedHandoffBinding.dispatchGoalIds)
        || !durableRootGoalIds.includes(goal.id)
      ) {
        return {
          status: "conflict" as const,
          goalId: goal.id,
          reason: "handoff_identity_changed",
        };
      }
    }

    const activePlanRevision = typeof mission.autonomyPolicy.activePlanRevision === "string"
      ? mission.autonomyPolicy.activePlanRevision
      : undefined;
    const goalRevision = goalPlanRevision(goal);
    if (
      params.expectedHandoffBinding
      && (
        mission.id !== params.expectedHandoffBinding.missionId
        || mission.projectId !== params.expectedHandoffBinding.projectId
      )
    ) {
      return {
        status: "conflict" as const,
        goalId: goal.id,
        reason: "handoff_mission_identity_changed",
      };
    }
    if (
      params.expectedHandoffBinding
      && (
        !params.expectedHandoffBinding.planRevision
        || activePlanRevision !== params.expectedHandoffBinding.planRevision
        || goalRevision !== params.expectedHandoffBinding.planRevision
      )
    ) {
      return {
        status: "conflict" as const,
        goalId: goal.id,
        reason: "handoff_plan_revision_changed",
      };
    }

    const delegation = buildMissionDelegationBinding({
      missionId: mission.id,
      goalId: goal.id,
      parentExecutionId: params.delegation?.parentExecutionId ?? null,
      planRevision: goalRevision ?? activePlanRevision ?? null,
      userId: mission.userId,
      trigger: params.trigger,
    });
    if (params.delegation) {
      const bindingCheck = validateMissionDelegationBinding(params.delegation, {
        missionId: mission.id,
        goalId: goal.id,
        userId: mission.userId,
        planRevision: delegation.planRevision,
      });
      if (!bindingCheck.allowed) {
        return { status: "conflict" as const, goalId: goal.id, reason: bindingCheck.reason };
      }
    }

    const draftWaitAction = GoalNextActionSchema.safeParse(goal.nextAction);
    if (
      goal.status === "waiting_for_approval"
      && draftWaitAction.success
      && draftWaitAction.data.kind === "wait"
      && draftWaitAction.data.reason === "approval"
    ) {
      return { status: "waiting" as const, goalId: goal.id, reason: "approval" };
    }
    const allowDraftDependencyWait = params.trigger === "resume"
      && draftWaitAction.success
      && draftWaitAction.data.kind === "recipe"
      && draftWaitAction.data.recipeId === "delivery.push.github"
      && typeof draftWaitAction.data.proposalId === "string";
    const continuation = await authorizeMissionGoalContinuation(tx, mission, goal, {
      allowDraftDependencyWait,
    });
    if (!continuation.allowed) {
      const dependencyState = continuation.dependencyState;
      if (continuation.reason === "stale_plan_revision") {
        return { status: "conflict" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (continuation.reason === "mission_operator_owned") {
        return mission.status === "blocked" || mission.status === "failed"
          ? { status: "blocked" as const, goalId: goal.id, reason: continuation.reason }
          : { status: "completed" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (continuation.reason === "goal_terminal") {
        return goal.status === "failed"
          ? { status: "blocked" as const, goalId: goal.id, reason: continuation.reason }
          : { status: "completed" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (continuation.reason === "goal_operator_owned") {
        return { status: "blocked" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (
        continuation.reason === "mission_not_active"
        || continuation.reason === "mission_needs_replan"
        || continuation.reason === "goal_needs_replan"
      ) {
        return { status: "blocked" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (continuation.reason === "dependency_failed" && dependencyState) {
        const failedDependency = continuation.dependency
          ?? dependencyState.dependencyGoals.find((dependency) =>
            ["failed", "cancelled", "blocked", "needs_replan"].includes(dependency.status),
          );
        if (failedDependency) {
          const failedStatus = dependencyState.dependencyGoals.find((dependency) =>
            dependency.id === failedDependency.id,
          )?.status;
          const now = new Date();
          await tx.update(aiGoalsTable)
            .set({
              status: "needs_replan",
              blockedReason: `Dependency "${failedDependency.title}" did not complete.`,
              nextWakeAt: null,
              updatedAt: now,
            })
            .where(eq(aiGoalsTable.id, goal.id));
          await tx.update(aiMissionsTable)
            .set({ status: "needs_replan", updatedAt: now })
            .where(eq(aiMissionsTable.id, mission.id));
          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "AiGoalDependencyBlocked",
            projectId: goal.projectId,
            goalId: goal.id,
            severity: "warning",
            message: `AI goal "${goal.title}" requires a replan because a dependency did not complete`,
            payload: {
              missionId: mission.id,
              planRevision: dependencyState.planRevision,
              dependencyGoalId: failedDependency.id,
              dependencyStatus: failedStatus ?? null,
            },
          });
        }
        return { status: "blocked" as const, goalId: goal.id, reason: continuation.reason };
      }
      if (
        (continuation.reason === "dependency_invalid"
          || continuation.reason === "dependency_proof_unproven")
        && dependencyState
      ) {
        await persistGoalDependencyProofBlocked(tx, {
          goal,
          mission,
          planRevision: dependencyState.planRevision,
          dependency: continuation.dependency
            ?? dependencyState.unprovenDependencies[0]
            ?? { id: goal.id, title: goal.title },
        });
        return { status: "blocked" as const, goalId: goal.id, reason: "dependency_proof_unproven" };
      }
      if (continuation.reason === "dependencies_pending") {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "waiting_for_event",
            blockedReason: "dependencies_pending",
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        await tx.update(aiMissionsTable)
          .set({ status: "waiting", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
        return { status: "waiting" as const, goalId: goal.id, reason: continuation.reason };
      }
      return { status: "conflict" as const, goalId: goal.id, reason: continuation.reason };
    }
    const dependencyState = continuation.dependencyState;
    let nextActionForDispatch: unknown = goal.nextAction;
    const parsedNextAction = GoalNextActionSchema.safeParse(nextActionForDispatch);
    if (parsedNextAction.success && parsedNextAction.data.kind === "recipe") {
      const candidateBinding = await bindCandidateVerifyActionToDependencies({
        tx,
        mission,
        action: parsedNextAction.data,
        dependencies: dependencyState.dependencyGoals,
      });
      if (!candidateBinding.ok) {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "needs_replan",
            blockedReason: candidateBinding.reason,
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(and(
            eq(aiGoalsTable.id, goal.id),
            eq(aiGoalsTable.missionId, mission.id),
            eq(aiGoalsTable.projectId, goal.projectId),
          ));
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
        return {
          status: "blocked" as const,
          goalId: goal.id,
          reason: candidateBinding.reason,
        };
      }
      if (
        candidateBinding.action.candidateIdentity
        !== parsedNextAction.data.candidateIdentity
      ) {
        const [boundGoal] = await tx.update(aiGoalsTable)
          .set({
            nextAction: candidateBinding.action,
            updatedAt: new Date(),
          })
          .where(and(
            eq(aiGoalsTable.id, goal.id),
            eq(aiGoalsTable.missionId, mission.id),
            eq(aiGoalsTable.projectId, goal.projectId),
          ))
          .returning({ id: aiGoalsTable.id });
        if (!boundGoal) {
          return { status: "conflict" as const, goalId: goal.id, reason: "goal_disappeared" };
        }
      }
      nextActionForDispatch = candidateBinding.action;
    }
    if (
      dependencyState.dependencies.length > 0
      && goal.status === "waiting_for_event"
      && goal.blockedReason === "dependencies_pending"
    ) {
      await tx.update(aiGoalsTable)
        .set({ status: "queued", blockedReason: null, updatedAt: new Date() })
        .where(eq(aiGoalsTable.id, goal.id));
    }

    const runtimeStartRequirement = runtimeStartRequirementForGoal(goal, activePlanRevision);
    if (runtimeStartRequirement.kind === "invalid") {
      const now = new Date();
      await tx.update(aiGoalsTable)
        .set({
          status: "needs_replan",
          blockedReason: "runtime_start_transition_requirement_invalid",
          nextWakeAt: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      await tx.update(aiMissionsTable)
        .set({ status: "needs_replan", updatedAt: now })
        .where(eq(aiMissionsTable.id, mission.id));
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalTransitionRequirementBlocked",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "warning",
        message: `AI goal "${goal.title}" has an invalid runtime transition requirement`,
        payload: { missionId: mission.id, planRevision: goalRevision },
      });
      return { status: "blocked" as const, goalId: goal.id, reason: "runtime_start_transition_requirement_invalid" };
    }
    let runtimeTransitionProof: RuntimeStartTransitionProof | undefined;
    if (runtimeStartRequirement.kind === "valid") {
      const transitionResult = await evaluateRuntimeStartTransitionGate(tx, {
        goal,
        activePlanRevision,
        requirement: runtimeStartRequirement.requirement,
      });
      if (transitionResult.state === "ready") {
        runtimeTransitionProof = transitionResult.proof;
      }
      if (transitionResult.state === "pending") {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "waiting_for_event",
            blockedReason: "runtime_transition_pending",
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        if (mission.status !== "waiting") {
          await tx.update(aiMissionsTable)
            .set({ status: "waiting", updatedAt: now })
            .where(eq(aiMissionsTable.id, mission.id));
        }
        if (goal.status !== "waiting_for_event" || goal.blockedReason !== "runtime_transition_pending") {
          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "AiGoalTransitionRequirementWaiting",
            projectId: goal.projectId,
            goalId: goal.id,
            severity: "info",
            message: `AI goal "${goal.title}" is waiting for its runtime transition proof`,
            payload: {
              missionId: mission.id,
              planRevision: goalRevision,
              sourceStepId: runtimeStartRequirement.requirement.sourceStepId,
              targetStepId: runtimeStartRequirement.requirement.targetStepId,
            },
          });
        }
        return { status: "waiting" as const, goalId: goal.id, reason: "runtime_transition_pending" };
      }
      if (transitionResult.state === "failed") {
        await persistRuntimeTransitionFailure(tx, {
          goal,
          mission,
          planRevision: goalRevision,
          requirement: runtimeStartRequirement.requirement,
          diagnosis: transitionResult.diagnosis,
        });
        return { status: "blocked" as const, goalId: goal.id, reason: "runtime_start_transition_unproven" };
      }
    }

    const applyRequirement = await resolveApplyChangesMissionRequirement(
      tx,
      goal,
      mission,
      activePlanRevision,
    );
    if (applyRequirement.kind === "invalid") {
      const now = new Date();
      await tx.update(aiGoalsTable)
        .set({
          status: "needs_replan",
          blockedReason: applyRequirement.reason,
          nextWakeAt: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      if (mission.status !== "blocked") {
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
      }
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalApplyChangesProofBlocked",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "warning",
        message: `AI goal "${goal.title}" needs a replan because its apply requirement is invalid`,
        payload: { missionId: mission.id, planRevision: goalRevision, reason: applyRequirement.reason },
      });
      return { status: "blocked" as const, goalId: goal.id, reason: applyRequirement.reason };
    }
    if (applyRequirement.kind === "valid") {
      if (mission.status === "blocked" || mission.status === "needs_replan") {
        return {
          status: "blocked" as const,
          goalId: goal.id,
          reason: mission.status === "blocked" ? "mission_operator_owned" : "mission_needs_replan",
        };
      }
      const d2 = await evaluateApplyChangesD2(tx, {
        goal,
        mission,
        activePlanRevision,
      });
      if (d2.state === "pending") {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "waiting_for_event",
            blockedReason: "apply_changes_pending",
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        if (mission.status !== "waiting") {
          await tx.update(aiMissionsTable)
            .set({ status: "waiting", updatedAt: now })
            .where(eq(aiMissionsTable.id, mission.id));
        }
        if (goal.status !== "waiting_for_event" || goal.blockedReason !== "apply_changes_pending") {
          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "AiGoalApplyChangesProofWaiting",
            projectId: goal.projectId,
            goalId: goal.id,
            severity: "info",
            message: `AI goal "${goal.title}" is waiting for live apply proof`,
            payload: { missionId: mission.id, planRevision: applyRequirement.planRevision, reason: d2.reason },
          });
        }
        return { status: "waiting" as const, goalId: goal.id, reason: "apply_changes_pending" };
      }
      if (d2.state !== "proven") {
        const reason = d2.state === "failed" ? d2.reason : "apply_d2_not_applicable";
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "needs_replan",
            blockedReason: reason,
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiGoalApplyChangesProofBlocked",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: "warning",
          message: `AI goal "${goal.title}" needs a replan because live apply proof was not established`,
          payload: { missionId: mission.id, planRevision: applyRequirement.planRevision, reason },
        });
        return { status: "blocked" as const, goalId: goal.id, reason };
      }

      const canonicalProof = await loadCanonicalProof({
        tx,
        executionId: d2.executionId,
        scope: {
          projectId: goal.projectId,
          missionId: mission.id,
          goalId: goal.id,
          executionId: d2.executionId,
          operationId: d2.operationId,
          planRevision: d2.planRevision,
          activePlanRevision,
          sourceRevisionBinding: "scope",
          candidateIdentityBinding: d2.candidateIdentity == null
            ? "not_applicable"
            : "required",
          sourceRevision: d2.requirement.baseRevision,
          candidateIdentity: d2.candidateIdentity,
        },
        goalStatus: "completed",
        deliveryRequired: false,
      });
      if (!canonicalProof.accepted) {
        const reason = `canonical_proof_${canonicalProof.failureReasons[0] ?? "incomplete"}`;
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "needs_replan",
            blockedReason: reason,
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiGoalApplyChangesProofBlocked",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: "warning",
          message: `AI goal "${goal.title}" needs a replan because canonical apply acceptance is incomplete`,
          payload: { missionId: mission.id, planRevision: applyRequirement.planRevision, reason },
        });
        return { status: "blocked" as const, goalId: goal.id, reason };
      }

      const [completionMission] = await tx
        .select()
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, mission.id),
          eq(aiMissionsTable.projectId, goal.projectId),
        ))
        .for("update");
      const [completionGoal] = await tx
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, goal.id),
          eq(aiGoalsTable.missionId, mission.id),
          eq(aiGoalsTable.projectId, goal.projectId),
        ))
        .for("update");
      if (!completionMission || !completionGoal) {
        return { status: "conflict" as const, goalId: goal.id, reason: "mission_goal_missing" };
      }
      const completionAuthorization = await authorizeMissionGoalContinuation(
        tx,
        completionMission,
        completionGoal,
        { targetExecutionId: d2.executionId },
      );
      if (!completionAuthorization.allowed) {
        const dependencyState = completionAuthorization.dependencyState;
        if (
          (completionAuthorization.reason === "dependency_invalid"
            || completionAuthorization.reason === "dependency_proof_unproven")
          && dependencyState
        ) {
          await persistGoalDependencyProofBlocked(tx, {
            goal: completionGoal,
            mission: completionMission,
            planRevision: dependencyState.planRevision,
            dependency: completionAuthorization.dependency
              ?? dependencyState.unprovenDependencies[0]
              ?? { id: completionGoal.id, title: completionGoal.title },
          });
        }
        return {
          status: "conflict" as const,
          goalId: goal.id,
          reason: `mission_goal_continuation_${completionAuthorization.reason}`,
        };
      }

      const now = new Date();
      const projected = await projectGoalAcceptance(tx, {
        goalId: goal.id,
        projectId: goal.projectId,
        projection: {
          acceptanceId: d2.acceptanceId,
          executionId: d2.executionId,
          outcome: "SUCCEEDED",
          verdict: "PROVEN",
          sourceRevision: d2.requirement.baseRevision,
          candidateIdentity: d2.candidateIdentity,
          scope: {
            projectId: goal.projectId,
            missionId: mission.id,
            goalId: goal.id,
            operationId: d2.operationId,
            planRevision: d2.planRevision,
            candidateIdentity: d2.candidateIdentity,
          },
          acceptedRefs: [
            `execution:${d2.executionId}:${d2.attempt}`,
            `effect-bundle:${d2.effectBundleId}`,
            `world-transition:${d2.transitionId}`,
            ...d2.beforeObservationIds,
            ...d2.afterObservationIds,
          ],
          receipt: {
            kind: "execution_acceptance",
            id: d2.acceptanceId,
            executionId: d2.executionId,
            status: "SUCCEEDED",
          },
          stateProjection: {
            transitionId: d2.transitionId,
            worldRevision: d2.resultingWorldRevision,
            environmentRevision: d2.environmentRevision,
          },
          reasonCode: "APPLY_CHANGES_D2_PROVEN",
          updatedAt: now,
        },
      });
      if (!projected) {
        return { status: "conflict" as const, goalId: goal.id, reason: "goal_acceptance_projection_failed" };
      }
      await tx.update(aiGoalsTable)
        .set({
          status: "completed",
          blockedReason: null,
          completedAt: completionGoal.completedAt ?? now,
          nextWakeAt: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      const missionGoals = await tx.select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
      }).from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.missionId, mission.id),
          eq(aiGoalsTable.projectId, goal.projectId),
        ))
        .for("update");
      const nextMissionStatus = await deriveProofGatedMissionStatus(
        tx,
        completionMission,
        missionGoals,
      );
      if (completionMission.status !== nextMissionStatus) {
        await tx.update(aiMissionsTable)
          .set({
            status: nextMissionStatus,
            completedAt: nextMissionStatus === "completed"
              ? completionMission.completedAt ?? now
              : null,
            updatedAt: now,
          })
          .where(eq(aiMissionsTable.id, mission.id));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiMissionStatusSynced",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: nextMissionStatus === "completed" ? "success" : "info",
          message: `AI mission "${completionMission.title}" → ${nextMissionStatus}`,
          payload: {
            executionId: d2.executionId,
            goalId: goal.id,
            status: nextMissionStatus,
            source: "apply_changes_proof",
          },
        });
      }
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalApplyChangesProofAccepted",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "success",
        message: `AI goal "${goal.title}" completed with live apply proof`,
        payload: {
          missionId: mission.id,
          planRevision: d2.planRevision,
          executionId: d2.executionId,
          attempt: d2.attempt,
          transitionId: d2.transitionId,
          worldRevision: d2.resultingWorldRevision,
        },
      });
      return recordActionEffect({
        status: "completed" as const,
        goalId: goal.id,
        executionId: d2.executionId,
        reason: "apply_changes_d2_proven",
      });
    }

    const parsedAction = GoalNextActionSchema.safeParse(nextActionForDispatch);
    if (!parsedAction.success) {
      return { status: "blocked" as const, goalId: goal.id, reason: "invalid_next_action" };
    }
    const action = parsedAction.data;

    if (action.kind === "wait") {
      const nextStatus = action.reason === "approval" ? "waiting_for_approval" : "waiting_for_event";
      await tx.update(aiGoalsTable)
        .set({
          status: nextStatus,
          nextWakeAt: action.wakeAt ? new Date(action.wakeAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(aiGoalsTable.id, goal.id));
      return { status: "waiting" as const, goalId: goal.id };
    }

    if (action.kind === "replan") {
      await tx.update(aiGoalsTable)
        .set({
          status: "needs_replan",
          blockedReason: action.reason,
          nextWakeAt: null,
          updatedAt: new Date(),
        })
        .where(eq(aiGoalsTable.id, goal.id));
      if (mission.status !== "blocked") {
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: new Date() })
          .where(eq(aiMissionsTable.id, mission.id));
      }
      return { status: "blocked" as const, goalId: goal.id, reason: "replan_required" };
    }

    if (action.kind === "recipe") {
      const identity = await recipeOperationIdentity(tx, goal.projectId, goal.id, action);
      if (!identity) {
        await tx.update(aiGoalsTable)
          .set({
            status: "blocked",
            blockedReason: action.recipeId === "delivery.push.github"
              ? "delivery_proposal_not_committed"
              : "invalid_recipe_identity",
            nextWakeAt: null,
            updatedAt: new Date(),
          })
          .where(eq(aiGoalsTable.id, goal.id));
        return {
          status: "blocked" as const,
          goalId: goal.id,
          reason: action.recipeId === "delivery.push.github"
            ? "delivery_proposal_not_committed"
            : "invalid_recipe_identity",
        };
      }
      const [activeExecution] = await tx
        .select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.goalId, goal.id),
          eq(aiExecutionsTable.operationId, identity.operationId),
          inArray(aiExecutionsTable.status, [...RECIPE_EXECUTION_STATUSES]),
        ))
        .limit(1);
      if (activeExecution) {
        return recordActionEffect({
          status: "scheduled" as const,
          goalId: goal.id,
          executionId: activeExecution.id,
          reason: "execution_already_active",
          delegation,
        });
      }
      const now = new Date();
      await tx.update(aiGoalsTable)
        .set({
          status: "running",
          nextWakeAt: null,
          blockedReason: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalRecipeDispatchRequested",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "info",
        message: `AI goal "${goal.title}" recipe dispatch requested`,
        payload: {
          missionId: mission.id,
          operationId: identity.operationId,
          recipeId: action.recipeId,
          recipeVersion: action.recipeVersion,
          candidateIdentity: action.candidateIdentity ?? null,
          trigger: params.trigger,
          delegation,
          ...(runtimeTransitionProof ? { transitionProof: runtimeTransitionProof } : {}),
        },
      });
      if (params.actionReceipt) {
        await persistMissionAgentActionEffectReceipt(tx, params.actionReceipt, {
          outcome: "accepted",
          operation: { goalId: goal.id, status: "scheduled" },
          run: {
            status: "scheduled",
            goalId: goal.id,
            taskId: null,
            executionId: null,
            reason: "recipe_dispatch_queued",
          },
        });
      }
      return {
        status: "scheduled" as const,
        goalId: goal.id,
        executionId: undefined,
        reason: "recipe_dispatch_queued",
        recipeDispatch: {
          goalId: goal.id,
          userId: params.userId,
          projectId: goal.projectId,
          missionId: mission.id,
          operationId: identity.operationId,
          idempotencyKey: identity.idempotencyKey,
          action,
          delegation,
        } satisfies RecipeDispatch,
      };
    }

    const [task] = await tx
      .select()
      .from(tasksTable)
      .where(and(
        eq(tasksTable.id, action.taskId),
        eq(tasksTable.goalId, goal.id),
        eq(tasksTable.projectId, goal.projectId),
      ))
      .limit(1);
    if (!task) {
      return { status: "blocked" as const, goalId: goal.id, reason: "task_not_found" };
    }
    const taskDelegation = buildMissionDelegationBinding({
      ...delegation,
      taskId: task.id,
    });
    if (params.delegation) {
      const bindingCheck = validateMissionDelegationBinding(params.delegation, {
        missionId: mission.id,
        goalId: goal.id,
        taskId: task.id,
        userId: mission.userId,
        planRevision: delegation.planRevision,
      });
      if (!bindingCheck.allowed) {
        return { status: "conflict" as const, goalId: goal.id, taskId: task.id, reason: bindingCheck.reason };
      }
    }
    if (!task.prompt || task.status !== "verifying") {
      return { status: "blocked" as const, goalId: goal.id, taskId: task.id, reason: "task_not_eligible" };
    }

    const [activeExecution] = await tx
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.linkedTaskId, task.id),
        inArray(aiExecutionsTable.status, [...ACTIVE_EXECUTION_STATUSES]),
      ))
      .limit(1);
    if (activeExecution) {
      return recordActionEffect({
        status: "scheduled" as const,
        goalId: goal.id,
        taskId: task.id,
        executionId: activeExecution.id,
        reason: "execution_already_active",
        delegation: taskDelegation,
      });
    }

    const now = new Date();
    if (goal.status !== "running" && goal.status !== "verifying") {
      await tx.update(aiGoalsTable)
        .set({ status: "running", updatedAt: now })
        .where(eq(aiGoalsTable.id, goal.id));
    }
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalDispatchRequested",
      projectId: goal.projectId,
      goalId: goal.id,
      taskId: task.id,
      severity: "info",
      message: `AI goal "${goal.title}" dispatched`,
      payload: {
        missionId: mission.id,
        trigger: params.trigger,
        action: action.kind,
        delegation: taskDelegation,
      },
    });
    return recordActionEffect({
      status: "scheduled" as const,
      goalId: goal.id,
      taskId: task.id,
      delegation: taskDelegation,
    });
    })();
    if (
      params.actionReceipt
      && decision.status !== "scheduled"
      && decision.status !== "completed"
    ) {
      await persistMissionAgentActionEffectReceipt(tx, params.actionReceipt, {
        outcome: "rejected",
        operation: {
          goalId: decision.goalId,
          ...(decision.executionId ? { executionId: decision.executionId } : {}),
          status: decision.status,
        },
        run: {
          status: decision.status,
          goalId: decision.goalId,
          taskId: decision.taskId ?? null,
          executionId: decision.executionId ?? null,
          reason: decision.reason ?? null,
        },
        error: {
          code: "MISSION_GOAL_RUN_FAILED",
          message: decision.reason ?? `Mission Goal run ended as ${decision.status}.`,
        },
      });
    }
    return decision;
  });

  if (decision.recipeDispatch && decision.status === "scheduled" && !decision.executionId) {
    heavyJobQueue.enqueueWithId(decision.recipeDispatch.operationId, async () => {
      await executeMissionRecipe(decision.recipeDispatch!);
    });
  } else if (decision.taskId && !decision.executionId && decision.status === "scheduled") {
    scheduleAiTaskExecution(decision.taskId, params.userId, {
      parentExecutionId: decision.delegation?.parentExecutionId,
    });
  }
  if (decision.status === "completed" && decision.reason === "apply_changes_d2_proven") {
    await wakeReadyMissionGoals(32, getLifecycleWorkerScopeProjectId());
  }
  return decision;
}

/**
 * Wakes dependent Goals after their prerequisites complete. This handles both
 * Goals held in waiting_for_event and descendants that plan materialization
 * left queued, while leaving proof and continuation authorization to the
 * existing Mission runtime.
 */
export async function wakeReadyMissionGoals(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const candidates = await db
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
    })
    .from(aiGoalsTable)
    .where(and(
      or(
        and(
          eq(aiGoalsTable.status, "waiting_for_event"),
          eq(aiGoalsTable.blockedReason, "dependencies_pending"),
        ),
        and(
          eq(aiGoalsTable.status, "queued"),
          inArray(
            aiGoalsTable.id,
            db.select({ goalId: aiGoalDependenciesTable.goalId })
              .from(aiGoalDependenciesTable),
          ),
        ),
      ),
      scopeProjectId ? eq(aiGoalsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(aiGoalsTable.updatedAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let woken = 0;
  for (const candidate of candidates) {
    const ready = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select()
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, candidate.missionId),
          eq(aiMissionsTable.projectId, candidate.projectId),
        ))
        .for("update");
      if (!mission) return undefined;
      const [goal] = await tx
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, candidate.id),
          eq(aiGoalsTable.missionId, candidate.missionId),
          eq(aiGoalsTable.projectId, candidate.projectId),
          inArray(aiGoalsTable.status, ["waiting_for_event", "queued"]),
        ))
        .for("update");
      if (!goal) return undefined;
      const isWaitingOnDependencies =
        goal.status === "waiting_for_event"
        && goal.blockedReason === "dependencies_pending";
      const isQueuedDependent = goal.status === "queued" && goal.blockedReason === null;
      if (!isWaitingOnDependencies && !isQueuedDependent) return undefined;
      const dependencyState = await loadGoalDependencyState(tx, mission, goal);
      const unprovenDependency = dependencyState.unprovenDependencies[0];
      if (unprovenDependency) {
        await persistGoalDependencyProofBlocked(tx, {
          goal,
          mission,
          planRevision: dependencyState.planRevision,
          dependency: unprovenDependency,
        });
        return undefined;
      }
      const allDependenciesCompleted =
        dependencyState.dependencies.length > 0
        && dependencyState.dependencies.length === dependencyState.dependencyGoals.length
        && dependencyState.dependencyGoals.every((dependency) => dependency.status === "completed");
      if (!allDependenciesCompleted) return undefined;
      if (isWaitingOnDependencies) {
        await tx.update(aiGoalsTable)
          .set({
            status: "queued",
            blockedReason: null,
            nextWakeAt: null,
            updatedAt: new Date(),
          })
          .where(eq(aiGoalsTable.id, goal.id));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiGoalDependencyReady",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: "info",
          message: `AI goal "${goal.title}" is ready after its dependencies completed`,
          payload: { missionId: goal.missionId, planRevision: dependencyState.planRevision },
        });
      }
      return { userId: mission.userId };
    });
    if (!ready) continue;
    const result = await runMissionGoal({
      goalId: candidate.id,
      userId: ready.userId,
      trigger: "wake",
    });
    if (result.status === "scheduled" || result.status === "completed") woken += 1;
  }
  return woken;
}

/**
 * Rechecks Mission-linked apply Goals after the durable transition retry worker
 * has run. This never repeats the filesystem apply; it only evaluates stored
 * acceptance, observation, and World State proof.
 */
export async function wakeApplyChangesMissionGoals(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const candidates = await db.select({
    goalId: aiGoalsTable.id,
    userId: aiMissionsTable.userId,
  }).from(aiGoalsTable)
    .innerJoin(aiMissionsTable, and(
      eq(aiMissionsTable.id, aiGoalsTable.missionId),
      eq(aiMissionsTable.projectId, aiGoalsTable.projectId),
    ))
    .where(and(
      eq(aiGoalsTable.status, "waiting_for_event"),
      eq(aiGoalsTable.blockedReason, "apply_changes_pending"),
      scopeProjectId ? eq(aiGoalsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(aiGoalsTable.updatedAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let reconciled = 0;
  for (const candidate of candidates) {
    const result = await runMissionGoal({
      goalId: candidate.goalId,
      userId: candidate.userId,
      trigger: "wake",
    });
    if (
      result.status === "completed"
      || result.status === "scheduled"
      || result.status === "blocked"
    ) reconciled += 1;
  }
  return reconciled;
}

/**
 * Reconciles Goals held specifically on a materialized runtime transition.
 * The durable World Transition is rechecked under Goal/Mission locks before
 * the target is queued; runMissionGoal repeats that gate before dispatch.
 */
export async function wakeRuntimeTransitionMissionGoals(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const candidates = await db
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.status, "waiting_for_event"),
      eq(aiGoalsTable.blockedReason, "runtime_transition_pending"),
      scopeProjectId ? eq(aiGoalsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(aiGoalsTable.updatedAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let woken = 0;
  for (const candidate of candidates) {
    const decision = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select()
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, candidate.missionId),
          eq(aiMissionsTable.projectId, candidate.projectId),
        ))
        .for("update");
      if (!mission) return undefined;
      const [goal] = await tx
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, candidate.id),
          eq(aiGoalsTable.missionId, candidate.missionId),
          eq(aiGoalsTable.projectId, candidate.projectId),
          eq(aiGoalsTable.status, "waiting_for_event"),
          eq(aiGoalsTable.blockedReason, "runtime_transition_pending"),
        ))
        .for("update");
      if (!goal) return undefined;
      const activePlanRevision = typeof jsonRecord(mission.autonomyPolicy).activePlanRevision === "string"
        ? jsonRecord(mission.autonomyPolicy).activePlanRevision as string
        : undefined;
      const goalRevision = goalPlanRevision(goal);
      if (!activePlanRevision || goalRevision !== activePlanRevision) return undefined;

      const requirementState = runtimeStartRequirementForGoal(goal, activePlanRevision);
      let transitionState: "ready" | "pending" | "failed";
      let runtimeTransitionProof: RuntimeStartTransitionProof | undefined;
      let runtimeTransitionDiagnosis: WorldStateFailureDiagnosis | undefined;
      if (requirementState.kind !== "valid") {
        transitionState = "failed";
      } else {
        const dependencyState = await loadGoalDependencyState(tx, mission, goal);
        const unprovenDependency = dependencyState.unprovenDependencies[0];
        if (unprovenDependency) {
          await persistGoalDependencyProofBlocked(tx, {
            goal,
            mission,
            planRevision: dependencyState.planRevision,
            dependency: unprovenDependency,
          });
          return undefined;
        }
        const dependenciesComplete =
          dependencyState.dependencies.length === dependencyState.dependencyGoals.length
          && dependencyState.dependencyGoals.every((dependency) => dependency.status === "completed");
        if (!dependenciesComplete) return undefined;
        const transitionResult = await evaluateRuntimeStartTransitionGate(tx, {
          goal,
          activePlanRevision,
          requirement: requirementState.requirement,
        });
        transitionState = transitionResult.state;
        if (transitionResult.state === "ready") {
          runtimeTransitionProof = transitionResult.proof;
        } else if (transitionResult.state === "failed") {
          runtimeTransitionDiagnosis = transitionResult.diagnosis;
        }
      }

      const now = new Date();
      if (transitionState === "pending") return undefined;
      if (transitionState === "failed") {
        if (requirementState.kind === "valid" && runtimeTransitionDiagnosis) {
          await persistRuntimeTransitionFailure(tx, {
            goal,
            mission,
            planRevision: activePlanRevision,
            requirement: requirementState.requirement,
            diagnosis: runtimeTransitionDiagnosis,
          });
        } else {
          await tx.update(aiGoalsTable)
            .set({
              status: "needs_replan",
              blockedReason: "runtime_start_transition_unproven",
              nextWakeAt: null,
              updatedAt: now,
            })
            .where(eq(aiGoalsTable.id, goal.id));
          await tx.update(aiMissionsTable)
            .set({ status: "needs_replan", updatedAt: now })
            .where(eq(aiMissionsTable.id, mission.id));
          await tx.insert(eventsTable).values({
            id: randomUUID(),
            type: "AiGoalTransitionRequirementBlocked",
            projectId: goal.projectId,
            goalId: goal.id,
            severity: "warning",
            message: `AI goal "${goal.title}" requires a replan because its runtime transition was not proven`,
            payload: {
              missionId: mission.id,
              planRevision: activePlanRevision,
              sourceStepId: "runtime-start",
              targetStepId: null,
            },
          });
        }
        return { state: "failed" as const };
      }

      await tx.update(aiGoalsTable)
        .set({
          status: "queued",
          blockedReason: null,
          nextWakeAt: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalTransitionRequirementReady",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "info",
        message: `AI goal "${goal.title}" runtime transition requirement is proven`,
        payload: {
          missionId: mission.id,
          planRevision: activePlanRevision,
          ...(runtimeTransitionProof ? { transitionProof: runtimeTransitionProof } : {}),
        },
      });
      return { state: "ready" as const, userId: mission.userId };
    });
    if (decision?.state !== "ready") continue;
    const result = await runMissionGoal({
      goalId: candidate.id,
      userId: decision.userId,
      trigger: "wake",
    });
    if (result.status === "scheduled" || result.status === "completed") woken += 1;
  }
  return woken;
}

/**
 * Converts due scheduled waits into a durable replan request.
 *
 * Approval waits are intentionally excluded: they require an operator or
 * external approval event, not a timer. The row lock makes overlapping
 * sweepers claim a Goal only once.
 */
export async function wakeDueMissionGoals(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const now = new Date();
  const dueGoals = await db
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.status, "waiting_for_event"),
      isNotNull(aiGoalsTable.nextWakeAt),
      lte(aiGoalsTable.nextWakeAt, now),
      scopeProjectId ? eq(aiGoalsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(aiGoalsTable.nextWakeAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let woken = 0;
  for (const candidate of dueGoals) {
    const changed = await db.transaction(async (tx) => {
      // Keep the shared Mission-before-Goal order used by direct Goal updates.
      const [mission] = await tx
        .select()
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, candidate.missionId),
          eq(aiMissionsTable.projectId, candidate.projectId),
        ))
        .for("update");
      const [goal] = await tx
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, candidate.id),
          eq(aiGoalsTable.projectId, candidate.projectId),
          eq(aiGoalsTable.status, "waiting_for_event"),
          isNotNull(aiGoalsTable.nextWakeAt),
          lte(aiGoalsTable.nextWakeAt, now),
        ))
        .for("update");
      if (!goal) return false;
      const action = GoalNextActionSchema.safeParse(goal.nextAction);
      if (!action.success || action.data.kind !== "wait" || action.data.reason === "approval") {
        return false;
      }
      await tx.update(aiGoalsTable)
        .set({
          status: "needs_replan",
          nextAction: {
            kind: "replan",
            reason: "Scheduled wake reached; replan from current project evidence.",
          },
          nextWakeAt: null,
          blockedReason: null,
          updatedAt: now,
        })
        .where(eq(aiGoalsTable.id, goal.id));
      if (mission && mission.status !== "blocked" && mission.status !== "cancelled" && mission.status !== "completed") {
        await tx.update(aiMissionsTable)
          .set({ status: "needs_replan", updatedAt: now })
          .where(eq(aiMissionsTable.id, mission.id));
      }
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalWakeDue",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "info",
        message: `AI goal "${goal.title}" wake time reached`,
        payload: { missionId: goal.missionId, previousStatus: goal.status },
      });
      return true;
    });
    if (changed) woken++;
  }
  return woken;
}

/**
 * Converts one targeted durable event into a bounded replan request.
 *
 * Event waits are not timer-driven and do not bypass the existing planner or
 * dispatcher. The event must target the Goal directly and, when supplied,
 * match its active plan revision. The Goal is then re-evaluated by the normal
 * replan path, so duplicate/stale events are harmless.
 */
export async function wakeMissionGoalsForEvent(event: MissionEventEnvelope): Promise<number> {
  if (event.schemaVersion !== 1 || event.projectId.length === 0 || !event.goalId) return 0;

  const [candidate] = await db
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, event.goalId),
      eq(aiGoalsTable.projectId, event.projectId),
      eq(aiGoalsTable.status, "waiting_for_event"),
    ))
    .limit(1);
  if (!candidate) return 0;

  const changed = await db.transaction(async (tx) => {
    // Reconciliation shares the Mission-before-Goal order used by status
    // changes; lock both rows before revalidating the wait and event revision.
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, candidate.missionId),
        eq(aiMissionsTable.projectId, candidate.projectId),
      ))
      .for("update");
    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, candidate.id),
        eq(aiGoalsTable.missionId, candidate.missionId),
        eq(aiGoalsTable.projectId, candidate.projectId),
        eq(aiGoalsTable.status, "waiting_for_event"),
      ))
      .for("update");
    if (!goal) return false;

    const action = GoalNextActionSchema.safeParse(goal.nextAction);
    if (!action.success || action.data.kind !== "wait" || action.data.reason !== "event") {
      return false;
    }
    const revision = goalPlanRevision(goal);
    if (event.planRevision && revision && event.planRevision !== revision) return false;

    if (!mission || ["blocked", "cancelled", "completed", "failed"].includes(mission.status)) return false;

    const now = new Date();
    await tx.update(aiGoalsTable)
      .set({
        status: "needs_replan",
        nextAction: {
          kind: "replan",
          reason: `Event "${event.type}" received; replan from current project evidence.`,
        },
        blockedReason: null,
        nextWakeAt: null,
        updatedAt: now,
      })
      .where(eq(aiGoalsTable.id, goal.id));
    await tx.update(aiMissionsTable)
      .set({ status: "needs_replan", updatedAt: now })
      .where(and(
        eq(aiMissionsTable.id, mission.id),
        eq(aiMissionsTable.status, mission.status),
      ));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalEventReceived",
      projectId: goal.projectId,
      goalId: goal.id,
      severity: "info",
      message: `AI goal "${goal.title}" received event "${event.type}"`,
      correlationId: event.correlationId ?? event.eventId,
      payload: {
        eventSchemaVersion: event.schemaVersion,
        eventId: event.eventId,
        eventType: event.type,
        planRevision: revision ?? null,
      },
    });
    return true;
  });

  return changed ? 1 : 0;
}

type StoredMissionEvent = {
  envelope?: MissionEventEnvelope;
  processedAt?: string | null;
};

function storedMissionEvent(payload: Record<string, unknown> | null): StoredMissionEvent | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidate = payload.missionEvent;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const envelope = candidate as Partial<MissionEventEnvelope>;
  if (
    envelope.schemaVersion !== 1
    || typeof envelope.eventId !== "string"
    || typeof envelope.type !== "string"
    || typeof envelope.projectId !== "string"
    || typeof envelope.goalId !== "string"
  ) {
    return undefined;
  }
  return {
    envelope: envelope as MissionEventEnvelope,
    processedAt: typeof payload.processedAt === "string" ? payload.processedAt : null,
  };
}

/**
 * Durable ingress for external Mission events. The existing events journal is
 * also the inbox: eventId is the primary key, so webhook retries are
 * idempotent. If the Goal is not waiting yet, the row remains unprocessed and
 * the dispatcher replays it after the Goal reaches its wait boundary.
 */
export async function receiveMissionEvent(event: MissionEventEnvelope): Promise<{
  eventId: string;
  persisted: boolean;
  woken: boolean;
  duplicate: boolean;
}> {
  const payload = {
    missionEvent: createMissionEventEnvelope(event),
    processedAt: null,
  } satisfies Record<string, unknown>;
  const [inserted] = await db
    .insert(eventsTable)
    .values({
      id: event.eventId,
      type: MISSION_EXTERNAL_EVENT_TYPE,
      projectId: event.projectId,
      goalId: event.goalId,
      correlationId: event.correlationId ?? event.eventId,
      severity: "info",
      message: `External Mission event "${event.type}" received`,
      payload,
    })
    .onConflictDoNothing()
    .returning({ id: eventsTable.id });

  const existing = inserted
    ? []
    : await db
      .select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.id, event.eventId),
        eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      ))
      .limit(1);
  if (!inserted && !storedMissionEvent(existing[0]?.payload ?? null)) {
    return { eventId: event.eventId, persisted: false, woken: false, duplicate: true };
  }

  const woken = await wakeMissionGoalsForEvent(event);
  if (woken > 0) {
    await db.update(eventsTable)
      .set({
        payload: {
          ...payload,
          processedAt: new Date().toISOString(),
        },
      })
      .where(and(
        eq(eventsTable.id, event.eventId),
        eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      ));
  }
  return {
    eventId: event.eventId,
    persisted: true,
    woken: woken > 0,
    duplicate: !inserted,
  };
}

/**
 * Replays durable external events that arrived before their Goal entered the
 * event-wait state. Replay is bounded and safe because Goal wake is row-locked
 * and the inbox event remains idempotent by eventId.
 */
export async function replayPendingMissionEvents(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const rows = await db
    .select({
      id: eventsTable.id,
      payload: eventsTable.payload,
    })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(eventsTable.timestamp, eventsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let replayed = 0;
  for (const row of rows) {
    const stored = storedMissionEvent(row.payload);
    if (!stored?.envelope || stored.processedAt) continue;
    if (scopeProjectId && stored.envelope.projectId !== scopeProjectId) continue;
    const woken = await wakeMissionGoalsForEvent(stored.envelope);
    if (woken === 0) continue;
    await db.update(eventsTable)
      .set({
        payload: {
          ...(row.payload ?? {}),
          processedAt: new Date().toISOString(),
        },
      })
      .where(and(
        eq(eventsTable.id, row.id),
        eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      ));
    replayed += 1;
  }
  return replayed;
}