import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  chat,
  type ChatResult,
  type ChatMessage,
  type ExecutionProofRunner,
} from "../agents/chat-agent.js";
import { GroqClientError } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ActiveTaskExecutionPlan } from "../task-session-state.js";
import type { TurnIntent } from "../turn-intent.js";
import type { BenchmarkFixtureRepairAuthorization } from "./fixture-repair-authorization.js";
import {
  executeValidationTool,
  type ValidationRunner,
} from "../tools/execution-tools.js";
import type { ValidationResult } from "../validation-result.js";
import {
  type CodeAgentBenchmarkCase,
  type CodeAgentBenchmarkExecutor,
  type CodeAgentExecutionTelemetry,
} from "./code-agent-benchmark.js";
import {
  probeProviderHealth,
  type ProviderHealthProbeResult,
} from "./provider-health-probe.js";
import type { ProviderId } from "../provider-registry.js";
import { isCatalogFreeModelForCapability } from "../openrouter/model-resolver.js";

export type ChatCodeAgentBenchmarkExecutorOptions = {
  rootPath: string;
  projectContext: ProjectContext;
  provider: "groq" | "deepseek" | "openrouter" | "gemini";
  apiKey: string;
  model?: string;
  validationRunner: ValidationRunner;
  validationProfileForCase?: (testCase: CodeAgentBenchmarkCase) => string | undefined;
  behavioralProofForCase?: (args: {
    rootPath: string;
    testCase: CodeAgentBenchmarkCase;
    validation: ValidationResult;
    pendingChanges: readonly { path: string; newContent: string }[];
    signal?: AbortSignal;
  }) => Promise<{ status: "passed" | "failed"; code?: string; detail?: string }>;
  targetPathsForCase: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  allowedPathsForCase?: (testCase: CodeAgentBenchmarkCase) => readonly string[];
  promptForCase?: (testCase: CodeAgentBenchmarkCase) => string;
  historyForCase?: (testCase: CodeAgentBenchmarkCase) => ChatMessage[];
  caseTimeoutMs?: number;
  signal?: AbortSignal;
  /** Optional injected probe for tests; production uses probeProviderHealth. */
  providerHealthProbe?: () => Promise<ProviderHealthProbeResult>;
  /** Reuse a run-level health result so the airlock does not probe twice. */
  providerHealth?: ProviderHealthProbeResult;
  /** Hash of the immutable candidate workspace used for this benchmark case. */
  candidateHash?: string;
  /** Prepare an isolated case fixture before the model sees it. */
  prepareCase?: (testCase: CodeAgentBenchmarkCase) => Promise<void>;
  /** Server-owned contract/behavior oracle; model text is never the oracle. */
  oracleForCase?: (args: {
    rootPath: string;
    testCase: CodeAgentBenchmarkCase;
    telemetry: CodeAgentExecutionTelemetry;
    pendingChanges: readonly { path: string; newContent: string }[];
    signal?: AbortSignal;
  }) => Promise<{
    status: "passed" | "failed";
    code?: string;
    behavioralOracleStatus?: "passed" | "failed" | "not-available" | "not-run";
  }>;
  /** Benchmark fixtures may include approved test sources in their read scope. */
  includeTestSources?: boolean;
  /** Require every OpenRouter attempt to remain free and tool-capable. */
  freeOnly?: boolean;
  /**
   * Server-owned, isolated Build handoff for positive benchmark fixtures.
   * Ordinary fixture text and provider output never grant this authority.
   */
  buildHandoffForCase?: (args: {
    testCase: CodeAgentBenchmarkCase;
    prompt: string;
    targetPaths: readonly string[];
    allowedPaths: readonly string[];
  }) => {
    executionPlan: ActiveTaskExecutionPlan;
    turnIntent: TurnIntent;
    approvedValidationProfiles: readonly string[];
    message: string;
    benchmarkFixtureRepairAuthorization: BenchmarkFixtureRepairAuthorization;
  } | undefined | Promise<{
    executionPlan: ActiveTaskExecutionPlan;
    turnIntent: TurnIntent;
    approvedValidationProfiles: readonly string[];
    message: string;
    benchmarkFixtureRepairAuthorization: BenchmarkFixtureRepairAuthorization;
  } | undefined>;
};

