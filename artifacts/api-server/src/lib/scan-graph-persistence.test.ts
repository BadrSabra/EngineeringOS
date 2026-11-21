import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
} from "@workspace/db";
import { deleteStaticGraphRelationships } from "./scan-graph-persistence.js";

const projectIds: string[] = [];

afterEach(async () => {
  while (projectIds.length > 0) {
    const projectId = projectIds.pop();
    if (!projectId) continue;
    await db.delete(graphRelationshipsTable).where(eq(graphRelationshipsTable.projectId, projectId));
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("scan graph persistence", () => {
  it("replaces static and legacy edges without deleting runtime observations", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "scan-graph-persistence-test-user",
      name: `scan-graph-persistence-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/scan-graph-persistence-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const sourceId = randomUUID();
    const targetId = randomUUID();
    await db.insert(graphEntitiesTable).values([
      {
        id: sourceId,
        projectId,
        type: "function",
        name: "source",
        path: "src/source.ts",
        createdAt: now,
      },
      {
        id: targetId,
        projectId,
        type: "function",
        name: "target",
        path: "src/target.ts",
        createdAt: now,
      },
    ]);

    const staticEdgeId = randomUUID();
    const runtimeEdgeId = randomUUID();
    const legacyEdgeId = randomUUID();
    await db.insert(graphRelationshipsTable).values([
      {
        id: staticEdgeId,
        projectId,
        sourceId,
        targetId,
        relation: "imports",
        isRuntimeObserved: false,
        createdAt: now,
      },
      {
        id: runtimeEdgeId,
        projectId,
        sourceId,
        targetId,
        relation: "calls",
        relationSubtype: "runtime-observed",
        isRuntimeObserved: true,
        createdAt: now,
      },
      {
        id: legacyEdgeId,
        projectId,
        sourceId,
        targetId,
        relation: "uses",
        isRuntimeObserved: null,
        createdAt: now,
      },
    ]);

    await db.transaction((tx) => deleteStaticGraphRelationships(tx, projectId));
    const remaining = await db
      .select({
        id: graphRelationshipsTable.id,
        isRuntimeObserved: graphRelationshipsTable.isRuntimeObserved,
      })
      .from(graphRelationshipsTable)
      .where(eq(graphRelationshipsTable.projectId, projectId));

    expect(remaining).toHaveLength(1);
    expect(remaining).toEqual([{
      id: runtimeEdgeId,
      isRuntimeObserved: true,
    }]);
  });
});
