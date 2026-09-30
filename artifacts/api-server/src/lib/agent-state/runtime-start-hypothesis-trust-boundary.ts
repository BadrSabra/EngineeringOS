export type RuntimeStartHypothesisTrustStatus =
  | "SERVER_VERIFIED"
  | "HUMAN_REVIEW_REQUIRED"
  | "MISSING"
  | "UNVERIFIABLE"
  | "CONFLICTING"
  | "OUT_OF_SCOPE";

export type RuntimeStartHypothesisTrustSource = {
  id: string;
  availability: "present" | "not_found";
  capability: string;
  limitation: string;
};

export type RuntimeStartHypothesisTrustEvidenceRef = {
  sourceId: string;
  ref: string;
  hash: string;
};

export type RuntimeStartHypothesisTrustCheck = {
  id: string;
  status: RuntimeStartHypothesisTrustStatus;
  requirement: string;
  sourceIds: string[];
  detail: string;
  evidenceRefs: RuntimeStartHypothesisTrustEvidenceRef[];
};

export type RuntimeStartHypothesisTrustBoundary = {
  sources: RuntimeStartHypothesisTrustSource[];
  checks: RuntimeStartHypothesisTrustCheck[];
};

const TRUST_SOURCES: readonly RuntimeStartHypothesisTrustSource[] = [
  {
    id: "clerk-session-identity",
    availability: "present",
    capability: "Identifies the authenticated Clerk user and session.",
    limitation: "No P7.5 review action binds that identity to this pack or protocol.",
  },
  {
    id: "server-operator-allowlist",
    availability: "present",
    capability: "ADMIN_USER_IDS gates existing server-wide operator routes.",
    limitation: "It is not a P7.5 reviewer policy and does not record P7.5 approval.",
  },
  {
    id: "generic-task-operator-attestation",
    availability: "present",
    capability: "Task verification stores an authenticated actor and submitted check result.",
    limitation: "The caller supplies pass/fail and text evidence; it is not independently verified or P7.5-scoped.",
  },
  {
    id: "episode-ledger",
    availability: "present",
    capability: "Binds P7.5 event payloads to Episode rows and ordered event streams.",
    limitation: "It does not prove a controlled reset, human operator identity, sample independence, or held-out lineage.",
  },
  {
    id: "runtime-stop-gate-c-receipt",
    availability: "present",
    capability: "The write-protected runtime.stop recipe can produce a Gate C receipt with verified before/after state for one project runtime session.",
    limitation: "A stop receipt does not establish an operator-reviewed repeatable reset, shared-state isolation, or a binding to a selected P7.5 sample and its independent issuer.",
  },
  {
    id: "fixed-heldout-partition",
    availability: "present",
    capability: "Labels the configured P7.5 evaluation partition.",
    limitation: "A partition label does not establish dataset membership, sampling independence, or prior tuning history.",
  },
  {
    id: "protocol-manifest",
    availability: "present",
    capability: "Hashes the current protocol, evaluator, policy, and scope identifiers.",
    limitation: "The hash does not prove an immutable freeze record existed before outcomes were observed.",
  },
  {
    id: "p75-review-approval-record",
    availability: "not_found",
    capability: "No P7.5-specific durable reviewer approval source was found.",
    limitation: "Reviewer authority and approval are not bound to a pack or protocol revision.",
  },
  {
    id: "controlled-reset-record",
    availability: "not_found",
    capability: "No P7.5-specific controlled reset evidence source was found.",
    limitation: "The existing Episode ledger records operation provenance, not an independently reviewed reset procedure.",
  },
  {
    id: "cohort-sampling-lineage",
    availability: "not_found",
    capability: "No P7.5 cohort or sample-selection lineage source was found.",
    limitation: "Distinct Mission IDs do not prove independent selection.",
  },
  {
    id: "heldout-dataset-lineage",
    availability: "not_found",
    capability: "No P7.5 held-out dataset lineage source was found.",
    limitation: "The configured partition does not establish whether outcomes were previously used for tuning.",
  },
];

