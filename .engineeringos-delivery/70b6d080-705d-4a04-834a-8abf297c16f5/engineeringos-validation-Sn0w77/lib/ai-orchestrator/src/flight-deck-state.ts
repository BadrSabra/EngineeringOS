export type FlightDeckState =
  | "BUILDING"
  | "VALIDATING"
  | "REPAIRING"
  | "READY_FOR_REVIEW"
  | "BLOCKED"
  | "APPLIED"
  | "COMMITTED"
  | "PUSHED"
  | "CANCELLED"
  | "COMPLETED";

export type FlightDeckEvidenceVerdict =
  | "PROVEN"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "BLOCKED"
  | "NOT_RECORDED";

export type FlightDeckStateInput = {
  executionStatus?: string;
  checkpointStage?: string;
  repairState?: string;
  hasPendingProposal?: boolean;
  hasAppliedChanges?: boolean;
  hasCommittedChanges?: boolean;
  hasPushedChanges?: boolean;
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  proofRequired?: boolean;
};

/**
 * Derive the user-facing Code Flight Deck state from server-owned evidence.
 * This is intentionally pure: callers must supply observed execution/proposal
 * state and the function never treats a missing value as proof of success.
 */
export function deriveFlightDeckState(input: FlightDeckStateInput): FlightDeckState {
  if (input.executionStatus === "cancelled" || input.executionStatus === "cancelling") {
    return "CANCELLED";
  }
  if (input.executionStatus === "failed") return "BLOCKED";

  const evidenceProven = input.evidenceVerdict === "PROVEN";
  if (input.hasPushedChanges) return evidenceProven ? "PUSHED" : "BLOCKED";
  if (input.hasCommittedChanges) return evidenceProven ? "COMMITTED" : "BLOCKED";
  if (input.hasAppliedChanges) return evidenceProven ? "APPLIED" : "BLOCKED";

  if (input.repairState === "VALIDATING") return "VALIDATING";
  if (input.repairState === "REPAIRING") return "REPAIRING";
  if (input.repairState === "BLOCKED") return "BLOCKED";
  if (
    input.repairState === "READY_FOR_REVIEW"
    && input.proofRequired
    && input.hasPendingProposal
    && input.evidenceVerdict === "PARTIAL"
  ) {
    return "READY_FOR_REVIEW";
  }

  if (input.executionStatus === "completed") {
    if (!input.proofRequired) return "COMPLETED";
    if (input.hasPendingProposal && input.evidenceVerdict === "PARTIAL") return "READY_FOR_REVIEW";
    return evidenceProven ? "COMPLETED" : "BLOCKED";
  }
  if (
    input.proofRequired
    && input.checkpointStage === "finalizing"
    && input.hasPendingProposal
    && input.evidenceVerdict === "PARTIAL"
  ) {
    return "READY_FOR_REVIEW";
  }

  return "BUILDING";
}