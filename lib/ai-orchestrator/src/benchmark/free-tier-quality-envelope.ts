import {
  buildCodeAgentBenchmarkScorecard,
  CODE_AGENT_BENCHMARK_CASE_COUNT,
  CODE_AGENT_BENCHMARK_VERSION,
  getCodeAgentBenchmarkCases,
  type CodeAgentBenchmarkGrade,
  type CodeAgentBenchmarkObservation,
} from "./code-agent-benchmark.js";
import {
  buildFreeTierFailureAnalysis,
  type FreeTierFailureAnalysis,
} from "./free-tier-failure-analysis.js";
import type { ProviderHealthReport } from "./provider-health-probe.js";
import { redactProviderErrorText } from "../errors.js";

export const FREE_TIER_QUALITY_ENVELOPE_VERSION = 1;

type FreeTierShard = {
  index: number;
  count: number;
  caseIds: string[];
};

export type FreeTierReplayEntry = {
  caseId: string;
  provider: "openrouter" | null;
  model: string | null;
  providerAttempts: number;
  providerHealthReport?: ProviderHealthReport;
  observation: CodeAgentBenchmarkObservation;
};

export type FreeTierReplayCorpus = {
  kind: "free-tier-quality-replay-corpus";
  version: typeof FREE_TIER_QUALITY_ENVELOPE_VERSION;
  suiteVersion: typeof CODE_AGENT_BENCHMARK_VERSION;
  mode: "free-only";
  recordedAt: string;
  shardCount: number;
  runs: Array<{
    runId: string;
    shard: FreeTierShard;
    caseIds: string[];
  }>;
  entries: FreeTierReplayEntry[];
};

export type FreeTierQualityEnvelope = {
  kind: "free-tier-quality-envelope";
  version: typeof FREE_TIER_QUALITY_ENVELOPE_VERSION;
  suiteVersion: typeof CODE_AGENT_BENCHMARK_VERSION;
  mode: "free-only";
  generatedAt: string;
  corpus: {
    runCount: number;
    shardCount: number;
    totalCases: number;
    observedCases: number;
    complete: boolean;
    missingCaseIds: string[];
  };
  coverage: {
    qualityEligibleCases: number;
    providerUnavailableCases: number;
    observedCoverageRate: number;
    qualityCoverageRate: number;
    providerUnavailableRate: number;
  };
  qualityGradeCounts: Record<Exclude<CodeAgentBenchmarkGrade, "U">, number>;
  scorecard: ReturnType<typeof buildCodeAgentBenchmarkScorecard>;
  qualityEligible: boolean;
  qualityComparisonAllowed: boolean;
  rolloutAllowed: false;
  rolloutBlockers: string[];
  failureAnalysis: FreeTierFailureAnalysis[];
};

