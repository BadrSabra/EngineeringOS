import {
  chat,
  type ChatResult,
  type ChatMessage,
  type ExecutionProofRunner,
} from "../agents/chat-agent.js";
import { GroqClientError } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
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
): CodeAgentExecutionTelemetry {
  const validation = latestValidation(steps);
  const providerUnavailable = steps.some(
    (step) =>
      step.kind === "diagnostic" &&
      step.code === "EXECUTION_PROVIDER_FAILURE",
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

  return {
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
      };
    }
    await opts.prepareCase?.(testCase);
    const targetPaths = [...opts.targetPathsForCase(testCase)];
    const allowedPaths = [...(opts.allowedPathsForCase?.(testCase) ?? targetPaths)];
    const timeoutController = new AbortController();
    let caseTimedOut = false;
    const timeoutHandle = opts.caseTimeoutMs && opts.caseTimeoutMs > 0
      ? setTimeout(() => {
          caseTimedOut = true;
          timeoutController.abort();
        }, opts.caseTimeoutMs)
      : undefined;
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const result = await chat({
        message: opts.promptForCase?.(testCase) ?? testCase.prompt,
        history: opts.historyForCase?.(testCase) ?? [],
        projectContext: opts.projectContext,
        rootPath: opts.rootPath,
        provider: opts.provider,
        apiKey: opts.apiKey,
        model: opts.model,
        includeTestSourcesOverride: opts.includeTestSources,
        signal,
        allowValidationTools: true,
        validationRunner: opts.validationRunner,
        validationTargetPaths: targetPaths,
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
      });

      const validationProfile = opts.validationProfileForCase?.(testCase);
      if (
        result.pendingChanges.length > 0 &&
        validationProfile &&
        latestValidation(steps)?.result.status !== "passed"
      ) {
        try {
          const output = await executeValidationTool(
            "run_validation",
            { profile: validationProfile },
            targetPaths,
            opts.validationRunner,
            signal,
            result.pendingChanges,
          );
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

      const telemetry = telemetryFromChatResult(
        result,
        steps,
        allowedPaths,
        startedAt,
      );
      const oracle = await opts.oracleForCase?.({
        rootPath: opts.rootPath,
        testCase,
        telemetry,
        pendingChanges: result.pendingChanges,
        signal,
      });
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
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
}
