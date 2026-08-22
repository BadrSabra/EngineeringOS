import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import {
  reportDeadRootPaths,
  scrubHistoricalValidationRecord,
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
