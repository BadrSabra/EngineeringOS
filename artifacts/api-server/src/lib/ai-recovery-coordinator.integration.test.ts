import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import { settleExhaustedExecutionRecovery } from "./ai-execution-acceptance.js";
import { recoverAiExecutionResumeToken } from "./ai-execution-state.js";

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
const runChatRecoveryExhaustionFinalization = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  readCount: 2,
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
  runChatRecoveryExhaustionFinalization,
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
    correlationId: executionId,
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
    operationId: executionId,
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

async function insertProviderFailureChatFixture() {
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
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
      disposition: {
        recoveryState: "REQUIRED",
        nextActionCode: "RETRY_AFTER_TIMEOUT",
      },
      resumable: 0,
    })
    .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
  return fixture;
}

async function cleanupRecoveryFixtures() {
  const owners = ["recovery-test-user", "recovery-chat-test-user"];
  const projects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(inArray(projectsTable.ownerId, owners));
  const projectIds = projects.map(({ id }) => id);
  if (projectIds.length === 0) return;

  await db.delete(aiExecutionAcceptancesTable)
    .where(inArray(aiExecutionAcceptancesTable.projectId, projectIds));
  await db.delete(aiChatMessagesTable)
    .where(inArray(aiChatMessagesTable.sessionId,
      db.select({ id: aiChatSessionsTable.id })
        .from(aiChatSessionsTable)
        .where(inArray(aiChatSessionsTable.projectId, projectIds)),
    ));
  await db.delete(aiExecutionsTable)
    .where(inArray(aiExecutionsTable.projectId, projectIds));
  await db.delete(tasksTable)
    .where(inArray(tasksTable.projectId, projectIds));
  await db.delete(aiChatSessionsTable)
    .where(inArray(aiChatSessionsTable.projectId, projectIds));
  await db.delete(projectsTable)
    .where(inArray(projectsTable.id, projectIds));
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return postgresErrorCode(candidate.cause);
}

