import type {
  CodeAgentBenchmarkCase,
  CodeAgentBenchmarkObservation,
  CodeAgentBenchmarkScorecard,
} from "./code-agent-benchmark.js";
import { summarizeBenchmarkCampaign, type BenchmarkCampaignMode } from "./benchmark-campaign.js";

export const BENCHMARK_PARITY_REPORT_VERSION = 1;

export type BenchmarkParityGap = {
  dimension: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "observed-gap" | "environment-gap" | "not-observed";
  evidence: string;
  remediation: string;
};

export type BenchmarkParityReport = {
  kind: "code-agent-observable-parity-report";
  version: typeof BENCHMARK_PARITY_REPORT_VERSION;
  basis: "observable-engineeringos-outcomes";
  comparator: "undocumented-behavior-not-asserted";
  campaign: ReturnType<typeof summarizeBenchmarkCampaign>;
  dimensions: Array<{
    dimension: string;
    caseCount: number;
    observedCaseCount: number;
    qualityPassRate: number | null;
    toolEfficiency: number | null;
  }>;
  gaps: BenchmarkParityGap[];
  prioritizedRemediation: Array<{
    priority: BenchmarkParityGap["priority"];
    dimension: string;
    action: string;
  }>;
};

const DIMENSIONS: ReadonlyArray<{ name: string; categories: readonly string[]; action: string }> = [
  { name: "inspect-and-plan", categories: ["single-file-edit", "broad-decomposition"], action: "Keep bounded read/plan acceptance coverage green before mutation." },
  { name: "multi-file-mutation", categories: ["multi-file-change", "dependency-graph-change"], action: "Improve bounded multi-file change completion while preserving approved scope." },
  { name: "validation-and-repair", categories: ["test-failure-repair", "typecheck-failure-repair"], action: "Reduce failed or repeated validation attempts with server-owned repair evidence." },
  { name: "recovery-and-cancellation", categories: ["conflict-recovery", "cancellation-recovery"], action: "Exercise restart, cancellation, and conflict recovery until evidence converges." },
  { name: "scope-and-false-success", categories: ["scope-safety", "malformed-output", "blocked-proof", "safely-blocked"], action: "Preserve fail-closed scope, malformed-output, and proof gates." },
];

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Produce a comparison report from retained bounded observations. This is a
 * measurement artifact only: it describes EngineeringOS outcomes and never
 * infers or names undocumented comparator internals.
 */
