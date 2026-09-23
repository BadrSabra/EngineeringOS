import {
  parseExecutionProofProjection,
  type ExecutionProofProjection,
} from "./execution-proof.js";

export const CANONICAL_PROOF_CONTRACT_VERSION = 1 as const;

export type CanonicalProofVerdict = "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";

export type CanonicalProofFailureReason =
  | "goal_not_completed"
  | "missing_goal_acceptance_projection"
  | "missing_execution"
  | "missing_acceptance"
  | "execution_project_mismatch"
  | "acceptance_project_mismatch"
  | "execution_goal_mismatch"
  | "execution_operation_mismatch"
  | "acceptance_execution_mismatch"
  | "acceptance_attempt_mismatch"
  | "plan_revision_mismatch"
  | "missing_source_revision"
  | "source_revision_mismatch"
  | "missing_candidate_identity"
  | "candidate_identity_mismatch"
  | "missing_evidence_snapshot"
  | "evidence_snapshot_mismatch"
  | "evidence_incomplete"
  | "evidence_unavailable"
  | "acceptance_not_succeeded"
  | "acceptance_not_completed"
  | "acceptance_proof_missing"
  | "acceptance_proof_not_proven"
  | "acceptance_proof_not_bound"
  | "delivery_not_proven";

export type CanonicalProofScope = {
  projectId: string;
  missionId?: string | null;
  goalId?: string | null;
  operationId?: string | null;
  planRevision?: string | null;
  activePlanRevision?: string | null;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
};

export type CanonicalProofExecution = {
  id: string;
  projectId: string;
  goalId?: string | null;
  operationId?: string | null;
  attempt: number;
  baseRevision?: string | null;
};

export type CanonicalProofAcceptance = {
  id: string;
  executionId: string;
  projectId: string;
  attempt: number;
  operationId?: string | null;
  terminalStatus: string;
  outcome: string;
  evidenceSnapshotId?: string | null;
  evidenceRequired: boolean;
  evidenceComplete: boolean;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  disposition?: unknown;
};

export type CanonicalProofEvidence = {
  id: string;
  executionId: string;
  projectId: string;
  attempt: number;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  complete: boolean;
  verdict: string;
};

export type CanonicalProofDelivery = {
  status?: unknown;
};

export type CanonicalProofInput = {
  scope: CanonicalProofScope;
  goalStatus: string;
  deliveryRequired?: boolean;
  deliveryReceipt?: CanonicalProofDelivery | null;
  execution?: CanonicalProofExecution | null;
  acceptance?: CanonicalProofAcceptance | null;
  evidence?: CanonicalProofEvidence | null;
};

