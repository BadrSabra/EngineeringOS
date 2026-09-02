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
  it("forwards the server-owned correlation into the tool loop", async () => {
    const { chat } = await import("../agents/chat-agent.js");
    const { classifyRequest } = await import("../prompts/profile-classifier.js");
    const { resolveTurnIntent } = await import("../turn-intent.js");
    const message = "Run a forensic audit of the project.";
    const turnIntent = resolveTurnIntent(message, {
      classification: classifyRequest(message),
      resumed: false,
    });

    expect(turnIntent.requiresTools).toBe(true);
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
  });
});