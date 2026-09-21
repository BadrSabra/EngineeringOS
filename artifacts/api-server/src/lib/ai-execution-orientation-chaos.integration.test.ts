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
  persistAiExecutionOrientationManifest,
  recoverAiExecutionRetryToken,
  type AiOrientationRoleManifest,
} from "./ai-execution-state.js";
import { finalizeExecutionAcceptance } from "./ai-execution-acceptance.js";

type ChaosAction =
  | "recover-current"
  | "recover-stale-attempt"
  | "claim-invalid-token"
  | "persist-drifted-manifest"
  | "persist-from-stale-worker";

const CHAOS_SEEDS = [11, 29, 47, 83, 131] as const;

function seededShuffle<T>(seed: number, values: readonly T[]): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function orientationManifest(
  projectRevision: string,
  rootPath: string,
): AiOrientationRoleManifest {
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

describe("durable project-orientation retry chaos", () => {
  it.each(CHAOS_SEEDS)(
    "preserves one execution identity and manifest under seeded failure schedule %s",
    async (seed) => {
      const projectId = randomUUID();
      const executionId = randomUUID();
      const userId = `orientation-chaos-user-${seed}`;
      const now = new Date();
      const workspaceRevision = now.toISOString();
      const rootPath = `/tmp/orientation-chaos-${projectId}`;
      const manifest = orientationManifest(workspaceRevision, rootPath);
      const schedule = seededShuffle<ChaosAction>(seed, [
        "recover-current",
        "claim-invalid-token",
        "persist-from-stale-worker",
        "recover-stale-attempt",
        "persist-drifted-manifest",
        "recover-current",
      ]);
      const context = `seed=${seed}; schedule=${schedule.join(" -> ")}`;

      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `orientation-chaos-${seed}`,
        rootPath,
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
        userId,
        idempotencyKey: `${executionId}:orientation-chaos`,
        attempt: 0,
        resumeTokenHash: "pre-chaos-token-hash",
        request: JSON.stringify({
          projectId,
          turnIntent: "PROJECT_QUERY",
          projectOrientation: true,
          message: "Explain the project",
          modelMessage: "Explain the project",
          workspaceRevision,
          workspaceRoot: rootPath,
          validationTargetPaths: [],
          proofRequired: true,
          resumeContract: {
            taskType: "tool_chat",
            outputContract: "GENERIC_RESPONSE",
            contextProfile: "project",
            sessionId: randomUUID(),
            projectRevision: workspaceRevision,
            requiresEvidence: false,
            orientationManifest: manifest,
            scope: { projectId, rootPath, linkedTaskId: null },
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

      const issuedTokens: string[] = [];
      try {
        for (const action of schedule) {
          if (action === "recover-current") {
            const recovered = await recoverAiExecutionRetryToken({
              executionId,
              userId,
              expectedAttempt: 0,
            });
            expect(recovered?.execution.attempt, context).toBe(0);
            expect(recovered?.resumeToken, context).toEqual(expect.any(String));
            issuedTokens.push(recovered!.resumeToken);
          } else if (action === "recover-stale-attempt") {
            await expect(recoverAiExecutionRetryToken({
              executionId,
              userId,
              expectedAttempt: 9,
            }), context).resolves.toBeUndefined();
          } else if (action === "claim-invalid-token") {
            await expect(claimAiExecution({
              executionId,
              userId,
              workerId: `invalid-token-worker-${seed}`,
              resumeToken: `invalid-token-${seed}`,
            }), context).resolves.toBeUndefined();
          } else if (action === "persist-from-stale-worker") {
            await expect(persistAiExecutionOrientationManifest({
              executionId,
              workerId: `stale-worker-${seed}`,
              manifest,
            }), context).resolves.toBe(false);
          } else {
            await expect(persistAiExecutionOrientationManifest({
              executionId,
              workerId: `drift-worker-${seed}`,
              manifest: {
                ...manifest,
                projectRevision: `${workspaceRevision}-drift`,
              },
            }), context).resolves.toBe(false);
          }
        }

        expect(issuedTokens, context).toHaveLength(2);
        await expect(claimAiExecution({
          executionId,
          userId,
          workerId: `rotated-token-worker-${seed}`,
          resumeToken: issuedTokens[0],
        }), context).resolves.toBeUndefined();

        const activeWorker = `orientation-chaos-worker-${seed}`;
        const claimed = await claimAiExecution({
          executionId,
          userId,
          workerId: activeWorker,
          resumeToken: issuedTokens.at(-1),
        });
        expect(claimed, context).toMatchObject({
          id: executionId,
          operationId: executionId,
          status: "running",
          attempt: 1,
          workerId: activeWorker,
        });

        await expect(claimAiExecution({
          executionId,
          userId,
          workerId: `duplicate-worker-${seed}`,
          resumeToken: issuedTokens.at(-1),
        }), context).resolves.toBeUndefined();
        await expect(recoverAiExecutionRetryToken({
          executionId,
          userId,
          expectedAttempt: 1,
        }), context).resolves.toBeUndefined();
        await expect(persistAiExecutionOrientationManifest({
          executionId,
          workerId: activeWorker,
          manifest,
        }), context).resolves.toBe(true);
        await expect(persistAiExecutionOrientationManifest({
          executionId,
          workerId: activeWorker,
          manifest: {
            ...manifest,
            paths: { ...manifest.paths, uncertainty: [] },
          },
        }), context).resolves.toBe(false);

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: executionId,
          attempt: 1,
          status: "running",
          workerId: activeWorker,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(manifest);

        const terminalResults = await Promise.all([
          finalizeExecutionAcceptance({
            executionId,
            workerId: activeWorker,
            finalizationKey: `${executionId}:attempt:1:provider-failure`,
            outcome: "FAILED",
            terminalStatus: "failed",
            reasonCode: "EXECUTION_PROVIDER_FAILURE",
            recoveryState: "REQUIRED",
            retryable: true,
          }),
          finalizeExecutionAcceptance({
            executionId,
            workerId: activeWorker,
            finalizationKey: `${executionId}:attempt:1:disconnect`,
            outcome: "INTERRUPTED",
            terminalStatus: "cancelled",
            reasonCode: "EXECUTION_CLIENT_DISCONNECTED",
            recoveryState: "INCOMPLETE",
          }),
        ]);
        expect(
          terminalResults.map((result) => result.duplicate).sort(),
          context,
        ).toEqual([false, true]);
        expect(
          terminalResults.every((result) => result.accepted),
          context,
        ).toBe(true);

        const acceptances = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            outcome: aiExecutionAcceptancesTable.outcome,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId))
          .orderBy(aiExecutionAcceptancesTable.attempt);
        expect(acceptances, context).toHaveLength(2);
        expect(acceptances.map((item) => item.attempt), context).toEqual([0, 1]);

        const [terminalExecution] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(terminalExecution, context).toMatchObject({
          operationId: executionId,
          attempt: 1,
          status: acceptances[1]!.terminalStatus,
        });
        expect(
          JSON.parse(terminalExecution!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(manifest);
      } finally {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      }
    },
  );
});