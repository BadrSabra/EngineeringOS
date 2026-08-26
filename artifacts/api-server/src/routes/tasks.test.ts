import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  tasksTable,
  taskLogsTable,
  eventsTable,
  auditLogsTable,
} from "@workspace/db";
import { randomUUID } from "crypto";

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
    rootPath: "/tmp/task-test",
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
    await db.update(tasksTable).set({ status: "failed", maxRetries: 1 }).where(eq(tasksTable.id, taskId));

    const retried = await request(app).post(`/api/tasks/${taskId}/retry`);
    expect(retried.status).toBe(202);
    expect(retried.body.status).toBe("queued");
    expect(retried.body.retryCount).toBe(1);

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
      rootPath: "/tmp/other-user-tasks",
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
    expect(mockScheduleAiTaskExecution).toHaveBeenCalledWith(taskId, "test-user");
  });

  it("execute route: does NOT schedule AI when task enters verifying without a prompt", async () => {
    const { taskId } = await createTaskWithPrompt(null);

    const res = await request(app).post(`/api/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");

    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
  });

  it("PATCH route: schedules AI when status is manually set to verifying with a prompt", async () => {
    const { taskId } = await createTaskWithPrompt("Refactor the DB layer");

    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("verifying");

    expect(mockScheduleAiTaskExecution).toHaveBeenCalledOnce();
    expect(mockScheduleAiTaskExecution).toHaveBeenCalledWith(taskId, "test-user");
  });

  it("PATCH route: does NOT schedule AI when status is set to verifying but prompt is null", async () => {
    const { taskId } = await createTaskWithPrompt(null);

    const res = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .send({ status: "verifying" });
    expect(res.status).toBe(200);

    expect(mockScheduleAiTaskExecution).not.toHaveBeenCalled();
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
});
