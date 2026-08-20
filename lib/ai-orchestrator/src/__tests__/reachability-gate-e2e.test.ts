/**
 * AI-OBJ-004/007/010 end-to-end regression: production-reachability gate
 * through the real chat() pipeline.
 *
 * Scenarios covered:
 *  1. Import-only trace (all links IMPORT_ONLY) — must NOT produce VERIFIED;
 *     decision_trace.finalState must be NOT_PROVEN, response must start with
 *     "NOT PROVEN".
 *  2. Mixed trace (one IMPORT_ONLY + one valid invocation link without snippets)
 *     — hasImportOnlyHops=true → the chain is still unproven; blocked.
 *  3. Behavioral-only evidence with a non-import trace but no call-site snippet
 *     referencing the target symbol — claim validation produces REJECTED;
 *     external trace NOT PROVEN → gate blocks.
 *
 * These tests use the mocked provider pattern from ei-041 / ei-045.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | reachability-gate e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

/** Mock the provider and module dependencies in a way that mimics ei-041. */
async function mockChatProviders(fakeStrategy: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("../model-selection/decision-engine.js", () => ({
    resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
  }));
  vi.doMock("../model-selection/provider-strategy.js", () => ({
    resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
  }));
  vi.doMock("../model-selection/model-resolver.js", () => ({
    resolveExecutionModel: vi.fn(() => ({
      model: "initial-model",
      powerModel: "initial-model",
      fallbackChain: ["initial-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [{ id: "initial-model" }]),
  }));
}

function makeFakeStrategy(responseJson: string) {
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    ownsModelFallback: true,
    call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
      content: responseJson,
      toolCalls: [],
      model: opts?.model ?? "initial-model",
      usage: {},
    })),
    stream: vi.fn(),
  };
}

/**
 * Strategy that issues a read_file tool call for `readPath` on the first call
 * (only when read_file is in the supplied tools), then returns `responseJson`
 * on the second call. Mirrors the proven pattern from chat-scoped-verdict-e2e
 * so the caller file content actually lands in loopResult.fileContents →
 * forensicFileContents.
 */
