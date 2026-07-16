import { afterEach, describe, expect, it } from "vitest";
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
