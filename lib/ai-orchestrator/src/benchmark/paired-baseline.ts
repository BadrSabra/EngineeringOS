import {
  runCodeAgentBenchmark,
  type CodeAgentBenchmarkCase,
  type CodeAgentBenchmarkExecutor,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkScorecard,
} from "./code-agent-benchmark.js";

export const PAIRED_BASELINE_VERSION = 1 as const;
export const PAIRED_BASELINE_MAX_RESOURCE_REGRESSION = 0.05;

export type PairedBaselineRun = {
  runId: string;
  workspaceHash: string;
  sourceRevision: string;
  objectiveDigest: string;
  scopeDigest: string;
  budgetDigest: string;
  scorecard: CodeAgentBenchmarkScorecard;
  observations: readonly CodeAgentBenchmarkObservation[];
};

export type PairedBaselineContract = {
  kind: "code-agent-benchmark-paired-contract";
  version: typeof PAIRED_BASELINE_VERSION;
  pairId: string;
  suiteVersion: string;
  sourceRevision: string;
  objectiveDigest: string;
  scopeDigest: string;
  budgetDigest: string;
  baselineRunId: string;
  candidateRunId: string;
  baselineWorkspaceHash: string;
  candidateWorkspaceHash: string;
};

export type PairedBaselineMetricDeltas = {
  evidenceCoverage: number;
  validatorPassRate: number;
  duplicateCalls: number;
  unauthorizedCalls: number;
  recoveryCount: number;
  durationMs: number;
  costUnits: number;
};

export type PairedBaselineCaseResult = {
  caseId: string;
  baselineTerminal: NonNullable<CodeAgentBenchmarkObservation["terminalOutcome"]>;
  candidateTerminal: NonNullable<CodeAgentBenchmarkObservation["terminalOutcome"]>;
  evidenceCoverageDelta: number;
  validatorRegressed: boolean;
  duplicateCallsDelta: number;
  unauthorizedCallsDelta: number;
  recoveryCountDelta: number;
  durationMsDelta: number;
  costUnitsDelta: number;
  blockers: string[];
};

export type PairedBaselineComparison = {
  kind: "code-agent-benchmark-paired-comparison";
  version: typeof PAIRED_BASELINE_VERSION;
  status: "incomplete" | "regressed" | "passed";
  promotionAllowed: boolean;
  contract: PairedBaselineContract;
  baselineRunId: string;
  candidateRunId: string;
  baselineWorkspaceHash: string;
  candidateWorkspaceHash: string;
  metricDeltas?: PairedBaselineMetricDeltas;
  terminalMismatchCount: number;
  cases: PairedBaselineCaseResult[];
  blockers: string[];
};

export type PairedBaselineRunResult = {
  baseline: PairedBaselineRun;
  candidate: PairedBaselineRun;
  comparison: PairedBaselineComparison;
};

type PairMetrics = {
  evidenceCoverage: number;
  validatorPassed: boolean;
  duplicateCalls: number;
  unauthorizedCalls: number;
  recoveryCount: number;
  durationMs: number;
  costUnits: number;
  terminalOutcome: NonNullable<CodeAgentBenchmarkObservation["terminalOutcome"]>;
};

function addBlocker(blockers: string[], value: string): void {
  if (!blockers.includes(value)) blockers.push(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value);
}

function nonNegativeFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function readPairMetrics(
  observation: CodeAgentBenchmarkObservation,
): PairMetrics | undefined {
  if (
    !Number.isFinite(observation.evidenceCoverage) ||
    observation.evidenceCoverage === undefined ||
    observation.evidenceCoverage < 0 ||
    observation.evidenceCoverage > 1 ||
    !observation.validatorOutcome ||
    !nonNegativeFinite(observation.duplicateCalls) ||
    !Number.isInteger(observation.duplicateCalls) ||
    !nonNegativeFinite(observation.unauthorizedCalls) ||
    !Number.isInteger(observation.unauthorizedCalls) ||
    !nonNegativeFinite(observation.recoveryCount) ||
    !Number.isInteger(observation.recoveryCount) ||
    !nonNegativeFinite(observation.durationMs) ||
    !nonNegativeFinite(observation.costUnits) ||
    !observation.terminalOutcome
  ) return undefined;

  return {
    evidenceCoverage: observation.evidenceCoverage,
    validatorPassed: observation.validatorOutcome === "passed",
    duplicateCalls: observation.duplicateCalls,
    unauthorizedCalls: observation.unauthorizedCalls,
    recoveryCount: observation.recoveryCount,
    durationMs: observation.durationMs,
    costUnits: observation.costUnits,
    terminalOutcome: observation.terminalOutcome,
  };
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function resourceRegressed(candidate: number, baseline: number): boolean {
  if (baseline === 0) return candidate > 0;
  return candidate > baseline * (1 + PAIRED_BASELINE_MAX_RESOURCE_REGRESSION);
}

function validateContract(
  contract: PairedBaselineContract,
  baseline: PairedBaselineRun,
  candidate: PairedBaselineRun,
  blockers: string[],
): void {
  if (
    contract.kind !== "code-agent-benchmark-paired-contract" ||
    contract.version !== PAIRED_BASELINE_VERSION
  ) addBlocker(blockers, "paired baseline contract is unsupported");
  for (const [label, value] of [
    ["pair id", contract.pairId],
    ["suite version", contract.suiteVersion],
    ["source revision", contract.sourceRevision],
    ["objective digest", contract.objectiveDigest],
    ["scope digest", contract.scopeDigest],
    ["budget digest", contract.budgetDigest],
  ] as const) {
    if (typeof value !== "string" || !value.trim()) {
      addBlocker(blockers, `paired baseline ${label} is missing`);
    }
  }
  if (!isDigest(contract.sourceRevision)) addBlocker(blockers, "paired baseline source revision is malformed");
  if (!isDigest(contract.baselineWorkspaceHash) || !isDigest(contract.candidateWorkspaceHash)) {
    addBlocker(blockers, "paired baseline workspace hashes are malformed");
  }
  if (contract.baselineWorkspaceHash === contract.candidateWorkspaceHash) {
    addBlocker(blockers, "paired baseline and candidate workspaces are not distinct");
  }
  if (contract.baselineRunId !== baseline.runId || contract.candidateRunId !== candidate.runId) {
    addBlocker(blockers, "paired baseline run identities do not match the contract");
  }
  if (
    contract.suiteVersion !== baseline.scorecard.suiteVersion ||
    contract.suiteVersion !== candidate.scorecard.suiteVersion ||
    baseline.scorecard.suiteVersion !== candidate.scorecard.suiteVersion
  ) addBlocker(blockers, "paired baseline runs use incompatible suites");
  if (
    baseline.sourceRevision !== contract.sourceRevision ||
    candidate.sourceRevision !== contract.sourceRevision
  ) addBlocker(blockers, "paired baseline runs use different source revisions");
  if (
    baseline.workspaceHash !== contract.baselineWorkspaceHash ||
    candidate.workspaceHash !== contract.candidateWorkspaceHash
  ) addBlocker(blockers, "paired baseline workspace identity does not match the contract");
  if (
    baseline.objectiveDigest !== candidate.objectiveDigest ||
    baseline.scopeDigest !== candidate.scopeDigest ||
    baseline.budgetDigest !== candidate.budgetDigest
  ) addBlocker(blockers, "paired baseline objective, scope, or budget differs");
}

function observeByCase(
  observations: readonly CodeAgentBenchmarkObservation[],
): Map<string, CodeAgentBenchmarkObservation> | undefined {
  const byCase = new Map<string, CodeAgentBenchmarkObservation>();
  for (const observation of observations) {
    if (byCase.has(observation.caseId)) return undefined;
    byCase.set(observation.caseId, observation);
  }
  return byCase;
}

/**
 * Compare two independent executions of the same server-owned benchmark
 * contract. This is deliberately stricter than the aggregate baseline gate:
 * every case must have paired evidence before promotion can be considered.
 */
export function comparePairedBaseline(args: {
  contract: PairedBaselineContract;
  baseline: PairedBaselineRun;
  candidate: PairedBaselineRun;
}): PairedBaselineComparison {
  const blockers: string[] = [];
  const { contract, baseline, candidate } = args;
  validateContract(contract, baseline, candidate, blockers);

  const baselineByCase = observeByCase(baseline.observations);
  const candidateByCase = observeByCase(candidate.observations);
  if (!baselineByCase || !candidateByCase) {
    addBlocker(blockers, "paired baseline observations contain duplicate case ids");
  }

  const expectedCaseIds = new Set([
    ...baseline.scorecard.cases.map((observation) => observation.caseId),
    ...candidate.scorecard.cases.map((observation) => observation.caseId),
  ]);
  if (
    !baseline.scorecard.metrics.complete ||
    !candidate.scorecard.metrics.complete ||
    baseline.observations.length !== candidate.observations.length ||
    baseline.scorecard.metrics.observedCases !== candidate.scorecard.metrics.observedCases
  ) addBlocker(blockers, "paired baseline run is incomplete");
  if (!baseline.scorecard.rolloutAllowed) addBlocker(blockers, "baseline scorecard is not rollout eligible");
  if (!candidate.scorecard.rolloutAllowed) addBlocker(blockers, "candidate scorecard is not rollout eligible");

  const cases: PairedBaselineCaseResult[] = [];
  const metricRows: Array<{ baseline: PairMetrics; candidate: PairMetrics }> = [];
  for (const caseId of expectedCaseIds) {
    const baselineObservation = baselineByCase?.get(caseId);
    const candidateObservation = candidateByCase?.get(caseId);
    const baselineMetrics = baselineObservation && readPairMetrics(baselineObservation);
    const candidateMetrics = candidateObservation && readPairMetrics(candidateObservation);
    if (!baselineMetrics || !candidateMetrics) {
      addBlocker(blockers, `paired evidence is incomplete for case ${caseId}`);
      continue;
    }

    const caseBlockers: string[] = [];
    if (baselineMetrics.terminalOutcome !== candidateMetrics.terminalOutcome) {
      caseBlockers.push(`terminal outcome changed for ${caseId}`);
    }
    if (candidateMetrics.evidenceCoverage < baselineMetrics.evidenceCoverage) {
      caseBlockers.push(`evidence coverage regressed for ${caseId}`);
    }
    if (baselineMetrics.validatorPassed && !candidateMetrics.validatorPassed) {
      caseBlockers.push(`validator outcome regressed for ${caseId}`);
    }
    if (candidateMetrics.duplicateCalls > baselineMetrics.duplicateCalls) {
      caseBlockers.push(`duplicate calls increased for ${caseId}`);
    }
    if (candidateMetrics.unauthorizedCalls > baselineMetrics.unauthorizedCalls ||
        candidateMetrics.unauthorizedCalls > 0) {
      caseBlockers.push(`unauthorized calls detected for ${caseId}`);
    }
    if (candidateMetrics.recoveryCount > baselineMetrics.recoveryCount) {
      caseBlockers.push(`recovery count increased for ${caseId}`);
    }
    if (resourceRegressed(candidateMetrics.durationMs, baselineMetrics.durationMs)) {
      caseBlockers.push(`duration regressed for ${caseId}`);
    }
    if (resourceRegressed(candidateMetrics.costUnits, baselineMetrics.costUnits)) {
      caseBlockers.push(`cost regressed for ${caseId}`);
    }
    for (const blocker of caseBlockers) addBlocker(blockers, blocker);
    metricRows.push({ baseline: baselineMetrics, candidate: candidateMetrics });
    cases.push({
      caseId,
      baselineTerminal: baselineMetrics.terminalOutcome,
      candidateTerminal: candidateMetrics.terminalOutcome,
      evidenceCoverageDelta: candidateMetrics.evidenceCoverage - baselineMetrics.evidenceCoverage,
      validatorRegressed: baselineMetrics.validatorPassed && !candidateMetrics.validatorPassed,
      duplicateCallsDelta: candidateMetrics.duplicateCalls - baselineMetrics.duplicateCalls,
      unauthorizedCallsDelta: candidateMetrics.unauthorizedCalls - baselineMetrics.unauthorizedCalls,
      recoveryCountDelta: candidateMetrics.recoveryCount - baselineMetrics.recoveryCount,
      durationMsDelta: candidateMetrics.durationMs - baselineMetrics.durationMs,
      costUnitsDelta: candidateMetrics.costUnits - baselineMetrics.costUnits,
      blockers: caseBlockers,
    });
  }

  const metricDeltas = metricRows.length > 0
    ? {
        evidenceCoverage: average(metricRows.map((row) => row.candidate.evidenceCoverage)) -
          average(metricRows.map((row) => row.baseline.evidenceCoverage)),
        validatorPassRate: average(metricRows.map((row) => row.candidate.validatorPassed ? 1 : 0)) -
          average(metricRows.map((row) => row.baseline.validatorPassed ? 1 : 0)),
        duplicateCalls: average(metricRows.map((row) => row.candidate.duplicateCalls)) -
          average(metricRows.map((row) => row.baseline.duplicateCalls)),
        unauthorizedCalls: average(metricRows.map((row) => row.candidate.unauthorizedCalls)) -
          average(metricRows.map((row) => row.baseline.unauthorizedCalls)),
        recoveryCount: average(metricRows.map((row) => row.candidate.recoveryCount)) -
          average(metricRows.map((row) => row.baseline.recoveryCount)),
        durationMs: average(metricRows.map((row) => row.candidate.durationMs)) -
          average(metricRows.map((row) => row.baseline.durationMs)),
        costUnits: average(metricRows.map((row) => row.candidate.costUnits)) -
          average(metricRows.map((row) => row.baseline.costUnits)),
      }
    : undefined;
  const terminalMismatchCount = cases.filter(
    (result) => result.baselineTerminal !== result.candidateTerminal,
  ).length;
  const incomplete = blockers.some((blocker) =>
    blocker.includes("incomplete") ||
    blocker.includes("missing") ||
    blocker.includes("malformed") ||
    blocker.includes("unsupported") ||
    blocker.includes("workspace") ||
    blocker.includes("objective, scope, or budget") ||
    blocker.includes("identities") ||
    blocker.includes("different") ||
    blocker.includes("duplicate case ids") ||
    blocker.includes("paired evidence"),
  );
  const status = incomplete ? "incomplete" : blockers.length > 0 ? "regressed" : "passed";

  return {
    kind: "code-agent-benchmark-paired-comparison",
    version: PAIRED_BASELINE_VERSION,
    status,
    promotionAllowed: status === "passed",
    contract,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    baselineWorkspaceHash: contract.baselineWorkspaceHash,
    candidateWorkspaceHash: contract.candidateWorkspaceHash,
    ...(metricDeltas ? { metricDeltas } : {}),
    terminalMismatchCount,
    cases,
    blockers,
  };
}

/**
 * Run both sides through the same case manifest. Workspace creation and
 * server-owned telemetry stay with the caller; the distinct workspace hashes
 * are checked by comparePairedBaseline before any promotion decision.
 */
export async function runPairedCodeAgentBenchmark(args: {
  contract: PairedBaselineContract;
  cases?: readonly CodeAgentBenchmarkCase[];
  baseline: Omit<PairedBaselineRun, "scorecard" | "observations"> & {
    executeCase: CodeAgentBenchmarkExecutor;
  };
  candidate: Omit<PairedBaselineRun, "scorecard" | "observations"> & {
    executeCase: CodeAgentBenchmarkExecutor;
  };
  generatedAt?: string;
}): Promise<PairedBaselineRunResult> {
  const cases = args.cases;
  const baselineScorecard = await runCodeAgentBenchmark({
    executeCase: args.baseline.executeCase,
    cases,
    generatedAt: args.generatedAt,
  });
  const candidateScorecard = await runCodeAgentBenchmark({
    executeCase: args.candidate.executeCase,
    cases,
    generatedAt: args.generatedAt,
  });
  const baseline: PairedBaselineRun = {
    ...args.baseline,
    scorecard: baselineScorecard,
    observations: baselineScorecard.cases,
  };
  const candidate: PairedBaselineRun = {
    ...args.candidate,
    scorecard: candidateScorecard,
    observations: candidateScorecard.cases,
  };
  return {
    baseline,
    candidate,
    comparison: comparePairedBaseline({
      contract: args.contract,
      baseline,
      candidate,
    }),
  };
}