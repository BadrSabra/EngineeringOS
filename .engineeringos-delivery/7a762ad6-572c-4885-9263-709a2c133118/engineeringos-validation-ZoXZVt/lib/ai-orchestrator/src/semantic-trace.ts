import { z } from "zod";

export const TraceStatusSchema = z.enum(["PROVEN", "NOT_PROVEN", "OUT_OF_SCOPE"]);

// ── AI-OBJ-004: Production Reachability Proof Object ───────────────────────────

/**
 * The relationship kind asserted by a ReachabilityEdge.
 *
 * CRITICAL RULE (AI-OBJ-004): IMPORT_ONLY edges can NEVER have `proven: true`.
 * An import statement shows that a symbol is *accessible* but does not prove
 * that it is ever *called* or that its output is *consumed*. Only
 * DIRECT_INVOCATION, DATA_FLOW, EXTENDS, and IMPLEMENTS edges can carry a
 * proven status, and only when a sourceSpan backs them up.
 */
export const ReachabilityRelationshipSchema = z.enum([
  /** A runtime call-site: `foo()`, `obj.method()`, `new Cls()`. Proven = allowed. */
  "DIRECT_INVOCATION",
  /** The return value / output of `from` reaches `to` (data-flow). Proven = allowed. */
  "DATA_FLOW",
  /** `to` is imported by `from` — accessibility, NOT execution proof. Proven = NEVER. */
  "IMPORT_ONLY",
  /** Class / interface extension (`class A extends B`). Proven = allowed with span. */
  "EXTENDS",
  /** Interface implementation (`class A implements B`). Proven = allowed with span. */
  "IMPLEMENTS",
  /** Fallback when the relationship cannot be classified. Proven = NEVER. */
  "UNKNOWN",
]);
export type ReachabilityRelationship = z.infer<typeof ReachabilityRelationshipSchema>;

/**
 * AI-OBJ-004: an explicit, source-backed proof object for one hop of a
 * production reachability chain.
 *
 * `proven` is set by `classifyReachabilityEdge` — callers MUST NOT set it
 * manually. The structural rule is enforced there: import-only and unknown
 * relationships can never produce a proven edge.
 */
/**
 * The set of relationship kinds whose edges can never carry `proven: true`.
 * Defined before the schema so the Zod `.refine()` can reference it.
 */
const SCHEMA_UNPROVABLE_RELATIONSHIPS: ReadonlySet<string> = new Set([
  "IMPORT_ONLY",
  "UNKNOWN",
]);

export const ReachabilityEdgeSchema = z.object({
  fromFile: z.string().min(1),
  fromSymbol: z.string().min(1),
  toFile: z.string().min(1),
  toSymbol: z.string().min(1),
  /**
   * The exact source location in `fromFile` where the relationship is asserted.
   * Required for `proven: true`; edges without a span are automatically NOT proven.
   */
  sourceSpan: z.object({
    file: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    snippet: z.string().min(1).optional(),
  }).strict().optional(),
  relationship: ReachabilityRelationshipSchema,
  /**
   * True only when: (a) relationship is DIRECT_INVOCATION, DATA_FLOW, EXTENDS,
   * or IMPLEMENTS; AND (b) a sourceSpan is present. IMPORT_ONLY and UNKNOWN are
   * structurally blocked — this field cannot be set to `true` for them even if
   * the caller tries.
   *
   * The Zod `.refine()` below enforces this at parse time so that deserialized
   * edges from external sources cannot bypass the invariant.
   */
  proven: z.boolean(),
}).strict().refine(
  (edge) => {
    // An unprovable relationship must never have proven: true.
    if (SCHEMA_UNPROVABLE_RELATIONSHIPS.has(edge.relationship) && edge.proven) return false;
    // A proven edge without a sourceSpan is also invalid.
    if (edge.proven && !edge.sourceSpan) return false;
    // The sourceSpan must be an ordered location inside fromFile. A proven edge
    // backed by a span in a different file would let evidence from an unrelated
    // file structurally prove a caller edge (undermining the source-backed model).
    if (edge.sourceSpan) {
      if (edge.sourceSpan.startLine > edge.sourceSpan.endLine) return false;
      if (edge.proven && edge.sourceSpan.file !== edge.fromFile) return false;
    }
    return true;
  },
  {
    message:
      "proven:true requires a provable relationship (DIRECT_INVOCATION, DATA_FLOW, EXTENDS, or IMPLEMENTS) " +
      "and a sourceSpan located in fromFile with startLine <= endLine; " +
      "IMPORT_ONLY and UNKNOWN edges can never be proven",
  },
);
export type ReachabilityEdge = z.infer<typeof ReachabilityEdgeSchema>;

