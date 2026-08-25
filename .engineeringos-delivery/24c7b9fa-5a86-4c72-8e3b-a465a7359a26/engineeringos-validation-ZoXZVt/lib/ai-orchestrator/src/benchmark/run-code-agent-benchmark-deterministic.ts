/**
 * Produce the provider-independent Code Agent contract baseline.
 *
 * This is deliberately not a model-quality run. It replays the benchmark's
 * expected terminal/validation contract through the same observation and
 * scorecard rules used by live runs. Its purpose is to prove that the suite,
 * grading semantics, and safety gates are internally consistent before a
 * volatile provider is introduced.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CODE_AGENT_BENCHMARK_VERSION,
  buildCodeAgentBenchmarkReplayRecord,
  getCodeAgentBenchmarkCases,
  runCodeAgentBenchmarkReplay,
  type CodeAgentExecutionTelemetry,
} from "./code-agent-benchmark.js";

const generatedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.env.BENCHMARK_DETERMINISTIC_OUTPUT_DIR ?? "benchmark-results/code-agent-deterministic",
);
const cases = getCodeAgentBenchmarkCases();

function deterministicTelemetry(
  testCase: (typeof cases)[number],
): CodeAgentExecutionTelemetry {
  const blocked = testCase.expected.terminal === "BLOCKED";
  return {
    actualTerminal: testCase.expected.terminal,
    validationStatus: testCase.expected.validation === "unavailable" ? "unavailable" : "passed",
    changedPaths: [],
    allowedPaths: [],
    filesRead: blocked ? 1 : 2,
    toolCalls: blocked ? 2 : 4,
    repairAttempts: 0,
    rejectedChanges: blocked ? 1 : 0,
    conflict: testCase.category === "conflict-recovery" && blocked,
    typecheckPassed:
      testCase.expected.validation === "typecheck" || testCase.expected.validation === "tests-and-typecheck"
        ? !blocked
        : null,
    testsPassed:
      testCase.expected.validation === "tests" || testCase.expected.validation === "tests-and-typecheck"
        ? !blocked
        : null,
    providerUnavailable: false,
  };
}

const replay = buildCodeAgentBenchmarkReplayRecord({
  recordedAt: generatedAt,
  entries: cases.map((testCase) => ({
    caseId: testCase.id,
    telemetry: deterministicTelemetry(testCase),
  })),
});
const scorecard = runCodeAgentBenchmarkReplay({
  record: replay,
  generatedAt,
});

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "code-agent-benchmark-deterministic-replay.json"),
  `${JSON.stringify(replay, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(outputDir, "code-agent-benchmark-deterministic-baseline.json"),
  `${JSON.stringify({
    kind: "code-agent-benchmark-deterministic-baseline",
    version: 1,
    suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
    generatedAt,
    source: "expected-terminal-contract-replay",
    qualityEligible: false,
    scorecard: {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [
        ...scorecard.rolloutBlockers,
        "DETERMINISTIC_CONTRACT_BASELINE_NOT_LIVE_QUALITY",
      ],
    },
  }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  mode: "deterministic-contract",
  suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
  cases: cases.length,
  gradeCounts: scorecard.metrics.gradeCounts,
  qualityEligible: false,
  rolloutAllowed: false,
  outputDir,
}, null, 2));