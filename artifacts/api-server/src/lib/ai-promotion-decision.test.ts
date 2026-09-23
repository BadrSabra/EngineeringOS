import { describe, expect, it } from "vitest";
import {
  decideDeliveryPromotion,
  decideDeliveryPromotionWithPairedBaseline,
} from "./ai-promotion-decision.js";

const hashes = {
  candidate: "a".repeat(64),
  changeSet: "b".repeat(64),
};

function baseInput() {
  return {
    changes: [{ path: "docs/guide.md", newContent: "updated guide" }],
    validationResults: [{
      status: "passed",
      evidence: {
        candidateHash: hashes.candidate,
        changeSetHash: hashes.changeSet,
        treeDigestVersion: "delivery-tree-v1",
      },
    }],
    expectedCandidateTreeHash: hashes.candidate,
    observedCandidateTreeHash: hashes.candidate,
    expectedChangeSetHash: hashes.changeSet,
    observedChangeSetHash: hashes.changeSet,
    expectedTreeDigestVersion: "delivery-tree-v1",
    observedTreeDigestVersion: "delivery-tree-v1",
    approvalRequired: false,
  } as const;
}

describe("decideDeliveryPromotion", () => {
  it("marks a small, validated documentation candidate as eligible", () => {
    expect(decideDeliveryPromotion(baseInput())).toEqual({
      decision: "AUTO_PROMOTE_ELIGIBLE",
      reasons: ["eligible"],
    });
  });

  it("keeps source changes review-required even when validation passes", () => {
    const result = decideDeliveryPromotion({
      ...baseInput(),
      changes: [{ path: "src/index.ts", newContent: "export const value = 1;" }],
    });
    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.reasons).toContain("scope_not_auto_promotable");
  });

  it("blocks candidate drift instead of treating validation success as sufficient", () => {
    const result = decideDeliveryPromotion({
      ...baseInput(),
      observedCandidateTreeHash: "c".repeat(64),
    });
    expect(result).toEqual({
      decision: "BLOCKED",
      reasons: ["candidate_drift"],
    });
  });

  it("blocks legacy candidates without a digest contract", () => {
    const result = decideDeliveryPromotion({
      ...baseInput(),
      expectedTreeDigestVersion: null,
      observedTreeDigestVersion: null,
    });
    expect(result).toEqual({
      decision: "BLOCKED",
      reasons: ["candidate_integrity_missing"],
    });
  });

  it("blocks validation evidence that is not bound to the candidate", () => {
    const result = decideDeliveryPromotion({
      ...baseInput(),
      validationResults: [{
        status: "passed",
        evidence: {
          candidateHash: "c".repeat(64),
          changeSetHash: hashes.changeSet,
          treeDigestVersion: "delivery-tree-v1",
        },
      }],
    });
    expect(result.decision).toBe("BLOCKED");
    expect(result.reasons).toContain("candidate_integrity_missing");
  });

  it("does not remove the existing approval gate", () => {
    const result = decideDeliveryPromotion({
      ...baseInput(),
      approvalRequired: true,
    });
    expect(result).toEqual({
      decision: "REVIEW_REQUIRED",
      reasons: ["approval_required"],
    });
  });

  it("blocks the explicit Gate 3 promotion path when the paired comparison is missing", () => {
    const result = decideDeliveryPromotionWithPairedBaseline(baseInput(), undefined);

    expect(result).toEqual({
      decision: "BLOCKED",
      reasons: ["paired_baseline_missing"],
    });
  });

  it("blocks incomplete and regressed paired comparisons", () => {
    const incomplete = decideDeliveryPromotionWithPairedBaseline(baseInput(), {
      status: "incomplete",
      promotionAllowed: false,
    });
    const regressed = decideDeliveryPromotionWithPairedBaseline(baseInput(), {
      status: "regressed",
      promotionAllowed: false,
    });

    expect(incomplete).toEqual({
      decision: "BLOCKED",
      reasons: ["paired_baseline_incomplete"],
    });
    expect(regressed).toEqual({
      decision: "BLOCKED",
      reasons: ["paired_baseline_regressed"],
    });
  });

  it("allows the explicit promotion path only for a passed paired comparison", () => {
    const result = decideDeliveryPromotionWithPairedBaseline(baseInput(), {
      status: "passed",
      promotionAllowed: true,
      canonicalProof: {
        accepted: true,
        verdict: "PROVEN",
        acceptanceId: "acceptance-1",
        candidateTreeHash: hashes.candidate,
      },
    });

    expect(result).toEqual({
      decision: "AUTO_PROMOTE_ELIGIBLE",
      reasons: ["eligible"],
    });
  });

  it("requires an accepted canonical proof on the explicit promotion path", () => {
    const result = decideDeliveryPromotionWithPairedBaseline(baseInput(), {
      status: "passed",
      promotionAllowed: true,
    });

    expect(result).toEqual({
      decision: "BLOCKED",
      reasons: ["canonical_proof_missing"],
    });
  });

  it("blocks a canonical proof bound to a different candidate", () => {
    const result = decideDeliveryPromotionWithPairedBaseline(baseInput(), {
      status: "passed",
      promotionAllowed: true,
      canonicalProof: {
        accepted: true,
        verdict: "PROVEN",
        acceptanceId: "acceptance-2",
        candidateTreeHash: "c".repeat(64),
      },
    });

    expect(result).toEqual({
      decision: "BLOCKED",
      reasons: ["canonical_proof_candidate_mismatch"],
    });
  });
});