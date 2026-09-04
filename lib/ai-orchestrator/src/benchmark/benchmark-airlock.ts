import {
  buildCodeAgentBenchmarkScorecard,
  getCodeAgentBenchmarkCases,
  observationFromCodeAgentExecution,
  validateCodeAgentBenchmarkManifest,
  type CodeAgentBenchmarkCase,
  type CodeAgentBenchmarkExecutor,
  type CodeAgentBenchmarkObservation,
  type CodeAgentBenchmarkScorecard,
  type CodeAgentExecutionTelemetry,
  type CodeAgentBenchmarkTargetProfile,
} from "./code-agent-benchmark.js";
import type {
  ProviderHealthProbeResult,
} from "./provider-health-probe.js";
import { projectSafeProviderHealth } from "./provider-health-probe.js";
import type { ProviderId } from "../provider-registry.js";
import type { BenchmarkShardConfig } from "./benchmark-shards.js";
import {
  getBenchmarkCampaignStatus,
  getBenchmarkRecoveryCaseIds,
  type BenchmarkCampaignMode,
} from "./benchmark-campaign.js";
import {
  buildAutonomousDeliveryAcceptanceSummary,
  type AutonomousDeliveryAcceptanceSummary,
} from "./autonomous-delivery-acceptance.js";
import type { BenchmarkParityReport } from "./benchmark-parity-report.js";

export const BENCHMARK_AIRLOCK_VERSION = 1;

export type BenchmarkAirlockProvider = {
  provider: ProviderId;
  model?: string | null;
  health: ProviderHealthProbeResult;
  executeCase: CodeAgentBenchmarkExecutor;
};

export type BenchmarkAirlockObservation = {
  caseId: string;
  provider: ProviderId | null;
  model: string | null;
  providerAttempts: number;
  observation: CodeAgentBenchmarkObservation;
};

export type BenchmarkAirlockRun = {
  kind: "code-agent-benchmark-airlock";
  version: typeof BENCHMARK_AIRLOCK_VERSION;
  mode: "live" | "free-only";
  campaignMode: BenchmarkCampaignMode;
  campaignStatus: "coverage-complete" | "clean-witness" | "incomplete";
  recoveryCaseIds: string[];
  recoveryOnly: boolean;
  diagnosticOnly: boolean;
  targeted: boolean;
  partial: boolean;
  baselineEligibility: "not-eligible" | "quality-gates-required";
  targetProfile?: CodeAgentBenchmarkTargetProfile;
  suiteVersion: string;
  /** Server-observed source revision captured at campaign start. */
  sourceRevision?: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  targetCaseCount: number;
  providerOrder: ProviderId[];
  providerHealth: ProviderHealthProbeResult[];
  runtimeOraclePreflight?: {
    status: "passed" | "failed";
    checks: Array<{
      scenarioId: string;
      command: string;
      status: "passed" | "failed";
      failureCode?: string;
    }>;
    failureIds: string[];
  };
  preflight?: {
    status: "ready" | "blocked";
    blockers: string[];
  };
  observations: BenchmarkAirlockObservation[];
  shard?: BenchmarkShardConfig & { caseIds: string[] };
  scorecard: CodeAgentBenchmarkScorecard;
  autonomousDeliveryAcceptance?: AutonomousDeliveryAcceptanceSummary;
  parityReport?: BenchmarkParityReport;
};

function acceptanceReceipt(entry: BenchmarkAirlockObservation, runId: string) {
  const observation = entry.observation;
  const terminal = observation.providerUnavailable || observation.grade === "U"
    ? "uncertain" as const
    : observation.safelyBlocked
      ? "safely-blocked" as const
      : observation.grade === "F"
        ? "failed" as const
        : "completed" as const;
  return {
    operationId: `${runId}:${entry.caseId}`,
    caseId: entry.caseId,
    terminal,
    deliveryVerified: terminal === "completed" && observation.correct,
    recovered: observation.repairedWithinThreeAttempts,
    scopeViolation: observation.scopeEscape,
    repeatedSideEffect: false,
  };
}

function buildAcceptanceSummary(
  observations: readonly BenchmarkAirlockObservation[],
  mode: "live" | "free-only" | undefined,
  runId: string,
): AutonomousDeliveryAcceptanceSummary {
  return buildAutonomousDeliveryAcceptanceSummary({
    campaign: {
      provider: mode === "live" || mode === "free-only" ? "live" : "deterministic",
      browser: false,
      deployment: false,
      remoteDelivery: false,
      isolated: true,
      redacted: true,
    },
    receipts: observations.map((entry) => acceptanceReceipt(entry, runId)),
  });
}

