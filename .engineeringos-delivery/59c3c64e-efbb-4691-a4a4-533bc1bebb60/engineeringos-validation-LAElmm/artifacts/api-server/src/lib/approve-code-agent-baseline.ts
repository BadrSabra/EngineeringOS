import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  approveCodeAgentBenchmarkBaseline,
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  CODE_AGENT_BENCHMARK_VERSION,
  type CodeAgentBenchmarkScorecard,
} from "@workspace/ai-orchestrator";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readScorecard(value: unknown): CodeAgentBenchmarkScorecard {
  const candidate =
    isRecord(value) && value.kind === "code-agent-benchmark-airlock"
      ? value.scorecard
      : value;
  if (
    !isRecord(candidate) ||
    candidate.kind !== "code-agent-benchmark" ||
    candidate.version !== 1 ||
    candidate.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION ||
    !Array.isArray(candidate.cases) ||
    !Array.isArray(candidate.missingCaseIds) ||
    !Array.isArray(candidate.rolloutBlockers) ||
    !isRecord(candidate.metrics)
  ) {
    throw new Error("Input does not contain a compatible Code Agent scorecard.");
  }
  const metrics = candidate.metrics;
  const gradeCounts = metrics.gradeCounts;
  const numericFields = [
    "totalCases",
    "observedCases",
    "firstAttemptRate",
    "repairedWithinThreeRate",
    "correctCompletionRate",
    "usefulIncompleteRate",
    "safelyBlockedRate",
    "falseSuccessRate",
    "scopeEscapeRate",
    "conflictRate",
    "averageFilesRead",
    "averageToolCalls",
    "averageRepairAttempts",
    "averageRejectedChanges",
    "providerUnavailableCount",
  ];
  if (
    typeof candidate.generatedAt !== "string" ||
    typeof metrics.complete !== "boolean" ||
    !numericFields.every((field) => typeof metrics[field] === "number") ||
    !isRecord(gradeCounts) ||
    !["A", "B", "C", "D", "F", "U"].every((grade) => typeof gradeCounts[grade] === "number")
  ) {
    throw new Error("Input scorecard is missing bounded benchmark metrics.");
  }
  return candidate as unknown as CodeAgentBenchmarkScorecard;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

const rootPath = path.resolve(process.env.BENCHMARK_SOURCE_ROOT ?? path.resolve(process.cwd(), "../.."));
const inputPath = path.resolve(
  process.env.BENCHMARK_AIRLOCK_RUN_PATH ??
    path.join(rootPath, "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-airlock.run.json"),
);
const outputPath = path.resolve(
  process.env.BENCHMARK_BASELINE_PATH ??
    path.join(rootPath, "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json"),
);
const baselineId = process.env.BENCHMARK_BASELINE_ID?.trim() || `baseline-${CODE_AGENT_BENCHMARK_VERSION}`;

try {
  await fs.access(outputPath);
  if (process.env.BENCHMARK_REPLACE_BASELINE !== "1") {
    throw new Error(
      `Baseline already exists at ${outputPath}. Set BENCHMARK_REPLACE_BASELINE=1 for an explicit replacement.`,
    );
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as unknown;
if (isRecord(input) && input.kind === "code-agent-benchmark-airlock") {
  if (input.campaignMode !== "clean-witness") {
    throw new Error(
      "Baseline approval requires a clean-witness Airlock run; coverage campaigns are diagnostic only.",
    );
  }
  if (input.recoveryOnly === true) {
    throw new Error("Baseline approval cannot use a recovery-only campaign.");
  }
  if (input.shard !== undefined) {
    throw new Error("Baseline approval cannot use a targeted or sharded Airlock run.");
  }
  if (input.targetCaseCount !== CODE_AGENT_BENCHMARK_CASE_COUNT) {
    throw new Error(
      `Baseline approval requires the complete ${CODE_AGENT_BENCHMARK_CASE_COUNT}-case ${CODE_AGENT_BENCHMARK_VERSION} suite.`,
    );
  }
}
const scorecard = readScorecard(input);
const baseline = approveCodeAgentBenchmarkBaseline(scorecard, { baselineId });
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await writeJsonAtomically(outputPath, baseline);

console.log(JSON.stringify({
  baselineId: baseline.baselineId,
  suiteVersion: baseline.suiteVersion,
  totalCases: baseline.metrics.totalCases,
  observedCases: baseline.metrics.observedCases,
  gradeCounts: baseline.metrics.gradeCounts,
  outputPath,
  rolloutAllowed: baseline.rolloutAllowed,
}, null, 2));