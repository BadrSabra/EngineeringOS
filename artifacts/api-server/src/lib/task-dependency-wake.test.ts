import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
  taskAutoExecutionIntentId,
} from "./task-auto-execution-outbox.js";
import {
  TASK_DEPENDENCY_WAKE_FAILURE_CODE,
  wakeDeferredTaskDependencyIntents,
} from "./task-dependency-wake.js";

const projectIds: string[] = [];

async function createProject(): Promise<string> {
  const projectId = `task-dependency-wake-${randomUUID()}`;
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "task-dependency-wake-test",
    name: "Task dependency wake test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
  });
  return projectId;
}

function deferredPayload(input: {
  retryCount: number;
  correlationId: string | null;
  nextAttemptAt: string;
  failureCode?: string;
}) {
  return {
    userId: "task-dependency-wake-test",
    taskRetryCount: input.retryCount,
    taskCorrelationId: input.correlationId,
    attemptCount: 2,
    nextAttemptAt: input.nextAttemptAt,
    lastFailureCode: input.failureCode ?? TASK_DEPENDENCY_WAKE_FAILURE_CODE,
  };
}

async function createFixture() {
  const projectId = await createProject();
  const completedTaskId = randomUUID();
  const readyChildId = randomUUID();
  const staleGenerationChildId = randomUUID();
  const staleCorrelationChildId = randomUUID();
  const otherDeferralChildId = randomUUID();
  const unrelatedChildId = randomUUID();
  const oldNextAttemptAt = new Date(Date.now() + 60_000).toISOString();

  await db.insert(tasksTable).values([
    {
      id: completedTaskId,
      projectId,
      title: "Completed prerequisite",
      status: "completed",
      prompt: "produce accepted output",
      dependsOn: [],
    },
    {
      id: readyChildId,
      projectId,
      title: "Current dependent",
      status: "verifying",
      prompt: "continue after prerequisite",
      retryCount: 2,
      correlationId: "child-correlation-current",
      dependsOn: [completedTaskId],
    },
    {
      id: staleGenerationChildId,
      projectId,
      title: "Stale generation",
      status: "verifying",
      prompt: "do not wake stale generation",
      retryCount: 3,
      correlationId: "child-correlation-stale",
      dependsOn: [completedTaskId],
    },
    {
      id: staleCorrelationChildId,
      projectId,
      title: "Stale correlation",
      status: "verifying",
      prompt: "do not wake stale correlation",
      retryCount: 1,
      correlationId: "child-correlation-current-row",
      dependsOn: [completedTaskId],
    },
    {
      id: otherDeferralChildId,
      projectId,
      title: "Other deferral",
      status: "verifying",
      prompt: "retain provider backoff",
      retryCount: 1,
      correlationId: "provider-correlation",
      dependsOn: [completedTaskId],
    },
    {
      id: unrelatedChildId,
      projectId,
      title: "Unrelated task",
      status: "verifying",
      prompt: "do not wake unrelated work",
      retryCount: 1,
      correlationId: "unrelated-correlation",
      dependsOn: [],
    },
  ]);

  await db.insert(eventsTable).values([
    {
      id: taskAutoExecutionIntentId(readyChildId),
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      projectId,
      taskId: readyChildId,
      message: "Waiting for a prerequisite",
      payload: deferredPayload({
        retryCount: 2,
        correlationId: "child-correlation-current",
        nextAttemptAt: oldNextAttemptAt,
      }),
      timestamp: new Date(Date.now() - 60_000),
    },
    {
      id: taskAutoExecutionIntentId(staleGenerationChildId),
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      projectId,
      taskId: staleGenerationChildId,
      message: "Stale retry generation",
      payload: deferredPayload({
        retryCount: 2,
        correlationId: "child-correlation-stale",
        nextAttemptAt: oldNextAttemptAt,
      }),
    },
    {
      id: taskAutoExecutionIntentId(staleCorrelationChildId),
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      projectId,
      taskId: staleCorrelationChildId,
      message: "Stale correlation",
      payload: deferredPayload({
        retryCount: 1,
        correlationId: "older-correlation",
        nextAttemptAt: oldNextAttemptAt,
      }),
    },
    {
      id: taskAutoExecutionIntentId(otherDeferralChildId),
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      projectId,
      taskId: otherDeferralChildId,
      message: "Provider retry",
      payload: deferredPayload({
        retryCount: 1,
        correlationId: "provider-correlation",
        nextAttemptAt: oldNextAttemptAt,
        failureCode: "PROJECT_RATE_LIMITED",
      }),
    },
  ]);

  return {
    projectId,
    completedTaskId,
    readyChildId,
    staleGenerationChildId,
    staleCorrelationChildId,
    otherDeferralChildId,
    oldNextAttemptAt,
  };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Task dependency wake", () => {
  it("does not wake a child until every direct prerequisite is completed", async () => {
    const projectId = await createProject();
    const firstPrerequisiteId = randomUUID();
    const secondPrerequisiteId = randomUUID();
    const childId = randomUUID();
    const correlationId = "child-multi-prerequisite-correlation";
    const oldNextAttemptAt = new Date(Date.now() + 60_000).toISOString();

    await db.insert(tasksTable).values([
      {
        id: firstPrerequisiteId,
        projectId,
        title: "First completed prerequisite",
        status: "completed",
        prompt: "produce the first accepted output",
        dependsOn: [],
      },
      {
        id: secondPrerequisiteId,
        projectId,
        title: "Second pending prerequisite",
        status: "queued",
        prompt: "produce the second accepted output",
        dependsOn: [],
      },
      {
        id: childId,
        projectId,
        title: "Task with two prerequisites",
        status: "verifying",
        prompt: "continue only after both prerequisites",
        retryCount: 4,
        correlationId,
        dependsOn: [firstPrerequisiteId, secondPrerequisiteId],
      },
    ]);
    await db.insert(eventsTable).values({
      id: taskAutoExecutionIntentId(childId),
      type: TASK_AUTO_EXECUTION_DEFERRED_EVENT_TYPE,
      projectId,
      taskId: childId,
      message: "Waiting for all prerequisites",
      payload: deferredPayload({
        retryCount: 4,
        correlationId,
        nextAttemptAt: oldNextAttemptAt,
      }),
      timestamp: new Date(),
    });

    const earlyTargets = await db.transaction((tx) => wakeDeferredTaskDependencyIntents(tx, {
      completedTaskId: firstPrerequisiteId,
      projectId,
    }));
    expect(earlyTargets).toEqual([]);

    const [stillDeferred] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(childId)));
    expect(stillDeferred?.payload?.nextAttemptAt).toBe(oldNextAttemptAt);

    await db.update(tasksTable)
      .set({ status: "completed" })
      .where(eq(tasksTable.id, secondPrerequisiteId));

    const readyTargets = await db.transaction((tx) => wakeDeferredTaskDependencyIntents(tx, {
      completedTaskId: secondPrerequisiteId,
      projectId,
    }));
    expect(readyTargets).toEqual([{
      taskId: childId,
      userId: "task-dependency-wake-test",
      retryCount: 4,
      correlationId,
    }]);

    const [woken] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(childId)));
    expect(Date.parse(String(woken?.payload?.nextAttemptAt))).toBeLessThan(
      Date.parse(oldNextAttemptAt),
    );
  });

  it("releases only current-generation intents deferred for incomplete dependencies", async () => {
    const fixture = await createFixture();

    const targets = await db.transaction((tx) => wakeDeferredTaskDependencyIntents(tx, {
      completedTaskId: fixture.completedTaskId,
      projectId: fixture.projectId,
    }));

    expect(targets).toEqual([{
      taskId: fixture.readyChildId,
      userId: "task-dependency-wake-test",
      retryCount: 2,
      correlationId: "child-correlation-current",
    }]);

    const [woken] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(fixture.readyChildId)));
    expect(Date.parse(String(woken?.payload?.nextAttemptAt))).toBeLessThan(
      Date.parse(fixture.oldNextAttemptAt),
    );
    expect(woken?.payload).toMatchObject({
      attemptCount: 2,
      lastFailureCode: TASK_DEPENDENCY_WAKE_FAILURE_CODE,
    });

    for (const taskId of [
      fixture.staleGenerationChildId,
      fixture.staleCorrelationChildId,
      fixture.otherDeferralChildId,
    ]) {
      const [unchanged] = await db.select({ payload: eventsTable.payload })
        .from(eventsTable)
        .where(eq(eventsTable.id, taskAutoExecutionIntentId(taskId)));
      expect(unchanged?.payload?.nextAttemptAt).toBe(fixture.oldNextAttemptAt);
    }
  });

  it("does not wake dependents until the prerequisite Task is completed", async () => {
    const fixture = await createFixture();
    await db.update(tasksTable)
      .set({ status: "running" })
      .where(eq(tasksTable.id, fixture.completedTaskId));

    const targets = await db.transaction((tx) => wakeDeferredTaskDependencyIntents(tx, {
      completedTaskId: fixture.completedTaskId,
      projectId: fixture.projectId,
    }));

    expect(targets).toEqual([]);
    const [intent] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(fixture.readyChildId)));
    expect(intent?.payload?.nextAttemptAt).toBe(fixture.oldNextAttemptAt);
  });

  it("rolls back the retry-window change with the parent acceptance transaction", async () => {
    const fixture = await createFixture();

    await expect(db.transaction(async (tx) => {
      await wakeDeferredTaskDependencyIntents(tx, {
        completedTaskId: fixture.completedTaskId,
        projectId: fixture.projectId,
      });
      throw new Error("fixture rollback");
    })).rejects.toThrow("fixture rollback");

    const [intent] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, taskAutoExecutionIntentId(fixture.readyChildId)));
    expect(intent?.payload?.nextAttemptAt).toBe(fixture.oldNextAttemptAt);
  });
});
