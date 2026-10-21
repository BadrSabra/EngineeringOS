import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceReadsTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeEffectProofExpectation,
} from "./agent-state/apply-change-effect.js";
import * as applyChangesMissionGate from "./agent-state/apply-changes-mission-gate.js";
import { finalizeApplyChangesTransition } from "./agent-state/runtime-start-transition.js";
import { buildExecutionProofProjection } from "./execution-proof.js";
import { getProjectWorldState } from "./agent-state/world-state.js";
import * as worldStateModule from "./agent-state/world-state.js";
import { hashDeliveryTree } from "./delivery-workspace.js";
import { projectMissionGoalProof } from "./mission-completion-gate.js";

const { scheduleTaskExecution } = vi.hoisted(() => ({
  scheduleTaskExecution: vi.fn(),
}));

vi.mock("../routes/ai/tasks.js", async () => {
  const actual = await vi.importActual<typeof import("../routes/ai/tasks.js")>(
    "../routes/ai/tasks.js",
  );
  return { ...actual, scheduleAiTaskExecution: scheduleTaskExecution };
});

import {
  authorizeMissionGoalContinuation,
  runMissionGoal,
  wakeApplyChangesMissionGoals,
  wakeReadyMissionGoals,
} from "./mission-runtime.js";

const projectIds: string[] = [];
const workspaceRoots: string[] = [];

async function waitForTableLockWaiters(table: string) {
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
    const matching = rows.filter((row) => new RegExp(table, "i").test(row.query ?? ""));
    if (matching.length > 0) return matching;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for a lock waiter on ${table}.`);
}

async function waitForTableWaiterOrSettled(
  table: string,
  operation: Promise<unknown>,
): Promise<{ kind: "waiting" } | { kind: "settled" }> {
  let settled = false;
  void operation.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (settled) return { kind: "settled" };
    const result = await db.execute(sql`
      SELECT waiting.query
      FROM pg_stat_activity AS waiting
      WHERE waiting.pid <> pg_backend_pid()
        AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(waiting.pid)) > 0
    `);
    const rows = (result as unknown as {
      rows?: Array<{ query: string | null }>;
    }).rows ?? [];
    if (rows.some((row) => new RegExp(table, "i").test(row.query ?? ""))) {
      return { kind: "waiting" };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${table} lock progress.`);
}

