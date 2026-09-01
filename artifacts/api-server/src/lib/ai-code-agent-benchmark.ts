import {
  createChatCodeAgentBenchmarkExecutor,
  probeProviderHealth,
  runCodeAgentBenchmarkAirlock,
  runCodeAgentBenchmark,
  buildCodeAgentBenchmarkScorecard,
  getBenchmarkRecoveryCaseIds,
  buildAutonomousDeliveryAcceptanceSummary,
  ValidationProfileSchema,
  type CodeAgentBenchmarkCase,
  type CodeAgentBenchmarkScorecard,
  type ChatMessage,
  type ProjectContext,
  type ProviderId,
  getCodeAgentBenchmarkFixture,
  getCodeAgentBenchmarkCases,
  validateCodeAgentBenchmarkFixtureContracts,
  type CodeAgentBenchmarkFixtureOracleResult,
  type CodeAgentBenchmarkCaseComplete,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkTelemetryComplete,
  type BenchmarkAirlockRun,
  type BenchmarkAirlockObservation,
  type ProviderHealthProbeResult,
  type BenchmarkShardConfig,
  type CodeAgentBenchmarkTargetProfile,
} from "@workspace/ai-orchestrator";
import {
  runRepairRuntimeOracle,
  runRepairValidation,
} from "./ai-repair-validation.js";
import { evaluateCodeAgentBenchmarkContract } from "@workspace/ai-orchestrator";
import { hashDeliveryWorkspace } from "./delivery-workspace.js";

const RUNTIME_ORACLE_REPORT_LIMIT = 64;
const RUNTIME_ORACLE_IDENTIFIER_LIMIT = 160;
const RUNTIME_ORACLE_COMMAND_LIMIT = 240;
const SAFE_RUNTIME_ORACLE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

export type ApiCodeAgentRuntimeOracleCheck = {
  scenarioId: string;
  command: string;
  status: "passed" | "failed";
  failureCode?: string;
};

export type ApiCodeAgentRuntimeOraclePreflight = {
  status: "passed" | "failed";
  checks: ApiCodeAgentRuntimeOracleCheck[];
  failureIds: string[];
};

export type ApiCodeAgentBenchmarkOptions = {
  rootPath: string;
  projectContext: ProjectContext;
  provider: ProviderId;
  apiKey: string;
  model?: string;
  targetPathsForCase: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  allowedPathsForCase?: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  promptForCase?: (testCase: CodeAgentBenchmarkCase) => string;
  historyForCase?: (testCase: CodeAgentBenchmarkCase) => ChatMessage[];
  caseTimeoutMs?: number;
  cases?: readonly CodeAgentBenchmarkCase[];
  initialResults?: readonly CodeAgentBenchmarkObservation[];
  onTelemetryComplete?: CodeAgentBenchmarkTelemetryComplete;
  onCaseComplete?: CodeAgentBenchmarkCaseComplete;
  signal?: AbortSignal;
  generatedAt?: string;
  /** Captured by the server campaign runner; never accepted from benchmark fixtures or providers. */
  sourceRevision?: string;
};

function runtimeOracleCommandLabel(command: {
  command: string;
  args: readonly string[];
}): string {
  return [command.command, ...command.args].join(" ").slice(0, RUNTIME_ORACLE_COMMAND_LIMIT);
}

function runtimeOracleFailureCode(code: string | undefined): string {
  return code && SAFE_RUNTIME_ORACLE_CODE.test(code) ? code : "RUNTIME_ORACLE_FAILED";
}

export function runtimeOraclePreflightError(
  report: ApiCodeAgentRuntimeOraclePreflight,
): Error | undefined {
  if (report.status !== "failed") return undefined;
  const failures = report.checks
    .filter((check) => check.status === "failed")
    .map((check) => `${check.scenarioId} [${check.command}]: ${check.failureCode ?? "RUNTIME_ORACLE_FAILED"}`);
  return new Error(
    `Code Agent benchmark runtime-oracle preflight failed: ${failures.join("; ")}`,
  );
}

