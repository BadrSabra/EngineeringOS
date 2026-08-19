/**
 * Task #41 — prove the known-defect scenario resolves to a scoped verdict
 * through the WHOLE chat() pipeline.
 *
 * The plan's acceptance target (EI-041…EI-044): an audit over a fixture-only
 * known-defect.ts eval() must end at:
 *
 *   Finding   = FIXTURE_PROVEN   (evidence is fixture-scoped)
 *   Production= NOT_PROVEN        (no production-source window)
 *   Repair    = BLOCKED           (scopedRepairGate rejects a local proof)
 *   Telemetry = CONSISTENT        (the run reconciles, not gated by telemetry)
 *
 * The scoped models are unit-tested in isolation; this file exercises the real
 * chat() pipeline (eager single-file prefetch of the fixture + mocked provider
 * registry) and asserts the final runtime ledger carries the exact scoped
 * outcome:
 *
 *   1. wraps buildRuntimeLedger (like ei-017) so we can read the FINAL ledger's
 *      scopedFindingStatus / verdictScope — the contract's canonical output.
 *   2. asserts verdictScope === FIXTURE_LOCAL and scopedFindingStatus ===
 *      FIXTURE_PROVEN, and that NO captured ledger ever asserts PRODUCTION_PROVEN
 *      (EI-031 scope-escalation guard: fixtures can never prove production).
 *   3. asserts the live forensic_status step carries repairReadiness BLOCKED
 *      with repairBlockReason REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION, and that
 *      telemetry stayed CONSISTENT.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { RunLedger } from "../evidence-integrity.js";
import {
  assertArabicFixtureResponse,
  takeFixture,
} from "./fixture-guards.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | scoped-verdict e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

// A fixture-only path: classifySourceScope matches `fixtures?` first, so this
// evidence body is FIXTURE-scoped (never PRODUCTION).
const FILE = "src/__tests__/fixtures/known-defect.ts";
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

/** A FINDING_PROVEN forensic report citing ONLY the fixture evidence path. */
const KNOWN_DEFECT_REPORT = (file: string) =>
  [
    "تم التحقق من وجود العيب، لكن الدليل محلي ضمن ملف الاختبار فقط.",
    "## 1) Executive Verdict",
    "An unsafe eval() usage was proven, but the evidence is fixture-local only.",
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
  // Capture every runtimeLedger so we can read the canonical scoped verdict.
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

describe(
  "FIXTURE — chat() resolves a fixture-only known-defect to a scoped verdict (task #41)",
  () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("ends at FIXTURE_PROVEN / FIXTURE_LOCAL, blocks repair, and never escalates to PRODUCTION_PROVEN", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ei041-chat-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    const report = KNOWN_DEFECT_REPORT(FILE);
    assertArabicFixtureResponse(report, "ei-041-scoped-verdict-arabic-report");
    const providerResponses = [{
      content: JSON.stringify({ response: report, sources: [FILE] }),
      toolCalls: [],
      model: "initial-model",
      usage: {},
    }];
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async () => takeFixture(providerResponses, "ei-041-scoped-verdict-provider-turn")),
      stream: vi.fn(),
    };

    const capturedLedgers: RunLedger[] = [];
    await mockChatProviders(fakeStrategy, capturedLedgers);

    const forensicStatuses: Array<Record<string, unknown>> = [];
    let steps: AgentStep[] = [];
    let ok = false;
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

      // 0. The pipeline actually produced a finding verdict (the classifier
      //    routes this single-file request to FINDING_ANALYSIS, not a full
      //    forensic report — irrelevant to the scoped-verdict target).
      expect(result.response).toContain("ID: F-01");

      // 1. At least one runtime ledger was produced and it resolved to the
      //    canonical scoped outcome through deriveScopedFindingStatus over the
      //    fixture evidence body.
      expect(capturedLedgers.length).toBeGreaterThan(0);
      const finalLedger = capturedLedgers.at(-1)!;
      expect(finalLedger.verdictScope).toBe("FIXTURE_LOCAL");
      expect(finalLedger.scopedFindingStatus).toBe("FIXTURE_PROVEN");

      // 2. EI-031 scope escalation guard: across EVERY ledger produced by this
      //    run, no fixture-only evidence may ever yield PRODUCTION_PROVEN.
      for (const ledger of capturedLedgers) {
        expect(ledger.scopedFindingStatus).not.toBe("PRODUCTION_PROVEN");
        expect(ledger.verdictScope).not.toBe("PRODUCTION");
      }

      // 3. The live forensic_status step surfaced a BLOCKED repair with the
      //    scope-gate reason (not telemetry — telemetry stayed CONSISTENT).
      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses[0]?.findingStatus).toBe("PROVEN");
      expect(forensicStatuses[0]?.repairReadiness).toBe("BLOCKED");
      expect(forensicStatuses[0]?.repairBlockReason).toBe(
        "REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION",
      );

      // 4. Telemetry reconciled — the run was NOT gated as inconsistent. The
      //    acceptance target requires Telemetry = CONSISTENT.
      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.consistent).toBe(true);
      }

      // 5. The decision was verified (not rejected by parse/behavior/telemetry).
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(dt?.kind).toBe("decision_trace");
      if (dt?.kind === "decision_trace") {
        expect(dt.trace.finalState).toBe("VERIFIED");
        expect(dt.trace.rejectionReason ?? []).toHaveLength(0);
      }

      // 6. Task #46: the verdict's proof scope is persisted on the decision_trace
      //    step from the FINAL runtime ledger, so a later audit and the execution
      //    handoff can reconcile against the SAME scope instead of recomputing a
      //    fresh default. The persisted trace must mirror the final ledger exactly.
      const latestDt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(latestDt?.kind).toBe("decision_trace");
      if (latestDt?.kind === "decision_trace") {
        expect(latestDt.trace.verdictScope).toBe(finalLedger.verdictScope);
        expect(latestDt.trace.scopedFindingStatus).toBe(finalLedger.scopedFindingStatus);
        expect(latestDt.trace.verdictScope).toBe("FIXTURE_LOCAL");
        expect(latestDt.trace.scopedFindingStatus).toBe("FIXTURE_PROVEN");
      }
      ok = true;
    } finally {
      if (!ok) {
        // Keep captured ledger details visible on failure for debugging.
      }
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
  },
);