const TRUST_CHECKS: readonly RuntimeStartHypothesisTrustCheck[] = [
  {
    id: "reviewer-identity",
    status: "MISSING",
    requirement: "Bind a reviewer identity to a P7.5 review record.",
    sourceIds: ["clerk-session-identity", "p75-review-approval-record"],
    detail: "Clerk can identify a signed-in user, but no durable P7.5 review record binds that identity to this evidence pack.",
    evidenceRefs: [],
  },
  {
    id: "reviewer-authority-and-approval",
    status: "MISSING",
    requirement: "Verify reviewer authority and retain approval for the exact protocol revision.",
    sourceIds: ["server-operator-allowlist", "p75-review-approval-record"],
    detail: "The general operator allowlist is not a P7.5 reviewer designation, and no P7.5-specific approval record exists.",
    evidenceRefs: [],
  },
  {
    id: "controlled-environment-reset",
    status: "MISSING",
    requirement: "Verify an operator-reviewed repeatable reset procedure and controlled environment scope.",
    sourceIds: [
      "episode-ledger",
      "runtime-stop-gate-c-receipt",
      "generic-task-operator-attestation",
      "controlled-reset-record",
    ],
    detail: "Gate C can verify a project runtime stop, but no P7.5 procedure binds it to a selected sample or proves shared-state isolation and repeatability; generic task attestations are caller-submitted.",
    evidenceRefs: [],
  },
  {
    id: "independent-sampling-definition",
    status: "MISSING",
    requirement: "Verify a sampling definition that rules out automatic reuse and establishes independence.",
    sourceIds: ["cohort-sampling-lineage"],
    detail: "No trusted cohort-selection history establishes independent sampling; distinct Mission IDs are insufficient.",
    evidenceRefs: [],
  },
  {
    id: "held-out-provenance",
    status: "MISSING",
    requirement: "Verify held-out outcomes were not used for forecast, policy, probe, or evaluator tuning.",
    sourceIds: ["fixed-heldout-partition", "heldout-dataset-lineage"],
    detail: "The fixed partition label has no dataset lineage or tuning history bound to the outcomes.",
    evidenceRefs: [],
  },
  {
    id: "forecast-and-policy-freeze",
    status: "MISSING",
    requirement: "Verify the forecast, hypothesis, decision mapping, probe, evaluator, policy, and scope were frozen before outcomes.",
    sourceIds: ["protocol-manifest", "p75-review-approval-record"],
    detail: "Current protocol hashes identify versions but do not prove a trusted, immutable pre-outcome freeze.",
    evidenceRefs: [],
  },
  {
    id: "evaluator-applicability",
    status: "MISSING",
    requirement: "Obtain an independent review of sample sufficiency and evaluator limitations.",
    sourceIds: ["protocol-manifest", "p75-review-approval-record"],
    detail: "Evaluator version identity is recorded, but no authorized reviewer has assessed applicability or sample sufficiency.",
    evidenceRefs: [],
  },
];

export function buildRuntimeStartHypothesisTrustBoundary(): RuntimeStartHypothesisTrustBoundary {
  return {
    sources: TRUST_SOURCES.map((source) => ({ ...source })),
    checks: TRUST_CHECKS.map((check) => ({
      ...check,
      sourceIds: [...check.sourceIds],
      evidenceRefs: [...check.evidenceRefs],
    })),
  };
}

export function runtimeStartHypothesisTrustBoundaryBlockers(
  boundary: RuntimeStartHypothesisTrustBoundary,
): string[] {
  const sourcesById = new Map(boundary.sources.map((source) => [source.id, source]));
  const blockers = boundary.checks.flatMap((check) => {
    if (
      check.status === "MISSING"
      || check.status === "UNVERIFIABLE"
      || check.status === "CONFLICTING"
      || check.status === "OUT_OF_SCOPE"
    ) {
      return [`trust-boundary:${check.id}:${check.status.toLowerCase()}`];
    }
    if (
      check.status === "SERVER_VERIFIED"
      || check.status === "HUMAN_REVIEW_REQUIRED"
    ) {
      const hasBoundEvidence = check.evidenceRefs.length > 0
        && check.evidenceRefs.every((evidence) => {
          const source = sourcesById.get(evidence.sourceId);
          return check.sourceIds.includes(evidence.sourceId)
            && source?.availability === "present"
            && evidence.ref.trim().length > 0
            && /^[a-f0-9]{64}$/.test(evidence.hash);
        });
      if (!hasBoundEvidence) {
        return [`trust-boundary:${check.id}:evidence-unbound`];
      }
    }
    return [];
  });
  return blockers.sort();
}

export function runtimeStartHypothesisTrustBoundaryReviewRequired(
  boundary: RuntimeStartHypothesisTrustBoundary,
): string[] {
  return boundary.checks
    .filter((check) => check.status === "HUMAN_REVIEW_REQUIRED")
    .map((check) => `trust-boundary:${check.id}:human-review-required`)
    .sort();
}

export function runtimeStartHypothesisTrustBoundaryStatus(
  boundary: RuntimeStartHypothesisTrustBoundary,
): "verified" | "review_required" | "blocked" {
  if (runtimeStartHypothesisTrustBoundaryBlockers(boundary).length > 0) {
    return "blocked";
  }
  if (runtimeStartHypothesisTrustBoundaryReviewRequired(boundary).length > 0) {
    return "review_required";
  }
  return "verified";
}