import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  buildCodeAgentBenchmarkReplayRecord,
  buildCodeAgentBenchmarkScorecard,
  applyCodeAgentBenchmarkBaselineGate,
  CODE_AGENT_BENCHMARK_VERSION,
  codeAgentBenchmarkScorecardToMarkdown,
  getCodeAgentBenchmarkCases,
  runCodeAgentBenchmarkReplay,
  type CodeAgentBenchmarkBaseline,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkReplayEntry,
  type CodeAgentBenchmarkReplayRecord,
  type CodeAgentExecutionTelemetry,
  type ProjectContext,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import {
  defaultApiBenchmarkAllowedPaths,
  defaultApiBenchmarkHistory,
  defaultApiBenchmarkPrompt,
  defaultApiBenchmarkTargetPaths,
  runApiCodeAgentBenchmark,
} from "./ai-code-agent-benchmark.js";

const COPY_OMIT = new Set([
  ".git",
  "node_modules",
  "attached_assets",
  ".cache",
  ".agents",
  ".local",
  "docs",
  "coverage",
  "dist",
]);

const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const BENCHMARK_CONTEXT: ProjectContext = {
  project: "EngineeringOS isolated Code Agent benchmark workspace",
  recentTasks: "No benchmark task history is injected.",
  latestMetrics: "No benchmark metrics are injected.",
  graphSummary: "Use the bounded source reads and approved paths for this case.",
  recentEvents: "No benchmark events are injected.",
  workflows: "Validation is server-owned and runs in a temporary overlay.",
  metricsVerified: false,
};

async function createIsolatedBenchmarkRoot(sourceRoot: string): Promise<{
  rootPath: string;
  cleanup: () => Promise<void>;
}> {
  const resolvedSource = await fs.realpath(sourceRoot);
  await fs.access(path.join(resolvedSource, "package.json"));
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "engineeringos-code-agent-"));

  try {
    await fs.cp(resolvedSource, rootPath, {
      recursive: true,
      dereference: false,
      filter: (source) => {
        const relative = path.relative(resolvedSource, source);
        const firstSegment = relative.split(path.sep)[0];
        return !COPY_OMIT.has(firstSegment);
      },
    });
    await fs.symlink(path.join(resolvedSource, "node_modules"), path.join(rootPath, "node_modules"), "dir");
    return {
      rootPath,
      cleanup: async () => fs.rm(rootPath, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(rootPath, { recursive: true, force: true });
    throw error;
  }
}

type BenchmarkProgressFile = {
  kind: "code-agent-benchmark-progress";
  suiteVersion: string;
  provider: ProviderId;
  model: string | null;
  generatedAt: string;
  cases: CodeAgentBenchmarkObservation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProgressObservation(value: unknown): value is CodeAgentBenchmarkObservation {
  if (!isRecord(value)) return false;
  return (
    typeof value.caseId === "string" &&
    ["A", "B", "C", "D", "F", "U"].includes(String(value.grade)) &&
    typeof value.correct === "boolean" &&
    (typeof value.providerUnavailable === "boolean" || value.providerUnavailable === undefined)
  );
}

function isReplayEntry(value: unknown): value is CodeAgentBenchmarkReplayEntry {
  return isRecord(value) &&
    typeof value.caseId === "string" &&
    isRecord(value.telemetry);
}

function parseReplayFile(raw: string): CodeAgentBenchmarkReplayRecord | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.kind !== "code-agent-benchmark-replay" ||
      value.version !== 1 ||
       value.suiteVersion !== CODE_AGENT_BENCHMARK_VERSION ||
      typeof value.recordedAt !== "string" ||
      !Array.isArray(value.cases) ||
      !value.cases.every(isReplayEntry)
    ) return undefined;
    return buildCodeAgentBenchmarkReplayRecord({
      entries: value.cases,
      recordedAt: value.recordedAt,
    });
  } catch {
    return undefined;
  }
}

function parseProgressFile(
  raw: string,
  provider: ProviderId,
  model: string | undefined,
): BenchmarkProgressFile | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.kind !== "code-agent-benchmark-progress" ||
      typeof value.suiteVersion !== "string" ||
      value.provider !== provider ||
      (value.model !== null && typeof value.model !== "string") ||
      typeof value.generatedAt !== "string" ||
      !Array.isArray(value.cases)
    ) return undefined;
    if ((value.model ?? null) !== (model ?? null)) return undefined;

    const cases = value.cases.filter(isProgressObservation);
    const seen = new Set<string>();
    if (cases.some((result) => seen.has(result.caseId) || (seen.add(result.caseId), false))) {
      return undefined;
    }
    return {
      kind: "code-agent-benchmark-progress",
      suiteVersion: value.suiteVersion,
      provider,
      model: value.model as string | null,
      generatedAt: value.generatedAt,
      cases,
    };
  } catch {
    return undefined;
  }
}

