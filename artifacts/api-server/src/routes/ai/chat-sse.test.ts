/**
 * Task 53 — server-side proof
 *
 * Integration test for the `onStep` closure inside the
 * `POST /api/ai/chat/stream` route in `artifacts/api-server/src/routes/ai/chat.ts`.
 *
 * Strategy:
 *   - Mock `chatWithFallback` (via `../../lib/ai-route-helpers.js`) so that it
 *     immediately calls the `onStep` callback it receives with a
 *     `forensic_status` AgentStep.
 *   - Hit the actual Express route via supertest.
 *   - Assert that the SSE response contains the expected `forensic_status`
 *     event written by the real `onStep` closure in chat.ts.
 *
 * If the `forensic_status` branch in `onStep` is deleted or broken, the event
 * will be absent from the SSE stream and these tests will fail — proving
 * end-to-end coverage of the actual route code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { z } from "zod";
import {
  RepairPlanMetadataSchema,
  type AgentStep,
  type EvidenceReference,
  buildProjectContext,
} from "@workspace/ai-orchestrator";

// Task #59: capture the exact serialized values written to the assistant
// message's `tool_trace` and `repair_plan_metadata` columns, so a scoped-run
// test can parse them back and prove verdictScope/scopedFindingStatus survive.
const chatCapture = vi.hoisted(() => ({
  assistantContent: null as string | null,
  assistantToolTrace: null as string | null,
  assistantRepairPlanMetadata: null as string | null,
}));

// ── Mocks — hoisted before any import ────────────────────────────────────────
// vi.mock() calls are hoisted to the top of the file by vitest, so they run
// before the dynamic `import app` call even though they appear after it here.

vi.mock("@workspace/db", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const MOCK_SESSION = {
    id: "test-session-id",
    projectId: "test-project-id",
    title: "Test session",
    linkedTaskId: null,
    createdAt: now,
    updatedAt: now,
  };
  const MOCK_MSG = {
    id: "test-msg-id",
    sessionId: "test-session-id",
    role: "assistant",
    content: "Test response",
    sources: "[]",
    toolTrace: null,
    repairPlanMetadata: null,
    createdAt: now,
  };
  const MOCK_EXECUTION = {
    id: "test-execution-id",
    projectId: "test-project-id",
    sessionId: "test-session-id",
    linkedTaskId: null,
    buildPlanMessageId: null,
    userId: "test-user",
    idempotencyKey: "test-idempotency-key",
    resumeTokenHash: "test-token-hash",
    request: JSON.stringify({
      projectId: "test-project-id",
      sessionId: "test-session-id",
      message: "test",
      modelMessage: "test",
      validationTargetPaths: [],
    }),
    checkpoint: "{}",
    checkpointVersion: 0,
    status: "queued",
    workerId: "test-worker",
    leaseUntil: now,
    lastHeartbeatAt: now,
    cancelRequestedAt: null,
    error: null,
    finalMessageId: null,
    proposalId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
  };
  const fixture = {
    session: null as Record<string, unknown> | null,
    messages: [] as Array<Record<string, unknown>>,
    execution: { ...MOCK_EXECUTION } as Record<string, unknown>,
  };
  let exposeExecutionForCancel = false;

  /**
   * Returns an object that is:
   *   - directly awaitable (thenable) → resolves to `rows` (for inserts without .returning())
   *   - has a .returning() method → resolves to `rows` (for inserts with .returning())
   */
  function insertResult(rows: unknown[]) {
    return {
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
      onConflictDoNothing: () => insertResult(rows),
      returning: () => Promise.resolve(rows),
    };
  }

  const updateResult = (vals?: Record<string, unknown>) => {
    // Keep the cancellation fixture close to the real conditional updates:
    // a running execution skips the queued/paused terminal update, then
    // transitions through cancelling so the registered controller is aborted.
    const skipQueuedCancellation =
      vals?.status === "cancelled" && fixture.execution.status === "running";
    if (vals && !skipQueuedCancellation) {
      fixture.execution = { ...fixture.execution, ...vals };
    }
    const promise = Promise.resolve();
    return Object.assign(promise, {
      returning: () => Promise.resolve(skipQueuedCancellation ? [] : [fixture.execution]),
    });
  };

  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () => {
              if ((table as { _tag?: string })._tag === "aiChatSessionsTable") {
                return Promise.resolve(fixture.session ? [fixture.session] : []);
              }
              if ((table as { _tag?: string })._tag === "aiChatMessagesTable") {
                return Promise.resolve([...fixture.messages]);
              }
              if (
                exposeExecutionForCancel
                && (table as { _tag?: string })._tag === "aiExecutionsTable"
              ) {
                return Promise.resolve([{ ...fixture.execution }]);
              }
              return Promise.resolve([]);
            },
            orderBy: () => {
              const rows = (table as { _tag?: string })._tag === "aiChatSessionsTable"
                ? (fixture.session ? [fixture.session] : [])
                : (table as { _tag?: string })._tag === "aiChatMessagesTable"
                  ? [...fixture.messages]
                  : [];
              return Object.assign(Promise.resolve(rows), {
                limit: () => Promise.resolve(rows),
              });
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals?: Record<string, unknown>) => {
          if (vals && "idempotencyKey" in vals) return insertResult([fixture.execution]);
          if (vals && "projectId" in vals) {
            fixture.session = { ...MOCK_SESSION, ...vals };
            return insertResult([fixture.session]);
          }
          return insertResult([MOCK_SESSION]);
        },
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: () => updateResult(vals),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: (table: unknown) => ({
              where: () => ({
                for: () => (table as { _tag?: string })._tag === "aiExecutionsTable"
                  ? Promise.resolve([{ ...fixture.execution }])
                  : Promise.resolve(fixture.session ? [{ id: fixture.session.id }] : []),
              }),
            }),
          }),
          insert: () => ({
            values: (vals?: Record<string, unknown>) => {
              // Task #59: capture the exact serialized DB columns written for
              // the assistant message so the scoped-verdict tests can parse
              // them back (tool_trace + repair_plan_metadata).
              if (vals?.role === "assistant") {
                chatCapture.assistantContent = (vals?.content as string | undefined) ?? null;
                chatCapture.assistantToolTrace =
                  (vals?.toolTrace as string | null | undefined) ?? null;
                chatCapture.assistantRepairPlanMetadata =
                  (vals?.repairPlanMetadata as string | null | undefined) ?? null;
              }
              if (vals && "projectId" in vals && !("sessionId" in vals)) {
                fixture.session = { ...MOCK_SESSION, ...vals };
                return insertResult([MOCK_SESSION]);
              }
              if (vals?.sessionId) {
                fixture.messages.push({ ...MOCK_MSG, ...vals });
              }
              return insertResult(
                vals?.role === "assistant"
                  ? [{
                      ...MOCK_MSG,
                      ...vals,
                      content: vals.content ?? MOCK_MSG.content,
                      sources: typeof vals.sources === "string"
                        ? vals.sources
                        : JSON.stringify(vals.sources ?? []),
                    }]
                  : [],
              );
            },
          }),
          update: () => ({
            set: (vals: Record<string, unknown>) => ({
              where: () => {
                if (fixture.session && "activeTaskState" in vals) {
                  fixture.session = { ...fixture.session, ...vals };
                }
                const updateResult = Promise.resolve();
                const isFinalMessageReservation = typeof vals.finalMessageId === "string";
                const reservationWon = !isFinalMessageReservation || fixture.execution.finalMessageId === null;
                if (isFinalMessageReservation && reservationWon) {
                  fixture.execution = { ...fixture.execution, ...vals };
                }
                return Object.assign(updateResult, {
                  returning: () => Promise.resolve(reservationWon ? [fixture.execution] : []),
                });
              },
            }),
          }),
        };
        return fn(tx);
      },
    },
    __chatTestFixture: fixture,
    __setExposeExecutionForCancel: (value: boolean) => {
      exposeExecutionForCancel = value;
    },
    // Drizzle table references — used as opaque args to the mocked db methods,
    // which ignore them.  Give each a unique marker so vi's call logs are clear.
    aiChatSessionsTable:   { _tag: "aiChatSessionsTable" },
    aiChatMessagesTable:   { _tag: "aiChatMessagesTable" },
    aiChangeProposalsTable: { _tag: "aiChangeProposalsTable" },
    auditLogsTable:        { _tag: "auditLogsTable" },
    eventsTable:           { _tag: "eventsTable" },
    tasksTable:            { _tag: "tasksTable" },
    aiExecutionsTable:     { _tag: "aiExecutionsTable" },
    // drizzle-orm re-exports from @workspace/db — return no-ops so they never
    // throw when called with our mock table objects.
    eq:      () => ({}),
    desc:    () => ({}),
    and:     () => ({}),
    inArray: () => ({}),
  };
});

