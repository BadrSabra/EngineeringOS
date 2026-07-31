import { describe, it, expect } from "vitest";
import {
  computeCentrality,
  detectClusters,
  computeGraphSummary,
  computeLayeredGraphSummary,
} from "../inference.js";
import type { GraphEntity, GraphRelationship } from "../types.js";

function entity(id: string, type = "module"): GraphEntity {
  return {
    id,
    projectId: "p1",
    scanJobId: null,
    type,
    name: id,
    path: null,
    metadata: null,
    provenance: null,
    createdAt: new Date(),
  } as unknown as GraphEntity;
}

function rel(
  sourceId: string,
  targetId: string,
  relation = "imports",
): GraphRelationship {
  return {
    id: `${sourceId}->${targetId}`,
    sourceId,
    targetId,
    relation,
    scanJobId: null,
    confidence: null,
    metadata: null,
    createdAt: new Date(),
  } as unknown as GraphRelationship;
}

describe("computeCentrality", () => {
  it("counts in-degree and out-degree per entity", () => {
    const entities = [entity("a"), entity("b"), entity("c")];
    // a -> b, c -> b, a -> c
    const relationships = [rel("a", "b"), rel("c", "b"), rel("a", "c")];

    const scores = computeCentrality(entities, relationships);
    const byId = new Map(scores.map((s) => [s.entityId, s]));

    expect(byId.get("a")).toMatchObject({ inDegree: 0, outDegree: 2, totalDegree: 2 });
    expect(byId.get("b")).toMatchObject({ inDegree: 2, outDegree: 0, totalDegree: 2 });
    expect(byId.get("c")).toMatchObject({ inDegree: 1, outDegree: 1, totalDegree: 2 });
  });

  it("returns zero degree for entities with no relationships", () => {
    const entities = [entity("isolated")];
    const scores = computeCentrality(entities, []);

    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ inDegree: 0, outDegree: 0, totalDegree: 0 });
  });

  it("returns an empty array for an empty entity list", () => {
    expect(computeCentrality([], [])).toEqual([]);
  });
});

describe("detectClusters", () => {
  it("groups entities connected by any relationship into one cluster", () => {
    // a-b-c form one connected component (undirected view); d is isolated.
    const entities = [entity("a"), entity("b"), entity("c"), entity("d")];
    const relationships = [rel("a", "b"), rel("b", "c")];

    const clusters = detectClusters(entities, relationships);

    expect(clusters).toHaveLength(2);
    const sizes = clusters.map((c) => c.size).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 3]);
    const bigCluster = clusters.find((c) => c.size === 3)!;
    expect(new Set(bigCluster.entityIds)).toEqual(new Set(["a", "b", "c"]));
  });

  it("treats relationships as undirected for clustering purposes", () => {
    // b -> a (reverse direction) still joins a and b into the same cluster.
    const entities = [entity("a"), entity("b")];
    const relationships = [rel("b", "a")];

    const clusters = detectClusters(entities, relationships);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(2);
  });

  it("puts every entity in its own cluster when there are no relationships", () => {
    const entities = [entity("a"), entity("b"), entity("c")];
    const clusters = detectClusters(entities, []);

    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.size === 1)).toBe(true);
  });

  it("sorts clusters by size descending", () => {
    const entities = [entity("a"), entity("b"), entity("c"), entity("d"), entity("e")];
    // Cluster 1: a-b (size 2). Cluster 2: c-d-e (size 3).
    const relationships = [rel("a", "b"), rel("c", "d"), rel("d", "e")];

    const clusters = detectClusters(entities, relationships);
    expect(clusters.map((c) => c.size)).toEqual([3, 2]);
  });

  it("ignores relationships that reference entities outside the given set", () => {
    const entities = [entity("a"), entity("b")];
    const relationships = [rel("a", "b"), rel("a", "ghost")];

    const clusters = detectClusters(entities, relationships);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(2);
  });
});

