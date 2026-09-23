import { and, desc, eq } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
} from "@workspace/db";
import {
  loadCanonicalProof,
  type CanonicalProof,
} from "./proof-foundation.js";

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function activePlanRevision(mission: typeof aiMissionsTable.$inferSelect): string | null {
  const policy = record(mission.autonomyPolicy);
  return typeof policy.activePlanRevision === "string"
    ? policy.activePlanRevision
    : null;
}

function goalPlanRevision(goal: typeof aiGoalsTable.$inferSelect): string | null {
  const outcome = record(goal.outcomeContract);
  const planRevision = record(outcome.planRevision);
  return typeof planRevision.hash === "string" ? planRevision.hash : null;
}

function selectActiveGoals(
  mission: typeof aiMissionsTable.$inferSelect,
  goals: Array<typeof aiGoalsTable.$inferSelect>,
): Array<typeof aiGoalsTable.$inferSelect> {
  const revision = activePlanRevision(mission);
  if (!revision) return goals;
  const activeGoals = goals.filter((goal) =>
    goalPlanRevision(goal) === revision
    || record(goal.successCriteria).planRevision
      && record(record(goal.successCriteria).planRevision).hash === revision,
  );
  return activeGoals.length > 0 ? activeGoals : goals;
}

function projectedAcceptance(goal: typeof aiGoalsTable.$inferSelect): {
  executionId: string;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  scope?: { operationId?: string | null; candidateIdentity?: string | null };
  evidenceSnapshotId?: string | null;
  evidenceRequired?: boolean;
  evidenceComplete?: boolean;
  deliveryReceipt?: { status?: unknown } | null;
  disposition?: unknown;
} | null {
  const outcome = record(goal.outcomeContract);
  const acceptance = record(outcome.acceptance);
  if (typeof acceptance.executionId !== "string" || acceptance.executionId.length === 0) return null;
  const scope = record(acceptance.scope);
  return {
    executionId: acceptance.executionId,
    ...(typeof acceptance.sourceRevision === "string"
      ? { sourceRevision: acceptance.sourceRevision }
      : {}),
    ...(typeof acceptance.candidateIdentity === "string"
      ? { candidateIdentity: acceptance.candidateIdentity }
      : {}),
    scope: {
      ...(typeof scope.operationId === "string" ? { operationId: scope.operationId } : {}),
      ...(typeof scope.candidateIdentity === "string"
        ? { candidateIdentity: scope.candidateIdentity }
        : {}),
    },
    ...(typeof acceptance.evidenceSnapshotId === "string"
      ? { evidenceSnapshotId: acceptance.evidenceSnapshotId }
      : {}),
    ...(typeof acceptance.evidenceRequired === "boolean"
      ? { evidenceRequired: acceptance.evidenceRequired }
      : {}),
    ...(typeof acceptance.evidenceComplete === "boolean"
      ? { evidenceComplete: acceptance.evidenceComplete }
      : {}),
    deliveryReceipt: record(acceptance.deliveryReceipt),
    disposition: acceptance.disposition,
  };
}

function planRevisionFromGoal(goal: typeof aiGoalsTable.$inferSelect): string | null {
  const outcomeRevision = goalPlanRevision(goal);
  if (outcomeRevision) return outcomeRevision;
  const success = record(goal.successCriteria);
  const revision = record(success.planRevision);
  return typeof revision.hash === "string" ? revision.hash : null;
}

function candidateIdentityFromGoal(goal: typeof aiGoalsTable.$inferSelect): string | null {
  const outcome = record(goal.outcomeContract);
  const acceptance = record(outcome.acceptance);
  const scope = record(acceptance.scope);
  return typeof scope.candidateIdentity === "string"
    ? scope.candidateIdentity
    : typeof outcome.candidateIdentity === "string"
      ? outcome.candidateIdentity
      : null;
}

export type MissionCompletionEvaluation = {
  allowed: boolean;
  reason: "proven" | "mission_not_found" | "no_active_goals" | "goal_not_proven" | "revision_mismatch";
  activePlanRevision: string | null;
  missingGoalIds: string[];
  proofs?: Array<CanonicalProof & { goalId: string }>;
};

