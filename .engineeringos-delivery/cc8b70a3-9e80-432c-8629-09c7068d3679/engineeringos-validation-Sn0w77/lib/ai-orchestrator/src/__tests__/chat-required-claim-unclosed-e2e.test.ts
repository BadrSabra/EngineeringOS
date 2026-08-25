/**
 * Task #53 — FEG-011/012 end to end: every claim must be closed before an
 * answer is final.
 *
 * The plan-prefetch retains a real source body (evidence inventory) for a
 * BEHAVIOR_QUERY, but the model's answer grounds no exact excerpt from it. The
 * Required Claim for that question therefore stays UNCLOSED, and the final seam
 * must:
 *
 *   - emit the EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED diagnostic (never finalize
 *     on the evidence inventory alone);
 *   - record a `claim:` rejection reason on the verification trace;
 *   - NOT surface a completed final answer.
 *
 * This closes the AI-009 analogue for the inventory case while keeping the
 * grounded case (a cited excerpt CLOSES the claim even without a Finding)
 * untouched — that contract is locked by chat-behavior-grounded-notproven-e2e.
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
    project: "test | required-claim-unclosed e2e",
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
  // Non-null plan routes the source through the plan-prefetch path, recording
  // the real file body into forensicFileContents (the evidence inventory).
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
const FILE_CONTENT = [
  "export const MAX_ITERATIONS = 20;",
  "export function run() {",
  "  return MAX_ITERATIONS;",
  "}",
].join("\n");

const FILE_B = "src/parser.ts";
const FILE_B_CONTENT = "export function parse(src: string): string { return src; }\n";

// A second file read only inside the tool loop (never retained as evidence) to
// force a telemetry inconsistency: unique reads exceed the retained-evidence
// set, so reconcileAndGateVerdict gates the verdict to NOT PROVEN.
const OTHER = "src/other.ts";
const OTHER_CONTENT = [
  "export const OTHER = 7;",
  "export function helper() {",
  "  return OTHER;",
  "}",
].join("\n");

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-required-claim-"));
  await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
  await fs.writeFile(path.join(rootPath, FILE), FILE_CONTENT, "utf8");
  await fs.writeFile(path.join(rootPath, FILE_B), FILE_B_CONTENT, "utf8");
  await fs.writeFile(path.join(rootPath, OTHER), OTHER_CONTENT, "utf8");
  return rootPath;
}

function fakeStrategyFor(modelResponse: string, calls: { count: number }): unknown {
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

// Native-SSE strategy (Groq/DeepSeek). `call` drives the tool loop; `stream`
// yields the model's final text incrementally. Forces a telemetry inconsistency
// exactly like the evidence-integrity regression: the loop issues a targeted
// `read_file_range` of a SECOND file (advancing unique reads beyond retained
// evidence), so reconcileAndGateVerdict gates the verdict to NOT PROVEN while
// the ORIGINAL answer still grounds the loop cap (all required claims CLOSED).
function nativeSseStrategyFor(modelResponse: string, calls: { count: number }): unknown {
  let extraReadIssued = false;
  return {
    providerId: "groq",
    supportsNativeStream: true,
    call: vi.fn(async (_messages, callNumber: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (!extraReadIssued && callNumber.tools?.some((t) => t.function.name === "read_file_range")) {
        extraReadIssued = true;
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

const PLAN = {
  targetFiles: [FILE],
  targetEntities: [],
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
};

const MESSAGE = "Does the loop run at most 20 iterations?";

describe("chat() refuses to finalize while evidence is retained but no claim is closed (task #53)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("emits EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED and blocks closure when a read is retained but the answer grounds nothing", async () => {
    const rootPath = await makeRoot();
    // The model cites NO exact source excerpt (and no label), so grounding
    // yields zero evidence references even though the inventory holds a read.
    const ungroundedResponse = "The loop runs up to its configured limit without exceeding it.";

    const calls = { count: 0 };
    await mockChatProviders(fakeStrategyFor(ungroundedResponse, calls), PLAN);

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

      // The machine signal: the diagnostic is surfaced, so the model/operator
      // knows the answer is NOT final.
      const diagnostic = [...steps].reverse().find(
        (s) => s.kind === "diagnostic" && s.code === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
      );
      expect(diagnostic?.kind).toBe("diagnostic");
      if (diagnostic?.kind === "diagnostic") {
        expect(diagnostic.code).toBe("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
      }

      // Verification trace records a `claim:` reason (evidence retained, claim
      // unclosed) instead of pretending the run was complete.
      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      expect(verification?.kind).toBe("verification");
      if (verification?.kind === "verification") {
        const reasons = verification.trace.rejectionReasons ?? [];
        expect(reasons.some((r) => r.startsWith("claim:"))).toBe(true);
      }

      // The non-streaming response itself is the EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED
      // terminal — NOT the generic missing-evidence message. Despite
      // behaviorAnswerRejected (zero grounded excerpts), the retained inventory
      // must classify the run as evidence-available/unclosed-claim.
      expect(result.response).toContain("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
      expect(result.response).toMatch(/^NOT PROVEN/);

      // It is NOT a completed final answer, and the answer carries no evidence.
      if (result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT") {
        expect(result.taskResult.answer.evidence).toEqual([]);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("BLOCKS finalization when the answer grounds one retained file but leaves the NAMED source's required claim unclosed", async () => {
    const rootPath = await makeRoot();
    // The question names src/loop.ts explicitly (single explicit file -> stays
    // on the behavior-answer seam, not forensic audit mode). The plan prefetches
    // BOTH files, but the model grounds an exact excerpt from src/parser.ts only.
    // The named src/loop.ts required claim therefore stays UNCLOSED, while the
    // primary claim is grounded — exactly the "one grounded claim plus one
    // ungrounded required claim" shape that must NOT finalize.
    const message = "Does src/loop.ts's run() cap the loop at MAX_ITERATIONS? Answer with evidence.";
    const groundedOtherResponse =
      "Source: `src/parser.ts`\n" +
      "`return src;` shows parse() returns its input unchanged, which is unrelated to the loop cap.";

    const calls = { count: 0 };
    const planBoth = { ...PLAN, targetFiles: [FILE, FILE_B] };
    await mockChatProviders(fakeStrategyFor(groundedOtherResponse, calls), planBoth);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      // One claim (primary, via the grounded parser excerpt) is closed, but the
      // named src/loop.ts required claim is unclosed -> the run is reported as
      // EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED and refused finalization.
      const diagnostic = [...steps].reverse().find(
        (s) => s.kind === "diagnostic" && s.code === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
      );
      expect(diagnostic?.kind).toBe("diagnostic");
      if (diagnostic?.kind === "diagnostic") {
        const details = Array.isArray(diagnostic.details) ? diagnostic.details : [];
        expect(details.some((d) => String(d).includes("src:src/loop.ts"))).toBe(true);
      }

      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      expect(verification?.kind).toBe("verification");
      if (verification?.kind === "verification") {
        const reasons = verification.trace.rejectionReasons ?? [];
        expect(reasons.some((r) => r.startsWith("claim:src:src/loop.ts"))).toBe(true);
      }

      // The grounded text must NOT be surfaced as a completed final answer.
      expect(result.response).toMatch(/^NOT PROVEN/);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("applies the SHARED gate on the streaming path (onDelta): inventory-only response is gated to NOT PROVEN before any text is emitted", async () => {
    const rootPath = await makeRoot();
    // No exact excerpt is grounded, so the primary required claim stays
    // UNCLOSED even though the plan-prefetch retained a real source body.
    const ungroundedResponse = "The loop runs up to its configured limit without exceeding it.";

    const calls = { count: 0 };
    await mockChatProviders(fakeStrategyFor(ungroundedResponse, calls), PLAN);

    try {
      const steps: AgentStep[] = [];
      const emitted: string[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
        // Stress the streaming (direct-content) final path, which must apply
        // the SAME required-claim gate the non-streaming seam applies.
        onDelta: (delta) => emitted.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // The diagnostic fires on the streaming path too.
      const diagnostic = [...steps].reverse().find(
        (s) => s.kind === "diagnostic" && s.code === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
      );
      expect(diagnostic?.kind).toBe("diagnostic");

      // The streaming path must NOT leak the ungated model prose; it must emit
      // the gated NOT PROVEN text word-by-word (an inventory is not an answer).
      const streamedText = emitted.join("");
      expect(streamedText).toContain("NOT PROVEN");
      expect(streamedText).toContain("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
      // And the return value matches what was streamed — no unclosed answer slips
      // through the direct-content streaming return either.
      expect(result.response).toContain("NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("applies the SHARED gate on the streaming path (onDelta): a grounded claim plus an ungrounded named source claim cannot finalize", async () => {
    const rootPath = await makeRoot();
    // Question names src/loop.ts (single explicit file, stays on the behavior
    // seam), plan prefetches both, but the model grounds src/parser.ts only.
    const message = "Does src/loop.ts's run() cap the loop at MAX_ITERATIONS? Answer with evidence.";
    const groundedOtherResponse =
      "Source: `src/parser.ts`\n" +
      "`return src;` shows parse() returns its input unchanged, which is unrelated to the loop cap.";

    const calls = { count: 0 };
    const planBoth = { ...PLAN, targetFiles: [FILE, FILE_B] };
    await mockChatProviders(fakeStrategyFor(groundedOtherResponse, calls), planBoth);

    try {
      const steps: AgentStep[] = [];
      const emitted: string[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
        onDelta: (delta) => emitted.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // The diagnostic names the unclosed source-scoped claim.
      const diagnostic = [...steps].reverse().find(
        (s) => s.kind === "diagnostic" && s.code === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
      );
      expect(diagnostic?.kind).toBe("diagnostic");
      if (diagnostic?.kind === "diagnostic") {
        const details = Array.isArray(diagnostic.details) ? diagnostic.details : [];
        expect(details.some((d) => String(d).includes("src:src/loop.ts"))).toBe(true);
      }

      // Streaming path emits the gated NOT PROVEN verdict, never the grounded
      // parser-only prose that would finalize on a single closed claim.
      const streamedText = emitted.join("");
      expect(streamedText).toContain("NOT PROVEN");
      expect(streamedText).toContain("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
      expect(streamedText).not.toContain("return src; shows parse()");
      // Return value matches the gated streamed verdict.
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toContain("return src; shows parse()");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("native-SSE: keeps grounded targeted-read evidence out of the unclosed-claim path", async () => {
    // Regression for the reviewer's finding: the native-SSE required-claim gate
    // must evaluate evidence from the ORIGINAL model response, NOT re-derive it
    // after reconcileAndGateVerdict swaps in a citation-stripped telemetry
    // NOT PROVEN. Here the answer DOES ground the loop cap, so every required
    // claim is CLOSED; telemetry alone blocks the verdict.
    const rootPath = await makeRoot();
    const groundedResponse =
      "Source: `src/loop.ts`\n" +
      "The loop iteration cap is `MAX_ITERATIONS = 20`, so the loop runs at most 20 iterations.";

    const calls = { count: 0 };
    await mockChatProviders(nativeSseStrategyFor(groundedResponse, calls), PLAN);

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
        onDelta: (delta) => deltas.push(delta),
      });

      expect(calls.count).toBeGreaterThan(0);

      // Grounded evidence closes every claim and the targeted source body is
      // retained, so neither the unclosed-claim nor telemetry-blocked path is
      // appropriate.
      const unclosedDiagnostic = [...steps].reverse().find(
        (s) => s.kind === "diagnostic" && s.code === "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
      );
      expect(unclosedDiagnostic).toBeUndefined();

      // The streamed text remains the grounded answer rather than a synthetic
      // required-claim failure variant.
      const streamed = deltas.join("");
      expect(streamed).toContain("MAX_ITERATIONS = 20");
      expect(streamed).not.toContain("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");

      // No `claim:` rejection reason on the verification trace either — the
      // claims were closed; rejection comes from telemetry alone.
      const verification = [...steps].reverse().find((s) => s.kind === "verification");
      if (verification?.kind === "verification") {
        const reasons = verification.trace.rejectionReasons ?? [];
        expect(reasons.some((r) => r.startsWith("claim:"))).toBe(false);
      }
      expect(result.response).toContain("MAX_ITERATIONS = 20");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
