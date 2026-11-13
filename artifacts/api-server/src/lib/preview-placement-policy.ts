import {
  isVerifiedPreviewRunnerCapabilityV1,
  type VerifiedPreviewRunnerCapabilityV1,
} from "@workspace/preview-runner-contract";
import {
  previewRunnerQualificationRegistry,
  type PreviewRunnerQualificationRecordV1,
} from "./preview-runner-qualification.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_FRESHNESS_WINDOW_MS = 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 5_000;

export const PREVIEW_PLACEMENT_POLICY_VERSION = "preview-placement-v1";

export type PreviewPlacementMode =
  | "local_only"
  | "local_preferred"
  | "cloud_allowed";

export type PreviewPlacementCandidate = {
  projectId: string;
  proposalId: string;
  operationId: string | null;
  proposalRevision: number;
  candidateRevision: string | null;
  changeSetHash: string | null;
  status: string;
  lifecycle: string | null;
};

export type PreviewPlacementCandidateBinding = {
  projectId: string;
  proposalId: string;
  operationId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
};

export type PreviewPlacementRequirements = {
  runtimeProfileDigest: string;
  sandboxPolicyDigest: string;
  requiredIsolationClass: "syscall_sandbox" | "microvm";
  requiredEvidenceMode: "local_observed" | "remote_attested";
};

export type PreviewPlacementRunnerSnapshot = {
  nodeId: string;
  projectId: string;
  status: "pending" | "active" | "revoked";
  lastSeenAt: Date | null;
  capabilityExpiresAt: Date | null;
  capability: VerifiedPreviewRunnerCapabilityV1 | null;
};

export type PreviewPlacementDecision =
  | {
      policyVersion: typeof PREVIEW_PLACEMENT_POLICY_VERSION;
      candidate: PreviewPlacementCandidateBinding;
      outcome: "selected";
      provider: "local";
      nodeId: string;
      reason: "qualified_local_runner_available";
      executionAuthorized: false;
    }
  | {
      policyVersion: typeof PREVIEW_PLACEMENT_POLICY_VERSION;
      candidate: PreviewPlacementCandidateBinding;
      outcome: "selected";
      provider: "cloud";
      reason: "approved_cloud_fallback";
      executionAuthorized: false;
    }
  | {
      policyVersion: typeof PREVIEW_PLACEMENT_POLICY_VERSION;
      candidate: PreviewPlacementCandidateBinding;
      outcome: "waiting" | "blocked";
      provider: null;
      reason:
        | "candidate_not_current"
        | "local_runner_unavailable"
        | "cloud_not_configured"
        | "cloud_approval_required"
        | "cloud_cost_policy_rejected";
      executionAuthorized: false;
    };

export class PreviewPlacementPolicyError extends Error {
  constructor() {
    super("Preview placement policy input is invalid.");
    this.name = "PreviewPlacementPolicyError";
  }
}

type QualificationLookup = {
  get(
    qualificationRecordId: string,
  ): PreviewRunnerQualificationRecordV1 | undefined;
};

function validCandidateShape(
  candidate: PreviewPlacementCandidate,
): candidate is PreviewPlacementCandidate & {
  operationId: string;
  candidateRevision: string;
  changeSetHash: string;
} {
  return (
    typeof candidate.projectId === "string" &&
    candidate.projectId.trim().length > 0 &&
    candidate.projectId.length <= 255 &&
    typeof candidate.proposalId === "string" &&
    candidate.proposalId.trim().length > 0 &&
    candidate.proposalId.length <= 255 &&
    typeof candidate.operationId === "string" &&
    candidate.operationId.trim().length > 0 &&
    candidate.operationId.length <= 255 &&
    Number.isSafeInteger(candidate.proposalRevision) &&
    candidate.proposalRevision >= 0 &&
    typeof candidate.candidateRevision === "string" &&
    HASH_PATTERN.test(candidate.candidateRevision) &&
    typeof candidate.changeSetHash === "string" &&
    HASH_PATTERN.test(candidate.changeSetHash)
  );
}

function candidateCanRun(
  candidate: PreviewPlacementCandidate,
): boolean {
  return (
    candidate.status === "pending" &&
    (candidate.lifecycle === "isolated" ||
      candidate.lifecycle === "validated")
  );
}