/**
 * Build the durable, provider-free receipt for a campaign that cannot start
 * case execution because its server-owned runtime oracles failed. This keeps
 * the scorecard incomplete (rather than inventing case outcomes) while still
 * making the preflight evidence available to release readers.
 */
export function buildApiCodeAgentBenchmarkPreflightBlockedRun(args: {
  runtimeOraclePreflight: ApiCodeAgentRuntimeOraclePreflight;
  cases: readonly CodeAgentBenchmarkCase[];
  initialResults?: readonly BenchmarkAirlockObservation[];
  mode?: "live" | "free-only";
  campaignMode?: import("@workspace/ai-orchestrator").BenchmarkCampaignMode;
  recoveryOnly?: boolean;
  diagnosticOnly?: boolean;
  targeted?: boolean;
  targetProfile?: CodeAgentBenchmarkTargetProfile;
  shard?: BenchmarkShardConfig;
  providerOrder: readonly ProviderId[];
  runId: string;
  startedAt?: string;
  completedAt?: string;
  generatedAt?: string;
  sourceRevision?: string;
  candidateHash?: string;
}): BenchmarkAirlockRun {
  const campaignMode = args.campaignMode ?? "clean-witness";
  const targeted = args.targeted === true || args.targetProfile !== undefined;
  const diagnosticOnly = args.diagnosticOnly === true ||
    args.targetProfile !== undefined ||
    args.shard !== undefined;
  const cases = [...args.cases];
  const caseIds = new Set(cases.map((testCase) => testCase.id));
  const observations = (args.initialResults ?? []).filter((entry) => caseIds.has(entry.caseId));
  let scorecard = buildCodeAgentBenchmarkScorecard({
    results: observations.map((entry) => entry.observation),
    cases,
    generatedAt: args.generatedAt,
  });
  scorecard = {
    ...scorecard,
    ...(args.candidateHash ? { candidateHash: args.candidateHash } : {}),
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
    rolloutAllowed: false,
    rolloutBlockers: [...new Set([
      ...scorecard.rolloutBlockers,
      "benchmark runtime-oracle preflight failed",
    ])],
  };
  const startedAt = args.startedAt ?? args.generatedAt ?? new Date().toISOString();
  const completedAt = args.completedAt ?? new Date().toISOString();
  const blockers = ["benchmark runtime-oracle preflight failed"];

  return {
    kind: "code-agent-benchmark-airlock",
    version: 1,
    mode: args.mode ?? "live",
    campaignMode,
    // A preflight-blocked invocation is never a completed campaign, even when
    // it is resuming a previously complete observation set.
    campaignStatus: "incomplete",
    recoveryCaseIds: getBenchmarkRecoveryCaseIds(
      observations.map((entry) => entry.observation),
    ),
    recoveryOnly: args.recoveryOnly === true,
    diagnosticOnly,
    targeted,
    partial: diagnosticOnly,
    baselineEligibility: diagnosticOnly ? "not-eligible" : "quality-gates-required",
    ...(args.targetProfile ? { targetProfile: args.targetProfile } : {}),
    suiteVersion: scorecard.suiteVersion,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
    runId: args.runId,
    startedAt,
    completedAt,
    targetCaseCount: cases.length,
    providerOrder: [...args.providerOrder],
    // Provider health is intentionally empty: runtime-oracle preflight runs
    // before provider probing and no provider case has been consumed.
    providerHealth: [],
    runtimeOraclePreflight: args.runtimeOraclePreflight,
    preflight: { status: "blocked", blockers },
    observations,
    ...(args.shard
      ? { shard: { ...args.shard, caseIds: cases.map((testCase) => testCase.id) } }
      : {}),
    scorecard,
    autonomousDeliveryAcceptance: buildAutonomousDeliveryAcceptanceSummary({
      campaign: {
        provider: args.mode === "free-only" || args.mode === "live" ? "live" : "deterministic",
        browser: false,
        deployment: false,
        remoteDelivery: false,
        isolated: true,
        redacted: true,
      },
      receipts: [],
    }),
  };
}

