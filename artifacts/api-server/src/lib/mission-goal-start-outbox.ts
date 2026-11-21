import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { GoalNextActionSchema } from "@workspace/ai-orchestrator";
import {
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import { runMissionGoal } from "./mission-runtime.js";

export const MISSION_GOAL_START_REQUESTED = "MissionGoalStartRequested";
export const MISSION_GOAL_START_DEFERRED = "MissionGoalStartDeferred";
export const MISSION_GOAL_START_DISPATCHED = "MissionGoalStartDispatched";
export const MISSION_GOAL_START_SUPERSEDED = "MissionGoalStartSuperseded";
export const MISSION_GOAL_START_DEAD_LETTER = "MissionGoalStartDeadLetter";

export const MAX_MISSION_GOAL_START_ATTEMPTS = 8;
export const MISSION_GOAL_START_DISPATCH_LEASE_MS = 10 * 60_000;
const MIN_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type MissionGoalStartOutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionGoalStartPayload = {
  schemaVersion: 1;
  missionId: string;
  goalId: string;
  planRevision: string;
  createdAt: string;
  attemptCount: number;
  nextAttemptAt: string;
  dispatchedAt?: string;
  lastFailureCode?: string;
  runStatus?: "scheduled" | "waiting" | "blocked" | "completed";
};

type DispatchLease = { token: string; expiresAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function missionGoalStartIntentId(goalId: string): string {
  return `mission-goal-start:${goalId}`;
}

function parsePayload(value: unknown): MissionGoalStartPayload | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || typeof value.missionId !== "string" || !value.missionId.trim()
    || typeof value.goalId !== "string" || !value.goalId.trim()
    || typeof value.planRevision !== "string" || !value.planRevision.trim()
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
  ) return null;
  const attemptCount = value.attemptCount ?? 0;
  if (!Number.isSafeInteger(attemptCount) || Number(attemptCount) < 0) return null;
  const nextAttemptAt = value.nextAttemptAt;
  if (nextAttemptAt !== undefined && (
    typeof nextAttemptAt !== "string" || !Number.isFinite(Date.parse(nextAttemptAt))
  )) return null;
  return {
    schemaVersion: 1,
    missionId: value.missionId,
    goalId: value.goalId,
    planRevision: value.planRevision,
    createdAt: value.createdAt,
    attemptCount: Number(attemptCount),
    nextAttemptAt: typeof nextAttemptAt === "string" ? nextAttemptAt : new Date(0).toISOString(),
    ...(typeof value.dispatchedAt === "string" ? { dispatchedAt: value.dispatchedAt } : {}),
    ...(typeof value.lastFailureCode === "string" ? { lastFailureCode: value.lastFailureCode } : {}),
    ...(value.runStatus === "scheduled" || value.runStatus === "waiting"
      || value.runStatus === "blocked" || value.runStatus === "completed"
      ? { runStatus: value.runStatus }
      : {}),
  };
}

/**
 * Persist manual current-plan Goal admission in the same transaction as the
 * Goal row. The intent grants no authority: the normal Mission runtime
 * revalidates plan state and still owns Task/Recipe execution.
 */
