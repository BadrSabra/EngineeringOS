import { describe, expect, it } from "vitest";
import { compactGraphSummary, compactWorkflowSummary, estimateContextSize, trimContextToFit } from "../context-compressor.js";
import { applyLifetime } from "../context-runtime/context-lifetime.js";
import { buildSlice, type ContextObject } from "../context-runtime/context-object.js";
import { runAdmission } from "../context-runtime/context-admission.js";
import { resolveExecutionDecision } from "../model-selection/decision-engine.js";
import type { ProjectContext } from "../context-builder.js";
import { promptContextOverview } from "../prompts/prompt-composer.js";

function makeObject(loadedAt: number): ContextObject {
  const slices = [
    buildSlice("project", "Project", { source: "db:projects", loadedAt }),
    buildSlice("recentTasks", "Tasks", { source: "db:tasks", loadedAt }),
    buildSlice("latestMetrics", "Metrics", { source: "db:metrics", loadedAt }),
    buildSlice("graphSummary", "Graph", { source: "db:graph", loadedAt }),
    buildSlice("recentEvents", "Events", { source: "db:events", loadedAt }),
    buildSlice("workflows", "Workflows", { source: "db:workflows", loadedAt }),
  ];
  return {
    plan: {
      projectId: "freshness-test",
      admissionIdentity: {
        projectId: "freshness-test",
        operationId: "operation-1",
        projectRevision: "revision-1",
        sourceRoot: "/project",
        scanCorrelationId: "scan-1",
      },
      slices,
      totalEstimatedTokens: slices.reduce((total, slice) => total + slice.estimatedTokens, 0),
      budgetTokens: 1000,
      graphBudgetTokens: 500,
    },
    admittedSlices: slices,
    referenceSlices: [],
    deferredSlices: [],
    droppedSlices: [],
  };
}

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    project: "Project",
    recentTasks: "Tasks",
    latestMetrics: "Metrics",
    graphSummary: "Graph",
    recentEvents: "Events",
    workflows: "Workflows",
    metricsVerified: true,
    ...overrides,
  };
}

describe("context freshness and structural size controls", () => {
  it("drops every slice when admission identity is unavailable", () => {
    const object = makeObject(0);
    const result = runAdmission({
      ...object.plan,
      admissionIdentity: {
        ...object.plan.admissionIdentity,
        sourceRoot: "unavailable",
      },
    }, resolveExecutionDecision("chat-agent", { contextIntensityOverride: "normal" }));

    expect(result.admittedSlices).toEqual([]);
    expect(result.referenceSlices).toEqual([]);
    expect(result.droppedSlices).toHaveLength(object.plan.slices.length);
  });

  it("archives aged slices and reports the effective decision", () => {
    const result = applyLifetime(makeObject(0), undefined, 120_000);
    const tasks = result.states.find((state) => state.sliceId === "recentTasks");
    const events = result.states.find((state) => state.sliceId === "recentEvents");

    expect(tasks?.stage).toBe("archived");
    expect(tasks?.effectiveDecision).toBe("DEFER");
    expect(events?.stage).toBe("archived");
    expect(result.anyDemoted).toBe(true);
  });

  it("retains graph relationship topology during structural compaction", () => {
    const graph = [
      "Provenance: ast 20",
      "20 entities total:",
      ...Array.from({ length: 20 }, (_, index) => `  • Entity${index} [95%] — a very long entity description`),
      "Relationships (2 shown):",
      "  • Entity0 → depends_on → Entity1 [95%]",
      "  • Entity1 → calls → Entity2 [90%] [heuristic]",
    ].join("\n");

    const compacted = compactGraphSummary(graph, 500);
    expect(compacted.length).toBeLessThanOrEqual(500);
    expect(compacted).toContain("Relationships");
    expect(compacted).toContain("Entity0 → depends_on → Entity1");
  });

  it("retains workflow phases before generic truncation", () => {
    const workflows = [
      "- [ACTIVE] Release | current: verify | runs: 99 | last run: 2026-08-01 | phases: build → verify → deploy",
      "- [ACTIVE] Another workflow | runs: 88 | phases: lint → test → publish",
    ].join("\n");
    const compacted = compactWorkflowSummary(workflows, 180);
    expect(compacted.length).toBeLessThanOrEqual(180);
    expect(compacted).toContain("phases:");
    expect(compacted).toContain("build → verify → deploy");
  });

  it("enforces the final context bound without mutating the input", () => {
    const original = makeContext({
      graphSummary: "Graph\nRelationships (1 shown):\n  • A → depends_on → B\n" + "x".repeat(2000),
      workflows: "Workflow | phases: build → verify → deploy\n" + "y".repeat(1000),
    });
    const bounded = trimContextToFit("freshness-test", original, 700);

    expect(estimateContextSize(bounded)).toBeLessThanOrEqual(700);
    expect(estimateContextSize(original)).toBeGreaterThan(700);
    expect(original.graphSummary).toContain("A → depends_on → B");
  });

  it("renders health states into the prompt without treating failures as empty facts", () => {
    const context = makeContext({
      latestMetrics: "Metrics unavailable — context load failed (QUERY_TIMEOUT)",
      contextHealth: {
        tasks: { status: "empty", source: "db:tasks", rowCount: 0, loadedAt: 1, freshness: "missing" },
        metrics: { status: "load_failed", source: "db:metrics", rowCount: 0, loadedAt: 1, freshness: "missing", failureCode: "QUERY_TIMEOUT" },
        graphEntities: { status: "not_requested", source: "db:graph_entities", rowCount: 0, loadedAt: 1, freshness: "missing" },
        graphRelationships: { status: "not_requested", source: "db:graph_relationships", rowCount: 0, loadedAt: 1, freshness: "missing" },
        events: { status: "loaded", source: "db:events", rowCount: 1, loadedAt: 1, freshness: "fresh" },
        workflows: { status: "empty", source: "db:workflows", rowCount: 0, loadedAt: 1, freshness: "missing" },
      },
    });
    const prompt = promptContextOverview(context, "full");

    expect(prompt).toContain("metrics: status=load_failed");
    expect(prompt).toContain("failure=QUERY_TIMEOUT");
    expect(prompt).toContain("Unavailable or not-requested sections are not evidence");
  });
});