/**
 * Execute every maintained runtime oracle against its server-owned focused
 * candidate before a provider-backed benchmark starts. The fixture setup and
 * candidate are materialized inside the runtime runner's disposable copy, so
 * this check cannot mutate the campaign source or use provider output.
 */
export async function validateApiCodeAgentBenchmarkRuntimeOracles(opts: {
  rootPath: string;
  cases?: readonly CodeAgentBenchmarkCase[];
  signal?: AbortSignal;
}): Promise<ApiCodeAgentRuntimeOraclePreflight> {
  const checks: ApiCodeAgentRuntimeOracleCheck[] = [];

  for (const testCase of opts.cases ?? getCodeAgentBenchmarkCases()) {
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    if (!fixture.runtimeOracle) continue;

    const commandLabel = runtimeOracleCommandLabel(fixture.runtimeOracle);
    const scenarioId = testCase.id.slice(0, RUNTIME_ORACLE_IDENTIFIER_LIMIT);
    if (!fixture.focusedPendingChanges || fixture.focusedPendingChanges.length === 0) {
      checks.push({
        scenarioId,
        command: commandLabel,
        status: "failed",
        failureCode: "RUNTIME_ORACLE_CANDIDATE_MISSING",
      });
      continue;
    }

    const result = await runRepairRuntimeOracle(
      opts.rootPath,
      fixture.focusedPendingChanges,
      fixture.runtimeOracle,
      opts.signal,
      fixture.prepare,
    );
    if (result.status !== "passed") {
      checks.push({
        scenarioId,
        command: commandLabel,
        status: "failed",
        failureCode: runtimeOracleFailureCode(result.code),
      });
      continue;
    }
    checks.push({ scenarioId, command: commandLabel, status: "passed" });
  }

  const failureIds = checks
    .filter((check) => check.status === "failed")
    .map((check) => check.scenarioId)
    .slice(0, RUNTIME_ORACLE_REPORT_LIMIT);
  return {
    status: failureIds.length > 0 ? "failed" : "passed",
    checks: checks.slice(0, RUNTIME_ORACLE_REPORT_LIMIT),
    failureIds,
  };
}

/**
 * Run the Code Agent matrix with the API server's real overlay validation.
 *
 * The caller owns the target/allowed path mapping because those are approval
 * scope, not benchmark metadata. Validation output is reduced by the
 * orchestrator adapter before it reaches the scorecard.
 */