async function composeGoalProofs(
  tx: MissionTransaction,
  mission: typeof aiMissionsTable.$inferSelect,
  goals: Array<typeof aiGoalsTable.$inferSelect>,
): Promise<Array<CanonicalProof & { goalId: string }>> {
  const proofs: Array<CanonicalProof & { goalId: string }> = [];
  for (const goal of goals) {
    const projected = projectedAcceptance(goal);
    const scope = record(projected?.scope);
    const [durableExecution] = await tx
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.goalId, goal.id),
        eq(aiExecutionsTable.projectId, mission.projectId),
      ))
      .orderBy(desc(aiExecutionsTable.createdAt))
      .limit(1);
    const executionId = projected?.executionId ?? durableExecution?.id ?? "";
    const proof = await loadCanonicalProof({
      tx,
      executionId,
      scope: {
        projectId: mission.projectId,
        missionId: mission.id,
        goalId: goal.id,
        executionId,
        operationId: typeof scope.operationId === "string" ? scope.operationId : null,
        planRevision: planRevisionFromGoal(goal),
        activePlanRevision: activePlanRevision(mission),
        sourceRevision: projected?.sourceRevision ?? null,
        candidateIdentity: projected?.candidateIdentity ?? candidateIdentityFromGoal(goal),
      },
      goalStatus: goal.status,
      deliveryRequired: record(goal.outcomeContract).deliveryRequired === true,
      deliveryReceipt: projected?.deliveryReceipt ?? null,
    });
    proofs.push({ goalId: goal.id, ...proof });
  }
  return proofs;
}

/**
 * Common server-owned gate for direct terminal status changes. Execution
 * acceptance remains the authority for normal worker completion; this gate
 * prevents PATCH routes from bypassing that proof.
 */
export async function evaluateMissionCompletion(
  tx: MissionTransaction,
  params: { missionId: string; projectId: string },
): Promise<MissionCompletionEvaluation> {
  const [mission] = await tx
    .select()
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, params.missionId),
      eq(aiMissionsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!mission) {
    return {
      allowed: false,
      reason: "mission_not_found",
      activePlanRevision: null,
      missingGoalIds: [],
    };
  }
  const goals = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, mission.id),
      eq(aiGoalsTable.projectId, mission.projectId),
    ))
    .for("update");
  const active = selectActiveGoals(mission, goals);
  const revision = activePlanRevision(mission);
  if (active.length === 0) {
    return {
      allowed: false,
      reason: "no_active_goals",
      activePlanRevision: revision,
      missingGoalIds: [],
    };
  }
  const proofs = await composeGoalProofs(tx, mission, active);
  const missingGoalIds = proofs
    .filter((proof) => !proof.accepted)
    .map((proof) => proof.goalId);
  if (missingGoalIds.length > 0) {
    return {
      allowed: false,
      reason: revision && proofs.some((proof) =>
        proof.failureReasons.includes("plan_revision_mismatch"),
      )
        ? "revision_mismatch"
        : "goal_not_proven",
      activePlanRevision: revision,
      missingGoalIds: [...new Set(missingGoalIds)],
      proofs,
    };
  }
  return {
    allowed: true,
    reason: "proven",
    activePlanRevision: revision,
    missingGoalIds: [],
    proofs,
  };
}

export async function evaluateGoalCompletion(
  tx: MissionTransaction,
  params: { goalId: string; missionId: string; projectId: string },
): Promise<boolean> {
  const [mission] = await tx
    .select()
    .from(aiMissionsTable)
    .where(and(
      eq(aiMissionsTable.id, params.missionId),
      eq(aiMissionsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!mission) return false;
  const [goal] = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, params.goalId),
      eq(aiGoalsTable.missionId, params.missionId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .for("update");
  if (!goal) return false;
  const [proof] = await composeGoalProofs(tx, mission, [goal]);
  return proof?.accepted === true;
}