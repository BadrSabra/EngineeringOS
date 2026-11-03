import { z } from "zod";
import {
  MissionDecisionTraceSchema,
  MissionStrategyOutcomeEvaluationSchema,
} from "./mission-decision-contract.js";
import type { MissionStrategyOutcomeEvaluation } from "./mission-decision-contract.js";

const boundedId = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const observationIdList = z.array(boundedId).max(200);
const expectedEffectValue = z.union([z.string().max(200), z.record(z.string(), z.unknown())]);

const OutcomeEvidenceInputSchema = z.object({
  trace: MissionDecisionTraceSchema,
  lifecycleEvents: z.array(z.object({
    stage: z.string().min(1).max(80),
    sequence: z.number().int().positive(),
    referenceId: boundedId.nullable(),
  }).strict()).max(32),
  execution: z.object({
    id: boundedId,
    projectId: boundedId,
    missionId: boundedId,
    goalId: boundedId,
    attempt: z.number().int().nonnegative(),
    planRevision: boundedId,
  }).strict(),
  acceptance: z.object({
    id: boundedId,
    projectId: boundedId,
    executionId: boundedId,
    attempt: z.number().int().nonnegative(),
    terminalStatus: z.string().min(1).max(80),
    outcome: z.string().min(1).max(80),
    evidenceComplete: z.boolean(),
    effectBundleId: boundedId.nullable(),
  }).strict(),
  effectBundle: z.object({
    id: boundedId,
    projectId: boundedId,
    executionId: boundedId,
    attempt: z.number().int().nonnegative(),
    verdict: z.enum(["observed", "not_observed", "contradicted", "partial", "unknown"]),
    effectIds: observationIdList,
    effectContractHashes: z.array(hash).max(200),
    worldStateRevision: boundedId.nullable(),
  }).strict(),
  effects: z.array(z.object({
    id: boundedId,
    projectId: boundedId,
    executionId: boundedId,
    attempt: z.number().int().nonnegative(),
    actionId: boundedId,
    effectContractHash: hash,
    status: z.enum(["observed", "not_observed", "contradicted", "partial", "unknown"]),
    expectedEffects: z.array(expectedEffectValue).max(64),
    missingEffects: z.array(expectedEffectValue).max(64),
    beforeObservationIds: observationIdList,
    afterObservationIds: observationIdList,
  }).strict()).max(200),
  observations: z.array(z.object({
    id: boundedId,
    projectId: boundedId,
    executionId: boundedId,
    attempt: z.number().int().nonnegative(),
    completeness: z.enum(["complete", "partial", "failed"]),
    freshness: z.enum(["fresh", "stale", "unknown"]),
    worldStateRevision: boundedId.nullable(),
  }).strict()).max(400),
  canonicalProof: z.object({
    status: z.enum(["PROVEN", "INCOMPLETE", "UNAVAILABLE"]),
    verifiedOutcome: z.literal("ACHIEVED").nullable(),
    proofId: boundedId,
    proofHash: hash,
    projectId: boundedId,
    missionId: boundedId,
    goalId: boundedId,
    executionId: boundedId,
    acceptanceId: boundedId,
    attempt: z.number().int().nonnegative(),
    planRevision: boundedId,
    worldStateRevision: boundedId.nullable(),
  }).strict().nullable(),
  currentWorldStateRevision: boundedId.nullable(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

export type MissionStrategyOutcomeEvidence = z.input<typeof OutcomeEvidenceInputSchema>;

function distinctSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function codesFromExpectedEffect(value: unknown): string[] {
  if (typeof value === "string" && value.length > 0) return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  for (const key of ["effectCode", "code"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) return [candidate];
  }
  return [];
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().join("\n") === [...right].sort().join("\n");
}

function lifecycleReference(
  events: readonly { stage: string; sequence: number; referenceId: string | null }[],
  stage: string,
): string | null {
  return events.find((event) => event.stage === stage)?.referenceId ?? null;
}

/**
 * Deterministically compares a selected strategy with server-resolved execution
 * and proof evidence. This function is not an evidence loader or proof verifier:
 * the API adapter must reload and validate each database row and Canonical Proof
 * before calling it. Missing or mismatched evidence produces INCONCLUSIVE.
 */
export function evaluateMissionStrategyOutcome(
  input: MissionStrategyOutcomeEvidence,
): MissionStrategyOutcomeEvaluation {
  const parsed = OutcomeEvidenceInputSchema.safeParse(input);
  const fallbackTrace = parsed.success
    ? parsed.data.trace
    : MissionDecisionTraceSchema.parse(input?.trace);
  const identity = fallbackTrace.context.identity;
  const fallbackExecutionId = boundedId.safeParse(input?.execution?.id).success
    ? input.execution.id
    : "invalid-execution";
  const fallbackExecutionAttempt = Number.isSafeInteger(input?.execution?.attempt)
    && input.execution.attempt >= 0
    ? input.execution.attempt
    : 0;
  const execution = parsed.success
    ? parsed.data.execution
    : {
      id: fallbackExecutionId,
      attempt: fallbackExecutionAttempt,
      planRevision: boundedId.safeParse(input?.execution?.planRevision).success
        ? input.execution.planRevision
        : fallbackTrace.priorPlanRevision,
    };
  const selectedStrategyId = fallbackTrace.result.kind === "SELECTED"
    ? fallbackTrace.result.selectedStrategyId
    : "no_selected_strategy";
  const appliedPlanRevision = parsed.success
    ? lifecycleReference(parsed.data.lifecycleEvents, "PLAN_APPLIED")
    : null;

  const makeEvaluation = (
    outcome: "ACHIEVED" | "NOT_ACHIEVED" | "INCONCLUSIVE",
    options: {
      acceptanceId?: string | null;
      effectBundleId?: string | null;
      observedEffectCodes?: string[];
      supportingEvidenceIds?: string[];
      contradictingEvidenceIds?: string[];
      worldStateRevision?: string | null;
      limitationCodes: string[];
    },
  ): MissionStrategyOutcomeEvaluation => MissionStrategyOutcomeEvaluationSchema.parse({
    schemaVersion: 1,
    decisionId: fallbackTrace.decisionId,
    missionId: identity.missionId,
    goalId: identity.goalId,
    executionId: execution.id,
    attempt: execution.attempt,
    planRevision: appliedPlanRevision ?? execution.planRevision,
    selectedStrategyId,
    outcome,
    acceptanceId: options.acceptanceId ?? null,
    effectBundleId: options.effectBundleId ?? null,
    observedEffectCodes: distinctSorted(options.observedEffectCodes ?? []),
    supportingEvidenceIds: distinctSorted(options.supportingEvidenceIds ?? []).slice(0, 200),
    contradictingEvidenceIds: distinctSorted(options.contradictingEvidenceIds ?? []).slice(0, 200),
    worldStateRevision: options.worldStateRevision ?? null,
    evaluatedAt: parsed.success
      ? parsed.data.evaluatedAt
      : z.string().datetime({ offset: true }).safeParse(input?.evaluatedAt).success
        ? input.evaluatedAt
        : fallbackTrace.decidedAt,
    limitationCodes: distinctSorted(options.limitationCodes).slice(0, 24),
  });

  if (!parsed.success) {
    return makeEvaluation("INCONCLUSIVE", {
      limitationCodes: ["outcome_evidence_schema_invalid"],
    });
  }
  const data = parsed.data;
  const invalidIdentity = data.trace.result.kind !== "SELECTED"
    || data.trace.result.selectedStrategyId !== selectedStrategyId
    || data.execution.projectId !== identity.projectId
    || data.execution.missionId !== identity.missionId
    || data.execution.goalId !== identity.goalId
    || data.acceptance.projectId !== identity.projectId
    || data.acceptance.executionId !== data.execution.id
    || data.acceptance.attempt !== data.execution.attempt
    || data.acceptance.effectBundleId !== data.effectBundle.id
    || data.effectBundle.projectId !== identity.projectId
    || data.effectBundle.executionId !== data.execution.id
    || data.effectBundle.attempt !== data.execution.attempt
    || data.execution.planRevision !== appliedPlanRevision
    || lifecycleReference(data.lifecycleEvents, "DISPATCHED") !== data.execution.id
    || lifecycleReference(data.lifecycleEvents, "EXECUTED") !== data.execution.id
    || lifecycleReference(data.lifecycleEvents, "ACCEPTED") !== data.acceptance.id
    || data.lifecycleEvents.length !== 8
    || !["PROPOSED", "EVALUATED", "SELECTED", "PLAN_APPLIED", "DISPATCHED", "EXECUTED", "ACCEPTED", "VERIFIED"]
      .every((stage, index) => data.lifecycleEvents[index]?.stage === stage
        && data.lifecycleEvents[index]?.sequence === index + 1);
  if (invalidIdentity) {
    return makeEvaluation("INCONCLUSIVE", {
      acceptanceId: null,
      effectBundleId: null,
      limitationCodes: ["outcome_lifecycle_identity_mismatch"],
    });
  }

  const strategy = data.trace.alternatives.find((alternative) =>
    alternative.strategyId === selectedStrategyId);
  const expectedCodes = strategy ? distinctSorted(strategy.expectedEffectCodes) : [];
  if (!strategy || expectedCodes.length === 0) {
    return makeEvaluation("INCONCLUSIVE", {
      acceptanceId: data.acceptance.id,
      effectBundleId: data.effectBundle.id,
      limitationCodes: ["selected_effect_contract_missing"],
    });
  }

  const effectIds = data.effects.map((effect) => effect.id);
  const effectHashes = data.effects.map((effect) => effect.effectContractHash);
  if (
    !sameMultiset(data.effectBundle.effectIds, effectIds)
    || !sameMultiset(data.effectBundle.effectContractHashes, effectHashes)
    || new Set(effectIds).size !== effectIds.length
    || new Set(data.observations.map((observation) => observation.id)).size !== data.observations.length
  ) {
    return makeEvaluation("INCONCLUSIVE", {
      acceptanceId: data.acceptance.id,
      effectBundleId: data.effectBundle.id,
      limitationCodes: ["effect_bundle_membership_mismatch"],
    });
  }

  const observations = new Map(data.observations.map((observation) => [observation.id, observation]));
  const validObservationIds = new Set<string>();
  for (const observation of data.observations) {
    if (
      observation.projectId === identity.projectId
      && observation.executionId === data.execution.id
      && observation.attempt === data.execution.attempt
      && observation.completeness === "complete"
      && observation.freshness === "fresh"
      && observation.worldStateRevision !== null
    ) {
      validObservationIds.add(observation.id);
    }
  }

  const observedCodes: string[] = [];
  const contradictedCodes: string[] = [];
  const supportingIds = [data.acceptance.id, data.effectBundle.id];
  const contradictingIds: string[] = [];
  let allEffectsHaveDirectObservations = data.effects.length > 0;
  for (const effect of data.effects) {
    if (
      effect.projectId !== identity.projectId
      || effect.executionId !== data.execution.id
      || effect.attempt !== data.execution.attempt
    ) {
      allEffectsHaveDirectObservations = false;
      continue;
    }
    const observationIds = [...effect.beforeObservationIds, ...effect.afterObservationIds];
    const hasBeforeAndAfter = effect.beforeObservationIds.length > 0
      && effect.afterObservationIds.length > 0;
    const hasFreshPairs = hasBeforeAndAfter
      && observationIds.every((id) => validObservationIds.has(id))
      && observationIds.every((id) => observations.has(id));
    const afterObservationsMatchCurrentWorld = effect.afterObservationIds.length > 0
      && effect.afterObservationIds.every((id) =>
        observations.get(id)?.worldStateRevision === data.currentWorldStateRevision);
    if (!hasFreshPairs || !afterObservationsMatchCurrentWorld) allEffectsHaveDirectObservations = false;
    const expected = distinctSorted(effect.expectedEffects.flatMap(codesFromExpectedEffect));
    const missing = distinctSorted(effect.missingEffects.flatMap(codesFromExpectedEffect));
    if (effect.status === "observed" && hasFreshPairs && afterObservationsMatchCurrentWorld) {
      observedCodes.push(...expected);
      supportingIds.push(effect.id, ...observationIds);
    } else if (
      (effect.status === "not_observed" || effect.status === "contradicted")
      && hasFreshPairs
      && afterObservationsMatchCurrentWorld
    ) {
      contradictedCodes.push(...(missing.length > 0 ? missing : expected));
      contradictingIds.push(effect.id, ...effect.afterObservationIds);
    }
  }
  const observed = distinctSorted(observedCodes);
  const contradicted = distinctSorted(contradictedCodes);
  const allExpectedObserved = expectedCodes.every((code) => observed.includes(code));
  const allExpectedContradicted = expectedCodes.every((code) => contradicted.includes(code));
  const proof = data.canonicalProof;
  const proofMatches = proof !== null
    && proof.status === "PROVEN"
    && proof.verifiedOutcome === "ACHIEVED"
    && proof.projectId === identity.projectId
    && proof.missionId === identity.missionId
    && proof.goalId === identity.goalId
    && proof.executionId === data.execution.id
    && proof.acceptanceId === data.acceptance.id
    && proof.attempt === data.execution.attempt
    && proof.planRevision === appliedPlanRevision
    && proof.worldStateRevision === data.currentWorldStateRevision
    && lifecycleReference(data.lifecycleEvents, "VERIFIED") === proof.proofId;
  const proofClaimsSameExecution = proof?.status === "PROVEN"
    && proof.executionId === data.execution.id
    && proof.acceptanceId === data.acceptance.id
    && proof.attempt === data.execution.attempt;

  const outcomeEvidenceValid = data.acceptance.evidenceComplete
    && allEffectsHaveDirectObservations
    && data.currentWorldStateRevision !== null
    && data.effectBundle.worldStateRevision === data.currentWorldStateRevision;
  const acceptedSuccess = data.acceptance.terminalStatus === "completed"
    && data.acceptance.outcome === "success";
  if (
    outcomeEvidenceValid
    && acceptedSuccess
    && data.effectBundle.verdict === "observed"
    && allExpectedObserved
    && proofMatches
  ) {
    return makeEvaluation("ACHIEVED", {
      acceptanceId: data.acceptance.id,
      effectBundleId: data.effectBundle.id,
      observedEffectCodes: observed,
      supportingEvidenceIds: [...supportingIds, proof.proofId],
      worldStateRevision: data.currentWorldStateRevision,
      limitationCodes: [],
    });
  }
  if (
    outcomeEvidenceValid
    && ["failed", "interrupted", "completed"].includes(data.acceptance.terminalStatus)
    && ["failure", "failed", "incomplete", "blocked"].includes(data.acceptance.outcome)
    && ["not_observed", "contradicted"].includes(data.effectBundle.verdict)
    && allExpectedContradicted
    && !proofClaimsSameExecution
  ) {
    return makeEvaluation("NOT_ACHIEVED", {
      acceptanceId: data.acceptance.id,
      effectBundleId: data.effectBundle.id,
      observedEffectCodes: observed,
      supportingEvidenceIds: supportingIds,
      contradictingEvidenceIds: contradictingIds,
      worldStateRevision: data.currentWorldStateRevision,
      limitationCodes: [],
    });
  }

  const limitations = [
    ...(!data.acceptance.evidenceComplete ? ["acceptance_evidence_incomplete"] : []),
    ...(!allEffectsHaveDirectObservations ? ["fresh_before_after_effect_evidence_missing"] : []),
    ...(!allExpectedObserved && !allExpectedContradicted ? ["selected_effects_not_fully_resolved"] : []),
    ...(data.currentWorldStateRevision === null
      || data.effectBundle.worldStateRevision !== data.currentWorldStateRevision
      ? ["world_state_revision_unbound"]
      : []),
    ...(!proofMatches ? ["canonical_proof_not_revalidated"] : []),
    ...(acceptedSuccess && contradicted.length > 0 ? ["acceptance_effect_evidence_conflict"] : []),
    ...(!acceptedSuccess && proofClaimsSameExecution && contradicted.length > 0
      ? ["canonical_proof_outcome_conflict"]
      : []),
  ];
  return makeEvaluation("INCONCLUSIVE", {
    acceptanceId: data.acceptance.id,
    effectBundleId: data.effectBundle.id,
    observedEffectCodes: observed,
    supportingEvidenceIds: supportingIds,
    contradictingEvidenceIds: contradicted.length > 0 ? contradictingIds : [],
    worldStateRevision: data.currentWorldStateRevision,
    limitationCodes: limitations.length > 0 ? limitations : ["outcome_not_proven"],
  });
}
