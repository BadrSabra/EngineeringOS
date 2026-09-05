/**
 * Regression guard for the AI Model Capability Probe (docs/ai-model-capability-probe-prompt.md).
 *
 * The probe (a) names two explicit files, (b) asks behavior/grounding questions,
 * and (c) only ever DENIES repair/finding intent: "Do not perform repair
 * analysis", "Do NOT invent a defect finding", "Do not include a repair plan".
 * Before the negation-aware classifier fix, those phrases matched
 * REPAIR_ANALYSIS_FINDING_PATTERNS and the probe was misrouted to REPAIR_ANALYSIS
 * → the six-section forensic-report contract (FORENSIC_CONTRACT_GATE) and the
 * R-PROOF positive-proof gate (FINAL_ANSWER_GATE_FAILED / OBJECTIVE_BLOCKED),
 * which a legitimate negative verdict ("no eval() call exists") can never satisfy.
 *
 * This harness drives the REAL probe message (all seven sub-questions) through the
 * whole chat() pipeline with a mocked provider registry whose strategy returns a
 * grounded NEGATIVE answer. It asserts the run completes as a valid source-grounded
 * verdict — NOT a NOT PROVEN / OBJECTIVE_BLOCKED dead end — AND locks the C1–C7
 * capability guarantees against weak-model replays:
 *
 *   C1/C3 — the verdict quotes an exact fragment present in a read file's body.
 *   C2    — the evidence tool was read_file / read_file_range, never list_directory.
 *   C4    — only the two scoped files were read; nothing off-scope.
 *   C5    — no write/edit tool (write_file / replace_text) was ever executed.
 *   C6    — a negative behavioral verdict is accepted (never gated on a Finding).
 *   C7    — the answer never surfaces a fabricated symbol.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import { GroqClientError } from "../errors.js";
import {
  capabilityProbeRecoveryDeadline,
  runCapabilityMicroProbes,
  validateCapabilityProbeCitations,
} from "../agents/chat-agent.js";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { CAPABILITY_PROBE_MESSAGE } from "../prompts/capability-probe.js";

type EvidenceIntegrityStep = Extract<
  AgentStep,
  { kind: "evidence_integrity" }
>;

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | capability probe e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

const FILE_A = "lib/ai-orchestrator/src/prompts/profile-classifier.ts";
const FILE_B = "lib/ai-orchestrator/src/tools/file-tools.ts";

// Small real fixtures at the exact probe paths. Keep each well under the
// forensic read cap so the completed read is never truncated. NOTE: CONTENT_A
// deliberately does NOT define `run()` — that symbol is the anti-hallucination
// probe (C7): a weak model must not claim it exists.
const CONTENT_A = [
  "/* profile-classifier.ts */",
  "export function isPromptProsePath(value: string): boolean {",
  "  return value.includes('defect/repair');",
  "}",
].join("\n");

// CONTENT_B deliberately has NO `write_file` / immediate-write call and NO `run()`.
const CONTENT_B = [
  "/* file-tools.ts */",
  "export function executeFileTool(name: string): string {",
  "  return \"executed:\" + name;",
  "}",
].join("\n");

// The REAL probe body (all sub-questions). Single source of truth lives in
// prompts/capability-probe.ts (mirrors docs/ai-model-capability-probe-prompt.md);
// this test must consume that canonical constant so the probe text can't drift.
const PROBE_MESSAGE = CAPABILITY_PROBE_MESSAGE;

// A grounded negative answer that truthfully quotes CONTENT_A's real signature
// and rejects every fabricated symbol exactly as the probe demands.
const GROUNDED_NEGATIVE_ANSWER = JSON.stringify({
  response:
    "C1: PASS — `export function isPromptProsePath(value: string): boolean {` exists in " +
    "profile-classifier.ts and returns whether its input includes 'defect/repair'. " +
    "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`\n" +
    "C2: PASS — read_file for contents; search_code / read_file_range for a symbol. " +
    "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');` " +
    "Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`\n" +
    "C3: PASS — the named function was grounded in the completed source read. " +
    "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`\n" +
    "C4: PASS — `PROSE_PSEUDO_PATH_DENYLIST` is MISSING; no out-of-scope file was read. " +
    "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`\n" +
    "C5: PASS — I used no write tool; no code was modified. " +
    "Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`\n" +
    "C6: PASS — NO FINDING: profile-classifier.ts has no `eval(` or `Function(` call. " +
    "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`\n" +
    "C7: PASS — `run()` and immediate write_file-to-disk behavior are MISSING. " +
    "Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`\n" +
    "Overall score: 7/7.",
  sources: [FILE_A],
});

