/**
 * Task #65 (AI-OBJ-014) — Runtime regression benchmark: production reachability
 * of `computeCentrality` must be PROVEN or REFUTED end to end through chat(),
 * never merely explained.
 *
 * The scenario mirrors the real production layout referenced by the plan:
 * `getGraphCentrality()`@graph-extractor (the caller) → direct invocation →
 * `computeCentrality()`@inference (the target). The declared objective's
 * required edges and required claim follow that exact chain.
 *
 * Review-fix coverage:
 *   1. OBJECTIVE_MISMATCH / RECOVERY_SCOPE_FAILURE are derived from REAL run
 *      signals (accepted behavior evidence / recovery reads escaping the bounded
 *      scope) and asserted at the chat() level — not injected only into unit
 *      tests. A behavioral-only answer or an over-broad recovery read can never
 *      surface as a completed production-reachability result.
 *   2. The PROVEN + BLOCKED benchmarks inspect the POST-attachment objective
 *      telemetry (attachObjectiveTelemetry → telemetryLedger) and its
 *      validateTelemetry reconciliation — asserted objective fields + fail-closed.
 *   3. The PROVEN edge closes only through the intended runtime-observation path:
 *      a retained production read of the CALLER (graph-extractor) whose body
 *      directly invokes computeCentrality. No pre-fabricated productionTraceLinks
 *      are injected; static lexical matches are never labeled runtimeObserved.
 *
 * Mocks the provider/model registry (like feg-018) so no live API is needed;
 * the tmpdir is real so reads are genuine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { RunLedger } from "../evidence-integrity.js";
import type { TelemetryReconciliation } from "../evidence-integrity.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | ai-obj-014 reachability benchmark",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

/** Plain `.ts` production paths (classifySourceScope => PRODUCTION). */
const GRAPH_EXTRACTOR = "src/graph-extractor.ts";
const INFERENCE = "src/inference.ts";

// `getGraphCentrality` is the production caller of `computeCentrality`.
const INFERENCE_CONTENT = [
  "export function computeCentrality(degrees: { id: string; total: number }[]): Record<string, number> {",
  "  const out: Record<string, number> = {};",
  "  for (const d of degrees) out[d.id] = d.total;",
  "  return out;",
  "}",
].join("\n");

const GRAPH_EXTRACTOR_CONTENT = [
  'import { computeCentrality } from "./inference";',
  "export function getGraphCentrality(input: { id: string; total: number }[]): Record<string, number> {",
  "  return computeCentrality(input);",
  "}",
].join("\n");

/** A forensic report that PROVES production reachability via the call chain. */
const REACHABILITY_REPORT = (graphFile: string, inferenceFile: string) =>
  [
    "## 1) Executive Verdict",
    `getGraphCentrality()@${graphFile} directly invokes computeCentrality()@${inferenceFile} in production.`,
    "## 2) Evidence Map",
    `File: \`${inferenceFile}\``,
    "Role: implementation source",
    "Evidence: `export function computeCentrality(degrees...)`",
    "## 3) Findings",
    "* ID: R-01 · production caller getGraphCentrality invokes computeCentrality",
    `* File(s): \`${graphFile}\` / \`${inferenceFile}\``,
    "* Evidence: `return computeCentrality(input);`",
    "## 4) Repair Plan",
    "No repair required — reachability proven.",
    "## 5) Validation Checklist",
    "- Trace completes: getGraphCentrality -> computeCentrality",
    "## 6) Final Judgment",
    "PROVEN — production reachability established via direct invocation. تم إثبات الوصول المباشر.",
  ].join("\n");

/** A BEHAVIORAL-only answer: explains computeCentrality, proves nothing. */
const BEHAVIORAL_REPORT = (inferenceFile: string) =>
  [
    "## 1) Executive Verdict",
    `computeCentrality()@${inferenceFile} maps each node's total degree to a centrality score.`,
    "## 2) Evidence Map",
    `File: \`${inferenceFile}\``,
    "Role: implementation source",
    "Evidence: `out[d.id] = d.total`",
    "## 3) Findings",
    "* ID: B-01 · computeCentrality returns total-degree centrality per node",
    `* File(s): \`${inferenceFile}\``,
    "* Evidence: `for (const d of degrees) out[d.id] = d.total`",
    "## 4) Repair Plan",
    "None.",
    "## 5) Validation Checklist",
    "- Verified the function's behavior in isolation.",
    "## 6) Final Judgment",
    "PROVEN — computeCentrality computes total-degree centrality.",
  ].join("\n");

