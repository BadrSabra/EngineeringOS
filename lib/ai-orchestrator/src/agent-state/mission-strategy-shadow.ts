import { z } from "zod";
import {
  DecisionResultSchema,
  MissionDecisionTraceSchema,
  MissionStrategyEvaluationSchema,
  MISSION_DECISION_SCHEMA_VERSION,
  type MissionDecisionTrace,
} from "./mission-decision-contract.js";
import { canonicalJsonHash } from "./contract-utils.js";
import {
  evaluateMissionStrategies,
  type StrategyPairwiseComparison,
} from "./mission-strategy-evaluation.js";

export const MISSION_STRATEGY_SHADOW_POLICY_VERSION = "g7-formal-evaluator-shadow-v1";

export const MissionStrategyShadowComparisonSchema = z.object({
  schemaVersion: z.literal(MISSION_DECISION_SCHEMA_VERSION),
  comparisonId: z.string().regex(/^[a-f0-9]{64}$/),
  comparisonHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisionId: z.string().regex(/^[a-f0-9]{64}$/),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  appliedPlanRevision: z.string().min(1).max(200),
  baselineStrategyId: z.string().min(1).max(200),
  shadowPolicyVersion: z.literal(MISSION_STRATEGY_SHADOW_POLICY_VERSION),
  evaluatorVersion: z.string().min(1).max(120),
  comparisonKind: z.enum(["AGREES", "DIVERGES", "NO_DECISION", "BLOCKED"]),
  shadowResult: DecisionResultSchema,
  shadowStrategyId: z.string().min(1).max(200).nullable(),
  evaluations: z.array(MissionStrategyEvaluationSchema).max(8),
  pairwiseComparisons: z.array(z.object({
    leftStrategyId: z.string().min(1).max(200),
    rightStrategyId: z.string().min(1).max(200),
    relation: z.enum(["left_dominates", "right_dominates", "equivalent", "incomparable"]),
    comparedDimensions: z.array(z.string().min(1).max(120)).max(15),
    unavailableDimensions: z.array(z.string().min(1).max(120)).max(15),
  }).strict()).max(28),
  computedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((comparison, ctx) => {
  const expectedComparisonId = canonicalJsonHash({
    decisionId: comparison.decisionId,
    contextHash: comparison.contextHash,
    appliedPlanRevision: comparison.appliedPlanRevision,
    shadowPolicyVersion: comparison.shadowPolicyVersion,
    evaluatorVersion: comparison.evaluatorVersion,
  });
  const {
    comparisonId: _comparisonId,
    comparisonHash: _comparisonHash,
    ...hashBody
  } = comparison;
  if (comparison.comparisonId !== expectedComparisonId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "shadow comparison identity hash mismatch" });
  }
  if (comparison.comparisonHash !== canonicalJsonHash(hashBody)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "shadow comparison content hash mismatch" });
  }
  if (comparison.shadowResult.kind === "SELECTED") {
    if (comparison.shadowStrategyId !== comparison.shadowResult.selectedStrategyId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "shadow selection must match its result" });
    }
    if (comparison.comparisonKind === "AGREES" && comparison.shadowStrategyId !== comparison.baselineStrategyId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agreement requires the baseline strategy" });
    }
    if (comparison.comparisonKind === "DIVERGES" && comparison.shadowStrategyId === comparison.baselineStrategyId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "divergence requires a different strategy" });
    }
  } else if (comparison.shadowStrategyId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "non-selected shadow results cannot name a strategy" });
  }
  if (
    comparison.shadowResult.kind === "NO_DECISION"
      ? comparison.comparisonKind !== "NO_DECISION"
      : comparison.shadowResult.kind === "BLOCKED"
        ? comparison.comparisonKind !== "BLOCKED"
        : !["AGREES", "DIVERGES"].includes(comparison.comparisonKind)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "comparison kind must match the shadow result" });
  }
});

export type MissionStrategyShadowComparison =
  z.infer<typeof MissionStrategyShadowComparisonSchema>;

export type MissionStrategyShadowBuildResult =
  | { status: "computed"; comparison: MissionStrategyShadowComparison }
  | {
      status: "not_eligible";
      reasonCode: "baseline_not_selected" | "plan_revision_mismatch" | "no_selected_strategy";
    };

export function buildMissionStrategyShadowComparison(input: {
  trace: MissionDecisionTrace;
  appliedPlanRevision: string;
}): MissionStrategyShadowBuildResult {
  const trace = MissionDecisionTraceSchema.parse(input.trace);
  if (trace.result.kind !== "SELECTED") {
    return { status: "not_eligible", reasonCode: "baseline_not_selected" };
  }
  if (!trace.result.selectedStrategyId) {
    return { status: "not_eligible", reasonCode: "no_selected_strategy" };
  }
  if (!trace.newPlanRevision || trace.newPlanRevision !== input.appliedPlanRevision) {
    return { status: "not_eligible", reasonCode: "plan_revision_mismatch" };
  }

  const evaluated = evaluateMissionStrategies({
    context: trace.context,
    alternatives: trace.alternatives,
    // A fixed source timestamp makes retries produce the same comparison hash.
    evaluatedAt: trace.decidedAt,
  });
  const shadowStrategyId = evaluated.result.kind === "SELECTED"
    ? evaluated.result.selectedStrategyId
    : null;
  const comparisonKind = evaluated.result.kind === "NO_DECISION"
    ? "NO_DECISION"
    : evaluated.result.kind === "BLOCKED"
      ? "BLOCKED"
      : shadowStrategyId === trace.result.selectedStrategyId
        ? "AGREES"
        : "DIVERGES";
  const body = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    decisionId: trace.decisionId,
    contextHash: trace.contextHash,
    appliedPlanRevision: input.appliedPlanRevision,
    baselineStrategyId: trace.result.selectedStrategyId,
    shadowPolicyVersion: MISSION_STRATEGY_SHADOW_POLICY_VERSION,
    evaluatorVersion: evaluated.policyVersion,
    comparisonKind,
    shadowResult: evaluated.result,
    shadowStrategyId,
    evaluations: evaluated.evaluations,
    pairwiseComparisons: evaluated.pairwiseComparisons as StrategyPairwiseComparison[],
    computedAt: trace.decidedAt,
  };
  const comparisonId = canonicalJsonHash({
    decisionId: body.decisionId,
    contextHash: body.contextHash,
    appliedPlanRevision: body.appliedPlanRevision,
    shadowPolicyVersion: body.shadowPolicyVersion,
    evaluatorVersion: body.evaluatorVersion,
  });
  const comparisonHash = canonicalJsonHash(body);
  const comparison = MissionStrategyShadowComparisonSchema.parse({
    ...body,
    comparisonId,
    comparisonHash,
  });
  return { status: "computed", comparison };
}
