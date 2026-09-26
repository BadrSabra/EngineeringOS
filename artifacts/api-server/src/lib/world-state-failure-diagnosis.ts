import { z } from "zod";
import {
  diagnoseFailure,
  FailureDiagnosisSchema,
  type FailureDiagnosis,
} from "@workspace/ai-orchestrator";

export const WorldStateFailureReasonSchema = z.enum([
  "source_step_missing",
  "source_action_mismatch",
  "accepted_execution_missing",
  "accepted_transition_missing",
  "transition_terminal_failure",
  "transition_identity_invalid",
  "transition_observation_set_missing",
  "observation_rows_invalid",
  "before_state_missing",
  "before_state_contradicted",
  "after_state_missing",
  "after_state_contradicted",
  "runtime_status_missing",
  "runtime_status_contradicted",
  "session_evidence_missing",
  "project_revision_mismatch",
  "environment_revision_mismatch",
]);
export type WorldStateFailureReason = z.infer<typeof WorldStateFailureReasonSchema>;

export const WorldStateFailureDispositionSchema = z.enum([
  "retry",
  "observe",
  "replan",
  "request_approval",
  "terminate",
]);
export type WorldStateFailureDisposition = z.infer<typeof WorldStateFailureDispositionSchema>;

export const WorldStateFailureHypothesisSchema = z.enum([
  "source_step_binding_invalid",
  "runtime_effect_not_applied",
  "runtime_effect_applied_but_transition_unmaterialized",
  "runtime_effect_applied_but_not_observed",
  "runtime_state_changed_after_transition",
  "direct_observation_conflict",
  "project_revision_changed",
  "environment_revision_changed",
  "runtime_session_evidence_missing",
  "transition_observation_not_retained",
]);

export const WorldStateFailedAssumptionSchema = z.enum([
  "source_step_is_bound_to_registered_runtime_start",
  "source_runtime_start_was_accepted",
  "accepted_effect_has_materialized_transition",
  "transition_identity_matches_provenance",
  "transition_observations_are_retained_and_direct",
  "runtime_was_stopped_before_start",
  "runtime_is_running_after_start",
  "direct_runtime_status_is_running",
  "running_session_is_bound_to_transition",
  "project_revision_matches_transition",
  "environment_revision_matches_transition",
]);

export const WorldStateObservationCodeSchema = z.enum([
  "mission:active_plan_revision",
  "mission:runtime_start_source_step",
  "mission:runtime_start_source_action",
  "runtime:accepted_execution",
  "runtime:direct_status",
  "world_transition:materialization",
  "world_transition:identity",
  "world_transition:before_observations",
  "world_transition:after_observations",
  "runtime:observation_identity",
  "runtime:before_state",
  "runtime:after_state",
  "runtime:status",
  "runtime:session_evidence",
  "project:current_revision",
  "runtime:environment_revision",
]);

const RuntimeTransitionIdentitySchema = z.object({
  id: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200),
  attempt: z.number().int().nonnegative(),
  episodeId: z.string().min(1).max(200),
  actionId: z.string().min(1).max(200),
  status: z.enum(["pending", "retrying", "materialized", "terminal_failed"]),
  parentWorldRevision: z.string().max(128),
  resultingWorldRevision: z.string().max(128).nullable(),
  environmentRevision: z.string().max(128).nullable(),
}).strict();

export const WorldStateFailureDiagnosisSchema = z.object({
  version: z.literal(1),
  reasonCode: WorldStateFailureReasonSchema,
  failedAssumptionCode: WorldStateFailedAssumptionSchema,
  expectedEffectCode: z.literal("runtime_status_stopped_to_running"),
  distinguishingObservationCodes: z.array(WorldStateObservationCodeSchema).max(8),
  failureDiagnosis: FailureDiagnosisSchema,
  transition: RuntimeTransitionIdentitySchema.optional(),
  supportingObservationIds: z.array(z.string().min(1).max(200)).max(16),
  contradictingObservationIds: z.array(z.string().min(1).max(200)).max(16),
  affectedFactRefs: z.array(z.string().min(1).max(240)).max(24),
  remainingHypotheses: z.array(WorldStateFailureHypothesisSchema).max(4),
  recommendedDisposition: WorldStateFailureDispositionSchema,
}).strict().superRefine((value, context) => {
  const requiredObservationCodes: unknown[] = Array.isArray(
    value.failureDiagnosis.requiredObservations,
  ) ? value.failureDiagnosis.requiredObservations : [];
  if (
    requiredObservationCodes.length !== value.distinguishingObservationCodes.length
    || requiredObservationCodes.some((code: unknown, index: number) =>
      code !== value.distinguishingObservationCodes[index],
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["failureDiagnosis", "requiredObservations"],
      message: "Diagnosis observation requirements must match the fixed distinguishing-observation codes",
    });
  }
});
export type WorldStateFailureDiagnosis = z.infer<typeof WorldStateFailureDiagnosisSchema>;

