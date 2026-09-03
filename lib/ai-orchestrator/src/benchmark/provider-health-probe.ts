import { GroqClientError, redactProviderErrorText, type GroqErrorCode } from "../errors.js";
import { getStrategy, type ProviderId } from "../provider-registry.js";
import type { OpenRouterFailureAction } from "../openai-compatible-client.js";
import type {
  ProviderStrategy,
  RawGroqResponse,
  RawMessage,
  StrategyCallOptions,
  ToolDefinition,
} from "../provider-strategy.js";

const PROBE_TOOL_NAME = "benchmark_health_probe";
const PROBE_TIMEOUT_MS = 15_000;

const PROBE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: PROBE_TOOL_NAME,
    description: "Return the exact probe marker to confirm tool calling and JSON arguments.",
    parameters: {
      type: "object",
      properties: {
        probe: { type: "string", enum: ["ok"] },
      },
      required: ["probe"],
      additionalProperties: false,
    },
  },
};

export type ProviderHealthStatus = "usable" | "unavailable";
export type ProviderHealthFailureCode =
  | GroqErrorCode
  | "TOOL_CALL_UNSUPPORTED"
  | "MALFORMED_TOOL_ARGUMENTS"
  | "UNEXPECTED_TOOL_CALL";

export type ProviderHealthFailureCategory =
  | "authentication"
  | "quota"
  | "rate-limit"
  | "catalog"
  | "empty-response"
  | "network"
  | "server"
  | "request"
  | "capability"
  | "unknown";

export type ProviderHealthReport = {
  kind: "provider-health-report";
  version: 1;
  provider: ProviderId;
  model: string | null;
  status: ProviderHealthStatus;
  evidenceStatus: "complete" | "incomplete";
  failureCategory: ProviderHealthFailureCategory | null;
  recoveryAction: OpenRouterFailureAction | null;
  attemptCount: number;
  attemptedModels: string[];
};

export type ProviderHealthProbeResult = {
  provider: ProviderId;
  model: string | null;
  status: ProviderHealthStatus;
  providerUnavailable: boolean;
  toolCalling: boolean;
  structuredArguments: boolean;
  latencyMs: number;
  failureCode?: ProviderHealthFailureCode;
  failureReason?: string;
  /** Bounded operator-facing summary; it intentionally excludes provider text. */
  report?: ProviderHealthReport;
};

export type ProviderHealthProbeOptions = {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  /**
   * Cap provider-owned fallback candidates for this probe. OpenRouter keeps
   * its historical bounded fallback by default; callers that own candidate
   * iteration (such as the live smoke) set this to 1.
   */
  maxFallbackModels?: number;
  signal?: AbortSignal;
  /** Test seam; production uses the registered provider strategy. */
  strategy?: ProviderStrategy;
};

const SAFE_FAILURE_CODES = new Set<ProviderHealthFailureCode>([
  "AUTH_ERROR",
  "QUOTA",
  "RATE_LIMITED",
  "MODEL_NOT_FOUND",
  "MODEL_UNAVAILABLE",
  "PLAN_RESTRICTED",
  "EMPTY_RESPONSE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SERVER_ERROR",
  "NON_200",
  "INVALID_CONFIG",
  "TOOL_CALL_UNSUPPORTED",
  "MALFORMED_TOOL_ARGUMENTS",
  "UNEXPECTED_TOOL_CALL",
]);

function safeProviderModel(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = redactProviderErrorText(value).trim().slice(0, 200);
  // Model IDs are useful benchmark metadata, but a provider response is not
  // allowed to turn this field into an arbitrary diagnostic channel.
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(candidate) ? candidate : null;
}

function safeFailureCode(code: ProviderHealthFailureCode | undefined): ProviderHealthFailureCode | undefined {
  return code && SAFE_FAILURE_CODES.has(code) ? code : "NETWORK_ERROR";
}

function safeFailureReason(code: ProviderHealthFailureCode | undefined): string {
  return `Provider health check failed (${safeFailureCode(code) ?? "UNKNOWN"}).`;
}

