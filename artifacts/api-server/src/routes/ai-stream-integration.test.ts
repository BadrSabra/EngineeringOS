/**
 * INT-005 / INT-006 / INT-007 — SSE Stream Integration Tests
 *
 * Validates the POST /api/ai/chat/stream route end-to-end:
 *   INT-005  Success path  : stage → delta → done events streamed correctly
 *   INT-006  Error path    : provider failover surfaces a structured SSE error event
 *   INT-007  Fetch isolation: call counts confirm the resolver prevents unnecessary requests
 *
 * Strategy:
 *   • @workspace/ai-orchestrator is mocked (same shape as ai.test.ts) so no real
 *     Groq/OpenRouter keys are needed and no live AI calls are made.
 *   • ../lib/ai-route-helpers.js is mocked to control requireProvider and
 *     chatWithFallback independently per test.
 *   • All other infrastructure (DB, advisory locks, rate limiter) runs against
 *     the real test database — projects are inserted and cleaned up per test.
 *   • Supertest collects the complete SSE body after res.end(), which the route
 *     calls on both the success and error paths.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiProviderCredentialsTable,
  eventsTable,
  scanJobsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { encryptApiKey } from "../lib/credentials-crypto.js";
import { chatWithFallback, requireProvider } from "../lib/ai-route-helpers.js";
import { buildPatchHunks, hashPatchBase, type ExecutionNode } from "@workspace/ai-orchestrator";
import {
  claimAiExecution,
  checkpointAiExecution,
  createAiExecution,
  failAiExecution,
  parseAiExecutionCheckpoint,
  reconcileExecutionNodeCheckpoint,
  reconcileAiExecutions,
  requestAiExecutionCancel,
  registerAiExecutionController,
  unregisterAiExecutionController,
} from "../lib/ai-execution-state.js";

const execFileAsync = promisify(execFile);
const validationFixtures: Array<Record<string, unknown>> = [];

// ─── Orchestrator mock ────────────────────────────────────────────────────────
// Mirrors the module-level mock in ai.test.ts so all imports from
// @workspace/ai-orchestrator resolve to stubs rather than live clients.

vi.mock("@workspace/ai-orchestrator", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
  ...actual,
  PROVIDER_REGISTRY: {
    groq:       { providerId: "groq",       label: "Groq",       supportsStreaming: true, supportsTools: true,  supportsJsonMode: true, consoleUrl: "console.groq.com",       statusUrl: "status.groq.com",                defaultModels: { fast: "llama-3.1-8b-instant",      powerful: "llama-3.3-70b-versatile" } },
    deepseek:   { providerId: "deepseek",   label: "DeepSeek",   supportsStreaming: true, supportsTools: true,  supportsJsonMode: true, consoleUrl: "platform.deepseek.com",  statusUrl: "platform.deepseek.com",          defaultModels: { fast: "deepseek-chat",              powerful: "deepseek-chat"            } },
    gemini:     { providerId: "gemini",     label: "Gemini",     supportsStreaming: true, supportsTools: false, supportsJsonMode: true, consoleUrl: "aistudio.google.com/apikey", statusUrl: "status.cloud.google.com",    defaultModels: { fast: "gemini-2.0-flash",          powerful: "gemini-2.0-flash"         } },
    openrouter: { providerId: "openrouter", label: "OpenRouter", supportsStreaming: true, supportsTools: true,  supportsJsonMode: true, consoleUrl: "openrouter.ai/keys",     statusUrl: "openrouter.ai",                  defaultModels: { fast: "google/gemma-4-31b-it:free", powerful: "nvidia/nemotron-3-ultra-550b-a55b:free" } },
  },
  PROVIDER_PRIORITY: ["openrouter", "gemini", "deepseek", "groq"],
  getProvider: vi.fn((id: string) => {
    const registry: Record<string, { providerId: string; label: string }> = {
      groq:       { providerId: "groq",       label: "Groq"       },
      deepseek:   { providerId: "deepseek",   label: "DeepSeek"   },
      gemini:     { providerId: "gemini",     label: "Gemini"     },
      openrouter: { providerId: "openrouter", label: "OpenRouter" },
    };
    if (!registry[id]) throw new Error(`Unknown provider: ${id}`);
    return registry[id];
  }),
  validateProviderKey:      vi.fn(async () => ({ valid: true })),
  buildProjectContext:       vi.fn(async () => "mocked project context"),
  invalidateContextCache:    vi.fn(),
  // chat is not called directly by the stream route (chatWithFallback wraps it),
  // but it is referenced via TypeScript imports so must exist in the mock.
  chat:                      vi.fn(async () => ({ response: "mock", sources: [], pendingChanges: [] })),
  GroqClientError: class GroqClientError extends Error {
    readonly code: string;
    readonly providerModel?: string;
    readonly providerStatus?: number;
    readonly retryAfterMs?: number;
    constructor(
      code: string,
      message: string,
      options?: { context?: { providerModel?: string; providerStatus?: number; retryAfterMs?: number } },
    ) {
      super(message);
      this.name  = "GroqClientError";
      this.code  = code;
      this.providerModel = options?.context?.providerModel;
      this.providerStatus = options?.context?.providerStatus;
      this.retryAfterMs = options?.context?.retryAfterMs;
    }
    toProviderContext() {
      return {
        providerModel: this.providerModel,
        providerStatus: this.providerStatus,
        retryAfterMs: this.retryAfterMs,
      };
    }
  },
  isCircuitOpen:           vi.fn().mockReturnValue(false),
  recordRequest:           vi.fn(),
  recordFailure:           vi.fn(),
  recordSuccess:           vi.fn(),
  recordFallbackSuccess:   vi.fn(),
  recordInvalidModel:      vi.fn(),
  recordLatency:           vi.fn(),
  sortProviderIdsByQuality: vi.fn((ids: string[]) => ids),
  // Use the real routing contracts. Partial legacy classifier fixtures hide
  // missing fields and can no longer represent a complete TurnIntent.
  classifyRequest: vi.fn((message: string) =>
    (actual.classifyRequest as (value: string) => unknown)(message)),
  isImmediateExecutionRequest: vi.fn((message: string) =>
    (actual.isImmediateExecutionRequest as (value: string) => boolean)(message)),
  // enrichContextWithMemories and writeSessionMemories are called by the chat route.
  enrichContextWithMemories: vi.fn(async (ctx: string) => ctx),
  writeSessionMemories: vi.fn(async () => undefined),
  };
});

// ─── ai-route-helpers mock ────────────────────────────────────────────────────
// chatWithFallback and requireProvider are the two route-layer functions that
// drive AI calls.  We stub them at the module level and override per test.

vi.mock("../lib/ai-route-helpers.js", () => {
  const redactText = (value: string) => value
    .replace(/\/home\/runner\/workspace(?:\/[^\s`"'<>),;]+)*/g, "[project path]")
    .replace(/(?:\/tmp|\/workspace)\/[^\s`"'<>),;]+/g, "[runtime path]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[internal id]");
  const redactValue = (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
    }
    return value;
  };
  return {
  redactUserFacingText: redactText,
  redactUserFacingValue: redactValue,
  requireProvider: vi.fn(async () => ({
    provider: "groq" as const,
    apiKey:   "test-dummy-key",
  })),
  chatWithFallback: vi.fn(
    async (
      _userId: string,
      _input:  unknown,
      _prov:   unknown,
      onDelta?: (d: string) => void,
      _options?: unknown,
      _onStreamReset?: unknown,
      onStep?: (step: {
        kind: string;
        tool?: string;
        args?: Record<string, string>;
        cached?: boolean;
        prefetched?: boolean;
        source?: string;
        iterations?: number;
        maxIterations?: number;
        toolCalls?: number;
        stopReason?: string;
        synthesisStarted?: boolean;
        diagnosticCodes?: string[];
        details?: string[];
        model?: string;
        provider?: string;
      }) => void,
    ) => {
      onDelta?.("Hello");
      onDelta?.(" world");
      onStep?.({
        kind: "tool_call",
        tool: "read_file",
        args: { path: "src/verified.ts" },
        cached: false,
        prefetched: true,
      });
      onStep?.({
        kind: "tool_result",
        tool: "read_file",
        source: "src/verified.ts",
        cached: false,
        prefetched: true,
      });
      onStep?.({
        kind: "model_call",
        model: "actual-fallback-model",
        provider: "openrouter",
      });
      onStep?.({
        kind: "done",
        iterations: 2,
        maxIterations: 24,
        toolCalls: 1,
        stopReason: "response",
        synthesisStarted: false,
        diagnosticCodes: [],
      });
      return {
        result:            { response: "Hello world", sources: ["context"], pendingChanges: [] },
        effectiveProvider: "groq" as const,
      };
    },
  ),
  handleOrchestratorError: vi.fn((err: unknown) => { throw err; }),
  resolveProvider:          vi.fn(async () => ({ provider: "groq", apiKey: "test-dummy-key" })),
  collectAvailableProviders: vi.fn(async () => [{ provider: "groq", apiKey: "test-dummy-key" }]),
  };
});

// The cycle test uses a temporary fixture rather than the workspace root. The
// route still runs the real validation gate, but the registered workspace
// command is represented by this deterministic passing result so the test
// proves the HTTP/DB/file/Git state transitions instead of depending on the
// fixture having the monorepo's node_modules.
vi.mock("../lib/ai-repair-validation.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runRepairValidation: vi.fn(async (_rootPath: string, profile: string) => {
      const fixtureResult = validationFixtures.shift();
      if (!fixtureResult) {
        throw new Error(
          "SSE integration fixture exhausted its injected validation results. "
          + `Add a deterministic result for profile ${profile} before invoking validation.`,
        );
      }
      return fixtureResult;
    }),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertProject(
  rootPath = `/tmp/stream-test-${randomUUID()}`,
  gitRemoteUrl?: string,
): Promise<string> {
  const id  = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId:  "test-user",
    name:     `stream-test-${id.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status:   "active",
    ...(gitRemoteUrl ? { gitRemoteUrl, gitDefaultBranch: "main" } : {}),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertApprovedPlan(
  projectId: string,
  approvalStatus: "PENDING_APPROVAL" | "APPROVED" = "APPROVED",
  approvedPath = "src/approved.ts",
  action: "inspect" | "modify" | "test" | "delete" = "modify",
) {
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const now = new Date();
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Implementation plan",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Implementation plan",
    taskResult: JSON.stringify({
      kind: "IMPLEMENTATION_PLAN_RESULT",
      objective: "Build the approved feature",
      summary: "Prepare a reviewable change proposal.",
      assumptions: [],
      steps: [{
        id: "step-1",
        title: "Modify the approved file",
        description: "Change only the declared file.",
        action,
        files: approvedPath ? [approvedPath] : [],
        dependsOn: [],
        validation: ["Run the focused test"],
      }],
      validationCommands: ["pnpm test"],
      risks: [],
      approvalStatus,
      writeAccess: approvalStatus === "APPROVED" ? "APPROVED_FOR_BUILD" : "NOT_AUTHORIZED",
    }),
    createdAt: now,
  });
  return { sessionId, messageId };
}

const projectIds: string[] = [];
const rootPaths: string[] = [];

beforeAll(() => {
  process.env.GROQ_API_KEY = "test-dummy-key-for-stream-tests";
});
afterAll(() => {
  delete process.env.GROQ_API_KEY;
});

afterEach(async () => {
  validationFixtures.length = 0;
  vi.restoreAllMocks();
  for (const pid of projectIds.splice(0)) {
    await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, pid)).catch(() => undefined);
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, pid)).catch(() => undefined);
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, pid)).catch(() => undefined);
    const sessions = await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.projectId, pid));
    for (const s of sessions) {
      await db
        .delete(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.sessionId, s.id))
        .catch(() => undefined);
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, pid)).catch(() => undefined);
    await db.delete(aiProviderCredentialsTable)
      .where(eq(aiProviderCredentialsTable.ownerId, "test-user"))
      .catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
  for (const rootPath of rootPaths.splice(0)) {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

describe("Durable AI execution crash/reconnect", () => {
  it("rehydrates node progress only when the checkpoint matches the approved plan", () => {
    const planNodes = [{
      id: "phase:F-1:1",
      title: "Update the guarded path",
      status: "queued",
      allowedFiles: ["src/guard.ts"],
      dependencies: [],
      validationProfile: "ai-orchestrator-tests",
      attempts: 0,
      validationAttempts: 0,
    }] as ExecutionNode[];
    const checkpointNodes = [{
      ...planNodes[0],
      status: "passed" as const,
      attempts: 1,
    }];

    expect(reconcileExecutionNodeCheckpoint(planNodes, checkpointNodes)).toMatchObject([{
      id: "phase:F-1:1",
      status: "passed",
      attempts: 1,
      allowedFiles: ["src/guard.ts"],
    }]);
    expect(reconcileExecutionNodeCheckpoint(
      planNodes,
      [{ ...checkpointNodes[0]!, dependencies: ["phase:F-0:1"] }],
    )).toBeUndefined();
    expect(reconcileExecutionNodeCheckpoint(
      [{ ...planNodes[0]!, attempts: 2 }],
      [{ ...checkpointNodes[0]!, attempts: 1 }],
    )).toBeUndefined();
    expect(reconcileExecutionNodeCheckpoint(
      [{ ...planNodes[0]!, status: "passed" }],
      [{ ...checkpointNodes[0]!, status: "failed" }],
    )).toBeUndefined();
    expect(reconcileExecutionNodeCheckpoint(
      planNodes,
      [{ ...checkpointNodes[0]!, status: "running", attempts: 0 }],
    )).toBeUndefined();
  });

  it("pauses an interrupted execution and resumes the same ID from its checkpoint", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-resume-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const { sessionId } = await insertApprovedPlan(projectId);
    const requestEnvelope = {
      projectId,
      sessionId,
      message: "continue the implementation",
      modelMessage: "continue the implementation",
      validationTargetPaths: [],
    };

    const created = await createAiExecution({
      userId: "test-user",
      request: requestEnvelope,
      idempotencyKey: randomUUID(),
      projectId,
      sessionId,
    });
    expect(created.resumeToken).toBeTruthy();
    expect(created.execution.operationId).toBe(created.execution.id);

    const queuedStatus = await request(app)
      .get(`/api/ai/executions/${created.execution.id}`);
    expect(queuedStatus.status).toBe(200);
    expect(queuedStatus.body.operationId).toBe(created.execution.id);

    const workerId = randomUUID();
    const claimed = await claimAiExecution({
      executionId: created.execution.id,
      userId: "test-user",
      workerId,
    });
    expect(claimed?.status).toBe("running");

    await checkpointAiExecution({
      executionId: created.execution.id,
      workerId,
      checkpoint: {
        stage: "tool_loop",
        sequence: 1,
        recentSteps: [{
          kind: "tool_result",
          tool: "read_file",
          source: "src/resume.ts",
        }],
        detail: "Source evidence gathered before the worker stopped.",
        updatedAt: new Date().toISOString(),
      },
    });

    expect(await reconcileAiExecutions()).toBeGreaterThanOrEqual(1);
    const paused = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id))
      .limit(1);
    expect(paused[0]?.status).toBe("paused");

    vi.mocked(chatWithFallback).mockClear();
    const resumed = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId,
        message: requestEnvelope.message,
        executionId: created.execution.id,
        resumeToken: created.resumeToken,
      });

    expect(resumed.status).toBe(200);
    const call = vi.mocked(chatWithFallback).mock.calls.at(-1);
    const input = call?.[1] as { message?: string } | undefined;
    expect(input?.message).toContain("SERVER-OWNED DURABLE RESUME CONTEXT");
    expect(input?.message).toContain("src/resume.ts");

    const completed = await db
      .select({
        id: aiExecutionsTable.id,
        status: aiExecutionsTable.status,
        finalMessageId: aiExecutionsTable.finalMessageId,
      })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id))
      .limit(1);
    expect(completed[0]).toMatchObject({
      id: created.execution.id,
      status: "completed",
    });
    expect(completed[0]?.finalMessageId).toBeTruthy();
  });

  it("cancels a queued execution as a terminal state with a durable checkpoint", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-cancel-queued-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const { sessionId } = await insertApprovedPlan(projectId);
    const created = await createAiExecution({
      userId: "test-user",
      request: {
        projectId,
        sessionId,
        message: "cancel before start",
        modelMessage: "cancel before start",
        validationTargetPaths: [],
      },
      idempotencyKey: randomUUID(),
      projectId,
      sessionId,
    });

    const cancelled = await requestAiExecutionCancel({
      executionId: created.execution.id,
      userId: "test-user",
    });

    expect(cancelled).toMatchObject({
      id: created.execution.id,
      status: "cancelled",
    });
    expect(parseAiExecutionCheckpoint(cancelled!.checkpoint)).toMatchObject({
      stage: "cancelled",
      detail: "Execution cancelled before a worker started.",
    });
    expect(await claimAiExecution({
      executionId: created.execution.id,
      userId: "test-user",
      workerId: randomUUID(),
    })).toBeUndefined();
  });

  it("moves running cancellation through cancelling and prevents a late worker success", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-cancel-running-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const { sessionId } = await insertApprovedPlan(projectId);
    const created = await createAiExecution({
      userId: "test-user",
      request: {
        projectId,
        sessionId,
        message: "cancel during provider call",
        modelMessage: "cancel during provider call",
        validationTargetPaths: [],
      },
      idempotencyKey: randomUUID(),
      projectId,
      sessionId,
    });
    const workerId = randomUUID();
    expect((await claimAiExecution({
      executionId: created.execution.id,
      userId: "test-user",
      workerId,
    }))?.status).toBe("running");

    const controller = new AbortController();
    registerAiExecutionController(created.execution.id, controller);
    const cancelling = await requestAiExecutionCancel({
      executionId: created.execution.id,
      userId: "test-user",
    });

    expect(cancelling).toMatchObject({
      id: created.execution.id,
      status: "cancelling",
    });
    expect(controller.signal.aborted).toBe(true);
    expect(await failAiExecution({
      executionId: created.execution.id,
      workerId,
      cancelled: true,
      error: "provider observed cancellation",
    })).toBe(true);
    unregisterAiExecutionController(created.execution.id, controller);

    const terminal = await db
      .select({ status: aiExecutionsTable.status, checkpoint: aiExecutionsTable.checkpoint })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id))
      .limit(1);
    expect(terminal[0]?.status).toBe("cancelled");
    expect(parseAiExecutionCheckpoint(terminal[0]!.checkpoint)).toMatchObject({
      stage: "cancelled",
      detail: "provider observed cancellation",
    });
  });

  it("resumes from a checkpoint, then rebases drifted changes and requires fresh approval", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-resume-drift-");
    rootPaths.push(rootPath);
    const relativePath = "src/resume-drift.ts";
    const absolutePath = path.join(rootPath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    const original = "export const value = 1;\n";
    const replacement = "export const value = 2;\n";
    await fs.writeFile(absolutePath, original, "utf8");

    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, "APPROVED", relativePath);
    const requestEnvelope = {
      projectId,
      sessionId: plan.sessionId,
      message: "Apply the approved repair plan.",
      modelMessage: "Apply the approved repair plan.",
      buildPlanMessageId: plan.messageId,
      validationTargetPaths: [relativePath],
    };

    const created = await createAiExecution({
      userId: "test-user",
      request: requestEnvelope,
      idempotencyKey: randomUUID(),
      projectId,
      sessionId: plan.sessionId,
      buildPlanMessageId: plan.messageId,
    });
    expect(created.resumeToken).toBeTruthy();

    const workerId = randomUUID();
    expect((await claimAiExecution({
      executionId: created.execution.id,
      userId: "test-user",
      workerId,
    }))?.status).toBe("running");

    await checkpointAiExecution({
      executionId: created.execution.id,
      workerId,
      checkpoint: {
        stage: "tool_loop",
        sequence: 1,
        currentNode: "node-1",
        completedNodes: [],
        recentSteps: [{
          kind: "tool_result",
          tool: "read_file",
          source: relativePath,
        }],
        detail: "Read the approved file before the worker stopped.",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(await reconcileAiExecutions()).toBeGreaterThanOrEqual(1);

    const proposedChange = {
      path: relativePath,
      absolutePath,
      newContent: replacement,
      originalContent: original,
      baseHash: hashPatchBase(original),
      hunks: buildPatchHunks(original, replacement, "Update the approved value", {
        risk: "low",
        evidence: [{
          kind: "validation",
          id: "api-ai-tests",
          label: "Validation profile: api-ai-tests",
        }],
      }),
      reason: "Update the approved value",
      validationProfile: "api-ai-tests" as const,
      risk: "low" as const,
      evidence: [{
        kind: "validation" as const,
        id: "api-ai-tests",
        label: "Validation profile: api-ai-tests",
      }],
    };
    vi.mocked(chatWithFallback).mockResolvedValueOnce({
      result: {
        response: "Prepared the resumed change for review.",
        sources: [relativePath],
        pendingChanges: [proposedChange],
      },
      effectiveProvider: "groq",
    });

    const resumed = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: requestEnvelope.message,
        executionId: created.execution.id,
        resumeToken: created.resumeToken,
      });
    expect(resumed.status).toBe(200);
    const resumedEvents = parseSseEvents(resumed.text);
    const resumedDone = resumedEvents.find((event) => event["type"] === "done");
    expect(resumedDone?.["error"]).toBeUndefined();
    expect(resumedDone?.["proposalId"]).toEqual(expect.any(String));

    const proposalId = resumedDone!["proposalId"] as string;
    const drifted = `// user edit\n${original}`;
    await fs.writeFile(absolutePath, drifted, "utf8");

    const rebase = await request(app)
      .post("/api/ai/chat/rebase-changes")
      .send({
        projectId,
        proposalId,
        changes: [proposedChange],
      });
    expect(rebase.status).toBe(200);
    expect(rebase.body).toMatchObject({
      proposalId,
      approvalRequired: true,
      rebasedFiles: [relativePath],
    });
    expect(rebase.body.changes[0]).toMatchObject({
      path: relativePath,
      originalContent: drifted,
      baseHash: hashPatchBase(drifted),
      newContent: `// user edit\n${replacement}`,
    });
    expect(await fs.readFile(absolutePath, "utf8")).toBe(drifted);

    const [storedProposal] = await db
      .select({
        status: aiChangeProposalsTable.status,
        changes: aiChangeProposalsTable.changes,
      })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId))
      .limit(1);
    expect(storedProposal?.status).toBe("pending");
    expect(JSON.parse(storedProposal!.changes)[0]).toMatchObject({
      originalContent: drifted,
      newContent: `// user edit\n${replacement}`,
    });
  });
});

