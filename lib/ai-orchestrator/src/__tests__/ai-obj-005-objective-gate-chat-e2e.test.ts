/**
 * Task #63 (AI-OBJ-005) — the Objective Completion Gate blocks a final answer
 * end to end through chat() when the declared objective is not completed.
 *
 * Task #60 area separation notwithstanding, this is the P0 objective gate
 * acceptance: calling chat() with an `objective` that declares a required claim
 * and a required reachability edge MUST refuse to emit a completed final answer.
 *
 *   1. wraps buildRuntimeLedger (like ei-045) to read the final ledger.
 *   2. supplies an objective whose required edge endpoints are NOT present in
 *      the runtime-observed+evidence production trace — so it stays unproven.
 *   3. asserts the returned response reads BLOCKED (not the model's report),
 *      verificationRejectionReasons carries the objective reason, and the
 *      decision_trace finalState is NOT a passed verdict.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { RunLedger } from "../evidence-integrity.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | objective-gate e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

// A plain `.ts` path outside any fixture/test/spec/generated directory:
// classifySourceScope treats this as PRODUCTION (a real read happens).
const FILE = "src/executor.ts";
const FILE_CONTENT = [
  "export function run(input: string): string {",
  "  return eval(input);",
  "}",
].join("\n");

/** Single-file forensic classifier trigger, mirroring forensic-single-file-isolation. */
const FORENSIC_SINGLE_MESSAGE = (target: string) =>
  [
    "اختبر قدرة التحليل الجنائي لملف واحد فقط — ملف إنتاجي:",
    target,
    "ابحث عن استخدام غير آمن للدالة eval وأثبت وجود العيب.",
  ].join("\n");

/** A FINDING_PROVEN forensic report citing ONLY the production evidence path. */
const KNOWN_DEFECT_REPORT = (file: string) =>
  [
    "## 1) Executive Verdict",
    "An unsafe eval() usage was proven in production source.",
    "## 2) Evidence Map",
    `File: \`${file}\``,
    "Role: implementation source",
    "Evidence: `return eval(input)`",
    "Risk: HIGH",
    "Notes: FACT",
    "## 3) Findings",
    "* ID: F-01 · unsafe eval() over untrusted input",
    `* File(s): \`${file}\``,
    "* Evidence: `return eval(input);`",
    "* Why it matters: Untrusted input reaches eval.",
    "* Root cause: eval() used on a runtime value",
    "* Fix: Replace eval with safe parsing.",
    "## 4) Repair Plan",
    `Phase 1 (F-01): replace eval() with a safe parser in ${file} — File(s): \`${file}\` — Validation profile: knowledge-engine-tests — PROPOSED: files are not applied and behavioral validation is pending.`,
    "## 5) Validation Checklist",
    "- Add test: eval payloads are rejected",
    "## 6) Final Judgment",
    "PROVEN — a verified defect was found; see Repair Plan.",
  ].join("\n");

/**
 * Mock provider + model-selection registry so chat() uses the fake strategy,
 * AND wrap buildRuntimeLedger to capture every ledger a run produces.
 */
async function mockChatProviders(
  fakeStrategy: unknown,
  capturedLedgers: RunLedger[],
): Promise<void> {
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
  vi.doMock("../evidence-integrity.js", async () => {
    const actual = await vi.importActual<typeof import("../evidence-integrity.js")>(
      "../evidence-integrity.js",
    );
    return {
      ...actual,
      buildRuntimeLedger: (input: Parameters<typeof actual.buildRuntimeLedger>[0]) => {
        const ledger = actual.buildRuntimeLedger(input);
        capturedLedgers.push(ledger);
        return ledger;
      },
    };
  });
}

