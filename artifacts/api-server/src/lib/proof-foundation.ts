import { and, desc, eq } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";
import {
  parseExecutionProofProjection,
  type ExecutionProofProjection,
} from "./execution-proof.js";
import {
  aggregateDelegatedExecutionSummary,
  type DelegatedExecutionSummary,
} from "./execution-lineage.js";

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
  | "execution_identity_mismatch"
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
  | "delivery_not_proven"
  | "delivery_identity_missing"
  | "delivery_identity_mismatch";

export type CanonicalProofScope = {
  projectId: string;
  missionId?: string | null;
  goalId?: string | null;
  executionId?: string | null;
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
  executionId?: string | null;
  attempt?: number | null;
  operationId?: string | null;
  sourceRevision?: string | null;
  candidateTreeHash?: string | null;
  treeHash?: string | null;
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
  attempt: number | null;
  operationId: string | null;
  delivery: CanonicalProofDelivery | null;
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
    if (!input.scope.executionId) {
      addReason(reasons, "missing_goal_acceptance_projection");
    }
  }
  if (!execution) addReason(reasons, "missing_execution");
  if (!acceptance) addReason(reasons, "missing_acceptance");

  if (execution && execution.projectId !== input.scope.projectId) {
    addReason(reasons, "execution_project_mismatch");
  }
  if (
    execution
    && input.scope.executionId
    && execution.id !== input.scope.executionId
  ) {
    addReason(reasons, "execution_identity_mismatch");
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
    const delivery = input.deliveryReceipt;
    const deliveryStatus = delivery?.status;
    if (!["PROVEN", "completed", "succeeded"].includes(String(deliveryStatus))) {
      addReason(reasons, "delivery_not_proven");
    } else if (
      !delivery
      || delivery.executionId !== execution?.id
      || delivery.attempt !== execution?.attempt
      || delivery.operationId !== (execution?.operationId ?? input.scope.operationId ?? null)
      || delivery.sourceRevision !== acceptedSourceRevision
      || !delivery.candidateTreeHash
      || !delivery.treeHash
    ) {
      addReason(reasons, "delivery_identity_missing");
      if (
        delivery
        && (
          delivery.executionId !== execution?.id
          || delivery.attempt !== execution?.attempt
          || delivery.operationId !== (execution?.operationId ?? input.scope.operationId ?? null)
          || delivery.sourceRevision !== acceptedSourceRevision
          || (expectedCandidateIdentity && delivery.candidateTreeHash !== expectedCandidateIdentity)
        )
      ) {
        addReason(reasons, "delivery_identity_mismatch");
      }
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
    attempt: execution?.attempt ?? acceptance?.attempt ?? null,
    operationId: execution?.operationId ?? acceptance?.operationId ?? null,
    delivery: input.deliveryReceipt ?? null,
    projection,
    trajectoryDigest: projection?.trajectoryDigest ?? null,
  };
}

export type PublicCanonicalProofProjection = {
  contractVersion: typeof CANONICAL_PROOF_CONTRACT_VERSION;
  verdict: CanonicalProofVerdict;
  accepted: boolean;
  failureReasons: CanonicalProofFailureReason[];
  executionId: string | null;
  acceptanceId: string | null;
  attempt: number | null;
  operationId: string | null;
  evidenceSnapshotId: string | null;
  sourceRevision: string | null;
  candidateIdentity: string | null;
  candidateTreeHash: string | null;
  treeHash: string | null;
};

export function projectCanonicalProof(
  proof: CanonicalProof,
): PublicCanonicalProofProjection {
  return {
    contractVersion: proof.contractVersion,
    verdict: proof.verdict,
    accepted: proof.accepted,
    failureReasons: proof.failureReasons.slice(0, 8),
    executionId: proof.executionId,
    acceptanceId: proof.acceptanceId,
    attempt: proof.attempt,
    operationId: proof.operationId,
    evidenceSnapshotId: proof.evidenceSnapshotId,
    sourceRevision: proof.sourceRevision,
    candidateIdentity: proof.candidateIdentity,
    candidateTreeHash: proof.delivery?.candidateTreeHash
      ?? proof.candidateIdentity,
    treeHash: proof.delivery?.treeHash ?? null,
  };
}

type CanonicalProofTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CanonicalProofLoadInput = {
  tx: CanonicalProofTransaction;
  executionId: string;
  scope: CanonicalProofScope;
  goalStatus: string;
  deliveryRequired?: boolean;
  /**
   * Legacy projection input. It is intentionally ignored by the loader.
   * Delivery identity must come from the locked execution row.
   */
  deliveryReceipt?: CanonicalProofDelivery | null;
  attempt?: number;
};

function durableDeliveryReceipt(
  execution: { recipeReceipt?: unknown },
): CanonicalProofDelivery | null {
  const raw = execution.recipeReceipt;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const receipt = raw as Record<string, unknown>;
  return {
    status: receipt.status,
    executionId: typeof receipt.executionId === "string" ? receipt.executionId : null,
    attempt: typeof receipt.attempt === "number" ? receipt.attempt : null,
    operationId: typeof receipt.operationId === "string" ? receipt.operationId : null,
    sourceRevision: typeof receipt.sourceRevision === "string"
      ? receipt.sourceRevision
      : null,
    candidateTreeHash: typeof receipt.candidateTreeHash === "string"
      ? receipt.candidateTreeHash
      : null,
    treeHash: typeof receipt.treeHash === "string" ? receipt.treeHash : null,
  };
}

/**
 * Load and lock the durable rows that compose a canonical proof.
 *
 * Callers use this instead of trusting a serialized acceptance/projection.
 * The pure composer remains useful for unit tests, while all runtime
 * decisions should enter through this row-loading boundary.
 */
export async function loadCanonicalProof(
  input: CanonicalProofLoadInput,
): Promise<CanonicalProof> {
  const [execution] = await input.tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.scope.projectId),
    ))
    .for("update");

  if (!execution) {
    return composeCanonicalProof({
      scope: {
        ...input.scope,
        executionId: input.executionId,
      },
      goalStatus: input.goalStatus,
      deliveryRequired: input.deliveryRequired,
      deliveryReceipt: null,
      execution: null,
      acceptance: null,
      evidence: null,
    });
  }

  const attempt = input.attempt ?? execution.attempt;
  const [acceptance] = await input.tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.projectId, input.scope.projectId),
      eq(aiExecutionAcceptancesTable.attempt, attempt),
    ))
    .orderBy(desc(aiExecutionAcceptancesTable.createdAt))
    .for("update")
    .limit(1);

  const [evidence] = acceptance?.evidenceSnapshotId
    ? await input.tx
      .select()
      .from(aiExecutionEvidenceSnapshotsTable)
      .where(and(
        eq(aiExecutionEvidenceSnapshotsTable.id, acceptance.evidenceSnapshotId),
        eq(aiExecutionEvidenceSnapshotsTable.executionId, execution.id),
        eq(aiExecutionEvidenceSnapshotsTable.projectId, input.scope.projectId),
        eq(aiExecutionEvidenceSnapshotsTable.attempt, attempt),
      ))
      .for("update")
      .limit(1)
    : [];

  return composeCanonicalProof({
    scope: {
      ...input.scope,
      executionId: input.executionId,
    },
    goalStatus: input.goalStatus,
    deliveryRequired: input.deliveryRequired,
    deliveryReceipt: durableDeliveryReceipt(execution),
    execution: {
      id: execution.id,
      projectId: execution.projectId,
      goalId: execution.goalId,
      operationId: execution.operationId,
      attempt: execution.attempt,
      baseRevision: execution.baseRevision,
    },
    acceptance: acceptance
      ? {
          id: acceptance.id,
          executionId: acceptance.executionId,
          projectId: acceptance.projectId,
          attempt: acceptance.attempt,
          operationId: acceptance.operationId,
          terminalStatus: acceptance.terminalStatus,
          outcome: acceptance.outcome,
          evidenceSnapshotId: acceptance.evidenceSnapshotId,
          evidenceRequired: acceptance.evidenceRequired === 1,
          evidenceComplete: acceptance.evidenceComplete === 1,
          sourceRevision: acceptance.sourceRevision,
          candidateIdentity: acceptance.candidateIdentity,
          disposition: acceptance.disposition,
        }
      : null,
    evidence: evidence
      ? {
          id: evidence.id,
          executionId: evidence.executionId,
          projectId: evidence.projectId,
          attempt: evidence.attempt,
          sourceRevision: evidence.sourceRevision,
          candidateIdentity: evidence.candidateIdentity,
          complete: evidence.complete === 1,
          verdict: evidence.verdict,
        }
      : null,
  });
}

