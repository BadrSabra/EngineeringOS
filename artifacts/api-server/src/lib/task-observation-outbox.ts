import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  taskExecutionObservationOutboxTable,
} from "@workspace/db";
import type { MaterializeServerOwnedObservationsInput } from "./agent-state/observation-materializer.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { heavyJobQueue } from "./job-queue.js";
import { databaseLeaseUntil, databaseNow } from "./job-lease.js";
import { logger } from "./logger.js";

export const MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS = 12;
const TASK_OBSERVATION_OUTBOX_LEASE_MS = 5 * 60_000;
const TASK_OBSERVATION_OUTBOX_HEARTBEAT_MS = Math.max(
  1_000,
  Math.floor(TASK_OBSERVATION_OUTBOX_LEASE_MS / 3),
);
const DEAD_LETTER_STATUS = "dead_letter";
const PERMANENT_FAILURE_CODES = new Set([
  "INVALID_OBSERVATION_OUTBOX_PAYLOAD",
  "observation_materialization_child_attestation_episode_mismatch",
  "observation_materialization_child_attestation_mismatch",
  "observation_materialization_conflict_identity_missing",
  "observation_materialization_execution_not_found",
  "observation_materialization_episode_identity_changed",
  "observation_materialization_invalid_identity",
  "observation_materialization_invalid_source_count",
  "observation_materialization_project_mismatch",
  "observation_materialization_validator_attestation_mismatch",
  "observation_materialization_validator_process_tree_attestation_mismatch",
  "observation_source_invalid_timestamp",
]);
const KNOWN_FAILURE_CODES = new Set([
  ...PERMANENT_FAILURE_CODES,
  "observation_materialization_episode_not_found",
  "observation_materialization_stale_worker",
]);

export type TaskAcceptanceObservationInput =
  MaterializeServerOwnedObservationsInput;

function parseObservationInput(
  payload: Record<string, unknown>,
  row: { projectId: string; executionId: string; attempt: number },
): TaskAcceptanceObservationInput | null {
  if (
    payload.projectId !== row.projectId
    || payload.executionId !== row.executionId
    || payload.attempt !== row.attempt
    || !Array.isArray(payload.sources)
    || payload.sources.length === 0
    || payload.sources.length > 32
  ) return null;
  return payload as unknown as TaskAcceptanceObservationInput;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.min(Math.max(attemptCount, 0), 5));
}

function safeFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "OBSERVATION_MATERIALIZATION_FAILED";
  const value = error as { code?: unknown; message?: unknown };
  if (typeof value.code === "string" && /^\d{5}$/.test(value.code)) return value.code;
  if (typeof value.message === "string" && KNOWN_FAILURE_CODES.has(value.message)) {
    return value.message;
  }
  return "OBSERVATION_MATERIALIZATION_FAILED";
}

async function claimObservationOutboxRow(id: string): Promise<{
  workerId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  payload: Record<string, unknown>;
} | null> {
  return db.transaction(async (tx) => {
    const now = databaseNow();
    const [row] = await tx.select({
      id: taskExecutionObservationOutboxTable.id,
      projectId: taskExecutionObservationOutboxTable.projectId,
      executionId: taskExecutionObservationOutboxTable.executionId,
      attempt: taskExecutionObservationOutboxTable.attempt,
      payload: taskExecutionObservationOutboxTable.payload,
    })
      .from(taskExecutionObservationOutboxTable)
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        or(
          and(
            eq(taskExecutionObservationOutboxTable.status, "pending"),
            lte(taskExecutionObservationOutboxTable.nextAttemptAt, now),
          ),
          and(
            eq(taskExecutionObservationOutboxTable.status, "running"),
            or(
              isNull(taskExecutionObservationOutboxTable.leaseUntil),
              lte(taskExecutionObservationOutboxTable.leaseUntil, now),
            ),
          ),
        ),
      ))
      .for("update")
      .limit(1);
    if (!row) return null;

    const workerId = `task-observation:${randomUUID()}`;
    const [claimed] = await tx.update(taskExecutionObservationOutboxTable)
      .set({
        status: "running",
        workerId,
        leaseUntil: databaseLeaseUntil(TASK_OBSERVATION_OUTBOX_LEASE_MS),
        updatedAt: now,
      })
      .where(eq(taskExecutionObservationOutboxTable.id, id))
      .returning({ id: taskExecutionObservationOutboxTable.id });
    return claimed ? { ...row, workerId } : null;
  });
}

async function renewObservationOutboxLease(id: string, workerId: string): Promise<boolean> {
  const [renewed] = await db.update(taskExecutionObservationOutboxTable)
    .set({
      leaseUntil: databaseLeaseUntil(TASK_OBSERVATION_OUTBOX_LEASE_MS),
      updatedAt: databaseNow(),
    })
    .where(and(
      eq(taskExecutionObservationOutboxTable.id, id),
      eq(taskExecutionObservationOutboxTable.status, "running"),
      eq(taskExecutionObservationOutboxTable.workerId, workerId),
      gt(taskExecutionObservationOutboxTable.leaseUntil, databaseNow()),
    ))
    .returning({ id: taskExecutionObservationOutboxTable.id });
  return Boolean(renewed);
}