function isBenchmarkMetrics(value: unknown): value is CodeAgentBenchmarkBaseline["metrics"] {
  if (!isRecord(value)) return false;
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
  return (
    typeof value.complete === "boolean" &&
    numericFields.every((field) => typeof value[field] === "number") &&
    (value.typecheckSuccessRate === null || typeof value.typecheckSuccessRate === "number") &&
    (value.testSuccessRate === null || typeof value.testSuccessRate === "number") &&
    (value.averageLatencyMs === null || typeof value.averageLatencyMs === "number") &&
    isRecord(value.gradeCounts)
  );
}

function parseBaselineFile(raw: string): CodeAgentBenchmarkBaseline | undefined {
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
      !isBenchmarkMetrics(value.metrics)
    ) return undefined;
    return {
      kind: "code-agent-benchmark-baseline",
      version: 1,
      baselineId: value.baselineId,
      suiteVersion: value.suiteVersion,
      generatedAt: value.generatedAt,
      metrics: value.metrics,
      rolloutAllowed: true,
    };
  } catch {
    return undefined;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

const sourceRoot = path.resolve(
  process.env.BENCHMARK_SOURCE_ROOT ?? path.resolve(process.cwd(), "../.."),
);
const provider = (process.env.BENCHMARK_PROVIDER ?? "openrouter") as ProviderId;
const caseTimeoutMs = Number.parseInt(process.env.BENCHMARK_CASE_TIMEOUT_MS ?? "90000", 10);
const replayInput = process.env.BENCHMARK_REPLAY_INPUT?.trim();
const baselinePath = path.resolve(
  process.env.BENCHMARK_BASELINE_PATH ??
    path.join(sourceRoot, "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json"),
);
if (!Number.isFinite(caseTimeoutMs) || caseTimeoutMs < 1_000) {
  throw new Error("BENCHMARK_CASE_TIMEOUT_MS must be at least 1000ms.");
}
if (!(provider in PROVIDER_KEY_ENV)) {
  throw new Error(`Unsupported BENCHMARK_PROVIDER: ${provider}`);
}

const allCases = getCodeAgentBenchmarkCases();
const requestedIds = (process.env.BENCHMARK_CASE_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const missingRequestedIds = requestedIds.filter(
  (id) => !allCases.some((testCase) => testCase.id === id),
);
if (missingRequestedIds.length > 0) {
  throw new Error(`Unknown benchmark case ids: ${missingRequestedIds.join(", ")}`);
}
if (requestedIds.length > 0 && !process.env.BENCHMARK_OUTPUT_DIR) {
  throw new Error(
    "Partial benchmark runs require BENCHMARK_OUTPUT_DIR so they cannot overwrite the canonical live scorecard.",
  );
}

if (replayInput) {
  const replayRecord = parseReplayFile(await fs.readFile(path.resolve(replayInput), "utf8"));
  if (!replayRecord) {
    throw new Error(`Invalid Code Agent benchmark replay record: ${replayInput}`);
  }
  const requestedCaseSet = requestedIds.length > 0
    ? new Set(requestedIds)
    : undefined;
  const replayCases = requestedCaseSet
    ? allCases.filter((testCase) => requestedCaseSet.has(testCase.id))
    : allCases;
   const replayScorecard = runCodeAgentBenchmarkReplay({
    record: replayRecord,
    cases: replayCases,
  });
   const scorecard = {
     ...replayScorecard,
     rolloutAllowed: false,
     rolloutBlockers: [
       ...replayScorecard.rolloutBlockers,
       "replay scorecard cannot authorize live rollout",
     ],
   };
  const outputDir = path.resolve(
    process.env.BENCHMARK_OUTPUT_DIR ??
      path.join(sourceRoot, "lib/ai-orchestrator/benchmark-results"),
  );
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-replay.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-replay.md"),
     codeAgentBenchmarkScorecardToMarkdown(scorecard),
    "utf8",
  );
  console.log(JSON.stringify({
    suiteVersion: scorecard.suiteVersion,
    mode: "replay",
    observedCases: scorecard.metrics.observedCases,
    totalCases: scorecard.metrics.totalCases,
    gradeCounts: scorecard.metrics.gradeCounts,
    rolloutAllowed: scorecard.rolloutAllowed,
    rolloutBlockers: scorecard.rolloutBlockers,
    outputDir,
  }, null, 2));
  process.exit(0);
}

const apiKey = process.env[PROVIDER_KEY_ENV[provider]];
if (!apiKey) {
  throw new Error(`Missing ${PROVIDER_KEY_ENV[provider]} for live benchmark execution.`);
}

const isolated = await createIsolatedBenchmarkRoot(sourceRoot);
try {
  const outputDir = path.resolve(
    process.env.BENCHMARK_OUTPUT_DIR ??
      path.join(sourceRoot, "lib/ai-orchestrator/benchmark-results"),
  );
  await fs.mkdir(outputDir, { recursive: true });
  const progressPath = path.join(outputDir, "code-agent-benchmark-live.progress.json");
  const replayPath = process.env.BENCHMARK_REPLAY_OUTPUT
    ? path.resolve(process.env.BENCHMARK_REPLAY_OUTPUT)
    : undefined;
  const configuredModel = process.env.BENCHMARK_MODEL?.trim() || undefined;
  let initialResults: CodeAgentBenchmarkObservation[] = [];
  let generatedAt = new Date().toISOString();
  const replayEntries = new Map<string, CodeAgentBenchmarkReplayEntry>();
  let baseline: CodeAgentBenchmarkBaseline | undefined;

  try {
    baseline = parseBaselineFile(await fs.readFile(baselinePath, "utf8"));
  } catch {
    // Missing baselines fail closed in applyCodeAgentBenchmarkBaselineGate.
  }

  if (!process.env.BENCHMARK_RESET) {
    try {
      const progress = parseProgressFile(
        await fs.readFile(progressPath, "utf8"),
        provider,
        configuredModel,
      );
      if (progress?.suiteVersion === CODE_AGENT_BENCHMARK_VERSION) {
        initialResults = progress.cases.filter((result) => result.providerUnavailable !== true);
        generatedAt = progress.generatedAt;
      }
    } catch {
      // No progress file means a fresh benchmark run.
    }
    if (replayPath) {
      try {
        const replay = parseReplayFile(await fs.readFile(replayPath, "utf8"));
        for (const entry of replay?.cases ?? []) replayEntries.set(entry.caseId, entry);
      } catch {
        // No replay file means a fresh bounded telemetry record.
      }
    }
  }

  const requestedCaseSet = requestedIds.length > 0
    ? new Set(requestedIds)
    : undefined;
  const casesToRun = allCases.filter((testCase) =>
    (!requestedCaseSet || requestedCaseSet.has(testCase.id)) &&
    !initialResults.some((result) => result.caseId === testCase.id),
  );
  const persistProgress = async (
    _observation: CodeAgentBenchmarkObservation,
    results: readonly CodeAgentBenchmarkObservation[],
  ): Promise<void> => {
    const progressScorecard = buildCodeAgentBenchmarkScorecard({
      results,
      generatedAt,
    });
    await writeJsonAtomically(progressPath, {
      kind: "code-agent-benchmark-progress",
      suiteVersion: progressScorecard.suiteVersion,
      provider,
      model: configuredModel ?? null,
      generatedAt,
      cases: progressScorecard.cases,
    } satisfies BenchmarkProgressFile);
  };
  const persistReplay = async (
    testCase: typeof allCases[number],
    telemetry: CodeAgentExecutionTelemetry,
  ): Promise<void> => {
    if (!replayPath) return;
    replayEntries.set(testCase.id, { caseId: testCase.id, telemetry });
    await writeJsonAtomically(
      replayPath,
      buildCodeAgentBenchmarkReplayRecord({
        entries: [...replayEntries.values()],
        recordedAt: generatedAt,
      }),
    );
  };

  const rawScorecard = await runApiCodeAgentBenchmark({
    rootPath: isolated.rootPath,
    projectContext: BENCHMARK_CONTEXT,
    provider,
    apiKey,
    model: configuredModel,
    cases: casesToRun,
    initialResults,
    onTelemetryComplete: persistReplay,
    onCaseComplete: persistProgress,
    targetPathsForCase: defaultApiBenchmarkTargetPaths,
    allowedPathsForCase: defaultApiBenchmarkAllowedPaths,
    promptForCase: defaultApiBenchmarkPrompt,
    historyForCase: defaultApiBenchmarkHistory,
    caseTimeoutMs,
    generatedAt,
  });
  const scorecard = {
    ...applyCodeAgentBenchmarkBaselineGate({
      scorecard: rawScorecard,
      baseline,
    }),
    provider,
    model: configuredModel ?? null,
  };

  if (replayPath) {
    await writeJsonAtomically(
      replayPath,
      buildCodeAgentBenchmarkReplayRecord({
        entries: [...replayEntries.values()],
        recordedAt: generatedAt,
      }),
    );
  }

  if (scorecard.metrics.complete) {
    await fs.rm(progressPath, { force: true });
  } else {
    await writeJsonAtomically(progressPath, {
      kind: "code-agent-benchmark-progress",
      suiteVersion: scorecard.suiteVersion,
      provider,
      model: configuredModel ?? null,
      generatedAt,
      cases: scorecard.cases,
    } satisfies BenchmarkProgressFile);
  }
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-live.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputDir, "code-agent-benchmark-live.md"),
     codeAgentBenchmarkScorecardToMarkdown(scorecard),
    "utf8",
  );

  console.log(JSON.stringify({
    suiteVersion: scorecard.suiteVersion,
    provider,
    observedCases: scorecard.metrics.observedCases,
    totalCases: scorecard.metrics.totalCases,
    gradeCounts: scorecard.metrics.gradeCounts,
    rolloutAllowed: scorecard.rolloutAllowed,
    rolloutBlockers: scorecard.rolloutBlockers,
    outputDir,
  }, null, 2));
} finally {
  await isolated.cleanup();
}