export function buildBenchmarkParityReport(args: {
  mode: BenchmarkCampaignMode;
  cases: readonly CodeAgentBenchmarkCase[];
  scorecard: CodeAgentBenchmarkScorecard;
  observations: readonly { caseId: string; observation: CodeAgentBenchmarkObservation }[];
}): BenchmarkParityReport {
  const campaign = summarizeBenchmarkCampaign({
    mode: args.mode,
    caseIds: args.cases.map((testCase) => testCase.id),
    observations: args.observations.map((entry) => ({
      ...entry,
      provider: null,
      model: null,
      providerAttempts: 0,
    })),
  });
  const byId = new Map(args.observations.map((entry) => [entry.caseId, entry.observation]));
  const dimensions = DIMENSIONS.map((dimension) => {
    const dimensionCases = args.cases.filter((testCase) => dimension.categories.includes(testCase.category));
    const observed = dimensionCases.map((testCase) => byId.get(testCase.id)).filter(
      (observation): observation is CodeAgentBenchmarkObservation => observation !== undefined,
    );
    const qualityObserved = observed.filter((observation) => observation.grade !== "U" && !observation.providerUnavailable);
    const successful = qualityObserved.filter((observation) => observation.correct).length;
    const toolCalls = qualityObserved.reduce((sum, observation) => sum + observation.toolCalls, 0);
    return {
      dimension: dimension.name,
      caseCount: dimensionCases.length,
      observedCaseCount: observed.length,
      qualityPassRate: rate(successful, qualityObserved.length),
      toolEfficiency: rate(qualityObserved.reduce((sum, observation) => sum + observation.filesRead, 0), toolCalls),
    };
  });
  const gaps: BenchmarkParityGap[] = [];
  for (const dimension of dimensions) {
    if (dimension.observedCaseCount < dimension.caseCount) {
      gaps.push({
        dimension: dimension.dimension,
        priority: "high",
        status: "environment-gap",
        evidence: `${dimension.caseCount - dimension.observedCaseCount} representative case(s) lack retained observations.`,
        remediation: DIMENSIONS.find((item) => item.name === dimension.dimension)!.action,
      });
    } else if (dimension.qualityPassRate !== null && dimension.qualityPassRate < 1) {
      gaps.push({
        dimension: dimension.dimension,
        priority: "high",
        status: "observed-gap",
        evidence: `Observed quality pass rate is ${dimension.qualityPassRate}.`,
        remediation: DIMENSIONS.find((item) => item.name === dimension.dimension)!.action,
      });
    }
  }
  if (args.scorecard.metrics.falseSuccessRate > 0 || args.scorecard.metrics.scopeEscapeRate > 0) {
    gaps.unshift({
      dimension: "safety-invariants",
      priority: "critical",
      status: "observed-gap",
      evidence: `falseSuccessRate=${args.scorecard.metrics.falseSuccessRate}; scopeEscapeRate=${args.scorecard.metrics.scopeEscapeRate}.`,
      remediation: "Stop rollout and add a deterministic regression fixture for every unsafe outcome.",
    });
  }
  if (args.scorecard.metrics.providerUnavailableCount > 0) {
    gaps.push({
      dimension: "provider-availability",
      priority: "medium",
      status: "environment-gap",
      evidence: `${args.scorecard.metrics.providerUnavailableCount} provider-unavailable observation(s); U is excluded from quality rates.`,
      remediation: "Retry only in an explicitly opted-in disposable campaign; do not convert U into quality evidence.",
    });
  }
  const prioritizedRemediation = gaps.map((gap) => ({
    priority: gap.priority,
    dimension: gap.dimension,
    action: gap.remediation,
  }));
  return {
    kind: "code-agent-observable-parity-report",
    version: BENCHMARK_PARITY_REPORT_VERSION,
    basis: "observable-engineeringos-outcomes",
    comparator: "undocumented-behavior-not-asserted",
    campaign,
    dimensions,
    gaps,
    prioritizedRemediation,
  };
}

export function benchmarkParityReportToMarkdown(report: BenchmarkParityReport): string {
  return [
    "# Observable code-agent parity report",
    "",
    "This report measures retained EngineeringOS outcomes only. It does not claim access to or infer undocumented comparator behavior.",
    "",
    `- Campaign: ${report.campaign.mode} / ${report.campaign.status}`,
    `- Cases: ${report.campaign.observedCases}/${report.campaign.totalCases}`,
    `- Quality eligible: ${report.campaign.qualityEligible}`,
    "",
    "## Dimensions",
    "",
    "| Dimension | Cases | Observed | Quality pass rate | Files read / tool call |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.dimensions.map((dimension) =>
      `| ${dimension.dimension} | ${dimension.caseCount} | ${dimension.observedCaseCount} | ${dimension.qualityPassRate ?? "n/a"} | ${dimension.toolEfficiency ?? "n/a"} |`),
    "",
    "## Gap table",
    "",
    "| Priority | Dimension | Status | Evidence | Remediation |",
    "| --- | --- | --- | --- | --- |",
    ...(report.gaps.length > 0
      ? report.gaps.map((gap) => `| ${gap.priority} | ${gap.dimension} | ${gap.status} | ${gap.evidence} | ${gap.remediation} |`)
      : ["| — | — | not-observed | No gaps in the retained observations. | Continue deterministic and opt-in campaign checks. |"]),
    "",
    "## Prioritized remediation",
    "",
    ...(report.prioritizedRemediation.length > 0
      ? report.prioritizedRemediation.map((item, index) => `${index + 1}. **${item.priority} — ${item.dimension}:** ${item.action}`)
      : ["No remediation items were generated."]),
    "",
  ].join("\n");
}