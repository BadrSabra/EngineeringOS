import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  aiMissionDecisionEventsTable,
  aiMissionDecisionShadowComparisonsTable,
  aiMissionDecisionTracesTable,
  db,
} from "@workspace/db";
import {
  buildMissionStrategyShadowComparison,
  MISSION_STRATEGY_EVALUATOR_VERSION,
  MISSION_STRATEGY_SHADOW_POLICY_VERSION,
  MissionDecisionTraceSchema,
  MissionStrategyShadowComparisonSchema,
} from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";

const MAX_SHADOW_RECONCILIATION_BATCH = 32;

type ShadowCandidate = {
  decisionId: string;
  occurredAt: Date;
};

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function transactionErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const record = safeRecord(current);
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return null;
}

function isRetryableTransactionConflict(error: unknown): boolean {
  const code = transactionErrorCode(error);
  return code === "40001" || code === "40P01";
}

function matchesTraceColumns(
  row: typeof aiMissionDecisionTracesTable.$inferSelect,
  trace: ReturnType<typeof MissionDecisionTraceSchema.parse>,
): boolean {
  const identity = trace.context.identity;
  return row.decisionId === trace.decisionId
    && row.projectId === identity.projectId
    && row.missionId === identity.missionId
    && row.goalId === identity.goalId
    && row.sourceExecutionId === identity.sourceExecutionId
    && row.sourceAcceptanceId === identity.sourceAcceptanceId
    && row.sourceAttempt === identity.sourceAttempt
    && row.priorPlanRevision === identity.priorPlanRevision
    && row.projectRevision === identity.projectRevision
    && row.worldStateRevision === identity.worldStateRevision
    && row.environmentRevision === identity.environmentRevision
    && row.contextHash === trace.contextHash
    && row.resultKind === trace.result.kind
    && row.selectedStrategyId === (trace.result.kind === "SELECTED" ? trace.result.selectedStrategyId : null);
}

function comparisonRowValues(comparisonInput: unknown) {
  const comparison = MissionStrategyShadowComparisonSchema.parse(comparisonInput);
  const traceIdentity = comparison.decisionId;
  const shadowResultKind = comparison.shadowResult.kind;
  return {
    comparisonId: comparison.comparisonId,
    decisionId: traceIdentity,
    contextHash: comparison.contextHash,
    appliedPlanRevision: comparison.appliedPlanRevision,
    baselineStrategyId: comparison.baselineStrategyId,
    shadowPolicyVersion: comparison.shadowPolicyVersion,
    evaluatorVersion: comparison.evaluatorVersion,
    comparisonKind: comparison.comparisonKind,
    shadowResultKind,
    shadowStrategyId: comparison.shadowStrategyId,
    comparisonHash: comparison.comparisonHash,
    comparison: comparison as unknown as Record<string, unknown>,
  };
}

export class MissionStrategyShadowStoreError extends Error {
  constructor(readonly code: string) {
    super(`Mission strategy shadow persistence failed: ${code}`);
    this.name = "MissionStrategyShadowStoreError";
  }
}

