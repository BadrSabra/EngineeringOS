import { describe, expect, it, vi } from "vitest";
import type { RawGroqResponse } from "../provider-strategy.js";
import type { ProviderStrategy } from "../provider-strategy.js";
import {
  PROBE_TOOL_NAME,
  probeProviderHealth,
} from "./provider-health-probe.js";
import {
  createChatCodeAgentBenchmarkExecutor,
} from "./live-code-agent-benchmark.js";

function response(toolCalls: RawGroqResponse["toolCalls"]): RawGroqResponse {
  return {
    content: null,
    toolCalls,
    model: "test-model",
    usage: { promptTokens: 10, completionTokens: 5 },
  };
}

function strategyReturning(result: RawGroqResponse): ProviderStrategy {
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    async call() {
      return result;
    },
    async *stream() {
      yield "";
    },
  };
}

describe("providerHealthProbe", () => {
  it("accepts the exact required tool call and structured arguments", async () => {
    const result = await probeProviderHealth({
      provider: "openrouter",
      strategy: strategyReturning(response([{
        id: "probe-1",
        type: "function",
        function: { name: PROBE_TOOL_NAME, arguments: '{"probe":"ok"}' },
      }])),
    });

    expect(result).toMatchObject({
      status: "usable",
      providerUnavailable: false,
      toolCalling: true,
      structuredArguments: true,
      model: "test-model",
    });
  });

  it("classifies malformed tool arguments as provider unavailable", async () => {
    const result = await probeProviderHealth({
      provider: "openrouter",
      strategy: strategyReturning(response([{
        id: "probe-1",
        type: "function",
        function: { name: PROBE_TOOL_NAME, arguments: '{"probe":"wrong"}' },
      }])),
    });

    expect(result.status).toBe("unavailable");
    expect(result.providerUnavailable).toBe(true);
    expect(result.failureCode).toBe("MALFORMED_TOOL_ARGUMENTS");
  });

  it("classifies transport errors as U without leaking raw provider content", async () => {
    const strategy: ProviderStrategy = {
      ...strategyReturning(response(null)),
      async call() {
        throw new Error("429 provider quota exhausted with private response body");
      },
    };

    const result = await probeProviderHealth({
      provider: "openrouter",
      strategy,
    });

    expect(result.status).toBe("unavailable");
    expect(result.failureCode).toBe("NETWORK_ERROR");
    expect(result.failureReason).toBe("Provider probe failed before a capability response.");
    expect(result.failureReason).not.toContain("private response body");
  });
});

describe("createChatCodeAgentBenchmarkExecutor health gate", () => {
  it("probes once and skips chat for every case while the provider is U", async () => {
    const providerHealthProbe = vi.fn(async () => ({
      provider: "openrouter" as const,
      model: "test-model",
      status: "unavailable" as const,
      providerUnavailable: true,
      toolCalling: false,
      structuredArguments: false,
      latencyMs: 5,
      failureCode: "RATE_LIMITED" as const,
      failureReason: "rate limited",
    }));
    const executor = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/benchmark",
      projectContext: {} as never,
      provider: "openrouter",
      apiKey: "test-key",
      validationRunner: vi.fn() as never,
      targetPathsForCase: () => ["src/example.ts"],
      providerHealthProbe,
    });

    const first = await executor({
      id: "case-1",
      title: "case",
      category: "single-file-edit",
      projectShape: "single-file",
      prompt: "change one file",
      expected: {
        terminal: "READY_FOR_REVIEW",
        validation: "tests",
        maxRepairAttempts: 3,
        filesMustRemainScoped: true,
        approvalRequired: true,
      },
    });
    const second = await executor({
      id: "case-2",
      title: "case",
      category: "single-file-edit",
      projectShape: "single-file",
      prompt: "change one file",
      expected: {
        terminal: "READY_FOR_REVIEW",
        validation: "tests",
        maxRepairAttempts: 3,
        filesMustRemainScoped: true,
        approvalRequired: true,
      },
    });

    expect(providerHealthProbe).toHaveBeenCalledTimes(1);
    expect(first.providerUnavailable).toBe(true);
    expect(second.providerUnavailable).toBe(true);
  });
});