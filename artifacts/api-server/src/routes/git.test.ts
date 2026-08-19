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

const execFileAsync = promisify(execFile);
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
    changes: JSON.stringify([{
      path: "verified.ts",
      absolutePath: path.join(rootPath, "verified.ts"),
      newContent: "export const verified = true;\n",
      originalContent: null,
      reason: "Verified implementation change",
      validationProfile: "workspace-typecheck",
    }]),
    status: "applied",
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
    },
  });
  projectIds.push(projectId);
  return { projectId, proposalId, rootPath };
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
        gitRemoteUrl: "https://fixture.local/engineeringos.git",
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
        },
      })
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.type, "AiChangesApplied"),
      ));
    const credentialId = randomUUID();
    credentialIds.push(credentialId);
    await db.insert(aiProviderCredentialsTable).values({
      id: credentialId,
      ownerId: "test-user",
      provider: "github",
      encryptedApiKey: encryptApiKey("fixture-token"),
      last4: "oken",
      createdAt: now,
      updatedAt: now,
    });

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
      }
    } finally {
      if (originalPathEnv === undefined) delete process.env.PATH;
      else process.env.PATH = originalPathEnv;
      if (originalRemoteEnv === undefined) delete process.env.FIXTURE_GIT_REMOTE;
      else process.env.FIXTURE_GIT_REMOTE = originalRemoteEnv;
    }
  });
});