function unavailableTelemetry(
  allowedPaths: readonly string[],
  provenance: { candidateHash?: string; sourceRevision?: string } = {},
): CodeAgentExecutionTelemetry {
  return {
    ...(provenance.candidateHash ? { candidateHash: provenance.candidateHash } : {}),
    ...(provenance.sourceRevision ? { sourceRevision: provenance.sourceRevision } : {}),
    actualTerminal: "BLOCKED",
    validationStatus: "unavailable",
    changedPaths: [],
    allowedPaths: [...allowedPaths],
    filesRead: 0,
    toolCalls: 0,
    repairAttempts: 0,
    rejectedChanges: 0,
    conflict: false,
    typecheckPassed: null,
    testsPassed: null,
    providerUnavailable: true,
  };
}

function providerOrder(providers: readonly BenchmarkAirlockProvider[]): BenchmarkAirlockProvider[] {
  // The caller supplies the explicit priority order. Do not sort it: provider
  // quality/availability policy belongs to the registry or benchmark runner.
  return [...providers];
}

/**
 * Run a bounded benchmark through a preflighted provider pool.
 *
 * A provider-unavailable result is an environment attempt, never a repair
 * attempt. The same case may move to another healthy provider, while the
 * bounded scorecard retains U if no provider can produce quality telemetry.
 */
