import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../app.js";
import {
  db,
  projectsTable,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import { randomUUID } from "crypto";

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `graph-test-project-${id.slice(0, 8)}`,
    rootPath: "/tmp/graph-test",
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
  await db
    .delete(graphEntitiesTable)
    .where(eq(graphEntitiesTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seeds a triangle graph: A→B (A depends on B), C→A (C depends on A).
 * Impact from A: reaches B (depth 1).
 * Impact from C: reaches A (depth 1), then B (depth 2).
 */
async function seedTriangle(projectId: string) {
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
    {
      id: randomUUID(),
      sourceId: a,
      targetId: b,
      relation: "imports",
      createdAt: now,
    },
    {
      id: randomUUID(),
      sourceId: c,
      targetId: a,
      relation: "imports",
      createdAt: now,
    },
  ]);

  return { a, b, c };
}

// ─── Direct neighbors ─────────────────────────────────────────────────────────

describe("GET /api/graph/entities/:entityId/neighbors", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns outgoing and incoming relationships plus neighbor entities", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b, c } = await seedTriangle(projectId);

    const res = await request(app).get(`/api/graph/entities/${a}/neighbors`);
    expect(res.status).toBe(200);
    expect(res.body.entity.id).toBe(a);
    expect(res.body.outgoing).toHaveLength(1);
    expect(res.body.outgoing[0].targetId).toBe(b);
    expect(res.body.incoming).toHaveLength(1);
    expect(res.body.incoming[0].sourceId).toBe(c);
    const neighborIds = res.body.neighbors.map((n: { id: string }) => n.id).sort();
    expect(neighborIds).toEqual([b, c].sort());
  });

  it("returns empty arrays for an isolated entity", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const id = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id,
      projectId,
      type: "file",
      name: "isolated.ts",
      createdAt: new Date(),
    });

    const res = await request(app).get(`/api/graph/entities/${id}/neighbors`);
    expect(res.status).toBe(200);
    expect(res.body.outgoing).toEqual([]);
    expect(res.body.incoming).toEqual([]);
    expect(res.body.neighbors).toEqual([]);
  });

  it("returns 404 for a nonexistent entity", async () => {
    const res = await request(app).get(
      `/api/graph/entities/${randomUUID()}/neighbors`,
    );
    expect(res.status).toBe(404);
  });
});

// ─── Impact analysis ─────────────────────────────────────────────────────────

describe("GET /api/graph/impact", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns the root entity and its transitive downstream dependants", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    // Chain: C→A→B (C imports A, A imports B)
    const { a, b, c } = await seedTriangle(projectId);

    // Impact from C: A (depth 1), B (depth 2)
    const res = await request(app)
      .get("/api/graph/impact")
      .query({ entityId: c, maxDepth: 3 });

    expect(res.status).toBe(200);
    expect(res.body.root.id).toBe(c);
    const impactedIds = res.body.impacted.map(
      (h: { entity: { id: string } }) => h.entity.id,
    );
    expect(impactedIds).toContain(a);
    expect(impactedIds).toContain(b);
    expect(res.body.maxDepthReached).toBe(2);
  });

  it("returns empty impacted list for an entity with no outgoing edges", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b } = await seedTriangle(projectId);

    // B has no outgoing edges in the triangle
    const res = await request(app)
      .get("/api/graph/impact")
      .query({ entityId: b });

    expect(res.status).toBe(200);
    expect(res.body.root.id).toBe(b);
    expect(res.body.impacted).toHaveLength(0);
    expect(res.body.maxDepthReached).toBe(0);
  });

  it("returns 404 for a nonexistent entity", async () => {
    const res = await request(app)
      .get("/api/graph/impact")
      .query({ entityId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("respects maxDepth — depth 1 only returns direct dependants", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b, c } = await seedTriangle(projectId);

    // C→A→B; with maxDepth=1, starting from C only A is reachable
    const res = await request(app)
      .get("/api/graph/impact")
      .query({ entityId: c, maxDepth: 1 });

    expect(res.status).toBe(200);
    const impactedIds = res.body.impacted.map(
      (h: { entity: { id: string } }) => h.entity.id,
    );
    expect(impactedIds).toContain(a);
    expect(impactedIds).not.toContain(b);
  });
});

