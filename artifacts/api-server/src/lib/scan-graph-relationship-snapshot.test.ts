import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
} from "@workspace/db";
import {
  GRAPH_RELATIONSHIP_SNAPSHOT_MAX_ROWS,
  loadGraphRelationshipSnapshot,
} from "./scan-graph-relationship-snapshot.js";

const projectIds: string[] = [];
const entityIds: string[] = [];

async function insertProject(label: string): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "scan-graph-snapshot-test-user",
    name: `scan-graph-snapshot-${label}-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/scan-graph-snapshot-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}

async function insertEntity(projectId: string, name: string, path: string): Promise<string> {
  const id = randomUUID();
  entityIds.push(id);
  await db.insert(graphEntitiesTable).values({
    id,
    projectId,
    type: "function",
    name,
    path,
    createdAt: new Date(),
  });
  return id;
}

async function insertRelationship(input: {
  id?: string;
  projectId: string | null;
  sourceId: string;
  targetId: string;
  isRuntimeObserved?: boolean | null;
}) {
  const id = input.id ?? randomUUID();
  await db.insert(graphRelationshipsTable).values({
    id,
    projectId: input.projectId,
    sourceId: input.sourceId,
    targetId: input.targetId,
    relation: "calls",
    isRuntimeObserved: input.isRuntimeObserved ?? false,
    createdAt: new Date(),
  });
  return id;
}

afterEach(async () => {
  for (const entityId of entityIds.splice(0)) {
    await db.delete(graphRelationshipsTable).where(or(
      eq(graphRelationshipsTable.sourceId, entityId),
      eq(graphRelationshipsTable.targetId, entityId),
    ));
  }
  for (const projectId of projectIds.splice(0)) {
    await db.delete(graphRelationshipsTable).where(
      eq(graphRelationshipsTable.projectId, projectId),
    );
    await db.delete(graphEntitiesTable).where(
      eq(graphEntitiesTable.projectId, projectId),
    );
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("loadGraphRelationshipSnapshot", () => {
  it("loads static, runtime, and legacy NULL-project edges with endpoint paths", async () => {
    const projectId = await insertProject("same-scope");
    const sourceId = await insertEntity(projectId, "source", "src/source.ts");
    const targetId = await insertEntity(projectId, "target", "src/target.ts");

    const staticId = await insertRelationship({
      projectId,
      sourceId,
      targetId,
      isRuntimeObserved: false,
    });
    const runtimeId = await insertRelationship({
      projectId,
      sourceId,
      targetId,
      isRuntimeObserved: true,
    });
    const legacyId = await insertRelationship({
      projectId: null,
      sourceId,
      targetId,
      isRuntimeObserved: null,
    });

    const result = await loadGraphRelationshipSnapshot(projectId);

    expect(result).toEqual({
      available: true,
      projectId,
      relationships: [
        {
          id: legacyId,
          scanJobId: null,
          sourcePath: "src/source.ts",
          targetPath: "src/target.ts",
          isRuntimeObserved: null,
          provenance: null,
        },
        {
          id: runtimeId,
          scanJobId: null,
          sourcePath: "src/source.ts",
          targetPath: "src/target.ts",
          isRuntimeObserved: true,
          provenance: null,
        },
        {
          id: staticId,
          scanJobId: null,
          sourcePath: "src/source.ts",
          targetPath: "src/target.ts",
          isRuntimeObserved: false,
          provenance: null,
        },
      ],
    });
  });

  it("fails closed when an edge crosses project ownership boundaries", async () => {
    const projectA = await insertProject("owner");
    const projectB = await insertProject("foreign");
    const sourceId = await insertEntity(projectA, "source", "src/source.ts");
    const foreignTargetId = await insertEntity(projectB, "target", "src/foreign.ts");
    await insertRelationship({
      projectId: projectA,
      sourceId,
      targetId: foreignTargetId,
      isRuntimeObserved: false,
    });

    expect(await loadGraphRelationshipSnapshot(projectA)).toEqual({
      available: false,
      projectId: projectA,
      reason: "relationship_scope_mismatch",
    });
  });

  it("detects a mismatched denormalized project id even when both endpoints belong to the project", async () => {
    const projectA = await insertProject("actual");
    const projectB = await insertProject("stamped");
    const sourceId = await insertEntity(projectA, "source", "src/source.ts");
    const targetId = await insertEntity(projectA, "target", "src/target.ts");
    await insertRelationship({
      projectId: projectB,
      sourceId,
      targetId,
      isRuntimeObserved: false,
    });

    expect(await loadGraphRelationshipSnapshot(projectA)).toEqual({
      available: false,
      projectId: projectA,
      reason: "relationship_scope_mismatch",
    });
  });

  it("rejects capped snapshots instead of returning a partial relationship inventory", async () => {
    const projectId = await insertProject("bounded");
    const sourceId = await insertEntity(projectId, "source", "src/source.ts");
    const targetId = await insertEntity(projectId, "target", "src/target.ts");
    await insertRelationship({ projectId, sourceId, targetId });
    await insertRelationship({ projectId, sourceId, targetId });

    expect(await loadGraphRelationshipSnapshot(projectId, { maxRows: 1 })).toEqual({
      available: false,
      projectId,
      reason: "relationship_snapshot_limit",
    });
  });

  it("rejects invalid limits and accepts a project with no relationships", async () => {
    const projectId = await insertProject("empty");
    expect(await loadGraphRelationshipSnapshot(projectId, { maxRows: 0 })).toEqual({
      available: false,
      projectId,
      reason: "invalid_snapshot_limit",
    });
    expect(await loadGraphRelationshipSnapshot(projectId)).toEqual({
      available: true,
      projectId,
      relationships: [],
    });
    expect(GRAPH_RELATIONSHIP_SNAPSHOT_MAX_ROWS).toBeGreaterThan(0);
  });
});
