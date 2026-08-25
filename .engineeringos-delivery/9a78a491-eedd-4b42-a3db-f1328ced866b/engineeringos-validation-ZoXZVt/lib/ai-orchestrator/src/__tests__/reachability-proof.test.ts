/**
 * Task #64 — AI-OBJ-004, AI-OBJ-007, AI-OBJ-010, AI-OBJ-012
 *
 * Regression benchmark for the reachability proof model.
 * Covers the four P1 items:
 *   AI-OBJ-004 – ReachabilityEdge + structural import-rejection rule
 *   AI-OBJ-007 – Evidence Relevance Gate (behavior ≠ reachability)
 *   AI-OBJ-010 – Final Answer Validator (6 rules)
 *   AI-OBJ-012 – Objective Verdict Kinds (ANSWER_COMPLETE/PARTIAL/OBJECTIVE_BLOCKED/…)
 */

import { describe, expect, it } from "vitest";
import {
  classifyReachabilityEdge,
  buildReachabilityProofSummary,
  ReachabilityEdgeSchema,
} from "../semantic-trace.js";
import {
  evidenceRelevanceGate,
  validateFinalAnswer,
  createClaim,
} from "../evidence-integrity.js";
import { classifyObjectiveVerdict } from "../audit-telemetry.js";

// ── AI-OBJ-004: ReachabilityEdge structural rules ──────────────────────────────

describe("AI-OBJ-004: ReachabilityEdge — classifyReachabilityEdge", () => {
  it("T4 import-only edge is never proven, regardless of sourceSpan presence", () => {
    // T4: import alone cannot prove production reachability.
    const withSpan = classifyReachabilityEdge({
      fromFile: "lib/knowledge-engine/src/index.ts",
      fromSymbol: "getGraphCentrality",
      toFile: "lib/knowledge-engine/src/inference.ts",
      toSymbol: "computeCentrality",
      relationship: "IMPORT_ONLY",
      sourceSpan: {
        file: "lib/knowledge-engine/src/index.ts",
        startLine: 3,
        endLine: 3,
        snippet: "import { computeCentrality } from './inference.js';",
      },
    });
    expect(withSpan.proven).toBe(false);
    expect(withSpan.relationship).toBe("IMPORT_ONLY");

    const withoutSpan = classifyReachabilityEdge({
      fromFile: "lib/knowledge-engine/src/index.ts",
      fromSymbol: "getGraphCentrality",
      toFile: "lib/knowledge-engine/src/inference.ts",
      toSymbol: "computeCentrality",
      relationship: "IMPORT_ONLY",
    });
    expect(withoutSpan.proven).toBe(false);
  });

  it("UNKNOWN relationship is never proven", () => {
    const edge = classifyReachabilityEdge({
      fromFile: "src/a.ts",
      fromSymbol: "foo",
      toFile: "src/b.ts",
      toSymbol: "bar",
      relationship: "UNKNOWN",
      sourceSpan: { file: "src/a.ts", startLine: 10, endLine: 10, snippet: "bar();" },
    });
    expect(edge.proven).toBe(false);
  });

  it("T3 DIRECT_INVOCATION with sourceSpan is proven", () => {
    // T3 scenario: a direct call-site with span proves production reachability.
    const edge = classifyReachabilityEdge({
      fromFile: "lib/knowledge-engine/src/index.ts",
      fromSymbol: "getGraphCentrality",
      toFile: "lib/knowledge-engine/src/inference.ts",
      toSymbol: "computeCentrality",
      relationship: "DIRECT_INVOCATION",
      sourceSpan: {
        file: "lib/knowledge-engine/src/index.ts",
        startLine: 142,
        endLine: 142,
        snippet: "return computeCentrality(graph, opts);",
      },
    });
    expect(edge.proven).toBe(true);
    expect(ReachabilityEdgeSchema.safeParse(edge).success).toBe(true);
  });

  it("DIRECT_INVOCATION without sourceSpan is NOT proven", () => {
    const edge = classifyReachabilityEdge({
      fromFile: "src/a.ts",
      fromSymbol: "caller",
      toFile: "src/b.ts",
      toSymbol: "target",
      relationship: "DIRECT_INVOCATION",
      // no sourceSpan
    });
    expect(edge.proven).toBe(false);
  });

  it("DATA_FLOW with sourceSpan is proven", () => {
    const edge = classifyReachabilityEdge({
      fromFile: "src/service.ts",
      fromSymbol: "computeScore",
      toFile: "src/consumer.ts",
      toSymbol: "applyScore",
      relationship: "DATA_FLOW",
      sourceSpan: { file: "src/service.ts", startLine: 55, endLine: 56 },
    });
    expect(edge.proven).toBe(true);
  });

  it("DIRECT_INVOCATION with a span in an unrelated file is NOT proven (source-backed model)", () => {
    // The span claims to be in src/other.ts but fromFile is src/engine.ts — a
    // span from an unrelated file must not structurally back a caller edge.
    const edge = classifyReachabilityEdge({
      fromFile: "src/engine.ts",
      fromSymbol: "runEngine",
      toFile: "src/lib.ts",
      toSymbol: "computeCentrality",
      relationship: "DIRECT_INVOCATION",
      sourceSpan: { file: "src/other.ts", startLine: 3, endLine: 3, snippet: "computeCentrality(x);" },
    });
    expect(edge.proven).toBe(false);
    // And the schema rejects a proven edge from a mismatched span outright.
    const parsed = ReachabilityEdgeSchema.safeParse({ ...edge, proven: true });
    expect(parsed.success).toBe(false);
  });

  it("reversed/unordered span is never proven and is rejected by the schema", () => {
    const edge = classifyReachabilityEdge({
      fromFile: "src/engine.ts",
      fromSymbol: "runEngine",
      toFile: "src/lib.ts",
      toSymbol: "computeCentrality",
      relationship: "DIRECT_INVOCATION",
      sourceSpan: { file: "src/engine.ts", startLine: 9, endLine: 3, snippet: "computeCentrality(x);" },
    });
    expect(edge.proven).toBe(false);
    const parsed = ReachabilityEdgeSchema.safeParse({ ...edge, proven: true });
    expect(parsed.success).toBe(false);
  });

  it("sourceSpan.file must equal fromFile and the span must be ordered for a proven edge", () => {
    // Well-formed span in the correct file is still proven.
    const good = classifyReachabilityEdge({
      fromFile: "src/engine.ts",
      fromSymbol: "runEngine",
      toFile: "src/lib.ts",
      toSymbol: "computeCentrality",
      relationship: "DIRECT_INVOCATION",
      sourceSpan: { file: "src/engine.ts", startLine: 5, endLine: 5, snippet: "return computeCentrality(x);" },
    });
    expect(good.proven).toBe(true);
  });
});

