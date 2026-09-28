import { describe, expect, it } from "vitest";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  type RuntimeStartHypothesisExperimentBinding,
} from "./runtime-start-hypothesis-experiment.js";
import {
  buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot,
} from "./runtime-start-hypothesis-readiness-evidence-pack.js";
import type {
  RuntimeStartHypothesisLedgerEventEvidence,
  RuntimeStartHypothesisLedgerSnapshot,
  RuntimeStartHypothesisLedgerStreamEvent,
} from "./runtime-start-hypothesis-ledger-evidence.js";

const candidateScope = {
  projectId: "p75-ledger-project",
  projectRevision: "p75-ledger-source",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
};

function binding(index: number): RuntimeStartHypothesisExperimentBinding {
  return {
    projectId: candidateScope.projectId,
    missionId: `mission-${index}`,
    goalId: `goal-${index}`,
    executionId: `execution-${index}`,
    attempt: 0,
    episodeId: `episode-${index}`,
    actionId: `action-${index}`,
    planRevision: "p75-ledger-plan",
    projectRevision: candidateScope.projectRevision,
    environmentRevision: candidateScope.environmentRevision,
    parentWorldRevision: "b".repeat(64),
    beforeObservationIds: [`observation-before-${index}`],
    predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
  };
}

function ledgerFixture(index = 1): {
  snapshot: RuntimeStartHypothesisLedgerSnapshot;
  registrationEvent: RuntimeStartHypothesisLedgerEventEvidence;
  resultEvent: RuntimeStartHypothesisLedgerEventEvidence;
} {
  const registration = buildRuntimeStartHypothesisExperimentRegistration(binding(index));
  const result = buildRuntimeStartHypothesisExperimentResult({
    registration,
    observationRefs: [`observation-after-${index}`],
    measurementValidity: "complete_fresh",
    environmentStatus: "same_scope",
    actualOutcomeKey: "runtime_running",
    resolvedAt: "2026-09-28T10:01:00.000Z",
  });
  const registrationEvent: RuntimeStartHypothesisLedgerEventEvidence = {
    eventId: `event-registration-${index}`,
    episodeId: registration.episodeId,
    projectId: registration.projectId,
    executionId: registration.executionId,
    attempt: registration.attempt,
    sequence: 1,
    eventType: "OBSERVATION_REQUESTED",
    payload: registration,
    payloadHash: canonicalJsonHash(registration),
    actorType: "server",
    actorId: `worker-${index}`,
    correlationId: registration.executionId,
  };
  const resultEvent: RuntimeStartHypothesisLedgerEventEvidence = {
    eventId: `event-result-${index}`,
    episodeId: registration.episodeId,
    projectId: registration.projectId,
    executionId: registration.executionId,
    attempt: registration.attempt,
    sequence: 2,
    eventType: "OBSERVATION_RECORDED",
    payload: result,
    payloadHash: canonicalJsonHash(result),
    actorType: "server",
    actorId: `worker-${index}`,
    correlationId: registration.executionId,
  };
  const streamEvent = (
    event: RuntimeStartHypothesisLedgerEventEvidence,
  ): RuntimeStartHypothesisLedgerStreamEvent => ({
    eventId: event.eventId,
    episodeId: event.episodeId,
    projectId: event.projectId,
    executionId: event.executionId,
    attempt: event.attempt,
    sequence: event.sequence,
    eventType: event.eventType,
    payloadHash: event.payloadHash,
  });

  return {
    registrationEvent,
    resultEvent,
    snapshot: {
      experimentEvents: [registrationEvent, resultEvent],
      episodes: [{
        episodeId: registration.episodeId,
        projectId: registration.projectId,
        executionId: registration.executionId,
        attempt: registration.attempt,
        missionId: registration.missionId,
        goalId: registration.goalId,
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        planRevision: registration.planRevision,
        actionRefs: [registration.actionId],
      }],
      episodeEvents: [
        {
          eventId: `event-created-${index}`,
          episodeId: registration.episodeId,
          projectId: registration.projectId,
          executionId: registration.executionId,
          attempt: registration.attempt,
          sequence: 0,
          eventType: "EPISODE_CREATED",
          payloadHash: canonicalJsonHash({ episodeId: registration.episodeId }),
        },
        streamEvent(registrationEvent),
        streamEvent(resultEvent),
      ],
      overflow: false,
    },
  };
}

