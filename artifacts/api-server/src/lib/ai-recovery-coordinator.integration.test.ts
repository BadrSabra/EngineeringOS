import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";

const queuedJobs = vi.hoisted(() => [] as Array<{ id: string; run: () => Promise<void> }>);
const queuedIds = vi.hoisted(() => new Set<string>());
const executeTaskLifecycle = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  status: "completed" as const,
  executionId: "replacement-execution",
})));

vi.mock("./job-queue.js", () => ({
  heavyJobQueue: {
    enqueueWithId: vi.fn((id: string, run: () => Promise<void>) => {
      if (queuedIds.has(id)) return false;
      queuedIds.add(id);
      queuedJobs.push({ id, run });
      return true;
    }),
  },
}));

vi.mock("./ai-route-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./ai-route-helpers.js")>("./ai-route-helpers.js");
  return {
    ...actual,
    resolveProvider: vi.fn(async () => ({
      provider: "groq" as const,
      apiKey: "test-provider-key",
      source: "server" as const,
    })),
  };
});

vi.mock("./db-rate-limiter.js", () => ({
  checkProjectRateLimitDb: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));

vi.mock("./task-execution-service.js", () => ({
  executeTaskLifecycle,
}));

vi.mock("./chat-recovery-runner.js", () => ({
  runChatExecutionRecovery: vi.fn(async () => ({ ok: true, statusCode: 200 })),
}));

import { dispatchAutonomousTaskRecoveries } from "./ai-recovery-coordinator.js";

async function insertFixture() {
  const projectId = randomUUID();
  const taskId = randomUUID();
  const executionId = randomUUID();
  const now = new Date();

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "recovery-test-user",
    name: `recovery-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/recovery-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId,
    title: "Recoverable task",
    prompt: "Run the bounded recovery",
    status: "verifying",
    retryCount: 0,
    maxRetries: 2,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    linkedTaskId: taskId,
    userId: "recovery-test-user",
    idempotencyKey: `${taskId}:attempt:0`,
    correlationId: executionId,
    attempt: 0,
    resumeTokenHash: "test-resume-token-hash",
    request: JSON.stringify({
      projectId,
      turnIntent: "DELIVERY",
      message: "Run the bounded recovery",
      modelMessage: "Run the bounded recovery",
      validationTargetPaths: [],
      proofRequired: true,
    }),
    checkpoint: "{}",
    status: "failed",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: randomUUID(),
    executionId,
    projectId,
    attempt: 0,
    finalizationKey: `recovery-test:${executionId}:0`,
    operationId: executionId,
    terminalStatus: "failed",
    outcome: "FAILED",
    reasonCode: "EXECUTION_FAILED",
    nextActionCode: "RETRY_AFTER_TIMEOUT",
    disposition: {
      recoveryState: "REQUIRED",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
    },
    evidenceRequired: 1,
    evidenceComplete: 0,
    resumable: 0,
    sourceRevision: now.toISOString(),
    createdAt: now,
  });
  return { projectId, taskId, executionId };
}

describe("durable automatic task recovery", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    queuedJobs.length = 0;
    queuedIds.clear();
    await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.finalizationKey, "recovery-test:missing"));
  });

  it("deduplicates concurrent dispatch and atomically advances the retry budget", async () => {
    const fixture = await insertFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries(),
        dispatchAutonomousTaskRecoveries(),
      ]);
      expect(first + second).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await queuedJobs[0]!.run();

      const [task] = await db
        .select({ retryCount: tasksTable.retryCount })
        .from(tasksTable)
        .where(eq(tasksTable.id, fixture.taskId));
      expect(task?.retryCount).toBe(1);
      expect(executeTaskLifecycle).toHaveBeenCalledTimes(1);
      expect(executeTaskLifecycle).toHaveBeenCalledWith(expect.objectContaining({
        taskId: fixture.taskId,
        userId: "recovery-test-user",
        trigger: "reconciliation",
        expectedStatuses: ["pending", "queued", "verifying"],
      }));
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });
});