function latestValidation(steps: readonly AgentStep[]): Extract<AgentStep, { kind: "validation" }> | undefined {
  return [...steps].reverse().find(
    (step): step is Extract<AgentStep, { kind: "validation" }> => step.kind === "validation",
  );
}

function latestRepairState(steps: readonly AgentStep[]): Extract<AgentStep, { kind: "repair_state" }> | undefined {
  return [...steps].reverse().find(
    (step): step is Extract<AgentStep, { kind: "repair_state" }> => step.kind === "repair_state",
  );
}

/** @internal — exported for deterministic benchmark adapter tests. */
export function terminalFromChatResult(result: ChatResult, steps: readonly AgentStep[]) {
  const validationPassed = latestValidation(steps)?.result.status === "passed";
  const taskResult = result.taskResult;
  if (taskResult?.kind === "REPAIR_RESULT") {
    return taskResult.readiness === "READY" && validationPassed
      ? "READY_FOR_REVIEW" as const
      : "BLOCKED" as const;
  }
  if (
    latestRepairState(steps)?.state === "READY_FOR_REVIEW" &&
    validationPassed
  ) {
    return "READY_FOR_REVIEW" as const;
  }
  // Pending changes are not review-ready evidence by themselves. A model can
  // propose a patch and stop before validation; keep that run BLOCKED instead
  // of manufacturing a successful terminal from the presence of a diff.
  return result.pendingChanges.length > 0 && validationPassed
    ? "READY_FOR_REVIEW" as const
    : "BLOCKED" as const;
}

/**
 * A benchmark behavioral oracle is a server-owned final proof gate. If it
 * rejects a review-ready patch, the observable terminal must be BLOCKED even
 * though the observation remains an F and retains the oracle failure code.
 */
export function applyBenchmarkOracleTerminalGate(
  telemetry: CodeAgentExecutionTelemetry,
  oracleStatus: "passed" | "failed",
): CodeAgentExecutionTelemetry {
  return oracleStatus === "failed" && telemetry.actualTerminal === "READY_FOR_REVIEW"
    ? { ...telemetry, actualTerminal: "BLOCKED" }
    : telemetry;
}

