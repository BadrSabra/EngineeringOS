import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import {
  loadLatestCompleteScanBaseline,
  readPersistedScanBaseline,
} from "./scan-revision-baseline.js";

const projectIds: string[] = [];

async function insertProject(): Promise<string> {
  const projectId = randomUUID();
  const now = new Date();
  projectIds.push(projectId);
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "scan-revision-baseline-test-user",
    name: `scan-revision-baseline-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/scan-revision-baseline-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return projectId;
}

function completeResult(overrides: Record<string, unknown> = {}) {
  return {
    scanCompleteness: "COMPLETE",
    sourceProvenance: "filesystem-scan",
    scannerVersion: "1.0.0",
    repositoryManifest: {
      revision: "revision-1",
      sourceRoot: "/workspace/project",
      completeness: "COMPLETE",
      files: [{
        path: "src/index.ts",
        size: 12,
        contentHash: "sha256:abc123",
        oversized: false,
      }],
      derivedArtifacts: {
        scanner: "COMPLETE",
        graph: "COMPLETE",
        metrics: "COMPLETE",
      },
    },
    ...overrides,
  };
}

async function insertScanJob(input: {
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: Record<string, unknown> | null;
  createdAt: Date;
  finishedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(scanJobsTable).values({
    id,
    projectId: input.projectId,
    status: input.status,
    result: input.result ?? null,
    createdAt: input.createdAt,
    finishedAt: input.finishedAt ?? null,
  });
  return id;
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("persisted scan revision baseline", () => {
  it("accepts a complete filesystem scan with complete derived artifacts", () => {
    const result = readPersistedScanBaseline({
      scanJobId: "scan-complete",
      result: completeResult(),
    });

    expect(result).toMatchObject({
      available: true,
      baseline: {
        scanJobId: "scan-complete",
        scannerVersion: "1.0.0",
        manifest: {
          revision: "revision-1",
          sourceRoot: "/workspace/project",
          completeness: "COMPLETE",
          files: [{ path: "src/index.ts", contentHash: "sha256:abc123" }],
        },
      },
    });
  });

  it.each([
    ["partial scan", { scanCompleteness: "PARTIAL" }, "scan_not_complete"],
    ["non-filesystem source", { sourceProvenance: "discovery-import" }, "non_filesystem_scan"],
    ["missing scanner version", { scannerVersion: null }, "scanner_version_missing"],
    ["partial file manifest", {
      repositoryManifest: {
        ...completeResult().repositoryManifest,
        completeness: "PARTIAL",
      },
    }, "manifest_incomplete"],
    ["incomplete graph artifact", {
      repositoryManifest: {
        ...completeResult().repositoryManifest,
        derivedArtifacts: { scanner: "COMPLETE", graph: "PARTIAL", metrics: "COMPLETE" },
      },
    }, "derived_artifacts_incomplete"],
  ] as const)("fails closed for %s", (_label, overrides, reason) => {
    expect(readPersistedScanBaseline({
      scanJobId: "scan-invalid",
      result: completeResult(overrides as Record<string, unknown>),
    })).toEqual({ available: false, reason });
  });

  it("rejects duplicate and unsafe manifest paths", () => {
    const duplicate = completeResult({
      repositoryManifest: {
        ...completeResult().repositoryManifest,
        files: [
          { path: "src/index.ts", size: 12, contentHash: "a", oversized: false },
          { path: "src/index.ts", size: 12, contentHash: "b", oversized: false },
        ],
      },
    });
    const unsafe = completeResult({
      repositoryManifest: {
        ...completeResult().repositoryManifest,
        files: [{ path: "../outside.ts", size: 1, contentHash: "a", oversized: false }],
      },
    });

    expect(readPersistedScanBaseline({ scanJobId: "duplicate", result: duplicate }))
      .toEqual({ available: false, reason: "manifest_invalid" });
    expect(readPersistedScanBaseline({ scanJobId: "unsafe", result: unsafe }))
      .toEqual({ available: false, reason: "manifest_invalid" });
  });

  it("selects the latest completed scan and ignores newer queued and failed rows", async () => {
    const projectId = await insertProject();
    const now = new Date();
    const baselineId = await insertScanJob({
      projectId,
      status: "completed",
      result: completeResult(),
      createdAt: new Date(now.getTime() - 30_000),
      finishedAt: new Date(now.getTime() - 20_000),
    });
    await insertScanJob({
      projectId,
      status: "failed",
      result: null,
      createdAt: new Date(now.getTime() - 10_000),
      finishedAt: new Date(now.getTime() - 5_000),
    });
    await insertScanJob({
      projectId,
      status: "queued",
      result: null,
      createdAt: now,
    });

    expect(await loadLatestCompleteScanBaseline(projectId)).toMatchObject({
      available: true,
      baseline: { scanJobId: baselineId, scannerVersion: "1.0.0" },
    });
  });

  it("does not fall back to an older complete scan when the latest completed scan is partial", async () => {
    const projectId = await insertProject();
    const now = new Date();
    await insertScanJob({
      projectId,
      status: "completed",
      result: completeResult(),
      createdAt: new Date(now.getTime() - 20_000),
      finishedAt: new Date(now.getTime() - 10_000),
    });
    await insertScanJob({
      projectId,
      status: "completed",
      result: completeResult({ scanCompleteness: "PARTIAL" }),
      createdAt: new Date(now.getTime() - 5_000),
      finishedAt: now,
    });

    expect(await loadLatestCompleteScanBaseline(projectId)).toEqual({
      available: false,
      reason: "scan_not_complete",
    });
  });


  it("rejects a newest completed row with no finish timestamp instead of falling back", async () => {
    const projectId = await insertProject();
    const now = new Date();
    await insertScanJob({
      projectId,
      status: "completed",
      result: completeResult(),
      createdAt: new Date(now.getTime() - 10_000),
      finishedAt: new Date(now.getTime() - 5_000),
    });
    await insertScanJob({
      projectId,
      status: "completed",
      result: completeResult(),
      createdAt: now,
      finishedAt: null,
    });

    expect(await loadLatestCompleteScanBaseline(projectId)).toEqual({
      available: false,
      reason: "scan_finished_at_missing",
    });
  });

  it("reports no baseline when the project has no completed scan", async () => {
    const projectId = await insertProject();
    expect(await loadLatestCompleteScanBaseline(projectId)).toEqual({
      available: false,
      reason: "no_previous_scan",
    });
  });
});
