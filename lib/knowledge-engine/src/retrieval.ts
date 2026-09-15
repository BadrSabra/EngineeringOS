import { db as DbType } from "@workspace/db";
import {
  findFileEntities,
  getNeighborhood,
  searchNodes,
} from "./queries.js";
import type { GraphEntity, GraphRelationship } from "./types.js";

type Db = typeof DbType;

export type HierarchicalRetrievalRequest = {
  query: string;
  symbols?: string[];
  paths?: string[];
  depth?: number;
  maxRoots?: number;
  maxSourcePaths?: number;
  operationId: string;
  projectRevision: string;
};

export type RetrievalEvidenceReference = {
  kind: "entity" | "relationship";
  id: string;
  path?: string | null;
  sourceId?: string;
  targetId?: string;
  relationType?: string | null;
  evidence: unknown[];
};

export type HierarchicalRetrievalPlan = {
  status: "complete";
  operationId: string;
  projectRevision: string;
  query: string;
  stages: {
    graphRoots: number;
    graphNeighbors: number;
    sourcePaths: number;
    testPaths: number;
  };
  roots: Array<{
    id: string;
    type: string;
    name: string;
    path: string | null;
    confidence: number | null;
  }>;
  sourcePaths: string[];
  testPaths: string[];
  evidence: RetrievalEvidenceReference[];
  nextAction: "read_ranked_sources";
};

function termsFor(query: string, symbols: string[]): string[] {
  const candidates = [query, ...symbols]
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.replace(/[^\p{L}\p{N}_./-]+/gu, "").trim())
    .filter((value) => value.length >= 2);
  return [...new Set(candidates)].slice(0, 24);
}

function filePath(entity: GraphEntity): string | null {
  if (entity.type === "file") return entity.path ?? entity.name;
  return entity.path ?? null;
}

function isTestPath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)(__tests__|tests?)(\/|$)|\.(test|spec)\.[^/]+$/.test(normalized);
}

function boundedEvidence(entity: GraphEntity): RetrievalEvidenceReference {
  return {
    kind: "entity",
    id: entity.id,
    path: entity.path,
    evidence: [],
  };
}

function relationshipEvidence(relationship: GraphRelationship): RetrievalEvidenceReference {
  return {
    kind: "relationship",
    id: relationship.id,
    sourceId: relationship.sourceId,
    targetId: relationship.targetId,
    relationType: relationship.relationType,
    evidence: Array.isArray(relationship.evidenceJson)
      ? relationship.evidenceJson.slice(0, 4)
      : [],
  };
}

/**
 * Plan source retrieval in bounded layers:
 *   1. resolve graph roots from user terms and explicit paths,
 *   2. expand only the scoped graph neighborhood,
 *   3. return ranked source/test paths for the caller's source-read tools.
 *
 * This intentionally plans reads rather than reading files itself. The
 * server-owned read tools remain the authority for source bytes, truncation,
 * and evidence snapshots.
 */
export async function planHierarchicalRetrieval(
  db: Db,
  projectId: string,
  request: HierarchicalRetrievalRequest,
): Promise<HierarchicalRetrievalPlan> {
  if (!request.operationId || !request.projectRevision) {
    throw new Error("hierarchical retrieval requires operation and revision context");
  }

  const depth = Math.min(2, Math.max(1, request.depth ?? 1));
  const maxRoots = Math.min(8, Math.max(1, request.maxRoots ?? 5));
  const maxSourcePaths = Math.min(40, Math.max(1, request.maxSourcePaths ?? 20));
  const terms = termsFor(request.query, request.symbols ?? []);
  const [symbolMatches, pathMatches] = await Promise.all([
    searchNodes(db, projectId, terms),
    findFileEntities(db, projectId, request.paths ?? []),
  ]);

  const roots: GraphEntity[] = [];
  const rootIds = new Set<string>();
  for (const entity of [...pathMatches, ...symbolMatches]) {
    if (rootIds.has(entity.id)) continue;
    rootIds.add(entity.id);
    roots.push(entity);
    if (roots.length >= maxRoots) break;
  }

  const neighbors: GraphEntity[] = [];
  const relationships: GraphRelationship[] = [];
  const seenNeighborIds = new Set<string>();
  const seenRelationshipIds = new Set<string>();
  for (const root of roots) {
    const neighborhood = await getNeighborhood(db, root.id, depth, projectId);
    for (const entity of neighborhood.entities) {
      if (!rootIds.has(entity.id) && !seenNeighborIds.has(entity.id)) {
        seenNeighborIds.add(entity.id);
        neighbors.push(entity);
      }
    }
    for (const relationship of neighborhood.relationships) {
      if (seenRelationshipIds.has(relationship.id)) continue;
      seenRelationshipIds.add(relationship.id);
      relationships.push(relationship);
    }
  }

  const orderedEntities = [...roots, ...neighbors];
  const sourcePaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const entity of orderedEntities) {
    const path = filePath(entity);
    if (!path || seenPaths.has(path) || isTestPath(path)) continue;
    seenPaths.add(path);
    sourcePaths.push(path);
    if (sourcePaths.length >= maxSourcePaths) break;
  }

  const testPaths: string[] = [];
  const seenTestPaths = new Set<string>();
  for (const entity of orderedEntities) {
    const path = filePath(entity);
    if (!path || !isTestPath(path) || seenTestPaths.has(path)) continue;
    seenTestPaths.add(path);
    testPaths.push(path);
    if (testPaths.length >= Math.min(12, maxSourcePaths)) break;
  }

  const evidence = [
    ...roots.map(boundedEvidence),
    ...relationships.slice(0, 40).map(relationshipEvidence),
  ];

  return {
    status: "complete",
    operationId: request.operationId,
    projectRevision: request.projectRevision,
    query: request.query,
    stages: {
      graphRoots: roots.length,
      graphNeighbors: neighbors.length,
      sourcePaths: sourcePaths.length,
      testPaths: testPaths.length,
    },
    roots: roots.map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: entity.name,
      path: entity.path,
      confidence: entity.confidence,
    })),
    sourcePaths,
    testPaths,
    evidence,
    nextAction: "read_ranked_sources",
  };
}