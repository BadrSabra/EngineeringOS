/**
 * Claim-level evidence planning derived from the existing objective contract.
 *
 * This is intentionally a projection, not a new persisted contract. The
 * objective remains the source of truth; the plan makes its per-claim coverage
 * explicit for scheduling, recovery, and telemetry.
 */

export type ObjectiveClaimPlanObjective = {
  requiredEvidencePaths?: readonly string[];
  requiredClaims: readonly {
    claimId: string;
    requiredEvidencePaths?: readonly string[];
  }[];
};

export type ObjectiveClaimPlanClaim = {
  claimId: string;
  requiredEvidencePaths: string[];
  evidenceRefs: string[];
  missingEvidencePaths: string[];
  status: "PENDING" | "PROVEN";
};

export type ObjectiveClaimPlan = {
  objectiveEvidencePaths: string[];
  missingObjectiveEvidencePaths: string[];
  claims: ObjectiveClaimPlanClaim[];
  /** Ordered, deduplicated paths that can still advance the objective. */
  missingEvidencePaths: string[];
};

function normalizePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!normalized || normalized.split("/").some((part) => part === "..")) return "";
  return normalized;
}

function distinctPaths(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizePath).filter(Boolean))];
}

/**
 * Build the current claim coverage projection from retained source paths.
 *
 * Objective-level paths stay first for backward-compatible manifest ordering.
 * Once those are covered, claim paths are scheduled in claim declaration order.
 * A complete path is never returned merely because its owning claim remains
 * pending; that claim must instead be closed by the retained evidence and
 * answer-validation stages.
 */
export function buildObjectiveClaimPlan(input: {
  objective: ObjectiveClaimPlanObjective;
  retainedPaths: Iterable<string>;
  claimState?: readonly {
    claimId: string;
    status: "PENDING" | "PROVEN" | "BLOCKED";
    evidenceRefs: readonly string[];
  }[];
}): ObjectiveClaimPlan {
  const retained = new Set(
    [...input.retainedPaths].map(normalizePath).filter(Boolean),
  );
  const restored = new Map(
    (input.claimState ?? []).map((claim) => [claim.claimId, claim]),
  );
  const objectiveEvidencePaths = distinctPaths(input.objective.requiredEvidencePaths);
  const missingObjectiveEvidencePaths = objectiveEvidencePaths.filter(
    (path) => !retained.has(path),
  );
  const claims = input.objective.requiredClaims.map((claim): ObjectiveClaimPlanClaim => {
    const requiredEvidencePaths = distinctPaths(claim.requiredEvidencePaths);
    const prior = restored.get(claim.claimId);
    const priorEvidenceRefs = (prior?.evidenceRefs ?? [])
      .map(normalizePath)
      .filter((path) => path.length > 0 && retained.has(path));
    const priorProofIsRetained =
      prior?.status === "PROVEN" &&
      prior.evidenceRefs.length > 0 &&
      priorEvidenceRefs.length === prior.evidenceRefs.length;
    const evidenceRefs = priorProofIsRetained
      ? priorEvidenceRefs
      : requiredEvidencePaths.filter((path) => retained.has(path));
    const missingEvidencePaths = priorProofIsRetained
      ? []
      : requiredEvidencePaths.filter((path) => !retained.has(path));
    return {
      claimId: claim.claimId,
      requiredEvidencePaths,
      evidenceRefs,
      missingEvidencePaths,
      status:
        requiredEvidencePaths.length > 0 && missingEvidencePaths.length === 0
          ? "PROVEN"
          : "PENDING",
    };
  });

  const missingEvidencePaths = [
    ...missingObjectiveEvidencePaths,
    ...claims.flatMap((claim) => claim.missingEvidencePaths),
  ].filter((path, index, all) => all.indexOf(path) === index);

  return {
    objectiveEvidencePaths,
    missingObjectiveEvidencePaths,
    claims,
    missingEvidencePaths,
  };
}