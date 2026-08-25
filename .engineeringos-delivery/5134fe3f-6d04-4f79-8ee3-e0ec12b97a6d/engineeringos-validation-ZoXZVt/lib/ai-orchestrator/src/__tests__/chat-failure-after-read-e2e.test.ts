/**
 * Phase 5 — failure-after-read end-to-end coverage.
 *
 * These fixtures use the real chat() and file-tool loop, but a provider-free
 * strategy.  The important boundary is that a completed read is retained by
 * the server even when synthesis is empty, times out, or omits an executable
 * citation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";

const originalApiKey = process.env.GROQ_API_KEY;
const FILE = "src/loop.ts";
const FILE_CONTENT = "export function run() { return MAX_ITERATIONS; }\n";

const PLAN = {
  targetFiles: [FILE],
  targetEntities: [],
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
};

function makeContext(): ProjectContext {
  return {
    project: "test | failure after read e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "eos-failure-after-read-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, FILE), FILE_CONTENT, "utf8");
  return root;
}

async function mockChatModules(forceNormalBehavior = false): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => strategy) };
  });
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => Promise.resolve(PLAN)),
  }));
  vi.doMock("../model-selection/decision-engine.js", () => ({
    resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
  }));
  vi.doMock("../model-selection/provider-strategy.js", () => ({
    resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
  }));
  vi.doMock("../model-selection/model-resolver.js", () => ({
    resolveExecutionModel: vi.fn(() => ({
      model: "fixture-model",
      powerModel: "fixture-model",
      fallbackChain: ["fixture-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [{ id: "fixture-model" }]),
  }));
  if (forceNormalBehavior) {
    vi.doMock("../task-contracts.js", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("../task-contracts.js");
      return {
        ...actual,
        isExplicitBehaviorQueryRequest: vi.fn(() => true),
      };
    });
    vi.doMock("../turn-intent.js", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("../turn-intent.js");
      const resolve = actual.resolveTurnIntent as (message: string) => Record<string, unknown>;
      return {
        ...actual,
        resolveTurnIntent: vi.fn((message: string) => ({
          ...resolve(message),
          kind: "CHAT",
          operationMode: "CHAT",
          analysisMode: "STANDARD",
          outputContract: "BEHAVIOR_ANSWER",
          forensicTaskType: "BEHAVIOR_QUERY",
          requiresTools: true,
          requiresEvidence: true,
        })),
      };
    });
  }
}

let strategy: {
  providerId: "openrouter";
  supportsNativeStream: false;
  call: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
};

function readThen(
  final: string | Error | [string, string],
  calls: { count: number; correctionTools: unknown[] },
  issueTool = true,
  readToolName = "read_file",
) {
  let readIssued = false;
  let finalResponseIssued = false;
  strategy = {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async (_messages: unknown, options: { tools?: unknown[] } = {}) => {
      calls.count += 1;
      if (
        issueTool &&
        !readIssued &&
        options.tools?.some((tool: any) => tool?.function?.name === readToolName)
      ) {
        readIssued = true;
        return {
          content: "",
          toolCalls: [{
            id: "failure-after-read",
            type: "function" as const,
            function: {
              name: readToolName,
              arguments: JSON.stringify(
                readToolName === "read_file"
                  ? { path: FILE }
                  : { path: FILE, startLine: 1, endLine: 1 },
              ),
            },
          }],
          model: "fixture-model",
          usage: {},
        };
      }
      if (calls.count >= 2) calls.correctionTools.push(options.tools);
      const response = Array.isArray(final)
        ? (finalResponseIssued ? final[1] : final[0])
        : final;
      finalResponseIssued = true;
      if (response instanceof Error) throw response;
      return { content: response, toolCalls: [], model: "fixture-model", usage: {} };
    }),
    stream: vi.fn(),
  };
}

describe("chat() failure after completed source reads (Phase 5)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../provider-registry.js");
    vi.doUnmock("../agents/query-planner.js");
    vi.doUnmock("../model-selection/decision-engine.js");
    vi.doUnmock("../model-selection/provider-strategy.js");
    vi.doUnmock("../model-selection/model-resolver.js");
    vi.doUnmock("../openrouter/model-resolver.js");
    vi.doUnmock("../task-contracts.js");
    vi.doUnmock("../turn-intent.js");
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("returns an incomplete evidence report after an empty final response", async () => {
    const root = await makeRoot();
    const calls = { count: 0, correctionTools: [] as unknown[] };
    readThen("", calls);
    await mockChatModules();
    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: `What does ${FILE} run do?`,
        history: [],
        projectContext: makeContext(),
        rootPath: root,
        provider: "openrouter",
        apiKey: "fixture-key",
        onStep: (step) => steps.push(step),
      });

      // The empty provider result is followed by the existing bounded JSON
      // correction pass before deterministic evidence degradation.
      expect(calls.count).toBe(3);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain(FILE);
      expect(result.response).toContain("no executable excerpt was accepted");
      expect(result.response).toContain("Retry or narrow the question");
      expect(result.response).not.toContain("NO_VERIFIED_FINDING");
      expect(result.response).not.toMatch(/\bFINDING(?:_| )PROVEN\b/i);
      expect(result.response).not.toContain("fixture-key");
      expect(result.sources).toContain(FILE);
      expect(steps.some((step) => step.kind === "tool_result" && step.source === FILE)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("stops after a provider timeout with preserved reads and no generic blocked fallback", async () => {
    const root = await makeRoot();
    const calls = { count: 0, correctionTools: [] as unknown[] };
    await mockChatModules();
    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      // Construct after resetModules so the engine and fixture share the same
      // GroqClientError class identity.
      const { GroqClientError } = await import("../errors.js");
      const timeout = new GroqClientError("TIMEOUT", "fixture provider timeout");
      readThen(timeout, calls);
      const result = await chat({
        message: `What does ${FILE} run do?`,
        history: [],
        projectContext: makeContext(),
        rootPath: root,
        provider: "openrouter",
        apiKey: "fixture-key",
        onStep: (step) => steps.push(step),
      });

      // The engine may make one bounded provider fallback attempt before
      // returning the partial timeout result; it must never reread or loop.
      expect(calls.count).toBeLessThanOrEqual(3);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain(FILE);
      expect(result.response).not.toContain("NO_VERIFIED_FINDING");
      expect(result.response).not.toMatch(/\bFINDING(?:_| )PROVEN\b/i);
      expect(result.response).not.toMatch(/could not be completed|generic/i);
      expect(steps.find((step) => step.kind === "done")?.stopReason).toBe("provider_timeout");
      expect(steps.some((step) => step.kind === "tool_result" && step.source === FILE)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses request-retained evidence on a text-only fallback without rereading", async () => {
    const root = await makeRoot();
    const calls = { count: 0, correctionTools: [] as unknown[] };
    readThen("A text-only provider response.", calls, false);
    await mockChatModules(true);
    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: `What does ${FILE} run do?`,
        history: [],
        projectContext: makeContext(),
        // A provider without tool support must still be able to synthesize
        // from evidence retained by the route's prior provider attempt.
        rootPath: undefined,
        provider: "openrouter",
        apiKey: "fixture-key",
        retainedEvidence: new Map([[FILE, FILE_CONTENT]]),
      });

      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain(FILE);
      expect(result.sources).toEqual([FILE]);
      expect(result.pendingChanges).toEqual([]);
      expect(calls.count).toBe(1);
      expect(calls.correctionTools).toEqual([]);
      expect(result.response).not.toContain("fixture-key");
      expect(result.response).not.toMatch(/read_file|write_file|replace_text/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "accepts a valid literal source excerpt",
      correction: "المصدر: `src/loop.ts`، المقتطف: `return MAX_ITERATIONS;`",
      accepted: true,
    },
    {
      name: "stays incomplete when correction still lacks a literal excerpt",
      correction: "المصدر هو `src/loop.ts`، لكن لا يوجد مقتطف تنفيذي حرفي متاح.",
      accepted: false,
    },
  ])("$name with exactly one no-tool correction pass", async ({ correction, accepted }) => {
    const root = await makeRoot();
    const calls = { count: 0, correctionTools: [] as unknown[] };
    readThen(
      ["{\"response\":\"لا يوجد اقتباس حرفي في الإجابة الأولى.\",\"sources\":[]}", correction],
      calls,
      true,
      "read_file_range",
    );
    await mockChatModules(true);
    try {
      const emitted: string[] = [];
      const { chat, buildBehaviorEvidenceRecoveryMessages } =
        await import("../agents/chat-agent.js");
      const result = await chat({
        message: "كيف يعمل loop؟ What does the loop do? أجب بالعربية.",
        history: [],
        projectContext: makeContext(),
        rootPath: root,
        provider: "openrouter",
        apiKey: "fixture-key",
        onDelta: (delta) => emitted.push(delta),
      });
      expect(calls.count).toBeLessThanOrEqual(3);
      const { validateBehaviorEvidence } = await import("../task-contracts.js");
      const correctionValidation = validateBehaviorEvidence(
        "What does the loop do?",
        correction,
        new Map([[FILE, FILE_CONTENT]]),
      );
      const recoveryMessages = buildBehaviorEvidenceRecoveryMessages(
        "كيف يعمل loop؟",
        new Map([[FILE, FILE_CONTENT]]),
        "لا يوجد اقتباس حرفي في الإجابة الأولى.",
      );
      expect(recoveryMessages.some((message) => message.role === "tool")).toBe(false);
      expect(recoveryMessages.some((message) => "tool_calls" in message)).toBe(false);
      expect(emitted.join("")).toBe(result.response);
      if (accepted) {
        expect(correctionValidation.evidence.some((e) => e.supportsClaim)).toBe(true);
      } else {
        expect(correctionValidation.evidence.some((e) => e.supportsClaim)).toBe(false);
        expect(result.response).toMatch(/ANALYSIS_INCOMPLETE|غير مثبت/);
        expect(result.response).not.toMatch(/\bFINDING(?:_| )PROVEN\b/i);
        expect(result.response).not.toContain("NO_VERIFIED_FINDING");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});