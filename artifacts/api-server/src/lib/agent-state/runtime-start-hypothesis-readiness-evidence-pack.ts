import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import {
  RUNTIME_START_CALIBRATION_MAXIMUM_ECE,
  RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS,
} from "./runtime-start-hypothesis-calibration.js";
import {
  RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED,
} from "./runtime-start-hypothesis-collection-policy.js";
import {
  RUNTIME_START_CALIBRATION_METHOD_VERSION,
  RUNTIME_START_CALIBRATION_PARTITION,
  RUNTIME_START_CALIBRATION_POLICY_VERSION,
  RUNTIME_START_HYPOTHESIS_SET_ID,
  RUNTIME_START_OBJECTIVE_CONTRACT_ID,
  RUNTIME_START_OBSERVATION_REF,
} from "./runtime-start-hypothesis-experiment.js";
import {
  RUNTIME_START_CALIBRATION_READINESS_VERSION,
  RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
  RuntimeStartCalibrationCandidateScopeSchema,
  type RuntimeStartCalibrationReadinessCheck,
  type RuntimeStartCalibrationReadinessReport,
} from "./runtime-start-hypothesis-calibration-readiness.js";
import {
  loadRuntimeStartHypothesisLedgerSnapshot,
  reconstructRuntimeStartReadinessReport,
  verifyRuntimeStartHypothesisLedgerEvidence,
  type RuntimeStartHypothesisLedgerSnapshot,
  type RuntimeStartHypothesisLedgerVerification,
} from "./runtime-start-hypothesis-ledger-evidence.js";
import {
  buildRuntimeStartHypothesisTrustBoundary,
  runtimeStartHypothesisTrustBoundaryBlockers,
  runtimeStartHypothesisTrustBoundaryReviewRequired,
  runtimeStartHypothesisTrustBoundaryStatus,
  type RuntimeStartHypothesisTrustBoundary,
} from "./runtime-start-hypothesis-trust-boundary.js";

export const RUNTIME_START_READINESS_EVIDENCE_PACK_VERSION = 3 as const;
export const RUNTIME_START_READINESS_PROTOCOL_ID =
  "p75-runtime-start-calibration-readiness";
export const RUNTIME_START_READINESS_PROTOCOL_VERSION = 2 as const;
export const RUNTIME_START_CALIBRATION_VERSION = "runtime-start-calibration-v1";
export const RUNTIME_START_SCOPE_DEFINITION_VERSION =
  "runtime-start-calibration-scope-v1";

const SCOPE_BINDING_FIELDS = [
  "projectId",
  "projectRevision",
  "environmentRevision",
  "objectiveContractId",
  "hypothesisSetId",
  "beliefPolicyVersion",
  "hypothesisSetPolicyVersion",
  "observationRef",
  "calibrationPolicyVersion",
  "methodVersion",
  "evaluationPartition",
] as const;

function canonicalHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("P7.5 evidence-pack hash input must be JSON-serializable.");
  }
  return canonicalJsonHash(
    JSON.parse(serialized) as Parameters<typeof canonicalJsonHash>[0],
  );
}

export type RuntimeStartReadinessProtocolManifest = {
  protocolId: typeof RUNTIME_START_READINESS_PROTOCOL_ID;
  protocolVersion: typeof RUNTIME_START_READINESS_PROTOCOL_VERSION;
  calibrationVersion: typeof RUNTIME_START_CALIBRATION_VERSION;
  evaluatorVersion: typeof RUNTIME_START_CALIBRATION_METHOD_VERSION;
  policyVersion: typeof RUNTIME_START_CALIBRATION_POLICY_VERSION;
  scopeDefinitionVersion: typeof RUNTIME_START_SCOPE_DEFINITION_VERSION;
  evaluationPartition: typeof RUNTIME_START_CALIBRATION_PARTITION;
  minimumMissionCount: typeof RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS;
  maximumEce: typeof RUNTIME_START_CALIBRATION_MAXIMUM_ECE;
  maximumPreflightRecords: typeof RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS;
  hashes: {
    calibrationVersionHash: string;
    evaluatorVersionHash: string;
    policyVersionHash: string;
    scopeDefinitionHash: string;
  };
};

