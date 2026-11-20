import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { runMissionGoal, type MissionGoalRunResult } from "./mission-runtime.js";
import { logger } from "./logger.js";

export const MISSION_GOAL_APPROVAL_REQUESTED = "MissionGoalApprovalDispatchRequested";
export const MISSION_GOAL_APPROVAL_DEFERRED = "MissionGoalApprovalDispatchDeferred";
export const MISSION_GOAL_APPROVAL_DISPATCHED = "MissionGoalApprovalDispatched";
export const MISSION_GOAL_APPROVAL_SUPERSEDED = "MissionGoalApprovalSuperseded";
export const MISSION_GOAL_APPROVAL_DEAD_LETTER = "MissionGoalApprovalDeadLetter";

export const MAX_MISSION_GOAL_APPROVAL_ATTEMPTS = 8;
export const MISSION_GOAL_APPROVAL_DISPATCH_LEASE_MS = 10 * 60_000;
const MIN_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

type ApprovalKind = "plan" | "proposal";
type MissionGoalApprovalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionGoalApprovalPayload = {
  schemaVersion: 1;
  missionId: string;
  projectId: string;
  goalId: string;
  userId: string;
  approvalEventId: string;
  approvalKind: ApprovalKind;
  planRevision?: string;
  stepId?: string;
  decisionTraceId?: string;
  executionId?: string;
  proposalId?: string;
  revision?: number;
  attemptCount: number;
  nextAttemptAt: string;
  dispatchLease?: { token: string; expiresAt: string };
};

export type MissionGoalApprovalDispatchResult = {
  dispatched: boolean;
  run?: MissionGoalRunResult;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parsePayload(value: unknown): MissionGoalApprovalPayload | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.missionId !== "string" || !value.missionId.trim()
    || typeof value.projectId !== "string" || !value.projectId.trim()
    || typeof value.goalId !== "string" || !value.goalId.trim()
    || typeof value.userId !== "string" || !value.userId.trim()
    || typeof value.approvalEventId !== "string" || !value.approvalEventId.trim()
    || (value.approvalKind !== "plan" && value.approvalKind !== "proposal")
  ) return null;

  const attemptCount = value.attemptCount ?? 0;
  if (!Number.isSafeInteger(attemptCount) || Number(attemptCount) < 0) return null;
  const nextAttemptAt = value.nextAttemptAt;
  if (nextAttemptAt !== undefined
    && (typeof nextAttemptAt !== "string" || !Number.isFinite(Date.parse(nextAttemptAt)))
  ) return null;

  if (value.approvalKind === "plan") {
    if (typeof value.planRevision !== "string" || !value.planRevision.trim()
      || typeof value.stepId !== "string" || !value.stepId.trim()
      || (value.decisionTraceId !== undefined
        && (typeof value.decisionTraceId !== "string" || !value.decisionTraceId.trim()))
    ) return null;
  } else if (
    typeof value.executionId !== "string" || !value.executionId.trim()
    || typeof value.proposalId !== "string" || !value.proposalId.trim()
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
  ) return null;

  return {
    schemaVersion: 1,
    missionId: value.missionId,
    projectId: value.projectId,
    goalId: value.goalId,
    userId: value.userId,
    approvalEventId: value.approvalEventId,
    approvalKind: value.approvalKind,
    ...(typeof value.planRevision === "string" ? { planRevision: value.planRevision } : {}),
    ...(typeof value.stepId === "string" ? { stepId: value.stepId } : {}),
    ...(typeof value.decisionTraceId === "string" ? { decisionTraceId: value.decisionTraceId } : {}),
    ...(typeof value.executionId === "string" ? { executionId: value.executionId } : {}),
    ...(typeof value.proposalId === "string" ? { proposalId: value.proposalId } : {}),
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
    attemptCount: Number(attemptCount),
    nextAttemptAt: typeof nextAttemptAt === "string" ? nextAttemptAt : new Date(0).toISOString(),
  };
}

/**
 * Persist the run request in the approval transaction. It records intent only;
 * all execution authority remains in runMissionGoal and its existing gates.
 */