type PreviewPlacementCandidateIdentity = Pick<
  PreviewPlacementCandidate,
  | "projectId"
  | "proposalId"
  | "operationId"
  | "proposalRevision"
  | "candidateRevision"
  | "changeSetHash"
>;

function sameCandidate(
  left: PreviewPlacementCandidateIdentity,
  right: PreviewPlacementCandidateIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.proposalId === right.proposalId &&
    left.operationId === right.operationId &&
    left.proposalRevision === right.proposalRevision &&
    left.candidateRevision?.toLowerCase() ===
      right.candidateRevision?.toLowerCase() &&
    left.changeSetHash?.toLowerCase() ===
      right.changeSetHash?.toLowerCase()
  );
}

function bindCandidate(
  candidate: PreviewPlacementCandidate & {
    operationId: string;
    candidateRevision: string;
    changeSetHash: string;
  },
): PreviewPlacementCandidateBinding {
  return {
    projectId: candidate.projectId,
    proposalId: candidate.proposalId,
    operationId: candidate.operationId,
    proposalRevision: candidate.proposalRevision,
    candidateRevision: candidate.candidateRevision.toLowerCase(),
    changeSetHash: candidate.changeSetHash.toLowerCase(),
  };
}

function isFreshDate(
  value: Date | null,
  now: Date,
  freshnessWindowMs: number,
): boolean {
  if (!value || !Number.isFinite(value.getTime())) return false;
  const age = now.getTime() - value.getTime();
  return age >= -CLOCK_SKEW_MS && age <= freshnessWindowMs;
}

function isQualifiedRunnerEligible(input: {
  runner: PreviewPlacementRunnerSnapshot;
  projectId: string;
  requirements: PreviewPlacementRequirements;
  now: Date;
  freshnessWindowMs: number;
  qualificationFor: QualificationLookup["get"];
}): boolean {
  const { runner, requirements, now, freshnessWindowMs } = input;
  const capability = runner.capability;
  if (
    runner.projectId !== input.projectId ||
    runner.status !== "active" ||
    !isFreshDate(runner.lastSeenAt, now, freshnessWindowMs) ||
    !capability ||
    !isVerifiedPreviewRunnerCapabilityV1(capability) ||
    capability.nodeId !== runner.nodeId ||
    !isFreshDate(
      new Date(capability.observedAt),
      now,
      freshnessWindowMs,
    ) ||
    Date.parse(capability.expiresAt) <= now.getTime() ||
    !runner.capabilityExpiresAt ||
    !Number.isFinite(runner.capabilityExpiresAt.getTime()) ||
    runner.capabilityExpiresAt.getTime() !== Date.parse(capability.expiresAt)
  ) {
    return false;
  }

  const qualification = input.qualificationFor(
    capability.qualificationRecordId,
  );
  if (!qualification) return false;

  return (
    qualification.qualificationRecordId ===
      capability.qualificationRecordId &&
    qualification.agentVersion === capability.agentVersion &&
    qualification.sandboxProviderId === capability.sandboxProviderId &&
    qualification.sandboxRuntimeVersion ===
      capability.sandboxRuntimeVersion &&
    qualification.isolationClass === requirements.requiredIsolationClass &&
    capability.isolationClass === requirements.requiredIsolationClass &&
    qualification.runtimeProfileDigest.toLowerCase() ===
      requirements.runtimeProfileDigest.toLowerCase() &&
    capability.runtimeProfileDigest.toLowerCase() ===
      requirements.runtimeProfileDigest.toLowerCase() &&
    qualification.sandboxPolicyDigest.toLowerCase() ===
      requirements.sandboxPolicyDigest.toLowerCase() &&
    capability.sandboxPolicyDigest.toLowerCase() ===
      requirements.sandboxPolicyDigest.toLowerCase() &&
    qualification.evidenceMode === requirements.requiredEvidenceMode &&
    capability.evidenceMode === requirements.requiredEvidenceMode
  );
}