export async function runApiCodeAgentBenchmark(
  opts: ApiCodeAgentBenchmarkOptions,
): Promise<CodeAgentBenchmarkScorecard> {
  const fixtureErrors = validateCodeAgentBenchmarkFixtureContracts(
    opts.cases ?? getCodeAgentBenchmarkCases(),
  );
  if (fixtureErrors.length > 0) {
    throw new Error(`Invalid Code Agent benchmark fixture contract: ${fixtureErrors.join("; ")}`);
  }
  const runtimeOraclePreflight = await validateApiCodeAgentBenchmarkRuntimeOracles({
    rootPath: opts.rootPath,
    signal: opts.signal,
  });
  const preflightError = runtimeOraclePreflightError(runtimeOraclePreflight);
  if (preflightError) throw preflightError;
  const candidateHash = await hashDeliveryWorkspace(opts.rootPath);
  const validationRunner = async (
    profile: string,
    targetPaths: string[],
    signal?: AbortSignal,
    pendingChanges?: readonly { path: string; newContent: string }[],
  ) => {
    const parsedProfile = ValidationProfileSchema.safeParse(profile);
    if (!parsedProfile.success) {
      return {
        status: "unavailable" as const,
        code: "VALIDATION_PROFILE_UNAVAILABLE",
        detail: `Validation profile "${profile}" is not registered.`,
      };
    }

    return runRepairValidation(
      opts.rootPath,
      parsedProfile.data,
      targetPaths,
      signal,
      pendingChanges,
    );
  };

  const executeCaseBase = createChatCodeAgentBenchmarkExecutor({
    rootPath: opts.rootPath,
    projectContext: opts.projectContext,
    provider: opts.provider,
    apiKey: opts.apiKey,
    model: opts.model,
    candidateHash,
    validationRunner,
    includeTestSources: true,
    validationProfileForCase: (testCase) => getCodeAgentBenchmarkFixture(testCase).validationProfile,
    behavioralProofForCase: async ({ rootPath, testCase, pendingChanges, signal }) => {
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      if (fixture.runtimeOracle) {
        const runtime = await runRepairRuntimeOracle(
          rootPath,
          pendingChanges,
          fixture.runtimeOracle,
          signal,
        );
        if (runtime.status !== "passed") return runtime;
      }
      if (!fixture.behavioralOracle) return { status: "passed" as const };
      return fixture.behavioralOracle({ rootPath, pendingChanges });
    },
    targetPathsForCase: opts.targetPathsForCase,
    allowedPathsForCase: opts.allowedPathsForCase,
    promptForCase: opts.promptForCase,
    historyForCase: opts.historyForCase,
    caseTimeoutMs: opts.caseTimeoutMs,
    signal: opts.signal,
    prepareCase: async (testCase) => {
      await getCodeAgentBenchmarkFixture(testCase).prepare?.(opts.rootPath);
    },
    oracleForCase: async ({ rootPath, testCase, telemetry, pendingChanges }) =>
      evaluateBenchmarkCaseOracle(rootPath, testCase, telemetry, pendingChanges, undefined, candidateHash),
  });
  const executeCase = async (testCase: CodeAgentBenchmarkCase) => ({
    ...(await executeCaseBase(testCase)),
    ...(opts.sourceRevision ? { sourceRevision: opts.sourceRevision } : {}),
  });

  return runCodeAgentBenchmark({
    executeCase,
    cases: opts.cases,
    initialResults: opts.initialResults,
    onTelemetryComplete: opts.onTelemetryComplete,
    onCaseComplete: opts.onCaseComplete,
    generatedAt: opts.generatedAt,
  });
}

export type ApiCodeAgentBenchmarkProvider = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
};

/**
 * Run the real API-backed executor through the provider health Airlock.
 *
 * Health is probed once per provider before any benchmark case is consumed.
 * The returned run keeps provider health separate from quality observations.
 */
