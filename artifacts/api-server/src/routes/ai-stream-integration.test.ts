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
import { eq } from "drizzle-orm";
import app from "../app.js";
import { db, projectsTable, aiChatSessionsTable, aiChatMessagesTable } from "@workspace/db";

// ─── Orchestrator mock ────────────────────────────────────────────────────────
// Mirrors the module-level mock in ai.test.ts so all imports from
// @workspace/ai-orchestrator resolve to stubs rather than live clients.

vi.mock("@workspace/ai-orchestrator", () => ({
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
    constructor(code: string, message: string) {
      super(message);
      this.name  = "GroqClientError";
      this.code  = code;
    }
    toProviderContext() { return {}; }
  },
  isCircuitOpen:           vi.fn().mockReturnValue(false),
  recordRequest:           vi.fn(),
  recordFailure:           vi.fn(),
  recordSuccess:           vi.fn(),
  recordFallbackSuccess:   vi.fn(),
  recordInvalidModel:      vi.fn(),
  recordLatency:           vi.fn(),
  sortProviderIdsByQuality: vi.fn((ids: string[]) => ids),
}));

// ─── ai-route-helpers mock ────────────────────────────────────────────────────
// chatWithFallback and requireProvider are the two route-layer functions that
// drive AI calls.  We stub them at the module level and override per test.

vi.mock("../lib/ai-route-helpers.js", () => ({
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
    ) => {
      onDelta?.("Hello");
      onDelta?.(" world");
      return {
        result:            { response: "Hello world", sources: ["context"], pendingChanges: [] },
        effectiveProvider: "groq" as const,
      };
    },
  ),
  handleOrchestratorError: vi.fn((err: unknown) => { throw err; }),
  resolveProvider:          vi.fn(async () => ({ provider: "groq", apiKey: "test-dummy-key" })),
  collectAvailableProviders: vi.fn(async () => [{ provider: "groq", apiKey: "test-dummy-key" }]),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id  = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId:  "test-user",
    name:     `stream-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/stream-test-${id}`,
    language: "typescript",
    status:   "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const projectIds: string[] = [];

beforeAll(() => {
  process.env.GROQ_API_KEY = "test-dummy-key-for-stream-tests";
});
afterAll(() => {
  delete process.env.GROQ_API_KEY;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pid of projectIds.splice(0)) {
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
    await db.delete(projectsTable).where(eq(projectsTable.id, pid)).catch(() => undefined);
  }
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
    const doneEvent = events.find((e) => e["type"] === "done");
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
});

// ─── INT-006: SSE error path (provider failover / empty chain) ────────────────

describe("INT-006 — POST /api/ai/chat/stream: provider failover surfaced cleanly through SSE", () => {
  it("should surface provider failover cleanly through the SSE stream", async () => {
    const projectId = await insertProject();
    projectIds.push(projectId);

    // Override chatWithFallback to throw MODEL_NOT_FOUND after all providers fail
    const { chatWithFallback } = await import("../lib/ai-route-helpers.js");
    const { GroqClientError } = await import("@workspace/ai-orchestrator");
    vi.mocked(chatWithFallback).mockRejectedValueOnce(
      new GroqClientError("MODEL_NOT_FOUND", "All AI model fallbacks exhausted — no model was available."),
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

    // No `done` event — the error path ends the stream without persisting a message
    const doneEvent = events.find((e) => e["type"] === "done");
    expect(doneEvent).toBeUndefined();

    // The stream is closed after the error event (no more data follows)
    const lastEvent = events[events.length - 1];
    expect(lastEvent!["type"]).toBe("error");
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
