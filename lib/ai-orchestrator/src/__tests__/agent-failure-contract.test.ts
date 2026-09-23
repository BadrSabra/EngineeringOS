import { describe, expect, it } from "vitest";
import {
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
    expect(FailureDiagnosisSchema.safeParse({
      ...diagnosis,
      failedAssumptions: ["x".repeat(9 * 1024)],
    }).success).toBe(false);
  });
});