describe("computeGraphSummary", () => {
  it("aggregates counts, centrality, clusters, and isolation for a mixed graph", () => {
    // Triangle a->b->c plus an isolated node d.
    const entities = [
      entity("a", "module"),
      entity("b", "module"),
      entity("c", "function"),
      entity("d", "module"),
    ];
    const relationships = [
      rel("a", "b", "imports"),
      rel("b", "c", "calls"),
    ];

    const summary = computeGraphSummary("proj-1", entities, relationships);

    expect(summary.projectId).toBe("proj-1");
    expect(summary.entityCount).toBe(4);
    expect(summary.relationshipCount).toBe(2);
    expect(summary.entitiesByType).toEqual({ module: 3, function: 1 });
    expect(summary.relationsByType).toEqual({ imports: 1, calls: 1 });
    expect(summary.isolatedCount).toBe(1);
    // Two connected components: {a,b,c} and {d}
    expect(summary.clusterCount).toBe(2);
    // b has the highest degree (1 in, 1 out = 2)
    expect(summary.topConnected[0].entityId).toBe("b");
    expect(summary.topConnected[0].totalDegree).toBe(2);
  });

  it("returns zeroed-out fields for an empty graph", () => {
    const summary = computeGraphSummary("proj-empty", [], []);

    expect(summary.entityCount).toBe(0);
    expect(summary.relationshipCount).toBe(0);
    expect(summary.avgDegree).toBe(0);
    expect(summary.isolatedCount).toBe(0);
    expect(summary.clusterCount).toBe(0);
    expect(summary.topConnected).toEqual([]);
  });

  it("limits topConnected to topN entries", () => {
    const entities = Array.from({ length: 5 }, (_, i) => entity(`e${i}`));
    const relationships = [
      rel("e0", "e1"),
      rel("e0", "e2"),
      rel("e0", "e3"),
      rel("e0", "e4"),
    ];

    const summary = computeGraphSummary("proj", entities, relationships, 2);
    expect(summary.topConnected).toHaveLength(2);
    expect(summary.topConnected[0].entityId).toBe("e0");
  });
});

// ─── KG-07: regression — computeLayeredGraphSummary runtime entityCount ───────

describe("computeLayeredGraphSummary — KG-06 runtime entityCount", () => {
  /** Build a relationship with full required fields for inference. */
  function runtimeRel(
    sourceId: string,
    targetId: string,
  ): GraphRelationship {
    return {
      id: `${sourceId}->${targetId}`,
      sourceId,
      targetId,
      projectId: "p-rt",
      relation: "calls",
      relationType: "calls",
      isHeuristic: false,
      isRuntimeObserved: true,
      confidence: 0.9,
      evidenceCount: 1,
      createdAt: new Date(),
      scanJobId: null,
      weight: null,
      relationSubtype: null,
      isHeuristicDefault: false,
      evidenceJson: null,
      evidenceSummary: null,
      semanticTags: null,
      sourceType: "typescript-ast",
      metadata: null,
      provenance: null,
    } as unknown as GraphRelationship;
  }

  it("runtime.entityCount equals number of unique entities in runtime-observed edges", () => {
    // Entities: a, b, c — runtime edges: a→b and b→c (3 unique entity IDs)
    const entities = [entity("a"), entity("b"), entity("c"), entity("d")];
    const relationships = [
      { ...runtimeRel("a", "b") },
      { ...runtimeRel("b", "c") },
      // structural edge: d→a (should not contribute to runtime entity count)
      {
        ...runtimeRel("d", "a"),
        isRuntimeObserved: false,
        isHeuristic: false,
      } as unknown as GraphRelationship,
    ];

    const summary = computeLayeredGraphSummary(entities, relationships);

    // a, b, c are all endpoints of runtime edges
    expect(summary.byLayer.runtime.entityCount).toBe(3);
    expect(summary.byLayer.runtime.relationshipCount).toBe(2);
  });

  it("runtime.entityCount is 0 when no runtime-observed edges exist", () => {
    const entities = [entity("x"), entity("y")];
    const relationships = [
      {
        ...runtimeRel("x", "y"),
        isRuntimeObserved: false,
        isHeuristic: false,
      } as unknown as GraphRelationship,
    ];

    const summary = computeLayeredGraphSummary(entities, relationships);
    expect(summary.byLayer.runtime.entityCount).toBe(0);
    expect(summary.byLayer.runtime.relationshipCount).toBe(0);
  });

  it("structural entityCount uses source-type heuristic (entities without regex-fallback)", () => {
    // 4 entities: 3 normal, 1 regex-fallback
    const mixedEntities = [
      entity("a"),
      entity("b"),
      entity("c"),
      { ...entity("d"), sourceType: "regex-fallback" } as unknown as GraphEntity,
    ];
    const summary = computeLayeredGraphSummary(mixedEntities, []);

    expect(summary.byLayer.structural.entityCount).toBe(3);
    expect(summary.byLayer.heuristic.entityCount).toBe(1);
  });

  it("documentedEntityCount reflects isDocumented field", () => {
    const mixedEntities = [
      entity("a"),
      { ...entity("b"), isDocumented: true } as unknown as GraphEntity,
      { ...entity("c"), isDocumented: true } as unknown as GraphEntity,
    ];
    const summary = computeLayeredGraphSummary(mixedEntities, []);

    expect(summary.documentedEntityCount).toBe(2);
    expect(summary.undocumentedEntityCount).toBe(1);
  });
});
