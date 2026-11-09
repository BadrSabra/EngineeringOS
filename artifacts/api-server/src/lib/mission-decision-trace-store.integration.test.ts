import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import request from "supertest";
import app from "../app.js";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiGoalDependenciesTable,
  aiExecutionAcceptancesTable,
  aiExecutionEvidenceSnapshotsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionDecisionEventsTable,
  aiMissionDecisionDispatchBatchesTable,
  aiMissionDecisionDispatchItemsTable,
  aiMissionDecisionOutcomeSnapshotsTable,
  aiMissionDecisionShadowComparisonsTable,
  aiMissionDecisionTracesTable,
  aiMissionsTable,
  aiWorldFactsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  canonicalJsonHash,
  buildMissionStrategyShadowComparison,
  classifyExpectedStateChanges,
  evaluateMissionStrategies,
  hashMissionDecisionTrace,
  hashMissionDecisionContext,
  hashMissionStrategyAlternative,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  MissionDecisionTraceSchema,
  MissionStrategyPlanOutcomeEvaluationSchema,
  MissionStrategyShadowComparisonSchema,
} from "@workspace/ai-orchestrator";
const { missionRunner } = vi.hoisted(() => ({
  missionRunner: vi.fn(),
}));

vi.mock("./mission-runtime.js", () => ({
  runMissionGoal: missionRunner,
}));

import type {
  MissionDecisionContext,
  MissionDecisionTrace,
  StrategyDifference,
  MissionStrategyAlternative,
} from "@workspace/ai-orchestrator";
import {
  getProjectWorldState,
  materializeWorldStateForProject,
} from "./agent-state/world-state.js";
import { buildExecutionProofProjection } from "./execution-proof.js";
import {
  appendMissionDecisionLifecycleEvent,
  appendMissionDecisionLifecycleEventInTransaction,
  eventHash,
  getMissionDecisionTrace,
  getMissionDecisionDispatchBatch,
  MissionDecisionTraceStoreError,
  persistMissionDecisionTrace,
  persistMissionDecisionTraceInTransaction,
  recordMissionDecisionDispatchBatch,
  recordMissionDecisionDispatchBatchInTransaction,
} from "./mission-decision-trace-store.js";
import {
  BOUNDED_EFFECT_CODE,
  BOUNDED_EFFECT_MARKER_PATH,
  boundedEffectActionKey,
  readSyntheticMarker,
  reverseSyntheticMarker,
  seedSyntheticMarker,
  type BoundedEffectCrashPoint,
} from "../test/mission-bounded-effect-executor.js";
import { approveMissionGoal } from "./mission-approval.js";
import { reconcileApprovedMissionDecisionDispatches } from "./mission-auto-replan.js";
import {
  evaluateAndPersistMissionPlanOutcome,
  finalizeMissionPlanOutcome,
  reconcilePendingMissionPlanOutcomes,
} from "./mission-strategy-plan-outcome-store.js";
import {
  getPendingMissionDecisionShadowQueueStats,
  persistMissionDecisionShadowComparison,
  reconcilePendingMissionDecisionShadows,
} from "./mission-strategy-shadow-store.js";

const projectIds: string[] = [];
const syntheticWorkspaceRoots: string[] = [];
const now = new Date("2026-11-03T10:00:00.000Z");
const unknownConfidence = { status: "unknown" as const, value: null, calibrationRef: null };

async function expectMissionOutcomeSnapshotMutationRejected(
  operation: PromiseLike<unknown>,
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error("expected Mission outcome snapshot mutation to be rejected");
  const cause = (caught as { cause?: { code?: string; message?: string } }).cause;
  expect(cause?.code).toBe("55000");
  expect(cause?.message).toContain("mission decision outcome snapshots are immutable");
}

async function createSyntheticWorkspace(projectId: string): Promise<string> {
  const workspaceBase = path.resolve(process.cwd(), "../../.test-roots");
  await mkdir(workspaceBase, { recursive: true });
  const rootPath = await mkdtemp(path.join(workspaceBase, `mission-journey-${projectId.slice(0, 8)}-`));
  syntheticWorkspaceRoots.push(rootPath);
  await writeFile(path.join(rootPath, "README.md"), "# Isolated Mission journey\n");
  return rootPath;
}

function makeTrace(input: {
  projectId: string;
  missionId: string;
  goalId: string;
  executionId: string;
  acceptanceId: string;
}): MissionDecisionTrace {
  const context = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    identity: {
      projectId: input.projectId,
      missionId: input.missionId,
      goalId: input.goalId,
      trigger: "recovery" as const,
      sourceExecutionId: input.executionId,
      sourceAttempt: 2,
      sourceAcceptanceId: input.acceptanceId,
      priorPlanRevision: "decision-plan-revision",
      projectRevision: "decision-project-revision",
      worldStateRevision: null,
      environmentRevision: null,
    },
    objectiveCode: "recover_current_goal",
    capturedAt: now.toISOString(),
    failureDiagnoses: [{
      kind: "insufficient_evidence" as const,
      code: "test_requires_more_evidence",
      knowledgeClass: "SERVER_DERIVED" as const,
      evidenceIds: [input.acceptanceId],
      confidence: unknownConfidence,
    }],
    rootCauseHypotheses: [],
    evidenceRefs: [{
      evidenceId: input.acceptanceId,
      kind: "acceptance" as const,
      knowledgeClass: "SERVER_DERIVED" as const,
      provenanceCode: "canonical_acceptance",
      scope: {
        projectId: input.projectId,
        missionId: input.missionId,
        goalId: input.goalId,
        executionId: input.executionId,
        attempt: 2,
      },
      timestamp: now.toISOString(),
      freshness: "fresh" as const,
      revisions: {
        project: "decision-project-revision",
        worldState: null,
        environment: null,
      },
      confidence: unknownConfidence,
      eligibility: "eligible" as const,
      eligibilityReasonCodes: [],
      contentHash: "a".repeat(64),
    }],
    authorization: { status: "allowed" as const, policyRef: "server-policy:test", reasonCodes: [] },
    approval: {
      status: "not_required" as const,
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
    preconditionFindings: [],
    availableCapabilities: [],
    unavailableCapabilities: [],
    unknownCapabilities: [],
    unresolvedQuestionCodes: [],
    requiredObservationCodes: [],
  };
  const parsedContext = MissionDecisionContextSchema.parse(context);
  const body = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    context: parsedContext,
    contextHash: hashMissionDecisionContext(parsedContext),
    alternatives: [],
    differences: [],
    evaluations: [],
    result: { kind: "NO_DECISION" as const, selectedStrategyId: null, reasonCode: "insufficient_evidence" as const },
    lifecycle: [
      { stage: "PROPOSED" as const, at: now.toISOString(), referenceId: null },
      { stage: "EVALUATED" as const, at: now.toISOString(), referenceId: null },
    ],
    uncertaintyCodes: ["test_evidence_incomplete"],
    decisionConfidence: unknownConfidence,
    policyVersion: "test-policy",
    evaluatorVersion: "test-evaluator",
    modelProvenance: null,
    priorPlanRevision: "decision-plan-revision",
    newPlanRevision: null,
    dispatchRef: null,
    decidedAt: now.toISOString(),
  };
  return MissionDecisionTraceSchema.parse({
    decisionId: hashMissionDecisionTrace(body),
    ...body,
  });
}

function makeStrategy(
  strategyId: string,
  capabilityId: string,
  risk: "low" | "medium",
  expectedEffectCodes: string[] = [],
): MissionStrategyAlternative {
  return MissionStrategyAlternativeSchema.parse({
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    strategyId,
    version: 1,
    category: "verify_then_retry",
    source: "server_rule",
    candidateRef: null,
    intendedObjectiveCode: "recover_current_goal",
    requiredCapabilities: [capabilityId],
    requiredEvidenceKinds: ["acceptance", "world_state_fact"],
    preconditionCodes: ["source_execution_attempt_bound", "world_state_revision_matches"],
    expectedActions: [{ planStepId: "inspect", capabilityId, effectClass: "read_only" }],
    expectedObservationCodes: ["current_world_state"],
    expectedEffectCodes,
    validationProcedureCodes: ["canonical_acceptance"],
    stepDependencies: [{ stepId: "inspect", dependsOnStepIds: [] }],
    resourceEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    durationEstimate: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    expectedExecutionCost: { status: "unknown", value: null, unit: "none", confidence: unknownConfidence, evidenceRefIds: [] },
    risk,
    reversibility: "reversible",
    failureModeCodes: [],
    approvalRequirement: "not_required",
    assumptionCodes: [],
    limitationCodes: [],
  });
}

function makeSelectedTrace(input: {
  trace: MissionDecisionTrace;
  worldStateRevision: string;
  worldFactId: string;
  worldFactHash: string;
  expectedEffectCodes?: string[];
  newPlanRevision?: string | null;
}): MissionDecisionTrace {
  const baseContext = input.trace.context;
  const context: MissionDecisionContext = MissionDecisionContextSchema.parse({
    ...baseContext,
    identity: {
      ...baseContext.identity,
      worldStateRevision: input.worldStateRevision,
    },
    evidenceRefs: [
      ...baseContext.evidenceRefs,
      {
        evidenceId: input.worldFactId,
        kind: "world_state_fact",
        knowledgeClass: "SERVER_DERIVED",
        provenanceCode: "confirmed_current_world_fact",
        scope: {
          projectId: baseContext.identity.projectId,
          missionId: baseContext.identity.missionId,
          goalId: baseContext.identity.goalId,
          executionId: null,
          attempt: null,
        },
        timestamp: now.toISOString(),
        freshness: "fresh",
        revisions: {
          project: baseContext.identity.projectRevision,
          worldState: input.worldStateRevision,
          environment: null,
        },
        confidence: unknownConfidence,
        eligibility: "eligible",
        eligibilityReasonCodes: [],
        contentHash: input.worldFactHash,
      },
    ],
    preconditionFindings: [
      {
        code: "source_execution_attempt_bound",
        status: "satisfied",
        evidenceRefIds: [input.trace.context.identity.sourceAcceptanceId],
      },
      {
        code: "world_state_revision_matches",
        status: "satisfied",
        evidenceRefIds: [input.worldFactId],
      },
    ],
    availableCapabilities: ["tool.read.one", "tool.read.two"],
  });
  const alternatives = [
    makeStrategy(
      "safe-read-one",
      "tool.read.one",
      "low",
      input.expectedEffectCodes ?? [],
    ),
    makeStrategy("safe-read-two", "tool.read.two", "medium"),
  ];
  const evaluated = evaluateMissionStrategies({
    context,
    alternatives,
    evaluatedAt: now.toISOString(),
  });
  if (evaluated.result.kind !== "SELECTED") {
    throw new Error(`test fixture expected a deterministic selection, got ${evaluated.result.kind}`);
  }
  const body = {
    schemaVersion: MISSION_DECISION_SCHEMA_VERSION,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives,
    differences: [{
      leftStrategyId: "safe-read-one",
      rightStrategyId: "safe-read-two",
      classification: "GENUINELY_DIFFERENT" as const,
      changedDimensions: ["tool_selection"] as StrategyDifference["changedDimensions"],
      reasonCodes: ["different_read_capabilities"],
    }],
    evaluations: evaluated.evaluations,
    result: evaluated.result,
    lifecycle: [
      { stage: "PROPOSED" as const, at: now.toISOString(), referenceId: null },
      { stage: "EVALUATED" as const, at: now.toISOString(), referenceId: null },
      { stage: "SELECTED" as const, at: now.toISOString(), referenceId: "safe-read-one" },
    ],
    uncertaintyCodes: ["success_probability_uncalibrated"],
    decisionConfidence: unknownConfidence,
    policyVersion: evaluated.policyVersion,
    evaluatorVersion: evaluated.policyVersion,
    modelProvenance: null,
    priorPlanRevision: context.identity.priorPlanRevision,
    newPlanRevision: input.newPlanRevision ?? null,
    dispatchRef: null,
    decidedAt: now.toISOString(),
  };
  return MissionDecisionTraceSchema.parse({
    decisionId: hashMissionDecisionTrace(body),
    ...body,
  });
}

function makeApprovalRequiredTrace(
  trace: MissionDecisionTrace,
  stepId: string,
): MissionDecisionTrace {
  if (trace.result.kind !== "SELECTED") {
    throw new Error("approval trace fixture requires a selected strategy");
  }
  const selected = trace.alternatives.find(
    ({ strategyId }) => strategyId === trace.result.selectedStrategyId,
  );
  if (!selected) throw new Error("approval trace fixture strategy is missing");
  const selectedStrategy = MissionStrategyAlternativeSchema.parse({
    ...selected,
    expectedActions: [{
      planStepId: stepId,
      capabilityId: selected.requiredCapabilities[0],
      effectClass: "reversible_mutation",
    }],
    stepDependencies: [{ stepId, dependsOnStepIds: [] }],
    approvalRequirement: "required",
  });
  const context = MissionDecisionContextSchema.parse({
    ...trace.context,
    approval: {
      status: "required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
  });
  const evaluations = trace.evaluations
    .filter(({ strategyId }) => strategyId === selectedStrategy.strategyId)
    .map((evaluation) => ({
      ...evaluation,
      strategyHash: hashMissionStrategyAlternative(selectedStrategy),
    }));
  const body = {
    schemaVersion: trace.schemaVersion,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives: [selectedStrategy],
    differences: [],
    evaluations,
    result: trace.result,
    lifecycle: trace.lifecycle,
    uncertaintyCodes: trace.uncertaintyCodes,
    decisionConfidence: trace.decisionConfidence,
    policyVersion: trace.policyVersion,
    evaluatorVersion: trace.evaluatorVersion,
    modelProvenance: trace.modelProvenance,
    priorPlanRevision: trace.priorPlanRevision,
    newPlanRevision: trace.newPlanRevision,
    dispatchRef: null,
    decidedAt: trace.decidedAt,
  };
  return MissionDecisionTraceSchema.parse({
    decisionId: hashMissionDecisionTrace(body),
    ...body,
  });
}

async function createFixture(projectId: string = randomUUID()) {
  const missionId = randomUUID();
  const goalId = randomUUID();
  const executionId = randomUUID();
  const acceptanceId = randomUUID();
  const worldFactId = randomUUID();
  const worldFactHash = "c".repeat(64);
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "test-user",
    name: `decision-trace-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/decision-trace-${projectId}`,
    language: "typescript",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "test-user",
    title: "Test decision trace identity",
    intent: "Keep the trace attached to the exact Goal and revision.",
    status: "needs_replan",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: "decision-plan-revision" },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Test recovery decision",
    status: "needs_replan",
    successCriteria: { planRevision: { hash: "decision-plan-revision" } },
    evidenceContract: { required: true },
    outcomeContract: { planRevision: { hash: "decision-plan-revision" } },
    nextAction: { kind: "replan" },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId,
    goalId,
    userId: "test-user",
    idempotencyKey: `decision-trace-${executionId}`,
    resumeTokenHash: "b".repeat(64),
    request: "{}",
    checkpoint: "{}",
    attempt: 2,
    status: "failed",
    baseRevision: "decision-project-revision",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId,
    projectId,
    attempt: 2,
    finalizationKey: `decision-trace-finalize-${acceptanceId}`,
    terminalStatus: "failed",
    outcome: "incomplete",
    reasonCode: "evidence_incomplete",
    nextActionCode: "gather_evidence",
    evidenceRequired: 1,
    evidenceComplete: 0,
    resumable: 1,
    sourceRevision: "decision-project-revision",
    createdAt: now,
  });
  await db.insert(aiWorldFactsTable).values({
    id: worldFactId,
    projectId,
    taskScope: "project",
    environmentRevisionKey: "unknown",
    subject: "runtime",
    predicate: "status",
    value: { state: "known" },
    valueHash: worldFactHash,
    version: 1,
    status: "confirmed",
    sourceObservationIds: [],
    projectRevision: "decision-project-revision",
    environmentRevision: null,
    environmentFreshness: "fresh",
    createdAt: now,
    updatedAt: now,
  });
  const worldState = await getProjectWorldState(projectId);

  return {
    projectId,
    missionId,
    goalId,
    executionId,
    acceptanceId,
    worldFactId,
    worldFactHash,
    worldStateRevision: worldState.worldRevision,
    trace: makeTrace({ projectId, missionId, goalId, executionId, acceptanceId }),
  };
}

