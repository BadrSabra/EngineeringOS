import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import { wakeReadyMissionGoals } from "./mission-runtime.js";
import { finalizeMissionPlanOutcomesAfterGoalCompletion } from "./mission-strategy-plan-outcome-store.js";

export const MISSION_GOAL_WAKE_REQUESTED = "MissionGoalWakeRequested";
export const MISSION_GOAL_WAKE_DEFERRED = "MissionGoalWakeDeferred";
export const MISSION_GOAL_WAKE_DISPATCHED = "MissionGoalWakeDispatched";
export const MISSION_GOAL_WAKE_SUPERSEDED = "MissionGoalWakeSuperseded";
export const MISSION_GOAL_WAKE_DEAD_LETTER = "MissionGoalWakeDeadLetter";

export const MAX_MISSION_GOAL_WAKE_ATTEMPTS = 8;
export const MISSION_GOAL_WAKE_DISPATCH_LEASE_MS = 10 * 60_000;
const MIN_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type MissionGoalWakeOutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionGoalWakePayload = {
  missionId: string;
  goalId: string;
  completedAt: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastFailureCode?: string;
  dispatchedAt?: string;
  wokenDependents?: number;
};

export type MissionGoalWakeDispatchLeaseClaim =
  | { acquired: true; token: string; expiresAt: string }
  | {
      acquired: false;
      reason: "intent_not_pending" | "retry_not_due" | "already_leased";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function missionGoalWakeIntentId(goalId: string, completedAt: Date): string {
  return `mission-goal-wake:${goalId}:${completedAt.getTime()}`;
}

function parsePayload(value: unknown): MissionGoalWakePayload | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.missionId !== "string"
    || value.missionId.length === 0
    || typeof value.goalId !== "string"
    || value.goalId.length === 0
    || typeof value.completedAt !== "string"
    || !Number.isFinite(Date.parse(value.completedAt))
  ) return null;
  const attemptCount = value.attemptCount ?? 0;
  if (!Number.isSafeInteger(attemptCount) || Number(attemptCount) < 0) return null;
  const nextAttemptAt = value.nextAttemptAt;
  if (nextAttemptAt !== undefined && (
    typeof nextAttemptAt !== "string" || !Number.isFinite(Date.parse(nextAttemptAt))
  )) return null;
  return {
    missionId: value.missionId,
    goalId: value.goalId,
    completedAt: value.completedAt,
    attemptCount: Number(attemptCount),
    nextAttemptAt: typeof nextAttemptAt === "string" ? nextAttemptAt : new Date(0).toISOString(),
    ...(typeof value.lastFailureCode === "string" ? { lastFailureCode: value.lastFailureCode } : {}),
  };
}

/**
 * Persist a Mission continuation wake in the same transaction as its
 * proof-gated Goal completion. This event is a scheduling intent, not authority.
 */
export async function insertMissionGoalWakeIntent(
  tx: MissionGoalWakeOutboxTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    completedAt: Date;
  },
): Promise<string> {
  const id = missionGoalWakeIntentId(input.goalId, input.completedAt);
  const now = input.completedAt;
  const payload: MissionGoalWakePayload = {
    missionId: input.missionId,
    goalId: input.goalId,
    completedAt: input.completedAt.toISOString(),
    attemptCount: 0,
    nextAttemptAt: now.toISOString(),
  };
  await tx.insert(eventsTable).values({
    id,
    type: MISSION_GOAL_WAKE_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    severity: "info",
    message: "A proven Mission Goal completion requested a dependent wake.",
    timestamp: now,
    payload,
  }).onConflictDoNothing();
  return id;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    MAX_RETRY_DELAY_MS,
    MIN_RETRY_DELAY_MS * 2 ** Math.min(Math.max(attemptCount, 0), 4),
  );
}

function safeFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "MISSION_GOAL_WAKE_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "MISSION_GOAL_WAKE_FAILED";
}

async function readDatabaseNow(): Promise<Date | null> {
  const result = await db.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const value = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(value.getTime()) ? value : null;
}

/**
 * Claim a pending Mission Goal wake before doing any dispatch work. The row
 * lock makes the claim exclusive across API replicas; the expiry makes it
 * recoverable after a process exits without releasing its lease.
 */
