import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(projectRoot, "lib/ai-orchestrator/benchmark-results");
const livePath = path.resolve(
  process.env.BENCHMARK_LIVE_SCORECARD_PATH ?? path.join(resultsRoot, "code-agent-benchmark-live.json"),
);
const baselinePath = path.resolve(
  process.env.BENCHMARK_BASELINE_PATH ?? path.join(resultsRoot, "code-agent-benchmark-baseline.json"),
);

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not be read: ${filePath} (${reason})`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function resolveCurrentSourceRevision() {
  const revision = execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(revision)) {
    throw new Error("current source revision could not be resolved from Git");
  }
  return revision;
}

function validateRolloutScorecard(raw, { approvedBaselineId, currentSourceRevision }) {
  const scorecard = requireRecord(raw, "live benchmark scorecard");
  if (scorecard.kind !== "code-agent-benchmark") {
    throw new Error("live benchmark scorecard has an unsupported kind");
  }
  if (scorecard.version !== 1 || scorecard.suiteVersion !== "flight-deck-v2") {
    throw new Error("live benchmark scorecard is not the approved flight-deck-v2 schema");
  }
  if (scorecard.rolloutAllowed !== true) {
    throw new Error(
      `rolloutAllowed is false: ${(Array.isArray(scorecard.rolloutBlockers) ? scorecard.rolloutBlockers : ["no blocker details"]).join("; ")}`,
    );
  }
  if (
    typeof scorecard.sourceRevision !== "string" ||
    !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(scorecard.sourceRevision)
  ) {
    throw new Error("live benchmark scorecard has no valid sourceRevision");
  }
  if (scorecard.sourceRevision !== currentSourceRevision) {
    throw new Error(
      `live benchmark sourceRevision ${scorecard.sourceRevision} does not match current source ${currentSourceRevision}`,
    );
  }

  const metrics = requireRecord(scorecard.metrics, "live benchmark metrics");
  if (metrics.complete !== true) throw new Error("live benchmark metrics are incomplete");
  requireNumber(metrics.observedCases, "live benchmark observedCases");
  requireNumber(metrics.totalCases, "live benchmark totalCases");
  if (metrics.observedCases !== metrics.totalCases) {
    throw new Error("live benchmark observedCases does not equal totalCases");
  }
  requireNumber(metrics.providerUnavailableCount, "live benchmark providerUnavailableCount");
  if (metrics.providerUnavailableCount !== 0) {
    throw new Error("provider-unavailable cases block deployment");
  }
  if (!Array.isArray(scorecard.rolloutBlockers) || scorecard.rolloutBlockers.length !== 0) {
    throw new Error("live benchmark contains rollout blockers");
  }
  if (!Array.isArray(scorecard.cases)) {
    throw new Error("live benchmark cases are missing");
  }
  if (metrics.totalCases < 1 || scorecard.cases.length !== metrics.observedCases) {
    throw new Error("live benchmark cases do not match the complete observed case count");
  }
  const caseIds = new Set();
  for (const rawResult of scorecard.cases) {
    const result = requireRecord(rawResult, "live benchmark case");
    if (typeof result.caseId !== "string" || result.caseId.trim().length === 0) {
      throw new Error("live benchmark contains a case without a caseId");
    }
    if (caseIds.has(result.caseId)) {
      throw new Error(`live benchmark contains duplicate caseId ${result.caseId}`);
    }
    caseIds.add(result.caseId);
    if (result.sourceRevision !== currentSourceRevision) {
      throw new Error(
        `live benchmark case ${result.caseId} is not bound to the current source revision`,
      );
    }
    if (!["A", "B", "C", "D", "F", "U"].includes(result.grade)) {
      throw new Error(`live benchmark case ${result.caseId} has an invalid grade`);
    }
    if (
      result.grade === "D" &&
      (typeof result.diagnosis !== "string" || result.diagnosis.trim().length === 0)
    ) {
      throw new Error(`live benchmark case ${result.caseId} is D without a diagnosis`);
    }
  }

  const comparison = requireRecord(scorecard.baselineComparison, "baseline comparison");
  if (comparison.status !== "passed") {
    throw new Error(`baseline comparison status is ${String(comparison.status)}`);
  }
  if (typeof comparison.baselineId !== "string" || comparison.baselineId.length === 0) {
    throw new Error("baseline comparison has no baselineId");
  }
  if (comparison.baselineId !== approvedBaselineId) {
    throw new Error(
      `baseline comparison uses ${comparison.baselineId}, not approved baseline ${approvedBaselineId}`,
    );
  }
  if (!Array.isArray(comparison.blockers) || comparison.blockers.length !== 0) {
    throw new Error("baseline comparison contains blockers");
  }
  return {
    suiteVersion: scorecard.suiteVersion,
    baselineId: comparison.baselineId,
    sourceRevision: scorecard.sourceRevision,
    observedCases: metrics.observedCases,
  };
}

function validateBaseline(raw) {
  const baseline = requireRecord(raw, "benchmark baseline");
  if (
    baseline.kind !== "code-agent-benchmark-baseline" ||
    baseline.version !== 1 ||
    baseline.suiteVersion !== "flight-deck-v2"
  ) {
    throw new Error("benchmark baseline is not the approved flight-deck-v2 schema");
  }
  if (typeof baseline.baselineId !== "string" || baseline.baselineId.length === 0) {
    throw new Error("benchmark baseline has no baselineId");
  }
  if (baseline.rolloutAllowed !== true) {
    throw new Error("benchmark baseline is not explicitly approved");
  }
  const metrics = requireRecord(baseline.metrics, "benchmark baseline metrics");
  if (metrics.complete !== true || metrics.observedCases !== metrics.totalCases) {
    throw new Error("benchmark baseline is incomplete");
  }
  requireNumber(metrics.providerUnavailableCount, "benchmark baseline providerUnavailableCount");
  if (metrics.providerUnavailableCount !== 0) {
    throw new Error("benchmark baseline contains provider-unavailable cases");
  }
}

try {
  const [live, baseline] = await Promise.all([
    readJson(livePath, "live benchmark scorecard"),
    readJson(baselinePath, "benchmark baseline"),
  ]);
  validateBaseline(baseline);
  const liveSummary = validateRolloutScorecard(live, {
    approvedBaselineId: baseline.baselineId,
    currentSourceRevision: resolveCurrentSourceRevision(),
  });
  console.log(JSON.stringify({
    ok: true,
    suiteVersion: liveSummary.suiteVersion,
    baselineId: liveSummary.baselineId,
    sourceRevision: liveSummary.sourceRevision,
    observedCases: liveSummary.observedCases,
    rolloutAllowed: true,
  }, null, 2));
} catch (error) {
  console.error(`Benchmark rollout gate blocked deployment: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}