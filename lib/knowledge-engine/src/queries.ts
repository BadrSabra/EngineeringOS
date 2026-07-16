/**
 * Database-backed knowledge graph queries.
 *
 * All functions are pure async — they take a db instance and return typed
 * results. No side effects, no writes. Safe to call from any context.
 */
import { eq, inArray, and, gte, isNotNull, SQL } from "drizzle-orm";
import {
  db as DbType,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import type {
  GraphEntity,
  GraphRelationship,
  ImpactResult,
  PathResult,
  PathStep,
  TraversalHop,
  GraphQueryFilters,
  GraphEvidence,
  LayeredGraphView,
} from "./types.js";

type Db = typeof DbType;

// ─── Neighbor fetching ────────────────────────────────────────────────────────

/**
 * Fetch all direct outgoing relationships from a set of entity IDs.
 */
async function fetchOutgoing(
  db: Db,
  sourceIds: string[],
): Promise<GraphRelationship[]> {
  if (sourceIds.length === 0) return [];
  return db
    .select()
    .from(graphRelationshipsTable)
    .where(inArray(graphRelationshipsTable.sourceId, sourceIds));
}

/**
 * Fetch all entities by their IDs.
 */
async function fetchEntitiesByIds(
  db: Db,
  ids: string[],
): Promise<GraphEntity[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(graphEntitiesTable)
    .where(inArray(graphEntitiesTable.id, ids));
}

// ─── Impact analysis ─────────────────────────────────────────────────────────

/**
 * "What does this entity affect?"
 *
 * Performs a breadth-first traversal following OUTGOING relationships to find
 * all entities transitively downstream of the root. Useful for understanding
 * the blast radius of a change.
 *
 * @param maxDepth Maximum hops to follow. Defaults to 4. Cap at 6 to avoid
 *                 runaway queries on dense graphs.
 */
export async function getImpactedEntities(
  db: Db,
  entityId: string,
  maxDepth = 4,
): Promise<ImpactResult | null> {
  const depth = Math.min(maxDepth, 6);

  const rootRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);

  if (!rootRows[0]) return null;
  const root = rootRows[0];

  const visited = new Set<string>([entityId]);
  const impacted: TraversalHop[] = [];
  let frontier = [entityId];
  let currentDepth = 0;

  while (frontier.length > 0 && currentDepth < depth) {
    currentDepth++;
    const outgoing = await fetchOutgoing(db, frontier);
    const nextIds = outgoing
      .map((r) => r.targetId)
      .filter((id) => !visited.has(id));

    if (nextIds.length === 0) {
      // This hop found nothing new — it doesn't count as a reached depth.
      currentDepth--;
      break;
    }

    const nextEntities = await fetchEntitiesByIds(db, [...new Set(nextIds)]);
    const entityMap = new Map(nextEntities.map((e) => [e.id, e]));

    for (const rel of outgoing) {
      if (!visited.has(rel.targetId)) {
        const entity = entityMap.get(rel.targetId);
        if (entity) {
          impacted.push({ entity, viaRelationship: rel, depth: currentDepth });
          visited.add(rel.targetId);
        }
      }
    }

    frontier = [...new Set(nextIds)].filter((id) => entityMap.has(id));
  }

  return {
    root,
    impacted,
    impactedIds: new Set(impacted.map((h) => h.entity.id)),
    maxDepthReached: currentDepth,
  };
}

// ─── Path finding ─────────────────────────────────────────────────────────────

/**
 * Find the shortest directed path between two entities via BFS.
 *
 * Follows outgoing relationships only (directed graph semantics: A→B means
 * "A depends on / calls / imports B").
 *
 * Returns `{ found: false }` if no path exists within the depth limit.
 *
 * @param maxDepth Maximum path length. Defaults to 5.
 */
