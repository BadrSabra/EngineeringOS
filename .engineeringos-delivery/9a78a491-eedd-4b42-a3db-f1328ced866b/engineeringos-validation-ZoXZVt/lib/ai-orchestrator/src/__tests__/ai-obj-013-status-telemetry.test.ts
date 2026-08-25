/**
 * Task #65 (P2) — Reachability proof statuses + objective telemetry.
 *
 * AI-OBJ-013 regression tests (T1–T6): the completion gate must emit the
 * exact status for each reachability shape — including RECOVERY_SCOPE_FAILURE
 * and OBJECTIVE_MISMATCH — so a behavioral answer or an over-broad recovery
 * scan can never surface as a completed proof.
 *
 * AI-OBJ-011 telemetry: RunLedger objective fields + fail-closed
 * validateTelemetry. Malformed objective telemetry must block the verdict, not
 * pass silently as a completed production-reachability proof.
 */

import { describe, expect, it } from "vitest";
import {
  objectiveCompletionGate,
  validateTelemetry,
  attachObjectiveTelemetry,
  buildRuntimeLedger,
  type RunLedger,
  type ObjectiveCompletionGateResult,
} from "../evidence-integrity.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const OBJECTIVE: ObjectiveContract = {
  objectiveType: "PRODUCTION_REACHABILITY",
  requiredClaims: [
    { claimId: "eval-reached", text: "untrusted input reaches the eval() call" },
  ],
  requiredEvidenceEdges: [
    { from: "client", to: "server", relationship: "calls" },
    { from: "server", to: "eval-target", relationship: "invokes" },
  ],
};

function emptyLedger(): any {
  return {
    claims: [] as any[],
    evidenceRecords: [],
    completedReads: 0,
    uniqueFilesRead: 0,
    evidenceFileCount: 0,
    acceptedEvidenceCount: 0,
    provenClaims: 0,
    readAttempts: 0,
    runId: "run-test",
  };
}

// T0 — every gate result carries the AI-OBJ-011 telemetry fields.
function gate(input: {
  ledger?: RunLedger;
  objective?: ObjectiveContract;
  provenEdges?: { from: string; to: string }[];
  closedClaimIds?: string[];
  recoveryScopeViolated?: boolean;
  answerTypeMismatch?: boolean;
}): ObjectiveCompletionGateResult {
  return objectiveCompletionGate({
    ledger: input.ledger ?? emptyLedger(),
    objective: input.objective ?? OBJECTIVE,
    provenEdges: input.provenEdges,
    closedClaimIds: input.closedClaimIds,
    recoveryScopeViolated: input.recoveryScopeViolated,
    answerTypeMismatch: input.answerTypeMismatch,
  });
}

