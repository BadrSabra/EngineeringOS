import { describe, expect, it } from "vitest";
import { buildExecutionPlan } from "../model-selection/execution-plan.js";
import { buildSlice, type ContextPlan, type ContextSlice } from "../context-runtime/context-object.js";
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

function contextPlanWithSlices(
  slices: ContextSlice[],
  budgetTokens: number,
): ContextPlan {
  return {
    projectId: "project-1",
    admissionIdentity: {
      projectId: "project-1",
      operationId: "operation-1",
      projectRevision: "revision-1",
      sourceRoot: "/managed/project-1",
      scanCorrelationId: "scan-1",
    },
    slices,
    totalEstimatedTokens: slices.reduce((total, slice) => total + slice.estimatedTokens, 0),
    budgetTokens,
    graphBudgetTokens: 4_800,
  };
}

function worldStateBudgetPlan(): ContextPlan {
  return contextPlanWithSlices([
    buildSlice("project", "project", { source: "test:project" }),
    buildSlice("latestMetrics", "m".repeat(240), { source: "test:metrics" }),
    buildSlice("worldState", "w".repeat(240), { source: "test:world-state" }),
  ], 80);
}

describe("context admission budgets", () => {
  it.each([
    "scan-runner",
    "review-agent",
    "task-runner",
    "workflow-orchestrator",
  ])("prioritizes World State over metrics for evidence work: %s", (scope) => {
    const executionPlan = buildExecutionPlan(scope);
    const result = runAdmission(worldStateBudgetPlan(), executionPlan);

    expect(result.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("ADMIT");
    expect(result.plan.slices.find((slice) => slice.id === "latestMetrics")?.admissionDecision)
      .toBe("REFERENCE");
  });

  it.each([false, true])("keeps World State secondary to metrics in ordinary chat (hasTools=%s)", (hasTools) => {
    const executionPlan = buildExecutionPlan("chat-agent", { hasTools });
    const result = runAdmission(worldStateBudgetPlan(), executionPlan);

    expect(result.plan.slices.find((slice) => slice.id === "latestMetrics")?.admissionDecision)
      .toBe("ADMIT");
    expect(result.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("DEFER");
  });

  it("preserves explicit missing-evidence status for evidence tasks but drops it from ordinary chat", () => {
    const makePlan = () => contextPlanWithSlices([
      buildSlice("project", "project", { source: "test:project" }),
      buildSlice("worldState", "World State unavailable", {
        source: "test:world-state",
        freshness: "missing",
        healthStatus: "load_failed",
      }),
    ], 80);

    const analysis = runAdmission(makePlan(), buildExecutionPlan("scan-runner"));
    const chat = runAdmission(makePlan(), buildExecutionPlan("chat-agent"));

    expect(analysis.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("ADMIT");
    expect(chat.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("DROP");
  });

describe("context admission budgets", () => {
  it.each([
    "scan-runner",
    "review-agent",
    "task-runner",
    "workflow-orchestrator",
  ])("prioritizes World State over metrics for evidence work: %s", (scope) => {
    const executionPlan = buildExecutionPlan(scope);
    const result = runAdmission(worldStateBudgetPlan(), executionPlan);

    expect(result.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("ADMIT");
    expect(result.plan.slices.find((slice) => slice.id === "latestMetrics")?.admissionDecision)
      .toBe("REFERENCE");
  });

  it.each([false, true])("keeps World State secondary to metrics in ordinary chat (hasTools=%s)", (hasTools) => {
    const executionPlan = buildExecutionPlan("chat-agent", { hasTools });
    const result = runAdmission(worldStateBudgetPlan(), executionPlan);

    expect(result.plan.slices.find((slice) => slice.id === "latestMetrics")?.admissionDecision)
      .toBe("ADMIT");
    expect(result.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("DEFER");
  });

  it("preserves explicit missing-evidence status for evidence tasks but drops it from ordinary chat", () => {
    const makePlan = () => contextPlanWithSlices([
      buildSlice("project", "project", { source: "test:project" }),
      buildSlice("worldState", "World State unavailable", {
        source: "test:world-state",
        freshness: "missing",
        healthStatus: "load_failed",
      }),
    ], 80);

    const analysis = runAdmission(makePlan(), buildExecutionPlan("scan-runner"));
    const chat = runAdmission(makePlan(), buildExecutionPlan("chat-agent"));

    expect(analysis.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("ADMIT");
    expect(chat.plan.slices.find((slice) => slice.id === "worldState")?.admissionDecision)
      .toBe("DROP");
  });


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