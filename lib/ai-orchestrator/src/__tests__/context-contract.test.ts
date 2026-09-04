import { describe, expect, it } from "vitest";
import {
  AgentContextSchema,
  parseAgentContext,
} from "../schemas/context.schema.js";
import { projectContextProvenance } from "../context-provenance.js";

const legacyContext = {
  project: "Project",
  recentTasks: "No tasks yet",
  latestMetrics: "No metrics",
  graphSummary: "No graph",
  recentEvents: "No events",
  workflows: "No workflows",
  metricsVerified: false,
};

describe("unified context contract", () => {
  it("migrates legacy contexts to explicit unavailable identity", () => {
    const parsed = parseAgentContext(legacyContext);

    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.projectId).toBe("unavailable");
    expect(parsed.operationId).toBe("unavailable");
    expect(parsed.workspaceRevision).toBe("unavailable");
    expect(parsed.requestedSections).toEqual([]);
    expect(parsed.contextLinkCollection?.totalKnown).toBe(false);
    expect(AgentContextSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects unsupported versions without exposing provider details", () => {
    expect(() => parseAgentContext({ ...legacyContext, schemaVersion: "99" }))
      .toThrow("Unsupported context schema version.");
  });

  it("projects only relative file citations and preserves failed slice state", () => {
    const context = parseAgentContext({
      ...legacyContext,
      schemaVersion: "1",
      projectId: "project-a",
      operationId: "operation-a",
      workspaceRevision: "revision-a",
      capturedAt: "2026-09-04T00:00:00.000Z",
      contextHealth: {
        tasks: {
          status: "load_failed",
          source: "db:tasks",
          rowCount: 0,
          loadedAt: 1,
          freshness: "missing",
          failureCode: "QUERY_FAILED",
        },
        metrics: { status: "empty", source: "db:metrics", rowCount: 0, loadedAt: 1, freshness: "fresh" },
        graphEntities: { status: "not_requested", source: "db:graph_entities", rowCount: 0, loadedAt: 1, freshness: "missing" },
        graphRelationships: { status: "not_requested", source: "db:graph_relationships", rowCount: 0, loadedAt: 1, freshness: "missing" },
        events: { status: "loaded", source: "db:events", rowCount: 1, loadedAt: 1, freshness: "fresh" },
        workflows: { status: "loaded", source: "db:workflows", rowCount: 1, loadedAt: 1, freshness: "fresh" },
      },
      contextLinks: [{
        anchor: "task:private-id",
        source: "file",
        layer: "direct",
        direction: "outbound",
        status: "loaded",
        freshness: "fresh",
        rowCount: 1,
        loadedAt: 1,
        admissionDecision: "ADMIT",
        lifetimeStage: "fresh",
        linkReason: "Task file",
        sourceRefs: ["task:private-id", "file:src/app.ts", "graph:private-id"],
      }],
      contextLinkCollection: {
        page: 1,
        pageSize: 48,
        returnedCount: 1,
        totalKnown: false,
        hasMore: false,
        truncated: false,
      },
    });

    const provenance = projectContextProvenance(context);
    expect(provenance.slices.find((slice) => slice.layer === "tasks")).toMatchObject({
      status: "load_failed",
      failureCode: "QUERY_FAILED",
    });
    expect(provenance.citations).toEqual(["src/app.ts"]);
    expect(provenance.citations.join(" ")).not.toContain("private-id");
  });
});