describe("P7.5 durable Episode-ledger evidence", () => {
  it("binds each registration and result to hashed Episode events without authorizing collection", () => {
    const fixture = ledgerFixture();
    const first = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: fixture.snapshot,
    });
    const second = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: fixture.snapshot,
    });
    const ownership = first.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    );

    expect(ownership?.status).toBe("verified");
    expect(ownership?.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "episode-ledger-event",
        ref: `p75-episode-event:${fixture.registrationEvent.eventId}`,
        hash: fixture.registrationEvent.payloadHash,
      }),
      expect.objectContaining({
        kind: "episode-ledger-event",
        ref: `p75-episode-event:${fixture.resultEvent.eventId}`,
        hash: fixture.resultEvent.payloadHash,
      }),
    ]));
    expect(first.evidencePack.episodeLedgerManifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.evidencePack.packRef).toBe(second.evidencePack.packRef);
    expect(first.evidencePack).toMatchObject({
      version: 3,
      status: "BLOCKED",
      collectionAuthorized: false,
      aggregateCalibrationAssessmentComputed: false,
      writesPerformed: false,
      selectionMode: "fixed_safe_probe",
    });
    expect(first.readinessReport.collectionAuthorized).toBe(false);
  });

  it("blocks a payload hash mismatch and preserves the failure code in the pack", () => {
    const fixture = ledgerFixture();
    const snapshot: RuntimeStartHypothesisLedgerSnapshot = {
      ...fixture.snapshot,
      experimentEvents: [
        { ...fixture.registrationEvent, payloadHash: "f".repeat(64) },
        fixture.resultEvent,
      ],
    };
    const result = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot,
    });
    const ownership = result.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    );

    expect(result.evidencePack.status).toBe("BLOCKED");
    expect(ownership?.status).toBe("blocked");
    expect(ownership?.diagnostics).toContain("p75-event-payload-hash-mismatch");
    expect(result.evidencePack.collectionAuthorized).toBe(false);
  });

  it("blocks missing Episode ownership and non-contiguous persisted event streams", () => {
    const fixture = ledgerFixture();
    const missingEpisode = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: { ...fixture.snapshot, episodes: [] },
    });
    const sequenceGapSnapshot: RuntimeStartHypothesisLedgerSnapshot = {
      ...fixture.snapshot,
      experimentEvents: [
        fixture.registrationEvent,
        { ...fixture.resultEvent, sequence: 4 },
      ],
      episodeEvents: fixture.snapshot.episodeEvents.map((event) => (
        event.eventId === fixture.resultEvent.eventId
          ? { ...event, sequence: 4 }
          : event
      )),
    };
    const sequenceGap = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: sequenceGapSnapshot,
    });

    expect(missingEpisode.evidencePack.blockers).toContain("episode-ledger-ownership");
    expect(missingEpisode.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.diagnostics).toContain("registration-episode-row-mismatch");
    expect(sequenceGap.evidencePack.blockers).toContain("episode-ledger-ownership");
    expect(sequenceGap.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.diagnostics).toContain("episode-event-stream-invalid");
  });

  it("fails closed on snapshot overflow and does not claim ownership for an empty scope", () => {
    const fixture = ledgerFixture();
    const overflow = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: { ...fixture.snapshot, overflow: true },
    });
    const empty = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot: {
        experimentEvents: [],
        episodes: [],
        episodeEvents: [],
        overflow: false,
      },
    });

    expect(overflow.evidencePack.status).toBe("BLOCKED");
    expect(overflow.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.diagnostics).toContain("episode-ledger-snapshot-overflow");
    expect(empty.evidencePack.status).toBe("BLOCKED");
    expect(empty.evidencePack.blockers).toContain(
      "trust-boundary:reviewer-identity:missing",
    );
    expect(empty.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.status).toBe("review_required");
    expect(empty.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "episode-ledger-manifest" }),
    ]));
    expect(empty.evidencePack.collectionAuthorized).toBe(false);
  });

  it("blocks an event whose actor is not the server-owned worker", () => {
    const fixture = ledgerFixture();
    const snapshot: RuntimeStartHypothesisLedgerSnapshot = {
      ...fixture.snapshot,
      experimentEvents: [
        { ...fixture.registrationEvent, actorType: "user" },
        fixture.resultEvent,
      ],
    };
    const result = buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
      candidateScope,
      snapshot,
    });

    expect(result.evidencePack.machineEvidence.find(
      (item) => item.id === "episode-ledger-ownership",
    )?.diagnostics).toContain("registration-event-owner-mismatch");
    expect(result.evidencePack.status).toBe("BLOCKED");
  });
});