import { and, eq } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
} from "@workspace/db";

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

function hasProvenAcceptance(goal: typeof aiGoalsTable.$inferSelect): boolean {
  const outcome = record(goal.outcomeContract);
  const acceptance = record(outcome.acceptance);
  if (acceptance.verdict !== "PROVEN" || acceptance.evidenceComplete !== true) return false;
  if (typeof acceptance.executionId !== "string" || acceptance.executionId.length === 0) return false;
  if (typeof acceptance.sourceRevision !== "string" || acceptance.sourceRevision.length === 0) return false;
  const deliveryRequired = outcome.deliveryRequired === true;
  if (deliveryRequired) {
    const delivery = record(acceptance.deliveryReceipt);
    if (!["PROVEN", "completed", "succeeded"].includes(String(delivery.status))) return false;
  }
  return true;
}

export type MissionCompletionEvaluation = {
  allowed: boolean;
  reason: "proven" | "mission_not_found" | "no_active_goals" | "goal_not_proven" | "revision_mismatch";
  activePlanRevision: string | null;
  missingGoalIds: string[];
};

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
  const missingGoalIds = active
    .filter((goal) => revision !== null && goalPlanRevision(goal) !== revision)
    .map((goal) => goal.id);
  if (active.length === 0) {
    return {
      allowed: false,
      reason: "no_active_goals",
      activePlanRevision: revision,
      missingGoalIds: [],
    };
  }
  const incomplete = active.filter((goal) =>
    goal.status !== "completed" || !hasProvenAcceptance(goal),
  );
  missingGoalIds.push(...incomplete.map((goal) => goal.id));
  if (missingGoalIds.length > 0) {
    return {
      allowed: false,
      reason: revision && active.some((goal) => goalPlanRevision(goal) !== revision)
        ? "revision_mismatch"
        : "goal_not_proven",
      activePlanRevision: revision,
      missingGoalIds: [...new Set(missingGoalIds)],
    };
  }
  return {
    allowed: true,
    reason: "proven",
    activePlanRevision: revision,
    missingGoalIds: [],
  };
}

export async function evaluateGoalCompletion(
  tx: MissionTransaction,
  params: { goalId: string; missionId: string; projectId: string },
): Promise<boolean> {
  const [goal] = await tx
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, params.goalId),
      eq(aiGoalsTable.missionId, params.missionId),
      eq(aiGoalsTable.projectId, params.projectId),
    ))
    .for("update");
  return Boolean(goal && hasProvenAcceptance(goal));
}