import { describe, expect, it, vi } from "vitest";
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock("../agents/chat-agent.js", () => ({ chat: chatMock }));

import {
  applyBenchmarkOracleTerminalGate,
  benchmarkSafeFailureSummary,
  benchmarkToolFailureReason,
  benchmarkWritePathTrace,
  createChatCodeAgentBenchmarkExecutor,
  terminalFromChatResult,
} from "./live-code-agent-benchmark.js";
import type { CodeAgentExecutionTelemetry } from "./code-agent-benchmark.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ChatResult } from "../agents/chat-agent.js";
import type { ProjectContext } from "../context-builder.js";
import type { ProviderHealthProbeResult } from "./provider-health-probe.js";
import { buildActiveTaskExecutionPlan } from "../task-session-state.js";
import { resolveTurnIntent } from "../turn-intent.js";
import { getCodeAgentBenchmarkCases } from "./code-agent-benchmark.js";
import { getCodeAgentBenchmarkFixture } from "./code-agent-benchmark-fixtures.js";

const pendingResult = {
  pendingChanges: [{ path: "src/example.ts", newContent: "updated" }],
} as unknown as ChatResult;

function validationStep(status: "passed" | "failed"): AgentStep {
  return {
    kind: "validation",
    result: {
      profile: "tests",
      status,
      scenario: "fixture",
      exitCode: status === "passed" ? 0 : 1,
      command: "pnpm test",
      stdout: "",
      stderr: "",
      failedTests: [],
      changedFiles: [],
      evidence: {
        evidenceId: "validation-test",
        observedAt: "2026-08-19T00:00:00.000Z",
        artifactRef: "validation-test",
      },
    },
    repairState: status === "passed" ? "READY_FOR_REVIEW" : "BLOCKED",
    attempt: 1,
    maxAttempts: 3,
    status,
    profile: "tests",
    scenario: "fixture",
    command: "pnpm test",
    exitCode: status === "passed" ? 0 : 1,
    failedTests: [],
    affectedFiles: [],
    failedTestDetails: [],
    changedFiles: [],
    detail: "",
  } as AgentStep;
}

describe("benchmark terminal evidence gate", () => {
  it("keeps pending changes BLOCKED when validation never ran", () => {
    expect(terminalFromChatResult(pendingResult, [])).toBe("BLOCKED");
  });

  it("does not trust a model READY result without validation evidence", () => {
    const result = {
      ...pendingResult,
      taskResult: { kind: "REPAIR_RESULT", readiness: "READY" },
    } as unknown as ChatResult;

    expect(terminalFromChatResult(result, [])).toBe("BLOCKED");
  });

  it("allows READY_FOR_REVIEW only after passed validation", () => {
    expect(terminalFromChatResult(pendingResult, [validationStep("passed")])).toBe(
      "READY_FOR_REVIEW",
    );
    expect(terminalFromChatResult(pendingResult, [validationStep("failed")])).toBe(
      "BLOCKED",
    );
  });

  it("blocks a review-ready terminal when the behavioral oracle rejects it", () => {
    const telemetry = {
      actualTerminal: "READY_FOR_REVIEW",
    } as CodeAgentExecutionTelemetry;

    expect(applyBenchmarkOracleTerminalGate(telemetry, "failed").actualTerminal).toBe(
      "BLOCKED",
    );
    expect(applyBenchmarkOracleTerminalGate(telemetry, "passed").actualTerminal).toBe(
      "READY_FOR_REVIEW",
    );
  });
});

describe("benchmark tool failure trace", () => {
  it("redacts path details from safe failure summaries", () => {
    expect(benchmarkSafeFailureSummary({
      kind: "tool_result",
      tool: "replace_text",
      cached: false,
      outputLength: 40,
      resultKind: "failed",
      resultSummary: 'Error: old_text was not found in "src/private.ts".',
    })).toBe('Error: old_text was not found in "[redacted]".');
  });

  it("reports write-path shape and scope membership without exposing the path", () => {
    expect(benchmarkWritePathTrace("src/./target.ts", ["src/target.ts"])).toEqual({
      approved: false,
      shape: "noncanonical_relative",
    });
    expect(benchmarkWritePathTrace("/tmp/private/target.ts", ["src/target.ts"])).toEqual({
      approved: false,
      shape: "absolute",
    });
    expect(benchmarkWritePathTrace("/project/src/target.ts", ["src/target.ts"], "/project")).toEqual({
      approved: true,
      shape: "absolute_in_root",
    });
    expect(benchmarkWritePathTrace("src/target.ts ", ["src/target.ts"])).toEqual({
      approved: false,
      shape: "relative_whitespace",
    });
    expect(benchmarkWritePathTrace("src/target.ts", ["artifacts/api/src/target.ts"])).toEqual({
      approved: false,
      shape: "relative_approved_suffix",
    });
  });

  it("extracts authorization reasons without exposing the provider's path", () => {
    expect(benchmarkToolFailureReason({
      kind: "tool_result",
      tool: "replace_text",
      resultKind: "unavailable",
      resultSummary: 'Tool "replace_text" was blocked by the server authorization gate (path_outside_approved_scope).',
    } as Extract<AgentStep, { kind: "tool_result" }>)).toBe("path_outside_approved_scope");
  });

  it("classifies exact-replacement failures without retaining file contents", () => {
    expect(benchmarkToolFailureReason({
      kind: "tool_result",
      tool: "replace_text",
      resultKind: "failed",
      resultSummary: 'Error: old_text was not found exactly in "src/target.ts". Read the current file and copy the exact text, including whitespace.',
    } as Extract<AgentStep, { kind: "tool_result" }>)).toBe("replace_text_old_text_not_found");
  });

  it("distinguishes rejected tool arguments from candidate staging failures", () => {
    expect(benchmarkToolFailureReason({
      kind: "tool_result",
      tool: "replace_text",
      resultKind: "failed",
      resultSummary: 'Tool "replace_text" arguments did not match the server input contract; the operation did not complete.',
    } as Extract<AgentStep, { kind: "tool_result" }>)).toBe("tool_arguments_contract_mismatch");
    expect(benchmarkToolFailureReason({
      kind: "tool_result",
      tool: "replace_text",
      resultKind: "failed",
      resultSummary: "The candidate change could not be staged; no change was retained.",
    } as Extract<AgentStep, { kind: "tool_result" }>)).toBe("candidate_change_not_staged");
  });
});


