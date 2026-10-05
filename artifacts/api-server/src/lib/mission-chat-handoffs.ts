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

  const runs = await Promise.all(handoff.dispatchGoalIds.map((goalId) =>
    runMissionGoal({
      goalId,
      userId: handoff.userId,
      trigger: "activation",
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
