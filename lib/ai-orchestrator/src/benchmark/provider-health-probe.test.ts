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
import { GroqClientError } from "../errors.js";

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
    expect(result.report).toMatchObject({
      kind: "provider-health-report",
      status: "usable",
      evidenceStatus: "complete",
      failureCategory: null,
      recoveryAction: null,
      attemptCount: 1,
      attemptedModels: ["test-model"],
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
    expect(result.report).toMatchObject({
      evidenceStatus: "incomplete",
      failureCategory: "capability",
      recoveryAction: "stop-safely",
      attemptCount: 1,
    });
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
    expect(result.report).toMatchObject({
      provider: "openrouter",
      model: null,
      evidenceStatus: "incomplete",
      failureCategory: "network",
      recoveryAction: "retry",
      attemptCount: 1,
      attemptedModels: [],
    });
  });

  it("summarizes quota recovery without exposing provider messages or credentials", async () => {
    const secret = "sk-or-v1-health-secret";
    const strategy: ProviderStrategy = {
      ...strategyReturning(response(null)),
      async call() {
        throw new GroqClientError("QUOTA", `quota body ${secret}`, {
          context: {
            providerName: "OpenRouter",
            providerModel: "model-without-secret",
            providerMessage: `raw provider message ${secret}`,
            providerAttemptedModels: [
              "first-model:free",
              `second-model?token=${secret}`,
              ...Array.from({ length: 10 }, (_, index) => `extra-${index}:free`),
            ],
          },
        });
      },
    };

    const result = await probeProviderHealth({ provider: "openrouter", strategy });

    expect(result.report).toMatchObject({
      failureCategory: "quota",
      recoveryAction: "stop-safely",
      evidenceStatus: "incomplete",
      attemptCount: 8,
    });
    expect(result.report?.attemptedModels).toHaveLength(8);
    expect(JSON.stringify(result.report)).not.toContain(secret);
    expect(JSON.stringify(result.report)).not.toContain("raw provider message");
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