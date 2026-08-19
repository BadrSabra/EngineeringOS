/**
 * Task #45 — prove the ALLOWED branch of the Repair Scope Gate end to end.
 *
 * Task #41 asserted the fixture side (FIXTURE_PROVEN / FIXTURE_LOCAL, repair
 * BLOCKED). This file asserts the positive branch is reachable through chat():
 * a finding cited ONLY against a real production source path must classify that
 * evidence as PRODUCTION scope, resolve the scoped verdict to PRODUCTION_PROVEN,
 * and lift the scope block so repair is READY with NO repairBlockReason.
 *
 * Without this, a regression could cap every run at BLOCKED even for genuine
 * production evidence (acceptance: the gate's `allowed: true` branch exists and
 * is reachable end to end).
 *
 *   1. wraps buildRuntimeLedger (like ei-041) to read the final ledger.
 *   2. asserts verdictScope === "PRODUCTION" and scopedFindingStatus ===
 *      "PRODUCTION_PROVEN".
 *   3. asserts the live forensic_status step carries repairReadiness READY and
 *      NO repairBlockReason, and that telemetry stayed CONSISTENT.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { RunLedger } from "../evidence-integrity.js";
import { realToolFixturesEnabled, takeFixture } from "./fixture-guards.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | production-verdict e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

// A plain `.ts` path outside any fixture/test/spec/generated directory:
// classifySourceScope treats this as PRODUCTION (the strongest proof scope).
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

describe.skipIf(!realToolFixturesEnabled())(
  "REAL TOOL — chat() resolves a production-source known-defect to PRODUCTION_PROVEN and unblocks repair (task #45)",
  () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("ends at PRODUCTION_PROVEN / PRODUCTION, is repair READY, and carries NO repairBlockReason", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ei045-chat-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    const report = KNOWN_DEFECT_REPORT(FILE);
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
      call: vi.fn(async () => takeFixture(providerResponses, "ei-045-production-verdict-provider-turn")),
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

      // 0. The pipeline actually produced a finding verdict.
      expect(result.response).toContain("ID: F-01");

      // 1. The final runtime ledger resolved the production evidence to the
      //    strongest scoped verdict via deriveScopedFindingStatus.
      expect(capturedLedgers.length).toBeGreaterThan(0);
      const finalLedger = capturedLedgers.at(-1)!;
      expect(finalLedger.verdictScope).toBe("PRODUCTION");
      expect(finalLedger.scopedFindingStatus).toBe("PRODUCTION_PROVEN");

      // 2. The live forensic_status step lifted the scope block: repair READY
      //    and NO repairBlockReason — the gate's `allowed: true` branch is
      //    reachable end to end (unlike task #41's BLOCKED fixture-side).
      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses[0]?.findingStatus).toBe("PROVEN");
      expect(forensicStatuses[0]?.repairReadiness).toBe("READY");
      expect(forensicStatuses[0]?.repairBlockReason).toBeUndefined();

      // 3. Telemetry reconciled — the run was NOT gated as inconsistent.
      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.consistent).toBe(true);
      }

      // 4. The decision was verified (not rejected by parse/behavior/telemetry).
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      expect(dt?.kind).toBe("decision_trace");
      if (dt?.kind === "decision_trace") {
        expect(dt.trace.finalState).toBe("VERIFIED");
        expect(dt.trace.rejectionReason ?? []).toHaveLength(0);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
  },
);
