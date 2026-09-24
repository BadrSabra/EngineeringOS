import { z } from "zod/v4";
import type { EffectStatus } from "@workspace/ai-orchestrator";

const CreditReasonCodeSchema = z.enum([
  "EXPECTED_EFFECT_COVERAGE",
  "EXPECTED_EFFECT_NOT_OBSERVED",
  "NO_EXPECTED_EFFECTS",
  "OBSERVATION_COVERAGE_INCOMPLETE",
  "CLAIM_CLOSURE_NOT_BOUND",
  "BELIEF_DELTA_NOT_AVAILABLE",
  "FAILURE_CAUSE_NOT_BOUND",
  "ACTION_COMPARISON_NOT_AVAILABLE",
]);

const CreditDimensionSchema = z.object({
  status: z.enum(["measured", "unknown"]),
  score: z.number().min(0).max(1).nullable(),
  reasonCode: CreditReasonCodeSchema,
}).strict().superRefine((dimension, context) => {
  if (dimension.status === "measured" && dimension.score === null) {
    context.addIssue({ code: "custom", message: "Measured credit requires a score." });
  }
  if (dimension.status === "unknown" && dimension.score !== null) {
    context.addIssue({ code: "custom", message: "Unknown credit cannot claim a score." });
  }
});

export const ActionCreditAssignmentSchema = z.object({
  schemaVersion: z.literal(1),
  actionId: z.string().min(1).max(200),
  effectId: z.string().min(1).max(200),
  effectBundleId: z.string().min(1).max(200),
  causalAttribution: z.object({
    status: z.literal("unproven"),
    reasonCode: z.literal("NO_CONTROLLED_COUNTERFACTUAL"),
  }).strict(),
  contributions: z.object({
    claim: CreditDimensionSchema,
    effect: CreditDimensionSchema,
    informationGain: CreditDimensionSchema,
    failure: CreditDimensionSchema,
    redundancy: CreditDimensionSchema,
  }).strict(),
  evidenceRefs: z.array(z.string().min(1).max(200)).max(128),
}).strict();

export type ActionCreditAssignment = z.infer<typeof ActionCreditAssignmentSchema>;

function unknownDimension(
  reasonCode: z.infer<typeof CreditReasonCodeSchema>,
): ActionCreditAssignment["contributions"]["claim"] {
  return { status: "unknown", score: null, reasonCode };
}

function effectDimension(input: {
  status: EffectStatus;
  observedEffectCount: number;
  expectedEffectCount: number;
}): ActionCreditAssignment["contributions"]["effect"] {
  if (
    !Number.isInteger(input.observedEffectCount)
    || input.observedEffectCount < 0
    || !Number.isInteger(input.expectedEffectCount)
    || input.expectedEffectCount < 0
    || input.observedEffectCount > input.expectedEffectCount
  ) {
    throw new Error("invalid_effect_credit_counts");
  }
  if (input.expectedEffectCount === 0) {
    return unknownDimension("NO_EXPECTED_EFFECTS");
  }
  if (input.status === "not_observed" || input.status === "pending") {
    return unknownDimension("OBSERVATION_COVERAGE_INCOMPLETE");
  }

  const score = Number((input.observedEffectCount / input.expectedEffectCount).toFixed(6));
  return {
    status: "measured",
    score,
    reasonCode: score > 0 ? "EXPECTED_EFFECT_COVERAGE" : "EXPECTED_EFFECT_NOT_OBSERVED",
  };
}

/**
 * Record bounded contribution metrics without equating an observed transition
 * with a proven causal effect. Unsupported dimensions stay null until their
 * server-owned evidence and comparison models exist.
 */
export function buildActionCreditAssignment(input: {
  actionId: string;
  effectId: string;
  effectBundleId: string;
  effectStatus: EffectStatus;
  observedEffectCount: number;
  expectedEffectCount: number;
  beforeObservationIds: readonly string[];
  afterObservationIds: readonly string[];
}): ActionCreditAssignment {
  const effect = effectDimension({
    status: input.effectStatus,
    observedEffectCount: input.observedEffectCount,
    expectedEffectCount: input.expectedEffectCount,
  });
  const evidenceRefs = [...new Set([
    input.effectId,
    input.effectBundleId,
    ...input.beforeObservationIds,
    ...input.afterObservationIds,
  ].filter((value) => typeof value === "string" && value.length > 0))].slice(0, 128);

  return ActionCreditAssignmentSchema.parse({
    schemaVersion: 1,
    actionId: input.actionId,
    effectId: input.effectId,
    effectBundleId: input.effectBundleId,
    causalAttribution: {
      status: "unproven",
      reasonCode: "NO_CONTROLLED_COUNTERFACTUAL",
    },
    contributions: {
      claim: unknownDimension("CLAIM_CLOSURE_NOT_BOUND"),
      effect,
      informationGain: unknownDimension("BELIEF_DELTA_NOT_AVAILABLE"),
      failure: unknownDimension("FAILURE_CAUSE_NOT_BOUND"),
      redundancy: unknownDimension("ACTION_COMPARISON_NOT_AVAILABLE"),
    },
    evidenceRefs,
  });
}