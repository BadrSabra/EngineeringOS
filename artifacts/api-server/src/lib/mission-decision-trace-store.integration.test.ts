import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
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
  getMissionDecisionTrace,
  getMissionDecisionDispatchBatch,
  MissionDecisionTraceStoreError,
  persistMissionDecisionTrace,
  persistMissionDecisionTraceInTransaction,
  recordMissionDecisionDispatchBatch,
  recordMissionDecisionDispatchBatchInTransaction,
} from "./mission-decision-trace-store.js";
import { approveMissionGoal } from "./mission-approval.js";
import { reconcileApprovedMissionDecisionDispatches } from "./mission-auto-replan.js";
import {
  evaluateAndPersistMissionPlanOutcome,
  finalizeMissionPlanOutcome,
  reconcilePendingMissionPlanOutcomes,
} from "./mission-strategy-plan-outcome-store.js";
import { reconcilePendingMissionDecisionShadows } from "./mission-strategy-shadow-store.js";

const projectIds: string[] = [];
const now = new Date("2026-11-03T10:00:00.000Z");
const unknownConfidence = { status: "unknown" as const, value: null, calibrationRef: null };

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

async function createFixture() {
  const projectId = randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const executionId = randomUUID();
  const acceptanceId = randomUUID();
  const worldFactId = randomUUID();
  const worldFactHash = "c".repeat(64);
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "decision-trace-test-owner",
    name: `decision-trace-${projectId.slice(0, 8)}`,
    rootPath: `/tmp/decision-trace-${projectId}`,
    language: "typescript",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "decision-trace-test-owner",
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
    userId: "decision-trace-test-owner",
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
) {
  const fixture = await createFixture();
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
  const selectedTrace = makeSelectedTrace({
    trace: fixture.trace,
    worldStateRevision: initialWorldState.worldRevision,
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
    title: `Persisted ${outcome} outcome`,
    status: achieved ? "completed" : "failed",
    successCriteria: { planRevision: { hash: planRevision } },
    evidenceContract: { required: true },
    outcomeContract: {
      planRevision: { hash: planRevision },
      acceptance: acceptanceProjection,
    },
    nextAction: { kind: achieved ? "complete" : "diagnose" },
    createdAt: now,
    updatedAt: completedAt,
    completedAt,
  });
  await db.insert(tasksTable).values({
    id: taskId,
    projectId: fixture.projectId,
    goalId,
    title: `Persisted ${outcome} Mission task`,
    description: "Synthetic terminal task for Mission outcome recovery.",
    status: achieved ? "completed" : "failed",
    priority: "p1",
    phase: "execute",
    prompt: "Recover the durable Mission outcome without replaying work.",
    createdAt: now,
    updatedAt: completedAt,
    completedAt,
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
    userId: "decision-trace-test-owner",
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
    occurredAt: new Date(now.getTime() + 2_000),
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
    userId: "decision-trace-test-owner",
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

afterEach(async () => {
  missionRunner.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission decision trace persistence", () => {
  it("waits for every required plan-step approval before recording approval and application", async () => {
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

    const stepIds = ["step-one", "step-two"];
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

    missionRunner.mockImplementation(async ({ goalId }: { goalId: string }) => ({
      status: "scheduled",
      goalId,
      executionId: `scheduled:${goalId}`,
    }));
    const firstApproval = await approveMissionGoal({
      missionId: fixture.missionId,
      goalId: goalIds[0]!,
      userId: "decision-trace-test-owner",
    });
    expect(firstApproval.status).toBe("approved");
    expect((await getMissionDecisionTrace(approvalTrace.decisionId))?.events.map(({ stage }) => stage))
      .toEqual(["PROPOSED", "EVALUATED", "SELECTED"]);

    const secondApproval = await approveMissionGoal({
      missionId: fixture.missionId,
      goalId: goalIds[1]!,
      userId: "decision-trace-test-owner",
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
      userId === "decision-trace-test-owner" && trigger === "replan",
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
      userId: "decision-trace-test-owner",
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
      userId: "decision-trace-test-owner",
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
        await db.update(aiMissionDecisionOutcomeSnapshotsTable)
          .set({ outcome: "NOT_ACHIEVED" })
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId));
        await expect(getMissionDecisionTrace(fixture.decisionId))
          .rejects.toMatchObject({ code: "decision_event_reference_invalid" });
        await db.update(aiMissionDecisionOutcomeSnapshotsTable)
          .set({ outcome: snapshot.outcome, evaluation: snapshot.evaluation })
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId));
        await db.update(aiMissionDecisionOutcomeSnapshotsTable)
          .set({ evaluation: { ...snapshot.evaluation, planRevision: "tampered-plan-revision" } })
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId));
        await expect(getMissionDecisionTrace(fixture.decisionId))
          .rejects.toMatchObject({ code: "decision_event_reference_invalid" });
        await db.update(aiMissionDecisionOutcomeSnapshotsTable)
          .set({
            evaluation: snapshot.evaluation,
            worldStateRevision: `tampered:${snapshot.worldStateRevision}`,
          })
          .where(eq(aiMissionDecisionOutcomeSnapshotsTable.outcomeId, finalized.snapshotId));
        await expect(getMissionDecisionTrace(fixture.decisionId))
          .rejects.toMatchObject({ code: "decision_event_reference_invalid" });
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
      userId: "decision-trace-test-owner",
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
