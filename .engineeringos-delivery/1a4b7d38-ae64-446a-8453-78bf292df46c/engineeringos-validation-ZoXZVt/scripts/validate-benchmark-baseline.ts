#!/usr/bin/env tsx
/**
 * Validate the checked-in provider-free Code Agent benchmark contract baseline.
 *
 * This is intentionally separate from Truth Flow validation. The benchmark
 * baseline is not a Truth Flow source and must never be materialized from it.
 * The current suite metadata is imported from the benchmark implementation so
 * a suite/version change fails until the checked-in comparison is deliberately
 * regenerated and reviewed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkCases,
} from "../lib/ai-orchestrator/src/benchmark/code-agent-benchmark.js";

const workspaceRoot = resolve(import.meta.dirname, "..");
const baselinePath = resolve(
  workspaceRoot,
  process.env.BENCHMARK_DETERMINISTIC_BASELINE_PATH ??
    "lib/ai-orchestrator/benchmark-results/code-agent-deterministic/code-agent-benchmark-deterministic-baseline.json",
);

function fail(message: string): never {
  console.error(
    `\n❌  Code Agent deterministic baseline check failed.\n` +
      `    ${message}\n` +
      `    Baseline: ${baselinePath}\n` +
      `\n    This baseline is a provider-free contract artifact, not live quality evidence.\n` +
      `    Do not copy values from the Truth Flow baseline or historical/runtime output.\n` +
      `    If the suite changed intentionally, regenerate it with:\n` +
      `      pnpm --filter @workspace/ai-orchestrator run benchmark:code-agent:deterministic\n` +
      `    Then inspect and approve the focused baseline diff before rerunning this check.\n`,
  );
  process.exit(1);
}

let baseline: unknown;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (error) {
  fail(`The checked-in JSON is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
}

if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
  fail("The baseline must be a JSON object.");
}

const record = baseline as Record<string, unknown>;
if (record.kind !== "code-agent-benchmark-deterministic-baseline") {
  fail(`Unexpected baseline kind: ${String(record.kind)}.`);
}
if (record.version !== 1) {
  fail(`Unsupported baseline version: ${String(record.version)}; review the version change explicitly.`);
}
if (record.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION) {
  fail(
    `Suite version mismatch: baseline=${String(record.suiteVersion)}, current=${CODE_AGENT_BENCHMARK_VERSION}.`,
  );
}
if (record.source !== "expected-terminal-contract-replay") {
  fail("The deterministic baseline must be sourced only from expected-terminal-contract-replay.");
}
if (record.qualityEligible !== false) {
  fail("The deterministic baseline must remain qualityEligible=false.");
}

const scorecard = record.scorecard;
if (!scorecard || typeof scorecard !== "object" || Array.isArray(scorecard)) {
  fail("The deterministic baseline scorecard is missing.");
}
const scorecardRecord = scorecard as Record<string, unknown>;
if (scorecardRecord.kind !== "code-agent-benchmark") {
  fail("The deterministic baseline contains an unsupported scorecard kind.");
}
if (scorecardRecord.version !== 1 || scorecardRecord.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION) {
  fail("The deterministic scorecard schema/version does not match the current benchmark suite.");
}
if (scorecardRecord.rolloutAllowed !== false) {
  fail("The deterministic contract scorecard must never allow rollout.");
}

const cases = scorecardRecord.cases;
const expectedCases = getCodeAgentBenchmarkCases();
if (!Array.isArray(cases) || cases.length !== CODE_AGENT_BENCHMARK_CASE_COUNT) {
  fail(
    `Case count mismatch: expected ${CODE_AGENT_BENCHMARK_CASE_COUNT}, got ${Array.isArray(cases) ? cases.length : "missing"}.`,
  );
}
const actualIds = cases.map((entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>).caseId : undefined,
);
const expectedIds = expectedCases.map((entry) => entry.id);
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  fail("Case IDs/order differ from the current benchmark suite; review the corpus change before approval.");
}

const blockers = scorecardRecord.rolloutBlockers;
if (!Array.isArray(blockers) || !blockers.includes("DETERMINISTIC_CONTRACT_BASELINE_NOT_LIVE_QUALITY")) {
  fail("The deterministic scorecard is missing its explicit non-quality rollout blocker.");
}

console.log(JSON.stringify({
  ok: true,
  authority: "Code Agent Benchmark deterministic contract baseline",
  suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
  version: record.version,
  caseCount: cases.length,
  qualityEligible: false,
  rolloutAllowed: false,
  baselinePath,
}, null, 2));