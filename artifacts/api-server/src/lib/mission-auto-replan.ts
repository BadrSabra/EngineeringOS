import { and, asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import { buildMissionPlanPreview } from "@workspace/ai-orchestrator";
import {
  FailureDiagnosisSummarySchema,
  toFailureDiagnosisSummary,
  type FailureDiagnosisSummary,
} from "@workspace/ai-orchestrator";
import {
  createMissionPlanGoal,
  type MissionPlanMaterialization,
} from "../routes/ai/missions.js";
import {
  WorldStateFailureDiagnosisSchema,
  type WorldStateFailureDiagnosis,
} from "./world-state-failure-diagnosis.js";
import {
  loadRuntimeStartHypothesisReplanEvidence,
  type RuntimeStartHypothesisReplanEvidence,
} from "./agent-state/runtime-start-hypothesis-replan-context.js";
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
      .map((item) => item.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, itemMax))
      .filter(Boolean)
    : [];
}

function failureDiagnosisFromOutcome(outcome: unknown): FailureDiagnosisSummary | undefined {
  const outcomeRecord = jsonRecord(outcome);
  const acceptance = jsonRecord(outcomeRecord.acceptance);
  if (Object.prototype.hasOwnProperty.call(acceptance, "failureDiagnosis")) {
    const parsed = FailureDiagnosisSummarySchema.safeParse(acceptance.failureDiagnosis);
    return parsed.success ? parsed.data : undefined;
  }
  const worldStateDiagnosis = WorldStateFailureDiagnosisSchema.safeParse(
    outcomeRecord.worldStateFailureDiagnosis,
  );
  return worldStateDiagnosis.success
    ? toFailureDiagnosisSummary(worldStateDiagnosis.data.failureDiagnosis)
    : undefined;
}

function worldStateFailureDiagnosisFromOutcome(outcome: unknown): WorldStateFailureDiagnosis | undefined {
  const parsed = WorldStateFailureDiagnosisSchema.safeParse(
    jsonRecord(outcome).worldStateFailureDiagnosis,
  );
  return parsed.success ? parsed.data : undefined;
}

