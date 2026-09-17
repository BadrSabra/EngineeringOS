import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiChatSessionsTable,
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
const runChatExecutionRecovery = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  statusCode: 200,
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
  runChatExecutionRecovery,
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

async function insertChatFixture() {
  const projectId = randomUUID();
  const executionId = randomUUID();
  const sessionId = randomUUID();
  const now = new Date();
  const workspaceRevision = now.toISOString();

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "recovery-chat-test-user",
    name: `recovery-chat-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/recovery-chat-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Recoverable chat",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    sessionId,
    operationId: executionId,
    userId: "recovery-chat-test-user",
    idempotencyKey: `${executionId}:attempt:0`,
    correlationId: executionId,
    attempt: 0,
    resumeTokenHash: "test-chat-resume-token-hash",
    request: JSON.stringify({
      projectId,
      turnIntent: "PROJECT_QUERY",
      sessionId,
      message: "Explain the project flow",
      modelMessage: "Explain the project flow",
      workspaceRevision,
      validationTargetPaths: [],
      proofRequired: true,
      resumeContract: {
        taskType: "BEHAVIOR_QUERY",
        outputContract: "BEHAVIOR_ANSWER",
        contextProfile: "project_query",
        sessionId,
        projectRevision: workspaceRevision,
        requiresEvidence: true,
        scope: { projectId, rootPath: null, linkedTaskId: null },
      },
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
    finalizationKey: `recovery-chat-test:${executionId}:0`,
    operationId: executionId,
    terminalStatus: "failed",
    outcome: "FAILED",
    reasonCode: "EXECUTION_PROVIDER_FAILURE",
    nextActionCode: "RESUME_ALLOWED",
    disposition: {
      recoveryState: "REQUIRED",
      nextActionCode: "RESUME_ALLOWED",
    },
    evidenceRequired: 1,
    evidenceComplete: 0,
    resumable: 1,
    sourceRevision: workspaceRevision,
    createdAt: now,
  });
  return { projectId, executionId, sessionId };
}

async function insertParserChatFixture() {
  const fixture = await insertChatFixture();
  await db.update(aiExecutionsTable)
    .set({
      request: JSON.stringify({
        projectId: fixture.projectId,
        turnIntent: "CHAT",
        sessionId: fixture.sessionId,
        message: "Explain this",
        modelMessage: "Explain this",
        validationTargetPaths: [],
      }),
    })
    .where(eq(aiExecutionsTable.id, fixture.executionId));
  await db.update(aiExecutionAcceptancesTable)
    .set({
      reasonCode: "MODEL_OUTPUT_INVALID",
      nextActionCode: "RESUME_ALLOWED",
      disposition: {
        recoveryState: "REQUIRED",
        nextActionCode: "RESUME_ALLOWED",
      },
      resumable: 1,
    })
    .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
  return fixture;
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

describe("durable automatic conversational recovery", () => {
  afterEach(() => {
    runChatExecutionRecovery.mockClear();
    queuedJobs.length = 0;
    queuedIds.clear();
  });

  it("dispatches an eligible proof-backed chat turn once without routing it through task lifecycle", async () => {
    const fixture = await insertChatFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries(),
        dispatchAutonomousTaskRecoveries(),
      ]);
      expect(first + second).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await queuedJobs[0]!.run();

      expect(runChatExecutionRecovery).toHaveBeenCalledTimes(1);
      expect(runChatExecutionRecovery).toHaveBeenCalledWith({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        mode: "resume",
      });
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("dispatches one bounded automatic retry for an ordinary chat parse failure", async () => {
    const fixture = await insertParserChatFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries(),
        dispatchAutonomousTaskRecoveries(),
      ]);
      expect(first + second).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await queuedJobs[0]!.run();

      expect(runChatExecutionRecovery).toHaveBeenCalledTimes(1);
      expect(runChatExecutionRecovery).toHaveBeenCalledWith({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        mode: "resume",
      });
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });
});