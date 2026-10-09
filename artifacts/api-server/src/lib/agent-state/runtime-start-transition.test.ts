import { and, eq } from "drizzle-orm";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalDependenciesTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  aiWorldTransitionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import {
  claimAiExecution,
  createAiExecution,
  recoverAiExecutionResumeToken,
} from "../ai-execution-state.js";
import { startEpisode } from "./agent-episode-ledger.js";
import {
  bindGitHubDeliveryTransitionEffect,
  createPendingGitHubDeliveryTransition,
  createPendingRuntimeStartTransition,
  createPendingApplyChangesTransition,
  finalizeApplyChangesTransition,
  finalizeRuntimeStartTransition,
  retryPendingRuntimeStartTransitions,
} from "./runtime-start-transition.js";
import { wakeRuntimeTransitionMissionGoals } from "../mission-runtime.js";
import { evaluateApplyChangesD2 } from "./apply-changes-mission-gate.js";
import { heavyJobQueue } from "../job-queue.js";
import { childProcessBindingDigest } from "./child-process-attestation.js";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./world-state.js";
import * as worldStateModule from "./world-state.js";
import { hashDeliveryTree } from "../delivery-workspace.js";
import { GoalNextActionSchema } from "@workspace/ai-orchestrator";
import { taskScopeIdentity } from "./observation-materializer.js";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  buildApplyChangeEffectProofExpectation,
} from "./apply-change-effect.js";

const createdProjects: string[] = [];
const createdExecutionIds: string[] = [];
const createdWorkspaceRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const rootPath of createdWorkspaceRoots.splice(0)) {
    await rm(rootPath, { recursive: true, force: true });
  }
  for (const executionId of createdExecutionIds.splice(0)) {
    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, executionId));
    await db.delete(aiExecutionsTable).where(eq(aiExecutionsTable.id, executionId));
  }
  for (const projectId of createdProjects.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

async function acceptTransitionFixture(fixture: {
  projectId: string;
  executionId: string;
  operationId: string;
  effectBundleId: string;
}) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(aiExecutionsTable)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    await tx.insert(aiExecutionAcceptancesTable).values({
      id: crypto.randomUUID(),
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 0,
      finalizationKey: `final:${fixture.executionId}`,
      operationId: fixture.operationId,
      workerId: `runtime-transition-worker:${fixture.projectId}`,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "CANONICAL_PROOF_PROVEN",
      nextActionCode: "none",
      effectBundleId: fixture.effectBundleId,
      createdAt: now,
    });
  });
}

function createRuntimeStartMissionHandoffFixture(projectId: string) {
  const missionId = crypto.randomUUID();
  const sourceGoalId = crypto.randomUUID();
  const targetGoalId = crypto.randomUUID();
  const planRevision = `plan-runtime-start:${projectId}`;
  const requirement = {
    kind: "runtime.start",
    version: 1,
    sourceStepId: "runtime-start",
    targetStepId: "target-step",
    from: "stopped",
    to: "running",
  } as const;
  const plan = { hash: planRevision, transitionRequirements: [requirement] };
  return { missionId, sourceGoalId, targetGoalId, planRevision, requirement, plan };
}

