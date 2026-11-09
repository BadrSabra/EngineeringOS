import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, afterEach, beforeEach, it, vi } from "vitest";
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

import app from "../app.js";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiProviderCredentialsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import {
  getGitHubBranchState,
  pushLocalCommitToGitHub,
} from "../lib/github-connector.js";
import { encryptApiKey } from "../lib/credentials-crypto.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "../lib/delivery-workspace.js";

const execFileAsync = promisify(execFile);
const pushed = vi.mocked(pushLocalCommitToGitHub);
const branchState = vi.mocked(getGitHubBranchState);
const projectIds: string[] = [];
const projectRoots: string[] = [];
const fixtureCredentialId = randomUUID();
let priorGitHubCredential: typeof aiProviderCredentialsTable.$inferSelect | undefined;
let priorCredentialsEncryptionKey: string | undefined;

async function installGitHubCredentialFixture() {
  priorCredentialsEncryptionKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
  [priorGitHubCredential] = await db.select().from(aiProviderCredentialsTable).where(and(
    eq(aiProviderCredentialsTable.ownerId, "test-user"),
    eq(aiProviderCredentialsTable.provider, "github"),
  ));
  await db.delete(aiProviderCredentialsTable).where(and(
    eq(aiProviderCredentialsTable.ownerId, "test-user"),
    eq(aiProviderCredentialsTable.provider, "github"),
  ));
  await db.insert(aiProviderCredentialsTable).values({
    id: fixtureCredentialId,
    ownerId: "test-user",
    provider: "github",
    encryptedApiKey: encryptApiKey("fixture-github-token"),
    last4: "oken",
  });
}

async function createDeliveryTestRoot(): Promise<string> {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const testRootsBase = path.join(workspaceRoot, ".test-roots");
  await mkdir(testRootsBase, { recursive: true });
  const [realWorkspaceRoot, realTestRootsBase] = await Promise.all([
    realpath(workspaceRoot),
    realpath(testRootsBase),
  ]);
  if (realTestRootsBase !== path.join(realWorkspaceRoot, ".test-roots")) {
    throw new Error("Recipe delivery fixture escaped the approved workspace test-root directory.");
  }
  const rootPath = await mkdtemp(path.join(realTestRootsBase, "recipe-delivery-"));
  const realRootPath = await realpath(rootPath);
  if (!realRootPath.startsWith(`${realTestRootsBase}${path.sep}`)) {
    await rm(rootPath, { recursive: true, force: true });
    throw new Error("Recipe delivery fixture resolved outside the approved workspace test-root directory.");
  }
  projectRoots.push(realRootPath);
  return realRootPath;
}

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

async function createDeliveryFixture() {
  const projectId = randomUUID();
  const proposalId = randomUUID();
  const operationId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const rootPath = await createDeliveryTestRoot();
  await git(rootPath, ["init", "-q", "--initial-branch=main"]);
  await writeFile(path.join(rootPath, "README.md"), "Recipe delivery fixture.\n", "utf8");
  await git(rootPath, ["add", "README.md"]);
  await git(rootPath, [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
    "commit", "-qm", "Create isolated delivery fixture",
  ]);
  const baseTreeHash = await hashDeliveryTree(rootPath);
  await writeFile(path.join(rootPath, "delivery.txt"), "Approved recipe delivery.\n", "utf8");
  await git(rootPath, ["add", "delivery.txt"]);
  await git(rootPath, [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
    "commit", "-qm", `EngineeringOS: main\n\nEngineeringOS-Operation: ${operationId}`,
  ]);
  const sourceRevision = new Date().toISOString();
  const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
  const parentHash = (await git(rootPath, ["rev-parse", `${commitHash}^`])).stdout.trim();
  const parentTreeHash = (await git(rootPath, ["rev-parse", `${parentHash}^{tree}`])).stdout.trim();
  const gitTreeHash = (await git(rootPath, ["rev-parse", `${commitHash}^{tree}`])).stdout.trim();
  const treeHash = await hashDeliveryTree(rootPath);
  const now = new Date();

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `recipe-delivery-${projectId.slice(0, 8)}`,
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
    title: "Recipe delivery test",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Approved delivery",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: JSON.stringify([{ path: "delivery.txt", newContent: "Approved recipe delivery.\n" }]),
    appliedChanges: JSON.stringify([{ path: "delivery.txt", newContent: "Approved recipe delivery.\n" }]),
    status: "applied",
    lifecycle: "committed",
    operationId,
    baseRevision: sourceRevision,
    changeSetHash: "recipe-delivery-change-set",
    baseTreeHash,
    candidateTreeHash: treeHash,
    promotedTreeHash: treeHash,
    treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    commitHash,
    committedTreeHash: treeHash,
    createdAt: now,
    consumedAt: now,
  });
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "GitCommitCreated",
    projectId,
    severity: "info",
    message: "Approved recipe delivery commit",
    correlationId: operationId,
    payload: {
      proposalId,
      operationId,
      commitHash,
      committedTreeHash: treeHash,
      committedPaths: ["delivery.txt"],
    },
  });

  projectIds.push(projectId);
  return {
    projectId,
    proposalId,
    operationId,
    sourceRevision,
    commitHash,
    parentHash,
    parentTreeHash,
    gitTreeHash,
  };
}

