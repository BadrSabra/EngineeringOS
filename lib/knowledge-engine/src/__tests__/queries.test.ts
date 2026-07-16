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
