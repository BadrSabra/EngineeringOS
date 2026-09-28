import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  db,
} from "@workspace/db";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  RuntimeStartCalibrationCandidateScopeSchema,
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
  type RuntimeStartCalibrationCandidateScope,
  type RuntimeStartCalibrationReadinessReport,
  evaluateRuntimeStartHypothesisCalibrationReadiness,
} from "./runtime-start-hypothesis-calibration-readiness.js";
import {
  RuntimeStartHypothesisExperimentRegistrationSchema,
  RuntimeStartHypothesisExperimentResultSchema,
  runtimeStartHypothesisCalibrationScopeRef,
} from "./runtime-start-hypothesis-experiment.js";

const MAX_SCOPED_EXPERIMENT_EVENTS =
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS * 4;
const MAX_EPISODE_STREAM_EVENTS =
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS * 20;
const EXPERIMENT_RECORD_KIND_PREFIX = "P75_HYPOTHESIS_EXPERIMENT";

export type RuntimeStartHypothesisLedgerEventEvidence = {
  eventId: string;
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  sequence: number;
  eventType: string;
  payload: unknown;
  payloadHash: string;
  actorType: string;
  actorId: string | null;
  correlationId: string | null;
};

export type RuntimeStartHypothesisLedgerEpisodeEvidence = {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  missionId: string | null;
  goalId: string | null;
  projectRevision: string;
  environmentRevision: string | null;
  planRevision: string | null;
  actionRefs: unknown;
};

export type RuntimeStartHypothesisLedgerStreamEvent = {
  eventId: string;
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  sequence: number;
  eventType: string;
  payloadHash: string;
};

export type RuntimeStartHypothesisLedgerSnapshot = {
  experimentEvents: readonly RuntimeStartHypothesisLedgerEventEvidence[];
  episodes: readonly RuntimeStartHypothesisLedgerEpisodeEvidence[];
  episodeEvents: readonly RuntimeStartHypothesisLedgerStreamEvent[];
  overflow: boolean;
};

export type RuntimeStartHypothesisLedgerEvidenceRef = {
  kind: "episode-ledger-event" | "episode-ledger-manifest";
  ref: string;
  hash: string;
};

export type RuntimeStartHypothesisLedgerVerification = {
  status: "verified" | "blocked" | "review_required";
  detail: string;
  ledgerManifestHash: string | null;
  evidenceRefs: RuntimeStartHypothesisLedgerEvidenceRef[];
  blockers: string[];
};

function hashJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("P7.5 ledger evidence must be JSON-serializable.");
  }
  return canonicalJsonHash(
    JSON.parse(serialized) as Parameters<typeof canonicalJsonHash>[0],
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function recordKind(value: unknown): string | undefined {
  const kind = asRecord(value)?.recordKind;
  return typeof kind === "string" ? kind : undefined;
}

function experimentId(value: unknown): string | undefined {
  const id = asRecord(value)?.experimentId;
  return typeof id === "string" ? id : undefined;
}

function sourceRecord(
  registrationEvent: RuntimeStartHypothesisLedgerEventEvidence | undefined,
  resultEvent: RuntimeStartHypothesisLedgerEventEvidence | undefined,
): unknown {
  const registration = asRecord(registrationEvent?.payload);
  const result = asRecord(resultEvent?.payload);
  const source = registration ?? result ?? {};
  return {
    experimentId: source.experimentId,
    missionId: source.missionId,
    calibrationScopeRef: source.calibrationScopeRef,
    ...(registrationEvent ? { registration: registrationEvent.payload } : {}),
    ...(resultEvent ? { result: resultEvent.payload } : {}),
  };
}

/**
 * Reconstructs the preflight's source records from persisted P7.5 experiment
 * events. Multiple outcomes remain separate records so the preflight can detect
 * conflicting results instead of selecting one.
 */
export function runtimeStartHypothesisExperimentsFromLedger(
  snapshot: RuntimeStartHypothesisLedgerSnapshot,
): unknown[] {
  const registrations = snapshot.experimentEvents.filter((event) => (
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
  ));
  const results = snapshot.experimentEvents.filter((event) => (
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_RESULT"
  ));
  const resultsById = new Map<string, RuntimeStartHypothesisLedgerEventEvidence[]>();
  for (const result of results) {
    const id = experimentId(result.payload);
    if (!id) continue;
    const group = resultsById.get(id) ?? [];
    group.push(result);
    resultsById.set(id, group);
  }

  const registeredIds = new Set<string>();
  const records: unknown[] = [];
  for (const registration of registrations) {
    const id = experimentId(registration.payload);
    if (id) registeredIds.add(id);
    const candidates = id ? resultsById.get(id) ?? [] : [];
    if (candidates.length === 0) {
      records.push(sourceRecord(registration, undefined));
      continue;
    }
    for (const result of candidates) {
      records.push(sourceRecord(registration, result));
    }
  }

  for (const result of results) {
    const id = experimentId(result.payload);
    if (!id || !registeredIds.has(id)) {
      records.push(sourceRecord(undefined, result));
    }
  }
  return records;
}

function episodeIdentityMatchesRegistration(
  episode: RuntimeStartHypothesisLedgerEpisodeEvidence | undefined,
  registration: ReturnType<typeof RuntimeStartHypothesisExperimentRegistrationSchema.parse>,
): boolean {
  return Boolean(
    episode
    && episode.episodeId === registration.episodeId
    && episode.projectId === registration.projectId
    && episode.executionId === registration.executionId
    && episode.attempt === registration.attempt
    && episode.missionId === registration.missionId
    && episode.goalId === registration.goalId
    && episode.projectRevision === registration.projectRevision
    && episode.environmentRevision === registration.environmentRevision
    && episode.planRevision === registration.planRevision
    && Array.isArray(episode.actionRefs)
    && episode.actionRefs.includes(registration.actionId),
  );
}

function eventRowMatchesStream(
  event: RuntimeStartHypothesisLedgerEventEvidence,
  streamEvent: RuntimeStartHypothesisLedgerStreamEvent | undefined,
): boolean {
  return Boolean(
    streamEvent
    && streamEvent.eventId === event.eventId
    && streamEvent.episodeId === event.episodeId
    && streamEvent.projectId === event.projectId
    && streamEvent.executionId === event.executionId
    && streamEvent.attempt === event.attempt
    && streamEvent.sequence === event.sequence
    && streamEvent.eventType === event.eventType
    && streamEvent.payloadHash === event.payloadHash,
  );
}

function episodeStreamIsContiguous(
  events: readonly RuntimeStartHypothesisLedgerStreamEvent[],
): boolean {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  return ordered.length > 0 && ordered.every((event, index) => (
    event.sequence === index
    && event.episodeId === ordered[0]!.episodeId
    && event.projectId === ordered[0]!.projectId
    && event.executionId === ordered[0]!.executionId
    && event.attempt === ordered[0]!.attempt
  ));
}

/**
 * Verifies P7.5 source records against their durable Episode rows and event
 * stream. A hash reference alone is not accepted as ownership proof.
 */
export function verifyRuntimeStartHypothesisLedgerEvidence(input: {
  candidateScope: unknown;
  experiments: readonly unknown[];
  report: RuntimeStartCalibrationReadinessReport;
  snapshot: RuntimeStartHypothesisLedgerSnapshot;
}): RuntimeStartHypothesisLedgerVerification {
  const scopeParse = RuntimeStartCalibrationCandidateScopeSchema.safeParse(
    input.candidateScope,
  );
  const scope = scopeParse.success ? scopeParse.data : undefined;
  const expectedScopeRef = scope
    ? runtimeStartHypothesisCalibrationScopeRef(scope)
    : null;
  const blockers = new Set<string>();
  const eventRefs: RuntimeStartHypothesisLedgerEvidenceRef[] = [];

  if (!scope) blockers.add("candidate-scope-invalid");
  if (input.snapshot.overflow) blockers.add("episode-ledger-snapshot-overflow");

  const reconstructedReport = evaluateRuntimeStartHypothesisCalibrationReadiness({
    candidateScope: input.candidateScope,
    experiments: input.experiments,
  });
  if (reconstructedReport.readinessRef !== input.report.readinessRef) {
    blockers.add("readiness-source-manifest-mismatch");
  }

  const eventIds = new Set<string>();
  const episodeIds = new Set<string>();
  const episodeById = new Map<string, RuntimeStartHypothesisLedgerEpisodeEvidence>();
  const streamByEpisode = new Map<string, RuntimeStartHypothesisLedgerStreamEvent[]>();

  for (const event of input.snapshot.experimentEvents) {
    if (eventIds.has(event.eventId)) blockers.add("duplicate-ledger-event-id");
    eventIds.add(event.eventId);
    eventRefs.push({
      kind: "episode-ledger-event",
      ref: `p75-episode-event:${event.eventId}`,
      hash: event.payloadHash,
    });
    if (hashJson(event.payload) !== event.payloadHash) {
      blockers.add("p75-event-payload-hash-mismatch");
    }
    const kind = recordKind(event.payload);
    if (
      kind?.startsWith(EXPERIMENT_RECORD_KIND_PREFIX)
      && kind !== "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
      && kind !== "P75_HYPOTHESIS_EXPERIMENT_RESULT"
    ) {
      blockers.add("unsupported-p75-experiment-record-kind");
    }
  }

  for (const episode of input.snapshot.episodes) {
    if (episodeIds.has(episode.episodeId)) blockers.add("duplicate-episode-row");
    episodeIds.add(episode.episodeId);
    episodeById.set(episode.episodeId, episode);
  }

  const streamEventIds = new Set<string>();
  for (const event of input.snapshot.episodeEvents) {
    if (streamEventIds.has(event.eventId)) blockers.add("duplicate-episode-stream-event-id");
    streamEventIds.add(event.eventId);
    const group = streamByEpisode.get(event.episodeId) ?? [];
    group.push(event);
    streamByEpisode.set(event.episodeId, group);
  }

  const registrationsById = new Map<string, Array<{
    registration: ReturnType<typeof RuntimeStartHypothesisExperimentRegistrationSchema.parse>;
    event: RuntimeStartHypothesisLedgerEventEvidence;
  }>>();
  const registrationEvents = input.snapshot.experimentEvents.filter((event) => (
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
  ));
  const resultEvents = input.snapshot.experimentEvents.filter((event) => (
    recordKind(event.payload) === "P75_HYPOTHESIS_EXPERIMENT_RESULT"
  ));

  if (
    input.report.registeredExperimentCount > 0
    && registrationEvents.length === 0
  ) {
    blockers.add("registered-records-missing-ledger-events");
  }

  for (const event of registrationEvents) {
    const parsed = RuntimeStartHypothesisExperimentRegistrationSchema.safeParse(
      event.payload,
    );
    if (!parsed.success) {
      blockers.add("invalid-p75-registration-event");
      continue;
    }
    const registration = parsed.data;
    const registrationEventMatches = event.eventType === "OBSERVATION_REQUESTED"
      && event.actorType === "server"
      && typeof event.actorId === "string"
      && event.actorId.length > 0
      && event.correlationId === registration.executionId
      && event.episodeId === registration.episodeId
      && event.projectId === registration.projectId
      && event.executionId === registration.executionId
      && event.attempt === registration.attempt
      && registration.calibrationScopeRef === expectedScopeRef
      && registration.projectId === scope?.projectId;
    if (!registrationEventMatches) blockers.add("registration-event-owner-mismatch");

    const episode = episodeById.get(registration.episodeId);
    if (!episodeIdentityMatchesRegistration(episode, registration)) {
      blockers.add("registration-episode-row-mismatch");
    }

    const stream = streamByEpisode.get(registration.episodeId) ?? [];
    if (!episodeStreamIsContiguous(stream)) blockers.add("episode-event-stream-invalid");
    if (!eventRowMatchesStream(event, stream.find((item) => item.eventId === event.eventId))) {
      blockers.add("registration-event-not-in-episode-stream");
    }

    const existing = registrationsById.get(registration.experimentId) ?? [];
    existing.push({ registration, event });
    registrationsById.set(registration.experimentId, existing);
  }

  for (const [id, registrations] of registrationsById) {
    if (registrations.length !== 1) blockers.add(`duplicate-registration:${id}`);
  }

  for (const event of resultEvents) {
    const parsed = RuntimeStartHypothesisExperimentResultSchema.safeParse(event.payload);
    if (!parsed.success) {
      blockers.add("invalid-p75-result-event");
      continue;
    }
    const result = parsed.data;
    const registrations = registrationsById.get(result.experimentId) ?? [];
    if (registrations.length !== 1) {
      blockers.add(`result-registration-binding-invalid:${result.experimentId}`);
      continue;
    }
    const { registration, event: registrationEvent } = registrations[0]!;
    const resultEventMatches = event.eventType === "OBSERVATION_RECORDED"
      && event.actorType === "server"
      && typeof event.actorId === "string"
      && event.actorId.length > 0
      && event.correlationId === registration.executionId
      && event.episodeId === registration.episodeId
      && event.projectId === registration.projectId
      && event.executionId === registration.executionId
      && event.attempt === registration.attempt
      && result.experimentId === registration.experimentId
      && result.missionId === registration.missionId
      && result.calibrationScopeRef === registration.calibrationScopeRef
      && event.sequence > registrationEvent.sequence;
    if (!resultEventMatches) blockers.add("result-event-owner-or-order-mismatch");

    const stream = streamByEpisode.get(registration.episodeId) ?? [];
    if (!eventRowMatchesStream(event, stream.find((item) => item.eventId === event.eventId))) {
      blockers.add("result-event-not-in-episode-stream");
    }
  }

  if (
    input.report.registeredExperimentCount === 0
    && input.snapshot.experimentEvents.length === 0
  ) {
    const ledgerManifestHash = hashJson({
      candidateScope: scope ?? null,
      experimentEvents: [],
      episodes: [],
      episodeEvents: [],
      overflow: input.snapshot.overflow,
    });
    return {
      status: blockers.size > 0 ? "blocked" : "review_required",
      detail: blockers.size > 0
        ? "The candidate scope or empty ledger snapshot failed its integrity checks."
        : "No P7.5 experiment ledger events exist in this scope to establish Episode ownership.",
      ledgerManifestHash,
      evidenceRefs: [{
        kind: "episode-ledger-manifest",
        ref: `p75-episode-ledger-manifest:${ledgerManifestHash}`,
        hash: ledgerManifestHash,
      }],
      blockers: [...blockers].sort(),
    };
  }

  for (const event of input.snapshot.experimentEvents) {
    if (
      event.eventType !== "OBSERVATION_REQUESTED"
      && event.eventType !== "OBSERVATION_RECORDED"
    ) {
      blockers.add("p75-event-type-mismatch");
    }
  }

  const ledgerManifestHash = hashJson({
    candidateScope: scope ?? null,
    experimentEvents: [...input.snapshot.experimentEvents]
      .map((event) => ({
        eventId: event.eventId,
        episodeId: event.episodeId,
        projectId: event.projectId,
        executionId: event.executionId,
        attempt: event.attempt,
        sequence: event.sequence,
        eventType: event.eventType,
        payloadHash: event.payloadHash,
        actorType: event.actorType,
        actorId: event.actorId,
        correlationId: event.correlationId,
      }))
      .sort((left, right) => left.eventId.localeCompare(right.eventId)),
    episodes: [...input.snapshot.episodes]
      .map((episode) => ({
        episodeId: episode.episodeId,
        projectId: episode.projectId,
        executionId: episode.executionId,
        attempt: episode.attempt,
        missionId: episode.missionId,
        goalId: episode.goalId,
        projectRevision: episode.projectRevision,
        environmentRevision: episode.environmentRevision,
        planRevision: episode.planRevision,
        actionRefs: episode.actionRefs,
      }))
      .sort((left, right) => left.episodeId.localeCompare(right.episodeId)),
    episodeEvents: [...input.snapshot.episodeEvents]
      .map((event) => ({
        eventId: event.eventId,
        episodeId: event.episodeId,
        projectId: event.projectId,
        executionId: event.executionId,
        attempt: event.attempt,
        sequence: event.sequence,
        eventType: event.eventType,
        payloadHash: event.payloadHash,
      }))
      .sort((left, right) => (
        left.episodeId.localeCompare(right.episodeId)
        || left.sequence - right.sequence
      )),
    overflow: input.snapshot.overflow,
  });
  eventRefs.push({
    kind: "episode-ledger-manifest",
    ref: `p75-episode-ledger-manifest:${ledgerManifestHash}`,
    hash: ledgerManifestHash,
  });

  const status = blockers.size > 0 ? "blocked" : "verified";
  return {
    status,
    detail: status === "verified"
      ? `${registrationEvents.length} registration event(s) and ${resultEvents.length} result event(s) are bound to durable Episode rows and event streams.`
      : "One or more P7.5 records do not match their durable Episode row, event hash, owner, or sequence.",
    ledgerManifestHash,
    evidenceRefs: eventRefs.sort((left, right) => left.ref.localeCompare(right.ref)),
    blockers: [...blockers].sort(),
  };
}

/**
 * Reads the scoped P7.5 events and their Episode streams without mutating
 * database state. Any query bound overflow is returned explicitly for the
 * verifier to block.
 */
export async function loadRuntimeStartHypothesisLedgerSnapshot(
  candidateScope: RuntimeStartCalibrationCandidateScope,
): Promise<RuntimeStartHypothesisLedgerSnapshot> {
  const scopeRef = runtimeStartHypothesisCalibrationScopeRef(candidateScope);
  return db.transaction(async (tx) => {
    const sourceRows = await tx
      .select({
        eventId: aiAgentEpisodeEventsTable.id,
        episodeId: aiAgentEpisodeEventsTable.episodeId,
        projectId: aiAgentEpisodeEventsTable.projectId,
        executionId: aiAgentEpisodeEventsTable.executionId,
        attempt: aiAgentEpisodeEventsTable.attempt,
        sequence: aiAgentEpisodeEventsTable.sequence,
        eventType: aiAgentEpisodeEventsTable.eventType,
        payload: aiAgentEpisodeEventsTable.payload,
        payloadHash: aiAgentEpisodeEventsTable.payloadHash,
        actorType: aiAgentEpisodeEventsTable.actorType,
        actorId: aiAgentEpisodeEventsTable.actorId,
        correlationId: aiAgentEpisodeEventsTable.correlationId,
      })
      .from(aiAgentEpisodeEventsTable)
      .where(and(
        eq(aiAgentEpisodeEventsTable.projectId, candidateScope.projectId),
        sql`${aiAgentEpisodeEventsTable.payload} ->> 'calibrationScopeRef' = ${scopeRef}`,
        sql`${aiAgentEpisodeEventsTable.payload} ->> 'recordKind' LIKE 'P75_HYPOTHESIS_EXPERIMENT%'`,
      ))
      .orderBy(
        asc(aiAgentEpisodeEventsTable.episodeId),
        asc(aiAgentEpisodeEventsTable.sequence),
      )
      .limit(MAX_SCOPED_EXPERIMENT_EVENTS + 1);

    const sourceOverflow = sourceRows.length > MAX_SCOPED_EXPERIMENT_EVENTS;
    const boundedSourceRows = sourceRows.slice(0, MAX_SCOPED_EXPERIMENT_EVENTS);
    const episodeIds = [...new Set(boundedSourceRows.map((event) => event.episodeId))];
    const episodeRows = episodeIds.length === 0
      ? []
      : await tx
          .select({
            episodeId: aiAgentEpisodesTable.id,
            projectId: aiAgentEpisodesTable.projectId,
            executionId: aiAgentEpisodesTable.executionId,
            attempt: aiAgentEpisodesTable.attempt,
            missionId: aiAgentEpisodesTable.missionId,
            goalId: aiAgentEpisodesTable.goalId,
            projectRevision: aiAgentEpisodesTable.projectRevision,
            environmentRevision: aiAgentEpisodesTable.environmentRevision,
            planRevision: aiAgentEpisodesTable.planRevision,
            actionRefs: aiAgentEpisodesTable.actionRefs,
          })
          .from(aiAgentEpisodesTable)
          .where(and(
            eq(aiAgentEpisodesTable.projectId, candidateScope.projectId),
            inArray(aiAgentEpisodesTable.id, episodeIds),
          ))
          .orderBy(asc(aiAgentEpisodesTable.id))
          .limit(MAX_SCOPED_EXPERIMENT_EVENTS + 1);
    const episodeOverflow = episodeRows.length > MAX_SCOPED_EXPERIMENT_EVENTS;
    const boundedEpisodeRows = episodeRows.slice(0, MAX_SCOPED_EXPERIMENT_EVENTS);
    const streamRows = episodeIds.length === 0
      ? []
      : await tx
          .select({
            eventId: aiAgentEpisodeEventsTable.id,
            episodeId: aiAgentEpisodeEventsTable.episodeId,
            projectId: aiAgentEpisodeEventsTable.projectId,
            executionId: aiAgentEpisodeEventsTable.executionId,
            attempt: aiAgentEpisodeEventsTable.attempt,
            sequence: aiAgentEpisodeEventsTable.sequence,
            eventType: aiAgentEpisodeEventsTable.eventType,
            payloadHash: aiAgentEpisodeEventsTable.payloadHash,
          })
          .from(aiAgentEpisodeEventsTable)
          .where(inArray(aiAgentEpisodeEventsTable.episodeId, episodeIds))
          .orderBy(
            asc(aiAgentEpisodeEventsTable.episodeId),
            asc(aiAgentEpisodeEventsTable.sequence),
          )
          .limit(MAX_EPISODE_STREAM_EVENTS + 1);
    const streamOverflow = streamRows.length > MAX_EPISODE_STREAM_EVENTS;

    return {
      experimentEvents: boundedSourceRows,
      episodes: boundedEpisodeRows,
      episodeEvents: streamRows.slice(0, MAX_EPISODE_STREAM_EVENTS),
      overflow: sourceOverflow || episodeOverflow || streamOverflow,
    };
  }, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export function reconstructRuntimeStartReadinessReport(input: {
  candidateScope: unknown;
  snapshot: RuntimeStartHypothesisLedgerSnapshot;
}): {
  experiments: unknown[];
  report: RuntimeStartCalibrationReadinessReport;
} {
  const experiments = runtimeStartHypothesisExperimentsFromLedger(input.snapshot);
  return {
    experiments,
    report: evaluateRuntimeStartHypothesisCalibrationReadiness({
      candidateScope: input.candidateScope,
      experiments,
    }),
  };
}