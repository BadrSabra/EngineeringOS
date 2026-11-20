import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { aiGoalsTable, db, eventsTable } from "@workspace/db";
import type { MissionEventEnvelope } from "./mission-events.js";
import { logger } from "./logger.js";

export const MISSION_EVENT_WAKE_REQUESTED = "AiMissionEventWakeRequested";
export const MISSION_EVENT_WAKE_DEFERRED = "AiMissionEventWakeDeferred";
export const MISSION_EVENT_WAKE_DISPATCHED = "AiMissionEventWakeDispatched";
export const MISSION_EVENT_WAKE_DEAD_LETTER = "AiMissionEventWakeDeadLetter";
export const MISSION_EXTERNAL_EVENT_TYPE = "AiMissionExternalEventReceived";

export const MAX_MISSION_EVENT_WAKE_ATTEMPTS = 8;
export const MISSION_EVENT_WAKE_DISPATCH_LEASE_MS = 10 * 60_000;
const MIN_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const INBOX_REPLAY_BATCH_SIZE = 100;

type MissionEventWakeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionEventWakePayload = {
  schemaVersion: 1;
  source: "event_received" | "goal_entered_event_wait";
  goalId: string;
  eventId?: string;
  attemptCount: number;
  nextAttemptAt: string;
  requestedAt: string;
  lastFailureCode?: string;
  dispatchedAt?: string;
  wokenEvents?: number;
};

type WakeIntentRow = {
  id: string;
  type: string;
  projectId: string;
  goalId: string | null;
  payload: Record<string, unknown> | null;
};

export type MissionEventWakeDispatchLeaseClaim =
  | { acquired: true; token: string; expiresAt: string }
  | {
      acquired: false;
      reason: "intent_not_pending" | "retry_not_due" | "already_leased";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseWakePayload(value: unknown): MissionEventWakePayload | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || (value.source !== "event_received" && value.source !== "goal_entered_event_wait")
    || typeof value.goalId !== "string"
    || value.goalId.length === 0
  ) return null;
  const attemptCount = value.attemptCount ?? 0;
  if (!Number.isSafeInteger(attemptCount) || Number(attemptCount) < 0) return null;
  const nextAttemptAt = value.nextAttemptAt;
  const requestedAt = value.requestedAt;
  if (
    typeof nextAttemptAt !== "string"
    || !Number.isFinite(Date.parse(nextAttemptAt))
    || typeof requestedAt !== "string"
    || !Number.isFinite(Date.parse(requestedAt))
  ) return null;
  if (value.source === "event_received" && (
    typeof value.eventId !== "string" || value.eventId.length === 0
  )) return null;
  return {
    schemaVersion: 1,
    source: value.source,
    goalId: value.goalId,
    ...(typeof value.eventId === "string" ? { eventId: value.eventId } : {}),
    attemptCount: Number(attemptCount),
    nextAttemptAt,
    requestedAt,
    ...(typeof value.lastFailureCode === "string" ? { lastFailureCode: value.lastFailureCode } : {}),
  };
}

function parseInboxEnvelope(row: {
  id: string;
  projectId: string;
  goalId: string | null;
  payload: Record<string, unknown> | null;
}): MissionEventEnvelope | null {
  const payload = row.payload;
  if (!isRecord(payload) || typeof payload.processedAt === "string") return null;
  const value = payload.missionEvent;
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1
    || value.eventId !== row.id
    || value.projectId !== row.projectId
    || value.goalId !== row.goalId
    || typeof value.type !== "string"
    || value.type.length === 0
    || typeof value.projectId !== "string"
    || typeof value.goalId !== "string"
  ) return null;
  return value as MissionEventEnvelope;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(
    MAX_RETRY_DELAY_MS,
    MIN_RETRY_DELAY_MS * 2 ** Math.min(Math.max(attemptCount, 0), 4),
  );
}

function safeFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "MISSION_EVENT_WAKE_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "MISSION_EVENT_WAKE_FAILED";
}

