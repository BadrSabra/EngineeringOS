/**
 * In-memory inference over a fetched graph.
 *
 * These functions receive already-fetched entity/relationship arrays and
 * compute derived facts without hitting the database again.
 */
import type {
  GraphEntity,
  GraphRelationship,
  CentralityScore,
  GraphCluster,
  GraphSummaryResult,
  LayeredGraphSummary,
} from "./types.js";

// ─── Centrality ───────────────────────────────────────────────────────────────

/**
 * Compute degree centrality for every entity.
 *
 * Simple in-degree + out-degree count. No normalisation needed for the
 * use-case here (ranking, not comparison across differently-sized graphs).
 */
export function computeCentrality(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): CentralityScore[] {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const e of entities) {
    inDegree.set(e.id, 0);
    outDegree.set(e.id, 0);
  }

  for (const r of relationships) {
    outDegree.set(r.sourceId, (outDegree.get(r.sourceId) ?? 0) + 1);
    inDegree.set(r.targetId, (inDegree.get(r.targetId) ?? 0) + 1);
  }

  return entities.map((e) => {
    const inD = inDegree.get(e.id) ?? 0;
    const outD = outDegree.get(e.id) ?? 0;
    return {
      entityId: e.id,
      entityName: e.name,
      entityType: e.type,
      inDegree: inD,
      outDegree: outD,
      totalDegree: inD + outD,
    };
  });
}

// ─── Cluster detection ────────────────────────────────────────────────────────

/**
 * Detect connected components in an undirected view of the graph using
 * union-find. This treats relationships as undirected edges.
 *
 * Returns clusters sorted by size descending.
 */
export function detectClusters(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): GraphCluster[] {
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  for (const e of entities) {
    parent.set(e.id, e.id);
    rank.set(e.id, 0);
  }

  function find(id: string): string {
    if (parent.get(id) !== id) {
      parent.set(id, find(parent.get(id)!));
    }
    return parent.get(id)!;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) ?? 0;
    const rankB = rank.get(rb) ?? 0;
    if (rankA < rankB) {
      parent.set(ra, rb);
    } else if (rankA > rankB) {
      parent.set(rb, ra);
    } else {
      parent.set(rb, ra);
      rank.set(ra, rankA + 1);
    }
  }

  for (const r of relationships) {
    if (parent.has(r.sourceId) && parent.has(r.targetId)) {
      union(r.sourceId, r.targetId);
    }
  }

  // Group by root
  const groups = new Map<string, string[]>();
  for (const e of entities) {
    const root = find(e.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(e.id);
  }

  return [...groups.values()]
    .map((entityIds, i) => ({ id: i, entityIds, size: entityIds.length }))
    .sort((a, b) => b.size - a.size);
}

// ─── Graph summary ────────────────────────────────────────────────────────────

/**
 * Compute a full summary of a project's knowledge graph from fetched data.
 * Call `fetchProjectGraph` first, then pass the result here.
 */
export function computeGraphSummary(
  projectId: string,
  entities: GraphEntity[],
  relationships: GraphRelationship[],
  topN = 10,
): GraphSummaryResult {
  // Entities by type
  const entitiesByType: Record<string, number> = {};
  for (const e of entities) {
    entitiesByType[e.type] = (entitiesByType[e.type] ?? 0) + 1;
  }

  // Relations by type
  const relationsByType: Record<string, number> = {};
  for (const r of relationships) {
    relationsByType[r.relation] = (relationsByType[r.relation] ?? 0) + 1;
  }

  // Centrality
  const centrality = computeCentrality(entities, relationships);
  centrality.sort((a, b) => b.totalDegree - a.totalDegree);
  const topConnected = centrality.slice(0, topN);

  // Average degree
  const totalDegree = centrality.reduce((s, c) => s + c.totalDegree, 0);
  const avgDegree = entities.length > 0 ? totalDegree / entities.length : 0;

  // Isolated entities
  const connectedIds = new Set<string>();
  for (const r of relationships) {
    connectedIds.add(r.sourceId);
    connectedIds.add(r.targetId);
  }
  const isolatedCount = entities.filter((e) => !connectedIds.has(e.id)).length;

  // Clusters
  const clusters = detectClusters(entities, relationships);

  return {
    projectId,
    entityCount: entities.length,
    relationshipCount: relationships.length,
    entitiesByType,
    relationsByType,
    topConnected,
    avgDegree: Math.round(avgDegree * 100) / 100,
    isolatedCount,
    clusterCount: clusters.length,
  };
}

// ─── Knowledge Graph 2.0 inference ────────────────────────────────────────────

/**
 * Sort relationships by confidence descending.
 * The most trustworthy edges appear first — useful for populating inspector
 * panels and evidence lists where top-ranked edges matter most.
 */
