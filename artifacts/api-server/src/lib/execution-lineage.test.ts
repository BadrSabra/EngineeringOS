import { describe, expect, it } from "vitest";
import {
  aggregateDelegatedExecutionSummary,
  buildExecutionLineage,
} from "./execution-lineage.js";

describe("durable execution lineage", () => {
  it("binds a child to the parent delegation identity and carries bounded budget", () => {
    const lineage = buildExecutionLineage({
      executionId: "child",
      parent: {
        executionId: "parent",
        rootExecutionId: "root",
        delegationId: "delegation-1",
        depth: 1,
        budget: { maxChildren: 4, maxDepth: 3 },
      },
      budget: { maxChildren: 2 },
    });

    expect(lineage).toMatchObject({
      delegationId: "delegation-1",
      rootExecutionId: "root",
      parentExecutionId: "parent",
      depth: 2,
      budget: { maxChildren: 2, maxDepth: 3 },
    });
  });

  it("never reports proof for missing, failed, or incomplete children", () => {
    expect(aggregateDelegatedExecutionSummary([
      { status: "completed", acceptance: { outcome: "SUCCEEDED" } },
      { status: "failed", acceptance: { outcome: "FAILED" } },
    ]).verdict).toBe("UNAVAILABLE");
    expect(aggregateDelegatedExecutionSummary([
      { status: "completed", acceptance: { outcome: "SUCCEEDED" } },
      { status: "running" },
    ]).verdict).toBe("INCOMPLETE");
    expect(aggregateDelegatedExecutionSummary([]).verdict).toBe("UNAVAILABLE");
  });
});