export async function insertMissionGoalStartIntent(
  tx: MissionGoalStartOutboxTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    planRevision: string;
    createdAt: Date;
  },
): Promise<string> {
  const id = missionGoalStartIntentId(input.goalId);
  const payload: MissionGoalStartPayload = {
    schemaVersion: 1,
    missionId: input.missionId,
    goalId: input.goalId,
    planRevision: input.planRevision,
    createdAt: input.createdAt.toISOString(),
    attemptCount: 0,
    nextAttemptAt: input.createdAt.toISOString(),
  };
  await tx.insert(eventsTable).values({
    id,
    type: MISSION_GOAL_START_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    severity: "info",
    message: "A current-plan manual Mission Goal requested automatic start.",
    timestamp: input.createdAt,
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
  if (!error || typeof error !== "object") return "MISSION_GOAL_START_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "MISSION_GOAL_START_FAILED";
}

async function readDatabaseNow(): Promise<Date | null> {
  const result = await db.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(now.getTime()) ? now : null;
}

async function readTransactionNow(tx: MissionGoalStartOutboxTransaction): Promise<Date | null> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(now.getTime()) ? now : null;
}

async function claimDispatchLease(
  tx: MissionGoalStartOutboxTransaction,
  intentId: string,
): Promise<DispatchLease | null> {
  const [intent] = await tx.select({
    type: eventsTable.type,
    payload: eventsTable.payload,
  }).from(eventsTable)
    .where(eq(eventsTable.id, intentId))
    .for("update")
    .limit(1);
  if (
    !intent
    || ![MISSION_GOAL_START_REQUESTED, MISSION_GOAL_START_DEFERRED].includes(intent.type)
  ) return null;

  const now = await readTransactionNow(tx);
  if (!now) return null;
  const payload = isRecord(intent.payload) ? intent.payload : {};
  const retryAt = typeof payload.nextAttemptAt === "string"
    ? Date.parse(payload.nextAttemptAt)
    : Number.NaN;
  if (intent.type === MISSION_GOAL_START_DEFERRED && Number.isFinite(retryAt) && retryAt > now.getTime()) {
    return null;
  }
  const currentLease = isRecord(payload.dispatchLease) ? payload.dispatchLease : undefined;
  const leaseExpiry = typeof currentLease?.expiresAt === "string"
    ? Date.parse(currentLease.expiresAt)
    : Number.NaN;
  if (Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) return null;

  const lease: DispatchLease = {
    token: randomUUID(),
    expiresAt: new Date(now.getTime() + MISSION_GOAL_START_DISPATCH_LEASE_MS).toISOString(),
  };
  await tx.update(eventsTable)
    .set({ payload: { ...payload, dispatchLease: lease } })
    .where(eq(eventsTable.id, intentId));
  return lease;
}

async function settlePendingIntent(
  intentId: string,
  token: string,
  terminalType: string,
  payload: Record<string, unknown>,
  message: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    if (
      !row
      || ![MISSION_GOAL_START_REQUESTED, MISSION_GOAL_START_DEFERRED].includes(row.type)
    ) return false;
    const currentPayload = isRecord(row.payload) ? row.payload : {};
    const currentLease = isRecord(currentPayload.dispatchLease) ? currentPayload.dispatchLease : undefined;
    const now = await readTransactionNow(tx);
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    if (
      !now
      || currentLease?.token !== token
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return false;
    const nextPayload = { ...payload };
    delete nextPayload.dispatchLease;
    const [updated] = await tx.update(eventsTable)
      .set({
        type: terminalType,
        payload: nextPayload,
        message,
        timestamp: now,
      })
      .where(and(
        eq(eventsTable.id, intentId),
        inArray(eventsTable.type, [MISSION_GOAL_START_REQUESTED, MISSION_GOAL_START_DEFERRED]),
        sql`${eventsTable.payload}->'dispatchLease'->>'token' = ${token}`,
      ))
      .returning({ id: eventsTable.id });
    return Boolean(updated);
  });
}

