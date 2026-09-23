import { describe, expect, it } from "vitest";
import {
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
} from "@workspace/db";
import { buildExecutionProofProjection } from "./execution-proof.js";
import {
  composeCanonicalProof,
  loadCanonicalProof,
  type CanonicalProofAcceptance,
  type CanonicalProofEvidence,
  type CanonicalProofExecution,
} from "./proof-foundation.js";

function fakeTransaction(rows: {
  execution: Record<string, unknown>;
  acceptance: Record<string, unknown>;
  evidence: Record<string, unknown>;
}) {
  const rowsForTable = (table: unknown) => {
    if (table === aiExecutionsTable) return [rows.execution];
    if (table === aiExecutionAcceptancesTable) return [rows.acceptance];
    if (table === aiExecutionEvidenceSnapshotsTable) return [rows.evidence];
    return [];
  };
  const query = (table: unknown) => {
    const result = Promise.resolve(rowsForTable(table));
    return Object.assign(result, {
      for: () => result,
      orderBy: () => result,
      limit: () => result,
    });
  };
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => query(table),
      }),
    }),
  } as never;
}

function fixture(overrides: {
  execution?: Partial<CanonicalProofExecution>;
  acceptance?: Partial<CanonicalProofAcceptance>;
  evidence?: Partial<CanonicalProofEvidence> | null;
  scope?: Record<string, unknown>;
  goalStatus?: string;
  deliveryRequired?: boolean;
  deliveryReceipt?: { status?: unknown } | null;
} = {}) {
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId: "snapshot-1",
    sourceRevision: "revision-1",
    candidateIdentity: "candidate-1",
  });
  const execution: CanonicalProofExecution = {
    id: "execution-1",
    projectId: "project-1",
    goalId: "goal-1",
    operationId: "operation-1",
    attempt: 2,
    baseRevision: "revision-1",
    ...overrides.execution,
  };
  const acceptance: CanonicalProofAcceptance = {
    id: "acceptance-1",
    executionId: "execution-1",
    projectId: "project-1",
    attempt: 2,
    operationId: "operation-1",
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    evidenceSnapshotId: "snapshot-1",
    evidenceRequired: true,
    evidenceComplete: true,
    sourceRevision: "revision-1",
    candidateIdentity: "candidate-1",
    disposition: { proof },
    ...overrides.acceptance,
  };
  const evidence: CanonicalProofEvidence | null = overrides.evidence === null
    ? null
    : {
        id: "snapshot-1",
        executionId: "execution-1",
        projectId: "project-1",
        attempt: 2,
        sourceRevision: "revision-1",
        candidateIdentity: "candidate-1",
        complete: true,
        verdict: "PROVEN",
        ...overrides.evidence,
      };

  return composeCanonicalProof({
    scope: {
      projectId: "project-1",
      missionId: "mission-1",
      goalId: "goal-1",
      operationId: "operation-1",
      planRevision: "plan-1",
      activePlanRevision: "plan-1",
      candidateIdentity: "candidate-1",
      ...overrides.scope,
    },
    goalStatus: overrides.goalStatus ?? "completed",
    deliveryRequired: overrides.deliveryRequired,
    deliveryReceipt: overrides.deliveryReceipt,
    execution,
    acceptance,
    evidence,
  });
}

