import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiStrategyReplayCaseRunsTable,
  db,
} from "@workspace/db";
import {
  createStrategyReplayCaseRunLease,
  STRATEGY_REPLAY_CASE_LEGACY_STALE_MS,
} from "./strategy-replay-case-lease.js";
import {
  createStrategyReplayCaseRunAttempt,
  claimStrategyReplayCaseRunLease,
  persistStrategyReplayCaseTerminalReceipt,
  renewStrategyReplayCaseRunLease,
  strategyReplayCaseRetryOperationId,
  type StrategyReplayCaseTerminalReceiptFields,
} from "./strategy-replay-case-run-storage.js";

const enabled = process.env.STRATEGY_REPLAY_LEASE_TEST_DB === "1";
const expectedDatabase = "strategy_replay_lease_test";
const expectedAddress = "127.0.0.1";
const expectedPort = 55439;
const cleanupIds: string[] = [];

describe.skipIf(!enabled)("Strategy Replay run persistence against isolated PostgreSQL", () => {
  beforeAll(async () => {
    const identity = await db.execute(sql`
      SELECT current_database() AS database,
             host(inet_server_addr()) AS address,
             inet_server_port() AS port
    `);
    const server = identity.rows[0] as {
      database: string;
      address: string;
      port: number;
    } | undefined;
    if (
      server?.database !== expectedDatabase
      || server.address !== expectedAddress
      || Number(server.port) !== expectedPort
    ) {
      throw new Error(
        `Strategy Replay lease integration test refuses database=${server?.database ?? "unknown"}, `
        + `address=${server?.address ?? "unknown"}, port=${server?.port ?? "unknown"}.`,
      );
    }

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS public.ai_strategy_replay_case_runs (
        id text PRIMARY KEY,
        project_id text NOT NULL,
        case_registration_id text NOT NULL,
        attempt_number integer NOT NULL DEFAULT 1,
        candidate_id text NOT NULL,
        source_episode_id text NOT NULL,
        operation_id text NOT NULL,
        candidate_hash text NOT NULL,
        source_canonical_proof_hash text NOT NULL,
        status text NOT NULL,
        replay_execution_id text,
        replay_episode_id text,
        replay_attempt integer,
        replay_effect_bundle_id text,
        replay_canonical_proof_hash text,
        workspace_tree_hash text,
        receipt jsonb,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_strategy_replay_case_runs_case_attempt
      ON public.ai_strategy_replay_case_runs (case_registration_id, attempt_number)
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_strategy_replay_case_runs_operation
      ON public.ai_strategy_replay_case_runs (operation_id)
    `));
  });

  afterEach(async () => {
    for (const id of cleanupIds.splice(0)) {
      await db.delete(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.id, id));
    }
  });

  async function insertRun(input: {
    receipt: unknown;
    updatedAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    await db.insert(aiStrategyReplayCaseRunsTable).values({
      id,
      projectId: `test-project:${id}`,
      caseRegistrationId: `test-case:${id}`,
      attemptNumber: 1,
      candidateId: `test-candidate:${id}`,
      sourceEpisodeId: `test-episode:${id}`,
      operationId: `test-operation:${id}`,
      candidateHash: "a".repeat(64),
      sourceCanonicalProofHash: "b".repeat(64),
      status: "running",
      receipt: input.receipt as never,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    });
    cleanupIds.push(id);
    return id;
  }

  async function claim(runId: string, now: Date) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(aiStrategyReplayCaseRunsTable)
        .where(eq(aiStrategyReplayCaseRunsTable.id, runId))
        .for("update");
      if (!row) throw new Error("Strategy Replay lease test row is missing.");
      return claimStrategyReplayCaseRunLease(tx, row, now);
    });
  }

  async function readRun(runId: string) {
    const [row] = await db.select().from(aiStrategyReplayCaseRunsTable)
      .where(eq(aiStrategyReplayCaseRunsTable.id, runId));
    if (!row) throw new Error("Strategy Replay lease test row is missing.");
    return row;
  }

  const incompleteReceipt: StrategyReplayCaseTerminalReceiptFields = {
    status: "incomplete",
    replayExecutionId: null,
    replayEpisodeId: null,
    replayAttempt: null,
    replayEffectBundleId: null,
    replayCanonicalProofHash: null,
    workspaceTreeHash: null,
  };

  it("allows exactly one concurrent transaction to claim a stale legacy run", async () => {
    const now = new Date();
    const runId = await insertRun({
      receipt: null,
      updatedAt: new Date(now.getTime() - STRATEGY_REPLAY_CASE_LEGACY_STALE_MS - 1),
    });

    const claims = await Promise.all([claim(runId, now), claim(runId, now)]);
    expect(claims.filter((result) => result.decision === "reclaim")).toHaveLength(1);
    expect(claims.filter((result) => result.decision === "busy")).toHaveLength(1);

    const row = await readRun(runId);
    expect(row.status).toBe("running");
    expect(row.receipt).toMatchObject({ kind: "strategy_replay_case_run_lease" });
  });

  it("fences the expired owner from renewal and terminal writes after takeover", async () => {
    const now = new Date();
    const staleOwner = randomUUID();
    const runId = await insertRun({
      receipt: createStrategyReplayCaseRunLease({
        ownerToken: staleOwner,
        expiresAt: new Date(now.getTime() - 60_000),
      }),
      updatedAt: new Date(now.getTime() - 60_000),
    });

    const claimResult = await claim(runId, now);
    expect(claimResult.decision).toBe("reclaim");
    if (claimResult.decision !== "reclaim") throw new Error("Expected a reclaimed lease.");

    expect(await renewStrategyReplayCaseRunLease({
      runId,
      ownerToken: staleOwner,
      now: new Date(now.getTime() + 1),
    })).toBe(false);
    expect(await persistStrategyReplayCaseTerminalReceipt({
      runId,
      ownerToken: staleOwner,
      receipt: incompleteReceipt,
      now: new Date(now.getTime() + 1),
    })).toBe(false);

    expect(await renewStrategyReplayCaseRunLease({
      runId,
      ownerToken: claimResult.ownerToken,
      now: new Date(now.getTime() + 2),
    })).toBe(true);
    expect(await persistStrategyReplayCaseTerminalReceipt({
      runId,
      ownerToken: claimResult.ownerToken,
      receipt: incompleteReceipt,
      now: new Date(now.getTime() + 3),
    })).toBe(true);

    expect(await persistStrategyReplayCaseTerminalReceipt({
      runId,
      ownerToken: claimResult.ownerToken,
      receipt: { ...incompleteReceipt, replayExecutionId: "must-not-overwrite" },
      now: new Date(now.getTime() + 4),
    })).toBe(false);
    const row = await readRun(runId);
    expect(row.status).toBe("incomplete");
    expect(row.replayExecutionId).toBeNull();
  });

  it("does not reclaim a recently updated legacy run", async () => {
    const now = new Date();
    const runId = await insertRun({
      receipt: null,
      updatedAt: new Date(now.getTime() - 30_000),
    });

    expect((await claim(runId, now)).decision).toBe("busy");
    expect((await readRun(runId)).receipt).toBeNull();
  });

  it("appends an idempotent retry without changing the prior incomplete receipt", async () => {
    const identity = randomUUID();
    const now = new Date();
    const caseRegistrationId = `test-case:${identity}`;
    const projectId = `test-project:${identity}`;
    const candidateId = `test-candidate:${identity}`;
    const sourceEpisodeId = `test-episode:${identity}`;
    const priorReceipt = {
      schemaVersion: 1,
      runId: `legacy-run:${identity}`,
      operationId: `legacy-operation:${identity}`,
      status: "incomplete",
      incompleteReason: "runner_blocked",
    };
    const [priorRun] = await db.insert(aiStrategyReplayCaseRunsTable).values({
      id: `legacy-run:${identity}`,
      projectId,
      caseRegistrationId,
      attemptNumber: 1,
      candidateId,
      sourceEpisodeId,
      operationId: `legacy-operation:${identity}`,
      candidateHash: "a".repeat(64),
      sourceCanonicalProofHash: "b".repeat(64),
      status: "incomplete",
      receipt: priorReceipt,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: aiStrategyReplayCaseRunsTable.id });
    if (!priorRun) throw new Error("Could not create prior Strategy Replay attempt.");
    cleanupIds.push(priorRun.id);

    const retryRequestId = randomUUID();
    const retryInput = {
      projectId,
      caseRegistrationId,
      candidateId,
      sourceEpisodeId,
      candidateHash: "a".repeat(64),
      sourceCanonicalProofHash: "b".repeat(64),
      attemptNumber: 2,
      retryRequestId,
      now,
    };
    const retry = await db.transaction((tx) =>
      createStrategyReplayCaseRunAttempt(tx, retryInput),
    );
    expect(retry?.replayRun).toMatchObject({
      attemptNumber: 2,
      caseRegistrationId,
      status: "running",
      operationId: strategyReplayCaseRetryOperationId(caseRegistrationId, retryRequestId),
    });
    if (!retry) throw new Error("Could not create the new Strategy Replay attempt.");
    cleanupIds.push(retry.replayRun.id);

    const duplicateRetry = await db.transaction((tx) =>
      createStrategyReplayCaseRunAttempt(tx, retryInput),
    );
    expect(duplicateRetry).toBeUndefined();

    const attempts = await db.select().from(aiStrategyReplayCaseRunsTable)
      .where(eq(aiStrategyReplayCaseRunsTable.caseRegistrationId, caseRegistrationId));
    expect(attempts).toHaveLength(2);
    expect(attempts.find((attempt) => attempt.attemptNumber === 1)?.receipt).toEqual(priorReceipt);
    expect(attempts.find((attempt) => attempt.attemptNumber === 1)?.status).toBe("incomplete");
    expect(attempts.find((attempt) => attempt.attemptNumber === 2)?.id).not.toBe(priorRun.id);
  });
});