import { describe, expect, it } from "vitest";
import { evaluateOperationalReadiness, type OperationalReadinessInput } from "./operational-readiness-gate.js";

const base = (overrides: Partial<OperationalReadinessInput> = {}): OperationalReadinessInput => ({
  operationId: "op-1", projectId: "project-1", projectRevision: "rev-1", candidateRevision: "rev-1",
  candidateIdentity: "candidate-1", approvedScope: ["src/a.ts"], operationState: "succeeded",
  evidenceCompleteness: "complete", evidenceRefs: ["validation:1"],
  terminalVerdict: "PROVEN", requiredNodes: [{ id: "validate", status: "passed", evidenceRefs: ["validation:1"] }],
  ...overrides,
});

describe("operational readiness gate", () => {
  it("proves only a complete candidate-bound operation", () => {
    const result = evaluateOperationalReadiness(base(), { evaluatedAt: "2026-08-24T00:00:00.000Z" });
    expect(result.status).toBe("proven");
    expect(result.releaseRecommendation).toBe("ready");
    expect(result.optionalExternalObservation).toBe("not-evaluated");
  });

  it("does not accept false success, cancellation, restart, or missing evidence", () => {
    expect(evaluateOperationalReadiness(base({ terminalVerdict: "PARTIAL" })).status).toBe("blocked");
    expect(evaluateOperationalReadiness(base({ operationState: "cancelled", evidenceCompleteness: "cancelled" })).status).toBe("incomplete");
    expect(evaluateOperationalReadiness(base({ operationState: "running", evidenceCompleteness: "partial" })).status).toBe("incomplete");
    expect(evaluateOperationalReadiness(base({ evidenceRefs: [], evidenceCompleteness: "partial" })).status).toBe("incomplete");
  });

  it("blocks candidate mismatch and unresolved campaign findings", () => {
    const mismatch = evaluateOperationalReadiness(base({ candidateRevision: "rev-old" }));
    expect(mismatch.status).toBe("blocked");
    const campaign = evaluateOperationalReadiness(base({
      campaign: {
        operationId: "op-1", revision: "rev-1",
        findings: [{ id: "scope-escape", status: "failed", blocking: true, detail: "Scope escaped.", recoveryAction: "Re-run in isolated scope." }],
      },
    }));
    expect(campaign.status).toBe("blocked");
    expect(campaign.blockers).toContain("campaign:scope-escape");
  });

  it("is deterministic and idempotent for repeated evaluation", () => {
    const first = evaluateOperationalReadiness(base(), { evaluatedAt: "fixed" });
    const second = evaluateOperationalReadiness(base(), { evaluatedAt: "fixed" });
    expect(second).toEqual(first);
  });
});