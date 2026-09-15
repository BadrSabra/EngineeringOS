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
  indexRevision: string;
  parserVersion: string;
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
  indexRevision: string;
  parserVersion: string;
  cacheStatus: "hit" | "miss";
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
  rankedSources: Array<{
    path: string;
    score: number;
    reasons: string[];
  }>;
  sourcePaths: string[];
  testPaths: string[];
  evidence: RetrievalEvidenceReference[];
  nextAction: "read_ranked_sources";
};

const RETRIEVAL_CACHE_TTL_MS = 30_000;
const RETRIEVAL_CACHE_MAX_ENTRIES = 128;
const retrievalPlanCache = new Map<string, {
  expiresAt: number;
  plan: HierarchicalRetrievalPlan;
}>();

function retrievalCacheKey(projectId: string, request: HierarchicalRetrievalRequest): string {
  return JSON.stringify({
    projectId,
    projectRevision: request.projectRevision,
    indexRevision: request.indexRevision,
    parserVersion: request.parserVersion,
    query: request.query,
    symbols: request.symbols ?? [],
    paths: request.paths ?? [],
    depth: request.depth ?? 1,
    maxRoots: request.maxRoots ?? 5,
    maxSourcePaths: request.maxSourcePaths ?? 20,
  });
}

export function clearHierarchicalRetrievalCache(projectId?: string): void {
  if (!projectId) {
    retrievalPlanCache.clear();
    return;
  }
  for (const key of retrievalPlanCache.keys()) {
    if (key.includes(`"projectId":"${projectId}"`)) retrievalPlanCache.delete(key);
  }
}

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
  if (!request.indexRevision || !request.parserVersion) {
    throw new Error("hierarchical retrieval requires index and parser revision context");
  }

  const cacheKey = retrievalCacheKey(projectId, request);
  const cached = retrievalPlanCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.plan,
      operationId: request.operationId,
      projectRevision: request.projectRevision,
      cacheStatus: "hit",
    };
  }
  if (cached) retrievalPlanCache.delete(cacheKey);

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
  const entitiesById = new Map(orderedEntities.map((entity) => [entity.id, entity]));
  const rootScores = new Map(
    roots.map((entity, index) => [entity.id, Math.max(0.7, 1 - index * 0.04)]),
  );
  const neighborScores = new Map<string, { score: number; reasons: Set<string> }>();
  for (const relationship of relationships) {
    const sourceIsRoot = rootScores.has(relationship.sourceId);
    const targetIsRoot = rootScores.has(relationship.targetId);
    const connectedId = sourceIsRoot ? relationship.targetId : targetIsRoot ? relationship.sourceId : null;
    if (!connectedId || rootScores.has(connectedId)) continue;
    const score = 0.45
      + (relationship.confidence ?? 0) * 0.35
      + (relationship.isHeuristic ? 0 : 0.1);
    const current = neighborScores.get(connectedId);
    const reasons = current?.reasons ?? new Set<string>();
    reasons.add(relationship.relationSubtype ?? relationship.relationType ?? relationship.relation);
    neighborScores.set(connectedId, {
      score: Math.max(current?.score ?? 0, score),
      reasons,
    });
  }
  const coveredTestPaths: string[] = [];
  const coveredTestPathSet = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.relationSubtype !== "test-covers") continue;
    const source = entitiesById.get(relationship.sourceId);
    const path = source ? filePath(source) : null;
    if (!path || coveredTestPathSet.has(path)) continue;
    coveredTestPathSet.add(path);
    coveredTestPaths.push(path);
  }

  const sourceCandidates = new Map<string, { score: number; reasons: Set<string> }>();
  for (const entity of orderedEntities) {
    const path = filePath(entity);
    if (!path || sourceCandidates.has(path) || isTestPath(path) || coveredTestPathSet.has(path)) continue;
    const score = rootScores.get(entity.id)
      ?? neighborScores.get(entity.id)?.score
      ?? (entity.confidence ?? 0);
    const reasons = new Set<string>(
      rootScores.has(entity.id)
        ? ["graph-root"]
        : [...(neighborScores.get(entity.id)?.reasons ?? ["graph-neighbor"])],
    );
    const current = sourceCandidates.get(path);
    sourceCandidates.set(path, {
      score: Math.max(current?.score ?? 0, score),
      reasons: new Set([...(current?.reasons ?? []), ...reasons]),
    });
  }
  const rankedSources = [...sourceCandidates.entries()]
    .map(([path, value]) => ({ path, score: value.score, reasons: [...value.reasons].sort() }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maxSourcePaths);
  const sourcePaths = rankedSources.map((source) => source.path);

  const testPaths: string[] = [];
  const seenTestPaths = new Set<string>();
  for (const path of coveredTestPaths) {
    seenTestPaths.add(path);
    testPaths.push(path);
    if (testPaths.length >= Math.min(12, maxSourcePaths)) break;
  }
  for (const entity of orderedEntities) {
    if (testPaths.length >= Math.min(12, maxSourcePaths)) break;
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

  const plan: HierarchicalRetrievalPlan = {
    status: "complete",
    operationId: request.operationId,
    projectRevision: request.projectRevision,
    indexRevision: request.indexRevision,
    parserVersion: request.parserVersion,
    cacheStatus: "miss",
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
    rankedSources,
    sourcePaths,
    testPaths,
    evidence,
    nextAction: "read_ranked_sources",
  };
  retrievalPlanCache.set(cacheKey, {
    expiresAt: Date.now() + RETRIEVAL_CACHE_TTL_MS,
    plan,
  });
  while (retrievalPlanCache.size > RETRIEVAL_CACHE_MAX_ENTRIES) {
    const oldestKey = retrievalPlanCache.keys().next().value;
    if (!oldestKey) break;
    retrievalPlanCache.delete(oldestKey);
  }
  return plan;
}