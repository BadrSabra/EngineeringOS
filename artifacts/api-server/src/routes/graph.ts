import { Router } from "express";
import { db } from "@workspace/db";
import { graphEntitiesTable, graphRelationshipsTable } from "@workspace/db";
import {
  ListGraphEntitiesQueryParams,
  ListGraphRelationshipsQueryParams,
  GetGraphEntityImpactQueryParams,
  GetGraphPathQueryParams,
} from "@workspace/api-zod";
import { eq, and, inArray, gte } from "drizzle-orm";
import {
  getImpactedEntities,
  getShortestPath,
  getHighConfidencePath,
  fetchProjectGraph,
  computeGraphSummary,
  computeLayeredGraphSummary,
  getEdgesByType,
  getEvidenceForNode,
  getSemanticNeighborhood,
  getLayeredGraphView,
  getObservedRuntimeSubgraph,
  annotatePathSteps,
  type GraphQueryFilters,
  type GraphEdgeType,
} from "@workspace/knowledge-engine";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  loadProjectByIdForUser,
  requireProjectAccess,
} from "../middlewares/requireProjectAccess.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

// ─── Shared filter parser ─────────────────────────────────────────────────────

/**
 * Parse KG 2.0 filter params from the raw query object.
 * All params are optional and validated leniently — unknown values are silently
 * ignored so the API is forward-compatible when new edge types are added.
 */
function parseKgFilters(query: Record<string, unknown>): GraphQueryFilters {
  const filters: GraphQueryFilters = {};

  const edgeType = query.relationType;
  if (typeof edgeType === "string" && edgeType) {
    filters.edgeTypes = [edgeType as GraphEdgeType];
  }

  const minConf = query.minConfidence;
  if (typeof minConf === "string") {
    const n = parseFloat(minConf);
    if (!isNaN(n) && n >= 0 && n <= 1) filters.minConfidence = n;
  }

  const srcType = query.sourceType;
  if (typeof srcType === "string" && srcType) {
    filters.sourceTypes = [srcType];
  }

  const semanticTag = query.semanticTag;
  if (typeof semanticTag === "string" && semanticTag) {
    filters.semanticTags = [semanticTag];
  }

  if (query.observedOnly === "true") filters.observedOnly = true;
  if (query.heuristicOnly === "true") filters.heuristicOnly = true;

  return filters;
}

// ─── List graph entities ──────────────────────────────────────────────────────

router.get("/graph/entities", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const params = ListGraphEntitiesQueryParams.parse(req.query);
  const conditions = [eq(graphEntitiesTable.projectId, project.id)];
  if (params.type) conditions.push(eq(graphEntitiesTable.type, params.type));

  // KG 2.0 filters
  const minConf = typeof req.query.minConfidence === "string"
    ? parseFloat(req.query.minConfidence)
    : undefined;
  if (minConf !== undefined && !isNaN(minConf)) {
    conditions.push(gte(graphEntitiesTable.confidence, minConf));
  }

  const srcType = typeof req.query.sourceType === "string" ? req.query.sourceType : undefined;
  if (srcType) conditions.push(eq(graphEntitiesTable.sourceType, srcType));

  if (req.query.documentedOnly === "true") {
    conditions.push(eq(graphEntitiesTable.isDocumented, true));
  }

  const entities = await db
    .select()
    .from(graphEntitiesTable)
    .where(and(...conditions))
    .limit(1000);

  return res.json(entities);
});

// ─── List graph relationships ─────────────────────────────────────────────────

router.get("/graph/relationships", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const params = ListGraphRelationshipsQueryParams.parse(req.query);

  // KG 2.0: if the relationships table has projectId, query directly
  const filters = parseKgFilters(req.query as Record<string, unknown>);
  if (filters.edgeTypes || filters.minConfidence !== undefined ||
      filters.sourceTypes || filters.observedOnly || filters.heuristicOnly) {
    const rels = await getEdgesByType(db, project.id, filters);
    if (params.sourceId) {
      return res.json(rels.filter((r) => r.sourceId === params.sourceId));
    }
    return res.json(rels);
  }

  // Fallback: fetch entity IDs first to scope relationships to the project
  const entities = await db
    .select({ id: graphEntitiesTable.id })
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, project.id))
    .limit(1000);
  const entityIds = new Set(entities.map((e: { id: string }) => e.id));
  if (entityIds.size === 0) return res.json([]);

  const directConditions = [];
  if (params.sourceId)
    directConditions.push(eq(graphRelationshipsTable.sourceId, params.sourceId));

  const rels =
    directConditions.length > 0
      ? await db
          .select()
          .from(graphRelationshipsTable)
          .where(and(...directConditions))
          .limit(1000)
      : await db.select().from(graphRelationshipsTable).limit(1000);

  return res.json(
    rels.filter(
      (r: { sourceId: string; targetId: string }) =>
        entityIds.has(r.sourceId) || entityIds.has(r.targetId),
    ),
  );
});