describe("AI-OBJ-004: buildReachabilityProofSummary", () => {
  const makeEdge = (
    relationship: Parameters<typeof classifyReachabilityEdge>[0]["relationship"],
    hasSpan: boolean,
  ) =>
    classifyReachabilityEdge({
      fromFile: "src/a.ts",
      fromSymbol: "a",
      toFile: "src/b.ts",
      toSymbol: "b",
      relationship,
      ...(hasSpan ? { sourceSpan: { file: "src/a.ts", startLine: 1, endLine: 1 } } : {}),
    });

  it("NO_EDGES when the chain is empty", () => {
    expect(buildReachabilityProofSummary([]).status).toBe("NO_EDGES");
  });

  it("T4 all-import-only chain → NOT_PROVEN with hasImportOnlyHops=true", () => {
    const summary = buildReachabilityProofSummary([
      makeEdge("IMPORT_ONLY", true),
      makeEdge("IMPORT_ONLY", false),
    ]);
    expect(summary.status).toBe("NOT_PROVEN");
    expect(summary.hasImportOnlyHops).toBe(true);
    expect(summary.provenCount).toBe(0);
  });

  it("T2 partial chain → PARTIALLY_PROVEN", () => {
    const summary = buildReachabilityProofSummary([
      makeEdge("DIRECT_INVOCATION", true),   // proven
      makeEdge("DIRECT_INVOCATION", false),  // not proven (missing span)
    ]);
    expect(summary.status).toBe("PARTIALLY_PROVEN");
    expect(summary.provenCount).toBe(1);
    expect(summary.blockedEdges).toHaveLength(1);
  });

  it("T3 all edges proven → PROVEN", () => {
    const summary = buildReachabilityProofSummary([
      makeEdge("DIRECT_INVOCATION", true),
      makeEdge("DATA_FLOW", true),
    ]);
    expect(summary.status).toBe("PROVEN");
    expect(summary.provenCount).toBe(2);
    expect(summary.blockedEdges).toHaveLength(0);
  });
});