export async function claimMissionGoalWakeDispatchLease(
  tx: MissionGoalWakeOutboxTransaction,
  input: { intentId: string },
): Promise<MissionGoalWakeDispatchLeaseClaim> {
  const [intent] = await tx.select({
    type: eventsTable.type,
    payload: eventsTable.payload,
  }).from(eventsTable)
    .where(eq(eventsTable.id, input.intentId))
    .for("update")
    .limit(1);

  if (
    !intent
    || ![MISSION_GOAL_WAKE_REQUESTED, MISSION_GOAL_WAKE_DEFERRED].includes(intent.type)
  ) {
    return { acquired: false, reason: "intent_not_pending" };
  }

  const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const rawNow = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow ?? ""));
  if (!rawNow || !Number.isFinite(now.getTime())) {
    return { acquired: false, reason: "intent_not_pending" };
  }

  const payload = isRecord(intent.payload) ? intent.payload : {};
  const retryAt = typeof payload.nextAttemptAt === "string"
    ? Date.parse(payload.nextAttemptAt)
    : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > now.getTime()) {
    return { acquired: false, reason: "retry_not_due" };
  }

  const currentLease = isRecord(payload.dispatchLease) ? payload.dispatchLease : undefined;
  const leaseExpiry = typeof currentLease?.expiresAt === "string"
    ? Date.parse(currentLease.expiresAt)
    : Number.NaN;
  if (Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) {
    return { acquired: false, reason: "already_leased" };
  }

  const token = randomUUID();
  const expiresAt = new Date(
    now.getTime() + MISSION_GOAL_WAKE_DISPATCH_LEASE_MS,
  ).toISOString();
  await tx.update(eventsTable)
    .set({
      payload: {
        ...payload,
        dispatchLease: { token, expiresAt },
      },
    })
    .where(eq(eventsTable.id, input.intentId));

  return { acquired: true, token, expiresAt };
}

async function markWakeIntent(
  id: string,
  expectedTypes: string[],
  type: string,
  payload: Record<string, unknown>,
  message: string,
  dispatchLeaseToken: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, id))
      .for("update")
      .limit(1);
    if (!row || !expectedTypes.includes(row.type)) return false;

    const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
    const rawNow = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
    const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow ?? ""));
    if (!rawNow || !Number.isFinite(now.getTime())) return false;

    const currentPayload = isRecord(row.payload) ? row.payload : undefined;
    const currentLease = currentPayload && isRecord(currentPayload.dispatchLease)
      ? currentPayload.dispatchLease
      : undefined;
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    // A worker may commit only while it still owns an unexpired lease.
    if (
      currentLease?.token !== dispatchLeaseToken
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return false;

    const payloadWithoutLease = { ...payload };
    delete payloadWithoutLease.dispatchLease;
    const [updated] = await tx.update(eventsTable)
      .set({
        type,
        payload: payloadWithoutLease,
        message,
        timestamp: now,
      })
      .where(and(
        eq(eventsTable.id, id),
        inArray(eventsTable.type, expectedTypes),
      ))
      .returning({ id: eventsTable.id });
    return Boolean(updated);
  });
}

async function deferWakeIntent(
  id: string,
  error: unknown,
  dispatchLeaseToken: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, id))
      .for("update")
      .limit(1);
    if (!row || ![MISSION_GOAL_WAKE_REQUESTED, MISSION_GOAL_WAKE_DEFERRED].includes(row.type)) {
      return;
    }
    const currentPayload = isRecord(row.payload) ? row.payload : undefined;
    const currentLease = currentPayload && isRecord(currentPayload.dispatchLease)
      ? currentPayload.dispatchLease
      : undefined;
    // Read PostgreSQL time through the transaction's own connection. A
    // nested global-pool query here could deadlock when the pool is saturated.
    const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
    const rawNow = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
    const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow ?? ""));
    if (!rawNow || !Number.isFinite(now.getTime())) return;
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    // An expired or replaced worker cannot defer this durable intent.
    if (
      currentLease?.token !== dispatchLeaseToken
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return;
    const parsed = parsePayload(row.payload);
    if (!parsed) {
      await tx.update(eventsTable)
        .set({
          type: MISSION_GOAL_WAKE_DEAD_LETTER,
          severity: "error",
          message: "Mission Goal wake intent has an invalid durable payload.",
          payload: { invalidPayload: true, deadLetteredAt: now.toISOString() },
          timestamp: now,
        })
        .where(eq(eventsTable.id, id));
      return;
    }
    const attemptCount = parsed.attemptCount + 1;
    const deadLettered = attemptCount >= MAX_MISSION_GOAL_WAKE_ATTEMPTS;
    const payload: MissionGoalWakePayload = {
      ...parsed,
      attemptCount,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount - 1)).toISOString(),
      lastFailureCode: safeFailureCode(error),
    };
    await tx.update(eventsTable)
      .set({
        type: deadLettered ? MISSION_GOAL_WAKE_DEAD_LETTER : MISSION_GOAL_WAKE_DEFERRED,
        severity: deadLettered ? "error" : "warning",
        message: deadLettered
          ? "Mission Goal wake intent exhausted its bounded retry budget."
          : "Mission Goal wake intent is deferred for bounded retry.",
        payload: {
          ...payload,
          ...(deadLettered ? { deadLetteredAt: now.toISOString() } : {}),
        },
        timestamp: now,
      })
      .where(eq(eventsTable.id, id));
  });
}

/**
 * Dispatch exactly one durable wake. Duplicate callers are safe: the Goal
 * runtime re-locks/revalidates the successor and the plan finalizer is
 * idempotent. The outbox row is acknowledged only after both finish.
 */
