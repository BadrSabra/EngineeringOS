import { describe, expect, it } from "vitest";
import { buildContextLinks } from "../context-links.js";
import type { LoadedProjectContext } from "../context-loader.js";

function makeLoadedContext(): LoadedProjectContext {
  const capturedAt = "2026-09-04T00:00:00.000Z";
  return {
    project: {} as LoadedProjectContext["project"],
    rawTasks: [{
      id: "task-1",
      relatedFiles: ["src/auth.ts"],
    }] as LoadedProjectContext["rawTasks"],
    latestMetric: {} as LoadedProjectContext["latestMetric"],
    entities: [{
      id: "entity-1",
      path: "src/auth.ts",
      confidence: 0.9,
    }] as LoadedProjectContext["entities"],
    relationships: [{
      id: "relationship-1",
      sourceId: "entity-1",
      targetId: "entity-2",
      relation: "depends_on",
      relationType: "dependency",
      confidence: 0.8,
      isHeuristic: false,
    }] as LoadedProjectContext["relationships"],
    recentEvents: [{
      taskId: "task-1",
      workflowId: "workflow-1",
    }] as LoadedProjectContext["recentEvents"],
    rawWorkflows: [{
      id: "workflow-1",
      phases: [{ name: "build" }],
    }] as LoadedProjectContext["rawWorkflows"],
    latestScanJob: undefined,
    scanVerified: true,
    contextManifest: {
      projectId: "project-1",
      projectRevision: "revision-1",
      scanCompleteness: "COMPLETE",
      sourceProvenance: "filesystem-scan",
      capturedAt,
    },
    wants: () => true,
    requestedSections: new Set(["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"]),
    sliceMetadata: new Map([
      ["metrics", {
        source: "db:metrics",
        status: "loaded",
        freshness: "fresh",
        loadedAt: 1,
        rowCount: 1,
        dependencyHints: [],
        collection: { page: 1, pageSize: 1, returnedCount: 1, totalKnown: false, hasMore: false, truncated: false },
      }],
      ["project", {
        source: "db:projects",
        status: "loaded",
        freshness: "fresh",
        loadedAt: 1,
        rowCount: 1,
        dependencyHints: [],
        collection: { page: 1, pageSize: 1, returnedCount: 1, totalKnown: true, hasMore: false, truncated: false },
      }],
    ]),
  };
}

describe("buildContextLinks", () => {
  it("emits task, graph, metric, scan, event, and workflow links", () => {
    const links = buildContextLinks(makeLoadedContext());
    const sources = new Set(links.map((entry) => entry.source));

    expect(sources).toEqual(new Set(["file", "graph", "event", "workflow", "metric", "scan"]));
    expect(links.some((entry) => entry.anchor === "task:task-1" && entry.source === "file")).toBe(true);
    expect(links.some((entry) => entry.anchor === "project" && entry.source === "metric")).toBe(true);
    expect(links.some((entry) => entry.anchor === "project" && entry.source === "scan")).toBe(true);
  });

  it("is deterministic and uses the manifest capture time for link timestamps", () => {
    const first = buildContextLinks(makeLoadedContext());
    const second = buildContextLinks(makeLoadedContext());

    expect(second).toEqual(first);
    expect(new Set(first.map((entry) => entry.loadedAt))).toEqual(new Set([Date.parse("2026-09-04T00:00:00.000Z")]));
  });

  it("drops graph relationships whose endpoints are not in the loaded project graph", () => {
    const context = makeLoadedContext();
    context.entities = [{
      id: "entity-1",
      path: "src/auth.ts",
      confidence: 0.9,
    }] as LoadedProjectContext["entities"];

    const links = buildContextLinks(context);
    expect(links.some((entry) => entry.source === "graph" && entry.anchor === "graph:entity-1"
      && entry.linkReason.includes("Graph relationship"))).toBe(false);
  });
});