export type RuntimeStartReadinessEvidenceRef = {
  kind:
    | "readiness-report"
    | "source-manifest"
    | "preflight-check"
    | "episode-ledger-event"
    | "episode-ledger-manifest";
  ref: string;
  hash: string;
  checkId?: string;
};

export type RuntimeStartReadinessMachineEvidence = {
  id: string;
  status: "verified" | "unverified" | "blocked" | "review_required";
  detail: string;
  evidenceRefs: RuntimeStartReadinessEvidenceRef[];
  diagnostics?: string[];
};

export type RuntimeStartReadinessHumanReviewItem = {
  id: string;
  status: "missing" | "unverified";
  requirement: string;
  trustedSource: "not_configured";
  evidenceRefs: [];
};

export type RuntimeStartHypothesisReadinessEvidencePack = {
  kind: "p75-runtime-start-readiness-evidence-pack";
  version: typeof RUNTIME_START_READINESS_EVIDENCE_PACK_VERSION;
  packRef: string;
  status: "BLOCKED" | "REVIEW_REQUIRED";
  collectionAuthorized: false;
  aggregateCalibrationAssessmentComputed: false;
  writesPerformed: false;
  selectionMode: "fixed_safe_probe";
  readinessRef: string;
  readinessReportHash: string;
  sourceManifestHash: string;
  episodeLedgerManifestHash: string | null;
  calibrationScopeRef: string | null;
  protocolManifest: RuntimeStartReadinessProtocolManifest;
  protocolManifestHash: string;
  trustBoundary: RuntimeStartHypothesisTrustBoundary;
  machineEvidence: RuntimeStartReadinessMachineEvidence[];
  humanReviewItems: RuntimeStartReadinessHumanReviewItem[];
  blockers: string[];
  reviewRequired: string[];
};

function buildProtocolManifest(): RuntimeStartReadinessProtocolManifest {
  const calibrationIdentity = {
    calibrationVersion: RUNTIME_START_CALIBRATION_VERSION,
    assessmentSchemaVersion: 1,
    minimumMissionCount: RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS,
    maximumEce: RUNTIME_START_CALIBRATION_MAXIMUM_ECE,
  };
  const evaluatorIdentity = {
    evaluatorVersion: RUNTIME_START_CALIBRATION_METHOD_VERSION,
  };
  const policyIdentity = {
    policyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
  };
  const scopeDefinitionIdentity = {
    scopeDefinitionVersion: RUNTIME_START_SCOPE_DEFINITION_VERSION,
    bindingFields: [...SCOPE_BINDING_FIELDS],
    objectiveContractId: RUNTIME_START_OBJECTIVE_CONTRACT_ID,
    hypothesisSetId: RUNTIME_START_HYPOTHESIS_SET_ID,
    observationRef: RUNTIME_START_OBSERVATION_REF,
  };

  return {
    protocolId: RUNTIME_START_READINESS_PROTOCOL_ID,
    protocolVersion: RUNTIME_START_READINESS_PROTOCOL_VERSION,
    calibrationVersion: RUNTIME_START_CALIBRATION_VERSION,
    evaluatorVersion: RUNTIME_START_CALIBRATION_METHOD_VERSION,
    policyVersion: RUNTIME_START_CALIBRATION_POLICY_VERSION,
    scopeDefinitionVersion: RUNTIME_START_SCOPE_DEFINITION_VERSION,
    evaluationPartition: RUNTIME_START_CALIBRATION_PARTITION,
    minimumMissionCount: RUNTIME_START_CALIBRATION_MINIMUM_MISSIONS,
    maximumEce: RUNTIME_START_CALIBRATION_MAXIMUM_ECE,
    maximumPreflightRecords: RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS,
    hashes: {
      calibrationVersionHash: canonicalHash(calibrationIdentity),
      evaluatorVersionHash: canonicalHash(evaluatorIdentity),
      policyVersionHash: canonicalHash(policyIdentity),
      scopeDefinitionHash: canonicalHash(scopeDefinitionIdentity),
    },
  };
}

function readinessReportIdentity(
  report: RuntimeStartCalibrationReadinessReport,
): Record<string, unknown> {
  const {
    readinessRef: _readinessRef,
    collectionAuthorized: _collectionAuthorized,
    aggregateCalibrationAssessmentComputed: _aggregateCalibrationAssessmentComputed,
    writesPerformed: _writesPerformed,
    selectionMode: _selectionMode,
    missionCountIsIndependenceProof: _missionCountIsIndependenceProof,
    ...identity
  } = report as RuntimeStartCalibrationReadinessReport & Record<string, unknown>;
  return identity;
}

