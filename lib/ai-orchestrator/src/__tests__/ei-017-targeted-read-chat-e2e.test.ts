/**
 * Task #36 — Confirm targeted evidence actually reaches the run ledger on the
 * next recovery attempt.
 *
 * Task #34 wired `planEvidenceRecovery` + `executeFileTool("read_file_range")`
 * + `tagRecoveredEvidence` into the per-packet recovery loop, but nothing
 * exercised the WHOLE chat() pipeline. This file drives `chat()` end to end with
 * a mocked provider registry:
 *
 *   1. The main tool loop performs a real `read_file` of `src/loop.ts`, so its
 *      body becomes retained forensic evidence (forensicFileContents).
 *   2. The main synthesis is a broad/unsupported forensic report → the contract
 *      fails → `needsForensicRecovery` is true → the recovery loop runs.
 *   3. The recovery provider returns a FINDING_PROVEN structured envelope whose
 *      evidence claim is unverifiable (empty Repair Plan → contract violation),
 *      so `validateStructuredForensicRecovery` rejects it while findings remain
 *      non-empty → the EI-017 targeted-read block fires `read_file_range`.
 *   4. Step 3 runs on both recovery attempts (each gets a fresh
 *      `recoveryAttemptId`), proving the recovered evidence paths accumulate.
 *
 * Assertions:
 *   - `executeFileTool("read_file_range", …)` is called (spy wrapper that still
 *     delegates to the real tool reader).
 *   - `onStep` receives a `FORENSIC_TARGETED_READ_ISSUED` diagnostic carrying a
 *     `recoveryAttemptId: REC-…` in its details.
 *   - The captured `runtimeLedger.evidenceRecords` contains at least one record
 *     with `readType === "TARGETED"` and a `recoveryAttemptId` (EI-018), and the
 *     ledger's `targetedReads` counter > 0.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { RunLedger } from "../evidence-integrity.js";
import type { RawGroqResponse } from "../groq-client.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | ei-017 targeted read e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

const FILE = "src/loop.ts";
const FILE_CONTENT = [
  "export function verifiedRead() {",
  "  return true;",
  "}",
  "export function run() {",
  "  return verifiedRead();",
  "}",
].join("\n");

function rawResponse(
  content: string,
  toolCalls?: RawGroqResponse["toolCalls"],
  model = "initial-model",
): RawGroqResponse {
  return {
    content,
    toolCalls: toolCalls ?? null,
    model,
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

/**
 * A FINDING_PROVEN structured envelope whose evidence claim cannot be verified:
 * `repairPlan: []` violates the "FINDING_PROVEN requires at least one linked
 * Repair Plan phase" contract, so `validateStructuredForensicRecovery` returns
 * `accepted: false` while the envelope still carries a non-empty findings array.
 * That is the exact gate that routes the loop into the EI-017 targeted-read block.
 */
function rejectedFindingEnvelope(): string {
  return JSON.stringify({
    verdict: "FINDING_PROVEN",
    findings: [
      {
        id: "F-01",
        title: "verifiedRead returns an unproven behavior",
        files: [FILE],
        evidence: "`verifiedRead` returns without an exact verifiable defect fragment",
        whyItMatters: "The model asserted a defect that the completed read does not support.",
        rootCause: "unverified claim",
        fix: "Replace the candidate with a source-exact finding or emit NO_FINDING.",
      },
    ],
    repairPlan: [],
    validationChecklist: [],
  });
}

/**
 * Provider strategy whose call() drives the full sequence:
 *   call 1 (tools): real read_file of src/loop.ts → retained evidence
 *   call 2 (tools): structurally broken forensic synthesis → contract failure →
 *                   needsForensicRecovery
 *   call 3 (no tools, model "recovery-model"): rejected FINDING_PROVEN recovery
 *                   envelope → first targeted read_file_range → recovered
 *                   evidence is accumulated for the run ledger
 *   call 4 (no tools, model "final-model"): the SAME rejected envelope, but by
 *                   this point the recovered evidence from attempt 1 has been
 *                   fed back into the recovery messages → the test asserts the
 *                   second recovery call actually receives that excerpt.
 *
 * Each call records the serialized messages it was handed so the test can prove
 * the recovered targeted evidence reached the NEXT model call.
 */