// ── AI-OBJ-007: Evidence Relevance Gate ────────────────────────────────────────

describe("AI-OBJ-007: evidenceRelevanceGate", () => {
  const directRecord = { strength: "DIRECT" as const, file: "lib/knowledge-engine/src/inference.ts" };
  const contextRecord = { strength: "CONTEXT_ONLY" as const, file: "lib/knowledge-engine/src/inference.ts" };

  it("behavioral algorithm excerpt proves C_BEHAVIOR, not C_PRODUCTION_REACHABILITY", () => {
    // The classic AI-OBJ-007 example: a totalDegree computation snippet.
    const snippet = "const totalDegree = inDegree + outDegree;";
    expect(evidenceRelevanceGate(directRecord, "C_BEHAVIOR", snippet)).toEqual({ relevant: true });
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) {
      expect(gate.code).toBe("RELEVANCE_MISMATCH");
      expect(gate.reason).toMatch(/C_BEHAVIOR.*C_PRODUCTION_REACHABILITY/);
    }
  });

  it("centrality computation body cannot prove C_PRODUCTION_REACHABILITY", () => {
    const snippet = "// returns centrality score for each node\nreturn centrality;";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
  });

  it("import-only excerpt cannot prove C_PRODUCTION_REACHABILITY", () => {
    const snippet = "import { computeCentrality } from './inference.js';";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/import.*C_STRUCTURAL/);
  });

  it("package.json dependency membership cannot prove C_PRODUCTION_REACHABILITY", () => {
    const snippet = `"dependencies": { "@workspace/knowledge-engine": "workspace:*" }`;
    const record = { strength: "CONTEXT_ONLY" as const, file: "artifacts/api-server/package.json" };
    const gate = evidenceRelevanceGate(record, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
  });

  it("direct call-site excerpt proves C_PRODUCTION_REACHABILITY", () => {
    const snippet = "return computeCentrality(graph, opts);";
    expect(evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet)).toEqual({
      relevant: true,
    });
  });

  it("CONTEXT_ONLY record can only prove C_STRUCTURAL", () => {
    expect(evidenceRelevanceGate(contextRecord, "C_STRUCTURAL")).toEqual({ relevant: true });
    const gate = evidenceRelevanceGate(contextRecord, "C_BEHAVIOR");
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.code).toBe("RELEVANCE_MISMATCH");
  });

  it("DIRECT record with a call-site snippet proves C_BEHAVIOR without restriction", () => {
    const snippet = "if (lastTextSeen !== undefined) return { kind: 'partial', text: lastTextSeen };";
    expect(evidenceRelevanceGate(directRecord, "C_BEHAVIOR", snippet)).toEqual({ relevant: true });
  });

  // ── R6 declaration guard: definitions are NOT call-sites (AI-OBJ-007) ────────

  it("R6: export function declaration of the target is rejected as a call-site", () => {
    const snippet = "export function computeCentrality(graph: unknown) { return {}; }";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("R6: class-shorthand method declaration is rejected as a call-site", () => {
    // R5's `computeCentrality(` lexically matches here, but it is the method
    // NAME in a class method declaration, not an invocation.
    const snippet = "computeCentrality(graph: unknown) { return {}; }";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("R6: object-literal shorthand method is rejected as a call-site", () => {
    const snippet = "computeCentrality(graph) { return this.score(graph); }";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("R6: typed class-method declaration (name(args): Return {) is rejected", () => {
    const snippet = "computeCentrality(graph: unknown): number {";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("R6: arrow-function assignment is rejected as a call-site", () => {
    const snippet = "const computeCentrality = (graph) => graph.nodes.length;";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("R6: a genuine standalone call line is still accepted", () => {
    // The declaration guard must not over-reject a real call statement.
    const snippet = "computeCentrality(graph, { maxDepth: 5 });";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet, {
      targetSymbol: "computeCentrality",
    });
    expect(gate.relevant).toBe(true);
  });
});

// ── AI-OBJ-010: Final Answer Validator ─────────────────────────────────────────

describe("AI-OBJ-010: validateFinalAnswer — 6-rule validator", () => {
  it("T3 all claims proven + primary closed + no import hops → ANSWER_COMPLETE", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [{ claimId: "c1", result: "PROVEN", reasons: [] }],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "PROVEN",
      hasImportOnlyHops: false,
    });
    expect(result.verdict).toBe("ANSWER_COMPLETE");
    expect(result.violations).toHaveLength(0);
  });

  it("T1 behavioral evidence but primary claim NOT closed → OBJECTIVE_BLOCKED (R1 + R3)", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      primaryClaimEvidence: [
        {
          snippet: "const totalDegree = inDegree + outDegree;",
          file: "lib/knowledge-engine/src/inference.ts",
          strength: "DIRECT",
        },
      ],
      reachabilityProofStatus: "NOT_PROVEN",
      hasImportOnlyHops: false,
    });
    expect(result.verdict).not.toBe("ANSWER_COMPLETE");
    // R1 must be reported
    expect(result.violations.some((v) => v.startsWith("R1:"))).toBe(true);
    // R3 must be reported (behavioral evidence can't prove reachability)
    expect(result.violations.some((v) => v.startsWith("R3:"))).toBe(true);
  });

  it("T2 partial: one claim proven, one unproven → ANSWER_PARTIAL", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [
        { claimId: "c1", result: "PROVEN", reasons: [] },
        { claimId: "c2", result: "NOT_PROVEN", reasons: ["no invocation span"] },
      ],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "PARTIALLY_PROVEN",
    });
    expect(result.verdict).toBe("ANSWER_PARTIAL");
    expect(result.violations.some((v) => v.startsWith("R2:"))).toBe(true);
  });

  it("T4 import-only hops marked PROVEN → R6 violation, OBJECTIVE_BLOCKED", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [{ claimId: "c1", result: "PROVEN", reasons: [] }],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "PROVEN",
      hasImportOnlyHops: true,  // the chain contains import-only hops!
    });
    // R6: import-only proof is rejected
    expect(result.violations.some((v) => v.startsWith("R6:"))).toBe(true);
    expect(result.verdict).not.toBe("ANSWER_COMPLETE");
  });

  it("import-only NOT_PROVEN chain → R4 violation (blanket NOT_PROVEN misuse)", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "NOT_PROVEN",
      hasImportOnlyHops: true,
    });
    expect(result.violations.some((v) => v.startsWith("R4:"))).toBe(true);
  });

  it("R5: fabricated Finding with no source-span binding is rejected", () => {
    const fakeFindingClaim = createClaim({
      text: "computeCentrality always returns 0",
      taskType: "FULL_FORENSIC_AUDIT",
      evidenceIds: [],
    });
    // Manually set a taskType that triggers the finding rule
    const claimWithFindingType = {
      ...fakeFindingClaim,
      claimId: "finding-c1",
      taskType: "finding-check",
      binding: undefined,
    };
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [{ claimId: "finding-c1", result: "PROVEN", reasons: [] }],
      claims: [claimWithFindingType],
    });
    expect(result.violations.some((v) => v.startsWith("R5:"))).toBe(true);
  });

  it("no-evidence run → EVIDENCE_INSUFFICIENT", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [],
      claims: [],
    });
    expect(result.verdict).toBe("EVIDENCE_INSUFFICIENT");
  });

  it("unproven primary + at least one validation attempted + recovery available → RECOVERY_REQUIRED", () => {
    // RECOVERY_REQUIRED requires the run to have tried claim validation (not zero evidence).
    // With validations present but all NOT_PROVEN and primaryClaimClosed: false,
    // and a specific edge identified for targeted recovery, the verdict is RECOVERY_REQUIRED.
    const result = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [{ claimId: "c1", result: "NOT_PROVEN", reasons: ["missing caller span"] }],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      recoveryAvailable: true,
    });
    expect(result.verdict).toBe("RECOVERY_REQUIRED");
  });

  it("no validations at all (zero evidence) → EVIDENCE_INSUFFICIENT even with recoveryAvailable", () => {
    // Zero validations means the run never even bound evidence to a claim.
    const result = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [],
      claims: [],
      recoveryAvailable: true,
    });
    expect(result.verdict).toBe("EVIDENCE_INSUFFICIENT");
  });
});