/**
 * Project a health result before it crosses a persistence, callback, or
 * reporting boundary. Provider-owned reason text is useful in server logs but
 * is not safe benchmark evidence.
 */
export function projectSafeProviderHealth(
  result: ProviderHealthProbeResult,
): ProviderHealthProbeResult {
  const failureCode = safeFailureCode(result.failureCode);
  const model = safeProviderModel(result.model);
  const report = result.report
    ? {
        ...result.report,
        model: safeProviderModel(result.report.model),
        attemptedModels: result.report.attemptedModels
          .map((attemptedModel) => safeProviderModel(attemptedModel))
          .filter((attemptedModel): attemptedModel is string => attemptedModel !== null)
          .slice(0, 8),
      }
    : undefined;
  return {
    ...result,
    model,
    ...(failureCode ? { failureCode } : {}),
    ...(result.status === "unavailable"
      ? { failureReason: safeFailureReason(failureCode) }
      : { failureReason: undefined }),
    ...(report ? { report } : {}),
  };
}

function unavailableResult(
  options: ProviderHealthProbeOptions,
  startedAt: number,
  fields: Pick<ProviderHealthProbeResult, "model" | "failureCode" | "failureReason">,
): ProviderHealthProbeResult {
  const model = safeProviderModel(fields.model ?? options.model);
  const attemptedModels = model ? [model] : [];
  const failureCategory = failureCategoryFor(fields.failureCode);
  const recoveryAction = recoveryActionFor(fields.failureCode);
  return {
    provider: options.provider,
    status: "unavailable",
    providerUnavailable: true,
    toolCalling: false,
    structuredArguments: false,
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...(fields.failureCode ? { failureCode: safeFailureCode(fields.failureCode) } : {}),
    failureReason: safeFailureReason(fields.failureCode),
    model,
    report: {
      kind: "provider-health-report",
      version: 1,
      provider: options.provider,
      model,
      status: "unavailable",
      evidenceStatus: "incomplete",
      failureCategory,
      recoveryAction,
      attemptCount: 1,
      attemptedModels,
    },
  };
}

function failureCategoryFor(code?: ProviderHealthFailureCode): ProviderHealthFailureCategory {
  switch (code) {
    case "AUTH_ERROR":
      return "authentication";
    case "QUOTA":
      return "quota";
    case "RATE_LIMITED":
      return "rate-limit";
    case "MODEL_NOT_FOUND":
    case "MODEL_UNAVAILABLE":
    case "PLAN_RESTRICTED":
      return "catalog";
    case "EMPTY_RESPONSE":
      return "empty-response";
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return "network";
    case "SERVER_ERROR":
      return "server";
    case "NON_200":
    case "INVALID_CONFIG":
      return "request";
    case "TOOL_CALL_UNSUPPORTED":
    case "MALFORMED_TOOL_ARGUMENTS":
    case "UNEXPECTED_TOOL_CALL":
      return "capability";
    default:
      return "unknown";
  }
}

function recoveryActionFor(code?: ProviderHealthFailureCode): OpenRouterFailureAction {
  if (
    code === "AUTH_ERROR" ||
    code === "QUOTA" ||
    code === "INVALID_CONFIG"
  ) return "stop-safely";
  if (code === "RATE_LIMITED") return "wait";
  if (code === "NETWORK_ERROR" || code === "TIMEOUT" || code === "SERVER_ERROR") return "retry";
  if (code === "MODEL_NOT_FOUND" || code === "MODEL_UNAVAILABLE" || code === "PLAN_RESTRICTED" || code === "EMPTY_RESPONSE") {
    return "choose-alternative";
  }
  if (code === "NON_200") return "narrow-request";
  return "stop-safely";
}