interface StrategyRecord {
  count: number;
  /** Raw messages each provider call received, keyed by 1-based call number. */
  messagesByCall: Record<number, unknown[]>;
}
function fakeStrategy(rec: StrategyRecord) {
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    ownsModelFallback: true,
    call: vi.fn(async (messages: unknown[]) => {
      rec.count += 1;
      rec.messagesByCall[rec.count] = messages;
      if (rec.count === 1) {
        return rawResponse("", [
          {
            id: "read-loop",
            type: "function" as const,
            function: { name: "read_file", arguments: JSON.stringify({ path: FILE }) },
          },
        ]);
      }
      if (rec.count === 2) {
        // A structurally broken report the deterministic repair-from-evidence
        // pass cannot fix (a duplicated Evidence Map heading). This is the same
        // unrepairable contract failure the chat-agent.test.ts recovery test
        // uses to force `needsForensicRecovery = true`.
        return rawResponse(
          JSON.stringify({
            response: [
              "## 1) Executive Verdict",
              "NOT PROVEN — the available evidence is insufficient.",
              "## 2) Evidence Map",
              "File: `src/loop.ts`",
              "Role: implementation source",
              "Evidence: `verifiedRead`",
              "Risk: NOT PROVEN",
              "Notes: FACT",
              "## 2) Evidence Map",
              "## 3) Findings",
              "No verified finding identified from inspected source code.",
              "## 4) Repair Plan",
              "No repair phases identified.",
              "## 5) Validation Checklist",
              "No validation scenario available.",
              "## 6) Final Judgment",
              "NOT PROVEN — insufficient evidence.",
            ].join("\n"),
            sources: [FILE],
          }),
        );
      }
      // Recovery attempts. Return models that sit in the mocked fallback chain
      // so the loop can advance to a real second attempt (recovery-model →
      // final-model). Each attempt returns the same rejected FINDING_PROVEN
      // envelope, so it triggers a targeted read on its own attempt.
      return rawResponse(
        rejectedFindingEnvelope(),
        null,
        rec.count === 3 ? "recovery-model" : "final-model",
      );
    }),
    stream: vi.fn(),
  };
}

interface MockChatProviders {
  rangeReads: Array<{ path: string; startLine: string; endLine: string }>;
  capturedLedgers: RunLedger[];
  messagesByCall: Record<number, unknown[]>;
}
/** Concatenate the user-message contents out of raw provider messages. */
function userContent(messages: unknown[] | undefined): string {
  return (messages ?? [])
    .filter((m): m is { role: string; content: string } => {
      const mm = m as { role?: string; content?: string };
      return mm?.role === "user" && typeof mm.content === "string";
    })
    .map((m) => m.content)
    .join("\n");
}

async function mockChatProviders(rec: StrategyRecord): Promise<MockChatProviders> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  // Spy wrapper: record read_file_range invocations but delegate to the real
  // tool reader so the real on-disk file still yields a content window.
  const rangeReads: Array<{ path: string; startLine: string; endLine: string }> = [];
  vi.doMock("../tools/file-tools.js", async () => {
    const actual = await vi.importActual<typeof import("../tools/file-tools.js")>(
      "../tools/file-tools.js",
    );
    return {
      ...actual,
      executeFileTool: async (
        name: string,
        arg: { path: string; startLine?: string; endLine?: string },
        root: string,
        opts: unknown,
      ) => {
        if (name === "read_file_range") {
          rangeReads.push({
            path: arg.path,
            startLine: String(arg.startLine),
            endLine: String(arg.endLine),
          });
        }
        return actual.executeFileTool(name as never, arg as never, root, opts as never);
      },
    };
  });
  // Capture every runtimeLedger produced by chat() so the test can assert on
  // the EI-018 targeted records.
  const capturedLedgers: RunLedger[] = [];
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
  const fake = fakeStrategy(rec);
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fake) };
  });
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => Promise.resolve(null)),
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
      fallbackChain: ["initial-model", "recovery-model", "final-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [
      { id: "recovery-model" },
      { id: "final-model" },
    ]),
  }));
  return { rangeReads, capturedLedgers, messagesByCall: rec.messagesByCall };
}

const MESSAGE = [
  "You are a forensic auditor. Perform a structured forensic audit and return exactly these sections.",
  "## 1) Executive Verdict",
  "## 2) Evidence Map",
  "## 3) Findings",
  "## 4) Repair Plan",
  "## 5) Validation Checklist",
  "## 6) Final Judgment",
].join("\n");

