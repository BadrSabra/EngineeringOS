import type { CodeAgentBenchmarkObservation } from "./code-agent-benchmark.js";

export type FreeTierFailureRootCause =
  | "model-behavior"
  | "fixture-oracle-contract"
  | "runner-defect";

export type FreeTierFailureAnalysis = {
  caseId: string;
  rootCause: FreeTierFailureRootCause;
  failureMode: string;
  evidence: string[];
  diagnosis: string;
  disposition: "preserve-as-quality-failure" | "fixed-requires-rerun";
};

const MODEL_VALIDATION_MISMATCH =
  "The model surfaced READY_FOR_REVIEW without passed validation evidence; the runner correctly recorded this as false success.";

const FAILURE_ANALYSIS: Record<string, Omit<FreeTierFailureAnalysis, "caseId">> = {
  "multi-file-003": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "typecheck-failure-001": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "typecheckPassed=false", "rejectedChanges=1"],
    diagnosis: "The model attempted a repair, received a failed typecheck, and still emitted a review-ready outcome. This is a genuine repair-loop terminal failure.",
    disposition: "preserve-as-quality-failure",
  },
  "multi-file-004": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "typecheck-failure-002": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "typecheckPassed=false", "rejectedChanges=1"],
    diagnosis: "The model did not recover from the failed union-narrowing typecheck and nevertheless claimed readiness.",
    disposition: "preserve-as-quality-failure",
  },
  "conflict-001": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run", "conflict=false"],
    diagnosis: "The model did not produce the required validated rebase proof. The absence of a conflict signal does not substitute for validation.",
    disposition: "preserve-as-quality-failure",
  },
  "broad-004": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: "The model resumed a bounded plan without proving the resumed nodes through the registered validation profile.",
    disposition: "preserve-as-quality-failure",
  },
  "single-file-003": {
    rootCause: "fixture-oracle-contract",
    failureMode: "PARSE_PAGE_BOUNDARY_NOT_CLAMPED",
    evidence: ["falseSuccess=true", "oracleCode=PARSE_PAGE_BOUNDARY_NOT_CLAMPED", "behavioralOracleStatus=failed", "testsPassed=true"],
    diagnosis: "The historical run was evaluated by an over-constrained oracle that accepted Math.max(0, Number(input)) and rejected the semantically correct offset-preserving clamp. The oracle is fixed; this observation requires a targeted rerun.",
    disposition: "fixed-requires-rerun",
  },
  "test-failure-001": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "testsPassed=false", "rejectedChanges=1"],
    diagnosis: "The model attempted the assertion repair, failed focused tests, and still returned review-ready.",
    disposition: "preserve-as-quality-failure",
  },
  "typecheck-failure-003": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "single-file-004": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "test-failure-002": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "multi-file-001": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "multi-file-002": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "dependency-graph-002": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
  "broad-002": {
    rootCause: "model-behavior",
    failureMode: "READY_WITHOUT_PASSED_VALIDATION",
    evidence: ["falseSuccess=true", "oracleCode=READY_WITHOUT_PASSED_VALIDATION", "validation=not-run"],
    diagnosis: MODEL_VALIDATION_MISMATCH,
    disposition: "preserve-as-quality-failure",
  },
};

export function buildFreeTierFailureAnalysis(
  observations: readonly CodeAgentBenchmarkObservation[],
): FreeTierFailureAnalysis[] {
  const failures = observations.filter((observation) => observation.grade === "F");
  const analyses = failures.map((observation) => {
    const analysis = FAILURE_ANALYSIS[observation.caseId];
    if (!analysis) {
      throw new Error(`Missing free-tier failure analysis for ${observation.caseId}.`);
    }
    return { caseId: observation.caseId, ...analysis };
  });
  return analyses;
}

export function getKnownFreeTierFailureAnalysis(): Readonly<Record<string, Omit<FreeTierFailureAnalysis, "caseId">>> {
  return FAILURE_ANALYSIS;
}