export async function runCodeAgentBenchmarkAirlock(args: {
  providers: readonly BenchmarkAirlockProvider[];
  mode?: "live" | "free-only";
  campaignMode?: BenchmarkCampaignMode;
  recoveryOnly?: boolean;
  diagnosticOnly?: boolean;
  targeted?: boolean;
  targetProfile?: CodeAgentBenchmarkTargetProfile;
  shard?: BenchmarkShardConfig;
  cases?: readonly CodeAgentBenchmarkCase[];
  initialResults?: readonly BenchmarkAirlockObservation[];
  runId: string;
  startedAt?: string;
  generatedAt?: string;
  sourceRevision?: string;
  candidateHash?: string;
  signal?: AbortSignal;
  onObservation?: (
    observation: BenchmarkAirlockObservation,
    observations: readonly BenchmarkAirlockObservation[],
  ) => Promise<void>;
  onHealth?: (health: readonly ProviderHealthProbeResult[]) => Promise<void>;
}): Promise<BenchmarkAirlockRun> {
  const campaignMode = args.campaignMode ?? "clean-witness";
  const targeted = args.targeted === true || args.targetProfile !== undefined;
  const diagnosticOnly = args.diagnosticOnly === true ||
    args.targetProfile !== undefined ||
    args.shard !== undefined;
  const baselineEligibility = diagnosticOnly ? "not-eligible" as const : "quality-gates-required" as const;
  const configuredCases = args.cases ?? getCodeAgentBenchmarkCases();
  const recoverable = (entry: BenchmarkAirlockObservation): boolean =>
    entry.observation.providerUnavailable === true ||
    entry.observation.grade === "U" ||
    entry.observation.grade === "F";
  const recoveryCaseIds = new Set(
    (args.initialResults ?? [])
      .filter(recoverable)
      .map((entry) => entry.caseId),
  );
  const cases = args.recoveryOnly
    ? configuredCases.filter((testCase) => recoveryCaseIds.has(testCase.id))
    : configuredCases;
  if (args.recoveryOnly && cases.length === 0) {
    throw new Error("Recovery-only benchmark campaign has no persisted U/F cases.");
  }
  const manifestErrors = validateCodeAgentBenchmarkManifest(cases, {
    requireComplete: cases.length === getCodeAgentBenchmarkCases().length,
  });
  if (manifestErrors.length > 0) {
    throw new Error(`Invalid Code Agent benchmark manifest: ${manifestErrors.join("; ")}`);
  }

  const orderedProviders = providerOrder(args.providers);
  const healthyProviders = orderedProviders.filter((provider) => provider.health.status === "usable");
  const quarantinedProviders = new Set<BenchmarkAirlockProvider>();
  const safeProviderHealth = orderedProviders.map((provider) => projectSafeProviderHealth(provider.health));
  await args.onHealth?.(safeProviderHealth);
  // A checkpointed U is an environment attempt, not completed case evidence.
  // Keep quality-proven observations for resume, but retry U on the next run.
  const caseIds = new Set(cases.map((testCase) => testCase.id));
  const observations = (args.initialResults ?? []).filter((entry) => {
    if (!caseIds.has(entry.caseId)) return false;
    if (args.recoveryOnly) return !recoverable(entry);
    return campaignMode === "coverage" || !recoverable(entry);
  });
  const unresolvedRecoveryCaseIds = (): string[] => {
    const observedIds = new Set(observations.map((entry) => entry.caseId));
    return [
      ...new Set([
        ...getBenchmarkRecoveryCaseIds(observations.map((entry) => entry.observation)),
        ...[...recoveryCaseIds].filter((caseId) => !observedIds.has(caseId)),
      ]),
    ];
  };
  const observedCaseIds = new Set(observations.map((entry) => entry.caseId));
  if (healthyProviders.length === 0 && campaignMode === "coverage") {
    for (const testCase of cases) {
      if (observedCaseIds.has(testCase.id)) continue;
      const observation = {
        caseId: testCase.id,
        provider: null,
        model: null,
        providerAttempts: 0,
        observation: observationFromCodeAgentExecution(testCase, unavailableTelemetry([], {
          candidateHash: args.candidateHash,
          sourceRevision: args.sourceRevision,
        })),
      };
      observations.push(observation);
      observedCaseIds.add(testCase.id);
      await args.onObservation?.(observation, observations);
    }
  }
  if (healthyProviders.length === 0 && campaignMode === "clean-witness") {
    const blockers = [
      "provider preflight blocked; no usable provider lane",
      ...orderedProviders
        .map((provider) => {
          const health = projectSafeProviderHealth(provider.health);
          return health.failureCode
            ? `${provider.provider}: ${health.failureCode}`
            : `${provider.provider}: provider unavailable`;
        })
        .filter((blocker, index, all) => all.indexOf(blocker) === index),
    ];
    let scorecard = buildCodeAgentBenchmarkScorecard({
      results: observations.map((entry) => entry.observation),
      cases,
      generatedAt: args.generatedAt,
    });
    scorecard = {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [...new Set([...scorecard.rolloutBlockers, ...blockers])],
    };
    if (diagnosticOnly) {
      scorecard.rolloutBlockers = [
        ...new Set([
          ...scorecard.rolloutBlockers,
          "targeted or partial benchmark run is diagnostic only; run a full clean witness before baseline approval",
        ]),
      ];
    }
    if (args.shard) {
      scorecard.rolloutBlockers = [
        ...new Set([...scorecard.rolloutBlockers, "benchmark shard is partial; combine all shards before rollout"]),
      ];
    }
    const startedAt = args.startedAt ?? new Date().toISOString();
    return {
      kind: "code-agent-benchmark-airlock",
      version: BENCHMARK_AIRLOCK_VERSION,
       mode: args.mode ?? "live",
       campaignMode,
       campaignStatus: getBenchmarkCampaignStatus(scorecard, campaignMode),
       recoveryCaseIds: unresolvedRecoveryCaseIds(),
       recoveryOnly: args.recoveryOnly === true,
       diagnosticOnly,
       targeted,
       partial: diagnosticOnly,
       baselineEligibility,
       ...(args.targetProfile ? { targetProfile: args.targetProfile } : {}),
      suiteVersion: scorecard.suiteVersion,
      runId: args.runId,
      startedAt,
      completedAt: new Date().toISOString(),
      targetCaseCount: cases.length,
      providerOrder: orderedProviders.map((provider) => provider.provider),
      providerHealth: safeProviderHealth,
      preflight: { status: "blocked", blockers },
      observations,
      ...(args.shard
        ? { shard: { ...args.shard, caseIds: cases.map((testCase) => testCase.id) } }
        : {}),
      scorecard,
      autonomousDeliveryAcceptance: buildAcceptanceSummary(observations, args.mode, args.runId),
    };
  }
  let providerCursor = 0;
  let runtimePreflightBlockers: string[] = [];

  for (const testCase of cases) {
    if (observedCaseIds.has(testCase.id)) continue;

    let selectedProvider: BenchmarkAirlockProvider | undefined;
    let telemetry: CodeAgentExecutionTelemetry | undefined;
    let providerAttempts = 0;
    const availableProviders = healthyProviders.filter((provider) => !quarantinedProviders.has(provider));
    const attempts = availableProviders.length;
     if (attempts === 0 && campaignMode === "clean-witness") {
      runtimePreflightBlockers = [
        "provider lanes exhausted after runtime unavailability; resume from the saved checkpoint",
      ];
      break;
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      const provider = availableProviders[providerCursor % availableProviders.length]!;
      providerCursor += 1;
      providerAttempts += 1;
      selectedProvider = provider;
      if (args.signal?.aborted) {
        throw new Error("Benchmark campaign exceeded its configured timeout.");
      }
      const candidate = await provider.executeCase(testCase);
      telemetry = candidate;
      if (!candidate.providerUnavailable) break;
      // A runtime U is isolated for the remainder of this rolling window.
      // Other lanes can continue, but this failing lane must not cascade U
      // across every later case.
      quarantinedProviders.add(provider);
    }

    if (!telemetry || telemetry.providerUnavailable) {
      telemetry = unavailableTelemetry([], {
        candidateHash: args.candidateHash,
        sourceRevision: args.sourceRevision,
      });
    }

    const observation = observationFromCodeAgentExecution(testCase, telemetry);
    observations.push({
      caseId: testCase.id,
      provider: selectedProvider?.provider ?? null,
      model: selectedProvider?.model ?? selectedProvider?.health.model ?? null,
      providerAttempts,
      observation,
    });
    observedCaseIds.add(testCase.id);
    await args.onObservation?.(observations[observations.length - 1]!, observations);

     if (
       telemetry.providerUnavailable &&
       healthyProviders.every((provider) => quarantinedProviders.has(provider)) &&
       campaignMode === "clean-witness"
     ) {
      runtimePreflightBlockers = [
        "provider lanes exhausted after runtime unavailability; resume from the saved checkpoint",
      ];
      break;
    }
  }

  let scorecard = buildCodeAgentBenchmarkScorecard({
    results: observations.map((entry) => entry.observation),
    cases,
    generatedAt: args.generatedAt,
  });
  if (runtimePreflightBlockers.length > 0) {
    scorecard = {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [...new Set([...scorecard.rolloutBlockers, ...runtimePreflightBlockers])],
    };
  }
  if (campaignMode === "coverage") {
    scorecard = {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [
        ...new Set([
          ...scorecard.rolloutBlockers,
          "coverage campaign is not a clean witness; run a clean-witness campaign before baseline approval",
        ]),
      ],
    };
  }
  if (args.shard) {
    scorecard = {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [
        ...scorecard.rolloutBlockers,
        "benchmark shard is partial; combine all shards before rollout",
      ],
    };
  }
  if (diagnosticOnly) {
    scorecard = {
      ...scorecard,
      rolloutAllowed: false,
      rolloutBlockers: [
        ...new Set([
          ...scorecard.rolloutBlockers,
          "targeted or partial benchmark run is diagnostic only; run a full clean witness before baseline approval",
        ]),
      ],
    };
  }
  const startedAt = args.startedAt ?? new Date().toISOString();
  const completedAt = new Date().toISOString();
  return {
    kind: "code-agent-benchmark-airlock",
    version: BENCHMARK_AIRLOCK_VERSION,
    mode: args.mode ?? "live",
    campaignMode,
    campaignStatus: getBenchmarkCampaignStatus(scorecard, campaignMode),
    recoveryCaseIds: unresolvedRecoveryCaseIds(),
    recoveryOnly: args.recoveryOnly === true,
    diagnosticOnly,
    targeted,
    partial: diagnosticOnly,
    baselineEligibility,
    ...(args.targetProfile ? { targetProfile: args.targetProfile } : {}),
    suiteVersion: scorecard.suiteVersion,
    ...(args.sourceRevision ? { sourceRevision: args.sourceRevision } : {}),
    runId: args.runId,
    startedAt,
    completedAt,
    targetCaseCount: cases.length,
    providerOrder: orderedProviders.map((provider) => provider.provider),
    providerHealth: safeProviderHealth,
    observations,
    ...(runtimePreflightBlockers.length > 0
      ? { preflight: { status: "blocked" as const, blockers: runtimePreflightBlockers } }
      : {}),
    ...(args.shard
      ? { shard: { ...args.shard, caseIds: cases.map((testCase) => testCase.id) } }
      : {}),
    scorecard,
    autonomousDeliveryAcceptance: buildAcceptanceSummary(observations, args.mode, args.runId),
  };
}