// ─── Shortest path ────────────────────────────────────────────────────────────

describe("GET /api/graph/path", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("finds a direct 1-hop path between connected entities", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b } = await seedTriangle(projectId);

    const res = await request(app)
      .get("/api/graph/path")
      .query({ fromId: a, toId: b });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body.path).toHaveLength(2);
    expect(res.body.path[0].entity.id).toBe(a);
    expect(res.body.path[1].entity.id).toBe(b);
  });

  it("finds a 2-hop path between indirectly connected entities", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b, c } = await seedTriangle(projectId);

    // C→A→B; path from C to B should have length 2
    const res = await request(app)
      .get("/api/graph/path")
      .query({ fromId: c, toId: b });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it("returns found:false when no path exists", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { b, c } = await seedTriangle(projectId);

    // There is no path from B to C (B has no outgoing edges in the triangle)
    const res = await request(app)
      .get("/api/graph/path")
      .query({ fromId: b, toId: c });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it("returns a trivial path of length 0 for fromId === toId", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a } = await seedTriangle(projectId);

    const res = await request(app)
      .get("/api/graph/path")
      .query({ fromId: a, toId: a });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.length).toBe(0);
  });
});

// ─── Graph summary ────────────────────────────────────────────────────────────

describe("GET /api/graph/summary/:projectId", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns correct counts and centrality for a triangle graph", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b: _b, c: _c } = await seedTriangle(projectId);

    const res = await request(app).get(`/api/graph/summary/${projectId}`);
    expect(res.status).toBe(200);

    const s = res.body;
    expect(s.projectId).toBe(projectId);
    expect(s.entityCount).toBe(3);
    expect(s.relationshipCount).toBe(2);
    expect(s.entitiesByType.module).toBe(3);
    expect(s.relationsByType.imports).toBe(2);
    // No isolated nodes in a triangle where everyone is connected
    expect(s.isolatedCount).toBe(0);
    // All 3 nodes are in one connected component
    expect(s.clusterCount).toBe(1);
    // A has the highest degree (1 incoming from C, 1 outgoing to B)
    expect(s.topConnected[0].entityId).toBe(a);
    expect(s.topConnected[0].totalDegree).toBe(2);
  });

  it("returns zero counts for a project with no graph data", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const res = await request(app).get(`/api/graph/summary/${projectId}`);
    expect(res.status).toBe(200);
    expect(res.body.entityCount).toBe(0);
    expect(res.body.relationshipCount).toBe(0);
    expect(res.body.clusterCount).toBe(0);
  });
});

// ─── Subgraph (layered view) ───────────────────────────────────────────────────