async function createPersistedEffectOutcomeFixture(
  outcome: "ACHIEVED" | "NOT_ACHIEVED",
  requireApproval = false,
  projectId?: string,
) {
  const fixture = await createFixture(projectId);
  const sourceRevision = "decision-project-revision";
  const beforeObservationId = randomUUID();
  const afterObservationId = randomUUID();
  const episodeId = randomUUID();
  const effectId = randomUUID();
  const bundleId = randomUUID();
  const goalId = randomUUID();
  const executionId = randomUUID();
  const acceptanceId = randomUUID();
  const taskId = randomUUID();
  const evidenceSnapshotId = randomUUID();
  const planRevision = `auto:${randomUUID()}:${"e".repeat(64)}`;
  const completedAt = new Date(now.getTime() + 30_000);
  const achieved = outcome === "ACHIEVED";
  const executionStatus = achieved ? "completed" : "failed";
  const acceptanceOutcome = achieved ? "SUCCEEDED" : "FAILED";
  const terminalStatus = achieved ? "completed" : "failed";
  const beforeValue = { state: achieved ? "stopped" : "running" };
  const afterValue = { state: achieved ? "running" : "stopped" };
  const expectedStateChanges = [{
    subject: "runtime",
    predicate: "status",
    expectedValue: { state: "running" },
  }];
  const beforeEvidence = {
    observationId: beforeObservationId,
    observationRole: "before" as const,
    subject: "runtime",
    predicate: "status",
    value: beforeValue,
    evidenceRefs: [beforeObservationId],
    provenance: "DIRECT_OBSERVATION" as const,
    completeness: "complete" as const,
    freshness: "fresh" as const,
  };
  const afterEvidence = {
    observationId: afterObservationId,
    observationRole: "after" as const,
    subject: "runtime",
    predicate: "status",
    value: afterValue,
    evidenceRefs: [afterObservationId],
    provenance: "DIRECT_OBSERVATION" as const,
    completeness: "complete" as const,
    freshness: "fresh" as const,
  };
  const classification = classifyExpectedStateChanges({
    expectedStateChanges,
    before: [beforeEvidence],
    after: [afterEvidence],
  });
  const expectedEffectStatus = achieved ? "observed" : "contradicted";
  if (classification.status !== expectedEffectStatus) {
    throw new Error(`fixture effect classification mismatch: ${classification.status}`);
  }
  const effectContractHash = canonicalJsonHash({
    expectedStateChanges,
    observationProfile: "RUNTIME",
    requiredEvidence: [beforeObservationId, afterObservationId],
  });
  const proof = buildExecutionProofProjection({
    outcome: achieved ? "SUCCEEDED" : "FAILED",
    evidenceRequired: true,
    evidenceComplete: true,
    evidenceSnapshotId,
    sourceRevision,
  });
  const acceptanceProjection = {
    executionId,
    sourceRevision,
    evidenceSnapshotId,
    evidenceRequired: true,
    evidenceComplete: true,
    receipt: { kind: "execution_acceptance", id: acceptanceId },
    disposition: { proof },
  };

  await db.update(aiWorldFactsTable).set({
    subject: "fixture",
    predicate: "seed",
  }).where(eq(aiWorldFactsTable.id, fixture.worldFactId));
  const initialWorldState = await getProjectWorldState(fixture.projectId);
  const selectedTraceBase = makeSelectedTrace({
    trace: fixture.trace,
    worldStateRevision: initialWorldState.worldRevision,
    worldFactId: fixture.worldFactId,
    worldFactHash: fixture.worldFactHash,
    expectedEffectCodes: ["runtime.status"],
    newPlanRevision: planRevision,
  });
  const stepId = "runtime-effect";
  const selectedTrace = requireApproval
    ? makeApprovalRequiredTrace(selectedTraceBase, stepId)
    : selectedTraceBase;
  const planSnapshot = {
    hash: planRevision,
    decisionTraceId: selectedTrace.decisionId,
    strategyDecision: {
      selectedStrategyId: selectedTrace.result.kind === "SELECTED"
        ? selectedTrace.result.selectedStrategyId
        : null,
    },
    steps: [{
      id: stepId,
      kind: "execute",
      title: "Verify the synthetic runtime state",
      dependencies: [],
      files: ["README.md"],
      readOnly: !requireApproval,
      approvalRequired: requireApproval,
    }],
  };
  await persistMissionDecisionTrace(selectedTrace);
  await db.update(aiMissionsTable).set({
    status: requireApproval ? "waiting" : "active",
    autonomyPolicy: { activePlanRevision: planRevision },
  }).where(eq(aiMissionsTable.id, fixture.missionId));
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: `Persisted ${outcome} outcome`,
    status: requireApproval
      ? "waiting_for_approval"
      : achieved ? "completed" : "failed",
    successCriteria: {
      ...(requireApproval ? { kind: "mission_plan_step", stepId } : {}),
      planRevision: planSnapshot,
    },
    evidenceContract: { required: true },
    outcomeContract: {
      stepId,
      planRevision: planSnapshot,
      ...(requireApproval
        ? {
            planApproval: {
              kind: "mission_plan_step",
              state: "PENDING",
              planRevision,
              stepId,
            },
          }
        : { acceptance: acceptanceProjection }),
    },
    nextAction: requireApproval
      ? { kind: "wait", reason: "approval", wakeAt: null }
      : { kind: achieved ? "complete" : "diagnose" },
    createdAt: now,
    updatedAt: completedAt,
    completedAt: requireApproval ? null : completedAt,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId: fixture.projectId,
    goalId,
    title: `Persisted ${outcome} Mission task`,
    description: "Synthetic terminal task for Mission outcome recovery.",
    status: requireApproval ? "pending" : achieved ? "completed" : "failed",
    priority: "p1",
    phase: "execute",
    prompt: "Recover the durable Mission outcome without replaying work.",
    createdAt: now,
    updatedAt: completedAt,
    completedAt: requireApproval ? null : completedAt,
  });
  if (requireApproval) {
    await db.update(projectsTable)
      .set({ rootPath: await createSyntheticWorkspace(fixture.projectId) })
      .where(eq(projectsTable.id, fixture.projectId));
    missionRunner.mockImplementation(async ({ goalId: approvedGoalId }: { goalId: string }) => ({
      status: "scheduled",
      goalId: approvedGoalId,
      executionId: `controlled-approval:${approvedGoalId}`,
    }));
    const beforeApproval = await getMissionDecisionTrace(selectedTrace.decisionId);
    expect(beforeApproval?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED"]);
    const projection = await request(app)
      .get(`/api/ai/missions/${fixture.missionId}/projection`);
    expect(projection.status).toBe(200);
    expect(projection.body.engineeringAgent.nextAction).toMatchObject({
      kind: "APPROVE",
      target: { kind: "goal", id: goalId },
    });
    const approvalBody = {
      idempotencyKey: randomUUID(),
      expectedDecision: projection.body.engineeringAgent.nextAction,
    };
    const approval = await request(app)
      .post(`/api/ai/missions/${fixture.missionId}/agent/action`)
      .send(approvalBody);
    expect([200, 202]).toContain(approval.status);
    expect(approval.body).toMatchObject({
      outcome: expect.stringMatching(/^(accepted|completed)$/),
      idempotentReplay: false,
      operation: { goalId, planRevision, status: "scheduled" },
    });
    const approvalReplay = await request(app)
      .post(`/api/ai/missions/${fixture.missionId}/agent/action`)
      .send(approvalBody);
    expect(approvalReplay.status).toBe(approval.status);
    expect(approvalReplay.body.idempotentReplay).toBe(true);
    expect(missionRunner).toHaveBeenCalledTimes(1);
    const approvalEventCount = await db.select({ id: aiMissionDecisionEventsTable.id })
      .from(aiMissionDecisionEventsTable)
      .where(and(
        eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId),
        eq(aiMissionDecisionEventsTable.stage, "APPROVED"),
      ));
    expect(approvalEventCount).toHaveLength(1);
    expect(approval.body.operation).toMatchObject({
      goalId,
      planRevision,
      status: "scheduled",
    });
    const afterApproval = await getMissionDecisionTrace(selectedTrace.decisionId);
    expect(afterApproval?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED", "APPROVED", "PLAN_APPLIED"]);
    const [approvedGoal] = await db.select({
      outcomeContract: aiGoalsTable.outcomeContract,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, goalId));
    const approvedContract = approvedGoal?.outcomeContract as Record<string, unknown> | undefined;
    expect(approvedContract).toMatchObject({
      planApproval: {
        kind: "mission_plan_step",
        state: "APPROVED",
        planRevision,
        stepId,
        approvedBy: "test-user",
      },
    });
    await db.update(aiGoalsTable).set({
      status: terminalStatus,
      outcomeContract: {
        ...(approvedContract ?? {}),
        stepId,
        planRevision: planSnapshot,
        acceptance: acceptanceProjection,
      },
      nextAction: { kind: achieved ? "complete" : "diagnose" },
      updatedAt: completedAt,
      completedAt,
    }).where(eq(aiGoalsTable.id, goalId));
    await db.update(tasksTable).set({
      status: terminalStatus,
      updatedAt: completedAt,
      completedAt,
    }).where(eq(tasksTable.id, taskId));
  } else {
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 1_000),
    });
  }
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId: fixture.projectId,
    goalId,
    userId: "test-user",
    idempotencyKey: `outcome-${outcome}-${executionId}`,
    resumeTokenHash: "d".repeat(64),
    request: "{}",
    checkpoint: "{}",
    attempt: 1,
    status: executionStatus,
    linkedTaskId: taskId,
    baseRevision: sourceRevision,
    createdAt: now,
    updatedAt: completedAt,
    completedAt,
  });
  await db.insert(aiExecutionEvidenceSnapshotsTable).values({
    id: evidenceSnapshotId,
    executionId,
    projectId: fixture.projectId,
    attempt: 1,
    sourceRevision,
    verdict: proof.verdict,
    complete: 1,
    readCount: 1,
    totalBytes: 0,
    createdAt: completedAt,
  });
  await db.insert(aiAgentEpisodesTable).values({
    id: episodeId,
    projectId: fixture.projectId,
    executionId,
    attempt: 1,
    missionId: fixture.missionId,
    goalId,
    projectRevision: sourceRevision,
    intentKind: "test_effect_outcome",
    scope: { kind: "project", projectId: fixture.projectId },
    workerId: "mission-outcome-test",
    leaseUntil: new Date(completedAt.getTime() + 60_000),
    idempotencyKey: `effect-outcome-${executionId}`,
    createdAt: now,
    updatedAt: completedAt,
    closedAt: completedAt,
  });
  const observationRevision = achieved
    ? ["before-project-revision", sourceRevision]
    : [sourceRevision, sourceRevision];
  await db.insert(aiAgentObservationsTable).values([
    {
      id: beforeObservationId,
      projectId: fixture.projectId,
      executionId,
      episodeId,
      taskScope: "project",
      environmentRevisionKey: "unknown",
      kind: "runtime",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "before",
      sourceType: "mission-outcome-test",
      sourceId: beforeObservationId,
      sourceVersion: "1",
      subject: "runtime",
      predicate: "status",
      value: beforeValue,
      valueHash: canonicalJsonHash(beforeValue),
      sourceRefs: [],
      observedAt: now,
      projectRevision: observationRevision[0]!,
      environmentRevision: null,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [beforeObservationId],
      sequence: 0,
      createdAt: now,
    },
    {
      id: afterObservationId,
      projectId: fixture.projectId,
      executionId,
      episodeId,
      taskScope: "project",
      environmentRevisionKey: "unknown",
      kind: "runtime",
      provenance: "DIRECT_OBSERVATION",
      observationRole: "after",
      sourceType: "mission-outcome-test",
      sourceId: afterObservationId,
      sourceVersion: "1",
      subject: "runtime",
      predicate: "status",
      value: afterValue,
      valueHash: canonicalJsonHash(afterValue),
      sourceRefs: [],
      observedAt: completedAt,
      projectRevision: observationRevision[1]!,
      environmentRevision: null,
      completeness: "complete",
      freshness: "fresh",
      environmentFreshness: "fresh",
      evidenceRefs: [afterObservationId],
      sequence: 1,
      createdAt: completedAt,
    },
  ]);
  await materializeWorldStateForProject(fixture.projectId, {
    observationIds: [beforeObservationId, afterObservationId],
  });
  const currentWorldState = await getProjectWorldState(fixture.projectId);
  await db.insert(aiAgentEffectsTable).values({
    id: effectId,
    projectId: fixture.projectId,
    executionId,
    episodeId,
    attempt: 1,
    actionId: "verify-runtime-status",
    capabilityId: "runtime.inspect",
    effectContractHash,
    beforeObservationIds: [beforeObservationId],
    afterObservationIds: [afterObservationId],
    expectedEffects: expectedStateChanges,
    status: classification.status,
    missingEffects: classification.missingEffects,
    contradictionRefs: classification.contradictionRefs,
    evidenceRefs: classification.evidenceRefs,
    createdAt: completedAt,
  });
  await db.insert(aiAgentEffectBundlesTable).values({
    id: bundleId,
    projectId: fixture.projectId,
    executionId,
    attempt: 1,
    episodeId,
    effectIds: [effectId],
    effectContractHashes: [effectContractHash],
    verdict: achieved ? "OBSERVED" : "CONTRADICTED",
    worldRevision: currentWorldState.worldRevision,
    createdAt: completedAt,
  });
  await db.insert(aiExecutionAcceptancesTable).values({
    id: acceptanceId,
    executionId,
    projectId: fixture.projectId,
    attempt: 1,
    finalizationKey: `outcome-finalize-${acceptanceId}`,
    terminalStatus,
    outcome: acceptanceOutcome,
    reasonCode: achieved ? "proof_complete" : "runtime_effect_contradicted",
    nextActionCode: achieved ? "complete_plan" : "review_failure",
    evidenceSnapshotId,
    evidenceRequired: 1,
    evidenceComplete: 1,
    resumable: 0,
    disposition: { proof },
    sourceRevision,
    effectBundleId: bundleId,
    createdAt: completedAt,
  });
  const dispatch = await recordMissionDecisionDispatchBatch({
    decisionId: selectedTrace.decisionId,
    planRevision,
    occurredAt: requireApproval
      ? new Date(Date.now() + 2_000)
      : new Date(now.getTime() + 2_000),
    items: [{
      position: 0,
      goalId,
      executionId,
      runStatus: "scheduled",
    }],
  });
  if (dispatch.batch.kind !== "inserted") {
    throw new Error("outcome fixture dispatch batch was not inserted");
  }

  return {
    ...fixture,
    decisionId: selectedTrace.decisionId,
    goalId,
    executionId,
    acceptanceId,
    bundleId,
    effectId,
    evidenceSnapshotId,
    afterObservationId,
    taskId,
    expectedEffectStatus,
  };
}

async function createDispatchedPendingOutcomeFixture() {
  const fixture = await createFixture();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const executionId = randomUUID();
  const planRevision = `auto:${randomUUID()}:${"b".repeat(64)}`;
  const selectedTrace = makeSelectedTrace({
    trace: fixture.trace,
    worldStateRevision: fixture.worldStateRevision,
    worldFactId: fixture.worldFactId,
    worldFactHash: fixture.worldFactHash,
    expectedEffectCodes: ["runtime.status"],
    newPlanRevision: planRevision,
  });
  await persistMissionDecisionTrace(selectedTrace);
  await db.update(aiMissionsTable).set({
    autonomyPolicy: { activePlanRevision: planRevision },
  }).where(eq(aiMissionsTable.id, fixture.missionId));
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: "Pending successor Goal without outcome proof",
    status: "queued",
    successCriteria: { planRevision: { hash: planRevision } },
    evidenceContract: { required: true },
    outcomeContract: { planRevision: { hash: planRevision } },
    nextAction: { kind: "execute" },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId: fixture.projectId,
    goalId,
    title: "Pending task without outcome proof",
    description: "Must remain pending until adequate evidence is available.",
    status: "queued",
    priority: "p1",
    phase: "execute",
    prompt: "Wait for execution and evidence.",
    createdAt: now,
    updatedAt: now,
  });
  await appendMissionDecisionLifecycleEvent({
    decisionId: selectedTrace.decisionId,
    stage: "PLAN_APPLIED",
    referenceId: planRevision,
    occurredAt: new Date(now.getTime() + 1_000),
  });
  await db.insert(aiExecutionsTable).values({
    id: executionId,
    projectId: fixture.projectId,
    goalId,
    userId: "test-user",
    idempotencyKey: `pending-outcome-${executionId}`,
    resumeTokenHash: "e".repeat(64),
    request: "{}",
    checkpoint: "{}",
    attempt: 1,
    status: "queued",
    linkedTaskId: taskId,
    baseRevision: "decision-project-revision",
    createdAt: now,
    updatedAt: now,
  });
  const dispatch = await recordMissionDecisionDispatchBatch({
    decisionId: selectedTrace.decisionId,
    planRevision,
    occurredAt: new Date(now.getTime() + 2_000),
    items: [{
      position: 0,
      goalId,
      executionId,
      runStatus: "scheduled",
    }],
  });
  if (dispatch.batch.kind !== "inserted") {
    throw new Error("pending outcome fixture dispatch batch was not inserted");
  }
  return {
    ...fixture,
    decisionId: selectedTrace.decisionId,
    goalId,
    taskId,
    executionId,
  };
}