/** Relationships that are structurally incapable of proving production reachability. */
const UNPROVABLE_RELATIONSHIPS: ReadonlySet<ReachabilityRelationship> = new Set([
  "IMPORT_ONLY",
  "UNKNOWN",
]);

/**
 * AI-OBJ-004: classify and normalize a ReachabilityEdge candidate.
 *
 * Enforces the structural rule:
 *   - IMPORT_ONLY / UNKNOWN → `proven` is always `false`, regardless of whether
 *     a sourceSpan was supplied.
 *   - All other relationships → `proven` is `true` iff a sourceSpan is present.
 *
 * Use this instead of constructing ReachabilityEdge objects directly so the
 * invariant is enforced at construction time, not only in the Zod refine.
 */
export function classifyReachabilityEdge(
  candidate: Omit<ReachabilityEdge, "proven">,
): ReachabilityEdge {
  // proven requires: a provable relationship, a sourceSpan, an ordered span,
  // and a span located in the SAME file as fromFile. A span from an unrelated
  // file cannot structurally back a caller edge (AI-OBJ-004 source-backed model).
  const provable = !UNPROVABLE_RELATIONSHIPS.has(candidate.relationship) && Boolean(candidate.sourceSpan);
  const spanValid =
    candidate.sourceSpan === undefined ||
    (candidate.sourceSpan.startLine <= candidate.sourceSpan.endLine &&
      candidate.sourceSpan.file === candidate.fromFile);
  const proven = provable && spanValid;
  return { ...candidate, proven };
}

/** Re-normalize an edge whose `proven` flag may have been set by a direct
 *  object construction or deserialization that bypassed `classifyReachabilityEdge`. */
function normalizeEdge(edge: ReachabilityEdge): ReachabilityEdge {
  // Structurally, proven can only be true when the relationship is provable AND
  // a sourceSpan exists that is ordered and located in fromFile. Clamp any edge
  // that violates this invariant.
  if (
    edge.proven &&
    (UNPROVABLE_RELATIONSHIPS.has(edge.relationship) ||
      !edge.sourceSpan ||
      edge.sourceSpan.startLine > edge.sourceSpan.endLine ||
      edge.sourceSpan.file !== edge.fromFile)
  ) {
    return { ...edge, proven: false };
  }
  return edge;
}

export type ReachabilityProofStatus =
  | "PROVEN"
  | "PARTIALLY_PROVEN"
  | "NOT_PROVEN"
  | "NO_EDGES";

export type ReachabilityProofSummary = {
  status: ReachabilityProofStatus;
  provenCount: number;
  totalCount: number;
  /**
   * Edges that remain NOT proven (including import-only hops). Bounded to 8 for
   * safe serialization.
   */
  blockedEdges: ReachabilityEdge[];
  /** True when any edge used IMPORT_ONLY as its relationship. */
  hasImportOnlyHops: boolean;
};

/**
 * AI-OBJ-004: summarize the proof status of a reachability chain.
 *
 * PROVEN = every edge in the chain is proven.
 * PARTIALLY_PROVEN = at least one proven edge, but not all.
 * NOT_PROVEN = no edge is proven (includes all-import-only chains).
 * NO_EDGES = the chain is empty (caller provided no edges).
 *
 * Each edge is defensively normalized through `normalizeEdge` before the
 * count, so edges that were constructed directly (bypassing
 * `classifyReachabilityEdge`) and carry a stale `proven: true` for an
 * IMPORT_ONLY or UNKNOWN relationship are clamped to `proven: false`.
 */
export function buildReachabilityProofSummary(
  edges: readonly ReachabilityEdge[],
): ReachabilityProofSummary {
  if (edges.length === 0) {
    return { status: "NO_EDGES", provenCount: 0, totalCount: 0, blockedEdges: [], hasImportOnlyHops: false };
  }
  // Normalize every edge so stale/bypassed proven flags are corrected.
  const normalized = edges.map(normalizeEdge);
  const proven = normalized.filter((e) => e.proven);
  const blocked = normalized.filter((e) => !e.proven);
  const hasImportOnlyHops = normalized.some((e) => e.relationship === "IMPORT_ONLY");
  let status: ReachabilityProofStatus;
  if (proven.length === normalized.length) {
    status = "PROVEN";
  } else if (proven.length > 0) {
    status = "PARTIALLY_PROVEN";
  } else {
    status = "NOT_PROVEN";
  }
  return {
    status,
    provenCount: proven.length,
    totalCount: normalized.length,
    blockedEdges: blocked.slice(0, 8),
    hasImportOnlyHops,
  };
}
export type TraceStatus = z.infer<typeof TraceStatusSchema>;

