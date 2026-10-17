import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it } from "vitest";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiShadowReplaysTable,
  db,
  projectsTable,
} from "@workspace/db";
import { finalizeExecutionAcceptance } from "./ai-execution-acceptance.js";
import { expectedShadowReplayOperationId } from "./shadow-replay.js";
import { validateSkillRegistryAuthority } from "./skill-registry-authorization.js";
import { lockSkillRegistryExecutionsThenProposal } from "./skill-registry-lock-order.js";

const projectIds: string[] = [];

async function createFixture() {
  assertDisposablePostgresUrl();
  const projectId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const replayId = randomUUID();
  const acceptanceId = randomUUID();
  const candidateExecutionId = `a-${randomUUID()}`;
  const replayExecutionId = `b-${randomUUID()}`;
  const sourceRevision = `base-${projectId}`;
  const candidateTreeHash = "a".repeat(64);
  const changeSetHash = "b".repeat(64);
  const trajectoryDigest = "c".repeat(64);
  const workspaceRoot = `/tmp/skill-lock-order-${projectId}`;
  const candidateId = `skill-candidate:${proposalId}:${candidateTreeHash}`;
  const candidateOperationId = `candidate-operation:${proposalId}`;
  const replayOperationId = expectedShadowReplayOperationId(proposalId, candidateId);
  const replayIdempotencyKey = `skill-lock-order-replay:${replayId}`;
  const replayAcceptanceId = `replay-acceptance:${replayId}`;
  const now = new Date();
  const skillCandidate = {
    contractVersion: 1,
    candidateId,
    projectId,
    sourceRevision,
    candidateTreeHash,
    changeSetHash,
    approvedPaths: ["src/lock-order-fixture.ts"],
    verification: { recipeId: "candidate.verify", recipeVersion: 1 },
    proof: {
      receiptId: acceptanceId,
      trajectoryDigest,
      verdict: "PROVEN",
      projection: {},
    },
    shadow: {
      mode: "shadow-replay",
      runId: replayId,
      isolated: true,
      productionExecution: false,
    },
  };
  const replayReceipt = {
    contractVersion: 2,
    runId: replayId,
    candidateId,
    projectId,
    sourceRevision,
    candidateTreeHash,
    operationId: replayOperationId,
    changeSetHash,
    proof: {
      receiptId: replayAcceptanceId,
      trajectoryDigest,
      verdict: "PROVEN",
    },
    productionExecution: false,
    replayId,
    replayExecutionId,
    status: "completed",
    attempt: 0,
    preTreeHash: candidateTreeHash,
    postTreeHash: candidateTreeHash,
    workspaceIsolated: true,
    workspaceCleaned: true,
    pairedBaseline: {},
  };

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `skill-lock-order-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/skill-lock-order-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Skill registry lock-order fixture",
    intent: "Test Gate 4 lock ordering.",
    scope: { kind: "project", projectId },
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Lock-order fixture goal",
  });
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "assistant",
    content: "Lock-order test fixture",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: "[]",
    operationId: candidateOperationId,
    workspaceRoot,
    baseRevision: sourceRevision,
    baseTreeHash: candidateTreeHash,
    candidateTreeHash,
    changeSetHash,
    validationEvidence: JSON.stringify({
      validationResults: [],
      skillCandidate,
    }),
    createdAt: now,
  });
  for (const [executionId, label] of [
    [candidateExecutionId, "candidate"],
    [replayExecutionId, "replay"],
  ] as const) {
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId,
      goalId,
      userId: "test-user",
      idempotencyKey: label === "replay"
        ? replayIdempotencyKey
        : `skill-lock-order:${label}:${executionId}`,
      operationId: label === "replay" ? replayOperationId : candidateOperationId,
      proposalId,
      resumeTokenHash: "test-hash",
      request: label === "replay"
        ? JSON.stringify({
            operationId: replayOperationId,
            executionProfile: "shadow-replay",
            workspaceRevision: sourceRevision,
            proofRequired: true,
            proofEvidenceMode: "artifact_only",
          })
        : JSON.stringify({
            projectId,
            sessionId,
            operationId: candidateOperationId,
            message: "Apply the approved candidate.",
            modelMessage: "Apply the approved candidate.",
            turnIntent: "APPLY_CHANGES",
            proofRequired: true,
            effectRequired: true,
            applyChangesProofMode: "apply_changes_v1",
            workspaceRoot,
            workspaceRevision: sourceRevision,
            validationTargetPaths: ["src/lock-order-fixture.ts"],
          }),
      correlationId: label === "candidate" ? candidateOperationId : null,
      workspaceRoot: label === "candidate" ? workspaceRoot : null,
      baseRevision: sourceRevision,
      status: "completed",
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId: candidateExecutionId,
    projectId,
    attempt: 0,
    finalizationKey: `skill-lock-order-acceptance:${acceptanceId}`,
    operationId: candidateOperationId,
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "completed",
    nextActionCode: "none",
    candidateIdentity: `${proposalId}:${candidateTreeHash}`,
    evidenceRequired: 1,
    evidenceComplete: 1,
  });
  await db.insert(aiShadowReplaysTable).values({
    id: replayId,
    executionId: replayExecutionId,
    projectId,
    proposalId,
    userId: "test-user",
    idempotencyKey: replayIdempotencyKey,
    operationId: replayOperationId,
    candidateId,
    canonicalAcceptanceId: acceptanceId,
    replayCanonicalAcceptanceId: replayAcceptanceId,
    trajectoryDigest,
    sourceRevision,
    candidateTreeHash,
    changeSetHash,
    sourceWorkspaceRoot: workspaceRoot,
    status: "completed",
    attempt: 0,
    receipt: replayReceipt,
  });
  projectIds.push(projectId);
  return {
    projectId,
    proposalId,
    replayId,
    candidateExecutionId,
    replayExecutionId,
  };
}

function assertDisposablePostgresUrl() {
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Skill registry lock-order tests require an explicit disposable DATABASE_URL.");
  }
  if (
    databaseUrl.protocol !== "postgresql:"
    || databaseUrl.hostname !== "127.0.0.1"
    || !databaseUrl.port
  ) {
    throw new Error("Skill registry lock-order tests may only write to a loopback PostgreSQL cluster.");
  }
}

async function waitForExecutionLockWaiter() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.pid, waiting.query, pg_blocking_pids(waiting.pid) AS blockers
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
    `);
    const rows = (result as unknown as {
      rows?: Array<{ pid: number; query: string | null; blockers: number[] }>;
    }).rows ?? [];
    const matching = rows.filter((row) => /ai_executions/i.test(row.query ?? ""));
    if (matching.length > 0) return matching;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for skill registry to lock a proof Execution.");
}

