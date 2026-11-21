import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

export const MISSION_REPLAN_REQUESTED = "MissionReplanRequested";
export const MISSION_REPLAN_DEFERRED = "MissionReplanDeferred";
export const MISSION_REPLAN_DISPATCHED = "MissionReplanDispatched";
export const MISSION_REPLAN_SUPERSEDED = "MissionReplanSuperseded";
export const MISSION_REPLAN_DEAD_LETTER = "MissionReplanDeadLetter";

export const MAX_MISSION_REPLAN_ATTEMPTS = 8;
export const MISSION_REPLAN_DISPATCH_LEASE_MS = 10 * 60_000;
const MIN_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type MissionReplanOutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionReplanPayloadBase = {
  schemaVersion: 1;
  missionId: string;
  projectId: string;
  goalId: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastFailureCode?: string;
};

type MissionReplanPayload = MissionReplanPayloadBase & (
  | {
      source: "execution_acceptance";
      executionId: string;
      attempt: number;
      acceptanceId: string;
    }
  | {
      source: "goal_admission";
      admissionKey: string;
      reasonCode: "dependency_proof_unproven" | "dependency_failed";
      sourcePlanRevision: string | null;
    }
);

export type MissionReplanDispatchLeaseClaim =
  | { acquired: true; token: string; expiresAt: string }
  | { acquired: false; reason: "intent_not_pending" | "retry_not_due" | "already_leased" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function missionReplanIntentId(acceptanceId: string): string {
  return "mission-replan:" + acceptanceId;
}

function parsePayload(value: unknown): MissionReplanPayload | null {
  if (!isRecord(value)) return null;
  const requiredStrings = ["missionId", "projectId", "goalId"] as const;
  if (
    value.schemaVersion !== 1
    || requiredStrings.some((key) =>
      typeof value[key] !== "string" || (value[key] as string).trim().length === 0,
    )
    || typeof value.attemptCount !== "number"
    || !Number.isSafeInteger(value.attemptCount)
    || value.attemptCount < 0
    || typeof value.nextAttemptAt !== "string"
    || !Number.isFinite(Date.parse(value.nextAttemptAt))
  ) return null;

  const base: MissionReplanPayloadBase = {
    schemaVersion: 1,
    missionId: value.missionId as string,
    projectId: value.projectId as string,
    goalId: value.goalId as string,
    attemptCount: value.attemptCount,
    nextAttemptAt: value.nextAttemptAt,
    ...(typeof value.lastFailureCode === "string"
      ? { lastFailureCode: value.lastFailureCode }
      : {}),
  };
  const source = value.source ?? "execution_acceptance";
  if (source === "goal_admission") {
    if (
      typeof value.admissionKey !== "string"
      || value.admissionKey.trim().length === 0
      || (value.reasonCode !== "dependency_proof_unproven" && value.reasonCode !== "dependency_failed")
      || !(value.sourcePlanRevision === null || typeof value.sourcePlanRevision === "string")
    ) return null;
    return {
      ...base,
      source,
      admissionKey: value.admissionKey,
      reasonCode: value.reasonCode,
      sourcePlanRevision: value.sourcePlanRevision,
    };
  }
  if (
    source !== "execution_acceptance"
    || typeof value.executionId !== "string"
    || value.executionId.trim().length === 0
    || typeof value.acceptanceId !== "string"
    || value.acceptanceId.trim().length === 0
    || typeof value.attempt !== "number"
    || !Number.isSafeInteger(value.attempt)
    || value.attempt < 0
  ) return null;
  return {
    ...base,
    source: "execution_acceptance",
    executionId: value.executionId,
    attempt: value.attempt,
    acceptanceId: value.acceptanceId,
  };
}

/**
 * Persist the request in the same transaction that records the retryable
 * Task acceptance and its authoritative Mission/Goal needs_replan projection.
 * The event is a wake-up hint only; autoReplanMission rechecks every gate.
 */
export async function insertMissionReplanIntent(
  tx: MissionReplanOutboxTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    executionId: string;
    attempt: number;
    acceptanceId: string;
    requestedAt: Date;
  },
): Promise<string> {
  if (
    !input.missionId.trim()
    || !input.projectId.trim()
    || !input.goalId.trim()
    || !input.executionId.trim()
    || !input.acceptanceId.trim()
    || !Number.isSafeInteger(input.attempt)
    || input.attempt < 0
  ) {
    throw new Error("mission_replan_outbox_identity_invalid");
  }

  const id = missionReplanIntentId(input.acceptanceId);
  const payload: MissionReplanPayload = {
    schemaVersion: 1,
    missionId: input.missionId,
    projectId: input.projectId,
    goalId: input.goalId,
    source: "execution_acceptance",
    executionId: input.executionId,
    attempt: input.attempt,
    acceptanceId: input.acceptanceId,
    attemptCount: 0,
    nextAttemptAt: input.requestedAt.toISOString(),
  };
  await tx.insert(eventsTable).values({
    id,
    type: MISSION_REPLAN_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    correlationId: input.executionId,
    severity: "warning",
    message: "A retryable Task failure requested an automatic Mission replan.",
    timestamp: input.requestedAt,
    payload,
  }).onConflictDoNothing();
  return id;
}