function readinessReportIntegrityIsValid(
  report: RuntimeStartCalibrationReadinessReport,
): boolean {
  const identity = readinessReportIdentity(report);
  return report.kind === "p75-calibration-readiness-preflight"
    && report.version === RUNTIME_START_CALIBRATION_READINESS_VERSION
    && report.collectionAuthorized === false
    && report.aggregateCalibrationAssessmentComputed === false
    && report.writesPerformed === false
    && report.selectionMode === "fixed_safe_probe"
    && report.missionCountIsIndependenceProof === false
    && report.readinessRef === `p75-runtime-start-readiness:${canonicalHash(identity)}`;
}

function statusForChecks(
  checks: readonly RuntimeStartCalibrationReadinessCheck[],
): RuntimeStartReadinessMachineEvidence["status"] {
  if (checks.some((item) => item.status === "blocked")) return "blocked";
  if (checks.some((item) => item.status === "review_required")) return "review_required";
  return "verified";
}

function checkRefs(
  readinessRef: string,
  readinessReportHash: string,
  sourceManifestHash: string,
  checkIds: readonly string[],
): RuntimeStartReadinessEvidenceRef[] {
  return [
    {
      kind: "readiness-report",
      ref: readinessRef,
      hash: readinessReportHash,
    },
    {
      kind: "source-manifest",
      ref: `p75-source-manifest:${sourceManifestHash}`,
      hash: sourceManifestHash,
    },
    ...checkIds.map((checkId) => ({
      kind: "preflight-check" as const,
      ref: `p75-preflight-check:${checkId}`,
      hash: readinessReportHash,
      checkId,
    })),
  ];
}

function findChecks(
  report: RuntimeStartCalibrationReadinessReport,
  ids: readonly string[],
): RuntimeStartCalibrationReadinessCheck[] {
  const checksById = new Map(report.checks.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = checksById.get(id);
    return item ? [item] : [];
  });
}

