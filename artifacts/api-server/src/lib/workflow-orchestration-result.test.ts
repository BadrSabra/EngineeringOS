import { describe, expect, it } from "vitest";
import {
  buildWorkflowOrchestrationDisposition,
  buildWorkflowOrchestrationRequestKey,
  fingerprintWorkflowOrchestrationContext,
  parseWorkflowOrchestrationDisposition,
} from "./workflow-orchestration-result.js";

const identity = {
  workflowId: "workflow-1",
  requestKey: "workflow-1:revision-1",
};

describe("workflow orchestration decision receipt", () => {
  it("replays the same bounded advance decision for the same workflow request", () => {
    const receipt = buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: {
        action: "advance",
        reasoning: "The build phase is verified.",
        nextPhase: "test",
        suggestions: ["Run the focused suite"],
      },
    });

    expect(parseWorkflowOrchestrationDisposition(receipt, identity)).toEqual({
      action: "advance",
      reasoning: "The build phase is verified.",
      nextPhase: "test",
      suggestions: ["Run the focused suite"],
    });
  });

  it("does not replay a decision across workflows or request identities", () => {
    const receipt = buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: {
        action: "wait",
        reasoning: "The latest metrics are not verified.",
        blockers: ["Run a project scan"],
      },
    });

    expect(parseWorkflowOrchestrationDisposition(receipt, {
      ...identity,
      workflowId: "workflow-2",
    })).toBeUndefined();
    expect(parseWorkflowOrchestrationDisposition(receipt, {
      ...identity,
      requestKey: "workflow-1:revision-2",
    })).toBeUndefined();
  });

  it("bounds stored decision text and list sizes", () => {
    const receipt = buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: {
        action: "wait",
        reasoning: "r".repeat(5_000),
        blockers: Array.from({ length: 12 }, (_, index) => `blocker-${index}`),
        suggestions: Array.from({ length: 12 }, (_, index) => `suggestion-${index}`),
      },
    });

    expect(receipt.decision.reasoning).toHaveLength(4_000);
    expect(receipt.decision.action).toBe("wait");
    if (receipt.decision.action === "wait") {
      expect(receipt.decision.blockers).toHaveLength(8);
    }
    expect(receipt.decision.suggestions).toHaveLength(8);
  });

  it("rejects malformed decision payloads and tampered receipts", () => {
    expect(() => buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: { action: "advance", reasoning: "Missing phase" },
    })).toThrow();

    const receipt = buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: { action: "complete", reasoning: "All phases are complete." },
    });
    expect(parseWorkflowOrchestrationDisposition({
      ...receipt,
      version: 2,
    }, identity)).toBeUndefined();
  });
});


describe("workflow orchestration request identity", () => {
  const request = {
    workflowId: "workflow-1",
    baseExecutionKey: "workflow-execution-1",
    workflowRevision: "2026-11-20T05:00:00.000Z",
    phases: [{ name: "build", steps: ["compile"] }, { name: "test", steps: ["verify"] }],
    currentPhase: "build",
    completedPhases: [],
    contextFingerprint: "context-fingerprint-1",
    additionalContext: "Focus on API regressions",
  };

  it("uses a stable key for identical state and operator context", () => {
    expect(buildWorkflowOrchestrationRequestKey(request))
      .toBe(buildWorkflowOrchestrationRequestKey({ ...request }));
  });

  it("changes the key when the phase state or additional context changes", () => {
    const key = buildWorkflowOrchestrationRequestKey(request);
    expect(buildWorkflowOrchestrationRequestKey({
      ...request,
      currentPhase: "test",
      completedPhases: ["build"],
    })).not.toBe(key);
    expect(buildWorkflowOrchestrationRequestKey({
      ...request,
      additionalContext: "Focus on provider failures",
    })).not.toBe(key);
    expect(buildWorkflowOrchestrationRequestKey({
      ...request,
      contextFingerprint: "context-fingerprint-2",
    })).not.toBe(key);
  });
});


describe("workflow orchestration context fingerprint", () => {
  const context = {
    project: "Project: EngineeringOS",
    recentTasks: "Task A: completed",
    latestMetrics: "Critical: 0",
    graphSummary: "Entities: 12",
    recentEvents: "- [INFO] 2026-11-20 05:00 TaskCompleted: task passed",
    workflows: "Workflow: active",
    metricsVerified: true,
    workspaceRevision: "scan-revision-1",
    scanCorrelationId: "scan-1",
  };

  it("is stable for the same decision-relevant project context", () => {
    expect(fingerprintWorkflowOrchestrationContext(context))
      .toBe(fingerprintWorkflowOrchestrationContext({ ...context }));
  });

  it("ignores its own orchestration events but retains other recent events", () => {
    const fingerprint = fingerprintWorkflowOrchestrationContext(context);
    expect(fingerprintWorkflowOrchestrationContext({
      ...context,
      recentEvents: `${context.recentEvents}\n- [INFO] 2026-11-20 05:01 AiWorkflowOrchestration: AI orchestrator decision`,
    })).toBe(fingerprint);
    expect(fingerprintWorkflowOrchestrationContext({
      ...context,
      recentEvents: `${context.recentEvents}\n- [ERROR] 2026-11-20 05:02 TaskFailed: test failed`,
    })).not.toBe(fingerprint);
  });

  it("changes when tasks, metrics, or scan revision changes", () => {
    const fingerprint = fingerprintWorkflowOrchestrationContext(context);
    expect(fingerprintWorkflowOrchestrationContext({
      ...context,
      latestMetrics: "Critical: 1",
    })).not.toBe(fingerprint);
    expect(fingerprintWorkflowOrchestrationContext({
      ...context,
      workspaceRevision: "scan-revision-2",
    })).not.toBe(fingerprint);
  });
});


describe("workflow orchestration replay consistency", () => {
  it("returns the same bounded decision on the initial response and replay", () => {
    const receipt = buildWorkflowOrchestrationDisposition({
      ...identity,
      decision: {
        action: "advance",
        reasoning: "The build phase is verified.",
        nextPhase: "phase-".repeat(900),
      },
    });

    expect(receipt.decision.action).toBe("advance");
    if (receipt.decision.action === "advance") {
      expect(receipt.decision.nextPhase).toHaveLength(4_000);
    }
    expect(parseWorkflowOrchestrationDisposition(receipt, identity))
      .toEqual(receipt.decision);
  });
});
