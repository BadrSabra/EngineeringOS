import { z } from "zod";

/**
 * FEG-017: why an investigation's terminal is a failure, instead of a flat
 * NOT_PROVEN. A bare NOT_PROVEN conflates very different failures:
 * - INVESTIGATION_NOT_STARTED: zero source reads ever; never reached evidence.
 * - INVESTIGATION_BUDGET_EXHAUSTED: evidence was started but the iteration /
 *   soft-limit budget ran out before a verdict was reached.
 * - NO_EVIDENCE_FOUND: the investigation ran to a normal end but retained no
 *   source evidence that substantiates a claim.
 * - EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED: source evidence was retained but no
 *   required claim was closed with it.
 * - NO_RESPONSE_RECOVERY_BLOCKED: source collection reached a terminal empty
 *   provider response and bounded forensic recovery did not produce a report.
 */
export const ForensicTerminalKindSchema = z.enum([
  "INVESTIGATION_NOT_STARTED",
  "INVESTIGATION_BUDGET_EXHAUSTED",
  "NO_EVIDENCE_FOUND",
  "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED",
  "NO_RESPONSE_RECOVERY_BLOCKED",
]);
export type ForensicTerminalKind = z.infer<typeof ForensicTerminalKindSchema>;

/**
 * FEG-017: classify the terminal from whether evidence was ever acquired,
 * whether a budget cap was hit, and whether retained evidence closed a claim.
 * A run that made no source reads at all is INVESTIGATION_NOT_STARTED — never
 * NO_EVIDENCE_FOUND, regardless of how its budget was spent — because a 0-read
 * run cannot have "searched and found nothing"; it never searched.
 */
export function classifyForensicTerminal(opts: {
  evidenceAcquired: boolean;
  budgetExhausted: boolean;
  claimsUnclosedButEvidenceAvailable: boolean;
  recoveryBlocked?: boolean;
}): ForensicTerminalKind {
  const {
    evidenceAcquired,
    budgetExhausted,
    claimsUnclosedButEvidenceAvailable,
    recoveryBlocked = false,
  } = opts;
  if (recoveryBlocked) return "NO_RESPONSE_RECOVERY_BLOCKED";
  if (!evidenceAcquired) return "INVESTIGATION_NOT_STARTED";
  if (claimsUnclosedButEvidenceAvailable) return "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED";
  if (budgetExhausted) return "INVESTIGATION_BUDGET_EXHAUSTED";
  return "NO_EVIDENCE_FOUND";
}

export const AuditStateSchema = z.object({
  sourceCoverage: z.enum(["COMPLETE", "PARTIAL", "NONE"]),
  behaviorAssessment: z.enum(["COMPLETE", "INCOMPLETE", "NOT_STARTED"]),
  findingStatus: z.enum(["PROVEN", "NO_FINDING", "NOT_PROVEN"]),
  repairReadiness: z.enum(["READY", "BLOCKED"]),
  productionReachability: z.enum(["PROVEN", "NOT_PROVEN", "OUT_OF_SCOPE"]),
}).strict();
export type AuditState = z.infer<typeof AuditStateSchema>;

export const VerificationStageSchema = z.enum(["MODEL_RESPONSE", "VERIFIED_RESPONSE"]);
export type VerificationStage = z.infer<typeof VerificationStageSchema>;

export const VerificationTraceSchema = z.object({
  stage: VerificationStageSchema,
  responseLength: z.number().int().min(0),
  sourceCount: z.number().int().min(0),
  evidenceCount: z.number().int().min(0),
  acceptedEvidenceCount: z.number().int().min(0),
  rejectionReasons: z.array(z.string().min(1).max(240)).max(4),
}).strict();
export type VerificationTrace = z.infer<typeof VerificationTraceSchema>;

export const RecoveryFailureKindSchema = z.enum([
  "PARSE_FAILURE",
  "SCHEMA_FAILURE",
  "TIMEOUT",
  "PROVIDER_FAILURE",
  "EVIDENCE_FAILURE",
  "VALIDATION_FAILURE",
]);
export type RecoveryFailureKind = z.infer<typeof RecoveryFailureKindSchema>;

