import { afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import {
  getImpactedEntities,
  getShortestPath,
  getNeighborhood,
  fetchProjectGraph,
  getEvidenceForNode,
  getLayeredGraphView,
  annotatePathSteps,
} from "../queries.js";

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `knowledge-engine-test-${id.slice(0, 8)}`,
    rootPath: "/tmp/knowledge-engine-test",
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function cleanupProject(id: string): Promise<void> {
  const entities = await db
    .select()
    .from(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, id));
  for (const entity of entities) {
    await db
      .delete(graphRelationshipsTable)
      .where(eq(graphRelationshipsTable.sourceId, entity.id));
    await db
      .delete(graphRelationshipsTable)
      .where(eq(graphRelationshipsTable.targetId, entity.id));
  }
  await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

/**
 * Seeds a chain graph: C→A→B (C imports A, A imports B).
 */
async function seedChain(projectId: string) {
  const a = randomUUID();
  const b = randomUUID();
  const c = randomUUID();
  const now = new Date();

  await db.insert(graphEntitiesTable).values([
    { id: a, projectId, type: "module", name: "moduleA", createdAt: now },
    { id: b, projectId, type: "module", name: "moduleB", createdAt: now },
    { id: c, projectId, type: "module", name: "moduleC", createdAt: now },
  ]);

  await db.insert(graphRelationshipsTable).values([
    { id: randomUUID(), sourceId: c, targetId: a, relation: "imports", createdAt: now },
    { id: randomUUID(), sourceId: a, targetId: b, relation: "imports", createdAt: now },
  ]);

  return { a, b, c };
}

describe("getImpactedEntities", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns transitive downstream entities within maxDepth", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b, c } = await seedChain(projectId);

    const result = await getImpactedEntities(db, c, 3);

    expect(result).not.toBeNull();
    expect(result!.root.id).toBe(c);
    expect(result!.impactedIds.has(a)).toBe(true);
    expect(result!.impactedIds.has(b)).toBe(true);
    expect(result!.maxDepthReached).toBe(2);
  });

  it("stops expanding once maxDepth is reached", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b, c } = await seedChain(projectId);

    const result = await getImpactedEntities(db, c, 1);

    expect(result!.impactedIds.has(a)).toBe(true);
    expect(result!.impactedIds.has(b)).toBe(false);
  });

  it("returns null for a nonexistent entity", async () => {
    const result = await getImpactedEntities(db, randomUUID());
    expect(result).toBeNull();
  });

  it("returns an empty impacted list for a leaf entity", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b } = await seedChain(projectId);

    const result = await getImpactedEntities(db, b);
    expect(result!.impacted).toHaveLength(0);
    expect(result!.maxDepthReached).toBe(0);
  });
});

describe("getShortestPath", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("finds the shortest directed path across multiple hops", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b, c } = await seedChain(projectId);

    const result = await getShortestPath(db, c, b);

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.length).toBe(2);
      expect(result.path[0].entity.id).toBe(c);
      expect(result.path[result.path.length - 1].entity.id).toBe(b);
    }
  });

  it("returns found:false when only a reverse path exists (directed graph)", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b, c } = await seedChain(projectId);

    // B has no outgoing edges, so there is no directed path from B to C.
    const result = await getShortestPath(db, b, c);
    expect(result.found).toBe(false);
  });

  it("returns a trivial zero-length path when fromId === toId", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a } = await seedChain(projectId);

    const result = await getShortestPath(db, a, a);
    expect(result.found).toBe(true);
    if (result.found) expect(result.length).toBe(0);
  });

  it("returns found:false for a nonexistent source entity", async () => {
    const result = await getShortestPath(db, randomUUID(), randomUUID());
    expect(result.found).toBe(false);
  });
});

describe("getNeighborhood", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("includes both incoming and outgoing neighbors within depth", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b, c } = await seedChain(projectId);

    // From A: C is an incoming neighbor, B is an outgoing neighbor.
    const result = await getNeighborhood(db, a, 1);

    expect(result.root?.id).toBe(a);
    const ids = result.entities.map((e) => e.id).sort();
    expect(ids).toEqual([b, c].sort());
  });

  it("returns a null root for a nonexistent entity", async () => {
    const result = await getNeighborhood(db, randomUUID());
    expect(result.root).toBeNull();
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });
});

describe("fetchProjectGraph", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns all entities and relationships for a project", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    await seedChain(projectId);

    const { entities, relationships } = await fetchProjectGraph(db, projectId);
    expect(entities).toHaveLength(3);
    expect(relationships).toHaveLength(2);
  });

  it("returns empty arrays for a project with no graph data", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const { entities, relationships } = await fetchProjectGraph(db, projectId);
    expect(entities).toEqual([]);
    expect(relationships).toEqual([]);
  });
});

// ─── PR-03: provenance-aware query extensions ─────────────────────────────────