async function runObservationOutboxRow(id: string): Promise<void> {
  const claimed = await claimObservationOutboxRow(id);
  if (!claimed) return;

  const payload = parseObservationInput(claimed.payload, claimed);
  if (!payload) {
    const failure = await recordObservationOutboxFailure(
      id,
      claimed.workerId,
      "INVALID_OBSERVATION_OUTBOX_PAYLOAD",
      true,
    );
    if (!failure.recorded) return;
    logger.error(
      {
        outboxId: id,
        executionId: claimed.executionId,
        attempt: claimed.attempt,
        code: "INVALID_OBSERVATION_OUTBOX_PAYLOAD",
      },
      "Accepted task observation intent moved to dead letter",
    );
    return;
  }
  let leaseLost = false;
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (leaseLost || heartbeatInFlight) return;
    heartbeatInFlight = true;
    void renewObservationOutboxLease(id, claimed.workerId)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch((error: unknown) => {
        logger.warn(
          { outboxId: id, executionId: claimed.executionId, attempt: claimed.attempt, error },
          "Task observation outbox lease renewal failed",
        );
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, TASK_OBSERVATION_OUTBOX_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    await materializeServerOwnedObservations(payload);
    if (leaseLost) return;
    await db.delete(taskExecutionObservationOutboxTable).where(and(
      eq(taskExecutionObservationOutboxTable.id, id),
      eq(taskExecutionObservationOutboxTable.status, "running"),
      eq(taskExecutionObservationOutboxTable.workerId, claimed.workerId),
      gt(taskExecutionObservationOutboxTable.leaseUntil, databaseNow()),
    ));
  } catch (error) {
    if (leaseLost) return;
    const failureCode = safeFailureCode(error);
    const terminal = PERMANENT_FAILURE_CODES.has(failureCode);
    const failure = await recordObservationOutboxFailure(
      id,
      claimed.workerId,
      failureCode,
      terminal,
    );
    if (!failure.recorded) return;
    const fields = {
      outboxId: id,
      executionId: claimed.executionId,
      attempt: claimed.attempt,
      code: failureCode,
      deadLettered: failure.deadLettered,
    };
    if (failure.deadLettered) {
      logger.error(fields, "Accepted task observations moved to dead letter");
    } else {
      logger.warn(fields, "Accepted task observations remain queued for bounded retry");
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function recordObservationOutboxFailure(
  id: string,
  workerId: string,
  failureCode: string,
  terminal: boolean,
): Promise<{ recorded: boolean; deadLettered: boolean }> {
  return db.transaction(async (tx) => {
    const now = databaseNow();
    const [row] = await tx.select({
      attemptCount: taskExecutionObservationOutboxTable.attemptCount,
    })
      .from(taskExecutionObservationOutboxTable)
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        eq(taskExecutionObservationOutboxTable.status, "running"),
        eq(taskExecutionObservationOutboxTable.workerId, workerId),
        gt(taskExecutionObservationOutboxTable.leaseUntil, now),
      ))
      .for("update")
      .limit(1);
    if (!row) return { recorded: false, deadLettered: false };
    const nextAttemptCount = row.attemptCount + 1;
    const deadLettered = terminal || nextAttemptCount >= MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS;
    const [updated] = await tx.update(taskExecutionObservationOutboxTable)
      .set({
        status: deadLettered ? DEAD_LETTER_STATUS : "pending",
        attemptCount: nextAttemptCount,
        nextAttemptAt: deadLettered
          ? now
          : sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC')
              + (${retryDelayMs(row.attemptCount)} * interval '1 millisecond')`,
        workerId: null,
        leaseUntil: null,
        lastFailureCode: failureCode,
        updatedAt: now,
      })
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        eq(taskExecutionObservationOutboxTable.status, "running"),
        eq(taskExecutionObservationOutboxTable.workerId, workerId),
        gt(taskExecutionObservationOutboxTable.leaseUntil, now),
      ))
      .returning({ id: taskExecutionObservationOutboxTable.id });
    return {
      recorded: Boolean(updated),
      deadLettered: Boolean(updated) && deadLettered,
    };
  });
}

/**
 * Starts a new retry cycle after an operator has corrected the cause.
 * The row is never redriven while it is leased or still pending.
 */
export async function requeueDeadLetteredTaskObservationOutboxRow(id: string): Promise<boolean> {
  const [row] = await db.update(taskExecutionObservationOutboxTable)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: databaseNow(),
      workerId: null,
      leaseUntil: null,
      lastFailureCode: null,
      updatedAt: databaseNow(),
    })
    .where(and(
      eq(taskExecutionObservationOutboxTable.id, id),
      eq(taskExecutionObservationOutboxTable.status, DEAD_LETTER_STATUS),
    ))
    .returning({ id: taskExecutionObservationOutboxTable.id });
  return Boolean(row);
}

export async function dispatchPendingTaskObservationOutbox(limit = 100): Promise<number> {
  const now = databaseNow();
  const rows = await db.select({ id: taskExecutionObservationOutboxTable.id })
    .from(taskExecutionObservationOutboxTable)
    .where(or(
      and(
        eq(taskExecutionObservationOutboxTable.status, "pending"),
        lte(taskExecutionObservationOutboxTable.nextAttemptAt, now),
      ),
      and(
        eq(taskExecutionObservationOutboxTable.status, "running"),
        or(
          isNull(taskExecutionObservationOutboxTable.leaseUntil),
          lte(taskExecutionObservationOutboxTable.leaseUntil, now),
        ),
      ),
    ))
    .orderBy(
      asc(taskExecutionObservationOutboxTable.nextAttemptAt),
      asc(taskExecutionObservationOutboxTable.createdAt),
    )
    .limit(limit);

  let dispatched = 0;
  for (const row of rows) {
    const result = heavyJobQueue.enqueueWithIdDetailed(
      `task-observation-outbox:${row.id}`,
      () => runObservationOutboxRow(row.id),
    );
    if (result === "full") break;
    if (result === "enqueued") dispatched += 1;
  }
  return dispatched;
}