export function evaluatePreviewPlacement(input: {
  mode: PreviewPlacementMode;
  requestedCandidate: PreviewPlacementCandidate;
  currentCandidate: PreviewPlacementCandidate;
  requirements: PreviewPlacementRequirements;
  localRunners: readonly PreviewPlacementRunnerSnapshot[];
  now: Date;
  freshnessWindowMs: number;
  cloud: {
    configured: boolean;
    userApproved: boolean;
    costPolicyAllows: boolean;
  };
  qualificationFor?: QualificationLookup["get"];
}): PreviewPlacementDecision {
  if (
    !validCandidateShape(input.requestedCandidate) ||
    !validCandidateShape(input.currentCandidate) ||
    !["local_only", "local_preferred", "cloud_allowed"].includes(input.mode) ||
    !HASH_PATTERN.test(input.requirements.runtimeProfileDigest) ||
    !HASH_PATTERN.test(input.requirements.sandboxPolicyDigest) ||
    !["syscall_sandbox", "microvm"].includes(
      input.requirements.requiredIsolationClass,
    ) ||
    !["local_observed", "remote_attested"].includes(
      input.requirements.requiredEvidenceMode,
    ) ||
    !(input.now instanceof Date) ||
    !Number.isFinite(input.now.getTime()) ||
    !Number.isSafeInteger(input.freshnessWindowMs) ||
    input.freshnessWindowMs < 1 ||
    input.freshnessWindowMs > MAX_FRESHNESS_WINDOW_MS ||
    !Array.isArray(input.localRunners) ||
    input.localRunners.length > 1_000 ||
    typeof input.cloud.configured !== "boolean" ||
    typeof input.cloud.userApproved !== "boolean" ||
    typeof input.cloud.costPolicyAllows !== "boolean"
  ) {
    throw new PreviewPlacementPolicyError();
  }

  const candidate = bindCandidate(input.requestedCandidate);
  const blocked = (
    reason: Extract<
      PreviewPlacementDecision,
      { outcome: "blocked" | "waiting" }
    >["reason"],
    outcome: "blocked" | "waiting",
  ): PreviewPlacementDecision => ({
    policyVersion: PREVIEW_PLACEMENT_POLICY_VERSION,
    candidate,
    outcome,
    provider: null,
    reason,
    executionAuthorized: false,
  });

  if (
    !candidateCanRun(input.requestedCandidate) ||
    !candidateCanRun(input.currentCandidate) ||
    !sameCandidate(input.requestedCandidate, input.currentCandidate)
  ) {
    return blocked("candidate_not_current", "blocked");
  }

  const qualificationFor =
    input.qualificationFor ??
    previewRunnerQualificationRegistry.get.bind(
      previewRunnerQualificationRegistry,
    );
  const eligibleNode = [...input.localRunners]
    .filter((runner) =>
      isQualifiedRunnerEligible({
        runner,
        projectId: candidate.projectId,
        requirements: input.requirements,
        now: input.now,
        freshnessWindowMs: input.freshnessWindowMs,
        qualificationFor,
      }),
    )
    .map((runner) => runner.nodeId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0];

  if (eligibleNode) {
    return {
      policyVersion: PREVIEW_PLACEMENT_POLICY_VERSION,
      candidate,
      outcome: "selected",
      provider: "local",
      nodeId: eligibleNode,
      reason: "qualified_local_runner_available",
      executionAuthorized: false,
    };
  }

  if (input.mode === "local_only") {
    return blocked("local_runner_unavailable", "blocked");
  }
  if (input.mode === "local_preferred") {
    return blocked("local_runner_unavailable", "waiting");
  }
  if (!input.cloud.configured) {
    return blocked("cloud_not_configured", "waiting");
  }
  if (!input.cloud.userApproved) {
    return blocked("cloud_approval_required", "blocked");
  }
  if (!input.cloud.costPolicyAllows) {
    return blocked("cloud_cost_policy_rejected", "blocked");
  }

  return {
    policyVersion: PREVIEW_PLACEMENT_POLICY_VERSION,
    candidate,
    outcome: "selected",
    provider: "cloud",
    reason: "approved_cloud_fallback",
    executionAuthorized: false,
  };
}

export function isPreviewPlacementDecisionCurrent(input: {
  decision: PreviewPlacementDecision;
  currentCandidate: PreviewPlacementCandidate;
}): boolean {
  const { decision, currentCandidate } = input;
  return (
    decision.outcome === "selected" &&
    decision.policyVersion === PREVIEW_PLACEMENT_POLICY_VERSION &&
    validCandidateShape(currentCandidate) &&
    candidateCanRun(currentCandidate) &&
    sameCandidate(decision.candidate, currentCandidate)
  );
}
