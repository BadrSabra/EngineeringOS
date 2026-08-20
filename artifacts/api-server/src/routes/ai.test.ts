/**
 * Smoke tests for ai.ts routes.
 *
 * All AI orchestrator calls are mocked — these tests verify the HTTP contract
 * (request validation, 400/404/409 paths, correct response shape, DB side
 * effects) without hitting the Groq API.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import app from "../app.js";
import {
  db,
  projectsTable,
  tasksTable,
  eventsTable,
  workflowsTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiApplyJournalTable,
  taskLogsTable,
  auditLogsTable,
} from "@workspace/db";
import { buildPatchHunks, hashPatchBase } from "@workspace/ai-orchestrator";
import * as repairValidation from "../lib/ai-repair-validation.js";
import { canCreateProposal } from "./ai/chat.js";
import { scheduleAiTaskExecution } from "./ai/tasks.js";

describe("verified repair proposal gate", () => {
  const change = {
    path: "lib/ai-orchestrator/src/unsafe.ts",
    newContent: "export const safe = true;",
    originalContent: null,
    reason: "Replace the unsafe path.",
    validationProfile: "ai-orchestrator-tests" as const,
  };
  const repairPlan = [{
    findingId: "F-1",
    files: [change.path],
    steps: ["Replace the unsafe path."],
    validationProfile: "ai-orchestrator-tests" as const,
    verdictScope: "PRODUCTION" as const,
    scopedFindingStatus: "PRODUCTION_PROVEN" as const,
  }];

  function traceWithAcceptedClaims(acceptedClaimCount: number): never[] {
    return [
      {
        kind: "forensic_status",
        auditScope: "PRODUCTION",
        productionReachability: "PROVEN",
        sourceCoverage: "COMPLETE",
        findingStatus: "PROVEN",
        repairReadiness: "READY",
      },
      {
        kind: "evidence_integrity",
        consistent: true,
        acceptedClaimCount,
      },
      {
        kind: "decision_trace",
        trace: { finalState: "VERIFIED" },
      },
    ] as never[];
  }

  it("rejects proposal creation until Finding claims are closed", () => {
    expect(canCreateProposal([change] as never, repairPlan, true, traceWithAcceptedClaims(0))).toBe(false);
    expect(canCreateProposal([change] as never, repairPlan, true, traceWithAcceptedClaims(1))).toBe(true);
  });
});

// ─── Orchestrator mock ────────────────────────────────────────────────────────
// Every export from @workspace/ai-orchestrator is replaced with a stub that
// returns a predictable, shape-correct response. Tests that need different
// behaviour override individual functions via vi.mocked(...).mockResolvedValue.

vi.mock("@workspace/ai-orchestrator", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
  // Spread the real module first so schemas the routes import at runtime
  // (EvidenceReferenceSchema, RepairPlanMetadataSchema, etc.) remain real.
  // The override keys below then replace the callables/registry as before.
  ...actual,
  // ── Provider registry ──────────────────────────────────────────────────────
  // providers.ts imports PROVIDER_REGISTRY and validateProviderKey at module
  // load time to build VALID_PROVIDERS. Without these the mock throws
  // "No PROVIDER_REGISTRY export defined" before any test runs.
  PROVIDER_REGISTRY: {
    groq: { providerId: "groq", label: "Groq", supportsStreaming: true, supportsTools: true, supportsJsonMode: true, consoleUrl: "console.groq.com", statusUrl: "status.groq.com", defaultModels: { fast: "llama-3.1-8b-instant", powerful: "llama-3.3-70b-versatile" } },
    deepseek: { providerId: "deepseek", label: "DeepSeek", supportsStreaming: true, supportsTools: true, supportsJsonMode: true, consoleUrl: "platform.deepseek.com", statusUrl: "platform.deepseek.com", defaultModels: { fast: "deepseek-chat", powerful: "deepseek-chat" } },
    gemini: { providerId: "gemini", label: "Gemini", supportsStreaming: true, supportsTools: false, supportsJsonMode: true, consoleUrl: "aistudio.google.com/apikey", statusUrl: "status.cloud.google.com", defaultModels: { fast: "gemini-2.0-flash", powerful: "gemini-2.0-flash" } },
    openrouter: { providerId: "openrouter", label: "OpenRouter", supportsStreaming: true, supportsTools: true, supportsJsonMode: true, consoleUrl: "openrouter.ai/keys", statusUrl: "openrouter.ai", defaultModels: { fast: "google/gemma-4-31b-it:free", powerful: "nvidia/nemotron-3-ultra-550b-a55b:free" } },
  },
  PROVIDER_PRIORITY: ["openrouter", "gemini", "deepseek", "groq"],
  getProvider: vi.fn((id: string) => {
    const registry: Record<string, { providerId: string; label: string }> = {
      groq: { providerId: "groq", label: "Groq" },
      deepseek: { providerId: "deepseek", label: "DeepSeek" },
      gemini: { providerId: "gemini", label: "Gemini" },
      openrouter: { providerId: "openrouter", label: "OpenRouter" },
    };
    if (!registry[id]) throw new Error(`Unknown provider: ${id}`);
    return registry[id];
  }),
  validateProviderKey: vi.fn(async () => ({ valid: true })),
  // ── Context + cache ────────────────────────────────────────────────────────
  buildProjectContext: vi.fn(async () => "mocked project context string"),
  // invalidateContextCache is a synchronous cache-bust helper called after
  // every mutating AI operation (Gap-2 fix). Must be in the mock so routes
  // that call it don't throw "undefined is not a function" in tests.
  invalidateContextCache: vi.fn(),
  // Gap-4 fix: chat mock now includes pendingChanges so the response shape
  // matches ChatOutput and the pendingChanges contract test below passes.
  chat: vi.fn(async () => ({
    response: "AI response text",
    sources: ["metrics", "tasks"],
    pendingChanges: [],
  })),
  // Gap-4 fix: analyzeScan mock updated to match ScanSummarySchema.
  // Removed stale fields: overallHealthAssessment, immediateActions, longTermRecommendations.
  // Added correct fields: overallAssessment, topPriority, estimatedImpact.
  // Insight shape uses `severity` (not `priority`) per ScanInsightSchema.
  analyzeScan: vi.fn(async () => ({
    summary: "Analysis complete",
    overallAssessment: "The codebase is in good overall health",
    insights: [{
      category: "security",
      severity: "high",
      title: "Mock insight",
      description: "desc",
      recommendation: "fix it",
    }],
    topPriority: "Address security vulnerabilities",
    estimatedImpact: "High — reduces attack surface significantly",
  })),
  // Gap-4 fix: reviewCode mock updated to match CodeReviewResultSchema.
  // Removed stale fields: criticalIssues, highIssues, mediumIssues, lowIssues.
  // Added correct fields: refactoringOpportunities, securityConcerns.
  reviewCode: vi.fn(async () => ({
    verdict: "approved",
    overallScore: 85,
    summary: "Looks good",
    issues: [],
    strengths: ["Clean code"],
    refactoringOpportunities: [],
    securityConcerns: [],
  })),
  // Gap-4 fix: orchestrateWorkflow mock updated to match WorkflowDecisionSchema.
  // action "advance" requires nextPhase (enforced by AdvanceDecisionSchema.strict()).
  // Removed stale fields: confidence, suggestedNextPhase, blockers.
  orchestrateWorkflow: vi.fn(async () => ({
    action: "advance",
    reasoning: "All conditions met",
    nextPhase: "Phase 2",
  })),
  // Gap-4 fix: executeTask mock updated to match TaskRecommendationSchema.
  // Removed stale fields: agentResponse, filesModified.
  // Added missing field: result (required by TaskRecommendationSchema.min(1)).
  executeTask: vi.fn(async () => ({
    summary: "Task completed by AI",
    confidence: "high",
    steps: ["Analyzed the codebase", "Applied fix"],
    result: "Task analyzed and fix applied successfully",
    needsHumanReview: false,
  })),
  parseWorkflowPhases: vi.fn((raw: unknown) => {
    // Minimal real implementation for tests: parse array of phase-like objects.
    if (!Array.isArray(raw)) return { ok: false, error: "phases must be an array" };
    return { ok: true, phases: raw };
  }),
  // GroqClientError must be a real class so handleOrchestratorError can use
  // `instanceof` checks. Without it vitest throws "No GroqClientError export".
  GroqClientError: class GroqClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "GroqClientError";
      this.code = code;
    }
  },
  // PR-07: circuit breaker — collectAvailableProviders calls isCircuitOpen for
  // every candidate provider. Must be in the mock or all routes that trigger
  // provider selection throw "No isCircuitOpen export defined on the mock".
  isCircuitOpen: vi.fn().mockReturnValue(false),
  // PR-05/PR-11: metrics recording helpers called from chat.ts after each
  // provider attempt.  Must be stubs so the recording calls are no-ops in tests.
  recordRequest:        vi.fn(),
  recordFailure:        vi.fn(),
  recordSuccess:        vi.fn(),
  recordFallbackSuccess: vi.fn(),
  recordInvalidModel:   vi.fn(),
  recordLatency:        vi.fn(),
  // Used by collectAvailableProviders to sort providers by quality profile.
  sortProviderIdsByQuality: vi.fn((ids: string[]) => ids),
  // classifyRequest is called by the chat route to determine prompt profile.
  classifyRequest: vi.fn(() => ({ category: "code", contextDepth: "full", historyDepth: 4, maxTokens: 4096, temperature: 0.2, qualityProfile: "code_review" })),
  isImmediateExecutionRequest: vi.fn((message: string) =>
    /^(?:نفذ|نفذها|طبق|طبقها|اصلح|اصلحها|ابدأ|ابدا|إبدأ|start|proceed|go\s+ahead|do\s+it|implement|apply|fix|patch|edit|modify|run|execute)(?:\s|$)/i.test(
      message.trim(),
    ),
  ),
  // enrichContextWithMemories and writeSessionMemories are called by the chat route.
  enrichContextWithMemories: vi.fn(async (ctx: string) => ctx),
  writeSessionMemories: vi.fn(async () => undefined),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `ai-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/ai-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertChangeProposal(
  projectId: string,
  changes: Array<{
    path: string;
    absolutePath: string;
    newContent: string;
    originalContent?: string | null;
    baseHash?: string;
    hunks?: Array<{
      startLine: number;
      endLine: number;
      expectedText: string;
      replacementText: string;
      reason: string;
    }>;
    reason?: string;
    validationProfile?: "ai-orchestrator-tests" | "knowledge-engine-tests" | "api-ai-tests" | "workspace-typecheck";
  }>,
): Promise<string> {
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const now = new Date();
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Test repair proposal",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Test repair proposal",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: JSON.stringify(changes.map((change) => ({
      path: change.path,
      absolutePath: change.absolutePath,
      newContent: change.newContent,
      originalContent: change.originalContent ?? null,
      ...(change.baseHash ? { baseHash: change.baseHash } : {}),
      ...(change.hunks ? { hunks: change.hunks } : {}),
      reason: change.reason ?? "Test proposal",
      ...(change.validationProfile ? { validationProfile: change.validationProfile } : {}),
    }))),
    status: "pending",
    createdAt: now,
  });
  return proposalId;
}

async function insertTask(projectId: string, status = "pending"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tasksTable).values({
    id,
    projectId,
    title: `AI task ${id.slice(0, 6)}`,
    description: "A task for AI to execute",
    status: status as "pending",
    priority: "p2",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertWorkflow(projectId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(workflowsTable).values({
    id,
    projectId,
    name: `AI Workflow ${id.slice(0, 6)}`,
    status: "running",
    phases: [{ name: "Phase 1", steps: ["step-a"] }, { name: "Phase 2", steps: ["step-b"] }],
    currentPhase: "Phase 1",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function insertImplementationPlan(projectId: string): Promise<string> {
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
      objective: "Add a safe feature",
      summary: "Inspect, implement, and validate the requested feature.",
      assumptions: [],
      steps: [{
        id: "step-1",
        title: "Inspect the target",
        description: "Confirm the current implementation before editing.",
        action: "inspect",
        files: ["src/feature.ts"],
        dependsOn: [],
        validation: ["Run the focused test"],
      }],
      validationCommands: ["pnpm test"],
      risks: [],
      approvalStatus: "PENDING_APPROVAL",
      writeAccess: "NOT_AUTHORIZED",
    }),
    createdAt: now,
  });
  return messageId;
}

const projectIds: string[] = [];
const workflowIds: string[] = [];

// All AI routes require a Groq API key. Set a dummy env key for the entire
// test file — every AI orchestrator call is mocked so the real key is never
// used.  Individual tests that want to verify the 428 path remove the key
// themselves and restore it in a finally block.
let _savedGroqKeyFileLevel: string | undefined;
beforeAll(() => {
  _savedGroqKeyFileLevel = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
});
afterAll(() => {
  if (_savedGroqKeyFileLevel !== undefined) {
    process.env.GROQ_API_KEY = _savedGroqKeyFileLevel;
  } else {
    delete process.env.GROQ_API_KEY;
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pid of projectIds.splice(0)) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, pid)).catch(() => undefined);
    await db.delete(taskLogsTable).where(eq(taskLogsTable.taskId, pid)).catch(() => undefined); // may not match, that's fine
    await db.delete(aiApplyJournalTable).where(eq(aiApplyJournalTable.projectId, pid)).catch(() => undefined);
    await db.delete(eventsTable).where(eq(eventsTable.projectId, pid)).catch(() => undefined);
    await db.delete(aiChatMessagesTable)
      .where(
        eq(
          aiChatMessagesTable.sessionId,
          db
            .select({ id: aiChatSessionsTable.id })
            .from(aiChatSessionsTable)
            .where(eq(aiChatSessionsTable.projectId, pid))
            .limit(1) as unknown as string,
        ),
      )
      .catch(() => undefined);
    // Clean sessions for this project
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
    await db.delete(tasksTable).where(eq(tasksTable.projectId, pid)).catch(() => undefined);
    for (const wid of workflowIds.splice(0)) {
      await db.delete(workflowsTable).where(eq(workflowsTable.id, wid)).catch(() => undefined);
    }
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
  // Also clear any lingering workflow ids
  for (const wid of workflowIds.splice(0)) {
    await db.delete(workflowsTable).where(eq(workflowsTable.id, wid)).catch(() => undefined);
  }
});

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

describe("POST /api/ai/chat", () => {
  it("returns 400 when projectId is missing", async () => {
    const res = await request(app).post("/api/ai/chat").send({ message: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it("returns 400 when message is missing", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it("returns 400 when message is blank", async () => {
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: randomUUID(), message: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 400 when proposalId is missing", async () => {
    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId: randomUUID(),
        changes: [{
          path: "a.ts",
          absolutePath: "/tmp/a.ts",
          newContent: "",
          originalContent: null,
          reason: "Test proposal",
          validationProfile: "api-ai-tests",
        }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("proposalId");
  });

  it("restores the pending proposal for its session", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const changes = [{
      path: "src/restore.ts",
      absolutePath: `/tmp/${randomUUID()}/src/restore.ts`,
      newContent: "export const restored = true;",
      originalContent: null,
      reason: "Restore test proposal",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(projectId, changes);
    const [proposal] = await db
      .select({
        sessionId: aiChangeProposalsTable.sessionId,
        messageId: aiChangeProposalsTable.messageId,
      })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId))
      .limit(1);

    const res = await request(app)
      .get(`/api/ai/chat/${proposal.sessionId}/pending-proposal`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proposalId,
      operationId: proposal.messageId,
      changes,
      approvalRequired: false,
      revision: 0,
    });
  });

  it("rejects a submitted payload that differs from the approved proposal", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const changes = [{
      path: "src/mismatch.ts",
      absolutePath: `/tmp/${randomUUID()}/src/mismatch.ts`,
      newContent: "export const approved = true;",
      originalContent: null,
      reason: "Mismatch test proposal",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(projectId, changes);
    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId,
        proposalId,
        changes: [{ ...changes[0], newContent: "export const tampered = true;" }],
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROPOSAL_MISMATCH");
  });

  it("does not consume a proposal when behavioral verification blocks the write", async () => {
    const projectId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `apply-replay-${projectId.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(projectId);
    const fileName = `apply-replay-${randomUUID().slice(0, 8)}.ts`;
    const changes = [{
      path: `lib/ai-orchestrator/${fileName}`,
      absolutePath: `/tmp/lib/ai-orchestrator/${fileName}`,
      newContent: "export const replay = true;",
      originalContent: null,
      reason: "Replay test proposal",
      validationProfile: "ai-orchestrator-tests" as const,
    }];
    const proposalId = await insertChangeProposal(projectId, changes);
    const body = { projectId, proposalId, changes };
    try {
      const first = await request(app).post("/api/ai/chat/apply-changes").send(body);
      expect(first.status).toBe(207);
      expect(first.body.results[0]).toMatchObject({
        ok: false,
        writeStatus: "not_written",
        persistenceVerified: false,
        behavioralVerification: { status: "unavailable" },
      });
      const second = await request(app).post("/api/ai/chat/apply-changes").send(body);
      expect(second.status).toBe(207);
      expect(second.body.results[0].behavioralVerification.status).toBe("unavailable");
      const [proposal] = await db
        .select({
          status: aiChangeProposalsTable.status,
          messageId: aiChangeProposalsTable.messageId,
        })
        .from(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.id, proposalId))
        .limit(1);
      expect(proposal?.status).toBe("pending");
    } finally {
      await fs.rm(`/tmp/lib/ai-orchestrator/${fileName}`, { force: true });
    }
  });

  it("creates a session and returns sessionId + message on first chat", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "What is the quality of this project?" });
    expect(res.status).toBe(200);
    expect(typeof res.body.sessionId).toBe("string");
    expect(res.body.message).toBeDefined();
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.message.content).toBe("AI response text");
    expect(Array.isArray(res.body.sources)).toBe(true);
  });

  it("returns execution trace separately from the assistant report", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "What is the quality of this project?" });

    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe("AI response text");
    expect(res.body.message.content).not.toContain("read_file");
    expect(res.body.message.toolTrace == null || typeof res.body.message.toolTrace === "string").toBe(true);
    expect(res.body.toolTrace).toBe(res.body.message.toolTrace);
  });

  it("includes pendingChanges array in the response", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "What files need changes?" });
    expect(res.status).toBe(200);
    // Gap-4: pendingChanges must be present in the response (was missing from
    // both the runtime response and the generated client contract before this fix).
    expect(Array.isArray(res.body.pendingChanges)).toBe(true);
  });

  it("forwards behaviorEvidence with exact sourceSpans in the non-streaming response", async () => {
    // Task #22 proved the SSE done event and GET /messages carry behaviorEvidence
    // with sourceSpan line ranges. The non-streaming POST /api/ai/chat is a
    // SEPARATE forward site (chat.ts res.json returns `result.behaviorEvidence`)
    // used by programmatic clients — a refactor could drop the line anchors there
    // without breaking the in-app SSE path, and only a non-streaming test catches
    // it. Mirror the GET /messages assertion so the parsed array (inkl. spans)
    // is locked in on this path too.
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockChat).mockResolvedValueOnce({
      response: "Grounded behavior answer",
      sources: ["src/loop.ts"],
      pendingChanges: [],
      behaviorEvidence: [
        {
          source: "src/loop.ts",
          excerpt: "if (maxIterations >= 20) return exhausted;",
          sourceSpan: { startLine: 1396, endLine: 1426 },
          supportsClaim: true,
          relevance: 0.9,
          directness: "DIRECT",
          sourceType: "IMPLEMENTATION",
          productionReachability: "NOT_PROVEN",
          evidenceClass: "BEHAVIOR_PROVEN",
        },
      ],
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "What happens when maxIterations is reached?" });
    expect(res.status).toBe(200);
    // Top-level behaviorEvidence mirrors the orchestrated chat() result, parsed
    // array (not a serialized string) so programmatic clients see the spans.
    expect(Array.isArray(res.body.behaviorEvidence)).toBe(true);
    expect(res.body.behaviorEvidence).toHaveLength(1);
    expect(res.body.behaviorEvidence[0]).toMatchObject({
      source: "src/loop.ts",
      excerpt: "if (maxIterations >= 20) return exhausted;",
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      sourceSpan: { startLine: 1396, endLine: 1426 },
    });

    // The persisted assistant message must round-trip the same parsed array via
    // GET /messages so a reloaded session keeps the source anchors too.
    const { sessionId } = res.body;
    const history = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(history.status).toBe(200);
    const assistant = history.body.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant.behaviorEvidence)).toBe(true);
    expect(assistant.behaviorEvidence[0]).toMatchObject({
      source: "src/loop.ts",
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      sourceSpan: { startLine: 1396, endLine: 1426 },
    });
  });

  // Task #63 — Objective Completion Gate production reachability. The gate is
  // implemented inside chat()/chatWithFallback; for it to actually fire on the
  // real entry points, the request body must accept a validated `objective` and
  // forward it into chat(). These endpoint tests pin that contract down.
  it("accepts a request objective and threads it into chat() for the Objective Completion Gate", async () => {
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockChat).mockClear();
    vi.mocked(mockChat).mockResolvedValueOnce({
      response: "AI response text",
      sources: [],
      pendingChanges: [],
    });
    const projectId = await insertProject();
    projectIds.push(projectId);

    const objective = {
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: [{ claimId: "unsafe-eval-present", text: "return eval(input)" }],
      requiredEvidenceEdges: [],
    };
    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Цель: доказать выполнимость", objective });

    expect(res.status).toBe(200);
    // The validated objective must reach the chat entry point, otherwise the
    // gate never runs on a real /api/ai/chat request.
    const chatCall = vi.mocked(mockChat).mock.calls.at(-1)?.[0] as
      { objective?: typeof objective } | undefined;
    expect(chatCall?.objective).toEqual(objective);
  });

  it("returns 400 when the objective body fails ObjectiveContractSchema validation", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // requiredClaims is missing — must be rejected before chat() is touched.
    const res = await request(app)
      .post("/api/ai/chat")
      .send({
        projectId,
        message: "check",
        objective: { objectiveType: "PRODUCTION_REACHABILITY" },
      });
    expect(res.status).toBe(400);
  });

  // PR-E (updated): _parseError with a non-empty fallback response → 200, not 422.
  // DeepSeek (and other providers) may return valid text without strict JSON schema
  // compliance; the fallback extracts the response and the route should deliver it.
  it("returns 200 with fallback when chat has _parseError but non-empty response", async () => {
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockChat).mockResolvedValueOnce({
      response: "fallback text",
      sources: ["project context"],
      pendingChanges: [],
      _parseError: { code: "SCHEMA_VALIDATION_FAILED", message: "response: min 1", raw: "bad model output" },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "trigger parse failure" });
    // Fallback produced a usable response — expect 200 with the message.
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  // PR-E: hard-fail (422) only when the model returned an empty/unusable response.
  it("returns 422 with model_output_invalid when chat returns _parseError with empty response", async () => {
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockChat).mockResolvedValueOnce({
      response: "",
      sources: [],
      pendingChanges: [],
      _parseError: { code: "SCHEMA_VALIDATION_FAILED", message: "response: min 1", raw: "bad model output" },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "trigger hard parse failure" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("model_output_invalid");
    expect(res.body.code).toBe("model_output_invalid");
    expect(typeof res.body.hint).toBe("string");
    expect(res.body.raw).toBeUndefined();
    expect(res.body.parseCode).toBe("SCHEMA_VALIDATION_FAILED");
  });

  it("reuses an existing session when sessionId is provided", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // First message creates a session
    const first = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Hello" });
    expect(first.status).toBe(200);
    const { sessionId } = first.body;

    // Second message reuses it
    const second = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Follow-up", sessionId });
    expect(second.status).toBe(200);
    expect(second.body.sessionId).toBe(sessionId);

    // DB: session has messages from both turns
    const messages = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.sessionId, sessionId));
    // 2 user + 2 assistant = 4 messages
    expect(messages.length).toBe(4);
  });

  it("restores a JSON continuation but isolates later neutral chat from stale forensic state", async () => {
    const { chat: mockChat, classifyRequest: mockClassifyRequest } = await import("@workspace/ai-orchestrator");
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
    vi.mocked(mockChat).mockClear();
    const repairPlan = [{
      findingId: "F-1",
      files: ["src/unsafe.ts"],
      steps: ["Replace the unsafe evaluation path."],
      validationProfile: "ai-orchestrator-tests" as const,
      verdictScope: "PRODUCTION" as const,
      scopedFindingStatus: "PRODUCTION_PROVEN" as const,
    }];
    vi.mocked(mockChat).mockResolvedValue({
      response: "Audit response",
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
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const first = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "forensic audit" });
    expect(first.status).toBe(200);
    const { sessionId } = first.body;

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

    const second = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, sessionId, message: "أكمل" });
    expect(second.status).toBe(200);

    const continuationCall = vi.mocked(mockChat).mock.calls.at(-1)?.[0] as {
      activeTaskState?: { taskType?: string; scope?: { projectId?: string } };
    } | undefined;
    expect(continuationCall?.activeTaskState).toMatchObject({
      taskType: "FULL_FORENSIC_AUDIT",
      scope: { projectId },
    });

    const neutral = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, sessionId, message: "Tell me a joke" });
    expect(neutral.status).toBe(200);

    const neutralCall = vi.mocked(mockChat).mock.calls.at(-1)?.[0] as {
      activeTaskState?: unknown;
      turnIntent?: {
        kind?: string;
        executionTaskType?: string;
        requiresTools?: boolean;
        requiresEvidence?: boolean;
      };
    } | undefined;
    expect(neutralCall?.activeTaskState).toBeNull();
    expect(neutralCall?.turnIntent).toMatchObject({
      kind: "CHAT",
      executionTaskType: "chat",
      requiresTools: false,
      requiresEvidence: false,
    });
  });

  it("rejects Repair Plan execution without the original session before calling the model", async () => {
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    const mockedChat = vi.mocked(mockChat);
    const callsBefore = mockedChat.mock.calls.length;
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "نفذ Repair Plan" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("execution_session_required");
    expect(mockedChat.mock.calls.length).toBe(callsBefore);
  });

  it("rejects an unknown sessionId instead of silently creating a new session", async () => {
    const { chat: mockChat } = await import("@workspace/ai-orchestrator");
    const mockedChat = vi.mocked(mockChat);
    const callsBefore = mockedChat.mock.calls.length;
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, sessionId: randomUUID(), message: "Hello" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
    expect(mockedChat.mock.calls.length).toBe(callsBefore);
  });
});

// ─── GET /api/ai/chat/sessions ────────────────────────────────────────────────

describe("GET /api/ai/chat/sessions", () => {
  it("returns 400 when projectId is missing", async () => {
    const res = await request(app).get("/api/ai/chat/sessions");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it("returns 200 with sessions for a project", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Create a session via chat
    await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Session list test" });

    const res = await request(app).get(`/api/ai/chat/sessions?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].projectId).toBe(projectId);
  });

  it("returns an empty array for a project with no sessions", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).get(`/api/ai/chat/sessions?projectId=${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns stable derived forensic statuses after history reload", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const now = new Date();
    const incompleteSessionId = randomUUID();
    const noFindingSessionId = randomUUID();
    const findingProvenSessionId = randomUUID();
    const notProvenSessionId = randomUUID();

    await db.insert(aiChatSessionsTable).values([
      {
        id: incompleteSessionId,
        projectId,
        title: "Incomplete audit",
        createdAt: new Date(now.getTime() - 1000),
        updatedAt: new Date(now.getTime() - 1000),
      },
      {
        id: noFindingSessionId,
        projectId,
        title: "No finding audit",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: findingProvenSessionId,
        projectId,
        title: "Finding proven audit",
        createdAt: new Date(now.getTime() + 1000),
        updatedAt: new Date(now.getTime() + 1000),
      },
      {
        id: notProvenSessionId,
        projectId,
        title: "Not proven audit",
        createdAt: new Date(now.getTime() + 2000),
        updatedAt: new Date(now.getTime() + 2000),
      },
    ]);
    await db.insert(aiChatMessagesTable).values([
      {
        id: randomUUID(),
        sessionId: incompleteSessionId,
        role: "assistant",
        content: "ANALYSIS_INCOMPLETE — the audit was cancelled before coverage completed.",
        createdAt: new Date(now.getTime() - 1000),
      },
      {
        id: randomUUID(),
        sessionId: noFindingSessionId,
        role: "assistant",
        content: "## 6) Final Judgment\nNO FINDING",
        createdAt: now,
      },
      {
        id: randomUUID(),
        sessionId: findingProvenSessionId,
        role: "assistant",
        content: "## 6) Final Judgment\nFINDING PROVEN",
        createdAt: new Date(now.getTime() + 1000),
      },
      {
        id: randomUUID(),
        sessionId: notProvenSessionId,
        role: "assistant",
        content: "## 6) Final Judgment\nNOT PROVEN",
        createdAt: new Date(now.getTime() + 2000),
      },
    ]);

    const res = await request(app).get(`/api/ai/chat/sessions?projectId=${projectId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: incompleteSessionId, forensicStatus: "INCOMPLETE" }),
      expect.objectContaining({ id: noFindingSessionId, forensicStatus: "NO_FINDING" }),
      expect.objectContaining({ id: findingProvenSessionId, forensicStatus: "FINDING_PROVEN" }),
      expect.objectContaining({ id: notProvenSessionId, forensicStatus: "NOT_PROVEN" }),
    ]));
  });
});

// ─── GET /api/ai/chat/:sessionId/messages ─────────────────────────────────────

describe("GET /api/ai/chat/:sessionId/messages", () => {
  it("returns an empty array for an unknown session (not 404)", async () => {
    // The route does not 404 — it returns the messages for the session (empty).
    const res = await request(app).get(`/api/ai/chat/${randomUUID()}/messages`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns messages in chronological order", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const chatRes = await request(app)
      .post("/api/ai/chat")
      .send({ projectId, message: "Chrono test" });
    const { sessionId } = chatRes.body;

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // user + assistant
    expect(res.body[0].role).toBe("user");
    expect(res.body[1].role).toBe("assistant");
  });

  it("returns a persisted message with parsed behaviorEvidence preserving source spans", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Persist an assistant message whose behaviorEvidence column holds the
    // serialized evidence. The route must parse it back into an array with the
    // exact sourceSpans analysts rely on — a refactor that stops parsing it
    // leaves the wire contract broken.
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Evidence session",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content: "Grounded behavior answer",
      behaviorEvidence: JSON.stringify([
        {
          source: "src/loop.ts",
          excerpt: "const result = await chat(...)",
          sourceSpan: { startLine: 1396, endLine: 1426 },
          supportsClaim: true,
          evidenceClass: "BEHAVIOR_PROVEN",
        },
      ]),
      createdAt: now,
    });

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    const assistant = res.body.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(Array.isArray(assistant.behaviorEvidence)).toBe(true);
    expect(assistant.behaviorEvidence).toHaveLength(1);
    expect(assistant.behaviorEvidence[0]).toMatchObject({
      source: "src/loop.ts",
      excerpt: "const result = await chat(...)",
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      sourceSpan: { startLine: 1396, endLine: 1426 },
    });
  });

  it("returns a persisted message with parsed taskResult so a reloaded session keeps its typed panel", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Persist an assistant message whose taskResult column holds the serialized
    // AI-008 typed result. The route must parse it back into the discriminated
    // object so a reloaded/history session renders the same per-kind panel the
    // live SSE path does — dropping this parse leaves the panel empty on reload.
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "TaskResult session",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content: "Repair plan ready.",
      taskResult: JSON.stringify({
        kind: "REPAIR_RESULT",
        phases: [
          {
            findingId: "F-1",
            files: ["src/loop.ts"],
            steps: ["Add an early return when the max is reached."],
            validationProfile: "ai-orchestrator-tests",
          },
        ],
        readiness: "READY",
      }),
      createdAt: now,
    });

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    const assistant = res.body.find((m: { role: string }) => m.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant.taskResult).toMatchObject({
      kind: "REPAIR_RESULT",
      readiness: "READY",
    });
    expect(assistant.taskResult.phases).toHaveLength(1);
    expect(assistant.taskResult.phases[0]).toMatchObject({
      findingId: "F-1",
      files: ["src/loop.ts"],
      validationProfile: "ai-orchestrator-tests",
    });
  });

  it("preserves a WORKSPACE_REVIEW_RESULT through persisted history reload", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Workspace review session",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content: "Workspace review remains NOT PROVEN.",
      taskResult: JSON.stringify({
        kind: "WORKSPACE_REVIEW_RESULT",
        report: "Workspace review remains NOT PROVEN without completed source reads.",
        evidence: [],
      }),
      createdAt: now,
    });

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    const assistant = res.body.find((m: { role: string }) => m.role === "assistant");
    expect(assistant?.taskResult).toMatchObject({
      kind: "WORKSPACE_REVIEW_RESULT",
      evidence: [],
    });
  });

  it("renders generic assistant messages without a taskResult (null-equivalent)", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Generic session",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content: "Just prose.",
      createdAt: now,
    });

    const res = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(res.status).toBe(200);
    const assistant = res.body.find((m: { role: string }) => m.role === "assistant");
    expect(assistant.taskResult).toBeUndefined();
  });
});

describe("GET /api/ai/chat/file-content", () => {
  const LINES = [
    "line1", "line2", "line3", "line4", "line5", "line6", "line7", "line8",
  ];

  async function insertProjectWithFile(contents: string[]): Promise<string> {
    const id = randomUUID();
    const root = `/tmp/ai-test-${id}`;
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `ai-file-${id.slice(0, 8)}`,
      rootPath: root,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await fs.mkdir(`${root}/src`, { recursive: true });
    await fs.writeFile(`${root}/src/loop.ts`, contents.join("\n").concat("\n"), "utf-8");
    return id;
  }

  it("returns the REAL source lines for the requested window, not a trimmed excerpt", async () => {
    const projectId = await insertProjectWithFile(LINES);
    projectIds.push(projectId);
    // The excerpt in the evidence is a single trimmed line, but the sourceSpan
    // is wider (start=3 end=6). The endpoint must serve the actual file lines
    // for that window so the viewer never fabricates offsets from the excerpt.
    const res = await request(app)
      .get(`/api/ai/chat/file-content?projectId=${projectId}&path=src/loop.ts&startLine=3&endLine=6`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.path).toBe("src/loop.ts");
    expect(res.body.startLine).toBe(3);
    expect(res.body.endLine).toBe(6);
    expect(res.body.lines).toEqual([
      { line: 3, text: "line3" },
      { line: 4, text: "line4" },
      { line: 5, text: "line5" },
      { line: 6, text: "line6" },
    ]);
  });

  it("bounds a window that exceeds the file length and reports truncation", async () => {
    const projectId = await insertProjectWithFile(LINES);
    projectIds.push(projectId);
    const res = await request(app)
      .get(`/api/ai/chat/file-content?projectId=${projectId}&path=src/loop.ts&startLine=4&endLine=100`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.endLine).toBe(LINES.length); // clamped to the real EOF
    expect(res.body.truncated).toBe(true);
    expect(res.body.fileLines).toBe(LINES.length);
  });

  it("rejects parent-traversal paths before touching the filesystem", async () => {
    const projectId = await insertProjectWithFile(LINES);
    projectIds.push(projectId);
    const res = await request(app)
      .get(`/api/ai/chat/file-content?projectId=${projectId}&path=../etc/passwd&startLine=1`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_PATH_INVALID");
  });

  it("returns available:false when the file is missing (never an uncaught 500)", async () => {
    const projectId = await insertProjectWithFile(LINES);
    projectIds.push(projectId);
    const res = await request(app)
      .get(`/api/ai/chat/file-content?projectId=${projectId}&path=src/missing.ts&startLine=1`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("file_not_found");
  });

  it("requires a path parameter", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const res = await request(app).get(`/api/ai/chat/file-content?projectId=${projectId}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_PATH_REQUIRED");
  });

  it("never serves files from the shared workspace when the project root is inaccessible", async () => {
    // Register a project whose configured root does not exist on disk. The
    // endpoint must NOT fall back to the global workspace root (whose package.json
    // is readable) — that fallback would let any project-authorized user pull in
    // arbitrary files (.env, etc.) from OTHER projects in the shared workspace.
    const id = randomUUID();
    const now = new Date();
    const goneRoot = `/tmp/ai-test-gone-${id}`;
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `ai-gone-${id.slice(0, 8)}`,
      rootPath: goneRoot,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    // Confirm the workspace file we are trying to protect is actually readable,
    // so this test would genuinely fail if the endpoint fell back to workspace.
    const knownWorkspaceFile = "package.json";
    await expect(fs.access(`/home/runner/workspace/${knownWorkspaceFile}`)).resolves.toBeUndefined();

    const res = await request(app)
      .get(`/api/ai/chat/file-content?projectId=${id}&path=${knownWorkspaceFile}&startLine=1`);
    expect(res.status).toBe(200);
    // Not the workspace file's content — the request is refused as unavailable.
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe("project_root_unavailable");
    expect(res.body.lines).toBeUndefined();
  });
});

// ─── POST /api/ai/projects/:projectId/analyze ─────────────────────────────────

describe("POST /api/ai/projects/:projectId/analyze", () => {
  it("returns 200 with analysis result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).post(`/api/ai/projects/${projectId}/analyze`);
    expect(res.status).toBe(200);
    expect(typeof res.body.summary).toBe("string");
    expect(Array.isArray(res.body.insights)).toBe(true);
  });

  it("creates an AiScanAnalysisCompleted event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    await request(app).post(`/api/ai/projects/${projectId}/analyze`);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiScanAnalysisCompleted");
    expect(ev).toBeDefined();
  });

  // PR-E: parse failure surfaced as 422 instead of silent degraded 200.
  it("returns 422 with model_output_invalid when analyzeScan returns _parseError", async () => {
    const { analyzeScan: mockAnalyzeScan } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockAnalyzeScan).mockResolvedValueOnce({
      summary: "fallback",
      overallAssessment: "fallback",
      insights: [],
      topPriority: "fallback",
      estimatedImpact: "fallback",
      _parseError: {
        code: "MALFORMED_JSON",
        message: "JSON parse error from /tmp/parser-output.txt (request req-analysis-123)",
        raw: "not json",
      },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).post(`/api/ai/projects/${projectId}/analyze`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("model_output_invalid");
    expect(res.body.code).toBe("model_output_invalid");
    expect(res.body.parseCode).toBe("MALFORMED_JSON");
    expect(typeof res.body.hint).toBe("string");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("not json");
    expect(serialized).not.toContain("JSON parse error");
    expect(serialized).not.toContain("req-analysis-123");
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("streams the structured analysis lifecycle and result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).post(`/api/ai/projects/${projectId}/analyze/stream`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"type":"task_started"');
    expect(res.text).toContain('"stage":"building-context"');
    expect(res.text).toContain('"stage":"calling-model"');
    expect(res.text).toContain('"type":"task_done"');
    expect(res.text).toContain('"summary":"Analysis complete"');
  });
});

// ─── POST /api/ai/projects/:projectId/review ──────────────────────────────────

describe("POST /api/ai/projects/:projectId/review", () => {
  it("returns 200 with code review result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post(`/api/ai/projects/${projectId}/review`)
      .send({ fileContents: { "index.ts": "const x = 1;" } });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("approved");
    expect(typeof res.body.overallScore).toBe("number");
  });

  it("creates an AiCodeReviewCompleted event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    await request(app).post(`/api/ai/projects/${projectId}/review`).send({});

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiCodeReviewCompleted");
    expect(ev).toBeDefined();
    expect(ev?.severity).toBe("success"); // verdict === "approved"
  });

  // PR-E: parse failure surfaced as 422 instead of silent degraded 200.
  it("returns 422 with model_output_invalid when reviewCode returns _parseError", async () => {
    const { reviewCode: mockReviewCode } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockReviewCode).mockResolvedValueOnce({
      summary: "fallback",
      overallScore: 70,
      strengths: [],
      issues: [],
      refactoringOpportunities: [],
      securityConcerns: [],
      verdict: "needs_changes",
      _parseError: { code: "SCHEMA_VALIDATION_FAILED", message: "missing field", raw: "bad output" },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app).post(`/api/ai/projects/${projectId}/review`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("model_output_invalid");
    expect(res.body.code).toBe("model_output_invalid");
    expect(res.body.parseCode).toBe("SCHEMA_VALIDATION_FAILED");
    expect(typeof res.body.hint).toBe("string");
  });

  it("streams the structured review lifecycle and result", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    const res = await request(app)
      .post(`/api/ai/projects/${projectId}/review/stream`)
      .send({ fileContents: { "index.ts": "const x = 1;" } });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain('"type":"task_started"');
    expect(res.text).toContain('"stage":"building-context"');
    expect(res.text).toContain('"stage":"calling-model"');
    expect(res.text).toContain('"type":"task_done"');
    expect(res.text).toContain('"verdict":"approved"');
  });
});

// ─── POST /api/ai/workflows/:workflowId/orchestrate ───────────────────────────

describe("POST /api/ai/workflows/:workflowId/orchestrate", () => {
  it("returns 404 for an unknown workflow", async () => {
    const res = await request(app)
      .post(`/api/ai/workflows/${randomUUID()}/orchestrate`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Workflow not found");
  });

  it("returns 200 with an orchestration decision for a known workflow", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const workflowId = await insertWorkflow(projectId);
    workflowIds.push(workflowId);

    const res = await request(app)
      .post(`/api/ai/workflows/${workflowId}/orchestrate`)
      .send({ additionalContext: "all tests passing" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("advance");
    expect(typeof res.body.reasoning).toBe("string");
  });

  it("creates an AiWorkflowOrchestration event", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const workflowId = await insertWorkflow(projectId);
    workflowIds.push(workflowId);

    await request(app).post(`/api/ai/workflows/${workflowId}/orchestrate`).send({});

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const ev = events.find((e) => e.type === "AiWorkflowOrchestration");
    expect(ev).toBeDefined();
  });

  // PR-E: parse failure surfaced as 422 instead of a silent degraded "wait" 200.
  it("returns 422 with model_output_invalid when orchestrateWorkflow returns _parseError", async () => {
    const { orchestrateWorkflow: mockOrchestrate } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockOrchestrate).mockResolvedValueOnce({
      action: "wait",
      reasoning: "fallback — model output could not be parsed",
      _parseError: {
        code: "EMPTY_MODEL_RESPONSE",
        message: "Model returned an empty response from /var/task/workflow-parser.log (request req-workflow-456)",
        raw: "provider raw workflow output",
      },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);
    const workflowId = await insertWorkflow(projectId);
    workflowIds.push(workflowId);

    const res = await request(app).post(`/api/ai/workflows/${workflowId}/orchestrate`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("model_output_invalid");
    expect(res.body.code).toBe("model_output_invalid");
    expect(res.body.parseCode).toBe("EMPTY_MODEL_RESPONSE");
    expect(typeof res.body.hint).toBe("string");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("Model returned an empty response");
    expect(serialized).not.toContain("provider raw workflow output");
    expect(serialized).not.toContain("req-workflow-456");
    expect(serialized).not.toContain("/var/task/");
    expect(serialized).not.toContain("/tmp/");
  });
});

// ─── POST /api/ai/tasks/:taskId/execute ──────────────────────────────────────

// ─── POST /api/ai/chat/apply-changes ─────────────────────────────────────────

describe("POST /api/ai/chat/plans/:messageId/decision", () => {
  it("persists approval and stages the plan for Build Mode without applying files", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const messageId = await insertImplementationPlan(projectId);

    const res = await request(app)
      .post(`/api/ai/chat/plans/${messageId}/decision`)
      .send({ decision: "approve" });

    expect(res.status).toBe(200);
    expect(res.body.messageId).toBe(messageId);
    expect(res.body.taskResult.approvalStatus).toBe("APPROVED");
    expect(res.body.taskResult.writeAccess).toBe("APPROVED_FOR_BUILD");

    const [message] = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.id, messageId))
      .limit(1);
    const persisted = JSON.parse(message!.taskResult!);
    expect(persisted.approvalStatus).toBe("APPROVED");
    expect(persisted.writeAccess).toBe("APPROVED_FOR_BUILD");
  });

  it("allows only one decision for a pending plan", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const messageId = await insertImplementationPlan(projectId);

    const first = await request(app)
      .post(`/api/ai/chat/plans/${messageId}/decision`)
      .send({ decision: "reject" });
    const second = await request(app)
      .post(`/api/ai/chat/plans/${messageId}/decision`)
      .send({ decision: "approve" });

    expect(first.status).toBe(200);
    expect(first.body.taskResult.approvalStatus).toBe("REJECTED");
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("PLAN_DECISION_ALREADY_MADE");
  });

  it("blocks approval when the plan has no safe file scope", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const messageId = await insertImplementationPlan(projectId);
    const [message] = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.id, messageId))
      .limit(1);
    const taskResult = JSON.parse(message!.taskResult!);
    taskResult.steps[0].files = [];
    await db
      .update(aiChatMessagesTable)
      .set({ taskResult: JSON.stringify(taskResult) })
      .where(eq(aiChatMessagesTable.id, messageId));

    const res = await request(app)
      .post(`/api/ai/chat/plans/${messageId}/decision`)
      .send({ decision: "approve" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLAN_FILE_SCOPE_REQUIRED");
    const [persisted] = await db
      .select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.id, messageId))
      .limit(1);
    expect(JSON.parse(persisted!.taskResult!).approvalStatus).toBe("PENDING_APPROVAL");
  });

  it("rejects malformed decisions before reading or changing a plan", async () => {
    const res = await request(app)
      .post(`/api/ai/chat/plans/${randomUUID()}/decision`)
      .send({ decision: "build" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PLAN_DECISION_INVALID");
  });
});

describe("POST /api/ai/chat/apply-changes", () => {
  it("returns 400 when changes array is missing", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({ projectId });
    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is missing", async () => {
    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({ changes: [{ path: "a.ts", absolutePath: "/tmp/a.ts", newContent: "" }] });
    expect(res.status).toBe(400);
  });

  it("emits a warning AiChangesApplied event when no file can be written", async () => {
    // Use /tmp as the project rootPath but point the change outside the root so
    // the handler records a no-op apply with an event/audit trail.
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-test-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);
    const proposalChanges = [{
      path: "escape.txt",
      absolutePath: "/etc/escape.txt",
      newContent: "// blocked",
      originalContent: null,
      reason: "Test proposal",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId: id,
        proposalId,
        changes: proposalChanges,
      });
    expect(res.status).toBe(207);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].ok).toBe(false);

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, id));
    const ev = events.find((e) => e.type === "AiChangesApplied");
    expect(ev).toBeDefined();
    expect(ev?.severity).toBe("warning");
    expect((ev?.payload as { appliedFiles?: string[] })?.appliedFiles ?? []).toHaveLength(0);
  });

  it("rolls back a persisted change when behavioral verification is unavailable", async () => {
    // Use /tmp as the project rootPath. The registered validation profile is
    // intentionally unavailable there, so a write must be rolled back.
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-test-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `lib/ai-orchestrator/apply-test-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      newContent: "// applied",
      originalContent: null,
      reason: "Test proposal",
      validationProfile: "ai-orchestrator-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);
    const res = await request(app)
      .post("/api/ai/chat/apply-changes")
      .send({
        projectId: id,
        proposalId,
        changes: proposalChanges,
      });
    expect(res.status).toBe(207);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      ok: false,
      writeStatus: "not_written",
      persistenceVerified: false,
      behavioralVerification: { status: "unavailable" },
    });
    expect(res.body.results[0].error).toContain("rolled back");
    await expect(fs.access(absolutePath)).rejects.toThrow();

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, id));
    const ev = events.find((e) => e.type === "AiChangesApplied");
    expect(ev).toBeDefined();
    expect(ev?.severity).toBe("warning");
    expect(
      (ev?.payload as { appliedFiles?: string[] })?.appliedFiles,
    ).toEqual([]);
    const [proposal] = await db
      .select()
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId))
      .limit(1);
    expect(proposal?.status).toBe("pending");
  });

  it("fails closed when behavioral rollback cannot be verified", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-rollback-failure-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `lib/ai-orchestrator/apply-rollback-failure-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      newContent: "export const rollbackFailure = true;",
      originalContent: null,
      reason: "Rollback failure test proposal",
      validationProfile: "ai-orchestrator-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);
    const originalUnlink = fs.unlink.bind(fs);
    const unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(async (target) => {
      if (String(target) === absolutePath) {
        throw new Error("simulated rollback permission failure");
      }
      return originalUnlink(target);
    });

    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id,
          proposalId,
          changes: proposalChanges,
        });

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        applyStatus: "ROLLBACK_FAILED",
        rollbackFailures: [{
          path: fileName,
          error: "simulated rollback permission failure",
        }],
      });
      expect(res.body.results[0]).toMatchObject({
        ok: false,
        writeStatus: "unknown",
        persistenceVerified: false,
      });
      expect(res.body.results[0].error).toContain("filesystem state is unknown");
      await expect(fs.readFile(absolutePath, "utf8"))
        .resolves.toBe(proposalChanges[0].newContent);

      const [proposal] = await db
        .select({
          status: aiChangeProposalsTable.status,
          messageId: aiChangeProposalsTable.messageId,
        })
        .from(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.id, proposalId))
        .limit(1);
      expect(proposal?.status).toBe("pending");

      const events = await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.projectId, id));
      const event = events.find((candidate) => candidate.type === "AiChangesApplied");
      expect(event?.severity).toBe("error");
      expect((event?.payload as { applyStatus?: string })?.applyStatus)
        .toBe("ROLLBACK_FAILED");

      const journal = await db
        .select()
        .from(aiApplyJournalTable)
        .where(eq(aiApplyJournalTable.operationId, proposal?.messageId ?? proposalId));
      expect(journal.length).toBeGreaterThanOrEqual(2);
      expect(journal.at(-1)?.stage).toBe("ROLLBACK_FAILED");
      expect(journal.at(-1)?.payload).toMatchObject({
        appliedFiles: [],
        failedFiles: [fileName],
        rollbackFailures: [{
          path: fileName,
          error: "simulated rollback permission failure",
        }],
      });
      expect(new Set(journal.map((entry) => entry.attemptId)).size).toBe(1);
      expect(journal.map((entry) => entry.sequence))
        .toEqual([...journal].sort((a, b) => a.sequence - b.sequence).map((entry) => entry.sequence));
    } finally {
      unlinkSpy.mockRestore();
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("blocks a destructive source-file replacement and leaves the original intact", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-guard-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-guard-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = [
      "export function completeRaw() { return 'raw'; }",
      "export function completeStream() { return 'stream'; }",
      "// preserved source content",
      "const padding = " + JSON.stringify("x".repeat(700)) + ";",
    ].join("\n");
    await fs.writeFile(absolutePath, original, "utf-8");
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      newContent: "export function complete() {}",
      originalContent: original,
      reason: "Test proposal",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id,
          proposalId,
          changes: proposalChanges,
        });

      expect(res.status).toBe(207);
      expect(res.body.results[0].ok).toBe(false);
      expect(res.body.results[0].error).toContain("destructive");
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("does not partially apply a safe sibling when another change is destructive", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-atomic-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const dangerousName = `apply-atomic-dangerous-${randomUUID().slice(0, 8)}.ts`;
    const safeName = `apply-atomic-safe-${randomUUID().slice(0, 8)}.ts`;
    const dangerousPath = `/tmp/${dangerousName}`;
    const safePath = `/tmp/${safeName}`;
    const original = [
      "export function completeRaw() { return 'raw'; }",
      "const padding = " + JSON.stringify("x".repeat(700)) + ";",
    ].join("\n");
    await fs.writeFile(dangerousPath, original, "utf-8");
    const proposalChanges = [
      {
        path: dangerousName,
        absolutePath: dangerousPath,
        newContent: "export function complete() {}",
        originalContent: original,
        reason: "Test proposal",
        validationProfile: "api-ai-tests" as const,
      },
      {
        path: safeName,
        absolutePath: safePath,
        newContent: "export const safe = true;",
        originalContent: null,
        reason: "Test proposal",
        validationProfile: "api-ai-tests" as const,
      },
    ];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id,
          proposalId,
          changes: [
            ...proposalChanges,
          ],
        });

      expect(res.status).toBe(207);
      expect(res.body.results.every((result: { ok: boolean }) => !result.ok)).toBe(true);
      expect(await fs.readFile(dangerousPath, "utf-8")).toBe(original);
      await expect(fs.access(safePath)).rejects.toThrow();
    } finally {
      await fs.rm(dangerousPath, { force: true });
      await fs.rm(safePath, { force: true });
    }
  });

  it("rejects applying a pending change when the file changed after proposal", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-stale-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-stale-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    await fs.writeFile(absolutePath, "export const current = true;\n", "utf-8");
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      originalContent: "export const old = true;\n",
      newContent: "export const next = true;\n",
      reason: "Test proposal",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);
    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id,
          proposalId,
          changes: [{
            ...proposalChanges[0],
          }],
        });
      expect(res.status).toBe(207);
      expect(res.body.results[0].ok).toBe(false);
      expect(res.body.results[0].error).toContain("changed after");
      expect(await fs.readFile(absolutePath, "utf-8")).toBe("export const current = true;\n");
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("returns a base-hash conflict and never writes a stale patch", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-hash-conflict-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-hash-conflict-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "export const before = true;\n";
    const replacement = "export const after = true;\n";
    await fs.writeFile(absolutePath, original, "utf-8");
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      originalContent: original,
      baseHash: hashPatchBase(original),
      hunks: buildPatchHunks(original, replacement, "Replace the guarded value"),
      newContent: replacement,
      reason: "Replace the guarded value",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      await fs.writeFile(absolutePath, "export const userEdit = true;\n", "utf-8");
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: proposalChanges });

      expect(res.status).toBe(207);
      expect(res.body.results[0]).toMatchObject({
        ok: false,
        code: "STALE_BASE",
        conflict: { kind: "base_hash_mismatch" },
      });
      expect(await fs.readFile(absolutePath, "utf-8")).toBe("export const userEdit = true;\n");
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("aborts the whole batch when one accepted change has a stale base", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-mixed-stale-base-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const staleName = `apply-mixed-stale-${randomUUID().slice(0, 8)}.ts`;
    const validName = `apply-mixed-valid-${randomUUID().slice(0, 8)}.ts`;
    const stalePath = `/tmp/${staleName}`;
    const validPath = `/tmp/${validName}`;
    const staleOriginal = "export const stale = false;\n";
    const validOriginal = "export const valid = false;\n";
    await fs.writeFile(stalePath, staleOriginal, "utf-8");
    await fs.writeFile(validPath, validOriginal, "utf-8");

    const staleReplacement = "export const stale = true;\n";
    const validReplacement = "export const valid = true;\n";
    const proposalChanges = [
      {
        path: staleName,
        absolutePath: stalePath,
        originalContent: staleOriginal,
        baseHash: hashPatchBase(staleOriginal),
        hunks: buildPatchHunks(staleOriginal, staleReplacement, "Update stale file"),
        newContent: staleReplacement,
        reason: "Update stale file",
        validationProfile: "api-ai-tests" as const,
      },
      {
        path: validName,
        absolutePath: validPath,
        originalContent: validOriginal,
        baseHash: hashPatchBase(validOriginal),
        hunks: buildPatchHunks(validOriginal, validReplacement, "Update valid file"),
        newContent: validReplacement,
        reason: "Update valid file",
        validationProfile: "api-ai-tests" as const,
      },
    ];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      await fs.writeFile(stalePath, "export const user_edit = true;\n", "utf-8");
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: proposalChanges });

      expect(res.status).toBe(207);
      const staleResult = res.body.results.find((result: { path: string }) => result.path === staleName);
      const validResult = res.body.results.find((result: { path: string }) => result.path === validName);
      expect(staleResult).toMatchObject({
        ok: false,
        code: "STALE_BASE",
        conflict: { kind: "base_hash_mismatch" },
      });
      expect(validResult).toMatchObject({
        ok: false,
        writeStatus: "not_written",
      });
      expect(await fs.readFile(stalePath, "utf-8")).toBe("export const user_edit = true;\n");
      expect(await fs.readFile(validPath, "utf-8")).toBe(validOriginal);
    } finally {
      await fs.rm(stalePath, { force: true });
      await fs.rm(validPath, { force: true });
    }
  });

  it("returns a hunk conflict even when the submitted base hash is current", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-hunk-conflict-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-hunk-conflict-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const current = "export const current = true;\n";
    await fs.writeFile(absolutePath, current, "utf-8");
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      originalContent: current,
      baseHash: hashPatchBase(current),
      hunks: [{
        startLine: 1,
        endLine: 1,
        expectedText: "export const stale = true;",
        replacementText: "export const next = true;",
        reason: "Test stale hunk",
      }],
      newContent: "export const next = true;\n",
      reason: "Test stale hunk",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: proposalChanges });

      expect(res.status).toBe(207);
      expect(res.body.results[0]).toMatchObject({
        ok: false,
        code: "PATCH_HUNK_MISMATCH",
        conflict: { kind: "hunk_mismatch", hunkIndex: 0 },
      });
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(current);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("applies a partial hunk selection — only accepted hunks are written via rebase", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-partial-hunks-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    // Stub behavioral verification so the /tmp project root (no package.json)
    // doesn't cause "unavailable" → rollback in the apply route.
    // runRepairValidation returns ValidationResult — supply every required field.
    const validationSpy = vi.spyOn(repairValidation, "runRepairValidation")
      .mockResolvedValueOnce({
        status: "passed",
        profile: "workspace-typecheck",
        exitCode: 0,
        scenario: "Run the workspace TypeScript typecheck.",
        command: "pnpm run typecheck",
        stdout: "",
        stderr: "",
        failedTests: [],
        changedFiles: [],
        evidence: {
          evidenceId: randomUUID(),
          observedAt: new Date().toISOString(),
          artifactRef: "stub",
        },
        detail: "Stubbed for partial-hunk apply test.",
      });

    // File has two independent replaceable regions — lets us store a 2-hunk
    // proposal and prove only the first (accepted) hunk is written.
    const fileName = `apply-partial-hunks-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    await fs.writeFile(absolutePath, original, "utf-8");

    const firstHunk = {
      startLine: 1, endLine: 1,
      expectedText: "const a = 1;",
      replacementText: "const a = 10;",
      reason: "Accepted: bump a",
    };
    const secondHunk = {
      startLine: 2, endLine: 2,
      expectedText: "const b = 2;",
      replacementText: "const b = 20;",
      reason: "Rejected by user: bump b",
    };
    // The stored proposal contains BOTH hunks (the full AI intent).
    const storedChanges = [{
      path: fileName,
      absolutePath,
      originalContent: original,
      baseHash: hashPatchBase(original),
      hunks: [firstHunk, secondHunk],
      newContent: "const a = 10;\nconst b = 20;\nconst c = 3;\n",
      reason: "Partial hunk apply",
      validationProfile: "workspace-typecheck" as const,
    }];
    const proposalId = await insertChangeProposal(id, storedChanges);

    // The UI submits only the first hunk (second is rejected by the user).
    // authorizeChangeSubset must accept this as a valid subset.
    const partialChanges = [{ ...storedChanges[0], hunks: [firstHunk] }];

    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: partialChanges });

      // allOk=true → 200; 207 is for partial success only.
      expect(res.status).toBe(200);
      expect(res.body.results[0]).toMatchObject({ ok: true });
      // Only the first hunk (a→10) was applied; b stays at 2.
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(
        "const a = 10;\nconst b = 2;\nconst c = 3;\n",
      );
    } finally {
      validationSpy.mockRestore();
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("rejects a partial-apply submission that sends empty hunks for a hunk-bearing proposal (bypass attempt)", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-empty-hunks-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-empty-hunks-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "const a = 1;\n";
    await fs.writeFile(absolutePath, original, "utf-8");

    const storedHunk = {
      startLine: 1, endLine: 1,
      expectedText: "const a = 1;",
      replacementText: "const a = 10;",
      reason: "Stored hunk",
    };
    const storedChanges = [{
      path: fileName, absolutePath, originalContent: original,
      baseHash: hashPatchBase(original), hunks: [storedHunk],
      newContent: "const a = 10;\n", reason: "Stored",
      validationProfile: "workspace-typecheck" as const,
    }];
    const proposalId = await insertChangeProposal(id, storedChanges);

    // Submit with hunks: [] — would bypass subset check and write full newContent.
    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: [{ ...storedChanges[0], hunks: [] }] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROPOSAL_MISMATCH");
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("rejects a partial-apply submission that omits hunks entirely for a hunk-bearing proposal", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-omit-hunks-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-omit-hunks-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "const a = 1;\n";
    await fs.writeFile(absolutePath, original, "utf-8");

    const storedHunk = {
      startLine: 1, endLine: 1,
      expectedText: "const a = 1;",
      replacementText: "const a = 10;",
      reason: "Stored hunk",
    };
    const storedChanges = [{
      path: fileName, absolutePath, originalContent: original,
      baseHash: hashPatchBase(original), hunks: [storedHunk],
      newContent: "const a = 10;\n", reason: "Stored",
      validationProfile: "workspace-typecheck" as const,
    }];
    const proposalId = await insertChangeProposal(id, storedChanges);

    // Submit with no hunks key — Zod allows undefined; would bypass to write newContent.
    const { hunks: _omitted, ...changeWithoutHunks } = storedChanges[0];
    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: [changeWithoutHunks] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROPOSAL_MISMATCH");
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("rejects a partial-apply submission that duplicates an authorized hunk (multiset bypass attempt)", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id, ownerId: "test-user",
      name: `apply-dup-hunk-${id.slice(0, 8)}`,
      rootPath: "/tmp", language: "typescript", status: "active",
      createdAt: now, updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-dup-hunk-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "const a = 1;\n";
    await fs.writeFile(absolutePath, original, "utf-8");

    const storedHunk = {
      startLine: 1, endLine: 1,
      expectedText: "const a = 1;",
      replacementText: "const a = 10;",
      reason: "Stored hunk",
    };
    const storedChanges = [{
      path: fileName, absolutePath, originalContent: original,
      baseHash: hashPatchBase(original), hunks: [storedHunk],
      newContent: "const a = 10;\n", reason: "Stored",
      validationProfile: "workspace-typecheck" as const,
    }];
    const proposalId = await insertChangeProposal(id, storedChanges);

    // Submit the same valid hunk twice — one-to-one multiset matching must reject this.
    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id, proposalId,
          changes: [{ ...storedChanges[0], hunks: [storedHunk, storedHunk] }],
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROPOSAL_MISMATCH");
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("rejects a partial-apply submission that introduces a hunk not in the stored proposal", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-unauthorized-hunk-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-unauthorized-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "const a = 1;\n";
    await fs.writeFile(absolutePath, original, "utf-8");

    const storedHunk = {
      startLine: 1, endLine: 1,
      expectedText: "const a = 1;",
      replacementText: "const a = 10;",
      reason: "Stored hunk",
    };
    const storedChanges = [{
      path: fileName, absolutePath, originalContent: original,
      baseHash: hashPatchBase(original), hunks: [storedHunk],
      newContent: "const a = 10;\n", reason: "Store one hunk",
      validationProfile: "workspace-typecheck" as const,
    }];
    const proposalId = await insertChangeProposal(id, storedChanges);

    // Submit a fabricated hunk that differs from the stored proposal.
    // authorizeChangeSubset must reject this and return PROPOSAL_MISMATCH.
    const fabricatedHunk = { ...storedHunk, replacementText: "const a = 999;", reason: "Fabricated" };
    try {
      const res = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({ projectId: id, proposalId, changes: [{ ...storedChanges[0], hunks: [fabricatedHunk] }] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROPOSAL_MISMATCH");
      // File must not have been written.
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(original);
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("rebases a stale Patch Lab proposal without writing the workspace", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-rebase-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-rebase-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "export const value = 1;\n";
    const replacement = "export const value = 2;\n";
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      originalContent: original,
      baseHash: hashPatchBase(original),
      hunks: buildPatchHunks(original, replacement, "Update the value"),
      newContent: replacement,
      reason: "Update the value",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);
    const drifted = `// user header\n${original}`;

    try {
      await fs.writeFile(absolutePath, drifted, "utf-8");
      const res = await request(app)
        .post("/api/ai/chat/rebase-changes")
        .send({ projectId: id, proposalId, changes: proposalChanges });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        proposalId,
        approvalRequired: true,
        rebasedFiles: [fileName],
      });
      expect(res.body.changes[0]).toMatchObject({
        path: fileName,
        originalContent: drifted,
        baseHash: hashPatchBase(drifted),
        newContent: "// user header\nexport const value = 2;\n",
      });
      expect(await fs.readFile(absolutePath, "utf-8")).toBe(drifted);

      const [stored] = await db
        .select({ status: aiChangeProposalsTable.status, changes: aiChangeProposalsTable.changes })
        .from(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.id, proposalId));
      expect(stored?.status).toBe("pending");
      expect(JSON.parse(stored!.changes)[0]).toMatchObject({
        originalContent: drifted,
        newContent: "// user header\nexport const value = 2;\n",
      });

      const blockedApply = await request(app)
        .post("/api/ai/chat/apply-changes")
        .send({
          projectId: id,
          proposalId,
          changes: res.body.changes,
        });
      expect(blockedApply.status).toBe(409);
      expect(blockedApply.body).toMatchObject({
        code: "PROPOSAL_REAPPROVAL_REQUIRED",
        approvalRequired: true,
        revision: 1,
      });

      const approval = await request(app)
        .post(`/api/ai/chat/proposals/${proposalId}/approve`)
        .send({ projectId: id, revision: blockedApply.body.revision });
      expect(approval.status).toBe(200);
      expect(approval.body).toEqual({
        proposalId,
        approvalRequired: false,
        revision: 1,
      });
      const [approvedProposal] = await db
        .select({
          approvalRequired: aiChangeProposalsTable.approvalRequired,
          revision: aiChangeProposalsTable.revision,
        })
        .from(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.id, proposalId));
      expect(approvedProposal).toEqual({ approvalRequired: false, revision: 1 });
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

  it("does not update a proposal when one rebase hunk conflicts", async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "test-user",
      name: `apply-rebase-conflict-${id.slice(0, 8)}`,
      rootPath: "/tmp",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    projectIds.push(id);

    const fileName = `apply-rebase-conflict-${randomUUID().slice(0, 8)}.ts`;
    const absolutePath = `/tmp/${fileName}`;
    const original = "export const value = 1;\n";
    const replacement = "export const value = 2;\n";
    const proposalChanges = [{
      path: fileName,
      absolutePath,
      originalContent: original,
      baseHash: hashPatchBase(original),
      hunks: buildPatchHunks(original, replacement, "Update the value"),
      newContent: replacement,
      reason: "Update the value",
      validationProfile: "api-ai-tests" as const,
    }];
    const proposalId = await insertChangeProposal(id, proposalChanges);

    try {
      await fs.writeFile(absolutePath, "export const value = 9;\n", "utf-8");
      const res = await request(app)
        .post("/api/ai/chat/rebase-changes")
        .send({ projectId: id, proposalId, changes: proposalChanges });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "PATCH_REBASE_CONFLICT",
        results: [{
          path: fileName,
          code: "PATCH_REBASE_CONFLICT",
          conflict: { kind: "hunk_mismatch", hunkIndex: 0 },
        }],
      });
      const [stored] = await db
        .select({ status: aiChangeProposalsTable.status, changes: aiChangeProposalsTable.changes })
        .from(aiChangeProposalsTable)
        .where(eq(aiChangeProposalsTable.id, proposalId));
      expect(stored?.status).toBe("pending");
      expect(JSON.parse(stored!.changes)).toEqual(proposalChanges);
      expect(await fs.readFile(absolutePath, "utf-8")).toBe("export const value = 9;\n");
    } finally {
      await fs.rm(absolutePath, { force: true });
    }
  });

});

describe("POST /api/ai/tasks/:taskId/execute", () => {
  // executeTask is mocked — a real key is never sent to Groq.
  // We set a dummy env key so requireGroqApiKey passes the availability check;
  // the 428-without-key test explicitly deletes it and restores it in finally.
  let savedGroqKey: string | undefined;
  beforeAll(() => {
    savedGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-dummy-key-for-mocked-tests";
  });
  afterAll(() => {
    if (savedGroqKey !== undefined) {
      process.env.GROQ_API_KEY = savedGroqKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  });

  it("returns 404 for an unknown task", async () => {
    const res = await request(app).post(`/api/ai/tasks/${randomUUID()}/execute`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });

  it("returns 409 for a completed task", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "completed");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/completed/i);
  });

  it("returns 409 for a failed task", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "failed");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/failed/i);
  });

  it("executes a pending task and returns 202 with updated status", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    // needsHumanReview: false → finalStatus: "completed"
    expect(res.body.status).toBe("completed");
    expect(typeof res.body.agentResponse).toBe("string");
  });

  it("sets task status to 'verifying' when AI says needsHumanReview", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockExecuteTask).mockResolvedValueOnce({
      summary: "Needs review",
      result: "",
      confidence: "low",
      steps: [],
      needsHumanReview: true,
    });

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("verifying");
  });

  it("creates task logs and an event on successful execution", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    await request(app).post(`/api/ai/tasks/${taskId}/execute`);

    const logs = await db
      .select()
      .from(taskLogsTable)
      .where(eq(taskLogsTable.taskId, taskId));
    expect(logs.length).toBeGreaterThanOrEqual(2); // start + finish

    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const execEvent = events.find((e) => e.taskId === taskId);
    expect(execEvent).toBeDefined();
    expect(["TaskCompleted", "TaskVerifying"]).toContain(execEvent?.type);
  });

  it("creates an audit entry on execution", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    await request(app).post(`/api/ai/tasks/${taskId}/execute`);

    const audits = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.entityId, taskId));
    const auditEntry = audits.find((a) => a.action === "ai_executed");
    expect(auditEntry).toBeDefined();
  });

  // PR-E: parse failure surfaced as 422; task claim rolled back so it's not stuck in "running".
  it("returns 422 with model_output_invalid when executeTask returns _parseError, and rolls back task status", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockExecuteTask).mockResolvedValueOnce({
      summary: "fallback",
      result: "fallback",
      confidence: "low",
      steps: [],
      needsHumanReview: true,
      _parseError: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "required field missing at /srv/app/task-parser.ts (request req-task-789)",
        raw: "{ bad json }",
      },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("model_output_invalid");
    expect(res.body.code).toBe("model_output_invalid");
    expect(res.body.parseCode).toBe("SCHEMA_VALIDATION_FAILED");
    expect(typeof res.body.hint).toBe("string");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("{ bad json }");
    expect(serialized).not.toContain("required field missing");
    expect(serialized).not.toContain("req-task-789");
    expect(serialized).not.toContain("/srv/app/");
    expect(serialized).not.toContain("/tmp/");

    // Task must be rolled back to its original status — not stuck in "running".
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    expect(task?.status).toBe("pending");

    // A taskLog entry must record the parse failure.
    const logs = await db.select().from(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    const errLog = logs.find((l) => l.level === "error");
    expect(errLog).toBeDefined();
    const persistedUserFacing = JSON.stringify(logs);
    expect(persistedUserFacing).not.toContain("{ bad json }");
    expect(persistedUserFacing).not.toContain("required field missing");
    expect(persistedUserFacing).not.toContain("req-task-789");
    expect(persistedUserFacing).not.toContain("/srv/app/");
  });

  it("returns 500 and restores task status when buildProjectContext fails", async () => {
    const { buildProjectContext } = await import("@workspace/ai-orchestrator");
    vi.mocked(buildProjectContext).mockRejectedValueOnce(new Error("context build failed"));

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to build project context");

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    expect(task?.status).toBe("pending");

    const logs = await db.select().from(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    expect(logs.some((l) =>
      l.level === "error" &&
      l.message === "AI execution failed while building project context",
    )).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("context build failed");
  });

  it("keeps raw provider diagnostics out of manual task JSON and persisted records", async () => {
    const { executeTask: mockExecuteTask, GroqClientError } = await import("@workspace/ai-orchestrator");
    const rawMessage = "provider request req-raw-task-123 failed at /srv/app/task.ts";
    vi.mocked(mockExecuteTask).mockRejectedValue(
      new GroqClientError("SERVER_ERROR", rawMessage),
    );

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
    expect(res.status).toBe(502);
    const responseJson = JSON.stringify(res.body);
    expect(responseJson).not.toContain(rawMessage);
    expect(responseJson).not.toContain("req-raw-task-123");
    expect(responseJson).not.toContain("/srv/app/");

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectId));
    const persisted = JSON.stringify(event);
    expect(persisted).not.toContain(rawMessage);
    expect(persisted).not.toContain("req-raw-task-123");
    expect(persisted).not.toContain("/srv/app/");
  });

  it("keeps raw provider diagnostics out of automatic task records", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    const rawMessage = "automatic provider request req-raw-auto-456 failed at /var/task/worker.ts";
    vi.mocked(mockExecuteTask).mockRejectedValueOnce(new Error(rawMessage));

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "verifying");
    await db.update(tasksTable)
      .set({ prompt: "Run the automatic task" })
      .where(eq(tasksTable.id, taskId));

    scheduleAiTaskExecution(taskId, "test-user");

    let failureEvent: typeof eventsTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      const events = await db.select().from(eventsTable).where(eq(eventsTable.taskId, taskId));
      failureEvent = events.find((event) => event.type === "TaskAutoExecutionFailed");
      if (failureEvent) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(failureEvent).toBeDefined();
    const logs = await db.select().from(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    const persisted = JSON.stringify({ failureEvent, logs });
    expect(persisted).not.toContain(rawMessage);
    expect(persisted).not.toContain("req-raw-auto-456");
    expect(persisted).not.toContain("/var/task/");
  });

  it("keeps automatic parser output private in task records", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    vi.mocked(mockExecuteTask).mockResolvedValueOnce({
      summary: "fallback",
      result: "fallback",
      confidence: "low",
      steps: [],
      needsHumanReview: true,
      _parseError: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "invalid output at /tmp/auto-parser.json (request req-auto-parser-999)",
        raw: "raw automatic parser output",
      },
    });

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "verifying");
    await db.update(tasksTable)
      .set({ prompt: "Run the automatic parser fixture" })
      .where(eq(tasksTable.id, taskId));

    scheduleAiTaskExecution(taskId, "test-user");

    let failureEvent: typeof eventsTable.$inferSelect | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      const events = await db.select().from(eventsTable).where(eq(eventsTable.taskId, taskId));
      failureEvent = events.find((event) => event.type === "TaskAutoExecutionFailed");
      if (failureEvent) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(failureEvent).toBeDefined();
    const logs = await db.select().from(taskLogsTable).where(eq(taskLogsTable.taskId, taskId));
    const persisted = JSON.stringify({ failureEvent, logs });
    expect(persisted).not.toContain("raw automatic parser output");
    expect(persisted).not.toContain("req-auto-parser-999");
    expect(persisted).not.toContain("/tmp/auto-parser.json");
  });

  it("returns 428 and leaves task in original status when no AI provider is configured", async () => {
    // Regression: the provider check must happen BEFORE the atomic claim so the
    // task is never left stuck in "running" when no provider is configured.
    // Clear every server-wide fallback, not only Groq: OpenRouter, DeepSeek,
    // and Gemini are valid providers for task execution too.
    const providerKeys = [
      "GROQ_API_KEY",
      "OPENROUTER_API_KEY",
      "DEEPSEEK_API_KEY",
      "GEMINI_API_KEY",
    ] as const;
    const savedKeys = Object.fromEntries(
      providerKeys.map((key) => [key, process.env[key]]),
    ) as Record<(typeof providerKeys)[number], string | undefined>;
    for (const key of providerKeys) delete process.env[key];

    try {
      const projectId = await insertProject();
      projectIds.push(projectId);
      const taskId = await insertTask(projectId, "pending");

      const res = await request(app).post(`/api/ai/tasks/${taskId}/execute`);
      // No key → 428 Precondition Required
      expect(res.status).toBe(428);

      // Task must never have entered "running" — the key check precedes the claim.
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);
      expect(task?.status).toBe("pending");
    } finally {
      for (const key of providerKeys) {
        const value = savedKeys[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("returns 409 and preserves a concurrent status change instead of overwriting it", async () => {
    const { executeTask: mockExecuteTask } = await import("@workspace/ai-orchestrator");
    let resolveExecution!: (value: {
      summary: string;
      confidence: "low" | "medium" | "high";
      steps: string[];
      result: string;
      needsHumanReview: boolean;
    }) => void;
    const executionPromise = new Promise<{
      summary: string;
      confidence: "low" | "medium" | "high";
      steps: string[];
      result: string;
      needsHumanReview: boolean;
    }>((resolve) => {
      resolveExecution = resolve;
    });
    vi.mocked(mockExecuteTask).mockReturnValueOnce(executionPromise as never);

    const projectId = await insertProject();
    projectIds.push(projectId);
    const taskId = await insertTask(projectId, "pending");

    const requestPromise = request(app).post(`/api/ai/tasks/${taskId}/execute`).then((res) => res);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.update(tasksTable).set({ status: "verifying", updatedAt: new Date() }).where(eq(tasksTable.id, taskId));

    resolveExecution({
      summary: "done",
      confidence: "high",
      steps: ["step 1"],
      result: "ok",
      needsHumanReview: false,
    });

    const res = await requestPromise;
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/concurrently/i);

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, taskId))
      .limit(1);
    expect(task?.status).toBe("verifying");
  });
});


describe("resolveProvider tool-capability filtering", () => {
  it("skips Gemini when a request requires tools", async () => {
    const savedGroq = process.env.GROQ_API_KEY;
    const savedOpenRouter = process.env.OPENROUTER_API_KEY;
    const savedDeepSeek = process.env.DEEPSEEK_API_KEY;
    const savedGemini = process.env.GEMINI_API_KEY;

    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.GEMINI_API_KEY = "test-gemini-key";

    try {
      const { resolveProvider } = await import("../lib/ai-route-helpers.js");
      const resolved = await resolveProvider("test-user", { requireTools: true });
      expect(resolved).toBeUndefined();
    } finally {
      if (savedGroq !== undefined) process.env.GROQ_API_KEY = savedGroq;
      else delete process.env.GROQ_API_KEY;

      if (savedOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouter;
      else delete process.env.OPENROUTER_API_KEY;

      if (savedDeepSeek !== undefined) process.env.DEEPSEEK_API_KEY = savedDeepSeek;
      else delete process.env.DEEPSEEK_API_KEY;

      if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});
