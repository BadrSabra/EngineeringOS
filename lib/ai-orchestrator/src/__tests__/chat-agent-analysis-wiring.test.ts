import { describe, expect, it, vi } from "vitest";
import type { AnalysisCorrelation } from "../tools/analysis-tools.js";
import {
  buildActiveTaskExecutionPlan,
  buildActiveTaskState,
} from "../task-session-state.js";

const { executeToolLoopMock } = vi.hoisted(() => ({
  executeToolLoopMock: vi.fn(),
}));

vi.mock("../tool-execution-engine.js", async () => {
  const actual = await vi.importActual<typeof import("../tool-execution-engine.js")>(
    "../tool-execution-engine.js",
  );
  return {
    ...actual,
    executeToolLoop: executeToolLoopMock,
  };
});

const correlation: AnalysisCorrelation = {
  operationId: "operation-a",
  projectId: "project-a",
  projectRevision: "revision-1",
  rootAvailable: true,
  evidenceProvenance: "project-analysis",
};

const context = {
  project: "Project context",
  recentTasks: "No tasks",
  latestMetrics: "No metrics",
  graphSummary: "No graph entities",
  recentEvents: "No recent events",
  workflows: "No workflows",
  metricsVerified: false,
};

describe("chat analysis tool wiring", () => {
  it.each([
    "Run a forensic audit of src/server.ts and identify the root causes.",
    "Review the API routes in artifacts/api-server for root causes and provide a forensic report.",
  ])("forwards the server-owned correlation into the tool loop: %s", async (message) => {
    const { chat } = await import("../agents/chat-agent.js");
    const { classifyRequest } = await import("../prompts/profile-classifier.js");
    const { resolveTurnIntent } = await import("../turn-intent.js");
    const turnIntent = resolveTurnIntent(message, {
      classification: classifyRequest(message),
      resumed: false,
    });

    expect(turnIntent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      executionTaskType: "analysis",
      requiresTools: true,
      requiresEvidence: true,
    });
    executeToolLoopMock.mockClear();
    executeToolLoopMock.mockImplementationOnce(async (opts: { analysisCorrelation?: AnalysisCorrelation }) => {
      expect(opts.analysisCorrelation).toEqual(correlation);
      throw new Error("analysis wiring sentinel");
    });

    await expect(chat({
      message,
      history: [],
      projectContext: context,
      rootPath: process.cwd(),
      provider: "openrouter",
      apiKey: "test-key",
      turnIntent,
      allowAnalysisTools: true,
      analysisToolRunner: async () => ({
        status: "complete",
        output: '{"status":"complete","entities":[]}',
        correlation,
      }),
      analysisCorrelation: correlation,
    })).rejects.toThrow("analysis wiring sentinel");
    expect(executeToolLoopMock).toHaveBeenCalledTimes(1);
  });

  it("forwards the exact persisted correlation for a resumed scoped forensic audit", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const { classifyRequest } = await import("../prompts/profile-classifier.js");
    const { resolveTurnIntent } = await import("../turn-intent.js");
    const persistedState = buildActiveTaskState({
      classification: classifyRequest("Run a forensic audit of src/server.ts and identify the root causes."),
      projectId: correlation.projectId,
      rootPath: process.cwd(),
      linkedTaskId: undefined,
      revision: correlation.projectRevision,
      operationId: correlation.operationId,
    });
    const message = "Continue";
    const turnIntent = resolveTurnIntent(message, {
      classification: classifyRequest(message),
      resumed: true,
    });

    expect(persistedState).toMatchObject({
      taskType: "FULL_FORENSIC_AUDIT",
      operationId: correlation.operationId,
      scope: {
        projectId: correlation.projectId,
        revision: correlation.projectRevision,
      },
    });
    expect(turnIntent).toMatchObject({
      kind: "FORENSIC_AUDIT",
      resumed: true,
      requiresTools: true,
      requiresEvidence: true,
    });

    executeToolLoopMock.mockClear();
    executeToolLoopMock.mockImplementationOnce(async (opts: { analysisCorrelation?: AnalysisCorrelation }) => {
      expect(opts.analysisCorrelation).toEqual(correlation);
      throw new Error("resumed analysis wiring sentinel");
    });

    await expect(chat({
      message,
      history: [],
      projectContext: context,
      rootPath: process.cwd(),
      provider: "openrouter",
      apiKey: "test-key",
      activeTaskState: persistedState,
      turnIntent,
      allowAnalysisTools: true,
      analysisToolRunner: async () => ({
        status: "complete",
        output: '{"status":"complete","entities":[]}',
        correlation,
      }),
      analysisCorrelation: correlation,
    })).rejects.toThrow("resumed analysis wiring sentinel");
    expect(executeToolLoopMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the parent correlation on a nested execution-node tool loop", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const repairPlan = [{
      findingId: "F-01",
      files: ["src/server.ts"],
      steps: ["Apply the verified repair"],
      validationProfile: "workspace-typecheck" as const,
      verdictScope: "PRODUCTION" as const,
      scopedFindingStatus: "PRODUCTION_PROVEN" as const,
    }];
    const executionPlan = buildActiveTaskExecutionPlan({
      repairPlan,
      projectId: correlation.projectId,
      rootPath: process.cwd(),
    });
    expect(executionPlan?.nodes).toHaveLength(1);

    executeToolLoopMock.mockClear();
    executeToolLoopMock.mockImplementationOnce(async (opts: {
      analysisCorrelation?: AnalysisCorrelation;
      executionMode?: string;
    }) => {
      expect(opts.executionMode).toBe("repair_plan");
      expect(opts.analysisCorrelation).toEqual(correlation);
      throw new Error("nested analysis wiring sentinel");
    });

    const result = await chat({
      message: "Execute Repair Plan",
      history: [{ role: "user", content: "Run the verified forensic repair." }],
      projectContext: context,
      rootPath: process.cwd(),
      projectId: correlation.projectId,
      provider: "openrouter",
      apiKey: "test-key",
      allowValidationTools: true,
      approvalState: "APPROVED",
      approvedFilePaths: ["src/server.ts"],
      approvedValidationProfiles: ["workspace-typecheck"],
      validationRunner: async () => ({
        status: "passed" as const,
        profile: "workspace-typecheck",
        command: "pnpm typecheck",
        exitCode: 0,
      }),
      executionPlanOverride: executionPlan!,
      analysisCorrelation: correlation,
    });
    expect(result.response).toContain("nested analysis wiring sentinel");
    expect(executeToolLoopMock).toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["mismatched", { ...correlation, operationId: "operation-other" }],
  ] as const)("rejects a %s resumed correlation before evidence collection", async (_label, suppliedCorrelation) => {
    const { chat } = await import("../agents/chat-agent.js");
    const { classifyRequest } = await import("../prompts/profile-classifier.js");
    const { resolveTurnIntent } = await import("../turn-intent.js");
    const persistedState = buildActiveTaskState({
      classification: classifyRequest("Run a forensic audit of src/server.ts and identify the root causes."),
      projectId: correlation.projectId,
      rootPath: process.cwd(),
      linkedTaskId: undefined,
      revision: correlation.projectRevision,
      operationId: correlation.operationId,
    });
    const turnIntent = resolveTurnIntent("Continue", {
      classification: classifyRequest("Continue"),
      resumed: true,
    });

    executeToolLoopMock.mockClear();
    const result = await chat({
      message: "Continue",
      history: [],
      projectContext: context,
      rootPath: process.cwd(),
      provider: "openrouter",
      apiKey: "test-key",
      activeTaskState: persistedState,
      turnIntent,
      allowAnalysisTools: true,
      analysisToolRunner: async () => ({
        status: "complete",
        output: '{"status":"complete","entities":[]}',
        correlation,
      }),
      ...(suppliedCorrelation ? { analysisCorrelation: suppliedCorrelation } : {}),
    });

    expect(result.response).toContain("ANALYSIS_INCOMPLETE");
    expect(result.response).toContain("no new evidence was accepted");
    expect(result.sources).toEqual([]);
    expect(executeToolLoopMock).not.toHaveBeenCalled();
  });

  it.each([
    ["hello", "CHAT", "chat"],
    ["Open src/server.ts and explain the route.", "PROJECT_QUERY", "tool_chat"],
  ] as const)(
    "keeps ordinary chat and project queries out of the forensic wiring path: %s",
    async (message, kind, executionTaskType) => {
      const { classifyRequest } = await import("../prompts/profile-classifier.js");
      const { resolveTurnIntent } = await import("../turn-intent.js");
      const turnIntent = resolveTurnIntent(message, {
        classification: classifyRequest(message),
        resumed: false,
      });

      expect(turnIntent).toMatchObject({
        kind,
        executionTaskType,
        requiresEvidence: false,
      });
      expect(turnIntent.kind).not.toBe("FORENSIC_AUDIT");
    },
  );
});
