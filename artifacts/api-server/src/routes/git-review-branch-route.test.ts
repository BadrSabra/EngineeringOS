import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app.js";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { captureCleanGitSourceCommitSha } from "../lib/delivery-workspace.js";

const execFileAsync = promisify(execFile);
const fixtures: Array<{
  projectId: string;
  workspaceRoot: string;
  repositoryRoot?: string;
  proposalId?: string;
}> = [];

async function git(rootPath: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", rootPath, ...args], {
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  return stdout;
}

async function createFixture(options: {
  originalContent?: string;
  ownerId?: string;
} = {}) {
  const trustedWorkspaceRoot = path.resolve(process.env.WORKSPACE_PATH ?? process.cwd());
  const testRoots = path.join(trustedWorkspaceRoot, ".local", "test-roots");
  await mkdir(testRoots, { recursive: true });
  const workspaceRoot = await mkdtemp(path.join(testRoots, "eos-review-route-"));
  const fixture: {
    projectId: string;
    workspaceRoot: string;
    repositoryRoot?: string;
    proposalId?: string;
  } = {
    projectId: randomUUID(),
    workspaceRoot,
  };
  fixtures.push(fixture);

  const repositoryRoot = path.join(workspaceRoot, "repository");
  fixture.repositoryRoot = repositoryRoot;
  const projectRoot = path.join(repositoryRoot, "packages", "app");
  await mkdir(projectRoot, { recursive: true });
  await git(repositoryRoot, "init", "--quiet");
  await git(repositoryRoot, "config", "user.name", "Review Route Test");
  await git(repositoryRoot, "config", "user.email", "review-route@example.invalid");
  const originalContent = options.originalContent ?? "export const value = 1;\n";
  await writeFile(path.join(projectRoot, "source.ts"), "export const value = 1;\n");
  await git(repositoryRoot, "add", "--", "packages/app/source.ts");
  await git(repositoryRoot, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "-m", "review source");
  const source = await captureCleanGitSourceCommitSha(projectRoot);
  if (!source) throw new Error("Fixture must begin at a clean committed source.");

  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  fixture.proposalId = proposalId;
  const operationId = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id: fixture.projectId,
    ownerId: options.ownerId ?? "test-user",
    name: `review-route-${fixture.projectId.slice(0, 8)}`,
    rootPath: projectRoot,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId: fixture.projectId,
    title: "Local review branch route test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Review proposal fixture",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId: fixture.projectId,
    sessionId,
    messageId,
    operationId,
    changes: JSON.stringify([{
      path: "source.ts",
      originalContent,
      newContent: "export const value = 2;\n",
    }]),
    status: "pending",
    lifecycle: "proposed",
    createdAt: now,
  });
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiPlanCreated",
    projectId: fixture.projectId,
    severity: "info",
    message: "Bound source fixture",
    correlationId: operationId,
    payload: {
      messageId,
      proposalId,
      sourceGitCommitSha: source.commitSha,
      sourceProjectRootRelativePath: source.projectRootRelativePath,
    },
  });

  return {
    ...fixture,
    repositoryRoot,
    projectRoot,
    sourceSha: source.commitSha,
    messageId,
    proposalId,
    operationId,
    originalContent: "export const value = 1;\n",
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    if (fixture.repositoryRoot) {
      const listed = await git(fixture.repositoryRoot, "worktree", "list", "--porcelain").catch(() => "");
      const worktreePaths = [...listed.matchAll(/^worktree (.+)$/gm)]
        .map((match) => match[1])
        .filter((worktreePath): worktreePath is string => Boolean(worktreePath))
        .filter((worktreePath) => worktreePath !== fixture.repositoryRoot);
      for (const worktreePath of worktreePaths) {
        const operationRoot = path.dirname(worktreePath);
        try {
          const manifest = JSON.parse(await readFile(path.join(operationRoot, "manifest.json"), "utf8")) as {
            projectId?: string;
            proposalId?: string;
            branchName?: string;
          };
          if (
            manifest.projectId !== fixture.projectId
            || manifest.proposalId !== fixture.proposalId
            || !manifest.proposalId
          ) continue;
          await git(fixture.repositoryRoot, "worktree", "remove", "--force", worktreePath).catch(() => "");
          if (manifest.branchName?.startsWith("eos/review/")) {
            await git(fixture.repositoryRoot, "branch", "-D", manifest.branchName).catch(() => "");
          }
          await rm(operationRoot, { recursive: true, force: true });
        } catch {
          // Only exact test-owned operation directories are removed.
        }
      }
    }
    await db.delete(eventsTable).where(eq(eventsTable.projectId, fixture.projectId)).catch(() => undefined);
    await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, fixture.projectId)).catch(() => undefined);
    const sessions = await db.select({ id: aiChatSessionsTable.id })
      .from(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId)).catch(() => []);
    for (const session of sessions) {
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, session.id)).catch(() => undefined);
    }
    await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId)).catch(() => undefined);
    await rm(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

describe("local review branch route", () => {
  it("creates an idempotent isolated branch from the recorded source without applying or proving it", async () => {
    const fixture = await createFixture();
    const reviewPath = `/api/projects/${fixture.projectId}/git/review-branch/${fixture.proposalId}`;
    const initialStatus = await request(app).get(reviewPath);
    expect(initialStatus.status).toBe(200);
    expect(initialStatus.body).toEqual({
      outcome: "REVIEW_BRANCH_NOT_CREATED",
      proposalId: fixture.proposalId,
    });
    const responses = await Promise.all([1, 2].map(() => request(app)
      .post(`/api/projects/${fixture.projectId}/git/review-branch`)
      .send({ proposalId: fixture.proposalId })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const first = responses.find((response) => response.status === 201)!;
    const replay = responses.find((response) => response.status === 200)!;

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      outcome: "REVIEW_BRANCH_READY",
      sourceGitCommitSha: fixture.sourceSha,
      localOnly: true,
      applied: false,
      committed: false,
      pushed: false,
      proofAccepted: false,
      idempotent: false,
    });
    expect(first.body.branchName).toMatch(/^eos\/review\/[a-f0-9]{32}$/);
    expect(first.body.worktreePath).toContain(path.join(".local", "engineeringos-review-worktrees"));
    expect((await git(fixture.repositoryRoot, "rev-parse", "HEAD")).trim()).toBe(fixture.sourceSha);
    await expect(readFile(path.join(fixture.projectRoot, "source.ts"), "utf8"))
      .resolves.toBe(fixture.originalContent);
    await expect(readFile(path.join(first.body.projectRootPath, "source.ts"), "utf8"))
      .resolves.toBe("export const value = 2;\n");

    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      branchName: first.body.branchName,
      worktreePath: first.body.worktreePath,
      idempotent: true,
      applied: false,
      committed: false,
      pushed: false,
      proofAccepted: false,
    });

    const restored = await request(app).get(reviewPath);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      outcome: "REVIEW_BRANCH_READY",
      proposalId: fixture.proposalId,
      branchName: first.body.branchName,
      worktreePath: first.body.worktreePath,
      sourceGitCommitSha: fixture.sourceSha,
      idempotent: true,
      applied: false,
      committed: false,
      pushed: false,
      proofAccepted: false,
    });
    const candidateSourcePath = path.join(first.body.projectRootPath, "source.ts");
    await writeFile(candidateSourcePath, "reviewer edit\n");
    const changedReview = await request(app).get(reviewPath);
    expect(changedReview.status).toBe(409);
    expect(changedReview.body.code).toBe("LOCAL_REVIEW_BRANCH_CHANGED");
    await expect(readFile(candidateSourcePath, "utf8")).resolves.toBe("reviewer edit\n");

    const receipts = await db.select({ payload: eventsTable.payload }).from(eventsTable).where(and(
      eq(eventsTable.projectId, fixture.projectId),
      eq(eventsTable.type, "GitReviewBranchCreated"),
      eq(eventsTable.correlationId, fixture.operationId),
    ));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload).toMatchObject({
      proposalId: fixture.proposalId,
      sourceGitCommitSha: fixture.sourceSha,
      localOnly: true,
      applied: false,
      committed: false,
      pushed: false,
    });
  });

  it("rejects stale proposal bytes before creating the worktree", async () => {
    const fixture = await createFixture({ originalContent: "stale bytes\n" });
    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/review-branch`)
      .send({ proposalId: fixture.proposalId });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("LOCAL_REVIEW_SOURCE_MISMATCH");
    expect((await git(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(/^worktree /gm))
      .toHaveLength(1);
    await expect(readFile(path.join(fixture.projectRoot, "source.ts"), "utf8"))
      .resolves.toBe(fixture.originalContent);
  });

  it("keeps project ownership checks ahead of filesystem work", async () => {
    const fixture = await createFixture({ ownerId: "not-test-user" });
    const response = await request(app)
      .post(`/api/projects/${fixture.projectId}/git/review-branch`)
      .send({ proposalId: fixture.proposalId });
    expect(response.status).toBe(403);
    expect((await git(fixture.repositoryRoot, "worktree", "list", "--porcelain")).match(/^worktree /gm))
      .toHaveLength(1);
  });
});
