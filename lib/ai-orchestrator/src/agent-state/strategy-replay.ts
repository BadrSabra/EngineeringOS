import { z } from "zod";
import {
  AGENT_STATE_SCHEMA_VERSION,
  canonicalJsonHash,
} from "./contract-utils.js";
import {
  StrategyCandidateSchema,
  hashStrategyCandidate,
  type StrategyCandidate,
} from "./strategy-contract.js";
import {
  comparePairedBaseline,
  type PairedBaselineRunResult,
} from "../benchmark/paired-baseline.js";

export const STRATEGY_REPLAY_POLICY = {
  version: 1,
  minimumHeldOutCases: 30,
  minimumIndependentTransferFixtures: 3,
  maximumSuccessRegression: 0.02,
  requiredSuccessImprovement: 0.05,
  requiredCostOrRetryReduction: 0.15,
  maximumCalibrationEce: 0.15,
  maximumTransferFixtures: 32,
} as const;

const STRATEGY_REPLAY_SOURCE_REVISION = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const STRATEGY_REPLAY_DIGEST = /^[a-f0-9]{64}$/;
const STRATEGY_REPLAY_ID = /^[a-zA-Z0-9._:-]{1,200}$/;

export type StrategyReplayCorpusRun = {
  /** Expected to resolve to a server-owned manifest; this analyzer cannot attest that origin. */
  corpusId: string;
  projectId: string;
  sourceRevision: string;
  caseManifestHash: string;
  /** Source episode IDs, when the corpus cases were materialized from episodes. */
  sourceEpisodeIds: readonly string[];
  pairedRun: PairedBaselineRunResult;
};

export type StrategyReplayCaseManifestInput = {
  corpusId: string;
  projectId: string;
  sourceRevision: string;
  suiteVersion: string;
  caseIds: readonly string[];
  sourceEpisodeIds: readonly string[];
};

export function hashStrategyReplayCaseManifest(
  input: StrategyReplayCaseManifestInput,
): string {
  return canonicalJsonHash({
    kind: "strategy-replay-case-manifest",
    version: STRATEGY_REPLAY_POLICY.version,
    corpusId: input.corpusId,
    projectId: input.projectId,
    sourceRevision: input.sourceRevision,
    suiteVersion: input.suiteVersion,
    caseIds: [...input.caseIds].sort(),
    sourceEpisodeIds: [...input.sourceEpisodeIds].sort(),
  });
}

export type AnalyzeStrategyReplayEvidenceInput = {
  candidate: StrategyCandidate;
  trainingProjectId: string;
  trainingSourceRevision: string;
  current?: StrategyReplayCorpusRun;
  heldOut?: StrategyReplayCorpusRun;
  crossProjectFixtures?: readonly StrategyReplayCorpusRun[];
  /** Server-computed expected calibration error for the held-out confidence bins. */
  confidenceCalibrationEce?: number | null;
};

const StrategyReplayBlockerCodeSchema = z.enum([
  "candidate_not_replayable",
  "supporting_episode_threshold",
  "invalid_training_identity",
  "missing_current_corpus",
  "missing_held_out_corpus",
  "insufficient_held_out_cases",
  "insufficient_transfer_fixtures",
  "too_many_transfer_fixtures",
  "invalid_corpus_identity",
  "corpus_partition_mismatch",
  "duplicate_corpus_identity",
  "case_manifest_mismatch",
  "case_partition_overlap",
  "training_episode_leakage",
  "paired_run_invalid",
  "paired_run_incomplete",
  "paired_run_regressed",
  "paired_candidate_mismatch",
  "paired_run_identity_mismatch",
  "held_out_success_regression",
  "learning_delta_not_met",
  "calibration_missing",
  "calibration_invalid",
  "calibration_threshold_exceeded",
]);

const StrategyReplayBlockerSchema = z.object({
  code: StrategyReplayBlockerCodeSchema,
  disposition: z.enum(["incomplete", "regressed"]),
  reason: z.string().min(1).max(240),
}).strict();