async function deferPendingIntent(
  intentId: string,
  token: string,
  error: unknown,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    if (
      !row
      || ![MISSION_GOAL_START_REQUESTED, MISSION_GOAL_START_DEFERRED].includes(row.type)
    ) return false;
    const current = isRecord(row.payload) ? row.payload : {};
    const lease = isRecord(current.dispatchLease) ? current.dispatchLease : undefined;
    const now = await readTransactionNow(tx);
    const expiresAt = typeof lease?.expiresAt === "string" ? Date.parse(lease.expiresAt) : Number.NaN;
    if (!now || lease?.token !== token || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
      return false;
    }
    const parsed = parsePayload(row.payload);
    if (!parsed) {
      const [updated] = await tx.update(eventsTable)
        .set({
          type: MISSION_GOAL_START_DEAD_LETTER,
          severity: "error",
          message: "Mission Goal start intent has an invalid durable payload.",
          payload: { invalidPayload: true, deadLetteredAt: now.toISOString() },
          timestamp: now,
        })
        .where(eq(eventsTable.id, intentId))
        .returning({ id: eventsTable.id });
      return Boolean(updated);
    }
    const attemptCount = parsed.attemptCount + 1;
    const deadLettered = attemptCount >= MAX_MISSION_GOAL_START_ATTEMPTS;
    const nextPayload = {
      ...parsed,
      attemptCount,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount - 1)).toISOString(),
      lastFailureCode: safeFailureCode(error),
      ...(deadLettered ? { deadLetteredAt: now.toISOString() } : {}),
    };
    const [updated] = await tx.update(eventsTable)
      .set({
        type: deadLettered ? MISSION_GOAL_START_DEAD_LETTER : MISSION_GOAL_START_DEFERRED,
        severity: deadLettered ? "error" : "warning",
        message: deadLettered
          ? "Mission Goal start intent exhausted its bounded retry budget."
          : "Mission Goal start intent is deferred for bounded retry.",
        payload: nextPayload,
        timestamp: now,
      })
      .where(eq(eventsTable.id, intentId))
      .returning({ id: eventsTable.id });
    return Boolean(updated);
  });
}

function planRevision(value: unknown): string | undefined {
  const contract = record(value);
  const revision = record(contract.planRevision);
  return typeof revision.hash === "string" && revision.hash.trim()
    ? revision.hash
    : undefined;
}

/**
 * Dispatch one start request through the existing Mission Goal runtime. The
 * Goal/Mission locks and active-plan checks are repeated by runMissionGoal;
 * this Outbox only owns recoverable scheduling, never execution authority.
 */