// ─── Direct neighbors ─────────────────────────────────────────────────────────

// Returns the entity, its outgoing and incoming relationships, and the
// neighboring entities themselves — the minimum needed to treat the graph as
// a navigable structure rather than two flat lists the caller has to join.
router.get("/graph/entities/:entityId/neighbors", async (req, res) => {
  const { entityId } = req.params;

  const entityRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  const ownerProject = await loadProjectByIdForUser(entity.projectId, req.userId, res);
  if (!ownerProject) return;

  const outgoing = await db
    .select()
    .from(graphRelationshipsTable)
    .where(eq(graphRelationshipsTable.sourceId, entityId));
  const incoming = await db
    .select()
    .from(graphRelationshipsTable)
    .where(eq(graphRelationshipsTable.targetId, entityId));

  const neighborIds = new Set<string>();
  for (const r of outgoing) neighborIds.add(r.targetId);
  for (const r of incoming) neighborIds.add(r.sourceId);

  const neighbors =
    neighborIds.size > 0
      ? await db
          .select()
          .from(graphEntitiesTable)
          .where(inArray(graphEntitiesTable.id, [...neighborIds]))
      : [];

  return res.json({ entity, outgoing, incoming, neighbors });
});

// ─── Impact analysis ──────────────────────────────────────────────────────────

// "What is transitively affected if this entity changes?"
// Follows outgoing relationships BFS up to maxDepth hops.
router.get("/graph/impact", async (req, res) => {
  const { entityId, maxDepth } = GetGraphEntityImpactQueryParams.parse(req.query);

  const entityRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  const ownerProject = await loadProjectByIdForUser(entity.projectId, req.userId, res);
  if (!ownerProject) return;

  const result = await getImpactedEntities(db, entityId, maxDepth ?? 4);
  if (!result) return res.status(404).json({ error: "Entity not found" });

  return res.json({
    root: result.root,
    impacted: result.impacted,
    maxDepthReached: result.maxDepthReached,
  });
});

// ─── Shortest path ────────────────────────────────────────────────────────────

// Finds the shortest directed path from one entity to another via BFS.
router.get("/graph/path", async (req, res) => {
  const { fromId, toId, maxDepth } = GetGraphPathQueryParams.parse(req.query);

  const entityRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, fromId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  const ownerProject = await loadProjectByIdForUser(entity.projectId, req.userId, res);
  if (!ownerProject) return;

  // Use high-confidence path if minConfidence is specified
  const minConf = typeof req.query.minConfidence === "string"
    ? parseFloat(req.query.minConfidence)
    : undefined;

  const result =
    minConf !== undefined && !isNaN(minConf)
      ? await getHighConfidencePath(db, fromId, toId, minConf, maxDepth ?? 5)
      : await getShortestPath(db, fromId, toId, maxDepth ?? 5);

  // PR-03: always annotate path steps so the response explains *why* each hop
  // was traversed (confidence, sourceType, evidence) rather than returning
  // pure topology. The root step carries null confidence/evidence so the
  // shape is uniform across all steps and easy to iterate.
  if (!result.found) return res.json(result);

  return res.json({
    found: true,
    path: annotatePathSteps(result.path),
    length: result.length,
    ...(minConf !== undefined && !isNaN(minConf)
      ? { minConfidenceApplied: minConf }
      : {}),
  });
});

// ─── Graph summary ────────────────────────────────────────────────────────────

// Aggregate statistics for a project's knowledge graph: entity/relationship
// counts by type, degree centrality, cluster count, and isolated node count.
router.get("/graph/summary/:projectId", requireProjectAccess, async (req, res) => {
  const project = req.project!;
  const { entities, relationships } = await fetchProjectGraph(db, project.id);
  const summary = computeGraphSummary(project.id, entities, relationships);
  const layered = computeLayeredGraphSummary(entities, relationships);
  return res.json({ ...summary, layered });
});

// ─── Knowledge Graph 2.0 endpoints ───────────────────────────────────────────