/**
 * Persist a replan wake for an admission failure that has no execution
 * acceptance yet. The stable key is bound to the Goal, reason, and plan
 * revision so repeated preflight/claim checks collapse into one intent while a
 * genuinely newer plan receives a new wake.
 */
export function missionReplanAdmissionIntentId(input: {
  missionId: string;
  projectId: string;
  goalId: string;
  reasonCode: "dependency_proof_unproven" | "dependency_failed";
  planRevision: string | null;
}): string {
  const identityHash = createHash("sha256").update(JSON.stringify([
    input.missionId,
    input.projectId,
    input.goalId,
    input.reasonCode,
    input.planRevision,
  ])).digest("hex");
  return `mission-replan:admission:${identityHash}`;
}

export async function insertMissionAdmissionReplanIntent(
  tx: MissionReplanOutboxTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    reasonCode: "dependency_proof_unproven" | "dependency_failed";
    planRevision: string | null;
    requestedAt: Date;
  },
): Promise<string> {
  if (
    !input.missionId.trim()
    || !input.projectId.trim()
    || !input.goalId.trim()
    || (input.planRevision !== null && !input.planRevision.trim())
  ) {
    throw new Error("mission_replan_admission_identity_invalid");
  }

  const id = missionReplanAdmissionIntentId(input);
  const payload: MissionReplanPayload = {
    schemaVersion: 1,
    missionId: input.missionId,
    projectId: input.projectId,
    goalId: input.goalId,
    source: "goal_admission",
    admissionKey: id,
    reasonCode: input.reasonCode,
    sourcePlanRevision: input.planRevision,
    attemptCount: 0,
    nextAttemptAt: input.requestedAt.toISOString(),
  };
  await tx.insert(eventsTable).values({
    id,
    type: MISSION_REPLAN_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    severity: "warning",
    message: "A Mission Goal dependency admission failure requested an automatic replan.",
    timestamp: input.requestedAt,
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
  if (!error || typeof error !== "object") return "MISSION_REPLAN_DISPATCH_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "MISSION_REPLAN_DISPATCH_FAILED";
}

async function readDatabaseNow(): Promise<Date | null> {
  const result = await db.execute(sql.raw("SELECT clock_timestamp() AS now"));
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const value = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(value.getTime()) ? value : null;
}

/**
 * Claim one Outbox row under a database row lock. The persisted lease makes
 * recovery safe across API replicas and after a process exits mid-dispatch.
 */
export async function claimMissionReplanDispatchLease(
  tx: MissionReplanOutboxTransaction,
  input: { intentId: string },
): Promise<MissionReplanDispatchLeaseClaim> {
  const [intent] = await tx.select({
    type: eventsTable.type,
    payload: eventsTable.payload,
  }).from(eventsTable)
    .where(eq(eventsTable.id, input.intentId))
    .for("update")
    .limit(1);

  if (
    !intent
    || ![MISSION_REPLAN_REQUESTED, MISSION_REPLAN_DEFERRED].includes(intent.type)
  ) {
    return { acquired: false, reason: "intent_not_pending" };
  }

  const clockResult = await tx.execute(sql.raw("SELECT clock_timestamp() AS now"));
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
  const expiresAt = new Date(now.getTime() + MISSION_REPLAN_DISPATCH_LEASE_MS).toISOString();
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

async function markMissionReplanIntent(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  message: string,
  dispatchLeaseToken: string,
  details: Record<string, unknown> = {},
): Promise<boolean> {
  const now = await readDatabaseNow() ?? new Date();
  const nextPayload: Record<string, unknown> = {
    ...payload,
    ...details,
    processedAt: now.toISOString(),
  };
  delete nextPayload.dispatchLease;
  const severity = type === MISSION_REPLAN_DEAD_LETTER
    ? "error"
    : type === MISSION_REPLAN_SUPERSEDED
      ? "info"
      : "success";
  const [updated] = await db.update(eventsTable)
    .set({
      type,
      severity,
      message,
      payload: nextPayload,
      timestamp: now,
    })
    .where(and(
      eq(eventsTable.id, id),
      inArray(eventsTable.type, [MISSION_REPLAN_REQUESTED, MISSION_REPLAN_DEFERRED]),
      sql`${eventsTable.payload}->'dispatchLease'->>'token' = ${dispatchLeaseToken}`,
      sql`(${eventsTable.payload}->'dispatchLease'->>'expiresAt')::timestamptz > clock_timestamp()`,
    ))
    .returning({ id: eventsTable.id });
  return Boolean(updated);
}

async function deferMissionReplanIntent(
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
    if (
      !row
      || ![MISSION_REPLAN_REQUESTED, MISSION_REPLAN_DEFERRED].includes(row.type)
    ) return;

    const currentPayload = isRecord(row.payload) ? row.payload : undefined;
    const currentLease = currentPayload && isRecord(currentPayload.dispatchLease)
      ? currentPayload.dispatchLease
      : undefined;
    if (currentLease?.token !== dispatchLeaseToken) return;

    const clockResult = await tx.execute(sql`SELECT clock_timestamp() AS now`);
    const rawNow = (clockResult.rows as Array<{ now: Date | string }>)[0]?.now;
    const now = rawNow instanceof Date ? rawNow : new Date(String(rawNow ?? ""));
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    if (
      !rawNow
      || !Number.isFinite(now.getTime())
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return;

    const parsed = parsePayload(row.payload);
    if (!parsed) {
      await tx.update(eventsTable)
        .set({
          type: MISSION_REPLAN_DEAD_LETTER,
          severity: "error",
          message: "Mission replan Outbox intent has an invalid durable payload.",
          payload: { invalidPayload: true, deadLetteredAt: now.toISOString() },
          timestamp: now,
        })
        .where(and(
        eq(eventsTable.id, id),
        sql`${eventsTable.payload}->'dispatchLease'->>'token' = ${dispatchLeaseToken}`,
        sql`(${eventsTable.payload}->'dispatchLease'->>'expiresAt')::timestamptz > clock_timestamp()`,
      ));
      return;
    }

    const attemptCount = parsed.attemptCount + 1;
    const exhausted = attemptCount >= MAX_MISSION_REPLAN_ATTEMPTS;
    const nextPayload: Record<string, unknown> = {
      ...parsed,
      attemptCount,
      lastFailureCode: safeFailureCode(error),
      ...(exhausted
        ? { deadLetteredAt: now.toISOString() }
        : {
            nextAttemptAt: new Date(
              now.getTime() + retryDelayMs(attemptCount - 1),
            ).toISOString(),
          }),
    };
    await tx.update(eventsTable)
      .set({
        type: exhausted ? MISSION_REPLAN_DEAD_LETTER : MISSION_REPLAN_DEFERRED,
        severity: exhausted ? "error" : "warning",
        message: exhausted
          ? "Mission replan Outbox intent exhausted its bounded retry budget."
          : "Mission replan Outbox intent is deferred for bounded retry.",
        payload: nextPayload,
        timestamp: now,
      })
      .where(eq(eventsTable.id, id));
  });
}

/**
 * Dispatches one durable Mission replan request. Its trigger is a wake-up hint,
 * not execution authority: the Mission and Goal must still be in needs_replan,
 * and the existing coordinator rechecks autonomy, evidence, diagnosis, and budget.
 */
export async function dispatchMissionReplanIntent(id: string): Promise<boolean> {
  let lease: MissionReplanDispatchLeaseClaim;
  try {
    lease = await db.transaction((tx) =>
      claimMissionReplanDispatchLease(tx, { intentId: id }),
    );
  } catch (error) {
    logger.warn(
      { intentId: id, failureCode: safeFailureCode(error) },
      "Mission replan Outbox lease could not be acquired; durable intent remains pending.",
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
    try {
      await deferMissionReplanIntent(id, error, lease.token);
    } catch (deferError) {
      logger.warn({ intentId: id, error: deferError }, "Mission replan Outbox defer failed.");
    }
    return false;
  }

  if (
    !intent
    || ![MISSION_REPLAN_REQUESTED, MISSION_REPLAN_DEFERRED].includes(intent.type)
  ) return false;

  const rawPayload = isRecord(intent.payload) ? intent.payload : {};
  const payload = parsePayload(intent.payload);
  if (!payload) {
    await markMissionReplanIntent(
      id,
      MISSION_REPLAN_DEAD_LETTER,
      rawPayload,
      "Mission replan Outbox intent has an invalid durable payload.",
      lease.token,
      { invalidPayload: true, deadLetteredAt: new Date().toISOString() },
    );
    return false;
  }

  try {
    if (
      !intent.goalId
      || intent.goalId !== payload.goalId
      || intent.projectId !== payload.projectId
    ) {
      await markMissionReplanIntent(
        id,
        MISSION_REPLAN_SUPERSEDED,
        rawPayload,
        "Mission replan Outbox intent no longer matches its stored scope.",
        lease.token,
        { reason: "mission_replan_scope_mismatch" },
      );
      return false;
    }

    const [goal] = await db.select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      projectId: aiGoalsTable.projectId,
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
      outcomeContract: aiGoalsTable.outcomeContract,
      successCriteria: aiGoalsTable.successCriteria,
    }).from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, payload.goalId),
        eq(aiGoalsTable.missionId, payload.missionId),
        eq(aiGoalsTable.projectId, payload.projectId),
      ))
      .limit(1);
    const [mission] = await db.select({
      id: aiMissionsTable.id,
      status: aiMissionsTable.status,
      autonomyPolicy: aiMissionsTable.autonomyPolicy,
    }).from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, payload.missionId),
        eq(aiMissionsTable.projectId, payload.projectId),
      ))
      .limit(1);

    const goalOutcome = goal && isRecord(goal.outcomeContract) ? goal.outcomeContract : {};
    const goalCriteria = goal && isRecord(goal.successCriteria) ? goal.successCriteria : {};
    const effectivePlanRevision = goalOutcome.planRevision ?? goalCriteria.planRevision;
    const goalPlan = isRecord(effectivePlanRevision) ? effectivePlanRevision : {};
    const currentPlanRevision = typeof goalPlan.hash === "string" && goalPlan.hash.trim()
      ? goalPlan.hash.trim()
      : null;
    const autonomyPolicy = mission && isRecord(mission.autonomyPolicy) ? mission.autonomyPolicy : {};
    const activePlanRevision = typeof autonomyPolicy.activePlanRevision === "string"
      ? autonomyPolicy.activePlanRevision
      : null;
    const admissionIntentStale = payload.source === "goal_admission" && (
      goal?.blockedReason !== payload.reasonCode
      || currentPlanRevision !== payload.sourcePlanRevision
      || (activePlanRevision !== null && activePlanRevision !== payload.sourcePlanRevision)
    );

    if (
      !goal
      || !mission
      || goal.status !== "needs_replan"
      || mission.status !== "needs_replan"
      || admissionIntentStale
    ) {
      await markMissionReplanIntent(
        id,
        MISSION_REPLAN_SUPERSEDED,
        rawPayload,
        "Mission replan request was superseded by a newer Mission or Goal state.",
        lease.token,
        { reason: "mission_or_goal_state_changed" },
      );
      return false;
    }

    const { autoReplanMission } = await import("./mission-auto-replan.js");
    const result = await autoReplanMission(payload.missionId);
    if (result.status === "replanned") {
      return await markMissionReplanIntent(
        id,
        MISSION_REPLAN_DISPATCHED,
        rawPayload,
        "Mission replan Outbox intent was dispatched.",
        lease.token,
        {
          dispatchOutcome: "replanned",
          planRevision: result.revision,
          dispatchedAt: new Date().toISOString(),
        },
      );
    }

    await markMissionReplanIntent(
      id,
      MISSION_REPLAN_SUPERSEDED,
      rawPayload,
      "Mission replan coordinator no longer accepts this request.",
      lease.token,
      { reason: result.reason },
    );
    return false;
  } catch (error) {
    try {
      await deferMissionReplanIntent(id, error, lease.token);
    } catch (deferError) {
      logger.warn(
        { intentId: id, failureCode: safeFailureCode(deferError) },
        "Mission replan Outbox retry could not be persisted.",
      );
    }
    logger.warn(
      { intentId: id, missionId: payload.missionId, failureCode: safeFailureCode(error) },
      "Mission replan failed; durable Outbox retry scheduled.",
    );
    return false;
  }
}

