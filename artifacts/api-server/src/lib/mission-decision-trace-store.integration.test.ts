import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  evaluateMissionStrategies,
  hashMissionDecisionTrace,
  hashMissionDecisionContext,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  MissionDecisionTraceSchema,
} from "@workspace/ai-orchestrator";
import type {
  MissionDecisionContext,
  MissionDecisionTrace,
  StrategyDifference,
  MissionStrategyAlternative,
} from "@workspace/ai-orchestrator";
import { getProjectWorldState } from "./agent-state/world-state.js";
import {
  appendMissionDecisionLifecycleEvent,
  getMissionDecisionTrace,
  MissionDecisionTraceStoreError,
  persistMissionDecisionTrace,
} from "./mission-decision-trace-store.js";

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
    expectedEffectCodes: [],
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
    makeStrategy("safe-read-one", "tool.read.one", "low"),
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
    newPlanRevision: null,
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

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission decision trace persistence", () => {
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
    await expect(appendMissionDecisionLifecycleEvent({
      decisionId: selectedTrace.decisionId,
      stage: "PLAN_APPLIED",
      referenceId: "applied-plan-revision",
      occurredAt: new Date(now.getTime() + 2_000),
    })).resolves.toMatchObject({ kind: "appended", sequence: 4 });

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
      occurredAt: new Date(now.getTime() + 3_000),
    })).resolves.toMatchObject({ kind: "appended", sequence: 5 });

    await db.update(aiGoalsTable).set({
      outcomeContract: { planRevision: { hash: "applied-plan-revision" } },
      successCriteria: { planRevision: { hash: "applied-plan-revision" } },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    const stored = await getMissionDecisionTrace(selectedTrace.decisionId);
    expect(stored?.events.slice(-2).map(({ stage, referenceId }) => ({ stage, referenceId }))).toEqual([
      { stage: "PLAN_APPLIED", referenceId: "applied-plan-revision" },
      { stage: "DISPATCHED", referenceId: successorExecutionId },
    ]);
    expect(stored?.trace.dispatchRef).toBeNull();
  });
});
