import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
  it("serializes observations with runtime session replacement", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    const now = new Date();
    const sessionId = "runtime-session-before-replacement";
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
      revision: "runtime-revision-before-replacement",
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

    let releaseRuntimeRow!: () => void;
    let announceRuntimeLock!: () => void;
    const runtimeRowLocked = new Promise<void>((resolve) => {
      announceRuntimeLock = resolve;
    });
    const holdRuntimeRow = db.transaction(async (tx) => {
      await tx.select({ id: workspaceRuntimeTable.id })
        .from(workspaceRuntimeTable)
        .where(eq(workspaceRuntimeTable.projectId, projectId))
        .for("update")
        .limit(1);
      announceRuntimeLock();
      await new Promise<void>((resolve) => {
        releaseRuntimeRow = resolve;
      });
      await tx.update(workspaceRuntimeTable).set({
        sessionId: "runtime-session-after-replacement",
        revision: "runtime-revision-after-replacement",
        status: "stopped",
        updatedAt: new Date(),
      }).where(eq(workspaceRuntimeTable.projectId, projectId));
    });
    await runtimeRowLocked;

    const pendingObservation = recordRuntimeObservation({
      projectId,
      sessionId,
      runtimeRevision: "runtime-revision-before-replacement",
      sourcePath: "src/server.ts",
      sourceName: "handleRequest",
      targetPath: "src/users.ts",
      targetName: "loadUser",
    });

    let observationWaitedForRuntimeRow = false;
    const deadline = Date.now() + 10_000;
    try {
      while (Date.now() < deadline && !observationWaitedForRuntimeRow) {
        const activity = await db.execute(sql`
          SELECT waiting.query
          FROM pg_stat_activity AS waiting
          WHERE waiting.pid <> pg_backend_pid()
            AND waiting.datname = current_database()
            AND waiting.wait_event_type = 'Lock'
            AND cardinality(pg_blocking_pids(waiting.pid)) > 0
        `);
        const rows = (activity as unknown as {
          rows?: Array<{ query: string | null }>;
        }).rows ?? [];
        observationWaitedForRuntimeRow = rows.some((row) =>
          /workspace_runtime/i.test(row.query ?? ""),
        );
        if (!observationWaitedForRuntimeRow) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    } finally {
      releaseRuntimeRow();
      await holdRuntimeRow;
    }

    expect(observationWaitedForRuntimeRow).toBe(true);
    await expect(pendingObservation).rejects.toMatchObject({
      code: "RUNTIME_SESSION_UNAVAILABLE",
    });
    const relationships = await db.select()
      .from(graphRelationshipsTable)
      .where(and(
        eq(graphRelationshipsTable.projectId, projectId),
        eq(graphRelationshipsTable.isRuntimeObserved, true),
      ));
    expect(relationships).toHaveLength(0);
  });

});