describe("Implementation Plan Build handoff", () => {
  it("keeps a non-Build execution identity through proposal reload and apply", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-non-build-correlation-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Non-Build correlation",
      createdAt: now,
      updatedAt: now,
    });

    const proposedChange = {
      path: "src/non-build.ts",
      absolutePath: path.join(rootPath, "src/non-build.ts"),
      newContent: "export const nonBuild = true;\n",
      originalContent: null,
      reason: "Verify non-Build operation identity",
      validationProfile: "workspace-typecheck" as const,
    };
    vi.mocked(chatWithFallback).mockImplementationOnce(async (
      _userId,
      _input,
      _provider,
      _onDelta,
      _options,
      _onStreamReset,
      onStep,
    ) => {
      onStep?.({
        kind: "validation",
        result: {
          profile: "workspace-typecheck",
          status: "passed",
          scenario: "Non-Build correlation validation",
          exitCode: 0,
          command: "fixture-validation",
          stdout: "passed",
          stderr: "",
          failedTests: [],
          changedFiles: ["src/non-build.ts"],
          evidence: {
            evidenceId: "non-build-validation",
            observedAt: new Date().toISOString(),
            artifactRef: "non-build-validation",
          },
          detail: "Non-Build correlation validation passed.",
        },
        repairState: "READY_FOR_REVIEW",
        attempt: 1,
        maxAttempts: 3,
      } as never);
      return {
        result: {
          response: "Prepared a non-Build change for review.",
          sources: ["src/non-build.ts"],
          pendingChanges: [proposedChange],
        },
        effectiveProvider: "groq",
      };
    });

    const stream = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId,
        message: "Implement the non-Build correlation fixture.",
      });
    expect(stream.status).toBe(200);
    const done = parseSseEvents(stream.text).find((event) => event["type"] === "done");
    const proposalId = done?.["proposalId"] as string;
    const operationId = done?.["operationId"] as string;
    const assistantMessageId = (done?.["message"] as { id?: string } | undefined)?.id;
    expect(proposalId).toEqual(expect.any(String));
    expect(operationId).toEqual(expect.any(String));
    expect(operationId).not.toBe(assistantMessageId);

    const [execution] = await db
      .select({
        id: aiExecutionsTable.id,
        operationId: aiExecutionsTable.operationId,
        proposalId: aiExecutionsTable.proposalId,
      })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.sessionId, sessionId))
      .limit(1);
    expect(execution).toMatchObject({
      operationId,
      proposalId,
    });

    const pending = await request(app)
      .get(`/api/ai/chat/${sessionId}/pending-proposal`);
    expect(pending.status).toBe(200);
    expect(pending.body.operationId).toBe(operationId);

    validationFixtures.push({
      status: "passed",
      profile: "workspace-typecheck",
      scenario: "Deterministic non-Build apply validation",
      command: "fixture-validation",
      stdout: "passed",
      stderr: "",
      failedTests: [],
      changedFiles: ["src/non-build.ts"],
      detail: "Validation passed in the integration fixture.",
    });
    const apply = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({ projectId, proposalId, operationId, changes: [proposedChange] });
    expect(apply.status).toBe(200);
    const operationEvents = await db
      .select({ type: eventsTable.type, correlationId: eventsTable.correlationId })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    expect(operationEvents.some((event) =>
      event.type === "AiChangesApplied" && event.correlationId === operationId,
    )).toBe(true);
  });

  it("rejects Build Mode before the plan is approved", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-build-plan-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, "PENDING_APPROVAL");

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_APPROVAL_REQUIRED");
  });

  it("blocks Build Mode for an already-approved plan with no safe file scope", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-build-empty-scope-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, "APPROVED", "");

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_FILE_SCOPE_REQUIRED");
  });

  it("blocks an approved read-only plan before opening a provider turn", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-build-read-only-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, "APPROVED", "src/routes.ts", "inspect");
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callsBefore = vi.mocked(chatWithFallback).mock.calls.length;

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_BUILD_BLOCKED");
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callsBefore);
  });

  it("blocks a proposed file outside the approved plan scope", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-build-scope-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    vi.mocked(chatWithFallback).mockResolvedValueOnce({
      result: {
        response: "Prepared changes.",
        sources: [],
        pendingChanges: [{
          path: "src/outside.ts",
          absolutePath: `${rootPath}/src/outside.ts`,
          newContent: "export const blocked = true;",
          originalContent: null,
          reason: "Outside the approved plan scope",
          validationProfile: "api-ai-tests",
        }],
      },
      effectiveProvider: "groq",
    });

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });

    expect(res.status).toBe(200);
    const events = parseSseEvents(res.text);
    const errorEvent = events.find((event) => event["type"] === "error");
    expect(errorEvent?.["code"]).toBe("IMPLEMENTATION_PLAN_SCOPE_BLOCKED");

    const messages = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, plan.sessionId));
    expect(messages).toHaveLength(1);
  });

  it("binds in-scope implementation changes to the safe workspace typecheck", async () => {
    const rootPath = await fs.mkdtemp("/tmp/stream-build-validation-");
    rootPaths.push(rootPath);
    const projectId = await insertProject(rootPath);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    vi.mocked(chatWithFallback).mockResolvedValueOnce({
      result: {
        response: "Prepared changes.",
        sources: [],
        pendingChanges: [{
          path: "src/approved.ts",
          absolutePath: `${rootPath}/src/approved.ts`,
          newContent: "export const approved = true;",
          originalContent: null,
          reason: "Implement the approved plan step",
        }],
      },
      effectiveProvider: "groq",
    });

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });

    expect(res.status).toBe(200);
    const events = parseSseEvents(res.text);
    const doneEvent = events.find((event) => event["type"] === "done");
    expect(doneEvent?.["error"]).toBeUndefined();
    expect((doneEvent?.["pendingChanges"] as Array<Record<string, unknown>>)[0]?.["validationProfile"])
      .toBe("workspace-typecheck");
  });
});