export async function insertMissionGoalApprovalIntent(
  tx: MissionGoalApprovalTransaction,
  input: {
    missionId: string;
    projectId: string;
    goalId: string;
    userId: string;
    approvalEventId: string;
    approvalKind: ApprovalKind;
    requestedAt: Date;
    planRevision?: string;
    stepId?: string;
    decisionTraceId?: string;
    executionId?: string;
    proposalId?: string;
    revision?: number;
  },
): Promise<string> {
  const id = "mission-goal-approval:" + input.approvalEventId;
  const payload: MissionGoalApprovalPayload = {
    schemaVersion: 1,
    missionId: input.missionId,
    projectId: input.projectId,
    goalId: input.goalId,
    userId: input.userId,
    approvalEventId: input.approvalEventId,
    approvalKind: input.approvalKind,
    ...(input.planRevision ? { planRevision: input.planRevision } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.decisionTraceId ? { decisionTraceId: input.decisionTraceId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
    attemptCount: 0,
    nextAttemptAt: input.requestedAt.toISOString(),
  };

  await tx.insert(eventsTable).values({
    id,
    type: MISSION_GOAL_APPROVAL_REQUESTED,
    projectId: input.projectId,
    goalId: input.goalId,
    severity: "info",
    message: "An approved Mission Goal requested runtime dispatch.",
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
  if (!error || typeof error !== "object") return "MISSION_GOAL_APPROVAL_DISPATCH_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)
    ? code
    : "MISSION_GOAL_APPROVAL_DISPATCH_FAILED";
}

async function readNow(tx?: MissionGoalApprovalTransaction): Promise<Date | null> {
  const result = tx
    ? await tx.execute(sql.raw("SELECT clock_timestamp() AS now"))
    : await db.execute(sql.raw("SELECT clock_timestamp() AS now"));
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  return raw && Number.isFinite(now.getTime()) ? now : null;
}

async function claimDispatchLease(intentId: string): Promise<{ token: string } | null> {
  return db.transaction(async (tx) => {
    const [intent] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    if (!intent || ![
      MISSION_GOAL_APPROVAL_REQUESTED,
      MISSION_GOAL_APPROVAL_DEFERRED,
    ].includes(intent.type)) return null;

    const now = await readNow(tx);
    if (!now) return null;
    const payload = record(intent.payload);
    const retryAt = typeof payload.nextAttemptAt === "string"
      ? Date.parse(payload.nextAttemptAt)
      : Number.NaN;
    if (intent.type === MISSION_GOAL_APPROVAL_DEFERRED
      && Number.isFinite(retryAt) && retryAt > now.getTime()
    ) return null;

    const lease = record(payload.dispatchLease);
    const leaseExpiry = typeof lease.expiresAt === "string"
      ? Date.parse(lease.expiresAt)
      : Number.NaN;
    if (Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) return null;

    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + MISSION_GOAL_APPROVAL_DISPATCH_LEASE_MS).toISOString();
    await tx.update(eventsTable)
      .set({ payload: { ...payload, dispatchLease: { token, expiresAt } } })
      .where(eq(eventsTable.id, intentId));
    return { token };
  });
}

async function settleIntent(
  intentId: string,
  token: string,
  type: string,
  details: Record<string, unknown> = {},
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    if (!row || ![
      MISSION_GOAL_APPROVAL_REQUESTED,
      MISSION_GOAL_APPROVAL_DEFERRED,
    ].includes(row.type)) return false;

    const payload = record(row.payload);
    const lease = record(payload.dispatchLease);
    const now = await readNow(tx);
    const expiry = typeof lease.expiresAt === "string" ? Date.parse(lease.expiresAt) : Number.NaN;
    if (!now || lease.token !== token || !Number.isFinite(expiry) || expiry <= now.getTime()) {
      return false;
    }

    const nextPayload: Record<string, unknown> = {
      ...payload,
      ...details,
      processedAt: now.toISOString(),
    };
    delete nextPayload.dispatchLease;
    await tx.update(eventsTable)
      .set({
        type,
        severity: type === MISSION_GOAL_APPROVAL_DEAD_LETTER ? "error" : "info",
        message: type === MISSION_GOAL_APPROVAL_DISPATCHED
          ? "Approved Mission Goal dispatch was completed."
          : type === MISSION_GOAL_APPROVAL_SUPERSEDED
            ? "Approved Mission Goal dispatch was superseded by a newer state."
            : "Approved Mission Goal dispatch was dead-lettered.",
        payload: nextPayload,
        timestamp: now,
      })
      .where(eq(eventsTable.id, intentId));
    return true;
  });
}

async function deferIntent(intentId: string, token: string, error: unknown): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .for("update")
      .limit(1);
    if (!row || ![
      MISSION_GOAL_APPROVAL_REQUESTED,
      MISSION_GOAL_APPROVAL_DEFERRED,
    ].includes(row.type)) return false;

    const payload = record(row.payload);
    const lease = record(payload.dispatchLease);
    const now = await readNow(tx);
    const expiry = typeof lease.expiresAt === "string" ? Date.parse(lease.expiresAt) : Number.NaN;
    if (!now || lease.token !== token || !Number.isFinite(expiry) || expiry <= now.getTime()) {
      return false;
    }

    const parsed = parsePayload(payload);
    if (!parsed) {
      await tx.update(eventsTable).set({
        type: MISSION_GOAL_APPROVAL_DEAD_LETTER,
        severity: "error",
        message: "Mission Goal approval Outbox payload is invalid.",
        payload: { invalidPayload: true, deadLetteredAt: now.toISOString() },
        timestamp: now,
      }).where(eq(eventsTable.id, intentId));
      return true;
    }

    const attemptCount = parsed.attemptCount + 1;
    const deadLettered = attemptCount >= MAX_MISSION_GOAL_APPROVAL_ATTEMPTS;
    const nextPayload: Record<string, unknown> = {
      ...parsed,
      attemptCount,
      lastFailureCode: safeFailureCode(error),
      ...(deadLettered
        ? { deadLetteredAt: now.toISOString() }
        : { nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount - 1)).toISOString() }),
    };
    await tx.update(eventsTable).set({
      type: deadLettered ? MISSION_GOAL_APPROVAL_DEAD_LETTER : MISSION_GOAL_APPROVAL_DEFERRED,
      severity: deadLettered ? "error" : "warning",
      message: deadLettered
        ? "Mission Goal approval Outbox intent exhausted its bounded retry budget."
        : "Mission Goal approval Outbox intent is deferred for bounded retry.",
      payload: nextPayload,
      timestamp: now,
    }).where(eq(eventsTable.id, intentId));
    return true;
  });
}