export type CanonicalDelegationProof = {
  contractVersion: typeof CANONICAL_PROOF_CONTRACT_VERSION;
  parentExecutionId: string;
  delegationId: string | null;
  verdict: CanonicalProofVerdict;
  accepted: boolean;
  failureReasons: CanonicalProofFailureReason[];
  summary: DelegatedExecutionSummary;
  childProofs: Array<{
    executionId: string;
    attempt: number;
    proof: CanonicalProof;
  }>;
};

/**
 * Aggregate delegated children through the same canonical proof loader used
 * for ordinary executions. This is intentionally read/lock/compose in one
 * transaction so a parent cannot observe a child proof from a newer attempt.
 */
export async function loadCanonicalDelegationProof(input: {
  tx: CanonicalProofTransaction;
  parentExecutionId: string;
  scope: CanonicalProofScope;
  goalStatus: string;
}): Promise<CanonicalDelegationProof> {
  const [parent] = await input.tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, input.parentExecutionId),
      eq(aiExecutionsTable.projectId, input.scope.projectId),
    ))
    .for("update");
  if (!parent) {
    return {
      contractVersion: CANONICAL_PROOF_CONTRACT_VERSION,
      parentExecutionId: input.parentExecutionId,
      delegationId: null,
      verdict: "UNAVAILABLE",
      accepted: false,
      failureReasons: ["missing_execution"],
      summary: aggregateDelegatedExecutionSummary([]),
      childProofs: [],
    };
  }

  const children = await input.tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.parentExecutionId, parent.id),
      eq(aiExecutionsTable.projectId, parent.projectId),
    ))
    .for("update");
  const childProofs: CanonicalDelegationProof["childProofs"] = [];
  for (const child of children) {
    const proof = await loadCanonicalProof({
      tx: input.tx,
      executionId: child.id,
      scope: {
        ...input.scope,
        executionId: child.id,
        goalId: child.goalId,
        operationId: child.operationId,
        sourceRevision: child.baseRevision,
      },
      goalStatus: child.status,
    });
    childProofs.push({
      executionId: child.id,
      attempt: child.attempt,
      proof,
    });
  }
  const summary = aggregateDelegatedExecutionSummary(children.map((child) => ({
    status: child.status,
    checkpoint: child.checkpoint,
    acceptance: childProofs.find((item) => item.executionId === child.id)?.proof.acceptanceId
      ? { outcome: childProofs.find((item) => item.executionId === child.id)?.proof.accepted ? "SUCCEEDED" : "FAILED" }
      : null,
  })));
  const failureReasons = childProofs.flatMap((item) => item.proof.failureReasons);
  const uniqueFailureReasons = [...new Set(failureReasons)].slice(0, 16);
  return {
    contractVersion: CANONICAL_PROOF_CONTRACT_VERSION,
    parentExecutionId: parent.id,
    delegationId: parent.delegationId,
    verdict: summary.verdict,
    accepted: summary.verdict === "PROVEN" && childProofs.every((item) => item.proof.accepted),
    failureReasons: uniqueFailureReasons,
    summary,
    childProofs,
  };
}