/**
 * Task #33 — Prove the runtime telemetry reconciliation gates the verdict.
 *
 * EI-010/011/012 reconcile the run ledger once at the final-answer seam so a
 * PROVEN verdict can never be surfaced with inconsistent telemetry. This file
 * exercises the WHOLE chat() pipeline (plan-prefetch real read + mocked provider
 * registry) for both runtime outcomes:
 *
 *   1. CONSISTENT — a well-formed read+evidence run: the prefetched source file
 *      is retained as an evidence body, and its completed read participates
 *      explicitly in the reconciled telemetry (EI-011 prefetch fold), so
 *      uniqueFilesRead == evidenceFileCount and the step reports
 *      TELEMETRY_CONSISTENT. Telemetry is NOT the gating rejection here.
 *
 *   2. INCONSISTENT — a chat()-boundary telemetry/evidence split: the run issues
 *      a targeted `read_file_range` of a second file (advancing engine
 *      telemetry) whose body is not retained as evidence, while the prefetched
 *      FILE is cited. uniqueFilesRead (2) exceeds distinct evidence (1), so the
 *      step reports TELEMETRY_INCONSISTENT and decision_trace.finalState must be
 *      NOT_PROVEN — no PROVEN/PASS verdict may surface.
 *
 *   Alongside these, evidence-integrity.test.ts asserts the seam-level EI-011
 *   fallback regression: a cited prefetched file with ZERO recorded completed
 *   reads stays TELEMETRY_INCONSISTENT instead of being silently masked by
 *   evidence-derived counts.
 *
 * If the wiring between buildRuntimeLedger / validateTelemetry / the emitted
 * evidence_integrity step ever regresses, a PROVEN-looking answer could be
 * surfaced with unreconciled telemetry again — these tests lock the contract in
 * end to end.
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
    project: "test | telemetry reconciliation e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function mockChatProviders(fakeStrategy: unknown, plan: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  // A non-null plan with targetFiles routes the source through the plan-prefetch
  // path, which records the real file body into forensicFileContents.
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => Promise.resolve(plan)),
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

const FILE = "src/loop.ts";
const OTHER = "src/other.ts";
const FILE_CONTENT = [
  "export const MAX_ITERATIONS = 20;",
  "export function run() {",
  "  return MAX_ITERATIONS;",
  "}",
].join("\n");
const OTHER_CONTENT = [
  "export const OTHER = 7;",
  "export function helper() {",
  "  return OTHER;",
  "}",
].join("\n");

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-forensic-recon-"));
  await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
  await fs.writeFile(path.join(rootPath, FILE), FILE_CONTENT, "utf8");
  await fs.writeFile(path.join(rootPath, OTHER), OTHER_CONTENT, "utf8");
  return rootPath;
}

function plan(targetFiles: string[]) {
  return {
    targetFiles,
    targetEntities: [],
    scopeEstimate: "narrow",
    suggestedIterations: 8,
    requiresToolUse: true,
    subQueries: [],
  };
}

/**
 * A broad plan matching the hierarchical-executor trigger: ≥ 2 sub-queries AND
 * scopeEstimate "broad". This is the exact path that used to stream
 * `hierarchicalResult.response` directly through onDelta with NO telemetry
 * reconciliation — a bypass that could surface a claimed PROVEN/PASS verdict.
 * Behavior-verdict requests are excluded from that early return, so a broad
 * explicit behavior query must fall through to the reconciled standard loop.
 */
function broadPlan(targetFiles: string[]) {
  return {
    targetFiles,
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 12,
    requiresToolUse: true,
    subQueries: [
      "How is the iteration cap defined?",
      "Does the loop enforce that cap?",
    ],
  };
}

const MESSAGE = "Does the loop run at most 20 iterations?";