describe("Plan-to-push agent cycle", () => {
  it("proves Plan -> Approve -> Build -> Diff -> Apply -> Commit -> Push", async () => {
    const rootPath = await fs.mkdtemp("/tmp/agent-cycle-project-");
    const remotePath = await fs.mkdtemp("/tmp/agent-cycle-remote-");
    const wrapperDir = await fs.mkdtemp("/tmp/agent-cycle-git-bin-");
    rootPaths.push(rootPath, remotePath, wrapperDir);

    const realGit = (await execFileAsync("which", ["git"])).stdout.trim();
    await execFileAsync(realGit, ["-C", rootPath, "init", "-q", "-b", "main"]);
    await fs.writeFile(path.join(rootPath, "README.md"), "agent-cycle fixture\n", "utf8");
    await execFileAsync(realGit, ["-C", rootPath, "add", "README.md"]);
    await execFileAsync(realGit, [
      "-C", rootPath,
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.com",
      "commit", "-qm", "fixture",
    ]);
    await execFileAsync(realGit, ["init", "--bare", "-q", remotePath]);

    const remoteUrl = "https://example.test/engineeringos-agent-cycle.git";
    const projectId = await insertProject(rootPath, remoteUrl);
    projectIds.push(projectId);
    const plan = await insertApprovedPlan(projectId, "PENDING_APPROVAL");

    const approval = await request(app)
      .post(`/api/ai/chat/plans/${plan.messageId}/decision`)
      .send({ decision: "approve" });
    expect(approval.status).toBe(200);
    expect(approval.body.taskResult).toMatchObject({
      approvalStatus: "APPROVED",
      writeAccess: "APPROVED_FOR_BUILD",
    });

    const proposedChange = {
      path: "src/approved.ts",
      absolutePath: path.join(rootPath, "src/approved.ts"),
      newContent: "export const approved = true;\n",
      originalContent: null,
      reason: "Implement the approved plan step",
      validationProfile: "workspace-typecheck" as const,
      risk: "low" as const,
      evidence: [{
        kind: "validation" as const,
        id: "workspace-typecheck",
        label: "Validation profile: workspace-typecheck",
      }],
    };
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    vi.mocked(chatWithFallback).mockResolvedValueOnce({
      result: {
        response: "Prepared the approved change for review.",
        sources: ["src/approved.ts"],
        pendingChanges: [proposedChange],
      },
      effectiveProvider: "groq",
    });
    validationFixtures.push({
      status: "passed",
      profile: "workspace-typecheck",
      scenario: "Deterministic agent-cycle validation",
      detail: "Validation passed in the integration fixture.",
    });

    const build = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        sessionId: plan.sessionId,
        buildPlanMessageId: plan.messageId,
        message: "Build the approved implementation plan.",
      });
    expect(build.status).toBe(200);
    const buildEvents = parseSseEvents(build.text);
    const buildDone = buildEvents.find((event) => event["type"] === "done");
    expect(buildDone?.["error"]).toBeUndefined();
    expect(typeof buildDone?.["proposalId"]).toBe("string");
    expect(buildDone?.["pendingChanges"]).toEqual([proposedChange]);
    await expect(fs.access(proposedChange.absolutePath)).rejects.toThrow();

    const proposalId = buildDone!["proposalId"] as string;
    const operationId = plan.messageId;
    const pending = await request(app)
      .get(`/api/ai/chat/${plan.sessionId}/pending-proposal`);
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({
      proposalId,
      operationId,
      changes: [proposedChange],
      approvalRequired: false,
      revision: 0,
    });

    const mismatchedApply = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId,
        proposalId,
        operationId: randomUUID(),
        changes: [proposedChange],
      });
    expect(mismatchedApply.status).toBe(409);
    expect(mismatchedApply.body.code).toBe("OPERATION_ID_MISMATCH");

    const apply = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId,
        proposalId,
        operationId,
        changes: [proposedChange],
      });
    expect(apply.status).toBe(200);
    expect(apply.body.results).toHaveLength(1);
    expect(apply.body.results[0]).toMatchObject({
      ok: true,
      writeStatus: "written",
      persistenceVerified: true,
      behavioralVerification: { status: "passed" },
    });
    await expect(fs.readFile(proposedChange.absolutePath, "utf8"))
      .resolves.toBe(proposedChange.newContent);
    const [appliedProposal] = await db
      .select({ status: aiChangeProposalsTable.status })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId))
      .limit(1);
    expect(appliedProposal?.status).toBe("applied");

    const commit = await request(app)
      .post(`/api/projects/${projectId}/git/commit`)
        .send({ message: "Apply verified AI changes", proposalId, operationId });
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({
      ok: true,
      correlationId: operationId,
      commitHash: expect.stringMatching(/^[0-9a-f]{40}$/),
      committedPaths: ["src/approved.ts"],
    });
    const statusAfterCommit = await execFileAsync(realGit, ["-C", rootPath, "status", "--short"]);
    expect(statusAfterCommit.stdout.trim()).toBe("");
    const committedFiles = await execFileAsync(realGit, [
      "-C", rootPath, "show", "--format=", "--name-only", "HEAD",
    ]);
    expect(committedFiles.stdout.trim()).toBe("src/approved.ts");

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.ENGINEERINGOS_TEST_REAL_GIT;
    const previousRemote = process.env.ENGINEERINGOS_TEST_PUSH_REMOTE;
    const previousCryptoKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    const wrapperPath = path.join(wrapperDir, "git");
    await fs.writeFile(wrapperPath, `#!/bin/sh
if [ "$1" = "-C" ] && [ "$3" = "push" ]; then
  exec "$ENGINEERINGOS_TEST_REAL_GIT" -C "$2" push "file://$ENGINEERINGOS_TEST_PUSH_REMOTE" "$5"
fi
exec "$ENGINEERINGOS_TEST_REAL_GIT" "$@"
`, "utf8");
    await fs.chmod(wrapperPath, 0o755);
    process.env.PATH = `${wrapperDir}:${previousPath ?? ""}`;
    process.env.ENGINEERINGOS_TEST_REAL_GIT = realGit;
    process.env.ENGINEERINGOS_TEST_PUSH_REMOTE = remotePath;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
    await db.insert(aiProviderCredentialsTable).values({
      id: randomUUID(),
      ownerId: "test-user",
      provider: "github",
      encryptedApiKey: encryptApiKey("fixture-github-token"),
      last4: "oken",
    });

    try {
      const push = await request(app)
        .post(`/api/projects/${projectId}/git/push`)
        .send({ proposalId, operationId });
      expect(push.status).toBe(200);
      expect(push.body).toMatchObject({
        ok: true,
        branch: "main",
        correlationId: operationId,
        commitHash: commit.body.commitHash,
      });

      const remoteLog = await execFileAsync(realGit, [
        "--git-dir", remotePath, "log", "--format=%s", "main",
      ]);
      expect(remoteLog.stdout.trim().split(/\r?\n/)).toEqual([
        "Apply verified AI changes",
        "fixture",
      ]);

      const pushedEvents = await db
        .select({ type: eventsTable.type, correlationId: eventsTable.correlationId })
        .from(eventsTable)
        .where(eq(eventsTable.projectId, projectId));
      expect(pushedEvents.some((event) => event.type === "GitPushed")).toBe(true);
      const traceTypes = new Set(
        pushedEvents
          .filter((event) => event.correlationId === operationId)
          .map((event) => event.type),
      );
      expect(traceTypes).toEqual(new Set([
        "AiPlanCreated",
        "AiPlanApproved",
        "AiBuildStarted",
        "AiBuildCompleted",
        "AiChangesApplied",
        "GitCommitCreated",
        "GitPushed",
      ]));
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.ENGINEERINGOS_TEST_REAL_GIT;
      else process.env.ENGINEERINGOS_TEST_REAL_GIT = previousRealGit;
      if (previousRemote === undefined) delete process.env.ENGINEERINGOS_TEST_PUSH_REMOTE;
      else process.env.ENGINEERINGOS_TEST_PUSH_REMOTE = previousRemote;
      if (previousCryptoKey === undefined) delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousCryptoKey;
    }
  });
});