async function databaseNow(
  executor?: MissionEventWakeTransaction,
): Promise<Date | null> {
  const result = executor
    ? await executor.execute(sql.raw("SELECT clock_timestamp() AS now"))
    : await db.execute(sql.raw("SELECT clock_timestamp() AS now"));
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const value = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(value.getTime()) ? value : null;
}

/**
 * Acquire exclusive ownership of one Mission event wake before inbox work.
 * The row lock serializes API replicas; expiry recovers ownership after process
 * loss. This lease is dispatch coordination, never execution authority.
 */
export async function claimMissionEventWakeDispatchLease(
  tx: MissionEventWakeTransaction,
  input: { intentId: string },
): Promise<MissionEventWakeDispatchLeaseClaim> {
  const [intent] = await tx.select({
    type: eventsTable.type,
    payload: eventsTable.payload,
  }).from(eventsTable)
    .where(eq(eventsTable.id, input.intentId))
    .for("update")
    .limit(1);

  if (
    !intent
    || ![MISSION_EVENT_WAKE_REQUESTED, MISSION_EVENT_WAKE_DEFERRED].includes(intent.type)
  ) {
    return { acquired: false, reason: "intent_not_pending" };
  }

  const now = await databaseNow(tx);
  if (!now) return { acquired: false, reason: "intent_not_pending" };

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
    now.getTime() + MISSION_EVENT_WAKE_DISPATCH_LEASE_MS,
  ).toISOString();
  await tx.update(eventsTable)
    .set({
      payload: {
        ...payload,
        dispatchLease: { token, expiresAt },
      },
    })
    .where(and(
      eq(eventsTable.id, input.intentId),
      inArray(eventsTable.type, [
        MISSION_EVENT_WAKE_REQUESTED,
        MISSION_EVENT_WAKE_DEFERRED,
      ]),
    ));

  return { acquired: true, token, expiresAt };
}

/**
 * Persist a targeted wake request in the same transaction as either the
 * external inbox insert or the Goal's transition into wait/event.
 *
 * The request is an outbox scheduling hint only. It grants no execution or
 * Canonical Proof authority.
 */
export async function insertMissionEventWakeIntent(
  tx: MissionEventWakeTransaction,
  input: {
    projectId: string;
    goalId: string;
    source: MissionEventWakePayload["source"];
    eventId?: string;
    generationAt?: Date;
  },
): Promise<string> {
  const now = input.generationAt ?? new Date();
  const id = input.eventId
    ? "mission-event-wake:" + createHash("sha256").update(input.eventId).digest("hex")
    : "mission-event-wait:" + createHash("sha256")
      .update(input.goalId + ":" + now.toISOString())
      .digest("hex");
  const payload: MissionEventWakePayload = {
    schemaVersion: 1,
    source: input.source,
    goalId: input.goalId,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    attemptCount: 0,
    nextAttemptAt: now.toISOString(),
    requestedAt: now.toISOString(),
  };
  await tx.insert(eventsTable).values({
    id,
    type: MISSION_EVENT_WAKE_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    ...(input.eventId ? { correlationId: input.eventId } : {}),
    severity: "info",
    message: input.source === "event_received"
      ? "A durable Mission event requested a targeted Goal wake."
      : "A Goal entering event wait requested a targeted inbox replay.",
    timestamp: now,
    payload,
  }).onConflictDoNothing();
  return id;
}

async function markIntent(
  id: string,
  expectedTypes: string[],
  type: string,
  payload: Record<string, unknown>,
  severity: "info" | "warning" | "error",
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

    const now = await databaseNow(tx);
    if (!now) return false;
    const currentPayload = isRecord(row.payload) ? row.payload : {};
    const currentLease = isRecord(currentPayload.dispatchLease)
      ? currentPayload.dispatchLease
      : undefined;
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    // An expired worker cannot acknowledge, even before a replacement claims it.
    if (
      currentLease?.token !== dispatchLeaseToken
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return false;

    const finalPayload = { ...payload };
    delete finalPayload.dispatchLease;
    const [updated] = await tx.update(eventsTable).set({
      type,
      payload: finalPayload,
      severity,
      message,
      timestamp: now,
    }).where(and(
      eq(eventsTable.id, id),
      inArray(eventsTable.type, expectedTypes),
    )).returning({ id: eventsTable.id });
    return Boolean(updated);
  });
}