async function waitForProposalLockWaiter() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      SELECT waiting.pid, waiting.query, pg_blocking_pids(waiting.pid) AS blockers
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
    `);
    const rows = (result as unknown as {
      rows?: Array<{ pid: number; query: string | null; blockers: number[] }>;
    }).rows ?? [];
    const matching = rows.filter((row) => /ai_change_proposals/i.test(row.query ?? ""));
    if (matching.length > 0) return matching;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Apply finalization to lock its Proposal.");
}

function errorCodes(value: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; cause?: unknown };
    if (typeof error.code === "string") codes.push(error.code);
    current = error.cause;
  }
  return codes;
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

it("waits for proof Executions before taking the Proposal lock", async () => {
  const fixture = await createFixture();
  let announceExecutionLock!: () => void;
  let continueToProposalLock!: () => void;
  const executionLocked = new Promise<void>((resolve) => {
    announceExecutionLock = resolve;
  });
  const canLockProposal = new Promise<void>((resolve) => {
    continueToProposalLock = resolve;
  });
  const pending: Promise<unknown>[] = [];

  const finalizer = db.transaction(async (tx) => {
    await tx.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.candidateExecutionId))
      .for("update");
    announceExecutionLock();
    await canLockProposal;
    const [proposal] = await tx.select({ id: aiChangeProposalsTable.id })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId))
      .for("update");
    if (!proposal) throw new Error("Expected finalization to find its Proposal.");
  });
  pending.push(finalizer);

  try {
    await executionLocked;
    const gate = db.transaction((tx) =>
      lockSkillRegistryExecutionsThenProposal(tx, {
        projectId: fixture.projectId,
        executionIds: [fixture.replayExecutionId, fixture.candidateExecutionId],
        proposalId: fixture.proposalId,
      }),
    );
    pending.push(gate);
    const executionWaiters = await waitForExecutionLockWaiter();
    continueToProposalLock();

    const outcomes = await Promise.allSettled([finalizer, gate] as const);
    const deadlocks = outcomes.filter((outcome) =>
      outcome.status === "rejected" && errorCodes(outcome.reason).includes("40P01"),
    );
    expect(deadlocks, JSON.stringify({
      executionWaiters,
      outcomes: outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? "fulfilled" : errorCodes(outcome.reason),
      ),
    })).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    if (outcomes[1]?.status !== "fulfilled") {
      throw new Error("Expected ordered proof locks to complete after finalization.");
    }
    expect(outcomes[1].value.kind).toBe("locked");
    if (outcomes[1].value.kind === "locked") {
      expect(outcomes[1].value.executions.size).toBe(2);
      expect(outcomes[1].value.proposal.id).toBe(fixture.proposalId);
    }
  } finally {
    continueToProposalLock();
    await Promise.allSettled(pending);
  }
});

it("keeps real Gate 4 and Apply finalization paths in Execution-before-Proposal order", async () => {
  const fixture = await createFixture();
  let announceProposalLock!: () => void;
  let releaseProposalLock!: () => void;
  const proposalLocked = new Promise<void>((resolve) => {
    announceProposalLock = resolve;
  });
  const canReleaseProposal = new Promise<void>((resolve) => {
    releaseProposalLock = resolve;
  });
  const pending: Promise<unknown>[] = [];

  const proposalBlocker = db.transaction(async (tx) => {
    const [proposal] = await tx.select({ id: aiChangeProposalsTable.id })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId))
      .for("update");
    if (!proposal) throw new Error("Expected the test barrier to find its Proposal.");
    announceProposalLock();
    await canReleaseProposal;
  });
  pending.push(proposalBlocker);

  try {
    await proposalLocked;
    const finalizer = finalizeExecutionAcceptance({
      executionId: fixture.candidateExecutionId,
      expectedAttempt: 0,
      finalizationKey: `skill-lock-order-finalize:${fixture.candidateExecutionId}`,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "lock_order_test",
      recoveryState: "NONE",
      sourceRevision: `base-${fixture.projectId}`,
      workspaceRoot: `/tmp/skill-lock-order-${fixture.projectId}`,
      candidateIdentity: `${fixture.proposalId}:${"a".repeat(64)}`,
      effectBundleId: `missing-effect-bundle:${fixture.candidateExecutionId}`,
    });
    pending.push(finalizer);
    const proposalWaiters = await waitForProposalLockWaiter();

    const gate = db.transaction((tx) =>
      validateSkillRegistryAuthority(tx, {
        projectId: fixture.projectId,
        proposalId: fixture.proposalId,
        replayId: fixture.replayId,
      }),
    );
    pending.push(gate);
    const executionWaiters = await waitForExecutionLockWaiter();
    releaseProposalLock();

    const outcomes = await Promise.allSettled([proposalBlocker, finalizer, gate] as const);
    const deadlocks = outcomes.filter((outcome) =>
      outcome.status === "rejected" && errorCodes(outcome.reason).includes("40P01"),
    );
    expect(deadlocks, JSON.stringify({
      proposalWaiters,
      executionWaiters,
      outcomes: outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? "fulfilled" : errorCodes(outcome.reason),
      ),
    })).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    if (outcomes[1]?.status !== "fulfilled" || outcomes[2]?.status !== "fulfilled") {
      throw new Error("Expected both real paths to finish after releasing the test Proposal lock.");
    }
    expect(outcomes[1].value).toMatchObject({ accepted: false });
    expect(outcomes[1].value.reason).toContain("Apply proof evidence is missing");
    expect(outcomes[2].value).toMatchObject({ ok: false, reason: "proof" });
  } finally {
    releaseProposalLock();
    await Promise.allSettled(pending);
  }
});