async function approvalStillCurrent(payload: MissionGoalApprovalPayload): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Match the authoritative Mission -> Goal lock order used by approval and
    // completion writers before checking the event's exact binding.
    const [mission] = await tx.select().from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, payload.missionId),
        eq(aiMissionsTable.projectId, payload.projectId),
        eq(aiMissionsTable.userId, payload.userId),
      ))
      .for("update")
      .limit(1);
    if (!mission || !["active", "waiting"].includes(mission.status)) return false;

    const [goal] = await tx.select().from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, payload.goalId),
        eq(aiGoalsTable.missionId, payload.missionId),
        eq(aiGoalsTable.projectId, payload.projectId),
      ))
      .for("update")
      .limit(1);
    if (!goal || goal.status !== "queued") return false;

    const [approvalEvent] = await tx.select({
      id: eventsTable.id,
      type: eventsTable.type,
      projectId: eventsTable.projectId,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, payload.approvalEventId))
      .limit(1);
    if (!approvalEvent
      || approvalEvent.type !== "AiGoalApprovalGranted"
      || approvalEvent.projectId !== payload.projectId
      || approvalEvent.goalId !== payload.goalId
    ) return false;

    const eventPayload = record(approvalEvent.payload);
    if (eventPayload.missionId !== payload.missionId) return false;

    if (payload.approvalKind === "plan") {
      const successCriteria = record(goal.successCriteria);
      const outcome = record(goal.outcomeContract);
      const plan = record(outcome.planRevision);
      const successPlan = record(successCriteria.planRevision);
      const planSteps = Array.isArray(plan.steps) ? plan.steps.map(record) : [];
      const planStep = planSteps.find((step) => step.id === payload.stepId);
      const approval = record(outcome.planApproval);
      const policy = record(mission.autonomyPolicy);
      const action = record(goal.nextAction);
      return eventPayload.approvalKind === "mission_plan_step"
        && eventPayload.planRevision === payload.planRevision
        && eventPayload.stepId === payload.stepId
        && successCriteria.stepId === payload.stepId
        && (successCriteria.kind === "mission_plan_step" || successCriteria.kind === "mission_replan_step")
        && plan.hash === payload.planRevision
        && successPlan.hash === payload.planRevision
        && planStep?.kind === "execute"
        && planStep.approvalRequired === true
        && planStep.readOnly === false
        && !planStep.recipe
        && Array.isArray(planStep.files)
        && planStep.files.length > 0
        && policy.activePlanRevision === payload.planRevision
        && outcome.stepId === payload.stepId
        && approval.kind === "mission_plan_step"
        && approval.state === "APPROVED"
        && approval.approvalEventId === payload.approvalEventId
        && approval.planRevision === payload.planRevision
        && approval.stepId === payload.stepId
        && action.kind === "task";
    }

    if (eventPayload.approvalKind !== "proposal"
      || eventPayload.executionId !== payload.executionId
      || eventPayload.proposalId !== payload.proposalId
      || eventPayload.revision !== payload.revision
    ) return false;

    const [execution] = await tx.select({
      id: aiExecutionsTable.id,
      proposalId: aiExecutionsTable.proposalId,
      status: aiExecutionsTable.status,
    }).from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, payload.executionId ?? ""),
        eq(aiExecutionsTable.goalId, payload.goalId),
        eq(aiExecutionsTable.projectId, payload.projectId),
        eq(aiExecutionsTable.userId, payload.userId),
      ))
      .limit(1);
    if (!execution
      || execution.proposalId !== payload.proposalId
      || !["queued", "running", "paused", "failed"].includes(execution.status)
    ) return false;

    const [proposal] = await tx.select({
      id: aiChangeProposalsTable.id,
      status: aiChangeProposalsTable.status,
      revision: aiChangeProposalsTable.revision,
      approvalRequired: aiChangeProposalsTable.approvalRequired,
    }).from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, payload.proposalId ?? ""),
        eq(aiChangeProposalsTable.projectId, payload.projectId),
      ))
      .limit(1);
    return Boolean(proposal
      && proposal.status === "pending"
      && proposal.approvalRequired === false
      && proposal.revision === payload.revision);
  });
}