function postgresErrorCodes(value: unknown): string[] {
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

async function createApplyChangesFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const applyGoalId = randomUUID();
  const reportGoalId = randomUUID();
  const reportTaskId = randomUUID();
  const sessionId = randomUUID();
  const messageId = randomUUID();
  const proposalId = randomUUID();
  const executionId = randomUUID();
  const episodeId = randomUUID();
  const effectBundleId = randomUUID();
  const effectId = randomUUID();
  const transitionId = randomUUID();
  const beforeObservationId = randomUUID();
  const afterObservationId = randomUUID();
  const effectBeforeObservationId = randomUUID();
  const effectAfterObservationId = randomUUID();
  const now = new Date();
  const baseRevision = "a".repeat(40);
  const changeSetHash = "d".repeat(64);
  const planRevision = "e".repeat(64);
  const environmentRevision = `env-v1:${"f".repeat(64)}`;
  const applyActionId = `action:${executionId}:0:apply`;
  const resultingWorldRevision = "2".repeat(64);
  const operationId = `operation:${executionId}`;
  const evidenceSnapshotId = `apply-evidence:${executionId}`;
  const episodeScope = { kind: "project" };
  const taskScope = "project";
  const sourceBody = "Source retained before the approved change.\n";
  const rootPath = path.resolve(
    process.cwd(),
    "../../.test-roots",
    `mission-runtime-apply-${projectId}`,
  );
  const targetPath = path.join(rootPath, "src", "target.ts");
  workspaceRoots.push(rootPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "export const value = 'before';\n", "utf8");
  const baseTreeHash = await hashDeliveryTree(rootPath);
  await writeFile(targetPath, "export const value = 'after';\n", "utf8");
  const candidateTreeHash = await hashDeliveryTree(rootPath);
  const candidateIdentity = `${proposalId}:${candidateTreeHash}`;
  const applyEffectExpectation = buildApplyChangeEffectProofExpectation({
    executionId,
    attempt: 0,
    proposalId,
    candidateTreeHash,
  });
  const requirement = {
    kind: "apply.changes" as const,
    version: 1 as const,
    sourceStepId: "apply-changes" as const,
    proposalId,
    baseRevision,
    candidateTreeHash,
    changeSetHash,
    from: "candidate" as const,
    to: "applied" as const,
  };
  const plan = {
    hash: planRevision,
    applyRequirement: requirement,
    steps: [
      { id: "apply-changes", dependencies: [] },
      { id: "report-applied", dependencies: ["apply-changes"] },
    ],
  };
  const proof = buildExecutionProofProjection({
    outcome: "SUCCEEDED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision: baseRevision,
    candidateIdentity,
  });

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `mission-runtime-apply-${projectId.slice(0, 8)}`,
    rootPath,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(projectId);
  const parentWorldRevision = (await getProjectWorldState(projectId)).worldRevision;

  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Apply changes mission",
    intent: "Apply a verified proposal and report the result",
    status: "waiting",
    scope: { kind: "project", projectId },
    autonomyPolicy: {
      activePlanRevision: planRevision,
      applyMission: {
        proposalId,
        proposalRevision: 1,
        baseTreeHash,
        operationId,
        candidateIdentity,
        baseRevision,
        candidateTreeHash,
        changeSetHash,
        requirement,
      },
    },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values([
    {
      id: applyGoalId,
      missionId,
      projectId,
      title: "Apply approved changes",
      status: "waiting_for_event",
      blockedReason: "apply_changes_pending",
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      successCriteria: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        planRevision: plan,
      },
      outcomeContract: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        candidateIdentity,
        planRevision: plan,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: reportGoalId,
      missionId,
      projectId,
      title: "Report applied changes",
      status: "waiting_for_event",
      blockedReason: "dependencies_pending",
      nextAction: { kind: "task", taskId: reportTaskId, purpose: "execution" },
      successCriteria: {
        stepId: "report-applied",
        planRevision: { hash: planRevision },
      },
      outcomeContract: {
        stepId: "report-applied",
        planRevision: { hash: planRevision },
      },
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(aiGoalDependenciesTable).values({
    id: randomUUID(),
    missionId,
    projectId,
    goalId: reportGoalId,
    dependsOnGoalId: applyGoalId,
    planRevision,
    createdAt: now,
  });
  await db.insert(tasksTable).values({
    id: reportTaskId,
    projectId,
    goalId: reportGoalId,
    title: "Prepare the apply report",
    status: "verifying",
    prompt: "Report the verified changes that were applied.",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Apply proof fixture",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: messageId,
    sessionId,
    role: "user",
    content: "Apply the approved change.",
    createdAt: now,
  });
  await db.insert(aiChangeProposalsTable).values({
    id: proposalId,
    projectId,
    sessionId,
    messageId,
    changes: "[]",
    status: "applied",
    lifecycle: "applied",
    revision: 1,
    operationId,
    baseRevision,
    baseTreeHash,
    candidateTreeHash,
    promotedTreeHash: candidateTreeHash,
    changeSetHash,
    createdAt: now,
  });

  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId: applyGoalId,
    operationId,
    proposalId,
    userId: "test-user",
    idempotencyKey: `execution:${executionId}`,
    resumeTokenHash: `resume:${executionId}`,
    request: "{}",
    checkpoint: "{}",
    status: "completed",
    attempt: 0,
    baseRevision,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const sourceBodyBytes = Buffer.byteLength(sourceBody);
  const sourceContentHash = createHash("sha256").update(sourceBody, "utf8").digest("hex");
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId,
    attempt: 0,
    operationId,
    sourceRevision: baseRevision,
    candidateIdentity,
    verdict: "PROVEN",
    complete: 1,
    readCount: 1,
    totalBytes: sourceBodyBytes,
    artifactRefs: [],
    createdAt: now,
  });
  await db.insert(aiExecutionEvidenceReadsTable).values({
    id: randomUUID(),
    snapshotId: evidenceSnapshotId,
    path: "README.md",
    readType: "source",
    contentHash: sourceContentHash,
    byteLength: sourceBodyBytes,
    complete: 1,
    truncated: 0,
    body: sourceBody,
    createdAt: now,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId,
    executionId,
    attempt: 0,
    missionId,
    goalId: applyGoalId,
    projectRevision: baseRevision,
    environmentRevision,
    worldRevision: parentWorldRevision,
    planRevision,
    intentKind: "recipe",
    scope: episodeScope,
    observationRefs: [effectBeforeObservationId, effectAfterObservationId],
    workerId: "test-worker",
    leaseUntil: new Date(Date.now() + 60_000),
    idempotencyKey: `episode:${episodeId}`,
    state: "completed",
    verdict: "achieved",
    createdAt: now,
    updatedAt: now,
    closedAt: now,
  });
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId,
    attempt: 0,
    episodeId,
    effectIds: [effectId],
    effectContractHashes: [applyEffectExpectation.effectContractHash],
    verdict: "OBSERVED",
    createdAt: now,
  });
  await db.insert(aiAgentEffectsTable).values({
    id: effectId,
    projectId,
    executionId,
    episodeId,
    attempt: 0,
    actionId: applyActionId,
    capabilityId: APPLY_CHANGE_CAPABILITY_ID,
    effectContractHash: applyEffectExpectation.effectContractHash,
    beforeObservationIds: [effectBeforeObservationId],
    afterObservationIds: [effectAfterObservationId],
    expectedEffects: applyEffectExpectation.contract.expectedStateChanges,
    status: "observed",
    missingEffects: [],
    contradictionRefs: [],
    evidenceRefs: ["apply-effect-proof"],
    createdAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: randomUUID(),
    executionId,
    projectId,
    attempt: 0,
    finalizationKey: `final:${executionId}`,
    operationId,
    workerId: "test-worker",
    terminalStatus: "completed",
    outcome: "SUCCEEDED",
    reasonCode: "CANONICAL_PROOF_PROVEN",
    nextActionCode: "none",
    disposition: { proof },
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    sourceRevision: baseRevision,
    candidateIdentity,
    effectBundleId,
    createdAt: now,
  });

  for (const [id, treeHash, sequence] of [
    [beforeObservationId, baseTreeHash, 0],
    [afterObservationId, candidateTreeHash, 1],
  ] as const) {
    const valueHash = createHash("sha256").update(JSON.stringify(treeHash)).digest("hex");
    await db.insert(aiAgentObservationsTable).values({
      id,
      projectId,
      executionId,
      episodeId,
      taskScope,
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "workspace.tree_hash",
      sourceType: "direct_observation",
      sourceId: id,
      sourceVersion: treeHash,
      subject: `project:${projectId}`,
      predicate: "workspace.tree_hash",
      value: treeHash,
      valueHash,
      sourceRefs: [],
      observedAt: now,
      projectRevision: treeHash,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [`apply-tree:${treeHash}`],
      sequence,
      createdAt: now,
    });
  }
  for (const [id, treeHash, sequence, evidenceRef] of [
    [effectBeforeObservationId, baseTreeHash, 2, `apply:${executionId}:0:before`],
    [effectAfterObservationId, candidateTreeHash, 3, `apply:${executionId}:0:after`],
  ] as const) {
    const valueHash = createHash("sha256").update(JSON.stringify(treeHash)).digest("hex");
    await db.insert(aiAgentObservationsTable).values({
      id,
      projectId,
      executionId,
      episodeId,
      taskScope,
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "workspace.tree_hash",
      sourceType: "direct_observation",
      sourceId: id,
      sourceVersion: baseRevision,
      subject: `project:${candidateIdentity}`,
      predicate: "workspace.tree_hash",
      value: treeHash,
      valueHash,
      sourceRefs: [],
      observedAt: now,
      projectRevision: baseRevision,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [evidenceRef],
      sequence,
      createdAt: now,
    });
  }
  await db.insert(aiWorldTransitionsTable).values({
    id: transitionId,
    projectId,
    executionId,
    attempt: 0,
    episodeId,
    actionId: applyActionId,
    effectBundleId,
    parentWorldRevision,
    resultingWorldRevision,
    taskScope,
    environmentRevisionKey: `revision:${environmentRevision}`,
    environmentRevision,
    freshness: "fresh",
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId],
    materializedObservationIds: [beforeObservationId, afterObservationId],
    parentFactRefs: [],
    changedFactRefs: [],
    evidenceRefs: [
      `apply-binding:v1:${JSON.stringify({
        proposalId,
        goalId: applyGoalId,
        planRevision,
        promotedTreeHash: candidateTreeHash,
      })}`,
    ],
    status: "materialized",
    idempotencyKey: `apply.changes:${executionId}:0:${episodeId}:${applyActionId}:${proposalId}:${planRevision}`,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const resultingWorldState = await getProjectWorldState(projectId);
  await db.update(aiWorldTransitionsTable)
    .set({ resultingWorldRevision: resultingWorldState.worldRevision, updatedAt: now })
    .where(eq(aiWorldTransitionsTable.id, transitionId));

  return {
    projectId,
    missionId,
    episodeId,
    applyGoalId,
    reportGoalId,
    reportTaskId,
    proposalId,
    executionId,
    effectBundleId,
    effectId,
    applyActionId,
    transitionId,
    beforeObservationId,
    afterObservationId,
    baseTreeHash,
    candidateTreeHash,
    candidateIdentity,
    parentWorldRevision,
    planRevision,
  };
}