async function deadLetterIntent(
  id: string,
  reason: string,
  dispatchLeaseToken: string,
): Promise<void> {
  await markIntent(
    id,
    [MISSION_EVENT_WAKE_REQUESTED, MISSION_EVENT_WAKE_DEFERRED],
    MISSION_EVENT_WAKE_DEAD_LETTER,
    {
      schemaVersion: 1,
      deadLetteredAt: new Date().toISOString(),
      lastFailureCode: reason,
    },
    "error",
    "Mission event wake request was rejected because its durable identity is invalid.",
    dispatchLeaseToken,
  );
}

async function deferIntent(
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
      || ![MISSION_EVENT_WAKE_REQUESTED, MISSION_EVENT_WAKE_DEFERRED].includes(row.type)
    ) return;

    const now = await databaseNow(tx);
    if (!now) throw new Error("MISSION_EVENT_WAKE_DATABASE_CLOCK_UNAVAILABLE");
    const currentPayload = isRecord(row.payload) ? row.payload : {};
    const currentLease = isRecord(currentPayload.dispatchLease)
      ? currentPayload.dispatchLease
      : undefined;
    const leaseExpiry = typeof currentLease?.expiresAt === "string"
      ? Date.parse(currentLease.expiresAt)
      : Number.NaN;
    // A late failure cannot defer another worker's intent.
    if (
      currentLease?.token !== dispatchLeaseToken
      || !Number.isFinite(leaseExpiry)
      || leaseExpiry <= now.getTime()
    ) return;

    const parsed = parseWakePayload(row.payload);
    if (!parsed) {
      await tx.update(eventsTable).set({
        type: MISSION_EVENT_WAKE_DEAD_LETTER,
        severity: "error",
        message: "Mission event wake request has an invalid durable payload.",
        payload: { schemaVersion: 1, deadLetteredAt: now.toISOString(), invalidPayload: true },
        timestamp: now,
      }).where(eq(eventsTable.id, id));
      return;
    }
    const attemptCount = parsed.attemptCount + 1;
    const deadLettered = attemptCount >= MAX_MISSION_EVENT_WAKE_ATTEMPTS;
    const payload: MissionEventWakePayload = {
      ...parsed,
      attemptCount,
      nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount - 1)).toISOString(),
      lastFailureCode: safeFailureCode(error),
    };
    await tx.update(eventsTable).set({
      type: deadLettered ? MISSION_EVENT_WAKE_DEAD_LETTER : MISSION_EVENT_WAKE_DEFERRED,
      severity: deadLettered ? "error" : "warning",
      message: deadLettered
        ? "Mission event wake request exhausted its bounded retry budget."
        : "Mission event wake request is deferred for bounded retry.",
      payload: {
        ...payload,
        ...(deadLettered ? { deadLetteredAt: now.toISOString() } : {}),
      },
      timestamp: now,
    }).where(eq(eventsTable.id, id));
  });
}

