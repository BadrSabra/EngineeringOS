import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { buildMissionPlanPreview } from "@workspace/ai-orchestrator";
import {
  FailureDiagnosisSummarySchema,
  type FailureDiagnosisSummary,
} from "@workspace/ai-orchestrator";
import {
  createMissionPlanGoal,
  type MissionPlanMaterialization,
} from "../routes/ai/missions.js";
import { runMissionGoal, type MissionGoalRunResult } from "./mission-runtime.js";

type AutoReplanResult =
  | {
      status: "replanned";
      missionId: string;
      revision: string;
      plan: MissionPlanMaterialization;
      runs: Awaited<ReturnType<typeof runMissionGoal>>[];
    }
  | {
      status: "skipped";
      missionId: string;
      reason: string;
    };

const TERMINAL_REPLAN_FAILURES = new Set([
  "objective_no_longer_mission_eligible",
  "automatic_replan_budget_exhausted",
  "automatic_replan_already_attempted",
  "failure_diagnosis_invalid",
  "failure_requires_owner_approval",
  "failure_not_automatically_retryable",
  "empty_plan",
  "no_eligible_replan_root",
]);

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown, max: number, itemMax: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, max)
      .map((item) => item.slice(0, itemMax))
    : [];
}

function failureDiagnosisFromOutcome(outcome: unknown): FailureDiagnosisSummary | undefined {
  const acceptance = jsonRecord(jsonRecord(outcome).acceptance);
  const parsed = FailureDiagnosisSummarySchema.safeParse(acceptance.failureDiagnosis);
  return parsed.success ? parsed.data : undefined;
}

function buildReplanContext(goal: {
  id: string;
  blockedReason: string | null;
  nextAction: unknown;
  outcomeContract: unknown;
  successCriteria: unknown;
}) {
  const outcome = jsonRecord(goal.outcomeContract);
  const acceptance = jsonRecord(outcome.acceptance);
  const receipt = jsonRecord(acceptance.receipt);
  const stateProjection = jsonRecord(acceptance.stateProjection);
  const failureDiagnosis = failureDiagnosisFromOutcome(goal.outcomeContract);
  const success = jsonRecord(goal.successCriteria);
  const planRevision = jsonRecord(outcome.planRevision).hash ?? jsonRecord(success.planRevision).hash;
  const nextActionReason = jsonRecord(goal.nextAction).reason;
  return {
    failedGoalId: goal.id,
    ...(failureDiagnosis
      ? { failureDiagnosis, failureClass: failureDiagnosis.kind }
      : typeof receipt.failureClass === "string"
        ? { failureClass: receipt.failureClass }
        : {}),
    ...(failureDiagnosis
      ? { failureCode: failureDiagnosis.reasonCode }
      : typeof acceptance.reasonCode === "string"
        ? { failureCode: acceptance.reasonCode }
        : {}),
    affectedPaths: stringList(
      acceptance.affectedPaths ?? receipt.affectedPaths ?? outcome.affectedPaths,
      24,
      500,
    ),
    affectedClaims: stringList(
      acceptance.affectedClaims ?? stateProjection.proofObligations ?? stateProjection.contradictions,
      24,
      240,
    ),
    evidenceRefs: stringList(
      acceptance.acceptedRefs ?? receipt.evidenceRefs ?? outcome.evidenceRefs,
      16,
      500,
    ),
    ...(typeof outcome.hypothesisImpact === "string"
      ? { hypothesisImpact: outcome.hypothesisImpact.slice(0, 500) }
      : {}),
    nextActions: [
      ...(failureDiagnosis ? [failureDiagnosis.nextActionCode] : []),
      ...(goal.blockedReason ? [goal.blockedReason] : []),
      ...(typeof nextActionReason === "string" ? [nextActionReason.slice(0, 240)] : []),
      ...stringList(outcome.nextActions, 4, 240),
    ].slice(0, 8),
    ...(typeof planRevision === "string" ? { priorPlanRevision: planRevision.slice(0, 200) } : {}),
  };
}

/**
 * A replan request is durable work, not a retry loop. If the coordinator
 * cannot produce or dispatch a new bounded plan, leave the Mission in an
 * operator-visible terminal state instead of polling needs_replan forever.
 */
async function terminalizeAutomaticReplanFailure(
  missionId: string,
  reason: string,
): Promise<boolean> {
  if (!TERMINAL_REPLAN_FAILURES.has(reason)) return false;

  return db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId))
      .for("update");
    if (!mission || mission.status !== "needs_replan") return false;

    const now = new Date();
    await tx
      .update(aiMissionsTable)
      .set({
        status: "blocked",
        completedAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionReplanBlocked",
      projectId: mission.projectId,
      severity: "warning",
      message: "AI Mission could not produce or dispatch a bounded automatic replan",
      correlationId: missionId,
      payload: {
        missionId,
        reason,
        previousStatus: "needs_replan",
        nextStatus: "blocked",
      },
    });
    return true;
  });
}

/**
 * Converts a durable needs_replan Mission into one fresh server-owned plan.
 *
 * The acceptance transaction only records the authoritative failure. This
 * coordinator runs after that commit, under the Mission row lock, so planning
 * and materialization cannot make terminal acceptance less reliable.
 */
