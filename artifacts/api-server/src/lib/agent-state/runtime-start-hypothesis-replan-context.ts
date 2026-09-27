import { and, asc, eq, sql } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  db,
} from "@workspace/db";
import {
  RuntimeStartHypothesisExperimentRegistrationSchema,
  RuntimeStartHypothesisExperimentResultSchema,
  runtimeStartHypothesisCalibrationScopeRef,
} from "./runtime-start-hypothesis-experiment.js";
import {
  RuntimeStartHypothesisCalibrationAssessmentSchema,
} from "./runtime-start-hypothesis-calibration.js";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RuntimeStartHypothesisEpisodeEvent = {
  id: string;
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  sequence: number;
  eventType: string;
  actorType: string;
  correlationId: string | null;
  payload: unknown;
};

export type RuntimeStartHypothesisReplanEvidence = {
  experimentId: string;
  planRevision: string;
  calibrationScopeRef: string;
  calibrationAssessmentRef: string;
  resultId: string;
  actualOutcomeKey:
    | "runtime_running"
    | "runtime_not_running"
    | "runtime_other"
    | "runtime_unexpected";
  verdict: "matched" | "contradicted" | "inconclusive";
  observationRefs: string[];
  supportingHypothesisIds: string[];
  contradictingHypothesisIds: string[];
  beliefUpdateStatus: "unresolved_unvalidated_forecast";
};