/**
 * AI-OBJ-012: a richer objective-verdict vocabulary that replaces the blanket
 * NOT_PROVEN label with specific, actionable failure semantics.
 *
 *  - ANSWER_COMPLETE: all required claims evidenced; primary question answered.
 *  - ANSWER_PARTIAL: at least one required claim proven but the chain is incomplete.
 *  - OBJECTIVE_BLOCKED: primary production-reachability objective unproven;
 *    further evidence or targeted recovery is needed.
 *  - EVIDENCE_INSUFFICIENT: investigation ran to a normal end with zero evidence
 *    relevant to the primary objective.
 *  - RECOVERY_REQUIRED: a specific missing edge / symbol was identified; a
 *    bounded targeted recovery may close it.
 *
 * NOT_PROVEN must only appear on a single, genuinely unproven reachability EDGE,
 * never as the explanation for an entire investigation failure.
 */
export const ObjectiveVerdictKindSchema = z.enum([
  "ANSWER_COMPLETE",
  "ANSWER_PARTIAL",
  "OBJECTIVE_BLOCKED",
  "EVIDENCE_INSUFFICIENT",
  "RECOVERY_REQUIRED",
]);
export type ObjectiveVerdictKind = z.infer<typeof ObjectiveVerdictKindSchema>;

/**
 * AI-OBJ-012: map investigation signals to an ObjectiveVerdictKind.
 *
 * Precedence (highest first):
 *  1. No evidence collected at all → EVIDENCE_INSUFFICIENT.
 *  2. Primary claim is closed and all validations PROVEN → ANSWER_COMPLETE.
 *  3. At least one claim is PROVEN but not all → ANSWER_PARTIAL.
 *  4. A specific missing edge can be targeted for recovery → RECOVERY_REQUIRED.
 *  5. Primary objective unproven with no recovery path → OBJECTIVE_BLOCKED.
 */
export function classifyObjectiveVerdict(opts: {
  primaryClaimClosed: boolean;
  allClaimsProven: boolean;
  anyClaimProven: boolean;
  evidenceCollected: boolean;
  recoveryAvailable: boolean;
}): ObjectiveVerdictKind {
  const { primaryClaimClosed, allClaimsProven, anyClaimProven, evidenceCollected, recoveryAvailable } = opts;
  if (!evidenceCollected) return "EVIDENCE_INSUFFICIENT";
  if (primaryClaimClosed && allClaimsProven) return "ANSWER_COMPLETE";
  if (anyClaimProven) return "ANSWER_PARTIAL";
  if (recoveryAvailable) return "RECOVERY_REQUIRED";
  return "OBJECTIVE_BLOCKED";
}

export const ForensicDecisionTraceSchema = z.object({
  taskType: z.string().min(1).max(80),
  allowedFiles: z.array(z.string().min(1).max(500)).max(8),
  filesRead: z.array(z.string().min(1).max(500)).max(48),
  evidenceSelected: z.number().int().min(0),
  claim: z.string().max(240),
  validator: z.string().min(1).max(80),
  rejectionReason: z.array(z.string().min(1).max(240)).max(4),
  recoveryAttempt: z.number().int().min(0),
  recoveryFailureKind: RecoveryFailureKindSchema.optional(),
  finalState: z.enum(["VERIFIED", "NOT_PROVEN", "RECOVERY_REQUIRED", "FAILED"]),
  /**
   * Task #46: the verdict's proof scope as computed by the final runtime
   * ledger. Persisted on the decision_trace step so a later audit over the same
   * project and an execution handoff can reconcile against the SAME scope the
   * verdict was actually issued under, instead of recomputing a fresh default.
   */
  verdictScope: z
    .enum(["PRODUCTION", "FIXTURE_LOCAL", "TEST_LOCAL", "SPEC_LOCAL", "MIXED", "NOT_PROVEN"])
    .optional(),
  scopedFindingStatus: z
    .enum(["PRODUCTION_PROVEN", "FIXTURE_PROVEN", "TEST_PROVEN", "MIXED_EVIDENCE", "NOT_PROVEN"])
    .optional(),
  /**
   * AI-OBJ-012: the specific objective-verdict kind that replaces NOT_PROVEN as
   * the blanket failure label. Populated by `classifyObjectiveVerdict` when the
   * run is a Production Reachability task. Absent for non-reachability runs.
   */
  objectiveVerdict: ObjectiveVerdictKindSchema.optional(),
}).strict();
export type ForensicDecisionTrace = z.infer<typeof ForensicDecisionTraceSchema>;