describe("GET /api/graph/subgraph", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function seedLayeredEdges(projectId: string) {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const now = new Date();

    await db.insert(graphEntitiesTable).values([
      { id: a, projectId, type: "module", name: "modA", createdAt: now },
      { id: b, projectId, type: "module", name: "modB", createdAt: now },
      { id: c, projectId, type: "module", name: "modC", createdAt: now },
    ]);

    // structural edge A→B
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: a,
      targetId: b,
      relation: "imports",
      isHeuristic: false,
      isRuntimeObserved: false,
      createdAt: now,
    });
    // heuristic edge A→C
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: a,
      targetId: c,
      relation: "imports",
      isHeuristic: true,
      isRuntimeObserved: false,
      createdAt: now,
    });
    // runtime edge B→C
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: b,
      targetId: c,
      relation: "calls",
      isHeuristic: false,
      isRuntimeObserved: true,
      createdAt: now,
    });

    return { a, b, c };
  }

  it("returns entities and relationships with per-layer counts", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    await seedLayeredEdges(projectId);

    const res = await request(app)
      .get("/api/graph/subgraph")
      .query({ projectId });

    expect(res.status).toBe(200);
    expect(res.body.entities.length).toBeGreaterThanOrEqual(2);
    expect(res.body.relationships.length).toBeGreaterThanOrEqual(1);
    expect(res.body.layered.structural).toBeDefined();
    expect(res.body.layered.heuristic).toBeDefined();
    expect(res.body.layered.runtime).toBeDefined();
    expect(typeof res.body.layered.structural.entityCount).toBe("number");
    expect(typeof res.body.layered.structural.relationshipCount).toBe("number");
  });

  it("structural layer contains only non-heuristic, non-runtime edges", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    await seedLayeredEdges(projectId);

    const res = await request(app)
      .get("/api/graph/subgraph")
      .query({ projectId });

    expect(res.status).toBe(200);
    expect(res.body.layered.structural.relationshipCount).toBe(1);
    expect(res.body.layered.heuristic.relationshipCount).toBe(1);
    expect(res.body.layered.runtime.relationshipCount).toBe(1);
  });

  it("filters object mirrors parsed query values", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const res = await request(app)
      .get("/api/graph/subgraph")
      .query({ projectId, observedOnly: "true" });

    expect(res.status).toBe(200);
    expect(res.body.filters).toBeDefined();
    expect(res.body.filters.observedOnly).toBe(true);
  });

  it("returns 400 when projectId is missing", async () => {
    const res = await request(app).get("/api/graph/subgraph");
    expect(res.status).toBe(400);
  });

  it("returns 403 when projectId belongs to another user", async () => {
    const id = randomUUID();
    await db.insert(projectsTable).values({
      id,
      ownerId: "other-user",
      name: `other-subgraph-${id.slice(0, 8)}`,
      rootPath: "/tmp/other",
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    cleanupQueue.push(id);

    const res = await request(app)
      .get("/api/graph/subgraph")
      .query({ projectId: id });
    expect(res.status).toBe(403);
  });
});

// ─── Semantic neighborhood ─────────────────────────────────────────────────────