describe("getEvidenceForNode — EvidenceBundle (PR-03)", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns EvidenceBundle with confidence, sourceType, and provenanceSummary", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const now = new Date();
    const srcId = randomUUID();
    const tgtId = randomUUID();

    await db.insert(graphEntitiesTable).values([
      { id: srcId, projectId, type: "module", name: "src.ts", createdAt: now },
      { id: tgtId, projectId, type: "module", name: "tgt.ts", createdAt: now },
    ]);
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: srcId,
      targetId: tgtId,
      relation: "imports",
      confidence: 0.9,
      sourceType: "typescript-ast",
      isHeuristic: false,
      isRuntimeObserved: false,
      evidenceJson: [{ file: "src.ts", line: 1, kind: "import-statement", snippet: "import tgt" }],
      evidenceCount: 1,
      createdAt: now,
    });

    const bundles = await getEvidenceForNode(db, srcId);

    expect(bundles).toHaveLength(1);
    const b = bundles[0];

    // backward-compat fields still present
    expect(b.relationship.sourceId).toBe(srcId);
    expect(b.evidence).toHaveLength(1);
    expect(b.evidence[0].kind).toBe("import-statement");

    // PR-03 provenance fields
    expect(b.confidence).toBe(0.9);
    expect(b.sourceType).toBe("typescript-ast");
    expect(b.isHeuristic).toBe(false);
    expect(b.isRuntimeObserved).toBe(false);
    expect(b.provenanceSummary).not.toBeNull();
    expect(b.provenanceSummary?.sourceType).toBe("typescript-ast");
    expect(b.provenanceSummary?.evidenceCount).toBe(1);
  });

  it("returns an empty array when no outgoing relationships have evidence", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a } = await seedChain(projectId);

    // seedChain relationships have no evidenceJson — they should be excluded
    const bundles = await getEvidenceForNode(db, a);
    expect(bundles).toHaveLength(0);
  });
});

describe("getLayeredGraphView — provenanceStats (PR-03)", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("provenanceStats reflects avgConfidence and sourceTypeBreakdown for each layer", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const now = new Date();
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();

    await db.insert(graphEntitiesTable).values([
      { id: a, projectId, type: "module", name: "modA", createdAt: now },
      { id: b, projectId, type: "module", name: "modB", createdAt: now },
      { id: c, projectId, type: "module", name: "modC", createdAt: now },
    ]);
    // structural edge (non-heuristic, non-runtime) with known confidence + sourceType
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(), projectId, sourceId: a, targetId: b, relation: "imports",
      isHeuristic: false, isRuntimeObserved: false,
      confidence: 0.95, sourceType: "typescript-ast", evidenceCount: 2,
      createdAt: now,
    });
    // heuristic edge
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(), projectId, sourceId: a, targetId: c, relation: "imports",
      isHeuristic: true, isRuntimeObserved: false,
      confidence: 0.6, sourceType: "regex-fallback", evidenceCount: 0,
      createdAt: now,
    });

    const view = await getLayeredGraphView(db, projectId);

    // Layer shape is unchanged
    expect(view.structural.relationships).toHaveLength(1);
    expect(view.heuristic.relationships).toHaveLength(1);
    expect(view.runtime.relationships).toHaveLength(0);

    // PR-03: provenanceStats
    expect(view.provenanceStats).toBeDefined();
    expect(view.provenanceStats.structural.avgConfidence).toBe(0.95);
    expect(view.provenanceStats.structural.sourceTypeBreakdown["typescript-ast"]).toBe(1);
    expect(view.provenanceStats.structural.totalEvidenceCount).toBe(2);
    expect(view.provenanceStats.heuristic.avgConfidence).toBe(0.6);
    expect(view.provenanceStats.heuristic.sourceTypeBreakdown["regex-fallback"]).toBe(1);
    expect(view.provenanceStats.heuristic.totalEvidenceCount).toBe(0);
    // Empty runtime layer → all zeros, no keys in breakdown
    expect(view.provenanceStats.runtime.avgConfidence).toBe(0);
    expect(Object.keys(view.provenanceStats.runtime.sourceTypeBreakdown)).toHaveLength(0);
  });
});

describe("annotatePathSteps (PR-03)", () => {
  const cleanupQueue: string[] = [];
  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("root step has null confidence and empty evidence; each hop carries edge annotations", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b, c } = await seedChain(projectId);

    const result = await getShortestPath(db, c, b);
    expect(result.found).toBe(true);
    if (!result.found) return;

    const annotated = annotatePathSteps(result.path);
    expect(annotated).toHaveLength(result.path.length);

    // Root step — no leading edge
    expect(annotated[0].confidence).toBeNull();
    expect(annotated[0].relationship).toBeNull();
    expect(annotated[0].edgeSourceType).toBeNull();
    expect(annotated[0].evidence).toEqual([]);
    expect(annotated[0].provenanceSummary).toBeNull();
    expect(annotated[0].isHeuristic).toBe(false);
    expect(annotated[0].isRuntimeObserved).toBe(false);

    // Subsequent hops always reference a relationship
    for (let i = 1; i < annotated.length; i++) {
      expect(annotated[i].relationship).not.toBeNull();
      expect(typeof annotated[i].isHeuristic).toBe("boolean");
      expect(typeof annotated[i].isRuntimeObserved).toBe("boolean");
      expect(Array.isArray(annotated[i].evidence)).toBe(true);
      // provenanceSummary is always an object (may have null fields if row predates KG 2.0)
      expect(annotated[i].provenanceSummary).not.toBeNull();
    }
  });

  it("trivial zero-length path (fromId === toId) returns one root-annotated step", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a } = await seedChain(projectId);

    const result = await getShortestPath(db, a, a);
    expect(result.found).toBe(true);
    if (!result.found) return;

    const annotated = annotatePathSteps(result.path);
    expect(annotated).toHaveLength(1);
    expect(annotated[0].confidence).toBeNull();
    expect(annotated[0].relationship).toBeNull();
  });
});