function buildHumanReviewItems(): RuntimeStartReadinessHumanReviewItem[] {
  return [
    {
      id: "controlled-environment-reset",
      status: "missing",
      requirement: "Operator-reviewed repeatable reset procedure and controlled environment scope.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
    {
      id: "independent-sampling-definition",
      status: "missing",
      requirement: "A reviewed cohort definition that rules out automatic reuse; distinct Mission IDs alone are not proof.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
    {
      id: "held-out-provenance",
      status: "missing",
      requirement: "Reviewed provenance showing the held-out outcomes were not used for forecast, policy, probe, or evaluator tuning.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
    {
      id: "forecast-and-policy-freeze",
      status: "missing",
      requirement: "Reviewed freeze of forecast, hypothesis, decision mapping, probe, evaluator, policy, and scope before outcomes.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
    {
      id: "evaluator-applicability",
      status: "missing",
      requirement: "Reviewer confirmation of sample sufficiency and limitations of aggregate ECE for objective-relevant outcomes.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
    {
      id: "reviewer-identity-and-approval",
      status: "missing",
      requirement: "An independently verifiable reviewer identity and approval record.",
      trustedSource: "not_configured",
      evidenceRefs: [],
    },
  ];
}

/**
 * Builds a deterministic, diagnostic artifact from a preflight report. No
 * operator or reviewer claims are accepted here: attestation authority has not
 * been configured, so review items always remain missing and collection is
 * never authorized.
 */
function buildEvidencePack(
  report: RuntimeStartCalibrationReadinessReport,
  ledgerVerification?: RuntimeStartHypothesisLedgerVerification,
): RuntimeStartHypothesisReadinessEvidencePack {
  const readinessReportHash = canonicalHash(report);
  const protocolManifest = buildProtocolManifest();
  const protocolManifestHash = canonicalHash(protocolManifest);
  const trustBoundary = buildRuntimeStartHypothesisTrustBoundary();
  const trustBoundaryBlockers =
    runtimeStartHypothesisTrustBoundaryBlockers(trustBoundary);
  const trustBoundaryReviewRequired =
    runtimeStartHypothesisTrustBoundaryReviewRequired(trustBoundary);
  const sourceReportValid = readinessReportIntegrityIsValid(report);
  const reportCheckIds = [
    "candidate-scope",
    "bounded-input",
    "mission-registration-channel",
    "scope-and-record-integrity",
    "unresolved-registrations",
    "continuation-exclusion",
  ] as const;
  const resultChecks = findChecks(report, [
    "unresolved-registrations",
    "continuation-exclusion",
  ]);
  const resultCheckStatus = statusForChecks(resultChecks);
  const resultEvidenceStatus = resultCheckStatus === "blocked"
    ? "blocked"
    : report.completeCalibrationV1OutcomeCount === 0
      ? "review_required"
      : resultCheckStatus;
  const machineEvidence: RuntimeStartReadinessMachineEvidence[] = [
    {
      id: "source-report-integrity",
      status: sourceReportValid ? "verified" : "blocked",
      detail: sourceReportValid
        ? "The readiness reference matches the canonical report identity and its non-authorizing invariants."
        : "The supplied report identity or non-authorizing invariants do not match its readiness reference.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        reportCheckIds,
      ),
    },
    {
      id: "scope-consistency",
      status: statusForChecks(findChecks(report, [
        "candidate-scope",
        "scope-and-record-integrity",
      ])),
      detail: "Candidate scope and record integrity are projected from the read-only preflight; the scope reference is not collection approval.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["candidate-scope", "scope-and-record-integrity"],
      ),
    },
    {
      id: "mission-registration-integrity",
      status: statusForChecks(findChecks(report, ["mission-registration-channel"])),
      detail: "Registration identity fields are checked against Mission, Goal, plan, execution, Episode, and candidate scope.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["mission-registration-channel"],
      ),
    },
    {
      id: "episode-ledger-ownership",
      status: ledgerVerification?.status ?? "unverified",
      detail: ledgerVerification?.detail
        ?? "The report-only builder has no durable Episode snapshot, so it cannot prove event ownership.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["mission-registration-channel"],
      ),
      ...(ledgerVerification
        ? {
            diagnostics: ledgerVerification.blockers,
            evidenceRefs: [
              ...checkRefs(
                report.readinessRef,
                readinessReportHash,
                report.sourceManifestHash,
                ["mission-registration-channel"],
              ),
              ...ledgerVerification.evidenceRefs,
            ],
          }
        : {}),
    },
    {
      id: "result-integrity",
      status: resultEvidenceStatus,
      detail: resultEvidenceStatus === "blocked"
        ? "One or more registered results are unresolved, invalid, or excluded from calibration v1."
        : report.completeCalibrationV1OutcomeCount === 0
          ? "No complete calibration-v1 outcome is available in this snapshot."
          : "Stored forecast and Brier values are checked against the registration; aggregate calibration is not computed.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["unresolved-registrations", "continuation-exclusion"],
      ),
    },
    {
      id: "conflict-scan",
      status: report.conflictingRecordCount > 0
        ? "blocked"
        : report.inputExperimentCount === 0
          ? "review_required"
          : "verified",
      detail: report.conflictingRecordCount > 0
        ? `${report.conflictingRecordCount} conflicting experiment identity group(s) were found.`
        : report.inputExperimentCount === 0
          ? "No source records were available for a conflict scan."
          : "No conflicting experiment identity group was found in the inspected snapshot.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["scope-and-record-integrity", "unresolved-registrations"],
      ),
    },
    {
      id: "overflow-status",
      status: report.unprocessedExperimentCount > 0 ? "blocked" : "verified",
      detail: report.unprocessedExperimentCount > 0
        ? `${report.unprocessedExperimentCount} record(s) exceeded the bounded preflight and were not inspected.`
        : `The snapshot is within the ${RUNTIME_START_CALIBRATION_READINESS_MAX_EXPERIMENTS}-record preflight bound.`,
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["bounded-input"],
      ),
    },
    {
      id: "protocol-version-consistency",
      status: report.calibrationPolicyVersion === protocolManifest.policyVersion
        && report.methodVersion === protocolManifest.evaluatorVersion
        && report.evaluationPartition === protocolManifest.evaluationPartition
        ? "verified"
        : "blocked",
      detail: "Preflight policy, evaluator, and held-out partition versions are compared with the hashed protocol manifest.",
      evidenceRefs: checkRefs(
        report.readinessRef,
        readinessReportHash,
        report.sourceManifestHash,
        ["scope-and-record-integrity"],
      ),
    },
    {
      id: "trusted-source-coverage",
      status: runtimeStartHypothesisTrustBoundaryStatus(trustBoundary),
      detail: "Existing source candidates are inventoried per trust requirement; none currently provides complete P7.5 authority evidence.",
      evidenceRefs: [],
      diagnostics: [
        ...trustBoundaryBlockers,
        ...trustBoundaryReviewRequired,
      ],
    },
  ];
  const humanReviewItems = buildHumanReviewItems();
  const blockers = [
    ...new Set([
      ...report.blockers,
      ...trustBoundaryBlockers,
      ...machineEvidence
        .filter((item) => item.status === "blocked")
        .map((item) => item.id),
    ]),
  ].sort();
  const reviewRequired = [
    ...new Set([
      ...report.reviewRequired,
      ...trustBoundaryReviewRequired,
      ...machineEvidence
        .filter((item) => item.status === "unverified" || item.status === "review_required")
        .map((item) => item.id),
      ...humanReviewItems.map((item) => item.id),
    ]),
  ].sort();
  const status: RuntimeStartHypothesisReadinessEvidencePack["status"] =
    blockers.length > 0 ? "BLOCKED" : "REVIEW_REQUIRED";
  const packIdentity = {
    kind: "p75-runtime-start-readiness-evidence-pack" as const,
    version: RUNTIME_START_READINESS_EVIDENCE_PACK_VERSION,
    status,
    collectionAuthorized: RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED,
    aggregateCalibrationAssessmentComputed: false as const,
    writesPerformed: false as const,
    selectionMode: "fixed_safe_probe" as const,
    readinessRef: report.readinessRef,
    readinessReportHash,
    sourceManifestHash: report.sourceManifestHash,
    episodeLedgerManifestHash: ledgerVerification?.ledgerManifestHash ?? null,
    calibrationScopeRef: report.calibrationScopeRef,
    protocolManifest,
    protocolManifestHash,
    trustBoundary,
    machineEvidence,
    humanReviewItems,
    blockers,
    reviewRequired,
  };

  return {
    ...packIdentity,
    packRef: `p75-runtime-start-readiness-pack:${canonicalHash(packIdentity)}`,
  };
}

