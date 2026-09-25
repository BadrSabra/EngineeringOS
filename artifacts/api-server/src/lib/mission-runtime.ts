import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiGoalDependenciesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  GoalNextActionSchema,
  RecipeReceiptSchema,
  type GoalNextAction,
} from "@workspace/ai-orchestrator";
import {
  deriveMissionStatusFromGoals,
  selectActiveMissionGoals,
} from "./ai-execution-acceptance.js";
import { projectGoalAcceptance } from "./mission-acceptance-projection.js";
import { deliveryWorkspaceExists } from "./delivery-workspace.js";
import { establishProjectRoot } from "./project-root.js";
import {
  createRuntimeStartRunner,
  runRecipeOperation,
} from "./recipe-operation-runner.js";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";
import { parseAiExecutionCheckpoint } from "./ai-execution-state.js";
import { loadCanonicalProof } from "./proof-foundation.js";
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

const execFileAsync = promisify(execFile);

export type MissionGoalRunTrigger = "activation" | "wake" | "resume" | "replan";

export type MissionGoalRunResult = {
  status: "scheduled" | "waiting" | "blocked" | "completed" | "conflict";
  goalId: string;
  taskId?: string;
  executionId?: string;
  reason?: string;
  delegation?: MissionDelegationBinding;
};

const ACTIVE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
const RECIPE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
const MISSION_EXTERNAL_EVENT_TYPE = "AiMissionExternalEventReceived";
type RecipeGoalAction = Extract<GoalNextAction, { kind: "recipe" }>;
type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type GoalDependencyState = {
  planRevision?: string;
  dependencies: Array<{ dependsOnGoalId: string }>;
  dependencyGoals: Array<{
    id: string;
    title: string;
    status: typeof aiGoalsTable.$inferSelect["status"];
  }>;
};

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

async function loadGoalDependencyState(
  tx: MissionTransaction,
  goal: typeof aiGoalsTable.$inferSelect,
): Promise<GoalDependencyState> {
  const planRevision = goalPlanRevision(goal);
  if (!planRevision) {
    return {
      planRevision,
      dependencies: [],
      dependencyGoals: [],
    };
  }
  const dependencies = await tx
    .select({ dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId })
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.goalId, goal.id),
      eq(aiGoalDependenciesTable.missionId, goal.missionId),
      eq(aiGoalDependenciesTable.projectId, goal.projectId),
      eq(aiGoalDependenciesTable.planRevision, planRevision),
    ));
  if (dependencies.length === 0) {
    return { planRevision, dependencies, dependencyGoals: [] };
  }
  const dependencyGoals = await tx
    .select({ id: aiGoalsTable.id, title: aiGoalsTable.title, status: aiGoalsTable.status })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, goal.missionId),
      eq(aiGoalsTable.projectId, goal.projectId),
      inArray(aiGoalsTable.id, dependencies.map((dependency) => dependency.dependsOnGoalId)),
    ));
  return { planRevision, dependencies, dependencyGoals };
}

type RecipeDispatch = {
  goalId: string;
  userId: string;
  projectId: string;
  missionId: string;
  operationId: string;
  idempotencyKey: string;
  action: RecipeGoalAction;
  delegation: MissionDelegationBinding;
};

async function resolveGitRevision(rootPath: string): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, "rev-parse", "HEAD"], {
    timeout: 8_000,
    maxBuffer: 16 * 1024,
    encoding: "utf8",
  });
  const revision = String(result.stdout).trim();
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("Project source revision is unavailable.");
  }
  return revision;
}

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
    ...(action.skill ? { skill: action.skill } : {}),
  })).digest("hex");
  return {
    operationId: `mission-goal-${goalId}-${digest.slice(0, 16)}`,
    idempotencyKey: `mission-goal:${goalId}:${digest.slice(0, 32)}`,
  };
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
): Promise<{ candidateWorkspace: string; operationId: string } | undefined> {
  if (!action.candidateIdentity) return undefined;
  const [proposal] = await db
    .select({
      operationId: aiChangeProposalsTable.operationId,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.projectId, projectId),
      eq(aiChangeProposalsTable.candidateTreeHash, action.candidateIdentity),
      inArray(aiChangeProposalsTable.lifecycle, ["validated", "committed"]),
    ))
    .limit(1);
  if (
    !proposal?.operationId
    || !proposal.workspaceRoot
    || proposal.candidateTreeHash !== action.candidateIdentity
    || proposal.baseRevision !== sourceRevision
    || !await deliveryWorkspaceExists(proposal.workspaceRoot, proposal.operationId)
  ) {
    return undefined;
  }
  return {
    candidateWorkspace: proposal.workspaceRoot,
    operationId: proposal.operationId,
  };
}