export async function getShortestPath(
  db: Db,
  fromId: string,
  toId: string,
  maxDepth = 5,
): Promise<PathResult> {
  if (fromId === toId) {
    const rows = await db
      .select()
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.id, fromId))
      .limit(1);
    if (!rows[0]) return { found: false };
    return { found: true, path: [{ entity: rows[0], relationship: null }], length: 0 };
  }

  const depth = Math.min(maxDepth, 8);

  // BFS: each queue entry is the path taken to reach this entity
  type BfsNode = { entityId: string; path: PathStep[] };

  const fromRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, fromId))
    .limit(1);
  if (!fromRows[0]) return { found: false };

  const visited = new Set<string>([fromId]);
  const queue: BfsNode[] = [
    { entityId: fromId, path: [{ entity: fromRows[0], relationship: null }] },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.path.length > depth) break;

    const outgoing = await fetchOutgoing(db, [node.entityId]);
    const targetIds = outgoing.map((r) => r.targetId).filter((id) => !visited.has(id));
    const entities = await fetchEntitiesByIds(db, [...new Set(targetIds)]);
    const entityMap = new Map(entities.map((e) => [e.id, e]));

    for (const rel of outgoing) {
      const entity = entityMap.get(rel.targetId);
      if (!entity || visited.has(rel.targetId)) continue;
      visited.add(rel.targetId);

      const newPath: PathStep[] = [
        ...node.path,
        { entity, relationship: rel },
      ];

      if (rel.targetId === toId) {
        return { found: true, path: newPath, length: newPath.length - 1 };
      }

      queue.push({ entityId: rel.targetId, path: newPath });
    }
  }

  return { found: false };
}

// ─── Depth-limited neighborhood ───────────────────────────────────────────────

/**
 * Get all entities reachable within `depth` hops from the given entity,
 * following both incoming and outgoing relationships.
 *
 * Returns all visited entities (excluding the root) and all traversed
 * relationships, useful for visualising a local neighbourhood.
 */
export async function getNeighborhood(
  db: Db,
  entityId: string,
  depth = 2,
): Promise<{
  root: GraphEntity | null;
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}> {
  const rootRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);

  if (!rootRows[0]) return { root: null, entities: [], relationships: [] };

  const visited = new Set<string>([entityId]);
  const allRelationships: GraphRelationship[] = [];
  const allEntities: GraphEntity[] = [];
  let frontier = [entityId];

  for (let d = 0; d < Math.min(depth, 4); d++) {
    // Outgoing
    const outgoing = await fetchOutgoing(db, frontier);
    // Incoming
    const incoming =
      frontier.length > 0
        ? await db
            .select()
            .from(graphRelationshipsTable)
            .where(inArray(graphRelationshipsTable.targetId, frontier))
        : [];

    const nextIds = new Set<string>();
    for (const rel of [...outgoing, ...incoming]) {
      allRelationships.push(rel);
      if (!visited.has(rel.targetId)) nextIds.add(rel.targetId);
      if (!visited.has(rel.sourceId)) nextIds.add(rel.sourceId);
    }

    const newIds = [...nextIds].filter((id) => !visited.has(id));
    if (newIds.length === 0) break;

    const entities = await fetchEntitiesByIds(db, newIds);
    allEntities.push(...entities);
    for (const e of entities) visited.add(e.id);
    frontier = newIds;
  }

  return {
    root: rootRows[0],
    entities: allEntities,
    // Deduplicate relationships by id
    relationships: [
      ...new Map(allRelationships.map((r) => [r.id, r])).values(),
    ],
  };
}

// ─── Project-level graph query ────────────────────────────────────────────────

/**
 * Fetch all entities and relationships for a project.
 * Used as input to in-memory inference functions.
 */
export async function fetchProjectGraph(
  db: Db,
  projectId: string,
): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
  const entities = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));

  if (entities.length === 0) return { entities: [], relationships: [] };

  const entityIds = entities.map((e) => e.id);
  const relationships = await db
    .select()
    .from(graphRelationshipsTable)
    .where(inArray(graphRelationshipsTable.sourceId, entityIds));

  return { entities, relationships };
}

// ─── Knowledge Graph 2.0 queries ─────────────────────────────────────────────

/**
 * Fetch relationships for a project filtered by KG 2.0 metadata dimensions:
 * edge type, confidence, source type, observed-only, heuristic-only.
 *
 * Uses the denormalised `projectId` column on the relationships table for
 * efficiency — no join through entities needed.
 */
