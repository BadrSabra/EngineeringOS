import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool, projectsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import {
  reportDeadRootPaths,
  retainHistoricalCheckpoint,
  retainHistoricalValidationMetadata,
  scrubHistoricalValidationRecord,
  getAiDiagnosticsRetentionHealth,
  pruneHistoricalAiDiagnostics,
} from "./startup-migrations";

async function insertProject(rootPath: string): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: `startup-mig-${id.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("reportDeadRootPaths — never rebinds a dead root", () => {
  const cleanupQueue: string[] = [];

  afterEach(async () => {
    while (cleanupQueue.length > 0) {
      const id = cleanupQueue.pop();
      if (id) await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
  });

  it("leaves a dead /tmp/eos-git-* rootPath untouched (no workspace rebinding)", async () => {
    const deadRoot = `/tmp/eos-git-${randomUUID()}`; // never exists on disk
    const projectId = await insertProject(deadRoot);
    cleanupQueue.push(projectId);

    await reportDeadRootPaths();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(deadRoot);
    expect(row[0]?.rootPath).not.toBe("/home/runner/workspace");
  });

  it("leaves valid roots and non-git roots untouched", async () => {
    const validRoot = `/home/runner/workspace/.test-roots/mig-${randomUUID()}`;
    const projectId = await insertProject(validRoot);
    cleanupQueue.push(projectId);

    await expect(reportDeadRootPaths()).resolves.toBeUndefined();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(validRoot);
  });

  it("is idempotent — safe to run repeatedly", async () => {
    const deadRoot = `/tmp/eos-git-${randomUUID()}`;
    const projectId = await insertProject(deadRoot);
    cleanupQueue.push(projectId);

    await reportDeadRootPaths();
    await reportDeadRootPaths();

    const row = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    expect(row[0]?.rootPath).toBe(deadRoot);
  });
});

describe("scrubHistoricalValidationRecord", () => {
  it("keeps proof and exit metadata while removing legacy validation diagnostics", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      kind: "validation",
      repairState: "BLOCKED",
      attempt: 2,
      maxAttempts: 3,
      validation: {
        profile: "workspace-typecheck",
        status: "failed",
        scenario: "typecheck",
        exitCode: 1,
        command: "pnpm test --filter private",
        stdout: "PRIVATE_SOURCE=must-not-persist",
        stderr: "secret@example.com",
        failedTests: [{ name: "private.test.ts", message: "source details" }],
        changedFiles: ["src/private.ts"],
        evidence: {
          evidenceId: "validation-result:1",
          observedAt: "2026-08-22T00:00:00.000Z",
          artifactRef: "validation-result:1",
        },
      },
    }) as Record<string, unknown>;

    expect(scrubbed).toEqual({
      kind: "validation",
      repairState: "BLOCKED",
      attempt: 2,
      maxAttempts: 3,
      validation: {
        profile: "workspace-typecheck",
        status: "failed",
        scenario: "typecheck",
        exitCode: 1,
        evidence: {
          evidenceId: "validation-result:1",
          observedAt: "2026-08-22T00:00:00.000Z",
          artifactRef: "validation-result:1",
        },
      },
    });
  });

  it("projects legacy flattened fields and strips their diagnostic payload", () => {
    const scrubbed = scrubHistoricalValidationRecord({
      kind: "validation",
      validationStatus: "passed",
      validationProfile: "api-ai-tests",
      validationScenario: "focused tests",
      validationExitCode: 0,
      validationCommand: "pnpm test",
      validationFailedTests: ["secret test output"],
      validationAffectedFiles: ["src/private.ts"],
      validationDetail: "raw command output",
    }) as Record<string, unknown>;

    expect(scrubbed).toEqual({
      kind: "validation",
      validation: {
        profile: "api-ai-tests",
        status: "passed",
        scenario: "focused tests",
        exitCode: 0,
      },
    });
  });

  it("recursively scrubs validation steps without changing unrelated trace entries", () => {
    const scrubbed = scrubHistoricalValidationRecord([
      { kind: "tool_result", tool: "read_file", resultSummary: "safe summary" },
      { kind: "validation", status: "passed", exitCode: 0, command: "pnpm test", stdout: "raw" },
    ]);

    expect(scrubbed).toEqual([
      { kind: "tool_result", tool: "read_file", resultSummary: "safe summary" },
      { kind: "validation", validation: { status: "passed", exitCode: 0 } },
    ]);
  });
});

describe("historical AI diagnostic retention", () => {
  it("reports a successful no-op sweep with bounded counts and timestamps", async () => {
    const runAt = new Date("2026-08-22T00:00:00.000Z");
    await pruneHistoricalAiDiagnostics(runAt);

    expect(getAiDiagnosticsRetentionHealth()).toEqual({
      status: "success",
      attemptedAt: runAt.toISOString(),
      completedAt: runAt.toISOString(),
      chatRowsScanned: expect.any(Number),
      chatRowsPruned: expect.any(Number),
      executionRowsScanned: expect.any(Number),
      executionRowsPruned: expect.any(Number),
    });
  });

  it("reports a failed sweep without exposing the error and leaves it retryable", async () => {
    const query = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("database details"));
    const runAt = new Date("2026-08-22T01:00:00.000Z");

    await expect(pruneHistoricalAiDiagnostics(runAt)).resolves.toBeUndefined();

    expect(getAiDiagnosticsRetentionHealth()).toEqual({
      status: "failed",
      attemptedAt: runAt.toISOString(),
      completedAt: null,
      chatRowsScanned: 0,
      chatRowsPruned: 0,
      executionRowsScanned: 0,
      executionRowsPruned: 0,
    });
    expect(JSON.stringify(getAiDiagnosticsRetentionHealth())).not.toContain("database details");
    query.mockRestore();
  });

  it("retains proof and exit metadata while dropping arbitrary trace data", () => {
    const trace = [
      { kind: "tool_result", tool: "read_file", resultSummary: "private source" },
      {
        kind: "validation",
        repairState: "BLOCKED",
        validation: {
          status: "failed",
          exitCode: 17,
          evidence: { evidenceId: "validation-result:old", artifactRef: "validation-result:old" },
          stderr: "private output",
        },
      },
    ];

    expect(retainHistoricalValidationMetadata(trace)).toEqual([{
      kind: "validation",
      repairState: "BLOCKED",
      validation: {
        status: "failed",
        exitCode: 17,
        evidence: { evidenceId: "validation-result:old", artifactRef: "validation-result:old" },
      },
    }]);
  });

  it("compacts a terminal checkpoint and is stable when repeated", () => {
    const checkpoint = {
      stage: "failed",
      sequence: 42,
      updatedAt: "2026-01-01T00:00:00.000Z",
      evidenceVerdict: "BLOCKED",
      evidenceReason: "Validation failed",
      proofRequired: true,
      detail: "private provider diagnostic",
      recentSteps: [
        { kind: "tool_result", result: "private source" },
        { kind: "validation", status: "failed", exitCode: 2, stdout: "private output" },
      ],
    };
    const compacted = retainHistoricalCheckpoint(checkpoint);
    expect(compacted).toEqual({
      stage: "failed",
      sequence: 42,
      updatedAt: "2026-01-01T00:00:00.000Z",
      evidenceVerdict: "BLOCKED",
      evidenceReason: "Validation failed",
      proofRequired: true,
      recentSteps: [{ kind: "validation", validation: { status: "failed", exitCode: 2 } }],
    });
    expect(retainHistoricalCheckpoint(compacted)).toEqual(compacted);
  });
});