export const StrategyReplayEvidenceAnalysisSchema = z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  kind: z.literal("strategy-replay-evidence-analysis"),
  policyVersion: z.literal(STRATEGY_REPLAY_POLICY.version),
  analysisId: z.string().min(1).max(200),
  candidateId: z.string().min(1).max(200),
  candidateHash: z.string().regex(STRATEGY_REPLAY_DIGEST),
  /** This report is diagnostic only and cannot change the candidate lifecycle. */
  authoritative: z.literal(false),
  readiness: z.enum(["incomplete", "regressed", "meets_measured_thresholds"]),
  metrics: z.object({
    currentCases: z.number().int().nonnegative().nullable(),
    heldOutCases: z.number().int().nonnegative().nullable(),
    transferFixtures: z.number().int().nonnegative(),
    transferCases: z.number().int().nonnegative(),
    pairedCasePassRate: z.number().min(0).max(1).nullable(),
    heldOutCorrectCompletionDelta: z.number().finite().nullable(),
    heldOutCostReduction: z.number().finite().nullable(),
    heldOutRetryReduction: z.number().finite().nullable(),
    confidenceCalibrationEce: z.number().min(0).max(1).nullable(),
  }).strict(),
  blockers: z.array(StrategyReplayBlockerSchema).max(32),
}).strict();

export type StrategyReplayEvidenceAnalysis = z.infer<
  typeof StrategyReplayEvidenceAnalysisSchema
>;

type BlockerCode = z.infer<typeof StrategyReplayBlockerCodeSchema>;
type BlockerDisposition = "incomplete" | "regressed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addBlocker(
  blockers: StrategyReplayEvidenceAnalysis["blockers"],
  code: BlockerCode,
  disposition: BlockerDisposition,
  reason: string,
): void {
  if (blockers.some((blocker) => blocker.code === code)) return;
  blockers.push({ code, disposition, reason });
}

function canonicalHash(value: unknown): string | undefined {
  try {
    const normalized = JSON.parse(JSON.stringify(value)) as Parameters<
      typeof canonicalJsonHash
    >[0];
    return canonicalJsonHash(normalized);
  } catch {
    return undefined;
  }
}

