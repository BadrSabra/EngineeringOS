import { describe, expect, it } from "vitest";
import { buildExecutionPlan } from "../model-selection/execution-plan.js";
import { buildSlice, type ContextPlan } from "../context-runtime/context-object.js";
import { runAdmission } from "../context-runtime/context-admission.js";

function contextPlan(projectContent: string, graphContent: string): ContextPlan {
  const project = buildSlice("project", projectContent, { source: "test:project" });
  const graph = buildSlice("graphSummary", graphContent, { source: "test:graph" });
  return {
    projectId: "project-1",
    admissionIdentity: {
      projectId: "project-1",
      operationId: "operation-1",
      projectRevision: "revision-1",
      sourceRoot: "/managed/project-1",
      scanCorrelationId: "scan-1",
    },
    slices: [project, graph],
    totalEstimatedTokens: project.estimatedTokens + graph.estimatedTokens,
    budgetTokens: 8_000,
    graphBudgetTokens: 4_800,
  };
}

describe("context admission budgets", () => {
  it("does not admit expanded graph content beyond the graph budget", () => {
    const plan = buildExecutionPlan("chat", {
      contextIntensityOverride: "normal",
      graphModeOverride: "expanded",
    });
    const result = runAdmission(
      contextPlan("project", "g".repeat(4_801 * 4)),
      plan,
    );

    expect(result.plan.slices.find((slice) => slice.id === "graphSummary")?.admissionDecision)
      .toBe("REFERENCE");
    expect(result.admittedSlices.map((slice) => slice.id)).not.toContain("graphSummary");
  });

  it("does not let expanded graph content consume tokens beyond the overall budget", () => {
    const plan = buildExecutionPlan("chat", {
      contextIntensityOverride: "normal",
      graphModeOverride: "expanded",
    });
    const result = runAdmission(
      contextPlan("p".repeat(7_900 * 4), "g".repeat(1_000 * 4)),
      plan,
    );

    expect(result.plan.slices.find((slice) => slice.id === "graphSummary")?.admissionDecision)
      .toBe("REFERENCE");
  });
});