import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
  workspaceRuntimeTable,
} from "@workspace/db";
import {
  recordRuntimeObservation,
  clearRuntimeObservations,
} from "./runtime-observations.js";

const projectIds: string[] = [];

afterEach(async () => {
  while (projectIds.length > 0) {
    const projectId = projectIds.pop();
    if (!projectId) continue;
    await db.delete(graphRelationshipsTable).where(eq(graphRelationshipsTable.projectId, projectId));
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId));
    await db.delete(workspaceRuntimeTable).where(eq(workspaceRuntimeTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("runtime observations", () => {
  it("records an idempotent path-qualified runtime edge for the active session", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    const sessionId = randomUUID();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-observation-test-user",
      name: `runtime-observation-${projectId.slice(0, 8)}`,
      rootPath: "/tmp/runtime-observation-test",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workspaceRuntimeTable).values({
      id: projectId,
      projectId,
      sessionId,
      status: "running",
      profile: "dev",
      command: "pnpm run dev",
      projectRoot: "/tmp/runtime-observation-test",
      revision: "runtime-revision-1",
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
        name: "handleRequest",
        path: "src/server.ts",
        createdAt: now,
      },
      {
        id: targetId,
        projectId,
        type: "function",
        name: "loadUser",
        path: "src/users.ts",
        createdAt: now,
      },
    ]);

    const input = {
      projectId,
      sessionId,
      runtimeRevision: "runtime-revision-1",
      sourcePath: "src/server.ts",
      sourceName: "handleRequest",
      targetPath: "src/users.ts",
      targetName: "loadUser",
      line: 12,
      snippet: "loadUser()",
    } as const;
    const first = await recordRuntimeObservation(input);
    const second = await recordRuntimeObservation(input);

    expect(second.relationshipId).toBe(first.relationshipId);
    const rows = await db
      .select()
      .from(graphRelationshipsTable)
      .where(and(
        eq(graphRelationshipsTable.projectId, projectId),
        eq(graphRelationshipsTable.isRuntimeObserved, true),
      ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId,
      targetId,
      relationType: "calls",
      relationSubtype: "runtime-observed",
      isRuntimeObserved: true,
    });
    expect(rows[0].metadata).toMatchObject({
      runtimeSessionId: sessionId,
      runtimeRevision: "runtime-revision-1",
      observationSource: "workspace-runtime",
    });
    expect(await clearRuntimeObservations(projectId, sessionId, "runtime-revision-1")).toBe(1);
  });

  it("rejects stale runtime identity before writing an edge", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-observation-test-user",
      name: `runtime-observation-${projectId.slice(0, 8)}`,
      rootPath: "/tmp/runtime-observation-test",
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workspaceRuntimeTable).values({
      id: projectId,
      projectId,
      sessionId: "current-session",
      status: "running",
      profile: "dev",
      command: "pnpm run dev",
      projectRoot: "/tmp/runtime-observation-test",
      revision: "current-revision",
      createdAt: now,
      updatedAt: now,
    });

    await expect(recordRuntimeObservation({
      projectId,
      sessionId: "old-session",
      runtimeRevision: "current-revision",
      sourcePath: "src/server.ts",
      sourceName: "handleRequest",
      targetPath: "src/users.ts",
      targetName: "loadUser",
    })).rejects.toMatchObject({ code: "RUNTIME_SESSION_MISMATCH" });
  });
});