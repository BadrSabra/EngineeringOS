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
  checkpointAiExecution,
  parseAiExecutionCheckpoint,
  persistAiExecutionOrientationManifest,
  reconcileAiExecutions,
  recoverAiExecutionResumeToken,
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
const ELIGIBILITY_MUTATIONS = [
  "running-status",
  "wrong-next-action",
  "resumable-acceptance",
  "incomplete-recovery-state",
  "future-retry-time",
  "wrong-expected-attempt",
  "missing-resume-authority",
] as const;

type EligibilityMutation = typeof ELIGIBILITY_MUTATIONS[number];

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

function singleAndPairwiseMutations(): EligibilityMutation[][] {
  const scenarios = ELIGIBILITY_MUTATIONS.map((mutation) => [mutation]);
  for (let left = 0; left < ELIGIBILITY_MUTATIONS.length; left += 1) {
    for (let right = left + 1; right < ELIGIBILITY_MUTATIONS.length; right += 1) {
      scenarios.push([
        ELIGIBILITY_MUTATIONS[left]!,
        ELIGIBILITY_MUTATIONS[right]!,
      ]);
    }
  }
  return scenarios;
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

async function createFailedOrientationFixture(label: string) {
  const projectId = randomUUID();
  const executionId = randomUUID();
  const userId = `orientation-race-user-${label}`;
  const now = new Date();
  const workspaceRevision = now.toISOString();
  const rootPath = `/tmp/orientation-race-${projectId}`;
  const manifest = orientationManifest(workspaceRevision, rootPath);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: `orientation-race-${label}`,
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
    idempotencyKey: `${executionId}:race`,
    attempt: 0,
    resumeTokenHash: "pre-race-token-hash",
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

  return {
    projectId,
    executionId,
    userId,
    manifest,
    cleanup: async () => {
      await db.delete(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
      await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
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
            leaseUntil: aiExecutionsTable.leaseUntil,
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

  it.each([2, 5, 11] as const)(
    "linearizes %s concurrent token rotations and worker claims into one resumed attempt",
    async (concurrency) => {
      const projectId = randomUUID();
      const executionId = randomUUID();
      const userId = `orientation-linearizability-user-${concurrency}`;
      const now = new Date();
      const workspaceRevision = now.toISOString();
      const rootPath = `/tmp/orientation-linearizability-${projectId}`;
      const manifest = orientationManifest(workspaceRevision, rootPath);
      const context = `concurrency=${concurrency}; execution=${executionId}`;

      await db.insert(projectsTable).values({
        id: projectId,
        ownerId: userId,
        name: `orientation-linearizability-${concurrency}`,
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
        idempotencyKey: `${executionId}:linearizability`,
        attempt: 0,
        resumeTokenHash: "pre-race-token-hash",
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

      try {
        const recoveries = await Promise.all(
          Array.from({ length: concurrency }, () =>
            recoverAiExecutionRetryToken({
              executionId,
              userId,
              expectedAttempt: 0,
            })),
        );
        expect(recoveries.every(Boolean), context).toBe(true);
        const tokens = recoveries.map((recovery) => recovery!.resumeToken);
        expect(new Set(tokens).size, context).toBe(concurrency);
        expect(
          recoveries.every((recovery) => recovery!.execution.attempt === 0),
          context,
        ).toBe(true);

        const claims = await Promise.all(tokens.map((resumeToken, index) =>
          claimAiExecution({
            executionId,
            userId,
            workerId: `linearizability-worker-${concurrency}-${index}`,
            resumeToken,
          })));
        const winners = claims
          .map((claim, index) => ({ claim, index }))
          .filter((candidate): candidate is { claim: NonNullable<typeof candidate.claim>; index: number } =>
            candidate.claim !== undefined);
        expect(winners, context).toHaveLength(1);

        const winner = winners[0]!;
        const expectedWorker = `linearizability-worker-${concurrency}-${winner.index}`;
        expect(winner.claim, context).toMatchObject({
          id: executionId,
          operationId: executionId,
          status: "running",
          attempt: 1,
          workerId: expectedWorker,
        });

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: executionId,
          attempt: 1,
          status: "running",
          workerId: expectedWorker,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(manifest);

        await expect(recoverAiExecutionRetryToken({
          executionId,
          userId,
          expectedAttempt: 0,
        }), context).resolves.toBeUndefined();
        await expect(recoverAiExecutionRetryToken({
          executionId,
          userId,
          expectedAttempt: 1,
        }), context).resolves.toBeUndefined();
        await expect(persistAiExecutionOrientationManifest({
          executionId,
          workerId: expectedWorker,
          manifest,
        }), context).resolves.toBe(true);

        const acceptances = await db
          .select({ attempt: aiExecutionAcceptancesTable.attempt })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        expect(acceptances, context).toEqual([{ attempt: 0 }]);
      } finally {
        await db.delete(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
        await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      }
    },
  );

  it.each([19, 43, 71, 101] as const)(
    "linearizes token rotation against use of the previously valid token for race seed %s",
    async (seed) => {
      const fixture = await createFailedOrientationFixture(`rotation-${seed}`);
      const context = `rotation-vs-claim seed=${seed}; execution=${fixture.executionId}`;
      try {
        const initialRecovery = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        expect(initialRecovery?.resumeToken, context).toEqual(expect.any(String));

        const operations = [
          {
            kind: "rotate" as const,
            run: () => recoverAiExecutionRetryToken({
              executionId: fixture.executionId,
              userId: fixture.userId,
              expectedAttempt: 0,
            }),
          },
          {
            kind: "claim" as const,
            run: () => claimAiExecution({
              executionId: fixture.executionId,
              userId: fixture.userId,
              workerId: `old-token-worker-${seed}`,
              resumeToken: initialRecovery!.resumeToken,
            }),
          },
        ];
        const schedule = seed % 2 === 0 ? operations : [...operations].reverse();
        const outcomes = await Promise.all(schedule.map(async (operation) => ({
          kind: operation.kind,
          result: await operation.run(),
        })));
        const successfulOutcomes = outcomes.filter((outcome) => outcome.result !== undefined);
        expect(successfulOutcomes, context).toHaveLength(1);

        const rotationOutcome = outcomes.find((outcome) => outcome.kind === "rotate");
        const claimOutcome = outcomes.find((outcome) => outcome.kind === "claim");
        let expectedWorker: string;
        if (claimOutcome?.result) {
          expect(rotationOutcome?.result, context).toBeUndefined();
          expectedWorker = `old-token-worker-${seed}`;
        } else {
          expect(rotationOutcome?.result, context).toBeDefined();
          expectedWorker = `rotated-token-worker-${seed}`;
          const claimedAfterRotation = await claimAiExecution({
            executionId: fixture.executionId,
            userId: fixture.userId,
            workerId: expectedWorker,
            resumeToken: "resumeToken" in rotationOutcome!.result!
              ? rotationOutcome!.result.resumeToken
              : undefined,
          });
          expect(claimedAfterRotation, context).toMatchObject({
            attempt: 1,
            status: "running",
            workerId: expectedWorker,
          });
        }

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: fixture.executionId,
          attempt: 1,
          status: "running",
          workerId: expectedWorker,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);

        const acceptances = await db
          .select({ attempt: aiExecutionAcceptancesTable.attempt })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
        expect(acceptances, context).toEqual([{ attempt: 0 }]);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([3, 13, 31] as const)(
    "rejects a %s-attacker cross-tenant replay storm while the owner claims the same valid token",
    async (attackerCount) => {
      const fixture = await createFailedOrientationFixture(`tenant-${attackerCount}`);
      const context = `cross-tenant replay attackers=${attackerCount}; execution=${fixture.executionId}`;
      try {
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        expect(recovered?.resumeToken, context).toEqual(expect.any(String));

        const ownerWorker = `owner-worker-${attackerCount}`;
        const attempts = seededShuffle(attackerCount, [
          {
            owner: true,
            userId: fixture.userId,
            workerId: ownerWorker,
          },
          ...Array.from({ length: attackerCount }, (_, index) => ({
            owner: false,
            userId: `attacker-user-${attackerCount}-${index}`,
            workerId: `attacker-worker-${attackerCount}-${index}`,
          })),
        ]);
        const claims = await Promise.all(attempts.map(async (attempt) => ({
          ...attempt,
          result: await claimAiExecution({
            executionId: fixture.executionId,
            userId: attempt.userId,
            workerId: attempt.workerId,
            resumeToken: recovered!.resumeToken,
          }),
        })));
        const winners = claims.filter((claim) => claim.result !== undefined);
        expect(winners, context).toHaveLength(1);
        expect(winners[0], context).toMatchObject({
          owner: true,
          userId: fixture.userId,
          workerId: ownerWorker,
          result: {
            id: fixture.executionId,
            attempt: 1,
            status: "running",
            workerId: ownerWorker,
          },
        });
        expect(
          claims.filter((claim) => !claim.owner).every((claim) => claim.result === undefined),
          context,
        ).toBe(true);

        const [stored] = await db
          .select({
            userId: aiExecutionsTable.userId,
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          userId: fixture.userId,
          operationId: fixture.executionId,
          attempt: 1,
          status: "running",
          workerId: ownerWorker,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([
    {
      label: "past UTC instant",
      retryAt: "2020-01-01T00:00:00.000Z",
      allowed: true,
    },
    {
      label: "past instant with timezone offset",
      retryAt: "2020-01-01T02:00:00.000+02:00",
      allowed: true,
    },
    {
      label: "future UTC instant",
      retryAt: "2100-01-01T00:00:00.000Z",
      allowed: false,
    },
    {
      label: "malformed durable timestamp",
      retryAt: "not-a-timestamp",
      allowed: false,
    },
    {
      label: "empty durable timestamp",
      retryAt: "",
      allowed: false,
    },
    {
      label: "numeric durable timestamp",
      retryAt: 1_893_456_000_000,
      allowed: false,
    },
    {
      label: "null durable timestamp",
      retryAt: null,
      allowed: false,
    },
    {
      label: "object durable timestamp",
      retryAt: { iso: "2030-01-01T00:00:00.000Z" },
      allowed: false,
    },
  ] as const)(
    "applies a fail-closed temporal retry gate for $label",
    async ({ label, retryAt, allowed }) => {
      const fixture = await createFailedOrientationFixture(`temporal-${label}`);
      const context = `temporal gate=${label}; retryAt=${retryAt}; execution=${fixture.executionId}`;
      try {
        await db
          .update(aiExecutionAcceptancesTable)
          .set({
            disposition: {
              reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
              outcome: "FAILED",
              recoveryState: "REQUIRED",
              nextActionCode: "RETRY_AFTER_TIMEOUT",
              operatorAction: "RETRY_AFTER_TIMEOUT",
              retryAt,
            },
          })
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

        const [before] = await db
          .select({ resumeTokenHash: aiExecutionsTable.resumeTokenHash })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        const [after] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);

        expect(Boolean(recovered), context).toBe(allowed);
        expect(after, context).toMatchObject({
          attempt: 0,
          status: "failed",
        });
        if (allowed) {
          expect(after!.resumeTokenHash, context).not.toBe(before!.resumeTokenHash);
          expect(recovered?.resumeToken, context).toEqual(expect.any(String));
        } else {
          expect(after!.resumeTokenHash, context).toBe(before!.resumeTokenHash);
        }
        expect(
          JSON.parse(after!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("stores only rotating token hashes and never persists replayable token plaintext", async () => {
    const fixture = await createFailedOrientationFixture("token-secrecy");
    const context = `token secrecy; execution=${fixture.executionId}`;
    const issuedTokens: string[] = [];
    const persistedHashes: string[] = [];
    try {
      for (let rotation = 0; rotation < 3; rotation += 1) {
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        expect(recovered?.resumeToken, context).toMatch(/^[a-f0-9]{64}$/u);
        issuedTokens.push(recovered!.resumeToken);

        const [stored] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            request: aiExecutionsTable.request,
            checkpoint: aiExecutionsTable.checkpoint,
            error: aiExecutionsTable.error,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored?.resumeTokenHash, context).toMatch(/^[a-f0-9]{64}$/u);
        expect(stored!.resumeTokenHash, context).not.toBe(recovered!.resumeToken);
        persistedHashes.push(stored!.resumeTokenHash!);

        const durableProjection = JSON.stringify({
          request: stored!.request,
          checkpoint: stored!.checkpoint,
          error: stored!.error,
        });
        for (const token of issuedTokens) {
          expect(durableProjection, context).not.toContain(token);
        }
      }

      expect(new Set(issuedTokens).size, context).toBe(3);
      expect(new Set(persistedHashes).size, context).toBe(3);
      for (const staleToken of issuedTokens.slice(0, -1)) {
        await expect(claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: "stale-secret-worker",
          resumeToken: staleToken,
        }), context).resolves.toBeUndefined();
      }

      const activeWorker = "latest-secret-worker";
      const claimed = await claimAiExecution({
        executionId: fixture.executionId,
        userId: fixture.userId,
        workerId: activeWorker,
        resumeToken: issuedTokens.at(-1),
      });
      expect(claimed, context).toMatchObject({
        id: fixture.executionId,
        attempt: 1,
        status: "running",
        workerId: activeWorker,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([1, 5, 17] as const)(
    "fences %s late worker write groups while lease-expiry reconciliation becomes authoritative",
    async (lateWriterCount) => {
      const fixture = await createFailedOrientationFixture(`lease-expiry-${lateWriterCount}`);
      const context = `lease expiry lateWriters=${lateWriterCount}; execution=${fixture.executionId}`;
      try {
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        const staleWorker = `expired-lease-worker-${lateWriterCount}`;
        const claimed = await claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: staleWorker,
          resumeToken: recovered!.resumeToken,
        });
        expect(claimed, context).toMatchObject({
          attempt: 1,
          status: "running",
          workerId: staleWorker,
        });
        await expect(persistAiExecutionOrientationManifest({
          executionId: fixture.executionId,
          workerId: staleWorker,
          manifest: fixture.manifest,
        }), context).resolves.toBe(true);

        await db
          .update(aiExecutionsTable)
          .set({ leaseUntil: new Date(Date.now() - 60_000) })
          .where(eq(aiExecutionsTable.id, fixture.executionId));

        const persistAttempts = Promise.all(
          Array.from({ length: lateWriterCount }, (_, index) =>
            persistAiExecutionOrientationManifest({
              executionId: fixture.executionId,
              workerId: staleWorker,
              manifest: index % 2 === 0
                ? fixture.manifest
                : {
                    ...fixture.manifest,
                    paths: {
                      ...fixture.manifest.paths,
                      uncertainty: [`tests/drift-${index}.test.ts`],
                    },
                  },
            })),
        );
        const terminalAttempts = Promise.all(
          Array.from({ length: lateWriterCount }, (_, index) =>
            finalizeExecutionAcceptance({
              executionId: fixture.executionId,
              workerId: staleWorker,
              finalizationKey: `${fixture.executionId}:late-worker:${index}`,
              outcome: index % 2 === 0 ? "FAILED" : "SUCCEEDED",
              terminalStatus: index % 2 === 0 ? "failed" : "completed",
              reasonCode: index % 2 === 0
                ? "LATE_WORKER_FAILURE"
                : "LATE_WORKER_SUCCESS",
              recoveryState: index % 2 === 0 ? "REQUIRED" : "NONE",
            })),
        );
        const reconciliation = reconcileAiExecutions({ expiredOnly: true });
        const [persistResults, terminalResults, reconciledCount] = await Promise.all([
          persistAttempts,
          terminalAttempts,
          reconciliation,
        ]);

        expect(persistResults.every((result) => result === false), context).toBe(true);
        expect(
          terminalResults.every((result) => !result.accepted || result.duplicate),
          context,
        ).toBe(true);
        expect(reconciledCount, context).toBeGreaterThanOrEqual(1);

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: fixture.executionId,
          attempt: 1,
          status: "paused",
          workerId: null,
          leaseUntil: null,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);

        const acceptances = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
            reasonCode: aiExecutionAcceptancesTable.reasonCode,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId))
          .orderBy(aiExecutionAcceptancesTable.attempt);
        expect(acceptances, context).toEqual([
          {
            attempt: 0,
            terminalStatus: "failed",
            reasonCode: "EXECUTION_PROVIDER_FAILURE",
          },
          {
            attempt: 1,
            terminalStatus: "paused",
            reasonCode: "EXECUTION_LEASE_EXPIRED",
          },
        ]);
        await expect(persistAiExecutionOrientationManifest({
          executionId: fixture.executionId,
          workerId: staleWorker,
          manifest: fixture.manifest,
        }), context).resolves.toBe(false);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([
    "projectId",
    "operationId",
    "sourceRevision",
  ] as const)(
    "fails closed when the retry acceptance has $s identity drift",
    async (driftField) => {
      const fixture = await createFailedOrientationFixture(`identity-drift-${driftField}`);
      const context = `acceptance identity drift=${driftField}; execution=${fixture.executionId}`;
      let driftProjectId: string | undefined;
      try {
        if (driftField === "projectId") {
          driftProjectId = randomUUID();
          const driftedAt = new Date();
          await db.insert(projectsTable).values({
            id: driftProjectId,
            ownerId: fixture.userId,
            name: "acceptance-identity-drift",
            rootPath: `/tmp/acceptance-identity-drift-${driftProjectId}`,
            language: "typescript",
            status: "active",
            createdAt: driftedAt,
            updatedAt: driftedAt,
          });
        }
        await db
          .update(aiExecutionAcceptancesTable)
          .set(
            driftField === "projectId"
              ? { projectId: driftProjectId! }
              : driftField === "operationId"
                ? { operationId: randomUUID() }
                : { sourceRevision: "drifted-source-revision" },
          )
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

        const [before] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        const [after] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);

        expect(recovered, context).toBeUndefined();
        expect(after, context).toEqual(before);
        expect(
          JSON.parse(after!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);
      } finally {
        await fixture.cleanup();
        if (driftProjectId) {
          await db.delete(projectsTable).where(eq(projectsTable.id, driftProjectId));
        }
      }
    },
  );

  it("rejects every single and pairwise mutation of the retry eligibility contract without side effects", async () => {
    const scenarios = singleAndPairwiseMutations();
    expect(scenarios).toHaveLength(28);

    for (const [scenarioIndex, mutations] of scenarios.entries()) {
      const label = `${scenarioIndex}-${mutations.join("+")}`;
      const fixture = await createFailedOrientationFixture(`eligibility-${label}`);
      const context = `eligibility mutations=${mutations.join(",")}; execution=${fixture.executionId}`;
      try {
        const acceptanceDisposition: Record<string, unknown> = {
          reasonCodes: ["EXECUTION_PROVIDER_FAILURE"],
          outcome: "FAILED",
          recoveryState: mutations.includes("incomplete-recovery-state")
            ? "INCOMPLETE"
            : "REQUIRED",
          nextActionCode: mutations.includes("wrong-next-action")
            ? "START_NEW_PROBE"
            : "RETRY_AFTER_TIMEOUT",
          operatorAction: mutations.includes("wrong-next-action")
            ? "START_NEW_PROBE"
            : "RETRY_AFTER_TIMEOUT",
          retryAt: mutations.includes("future-retry-time")
            ? "2100-01-01T00:00:00.000Z"
            : "2020-01-01T00:00:00.000Z",
        };
        await db
          .update(aiExecutionAcceptancesTable)
          .set({
            nextActionCode: mutations.includes("wrong-next-action")
              ? "START_NEW_PROBE"
              : "RETRY_AFTER_TIMEOUT",
            resumable: mutations.includes("resumable-acceptance") ? 1 : 0,
            disposition: acceptanceDisposition,
          })
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

        if (mutations.includes("running-status")) {
          await db
            .update(aiExecutionsTable)
            .set({
              status: "running",
              workerId: `mutated-worker-${scenarioIndex}`,
              leaseUntil: new Date(Date.now() + 60_000),
            })
            .where(eq(aiExecutionsTable.id, fixture.executionId));
        }
        if (mutations.includes("missing-resume-authority")) {
          const [current] = await db
            .select({ request: aiExecutionsTable.request })
            .from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, fixture.executionId))
            .limit(1);
          const request = JSON.parse(current!.request) as Record<string, unknown>;
          delete request.resumeContract;
          request.proofRequired = false;
          await db
            .update(aiExecutionsTable)
            .set({ request: JSON.stringify(request) })
            .where(eq(aiExecutionsTable.id, fixture.executionId));
        }

        const [before] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: mutations.includes("wrong-expected-attempt") ? 9 : 0,
        });
        const [after] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            leaseUntil: aiExecutionsTable.leaseUntil,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);

        expect(recovered, context).toBeUndefined();
        expect(after, context).toEqual(before);
      } finally {
        await fixture.cleanup();
      }
    }
  });

  it("preserves legacy proof-required retry authority when the explicit resume contract is absent", async () => {
    const fixture = await createFailedOrientationFixture("legacy-proof-authority");
    const context = `legacy proof retry; execution=${fixture.executionId}`;
    try {
      const [current] = await db
        .select({ request: aiExecutionsTable.request })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const request = JSON.parse(current!.request) as Record<string, unknown>;
      delete request.resumeContract;
      await db
        .update(aiExecutionsTable)
        .set({ request: JSON.stringify(request) })
        .where(eq(aiExecutionsTable.id, fixture.executionId));

      const recovered = await recoverAiExecutionRetryToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 0,
      });
      expect(recovered, context).toMatchObject({
        execution: {
          id: fixture.executionId,
          attempt: 0,
          status: "failed",
        },
        resumeToken: expect.any(String),
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed across deterministic grammar and truncation fuzzing of the durable request envelope", async () => {
    const fixture = await createFailedOrientationFixture("request-grammar-fuzz");
    try {
      const [original] = await db
        .select({ request: aiExecutionsTable.request })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const validRequest = JSON.parse(original!.request) as Record<string, unknown>;
      const invalidEnvelopes: Array<{ label: string; request: string }> = [
        { label: "empty document", request: "" },
        { label: "unterminated object", request: "{" },
        { label: "JSON null", request: "null" },
        { label: "JSON array", request: "[]" },
        { label: "empty object", request: "{}" },
        {
          label: "numeric project identity",
          request: JSON.stringify({ ...validRequest, projectId: 42 }),
        },
        {
          label: "missing model message",
          request: JSON.stringify(
            Object.fromEntries(Object.entries(validRequest).filter(([key]) => key !== "modelMessage")),
          ),
        },
        {
          label: "null user message",
          request: JSON.stringify({ ...validRequest, message: null }),
        },
        {
          label: "scalar target paths",
          request: JSON.stringify({ ...validRequest, validationTargetPaths: "src/App.tsx" }),
        },
        {
          label: "invalid capability probe",
          request: JSON.stringify({
            ...validRequest,
            capabilityProbe: { sourceFiles: "README.md", requiredClaims: [], outputContract: 7 },
          }),
        },
        {
          label: "partial orientation roles",
          request: JSON.stringify({
            ...validRequest,
            resumeContract: {
              ...(validRequest.resumeContract as Record<string, unknown>),
              orientationManifest: {
                projectRevision: fixture.manifest.projectRevision,
                rootPath: fixture.manifest.rootPath,
                paths: {
                  purpose: ["README.md"],
                  components: ["src/App.tsx"],
                  primaryFlow: ["src/routes.ts"],
                },
              },
            },
          }),
        },
        {
          label: "oversized orientation role",
          request: JSON.stringify({
            ...validRequest,
            resumeContract: {
              ...(validRequest.resumeContract as Record<string, unknown>),
              orientationManifest: {
                ...fixture.manifest,
                paths: {
                  ...fixture.manifest.paths,
                  purpose: ["README.md", "docs/one.md", "docs/two.md"],
                },
              },
            },
          }),
        },
        {
          label: "traversal orientation source",
          request: JSON.stringify({
            ...validRequest,
            resumeContract: {
              ...(validRequest.resumeContract as Record<string, unknown>),
              orientationManifest: {
                ...fixture.manifest,
                paths: {
                  ...fixture.manifest.paths,
                  uncertainty: ["../secrets.txt"],
                },
              },
            },
          }),
        },
      ];
      const truncationPercents = [3, 11, 19, 27, 35, 43, 51, 59, 67, 75, 83, 91, 99];
      for (const percent of truncationPercents) {
        invalidEnvelopes.push({
          label: `truncated at ${percent}%`,
          request: original!.request.slice(
            0,
            Math.max(1, Math.floor(original!.request.length * (percent / 100))),
          ),
        });
      }
      expect(invalidEnvelopes).toHaveLength(26);

      for (const [caseIndex, invalid] of invalidEnvelopes.entries()) {
        const context = [
          `request fuzz case=${caseIndex}`,
          `label=${invalid.label}`,
          `bytes=${Buffer.byteLength(invalid.request, "utf8")}`,
          `execution=${fixture.executionId}`,
        ].join("; ");
        await db
          .update(aiExecutionsTable)
          .set({ request: invalid.request })
          .where(eq(aiExecutionsTable.id, fixture.executionId));
        const [before] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        const [after] = await db
          .select({
            resumeTokenHash: aiExecutionsTable.resumeTokenHash,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);

        expect(recovered, context).toBeUndefined();
        expect(after, context).toEqual(before);
        expect(after!.request, context).toBe(invalid.request);
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats resume tokens as opaque exact bytes across canonicalization and Unicode lookalike attacks", async () => {
    const fixture = await createFailedOrientationFixture("token-representation-fuzz");
    const context = `token representation fuzz; execution=${fixture.executionId}`;
    try {
      const recovered = await recoverAiExecutionRetryToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 0,
      });
      const token = recovered!.resumeToken;
      expect(token, context).toMatch(/^[a-f0-9]{64}$/u);

      const replaceAt = (index: number, replacement: string) =>
        `${token.slice(0, index)}${replacement}${token.slice(index + 1)}`;
      const alternateHex = (value: string) => value === "0" ? "1" : "0";
      const mutants = [
        token.toUpperCase(),
        ` ${token}`,
        `${token} `,
        `\t${token}`,
        `${token}\n`,
        `${token}\u0000`,
        token.slice(1),
        token.slice(0, -1),
        `${token}${token.at(-1)}`,
        `${token.at(0)}${token}`,
        [...token].reverse().join(""),
        replaceAt(0, alternateHex(token[0]!)),
        replaceAt(31, alternateHex(token[31]!)),
        replaceAt(63, alternateHex(token[63]!)),
        `${token.slice(0, 16)}\u200B${token.slice(16)}`,
        `${token.slice(0, 16)}\u2060${token.slice(16)}`,
        `${token.slice(0, 16)}\u0301${token.slice(16)}`,
        `${token.slice(0, 16)}０${token.slice(17)}`,
        `"${token}"`,
        `resume:${token}`,
      ];
      expect(new Set(mutants).size, context).toBe(mutants.length);
      expect(mutants.every((mutant) => mutant !== token), context).toBe(true);

      const [before] = await db
        .select({
          resumeTokenHash: aiExecutionsTable.resumeTokenHash,
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const rejected = await Promise.all(mutants.map((resumeToken, index) =>
        claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: `token-mutant-worker-${index}`,
          resumeToken,
        })));
      expect(rejected.every((claim) => claim === undefined), context).toBe(true);

      const [afterMutants] = await db
        .select({
          resumeTokenHash: aiExecutionsTable.resumeTokenHash,
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(afterMutants, context).toEqual(before);

      const validWorker = "exact-token-worker";
      const claimed = await claimAiExecution({
        executionId: fixture.executionId,
        userId: fixture.userId,
        workerId: validWorker,
        resumeToken: token,
      });
      expect(claimed, context).toMatchObject({
        id: fixture.executionId,
        operationId: fixture.executionId,
        attempt: 1,
        status: "running",
        workerId: validWorker,
      });

      const postClaimReplays = await Promise.all([
        claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: "exact-token-replay-worker",
          resumeToken: token,
        }),
        ...mutants.map((resumeToken, index) =>
          claimAiExecution({
            executionId: fixture.executionId,
            userId: fixture.userId,
            workerId: `post-claim-mutant-worker-${index}`,
            resumeToken,
          })),
      ]);
      expect(postClaimReplays.every((claim) => claim === undefined), context).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([2, 5, 9] as const)(
    "prevents token ABA and preserves identity across %s consecutive failed resume generations",
    async (generationCount) => {
      const fixture = await createFailedOrientationFixture(`multi-generation-${generationCount}`);
      const context = `resume generations=${generationCount}; execution=${fixture.executionId}`;
      const retiredTokens: string[] = [];
      try {
        for (let attempt = 0; attempt < generationCount; attempt += 1) {
          const firstRotation = await recoverAiExecutionRetryToken({
            executionId: fixture.executionId,
            userId: fixture.userId,
            expectedAttempt: attempt,
          });
          const finalRotation = await recoverAiExecutionRetryToken({
            executionId: fixture.executionId,
            userId: fixture.userId,
            expectedAttempt: attempt,
          });
          expect(firstRotation, `${context}; attempt=${attempt}; first rotation`).toMatchObject({
            execution: {
              id: fixture.executionId,
              operationId: fixture.executionId,
              attempt,
              status: "failed",
            },
            resumeToken: expect.any(String),
          });
          expect(finalRotation, `${context}; attempt=${attempt}; final rotation`).toMatchObject({
            execution: {
              id: fixture.executionId,
              operationId: fixture.executionId,
              attempt,
              status: "failed",
            },
            resumeToken: expect.any(String),
          });
          expect(finalRotation!.resumeToken, context).not.toBe(firstRotation!.resumeToken);

          const staleThisGeneration = [
            ...retiredTokens,
            firstRotation!.resumeToken,
          ];
          const staleClaims = await Promise.all(staleThisGeneration.map((resumeToken, index) =>
            claimAiExecution({
              executionId: fixture.executionId,
              userId: fixture.userId,
              workerId: `generation-${attempt}-stale-${index}`,
              resumeToken,
            })));
          expect(
            staleClaims.every((claim) => claim === undefined),
            `${context}; attempt=${attempt}; stale count=${staleThisGeneration.length}`,
          ).toBe(true);

          const activeWorker = `generation-worker-${attempt + 1}`;
          const claimed = await claimAiExecution({
            executionId: fixture.executionId,
            userId: fixture.userId,
            workerId: activeWorker,
            resumeToken: finalRotation!.resumeToken,
          });
          expect(claimed, `${context}; resumed attempt=${attempt + 1}`).toMatchObject({
            id: fixture.executionId,
            operationId: fixture.executionId,
            attempt: attempt + 1,
            status: "running",
            workerId: activeWorker,
          });
          await expect(persistAiExecutionOrientationManifest({
            executionId: fixture.executionId,
            workerId: activeWorker,
            manifest: fixture.manifest,
          }), `${context}; manifest attempt=${attempt + 1}`).resolves.toBe(true);

          retiredTokens.push(firstRotation!.resumeToken, finalRotation!.resumeToken);
          if (attempt + 1 < generationCount) {
            const finalized = await finalizeExecutionAcceptance({
              executionId: fixture.executionId,
              workerId: activeWorker,
              finalizationKey: `${fixture.executionId}:generation:${attempt + 1}`,
              outcome: "FAILED",
              terminalStatus: "failed",
              reasonCode: "EXECUTION_PROVIDER_FAILURE",
              recoveryState: "REQUIRED",
              retryable: true,
              resumable: false,
            });
            expect(finalized, `${context}; finalization attempt=${attempt + 1}`).toMatchObject({
              accepted: true,
              duplicate: false,
            });
          }
        }

        const replayResults = await Promise.all(retiredTokens.map((resumeToken, index) =>
          claimAiExecution({
            executionId: fixture.executionId,
            userId: fixture.userId,
            workerId: `terminal-replay-${index}`,
            resumeToken,
          })));
        expect(replayResults.every((claim) => claim === undefined), context).toBe(true);

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: fixture.executionId,
          attempt: generationCount,
          status: "running",
          workerId: `generation-worker-${generationCount}`,
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);

        const acceptances = await db
          .select({
            attempt: aiExecutionAcceptancesTable.attempt,
            reasonCode: aiExecutionAcceptancesTable.reasonCode,
          })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId))
          .orderBy(aiExecutionAcceptancesTable.attempt);
        expect(
          acceptances.map((acceptance) => acceptance.attempt),
          context,
        ).toEqual(Array.from({ length: generationCount }, (_, index) => index));
        expect(
          acceptances.every(
            (acceptance) => acceptance.reasonCode === "EXECUTION_PROVIDER_FAILURE",
          ),
          context,
        ).toBe(true);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([
    { seed: 211, widths: [2, 7, 13, 29] },
    { seed: 307, widths: [29, 13, 7, 2] },
  ] as const)(
    "linearizes rotating recovery swarms across generations for seed $seed",
    async ({ seed, widths }) => {
      const fixture = await createFailedOrientationFixture(`generational-swarm-${seed}`);
      const context = `generational swarm seed=${seed}; widths=${widths.join(",")}; execution=${fixture.executionId}`;
      const retiredTokens: string[] = [];
      try {
        for (const [attempt, width] of widths.entries()) {
          const recoveries = await Promise.all(
            Array.from({ length: width }, () =>
              recoverAiExecutionRetryToken({
                executionId: fixture.executionId,
                userId: fixture.userId,
                expectedAttempt: attempt,
              })),
          );
          expect(recoveries.every(Boolean), `${context}; attempt=${attempt}`).toBe(true);
          const currentTokens = recoveries.map((recovery) => recovery!.resumeToken);
          expect(new Set(currentTokens).size, `${context}; attempt=${attempt}`).toBe(width);

          const claimInputs = seededShuffle(seed + attempt, [
            ...retiredTokens.map((resumeToken, index) => ({
              resumeToken,
              current: false,
              workerId: `retired-${attempt}-${index}`,
            })),
            ...currentTokens.map((resumeToken, index) => ({
              resumeToken,
              current: true,
              workerId: `current-${attempt}-${index}`,
            })),
          ]);
          const claims = await Promise.all(claimInputs.map(async (input) => ({
            ...input,
            result: await claimAiExecution({
              executionId: fixture.executionId,
              userId: fixture.userId,
              workerId: input.workerId,
              resumeToken: input.resumeToken,
            }),
          })));
          const winners = claims.filter((claim) => claim.result !== undefined);
          expect(winners, `${context}; attempt=${attempt}`).toHaveLength(1);
          expect(winners[0]!.current, `${context}; attempt=${attempt}`).toBe(true);
          expect(winners[0]!.result, `${context}; attempt=${attempt}`).toMatchObject({
            id: fixture.executionId,
            operationId: fixture.executionId,
            attempt: attempt + 1,
            status: "running",
            workerId: winners[0]!.workerId,
          });
          expect(
            claims.filter((claim) => !claim.current).every((claim) => claim.result === undefined),
            `${context}; attempt=${attempt}; retired=${retiredTokens.length}`,
          ).toBe(true);

          await expect(persistAiExecutionOrientationManifest({
            executionId: fixture.executionId,
            workerId: winners[0]!.workerId,
            manifest: fixture.manifest,
          }), `${context}; manifest attempt=${attempt + 1}`).resolves.toBe(true);
          retiredTokens.push(...currentTokens);

          if (attempt + 1 < widths.length) {
            const finalized = await finalizeExecutionAcceptance({
              executionId: fixture.executionId,
              workerId: winners[0]!.workerId,
              finalizationKey: `${fixture.executionId}:swarm-generation:${attempt + 1}`,
              outcome: "FAILED",
              terminalStatus: "failed",
              reasonCode: "EXECUTION_PROVIDER_FAILURE",
              recoveryState: "REQUIRED",
              retryable: true,
              resumable: false,
            });
            expect(finalized, `${context}; finalization attempt=${attempt + 1}`).toMatchObject({
              accepted: true,
              duplicate: false,
            });
          }
        }

        const [stored] = await db
          .select({
            operationId: aiExecutionsTable.operationId,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          operationId: fixture.executionId,
          attempt: widths.length,
          status: "running",
        });
        expect(
          JSON.parse(stored!.request).resumeContract.orientationManifest,
          context,
        ).toEqual(fixture.manifest);

        const acceptances = await db
          .select({ attempt: aiExecutionAcceptancesTable.attempt })
          .from(aiExecutionAcceptancesTable)
          .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId))
          .orderBy(aiExecutionAcceptancesTable.attempt);
        expect(
          acceptances.map((acceptance) => acceptance.attempt),
          context,
        ).toEqual(Array.from({ length: widths.length }, (_, index) => index));
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([3, 11] as const)(
    "isolates resume capabilities across %s executions owned by the same user",
    async (executionCount) => {
      const sharedUserId = `shared-orientation-owner-${executionCount}`;
      const fixtures = await Promise.all(
        Array.from({ length: executionCount }, (_, index) =>
          createFailedOrientationFixture(`same-owner-${executionCount}-${index}`)),
      );
      const context = `same-owner execution isolation count=${executionCount}`;
      try {
        await Promise.all(fixtures.flatMap((fixture) => [
          db
            .update(projectsTable)
            .set({ ownerId: sharedUserId })
            .where(eq(projectsTable.id, fixture.projectId)),
          db
            .update(aiExecutionsTable)
            .set({ userId: sharedUserId })
            .where(eq(aiExecutionsTable.id, fixture.executionId)),
        ]));

        const recoveries = await Promise.all(fixtures.map((fixture) =>
          recoverAiExecutionRetryToken({
            executionId: fixture.executionId,
            userId: sharedUserId,
            expectedAttempt: 0,
          })));
        expect(recoveries.every(Boolean), context).toBe(true);
        const tokens = recoveries.map((recovery) => recovery!.resumeToken);
        expect(new Set(tokens).size, context).toBe(executionCount);

        const beforeSwap = await Promise.all(fixtures.map(async (fixture) => {
          const [row] = await db
            .select({
              resumeTokenHash: aiExecutionsTable.resumeTokenHash,
              attempt: aiExecutionsTable.attempt,
              status: aiExecutionsTable.status,
              workerId: aiExecutionsTable.workerId,
            })
            .from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, fixture.executionId))
            .limit(1);
          return row;
        }));
        const swappedClaims = await Promise.all(fixtures.map((fixture, index) =>
          claimAiExecution({
            executionId: fixture.executionId,
            userId: sharedUserId,
            workerId: `swapped-token-worker-${executionCount}-${index}`,
            resumeToken: tokens[(index + 1) % executionCount],
          })));
        expect(swappedClaims.every((claim) => claim === undefined), context).toBe(true);

        const afterSwap = await Promise.all(fixtures.map(async (fixture) => {
          const [row] = await db
            .select({
              resumeTokenHash: aiExecutionsTable.resumeTokenHash,
              attempt: aiExecutionsTable.attempt,
              status: aiExecutionsTable.status,
              workerId: aiExecutionsTable.workerId,
            })
            .from(aiExecutionsTable)
            .where(eq(aiExecutionsTable.id, fixture.executionId))
            .limit(1);
          return row;
        }));
        expect(afterSwap, context).toEqual(beforeSwap);

        const validClaims = await Promise.all(fixtures.map((fixture, index) =>
          claimAiExecution({
            executionId: fixture.executionId,
            userId: sharedUserId,
            workerId: `same-owner-valid-worker-${executionCount}-${index}`,
            resumeToken: tokens[index],
          })));
        expect(validClaims.every(Boolean), context).toBe(true);
        for (const [index, claim] of validClaims.entries()) {
          expect(claim, `${context}; executionIndex=${index}`).toMatchObject({
            id: fixtures[index]!.executionId,
            projectId: fixtures[index]!.projectId,
            operationId: fixtures[index]!.executionId,
            userId: sharedUserId,
            attempt: 1,
            status: "running",
            workerId: `same-owner-valid-worker-${executionCount}-${index}`,
          });
        }

        const crossReplays = await Promise.all(fixtures.map((fixture, index) =>
          claimAiExecution({
            executionId: fixture.executionId,
            userId: sharedUserId,
            workerId: `same-owner-post-claim-replay-${executionCount}-${index}`,
            resumeToken: tokens[(index + 1) % executionCount],
          })));
        expect(crossReplays.every((claim) => claim === undefined), context).toBe(true);
      } finally {
        await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
      }
    },
  );

  it.each([
    "workspace-revision",
    "orientation-manifest",
    "json-field-order",
    "unknown-field",
  ] as const)(
    "binds an issued retry token to immutable request bytes across $s drift",
    async (driftKind) => {
      const fixture = await createFailedOrientationFixture(`request-binding-${driftKind}`);
      const context = `request binding drift=${driftKind}; execution=${fixture.executionId}`;
      try {
        const [beforeRecovery] = await db
          .select({ request: aiExecutionsTable.request })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        const recovered = await recoverAiExecutionRetryToken({
          executionId: fixture.executionId,
          userId: fixture.userId,
          expectedAttempt: 0,
        });
        expect(recovered?.resumeToken, context).toEqual(expect.any(String));

        const parsed = JSON.parse(beforeRecovery!.request) as Record<string, unknown>;
        let driftedRequest: string;
        if (driftKind === "workspace-revision") {
          driftedRequest = JSON.stringify({
            ...parsed,
            workspaceRevision: `${fixture.manifest.projectRevision}-drift`,
          });
        } else if (driftKind === "orientation-manifest") {
          driftedRequest = JSON.stringify({
            ...parsed,
            resumeContract: {
              ...(parsed.resumeContract as Record<string, unknown>),
              orientationManifest: {
                ...fixture.manifest,
                paths: {
                  ...fixture.manifest.paths,
                  uncertainty: ["tests/drifted-request.test.ts"],
                },
              },
            },
          });
        } else if (driftKind === "json-field-order") {
          driftedRequest = JSON.stringify(
            Object.fromEntries(Object.entries(parsed).reverse()),
          );
        } else {
          driftedRequest = JSON.stringify({
            ...parsed,
            postRecoveryMutation: true,
          });
        }
        expect(driftedRequest, context).not.toBe(beforeRecovery!.request);
        await db
          .update(aiExecutionsTable)
          .set({ request: driftedRequest })
          .where(eq(aiExecutionsTable.id, fixture.executionId));

        await expect(claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: `drifted-request-worker-${driftKind}`,
          resumeToken: recovered!.resumeToken,
        }), context).resolves.toBeUndefined();
        const [afterRejectedClaim] = await db
          .select({
            request: aiExecutionsTable.request,
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            workerId: aiExecutionsTable.workerId,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(afterRejectedClaim, context).toMatchObject({
          request: driftedRequest,
          attempt: 0,
          status: "failed",
          workerId: null,
        });

        await db
          .update(aiExecutionsTable)
          .set({ request: beforeRecovery!.request })
          .where(eq(aiExecutionsTable.id, fixture.executionId));
        const restoredClaim = await claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: `restored-request-worker-${driftKind}`,
          resumeToken: recovered!.resumeToken,
        });
        expect(restoredClaim, context).toMatchObject({
          id: fixture.executionId,
          operationId: fixture.executionId,
          attempt: 1,
          status: "running",
          workerId: `restored-request-worker-${driftKind}`,
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([
    {
      label: "drift then recover",
      steps: ["rotate", "drift", "claim-first", "restore", "claim-first"] as const,
      expectedClaims: [false, true] as const,
    },
    {
      label: "rotate then reject retired generation",
      steps: ["rotate", "rotate", "claim-first", "claim-latest"] as const,
      expectedClaims: [false, true] as const,
    },
    {
      label: "drift, restore, then retire the restored generation",
      steps: ["rotate", "drift", "restore", "rotate", "claim-first", "claim-latest"] as const,
      expectedClaims: [false, true] as const,
    },
    {
      label: "request drift after rotation does not select a token",
      steps: ["rotate", "rotate", "drift", "claim-latest", "restore", "claim-latest"] as const,
      expectedClaims: [false, true] as const,
    },
  ] as const)(
    "adapts across $label without mixing token and request generations",
    async ({ label, steps, expectedClaims }) => {
      const fixture = await createFailedOrientationFixture(`adaptive-generations-${label}`);
      const context = `adaptive generations=${label}; execution=${fixture.executionId}`;
      const tokens: string[] = [];
      const [original] = await db
        .select({ request: aiExecutionsTable.request })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const parsedOriginal = JSON.parse(original!.request) as Record<string, unknown>;
      const driftedRequest = JSON.stringify({
        ...parsedOriginal,
        resumeContract: {
          ...(parsedOriginal.resumeContract as Record<string, unknown>),
          orientationManifest: {
            ...fixture.manifest,
            paths: {
              ...fixture.manifest.paths,
              uncertainty: ["tests/adaptive-generation-drift.test.ts"],
            },
          },
        },
      });
      const claimResults: boolean[] = [];
      let claimNumber = 0;

      try {
        for (const [stepIndex, step] of steps.entries()) {
          const stepContext = `${context}; step=${stepIndex}; action=${step}`;
          if (step === "rotate") {
            const recovered = await recoverAiExecutionRetryToken({
              executionId: fixture.executionId,
              userId: fixture.userId,
              expectedAttempt: 0,
            });
            expect(recovered?.resumeToken, stepContext).toEqual(expect.any(String));
            tokens.push(recovered!.resumeToken);
            continue;
          }

          if (step === "drift" || step === "restore") {
            await db
              .update(aiExecutionsTable)
              .set({ request: step === "drift" ? driftedRequest : original!.request })
              .where(eq(aiExecutionsTable.id, fixture.executionId));
            continue;
          }

          const tokenIndex = step === "claim-first" ? 0 : tokens.length - 1;
          const result = await claimAiExecution({
            executionId: fixture.executionId,
            userId: fixture.userId,
            workerId: `adaptive-generation-worker-${label}-${claimNumber}`,
            resumeToken: tokens[tokenIndex],
          });
          claimNumber += 1;
          claimResults.push(result !== undefined);
          if (result) {
            expect(result, stepContext).toMatchObject({
              id: fixture.executionId,
              attempt: 1,
              status: "running",
            });
          } else {
            const [unchanged] = await db
              .select({
                attempt: aiExecutionsTable.attempt,
                status: aiExecutionsTable.status,
              })
              .from(aiExecutionsTable)
              .where(eq(aiExecutionsTable.id, fixture.executionId))
              .limit(1);
            expect(unchanged, stepContext).toMatchObject({
              attempt: 0,
              status: "failed",
            });
          }
        }

        expect(claimResults, context).toEqual(expectedClaims);
        const [stored] = await db
          .select({
            attempt: aiExecutionsTable.attempt,
            status: aiExecutionsTable.status,
            request: aiExecutionsTable.request,
          })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.id, fixture.executionId))
          .limit(1);
        expect(stored, context).toMatchObject({
          attempt: expectedClaims.includes(true) ? 1 : 0,
          status: expectedClaims.includes(true) ? "running" : "failed",
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("adapts across request-byte generations and lease-expired attempts without reviving stale tokens", async () => {
    const fixture = await createFailedOrientationFixture("adaptive-request-bytes-and-attempts");
    const context = `adaptive request generations; execution=${fixture.executionId}`;
    const [originalRow] = await db
      .select({ request: aiExecutionsTable.request })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId))
      .limit(1);
    const parsedOriginal = JSON.parse(originalRow!.request) as Record<string, unknown>;
    const reorderedRequest = JSON.stringify(
      Object.fromEntries(Object.entries(parsedOriginal).reverse()),
    );
    expect(reorderedRequest, context).not.toBe(originalRow!.request);

    try {
      // Generation A issues a token, then generation B replaces it while the
      // request bytes are reordered. Neither token may win after the request
      // returns to generation A: one is retired by rotation and the other is
      // bound to the wrong request bytes.
      const generationAToken = (await recoverAiExecutionRetryToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 0,
      }))?.resumeToken;
      expect(generationAToken, context).toEqual(expect.any(String));

      await db
        .update(aiExecutionsTable)
        .set({ request: reorderedRequest })
        .where(eq(aiExecutionsTable.id, fixture.executionId));

      const generationBToken = (await recoverAiExecutionRetryToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 0,
      }))?.resumeToken;
      expect(generationBToken, context).toEqual(expect.any(String));
      expect(generationBToken).not.toBe(generationAToken);

      await db
        .update(aiExecutionsTable)
        .set({ request: originalRow!.request })
        .where(eq(aiExecutionsTable.id, fixture.executionId));

      const [retiredClaim, wrongRequestClaim] = await Promise.all([
        claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: "adaptive-generation-a-worker",
          resumeToken: generationAToken,
        }),
        claimAiExecution({
          executionId: fixture.executionId,
          userId: fixture.userId,
          workerId: "adaptive-generation-b-worker",
          resumeToken: generationBToken,
        }),
      ]);
      expect(retiredClaim, context).toBeUndefined();
      expect(wrongRequestClaim, context).toBeUndefined();

      const [afterGenerationRejection] = await db
        .select({
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          request: aiExecutionsTable.request,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(afterGenerationRejection, context).toMatchObject({
        attempt: 0,
        status: "failed",
        request: originalRow!.request,
      });

      // The controller observes the unchanged failed state and asks the
      // server for a token bound to the restored request before claiming.
      const currentAttemptZeroToken = (await recoverAiExecutionRetryToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 0,
      }))?.resumeToken;
      expect(currentAttemptZeroToken, context).toEqual(expect.any(String));
      const firstClaim = await claimAiExecution({
        executionId: fixture.executionId,
        userId: fixture.userId,
        workerId: "adaptive-attempt-one-worker",
        resumeToken: currentAttemptZeroToken,
      });
      expect(firstClaim, context).toMatchObject({
        id: fixture.executionId,
        operationId: fixture.executionId,
        attempt: 1,
        status: "running",
        workerId: "adaptive-attempt-one-worker",
      });

      // Simulate a lost stream/worker lease. Reconciliation creates the next
      // durable acceptance, but keeps the same execution and operation.
      await db
        .update(aiExecutionsTable)
        .set({ leaseUntil: new Date(Date.now() - 1_000), updatedAt: new Date() })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      expect(await reconcileAiExecutions({ expiredOnly: true }), context).toBeGreaterThanOrEqual(1);

      const [afterLeaseExpiry] = await db
        .select({
          operationId: aiExecutionsTable.operationId,
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          request: aiExecutionsTable.request,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(afterLeaseExpiry, context).toMatchObject({
        operationId: fixture.executionId,
        attempt: 1,
        status: "paused",
        request: originalRow!.request,
      });

      // Issue a token from a second request-byte generation on attempt 1, then
      // restore the request. It must fail even though the semantic JSON value
      // is equivalent; the token is bound to the exact durable request bytes.
      await db
        .update(aiExecutionsTable)
        .set({ request: reorderedRequest })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
      const attemptOneWrongGenerationToken = (await recoverAiExecutionResumeToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 1,
      }))?.resumeToken;
      expect(attemptOneWrongGenerationToken, context).toEqual(expect.any(String));
      await db
        .update(aiExecutionsTable)
        .set({ request: originalRow!.request })
        .where(eq(aiExecutionsTable.id, fixture.executionId));

      await expect(claimAiExecution({
        executionId: fixture.executionId,
        userId: fixture.userId,
        workerId: "stale-attempt-one-worker",
        resumeToken: attemptOneWrongGenerationToken,
      }), context).resolves.toBeUndefined();

      const currentAttemptOneToken = (await recoverAiExecutionResumeToken({
        executionId: fixture.executionId,
        userId: fixture.userId,
        expectedAttempt: 1,
      }))?.resumeToken;
      expect(currentAttemptOneToken, context).toEqual(expect.any(String));
      const secondClaim = await claimAiExecution({
        executionId: fixture.executionId,
        userId: fixture.userId,
        workerId: "adaptive-attempt-two-worker",
        resumeToken: currentAttemptOneToken,
      });
      expect(secondClaim, context).toMatchObject({
        id: fixture.executionId,
        operationId: fixture.executionId,
        attempt: 2,
        status: "running",
        workerId: "adaptive-attempt-two-worker",
      });

      // The previous worker may still be holding an in-memory checkpoint with
      // a higher sequence after the stream was lost. Ownership must win over
      // that sequence so it cannot overwrite the new attempt.
      const [currentExecution] = await db
        .select({ checkpoint: aiExecutionsTable.checkpoint })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      const currentCheckpoint = parseAiExecutionCheckpoint(currentExecution!.checkpoint);
      expect(currentCheckpoint, context).toBeDefined();
      const staleWorkerCheckpoint = {
        ...currentCheckpoint!,
        sequence: currentCheckpoint!.sequence + 100,
        updatedAt: new Date().toISOString(),
      };
      expect(await checkpointAiExecution({
        executionId: fixture.executionId,
        workerId: "adaptive-attempt-one-worker",
        checkpoint: staleWorkerCheckpoint,
      }), context).toBe(false);

      const currentWorkerCheckpoint = {
        ...staleWorkerCheckpoint,
        sequence: staleWorkerCheckpoint.sequence + 1,
        updatedAt: new Date().toISOString(),
      };
      expect(await checkpointAiExecution({
        executionId: fixture.executionId,
        workerId: "adaptive-attempt-two-worker",
        checkpoint: currentWorkerCheckpoint,
      }), context).toBe(true);

      const [checkpointState] = await db
        .select({
          checkpoint: aiExecutionsTable.checkpoint,
          checkpointVersion: aiExecutionsTable.checkpointVersion,
          workerId: aiExecutionsTable.workerId,
          attempt: aiExecutionsTable.attempt,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(checkpointState, context).toMatchObject({
        checkpointVersion: currentWorkerCheckpoint.sequence,
        workerId: "adaptive-attempt-two-worker",
        attempt: 2,
      });
      expect(JSON.parse(checkpointState!.checkpoint), context).toMatchObject({
        sequence: currentWorkerCheckpoint.sequence,
      });

      const acceptances = await db
        .select({
          attempt: aiExecutionAcceptancesTable.attempt,
          outcome: aiExecutionAcceptancesTable.outcome,
          reasonCode: aiExecutionAcceptancesTable.reasonCode,
        })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId))
        .orderBy(aiExecutionAcceptancesTable.attempt);
      expect(acceptances, context).toEqual([
        expect.objectContaining({ attempt: 0, outcome: "FAILED" }),
        expect.objectContaining({
          attempt: 1,
          outcome: "FAILED",
          reasonCode: "EXECUTION_LEASE_EXPIRED",
        }),
      ]);

      const [finalState] = await db
        .select({
          operationId: aiExecutionsTable.operationId,
          attempt: aiExecutionsTable.attempt,
          status: aiExecutionsTable.status,
          workerId: aiExecutionsTable.workerId,
          request: aiExecutionsTable.request,
        })
        .from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.id, fixture.executionId))
        .limit(1);
      expect(finalState, context).toMatchObject({
        operationId: fixture.executionId,
        attempt: 2,
        status: "running",
        workerId: "adaptive-attempt-two-worker",
        request: originalRow!.request,
      });
    } finally {
      await fixture.cleanup();
    }
  });
});