// ── AI-OBJ-012: classifyObjectiveVerdict ───────────────────────────────────────

describe("AI-OBJ-012: classifyObjectiveVerdict", () => {
  it("no evidence → EVIDENCE_INSUFFICIENT", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: false,
      allClaimsProven: false,
      anyClaimProven: false,
      evidenceCollected: false,
      recoveryAvailable: false,
    })).toBe("EVIDENCE_INSUFFICIENT");
  });

  it("all claims proven + primary closed → ANSWER_COMPLETE", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: true,
      allClaimsProven: true,
      anyClaimProven: true,
      evidenceCollected: true,
      recoveryAvailable: false,
    })).toBe("ANSWER_COMPLETE");
  });

  it("some claims proven but not all → ANSWER_PARTIAL", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: true,
      allClaimsProven: false,
      anyClaimProven: true,
      evidenceCollected: true,
      recoveryAvailable: false,
    })).toBe("ANSWER_PARTIAL");
  });

  it("T1 no claim proven, evidence collected, recovery available → RECOVERY_REQUIRED", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: false,
      allClaimsProven: false,
      anyClaimProven: false,
      evidenceCollected: true,
      recoveryAvailable: true,
    })).toBe("RECOVERY_REQUIRED");
  });

  it("no claim proven, evidence collected, no recovery → OBJECTIVE_BLOCKED", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: false,
      allClaimsProven: false,
      anyClaimProven: false,
      evidenceCollected: true,
      recoveryAvailable: false,
    })).toBe("OBJECTIVE_BLOCKED");
  });

  it("EVIDENCE_INSUFFICIENT takes precedence over recovery", () => {
    expect(classifyObjectiveVerdict({
      primaryClaimClosed: false,
      allClaimsProven: false,
      anyClaimProven: false,
      evidenceCollected: false,
      recoveryAvailable: true,  // available but no evidence beats it
    })).toBe("EVIDENCE_INSUFFICIENT");
  });
});

