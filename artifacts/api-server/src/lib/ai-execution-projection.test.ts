import { describe, expect, it } from "vitest";
import { buildAiExecutionProjection } from "./ai-execution-projection.js";

describe("buildAiExecutionProjection", () => {
  it("projects a live execution without inventing terminal actions", () => {
    const projection = buildAiExecutionProjection({
      execution: { id: "exec-1", status: "running", proposalId: "proposal-1", proposalApprovalRequired: true },
      request: { objective: { objective: "Update the dashboard" } },
      checkpoint: {
        stage: "validate",
        recentSteps: [
          { kind: "plan_activity", stage: "execute", status: "active", stepTitle: "Update dashboard", files: ["artifacts/dashboard/src/App.tsx"] },
          { kind: "tool_call", tool: "read_file", args: { path: "src/App.tsx" }, cached: false },
        ],
      },
      evidenceVerdict: "NOT_RECORDED",
      proofRequired: true,
      terminalReason: null,
      hasAppliedChanges: false,
      hasCommittedChanges: false,
      hasPushedChanges: false,
    });

    expect(projection).toMatchObject({
      schemaVersion: 1,
      kind: "DELIVERY",
      phase: "VALIDATE",
      objective: "Update the dashboard",
      progress: { currentStep: "Update dashboard" },
      tools: { totalCalls: 1, activeTool: "read_file" },
      workspace: { diffStatus: "not_available" },
      approval: { required: true, status: "PENDING", proposalId: "proposal-1" },
      stopped: { reason: null, outcome: null },
    });
    expect(projection.allowedActions).toEqual(["CANCEL", "REVIEW_PROOF", "REVIEW_DIFF", "APPROVE_CHANGES"]);
  });

  it("distinguishes resumable checkpoint recovery from starting a new run", () => {
    const projection = buildAiExecutionProjection({
      execution: { id: "exec-2", status: "paused", linkedTaskId: "task-1" },
      request: { message: "Continue the task" },
      checkpoint: { stage: "analysis", recentSteps: [] },
      acceptance: { nextActionCode: "RESUME_ALLOWED", resumable: true, outcome: "FAILED" },
      evidenceVerdict: "PARTIAL",
      proofRequired: true,
      terminalReason: "EXECUTION_PAUSED",
      hasAppliedChanges: false,
      hasCommittedChanges: false,
      hasPushedChanges: false,
    });

    expect(projection.kind).toBe("TASK");
    expect(projection.stopped).toEqual({ reason: "EXECUTION_PAUSED", outcome: "FAILED" });
    expect(projection.allowedActions).toEqual(["RESUME_CHECKPOINT", "REVIEW_PROOF"]);
  });

  it("exposes a retry action only when the accepted checkpoint is resumable", () => {
    const retryable = buildAiExecutionProjection({
      execution: { id: "exec-3", status: "failed" },
      request: { message: "Review the project" },
      checkpoint: { stage: "provider" },
      acceptance: { nextActionCode: "RETRY_AFTER_RATE_LIMIT", resumable: true, outcome: "FAILED" },
      evidenceVerdict: "UNAVAILABLE",
      proofRequired: true,
      terminalReason: "PROVIDER_RETRYABLE",
      hasAppliedChanges: false,
      hasCommittedChanges: false,
      hasPushedChanges: false,
    });
    const blocked = buildAiExecutionProjection({
      execution: { id: "exec-4", status: "failed" },
      request: { message: "Review the project" },
      checkpoint: { stage: "provider" },
      acceptance: { nextActionCode: "RETRY_AFTER_RATE_LIMIT", resumable: false, outcome: "FAILED" },
      evidenceVerdict: "BLOCKED",
      proofRequired: true,
      terminalReason: "PROVIDER_NOT_RETRYABLE",
      hasAppliedChanges: false,
      hasCommittedChanges: false,
      hasPushedChanges: false,
    });

    expect(retryable.allowedActions).toContain("RETRY_CHECKPOINT");
    expect(blocked.allowedActions).not.toContain("RETRY_CHECKPOINT");
  });
});