export const TraceStageSchema = z.enum([
  "ENTRY_POINT",
  "API_ROUTE",
  "ORCHESTRATOR",
  "TOOL_PROVIDER",
  "PERSISTENCE_OUTPUT",
  "OTHER",
]);
export type TraceStage = z.infer<typeof TraceStageSchema>;

export const SemanticTraceNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1).optional(),
  stage: TraceStageSchema.default("OTHER"),
}).strict();
export type SemanticTraceNode = z.infer<typeof SemanticTraceNodeSchema>;

export const SemanticTraceEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
  status: TraceStatusSchema,
  source: z.string().min(1).optional(),
  evidence: z.string().min(1).optional(),
  sourceSpan: z.object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().nonnegative().optional(),
    snippet: z.string().min(1).optional(),
  }).strict().optional(),
  runtimeObserved: z.boolean().default(false),
}).strict();
export type SemanticTraceEdge = z.infer<typeof SemanticTraceEdgeSchema>;

export const CrossFileSemanticTraceSchema = z.object({
  status: TraceStatusSchema,
  nodes: z.array(SemanticTraceNodeSchema),
  edges: z.array(SemanticTraceEdgeSchema),
  maxDepth: z.number().int().min(1).max(8),
  reason: z.string().min(1).optional(),
}).strict();
export type CrossFileSemanticTrace = z.infer<typeof CrossFileSemanticTraceSchema>;

export const ProductionReachabilityTraceSchema = z.object({
  status: TraceStatusSchema,
  nodes: z.array(SemanticTraceNodeSchema),
  edges: z.array(SemanticTraceEdgeSchema),
  reason: z.string().min(1).optional(),
}).strict();
export type ProductionReachabilityTrace = z.infer<typeof ProductionReachabilityTraceSchema>;

export type SemanticGraphNode = {
  id?: string;
  name: string;
  path?: string;
  type?: string;
  stage?: TraceStage;
};

export type SemanticGraphEdge = {
  source: string;
  target: string;
  relation: string;
  sourcePath?: string;
  evidence?: string;
  sourceSpan?: {
    file: string;
    line: number;
    column?: number;
    snippet?: string;
  };
  runtimeObserved?: boolean;
};

export type ProductionTraceLink = {
  from: SemanticTraceNode;
  to: SemanticTraceNode;
  relation: string;
  source?: string;
  evidence?: string;
  runtimeObserved?: boolean;
  outOfScope?: boolean;
};

function nodeId(node: SemanticGraphNode): string {
  return node.id?.trim() || (node.path ? `${node.path}#${node.name}` : node.name);
}

function nodeStage(node: SemanticGraphNode): TraceStage {
  if (node.stage) return node.stage;
  const text = `${node.type ?? ""} ${node.name} ${node.path ?? ""}`.toLowerCase();
  if (/\b(entry|handler|main|bootstrap)\b/.test(text)) return "ENTRY_POINT";
  if (/\b(api|route|endpoint|controller)\b/.test(text)) return "API_ROUTE";
  if (/\b(orchestrat|service|agent)\b/.test(text)) return "ORCHESTRATOR";
  if (/\b(tool|provider|client|adapter)\b/.test(text)) return "TOOL_PROVIDER";
  if (/\b(db|database|persist|store|output|response)\b/.test(text)) return "PERSISTENCE_OUTPUT";
  return "OTHER";
}

function resolveNode(
  value: string,
  nodesById: Map<string, SemanticGraphNode>,
): SemanticGraphNode | undefined {
  const direct = nodesById.get(value);
  if (direct) return direct;
  for (const [id, node] of nodesById) {
    if (node.name === value || id.endsWith(`#${value}`)) return node;
  }
  return undefined;
}

/**
 * Build a bounded graph path. Missing provenance does not disappear: the edge
 * remains visible as NOT_PROVEN so a caller can distinguish "no path" from
 * "path exists but its source link is weak".
 */
