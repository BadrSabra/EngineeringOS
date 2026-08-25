import type {
  CodeAgentBenchmarkGrade,
  CodeAgentBenchmarkObservation,
  CodeAgentBenchmarkScorecard,
} from "./code-agent-benchmark.js";

export type BenchmarkCampaignMode = "coverage" | "clean-witness";

export type BenchmarkCampaignCaseStatus =
  | "passed"
  | "quality-failed"
  | "environment-unavailable"
  | "pending";

export type BenchmarkCampaignCaseRecord = {
  caseId: string;
  status: BenchmarkCampaignCaseStatus;
  grade?: CodeAgentBenchmarkGrade;
  attempts: number;
  provider: string | null;
  model: string | null;
};

export type BenchmarkCampaignSummary = {
  mode: BenchmarkCampaignMode;
  status: "coverage-complete" | "clean-witness" | "incomplete";
  totalCases: number;
  observedCases: number;
  missingCaseIds: string[];
  recoveryCaseIds: string[];
  environmentUnavailableCases: number;
  qualityFailures: number;
  qualityEligible: boolean;
  cleanWitness: boolean;
};

function isEnvironmentUnavailable(observation: CodeAgentBenchmarkObservation): boolean {
  return observation.providerUnavailable === true || observation.grade === "U";
}

export function getBenchmarkRecoveryCaseIds(
  observations: readonly CodeAgentBenchmarkObservation[],
): string[] {
  return observations
    .filter((observation) => isEnvironmentUnavailable(observation) || observation.grade === "F")
    .map((observation) => observation.caseId);
}

export function getBenchmarkCampaignStatus(
  scorecard: Pick<CodeAgentBenchmarkScorecard, "metrics" | "rolloutBlockers">,
  mode: BenchmarkCampaignMode,
): BenchmarkCampaignSummary["status"] {
  if (!scorecard.metrics.complete) return "incomplete";
  if (mode === "clean-witness" && scorecard.metrics.providerUnavailableCount === 0 && scorecard.metrics.gradeCounts.F === 0) {
    return "clean-witness";
  }
  return "coverage-complete";
}

export function isCleanWitnessScorecard(
  scorecard: Pick<CodeAgentBenchmarkScorecard, "metrics" | "missingCaseIds" | "rolloutBlockers">,
): boolean {
  return (
    scorecard.metrics.complete &&
    scorecard.missingCaseIds.length === 0 &&
    scorecard.metrics.providerUnavailableCount === 0 &&
    scorecard.metrics.gradeCounts.U === 0 &&
    scorecard.metrics.gradeCounts.F === 0 &&
    scorecard.metrics.falseSuccessRate === 0 &&
    scorecard.metrics.scopeEscapeRate === 0
  );
}

export function summarizeBenchmarkCampaign(args: {
  mode: BenchmarkCampaignMode;
  caseIds: readonly string[];
  observations: readonly {
    caseId: string;
    provider: string | null;
    model: string | null;
    providerAttempts: number;
    observation: CodeAgentBenchmarkObservation;
  }[];
}): BenchmarkCampaignSummary {
  const observedIds = new Set(args.observations.map((entry) => entry.caseId));
  const missingCaseIds = args.caseIds.filter((caseId) => !observedIds.has(caseId));
  const recoveryCaseIds: string[] = [];
  let environmentUnavailableCases = 0;
  let qualityFailures = 0;

  for (const entry of args.observations) {
    if (isEnvironmentUnavailable(entry.observation)) {
      environmentUnavailableCases += 1;
      recoveryCaseIds.push(entry.caseId);
    } else if (entry.observation.grade === "F") {
      qualityFailures += 1;
      recoveryCaseIds.push(entry.caseId);
    }
  }

  const status =
    observedIds.size < args.caseIds.length
      ? "incomplete"
      : args.mode === "clean-witness" && environmentUnavailableCases === 0 && qualityFailures === 0
        ? "clean-witness"
        : "coverage-complete";

  return {
    mode: args.mode,
    status,
    totalCases: args.caseIds.length,
    observedCases: observedIds.size,
    missingCaseIds,
    recoveryCaseIds: [...new Set(recoveryCaseIds)],
    environmentUnavailableCases,
    qualityFailures,
    qualityEligible: environmentUnavailableCases === 0,
    cleanWitness: status === "clean-witness",
  };
}