export async function runApiCodeAgentBenchmarkAirlock(opts: {
  rootPath: string;
  projectContext: ProjectContext;
  mode?: "live" | "free-only";
  campaignMode?: import("@workspace/ai-orchestrator").BenchmarkCampaignMode;
  recoveryOnly?: boolean;
  diagnosticOnly?: boolean;
  targeted?: boolean;
  targetProfile?: CodeAgentBenchmarkTargetProfile;
  shard?: BenchmarkShardConfig;
  providers: readonly ApiCodeAgentBenchmarkProvider[];
  targetPathsForCase: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  allowedPathsForCase?: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  promptForCase?: (testCase: CodeAgentBenchmarkCase) => string;
  historyForCase?: (testCase: CodeAgentBenchmarkCase) => ChatMessage[];
  caseTimeoutMs?: number;
  cases?: readonly CodeAgentBenchmarkCase[];
  initialResults?: import("@workspace/ai-orchestrator").BenchmarkAirlockObservation[];
  signal?: AbortSignal;
  generatedAt?: string;
  /** Captured by the server campaign runner; never accepted from benchmark fixtures or providers. */
  sourceRevision?: string;
  runId: string;
  onObservation?: (
    observation: BenchmarkAirlockObservation,
    observations: readonly BenchmarkAirlockObservation[],
  ) => Promise<void>;
  onProviderHealth?: (health: readonly ProviderHealthProbeResult[]) => Promise<void>;
  onRuntimeOraclePreflight?: (report: ApiCodeAgentRuntimeOraclePreflight) => Promise<void>;
  beforeCase?: (testCase: CodeAgentBenchmarkCase, rootPath: string) => void | Promise<void>;
}): Promise<BenchmarkAirlockRun> {
  const fixtureErrors = validateCodeAgentBenchmarkFixtureContracts(
    opts.cases ?? getCodeAgentBenchmarkCases(),
  );
  if (fixtureErrors.length > 0) {
    throw new Error(`Invalid Code Agent benchmark fixture contract: ${fixtureErrors.join("; ")}`);
  }
  const runtimeOraclePreflight = await validateApiCodeAgentBenchmarkRuntimeOracles({
    rootPath: opts.rootPath,
    signal: opts.signal,
  });
  const preflightError = runtimeOraclePreflightError(runtimeOraclePreflight);
  if (preflightError) {
    await opts.onRuntimeOraclePreflight?.(runtimeOraclePreflight);
    throw preflightError;
  }
  const candidateHash = await hashDeliveryWorkspace(opts.rootPath);
  const validationRunner = async (
    profile: string,
    targetPaths: string[],
    signal?: AbortSignal,
    pendingChanges?: readonly { path: string; newContent: string }[],
  ) => {
    const parsedProfile = ValidationProfileSchema.safeParse(profile);
    if (!parsedProfile.success) {
      return {
        status: "unavailable" as const,
        code: "VALIDATION_PROFILE_UNAVAILABLE",
        detail: `Validation profile "${profile}" is not registered.`,
      };
    }

    return runRepairValidation(
      opts.rootPath,
      parsedProfile.data,
      targetPaths,
      signal,
      pendingChanges,
    );
  };

  const airlockProviders = await Promise.all(opts.providers.map(async (provider) => {
    const health: ProviderHealthProbeResult = await probeProviderHealth({
      provider: provider.provider,
      apiKey: provider.apiKey,
      model: provider.model,
      signal: opts.signal,
    });
    const executeCaseBase = createChatCodeAgentBenchmarkExecutor({
      rootPath: opts.rootPath,
      projectContext: opts.projectContext,
      provider: provider.provider,
      apiKey: provider.apiKey,
      model: provider.model,
      candidateHash,
      providerHealth: health,
      freeOnly: opts.mode === "free-only",
      validationRunner,
    includeTestSources: true,
        validationProfileForCase: (testCase) => getCodeAgentBenchmarkFixture(testCase).validationProfile,
        behavioralProofForCase: async ({ rootPath, testCase, pendingChanges, signal }) => {
          const fixture = getCodeAgentBenchmarkFixture(testCase);
          if (fixture.runtimeOracle) {
            const runtime = await runRepairRuntimeOracle(
              rootPath,
              pendingChanges,
              fixture.runtimeOracle,
              signal,
            );
            if (runtime.status !== "passed") return runtime;
          }
          if (!fixture.behavioralOracle) return { status: "passed" as const };
          return fixture.behavioralOracle({ rootPath, pendingChanges });
        },
      targetPathsForCase: opts.targetPathsForCase,
      allowedPathsForCase: opts.allowedPathsForCase,
      promptForCase: opts.promptForCase,
      historyForCase: opts.historyForCase,
      caseTimeoutMs: opts.caseTimeoutMs,
      signal: opts.signal,
      prepareCase: async (testCase) => {
        await opts.beforeCase?.(testCase, opts.rootPath);
        await getCodeAgentBenchmarkFixture(testCase).prepare?.(opts.rootPath);
      },
    oracleForCase: async ({ rootPath, testCase, telemetry, pendingChanges, signal }) =>
      evaluateBenchmarkCaseOracle(rootPath, testCase, telemetry, pendingChanges, signal, candidateHash),
    });
    const executeCase = async (testCase: CodeAgentBenchmarkCase) => ({
      ...(await executeCaseBase(testCase)),
      ...(opts.sourceRevision ? { sourceRevision: opts.sourceRevision } : {}),
    });
    return {
      provider: provider.provider,
      model: provider.model ?? health.model,
      health,
      executeCase,
    };
  }));

  const run = await runCodeAgentBenchmarkAirlock({
    providers: airlockProviders,
    mode: opts.mode,
    campaignMode: opts.campaignMode,
    recoveryOnly: opts.recoveryOnly,
    diagnosticOnly: opts.diagnosticOnly,
    targeted: opts.targeted,
    targetProfile: opts.targetProfile,
    shard: opts.shard,
    cases: opts.cases,
    initialResults: opts.initialResults,
    runId: opts.runId,
    generatedAt: opts.generatedAt,
    sourceRevision: opts.sourceRevision,
    candidateHash,
    onObservation: opts.onObservation,
    onHealth: opts.onProviderHealth,
    signal: opts.signal,
  });
  return { ...run, runtimeOraclePreflight };
}