// ── Adversarial bypass tests ────────────────────────────────────────────────────

describe("adversarial: schema-level bypass attempts", () => {
  it("ReachabilityEdgeSchema rejects IMPORT_ONLY+proven:true at parse time", () => {
    // A caller that skips classifyReachabilityEdge and constructs an edge
    // directly with proven:true for an IMPORT_ONLY relationship is caught
    // by the Zod refine at deserialization time.
    const parsed = ReachabilityEdgeSchema.safeParse({
      fromFile: "src/a.ts",
      fromSymbol: "foo",
      toFile: "src/b.ts",
      toSymbol: "bar",
      relationship: "IMPORT_ONLY",
      sourceSpan: { file: "src/a.ts", startLine: 1, endLine: 1 },
      proven: true,   // bypass attempt — must be rejected
    });
    expect(parsed.success).toBe(false);
  });

  it("ReachabilityEdgeSchema rejects UNKNOWN+proven:true at parse time", () => {
    const parsed = ReachabilityEdgeSchema.safeParse({
      fromFile: "src/a.ts",
      fromSymbol: "foo",
      toFile: "src/b.ts",
      toSymbol: "bar",
      relationship: "UNKNOWN",
      proven: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("ReachabilityEdgeSchema rejects proven:true without sourceSpan", () => {
    const parsed = ReachabilityEdgeSchema.safeParse({
      fromFile: "src/a.ts",
      fromSymbol: "foo",
      toFile: "src/b.ts",
      toSymbol: "bar",
      relationship: "DIRECT_INVOCATION",
      // no sourceSpan
      proven: true,  // bypass attempt — must be rejected
    });
    expect(parsed.success).toBe(false);
  });

  it("buildReachabilityProofSummary normalizes stale proven:true IMPORT_ONLY edges", () => {
    // An edge that was constructed directly (bypassing classifyReachabilityEdge)
    // with proven:true for an IMPORT_ONLY relationship should be normalized to
    // proven:false by the summary builder's defensive normalization.
    const staleBadEdge = {
      fromFile: "src/a.ts",
      fromSymbol: "caller",
      toFile: "src/b.ts",
      toSymbol: "target",
      relationship: "IMPORT_ONLY" as const,
      sourceSpan: { file: "src/a.ts", startLine: 1, endLine: 1 },
      proven: true,  // stale/bypassed flag
    };
    // We can't parse this through the schema (it would fail), so we pass the raw
    // object as a type cast to simulate a deserialized stale edge.
    const summary = buildReachabilityProofSummary([staleBadEdge as ReturnType<typeof classifyReachabilityEdge>]);
    // The summary must clamp proven:true → proven:false for IMPORT_ONLY.
    expect(summary.status).toBe("NOT_PROVEN");
    expect(summary.provenCount).toBe(0);
    expect(summary.hasImportOnlyHops).toBe(true);
  });
});

describe("adversarial: relevance gate bypass attempts", () => {
  const directRecord = { strength: "DIRECT" as const, file: "lib/inference.ts" };

  it("unrelated prose snippet without invocation pattern is rejected for C_PRODUCTION_REACHABILITY (R4)", () => {
    // The snippet avoids behavioral and import denylists, but has no call-site.
    // It could be a function body declaration or unrelated prose.
    const snippet = "export function computeCentrality(graph: Graph): Map<string, number> {";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) {
      // Declarations are rejected by the R6 declaration guard (more precise than
      // the R4 "no recognisable invocation" fallback).
      expect(gate.reason).toMatch(/declaration/i);
    }
  });

  it("standalone invocation of the bound target proves C_PRODUCTION_REACHABILITY (AI-OBJ-007 R4/R5)", () => {
    // A bare expression-statement call at line start: no `=`/`return`/`await`
    // prefix. The call-site matcher must treat it as a genuine invocation of the
    // target symbol while still rejecting plain declarations/imports.
    const snippet = "computeCentrality(graph, { maxDepth: 5 });";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(true);
    if (!gate.relevant) expect(gate.reason).toMatch(/R4|invocation|symbol/);
  });

  it("standalone call of an unrelated symbol is rejected when the target is known (R5)", () => {
    const snippet = "spamScore(graph, { maxDepth: 5 });";
    const gate = evidenceRelevanceGate(
      directRecord,
      "C_PRODUCTION_REACHABILITY",
      snippet,
      { targetSymbol: "computeCentrality" },
    );
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/no invocation of target symbol "computeCentrality"/);
  });

  it("function declaration line is not mistaken for an invocation (R4)", () => {
    const snippet = "export async function computeCentrality(graph: Graph) {";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/declaration/i);
  });

  it("target implementation body snippet is rejected for C_PRODUCTION_REACHABILITY even when DIRECT", () => {
    // The target function's own body proves behavior, not that it's called.
    const snippet = "const score = degree / maxDegree; return { nodeId, score };";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
    if (!gate.relevant) expect(gate.reason).toMatch(/no recognisable invocation|behavioral/);
  });

  it("generic constructor call without targetSymbol may pass R4, but is rejected by R5 when target is known", () => {
    // Without a target symbol: new Map() matches the INVOCATION_PATTERNS allowlist (R4 passes).
    const snippet = "const result: Map<string, number> = new Map();";
    const gateNoTarget = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    // R4 passes (contains a call), but caller MUST always pass targetSymbol for
    // reachability claims so this generic pass only happens without a target.
    expect(gateNoTarget.relevant).toBe(true);

    // With a target symbol: the snippet must invoke computeCentrality specifically.
    const gateWithTarget = evidenceRelevanceGate(
      directRecord,
      "C_PRODUCTION_REACHABILITY",
      snippet,
      { targetSymbol: "computeCentrality" },
    );
    // new Map() does NOT invoke computeCentrality → R5 fires → rejected.
    expect(gateWithTarget.relevant).toBe(false);
    if (!gateWithTarget.relevant) {
      expect(gateWithTarget.reason).toMatch(/no invocation of target symbol "computeCentrality"/);
    }
  });

  it("unrelated prose with no patterns is rejected for C_PRODUCTION_REACHABILITY", () => {
    const snippet = "// This module handles centrality scoring for knowledge graphs.";
    const gate = evidenceRelevanceGate(directRecord, "C_PRODUCTION_REACHABILITY", snippet);
    expect(gate.relevant).toBe(false);
  });
});

describe("adversarial: validateFinalAnswer completeness bypass", () => {
  it("cannot claim ANSWER_COMPLETE with no validations and no reachability proof", () => {
    // The R-PROOF gate must fire: no PROVEN validations and no PROVEN reachability.
    const result = validateFinalAnswer({
      primaryClaimClosed: true,   // caller-supplied flag, insufficient alone
      validations: [],            // no claim validations
      claims: [],
      // no reachabilityProofStatus provided
    });
    expect(result.verdict).not.toBe("ANSWER_COMPLETE");
    expect(result.violations.some((v) => v.startsWith("R-PROOF:"))).toBe(true);
  });

  it("cannot claim ANSWER_COMPLETE with import-only reachability proof", () => {
    // Even with primaryClaimClosed:true and reachabilityProofStatus:"PROVEN",
    // if hasImportOnlyHops:true then R6 fires and R-PROOF also fires because
    // hasExplicitReachabilityProof = reachabilityProofStatus==="PROVEN" && !hasImportOnlyHops = false.
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "PROVEN",
      hasImportOnlyHops: true,   // bypass attempt
    });
    expect(result.verdict).not.toBe("ANSWER_COMPLETE");
    expect(result.violations.some((v) => v.startsWith("R6:"))).toBe(true);
  });

  it("ANSWER_COMPLETE with PROVEN validation + PROVEN reachability + no import hops is valid", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [{ claimId: "c1", result: "PROVEN", reasons: [] }],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "PROVEN",
      hasImportOnlyHops: false,
    });
    expect(result.verdict).toBe("ANSWER_COMPLETE");
    expect(result.violations).toHaveLength(0);
  });

  it("ANSWER_COMPLETE with PROVEN validation alone (no reachability proof required for non-reachability tasks)", () => {
    const result = validateFinalAnswer({
      primaryClaimClosed: true,
      validations: [{ claimId: "c1", result: "PROVEN", reasons: [] }],
      claims: [],
      // C_BEHAVIOR task: no reachability proof needed
      primaryClaimCategory: "C_BEHAVIOR",
    });
    expect(result.verdict).toBe("ANSWER_COMPLETE");
  });
});

