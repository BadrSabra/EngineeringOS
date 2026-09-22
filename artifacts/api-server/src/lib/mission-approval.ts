import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { runMissionGoal, type MissionGoalRunResult } from "./mission-runtime.js";

export type ApproveMissionGoalResult =
  | {
      status: "approved";
      missionId: string;
      goalId: string;
      executionId: string;
      proposalId: string;
      revision: number;
      run: MissionGoalRunResult;
    }
  | {
      status: "conflict" | "not_found";
      missionId: string;
      goalId: string;
      reason: string;
    };

/**
 * Approves the current server-owned proposal for a Mission Goal.
 *
 * This only clears the proposal approval gate. File application and delivery
 * remain behind their existing proposal/workspace/evidence guards.
 */
export async function approveMissionGoal(params: {
  missionId: string;
  goalId: string;
  userId: string;
}): Promise<ApproveMissionGoalResult> {
  const prepared = await db.transaction(async (tx) => {
    const [goal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, params.goalId),
        eq(aiGoalsTable.missionId, params.missionId),
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

    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, params.missionId),
        eq(aiMissionsTable.projectId, goal.projectId),
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
  return {
    status: "approved",
    missionId: prepared.missionId,
    goalId: prepared.goalId,
    executionId: prepared.executionId,
    proposalId: prepared.proposalId,
    revision: prepared.revision,
    run,
  };
}