export function buildCrossFileSemanticTrace(input: {
  nodes: readonly SemanticGraphNode[];
  edges: readonly SemanticGraphEdge[];
  from: string;
  to: string;
  maxDepth?: number;
}): CrossFileSemanticTrace {
  const maxDepth = Math.max(1, Math.min(input.maxDepth ?? 4, 8));
  const nodesById = new Map(input.nodes.map((node) => [nodeId(node), node]));
  const start = resolveNode(input.from, nodesById);
  const target = resolveNode(input.to, nodesById);
  if (!start || !target) {
    return {
      status: "OUT_OF_SCOPE",
      nodes: [],
      edges: [],
      maxDepth,
      reason: "trace endpoints are outside the supplied graph scope",
    };
  }

  const adjacency = new Map<string, SemanticGraphEdge[]>();
  for (const edge of input.edges) {
    const from = resolveNode(edge.source, nodesById);
    const to = resolveNode(edge.target, nodesById);
    if (!from || !to) continue;
    const list = adjacency.get(nodeId(from)) ?? [];
    list.push(edge);
    adjacency.set(nodeId(from), list);
  }

  type QueueItem = { id: string; path: SemanticGraphEdge[]; visited: Set<string> };
  const queue: QueueItem[] = [{
    id: nodeId(start),
    path: [],
    visited: new Set([nodeId(start)]),
  }];
  let found: SemanticGraphEdge[] | undefined;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === nodeId(target)) {
      found = current.path;
      break;
    }
    if (current.path.length >= maxDepth) continue;
    for (const edge of adjacency.get(current.id) ?? []) {
      const next = resolveNode(edge.target, nodesById);
      if (!next) continue;
      const nextId = nodeId(next);
      if (current.visited.has(nextId)) continue;
      queue.push({
        id: nextId,
        path: [...current.path, edge],
        visited: new Set([...current.visited, nextId]),
      });
    }
  }

  if (!found) {
    return {
      status: "NOT_PROVEN",
      nodes: [start, target].map((node) => ({
        id: nodeId(node),
        name: node.name,
        ...(node.path ? { path: node.path } : {}),
        stage: nodeStage(node),
      })),
      edges: [],
      maxDepth,
      reason: "no bounded path was found between the supplied endpoints",
    };
  }

  const traceNodes: SemanticTraceNode[] = [{
    id: nodeId(start),
    name: start.name,
    ...(start.path ? { path: start.path } : {}),
    stage: nodeStage(start),
  }];
  const traceEdges = found.map((edge) => {
    const from = resolveNode(edge.source, nodesById)!;
    const to = resolveNode(edge.target, nodesById)!;
    traceNodes.push({
      id: nodeId(to),
      name: to.name,
      ...(to.path ? { path: to.path } : {}),
      stage: nodeStage(to),
    });
    return {
      from: nodeId(from),
      to: nodeId(to),
      relation: edge.relation,
      status: edge.evidence ? "PROVEN" : "NOT_PROVEN",
      ...(edge.sourcePath ? { source: edge.sourcePath } : {}),
      ...(edge.evidence ? { evidence: edge.evidence } : {}),
      ...(edge.sourceSpan ? { sourceSpan: edge.sourceSpan } : {}),
      runtimeObserved: Boolean(edge.runtimeObserved),
    } satisfies z.input<typeof SemanticTraceEdgeSchema>;
  });
  const status = traceEdges.every((edge) => edge.status === "PROVEN")
    ? "PROVEN"
    : "NOT_PROVEN";
  return { status, nodes: traceNodes, edges: traceEdges, maxDepth };
}

/**
 * Production reachability is stricter than static graph connectivity. Static
 * imports/calls can describe a plausible path, but only runtime-observed,
 * evidenced links can promote the final status to PROVEN.
 */
export function buildProductionReachabilityTrace(
  links: readonly ProductionTraceLink[],
): ProductionReachabilityTrace {
  if (links.length === 0) {
    return {
      status: "OUT_OF_SCOPE",
      nodes: [],
      edges: [],
      reason: "no production trace links were supplied",
    };
  }
  const nodes: SemanticTraceNode[] = [];
  const seen = new Set<string>();
  const edges = links.map((link) => {
    for (const node of [link.from, link.to]) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        nodes.push(node);
      }
    }
    const status: TraceStatus = link.outOfScope
      ? "OUT_OF_SCOPE"
      : link.runtimeObserved && Boolean(link.evidence)
        ? "PROVEN"
        : "NOT_PROVEN";
    return {
      from: link.from.id,
      to: link.to.id,
      relation: link.relation,
      status,
      ...(link.source ? { source: link.source } : {}),
      ...(link.evidence ? { evidence: link.evidence } : {}),
      runtimeObserved: Boolean(link.runtimeObserved),
    };
  });
  const status = edges.some((edge) => edge.status === "OUT_OF_SCOPE")
    ? "OUT_OF_SCOPE"
    : edges.every((edge) => edge.status === "PROVEN")
      ? "PROVEN"
      : "NOT_PROVEN";
  return { status, nodes, edges };
}