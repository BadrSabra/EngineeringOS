import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  tasksTable,
  taskLogsTable,
  eventsTable,
  auditLogsTable,
  aiExecutionsTable,
  aiExecutionAcceptancesTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import { get as httpGet, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { insertTaskAutoExecutionIntent } from "../lib/task-auto-execution-outbox.js";
import { executeTaskLifecycle } from "../lib/task-execution-service.js";
import {
  runDeferredTaskVerification,
  taskExecutionWaitIntentId,
} from "../lib/deferred-task-execution.js";

// PR-C: hoist mock fn so vi.mock factory can close over it before module eval.
const { mockScheduleAiTaskExecution } = vi.hoisted(() => ({
  mockScheduleAiTaskExecution: vi.fn(),
}));

// Keep the real ai router intact (so mounted routes still work) while
// replacing only scheduleAiTaskExecution with a spy.
vi.mock("./ai.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ai.js")>();
  return { ...actual, scheduleAiTaskExecution: mockScheduleAiTaskExecution };
});

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `task-test-project-${id.slice(0, 8)}`,
    rootPath: `/tmp/task-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupProject(id: string): Promise<void> {
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.projectId, id));
  for (const task of tasks) {
    await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, task.id));
  }
  await db.delete(eventsTable).where(eq(eventsTable.projectId, id));
  await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, id));
  await db.delete(tasksTable).where(eq(tasksTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

describe("Task lifecycle", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function createTask(overrides: Record<string, unknown> = {}) {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const res = await request(app)
      .post("/api/tasks")
      .send({
        projectId,
        title: `task-${randomUUID().slice(0, 8)}`,
        priority: "p2",
        ...overrides,
      });
    expect(res.status).toBe(201);
    return { projectId, taskId: res.body.id, task: res.body };
  }

  it("creates a task and lists it back by project", async () => {
    const { projectId, taskId } = await createTask();

    const list = await request(app).get("/api/tasks").query({ projectId });
    expect(list.status).toBe(200);
    expect(list.body.some((t: { id: string }) => t.id === taskId)).toBe(true);
  });
  it("stores explicit task dependencies only when they reference tasks in the same project", async () => {
    const prerequisite = await createTask();
    const created = await request(app).post("/api/tasks").send({
      projectId: prerequisite.projectId,
      title: "dependent-task",
      priority: "p1",
      dependsOn: [prerequisite.taskId],
    });

    expect(created.status).toBe(201);
    expect(created.body.dependsOn).toEqual([prerequisite.taskId]);

    const foreignProjectId = await insertProject();
    cleanupQueue.push(foreignProjectId);
    const foreignTaskId = randomUUID();
    await db.insert(tasksTable).values({
      id: foreignTaskId,
      projectId: foreignProjectId,
      title: "foreign-prerequisite",
      status: "pending",
    });

    const invalid = await request(app).post("/api/tasks").send({
      projectId: prerequisite.projectId,
      title: "invalid-dependent-task",
      priority: "p2",
      dependsOn: [randomUUID(), foreignTaskId, foreignTaskId],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_task_dependencies");
    expect(invalid.body.dependencyIds).toEqual(
      expect.arrayContaining([foreignTaskId]),
    );
  });

  it("durably defers requested task execution until every same-project prerequisite is completed", async () => {
    const prerequisite = await createTask();
    const dependent = await request(app).post("/api/tasks").send({
      projectId: prerequisite.projectId,
      title: "dependent-verification",
      priority: "p2",
      dependsOn: [prerequisite.taskId],
    });
    expect(dependent.status).toBe(201);
    const dependentId = dependent.body.id as string;

    const blocked = await request(app).post(`/api/tasks/${dependentId}/execute`);
    expect(blocked.status).toBe(202);
    expect(blocked.body.executionDeferred).toBe(true);
    expect(blocked.body.waitingForDependencies).toBe(true);
    expect(blocked.body.blockedDependencies).toEqual([
      expect.objectContaining({
        taskId: prerequisite.taskId,
        reason: "dependency_not_completed",
        status: "pending",
      }),
    ]);

    const [unchanged] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, dependentId));
    expect(unchanged?.status).toBe("pending");
    const [waitIntent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, taskExecutionWaitIntentId(dependentId)));
    expect(waitIntent?.type).toBe("TaskExecutionWaitingForDependencies");
    const startedBeforePrerequisites = await db.select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.type, "TaskExecutionStarted"),
        eq(eventsTable.projectId, prerequisite.projectId),
      ));
    expect(startedBeforePrerequisites).toHaveLength(0);

    await db.update(tasksTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasksTable.id, prerequisite.taskId));

    const resumed = await runDeferredTaskVerification(dependentId);
    expect(resumed).toBe(true);
    const [verified] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, dependentId));
    expect(verified?.status).toBe("verifying");
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, taskExecutionWaitIntentId(dependentId))))
      .resolves.toHaveLength(0);
    const startedAfterPrerequisites = await db.select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.type, "TaskExecutionStarted"),
        eq(eventsTable.taskId, dependentId),
      ));
    expect(startedAfterPrerequisites).toHaveLength(1);
  });

  it("rechecks dependencies in the final execution transaction before creating an AI execution", async () => {
    const prerequisite = await createTask();
    const dependent = await request(app).post("/api/tasks").send({
      projectId: prerequisite.projectId,
      title: "final-claim-dependent",
      priority: "p2",
      dependsOn: [prerequisite.taskId],
    });
    expect(dependent.status).toBe(201);
    const dependentId = dependent.body.id as string;

    const outcome = await executeTaskLifecycle({
      taskId: dependentId,
      userId: "test-user",
      provider: {} as never,
      trigger: "manual",
      expectedStatuses: ["pending"],
    });

    expect(outcome).toMatchObject({
      ok: false,
      status: "conflict",
      errorCode: "task_dependencies_not_completed",
      blockedDependencies: [{
        taskId: prerequisite.taskId,
        reason: "dependency_not_completed",
        status: "pending",
      }],
    });
    const [task] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, dependentId));
    expect(task?.status).toBe("pending");
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.linkedTaskId, dependentId));
    expect(executions).toHaveLength(0);
  });

  it("defers a task when a legacy-completed prerequisite has an incomplete ancestor", async () => {
    const deepest = await createTask();
    const middle = await request(app).post("/api/tasks").send({
      projectId: deepest.projectId,
      title: "legacy-completed-middle",
      priority: "p2",
      dependsOn: [deepest.taskId],
    });
    expect(middle.status).toBe(201);
    const leaf = await request(app).post("/api/tasks").send({
      projectId: deepest.projectId,
      title: "transitive-dependent",
      priority: "p2",
      dependsOn: [middle.body.id],
    });
    expect(leaf.status).toBe(201);

    // Simulate a row completed before dependency admission was enforced.
    await db.update(tasksTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasksTable.id, middle.body.id));

    const response = await request(app).post(`/api/tasks/${leaf.body.id}/execute`);
    expect(response.status).toBe(202);
    expect(response.body.executionDeferred).toBe(true);
    expect(response.body.blockedDependencies).toContainEqual(
      expect.objectContaining({
        taskId: deepest.taskId,
        reason: "dependency_not_completed",
        status: "pending",
      }),
    );
  });

  it("fails closed on a legacy cyclic task dependency graph", async () => {
    const first = await createTask();
    const second = await request(app).post("/api/tasks").send({
      projectId: first.projectId,
      title: "cycle-second",
      priority: "p2",
      dependsOn: [first.taskId],
    });
    expect(second.status).toBe(201);

    // Cycles cannot be created through the current POST contract (which only
    // references pre-existing IDs); simulate legacy/out-of-band corrupt data.
    await db.update(tasksTable)
      .set({ status: "completed", completedAt: new Date(), dependsOn: [second.body.id] })
      .where(eq(tasksTable.id, first.taskId));
    await db.update(tasksTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasksTable.id, second.body.id));

    const response = await request(app).post(`/api/tasks/${first.taskId}/execute`);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("task_dependencies_not_completed");
    expect(response.body.blockedDependencies).toContainEqual(
      expect.objectContaining({ reason: "dependency_cycle" }),
    );
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, taskExecutionWaitIntentId(first.taskId))))
      .resolves.toHaveLength(0);
  });

  it("prevents deletion of a prerequisite that is still referenced by another task", async () => {
    const prerequisite = await createTask();
    const dependent = await request(app).post("/api/tasks").send({
      projectId: prerequisite.projectId,
      title: "dependent-retained",
      priority: "p2",
      dependsOn: [prerequisite.taskId],
    });
    expect(dependent.status).toBe(201);

    const deleted = await request(app).delete(`/api/tasks/${prerequisite.taskId}`);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toBe("task_has_dependents");
    expect(deleted.body.dependentTaskIds).toContain(dependent.body.id);

    const retained = await db.select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.id, prerequisite.taskId));
    expect(retained).toHaveLength(1);
  });

  it("does not persist an automatic dispatch intent while task dependencies are incomplete", async () => {
    const { projectId, taskId } = await createTask();
    await db.update(tasksTable)
      .set({ prompt: "Wait for prerequisite completion" })
      .where(eq(tasksTable.id, taskId));
    const prerequisiteId = randomUUID();
    await db.insert(tasksTable).values({
      id: prerequisiteId,
      projectId,
      title: "outbox-prerequisite",
      status: "pending",
    });
    await db.update(tasksTable)
      .set({ status: "verifying", dependsOn: [prerequisiteId] })
      .where(eq(tasksTable.id, taskId));

    const [generation] = await db.select({
      retryCount: tasksTable.retryCount,
    }).from(tasksTable).where(eq(tasksTable.id, taskId));
    const persistedWhileBlocked = await db.transaction((tx) =>
      insertTaskAutoExecutionIntent(tx, {
        taskId,
        userId: "test-user",
        retryCount: generation!.retryCount,
      }),
    );
    expect(persistedWhileBlocked).toBe(false);
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`)))
      .resolves.toHaveLength(0);

    await db.update(tasksTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasksTable.id, prerequisiteId));
    const persistedAfterCompletion = await db.transaction((tx) =>
      insertTaskAutoExecutionIntent(tx, {
        taskId,
        userId: "test-user",
        retryCount: generation!.retryCount,
      }),
    );
    expect(persistedAfterCompletion).toBe(true);
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intent?.type).toBe("TaskAutoExecutionDispatchRequested");
  });

  it("blocks the PATCH-to-verifying auto-dispatch path while prerequisites are incomplete", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const prerequisiteId = randomUUID();
    await db.insert(tasksTable).values({
      id: prerequisiteId,
      projectId,
      title: "pending-prerequisite",
      status: "pending",
    });
    const dependentId = randomUUID();
    await db.insert(tasksTable).values({
      id: dependentId,
      projectId,
      title: "auto-dispatched-dependent",
      status: "pending",
      prompt: "Run the approved task",
      dependsOn: [prerequisiteId],
    });
    mockScheduleAiTaskExecution.mockClear();

    const response = await request(app)
      .patch(`/api/tasks/${dependentId}`)
      .send({ status: "verifying" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("task_dependencies_not_completed");
    const [task] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, dependentId));
    expect(task?.status).toBe("pending");
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${dependentId}`)))
      .resolves.toHaveLength(0);
    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
  });


  it("includes the allowlisted current acceptance in the task list", async () => {
    const { projectId, taskId } = await createTask();
    const executionId = randomUUID();
    await db.update(tasksTable)
      .set({ correlationId: executionId })
      .where(eq(tasksTable.id, taskId));
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: executionId,
      correlationId: executionId,
      attempt: 1,
      resumeTokenHash: "task-list-acceptance-hash",
      request: "{}",
      checkpoint: "{}",
      status: "completed",
    });
    await db.insert(aiExecutionsTable).values({
      id: randomUUID(),
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      attempt: 9,
      resumeTokenHash: "superseded-task-list-resume-hash",
      request: "{}",
      checkpoint: "{}",
      status: "failed",
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
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
        providerPayload: "must not cross the public boundary",
      },
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
    });

    const list = await request(app).get("/api/tasks").query({ projectId });
    expect(list.status).toBe(200);
    const listedTask = list.body.find((task: { id: string }) => task.id === taskId);
    expect(listedTask.acceptance).toEqual({
      attempt: 1,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "ACCEPTED",
      nextActionCode: "NONE",
      evidenceComplete: true,
      evidenceRequired: true,
      resumable: false,
      disposition: {
        reasonCodes: ["ACCEPTED"],
        outcome: "SUCCEEDED",
        recoveryState: "NONE",
        nextActionCode: "NONE",
        operatorAction: "No operator action is required.",
      },
    });
    expect(JSON.stringify(listedTask)).not.toContain("providerPayload");
  });

  it("returns the allowlisted acceptance for the task's current execution attempt", async () => {
    const { projectId, taskId } = await createTask();
    const executionId = randomUUID();
    await db.update(tasksTable)
      .set({ correlationId: executionId })
      .where(eq(tasksTable.id, taskId));
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: executionId,
      correlationId: executionId,
      attempt: 2,
      resumeTokenHash: "task-detail-acceptance-hash",
      request: "{}",
      checkpoint: "{}",
      status: "failed",
    });
    await db.insert(aiExecutionsTable).values({
      id: randomUUID(),
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      attempt: 9,
      resumeTokenHash: "superseded-task-detail-resume-hash",
      request: "{}",
      checkpoint: "{}",
      status: "failed",
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 2,
      finalizationKey: randomUUID(),
      operationId: "task-detail-operation",
      workerId: "worker",
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "PROVIDER_FAILURE",
      nextActionCode: "RESUME_ALLOWED",
      disposition: {
        reasonCodes: ["PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RESUME_ALLOWED",
        operatorAction: "Resume the saved task checkpoint.",
        providerPayload: "must not cross the public boundary",
      },
      evidenceRequired: 0,
      evidenceComplete: 0,
      resumable: 1,
    });

    const res = await request(app).get(`/api/tasks/${taskId}`);

    expect(res.status).toBe(200);
    expect(res.body.acceptance).toEqual({
      attempt: 2,
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "PROVIDER_FAILURE",
      nextActionCode: "RESUME_ALLOWED",
      evidenceComplete: false,
      evidenceRequired: false,
      resumable: true,
      disposition: {
        reasonCodes: ["PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RESUME_ALLOWED",
        operatorAction: "Resume the saved task checkpoint.",
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("providerPayload");
  });

  it("returns a bounded 429 before provider resolution while a task retry window is active", async () => {
    const { projectId, taskId } = await createTask();
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    await db.update(tasksTable)
      .set({ status: "verifying", correlationId })
      .where(eq(tasksTable.id, taskId));
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: executionId,
      correlationId,
      attempt: 0,
      resumeTokenHash: "unchanged-resume-token-hash",
      request: "{}",
      checkpoint: "{}",
      status: "failed",
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: randomUUID(),
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      nextActionCode: "RESUME_ALLOWED",
      disposition: {
        reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RESUME_ALLOWED",
        operatorAction: "Resume after the provider retry window.",
        retryAt,
        retryAfterMs: 60_000,
        retryAfterSource: "provider",
        rateLimitScope: "provider_credential",
      },
      evidenceRequired: 0,
      evidenceComplete: 0,
      resumable: 1,
    });

    try {
      const response = await request(app).post(`/api/ai/tasks/${taskId}/resume`);

      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBe("60");
      expect(response.body).toMatchObject({
        error: "task_execution_rate_limited",
        code: "execution_retry_after_rate_limit",
        retryAfterMs: expect.any(Number),
      });
      const [execution] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          resumeTokenHash: aiExecutionsTable.resumeTokenHash,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId));
      expect(execution).toEqual({
        attempt: 0,
        status: "failed",
        resumeTokenHash: "unchanged-resume-token-hash",
      });
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
    }
  });

  it("returns an AI Task receipt only for the pointer-bound execution and exact attempt", async () => {
    const { projectId, taskId } = await createTask();
    const currentExecutionId = randomUUID();
    const currentCorrelationId = randomUUID();
    const supersededExecutionId = randomUUID();
    const supersededCorrelationId = currentCorrelationId;
    const currentReceipt = JSON.stringify({
      kind: "AI_TASK_EXECUTION_RECEIPT",
      operationId: currentExecutionId,
      correlationId: currentCorrelationId,
      attempt: 3,
      attempts: 2,
      terminalStatus: "SUCCEEDED",
    });

    await db.update(tasksTable)
      .set({ correlationId: currentCorrelationId, agentResponse: currentReceipt })
      .where(eq(tasksTable.id, taskId));
    await db.insert(aiExecutionsTable).values([
      {
        id: currentExecutionId,
        projectId,
        linkedTaskId: taskId,
        userId: "test-user",
        idempotencyKey: currentExecutionId,
        correlationId: currentCorrelationId,
        attempt: 3,
        resumeTokenHash: "current-task-receipt-hash",
        request: "{}",
        checkpoint: "{}",
        status: "completed",
      },
      {
        id: supersededExecutionId,
        projectId,
        linkedTaskId: taskId,
        userId: "test-user",
        idempotencyKey: supersededExecutionId,
        correlationId: supersededCorrelationId,
        attempt: 2,
        resumeTokenHash: "superseded-task-receipt-hash",
        request: "{}",
        checkpoint: "{}",
        status: "failed",
      },
    ]);

    const currentList = await request(app).get("/api/tasks").query({ projectId });
    expect(currentList.body.find((task: { id: string }) => task.id === taskId).agentResponse)
      .toBe(currentReceipt);
    const currentDetail = await request(app).get(`/api/tasks/${taskId}`);
    expect(currentDetail.body.agentResponse).toBe(currentReceipt);

    const ambiguousExecutionId = randomUUID();
    await db.insert(aiExecutionsTable).values({
      id: ambiguousExecutionId,
      projectId,
      linkedTaskId: taskId,
      userId: "test-user",
      idempotencyKey: ambiguousExecutionId,
      correlationId: currentCorrelationId,
      attempt: 3,
      resumeTokenHash: "ambiguous-task-receipt-hash",
      request: "{}",
      checkpoint: "{}",
      status: "running",
    });
    const ambiguousCurrentDetail = await request(app).get(`/api/tasks/${taskId}`);
    expect(ambiguousCurrentDetail.body.agentResponse).toBeNull();

    await db.update(tasksTable)
      .set({
        agentResponse: JSON.stringify({
          kind: "AI_TASK_EXECUTION_RECEIPT",
          operationId: supersededExecutionId,
          correlationId: supersededCorrelationId,
          attempt: 2,
          attempts: 1,
          terminalStatus: "FAILED",
        }),
      })
      .where(eq(tasksTable.id, taskId));

    const supersededList = await request(app).get("/api/tasks").query({ projectId });
    expect(supersededList.body.find((task: { id: string }) => task.id === taskId).agentResponse)
      .toBeNull();
    const supersededDetail = await request(app).get(`/api/tasks/${taskId}`);
    expect(supersededDetail.body.agentResponse).toBeNull();

    await db.update(tasksTable)
      .set({
        agentResponse: JSON.stringify({
          kind: "AI_TASK_EXECUTION_RECEIPT",
          operationId: currentExecutionId,
          correlationId: currentCorrelationId,
          attempt: 2,
          attempts: 1,
          terminalStatus: "FAILED",
        }),
      })
      .where(eq(tasksTable.id, taskId));
    const staleAttemptDetail = await request(app).get(`/api/tasks/${taskId}`);
    expect(staleAttemptDetail.body.agentResponse).toBeNull();
  });

  it("executes a task with no rule/relatedFiles into the verifying state", async () => {
    const { taskId } = await createTask();

    const res = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");
    expect(res.body.verificationResult.passed).toBe(false);

    const logs = await request(app).get(`/api/tasks/${taskId}/logs`);
    expect(logs.status).toBe(200);
    expect(logs.body.length).toBeGreaterThan(0);
  });


  it("clears the task-log poller when the SSE response disconnects", async () => {
    const { taskId } = await createTask();
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "info",
      message: "disconnect sentinel",
      timestamp: new Date(),
    });

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const intervalCallStart = setIntervalSpy.mock.calls.length;
    const server = app.listen(0);

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the test server to bind an ephemeral TCP port.");
      }

      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const client = httpGet({
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/tasks/" + taskId + "/logs/stream",
          agent: false,
        });
        client.once("response", resolve);
        client.once("error", reject);
      });

      await new Promise<void>((resolve, reject) => {
        response.once("data", () => resolve());
        response.once("error", reject);
      });
      await vi.waitFor(() => {
        expect(setIntervalSpy.mock.calls
          .slice(intervalCallStart)
          .some(([, delay]) => delay === 500)).toBe(true);
      });

      const pollTimers = setIntervalSpy.mock.results
        .slice(intervalCallStart)
        .map((result, index) => ({
          timer: result.value,
          delay: setIntervalSpy.mock.calls[intervalCallStart + index]?.[1],
        }))
        .filter((entry) => entry.delay === 500);
      expect(pollTimers).toHaveLength(1);

      const responseClosed = once(response, "close");
      response.destroy();
      await responseClosed;
      await vi.waitFor(() => {
        expect(clearIntervalSpy).toHaveBeenCalledWith(pollTimers[0].timer);
      });
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps the SSE stream open when the first structured progress rows arrive after subscription", async () => {
    const { taskId } = await createTask();
    const executionId = randomUUID();
    const correlationId = randomUUID();
    const startedAt = new Date();

    await db.update(tasksTable)
      .set({ status: "running", updatedAt: startedAt })
      .where(eq(tasksTable.id, taskId));

    let streamSettled = false;
    const streamPromise = request(app)
      .get(`/api/tasks/${taskId}/logs/stream`)
      .then((response) => {
        streamSettled = true;
        return response;
      });

    // Allow the stream to send headers and pass its initial empty-log snapshot.
    // The first poll happens at 500 ms; the old implementation closed here
    // solely because the initial snapshot had no structured events.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const closedBeforeProgress = streamSettled;

    const progressAt = new Date();
    // A later sequence can carry an earlier worker timestamp after clock skew.
    const terminalAt = new Date(progressAt.getTime() - 1);
    await db.insert(taskLogsTable).values([
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "execution acquired",
        timestamp: progressAt,
        correlationId,
        eventType: "progress",
        executionId,
        attempt: 1,
        sequence: 1,
        progressStage: "acquisition",
        progressStatus: "completed",
        progressMessage: "Execution is owned by the active worker.",
        startedAt,
        finishedAt: progressAt,
      },
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "task completed",
        timestamp: terminalAt,
        correlationId,
        eventType: "terminal",
        executionId,
        attempt: 1,
        sequence: 2,
        progressStage: "result",
        progressStatus: "completed",
        progressMessage: "Task completed successfully.",
        progressPercent: 100,
        terminalOutcome: "SUCCEEDED",
      },
    ]);
    await db.update(tasksTable)
      .set({ status: "completed", updatedAt: terminalAt, completedAt: terminalAt })
      .where(eq(tasksTable.id, taskId));

    const replay = await streamPromise;
    const replayedSequences = [...replay.text.matchAll(/event: log\ndata: (\{.*\})\n/g)]
      .map((match) => JSON.parse(match[1]) as { sequence: number });
    expect(replayedSequences.map((log) => log.sequence)).toEqual([1, 2]);
    expect(closedBeforeProgress).toBe(false);
    expect(replay.status).toBe(200);
    expect(replay.text).toContain("execution acquired");
    expect(replay.text).toContain("task completed");
    expect(replay.text).toContain("event: done");
  });

  it("replays structured progress in sequence order and resumes after a cursor", async () => {
    const { taskId } = await createTask();
    const executionId = randomUUID();
    const resumedExecutionId = randomUUID();
    const correlationId = randomUUID();
    const now = new Date();
    await db
      .update(tasksTable)
      .set({ status: "completed", updatedAt: now, completedAt: now })
      .where(eq(tasksTable.id, taskId));
    await db.insert(taskLogsTable).values([
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "context ready",
        timestamp: new Date(now.getTime() + 1),
        correlationId,
        eventType: "progress",
        executionId,
        attempt: 1,
        sequence: 2,
        progressStage: "context",
        progressStatus: "completed",
        progressMessage: "Project context is ready.",
        startedAt: now,
        finishedAt: new Date(now.getTime() + 1),
      },
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "execution acquired",
        timestamp: now,
        correlationId,
        eventType: "progress",
        executionId,
        attempt: 1,
        sequence: 1,
        progressStage: "acquisition",
        progressStatus: "completed",
        progressMessage: "Execution is owned by the active worker.",
        startedAt: now,
        finishedAt: now,
      },
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "task complete",
        timestamp: new Date(now.getTime() + 2),
        correlationId,
        eventType: "terminal",
        executionId,
        attempt: 1,
        sequence: 3,
        progressStage: "result",
        progressStatus: "completed",
        progressMessage: "Task completed successfully.",
        progressPercent: 100,
        terminalOutcome: "SUCCEEDED",
      },
      {
        id: randomUUID(),
        taskId,
        level: "info",
        message: "resumed execution acquired",
        timestamp: new Date(now.getTime() + 3),
        correlationId,
        eventType: "progress",
        executionId: resumedExecutionId,
        attempt: 2,
        sequence: 4,
        progressStage: "acquisition",
        progressStatus: "active",
        progressMessage: "Resumed execution acquired.",
      },
    ]);

    const replay = await request(app).get(`/api/tasks/${taskId}/logs/stream`);
    expect(replay.status).toBe(200);
    expect(replay.headers["content-type"]).toContain("text/event-stream");
    const replayed = [...replay.text.matchAll(/event: log\ndata: (\{.*\})\n/g)]
      .map((match) => JSON.parse(match[1]) as { sequence: number });
    expect(replayed.map((log) => log.sequence)).toEqual([1, 2, 3, 4]);
    expect(replay.text).toContain('event: done');

    const resumed = await request(app).get(`/api/tasks/${taskId}/logs/stream?after=2`);
    const resumedLogs = [...resumed.text.matchAll(/event: log\ndata: (\{.*\})\n/g)]
      .map((match) => JSON.parse(match[1]) as { sequence: number });
    expect(resumedLogs.map((log) => log.sequence)).toEqual([3, 4]);

    const resumedAfterTerminal = await request(app).get(`/api/tasks/${taskId}/logs/stream?after=3`);
    const resumedExecutionLogs = [...resumedAfterTerminal.text.matchAll(/event: log\ndata: (\{.*\})\n/g)]
      .map((match) => JSON.parse(match[1]) as { sequence: number });
    expect(resumedExecutionLogs.map((log) => log.sequence)).toEqual([4]);
  });

  it("redacts legacy log content and metadata at the public boundary", async () => {
    const { taskId } = await createTask();
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "info",
       message: "provider returned token: sk-or-v1-secret-for-test /home/runner/workspace/private.ts",
      metadata: {
        providerKey: "never-public",
        providerPayload: { raw: "model output" },
        safe: "retained",
      },
    });

    const logs = await request(app).get(`/api/tasks/${taskId}/logs`);
    expect(logs.status).toBe(200);
    expect(JSON.stringify(logs.body)).not.toContain("never-public");
    expect(JSON.stringify(logs.body)).not.toContain("model output");
    expect(JSON.stringify(logs.body)).not.toContain("/home/runner/workspace/private.ts");
    expect(JSON.stringify(logs.body)).not.toContain("sk-or-v1-secret-for-test");
    expect(logs.body.find((log: { metadata?: unknown }) => log.metadata)?.metadata).toBeUndefined();
  });

  it("requires explicit evidence for every server-owned rule verification check", async () => {
    const { taskId } = await createTask();
    await db.update(tasksTable).set({
      remediationPlan: {
        version: 1,
        ruleId: null,
        ruleCode: "TEST-001",
        ruleTitle: "Evidence-backed check",
        severity: "medium",
        occurrenceCount: 1,
        evidence: [{ file: "src/example.ts", line: 1, snippet: "x", occurrences: 1 }],
        relatedFiles: [],
        fixDescription: "Make the check pass.",
        verificationSteps: ["Run the focused test.", "Inspect the resulting behavior."],
        source: { type: "scan", correlationId: null, revision: null, completeness: "COMPLETE" },
        status: "ready",
      },
    }).where(eq(tasksTable.id, taskId));

    const executed = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(executed.status).toBe(202);
    expect(executed.body.status).toBe("verifying");
    expect(executed.body.verificationResult.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "rule-verification-1", passed: false }),
        expect.objectContaining({ id: "rule-verification-2", passed: false }),
      ]),
    );

    const unknownCheck = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "model-supplied-command",
      passed: true,
      evidence: "This must not be accepted.",
    });
    expect(unknownCheck.status).toBe(400);
    expect(unknownCheck.body.error).toBe("verification_check_not_found");

    const missingEvidence = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "rule-verification-1",
      passed: true,
    });
    expect(missingEvidence.status).toBe(400);
    expect(missingEvidence.body.error).toBe("verification_evidence_required");

    const first = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "rule-verification-1",
      passed: true,
      evidence: "Focused test passed in the operator console.",
    });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("verifying");
    expect(first.body.verificationResult.passed).toBe(false);

    const failed = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "rule-verification-2",
      passed: false,
      evidence: "Behavior still needs correction.",
    });
    expect(failed.status).toBe(200);
    expect(failed.body.status).toBe("verifying");
    expect(failed.body.verificationResult.passed).toBe(false);

    const second = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "rule-verification-2",
      passed: true,
      evidence: "Observed the expected behavior after the fix.",
    });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("completed");
    expect(second.body.verificationResult).toMatchObject({
      passed: true,
      decision: "verified",
    });
    expect(second.body.verificationResult.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rule-verification-2",
          passed: true,
          evidence: "Observed the expected behavior after the fix.",
        }),
      ]),
    );
    expect(second.body.verificationResult.history).toHaveLength(3);
    expect(second.body.verificationResult.history).toEqual([
      expect.objectContaining({
        checkId: "rule-verification-1",
        passed: true,
        evidence: "Focused test passed in the operator console.",
        actor: "test-user",
        recordedAt: expect.any(String),
      }),
      expect.objectContaining({
        checkId: "rule-verification-2",
        passed: false,
        evidence: "Behavior still needs correction.",
        actor: "test-user",
        recordedAt: expect.any(String),
      }),
      expect.objectContaining({
        checkId: "rule-verification-2",
        passed: true,
        evidence: "Observed the expected behavior after the fix.",
        actor: "test-user",
        recordedAt: expect.any(String),
      }),
    ]);
    expect(second.body.remediationPlan.status).toBe("verified");

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, taskId));
    expect(audits.some((audit) => audit.reason === "operator_verification_recorded")).toBe(true);
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.taskId, taskId));
    expect(events.some((event) => event.type === "TaskVerified")).toBe(true);
  });

  it("does not record verification after cancellation or for an unknown check", async () => {
    const { taskId } = await createTask();
    await db.update(tasksTable).set({
      remediationPlan: {
        version: 1,
        ruleId: null,
        ruleCode: "TEST-002",
        ruleTitle: "Cancelled check",
        severity: "low",
        occurrenceCount: 1,
        evidence: [{ file: "src/example.ts", line: 1, snippet: "x", occurrences: 1 }],
        relatedFiles: [],
        fixDescription: "Make the check pass.",
        verificationSteps: ["Confirm the result."],
        source: { type: "scan", correlationId: null, revision: null, completeness: "COMPLETE" },
        status: "ready",
      },
    }).where(eq(tasksTable.id, taskId));
    await request(app).post(`/api/tasks/${taskId}/execute`);
    await request(app).post(`/api/tasks/${taskId}/rollback`);

    const cancelled = await request(app).post(`/api/tasks/${taskId}/verification`).send({
      checkId: "rule-verification-1",
      passed: true,
      evidence: "This must not be accepted.",
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toBe("task_not_verifying");
  });

  it("returns 409 when executing a task that is not pending/queued", async () => {
    const { taskId } = await createTask();
    const first = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(first.status).toBe(202);

    const second = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(second.status).toBe(409);
  });

  it("retries a failed task and increments retryCount, refusing once maxRetries is hit", async () => {
    const { taskId } = await createTask();
    await db.update(tasksTable).set({
      status: "failed",
      maxRetries: 1,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        operationId: randomUUID(),
        correlationId: randomUUID(),
        attempt: 1,
        attempts: 2,
      }),
    }).where(eq(tasksTable.id, taskId));

    const retried = await request(app).post(`/api/tasks/${taskId}/retry`);
    expect(retried.status).toBe(202);
    expect(retried.body.status).toBe("queued");
    expect(retried.body.retryCount).toBe(1);
    expect(retried.body.correlationId).toEqual(expect.any(String));
    expect(retried.body.agentResponse).toBeNull();

    await db.update(tasksTable).set({ status: "failed" }).where(eq(tasksTable.id, taskId));
    const secondRetry = await request(app).post(`/api/tasks/${taskId}/retry`);
    expect(secondRetry.status).toBe(409);
  });

  it("rolls back a task to cancelled", async () => {
    const { taskId } = await createTask();

    const rolledBack = await request(app).post(`/api/tasks/${taskId}/rollback`);
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.status).toBe("cancelled");
  });

  it("updates and deletes a task", async () => {
    const { taskId } = await createTask();

    const updated = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ priority: "p0" });
    expect(updated.status).toBe(200);
    expect(updated.body.priority).toBe("p0");

    const deleted = await request(app).delete(`/api/tasks/${taskId}`);
    expect(deleted.status).toBe(204);

    const fetched = await request(app).get(`/api/tasks/${taskId}`);
    expect(fetched.status).toBe(404);
  });

  it("links CRUD events and audit records to one correlation ID per operation", async () => {
    const { projectId, taskId } = await createTask();

    const createdEvent = (await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId)))
      .find((event) => event.type === "TaskCreated");
    const createdAudit = (await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.projectId, projectId)))
      .find((audit) => audit.action === "created");
    expect(createdEvent?.correlationId).toBeTruthy();
    expect(createdAudit?.correlationId).toBe(createdEvent?.correlationId);

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ priority: "p0" });
    const updatedEvent = (await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId)))
      .find((event) => event.type === "TaskUpdated");
    const updatedAudit = (await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.projectId, projectId)))
      .find((audit) => audit.action === "updated");
    expect(updatedEvent?.correlationId).toBeTruthy();
    expect(updatedAudit?.correlationId).toBe(updatedEvent?.correlationId);
    expect(updatedEvent?.correlationId).not.toBe(createdEvent?.correlationId);

    await request(app).delete(`/api/tasks/${taskId}`);
    const deletedEvent = (await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId)))
      .find((event) => event.type === "TaskDeleted");
    const deletedAudit = (await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.projectId, projectId)))
      .find((audit) => audit.action === "deleted");
    expect(deletedEvent?.correlationId).toBeTruthy();
    expect(deletedAudit?.correlationId).toBe(deletedEvent?.correlationId);
    expect(deletedEvent?.taskId).toBeNull();
  });

  // ── PR-B: event emission on task state transitions ──────────────────────────

  it("emits a TaskStatusChanged event when PATCH changes the task status", async () => {
    const { projectId, taskId } = await createTask();

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "queued" });

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "TaskStatusChanged");
    expect(ev).toBeDefined();
    expect((ev?.payload as { after?: { status?: string } })?.after?.status).toBe("queued");
  });

  it("emits a TaskExecutionStarted and a TaskCompleted/TaskVerifying event on execute", async () => {
    const { projectId, taskId } = await createTask();

    await request(app).post(`/api/tasks/${taskId}/execute`);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const types = events.map((e) => e.type);
    expect(types).toContain("TaskExecutionStarted");
    expect(
      types.includes("TaskCompleted") || types.includes("TaskVerifying"),
    ).toBe(true);
  });

  it("emits a TaskRetried event on retry", async () => {
    const { projectId, taskId } = await createTask();
    await db.update(tasksTable).set({ status: "failed" }).where(eq(tasksTable.id, taskId));

    await request(app).post(`/api/tasks/${taskId}/retry`);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    expect(events.some((e) => e.type === "TaskRetried")).toBe(true);
  });

  it("emits a TaskRolledBack event on rollback", async () => {
    const { projectId, taskId } = await createTask();

    await request(app).post(`/api/tasks/${taskId}/rollback`);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    expect(events.some((e) => e.type === "TaskRolledBack")).toBe(true);
  });
});

// ─── Ownership isolation ───────────────────────────────────────────────────────

describe("Ownership isolation — tasks", () => {
  const isolationCleanup: string[] = [];

  afterEach(async () => {
    while (isolationCleanup.length > 0) {
      const id = isolationCleanup.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function insertOtherUserProject(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "other-user",
      name: `other-user-project-${id.slice(0, 8)}`,
      rootPath: `/tmp/other-user-tasks-${id}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  it("GET /tasks returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).get("/api/tasks").query({ projectId: otherProjectId });
    expect(res.status).toBe(403);
  });

  it("POST /tasks returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).post("/api/tasks").send({
      projectId: otherProjectId,
      title: "should-be-blocked",
      priority: "p2",
    });
    expect(res.status).toBe(403);
  });

  it("GET /tasks/:taskId returns 403 when the task belongs to another user's project", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const taskId = randomUUID();
    const now = new Date();
    await db.insert(tasksTable).values({
      id: taskId,
      projectId: otherProjectId,
      title: "hidden-task",
      status: "pending",
      priority: "p2",
      createdAt: now,
      updatedAt: now,
    });

    const res = await request(app).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(403);
  });
});

