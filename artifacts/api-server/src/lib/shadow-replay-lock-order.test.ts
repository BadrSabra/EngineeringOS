import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { buildExecutionProofProjection } from "./execution-proof.js";
import { loadVerifiedShadowReplayProof } from "../routes/ai/chat.js";
import { wakeRuntimeTransitionMissionGoals } from "./mission-runtime.js";

const projectIds: string[] = [];

async function createLockFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const sourceGoalId = randomUUID();
  const targetGoalId = randomUUID();
  const replayExecutionId = randomUUID();
  const planRevision = "runtime-start-lock-order-plan";
  const sourceRevision = "a".repeat(40);
  const candidateTreeHash = "b".repeat(64);
  const operationId = `shadow-replay:${randomUUID()}`;
  const now = new Date();
  const transitionRequirement = {
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "target-step",
    from: "stopped",
    to: "running",
  };
  const plan = {
    hash: planRevision,
    transitionRequirements: [transitionRequirement],
  };

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `shadow-lock-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/shadow-lock-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Shadow lock-order fixture",
    intent: "Exercise row-lock ordering without running a replay",
    status: "waiting",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values([
    {
      id: sourceGoalId,
      missionId,
      projectId,
      title: "Runtime source",
      status: "completed",
      nextAction: { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 },
      successCriteria: { stepId: "runtime-start", planRevision: plan },
      outcomeContract: { planRevision: { hash: planRevision } },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: targetGoalId,
      missionId,
      projectId,
      title: "Runtime successor",
      status: "waiting_for_event",
      blockedReason: "runtime_transition_pending",
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      successCriteria: {
        stepId: "target-step",
        planRevision: plan,
        transitionRequirement,
      },
      outcomeContract: { planRevision: { hash: planRevision } },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(aiExecutionsTable).values({
    id: replayExecutionId,
    projectId,
    goalId: sourceGoalId,
    operationId,
    userId: "test-user",
    idempotencyKey: `shadow-lock:${replayExecutionId}`,
    resumeTokenHash: "test-hash",
    request: "{}",
    checkpoint: "{}",
    status: "completed",
    attempt: 0,
    baseRevision: sourceRevision,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);
  return {
    projectId,
    missionId,
    sourceGoalId,
    replayExecutionId,
    operationId,
    sourceRevision,
    candidateTreeHash,
  };
}

async function addCurrentCanonicalAcceptance(fixture: Awaited<ReturnType<typeof createLockFixture>>) {
  const evidenceSnapshotId = randomUUID();
  const acceptanceId = randomUUID();
  const now = new Date();
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision: fixture.sourceRevision,
    candidateIdentity: fixture.candidateTreeHash,
  });

  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId: fixture.replayExecutionId,
    projectId: fixture.projectId,
    attempt: 0,
    operationId: fixture.operationId,
    sourceRevision: fixture.sourceRevision,
    candidateIdentity: fixture.candidateTreeHash,
    verdict: "PROVEN",
    complete: 1,
    readCount: 1,
    totalBytes: 64,
    createdAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId: fixture.replayExecutionId,
    projectId: fixture.projectId,
    attempt: 0,
    finalizationKey: `final:${fixture.replayExecutionId}:${acceptanceId}`,
    operationId: fixture.operationId,
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "NONE",
    disposition: { proof },
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    resumable: 0,
    sourceRevision: fixture.sourceRevision,
    candidateIdentity: fixture.candidateTreeHash,
    createdAt: now,
  });
  return { acceptanceId, evidenceSnapshotId };
}

async function waitForGoalLockWaiters(count: number): Promise<Array<{
  pid: number;
  query: string | null;
  blockers: number[];
}>> {
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
    const goalWaiters = rows.filter((row) => /ai_goals/i.test(row.query ?? ""));
    if (goalWaiters.length >= count) return goalWaiters;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${count} Goal row-lock waiters.`);
}

