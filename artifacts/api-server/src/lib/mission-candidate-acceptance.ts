import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionHandoffsTable,
  aiMissionsTable,
  db,
} from "@workspace/db";
import { loadCanonicalProof } from "./proof-foundation.js";

type MissionCandidateAcceptanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MissionCandidateExecution = Pick<
  typeof aiExecutionsTable.$inferSelect,
  | "id"
  | "operationId"
  | "goalId"
  | "attempt"
  | "status"
  | "baseRevision"
  | "userId"
  | "sessionId"
>;

export type MissionCandidateAcceptance = {
  missionCandidate: boolean;
  accepted: boolean;
  sourceExecutionId: string | null;
  sourceMissionId: string | null;
  sourceGoalId: string | null;
  sourceOperationId: string | null;
  sourceAcceptanceId: string | null;
};

const NOT_MISSION_CANDIDATE: MissionCandidateAcceptance = {
  missionCandidate: false,
  accepted: false,
  sourceExecutionId: null,
  sourceMissionId: null,
  sourceGoalId: null,
  sourceOperationId: null,
  sourceAcceptanceId: null,
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
  persistedAcceptanceId?: string;
}): Promise<MissionCandidateAcceptance> {
  const binding = params.persistedAcceptanceId
    ? undefined
    : parseSourceBinding(params.proposal.validationEvidence);
  let execution = params.sourceExecution;
  if (execution === undefined) {
    const executionId = typeof binding?.executionId === "string"
      ? binding.executionId
      : null;
    const [linkedExecution] = executionId
      ? await params.tx
      .select({
        id: aiExecutionsTable.id,
        operationId: aiExecutionsTable.operationId,
        goalId: aiExecutionsTable.goalId,
        attempt: aiExecutionsTable.attempt,
        status: aiExecutionsTable.status,
        baseRevision: aiExecutionsTable.baseRevision,
        userId: aiExecutionsTable.userId,
        sessionId: aiExecutionsTable.sessionId,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, executionId),
        eq(aiExecutionsTable.projectId, params.projectId),
        eq(aiExecutionsTable.proposalId, params.proposal.id),
      ))
      .limit(1)
      : [];
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
    sourceAcceptanceId: null,
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
    .select({
      id: aiMissionsTable.id,
      userId: aiMissionsTable.userId,
    })
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, goal.missionId),
      eq(aiMissionsTable.projectId, params.projectId),
      eq(aiMissionsTable.userId, params.userId),
    ))
    .limit(1);
  if (!mission) return candidateStatus;

  const [handoff] = typeof params.proposal.sessionId === "string"
    && execution.userId === params.userId
    && execution.sessionId === params.proposal.sessionId
    ? await params.tx
        .select({ id: aiMissionHandoffsTable.id })
        .from(aiMissionHandoffsTable)
        .where(and(
          eq(aiMissionHandoffsTable.missionId, goal.missionId),
          eq(aiMissionHandoffsTable.projectId, params.projectId),
          eq(aiMissionHandoffsTable.userId, params.userId),
          eq(aiMissionHandoffsTable.sessionId, params.proposal.sessionId),
        ))
        .limit(1)
    : [];
  if (!handoff) return candidateStatus;

  const [acceptance] = await params.tx
    .select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      ...(params.persistedAcceptanceId
        ? [eq(aiExecutionAcceptancesTable.id, params.persistedAcceptanceId)]
        : [eq(aiExecutionAcceptancesTable.attempt, execution.attempt)]),
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.projectId, params.projectId),
    ))
    .limit(1);
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
    || !acceptance.candidateIdentity
    || !acceptance.sourceRevision
    || (params.persistedAcceptanceId
      ? acceptance.id !== params.persistedAcceptanceId
        || acceptance.attempt !== execution.attempt
        || execution.baseRevision !== acceptance.sourceRevision
      : binding?.status !== "passed"
        || binding.executionId !== execution.id
        || binding.executionOperationId !== operationId
        || binding.attempt !== execution.attempt
        || binding.missionId !== goal.missionId
        || binding.goalId !== goal.id
        || binding.candidateIdentity !== acceptance.candidateIdentity
        || binding.sourceRevision !== acceptance.sourceRevision
        || binding.sourceRevision !== params.proposal.baseRevision
        || binding.baseTreeHash !== params.proposal.baseTreeHash
        || binding.candidateTreeHash !== params.proposal.candidateTreeHash
        || binding.changeSetHash !== params.proposal.changeSetHash)
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
      candidateIdentity: acceptance.candidateIdentity,
    },
    goalStatus: goal.status,
  });
  if (
    canonicalProof.verdict !== "PROVEN"
    || canonicalProof.acceptanceId !== acceptance.id
    || canonicalProof.evidenceSnapshotId !== acceptance.evidenceSnapshotId
    || canonicalProof.sourceRevision !== acceptance.sourceRevision
    || canonicalProof.candidateIdentity !== acceptance.candidateIdentity
  ) {
    return candidateStatus;
  }

  return {
    ...candidateStatus,
    accepted: true,
    sourceAcceptanceId: acceptance.id,
  };
}
