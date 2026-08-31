import { describe, expect, it } from "vitest";
import { createProjectAnalysisToolRunner, classifyAnalysisFailure } from "./ai-analysis-tools.js";
import { ScanRootUnavailableError } from "./scan-runner.js";

describe("project analysis root failure classification", () => {
  it("reports an initially unavailable root before any tool work", async () => {
    const runner = createProjectAnalysisToolRunner("project-a", "/tmp/missing-root");
    const result = await runner(
      "query_knowledge_graph",
      { operation: "search" },
      undefined,
      {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-a",
        rootAvailable: false,
        evidenceProvenance: "project-analysis",
      },
    );
    expect(result).toMatchObject({
      status: "unavailable",
      failureCategory: "root_unavailable",
    });
  });

  it("reports a root that disappears during a refresh", () => {
    const error = new ScanRootUnavailableError("/tmp/missing-root", "root_not_found", "root disappeared");
    expect(classifyAnalysisFailure(error)).toBe("root_unavailable");
    expect(classifyAnalysisFailure({ outcome: "root_unavailable" })).toBe("root_unavailable");
  });
});