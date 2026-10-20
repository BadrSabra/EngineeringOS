import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import {
  DELIVERY_TREE_DIGEST_VERSION,
  hashChangeSet,
  hashDeliveryTree,
} from "./delivery-workspace.js";
import { createControlledLocalBareGitHubRequest } from "./local-bare-github-adapter.js";
import type { GitHubRequest } from "./github-connector.js";

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

  it("blocks branch drift before mutation and reconciles a remote commit after its GitPushed receipt is lost", async () => {
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
      const remoteCommitHash = commitHash;
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

      const preflightDriftCalls: string[] = [];
      let beforeStateObserved = false;
      const driftedBeforePush = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath }),
        executionId: "execution-delivery-drift",
        executionAttempt: 1,
        sourceRevision: "revision-delivery-drift",
        beforeStateObserver: async () => {
          beforeStateObserved = true;
        },
        request: async (requestPath, init) => {
          preflightDriftCalls.push(`${init?.method ?? "GET"} ${requestPath}`);
          if (requestPath.endsWith("/git/ref/heads/main")) {
            return { object: { sha: "remote-drift-commit" } };
          }
          if (requestPath.endsWith("/git/commits/remote-drift-commit")) {
            return {
              tree: { sha: "remote-drift-tree" },
              message: "Unexpected branch update",
              parents: [{ sha: parentHash }],
            };
          }
          throw new Error(`unexpected GitHub path: ${requestPath}`);
        },
      });
      expect(driftedBeforePush).toMatchObject({ status: "blocked" });
      expect(beforeStateObserved).toBe(false);
      expect(preflightDriftCalls).toEqual([
        "GET /repos/example/project/git/ref/heads/main",
        "GET /repos/example/project/git/commits/remote-drift-commit",
      ]);

      const result = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath }),
        executionId: "execution-delivery",
        executionAttempt: 2,
        sourceRevision: "revision-delivery",
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
        afterState: {
          status: "passed",
          projectId,
          proposalId,
          operationId,
          executionId: "execution-delivery",
          executionAttempt: 2,
          sourceRevision: "revision-delivery",
          expectedCommitHash: commitHash,
          remoteCommitHash: commitHash,
          expectedParentHash: parentHash,
          remoteParentHash: parentHash,
          expectedTreeHash: localTreeSha,
          remoteTreeHash: localTreeSha,
          remoteParentCount: 1,
          candidateTreeHash: committedTreeHash,
          committedTreeHash,
          operationMarker: `EngineeringOS-Operation: ${operationId}`,
          markerMatched: true,
        },
      });
      expect(calls).toEqual([
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

      const mismatchedCommitCalls: string[] = [];
      const mismatchedCommitReplay = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath }),
        request: async (requestPath, init) => {
          mismatchedCommitCalls.push(`${init?.method ?? "GET"} ${requestPath}`);
          if (requestPath.endsWith("/git/ref/heads/main")) {
            return { object: { sha: "different-remote-commit" } };
          }
          if (requestPath.endsWith("/git/commits/different-remote-commit")) {
            return {
              tree: { sha: localTreeSha },
              message: `Verified delivery\n\nEngineeringOS-Operation: ${operationId}`,
              parents: [{ sha: parentHash }],
            };
          }
          throw new Error(`unexpected GitHub path: ${requestPath}`);
        },
      });
      expect(mismatchedCommitReplay).toMatchObject({ status: "unavailable" });
      expect(mismatchedCommitCalls).toEqual([
        "GET /repos/example/project/git/ref/heads/main",
        "GET /repos/example/project/git/commits/different-remote-commit",
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

  it("delivers an approved, committed candidate through the controlled local bare remote", async () => {
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), "engineeringos-approved-delivery-"));
    const rootPath = path.join(temporaryRoot, "workspace");
    const bareRemotePath = path.join(temporaryRoot, "remote.git");
    const projectId = randomUUID();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    const remoteUrl = "https://github.com/fixture/engineering-agent-lifecycle";
    try {
      await mkdir(rootPath, { recursive: true });
      await execFileAsync("git", ["init", "--bare", "--initial-branch=main", bareRemotePath]);
      await git(rootPath, ["init", "-q", "--initial-branch=main"]);
      await writeFile(path.join(rootPath, "README.md"), "base\n", "utf8");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=Lifecycle Fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "-qm", "Mission source",
      ]);
      const baseTreeHash = await hashDeliveryTree(rootPath);
      const baseCommit = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.toString().trim();
      await git(rootPath, ["remote", "add", "origin", bareRemotePath]);
      await git(rootPath, ["push", "origin", "main"]);

      const candidateContent = "verified Mission repair\n";
      const changeSetHash = hashChangeSet([{ path: "README.md", newContent: candidateContent }]);
      await writeFile(path.join(rootPath, "README.md"), candidateContent, "utf8");
      await git(rootPath, ["add", "README.md"]);
      await git(rootPath, [
        "-c", "user.name=EngineeringOS", "-c", "user.email=ai@engineeringos.local",
        "commit", "-qm", `Apply reviewed Mission candidate\n\nEngineeringOS-Operation: ${operationId}`,
      ]);
      const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.toString().trim();
      const candidateTreeHash = await hashDeliveryTree(rootPath);

      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: "approved-delivery-test",
        name: `approved-delivery-${projectId.slice(0, 8)}`,
        rootPath,
        language: "typescript",
        status: "active",
        gitRemoteUrl: remoteUrl,
        gitDefaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiChatSessionsTable).values({
        id: sessionId,
        projectId,
        title: "Approved Mission delivery",
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(aiChatMessagesTable).values({
        id: messageId,
        sessionId,
        role: "assistant",
        content: "Approved Mission candidate",
        createdAt: now,
      });
      await db.insert(aiChangeProposalsTable).values({
        id: proposalId,
        projectId,
        sessionId,
        messageId,
        changes: JSON.stringify([{ path: "README.md", newContent: candidateContent }]),
        status: "pending",
        lifecycle: "validated",
        approvalRequired: true,
        operationId,
        baseRevision: "accepted-source-revision",
        changeSetHash,
        baseTreeHash,
        candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        createdAt: now,
      });

      const envKeys = [
        "RUN_CONTROLLED_RELEASE_VALIDATION",
        "DASHBOARD_E2E_TEST_MODE",
        "ENGINEERING_AGENT_LIFECYCLE_E2E",
        "ENGINEERING_AGENT_LIFECYCLE_REMOTE",
        "NODE_ENV",
      ] as const;
      const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
      Object.assign(process.env, {
        RUN_CONTROLLED_RELEASE_VALIDATION: "1",
        DASHBOARD_E2E_TEST_MODE: "fixture",
        ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
        ENGINEERING_AGENT_LIFECYCLE_REMOTE: bareRemotePath,
        NODE_ENV: "test",
      });
      let fixtureRequest: GitHubRequest | undefined;
      try {
        fixtureRequest = await createControlledLocalBareGitHubRequest(remoteUrl);
      } finally {
        for (const [key, value] of previousEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
      if (!fixtureRequest) throw new Error("Controlled local bare remote fixture did not activate.");

      const connectorCalls: string[] = [];
      const request: GitHubRequest = async (requestPath, init) => {
        connectorCalls.push(`${init?.method ?? "GET"} ${requestPath}`);
        return fixtureRequest!(requestPath, init);
      };
      const beforeApproval = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath, remoteUrl }),
        branch: "main",
        request,
      });
      expect(beforeApproval).toMatchObject({ status: "blocked" });
      expect(connectorCalls).toEqual([]);
      expect((await git(bareRemotePath, ["rev-parse", "refs/heads/main"])).stdout.toString().trim())
        .toBe(baseCommit);

      await db.update(aiChangeProposalsTable)
        .set({
          status: "applied",
          lifecycle: "committed",
          approvalRequired: false,
          promotedTreeHash: candidateTreeHash,
          committedTreeHash: candidateTreeHash,
          commitHash,
          consumedAt: now,
        })
        .where(eq(aiChangeProposalsTable.id, proposalId));
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "GitCommitCreated",
        projectId,
        severity: "info",
        message: "Approved Mission candidate committed",
        correlationId: operationId,
        payload: {
          proposalId,
          operationId,
          commitHash,
          committedTreeHash: candidateTreeHash,
          committedPaths: ["README.md"],
        },
      });

      const delivered = await executeVerifiedGitHubDelivery({
        ...params({ projectId, proposalId, operationId, rootPath, remoteUrl }),
        branch: "main",
        request,
      });
      expect(delivered).toMatchObject({
        status: "passed",
        candidateTreeHash,
        treeHash: candidateTreeHash,
        afterState: {
          status: "passed",
          proposalId,
          operationId,
          expectedParentHash: baseCommit,
          remoteParentHash: baseCommit,
          markerMatched: true,
        },
      });
      expect(connectorCalls.some((call) => call.startsWith("PATCH "))).toBe(true);
      const remoteHead = (await git(bareRemotePath, ["rev-parse", "refs/heads/main"])).stdout.toString().trim();
      expect(remoteHead).toBe(commitHash);
      expect((await execFileAsync("git", [
        "--git-dir", bareRemotePath, "show", `${remoteHead}:README.md`,
      ], { encoding: "utf8" })).stdout).toBe(candidateContent);
      expect((await git(bareRemotePath, ["show", "-s", "--format=%P", remoteHead])).stdout.toString().trim())
        .toBe(baseCommit);

      const [pushReceipt] = await db.select({ payload: eventsTable.payload })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, projectId),
          eq(eventsTable.type, "GitPushed"),
          eq(eventsTable.correlationId, operationId),
        ))
        .limit(1);
      expect(pushReceipt?.payload).toMatchObject({
        proposalId,
        operationId,
        commitHash,
        remoteCommitHash: remoteHead,
        remoteParentHash: baseCommit,
        remoteTreeHash: (await git(bareRemotePath, ["rev-parse", `${remoteHead}^{tree}`])).stdout.toString().trim(),
      });
    } finally {
      await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, sessionId)).catch(() => undefined);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});