const RUN_KEYS = new Set([
  "kind",
  "version",
  "mode",
  "suiteVersion",
  "runId",
  "startedAt",
  "completedAt",
  "targetCaseCount",
  "providerOrder",
  "providerHealth",
  "observations",
  "shard",
  "scorecard",
  "campaignMode",
  "campaignStatus",
  "recoveryCaseIds",
  "recoveryOnly",
]);
const OBSERVATION_KEYS = new Set([
  "caseId",
  "grade",
  "correct",
  "completedFirstAttempt",
  "repairedWithinThreeAttempts",
  "usefulButIncomplete",
  "safelyBlocked",
  "falseSuccess",
  "scopeEscape",
  "conflict",
  "typecheckPassed",
  "testsPassed",
  "diagnosis",
  "filesRead",
  "toolCalls",
  "repairAttempts",
  "rejectedChanges",
  "latencyMs",
  "providerUnavailable",
  "oracleStatus",
  "oracleCode",
  "behavioralOracleStatus",
]);
const FORBIDDEN_KEYS = new Set([
  "rawresponse",
  "sourcecontent",
  "sourcetext",
  "tooltrace",
  "prompt",
  "completion",
  "messages",
  "diff",
  "patch",
]);
const GRADES = new Set<CodeAgentBenchmarkGrade>(["A", "B", "C", "D", "F", "U"]);
const MAX_INPUT_BYTES = 512_000;
const MAX_STRING_LENGTH = 512;
const FAILURE_CATEGORIES = new Set<ProviderHealthReport["failureCategory"]>([
  "authentication",
  "quota",
  "rate-limit",
  "catalog",
  "empty-response",
  "network",
  "server",
  "request",
  "capability",
  "unknown",
  null,
]);
const RECOVERY_ACTIONS = new Set<NonNullable<ProviderHealthReport["recoveryAction"]>>([
  "retry",
  "choose-alternative",
  "wait",
  "narrow-request",
  "stop-safely",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid free-tier replay corpus at ${path}: ${message}`);
}

function assertSafeShape(value: unknown, path = "$", depth = 0): void {
  if (depth > 8) fail(path, "nesting is too deep");
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) fail(path, "string is too long");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > CODE_AGENT_BENCHMARK_CASE_COUNT * 4) fail(path, "array is too large");
    value.forEach((entry, index) => assertSafeShape(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) fail(`${path}.${key}`, "raw payload field is not allowed");
    if (key.length > 80) fail(`${path}.${key}`, "key is too long");
    assertSafeShape(child, `${path}.${key}`, depth + 1);
  }
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "unknown field");
  }
}

function stringField(value: unknown, path: string, max = MAX_STRING_LENGTH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(path, "expected a bounded non-empty string");
  }
  return value;
}

function integerField(value: unknown, path: string, min = 0, max = 100_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `expected an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanField(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function nullableBooleanField(value: unknown, path: string): boolean | null {
  if (value !== null && typeof value !== "boolean") fail(path, "expected boolean or null");
  return value as boolean | null;
}

function boundedModel(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    fail(path, "expected a bounded model string or null");
  }
  return redactProviderErrorText(value).slice(0, 200);
}

function parseProviderHealthReport(value: unknown, path: string): ProviderHealthReport {
  if (!isRecord(value)) fail(path, "expected an object");
  assertOnlyKeys(value, new Set([
    "kind",
    "version",
    "provider",
    "model",
    "status",
    "evidenceStatus",
    "failureCategory",
    "recoveryAction",
    "attemptCount",
    "attemptedModels",
  ]), path);
  if (value.kind !== "provider-health-report") fail(`${path}.kind`, "unsupported provider health report");
  if (value.version !== 1) fail(`${path}.version`, "unsupported provider health report version");
  if (value.provider !== "openrouter") fail(`${path}.provider`, "unsupported provider");
  if (value.status !== "usable" && value.status !== "unavailable") {
    fail(`${path}.status`, "unknown provider health status");
  }
  if (value.evidenceStatus !== "complete" && value.evidenceStatus !== "incomplete") {
    fail(`${path}.evidenceStatus`, "unknown evidence status");
  }
  if (!FAILURE_CATEGORIES.has(value.failureCategory as ProviderHealthReport["failureCategory"])) {
    fail(`${path}.failureCategory`, "unknown failure category");
  }
  if (value.recoveryAction !== null && !RECOVERY_ACTIONS.has(value.recoveryAction as NonNullable<ProviderHealthReport["recoveryAction"]>)) {
    fail(`${path}.recoveryAction`, "unknown recovery action");
  }
  if (!Array.isArray(value.attemptedModels) || value.attemptedModels.length > 8) {
    fail(`${path}.attemptedModels`, "expected at most eight attempted models");
  }
  const attemptedModels = value.attemptedModels.map((model, index) => {
    const bounded = boundedModel(model, `${path}.attemptedModels[${index}]`);
    if (bounded === null) fail(`${path}.attemptedModels[${index}]`, "model cannot be null");
    return bounded;
  });
  return {
    kind: "provider-health-report",
    version: 1,
    provider: "openrouter",
    model: boundedModel(value.model, `${path}.model`),
    status: value.status,
    evidenceStatus: value.evidenceStatus,
    failureCategory: value.failureCategory as ProviderHealthReport["failureCategory"],
    recoveryAction: value.recoveryAction as ProviderHealthReport["recoveryAction"],
    attemptCount: integerField(value.attemptCount, `${path}.attemptCount`, 0, 100),
    attemptedModels,
  };
}

function parseShard(value: unknown, path: string): FreeTierShard {
  if (!isRecord(value)) fail(path, "expected an object");
  assertOnlyKeys(value, new Set(["index", "count", "caseIds"]), path);
  const index = integerField(value.index, `${path}.index`, 0, 100);
  const count = integerField(value.count, `${path}.count`, 1, 100);
  if (index >= count) fail(path, "index must be less than count");
  if (!Array.isArray(value.caseIds) || value.caseIds.length === 0) {
    fail(`${path}.caseIds`, "expected a non-empty array");
  }
  const caseIds = value.caseIds.map((caseId, index) =>
    stringField(caseId, `${path}.caseIds[${index}]`, 120),
  );
  if (new Set(caseIds).size !== caseIds.length) fail(`${path}.caseIds`, "duplicate case id");
  return { index, count, caseIds };
}

function parseObservation(value: unknown, path: string): CodeAgentBenchmarkObservation {
  if (!isRecord(value)) fail(path, "expected an object");
  assertOnlyKeys(value, OBSERVATION_KEYS, path);
  const grade = stringField(value.grade, `${path}.grade`, 1) as CodeAgentBenchmarkGrade;
  if (!GRADES.has(grade)) fail(`${path}.grade`, "unknown grade");
  const observation: CodeAgentBenchmarkObservation = {
    caseId: stringField(value.caseId, `${path}.caseId`, 120),
    grade,
    correct: booleanField(value.correct, `${path}.correct`),
    completedFirstAttempt: booleanField(value.completedFirstAttempt, `${path}.completedFirstAttempt`),
    repairedWithinThreeAttempts: booleanField(value.repairedWithinThreeAttempts, `${path}.repairedWithinThreeAttempts`),
    usefulButIncomplete: booleanField(value.usefulButIncomplete, `${path}.usefulButIncomplete`),
    safelyBlocked: booleanField(value.safelyBlocked, `${path}.safelyBlocked`),
    falseSuccess: booleanField(value.falseSuccess, `${path}.falseSuccess`),
    scopeEscape: booleanField(value.scopeEscape, `${path}.scopeEscape`),
    conflict: booleanField(value.conflict, `${path}.conflict`),
    typecheckPassed: nullableBooleanField(value.typecheckPassed, `${path}.typecheckPassed`),
    testsPassed: nullableBooleanField(value.testsPassed, `${path}.testsPassed`),
    ...(value.diagnosis === undefined
      ? {}
      : { diagnosis: stringField(value.diagnosis, `${path}.diagnosis`, 300) }),
    filesRead: integerField(value.filesRead, `${path}.filesRead`, 0, 10_000),
    toolCalls: integerField(value.toolCalls, `${path}.toolCalls`, 0, 10_000),
    repairAttempts: integerField(value.repairAttempts, `${path}.repairAttempts`, 0, 100),
    rejectedChanges: integerField(value.rejectedChanges, `${path}.rejectedChanges`, 0, 10_000),
    ...(value.latencyMs === undefined
      ? {}
      : { latencyMs: integerField(value.latencyMs, `${path}.latencyMs`, 0, 86_400_000) }),
    ...(value.providerUnavailable === undefined
      ? {}
      : { providerUnavailable: booleanField(value.providerUnavailable, `${path}.providerUnavailable`) }),
    ...(value.oracleStatus === undefined
      ? {}
      : value.oracleStatus === "passed" || value.oracleStatus === "failed"
        ? { oracleStatus: value.oracleStatus }
        : fail(`${path}.oracleStatus`, "unknown oracle status")),
    ...(value.oracleCode === undefined
      ? {}
      : { oracleCode: stringField(value.oracleCode, `${path}.oracleCode`, 160) }),
    ...(value.behavioralOracleStatus === undefined
      ? {}
      : value.behavioralOracleStatus === "passed" ||
          value.behavioralOracleStatus === "failed" ||
          value.behavioralOracleStatus === "not-available" ||
          value.behavioralOracleStatus === "not-run"
        ? { behavioralOracleStatus: value.behavioralOracleStatus }
        : fail(`${path}.behavioralOracleStatus`, "unknown behavioral oracle status")),
  };
  if (observation.providerUnavailable !== (grade === "U")) {
    fail(path, "providerUnavailable must agree with the U grade");
  }
  return observation;
}

function parseRun(value: unknown, path: string): {
  runId: string;
  shard: FreeTierShard;
  caseIds: string[];
  entries: FreeTierReplayEntry[];
} {
  if (!isRecord(value)) fail(path, "expected an object");
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_INPUT_BYTES) fail(path, "run is too large");
  assertSafeShape(value, path);
  assertOnlyKeys(value, RUN_KEYS, path);
  if (value.kind !== "code-agent-benchmark-airlock") fail(`${path}.kind`, "unsupported run kind");
  if (value.version !== 1) fail(`${path}.version`, "unsupported run version");
  if (value.mode !== "free-only") fail(`${path}.mode`, "only free-only runs are accepted");
  if (value.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION) {
    fail(`${path}.suiteVersion`, "suite version mismatch");
  }
  const runId = stringField(value.runId, `${path}.runId`, 160);
  const shard = parseShard(value.shard, `${path}.shard`);
  const targetCaseCount = integerField(value.targetCaseCount, `${path}.targetCaseCount`, 1, CODE_AGENT_BENCHMARK_CASE_COUNT);
  if (!Array.isArray(value.providerOrder) || value.providerOrder.some((provider) => provider !== "openrouter")) {
    fail(`${path}.providerOrder`, "free-tier corpus only accepts OpenRouter");
  }
  if (!Array.isArray(value.observations) || value.observations.length !== targetCaseCount) {
    fail(`${path}.observations`, "observation count must match targetCaseCount");
  }
  const healthReports = new Map<string, ProviderHealthReport>();
  if (value.providerHealth !== undefined) {
    if (!Array.isArray(value.providerHealth)) fail(`${path}.providerHealth`, "expected an array");
    value.providerHealth.forEach((health, index) => {
      if (!isRecord(health)) fail(`${path}.providerHealth[${index}]`, "expected an object");
      const report = health.report === undefined
        ? undefined
        : parseProviderHealthReport(health.report, `${path}.providerHealth[${index}].report`);
      if (report && healthReports.has(report.provider)) {
        fail(`${path}.providerHealth[${index}]`, "duplicate provider health report");
      }
      if (report) healthReports.set(report.provider, report);
    });
  }

  const entries = value.observations.map((raw, index) => {
    if (!isRecord(raw)) fail(`${path}.observations[${index}]`, "expected an object");
    assertOnlyKeys(raw, new Set(["caseId", "provider", "model", "providerAttempts", "providerHealthReport", "observation"]), `${path}.observations[${index}]`);
    const caseId = stringField(raw.caseId, `${path}.observations[${index}].caseId`, 120);
    const provider: "openrouter" | null =
      raw.provider === null
        ? null
        : raw.provider === "openrouter"
          ? "openrouter"
          : fail(`${path}.observations[${index}].provider`, "unsupported provider");
    const model = raw.model === null || typeof raw.model === "string"
      ? raw.model === null ? null : redactProviderErrorText(raw.model).slice(0, 200)
      : fail(`${path}.observations[${index}].model`, "expected string or null");
    if (model !== null && (!model.endsWith(":free") || model.length > 200)) {
      fail(`${path}.observations[${index}].model`, "model is not a bounded free-tier model");
    }
    const providerAttempts = integerField(raw.providerAttempts, `${path}.observations[${index}].providerAttempts`, 0, 100);
    const providerHealthReport = raw.providerHealthReport === undefined
      ? healthReports.get("openrouter")
      : parseProviderHealthReport(raw.providerHealthReport, `${path}.observations[${index}].providerHealthReport`);
    const observation = parseObservation(raw.observation, `${path}.observations[${index}].observation`);
    if (observation.caseId !== caseId) fail(`${path}.observations[${index}]`, "case id mismatch");
    if (observation.grade !== "U" && (provider !== "openrouter" || model === null)) {
      fail(`${path}.observations[${index}]`, "quality observation must identify a free OpenRouter model");
    }
    if (observation.grade === "U" && provider === null && model !== null) {
      fail(`${path}.observations[${index}]`, "provider-less U cannot carry a model");
    }
    return {
      caseId,
      provider,
      model,
      providerAttempts,
      ...(providerHealthReport ? { providerHealthReport } : {}),
      observation,
    };
  });

  const entryIds = entries.map((entry) => entry.caseId);
  if (new Set(entryIds).size !== entryIds.length) fail(`${path}.observations`, "duplicate case id");
  if (entryIds.length !== shard.caseIds.length || new Set(entryIds).size !== new Set(shard.caseIds).size ||
      entryIds.some((caseId) => !shard.caseIds.includes(caseId))) {
    fail(`${path}.shard.caseIds`, "shard case ids do not match observations");
  }
  return { runId, shard, caseIds: entryIds, entries };
}

export function buildFreeTierReplayCorpus(args: {
  runs: readonly unknown[];
  recordedAt?: string;
}): FreeTierReplayCorpus {
  if (args.runs.length === 0) throw new Error("Cannot build a free-tier replay corpus from zero runs.");
  const parsed = args.runs.map((run, index) => parseRun(run, `$[${index}]`));
  const runIds = new Set<string>();
  const caseIds = new Set<string>();
  const shardIndexes = new Set<number>();
  let shardCount: number | undefined;
  const entries: FreeTierReplayEntry[] = [];

  for (const run of parsed) {
    if (runIds.has(run.runId)) throw new Error(`Duplicate free-tier replay run: ${run.runId}`);
    runIds.add(run.runId);
    if (shardCount === undefined) shardCount = run.shard.count;
    if (run.shard.count !== shardCount) throw new Error("Free-tier replay shards use different shard counts.");
    if (shardIndexes.has(run.shard.index)) throw new Error(`Duplicate free-tier shard index: ${run.shard.index}`);
    shardIndexes.add(run.shard.index);
    for (const entry of run.entries) {
      if (caseIds.has(entry.caseId)) throw new Error(`Duplicate free-tier replay case: ${entry.caseId}`);
      caseIds.add(entry.caseId);
      entries.push(entry);
    }
  }

  const knownIds = new Set(getCodeAgentBenchmarkCases().map((testCase) => testCase.id));
  for (const caseId of caseIds) {
    if (!knownIds.has(caseId)) throw new Error(`Unknown free-tier replay case: ${caseId}`);
  }
  return {
    kind: "free-tier-quality-replay-corpus",
    version: FREE_TIER_QUALITY_ENVELOPE_VERSION,
    suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
    mode: "free-only",
    recordedAt: args.recordedAt ?? new Date().toISOString(),
    shardCount: shardCount!,
    runs: parsed.map(({ runId, shard, caseIds: ids }) => ({ runId, shard, caseIds: ids })),
    entries,
  };
}

export function buildFreeTierQualityEnvelope(args: {
  corpus: FreeTierReplayCorpus;
  generatedAt?: string;
}): FreeTierQualityEnvelope {
  if (args.corpus.kind !== "free-tier-quality-replay-corpus" ||
      args.corpus.version !== FREE_TIER_QUALITY_ENVELOPE_VERSION ||
      args.corpus.mode !== "free-only" ||
      args.corpus.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION) {
    throw new Error("Unsupported free-tier replay corpus.");
  }
  const cases = getCodeAgentBenchmarkCases();
  const observedIds = new Set(args.corpus.entries.map((entry) => entry.caseId));
  const missingCaseIds = cases.map((testCase) => testCase.id).filter((id) => !observedIds.has(id));
  const scorecard = buildCodeAgentBenchmarkScorecard({
    results: args.corpus.entries.map((entry) => entry.observation),
    cases,
    generatedAt: args.generatedAt ?? args.corpus.recordedAt,
  });
  const providerUnavailableCases = args.corpus.entries.filter((entry) => entry.observation.grade === "U").length;
  const qualityEligibleCases = args.corpus.entries.length - providerUnavailableCases;
  const totalCases = cases.length;
  const observedCases = args.corpus.entries.length;
  const qualityGradeCounts: Record<Exclude<CodeAgentBenchmarkGrade, "U">, number> = {
    A: scorecard.metrics.gradeCounts.A,
    B: scorecard.metrics.gradeCounts.B,
    C: scorecard.metrics.gradeCounts.C,
    D: scorecard.metrics.gradeCounts.D,
    F: scorecard.metrics.gradeCounts.F,
  };
  const rolloutBlockers = [
    ...scorecard.rolloutBlockers,
    ...(missingCaseIds.length > 0 ? ["free-tier replay corpus is incomplete"] : []),
  ];
  const complete = observedCases === totalCases;
  return {
    kind: "free-tier-quality-envelope",
    version: FREE_TIER_QUALITY_ENVELOPE_VERSION,
    suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
    mode: "free-only",
    generatedAt: args.generatedAt ?? args.corpus.recordedAt,
    corpus: {
      runCount: args.corpus.runs.length,
      shardCount: args.corpus.shardCount,
      totalCases,
      observedCases,
      complete,
      missingCaseIds,
    },
    coverage: {
      qualityEligibleCases,
      providerUnavailableCases,
      observedCoverageRate: totalCases === 0 ? 0 : observedCases / totalCases,
      qualityCoverageRate: totalCases === 0 ? 0 : qualityEligibleCases / totalCases,
      providerUnavailableRate: totalCases === 0 ? 0 : providerUnavailableCases / totalCases,
    },
    qualityGradeCounts,
    scorecard,
    qualityEligible: qualityEligibleCases > 0,
    qualityComparisonAllowed: complete && providerUnavailableCases === 0,
    rolloutAllowed: false,
    rolloutBlockers: [...new Set(rolloutBlockers)],
    failureAnalysis: buildFreeTierFailureAnalysis(scorecard.cases),
  };
}

export function buildFreeTierQualityEnvelopeFromRuns(args: {
  runs: readonly unknown[];
  generatedAt?: string;
}): { corpus: FreeTierReplayCorpus; envelope: FreeTierQualityEnvelope } {
  const corpus = buildFreeTierReplayCorpus({ runs: args.runs, recordedAt: args.generatedAt });
  return {
    corpus,
    envelope: buildFreeTierQualityEnvelope({ corpus, generatedAt: args.generatedAt }),
  };
}