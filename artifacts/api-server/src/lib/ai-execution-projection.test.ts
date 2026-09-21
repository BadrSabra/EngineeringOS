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
      schemaVersion: 2,
      kind: "DELIVERY",
      phase: "VALIDATE",
      objective: "Update the dashboard",
      progress: { currentStep: "Update dashboard" },
      tools: { totalCalls: 1, activeTool: "read_file" },
      workspace: { diffStatus: "not_available" },
      approval: { required: true, status: "PENDING", proposalId: "proposal-1" },
      stopped: { reason: null, outcome: null },
    });
    expect(projection.timeline.map((item) => [item.id, item.status])).toEqual([
      ["understand", "completed"],
      ["investigate", "completed"],
      ["plan", "completed"],
      ["approval", "active"],
      ["build", "pending"],
      ["validate", "active"],
      ["review", "active"],
      ["deliver", "pending"],
    ]);
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
    expect(projection.timeline.find((item) => item.id === "build")?.status).toBe("not_applicable");
    expect(projection.timeline.find((item) => item.id === "deliver")?.status).toBe("not_applicable");
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
    expect(blocked.timeline.find((item) => item.id === "validate")?.status).toBe("blocked");
    expect(blocked.timeline.find((item) => item.id === "deliver")?.status).toBe("not_applicable");
  });

  it("projects orientation coverage without using behavioral evidence counters", () => {
    const projection = buildAiExecutionProjection({
      execution: { id: "exec-orientation", status: "completed" },
      request: { message: "Explain the project" },
      checkpoint: {
        stage: "review",
        recentSteps: [{
          kind: "project_query_source_selection",
          plannerTier: "targeted",
          plannedFiles: ["README.md"],
          fileStatuses: [{
            path: "README.md",
            origin: "planned",
            readStatus: "READ_COMPLETE",
          }],
          truncatedPlannedCount: 0,
          skippedPlannedCount: 0,
          orientationCoverage: {
            purpose: { plannedFiles: ["README.md"], complete: true },
            components: { plannedFiles: [], complete: true },
            primaryFlow: { plannedFiles: [], complete: true },
            uncertainty: { plannedFiles: [], complete: false },
            complete: false,
            missingRoles: ["uncertainty"],
          },
        }],
      },
      evidenceVerdict: "PROVEN",
      proofRequired: true,
      terminalReason: null,
      hasAppliedChanges: false,
      hasCommittedChanges: false,
      hasPushedChanges: false,
    });

    expect(projection.orientation).toEqual({
      complete: false,
      missingRoles: ["uncertainty"],
    });
    expect(projection.verification.evidenceVerdict).toBe("PROVEN");
  });
});