describe("chat() blocks a final answer when the declared objective is uncompleted (task #63)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("returns BLOCKED (not the report), with an objective reason, when a required edge is unproven", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-aiobj05-chat-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    // Declare an objective whose only required evidence edge is NOT present
    // among the runtime-observed+evidence links — so it stays unproven and the
    // gate refuses to finalize, even though the model returns a full PROVEN
    // report and a production read happened.
    const objective: ObjectiveContract = {
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: [
        { claimId: "unsafe-control-flow", text: "untrusted input reaches eval()" },
      ],
      requiredEvidenceEdges: [
        { from: "executor:run", to: "http:handler", relationship: "invokes" },
      ],
    };

    const report = KNOWN_DEFECT_REPORT(FILE);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [FILE] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    const capturedLedgers: RunLedger[] = [];
    await mockChatProviders(fakeStrategy, capturedLedgers);

    const forensicStatuses: Array<Record<string, unknown>> = [];
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: FORENSIC_SINGLE_MESSAGE(FILE),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective,
        onStep: (step) => {
          steps.push(step);
          if (step.kind === "forensic_status") {
            forensicStatuses.push({
              findingStatus: step.findingStatus,
              repairReadiness: step.repairReadiness,
              repairBlockReason: step.repairBlockReason,
            });
          }
        },
      });

      // 0. The objective round-trips onto the typed output.
      expect(result.objective?.objectiveType).toBe("PRODUCTION_REACHABILITY");

      // 1. The final response is BLOCKED — the model's PROVEN report is NOT
      //    surfaced as a completed answer. (English or Arabic form, both reject.)
      expect(result.response).toMatch(/BLOCKED|محظور/);
      expect(result.response).not.toContain("ID: F-01");
      expect(result.response).not.toMatch(/\bPROVEN\b/);
      expect(result.response).not.toContain("unsafe eval() over untrusted input");

      // 2. The returned decision trace is gated: NOT_PROVEN (rejection), not a
      //    passed verdict. And an OBJECTIVE_BLOCKED diagnostic step was relayed.
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(dt?.kind).toBe("decision_trace");
      if (dt?.kind === "decision_trace") {
        expect(dt.trace.finalState).toBe("NOT_PROVEN");
        expect(
          (dt.trace.rejectionReason ?? []).some((r: string) => r.startsWith("objective:")),
        ).toBe(true);
      }
      const blockedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBe(true);

      // 3. The runtime loop still did the production read (evidence collected),
      //    but the gate blocked because the objective's edge is unproven.
      expect(capturedLedgers.length).toBeGreaterThan(0);
      const finalLedger = capturedLedgers.at(-1)!;
      expect(finalLedger.uniqueFilesRead).toBeGreaterThan(0);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns the report (PROVEN, not BLOCKED) when the objective's required claim is grounded in a retained read", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-aiobj05-proven-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    // Declare a genuinely-completable objective: the required claim's assertion
    // ("return eval(input)") appears verbatim in the retained source read, so the
    // grounded required-claim closure CLOSES it. No required edge is declared, so
    // nothing keeps the gate blocked — it must reach PROVEN and return the report.
    const objective: ObjectiveContract = {
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: [
        { claimId: "unsafe-eval-present", text: "return eval(input)" },
      ],
      requiredEvidenceEdges: [],
    };

    const report = KNOWN_DEFECT_REPORT(FILE);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [FILE] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    const capturedLedgers: RunLedger[] = [];
    await mockChatProviders(fakeStrategy, capturedLedgers);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: FORENSIC_SINGLE_MESSAGE(FILE),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective,
        onStep: (step) => {
          steps.push(step);
        },
      });

      // 0. The objective round-trips onto the typed output.
      expect(result.objective?.objectiveType).toBe("PRODUCTION_REACHABILITY");

      // 1. The gate did NOT block: the report surfaces as the final answer, and
      //    there is no BLOCKED message.
      expect(result.response).not.toMatch(/BLOCKED|محظور/);
      expect(result.response).toContain("ID: F-01");

      // 2. No OBJECTIVE_BLOCKED diagnostic was relayed.
      const blockedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBe(false);

      // 3. The runtime loop still collected the production read.
      expect(capturedLedgers.length).toBeGreaterThan(0);
      const finalLedger = capturedLedgers.at(-1)!;
      expect(finalLedger.uniqueFilesRead).toBeGreaterThan(0);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps a required claim UNCLOSED (BLOCKED) when the retained read contains the claim text but the answer does not assert it (response-bound closure)", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-aiobj05-responsebound-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    // The claim's assertion ("return eval(input)") appears verbatim in the
    // retained source read — BUT the model answers with a "no defect" report
    // that never asserts that claim. Response-bound closure must refuse to
    // close the claim from the read alone, so the gate stays blocked.
    const objective: ObjectiveContract = {
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: [
        { claimId: "unsafe-eval-present", text: "return eval(input)" },
      ],
      requiredEvidenceEdges: [],
    };

    const report = [
      "## Verdict",
      "No unsafe usage found.",
      "The submitted file looks safe. No defect to report.",
    ].join("\n");
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [FILE] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    const capturedLedgers: RunLedger[] = [];
    await mockChatProviders(fakeStrategy, capturedLedgers);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: FORENSIC_SINGLE_MESSAGE(FILE),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective,
        onStep: (step) => {
          steps.push(step);
        },
      });

      // The claim text lives in the read, but the answer never asserts it —
      // so response-bound closure leaves it UNCLOSED and the gate blocks.
      expect(result.response).toMatch(/BLOCKED|محظور/);
      expect(result.response).not.toContain("ID: F-01");
      const blockedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