function readThenAnswerStrategy(
  readPath: string,
  responseJson: string,
  calls: { count: number },
): unknown {
  let readIssued = false;
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    ownsModelFallback: true,
    call: vi.fn(async (_messages: unknown, opts: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (!readIssued && opts.tools?.some((t) => t.function.name === "read_file")) {
        readIssued = true;
        return {
          content: "",
          toolCalls: [{
            id: "read-reach-caller",
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: readPath }) },
          }],
          model: "initial-model",
          usage: {},
        };
      }
      return {
        content: responseJson,
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

describe("chat() production-reachability gate — end-to-end (AI-OBJ-004/007/010)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  // ── Scenario 1: Import-only trace ─────────────────────────────────────────

  it("S1 import-only trace: response is NOT PROVEN, finalState is NOT_PROVEN", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s1-"));
    const srcFile = path.join(rootPath, "src/lib.ts");
    await fs.mkdir(path.dirname(srcFile), { recursive: true });
    await fs.writeFile(
      srcFile,
      "export function computeCentrality(graph: unknown) { return {}; }\n",
      "utf8",
    );

    // Provider returns a behavioral answer claiming the function IS reachable —
    // but the trace only has import-only links, which the gate must block.
    const behavioralResponse = JSON.stringify({
      response:
        "computeCentrality is called in production via the knowledge engine service. " +
        "The function has been observed returning centrality scores.",
      sources: [],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove that computeCentrality is reachable in production.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: { id: "api:route", name: "apiRoute", stage: "API_ROUTE" },
          to: { id: "lib:computeCentrality", name: "computeCentrality", stage: "TOOL_PROVIDER" },
          relation: "IMPORT_ONLY",
          runtimeObserved: false,
        },
      ],
    });

    // The gate must block the behavioral answer.
    expect(result.response).toMatch(/NOT PROVEN/i);

    // decision_trace must show NOT_PROVEN (not VERIFIED).
    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
      // objectiveVerdict must be set and not ANSWER_COMPLETE
      expect(dt.trace.objectiveVerdict).toBeDefined();
      expect(dt.trace.objectiveVerdict).not.toBe("ANSWER_COMPLETE");
    }
  });

  // ── Scenario 2: Mixed trace (import-only + invocation) ───────────────────

  it("S2 mixed trace: ANY import-only hop means hasImportOnlyHops=true, gate blocks", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s2-"));
    const srcFile = path.join(rootPath, "src/engine.ts");
    await fs.mkdir(path.dirname(srcFile), { recursive: true });
    await fs.writeFile(
      srcFile,
      "import { computeCentrality } from './lib';\n" +
        "export function runEngine() { return computeCentrality({}); }\n",
      "utf8",
    );

    const behavioralResponse = JSON.stringify({
      response:
        "The engine calls computeCentrality directly. The chain is proven via the import.",
      sources: [],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is reachable.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        // One import-only hop — this is enough to block even if other links are valid.
        {
          from: { id: "api:route", name: "apiRoute", stage: "API_ROUTE" },
          to: { id: "engine:runEngine", name: "runEngine", stage: "ORCHESTRATOR" },
          relation: "IMPORT_ONLY",   // import hop — must trigger hasImportOnlyHops
          runtimeObserved: false,
        },
        {
          from: { id: "engine:runEngine", name: "runEngine", stage: "ORCHESTRATOR" },
          to: { id: "lib:computeCentrality", name: "computeCentrality", stage: "TOOL_PROVIDER" },
          relation: "DIRECT_INVOCATION",
          runtimeObserved: true,
        },
      ],
    });

    // The mixed chain must be blocked because it contains an import-only hop.
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
      expect(dt.trace.objectiveVerdict).not.toBe("ANSWER_COMPLETE");
    }
  });

  // ── Scenario 4: Transport-only trace (route → orchestrator:chat) ─────────
  // The production API unconditionally supplies runtimeChatTraceLinks which
  // only proves route → chat(). This must NOT block a behavioral answer.

  it("S4 generic transport trace (route→chat): behavioral answer is NOT blocked", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s4-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    const behavioralAnswer = "The maxIterations parameter controls loop termination.";
    const behavioralResponse = JSON.stringify({
      response: behavioralAnswer,
      sources: [],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "What does maxIterations do?",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      // Simulates the runtimeChatTraceLinks always supplied by the production API:
      // route → chat(). This is infrastructure metadata, NOT a code-level proof.
      productionTraceLinks: [
        {
          from: { id: "route:POST /api/ai/chat", name: "POST /api/ai/chat", stage: "API_ROUTE" },
          to: { id: "orchestrator:chat", name: "chat()", stage: "ORCHESTRATOR" },
          relation: "invokes",
          evidence: "runtime chatWithFallback dispatch",
          runtimeObserved: true,
        },
      ],
    });

    // The response must NOT be blocked by the reachability gate (which would
    // say "NOT PROVEN — production reachability could not be verified").
    // An existing forensic completeness gate may still block the response for
    // lack of source evidence — that is expected and unrelated to this task.
    // The key invariant: transport-only traces do not trigger the reachability gate.
    expect(result.response).not.toMatch(
      /NOT PROVEN — production reachability could not be verified/,
    );
  });

  // ── Scenario 5: Lowercase `imports` relation treated as import-only ───────
  // The graph convention uses lowercase relation names; the gate must normalize.

  it("S5 lowercase 'imports' relation: treated as import-only, chain is blocked", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s5-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    const behavioralResponse = JSON.stringify({
      response:
        "computeCentrality is accessible via the knowledge engine through the import chain.",
      sources: [],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is reachable in production.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: { id: "api:route", name: "apiRoute", stage: "API_ROUTE" },
          to: { id: "lib:computeCentrality", name: "computeCentrality", stage: "TOOL_PROVIDER" },
          // Lowercase graph-convention relation — must be normalized to IMPORTS / blocked.
          relation: "imports",
          runtimeObserved: false,
        },
      ],
    });

    // Lowercase "imports" must be treated as an import-only hop — response blocked.
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });

  // ── Scenario 6: Valid source-backed direct invocation (positive case) ────
  // The caller file is actually read via a read_file tool call, and it contains
  // a direct call to the target symbol. The claim must be PROVEN and the
  // response must NOT be blocked.

  it("S6 source-backed call-site in correct caller file: claim PROVEN, response passes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s6-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    // Caller file: contains a real call to computeCentrality(
    const callerContent = [
      "import { computeCentrality } from './lib';",
      "export function runEngine(graph: unknown) {",
      "  // Invoke the target function directly",
      "  return computeCentrality(graph, { maxDepth: 5 });",
      "}",
    ].join("\n");
    await fs.writeFile(path.join(rootPath, "src/engine.ts"), callerContent, "utf8");

    // Openrouter read-then-answer strategy: read src/engine.ts, then answer.
    const calls = { count: 0 };
    const answerJson = JSON.stringify({
      response:
        "runEngine in src/engine.ts invokes computeCentrality. " +
        "The call `computeCentrality(graph, { maxDepth: 5 })` is present on line 4.",
      sources: ["src/engine.ts"],
    });
    await mockChatProviders(readThenAnswerStrategy("src/engine.ts", answerJson, calls));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is reachable from runEngine.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: {
            id: "engine:runEngine",
            name: "runEngine",
            // The caller path must match what read_file used as its `path` arg.
            path: "src/engine.ts",
            stage: "ORCHESTRATOR" as never,
          },
          to: {
            id: "lib:computeCentrality",
            name: "computeCentrality",
            stage: "TOOL_PROVIDER",
          },
          relation: "DIRECT_INVOCATION",
          runtimeObserved: false,
        },
      ],
    });

    // The caller file was read and contains `computeCentrality(` — the claim
    // must be PROVEN and the reachability gate must NOT block the response.
    expect(calls.count).toBeGreaterThan(0);
    expect(result.response).not.toMatch(
      /NOT PROVEN — production reachability could not be verified/,
    );
  });

  // ── Scenario 7: Valid target call in an unrelated caller file ─────────────
  // The model reads src/unrelated.ts (which contains computeCentrality() calls),
  // but the trace link asserts the caller is src/engine.ts. The gate must reject
  // this because engine.ts was never read — it cannot prove the asserted chain.

  it("S7 call-site in wrong caller file: gate blocks because asserted caller was not read", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s7-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    // The model will read this unrelated file (it also calls computeCentrality):
    const unrelatedContent = [
      "import { computeCentrality } from './lib';",
      "export function otherFn(graph: unknown) {",
      "  return computeCentrality(graph);",
      "}",
    ].join("\n");
    await fs.writeFile(path.join(rootPath, "src/unrelated.ts"), unrelatedContent, "utf8");
    // engine.ts exists but is never read (model will not issue a read_file for it).
    const engineContent = [
      "export function runEngine(graph: unknown) {",
      "  return computeCentrality(graph, { maxDepth: 5 });",
      "}",
    ].join("\n");
    await fs.writeFile(path.join(rootPath, "src/engine.ts"), engineContent, "utf8");

    // Openrouter read-then-answer strategy: model reads the WRONG file
    // (src/unrelated.ts calls computeCentrality, but the asserted caller is
    // src/engine.ts which is never read).
    const calls = { count: 0 };
    const answerJson = JSON.stringify({
      response: "computeCentrality is called from otherFn in src/unrelated.ts.",
      sources: ["src/unrelated.ts"],
    });
    await mockChatProviders(readThenAnswerStrategy("src/unrelated.ts", answerJson, calls));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is reachable from runEngine.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: {
            id: "engine:runEngine",
            name: "runEngine",
            // Asserted caller: engine.ts — but only unrelated.ts was read.
            path: "src/engine.ts",
            stage: "ORCHESTRATOR" as never,
          },
          to: {
            id: "lib:computeCentrality",
            name: "computeCentrality",
            stage: "TOOL_PROVIDER",
          },
          relation: "DIRECT_INVOCATION",
          runtimeObserved: false,
        },
      ],
    });

    // engine.ts was never read → the claim cannot be proven for that caller →
    // gate must block the response.
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });

  // ── Scenario 3: Behavioral-only evidence, trace NOT PROVEN, no snippets ──

  it("S3 unproven trace + no call-site snippets: gate blocks and response is NOT PROVEN", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s3-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    // The behavioral response has no call-site snippet referencing computeCentrality.
    const behavioralResponse = JSON.stringify({
      response:
        "The knowledge engine computes centrality scores using BFS. " +
        "The algorithm runs in O(V+E) time. Results are cached for 5 minutes.",
      sources: [],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is called from the API route handler.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: { id: "api:route", name: "apiRoute", stage: "API_ROUTE" },
          to: { id: "lib:computeCentrality", name: "computeCentrality", stage: "TOOL_PROVIDER" },
          // A non-import relation, but status is NOT_PROVEN (no runtimeObserved evidence).
          relation: "DIRECT_INVOCATION",
          runtimeObserved: false,
          // No `evidence` field — trace is not externally proven.
        },
      ],
    });

    // The gate must block: the trace is NOT_PROVEN and no snippets confirm the call.
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });

  // ── Scenario 8 (API regression): reachability prompt + transport-only trace ─
  // The real production API always passes ONLY runtimeChatTraceLinks — a single
  // route → orchestrator:chat transport link. When the user explicitly asks to
  // prove production reachability, the gate must activate from REQUEST INTENT
  // (not from the trace) and replace an unsupported behavioral answer with
  // NOT PROVEN. This is the exact payload the api-server route sends.
  it("S8 reachability prompt via runtimeChatTraceLinks: behavioral answer is replaced with NOT PROVEN", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s8-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    // Unsupported behavioral answer — describes the algorithm, no call-site proof.
    const behavioralAnswer =
      "The knowledge engine computes centrality scores using BFS and caches results.";
    const behavioralResponse = JSON.stringify({
      response: behavioralAnswer,
      sources: ["src/engine.ts"],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      // Explicit reachability-proof request (activates the gate via intent).
      message: "Prove computeCentrality is reachable in production.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      // Exactly what runtimeChatTraceLinks("POST /api/ai/chat") emits:
      productionTraceLinks: [
        {
          from: { id: "route:POST /api/ai/chat", name: "POST /api/ai/chat", stage: "API_ROUTE" },
          to: { id: "orchestrator:chat", name: "chat()", stage: "ORCHESTRATOR" },
          relation: "invokes",
          source: "artifacts/api-server/src/routes/ai/chat.ts",
          evidence: "runtime chatWithFallback dispatch",
          runtimeObserved: true,
        },
      ],
    });

    // The transport trace proves only route → chat(), and the behavioral answer
    // contains no call-site proof. Because the user's intent activated the
    // reachability gate, the unsupported answer must be replaced — NOT pass through.
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });

  // ── Scenario 10 (Arabic API regression): Arabic reachability intent must
  // remain on the forensic proof contract through the complete chat path.
  // A provider can return a plausible Arabic behavioral claim, but the
  // transport-only runtime trace does not prove production reachability.
  it("S10 Arabic production-reachability prompt: unproven behavioral answer stays NOT PROVEN", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s10-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    const unsupportedArabicAnswer = "الدالة computeCentrality تُستدعى في الإنتاج وتعيد نتائج صحيحة.";
    const behavioralResponse = JSON.stringify({
      response: unsupportedArabicAnswer,
      sources: ["src/engine.ts"],
    });
    await mockChatProviders(makeFakeStrategy(behavioralResponse));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "أثبت أن الدالة computeCentrality قابلة للوصول في الإنتاج.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: { id: "route:POST /api/ai/chat", name: "POST /api/ai/chat", stage: "API_ROUTE" },
          to: { id: "orchestrator:chat", name: "chat()", stage: "ORCHESTRATOR" },
          relation: "invokes",
          source: "artifacts/api-server/src/routes/ai/chat.ts",
          evidence: "runtime chatWithFallback dispatch",
          runtimeObserved: true,
        },
      ],
    });

    // The Arabic candidate must never escape as a verified production claim.
    expect(result.response).toContain("NOT PROVEN");
    expect(result.response).not.toBe(unsupportedArabicAnswer);
    expect(result.taskResult).toMatchObject({
      kind: "FINDING_RESULT",
      finding: { severity: "NOT_PROVEN" },
    });
    expect(result.taskResult).not.toMatchObject({ kind: "BEHAVIOR_ANSWER_RESULT" });

    const dt = steps.find((s) => s.kind === "decision_trace");
    expect(dt).toBeDefined();
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.taskType).toBe("FINDING_ANALYSIS");
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });

  // ── Scenario 9 (declaration bypass, AI-OBJ-007 R6): the caller file only
  // DECLARES computeCentrality as a class/object-shorthand method (harmless
  // `computeCentrality(graph) { … }`), it never invokes it. The chat read
  // extracts a line containing `computeCentrality(`, so without the declaration
  // guard the gate would treat the method NAME as a call-site and prove the
  // reachability claim. R6 must reject it and block the answer.
  it("S9 method-declaration line cannot prove a call-site: gate blocks", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-reach-s9-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });

    // Caller file defines the symbol as an object-shorthand method, never calls it.
    const callerContent = [
      "export const engine = {",
      "  computeCentrality(graph: unknown) {",
      "    return graph;",
      "  },",
      "};",
    ].join("\n");
    await fs.writeFile(path.join(rootPath, "src/engine.ts"), callerContent, "utf8");

    // The model reads the caller file and answers, claiming the reachability holds.
    const calls = { count: 0 };
    const answerJson = JSON.stringify({
      response:
        "engine.computeCentrality is defined in src/engine.ts, so it is reachable at runtime.",
      sources: ["src/engine.ts"],
    });
    await mockChatProviders(readThenAnswerStrategy("src/engine.ts", answerJson, calls));

    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: "Prove computeCentrality is reachable from runEngine.",
      history: [],
      projectContext: makeContext(),
      rootPath,
      apiKey: "test-key",
      provider: "openrouter",
      onStep: (s) => steps.push(s),
      productionTraceLinks: [
        {
          from: {
            id: "engine:runEngine",
            name: "runEngine",
            path: "src/engine.ts",
            stage: "ORCHESTRATOR" as never,
          },
          to: {
            id: "lib:computeCentrality",
            name: "computeCentrality",
            stage: "TOOL_PROVIDER",
          },
          relation: "DIRECT_INVOCATION",
          runtimeObserved: false,
        },
      ],
    });

    // The caller was read, but the only `computeCentrality(` occurrence is a
    // method declaration, not an invocation. The gate must block the answer.
    expect(calls.count).toBeGreaterThan(0);
    expect(result.response).toMatch(/NOT PROVEN/i);

    const dt = steps.find((s) => s.kind === "decision_trace");
    if (dt?.kind === "decision_trace") {
      expect(dt.trace.finalState).not.toBe("VERIFIED");
    }
  });
});