describe("chat() issues a targeted read that lands in the run ledger on recovery (task #36)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("issues FORENSIC_TARGETED_READ_ISSUED and records TARGETED evidence with a recoveryAttemptId", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ei017-chat-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(path.join(rootPath, FILE), FILE_CONTENT, "utf8");

    const rec: StrategyRecord = { count: 0, messagesByCall: {} };
    let steps: AgentStep[] = [];
    let ok = false;
    try {
      const { rangeReads, capturedLedgers } = await mockChatProviders(rec);
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      // The mock provider was actually driven past the main loop into recovery:
      // call 1 = read_file, call 2 = synthesis, call 3 + = rejected FINDING_PROVEN
      // recovery attempts.
      expect(rec.count).toBeGreaterThanOrEqual(3);
      const recoveryCalls = Object.keys(rec.messagesByCall)
        .map(Number)
        .filter((n) => n >= 3)
        .sort((a, b) => a - b);

      // 0. The recovered evidence from the first rejected attempt must actually
      //    reach the NEXT recovery attempt's model messages — otherwise nothing
      //    "reaches the model" (task #36's core requirement).
      expect(recoveryCalls.length).toBeGreaterThanOrEqual(2);
      const secondUserContent = userContent(rec.messagesByCall[recoveryCalls[recoveryCalls.length - 1]!]);
      expect(secondUserContent).toContain("RECOVERED TARGETED EVIDENCE");
      expect(secondUserContent).toContain("verifiedRead");
      expect(secondUserContent).toMatch(/recoveryAttemptId: REC-\d+/);

      // The FIRST recovery attempt must NOT yet have recovered evidence (so the
      // second-attempt assertion above is not trivially satisfied by the excerpt
      // appearing in both).
      const firstUserContent = userContent(rec.messagesByCall[recoveryCalls[0]!]);
      expect(firstUserContent).not.toContain("RECOVERED TARGETED EVIDENCE");
      // ...and the correction prompt (task #37) must also carry the new material
      // so the model can self-correct against the actual source window. The
      // prompt-level block is strict "New targeted evidence available" wording
      // plus the file + line range + symbol.
      expect(firstUserContent).not.toContain("New targeted evidence available");

      // 1a. The NEXT attempt's correction prompt (task #37) surfaces the
      //     recovered excerpt alongside the file, line range, and symbol so the
      //     model can self-correct against the actual re-read window.
      expect(secondUserContent).toContain("New targeted evidence available");
      // The prompt cites the re-read window: file, line range, and symbol, so
      // the model can self-correct against the actual source region.
      expect(secondUserContent).toContain("src/loop.ts (lines 1");
      expect(secondUserContent).toContain('symbol "verifiedRead"');
      // It also quotes a fragment of the recovered content (not just metadata).
      expect(secondUserContent).toContain("export function verifiedRead()");

      // 1. executeFileTool("read_file_range", …) fired — the EI-017 targeted read.
      expect(rangeReads.length).toBeGreaterThan(0);
      expect(rangeReads[0]!.path).toBe(FILE);
      expect(Number(rangeReads[0]!.startLine)).toBeGreaterThan(0);
      expect(Number(rangeReads[0]!.endLine)).toBeGreaterThan(Number(rangeReads[0]!.startLine));

      // 2. onStep emitted FORENSIC_TARGETED_READ_ISSUED with a recoveryAttemptId.
      const targetedDiagnostics: Array<{ code: string; details: string[] }> = [];
      for (const step of steps) {
        if (step.kind === "diagnostic" && step.code === "FORENSIC_TARGETED_READ_ISSUED") {
          targetedDiagnostics.push({ code: step.code, details: step.details ?? [] });
        }
      }
      expect(targetedDiagnostics.length).toBeGreaterThan(0);
      const details = targetedDiagnostics[0]!.details;
      expect(details.join("\n")).toMatch(/recoveryAttemptId: REC-\d+/);
      // The read is scoped to the finding's file and symbol.
      expect(details.join("\n")).toContain("verifiedRead");
      expect(details.join("\n")).toContain(FILE);

      // 3. A targeted read was issued per recovery attempt that hit the block.
      expect(capturedLedgers.length).toBeGreaterThan(0);
      const withTargeted = capturedLedgers.filter(
        (ledger: RunLedger) => ledger.evidenceRecords.some((r) => r.readType === "TARGETED"),
      );
      expect(withTargeted.length).toBeGreaterThan(0);

      // 4. The EI-018 ledger record: readType TARGETED + recoveryAttemptId + runId.
      const ledger = withTargeted.at(-1)!;
      const targetedRecords = ledger.evidenceRecords.filter(
        (r) => r.readType === "TARGETED",
      );
      expect(targetedRecords.length).toBeGreaterThan(0);
      for (const record of targetedRecords) {
        expect(record.recoveryAttemptId).toMatch(/^REC-/);
        expect(record.runId).toMatch(/^run-/);
        expect(record.file).toBe(FILE);
        expect(record.symbol).toBe("verifiedRead");
        expect(record.sourceSpan).toBeDefined();
        expect(record.sourceSpan!.startLine).toBeGreaterThan(0);
      }
      // The recovered evidence contributed to the run's targeted-read telemetry.
      expect(ledger.targetedReads).toBe(targetedRecords.length);
      expect(ledger.recoveryAttempts).toBeGreaterThan(0);

      // 5. Recovery genuinely ran and was gated (a valid script never claims a
      //    defunct "VERDICT: PROVEN" from the rejected envelope).
      const dt = [...steps].reverse().find((s) => s.kind === "decision_trace");
      if (dt?.kind === "decision_trace") {
        expect(dt.trace.recoveryAttempt).toBeGreaterThan(0);
      }
      expect(result.response).not.toMatch(/VERDICT:\s*PROVEN/i);
      ok = true;
    } finally {
      if (!ok) {
        // Keep chat logs visible on failure for debugging; otherwise clean up.
      }
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
