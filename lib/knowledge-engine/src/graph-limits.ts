/**
 * Server-side graph safety limits. Keep these conservative: graph responses
 * are consumed by autonomous context readers as well as interactive clients.
 */
export const GRAPH_LIMITS = {
  maxEntities: 80,
  maxRelationships: 60,
  maxTraversalDepth: 4,
  maxSemanticDepth: 4,
  maxTraversalEntities: 80,
  maxTraversalWork: 480,
  maxResponseBytes: 512_000,
} as const;