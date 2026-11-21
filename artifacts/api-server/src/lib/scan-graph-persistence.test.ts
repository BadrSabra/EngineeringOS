import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import type { RelationshipProvenance } from "@workspace/scanner";
import { deleteStaticGraphRelationships, persistGraphRelationshipRefresh } from "./scan-graph-persistence.js";

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
    const foreignProjectId = randomUUID();
    projectIds.push(foreignProjectId);
    await db.insert(projectsTable).values({
      id: foreignProjectId,
      ownerId: "scan-graph-persistence-test-user",
      name: `scan-graph-persistence-foreign-${foreignProjectId.slice(0, 8)}`,
      rootPath: `/tmp/scan-graph-persistence-foreign-${foreignProjectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
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

    const foreignTargetId = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id: foreignTargetId,
      projectId: foreignProjectId,
      type: "function",
      name: "foreignTarget",
      path: "src/foreign.ts",
      createdAt: now,
    });

    const staticEdgeId = randomUUID();
    const foreignStampedEdgeId = randomUUID();
    const runtimeEdgeId = randomUUID();
    const legacyEdgeId = randomUUID();
    const unscopedLegacyEdgeId = randomUUID();
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
      {
        id: unscopedLegacyEdgeId,
        projectId: null,
        sourceId,
        targetId,
        relation: "imports",
        isRuntimeObserved: false,
        createdAt: now,
      },
      {
        id: foreignStampedEdgeId,
        projectId: foreignProjectId,
        sourceId,
        targetId: foreignTargetId,
        relation: "imports",
        isRuntimeObserved: false,
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
      .where(inArray(graphRelationshipsTable.id, [
        staticEdgeId,
        runtimeEdgeId,
        legacyEdgeId,
        unscopedLegacyEdgeId,
        foreignStampedEdgeId,
      ]));

    const remainingById = new Map(remaining.map((row) => [row.id, row]));
    expect(remainingById.size).toBe(2);
    expect(remainingById.get(runtimeEdgeId)?.isRuntimeObserved).toBe(true);
    // A row stamped for another project is never removed just because one
    // endpoint is corruptly linked to the project currently being scanned.
    expect(remainingById.get(foreignStampedEdgeId)?.isRuntimeObserved).toBe(false);
  });
});

describe("persistGraphRelationshipRefresh", () => {
  it("replaces invalidated edges and re-stamps retained static edges only", async () => {
    const projectId = randomUUID();
    projectIds.push(projectId);
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "scan-graph-persistence-test-user",
      name: `scan-graph-persistence-incremental-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/scan-graph-persistence-incremental-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const previousJobId = randomUUID();
    const nextJobId = randomUUID();
    await db.insert(scanJobsTable).values([
      { id: previousJobId, projectId, status: "completed", createdAt: now, finishedAt: now },
      { id: nextJobId, projectId, status: "running", createdAt: now },
    ]);
    const sourceId = randomUUID();
    const targetId = randomUUID();
    await db.insert(graphEntitiesTable).values([
      { id: sourceId, projectId, type: "function", name: "source", path: "src/a.ts", createdAt: now },
      { id: targetId, projectId, type: "function", name: "target", path: "src/b.ts", createdAt: now },
    ]);
    const replacedId = randomUUID();
    const retainedId = randomUUID();
    const runtimeId = randomUUID();
    const legacyRetainedId = randomUUID();
    const foreignProjectId = randomUUID();
    projectIds.push(foreignProjectId);
    await db.insert(projectsTable).values({
      id: foreignProjectId,
      ownerId: "scan-graph-persistence-test-user",
      name: `scan-graph-persistence-foreign-${foreignProjectId.slice(0, 8)}`,
      rootPath: `/tmp/scan-graph-persistence-foreign-${foreignProjectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const foreignTargetId = randomUUID();
    await db.insert(graphEntitiesTable).values({
      id: foreignTargetId,
      projectId: foreignProjectId,
      type: "function",
      name: "foreignTarget",
      path: "src/foreign.ts",
      createdAt: now,
    });
    const foreignStampedId = randomUUID();
    const baseProvenance: RelationshipProvenance = {
      sourceType: "typescript-ast",
      method: "ts-compiler-api",
      extractedAt: now.toISOString(),
      scanSessionId: "previous-session",
      extractorVersion: "1.0.0",
      evidence: [{ file: "src/b.ts", kind: "import-statement" }],
    };
    const relationshipRows: (typeof graphRelationshipsTable.$inferInsert)[] = [
      { id: replacedId, projectId, scanJobId: previousJobId, sourceId, targetId, relation: "imports", isRuntimeObserved: false, provenance: baseProvenance, createdAt: now },
      { id: retainedId, projectId, scanJobId: previousJobId, sourceId: targetId, targetId, relation: "imports", isRuntimeObserved: false, provenance: baseProvenance, createdAt: now },
      { id: runtimeId, projectId, sourceId, targetId, relation: "calls", isRuntimeObserved: true, createdAt: now },
      { id: legacyRetainedId, projectId: null, scanJobId: previousJobId, sourceId, targetId, relation: "imports", isRuntimeObserved: false, provenance: baseProvenance, createdAt: now },
      { id: foreignStampedId, projectId: foreignProjectId, scanJobId: previousJobId, sourceId, targetId: foreignTargetId, relation: "imports", isRuntimeObserved: false, provenance: baseProvenance, createdAt: now },
    ];
    await db.insert(graphRelationshipsTable).values(relationshipRows);

    await db.transaction((tx) => persistGraphRelationshipRefresh(tx, projectId, {
      mode: "incremental",
      scanJobId: nextJobId,
      scanCorrelationId: "next-session",
      scannerVersion: "1.0.0",
      relationshipIdsToReplace: [replacedId],
      untouchedStaticRelationshipIds: [retainedId, legacyRetainedId, foreignStampedId],
    }));

    const rows = await db.select({
      id: graphRelationshipsTable.id,
      scanJobId: graphRelationshipsTable.scanJobId,
      isRuntimeObserved: graphRelationshipsTable.isRuntimeObserved,
      provenance: graphRelationshipsTable.provenance,
    }).from(graphRelationshipsTable).where(inArray(graphRelationshipsTable.id, [
      replacedId,
      retainedId,
      runtimeId,
      legacyRetainedId,
      foreignStampedId,
    ]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.has(replacedId)).toBe(false);
    expect(byId.get(retainedId)?.scanJobId).toBe(nextJobId);
    expect(byId.get(legacyRetainedId)?.scanJobId).toBe(nextJobId);
    expect(byId.get(foreignStampedId)?.scanJobId).toBe(previousJobId);
    expect((byId.get(foreignStampedId)?.provenance as { scanSessionId?: string }).scanSessionId).toBe("previous-session");
    expect((byId.get(retainedId)?.provenance as { scanSessionId?: string }).scanSessionId).toBe("next-session");
    expect((byId.get(retainedId)?.provenance as { extractorVersion?: string }).extractorVersion).toBe("1.0.0");
    expect(byId.get(runtimeId)?.isRuntimeObserved).toBe(true);
  });
});