async function runMissionOutcomeRecoveryProcess(input: {
  projectId: string;
  crashAfterCommit?: boolean;
}): Promise<{ code: number | null; output: string }> {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Mission outcome recovery requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Mission outcome recovery is restricted to a loopback PostgreSQL database.");
  }
  const applicationName = `mission-outcome-recovery-${randomUUID()}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const reconcilerUrl = new URL("./mission-strategy-plan-outcome-store.ts", import.meta.url).href;
  const source = [
    "(async () => {",
    `  const { reconcilePendingMissionPlanOutcomes } = await import(${JSON.stringify(reconcilerUrl)});`,
    `  const count = await reconcilePendingMissionPlanOutcomes(16, ${JSON.stringify(input.projectId)});`,
    '  process.stdout.write(`MISSION_OUTCOME_RECONCILED:${count}\\n`);',
    input.crashAfterCommit ? "  process.exit(73);" : "  process.exit(0);",
    "})().catch((error) => {",
    "  console.error(error);",
    "  process.exit(1);",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      PGAPPNAME: applicationName,
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output += chunk; });
  child.stderr?.on("data", (chunk: string) => { output += chunk; });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Mission outcome recovery process timed out: ${output}`));
    }, 60_000);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`Mission outcome recovery process exited with ${signal}: ${output}`));
      } else {
        resolve({ code, output });
      }
    });
  });
}

async function reserveMissionApiPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not reserve a loopback port for the Mission API process.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function startScopedMissionApiProcess(projectId: string) {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("Mission API restart requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("Mission API restart is restricted to a loopback PostgreSQL database.");
  }
  const applicationName = `mission-api-restart-${randomUUID().slice(0, 8)}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const port = await reserveMissionApiPort();
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "-e",
    'await import("./src/index.ts")',
  ], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      ENGINEERING_AGENT_WORKER_SCOPE_PROJECT_ID: projectId,
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      NODE_ENV: "test",
      PORT: String(port),
      PGAPPNAME: applicationName,
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output += chunk; });
  child.stderr?.on("data", (chunk: string) => { output += chunk; });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const forcedStop = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Scoped Mission API did not stop cleanly: ${output}`));
        }, 10_000);
        timer.unref();
      });
      await Promise.race([exit, forcedStop]);
    } else {
      await exit;
    }
  };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Scoped Mission API exited before readiness: ${JSON.stringify(await exit)}; ${output}`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/readiness`);
      if (response.ok) return { child, port, output: () => output, stop };
    } catch {
      // Startup is still in progress; the bounded deadline prevents hanging.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop().catch(() => undefined);
  throw new Error(`Scoped Mission API did not become ready within 60 seconds: ${output}`);
}


/**
 * Approved Mission plan whose root Goal has not been dispatched yet. The
 * synthetic workspace holds a reversible marker; no execution, observation,
 * effect, or acceptance exists until a (bounded) worker produces them.
 */
async function createApprovedUndispatchedMarkerFixture() {
  const fixture = await createFixture();
  const goalId = randomUUID();
  const taskId = randomUUID();
  const stepId = "synthetic-marker-effect";
  const planRevision = `auto:${randomUUID()}:${"f".repeat(64)}`;
  const rootPath = await createSyntheticWorkspace(fixture.projectId);
  await seedSyntheticMarker(rootPath);
  await db.update(projectsTable).set({ rootPath }).where(eq(projectsTable.id, fixture.projectId));
  await db.update(aiWorldFactsTable).set({
    subject: "fixture",
    predicate: "seed",
  }).where(eq(aiWorldFactsTable.id, fixture.worldFactId));
  const initialWorldState = await getProjectWorldState(fixture.projectId);
  const selectedTrace = makeApprovalRequiredTrace(makeSelectedTrace({
    trace: fixture.trace,
    worldStateRevision: initialWorldState.worldRevision,
    worldFactId: fixture.worldFactId,
    worldFactHash: fixture.worldFactHash,
    expectedEffectCodes: [BOUNDED_EFFECT_CODE],
    newPlanRevision: planRevision,
  }), stepId);
  const planSnapshot = {
    hash: planRevision,
    decisionTraceId: selectedTrace.decisionId,
    strategyDecision: {
      selectedStrategyId: selectedTrace.result.kind === "SELECTED"
        ? selectedTrace.result.selectedStrategyId
        : null,
    },
    steps: [{
      id: stepId,
      kind: "execute",
      title: "Toggle the synthetic marker once",
      dependencies: [],
      files: [BOUNDED_EFFECT_MARKER_PATH],
      readOnly: false,
      approvalRequired: true,
    }],
  };
  await persistMissionDecisionTrace(selectedTrace);
  await db.update(aiMissionsTable).set({
    status: "waiting",
    autonomyPolicy: { activePlanRevision: planRevision },
  }).where(eq(aiMissionsTable.id, fixture.missionId));
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: "Toggle a synthetic marker exactly once",
    status: "waiting_for_approval",
    successCriteria: { kind: "mission_plan_step", stepId, planRevision: planSnapshot },
    evidenceContract: { required: true },
    outcomeContract: {
      stepId,
      planRevision: planSnapshot,
      planApproval: { kind: "mission_plan_step", state: "PENDING", planRevision, stepId },
    },
    nextAction: { kind: "wait", reason: "approval", wakeAt: null },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId: fixture.projectId,
    goalId,
    correlationId: randomUUID(),
    title: "Toggle the synthetic marker",
    description: "Bounded, reversible effect inside a synthetic workspace.",
    status: "pending",
    priority: "p1",
    phase: "execute",
    prompt: "Toggle the marker exactly once, even across a worker restart.",
    createdAt: now,
    updatedAt: now,
  });
  missionRunner.mockImplementation(async ({ goalId: approvedGoalId }: { goalId: string }) => ({
    status: "scheduled",
    goalId: approvedGoalId,
    executionId: `controlled-approval:${approvedGoalId}`,
  }));
  const projection = await request(app).get(`/api/ai/missions/${fixture.missionId}/projection`);
  expect(projection.status).toBe(200);
  const approval = await request(app)
    .post(`/api/ai/missions/${fixture.missionId}/agent/action`)
    .send({
      idempotencyKey: randomUUID(),
      expectedDecision: projection.body.engineeringAgent.nextAction,
    });
  expect([200, 202], JSON.stringify(approval.body)).toContain(approval.status);
  const approvedTrace = await getMissionDecisionTrace(selectedTrace.decisionId);
  expect(approvedTrace?.events.map(({ stage }) => stage))
    .toEqual(["PROPOSED", "EVALUATED", "SELECTED", "APPROVED", "PLAN_APPLIED"]);
  missionRunner.mockReset();

  return {
    ...fixture,
    decisionId: selectedTrace.decisionId,
    goalId,
    taskId,
    planRevision,
    rootPath,
  };
}

/**
 * One API worker process: loopback-only disposable database, runtime egress
 * guard installed before any application code, no inherited credentials.
 */