export async function autoReplanMission(missionId: string): Promise<AutoReplanResult> {
  const prepared = await db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId))
      .for("update");
    if (!mission || mission.status !== "needs_replan") {
      return {
        status: "skipped" as const,
        missionId,
        reason: mission ? "mission_not_ready" : "mission_not_found",
      };
    }
    const [failedGoal] = await tx
      .select({
        id: aiGoalsTable.id,
        blockedReason: aiGoalsTable.blockedReason,
        nextAction: aiGoalsTable.nextAction,
        outcomeContract: aiGoalsTable.outcomeContract,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.missionId, mission.id),
        eq(aiGoalsTable.projectId, mission.projectId),
        eq(aiGoalsTable.status, "needs_replan"),
      ))
      .orderBy(asc(aiGoalsTable.updatedAt), asc(aiGoalsTable.id))
      .limit(1);
    const failureDiagnosis = failedGoal
      ? failureDiagnosisFromOutcome(failedGoal.outcomeContract)
      : undefined;
    const acceptance = jsonRecord(jsonRecord(failedGoal?.outcomeContract).acceptance);
    const hasFailureDiagnosis = Object.prototype.hasOwnProperty.call(
      acceptance,
      "failureDiagnosis",
    );
    if (hasFailureDiagnosis && !failureDiagnosis) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_diagnosis_invalid",
      };
    }
    if (failureDiagnosis?.requiresApproval) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_requires_owner_approval",
      };
    }
    if (failureDiagnosis && !failureDiagnosis.retryable) {
      return {
        status: "skipped" as const,
        missionId,
        reason: "failure_not_automatically_retryable",
      };
    }
    const preview = buildMissionPlanPreview({
      message: mission.intent,
      objective: mission.intent,
      ...(failedGoal ? { replanContext: buildReplanContext(failedGoal) } : {}),
    });
    if (preview.admission !== "mission") {
      return { status: "skipped" as const, missionId, reason: "objective_no_longer_mission_eligible" };
    }

    const revision = `auto:${failedGoal?.id ?? mission.id}:${preview.plan.planHash}`;
    const policy = mission.autonomyPolicy ?? {};
    const automaticReplanCount = typeof policy.automaticReplanCount === "number"
      && Number.isFinite(policy.automaticReplanCount)
      ? Math.max(0, Math.floor(policy.automaticReplanCount))
      : 0;
    const maxAutomaticReplans = typeof policy.maxAutomaticReplans === "number"
      && Number.isFinite(policy.maxAutomaticReplans)
      ? Math.max(0, Math.floor(policy.maxAutomaticReplans))
      : 3;
    if (automaticReplanCount >= maxAutomaticReplans) {
      return { status: "skipped" as const, missionId, reason: "automatic_replan_budget_exhausted" };
    }
    if (policy.lastAutomaticReplanRevision === revision) {
      return { status: "skipped" as const, missionId, reason: "automatic_replan_already_attempted" };
    }
    const plan = await createMissionPlanGoal(
      tx,
      mission,
      new Date(),
      preview,
      "execution",
      revision,
    );
    if (!plan) {
      return { status: "skipped" as const, missionId, reason: "empty_plan" };
    }
    return {
      status: "prepared" as const,
      missionId,
      userId: mission.userId,
      projectId: mission.projectId,
      revision,
      plan,
      failedGoalId: failedGoal?.id ?? null,
    };
  });

  if (prepared.status !== "prepared") {
    await terminalizeAutomaticReplanFailure(prepared.missionId, prepared.reason);
    return prepared;
  }

  const runs: MissionGoalRunResult[] = [];
  for (const planGoal of prepared.plan.goals.filter((goal) => goal.dependencies.length === 0)) {
    runs.push(await runMissionGoal({
      goalId: planGoal.goalId,
      userId: prepared.userId,
      trigger: "replan",
    }));
  }
  const dispatchSucceeded = runs.some((run) =>
    run.status === "scheduled" || run.status === "waiting" || run.status === "completed",
  );
  if (!dispatchSucceeded) {
    await terminalizeAutomaticReplanFailure(missionId, "no_eligible_replan_root");
    return {
      status: "skipped",
      missionId,
      reason: "no_eligible_replan_root",
    };
  }

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ))
      .for("update");
    if (!current) return;
    const [updated] = await tx.update(aiMissionsTable)
      .set({
        status: "active",
        autonomyPolicy: {
          ...current.autonomyPolicy,
          activePlanRevision: prepared.revision,
          lastAutomaticReplanRevision: prepared.revision,
          automaticReplanCount: (
            typeof current.autonomyPolicy.automaticReplanCount === "number"
              ? Math.max(0, Math.floor(current.autonomyPolicy.automaticReplanCount))
              : 0
          ) + 1,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(aiMissionsTable.id, missionId),
        eq(aiMissionsTable.status, "needs_replan"),
      ))
      .returning({ id: aiMissionsTable.id });
    if (!updated) return;
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionReplannedAutomatically",
      projectId: prepared.projectId,
      severity: "info",
      message: "AI Mission automatically received a new plan revision after a recoverable failure",
      correlationId: prepared.plan.primary.goalId,
      payload: {
        missionId,
        failedGoalId: prepared.failedGoalId,
        planRevision: prepared.revision,
        planHash: prepared.revision,
        runs: runs.map((run) => ({ goalId: run.goalId, status: run.status, reason: run.reason })),
      },
    });
  });

  return {
    status: "replanned",
    missionId,
    revision: prepared.revision,
    plan: prepared.plan,
    runs,
  };
}

export async function reconcileAutomaticMissionReplans(limit = 16): Promise<number> {
  const candidates = await db
    .select({ id: aiMissionsTable.id })
    .from(aiMissionsTable)
    .where(eq(aiMissionsTable.status, "needs_replan"))
    .orderBy(asc(aiMissionsTable.updatedAt), asc(aiMissionsTable.id))
    .limit(Math.max(1, Math.min(limit, 64)));
  let replanned = 0;
  for (const candidate of candidates) {
    const result = await autoReplanMission(candidate.id);
    if (result.status === "replanned") replanned++;
  }
  return replanned;
}