describe("objectiveCompletionGate reachability statuses (AI-OBJ-013)", () => {
  it("T1 BLOCKED — behavioral evidence present but the production caller is unproven", () => {
    const ledger = emptyLedger();
    // Behavioral evidence (a read of the target internals) exists, but no
    // production caller/edge is proven -> BLOCKED, never PROVEN.
    ledger.evidenceRecords = [{ file: "lib/knowledge-engine/src/inference.ts", readType: "full" }];
    const result = gate({
      ledger,
      provenEdges: [{ from: "impl", to: "impl2" }],
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.blocked).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("T2 PARTIALLY_PROVEN — caller + target invocation proven, consumer unproven", () => {
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = gate({
      ledger,
      provenEdges: [
        { from: "client", to: "server" },
        // the consumer edge (server->eval-target) is not proven
      ],
    });
    expect(result.status).toBe("PARTIALLY_PROVEN");
    expect(result.missingEdges).toContain("server->eval-target");
    expect(result.missingEdges).not.toContain("client->server");
    expect(result.blocked).toBe(true);
  });

  it("T3 PROVEN — every required edge and claim is directly proven", () => {
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = gate({
      ledger,
      provenEdges: [
        { from: "client", to: "server" },
        { from: "server", to: "eval-target" },
      ],
    });
    expect(result.status).toBe("PROVEN");
    expect(result.complete).toBe(true);
    expect(result.missingClaims).toHaveLength(0);
    expect(result.missingEdges).toHaveLength(0);
  });

  it("T4 NOT_PROVEN — import-only evidence never closes a required edge", () => {
    // A bare import/static membership is present but the gate sees no runtime
    // evidence and no closed claim -> NOT_PROVEN, not PROVEN.
    const result = gate({ closedClaimIds: [] });
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.blocked).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.missingEdges).toContain("client->server");
  });

  it("T5 RECOVERY_SCOPE_FAILURE — recovery reads outside the bounded objective scope", () => {
    // Even with a fully proven claim AND edge, an over-broad recovery scan
    // (non-required files) must override everything -> RECOVERY_SCOPE_FAILURE.
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = gate({
      ledger,
      provenEdges: [
        { from: "client", to: "server" },
        { from: "server", to: "eval-target" },
      ],
      recoveryScopeViolated: true,
    });
    expect(result.status).toBe("RECOVERY_SCOPE_FAILURE");
    expect(result.blocked).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.recoveryScopeViolated).toBe(true);
    // Even though every element is provable, the scope violation refuses PROVEN.
    expect(result.status).not.toBe("PROVEN");
  });

  it("T6 OBJECTIVE_MISMATCH — behavioral answer instead of production-reachability answer", () => {
    // The model describes what computeCentrality does (behavioral excerpt) but
    // never proves production reachability. Must be OBJECTIVE_MISMATCH, even if
    // evidence would otherwise present as sufficient.
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = gate({
      ledger,
      provenEdges: [
        { from: "client", to: "server" },
        { from: "server", to: "eval-target" },
      ],
      answerTypeMismatch: true,
    });
    expect(result.status).toBe("OBJECTIVE_MISMATCH");
    expect(result.blocked).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.answerTypeMismatch).toBe(true);
    expect(result.status).not.toBe("PROVEN");
  });

  it("OBJECTIVE_MISMATCH takes precedence even over RECOVERY_SCOPE_FAILURE (both set)", () => {
    const result = gate({ recoveryScopeViolated: true, answerTypeMismatch: true });
    expect(result.status).toBe("OBJECTIVE_MISMATCH");
  });
});

describe("AI-OBJ-011 objective telemetry (attachObjectiveTelemetry)", () => {
  it("returns the ledger unchanged when no objective or gate is present", () => {
    const ledger = emptyLedger();
    expect(attachObjectiveTelemetry(ledger, null, undefined)).toBe(ledger);
    expect(attachObjectiveTelemetry(ledger, null, OBJECTIVE)).toBe(ledger);
  });

  it("stamps objective fields derived from a PROVEN gate", () => {
    const ledger = emptyLedger();
    ledger.claims = [{ claimId: "objective:eval-reached", status: "SUPPORTED" }];
    const result = objectiveCompletionGate({
      ledger,
      objective: OBJECTIVE,
      provenEdges: [
        { from: "client", to: "server" },
        { from: "server", to: "eval-target" },
      ],
    });
    const tel = attachObjectiveTelemetry(ledger, result, OBJECTIVE, {
      triggered: false,
    });
    expect(tel.objectiveType).toBe("PRODUCTION_REACHABILITY");
    expect(tel.requiredClaims).toEqual(["eval-reached"]);
    expect(tel.completedClaims).toEqual(["eval-reached"]);
    expect(tel.missingClaims).toHaveLength(0);
    expect(tel.requiredEdges).toEqual(["client->server", "server->eval-target"]);
    expect(tel.provenEdges).toHaveLength(2);
    expect(tel.failedEdges).toHaveLength(0);
    expect(tel.completionGateResult).toBe("PROVEN");
    expect(tel.finalAnswerType).toBe("PRODUCTION_REACHABILITY_ANSWER");
    expect(tel.recoveryTriggered).toBe(false);
  });

  it("records recovery metadata and a behavioral final answer type when gated", () => {
    const result = gate({ answerTypeMismatch: true });
    const tel = attachObjectiveTelemetry(emptyLedger(), result, OBJECTIVE, {
      triggered: true,
      target: "client->server",
    });
    expect(tel.completionGateResult).toBe("OBJECTIVE_MISMATCH");
    expect(tel.finalAnswerType).toBe("BEHAVIORAL_ANSWER");
    expect(tel.recoveryTriggered).toBe(true);
    expect(tel.recoveryTarget).toBe("client->server");
  });
});