// Override only the functions we need to control; keep everything else real
// (classifyRequest, isImmediateExecutionRequest, GroqClientError, etc.).
vi.mock("@workspace/ai-orchestrator", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    buildProjectContext:       vi.fn().mockResolvedValue({ tasks: [], metrics: [] }),
    invalidateContextCache:    vi.fn(),
    enrichContextWithMemories: vi.fn().mockResolvedValue(undefined),
    writeSessionMemories:      vi.fn().mockResolvedValue(undefined),
    recordRequest:             vi.fn(),
    recordFailure:             vi.fn(),
    recordSuccess:             vi.fn(),
    recordInvalidModel:        vi.fn(),
    recordLatency:             vi.fn(),
    recordFallbackSuccess:     vi.fn(),
  };
});

vi.mock("../../lib/ai-route-helpers.js", () => {
  const redactText = (value: string) => value
    .replace(/\/(?:home\/runner(?:\/workspace)?|workspace|tmp|app|srv|var\/task|mnt\/data)\/[^\s`"'<>),;]+/g, "[runtime path]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[internal id]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b(?:bearer|token|secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]");
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
    requireProvider:        vi.fn(),
    chatWithFallback:       vi.fn(),
    handleOrchestratorError: vi.fn().mockReturnValue(false),
    requestLooksToolBound:  vi.fn().mockReturnValue(false),
  };
});

vi.mock("../../middlewares/requireProjectAccess.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Override the DB-hitting helper so tests never touch a real database.
    loadProjectByIdForUser: vi.fn(),
  };
});

vi.mock("../../lib/db-rate-limiter.js", () => ({
  checkProjectRateLimitDb: vi.fn().mockResolvedValue({ allowed: true }),
  LLM_RATE_LIMIT: 30,
}));

vi.mock("../../lib/rootpath-validator.js", () => ({
  resolveRootPath: vi.fn().mockResolvedValue({
    validRootPath: "/tmp/test-project",
    fallbackUsed: false,
    originalPath: "/tmp/test-project",
  }),
}));

vi.mock("../../lib/advisory-lock.js", () => ({
  tryAdvisoryLock: vi.fn().mockResolvedValue({
    acquired: true,
    release: vi.fn().mockResolvedValue(undefined),
  }),
  LockNamespace: { APPLY: "apply" },
}));

// ── Imports — after mocks so mocked modules are resolved first ────────────────
// (vitest hoists vi.mock() above all static imports automatically, but dynamic
// imports still need to come after the vi.mock calls in source order.)
import app from "../../app.js";
import { chatWithFallback, requireProvider, requestLooksToolBound } from "../../lib/ai-route-helpers.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb } from "../../lib/db-rate-limiter.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import { tryAdvisoryLock } from "../../lib/advisory-lock.js";
import { enrichContextWithMemories } from "@workspace/ai-orchestrator";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_PROJECT = {
  id: "test-project-id",
  name: "Test Project",
  rootPath: "/tmp/test-project",
  ownerId: "test-user",
  status: "active",
  language: "typescript",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

/** Forensic status step with isFixtureLocal:true — the one under test. */
const FIXTURE_LOCAL_STEP: Extract<AgentStep, { kind: "forensic_status" }> = {
  kind: "forensic_status",
  auditScope: "FIXTURE_LOCAL",
  isFixtureLocal: true,
  sourceCoverage: "COMPLETE",
  behavioralAssessment: "COMPLETE",
  findingStatus: "PROVEN",
  repairReadiness: "BLOCKED",
  productionReachability: "NOT_PROVEN",
  implementationFiles: 1,
  contextFiles: 0,
  generatedFiles: 0,
  effectiveRoot: "PROJECT_ROOT",
  projectRevision: "rev-safe-123",
  completeReads: false,
  appliedBudget: {
    maxIterations: 12,
    maxToolCalls: 24,
    synthesisMaxAttempts: 2,
    synthesisTimeoutMs: 1500,
  },
  readStatuses: [
    { path: "src/a.ts", status: "READ_COMPLETE" },
    { path: "src/b.ts", status: "READ_TRUNCATED" },
  ],
  synthesisLifecycle: {
    started: true,
    attempted: true,
    timedOut: false,
    skipped: false,
  },
};

/** Forensic status step without isFixtureLocal (production audit). */
const PRODUCTION_STEP: Extract<AgentStep, { kind: "forensic_status" }> = {
  kind: "forensic_status",
  auditScope: "PRODUCTION",
  sourceCoverage: "COMPLETE",
  behavioralAssessment: "COMPLETE",
  findingStatus: "PROVEN",
  repairReadiness: "READY",
  productionReachability: "NOT_PROVEN",
  implementationFiles: 2,
  contextFiles: 1,
  generatedFiles: 0,
};

const CROSS_FILE_STEP: Extract<AgentStep, { kind: "cross_file_trace" }> = {
  kind: "cross_file_trace",
  trace: {
    status: "PROVEN",
    maxDepth: 1,
    nodes: [
      { id: "file-chat", name: "chat.ts", path: "src/chat.ts", stage: "OTHER" },
      { id: "on-step", name: "onStep", path: "src/chat.ts", stage: "OTHER" },
    ],
    edges: [{
      from: "file-chat",
      to: "on-step",
      relation: "contains",
      status: "PROVEN",
      source: "src/chat.ts",
      evidence: "src/chat.ts:932:11 — function onStep(step) {",
      sourceSpan: {
        file: "src/chat.ts",
        line: 932,
        column: 11,
        snippet: "function onStep(step) {",
      },
      runtimeObserved: false,
    }],
  },
};

/** Standard chatWithFallback return value — no pending changes so no proposal. */
const MOCK_CHAT_RESULT = {
  result: {
    response: "Audit complete.",
    sources: [] as string[],
    pendingChanges: [] as unknown[],
    repairPlan: undefined,
    resolvedModel: { id: "test-model", provider: "openai", free: false },
    _parseError: undefined,
  },
  effectiveProvider: "openai",
};

const SENSITIVE_VALIDATION_STEP: Extract<AgentStep, { kind: "validation" }> = {
  kind: "validation",
  repairState: "BLOCKED",
  attempt: 1,
  maxAttempts: 1,
  result: {
    profile: "api-ai-tests",
    status: "failed",
    scenario: "Run the API tests.",
    exitCode: 1,
    command: "pnpm test -- --reporter verbose",
    stdout: "PRIVATE_SOURCE=do-not-save",
    stderr: "token: abc123 secret@example.com",
    failedTests: [{ name: "private.test.ts", file: "src/private.ts", message: "secret@example.com" }],
    changedFiles: ["src/private.ts"],
    evidence: {
      evidenceId: "validation-result:sensitive-test",
      observedAt: "2026-08-22T12:00:00.000Z",
      artifactRef: "validation-result:sensitive-test",
    },
    detail: "Validation failed for secret@example.com token: abc123",
  },
};

const PASSED_VALIDATION_STEP: Extract<AgentStep, { kind: "validation" }> = {
  ...SENSITIVE_VALIDATION_STEP,
  repairState: "READY_FOR_REVIEW",
  result: {
    ...SENSITIVE_VALIDATION_STEP.result,
    status: "passed",
    exitCode: 0,
    command: "pnpm run private-passed-command",
    stdout: "PRIVATE_PASSED_OUTPUT=do-not-save",
    stderr: "passed private stderr",
    failedTests: [],
    changedFiles: ["src/private-passed.ts"],
    detail: "Validation passed for secret@example.com token: abc123",
  },
};

/**
 * Accepted behavior-evidence with exact line spans. Mirrors what the
 * orchestrator returns so the SSE route must forward it verbatim as a parsed
 * array (never a serialized string), preserving each sourceSpan.
 */
const BEHAVIOR_EVIDENCE_STEP_RESULT = {
  result: {
    ...MOCK_CHAT_RESULT.result,
    behaviorEvidence: [
      {
        source: "src/loop.ts",
        excerpt: "const result = await chat(...)",
        sourceSpan: { startLine: 1396, endLine: 1426 },
        supportsClaim: true,
        evidenceClass: "BEHAVIOR_PROVEN",
      },
      {
        source: "src/config/app.ts",
        excerpt: "const LIMIT = 5",
        sourceSpan: { startLine: 12, endLine: 12 },
        supportsClaim: true,
        evidenceClass: "READ_CONFIRMED",
      },
    ] as EvidenceReference[],
  },
  effectiveProvider: "openai",
};

const CONTEXT_PROVENANCE_FIXTURE = {
  schemaVersion: "1",
  intentKind: "CHAT",
  revisionLabel: "revision-context-parity",
  slices: [
    {
      layer: "project",
      source: "project",
      status: "loaded",
      freshness: "fresh",
      rowCount: 2,
      truncated: false,
      admissionDecision: "ADMIT",
      lifetimeStage: "fresh",
    },
    {
      layer: "memory",
      source: "session_memory",
      status: "empty",
      freshness: "missing",
      rowCount: 0,
      truncated: false,
      admissionDecision: "DROP",
      lifetimeStage: "fresh",
    },
  ],
  links: {
    returnedCount: 1,
    truncated: false,
    statuses: ["loaded"],
    details: [
      {
        source: "file",
        layer: "direct",
        direction: "outbound",
        status: "loaded",
        freshness: "fresh",
        rowCount: 1,
        linkReason: "The response was grounded in the requested source.",
        sourceRefCount: 1,
        confidence: 0.98,
      },
    ],
  },
  citations: ["src/routes/ai/chat.ts"],
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse all SSE events from a text/event-stream response body. */
function parseSseFrames(text: string): unknown[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .flatMap((chunk) => {
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) return [];
      try {
        return [JSON.parse(dataLine.slice("data: ".length))];
      } catch {
        return [];
      }
    });
}

/** Decision trace step — proves the task router reached the client. */
const DECISION_TRACE_STEP: Extract<AgentStep, { kind: "decision_trace" }> = {
  kind: "decision_trace",
  trace: {
    taskType: "BEHAVIOR_QUERY",
    allowedFiles: ["src/a.ts"],
    filesRead: ["src/a.ts"],
    evidenceSelected: 1,
    claim: "claim",
    validator: "behavior-answer",
    rejectionReason: [],
    recoveryAttempt: 0,
    finalState: "VERIFIED",
  },
};

/** Fixture-local verdict trace — carries the proof scope fields under test. */
const FIXTURE_VERDICT_STEP: Extract<AgentStep, { kind: "decision_trace" }> = {
  kind: "decision_trace",
  trace: {
    taskType: "FINDING",
    allowedFiles: ["test/fixture.ts"],
    filesRead: ["test/fixture.ts"],
    evidenceSelected: 1,
    claim: "claim",
    validator: "finding",
    rejectionReason: [],
    recoveryAttempt: 0,
    finalState: "VERIFIED",
    verdictScope: "FIXTURE_LOCAL",
    scopedFindingStatus: "FIXTURE_PROVEN",
  },
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  const dbModule = (await import("@workspace/db") as unknown as {
    __chatTestFixture: {
      session: Record<string, unknown> | null;
      messages: Array<Record<string, unknown>>;
       execution: Record<string, unknown>;
    };
    __setExposeExecutionForCancel: (value: boolean) => void;
  });
  const dbFixture = dbModule.__chatTestFixture;
  dbFixture.session = null;
  dbFixture.messages.length = 0;
  dbFixture.execution.status = "queued";
  dbFixture.execution.finalMessageId = null;
  dbModule.__setExposeExecutionForCancel(false);

  // Each test owns the in-memory DB and the route-bound mocks it exercises.
  // Reset these implementations so a prior SSE scenario cannot leak callback
  // behavior into the next one without clearing unrelated module defaults.
  vi.mocked(loadProjectByIdForUser).mockReset();
  vi.mocked(requireProvider).mockReset();
  vi.mocked(checkProjectRateLimitDb).mockReset();
  vi.mocked(chatWithFallback as (...args: unknown[]) => unknown).mockReset();
  vi.mocked(resolveRootPath).mockReset();
  vi.mocked(requestLooksToolBound).mockReset();
  vi.mocked(enrichContextWithMemories).mockReset();
  vi.mocked(tryAdvisoryLock).mockReset();
  // Return the fake project for any project lookup in the stream route.
  vi.mocked(loadProjectByIdForUser).mockResolvedValue(FAKE_PROJECT as never);
  vi.mocked(requireProvider).mockResolvedValue({ provider: "openai" as never, apiKey: "test-key" });
  vi.mocked(checkProjectRateLimitDb).mockResolvedValue({ allowed: true });
  vi.mocked(chatWithFallback as (...args: unknown[]) => unknown).mockResolvedValue(MOCK_CHAT_RESULT);
  vi.mocked(requestLooksToolBound).mockReturnValue(false);
  vi.mocked(enrichContextWithMemories).mockResolvedValue(undefined);
  vi.mocked(tryAdvisoryLock).mockResolvedValue({
    acquired: true,
    release: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(resolveRootPath).mockResolvedValue({
    validRootPath: FAKE_PROJECT.rootPath,
    fallbackUsed: false,
    originalPath: FAKE_PROJECT.rootPath,
  });
  // Task #59: reset the captured persisted columns between tests.
  chatCapture.assistantToolTrace = null;
  chatCapture.assistantContent = null;
  chatCapture.assistantRepairPlanMetadata = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/ai/chat/stream — forensic_status SSE emission (onStep integration)", () => {
  it("keeps context provenance identical across JSON, SSE done, persistence, and history", async () => {
    vi.mocked(buildProjectContext)
      .mockImplementationOnce(async () => ({
        contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
      } as never))
      .mockImplementationOnce(async () => ({
        contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
      } as never));

    const json = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: "test-project-id", message: "Summarize the project context." });

    expect(json.status, JSON.stringify(json.body)).toBe(200);
    expect(json.body.contextProvenance).toEqual(CONTEXT_PROVENANCE_FIXTURE);
    expect(json.body.message.contextProvenance).toEqual(CONTEXT_PROVENANCE_FIXTURE);

    const jsonTrace = JSON.parse(json.body.toolTrace) as Array<Record<string, unknown>>;
    expect(jsonTrace).toContainEqual({
      kind: "context_provenance",
      ...CONTEXT_PROVENANCE_FIXTURE,
    });
    const sessionId = json.body.sessionId as string;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const stream = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId: "test-project-id",
        sessionId,
        message: "Summarize the project context.",
      });

    expect(stream.status, stream.text).toBe(200);
    const frames = parseSseFrames(stream.text) as Array<Record<string, unknown>>;
    const done = frames.find((frame) => frame.type === "done");
    expect(done).toBeDefined();
    expect(done?.contextProvenance).toEqual(CONTEXT_PROVENANCE_FIXTURE);
    expect((done?.message as Record<string, unknown>).contextProvenance)
      .toEqual(CONTEXT_PROVENANCE_FIXTURE);

    const doneTrace = JSON.parse(done?.toolTrace as string) as Array<Record<string, unknown>>;
    expect(doneTrace).toContainEqual({
      kind: "context_provenance",
      ...CONTEXT_PROVENANCE_FIXTURE,
    });

    const history = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const historyAssistants = (history.body as Array<Record<string, unknown>>)
      .filter((message) => message.role === "assistant");
    expect(historyAssistants).toHaveLength(2);
    for (const message of historyAssistants) {
      expect(message.contextProvenance).toEqual(CONTEXT_PROVENANCE_FIXTURE);
      const trace = JSON.parse(message.toolTrace as string) as Array<Record<string, unknown>>;
      expect(trace).toContainEqual({
        kind: "context_provenance",
        ...CONTEXT_PROVENANCE_FIXTURE,
      });
    }

    const exported = JSON.stringify({
      json: json.body,
      sse: frames,
      history: history.body,
    });
    expect(exported).not.toContain("/home/runner");
    expect(exported).not.toContain("/tmp/");
    expect(exported).not.toContain("providerDiagnostic");
    expect(exported).not.toContain("rawProvider");
  });

  it("keeps context provenance on a failed quality result and its persisted history", async () => {
    vi.mocked(buildProjectContext).mockImplementationOnce(async () => ({
      contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
    } as never));
    vi.mocked(chatWithFallback as (...args: unknown[]) => unknown).mockResolvedValue({
      ...MOCK_CHAT_RESULT,
      result: {
        ...MOCK_CHAT_RESULT.result,
        _qualityError: {
          code: "QUALITY_REVIEW_LOW",
          score: 0.31,
          threshold: 0.7,
          reasons: ["The result did not meet the required completion checks."],
        },
      },
    } as never);

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    expect(response.status).toBe(200);
    const frames = parseSseFrames(response.text) as Array<Record<string, unknown>>;
    const error = frames.find((frame) => frame.type === "error");
    expect(error).toMatchObject({
      code: "QUALITY_REVIEW_LOW",
      contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
    });
    expect(chatCapture.assistantToolTrace).not.toBeNull();
    expect(JSON.parse(chatCapture.assistantToolTrace!)).toContainEqual({
      kind: "context_provenance",
      ...CONTEXT_PROVENANCE_FIXTURE,
    });

    const dbFixture = (await import("@workspace/db") as unknown as {
      __chatTestFixture: {
        session: Record<string, unknown> | null;
      };
    }).__chatTestFixture;
    const sessionId = dbFixture.session?.id;
    expect(typeof sessionId).toBe("string");
    const history = await request(app).get(`/api/ai/chat/${sessionId}/messages`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const failedMessage = (history.body as Array<Record<string, unknown>>)
      .find((message) => message.role === "assistant");
    expect(failedMessage?.outcome).toBe("FAILED");
    expect(failedMessage?.contextProvenance).toEqual(CONTEXT_PROVENANCE_FIXTURE);
  });

  it("keeps context provenance when an active execution is cancelled", async () => {
    const dbFixture = (await import("@workspace/db") as unknown as {
      __setExposeExecutionForCancel: (value: boolean) => void;
    });
    dbFixture.__setExposeExecutionForCancel(true);
    vi.mocked(buildProjectContext).mockImplementationOnce(async () => ({
      contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
    } as never));
    vi.mocked(chatWithFallback as (...args: unknown[]) => unknown).mockImplementation(
      async () => {
        const cancellation = await request(app)
          .post("/api/ai/executions/test-execution-id/cancel");
        expect(cancellation.status).toBe(200);
        return {
          ...MOCK_CHAT_RESULT,
          result: {
            ...MOCK_CHAT_RESULT.result,
            response: "ANALYSIS_INCOMPLETE — The audit was cancelled.",
          },
        };
      },
    );

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    expect(response.status).toBe(200);
    const frames = parseSseFrames(response.text) as Array<Record<string, unknown>>;
    const done = frames.find((frame) => frame.type === "done");
    expect(done).toMatchObject({
      contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
      message: {
        outcome: "INTERRUPTED",
        contextProvenance: CONTEXT_PROVENANCE_FIXTURE,
      },
    });
    expect(chatCapture.assistantToolTrace).not.toBeNull();
    expect(JSON.parse(chatCapture.assistantToolTrace!)).toContainEqual({
      kind: "context_provenance",
      ...CONTEXT_PROVENANCE_FIXTURE,
    });
  });

  it("persists a forensic session, then keeps ابدأ read-only across JSON and SSE routes", async () => {
    const { promises: fs } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-server-session-"));
    const relativePath = "src/target.ts";
    const absolutePath = path.join(rootPath, relativePath);
    const originalSource = "export const enabled = true;\n";
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, originalSource, "utf8");

    const dbFixture = (await import("@workspace/db") as unknown as {
      __chatTestFixture: {
        session: Record<string, unknown> | null;
        messages: Array<Record<string, unknown>>;
      };
    }).__chatTestFixture;
    dbFixture.session = null;
    dbFixture.messages.length = 0;
    vi.mocked(resolveRootPath).mockResolvedValue({
      validRootPath: rootPath,
      fallbackUsed: false,
      originalPath: rootPath,
    });

    const readStep: Extract<AgentStep, { kind: "tool_call" }> = {
      kind: "tool_call",
      tool: "read_file",
      args: { path: relativePath },
      cached: false,
    };
    vi.mocked(chatWithFallback as (...args: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _provider, onDelta, _options, _reset, onStep) => {
        (onStep as ((step: AgentStep) => void) | undefined)?.(readStep);
        (onDelta as ((delta: string) => void) | undefined)?.(
          `Read ${relativePath}; no changes were made.`,
        );
        return {
          ...MOCK_CHAT_RESULT,
          result: {
            ...MOCK_CHAT_RESULT.result,
            response: `## Evidence\n- Read: ${relativePath}\n\nNo verified finding.`,
            sources: [relativePath],
          },
        };
      },
    );

    const audit = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId: "test-project-id",
        message: "Perform a forensic audit of the source and determine whether there is a defect.",
      });
    expect(audit.status).toBe(200);
    const persistedSession = dbFixture.session as Record<string, unknown> | null;
    const sessionId = persistedSession?.id;
    expect(typeof sessionId).toBe("string");
    expect(persistedSession?.activeTaskState).toBeTruthy();

    const jsonStart = await request(app)
      .post("/api/ai/chat")
      .send({ projectId: "test-project-id", sessionId, message: "ابدأ" });
    expect(jsonStart.status).toBe(200);
    expect(JSON.stringify(jsonStart.body)).toContain(relativePath);
    expect(JSON.stringify(jsonStart.body)).toContain("read_file");
    expect(JSON.stringify(jsonStart.body)).not.toContain("write_file");
    expect(JSON.stringify(jsonStart.body)).not.toContain("replace_text");

    const streamStart = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", sessionId, message: "ابدأ" });
    expect(streamStart.status).toBe(200);
    const streamFrames = parseSseFrames(streamStart.text);
    expect(streamStart.text).toContain(relativePath);
    expect(streamStart.text).toContain("read_file");
    expect(streamStart.text).not.toContain("write_file");
    expect(streamStart.text).not.toContain("replace_text");
    expect(streamFrames.some((frame) =>
      JSON.stringify(frame).includes(relativePath),
    )).toBe(true);

    expect(await fs.readFile(absolutePath, "utf8")).toBe(originalSource);
  });

  it("keeps the cancelled Arabic incomplete report intact in the SSE done frame", async () => {
    const cancelledArabicReport = [
      "## 1) Executive Verdict",
      "ANALYSIS_INCOMPLETE — لم يكتمل التحليل.",
      "",
      "## 2) Evidence Map",
      "لا توجد قراءة مكتملة إضافية.",
      "",
      "## 3) Findings",
      "لم يتم قبول Finding.",
      "",
      "## 4) Repair Plan",
      "Recovery needed — يلزم استئناف التحليل.",
      "Blocked by — إلغاء التوليف قبل اكتماله.",
      "",
      "## 5) Validation Checklist",
      "BLOCKED — لا يمكن التحقق قبل اكتمال الأدلة.",
      "",
      "## 6) Final Judgment",
      "ANALYSIS_INCOMPLETE — التقرير غير مكتمل.",
    ].join("\n");
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockResolvedValue({
      ...MOCK_CHAT_RESULT,
      result: { ...MOCK_CHAT_RESULT.result, response: cancelledArabicReport },
    } as never);

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "أجرِ تدقيقًا جنائيًا وأوقفه." });

    expect(response.status).toBe(200);
    const frames = parseSseFrames(response.text);
    const done = frames.find(
      (frame) => typeof frame === "object" && frame !== null && (frame as Record<string, unknown>).type === "done",
    ) as Record<string, unknown> | undefined;
    expect(done).toBeDefined();
    expect(JSON.stringify(done)).toContain("ANALYSIS_INCOMPLETE");
    expect(JSON.stringify(done)).toContain("Recovery needed");
    expect(JSON.stringify(done)).toContain("Blocked by");
    expect(JSON.stringify(done)).not.toContain("NO_VERIFIED_FINDING");
    expect(JSON.stringify(done)).not.toContain("تعذر عرض الاستجابة لأنها لم تلتزم بلغة الطلب");
  });

  it("redacts runtime paths and opaque IDs from JSON, SSE, and persisted assistant content", async () => {
    const sensitive = "/home/runner/workspace/artifacts/api-server/src/chat.ts";
    const internalId = "123e4567-e89b-12d3-a456-426614174000";
    const responseText = `Read ${sensitive}; request ${internalId}.`;
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _provider, onDelta) => {
        (onDelta as ((delta: string) => void) | undefined)?.(responseText);
        return {
          ...MOCK_CHAT_RESULT,
          result: { ...MOCK_CHAT_RESULT.result, response: responseText },
        };
      },
    );

    const body = { projectId: "test-project-id", message: "Summarize the result." };
    const json = await request(app).post("/api/ai/chat").send(body);
    const stream = await request(app).post("/api/ai/chat/stream").send(body);

    expect(json.status).toBe(200);
    expect(JSON.stringify(json.body)).not.toContain(sensitive);
    expect(JSON.stringify(json.body)).not.toContain(internalId);
    expect(stream.status).toBe(200);
    expect(stream.text).not.toContain(sensitive);
    expect(stream.text).not.toContain(internalId);
    expect(chatCapture.assistantContent).not.toContain(sensitive);
    expect(chatCapture.assistantContent).not.toContain(internalId);
  });

  it("redacts runtime paths and opaque IDs from sources and persisted tool traces in both exports", async () => {
    const sensitive = "/app/runtime/artifacts/api-server/src/chat.ts";
    const internalId = "123e4567-e89b-12d3-a456-426614174000";
    const source = `${sensitive} (request ${internalId})`;
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _provider, onDelta, _options, _reset, onStep) => {
        (onDelta as ((delta: string) => void) | undefined)?.("Answer without sensitive metadata.");
        (onStep as ((step: AgentStep) => void) | undefined)?.({
          kind: "tool_call",
          tool: "read_file",
          args: { path: source },
          cached: false,
        } as AgentStep);
        (onStep as ((step: AgentStep) => void) | undefined)?.({
          kind: "tool_result",
          tool: "read_file",
          source,
          cached: false,
        } as AgentStep);
        return {
          ...MOCK_CHAT_RESULT,
          result: {
            ...MOCK_CHAT_RESULT.result,
            sources: [source],
            response: "Answer without sensitive metadata.",
          },
        };
      },
    );

    const body = { projectId: "test-project-id", message: "Summarize the sources." };
    const json = await request(app).post("/api/ai/chat").send(body);
    const stream = await request(app).post("/api/ai/chat/stream").send(body);

    for (const exportBody of [JSON.stringify(json.body), stream.text, chatCapture.assistantToolTrace ?? ""]) {
      expect(exportBody).not.toContain(sensitive);
      expect(exportBody).not.toContain(internalId);
    }
    expect(json.body.sources).toEqual(["[runtime path] (request [internal id])"]);
    expect(JSON.parse(chatCapture.assistantToolTrace!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_call", args: { path: "[runtime path] (request [internal id])" } }),
      expect.objectContaining({ kind: "tool_result", source: "[runtime path] (request [internal id])" }),
      expect.objectContaining({ kind: "execution_ledger", terminalReason: "completed" }),
    ]));
  });

  it("routes implementation-plan requests as read-only chat on JSON and SSE", async () => {
    const captured: Array<{
      turnIntent?: Record<string, unknown>;
      options?: Record<string, unknown>;
    }> = [];
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, params, _provider, _onDelta, options) => {
        const input = params as { turnIntent?: Record<string, unknown> };
        captured.push({
          turnIntent: input.turnIntent,
          options: options as Record<string, unknown>,
        });
        return MOCK_CHAT_RESULT;
      },
    );

    const body = {
      projectId: "test-project-id",
      message: "Create an implementation plan for feature X.",
    };
    const json = await request(app).post("/api/ai/chat").send(body);
    const stream = await request(app).post("/api/ai/chat/stream").send(body);

    expect(json.status, JSON.stringify(json.body)).toBe(200);
    expect(stream.status, stream.text).toBe(200);
    expect(vi.mocked(requireProvider).mock.calls.slice(-2).map((call) => call[2])).toEqual([
      { requireTools: false, qualityProfile: "chat" },
      { requireTools: false, qualityProfile: "chat" },
    ]);
    expect(captured).toHaveLength(2);
    for (const call of captured) {
      expect(call.turnIntent).toMatchObject({
        kind: "DELIVERY",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        operationMode: "DELIVERY",
      });
      expect(call.options).toEqual({
        requireTools: false,
        qualityProfile: "chat",
      });
    }
  });

  it("keeps non-imperative action questions in ordinary chat on JSON and SSE", async () => {
    const captured: Array<{
      turnIntent?: Record<string, unknown>;
      options?: Record<string, unknown>;
    }> = [];
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, params, _provider, _onDelta, options) => {
        const input = params as { turnIntent?: Record<string, unknown> };
        captured.push({
          turnIntent: input.turnIntent,
          options: options as Record<string, unknown>,
        });
        return MOCK_CHAT_RESULT;
      },
    );

    const body = {
      projectId: "test-project-id",
      message: "How do I edit settings?",
    };
    const json = await request(app).post("/api/ai/chat").send(body);
    const stream = await request(app).post("/api/ai/chat/stream").send(body);

    expect(json.status, JSON.stringify(json.body)).toBe(200);
    expect(stream.status, stream.text).toBe(200);
    expect(vi.mocked(requireProvider).mock.calls.slice(-2).map((call) => call[2])).toEqual([
      { requireTools: false, qualityProfile: "chat" },
      { requireTools: false, qualityProfile: "chat" },
    ]);
    expect(captured).toHaveLength(2);
    for (const call of captured) {
      expect(call.turnIntent).toMatchObject({
        kind: "CHAT",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        operationMode: "CHAT",
      });
      expect(call.options).toEqual({
        requireTools: false,
        qualityProfile: "chat",
      });
    }
  });

  it("routes composed polite modification requests as delivery on JSON and SSE", async () => {
    const captured: Array<{
      turnIntent?: Record<string, unknown>;
      options?: Record<string, unknown>;
    }> = [];
    const validRootPath = `${process.cwd()}/src/routes/ai`;
    vi.mocked(resolveRootPath)
      .mockResolvedValueOnce({
        validRootPath,
        fallbackUsed: false,
        originalPath: validRootPath,
      })
      .mockResolvedValueOnce({
        validRootPath,
        fallbackUsed: false,
        originalPath: validRootPath,
      });
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, params, _provider, _onDelta, options) => {
        const input = params as { turnIntent?: Record<string, unknown> };
        captured.push({
          turnIntent: input.turnIntent,
          options: options as Record<string, unknown>,
        });
        return MOCK_CHAT_RESULT;
      },
    );

    const body = {
      projectId: "test-project-id",
      message: "Can you please fix it?",
    };
    const json = await request(app).post("/api/ai/chat").send(body);
    const stream = await request(app).post("/api/ai/chat/stream").send(body);

    expect(json.status, JSON.stringify(json.body)).toBe(200);
    expect(stream.status, stream.text).toBe(200);
    expect(vi.mocked(requireProvider).mock.calls.slice(-2).map((call) => call[2])).toEqual([
      { requireTools: true, qualityProfile: "task_execution" },
      { requireTools: true, qualityProfile: "task_execution" },
    ]);
    expect(captured).toHaveLength(2);
    for (const call of captured) {
      expect(call.turnIntent).toMatchObject({
        kind: "DELIVERY",
        executionTaskType: "task_execution",
        requiresTools: true,
        requiresEvidence: false,
        operationMode: "DELIVERY",
      });
      expect(call.options).toEqual({
        requireTools: true,
        qualityProfile: "task_execution",
      });
    }
  });

  it("ignores stale Build and execution metadata for an Arabic greeting", async () => {
    let capturedParams: Record<string, unknown> | undefined;
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, params) => {
        capturedParams = params as Record<string, unknown>;
        return {
          ...MOCK_CHAT_RESULT,
          result: {
            ...MOCK_CHAT_RESULT.result,
            response: "أهلًا بك!",
          },
        };
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({
        projectId: "test-project-id",
        message: "مرحبا",
        executionId: "10000000-0000-4000-8000-000000000001",
        resumeToken: "stale-resume-token-that-is-long-enough",
        buildPlanMessageId: "20000000-0000-4000-8000-000000000002",
      });

    expect(res.status).toBe(200);
    expect(requireProvider).toHaveBeenCalledWith(
      "test-user",
      expect.anything(),
      expect.objectContaining({ requireTools: false, qualityProfile: "chat" }),
    );
    expect(capturedParams).toMatchObject({
      message: "مرحبا",
      buildHandoff: false,
      turnIntent: {
        kind: "CHAT",
        executionTaskType: "chat",
        requiresTools: false,
        requiresEvidence: false,
        operationMode: "CHAT",
      },
    });

    const frames = parseSseFrames(res.text) as Array<Record<string, unknown>>;
    expect(frames.some((frame) => frame.type === "forensic_terminal")).toBe(false);
    expect(frames.find((frame) => frame.type === "done")).toMatchObject({
      type: "done",
      operationMode: "CHAT",
    });
  });

  it("emits a forensic_status SSE event when chatWithFallback calls onStep with an isFixtureLocal:true step", async () => {
    // Arrange: mock chatWithFallback to call the real onStep closure with a
    // fixture-local forensic_status step.  The real onStep in chat.ts will then
    // call sse({ type: 'forensic_status', auditScope, isFixtureLocal }).
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_LOCAL_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    // Act: hit the actual stream route.
    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    // Assert: the route returned a valid SSE response.
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    // Assert: exactly one forensic_status frame is present.
    const frames = parseSseFrames(res.text);
    const forensicFrames = frames.filter(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "forensic_status",
    );
    expect(forensicFrames).toHaveLength(1);
  });

  it("forensic_status event carries isFixtureLocal:true when the step has it", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_LOCAL_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    const frames = parseSseFrames(res.text);
    const forensicFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "forensic_status",
    );

    expect(forensicFrame).toBeDefined();
    expect(forensicFrame!.isFixtureLocal).toBe(true);
    expect(forensicFrame!.auditScope).toBe("FIXTURE_LOCAL");
    expect(forensicFrame).toMatchObject({
      effectiveRoot: "PROJECT_ROOT",
      projectRevision: "rev-safe-123",
      completeReads: false,
      appliedBudget: { maxIterations: 12, maxToolCalls: 24 },
      readStatuses: [
        { path: "src/a.ts", status: "READ_COMPLETE" },
        { path: "src/b.ts", status: "READ_TRUNCATED" },
      ],
      synthesisLifecycle: {
        started: true,
        attempted: true,
        timedOut: false,
        skipped: false,
      },
    });
  });

  it("isFixtureLocal is absent from the forensic_status event when the step has a production scope", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(PRODUCTION_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    const frames = parseSseFrames(res.text);
    const forensicFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "forensic_status",
    );

    expect(forensicFrame).toBeDefined();
    expect(forensicFrame!.auditScope).toBe("PRODUCTION");
    // JSON.stringify drops undefined — key must be absent in the wire frame.
    expect(forensicFrame).not.toHaveProperty("isFixtureLocal");
  });

  it("forensic_status event arrives before the done event in the SSE stream", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_LOCAL_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    const frames = parseSseFrames(res.text);
    const types = frames.map((f) =>
      typeof f === "object" && f !== null ? (f as Record<string, unknown>).type : null,
    );

    const forensicIdx = types.indexOf("forensic_status");
    const doneIdx     = types.indexOf("done");

    expect(forensicIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(forensicIdx).toBeLessThan(doneIdx);
  });

  it("the done event is still emitted after the forensic_status event", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_LOCAL_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit this codebase" });

    const frames = parseSseFrames(res.text);
    const doneFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "done",
    );

    expect(doneFrame).toBeDefined();
  });

  it("emits a cross_file_trace event with its exact source span", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(CROSS_FILE_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "inspect chat.ts" });

    const frames = parseSseFrames(res.text);
    const traceFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "cross_file_trace",
    );

    expect(traceFrame).toMatchObject({
      type: "cross_file_trace",
      status: "PROVEN",
      edges: [{
        sourceSpan: {
          file: "src/chat.ts",
          line: 932,
          column: 11,
        },
      }],
    });
  });

  it("emits a decision_trace event proving the task router reached the client", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(DECISION_TRACE_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "how does maxIterations behave?" });

    const frames = parseSseFrames(res.text);
    const decisionFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "decision_trace",
    );

    expect(decisionFrame).toMatchObject({
      type: "decision_trace",
      taskType: "BEHAVIOR_QUERY",
      finalState: "VERIFIED",
      validator: "behavior-answer",
    });
    expect(decisionFrame).toHaveProperty("evidenceSelected", 1);
  });

  it("forwards verdictScope + scopedFindingStatus when the decision_trace step has them", async () => {
    // Task #58: a fixture-local verdict's proof scope must be visible live in
    // the audit panel — the SSE decision_trace event carries the fields the
    // persisted trace stores.
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_VERDICT_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit the fixture" });

    const frames = parseSseFrames(res.text);
    const decisionFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "decision_trace",
    );

    expect(decisionFrame).toMatchObject({
      type: "decision_trace",
      taskType: "FINDING",
      finalState: "VERIFIED",
    });
    expect(decisionFrame!.verdictScope).toBe("FIXTURE_LOCAL");
    expect(decisionFrame!.scopedFindingStatus).toBe("FIXTURE_PROVEN");
  });

  it("omits verdictScope + scopedFindingStatus when the step has none", async () => {
    // A step without a proof scope must not invent one on the wire.
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(DECISION_TRACE_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "how does maxIterations behave?" });

    const frames = parseSseFrames(res.text);
    const decisionFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "decision_trace",
    );

    expect(decisionFrame).toMatchObject({ type: "decision_trace" });
    expect(decisionFrame).not.toHaveProperty("verdictScope");
    expect(decisionFrame).not.toHaveProperty("scopedFindingStatus");
  });

  it("done event forwards behaviorEvidence as a parsed array with exact source spans", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, _onStep) =>
        BEHAVIOR_EVIDENCE_STEP_RESULT,
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "how does maxIterations behave?" });

    const frames = parseSseFrames(res.text);
    const doneFrame = frames.find(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && (f as Record<string, unknown>).type === "done",
    );

    expect(doneFrame).toBeDefined();
    // The wire frame carries a parsed array — never a JSON-encoded string.
    const rawEvidence = doneFrame!.behaviorEvidence;
    expect(Array.isArray(rawEvidence)).toBe(true);
    const evidence = rawEvidence as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      source: "src/loop.ts",
      excerpt: "const result = await chat(...)",
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      sourceSpan: { startLine: 1396, endLine: 1426 },
    });
    expect(evidence[1].sourceSpan).toEqual({ startLine: 12, endLine: 12 });
  });
});