// ── Integration: import-only chain cannot close a C_PRODUCTION_REACHABILITY claim ─

describe("end-to-end: import-only chain cannot prove production reachability", () => {
  it("an import-only ReachabilityEdge + import snippet fails both the proof model and the relevance gate", () => {
    // Build an edge from the import statement.
    const importEdge = classifyReachabilityEdge({
      fromFile: "lib/knowledge-engine/src/index.ts",
      fromSymbol: "getGraphCentrality",
      toFile: "lib/knowledge-engine/src/inference.ts",
      toSymbol: "computeCentrality",
      relationship: "IMPORT_ONLY",
      sourceSpan: {
        file: "lib/knowledge-engine/src/index.ts",
        startLine: 3,
        endLine: 3,
        snippet: "import { computeCentrality } from './inference.js';",
      },
    });

    // The edge is structurally rejected (AI-OBJ-004).
    expect(importEdge.proven).toBe(false);

    // The summary reports NOT_PROVEN + hasImportOnlyHops (AI-OBJ-004).
    const summary = buildReachabilityProofSummary([importEdge]);
    expect(summary.status).toBe("NOT_PROVEN");
    expect(summary.hasImportOnlyHops).toBe(true);

    // The relevance gate also rejects an import snippet for C_PRODUCTION_REACHABILITY (AI-OBJ-007).
    const gate = evidenceRelevanceGate(
      { strength: "DIRECT", file: "lib/knowledge-engine/src/index.ts" },
      "C_PRODUCTION_REACHABILITY",
      importEdge.sourceSpan!.snippet!,
    );
    expect(gate.relevant).toBe(false);

    // And the final answer validator rejects the answer (AI-OBJ-010 R4).
    const finalValidation = validateFinalAnswer({
      primaryClaimClosed: false,
      validations: [],
      claims: [],
      primaryClaimCategory: "C_PRODUCTION_REACHABILITY",
      reachabilityProofStatus: "NOT_PROVEN",
      hasImportOnlyHops: true,
    });
    expect(finalValidation.verdict).not.toBe("ANSWER_COMPLETE");
    expect(finalValidation.violations.some((v) => v.startsWith("R4:"))).toBe(true);
  });
});