describe("validateTelemetry fail-closed on objective telemetry (AI-OBJ-011)", () => {
  function led(overrides: Partial<RunLedger>): RunLedger {
    return {
      ...emptyLedger(),
      objectiveType: "PRODUCTION_REACHABILITY",
      requiredClaims: ["req-a", "req-b"],
      completedClaims: ["req-a"],
      missingClaims: ["req-b"],
      requiredEdges: ["a->b", "b->c"],
      provenEdges: ["a->b"],
      failedEdges: ["b->c"],
      scopeExpansions: [],
      unjustifiedReads: [],
      completionGateResult: "PARTIALLY_PROVEN",
      finalAnswerType: "NO_ANSWER",
      ...overrides,
    } as unknown as RunLedger;
  }

  it("consistent, fully-partitioned objective telemetry passes", () => {
    expect(validateTelemetry(led({})).consistent).toBe(true);
  });

  it("fails closed: objectiveType set but claim arrays missing", () => {
    const res = validateTelemetry(led({ requiredClaims: undefined } as any)) as {
      consistent: boolean;
      code?: string;
    };
    expect(res.consistent).toBe(false);
    expect(res.code).toBe("TELEMETRY_INCONSISTENT");
  });

  it("fails closed: completed and missing claims overlap", () => {
    const res = validateTelemetry(
      led({ completedClaims: ["req-a"], missingClaims: ["req-a"] }),
    );
    expect(res.consistent).toBe(false);
  });

  it("fails closed: completed/missing counts do not cover all required claims", () => {
    const res = validateTelemetry(
      led({ completedClaims: ["req-a"], missingClaims: [] }),
    );
    expect(res.consistent).toBe(false);
  });

  it("fails closed: completed claim is not a required claim", () => {
    const res = validateTelemetry(led({ completedClaims: ["ghost"] }));
    expect(res.consistent).toBe(false);
  });

  it("fails closed: required edge proven+failed do not partition required edges", () => {
    const lostEdge = led({ provenEdges: ["a->b"], failedEdges: [] });
    expect(validateTelemetry(lostEdge).consistent).toBe(false);
  });

  it("fails closed: gate PROVEN alongside a non-empty missingClaims", () => {
    const res = validateTelemetry(led({ completionGateResult: "PROVEN" }));
    expect(res.consistent).toBe(false);
  });

  it("fails closed: gate PROVEN alongside a non-empty failedEdges", () => {
    const res = validateTelemetry(
      led({ completionGateResult: "PROVEN", failedEdges: ["b->c"] }),
    );
    expect(res.consistent).toBe(false);
  });

  it("fails closed: PARTIALLY_PROVEN recorded with zero proven claims/edges", () => {
    const res = validateTelemetry(
      led({
        completedClaims: [],
        missingClaims: ["req-a", "req-b"],
        provenEdges: [],
        failedEdges: ["a->b", "b->c"],
        completionGateResult: "PARTIALLY_PROVEN",
      }),
    );
    expect(res.consistent).toBe(false);
  });

  it("a ledger without objectiveType does not trigger objective checks", () => {
    expect(validateTelemetry(emptyLedger()).consistent).toBe(true);
  });

  it("reconciles scope expansions into bounded objective telemetry", () => {
    const ledger = buildRuntimeLedger({
      runId: "run-scope",
      fileContents: new Map([["src/target.ts", "export function target() {}"]]),
      sourceRetrieval: {
        readAttempts: 2,
        uniqueReads: 1,
        readPaths: ["src/target.ts"],
        scopeExpansions: [
          {
            kind: "JUSTIFIED_SCOPE_EXPANSION",
            path: "src/caller.ts",
            matchedPolicyPath: "src/caller.ts",
          },
          {
            kind: "UNJUSTIFIED_SCOPE_EXPANSION",
            path: "src/unrelated.ts",
          },
        ],
      },
    });
    expect(ledger.scopeExpansions).toHaveLength(2);
    expect(ledger.unjustifiedReads).toEqual(["src/unrelated.ts"]);
  });

  it("fails closed when PROVEN telemetry contains an unjustified scope read", () => {
    const res = validateTelemetry(
      led({
        completedClaims: ["req-a", "req-b"],
        missingClaims: [],
        provenEdges: ["a->b", "b->c"],
        failedEdges: [],
        completionGateResult: "PROVEN",
        scopeExpansions: [{ kind: "UNJUSTIFIED_SCOPE_EXPANSION", path: "src/unrelated.ts" }],
        unjustifiedReads: ["src/unrelated.ts"],
      }),
    );
    expect(res.consistent).toBe(false);
    if (!res.consistent) {
      expect(res.violations).toContain("completionGateResult PROVEN with unjustified objective scope reads");
    }
  });
});