describe("GET /api/graph/semantic-neighborhood", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns root entity plus neighborhood within depth", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const { a, b } = await seedTriangle(projectId);

    const res = await request(app)
      .get("/api/graph/semantic-neighborhood")
      .query({ entityId: a, depth: 1 });

    expect(res.status).toBe(200);
    expect(res.body.root.id).toBe(a);
    const neighborIds = res.body.entities.map((e: { id: string }) => e.id);
    expect(neighborIds).toContain(b);
  });

  it("returns 400 when entityId is missing", async () => {
    const res = await request(app).get("/api/graph/semantic-neighborhood");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent entityId", async () => {
    const res = await request(app)
      .get("/api/graph/semantic-neighborhood")
      .query({ entityId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it("returns 403 when entity belongs to another user's project", async () => {
    const otherProjectId = randomUUID();
    await db.insert(projectsTable).values({
      id: otherProjectId,
      ownerId: "other-user",
      name: `other-nbr-${otherProjectId.slice(0, 8)}`,
      rootPath: "/tmp/other-nbr",
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    cleanupQueue.push(otherProjectId);

    const entityId = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id: entityId,
      projectId: otherProjectId,
      type: "module",
      name: "hidden.ts",
      createdAt: new Date(),
    });

    const res = await request(app)
      .get("/api/graph/semantic-neighborhood")
      .query({ entityId });
    expect(res.status).toBe(403);
  });
});

// ─── Evidence ─────────────────────────────────────────────────────────────────

describe("GET /api/graph/evidence/:entityId", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns entity and evidence bundles for outgoing relationships", async () => {
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
      evidenceJson: [{ file: "src.ts", line: 1, snippet: "import tgt", kind: "import" }],
      evidenceCount: 1,
      createdAt: now,
    });

    const res = await request(app).get(`/api/graph/evidence/${srcId}`);
    expect(res.status).toBe(200);
    expect(res.body.entity.id).toBe(srcId);
    expect(Array.isArray(res.body.evidence)).toBe(true);
    expect(res.body.evidence.length).toBeGreaterThanOrEqual(1);
    expect(res.body.evidence[0].relationship).toBeDefined();
    expect(Array.isArray(res.body.evidence[0].evidence)).toBe(true);
  });

  it("returns 404 for a nonexistent entity", async () => {
    const res = await request(app).get(`/api/graph/evidence/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 when entity belongs to another user's project", async () => {
    const otherProjectId = randomUUID();
    await db.insert(projectsTable).values({
      id: otherProjectId,
      ownerId: "other-user",
      name: `other-ev-${otherProjectId.slice(0, 8)}`,
      rootPath: "/tmp/other-ev",
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    cleanupQueue.push(otherProjectId);

    const entityId = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id: entityId,
      projectId: otherProjectId,
      type: "module",
      name: "hidden-ev.ts",
      createdAt: new Date(),
    });

    const res = await request(app).get(`/api/graph/evidence/${entityId}`);
    expect(res.status).toBe(403);
  });
});

// ─── Runtime subgraph ─────────────────────────────────────────────────────────

describe("GET /api/graph/runtime-subgraph/:projectId", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await cleanupProject(id);
    }
  });

  it("returns only runtime-observed relationships", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);
    const now = new Date();

    const a = randomUUID();
    const b = randomUUID();
    await db.insert(graphEntitiesTable).values([
      { id: a, projectId, type: "module", name: "rtA.ts", createdAt: now },
      { id: b, projectId, type: "module", name: "rtB.ts", createdAt: now },
    ]);
    // runtime edge
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: a,
      targetId: b,
      relation: "calls",
      isRuntimeObserved: true,
      createdAt: now,
    });
    // non-runtime edge (should be excluded)
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      projectId,
      sourceId: b,
      targetId: a,
      relation: "imports",
      isRuntimeObserved: false,
      createdAt: now,
    });

    const res = await request(app).get(
      `/api/graph/runtime-subgraph/${projectId}`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entities)).toBe(true);
    expect(Array.isArray(res.body.relationships)).toBe(true);
    for (const rel of res.body.relationships) {
      expect(rel.isRuntimeObserved).toBe(true);
    }
  });

  it("returns empty arrays for a project with no runtime edges", async () => {
    const projectId = await insertProject();
    cleanupQueue.push(projectId);

    const res = await request(app).get(
      `/api/graph/runtime-subgraph/${projectId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual([]);
    expect(res.body.relationships).toEqual([]);
  });

  it("returns 403 when project belongs to another user", async () => {
    const otherProjectId = randomUUID();
    await db.insert(projectsTable).values({
      id: otherProjectId,
      ownerId: "other-user",
      name: `other-rt-${otherProjectId.slice(0, 8)}`,
      rootPath: "/tmp/other-rt",
      language: "typescript",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    cleanupQueue.push(otherProjectId);

    const res = await request(app).get(
      `/api/graph/runtime-subgraph/${otherProjectId}`,
    );
    expect(res.status).toBe(403);
  });
});

// ─── Ownership isolation ───────────────────────────────────────────────────────

describe("Ownership isolation — graph", () => {
  const isolationCleanup: string[] = [];

  afterEach(async () => {
    while (isolationCleanup.length > 0) {
      const id = isolationCleanup.pop();
      if (id) await cleanupProject(id);
    }
  });

  async function insertOtherUserProject(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id,
      ownerId: "other-user",
      name: `other-user-project-${id.slice(0, 8)}`,
      rootPath: "/tmp/other-user-graph",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  it("GET /graph/entities returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).get("/api/graph/entities").query({ projectId: otherProjectId });
    expect(res.status).toBe(403);
  });

  it("GET /graph/summary/:projectId returns 403 when projectId belongs to another user", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const res = await request(app).get(`/api/graph/summary/${otherProjectId}`);
    expect(res.status).toBe(403);
  });

  it("GET /graph/entities/:entityId/neighbors returns 403 when entity belongs to another user's project", async () => {
    const otherProjectId = await insertOtherUserProject();
    isolationCleanup.push(otherProjectId);

    const entityId = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id: entityId,
      projectId: otherProjectId,
      type: "module",
      name: "hidden.ts",
      createdAt: new Date(),
    });

    const res = await request(app).get(`/api/graph/entities/${entityId}/neighbors`);
    expect(res.status).toBe(403);
  });
});