async function syncRecipeObjectiveState(params: {
  goalId: string;
  missionId: string;
  projectId: string;
  executionId?: string;
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

    const [durableExecution] = params.executionId
      ? await tx
          .select({
            attempt: aiExecutionsTable.attempt,
            operationId: aiExecutionsTable.operationId,
            baseRevision: aiExecutionsTable.baseRevision,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.id, params.executionId),
            eq(aiExecutionsTable.projectId, params.projectId),
          ))
          .limit(1)
      : [];
    const outcome = jsonRecord(goal.outcomeContract);
    const acceptance = jsonRecord(outcome.acceptance);
    const acceptanceScope = jsonRecord(acceptance.scope);
    const nextAction = jsonRecord(goal.nextAction);
    const recipeId = typeof nextAction.recipeId === "string" ? nextAction.recipeId : null;
    const requiresExternalDeliveryIdentity = outcome.deliveryRequired === true
      && recipeId !== "candidate.verify";
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
      const policy = jsonRecord(mission.autonomyPolicy);
      const canonicalProof = await loadCanonicalProof({
        tx,
        executionId: params.executionId,
        scope: {
          projectId: params.projectId,
          missionId: params.missionId,
          goalId: goal.id,
          planRevision: goalPlanRevision(goal) ?? null,
          activePlanRevision: typeof policy.activePlanRevision === "string"
            ? policy.activePlanRevision
            : null,
          sourceRevision: params.sourceRevision ?? null,
          candidateIdentity: params.candidateIdentity ?? goalCandidateIdentity(goal),
        },
        goalStatus: "completed",
         deliveryRequired: requiresExternalDeliveryIdentity,
         deliveryReceipt: canonicalDeliveryReceipt,
      });
      canonicalProofAccepted = canonicalProof.accepted;
      if (!canonicalProofAccepted) {
        console.log("canonical recipe proof rejected", {
          executionId: params.executionId,
          failureReasons: canonicalProof.failureReasons,
          delivery: canonicalProof.delivery,
          sourceRevision: canonicalProof.sourceRevision,
          candidateIdentity: canonicalProof.candidateIdentity,
        });
        nextGoalStatus = "verifying";
        completionReason = `canonical_proof_${canonicalProof.failureReasons[0] ?? "incomplete"}`;
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
          },
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
    if (mission.status === "blocked" || mission.status === "cancelled" || mission.status === "completed") return;
    const nextMissionStatus = deriveMissionStatusFromGoals(selectActiveMissionGoals({
      mission,
      goals,
    }).map((item) =>
      item.id === goal.id ? nextGoalStatus : item.status,
    ));
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
    const sourceRevision = await resolveGitRevision(rootResult.canonicalPath);
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
    if (dispatch.action.candidateIdentity && !candidate) {
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: "candidate_not_available_for_current_revision",
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
      approvedPaths: dispatch.action.approvedPaths,
      candidateIdentity: dispatch.action.candidateIdentity ?? null,
      candidateWorkspace: candidate?.candidateWorkspace ?? null,
      userId: dispatch.userId,
      idempotencyKey: dispatch.idempotencyKey,
      runtimeStartRunner: createRuntimeStartRunner(),
      ...(skillBinding ? { skillBinding } : {}),
      parentExecutionId: dispatch.delegation.parentExecutionId,
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
            }),
          }
        : {}),
    });
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
    await syncRecipeObjectiveState({
      ...dispatch,
      executionId: result.executionId,
      sourceRevision,
      candidateIdentity: dispatch.action.candidateIdentity ?? null,
      status: result.status === "completed" && receiptIsComplete ? "completed" : "blocked",
      reason: result.status === "completed" && !receiptIsComplete
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
export async function dispatchPendingMissionRecipes(limit = 32): Promise<number> {
  const pending = await db
    .select({
      executionId: aiExecutionsTable.id,
      operationId: aiExecutionsTable.operationId,
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
    if (identity.operationId !== row.operationId) continue;
    const added = heavyJobQueue.enqueueWithId(row.executionId, async () => {
      await executeMissionRecipe({
        goalId: row.goalId!,
        userId: row.userId,
        projectId: row.projectId,
        missionId: row.missionId,
        operationId: identity.operationId,
        idempotencyKey: identity.idempotencyKey,
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
      });
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
  delegation?: MissionDelegationBinding;
}): Promise<MissionGoalRunResult> {
  const decision = await db.transaction(async (tx) => {
    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, params.goalId))
      .for("update");
    if (!goal) {
      return { status: "conflict" as const, goalId: params.goalId, reason: "goal_not_found" };
    }

    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, goal.missionId),
        eq(aiMissionsTable.projectId, goal.projectId),
        eq(aiMissionsTable.userId, params.userId),
      ))
      .for("update");
    if (!mission) {
      return { status: "conflict" as const, goalId: goal.id, reason: "mission_not_found" };
    }

    const activePlanRevision = typeof mission.autonomyPolicy.activePlanRevision === "string"
      ? mission.autonomyPolicy.activePlanRevision
      : undefined;
    const goalRevision = goalPlanRevision(goal);
    if (activePlanRevision && goalRevision && goalRevision !== activePlanRevision) {
      return {
        status: "conflict" as const,
        goalId: goal.id,
        reason: "stale_plan_revision",
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

    if (mission.status === "cancelled" || mission.status === "completed") {
      return { status: "completed" as const, goalId: goal.id, reason: "mission_terminal" };
    }
    if (goal.status === "cancelled" || goal.status === "completed") {
      return { status: "completed" as const, goalId: goal.id, reason: "goal_terminal" };
    }
    if (goal.status === "blocked" || goal.status === "waiting_for_approval") {
      return { status: "blocked" as const, goalId: goal.id, reason: "goal_operator_owned" };
    }

    const dependencyState = await loadGoalDependencyState(tx, goal);
    if (dependencyState.dependencies.length > 0) {
      const failedDependency = dependencyState.dependencyGoals.find((dependency) =>
        dependency.status === "failed"
        || dependency.status === "cancelled"
        || dependency.status === "blocked"
        || dependency.status === "needs_replan",
      );
      if (failedDependency) {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "needs_replan",
            blockedReason: `Dependency "${failedDependency.title}" did not complete.`,
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
          type: "AiGoalDependencyBlocked",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: "warning",
          message: `AI goal "${goal.title}" requires a replan because a dependency did not complete`,
          payload: {
            missionId: mission.id,
            planRevision: dependencyState.planRevision,
            dependencyGoalId: failedDependency.id,
            dependencyStatus: failedDependency.status,
          },
        });
        return { status: "blocked" as const, goalId: goal.id, reason: "dependency_failed" };
      }
      const allDependenciesCompleted =
        dependencyState.dependencies.length === dependencyState.dependencyGoals.length
        && dependencyState.dependencyGoals.every((dependency) => dependency.status === "completed");
      if (!allDependenciesCompleted) {
        const now = new Date();
        await tx.update(aiGoalsTable)
          .set({
            status: "waiting_for_event",
            blockedReason: "dependencies_pending",
            nextWakeAt: null,
            updatedAt: now,
          })
          .where(eq(aiGoalsTable.id, goal.id));
        if (mission.status !== "blocked") {
          await tx.update(aiMissionsTable)
            .set({ status: "waiting", updatedAt: now })
            .where(eq(aiMissionsTable.id, mission.id));
        }
        return { status: "waiting" as const, goalId: goal.id, reason: "dependencies_pending" };
      }
      if (goal.status === "waiting_for_event" && goal.blockedReason === "dependencies_pending") {
        await tx.update(aiGoalsTable)
          .set({ status: "queued", blockedReason: null, updatedAt: new Date() })
          .where(eq(aiGoalsTable.id, goal.id));
      }
    }

    const parsedAction = GoalNextActionSchema.safeParse(goal.nextAction);
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
        return {
          status: "scheduled" as const,
          goalId: goal.id,
          executionId: activeExecution.id,
          reason: "execution_already_active",
          delegation,
        };
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
        },
      });
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
          delegation,
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
      return {
        status: "scheduled" as const,
        goalId: goal.id,
        taskId: task.id,
        executionId: activeExecution.id,
        reason: "execution_already_active",
        delegation: taskDelegation,
      };
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
    return { status: "scheduled" as const, goalId: goal.id, taskId: task.id, delegation: taskDelegation };
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
  return decision;
}

