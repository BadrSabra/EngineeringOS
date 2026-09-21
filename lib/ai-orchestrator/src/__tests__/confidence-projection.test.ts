import { describe, expect, it } from "vitest";
import { computeServerOwnedConfidence } from "../confidence-projection.js";

const objective = {
  requiredEvidencePaths: ["src/handler.ts"],
  requiredClaims: [{
    claimId: "handler",
    text: "handler is covered",
    requiredEvidencePaths: ["src/handler.ts"],
  }],
} as const;

describe("server-owned confidence projection", () => {
  it("keeps a complete single-file claim limited", () => {
    const result = computeServerOwnedConfidence({
      objective,
      gate: {
        status: "PROVEN",
        requiredClaims: ["handler"],
        completedClaims: ["handler"],
        contradictoryClaims: [],
      },
      evidence: [{
        source: "src/handler.ts",
        sourceType: "IMPLEMENTATION",
        supportsClaim: true,
        citationStatus: "ACCEPTED",
      }],
      expectedRevision: "rev-a",
      observedRevision: "rev-a",
      objectiveClosure: true,
    });

    expect(result.score).toBeLessThan(0.8);
    expect(result.level).toBe("LIMITED");
    expect(result.acceptedClaimCount).toBe(1);
    expect(result.sourceTypes).toEqual(["IMPLEMENTATION"]);
  });

  it("raises confidence when implementation, test, projection, and revision agree", () => {
    const result = computeServerOwnedConfidence({
      objective: {
        requiredEvidencePaths: ["src/handler.ts", "src/handler.test.ts"],
        requiredClaims: objective.requiredClaims,
      },
      gate: {
        status: "PROVEN",
        requiredClaims: ["handler"],
        completedClaims: ["handler"],
        contradictoryClaims: [],
      },
      evidence: [
        {
          source: "src/handler.ts",
          sourceType: "IMPLEMENTATION",
          supportsClaim: true,
          citationStatus: "ACCEPTED",
        },
        {
          source: "src/handler.test.ts",
          sourceType: "TEST",
          supportsClaim: true,
          citationStatus: "ACCEPTED",
        },
      ],
      expectedRevision: "rev-a",
      observedRevision: "rev-a",
      objectiveClosure: true,
      projectionEvidence: true,
    });

    expect(result.level).toBe("HIGH");
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.sourceDiversity).toBeGreaterThan(0.8);
  });

  it("does not allow a contradiction to become PROVEN", () => {
    const result = computeServerOwnedConfidence({
      objective,
      gate: {
        status: "BLOCKED",
        requiredClaims: ["handler"],
        completedClaims: ["handler"],
        contradictoryClaims: ["handler"],
      },
      evidence: [{
        source: "src/handler.ts",
        sourceType: "IMPLEMENTATION",
        supportsClaim: true,
        citationStatus: "ACCEPTED",
      }, {
        source: "src/handler.test.ts",
        sourceType: "TEST",
        supportsClaim: true,
        citationStatus: "ACCEPTED",
      }],
      expectedRevision: "rev-a",
      observedRevision: "rev-a",
      objectiveClosure: false,
      projectionEvidence: true,
    });

    expect(result.contradictionFree).toBe(false);
    expect(result.level).toBe("NOT_PROVEN");
    expect(result.score).toBeLessThan(0.85);
  });

  it("rejects stale evidence even when the provider-facing factors look complete", () => {
    const result = computeServerOwnedConfidence({
      objective,
      gate: {
        status: "PROVEN",
        requiredClaims: ["handler"],
        completedClaims: ["handler"],
        contradictoryClaims: [],
      },
      evidence: [{
        source: "src/handler.ts",
        sourceType: "IMPLEMENTATION",
        supportsClaim: true,
        citationStatus: "ACCEPTED",
      }, {
        source: "src/handler.test.ts",
        sourceType: "TEST",
        supportsClaim: true,
        citationStatus: "ACCEPTED",
      }],
      expectedRevision: "rev-current",
      observedRevision: "rev-old",
      objectiveClosure: true,
      projectionEvidence: true,
    });

    expect(result.revisionMatch).toBe(false);
    expect(result.level).not.toBe("HIGH");
    expect(result.objectiveClosure).toBe(true);
  });
});