export function rankEdgesByConfidence(
  relationships: GraphRelationship[],
): GraphRelationship[] {
  return [...relationships].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

/**
 * Compute degree centrality weighted by edge confidence.
 *
 * Unlike `computeCentrality` (raw degree count), each edge contributes its
 * confidence to the degree score rather than a flat 1. This means an entity
 * connected by five 0.5-confidence heuristic edges ranks lower than one
 * connected by two 1.0-confidence AST-derived edges of the same raw degree.
 */
export function computeWeightedCentrality(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): CentralityScore[] {
  const inScore = new Map<string, number>();
  const outScore = new Map<string, number>();

  for (const e of entities) {
    inScore.set(e.id, 0);
    outScore.set(e.id, 0);
  }

  for (const r of relationships) {
    const w = r.confidence ?? 1;
    outScore.set(r.sourceId, (outScore.get(r.sourceId) ?? 0) + w);
    inScore.set(r.targetId, (inScore.get(r.targetId) ?? 0) + w);
  }

  return entities.map((e) => {
    const inD = inScore.get(e.id) ?? 0;
    const outD = outScore.get(e.id) ?? 0;
    return {
      entityId: e.id,
      entityName: e.name,
      entityType: e.type,
      inDegree: inD,
      outDegree: outD,
      totalDegree: inD + outD,
    };
  });
}

/**
 * Detect clusters grouping entities by their primary semantic tag first, then
 * falling back to structural union-find for untagged entities.
 *
 * This produces semantically richer clusters than pure structural detection:
 * two components that are disconnected in the dependency graph but both tagged
 * `"auth"` appear in the same cluster, which better reflects domain ownership.
 */
export function detectSemanticClusters(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): GraphCluster[] {
  // Group entities by their primary semantic tag.
  const tagGroups = new Map<string, string[]>();
  const untagged: string[] = [];

  for (const e of entities) {
    const tags = e.semanticTags as string[] | null | undefined;
    if (tags && tags.length > 0) {
      const primary = tags[0];
      if (!tagGroups.has(primary)) tagGroups.set(primary, []);
      tagGroups.get(primary)!.push(e.id);
    } else {
      untagged.push(e.id);
    }
  }

  // For untagged entities, run union-find over structural relationships.
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const id of untagged) {
    parent.set(id, id);
    rank.set(id, 0);
  }

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }
  function union(a: string, b: string): void {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rA = rank.get(ra) ?? 0, rB = rank.get(rb) ?? 0;
    if (rA < rB) parent.set(ra, rb);
    else if (rA > rB) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, rA + 1); }
  }
  for (const r of relationships) union(r.sourceId, r.targetId);

  const structuralGroups = new Map<string, string[]>();
  for (const id of untagged) {
    const root = find(id);
    if (!structuralGroups.has(root)) structuralGroups.set(root, []);
    structuralGroups.get(root)!.push(id);
  }

  const allGroups = [
    ...[...tagGroups.values()],
    ...[...structuralGroups.values()],
  ];

  return allGroups
    .map((entityIds, i) => ({ id: i, entityIds, size: entityIds.length }))
    .sort((a, b) => b.size - a.size);
}

/**
 * Compute a layered provenance summary for a project's knowledge graph.
 *
 * Breaks down entity/relationship counts into three layers:
 *   - **structural** — AST-derived, high-confidence, non-heuristic edges
 *   - **heuristic**  — regex/inference-based edges (lower confidence)
 *   - **runtime**    — edges observed in a live environment (highest trust)
 *
 * Also reports documentation coverage and average confidence per layer and
 * overall — key signals for the KG 2.0 dashboard.
 */
export function computeLayeredGraphSummary(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
): LayeredGraphSummary {
  const structural = relationships.filter((r) => !r.isHeuristic && !r.isRuntimeObserved);
  const heuristic = relationships.filter((r) => r.isHeuristic);
  const runtime = relationships.filter((r) => r.isRuntimeObserved);

  const avgConf = (rels: GraphRelationship[]): number => {
    if (rels.length === 0) return 0;
    const total = rels.reduce((s, r) => s + (r.confidence ?? 0), 0);
    return Math.round((total / rels.length) * 100) / 100;
  };

  const byEdgeType: Record<string, number> = {};
  for (const r of relationships) {
    const t = r.relationType ?? r.relation;
    byEdgeType[t] = (byEdgeType[t] ?? 0) + 1;
  }

  const overallConf =
    relationships.length > 0
      ? relationships.reduce((s, r) => s + (r.confidence ?? 0), 0) /
        relationships.length
      : 0;

  const documented = entities.filter((e) => e.isDocumented === true).length;
  const heuristicEntities = entities.filter(
    (e) => e.sourceType === "regex-fallback",
  ).length;

  return {
    byLayer: {
      structural: {
        entityCount: entities.length - heuristicEntities,
        relationshipCount: structural.length,
        avgConfidence: avgConf(structural),
      },
      heuristic: {
        entityCount: heuristicEntities,
        relationshipCount: heuristic.length,
        avgConfidence: avgConf(heuristic),
      },
      runtime: {
        entityCount: 0, // runtime entity tracking not yet wired in
        relationshipCount: runtime.length,
        avgConfidence: avgConf(runtime),
      },
    },
    byEdgeType,
    avgConfidenceOverall: Math.round(overallConf * 100) / 100,
    documentedEntityCount: documented,
    undocumentedEntityCount: entities.length - documented,
  };
}
