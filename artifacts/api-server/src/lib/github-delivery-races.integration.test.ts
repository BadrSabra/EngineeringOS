import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  eventsTable,
  pool,
  projectsTable,
} from "@workspace/db";
import { GitHubConnectorError } from "./github-connector.js";
import { executeVerifiedGitHubDelivery } from "./github-delivery-service.js";
import { reconcileStuckJobs } from "./job-reconciliation.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "./delivery-workspace.js";

const execFileAsync = promisify(execFile);
const RUN_RACES = process.env.RUN_E2_GITHUB_DELIVERY_RACES === "1";
const BARRIER_LOCK_NAMESPACE = 2_013_100_501;
const BARRIER_LOCK_ID = 2_013_100_502;

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

type DeliveryFixture = {
  projectId: string;
  sessionId: string;
  messageId: string;
  proposalId: string;
  operationId: string;
  rootPath: string;
  remoteUrl: string;
  branch: string;
  parentHash: string;
  parentTreeHash: string;
  commitHash: string;
  gitTreeHash: string;
  committedTreeHash: string;
  cleanup(): Promise<void>;
};

async function createFixture(): Promise<DeliveryFixture> {
  const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-gh-races-"));
  const fixture = {
    projectId: randomUUID(),
    sessionId: randomUUID(),
    messageId: randomUUID(),
    proposalId: randomUUID(),
    operationId: randomUUID(),
    rootPath,
    remoteUrl: "https://github.com/example/race-fixture.git",
    branch: "main",
    parentHash: "",
    parentTreeHash: "",
    commitHash: "",
    gitTreeHash: "",
    committedTreeHash: "",
  };
  try {
    await git(rootPath, ["init", "-q"]);
    await writeFile(path.join(rootPath, "README.md"), "before\n");
    await git(rootPath, ["add", "README.md"]);
    await git(rootPath, [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.com",
      "commit", "-qm", "initial",
    ]);
    fixture.parentHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    fixture.parentTreeHash = (await git(rootPath, [
      "rev-parse", `${fixture.parentHash}^{tree}`,
    ])).stdout.trim();
    const baseTreeHash = await hashDeliveryTree(rootPath);

    await writeFile(path.join(rootPath, "README.md"), "after\n");
    await git(rootPath, ["add", "README.md"]);
    await git(rootPath, [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.com",
      "commit", "-qm", "verified local delivery",
    ]);
    fixture.commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    fixture.gitTreeHash = (await git(rootPath, [
      "rev-parse", `${fixture.commitHash}^{tree}`,
    ])).stdout.trim();
    fixture.committedTreeHash = await hashDeliveryTree(rootPath);

    const now = new Date();
    await db.insert(projectsTable).values({
      id: fixture.projectId,
      ownerId: "e2-github-delivery-races",
      name: `github-races-${fixture.projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      gitRemoteUrl: fixture.remoteUrl,
      gitDefaultBranch: fixture.branch,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: fixture.sessionId,
      projectId: fixture.projectId,
      title: "E2 GitHub delivery race test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: fixture.messageId,
      sessionId: fixture.sessionId,
      role: "assistant",
      content: "Verified delivery candidate",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: fixture.proposalId,
      projectId: fixture.projectId,
      sessionId: fixture.sessionId,
      messageId: fixture.messageId,
      changes: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
      appliedChanges: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
      status: "applied",
      lifecycle: "committed",
      operationId: fixture.operationId,
      baseRevision: "e2-race-fixture",
      changeSetHash: "e2-race-change-set",
      baseTreeHash,
      candidateTreeHash: fixture.committedTreeHash,
      promotedTreeHash: fixture.committedTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      commitHash: fixture.commitHash,
      committedTreeHash: fixture.committedTreeHash,
      createdAt: now,
      consumedAt: now,
    });
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "GitCommitCreated",
      projectId: fixture.projectId,
      severity: "info",
      message: "Verified local commit created for E2 race test",
      correlationId: fixture.operationId,
      payload: {
        proposalId: fixture.proposalId,
        operationId: fixture.operationId,
        commitHash: fixture.commitHash,
        committedTreeHash: fixture.committedTreeHash,
        committedPaths: ["README.md"],
      },
    });
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true });
    throw error;
  }

  return {
    ...fixture,
    async cleanup() {
      await db.delete(eventsTable).where(eq(eventsTable.projectId, fixture.projectId)).catch(() => undefined);
      await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, fixture.projectId)).catch(() => undefined);
      await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, fixture.sessionId)).catch(() => undefined);
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId)).catch(() => undefined);
      await db.delete(projectsTable).where(eq(projectsTable.id, fixture.projectId)).catch(() => undefined);
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}

function attemptPayload(fixture: DeliveryFixture) {
  return {
    proposalId: fixture.proposalId,
    operationId: fixture.operationId,
    branch: fixture.branch,
    remoteUrl: fixture.remoteUrl,
    commitHash: fixture.commitHash,
    expectedCommitHash: fixture.commitHash,
    expectedParentHash: fixture.parentHash,
    expectedTreeHash: fixture.gitTreeHash,
    remoteCommitHashBefore: fixture.parentHash,
    remoteTreeHashBefore: fixture.parentTreeHash,
    remoteParentCountBefore: 1,
    operationMarker: `EngineeringOS-Operation: ${fixture.operationId}`,
  };
}

async function seedAttempt(fixture: DeliveryFixture) {
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "GitPushAttemptStarted",
    projectId: fixture.projectId,
    severity: "info",
    message: "Verified GitHub delivery attempt recorded before remote mutation.",
    correlationId: fixture.operationId,
    payload: attemptPayload(fixture),
  });
}

function createFakeGitHub(fixture: DeliveryFixture, initiallyApplied = false) {
  const deliveryMessage = `Verified delivery\n\nEngineeringOS-Operation: ${fixture.operationId}`;
  let branchCommitHash = initiallyApplied ? fixture.commitHash : fixture.parentHash;
  let remoteMessage = initiallyApplied ? deliveryMessage : "initial";
  const calls = { blobCreates: 0, treeCreates: 0, commitCreates: 0, refUpdates: 0 };

  const request = async (
    requestPath: string,
    init: { method?: string; body?: string } = {},
  ): Promise<Record<string, unknown>> => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (method === "GET" && requestPath.endsWith(`/git/ref/heads/${fixture.branch}`)) {
      return { object: { sha: branchCommitHash } };
    }
    if (method === "GET" && requestPath.endsWith(`/git/commits/${fixture.parentHash}`)) {
      return {
        tree: { sha: fixture.parentTreeHash },
        message: "initial",
        parents: [],
      };
    }
    if (method === "GET" && requestPath.endsWith(`/git/commits/${fixture.commitHash}`)) {
      return {
        tree: { sha: fixture.gitTreeHash },
        message: remoteMessage,
        parents: [{ sha: fixture.parentHash }],
      };
    }
    if (method === "POST" && requestPath.endsWith("/git/blobs")) {
      calls.blobCreates++;
      return { sha: "fixture-blob" };
    }
    if (method === "POST" && requestPath.endsWith("/git/trees")) {
      calls.treeCreates++;
      return { sha: fixture.gitTreeHash };
    }
    if (method === "POST" && requestPath.endsWith("/git/commits")) {
      calls.commitCreates++;
      remoteMessage = String(body.message ?? deliveryMessage);
      return { sha: fixture.commitHash };
    }
    if (method === "PATCH" && requestPath.endsWith(`/git/refs/heads/${fixture.branch}`)) {
      calls.refUpdates++;
      if (branchCommitHash !== fixture.parentHash) {
        throw new GitHubConnectorError(
          "GitHub branch changed after the verified local commit.",
          "GITHUB_PUSH_REMOTE_DRIFT",
          409,
        );
      }
      branchCommitHash = String(body.sha ?? fixture.commitHash);
      return {};
    }
    throw new Error(`Unexpected fixture request: ${method} ${requestPath}`);
  };

  return {
    request,
    calls,
    get branchCommitHash() {
      return branchCommitHash;
    },
  };
}

function deliveryParams(fixture: DeliveryFixture, request: ReturnType<typeof createFakeGitHub>["request"]) {
  return {
    projectId: fixture.projectId,
    proposalId: fixture.proposalId,
    operationId: fixture.operationId,
    rootPath: fixture.rootPath,
    remoteUrl: fixture.remoteUrl,
    branch: fixture.branch,
    message: "Verified delivery",
    request,
  };
}

async function countEvents(fixture: DeliveryFixture, type: string): Promise<number> {
  const rows = await db.select({ id: eventsTable.id })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, fixture.projectId),
      eq(eventsTable.type, type),
      eq(eventsTable.correlationId, fixture.operationId),
    ));
  return rows.length;
}

async function insertDuplicateEvents(
  fixture: DeliveryFixture,
  type: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const results = await Promise.allSettled([0, 1].map(() => db.insert(eventsTable).values({
    id: randomUUID(),
    type,
    projectId: fixture.projectId,
    severity: "info",
    message: "E2 event uniqueness fixture",
    correlationId: fixture.operationId,
    payload,
  })));
  return results.filter((result) => result.status === "fulfilled").length;
}

async function installBlockingEventInsert(type: string) {
  await pool.query(`
    CREATE SEQUENCE e2_github_delivery_barrier_seq;
    CREATE FUNCTION e2_github_delivery_barrier() RETURNS trigger AS $$
    BEGIN
      IF NEW.type = '${type}' THEN
        PERFORM nextval('e2_github_delivery_barrier_seq');
        PERFORM pg_advisory_xact_lock(${BARRIER_LOCK_NAMESPACE}, ${BARRIER_LOCK_ID});
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER e2_github_delivery_barrier_trigger
      BEFORE INSERT ON events
      FOR EACH ROW EXECUTE FUNCTION e2_github_delivery_barrier();
  `);
  const client = await pool.connect();
  await client.query("SELECT pg_advisory_lock($1, $2)", [BARRIER_LOCK_NAMESPACE, BARRIER_LOCK_ID]);
  return {
    async entered(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await pool.query("SELECT last_value, is_called FROM e2_github_delivery_barrier_seq");
        if (result.rows[0]?.is_called && Number(result.rows[0].last_value) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for the ${type} insert barrier.`);
    },
    async release() {
      try {
        await client.query("SELECT pg_advisory_unlock($1, $2)", [BARRIER_LOCK_NAMESPACE, BARRIER_LOCK_ID]);
      } finally {
        client.release();
      }
    },
    async remove() {
      await pool.query(`
        DROP TRIGGER IF EXISTS e2_github_delivery_barrier_trigger ON events;
        DROP FUNCTION IF EXISTS e2_github_delivery_barrier();
        DROP SEQUENCE IF EXISTS e2_github_delivery_barrier_seq;
      `);
    },
  };
}

