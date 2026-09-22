import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { GoalNextActionSchema, type GoalNextAction } from "@workspace/ai-orchestrator";
import { deriveMissionStatusFromGoals } from "./ai-execution-acceptance.js";
import { deliveryWorkspaceExists } from "./delivery-workspace.js";
import { establishProjectRoot } from "./project-root.js";
import { runRecipeOperation } from "./recipe-operation-runner.js";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";
import { scheduleAiTaskExecution } from "../routes/ai/tasks.js";

const execFileAsync = promisify(execFile);

export type MissionGoalRunTrigger = "activation" | "wake" | "resume" | "replan";

export type MissionGoalRunResult = {
  status: "scheduled" | "waiting" | "blocked" | "completed" | "conflict";
  goalId: string;
  taskId?: string;
  executionId?: string;
  reason?: string;
};

const ACTIVE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
const RECIPE_EXECUTION_STATUSES = ["queued", "running", "paused", "cancelling"] as const;
type RecipeGoalAction = Extract<GoalNextAction, { kind: "recipe" }>;

type RecipeDispatch = {
  goalId: string;
  userId: string;
  projectId: string;
  missionId: string;
  operationId: string;
  idempotencyKey: string;
  action: RecipeGoalAction;
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

function recipeOperationIdentity(goalId: string, action: RecipeGoalAction): {
  operationId: string;
  idempotencyKey: string;
} {
  const digest = createHash("sha256").update(JSON.stringify({
    goalId,
    recipeId: action.recipeId,
    recipeVersion: action.recipeVersion,
    approvedPaths: action.approvedPaths,
    candidateIdentity: action.candidateIdentity ?? null,
  })).digest("hex");
  return {
    operationId: `mission-goal-${goalId}-${digest.slice(0, 16)}`,
    idempotencyKey: `mission-goal:${goalId}:${digest.slice(0, 32)}`,
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
  status: "completed" | "blocked" | "failed" | "needs_replan";
  reason?: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
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

    const nextGoalStatus = params.status;
    await tx.update(aiGoalsTable)
      .set({
        status: nextGoalStatus,
        blockedReason: nextGoalStatus === "completed" ? null : (params.reason ?? "Recipe execution did not complete."),
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
      .select({ id: aiGoalsTable.id, status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, params.missionId),
        eq(aiGoalsTable.projectId, params.projectId),
      ))
      .for("update");
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, params.missionId),
        eq(aiMissionsTable.projectId, params.projectId),
      ))
      .for("update");
    if (!mission || mission.status === "blocked" || mission.status === "cancelled") return;
    const nextMissionStatus = deriveMissionStatusFromGoals(goals.map((item) =>
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
    const candidate = await loadRecipeCandidate(dispatch.projectId, dispatch.action, sourceRevision);
    if (dispatch.action.candidateIdentity && !candidate) {
      await syncRecipeObjectiveState({
        ...dispatch,
        status: "blocked",
        reason: "candidate_not_available_for_current_revision",
      });
      return;
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
    });
    await syncRecipeObjectiveState({
      ...dispatch,
      executionId: result.executionId,
      status: result.status === "completed" ? "completed" : "blocked",
      reason: result.status === "completed" ? undefined : "recipe_acceptance_blocked",
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

    if (mission.status === "cancelled" || mission.status === "completed") {
      return { status: "completed" as const, goalId: goal.id, reason: "mission_terminal" };
    }
    if (goal.status === "cancelled" || goal.status === "completed") {
      return { status: "completed" as const, goalId: goal.id, reason: "goal_terminal" };
    }
    if (goal.status === "blocked" || goal.status === "waiting_for_approval") {
      return { status: "blocked" as const, goalId: goal.id, reason: "goal_operator_owned" };
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
      const identity = recipeOperationIdentity(goal.id, action);
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
      payload: { missionId: mission.id, trigger: params.trigger, action: action.kind },
    });
    return { status: "scheduled" as const, goalId: goal.id, taskId: task.id };
  });

  if (decision.recipeDispatch && decision.status === "scheduled" && !decision.executionId) {
    heavyJobQueue.enqueueWithId(decision.recipeDispatch.operationId, async () => {
      await executeMissionRecipe(decision.recipeDispatch!);
    });
  } else if (decision.taskId && !decision.executionId && decision.status === "scheduled") {
    scheduleAiTaskExecution(decision.taskId, params.userId);
  }
  return decision;
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