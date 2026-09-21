import { z } from "zod";

export const EvidenceGraphNodeKindSchema = z.enum([
  "FILE",
  "SYMBOL",
  "CLAIM",
  "SUB_QUERY",
  "VERDICT",
]);
export type EvidenceGraphNodeKind = z.infer<typeof EvidenceGraphNodeKindSchema>;

export const EvidenceGraphVerdictSchema = z.enum([
  "PROVEN",
  "CONTRADICTED",
  "INCOMPLETE",
  "NOT_PROVEN",
]);
export type EvidenceGraphVerdict = z.infer<typeof EvidenceGraphVerdictSchema>;

export const EvidenceGraphNodeSchema = z.object({
  id: z.string().min(1).max(300),
  kind: EvidenceGraphNodeKindSchema,
  label: z.string().min(1).max(500),
  path: z.string().min(1).max(500).optional(),
  status: EvidenceGraphVerdictSchema.optional(),
  synthetic: z.boolean().optional(),
}).strict();
export type EvidenceGraphNode = z.infer<typeof EvidenceGraphNodeSchema>;

export const EvidenceGraphEdgeSchema = z.object({
  id: z.string().min(1).max(500),
  from: z.string().min(1).max(300),
  to: z.string().min(1).max(300),
  relation: z.enum([
    "CONTAINS",
    "SUPPORTS",
    "INVESTIGATED_BY",
    "CONTRIBUTES_TO",
    "CONTRADICTS",
  ]),
  evidenceKeys: z.array(z.string().min(1).max(500)).max(24).optional(),
}).strict();
export type EvidenceGraphEdge = z.infer<typeof EvidenceGraphEdgeSchema>;

export const EvidenceGraphReadSchema = z.object({
  key: z.string().min(1).max(500),
  path: z.string().min(1).max(500),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  truncated: z.boolean(),
  taskIndexes: z.array(z.number().int().nonnegative()).max(32),
}).strict();
export type EvidenceGraphRead = z.infer<typeof EvidenceGraphReadSchema>;

export const EvidenceGraphSchema = z.object({
  version: z.literal(1),
  sourceRevision: z.string().min(1).optional(),
  nodes: z.array(EvidenceGraphNodeSchema).max(400),
  edges: z.array(EvidenceGraphEdgeSchema).max(800),
  reads: z.array(EvidenceGraphReadSchema).max(240),
  contradictionClaimIds: z.array(z.string().min(1)).max(64),
}).strict();
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;

export type EvidenceGraphSourceEvidence = {
  file: string;
  startLine: number;
  endLine: number;
  truncated?: boolean;
  taskIndex?: number;
};

export type EvidenceGraphSubQuery = {
  taskIndex: number;
  intent: string;
  status: "complete" | "partial" | "failed" | "cancelled" | "exhausted";
  sourceEvidence: readonly EvidenceGraphSourceEvidence[];
  targetPaths?: readonly string[];
};

export type EvidenceGraphClaim = {
  claimId: string;
  text: string;
  requiredEvidencePaths?: readonly string[];
};

export type EvidenceGraphSymbol = {
  id?: string;
  name: string;
  path?: string;
};

export type EvidenceGraphTrace = {
  nodes: readonly EvidenceGraphSymbol[];
};

export type BuildEvidenceGraphInput = {
  sourceEvidence: readonly EvidenceGraphSourceEvidence[];
  subQueries: readonly EvidenceGraphSubQuery[];
  claims?: readonly EvidenceGraphClaim[];
  claimStatuses?: Readonly<Record<string, EvidenceGraphVerdict>>;
  contradictionClaimIds?: readonly string[];
  crossFileTraces?: readonly EvidenceGraphTrace[];
  sourceRevision?: string;
};

const EVIDENCE_GRAPH_LABEL_MAX = 500;

function boundedNodeLabel(value: string): string {
  return value.length <= EVIDENCE_GRAPH_LABEL_MAX
    ? value
    : `${value.slice(0, EVIDENCE_GRAPH_LABEL_MAX - 1)}…`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
}