async function loadInboxRows(intent: WakeIntentRow, payload: MissionEventWakePayload) {
  if (payload.source === "event_received" && payload.eventId) {
    return db.select({
      id: eventsTable.id,
      projectId: eventsTable.projectId,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(and(
        eq(eventsTable.id, payload.eventId),
        eq(eventsTable.projectId, intent.projectId),
        eq(eventsTable.goalId, payload.goalId),
        eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      ))
      .limit(1);
  }
  return db.select({
    id: eventsTable.id,
    projectId: eventsTable.projectId,
    goalId: eventsTable.goalId,
    payload: eventsTable.payload,
  }).from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, intent.projectId),
      eq(eventsTable.goalId, payload.goalId),
      eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      sql.raw("payload->'missionEvent' IS NOT NULL"),
      sql.raw("payload->>'processedAt' IS NULL"),
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(INBOX_REPLAY_BATCH_SIZE);
}

async function processIntent(intent: WakeIntentRow, payload: MissionEventWakePayload): Promise<number> {
  const rows = await loadInboxRows(intent, payload);
  if (rows.length === 0) return 0;
  const { wakeMissionGoalsForEvent } = await import("./mission-runtime.js");
  let woken = 0;
  for (const row of rows) {
    const envelope = parseInboxEnvelope(row);
    if (!envelope) continue;
    // Goal, Mission, and inbox acknowledgement are committed together by the
    // wake transaction. A process crash cannot advance the Goal but lose the
    // event acknowledgement, or acknowledge an event before the Goal moves.
    woken += await wakeMissionGoalsForEvent(envelope, row.id);
  }
  return woken;
}

/**
 * Dispatch one durable, Goal-targeted wake request. A request that arrives
 * before its Goal is waiting is acknowledged as a no-op; the later wait
 * transition writes its own request and drains that Goal's pending inbox.
 */
export async function dispatchMissionEventWakeIntent(id: string): Promise<{
  dispatched: boolean;
  woken: number;
}> {
  let lease: MissionEventWakeDispatchLeaseClaim;
  try {
    lease = await db.transaction((tx) =>
      claimMissionEventWakeDispatchLease(tx, { intentId: id }),
    );
  } catch (error) {
    logger.warn(
      { intentId: id, failureCode: safeFailureCode(error) },
      "Mission event wake lease could not be acquired; durable intent remains pending.",
    );
    return { dispatched: false, woken: 0 };
  }
  if (!lease.acquired) return { dispatched: false, woken: 0 };

  let intent: WakeIntentRow | undefined;
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
    if (
      !intent
      || ![MISSION_EVENT_WAKE_REQUESTED, MISSION_EVENT_WAKE_DEFERRED].includes(intent.type)
    ) return { dispatched: false, woken: 0 };

    const payload = parseWakePayload(intent.payload);
    if (!payload || intent.goalId !== payload.goalId) {
      await deadLetterIntent(id, "INVALID_MISSION_EVENT_WAKE_IDENTITY", lease.token);
      return { dispatched: false, woken: 0 };
    }
    const woken = await processIntent(intent, payload);
    const dispatched = await markIntent(
      id,
      [MISSION_EVENT_WAKE_REQUESTED, MISSION_EVENT_WAKE_DEFERRED],
      MISSION_EVENT_WAKE_DISPATCHED,
      {
        ...payload,
        dispatchedAt: new Date().toISOString(),
        wokenEvents: woken,
      },
      "info",
      "Mission event wake request was dispatched.",
      lease.token,
    );
    return { dispatched, woken: dispatched ? woken : 0 };
  } catch (error) {
    try {
      await deferIntent(id, error, lease.token);
    } catch (deferError) {
      logger.error(
        { intentId: id, failureCode: safeFailureCode(deferError) },
        "Mission event wake retry state could not be persisted.",
      );
    }
    logger.warn(
      {
        intentId: id,
        projectId: intent?.projectId,
        goalId: intent?.goalId,
        failureCode: safeFailureCode(error),
      },
      "Mission event wake failed; durable request retained for retry.",
    );
    return { dispatched: false, woken: 0 };
  }
}

/**
 * Backfill requests for legacy Goals that were already waiting when the
 * outbox was introduced. This joins only active event-wait Goals that have
 * pending inbox rows; it does not scan the external-event journal globally.
 * The Goal generation makes concurrent/repeated backfills idempotent.
 */
