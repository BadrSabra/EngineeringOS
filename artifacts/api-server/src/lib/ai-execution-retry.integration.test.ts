import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiChatSessionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  persistAiExecutionOrientationManifest,
  recoverAiExecutionRetryToken,
  type AiOrientationRoleManifest,
} from "./ai-execution-state.js";

function orientationManifest(projectRevision: string, rootPath: string): AiOrientationRoleManifest {
  return {
    projectRevision,
    rootPath,
    paths: {
      purpose: ["README.md"],
      components: ["src/App.tsx"],
      primaryFlow: ["src/routes.ts"],
      uncertainty: ["tests/app.test.ts"],
    },
  };
}

describe("durable conversational retry authorization", () => {
  it.each(["PROJECT_QUERY", "CHAT"] as const)(
    "rotates a retry token and creates a new auditable attempt for %s",
    async (turnIntent) => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();
    const workspaceRevision = now.toISOString();
      const manifest = turnIntent === "PROJECT_QUERY"
        ? orientationManifest(workspaceRevision, `/tmp/retry-${projectId}`)
        : undefined;

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
        turnIntent,
        sessionId: randomUUID(),
        message: "Explain the project flow",
        modelMessage: "Explain the project flow",
        workspaceRevision,
         ...(manifest ? { projectOrientation: true, workspaceRoot: manifest.rootPath } : {}),
        validationTargetPaths: [],
        ...(turnIntent === "PROJECT_QUERY"
          ? {
              proofRequired: true,
              resumeContract: {
                taskType: "BEHAVIOR_QUERY",
                outputContract: "BEHAVIOR_ANSWER",
                contextProfile: "project_query",
                sessionId: randomUUID(),
                projectRevision: workspaceRevision,
                requiresEvidence: true,
                 ...(manifest ? { orientationManifest: manifest } : {}),
                scope: { projectId, rootPath: null, linkedTaskId: null },
              },
            }
          : {}),
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
       if (manifest) {
         const [executionRow] = await db
           .select({ request: aiExecutionsTable.request })
           .from(aiExecutionsTable)
           .where(eq(aiExecutionsTable.id, executionId));
         expect(JSON.parse(executionRow!.request).resumeContract.orientationManifest).toEqual(manifest);
       }

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
    },
  );

  it("persists one verified orientation manifest and rejects drift, incomplete, or stale replacements", async () => {
    const projectId = randomUUID();
    const executionId = randomUUID();
    const sessionId = randomUUID();
    const workerId = "orientation-manifest-worker";
    const now = new Date();
    const workspaceRevision = now.toISOString();
    const rootPath = `/tmp/orientation-${projectId}`;
    const manifest = orientationManifest(workspaceRevision, rootPath);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "orientation-test-user",
      name: `orientation-${projectId.slice(0, 8)}`,
      rootPath,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Orientation test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId,
      operationId: executionId,
      userId: "orientation-test-user",
      idempotencyKey: `${executionId}:orientation`,
      attempt: 0,
      resumeTokenHash: "orientation-manifest-resume-hash",
      request: JSON.stringify({
        projectId,
        turnIntent: "PROJECT_QUERY",
        projectOrientation: true,
        sessionId,
        message: "Explain the project",
        modelMessage: "Explain the project",
        workspaceRevision,
        workspaceRoot: rootPath,
        validationTargetPaths: [],
        proofRequired: true,
        resumeContract: {
          taskType: "BEHAVIOR_QUERY",
          outputContract: "BEHAVIOR_ANSWER",
          contextProfile: "project_query",
          sessionId,
          projectRevision: workspaceRevision,
          requiresEvidence: true,
          scope: { projectId, rootPath, linkedTaskId: null },
        },
      }),
      checkpoint: "{}",
      status: "running",
      workerId,
      leaseUntil: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    try {
      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId: "stale-orientation-worker",
        manifest,
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          rootPath: `${rootPath}-drift`,
        },
      })).resolves.toBe(false);

      const [stored] = await db
        .select({ request: aiExecutionsTable.request })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, executionId));
      expect(JSON.parse(stored!.request).resumeContract.orientationManifest).toEqual(manifest);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(true);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          projectRevision: `${workspaceRevision}-drift`,
        },
      })).resolves.toBe(false);

      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest: {
          ...manifest,
          paths: { ...manifest.paths, uncertainty: [] },
        },
      })).resolves.toBe(false);

      await db
        .update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000) })
        .where(eq(aiExecutionsTable.id, executionId));
      await expect(persistAiExecutionOrientationManifest({
        executionId,
        workerId,
        manifest,
      })).resolves.toBe(false);
    } finally {
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.id, sessionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
  });
});