function mockSuccessfulRemoteState(fixture: Awaited<ReturnType<typeof createDeliveryFixture>>) {
  branchState
    .mockResolvedValueOnce({
      commitHash: fixture.parentHash,
      treeHash: fixture.parentTreeHash,
      message: "Create isolated delivery fixture",
      parentHashes: [],
    })
    .mockResolvedValue({
      commitHash: fixture.commitHash,
      treeHash: fixture.gitTreeHash,
      message: `EngineeringOS: main\n\nEngineeringOS-Operation: ${fixture.operationId}`,
      parentHashes: [fixture.parentHash],
    });
}

afterEach(async () => {
  await db.delete(aiProviderCredentialsTable)
    .where(eq(aiProviderCredentialsTable.id, fixtureCredentialId))
    .catch(() => undefined);
  if (priorGitHubCredential) {
    await db.insert(aiProviderCredentialsTable).values(priorGitHubCredential).catch(() => undefined);
  }
  priorGitHubCredential = undefined;
  if (priorCredentialsEncryptionKey === undefined) {
    delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = priorCredentialsEncryptionKey;
  }
  priorCredentialsEncryptionKey = undefined;
  for (const projectId of projectIds.splice(0)) {
    await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.projectId, projectId)).catch(() => undefined);
    await db.delete(aiExecutionEvidenceSnapshotsTable).where(eq(aiExecutionEvidenceSnapshotsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.projectId, projectId)).catch(() => undefined);
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
  for (const root of projectRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("recipe API GitHub delivery", () => {
  beforeEach(async () => {
    pushed.mockReset();
    branchState.mockReset();
    await installGitHubCredentialFixture();
  });

  it("completes delivery through the API with a PROVEN durable acceptance", async () => {
    const fixture = await createDeliveryFixture();
    const idempotencyKey = `recipe-delivery-${fixture.operationId}`;
    pushed.mockResolvedValue({
      remoteCommitHash: fixture.commitHash,
      changedPaths: ["delivery.txt"],
    });
    mockSuccessfulRemoteState(fixture);

    const response = await request(app)
      .post(`/api/ai/projects/${fixture.projectId}/recipe`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        recipeId: "delivery.push.github",
        recipeVersion: 1,
        deliveryProposalId: fixture.proposalId,
        deliveryMessage: "Approved recipe delivery",
      });

  expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.status).toBe("completed");
    expect(response.body.receipt).toMatchObject({
      status: "completed",
      operationId: fixture.operationId,
      recipeId: "delivery.push.github",
      completedNodeIds: ["recipe:delivery.push.github:github-delivery"],
      evidenceRefs: [expect.stringContaining(`integration:${fixture.operationId}:`)],
    });
    expect(response.body.receipt.nodes).toEqual([
      expect.objectContaining({
        nodeId: "recipe:delivery.push.github:github-delivery",
        status: "passed",
        evidenceId: expect.stringContaining(`integration:${fixture.operationId}:`),
      }),
    ]);
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(branchState).toHaveBeenCalledTimes(2);
    expect(pushed.mock.calls[0]?.[0]).toMatchObject({
      commitHash: fixture.commitHash,
      branch: "main",
      message: expect.stringContaining(`EngineeringOS-Operation: ${fixture.operationId}`),
    });

    const [execution] = await db
      .select({
        id: aiExecutionsTable.id,
        status: aiExecutionsTable.status,
        checkpoint: aiExecutionsTable.checkpoint,
        recipeReceipt: aiExecutionsTable.recipeReceipt,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.projectId, fixture.projectId),
        eq(aiExecutionsTable.operationId, fixture.operationId),
      ))
      .limit(1);
    expect(execution).toMatchObject({
      status: "completed",
      recipeReceipt: expect.objectContaining({
        status: "completed",
        operationId: fixture.operationId,
      }),
    });
    expect(JSON.parse(execution!.checkpoint)).toMatchObject({
      stage: "completed",
      evidenceVerdict: "PROVEN",
    });

    const [acceptance] = await db
      .select({
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        outcome: aiExecutionAcceptancesTable.outcome,
        operationId: aiExecutionAcceptancesTable.operationId,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
      })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, execution!.id))
      .limit(1);
    expect(acceptance).toMatchObject({
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      operationId: fixture.operationId,
      evidenceComplete: 1,
    });
  });

  it("reuses the completed recipe receipt for the same idempotency key", async () => {
    const fixture = await createDeliveryFixture();
    const idempotencyKey = `recipe-replay-${fixture.operationId}`;
    pushed.mockResolvedValue({
      remoteCommitHash: fixture.commitHash,
      changedPaths: ["delivery.txt"],
    });
    mockSuccessfulRemoteState(fixture);
    const body = {
      recipeId: "delivery.push.github",
      recipeVersion: 1,
      deliveryProposalId: fixture.proposalId,
      deliveryMessage: "Approved recipe delivery",
    };

    const first = await request(app)
      .post(`/api/ai/projects/${fixture.projectId}/recipe`)
      .set("Idempotency-Key", idempotencyKey)
      .send(body);
    const replay = await request(app)
      .post(`/api/ai/projects/${fixture.projectId}/recipe`)
      .set("Idempotency-Key", idempotencyKey)
      .send(body);

    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({
      status: "completed",
      executionId: first.body.executionId,
      receipt: {
        status: "completed",
        operationId: fixture.operationId,
      },
    });
    expect(pushed).toHaveBeenCalledTimes(1);
  });
});