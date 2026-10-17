import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { loadOperationEvidence } from "./operation-evidence.js";

const projectIds: string[] = [];

async function createCanonicalProofFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const executionId = randomUUID();
  const acceptanceId = randomUUID();
  const evidenceSnapshotId = randomUUID();
  const planRevision = `plan:${randomUUID()}`;
  const sourceRevision = "a".repeat(40);
  const operationId = `operation:${executionId}`;
  const now = new Date();
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "operation-evidence-test",
    name: `operation-evidence-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/operation-evidence-${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "operation-evidence-test",
    title: "Operation evidence proof fixture",
    intent: "Verify current Goal proof projection",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    budget: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Current plan Goal",
    status: "completed",
    successCriteria: { planRevision: { hash: planRevision } },
    outcomeContract: {
      planRevision: { hash: planRevision },
      acceptance: { scope: { projectId, missionId, goalId, operationId } },
    },
    nextAction: {},
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId,
    operationId,
    userId: "operation-evidence-test",
    idempotencyKey: `execution:${executionId}`,
    resumeTokenHash: "test-resume-hash",
    request: JSON.stringify({ workspaceRevision: sourceRevision }),
    checkpoint: JSON.stringify({ stage: "completed" }),
    status: "completed",
    attempt: 0,
    baseRevision: sourceRevision,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision,
  });
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId,
    attempt: 0,
    operationId,
    sourceRevision,
    verdict: "PROVEN",
    complete: 1,
    readCount: 1,
    totalBytes: 64,
    createdAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId,
    projectId,
    attempt: 0,
    finalizationKey: `final:${executionId}:0`,
    operationId,
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "NONE",
    disposition: { proof },
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    resumable: 0,
    sourceRevision,
    createdAt: now,
  });
  const [execution] = await db.select()
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, executionId));
  if (!execution) throw new Error("The operation evidence execution fixture was not persisted.");

  return { execution, missionId, acceptanceId, operationId, sourceRevision };
}

beforeAll(() => {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl || new URL(rawDatabaseUrl).hostname !== "127.0.0.1") {
    throw new Error("Operation evidence integration requires a disposable loopback DATABASE_URL.");
  }
});

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.projectId, projectId));
    await db.delete(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.projectId, projectId));
    await db.delete(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, projectId));
    await db.delete(aiGoalsTable)
      .where(eq(aiGoalsTable.projectId, projectId));
    await db.delete(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId));
    await db.delete(projectsTable)
      .where(eq(projectsTable.id, projectId));
  }
});

describe("operation evidence canonical proof integration", () => {
  it("retains current Canonical Proof for a Goal on the active Mission plan", async () => {
    const fixture = await createCanonicalProofFixture();
    const projection = await loadOperationEvidence(fixture.execution);
    expect(projection).toMatchObject({
      verified: false,
      proof: {
        accepted: true,
        verdict: "PROVEN",
        executionId: fixture.execution.id,
        acceptanceId: fixture.acceptanceId,
        attempt: 0,
        operationId: fixture.operationId,
        sourceRevision: fixture.sourceRevision,
      },
    });
  });

  it("does not return proof for a captured plan after the Mission plan rotates", async () => {
    const fixture = await createCanonicalProofFixture();
    const originalTransaction = db.transaction.bind(db);
    let notifyTransactionStarted!: () => void;
    let releaseTransaction!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      notifyTransactionStarted = resolve;
    });
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let intercepted = false;
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      if (!intercepted) {
        intercepted = true;
        notifyTransactionStarted();
        await transactionGate;
      }
      return originalTransaction(callback, config);
    });

    try {
      const projectionPromise = loadOperationEvidence(fixture.execution);
      await transactionStarted;
      await db.update(aiMissionsTable)
        .set({ autonomyPolicy: { activePlanRevision: "rotated-plan" } })
        .where(eq(aiMissionsTable.id, fixture.missionId));
      releaseTransaction();

      const projection = await projectionPromise;
      expect(projection.proof.accepted).toBe(false);
      expect(projection.proof.failureReasons).toContain("plan_revision_mismatch");
      expect(projection.proofSpine.accepted).toBe(false);
      expect(projection.proofSpine.failureReasons).toContain("plan_revision_mismatch");
    } finally {
      releaseTransaction();
      transactionSpy.mockRestore();
    }
  });
});
