import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import app from "../../app.js";
import {
  aiChangeProposalsTable,
  aiGoalDependenciesTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiMissionHandoffsTable,
  aiShadowReplaysTable,
  aiGoalsTable,
  aiMissionsTable,
  aiSkillRegistryTable,
  db,
  eventsTable,
  projectPluginBindingsTable,
  projectsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { waitForScheduledAiTaskExecutions } from "./tasks.js";
import {
  deriveProofGatedMissionStatus,
  runMissionGoal,
  wakeReadyMissionGoals,
} from "../../lib/mission-runtime.js";
import { dispatchPendingMissionChatHandoffs } from "../../lib/mission-chat-handoffs.js";
import { seedCanonicalMissionGoalCompletion } from "../../__tests__/mission-dependency-proof-fixture.js";
import { buildExecutionProofProjection } from "../../lib/execution-proof.js";
import { loadCanonicalProof } from "../../lib/proof-foundation.js";
import {
  createDeliveryWorkspace,
  DELIVERY_TREE_DIGEST_VERSION,
  hashDeliveryTree,
} from "../../lib/delivery-workspace.js";
import { createValidationWorkspace } from "../../lib/ai-repair-validation.js";
import {
  createAiExecution,
  reconcileAiExecutions,
} from "../../lib/ai-execution-state.js";
import { finalizeExecutionAcceptance } from "../../lib/ai-execution-acceptance.js";
import { requireActiveSkillRegistry } from "../../lib/skill-registry.js";
import {
  buildProjectQueryObjective,
  resolveProjectQueryTarget,
} from "@workspace/ai-orchestrator";
import { prepareRecipeOperation } from "../../lib/recipe-operation-runner.js";
import { runShadowReplayAttempt } from "../../lib/shadow-replay.js";
import { buildTaskObjectiveContract } from "../../lib/task-objective-contract.js";

const projectIds: string[] = [];
const shadowWorkspaceRoots: string[] = [];
const shadowSourceRoots: string[] = [];

async function insertProject(ownerId = "test-user") {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: `mission-test-${id.slice(0, 8)}`,
    rootPath: `/tmp/mission-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(id);
  return id;
}

async function insertAcceptedProjectQuery(projectId: string) {
  const userId = "test-user";
  const sessionId = randomUUID();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const operationId = randomUUID();
  const sourceRevision = "a".repeat(40);
  const workspaceRoot = `/tmp/mission-test-${projectId}`;
  const now = new Date();
  const userMessage = "Analyze my project architecture.";
  const target = resolveProjectQueryTarget(userMessage);
  if (!target) throw new Error("Expected the generic PROJECT_QUERY fixture target");
  const objective = buildProjectQueryObjective(
    target,
    userMessage,
  );
  const requiredClaims = objective.requiredClaims;
  const finalMessageContent =
    "The project purpose and entrypoints are supported by source evidence.";
  const finalizationKey = `final-${operationId}`;

  await db.insert(aiChatSessionsTable).values({
    id: sessionId,
    projectId,
    title: "Accepted PROJECT_QUERY fixture",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiChatMessagesTable).values({
    id: userMessageId,
    sessionId,
    role: "user",
    content: userMessage,
    createdAt: now,
  });

  const created = await createAiExecution({
    userId,
    projectId,
    sessionId,
    correlationId: operationId,
    idempotencyKey: `project-query-${operationId}`,
    request: {
      projectId,
      sessionId,
      operationId,
      turnIntent: "PROJECT_QUERY",
      message: userMessage,
      modelMessage: userMessage,
      workspaceRoot,
      workspaceRevision: sourceRevision,
      validationTargetPaths: ["src/index.ts"],
      objective,
      proofRequired: true,
    },
  });
  const executionId = created.execution.id;
  const workerId = `fixture-worker-${operationId}`;

  await db.update(aiChatMessagesTable)
    .set({ executionId })
    .where(eq(aiChatMessagesTable.id, userMessageId));
  await db.insert(aiChatMessagesTable).values({
    id: assistantMessageId,
    sessionId,
    executionId,
    role: "assistant",
    content: finalMessageContent,
    createdAt: new Date(),
  });
  await db.update(aiExecutionsTable).set({
    status: "running",
    workerId,
    leaseUntil: new Date(Date.now() + 60_000),
    lastHeartbeatAt: now,
    startedAt: now,
    updatedAt: now,
    workspaceRoot,
    baseRevision: sourceRevision,
  }).where(eq(aiExecutionsTable.id, executionId));

  const finalized = await finalizeExecutionAcceptance({
    executionId,
    expectedAttempt: created.execution.attempt,
    workerId,
    finalMessageId: assistantMessageId,
    finalMessageContent,
    finalizationKey,
    outcome: "SUCCEEDED",
    terminalStatus: "completed",
    reasonCode: "COMPLETED",
    recoveryState: "NONE",
    resumable: false,
    workspaceRoot,
    acceptedClaimRefs: requiredClaims.map((claim) => claim.claimId),
    evidence: {
      operationId,
      workspaceRoot,
      sourceRevision,
      required: true,
      verdict: "PROVEN",
      reads: [{
        path: "src/index.ts",
        body: "export const projectEntrypoint = true;\n",
        complete: true,
        truncated: false,
      }],
    },
  });
  expect(finalized).toMatchObject({ accepted: true, duplicate: false });
  const [acceptance] = await db
    .select({ id: aiExecutionAcceptancesTable.id, evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, executionId),
      eq(aiExecutionAcceptancesTable.attempt, created.execution.attempt),
    ))
    .limit(1);

  return {
    sessionId,
    userMessageId,
    assistantMessageId,
    executionId,
    attempt: created.execution.attempt,
    workerId,
    operationId,
    workspaceRoot,
    finalMessageContent,
    finalizationKey,
    acceptanceId: acceptance!.id,
    evidenceSnapshotId: acceptance!.evidenceSnapshotId!,
    sourceRevision,
    acceptedClaimRefs: requiredClaims.map((claim) => claim.claimId),
  };
}

afterEach(async () => {
  await waitForScheduledAiTaskExecutions();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
  for (const workspaceRoot of shadowWorkspaceRoots.splice(0)) {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const sourceRoot of shadowSourceRoots.splice(0)) {
    await fs.rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("AI missions and goals", () => {
  it("previews admission and a general plan without creating durable rows", async () => {
    const projectId = await insertProject();
    const beforeMissions = await db
      .select({ id: aiMissionsTable.id })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId));

    const response = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({
        projectId,
        message: "Inspect the source, then fix the blocking issue.",
      });

    expect(response.status).toBe(200);
    expect(response.body.version).toBe(1);
    expect(response.body.admission).toBe("mission");
    expect(response.body.plan.steps.length).toBeGreaterThan(1);

    const afterMissions = await db
      .select({ id: aiMissionsTable.id })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId));
    expect(afterMissions).toEqual(beforeMissions);
  });

  it("requires an explicit chat handoff and reuses the preview plan revision", async () => {
    const projectId = await insertProject();
    const message = "Inspect the source, then fix the blocking issue.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, message });
    expect(preview.status).toBe(200);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        message,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    expect(handoff.body.preview.plan.planHash).toBe(preview.body.plan.planHash);
    expect(handoff.body.mission.status).toBe("active");
    expect(handoff.body.activation.goalId).toBeTruthy();
  });

  it("previews only a server-accepted PROJECT_QUERY source without creating durable work", async () => {
    const projectId = await insertProject();
    const source = await insertAcceptedProjectQuery(projectId);
    const before = {
      missions: await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
        .where(eq(aiMissionsTable.projectId, projectId)),
      goals: await db.select({ id: aiGoalsTable.id }).from(aiGoalsTable)
        .where(eq(aiGoalsTable.projectId, projectId)),
      tasks: await db.select({ id: tasksTable.id }).from(tasksTable)
        .where(eq(tasksTable.projectId, projectId)),
      executions: await db.select({ id: aiExecutionsTable.id }).from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.projectId, projectId)),
    };

    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({
        projectId,
        assistantMessageId: source.assistantMessageId,
        objective: "Investigate and fix the accepted project finding.",
      });

    expect(preview.status).toBe(200);
    expect(preview.body.admission).toBe("mission");
    expect(preview.body.handoffSource).toMatchObject({
      kind: "accepted_project_query",
      sourceRevision: source.sourceRevision,
      acceptedClaimCount: source.acceptedClaimRefs.length,
    });
    expect(preview.body.plan.steps.length).toBeGreaterThan(0);
    expect(await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId))).toEqual(before.missions);
    expect(await db.select({ id: aiGoalsTable.id }).from(aiGoalsTable)
      .where(eq(aiGoalsTable.projectId, projectId))).toEqual(before.goals);
    expect(await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))).toEqual(before.tasks);
    expect(await db.select({ id: aiExecutionsTable.id }).from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.projectId, projectId))).toEqual(before.executions);
  });

  it("requires the reviewed plan hash and stores only server-resolved accepted provenance", async () => {
    const projectId = await insertProject();
    const source = await insertAcceptedProjectQuery(projectId);
    const objective = "Investigate and fix the accepted project finding.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, assistantMessageId: source.assistantMessageId, objective });
    expect(preview.status).toBe(200);

    const staleHandoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        assistantMessageId: source.assistantMessageId,
        objective,
        expectedPlanHash: "stale-plan-hash",
      });
    expect(staleHandoff.status).toBe(409);
    expect(staleHandoff.body.code).toBe("MISSION_PREVIEW_STALE");
    expect(await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId))).toEqual([]);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        assistantMessageId: source.assistantMessageId,
        objective,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    expect(handoff.body.preview.plan.planHash).toBe(preview.body.plan.planHash);
    expect(handoff.body.mission.autonomyPolicy.handoffSource).toMatchObject({
      kind: "chat",
      sourceType: "accepted_project_query",
      sessionId: source.sessionId,
      messageId: source.userMessageId,
      assistantMessageId: source.assistantMessageId,
      executionId: source.executionId,
      acceptanceId: source.acceptanceId,
      evidenceSnapshotId: source.evidenceSnapshotId,
      sourceRevision: source.sourceRevision,
      acceptedClaimRefs: source.acceptedClaimRefs,
      planHash: preview.body.plan.planHash,
    });
    const missionTasks = await db
      .select({ description: tasksTable.description, prompt: tasksTable.prompt })
      .from(tasksTable)
      .where(eq(tasksTable.goalId, handoff.body.activation.goalId));
    const durableMissionContext = missionTasks
      .map((task) => `${task.description}\n${task.prompt}`)
      .join("\n");
    expect(durableMissionContext).toContain(
      "Accepted PROJECT_QUERY context (user-reviewed; not proof or authorization for future changes):",
    );
    expect(durableMissionContext).toContain(
      "The project purpose and entrypoints are supported by source evidence.",
    );
  });

  it("binds handoffs to the exact Chat message and resumes the persisted Agent-control projection", async () => {
    const projectId = await insertProject();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const message = "Inspect the project, implement the requested feature, and validate the result.";
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Mission handoff source",
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "user",
      content: message,
    });

    const idempotencyKey = randomUUID();
    const baseInput = {
      projectId,
      idempotencyKey,
      sessionId,
      messageId,
    };
    const mismatchedSource = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({ ...baseInput, message: `${message} altered` });
    expect(mismatchedSource.status).toBe(409);
    expect(mismatchedSource.body.code).toBe("CHAT_HANDOFF_MESSAGE_MISMATCH");

    const input = { ...baseInput, message };
    const handoff = await request(app).post("/api/ai/missions/from-chat").send(input);
    expect(handoff.status).toBe(201);

    const retry = await request(app).post("/api/ai/missions/from-chat").send(input);
    expect(retry.status).toBe(200);
    expect(retry.body.mission.id).toBe(handoff.body.mission.id);
    const keyConflict = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({ ...input, message: `${message} with a different request` });
    expect(keyConflict.status).toBe(409);
    expect(keyConflict.body.code).toBe("MISSION_HANDOFF_IDEMPOTENCY_CONFLICT");

    const newConfirmation = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({ ...input, idempotencyKey: randomUUID() });
    expect(newConfirmation.status).toBe(201);
    expect(newConfirmation.body.mission.id).not.toBe(handoff.body.mission.id);
    expect(await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId))).toHaveLength(2);

    const projection = await request(app)
      .get(`/api/ai/missions/${handoff.body.mission.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.agentControl.handoff).toMatchObject({
      kind: "chat",
      sessionId,
      messageId,
      assistantMessageId: null,
      planHash: handoff.body.preview.plan.planHash,
      dispatchStatus: "dispatched",
    });

    const [durableHandoff] = await db
      .select({ id: aiMissionHandoffsTable.id })
      .from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.missionId, handoff.body.mission.id));
    await db.update(aiMissionHandoffsTable)
      .set({ dispatchStatus: "pending", dispatchedAt: null })
      .where(eq(aiMissionHandoffsTable.id, durableHandoff.id));
    expect(await dispatchPendingMissionChatHandoffs()).toBeGreaterThanOrEqual(1);
    const [recoveredHandoff] = await db
      .select({ dispatchStatus: aiMissionHandoffsTable.dispatchStatus })
      .from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, durableHandoff.id));
    expect(recoveredHandoff.dispatchStatus).toBe("dispatched");
  });

  it("keeps handoff provenance server-owned across generic Mission writes", async () => {
    const projectId = await insertProject();
    const spoofedCreate = await request(app)
      .post("/api/ai/missions")
      .send({
        projectId,
        title: "Spoofed source",
        intent: "Attempt to provide client-owned provenance.",
        autonomyPolicy: {
          handoffSource: {
            kind: "chat",
            sourceType: "accepted_project_query",
            acceptanceId: "client-acceptance",
          },
        },
      });
    expect(spoofedCreate.status).toBe(400);
    expect(spoofedCreate.body.code).toBe("MISSION_HANDOFF_SOURCE_SERVER_OWNED");

    const source = await insertAcceptedProjectQuery(projectId);
    const objective = "Investigate and fix the accepted project finding.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, assistantMessageId: source.assistantMessageId, objective });
    expect(preview.status).toBe(200);
    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        assistantMessageId: source.assistantMessageId,
        objective,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);

    const attemptedRewrite = await request(app)
      .patch(`/api/ai/missions/${handoff.body.mission.id}`)
      .send({
        autonomyPolicy: {
          userPreference: "preserved",
          handoffSource: {
            kind: "chat",
            sourceType: "accepted_project_query",
            acceptanceId: "client-acceptance",
            assistantMessageId: "client-message",
          },
        },
      });

    expect(attemptedRewrite.status).toBe(200);
    expect(attemptedRewrite.body.autonomyPolicy).toMatchObject({
      userPreference: "preserved",
      handoffSource: {
        acceptanceId: source.acceptanceId,
        assistantMessageId: source.assistantMessageId,
        evidenceSnapshotId: source.evidenceSnapshotId,
        sourceRevision: source.sourceRevision,
        acceptedClaimRefs: source.acceptedClaimRefs,
        planHash: preview.body.plan.planHash,
      },
    });
  });

  it("rejects a recovered assistant row that no longer matches the acceptance message", async () => {
    const projectId = await insertProject();
    const source = await insertAcceptedProjectQuery(projectId);
    const recoveredMessageId = randomUUID();
    await db.insert(aiChatMessagesTable).values({
      id: recoveredMessageId,
      sessionId: source.sessionId,
      executionId: source.executionId,
      role: "assistant",
      content: "A different recovered terminal message.",
      createdAt: new Date(),
    });
    await db.update(aiExecutionsTable)
      .set({ finalMessageId: recoveredMessageId })
      .where(eq(aiExecutionsTable.id, source.executionId));

    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({
        projectId,
        assistantMessageId: source.assistantMessageId,
        objective: "Investigate and fix the accepted project finding.",
      });

    expect(preview.status).toBe(409);
    expect(preview.body.code).toBe("MISSION_SOURCE_NOT_ACCEPTED");
    expect(await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId))).toEqual([]);
  });

  it("replays a committed acceptance without splitting assistant-message identity", async () => {
    const projectId = await insertProject();
    const source = await insertAcceptedProjectQuery(projectId);

    const replay = await finalizeExecutionAcceptance({
      executionId: source.executionId,
      expectedAttempt: source.attempt,
      workerId: source.workerId,
      finalMessageId: source.assistantMessageId,
      finalMessageContent: source.finalMessageContent,
      finalizationKey: source.finalizationKey,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      reasonCode: "COMPLETED",
      recoveryState: "NONE",
      resumable: false,
      workspaceRoot: source.workspaceRoot,
      acceptedClaimRefs: source.acceptedClaimRefs,
      evidence: {
        operationId: source.operationId,
        workspaceRoot: source.workspaceRoot,
        sourceRevision: source.sourceRevision,
        required: true,
        verdict: "PROVEN",
        reads: [{
          path: "src/index.ts",
          body: "export const projectEntrypoint = true;\n",
          complete: true,
          truncated: false,
        }],
      },
    });
    expect(replay).toMatchObject({ accepted: true, duplicate: true });

    const [acceptance] = await db.select()
      .from(aiExecutionAcceptancesTable)
      .where(and(
        eq(aiExecutionAcceptancesTable.executionId, source.executionId),
        eq(aiExecutionAcceptancesTable.attempt, source.attempt),
      ))
      .limit(1);
    const [assistant] = await db.select()
      .from(aiChatMessagesTable)
      .where(eq(aiChatMessagesTable.id, source.assistantMessageId))
      .limit(1);
    const [execution] = await db.select()
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, source.executionId))
      .limit(1);

    expect(acceptance?.id).toBe(source.acceptanceId);
    expect(acceptance?.messageId).toBe(source.assistantMessageId);
    expect(assistant).toMatchObject({
      id: source.assistantMessageId,
      executionId: source.executionId,
      outcome: "SUCCEEDED",
      content: source.finalMessageContent,
    });
    expect(execution?.finalMessageId).toBe(source.assistantMessageId);
    expect((acceptance?.disposition as Record<string, unknown> | undefined)?.acceptedClaimRefs)
      .toEqual(source.acceptedClaimRefs);
  });

  it("runs the provider-free Chat-to-Mission dependency handoff and preserves history on replan", async () => {
    const projectId = await insertProject();
    const message = "Inspect the source, then fix the blocking issue.";
    const preview = await request(app)
      .post("/api/ai/missions/plan-preview")
      .send({ projectId, message });
    expect(preview.status).toBe(200);
    expect(preview.body.admission).toBe("mission");
    expect(preview.body.plan.steps.length).toBeGreaterThan(2);

    const handoff = await request(app)
      .post("/api/ai/missions/from-chat")
      .send({
        projectId,
        idempotencyKey: randomUUID(),
        message,
        expectedPlanHash: preview.body.plan.planHash,
      });
    expect(handoff.status).toBe(201);
    const missionId = handoff.body.mission.id as string;
    const planRevision = preview.body.plan.planHash as string;

    const [mission] = await db
      .select({
        status: aiMissionsTable.status,
        autonomyPolicy: aiMissionsTable.autonomyPolicy,
      })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("active");
    expect(mission?.autonomyPolicy).toMatchObject({
      handoffSource: { kind: "chat" },
      activePlanRevision: planRevision,
    });

    const materializedGoals = await db
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
        outcomeContract: aiGoalsTable.outcomeContract,
      })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, missionId));
    expect(materializedGoals).toHaveLength(preview.body.plan.steps.length);

    const dependencies = await db
      .select({
        goalId: aiGoalDependenciesTable.goalId,
        dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
        planRevision: aiGoalDependenciesTable.planRevision,
      })
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.missionId, missionId));
    expect(dependencies.length).toBeGreaterThan(0);
    expect(dependencies.every((dependency) => dependency.planRevision === planRevision)).toBe(true);
    expect(materializedGoals.every((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === planRevision
    ))).toBe(true);

    const dependentGoal = materializedGoals.find((goal) =>
      dependencies.some((dependency) => dependency.goalId === goal.id),
    );
    expect(dependentGoal).toBeDefined();
    if (!dependentGoal) return;

    await expect(runMissionGoal({
      goalId: dependentGoal.id,
      userId: "test-user",
      trigger: "resume",
    })).resolves.toMatchObject({
      status: "waiting",
      goalId: dependentGoal.id,
      reason: "dependencies_pending",
    });

    const predecessorIds = dependencies
      .filter((dependency) => dependency.goalId === dependentGoal.id)
      .map((dependency) => dependency.dependsOnGoalId);
    const proofGoalIds = new Set<string>();
    const includeProofAncestors = (goalId: string) => {
      if (proofGoalIds.has(goalId)) return;
      proofGoalIds.add(goalId);
      for (const dependency of dependencies.filter((edge) => edge.goalId === goalId)) {
        includeProofAncestors(dependency.dependsOnGoalId);
      }
    };
    for (const predecessorId of predecessorIds) includeProofAncestors(predecessorId);
    const stepOrder = new Map<string, number>(
      preview.body.plan.steps.map((step: { id: string }, index: number) => [step.id, index] as const),
    );
    const proofGoals = materializedGoals
      .filter((goal) => proofGoalIds.has(goal.id))
      .sort((left, right) => {
        const leftStepId = (left.successCriteria as { stepId?: string }).stepId ?? "";
        const rightStepId = (right.successCriteria as { stepId?: string }).stepId ?? "";
        return (stepOrder.get(leftStepId) ?? Number.MAX_SAFE_INTEGER)
          - (stepOrder.get(rightStepId) ?? Number.MAX_SAFE_INTEGER);
      });
    const proofBaseTime = new Date(Date.now() - 10 * 60_000);
    for (const [sequence, proofGoal] of proofGoals.entries()) {
      await seedCanonicalMissionGoalCompletion({
        projectId,
        missionId,
        goalId: proofGoal.id,
        planRevision,
        sequence,
        baseTime: proofBaseTime,
      });
    }

    expect(await wakeReadyMissionGoals()).toBeGreaterThanOrEqual(1);
    const [wokenGoal] = await db
      .select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, dependentGoal.id));
    expect(["running", "verifying"]).toContain(wokenGoal?.status);

    const replan = await request(app)
      .post(`/api/ai/missions/${missionId}/replan`)
      .send({
        message: "Inspect the source, then fix the newly discovered issue.",
        reason: "The accepted execution exposed a new bounded objective.",
      });
    expect(replan.status).toBe(201);
    expect(replan.body.plan.planHash).not.toBe(planRevision);

    const historicalGoals = await db
      .select({
        id: aiGoalsTable.id,
        status: aiGoalsTable.status,
        successCriteria: aiGoalsTable.successCriteria,
      })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, missionId));
    expect(historicalGoals.length).toBeGreaterThan(materializedGoals.length);
    expect(historicalGoals.some((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === planRevision
    ))).toBe(true);
    expect(historicalGoals.some((goal) => (
      goal.successCriteria
      && typeof goal.successCriteria === "object"
      && !Array.isArray(goal.successCriteria)
      && (goal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash === replan.body.plan.planHash
    ))).toBe(true);
  });

  it("persists revision-bound goal dependencies and rejects cycles", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Dependency mission",
      intent: "Coordinate dependent work",
    });
    const first = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Prepare evidence" });
    const second = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Apply follow-up",
        dependsOnGoalIds: [first.body.id],
        planRevision: "revision-1",
      });
    expect(second.status).toBe(201);

    const persisted = await db
      .select()
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.goalId, second.body.id));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.dependsOnGoalId).toBe(first.body.id);
    expect(persisted[0]?.planRevision).toBe("revision-1");

    const cycle = await request(app)
      .patch(`/api/ai/goals/${first.body.id}`)
      .send({
        dependsOnGoalIds: [second.body.id],
        planRevision: "revision-1",
      });
    expect(cycle.status).toBe(400);
    expect(cycle.body.code).toBe("INVALID_GOAL_DEPENDENCIES");
  });

  it("rejects dependency edits while any Goal in the Mission is running", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Active dependency mission",
      intent: "Keep dependencies stable while work is executing",
    });
    const prerequisite = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Active prerequisite" });
    const dependent = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Dependent work",
        dependsOnGoalIds: [prerequisite.body.id],
        planRevision: "revision-1",
      });
    expect(dependent.status).toBe(201);
    await db.update(aiGoalsTable)
      .set({ status: "running" })
      .where(eq(aiGoalsTable.id, prerequisite.body.id));

    const patched = await request(app)
      .patch(`/api/ai/goals/${dependent.body.id}`)
      .send({
        dependsOnGoalIds: [],
        planRevision: "revision-1",
      });

    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe("GOAL_DEPENDENCIES_LOCKED_DURING_EXECUTION");
    const persisted = await db.select()
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.goalId, dependent.body.id));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.dependsOnGoalId).toBe(prerequisite.body.id);
  });

  it("requires Mission reactivation before downgrading a Goal under a completed Mission", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Completed Mission",
      intent: "Protect accepted completion state",
    });
    const goal = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Completed Goal" });
    await db.update(aiGoalsTable)
      .set({ status: "completed" })
      .where(eq(aiGoalsTable.id, goal.body.id));
    await db.update(aiMissionsTable)
      .set({ status: "completed" })
      .where(eq(aiMissionsTable.id, mission.body.id));

    const patched = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({ status: "queued" });

    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe("MISSION_REACTIVATION_REQUIRED");
    const [persisted] = await db.select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    expect(persisted?.status).toBe("completed");
  });

  it("derives Mission completion only when Canonical Proof is present for every active Goal", async () => {
    const projectId = await insertProject();
    const missionResponse = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Proof-gated completion",
      intent: "Do not infer Mission completion from Goal statuses alone",
    });
    const goalResponse = await request(app)
      .post(`/api/ai/missions/${missionResponse.body.id}/goals`)
      .send({ title: "Unproven completed Goal" });
    await db.update(aiGoalsTable)
      .set({ status: "completed" })
      .where(eq(aiGoalsTable.id, goalResponse.body.id));

    const derivedStatus = await db.transaction(async (tx) => {
      const [mission] = await tx.select()
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionResponse.body.id));
      const goals = await tx.select()
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.missionId, missionResponse.body.id));
      if (!mission) throw new Error("Mission fixture was not persisted");
      return deriveProofGatedMissionStatus(tx, mission, goals);
    });

    expect(derivedStatus).toBe("needs_replan");
  });

  it("creates a fresh replan Goal without replacing the prior Mission history", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Replan mission",
      intent: "Inspect the source, then fix the blocking issue.",
    });
    const replan = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/replan`);
    expect(replan.status).toBe(201);
    expect(replan.body.goal.goalId).toBeTruthy();
    expect(replan.body.plan.planHash).toBeTruthy();

    const goals = await db
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, mission.body.id));
    expect(goals.length).toBeGreaterThan(1);
    expect(goals.every((goal) =>
      (goal.successCriteria as Record<string, unknown>).kind === "mission_replan_step",
    )).toBe(true);
  });

  it("creates project-owned missions and goals, then returns their read-only projection", async () => {
    const projectId = await insertProject();
    const createdMission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Ship the release",
      intent: "Coordinate the existing delivery systems",
    });
    expect(createdMission.status).toBe(201);
    expect(createdMission.body.scope).toEqual({ kind: "project", projectId });
    expect(createdMission.body.userId).toBe("test-user");

    const createdGoal = await request(app)
      .post(`/api/ai/missions/${createdMission.body.id}/goals`)
      .send({
        title: "Validate the candidate",
        successCriteria: { validator: "release" },
        evidenceContract: { required: true },
      });
    expect(createdGoal.status).toBe(201);
    expect(createdGoal.body.missionId).toBe(createdMission.body.id);

    const fetchedGoal = await request(app).get(`/api/ai/goals/${createdGoal.body.id}`);
    expect(fetchedGoal.status).toBe(200);
    expect(fetchedGoal.body.id).toBe(createdGoal.body.id);

    const listed = await request(app).get(`/api/ai/missions?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const projection = await request(app).get(`/api/ai/missions/${createdMission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.mission.id).toBe(createdMission.body.id);
    expect(projection.body.goals).toHaveLength(1);
    expect(projection.body.goals[0].goal.id).toBe(createdGoal.body.id);
    expect(projection.body.counts).toEqual({
      goals: 1,
      tasks: 0,
      workflows: 0,
      executions: 0,
      events: 1,
    });
  });

  it("accepts an authenticated Goal event idempotently and wakes the waiting Goal", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Event-driven mission",
      intent: "Wait for an external validation event",
    });
    const goal = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Wait for validation",
        nextAction: { kind: "wait", reason: "event", wakeAt: null },
      });
    expect(goal.status).toBe(201);
    await db.update(aiGoalsTable)
      .set({ status: "waiting_for_event" })
      .where(eq(aiGoalsTable.id, goal.body.id));

    const eventId = randomUUID();
    const delivered = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/events`)
      .send({
        eventId,
        type: "ExternalValidationCompleted",
        payload: { validationId: "validation-1" },
      });
    expect(delivered.status).toBe(202);
    expect(delivered.body).toMatchObject({
      accepted: true,
      woken: true,
      duplicate: false,
      eventId,
      replayPending: false,
    });

    const duplicate = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/events`)
      .send({
        eventId,
        type: "ExternalValidationCompleted",
        payload: { validationId: "validation-1" },
      });
    expect(duplicate.status).toBe(202);
    expect(duplicate.body).toMatchObject({
      accepted: true,
      duplicate: true,
      eventId,
    });

    const [persistedGoal] = await db
      .select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    const [inboxEvent] = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId));
    expect(persistedGoal?.status).toBe("needs_replan");
    expect(inboxEvent?.type).toBe("AiMissionExternalEventReceived");
  });

  it("binds only a committed project proposal to a delivery Goal", async () => {
    const projectId = await insertProject();
    await db.update(projectsTable)
      .set({
        gitRemoteUrl: "https://github.com/example/project.git",
        gitDefaultBranch: "main",
      })
      .where(eq(projectsTable.id, projectId));
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Verified delivery mission",
      intent: "Deliver the verified change",
    });
    const prerequisite = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({ title: "Complete verification first" });
    const goal = await request(app)
      .post(`/api/ai/missions/${mission.body.id}/goals`)
      .send({
        title: "Push verified change",
        dependsOnGoalIds: [prerequisite.body.id],
        planRevision: "delivery-plan-1",
        nextAction: {
          kind: "recipe",
          recipeId: "delivery.push.github",
          recipeVersion: 1,
          approvedPaths: [],
          candidateIdentity: null,
        },
      });
    expect(goal.status).toBe(201);

    const rejected = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/delivery`)
      .send({ proposalId: randomUUID() });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe("DELIVERY_PROPOSAL_NOT_COMMITTED");

    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const now = new Date();
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Delivery proposal fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Verified change",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      createdAt: now,
    });

    const bound = await request(app)
      .post(`/api/ai/goals/${goal.body.id}/delivery`)
      .send({ proposalId });
    expect(bound.status).toBe(202);
    expect(bound.body).toMatchObject({
      proposalId,
      operationId,
      run: {
        status: "waiting",
        reason: "dependencies_pending",
      },
    });
    expect(bound.body.goal.nextAction).toMatchObject({
      kind: "recipe",
      recipeId: "delivery.push.github",
      proposalId,
    });

    const [persistedGoal] = await db
      .select({ status: aiGoalsTable.status, nextAction: aiGoalsTable.nextAction })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    expect(persistedGoal?.status).toBe("waiting_for_event");
    expect(persistedGoal?.nextAction).toMatchObject({ proposalId });
    const [bindingEvent] = await db
      .select({ type: eventsTable.type, correlationId: eventsTable.correlationId })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.goalId, goal.body.id),
        eq(eventsTable.type, "AiGoalDeliveryProposalBound"),
      ));
    expect(bindingEvent).toMatchObject({
      type: "AiGoalDeliveryProposalBound",
      correlationId: operationId,
    });
  });

  it("persists a server-owned skill candidate and performs read-only shadow replay", {
    timeout: 60_000,
  }, async () => {
    const projectId = await insertProject();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const executionId = randomUUID();
    const operationId = randomUUID();
    const missionId = randomUUID();
    const goalId = randomUUID();
    const planRevision = `shadow-plan-${operationId}`;
    const sourceRevision = "b".repeat(40);
    const now = new Date();
    const sourceRoot = `/tmp/mission-shadow-source-${operationId}`;
    await fs.mkdir(`${sourceRoot}/src`, { recursive: true });
    await fs.writeFile(`${sourceRoot}/package.json`, JSON.stringify({
      scripts: { typecheck: "tsc --noEmit" },
    }), "utf8");
    await fs.writeFile(`${sourceRoot}/tsconfig.json`, JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      include: ["src/**/*.ts"],
    }), "utf8");
    await fs.symlink(path.join(process.cwd(), "node_modules"), `${sourceRoot}/node_modules`, "dir");
    await fs.writeFile(`${sourceRoot}/src/index.ts`, "export const old = false;\n", "utf8");
    shadowSourceRoots.push(sourceRoot);
    await db.update(projectsTable).set({ rootPath: sourceRoot }).where(eq(projectsTable.id, projectId));
    const deliveryWorkspace = await createDeliveryWorkspace({
      rootPath: sourceRoot,
      operationId,
      baseRevision: sourceRevision,
      changes: [{ path: "src/index.ts", newContent: "export const ok = true;" }],
    });
    shadowWorkspaceRoots.push(deliveryWorkspace.workspaceRoot);
    const candidateTreeHash = deliveryWorkspace.candidateTreeHash;
    const changeSetHash = deliveryWorkspace.changeSetHash;
    const taskObjective = buildTaskObjectiveContract({
      message: "Fix the candidate behavior.",
      projectId,
      workspaceRevision: sourceRevision,
      targetPaths: ["src/index.ts"],
      proofRequired: true,
      operationMode: "BUILD",
      implementationTaskMode: true,
    })!;
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Skill candidate fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Verified candidate",
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Shadow replay mission",
      intent: "Replay the verified candidate",
      status: "completed",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      budget: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Replay the verified candidate",
      status: "completed",
      priority: "p2",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {
        planRevision: { hash: planRevision },
        validationProfile: "workspace-typecheck",
      },
      nextAction: {
        kind: "recipe",
        recipeId: "candidate.verify",
        recipeVersion: 1,
        approvedPaths: ["src/index.ts"],
      },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: JSON.stringify([{ path: "src/index.ts", newContent: "export const ok = true;" }]),
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: sourceRevision,
      candidateTreeHash,
      changeSetHash,
      baseTreeHash: deliveryWorkspace.baseTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceRoot: deliveryWorkspace.workspaceRoot,
      createdAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      sessionId,
      operationId,
      proposalId,
      goalId,
      userId: "test-user",
      idempotencyKey: `skill-candidate-${executionId}`,
      resumeTokenHash: "resume-hash",
      baseRevision: sourceRevision,
      request: JSON.stringify({
        workspaceRevision: sourceRevision,
        taskObjective,
      }),
      checkpoint: "{}",
      status: "completed",
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiExecutionEvidenceSnapshotsTable).values({
      id: "evidence-1",
      executionId,
      projectId,
      attempt: 0,
      operationId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      verdict: "PROVEN",
      complete: 1,
      readCount: 1,
      totalBytes: 128,
      createdAt: now,
    });
    const proof = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: "evidence-1",
      sourceRevision,
      candidateIdentity: candidateTreeHash,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt: 0,
      finalizationKey: `final-${executionId}`,
      operationId,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "COMPLETED",
      nextActionCode: "NONE",
      disposition: { proof },
      evidenceSnapshotId: "evidence-1",
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      createdAt: now,
    });

    const bound = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate`)
      .send({});
    expect(bound.status).toBe(201);
    expect(bound.body).toMatchObject({
      candidate: {
        projectId,
        sourceRevision,
        candidateTreeHash,
        verification: { recipeId: "candidate.verify", recipeVersion: 1 },
        shadow: { mode: "shadow-replay", productionExecution: false },
      },
      lifecycle: "committed",
      productionExecution: false,
    });

    const replayInput = {
      userId: "test-user",
      projectId,
      proposalId,
      operationId,
      sourceRevision,
      candidateTreeHash,
      changeSetHash,
      sourceWorkspaceRoot: deliveryWorkspace.workspaceRoot,
      candidate: bound.body.candidate,
      canonicalProof: await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId,
        scope: {
          projectId,
          missionId,
          goalId,
          executionId,
          operationId,
          planRevision,
          activePlanRevision: planRevision,
          sourceRevisionBinding: "scope",
          candidateIdentityBinding: "required",
          sourceRevision,
          candidateIdentity: candidateTreeHash,
        },
        goalStatus: "completed",
      })),
      missionId,
      goalId,
      planRevision,
      activePlanRevision: planRevision,
    };
    const replayIdempotencyKey =
      `shadow-replay:${proposalId}:${bound.body.candidate.candidateId}:${candidateTreeHash}`;
    const validationRootsBeforeCrash = new Set(
      (await fs.readdir("/tmp")).filter((name) => name.startsWith("engineeringos-validation-")),
    );
    let releaseReplayInsertLock!: () => void;
    let signalReplayInsertLockReady!: () => void;
    const replayInsertLockReady = new Promise<void>((resolve) => {
      signalReplayInsertLockReady = resolve;
    });
    const holdReplayInsertLock = new Promise<void>((resolve) => {
      releaseReplayInsertLock = resolve;
    });
    const replayInsertLock = db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE ai_shadow_replays IN SHARE MODE`);
      signalReplayInsertLockReady();
      await holdReplayInsertLock;
    });
    await replayInsertLockReady;

    const databaseUrl = process.env.DATABASE_URL;
    expect(databaseUrl).toBeTruthy();
    expect(new URL(databaseUrl!).hostname).toBe("127.0.0.1");
    const applicationName = `e32-shadow-crash-${proposalId.slice(0, 8)}`;
    const childDatabaseUrl = new URL(databaseUrl!);
    childDatabaseUrl.searchParams.set("application_name", applicationName);
    const childSource = [
      `const replayInput = ${JSON.stringify(replayInput)};`,
      "(async () => {",
      '  const { startShadowReplay } = await import("./src/lib/shadow-replay.ts");',
      "  await startShadowReplay(replayInput);",
      "})().catch((error) => {",
      "  console.error(error);",
      "  process.exitCode = 1;",
      "});",
    ].join("\n");
    const child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], {
      cwd: process.cwd(),
      env: {
        DATABASE_URL: childDatabaseUrl.toString(),
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        PGAPPNAME: applicationName,
        AI_PROVIDER_EGRESS_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    let childOutput = "";
    let childDiagnostics = "";
    child.stdout?.on("data", (chunk: string) => { childOutput += chunk; });
    child.stderr?.on("data", (chunk: string) => { childDiagnostics += chunk; });
    const childExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    let orphanExecution: { id: string; workspaceRoot: string | null } | undefined;
    let replayInsertBlocked = false;
    let replayBackendPid: number | undefined;
    let replayBackendClosed = false;
    try {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        [orphanExecution] = await db
          .select({
            id: aiExecutionsTable.id,
            workspaceRoot: aiExecutionsTable.workspaceRoot,
          })
          .from(aiExecutionsTable)
          .where(and(
            eq(aiExecutionsTable.userId, "test-user"),
            eq(aiExecutionsTable.idempotencyKey, replayIdempotencyKey),
          ))
          .limit(1);
        const activity = await db.execute(sql`
          SELECT pid, wait_event_type
          FROM pg_stat_activity
          WHERE application_name = ${applicationName}
        `);
        const activityRows =
          (activity as unknown as {
            rows?: Array<{ pid: number; wait_event_type: string | null }>;
          }).rows ?? [];
        const blockedBackend = activityRows.find((row) => row.wait_event_type === "Lock");
        replayInsertBlocked = Boolean(blockedBackend);
        replayBackendPid = blockedBackend?.pid;
        if (replayInsertBlocked) break;
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `Shadow replay process exited before the insert lock; `
            + `exit=${JSON.stringify(await childExit)}; stderr=${childDiagnostics}; stdout=${childOutput}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(replayInsertBlocked, `child stderr=${childDiagnostics}; stdout=${childOutput}`).toBe(true);
      expect(await db.select({ id: aiShadowReplaysTable.id })
        .from(aiShadowReplaysTable)
        .where(and(
          eq(aiShadowReplaysTable.userId, "test-user"),
          eq(aiShadowReplaysTable.idempotencyKey, replayIdempotencyKey),
        ))).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await childExit;
      }
      try {
        if (replayBackendPid !== undefined) {
          await db.execute(sql`SELECT pg_terminate_backend(${replayBackendPid})`);
          const backendDeadline = Date.now() + 15_000;
          while (Date.now() < backendDeadline) {
            const remaining = await db.execute(sql`
              SELECT count(*)::integer AS count
              FROM pg_stat_activity
              WHERE pid = ${replayBackendPid}
            `);
            const rows =
              (remaining as unknown as { rows?: Array<{ count: number | string }> }).rows ?? [];
            if (Number(rows[0]?.count ?? 0) === 0) {
              replayBackendClosed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
      } finally {
        releaseReplayInsertLock();
        await replayInsertLock;
      }
      for (const name of await fs.readdir("/tmp")) {
        if (
          name.startsWith("engineeringos-validation-")
          && !validationRootsBeforeCrash.has(name)
        ) {
          shadowWorkspaceRoots.push(path.join("/tmp", name));
        }
      }
    }
    expect(await childExit).toMatchObject({ code: null, signal: "SIGKILL" });
    expect(replayBackendClosed).toBe(true);
    expect(orphanExecution).toBeUndefined();
    if (orphanExecution?.workspaceRoot) shadowWorkspaceRoots.push(orphanExecution.workspaceRoot);
    expect(await db.select({ id: aiShadowReplaysTable.id })
      .from(aiShadowReplaysTable)
      .where(and(
        eq(aiShadowReplaysTable.userId, "test-user"),
        eq(aiShadowReplaysTable.idempotencyKey, replayIdempotencyKey),
      ))).toEqual([]);

    const registrationWithoutReplay = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-registry`)
      .send({ skillId: "candidate-review", skillVersion: "crash-window" });
    expect(registrationWithoutReplay.status).toBe(409);
    expect(registrationWithoutReplay.body.code).toBe("SKILL_REGISTRY_SHADOW_REPLAY_REQUIRED");

    const validationRootsBeforeRetry = new Set(
      (await fs.readdir("/tmp")).filter((name) => name.startsWith("engineeringos-validation-")),
    );
    const replayRecoveryRace = await Promise.all([
      request(app)
        .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
        .send({}),
      request(app)
        .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
        .send({}),
    ]);
    for (const name of await fs.readdir("/tmp")) {
      if (
        name.startsWith("engineeringos-validation-")
        && !validationRootsBeforeRetry.has(name)
      ) {
        shadowWorkspaceRoots.push(path.join("/tmp", name));
      }
    }
    expect(replayRecoveryRace.every((response) => [200, 202].includes(response.status)), JSON.stringify({
      orphanExecutionId: orphanExecution?.id ?? null,
      registrationStatus: registrationWithoutReplay.status,
      responses: replayRecoveryRace.map((response) => ({
        status: response.status,
        body: response.body,
      })),
    })).toBe(true);
    expect([...new Set(replayRecoveryRace.map((response) => response.body.replay?.id))])
      .toHaveLength(1);
    const replayRecoveredAfterCrash =
      replayRecoveryRace.find((response) => response.status === 200) ?? replayRecoveryRace[0]!;
    expect(replayRecoveredAfterCrash.status).toBe(200);
    const [executionAfterRecovery] = await db
      .select({
        id: aiExecutionsTable.id,
        workspaceRoot: aiExecutionsTable.workspaceRoot,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.userId, "test-user"),
        eq(aiExecutionsTable.idempotencyKey, replayIdempotencyKey),
      ))
      .limit(1);
    expect(executionAfterRecovery?.id).not.toBe(orphanExecution?.id);
    expect(await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.userId, "test-user"),
        eq(aiExecutionsTable.idempotencyKey, replayIdempotencyKey),
      ))).toHaveLength(1);
    expect(await db.select({ id: aiShadowReplaysTable.id })
      .from(aiShadowReplaysTable)
      .where(and(
        eq(aiShadowReplaysTable.userId, "test-user"),
        eq(aiShadowReplaysTable.idempotencyKey, replayIdempotencyKey),
      ))).toHaveLength(1);

    const replay = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body).toMatchObject({
      receipt: {
        candidateTreeHash,
        productionExecution: false,
        proof: { verdict: "PROVEN" },
        validator: { profile: "shadow-replay", status: "passed" },
      },
      productionExecution: false,
    });
    const replayAgain = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(replayAgain.status).toBe(200);
    expect(replayAgain.body.replay.id).toBe(replay.body.replay.id);
    const boundAgain = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate`)
      .send({});
    expect(boundAgain.status).toBe(200);

    expect(replay.body.receipt.pairedBaseline).toMatchObject({
      status: "passed",
      promotionAllowed: true,
      cases: [expect.objectContaining({
        caseId: "single-file-001",
        baselineTerminal: "completed",
        candidateTerminal: "completed",
      })],
    });

    const [replayProofBinding] = await db
      .select({
        acceptanceId: aiExecutionAcceptancesTable.id,
        attempt: aiExecutionAcceptancesTable.attempt,
        executionAttempt: aiExecutionsTable.attempt,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
        request: aiExecutionsTable.request,
      })
      .from(aiExecutionAcceptancesTable)
      .innerJoin(aiExecutionsTable, eq(aiExecutionsTable.id, aiExecutionAcceptancesTable.executionId))
      .where(eq(aiExecutionAcceptancesTable.id, replay.body.receipt.proof.receiptId))
      .limit(1);
    expect(replayProofBinding).toBeDefined();
    expect(replayProofBinding?.attempt).toBe(replayProofBinding?.executionAttempt);
    expect(replayProofBinding?.evidenceSnapshotId).toBeTruthy();
    expect(JSON.parse(replayProofBinding!.request)).toMatchObject({
      proofRequired: true,
      proofEvidenceMode: "artifact_only",
    });
    const [replayProofEvidence] = await db
      .select({
        id: aiExecutionEvidenceSnapshotsTable.id,
        attempt: aiExecutionEvidenceSnapshotsTable.attempt,
      })
      .from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(
        aiExecutionEvidenceSnapshotsTable.id,
        replayProofBinding!.evidenceSnapshotId!,
      ))
      .limit(1);
    expect(replayProofEvidence?.attempt).toBe(replayProofBinding?.executionAttempt);
    const replayExecutionAttempt = replayProofBinding!.executionAttempt;
    const inconsistentAttempt = replayExecutionAttempt + 1;
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: inconsistentAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ attempt: inconsistentAttempt })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));
    const staleReplayRead = await request(app)
      .get(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay/${replay.body.replay.id}`);
    expect(staleReplayRead.status).toBe(200);
    expect(staleReplayRead.body.receipt).toMatchObject({
      proof: { receiptId: replay.body.receipt.proof.receiptId },
    });
    const staleReplayRetry = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(staleReplayRetry.status).toBe(200);
    expect(staleReplayRetry.body.replay.status).toBe("completed");
    expect(staleReplayRetry.body.receipt).toMatchObject({
      proof: { receiptId: replay.body.receipt.proof.receiptId },
    });
    const staleReplayRegistration = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-registry`)
      .send({ skillId: "candidate-review", skillVersion: "1.0.0" });
    expect(staleReplayRegistration.status).toBe(409);
    expect(staleReplayRegistration.body.code).toBe("SKILL_REGISTRY_CANONICAL_PROOF_REQUIRED");
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: replayExecutionAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ attempt: replayExecutionAttempt })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));

    const registered = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-registry`)
      .send({ skillId: "candidate-review", skillVersion: "1.0.0" });
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({
      registry: {
        projectId,
        skillId: "candidate-review",
        skillVersion: "1.0.0",
        candidateId: expect.stringContaining("skill-candidate:"),
        proofReceiptId: replay.body.receipt.proof.receiptId,
        promotionStatus: "pending",
        revocationStatus: "active",
        shadowScore: {
          status: "passed",
          promotionAllowed: true,
          candidateWorkspaceHash: candidateTreeHash,
        },
      },
    });
    const registryId = registered.body.registry.id as string;

    const duplicateRegistration = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-registry`)
      .send({ skillId: "candidate-review", skillVersion: "1.0.0" });
    expect(duplicateRegistration.status).toBe(200);
    expect(duplicateRegistration.body.registry.id).toBe(registryId);
    expect(await db.select({ id: aiSkillRegistryTable.id })
      .from(aiSkillRegistryTable)
      .where(eq(aiSkillRegistryTable.projectId, projectId))).toHaveLength(1);

    let releaseAcceptanceLock!: () => void;
    let signalAcceptanceLockReady!: () => void;
    const acceptanceLockReady = new Promise<void>((resolve) => {
      signalAcceptanceLockReady = resolve;
    });
    const holdAcceptanceLock = new Promise<void>((resolve) => {
      releaseAcceptanceLock = resolve;
    });
    const staleAttemptDuringApproval = replayExecutionAttempt + 1;
    const acceptanceLockTransaction = db.transaction(async (tx) => {
      const [lockedAcceptance] = await tx
        .select({ id: aiExecutionAcceptancesTable.id })
        .from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId))
        .for("update")
        .limit(1);
      if (!lockedAcceptance) throw new Error("Replay acceptance disappeared during approval race.");
      signalAcceptanceLockReady();
      await holdAcceptanceLock;
      await tx.update(aiExecutionAcceptancesTable)
        .set({ attempt: staleAttemptDuringApproval })
        .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    });
    await acceptanceLockReady;
    let approvalRaceError: unknown;
    const approvalRacePromise = request(app)
      .post(`/api/ai/skill-registry/${registryId}/approve`)
      .send({})
      .then((response) => response)
      .catch((error: unknown) => {
        approvalRaceError = error;
        return null;
      });
    let approvalBlockedOnProofLock = false;
    try {
      const waitDeadline = Date.now() + 15_000;
      while (Date.now() < waitDeadline) {
        const activity = await db.execute(sql`
          SELECT count(*)::integer AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query ILIKE '%ai_execution_acceptances%'
        `);
        const rows =
          (activity as unknown as { rows?: Array<{ count: number | string }> }).rows ?? [];
        if (Number(rows[0]?.count ?? 0) > 0) {
          approvalBlockedOnProofLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      releaseAcceptanceLock();
      await acceptanceLockTransaction;
    }
    const approvalRaceResponse = await approvalRacePromise;
    expect(
      approvalBlockedOnProofLock,
      `approval response=${approvalRaceResponse?.status ?? "rejected"}; error=${String(approvalRaceError)}`,
    ).toBe(true);
    if (!approvalRaceResponse) throw approvalRaceError;
    expect(approvalRaceResponse.status).toBe(409);
    expect(approvalRaceResponse.body.code).toBe("SKILL_REGISTRY_CANONICAL_PROOF_REQUIRED");
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: replayExecutionAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    const [registryAfterRejectedRace] = await db.select({
      promotionStatus: aiSkillRegistryTable.promotionStatus,
    }).from(aiSkillRegistryTable)
      .where(eq(aiSkillRegistryTable.id, registryId));
    expect(registryAfterRejectedRace?.promotionStatus).toBe("pending");

    const [matrixReplayBaseline] = await db.select()
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
    const [matrixProposalBaseline] = await db.select({
      baseRevision: aiChangeProposalsTable.baseRevision,
      validationEvidence: aiChangeProposalsTable.validationEvidence,
    }).from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId));
    const [matrixMissionBaseline] = await db.select({
      status: aiMissionsTable.status,
      autonomyPolicy: aiMissionsTable.autonomyPolicy,
    }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    const [matrixGoalBaseline] = await db.select({
      status: aiGoalsTable.status,
    }).from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));
    const [matrixAcceptanceBaseline] = await db.select({
      attempt: aiExecutionAcceptancesTable.attempt,
      disposition: aiExecutionAcceptancesTable.disposition,
    }).from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    const originalReceipt = structuredClone(replay.body.receipt) as {
      sourceRevision: string;
      attempt?: number;
      postTreeHash: string;
      proof: { receiptId: string; trajectoryDigest: string };
      [key: string]: unknown;
    };
    const candidateWorkspaceFile = path.join(deliveryWorkspace.workspaceRoot, "src/index.ts");
    const originalCandidateWorkspaceContent = await fs.readFile(candidateWorkspaceFile, "utf8");
    const originalProposalEvidence = JSON.parse(
      matrixProposalBaseline?.validationEvidence ?? "{}",
    ) as {
      skillCandidate?: { sourceRevision: string; [key: string]: unknown };
      [key: string]: unknown;
    };
    let matrixDependency: { goalId: string; edgeId: string } | undefined;
    const restoreMatrixBaseline = async () => {
      if (matrixDependency) {
        await db.delete(aiGoalDependenciesTable)
          .where(eq(aiGoalDependenciesTable.id, matrixDependency.edgeId));
        await db.delete(aiGoalsTable)
          .where(eq(aiGoalsTable.id, matrixDependency.goalId));
        matrixDependency = undefined;
      }
      await db.update(aiChangeProposalsTable).set({
        baseRevision: matrixProposalBaseline!.baseRevision,
        validationEvidence: matrixProposalBaseline!.validationEvidence,
      }).where(eq(aiChangeProposalsTable.id, proposalId));
      await db.update(aiShadowReplaysTable).set({
        attempt: matrixReplayBaseline!.attempt,
        sourceRevision: matrixReplayBaseline!.sourceRevision,
        candidateTreeHash: matrixReplayBaseline!.candidateTreeHash,
        changeSetHash: matrixReplayBaseline!.changeSetHash,
        operationId: matrixReplayBaseline!.operationId,
        receipt: matrixReplayBaseline!.receipt,
      }).where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
      await db.update(aiMissionsTable).set({
        status: matrixMissionBaseline!.status,
        autonomyPolicy: matrixMissionBaseline!.autonomyPolicy,
      }).where(eq(aiMissionsTable.id, missionId));
      await db.update(aiGoalsTable).set({
        status: matrixGoalBaseline!.status,
      }).where(eq(aiGoalsTable.id, goalId));
      await db.update(aiExecutionAcceptancesTable).set({
        attempt: matrixAcceptanceBaseline!.attempt,
        disposition: matrixAcceptanceBaseline!.disposition,
      }).where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
      await db.update(aiExecutionEvidenceSnapshotsTable)
        .set({ attempt: replayProofEvidence!.attempt })
        .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));
      await db.update(aiSkillRegistryTable).set({
        promotionStatus: "pending",
        approvedBy: null,
        approvedAt: null,
      }).where(eq(aiSkillRegistryTable.id, registryId));
      await db.delete(projectPluginBindingsTable)
        .where(eq(projectPluginBindingsTable.projectId, projectId));
    };
    const changedSourceRevision = `changed-${sourceRevision}`;
    const matrixCases: Array<{
      name: string;
      mutate: () => Promise<void>;
      restore?: () => Promise<void>;
    }> = [
      {
        name: "R1 stale receipt after proposal revision changes",
        mutate: async () => {
          await db.update(aiChangeProposalsTable)
            .set({ baseRevision: changedSourceRevision })
            .where(eq(aiChangeProposalsTable.id, proposalId));
        },
      },
      {
        name: "R2 new revision labels with old canonical proof",
        mutate: async () => {
          const evidence = structuredClone(originalProposalEvidence);
          if (!evidence.skillCandidate) throw new Error("Candidate evidence is missing.");
          evidence.skillCandidate.sourceRevision = changedSourceRevision;
          const receipt = structuredClone(originalReceipt);
          receipt.sourceRevision = changedSourceRevision;
          await db.update(aiChangeProposalsTable).set({
            baseRevision: changedSourceRevision,
            validationEvidence: JSON.stringify(evidence),
          }).where(eq(aiChangeProposalsTable.id, proposalId));
          await db.update(aiShadowReplaysTable).set({
            sourceRevision: changedSourceRevision,
            receipt,
          }).where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R3 receipt trajectory digest differs from current proof",
        mutate: async () => {
          const receipt = structuredClone(originalReceipt);
          receipt.proof.trajectoryDigest = "a".repeat(64);
          await db.update(aiShadowReplaysTable).set({ receipt })
            .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R4 replay receipt and row claim a different attempt",
        mutate: async () => {
          const receipt = structuredClone(originalReceipt);
          receipt.attempt = replayExecutionAttempt + 1;
          await db.update(aiShadowReplaysTable).set({
            attempt: replayExecutionAttempt + 1,
            receipt,
          }).where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R5 replay row candidate identity differs from its receipt",
        mutate: async () => {
          await db.update(aiShadowReplaysTable)
            .set({ candidateTreeHash: "0".repeat(64) })
            .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R5 candidate workspace bytes drift after replay",
        mutate: async () => {
          await fs.writeFile(candidateWorkspaceFile, "export const changed = true;\n", "utf8");
        },
        restore: async () => {
          await fs.writeFile(candidateWorkspaceFile, originalCandidateWorkspaceContent, "utf8");
        },
      },
      {
        name: "R6 effect/change-set identity differs",
        mutate: async () => {
          await db.update(aiShadowReplaysTable)
            .set({ changeSetHash: "e".repeat(64) })
            .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R6 replay operation identity differs",
        mutate: async () => {
          await db.update(aiShadowReplaysTable)
            .set({ operationId: "shadow-replay:wrong-operation" })
            .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
        },
      },
      {
        name: "R9 Mission is cancelled after replay",
        mutate: async () => {
          await db.update(aiMissionsTable).set({ status: "cancelled" })
            .where(eq(aiMissionsTable.id, missionId));
        },
      },
      {
        name: "R9 Goal is no longer complete",
        mutate: async () => {
          await db.update(aiGoalsTable).set({ status: "blocked" })
            .where(eq(aiGoalsTable.id, goalId));
        },
      },
      {
        name: "R9 a failed dependency is added after replay",
        mutate: async () => {
          const [goalRow] = await db.select().from(aiGoalsTable)
            .where(eq(aiGoalsTable.id, goalId));
          if (!goalRow) throw new Error("Replay Goal disappeared.");
          const dependencyGoalId = randomUUID();
          const edgeId = randomUUID();
          matrixDependency = { goalId: dependencyGoalId, edgeId };
          await db.insert(aiGoalsTable).values({
            ...goalRow,
            id: dependencyGoalId,
            status: "failed",
          });
          await db.insert(aiGoalDependenciesTable).values({
            id: edgeId,
            missionId,
            projectId,
            goalId,
            dependsOnGoalId: dependencyGoalId,
            planRevision,
          });
        },
      },
      {
        name: "R10 active plan revision changes after replay",
        mutate: async () => {
          const policy = matrixMissionBaseline?.autonomyPolicy;
          if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
            throw new Error("Mission autonomy policy is missing.");
          }
          await db.update(aiMissionsTable).set({
            autonomyPolicy: {
              ...(policy as Record<string, unknown>),
              activePlanRevision: `changed-${planRevision}`,
            },
          }).where(eq(aiMissionsTable.id, missionId));
        },
      },
      {
        name: "R11 old receipt after current Canonical Proof attempt changes",
        mutate: async () => {
          await db.update(aiExecutionAcceptancesTable)
            .set({ attempt: replayExecutionAttempt + 1 })
            .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
          await db.update(aiExecutionEvidenceSnapshotsTable)
            .set({ attempt: replayExecutionAttempt + 1 })
            .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));
        },
      },
      {
        name: "R12 current proof trajectory differs from old receipt",
        mutate: async () => {
          const disposition = structuredClone(
            matrixAcceptanceBaseline!.disposition,
          ) as {
            proof?: { trajectoryDigest?: { digest?: string } };
          };
          if (!disposition.proof?.trajectoryDigest) {
            throw new Error("Canonical proof trajectory is missing.");
          }
          disposition.proof.trajectoryDigest.digest = "f".repeat(64);
          await db.update(aiExecutionAcceptancesTable)
            .set({ disposition })
            .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
        },
      },
    ];
    const matrixResults: Array<{
      name: string;
      getStatus: number;
      retryStatus: number;
      retryReplayId?: string;
      registrationStatus: number;
      approvalStatus: number;
      executionDelta: number;
      replayDelta: number;
    }> = [];
    for (const matrixCase of matrixCases) {
      try {
        const executionsBefore = await db.select({ id: aiExecutionsTable.id })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.projectId, projectId));
        const replaysBefore = await db.select({ id: aiShadowReplaysTable.id })
          .from(aiShadowReplaysTable)
          .where(eq(aiShadowReplaysTable.proposalId, proposalId));
        await matrixCase.mutate();
        const readReceipt = await request(app)
          .get(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay/${replay.body.replay.id}`);
        const replayRetry = await request(app)
          .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
          .send({});
        const matrixRegistration = await request(app)
          .post(`/api/ai/proposals/${proposalId}/skill-registry`)
          .send({ skillId: "candidate-review", skillVersion: "1.0.0" });
        const matrixApproval = await request(app)
          .post(`/api/ai/skill-registry/${registryId}/approve`)
          .send({});
        const executionsAfter = await db.select({ id: aiExecutionsTable.id })
          .from(aiExecutionsTable)
          .where(eq(aiExecutionsTable.projectId, projectId));
        const replaysAfter = await db.select({ id: aiShadowReplaysTable.id })
          .from(aiShadowReplaysTable)
          .where(eq(aiShadowReplaysTable.proposalId, proposalId));
        matrixResults.push({
          name: matrixCase.name,
          getStatus: readReceipt.status,
          retryStatus: replayRetry.status,
          retryReplayId: replayRetry.body.replay?.id,
          registrationStatus: matrixRegistration.status,
          approvalStatus: matrixApproval.status,
          executionDelta: executionsAfter.length - executionsBefore.length,
          replayDelta: replaysAfter.length - replaysBefore.length,
        });
      } finally {
        try {
          await restoreMatrixBaseline();
        } finally {
          await matrixCase.restore?.();
        }
      }
    }
    const stalePromotionAttempt = replayExecutionAttempt + 1;
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: stalePromotionAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ attempt: stalePromotionAttempt })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));
    const staleApproval = await request(app)
      .post(`/api/ai/skill-registry/${registryId}/approve`)
      .send({});
    expect(staleApproval.status).toBe(409);
    expect(staleApproval.body.code).toBe("SKILL_REGISTRY_CANONICAL_PROOF_REQUIRED");
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: replayExecutionAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ attempt: replayExecutionAttempt })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));

    const approved = await request(app)
      .post(`/api/ai/skill-registry/${registryId}/approve`)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.registry).toMatchObject({
      id: registryId,
      promotionStatus: "promoted",
      revocationStatus: "active",
      approvedBy: "test-user",
    });

    const listed = await request(app)
      .get(`/api/ai/skill-registry?projectId=${projectId}`);
    expect(listed.status).toBe(200);
    expect(listed.body.registry).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: registryId, promotionStatus: "promoted" }),
    ]));

    const revoked = await request(app)
      .post(`/api/ai/skill-registry/${registryId}/revoke`)
      .send({});
    expect(revoked.status).toBe(200);
    expect(revoked.body.registry).toMatchObject({
      id: registryId,
      promotionStatus: "promoted",
      revocationStatus: "revoked",
      revokedBy: "test-user",
    });
    await expect(requireActiveSkillRegistry({
      projectId,
      skillId: "candidate-review",
      skillVersion: "1.0.0",
      candidateId: registered.body.registry.candidateId,
      sourceRevision,
      candidateTreeHash,
      registryId,
      proofReceiptId: replay.body.receipt.proof.receiptId,
      shadowReplayId: replay.body.replay.id,
    })).rejects.toMatchObject({
      code: "SKILL_REGISTRY_NOT_ACTIVE",
    });

    const [persistedProposal] = await db
      .select({
        lifecycle: aiChangeProposalsTable.lifecycle,
        validationEvidence: aiChangeProposalsTable.validationEvidence,
      })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId));
    expect(persistedProposal?.lifecycle).toBe("committed");
    expect(JSON.parse(persistedProposal?.validationEvidence ?? "{}")).toMatchObject({
      skillCandidate: {
        candidateTreeHash,
        sourceRevision,
      },
    });
    const executions = await db
      .select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.proposalId, proposalId));
    expect(executions).toHaveLength(1);
    expect(executions[0]?.id).toBe(executionId);
    const [persistedReplay] = await db
      .select({
        status: aiShadowReplaysTable.status,
        executionId: aiShadowReplaysTable.executionId,
        preTreeHash: aiShadowReplaysTable.preTreeHash,
        postTreeHash: aiShadowReplaysTable.postTreeHash,
        replayCanonicalAcceptanceId: aiShadowReplaysTable.replayCanonicalAcceptanceId,
        replayWorkspaceCleaned: aiShadowReplaysTable.replayWorkspaceCleaned,
        receipt: aiShadowReplaysTable.receipt,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.proposalId, proposalId));
    const [replayExecution] = await db
      .select({
        id: aiExecutionsTable.id,
        proposalId: aiExecutionsTable.proposalId,
        status: aiExecutionsTable.status,
        request: aiExecutionsTable.request,
        recipeReceipt: aiExecutionsTable.recipeReceipt,
        executionProfile: aiShadowReplaysTable.executionProfile,
      })
      .from(aiExecutionsTable)
      .innerJoin(aiShadowReplaysTable, eq(aiShadowReplaysTable.executionId, aiExecutionsTable.id))
      .where(eq(aiShadowReplaysTable.proposalId, proposalId));
    expect(replayExecution).toMatchObject({
      id: persistedReplay?.executionId,
      proposalId: null,
      executionProfile: "shadow-replay",
    });
    const [replayAcceptance] = await db
      .select({
        executionId: aiExecutionAcceptancesTable.executionId,
        outcome: aiExecutionAcceptancesTable.outcome,
        terminalStatus: aiExecutionAcceptancesTable.terminalStatus,
        operationId: aiExecutionAcceptancesTable.operationId,
        sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
        candidateIdentity: aiExecutionAcceptancesTable.candidateIdentity,
        evidenceRequired: aiExecutionAcceptancesTable.evidenceRequired,
        evidenceSnapshotId: aiExecutionAcceptancesTable.evidenceSnapshotId,
        evidenceComplete: aiExecutionAcceptancesTable.evidenceComplete,
      })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, persistedReplay!.executionId));
    const [replayEvidence] = await db
      .select({
        id: aiExecutionEvidenceSnapshotsTable.id,
        executionId: aiExecutionEvidenceSnapshotsTable.executionId,
        operationId: aiExecutionEvidenceSnapshotsTable.operationId,
        sourceRevision: aiExecutionEvidenceSnapshotsTable.sourceRevision,
        candidateIdentity: aiExecutionEvidenceSnapshotsTable.candidateIdentity,
        verdict: aiExecutionEvidenceSnapshotsTable.verdict,
        complete: aiExecutionEvidenceSnapshotsTable.complete,
      })
      .from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.executionId, persistedReplay!.executionId));
    expect(replayExecution).toMatchObject({
      status: "completed",
      proposalId: null,
    });
    expect(JSON.parse(replayExecution?.request ?? "{}")).toMatchObject({
      executionProfile: "shadow-replay",
      operationId: expect.stringContaining("shadow-replay:"),
      proofRequired: true,
    });
    expect(replayExecution?.recipeReceipt).toMatchObject({
      recipeId: "candidate.verify",
      recipeVersion: 1,
      status: "completed",
      executionId: persistedReplay?.executionId,
    });
    expect(replayAcceptance).toMatchObject({
      executionId: persistedReplay?.executionId,
      outcome: "SUCCEEDED",
      terminalStatus: "completed",
      operationId: expect.stringContaining("shadow-replay:"),
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      evidenceRequired: 1,
      evidenceComplete: 1,
    });
    expect(replayEvidence).toMatchObject({
      executionId: persistedReplay?.executionId,
      operationId: replayAcceptance?.operationId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      verdict: "PROVEN",
      complete: 1,
    });
    expect(replayAcceptance?.evidenceSnapshotId).toBe(replayEvidence?.id);
    expect(replay.body.receipt.proof.receiptId).toBeTruthy();
    expect(replay.body.receipt.proof.receiptId).not.toBe("evidence-1");
    expect(persistedReplay).toMatchObject({
      status: "completed",
      preTreeHash: candidateTreeHash,
      postTreeHash: candidateTreeHash,
      replayCanonicalAcceptanceId: replay.body.receipt.proof.receiptId,
      replayWorkspaceCleaned: true,
      receipt: {
        replayExecutionId: persistedReplay?.executionId,
        evidenceRefs: expect.arrayContaining([
          expect.stringContaining(":tree:pre"),
          expect.stringContaining(":tree:post"),
        ]),
        sideEffects: { apply: false, push: false, browser: false, commands: false },
      },
    });

    const [preRecoveryReplay] = await db
      .select()
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
    expect(preRecoveryReplay).toMatchObject({
      status: "completed",
      replayWorkspaceCleaned: true,
      replayCanonicalAcceptanceId: replay.body.receipt.proof.receiptId,
    });
    const replayAcceptancesBeforeRecovery = await db
      .select({ id: aiExecutionAcceptancesTable.id })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, replay.body.replay.executionId));
    expect(replayAcceptancesBeforeRecovery).toHaveLength(1);
    await db.update(aiShadowReplaysTable)
      .set({
        status: "running",
        workerId: "expired-shadow-replay-worker",
        leaseUntil: new Date(Date.now() - 60_000),
        error: null,
        completedAt: null,
      })
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));

    await runShadowReplayAttempt(replay.body.replay.id, "test-user");
    const [positiveReplayRecovery] = await db
      .select({
        status: aiShadowReplaysTable.status,
        receipt: aiShadowReplaysTable.receipt,
        replayCanonicalAcceptanceId: aiShadowReplaysTable.replayCanonicalAcceptanceId,
        replayWorkspaceCleaned: aiShadowReplaysTable.replayWorkspaceCleaned,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
    expect(positiveReplayRecovery).toMatchObject({
      status: "completed",
      receipt: replay.body.receipt,
      replayCanonicalAcceptanceId: replay.body.receipt.proof.receiptId,
      replayWorkspaceCleaned: true,
    });
    const replayAcceptancesAfterRecovery = await db
      .select({ id: aiExecutionAcceptancesTable.id })
      .from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.executionId, replay.body.replay.executionId));
    expect(replayAcceptancesAfterRecovery).toEqual(replayAcceptancesBeforeRecovery);

    const recoveryMismatchAttempt = replayExecutionAttempt + 1;
    await db.update(aiExecutionAcceptancesTable)
      .set({ attempt: recoveryMismatchAttempt })
      .where(eq(aiExecutionAcceptancesTable.id, replayProofBinding!.acceptanceId));
    await db.update(aiExecutionEvidenceSnapshotsTable)
      .set({ attempt: recoveryMismatchAttempt })
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, replayProofEvidence!.id));
    await db.update(aiShadowReplaysTable)
      .set({
        status: "running",
        workerId: "expired-shadow-replay-worker",
        leaseUntil: new Date(Date.now() - 60_000),
        error: null,
        completedAt: null,
        attempt: preRecoveryReplay!.attempt,
      })
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));

    const recoveredReplay = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate/shadow-replay`)
      .send({});
    expect(recoveredReplay.status).toBe(409);
    const [persistedRecovery] = await db
      .select({
        status: aiShadowReplaysTable.status,
        error: aiShadowReplaysTable.error,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replay.body.replay.id));
    expect(persistedRecovery).toMatchObject({
      status: "failed",
      error: "SHADOW_REPLAY_CANONICAL_PROOF_REJECTED",
    });

    expect(matrixResults).toHaveLength(matrixCases.length);
    expect(matrixResults.filter((result) =>
      result.getStatus !== 200
      || ![200, 409].includes(result.retryStatus)
      || (result.retryStatus === 200 && result.retryReplayId !== replay.body.replay.id)
      || result.registrationStatus !== 409
      || result.approvalStatus !== 409
      || result.executionDelta !== 0
      || result.replayDelta !== 0
    )).toEqual([]);
  });

  it("does not admit a candidate from a PROVEN acceptance for another execution attempt", async () => {
    const projectId = await insertProject();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const operationId = randomUUID();
    const sourceRevision = "e".repeat(40);
    const candidateTreeHash = "b".repeat(64);
    const changeSetHash = "c".repeat(64);
    const baseTreeHash = "d".repeat(64);
    const now = new Date();

    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Candidate proof attempt fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Candidate proof attempt fixture",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: JSON.stringify([{ path: "src/index.ts", newContent: "export const candidate = true;\n" }]),
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: sourceRevision,
      candidateTreeHash,
      changeSetHash,
      baseTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceRoot: `/tmp/unmaterialized-skill-candidate-${proposalId}`,
      createdAt: now,
    });
    const created = await createAiExecution({
      userId: "test-user",
      projectId,
      sessionId,
      proposalId,
      attempt: 1,
      correlationId: operationId,
      idempotencyKey: `skill-candidate-proof-${proposalId}`,
      request: {
        projectId,
        operationId,
        message: "Admit the validated candidate",
        modelMessage: "Admit the validated candidate",
        workspaceRevision: sourceRevision,
        validationTargetPaths: ["src/index.ts"],
        proofRequired: true,
      },
    });
    expect(created.execution.attempt).toBe(1);
    await db.update(aiExecutionsTable).set({
      status: "completed",
      operationId,
      baseRevision: sourceRevision,
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiExecutionsTable.id, created.execution.id));

    const priorAttemptSnapshotId = randomUUID();
    const priorAttemptProof = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: priorAttemptSnapshotId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
    });
    await db.insert(aiExecutionEvidenceSnapshotsTable).values({
      id: priorAttemptSnapshotId,
      executionId: created.execution.id,
      projectId,
      attempt: 0,
      operationId,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      verdict: "PROVEN",
      complete: 1,
      readCount: 1,
      totalBytes: 64,
      createdAt: now,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId: created.execution.id,
      projectId,
      attempt: 0,
      finalizationKey: `skill-candidate-proof-${created.execution.id}`,
      operationId,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "COMPLETED",
      nextActionCode: "NONE",
      disposition: { proof: priorAttemptProof },
      evidenceSnapshotId: priorAttemptSnapshotId,
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
      sourceRevision,
      candidateIdentity: candidateTreeHash,
      createdAt: now,
    });

    const response = await request(app)
      .post(`/api/ai/proposals/${proposalId}/skill-candidate`)
      .send({});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("SKILL_CANDIDATE_PROOF_NOT_AVAILABLE");
    const [persistedProposal] = await db.select({
      validationEvidence: aiChangeProposalsTable.validationEvidence,
    }).from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId));
    expect(JSON.stringify(persistedProposal?.validationEvidence ?? null))
      .not.toContain("skillCandidate");
  });

  it("resumes a shadow replay whose recipe execution was interrupted by a crash", async () => {
    const projectId = await insertProject();
    const userId = "test-user";
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const replayId = randomUUID();
    const executionIdempotencyKey = `shadow-recovery-${replayId}`;
    const operationId = `shadow-replay:${replayId}`;
    const missionId = randomUUID();
    const goalId = randomUUID();
    const planRevision = `shadow-recovery-plan-${replayId}`;
    const sourceRevision = "c".repeat(40);
    const now = new Date();
    const sourceRoot = `/tmp/mission-shadow-recovery-source-${replayId}`;
    await fs.mkdir(`${sourceRoot}/src`, { recursive: true });
    await fs.writeFile(`${sourceRoot}/package.json`, JSON.stringify({
      scripts: { typecheck: "tsc --noEmit" },
    }), "utf8");
    await fs.writeFile(`${sourceRoot}/tsconfig.json`, JSON.stringify({
      compilerOptions: { strict: true, noEmit: true },
      include: ["src/**/*.ts"],
    }), "utf8");
    await fs.symlink(path.join(process.cwd(), "node_modules"), `${sourceRoot}/node_modules`, "dir");
    await fs.writeFile(`${sourceRoot}/src/index.ts`, "export const recovered = true;\n", "utf8");
    shadowWorkspaceRoots.push(sourceRoot);
    await db.update(projectsTable).set({ rootPath: sourceRoot }).where(eq(projectsTable.id, projectId));
    const replayWorkspace = await createValidationWorkspace(sourceRoot, [], async () => undefined);
    shadowWorkspaceRoots.push(replayWorkspace.rootPath);
    const candidateTreeHash = await hashDeliveryTree(replayWorkspace.rootPath);

    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Shadow replay recovery fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Recovery fixture",
      createdAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId,
      title: "Shadow replay recovery mission",
      intent: "Recover the candidate replay",
      status: "completed",
      scope: { kind: "project", projectId },
      autonomyPolicy: { activePlanRevision: planRevision },
      budget: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Recover the candidate replay",
      status: "completed",
      priority: "p2",
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {
        planRevision: { hash: planRevision },
        validationProfile: "workspace-typecheck",
      },
      nextAction: {},
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: JSON.stringify([{ path: "src/index.ts", newContent: "export const recovered = true;" }]),
      appliedChanges: "[]",
      status: "applied",
      lifecycle: "committed",
      operationId,
      baseRevision: sourceRevision,
      candidateTreeHash,
      changeSetHash: "recovery-change-set",
      baseTreeHash: candidateTreeHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      workspaceRoot: replayWorkspace.rootPath,
      createdAt: now,
    });

    const prepared = prepareRecipeOperation({
      projectId,
      operationId,
      rootPath: sourceRoot,
      sourceRevision,
      recipeId: "candidate.verify",
      recipeVersion: 1,
      approvedPaths: ["src/index.ts"],
      candidateIdentity: candidateTreeHash,
      candidateWorkspace: replayWorkspace.rootPath,
      validationProfiles: ["workspace-typecheck"],
    });
    const taskObjective = buildTaskObjectiveContract({
      message: "Fix the recovered candidate behavior.",
      projectId,
      workspaceRevision: sourceRevision,
      targetPaths: ["src/index.ts"],
      proofRequired: true,
      operationMode: "BUILD",
      implementationTaskMode: true,
    })!;
    const created = await createAiExecution({
      userId,
      request: {
        projectId,
        executionProfile: "shadow-replay",
        turnIntent: "TASK_EXECUTION",
        operationId,
        message: "Server-owned candidate shadow replay.",
        modelMessage: "Server-owned candidate shadow replay.",
        workspaceRevision: sourceRevision,
        workspaceRoot: replayWorkspace.rootPath,
        validationTargetPaths: ["src/index.ts"],
        validationProfiles: ["workspace-typecheck"],
        taskObjective,
        proofRequired: true,
        ...(prepared.proofEvidenceMode === "artifact_only"
          ? { proofEvidenceMode: "artifact_only" as const }
          : {}),
      },
      idempotencyKey: executionIdempotencyKey,
      correlationId: operationId,
      projectId,
      goalId,
      recipeBinding: prepared.binding,
      workspaceRoot: replayWorkspace.rootPath,
    });
    expect(created.execution.id).toBeTruthy();
    await db.update(aiExecutionsTable)
      .set({
        status: "running",
        workerId: "crashed-shadow-replay-worker",
        leaseUntil: new Date(now.getTime() - 1_000),
        lastHeartbeatAt: new Date(now.getTime() - 1_000),
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(aiExecutionsTable.id, created.execution.id));
    await db.insert(aiShadowReplaysTable).values({
      id: replayId,
      executionId: created.execution.id,
      projectId,
      proposalId,
      userId,
      idempotencyKey: executionIdempotencyKey,
      operationId,
      candidateId: "recovery-candidate",
      canonicalAcceptanceId: "recovery-acceptance",
      trajectoryDigest: "recovery-trajectory",
      sourceRevision,
      candidateTreeHash,
      changeSetHash: "recovery-change-set",
      executionProfile: "shadow-replay",
      sourceWorkspaceRoot: sourceRoot,
      replayWorkspaceRoot: replayWorkspace.rootPath,
      status: "running",
      attempt: created.execution.attempt,
      workerId: "crashed-shadow-replay-worker",
      leaseUntil: new Date(now.getTime() - 1_000),
      createdAt: now,
      updatedAt: now,
    });

    const reconciled = await reconcileAiExecutions();
    expect(reconciled).toBe(1);
    const [pausedExecution] = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id));
    expect(pausedExecution?.status).toBe("paused");

    const resumeResults = await Promise.all([
      runShadowReplayAttempt(replayId, userId),
      runShadowReplayAttempt(replayId, userId),
    ]);
    const [recoveredReplay] = await db
      .select({
        status: aiShadowReplaysTable.status,
        receipt: aiShadowReplaysTable.receipt,
        replayWorkspaceCleaned: aiShadowReplaysTable.replayWorkspaceCleaned,
      })
      .from(aiShadowReplaysTable)
      .where(eq(aiShadowReplaysTable.id, replayId));
    expect(resumeResults.some(Boolean), JSON.stringify(recoveredReplay)).toBe(true);
    const [recoveredExecution] = await db
      .select({ status: aiExecutionsTable.status })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, created.execution.id));
    expect(recoveredReplay).toMatchObject({
      status: "completed",
      replayWorkspaceCleaned: true,
      receipt: { status: "completed", productionExecution: false },
    });
    expect(recoveredExecution?.status).toBe("completed");
  });

  it("binds active mission activation to the same server-owned plan revision", async () => {
    const projectId = await insertProject();
    const response = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Repair the release flow",
      intent: "Inspect the source, then fix the blocking issue.",
      status: "active",
    });

    expect(response.status).toBe(201);
    const goals = await db
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, response.body.id));
    expect(goals.length).toBeGreaterThan(1);
    const revisions = goals.map((goal) => {
      const successCriteria = goal.successCriteria as Record<string, unknown>;
      const outcomeContract = goal.outcomeContract as Record<string, unknown>;
      const successPlan = successCriteria.planRevision as Record<string, unknown>;
      const outcomePlan = outcomeContract.planRevision as Record<string, unknown>;
      expect(successPlan.hash).toBeTruthy();
      expect(outcomePlan.hash).toBe(successPlan.hash);
      expect(successPlan.steps).toEqual(outcomePlan.steps);
      return successPlan.hash;
    });
    expect(new Set(revisions).size).toBe(1);
  });

  it("includes existing task, workflow, execution, and event rows linked to a goal", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Coordinate work",
      intent: "Track delivery progress",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Run the existing systems",
    });
    const goalId = goal.body.id as string;
    const taskId = randomUUID();
    const workflowId = randomUUID();
    const executionId = randomUUID();
    const now = new Date();

    await db.insert(tasksTable).values({
      id: taskId,
      projectId,
      goalId,
      title: "Existing task",
      status: "pending",
      priority: "p2",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowsTable).values({
      id: workflowId,
      projectId,
      goalId,
      name: "Existing workflow",
      phases: [],
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId,
      goalId,
      userId: "test-user",
      idempotencyKey: `mission-test-${executionId}`,
      resumeTokenHash: "test-hash",
      request: "{}",
      checkpoint: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(eventsTable).values({
      id: randomUUID(),
      projectId,
      goalId,
      type: "GoalProgressed",
      severity: "success",
      message: "Goal evidence retained",
      timestamp: now,
    });

    const projection = await request(app).get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.counts).toEqual({
      goals: 1,
      tasks: 1,
      workflows: 1,
      executions: 1,
      events: 2,
    });
    expect(projection.body.goals[0].tasks[0].id).toBe(taskId);
    expect(projection.body.goals[0].workflows[0].id).toBe(workflowId);
    expect(projection.body.goals[0].executions[0].id).toBe(executionId);
  });

  it("updates owned missions and goals while preserving project ownership", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Initial mission",
      intent: "Initial intent",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Initial goal",
    });

    const updatedMission = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({
        title: "Updated mission",
        status: "active",
        deadline: "2027-01-15T12:00:00.000Z",
      });
    expect(updatedMission.status).toBe(200);
    expect(updatedMission.body.title).toBe("Updated mission");
    expect(updatedMission.body.status).toBe("active");
    expect(updatedMission.body.deadline).toBe("2027-01-15T12:00:00.000Z");

    const updatedGoal = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({
        title: "Updated goal",
        status: "blocked",
        blockedReason: "Waiting for approval",
        nextAction: { kind: "wait", reason: "approval", wakeAt: null },
      });
    expect(updatedGoal.status).toBe(200);
    expect(updatedGoal.body.title).toBe("Updated goal");
    expect(updatedGoal.body.status).toBe("blocked");
    expect(updatedGoal.body.nextAction).toEqual({
      kind: "wait",
      reason: "approval",
      wakeAt: null,
    });

    const projection = await request(app).get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.body.mission.title).toBe("Updated mission");
    expect(projection.body.goals[0].goal.title).toBe("Updated goal");
    expect(projection.body.counts.events).toBe(5);
  });

  it("materializes an activation plan into durable steps when a mission becomes active", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Explain the project",
      intent: "Inspect the source, then fix the blocking issue.",
    });

    const activated = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({ status: "active" });
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("active");

    const projection = await request(app)
      .get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.goals.length).toBeGreaterThan(1);
    expect(projection.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
    const validationGoal = projection.body.goals.find((item: { goal: { title: string } }) =>
      item.goal.title === "Validate the resulting workspace",
    );
    expect(validationGoal?.goal.nextAction).toMatchObject({
      kind: "recipe",
      recipeId: "validation.recover",
      recipeVersion: 1,
      candidateIdentity: null,
    });
    expect(projection.body.goals
      .filter((item: { goal: { title: string } }) => item.goal.title !== "Validate the resulting workspace")
      .every((item: { goal: { nextAction: unknown } }) =>
        (item.goal.nextAction as { kind?: string; purpose?: string }).kind === "task"
        && (item.goal.nextAction as { purpose?: string }).purpose === "activation",
      ))
      .toBe(true);
    expect(projection.body.goals.some((item: { goal: { dependencies?: unknown[] } }) =>
      Array.isArray(item.goal.dependencies) && item.goal.dependencies.length > 0,
    )).toBe(true);

    const activatedAgain = await request(app)
      .patch(`/api/ai/missions/${mission.body.id}`)
      .send({ status: "active" });
    expect(activatedAgain.status).toBe(200);

    const afterRepeat = await request(app)
      .get(`/api/ai/missions/${mission.body.id}/projection`);
    expect(afterRepeat.body.goals).toHaveLength(projection.body.goals.length);
    expect(afterRepeat.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
  });

  it("starts the activation plan during one active mission creation request", async () => {
    const projectId = await insertProject();
    const created = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Start in one step",
      intent: "Create the plan and begin execution without a second status change",
      status: "active",
    });

    expect(created.status).toBe(201);
    expect(created.body.status).toBe("active");

    const projection = await request(app)
      .get(`/api/ai/missions/${created.body.id}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.goals.length).toBeGreaterThan(1);
    expect(projection.body.goals.every((item: { tasks: unknown[] }) => item.tasks.length === 1)).toBe(true);
  });

  it("creates one server-bound Apply Mission for a prepared proposal and keeps its apply step taskless", async () => {
    const projectId = await insertProject();
    const sessionId = randomUUID();
    const messageId = randomUUID();
    const proposalId = randomUUID();
    const now = new Date();
    const baseRevision = "a".repeat(40);
    const baseTreeHash = "b".repeat(64);
    const candidateTreeHash = "c".repeat(64);
    const changeSetHash = "d".repeat(64);
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Apply Mission proposal fixture",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Prepared change proposal",
      createdAt: now,
    });
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      status: "pending",
      baseRevision,
      baseTreeHash,
      candidateTreeHash,
      changeSetHash,
      createdAt: now,
    });

    const created = await request(app)
      .post("/api/ai/missions/apply-from-proposal")
      .send({ projectId, proposalId });
    expect(created.status).toBe(201);
    expect(created.body.applyGoal).toMatchObject({
      stepId: "apply-changes",
      taskId: null,
      dependencies: [],
    });
    expect(created.body.planGoals).toHaveLength(2);
    const successor = created.body.planGoals.find(
      (goal: { stepId: string }) => goal.stepId !== "apply-changes",
    );
    expect(successor?.dependencies).toContain("apply-changes");
    const [successorDependency] = await db.select()
      .from(aiGoalDependenciesTable)
      .where(eq(aiGoalDependenciesTable.goalId, successor.goalId));
    expect(successorDependency?.dependsOnGoalId).toBe(created.body.applyGoal.goalId);

    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, created.body.mission.id));
    const goals = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, created.body.mission.id));
    const applyGoal = goals.find((goal) => goal.id === created.body.applyGoal.goalId);
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
    expect(mission?.autonomyPolicy).toMatchObject({
      applyMission: { proposalId, requirement },
      activePlanRevision: applyGoal?.successCriteria
        && (applyGoal.successCriteria as { planRevision?: { hash?: string } }).planRevision?.hash,
    });
    expect(applyGoal?.successCriteria).toMatchObject({ applyRequirement: requirement });
    expect(applyGoal?.outcomeContract).toMatchObject({
      applyRequirement: requirement,
      candidateIdentity: `${proposalId}:${candidateTreeHash}`,
    });
    expect(applyGoal?.status).toBe("waiting_for_event");
    expect(applyGoal?.blockedReason).toBe("apply_changes_pending");
    expect(await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(eq(tasksTable.goalId, created.body.applyGoal.goalId))).toEqual([]);

    const prematureCompletion = await request(app)
      .patch(`/api/ai/missions/${created.body.mission.id}`)
      .send({ status: "completed" });
    expect(prematureCompletion.status).toBe(409);
    expect(prematureCompletion.body.code).toBe("MISSION_COMPLETION_REQUIRES_PROOF");
    expect(prematureCompletion.body.missingGoalIds).toContain(created.body.applyGoal.goalId);

    const duplicate = await request(app)
      .post("/api/ai/missions/apply-from-proposal")
      .send({ projectId, proposalId });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      code: "APPLY_MISSION_ALREADY_EXISTS",
      missionId: created.body.mission.id,
    });
    expect(await db.select({ id: aiMissionsTable.id }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.projectId, projectId))).toHaveLength(1);
  });

  it("keeps the server-owned active plan revision unchanged through Mission PATCH", async () => {
    const projectId = await insertProject();
    const created = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Server-owned plan revision",
      intent: "Keep the active plan binding server-owned",
    });
    expect(created.status).toBe(201);
    const missionId = created.body.id as string;
    await db.update(aiMissionsTable)
      .set({ autonomyPolicy: { activePlanRevision: "server-plan-v1" } })
      .where(eq(aiMissionsTable.id, missionId));

    const patched = await request(app)
      .patch(`/api/ai/missions/${missionId}`)
      .send({
        status: "completed",
        autonomyPolicy: { activePlanRevision: "client-plan-v2" },
      });

    expect(patched.status).toBe(400);
    expect(patched.body.code).toBe("MISSION_ACTIVE_PLAN_REVISION_SERVER_OWNED");
    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    expect(mission?.status).toBe("draft");
    expect(mission?.autonomyPolicy).toMatchObject({
      activePlanRevision: "server-plan-v1",
    });
  });

  it("rolls back Goal edits when the resulting completed Goal has no Canonical Proof", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Goal completion proof",
      intent: "Keep failed completion edits atomic",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Unproven goal",
    });

    const patched = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({
        title: "Should roll back",
        status: "completed",
        outcomeContract: { planRevision: { hash: "unproven-revision" } },
      });

    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe("GOAL_COMPLETION_REQUIRES_PROOF");
    const [persisted] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    expect(persisted?.title).toBe("Unproven goal");
    expect(persisted?.status).not.toBe("completed");
    expect(persisted?.outcomeContract).not.toMatchObject({
      planRevision: { hash: "unproven-revision" },
    });
  });

  it("rejects a PROVEN Goal projection backed only by evidence from another attempt", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Goal attempt proof",
      intent: "Require current-attempt evidence for Goal completion",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Attempt-bound goal",
    });
    const operationId = randomUUID();
    const sourceRevision = "goal-proof-revision";
    const now = new Date();
    const created = await createAiExecution({
      userId: "test-user",
      projectId,
      goalId: goal.body.id,
      attempt: 0,
      correlationId: operationId,
      idempotencyKey: `goal-attempt-proof-${randomUUID()}`,
      request: {
        projectId,
        operationId,
        message: "Verify the current Goal proof",
        modelMessage: "Verify the current Goal proof",
        workspaceRevision: sourceRevision,
        validationTargetPaths: [],
        proofRequired: true,
      },
    });
    const executionId = created.execution.id;
    const attempt = created.execution.attempt;
    const evidenceSnapshotId = randomUUID();
    const proof = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId,
      sourceRevision,
      candidateIdentity: null,
    });

    await db.update(aiExecutionsTable).set({
      status: "completed",
      baseRevision: sourceRevision,
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiExecutionsTable.id, executionId));
    await db.insert(aiExecutionEvidenceSnapshotsTable).values({
      id: evidenceSnapshotId,
      executionId,
      projectId,
      attempt: attempt + 1,
      operationId,
      sourceRevision,
      candidateIdentity: null,
      verdict: "PROVEN",
      complete: 1,
      readCount: 1,
      totalBytes: 64,
      createdAt: now,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: randomUUID(),
      executionId,
      projectId,
      attempt,
      finalizationKey: `goal-attempt-proof-${executionId}`,
      operationId,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "COMPLETED",
      nextActionCode: "NONE",
      disposition: { proof },
      evidenceSnapshotId,
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
      sourceRevision,
      candidateIdentity: null,
      createdAt: now,
    });

    const goalAcceptance = {
      executionId,
      attempt,
      sourceRevision,
      evidenceSnapshotId,
      evidenceRequired: true,
      evidenceComplete: true,
      scope: { operationId },
      disposition: { proof },
    };
    await db.update(aiGoalsTable).set({
      outcomeContract: { acceptance: goalAcceptance },
    }).where(eq(aiGoalsTable.id, goal.body.id));

    const canonicalProof = await db.transaction((tx) => loadCanonicalProof({
      tx,
      executionId,
      attempt,
      scope: {
        projectId,
        goalId: goal.body.id,
        executionId,
        operationId,
        sourceRevision,
        sourceRevisionBinding: "scope",
        candidateIdentityBinding: "not_applicable",
      },
      goalStatus: "completed",
    }));
    expect(canonicalProof.accepted).toBe(false);
    expect(canonicalProof.verdict).not.toBe("PROVEN");
    expect(canonicalProof.failureReasons).toContain("missing_evidence_snapshot");

    const patched = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({ title: "Should roll back", status: "completed" });

    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe("GOAL_COMPLETION_REQUIRES_PROOF");
    const [persisted] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goal.body.id));
    expect(persisted?.title).toBe("Attempt-bound goal");
    expect(persisted?.status).not.toBe("completed");
    expect(persisted?.outcomeContract).toMatchObject({
      acceptance: { executionId, evidenceSnapshotId, disposition: { proof: { verdict: "PROVEN" } } },
    });
  });

  it("rolls back Mission edits when completion is still unproven", async () => {
    const projectId = await insertProject();
    const created = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Unproven mission",
      intent: "Keep failed completion edits atomic",
    });

    const patched = await request(app)
      .patch(`/api/ai/missions/${created.body.id}`)
      .send({ title: "Should roll back", status: "completed" });

    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe("MISSION_COMPLETION_REQUIRES_PROOF");
    const [persisted] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, created.body.id));
    expect(persisted?.title).toBe("Unproven mission");
    expect(persisted?.status).toBe("draft");
  });

  it("rejects invalid goal parent updates and empty patches", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Parent validation",
      intent: "Keep hierarchy safe",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Child candidate",
    });

    const emptyMissionPatch = await request(app).patch(`/api/ai/missions/${mission.body.id}`).send({});
    expect(emptyMissionPatch.status).toBe(400);

    const selfParent = await request(app).patch(`/api/ai/goals/${goal.body.id}`).send({
      parentGoalId: goal.body.id,
    });
    expect(selfParent.status).toBe(400);

    const missingParent = await request(app).patch(`/api/ai/goals/${goal.body.id}`).send({
      parentGoalId: randomUUID(),
    });
    expect(missingParent.status).toBe(400);
  });

  it("rejects untyped goal next actions", async () => {
    const projectId = await insertProject();
    const mission = await request(app).post("/api/ai/missions").send({
      projectId,
      title: "Typed actions",
      intent: "Keep goal dispatch server-owned",
    });
    const goal = await request(app).post(`/api/ai/missions/${mission.body.id}/goals`).send({
      title: "Dispatch safely",
    });

    const response = await request(app)
      .patch(`/api/ai/goals/${goal.body.id}`)
      .send({
        nextAction: {
          owner: "operator",
          action: "approve",
        },
      });

    expect(response.status).toBe(400);
  });

  it("does not create or reveal missions for another project owner", async () => {
    const foreignProjectId = await insertProject("another-user");
    const create = await request(app).post("/api/ai/missions").send({
      projectId: foreignProjectId,
      title: "Should be rejected",
      intent: "No cross-owner access",
    });
    expect(create.status).toBe(403);

    const missionId = randomUUID();
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId: foreignProjectId,
      userId: "another-user",
      title: "Foreign mission",
      intent: "Hidden",
      scope: { kind: "project", projectId: foreignProjectId },
    });
    const get = await request(app).get(`/api/ai/missions/${missionId}`);
    expect(get.status).toBe(404);

    const foreignGoalId = randomUUID();
    await db.insert(aiGoalsTable).values({
      id: foreignGoalId,
      missionId,
      projectId: foreignProjectId,
      title: "Foreign goal",
    });
    const patch = await request(app).patch(`/api/ai/goals/${foreignGoalId}`).send({
      title: "Should remain hidden",
    });
    expect(patch.status).toBe(404);
  });
});