/**
 * Mock provider + model-selection registry, and capture every ledger a run
 * produces. In addition to the pre-attachment runtime ledger (buildRuntimeLedger),
 * we capture the POST-attachment objective telemetry ledger (the one
 * attachObjectiveTelemetry stamped) and the validateTelemetry reconciliation it
 * is fed into — so AI-OBJ-011 objective fields + fail-closed are asserted from
 * the real finalization seam.
 */
interface Captures {
  ledgers: RunLedger[];
  telemetryLedgers: RunLedger[];
  reconciles: TelemetryReconciliation[];
}

async function mockChatProviders(
  fakeStrategy: unknown,
  captures: Captures,
  opts: { fallbackChain?: string[]; openrouterChain?: string[] } = {},
): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  const fallbackChain = opts.fallbackChain ?? ["initial-model"];
  const openrouterChain = opts.openrouterChain ?? ["initial-model"];
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
      fallbackChain,
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => openrouterChain.map((id) => ({ id }))),
  }));
  vi.doMock("../evidence-integrity.js", async () => {
    const actual = await vi.importActual<typeof import("../evidence-integrity.js")>(
      "../evidence-integrity.js",
    );
    return {
      ...actual,
      buildRuntimeLedger: (input: Parameters<typeof actual.buildRuntimeLedger>[0]) => {
        const ledger = actual.buildRuntimeLedger(input);
        captures.ledgers.push(ledger);
        return ledger;
      },
      attachObjectiveTelemetry: (
        ledger: Parameters<typeof actual.attachObjectiveTelemetry>[0],
        gate: Parameters<typeof actual.attachObjectiveTelemetry>[1],
        objective: Parameters<typeof actual.attachObjectiveTelemetry>[2],
        recovery?: Parameters<typeof actual.attachObjectiveTelemetry>[3],
      ) => {
        const telemetryLedger = actual.attachObjectiveTelemetry(ledger, gate, objective, recovery);
        captures.telemetryLedgers.push(telemetryLedger);
        return telemetryLedger;
      },
      validateTelemetry: (ledger: Parameters<typeof actual.validateTelemetry>[0]) => {
        const reconciliation = actual.validateTelemetry(ledger);
        captures.reconciles.push(reconciliation);
        return reconciliation;
      },
    };
  });
}

/**
 * Reachability objectives following the real call chain. The PROVEN case carries
 * the proof via a retained caller read (getGraphCentrality -> computeCentrality
 * with evidence), matching the plan's worked example. The behavioral-refusal
 * case requires a claim whose assertion appears verbatim in a retained
 * production read AND in the answer: a behavioral report never asserts it, so
 * the gate refuses it as a completed proof — never a bare import.
 */
// The runtime trace nodes declare `id`, so objective edge endpoints must be the
// SAME node ids (nodeKey() prefers id when present) to match a proven edge.
const EDGE_FROM = "getGraphCentrality";
const EDGE_TO = "computeCentrality";
const CHAIN_EDGE = {
  from: EDGE_FROM,
  to: EDGE_TO,
  relationship: "invokes",
} as ObjectiveContract["requiredEvidenceEdges"][number];

function makeEdgeObjective(): ObjectiveContract {
  return {
    objectiveType: "PRODUCTION_REACHABILITY",
    requiredClaims: [],
    requiredEvidenceEdges: [CHAIN_EDGE],
  };
}

function makeClaimObjective(): ObjectiveContract {
  return {
    objectiveType: "PRODUCTION_REACHABILITY",
    requiredClaims: [
      { claimId: "centrality-reachable", text: "return computeCentrality(input)" },
    ],
    requiredEvidenceEdges: [CHAIN_EDGE],
  };
}

