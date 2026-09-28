import { describe, expect, it } from "vitest";
import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  buildRuntimeStartHypothesisExperimentRegistration,
  buildRuntimeStartHypothesisExperimentResult,
  runtimeStartHypothesisCalibrationScopeRef,
  type RuntimeStartHypothesisExperimentBinding,
} from "./runtime-start-hypothesis-experiment.js";
import {
  buildRuntimeStartHypothesisMeasurementContinuationRequest,
  buildRuntimeStartHypothesisMeasurementContinuationResult,
} from "./runtime-start-hypothesis-measurement-continuation.js";
import {
  evaluateRuntimeStartHypothesisCalibrationReadiness,
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
  type RuntimeStartCalibrationReadinessInput,
} from "./runtime-start-hypothesis-calibration-readiness.js";
import {
  buildRuntimeStartHypothesisReadinessEvidencePack,
} from "./runtime-start-hypothesis-readiness-evidence-pack.js";

const baseScope = {
  projectId: "p75-readiness-project",
  projectRevision: "p75-readiness-source",
  environmentRevision: `env-v1:${"a".repeat(64)}`,
};

function binding(index: number, missionId = `mission-${index}`): RuntimeStartHypothesisExperimentBinding {
  return {
    projectId: baseScope.projectId,
    missionId,
    goalId: `goal-${index}`,
    executionId: `execution-${index}`,
    attempt: 0,
    episodeId: `episode-${index}`,
    actionId: `action-${index}`,
    planRevision: "p75-readiness-plan",
    projectRevision: baseScope.projectRevision,
    environmentRevision: baseScope.environmentRevision,
    parentWorldRevision: "b".repeat(64),
    beforeObservationIds: [`observation-before-${index}`],
    predictionRegisteredAt: "2026-09-28T10:00:00.000Z",
  };
}

function experiment(index: number, withResult = true, missionId = `mission-${index}`) {
  const registration = buildRuntimeStartHypothesisExperimentRegistration(binding(index, missionId));
  return {
    experimentId: registration.experimentId,
    missionId: registration.missionId,
    calibrationScopeRef: registration.calibrationScopeRef,
    registration,
    ...(withResult
      ? {
          result: buildRuntimeStartHypothesisExperimentResult({
            registration,
            observationRefs: [`observation-after-${index}`],
            measurementValidity: "complete_fresh",
            environmentStatus: "same_scope",
            actualOutcomeKey: "runtime_running",
            resolvedAt: "2026-09-28T10:01:00.000Z",
          }),
        }
      : {}),
  };
}

function readinessInput(
  experiments: readonly unknown[] = [],
  overrides: Partial<RuntimeStartCalibrationReadinessInput> = {},
): RuntimeStartCalibrationReadinessInput {
  return {
    candidateScope: baseScope,
    experiments,
    ...overrides,
  };
}

