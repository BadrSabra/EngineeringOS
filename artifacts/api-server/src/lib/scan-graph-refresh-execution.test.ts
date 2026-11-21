import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  graphEntitiesTable,
  graphRelationshipsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import { SCANNER_VERSION, type ExtractedRelationship, type RevisionManifest } from "@workspace/scanner";
import { planTransactionalGraphRefresh } from "./scan-graph-refresh-execution.js";

const projectIds: string[] = [];

async function insertProject(): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "scan-graph-refresh-execution-test",
    name: `scan-graph-refresh-execution-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/scan-graph-refresh-execution-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}

function manifest(revision: string, changedA: boolean): RevisionManifest {
  return {
    revision,
    sourceRoot: "/workspace/project",
    completeness: "COMPLETE",
    files: [
      { path: "src/a.ts", size: 10, contentHash: changedA ? "sha256:new-a" : "sha256:old-a", oversized: false },
      { path: "src/b.ts", size: 10, contentHash: "sha256:b", oversized: false },
    ],
  };
}

async function insertEntity(projectId: string, name: string, path: string): Promise<string> {
  const id = randomUUID();
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

async function insertBaseline(projectId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(scanJobsTable).values({
    id,
    projectId,
    status: "completed",
    result: {
      scanCompleteness: "COMPLETE",
      sourceProvenance: "filesystem-scan",
      scannerVersion: SCANNER_VERSION,
      scanCorrelationId: "previous-scan-session",
      repositoryManifest: {
        ...manifest("revision-1", false),
        derivedArtifacts: { scanner: "COMPLETE", graph: "COMPLETE", metrics: "COMPLETE" },
      },
    },
    createdAt: new Date(now.getTime() - 60_000),
    finishedAt: new Date(now.getTime() - 30_000),
  });
  return id;
}

async function insertEdge(input: {
  projectId: string;
  scanJobId: string | null;
  sourceId: string;
  targetId: string;
  isRuntimeObserved: boolean;
  evidenceFile?: string;
}) {
  const id = randomUUID();
  await db.insert(graphRelationshipsTable).values({
    id,
    projectId: input.projectId,
    scanJobId: input.scanJobId,
    sourceId: input.sourceId,
    targetId: input.targetId,
    relation: "imports",
    isRuntimeObserved: input.isRuntimeObserved,
    provenance: input.isRuntimeObserved
      ? null
      : {
          sourceType: "typescript-ast",
          method: "ts-compiler-api",
          extractedAt: new Date().toISOString(),
          scanSessionId: "previous-scan-session",
          extractorVersion: SCANNER_VERSION,
          evidence: [{ file: input.evidenceFile ?? "src/b.ts", kind: "import-statement" }],
        },
    createdAt: new Date(),
  });
  return id;
}

const extractedRelationship = (input: {
  sourcePath: string;
  targetPath: string;
  evidenceFile: string;
}): ExtractedRelationship => ({
  sourceName: input.sourcePath,
  targetName: input.targetPath,
  sourcePath: input.sourcePath,
  targetPath: input.targetPath,
  relation: "imports",
  isRuntimeObserved: false,
  provenance: {
    sourceType: "typescript-ast",
    method: "ts-compiler-api",
    evidence: [{ file: input.evidenceFile, kind: "import-statement" }],
  },
});

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(graphRelationshipsTable).where(eq(graphRelationshipsTable.projectId, projectId));
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, projectId));
    await db.delete(graphEntitiesTable).where(eq(graphEntitiesTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("planTransactionalGraphRefresh", () => {
  it("composes baseline, relationship snapshot, invalidation, and selection under one transaction", async () => {
    const projectId = await insertProject();
    const baselineId = await insertBaseline(projectId);
    const sourceA = await insertEntity(projectId, "sourceA", "src/a.ts");
    const sourceB = await insertEntity(projectId, "sourceB", "src/b.ts");

    const changedEdgeId = await insertEdge({
      projectId,
      scanJobId: baselineId,
      sourceId: sourceA,
      targetId: sourceB,
      isRuntimeObserved: false,
      evidenceFile: "src/a.ts",
    });
    const unchangedEdgeId = await insertEdge({
      projectId,
      scanJobId: baselineId,
      sourceId: sourceB,
      targetId: sourceB,
      isRuntimeObserved: false,
      evidenceFile: "src/b.ts",
    });
    await insertEdge({
      projectId,
      scanJobId: null,
      sourceId: sourceA,
      targetId: sourceB,
      isRuntimeObserved: true,
    });

    const changedRelationship = extractedRelationship({
      sourcePath: "src/a.ts",
      targetPath: "src/b.ts",
      evidenceFile: "src/a.ts",
    });
    const unchangedRelationship = extractedRelationship({
      sourcePath: "src/b.ts",
      targetPath: "src/b.ts",
      evidenceFile: "src/b.ts",
    });

    const result = await db.transaction((tx) =>
      planTransactionalGraphRefresh({
        tx,
        projectId,
        scanJobId: randomUUID(),
        currentManifest: manifest("revision-2", true),
        scannerVersion: SCANNER_VERSION,
        graphRelationships: [changedRelationship, unchangedRelationship],
        graphIncomplete: false,
      }),
    );

    if (result.mode !== "incremental") {
      throw new Error(`Expected incremental plan, got full: ${result.reason}`);
    }
    expect(result.relationshipIdsToReplace).toEqual([changedEdgeId]);
    expect(result.untouchedStaticRelationshipIds).toEqual([unchangedEdgeId]);
    expect(result.relationshipsToPersist).toEqual([changedRelationship]);
    expect(result.preservedRuntimeRelationshipCount).toBe(1);
    expect(result.affectedEntityPaths).toEqual(["src/a.ts"]);
  });

  it("falls back to full refresh when no trusted completed baseline exists", async () => {
    const projectId = await insertProject();
    const result = await db.transaction((tx) =>
      planTransactionalGraphRefresh({
        tx,
        projectId,
        scanJobId: randomUUID(),
        currentManifest: manifest("revision-2", true),
        scannerVersion: SCANNER_VERSION,
        graphRelationships: [],
        graphIncomplete: false,
      }),
    );
    expect(result).toEqual({ mode: "full", reason: "baseline_unavailable:no_previous_scan" });
  });

  it("requires a durable scan job and a complete current graph", async () => {
    const projectId = await insertProject();
    expect(await db.transaction((tx) => planTransactionalGraphRefresh({
      tx,
      projectId,
      scanJobId: null,
      currentManifest: manifest("revision-2", true),
      scannerVersion: SCANNER_VERSION,
      graphRelationships: [],
      graphIncomplete: false,
    }))).toEqual({ mode: "full", reason: "durable_scan_job_required" });

    expect(await db.transaction((tx) => planTransactionalGraphRefresh({
      tx,
      projectId,
      scanJobId: randomUUID(),
      currentManifest: manifest("revision-2", true),
      scannerVersion: SCANNER_VERSION,
      graphRelationships: [],
      graphIncomplete: true,
    }))).toEqual({ mode: "full", reason: "current_graph_incomplete" });
  });
});
