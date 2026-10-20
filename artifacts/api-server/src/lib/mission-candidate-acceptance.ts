import { and, desc, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
} from "@workspace/db";
import { loadCanonicalProof } from "./proof-foundation.js";

type MissionCandidateAcceptanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionCandidateExecution = Pick<
  typeof aiExecutionsTable.$inferSelect,
  "id" | "operationId" | "goalId" | "attempt" | "status" | "baseRevision"
>;

export type MissionCandidateAcceptance = {
  missionCandidate: boolean;
  accepted: boolean;
  sourceExecutionId: string | null;
  sourceMissionId: string | null;
  sourceGoalId: string | null;
  sourceOperationId: string | null;
};

const NOT_MISSION_CANDIDATE: MissionCandidateAcceptance = {
  missionCandidate: false,
  accepted: false,
  sourceExecutionId: null,
  sourceMissionId: null,
  sourceGoalId: null,
  sourceOperationId: null,
};

function parseSourceBinding(validationEvidence: string | null): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(validationEvidence ?? "null");
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
      return parsed[0] as Record<string, unknown>;
    }
  } catch {
    // Invalid or legacy evidence cannot establish Mission candidate acceptance.
  }
  return undefined;
}

export async function checkMissionCandidateAcceptance(params: {
  tx: MissionCandidateAcceptanceTransaction;
  projectId: string;
  userId: string;
  proposal: typeof aiChangeProposalsTable.$inferSelect;
  sourceExecution?: MissionCandidateExecution | null;
}): Promise<MissionCandidateAcceptance> {
  let execution = params.sourceExecution;
  if (execution === undefined) {
    const [linkedExecution] = await params.tx
      .select({
        id: aiExecutionsTable.id,
        operationId: aiExecutionsTable.operationId,
        goalId: aiExecutionsTable.goalId,
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        baseRevision: aiExecutionsTable.baseRevision,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.projectId, params.projectId),
        eq(aiExecutionsTable.proposalId, params.proposal.id),
      ))
      .orderBy(desc(aiExecutionsTable.updatedAt))
      .limit(1);
    execution = linkedExecution;
  }

  if (!execution?.goalId) return NOT_MISSION_CANDIDATE;

  const candidateStatus: MissionCandidateAcceptance = {
    missionCandidate: true,
    accepted: false,
    sourceExecutionId: execution.id,
    sourceMissionId: null,
    sourceGoalId: execution.goalId,
    sourceOperationId: execution.operationId,
  };
  const [goal] = await params.tx
    .select({
      id: aiGoalsTable.id,
      missionId: aiGoalsTable.missionId,
      status: aiGoalsTable.status,
    })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, execution.goalId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .limit(1);
  if (!goal) return candidateStatus;
  candidateStatus.sourceMissionId = goal.missionId;

  const [mission] = await params.tx
    .select({ id: aiMissionsTable.id })
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, goal.missionId),
      eq(aiMissionsTable.projectId, params.projectId),
      eq(aiMissionsTable.userId, params.userId),
    ))
    .limit(1);
  if (!mission) return candidateStatus;

  const [acceptance] = await params.tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.projectId, params.projectId),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ))
    .limit(1);
  const binding = parseSourceBinding(params.proposal.validationEvidence);
  const operationId = execution.operationId;
  if (
    execution.status !== "completed"
    || !operationId
    || !execution.baseRevision
    || !acceptance
    || acceptance.outcome !== "SUCCEEDED"
    || acceptance.terminalStatus !== "completed"
    || acceptance.evidenceRequired !== 1
    || acceptance.evidenceComplete !== 1
    || !acceptance.evidenceSnapshotId
    || goal.status !== "completed"
    || binding?.status !== "passed"
    || binding.executionId !== execution.id
    || binding.executionOperationId !== operationId
    || binding.attempt !== execution.attempt
    || binding.missionId !== goal.missionId
    || binding.goalId !== goal.id
    || typeof binding.candidateIdentity !== "string"
    || binding.candidateIdentity !== acceptance.candidateIdentity
    || binding.sourceRevision !== acceptance.sourceRevision
    || binding.sourceRevision !== params.proposal.baseRevision
    || binding.baseTreeHash !== params.proposal.baseTreeHash
    || binding.candidateTreeHash !== params.proposal.candidateTreeHash
    || binding.changeSetHash !== params.proposal.changeSetHash
  ) {
    return candidateStatus;
  }

  const canonicalProof = await loadCanonicalProof({
    tx: params.tx,
    executionId: execution.id,
    attempt: execution.attempt,
    scope: {
      projectId: params.projectId,
      executionId: execution.id,
      operationId,
      sourceRevisionBinding: "scope",
      candidateIdentityBinding: "required",
      sourceRevision: execution.baseRevision,
      candidateIdentity: binding.candidateIdentity,
    },
    goalStatus: goal.status,
  });
  if (
    canonicalProof.verdict !== "PROVEN"
    || canonicalProof.acceptanceId !== acceptance.id
    || canonicalProof.evidenceSnapshotId !== acceptance.evidenceSnapshotId
    || canonicalProof.sourceRevision !== acceptance.sourceRevision
    || canonicalProof.candidateIdentity !== binding.candidateIdentity
  ) {
    return candidateStatus;
  }

  return { ...candidateStatus, accepted: true };
}
