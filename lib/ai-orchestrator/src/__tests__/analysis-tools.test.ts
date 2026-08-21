import { describe, expect, it } from "vitest";
import {
  executeAnalysisTool,
  type AnalysisCorrelation,
  type AnalysisToolRunner,
} from "../tools/analysis-tools.js";

const correlation: AnalysisCorrelation = {
  operationId: "operation-a",
  projectRevision: "revision-1",
  evidenceProvenance: "persisted-graph-search",
};

describe("analysis tool correlation contract", () => {
  it("rejects stale or cross-operation results before they become complete evidence", async () => {
    const runner: AnalysisToolRunner = async () => ({
      status: "complete",
      output: "stale graph result",
      correlation: {
        ...correlation,
        operationId: "operation-b",
        projectRevision: "revision-0",
      },
    });

    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      runner,
      undefined,
      correlation,
    );

    expect(result.status).toBe("unavailable");
    expect(result.output).toContain("stale or cross-operation");
  });

  it("returns cancellation as unavailable while retaining the operation correlation", async () => {
    const controller = new AbortController();
    const runner: AnalysisToolRunner = async (_name, _args, signal) => {
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("cancelled");
    };
    controller.abort();

    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      runner,
      controller.signal,
      correlation,
    );

    expect(result.status).toBe("unavailable");
    expect(result.correlation).toEqual(correlation);
  });
});