async function waitForMissionLockWaiters(count: number): Promise<Array<{
  pid: number;
  query: string | null;
  blockers: number[];
}>> {
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
    const missionWaiters = rows.filter((row) => /ai_missions/i.test(row.query ?? ""));
    if (missionWaiters.length >= count) return missionWaiters;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${count} Mission row-lock waiters.`);
}

function errorChain(value: unknown): Array<{ code: string | null; message: string }> {
  const chain: Array<{ code: string | null; message: string }> = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const error = current as { code?: unknown; message?: unknown; cause?: unknown };
    chain.push({
      code: typeof error.code === "string" ? error.code : null,
      message: typeof error.message === "string" ? error.message : String(current),
    });
    current = error.cause;
  }
  return chain;
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

it("serializes runtime transition proof reads before the replay execution lock without running a replay", async () => {
  const fixture = await createLockFixture();
  let releaseGoalLock!: () => void;
  let announceGoalLocked!: () => void;
  const goalLocked = new Promise<void>((resolve) => {
    announceGoalLocked = resolve;
  });
  const goalLockRelease = new Promise<void>((resolve) => {
    releaseGoalLock = resolve;
  });
  const blocker = db.transaction(async (tx) => {
    await tx.select({ id: aiGoalsTable.id })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.sourceGoalId))
      .for("update");
    announceGoalLocked();
    await goalLockRelease;
  });
  await goalLocked;

  const runtimeGate = wakeRuntimeTransitionMissionGoals();
  const runtimeGoalWaiters = await waitForGoalLockWaiters(1);
  const proofReload = loadVerifiedShadowReplayProof({
    executionId: fixture.replayExecutionId,
    projectId: fixture.projectId,
    operationId: fixture.operationId,
    attempt: 0,
    replayCanonicalAcceptanceId: randomUUID(),
    sourceRevision: fixture.sourceRevision,
    candidateTreeHash: fixture.candidateTreeHash,
  });
  const proofMissionWaiters = await waitForMissionLockWaiters(1);
  releaseGoalLock();

  const outcomes = await Promise.allSettled([blocker, runtimeGate, proofReload]);
  const deadlocks = outcomes.filter((outcome) =>
    outcome.status === "rejected"
    && errorChain(outcome.reason).some((error) => error.code === "40P01"),
  );
  const outcomeLabels = outcomes.map((outcome) => {
    if (outcome.status === "fulfilled") return "fulfilled";
    return `rejected:${JSON.stringify(errorChain(outcome.reason))}`;
  });
  expect(
    deadlocks,
    JSON.stringify({ runtimeGoalWaiters, proofMissionWaiters, outcomeLabels }),
  ).toHaveLength(0);
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    "fulfilled",
    "fulfilled",
    "fulfilled",
  ]);
});

it("reloads the matching current Canonical Proof after taking locks in Mission/Goal/execution order", async () => {
  const fixture = await createLockFixture();
  const acceptance = await addCurrentCanonicalAcceptance(fixture);

  const proof = await loadVerifiedShadowReplayProof({
    executionId: fixture.replayExecutionId,
    projectId: fixture.projectId,
    operationId: fixture.operationId,
    attempt: 0,
    replayCanonicalAcceptanceId: acceptance.acceptanceId,
    sourceRevision: fixture.sourceRevision,
    candidateTreeHash: fixture.candidateTreeHash,
  });

  expect(proof).toMatchObject({
    accepted: true,
    verdict: "PROVEN",
    executionId: fixture.replayExecutionId,
    acceptanceId: acceptance.acceptanceId,
    evidenceSnapshotId: acceptance.evidenceSnapshotId,
    attempt: 0,
    operationId: fixture.operationId,
    sourceRevision: fixture.sourceRevision,
    candidateIdentity: fixture.candidateTreeHash,
  });
  expect(proof?.trajectoryDigest?.digest).toMatch(/^[a-f0-9]{64}$/i);
});

it.each(["acceptance ID", "attempt", "source revision", "candidate identity"])(
  "rejects a stale %s after acquiring the ordered locks",
  async (staleBinding) => {
    const fixture = await createLockFixture();
    const acceptance = await addCurrentCanonicalAcceptance(fixture);
    const replay = {
      executionId: fixture.replayExecutionId,
      projectId: fixture.projectId,
      operationId: fixture.operationId,
      attempt: 0,
      replayCanonicalAcceptanceId: acceptance.acceptanceId,
      sourceRevision: fixture.sourceRevision,
      candidateTreeHash: fixture.candidateTreeHash,
    };

    if (staleBinding === "acceptance ID") replay.replayCanonicalAcceptanceId = randomUUID();
    if (staleBinding === "attempt") replay.attempt = 1;
    if (staleBinding === "source revision") replay.sourceRevision = "c".repeat(40);
    if (staleBinding === "candidate identity") replay.candidateTreeHash = "d".repeat(64);

    await expect(loadVerifiedShadowReplayProof(replay)).resolves.toBeUndefined();
  },
);