async function installReceiptFailure() {
  await pool.query(`
    CREATE FUNCTION e2_github_delivery_reject_receipt() RETURNS trigger AS $$
    BEGIN
      IF NEW.type = 'GitPushed' THEN
        RAISE EXCEPTION 'injected E2 receipt persistence failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER e2_github_delivery_reject_receipt_trigger
      BEFORE INSERT ON events
      FOR EACH ROW EXECUTE FUNCTION e2_github_delivery_reject_receipt();
  `);
}

async function removeReceiptFailure() {
  await pool.query(`
    DROP TRIGGER IF EXISTS e2_github_delivery_reject_receipt_trigger ON events;
    DROP FUNCTION IF EXISTS e2_github_delivery_reject_receipt();
  `);
}

describe("E2 verified GitHub delivery race and failure contracts", () => {
  it.runIf(RUN_RACES)(
    "enforces semantic operation uniqueness without constraining unrelated Git events",
    async () => {
      expect(new URL(process.env.DATABASE_URL ?? "").hostname).toBe("127.0.0.1");
      const fixture = await createFixture();
      try {
        const operationMarker = `EngineeringOS-Operation: ${fixture.operationId}`;
        expect(await insertDuplicateEvents(
          fixture,
          "GitPushAttemptStarted",
          attemptPayload(fixture),
        )).toBe(1);
        expect(await insertDuplicateEvents(fixture, "GitPushed", {
          proposalId: fixture.proposalId,
          operationId: fixture.operationId,
          commitHash: fixture.commitHash,
          remoteCommitHash: fixture.commitHash,
          operationMarker,
        })).toBe(1);
        expect(await insertDuplicateEvents(fixture, "GitPushRecoveryRequired", {
          proposalId: fixture.proposalId,
          operationId: fixture.operationId,
          commitHash: fixture.commitHash,
          recoveryState: "REQUIRED",
        })).toBe(1);
        expect(await insertDuplicateEvents(fixture, "GitPushed", {
          source: "manual-git-push",
        })).toBe(2);

        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
        expect(await countEvents(fixture, "GitPushed")).toBe(3);
        expect(await countEvents(fixture, "GitPushRecoveryRequired")).toBe(1);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.runIf(RUN_RACES)(
    "admits one initial delivery operation for concurrent requests with the same identity",
    async () => {
      expect(new URL(process.env.DATABASE_URL ?? "").hostname).toBe("127.0.0.1");
      const fixture = await createFixture();
      const barrier = await installBlockingEventInsert("GitPushAttemptStarted");
      try {
        const github = createFakeGitHub(fixture);
        const deliveries = [
          executeVerifiedGitHubDelivery(deliveryParams(fixture, github.request)),
          executeVerifiedGitHubDelivery(deliveryParams(fixture, github.request)),
        ];
        await barrier.entered();
        // Keep the first insert uncommitted long enough for a competing request
        // to perform its lookup and attempt the same insert.
        await new Promise((resolve) => setTimeout(resolve, 300));
        await barrier.release();
        const results = await Promise.all(deliveries);

        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
        expect(github.calls.commitCreates).toBe(1);
        expect(github.calls.refUpdates).toBe(1);
        expect(results.filter((result) => result.status === "passed")).toHaveLength(1);
        expect(results.filter((result) => result.status === "blocked")).toHaveLength(1);
      } finally {
        await barrier.release().catch(() => undefined);
        await barrier.remove().catch(() => undefined);
        await fixture.cleanup();
      }
    },
  );

  it.runIf(RUN_RACES)(
    "writes one receipt when concurrent verified retries observe the same completed remote commit",
    async () => {
      expect(new URL(process.env.DATABASE_URL ?? "").hostname).toBe("127.0.0.1");
      const fixture = await createFixture();
      try {
        await seedAttempt(fixture);
        const github = createFakeGitHub(fixture, true);
        let observedReads = 0;
        let releaseReads!: () => void;
        const bothReads = new Promise<void>((resolve) => {
          releaseReads = resolve;
        });
        const request = async (requestPath: string, init: { method?: string; body?: string } = {}) => {
          const response = await github.request(requestPath, init);
          if (
            (init.method ?? "GET") === "GET"
            && requestPath.endsWith(`/git/commits/${fixture.commitHash}`)
          ) {
            observedReads++;
            if (observedReads === 2) releaseReads();
            await bothReads;
          }
          return response;
        };

        const results = await Promise.all([
          executeVerifiedGitHubDelivery(deliveryParams(fixture, request)),
          executeVerifiedGitHubDelivery(deliveryParams(fixture, request)),
        ]);

        expect(results.map((result) => result.status)).toEqual(["passed", "passed"]);
        expect(await countEvents(fixture, "GitPushed")).toBe(1);
        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.runIf(RUN_RACES)(
    "serializes startup recovery with an exact retry and ends with one resolved recovery state",
    async () => {
      expect(new URL(process.env.DATABASE_URL ?? "").hostname).toBe("127.0.0.1");
      const fixture = await createFixture();
      const barrier = await installBlockingEventInsert("GitPushRecoveryRequired");
      try {
        await seedAttempt(fixture);
        const startup = reconcileStuckJobs();
        await barrier.entered();

        const github = createFakeGitHub(fixture, true);
        let remoteCommitRead!: () => void;
        const readComplete = new Promise<void>((resolve) => {
          remoteCommitRead = resolve;
        });
        const request = async (requestPath: string, init: { method?: string; body?: string } = {}) => {
          const response = await github.request(requestPath, init);
          if (
            (init.method ?? "GET") === "GET"
            && requestPath.endsWith(`/git/commits/${fixture.commitHash}`)
          ) {
            remoteCommitRead();
          }
          return response;
        };
        const retry = executeVerifiedGitHubDelivery(deliveryParams(fixture, request));
        await readComplete;
        await new Promise((resolve) => setTimeout(resolve, 50));
        await barrier.release();
        const [, retryResult] = await Promise.all([startup, retry]);

        expect(retryResult.status).toBe("passed");
        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
        expect(await countEvents(fixture, "GitPushed")).toBe(1);
        expect(await countEvents(fixture, "GitPushRecoveryRequired")).toBe(1);
        const [marker] = await db.select({ payload: eventsTable.payload })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.projectId, fixture.projectId),
            eq(eventsTable.type, "GitPushRecoveryRequired"),
            eq(eventsTable.correlationId, fixture.operationId),
          ));
        expect(marker?.payload).toMatchObject({
          recoveryState: "RESOLVED",
          resolvedByEventId: expect.any(String),
        });
      } finally {
        await barrier.release().catch(() => undefined);
        await barrier.remove().catch(() => undefined);
        await fixture.cleanup();
      }
    },
  );

  it.runIf(RUN_RACES)(
    "keeps a failed receipt transaction recoverable and completes exactly once after retry",
    async () => {
      expect(new URL(process.env.DATABASE_URL ?? "").hostname).toBe("127.0.0.1");
      const fixture = await createFixture();
      try {
        await installReceiptFailure();
        const github = createFakeGitHub(fixture);
        const failedFinalization = await executeVerifiedGitHubDelivery(
          deliveryParams(fixture, github.request),
        );
        expect(failedFinalization.status).toBe("unavailable");
        expect(github.branchCommitHash).toBe(fixture.commitHash);
        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
        expect(await countEvents(fixture, "GitPushed")).toBe(0);

        await removeReceiptFailure();
        await reconcileStuckJobs();
        expect(await countEvents(fixture, "GitPushRecoveryRequired")).toBe(1);

        const retry = await executeVerifiedGitHubDelivery(
          deliveryParams(fixture, github.request),
        );
        expect(retry.status).toBe("passed");
        expect(await countEvents(fixture, "GitPushAttemptStarted")).toBe(1);
        expect(await countEvents(fixture, "GitPushed")).toBe(1);
        expect(await countEvents(fixture, "GitPushRecoveryRequired")).toBe(1);
        const [marker] = await db.select({ payload: eventsTable.payload })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.projectId, fixture.projectId),
            eq(eventsTable.type, "GitPushRecoveryRequired"),
            eq(eventsTable.correlationId, fixture.operationId),
          ));
        expect(marker?.payload).toMatchObject({
          recoveryState: "RESOLVED",
          resolvedByEventId: expect.any(String),
        });
      } finally {
        await removeReceiptFailure().catch(() => undefined);
        await fixture.cleanup();
      }
    },
  );
});