import { GroqClientError, type GroqErrorCode } from "../errors.js";
import { getStrategy, type ProviderId } from "../provider-registry.js";
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
};

export type ProviderHealthProbeOptions = {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test seam; production uses the registered provider strategy. */
  strategy?: ProviderStrategy;
};

function unavailableResult(
  options: ProviderHealthProbeOptions,
  startedAt: number,
  fields: Pick<ProviderHealthProbeResult, "model" | "failureCode" | "failureReason">,
): ProviderHealthProbeResult {
  return {
    provider: options.provider,
    status: "unavailable",
    providerUnavailable: true,
    toolCalling: false,
    structuredArguments: false,
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...fields,
    model: fields.model ?? options.model ?? null,
  };
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
    model: response.model ?? options.model ?? null,
    status: "usable",
    providerUnavailable: false,
    toolCalling: true,
    structuredArguments: true,
    latencyMs: Math.max(0, Date.now() - startedAt),
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
      ? { quality: "fast" as const, capability: "tool_calling" as const, maxFallbackModels: 4 }
      : {}),
  };

  try {
    return parseProbeArguments(await strategy.call(messages, callOptions), options, startedAt);
  } catch (error) {
    const isProviderError = error instanceof GroqClientError;
    return unavailableResult(options, startedAt, {
      model: options.model ?? null,
      failureCode: isProviderError ? error.code : "NETWORK_ERROR",
      failureReason: isProviderError
        ? `Provider probe failed with ${error.code}.`
        : "Provider probe failed before a capability response.",
    });
  }
}

export { PROBE_TOOL_NAME };