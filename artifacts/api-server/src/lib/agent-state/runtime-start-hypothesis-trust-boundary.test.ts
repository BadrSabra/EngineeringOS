import { describe, expect, it } from "vitest";
import {
  buildRuntimeStartHypothesisTrustBoundary,
  runtimeStartHypothesisTrustBoundaryBlockers,
  runtimeStartHypothesisTrustBoundaryStatus,
  type RuntimeStartHypothesisTrustBoundary,
  type RuntimeStartHypothesisTrustStatus,
} from "./runtime-start-hypothesis-trust-boundary.js";

function withCheckStatus(
  boundary: RuntimeStartHypothesisTrustBoundary,
  checkId: string,
  status: RuntimeStartHypothesisTrustStatus,
): RuntimeStartHypothesisTrustBoundary {
  return {
    ...boundary,
    checks: boundary.checks.map((check) => (
      check.id === checkId ? { ...check, status } : check
    )),
  };
}

function fullyVerifiedBoundary(
  boundary: RuntimeStartHypothesisTrustBoundary,
): RuntimeStartHypothesisTrustBoundary {
  return {
    sources: boundary.sources.map((source) => ({
      ...source,
      availability: "present",
    })),
    checks: boundary.checks.map((check) => ({
      ...check,
      status: "SERVER_VERIFIED",
      evidenceRefs: [{
        sourceId: check.sourceIds[0]!,
        ref: `trust-evidence:${check.id}`,
        hash: "a".repeat(64),
      }],
    })),
  };
}

describe("P7.5 trust-boundary source inventory", () => {
  it("records partial sources without promoting P7.5 claims", () => {
    const first = buildRuntimeStartHypothesisTrustBoundary();
    const second = buildRuntimeStartHypothesisTrustBoundary();
    const reviewerIdentity = first.checks.find((check) => check.id === "reviewer-identity");

    expect(first).toEqual(second);
    expect(first.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "clerk-session-identity",
        availability: "present",
      }),
      expect.objectContaining({
        id: "episode-ledger",
        availability: "present",
      }),
      expect.objectContaining({
        id: "server-operator-allowlist",
        availability: "present",
      }),
      expect.objectContaining({
        id: "generic-task-operator-attestation",
        availability: "present",
      }),
      expect.objectContaining({
        id: "fixed-heldout-partition",
        availability: "present",
      }),
      expect.objectContaining({
        id: "protocol-manifest",
        availability: "present",
      }),
      expect.objectContaining({
        id: "cohort-sampling-lineage",
        availability: "not_found",
      }),
      expect.objectContaining({
        id: "p75-review-approval-record",
        availability: "not_found",
      }),
    ]));
    expect(reviewerIdentity).toMatchObject({
      status: "MISSING",
      sourceIds: ["clerk-session-identity", "p75-review-approval-record"],
      evidenceRefs: [],
    });
    expect(first.checks.every((check) => (
      check.status === "MISSING" && check.evidenceRefs.length === 0
    ))).toBe(true);
    expect(runtimeStartHypothesisTrustBoundaryBlockers(first)).toHaveLength(
      first.checks.length,
    );
    expect(runtimeStartHypothesisTrustBoundaryStatus(first)).toBe("blocked");
  });

  it("keeps missing, conflicting, and out-of-scope evidence blocking", () => {
    const boundary = buildRuntimeStartHypothesisTrustBoundary();
    const verified = fullyVerifiedBoundary(boundary);
    const conflicted = withCheckStatus(
      verified,
      "held-out-provenance",
      "CONFLICTING",
    );
    const outOfScope = withCheckStatus(
      verified,
      "forecast-and-policy-freeze",
      "OUT_OF_SCOPE",
    );

    expect(runtimeStartHypothesisTrustBoundaryStatus(conflicted)).toBe("blocked");
    expect(runtimeStartHypothesisTrustBoundaryStatus(outOfScope)).toBe("blocked");
    expect(runtimeStartHypothesisTrustBoundaryBlockers(conflicted)).toContain(
      "trust-boundary:held-out-provenance:conflicting",
    );
    expect(runtimeStartHypothesisTrustBoundaryBlockers(outOfScope)).toContain(
      "trust-boundary:forecast-and-policy-freeze:out_of_scope",
    );
  });

  it("keeps UNVERIFIABLE distinct from review and blocking even with bound evidence", () => {
    const boundary = fullyVerifiedBoundary(buildRuntimeStartHypothesisTrustBoundary());
    const unverifiable: RuntimeStartHypothesisTrustBoundary = {
      ...boundary,
      checks: boundary.checks.map((check) => ({
        ...check,
        status: "UNVERIFIABLE",
      })),
    };

    expect(runtimeStartHypothesisTrustBoundaryBlockers(unverifiable)).toEqual(
      unverifiable.checks.map((check) => `trust-boundary:${check.id}:unverifiable`).sort(),
    );
    expect(runtimeStartHypothesisTrustBoundaryStatus(unverifiable)).toBe("blocked");
    expect(runtimeStartHypothesisTrustBoundaryStatus(unverifiable)).not.toBe("review_required");
  });

  it("keeps human review distinct from missing proof and does not imply collection approval", () => {
    const boundary = buildRuntimeStartHypothesisTrustBoundary();
    const verified = fullyVerifiedBoundary(boundary);
    const reviewRequired = withCheckStatus(
      verified,
      "reviewer-identity",
      "HUMAN_REVIEW_REQUIRED",
    );

    expect(runtimeStartHypothesisTrustBoundaryStatus(reviewRequired)).toBe("review_required");
    expect(runtimeStartHypothesisTrustBoundaryBlockers(reviewRequired)).toEqual([]);
    expect(runtimeStartHypothesisTrustBoundaryStatus(verified)).toBe("verified");
    expect(runtimeStartHypothesisTrustBoundaryStatus({
      ...verified,
      checks: verified.checks.map((check) => ({
        ...check,
        evidenceRefs: [],
      })),
    })).toBe("blocked");
  });
});