export async function getEdgesByType(
  db: Db,
  projectId: string,
  filters: GraphQueryFilters = {},
): Promise<GraphRelationship[]> {
  const conditions: SQL[] = [eq(graphRelationshipsTable.projectId, projectId)];

  if (filters.edgeTypes && filters.edgeTypes.length > 0) {
    conditions.push(inArray(graphRelationshipsTable.relationType, filters.edgeTypes));
  }
  if (filters.minConfidence !== undefined) {
    conditions.push(gte(graphRelationshipsTable.confidence, filters.minConfidence));
  }
  if (filters.sourceTypes && filters.sourceTypes.length > 0) {
    conditions.push(inArray(graphRelationshipsTable.sourceType, filters.sourceTypes));
  }
  if (filters.observedOnly) {
    conditions.push(eq(graphRelationshipsTable.isRuntimeObserved, true));
  }
  if (filters.heuristicOnly) {
    conditions.push(eq(graphRelationshipsTable.isHeuristic, true));
  }

  return db
    .select()
    .from(graphRelationshipsTable)
    .where(and(...conditions))
    .limit(2000);
}

/**
 * Return all evidence records attached to outgoing relationships from the
 * given entity. Used by the `/graph/evidence/:entityId` API route.
 */
export async function getEvidenceForNode(
  db: Db,
  entityId: string,
): Promise<{ relationship: GraphRelationship; evidence: GraphEvidence[] }[]> {
  const rels = await db
    .select()
    .from(graphRelationshipsTable)
    .where(
      and(
        eq(graphRelationshipsTable.sourceId, entityId),
        isNotNull(graphRelationshipsTable.evidenceJson),
      ),
    );

  return rels
    .filter((r) => {
      const ev = r.evidenceJson as unknown[] | null | undefined;
      return ev && ev.length > 0;
    })
    .map((r) => ({
      relationship: r,
      evidence: (r.evidenceJson ?? []) as GraphEvidence[],
    }));
}

/**
 * Filtered version of `getNeighborhood` that respects KG 2.0 query filters.
 * Returns entities within `depth` hops whose connecting edges satisfy the
 * given filters (edge type, confidence, source type, etc.).
 */
export async function getSemanticNeighborhood(
  db: Db,
  entityId: string,
  depth = 2,
  filters: GraphQueryFilters = {},
): Promise<{
  root: GraphEntity | null;
  entities: GraphEntity[];
  relationships: GraphRelationship[];
}> {
  const rootRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);

  if (!rootRows[0]) return { root: null, entities: [], relationships: [] };

  const visited = new Set<string>([entityId]);
  const allRelationships: GraphRelationship[] = [];
  const allEntities: GraphEntity[] = [];
  let frontier = [entityId];

  for (let d = 0; d < Math.min(depth, 4); d++) {
    // Build conditions for this hop's outgoing edges
    const conditions: SQL[] = [inArray(graphRelationshipsTable.sourceId, frontier)];
    if (filters.edgeTypes && filters.edgeTypes.length > 0) {
      conditions.push(inArray(graphRelationshipsTable.relationType, filters.edgeTypes));
    }
    if (filters.minConfidence !== undefined) {
      conditions.push(gte(graphRelationshipsTable.confidence, filters.minConfidence));
    }
    if (filters.observedOnly) {
      conditions.push(eq(graphRelationshipsTable.isRuntimeObserved, true));
    }
    if (filters.heuristicOnly) {
      conditions.push(eq(graphRelationshipsTable.isHeuristic, true));
    }

    const outgoing = frontier.length > 0
      ? await db
          .select()
          .from(graphRelationshipsTable)
          .where(and(...conditions))
      : [];

    const nextIds = new Set<string>();
    for (const rel of outgoing) {
      allRelationships.push(rel);
      if (!visited.has(rel.targetId)) nextIds.add(rel.targetId);
    }

    const newIds = [...nextIds].filter((id) => !visited.has(id));
    if (newIds.length === 0) break;

    const entities = await fetchEntitiesByIds(db, newIds);
    allEntities.push(...entities);
    for (const e of entities) visited.add(e.id);
    frontier = newIds;
  }

  return {
    root: rootRows[0],
    entities: allEntities,
    relationships: [...new Map(allRelationships.map((r) => [r.id, r])).values()],
  };
}

/**
 * Find the shortest directed path between two entities where every edge meets
 * the minimum confidence threshold. Useful for finding trustworthy dependency
 * chains rather than the shortest heuristic path.
 *
 * @param minConfidence Minimum confidence [0, 1] each edge must have.
 */