describe("runtime-start calibration readiness preflight", () => {
  it("never authorizes collection or computes calibration metrics", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput());

    expect(report).toMatchObject({
      status: "review_required",
      collectionAuthorized: false,
      aggregateCalibrationAssessmentComputed: false,
      writesPerformed: false,
      selectionMode: "fixed_safe_probe",
      registeredExperimentCount: 0,
      completeCalibrationV1OutcomeCount: 0,
      unresolvedExperimentCount: 0,
      missionCountIsIndependenceProof: false,
    });
    expect(report.reviewRequired).toEqual(expect.arrayContaining([
      "controlled-environment-reset",
      "independent-sampling-definition",
      "held-out-provenance",
      "forecast-and-policy-freeze",
      "evaluator-applicability",
    ]));
    expect(report).not.toHaveProperty("expectedCalibrationError");
    expect(report).not.toHaveProperty("eceUpperBound95");
  });

  it("keeps independent Mission IDs descriptive and still requires an independence review", () => {
    const records = Array.from({ length: 30 }, (_, index) => experiment(index));
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput(records));
    const independenceCheck = report.checks.find(
      (item) => item.id === "independent-sampling-definition",
    );

    expect(report.status).toBe("review_required");
    expect(report.distinctMissionIdCount).toBe(30);
    expect(report.missionCountIsIndependenceProof).toBe(false);
    expect(independenceCheck?.status).toBe("review_required");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks an unresolved registration instead of treating it as a missing sample", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([experiment(1, false)]),
    );

    expect(report.status).toBe("blocked");
    expect(report.unresolvedExperimentCount).toBe(1);
    expect(report.blockers).toContain("unresolved-registrations");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks an oversized snapshot and reports records that were not inspected", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput(Array.from({
        length: RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS + 1,
      }, () => null)),
    );

    expect(report.status).toBe("blocked");
    expect(report.inputExperimentCount).toBe(
      RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS + 1,
    );
    expect(report.unprocessedExperimentCount).toBe(1);
    expect(report.blockers).toContain("bounded-input");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("blocks a record whose registration belongs to another source or environment scope", () => {
    const otherScope = {
      ...baseScope,
      projectRevision: "p75-readiness-other-source",
    };
    const otherRegistration = buildRuntimeStartHypothesisExperimentRegistration({
      ...binding(2),
      projectRevision: otherScope.projectRevision,
    });
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput([{
      experimentId: otherRegistration.experimentId,
      missionId: otherRegistration.missionId,
      calibrationScopeRef: otherRegistration.calibrationScopeRef,
      registration: otherRegistration,
      result: buildRuntimeStartHypothesisExperimentResult({
        registration: otherRegistration,
        observationRefs: ["observation-after-2"],
        measurementValidity: "complete_fresh",
        environmentStatus: "same_scope",
        actualOutcomeKey: "runtime_running",
        resolvedAt: "2026-09-28T10:01:00.000Z",
      }),
    }]));

    expect(otherRegistration.calibrationScopeRef).not.toBe(
      runtimeStartHypothesisCalibrationScopeRef(baseScope),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("scope-and-record-integrity");
    expect(report.completeCalibrationV1OutcomeCount).toBe(0);
  });

  it("blocks continuation receipts from being counted as calibration-v1 outcomes", () => {
    const source = experiment(3);
    const registration = source.registration;
    const request = buildRuntimeStartHypothesisMeasurementContinuationRequest({
      registration,
      measurement: {
        projectId: registration.projectId,
        missionId: registration.missionId,
        goalId: registration.goalId,
        executionId: registration.executionId,
        attempt: registration.attempt + 1,
        episodeId: "episode-continuation-3",
        planRevision: registration.planRevision,
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
      },
      requestedAt: "2026-09-28T10:02:00.000Z",
    });
    const continuation = buildRuntimeStartHypothesisMeasurementContinuationResult({
      request,
      observation: {
        id: "observation-continuation-3",
        predicate: "runtime.status",
        projectRevision: registration.projectRevision,
        environmentRevision: registration.environmentRevision,
        freshness: "fresh",
        environmentFreshness: "fresh",
        outcomeKey: "runtime_running",
        observedAt: "2026-09-28T10:02:05.000Z",
      },
      resolvedAt: "2026-09-28T10:02:05.000Z",
    });
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput([{
      ...source,
      result: continuation,
    }]));

    expect(report.status).toBe("blocked");
    expect(report.excludedContinuationResultCount).toBe(1);
    expect(report.completeCalibrationV1OutcomeCount).toBe(0);
    expect(report.blockers).toContain("continuation-exclusion");
    expect(report.collectionAuthorized).toBe(false);
  });

  it("deduplicates identical snapshots deterministically but blocks conflicting identities", () => {
    const source = experiment(4);
    const duplicate = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([source, source]),
    );
    const repeatedDuplicate = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([source, source]),
    );
    const conflicting = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([
        source,
        {
          ...source,
          result: buildRuntimeStartHypothesisExperimentResult({
            registration: source.registration,
            observationRefs: ["different-observation"],
            measurementValidity: "complete_fresh",
            environmentStatus: "same_scope",
            actualOutcomeKey: "runtime_not_running",
            resolvedAt: "2026-09-28T10:03:00.000Z",
          }),
        },
      ]),
    );

    expect(duplicate.duplicateRecordCount).toBe(1);
    expect(duplicate.readinessRef).toBe(repeatedDuplicate.readinessRef);
    expect(conflicting.status).toBe("blocked");
    expect(conflicting.blockers).toContain("unresolved-registrations");
  });

  it("returns the same report identity for the same metadata in any order", () => {
    const records = [experiment(5), experiment(6)];
    const first = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput(records));
    const second = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([...records].reverse()),
    );

    expect(second).toEqual(first);
  });

  it("builds a deterministic, version-hashed pack while human review remains missing", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([experiment(7), experiment(8)]),
    );
    const pack = buildRuntimeStartHypothesisReadinessEvidencePack(report);
    const repeated = buildRuntimeStartHypothesisReadinessEvidencePack(report);

    expect(pack).toEqual(repeated);
    expect(pack).toMatchObject({
      kind: "p75-runtime-start-readiness-evidence-pack",
      version: 3,
      status: "BLOCKED",
      collectionAuthorized: false,
      aggregateCalibrationAssessmentComputed: false,
      writesPerformed: false,
      selectionMode: "fixed_safe_probe",
      readinessRef: report.readinessRef,
      sourceManifestHash: report.sourceManifestHash,
      calibrationScopeRef: report.calibrationScopeRef,
      protocolManifest: {
        protocolId: "p75-runtime-start-calibration-readiness",
        calibrationVersion: "runtime-start-calibration-v1",
        evaluatorVersion: report.methodVersion,
        policyVersion: report.calibrationPolicyVersion,
        evaluationPartition: report.evaluationPartition,
      },
    });
    expect(pack.protocolManifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pack.protocolManifestHash).toBe(canonicalJsonHash(pack.protocolManifest));
    expect(pack.readinessReportHash).toBe(canonicalJsonHash(report));
    expect(pack.protocolManifest.hashes).toEqual({
      calibrationVersionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      evaluatorVersionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      policyVersionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      scopeDefinitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(pack.machineEvidence.find((item) => item.id === "episode-ledger-ownership"))
      .toMatchObject({ status: "unverified" });
    expect(pack.machineEvidence.find((item) => item.id === "trusted-source-coverage"))
      .toMatchObject({ status: "blocked" });
    expect(pack.machineEvidence.find((item) => item.id === "conflict-scan"))
      .toMatchObject({ status: "verified" });
    expect(pack.trustBoundary.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "clerk-session-identity",
        availability: "present",
      }),
      expect.objectContaining({
        id: "p75-review-approval-record",
        availability: "not_found",
      }),
      expect.objectContaining({
        id: "cohort-sampling-lineage",
        availability: "not_found",
      }),
    ]));
    expect(pack.trustBoundary.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "reviewer-identity",
        status: "MISSING",
        sourceIds: ["clerk-session-identity", "p75-review-approval-record"],
        evidenceRefs: [],
      }),
      expect.objectContaining({
        id: "held-out-provenance",
        status: "MISSING",
        sourceIds: ["fixed-heldout-partition", "heldout-dataset-lineage"],
        evidenceRefs: [],
      }),
    ]));
    expect(pack.blockers).toContain("trust-boundary:reviewer-identity:missing");
    expect(pack.blockers).toContain("trust-boundary:independent-sampling-definition:missing");
    expect(pack.humanReviewItems).toHaveLength(6);
    expect(pack.humanReviewItems.every((item) => (
      item.status === "missing"
      && item.trustedSource === "not_configured"
      && item.evidenceRefs.length === 0
    ))).toBe(true);
    expect(pack.reviewRequired).toEqual(expect.arrayContaining([
      "controlled-environment-reset",
      "independent-sampling-definition",
      "held-out-provenance",
      "forecast-and-policy-freeze",
      "evaluator-applicability",
      "reviewer-identity-and-approval",
      "episode-ledger-ownership",
    ]));
  });

  it("does not accept an arbitrary resetConfirmed boolean as operator evidence", () => {
    const report = evaluateRuntimeStartHypothesisCalibrationReadiness(readinessInput());
    const forgedReport = {
      ...report,
      resetConfirmed: true,
    } as typeof report;
    const pack = buildRuntimeStartHypothesisReadinessEvidencePack(forgedReport);

    expect(pack.status).toBe("BLOCKED");
    expect(pack.collectionAuthorized).toBe(false);
    expect(pack.machineEvidence.find((item) => item.id === "source-report-integrity"))
      .toMatchObject({ status: "blocked" });
    expect(pack.humanReviewItems.find((item) => item.id === "controlled-environment-reset"))
      .toMatchObject({
        status: "missing",
        trustedSource: "not_configured",
        evidenceRefs: [],
      });
    expect(pack).not.toHaveProperty("resetConfirmed");
  });

  it("keeps overflow and conflicting snapshots blocked in the evidence pack", () => {
    const source = experiment(9);
    const conflictReport = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput([
        source,
        {
          ...source,
          result: buildRuntimeStartHypothesisExperimentResult({
            registration: source.registration,
            observationRefs: ["different-observation"],
            measurementValidity: "complete_fresh",
            environmentStatus: "same_scope",
            actualOutcomeKey: "runtime_not_running",
            resolvedAt: "2026-09-28T10:04:00.000Z",
          }),
        },
      ]),
    );
    const overflowReport = evaluateRuntimeStartHypothesisCalibrationReadiness(
      readinessInput(Array.from({
        length: RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS + 1,
      }, () => null)),
    );

    const conflictPack = buildRuntimeStartHypothesisReadinessEvidencePack(conflictReport);
    const overflowPack = buildRuntimeStartHypothesisReadinessEvidencePack(overflowReport);
    expect(conflictReport.conflictingRecordCount).toBe(1);
    expect(conflictPack.status).toBe("BLOCKED");
    expect(conflictPack.blockers).toContain("conflict-scan");
    expect(overflowPack.status).toBe("BLOCKED");
    expect(overflowPack.blockers).toContain("bounded-input");
    expect(overflowPack.machineEvidence.find((item) => item.id === "overflow-status"))
      .toMatchObject({ status: "blocked" });
    expect(conflictPack.collectionAuthorized).toBe(false);
    expect(overflowPack.collectionAuthorized).toBe(false);
  });
});