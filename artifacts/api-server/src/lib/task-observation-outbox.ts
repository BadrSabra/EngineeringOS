import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import {
  db,
  taskExecutionObservationOutboxTable,
} from "@workspace/db";
import type { MaterializeServerOwnedObservationsInput } from "./agent-state/observation-materializer.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";

export const MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS = 12;
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
    const now = new Date();
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
              lt(taskExecutionObservationOutboxTable.leaseUntil, now),
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
        leaseUntil: new Date(now.getTime() + 5 * 60_000),
        updatedAt: now,
      })
      .where(eq(taskExecutionObservationOutboxTable.id, id))
      .returning({ id: taskExecutionObservationOutboxTable.id });
    return claimed ? { ...row, workerId } : null;
  });
}

async function runObservationOutboxRow(id: string): Promise<void> {
  const claimed = await claimObservationOutboxRow(id);
  if (!claimed) return;

  const payload = parseObservationInput(claimed.payload, claimed);
  if (!payload) {
    await recordObservationOutboxFailure(
      id,
      claimed.workerId,
      "INVALID_OBSERVATION_OUTBOX_PAYLOAD",
      true,
    );
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
  try {
    await materializeServerOwnedObservations(payload);
    await db.delete(taskExecutionObservationOutboxTable).where(and(
      eq(taskExecutionObservationOutboxTable.id, id),
      eq(taskExecutionObservationOutboxTable.status, "running"),
      eq(taskExecutionObservationOutboxTable.workerId, claimed.workerId),
    ));
  } catch (error) {
    const failureCode = safeFailureCode(error);
    const terminal = PERMANENT_FAILURE_CODES.has(failureCode);
    const deadLettered = await recordObservationOutboxFailure(
      id,
      claimed.workerId,
      failureCode,
      terminal,
    );
    const fields = {
      outboxId: id,
      executionId: claimed.executionId,
      attempt: claimed.attempt,
      code: failureCode,
      deadLettered,
    };
    if (deadLettered) {
      logger.error(fields, "Accepted task observations moved to dead letter");
    } else {
      logger.warn(fields, "Accepted task observations remain queued for bounded retry");
    }
  }
}

async function recordObservationOutboxFailure(
  id: string,
  workerId: string,
  failureCode: string,
  terminal: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      attemptCount: taskExecutionObservationOutboxTable.attemptCount,
    })
      .from(taskExecutionObservationOutboxTable)
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        eq(taskExecutionObservationOutboxTable.status, "running"),
        eq(taskExecutionObservationOutboxTable.workerId, workerId),
      ))
      .for("update")
      .limit(1);
    if (!row) return false;
    const now = new Date();
    const nextAttemptCount = row.attemptCount + 1;
    const deadLettered = terminal || nextAttemptCount >= MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS;
    await tx.update(taskExecutionObservationOutboxTable)
      .set({
        status: deadLettered ? DEAD_LETTER_STATUS : "pending",
        attemptCount: nextAttemptCount,
        nextAttemptAt: deadLettered
          ? now
          : new Date(now.getTime() + retryDelayMs(row.attemptCount)),
        workerId: null,
        leaseUntil: null,
        lastFailureCode: failureCode,
        updatedAt: now,
      })
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        eq(taskExecutionObservationOutboxTable.status, "running"),
        eq(taskExecutionObservationOutboxTable.workerId, workerId),
      ));
    return deadLettered;
  });
}

/**
 * Starts a new retry cycle after an operator has corrected the cause.
 * The row is never redriven while it is leased or still pending.
 */
export async function requeueDeadLetteredTaskObservationOutboxRow(id: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db.update(taskExecutionObservationOutboxTable)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      workerId: null,
      leaseUntil: null,
      lastFailureCode: null,
      updatedAt: now,
    })
    .where(and(
      eq(taskExecutionObservationOutboxTable.id, id),
      eq(taskExecutionObservationOutboxTable.status, DEAD_LETTER_STATUS),
    ))
    .returning({ id: taskExecutionObservationOutboxTable.id });
  return Boolean(row);
}

export async function dispatchPendingTaskObservationOutbox(limit = 100): Promise<number> {
  const now = new Date();
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
          lt(taskExecutionObservationOutboxTable.leaseUntil, now),
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