export type RuntimeStartHypothesisReplanIdentity = {
  projectId: string;
  missionId: string;
  goalId: string;
  planRevision: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function recordKind(value: unknown): string | undefined {
  const candidate = record(value)?.recordKind;
  return typeof candidate === "string" ? candidate : undefined;
}

function sameEpisodeIdentity(
  event: RuntimeStartHypothesisEpisodeEvent,
  registration: ReturnType<typeof RuntimeStartHypothesisExperimentRegistrationSchema.parse>,
): boolean {
  return event.episodeId === registration.episodeId
    && event.projectId === registration.projectId
    && event.executionId === registration.executionId
    && event.attempt === registration.attempt
    && event.correlationId === registration.executionId
    && event.actorType === "server";
}

function assessmentIsEligible(
  assessment: ReturnType<typeof RuntimeStartHypothesisCalibrationAssessmentSchema.parse>,
  registration: ReturnType<typeof RuntimeStartHypothesisExperimentRegistrationSchema.parse>,
): boolean {
  return assessment.status === "validated_for_scope"
    && assessment.assessmentRef === registration.calibrationAssessmentRef
    && assessment.calibrationScopeRef === registration.calibrationScopeRef
    && assessment.evaluationPartition === registration.evaluationPartition
    && assessment.calibrationPolicyVersion === registration.calibrationPolicyVersion
    && assessment.registeredExperimentCount >= 30
    && assessment.usableOutcomeCount >= 30
    && assessment.independentMissionCount >= 30
    && assessment.unresolvedExperimentCount === 0
    && assessment.expectedCalibrationError !== null
    && assessment.expectedCalibrationError <= 0.15
    && assessment.eceUpperBound95 !== null
    && assessment.eceUpperBound95 <= 0.15;
}

/**
 * Produces advisory Mission context only from one fully bound, pre-run
 * calibration assessment and its complete same-episode observation result.
 * This does not identify a source path, authorize an action, update belief,
 * or satisfy Mission acceptance.
 */
export function resolveRuntimeStartHypothesisReplanEvidence(input: {
  identity: RuntimeStartHypothesisReplanIdentity;
  episodeEvents: readonly RuntimeStartHypothesisEpisodeEvent[];
  experimentResultEvents: readonly RuntimeStartHypothesisEpisodeEvent[];
}): RuntimeStartHypothesisReplanEvidence | undefined {
  const orderedEvents = [...input.episodeEvents].sort((left, right) => left.sequence - right.sequence);
  const firstSequence = orderedEvents[0]?.sequence;
  if (
    orderedEvents.length === 0
    || firstSequence === undefined
    || orderedEvents.some((event, index) => event.sequence !== firstSequence + index)
    || orderedEvents.some((event) =>
      event.episodeId !== orderedEvents[0]?.episodeId
      || event.projectId !== orderedEvents[0]?.projectId
      || event.executionId !== orderedEvents[0]?.executionId
      || event.attempt !== orderedEvents[0]?.attempt
    )
  ) {
    return undefined;
  }

  const registrations = orderedEvents.filter((event) =>
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED",
  );
  if (registrations.length !== 1) return undefined;

  const registrationEvent = registrations[0]!;
  const parsedRegistration = RuntimeStartHypothesisExperimentRegistrationSchema.safeParse(
    registrationEvent.payload,
  );
  if (!parsedRegistration.success) return undefined;
  const registration = parsedRegistration.data;
  if (
    registration.projectId !== input.identity.projectId
    || registration.missionId !== input.identity.missionId
    || registration.goalId !== input.identity.goalId
    || registration.planRevision !== input.identity.planRevision
    || registrationEvent.eventType !== "OBSERVATION_REQUESTED"
    || !sameEpisodeIdentity(registrationEvent, registration)
    || registration.calibrationStatus !== "validated_for_scope"
    || !registration.calibrationAssessmentRef
    || runtimeStartHypothesisCalibrationScopeRef({
      projectId: registration.projectId,
      projectRevision: registration.projectRevision,
      environmentRevision: registration.environmentRevision,
    }) !== registration.calibrationScopeRef
  ) {
    return undefined;
  }

  const registrationIndex = orderedEvents.findIndex((event) =>
    event.sequence === registrationEvent.sequence,
  );
  const assessments = orderedEvents.filter((event) =>
    event.sequence < registrationEvent.sequence
    && recordKind(event.payload) === "P75_HYPOTHESIS_CALIBRATION_ASSESSMENT"
    && record(event.payload)?.assessmentRef === registration.calibrationAssessmentRef,
  );
  if (assessments.length !== 1 || registrationIndex < 1) return undefined;
  const assessmentEvent = assessments[0]!;
  if (
    assessmentEvent.eventType !== "OBSERVATION_RECORDED"
    || !sameEpisodeIdentity(assessmentEvent, registration)
  ) {
    return undefined;
  }
  const parsedAssessment = RuntimeStartHypothesisCalibrationAssessmentSchema.safeParse(
    assessmentEvent.payload,
  );
  if (
    !parsedAssessment.success
    || !assessmentIsEligible(parsedAssessment.data, registration)
  ) {
    return undefined;
  }

  const matchingResults = input.experimentResultEvents.filter((event) =>
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_RESULT",
  );
  if (
    matchingResults.length !== 1
    || record(matchingResults[0]?.payload)?.experimentId !== registration.experimentId
  ) {
    return undefined;
  }
  const resultEvent = matchingResults[0]!;
  const parsedResult = RuntimeStartHypothesisExperimentResultSchema.safeParse(resultEvent.payload);
  if (!parsedResult.success) return undefined;
  const result = parsedResult.data;
  const episodeResultEvent = input.episodeEvents.find((event) => event.id === resultEvent.id);
  if (
    result.experimentId !== registration.experimentId
    || result.missionId !== registration.missionId
    || result.calibrationScopeRef !== registration.calibrationScopeRef
    || result.evaluationPartition !== registration.evaluationPartition
    || result.measurementValidity !== "complete_fresh"
    || result.environmentStatus !== "same_scope"
    || result.beliefUpdateStatus !== "unresolved_unvalidated_forecast"
    || resultEvent.eventType !== "OBSERVATION_RECORDED"
    || resultEvent.sequence <= registrationEvent.sequence
    || !sameEpisodeIdentity(resultEvent, registration)
    || !episodeResultEvent
    || episodeResultEvent.eventType !== resultEvent.eventType
    || episodeResultEvent.sequence !== resultEvent.sequence
    || !sameEpisodeIdentity(episodeResultEvent, registration)
    || record(episodeResultEvent.payload)?.experimentId !== registration.experimentId
    || record(episodeResultEvent.payload)?.resultId !== result.resultId
  ) {
    return undefined;
  }

  return {
    experimentId: registration.experimentId,
    planRevision: registration.planRevision,
    calibrationScopeRef: registration.calibrationScopeRef,
    calibrationAssessmentRef: registration.calibrationAssessmentRef,
    resultId: result.resultId,
    actualOutcomeKey: result.actualOutcomeKey!,
    verdict: result.verdict,
    observationRefs: result.observationRefs.slice(0, 16),
    supportingHypothesisIds: result.supportingHypothesisIds.slice(0, 3),
    contradictingHypothesisIds: result.contradictingHypothesisIds.slice(0, 3),
    beliefUpdateStatus: result.beliefUpdateStatus,
  };
}

/**
 * Loads at most one P7.5 experiment for the failed Goal. Multiple attempts or
 * conflicting registrations intentionally suppress this advisory context.
 */
export async function loadRuntimeStartHypothesisReplanEvidence(
  tx: DatabaseTransaction,
  identity: RuntimeStartHypothesisReplanIdentity,
): Promise<RuntimeStartHypothesisReplanEvidence | undefined> {
  const registrationRows = await tx
    .select()
    .from(aiAgentEpisodeEventsTable)
    .where(and(
      eq(aiAgentEpisodeEventsTable.projectId, identity.projectId),
      sql`${aiAgentEpisodeEventsTable.payload}->>'recordKind' = 'P75_HYPOTHESIS_EXPERIMENT_REGISTERED'`,
      sql`${aiAgentEpisodeEventsTable.payload}->>'missionId' = ${identity.missionId}`,
      sql`${aiAgentEpisodeEventsTable.payload}->>'goalId' = ${identity.goalId}`,
    ))
    .orderBy(asc(aiAgentEpisodeEventsTable.sequence))
    .limit(2);
  if (registrationRows.length !== 1) return undefined;

  const candidate = RuntimeStartHypothesisExperimentRegistrationSchema.safeParse(
    registrationRows[0]!.payload,
  );
  if (
    !candidate.success
    || candidate.data.projectId !== identity.projectId
    || candidate.data.missionId !== identity.missionId
    || candidate.data.goalId !== identity.goalId
    || candidate.data.planRevision !== identity.planRevision
    || candidate.data.episodeId !== registrationRows[0]!.episodeId
    || candidate.data.executionId !== registrationRows[0]!.executionId
    || candidate.data.attempt !== registrationRows[0]!.attempt
  ) {
    return undefined;
  }

  const [episodeEvents, resultEvents] = await Promise.all([
    tx
      .select({
        id: aiAgentEpisodeEventsTable.id,
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        projectId: aiAgentEpisodeEventsTable.projectId,
        executionId: aiAgentEpisodeEventsTable.executionId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
        eventType: aiAgentEpisodeEventsTable.eventType,
        actorType: aiAgentEpisodeEventsTable.actorType,
        correlationId: aiAgentEpisodeEventsTable.correlationId,
        payload: aiAgentEpisodeEventsTable.payload,
      })
      .from(aiAgentEpisodeEventsTable)
      .where(eq(aiAgentEpisodeEventsTable.episodeId, candidate.data.episodeId))
      .orderBy(asc(aiAgentEpisodeEventsTable.sequence))
      .limit(512),
    tx
      .select({
        id: aiAgentEpisodeEventsTable.id,
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        projectId: aiAgentEpisodeEventsTable.projectId,
        executionId: aiAgentEpisodeEventsTable.executionId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
        eventType: aiAgentEpisodeEventsTable.eventType,
        actorType: aiAgentEpisodeEventsTable.actorType,
        correlationId: aiAgentEpisodeEventsTable.correlationId,
        payload: aiAgentEpisodeEventsTable.payload,
      })
      .from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.projectId, identity.projectId),
        sql`${aiAgentEpisodeEventsTable.payload}->>'recordKind' = 'P75_HYPOTHESIS_EXPERIMENT_RESULT'`,
        sql`${aiAgentEpisodeEventsTable.payload}->>'experimentId' = ${candidate.data.experimentId}`,
      ))
      .orderBy(asc(aiAgentEpisodeEventsTable.sequence))
      .limit(2),
  ]);
  if (episodeEvents.length >= 512 || resultEvents.length !== 1) return undefined;

  return resolveRuntimeStartHypothesisReplanEvidence({
    identity,
    episodeEvents,
    experimentResultEvents: resultEvents,
  });
}