async function evaluateBenchmarkCaseOracle(
  rootPath: string,
  testCase: CodeAgentBenchmarkCase,
  telemetry: import("@workspace/ai-orchestrator").CodeAgentExecutionTelemetry,
  pendingChanges: readonly { path: string; newContent: string }[],
  signal?: AbortSignal,
  expectedCandidateHash?: string,
): Promise<CodeAgentBenchmarkFixtureOracleResult> {
  if (
    !expectedCandidateHash ||
    !/^[a-f0-9]{64}$/.test(expectedCandidateHash) ||
    telemetry.candidateHash !== expectedCandidateHash
  ) {
    return {
      status: "failed",
      code: "CANDIDATE_HASH_MISMATCH",
      behavioralOracleStatus: "not-run",
    };
  }
  const fixture = getCodeAgentBenchmarkFixture(testCase);
  const hasBehavioralOracle = Boolean(fixture.behavioralOracle || fixture.runtimeOracle);
  const contract = await evaluateCodeAgentBenchmarkContract({
    rootPath,
    testCase,
    telemetry,
    pendingChanges,
  });
  if (contract.status === "failed") {
    return {
      ...contract,
      behavioralOracleStatus: hasBehavioralOracle ? "not-run" : "not-available",
    };
  }
  if (!hasBehavioralOracle) {
    return { ...contract, behavioralOracleStatus: "not-available" };
  }
  if (fixture.runtimeOracle) {
    const runtime = await runRepairRuntimeOracle(
      rootPath,
      pendingChanges,
      fixture.runtimeOracle,
      signal,
    );
    if (runtime.status !== "passed") {
      return {
        ...runtime,
        behavioralOracleStatus: "failed",
      };
    }
  }
  if (!fixture.behavioralOracle) {
    return { ...contract, behavioralOracleStatus: "passed" };
  }
  const behavioral = await fixture.behavioralOracle({
    rootPath,
    telemetry,
    pendingChanges,
  });
  return { ...behavioral, behavioralOracleStatus: behavioral.status };
}

export function defaultApiBenchmarkTargetPaths(testCase: CodeAgentBenchmarkCase): readonly string[] {
  return getCodeAgentBenchmarkFixture(testCase).targetPaths;
}

export function defaultApiBenchmarkAllowedPaths(testCase: CodeAgentBenchmarkCase): readonly string[] {
  return getCodeAgentBenchmarkFixture(testCase).allowedPaths;
}

export function defaultApiBenchmarkPrompt(testCase: CodeAgentBenchmarkCase): string {
  return getCodeAgentBenchmarkFixture(testCase).prompt;
}

export function defaultApiBenchmarkHistory(testCase: CodeAgentBenchmarkCase): ChatMessage[] {
  const fixture = getCodeAgentBenchmarkFixture(testCase);
  return [{
    role: "assistant",
    content: "Approved benchmark Repair Plan",
    repairPlan: [{
      findingId: "F-01",
      files: [...fixture.targetPaths],
      steps: [testCase.prompt],
      validationProfile: fixture.validationProfile ?? "workspace-typecheck",
      verdictScope: "PRODUCTION",
      scopedFindingStatus: "PRODUCTION_PROVEN",
    }],
  }];
}