function telemetryFromChatResult(
  result: ChatResult,
  steps: readonly AgentStep[],
  allowedPaths: readonly string[],
  startedAt: number,
  candidateHash?: string,
): CodeAgentExecutionTelemetry {
  const validation = latestValidation(steps);
  const providerFailureDiagnostics = steps.filter(
    (step): step is Extract<AgentStep, { kind: "diagnostic" }> =>
      step.kind === "diagnostic" &&
      step.code === "EXECUTION_PROVIDER_FAILURE",
  );
  const providerUnavailable = providerFailureDiagnostics.some(
    (step) =>
      !step.details?.some((detail) =>
        /provider failure code:\s*(?:INVALID_TOOL_CALL|INVALID_PROVIDER_RESPONSE)\b/i.test(detail),
      ),
  ) || steps.some(
    (step) =>
      step.kind === "done" &&
      step.stopReason === "provider_timeout",
  );
  const readSources = new Set(
    steps.flatMap((step) =>
      step.kind === "tool_result" &&
      step.tool.startsWith("read") &&
      step.source &&
      !step.cached
        ? [step.source]
        : [],
    ),
  );
  const validationProfile = validation?.result.profile ?? "";
  const typecheckPassed = validationProfile.toLowerCase().includes("typecheck")
    ? validation?.result.status === "passed"
    : null;
  const testsPassed = validationProfile.toLowerCase().includes("test")
    ? validation?.result.status === "passed"
    : null;
  const conflict = steps.some((step) =>
    (step.kind === "diagnostic" && /CONFLICT|REBASE/i.test(step.code)) ||
    (step.kind === "execution_guard" && /CONFLICT|REBASE/i.test(step.message)),
  );
  const attemptedModels = steps
    .filter((step): step is Extract<AgentStep, { kind: "model_call" | "recovery_model_call" }> =>
      step.kind === "model_call" || step.kind === "recovery_model_call")
    .map((step) => step.model);
  const uniqueAttemptedModels = [...new Set(attemptedModels)];
  const providerModelsFree = uniqueAttemptedModels.length > 0 &&
    uniqueAttemptedModels.every((model) => isCatalogFreeModelForCapability(model, {
      capability: "tool_calling",
      requireTools: true,
    }));

  return {
    ...(candidateHash ?? validation?.result.evidence.candidateHash
      ? { candidateHash: candidateHash ?? validation?.result.evidence.candidateHash }
      : {}),
    actualTerminal: terminalFromChatResult(result, steps),
    validationStatus:
      validation?.result.status === "passed"
        ? "passed"
        : validation?.result.status === "failed"
          ? "failed"
          : validation?.result.status === "unavailable" || validation?.result.status === "blocked"
            ? "unavailable"
            : "not-run",
    changedPaths: result.pendingChanges.map((change) => change.path),
    allowedPaths: [...allowedPaths],
    filesRead: readSources.size,
    toolCalls: steps.filter((step) => step.kind === "tool_call").length,
    repairAttempts: validation?.attempt ?? 0,
    rejectedChanges: steps.filter(
      (step) => step.kind === "validation" && (step.result.status === "failed" || step.result.status === "blocked"),
    ).length,
    conflict,
    typecheckPassed,
    testsPassed,
    latencyMs: Math.round(performance.now() - startedAt),
    providerUnavailable,
    providerAttemptedModels: uniqueAttemptedModels,
    ...(uniqueAttemptedModels.at(-1) ? { providerFinalModel: uniqueAttemptedModels.at(-1) } : {}),
    ...(providerIdForTelemetry(steps) === "openrouter"
      ? { providerModelsFree, providerCapabilityValid: providerModelsFree }
      : {}),
  };
}

function providerIdForTelemetry(steps: readonly AgentStep[]): string | undefined {
  return [...steps].reverse().find(
    (step): step is Extract<AgentStep, { kind: "model_call" | "recovery_model_call" }> =>
      step.kind === "model_call" || step.kind === "recovery_model_call",
  )?.provider;
}

export function benchmarkToolFailureReason(
  step: Extract<AgentStep, { kind: "tool_result" }>,
): string | undefined {
  if (step.resultKind === "unavailable") {
    return step.resultSummary?.match(/authorization gate \(([a-z_]+)\)/)?.[1]
      ?? (
        step.resultSummary?.includes("execution, manifest, scope, and lifecycle")
          ? "invalid_lifecycle_binding"
          : "other_unavailable"
      );
  }
  if (step.resultKind !== "failed") return undefined;

  const summary = step.resultSummary?.trimStart() ?? "";
  if (/^Error: old_text was not found exactly(?: in\b|\.)/u.test(summary)) {
    return "replace_text_old_text_not_found";
  }
  if (/^Error: old_text occurs more than once\b/u.test(summary)) {
    return "replace_text_old_text_not_unique";
  }
  if (summary.includes("arguments did not match the server input contract")) {
    return "tool_arguments_contract_mismatch";
  }
  if (summary.includes("candidate change could not be staged")) {
    return "candidate_change_not_staged";
  }
  if (summary.includes("server could not record the staged candidate change")) {
    return "candidate_lifecycle_record_failed";
  }
  if (/^Error:/u.test(summary)) return "file_tool_reported_error";
  return "tool_execution_failed";
}