/** Mock provider + model-selection registry so chat() uses the fake strategy. */
async function mockChatProviders(fakeStrategy: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../errors.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../errors.js");
    return { ...actual, GroqClientError };
  });
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

async function makeProbeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-capability-probe-"));
  for (const [file, content] of [
    [FILE_A, CONTENT_A],
    [FILE_B, CONTENT_B],
  ] as const) {
    const full = path.join(rootPath, file);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return rootPath;
}

/** True when any evidence step ran a stateful WRITE tool (C5 violation). */
function executedWrites(steps: AgentStep[]): boolean {
  return steps.some(
    (s) =>
      (s.kind === "tool_call" || s.kind === "tool_result") &&
      (s.tool === "write_file" || s.tool === "replace_text"),
  );
}

describe("capability probe: C1–C7 are guarded end-to-end and the probe never dies on the report/R-PROOF gates", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("classifier routes the real capability probe to BEHAVIOR_QUERY (not REPAIR_ANALYSIS)", () => {
    const classification = classifyRequest(PROBE_MESSAGE);
    expect(classification.taskType).toBe("BEHAVIOR_QUERY");
    // Both named files remain the single-file forensic scope.
    expect(classification.singleFileForensicMode).toBe(true);
  });

  it("requires a separate exact citation for every capability claim and both source files", () => {
    const groundedResponse = JSON.parse(GROUNDED_NEGATIVE_ANSWER).response as string;
    const valid = validateCapabilityProbeCitations(
      groundedResponse,
      new Map([
        [FILE_A, CONTENT_A],
        [FILE_B, CONTENT_B],
      ]),
    );
    expect(valid.valid).toBe(true);
    expect(valid.citedSources).toEqual(expect.arrayContaining([FILE_A, FILE_B]));

    const withoutC7Citation = groundedResponse.replace(
      "Evidence: `return \"executed:\" + name;`\nOverall score",
      "Evidence: `run()`\nOverall score",
    );
    const rejected = validateCapabilityProbeCitations(
      withoutC7Citation,
      new Map([
        [FILE_A, CONTENT_A],
        [FILE_B, CONTENT_B],
      ]),
    );
    expect(rejected.valid).toBe(false);
    expect(rejected.violations.some((violation) => violation.startsWith("C7 "))).toBe(true);
  });

  it("stops near-deadline citation recovery before the final-output reserve", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const requestDeadline = 13_000;
      const recoveryWindow = capabilityProbeRecoveryDeadline(Date.now(), requestDeadline);
      expect(recoveryWindow.deadlineAt).toBe(5_000);
      expect(requestDeadline - recoveryWindow.deadlineAt).toBe(recoveryWindow.reserveMs);

      const strategy = {
        call: vi.fn(async () => new Promise<{ content: string; model: string }>(() => undefined)),
      };
      const recovery = runCapabilityMicroProbes({
        strategy,
        provider: "openrouter",
        model: "initial-model",
        fileContents: new Map([
          [FILE_A, CONTENT_A],
          [FILE_B, CONTENT_B],
        ]),
        pendingChanges: [],
        deadlineAt: requestDeadline,
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await expect(recovery).resolves.toBeNull();
      expect(strategy.call).toHaveBeenCalledTimes(1);
      expect(Date.now()).toBeLessThanOrEqual(
        requestDeadline - recoveryWindow.reserveMs,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("chat() completes the C1–C7 probe with a source-grounded verdict, read-only tools, scoped reads, and no fabrication", async () => {
    const rootPath = await makeProbeRoot();
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_NEGATIVE_ANSWER,
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    const diagnostics: string[] = [];
    const deltas: string[] = [];
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          void steps.push(step);
          if (step.kind === "diagnostic") diagnostics.push(step.code);
        },
        onDelta: (chunk) => deltas.push(chunk),
      });

      // ── Routing gates: the probe must NOT be rejected (regression guard) ──
      expect(diagnostics).not.toContain("FORENSIC_CONTRACT_GATE");
      expect(diagnostics).not.toContain("FINAL_ANSWER_GATE_FAILED");
      expect(diagnostics).not.toContain("OBJECTIVE_BLOCKED");

      // The negative behavioral verdict is accepted — C6 PASS, not a Finding-less block.
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.response).not.toMatch(/^NOT PROVEN/);
      expect(result.response).toMatch(/NO FINDING/i);
      expect(result.response).not.toMatch(/Executive Verdict|Evidence Map|Repair Plan|Final Judgment/i);
      expect(result.response).toMatch(/C1|C2|C4|C5|C6|C7/);
      // Capability Probe is buffered until its validator and citation gates
      // finish; it must not use the ordinary token-streaming path.
      expect(deltas).toEqual([]);

      // ── C1/C3: ground the verdict in an ACTUAL completed read ──────────────
      // The verdict quotes the exact signature fragment from the read file's body.
      expect(result.response).toContain(FILE_A);
      expect(result.response).toContain(
        "export function isPromptProsePath(value: string): boolean {",
      );

      // ── C4: read scope is EXACTLY the two named files (nothing off-scope) ──
      // The terminal forensic_status + evidence_integrity steps bound the read
      // set: exactly the two scoped implementation files, complete coverage.
      // ── C2: the only evidence instrument was the read tool. In this forensic
      // path there are no write/execute tool calls at all — assert the run
      // performed zero non-read tool invocations and reported 2 evidence reads.
      for (const s of steps) {
        if (s.kind === "tool_call" || s.kind === "tool_result") {
          expect(["read_file", "read_file_range"]).toContain(s.tool);
        }
      }
      const integrity = [...steps].reverse().find(
        (s): s is EvidenceIntegrityStep => s.kind === "evidence_integrity",
      );
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        // Exactly the two scoped files were read as evidence — no off-scope reads.
        expect(integrity.uniqueFilesRead).toBe(2);
        expect(integrity.evidenceFileCount).toBe(2);
      }

      // ── C5: no write/edit tool was ever executed ────────────────────────────
      expect(executedWrites(steps)).toBe(false);

      // ── C7: never surface a fabricated symbol ───────────────────────────────
      // run() is NOT defined in CONTENT_A/CONTENT_B. If the answer asserted it
      // exists (hallucination) this would fail.
      expect(result.response).not.toMatch(/`run\(\)` exists/i);
      expect(result.response).not.toMatch(/function run\(/i);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("recovers one valid probe response when the first answer omits an exact source excerpt", async () => {
    const rootPath = await makeProbeRoot();
    const firstAnswerWithoutEvidence = JSON.stringify({
      response:
        "C1: PASS — isPromptProsePath exists in profile-classifier.ts.\n" +
        "C2: PASS — read_file for contents; search_code for symbols.\n" +
        "C3: PASS — the named function was checked.\n" +
        "C4: PASS — PROSE_PSEUDO_PATH_DENYLIST is MISSING.\n" +
        "C5: PASS — no write tool was used.\n" +
        "C6: PASS — NO FINDING: no eval or Function call was found.\n" +
        "C7: PASS — run() and immediate write behavior are MISSING.\n" +
        "Overall score: 7/7.",
      sources: [FILE_A],
    });
    const recoveredGroundedAnswer = JSON.stringify({
      C1:
        "C1: PASS — `export function isPromptProsePath(value: string): boolean {` exists in " +
        "profile-classifier.ts and returns whether its input includes 'defect/repair'. " +
        "Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`",
      C2: "PASS — read_file for contents; search_code / read_file_range for a symbol. Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`",
      C3: "PASS — the named function was grounded in the completed source read. Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`",
      C4: "PASS — `PROSE_PSEUDO_PATH_DENYLIST` is MISSING; no out-of-scope file was read. Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`",
      C5: "PASS — I used no write tool; no code was modified. Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`",
      C6: "PASS — NO FINDING: profile-classifier.ts has no `eval(` or `Function(` call. Source: `lib/ai-orchestrator/src/prompts/profile-classifier.ts`; Evidence: `return value.includes('defect/repair');`",
      C7: "PASS — `run()` and immediate write_file-to-disk behavior are MISSING. Source: `lib/ai-orchestrator/src/tools/file-tools.ts`; Evidence: `return \"executed:\" + name;`",
      overall: "Overall score: 7/7.",
    });
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        callCount += 1;
        return {
          content:
            callCount === 1
              ? firstAnswerWithoutEvidence
              : recoveredGroundedAnswer,
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          steps.push(step);
        },
      });

      expect(callCount).toBe(2);
      expect(result.response).not.toMatch(/^NOT PROVEN/i);
      expect(result.response).toContain(FILE_A);
      expect(result.response).toContain(
        "export function isPromptProsePath(value: string): boolean {",
      );
      expect(result.response).not.toMatch(/Executive Verdict|Evidence Map|Repair Plan|Final Judgment/i);
      expect(steps.some((step) => step.kind === "tool_call" && step.tool === "write_file")).toBe(false);
      expect(steps.some((step) => step.kind === "tool_call" && step.tool === "replace_text")).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("recovers from a synthesis timeout using the retained two-file evidence", async () => {
    const rootPath = await makeProbeRoot();
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        callCount += 1;
        if (callCount === 1) {
          throw new GroqClientError("TIMEOUT", "simulated synthesis timeout");
        }
        return {
          content: GROUNDED_NEGATIVE_ANSWER,
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(callCount).toBe(2);
      expect(result.response).toContain("C1");
      expect(result.response).toContain("NO FINDING");
      expect(result.response).toContain(
        "export function isPromptProsePath(value: string): boolean {",
      );
      expect(steps.some(
        (step) =>
          step.kind === "diagnostic" &&
          step.code === "CAPABILITY_PROBE_EVIDENCE_RECOVERED",
      )).toBe(true);
      expect(steps.some(
        (step) => step.kind === "recovery_model_call" && step.attempt >= 1,
      )).toBe(true);
      expect(steps.some(
        (step) =>
          (step.kind === "tool_call" || step.kind === "tool_result") &&
          (step.tool === "write_file" || step.tool === "replace_text"),
      )).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails closed when the two-file read boundary is incomplete", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-capability-probe-partial-"));
    const fullPath = path.join(rootPath, FILE_A);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, CONTENT_A, "utf8");
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        callCount += 1;
        return {
          content: GROUNDED_NEGATIVE_ANSWER,
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      expect(callCount).toBe(1);
      expect(result.response).toMatch(/^ANALYSIS_INCOMPLETE/i);
      expect(steps.some(
        (step) =>
          step.kind === "diagnostic" &&
          step.code === "CAPABILITY_PROBE_RECOVERY_SKIPPED_INCOMPLETE",
      )).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps an exhausted correction path claim-unclosed instead of promoting an inventory", async () => {
    const rootPath = await makeProbeRoot();
    const ungroundedAnswer = JSON.stringify({
      response:
        "C1: PASS — isPromptProsePath exists.\n" +
        "C2: PASS — read_file was used.\n" +
        "C3: PASS — the function was checked.\n" +
        "C4: PASS — PROSE_PSEUDO_PATH_DENYLIST is absent.\n" +
        "C5: PASS — no write was used.\n" +
        "C6: PASS — no eval or Function call was found.\n" +
        "C7: PASS — run() is absent.\n" +
        "Overall score: 7/7.",
      sources: [FILE_A, FILE_B],
    });
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: ungroundedAnswer,
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      // One correction plus the bounded group probes (including their
      // requirement retries) is still finite and provider-fallback-free.
      expect(fakeStrategy.call.mock.calls.length).toBeLessThanOrEqual(7);
      expect(result.response).toMatch(/^ANALYSIS_INCOMPLETE/i);
      expect(steps.some(
        (step) =>
          step.kind === "diagnostic" &&
          step.code === "CAPABILITY_PROBE_CLAIM_UNCLOSED",
      )).toBe(true);
      expect(steps.some(
        (step) =>
          (step.kind === "tool_call" || step.kind === "tool_result") &&
          (step.tool === "write_file" || step.tool === "replace_text"),
      )).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not start capability recovery after cancellation", async () => {
    const rootPath = await makeProbeRoot();
    const controller = new AbortController();
    controller.abort();
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: PROBE_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        signal: controller.signal,
      });

      expect(fakeStrategy.call).not.toHaveBeenCalled();
      expect(result.response).toMatch(/^ANALYSIS_INCOMPLETE/i);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
