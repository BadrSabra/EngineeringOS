import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiGoalDependenciesTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionDecisionDispatchBatchesTable,
  aiMissionDecisionDispatchItemsTable,
  aiMissionDecisionOutcomeSnapshotsTable,
  aiMissionsTable,
  aiWorldFactsTable,
  db,
  projectsTable,
  tasksTable,
} from "@workspace/db";
import {
  evaluateMissionStrategies,
  hashMissionDecisionTrace,
  hashMissionDecisionContext,
  hashMissionStrategyAlternative,
  MISSION_DECISION_SCHEMA_VERSION,
  MissionDecisionContextSchema,
  MissionStrategyAlternativeSchema,
  MissionDecisionTraceSchema,
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
import { getProjectWorldState } from "./agent-state/world-state.js";
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
} from "./mission-strategy-plan-outcome-store.js";

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