export type CanonicalProof = {
  contractVersion: typeof CANONICAL_PROOF_CONTRACT_VERSION;
  verdict: CanonicalProofVerdict;
  accepted: boolean;
  failureReasons: CanonicalProofFailureReason[];
  scope: CanonicalProofScope;
  executionId: string | null;
  acceptanceId: string | null;
  evidenceSnapshotId: string | null;
  sourceRevision: string | null;
  candidateIdentity: string | null;
  projection: ExecutionProofProjection | null;
  trajectoryDigest: ExecutionProofProjection["trajectoryDigest"] | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function addReason(
  reasons: CanonicalProofFailureReason[],
  reason: CanonicalProofFailureReason,
): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function projectedProof(
  acceptance: CanonicalProofAcceptance | null | undefined,
): ExecutionProofProjection | null {
  if (!acceptance) return null;
  const disposition = acceptance.disposition;
  if (!disposition || typeof disposition !== "object" || Array.isArray(disposition)) {
    return null;
  }
  return parseExecutionProofProjection(
    (disposition as Record<string, unknown>).proof,
  ) ?? null;
}

/**
 * Compose the server-owned proof from the durable execution, acceptance,
 * evidence snapshot, and Goal scope. This is deliberately pure: callers must
 * load and lock the authoritative rows before invoking it.
 */
export function composeCanonicalProof(
  input: CanonicalProofInput,
): CanonicalProof {
  const reasons: CanonicalProofFailureReason[] = [];
  const execution = input.execution ?? null;
  const acceptance = input.acceptance ?? null;
  const evidence = input.evidence ?? null;
  const projection = projectedProof(acceptance);
  const executionSourceRevision = nonEmpty(execution?.baseRevision);
  const expectedSourceRevision = executionSourceRevision
    ?? nonEmpty(input.scope.sourceRevision);
  const acceptedSourceRevision = nonEmpty(acceptance?.sourceRevision);
  const expectedCandidateIdentity = nonEmpty(input.scope.candidateIdentity);
  const acceptedCandidateIdentity = nonEmpty(acceptance?.candidateIdentity);

  if (input.goalStatus !== "completed") addReason(reasons, "goal_not_completed");
  if (!input.scope.projectId.trim()) addReason(reasons, "acceptance_project_mismatch");
  if (!input.scope.goalId && !input.scope.missionId) {
    addReason(reasons, "missing_goal_acceptance_projection");
  }
  if (!execution) addReason(reasons, "missing_execution");
  if (!acceptance) addReason(reasons, "missing_acceptance");

  if (execution && execution.projectId !== input.scope.projectId) {
    addReason(reasons, "execution_project_mismatch");
  }
  if (acceptance && acceptance.projectId !== input.scope.projectId) {
    addReason(reasons, "acceptance_project_mismatch");
  }
  if (
    execution
    && input.scope.goalId
    && execution.goalId !== input.scope.goalId
  ) {
    addReason(reasons, "execution_goal_mismatch");
  }
  if (
    execution
    && input.scope.operationId
    && execution.operationId !== input.scope.operationId
  ) {
    addReason(reasons, "execution_operation_mismatch");
  }
  if (
    acceptance
    && input.scope.operationId
    && acceptance.operationId !== input.scope.operationId
  ) {
    addReason(reasons, "execution_operation_mismatch");
  }
  if (execution && acceptance && acceptance.executionId !== execution.id) {
    addReason(reasons, "acceptance_execution_mismatch");
  }
  if (execution && acceptance && acceptance.attempt !== execution.attempt) {
    addReason(reasons, "acceptance_attempt_mismatch");
  }
  if (
    execution
    && acceptance
    && execution.operationId
    && acceptance.operationId
    && execution.operationId !== acceptance.operationId
  ) {
    addReason(reasons, "execution_operation_mismatch");
  }

  if (
    input.scope.activePlanRevision
    && input.scope.planRevision !== input.scope.activePlanRevision
  ) {
    addReason(reasons, "plan_revision_mismatch");
  }
  if (input.scope.activePlanRevision && !input.scope.planRevision) {
    addReason(reasons, "plan_revision_mismatch");
  }
  if (
    input.scope.sourceRevision
    && executionSourceRevision
    && executionSourceRevision !== input.scope.sourceRevision
  ) {
    addReason(reasons, "source_revision_mismatch");
  }
  if (!expectedSourceRevision || !acceptedSourceRevision) {
    addReason(reasons, "missing_source_revision");
  } else if (acceptedSourceRevision !== expectedSourceRevision) {
    addReason(reasons, "source_revision_mismatch");
  }

  if (expectedCandidateIdentity && !acceptedCandidateIdentity) {
    addReason(reasons, "missing_candidate_identity");
  } else if (
    expectedCandidateIdentity
    && acceptedCandidateIdentity !== expectedCandidateIdentity
  ) {
    addReason(reasons, "candidate_identity_mismatch");
  }

  if (acceptance?.evidenceRequired) {
    if (!acceptance.evidenceSnapshotId) {
      addReason(reasons, "missing_evidence_snapshot");
    } else if (!evidence) {
      addReason(reasons, "missing_evidence_snapshot");
    } else {
      if (
        evidence.id !== acceptance.evidenceSnapshotId
        || evidence.executionId !== acceptance.executionId
        || evidence.projectId !== acceptance.projectId
        || evidence.attempt !== acceptance.attempt
      ) {
        addReason(reasons, "evidence_snapshot_mismatch");
      }
      if (!evidence.complete || !acceptance.evidenceComplete) {
        addReason(reasons, "evidence_incomplete");
      }
      if (evidence.verdict === "UNAVAILABLE") {
        addReason(reasons, "evidence_unavailable");
      }
      if (
        acceptedSourceRevision
        && nonEmpty(evidence.sourceRevision)
        && evidence.sourceRevision !== acceptedSourceRevision
      ) {
        addReason(reasons, "source_revision_mismatch");
      }
      if (
        acceptedCandidateIdentity
        && nonEmpty(evidence.candidateIdentity)
        && evidence.candidateIdentity !== acceptedCandidateIdentity
      ) {
        addReason(reasons, "candidate_identity_mismatch");
      }
    }
  } else if (!acceptance?.evidenceComplete) {
    addReason(reasons, "evidence_incomplete");
  }

  if (acceptance?.outcome !== "SUCCEEDED") {
    addReason(reasons, "acceptance_not_succeeded");
  }
  if (acceptance?.terminalStatus !== "completed") {
    addReason(reasons, "acceptance_not_completed");
  }
  if (!projection) {
    addReason(reasons, "acceptance_proof_missing");
  } else {
    if (projection.verdict !== "PROVEN") {
      addReason(reasons, "acceptance_proof_not_proven");
    }
    if (
      acceptance
      && (
        projection.evidenceRequired !== acceptance.evidenceRequired
        || projection.evidenceComplete !== acceptance.evidenceComplete
        || projection.evidenceSnapshotId !== (acceptance.evidenceSnapshotId ?? null)
        || projection.candidateBound !== Boolean(acceptedCandidateIdentity)
      )
    ) {
      addReason(reasons, "acceptance_proof_not_bound");
    }
    if (
      !projection.evidenceComplete
      || !projection.sourceBound
      || (expectedCandidateIdentity && !projection.candidateBound)
    ) {
      addReason(reasons, "acceptance_proof_not_bound");
    }
  }

  if (input.deliveryRequired) {
    const deliveryStatus = input.deliveryReceipt?.status;
    if (!["PROVEN", "completed", "succeeded"].includes(String(deliveryStatus))) {
      addReason(reasons, "delivery_not_proven");
    }
  }

  const accepted = reasons.length === 0;
  const verdict: CanonicalProofVerdict = accepted
    ? "PROVEN"
    : projection?.verdict === "UNAVAILABLE"
      || reasons.some((reason) =>
        reason === "missing_execution"
        || reason === "missing_acceptance"
        || reason === "acceptance_proof_missing"
        || reason === "evidence_unavailable"
      )
      ? "UNAVAILABLE"
      : "INCOMPLETE";

  return {
    contractVersion: CANONICAL_PROOF_CONTRACT_VERSION,
    verdict,
    accepted,
    failureReasons: reasons,
    scope: input.scope,
    executionId: execution?.id ?? null,
    acceptanceId: acceptance?.id ?? null,
    evidenceSnapshotId: acceptance?.evidenceSnapshotId ?? null,
    sourceRevision: acceptedSourceRevision,
    candidateIdentity: acceptedCandidateIdentity,
    projection,
    trajectoryDigest: projection?.trajectoryDigest ?? null,
  };
}