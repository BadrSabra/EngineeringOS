import { and, eq } from "drizzle-orm";
import {
  aiGoalsTable,
  db,
} from "@workspace/db";

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type GoalAcceptanceProjection = {
  acceptanceId?: string | null;
  executionId: string;
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  verdict: "PROVEN" | "INCOMPLETE" | "FAILED";
  evidenceSnapshotId?: string | null;
  evidenceRequired?: boolean;
  evidenceComplete?: boolean;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  scope?: {
    projectId: string;
    candidateIdentity?: string | null;
  };
  acceptedRefs?: string[];
  validatorIds?: string[];
  receipt?: {
    kind: "execution_acceptance" | "recipe";
    id?: string | null;
    executionId: string;
    status: string;
  };
  reasonCode?: string | null;
  nextActionCode?: string | null;
  updatedAt: Date;
};

/**
 * Persist the server-owned acceptance result on the Goal's existing outcome
 * contract. This is a projection only: execution acceptance remains the
 * authority and recipe/task executors remain the owners of their results.
 */
export async function projectGoalAcceptance(
  tx: MissionTransaction,
  params: {
    goalId: string;
    projectId: string;
    projection: GoalAcceptanceProjection;
  },
): Promise<boolean> {
  const [goal] = await tx
    .select({ outcomeContract: aiGoalsTable.outcomeContract })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, params.goalId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!goal) return false;

  const acceptance = {
    ...(params.projection.acceptanceId ? { acceptanceId: params.projection.acceptanceId } : {}),
    executionId: params.projection.executionId,
    outcome: params.projection.outcome,
    verdict: params.projection.verdict,
    ...(params.projection.evidenceSnapshotId ? { evidenceSnapshotId: params.projection.evidenceSnapshotId } : {}),
    ...(params.projection.evidenceRequired !== undefined ? { evidenceRequired: params.projection.evidenceRequired } : {}),
    ...(params.projection.evidenceComplete !== undefined ? { evidenceComplete: params.projection.evidenceComplete } : {}),
    ...(params.projection.sourceRevision ? { sourceRevision: params.projection.sourceRevision } : {}),
    ...(params.projection.candidateIdentity ? { candidateIdentity: params.projection.candidateIdentity } : {}),
    ...(params.projection.scope ? { scope: params.projection.scope } : {}),
    ...(params.projection.acceptedRefs?.length ? { acceptedRefs: params.projection.acceptedRefs } : {}),
    ...(params.projection.validatorIds?.length ? { validatorIds: params.projection.validatorIds } : {}),
    ...(params.projection.receipt ? { receipt: params.projection.receipt } : {}),
    ...(params.projection.reasonCode ? { reasonCode: params.projection.reasonCode } : {}),
    ...(params.projection.nextActionCode ? { nextActionCode: params.projection.nextActionCode } : {}),
    updatedAt: params.projection.updatedAt.toISOString(),
  };
  await tx.update(aiGoalsTable)
    .set({
      outcomeContract: {
        ...goal.outcomeContract,
        acceptance,
      },
      updatedAt: params.projection.updatedAt,
    })
    .where(and(
      eq(aiGoalsTable.id, params.goalId),
      eq(aiGoalsTable.projectId, params.projectId),
    ));
  return true;
}