import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import * as aiRouteHelpers from "../lib/ai-route-helpers.js";
import * as aiRateLimiter from "../lib/db-rate-limiter.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import {
  scheduleAiTaskExecution,
  waitForScheduledAiTaskExecutions,
} from "./ai/tasks.js";

const projectIds: string[] = [];

async function createProject(): Promise<string> {
  const projectId = `task-dependency-preflight-${randomUUID()}`;
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "task-dependency-preflight-test",
    name: "Task dependency preflight test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
  });
  return projectId;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId));
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("automatic Task dependency preflight", () => {
  it("defers dependency-blocked work before provider and rate-limit admission", async () => {
    const projectId = await createProject();
    const prerequisiteId = randomUUID();
    const taskId = randomUUID();
    const userId = "task-dependency-preflight-test";

    await db.insert(tasksTable).values([
      {
        id: prerequisiteId,
        projectId,
        title: "Pending prerequisite",
        status: "pending",
        prompt: "Complete the prerequisite first",
        dependsOn: [],
      },
      {
        id: taskId,
        projectId,
        title: "Blocked dependent task",
        status: "verifying",
        prompt: "Run after the prerequisite is complete",
        dependsOn: [prerequisiteId],
      },
    ]);
    const [generation] = await db.select({
      retryCount: tasksTable.retryCount,
      correlationId: tasksTable.correlationId,
    }).from(tasksTable).where(eq(tasksTable.id, taskId));

    const queuedJobs: Array<{ id: string; run: () => Promise<void> }> = [];
    vi.spyOn(heavyJobQueue, "enqueueWithIdDetailed")
      .mockImplementation((id, run) => {
        queuedJobs.push({ id, run });
        return "enqueued";
      });
    const providerSpy = vi.spyOn(aiRouteHelpers, "resolveProvider")
      .mockResolvedValue({
        provider: "groq",
        apiKey: "test-only-key",
        source: "user",
      });
    const rateLimitSpy = vi.spyOn(aiRateLimiter, "checkProjectRateLimitDb")
      .mockResolvedValue({ allowed: true });

    await scheduleAiTaskExecution(
      taskId,
      userId,
      undefined,
      generation!.retryCount,
      generation!.correlationId,
    );
    expect(queuedJobs).toHaveLength(1);

    await queuedJobs[0]!.run();
    await waitForScheduledAiTaskExecutions();

    expect(providerSpy).not.toHaveBeenCalled();
    expect(rateLimitSpy).not.toHaveBeenCalled();

    const [deferred] = await db.select().from(eventsTable)
      .where(eq(eventsTable.id, `task-auto-execution-deferred:${taskId}`));
    expect(deferred).toMatchObject({
      type: "TaskAutoExecutionDeferred",
      taskId,
      payload: {
        userId,
        taskRetryCount: generation!.retryCount,
        taskCorrelationId: generation!.correlationId,
        lastFailureCode: "task_dependencies_not_completed",
      },
    });
    expect(Date.parse(String(deferred?.payload?.nextAttemptAt ?? ""))).toBeGreaterThan(Date.now());

    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.linkedTaskId, taskId));
    expect(executions).toHaveLength(0);
  });
});