describe("POST /api/ai/chat/stream — validation privacy boundary", () => {
  it.each([
    { label: "failed", step: SENSITIVE_VALIDATION_STEP },
    { label: "passed", step: PASSED_VALIDATION_STEP },
  ])("emits the public nested validation schema for $label events", async ({ step }) => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(step);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "hello" });

    expect(res.status).toBe(200);
    const frames = parseSseFrames(res.text);
    const validationFrame = frames.find(
      (frame): frame is Record<string, unknown> =>
        typeof frame === "object"
        && frame !== null
        && (frame as Record<string, unknown>).type === "validation",
    );
    expect(validationFrame).toBeDefined();

    // This is the public wire contract. Keep raw command results and source
    // details out of the nested payload even while compatibility fields remain
    // on the outer event for older clients.
    expect(validationFrame!.validation).toEqual({
      profile: step.result.profile,
      status: step.result.status,
      scenario: step.result.scenario,
      exitCode: step.result.exitCode,
      evidence: step.result.evidence,
      detail: step.result.detail
        ?.replace(/\s+/g, " ")
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
        .replace(/\b(?:bearer|token|secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]"),
    });
    expect(validationFrame!.validation).not.toHaveProperty("command");
    expect(validationFrame!.validation).not.toHaveProperty("stdout");
    expect(validationFrame!.validation).not.toHaveProperty("stderr");
    expect(validationFrame!.validation).not.toHaveProperty("failedTests");
    expect(validationFrame!.validation).not.toHaveProperty("changedFiles");
    expect(res.text).not.toContain(step.result.command);
    expect(res.text).not.toContain(step.result.stdout);
    expect(res.text).not.toContain(step.result.stderr);
    expect(res.text).not.toContain(step.result.changedFiles[0]);
  });

  it("removes command output and test/source details from SSE and persisted trace", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(SENSITIVE_VALIDATION_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "hello" });

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).not.toContain("pnpm test");
    expect(body).not.toContain("PRIVATE_SOURCE");
    expect(body).not.toContain("private.test.ts");
    expect(body).not.toContain("secret@example.com");
    expect(body).not.toContain("abc123");

    const trace = JSON.parse(chatCapture.assistantToolTrace!) as Array<Record<string, unknown>>;
    const validation = trace.find((entry) => entry.kind === "validation");
    expect(validation).toBeDefined();
    expect(validation!.validation).toEqual(expect.objectContaining({
      profile: "api-ai-tests",
      status: "failed",
      exitCode: 1,
    }));
    expect(validation!.validation).not.toHaveProperty("command");
    expect(validation!.validation).not.toHaveProperty("stdout");
    expect(validation!.validation).not.toHaveProperty("stderr");
    expect(validation!.validation).not.toHaveProperty("failedTests");
    expect(validation!.validation).not.toHaveProperty("changedFiles");
  });
});

