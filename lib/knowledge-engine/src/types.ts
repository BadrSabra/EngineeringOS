import type { GraphEntity, GraphRelationship } from "@workspace/db";

export type { GraphEntity, GraphRelationship };

// ─── Knowledge Graph 2.0 types ────────────────────────────────────────────────

/**
 * Typed edge category. Mirrors the scanner's `GraphEdgeType` so consumers of
 * the knowledge-engine do not need to import from the scanner package.
 */
export type GraphEdgeType =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "uses"
  | "emits"
  | "observes"
  | "produces"
  | "depends_on";

/**
 * A single piece of evidence that justifies the existence of an entity or
 * relationship. Used in edge-level queries to return the source location
 * alongside the relationship itself.
 */
export type GraphEvidence = {
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  kind:
    | "import-statement"
    | "call-site"
    | "class-definition"
    | "interface-definition"
    | "jsdoc"
    | "heuristic";
};

export type SemanticTag = string;

/**
 * Composite weight descriptor for a single graph edge.
 * Used by weighted inference algorithms that need more than just confidence.
 */
export type GraphEdgeWeight = {
  confidence: number;
  isHeuristic: boolean;
  isRuntimeObserved: boolean;
  evidenceCount: number;
};

/**
 * Filter options accepted by Knowledge Graph 2.0 query functions.
 * All fields are optional — omitting a field means "no filter on this dimension".
 */
export type GraphQueryFilters = {
  /** Restrict to edges of specific types. */
  edgeTypes?: GraphEdgeType[];
  /** Minimum confidence threshold [0, 1]. */
  minConfidence?: number;
  /** Restrict to edges from specific extraction sources. */
  sourceTypes?: string[];
  /** Require at least one of these semantic tags on each edge. */
  semanticTags?: string[];
  /** When true, return only runtime-observed edges. */
  observedOnly?: boolean;
  /** When true, return only heuristically-inferred edges. */
  heuristicOnly?: boolean;
};

/**
 * A graph view split into semantic layers.
 * Returned by `getLayeredGraphView()` to let callers distinguish structural
 * (AST-derived) facts from behavioral inferences and runtime observations.
 */
export type LayeredGraphView = {
  structural: { entities: GraphEntity[]; relationships: GraphRelationship[] };
  heuristic: { entities: GraphEntity[]; relationships: GraphRelationship[] };
  runtime: { entities: GraphEntity[]; relationships: GraphRelationship[] };
};

/**
 * Summary statistics broken down by knowledge layer.
 * Extends GraphSummaryResult with provenance-aware counts.
 */
export type LayeredGraphSummary = {
  byLayer: {
    structural: { entityCount: number; relationshipCount: number; avgConfidence: number };
    heuristic: { entityCount: number; relationshipCount: number; avgConfidence: number };
    runtime: { entityCount: number; relationshipCount: number; avgConfidence: number };
  };
  byEdgeType: Record<string, number>;
  avgConfidenceOverall: number;
  documentedEntityCount: number;
  undocumentedEntityCount: number;
};

/**
 * A traversal hop — an entity reached during a graph walk,
 * with the relationship that led to it and the depth it was found at.
 */
export type TraversalHop = {
  entity: GraphEntity;
  viaRelationship: GraphRelationship;
  depth: number;
};

/**
 * Result of an impact analysis query:
 * "If this entity changes, what is transitively affected downstream?"
 */
export type ImpactResult = {
  root: GraphEntity;
  impacted: TraversalHop[];
  /** Flat list of all impacted entity IDs for quick membership tests. */
  impactedIds: Set<string>;
  maxDepthReached: number;
};

/**
 * A single step in a path between two entities.
 */
export type PathStep = {
  entity: GraphEntity;
  relationship: GraphRelationship | null; // null only for the root entity
};

/**
 * Result of a shortest-path query between two entities.
 */
export type PathResult =
  | { found: false }
  | { found: true; path: PathStep[]; length: number };

/**
 * Degree centrality for a single entity.
 */
export type CentralityScore = {
  entityId: string;
  entityName: string;
  entityType: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
};

/**
 * A connected component (cluster) in the graph.
 */
export type GraphCluster = {
  id: number;
  entityIds: string[];
  size: number;
};

/**
 * Summary statistics for a project's knowledge graph.
 */
export type GraphSummaryResult = {
  projectId: string;
  entityCount: number;
  relationshipCount: number;
  entitiesByType: Record<string, number>;
  relationsByType: Record<string, number>;
  /** Top N entities by total degree (most connected). */
  topConnected: CentralityScore[];
  /** Average degree across all entities. */
  avgDegree: number;
  /** Number of isolated entities (no relationships). */
  isolatedCount: number;
  /** Number of distinct connected components. */
  clusterCount: number;
};
