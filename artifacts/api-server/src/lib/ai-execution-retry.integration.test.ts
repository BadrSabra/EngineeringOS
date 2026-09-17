import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  recoverAiExecutionRetryToken,
} from "./ai-execution-state.js";

describe("durable conversational retry authorization", () => {
  it("rotates a retry token and creates a new auditable attempt on claim", async () => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();
    const workspaceRevision = now.toISOString();

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "retry-test-user",
      name: `retry-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/retry-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId: null,
      operationId: executionId,
      userId: "retry-test-user",
      idempotencyKey: `${executionId}:original`,
      attempt: 0,
      resumeTokenHash: "old-token-hash",
      request: JSON.stringify({
        projectId,
        turnIntent: "PROJECT_QUERY",
        sessionId: randomUUID(),
        message: "Explain the project flow",
        modelMessage: "Explain the project flow",
        workspaceRevision,
        validationTargetPaths: [],
        proofRequired: true,
        resumeContract: {
          taskType: "BEHAVIOR_QUERY",
          outputContract: "BEHAVIOR_ANSWER",
          contextProfile: "project_query",
          sessionId: randomUUID(),
          projectRevision: workspaceRevision,
          requiresEvidence: true,
          scope: { projectId, rootPath: null, linkedTaskId: null },
        },
      }),
      checkpoint: "{}",
      status: "failed",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: `${executionId}:attempt:0`,
      operationId: executionId,
      terminalStatus: "failed",
      outcome: "FAILED",
      reasonCode: "EXECUTION_PROVIDER_FAILURE",
      nextActionCode: "RETRY_AFTER_TIMEOUT",
      disposition: {
        reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
        outcome: "FAILED",
        recoveryState: "REQUIRED",
        nextActionCode: "RETRY_AFTER_TIMEOUT",
        operatorAction: "RETRY_AFTER_TIMEOUT",
        retryAt: "2020-01-01T00:00:00.000Z",
      },
      evidenceRequired: 1,
      evidenceComplete: 0,
      resumable: 0,
      sourceRevision: workspaceRevision,
      createdAt: now,
    });

    try {
      const recovered = await recoverAiExecutionRetryToken({
        executionId,
        userId: "retry-test-user",
        expectedAttempt: 0,
      });
      expect(recovered?.resumeToken).toEqual(expect.any(String));
      expect(recovered?.execution.attempt).toBe(0);

      const claimed = await claimAiExecution({
        executionId,
        userId: "retry-test-user",
        workerId: "retry-test-worker",
        resumeToken: recovered!.resumeToken,
      });
      expect(claimed).toMatchObject({
        id: executionId,
        status: "running",
        attempt: 1,
        workerId: "retry-test-worker",
      });

      const acceptances = await db
        .select({ attempt: aiExecutionAcceptancesTable.attempt })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      expect(acceptances).toEqual([{ attempt: 0 }]);
    } finally {
      await db.delete(aiExecutionAcceptancesTable).where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});