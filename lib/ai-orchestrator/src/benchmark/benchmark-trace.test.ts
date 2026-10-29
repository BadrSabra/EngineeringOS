import { describe, expect, it } from "vitest";
import {
  safeBehavioralProofFailureCode,
  safeProviderFailureCode,
} from "./benchmark-trace.js";

describe("safeBehavioralProofFailureCode", () => {
  it("projects only the server-owned proof code", () => {
    expect(safeBehavioralProofFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_BEHAVIORAL_PROOF_FAILED",
      details: ["code=FIXTURE_POSTCONDITION_FAILED_MIGRATION_EDGE: private detail"],
    })).toBe("FIXTURE_POSTCONDITION_FAILED_MIGRATION_EDGE");
  });

  it("does not project details from other diagnostics or malformed proof details", () => {
    expect(safeBehavioralProofFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_PROVIDER_FAILURE",
      details: ["code=TIMEOUT: provider detail"],
    })).toBeUndefined();
    expect(safeBehavioralProofFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_BEHAVIORAL_PROOF_FAILED",
      details: ["private detail without a machine code"],
    })).toBeUndefined();
  });

  it("rejects unsafe or oversized proof codes without exposing their text", () => {
    expect(safeBehavioralProofFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_BEHAVIORAL_PROOF_FAILED",
      details: ["code=FAILURE: detail=must-not-leak"],
    })).toBe("FAILURE");
    expect(safeBehavioralProofFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_BEHAVIORAL_PROOF_FAILED",
      details: [`code=${"A".repeat(81)}: must-not-leak`],
    })).toBeUndefined();
  });

  it("projects only known-format provider failure codes", () => {
    expect(safeProviderFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_PROVIDER_FAILURE",
      details: [
        "implementation-node-1: provider failure code: INVALID_TOOL_CALL; hidden details",
      ],
    })).toBe("INVALID_TOOL_CALL");
    expect(safeProviderFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_PROVIDER_FAILURE",
      details: ["provider failure detail must not be logged"],
    })).toBeUndefined();
    expect(safeProviderFailureCode({
      kind: "diagnostic",
      code: "EXECUTION_BEHAVIORAL_PROOF_FAILED",
      details: ["fallback provider failure code: TIMEOUT"],
    })).toBeUndefined();
  });
});
