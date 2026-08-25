import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  applyCodeAgentBenchmarkBaselineGate,
  buildCodeAgentBenchmarkScorecard,
  CODE_AGENT_BENCHMARK_VERSION,
  codeAgentBenchmarkScorecardToMarkdown,
  getCodeAgentBenchmarkCases,
  getTargetedCodeAgentBenchmarkCases,
  getCodeAgentBenchmarkTargetProfileCases,
  getDynamicModelIds,
  refreshDynamicCatalog,
  selectFreeOnlyBenchmarkModels,
  benchmarkShardLabel,
  parseBenchmarkShardConfig,
  selectBenchmarkShard,
  FREE_MODELS,
  type BenchmarkAirlockObservation,
  type BenchmarkAirlockRun,
  type CodeAgentBenchmarkBaseline,
  type CodeAgentBenchmarkCase,
  type CodeAgentBenchmarkObservation,
  type ProviderHealthProbeResult,
  type ProviderId,
  type BenchmarkCampaignMode,
  type CodeAgentBenchmarkTargetProfile,
  buildBenchmarkParityReport,
  benchmarkParityReportToMarkdown,
} from "@workspace/ai-orchestrator";
import {
  defaultApiBenchmarkAllowedPaths,
  defaultApiBenchmarkHistory,
  defaultApiBenchmarkPrompt,
  defaultApiBenchmarkTargetPaths,
  runApiCodeAgentBenchmarkAirlock,
  type ApiCodeAgentBenchmarkProvider,
} from "./ai-code-agent-benchmark.js";

const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};
const COPY_OMIT = new Set([".git", "node_modules", "attached_assets", ".cache", ".agents", ".local", "docs", "coverage", "dist"]);
const sourceRoot = path.resolve(process.env.BENCHMARK_SOURCE_ROOT ?? path.resolve(process.cwd(), "../.."));
const allCases = getCodeAgentBenchmarkCases();
const benchmarkTargetPaths = [
  ...new Set(allCases.flatMap((testCase) => defaultApiBenchmarkTargetPaths(testCase))),
];
const freeOnly = process.env.BENCHMARK_FREE_ONLY === "true";
const liveCampaign = process.env.BENCHMARK_LIVE_CAMPAIGN === "1";
const campaignModeSelection = process.env.BENCHMARK_MODE?.trim() || "live";
if (campaignModeSelection !== "live") {
  throw new Error("BENCHMARK_MODE must be live; deterministic release checks do not run this provider campaign.");
}
if (!liveCampaign) {
  throw new Error(
    "Live benchmark campaigns are measurement-only; set BENCHMARK_LIVE_CAMPAIGN=1 explicitly.",
  );
}
if (!process.env.BENCHMARK_OUTPUT_DIR?.trim()) {
  throw new Error(
    "Live benchmark campaigns require BENCHMARK_OUTPUT_DIR so release artifacts cannot be overwritten.",
  );
}
const campaignTimeoutMs = Number.parseInt(
  process.env.BENCHMARK_CAMPAIGN_TIMEOUT_MS ?? "900000",
  10,
);
if (!Number.isInteger(campaignTimeoutMs) || campaignTimeoutMs < 1) {
  throw new Error("BENCHMARK_CAMPAIGN_TIMEOUT_MS must be a positive integer.");
}
const campaignMode = (process.env.BENCHMARK_CAMPAIGN_MODE?.trim() || "clean-witness") as BenchmarkCampaignMode;
if (campaignMode !== "coverage" && campaignMode !== "clean-witness") {
  throw new Error("BENCHMARK_CAMPAIGN_MODE must be coverage or clean-witness.");
}
const batchSizeRaw = process.env.BENCHMARK_BATCH_SIZE?.trim();
const batchSize = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : undefined;
if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
  throw new Error("BENCHMARK_BATCH_SIZE must be a positive integer.");
}
const recoveryOnly = process.env.BENCHMARK_RECOVERY_ONLY === "true";
const targeted = process.env.BENCHMARK_TARGETED === "true";
const targetProfileRaw = process.env.BENCHMARK_TARGET_PROFILE?.trim();
const targetProfiles = new Set<CodeAgentBenchmarkTargetProfile>([
  "repair-loop",
  "scope-enforcement",
  "provider-fallback",
  "forensic-routing",
]);
if (targetProfileRaw && !targetProfiles.has(targetProfileRaw as CodeAgentBenchmarkTargetProfile)) {
  throw new Error(
    `Unknown BENCHMARK_TARGET_PROFILE: ${targetProfileRaw}. Expected ${[...targetProfiles].join(", ")}.`,
  );
}
const targetProfile = targetProfileRaw as CodeAgentBenchmarkTargetProfile | undefined;
const requestedCaseIds = (process.env.BENCHMARK_CASE_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const shard = parseBenchmarkShardConfig(
  process.env.BENCHMARK_SHARD_INDEX,
  process.env.BENCHMARK_SHARD_COUNT,
);
const shardLabel = shard ? benchmarkShardLabel(shard) : undefined;
const configuredOutputDir = process.env.BENCHMARK_OUTPUT_DIR?.trim();
const outputDir = path.resolve(
  configuredOutputDir
    ? shard
      ? path.join(configuredOutputDir, shardLabel!)
      : configuredOutputDir
    : path.join(
        sourceRoot,
        "lib/ai-orchestrator/benchmark-results",
        shardLabel ?? "",
      ),
);
if (campaignModeSelection === "live") {
  const relativeOutput = path.relative(sourceRoot, outputDir);
  if (relativeOutput === "" || (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))) {
    throw new Error(
      "Live benchmark output must be outside the source workspace; use a disposable campaign directory such as /tmp/engineeringos-live-campaign.",
    );
  }
}
const runId = process.env.BENCHMARK_RUN_ID?.trim() ||
  `airlock-${shardLabel ? `${shardLabel}-` : ""}${Date.now()}`;
