/**
 * @workspace/knowledge-engine
 *
 * Semantic query and inference layer over the knowledge graph.
 *
 * Provides:
 *  - Typed graph traversal queries (impact, path, neighbourhood)
 *  - In-memory inference (centrality, cluster detection, summary stats)
 *  - All functions are pure (no writes, no side effects)
 */

export type {
  GraphEntity,
  GraphRelationship,
  TraversalHop,
  ImpactResult,
  PathStep,
  PathResult,
  CentralityScore,
  GraphCluster,
  GraphSummaryResult,
  // Knowledge Graph 2.0
  GraphEdgeType,
  GraphEvidence,
  SemanticTag,
  GraphEdgeWeight,
  GraphQueryFilters,
  LayeredGraphView,
  LayeredGraphSummary,
} from "./types.js";

export {
  getImpactedEntities,
  getShortestPath,
  getNeighborhood,
  fetchProjectGraph,
  // Knowledge Graph 2.0
  getEdgesByType,
  getEvidenceForNode,
  getSemanticNeighborhood,
  getHighConfidencePath,
  getObservedRuntimeSubgraph,
  getLayeredGraphView,
} from "./queries.js";

export {
  computeCentrality,
  detectClusters,
  computeGraphSummary,
  // Knowledge Graph 2.0
  rankEdgesByConfidence,
  computeWeightedCentrality,
  detectSemanticClusters,
  computeLayeredGraphSummary,
} from "./inference.js";