export async function dispatchMissionGoalStartIntent(intentId: string): Promise<boolean> {
  let lease: DispatchLease | null;
  try {
    lease = await db.transaction((tx) => claimDispatchLease(tx, intentId));
  } catch (error) {
    logger.warn(
      { intentId, failureCode: safeFailureCode(error) },
      "Mission Goal start lease could not be acquired; intent remains pending",
    );
    return false;
  }
  if (!lease) return false;

  try {
    const [intent] = await db.select({
      id: eventsTable.id,
      type: eventsTable.type,
      projectId: eventsTable.projectId,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    if (
      !intent
      || ![MISSION_GOAL_START_REQUESTED, MISSION_GOAL_START_DEFERRED].includes(intent.type)
    ) return false;

    const payload = parsePayload(intent.payload);
    if (!payload || intent.goalId !== payload.goalId) {
      await settlePendingIntent(
        intentId,
        lease.token,
        MISSION_GOAL_START_DEAD_LETTER,
        { invalidPayload: true, deadLetteredAt: new Date().toISOString() },
        "Mission Goal start intent has an invalid or mismatched durable payload.",
      );
      return false;
    }

    const eligibility = await db.transaction(async (tx) => {
      // Match the Mission-before-Goal lock order used by the Goal runtime.
      const [mission] = await tx.select({
        id: aiMissionsTable.id,
        projectId: aiMissionsTable.projectId,
        userId: aiMissionsTable.userId,
        status: aiMissionsTable.status,
        autonomyPolicy: aiMissionsTable.autonomyPolicy,
      }).from(aiMissionsTable)
        .where(and(
          eq(aiMissionsTable.id, payload.missionId),
          eq(aiMissionsTable.projectId, intent.projectId),
        ))
        .for("update")
        .limit(1);
      if (!mission) return { eligible: false as const, reason: "mission_missing" };
      const [goal] = await tx.select({
        id: aiGoalsTable.id,
        missionId: aiGoalsTable.missionId,
        projectId: aiGoalsTable.projectId,
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
        nextAction: aiGoalsTable.nextAction,
        createdAt: aiGoalsTable.createdAt,
      }).from(aiGoalsTable)
        .where(and(
          eq(aiGoalsTable.id, payload.goalId),
          eq(aiGoalsTable.missionId, payload.missionId),
          eq(aiGoalsTable.projectId, intent.projectId),
        ))
        .for("update")
        .limit(1);
      if (!goal) return { eligible: false as const, reason: "goal_missing" };

      const policy = record(mission.autonomyPolicy);
      const activeRevision = typeof policy.activePlanRevision === "string"
        ? policy.activePlanRevision
        : undefined;
      const rootKind = record(goal.successCriteria).kind;
      const dependencies = await tx.select({ id: aiGoalDependenciesTable.id })
        .from(aiGoalDependenciesTable)
        .where(and(
          eq(aiGoalDependenciesTable.goalId, goal.id),
          eq(aiGoalDependenciesTable.missionId, mission.id),
          eq(aiGoalDependenciesTable.projectId, mission.projectId),
        ))
        .limit(1);
      const action = GoalNextActionSchema.safeParse(goal.nextAction);
      const eligible = (
        ["active", "waiting"].includes(mission.status)
        && activeRevision === payload.planRevision
        && goal.status === "queued"
        && goal.blockedReason === null
        && rootKind === "mission_manual_step"
        && planRevision(goal.outcomeContract) === payload.planRevision
        && goal.createdAt.getTime() === Date.parse(payload.createdAt)
        && dependencies.length === 0
        && action.success
        && action.data.kind !== "task"
      );
      return eligible
        ? { eligible: true as const, userId: mission.userId }
        : { eligible: false as const, reason: "goal_or_plan_superseded" };
    });

    if (!eligibility.eligible) {
      await settlePendingIntent(
        intentId,
        lease.token,
        MISSION_GOAL_START_SUPERSEDED,
        { ...payload, supersededAt: new Date().toISOString(), reason: eligibility.reason },
        "Mission Goal start intent was superseded by a changed Goal or active plan.",
      );
      return false;
    }

    const result = await runMissionGoal({
      goalId: payload.goalId,
      userId: eligibility.userId,
      trigger: "activation",
    });
    if (result.goalId !== payload.goalId || result.status === "conflict") {
      await settlePendingIntent(
        intentId,
        lease.token,
        MISSION_GOAL_START_SUPERSEDED,
        {
          ...payload,
          supersededAt: new Date().toISOString(),
          reason: result.reason ?? "mission_runtime_conflict",
        },
        "Mission Goal start intent was superseded by a runtime identity conflict.",
      );
      return false;
    }
    return await settlePendingIntent(
      intentId,
      lease.token,
      MISSION_GOAL_START_DISPATCHED,
      {
        ...payload,
        dispatchedAt: new Date().toISOString(),
        runStatus: result.status,
      },
      "Mission Goal start intent was dispatched through the existing runtime.",
    );
  } catch (error) {
    await deferPendingIntent(intentId, lease.token, error);
    logger.warn(
      { intentId, failureCode: safeFailureCode(error) },
      "Mission Goal start failed; durable Outbox intent retained for retry",
    );
    return false;
  }
}

export async function dispatchPendingMissionGoalStarts(
  limit = 100,
  scopeProjectId?: string,
): Promise<number> {
  const now = await readDatabaseNow();
  if (!now) return 0;
  const nowIso = now.toISOString();
  const rows = await db.select({ id: eventsTable.id }).from(eventsTable)
    .where(and(
      inArray(eventsTable.type, [
        MISSION_GOAL_START_REQUESTED,
        MISSION_GOAL_START_DEFERRED,
      ]),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
      or(
        eq(eventsTable.type, MISSION_GOAL_START_REQUESTED),
        and(
          eq(eventsTable.type, MISSION_GOAL_START_DEFERRED),
          sql`(
            ${eventsTable.payload}->>'nextAttemptAt' IS NULL
            OR ${eventsTable.payload}->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            OR ${eventsTable.payload}->>'nextAttemptAt' <= ${nowIso}
          )`,
        ),
      ),
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
    if (await dispatchMissionGoalStartIntent(row.id)) dispatched += 1;
  }
  return dispatched;
}