async function runBoundedEffectWorker(input: {
  projectId: string;
  phase: "first" | "restart";
  workerId: string;
  crashPoint?: BoundedEffectCrashPoint;
}): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  events: Array<Record<string, unknown> & { event: string }>;
}> {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new Error("The bounded effect worker requires an explicit disposable DATABASE_URL.");
  }
  const databaseUrl = new URL(rawDatabaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
    throw new Error("The bounded effect worker is restricted to a loopback PostgreSQL database.");
  }
  const applicationName = `bounded-effect-${input.phase}-${randomUUID().slice(0, 8)}`;
  databaseUrl.searchParams.set("application_name", applicationName);
  const guardPath = path.resolve(process.cwd(), "../../scripts/runtime-egress-guard.mjs");
  const workerPath = path.resolve(process.cwd(), "src/test/mission-bounded-effect-worker.ts");
  const child = spawn(process.execPath, ["--import", guardPath, "--import", "tsx", workerPath], {
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl.toString(),
      PGAPPNAME: applicationName,
      NODE_ENV: "test",
      AI_PROVIDER_EGRESS_DISABLED: "1",
      BOUNDED_EFFECT_PHASE: input.phase,
      BOUNDED_EFFECT_WORKER_ID: input.workerId,
      BOUNDED_EFFECT_PROJECT_ID: input.projectId,
      BOUNDED_EFFECT_CRASH_POINT: input.crashPoint ?? "none",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output += chunk; });
  child.stderr?.on("data", (chunk: string) => { output += chunk; });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Bounded effect worker timed out: ${output}`));
      }, 90_000);
      timer.unref();
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    },
  );
  // A hard-killed backend can outlive its client briefly; wait for its session to close.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const open = await db.execute(
      sql`select 1 from pg_stat_activity where application_name = ${applicationName}`,
    );
    if (open.rows.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const events = [...output.matchAll(/^BOUNDED_EFFECT:(.+)$/gmu)].map((match) =>
    JSON.parse(match[1]!) as Record<string, unknown> & { event: string });
  return { ...result, output, events };
}

/**
 * Selected strategy that requires owner approval, with one waiting Goal per plan step.
 */
async function createPendingPlanApprovalFixture(stepIds: string[]) {
  const fixture = await createFixture();
  const planRevision = `auto:${fixture.goalId}:${"d".repeat(64)}`;
  const selectedTrace = makeSelectedTrace({
    trace: fixture.trace,
    worldStateRevision: fixture.worldStateRevision,
    worldFactId: fixture.worldFactId,
    worldFactHash: fixture.worldFactHash,
    newPlanRevision: planRevision,
  });
  if (selectedTrace.result.kind !== "SELECTED") {
    throw new Error("test fixture did not select a strategy");
  }
  const selectedStrategy = MissionStrategyAlternativeSchema.parse({
    ...selectedTrace.alternatives[0],
    expectedActions: [{
      planStepId: "step-one",
      capabilityId: "tool.read.one",
      effectClass: "reversible_mutation",
    }],
    stepDependencies: [{ stepId: "step-one", dependsOnStepIds: [] }],
    approvalRequirement: "required",
  });
  const context = MissionDecisionContextSchema.parse({
    ...selectedTrace.context,
    approval: {
      status: "required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    },
  });
  const traceBody = {
    schemaVersion: selectedTrace.schemaVersion,
    context,
    contextHash: hashMissionDecisionContext(context),
    alternatives: [selectedStrategy],
    differences: [],
    evaluations: selectedTrace.evaluations
      .filter(({ strategyId }) => strategyId === selectedStrategy.strategyId)
      .map((evaluation) => ({
        ...evaluation,
        strategyHash: hashMissionStrategyAlternative(selectedStrategy),
      })),
    result: selectedTrace.result,
    lifecycle: selectedTrace.lifecycle,
    uncertaintyCodes: selectedTrace.uncertaintyCodes,
    decisionConfidence: selectedTrace.decisionConfidence,
    policyVersion: selectedTrace.policyVersion,
    evaluatorVersion: selectedTrace.evaluatorVersion,
    modelProvenance: selectedTrace.modelProvenance,
    priorPlanRevision: selectedTrace.priorPlanRevision,
    newPlanRevision: planRevision,
    dispatchRef: null,
    decidedAt: selectedTrace.decidedAt,
  };
  const approvalTrace = MissionDecisionTraceSchema.parse({
    decisionId: hashMissionDecisionTrace(traceBody),
    ...traceBody,
  });
  await persistMissionDecisionTrace(approvalTrace);

    const planSnapshot = {
    hash: planRevision,
    decisionTraceId: approvalTrace.decisionId,
    strategyDecision: { selectedStrategyId: selectedStrategy.strategyId },
    steps: stepIds.map((id) => ({
      id,
      kind: "execute",
      title: `Approve ${id}`,
      dependencies: [],
      files: ["README.md"],
      readOnly: false,
      approvalRequired: true,
    })),
  };
  const goalIds = stepIds.map(() => randomUUID());
  const taskIds = stepIds.map(() => randomUUID());
  await db.insert(aiGoalsTable).values(stepIds.map((stepId, index) => ({
    id: goalIds[index]!,
    missionId: fixture.missionId,
    projectId: fixture.projectId,
    title: `Approve ${stepId}`,
    status: "waiting_for_approval" as const,
    successCriteria: {
      kind: "mission_plan_step",
      missionId: fixture.missionId,
      stepId,
      planRevision: planSnapshot,
    },
    outcomeContract: {
      kind: "evidence_backed_progress_report",
      stepId,
      planRevision: planSnapshot,
      planApproval: {
        kind: "mission_plan_step",
        state: "PENDING",
        planRevision,
        stepId,
      },
    },
    nextAction: { kind: "wait", reason: "approval", wakeAt: null },
    createdAt: now,
    updatedAt: now,
  })));
  await db.insert(tasksTable).values(stepIds.map((stepId, index) => ({
    id: taskIds[index]!,
    projectId: fixture.projectId,
    goalId: goalIds[index]!,
    title: `Approve ${stepId}`,
    description: `Approve ${stepId}`,
    status: "verifying" as const,
    priority: "p1" as const,
    phase: "execute" as const,
    prompt: `Approve ${stepId}`,
    createdAt: now,
    updatedAt: now,
  })));
  await db.update(aiMissionsTable).set({
    status: "waiting",
    autonomyPolicy: { activePlanRevision: planRevision },
  }).where(eq(aiMissionsTable.id, fixture.missionId));
  return { fixture, planRevision, approvalTrace, goalIds, taskIds };
}

afterEach(async () => {
  missionRunner.mockReset();
  for (const projectId of projectIds.splice(0)) {
    // Dispatch items reference executions with NO ACTION. Remove their parent
    // batches first so the cascading item delete runs before project cleanup.
    await db.delete(aiMissionDecisionDispatchBatchesTable)
      .where(eq(aiMissionDecisionDispatchBatchesTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
  for (const rootPath of syntheticWorkspaceRoots.splice(0)) {
    await rm(rootPath, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("Mission decision trace persistence", () => {
  it("waits for every required plan-step approval before recording approval and application", async () => {
    const { fixture, planRevision, approvalTrace, goalIds } = await createPendingPlanApprovalFixture(["step-one", "step-two"]);

    missionRunner.mockImplementation(async ({ goalId }: { goalId: string }) => ({
      status: "scheduled",
      goalId,
      executionId: `scheduled:${goalId}`,
    }));
    const firstApproval = await approveMissionGoal({
      missionId: fixture.missionId,
      goalId: goalIds[0]!,
      userId: "test-user",
    });
    expect(firstApproval.status).toBe("approved");
    expect((await getMissionDecisionTrace(approvalTrace.decisionId))?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED"]);

    const secondApproval = await approveMissionGoal({
      missionId: fixture.missionId,
      goalId: goalIds[1]!,
      userId: "test-user",
    });
    expect(secondApproval.status).toBe("approved");
    expect((await getMissionDecisionTrace(approvalTrace.decisionId))?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED", "APPROVED", "PLAN_APPLIED"]);
    expect(missionRunner).toHaveBeenCalledTimes(2);

    const recoveryRuns: Array<{
      goalId: string;
      userId: string;
      trigger: string;
      executionId: string;
    }> = [];
    const recovered = await reconcileApprovedMissionDecisionDispatches(16, async (input) => {
      const executionId = randomUUID();
      await db.insert(aiExecutionsTable).values({
        id: executionId,
        projectId: fixture.projectId,
        goalId: input.goalId,
        userId: input.userId,
        idempotencyKey: `approved-decision-recovery:${executionId}`,
        resumeTokenHash: `resume:${executionId}`,
        request: JSON.stringify({ intent: "approved mission dispatch recovery fixture" }),
        checkpoint: "{}",
        attempt: 1,
        status: "queued",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      recoveryRuns.push({ ...input, executionId });
      return {
        status: "scheduled",
        goalId: input.goalId,
        executionId,
        reason: "scheduled_by_recovery_test",
      };
    });
    expect(recovered).toBe(1);
    expect(recoveryRuns).toHaveLength(goalIds.length);
    expect(new Set(recoveryRuns.map(({ goalId }) => goalId))).toEqual(new Set(goalIds));
    expect(recoveryRuns.every(({ userId, trigger }) =>
      userId === "test-user" && trigger === "replan",
    )).toBe(true);

    const recoveredTrace = await getMissionDecisionTrace(approvalTrace.decisionId);
    const dispatchEvent = recoveredTrace?.events.find(({ stage }) => stage === "DISPATCHED");
    expect(dispatchEvent?.referenceId).toBeTruthy();
    const recoveredBatch = dispatchEvent?.referenceId
      ? await getMissionDecisionDispatchBatch(dispatchEvent.referenceId)
      : null;
    expect(recoveredBatch?.batch).toMatchObject({
      decisionId: approvalTrace.decisionId,
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      planRevision,
      state: "dispatched",
      rootCount: goalIds.length,
    });
    expect(new Set(recoveredBatch?.items.map(({ goalId }) => goalId))).toEqual(new Set(goalIds));
    expect(recoveredBatch?.items.map(({ goalId, executionId }) => ({
      goalId,
      executionId,
    }))).toEqual(expect.arrayContaining(recoveryRuns.map(({ goalId, executionId }) => ({
      goalId,
      executionId,
    }))));

    const replayRuns: string[] = [];
    expect(await reconcileApprovedMissionDecisionDispatches(16, async ({ goalId }) => {
      replayRuns.push(goalId);
      return { status: "scheduled", goalId, executionId: `unexpected:${goalId}` };
    })).toBe(0);
    expect(replayRuns).toEqual([]);
  });

  it("records the dispatch of a finished single-goal plan after a crash without running the Goal again", async () => {
    const { fixture, planRevision, approvalTrace, goalIds } =
      await createPendingPlanApprovalFixture(["step-one"]);
    const [goalId] = goalIds;
    missionRunner.mockImplementation(async ({ goalId: approvedGoalId }: { goalId: string }) => ({
      status: "scheduled",
      goalId: approvedGoalId,
      executionId: `scheduled:${approvedGoalId}`,
    }));
    const approval = await approveMissionGoal({
      missionId: fixture.missionId,
      goalId: goalId!,
      userId: "test-user",
    });
    expect(approval.status).toBe("approved");
    expect((await getMissionDecisionTrace(approvalTrace.decisionId))?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED", "APPROVED", "PLAN_APPLIED"]);
    missionRunner.mockReset();

    // Crash window: the run finished and completed the Mission, then the API
    // died before DISPATCHED was recorded.
    const executionId = randomUUID();
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId: fixture.projectId,
      goalId: goalId!,
      userId: "test-user",
      idempotencyKey: `finished-before-crash:${executionId}`,
      resumeTokenHash: `resume:${executionId}`,
      request: JSON.stringify({ intent: "finished before the dispatch was recorded" }),
      checkpoint: "{}",
      attempt: 1,
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.update(aiGoalsTable).set({ status: "completed" })
      .where(eq(aiGoalsTable.id, goalId!));
    await db.update(aiMissionsTable).set({ status: "completed" })
      .where(eq(aiMissionsTable.id, fixture.missionId));

    const runGoalAgain = vi.fn(async ({ goalId: runGoalId }: { goalId: string }) => ({
      status: "scheduled" as const,
      goalId: runGoalId,
      executionId: `unexpected:${runGoalId}`,
    }));
    expect(await reconcileApprovedMissionDecisionDispatches(16, runGoalAgain as never)).toBe(1);
    expect(runGoalAgain).not.toHaveBeenCalled();

    const recovered = await getMissionDecisionTrace(approvalTrace.decisionId);
    expect(recovered?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED", "APPROVED", "PLAN_APPLIED", "DISPATCHED"]);
    const dispatchReference = recovered?.events.find(({ stage }) => stage === "DISPATCHED")?.referenceId;
    expect(dispatchReference).toBeTruthy();
    const batch = await getMissionDecisionDispatchBatch(dispatchReference!);
    expect(batch?.batch).toMatchObject({ planRevision, state: "dispatched", rootCount: 1 });
    expect(batch?.items.map((item) => ({
      goalId: item.goalId,
      executionId: item.executionId,
      runStatus: item.runStatus,
    }))).toEqual([{ goalId, executionId, runStatus: "completed" }]);

    // Exactly once: a second pass finds nothing to record and runs nothing.
    expect(await reconcileApprovedMissionDecisionDispatches(16, runGoalAgain as never)).toBe(0);
    expect(runGoalAgain).not.toHaveBeenCalled();
    expect(await db.select().from(aiMissionDecisionDispatchBatchesTable)
      .where(eq(aiMissionDecisionDispatchBatchesTable.decisionId, approvalTrace.decisionId)))
      .toHaveLength(1);
  });

  it("does not record a dispatch for a completed Mission whose root Execution is ambiguous", async () => {
    const { fixture, approvalTrace, goalIds } =
      await createPendingPlanApprovalFixture(["step-one"]);
    const [goalId] = goalIds;
    missionRunner.mockImplementation(async ({ goalId: approvedGoalId }: { goalId: string }) => ({
      status: "scheduled",
      goalId: approvedGoalId,
      executionId: `scheduled:${approvedGoalId}`,
    }));
    await approveMissionGoal({ missionId: fixture.missionId, goalId: goalId!, userId: "test-user" });
    missionRunner.mockReset();
    for (const attempt of [1, 2]) {
      const executionId = randomUUID();
      await db.insert(aiExecutionsTable).values({
        id: executionId,
        projectId: fixture.projectId,
        goalId: goalId!,
        userId: "test-user",
        idempotencyKey: `ambiguous-root:${executionId}`,
        resumeTokenHash: `resume:${executionId}`,
        request: "{}",
        checkpoint: "{}",
        attempt,
        status: "completed",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await db.update(aiGoalsTable).set({ status: "completed" }).where(eq(aiGoalsTable.id, goalId!));
    await db.update(aiMissionsTable).set({ status: "completed" })
      .where(eq(aiMissionsTable.id, fixture.missionId));

    const runGoalAgain = vi.fn();
    expect(await reconcileApprovedMissionDecisionDispatches(16, runGoalAgain as never)).toBe(0);
    expect(runGoalAgain).not.toHaveBeenCalled();
    expect((await getMissionDecisionTrace(approvalTrace.decisionId))?.events
      .some(({ stage }) => stage === "DISPATCHED")).toBe(false);
  });

  it("stores a recovery trace once and preserves its exact source identity", async () => {
    const fixture = await createFixture();
    const results = await Promise.all([
      persistMissionDecisionTrace(fixture.trace),
      persistMissionDecisionTrace(fixture.trace),
    ]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["already_recorded", "inserted"]);

    const stored = await getMissionDecisionTrace(fixture.trace.decisionId);
    expect(stored?.trace).toEqual(fixture.trace);
    expect(stored?.events.map(({ stage, sequence }) => ({ stage, sequence }))).toEqual([
      { stage: "PROPOSED", sequence: 1 },
      { stage: "EVALUATED", sequence: 2 },
    ]);
  });

  it("lets the caller roll trace persistence back with its surrounding transaction", async () => {
    const fixture = await createFixture();
    await expect(db.transaction(async (tx) => {
      await persistMissionDecisionTraceInTransaction(tx, fixture.trace);
      throw new Error("rollback transaction");
    })).rejects.toThrow("rollback transaction");

    expect(await getMissionDecisionTrace(fixture.trace.decisionId)).toBeNull();
  });

  it("rejects a trace after the Goal plan revision changes", async () => {
    const fixture = await createFixture();
    await db.update(aiGoalsTable)
      .set({
        outcomeContract: { planRevision: { hash: "newer-plan-revision" } },
        successCriteria: { planRevision: { hash: "newer-plan-revision" } },
      })
      .where(eq(aiGoalsTable.id, fixture.goalId));

    await expect(persistMissionDecisionTrace(fixture.trace)).rejects.toMatchObject({
      code: "decision_plan_revision_stale",
    } satisfies Partial<MissionDecisionTraceStoreError>);
  });

  it("does not allow an unselected NO_DECISION trace to grow into execution", async () => {
    const fixture = await createFixture();
    await persistMissionDecisionTrace(fixture.trace);

    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: fixture.trace.decisionId,
      stage: "DISPATCHED",
      referenceId: "unrelated-execution",
      occurredAt: new Date(now.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "decision_event_order_invalid" });
  });

  it("binds plan application and dispatch to successor Goals created by a replan", async () => {
    const fixture = await createFixture();
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: "applied-plan-revision",
    });
    await persistMissionDecisionTrace(selectedTrace);

    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "DISPATCHED",
      referenceId: randomUUID(),
      occurredAt: new Date(now.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "decision_event_order_invalid" });
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: "applied-plan-revision",
      occurredAt: new Date(now.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "decision_event_reference_invalid" });

    const successorGoalId = randomUUID();
    await db.insert(aiGoalsTable).values({
      id: successorGoalId,
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      title: "Successor plan Goal",
      status: "queued",
      successCriteria: { planRevision: { hash: "applied-plan-revision" } },
      evidenceContract: { required: true },
      outcomeContract: { planRevision: { hash: "applied-plan-revision" } },
      nextAction: { kind: "execute" },
      createdAt: now,
      updatedAt: now,
    });
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: "applied-plan-revision" },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    const planAppliedEvent = {
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED" as const,
      referenceId: "applied-plan-revision",
      occurredAt: new Date(now.getTime() + 2_000),
    };
    await expect(appendMissionDecisionLifecycleEvent({
      ...planAppliedEvent,
      referenceId: "wrong-proposed-plan-revision",
    })).rejects.toMatchObject({ code: "decision_event_reference_invalid" });
    await expect(db.transaction(async (tx) => {
      await appendMissionDecisionLifecycleEventInTransaction(tx, planAppliedEvent);
      throw new Error("rollback event");
    })).rejects.toThrow("rollback event");
    expect((await getMissionDecisionTrace(selectedTrace.decisionId))?.events).toHaveLength(3);
    await expect(appendMissionDecisionLifecycleEvent({
      ...planAppliedEvent,
    })).resolves.toMatchObject({ kind: "appended", sequence: 4 });

    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "DISPATCHED",
      referenceId: fixture.executionId,
      occurredAt: new Date(now.getTime() + 3_000),
    })).rejects.toMatchObject({ code: "decision_event_reference_invalid" });

    const successorExecutionId = randomUUID();
    await db.insert(aiExecutionsTable).values({
      id: successorExecutionId,
      projectId: fixture.projectId,
      goalId: successorGoalId,
      userId: "test-user",
      idempotencyKey: `decision-trace-successor-${successorExecutionId}`,
      resumeTokenHash: "d".repeat(64),
      request: "{}",
      checkpoint: "{}",
      attempt: 1,
      status: "queued",
      baseRevision: "decision-project-revision",
      createdAt: now,
      updatedAt: now,
    });
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "DISPATCHED",
      referenceId: successorExecutionId,
      occurredAt: new Date(now.getTime() + 4_000),
    })).resolves.toMatchObject({ kind: "appended", sequence: 5 });

    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "EXECUTED",
      referenceId: successorExecutionId,
      occurredAt: new Date(now.getTime() + 5_000),
    })).resolves.toMatchObject({ kind: "appended", sequence: 6 });

    const successorAcceptanceId = randomUUID();
    await db.insert(aiExecutionAcceptancesTable).values({
      id: successorAcceptanceId,
      executionId: successorExecutionId,
      projectId: fixture.projectId,
      attempt: 1,
      finalizationKey: `decision-trace-successor-finalize-${successorAcceptanceId}`,
      terminalStatus: "failed",
      outcome: "incomplete",
      reasonCode: "evidence_incomplete",
      nextActionCode: "gather_evidence",
      evidenceRequired: 1,
      evidenceComplete: 0,
      resumable: 1,
      sourceRevision: "decision-project-revision",
      createdAt: now,
    });
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "ACCEPTED",
      referenceId: fixture.acceptanceId,
      occurredAt: new Date(now.getTime() + 6_000),
    })).rejects.toMatchObject({ code: "decision_event_reference_invalid" });
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "ACCEPTED",
      referenceId: successorAcceptanceId,
      occurredAt: new Date(now.getTime() + 7_000),
    })).resolves.toMatchObject({ kind: "appended", sequence: 7 });

    const stored = await getMissionDecisionTrace(selectedTrace.decisionId);
    expect(stored?.events.slice(-4).map(({ stage, referenceId }) => ({ stage, referenceId }))).toEqual([
      { stage: "PLAN_APPLIED", referenceId: "applied-plan-revision" },
      { stage: "DISPATCHED", referenceId: successorExecutionId },
      { stage: "EXECUTED", referenceId: successorExecutionId },
      { stage: "ACCEPTED", referenceId: successorAcceptanceId },
    ]);
    expect(stored?.trace.dispatchRef).toBeNull();
  });

  it("records an inconclusive outcome snapshot from dispatch evidence without advancing lifecycle", async () => {
    const fixture = await createFixture();
    const planRevision = `auto:${randomUUID()}:${"f".repeat(64)}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      expectedEffectCodes: ["runtime.status"],
      newPlanRevision: planRevision,
    });
    await persistMissionDecisionTrace(selectedTrace);

    const goalId = randomUUID();
    const executionId = randomUUID();
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      title: "Outcome snapshot root",
      status: "queued",
      successCriteria: { planRevision: { hash: planRevision } },
      evidenceContract: { required: true },
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: { kind: "execute" },
      createdAt: now,
      updatedAt: now,
    });
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 2_000),
    });
    await db.insert(aiExecutionsTable).values({
      id: executionId,
      projectId: fixture.projectId,
      goalId,
      userId: "test-user",
      idempotencyKey: `outcome-snapshot-${executionId}`,
      resumeTokenHash: "f".repeat(64),
      request: "{}",
      checkpoint: "{}",
      attempt: 1,
      status: "queued",
      baseRevision: "decision-project-revision",
      createdAt: now,
      updatedAt: now,
    });
    const dispatch = await recordMissionDecisionDispatchBatch({
      decisionId: selectedTrace.decisionId,
      planRevision,
      occurredAt: new Date(now.getTime() + 3_000),
      items: [{
        position: 0,
        goalId,
        executionId,
        runStatus: "scheduled",
      }],
    });
    expect(dispatch.batch.kind).toBe("inserted");

    const first = await evaluateAndPersistMissionPlanOutcome(selectedTrace.decisionId, now);
    expect(first.kind).toBe("recorded");
    if (first.kind !== "recorded") throw new Error("expected first outcome snapshot");
    expect(first.evaluation.outcome).toBe("INCONCLUSIVE");
    expect(first.evaluation.executions).toMatchObject([{
      goalId,
      executionId,
      terminal: false,
      outcome: "INCONCLUSIVE",
      canonicalProofId: null,
      effectBundleId: null,
    }]);

    const replay = await evaluateAndPersistMissionPlanOutcome(
      selectedTrace.decisionId,
      new Date(now.getTime() + 60_000),
    );
    expect(replay.kind).toBe("already_recorded");
    expect(replay).toMatchObject({
      snapshotId: first.snapshotId,
      evaluation: {
        evidenceSetHash: first.evaluation.evidenceSetHash,
        outcome: "INCONCLUSIVE",
      },
    });
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, selectedTrace.decisionId)))
      .toHaveLength(1);
    await expectMissionOutcomeSnapshotMutationRejected(
      db.delete(aiMissionDecisionOutcomeSnapshotsTable)
        .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, first.snapshotId)),
    );
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, first.snapshotId)))
      .toHaveLength(1);
    const finalizeIncomplete = await finalizeMissionPlanOutcome(
      selectedTrace.decisionId,
      new Date(now.getTime() + 120_000),
    );
    expect(finalizeIncomplete.kind).toBe("inconclusive");
    if (finalizeIncomplete.kind !== "inconclusive") {
      throw new Error("incomplete plan must not advance lifecycle");
    }
    expect(finalizeIncomplete.snapshotId).toBe(first.snapshotId);
    const terminalFailureAt = new Date(now.getTime() + 240_000);
    await db.update(aiGoalsTable).set({
      status: "failed",
      completedAt: terminalFailureAt,
      updatedAt: terminalFailureAt,
    }).where(eq(aiGoalsTable.id, goalId));
    await db.update(aiExecutionsTable).set({
      status: "failed",
      completedAt: terminalFailureAt,
      updatedAt: terminalFailureAt,
    }).where(eq(aiExecutionsTable.id, executionId));
    const terminalFailureWithoutContradiction = await finalizeMissionPlanOutcome(
      selectedTrace.decisionId,
      terminalFailureAt,
    );
    expect(terminalFailureWithoutContradiction.kind).toBe("inconclusive");
    if (terminalFailureWithoutContradiction.kind !== "inconclusive") {
      throw new Error("a terminal failure without contradiction evidence must remain inconclusive");
    }
    expect(terminalFailureWithoutContradiction.evaluation.outcome).toBe("INCONCLUSIVE");
    expect(terminalFailureWithoutContradiction.snapshotId).not.toBe(first.snapshotId);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, selectedTrace.decisionId)))
      .toHaveLength(2);
    expect((await getMissionDecisionTrace(selectedTrace.decisionId))?.events
      .map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
    await expect(db.delete(aiMissionDecisionDispatchBatchesTable)
      .where(eq(
        aiMissionDecisionDispatchBatchesTable.dispatchBatchId,
        dispatch.batch.dispatchBatchId,
      )))
      .resolves.toBeDefined();
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, first.snapshotId)))
      .toHaveLength(0);
  });

  it.each(["ACHIEVED", "NOT_ACHIEVED"] as const)(
    "derives %s from persisted acceptance, effect, and observation rows",
    async (outcome) => {
      const fixture = await createPersistedEffectOutcomeFixture(outcome);
      const currentWorldState = await getProjectWorldState(fixture.projectId);
      if (outcome === "NOT_ACHIEVED") {
        expect(currentWorldState.contradictions.some((fact) =>
          fact.subject === "runtime"
          && fact.predicate === "status"
          && fact.sourceObservationIds.includes(fixture.afterObservationId),
        )).toBe(true);
      }

      const recorded = await evaluateAndPersistMissionPlanOutcome(
        fixture.decisionId,
        new Date(now.getTime() + 60_000),
      );
      expect(recorded.kind).toBe("recorded");
      if (recorded.kind !== "recorded") {
        throw new Error("expected a persisted outcome snapshot");
      }
      expect(recorded.evaluation.outcome).toBe(outcome);
      expect(recorded.evaluation.executions).toMatchObject([{
        goalId: fixture.goalId,
        executionId: fixture.executionId,
        terminal: true,
        outcome,
        acceptanceId: fixture.acceptanceId,
        effectBundleId: fixture.bundleId,
        ...(outcome === "ACHIEVED"
          ? {
              canonicalProofId: expect.any(String),
              observedEffectCodes: ["runtime.status"],
              contradictedEffectCodes: [],
            }
          : {
              canonicalProofId: null,
              observedEffectCodes: [],
              contradictedEffectCodes: ["runtime.status"],
            }),
      }]);

      const finalized = await finalizeMissionPlanOutcome(
        fixture.decisionId,
        new Date(now.getTime() + 120_000),
      );
      if (outcome === "ACHIEVED") {
        expect(finalized.kind).toBe("appended");
        if (finalized.kind !== "appended") {
          throw new Error("expected ACHIEVED lifecycle finalization");
        }
        expect((await getMissionDecisionTrace(fixture.decisionId))?.events
          .map(({ stage }) => stage).slice(-4))
          .toEqual(["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"]);
        const [snapshot] = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId));
        if (!snapshot) throw new Error("expected persisted outcome snapshot");
        await expectMissionOutcomeSnapshotMutationRejected(
          db.update(aiMissionDecisionOutcomeSnapshotsTable)
            .set({ outcome: "NOT_ACHIEVED" })
            .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId)),
        );
        await expectMissionOutcomeSnapshotMutationRejected(
          db.update(aiMissionDecisionOutcomeSnapshotsTable)
            .set({ outcome: snapshot.outcome, evaluation: snapshot.evaluation })
            .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId)),
        );
        await expectMissionOutcomeSnapshotMutationRejected(
          db.update(aiMissionDecisionOutcomeSnapshotsTable)
            .set({ evaluation: { ...snapshot.evaluation, planRevision: "tampered-plan-revision" } })
            .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId)),
        );
        await expectMissionOutcomeSnapshotMutationRejected(
          db.update(aiMissionDecisionOutcomeSnapshotsTable)
            .set({
              evaluation: snapshot.evaluation,
              worldStateRevision: `tampered:${snapshot.worldStateRevision}`,
            })
            .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId)),
        );
        await expect(getMissionDecisionTrace(fixture.decisionId))
          .resolves.toMatchObject({ trace: { decisionId: fixture.decisionId } });
      } else {
        expect(finalized.kind).toBe("not_achieved");
        expect((await getMissionDecisionTrace(fixture.decisionId))?.events
          .map(({ stage }) => stage).slice(-2))
          .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
      }
    },
  );

  it.each([
    ["current World State no longer corroborates the after-observation", "world_state"],
    ["the after-observation is stale", "stale_observation"],
    ["the effect belongs to another attempt", "cross_attempt"],
    ["the effect belongs to another Execution", "cross_execution"],
  ] as const)("keeps NOT_ACHIEVED inconclusive when %s", async (_label, mutation) => {
    const fixture = await createPersistedEffectOutcomeFixture("NOT_ACHIEVED");
    if (mutation === "world_state") {
      await db.update(aiWorldFactsTable).set({ status: "believed" }).where(and(
        eq(aiWorldFactsTable.projectId, fixture.projectId),
        eq(aiWorldFactsTable.subject, "runtime"),
        eq(aiWorldFactsTable.predicate, "status"),
      ));
    } else if (mutation === "stale_observation") {
      await db.update(aiAgentObservationsTable).set({ freshness: "stale" })
        .where(eq(aiAgentObservationsTable.id, fixture.afterObservationId));
    } else if (mutation === "cross_attempt") {
      await db.update(aiAgentEffectsTable).set({ attempt: 2 })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    } else {
      await db.update(aiAgentEffectsTable).set({
        executionId: fixture.trace.context.identity.sourceExecutionId!,
      })
        .where(eq(aiAgentEffectsTable.id, fixture.effectId));
    }
    if (mutation === "world_state") {
      expect((await getProjectWorldState(fixture.projectId)).contradictions.some((fact) =>
        fact.subject === "runtime" && fact.predicate === "status",
      )).toBe(false);
    }

    const result = await evaluateAndPersistMissionPlanOutcome(
      fixture.decisionId,
      new Date(now.getTime() + 60_000),
    );
    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") throw new Error("expected fail-closed outcome snapshot");
    expect(result.evaluation.outcome).toBe("INCONCLUSIVE");
    expect(result.evaluation.finalWorldState.contradictedEffectCodes).toEqual([]);
    expect(result.evaluation.executions).toMatchObject([{
      goalId: fixture.goalId,
      executionId: fixture.executionId,
      canonicalProofId: null,
    }]);
    if (mutation === "world_state") {
      expect(result.evaluation.executions[0]?.outcome).toBe("NOT_ACHIEVED");
    } else {
      expect(result.evaluation.executions[0]?.outcome).toBe("INCONCLUSIVE");
    }

    const finalized = await finalizeMissionPlanOutcome(
      fixture.decisionId,
      new Date(now.getTime() + 120_000),
    );
    expect(finalized.kind).toBe("inconclusive");
    expect((await getMissionDecisionTrace(fixture.decisionId))?.events
      .map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
  });

  it("restarts Mission outcome reconciliation without duplicating completed execution or effects", async () => {
    const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED");
    missionRunner.mockClear();

    const [mission] = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const [goal] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [task] = await db.select().from(tasksTable)
      .where(eq(tasksTable.id, fixture.taskId));
    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    const [acceptance] = await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
    const effectsBefore = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, fixture.executionId));
    const beforeTrace = await getMissionDecisionTrace(fixture.decisionId);
    const dispatchEvent = beforeTrace?.events.find(({ stage }) => stage === "DISPATCHED");
    if (!dispatchEvent?.referenceId) throw new Error("dispatch event fixture is missing");
    const dispatch = await getMissionDecisionDispatchBatch(dispatchEvent.referenceId);

    expect(mission?.autonomyPolicy.activePlanRevision).toBe(beforeTrace?.trace.newPlanRevision);
    expect(goal).toMatchObject({
      missionId: fixture.missionId,
      status: "completed",
      successCriteria: { planRevision: { hash: beforeTrace?.trace.newPlanRevision } },
      outcomeContract: {
        planRevision: { hash: beforeTrace?.trace.newPlanRevision },
        acceptance: {
          executionId: fixture.executionId,
          receipt: { kind: "execution_acceptance", id: fixture.acceptanceId },
        },
      },
    });
    expect(task).toMatchObject({
      goalId: fixture.goalId,
      status: "completed",
      completedAt: expect.any(Date),
    });
    expect(execution).toMatchObject({
      goalId: fixture.goalId,
      linkedTaskId: fixture.taskId,
      status: "completed",
    });
    expect(acceptance).toMatchObject({
      executionId: fixture.executionId,
      attempt: execution?.attempt,
      outcome: "SUCCEEDED",
      resumable: 0,
    });
    expect(effectsBefore.map(({ id }) => id)).toEqual([fixture.effectId]);
    expect(dispatch?.batch).toMatchObject({
      decisionId: fixture.decisionId,
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      planRevision: beforeTrace?.trace.newPlanRevision,
      state: "dispatched",
    });
    expect(dispatch?.items).toMatchObject([{
      goalId: fixture.goalId,
      executionId: fixture.executionId,
    }]);
    expect(beforeTrace?.events.map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId)))
      .toHaveLength(0);

    const [lostReply, concurrentRecovery] = await Promise.all([
      runMissionOutcomeRecoveryProcess({
        projectId: fixture.projectId,
        crashAfterCommit: true,
      }),
      runMissionOutcomeRecoveryProcess({ projectId: fixture.projectId }),
    ]);
    expect(lostReply.code).toBe(73);
    expect(concurrentRecovery.code).toBe(0);
    const reconciledCounts = [lostReply.output, concurrentRecovery.output]
      .flatMap((output) => [...output.matchAll(/MISSION_OUTCOME_RECONCILED:(\d+)/gu)])
      .map((match) => Number(match[1]));
    expect(reconciledCounts.some((count) => count > 0)).toBe(true);

    const retryAfterRestart = await runMissionOutcomeRecoveryProcess({
      projectId: fixture.projectId,
    });
    expect(retryAfterRestart.code, retryAfterRestart.output).toBe(0);

    const afterTrace = await getMissionDecisionTrace(fixture.decisionId);
    const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
    const executionsAfter = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, fixture.goalId));
    const tasksAfter = await db.select().from(tasksTable)
      .where(eq(tasksTable.goalId, fixture.goalId));
    const effectsAfter = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, fixture.executionId));
    expect(snapshots).toHaveLength(1);
    expect(executionsAfter.map(({ id }) => id)).toEqual([fixture.executionId]);
    expect(tasksAfter.map(({ id, status }) => ({ id, status }))).toEqual([{
      id: fixture.taskId,
      status: "completed",
    }]);
    expect(effectsAfter.map(({ id, status }) => ({ id, status }))).toEqual([{
      id: fixture.effectId,
      status: fixture.expectedEffectStatus,
    }]);
    expect(missionRunner).not.toHaveBeenCalled();

    const evaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshots[0]?.evaluation);
    expect(evaluation).toMatchObject({
      decisionId: fixture.decisionId,
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      planRevision: beforeTrace?.trace.newPlanRevision,
      dispatchBatchId: dispatchEvent.referenceId,
      outcome: "ACHIEVED",
      planGoalIds: [fixture.goalId],
      planTaskIds: [fixture.taskId],
      goalStates: [{ goalId: fixture.goalId, terminal: true, taskIds: [fixture.taskId] }],
      taskStates: [{ taskId: fixture.taskId, goalId: fixture.goalId, terminal: true }],
      executions: [{
        goalId: fixture.goalId,
        executionId: fixture.executionId,
        terminal: true,
        acceptanceId: fixture.acceptanceId,
        canonicalProofId: expect.any(String),
        outcome: "ACHIEVED",
      }],
    });
    expect(afterTrace?.events.map(({ stage }) => stage).slice(-4))
      .toEqual(["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"]);
  }, 60_000);

  it("re-evaluates an inconclusive Mission outcome after complete proof arrives during recovery", async () => {
    const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED");
    missionRunner.mockClear();

    await db.delete(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
    await db.delete(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, fixture.evidenceSnapshotId));

    const initial = await finalizeMissionPlanOutcome(
      fixture.decisionId,
      new Date(now.getTime() + 60_000),
    );
    expect(initial.kind).toBe("inconclusive");
    if (initial.kind !== "inconclusive") {
      throw new Error("missing acceptance and evidence must remain inconclusive");
    }
    expect(initial.evaluation.executions).toMatchObject([{
      goalId: fixture.goalId,
      executionId: fixture.executionId,
      terminal: true,
      outcome: "INCONCLUSIVE",
      acceptanceId: null,
      canonicalProofId: null,
      effectBundleId: null,
    }]);
    const firstSnapshotId = initial.snapshotId;
    const firstSnapshot = (await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, firstSnapshotId)))[0];
    expect(firstSnapshot?.outcome).toBe("INCONCLUSIVE");
    expect((await getMissionDecisionTrace(fixture.decisionId))?.events
      .map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);

    const completedAt = new Date(now.getTime() + 120_000);
    const completeProof = buildExecutionProofProjection({
      outcome: "SUCCEEDED",
      evidenceRequired: true,
      evidenceComplete: true,
      evidenceSnapshotId: fixture.evidenceSnapshotId,
      sourceRevision: "decision-project-revision",
    });
    await db.insert(aiExecutionEvidenceSnapshotsTable).values({
      id: fixture.evidenceSnapshotId,
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 1,
      sourceRevision: "decision-project-revision",
      verdict: completeProof.verdict,
      complete: 1,
      readCount: 1,
      totalBytes: 0,
      createdAt: completedAt,
    });
    await db.insert(aiExecutionAcceptancesTable).values({
      id: fixture.acceptanceId,
      executionId: fixture.executionId,
      projectId: fixture.projectId,
      attempt: 1,
      finalizationKey: `outcome-finalize-recovered-${fixture.acceptanceId}`,
      terminalStatus: "completed",
      outcome: "SUCCEEDED",
      reasonCode: "proof_complete",
      nextActionCode: "complete_plan",
      evidenceSnapshotId: fixture.evidenceSnapshotId,
      evidenceRequired: 1,
      evidenceComplete: 1,
      resumable: 0,
      disposition: { proof: completeProof },
      sourceRevision: "decision-project-revision",
      effectBundleId: fixture.bundleId,
      createdAt: completedAt,
    });

    const [goalBeforeRecovery] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [taskBeforeRecovery] = await db.select().from(tasksTable)
      .where(eq(tasksTable.id, fixture.taskId));
    const [executionBeforeRecovery] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    const [recovery, repeatedRecovery] = await Promise.all([
      runMissionOutcomeRecoveryProcess({ projectId: fixture.projectId }),
      runMissionOutcomeRecoveryProcess({ projectId: fixture.projectId }),
    ]);
    expect(recovery.code, recovery.output).toBe(0);
    expect(repeatedRecovery.code, repeatedRecovery.output).toBe(0);
    const reconciledCounts = [recovery.output, repeatedRecovery.output]
      .flatMap((output) => [...output.matchAll(/MISSION_OUTCOME_RECONCILED:(\d+)/gu)])
      .map((match) => Number(match[1]));
    expect(reconciledCounts.some((count) => count > 0)).toBe(true);

    const afterTrace = await getMissionDecisionTrace(fixture.decisionId);
    const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
    const acceptanceAfterRecovery = (await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId)))[0];
    const evidenceAfterRecovery = (await db.select().from(aiExecutionEvidenceSnapshotsTable)
      .where(eq(aiExecutionEvidenceSnapshotsTable.id, fixture.evidenceSnapshotId)))[0];
    const outcomeSnapshots = snapshots
      .map((snapshot) => ({
        id: snapshot.outcomeId,
        outcome: snapshot.outcome,
        evidenceSetHash: snapshot.evidenceSetHash,
        evaluation: MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshot.evaluation),
      }))
      .sort((left, right) => left.outcome === "INCONCLUSIVE" ? -1 : 1);
    expect(outcomeSnapshots).toHaveLength(2);
    expect(outcomeSnapshots[0]).toMatchObject({
      id: firstSnapshotId,
      outcome: "INCONCLUSIVE",
      evaluation: {
        outcome: "INCONCLUSIVE",
        executions: [{
          executionId: fixture.executionId,
          acceptanceId: null,
          canonicalProofId: null,
        }],
      },
    });
    expect(outcomeSnapshots[1]).toMatchObject({
      outcome: "ACHIEVED",
      evaluation: {
        outcome: "ACHIEVED",
        executions: [{
          goalId: fixture.goalId,
          executionId: fixture.executionId,
          acceptanceId: fixture.acceptanceId,
          canonicalProofId: expect.any(String),
          effectBundleId: fixture.bundleId,
          outcome: "ACHIEVED",
        }],
      },
    });
    expect(outcomeSnapshots[1]?.evidenceSetHash).not.toBe(outcomeSnapshots[0]?.evidenceSetHash);
    expect(acceptanceAfterRecovery).toMatchObject({
      executionId: fixture.executionId,
      evidenceSnapshotId: fixture.evidenceSnapshotId,
      evidenceRequired: 1,
      evidenceComplete: 1,
      outcome: "SUCCEEDED",
    });
    expect(evidenceAfterRecovery).toMatchObject({
      executionId: fixture.executionId,
      complete: 1,
      verdict: "PROVEN",
    });

    const completionEvents = afterTrace?.events.filter(({ stage }) =>
      ["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"].includes(stage));
    expect(completionEvents).toHaveLength(4);
    expect(completionEvents?.map(({ stage, referenceId }) => ({ stage, referenceId })))
      .toEqual([
        { stage: "EXECUTED", referenceId: outcomeSnapshots[1]?.id },
        { stage: "ACCEPTED", referenceId: outcomeSnapshots[1]?.id },
        { stage: "VERIFIED", referenceId: outcomeSnapshots[1]?.id },
        { stage: "EVALUATED_AFTER_EXECUTION", referenceId: outcomeSnapshots[1]?.id },
      ]);

    const [goalAfterRecovery] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [taskAfterRecovery] = await db.select().from(tasksTable)
      .where(eq(tasksTable.id, fixture.taskId));
    const [executionAfterRecovery] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    const allTasksAfterRecovery = await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(eq(tasksTable.goalId, fixture.goalId));
    const allExecutionsAfterRecovery = await db.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, fixture.goalId));
    const effectsAfterRecovery = await db.select({ id: aiAgentEffectsTable.id })
      .from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, fixture.executionId));
    expect(goalAfterRecovery).toMatchObject({
      id: goalBeforeRecovery?.id,
      status: goalBeforeRecovery?.status,
    });
    expect(taskAfterRecovery).toMatchObject({
      id: taskBeforeRecovery?.id,
      status: taskBeforeRecovery?.status,
    });
    expect(executionAfterRecovery).toMatchObject({
      id: executionBeforeRecovery?.id,
      status: executionBeforeRecovery?.status,
      attempt: executionBeforeRecovery?.attempt,
    });
    expect(allTasksAfterRecovery.map(({ id }) => id)).toEqual([fixture.taskId]);
    expect(allExecutionsAfterRecovery.map(({ id }) => id)).toEqual([fixture.executionId]);
    expect(effectsAfterRecovery.map(({ id }) => id)).toEqual([fixture.effectId]);
    expect(missionRunner).not.toHaveBeenCalled();
  }, 60_000);

  it("approves through the Mission API, then accepts bound evidence after an API process restart", async () => {
    const projectId = randomUUID();
    const priorApi = await startScopedMissionApiProcess(projectId);
    await priorApi.stop();

    const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED", true, projectId);
    missionRunner.mockClear();
    const beforeTrace = await getMissionDecisionTrace(fixture.decisionId);
    expect(beforeTrace?.events.map(({ stage }) => stage)).toEqual([
      "PROPOSED",
      "EVALUATED",
      "SELECTED",
      "APPROVED",
      "PLAN_APPLIED",
      "DISPATCHED",
    ]);
    expect(beforeTrace?.trace.context.approval).toMatchObject({
      status: "required",
      approvalRef: null,
      approvedStrategyId: null,
      approvedStrategyHash: null,
      approvedPlanRevision: null,
    });
    expect(beforeTrace?.events.find(({ stage }) => stage === "APPROVED")?.referenceId)
      .toMatch(/^mission-plan-approvals:[a-f0-9]{64}$/u);
    const dispatchEvent = beforeTrace?.events.find(({ stage }) => stage === "DISPATCHED");
    if (!dispatchEvent?.referenceId) throw new Error("approved journey dispatch reference is missing");
    const dispatch = await getMissionDecisionDispatchBatch(dispatchEvent.referenceId);
    expect(dispatch?.batch).toMatchObject({
      projectId,
      missionId: fixture.missionId,
      planRevision: beforeTrace?.trace.newPlanRevision,
      state: "dispatched",
    });
    expect(dispatch?.items).toMatchObject([{
      position: 0,
      goalId: fixture.goalId,
      executionId: fixture.executionId,
      runStatus: "scheduled",
    }]);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId)))
      .toHaveLength(0);

    const restartedApi = await startScopedMissionApiProcess(projectId);
    try {
      const deadline = Date.now() + 20_000;
      let reconciled = false;
      while (Date.now() < deadline) {
        const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
        const trace = await getMissionDecisionTrace(fixture.decisionId);
        if (
          snapshots.length === 1
          && trace?.events.some(({ stage }) => stage === "EVALUATED_AFTER_EXECUTION")
        ) {
          reconciled = true;
          break;
        }
        if (restartedApi.child.exitCode !== null || restartedApi.child.signalCode !== null) {
          throw new Error(
            `Restarted Mission API exited before reconciliation: ${restartedApi.output()}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(reconciled, restartedApi.output()).toBe(true);
    } finally {
      await restartedApi.stop();
    }

    const afterTrace = await getMissionDecisionTrace(fixture.decisionId);
    const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
    const executions = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, fixture.goalId));
    const tasks = await db.select().from(tasksTable)
      .where(eq(tasksTable.goalId, fixture.goalId));
    const [acceptance] = await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.id, fixture.acceptanceId));
    const effects = await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.executionId, fixture.executionId));
    expect(snapshots).toHaveLength(1);
    expect(executions.map(({ id }) => id)).toEqual([fixture.executionId]);
    expect(tasks.map(({ id, status }) => ({ id, status }))).toEqual([{
      id: fixture.taskId,
      status: "completed",
    }]);
    expect(acceptance).toMatchObject({
      executionId: fixture.executionId,
      attempt: 1,
      outcome: "SUCCEEDED",
      evidenceSnapshotId: fixture.evidenceSnapshotId,
      effectBundleId: fixture.bundleId,
    });
    expect(effects.map(({ id, status }) => ({ id, status }))).toEqual([{
      id: fixture.effectId,
      status: "observed",
    }]);
    expect(missionRunner).not.toHaveBeenCalled();

    const evaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshots[0]?.evaluation);
    expect(evaluation).toMatchObject({
      decisionId: fixture.decisionId,
      projectId,
      missionId: fixture.missionId,
      planRevision: beforeTrace?.trace.newPlanRevision,
      dispatchBatchId: dispatchEvent.referenceId,
      outcome: "ACHIEVED",
      planGoalIds: [fixture.goalId],
      planTaskIds: [fixture.taskId],
      executions: [{
        goalId: fixture.goalId,
        executionId: fixture.executionId,
        terminal: true,
        acceptanceId: fixture.acceptanceId,
        effectBundleId: fixture.bundleId,
        canonicalProofId: expect.stringMatching(/^[a-f0-9]{64}$/u),
        canonicalProofHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outcome: "ACHIEVED",
      }],
    });
    expect(evaluation.executions[0]?.canonicalProofHash)
      .toBe(evaluation.executions[0]?.canonicalProofId);
    expect(evaluation.executions[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(evaluation.evidenceSetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(afterTrace?.events.map(({ stage }) => stage).slice(-4))
      .toEqual(["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"]);
    expect(afterTrace?.trace.context.approval).toEqual(beforeTrace?.trace.context.approval);
  }, 120_000);

  async function readBoundedEffectState(fixture: {
    goalId: string;
    taskId: string;
    decisionId: string;
    rootPath: string;
  }) {
    const executions = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.goalId, fixture.goalId));
    const executionIds = executions.map(({ id }) => id);
    // The shared fixture owns unrelated rows in the same project; scope to this Goal's executions.
    const ownedBy = <T extends { executionId: string }>(rows: T[]) =>
      rows.filter(({ executionId }) => executionIds.includes(executionId));
    const projectId = executions[0]?.projectId ?? randomUUID();
    const observations = ownedBy(await db.select().from(aiAgentObservationsTable)
      .where(eq(aiAgentObservationsTable.projectId, projectId)));
    const effects = ownedBy(await db.select().from(aiAgentEffectsTable)
      .where(eq(aiAgentEffectsTable.projectId, projectId)));
    const bundles = ownedBy(await db.select().from(aiAgentEffectBundlesTable)
      .where(eq(aiAgentEffectBundlesTable.projectId, projectId)));
    const acceptances = ownedBy(await db.select().from(aiExecutionAcceptancesTable)
      .where(eq(aiExecutionAcceptancesTable.projectId, projectId)));
    const episodes = await db.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.goalId, fixture.goalId));
    const actionRequests = episodes.length
      ? (await db.select().from(aiAgentEpisodeEventsTable)
        .where(eq(aiAgentEpisodeEventsTable.episodeId, episodes[0]!.id)))
        .filter(({ eventType }) => eventType === "ACTION_REQUESTED")
      : [];
    const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, fixture.taskId));
    const [goal] = await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
    const trace = await getMissionDecisionTrace(fixture.decisionId);
    const stages = (await db.select({ stage: aiMissionDecisionEventsTable.stage })
      .from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, fixture.decisionId))
      .orderBy(asc(aiMissionDecisionEventsTable.sequence))).map(({ stage }) => stage);
    const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
    const marker = await readSyntheticMarker(fixture.rootPath);
    const journal = (await readFile(
      path.join(fixture.rootPath, "synthetic-effect", "journal.log"),
      "utf8",
    ).catch(() => "")).split("\n").filter(Boolean);
    return {
      executions,
      observations,
      effects,
      bundles,
      acceptances,
      episodes,
      actionRequests,
      task,
      goal,
      trace,
      stages,
      snapshots,
      marker,
      journal,
    };
  }

  it.each<[string, BoundedEffectCrashPoint]>([
    ["before the marker changes", "after_before_observation"],
    ["right after the marker changes", "after_mutation"],
    ["after the effect is recorded but before acceptance", "after_effect_record"],
  ])(
    "applies a bounded marker effect once when the API worker dies %s",
    async (_label, crashPoint) => {
      const fixture = await createApprovedUndispatchedMarkerFixture();
      const before = await readBoundedEffectState(fixture);
      expect(before.marker).toMatchObject({ state: "off", applications: 0 });
      expect(before.executions).toHaveLength(0);
      expect(before.stages.at(-1)).toBe("PLAN_APPLIED");

      const first = await runBoundedEffectWorker({
        projectId: fixture.projectId,
        phase: "first",
        workerId: "bounded-effect-worker-1",
        crashPoint,
      });
      expect(first.signal, first.output).toBe("SIGKILL");
      expect(first.events.map(({ event }) => event)).toEqual(expect.arrayContaining([
        "network_blocked",
        "execution_scheduled",
        "dispatch_recorded",
        "claimed",
        "crash",
      ]));
      expect(first.events.find(({ event }) => event === "dispatch_recorded"))
        .toMatchObject({ count: 1 });
      expect(first.events.find(({ event }) => event === "crash")).toMatchObject({ point: crashPoint });

      // The durable state at the crash boundary is exactly what had been committed so far.
      const crashed = await readBoundedEffectState(fixture);
      const roleCount = (role: string) =>
        crashed.observations.filter(({ observationRole }) => observationRole === role).length;
      expect(crashed.executions).toHaveLength(1);
      expect(crashed.executions[0]).toMatchObject({ status: "running", attempt: 0 });
      // The dispatch was committed before the execution ran; the outcome was not.
      expect(crashed.stages.at(-1)).toBe("DISPATCHED");
      expect(crashed.snapshots).toHaveLength(0);
      expect(crashed.acceptances).toHaveLength(0);
      expect(roleCount("before")).toBe(1);
      expect(roleCount("after")).toBe(crashPoint === "after_effect_record" ? 1 : 0);
      expect(crashed.effects).toHaveLength(crashPoint === "after_effect_record" ? 1 : 0);
      expect(crashed.marker.applications).toBe(crashPoint === "after_before_observation" ? 0 : 1);
      expect(crashed.marker.state).toBe(crashPoint === "after_before_observation" ? "off" : "on");
      const crashedExecutionId = crashed.executions[0]!.id;

      // Controlled clock advance: the dead worker's lease is now in the past.
      const expired = new Date(Date.now() - 1_000);
      await db.update(aiExecutionsTable).set({ leaseUntil: expired })
        .where(eq(aiExecutionsTable.id, crashedExecutionId));
      await db.update(tasksTable).set({ leaseUntil: expired })
        .where(eq(tasksTable.id, fixture.taskId));

      const restarted = await runBoundedEffectWorker({
        projectId: fixture.projectId,
        phase: "restart",
        workerId: "bounded-effect-worker-2",
      });
      expect(restarted.code, restarted.output).toBe(0);
      expect(restarted.events.map(({ event }) => event), restarted.output).toEqual(expect.arrayContaining([
        "network_blocked",
        "expired_leases_reconciled",
        "accepted",
        "dispatch_recorded",
        "executions_run",
        "outcomes_reconciled",
      ]));
      // The dispatch was already durable, so recovery must not record it again.
      expect(restarted.events.find(({ event }) => event === "dispatch_recorded"), restarted.output)
        .toMatchObject({ count: 0 });
      expect(restarted.events.find(({ event }) => event === "before_reused"))
        .toBeDefined();

      const settle = async () => {
        const state = await readBoundedEffectState(fixture);
        expect(state.executions.map(({ id, attempt, status }) => ({ id, attempt, status })))
          .toEqual([{ id: crashedExecutionId, attempt: 0, status: "completed" }]);
        // The effect happened once: one atomic state+counter write and one journal line.
        expect(state.marker).toMatchObject({
          state: "on",
          appliedBy: boundedEffectActionKey(crashedExecutionId, 0),
          applications: 1,
          reversals: 0,
        });
        expect(state.journal).toEqual([`apply:${boundedEffectActionKey(crashedExecutionId, 0)}`]);
        // Its record was not duplicated: one request, one before, one after, one effect, one bundle.
        expect(state.actionRequests).toHaveLength(1);
        expect(state.observations.map(({ observationRole }) => observationRole).sort())
          .toEqual(["after", "before"]);
        expect(state.effects).toHaveLength(1);
        expect(state.bundles).toHaveLength(1);
        expect(state.effects[0]).toMatchObject({
          status: "observed",
          executionId: crashedExecutionId,
          attempt: 0,
        });
        expect(state.bundles[0]).toMatchObject({ verdict: "OBSERVED", effectIds: [state.effects[0]!.id] });
        expect(state.acceptances).toHaveLength(1);
        expect(state.acceptances[0]).toMatchObject({
          executionId: crashedExecutionId,
          attempt: 0,
          outcome: "SUCCEEDED",
          terminalStatus: "completed",
          resumable: 0,
          evidenceRequired: 1,
          evidenceComplete: 1,
          effectBundleId: state.bundles[0]!.id,
        });
        expect(state.task).toMatchObject({ status: "completed", workerId: null });
        expect(state.goal?.status).toBe("completed");
        for (const stage of [
          "DISPATCHED",
          "EXECUTED",
          "ACCEPTED",
          "VERIFIED",
          "EVALUATED_AFTER_EXECUTION",
        ] as const) {
          expect(state.stages.filter((value) => value === stage), stage).toHaveLength(1);
        }
        expect(state.snapshots).toHaveLength(1);
        return state;
      };
      const recovered = await settle();

      // The before/after pair and the acceptance are reloaded from the database, not from the worker.
      const beforeObservation = recovered.observations.find(({ observationRole }) => observationRole === "before");
      const afterObservation = recovered.observations.find(({ observationRole }) => observationRole === "after");
      expect(beforeObservation).toMatchObject({
        provenance: "DIRECT_OBSERVATION",
        value: { state: "off" },
        completeness: "complete",
        freshness: "fresh",
      });
      expect(afterObservation).toMatchObject({
        provenance: "DIRECT_OBSERVATION",
        value: { state: "on" },
        completeness: "complete",
        freshness: "fresh",
      });
      expect(recovered.effects[0]).toMatchObject({
        beforeObservationIds: [beforeObservation!.id],
        afterObservationIds: [afterObservation!.id],
      });
      expect(recovered.acceptances[0]?.disposition).toMatchObject({
        proof: { verdict: "PROVEN" },
      });
      const evaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(
        recovered.snapshots[0]?.evaluation,
      );
      expect(evaluation).toMatchObject({
        outcome: "ACHIEVED",
        executions: [{
          executionId: crashedExecutionId,
          acceptanceId: recovered.acceptances[0]!.id,
          effectBundleId: recovered.bundles[0]!.id,
          canonicalProofId: expect.stringMatching(/^[a-f0-9]{64}$/u),
          outcome: "ACHIEVED",
          observedEffectCodes: [BOUNDED_EFFECT_CODE],
        }],
      });
      const [dispatchEvent] = await db.select({ referenceId: aiMissionDecisionEventsTable.referenceId })
        .from(aiMissionDecisionEventsTable)
        .where(and(
          eq(aiMissionDecisionEventsTable.decisionId, fixture.decisionId),
          eq(aiMissionDecisionEventsTable.stage, "DISPATCHED"),
        ));
      const dispatch = await getMissionDecisionDispatchBatch(dispatchEvent!.referenceId!);
      expect(dispatch?.items).toMatchObject([{ goalId: fixture.goalId, executionId: crashedExecutionId }]);

      // A further restart finds everything complete and changes nothing.
      const replay = await runBoundedEffectWorker({
        projectId: fixture.projectId,
        phase: "restart",
        workerId: "bounded-effect-worker-3",
      });
      expect(replay.code, replay.output).toBe(0);
      expect(replay.events.some(({ event }) => event === "mutation")).toBe(false);
      const replayed = await settle();
      expect(replayed.snapshots.map(({ outcomeId }) => outcomeId))
        .toEqual(recovered.snapshots.map(({ outcomeId }) => outcomeId));
      expect(missionRunner).not.toHaveBeenCalled();

      // The marker is reversible, and only for the action that applied it.
      await reverseSyntheticMarker(fixture.rootPath, boundedEffectActionKey(crashedExecutionId, 0));
      expect(await readSyntheticMarker(fixture.rootPath)).toMatchObject({
        state: "off",
        applications: 1,
        reversals: 1,
      });
    },
    180_000,
  );

  it("keeps dispatched Goal and Task pending after restart when proof is insufficient", async () => {
    const fixture = await createDispatchedPendingOutcomeFixture();
    const beforeTrace = await getMissionDecisionTrace(fixture.decisionId);
    expect(beforeTrace?.events.map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId)))
      .toHaveLength(0);

    const recovered = await runMissionOutcomeRecoveryProcess({
      projectId: fixture.projectId,
    });
    expect(recovered.code, recovered.output).toBe(0);
    expect(recovered.output).toMatch(/MISSION_OUTCOME_RECONCILED:[1-9]\d*/u);

    const [goal] = await db.select().from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId));
    const [task] = await db.select().from(tasksTable)
      .where(eq(tasksTable.id, fixture.taskId));
    const [execution] = await db.select().from(aiExecutionsTable)
      .where(eq(aiExecutionsTable.id, fixture.executionId));
    const afterTrace = await getMissionDecisionTrace(fixture.decisionId);
    const [snapshot] = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
    const evaluation = MissionStrategyPlanOutcomeEvaluationSchema.parse(snapshot?.evaluation);

    expect(goal).toMatchObject({ status: "queued", completedAt: null });
    expect(task).toMatchObject({ status: "queued", completedAt: null });
    expect(execution).toMatchObject({ status: "queued", completedAt: null });
    expect(evaluation).toMatchObject({
      outcome: "INCONCLUSIVE",
      goalStates: [{ goalId: fixture.goalId, terminal: false, taskIds: [fixture.taskId] }],
      taskStates: [{ taskId: fixture.taskId, goalId: fixture.goalId, terminal: false }],
      executions: [{
        goalId: fixture.goalId,
        taskId: fixture.taskId,
        executionId: fixture.executionId,
        terminal: false,
        acceptanceId: null,
        effectBundleId: null,
        canonicalProofId: null,
        outcome: "INCONCLUSIVE",
      }],
      limitationCodes: expect.arrayContaining([
        "plan_goal_nonterminal",
        "plan_task_nonterminal",
        "plan_execution_nonterminal",
        "required_execution_evidence_inconclusive",
      ]),
    });
    expect(afterTrace?.events.map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
    expect(afterTrace?.events.some(({ stage }) =>
      ["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"].includes(stage)))
      .toBe(false);
    expect(snapshot?.outcome).toBe("INCONCLUSIVE");
  }, 60_000);

  it("recovers dispatched plan evaluation from the durable event journal without replaying Goal work", async () => {
    const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED");
    missionRunner.mockClear();

    const [first, concurrent] = await Promise.all([
      reconcilePendingMissionPlanOutcomes(16, fixture.projectId),
      reconcilePendingMissionPlanOutcomes(16, fixture.projectId),
    ]);

    expect(first + concurrent).toBeGreaterThan(0);
    expect((await getMissionDecisionTrace(fixture.decisionId))?.events
      .map(({ stage }) => stage).slice(-4))
      .toEqual(["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"]);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId)))
      .toHaveLength(1);
    expect(missionRunner).not.toHaveBeenCalled();
  });

  describe("approval receipt changes after dispatch", () => {
    type ApprovalTamperFixture = Awaited<ReturnType<typeof createPersistedEffectOutcomeFixture>>;

    async function readApprovedPlanContract(fixture: ApprovalTamperFixture) {
      const [goal] = await db.select({ outcomeContract: aiGoalsTable.outcomeContract })
        .from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId));
      const contract = goal?.outcomeContract as Record<string, unknown> | undefined;
      const planApproval = contract?.planApproval as Record<string, unknown> | undefined;
      if (!contract || !planApproval) throw new Error("approved plan contract fixture is missing");
      return { contract, planApproval };
    }

    async function changeApprovedPlanContract(
      fixture: ApprovalTamperFixture,
      change: Record<string, unknown>,
    ) {
      const { contract, planApproval } = await readApprovedPlanContract(fixture);
      await db.update(aiGoalsTable).set({
        outcomeContract: { ...contract, planApproval: { ...planApproval, ...change } },
      }).where(eq(aiGoalsTable.id, fixture.goalId));
    }

    const approvalReceiptChanges: Array<{
      name: string;
      code: MissionDecisionTraceStoreError["code"];
      change: (fixture: ApprovalTamperFixture) => Promise<void>;
    }> = [
      {
        name: "the approval state is revoked",
        code: "decision_approval_binding_invalid",
        change: (fixture) => changeApprovedPlanContract(fixture, { state: "REVOKED" }),
      },
      {
        name: "the approved receipt identity changes",
        code: "decision_approval_binding_invalid",
        change: (fixture) => changeApprovedPlanContract(fixture, { approvedBy: "different-approver" }),
      },
      {
        name: "the approval event pointer changes",
        code: "decision_approval_binding_invalid",
        change: (fixture) => changeApprovedPlanContract(fixture, { approvalEventId: randomUUID() }),
      },
      {
        name: "the approved plan revision changes",
        code: "decision_approval_binding_invalid",
        change: (fixture) => changeApprovedPlanContract(fixture, {
          planRevision: `auto:${randomUUID()}:${"f".repeat(64)}`,
        }),
      },
      {
        name: "the APPROVED lifecycle event reference changes without its hash",
        code: "decision_event_conflict",
        change: (fixture) => changeApprovedEventReference(fixture, false),
      },
      {
        name: "the APPROVED lifecycle event reference changes with a recomputed hash",
        code: "decision_approval_binding_invalid",
        change: (fixture) => changeApprovedEventReference(fixture, true),
      },
    ];

    async function changeApprovedEventReference(
      fixture: ApprovalTamperFixture,
      recomputeHash: boolean,
    ) {
      const [event] = await db.select().from(aiMissionDecisionEventsTable)
        .where(and(
          eq(aiMissionDecisionEventsTable.decisionId, fixture.decisionId),
          eq(aiMissionDecisionEventsTable.stage, "APPROVED"),
        ));
      if (!event) throw new Error("APPROVED event fixture is missing");
      const referenceId = `mission-plan-approvals:${"0".repeat(64)}`;
      const updated = await db.update(aiMissionDecisionEventsTable).set({
        referenceId,
        ...(recomputeHash
          ? {
              eventHash: eventHash({
                decisionId: fixture.decisionId,
                stage: "APPROVED",
                referenceId,
                occurredAt: event.occurredAt,
              }),
            }
          : {}),
      }).where(eq(aiMissionDecisionEventsTable.id, event.id))
        .returning({ id: aiMissionDecisionEventsTable.id });
      expect(updated).toHaveLength(1);
    }

    async function readOutcomeState(fixture: ApprovalTamperFixture) {
      const events = await db.select({
        stage: aiMissionDecisionEventsTable.stage,
      }).from(aiMissionDecisionEventsTable)
        .where(eq(aiMissionDecisionEventsTable.decisionId, fixture.decisionId))
        .orderBy(aiMissionDecisionEventsTable.sequence);
      const snapshots = await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
        .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, fixture.decisionId));
      const executions = await db.select().from(aiExecutionsTable)
        .where(eq(aiExecutionsTable.goalId, fixture.goalId));
      const acceptances = await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId));
      return { stages: events.map(({ stage }) => stage), snapshots, executions, acceptances };
    }

    const FINAL_STAGES = ["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"];

    it.each(approvalReceiptChanges)(
      "refuses a Mission plan outcome when $name after dispatch",
      async ({ code, change }) => {
        const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED", true);
        missionRunner.mockClear();
        const before = await readOutcomeState(fixture);
        expect(before.stages).toEqual([
          "PROPOSED",
          "EVALUATED",
          "SELECTED",
          "APPROVED",
          "PLAN_APPLIED",
          "DISPATCHED",
        ]);
        expect(before.snapshots).toHaveLength(0);

        await change(fixture);

        // The trace loader fails closed: the changed receipt yields neither a
        // decisive nor an inconclusive snapshot, and no lifecycle suffix.
        await expect(finalizeMissionPlanOutcome(fixture.decisionId))
          .rejects.toMatchObject({ code });
        await expect(evaluateAndPersistMissionPlanOutcome(fixture.decisionId))
          .rejects.toMatchObject({ code });

        // Recovery stays pending without counting the rejected decision as reconciled.
        expect(await reconcilePendingMissionPlanOutcomes(16, fixture.projectId)).toBe(0);
        expect(await reconcilePendingMissionPlanOutcomes(16, fixture.projectId)).toBe(0);

        const after = await readOutcomeState(fixture);
        expect(after.snapshots).toHaveLength(0);
        expect(after.stages).toEqual(before.stages);
        expect(after.stages.some((stage) => FINAL_STAGES.includes(stage))).toBe(false);
        expect(after.executions.map(({ id }) => id)).toEqual([fixture.executionId]);
        expect(after.acceptances.map(({ id }) => id)).toEqual([fixture.acceptanceId]);
        expect(missionRunner).not.toHaveBeenCalled();
      },
      60_000,
    );

    it("does not evaluate an approved plan after its active revision changes post-dispatch", async () => {
      const fixture = await createPersistedEffectOutcomeFixture("ACHIEVED", true);
      missionRunner.mockClear();
      const before = await readOutcomeState(fixture);
      const staleRevision = `auto:${randomUUID()}:${"d".repeat(64)}`;
      expect(before.stages.at(-1)).toBe("DISPATCHED");
      await db.update(aiMissionsTable).set({
        autonomyPolicy: { activePlanRevision: staleRevision },
      }).where(eq(aiMissionsTable.id, fixture.missionId));

      expect(await finalizeMissionPlanOutcome(fixture.decisionId)).toEqual({
        kind: "not_ready",
        reason: "plan_not_current",
      });
      await reconcilePendingMissionPlanOutcomes(16, fixture.projectId);

      const after = await readOutcomeState(fixture);
      expect(after.snapshots).toHaveLength(0);
      expect(after.stages).toEqual(before.stages);
      expect(after.stages.some((stage) => FINAL_STAGES.includes(stage))).toBe(false);
      expect(after.executions.map(({ id }) => id)).toEqual([fixture.executionId]);
      expect(after.acceptances.map(({ id }) => id)).toEqual([fixture.acceptanceId]);
      expect(missionRunner).not.toHaveBeenCalled();
    }, 60_000);
  });

  it("keeps the scoped outcome reconciler inside its assigned project", async () => {
    const scopedFixture = await createPersistedEffectOutcomeFixture("ACHIEVED");
    const otherFixture = await createPersistedEffectOutcomeFixture("ACHIEVED");

    await expect(reconcilePendingMissionPlanOutcomes(16, scopedFixture.projectId))
      .resolves.toBeGreaterThan(0);
    expect((await getMissionDecisionTrace(scopedFixture.decisionId))?.events
      .map(({ stage }) => stage).slice(-4))
      .toEqual(["EXECUTED", "ACCEPTED", "VERIFIED", "EVALUATED_AFTER_EXECUTION"]);
    expect((await getMissionDecisionTrace(otherFixture.decisionId))?.events
      .map(({ stage }) => stage).slice(-2))
      .toEqual(["PLAN_APPLIED", "DISPATCHED"]);
    expect(await db.select().from(aiMissionDecisionOutcomeSnapshotsTable)
      .where(eq(aiMissionDecisionOutcomeSnapshotsTable.decisionId, otherFixture.decisionId)))
      .toHaveLength(0);
  });

  it("records every applied-plan root in one idempotent dispatch batch", async () => {
    const fixture = await createFixture();
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
    });
    await persistMissionDecisionTrace(selectedTrace);

    const planRevision = "multi-root-applied-plan";
    const rootGoalIds = [randomUUID(), randomUUID()].sort();
    const dependentGoalId = randomUUID();
    await db.insert(aiGoalsTable).values([
      ...rootGoalIds.map((id, index) => ({
        id,
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        title: `Independent root ${index + 1}`,
        status: "queued" as const,
        successCriteria: { planRevision: { hash: planRevision } },
        evidenceContract: { required: true },
        outcomeContract: { planRevision: { hash: planRevision } },
        nextAction: { kind: "execute" },
        createdAt: now,
        updatedAt: now,
      })),
      {
        id: dependentGoalId,
        missionId: fixture.missionId,
        projectId: fixture.projectId,
        title: "Dependent Goal, not a root",
        status: "queued",
        successCriteria: { planRevision: { hash: planRevision } },
        evidenceContract: { required: true },
        outcomeContract: { planRevision: { hash: planRevision } },
        nextAction: { kind: "execute" },
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(aiGoalDependenciesTable).values(rootGoalIds.map((dependsOnGoalId) => ({
      id: randomUUID(),
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: dependentGoalId,
      dependsOnGoalId,
      planRevision,
      createdAt: now,
    })));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 2_000),
    });

    const executionIds = rootGoalIds.map(() => randomUUID());
    await db.insert(aiExecutionsTable).values(rootGoalIds.map((goalId, index) => ({
      id: executionIds[index]!,
      projectId: fixture.projectId,
      goalId,
      userId: "test-user",
      idempotencyKey: `dispatch-batch-${executionIds[index]}`,
      resumeTokenHash: "e".repeat(64),
      request: "{}",
      checkpoint: "{}",
      attempt: 1,
      status: "queued" as const,
      baseRevision: "decision-project-revision",
      createdAt: now,
      updatedAt: now,
    })));

    const input = {
      decisionId: selectedTrace.decisionId,
      planRevision,
      occurredAt: new Date(now.getTime() + 3_000),
      items: rootGoalIds.map((goalId, position) => ({
        position,
        goalId,
        executionId: executionIds[position]!,
        runStatus: "scheduled" as const,
      })),
    };
    await expect(db.transaction(async (tx) => {
      await recordMissionDecisionDispatchBatchInTransaction(tx, input);
      throw new Error("rollback dispatch batch");
    })).rejects.toThrow("rollback dispatch batch");
    expect(await db.select().from(aiMissionDecisionDispatchBatchesTable)
      .where(eq(aiMissionDecisionDispatchBatchesTable.decisionId, selectedTrace.decisionId)))
      .toHaveLength(0);
    expect((await getMissionDecisionTrace(selectedTrace.decisionId))?.events)
      .toHaveLength(4);

    const recorded = await db.transaction((tx) =>
      recordMissionDecisionDispatchBatchInTransaction(tx, input));
    expect(recorded.batch).toMatchObject({
      kind: "inserted",
      state: "dispatched",
      rootCount: 2,
    });
    expect(recorded.event).toMatchObject({ kind: "appended", sequence: 5 });

    const replay = await recordMissionDecisionDispatchBatch(input);
    expect(replay.batch).toMatchObject({
      kind: "already_recorded",
      dispatchBatchId: recorded.batch.dispatchBatchId,
      manifestHash: recorded.batch.manifestHash,
      createdAt: recorded.batch.createdAt,
    });
    expect(replay.event).toMatchObject({ kind: "already_recorded", sequence: 5 });

    await expect(recordMissionDecisionDispatchBatch({
      ...input,
      items: input.items.slice(0, 1),
    })).rejects.toMatchObject({ code: "decision_dispatch_roots_mismatch" });
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "EXECUTED",
      referenceId: recorded.batch.dispatchBatchId,
      occurredAt: new Date(now.getTime() + 4_000),
    })).rejects.toMatchObject({ code: "decision_event_order_invalid" });

    const storedBatch = await getMissionDecisionDispatchBatch(recorded.batch.dispatchBatchId);
    expect(storedBatch?.batch.manifestHash).toBe(recorded.batch.manifestHash);
    expect(storedBatch?.items.map(({ goalId, executionId }) => ({ goalId, executionId }))).toEqual(
      rootGoalIds.map((goalId, index) => ({ goalId, executionId: executionIds[index] })),
    );
    const storedTrace = await getMissionDecisionTrace(selectedTrace.decisionId);
    expect(storedTrace?.events.slice(-2).map(({ stage, referenceId }) => ({ stage, referenceId }))).toEqual([
      { stage: "PLAN_APPLIED", referenceId: planRevision },
      { stage: "DISPATCHED", referenceId: recorded.batch.dispatchBatchId },
    ]);
    expect(await db.select().from(aiMissionDecisionDispatchBatchesTable)
      .where(eq(aiMissionDecisionDispatchBatchesTable.decisionId, selectedTrace.decisionId)))
      .toHaveLength(1);
    expect(await db.select().from(aiMissionDecisionDispatchItemsTable)
      .where(eq(aiMissionDecisionDispatchItemsTable.dispatchBatchId, recorded.batch.dispatchBatchId)))
      .toHaveLength(2);
  });
});

describe("Mission strategy shadow reconciliation", () => {
  it("opens the Mission Control delay alert for a real aged queue and closes it after comparison", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-mission-control-${randomUUID()}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    const occurredAt = new Date(Date.now() - 2 * 60_000);
    const originalShadowMode = process.env.MISSION_DECISION_SHADOW_MODE;
    const originalShadowProjectId = process.env.MISSION_DECISION_SHADOW_PROJECT_ID;
    const originalAlertAge = process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS;
    process.env.MISSION_DECISION_SHADOW_MODE = "1";
    process.env.MISSION_DECISION_SHADOW_PROJECT_ID = fixture.projectId;
    process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS = "60000";

    const readProjectState = async () => ({
      missions: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      traces: await db.select().from(aiMissionDecisionTracesTable)
        .where(eq(aiMissionDecisionTracesTable.decisionId, selectedTrace.decisionId)),
      events: await db.select().from(aiMissionDecisionEventsTable)
        .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId)),
      comparisons: await db.select().from(aiMissionDecisionShadowComparisonsTable)
        .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, selectedTrace.decisionId)),
    });

    try {
      await persistMissionDecisionTrace(selectedTrace);
      await db.update(aiGoalsTable).set({
        successCriteria: { planRevision: { hash: planRevision } },
        outcomeContract: { planRevision: { hash: planRevision } },
      }).where(eq(aiGoalsTable.id, fixture.goalId));
      await db.update(aiMissionsTable).set({
        autonomyPolicy: { activePlanRevision: planRevision },
      }).where(eq(aiMissionsTable.id, fixture.missionId));
      await appendMissionDecisionLifecycleEvent({
        decisionId: selectedTrace.decisionId,
        stage: "PLAN_APPLIED",
        referenceId: planRevision,
        occurredAt,
      });

      const beforeOpenRead = await readProjectState();
      const openResponse = await request(app).get("/api/ai/mission-control");
      const afterOpenRead = await readProjectState();

      expect(openResponse.status).toBe(200);
      expect(openResponse.body.shadowComparisonQueue).toMatchObject({
        status: "active",
        pendingCount: 1,
        delayAlertStatus: "open",
      });
      expect(openResponse.body.shadowComparisonQueue.oldestPendingAgeMs).toBeGreaterThanOrEqual(2 * 60_000);
      expect(openResponse.body.shadowComparisonQueue.oldestPendingAgeMs).toBeLessThan(2 * 60_000 + 10_000);
      expect(afterOpenRead).toEqual(beforeOpenRead);

      expect(await persistMissionDecisionShadowComparison(selectedTrace.decisionId)).toBe("recorded");
      const beforeClosedRead = await readProjectState();
      const closedResponse = await request(app).get("/api/ai/mission-control");
      const afterClosedRead = await readProjectState();

      expect(closedResponse.status).toBe(200);
      expect(closedResponse.body.shadowComparisonQueue).toMatchObject({
        status: "active",
        pendingCount: 0,
        oldestPendingAgeMs: null,
        delayAlertStatus: "closed",
      });
      expect(afterClosedRead).toEqual(beforeClosedRead);
    } finally {
      if (originalShadowMode === undefined) delete process.env.MISSION_DECISION_SHADOW_MODE;
      else process.env.MISSION_DECISION_SHADOW_MODE = originalShadowMode;
      if (originalShadowProjectId === undefined) delete process.env.MISSION_DECISION_SHADOW_PROJECT_ID;
      else process.env.MISSION_DECISION_SHADOW_PROJECT_ID = originalShadowProjectId;
      if (originalAlertAge === undefined) delete process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS;
      else process.env.MISSION_DECISION_SHADOW_QUEUE_ALERT_AGE_MS = originalAlertAge;
    }
  });

  it("reports only the scoped eligible backlog and does not mutate Mission state", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-queue-${randomUUID()}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    await persistMissionDecisionTrace(selectedTrace);
    const occurredAt = new Date(Date.now() - 2 * 60_000);
    await db.update(aiGoalsTable).set({
      successCriteria: { planRevision: { hash: planRevision } },
      outcomeContract: { planRevision: { hash: planRevision } },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt,
    });
    const missionBefore = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const eventsBefore = await db.select().from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId));

    const stats = await getPendingMissionDecisionShadowQueueStats(fixture.projectId);
    const outsideScope = await getPendingMissionDecisionShadowQueueStats(randomUUID());
    const missionAfter = await db.select().from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, fixture.missionId));
    const eventsAfter = await db.select().from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId));

    expect(stats.pendingCount).toBe(1);
    expect(stats.oldestPendingAgeMs).toBeGreaterThanOrEqual(2 * 60_000);
    expect(stats.oldestPendingAgeMs).toBeLessThan(2 * 60_000 + 10_000);
    expect(outsideScope).toEqual({ pendingCount: 0, oldestPendingAgeMs: null });
    expect(missionAfter).toEqual(missionBefore);
    expect(eventsAfter).toEqual(eventsBefore);
  });

  it("retries a temporarily failed comparison after later batch entries are saved", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-retry-${randomUUID()}`;
    const failedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    const laterTrace = makeSelectedTrace({
      trace: {
        ...fixture.trace,
        context: {
          ...fixture.trace.context,
          capturedAt: new Date(now.getTime() + 500).toISOString(),
        },
      },
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    await persistMissionDecisionTrace(failedTrace);
    await persistMissionDecisionTrace(laterTrace);
    await db.update(aiGoalsTable).set({
      successCriteria: { planRevision: { hash: planRevision } },
      outcomeContract: { planRevision: { hash: planRevision } },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: failedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    await appendMissionDecisionLifecycleEvent({
      decisionId: laterTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 2_000),
    });

    const authoritativeStateBefore = {
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
    };

    const transactionSpy = vi.spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("transient shadow persistence failure"));
    let firstPassCount: number;
    try {
      firstPassCount = await reconcilePendingMissionDecisionShadows(8, fixture.projectId);
    } finally {
      transactionSpy.mockRestore();
    }
    expect(firstPassCount).toBe(1);
    expect(await db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, failedTrace.decisionId))).toHaveLength(0);
    expect(await db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, laterTrace.decisionId))).toHaveLength(1);

    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(1);
    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    const shadowRows = await db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.projectId, fixture.projectId));
    expect(shadowRows).toHaveLength(2);
    expect(new Set(shadowRows.map(({ decisionId }) => decisionId))).toEqual(
      new Set([failedTrace.decisionId, laterTrace.decisionId]),
    );
    expect({
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
    }).toEqual(authoritativeStateBefore);
  });

  it("rediscovers an applied trace without a sidecar after the worker loses its in-memory state", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-restart-${randomUUID()}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    await persistMissionDecisionTrace(selectedTrace);
    await db.update(aiGoalsTable).set({
      successCriteria: { planRevision: { hash: planRevision } },
      outcomeContract: { planRevision: { hash: planRevision } },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    const readAuthoritativeState = async () => ({
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
      events: await db.select().from(aiMissionDecisionEventsTable)
        .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId)),
    });
    const sidecarRows = () => db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, selectedTrace.decisionId));
    const authoritativeStateBefore = await readAuthoritativeState();

    // The first worker dies after discovering the candidate but before any
    // sidecar write commits. Nothing is left in the database for it.
    const crashedTransaction = vi.spyOn(db, "transaction")
      .mockRejectedValue(new Error("worker lost before the sidecar committed"));
    try {
      expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    } finally {
      crashedTransaction.mockRestore();
    }
    expect(await sidecarRows()).toHaveLength(0);
    expect((await getPendingMissionDecisionShadowQueueStats(fixture.projectId)).pendingCount).toBe(1);

    // A restarted API gets a fresh module instance with no retained worker state.
    vi.resetModules();
    const restarted = await import("./mission-strategy-shadow-store.js");
    expect(restarted.reconcilePendingMissionDecisionShadows).not.toBe(reconcilePendingMissionDecisionShadows);
    expect((await restarted.getPendingMissionDecisionShadowQueueStats(fixture.projectId)).pendingCount).toBe(1);

    expect(await restarted.reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(1);
    const rebuilt = await sidecarRows();
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toMatchObject({
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      goalId: fixture.goalId,
      appliedPlanRevision: planRevision,
      contextHash: selectedTrace.contextHash,
    });

    // A second restart finds nothing pending and leaves the single sidecar intact.
    vi.resetModules();
    const restartedAgain = await import("./mission-strategy-shadow-store.js");
    expect((await restartedAgain.getPendingMissionDecisionShadowQueueStats(fixture.projectId)).pendingCount).toBe(0);
    expect(await restartedAgain.reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    expect(await sidecarRows()).toEqual(rebuilt);
    expect(await readAuthoritativeState()).toEqual(authoritativeStateBefore);
    expect(missionRunner).not.toHaveBeenCalled();
  });

  it("keeps one sidecar when the worker loses the success acknowledgement after the commit", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-lost-ack-${randomUUID()}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    await persistMissionDecisionTrace(selectedTrace);
    await db.update(aiGoalsTable).set({
      successCriteria: { planRevision: { hash: planRevision } },
      outcomeContract: { planRevision: { hash: planRevision } },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    const readAuthoritativeState = async () => ({
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
      events: await db.select().from(aiMissionDecisionEventsTable)
        .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId)),
    });
    const sidecarRows = () => db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, selectedTrace.decisionId));
    const authoritativeStateBefore = await readAuthoritativeState();
    expect((await getPendingMissionDecisionShadowQueueStats(fixture.projectId)).pendingCount).toBe(1);

    // The sidecar insert and transaction commit both succeed, but the caller
    // sees a failure instead of the success acknowledgement.
    const originalTransaction = db.transaction.bind(db);
    let committedBeforeLoss = 0;
    const lostAcknowledgement = vi.spyOn(db, "transaction").mockImplementationOnce((async (
      ...args: Parameters<typeof originalTransaction>
    ) => {
      await originalTransaction(...args);
      committedBeforeLoss += 1;
      throw new Error("connection lost after the sidecar commit");
    }) as unknown as typeof db.transaction);
    try {
      expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    } finally {
      lostAcknowledgement.mockRestore();
    }
    expect(committedBeforeLoss).toBe(1);
    const committed = await sidecarRows();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      goalId: fixture.goalId,
      appliedPlanRevision: planRevision,
      contextHash: selectedTrace.contextHash,
    });
    expect(await readAuthoritativeState()).toEqual(authoritativeStateBefore);

    // The worker retries the same decision directly and through reconciliation.
    expect(await persistMissionDecisionShadowComparison(selectedTrace.decisionId)).toBe("already_recorded");
    expect((await getPendingMissionDecisionShadowQueueStats(fixture.projectId)).pendingCount).toBe(0);
    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);

    expect(await sidecarRows()).toEqual(committed);
    expect(await readAuthoritativeState()).toEqual(authoritativeStateBefore);
    expect(missionRunner).not.toHaveBeenCalled();
  });

  it("records an applied-trace comparison idempotently without changing authoritative Mission state", async () => {
    const fixture = await createFixture();
    const planRevision = `shadow-applied-${randomUUID()}`;
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: planRevision,
    });
    const pureComparison = buildMissionStrategyShadowComparison({
      trace: selectedTrace,
      appliedPlanRevision: planRevision,
    });
    const retryComparison = buildMissionStrategyShadowComparison({
      trace: selectedTrace,
      appliedPlanRevision: planRevision,
    });
    expect(pureComparison.status).toBe("computed");
    expect(retryComparison).toEqual(pureComparison);
    if (pureComparison.status === "computed") {
      expect(() => MissionStrategyShadowComparisonSchema.parse({
        ...pureComparison.comparison,
        comparisonHash: "f".repeat(64),
      })).toThrow();
    }
    await persistMissionDecisionTrace(selectedTrace);
    await db.update(aiMissionsTable).set({
      autonomyPolicy: { activePlanRevision: planRevision },
    }).where(eq(aiMissionsTable.id, fixture.missionId));
    await db.insert(aiGoalsTable).values({
      id: randomUUID(),
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      title: "Applied shadow comparison plan",
      status: "needs_replan",
      successCriteria: { planRevision: { hash: planRevision } },
      evidenceContract: { required: true },
      outcomeContract: { planRevision: { hash: planRevision } },
      nextAction: { kind: "replan" },
      createdAt: now,
      updatedAt: now,
    });

    const before = {
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
      dispatchBatches: await db.select().from(aiMissionDecisionDispatchBatchesTable)
        .where(eq(aiMissionDecisionDispatchBatchesTable.decisionId, selectedTrace.decisionId)),
    };

    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    await appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: planRevision,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    const eventsBeforeShadow = await db.select().from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId));
    const concurrentResults = await Promise.all([
      reconcilePendingMissionDecisionShadows(8, fixture.projectId),
      reconcilePendingMissionDecisionShadows(8, fixture.projectId),
    ]);
    expect(concurrentResults.reduce((total, current) => total + current, 0)).toBe(1);

    const shadowRows = await db.select().from(aiMissionDecisionShadowComparisonsTable)
      .where(eq(aiMissionDecisionShadowComparisonsTable.decisionId, selectedTrace.decisionId));
    expect(shadowRows).toHaveLength(1);
    expect(shadowRows[0]).toMatchObject({
      projectId: fixture.projectId,
      missionId: fixture.missionId,
      goalId: fixture.goalId,
      sourceExecutionId: fixture.executionId,
      sourceAcceptanceId: fixture.acceptanceId,
      sourceAttempt: 2,
      appliedPlanRevision: planRevision,
      contextHash: selectedTrace.contextHash,
      baselineStrategyId: "safe-read-one",
      shadowResultKind: "SELECTED",
      shadowStrategyId: "safe-read-one",
      comparisonKind: "AGREES",
    });
    if (pureComparison.status === "computed") {
      expect(shadowRows[0]?.comparisonHash).toBe(pureComparison.comparison.comparisonHash);
    }
    expect(await reconcilePendingMissionDecisionShadows(8, fixture.projectId)).toBe(0);
    expect({
      mission: await db.select().from(aiMissionsTable).where(eq(aiMissionsTable.id, fixture.missionId)),
      goals: await db.select().from(aiGoalsTable).where(eq(aiGoalsTable.missionId, fixture.missionId)),
      executions: await db.select().from(aiExecutionsTable).where(eq(aiExecutionsTable.goalId, fixture.goalId)),
      acceptances: await db.select().from(aiExecutionAcceptancesTable)
        .where(eq(aiExecutionAcceptancesTable.executionId, fixture.executionId)),
      tasks: await db.select().from(tasksTable).where(eq(tasksTable.goalId, fixture.goalId)),
      dispatchBatches: await db.select().from(aiMissionDecisionDispatchBatchesTable)
        .where(eq(aiMissionDecisionDispatchBatchesTable.decisionId, selectedTrace.decisionId)),
    }).toEqual(before);
    expect(await db.select().from(aiMissionDecisionEventsTable)
      .where(eq(aiMissionDecisionEventsTable.decisionId, selectedTrace.decisionId)))
      .toEqual(eventsBeforeShadow);
    expect(missionRunner).not.toHaveBeenCalled();
  });

  it("refuses to bind a shadow comparison to a different applied plan revision", async () => {
    const fixture = await createFixture();
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: `shadow-applied-${randomUUID()}`,
    });

    expect(buildMissionStrategyShadowComparison({
      trace: selectedTrace,
      appliedPlanRevision: "stale-or-unrelated-plan",
    })).toMatchObject({
      status: "not_eligible",
      reasonCode: "plan_revision_mismatch",
    });
  });

  it("keeps authorization uncertainty and denial as non-selected shadow outcomes", async () => {
    const fixture = await createFixture();
    const selectedTrace = makeSelectedTrace({
      trace: fixture.trace,
      worldStateRevision: fixture.worldStateRevision,
      worldFactId: fixture.worldFactId,
      worldFactHash: fixture.worldFactHash,
      newPlanRevision: `shadow-applied-${randomUUID()}`,
    });
    const rehashAuthorization = (status: "approval_required" | "unknown") => {
      const context = MissionDecisionContextSchema.parse({
        ...selectedTrace.context,
        authorization: {
          status,
          policyRef: status === "approval_required" ? "server-policy:test" : null,
          reasonCodes: [status === "approval_required" ? "approval_required" : "authorization_unknown"],
        },
      });
      const { decisionId: _previousDecisionId, ...traceBody } = selectedTrace;
      const body = {
        ...traceBody,
        context,
        contextHash: hashMissionDecisionContext(context),
      };
      return MissionDecisionTraceSchema.parse({
        ...body,
        decisionId: hashMissionDecisionTrace(body),
      });
    };

    const blockedTrace = rehashAuthorization("approval_required");
    const blocked = buildMissionStrategyShadowComparison({
      trace: blockedTrace,
      appliedPlanRevision: blockedTrace.newPlanRevision!,
    });
    expect(blocked).toMatchObject({
      status: "computed",
      comparison: {
        comparisonKind: "BLOCKED",
        shadowResult: { kind: "BLOCKED", reasonCode: "approval_required" },
        shadowStrategyId: null,
      },
    });

    const uncertainTrace = rehashAuthorization("unknown");
    const uncertain = buildMissionStrategyShadowComparison({
      trace: uncertainTrace,
      appliedPlanRevision: uncertainTrace.newPlanRevision!,
    });
    expect(uncertain).toMatchObject({
      status: "computed",
      comparison: {
        comparisonKind: "NO_DECISION",
        shadowResult: { kind: "NO_DECISION", reasonCode: "insufficient_evidence" },
        shadowStrategyId: null,
      },
    });
  });
});