/** Model that answers grounded on the prefetched file with no in-loop reads. */
function groundedStrategy(modelResponse: string, calls: { count: number }): unknown {
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async () => {
      calls.count += 1;
      return {
        content: JSON.stringify({ response: modelResponse, sources: [FILE] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

/**
 * Canonical source-coverage construction: the prefetched FILE is cited as
 * evidence, and the run also issues a targeted `read_file_range` of OTHER.
 * Both successful read kinds must contribute a retained source body, so the
 * reconciled ledger and persisted trace agree on the two completed files.
 */
function targetedReadStrategy(modelResponse: string, calls: { count: number }): unknown {
  let toolIssued = false;
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async (_messages, callNumber: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (!toolIssued && callNumber.tools?.some((t) => t.function.name === "read_file_range")) {
        toolIssued = true;
        return {
          content: "",
          toolCalls: [{
            id: "range-other",
            type: "function",
            function: {
              name: "read_file_range",
              arguments: JSON.stringify({ path: OTHER, startLine: 1, endLine: 5 }),
            },
          }],
          model: "initial-model",
          usage: {},
        };
      }
      return {
        content: JSON.stringify({ response: modelResponse, sources: [FILE] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

/**
 * Native-SSE strategy for the ENTER_HEADLESS / getStrategy fallback is
 * irrelevant here: chat() routes to Strategy 2 (native SSE) ONLY when the
 * strategy advertises supportsNativeStream. `call` drives the tool loop (the
 * targeted read that advances engine telemetry); `stream` yields the model's
 * final text incrementally, which chat() must buffer and gate before emitting.
 */
function nativeSseStrategy(modelResponse: string, calls: { count: number }): unknown {
  let toolIssued = false;
  return {
    providerId: "groq",
    supportsNativeStream: true,
    call: vi.fn(async (_messages, callNumber: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (!toolIssued && callNumber.tools?.some((t) => t.function.name === "read_file_range")) {
        toolIssued = true;
        return {
          content: "",
          toolCalls: [{
            id: "range-other",
            type: "function",
            function: {
              name: "read_file_range",
              arguments: JSON.stringify({ path: OTHER, startLine: 1, endLine: 5 }),
            },
          }],
          model: "initial-model",
          usage: {},
        };
      }
      return {
        content: modelResponse,
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(async function* () {
      const words = modelResponse.split(/(\s+)/);
      for (const chunk of words) {
        if (chunk) yield chunk;
      }
    }),
  };
}

/**
 * Strategy for the sequential-run isolation regression. In run 1 the loop
 * re-reads the prefetched FILE (recording it into sourceRetrieval.readPaths);
 * in run 2 it answers grounded with no in-loop reads. The same module context
 * is shared across both chats — exactly where a leaked shared `readPaths`
 * array would surface.
 */
function sequentialReReadThenPrefetchOnlyStrategy(modelResponse: string, calls: { count: number }): unknown {
  let readsRemaining = 1;
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async (_messages, callNumber: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (readsRemaining > 0 && callNumber.tools?.some((t) => t.function.name === "read_file")) {
        readsRemaining -= 1;
        return {
          content: "",
          toolCalls: [{
            id: "read-file-again",
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: FILE }) },
          }],
          model: "initial-model",
          usage: {},
        };
      }
      return {
        content: JSON.stringify({ response: modelResponse, sources: [FILE] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

describe("chat() emits evidence_integrity reconciling telemetry (task #33)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("relays the step and reports TELEMETRY_CONSISTENT for a well-formed read+evidence run", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\n" +
      "The loop iteration cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations.";

    const calls = { count: 0 };
    await mockChatProviders(groundedStrategy(groundedResponse, calls), plan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);
      // Grounded answer is surfaced as a behavior result (evidence length > 0).
      expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");

      // The seam must have relayed an evidence_integrity step.
      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind !== "evidence_integrity") return;

      // Prefetch supplied the single evidence file and, because a prefetched
      // completed read participates explicitly in the reconciled telemetry
      // (EI-011 fold), uniqueFilesRead == evidenceFileCount ⇒ CONSISTENT.
      expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
      expect(integrity.consistent).toBe(true);
      expect(integrity.uniqueFilesRead).toBe(1);
      expect(integrity.evidenceFileCount).toBe(1);

      // This well-formed run must NOT be gated by telemetry: the telemetry
      // inconsistency must never appear in the decision trace's rejection
      // reasons (the behavior-evidence gate is a separate, independent check).
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(dt?.kind).toBe("decision_trace");
      if (dt?.kind === "decision_trace") {
        const reasons = dt.trace.rejectionReason ?? [];
        expect(reasons.some((r: string) => r.startsWith("telemetry:"))).toBe(false);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps completed reads separate from accepted behavioral evidence", async () => {
    const rootPath = await makeRoot();
    // The provider identifies the relevant file, but supplies no executable
    // excerpt that can be accepted as proof of the behavioral claim.
    const sourceSuggestion =
      "Source: `src/loop.ts`\nThe file appears relevant to the iteration-limit question.";

    const calls = { count: 0 };
    await mockChatProviders(groundedStrategy(sourceSuggestion, calls), plan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind !== "evidence_integrity") return;
      expect(integrity.evidenceFileCount).toBeGreaterThan(0);
      expect(integrity.completedReadFiles).toContain(FILE);
      expect(integrity.acceptedEvidenceCount).toBe(0);
      expect(integrity.acceptedClaimCount).toBe(0);
      expect(integrity.acceptedEvidenceFiles ?? []).not.toContain(FILE);

      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).not.toContain("NO_VERIFIED_FINDING");
      expect(result.response).not.toMatch(/(?:does not|doesn't|is not|isn't)\s+(?:exist|implemented|enforced|working)/i);
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.evidence).toEqual([]);
        expect(result.taskResult.answer.sourceScope).toEqual([]);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reconciles targeted reads into the same retained-body set as telemetry", async () => {
    const rootPath = await makeRoot();
    // The mock includes a claimed verdict so this test also proves the
    // canonical read reconciliation does not manufacture a telemetry failure.
    const groundedResponse =
      "Source: `src/loop.ts`\nThe cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations." +
      " VERDICT: PROVEN";

    const calls = { count: 0 };
    await mockChatProviders(targetedReadStrategy(groundedResponse, calls), plan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind !== "evidence_integrity") return;

      // Both prefetched and targeted source bodies are retained, so completed
      // reads and evidence bodies reconcile one-for-one.
      expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
      expect(integrity.consistent).toBe(true);
      expect(integrity.uniqueFilesRead).toBe(integrity.evidenceFileCount);
      expect(integrity.completedReadFiles).toContain(OTHER);
      expect(integrity.retainedBodyFiles).toContain(OTHER);

      // No telemetry rejection should be surfaced when the canonical sets agree.
      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      expect(verification?.kind).toBe("verification");
      if (verification?.kind === "verification") {
        const reasons = verification.trace.rejectionReasons ?? [];
        expect(reasons.some((r: string) => r.startsWith("telemetry:"))).toBe(false);
      }

      // The decision trace must not contain a telemetry rejection.
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(dt?.kind).toBe("decision_trace");
      if (dt?.kind === "decision_trace") {
        expect(dt.trace.rejectionReason.some((r: string) => r.startsWith("telemetry:"))).toBe(false);
      }

      expect(result.response).toMatch(/VERDICT:\s*PROVEN/i);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not leak one run's read paths into the next run's reconciliation (sequential isolation)", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\n" +
      "The loop iteration cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations.";

    // Both chats share ONE module context (mockChatProviders called once, no
    // resetModules in between) — the exact scenario in which a leaked shared
    // readPaths array would previously corrupt the next run's prefetch dedupe.
    const calls = { count: 0 };
    await mockChatProviders(
      sequentialReReadThenPrefetchOnlyStrategy(groundedResponse, calls),
      plan([FILE]),
    );

    try {
      const { chat } = await import("../agents/chat-agent.js");

      // Run 1: the loop re-reads the prefetched FILE, so FILE is recorded in
      // sourceRetrieval.readPaths and its read is already counted by
      // uniqueReads. The prefetch fold must NOT double-count it; the run is
      // CONSISTENT (1 unique read = 1 distinct evidence file).
      const steps1: AgentStep[] = [];
      const result1 = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps1.push(step),
      });
      expect(result1.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
      const integrity1 = [...steps1].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity1?.kind).toBe("evidence_integrity");
      if (integrity1?.kind !== "evidence_integrity") return;
      expect(integrity1.code).toBe("TELEMETRY_CONSISTENT");
      expect(integrity1.uniqueFilesRead).toBe(1);

      // Run 2: prefetch-only, the loop reads nothing (readsRemaining exhausted).
      // A leaked readPaths array from run 1 would still contain FILE, so the
      // prefetch fold would wrongly suppress this legitimate prefetch read
      // (uniqueFilesRead 0 vs evidenceFileCount 1 → false INCONSISTENT). Fresh
      // per-loop telemetry must keep run 2 CONSISTENT.
      const steps2: AgentStep[] = [];
      const result2 = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps2.push(step),
      });
      expect(result2.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");
      const integrity2 = [...steps2].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity2?.kind).toBe("evidence_integrity");
      if (integrity2?.kind !== "evidence_integrity") return;
      expect(integrity2.code).toBe("TELEMETRY_CONSISTENT");
      expect(integrity2.consistent).toBe(true);
      expect(integrity2.uniqueFilesRead).toBe(1);
      expect(integrity2.evidenceFileCount).toBe(1);
      // The verdict must NOT be the gated NOT PROVEN text — i.e. run 2 was not
      // suppressed by a stale read path leaking from run 1.
      expect(result2.response).not.toMatch(/NOT PROVEN/i);

      // The decision trace for run 2 must carry no telemetry rejection — the
      // verdict was NOT gated by a stale path from run 1.
      const dt2 = [...steps2].reverse().find((s) => s.kind === "decision_trace");
      expect(dt2?.kind).toBe("decision_trace");
      if (dt2?.kind === "decision_trace") {
        const reasons = dt2.trace.rejectionReason ?? [];
        expect(reasons.some((r: string) => r.startsWith("telemetry:"))).toBe(false);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("streams a grounded targeted-read answer on the non-native path", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\nThe cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations." +
      " VERDICT: PROVEN";

    const calls = { count: 0 };
    await mockChatProviders(targetedReadStrategy(groundedResponse, calls), plan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const deltas: string[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
        onDelta: (delta: string) => deltas.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // A successful targeted read is now part of retained source evidence, so
      // the direct-content path has a reconciled proof basis.
      const claimedVerdict = /VERDICT:\s*PROVEN/i;
      const emitted = deltas.join("");
      expect(emitted).toMatch(claimedVerdict);

      expect(result.response).toMatch(claimedVerdict);
      if (result.behaviorAnswer) {
        expect(result.behaviorAnswer.answer).toMatch(claimedVerdict);
      }
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.answer).toMatch(claimedVerdict);
      }

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.retainedBodyFiles).toContain(OTHER);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("buffers native SSE until targeted-read evidence is reconciled", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\nThe cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations." +
      " VERDICT: PROVEN";

    const calls = { count: 0 };
    await mockChatProviders(nativeSseStrategy(groundedResponse, calls), plan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const deltas: string[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "groq",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
        onDelta: (delta: string) => deltas.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // Native SSE is still buffered and reconciled before emission.
      const claimedVerdict = /VERDICT:\s*PROVEN/i;
      const emitted = deltas.join("");
      expect(emitted).toMatch(claimedVerdict);

      expect(result.response).toMatch(claimedVerdict);
      if (result.behaviorAnswer) {
        expect(result.behaviorAnswer.answer).toMatch(claimedVerdict);
      }
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.answer).toMatch(claimedVerdict);
      }

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.retainedBodyFiles).toContain(OTHER);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reconciles broad queries before streaming the targeted-read answer", async () => {
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\nThe cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations." +
      " VERDICT: PROVEN";

    const calls = { count: 0 };
      // Broad behavior plans must still use the same canonical evidence seam.
    await mockChatProviders(targetedReadStrategy(groundedResponse, calls), broadPlan([FILE]));

    try {
      const steps: AgentStep[] = [];
      const deltas: string[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
        onDelta: (delta: string) => deltas.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // The answer is emitted only after the targeted body is reconciled.
      const claimedVerdict = /VERDICT:\s*PROVEN/i;
      const emitted = deltas.join("");
      expect(emitted).toMatch(claimedVerdict);

      expect(result.response).toMatch(claimedVerdict);
      if (result.behaviorAnswer) {
        expect(result.behaviorAnswer.answer).toMatch(claimedVerdict);
      }
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.answer).toMatch(claimedVerdict);
      }

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.retainedBodyFiles).toContain(OTHER);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
