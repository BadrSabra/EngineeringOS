import {
  createChatCodeAgentBenchmarkExecutor,
  probeProviderHealth,
  runCodeAgentBenchmarkAirlock,
  runCodeAgentBenchmark,
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
};

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

  const executeCase = createChatCodeAgentBenchmarkExecutor({
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
  runId: string;
  onObservation?: (
    observation: BenchmarkAirlockObservation,
    observations: readonly BenchmarkAirlockObservation[],
  ) => Promise<void>;
  onProviderHealth?: (health: readonly ProviderHealthProbeResult[]) => Promise<void>;
  beforeCase?: (testCase: CodeAgentBenchmarkCase, rootPath: string) => void | Promise<void>;
}): Promise<BenchmarkAirlockRun> {
  const fixtureErrors = validateCodeAgentBenchmarkFixtureContracts(
    opts.cases ?? getCodeAgentBenchmarkCases(),
  );
  if (fixtureErrors.length > 0) {
    throw new Error(`Invalid Code Agent benchmark fixture contract: ${fixtureErrors.join("; ")}`);
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
    const executeCase = createChatCodeAgentBenchmarkExecutor({
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
    return {
      provider: provider.provider,
      model: provider.model ?? health.model,
      health,
      executeCase,
    };
  }));

  return runCodeAgentBenchmarkAirlock({
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
    onObservation: opts.onObservation,
    onHealth: opts.onProviderHealth,
    signal: opts.signal,
  });
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