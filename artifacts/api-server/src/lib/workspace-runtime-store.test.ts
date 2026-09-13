import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  projectsTable,
} from "@workspace/db";
import {
  databaseWorkspaceRuntimeStore,
  RUNTIME_LEASE_MS,
} from "./workspace-runtime-store.js";

const projectIds: string[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(projectIds.splice(0).map((projectId) =>
    db.delete(projectsTable).where(eq(projectsTable.id, projectId)),
  ));
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("database workspace runtime store", () => {
  it("serializes active ownership and allows takeover only after release", async () => {
    const projectId = randomUUID();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-runtime-store-"));
    projectIds.push(projectId);
    roots.push(root);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "runtime-store-test-owner",
      name: "Runtime store test",
      rootPath: root,
      language: "typescript",
      status: "active",
    });

    const now = new Date();
    const first = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-a",
      revision: "revision-a",
      workerId: "worker-a",
      now,
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS),
    });
    expect(first?.workerId).toBe("worker-a");

    const blocked = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-b",
      revision: "revision-b",
      workerId: "worker-b",
      now: new Date(now.getTime() + 1_000),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 1_000),
    });
    expect(blocked).toBeUndefined();

    await databaseWorkspaceRuntimeStore.releaseWorker("worker-a");
    const takeover = await databaseWorkspaceRuntimeStore.begin({
      projectId,
      projectRoot: root,
      sessionId: "session-b",
      revision: "revision-b",
      workerId: "worker-b",
      now: new Date(now.getTime() + 2_000),
      leaseUntil: new Date(now.getTime() + RUNTIME_LEASE_MS + 2_000),
    });
    expect(takeover?.workerId).toBe("worker-b");
    expect(takeover?.sessionId).toBe("session-b");
  });
});