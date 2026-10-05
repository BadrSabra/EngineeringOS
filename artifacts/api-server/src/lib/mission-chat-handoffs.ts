import { and, asc, eq } from "drizzle-orm";
import { aiMissionHandoffsTable, db } from "@workspace/db";
import { logger } from "./logger.js";
import { runMissionGoal } from "./mission-runtime.js";

/**
 * Consume a durable Chat-to-Mission dispatch record through the normal
 * Mission Goal runner. Duplicate dispatch is safe because runMissionGoal
 * serializes on the Mission/Goal rows and recognizes already-active work.
 */
export async function dispatchMissionChatHandoff(handoffId: string) {
  const [handoff] = await db
    .select()
    .from(aiMissionHandoffsTable)
    .where(eq(aiMissionHandoffsTable.id, handoffId))
    .limit(1);
  if (!handoff || handoff.dispatchStatus === "dispatched") return [];
  if (
    !Array.isArray(handoff.dispatchGoalIds)
    || handoff.dispatchGoalIds.some((goalId) => typeof goalId !== "string" || !goalId)
  ) {
    throw new Error("Mission handoff outbox contains invalid Goal identities.");
  }
  const activationPlan = handoff.activationPlan;
  const activationGoals = activationPlan?.goals;
  if (
    !handoff.missionId
    || !handoff.projectId
    || !handoff.planHash?.trim()
    || !activationPlan
    || activationPlan.revision !== handoff.planHash
    || !Array.isArray(activationGoals)
    || activationGoals.length === 0
    || activationGoals.some((goal) => (
      !goal
      || typeof goal.goalId !== "string"
      || !goal.goalId.trim()
      || !Array.isArray(goal.dependencies)
      || goal.dependencies.some((dependency) => typeof dependency !== "string")
    ))
  ) {
    throw new Error("Mission handoff does not contain a valid persisted activation plan.");
  }
  const expectedGoalIds = activationGoals
    .filter((goal) => goal.dependencies.length === 0)
    .map((goal) => goal.goalId);
  if (
    expectedGoalIds.length === 0
    || new Set(expectedGoalIds).size !== expectedGoalIds.length
    || new Set(handoff.dispatchGoalIds).size !== handoff.dispatchGoalIds.length
    || JSON.stringify(handoff.dispatchGoalIds) !== JSON.stringify(expectedGoalIds)
  ) {
    throw new Error("Mission handoff outbox no longer matches its persisted activation plan.");
  }

  const runs = await Promise.all(handoff.dispatchGoalIds.map((goalId) =>
    runMissionGoal({
      goalId,
      userId: handoff.userId,
      trigger: "activation",
      expectedHandoffBinding: {
        handoffId: handoff.id,
        missionId: handoff.missionId,
        projectId: handoff.projectId,
        planRevision: handoff.planHash,
        dispatchGoalIds: expectedGoalIds,
      },
    }),
  ));

  await db.update(aiMissionHandoffsTable)
    .set({
      dispatchStatus: "dispatched",
      dispatchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiMissionHandoffsTable.id, handoff.id),
      eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
    ));
  return runs;
}

/**
 * Replays handoffs committed before their in-process dispatch completed.
 * The Mission Runtime remains the only execution and recovery owner.
 */
export async function dispatchPendingMissionChatHandoffs(limit = 32): Promise<number> {
  const pending = await db
    .select({ id: aiMissionHandoffsTable.id })
    .from(aiMissionHandoffsTable)
    .where(eq(aiMissionHandoffsTable.dispatchStatus, "pending"))
    .orderBy(asc(aiMissionHandoffsTable.createdAt), asc(aiMissionHandoffsTable.id))
    .limit(limit);

  let dispatched = 0;
  for (const handoff of pending) {
    try {
      await dispatchMissionChatHandoff(handoff.id);
      dispatched++;
    } catch (error) {
      logger.error(
        { err: error, handoffId: handoff.id },
        "Failed to dispatch persisted Chat-to-Mission handoff",
      );
    }
  }
  return dispatched;
}