/**
 * Bounded worker poll for committed Mission replan requests. Row leases keep
 * replicas from dispatching the same planner operation at the same time.
 */
export async function dispatchPendingMissionReplans(
  limit = 100,
  scopeProjectId?: string,
): Promise<number> {
  const now = await readDatabaseNow();
  if (!now) return 0;
  const nowIso = now.toISOString();
  const dueRetry = sql`(
    ${eventsTable.payload}->>'nextAttemptAt' IS NULL
    OR ${eventsTable.payload}->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    OR ${eventsTable.payload}->>'nextAttemptAt' <= ${nowIso}
  )`;
  const expiredLease = sql`(
    ${eventsTable.payload}->'dispatchLease' IS NULL
    OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' IS NULL
    OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' <= ${nowIso}
  )`;

  const rows = await db.select({
    id: eventsTable.id,
  }).from(eventsTable)
    .where(and(
      inArray(eventsTable.type, [MISSION_REPLAN_REQUESTED, MISSION_REPLAN_DEFERRED]),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
      or(
        eq(eventsTable.type, MISSION_REPLAN_REQUESTED),
        and(
          eq(eventsTable.type, MISSION_REPLAN_DEFERRED),
          dueRetry,
        ),
      ),
      expiredLease,
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(Math.max(1, Math.min(Math.floor(limit), 100)));

  let dispatched = 0;
  for (const row of rows) {
    if (await dispatchMissionReplanIntent(row.id)) dispatched += 1;
  }
  return dispatched;
}
