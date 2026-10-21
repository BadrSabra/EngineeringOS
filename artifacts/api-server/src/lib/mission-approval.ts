import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  tasksTable,
} from "@workspace/db";
import { runMissionGoal, type MissionGoalRunResult } from "./mission-runtime.js";

export type ApproveMissionGoalResult =
  | {
      status: "approved";
      approvalKind: "proposal";
      missionId: string;
      goalId: string;
      executionId: string;
      proposalId: string;
      revision: number;
      run: MissionGoalRunResult;
    }
  | {
      status: "approved";
      approvalKind: "plan";
      missionId: string;
      goalId: string;
      planRevision: string;
      stepId: string;
      run: MissionGoalRunResult;
    }
  | {
      status: "conflict" | "not_found";
      missionId: string;
      goalId: string;
      reason: string;
    };

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Approves either the exact pending Mission plan step or the current
 * server-owned proposal for a Mission Goal.
 *
 * Plan approval only authorizes the bounded candidate-generation step.
 * Proposal approval remains a separate gate; file application and delivery
 * remain behind their existing proposal/workspace/evidence guards.
 */
export async function approveMissionGoal(params: {
  missionId: string;
  goalId: string;
  userId: string;
}): Promise<ApproveMissionGoalResult> {
  const prepared = await db.transaction(async (tx) => {
    // Keep the global Mission-before-Goal order used by status/completion
    // mutations. Reversing it can deadlock with a completion that holds the
    // Mission row while waiting for this Goal.
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, params.missionId),
        eq(aiMissionsTable.userId, params.userId),
      ))
      .for("update");
    if (!mission) {
      return {
        status: "not_found" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "mission_not_found",
      };
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
      return {
        status: "not_found" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "goal_not_found",
      };
    }
    if (mission.status === "completed" || mission.status === "cancelled" || mission.status === "blocked") {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "mission_operator_owned_or_terminal",
      };
    }
    if (goal.status !== "waiting_for_approval") {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "goal_not_waiting_for_approval",
      };
    }

    const successCriteria = jsonRecord(goal.successCriteria);
    const outcomeContract = jsonRecord(goal.outcomeContract);
    const successPlanRevision = jsonRecord(successCriteria.planRevision);
    const outcomePlanRevision = jsonRecord(outcomeContract.planRevision);
    const planApproval = jsonRecord(outcomeContract.planApproval);
    if (
      planApproval.kind === "mission_plan_step"
      && planApproval.state === "PENDING"
    ) {
      const planHash = typeof outcomePlanRevision.hash === "string"
        ? outcomePlanRevision.hash
        : undefined;
      const stepId = typeof successCriteria.stepId === "string"
        ? successCriteria.stepId
        : undefined;
      const planSteps = Array.isArray(outcomePlanRevision.steps)
        ? outcomePlanRevision.steps
        : [];
      const planStep = planSteps
        .map(jsonRecord)
        .find((step) => step.id === stepId);
      const autonomyPolicy = jsonRecord(mission.autonomyPolicy);
      const nextAction = jsonRecord(goal.nextAction);
      const planBound =
        (successCriteria.kind === "mission_plan_step"
          || successCriteria.kind === "mission_replan_step")
        && typeof planHash === "string"
        && /^[a-f0-9]{64}$/.test(planHash)
        && planHash === successPlanRevision.hash
        && planHash === autonomyPolicy.activePlanRevision
        && stepId === outcomeContract.stepId
        && planApproval.planRevision === planHash
        && planApproval.stepId === stepId
        && planStep?.kind === "execute"
        && planStep.approvalRequired === true
        && planStep.readOnly === false
        && !planStep.recipe
        && Array.isArray(planStep.files)
        && planStep.files.length > 0
        && nextAction.kind === "wait"
        && nextAction.reason === "approval";
      if (!planHash || !stepId || !planBound) {
        return {
          status: "conflict" as const,
          missionId: params.missionId,
          goalId: params.goalId,
          reason: "plan_approval_binding_mismatch",
        };
      }
      if (["needs_replan", "failed"].includes(mission.status)) {
        return {
          status: "conflict" as const,
          missionId: params.missionId,
          goalId: params.goalId,
          reason: "mission_requires_replan",
        };
      }

      const [task] = await tx
        .select({ id: tasksTable.id, phase: tasksTable.phase })
        .from(tasksTable)
        .where(and(
          eq(tasksTable.goalId, goal.id),
          eq(tasksTable.projectId, goal.projectId),
        ))
        .limit(1);
      if (!task || task.phase !== "execute") {
        return {
          status: "conflict" as const,
          missionId: params.missionId,
          goalId: params.goalId,
          reason: "plan_approval_task_missing",
        };
      }
      const [priorExecution] = await tx
        .select({ id: aiExecutionsTable.id })
        .from(aiExecutionsTable)
        .where(and(
          eq(aiExecutionsTable.goalId, goal.id),
          eq(aiExecutionsTable.projectId, goal.projectId),
          eq(aiExecutionsTable.userId, params.userId),
        ))
        .limit(1);
      if (priorExecution) {
        return {
          status: "conflict" as const,
          missionId: params.missionId,
          goalId: params.goalId,
          reason: "plan_approval_execution_already_started",
        };
      }

      const now = new Date();
      const updatedGoal = await tx.update(aiGoalsTable)
        .set({
          status: "queued",
          blockedReason: null,
          nextWakeAt: null,
          nextAction: {
            kind: "task",
            taskId: task.id,
            purpose: successCriteria.kind === "mission_plan_step" ? "activation" : "execution",
          },
          outcomeContract: {
            ...outcomeContract,
            planApproval: {
              ...planApproval,
              state: "APPROVED",
              approvedBy: params.userId,
              approvedAt: now.toISOString(),
            },
          },
          updatedAt: now,
        })
        .where(and(
          eq(aiGoalsTable.id, goal.id),
          eq(aiGoalsTable.status, "waiting_for_approval"),
        ))
        .returning({ id: aiGoalsTable.id });
      if (!updatedGoal[0]) {
        return {
          status: "conflict" as const,
          missionId: params.missionId,
          goalId: params.goalId,
          reason: "goal_changed_during_plan_approval",
        };
      }
      if (mission.status === "waiting") {
        await tx.update(aiMissionsTable)
          .set({ status: "active", updatedAt: now })
          .where(and(
            eq(aiMissionsTable.id, mission.id),
            eq(aiMissionsTable.status, "waiting"),
          ));
      }
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalApprovalGranted",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "success",
        message: `AI goal "${goal.title}" plan step was explicitly approved`,
        correlationId: goal.id,
        payload: {
          missionId: mission.id,
          goalId: goal.id,
          approvalKind: "mission_plan_step",
          planRevision: planHash,
          stepId,
        },
      });

      return {
        status: "prepared" as const,
        approvalKind: "plan" as const,
        missionId: mission.id,
        goalId: goal.id,
        userId: mission.userId,
        planRevision: planHash,
        stepId,
      };
    }

    const [execution] = await tx
      .select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.goalId, goal.id),
        eq(aiExecutionsTable.projectId, goal.projectId),
        eq(aiExecutionsTable.userId, params.userId),
        inArray(aiExecutionsTable.status, ["queued", "running", "paused", "failed"]),
      ))
      .orderBy(desc(aiExecutionsTable.updatedAt), desc(aiExecutionsTable.id))
      .limit(1)
      .for("update");
    if (!execution?.proposalId) {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "approval_execution_or_proposal_missing",
      };
    }

    const [proposal] = await tx
      .select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, execution.proposalId),
        eq(aiChangeProposalsTable.projectId, goal.projectId),
      ))
      .for("update");
    if (!proposal) {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "approval_proposal_missing",
      };
    }
    if (proposal.status !== "pending" || !proposal.approvalRequired) {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "proposal_already_consumed_or_approval_not_required",
      };
    }

    const updatedProposal = await tx
      .update(aiChangeProposalsTable)
      .set({ approvalRequired: false })
      .where(and(
        eq(aiChangeProposalsTable.id, proposal.id),
        eq(aiChangeProposalsTable.projectId, goal.projectId),
        eq(aiChangeProposalsTable.status, "pending"),
        eq(aiChangeProposalsTable.approvalRequired, true),
        eq(aiChangeProposalsTable.revision, proposal.revision),
      ))
      .returning({ id: aiChangeProposalsTable.id });
    if (!updatedProposal[0]) {
      return {
        status: "conflict" as const,
        missionId: params.missionId,
        goalId: params.goalId,
        reason: "proposal_revision_changed",
      };
    }

    const now = new Date();
    await tx.update(aiGoalsTable)
      .set({
        status: "queued",
        blockedReason: null,
        nextWakeAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(aiGoalsTable.id, goal.id),
        eq(aiGoalsTable.status, "waiting_for_approval"),
      ));
    if (mission.status === "waiting") {
      await tx.update(aiMissionsTable)
        .set({ status: "active", updatedAt: now })
        .where(and(
          eq(aiMissionsTable.id, mission.id),
          eq(aiMissionsTable.status, "waiting"),
        ));
    }
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalApprovalGranted",
      projectId: goal.projectId,
      goalId: goal.id,
      severity: "success",
      message: `Approval granted for AI goal "${goal.title}"`,
      correlationId: execution.correlationId ?? execution.id,
      payload: {
        missionId: mission.id,
        executionId: execution.id,
        proposalId: proposal.id,
        revision: proposal.revision,
      },
    });

    return {
      status: "prepared" as const,
      approvalKind: "proposal" as const,
      missionId: mission.id,
      goalId: goal.id,
      userId: mission.userId,
      executionId: execution.id,
      proposalId: proposal.id,
      revision: proposal.revision,
    };
  });

  if (prepared.status !== "prepared") return prepared;
  const run = await runMissionGoal({
    goalId: prepared.goalId,
    userId: prepared.userId,
    trigger: "resume",
  });
  if (prepared.approvalKind === "plan") {
    return {
      status: "approved",
      approvalKind: "plan",
      missionId: prepared.missionId,
      goalId: prepared.goalId,
      planRevision: prepared.planRevision,
      stepId: prepared.stepId,
      run,
    };
  }
  return {
    status: "approved",
    approvalKind: "proposal",
    missionId: prepared.missionId,
    goalId: prepared.goalId,
    executionId: prepared.executionId,
    proposalId: prepared.proposalId,
    revision: prepared.revision,
    run,
  };
}