/**
 * Builds the report-only diagnostic pack. This intentionally leaves durable
 * Episode ownership unverified because no ledger snapshot was supplied.
 */
export function buildRuntimeStartHypothesisReadinessEvidencePack(
  report: RuntimeStartCalibrationReadinessReport,
): RuntimeStartHypothesisReadinessEvidencePack {
  return buildEvidencePack(report);
}

/**
 * Rebuilds the readiness report from persisted P7.5 Episode events, verifies
 * each event against its Episode row and stream, and packages only metadata
 * references. It never creates an assessment or changes collection authority.
 */
export function buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot(
  input: {
    candidateScope: unknown;
    snapshot: RuntimeStartHypothesisLedgerSnapshot;
  },
): {
  readinessReport: RuntimeStartCalibrationReadinessReport;
  evidencePack: RuntimeStartHypothesisReadinessEvidencePack;
} {
  const { experiments, report } = reconstructRuntimeStartReadinessReport(input);
  const ledgerVerification = verifyRuntimeStartHypothesisLedgerEvidence({
    candidateScope: input.candidateScope,
    experiments,
    report,
    snapshot: input.snapshot,
  });
  return {
    readinessReport: report,
    evidencePack: buildEvidencePack(report, ledgerVerification),
  };
}

/**
 * Read-only database-backed entry point for the internal readiness evidence
 * pack. Candidate scope must be supplied by the trusted server caller.
 */
export async function buildRuntimeStartHypothesisReadinessEvidencePackFromLedger(
  candidateScope: unknown,
): Promise<{
  readinessReport: RuntimeStartCalibrationReadinessReport;
  evidencePack: RuntimeStartHypothesisReadinessEvidencePack;
}> {
  const parsedScope = RuntimeStartCalibrationCandidateScopeSchema.parse(candidateScope);
  const snapshot = await loadRuntimeStartHypothesisLedgerSnapshot(parsedScope);
  return buildRuntimeStartHypothesisReadinessEvidencePackFromLedgerSnapshot({
    candidateScope: parsedScope,
    snapshot,
  });
}