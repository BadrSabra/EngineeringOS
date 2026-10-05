import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  db,
} from "@workspace/db";
import { getProjectWorldState } from "../lib/agent-state/world-state.js";
import { taskScopeIdentity } from "../lib/agent-state/observation-materializer.js";
import { buildExecutionProofProjection } from "../lib/execution-proof.js";

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function seedCanonicalMissionGoalCompletion(input: {
  projectId: string;
  missionId: string;
  goalId: string;
  planRevision: string;
  sequence?: number;
  baseTime?: Date;
  sourceRevision?: string;
}): Promise<{ executionId: string; completedAt: Date }> {
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const evidenceSnapshotId = randomUUID();
  const operationId = `mission-proof:${executionId}`;
  const sourceRevision = input.sourceRevision ?? "a".repeat(40);
  const sequence = input.sequence ?? 0;
  const baseTime = input.baseTime ?? new Date(Date.now() - 10 * 60_000);
  const createdAt = new Date(baseTime.getTime() + sequence * 1_000);
  const completedAt = new Date(createdAt.getTime() + 500);
  const episodeScope = { kind: "mission_goal" };
  const taskScope = taskScopeIdentity({
    id: episodeId,
    projectId: input.projectId,
    missionId: input.missionId,
    goalId: input.goalId,
    scope: episodeScope,
  });
  const worldState = await getProjectWorldState(input.projectId, {
    taskScope,
    environmentRevision: null,
  });
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision,
  });

  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId: input.projectId,
    goalId: input.goalId,
    operationId,
    userId: "test-user",
    idempotencyKey: `mission-proof:${executionId}`,
    resumeTokenHash: `mission-proof-token:${executionId}`,
    request: JSON.stringify({
      projectId: input.projectId,
      operationId,
      workspaceRevision: sourceRevision,
      proofRequired: true,
      proofEvidenceMode: "artifact_only",
    }),
    checkpoint: "{}",
    status: "completed",
    attempt: 0,
    baseRevision: sourceRevision,
    createdAt,
    updatedAt: completedAt,
    completedAt,
  });
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId: input.projectId,
    attempt: 0,
    operationId,
    sourceRevision,
    verdict: "PROVEN",
    complete: 1,
    readCount: 1,
    totalBytes: 64,
    createdAt: completedAt,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: randomUUID(),
    executionId,
    projectId: input.projectId,
    attempt: 0,
    finalizationKey: `mission-proof-finalization:${executionId}`,
    operationId,
    workerId: "mission-proof-fixture",
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
    createdAt: completedAt,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId: input.projectId,
    executionId,
    attempt: 0,
    missionId: input.missionId,
    goalId: input.goalId,
    projectRevision: sourceRevision,
    worldRevision: worldState.worldRevision,
    planRevision: input.planRevision,
    intentKind: "task",
    scope: episodeScope,
    observationRefs: [],
    workerId: "mission-proof-fixture",
    leaseUntil: new Date(completedAt.getTime() + 60_000),
    idempotencyKey: `mission-proof-episode:${episodeId}`,
    state: "completed",
    verdict: "achieved",
    createdAt,
    updatedAt: completedAt,
    closedAt: completedAt,
  });

  const [goal] = await db
    .select({ outcomeContract: aiGoalsTable.outcomeContract })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.id, input.goalId),
      eq(aiGoalsTable.missionId, input.missionId),
      eq(aiGoalsTable.projectId, input.projectId),
    ))
    .limit(1);
  const outcomeContract = jsonRecord(goal?.outcomeContract);
  const existingPlanRevision = jsonRecord(outcomeContract.planRevision);
  await db.update(aiGoalsTable)
    .set({
      status: "completed",
      blockedReason: null,
      completedAt,
      outcomeContract: {
        ...outcomeContract,
        planRevision: { ...existingPlanRevision, hash: input.planRevision },
        acceptance: {
          executionId,
          outcome: "SUCCEEDED",
          verdict: "PROVEN",
          acceptedRefs: [evidenceSnapshotId],
          scope: {
            projectId: input.projectId,
            missionId: input.missionId,
            goalId: input.goalId,
            operationId,
            planRevision: input.planRevision,
          },
        },
      },
      updatedAt: completedAt,
    })
    .where(and(
      eq(aiGoalsTable.id, input.goalId),
      eq(aiGoalsTable.missionId, input.missionId),
      eq(aiGoalsTable.projectId, input.projectId),
    ));

  return { executionId, completedAt };
}