describe("benchmark Build handoff routing", () => {
  it("forwards the exact repair fixture prompt with server-owned approval and file scope", async () => {
    chatMock.mockReset();
    chatMock.mockRejectedValueOnce(new Error("stop after capturing the handoff"));

    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "READY_FOR_REVIEW",
    )!;
    const fixture = getCodeAgentBenchmarkFixture(testCase);
    const prompt = fixture.prompt;
    const rootPath = "/tmp/isolated-code-agent-benchmark";
    const projectId = "benchmark-project";
    const allowedPaths = [...fixture.allowedPaths];
    const executionPlan = buildActiveTaskExecutionPlan({
      repairPlan: [{
        findingId: "F-1",
        files: allowedPaths,
        steps: ["Apply the requested repair inside the isolated benchmark fixture."],
        validationProfile: "workspace-typecheck",
        verdictScope: "FIXTURE_LOCAL",
        scopedFindingStatus: "FIXTURE_PROVEN",
      }],
      projectId,
      rootPath,
    });
    expect(executionPlan).not.toBeNull();
    const turnIntent = resolveTurnIntent(prompt, {
      authoritativeKind: "DELIVERY",
      buildHandoff: true,
    });
    const handoffMessage = `${prompt}\n\nBUILD HANDOFF test-only`;

    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath,
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      candidateHash: "a".repeat(64),
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "workspace-typecheck",
        command: "pnpm typecheck",
        exitCode: 0,
      }),
      providerHealth: { status: "usable" } as unknown as ProviderHealthProbeResult,
      targetPathsForCase: () => [...fixture.targetPaths],
      allowedPathsForCase: () => allowedPaths,
      promptForCase: () => prompt,
      buildHandoffForCase: (args) => {
        expect(args.prompt).toBe(prompt);
        expect(args.allowedPaths).toEqual(allowedPaths);
        return {
          executionPlan: executionPlan!,
          turnIntent,
          approvedValidationProfiles: ["workspace-typecheck"],
          message: handoffMessage,
          benchmarkFixtureRepairAuthorization: {
            caseId: testCase.id,
            authorize: vi.fn().mockResolvedValue(true),
          },
        };
      },
    });

    await executeCase(testCase);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const chatArgs = chatMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(chatArgs).toMatchObject({
      message: handoffMessage,
      projectId,
      buildHandoff: true,
      approvalState: "APPROVED",
      approvedFilePaths: allowedPaths,
      approvedValidationProfiles: ["workspace-typecheck"],
      validationTargetPaths: allowedPaths,
      executionPlanOverride: {
        readiness: "READY",
        boundaries: { projectId, rootPath, allowedWriteFiles: allowedPaths },
      },
      turnIntent: { kind: "DELIVERY", operationMode: "DELIVERY" },
      benchmarkFixtureRepairAuthorization: {
        caseId: testCase.id,
      },
    });
  });
});

