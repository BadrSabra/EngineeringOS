import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("../lib/github-connector.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/github-connector.js")>(
    "../lib/github-connector.js",
  );
  return {
    ...actual,
    getGitHubBranchState: vi.fn(),
    pushLocalCommitToGitHub: vi.fn(),
  };
});

vi.mock("../lib/scan-runner.js", () => ({
  runScanJob: vi.fn(async () => undefined),
}));

import app from "../app.js";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  auditLogsTable,
  db,
  eventsTable,
  projectsTable,
  scanJobsTable,
} from "@workspace/db";
import {
  getGitHubBranchState,
  GitHubConnectorError,
  pushLocalCommitToGitHub,
} from "../lib/github-connector.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "../lib/delivery-workspace.js";

const execFileAsync = promisify(execFile);
const pushed = vi.mocked(pushLocalCommitToGitHub);
const branchState = vi.mocked(getGitHubBranchState);
const projectIds: string[] = [];
const rootPaths: string[] = [];

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

async function createCommittedDeliveryFixture() {
  const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-github-route-"));
  rootPaths.push(rootPath);
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const operationId = randomUUID();
  const now = new Date();

  await git(rootPath, ["init", "-q"]);
  await writeFile(path.join(rootPath, "README.md"), "before\n");
  await git(rootPath, ["add", "README.md"]);
  await git(rootPath, [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
    "commit", "-qm", "initial",
  ]);
  const baseTreeHash = await hashDeliveryTree(rootPath);
  await writeFile(path.join(rootPath, "verified.ts"), "export const verified = true;\n");
  const committedTreeHash = await hashDeliveryTree(rootPath);
  await git(rootPath, ["add", "verified.ts"]);
  await git(rootPath, [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
    "commit", "-qm", "verified change",
  ]);
  const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `github-route-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    gitRemoteUrl: "https://github.com/example/project.git",
    gitDefaultBranch: "main",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "GitHub route delivery test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Verified GitHub delivery",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: JSON.stringify([{ path: "verified.ts", newContent: "export const verified = true;\n" }]),
    appliedChanges: JSON.stringify([{ path: "verified.ts", newContent: "export const verified = true;\n" }]),
    status: "applied",
    lifecycle: "committed",
    operationId,
    baseRevision: "fixture",
    changeSetHash: "change-set",
    baseTreeHash,
    candidateTreeHash: committedTreeHash,
    promotedTreeHash: committedTreeHash,
    treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    commitHash,
    committedTreeHash,
    createdAt: now,
    consumedAt: now,
  });
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "GitCommitCreated",
    projectId,
    severity: "info",
    message: "Verified commit created",
    correlationId: operationId,
    payload: {
      proposalId,
      operationId,
      commitHash,
      committedTreeHash,
      committedPaths: ["verified.ts"],
    },
  });

  projectIds.push(projectId);
  return { projectId, proposalId, operationId, rootPath, commitHash, committedTreeHash };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(scanJobsTable).where(eq(scanJobsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
    const sessions = await db
      .select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.projectId, projectId));
    for (const session of sessions) {
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, session.id)).catch(() => undefined);
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const rootPath of rootPaths.splice(0)) {
    await rm(rootPath, { recursive: true, force: true });
  }
});

describe("GitHub-shaped Git push route", () => {
  beforeEach(() => {
    pushed.mockReset();
    branchState.mockReset();
  });

  it("uses the verified service, records one receipt, and replays idempotently", async () => {
    const fixture = await createCommittedDeliveryFixture();
    pushed.mockResolvedValue({
      remoteCommitHash: "remote-commit-1",
      changedPaths: ["verified.ts"],
    });

    const first = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/push`)
      .send({ proposalId: fixture.proposalId, operationId: fixture.operationId });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true,
      correlationId: fixture.operationId,
      commitHash: fixture.commitHash,
      remoteCommitHash: "remote-commit-1",
    });
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(pushed.mock.calls[0]?.[0]).toMatchObject({
      branch: "main",
      commitHash: fixture.commitHash,
      message: expect.stringContaining(`EngineeringOS-Operation: ${fixture.operationId}`),
    });

    const replay = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/push`)
      .send({ proposalId: fixture.proposalId, operationId: fixture.operationId });

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      ok: true,
      idempotent: true,
      correlationId: fixture.operationId,
      commitHash: fixture.commitHash,
      remoteCommitHash: "remote-commit-1",
    });
    expect(pushed).toHaveBeenCalledTimes(1);

    const receipts = await db
      .select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "GitPushed"),
        eq(eventsTable.correlationId, fixture.operationId),
      ));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload).toMatchObject({
      proposalId: fixture.proposalId,
      operationId: fixture.operationId,
      commitHash: fixture.commitHash,
      remoteCommitHash: "remote-commit-1",
      baseTreeHash: expect.any(String),
      candidateTreeHash: fixture.committedTreeHash,
      promotedTreeHash: fixture.committedTreeHash,
      committedTreeHash: fixture.committedTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    });

    const audits = await db
      .select({ id: auditLogsTable.id })
      .from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.projectId, fixture.projectId),
        eq(auditLogsTable.correlationId, fixture.operationId),
      ));
    expect(audits).toHaveLength(1);
  });

  it("blocks remote drift through the shared service without recording a receipt", async () => {
    const fixture = await createCommittedDeliveryFixture();
    pushed.mockRejectedValue(new GitHubConnectorError(
      "GitHub branch changed after the verified local commit; pull/reconcile before pushing",
      "GITHUB_PUSH_REMOTE_DRIFT",
      409,
    ));
    branchState.mockResolvedValue({
      commitHash: "unrelated-remote-commit",
      treeHash: "unrelated-remote-tree",
      message: "Unrelated remote work",
      parentHashes: ["unrelated-parent"],
    });

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/push`)
      .send({ proposalId: fixture.proposalId, operationId: fixture.operationId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "GITHUB_PUSH_REMOTE_DRIFT",
      proposalId: fixture.proposalId,
      operationId: fixture.operationId,
      commitHash: fixture.commitHash,
    });
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(branchState).toHaveBeenCalledTimes(1);

    const receipts = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "GitPushed"),
        eq(eventsTable.correlationId, fixture.operationId),
      ));
    expect(receipts).toHaveLength(0);
  });
});