function nodeId(kind: EvidenceGraphNodeKind, value: string): string {
  return `${kind.toLocaleLowerCase()}:${value}`;
}

function readKey(read: EvidenceGraphSourceEvidence): string {
  return `${normalizePath(read.file)}:${read.startLine}:${read.endLine}`;
}

function pathsOverlap(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function addNode(
  nodes: Map<string, EvidenceGraphNode>,
  node: EvidenceGraphNode,
): void {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, {
      ...node,
      label: boundedNodeLabel(node.label),
    });
  }
}

function addEdge(
  edges: Map<string, EvidenceGraphEdge>,
  from: string,
  to: string,
  relation: EvidenceGraphEdge["relation"],
  evidenceKeys: readonly string[] = [],
): void {
  const id = `${from}->${relation}->${to}`;
  const existing = edges.get(id);
  if (existing) {
    existing.evidenceKeys = [...new Set([
      ...(existing.evidenceKeys ?? []),
      ...evidenceKeys,
    ])].slice(0, 24);
    return;
  }
  edges.set(id, {
    id,
    from,
    to,
    relation,
    ...(evidenceKeys.length > 0 ? { evidenceKeys: [...new Set(evidenceKeys)].slice(0, 24) } : {}),
  });
}

/**
 * Build the canonical metadata graph shared by all sub-query receipts.
 *
 * Source bodies are deliberately absent. The graph references read windows by
 * stable keys; bodies remain in the durable evidence snapshot/read store.
 */
