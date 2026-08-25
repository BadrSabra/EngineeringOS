import { describe, expect, it } from "vitest";
import { deriveFlightDeckState } from "../flight-deck-state.js";

describe("deriveFlightDeckState", () => {
  it("never treats a failed execution as completed", () => {
    expect(deriveFlightDeckState({
      executionStatus: "failed",
      hasPendingProposal: true,
    })).toBe("BLOCKED");
  });

  it("exposes validation and repair as distinct lifecycle states", () => {
    expect(deriveFlightDeckState({ executionStatus: "running", repairState: "VALIDATING" }))
      .toBe("VALIDATING");
    expect(deriveFlightDeckState({ executionStatus: "running", repairState: "REPAIRING" }))
      .toBe("REPAIRING");
  });

  it("fails closed when a completed execution has no accepted evidence", () => {
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      proofRequired: true,
    })).toBe("BLOCKED");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      evidenceVerdict: "NOT_RECORDED",
      proofRequired: true,
    })).toBe("BLOCKED");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      evidenceVerdict: "PROVEN",
      proofRequired: true,
    })).toBe("COMPLETED");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      evidenceVerdict: "NOT_RECORDED",
      proofRequired: false,
    })).toBe("COMPLETED");
  });

  it("requires accepted validation evidence before a proposal is review-ready", () => {
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      hasPendingProposal: true,
      proofRequired: true,
      evidenceVerdict: "NOT_RECORDED",
    })).toBe("BLOCKED");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      hasPendingProposal: true,
      proofRequired: true,
      evidenceVerdict: "PARTIAL",
    }))
      .toBe("READY_FOR_REVIEW");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      proofRequired: true,
      evidenceVerdict: "PARTIAL",
    })).toBe("BLOCKED");
    expect(deriveFlightDeckState({
      executionStatus: "running",
      repairState: "READY_FOR_REVIEW",
      hasPendingProposal: true,
      proofRequired: true,
      evidenceVerdict: "NOT_RECORDED",
    })).toBe("BUILDING");
  });

  it("keeps cancellation terminal and does not let delivery flags override it", () => {
    expect(deriveFlightDeckState({ executionStatus: "cancelled", hasPushedChanges: true }))
      .toBe("CANCELLED");
    expect(deriveFlightDeckState({ executionStatus: "cancelled" })).toBe("CANCELLED");
  });

  it("requires proven evidence before exposing delivery states", () => {
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      hasAppliedChanges: true,
      evidenceVerdict: "PARTIAL",
      proofRequired: true,
    })).toBe("BLOCKED");
    expect(deriveFlightDeckState({
      executionStatus: "completed",
      hasPushedChanges: true,
      evidenceVerdict: "PROVEN",
    })).toBe("PUSHED");
  });
});