// ── Task #59 — scoped verdict survives serialization into persisted columns ──
//
// The dashboard re-hydrates the audit panel's proof scope from the stored
// assistant message, so a scoped run must persist verdictScope/scopedFindingStatus
// into BOTH the tool_trace column (via serializeToolTrace's decision_trace case)
// and the repair_plan_metadata column (via serializeRepairPlanMetadata), and those
// values must survive a JSON round-trip back through parseRepairPlanMetadata. If a
// future refactor drops the scope at serialization time, these tests fail rather
// than degrading silently.

describe("POST /api/ai/chat/stream — scoped verdict persists into tool_trace/repair_plan_metadata", () => {
  /** Standard result carrying a scoped RepairPlanMetadata phase. */
  const SCOPED_REPAIR_RESULT = {
    result: {
      response: "Audit complete.",
      sources: [] as string[],
      pendingChanges: [] as unknown[],
      repairPlan: [{
        findingId: "F-1",
        files: ["test/fixture.ts"],
        steps: ["Verify the fixture-local verdict scope survives persistence."],
        validationProfile: "api-ai-tests",
        verdictScope: "FIXTURE_LOCAL",
        scopedFindingStatus: "FIXTURE_PROVEN",
      }],
      resolvedModel: { id: "test-model", provider: "openai", free: false },
      _parseError: undefined,
    },
    effectiveProvider: "openai",
  };

  it("persists verdictScope + scopedFindingStatus into tool_trace for a scoped decision_trace step", async () => {
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(FIXTURE_VERDICT_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "audit the fixture" });

    expect(res.status).toBe(200);
    // A step was collected, so a non-null tool_trace column must have been written.
    expect(chatCapture.assistantToolTrace).not.toBeNull();

    const trace = JSON.parse(chatCapture.assistantToolTrace!) as Array<Record<string, unknown>>;
    const decision = trace.find((entry) => entry.kind === "decision_trace");
    expect(decision).toBeDefined();
    expect(decision!.verdictScope).toBe("FIXTURE_LOCAL");
    expect(decision!.scopedFindingStatus).toBe("FIXTURE_PROVEN");
  });

  it("persists verdictScope + scopedFindingStatus into repair_plan_metadata for a scoped scenario", async () => {
    // Drive a run whose result carries a scoped RepairPlanMetadata phase; the
    // route serializes result.repairPlan into the repair_plan_metadata column.
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async () => SCOPED_REPAIR_RESULT,
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "propose a scoped repair plan" });

    expect(res.status).toBe(200);
    expect(chatCapture.assistantRepairPlanMetadata).not.toBeNull();

    // Round-trip the persisted column back through the same schema the route's
    // parseRepairPlanMetadata uses; the scope must survive parse, not be lost.
    const parsed = JSON.parse(chatCapture.assistantRepairPlanMetadata!) as unknown;
    const result = z.array(RepairPlanMetadataSchema).max(12).safeParse(parsed);
    expect(result.success).toBe(true);
    expect(result.data![0]).toMatchObject({
      findingId: "F-1",
      verdictScope: "FIXTURE_LOCAL",
      scopedFindingStatus: "FIXTURE_PROVEN",
    });
  });

  it("omits scope fields from the persisted tool_trace when the step has none", async () => {
    // A step without a proof scope must not invent one in the persisted column.
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, onStep) => {
        (onStep as ((s: AgentStep) => void) | undefined)?.(DECISION_TRACE_STEP);
        return MOCK_CHAT_RESULT;
      },
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "how does maxIterations behave?" });

    expect(res.status).toBe(200);
    expect(chatCapture.assistantToolTrace).not.toBeNull();

    const trace = JSON.parse(chatCapture.assistantToolTrace!) as Array<Record<string, unknown>>;
    const decision = trace.find((entry) => entry.kind === "decision_trace");
    expect(decision).toBeDefined();
    expect(decision).not.toHaveProperty("verdictScope");
    expect(decision).not.toHaveProperty("scopedFindingStatus");
  });

  it("omits scope fields from the persisted repair_plan_metadata when the plan has none", async () => {
    // A repair plan without a scope must round-trip as-is — no scope invented.
    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async (_userId, _params, _cfg, _onDelta, _opts, _onStreamReset, _onStep) => ({
        result: {
          response: "Audit complete.",
          sources: [] as string[],
          pendingChanges: [] as unknown[],
          repairPlan: [{
            findingId: "F-1",
            files: ["test/fixture.ts"],
            steps: ["Unscoped phase."],
            validationProfile: "api-ai-tests",
          }],
          resolvedModel: { id: "test-model", provider: "openai", free: false },
          _parseError: undefined,
        },
        effectiveProvider: "openai",
      }),
    );

    const res = await request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "propose an unscoped repair plan" });

    expect(res.status).toBe(200);
    expect(chatCapture.assistantRepairPlanMetadata).not.toBeNull();

    const parsed = JSON.parse(chatCapture.assistantRepairPlanMetadata!) as unknown;
    const result = z.array(RepairPlanMetadataSchema).max(12).safeParse(parsed);
    expect(result.success).toBe(true);
    expect(result.data![0]).not.toHaveProperty("verdictScope");
    expect(result.data![0]).not.toHaveProperty("scopedFindingStatus");
  });
});

