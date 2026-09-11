import { describe, expect, it, vi } from "vitest";
import type { AnalysisCorrelation } from "../tools/analysis-tools.js";

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