export async function persistMissionDecisionShadowComparison(
  decisionId: string,
): Promise<"recorded" | "already_recorded" | "not_ready"> {
  return db.transaction(async (tx) => {
    const [traceRow] = await tx.select().from(aiMissionDecisionTracesTable)
      .where(eq(aiMissionDecisionTracesTable.decisionId, decisionId));
    if (!traceRow) return "not_ready";
    const parsedTrace = MissionDecisionTraceSchema.safeParse(traceRow.trace);
    if (!parsedTrace.success || !matchesTraceColumns(traceRow, parsedTrace.data)) {
      throw new MissionStrategyShadowStoreError("trace_identity_invalid");
    }
    if (parsedTrace.data.result.kind !== "SELECTED") return "not_ready";

    const [appliedEvent] = await tx.select().from(aiMissionDecisionEventsTable)
      .where(and(
        eq(aiMissionDecisionEventsTable.decisionId, decisionId),
        eq(aiMissionDecisionEventsTable.stage, "PLAN_APPLIED"),
      ))
      .limit(1);
    if (
      !appliedEvent?.referenceId
      || !parsedTrace.data.newPlanRevision
      || appliedEvent.referenceId !== parsedTrace.data.newPlanRevision
    ) {
      return "not_ready";
    }

    const built = buildMissionStrategyShadowComparison({
      trace: parsedTrace.data,
      appliedPlanRevision: appliedEvent.referenceId,
    });
    if (built.status !== "computed") return "not_ready";
    const comparison = built.comparison;
    const values = comparisonRowValues(comparison);
    const inserted = await tx.insert(aiMissionDecisionShadowComparisonsTable).values({
      ...values,
      projectId: traceRow.projectId,
      missionId: traceRow.missionId,
      goalId: traceRow.goalId,
      sourceExecutionId: traceRow.sourceExecutionId,
      sourceAcceptanceId: traceRow.sourceAcceptanceId,
      sourceAttempt: traceRow.sourceAttempt,
    }).onConflictDoNothing().returning({
      comparisonId: aiMissionDecisionShadowComparisonsTable.comparisonId,
    });
    if (inserted.length > 0) return "recorded";

    const [existing] = await tx.select({
      comparisonId: aiMissionDecisionShadowComparisonsTable.comparisonId,
      comparisonHash: aiMissionDecisionShadowComparisonsTable.comparisonHash,
      projectId: aiMissionDecisionShadowComparisonsTable.projectId,
      missionId: aiMissionDecisionShadowComparisonsTable.missionId,
      goalId: aiMissionDecisionShadowComparisonsTable.goalId,
      sourceExecutionId: aiMissionDecisionShadowComparisonsTable.sourceExecutionId,
      sourceAcceptanceId: aiMissionDecisionShadowComparisonsTable.sourceAcceptanceId,
      sourceAttempt: aiMissionDecisionShadowComparisonsTable.sourceAttempt,
      appliedPlanRevision: aiMissionDecisionShadowComparisonsTable.appliedPlanRevision,
    }).from(aiMissionDecisionShadowComparisonsTable)
      .where(and(
        eq(aiMissionDecisionShadowComparisonsTable.decisionId, decisionId),
        eq(aiMissionDecisionShadowComparisonsTable.shadowPolicyVersion, MISSION_STRATEGY_SHADOW_POLICY_VERSION),
        eq(aiMissionDecisionShadowComparisonsTable.evaluatorVersion, MISSION_STRATEGY_EVALUATOR_VERSION),
      ));
    if (
      !existing
      || existing.comparisonId !== comparison.comparisonId
      || existing.comparisonHash !== comparison.comparisonHash
      || existing.projectId !== traceRow.projectId
      || existing.missionId !== traceRow.missionId
      || existing.goalId !== traceRow.goalId
      || existing.sourceExecutionId !== traceRow.sourceExecutionId
      || existing.sourceAcceptanceId !== traceRow.sourceAcceptanceId
      || existing.sourceAttempt !== traceRow.sourceAttempt
      || existing.appliedPlanRevision !== appliedEvent.referenceId
    ) {
      throw new MissionStrategyShadowStoreError("shadow_identity_conflict");
    }
    return "already_recorded";
  });
}

async function loadPendingShadowCandidates(
  batchSize: number,
  projectId?: string,
): Promise<ShadowCandidate[]> {
  const projectCondition = projectId
    ? sql`AND trace.project_id = ${projectId}`
    : sql``;
  const rows = await db.execute(sql`
    SELECT event.decision_id AS "decisionId", event.occurred_at AS "occurredAt"
    FROM public.ai_mission_decision_events AS event
    JOIN public.ai_mission_decision_traces AS trace
      ON trace.decision_id = event.decision_id
    WHERE event.stage = 'PLAN_APPLIED'
      AND event.reference_id = trace.trace ->> 'newPlanRevision'
      AND trace.result_kind = 'SELECTED'
      AND trace.selected_strategy_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.ai_mission_decision_shadow_comparisons AS shadow
        WHERE shadow.decision_id = event.decision_id
          AND shadow.shadow_policy_version = ${MISSION_STRATEGY_SHADOW_POLICY_VERSION}
          AND shadow.evaluator_version = ${MISSION_STRATEGY_EVALUATOR_VERSION}
      )
      ${projectCondition}
    ORDER BY event.occurred_at ASC, event.decision_id ASC
    LIMIT ${batchSize}
  `);
  return rows.rows.flatMap((row) => {
    const value = safeRecord(row);
    if (typeof value.decisionId !== "string" || !value.decisionId) return [];
    const occurredAt = value.occurredAt instanceof Date
      ? value.occurredAt
      : new Date(String(value.occurredAt));
    return Number.isFinite(occurredAt.getTime())
      ? [{ decisionId: value.decisionId, occurredAt }]
      : [];
  });
}

export async function reconcilePendingMissionDecisionShadows(
  batchSize = 16,
  projectId?: string,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_SHADOW_RECONCILIATION_BATCH) {
    throw new MissionStrategyShadowStoreError("batch_size_invalid");
  }
  const candidates = await loadPendingShadowCandidates(batchSize, projectId);
  if (candidates.length === 0) return 0;

  let recorded = 0;
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await persistMissionDecisionShadowComparison(candidate.decisionId);
        if (result === "recorded") recorded += 1;
        break;
      } catch (error) {
        if (attempt === 0 && isRetryableTransactionConflict(error)) continue;
        logger.warn(
          {
            decisionIdHash: sha256(candidate.decisionId).slice(0, 16),
            errorCode: transactionErrorCode(error),
            scope: "mission-strategy-shadow-reconciliation",
          },
          "Mission strategy shadow comparison failed; the applied trace remains pending",
        );
        break;
      }
    }
  }
  return recorded;
}
