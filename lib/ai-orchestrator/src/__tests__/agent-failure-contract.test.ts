import { describe, expect, it } from "vitest";
import {
  diagnoseFailure,
  FailureDiagnosisSchema,
  parseFailureDiagnosis,
  toPublicFailureDiagnosis,
} from "../agent-state/index.js";

const diagnosis = {
  schemaVersion: "1" as const,
  kind: "EVIDENCE_INCOMPLETE" as const,
  failedAssumptions: ["required source was not retained"],
  affectedFacts: ["fact-1"],
  affectedClaims: ["claim-1"],
  requiredObservations: ["observation-1"],
  retryable: true,
  requiresApproval: false,
  reasonCode: "EVIDENCE_REQUIRED",
};

describe("agent failure contract", () => {
  it("projects only bounded public failure metadata", () => {
    expect(toPublicFailureDiagnosis(parseFailureDiagnosis(diagnosis))).toEqual({
      schemaVersion: "1",
      kind: "EVIDENCE_INCOMPLETE",
      retryable: true,
      requiresApproval: false,
      reasonCode: "EVIDENCE_REQUIRED",
      affectedClaimCount: 1,
      requiredObservationCount: 1,
    });
  });

  it("rejects unknown failure kinds and oversized diagnoses", () => {
    expect(FailureDiagnosisSchema.safeParse({ ...diagnosis, kind: "PROVIDER_TIMEOUT" }).success).toBe(false);
    expect(FailureDiagnosisSchema.safeParse({ ...diagnosis, nextActionCode: "RETRY_FOREVER" }).success).toBe(false);
    expect(FailureDiagnosisSchema.safeParse({
      ...diagnosis,
      failedAssumptions: ["x".repeat(9 * 1024)],
    }).success).toBe(false);
  });

  it("maps every server-owned failure kind to stable reason and next-action codes", () => {
    const cases = [
      ["NO_PROGRESS", "NO_PROGRESS", "OBSERVE_PROGRESS"],
      ["MISSING_REQUIRED_READ", "REQUIRED_READ_MISSING", "READ_REQUIRED_SOURCE"],
      ["STALE_PROJECT_REVISION", "PROJECT_REVISION_STALE", "REFRESH_PROJECT_REVISION"],
      ["STALE_RUNTIME", "RUNTIME_STALE", "VERIFY_RUNTIME_REVISION"],
      ["PRECONDITION_FAILED", "PRECONDITIONS_FAILED", "RECHECK_PRECONDITIONS"],
      ["VALIDATOR_FAILED", "VALIDATOR_FAILED", "REPAIR_AND_REVALIDATE"],
      ["EXPECTED_EFFECT_MISSING", "EXPECTED_EFFECT_NOT_OBSERVED", "OBSERVE_EXPECTED_EFFECT"],
      ["CONTRADICTORY_STATE", "STATE_CONTRADICTED", "RESOLVE_CONTRADICTION"],
      ["EXTERNAL_DRIFT", "EXTERNAL_STATE_DRIFT", "RECONCILE_EXTERNAL_STATE"],
      ["AUTHORIZATION_REQUIRED", "OWNER_AUTHORIZATION_MISSING", "REQUEST_APPROVAL"],
      ["EVIDENCE_INCOMPLETE", "EVIDENCE_INCOMPLETE", "GATHER_REQUIRED_EVIDENCE"],
      ["TOOL_UNAVAILABLE", "CAPABILITY_UNAVAILABLE", "RETRY_OR_REPLACE_CAPABILITY"],
    ] as const;

    for (const [kind, reasonCode, nextActionCode] of cases) {
      expect(diagnoseFailure({
        episodeId: "episode-classification",
        actionId: "action-classification",
        acceptanceProjection: { outcome: "FAILED", reasonCode: kind },
      })).toMatchObject({
        episodeId: "episode-classification",
        actionId: "action-classification",
        kind,
        reasonCode,
        nextActionCode,
      });
    }
  });

  it("lets direct effect contradictions outrank incomplete acceptance and validator signals", () => {
    const result = diagnoseFailure({
      episodeId: "episode-effect",
      validatorReceipt: {
        status: "failed",
        failureKind: "candidate",
        exitCode: 1,
        detail: "provider text says everything is fine",
      },
      effectResult: {
        status: "contradicted",
        missingEffects: [],
        contradictionRefs: ["observation-after-9"],
      },
      acceptanceProjection: {
        outcome: "FAILED",
        reasonCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
      },
    });
    expect(result).toMatchObject({
      kind: "CONTRADICTORY_STATE",
      reasonCode: "STATE_CONTRADICTED",
      nextActionCode: "RESOLVE_CONTRADICTION",
      retryable: false,
      requiresApproval: true,
      affectedFacts: ["observation:observation-after-9"],
      requiredObservations: ["resolve:observation:observation-after-9"],
    });
  });

  it("maps authorization, stale revision, and unavailable capability signals safely", () => {
    expect(diagnoseFailure({
      episodeId: "episode-auth",
      validatorReceipt: { status: "blocked", failureKind: "scope", reasonCode: "ownership" },
    })).toMatchObject({
      kind: "AUTHORIZATION_REQUIRED",
      nextActionCode: "REQUEST_APPROVAL",
      requiresApproval: true,
      retryable: false,
    });
    expect(diagnoseFailure({
      episodeId: "episode-revision",
      validatorReceipt: { status: "blocked", failureKind: "conflict", reasonCode: "stale_revision" },
    })).toMatchObject({
      kind: "STALE_PROJECT_REVISION",
      nextActionCode: "REFRESH_PROJECT_REVISION",
    });
    expect(diagnoseFailure({
      episodeId: "episode-tool",
      validatorReceipt: { status: "unavailable", failureKind: "unavailable" },
    })).toMatchObject({
      kind: "TOOL_UNAVAILABLE",
      nextActionCode: "RETRY_OR_REPLACE_CAPABILITY",
    });
  });

  it("does not invent a diagnosis for successful or unrecognized inputs", () => {
    expect(() => diagnoseFailure({
      episodeId: "episode-success",
      validatorReceipt: { status: "passed", failureKind: "none" },
      effectResult: { status: "observed" },
      acceptanceProjection: { outcome: "SUCCEEDED", reasonCode: "ACCEPTED" },
    })).toThrow("No recognized server-owned failure signal is available for diagnosis.");
    expect(() => diagnoseFailure({
      episodeId: "episode-untrusted",
      acceptanceProjection: {
        outcome: "FAILED",
        reasonCode: "provider says retry",
        operatorAction: "Run arbitrary command",
      },
    })).toThrow("No recognized server-owned failure signal is available for diagnosis.");
  });
});