describe("composeCanonicalProof", () => {
  it("accepts one bound proven execution as the canonical proof", () => {
    const result = fixture();

    expect(result).toMatchObject({
      contractVersion: 1,
      verdict: "PROVEN",
      accepted: true,
      executionId: "execution-1",
      acceptanceId: "acceptance-1",
      evidenceSnapshotId: "snapshot-1",
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
      failureReasons: [],
    });
    expect(result.trajectoryDigest).toEqual(result.projection?.trajectoryDigest);
  });

  it("rejects mismatched execution, acceptance, source, and candidate identities", () => {
    const result = fixture({
      execution: {
        projectId: "other-project",
        goalId: "other-goal",
        operationId: "other-operation",
        baseRevision: "revision-2",
      },
      acceptance: {
        executionId: "other-execution",
        projectId: "other-project",
        operationId: "other-operation",
        sourceRevision: "revision-3",
        candidateIdentity: "candidate-2",
      },
      evidence: {
        executionId: "other-execution",
        projectId: "other-project",
        sourceRevision: "revision-3",
        candidateIdentity: "candidate-2",
      },
      scope: {
        operationId: "operation-1",
        sourceRevision: "revision-1",
        candidateIdentity: "candidate-1",
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.failureReasons).toEqual(expect.arrayContaining([
      "execution_project_mismatch",
      "acceptance_project_mismatch",
      "execution_goal_mismatch",
      "execution_operation_mismatch",
      "acceptance_execution_mismatch",
      "source_revision_mismatch",
      "candidate_identity_mismatch",
    ]));
  });

  it("keeps incomplete evidence incomplete even when the provider projection says proven", () => {
    const result = fixture({
      evidence: {
        complete: false,
        verdict: "PARTIAL",
      },
      acceptance: {
        evidenceComplete: false,
      },
    });

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.failureReasons).toEqual(expect.arrayContaining([
      "evidence_incomplete",
      "acceptance_proof_not_bound",
    ]));
  });

  it("requires delivery proof for delivery goals", () => {
    const result = fixture({
      deliveryRequired: true,
      deliveryReceipt: { status: "pending" },
    });

    expect(result.accepted).toBe(false);
    expect(result.failureReasons).toContain("delivery_not_proven");
  });

  it("rejects stale plan revisions and missing candidate binding", () => {
    const result = fixture({
      scope: {
        activePlanRevision: "new-plan",
        candidateIdentity: "candidate-expected",
      },
      acceptance: {
        candidateIdentity: null,
      },
    });

    expect(result.failureReasons).toEqual(expect.arrayContaining([
      "plan_revision_mismatch",
      "missing_candidate_identity",
      "acceptance_proof_not_bound",
    ]));
  });

  it("loads the current durable execution attempt before composing proof", async () => {
    const projected = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: "snapshot-1",
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
    });
    const result = await loadCanonicalProof({
      tx: fakeTransaction({
        execution: {
          id: "execution-1",
          projectId: "project-1",
          goalId: null,
          operationId: "operation-1",
          attempt: 2,
          baseRevision: "revision-1",
          recipeReceipt: {
            status: "completed",
            executionId: "execution-1",
            attempt: 2,
            operationId: "operation-1",
            sourceRevision: "revision-1",
            candidateTreeHash: "candidate-1",
            treeHash: "tree-1",
          },
        },
        acceptance: {
          id: "acceptance-1",
          executionId: "execution-1",
          projectId: "project-1",
          attempt: 2,
          operationId: "operation-1",
          terminalStatus: "completed",
          outcome: "SUCCEEDED",
          evidenceSnapshotId: "snapshot-1",
          evidenceRequired: 1,
          evidenceComplete: 1,
          sourceRevision: "revision-1",
          candidateIdentity: "candidate-1",
          disposition: { proof: projected },
          createdAt: new Date(),
        },
        evidence: {
          id: "snapshot-1",
          executionId: "execution-1",
          projectId: "project-1",
          attempt: 2,
          sourceRevision: "revision-1",
          candidateIdentity: "candidate-1",
          complete: 1,
          verdict: "PROVEN",
        },
      }),
      executionId: "execution-1",
      scope: {
        projectId: "project-1",
        executionId: "execution-1",
        operationId: "operation-1",
        sourceRevision: "revision-1",
        candidateIdentity: "candidate-1",
      },
      goalStatus: "completed",
    });

    expect(result).toMatchObject({
      accepted: true,
      verdict: "PROVEN",
      executionId: "execution-1",
      acceptanceId: "acceptance-1",
      evidenceSnapshotId: "snapshot-1",
    });
  });

  it("ignores caller delivery projections and trusts the locked execution receipt", async () => {
    const projected = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: "snapshot-1",
      sourceRevision: "revision-1",
      candidateIdentity: "candidate-1",
    });
    const result = await loadCanonicalProof({
      tx: fakeTransaction({
        execution: {
          id: "execution-1",
          projectId: "project-1",
          goalId: null,
          operationId: "operation-1",
          attempt: 2,
          baseRevision: "revision-1",
          recipeReceipt: {
            status: "pending",
            executionId: "execution-1",
            attempt: 2,
            operationId: "operation-1",
            sourceRevision: "revision-1",
            candidateTreeHash: "candidate-1",
            treeHash: null,
          },
        },
        acceptance: {
          id: "acceptance-1",
          executionId: "execution-1",
          projectId: "project-1",
          attempt: 2,
          operationId: "operation-1",
          terminalStatus: "completed",
          outcome: "SUCCEEDED",
          evidenceSnapshotId: "snapshot-1",
          evidenceRequired: 1,
          evidenceComplete: 1,
          sourceRevision: "revision-1",
          candidateIdentity: "candidate-1",
          disposition: { proof: projected },
          createdAt: new Date(),
        },
        evidence: {
          id: "snapshot-1",
          executionId: "execution-1",
          projectId: "project-1",
          attempt: 2,
          sourceRevision: "revision-1",
          candidateIdentity: "candidate-1",
          complete: 1,
          verdict: "PROVEN",
        },
      }),
      executionId: "execution-1",
      scope: {
        projectId: "project-1",
        executionId: "execution-1",
        operationId: "operation-1",
        sourceRevision: "revision-1",
        candidateIdentity: "candidate-1",
      },
      goalStatus: "completed",
      deliveryRequired: true,
      deliveryReceipt: {
        status: "completed",
        executionId: "execution-1",
        attempt: 2,
        operationId: "operation-1",
        sourceRevision: "revision-1",
        candidateTreeHash: "candidate-1",
        treeHash: "tree-forged-by-caller",
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.failureReasons).toContain("delivery_not_proven");
    expect(result.delivery?.status).toBe("pending");
    expect(result.delivery?.treeHash).toBeNull();
  });
});