export async function getHighConfidencePath(
  db: Db,
  fromId: string,
  toId: string,
  minConfidence = 0.8,
  maxDepth = 5,
): Promise<PathResult> {
  if (fromId === toId) {
    const rows = await db
      .select()
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.id, fromId))
      .limit(1);
    if (!rows[0]) return { found: false };
    return { found: true, path: [{ entity: rows[0], relationship: null }], length: 0 };
  }

  const depth = Math.min(maxDepth, 8);
  const fromRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, fromId))
    .limit(1);
  if (!fromRows[0]) return { found: false };

  type BfsNode = { entityId: string; path: PathStep[] };
  const visited = new Set<string>([fromId]);
  const queue: BfsNode[] = [
    { entityId: fromId, path: [{ entity: fromRows[0], relationship: null }] },
  ];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.path.length > depth) break;

    // Only traverse edges that meet the confidence threshold
    const outgoing = node.entityId
      ? await db
          .select()
          .from(graphRelationshipsTable)
          .where(
            and(
              eq(graphRelationshipsTable.sourceId, node.entityId),
              gte(graphRelationshipsTable.confidence, minConfidence),
            ),
          )
      : [];

    const targetIds = outgoing.map((r) => r.targetId).filter((id) => !visited.has(id));
    const entities = await fetchEntitiesByIds(db, [...new Set(targetIds)]);
    const entityMap = new Map(entities.map((e) => [e.id, e]));

    for (const rel of outgoing) {
      const entity = entityMap.get(rel.targetId);
      if (!entity || visited.has(rel.targetId)) continue;
      visited.add(rel.targetId);
      const newPath: PathStep[] = [...node.path, { entity, relationship: rel }];
      if (rel.targetId === toId) {
        return { found: true, path: newPath, length: newPath.length - 1 };
      }
      queue.push({ entityId: rel.targetId, path: newPath });
    }
  }

  return { found: false };
}

/**
 * Return only the runtime-observed subgraph for a project:
 * entities that appear in at least one runtime-observed edge, and all
 * their runtime-observed relationships.
 *
 * Runtime edges have the highest trustworthiness — they were observed in a
 * live environment rather than inferred from static analysis.
 */
export async function getObservedRuntimeSubgraph(
  db: Db,
  projectId: string,
): Promise<{ entities: GraphEntity[]; relationships: GraphRelationship[] }> {
  const relationships = await db
    .select()
    .from(graphRelationshipsTable)
    .where(
      and(
        eq(graphRelationshipsTable.projectId, projectId),
        eq(graphRelationshipsTable.isRuntimeObserved, true),
      ),
    );

  if (relationships.length === 0) return { entities: [], relationships: [] };

  const entityIds = new Set<string>();
  for (const r of relationships) {
    entityIds.add(r.sourceId);
    entityIds.add(r.targetId);
  }

  const entities = await fetchEntitiesByIds(db, [...entityIds]);
  return { entities, relationships };
}

/**
 * Split a project's graph into three semantic layers:
 *   - structural: AST-derived, non-heuristic, non-runtime edges
 *   - heuristic:  edges inferred by regex/heuristic rules
 *   - runtime:    edges observed in a live environment
 *
 * Optionally applies KG 2.0 filters to all layers simultaneously.
 */
export async function getLayeredGraphView(
  db: Db,
  projectId: string,
  filters: GraphQueryFilters = {},
): Promise<LayeredGraphView> {
  const entities = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, projectId));

  const baseConditions: SQL[] = [eq(graphRelationshipsTable.projectId, projectId)];
  if (filters.edgeTypes && filters.edgeTypes.length > 0) {
    baseConditions.push(inArray(graphRelationshipsTable.relationType, filters.edgeTypes));
  }
  if (filters.minConfidence !== undefined) {
    baseConditions.push(gte(graphRelationshipsTable.confidence, filters.minConfidence));
  }

  const allRels = await db
    .select()
    .from(graphRelationshipsTable)
    .where(and(...baseConditions));

  const structural = allRels.filter((r) => !r.isHeuristic && !r.isRuntimeObserved);
  const heuristic = allRels.filter((r) => r.isHeuristic);
  const runtime = allRels.filter((r) => r.isRuntimeObserved);

  function entitiesInRels(rels: GraphRelationship[]): GraphEntity[] {
    const ids = new Set(rels.flatMap((r) => [r.sourceId, r.targetId]));
    return entities.filter((e) => ids.has(e.id));
  }

  return {
    structural: { entities: entitiesInRels(structural), relationships: structural },
    heuristic: { entities: entitiesInRels(heuristic), relationships: heuristic },
    runtime: { entities: entitiesInRels(runtime), relationships: runtime },
  };
}