async function backfillPendingMissionEventWaits(
  limit: number,
  scopeProjectId?: string,
): Promise<number> {
  const candidates = await db.selectDistinct({
    projectId: aiGoalsTable.projectId,
    goalId: aiGoalsTable.id,
    generationAt: aiGoalsTable.updatedAt,
  }).from(aiGoalsTable)
    .innerJoin(eventsTable, and(
      eq(eventsTable.projectId, aiGoalsTable.projectId),
      eq(eventsTable.goalId, aiGoalsTable.id),
      eq(eventsTable.type, MISSION_EXTERNAL_EVENT_TYPE),
      sql.raw("\"events\".\"payload\"->'missionEvent' IS NOT NULL"),
      sql.raw("\"events\".\"payload\"->>'processedAt' IS NULL"),
    ))
    .where(and(
      eq(aiGoalsTable.status, "waiting_for_event"),
      sql.raw("\"ai_goals\".\"next_action\"->>'kind' = 'wait'"),
      sql.raw("\"ai_goals\".\"next_action\"->>'reason' = 'event'"),
      // Backfill a legacy wait once. A durable wait-generation marker, even
      // if already dispatched, proves this Goal has crossed the new contract.
      sql.raw(`NOT EXISTS (
        SELECT 1
        FROM "events" AS "mission_event_wake_marker"
        WHERE "mission_event_wake_marker"."project_id" = "ai_goals"."project_id"
          AND "mission_event_wake_marker"."goal_id" = "ai_goals"."id"
          AND "mission_event_wake_marker"."type" IN (
            'AiMissionEventWakeRequested',
            'AiMissionEventWakeDeferred',
            'AiMissionEventWakeDispatched',
            'AiMissionEventWakeDeadLetter'
          )
          AND "mission_event_wake_marker"."payload"->>'source' = 'goal_entered_event_wait'
      )`),
      scopeProjectId ? eq(aiGoalsTable.projectId, scopeProjectId) : undefined,
    ))
    .orderBy(asc(aiGoalsTable.updatedAt), asc(aiGoalsTable.id))
    .limit(Math.max(1, Math.min(Math.floor(limit), 100)));

  let requested = 0;
  for (const candidate of candidates) {
    await db.transaction((tx) => insertMissionEventWakeIntent(tx, {
      projectId: candidate.projectId,
      goalId: candidate.goalId,
      source: "goal_entered_event_wait",
      generationAt: candidate.generationAt,
    }));
    requested += 1;
  }
  return requested;
}

/**
 * Bounded dispatcher for wake requests only. It never scans the external event
 * inbox globally; each request selects one event or one exact Goal inbox.
 */
export async function dispatchPendingMissionEventWakes(
  limit = 100,
  scopeProjectId?: string,
): Promise<number> {
  await backfillPendingMissionEventWaits(limit, scopeProjectId);
  const now = await databaseNow();
  if (!now) return 0;
  const rows = await db.select({ id: eventsTable.id }).from(eventsTable)
    .where(and(
      inArray(eventsTable.type, [
        MISSION_EVENT_WAKE_REQUESTED,
        MISSION_EVENT_WAKE_DEFERRED,
      ]),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
      or(
        eq(eventsTable.type, MISSION_EVENT_WAKE_REQUESTED),
        and(
          eq(eventsTable.type, MISSION_EVENT_WAKE_DEFERRED),
          sql`(${eventsTable.payload}->>'nextAttemptAt' IS NULL OR ${eventsTable.payload}->>'nextAttemptAt' <= ${now.toISOString()})`,
        ),
      ),
      // Active leases stay out of poll batches; expired/malformed leases are recoverable.
      sql`(
        ${eventsTable.payload}->'dispatchLease' IS NULL
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' IS NULL
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        OR ${eventsTable.payload}->'dispatchLease'->>'expiresAt' <= ${now.toISOString()}
      )`,
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(Math.max(1, Math.min(Math.floor(limit), 100)));
  let dispatched = 0;
  for (const row of rows) {
    if ((await dispatchMissionEventWakeIntent(row.id)).dispatched) dispatched += 1;
  }
  return dispatched;
}
