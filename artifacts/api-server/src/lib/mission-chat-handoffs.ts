import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { aiMissionHandoffsTable, db } from "@workspace/db";
import { logger } from "./logger.js";
import { runMissionGoal } from "./mission-runtime.js";

export const MISSION_CHAT_HANDOFF_DISPATCH_LEASE_MS = 10 * 60_000;

type MissionChatHandoffTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionChatHandoffLeaseClaim = {
  handoff: typeof aiMissionHandoffsTable.$inferSelect;
  token: string;
};

async function readDatabaseNow(tx: MissionChatHandoffTransaction): Promise<Date | null> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(now.getTime()) ? now : null;
}

async function claimMissionChatHandoffDispatch(
  handoffId: string,
): Promise<MissionChatHandoffLeaseClaim | null> {
  return db.transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, handoffId))
      .for("update")
      .limit(1);
    if (!handoff || handoff.dispatchStatus !== "pending") return null;

    const now = await readDatabaseNow(tx);
    if (!now) return null;
    const currentLease = handoff.dispatchLease;
    const currentExpiry = currentLease && typeof currentLease.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    if (Number.isFinite(currentExpiry) && currentExpiry > now.getTime()) return null;

    const token = randomUUID();
    const expiresAt = new Date(
      now.getTime() + MISSION_CHAT_HANDOFF_DISPATCH_LEASE_MS,
    ).toISOString();
    const [claimed] = await tx
      .update(aiMissionHandoffsTable)
      .set({
        dispatchLease: { token, expiresAt },
        updatedAt: now,
      })
      .where(and(
        eq(aiMissionHandoffsTable.id, handoff.id),
        eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
      ))
      .returning({ id: aiMissionHandoffsTable.id });
    if (!claimed) return null;
    return {
      handoff: { ...handoff, dispatchLease: { token, expiresAt } },
      token,
    };
  });
}

async function settleMissionChatHandoffDispatch(
  handoffId: string,
  token: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, handoffId))
      .for("update")
      .limit(1);
    if (
      !handoff
      || handoff.dispatchStatus !== "pending"
      || handoff.dispatchLease?.token !== token
    ) return false;

    const now = await readDatabaseNow(tx);
    const expiresAt = typeof handoff.dispatchLease.expiresAt === "string"
      ? Date.parse(handoff.dispatchLease.expiresAt)
      : Number.NaN;
    if (!now || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;

    const [settled] = await tx
      .update(aiMissionHandoffsTable)
      .set({
        dispatchStatus: "dispatched",
        dispatchLease: null,
        dispatchedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(aiMissionHandoffsTable.id, handoff.id),
        eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
      ))
      .returning({ id: aiMissionHandoffsTable.id });
    return Boolean(settled);
  });
}

async function releaseMissionChatHandoffDispatch(
  handoffId: string,
  token: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [handoff] = await tx
      .select({
        dispatchStatus: aiMissionHandoffsTable.dispatchStatus,
        dispatchLease: aiMissionHandoffsTable.dispatchLease,
      })
      .from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, handoffId))
      .for("update")
      .limit(1);
    if (
      !handoff
      || handoff.dispatchStatus !== "pending"
      || handoff.dispatchLease?.token !== token
    ) return;
    const now = await readDatabaseNow(tx);
    if (!now) return;
    await tx.update(aiMissionHandoffsTable)
      .set({ dispatchLease: null, updatedAt: now })
      .where(and(
        eq(aiMissionHandoffsTable.id, handoffId),
        eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
      ));
  });
}

/**
 * Consume one durable Chat-to-Mission handoff through the normal Goal runner.
 * A database lease prevents multiple API replicas from fanning out the same
 * root Goals; the runtime independently revalidates the lease token before
 * admitting each Goal.
 */
export async function dispatchMissionChatHandoff(handoffId: string) {
  const claim = await claimMissionChatHandoffDispatch(handoffId);
  if (!claim) return [];
  const { handoff, token } = claim;

  try {
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

    // Wait for every root attempt to settle before releasing the lease on an
    // error; this avoids starting a replacement dispatcher while siblings are
    // still completing their database admission transactions.
    const results = await Promise.allSettled(handoff.dispatchGoalIds.map((goalId) =>
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
          dispatchLeaseToken: token,
        },
      }),
    ));
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    const runs = results.map((result) => (
      (result as PromiseFulfilledResult<Awaited<ReturnType<typeof runMissionGoal>>>).value
    ));

    // A token rejected by the runtime means another replica took over. The
    // new lease owner is responsible for dispatch and settlement.
    if (runs.some((run) => (
      run.status === "conflict" && run.reason === "handoff_dispatch_lease_lost"
    ))) return [];

    const settled = await settleMissionChatHandoffDispatch(handoff.id, token);
    return settled ? runs : [];
  } catch (error) {
    await releaseMissionChatHandoffDispatch(handoff.id, token).catch((releaseError) => {
      logger.warn(
        { releaseError, handoffId: handoff.id },
        "Could not release failed Chat-to-Mission handoff lease; it will expire for recovery.",
      );
    });
    throw error;
  }
}

/**
 * Replays handoffs committed before their in-process dispatch completed.
 * Only the current lease owner can start roots and mark the handoff dispatched.
 */
export async function dispatchPendingMissionChatHandoffs(
  limit = 32,
  scopeProjectId?: string,
): Promise<number> {
  const pending = await db
    .select({ id: aiMissionHandoffsTable.id })
    .from(aiMissionHandoffsTable)
    .where(and(
      eq(aiMissionHandoffsTable.dispatchStatus, "pending"),
      scopeProjectId ? eq(aiMissionHandoffsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(asc(aiMissionHandoffsTable.createdAt), asc(aiMissionHandoffsTable.id))
    .limit(limit);

  let dispatched = 0;
  for (const handoff of pending) {
    try {
      const runs = await dispatchMissionChatHandoff(handoff.id);
      if (runs.length > 0) dispatched++;
    } catch (error) {
      logger.error(
        { err: error, handoffId: handoff.id },
        "Failed to dispatch persisted Chat-to-Mission handoff",
      );
    }
  }
  return dispatched;
}
