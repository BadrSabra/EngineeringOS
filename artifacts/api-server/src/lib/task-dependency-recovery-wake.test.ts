import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { wakeDeferredTaskRecoveryAcceptances } from "./task-dependency-recovery-wake.js";

const projectIds: string[] = [];

async function createProject(): Promise<string> {
  const projectId = `task-recovery-dependency-wake-${randomUUID()}`;
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "task-recovery-dependency-wake-test",
    name: "Task recovery dependency wake test",
    rootPath: `/tmp/${projectId}`,
    language: "typescript",
    status: "active",
  });
  return projectId;
}

async function insertRecoveryCandidate(input: {
  projectId: string;
  taskId: string;
  correlationId: string;
  retryAt: string;
}) {
  const executionId = randomUUID();
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId: input.projectId,
    linkedTaskId: input.taskId,
    userId: "task-recovery-dependency-wake-test",
    operationId: executionId,
    idempotencyKey: `${input.taskId}:attempt:0`,
    correlationId: input.correlationId,
    attempt: 0,
    resumeTokenHash: "task-recovery-dependency-wake-test-hash",
    request: JSON.stringify({
      projectId: input.projectId,
      turnIntent: "DELIVERY",
      message: "Complete the dependent task",
      modelMessage: "Complete the dependent task",
      validationTargetPaths: [],
      proofRequired: true,
    }),
    checkpoint: "{}",
    status: "failed",
  });
  const acceptanceId = randomUUID();
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId,
    projectId: input.projectId,
    attempt: 0,
    finalizationKey: `task-recovery-dependency-wake:${executionId}:0`,
    operationId: executionId,
    terminalStatus: "failed",
    outcome: "FAILED",
    reasonCode: "EXECUTION_FAILED",
    nextActionCode: "RETRY_AFTER_TIMEOUT",
    disposition: {
      recoveryState: "REQUIRED",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
      dependencyRetryAt: input.retryAt,
      dependencyBlockerReasons: ["dependency_not_completed"],
    },
    evidenceRequired: 1,
    evidenceComplete: 0,
    resumable: 0,
  });
  return acceptanceId;
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    const executions = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, projectId));
    for (const execution of executions) {
      await db.delete(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, execution.id));
    }
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId));
    await db.delete(tasksTable).where(eq(tasksTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("autonomous Task recovery dependency wake", () => {
  it("wakes only current recoveries whose complete direct prerequisite set is now satisfied", async () => {
    const projectId = await createProject();
    const completedPrerequisiteId = randomUUID();
    const stillPendingPrerequisiteId = randomUUID();
    const readyChildId = randomUUID();
    const blockedChildId = randomUUID();
    const unrelatedChildId = randomUUID();
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    await db.insert(tasksTable).values([
      {
        id: completedPrerequisiteId,
        projectId,
        title: "Completed prerequisite",
        prompt: "Produce prerequisite output",
        status: "completed",
        dependsOn: [],
      },
      {
        id: stillPendingPrerequisiteId,
        projectId,
        title: "Still pending prerequisite",
        prompt: "Produce the second prerequisite output",
        status: "pending",
        dependsOn: [],
      },
      {
        id: readyChildId,
        projectId,
        title: "Ready recovery child",
        prompt: "Continue after the prerequisite",
        status: "verifying",
        correlationId: "ready-child-correlation",
        retryCount: 0,
        maxRetries: 2,
        dependsOn: [completedPrerequisiteId],
      },
      {
        id: blockedChildId,
        projectId,
        title: "Child with another pending prerequisite",
        prompt: "Wait for both prerequisites",
        status: "verifying",
        correlationId: "blocked-child-correlation",
        retryCount: 0,
        maxRetries: 2,
        dependsOn: [completedPrerequisiteId, stillPendingPrerequisiteId],
      },
      {
        id: unrelatedChildId,
        projectId,
        title: "Unrelated recovery child",
        prompt: "Remain deferred",
        status: "verifying",
        correlationId: "unrelated-child-correlation",
        retryCount: 0,
        maxRetries: 2,
        dependsOn: [],
      },
    ]);

    const readyAcceptanceId = await insertRecoveryCandidate({
      projectId,
      taskId: readyChildId,
      correlationId: "ready-child-correlation",
      retryAt,
    });
    const blockedAcceptanceId = await insertRecoveryCandidate({
      projectId,
      taskId: blockedChildId,
      correlationId: "blocked-child-correlation",
      retryAt,
    });
    const unrelatedAcceptanceId = await insertRecoveryCandidate({
      projectId,
      taskId: unrelatedChildId,
      correlationId: "unrelated-child-correlation",
      retryAt,
    });

    await expect(db.transaction((tx) => wakeDeferredTaskRecoveryAcceptances(tx, {
      completedTaskId: completedPrerequisiteId,
      projectId,
    }))).resolves.toBe(1);

    const [ready] = await db.select({ disposition: aiExecutionAcceptancesTable.disposition })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, readyAcceptanceId));
    const [blocked] = await db.select({ disposition: aiExecutionAcceptancesTable.disposition })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, blockedAcceptanceId));
    const [unrelated] = await db.select({ disposition: aiExecutionAcceptancesTable.disposition })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, unrelatedAcceptanceId));

    const readyDisposition = ready?.disposition && typeof ready.disposition === "object"
      ? ready.disposition as Record<string, unknown>
      : {};
    const blockedDisposition = blocked?.disposition && typeof blocked.disposition === "object"
      ? blocked.disposition as Record<string, unknown>
      : {};
    const unrelatedDisposition = unrelated?.disposition && typeof unrelated.disposition === "object"
      ? unrelated.disposition as Record<string, unknown>
      : {};

    expect(Date.parse(String(readyDisposition.dependencyRetryAt)))
      .toBeLessThanOrEqual(Date.now() + 5_000);
    expect(readyDisposition.dependencyBlockerReasons).toEqual(["dependency_not_completed"]);
    expect(blockedDisposition.dependencyRetryAt).toBe(retryAt);
    expect(unrelatedDisposition.dependencyRetryAt).toBe(retryAt);

    await expect(db.transaction((tx) => wakeDeferredTaskRecoveryAcceptances(tx, {
      completedTaskId: completedPrerequisiteId,
      projectId,
    }))).resolves.toBe(0);
  });
});