const generatedAt = new Date().toISOString();

async function resetCaseTargets(_testCase: CodeAgentBenchmarkCase, rootPath: string): Promise<void> {
  await Promise.all(benchmarkTargetPaths.map(async (relativePath) => {
    const sourcePath = path.resolve(sourceRoot, relativePath);
    const isolatedPath = path.resolve(rootPath, relativePath);
    try {
      await fs.mkdir(path.dirname(isolatedPath), { recursive: true });
      await fs.copyFile(sourcePath, isolatedPath);
    } catch {
      await fs.rm(isolatedPath, { force: true });
    }
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function createIsolatedBenchmarkRoot(): Promise<{ rootPath: string; cleanup: () => Promise<void> }> {
  const resolvedSource = await fs.realpath(sourceRoot);
  await fs.access(path.join(resolvedSource, "package.json"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-code-agent-airlock-"));
  try {
    await fs.cp(resolvedSource, rootPath, {
      recursive: true,
      dereference: false,
      filter: (source) => !COPY_OMIT.has(path.relative(resolvedSource, source).split(path.sep)[0]!),
    });
    await fs.symlink(path.join(resolvedSource, "node_modules"), path.join(rootPath, "node_modules"), "dir");
    return { rootPath, cleanup: () => fs.rm(rootPath, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(rootPath, { recursive: true, force: true });
    throw error;
  }
}

function requestedCases(): typeof allCases {
  const unknown = requestedCaseIds.filter((id) => !allCases.some((testCase) => testCase.id === id));
  if (unknown.length > 0) throw new Error(`Unknown benchmark case ids: ${unknown.join(", ")}`);
  if ((requestedCaseIds.length > 0 || targeted || targetProfile) && !process.env.BENCHMARK_OUTPUT_DIR) {
    throw new Error("Partial or targeted Airlock runs require BENCHMARK_OUTPUT_DIR.");
  }
  if (requestedCaseIds.length > 0 && (targeted || targetProfile)) {
    throw new Error("Use BENCHMARK_CASE_IDS, BENCHMARK_TARGETED, or BENCHMARK_TARGET_PROFILE, not more than one.");
  }
  if (targeted && targetProfile) {
    throw new Error("Use BENCHMARK_TARGETED or BENCHMARK_TARGET_PROFILE, not both.");
  }
  if ((requestedCaseIds.length > 0 || targeted || targetProfile) && shard) {
    throw new Error("Use BENCHMARK_CASE_IDS or benchmark sharding, not both.");
  }
  const selected = targetProfile
    ? getCodeAgentBenchmarkTargetProfileCases(targetProfile)
    : targeted
      ? getTargetedCodeAgentBenchmarkCases()
    : requestedCaseIds.length > 0
      ? allCases.filter((testCase) => requestedCaseIds.includes(testCase.id))
      : allCases;
  return shard ? selectBenchmarkShard(selected, shard) : selected;
}

function boundedObservation(value: unknown, knownIds: Set<string>): BenchmarkAirlockObservation | undefined {
  if (!isRecord(value) || typeof value.caseId !== "string" || !knownIds.has(value.caseId)) return undefined;
  const raw = value.observation;
  if (!isRecord(raw) || raw.caseId !== value.caseId || !["A", "B", "C", "D", "F", "U"].includes(String(raw.grade))) return undefined;
  const booleans = ["correct", "completedFirstAttempt", "repairedWithinThreeAttempts", "usefulButIncomplete", "safelyBlocked", "falseSuccess", "scopeEscape", "conflict"] as const;
  const numbers = ["filesRead", "toolCalls", "repairAttempts", "rejectedChanges"] as const;
  if (!booleans.every((key) => typeof raw[key] === "boolean") || !numbers.every((key) => typeof raw[key] === "number")) return undefined;
  return {
    caseId: value.caseId,
    provider: typeof value.provider === "string" ? value.provider as ProviderId : null,
    model: typeof value.model === "string" ? value.model : null,
    providerAttempts: typeof value.providerAttempts === "number" ? value.providerAttempts : 0,
    observation: {
      caseId: value.caseId,
      ...(typeof raw.candidateHash === "string" ? { candidateHash: raw.candidateHash.slice(0, 200) } : {}),
      grade: raw.grade as CodeAgentBenchmarkObservation["grade"],
      correct: raw.correct as boolean,
      completedFirstAttempt: raw.completedFirstAttempt as boolean,
      repairedWithinThreeAttempts: raw.repairedWithinThreeAttempts as boolean,
      usefulButIncomplete: raw.usefulButIncomplete as boolean,
      safelyBlocked: raw.safelyBlocked as boolean,
      falseSuccess: raw.falseSuccess as boolean,
      scopeEscape: raw.scopeEscape as boolean,
      conflict: raw.conflict as boolean,
      typecheckPassed: typeof raw.typecheckPassed === "boolean" ? raw.typecheckPassed : null,
      testsPassed: typeof raw.testsPassed === "boolean" ? raw.testsPassed : null,
      ...(typeof raw.diagnosis === "string" ? { diagnosis: raw.diagnosis.slice(0, 300) } : {}),
      filesRead: raw.filesRead as number,
      toolCalls: raw.toolCalls as number,
      repairAttempts: raw.repairAttempts as number,
      rejectedChanges: raw.rejectedChanges as number,
      ...(typeof raw.latencyMs === "number" ? { latencyMs: raw.latencyMs } : {}),
      ...(typeof raw.providerUnavailable === "boolean" ? { providerUnavailable: raw.providerUnavailable } : {}),
      ...(raw.oracleStatus === "passed" || raw.oracleStatus === "failed" ? { oracleStatus: raw.oracleStatus } : {}),
      ...(typeof raw.oracleCode === "string" ? { oracleCode: raw.oracleCode } : {}),
      ...(raw.behavioralOracleStatus === "passed" ||
      raw.behavioralOracleStatus === "failed" ||
      raw.behavioralOracleStatus === "not-available" ||
      raw.behavioralOracleStatus === "not-run"
        ? { behavioralOracleStatus: raw.behavioralOracleStatus }
        : {}),
    },
  };
}

async function readProgress(cases: typeof allCases): Promise<BenchmarkAirlockObservation[]> {
  if (process.env.BENCHMARK_RESET) return [];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(outputDir, "code-agent-benchmark-airlock.progress.json"), "utf8")) as unknown;
    if (!isRecord(raw) || raw.kind !== "code-agent-benchmark-airlock-progress" || !Array.isArray(raw.observations)) return [];
    const knownIds = new Set(cases.map((testCase) => testCase.id));
    const seen = new Set<string>();
    return raw.observations
      .map((entry) => boundedObservation(entry, knownIds))
      .filter((entry): entry is BenchmarkAirlockObservation => !!entry && !seen.has(entry.caseId) && (seen.add(entry.caseId), true));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown progress-ledger error";
    console.warn(JSON.stringify({
      scope: "benchmark-campaign",
      code: "PROGRESS_LEDGER_READ_FAILED",
      outputDir,
      detail: detail.slice(0, 240),
    }));
    return [];
  }
}

function parseBaseline(raw: string): CodeAgentBenchmarkBaseline | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.kind !== "code-agent-benchmark-baseline" ||
      value.version !== 1 ||
      value.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION ||
      typeof value.baselineId !== "string" ||
      value.baselineId.length === 0 ||
      typeof value.generatedAt !== "string" ||
      value.rolloutAllowed !== true ||
      !isRecord(value.metrics)
    ) return undefined;
    const metrics = value.metrics;
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
      typeof metrics.complete !== "boolean" ||
      !numericFields.every((field) => typeof metrics[field] === "number") ||
      !["typecheckSuccessRate", "testSuccessRate", "averageLatencyMs"].every(
        (field) => metrics[field] === null || typeof metrics[field] === "number",
      ) ||
      !isRecord(metrics.gradeCounts)
    ) return undefined;
    return value as unknown as CodeAgentBenchmarkBaseline;
  } catch {
    return undefined;
  }
}

const cases = requestedCases();
const initialResults = await readProgress(cases);
console.log(JSON.stringify({
  scope: "benchmark-campaign",
  code: "PROGRESS_LEDGER_LOADED",
  outputDir,
  requestedCaseCount: cases.length,
  persistedObservationCount: initialResults.length,
  persistedRecoveryCount: initialResults.filter((entry) =>
    entry.observation.providerUnavailable === true ||
    entry.observation.grade === "U" ||
    entry.observation.grade === "F",
  ).length,
}));
const recoveryCaseIds = new Set(
  initialResults
    .filter((entry) =>
      entry.observation.providerUnavailable === true ||
      entry.observation.grade === "U" ||
      entry.observation.grade === "F",
    )
    .map((entry) => entry.caseId),
);
const qualityObservedCaseIds = new Set(
  initialResults
    .filter((entry) => !recoveryCaseIds.has(entry.caseId))
    .map((entry) => entry.caseId),
);
const pendingCases = cases.filter((testCase) => !qualityObservedCaseIds.has(testCase.id));
const executionCases = recoveryOnly
  ? cases.filter((testCase) => recoveryCaseIds.has(testCase.id))
  : batchSize
    ? pendingCases.slice(0, batchSize)
    : cases;
if (recoveryOnly && executionCases.length === 0) {
  throw new Error("BENCHMARK_RECOVERY_ONLY requires persisted U/F observations in the progress ledger.");
}
const configuredProviders = (process.env.BENCHMARK_PROVIDERS ?? (freeOnly ? "openrouter" : "openrouter,gemini,deepseek,groq"))
  .split(",")
  .map((provider) => provider.trim())
  .filter(Boolean) as ProviderId[];
const invalidProviders = configuredProviders.filter((provider) => !(provider in PROVIDER_KEY_ENV));
if (invalidProviders.length > 0) throw new Error(`Unsupported Airlock providers: ${invalidProviders.join(", ")}`);
if (freeOnly && configuredProviders.some((provider) => provider !== "openrouter")) {
  throw new Error("BENCHMARK_FREE_ONLY requires BENCHMARK_PROVIDERS=openrouter.");
}

let liveFreeModelIds: ReadonlySet<string> | undefined;
if (freeOnly) {
  await refreshDynamicCatalog(process.env.OPENROUTER_API_KEY);
  liveFreeModelIds = getDynamicModelIds() ?? undefined;
  if (!liveFreeModelIds) {
    throw new Error("BENCHMARK_FREE_ONLY requires a live OpenRouter free-model catalog.");
  }
}

const providers: ApiCodeAgentBenchmarkProvider[] = configuredProviders.flatMap((provider) => {
  const providerKey = provider.toUpperCase();
  const configuredModels = (process.env[`BENCHMARK_MODELS_${providerKey}`] ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const singleModel = process.env[`BENCHMARK_MODEL_${providerKey}`]?.trim();
  const models = configuredModels.length > 0 ? configuredModels : [singleModel];
  if (freeOnly && provider === "openrouter") {
    const selection = selectFreeOnlyBenchmarkModels({
      liveModelIds: liveFreeModelIds!,
      requestedModels: configuredModels.length > 0 ? configuredModels : singleModel ? [singleModel] : undefined,
      maxModels: Number.parseInt(process.env.BENCHMARK_FREE_MODEL_LIMIT ?? "4", 10),
      catalog: FREE_MODELS,
      requiredCapability: "tool_calling",
    });
    if (selection.rejectedModels.length > 0) {
      throw new Error(`BENCHMARK_FREE_ONLY rejected non-free or unavailable models: ${selection.rejectedModels.join(", ")}`);
    }
    if (selection.models.length === 0) {
      throw new Error("BENCHMARK_FREE_ONLY found no live free tool-calling models.");
    }
    return selection.models.map((model) => ({
      provider,
      apiKey: process.env[PROVIDER_KEY_ENV[provider]] ?? "",
      model,
    }));
  }
  return models.map((model) => ({
    provider,
    apiKey: process.env[PROVIDER_KEY_ENV[provider]] ?? "",
    model,
  }));
});

await fs.mkdir(outputDir, { recursive: true });
if (shard) {
  await writeJsonAtomically(path.join(outputDir, "code-agent-benchmark-airlock.shard.json"), {
    kind: "code-agent-benchmark-airlock-shard",
    version: 1,
    shard,
    caseIds: cases.map((testCase) => testCase.id),
    freeOnly,
  });
}
const isolated = await createIsolatedBenchmarkRoot();
const campaignController = new AbortController();
const campaignTimer = setTimeout(() => campaignController.abort(), campaignTimeoutMs);
let providerHealth: readonly ProviderHealthProbeResult[] = [];
let latestObservations = initialResults;
function mergeObservations(
  current: readonly BenchmarkAirlockObservation[],
  next: readonly BenchmarkAirlockObservation[],
): BenchmarkAirlockObservation[] {
  const byCase = new Map(current.map((entry) => [entry.caseId, entry]));
  for (const entry of next) byCase.set(entry.caseId, entry);
  return [...byCase.values()];
}
try {
  const run = await runApiCodeAgentBenchmarkAirlock({
    rootPath: isolated.rootPath,
    projectContext: {
      project: "EngineeringOS isolated Code Agent benchmark workspace",
      recentTasks: "No benchmark task history is injected.",
      latestMetrics: "No benchmark metrics are injected.",
      graphSummary: "Use bounded source reads and approved paths.",
      recentEvents: "No benchmark events are injected.",
      workflows: "Validation is server-owned and runs in a temporary overlay.",
      metricsVerified: false,
    },
    mode: freeOnly ? "free-only" : "live",
    campaignMode,
    recoveryOnly,
    diagnosticOnly: Boolean(targetProfile || targeted || requestedCaseIds.length > 0 || shard),
    targeted: Boolean(targetProfile || targeted || requestedCaseIds.length > 0),
    targetProfile,
    shard,
    providers,
    cases: executionCases,
    initialResults,
    runId,
    generatedAt,
    targetPathsForCase: defaultApiBenchmarkTargetPaths,
    allowedPathsForCase: defaultApiBenchmarkAllowedPaths,
    promptForCase: defaultApiBenchmarkPrompt,
    historyForCase: defaultApiBenchmarkHistory,
    caseTimeoutMs: Number.parseInt(process.env.BENCHMARK_CASE_TIMEOUT_MS ?? "90000", 10),
    candidateHash: process.env.BENCHMARK_CANDIDATE_HASH?.trim() || undefined,
    signal: campaignController.signal,
    onProviderHealth: async (health) => {
      providerHealth = health;
    },
    beforeCase: resetCaseTargets,
    onObservation: async (_observation, observations) => {
      latestObservations = mergeObservations(latestObservations, observations);
      await writeJsonAtomically(path.join(outputDir, "code-agent-benchmark-airlock.progress.json"), {
        kind: "code-agent-benchmark-airlock-progress",
        version: 2,
        suiteVersion: CODE_AGENT_BENCHMARK_VERSION,
        runId,
        providerHealth,
        campaignMode,
        recoveryOnly,
        diagnosticOnly: Boolean(targetProfile || targeted || requestedCaseIds.length > 0 || shard),
        targeted: Boolean(targetProfile || targeted || requestedCaseIds.length > 0),
        targetProfile,
        observations: latestObservations,
      });
    },
  });
  const baselinePath = path.resolve(process.env.BENCHMARK_BASELINE_PATH ?? path.join(sourceRoot, "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json"));
  let baseline: CodeAgentBenchmarkBaseline | undefined;
  try {
    baseline = parseBaseline(await fs.readFile(baselinePath, "utf8"));
  } catch {
    baseline = undefined;
  }
  const mergedObservations = batchSize
    ? mergeObservations(initialResults, run.observations)
    : run.observations;
  const batchComplete = batchSize !== undefined &&
    mergedObservations.length === cases.length &&
    mergedObservations.every((entry) => !["F", "U"].includes(entry.observation.grade) && entry.observation.providerUnavailable !== true);
  const scorecardInput = batchComplete
    ? buildCodeAgentBenchmarkScorecard({
      results: mergedObservations.map((entry) => entry.observation),
      cases,
      generatedAt,
    })
    : run.scorecard;
  const scorecard = applyCodeAgentBenchmarkBaselineGate({ scorecard: scorecardInput, baseline });
  const outputShard = run.shard ?? ((targeted || targetProfile || requestedCaseIds.length > 0)
    ? { index: 0, count: 1, caseIds: cases.map((testCase) => testCase.id) }
    : undefined);
  const finalRun: BenchmarkAirlockRun = {
    ...run,
    ...(batchComplete
      ? {
        campaignStatus: "clean-witness" as const,
        recoveryCaseIds: [],
        partial: false,
        targetCaseCount: cases.length,
        observations: mergedObservations,
      }
      : {}),
    scorecard,
    shard: outputShard,
  };
  const acceptance = finalRun.autonomousDeliveryAcceptance;
  const parityReport = buildBenchmarkParityReport({
    mode: finalRun.campaignMode,
    cases,
    scorecard: finalRun.scorecard,
    observations: finalRun.observations,
  });
  finalRun.parityReport = parityReport;
  if (
    finalRun.campaignStatus === "clean-witness" &&
    !finalRun.recoveryOnly &&
    (batchSize === undefined || batchComplete)
  ) {
    await fs.rm(path.join(outputDir, "code-agent-benchmark-airlock.progress.json"), { force: true });
  }
  await writeJsonAtomically(path.join(outputDir, "code-agent-benchmark-airlock.run.json"), finalRun);
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-airlock.run.md"),
    `${codeAgentBenchmarkScorecardToMarkdown(scorecard)}
## Autonomous delivery acceptance

This bounded, redacted summary measures verified delivery separately from the
quality scorecard. Deterministic release checks do not depend on it.

- Completion rate: ${acceptance?.metrics.completionRate ?? 0}
- Safely blocked rate: ${acceptance?.metrics.safeBlockRate ?? 0}
- Failure rate: ${acceptance?.metrics.failureRate ?? 0}
- Uncertainty rate: ${acceptance?.metrics.uncertaintyRate ?? 0}
- Recovery rate: ${acceptance?.metrics.recoveryRate ?? 0}
- Scope escape rate: ${acceptance?.metrics.scopeEscapeRate ?? 0}
- Repeated side-effect rate: ${acceptance?.metrics.repeatedSideEffectRate ?? 0}
- Verified completions: ${acceptance?.metrics.verifiedCompletionCount ?? 0}/${acceptance?.operationCount ?? 0}

### Operations

${(acceptance?.operations ?? []).map((operation) =>
  `- ${operation.operationId} (${operation.caseId}): ${operation.outcome}; verified=${operation.verifiedCompletion}; recovered=${operation.recovered}; scopeViolation=${operation.scopeViolation}; repeatedSideEffect=${operation.repeatedSideEffect}`,
).join("\n") || "- None"}

${benchmarkParityReportToMarkdown(parityReport)}
`,
    "utf8",
  );
  await writeJsonAtomically(path.join(outputDir, "code-agent-benchmark-parity-report.json"), parityReport);
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-parity-report.md"),
    benchmarkParityReportToMarkdown(parityReport),
    "utf8",
  );
  console.log(JSON.stringify({
    runId,
    mode: finalRun.mode,
    campaignMode: finalRun.campaignMode,
    campaignStatus: finalRun.campaignStatus,
    recoveryCaseIds: finalRun.recoveryCaseIds,
    shard: finalRun.shard,
    providers: finalRun.providerOrder,
    providerHealth: finalRun.providerHealth.map((entry) => ({ provider: entry.provider, status: entry.status, model: entry.model, failureCode: entry.failureCode })),
    observedCases: scorecard.metrics.observedCases,
    totalCases: scorecard.metrics.totalCases,
    gradeCounts: scorecard.metrics.gradeCounts,
    rolloutAllowed: scorecard.rolloutAllowed,
    rolloutBlockers: scorecard.rolloutBlockers,
    outputDir,
  }, null, 2));
} finally {
  clearTimeout(campaignTimer);
  await isolated.cleanup();
}