type DiagnosisPolicy = {
  failedAssumptionCode: z.infer<typeof WorldStateFailedAssumptionSchema>;
  signal: Record<string, unknown>;
  requiredObservations: z.infer<typeof WorldStateObservationCodeSchema>[];
  retryable: boolean;
  requiresApproval: boolean;
  recommendedDisposition: WorldStateFailureDisposition;
  remainingHypotheses: z.infer<typeof WorldStateFailureHypothesisSchema>[];
};

const POLICIES: Record<WorldStateFailureReason, DiagnosisPolicy> = {
  source_step_missing: {
    failedAssumptionCode: "source_step_is_bound_to_registered_runtime_start",
    signal: { reasonCode: "PRECONDITION_FAILED" },
    requiredObservations: ["mission:active_plan_revision", "mission:runtime_start_source_step"],
    retryable: false,
    requiresApproval: true,
    recommendedDisposition: "request_approval",
    remainingHypotheses: ["source_step_binding_invalid"],
  },
  source_action_mismatch: {
    failedAssumptionCode: "source_step_is_bound_to_registered_runtime_start",
    signal: { reasonCode: "PRECONDITION_FAILED" },
    requiredObservations: ["mission:runtime_start_source_action"],
    retryable: false,
    requiresApproval: true,
    recommendedDisposition: "request_approval",
    remainingHypotheses: ["source_step_binding_invalid"],
  },
  accepted_execution_missing: {
    failedAssumptionCode: "source_runtime_start_was_accepted",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:accepted_execution", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["runtime_effect_not_applied", "runtime_effect_applied_but_not_observed"],
  },
  accepted_transition_missing: {
    failedAssumptionCode: "accepted_effect_has_materialized_transition",
    signal: { status: "unknown" },
    requiredObservations: ["world_transition:materialization", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: [
      "runtime_effect_not_applied",
      "runtime_effect_applied_but_transition_unmaterialized",
    ],
  },
  transition_terminal_failure: {
    failedAssumptionCode: "accepted_effect_has_materialized_transition",
    signal: { status: "unknown" },
    requiredObservations: ["world_transition:materialization", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: [
      "runtime_effect_not_applied",
      "runtime_effect_applied_but_transition_unmaterialized",
    ],
  },
  transition_identity_invalid: {
    failedAssumptionCode: "transition_identity_matches_provenance",
    signal: { status: "unknown" },
    requiredObservations: ["world_transition:identity", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["transition_observation_not_retained"],
  },
  transition_observation_set_missing: {
    failedAssumptionCode: "transition_observations_are_retained_and_direct",
    signal: { status: "unknown" },
    requiredObservations: ["world_transition:before_observations", "world_transition:after_observations"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["transition_observation_not_retained"],
  },
  observation_rows_invalid: {
    failedAssumptionCode: "transition_observations_are_retained_and_direct",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:direct_status", "runtime:observation_identity"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["transition_observation_not_retained"],
  },
  before_state_missing: {
    failedAssumptionCode: "runtime_was_stopped_before_start",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:before_state"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["transition_observation_not_retained"],
  },
  before_state_contradicted: {
    failedAssumptionCode: "runtime_was_stopped_before_start",
    signal: { status: "contradicted", contradictionRefs: ["runtime.before_state"] },
    requiredObservations: ["runtime:before_state", "runtime:direct_status"],
    retryable: false,
    requiresApproval: true,
    recommendedDisposition: "request_approval",
    remainingHypotheses: ["runtime_state_changed_after_transition", "direct_observation_conflict"],
  },
  after_state_missing: {
    failedAssumptionCode: "runtime_is_running_after_start",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:after_state", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["runtime_effect_not_applied", "runtime_effect_applied_but_not_observed"],
  },
  after_state_contradicted: {
    failedAssumptionCode: "runtime_is_running_after_start",
    signal: { status: "contradicted", contradictionRefs: ["runtime.after_state"] },
    requiredObservations: ["runtime:after_state", "runtime:direct_status"],
    retryable: false,
    requiresApproval: true,
    recommendedDisposition: "request_approval",
    remainingHypotheses: ["runtime_state_changed_after_transition", "direct_observation_conflict"],
  },
  runtime_status_missing: {
    failedAssumptionCode: "direct_runtime_status_is_running",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["runtime_effect_not_applied", "runtime_effect_applied_but_not_observed"],
  },
  runtime_status_contradicted: {
    failedAssumptionCode: "direct_runtime_status_is_running",
    signal: { status: "contradicted", contradictionRefs: ["runtime.status"] },
    requiredObservations: ["runtime:direct_status", "runtime:after_state"],
    retryable: false,
    requiresApproval: true,
    recommendedDisposition: "request_approval",
    remainingHypotheses: ["runtime_state_changed_after_transition", "direct_observation_conflict"],
  },
  session_evidence_missing: {
    failedAssumptionCode: "running_session_is_bound_to_transition",
    signal: { status: "unknown" },
    requiredObservations: ["runtime:session_evidence", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["runtime_session_evidence_missing", "runtime_effect_applied_but_not_observed"],
  },
  project_revision_mismatch: {
    failedAssumptionCode: "project_revision_matches_transition",
    signal: { reasonCode: "STALE_PROJECT_REVISION" },
    requiredObservations: ["project:current_revision", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["project_revision_changed", "runtime_effect_applied_but_not_observed"],
  },
  environment_revision_mismatch: {
    failedAssumptionCode: "environment_revision_matches_transition",
    signal: { reasonCode: "STALE_RUNTIME" },
    requiredObservations: ["runtime:environment_revision", "runtime:direct_status"],
    retryable: true,
    requiresApproval: false,
    recommendedDisposition: "observe",
    remainingHypotheses: ["environment_revision_changed", "runtime_effect_applied_but_not_observed"],
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanList(values: unknown[], maxItems: number, maxLength: number): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, maxItems);
}

function transitionIdentity(value: unknown): z.infer<typeof RuntimeTransitionIdentitySchema> | undefined {
  const row = record(value);
  const parsed = RuntimeTransitionIdentitySchema.safeParse({
    id: row.id,
    executionId: row.executionId,
    attempt: row.attempt,
    episodeId: row.episodeId,
    actionId: row.actionId,
    status: row.status,
    parentWorldRevision: row.parentWorldRevision,
    resultingWorldRevision: row.resultingWorldRevision ?? null,
    environmentRevision: row.environmentRevision ?? null,
  });
  return parsed.success ? parsed.data : undefined;
}

function factRefs(value: unknown): string[] {
  return Array.isArray(value) ? cleanList(value, 24, 240) : [];
}

/**
 * Derive a bounded diagnosis solely from the gate's typed failure code and
 * the exact transition/observation rows selected for that proof attempt.
 */
export function diagnoseRuntimeStartWorldStateFailure(input: {
  reasonCode: WorldStateFailureReason;
  transition?: unknown;
  supportingObservationIds?: unknown[];
  contradictingObservationIds?: unknown[];
}): WorldStateFailureDiagnosis {
  const policy = POLICIES[input.reasonCode];
  const transition = record(input.transition);
  const transitionIdentityValue = transitionIdentity(input.transition);
  const diagnosis = diagnoseFailure({
    ...(typeof transition.episodeId === "string" ? { episodeId: transition.episodeId } : {}),
    ...(typeof transition.actionId === "string" ? { actionId: transition.actionId } : {}),
    effectResult: {
      ...policy.signal,
      ...(input.contradictingObservationIds?.length
        ? { contradictionRefs: cleanList(input.contradictingObservationIds, 16, 200) }
        : {}),
    },
  });
  const affectedFactRefs = cleanList([
    ...factRefs(transition.parentFactRefs),
    ...factRefs(transition.changedFactRefs),
  ], 24, 240);
  const failureDiagnosis: FailureDiagnosis = FailureDiagnosisSchema.parse({
    ...diagnosis,
    affectedFacts: cleanList([
      ...diagnosis.affectedFacts,
      ...affectedFactRefs,
    ], 64, 256),
    requiredObservations: policy.requiredObservations,
    retryable: policy.retryable,
    requiresApproval: policy.requiresApproval,
  });

  return WorldStateFailureDiagnosisSchema.parse({
    version: 1,
    reasonCode: input.reasonCode,
    failedAssumptionCode: policy.failedAssumptionCode,
    expectedEffectCode: "runtime_status_stopped_to_running",
    distinguishingObservationCodes: policy.requiredObservations,
    failureDiagnosis,
    ...(transitionIdentityValue ? { transition: transitionIdentityValue } : {}),
    supportingObservationIds: cleanList(input.supportingObservationIds ?? [], 16, 200),
    contradictingObservationIds: cleanList(input.contradictingObservationIds ?? [], 16, 200),
    affectedFactRefs,
    remainingHypotheses: policy.remainingHypotheses,
    recommendedDisposition: policy.recommendedDisposition,
  });
}