/**
 * A single-file forensic classifier trigger naming the CALLER as the isolated
 * production target so its retained read (which directly invokes the target) is
 * the sole runtime-observation path for the reachability edge. No trace links
 * are injected — the caller's retained body must close the edge.
 */
const FORENSIC_CALLER_MESSAGE = (callerFile: string) =>
  [
    "اختبر قدرة التحليل الجنائي لملف واحد فقط — ملف إنتاجي:",
    callerFile,
    "أثبت أو افنِ وصول الإنتاج إلى computeCentrality (إمكانية الوصول للإنتاج).",
  ].join("\n");

describe("AI-OBJ-014: prove/refute production reachability of computeCentrality (task #65)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  async function makeRoot(): Promise<string> {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-aiobj014-bench-"));
    for (const [rel, content] of [
      [GRAPH_EXTRACTOR, GRAPH_EXTRACTOR_CONTENT],
      [INFERENCE, INFERENCE_CONTENT],
    ] as const) {
      const full = path.join(rootPath, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf8");
    }
    return rootPath;
  }

  it("refuses to surface a BEHAVIORAL-only answer as a completed production-reachability proof", async () => {
    const rootPath = await makeRoot();

    // The model answers with a behavioral explanation of computeCentrality, but
    // the objective requires a PRODUCTION call chain. The gate must refuse it.
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: BEHAVIORAL_REPORT(INFERENCE), sources: [INFERENCE] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    const captures: Captures = { ledgers: [], telemetryLedgers: [], reconciles: [] };
    await mockChatProviders(fakeStrategy, captures);
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: FORENSIC_CALLER_MESSAGE(GRAPH_EXTRACTOR),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: makeClaimObjective(),
        onStep: (step) => void steps.push(step),
      });

      // 1. The behavioral report is NOT surfaced as a completed answer.
      expect(result.response).toMatch(/BLOCKED|محظور/);
      expect(result.response).not.toContain("computes total-degree centrality");

      // 2. An OBJECTIVE_BLOCKED diagnostic was relayed.
      const blockedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBe(true);

      // 3. A production read happened (evidence acquired), so the refusal is a
      //    reachability-scope refusal, not a 0-read denial.
      expect(captures.ledgers.length).toBeGreaterThan(0);
      const finalLedger = captures.ledgers.at(-1)!;
      expect(finalLedger.uniqueFilesRead).toBeGreaterThan(0);

      // 4. Objective telemetry exists on the POST-attachment ledger and
      //    reconciles cleanly (fail-closed: it does NOT block the verdict for an
      //    inconsistency, the block came from the objective gate, and telemetry
      //    agrees with that gate).
      const telemetry = captures.telemetryLedgers.at(-1)!;
      expect(telemetry.objectiveType).toBe("PRODUCTION_REACHABILITY");
      expect(telemetry.completionGateResult).toBeDefined();
      expect(telemetry.completionGateResult).not.toBe("PROVEN");
      expect(telemetry.requiredClaims).toContain("centrality-reachable");
      expect(telemetry.missingClaims).toContain("centrality-reachable");
      expect(telemetry.requiredEdges).toContain(`${EDGE_FROM}->${EDGE_TO}`);
      // The block is driven by the UNCLOSED CLAIM, not the edge: the caller read
      // (getGraphCentrality -> return computeCentrality(input)) legitimately
      // proves the runtime edge (review fix 3 — no injected trace), so the edge
      // lands in provenEdges while the claim stays missing. failedEdges is empty.
      expect(telemetry.provenEdges).toContain(`${EDGE_FROM}->${EDGE_TO}`);
      expect(telemetry.failedEdges).not.toContain(`${EDGE_FROM}->${EDGE_TO}`);
      expect(telemetry.finalAnswerType).toBeDefined();
      expect(telemetry.finalAnswerType).not.toBe("PRODUCTION_REACHABILITY_ANSWER");

      const finalReconcile = captures.reconciles.at(-1)!;
      // The telemetry faithfully records a BLOCKED objective — consistent, not
      // silently passing the behavioral answer as completed.
      expect(finalReconcile.consistent).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("reaches PROVEN and returns the report when the caller's retained read closes the edge (no injected trace)", async () => {
    const rootPath = await makeRoot();

    // Single-file forensic mode performs the targeted read of the CALLER
    // (graph-extractor) before the provider loop. Its retained body directly
    // invokes computeCentrality (`return computeCentrality(input);`), so
    // deriveObjectiveRuntimeEdgesFromRetainedReads must close the required edge
    // from that real PRODUCTION read — NO productionTraceLinks are injected;
    // static lexical matches never qualify. The provider only needs to
    // synthesize the report after the pre-read; asking it to repeat the read
    // would intentionally trip the duplicate-call guard.
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        return {
          content: JSON.stringify({
            response: REACHABILITY_REPORT(GRAPH_EXTRACTOR, INFERENCE),
            sources: [GRAPH_EXTRACTOR, INFERENCE],
          }),
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    const captures: Captures = { ledgers: [], telemetryLedgers: [], reconciles: [] };
    await mockChatProviders(fakeStrategy, captures);
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: FORENSIC_CALLER_MESSAGE(GRAPH_EXTRACTOR),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: makeEdgeObjective(),
        onStep: (step) => void steps.push(step),
      });
      // The report surfaces as the completed answer: its Final Judgment closes
      // with PROVEN (a structural "BLOCKED — no behavioral scenario" line inside
      // the Validation Checklist is not a reachability refusal). The authoritative
      // PROVEN signal is the gate verdict + absence of OBJECTIVE_BLOCKED below.
      expect(result.response).toContain("Final Judgment");
      expect(result.response).toContain("PROVEN");

      // No OBJECTIVE_BLOCKED diagnostic.
      const blockedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBe(false);

      // The runtime production reads happened (the caller was retained).
      expect(captures.ledgers.length).toBeGreaterThan(0);
      const finalLedger = captures.ledgers.at(-1)!;
      expect(finalLedger.uniqueFilesRead).toBeGreaterThan(0);

      // Gap-3: the required edge was closed by the RETAINED caller read, not by
      // an injected trace link. The post-attachment telemetry records the edge
      // as PROVEN and the verdict as PROVEN.
      const telemetry = captures.telemetryLedgers.at(-1)!;
      expect(telemetry.completionGateResult).toBe("PROVEN");
      expect(telemetry.requiredEdges).toContain(`${EDGE_FROM}->${EDGE_TO}`);
      expect(telemetry.provenEdges).toContain(`${EDGE_FROM}->${EDGE_TO}`);
      expect(telemetry.failedEdges).not.toContain(`${EDGE_FROM}->${EDGE_TO}`);
      expect(telemetry.missingClaims).toHaveLength(0);
      expect(telemetry.finalAnswerType).toBe("PRODUCTION_REACHABILITY_ANSWER");

      // Fail-closed: telemetry reconciles with the PROVEN verdict.
      const reconcile = captures.reconciles.at(-1)!;
      expect(reconcile.consistent).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("OBJECTIVE_MISMATCH: an accepted behavioral answer for a reachability objective is blocked at chat() level", async () => {
    const rootPath = await makeRoot();

    // The run is an EXPLICIT behavior query (grounded behavioral answer with
    // ACTIVE accept-list behavior validation), so acceptedBehaviorEvidence is
    // populated. But the declared objective is PRODUCTION_REACHABILITY with a
    // required edge that no retained production caller read closes (only the
    // target is read, whose body defines but never invokes computeCentrality).
    // deriveObjectiveAnswerTypeMismatch must flip on from those real signals and
    // the gate must emit OBJECTIVE_MISMATCH with blocked output.
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({
          response:
            `Source: \`${INFERENCE}\`\n` +
            "`for (const d of degrees) out[d.id] = d.total;` is the loop body, so each node's total degree is written straight into the result map.",
          sources: [INFERENCE],
        }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    const captures: Captures = { ledgers: [], telemetryLedgers: [], reconciles: [] };
    await mockChatProviders(fakeStrategy, captures);
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        // An explicit behavior query: names the behavior + file and asks for a
        // grounded answer — this is what populates acceptedBehaviorEvidence.
        message: `What does computeCentrality do for each node in ${INFERENCE}? Answer with evidence from the source body.`,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: makeEdgeObjective(),
        onStep: (step) => void steps.push(step),
      });

      // 1. The behavioral answer is BLOCKED (blocked replacement text).
      expect(result.response).toMatch(/BLOCKED|محظور/);
      expect(result.response).not.toMatch(/\bPROVEN\b/);

      // 2. OBJECTIVE_BLOCKED diagnostic with status:OBJECTIVE_MISMATCH.
      const blockedDiag = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBeDefined();
      if (blockedDiag?.kind === "diagnostic" && blockedDiag.details) {
        expect(blockedDiag.details.join("\n")).toContain("status:OBJECTIVE_MISMATCH");
      }

      // 3. Post-attachment objective telemetry records the real derivation.
      const telemetry = captures.telemetryLedgers.at(-1)!;
      expect(telemetry.completionGateResult).toBe("OBJECTIVE_MISMATCH");
      expect(telemetry.finalAnswerType).toBe("BEHAVIORAL_ANSWER");
      expect(telemetry.requiredEdges).toContain(`${EDGE_FROM}->${EDGE_TO}`);
      // The edge was NOT proven from any retained caller read.
      expect(telemetry.provenEdges).not.toContain(`${EDGE_FROM}->${EDGE_TO}`);

      // Fail-closed consistent: OBJECTIVE_MISMATCH is exempt from the zero-proven
      // rule and reconciles with the gate.
      const reconcile = captures.reconciles.at(-1)!;
      expect(reconcile.consistent).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("RECOVERY_SCOPE_FAILURE: recovery reading outside the bounded objective scope is a chat()-level reachability failure", async () => {
    const rootPath = await makeRoot();
    // A second retained production file that is NOT part of the objective's
    // bounded scope (which is derived from path-qualified edge endpoints).
    const EXTRA = "src/orchestrator.ts";
    const full = path.join(rootPath, EXTRA);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(
      full,
      [
        'import { getGraphCentrality } from "./graph-extractor";',
        "export function runGraph(input: { id: string; total: number }[]) {",
        "  return getGraphCentrality(input);",
        "}",
      ].join("\n"),
      "utf8",
    );

    // Path-qualified edge endpoints => deriveObjectiveBoundedFileScope returns
    // { src/graph-extractor.ts, src/inference.ts }. The recovery step below re-reads
    // src/orchestrator.ts (a retained file OUTSIDE that bound), so
    // deriveObjectiveRecoveryScopeViolated must flip on and the gate must emit
    // RECOVERY_SCOPE_FAILURE (T5 — over-broad recovery can never finalize).
    const boundedObjective: ObjectiveContract = {
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: [
        { claimId: "centrality-reachable", text: "return computeCentrality(input)" },
      ],
      requiredEvidenceEdges: [
        { from: `${GRAPH_EXTRACTOR}#${EDGE_FROM}`, to: `${INFERENCE}#${EDGE_TO}`, relationship: "invokes" },
      ],
    };

    // ───────────────────────────────────────────────────────────────────────────
    // Genuinely drive the EI-017 recovery path (modeled on
    // ei-017-targeted-read-chat-e2e.test.ts): the real recovery loop runs, the
    // recovery provider returns a REJECTED FINDING_PROVEN envelope (empty
    // repairPlan violates the contract), and the targeted read_file_range lands
    // on the retained EXTRA file — which is outside the bounded objective scope.
    // recoveredReadData is therefore populated by a REAL recovery read, and the
    // gate must downgrade the run to RECOVERY_SCOPE_FAILURE. Nothing is injected.
    // ───────────────────────────────────────────────────────────────────────────
    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        callCount += 1;
        if (callCount === 1) {
          // Main loop: read the caller (in-scope) and then the out-of-scope
          // orchestrator file so both are retained — the recovery targeted read
          // later steps on the out-of-scope retained file.
          return {
            content: "",
            toolCalls: [
              {
                id: "read-caller",
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: GRAPH_EXTRACTOR }),
                },
              },
              {
                id: "read-orch",
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: EXTRA }),
                },
              },
            ],
            model: "initial-model",
            usage: {},
          };
        }
        if (callCount === 2) {
          // Structurally broken forensic synthesis (duplicated Evidence Map
          // heading) → the evidence contract fails → needsForensicRecovery.
          return {
            content: JSON.stringify({
              response: [
                "## 1) Executive Verdict",
                "NOT PROVEN — the available evidence is insufficient.",
                "## 2) Evidence Map",
                `File: \`${EXTRA}\``,
                "Role: implementation source",
                "Evidence: `getGraphCentrality`",
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
              sources: [GRAPH_EXTRACTOR, EXTRA],
            }),
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        // Recovery attempts: a REJECTED FINDING_PROVEN structured envelope whose
        // finding points at EXTRA (retained, but out of the bounded scope). The
        // empty repairPlan violates the "FINDING_PROVEN requires a linked Repair
        // Plan" contract, so validateStructuredForensicRecovery rejects it while
        // findings stay non-empty → the EI-017 targeted read_file_range fires on
        // EXTRA, populating recoveredReadData with the out-of-scope file.
        return {
          content: JSON.stringify({
            verdict: "FINDING_PROVEN",
            findings: [
              {
                id: "F-01",
                title: "runGraph calls getGraphCentrality",
                files: [EXTRA],
                evidence: "`getGraphCentrality` reads outside the bounded objective scope",
                whyItMatters: "Recovery reads must stay inside the declared objective scope.",
                rootCause: "unjustified broad recovery target",
                fix: "restrict recovery reads to the bounded scope",
              },
            ],
            repairPlan: [],
            validationChecklist: [],
          }),
          toolCalls: [],
          model:
            opts.model === "initial-model"
              ? callCount === 3
                ? "recovery-model"
                : "final-model"
              : opts.model,
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    const captures: Captures = { ledgers: [], telemetryLedgers: [], reconciles: [] };
    await mockChatProviders(fakeStrategy, captures, {
      fallbackChain: ["initial-model", "recovery-model", "final-model"],
      openrouterChain: ["recovery-model", "final-model"],
    });
    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        // Same structured forensic trigger as the ei-017 recovery harness so the
        // real recovery loop is reached with the objective threaded through.
        message:
          "You are a forensic auditor. Perform a structured forensic audit and return exactly these sections.\n" +
          "## 1) Executive Verdict\n## 2) Evidence Map\n## 3) Findings" +
          "\n## 4) Repair Plan\n## 5) Validation Checklist\n## 6) Final Judgment",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: boundedObjective,
        onStep: (step) => void steps.push(step),
      });

      // 0. Recovery genuinely ran and issued a targeted read on the out-of-scope
      //    retained file — otherwise this test would just be asserting absence.
      const targetedDiag = steps.some(
        (s) => s.kind === "diagnostic" && s.code === "FORENSIC_TARGETED_READ_ISSUED",
      );
      expect(targetedDiag).toBe(true);

      // The scope-violated run is blocked (never a completed report).
      expect(result.response).toMatch(/BLOCKED|محظور/);

      // OBJECTIVE_BLOCKED diagnostic carries status:RECOVERY_SCOPE_FAILURE.
      const blockedDiag = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "OBJECTIVE_BLOCKED",
      );
      expect(blockedDiag).toBeDefined();
      if (blockedDiag?.kind === "diagnostic" && blockedDiag.details) {
        expect(blockedDiag.details.join("\n")).toContain("status:RECOVERY_SCOPE_FAILURE");
      }

      // Post-attachment telemetry reflects the recovery-scope failure.
      const telemetry = captures.telemetryLedgers.at(-1)!;
      expect(telemetry.completionGateResult).toBe("RECOVERY_SCOPE_FAILURE");

      // Fail-closed consistent: RECOVERY_SCOPE_FAILURE is exempt from the
      // zero-proven rule and reconciles with the gate.
      const reconcile = captures.reconciles.at(-1)!;
      expect(reconcile.consistent).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