function parseProbeArguments(
  response: RawGroqResponse,
  options: ProviderHealthProbeOptions,
  startedAt: number,
): ProviderHealthProbeResult {
  const toolCalls = response.toolCalls ?? [];
  if (toolCalls.length === 0) {
    return unavailableResult(options, startedAt, {
      model: response.model,
      failureCode: "TOOL_CALL_UNSUPPORTED",
      failureReason: "The provider returned no tool call for a required probe.",
    });
  }
  if (toolCalls.length !== 1 || toolCalls[0]?.function.name !== PROBE_TOOL_NAME) {
    return unavailableResult(options, startedAt, {
      model: response.model,
      failureCode: "UNEXPECTED_TOOL_CALL",
      failureReason: "The provider returned an unexpected tool call for the probe.",
    });
  }

  try {
    const parsed: unknown = JSON.parse(toolCalls[0].function.arguments);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { probe?: unknown }).probe !== "ok"
    ) {
      return unavailableResult(options, startedAt, {
        model: response.model,
        failureCode: "MALFORMED_TOOL_ARGUMENTS",
        failureReason: "The provider returned tool arguments without the required probe marker.",
      });
    }
  } catch {
    return unavailableResult(options, startedAt, {
      model: response.model,
      failureCode: "MALFORMED_TOOL_ARGUMENTS",
      failureReason: "The provider returned malformed JSON tool arguments.",
    });
  }

  return {
    provider: options.provider,
    model: safeProviderModel(response.model ?? options.model),
    status: "usable",
    providerUnavailable: false,
    toolCalling: true,
    structuredArguments: true,
    latencyMs: Math.max(0, Date.now() - startedAt),
    report: {
      kind: "provider-health-report",
      version: 1,
      provider: options.provider,
      model: safeProviderModel(response.model ?? options.model),
      status: "usable",
      evidenceStatus: "complete",
      failureCategory: null,
      recoveryAction: null,
      attemptCount: 1,
      attemptedModels: safeProviderModel(response.model ?? options.model)
        ? [safeProviderModel(response.model ?? options.model)!]
        : [],
    },
  };
}

/**
 * Checks the exact capability needed by the engineering benchmark without
 * consuming a benchmark case. No tool is executed; the probe only validates
 * that the model emits the expected function call and JSON arguments.
 */
export async function probeProviderHealth(
  options: ProviderHealthProbeOptions,
): Promise<ProviderHealthProbeResult> {
  const startedAt = Date.now();
  const strategy = options.strategy ?? getStrategy(options.provider);
  const messages: RawMessage[] = [
    {
      role: "system",
      content: "You are a benchmark capability probe. Do not explain anything. Call the required tool exactly once.",
    },
    {
      role: "user",
      content: "Call benchmark_health_probe with the exact JSON argument {\"probe\":\"ok\"}.",
    },
  ];
  const callOptions: StrategyCallOptions = {
    model: options.model,
    apiKey: options.apiKey,
    maxTokens: 64,
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
    retryTransient: false,
    toolChoice: "required",
    tools: [PROBE_TOOL],
    signal: options.signal,
    ...(options.provider === "openrouter"
      ? {
          quality: "fast" as const,
          capability: "tool_calling" as const,
          maxFallbackModels:
            Number.isInteger(options.maxFallbackModels) && options.maxFallbackModels! > 0
              ? options.maxFallbackModels
              : 4,
        }
      : {}),
  };

  try {
    return parseProbeArguments(await strategy.call(messages, callOptions), options, startedAt);
  } catch (error) {
    const isProviderError = error instanceof GroqClientError;
    const attemptedModels = isProviderError
      ? error.providerAttemptedModels
      : undefined;
    const result = unavailableResult(options, startedAt, {
      model: isProviderError ? error.providerModel ?? options.model ?? null : options.model ?? null,
      failureCode: isProviderError ? error.code : "NETWORK_ERROR",
      failureReason: isProviderError
        ? `Provider probe failed with ${error.code}.`
        : "Provider probe failed before a capability response.",
    });
    if (attemptedModels?.length) {
      const safeModels = attemptedModels
        .slice(0, 8)
        .map((model) => safeProviderModel(model))
        .filter((model): model is string => model !== null);
      if (result.report) {
        result.report.attemptedModels = safeModels;
        result.report.attemptCount = safeModels.length;
      }
    }
    return projectSafeProviderHealth(result);
  }
}

export { PROBE_TOOL_NAME };