// ─── SSE helpers ─────────────────────────────────────────────────────────────

type SseEvent = Record<string, unknown>;

/** Parse a raw SSE response body into an array of JSON event objects. */
function parseSseEvents(body: string): SseEvent[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => {
      try {
        return JSON.parse(chunk.slice(6)) as SseEvent;
      } catch {
        return null;
      }
    })
    .filter((ev): ev is SseEvent => ev !== null);
}

// ─── INT-005: SSE success path ────────────────────────────────────────────────

describe("INT-005 — POST /api/ai/chat/stream: successful OpenRouter completion over SSE", () => {
  it("should stream successful OpenRouter completion over SSE", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "What is the project status?" });

    // SSE routes always respond with 200 — errors are surfaced as SSE events
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);

    // At least one event must have been emitted
    expect(events.length).toBeGreaterThan(0);

    // Stage events must appear: building-context and calling-model
    const stageEvents = events.filter((e) => e["type"] === "stage");
    const stageNames  = stageEvents.map((e) => e["stage"]);
    expect(stageNames).toContain("building-context");
    expect(stageNames).toContain("calling-model");

    // Delta events carry the streamed tokens
    const deltaEvents = events.filter((e) => e["type"] === "delta");
    expect(deltaEvents.length).toBeGreaterThan(0);
    const streamed = deltaEvents.map((e) => e["delta"]).join("");
    expect(streamed).toBe("Hello world");

    // Done event closes the stream with a persisted message and sessionId
    const sessionStartedEvent = events.find((e) => e["type"] === "session_started");
    const doneEvent = events.find((e) => e["type"] === "done");
    expect(sessionStartedEvent).toBeDefined();
    expect(typeof sessionStartedEvent!["sessionId"]).toBe("string");
    expect(events.indexOf(sessionStartedEvent!)).toBeLessThan(events.indexOf(doneEvent!));
    expect(doneEvent).toBeDefined();
    expect(typeof doneEvent!["sessionId"]).toBe("string");
    expect(doneEvent!["message"]).toBeDefined();
    expect((doneEvent!["message"] as Record<string, unknown>)["role"]).toBe("assistant");
    expect(Array.isArray(doneEvent!["sources"])).toBe(true);
    expect(Array.isArray(doneEvent!["pendingChanges"])).toBe(true);

    // No error event on the success path
    const errorEvents = events.filter((e) => e["type"] === "error");
    expect(errorEvents).toHaveLength(0);

    // No internal stack trace or crash in the response body
    expect(res.text).not.toMatch(/Error:/);
    expect(res.text).not.toMatch(/at\s+\w+\s+\(/); // stack trace pattern
  });

  it("persists and restores the resumable task contract for an SSE continuation", async () => {
    const { classifyRequest: mockClassifyRequest } = await import("@workspace/ai-orchestrator");
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const forensicClassification = {
      category: "deep_analysis",
      contextProfile: "chat-deep",
      historyDepth: 0,
      allowPrefetch: false,
      confidence: 1,
      structuredOutputMode: true,
      singleFileForensicMode: false,
      orderedForensicRoots: [],
      includeTestSources: false,
      fixtureAuditMode: false,
      implementationTaskMode: false,
      implementationPlanMode: false,
      taskType: "FULL_FORENSIC_AUDIT",
      analysisMode: "FORENSIC",
      outputContract: "FORENSIC_REPORT",
      firstEvidence: {
        allowedFirstAction: "EXPLORE",
        primaryEvidenceTarget: null,
        traversalPolicy: "BROAD",
      },
    } as ReturnType<typeof import("@workspace/ai-orchestrator").classifyRequest>;
    vi.mocked(mockClassifyRequest)
      .mockReturnValueOnce(forensicClassification)
      .mockReturnValueOnce(forensicClassification);

    const seenInputs: Array<{
      activeTaskState?: { taskType?: string; scope?: { projectId?: string } } | null;
      turnIntent?: {
        kind?: string;
        executionTaskType?: string;
        requiresTools?: boolean;
        requiresEvidence?: boolean;
      };
    }> = [];
    const repairPlan = [{
      findingId: "F-1" as const,
      files: ["src/unsafe.ts"],
      steps: ["Replace the unsafe evaluation path."],
      validationProfile: "ai-orchestrator-tests" as const,
      verdictScope: "PRODUCTION" as const,
      scopedFindingStatus: "PRODUCTION_PROVEN" as const,
    }];
    const runContinuation = async (...args: Parameters<typeof chatWithFallback>) => {
      seenInputs.push(args[1] as typeof seenInputs[number]);
      args[3]?.("continued");
      args[6]?.({
        kind: "done",
        iterations: 1,
        maxIterations: 1,
        toolCalls: 0,
        prefetchToolCalls: 0,
        loopToolCalls: 0,
        stopReason: "response",
        synthesisStarted: false,
        diagnosticCodes: [],
      });
      return {
        result: {
          response: "continued",
          sources: [],
          pendingChanges: [],
          repairPlan,
          behaviorEvidence: [{
            source: "src/unsafe.ts",
            sourceSpan: { startLine: 12, endLine: 16 },
            excerpt: "safe replacement",
            supportsClaim: true,
            evidenceClass: "FINDING_PROVEN",
            directness: "DIRECT",
            sourceType: "IMPLEMENTATION",
            productionReachability: "PROVEN",
            relevance: 1,
          }],
        },
        effectiveProvider: "groq" as const,
      } as Awaited<ReturnType<typeof chatWithFallback>>;
    };
    vi.mocked(chatWithFallback)
      .mockImplementationOnce(runContinuation)
      .mockImplementationOnce(runContinuation)
      .mockImplementationOnce(runContinuation);
    vi.mocked(requireProvider).mockClear();

    const projectId = await insertProject();
    projectIds.push(projectId);

    const first = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "forensic audit" });
    expect(first.status).toBe(200);
    const firstDone = parseSseEvents(first.text).find((event) => event["type"] === "done");
    const sessionId = firstDone?.["sessionId"] as string;
    expect(sessionId).toBeTruthy();

    const persistedAfterFirst = await db
      .select({ activeTaskState: aiChatSessionsTable.activeTaskState })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId));
    expect(JSON.parse(persistedAfterFirst[0]!.activeTaskState!)).toMatchObject({
      taskType: "FULL_FORENSIC_AUDIT",
      executionPlan: {
        readiness: "READY",
        phases: [{ findingId: "F-1", files: ["src/unsafe.ts"] }],
        boundaries: {
          projectId,
          allowedWriteFiles: ["src/unsafe.ts"],
          sourceRoots: ["src"],
        },
        claims: [{ claimId: "finding:F-1", findingId: "F-1", status: "PROVEN" }],
      },
    });

    const persistedMessages = await db
      .select({ id: aiChatMessagesTable.id, role: aiChatMessagesTable.role })
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, sessionId));
    const assistantMessage = persistedMessages.find((message) => message.role === "assistant");
    expect(assistantMessage).toBeDefined();
    await db
      .update(aiChatMessagesTable)
      .set({ content: "Audit report retained without executable Markdown metadata.", repairPlanMetadata: null })
      .where(eq(aiChatMessagesTable.id, assistantMessage!.id));

    const second = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, sessionId, message: "أكمل" });
    expect(second.status).toBe(200);
    expect(seenInputs[1]?.activeTaskState).toMatchObject({
      taskType: "FULL_FORENSIC_AUDIT",
      scope: { projectId },
    });

    const neutral = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, sessionId, message: "Tell me a joke" });
    expect(neutral.status).toBe(200);
    expect(seenInputs[2]?.activeTaskState).toBeNull();
    expect(seenInputs[2]?.turnIntent).toMatchObject({
      kind: "CHAT",
      executionTaskType: "chat",
      requiresTools: false,
      requiresEvidence: false,
    });

    expect(vi.mocked(requireProvider).mock.calls.slice(-3).map((call) => call[2])).toEqual([
      { requireTools: true, qualityProfile: "analysis" },
      { requireTools: true, qualityProfile: "analysis" },
      { requireTools: false, qualityProfile: "chat" },
    ]);
  });

  it("should carry the persisted audit report into a same-session execution follow-up", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined as never);
    const auditReport = [
      "## 4) Repair Plan",
      "Phase 1 (F-01): Update the verified implementation — `src/verified.ts`",
    ].join("\n");

    vi.mocked(chatWithFallback)
      .mockResolvedValueOnce({
        result: { response: auditReport, sources: ["audit"], pendingChanges: [] },
        effectiveProvider: "groq",
      })
      .mockResolvedValueOnce({
        result: { response: "Execution handoff received", sources: [], pendingChanges: [] },
        effectiveProvider: "groq",
      });

    const auditRes = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "راجع الكود" });
    const auditEvents = parseSseEvents(auditRes.text);
    const auditDone = auditEvents.find((e) => e["type"] === "done");
    const sessionId = auditDone?.["sessionId"];

    expect(auditRes.status).toBe(200);
    expect(typeof sessionId).toBe("string");

    const executionRes = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, sessionId, message: "نفذ Repair Plan" });
    const executionEvents = parseSseEvents(executionRes.text);
    const executionDone = executionEvents.find((e) => e["type"] === "done");
    const calls = vi.mocked(chatWithFallback).mock.calls;
    const executionCall = calls[calls.length - 1];
    const executionInput = executionCall?.[1] as { history: Array<{ role: string; content: string }> };

    expect(executionRes.status).toBe(200);
    expect(executionDone?.["message"]).toBeDefined();
    expect(executionInput.history).toContainEqual({ role: "assistant", content: auditReport });
    expect(executionInput.history.some((entry) => entry.content === "نفذ Repair Plan")).toBe(false);

    const handoffTrace = infoSpy.mock.calls
      .map(([payload]) => payload)
      .find(
        (payload): payload is Record<string, unknown> =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as Record<string, unknown>).action === "pre_stream_trace" &&
          typeof (payload as Record<string, unknown>).executionHandoff === "object" &&
          ((payload as Record<string, unknown>).executionHandoff as Record<string, unknown>).requested === true,
      );
    expect(handoffTrace).toBeDefined();
    const handoff = handoffTrace!.executionHandoff as Record<string, unknown>;
    expect(handoff.requested).toBe(true);
    expect(handoff.sessionId).toBe(sessionId);
    expect(handoff.historyMessageCount).toBeGreaterThanOrEqual(2);
    expect(handoff.repairPlanCandidateCount).toBe(1);
  });

  it("keeps execution trace separate from the persisted SSE report content", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "Summarize the project quality" });

    const events = parseSseEvents(res.text);
    const done = events.find((event) => event["type"] === "done");
    const message = done?.["message"] as { content?: string; toolTrace?: string | null } | undefined;
    const trace = message?.toolTrace ? JSON.parse(message.toolTrace) as Array<Record<string, unknown>> : [];
    const execution = done?.["execution"] as {
      iterations?: number;
      maxIterations?: number;
      toolCalls?: number;
      stopReason?: string;
      synthesisStarted?: boolean;
      diagnosticCodes?: string[];
       modelsUsed?: string[];
    } | undefined;

    expect(res.status).toBe(200);
    expect(message?.content).toBe("Hello world");
    expect(message?.content).not.toContain("read_file");
    expect(execution).toEqual({
      iterations: 2,
      maxIterations: 24,
      toolCalls: 1,
      stopReason: "response",
      synthesisStarted: false,
      modelsUsed: ["actual-fallback-model"],
      diagnosticCodes: [],
    });
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "model_call",
        model: "actual-fallback-model",
        provider: "openrouter",
      }),
      expect.objectContaining({ kind: "tool_call", tool: "read_file" }),
       expect.objectContaining({
         kind: "tool_result",
         tool: "read_file",
         source: "src/verified.ts",
         prefetched: true,
       }),
      expect.objectContaining({
        kind: "done",
        iterations: 2,
        maxIterations: 24,
        toolCalls: 1,
        stopReason: "response",
        synthesisStarted: false,
      diagnosticCodes: [],
      }),
    ]));

    const persisted = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, done?.["sessionId"] as string));
    const assistant = persisted.find((row) => row.role === "assistant");
    expect(assistant?.content).toBe("Hello world");
    expect(assistant?.toolTrace).toBe(message?.toolTrace);
  });

  it("keeps forensic diagnostic details in metadata, not report content", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");

    vi.mocked(chatWithFallback).mockImplementationOnce(
      async (
        _userId,
        _input,
        _prov,
        onDelta,
        _options,
        _onStreamReset,
        onStep,
      ) => {
        onDelta?.("Safe fallback report");
        onStep?.({
          kind: "diagnostic",
          code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
          details: ["Evidence Map: missing current source record"],
        });
        onStep?.({
          kind: "done",
          iterations: 24,
          maxIterations: 24,
          toolCalls: 6,
          prefetchToolCalls: 0,
          loopToolCalls: 6,
          stopReason: "response",
          synthesisStarted: true,
          diagnosticCodes: ["FORENSIC_CONTRACT_RECOVERY_REJECTED"],
        });
        return {
          result: { response: "Safe fallback report", sources: [], pendingChanges: [] },
          effectiveProvider: "groq" as const,
        };
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "راجع الكود" });
    const events = parseSseEvents(res.text);
    const done = events.find((event) => event["type"] === "done");
    const diagnostic = events.find((event) => event["type"] === "execution_diagnostic");
    const message = done?.["message"] as { content?: string; toolTrace?: string | null } | undefined;
    const trace = message?.toolTrace ? JSON.parse(message.toolTrace) as Array<Record<string, unknown>> : [];
    const execution = done?.["execution"] as Record<string, unknown> | undefined;

    expect(res.status).toBe(200);
    expect(message?.content).toBe("Safe fallback report");
    expect(message?.content).not.toContain("missing current source record");
    expect(diagnostic).toEqual({
      type: "execution_diagnostic",
      code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
      details: ["Evidence Map: missing current source record"],
    });
    expect(execution?.["diagnosticDetails"]).toEqual(["Evidence Map: missing current source record"]);
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "diagnostic",
        code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
        details: ["Evidence Map: missing current source record"],
      }),
      expect.objectContaining({
        kind: "done",
        diagnosticCodes: ["FORENSIC_CONTRACT_RECOVERY_REJECTED"],
        diagnosticDetails: ["Evidence Map: missing current source record"],
      }),
    ]));
  });

  it("hides provider and recovery diagnostic details from evidence-required SSE", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { classifyRequest: mockClassifyRequest } = await import("@workspace/ai-orchestrator");
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");

    vi.mocked(mockClassifyRequest).mockReturnValueOnce({
      category: "deep_analysis",
      contextProfile: "chat-deep",
      historyDepth: 0,
      allowPrefetch: false,
      confidence: 1,
      structuredOutputMode: true,
      singleFileForensicMode: false,
      orderedForensicRoots: [],
      includeTestSources: false,
      fixtureAuditMode: false,
      implementationTaskMode: false,
      implementationPlanMode: false,
      taskType: "FULL_FORENSIC_AUDIT",
      analysisMode: "FORENSIC",
      outputContract: "FORENSIC_REPORT",
      firstEvidence: {
        allowedFirstAction: "EXPLORE",
        primaryEvidenceTarget: null,
        traversalPolicy: "BROAD",
      },
    } as ReturnType<typeof import("@workspace/ai-orchestrator").classifyRequest>);

    vi.mocked(chatWithFallback).mockImplementationOnce(
      async (
        _userId,
        _input,
        _prov,
        onDelta,
        _options,
        _onStreamReset,
        onStep,
      ) => {
        onDelta?.("Evidence-backed report");
        onStep?.({
          kind: "tool_result",
          tool: "read_file",
          source: "src/current.ts",
          cached: false,
          outputLength: 128,
          prefetched: false,
        });
        onStep?.({
          kind: "recovery_model_call",
          model: "recovery-provider-model",
          provider: "recovery-provider",
          attempt: 2,
        });
        onStep?.({
          kind: "diagnostic",
          code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
          details: [
            "provider recovery-provider returned an unusable response",
            "recovery attempt 2 failed with provider timeout",
          ],
        });
        onStep?.({
          kind: "done",
          iterations: 2,
          maxIterations: 24,
          toolCalls: 1,
          prefetchToolCalls: 0,
          loopToolCalls: 1,
          stopReason: "response",
          synthesisStarted: true,
          diagnosticCodes: ["FORENSIC_CONTRACT_RECOVERY_REJECTED"],
        });
        return {
          result: {
            response: "Evidence-backed report",
            sources: ["src/current.ts"],
            pendingChanges: [],
          },
          effectiveProvider: "groq" as const,
        };
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "forensic audit" });
    const events = parseSseEvents(res.text);
    const diagnostic = events.find((event) => event["type"] === "execution_diagnostic");
    const done = events.find((event) => event["type"] === "done");
    const message = done?.["message"] as { content?: string; toolTrace?: string | null } | undefined;
    const execution = done?.["execution"] as Record<string, unknown> | undefined;
    const persisted = await db
      .select({ role: aiChatMessagesTable.role, toolTrace: aiChatMessagesTable.toolTrace })
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, done?.["sessionId"] as string));
    const assistant = persisted.find((row) => row.role === "assistant");

    expect(res.status).toBe(200);
    expect(message?.content).toBe("Evidence-backed report");
    expect(diagnostic).toEqual({
      type: "execution_diagnostic",
      code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
    });
    expect(diagnostic).not.toHaveProperty("details");
    expect(execution?.["diagnosticDetails"]).toEqual([
      "provider recovery-provider returned an unusable response",
      "recovery attempt 2 failed with provider timeout",
    ]);

    const trace = assistant?.toolTrace ? JSON.parse(assistant.toolTrace) as Array<Record<string, unknown>> : [];
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "recovery_model_call",
        model: "recovery-provider-model",
        provider: "recovery-provider",
      }),
      expect.objectContaining({
        kind: "diagnostic",
        code: "FORENSIC_CONTRACT_RECOVERY_REJECTED",
        details: [
          "provider recovery-provider returned an unusable response",
          "recovery attempt 2 failed with provider timeout",
        ],
      }),
    ]));
  });

  it("records zero-read evidence stops as failed, not completed", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");

    vi.mocked(chatWithFallback).mockImplementationOnce(
      async (
        _userId,
        _input,
        _prov,
        _onDelta,
        _options,
        _onStreamReset,
        onStep,
      ) => {
        onStep?.({
          kind: "diagnostic",
          code: "INCOMPLETE_BEFORE_EVIDENCE",
          details: ["Execution ended before the first source read."],
        });
        onStep?.({
          kind: "done",
          iterations: 1,
          maxIterations: 24,
          toolCalls: 0,
          prefetchToolCalls: 0,
          loopToolCalls: 0,
          stopReason: "response",
          synthesisStarted: false,
          diagnosticCodes: ["INCOMPLETE_BEFORE_EVIDENCE"],
        });
        return {
          result: {
            response: "behavior contract mismatch",
            sources: [],
            pendingChanges: [],
          },
          effectiveProvider: "groq" as const,
        };
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({
        projectId,
        message: "تحقق من الكود الفعلي واكتشف الفجوات وحدد الأسباب الجذرية",
      });

    const events = parseSseEvents(res.text);
    const done = events.find((event) => event["type"] === "done");
    const message = done?.["message"] as { content?: string } | undefined;
    const executions = await db
      .select()
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, projectId));

    expect(res.status).toBe(200);
    expect(message?.content).toContain("توقف التنفيذ قبل قراءة أي ملف مصدر");
    expect(done?.["execution"]).toEqual(expect.objectContaining({
      diagnosticCodes: ["INCOMPLETE_BEFORE_EVIDENCE"],
    }));
    expect(executions.at(-1)?.status).toBe("failed");
  });

  it("should reject execution without a session before opening an SSE/model turn", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callsBefore = vi.mocked(chatWithFallback).mock.calls.length;

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "نفذ Repair Plan" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("execution_session_required");
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callsBefore);
  });

  it("should reject an unknown stream session instead of creating a new one", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callsBefore = vi.mocked(chatWithFallback).mock.calls.length;

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, sessionId: randomUUID(), message: "Hello" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callsBefore);
  });
});

