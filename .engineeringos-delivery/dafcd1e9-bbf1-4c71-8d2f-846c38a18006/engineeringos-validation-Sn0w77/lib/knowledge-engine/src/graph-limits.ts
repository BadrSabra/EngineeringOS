/**
 * Server-side graph safety limits. Keep these conservative: graph responses
 * are consumed by autonomous context readers as well as interactive clients.
 */
export const GRAPH_LIMITS = {
  maxEntities: 500,
  maxRelationships: 1_000,
  maxTraversalDepth: 8,
  maxSemanticDepth: 4,
  maxTraversalEntities: 1_000,
  maxTraversalWork: 2_000,
  maxResponseBytes: 512_000,
} as const;