export function buildReplanContext(goal: {
  id: string;
  blockedReason: string | null;
  nextAction: unknown;
  outcomeContract: unknown;
  successCriteria: unknown;
}, runtimeStartHypothesisEvidence?: RuntimeStartHypothesisReplanEvidence) {
  const outcome = jsonRecord(goal.outcomeContract);
  const acceptance = jsonRecord(outcome.acceptance);
  const receipt = jsonRecord(acceptance.receipt);
  const stateProjection = jsonRecord(acceptance.stateProjection);
  const failureDiagnosis = failureDiagnosisFromOutcome(goal.outcomeContract);
  const worldStateDiagnosis = worldStateFailureDiagnosisFromOutcome(goal.outcomeContract);
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
    ...(worldStateDiagnosis
      ? { affectedFacts: stringList(worldStateDiagnosis.affectedFactRefs, 24, 240) }
      : {}),
    affectedClaims: stringList(
      acceptance.affectedClaims ?? stateProjection.proofObligations ?? stateProjection.contradictions,
      24,
      240,
    ),
    evidenceRefs: stringList([
      ...(Array.isArray(acceptance.acceptedRefs) ? acceptance.acceptedRefs : []),
      ...(Array.isArray(receipt.evidenceRefs) ? receipt.evidenceRefs : []),
      ...(Array.isArray(outcome.evidenceRefs) ? outcome.evidenceRefs : []),
      ...(worldStateDiagnosis?.transition?.id
        ? [`world-transition:${worldStateDiagnosis.transition.id}`]
        : []),
      ...(worldStateDiagnosis?.supportingObservationIds.map((id) => `observation:${id}`) ?? []),
      ...(worldStateDiagnosis?.contradictingObservationIds.map((id) => `observation:${id}`) ?? []),
    ],
      16,
      500,
    ),
    ...(worldStateDiagnosis
      ? {
          hypothesisImpact: [
            `assumption=${worldStateDiagnosis.failedAssumptionCode}`,
            `expectedEffect=${worldStateDiagnosis.expectedEffectCode}`,
            `disposition=${worldStateDiagnosis.recommendedDisposition}`,
            `remaining=${worldStateDiagnosis.remainingHypotheses.join(",")}`,
          ].join(";").slice(0, 500),
        }
      : typeof outcome.hypothesisImpact === "string"
      ? { hypothesisImpact: outcome.hypothesisImpact.slice(0, 500) }
      : {}),
    ...(runtimeStartHypothesisEvidence
      ? { runtimeStartHypothesisEvidence }
      : {}),
    nextActions: [
      ...(failureDiagnosis ? [failureDiagnosis.nextActionCode] : []),
      ...(worldStateDiagnosis
        ? [
            `world-state:${worldStateDiagnosis.reasonCode}`,
            `world-state-assumption:${worldStateDiagnosis.failedAssumptionCode}`,
            `world-state-expected-effect:${worldStateDiagnosis.expectedEffectCode}`,
            `world-state-disposition:${worldStateDiagnosis.recommendedDisposition}`,
            ...worldStateDiagnosis.distinguishingObservationCodes,
          ]
        : []),
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
export async function autoReplanMission(
  missionId: string,
  runGoal: typeof runMissionGoal = runMissionGoal,
): Promise<AutoReplanResult> {
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
    const failedOutcome = jsonRecord(failedGoal?.outcomeContract);
    const acceptance = jsonRecord(failedOutcome.acceptance);
    const hasAcceptanceFailureDiagnosis = Object.prototype.hasOwnProperty.call(
      acceptance,
      "failureDiagnosis",
    );
    const hasWorldStateFailureDiagnosis = Object.prototype.hasOwnProperty.call(
      failedOutcome,
      "worldStateFailureDiagnosis",
    );
    const parsedAcceptanceDiagnosis = hasAcceptanceFailureDiagnosis
      ? FailureDiagnosisSummarySchema.safeParse(acceptance.failureDiagnosis)
      : undefined;
    const worldStateDiagnosis = failedGoal
      ? worldStateFailureDiagnosisFromOutcome(failedGoal.outcomeContract)
      : undefined;
    const failureDiagnosis = failedGoal
      ? failureDiagnosisFromOutcome(failedGoal.outcomeContract)
      : undefined;
    if (
      (hasAcceptanceFailureDiagnosis && !parsedAcceptanceDiagnosis?.success)
      || (hasWorldStateFailureDiagnosis && !worldStateDiagnosis)
    ) {
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
    const priorPlanRevision = failedGoal
      ? jsonRecord(jsonRecord(failedGoal.outcomeContract).planRevision).hash
        ?? jsonRecord(jsonRecord(failedGoal.successCriteria).planRevision).hash
      : undefined;
    const runtimeStartHypothesisEvidence = failedGoal && typeof priorPlanRevision === "string"
      ? await loadRuntimeStartHypothesisReplanEvidence(tx, {
          projectId: mission.projectId,
          missionId: mission.id,
          goalId: failedGoal.id,
          planRevision: priorPlanRevision,
        })
      : undefined;
    const preview = buildMissionPlanPreview({
      message: mission.intent,
      objective: mission.intent,
      ...(failedGoal
        ? { replanContext: buildReplanContext(failedGoal, runtimeStartHypothesisEvidence) }
        : {}),
    });
    if (preview.admission !== "mission") {
      return { status: "skipped" as const, missionId, reason: "objective_no_longer_mission_eligible" };
    }

    const planHash = runtimeStartHypothesisEvidence
      ? createHash("sha256")
        .update(JSON.stringify({
          sourcePlanHash: preview.plan.planHash,
          runtimeStartHypothesisEvidence,
        }))
        .digest("hex")
      : preview.plan.planHash;
    const revision = `auto:${failedGoal?.id ?? mission.id}:${planHash}`;
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
    runs.push(await runGoal({
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