// ─── INT-006: SSE error path (provider failover / empty chain) ────────────────

describe("INT-006 — POST /api/ai/chat/stream: provider failover surfaced cleanly through SSE", () => {
  it("should surface provider failover cleanly through the SSE stream", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Override chatWithFallback to throw MODEL_NOT_FOUND after all providers fail
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const { GroqClientError } = await import("@workspace/ai-orchestrator");
    const sensitivePath = "/var/task/provider-runtime/chat.ts";
    const internalId = "123e4567-e89b-12d3-a456-426614174000";
    vi.mocked(chatWithFallback).mockRejectedValueOnce(
      new GroqClientError(
        "MODEL_NOT_FOUND",
        `All AI model fallbacks exhausted — no model was available (${sensitivePath}, ${internalId}).`,
        { context: { providerModel: `model-${internalId}`, providerStatus: 422 } },
      ),
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "Trigger provider failure" });

    // Route responds with 200 regardless — errors surface in the SSE body
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const events = parseSseEvents(res.text);
    expect(events.length).toBeGreaterThan(0);

    // A structured error event must be present
    const errorEvent = events.find((e) => e["type"] === "error");
    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent!["code"]).toBe("string");
    expect(typeof errorEvent!["message"]).toBe("string");
    // MODEL_NOT_FOUND errors must not be retryable (no free models remain)
    expect(errorEvent!["retryable"]).toBe(false);

    // No unhandled exception or stack trace leaked into the SSE body
    expect(res.text).not.toMatch(/at\s+\w+\s+\(/); // stack trace pattern
    expect(res.text).not.toContain("UnhandledPromiseRejection");
    expect(res.text).not.toContain(sensitivePath);
    expect(res.text).not.toContain(internalId);

    // No `done` event — the error path ends the stream without persisting a message
    const doneEvent = events.find((e) => e["type"] === "done");
    expect(doneEvent).toBeUndefined();

    // The stream is closed after the error event (no more data follows)
    const lastEvent = events[events.length - 1];
    expect(lastEvent!["type"]).toBe("error");
  });

  it("should expose a bounded Retry-After hint for an exhausted rate-limited chain", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const { GroqClientError } = await import("@workspace/ai-orchestrator");
    vi.mocked(chatWithFallback).mockRejectedValueOnce(
      new GroqClientError("RATE_LIMITED", "OpenRouter rate limited", {
        context: {
          providerName: "OpenRouter",
          providerStatus: 429,
          retryAfterMs: 2_000,
        },
      }),
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ projectId, message: "Trigger rate limit" });

    expect(res.status).toBe(200);
    const errorEvent = parseSseEvents(res.text).find((e) => e["type"] === "error");
    expect(errorEvent).toMatchObject({
      code: "RATE_LIMITED",
      retryAfterMs: 2_000,
      retryable: true,
    });
    expect(String(errorEvent!["message"])).toContain("2 seconds");
  });

  it("should respond with 400 before opening SSE stream when request body is invalid", async () => {
    // Validation errors return JSON 400, not SSE — the stream is never opened
    const res = await request(app)
      .post("/api/ai/chat/stream")
      .set("Content-Type", "application/json")
      .send({ message: "Missing projectId" });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error).toMatch(/projectId/i);
  });
});