export function benchmarkSafeFailureSummary(
  step: Extract<AgentStep, { kind: "tool_result" }>,
): string {
  const summary = step.resultSummary?.trim();
  if (!summary) return "missing";
  return summary
    .replace(/"[^"]*"/gu, '"[redacted]"')
    .replace(/(?:[a-z]:)?(?:\/[^\s"'`]+)+/giu, "<path>")
    .slice(0, 160);
}

export function benchmarkWritePathTrace(
  value: string | undefined,
  approvedPaths: readonly string[],
  rootPath?: string,
): { approved: boolean; shape: string } {
  if (!value?.trim()) return { approved: false, shape: "missing" };
  const normalized = value.replaceAll("\\", "/");
  const authorizationValue = normalized.replace(/^(\.\/)+/, "");
  if (/^(?:\/|[a-z]:\/)/i.test(normalized)) {
    if (rootPath && isAbsolute(normalized)) {
      const fromRoot = relative(resolve(rootPath), resolve(normalized));
      if (
        fromRoot &&
        fromRoot !== ".." &&
        !fromRoot.startsWith(`..${sep}`) &&
        !isAbsolute(fromRoot)
      ) {
        const relativePath = fromRoot
          .split(sep)
          .filter((segment) => segment && segment !== ".")
          .join("/");
        return {
          approved: approvedPaths.includes(relativePath),
          shape: "absolute_in_root",
        };
      }
    }
    return { approved: false, shape: "absolute" };
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) return { approved: false, shape: "parent_segment" };
  if (segments.includes(".") || normalized.includes("//")) {
    return {
      approved: approvedPaths.includes(authorizationValue),
      shape: "noncanonical_relative",
    };
  }
  if (normalized !== normalized.trim() && approvedPaths.includes(normalized.trim())) {
    return { approved: false, shape: "relative_whitespace" };
  }
  if (approvedPaths.some((path) => path.endsWith(`/${authorizationValue}`))) {
    return { approved: false, shape: "relative_approved_suffix" };
  }
  if (approvedPaths.some((path) => authorizationValue.endsWith(`/${path}`))) {
    return { approved: false, shape: "relative_extra_prefix" };
  }
  return {
    approved: approvedPaths.includes(authorizationValue),
    shape: approvedPaths.includes(authorizationValue) ? "relative" : "relative_other",
  };
}

/**
 * Build a real executor for runCodeAgentBenchmark().
 *
 * The returned adapter keeps raw chat output and step details local to a case.
 * Only CodeAgentExecutionTelemetry leaves the adapter, so benchmark artifacts
 * cannot accidentally persist provider responses or source bodies.
 */
export function createChatCodeAgentBenchmarkExecutor(
  opts: ChatCodeAgentBenchmarkExecutorOptions,
): CodeAgentBenchmarkExecutor {
  let providerHealthPromise: Promise<ProviderHealthProbeResult> | undefined;
  const getProviderHealth = (): Promise<ProviderHealthProbeResult> => {
    providerHealthPromise ??= Promise.resolve(
      opts.providerHealth ??
      opts.providerHealthProbe?.() ??
      probeProviderHealth({
        provider: opts.provider as ProviderId,
        apiKey: opts.apiKey,
        model: opts.model,
        signal: opts.signal,
      }),
    );
    return providerHealthPromise;
  };

  return async (testCase) => {
    const steps: AgentStep[] = [];
    const startedAt = performance.now();
    const providerHealth = await getProviderHealth();
    if (providerHealth.status !== "usable") {
      return {
        ...(opts.candidateHash ? { candidateHash: opts.candidateHash } : {}),
        actualTerminal: "BLOCKED",
        validationStatus: "unavailable",
        changedPaths: [],
        allowedPaths: [...(opts.allowedPathsForCase?.(testCase) ?? opts.targetPathsForCase(testCase))],
        filesRead: 0,
        toolCalls: 0,
        repairAttempts: 0,
        rejectedChanges: 0,
        conflict: false,
        typecheckPassed: null,
        testsPassed: null,
        latencyMs: Math.round(performance.now() - startedAt),
        providerUnavailable: true,
        ...(providerHealth.rateLimitScope
          ? { providerRateLimitScope: providerHealth.rateLimitScope }
          : {}),
        ...(providerHealth.upstreamProvider
          ? { providerUpstreamProvider: providerHealth.upstreamProvider }
          : {}),
      };
    }
    await opts.prepareCase?.(testCase);
    const targetPaths = [...opts.targetPathsForCase(testCase)];
    const allowedPaths = [...(opts.allowedPathsForCase?.(testCase) ?? targetPaths)];
    const timeoutController = new AbortController();
    let caseTimedOut = false;
    let rejectCaseDeadline: (reason?: unknown) => void = () => {};
    const caseDeadline = new Promise<never>((_resolve, reject) => {
      rejectCaseDeadline = reject;
    });
    const deadlineAt = opts.caseTimeoutMs && opts.caseTimeoutMs > 0
      ? performance.now() + opts.caseTimeoutMs
      : undefined;
    const timeoutHandle = opts.caseTimeoutMs && opts.caseTimeoutMs > 0
      ? setTimeout(() => {
          caseTimedOut = true;
          rejectCaseDeadline(new Error("Benchmark case timed out."));
          timeoutController.abort();
        }, opts.caseTimeoutMs)
      : undefined;
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutController.signal])
      : timeoutController.signal;
    const awaitWithinCaseDeadline = <T>(operation: PromiseLike<T> | T): Promise<T> =>
      deadlineAt === undefined
        ? Promise.resolve(operation)
        : Promise.race([Promise.resolve(operation), caseDeadline]);
    const assertCaseNotTimedOut = (): void => {
      if (
        caseTimedOut ||
        (deadlineAt !== undefined && performance.now() >= deadlineAt)
      ) {
        caseTimedOut = true;
        if (!timeoutController.signal.aborted) timeoutController.abort();
        throw new Error("Benchmark case timed out.");
      }
    };

    try {
      const prompt = opts.promptForCase?.(testCase) ?? testCase.prompt;
      const buildHandoff = await awaitWithinCaseDeadline(
        opts.buildHandoffForCase?.({
          testCase,
          prompt,
          targetPaths,
          allowedPaths,
        }),
      );
      assertCaseNotTimedOut();
      if (buildHandoff) {
        const plan = buildHandoff.executionPlan;
        const authorizedPaths = [...new Set(allowedPaths)];
        const plannedPaths = [...new Set(plan.boundaries.allowedWriteFiles)];
        if (
          testCase.expected.terminal !== "READY_FOR_REVIEW" ||
          plan.readiness !== "READY" ||
          plan.nodes.length === 0 ||
          plan.boundaries.rootPath !== opts.rootPath ||
          authorizedPaths.length === 0 ||
          plannedPaths.length !== plan.boundaries.allowedWriteFiles.length ||
          authorizedPaths.length !== plannedPaths.length ||
          authorizedPaths.some((path) => !plannedPaths.includes(path)) ||
          buildHandoff.turnIntent.kind !== "DELIVERY" ||
          buildHandoff.approvedValidationProfiles.length === 0 ||
          buildHandoff.benchmarkFixtureRepairAuthorization.caseId !== testCase.id ||
          typeof buildHandoff.benchmarkFixtureRepairAuthorization.authorize !== "function"
        ) {
          throw new Error("Benchmark Build handoff does not match the isolated case scope.");
        }
      }
      // Benchmark-local observation only; this is not durable acceptance proof.
      const benchmarkToolLifecycleEvents: unknown[] = [];
      const result = await awaitWithinCaseDeadline(chat({
        message: buildHandoff?.message ?? prompt,
        history: opts.historyForCase?.(testCase) ?? [],
        projectContext: opts.projectContext,
        rootPath: opts.rootPath,
        ...(buildHandoff
          ? {
              projectId: buildHandoff.executionPlan.boundaries.projectId,
              buildHandoff: true,
              approvalState: "APPROVED" as const,
              approvedFilePaths: allowedPaths,
              approvedValidationProfiles: [...buildHandoff.approvedValidationProfiles],
              executionPlanOverride: buildHandoff.executionPlan,
              turnIntent: buildHandoff.turnIntent,
              benchmarkFixtureRepairAuthorization:
                buildHandoff.benchmarkFixtureRepairAuthorization,
            }
          : {}),
        provider: opts.provider,
        apiKey: opts.apiKey,
        model: opts.model,
        onToolInvocation: (event) => {
          benchmarkToolLifecycleEvents.push(event);
        },
        includeTestSourcesOverride: opts.includeTestSources,
        signal,
        assertExecutionOwned: assertCaseNotTimedOut,
        allowValidationTools: true,
        validationRunner: opts.validationRunner,
        validationTargetPaths: buildHandoff ? allowedPaths : targetPaths,
        executionProofRunner: opts.behavioralProofForCase
          ? (async ({ nodeId, validation, pendingChanges, signal: proofSignal }) => {
              const proof = await opts.behavioralProofForCase!({
                rootPath: opts.rootPath,
                testCase,
                validation,
                pendingChanges,
                signal: proofSignal ?? signal,
              });
              return {
                ...proof,
                detail: proof.detail ?? `proof node=${nodeId}`,
              };
            }) satisfies ExecutionProofRunner
          : undefined,
        onStep: (step) => steps.push(step),
      }));
      assertCaseNotTimedOut();

      const validationProfile = opts.validationProfileForCase?.(testCase);
      if (
        result.pendingChanges.length > 0 &&
        validationProfile &&
        latestValidation(steps)?.result.status !== "passed"
      ) {
        try {
          const output = await awaitWithinCaseDeadline(executeValidationTool(
            "run_validation",
            { profile: validationProfile },
            targetPaths,
            opts.validationRunner,
            signal,
            result.pendingChanges,
          ));
          const parsed = JSON.parse(output) as Partial<ValidationResult>;
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.profile === "string" &&
            typeof parsed.status === "string" &&
            parsed.evidence &&
            typeof parsed.evidence.evidenceId === "string"
          ) {
            const finalValidation = parsed as ValidationResult;
            const attempt = (latestValidation(steps)?.attempt ?? 0) + 1;
            steps.push({
              kind: "validation",
              result: finalValidation,
              repairState: finalValidation.status === "passed"
                ? "READY_FOR_REVIEW"
                : "BLOCKED",
              attempt,
              maxAttempts: attempt,
              status: finalValidation.status,
              profile: finalValidation.profile,
              scenario: finalValidation.scenario,
              command: finalValidation.command,
              exitCode: finalValidation.exitCode,
              failedTests: finalValidation.failedTests.map((failure) => failure.name || failure.message),
              affectedFiles: finalValidation.changedFiles,
              failedTestDetails: finalValidation.failedTests,
              changedFiles: finalValidation.changedFiles,
              detail: finalValidation.detail,
            });
          }
        } catch {
          // The existing fail-closed telemetry path remains authoritative when
          // the final server-owned validation cannot be normalized.
        }
      }
      assertCaseNotTimedOut();

      if (process.env.BENCHMARK_DEBUG_TOOL_TRACE === "1") {
        console.warn(JSON.stringify({
          scope: "benchmark-tool-trace",
          caseId: testCase.id,
          steps: steps.map((step) => ({
            kind: step.kind,
            ...(step.kind === "tool_call" || step.kind === "tool_result"
              ? { tool: step.tool }
              : {}),
            ...(step.kind === "tool_call" &&
              (step.tool === "replace_text" || step.tool === "write_file")
              ? { pathTrace: benchmarkWritePathTrace(step.args.path, allowedPaths, opts.rootPath) }
              : {}),
            ...(step.kind === "tool_result" && benchmarkToolFailureReason(step)
              ? { failureReason: benchmarkToolFailureReason(step) }
              : {}),
            ...(step.kind === "tool_result" &&
              (step.resultKind === "failed" || step.resultKind === "unavailable")
              ? { failureSummary: benchmarkSafeFailureSummary(step) }
              : {}),
            ...(step.kind === "diagnostic" ? { code: step.code } : {}),
            ...(step.kind === "validation"
              ? {
                  profile: step.result.profile,
                  status: step.result.status,
                  ...(step.result.status === "failed"
                    ? {
                        failureKind: step.result.failureKind ?? "unspecified",
                        exitCode: step.result.exitCode,
                        failedTestCount: step.result.failedTests.length,
                        failedTestNames: step.result.failedTests
                          .slice(0, 5)
                          .map((failure) => failure.name
                            .replace(/(?:[a-z]:)?(?:\/[^\s"'`]+)+/giu, "<path>")
                            .slice(0, 120)),
                      }
                    : {}),
                }
              : {}),
          })),
        }));
      }

       let telemetry = telemetryFromChatResult(
        result,
        steps,
        allowedPaths,
        startedAt,
        opts.candidateHash,
      );
      if (telemetry.providerUnavailable) return telemetry;
      if (opts.freeOnly && opts.provider === "openrouter" &&
        (telemetry.providerModelsFree !== true || telemetry.providerCapabilityValid !== true)) {
        telemetry = { ...telemetry, actualTerminal: "BLOCKED", providerCapabilityValid: false };
      }
      const oracle = await awaitWithinCaseDeadline(opts.oracleForCase?.({
        rootPath: opts.rootPath,
        testCase,
        telemetry,
        pendingChanges: result.pendingChanges,
        signal,
      }));
      assertCaseNotTimedOut();
      return oracle
        ? {
            ...applyBenchmarkOracleTerminalGate(telemetry, oracle.status),
            oracleStatus: oracle.status,
            ...(oracle.code ? { oracleCode: oracle.code } : {}),
            ...(oracle.behavioralOracleStatus
              ? { behavioralOracleStatus: oracle.behavioralOracleStatus }
              : {}),
          }
        : telemetry;
    } catch (error) {
      const providerUnavailable =
        caseTimedOut ||
        error instanceof GroqClientError;
      return {
        ...(opts.candidateHash ? { candidateHash: opts.candidateHash } : {}),
        actualTerminal: "BLOCKED",
        validationStatus: "unavailable",
        changedPaths: [],
        allowedPaths,
        filesRead: new Set(
          steps.flatMap((step) =>
            step.kind === "tool_result" &&
            step.tool.startsWith("read") &&
            step.source &&
            !step.cached
              ? [step.source]
              : [],
          ),
        ).size,
        toolCalls: steps.filter((step) => step.kind === "tool_call").length,
        repairAttempts: latestValidation(steps)?.attempt ?? 0,
        rejectedChanges: steps.filter(
          (step) => step.kind === "validation" && (step.result.status === "failed" || step.result.status === "blocked"),
        ).length,
        conflict: steps.some((step) =>
          (step.kind === "diagnostic" && /CONFLICT|REBASE/i.test(step.code)) ||
          (step.kind === "execution_guard" && /CONFLICT|REBASE/i.test(step.message)),
        ),
        typecheckPassed: null,
        testsPassed: null,
        latencyMs: Math.round(performance.now() - startedAt),
         ...(providerUnavailable ? { providerUnavailable: true } : { executorFailed: true }),
         ...(error instanceof GroqClientError && error.rateLimitScope
           ? { providerRateLimitScope: error.rateLimitScope }
           : {}),
         ...(error instanceof GroqClientError && error.upstreamProvider
           ? { providerUpstreamProvider: error.upstreamProvider }
           : {}),
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
}
