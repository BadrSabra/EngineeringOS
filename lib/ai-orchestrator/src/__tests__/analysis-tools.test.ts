import { describe, expect, it } from "vitest";
import {
  executeAnalysisTool,
  type AnalysisCorrelation,
  type AnalysisToolRunner,
} from "../tools/analysis-tools.js";

const correlation: AnalysisCorrelation = {
  operationId: "operation-a",
  projectId: "project-a",
  projectRevision: "revision-1",
  rootAvailable: true,
  evidenceProvenance: "persisted-graph-search",
};

describe("analysis tool correlation contract", () => {
  it("preserves unavailable status without exposing the runner diagnostic", async () => {
    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      async () => ({
        status: "unavailable",
        output: "database password and internal connection details",
        correlation,
      }),
      undefined,
      correlation,
    );

    expect(result.status).toBe("unavailable");
    expect(result.output).toContain("was unavailable");
    expect(result.output).not.toContain("database password");
    expect(result.failureCategory).toBeUndefined();
  });

  it("preserves typed analysis failure categories while redacting diagnostics", async () => {
    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      async () => ({
        status: "unavailable",
        output: "internal timeout details",
        correlation,
        failureCategory: "timeout" as const,
      }),
      undefined,
      correlation,
    );

    expect(result.failureCategory).toBe("timeout");
    expect(result.output).not.toContain("internal timeout");
  });

  it("rejects a late complete result without allowing correlation mutation", async () => {
    const original = { ...correlation };
    const runner: AnalysisToolRunner = async (_name, _args, _signal, supplied) => {
      if (supplied) supplied.projectRevision = "late-mutated-revision";
      return {
        status: "complete",
        output: "late result",
        correlation: { ...correlation, projectRevision: "late-mutated-revision" },
      };
    };

    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      runner,
      undefined,
      original,
    );

    expect(original).toEqual(correlation);
    expect(result.status).toBe("unavailable");
    expect(result.failureCategory).toBe("stale_revision");
  });

  it("maps runner failures to a bounded failed result", async () => {
    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      async () => ({
        status: "failed",
        output: "raw internal failure",
        correlation,
      }),
      undefined,
      correlation,
    );

    expect(result.status).toBe("failed");
    expect(result.output).toContain("failed");
    expect(result.output).not.toContain("raw internal failure");
  });

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

  it("accepts complete evidence only when correlation and provenance match", async () => {
    const result = await executeAnalysisTool(
      "query_knowledge_graph",
      { operation: "search" },
      async () => ({
        status: "complete",
        output: '{"status":"complete","entities":[]}',
        source: "analysis:graph-search",
        correlation,
      }),
      undefined,
      correlation,
    );

    expect(result).toEqual(expect.objectContaining({
      status: "complete",
      output: expect.stringContaining('"status":"complete"'),
      correlation,
    }));
  });
});