function average(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function relativeReduction(baseline: number | null, candidate: number | null): number | null {
  if (baseline === null || candidate === null || baseline <= 0) return null;
  return (baseline - candidate) / baseline;
}

function readCaseIds(run: StrategyReplayCorpusRun): string[] {
  return run.pairedRun.comparison.cases.map((result) => result.caseId);
}

function verifyCorpusManifest(
  run: StrategyReplayCorpusRun,
  candidate: StrategyCandidate,
  blockers: StrategyReplayEvidenceAnalysis["blockers"],
): boolean {
  if (
    !STRATEGY_REPLAY_ID.test(run.corpusId) ||
    !STRATEGY_REPLAY_ID.test(run.projectId) ||
    !STRATEGY_REPLAY_SOURCE_REVISION.test(run.sourceRevision) ||
    !STRATEGY_REPLAY_DIGEST.test(run.caseManifestHash) ||
    !Array.isArray(run.sourceEpisodeIds) ||
    run.sourceEpisodeIds.some((id) => typeof id !== "string" || !STRATEGY_REPLAY_ID.test(id))
  ) {
    addBlocker(
      blockers,
      "invalid_corpus_identity",
      "incomplete",
      "A replay corpus has missing or malformed server-owned identity fields.",
    );
    return false;
  }

  const uniqueEpisodeIds = new Set(run.sourceEpisodeIds);
  if (uniqueEpisodeIds.size !== run.sourceEpisodeIds.length) {
    addBlocker(
      blockers,
      "invalid_corpus_identity",
      "incomplete",
      "A replay corpus repeats a source episode identity.",
    );
    return false;
  }
  if (run.sourceEpisodeIds.some((id) => candidate.supportingEpisodeIds.includes(id))) {
    addBlocker(
      blockers,
      "training_episode_leakage",
      "incomplete",
      "A replay corpus includes an episode used to support the candidate.",
    );
    return false;
  }

  const pairedRun = run.pairedRun;
  if (
    !isRecord(pairedRun) ||
    !isRecord(pairedRun.baseline) ||
    !isRecord(pairedRun.candidate) ||
    !isRecord(pairedRun.comparison) ||
    !isRecord(pairedRun.comparison.contract)
  ) {
    addBlocker(
      blockers,
      "paired_run_invalid",
      "incomplete",
      "A replay corpus does not contain a complete paired-baseline run.",
    );
    return false;
  }

  const { baseline, candidate: candidateRun, comparison } = pairedRun;
  let recomputed;
  try {
    recomputed = comparePairedBaseline({
      contract: comparison.contract,
      baseline,
      candidate: candidateRun,
    });
  } catch {
    addBlocker(
      blockers,
      "paired_run_invalid",
      "incomplete",
      "A paired-baseline artifact could not be recomputed from its runs.",
    );
    return false;
  }

  const suppliedComparisonHash = canonicalHash(comparison);
  const recomputedComparisonHash = canonicalHash(recomputed);
  if (
    !suppliedComparisonHash ||
    !recomputedComparisonHash ||
    suppliedComparisonHash !== recomputedComparisonHash
  ) {
    addBlocker(
      blockers,
      "paired_run_invalid",
      "incomplete",
      "A paired-baseline comparison does not match its retained run evidence.",
    );
    return false;
  }

  if (comparison.contract.candidateId !== candidate.candidateId) {
    addBlocker(
      blockers,
      "paired_candidate_mismatch",
      "incomplete",
      "A paired-baseline artifact is bound to a different strategy candidate.",
    );
    return false;
  }
  if (
    comparison.contract.sourceRevision !== run.sourceRevision ||
    baseline.sourceRevision !== run.sourceRevision ||
    candidateRun.sourceRevision !== run.sourceRevision
  ) {
    addBlocker(
      blockers,
      "paired_run_identity_mismatch",
      "incomplete",
      "A paired-baseline run is not bound to the corpus project revision.",
    );
    return false;
  }
  if (comparison.status === "regressed") {
    addBlocker(
      blockers,
      "paired_run_regressed",
      "regressed",
      "A paired-baseline run detected a safety, evidence, outcome, or resource regression.",
    );
  } else if (comparison.status !== "passed" || comparison.promotionAllowed !== true) {
    addBlocker(
      blockers,
      "paired_run_incomplete",
      "incomplete",
      "A paired-baseline run is incomplete or is not eligible under its shared contract.",
    );
    return false;
  }

  const caseIds = readCaseIds(run);
  const candidateCaseIds = candidateRun.observations.map((observation) => observation.caseId);
  const baselineCaseIds = baseline.observations.map((observation) => observation.caseId);
  if (
    caseIds.length === 0 ||
    new Set(caseIds).size !== caseIds.length ||
    canonicalHash([...caseIds].sort()) !== canonicalHash([...candidateCaseIds].sort()) ||
    canonicalHash([...caseIds].sort()) !== canonicalHash([...baselineCaseIds].sort())
  ) {
    addBlocker(
      blockers,
      "paired_run_invalid",
      "incomplete",
      "A paired-baseline corpus has missing, duplicate, or mismatched case identities.",
    );
    return false;
  }

  const expectedManifestHash = hashStrategyReplayCaseManifest({
    corpusId: run.corpusId,
    projectId: run.projectId,
    sourceRevision: run.sourceRevision,
    suiteVersion: candidateRun.scorecard.suiteVersion,
    caseIds: [...caseIds].sort(),
    sourceEpisodeIds: [...run.sourceEpisodeIds].sort(),
  });
  if (expectedManifestHash !== run.caseManifestHash) {
    addBlocker(
      blockers,
      "case_manifest_mismatch",
      "incomplete",
      "A replay corpus manifest does not match the paired case set and suite.",
    );
    return false;
  }
  return true;
}

function analysisIdFor(input: AnalyzeStrategyReplayEvidenceInput, candidateHash: string): string {
  const corpora = [
    input.current,
    input.heldOut,
    ...(input.crossProjectFixtures ?? []),
  ].filter((run): run is StrategyReplayCorpusRun => Boolean(run));
  const identities = corpora.map((run) => ({
    corpusId: run.corpusId,
    projectId: run.projectId,
    sourceRevision: run.sourceRevision,
    caseManifestHash: run.caseManifestHash,
    pairId: isRecord(run.pairedRun) && isRecord(run.pairedRun.comparison)
      && isRecord(run.pairedRun.comparison.contract)
      ? run.pairedRun.comparison.contract.pairId
      : null,
  }));
  const digest = canonicalJsonHash({
    policyVersion: STRATEGY_REPLAY_POLICY.version,
    candidateHash,
    trainingProjectId: input.trainingProjectId,
    trainingSourceRevision: input.trainingSourceRevision,
    corpora: identities,
  } as Parameters<typeof canonicalJsonHash>[0]);
  return `strategy-replay-analysis:${digest}`;
}

/**
 * Produces a non-authoritative analysis of paired replay artifacts. It never
 * advances StrategyCandidate.evaluationStatus: proof-bound corpus execution,
 * durable receipt storage, and the existing promotion policy remain separate.
 */
export function analyzeStrategyReplayEvidence(
  input: AnalyzeStrategyReplayEvidenceInput,
): StrategyReplayEvidenceAnalysis {
  const candidate = StrategyCandidateSchema.parse(input.candidate);
  const candidateHash = hashStrategyCandidate(candidate);
  const blockers: StrategyReplayEvidenceAnalysis["blockers"] = [];

  if (!["discovered", "pending_replay"].includes(candidate.evaluationStatus)) {
    addBlocker(
      blockers,
      "candidate_not_replayable",
      "incomplete",
      "Only discovered or pending-replay candidates can be analyzed.",
    );
  }
  if (new Set(candidate.supportingEpisodeIds).size !== candidate.supportingEpisodeIds.length) {
    addBlocker(
      blockers,
      "supporting_episode_threshold",
      "incomplete",
      "The candidate repeats a supporting episode identity.",
    );
  } else if (candidate.supportingEpisodeIds.length < 2) {
    addBlocker(
      blockers,
      "supporting_episode_threshold",
      "incomplete",
      "At least two accepted supporting episodes are required before replay analysis.",
    );
  }

  if (
    !STRATEGY_REPLAY_ID.test(input.trainingProjectId) ||
    !STRATEGY_REPLAY_SOURCE_REVISION.test(input.trainingSourceRevision)
  ) {
    addBlocker(
      blockers,
      "invalid_training_identity",
      "incomplete",
      "The candidate training project or source revision is malformed.",
    );
  }

  const crossProjectFixtures = input.crossProjectFixtures ?? [];
  if (crossProjectFixtures.length > STRATEGY_REPLAY_POLICY.maximumTransferFixtures) {
    addBlocker(
      blockers,
      "too_many_transfer_fixtures",
      "incomplete",
      "The replay input exceeds the bounded transfer-fixture limit.",
    );
  }
  if (!input.current) {
    addBlocker(
      blockers,
      "missing_current_corpus",
      "incomplete",
      "A current-corpus paired replay is required.",
    );
  }
  if (!input.heldOut) {
    addBlocker(
      blockers,
      "missing_held_out_corpus",
      "incomplete",
      "A held-out paired replay is required.",
    );
  }
  if (crossProjectFixtures.length < STRATEGY_REPLAY_POLICY.minimumIndependentTransferFixtures) {
    addBlocker(
      blockers,
      "insufficient_transfer_fixtures",
      "incomplete",
      "At least three independent cross-project transfer fixtures are required.",
    );
  }

  const corpusRuns = [
    ...(input.current ? [input.current] : []),
    ...(input.heldOut ? [input.heldOut] : []),
    ...crossProjectFixtures.slice(0, STRATEGY_REPLAY_POLICY.maximumTransferFixtures),
  ];
  const corpusIds = corpusRuns.map((run) => run.corpusId);
  if (new Set(corpusIds).size !== corpusIds.length) {
    addBlocker(
      blockers,
      "duplicate_corpus_identity",
      "incomplete",
      "Current, held-out, and transfer runs must use distinct corpus identities.",
    );
  }

  const validRuns = new Set<StrategyReplayCorpusRun>();
  for (const run of corpusRuns) {
    if (verifyCorpusManifest(run, candidate, blockers)) validRuns.add(run);
  }

  for (const run of [input.current, input.heldOut].filter(
    (value): value is StrategyReplayCorpusRun => Boolean(value),
  )) {
    if (
      run.projectId !== input.trainingProjectId ||
      run.sourceRevision !== input.trainingSourceRevision
    ) {
      addBlocker(
        blockers,
        "corpus_partition_mismatch",
        "incomplete",
        "Current and held-out corpora must remain on the candidate's project revision.",
      );
    }
  }
  const transferProjectIds = crossProjectFixtures.map((run) => run.projectId);
  if (
    transferProjectIds.some((projectId) => projectId === input.trainingProjectId) ||
    new Set(transferProjectIds).size !== transferProjectIds.length
  ) {
    addBlocker(
      blockers,
      "corpus_partition_mismatch",
      "incomplete",
      "Transfer fixtures must come from distinct projects outside the candidate's training project.",
    );
  }

  const currentCaseIds = input.current && validRuns.has(input.current)
    ? readCaseIds(input.current)
    : [];
  const heldOutCaseIds = input.heldOut && validRuns.has(input.heldOut)
    ? readCaseIds(input.heldOut)
    : [];
  const heldOutCases = input.heldOut && validRuns.has(input.heldOut)
    ? input.heldOut.pairedRun.candidate.scorecard.metrics.observedCases
    : null;
  if (heldOutCases !== null && heldOutCases < STRATEGY_REPLAY_POLICY.minimumHeldOutCases) {
    addBlocker(
      blockers,
      "insufficient_held_out_cases",
      "incomplete",
      "The held-out paired replay has fewer than 30 cases.",
    );
  }
  if (
    currentCaseIds.length > 0 &&
    heldOutCaseIds.length > 0 &&
    currentCaseIds.some((caseId) => heldOutCaseIds.includes(caseId))
  ) {
    addBlocker(
      blockers,
      "case_partition_overlap",
      "incomplete",
      "Current and held-out replay case manifests overlap.",
    );
  }

  const allComparisons = corpusRuns
    .filter((run) => validRuns.has(run))
    .map((run) => run.pairedRun.comparison);
  const totalPairedCases = allComparisons.reduce(
    (total, comparison) => total + comparison.cases.length,
    0,
  );
  const passingPairedCases = allComparisons.reduce(
    (total, comparison) => total + comparison.cases.filter((result) => result.blockers.length === 0).length,
    0,
  );
  const pairedCasePassRate = totalPairedCases > 0
    ? passingPairedCases / totalPairedCases
    : null;
  const transferCases = crossProjectFixtures.reduce(
    (total, run) => total + (
      validRuns.has(run) ? run.pairedRun.comparison.cases.length : 0
    ),
    0,
  );
  const validTransferFixtureCount = crossProjectFixtures.filter(
    (run) => validRuns.has(run),
  ).length;

  let heldOutCorrectCompletionDelta: number | null = null;
  let heldOutCostReduction: number | null = null;
  let heldOutRetryReduction: number | null = null;
  if (input.heldOut && validRuns.has(input.heldOut)) {
    const { baseline, candidate: pairedCandidate } = input.heldOut.pairedRun;
    heldOutCorrectCompletionDelta =
      pairedCandidate.scorecard.metrics.correctCompletionRate -
      baseline.scorecard.metrics.correctCompletionRate;
    heldOutCostReduction = relativeReduction(
      average(baseline.observations.map((observation) => observation.costUnits ?? Number.NaN)),
      average(pairedCandidate.observations.map((observation) => observation.costUnits ?? Number.NaN)),
    );
    heldOutRetryReduction = relativeReduction(
      average(baseline.observations.map((observation) => observation.repairAttempts)),
      average(pairedCandidate.observations.map((observation) => observation.repairAttempts)),
    );

    if (heldOutCorrectCompletionDelta < -STRATEGY_REPLAY_POLICY.maximumSuccessRegression) {
      addBlocker(
        blockers,
        "held_out_success_regression",
        "regressed",
        "Held-out correct-completion rate regressed beyond the two-point allowance.",
      );
    }
    if (
      heldOutCorrectCompletionDelta < STRATEGY_REPLAY_POLICY.requiredSuccessImprovement &&
      (heldOutCostReduction ?? Number.NEGATIVE_INFINITY) <
        STRATEGY_REPLAY_POLICY.requiredCostOrRetryReduction &&
      (heldOutRetryReduction ?? Number.NEGATIVE_INFINITY) <
        STRATEGY_REPLAY_POLICY.requiredCostOrRetryReduction
    ) {
      addBlocker(
        blockers,
        "learning_delta_not_met",
        "regressed",
        "Held-out success did not improve by five points and cost or retries did not fall by fifteen percent.",
      );
    }
  }

  const ece = input.confidenceCalibrationEce;
  if (ece === undefined || ece === null) {
    addBlocker(
      blockers,
      "calibration_missing",
      "incomplete",
      "A server-computed held-out confidence calibration result is required.",
    );
  } else if (!Number.isFinite(ece) || ece < 0 || ece > 1) {
    addBlocker(
      blockers,
      "calibration_invalid",
      "incomplete",
      "The held-out calibration result is outside the valid range.",
    );
  } else if (ece > STRATEGY_REPLAY_POLICY.maximumCalibrationEce) {
    addBlocker(
      blockers,
      "calibration_threshold_exceeded",
      "regressed",
      "Held-out confidence calibration error exceeds the 0.15 limit.",
    );
  }

  const readiness = blockers.some((blocker) => blocker.disposition === "regressed")
    ? "regressed"
    : blockers.length > 0
      ? "incomplete"
      : "meets_measured_thresholds";

  return StrategyReplayEvidenceAnalysisSchema.parse({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    kind: "strategy-replay-evidence-analysis",
    policyVersion: STRATEGY_REPLAY_POLICY.version,
    analysisId: analysisIdFor(input, candidateHash),
    candidateId: candidate.candidateId,
    candidateHash,
    authoritative: false,
    readiness,
    metrics: {
      currentCases: input.current && validRuns.has(input.current)
        ? input.current.pairedRun.candidate.scorecard.metrics.observedCases
        : null,
      heldOutCases,
      transferFixtures: validTransferFixtureCount,
      transferCases,
      pairedCasePassRate,
      heldOutCorrectCompletionDelta,
      heldOutCostReduction,
      heldOutRetryReduction,
      confidenceCalibrationEce: ece !== undefined && ece !== null && Number.isFinite(ece)
        && ece >= 0 && ece <= 1
        ? ece
        : null,
    },
    blockers,
  });
}