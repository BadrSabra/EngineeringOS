import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq, and } from "drizzle-orm";
import app from "../app.js";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  auditLogsTable,
  aiProviderCredentialsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { encryptApiKey } from "../lib/credentials-crypto.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashChangeSet, hashDeliveryTree } from "../lib/delivery-workspace.js";

const execFileAsync = promisify(execFile);
const FIXTURE_REMOTE = "https://fixture.local/engineeringos.git";
const projectIds: string[] = [];
const rootPaths: string[] = [];
const credentialIds: string[] = [];

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 1_000_000 });
}

async function createFixture() {
  const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-git-"));
  rootPaths.push(rootPath);
  await git(rootPath, ["init", "-q"]);
  await writeFile(path.join(rootPath, "README.md"), "fixture\n");
  await git(rootPath, ["add", "README.md"]);
  await git(rootPath, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "fixture"]);
  const change = {
    path: "verified.ts",
    absolutePath: path.join(rootPath, "verified.ts"),
    newContent: "export const verified = true;\n",
    originalContent: null,
    reason: "Verified implementation change",
    validationProfile: "workspace-typecheck",
  };
  const baseTreeHash = await hashDeliveryTree(rootPath);
  await writeFile(path.join(rootPath, "verified.ts"), change.newContent);
  const promotedTreeHash = await hashDeliveryTree(rootPath);
  const changeSetHash = hashChangeSet([change]);

  const projectId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `git-test-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Git test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Verified AI change",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: JSON.stringify([change]),
    appliedChanges: JSON.stringify([change]),
    status: "applied",
    lifecycle: "applied",
    operationId: proposalId,
    baseRevision: "fixture",
    changeSetHash,
    baseTreeHash,
    candidateTreeHash: promotedTreeHash,
    promotedTreeHash,
    treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    commitHash: null,
    committedTreeHash: null,
    createdAt: now,
    consumedAt: now,
  });
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiChangesApplied",
    projectId,
    severity: "success",
    message: "AI apply verified for Git test",
    correlationId: proposalId,
    payload: {
      proposalId,
      operationId: proposalId,
      applyStatus: "APPLIED",
      appliedFiles: ["verified.ts"],
      baseTreeHash,
      candidateTreeHash: promotedTreeHash,
      promotedTreeHash,
      changeSetHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    },
  });
  projectIds.push(projectId);
  return { projectId, proposalId, rootPath, baseTreeHash, promotedTreeHash, changeSetHash };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, projectId)).catch(() => undefined);
    const sessions = await db.select({ id: aiChatSessionsTable.id }).from(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId));
    for (const session of sessions) {
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, session.id)).catch(() => undefined);
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const credentialId of credentialIds.splice(0)) {
    await db.delete(aiProviderCredentialsTable).where(eq(aiProviderCredentialsTable.id, credentialId)).catch(() => undefined);
  }
  for (const rootPath of rootPaths.splice(0)) {
    await rm(rootPath, { recursive: true, force: true });
  }
});

describe("AI-scoped Git commits", () => {
  it("rejects an AI commit when successful Apply evidence is missing", async () => {
    const fixture = await createFixture();
    await db.delete(eventsTable).where(and(
      eq(eventsTable.projectId, fixture.projectId),
      eq(eventsTable.type, "AiChangesApplied"),
    ));
    await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/commit`)
      .send({ message: "Apply verified AI changes", proposalId: fixture.proposalId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "AI_COMMIT_REQUIRES_APPLY_EVIDENCE",
      proposalId: fixture.proposalId,
      operationId: fixture.proposalId,
    });
  });

  it("rejects a scoped commit when unrelated working-tree changes exist", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");
    await writeFile(path.join(fixture.rootPath, "unrelated.ts"), "export const unrelated = true;\n");

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/commit`)
      .send({ message: "Apply verified AI changes", proposalId: fixture.proposalId });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "AI_COMMIT_UNRELATED_WORKTREE_CHANGES",
      paths: ["unrelated.ts"],
    });
  });

  it("rejects a scoped commit when unrelated changes are already staged", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");
    await writeFile(path.join(fixture.rootPath, "unrelated.ts"), "export const unrelated = true;\n");
    await git(fixture.rootPath, ["add", "unrelated.ts"]);

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/commit`)
      .send({ message: "Apply verified AI changes", proposalId: fixture.proposalId });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("AI_COMMIT_UNRELATED_STAGED_CHANGES");
  });

  it("recovers a local commit when the process stopped before writing its receipt", async () => {
    const fixture = await createFixture();
    const message = "Apply verified AI changes";
    await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");
    await git(fixture.rootPath, ["add", "--", "verified.ts"]);
    await git(fixture.rootPath, [
      "-c", "user.name=EngineeringOS",
      "-c", "user.email=ai@engineeringos.local",
      "commit", "-qm", message,
    ]);

    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/commit`)
      .send({
        message,
        proposalId: fixture.proposalId,
        operationId: fixture.proposalId,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      recovered: true,
      correlationId: fixture.proposalId,
      committedPaths: ["verified.ts"],
    });
    const receipts = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "GitCommitCreated"),
      ));
    expect(receipts).toHaveLength(1);
  });

  it("completes an approved Apply → commit → push flow with one operation trace", async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    const remoteRoot = await mkdtemp(path.join(tmpdir(), "engineeringos-git-remote-"));
    rootPaths.push(remoteRoot);
    const remotePath = path.join(remoteRoot, "remote.git");
    await git(remoteRoot, ["init", "--bare", "-q", remotePath]);
    await git(fixture.rootPath, ["branch", "-M", "main"]);

    const originalPath = process.env.PATH ?? "";
    const actualGitPath = (await execFileAsync("sh", ["-c", "command -v git"])).stdout.trim();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "engineeringos-git-wrapper-"));
    rootPaths.push(wrapperDir);
    const wrapperPath = path.join(wrapperDir, "git");
    await writeFile(wrapperPath, `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const pushIndex = args.indexOf("push");
if (pushIndex >= 0 && args[pushIndex + 1]?.startsWith("https://x-access-token:")) {
  args[pushIndex + 1] = process.env.FIXTURE_GIT_REMOTE;
}
const result = spawnSync(${JSON.stringify(actualGitPath)}, args, {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
`, "utf8");
    await chmod(wrapperPath, 0o755);

    const now = new Date();
    await db.update(projectsTable)
      .set({
        gitRemoteUrl: FIXTURE_REMOTE,
        gitDefaultBranch: "main",
      })
      .where(eq(projectsTable.id, fixture.projectId));
    await db.update(eventsTable)
      .set({
        correlationId: operationId,
        payload: {
          proposalId: fixture.proposalId,
          operationId,
          applyStatus: "APPLIED",
          appliedFiles: ["verified.ts"],
          baseTreeHash: fixture.baseTreeHash,
          candidateTreeHash: fixture.promotedTreeHash,
          promotedTreeHash: fixture.promotedTreeHash,
          changeSetHash: fixture.changeSetHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        },
      })
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "AiChangesApplied"),
      ));
    await db.update(aiChangeProposalsTable)
      .set({ operationId })
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    const previousCryptoKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
    const credentialId = randomUUID();
    const encryptedApiKey = encryptApiKey("fixture-token");
    await db.insert(aiProviderCredentialsTable).values({
      id: credentialId,
      ownerId: "test-user",
      provider: "github",
      encryptedApiKey,
      last4: "oken",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: {
        encryptedApiKey,
        last4: "oken",
        updatedAt: now,
      },
    });
    const [credential] = await db
      .select({ id: aiProviderCredentialsTable.id })
      .from(aiProviderCredentialsTable)
      .where(and(
        eq(aiProviderCredentialsTable.ownerId, "test-user"),
        eq(aiProviderCredentialsTable.provider, "github"),
      ))
      .limit(1);
    if (credential) credentialIds.push(credential.id);

    const originalPathEnv = process.env.PATH;
    const originalRemoteEnv = process.env.FIXTURE_GIT_REMOTE;
    process.env.PATH = `${wrapperDir}:${originalPath}`;
    process.env.FIXTURE_GIT_REMOTE = remotePath;
    try {
      await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");

      const commit = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/commit`)
        .send({
          message: "Apply verified AI changes",
          proposalId: fixture.proposalId,
          operationId,
        });
      expect(commit.status).toBe(200);
      expect(commit.body).toMatchObject({
        correlationId: operationId,
        committedPaths: ["verified.ts"],
        baseTreeHash: fixture.baseTreeHash,
        candidateTreeHash: fixture.promotedTreeHash,
        promotedTreeHash: fixture.promotedTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      });
      const duplicateCommit = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/commit`)
        .send({
          message: "Apply verified AI changes",
          proposalId: fixture.proposalId,
          operationId,
        });
      expect(duplicateCommit.status).toBe(200);
      expect(duplicateCommit.body).toMatchObject({
        ok: true,
        idempotent: true,
        correlationId: operationId,
        commitHash: commit.body.commitHash,
      });

      const wrongOperationPush = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId: randomUUID() });
      expect(wrongOperationPush.status).toBe(409);
      expect(wrongOperationPush.body.code).toBe("AI_PUSH_REQUIRES_COMMIT_EVIDENCE");

      const push = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId });
      expect(push.status).toBe(200);
      expect(push.body).toMatchObject({
        ok: true,
        branch: "main",
        correlationId: operationId,
        commitHash: commit.body.commitHash,
        baseTreeHash: fixture.baseTreeHash,
        candidateTreeHash: fixture.promotedTreeHash,
        promotedTreeHash: fixture.promotedTreeHash,
        committedTreeHash: commit.body.committedTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      });
      const duplicatePush = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId });
      expect(duplicatePush.status).toBe(200);
      expect(duplicatePush.body).toMatchObject({
        ok: true,
        idempotent: true,
        correlationId: operationId,
        commitHash: commit.body.commitHash,
      });

      const { stdout: remoteFiles } = await execFileAsync("git", [
        "--git-dir", remotePath, "show", "--format=", "--name-only", "main",
      ]);
      expect(remoteFiles.trim()).toBe("verified.ts");

      const traceEvents = await db
        .select({
          type: eventsTable.type,
          correlationId: eventsTable.correlationId,
          payload: eventsTable.payload,
        })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, fixture.projectId),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(traceEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining(["AiChangesApplied", "GitCommitCreated", "GitPushed"]),
      );
      for (const event of traceEvents.filter((entry) => ["AiChangesApplied", "GitCommitCreated", "GitPushed"].includes(entry.type))) {
        expect(event.correlationId).toBe(operationId);
        expect(event.payload).toMatchObject({
          proposalId: fixture.proposalId,
          operationId,
        });
        if (event.type === "AiChangesApplied") {
          expect(event.payload).toMatchObject({
            baseTreeHash: fixture.baseTreeHash,
            candidateTreeHash: fixture.promotedTreeHash,
            promotedTreeHash: fixture.promotedTreeHash,
            changeSetHash: fixture.changeSetHash,
            treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          });
        }
        if (event.type === "GitCommitCreated") {
          expect(event.payload).toMatchObject({
            baseTreeHash: fixture.baseTreeHash,
            candidateTreeHash: fixture.promotedTreeHash,
            promotedTreeHash: fixture.promotedTreeHash,
            committedTreeHash: commit.body.committedTreeHash,
            treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          });
        }
        if (event.type === "GitPushed") {
          expect(event.payload).toMatchObject({
            baseTreeHash: fixture.baseTreeHash,
            candidateTreeHash: fixture.promotedTreeHash,
            promotedTreeHash: fixture.promotedTreeHash,
            committedTreeHash: commit.body.committedTreeHash,
            treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          });
        }
      }
    } finally {
      if (originalPathEnv === undefined) delete process.env.PATH;
      else process.env.PATH = originalPathEnv;
      if (originalRemoteEnv === undefined) delete process.env.FIXTURE_GIT_REMOTE;
      else process.env.FIXTURE_GIT_REMOTE = originalRemoteEnv;
      if (previousCryptoKey === undefined) delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousCryptoKey;
    }
  });

  it("records durable push recovery after an uncertain remote result and safely retries", async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    const remoteRoot = await mkdtemp(path.join(tmpdir(), "engineeringos-git-recovery-"));
    rootPaths.push(remoteRoot);
    const remotePath = path.join(remoteRoot, "remote.git");
    await git(remoteRoot, ["init", "--bare", "-q", remotePath]);
    await git(fixture.rootPath, ["branch", "-M", "main"]);

    const originalPath = process.env.PATH ?? "";
    const actualGitPath = (await execFileAsync("sh", ["-c", "command -v git"])).stdout.trim();
    const wrapperDir = await mkdtemp(path.join(tmpdir(), "engineeringos-git-recovery-wrapper-"));
    rootPaths.push(wrapperDir);
    const wrapperPath = path.join(wrapperDir, "git");
    const attemptMarker = path.join(wrapperDir, "push-attempted");
    await writeFile(wrapperPath, `#!${process.execPath}
const { existsSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const realGit = process.env.ENGINEERINGOS_TEST_REAL_GIT;
const remote = process.env.ENGINEERINGOS_TEST_PUSH_REMOTE;
const marker = process.env.ENGINEERINGOS_TEST_PUSH_ATTEMPT_MARKER;
const pushIndex = args.indexOf("push");
if (pushIndex >= 0 && args[pushIndex + 1]?.startsWith("https://x-access-token:")) {
  const result = spawnSync(realGit, ["-C", args[1], "push", "file://" + remote, args[pushIndex + 2]], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!existsSync(marker)) {
    writeFileSync(marker, "remote side effect completed before local acknowledgement");
    process.stderr.write("simulated lost push acknowledgement\\n");
    process.exit(1);
  }
  process.exit(0);
}
const result = spawnSync(realGit, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`, "utf8");
    await chmod(wrapperPath, 0o755);

    const now = new Date();
    await db.update(projectsTable)
      .set({
        gitRemoteUrl: FIXTURE_REMOTE,
        gitDefaultBranch: "main",
      })
      .where(eq(projectsTable.id, fixture.projectId));
    await db.update(eventsTable)
      .set({
        correlationId: operationId,
        payload: {
          proposalId: fixture.proposalId,
          operationId,
          applyStatus: "APPLIED",
          appliedFiles: ["verified.ts"],
          baseTreeHash: fixture.baseTreeHash,
          candidateTreeHash: fixture.promotedTreeHash,
          promotedTreeHash: fixture.promotedTreeHash,
          changeSetHash: fixture.changeSetHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        },
      })
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "AiChangesApplied"),
      ));
    await db.update(aiChangeProposalsTable)
      .set({ operationId })
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    const previousCryptoKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
    const credentialId = randomUUID();
    const encryptedApiKey = encryptApiKey("fixture-token");
    await db.insert(aiProviderCredentialsTable).values({
      id: credentialId,
      ownerId: "test-user",
      provider: "github",
      encryptedApiKey,
      last4: "oken",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [aiProviderCredentialsTable.ownerId, aiProviderCredentialsTable.provider],
      set: {
        encryptedApiKey,
        last4: "oken",
        updatedAt: now,
      },
    });
    const [credential] = await db
      .select({ id: aiProviderCredentialsTable.id })
      .from(aiProviderCredentialsTable)
      .where(and(
        eq(aiProviderCredentialsTable.ownerId, "test-user"),
        eq(aiProviderCredentialsTable.provider, "github"),
      ))
      .limit(1);
    if (credential) credentialIds.push(credential.id);

    const originalRealGit = process.env.ENGINEERINGOS_TEST_REAL_GIT;
    const originalRemote = process.env.ENGINEERINGOS_TEST_PUSH_REMOTE;
    const originalMarker = process.env.ENGINEERINGOS_TEST_PUSH_ATTEMPT_MARKER;
    process.env.PATH = `${wrapperDir}:${originalPath}`;
    process.env.ENGINEERINGOS_TEST_REAL_GIT = actualGitPath;
    process.env.ENGINEERINGOS_TEST_PUSH_REMOTE = remotePath;
    process.env.ENGINEERINGOS_TEST_PUSH_ATTEMPT_MARKER = attemptMarker;
    try {
      await writeFile(path.join(fixture.rootPath, "verified.ts"), "export const verified = true;\n");

      const commit = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/commit`)
        .send({
          message: "Apply verified AI changes",
          proposalId: fixture.proposalId,
          operationId,
        });
      expect(commit.status).toBe(200);

      const uncertainPush = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId });
      expect(uncertainPush.status).toBe(409);
      expect(uncertainPush.body).toMatchObject({
        code: "GIT_PUSH_RECOVERY_REQUIRED",
        recoveryState: "REQUIRED",
        proposalId: fixture.proposalId,
        operationId,
        commitHash: commit.body.commitHash,
      });

      const recoveryEvents = await db
        .select({ type: eventsTable.type, correlationId: eventsTable.correlationId, payload: eventsTable.payload })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, fixture.projectId),
          eq(eventsTable.type, "GitPushRecoveryRequired"),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(recoveryEvents).toHaveLength(1);
      expect(recoveryEvents[0]?.payload).toMatchObject({
        proposalId: fixture.proposalId,
        operationId,
        branch: "main",
        remoteUrl: FIXTURE_REMOTE,
        commitHash: commit.body.commitHash,
        recoveryState: "REQUIRED",
      });

      const retry = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId });
      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({
        ok: true,
        correlationId: operationId,
        commitHash: commit.body.commitHash,
      });

      const duplicateRetry = await request(app)
        .post(`/api/projects/${fixture.projectId}/git/push`)
        .send({ proposalId: fixture.proposalId, operationId });
      expect(duplicateRetry.status).toBe(200);
      expect(duplicateRetry.body).toMatchObject({
        ok: true,
        idempotent: true,
        correlationId: operationId,
        commitHash: commit.body.commitHash,
      });

      const traceEvents = await db
        .select({ type: eventsTable.type, payload: eventsTable.payload })
        .from(eventsTable)
        .where(and(
          eq(eventsTable.projectId, fixture.projectId),
          eq(eventsTable.correlationId, operationId),
        ));
      expect(traceEvents.filter((event) => event.type === "GitPushRecoveryRequired")).toHaveLength(1);
      expect(traceEvents.filter((event) => event.type === "GitPushed")).toHaveLength(1);
      expect(traceEvents.find((event) => event.type === "GitPushed")?.payload).toMatchObject({
        proposalId: fixture.proposalId,
        operationId,
        commitHash: commit.body.commitHash,
      });

      const { stdout: remoteHead } = await execFileAsync(actualGitPath, [
        "--git-dir", remotePath, "rev-parse", "main",
      ]);
      expect(remoteHead.trim()).toBe(commit.body.commitHash);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalRealGit === undefined) delete process.env.ENGINEERINGOS_TEST_REAL_GIT;
      else process.env.ENGINEERINGOS_TEST_REAL_GIT = originalRealGit;
      if (originalRemote === undefined) delete process.env.ENGINEERINGOS_TEST_PUSH_REMOTE;
      else process.env.ENGINEERINGOS_TEST_PUSH_REMOTE = originalRemote;
      if (originalMarker === undefined) delete process.env.ENGINEERINGOS_TEST_PUSH_ATTEMPT_MARKER;
      else process.env.ENGINEERINGOS_TEST_PUSH_ATTEMPT_MARKER = originalMarker;
      if (previousCryptoKey === undefined) delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousCryptoKey;
    }
  });
});