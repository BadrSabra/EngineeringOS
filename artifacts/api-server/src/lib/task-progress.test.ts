import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { createTaskProgressEmitter } from "./task-progress.js";

describe("task progress emitter", () => {
  const projectIds: string[] = [];

  afterEach(async () => {
    for (const projectId of projectIds.splice(0)) {
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });

  async function fixture() {
    const projectId = randomUUID();
    const taskId = randomUUID();
    const executionId = randomUUID();
    const workerId = randomUUID();
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "task-progress-test-user",
      name: "task-progress-test",
      rootPath: `/tmp/task-progress-${projectId}`,
      language: "typescript",
      status: "active",
    });
    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      title: "progress fixture",
      status: "running",
      workerId,
      correlationId: randomUUID(),
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      linkedTaskId: taskId,
      userId: "task-progress-test-user",
      idempotencyKey: executionId,
      attempt: 1,
      resumeTokenHash: randomUUID(),
      request: "{}",
      checkpoint: "{}",
      status: "running",
      workerId,
    });
    return { projectId, taskId, executionId, workerId };
  }

  it("serializes progress, rejects an old worker, and deduplicates terminal events", async () => {
    const { taskId, executionId, workerId } = await fixture();
    const emitter = createTaskProgressEmitter({
      taskId,
      executionId,
      attempt: 1,
      workerId,
      correlationId: randomUUID(),
      trigger: "manual",
    });

    const [first, second] = await Promise.all([
      emitter.start("acquisition", "Execution acquired.", 8, 1),
      emitter.finish("acquisition", "completed", "Execution is owned by the active worker.", 12, 1),
    ]);
    expect(first?.sequence).toBe(1);
    expect(second?.sequence).toBe(2);

    const replacementWorker = randomUUID();
    await db.update(tasksTable).set({ workerId: replacementWorker }).where(eq(tasksTable.id, taskId));
    await expect(emitter.start("context", "Old worker must not publish.")).resolves.toBeNull();

    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId: (await db.select({ projectId: tasksTable.projectId }).from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1))[0].projectId,
      attempt: 1,
      finalizationKey: randomUUID(),
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "ACCEPTED",
      nextActionCode: "NONE",
      disposition: {
        reasonCodes: ["ACCEPTED"],
        outcome: "SUCCEEDED",
        recoveryState: "NONE",
        nextActionCode: "NONE",
        operatorAction: "No operator action is required.",
      },
      evidenceRequired: 0,
      evidenceComplete: 0,
      resumable: 0,
    });
    const firstTerminal = await emitter.terminal("SUCCEEDED", "Task completed.");
    const duplicateTerminal = await emitter.terminal("SUCCEEDED", "Task completed again.");
    expect(firstTerminal?.sequence).toBe(3);
    expect(duplicateTerminal?.id).toBe(firstTerminal?.id);

    const rows = await db
      .select()
      .from(taskLogsTable)
      .where(eq(taskLogsTable.taskId, taskId));
    expect(rows.filter((row) => row.eventType === "terminal")).toHaveLength(1);
    expect(rows.map((row) => row.sequence).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3]);
  });

  it("keeps the replay cursor monotonic when a task starts another execution", async () => {
    const { taskId, executionId, workerId } = await fixture();
    const first = createTaskProgressEmitter({
      taskId,
      executionId,
      attempt: 1,
      workerId,
      correlationId: randomUUID(),
      trigger: "manual",
    });
    const secondExecutionId = randomUUID();
    const second = createTaskProgressEmitter({
      taskId,
      executionId: secondExecutionId,
      attempt: 2,
      workerId,
      correlationId: randomUUID(),
      trigger: "manual",
    });

    const firstEvent = await first.start("acquisition", "First execution acquired.", 8, 1);
    const secondEvent = await second.start("acquisition", "Second execution acquired.", 8, 1);

    expect(firstEvent?.sequence).toBe(1);
    expect(secondEvent?.sequence).toBe(2);
  });
});