type ApplyChangesFixture = Awaited<ReturnType<typeof createApplyChangesFixture>>;
type ApplyChangesTransaction = Parameters<
  typeof applyChangesMissionGate.evaluateApplyChangesD2
>[0];

async function runApplyGoalAfterD2Mutation(
  fixture: ApplyChangesFixture,
  mutate: (tx: ApplyChangesTransaction) => Promise<void>,
) {
  const evaluateD2 = applyChangesMissionGate.evaluateApplyChangesD2;
  const d2Spy = vi.spyOn(applyChangesMissionGate, "evaluateApplyChangesD2")
    .mockImplementation(async (tx, params) => {
      const result = await evaluateD2(tx, params);
      if (result.state === "proven") await mutate(tx);
      return result;
    });
  try {
    return await runMissionGoal({
      goalId: fixture.applyGoalId,
      userId: "test-user",
      trigger: "resume",
    });
  } finally {
    d2Spy.mockRestore();
  }
}

const invalidApplyProofCases: Array<{
  name: string;
  expectedReason: string;
  expectedAcceptanceOutcome?: "SUCCEEDED" | "FAILED";
  mutate: (fixture: ApplyChangesFixture) => Promise<void>;
}> = [
  {
    name: "candidate-only evidence",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ subject: `candidate:${fixture.proposalId}` })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "environment mismatch",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ environmentRevision: `env-v1:${"9".repeat(64)}` })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "live tree mismatch",
    expectedReason: "apply_transition_tree_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ value: "8".repeat(64) })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "stale after observation",
    expectedReason: "apply_transition_observations_invalid",
    mutate: async (fixture) => {
      await db.update(aiAgentObservationsTable)
        .set({ freshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    },
  },
  {
    name: "wrong transition attempt",
    expectedReason: "apply_transition_missing",
    mutate: async (fixture) => {
      await db.update(aiWorldTransitionsTable)
        .set({ attempt: 1 })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    },
  },
  {
    name: "Episode belongs to a different attempt",
    expectedReason: "apply_transition_episode_invalid",
    mutate: async (fixture) => {
      const wrongEpisodeId = randomUUID();
      const now = new Date();
      await db.insert(aiAgentEpisodesTable).values({
        id: wrongEpisodeId,
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 1,
        projectRevision: "a".repeat(40),
        intentKind: "recipe",
        scope: { kind: "project" },
        workerId: "test-worker",
        leaseUntil: new Date(now.getTime() + 60_000),
        idempotencyKey: `episode:${wrongEpisodeId}`,
        createdAt: now,
        updatedAt: now,
      });
      await db.update(aiWorldTransitionsTable)
        .set({ episodeId: wrongEpisodeId })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    },
  },
  {
    name: "failed Gate-C acceptance",
    expectedReason: "apply_acceptance_missing",
    expectedAcceptanceOutcome: "FAILED",
    mutate: async (fixture) => {
      await db.update(aiExecutionAcceptancesTable)
        .set({ outcome: "FAILED" })
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    },
  },
  {
    name: "prior-attempt acceptance after recovery rotation",
    expectedReason: "apply_acceptance_missing",
    mutate: async (fixture) => {
      await db.update(aiExecutionsTable)
        .set({ attempt: 1 })
        .where(eq(aiExecutionsTable.id, fixture.executionId));
    },
  },
  {
    name: "empty observed effect bundle",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectBundlesTable)
        .set({ effectIds: [], effectContractHashes: [] })
        .where(eq(aiAgentEffectBundlesTable.id, fixture.effectBundleId));
    },
  },
  {
    name: "effect class mismatch",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectsTable)
        .set({ capabilityId: "unrelated.capability" })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    },
  },
  {
    name: "effect action mismatch",
    expectedReason: "apply_effect_unproven",
    mutate: async (fixture) => {
      await db.update(aiAgentEffectsTable)
        .set({ actionId: "action:unrelated" })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    },
  },
  {
    name: "promoted proposal mismatch",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      await db.update(aiChangeProposalsTable)
        .set({ promotedTreeHash: "7".repeat(64) })
        .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    },
  },
  {
    name: "proposal revision changed after Mission binding",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      await db.update(aiChangeProposalsTable)
        .set({ revision: 2 })
        .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    },
  },
  {
    name: "proposal base tree changed after Mission binding",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      await db.update(aiChangeProposalsTable)
        .set({ baseTreeHash: "7".repeat(64) })
        .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    },
  },
  {
    name: "proposal operation identity changed after Mission binding",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      await db.update(aiChangeProposalsTable)
        .set({ operationId: `other:${fixture.proposalId}` })
        .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    },
  },
  {
    name: "Mission operation identity is missing",
    expectedReason: "apply_plan_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = { ...(policy.applyMission as Record<string, unknown>) };
      delete applyMission.operationId;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: { ...policy, applyMission },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
  {
    name: "Mission Proposal revision differs from the stored Proposal",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: { ...applyMission, proposalRevision: 2 },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
  {
    name: "Mission base tree differs from the stored Proposal",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: { ...applyMission, baseTreeHash: "7".repeat(64) },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
  {
    name: "Mission operation identity differs from the stored Proposal",
    expectedReason: "apply_proposal_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: { ...applyMission, operationId: "other-operation" },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
  {
    name: "candidate workspace identity differs from Mission binding",
    expectedReason: "apply_plan_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: { ...applyMission, candidateIdentity: "different-candidate" },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
  {
    name: "Apply Mission requirement binding mismatch",
    expectedReason: "apply_plan_binding_invalid",
    mutate: async (fixture) => {
      const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
        .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
      const policy = mission?.autonomyPolicy as Record<string, unknown>;
      const applyMission = policy.applyMission as Record<string, unknown>;
      const requirement = applyMission.requirement as Record<string, unknown>;
      await db.update(aiMissionsTable).set({
        autonomyPolicy: {
          ...policy,
          applyMission: {
            ...applyMission,
            requirement: { ...requirement, candidateTreeHash: "6".repeat(64) },
          },
        },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
    },
  },
];

afterEach(async () => {
  scheduleTaskExecution.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const workspaceRoot of workspaceRoots.splice(0)) {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("Apply Changes Mission D2 dispatch", () => {
  it("serializes a Transition claim against the live D2 gate before atomically materializing Episode", async () => {
    const fixture = await createApplyChangesFixture();
    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const [goal] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.applyGoalId));
    if (!mission || !goal) throw new Error("Apply Changes lock-order fixture is incomplete.");

    await db.update(aiWorldTransitionsTable).set({
      status: "pending",
      failureCode: null,
      nextRetryAt: null,
      retryCount: 0,
      resultingWorldRevision: null,
      materializedObservationIds: [],
      changedFactRefs: [],
      materializedAt: null,
    }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    let announceEpisodeLocked!: () => void;
    let releaseEpisodeLock!: () => void;
    const episodeLocked = new Promise<void>((resolve) => {
      announceEpisodeLocked = resolve;
    });
    const episodeLockRelease = new Promise<void>((resolve) => {
      releaseEpisodeLock = resolve;
    });
    let announceMaterializerStarted!: () => void;
    let releaseMaterializer!: () => void;
    const materializerStarted = new Promise<void>((resolve) => {
      announceMaterializerStarted = resolve;
    });
    const materializerRelease = new Promise<void>((resolve) => {
      releaseMaterializer = resolve;
    });
    const originalMaterializer = worldStateModule.materializeWorldStateForProject;
    const materializer = vi.spyOn(worldStateModule, "materializeWorldStateForProject")
      .mockImplementation(async (projectId, options, beforeCommit) => {
        announceMaterializerStarted();
        await materializerRelease;
        return originalMaterializer(projectId, options, beforeCommit);
      });

    const pending: Promise<unknown>[] = [];
    let transitionWorker: ReturnType<typeof finalizeApplyChangesTransition> | undefined;
    let d2Gate: Promise<applyChangesMissionGate.ApplyChangesD2Evaluation> | undefined;
    try {
      const episodeBlocker = db.transaction(async (tx) => {
        await tx.select({ id: aiAgentEpisodesTable.id })
          .from(aiAgentEpisodesTable)
          .where(eq(aiAgentEpisodesTable.id, fixture.episodeId))
          .for("update");
        announceEpisodeLocked();
        await episodeLockRelease;
      });
      pending.push(episodeBlocker);
      await episodeLocked;

      transitionWorker = finalizeApplyChangesTransition({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: fixture.applyActionId,
        effectBundleId: fixture.effectBundleId,
      });
      pending.push(transitionWorker);
      await waitForTableLockWaiters("ai_agent_episodes");

      d2Gate = db.transaction((tx) => applyChangesMissionGate.evaluateApplyChangesD2(tx, {
        goal,
        mission,
        activePlanRevision: fixture.planRevision,
      }));
      pending.push(d2Gate);
      await waitForTableLockWaiters("ai_world_transitions");

      releaseEpisodeLock();
      const transitionProgress = await Promise.race([
        materializerStarted.then(() => ({ kind: "materializing" as const })),
        transitionWorker.then(
          (result) => ({ kind: "settled" as const, result }),
          (error) => ({
            kind: "rejected" as const,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      ]);
      if (transitionProgress.kind !== "materializing") {
        const [transition] = await db.select({
          status: aiWorldTransitionsTable.status,
          failureCode: aiWorldTransitionsTable.failureCode,
          nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
        }).from(aiWorldTransitionsTable)
          .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
        throw new Error(
          `Transition worker ended before materialization: ${JSON.stringify({ progress: transitionProgress, transition })}`,
        );
      }
      expect(await d2Gate).toMatchObject({
        state: "pending",
        reason: "apply_transition_pending",
      });

      releaseMaterializer();
      const transitionResult = await transitionWorker;
      if (transitionResult.status !== "materialized") {
        const [transition] = await db.select({
          status: aiWorldTransitionsTable.status,
          failureCode: aiWorldTransitionsTable.failureCode,
          nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
          resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        }).from(aiWorldTransitionsTable)
          .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
        throw new Error(
          `Transition materialization did not complete: ${JSON.stringify({ result: transitionResult, transition })}`,
        );
      }
      const outcomes = await Promise.allSettled(pending);
      const deadlocks = outcomes.filter((outcome) =>
        outcome.status === "rejected"
        && postgresErrorCodes(outcome.reason).includes("40P01"),
      );
      expect(deadlocks).toEqual([]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);

      const [transition] = await db.select({
        status: aiWorldTransitionsTable.status,
        executionId: aiWorldTransitionsTable.executionId,
        attempt: aiWorldTransitionsTable.attempt,
        episodeId: aiWorldTransitionsTable.episodeId,
        parentWorldRevision: aiWorldTransitionsTable.parentWorldRevision,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      const [episode] = await db.select({
        worldRevision: aiAgentEpisodesTable.worldRevision,
        executionId: aiAgentEpisodesTable.executionId,
        attempt: aiAgentEpisodesTable.attempt,
        missionId: aiAgentEpisodesTable.missionId,
        goalId: aiAgentEpisodesTable.goalId,
        planRevision: aiAgentEpisodesTable.planRevision,
      }).from(aiAgentEpisodesTable)
        .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
      expect(transition).toMatchObject({
        status: "materialized",
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        parentWorldRevision: fixture.parentWorldRevision,
        resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(episode).toMatchObject({
        executionId: fixture.executionId,
        attempt: 0,
        missionId: fixture.missionId,
        goalId: fixture.applyGoalId,
        planRevision: fixture.planRevision,
        worldRevision: transition?.resultingWorldRevision,
      });
      expect(materializer).toHaveBeenCalledTimes(1);
    } finally {
      releaseEpisodeLock();
      releaseMaterializer();
      materializer.mockRestore();
      await Promise.allSettled(pending);
    }
  });

  it("rolls back World State and Transition writes when the post-Episode update trigger fails", async () => {
    const fixture = await createApplyChangesFixture();
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `eprb_fn_${suffix}`;
    const triggerName = `eprb_tr_${suffix}`;
    const sequenceName = `eprb_seq_${suffix}`;
    const [episodeBefore] = await db.select({
      worldRevision: aiAgentEpisodesTable.worldRevision,
    }).from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    const worldBefore = await getProjectWorldState(fixture.projectId);

    await db.update(aiWorldTransitionsTable).set({
      status: "pending",
      failureCode: null,
      nextRetryAt: null,
      retryCount: 0,
      resultingWorldRevision: null,
      materializedObservationIds: [],
      changedFactRefs: [],
      materializedAt: null,
    }).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    try {
      await db.execute(sql.raw(`CREATE SEQUENCE ${sequenceName}`));
      await db.execute(sql.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM nextval('public.${sequenceName}');
          RAISE EXCEPTION 'forced_failure_after_episode_update';
        END;
        $$
      `));
      await db.execute(sql.raw(`
        CREATE TRIGGER ${triggerName}
        AFTER UPDATE OF world_revision ON ai_agent_episodes
        FOR EACH ROW
        WHEN (NEW.id = '${fixture.episodeId}')
        EXECUTE FUNCTION ${functionName}()
      `));

      await expect(finalizeApplyChangesTransition({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: fixture.applyActionId,
        effectBundleId: fixture.effectBundleId,
      })).resolves.toMatchObject({
        status: "terminal_failed",
        failureCode: "world_state_materialization_failed",
      });

      const triggerInvocations = await db.execute(sql.raw(
        `SELECT last_value, is_called FROM ${sequenceName}`,
      ));
      expect(triggerInvocations.rows).toHaveLength(1);
      expect(triggerInvocations.rows[0]?.is_called).toBe(true);
      expect(Number(triggerInvocations.rows[0]?.last_value)).toBe(1);

      const [episodeAfter] = await db.select({
        worldRevision: aiAgentEpisodesTable.worldRevision,
      }).from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
      const [transitionAfter] = await db.select({
        status: aiWorldTransitionsTable.status,
        failureCode: aiWorldTransitionsTable.failureCode,
        resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
        materializedObservationIds: aiWorldTransitionsTable.materializedObservationIds,
        changedFactRefs: aiWorldTransitionsTable.changedFactRefs,
        materializedAt: aiWorldTransitionsTable.materializedAt,
      }).from(aiWorldTransitionsTable).where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      const worldAfter = await getProjectWorldState(fixture.projectId);

      expect(episodeAfter?.worldRevision).toBe(episodeBefore?.worldRevision);
      expect(transitionAfter).toMatchObject({
        status: "terminal_failed",
        failureCode: "world_state_materialization_failed",
        resultingWorldRevision: null,
        materializedObservationIds: [],
        changedFactRefs: [],
        materializedAt: null,
      });
      expect({
        projectId: worldAfter.projectId,
        worldRevision: worldAfter.worldRevision,
        facts: worldAfter.facts,
        currentFacts: worldAfter.currentFacts,
        contradictions: worldAfter.contradictions,
      }).toEqual({
        projectId: worldBefore.projectId,
        worldRevision: worldBefore.worldRevision,
        facts: worldBefore.facts,
        currentFacts: worldBefore.currentFacts,
        contradictions: worldBefore.contradictions,
      });
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON ai_agent_episodes`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
      await db.execute(sql.raw(`DROP SEQUENCE IF EXISTS ${sequenceName}`));
    }
  });

  it("does not deadlock dependency proof against an Apply Changes transition claim", async () => {
    const fixture = await createApplyChangesFixture();
    const [applyGoal] = await db.select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [transition] = await db.select()
      .from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    if (!applyGoal || !transition?.resultingWorldRevision) {
      throw new Error("Apply Changes lock-order fixture is incomplete.");
    }

    const candidateIdentity = fixture.candidateIdentity;
    const operationId = `operation:${fixture.executionId}`;
    const environmentRevision = `env-v1:${"f".repeat(64)}`;
    await db.update(aiGoalsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        outcomeContract: {
          ...(applyGoal.outcomeContract as Record<string, unknown>),
          acceptance: {
            executionId: fixture.executionId,
            operationId,
            outcome: "SUCCEEDED",
            verdict: "PROVEN",
            reasonCode: "APPLY_CHANGES_D2_PROVEN",
            scope: {
              projectId: fixture.projectId,
              missionId: fixture.missionId,
              goalId: fixture.applyGoalId,
              planRevision: fixture.planRevision,
              candidateIdentity,
              operationId,
            },
            stateProjection: {
              transitionId: fixture.transitionId,
              worldRevision: transition.resultingWorldRevision,
              environmentRevision,
            },
          },
        },
      })
      .where(eq(aiGoalsTable.id, fixture.applyGoalId));
    await db.update(aiWorldTransitionsTable)
      .set({
        status: "pending",
        resultingWorldRevision: null,
        nextRetryAt: null,
      })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    let announceAcceptanceLocked!: () => void;
    let releaseAcceptanceLock!: () => void;
    const acceptanceLocked = new Promise<void>((resolve) => {
      announceAcceptanceLocked = resolve;
    });
    const acceptanceLockRelease = new Promise<void>((resolve) => {
      releaseAcceptanceLock = resolve;
    });
    const pending: Promise<unknown>[] = [];

    const acceptanceBlocker = db.transaction(async (tx) => {
      await tx.select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, fixture.executionId),
          eq(aiExecutionAcceptancesTable.attempt, 0),
        ))
        .for("update");
      announceAcceptanceLocked();
      await acceptanceLockRelease;
    });
    pending.push(acceptanceBlocker);
    try {
      await acceptanceLocked;

      const dependencyProof = db.transaction(async (tx) => {
        const [mission] = await tx.select()
          .from(aiMissionsTable)
          .where(eq(aiMissionsTable.id, fixture.missionId));
        const [goal] = await tx.select()
          .from(aiGoalsTable)
          .where(eq(aiGoalsTable.id, fixture.reportGoalId));
        if (!mission || !goal) throw new Error("Mission dependency fixture disappeared.");
        return authorizeMissionGoalContinuation(tx, mission, goal);
      });
      pending.push(dependencyProof);
      await waitForTableLockWaiters("ai_execution_acceptances");

      const transitionWorker = finalizeApplyChangesTransition({
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: fixture.applyActionId,
        effectBundleId: fixture.effectBundleId,
      });
      pending.push(transitionWorker);

      const transitionProgress = await waitForTableWaiterOrSettled(
        "ai_agent_episodes",
        transitionWorker,
      );
      releaseAcceptanceLock();
      const outcomes = await Promise.allSettled([
        acceptanceBlocker,
        dependencyProof,
        transitionWorker,
      ] as const);
      const deadlocks = outcomes.filter((outcome) =>
        outcome.status === "rejected"
        && postgresErrorCodes(outcome.reason).includes("40P01"),
      );
      expect(
        deadlocks,
        JSON.stringify({
          transitionProgress,
          outcomes: outcomes.map((outcome) =>
            outcome.status === "fulfilled" ? "fulfilled" : postgresErrorCodes(outcome.reason),
          ),
        }),
      ).toHaveLength(0);
      expect(transitionProgress.kind).toBe("settled");
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
        "fulfilled",
      ]);
      expect(outcomes[2]).toMatchObject({
        status: "fulfilled",
        value: {
          status: "terminal_failed",
          failureCode: "apply_transition_goal_or_proposal_mismatch",
        },
      });
      const [finalTransition] = await db.select({
        status: aiWorldTransitionsTable.status,
        failureCode: aiWorldTransitionsTable.failureCode,
        retryCount: aiWorldTransitionsTable.retryCount,
        nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
      }).from(aiWorldTransitionsTable)
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
      expect(finalTransition).toEqual({
        status: "terminal_failed",
        failureCode: "apply_transition_goal_or_proposal_mismatch",
        retryCount: 0,
        nextRetryAt: null,
      });
    } finally {
      releaseAcceptanceLock();
      await Promise.allSettled(pending);
    }
  });

  it("does not lock D2 dependency rows during read-only Mission proof projection", async () => {
    const fixture = await createApplyChangesFixture();
    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const [reportGoal] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.reportGoalId));
    if (!mission || !reportGoal) throw new Error("Apply Changes projection fixture is incomplete.");

    let announceDependencyLocked!: () => void;
    let releaseDependencyLock!: () => void;
    const dependencyLocked = new Promise<void>((resolve) => {
      announceDependencyLocked = resolve;
    });
    const dependencyLockRelease = new Promise<void>((resolve) => {
      releaseDependencyLock = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      const locked = await tx.select({ id: aiGoalDependenciesTable.id })
        .from(aiGoalDependenciesTable)
        .where(and(
          eq(aiGoalDependenciesTable.projectId, fixture.projectId),
          eq(aiGoalDependenciesTable.missionId, fixture.missionId),
          eq(aiGoalDependenciesTable.goalId, fixture.reportGoalId),
          eq(aiGoalDependenciesTable.planRevision, fixture.planRevision),
        ))
        .for("update");
      if (locked.length !== 1) throw new Error("Expected one report dependency to lock.");
      announceDependencyLocked();
      await dependencyLockRelease;
    });

    let projection: Promise<unknown> | undefined;
    try {
      await dependencyLocked;
      projection = db.transaction((tx) => projectMissionGoalProof(tx, mission, reportGoal));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        projection.then(() => "completed" as const),
        new Promise<"blocked">((resolve) => {
          timeout = setTimeout(() => resolve("blocked"), 1_000);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      expect(result).toBe("completed");
    } finally {
      releaseDependencyLock();
      await blocker;
      await projection?.catch(() => undefined);
    }
  });

  it("rechecks the current Goal state before projecting live proof", async () => {
    const fixture = await createApplyChangesFixture();

    const result = await runApplyGoalAfterD2Mutation(fixture, async (tx) => {
      await tx.update(aiGoalsTable)
        .set({ status: "blocked", blockedReason: "operator_blocked_fixture" })
        .where(eq(aiGoalsTable.id, fixture.applyGoalId));
    });

    expect(result).toMatchObject({
      status: "conflict",
      reason: "mission_goal_continuation_goal_operator_owned",
    });
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    expect(goal?.status).toBe("blocked");
    expect((goal?.outcomeContract as Record<string, unknown>).acceptance).toBeUndefined();
  });

  it("rechecks the dependency chain before projecting live proof", async () => {
    const fixture = await createApplyChangesFixture();

    const result = await runApplyGoalAfterD2Mutation(fixture, async (tx) => {
      await tx.insert(aiGoalDependenciesTable).values({
        id: randomUUID(),
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        goalId: fixture.applyGoalId,
        dependsOnGoalId: fixture.reportGoalId,
        planRevision: fixture.planRevision,
        createdAt: new Date(),
      });
    });

    expect(result).toMatchObject({
      status: "conflict",
      reason: "mission_goal_continuation_dependency_invalid",
    });
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [mission] = await db.select({ status: aiMissionsTable.status })
      .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
    expect(goal).toMatchObject({
      status: "needs_replan",
      blockedReason: "dependency_proof_unproven",
    });
    expect((goal?.outcomeContract as Record<string, unknown>).acceptance).toBeUndefined();
    expect(mission?.status).toBe("needs_replan");
  });

  it("dispatches the report-applied task once after live proof, including on repeated wake", async () => {
    const fixture = await createApplyChangesFixture();

    const concurrentWakes = await Promise.all([
      wakeApplyChangesMissionGoals(),
      wakeApplyChangesMissionGoals(),
    ]);
    expect(concurrentWakes.every((count) => count <= 1)).toBe(true);
    expect(concurrentWakes.some((count) => count === 1)).toBe(true);
    expect(await wakeApplyChangesMissionGoals()).toBe(0);

    const [applyGoal] = await db.select({
      status: aiGoalsTable.status,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [reportGoal] = await db.select({ status: aiGoalsTable.status })
      .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(applyGoal?.status).toBe("completed");
    expect(applyGoal?.outcomeContract).toMatchObject({
      acceptance: {
        verdict: "PROVEN",
        reasonCode: "APPLY_CHANGES_D2_PROVEN",
        stateProjection: {
          transitionId: fixture.transitionId,
        },
      },
    });
    expect(reportGoal?.status).toBe("running");

    const events = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      taskId: eventsTable.taskId,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    const reportDispatches = events.filter((event) =>
      event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
    );
    expect(reportDispatches).toHaveLength(1);
    expect(reportDispatches[0]).toMatchObject({
      taskId: fixture.reportTaskId,
      payload: { action: "task", trigger: "wake" },
    });
    expect(events.filter((event) =>
      event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
    )).toHaveLength(1);
    expect(scheduleTaskExecution).toHaveBeenCalledTimes(1);
    expect(scheduleTaskExecution).toHaveBeenCalledWith(
      fixture.reportTaskId,
      "test-user",
      { parentExecutionId: null },
    );

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toEqual({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });
  });

  it("wakes an already-queued report Goal after direct D2 completion", async () => {
    const fixture = await createApplyChangesFixture();
    await db.update(aiGoalsTable)
      .set({ status: "queued", blockedReason: null })
      .where(eq(aiGoalsTable.id, fixture.reportGoalId));

    const result = await runApplyGoalAfterD2Mutation(fixture, async () => {});

    expect(result).toMatchObject({ status: "completed" });
    const [applyGoal] = await db.select({
      status: aiGoalsTable.status,
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [reportGoal] = await db.select({
      status: aiGoalsTable.status,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(applyGoal?.status).toBe("completed");
    expect(applyGoal?.outcomeContract).toMatchObject({
      acceptance: { verdict: "PROVEN", reasonCode: "APPLY_CHANGES_D2_PROVEN" },
    });
    expect(reportGoal?.status).toBe("running");

    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      taskId: eventsTable.taskId,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    expect(dispatches.filter((event) =>
      event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
    )).toHaveLength(1);
    expect(scheduleTaskExecution).toHaveBeenCalledTimes(1);
    expect(await wakeReadyMissionGoals()).toBe(0);
    expect(scheduleTaskExecution).toHaveBeenCalledTimes(1);
  });

  it("keeps D2 proof current after the exact candidate is committed", async () => {
    const fixture = await createApplyChangesFixture();
    const [goal] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    if (!goal || !mission) throw new Error("Apply Changes D2 fixture is incomplete.");

    const evaluate = () => db.transaction((tx) =>
      applyChangesMissionGate.evaluateApplyChangesD2(tx, {
        goal,
        mission,
        activePlanRevision: fixture.planRevision,
      }));
    expect(await evaluate()).toMatchObject({ state: "proven" });

    await db.update(aiChangeProposalsTable)
      .set({
        lifecycle: "committed",
        commitHash: "a".repeat(40),
        committedTreeHash: fixture.candidateTreeHash,
      })
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    expect(await evaluate()).toMatchObject({ state: "proven" });

    await db.update(aiChangeProposalsTable)
      .set({ committedTreeHash: "f".repeat(64) })
      .where(eq(aiChangeProposalsTable.id, fixture.proposalId));
    expect(await evaluate()).toMatchObject({
      state: "failed",
      reason: "apply_proposal_binding_invalid",
    });
  });

  it("keeps an already-queued report Goal blocked when its predecessor lacks Canonical Proof", async () => {
    const fixture = await createApplyChangesFixture();
    await db.update(aiGoalsTable)
      .set({ status: "queued", blockedReason: null })
      .where(eq(aiGoalsTable.id, fixture.reportGoalId));
    await db.update(aiGoalsTable)
      .set({
        status: "completed",
        outcomeContract: { planRevision: { hash: fixture.planRevision } },
      })
      .where(eq(aiGoalsTable.id, fixture.applyGoalId));

    expect(await wakeReadyMissionGoals()).toBe(0);

    const [reportGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(reportGoal).toEqual({
      status: "needs_replan",
      blockedReason: "dependency_proof_unproven",
    });
    expect(scheduleTaskExecution).not.toHaveBeenCalled();
    const dispatches = await db.select({ type: eventsTable.type })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.goalId, fixture.reportGoalId),
        eq(eventsTable.type, "AiGoalDispatchRequested"),
      ));
    expect(dispatches).toHaveLength(0);
  });

  it.each(invalidApplyProofCases)(
    "blocks dispatch and preserves Gate-C acceptance for $name",
    async ({ mutate, expectedReason, expectedAcceptanceOutcome = "SUCCEEDED" }) => {
      const fixture = await createApplyChangesFixture();
      await mutate(fixture);

      expect(await wakeApplyChangesMissionGoals()).toBe(1);
      expect(await wakeApplyChangesMissionGoals()).toBe(0);

      const [applyGoal] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
      const [reportGoal] = await db.select({
        status: aiGoalsTable.status,
        blockedReason: aiGoalsTable.blockedReason,
      }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
      expect(applyGoal).toEqual({
        status: "needs_replan",
        blockedReason: expectedReason,
      });
      expect(reportGoal).toEqual({
        status: "waiting_for_event",
        blockedReason: "dependencies_pending",
      });

      const events = await db.select({
        type: eventsTable.type,
        goalId: eventsTable.goalId,
      }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
      expect(events.some((event) =>
        event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
      )).toBe(false);
      expect(events.some((event) =>
        event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
      )).toBe(false);
      expect(events.some((event) =>
        event.type === "AiGoalApplyChangesProofBlocked" && event.goalId === fixture.applyGoalId,
      )).toBe(true);
      expect(scheduleTaskExecution).not.toHaveBeenCalled();

      const [acceptance] = await db.select({
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
      }).from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      expect(acceptance).toEqual({
        outcome: expectedAcceptanceOutcome,
        terminalStatus: "completed",
        effectBundleId: fixture.effectBundleId,
      });
    },
  );

  it("leaves a stale-plan apply pending without dispatch or changing Gate-C acceptance", async () => {
    const fixture = await createApplyChangesFixture();
    const [mission] = await db.select({ autonomyPolicy: aiMissionsTable.autonomyPolicy })
      .from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId));
    const policy = mission?.autonomyPolicy as Record<string, unknown>;
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { ...policy, activePlanRevision: "6".repeat(64) },
    }).where(eq(aiMissionsTable.id, fixture.missionId));

    expect(await wakeApplyChangesMissionGoals()).toBe(0);

    const [applyGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.applyGoalId));
    const [reportGoal] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.reportGoalId));
    expect(applyGoal).toEqual({
      status: "waiting_for_event",
      blockedReason: "apply_changes_pending",
    });
    expect(reportGoal).toEqual({
      status: "waiting_for_event",
      blockedReason: "dependencies_pending",
    });

    const events = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    expect(events.some((event) =>
      event.type === "AiGoalDispatchRequested" && event.goalId === fixture.reportGoalId,
    )).toBe(false);
    expect(events.some((event) =>
      event.type === "AiGoalApplyChangesProofAccepted" && event.goalId === fixture.applyGoalId,
    )).toBe(false);
    expect(scheduleTaskExecution).not.toHaveBeenCalled();

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toEqual({
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      effectBundleId: fixture.effectBundleId,
    });
  });
});