// ─── PR-C: AI auto-trigger on verifying state ──────────────────────────────────

describe("PR-C — AI auto-trigger on verifying", () => {
  const cleanup: string[] = [];

  beforeEach(() => {
    mockScheduleAiTaskExecution.mockClear();
  });

  afterEach(async () => {
    while (cleanup.length > 0) {
      const id = cleanup.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function createTaskWithPrompt(prompt: string | null = "Fix the failing tests") {
    const projectId = await insertProject();
    cleanup.push(projectId);
    const res = await request(app)
      .post("/api/tasks")
      .send({ projectId, title: `autotrigger-${randomUUID().slice(0, 6)}`, priority: "p2" });
    expect(res.status).toBe(201);
    const taskId: string = res.body.id;
    if (prompt !== null) {
      await db.update(tasksTable).set({ prompt }).where(eq(tasksTable.id, taskId));
    }
    return { projectId, taskId };
  }

  it("execute route: schedules AI when task enters verifying with a prompt", async () => {
    const { taskId } = await createTaskWithPrompt("Fix the auth middleware");

    const res = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");

    expect(mockScheduleAiTaskExecution).toHaveBeenCalledOnce();
    const [taskGeneration] = await db.select({
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    }).from(tasksTable).where(eq(tasksTable.id, taskId));
    expect(mockScheduleAiTaskExecution).toHaveBeenCalledWith(
      taskId,
      "test-user",
      undefined,
      taskGeneration!.retryCount,
      taskGeneration!.correlationId,
    );
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intent?.payload).toMatchObject({
      userId: "test-user",
      taskRetryCount: 0,
      taskCorrelationId: taskGeneration!.correlationId,
    });
  });

  it("execute route: does NOT schedule AI when task enters verifying without a prompt", async () => {
    const { taskId } = await createTaskWithPrompt(null);

    const res = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");

    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`)))
      .resolves.toHaveLength(0);
  });

  it("PATCH route: schedules AI when status is manually set to verifying with a prompt", async () => {
    const { taskId } = await createTaskWithPrompt("Refactor the DB layer");

    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verifying");

    expect(mockScheduleAiTaskExecution).toHaveBeenCalledOnce();
    const [taskGeneration] = await db.select({
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    }).from(tasksTable).where(eq(tasksTable.id, taskId));
    expect(mockScheduleAiTaskExecution).toHaveBeenCalledWith(
      taskId,
      "test-user",
      undefined,
      taskGeneration!.retryCount,
      taskGeneration!.correlationId,
    );
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intent?.payload).toMatchObject({
      userId: "test-user",
      taskRetryCount: 0,
      taskCorrelationId: taskGeneration!.correlationId,
    });
  });

  it("rejects a Task transition when its generation is bound to another user", async () => {
    const { projectId, taskId } = await createTaskWithPrompt("Keep the existing dispatch identity");
    const [taskGeneration] = await db.select({
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    }).from(tasksTable).where(eq(tasksTable.id, taskId));
    const originalIntentPayload = {
      userId: "original-user",
      taskRetryCount: taskGeneration!.retryCount,
      taskCorrelationId: taskGeneration!.correlationId,
      attemptCount: 0,
      nextAttemptAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    await db.insert(eventsTable).values({
      id: `task-auto-execution-deferred:${taskId}`,
      type: "TaskAutoExecutionDeferred",
      projectId,
      taskId,
      severity: "warning",
      message: "Existing dispatch identity",
      payload: originalIntentPayload,
    });

    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("task_dispatch_identity_conflict");
    const [task] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId));
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(task?.status).toBe("pending");
    expect(intent).toMatchObject({
      type: "TaskAutoExecutionDeferred",
      projectId,
      taskId,
      severity: "warning",
    });
    expect(intent?.payload).toEqual(originalIntentPayload);
    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
  });

  it("PATCH route: does NOT schedule AI when status is set to verifying but prompt is null", async () => {
    const { taskId } = await createTaskWithPrompt(null);

    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(res.status).toBe(200);

    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
    await expect(db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`)))
      .resolves.toHaveLength(0);
  });

  it("PATCH route: does NOT schedule AI when status changes to something other than verifying", async () => {
    const { taskId } = await createTaskWithPrompt("Some prompt");

    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "completed" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invalid_task_transition");
    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
  });

  it("commits the dispatch intent before the local queue wake-up", async () => {
    const { taskId } = await createTaskWithPrompt("Recover after a queue wake-up failure");
    mockScheduleAiTaskExecution.mockRejectedValueOnce(new Error("simulated wake-up failure"));

    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });

    expect(response.status).toBe(500);
    const [task] = await db.select({ status: tasksTable.status })
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId));
    const [intent] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(task?.status).toBe("verifying");
    expect(intent?.payload).toMatchObject({ userId: "test-user", taskRetryCount: 0 });
  });

  it("retires the dispatch intent atomically when a verifying Task is deleted", async () => {
    const { projectId, taskId } = await createTaskWithPrompt("Delete an unclaimed Task generation");

    const transition = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(transition.status).toBe(200);
    const [intentBeforeDelete] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intentBeforeDelete).toBeTruthy();

    const deleted = await request(app).delete(`/api/tasks/${taskId}`);
    expect(deleted.status).toBe(204);

    const [intentAfterDelete] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intentAfterDelete).toBeUndefined();
    const deletedEvent = (await db.select().from(eventsTable)
      .where(eq(eventsTable.projectId, projectId)))
      .find((event) => event.type === "TaskDeleted");
    expect(deletedEvent?.taskId).toBeNull();
  });

  it("retires the dispatch intent in the same transaction when a verifying Task is rolled back", async () => {
    const { taskId } = await createTaskWithPrompt("Cancel an unclaimed Task generation");

    const transition = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(transition.status).toBe(200);
    const [intentBeforeRollback] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intentBeforeRollback).toBeTruthy();

    const rollback = await request(app).post(`/api/tasks/${taskId}/rollback`);
    expect(rollback.status).toBe(200);
    expect(rollback.body.status).toBe("cancelled");

    const [intentAfterRollback] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(intentAfterRollback).toBeUndefined();
  });
});