/**
 * Re-queues Goals that were held on a completion dependency. This uses the
 * existing durable dispatcher; it does not execute a second dependency engine.
 */
export async function wakeReadyMissionGoals(limit = 32): Promise<number> {
  const candidates = await db
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.status, "waiting_for_event"),
      eq(aiGoalsTable.blockedReason, "dependencies_pending"),
    ))
    .orderBy(aiGoalsTable.updatedAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let woken = 0;
  for (const candidate of candidates) {
    const ready = await db.transaction(async (tx) => {
      const [goal] = await tx
        .select()
        .from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, candidate.id),
          eq(aiGoalsTable.missionId, candidate.missionId),
          eq(aiGoalsTable.projectId, candidate.projectId),
          eq(aiGoalsTable.status, "waiting_for_event"),
          eq(aiGoalsTable.blockedReason, "dependencies_pending"),
        ))
        .for("update");
      if (!goal) return undefined;
      const [mission] = await tx
        .select({ userId: aiMissionsTable.userId })
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, goal.missionId),
          eq(aiMissionsTable.projectId, goal.projectId),
        ))
        .for("update");
      if (!mission) return undefined;
      const dependencyState = await loadGoalDependencyState(tx, goal);
      const allDependenciesCompleted =
        dependencyState.dependencies.length > 0
        && dependencyState.dependencies.length === dependencyState.dependencyGoals.length
        && dependencyState.dependencyGoals.every((dependency) => dependency.status === "completed");
      if (!allDependenciesCompleted) return undefined;
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
 * Converts due scheduled waits into a durable replan request.
 *
 * Approval waits are intentionally excluded: they require an operator or
 * external approval event, not a timer. The row lock makes overlapping
 * sweepers claim a Goal only once.
 */
export async function wakeDueMissionGoals(limit = 32): Promise<number> {
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
    ))
    .orderBy(aiGoalsTable.nextWakeAt, aiGoalsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let woken = 0;
  for (const candidate of dueGoals) {
    const changed = await db.transaction(async (tx) => {
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
      const [mission] = await tx
        .select()
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, goal.missionId),
          eq(aiMissionsTable.projectId, goal.projectId),
        ))
        .for("update");
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

    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, goal.missionId),
        eq(aiMissionsTable.projectId, goal.projectId),
      ))
      .for("update");
    if (!mission || ["blocked", "cancelled", "completed"].includes(mission.status)) return false;

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
export async function replayPendingMissionEvents(limit = 32): Promise<number> {
  const rows = await db
    .select({
      id: eventsTable.id,
      payload: eventsTable.payload,
    })
    .from(eventsTable)
    .where(eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE))
    .orderBy(eventsTable.timestamp, eventsTable.id)
    .limit(Math.max(1, Math.min(limit, 100)));

  let replayed = 0;
  for (const row of rows) {
    const stored = storedMissionEvent(row.payload);
    if (!stored?.envelope || stored.processedAt) continue;
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