describe("benchmark case timeouts", () => {
  it("treats a chat result returned after the deadline as unavailable", async () => {
    chatMock.mockReset();
    chatMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) =>
      new Promise<ChatResult>((resolve) => {
        const finish = () => resolve({ pendingChanges: [] } as unknown as ChatResult);
        if (!signal || signal.aborted) {
          finish();
          return;
        }
        signal.addEventListener("abort", finish, { once: true });
      }),
    );

    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const oracleForCase = vi.fn(async () => ({ status: "failed" as const }));
    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/isolated-code-agent-benchmark-timeout",
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      candidateHash: "a".repeat(64),
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "tests",
        command: "pnpm test",
        exitCode: 0,
      }),
      providerHealth: { status: "usable" } as unknown as ProviderHealthProbeResult,
      targetPathsForCase: () => ["src/example.ts"],
      caseTimeoutMs: 30,
      oracleForCase,
    });

    const telemetry = await executeCase(testCase);

    expect(telemetry).toMatchObject({
      actualTerminal: "BLOCKED",
      validationStatus: "unavailable",
      providerUnavailable: true,
      candidateHash: "a".repeat(64),
    });
    expect(chatMock).toHaveBeenCalledTimes(1);
    const chatArgs = chatMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof chatArgs.assertExecutionOwned).toBe("function");
    expect(() => (chatArgs.assertExecutionOwned as () => void)()).toThrow(
      "Benchmark case timed out.",
    );
    expect(oracleForCase).not.toHaveBeenCalled();
  });

  it("returns unavailable when chat never settles after the case deadline", async () => {
    chatMock.mockReset();
    let chatSignal: AbortSignal | undefined;
    chatMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      chatSignal = signal;
      return new Promise<ChatResult>(() => {});
    });

    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const oracleForCase = vi.fn(async () => ({ status: "failed" as const }));
    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/isolated-code-agent-benchmark-never-settles",
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      candidateHash: "c".repeat(64),
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "tests",
        command: "pnpm test",
        exitCode: 0,
      }),
      providerHealth: { status: "usable" } as unknown as ProviderHealthProbeResult,
      targetPathsForCase: () => ["src/example.ts"],
      caseTimeoutMs: 30,
      oracleForCase,
    });
    const startedAt = performance.now();

    const telemetry = await executeCase(testCase);

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(telemetry).toMatchObject({
      actualTerminal: "BLOCKED",
      validationStatus: "unavailable",
      providerUnavailable: true,
      candidateHash: "c".repeat(64),
    });
    expect(chatSignal?.aborted).toBe(true);
    expect(oracleForCase).not.toHaveBeenCalled();
  });

  it("retains the candidate hash when provider health blocks case execution", async () => {
    chatMock.mockReset();
    const candidateHash = "b".repeat(64);
    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/isolated-code-agent-benchmark-health-unavailable",
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      candidateHash,
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "tests",
        command: "pnpm test",
        exitCode: 0,
      }),
      providerHealth: {
        status: "unavailable",
        providerUnavailable: true,
      } as unknown as ProviderHealthProbeResult,
      targetPathsForCase: () => ["src/example.ts"],
    });

    const telemetry = await executeCase(testCase);

    expect(telemetry).toMatchObject({
      actualTerminal: "BLOCKED",
      validationStatus: "unavailable",
      providerUnavailable: true,
      candidateHash,
    });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("does not run the contract oracle after a provider-unavailable chat result", async () => {
    chatMock.mockReset();
    chatMock.mockImplementationOnce(async ({ onStep }: {
      onStep?: (step: AgentStep) => void;
    }) => {
      onStep?.({
        kind: "diagnostic",
        code: "EXECUTION_PROVIDER_FAILURE",
      } as AgentStep);
      return { pendingChanges: [] } as unknown as ChatResult;
    });

    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const oracleForCase = vi.fn(async () => ({
      status: "failed" as const,
      code: "PROVIDER_UNAVAILABLE",
    }));
    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/isolated-code-agent-benchmark-provider-unavailable",
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "tests",
        command: "pnpm test",
        exitCode: 0,
      }),
      providerHealth: { status: "usable" } as unknown as ProviderHealthProbeResult,
      targetPathsForCase: () => ["src/example.ts"],
      oracleForCase,
    });

    const telemetry = await executeCase(testCase);

    expect(telemetry.providerUnavailable).toBe(true);
    expect(telemetry.oracleStatus).toBeUndefined();
    expect(oracleForCase).not.toHaveBeenCalled();
  });

  it("scores invalid provider tool calls as contract failures, not provider outages", async () => {
    chatMock.mockReset();
    chatMock.mockImplementationOnce(async ({ onStep }: {
      onStep?: (step: AgentStep) => void;
    }) => {
      onStep?.({
        kind: "diagnostic",
        code: "EXECUTION_PROVIDER_FAILURE",
        details: ["provider failure code: INVALID_TOOL_CALL"],
      } as AgentStep);
      return { pendingChanges: [] } as unknown as ChatResult;
    });

    const testCase = getCodeAgentBenchmarkCases().find(
      (candidate) => candidate.expected.terminal === "BLOCKED",
    )!;
    const oracleForCase = vi.fn(async () => ({ status: "failed" as const, code: "CONTRACT_FAILURE" }));
    const executeCase = createChatCodeAgentBenchmarkExecutor({
      rootPath: "/tmp/isolated-code-agent-benchmark-invalid-tool-call",
      projectContext: {} as ProjectContext,
      provider: "openrouter",
      apiKey: "fixture-only",
      providerHealth: { status: "usable" } as unknown as ProviderHealthProbeResult,
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "tests",
        command: "pnpm test",
        exitCode: 0,
      }),
      targetPathsForCase: () => ["src/example.ts"],
      oracleForCase,
    });

    const telemetry = await executeCase(testCase);

    expect(telemetry.providerUnavailable).toBe(false);
    expect(telemetry.oracleStatus).toBe("failed");
    expect(oracleForCase).toHaveBeenCalledOnce();
  });
});