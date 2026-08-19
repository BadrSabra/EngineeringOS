import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { reportDeadRootPaths } from "./startup-migrations";

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
