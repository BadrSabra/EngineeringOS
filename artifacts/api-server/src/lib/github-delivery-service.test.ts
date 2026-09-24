import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { describe, expect, it } from "vitest";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "./delivery-workspace.js";

const execFileAsync = promisify(execFile);

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

function params(overrides: Partial<Parameters<typeof executeVerifiedGitHubDelivery>[0]> = {}) {
  return {
    projectId: randomUUID(),
    proposalId: randomUUID(),
    operationId: randomUUID(),
    rootPath: process.cwd(),
    remoteUrl: "https://github.com/example/project.git",
    branch: "main",
    message: "Verified delivery",
    ...overrides,
  };
}

describe("verified GitHub delivery service", () => {
  it("does not touch the database or connector after cancellation", async () => {
    const result = await executeVerifiedGitHubDelivery(params({
      signal: AbortSignal.abort(),
    }));
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery was cancelled before execution.",
    });
  });

  it("rejects non-GitHub remotes before proposal lookup or mutation", async () => {
    const result = await executeVerifiedGitHubDelivery(params({
      remoteUrl: "https://gitlab.com/example/project.git",
    }));
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery requires a credential-free HTTPS GitHub remote.",
    });
  });

  it("fails closed when the committed proposal cannot be found", async () => {
    const result = await executeVerifiedGitHubDelivery(params());
    expect(result).toMatchObject({
      status: "blocked",
      detail: "GitHub delivery requires the same committed proposal operation.",
    });
  });

  it("reconciles a remote commit after the local GitPushed receipt was lost", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-delivery-recovery-"));
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    try {
      await git(rootPath, ["init", "-q"]);
      await writeFile(path.join(rootPath, "README.md"), "before\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "initial",
      ]);
      const baseTreeHash = await hashDeliveryTree(rootPath);
      const parentHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
      await writeFile(path.join(rootPath, "README.md"), "after\n");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
        "commit", "-qm", "verified change",
      ]);
      const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
      const committedTreeHash = await hashDeliveryTree(rootPath);
      const localTreeSha = (await git(rootPath, ["rev-parse", `${commitHash}^{tree}`])).stdout.trim();
      const remoteCommitHash = "remote-applied";
      const calls: string[] = [];

      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: "delivery-recovery-test",
        name: `delivery-recovery-${projectId.slice(0, 8)}`,
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
        title: "Delivery recovery test",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiChatMessagesTable).values({
        id: messageId,
        sessionId,
        role: "assistant",
        content: "Verified delivery",
        createdAt: now,
      });
      await db.insert(aiChangeProposalsTable).values({
        id: proposalId,
        projectId,
        sessionId,
        messageId,
        changes: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
        appliedChanges: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
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
          committedPaths: ["README.md"],
        },
      });

      const result = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath }),
        request: async (requestPath, init) => {
          calls.push(`${init?.method ?? "GET"} ${requestPath}`);
          if (requestPath.endsWith("/git/ref/heads/main")) {
            return { object: { sha: remoteCommitHash } };
          }
          if (requestPath.endsWith(`/git/commits/${remoteCommitHash}`)) {
            return {
              tree: { sha: localTreeSha },
              message: `Verified delivery\n\nEngineeringOS-Operation: ${operationId}`,
              parents: [{ sha: parentHash }],
            };
          }
          throw new Error(`unexpected GitHub path: ${requestPath}`);
        },
      });

      expect(result).toMatchObject({
        status: "passed",
        idempotent: true,
        remoteCommitHash,
        remoteParentHash: parentHash,
        remoteTreeHash: localTreeSha,
        operationMarker: `EngineeringOS-Operation: ${operationId}`,
      });
      expect(calls).toEqual([
        "GET /repos/example/project/git/ref/heads/main",
        "GET /repos/example/project/git/ref/heads/main",
        `GET /repos/example/project/git/commits/${remoteCommitHash}`,
      ]);
      const [receipt] = await db
        .select({ payload: eventsTable.payload })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, projectId),
          eq(eventsTable.type, "GitPushed"),
          eq(eventsTable.correlationId, operationId),
        ))
        .limit(1);
      expect(receipt?.payload).toMatchObject({
        proposalId,
        operationId,
        commitHash,
        remoteCommitHash,
        remoteParentHash: parentHash,
        remoteTreeHash: localTreeSha,
        operationMarker: `EngineeringOS-Operation: ${operationId}`,
      });

      const driftCalls: string[] = [];
      const driftedReplay = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath }),
        request: async (requestPath, init) => {
          driftCalls.push(`${init?.method ?? "GET"} ${requestPath}`);
          if (requestPath.endsWith("/git/ref/heads/main")) {
            return { object: { sha: remoteCommitHash } };
          }
          if (requestPath.endsWith(`/git/commits/${remoteCommitHash}`)) {
            return {
              tree: { sha: "unexpected-remote-tree" },
              message: `Verified delivery\n\nEngineeringOS-Operation: ${operationId}`,
              parents: [{ sha: parentHash }],
            };
          }
          throw new Error(`unexpected GitHub path: ${requestPath}`);
        },
      });
      expect(driftedReplay).toMatchObject({ status: "unavailable" });
      expect(driftCalls).toEqual([
        "GET /repos/example/project/git/ref/heads/main",
        `GET /repos/example/project/git/commits/${remoteCommitHash}`,
      ]);
      const pushEvents = await db.select({ id: eventsTable.id })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, projectId),
          eq(eventsTable.type, "GitPushed"),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(pushEvents).toHaveLength(1);
    } finally {
      await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, sessionId)).catch(() => undefined);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});