async function transitionFixture(options: {
  accepted?: boolean;
  missionHandoff?: boolean;
} = {}) {
  const projectId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const userId = `runtime-transition-test:${projectId}`;
  const workerId = `runtime-transition-worker:${projectId}`;
  const now = new Date();
  const missionHandoff = options.missionHandoff
    ? createRuntimeStartMissionHandoffFixture(projectId)
    : undefined;
  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: userId,
    name: "runtime transition retry test",
    rootPath: `${process.cwd()}/.runtime-start-transition-test/${projectId}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  createdProjects.push(projectId);
  if (missionHandoff) {
    await db.insert(aiMissionsTable).values({
      id: missionHandoff.missionId,
      projectId,
      userId,
      title: "Runtime transition handoff",
      intent: "Verify the exact runtime transition before dispatching its successor",
      status: "waiting",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: missionHandoff.planRevision },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values([
      {
        id: missionHandoff.sourceGoalId,
        missionId: missionHandoff.missionId,
        projectId,
        title: "Start runtime",
        status: "completed",
        nextAction: { kind: "recipe", recipeId: "runtime.start", recipeVersion: 1 },
        successCriteria: {
          stepId: "runtime-start",
          planRevision: missionHandoff.plan,
        },
        outcomeContract: { planRevision: { hash: missionHandoff.planRevision } },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: missionHandoff.targetGoalId,
        missionId: missionHandoff.missionId,
        projectId,
        title: "Verify runtime",
        status: "waiting_for_event",
        nextAction: {
          kind: "recipe",
          recipeId: "candidate.verify",
          recipeVersion: 1,
          approvedPaths: ["package.json"],
        },
        successCriteria: {
          stepId: "target-step",
          planRevision: missionHandoff.plan,
          transitionRequirement: missionHandoff.requirement,
        },
        outcomeContract: { planRevision: { hash: missionHandoff.planRevision } },
        blockedReason: "runtime_transition_pending",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }
  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Runtime transition retry test",
    createdAt: now,
    updatedAt: now,
  });

  const created = await createAiExecution({
    userId,
    projectId,
    sessionId,
    idempotencyKey: `${operationId}:retry`,
    request: {
      projectId,
      operationId,
      sessionId,
      message: "runtime transition retry test",
      modelMessage: "runtime transition retry test",
      workspaceRevision: "a".repeat(64),
      validationTargetPaths: [],
    },
  });
  const actualExecutionId = created.execution.id;
  createdExecutionIds.push(actualExecutionId);
  if (missionHandoff) {
    await db.update(aiExecutionsTable)
      .set({ goalId: missionHandoff.sourceGoalId })
      .where(eq(aiExecutionsTable.id, actualExecutionId));
  }
  const claimed = await claimAiExecution({
    executionId: actualExecutionId,
    userId,
    workerId,
  });
  expect(claimed?.status).toBe("running");
  const episodeScope = { kind: "project", paths: [] };
  const episode = await startEpisode({
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    workerId,
    idempotencyKey: `${operationId}:episode`,
    projectRevision: "a".repeat(64),
    intentKind: "RUNTIME_START",
    scope: episodeScope,
    ...(missionHandoff
      ? {
          missionId: missionHandoff.missionId,
          goalId: missionHandoff.sourceGoalId,
          planRevision: missionHandoff.planRevision,
        }
      : {}),
  });
  const taskScope = taskScopeIdentity({
    id: episode.episodeId,
    projectId,
    missionId: missionHandoff?.missionId ?? null,
    goalId: missionHandoff?.sourceGoalId ?? null,
    scope: episodeScope,
  });
  const effectBundleId = `effect:${operationId}`;
  await db.insert(aiAgentEffectBundlesTable).values({
    id: effectBundleId,
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    effectIds: [],
    effectContractHashes: [],
    verdict: "OBSERVED",
  });
  const parent = await getProjectWorldState(projectId, {
    excludeEpisodeIds: [episode.episodeId],
  });
  const environmentRevision = `env-v1:${"c".repeat(64)}`;
  const sourceRevision = "a".repeat(64);
  const beforeObservationId = crypto.randomUUID();
  const afterObservationId = crypto.randomUUID();
  const statusObservationId = crypto.randomUUID();
  const childProcessObservationId = crypto.randomUUID();
  const transitionInput = {
    projectId,
    executionId: actualExecutionId,
    attempt: 0,
    episodeId: episode.episodeId,
    actionId: `action:${operationId}`,
    effectBundleId,
    workerId,
    taskScope,
    parentWorldRevision: parent.worldRevision,
    parentFactRefs: [],
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId, statusObservationId, childProcessObservationId],
    evidenceRefs: [`runtime:${sessionId}`],
    environmentRevision,
  };
  const transitionId = await createPendingRuntimeStartTransition(transitionInput);
  if (options.accepted !== false) {
    await acceptTransitionFixture({
      projectId,
      executionId: actualExecutionId,
      operationId,
      effectBundleId,
    });
  }
  return {
    projectId,
    executionId: actualExecutionId,
    episodeId: episode.episodeId,
    sessionId,
    workerId,
    transitionId,
    operationId,
    effectBundleId,
    environmentRevision,
    sourceRevision,
    beforeObservationId,
    afterObservationId,
    statusObservationId,
    childProcessObservationId,
    taskScope,
    missionHandoff,
    transitionInput,
  };
}

type TransitionFixture = Awaited<ReturnType<typeof transitionFixture>>;

async function insertValidRuntimeStartObservations(
  fixture: TransitionFixture,
  childOverrides: {
    completeness?: "complete" | "partial" | "failed";
    freshness?: "fresh" | "stale" | "unknown";
    environmentFreshness?: "fresh" | "stale" | "unknown";
    value?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const now = new Date();
  const common = {
    projectId: fixture.projectId,
    executionId: fixture.executionId,
    episodeId: fixture.episodeId,
    taskScope: fixture.taskScope,
    environmentRevisionKey: `revision:${fixture.environmentRevision}`,
    provenance: "DIRECT_OBSERVATION" as const,
    sourceVersion: fixture.sourceRevision,
    sourceRefs: [],
    observedAt: now,
    projectRevision: fixture.sourceRevision,
    environmentRevision: fixture.environmentRevision,
    completeness: "complete" as const,
    freshness: "fresh" as const,
    environmentFreshness: "fresh" as const,
    evidenceRefs: [],
    createdAt: now,
  };
  const childBinding = childProcessBindingDigest({
    projectId: fixture.projectId,
    sessionId: fixture.sessionId,
    executionId: fixture.executionId,
    executionAttempt: 0,
    episodeId: fixture.episodeId,
    operationId: fixture.operationId,
    revision: fixture.sourceRevision,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.beforeObservationId,
    kind: "direct_observation",
    observationRole: "runtime.before_state",
    sourceType: "direct_observation",
    sourceId: fixture.beforeObservationId,
    subject: `runtime:${fixture.projectId}`,
    predicate: "runtime.before_state",
    value: {
      status: "observed",
      runtimeStatus: "stopped",
      inventoryComplete: true,
      unknownListenerPorts: [],
      sessionId: null,
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      environmentRevision: fixture.environmentRevision,
      observedAt: now.toISOString(),
    },
    valueHash: "1".repeat(64),
    sequence: 0,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.afterObservationId,
    kind: "direct_observation",
    observationRole: "runtime.after_state",
    sourceType: "direct_observation",
    sourceId: fixture.afterObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.after_state",
    value: {
      status: "passed",
      runtimeStatus: "running",
      projectId: fixture.projectId,
      revision: fixture.sourceRevision,
      sessionId: fixture.sessionId,
      environmentRevision: fixture.environmentRevision,
      processAlive: true,
      portReady: true,
      pid: 4321,
      port: 3000,
      observedAt: now.toISOString(),
    },
    valueHash: "2".repeat(64),
    sequence: 1,
  });
  await db.insert(aiAgentObservationsTable).values({
    ...common,
    id: fixture.statusObservationId,
    kind: "direct_observation",
    observationRole: "runtime.status",
    sourceType: "direct_observation",
    sourceId: fixture.statusObservationId,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.status",
    value: "running",
    valueHash: "3".repeat(64),
    sequence: 2,
  });
  const childProcessObservation: typeof aiAgentObservationsTable.$inferInsert = {
    ...common,
    id: fixture.childProcessObservationId,
    kind: "child_process_attestation",
    observationRole: "runtime.child_process_environment",
    sourceType: "child_process_attestation",
    sourceId: `runtime-child-process:${fixture.sessionId}`,
    subject: `runtime:${fixture.sessionId}`,
    predicate: "runtime.child_process_environment",
    value: {
      status: "known",
      reasonCode: "child_process_observed",
      sessionId: fixture.sessionId,
      operationId: fixture.operationId,
      bindingDigest: childBinding,
      attestationDigest: "4".repeat(64),
      processEnvironmentDigest: "5".repeat(64),
      ...childOverrides.value,
    },
    valueHash: "6".repeat(64),
    sequence: 3,
    completeness: childOverrides.completeness ?? common.completeness,
    freshness: childOverrides.freshness ?? common.freshness,
    environmentFreshness: childOverrides.environmentFreshness ?? common.environmentFreshness,
  };
  await db.insert(aiAgentObservationsTable).values(childProcessObservation);
}

describe("runtime.start transition retry scheduling", () => {
  it("requires a Mission Goal and fences apply transition idempotency", async () => {
    const fixture = await transitionFixture({ accepted: false });
    const now = new Date();
    const messageId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const reportGoalId = crypto.randomUUID();
    const planRevision = "f".repeat(64);
    const baseRevision = fixture.sourceRevision;
    const rootPath = path.join(
      process.cwd(),
      ".runtime-start-transition-test",
      fixture.projectId,
    );
    await mkdir(path.join(rootPath, "src"), { recursive: true });
    const promotedFile = path.join(rootPath, "src", "target.ts");
    await writeFile(promotedFile, "export const value = 'before';\n", "utf8");
    const baseTreeHash = await hashDeliveryTree(rootPath);
    await writeFile(promotedFile, "export const value = 'after';\n", "utf8");
    const candidateTreeHash = await hashDeliveryTree(rootPath);
    createdWorkspaceRoots.push(rootPath);
    const changeSetHash = "d".repeat(64);
    const beforeObservationId = crypto.randomUUID();
    const afterObservationId = crypto.randomUUID();
    const requirement = {
      kind: "apply.changes",
      version: 1,
      sourceStepId: "apply-changes",
      proposalId,
      baseRevision,
      candidateTreeHash,
      changeSetHash,
      from: "candidate",
      to: "applied",
    };
    const plan = {
      hash: planRevision,
      applyRequirement: requirement,
      steps: [
        { id: "apply-changes", dependencies: [] },
        { id: "report-applied", dependencies: ["apply-changes"] },
      ],
    };
    await db.insert(aiChatMessagesTable).values({
      id: messageId, sessionId: (await db.select({ id: aiChatSessionsTable.id })
        .from(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId)).limit(1))[0]!.id,
      role: "user", content: "apply", createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId, projectId: fixture.projectId,
      sessionId: (await db.select({ id: aiChatSessionsTable.id })
        .from(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, fixture.projectId)).limit(1))[0]!.id,
      messageId,
      changes: "[]",
      status: "applied",
      lifecycle: "applied",
      baseRevision,
      baseTreeHash,
      candidateTreeHash,
      promotedTreeHash: candidateTreeHash,
      changeSetHash,
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId, projectId: fixture.projectId,
      userId: `runtime-transition-test:${fixture.projectId}`,
      title: "Apply transition", intent: "apply", status: "waiting",
      scope: { kind: "project", projectId: fixture.projectId },
      autonomyPolicy: {
        activePlanRevision: planRevision,
        applyMission: { proposalId, requirement },
      },
      createdAt: now, updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId, missionId, projectId: fixture.projectId, title: "Apply",
      status: "waiting_for_event", blockedReason: "apply_changes_pending",
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      successCriteria: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        planRevision: plan,
      },
      outcomeContract: {
        stepId: "apply-changes",
        applyRequirement: requirement,
        candidateIdentity: `${proposalId}:${candidateTreeHash}`,
        planRevision: plan,
      },
      createdAt: now, updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: reportGoalId,
      missionId,
      projectId: fixture.projectId,
      title: "Report applied changes",
      status: "blocked",
      nextAction: { kind: "wait", reason: "event", wakeAt: null },
      successCriteria: { stepId: "report-applied", planRevision: { hash: planRevision } },
      outcomeContract: { planRevision: { hash: planRevision } },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalDependenciesTable).values({
      id: crypto.randomUUID(),
      missionId,
      projectId: fixture.projectId,
      goalId: reportGoalId,
      dependsOnGoalId: goalId,
      planRevision,
      createdAt: now,
    });
    await db.update(aiExecutionsTable).set({ goalId, proposalId })
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    await db.update(aiAgentEpisodesTable).set({ missionId, goalId, planRevision })
      .where(eq(aiAgentEpisodesTable.id, fixture.episodeId));
    await db.insert(aiAgentObservationsTable).values({
        id: beforeObservationId,
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        episodeId: fixture.episodeId,
        kind: "direct_observation",
        observationRole: "workspace.tree_hash",
        sourceType: "direct_observation",
        sourceId: beforeObservationId,
        subject: `project:${fixture.projectId}`,
        predicate: "workspace.tree_hash",
        value: baseTreeHash,
        valueHash: "1".repeat(64),
        sequence: 0,
        taskScope: "project",
        environmentRevisionKey: `revision:${fixture.environmentRevision}`,
        provenance: "DIRECT_OBSERVATION",
        sourceVersion: baseTreeHash,
        sourceRefs: [],
        observedAt: now,
        projectRevision: baseTreeHash,
        environmentRevision: fixture.environmentRevision,
        completeness: "complete",
        freshness: "fresh",
        environmentFreshness: "fresh",
        evidenceRefs: ["apply-proof"],
        createdAt: now,
      });
    await db.insert(aiAgentObservationsTable).values({
        id: afterObservationId,
        projectId: fixture.projectId,
        executionId: fixture.executionId,
        episodeId: fixture.episodeId,
        kind: "direct_observation",
        observationRole: "workspace.tree_hash",
        sourceType: "direct_observation",
        sourceId: afterObservationId,
        subject: `project:${fixture.projectId}`,
        predicate: "workspace.tree_hash",
        value: candidateTreeHash,
        valueHash: "2".repeat(64),
        sequence: 1,
        taskScope: "project",
        environmentRevisionKey: `revision:${fixture.environmentRevision}`,
        provenance: "DIRECT_OBSERVATION",
        sourceVersion: candidateTreeHash,
        sourceRefs: [],
        observedAt: now,
        projectRevision: candidateTreeHash,
        environmentRevision: fixture.environmentRevision,
        completeness: "complete",
        freshness: "fresh",
        environmentFreshness: "fresh",
        evidenceRefs: ["apply-proof"],
        createdAt: now,
      });
    const input = {
      projectId: fixture.projectId, executionId: fixture.executionId, attempt: 0,
      episodeId: fixture.episodeId, actionId: `apply:${fixture.transitionInput.actionId}`,
      effectBundleId: fixture.effectBundleId, proposalId, goalId, planRevision,
      workerId: fixture.workerId, parentWorldRevision: fixture.transitionInput.parentWorldRevision,
      parentFactRefs: [], beforeObservationIds: [beforeObservationId], afterObservationIds: [afterObservationId],
      evidenceRefs: ["apply-proof"], environmentRevision: fixture.environmentRevision,
      promotedTreeHash: candidateTreeHash,
    };
    const id = await createPendingApplyChangesTransition(input);
    expect(await createPendingApplyChangesTransition(input)).toBe(id);
    await expect(createPendingApplyChangesTransition({
      ...input, parentFactRefs: ["different"],
    })).rejects.toThrow("apply_transition_idempotency_conflict");
    await expect(createPendingApplyChangesTransition({ ...input, goalId: "" }))
      .rejects.toThrow("apply_transition_goal_required");

    const applyEffect = buildApplyChangeEffectProofExpectation({
      executionId: fixture.executionId,
      attempt: 0,
      proposalId,
      candidateTreeHash,
    });
    const applyEffectId = crypto.randomUUID();
    await db.insert(aiAgentEffectsTable).values({
      id: applyEffectId,
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      episodeId: fixture.episodeId,
      attempt: 0,
      actionId: input.actionId,
      capabilityId: APPLY_CHANGE_CAPABILITY_ID,
      effectContractHash: applyEffect.effectContractHash,
      beforeObservationIds: input.beforeObservationIds,
      afterObservationIds: input.afterObservationIds,
      expectedEffects: applyEffect.contract.expectedStateChanges,
      status: "observed",
      missingEffects: [],
      contradictionRefs: [],
      evidenceRefs: ["apply-effect-proof"],
      createdAt: new Date(),
    });
    await db.update(aiAgentEffectBundlesTable).set({
      effectIds: [applyEffectId],
      effectContractHashes: [applyEffect.effectContractHash],
      verdict: "OBSERVED",
    }).where(eq(aiAgentEffectBundlesTable.id, fixture.effectBundleId));

    await acceptTransitionFixture({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      operationId: fixture.operationId,
      effectBundleId: fixture.effectBundleId,
    });
    const finalizeInput = {
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: input.actionId,
      effectBundleId: fixture.effectBundleId,
    };
    const concurrentFinalizations = await Promise.all([
      finalizeApplyChangesTransition(finalizeInput),
      finalizeApplyChangesTransition(finalizeInput),
    ]);
    expect(concurrentFinalizations.every((result) =>
      result.status === "materialized" || result.status === "pending",
    )).toBe(true);
    const finalized = concurrentFinalizations.find((result) => result.status === "materialized");
    if (!finalized) throw new Error("apply transition was not materialized by either concurrent owner");
    expect(finalized.status).toBe("materialized");
    const [materializedTransition] = await db.select({
      changedFactRefs: aiWorldTransitionsTable.changedFactRefs,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, id));
    const materializedFacts = await db.select({
      id: aiWorldFactsTable.id,
      sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
    }).from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    const transitionObservationIds = new Set<string>([beforeObservationId, afterObservationId]);
    const expectedChangedFactRefs = materializedFacts
      .filter((fact) => Array.isArray(fact.sourceObservationIds)
        && fact.sourceObservationIds.some((observationId: unknown) => (
          typeof observationId === "string" && transitionObservationIds.has(observationId)
        )))
      .map((fact) => fact.id)
      .sort((left, right) => left.localeCompare(right));
    const actualChangedFactRefs = Array.isArray(materializedTransition?.changedFactRefs)
      ? materializedTransition.changedFactRefs
        .filter((factRef): factRef is string => typeof factRef === "string")
        .sort((left, right) => left.localeCompare(right))
      : [];
    expect(expectedChangedFactRefs.length).toBeGreaterThan(0);
    expect(actualChangedFactRefs).toEqual(expectedChangedFactRefs);
    expect(materializedFacts.some((fact) =>
      Array.isArray(fact.sourceObservationIds)
      && fact.sourceObservationIds.includes(afterObservationId)
      && actualChangedFactRefs.includes(fact.id)
    )).toBe(true);

    const [mission] = await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, missionId));
    const [goal] = await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
    const criteria = goal?.successCriteria as {
      planRevision?: { steps?: Array<{ id?: string; dependencies?: string[] }> };
    };
    const outcome = goal?.outcomeContract as { candidateIdentity?: string };
    expect(criteria.planRevision?.steps).toHaveLength(2);
    expect(criteria.planRevision?.steps?.map((step) => step.id).sort())
      .toEqual(["apply-changes", "report-applied"]);
    expect(criteria.planRevision?.steps?.find((step) => step.id === "report-applied")?.dependencies)
      .toContain("apply-changes");
    expect(GoalNextActionSchema.safeParse(goal?.nextAction).success).toBe(true);
    expect(outcome.candidateIdentity).toBe(`${proposalId}:${candidateTreeHash}`);
    const evaluation = await db.transaction((tx) => evaluateApplyChangesD2(tx, {
      goal: goal!,
      mission: mission!,
      activePlanRevision: planRevision,
    }));
    expect(evaluation, `D2 fixture: ${JSON.stringify({
      evaluation,
      successCriteria: goal?.successCriteria,
      outcomeContract: goal?.outcomeContract,
      nextAction: goal?.nextAction,
      autonomyPolicy: mission?.autonomyPolicy,
    })}`).toMatchObject({
      state: "proven",
      executionId: fixture.executionId,
      transitionId: id,
      effectBundleId: fixture.effectBundleId,
      requirement,
      planRevision,
      candidateIdentity: `${proposalId}:${candidateTreeHash}`,
    });

    const factsBeforeRetry = await db.select({ id: aiWorldFactsTable.id })
      .from(aiWorldFactsTable).where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    await expect(finalizeApplyChangesTransition(finalizeInput)).resolves.toMatchObject({
      status: "materialized",
      worldRevision: finalized.worldRevision,
    });
    const factsAfterRetry = await db.select({ id: aiWorldFactsTable.id })
      .from(aiWorldFactsTable).where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    expect(factsAfterRetry).toEqual(factsBeforeRetry);
  });

  it("leaves an active transition pending without consuming retries before acceptance", async () => {
    const fixture = await transitionFixture({ accepted: false });

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      retryCount: aiWorldTransitionsTable.retryCount,
      failureCode: aiWorldTransitionsTable.failureCode,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "pending",
      retryCount: 0,
      failureCode: null,
      nextRetryAt: null,
    });
  });

  it("fails explicitly when execution ends without a successful acceptance", async () => {
    const fixture = await transitionFixture({ accepted: false });
    const now = new Date();
    await db.update(aiExecutionsTable)
      .set({ status: "failed", completedAt: now, updatedAt: now })
      .where(eq(aiExecutionsTable.id, fixture.executionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_acceptance_missing",
      retryCount: 0,
      nextRetryAt: null,
    });
  });

  it("fails closed when acceptance is not bound to the transition EffectBundle", async () => {
    const fixture = await transitionFixture();
    await db.update(aiExecutionAcceptancesTable)
      .set({ effectBundleId: null })
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_acceptance_effect_bundle_mismatch",
      retryCount: 0,
    });
  });

  it("resumes transition processing after the active execution is accepted", async () => {
    const fixture = await transitionFixture({ accepted: false });
    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    await acceptTransitionFixture(fixture);

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    // The fixture intentionally lacks direct before/after observation rows;
    // reaching this failure proves the accepted transition passed the wait gate.
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "runtime_start_transition_observations_incomplete",
    });
  });

  it("returns the same transition for an identical retry", async () => {
    const fixture = await transitionFixture({ accepted: false });

    await expect(createPendingRuntimeStartTransition(fixture.transitionInput))
      .resolves.toBe(fixture.transitionId);
  });

  it.each([
    ["environmentRevision", { environmentRevision: `env-v1:${"e".repeat(64)}` }],
    ["parentFactRefs", { parentFactRefs: ["fact:different"] }],
    ["evidenceRefs", { evidenceRefs: ["evidence:different"] }],
  ] as const)("rejects an idempotency retry with changed %s", async (_field, changed) => {
    const fixture = await transitionFixture({ accepted: false });

    await expect(createPendingRuntimeStartTransition({
      ...fixture.transitionInput,
      ...changed,
    })).rejects.toThrow("runtime_start_transition_idempotency_conflict");
  });

  it("does not claim a pending transition before its backoff is due", async () => {
    const fixture = await transitionFixture();
    const nextRetryAt = new Date(Date.now() + 60_000);
    await db.update(aiWorldTransitionsTable)
      .set({ status: "retrying", nextRetryAt, retryCount: 1 })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(await retryPendingRuntimeStartTransitions()).toBe(0);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      retryCount: aiWorldTransitionsTable.retryCount,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "retrying",
      retryCount: 1,
      nextRetryAt,
    });
  });

  it("serializes concurrent runtime.start claims and D2 successor dispatch", async () => {
    const fixture = await transitionFixture({ missionHandoff: true });
    const mission = fixture.missionHandoff;
    if (!mission) throw new Error("Mission handoff fixture was not created.");
    await insertValidRuntimeStartObservations(fixture);
    const materializer = vi.spyOn(worldStateModule, "materializeWorldStateForProject");
    const finalizeInput = {
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    };

    const finalizations = await Promise.all([
      finalizeRuntimeStartTransition(finalizeInput),
      finalizeRuntimeStartTransition(finalizeInput),
    ]);
    expect(finalizations.every((result) =>
      result.status === "materialized" || result.status === "pending",
    )).toBe(true);
    expect(finalizations.some((result) => result.status === "materialized")).toBe(true);
    expect(materializer).toHaveBeenCalledTimes(1);

    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition?.status).toBe("materialized");

    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);
    const wakeCounts = await Promise.all([
      wakeRuntimeTransitionMissionGoals(),
      wakeRuntimeTransitionMissionGoals(),
    ]);
    expect(wakeCounts.reduce((total, count) => total + count, 0)).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const dispatches = await db.select({
      id: eventsTable.id,
    }).from(eventsTable).where(and(
      eq(eventsTable.projectId, fixture.projectId),
      eq(eventsTable.goalId, mission.targetGoalId),
      eq(eventsTable.type, "AiGoalRecipeDispatchRequested"),
    ));
    expect(dispatches).toHaveLength(1);
  });

  it("keeps Gate C acceptance when due transition projection fails", async () => {
    const fixture = await transitionFixture();
    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);

    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(and(
        eq(aiWorldTransitionsTable.id, fixture.transitionId),
        eq(aiWorldTransitionsTable.executionId, fixture.executionId),
      ));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      retryCount: 0,
    });
    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: expect.any(String),
    });
  });

  it("recovers a transient projection failure without changing Gate C acceptance", async () => {
    const fixture = await transitionFixture();
    await insertValidRuntimeStartObservations(fixture);
    const materializer = vi.spyOn(worldStateModule, "materializeWorldStateForProject")
      .mockRejectedValueOnce(new Error("world_state_materialization_failed"));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [afterFailure] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(afterFailure).toMatchObject({
      status: "retrying",
      failureCode: "world_state_materialization_failed",
      retryCount: 1,
    });
    expect(afterFailure?.nextRetryAt).toBeInstanceOf(Date);

    const [acceptanceAfterFailure] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptanceAfterFailure).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });
    const factsAfterFailure = await db.select({ id: aiWorldFactsTable.id })
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    expect(factsAfterFailure).toHaveLength(0);

    await db.update(aiWorldTransitionsTable)
      .set({ nextRetryAt: new Date(Date.now() - 1_000) })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    materializer.mockRestore();

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [recovered] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
      resultingWorldRevision: aiWorldTransitionsTable.resultingWorldRevision,
      materializedObservationIds: aiWorldTransitionsTable.materializedObservationIds,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(recovered).toMatchObject({
      status: "materialized",
      failureCode: null,
      retryCount: 1,
      materializedObservationIds: [
        fixture.beforeObservationId,
        fixture.afterObservationId,
        fixture.statusObservationId,
        fixture.childProcessObservationId,
      ],
    });
    expect(recovered?.resultingWorldRevision).toMatch(/^[a-f0-9]{64}$/);

    const [acceptanceAfterRecovery] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptanceAfterRecovery).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });

    const factsAfterRecovery = await db.select({ id: aiWorldFactsTable.id })
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    expect(await retryPendingRuntimeStartTransitions(1)).toBe(0);
    const factsAfterDuplicateScan = await db.select({ id: aiWorldFactsTable.id })
      .from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    expect(factsAfterDuplicateScan).toEqual(factsAfterRecovery);
  });

  it("dispatches one Mission successor only after the exact runtime.start transition materializes", async () => {
    const fixture = await transitionFixture({ missionHandoff: true });
    const mission = fixture.missionHandoff;
    if (!mission) throw new Error("Mission handoff fixture was not created.");
    expect(fixture.taskScope).toMatch(/^scope:[a-f0-9]{64}$/);
    await insertValidRuntimeStartObservations(fixture);
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);

    const finalized = await finalizeRuntimeStartTransition({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    });
    expect(finalized.status).toBe("materialized");

    const [transition] = await db.select().from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "materialized",
      effectBundleId: fixture.effectBundleId,
      taskScope: fixture.taskScope,
      parentWorldRevision: fixture.transitionInput.parentWorldRevision,
      resultingWorldRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      beforeObservationIds: [fixture.beforeObservationId],
      afterObservationIds: [
        fixture.afterObservationId,
        fixture.statusObservationId,
        fixture.childProcessObservationId,
      ],
    });
    const runtimeTransitionObservationIds = new Set<string>([
      fixture.beforeObservationId,
      fixture.afterObservationId,
      fixture.statusObservationId,
      fixture.childProcessObservationId,
    ]);
    const runtimeTransitionFacts = await db.select({
      id: aiWorldFactsTable.id,
      subject: aiWorldFactsTable.subject,
      predicate: aiWorldFactsTable.predicate,
      sourceObservationIds: aiWorldFactsTable.sourceObservationIds,
    }).from(aiWorldFactsTable)
      .where(eq(aiWorldFactsTable.projectId, fixture.projectId));
    const expectedRuntimeChangedFactRefs = runtimeTransitionFacts
      .filter((fact) => Array.isArray(fact.sourceObservationIds)
        && fact.sourceObservationIds.some((observationId: unknown) => (
          typeof observationId === "string"
          && runtimeTransitionObservationIds.has(observationId)
        )))
      .map((fact) => fact.id)
      .sort((left, right) => left.localeCompare(right));
    const actualRuntimeChangedFactRefs = Array.isArray(transition?.changedFactRefs)
      ? transition.changedFactRefs
        .filter((factRef): factRef is string => typeof factRef === "string")
        .sort((left, right) => left.localeCompare(right))
      : [];
    expect(expectedRuntimeChangedFactRefs.length).toBeGreaterThan(0);
    expect(actualRuntimeChangedFactRefs).toEqual(expectedRuntimeChangedFactRefs);
    expect(runtimeTransitionFacts.some((fact) =>
      fact.subject.startsWith("runtime:")
      && fact.predicate === "runtime.status"
      && Array.isArray(fact.sourceObservationIds)
      && fact.sourceObservationIds.includes(fixture.statusObservationId)
      && actualRuntimeChangedFactRefs.includes(fact.id)
    )).toBe(true);

    const woken = await wakeRuntimeTransitionMissionGoals();
    const [targetAfterWake] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, mission.targetGoalId));
    expect(woken).toBe(1);
    expect(targetAfterWake).toMatchObject({
      status: "running",
      blockedReason: null,
    });
    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);

    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    const targetDispatches = dispatches.filter((event) =>
      event.type === "AiGoalRecipeDispatchRequested"
      && event.goalId === mission.targetGoalId,
    );
    expect(targetDispatches).toHaveLength(1);
    expect(targetDispatches[0]?.payload).toMatchObject({
      transitionProof: {
        transitionId: fixture.transitionId,
        executionId: fixture.executionId,
        attempt: 0,
        episodeId: fixture.episodeId,
        actionId: fixture.transitionInput.actionId,
        effectBundleId: fixture.effectBundleId,
        parentWorldRevision: fixture.transitionInput.parentWorldRevision,
        resultingWorldRevision: transition?.resultingWorldRevision,
        projectRevision: fixture.sourceRevision,
        environmentRevision: fixture.environmentRevision,
        beforeObservationIds: [fixture.beforeObservationId],
        afterObservationIds: [
          fixture.afterObservationId,
          fixture.statusObservationId,
          fixture.childProcessObservationId,
        ],
        sourceStepId: "runtime-start",
        targetStepId: "target-step",
        activePlanHash: mission.planRevision,
      },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("blocks the Mission successor when transition scope differs from its source Episode", async () => {
    const fixture = await transitionFixture({ missionHandoff: true });
    const mission = fixture.missionHandoff;
    if (!mission) throw new Error("Mission handoff fixture was not created.");
    await insertValidRuntimeStartObservations(fixture);
    const finalized = await finalizeRuntimeStartTransition({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    });
    expect(finalized.status).toBe("materialized");
    await db.update(aiWorldTransitionsTable)
      .set({ taskScope: "project" })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const [target] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, mission.targetGoalId));
    expect(target).toEqual({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
    });
    const targetDispatches = await db.select({ id: eventsTable.id })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, fixture.projectId),
        eq(eventsTable.goalId, mission.targetGoalId),
        eq(eventsTable.type, "AiGoalRecipeDispatchRequested"),
      ));
    expect(targetDispatches).toHaveLength(0);
  });

  const invalidChildEvidenceScenarios: Array<{
    label: string;
    expectedFailure: string;
    omitChildReference?: boolean;
    childOverrides?: NonNullable<Parameters<typeof insertValidRuntimeStartObservations>[1]>;
  }> = [
    {
      label: "missing from the transition's linked evidence",
      expectedFailure: "runtime_start_transition_child_process_attestation_missing",
      omitChildReference: true,
    },
    {
      label: "incomplete",
      expectedFailure: "runtime_start_transition_observations_incomplete",
      childOverrides: { completeness: "partial" },
    },
    {
      label: "stale",
      expectedFailure: "runtime_start_transition_observations_incomplete",
      childOverrides: { freshness: "stale", environmentFreshness: "stale" },
    },
    {
      label: "unknown",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { status: "unknown", reasonCode: "child_process_unknown" } },
    },
    {
      label: "bound to a different runtime session",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { sessionId: "other-runtime-session" } },
    },
    {
      label: "with a mismatched binding digest",
      expectedFailure: "runtime_start_transition_child_process_attestation_unproven",
      childOverrides: { value: { bindingDigest: "f".repeat(64) } },
    },
  ];
  it.each(invalidChildEvidenceScenarios)("blocks World Delta when child-process evidence is $label", async (scenario) => {
    const fixture = await transitionFixture({ missionHandoff: true });
    const mission = fixture.missionHandoff;
    if (!mission) throw new Error("Mission handoff fixture was not created.");
    const parent = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    const enqueue = vi.spyOn(heavyJobQueue, "enqueueWithId").mockReturnValue(true);
    await insertValidRuntimeStartObservations(fixture, scenario.childOverrides);
    if (scenario.omitChildReference) {
      await db.update(aiWorldTransitionsTable)
        .set({
          afterObservationIds: [
            fixture.afterObservationId,
            fixture.statusObservationId,
          ],
        })
        .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    }

    const result = await finalizeRuntimeStartTransition({
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      attempt: 0,
      episodeId: fixture.episodeId,
      actionId: fixture.transitionInput.actionId,
      effectBundleId: fixture.effectBundleId,
    });
    expect(result).toMatchObject({
      status: "terminal_failed",
      failureCode: scenario.expectedFailure,
    });

    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      retryCount: aiWorldTransitionsTable.retryCount,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: scenario.expectedFailure,
      retryCount: 0,
    });

    const [acceptance] = await db.select({
      outcome: aiExecutionAcceptancesTable.outcome,
      effectBundleId: aiExecutionAcceptancesTable.effectBundleId,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
    expect(acceptance).toMatchObject({
      outcome: "SUCCEEDED",
      effectBundleId: fixture.effectBundleId,
    });

    const after = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    expect(after.worldRevision).toBe(parent.worldRevision);
    expect(after.facts).toEqual(parent.facts);

    expect(await wakeRuntimeTransitionMissionGoals()).toBe(0);
    const dispatches = await db.select({
      type: eventsTable.type,
      goalId: eventsTable.goalId,
    }).from(eventsTable).where(eq(eventsTable.projectId, fixture.projectId));
    expect(dispatches.some((event) =>
      event.type === "AiGoalRecipeDispatchRequested"
      && event.goalId === mission.targetGoalId,
    )).toBe(false);
    const [target] = await db.select({
      status: aiGoalsTable.status,
      blockedReason: aiGoalsTable.blockedReason,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, mission.targetGoalId));
    expect(target).toMatchObject({
      status: "needs_replan",
      blockedReason: "runtime_start_transition_unproven",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("terminalizes due retry-exhausted work without attempting projection", async () => {
    const fixture = await transitionFixture();
    await db.update(aiWorldTransitionsTable)
      .set({ status: "retrying", retryCount: 8, nextRetryAt: new Date(Date.now() - 1_000) })
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));

    expect(await retryPendingRuntimeStartTransitions(1)).toBe(1);
    const [transition] = await db.select({
      status: aiWorldTransitionsTable.status,
      failureCode: aiWorldTransitionsTable.failureCode,
      nextRetryAt: aiWorldTransitionsTable.nextRetryAt,
    }).from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, fixture.transitionId));
    expect(transition).toMatchObject({
      status: "terminal_failed",
      failureCode: "world_state_materialization_retry_exhausted",
      nextRetryAt: null,
    });
  });

  it("rolls back World State facts if the transition commit fails in the same transaction", async () => {
    const fixture = await transitionFixture();
    const observationId = crypto.randomUUID();
    const environmentRevision = `env-v1:${"c".repeat(64)}`;
    const projectRevision = "a".repeat(64);
    const now = new Date();
    await db.insert(aiAgentObservationsTable).values({
      id: observationId,
      projectId: fixture.projectId,
      executionId: fixture.executionId,
      episodeId: fixture.episodeId,
      taskScope: "project",
      environmentRevisionKey: `revision:${environmentRevision}`,
      kind: "direct_observation",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "runtime.test",
      sourceType: "direct_observation",
      sourceId: observationId,
      sourceVersion: projectRevision,
      subject: `runtime:${fixture.projectId}`,
      predicate: "runtime.test_state",
      value: { status: "observed" },
      valueHash: "d".repeat(64),
      sourceRefs: [],
      observedAt: now,
      projectRevision,
      environmentRevision,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [],
      sequence: 1,
      createdAt: now,
    });
    const parent = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });

    await expect(materializeWorldStateForProject(fixture.projectId, {
      observationIds: [observationId],
      expectedWorldRevision: parent.worldRevision,
      expectedRevisionExcludeEpisodeIds: [fixture.episodeId],
    }, async () => {
      throw new Error("transition_commit_test_failure");
    })).rejects.toThrow("transition_commit_test_failure");

    const after = await getProjectWorldState(fixture.projectId, {
      excludeEpisodeIds: [fixture.episodeId],
    });
    expect(after.worldRevision).toBe(parent.worldRevision);
    expect(after.facts).toHaveLength(0);
  });

  it("rebinds a resumed GitHub delivery attempt without replacing its direct before-state", async () => {
    const projectId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const userId = `github-delivery-transition-test:${projectId}`;
    const now = new Date();
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: userId,
      name: "GitHub delivery transition retry test",
      rootPath: `${process.cwd()}/.github-delivery-transition-test/${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    createdProjects.push(projectId);
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "GitHub delivery transition retry test",
      createdAt: now,
      updatedAt: now,
    });
    const created = await createAiExecution({
      userId,
      projectId,
      sessionId,
      idempotencyKey: `${operationId}:github-delivery-transition-retry`,
      request: {
        projectId,
        operationId,
        sessionId,
        message: "Retry GitHub delivery transition",
        modelMessage: "Retry GitHub delivery transition",
        workspaceRevision: "a".repeat(64),
        validationTargetPaths: [],
      },
    });
    const executionId = created.execution.id;
    createdExecutionIds.push(executionId);
    const firstWorkerId = `github-delivery-transition-worker-a:${projectId}`;
    const firstClaim = await claimAiExecution({
      executionId,
      userId,
      workerId: firstWorkerId,
    });
    expect(firstClaim?.attempt).toBe(0);
    const firstEpisode = await startEpisode({
      projectId,
      executionId,
      attempt: 0,
      workerId: firstWorkerId,
      idempotencyKey: `${operationId}:github-delivery-episode:0`,
      projectRevision: "a".repeat(64),
      intentKind: "RUNTIME_START",
      scope: { kind: "project", paths: [] },
    });
    const parent = await getProjectWorldState(projectId, {
      excludeEpisodeIds: [firstEpisode.episodeId],
    });
    const beforeObservationId = crypto.randomUUID();
    const transitionId = await createPendingGitHubDeliveryTransition({
      projectId,
      executionId,
      attempt: 0,
      episodeId: firstEpisode.episodeId,
      actionId: `github-delivery-action:${operationId}`,
      workerId: firstWorkerId,
      operationId,
      proposalId,
      remoteUrl: "https://github.com/example/project.git",
      branch: "main",
      parentWorldRevision: parent.worldRevision,
      parentFactRefs: parent.currentFacts.map((fact) => fact.id),
      taskScope: "project",
      beforeObservationIds: [beforeObservationId],
    });

    await db.update(aiExecutionsTable).set({
      status: "paused",
      workerId: null,
      leaseUntil: null,
      updatedAt: new Date(),
    }).where(eq(aiExecutionsTable.id, executionId));
    const recovery = await recoverAiExecutionResumeToken({
      executionId,
      userId,
      expectedAttempt: 0,
    });
    expect(recovery).toBeDefined();
    const secondWorkerId = `github-delivery-transition-worker-b:${projectId}`;
    const secondClaim = await claimAiExecution({
      executionId,
      userId,
      workerId: secondWorkerId,
      resumeToken: recovery!.resumeToken,
    });
    expect(secondClaim?.attempt).toBe(1);
    const secondEpisode = await startEpisode({
      projectId,
      executionId,
      attempt: 1,
      workerId: secondWorkerId,
      idempotencyKey: `${operationId}:github-delivery-episode:1`,
      projectRevision: "a".repeat(64),
      intentKind: "RUNTIME_START",
      scope: { kind: "project", paths: [] },
    });
    const afterObservationId = crypto.randomUUID();
    const effectBundleId = `github-delivery-effect:${operationId}:attempt-1`;
    await db.insert(aiAgentEffectBundlesTable).values({
      id: effectBundleId,
      projectId,
      executionId,
      attempt: 1,
      episodeId: secondEpisode.episodeId,
      effectIds: [],
      effectContractHashes: [],
      verdict: "OBSERVED",
    });
    await expect(bindGitHubDeliveryTransitionEffect({
      projectId,
      executionId,
      attempt: 1,
      episodeId: secondEpisode.episodeId,
      actionId: `github-delivery-action:${operationId}`,
      effectBundleId,
      workerId: secondWorkerId,
      operationId,
      afterObservationIds: [afterObservationId],
    })).resolves.toBe(transitionId);

    const [transition] = await db.select().from(aiWorldTransitionsTable)
      .where(eq(aiWorldTransitionsTable.id, transitionId)).limit(1);
    expect(transition).toMatchObject({
      attempt: 1,
      episodeId: secondEpisode.episodeId,
      actionId: `github-delivery-action:${operationId}`,
      effectBundleId,
      beforeObservationIds: [beforeObservationId],
      afterObservationIds: [afterObservationId],
      status: "pending",
    });
  });
});