/**
 * GET /graph/subgraph
 * Return a project-scoped subgraph filtered by KG 2.0 metadata dimensions:
 * relationType, minConfidence, sourceType, observedOnly, heuristicOnly.
 *
 * Query params:
 *   projectId      — required
 *   relationType   — filter by edge type (imports | calls | extends | …)
 *   minConfidence  — minimum confidence [0, 1]
 *   sourceType     — filter by extraction source (typescript-ast | python-ast | …)
 *   semanticTag    — require this tag on at least one edge endpoint
 *   observedOnly   — true → runtime-observed edges only
 *   heuristicOnly  — true → heuristic-inferred edges only
 */
router.get("/graph/subgraph", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const filters = parseKgFilters(req.query as Record<string, unknown>);
  // PR-03: getLayeredGraphView now returns LayeredGraphViewWithProvenance.
  // Avoid destructuring non-existent top-level `entities`/`relationships` keys —
  // those fields live inside each layer, not at the root of the view.
  const view = await getLayeredGraphView(db, project.id, filters);

  // Flatten all layers so the caller gets a combined filtered view
  const allRels = [
    ...view.structural.relationships,
    ...view.heuristic.relationships,
    ...view.runtime.relationships,
  ];
  const allEntities = [
    ...view.structural.entities,
    ...view.heuristic.entities,
    ...view.runtime.entities,
  ].filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i);

  return res.json({
    entities: allEntities,
    relationships: [...new Map(allRels.map((r) => [r.id, r])).values()],
    filters,
    // PR-03: each layer now includes provenance statistics alongside counts
    // so callers can see not just how many edges are in each layer but
    // how trustworthy they are and where they came from.
    layered: {
      structural: {
        entityCount: view.structural.entities.length,
        relationshipCount: view.structural.relationships.length,
        ...view.provenanceStats.structural,
      },
      heuristic: {
        entityCount: view.heuristic.entities.length,
        relationshipCount: view.heuristic.relationships.length,
        ...view.provenanceStats.heuristic,
      },
      runtime: {
        entityCount: view.runtime.entities.length,
        relationshipCount: view.runtime.relationships.length,
        ...view.provenanceStats.runtime,
      },
    },
  });
});

/**
 * GET /graph/semantic-neighborhood
 * Return entities within `depth` hops from a given entity, with optional
 * KG 2.0 filters applied to each traversal hop.
 *
 * Query params:
 *   entityId       — required
 *   depth          — hop limit (default 2, max 4)
 *   relationType, minConfidence, observedOnly, heuristicOnly — see /graph/subgraph
 */
router.get("/graph/semantic-neighborhood", async (req, res) => {
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  if (!entityId) return res.status(400).json({ error: "entityId is required" });

  const entityRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  const ownerProject = await loadProjectByIdForUser(entity.projectId, req.userId, res);
  if (!ownerProject) return;

  const depth =
    typeof req.query.depth === "string" ? Math.min(parseInt(req.query.depth, 10) || 2, 4) : 2;
  const filters = parseKgFilters(req.query as Record<string, unknown>);

  const result = await getSemanticNeighborhood(db, entityId, depth, filters);
  return res.json(result);
});

/**
 * GET /graph/evidence/:entityId
 * Return all evidence records attached to outgoing relationships from an entity.
 * Each item contains the relationship and its evidence array (file, line, snippet, kind).
 */
router.get("/graph/evidence/:entityId", async (req, res) => {
  const { entityId } = req.params;

  const entityRows = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: "Entity not found" });

  const ownerProject = await loadProjectByIdForUser(entity.projectId, req.userId, res);
  if (!ownerProject) return;

  const evidence = await getEvidenceForNode(db, entityId);
  // PR-03: lift entity.provenance to a dedicated key so callers can immediately
  // see who extracted this entity without parsing the full entity row.
  // Each item in `evidence` is now an EvidenceBundle with confidence,
  // sourceType, isHeuristic, isRuntimeObserved, and provenanceSummary.
  return res.json({
    entity,
    entityProvenance: entity.provenance ?? null,
    evidence,
  });
});

/**
 * GET /graph/runtime-subgraph/:projectId
 * Return only the runtime-observed subgraph for a project.
 * These edges have the highest trust level — observed in a live environment.
 */
router.get("/graph/runtime-subgraph/:projectId", requireProjectAccess, async (req, res) => {
  const project = req.project!;
  const result = await getObservedRuntimeSubgraph(db, project.id);
  return res.json(result);
});

export default router;
