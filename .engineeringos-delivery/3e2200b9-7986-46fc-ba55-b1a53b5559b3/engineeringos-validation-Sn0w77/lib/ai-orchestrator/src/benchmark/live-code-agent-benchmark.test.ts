import { describe, expect, it } from "vitest";
import {
  applyBenchmarkOracleTerminalGate,
  terminalFromChatResult,
} from "./live-code-agent-benchmark.js";
import type { CodeAgentExecutionTelemetry } from "./code-agent-benchmark.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ChatResult } from "../agents/chat-agent.js";

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