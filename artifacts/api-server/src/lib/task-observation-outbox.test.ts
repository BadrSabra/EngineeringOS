import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  db,
  projectsTable,
  taskExecutionObservationOutboxTable,
} from "@workspace/db";
import { heavyJobQueue } from "./job-queue.js";
import {
  dispatchPendingTaskObservationOutbox,
  MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS,
  requeueDeadLetteredTaskObservationOutboxRow,
} from "./task-observation-outbox.js";
import { materializeServerOwnedObservations } from "./agent-state/observation-materializer.js";

vi.mock("./agent-state/observation-materializer.js", () => ({
  materializeServerOwnedObservations: vi.fn(),
}));

const projectIds: string[] = [];

async function createOutboxRow() {
  const projectId = `task-observation-outbox-${randomUUID()}`;
  const executionId = randomUUID();
  const outboxId = randomUUID();
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "task-observation-outbox-test",
    name: "Task observation outbox test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    userId: "task-observation-outbox-test",
    idempotencyKey: executionId,
    resumeTokenHash: "a".repeat(64),
    request: "{}",
    checkpoint: "{}",
    status: "completed",
  });
  await db.insert(taskExecutionObservationOutboxTable).values({
    id: outboxId,
    projectId,
    executionId,
    attempt: 1,
    nextAttemptAt: new Date(0),
    createdAt: new Date(0),
    payload: {
      projectId,
      executionId,
      attempt: 1,
      sources: [{ kind: "acceptance" }],
    },
  });

  return { projectId, executionId, outboxId };
}

afterEach(async () => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("task observation outbox attempt budget", () => {
  it("counts abandoned leases as attempts and dead-letters after the bounded crash budget", async () => {
    const { outboxId } = await createOutboxRow();
    const queued: Array<{ id: string; run: () => Promise<void> }> = [];
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithIdDetailed")
      .mockImplementation((id, run) => {
        queued.push({ id, run });
        return "enqueued";
      });
    const materializer = vi.mocked(materializeServerOwnedObservations);

    for (let attempt = 1; attempt <= MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS; attempt++) {
      let signalStarted!: () => void;
      let releaseMaterializer!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      materializer.mockImplementationOnce(async () => {
        signalStarted();
        await new Promise<void>((resolve) => {
          releaseMaterializer = resolve;
        });
        return {
          episodeId: "task-observation-outbox-test-episode",
          observationIds: [],
          inserted: 0,
          duplicates: 0,
          stale: 0,
          environmentStale: 0,
        };
      });

      expect(await dispatchPendingTaskObservationOutbox(1)).toBe(1);
      const job = queued.shift();
      expect(job?.id).toBe(`task-observation-outbox:${outboxId}`);
      if (!job) throw new Error("Expected the outbox worker to be queued");

      const running = job.run();
      await started;
      const [claimed] = await db.select({
        status: taskExecutionObservationOutboxTable.status,
        attemptCount: taskExecutionObservationOutboxTable.attemptCount,
        workerId: taskExecutionObservationOutboxTable.workerId,
      })
        .from(taskExecutionObservationOutboxTable)
        .where(eq(taskExecutionObservationOutboxTable.id, outboxId));

      expect(claimed).toMatchObject({
        status: "running",
        attemptCount: attempt,
      });
      expect(claimed?.workerId).toBeTruthy();

      // Simulate an abandoned worker while materialization is in flight. The next
      // dispatcher may recover the row only after this persisted lease expires.
      await db.update(taskExecutionObservationOutboxTable)
        .set({ leaseUntil: new Date(0) })
        .where(eq(taskExecutionObservationOutboxTable.id, outboxId));
      releaseMaterializer();
      await running;

      const [abandoned] = await db.select({
        status: taskExecutionObservationOutboxTable.status,
        attemptCount: taskExecutionObservationOutboxTable.attemptCount,
      })
        .from(taskExecutionObservationOutboxTable)
        .where(eq(taskExecutionObservationOutboxTable.id, outboxId));
      expect(abandoned).toEqual({
        status: "running",
        attemptCount: attempt,
      });
    }

    expect(await dispatchPendingTaskObservationOutbox(1)).toBe(0);
    expect(enqueue).toHaveBeenCalledTimes(MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS);
    const [deadLetter] = await db.select({
      status: taskExecutionObservationOutboxTable.status,
      attemptCount: taskExecutionObservationOutboxTable.attemptCount,
      workerId: taskExecutionObservationOutboxTable.workerId,
      leaseUntil: taskExecutionObservationOutboxTable.leaseUntil,
      lastFailureCode: taskExecutionObservationOutboxTable.lastFailureCode,
    })
      .from(taskExecutionObservationOutboxTable)
      .where(eq(taskExecutionObservationOutboxTable.id, outboxId));
    expect(deadLetter).toEqual({
      status: "dead_letter",
      attemptCount: MAX_TASK_OBSERVATION_OUTBOX_ATTEMPTS,
      workerId: null,
      leaseUntil: null,
      lastFailureCode: "TASK_OBSERVATION_OUTBOX_ATTEMPTS_EXHAUSTED",
    });

    expect(await requeueDeadLetteredTaskObservationOutboxRow(outboxId)).toBe(true);
    const [requeued] = await db.select({
      status: taskExecutionObservationOutboxTable.status,
      attemptCount: taskExecutionObservationOutboxTable.attemptCount,
      lastFailureCode: taskExecutionObservationOutboxTable.lastFailureCode,
    })
      .from(taskExecutionObservationOutboxTable)
      .where(eq(taskExecutionObservationOutboxTable.id, outboxId));
    expect(requeued).toEqual({
      status: "pending",
      attemptCount: 0,
      lastFailureCode: null,
    });
  });
});