describe("durable automatic task recovery", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    queuedJobs.length = 0;
    queuedIds.clear();
    await cleanupRecoveryFixtures();
  });

  it("deduplicates concurrent dispatch and atomically advances the retry budget", async () => {
    const fixture = await insertFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
      ]);
      expect(first + second).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await queuedJobs[0]!.run();

      const [task] = await db
        .select({
          retryCount: tasksTable.retryCount,
          correlationId: tasksTable.correlationId,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, fixture.taskId));
      expect(task?.retryCount).toBe(1);
      expect(task?.correlationId).toEqual(expect.any(String));
      expect(task?.correlationId).not.toBe(fixture.executionId);
      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(0);
      expect(queuedJobs).toHaveLength(1);
      expect(executeTaskLifecycle).toHaveBeenCalledTimes(1);
      expect(executeTaskLifecycle).toHaveBeenCalledWith(expect.objectContaining({
        taskId: fixture.taskId,
        userId: "recovery-test-user",
        trigger: "reconciliation",
        expectedStatuses: ["pending", "queued", "verifying"],
        expectedRetryCount: 1,
      }));
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("does not consume a queued retry after its acceptance decision changes", async () => {
    const fixture = await insertFixture();
    try {
      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await db.update(aiExecutionAcceptancesTable)
        .set({
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
          reasonCode: "EXECUTION_COMPLETED",
          nextActionCode: "NONE",
          disposition: {
            recoveryState: "COMPLETE",
            nextActionCode: "NONE",
          },
        })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      await queuedJobs[0]!.run();

      const [task] = await db
        .select({
          retryCount: tasksTable.retryCount,
          correlationId: tasksTable.correlationId,
        })
        .from(tasksTable)
        .where(eq(tasksTable.id, fixture.taskId));
      expect(task).toMatchObject({
        retryCount: 0,
        correlationId: fixture.executionId,
      });
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("does not consume a queued retry for a replaced acceptance row", async () => {
    const fixture = await insertFixture();
    try {
      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await db.update(aiExecutionAcceptancesTable)
        .set({ finalizationKey: `recovery-replaced:${fixture.executionId}:0` })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      await queuedJobs[0]!.run();

      const [task] = await db
        .select({ retryCount: tasksTable.retryCount })
        .from(tasksTable)
        .where(eq(tasksTable.id, fixture.taskId));
      expect(task?.retryCount).toBe(0);
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("holds the accepted resume decision locked until resume-token recovery commits", async () => {
    const fixture = await insertFixture();
    try {
      await db.update(aiExecutionsTable)
        .set({ status: "paused" })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({
          reasonCode: "EXECUTION_INTERRUPTED",
          nextActionCode: "RESUME_ALLOWED",
          disposition: {
            recoveryState: "REQUIRED",
            nextActionCode: "RESUME_ALLOWED",
          },
          resumable: 1,
        })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      await db.transaction(async (tx) => {
        const recovered = await recoverAiExecutionResumeToken({
          executionId: fixture.executionId,
          userId: "recovery-test-user",
          linkedTaskId: fixture.taskId,
          expectedAttempt: 0,
          transaction: tx,
        });
        expect(recovered).toBeDefined();

        let competingUpdateError: unknown;
        try {
          await db.transaction(async (competingTx) => {
            await competingTx.execute(sql`SET LOCAL lock_timeout = '200ms'`);
            await competingTx.update(aiExecutionAcceptancesTable)
              .set({ nextActionCode: "NONE" })
              .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
          });
        } catch (error) {
          competingUpdateError = error;
        }

        expect(postgresErrorCode(competingUpdateError)).toBe("55P03");
      });

      const [acceptance] = await db.select({
        nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      expect(acceptance?.nextActionCode).toBe("RESUME_ALLOWED");
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("carries the captured retry generation into an automatic resume", async () => {
    const fixture = await insertFixture();
    try {
      await db.update(tasksTable)
        .set({ status: "queued", retryCount: 1 })
        .where(eq(tasksTable.id, fixture.taskId));
      await db.update(aiExecutionsTable)
        .set({ status: "paused" })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({
          reasonCode: "EXECUTION_INTERRUPTED",
          nextActionCode: "RESUME_ALLOWED",
          disposition: {
            recoveryState: "REQUIRED",
            nextActionCode: "RESUME_ALLOWED",
          },
          resumable: 1,
          sourceRevision: "workspace-tree-v1:" + "a".repeat(64),
        })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(1);
      expect(queuedJobs).toHaveLength(1);
      await queuedJobs[0]!.run();

      expect(executeTaskLifecycle).toHaveBeenCalledWith(expect.objectContaining({
        taskId: fixture.taskId,
        resumeExecutionId: fixture.executionId,
        expectedRetryCount: 1,
      }));
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("skips a queued resume when the Task retry generation has advanced", async () => {
    const fixture = await insertFixture();
    try {
      await db.update(tasksTable)
        .set({ status: "queued" })
        .where(eq(tasksTable.id, fixture.taskId));
      await db.update(aiExecutionsTable)
        .set({ status: "paused" })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({
          reasonCode: "EXECUTION_INTERRUPTED",
          nextActionCode: "RESUME_ALLOWED",
          disposition: {
            recoveryState: "REQUIRED",
            nextActionCode: "RESUME_ALLOWED",
          },
          resumable: 1,
        })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await db.update(tasksTable)
        .set({ retryCount: 2 })
        .where(eq(tasksTable.id, fixture.taskId));
      await queuedJobs[0]!.run();

      expect(executeTaskLifecycle).not.toHaveBeenCalled();
      const [execution] = await db
        .select({ resumeTokenHash: aiExecutionsTable.resumeTokenHash })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      expect(execution?.resumeTokenHash).toBe("test-resume-token-hash");
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("dispatches only the execution currently bound to the Task", async () => {
    const fixture = await insertFixture();
    const supersededExecutionId = randomUUID();
    const newerAcceptanceAt = new Date(Date.now() + 10_000);
    try {
      await db.insert(aiExecutionsTable).values({
        id: supersededExecutionId,
        projectId: fixture.projectId,
        linkedTaskId: fixture.taskId,
        userId: "recovery-test-user",
        idempotencyKey: `${fixture.taskId}:superseded:${supersededExecutionId}`,
        correlationId: supersededExecutionId,
        attempt: 0,
        resumeTokenHash: "superseded-resume-token-hash",
        request: JSON.stringify({
          projectId: fixture.projectId,
          turnIntent: "DELIVERY",
          message: "Superseded bounded recovery",
          modelMessage: "Superseded bounded recovery",
          validationTargetPaths: [],
          proofRequired: true,
        }),
        checkpoint: "{}",
        status: "failed",
        createdAt: newerAcceptanceAt,
        updatedAt: newerAcceptanceAt,
      });
      await db.insert(aiExecutionAcceptancesTable).values({
        id: randomUUID(),
        executionId: supersededExecutionId,
        projectId: fixture.projectId,
        attempt: 0,
        finalizationKey: `recovery-superseded:${supersededExecutionId}:0`,
        operationId: supersededExecutionId,
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
        sourceRevision: newerAcceptanceAt.toISOString(),
        createdAt: newerAcceptanceAt,
      });

      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(1);
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0]?.id).toBe(
        `ai-recovery:${fixture.taskId}:${fixture.executionId}:0:retry:0`,
      );
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, supersededExecutionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, supersededExecutionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });
});

describe("durable automatic conversational recovery", () => {
  afterEach(async () => {
    runChatExecutionRecovery.mockClear();
    runChatRecoveryExhaustionFinalization.mockClear();
    queuedJobs.length = 0;
    queuedIds.clear();
    await cleanupRecoveryFixtures();
  });

  it("dispatches an eligible proof-backed chat turn once without routing it through task lifecycle", async () => {
    const fixture = await insertChatFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
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

  it("dispatches a bounded automatic retry for an ordinary chat parse failure", async () => {
    const fixture = await insertParserChatFixture();
    try {
      const [first, second] = await Promise.all([
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
        dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId }),
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

  it("dispatches a bounded automatic retry for an ordinary chat provider failure", async () => {
    const fixture = await insertProviderFailureChatFixture();
    try {
      const dispatched = await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId });

      expect(dispatched).toBe(1);
      expect(queuedJobs).toHaveLength(1);

      await queuedJobs[0]!.run();

      expect(runChatExecutionRecovery).toHaveBeenCalledTimes(1);
      expect(runChatExecutionRecovery).toHaveBeenCalledWith({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        mode: "retry",
      });
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("ignores a stale Task acceptance after the execution advances to a later attempt", async () => {
    const fixture = await insertFixture();
    try {
      await db.update(aiExecutionsTable)
        .set({ attempt: 1 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.insert(aiExecutionAcceptancesTable).values({
        id: randomUUID(),
        executionId: fixture.executionId,
        projectId: fixture.projectId,
        attempt: 1,
        finalizationKey: `recovery-task-stale-attempt:${fixture.executionId}:1`,
        operationId: fixture.executionId,
        terminalStatus: "failed",
        outcome: "FAILED",
        reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
        nextActionCode: "ABANDON_EXECUTION",
        disposition: {
          recoveryState: "INCOMPLETE",
          nextActionCode: "ABANDON_EXECUTION",
        },
        evidenceRequired: 1,
        evidenceComplete: 0,
        resumable: 0,
        sourceRevision: null,
        createdAt: new Date(),
      });

      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(0);
      expect(queuedJobs).toHaveLength(0);

      const [task] = await db.select({
        status: tasksTable.status,
        retryCount: tasksTable.retryCount,
        correlationId: tasksTable.correlationId,
      }).from(tasksTable)
        .where(eq(tasksTable.id, fixture.taskId));
      expect(task).toMatchObject({
        status: "verifying",
        retryCount: 0,
        correlationId: fixture.executionId,
      });
      expect(executeTaskLifecycle).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(tasksTable).where(eq(tasksTable.id, fixture.taskId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("ignores a stale acceptance after the execution advances to a later attempt", async () => {
    const fixture = await insertProviderFailureChatFixture();
    try {
      await db.update(aiExecutionsTable)
        .set({ attempt: 1 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.insert(aiExecutionAcceptancesTable).values({
        id: randomUUID(),
        executionId: fixture.executionId,
        projectId: fixture.projectId,
        attempt: 1,
        finalizationKey: `recovery-chat-stale-attempt:${fixture.executionId}:1`,
        operationId: fixture.executionId,
        terminalStatus: "failed",
        outcome: "FAILED",
        reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
        nextActionCode: "ABANDON_EXECUTION",
        disposition: {
          recoveryState: "INCOMPLETE",
          nextActionCode: "ABANDON_EXECUTION",
        },
        evidenceRequired: 1,
        evidenceComplete: 0,
        resumable: 0,
        sourceRevision: null,
        createdAt: new Date(),
      });

      expect(await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId })).toBe(0);
      expect(queuedJobs).toHaveLength(0);
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("finalizes exhausted evidence-backed recovery without scheduling another provider call", async () => {
    const fixture = await insertChatFixture();
    try {
      await db.update(aiExecutionsTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      const dispatched = await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId });

      expect(dispatched).toBe(1);
      expect(queuedJobs).toHaveLength(1);
      expect(queuedJobs[0]?.id).toBe(
        `ai-recovery:chat:${fixture.executionId}:3:recovery-finalize`,
      );

      await queuedJobs[0]!.run();

      expect(runChatRecoveryExhaustionFinalization).toHaveBeenCalledWith({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        expectedAttempt: 3,
      });
      expect(runChatExecutionRecovery).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("finalizes exhausted ordinary chat recovery without scheduling another provider call", async () => {
    const fixture = await insertProviderFailureChatFixture();
    try {
      await db.update(aiExecutionsTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      const dispatched = await dispatchAutonomousTaskRecoveries({ projectId: fixture.projectId });

      expect(dispatched).toBe(1);
      expect(queuedJobs[0]?.id).toBe(
        `ai-recovery:chat:${fixture.executionId}:3:recovery-finalize`,
      );

      await queuedJobs[0]!.run();

      expect(runChatRecoveryExhaustionFinalization).toHaveBeenCalledWith({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        expectedAttempt: 3,
      });
      expect(runChatExecutionRecovery).not.toHaveBeenCalled();
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("settles the existing execution, acceptance, and assistant message atomically", async () => {
    const fixture = await insertChatFixture();
    const messageId = randomUUID();
    try {
      await db.insert(aiChatMessagesTable).values({
        id: messageId,
        sessionId: fixture.sessionId,
        role: "assistant",
        content: "provider failed",
        turnIntent: "PROJECT_QUERY",
        executionId: fixture.executionId,
        outcome: "FAILED",
        errorCode: "EXECUTION_PROVIDER_FAILURE",
        errorMessage: "provider unavailable",
        createdAt: new Date(),
      });
      await db.update(aiExecutionsTable)
        .set({ attempt: 3, finalMessageId: messageId })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      const params = {
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        expectedAttempt: 3,
        finalMessageId: messageId,
        content: "ANALYSIS_INCOMPLETE — no verified conclusion was accepted.",
        errorMessage: "Recovery budget exhausted.",
        evidenceReason: "The bounded recovery budget was exhausted.",
        nextActionCode: "REVIEW_INCOMPLETE_EVIDENCE" as const,
        evidenceVerdict: "PARTIAL" as const,
      };
      expect(await settleExhaustedExecutionRecovery(params)).toEqual({ settled: true });
      expect(await settleExhaustedExecutionRecovery(params)).toEqual({ settled: true });

      const [execution] = await db
        .select({
          status: aiExecutionsTable.status,
          finalMessageId: aiExecutionsTable.finalMessageId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      const [acceptance] = await db
        .select({
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          recoveryState: aiExecutionAcceptancesTable.disposition,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      const messages = await db
        .select({
          id: aiChatMessagesTable.id,
          content: aiChatMessagesTable.content,
        })
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.executionId, fixture.executionId));

      expect(execution).toEqual({
        status: "failed",
        finalMessageId: messageId,
      });
      expect(acceptance?.reasonCode).toBe("EXECUTION_ACCEPTANCE_INCOMPLETE");
      expect(acceptance?.nextActionCode).toBe("REVIEW_INCOMPLETE_EVIDENCE");
      expect(messages).toEqual([{
        id: messageId,
        content: "ANALYSIS_INCOMPLETE — no verified conclusion was accepted.",
      }]);
    } finally {
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });

  it("does not settle a newer attempt from a stale exhaustion callback", async () => {
    const fixture = await insertChatFixture();
    const messageId = randomUUID();
    try {
      await db.insert(aiChatMessagesTable).values({
        id: messageId,
        sessionId: fixture.sessionId,
        role: "assistant",
        content: "provider failed on the newer attempt",
        turnIntent: "PROJECT_QUERY",
        executionId: fixture.executionId,
        outcome: "FAILED",
        errorCode: "EXECUTION_PROVIDER_FAILURE",
        errorMessage: "provider unavailable",
        createdAt: new Date(),
      });
      await db.update(aiExecutionsTable)
        .set({ attempt: 3, finalMessageId: messageId })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.update(aiExecutionAcceptancesTable)
        .set({ attempt: 3 })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

      const [executionBefore] = await db.select({
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        finalMessageId: aiExecutionsTable.finalMessageId,
        checkpoint: aiExecutionsTable.checkpoint,
        checkpointVersion: aiExecutionsTable.checkpointVersion,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      const [acceptanceBefore] = await db.select({
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        reasonCode: aiExecutionAcceptancesTable.reasonCode,
        nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
        resumable: aiExecutionAcceptancesTable.resumable,
        disposition: aiExecutionAcceptancesTable.disposition,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      const [messageBefore] = await db.select({
        content: aiChatMessagesTable.content,
        outcome: aiChatMessagesTable.outcome,
        errorCode: aiChatMessagesTable.errorCode,
        errorMessage: aiChatMessagesTable.errorMessage,
      }).from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, messageId));

      const settled = await settleExhaustedExecutionRecovery({
        executionId: fixture.executionId,
        userId: "recovery-chat-test-user",
        expectedAttempt: 2,
        finalMessageId: messageId,
        content: "stale exhaustion result",
        errorMessage: "stale exhaustion result",
        evidenceReason: "stale callback",
      });

      expect(settled).toEqual({ settled: false, reason: "execution_attempt_changed" });
      const [executionAfter] = await db.select({
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        finalMessageId: aiExecutionsTable.finalMessageId,
        checkpoint: aiExecutionsTable.checkpoint,
        checkpointVersion: aiExecutionsTable.checkpointVersion,
      }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      const [acceptanceAfter] = await db.select({
        attempt: aiExecutionAcceptancesTable.attempt,
        outcome: aiExecutionAcceptancesTable.outcome,
        reasonCode: aiExecutionAcceptancesTable.reasonCode,
        nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
        resumable: aiExecutionAcceptancesTable.resumable,
        disposition: aiExecutionAcceptancesTable.disposition,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      const [messageAfter] = await db.select({
        content: aiChatMessagesTable.content,
        outcome: aiChatMessagesTable.outcome,
        errorCode: aiChatMessagesTable.errorCode,
        errorMessage: aiChatMessagesTable.errorMessage,
      }).from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, messageId));

      expect(executionAfter).toEqual(executionBefore);
      expect(acceptanceAfter).toEqual(acceptanceBefore);
      expect(messageAfter).toEqual(messageBefore);
    } finally {
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, fixture.executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, fixture.sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId));
    }
  });
});