export async function dispatchMissionGoalWakeIntent(id: string): Promise<boolean> {
  let lease: MissionGoalWakeDispatchLeaseClaim;
  try {
    lease = await db.transaction((tx) => claimMissionGoalWakeDispatchLease(tx, {
      intentId: id,
    }));
  } catch (error) {
    logger.warn(
      { intentId: id, failureCode: safeFailureCode(error) },
      "Mission Goal wake lease could not be acquired; durable intent remains pending",
    );
    return false;
  }
  if (!lease.acquired) return false;

  let intent: {
    id: string;
    type: string;
    projectId: string;
    goalId: string | null;
    payload: Record<string, unknown> | null;
  } | undefined;
  try {
    [intent] = await db.select({
      id: eventsTable.id,
      type: eventsTable.type,
      projectId: eventsTable.projectId,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
  } catch (error) {
    await deferWakeIntent(id, error, lease.token);
    logger.warn(
      { intentId: id, failureCode: safeFailureCode(error) },
      "Mission Goal wake intent could not be loaded; durable retry scheduled",
    );
    return false;
  }
  if (
    !intent
    || ![MISSION_GOAL_WAKE_REQUESTED, MISSION_GOAL_WAKE_DEFERRED].includes(intent.type)
  ) return false;

  try {
    const payload = parsePayload(intent.payload);
    if (!payload || !intent.goalId || intent.goalId !== payload.goalId) {
      await deferWakeIntent(id, new Error("INVALID_MISSION_GOAL_WAKE_PAYLOAD"), lease.token);
      return false;
    }

    const [goal] = await db.select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
      status: aiGoalsTable.status,
      completedAt: aiGoalsTable.completedAt,
    }).from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, payload.goalId),
        eq(aiGoalsTable.missionId, payload.missionId),
        eq(aiGoalsTable.projectId, intent.projectId),
      ))
      .limit(1);
    const [mission] = goal
      ? await db.select({ id: aiMissionsTable.id })
        .from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, payload.missionId),
          eq(aiMissionsTable.projectId, intent.projectId),
        ))
        .limit(1)
      : [];

    const expectedCompletedAt = Date.parse(payload.completedAt);
    if (
      !goal
      || !mission
      || goal.status !== "completed"
      || !goal.completedAt
      || goal.completedAt.getTime() !== expectedCompletedAt
    ) {
      await markWakeIntent(
        id,
        [MISSION_GOAL_WAKE_REQUESTED, MISSION_GOAL_WAKE_DEFERRED],
        MISSION_GOAL_WAKE_SUPERSEDED,
        {
          ...payload,
          supersededAt: new Date().toISOString(),
          reason: "goal_completion_generation_changed",
        },
        "Mission Goal wake intent was superseded by a later Goal state.",
        lease.token,
      );
      return false;
    }

    const wokenDependents = await wakeReadyMissionGoals(32, intent.projectId, payload.goalId);
    await finalizeMissionPlanOutcomesAfterGoalCompletion(payload.goalId);
    return await markWakeIntent(
      id,
      [MISSION_GOAL_WAKE_REQUESTED, MISSION_GOAL_WAKE_DEFERRED],
      MISSION_GOAL_WAKE_DISPATCHED,
      {
        ...payload,
        dispatchedAt: new Date().toISOString(),
        wokenDependents,
      },
      "Mission Goal wake intent was dispatched.",
      lease.token,
    );
  } catch (error) {
    await deferWakeIntent(id, error, lease.token);
    logger.warn(
      {
        intentId: id,
        projectId: intent.projectId,
        goalId: intent.goalId,
        failureCode: safeFailureCode(error),
      },
      "Mission Goal wake failed; durable intent retained for retry",
    );
    return false;
  }
}

export async function dispatchPendingMissionGoalWakes(
  limit = 100,
  scopeProjectId?: string,
): Promise<number> {
  const now = await readDatabaseNow();
  if (!now) return 0;
  const nowIso = now.toISOString();
  const rows = await db.select({
    id: eventsTable.id,
  }).from(eventsTable)
    .where(and(
      inArray(eventsTable.type, [
        MISSION_GOAL_WAKE_REQUESTED,
        MISSION_GOAL_WAKE_DEFERRED,
      ]),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
      or(
        eq(eventsTable.type, MISSION_GOAL_WAKE_REQUESTED),
        and(
          eq(eventsTable.type, MISSION_GOAL_WAKE_DEFERRED),
          sql`(
            ${eventsTable.payload}->>'nextAttemptAt' IS NULL
            OR ${eventsTable.payload}->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            OR ${eventsTable.payload}->>'nextAttemptAt' <= ${nowIso}
          )`,
        ),
      ),
      // Active leases stay out of poll batches; expired/malformed leases are
      // eligible for automatic recovery after process loss.
      sql`(
        ${eventsTable.payload}->'dispatchLease' IS NULL
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' IS NULL
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' <= ${nowIso}
      )`,
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(Math.max(1, Math.min(limit, 100)));

  let dispatched = 0;
  for (const row of rows) {
    if (await dispatchMissionGoalWakeIntent(row.id)) dispatched += 1;
  }
  return dispatched;
}