/** Dispatch one approved Goal, fenced by a durable cross-replica lease. */
export async function dispatchMissionGoalApprovalIntent(
  intentId: string,
): Promise<MissionGoalApprovalDispatchResult> {
  let lease: { token: string } | null;
  try {
    lease = await claimDispatchLease(intentId);
  } catch (error) {
    logger.warn(
      { intentId, failureCode: safeFailureCode(error) },
      "Mission Goal approval Outbox lease could not be acquired.",
    );
    return { dispatched: false, reason: "lease_claim_failed" };
  }
  if (!lease) return { dispatched: false, reason: "not_claimed" };

  let intent: { type: string; payload: Record<string, unknown> | null } | undefined;
  try {
    [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
  } catch (error) {
    await deferIntent(intentId, lease.token, error);
    return { dispatched: false, reason: "intent_read_failed" };
  }
  if (!intent || ![
    MISSION_GOAL_APPROVAL_REQUESTED,
    MISSION_GOAL_APPROVAL_DEFERRED,
  ].includes(intent.type)) return { dispatched: false, reason: "intent_not_pending" };

  const payload = parsePayload(intent.payload);
  if (!payload) {
    await settleIntent(intentId, lease.token, MISSION_GOAL_APPROVAL_DEAD_LETTER, {
      invalidPayload: true,
    });
    return { dispatched: false, reason: "invalid_payload" };
  }

  try {
    if (!await approvalStillCurrent(payload)) {
      await settleIntent(intentId, lease.token, MISSION_GOAL_APPROVAL_SUPERSEDED, {
        reason: "approval_or_goal_state_changed",
      });
      return { dispatched: false, reason: "superseded" };
    }

    const run = await runMissionGoal({
      goalId: payload.goalId,
      userId: payload.userId,
      trigger: "resume",
    });
    if (run.status === "conflict") {
      await settleIntent(intentId, lease.token, MISSION_GOAL_APPROVAL_SUPERSEDED, {
        reason: run.reason ?? "mission_goal_runtime_conflict",
      });
      return { dispatched: false, run, reason: "runtime_conflict" };
    }

    const acknowledged = await settleIntent(
      intentId,
      lease.token,
      MISSION_GOAL_APPROVAL_DISPATCHED,
      { dispatchStatus: run.status },
    );
    return {
      dispatched: acknowledged,
      run,
      ...(acknowledged ? {} : { reason: "lease_lost_after_dispatch" }),
    };
  } catch (error) {
    await deferIntent(intentId, lease.token, error);
    logger.warn(
      {
        intentId,
        missionId: payload.missionId,
        goalId: payload.goalId,
        failureCode: safeFailureCode(error),
      },
      "Approved Mission Goal dispatch failed; durable retry scheduled.",
    );
    return { dispatched: false, reason: "approval_dispatch_deferred" };
  }
}

/** Bounded global or project-scoped poll for committed approval intents. */
export async function dispatchPendingMissionGoalApprovals(
  limit = 100,
  scopeProjectId?: string,
): Promise<number> {
  const now = await readNow();
  if (!now) return 0;
  const nowIso = now.toISOString();
  const dueRetry = sql.raw(
    "(events.payload->>'nextAttemptAt' IS NULL OR events.payload->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' OR events.payload->>'nextAttemptAt' <= '" + nowIso + "')",
  );
  const expiredLease = sql.raw(
    "(events.payload->'dispatchLease' IS NULL OR events.payload->'dispatchLease'->>'expiresAt' IS NULL OR events.payload->'dispatchLease'->>'expiresAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' OR events.payload->'dispatchLease'->>'expiresAt' <= '" + nowIso + "')",
  );

  const rows = await db.select({ id: eventsTable.id }).from(eventsTable)
    .where(and(
      inArray(eventsTable.type, [
        MISSION_GOAL_APPROVAL_REQUESTED,
        MISSION_GOAL_APPROVAL_DEFERRED,
      ]),
      scopeProjectId ? eq(eventsTable.projectId, scopeProjectId) : undefined,
      dueRetry,
      expiredLease,
    ))
    .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
    .limit(Math.max(1, Math.min(Math.floor(limit), 100)));

  let dispatched = 0;
  for (const row of rows) {
    if ((await dispatchMissionGoalApprovalIntent(row.id)).dispatched) dispatched += 1;
  }
  return dispatched;
}