// ─── INT-007: Fetch isolation — chatWithFallback call counts ──────────────────
//
// Verifies that the resolver-layer controls whether OpenRouter is contacted at
// all.  We observe call counts on the chatWithFallback mock as the proxy:
//   • Success path → chatWithFallback called exactly once
//   • Error / empty-chain path → chatWithFallback called once (throws), no done event emitted
//   • Validation failure → chatWithFallback never called (guard fires before AI layer)

describe("INT-007 — chatWithFallback call counts prove the resolver controls request issuance", () => {
  it("should not call chatWithFallback when projectId validation fails", async () => {
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callCountBefore = vi.mocked(chatWithFallback).mock.calls.length;

    await request(app)
      .post("/api/ai/chat/stream")
      .send({ message: "no projectId" });

    // Validation guard must fire before the AI layer — zero new calls
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callCountBefore);
  });

  it("should call chatWithFallback exactly once on the success path", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callCountBefore = vi.mocked(chatWithFallback).mock.calls.length;

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId, message: "Single successful call" });

    expect(res.status).toBe(200);

    // Exactly one call — no unnecessary retries when the first attempt succeeds
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callCountBefore + 1);

    const events = parseSseEvents(res.text);
    const doneEvent = events.find((e) => e["type"] === "done");
    expect(doneEvent).toBeDefined();
  });

  it("passes an accessible project root to the agent with file tools enabled", async () => {
    const projectId = await insertProject("/tmp");
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    vi.mocked(chatWithFallback).mockClear();

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        message: "راجع ملفًا من المشروع باستخدام قراءة مصدر فعلية",
      });

    expect(res.status).toBe(200);
    const call = vi.mocked(chatWithFallback).mock.calls.at(-1);
    expect(call).toBeDefined();

    const input = call?.[1] as {
      rootPath?: string;
      projectId?: string;
    };
    const options = call?.[4] as {
      requireTools?: boolean;
      qualityProfile?: string;
    };

    expect(input.projectId).toBe(projectId);
    expect(input.rootPath).toBe("/tmp");
    expect(options).toEqual({
      requireTools: true,
      qualityProfile: "tool_chat",
    });

    const events = parseSseEvents(res.text);
    const done = events.find((event) => event["type"] === "done");
    const message = done?.["message"] as { toolTrace?: string | null } | undefined;
    const trace = message?.toolTrace
      ? JSON.parse(message.toolTrace) as Array<Record<string, unknown>>
      : [];
    expect(trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_call", tool: "read_file" }),
      expect.objectContaining({ kind: "tool_result", tool: "read_file" }),
    ]));
  });

  // AI-OBJ-005/007 (task #63): the stream entry point must accept and forward a
  // validated objective into chatWithFallback, and reject an invalid one BEFORE
  // opening any SSE/model turn. Without this, a real /api/ai/chat/stream request
  // would silently drop the objective and let every required claim/edge bypass
  // the Objective Completion Gate — even on the hierarchical/degradation paths.
  it("threads a request objective into chatWithFallback for the streaming Objective Completion Gate", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    vi.mocked(chatWithFallback).mockClear();

    const objective = {
      objectiveType: "PRODUCTION_REACHABILITY" as const,
      requiredClaims: [{ claimId: "unsafe-eval-present", text: "return eval(input)" }],
      requiredEvidenceEdges: [],
    };
    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId, message: "Цель: اثبات الوصول", objective });

    expect(res.status).toBe(200);
    const call = vi.mocked(chatWithFallback).mock.calls.at(-1);
    expect(call).toBeDefined();
    const input = call?.[1] as { objective?: unknown } | undefined;
    expect(input?.objective).toEqual(objective);
  });

  it("returns 400 before opening the SSE stream when the objective body is invalid", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const callCountBefore = vi.mocked(chatWithFallback).mock.calls.length;

    // requiredClaims is missing — must be rejected by the body schema, so the
    // Objective Completion Gate can never be silently disabled on the stream.
    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId,
        message: "check",
        objective: { objectiveType: "PRODUCTION_REACHABILITY" },
      });

    expect(res.status).toBe(400);
    expect(vi.mocked(chatWithFallback).mock.calls.length).toBe(callCountBefore);
  });

  it("should not issue OpenRouter requests when the resolved chain is empty (fetch = 0)", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const { GroqClientError } = await import("@workspace/ai-orchestrator");

    // Simulate the resolver finding an empty chain: chatWithFallback throws immediately
    // without making any HTTP calls to OpenRouter.
    vi.mocked(chatWithFallback).mockRejectedValueOnce(
      new GroqClientError("MODEL_NOT_FOUND", "All OpenRouter free-tier fallback models exhausted"),
    );

    const globalFetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn> | undefined)?.mock?.calls?.length ?? 0;

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId, message: "empty chain scenario" });

    expect(res.status).toBe(200);

    const events = parseSseEvents(res.text);
    const errorEvent = events.find((e) => e["type"] === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!["code"]).toBe("MODEL_NOT_FOUND");

    // No additional fetch calls to OpenRouter were made: the resolver stopped the chain
    const globalFetchCallsAfter = (global.fetch as ReturnType<typeof vi.fn> | undefined)?.mock?.calls?.length ?? 0;
    expect(globalFetchCallsAfter).toBe(globalFetchCallsBefore);
  });
});
