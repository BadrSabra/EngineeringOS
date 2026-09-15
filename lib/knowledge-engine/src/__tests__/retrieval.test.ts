import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
} from "@workspace/db";
import { planHierarchicalRetrieval } from "../retrieval.js";

const cleanupQueue: string[] = [];

afterEach(async () => {
  while (cleanupQueue.length > 0) {
    const projectId = cleanupQueue.pop();
    if (!projectId) continue;
    await db.delete(graphRelationshipsTable).where(eq(graphRelationshipsTable.projectId, projectId));
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("planHierarchicalRetrieval", () => {
  it("ranks directly covered tests separately from source paths", async () => {
    const projectId = randomUUID();
    cleanupQueue.push(projectId);
    const now = new Date();
    const sourceId = randomUUID();
    const symbolId = randomUUID();
    const testId = randomUUID();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "retrieval-test-user",
      name: `retrieval-test-${projectId.slice(0, 8)}`,
      rootPath: "/tmp/retrieval-test",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(graphEntitiesTable).values([
      {
        id: sourceId,
        projectId,
        type: "file",
        name: "src/utils.ts",
        path: "src/utils.ts",
        confidence: 1,
        createdAt: now,
      },
      {
        id: symbolId,
        projectId,
        type: "function",
        name: "parseUser",
        path: "src/utils.ts",
        confidence: 1,
        createdAt: now,
      },
      {
        id: testId,
        projectId,
        type: "file",
        name: "src/user.check.ts",
        path: "src/user.check.ts",
        confidence: 1,
        createdAt: now,
      },
    ]);
    await db.insert(graphRelationshipsTable).values({
      id: randomUUID(),
      sourceId: testId,
      targetId: symbolId,
      projectId,
      relation: "uses",
      relationType: "uses",
      relationSubtype: "test-covers",
      confidence: 1,
      isHeuristic: false,
      evidenceJson: [{ file: "src/user.check.ts", line: 4, kind: "call-site" }],
      evidenceCount: 1,
      createdAt: now,
    });

    const plan = await planHierarchicalRetrieval(db, projectId, {
      query: "parseUser",
      operationId: "operation-retrieval-test",
      projectRevision: "revision-retrieval-test",
      indexRevision: "index-revision-retrieval-test",
      parserVersion: "scanner-test",
    });

    expect(plan.operationId).toBe("operation-retrieval-test");
    expect(plan.projectRevision).toBe("revision-retrieval-test");
    expect(plan.sourcePaths).toContain("src/utils.ts");
    expect(plan.testPaths).toEqual(["src/user.check.ts"]);
    expect(plan.rankedSources[0]).toMatchObject({
      path: "src/utils.ts",
      reasons: ["graph-root"],
    });
    expect(plan.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "relationship",
        sourceId: testId,
        targetId: symbolId,
      }),
    ]));
  });
});