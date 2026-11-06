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
  const candidate = error && typeof error === "object"
    ? (error as { code?: unknown; name?: unknown }).code
      ?? (error as { name?: unknown }).name
    : undefined;
  return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)
    ? candidate
    : "OBSERVATION_MATERIALIZATION_FAILED";
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
    await deferObservationOutboxRow(id, claimed.workerId, "INVALID_OBSERVATION_OUTBOX_PAYLOAD");
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
    await deferObservationOutboxRow(id, claimed.workerId, safeFailureCode(error));
    logger.warn(
      { executionId: claimed.executionId, attempt: claimed.attempt, code: safeFailureCode(error) },
      "Accepted task observations remain queued for retry",
    );
  }
}

async function deferObservationOutboxRow(
  id: string,
  workerId: string,
  failureCode: string,
): Promise<void> {
  await db.transaction(async (tx) => {
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
    if (!row) return;
    const now = new Date();
    await tx.update(taskExecutionObservationOutboxTable)
      .set({
        status: "pending",
        attemptCount: row.attemptCount + 1,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(row.attemptCount)),
        workerId: null,
        leaseUntil: null,
        lastFailureCode: failureCode,
        updatedAt: now,
      })
      .where(and(
        eq(taskExecutionObservationOutboxTable.id, id),
        eq(taskExecutionObservationOutboxTable.workerId, workerId),
      ));
  });
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