describe("POST /api/ai/chat/stream — terminal message reservation", () => {
  it("keeps one successful terminal message when success requests overlap", async () => {
    let providerCalls = 0;
    let releaseProviders!: () => void;
    const bothProvidersEntered = new Promise<void>((resolve) => {
      releaseProviders = resolve;
    });

    vi.mocked(chatWithFallback as (...a: unknown[]) => unknown).mockImplementation(
      async () => {
        providerCalls += 1;
        if (providerCalls === 2) releaseProviders();
        await bothProvidersEntered;
        return MOCK_CHAT_RESULT;
      },
    );

    const firstRequest = request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "overlapping request" });
    const secondRequest = request(app)
      .post("/api/ai/chat/stream")
      .send({ projectId: "test-project-id", message: "overlapping request" });
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(providerCalls).toBe(2);

    const dbFixture = (await import("@workspace/db") as unknown as {
      __chatTestFixture: {
        execution: Record<string, unknown>;
        messages: Array<Record<string, unknown>>;
      };
    }).__chatTestFixture;
    const assistants = dbFixture.messages.filter((message) => message.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.outcome).toBe("SUCCEEDED");
    expect(dbFixture.execution.finalMessageId).toBe(assistants[0]?.id);
    expect(dbFixture.execution.status).toBe("completed");

    const doneFrames = [first, second]
      .flatMap((response) => parseSseFrames(response.text))
      .filter((frame) => typeof frame === "object"
        && frame !== null
        && (frame as Record<string, unknown>).type === "done");
    expect(doneFrames).toHaveLength(1);
  });
});