export function buildEvidenceGraph(input: BuildEvidenceGraphInput): EvidenceGraph {
  const nodes = new Map<string, EvidenceGraphNode>();
  const edges = new Map<string, EvidenceGraphEdge>();
  const reads = new Map<string, EvidenceGraphRead>();
  const normalizedEvidence = input.sourceEvidence.map((read) => ({
    ...read,
    file: normalizePath(read.file),
  })).filter((read) => read.file && read.startLine > 0 && read.endLine >= read.startLine);

  for (const read of normalizedEvidence) {
    const key = readKey(read);
    const existing = reads.get(key);
    reads.set(key, {
      key,
      path: read.file,
      startLine: read.startLine,
      endLine: read.endLine,
      truncated: Boolean(existing?.truncated || read.truncated),
      taskIndexes: [...new Set([
        ...(existing?.taskIndexes ?? []),
        ...(read.taskIndex === undefined ? [] : [read.taskIndex]),
      ])].slice(0, 32),
    });
    addNode(nodes, {
      id: nodeId("FILE", read.file),
      kind: "FILE",
      label: read.file,
      path: read.file,
    });
  }

  const claims: EvidenceGraphClaim[] = input.claims && input.claims.length > 0
    ? [...input.claims]
    : input.subQueries.map((subQuery): EvidenceGraphClaim => ({
        claimId: `subquery:${subQuery.taskIndex}`,
        text: subQuery.intent,
      }));
  const contradictionClaimIds = [...new Set(input.contradictionClaimIds ?? [])];
  const claimStatus = (claim: EvidenceGraphClaim): EvidenceGraphVerdict => {
    if (contradictionClaimIds.includes(claim.claimId)) return "CONTRADICTED";
    if (input.claimStatuses?.[claim.claimId]) return input.claimStatuses[claim.claimId]!;
    const claimPaths = claim.requiredEvidencePaths ?? [];
    const hasEvidence = normalizedEvidence.some((read) =>
      claimPaths.some((path) => pathsOverlap(read.file, path)),
    );
    return hasEvidence ? "INCOMPLETE" : "NOT_PROVEN";
  };

  for (const claim of claims) {
    const status = claimStatus(claim);
    addNode(nodes, {
      id: nodeId("CLAIM", claim.claimId),
      kind: "CLAIM",
      label: claim.text,
      status,
      ...(claim.claimId.startsWith("subquery:") ? { synthetic: true } : {}),
    });
    const claimPaths = claim.requiredEvidencePaths ?? [];
    for (const read of normalizedEvidence) {
      if (claimPaths.some((path) => pathsOverlap(read.file, path))) {
        addEdge(
          edges,
          nodeId("FILE", read.file),
          nodeId("CLAIM", claim.claimId),
          "SUPPORTS",
          [readKey(read)],
        );
      }
    }
  }

  const symbolNodes = new Map<string, EvidenceGraphSymbol>();
  for (const trace of input.crossFileTraces ?? []) {
    for (const symbol of trace.nodes) {
      if (!symbol.name.trim()) continue;
      const path = symbol.path ? normalizePath(symbol.path) : undefined;
      const id = nodeId("SYMBOL", symbol.id?.trim() || `${path ?? ""}#${symbol.name}`);
      if (symbolNodes.has(id)) continue;
      symbolNodes.set(id, { ...symbol, ...(path ? { path } : {}) });
      addNode(nodes, {
        id,
        kind: "SYMBOL",
        label: symbol.name,
        ...(path ? { path } : {}),
      });
      if (path) {
        addNode(nodes, {
          id: nodeId("FILE", path),
          kind: "FILE",
          label: path,
          path,
        });
        addEdge(edges, nodeId("FILE", path), id, "CONTAINS");
        for (const claim of claims) {
          if ((claim.requiredEvidencePaths ?? []).some((claimPath) => pathsOverlap(path, claimPath))) {
            addEdge(edges, id, nodeId("CLAIM", claim.claimId), "SUPPORTS");
          }
        }
      }
    }
  }

  for (const subQuery of input.subQueries) {
    const subQueryId = nodeId("SUB_QUERY", String(subQuery.taskIndex));
    addNode(nodes, {
      id: subQueryId,
      kind: "SUB_QUERY",
      label: subQuery.intent,
      status: subQuery.status === "complete" || subQuery.status === "partial"
        ? "PROVEN"
        : "INCOMPLETE",
    });
    const subQueryReads = subQuery.sourceEvidence.map(readKey);
    const subQueryPaths = [
      ...(subQuery.targetPaths ?? []),
      ...subQuery.sourceEvidence.map((read) => read.file),
    ];
    for (const claim of claims) {
      const claimId = nodeId("CLAIM", claim.claimId);
      const claimPaths = claim.requiredEvidencePaths ?? [];
      const linkedByRead = subQuery.sourceEvidence.some((read) =>
        claimPaths.some((path) => pathsOverlap(read.file, path)),
      );
      const linkedByIntent = claim.text
        .split(/\s+/u)
        .filter((token) => token.length >= 4)
        .some((token) => subQuery.intent.toLocaleLowerCase().includes(token.toLocaleLowerCase()));
      const linkedByTarget = claimPaths.some((path) =>
        subQueryPaths.some((subQueryPath) => pathsOverlap(path, subQueryPath)),
      );
      if (linkedByRead || linkedByIntent || linkedByTarget) {
        addEdge(edges, claimId, subQueryId, "INVESTIGATED_BY", subQueryReads);
      }
      const verdictId = nodeId("VERDICT", claim.claimId);
      addNode(nodes, {
        id: verdictId,
        kind: "VERDICT",
        label: `${claim.claimId} verdict`,
        status: claimStatus(claim),
      });
      if (linkedByRead || linkedByIntent || linkedByTarget) {
        addEdge(edges, subQueryId, verdictId, "CONTRIBUTES_TO", subQueryReads);
      }
    }
  }

  for (const claimId of contradictionClaimIds) {
    const claimNodeId = nodeId("CLAIM", claimId);
    const verdictNodeId = nodeId("VERDICT", claimId);
    if (nodes.has(claimNodeId) && nodes.has(verdictNodeId)) {
      addEdge(edges, claimNodeId, verdictNodeId, "CONTRADICTS");
    }
  }

  return EvidenceGraphSchema.parse({
    version: 1,
    ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    nodes: [...nodes.values()].slice(0, 400),
    edges: [...edges.values()].slice(0, 800),
    reads: [...reads.values()].slice(0, 240),
    contradictionClaimIds: contradictionClaimIds.slice(0, 64),
  });
}