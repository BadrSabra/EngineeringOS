/**
 * Durable Mission/Goal ownership and read-only cross-domain projection.
 *
 * This route owns the durable objective records and delegates activation to
 * the existing task lifecycle. It does not execute tools itself.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  aiGoalDependenciesTable,
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  aiShadowReplaysTable,
  aiSkillRegistryTable,
  db,
  eventsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import {
  GoalNextActionSchema,
  buildMissionPlanPreview,
  type MissionPlanPreview,
  type GoalNextAction,
} from "@workspace/ai-orchestrator";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { parsePagination } from "../../lib/pagination.js";
import {
  receiveMissionEvent,
  runMissionGoal,
  type MissionGoalRunTrigger,
} from "../../lib/mission-runtime.js";
import { executionProfileForMissionStep } from "../../lib/mission-execution-profile.js";
import { createMissionEventEnvelope } from "../../lib/mission-events.js";
import { approveMissionGoal } from "../../lib/mission-approval.js";
import {
  evaluateGoalCompletion,
  evaluateMissionCompletion,
} from "../../lib/mission-completion-gate.js";
import {
  loadCanonicalProof,
  projectCanonicalProof,
} from "../../lib/proof-foundation.js";
import {
  buildSkillCandidateEnvelope,
  parseStoredProposalEvidence,
  serializeProposalEvidence,
  validateSkillCandidateAgainstCanonicalProof,
} from "../../lib/skill-candidate.js";
import {
  buildSkillShadowScore,
  parseShadowReplayRegistryReceipt,
  SkillRegistryIdentitySchema,
  SkillShadowScoreSchema,
} from "../../lib/skill-registry.js";
import {
  getShadowReplayForUser,
  ShadowReplayError,
  startShadowReplay,
  toPublicShadowReplay,
} from "../../lib/shadow-replay.js";

const router = Router();
router.use(requireAuth);

const JsonObjectSchema = z.record(z.string(), z.unknown());
const ACTIVATION_PLAN_KIND = "mission_activation_plan";

function readPlanRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const revision = (value as { planRevision?: unknown }).planRevision;
  if (!revision || typeof revision !== "object" || Array.isArray(revision)) return undefined;
  const hash = (revision as { hash?: unknown }).hash;
  return typeof hash === "string" && hash.trim() ? hash : undefined;
}

function readActivePlanRevision(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const revision = (value as { activePlanRevision?: unknown }).activePlanRevision;
  return typeof revision === "string" && revision.trim() ? revision : undefined;
}

const CreateMissionBody = z.object({
  projectId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  intent: z.string().trim().min(1).max(500),
  status: z.enum(["draft", "active"]).optional(),
  autonomyPolicy: JsonObjectSchema.optional(),
  budget: JsonObjectSchema.optional(),
  deadline: z.string().datetime().nullable().optional(),
}).strict();

const MissionPlanPreviewBody = z.object({
  projectId: z.string().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
  objective: z.string().trim().min(1).max(2_000).optional(),
  projectOrientation: z.boolean().optional(),
}).strict();

const MissionChatHandoffBody = z.object({
  projectId: z.string().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
  title: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().min(1).max(2_000).optional(),
  expectedPlanHash: z.string().trim().min(1).max(200).optional(),
  sessionId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
}).strict();

const MissionReplanBody = z.object({
  message: z.string().trim().min(1).max(10_000).optional(),
  objective: z.string().trim().min(1).max(2_000).optional(),
  expectedPlanHash: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const CreateGoalBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  parentGoalId: z.string().min(1).max(200).nullable().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).default("p2"),
  successCriteria: JsonObjectSchema.optional(),
  evidenceContract: JsonObjectSchema.optional(),
  outcomeContract: JsonObjectSchema.optional(),
  nextAction: GoalNextActionSchema.optional(),
  dependsOnGoalIds: z.array(z.string().min(1).max(200)).max(32).optional(),
  planRevision: z.string().trim().min(1).max(200).optional(),
}).strict();

const UpdateMissionBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  intent: z.string().trim().min(1).max(500).optional(),
  status: z.enum(["draft", "active", "waiting", "blocked", "needs_replan", "completed", "failed", "cancelled"]).optional(),
  autonomyPolicy: JsonObjectSchema.optional(),
  budget: JsonObjectSchema.optional(),
  deadline: z.string().datetime().nullable().optional(),
}).strict();

const UpdateGoalBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5_000).nullable().optional(),
  parentGoalId: z.string().min(1).max(200).nullable().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  status: z.enum(["queued", "planning", "running", "waiting_for_event", "waiting_for_approval", "verifying", "needs_replan", "completed", "blocked", "failed", "cancelled"]).optional(),
  successCriteria: JsonObjectSchema.optional(),
  evidenceContract: JsonObjectSchema.optional(),
  outcomeContract: JsonObjectSchema.optional(),
  nextAction: GoalNextActionSchema.optional(),
  dependsOnGoalIds: z.array(z.string().min(1).max(200)).max(32).optional(),
  planRevision: z.string().trim().min(1).max(200).optional(),
  blockedReason: z.string().trim().max(5_000).nullable().optional(),
  nextWakeAt: z.string().datetime().nullable().optional(),
}).strict();

const MissionGoalEventBody = z.object({
  eventId: z.string().uuid().optional(),
  type: z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/),
  planRevision: z.string().trim().min(1).max(200).nullable().optional(),
  correlationId: z.string().trim().min(1).max(200).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.payload && Buffer.byteLength(JSON.stringify(value.payload), "utf8") > 32_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 32_000,
      type: "string",
      inclusive: true,
      path: ["payload"],
      message: "payload must be at most 32KB",
    });
  }
});

const BindMissionDeliveryBody = z.object({
  proposalId: z.string().uuid(),
}).strict();
const EmptySkillCandidateBody = z.object({}).strict();
const RegisterSkillBody = SkillRegistryIdentitySchema;
const EmptyRegistryActionBody = z.object({}).strict();

function parseCandidateApprovedPaths(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => (
      entry
      && typeof entry === "object"
      && typeof (entry as { path?: unknown }).path === "string"
        ? [(entry as { path: string }).path]
        : []
    ));
  } catch {
    return [];
  }
}

function parseStoredEvidenceText(value: string | null | undefined): unknown {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class GoalDependencyValidationError extends Error {}

async function setGoalDependencies(
  tx: MissionTransaction,
  params: {
    missionId: string;
    projectId: string;
    goalId: string;
    dependsOnGoalIds: string[];
    planRevision?: string;
  },
): Promise<void> {
  const dependencyIds = [...new Set(params.dependsOnGoalIds)];
  if (dependencyIds.length === 0) {
    if (params.planRevision) {
      await tx.delete(aiGoalDependenciesTable).where(and(
        eq(aiGoalDependenciesTable.goalId, params.goalId),
        eq(aiGoalDependenciesTable.planRevision, params.planRevision),
      ));
    }
    return;
  }
  if (!params.planRevision) {
    throw new GoalDependencyValidationError("planRevision is required when dependsOnGoalIds is provided");
  }
  if (dependencyIds.includes(params.goalId)) {
    throw new GoalDependencyValidationError("A goal cannot depend on itself");
  }

  const relatedIds = [params.goalId, ...dependencyIds];
  const relatedGoals = await tx
    .select({ id: aiGoalsTable.id })
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, params.missionId),
      eq(aiGoalsTable.projectId, params.projectId),
      inArray(aiGoalsTable.id, relatedIds),
    ))
    .for("update");
  if (relatedGoals.length !== relatedIds.length) {
    throw new GoalDependencyValidationError("All dependencies must reference goals in the same mission");
  }

  const existingEdges = await tx
    .select({
      goalId: aiGoalDependenciesTable.goalId,
      dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
    })
    .from(aiGoalDependenciesTable)
    .where(and(
      eq(aiGoalDependenciesTable.missionId, params.missionId),
      eq(aiGoalDependenciesTable.projectId, params.projectId),
      eq(aiGoalDependenciesTable.planRevision, params.planRevision),
    ))
    .for("update");
  const edges = [
    ...existingEdges.filter((edge) => edge.goalId !== params.goalId),
    ...dependencyIds.map((dependsOnGoalId) => ({
      goalId: params.goalId,
      dependsOnGoalId,
    })),
  ];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.goalId, [
      ...(adjacency.get(edge.goalId) ?? []),
      edge.dependsOnGoalId,
    ]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (goalId: string): boolean => {
    if (visiting.has(goalId)) return true;
    if (visited.has(goalId)) return false;
    visiting.add(goalId);
    for (const dependencyId of adjacency.get(goalId) ?? []) {
      if (hasCycle(dependencyId)) return true;
    }
    visiting.delete(goalId);
    visited.add(goalId);
    return false;
  };
  if (relatedIds.some(hasCycle)) {
    throw new GoalDependencyValidationError("Goal dependencies cannot contain a cycle");
  }

  await tx.delete(aiGoalDependenciesTable).where(and(
    eq(aiGoalDependenciesTable.goalId, params.goalId),
    eq(aiGoalDependenciesTable.planRevision, params.planRevision),
  ));
  await tx.insert(aiGoalDependenciesTable).values(dependencyIds.map((dependsOnGoalId) => ({
    id: randomUUID(),
    missionId: params.missionId,
    projectId: params.projectId,
    goalId: params.goalId,
    dependsOnGoalId,
    planRevision: params.planRevision!,
  })));
}

async function loadOwnedMission(
  missionId: string,
  userId: string,
  res: Parameters<typeof loadProjectByIdForUser>[2],
) {
  const [mission] = await db
    .select()
    .from(aiMissionsTable)
    .where(and(eq(aiMissionsTable.id, missionId), eq(aiMissionsTable.userId, userId)))
    .limit(1);
  if (!mission) {
    res.status(404).json({ error: "Mission not found" });
    return undefined;
  }
  const project = await loadProjectByIdForUser(mission.projectId, userId, res);
  if (!project) return undefined;
  return { mission, project };
}

function publicTask(task: typeof tasksTable.$inferSelect) {
  return {
    id: task.id,
    projectId: task.projectId,
    goalId: task.goalId,
    workflowId: task.workflowId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    phase: task.phase,
    verificationResult: task.verificationResult,
    correlationId: task.correlationId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

function publicWorkflow(workflow: typeof workflowsTable.$inferSelect) {
  return {
    id: workflow.id,
    projectId: workflow.projectId,
    goalId: workflow.goalId,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    phases: workflow.phases,
    currentPhase: workflow.currentPhase,
    executionCount: workflow.executionCount,
    lastExecutedAt: workflow.lastExecutedAt,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function publicExecution(execution: typeof aiExecutionsTable.$inferSelect) {
  return {
    id: execution.id,
    projectId: execution.projectId,
    goalId: execution.goalId,
    linkedTaskId: execution.linkedTaskId,
    operationId: execution.operationId,
    status: execution.status,
    attempt: execution.attempt,
    correlationId: execution.correlationId,
    proposalId: execution.proposalId,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  };
}

function publicEvent(event: typeof eventsTable.$inferSelect) {
  return {
    id: event.id,
    projectId: event.projectId,
    goalId: event.goalId,
    taskId: event.taskId,
    workflowId: event.workflowId,
    type: event.type,
    severity: event.severity,
    message: event.message,
    correlationId: event.correlationId,
    timestamp: event.timestamp,
  };
}

type MissionPlanGoal = {
  stepId: string;
  goalId: string;
  taskId: string;
  dependencies: string[];
};

function planStepNextAction(
  step: MissionPlanPreview["plan"]["steps"][number],
  taskId: string,
  purpose: "activation" | "execution",
): GoalNextAction {
  if (step.recipe) {
    return {
      kind: "recipe",
      recipeId: step.recipe.recipeId,
      recipeVersion: step.recipe.recipeVersion,
      approvedPaths: step.files,
      candidateIdentity: null,
    };
  }
  return {
    kind: "task",
    taskId,
    purpose,
  };
}

function planStepRequiresDeliveryReceipt(
  step: MissionPlanPreview["plan"]["steps"][number],
): boolean {
  return step.kind === "deliver" && step.recipe?.recipeId.startsWith("delivery.") === true;
}

export type MissionPlanMaterialization = {
  revision: string;
  goals: MissionPlanGoal[];
  primary: MissionPlanGoal;
};

export async function createMissionPlanGoal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  mission: typeof aiMissionsTable.$inferSelect,
  now: Date,
  preview: MissionPlanPreview,
  purpose: "activation" | "execution" = "activation",
  planRevisionOverride?: string,
): Promise<MissionPlanMaterialization | undefined> {
  const planKind = purpose === "activation" ? "mission_plan_step" : "mission_replan_step";
  const legacyActivationKind = ACTIVATION_PLAN_KIND;
  const planSnapshot = {
    version: preview.version,
    hash: planRevisionOverride ?? preview.plan.planHash,
    sourceHash: preview.plan.planHash,
    admission: preview.admission,
    objective: preview.objective,
    ...(preview.replanContext ? { replanContext: preview.replanContext } : {}),
    steps: preview.plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind,
      dependencies: step.dependencies,
      files: step.files,
      readOnly: step.readOnly,
      approvalRequired: step.approvalRequired,
      ...(step.recipe ? { recipe: step.recipe } : {}),
    })),
  };
  {
    const existingGoals = await tx
      .select()
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.missionId, mission.id))
      .for("update");
    const existingPlanGoals = existingGoals.filter((goal) => {
      const successCriteria = goal.successCriteria;
      if (!successCriteria || typeof successCriteria !== "object" || Array.isArray(successCriteria)) {
        return false;
      }
      const kind = (successCriteria as { kind?: unknown }).kind;
      const planRevision = (successCriteria as { planRevision?: { hash?: unknown } }).planRevision;
      return (kind === planKind || kind === legacyActivationKind)
        && planRevision?.hash === planSnapshot.hash;
    });
    if (existingPlanGoals.length > 0) {
      const existingTasks = await tx
        .select({ id: tasksTable.id, goalId: tasksTable.goalId })
        .from(tasksTable)
        .where(and(
          eq(tasksTable.projectId, mission.projectId),
          inArray(tasksTable.goalId, existingPlanGoals.map((goal) => goal.id)),
        ))
        .orderBy(desc(tasksTable.createdAt), desc(tasksTable.id));
      const existingDependencies = await tx
        .select({
          goalId: aiGoalDependenciesTable.goalId,
          dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
        })
        .from(aiGoalDependenciesTable)
        .where(and(
          eq(aiGoalDependenciesTable.missionId, mission.id),
          eq(aiGoalDependenciesTable.projectId, mission.projectId),
          eq(aiGoalDependenciesTable.planRevision, planSnapshot.hash),
          inArray(aiGoalDependenciesTable.goalId, existingPlanGoals.map((goal) => goal.id)),
        ));
      const goals = existingPlanGoals.flatMap((goal) => {
        const task = existingTasks.find((candidate) => candidate.goalId === goal.id);
        const dependencies = existingDependencies
          .filter((dependency) => dependency.goalId === goal.id)
          .map((dependency) => dependency.dependsOnGoalId);
        return task ? [{ stepId: goal.id, goalId: goal.id, taskId: task.id, dependencies }] : [];
      });
      if (goals.length === existingPlanGoals.length) {
        const primary = goals[0];
        if (!primary) return undefined;
        await tx.update(aiMissionsTable)
          .set({
            autonomyPolicy: {
              ...mission.autonomyPolicy,
              activePlanRevision: planSnapshot.hash,
            },
            updatedAt: now,
          })
          .where(eq(aiMissionsTable.id, mission.id));
        return { revision: planSnapshot.hash, goals, primary };
      }
    }
  }

  const materialized = planSnapshot.steps.map((step) => ({
    step,
    goalId: randomUUID(),
    taskId: randomUUID(),
    correlationId: randomUUID(),
  }));
  await tx.insert(aiGoalsTable).values(materialized.map(({ step, goalId, taskId }) => ({
    id: goalId,
    missionId: mission.id,
    projectId: mission.projectId,
    title: step.title,
    description: `${purpose === "activation" ? "Mission plan" : "Replan"} step "${step.id}" for mission "${mission.title}".`,
    status: "queued" as const,
    priority: "p1",
    successCriteria: {
      kind: planKind,
      missionId: mission.id,
      stepId: step.id,
      objective: preview.objective,
      planRevision: planSnapshot,
    },
    evidenceContract: {
      required: true,
      source: "project_context",
      planHash: planSnapshot.hash,
      stepId: step.id,
    },
    outcomeContract: {
      kind: "evidence_backed_progress_report",
      stepId: step.id,
      planRevision: planSnapshot,
      deliveryRequired: planStepRequiresDeliveryReceipt(step),
      executionProfile: executionProfileForMissionStep(
        step.kind,
        Boolean(step.recipe),
      ),
    },
    nextAction: planStepNextAction(step, taskId, purpose),
    createdAt: now,
    updatedAt: now,
  })));
  await tx.insert(tasksTable).values(materialized.map(({ step, goalId, taskId, correlationId }) => ({
    id: taskId,
    projectId: mission.projectId,
    goalId,
    title: step.title,
    description: preview.objective,
    status: "verifying" as const,
    priority: "p1" as const,
    phase: step.kind,
    prompt: [
      `Mission objective: ${preview.objective}`,
      `Server-owned plan revision: ${planSnapshot.hash}`,
      `Current plan step: ${step.id} — ${step.title}`,
      `Step kind: ${step.kind}`,
      `Step dependencies: ${step.dependencies.join(", ") || "none"}`,
      `Read-only: ${step.readOnly ? "yes" : "no"}`,
      `Approval required: ${step.approvalRequired ? "yes" : "no"}`,
      `Relevant paths: ${step.files.join(", ") || "server-selected project context"}`,
      ...(preview.replanContext ? [
        "This is a fresh server-owned replan based on the prior failure evidence.",
        `Prior failed Goal: ${preview.replanContext.failedGoalId ?? "unknown"}`,
        `Failure: ${preview.replanContext.failureClass ?? "unknown"} / ${preview.replanContext.failureCode ?? "unknown"}`,
        ...(preview.replanContext.failureDiagnosis ? [
          `Server-owned diagnosis (advisory, not authorization): ${preview.replanContext.failureDiagnosis.kind} / ${preview.replanContext.failureDiagnosis.reasonCode} → ${preview.replanContext.failureDiagnosis.nextActionCode}; retryable=${preview.replanContext.failureDiagnosis.retryable}; requiresApproval=${preview.replanContext.failureDiagnosis.requiresApproval}`,
        ] : []),
        `Affected paths: ${preview.replanContext.affectedPaths.join(", ") || "none recorded"}`,
        `Affected claims: ${preview.replanContext.affectedClaims.join(", ") || "none recorded"}`,
        `Retained evidence refs: ${preview.replanContext.evidenceRefs.join(", ") || "none recorded"}`,
        `Hypothesis impact: ${preview.replanContext.hypothesisImpact ?? "not recorded"}`,
        `Required recovery actions: ${preview.replanContext.nextActions.join("; ") || "derive a bounded alternative"}`,
        "Do not replay the prior failed action without a changed plan or new evidence.",
      ] : []),
      "Planning is not proof of completion.",
      "Produce an evidence-backed progress report for this step.",
      "Do not claim completion without project-grounded evidence.",
    ].join("\n"),
    correlationId,
    createdAt: now,
    updatedAt: now,
  })));
  await tx.insert(eventsTable).values(materialized.flatMap(({ step, goalId, taskId, correlationId }) => ([
    {
      id: randomUUID(),
      type: "AiGoalCreated",
      projectId: mission.projectId,
      goalId,
      severity: "info" as const,
      message: `${purpose === "activation" ? "Mission plan" : "Replan"} step "${step.id}" created for AI mission "${mission.title}"`,
      correlationId,
      payload: { missionId: mission.id, stepId: step.id, activation: purpose === "activation", purpose },
    },
    {
      id: randomUUID(),
      type: "TaskCreated",
      projectId: mission.projectId,
      goalId,
      taskId,
      severity: "info" as const,
      message: `${purpose === "activation" ? "Mission" : "Replan"} task queued for step "${step.id}"`,
      correlationId,
      payload: { missionId: mission.id, stepId: step.id, activation: purpose === "activation", purpose },
    },
  ])));

  const goalByStepId = new Map(materialized.map(({ step, goalId }) => [step.id, goalId]));
  for (const { step, goalId } of materialized) {
    const dependencyGoalIds: string[] = [];
    for (const dependencyId of step.dependencies) {
      const dependencyGoalId = goalByStepId.get(dependencyId);
      if (!dependencyGoalId) {
        throw new Error(`Mission plan step "${step.id}" references an unknown dependency`);
      }
      dependencyGoalIds.push(dependencyGoalId);
    }
    if (dependencyGoalIds.length > 0) {
      await setGoalDependencies(tx, {
        missionId: mission.id,
        projectId: mission.projectId,
        goalId,
        dependsOnGoalIds: dependencyGoalIds,
        planRevision: planSnapshot.hash,
      });
    }
  }

  const goals = materialized.map(({ step, goalId, taskId }) => ({
    stepId: step.id,
    goalId,
    taskId,
    dependencies: step.dependencies,
  }));
  const primary = goals[0];
  if (primary) {
    await tx.update(aiMissionsTable)
      .set({
        autonomyPolicy: {
          ...mission.autonomyPolicy,
          activePlanRevision: planSnapshot.hash,
        },
        updatedAt: now,
      })
      .where(eq(aiMissionsTable.id, mission.id));
  }
  return primary ? { revision: planSnapshot.hash, goals, primary } : undefined;
}

async function ensureMissionActivationPlan(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  mission: typeof aiMissionsTable.$inferSelect,
  now: Date,
  preview: MissionPlanPreview,
) {
  return createMissionPlanGoal(tx, mission, now, preview, "activation");
}

async function dispatchMissionPlan(
  materialization: MissionPlanMaterialization,
  userId: string,
  trigger: MissionGoalRunTrigger,
) {
  const runs = [];
  // Dependencies are persisted as the runtime gate. Only roots are dispatched
  // here; completed predecessors wake their newly eligible descendants through
  // the existing durable reconciliation loop.
  for (const planGoal of materialization.goals.filter((goal) => goal.dependencies.length === 0)) {
    runs.push(await runMissionGoal({
      goalId: planGoal.goalId,
      userId,
      trigger,
    }));
  }
  return runs;
}

async function buildMissionProjection(
  mission: typeof aiMissionsTable.$inferSelect,
  goals: Array<typeof aiGoalsTable.$inferSelect>,
) {
  const goalIds = goals.map((goal) => goal.id);
  if (goalIds.length === 0) {
    return {
      mission,
      goals: [],
      counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
    };
  }

  const [tasks, workflows, executions, events, dependencies, proposals] = await Promise.all([
    db.select().from(tasksTable).where(and(
      eq(tasksTable.projectId, mission.projectId),
      inArray(tasksTable.goalId, goalIds),
    )).orderBy(desc(tasksTable.updatedAt), desc(tasksTable.id)),
    db.select().from(workflowsTable).where(and(
      eq(workflowsTable.projectId, mission.projectId),
      inArray(workflowsTable.goalId, goalIds),
    )).orderBy(desc(workflowsTable.updatedAt), desc(workflowsTable.id)),
    db.select().from(aiExecutionsTable).where(and(
      eq(aiExecutionsTable.projectId, mission.projectId),
      inArray(aiExecutionsTable.goalId, goalIds),
    )).orderBy(desc(aiExecutionsTable.updatedAt), desc(aiExecutionsTable.id)),
    db.select().from(eventsTable).where(and(
      eq(eventsTable.projectId, mission.projectId),
      inArray(eventsTable.goalId, goalIds),
    )).orderBy(desc(eventsTable.timestamp), desc(eventsTable.id)),
    db.select({
      id: aiGoalDependenciesTable.id,
      goalId: aiGoalDependenciesTable.goalId,
      dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
      planRevision: aiGoalDependenciesTable.planRevision,
    }).from(aiGoalDependenciesTable).where(and(
      eq(aiGoalDependenciesTable.projectId, mission.projectId),
      inArray(aiGoalDependenciesTable.goalId, goalIds),
    )),
    db.select({
      id: aiChangeProposalsTable.id,
      operationId: aiChangeProposalsTable.operationId,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      changeSetHash: aiChangeProposalsTable.changeSetHash,
      validationEvidence: aiChangeProposalsTable.validationEvidence,
    }).from(aiChangeProposalsTable).where(eq(
      aiChangeProposalsTable.projectId,
      mission.projectId,
    )),
  ]);
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const candidateByGoalId = new Map<string, {
    skillCandidate: {
      candidateId: string;
      sourceRevision: string;
      candidateTreeHash: string;
      proof: {
        receiptId: string;
        trajectoryDigest: string;
        verdict: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
        projection: unknown;
      };
      canonicalProof: ReturnType<typeof projectCanonicalProof>;
      shadow: unknown;
    };
  }>();
  for (const goal of goals) {
    const nextAction = goal.nextAction && typeof goal.nextAction === "object" && !Array.isArray(goal.nextAction)
      ? goal.nextAction as Record<string, unknown>
      : {};
    const proposalIds = [
      typeof nextAction.proposalId === "string" ? nextAction.proposalId : null,
      ...executions.filter((execution) => execution.goalId === goal.id).map((execution) => execution.proposalId),
    ].filter((value): value is string => Boolean(value));
    for (const proposalId of proposalIds) {
      const proposal = proposalById.get(proposalId);
      if (!proposal?.validationEvidence) continue;
      let stored: unknown;
      try {
        stored = JSON.parse(proposal.validationEvidence);
      } catch {
        continue;
      }
      const candidate = parseStoredProposalEvidence(stored).skillCandidate;
      if (!candidate) continue;
      const [candidateAcceptance] = await db
        .select({ executionId: aiExecutionAcceptancesTable.executionId })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.id, candidate.proof.receiptId),
          eq(aiExecutionAcceptancesTable.projectId, mission.projectId),
        ))
        .limit(1);
      const canonicalProof = candidateAcceptance
        ? await db.transaction((tx) => loadCanonicalProof({
            tx,
            executionId: candidateAcceptance.executionId,
            scope: {
              projectId: mission.projectId,
              executionId: candidateAcceptance.executionId,
              operationId: proposal.operationId,
              sourceRevision: proposal.baseRevision,
              candidateIdentity: proposal.candidateTreeHash,
            },
            goalStatus: "completed",
          }))
        : null;
      const decision = validateSkillCandidateAgainstCanonicalProof(candidate, canonicalProof, {
        projectId: mission.projectId,
        sourceRevision: proposal.baseRevision ?? undefined,
        candidateTreeHash: proposal.candidateTreeHash ?? undefined,
        changeSetHash: proposal.changeSetHash,
      });
      if (!canonicalProof || !decision.allowed || !decision.envelope) continue;
      candidateByGoalId.set(goal.id, {
        skillCandidate: {
          candidateId: decision.envelope.candidateId,
          sourceRevision: decision.envelope.sourceRevision,
          candidateTreeHash: decision.envelope.candidateTreeHash,
          proof: {
            ...decision.envelope.proof,
            projection: decision.envelope.proof.projection ?? null,
          },
          canonicalProof: projectCanonicalProof(canonicalProof),
          shadow: decision.envelope.shadow,
        },
      });
      break;
    }
  }

  return {
    mission,
    goals: goals.map((goal) => ({
      goal: {
        ...goal,
        dependencies: dependencies.filter((dependency) => dependency.goalId === goal.id),
      },
      tasks: tasks.filter((task) => task.goalId === goal.id).map(publicTask),
      workflows: workflows.filter((workflow) => workflow.goalId === goal.id).map(publicWorkflow),
      executions: executions.filter((execution) => execution.goalId === goal.id).map(publicExecution),
      events: events.filter((event) => event.goalId === goal.id).map(publicEvent),
       ...(candidateByGoalId.get(goal.id) ?? {}),
    })),
    counts: {
      goals: goals.length,
      tasks: tasks.length,
      workflows: workflows.length,
      executions: executions.length,
      events: events.length,
    },
  };
}

router.get("/ai/missions", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;
  const pagination = parsePagination(req, { defaultPageSize: 50, maxPageSize: 200 });
  const missions = await db
    .select()
    .from(aiMissionsTable)
    .where(and(eq(aiMissionsTable.projectId, project.id), eq(aiMissionsTable.userId, req.userId)))
    .orderBy(desc(aiMissionsTable.updatedAt), desc(aiMissionsTable.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);
  return res.json(missions);
});

/**
 * Read-only admission and planning preview.
 *
 * This intentionally does not create a Mission, Goal, Task, proposal, lease,
 * or execution. It is the first boundary between a natural-language request
 * and the durable Mission runtime.
 */
router.post("/ai/missions/plan-preview", async (req, res) => {
  const body = MissionPlanPreviewBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
  return res.json(buildMissionPlanPreview({
    message: body.message,
    objective: body.objective,
    projectOrientation: body.projectOrientation,
  }));
});

/**
 * Explicit consent boundary from Chat into the durable Mission runtime.
 * The caller must submit the same message used for the preview and may bind
 * the handoff to its chat session/message. No provider output can trigger this
 * route implicitly.
 */
router.post("/ai/missions/from-chat", async (req, res) => {
  const body = MissionChatHandoffBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
  if ((body.sessionId && !body.messageId) || (!body.sessionId && body.messageId)) {
    return res.status(400).json({
      error: "sessionId and messageId must be provided together",
      code: "CHAT_HANDOFF_CONTEXT_INCOMPLETE",
    });
  }
  if (body.sessionId && body.messageId) {
    const [source] = await db
      .select({
        sessionProjectId: aiChatSessionsTable.projectId,
        messageSessionId: aiChatMessagesTable.sessionId,
        role: aiChatMessagesTable.role,
      })
      .from(aiChatMessagesTable)
      .innerJoin(
        aiChatSessionsTable,
        eq(aiChatMessagesTable.sessionId, aiChatSessionsTable.id),
      )
      .where(and(
        eq(aiChatMessagesTable.id, body.messageId),
        eq(aiChatSessionsTable.id, body.sessionId),
      ))
      .limit(1);
    if (!source || source.sessionProjectId !== project.id || source.role !== "user") {
      return res.status(409).json({
        error: "The selected chat message is not a user message in this project",
        code: "CHAT_HANDOFF_CONTEXT_INVALID",
      });
    }
  }

  const preview = buildMissionPlanPreview({
    message: body.message,
    objective: body.objective,
  });
  if (preview.admission !== "mission") {
    return res.status(409).json({
      error: "This request is not eligible for Mission execution",
      code: "MISSION_ADMISSION_REQUIRED",
      admission: preview.admission,
      admissionReason: preview.admissionReason,
      preview,
    });
  }
  if (body.expectedPlanHash && body.expectedPlanHash !== preview.plan.planHash) {
    return res.status(409).json({
      error: "The Mission preview is stale. Refresh the preview before handing off.",
      code: "MISSION_PREVIEW_STALE",
      expectedPlanHash: body.expectedPlanHash,
      actualPlanHash: preview.plan.planHash,
    });
  }

  const now = new Date();
  const missionId = randomUUID();
  const title = body.title ?? preview.objective.slice(0, 200);
  const source = body.sessionId && body.messageId
    ? { kind: "chat", sessionId: body.sessionId, messageId: body.messageId }
    : { kind: "chat", sessionId: null, messageId: null };
  const result = await db.transaction(async (tx) => {
    const [mission] = await tx.insert(aiMissionsTable).values({
      id: missionId,
      projectId: project.id,
      userId: req.userId,
      title,
      intent: preview.objective,
      status: "active",
      scope: { kind: "project", projectId: project.id },
      autonomyPolicy: { handoffSource: source },
      budget: {},
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionCreatedFromChat",
      projectId: project.id,
      severity: "info",
      message: `AI mission "${title}" was explicitly handed off from Chat`,
      correlationId: body.messageId ?? missionId,
      payload: {
        missionId,
        source,
        planHash: preview.plan.planHash,
        admission: preview.admission,
      },
    });
    const activationPlan = await ensureMissionActivationPlan(tx, mission, now, preview);
    return { mission, activationPlan, preview };
  });
  if (!result.activationPlan) {
    return res.status(500).json({
      error: "Mission activation plan could not be created",
      code: "MISSION_ACTIVATION_PLAN_MISSING",
    });
  }
  const runs = await dispatchMissionPlan(result.activationPlan, req.userId, "activation");
  return res.status(201).json({
    mission: result.mission,
    activation: result.activationPlan.primary,
    planGoals: result.activationPlan.goals,
    runs,
    preview: result.preview,
  });
});

/**
 * Creates a new server-owned plan revision while retaining the previous Goal,
 * task, execution, and evidence rows. Replan is an explicit operator action;
 * it never rewrites a historical revision in place.
 */
router.post("/ai/missions/:missionId/replan", async (req, res) => {
  const body = MissionReplanBody.parse(req.body);
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  if (["completed", "cancelled"].includes(owned.mission.status)) {
    return res.status(409).json({
      error: "A terminal Mission cannot be replanned",
      code: "MISSION_TERMINAL",
    });
  }
  const message = body.message ?? body.objective ?? owned.mission.intent;
  const preview = buildMissionPlanPreview({ message, objective: body.objective });
  if (preview.admission !== "mission") {
    return res.status(409).json({
      error: "The revised objective is not eligible for Mission execution",
      code: "MISSION_ADMISSION_REQUIRED",
      admission: preview.admission,
      preview,
    });
  }
  if (body.expectedPlanHash && body.expectedPlanHash === preview.plan.planHash) {
    return res.status(409).json({
      error: "The revised plan is identical to the current requested revision",
      code: "MISSION_PLAN_UNCHANGED",
    });
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [mission] = await tx
      .select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, owned.mission.id),
        eq(aiMissionsTable.projectId, owned.project.id),
        eq(aiMissionsTable.userId, req.userId),
      ))
      .for("update");
    if (!mission) return undefined;
     const plan = await createMissionPlanGoal(tx, mission, now, preview, "execution");
     if (!plan) return undefined;
    await tx.update(aiMissionsTable)
      .set({
        status: "active",
        intent: preview.objective,
        updatedAt: now,
      })
      .where(eq(aiMissionsTable.id, mission.id));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionReplanned",
      projectId: mission.projectId,
      severity: "info",
      message: `AI mission "${mission.title}" received a new plan revision`,
      correlationId: plan.primary.goalId,
      payload: {
        missionId: mission.id,
        goalId: plan.primary.goalId,
        planHash: preview.plan.planHash,
        reason: body.reason ?? null,
      },
    });
    return { mission, plan };
  });
  if (!result || !result.plan) return res.status(404).json({ error: "Mission not found" });
  const runs = await dispatchMissionPlan(result.plan, req.userId, "replan");
  return res.status(201).json({
    mission: { ...result.mission, status: "active", intent: preview.objective },
    plan: preview.plan,
    goal: result.plan.primary,
    goals: result.plan.goals,
    runs,
  });
});

/**
 * Approve a server-owned proposal currently blocking one Mission Goal.
 * Applying/delivery remain separate guarded operations; this endpoint only
 * clears the proposal gate and resumes the existing Mission runtime.
 */
router.post("/ai/missions/:missionId/goals/:goalId/approve", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  const result = await approveMissionGoal({
    missionId: owned.mission.id,
    goalId: req.params.goalId,
    userId: req.userId,
  });
  if (result.status !== "approved") {
    return res.status(result.status === "not_found" ? 404 : 409).json({
      error: result.status === "not_found"
        ? "Mission Goal not found"
        : "Mission Goal approval could not be applied",
      code: result.reason,
    });
  }
  return res.json({
    missionId: result.missionId,
    goalId: result.goalId,
    executionId: result.executionId,
    proposalId: result.proposalId,
    revision: result.revision,
    run: result.run,
  });
});

router.post("/ai/missions", async (req, res) => {
  const body = CreateMissionBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
  const now = new Date();
  const missionId = randomUUID();
  const correlationId = randomUUID();
  const result = await db.transaction(async (tx) => {
    const created = await tx.insert(aiMissionsTable).values({
      id: missionId,
      projectId: project.id,
      userId: req.userId,
      title: body.title,
      intent: body.intent,
      status: body.status ?? "draft",
      scope: { kind: "project", projectId: project.id },
      autonomyPolicy: body.autonomyPolicy ?? {},
      budget: body.budget ?? {},
      deadline: body.deadline ? new Date(body.deadline) : null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiMissionCreated",
      projectId: project.id,
      severity: "info",
      message: `AI mission "${body.title}" created`,
      correlationId,
      payload: { missionId },
    });
    let activationPlan: MissionPlanMaterialization | undefined;
    if (created[0]?.status === "active") {
      activationPlan = await ensureMissionActivationPlan(
        tx,
        created[0],
        now,
        buildMissionPlanPreview({ message: created[0].intent, objective: created[0].intent }),
      );
    }
    return { mission: created[0], activationPlan };
  });
  if (result.activationPlan) {
    await dispatchMissionPlan(result.activationPlan, req.userId, "activation");
  }
  return res.status(201).json(result.mission);
});

router.get("/ai/missions/:missionId", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  return res.json(owned.mission);
});

router.patch("/ai/missions/:missionId", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  const body = UpdateMissionBody.parse(req.body);
  if (Object.keys(body).length === 0) return res.status(400).json({ error: "At least one mission field is required" });

  const before = owned.mission;
  const now = new Date();
  if (body.status === "completed") {
    const completion = await db.transaction(async (tx) =>
      evaluateMissionCompletion(tx, {
        missionId: before.id,
        projectId: before.projectId,
      }),
    );
    if (!completion.allowed) {
      return res.status(409).json({
        error: "mission_completion_requires_proof",
        code: "MISSION_COMPLETION_REQUIRES_PROOF",
        reason: completion.reason,
        missingGoalIds: completion.missingGoalIds,
      });
    }
  }
  // Keep activation idempotent so missions that were already marked active
  // before activation plans existed can be repaired by saving "active" again.
  const shouldActivate = body.status === "active";
  const { deadline, ...rest } = body;
  const updateValues: Partial<typeof aiMissionsTable.$inferInsert> = {
    ...rest,
    updatedAt: now,
    ...(Object.prototype.hasOwnProperty.call(body, "deadline")
      ? { deadline: deadline ? new Date(deadline) : null }
      : {}),
  };
  if (body.status === "completed") {
    updateValues.completedAt = before.completedAt ?? now;
  } else if (body.status) {
    updateValues.completedAt = null;
  }

  const correlationId = randomUUID();
  const result = await db.transaction(async (tx) => {
    const rows = await tx.update(aiMissionsTable)
      .set(updateValues)
      .where(eq(aiMissionsTable.id, before.id))
      .returning();
    let activationPlan: MissionPlanMaterialization | undefined;
    if (rows[0]) {
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiMissionUpdated",
        projectId: before.projectId,
        severity: "info",
        message: `AI mission "${rows[0].title}" updated`,
        correlationId,
        payload: { missionId: before.id, changedFields: Object.keys(body) },
      });
      if (shouldActivate) {
        activationPlan = await ensureMissionActivationPlan(
          tx,
          rows[0],
          now,
          buildMissionPlanPreview({ message: rows[0].intent, objective: rows[0].intent }),
        );
      }
    }
    return { updated: rows[0], activationPlan };
  });
  if (!result.updated) return res.status(404).json({ error: "Mission not found" });
  if (result.activationPlan) {
    await dispatchMissionPlan(result.activationPlan, req.userId, "activation");
  }
  return res.json(result.updated);
});

router.get("/ai/missions/:missionId/goals", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  const goals = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.missionId, owned.mission.id))
    .orderBy(desc(aiGoalsTable.createdAt), desc(aiGoalsTable.id));
  const dependencies = goals.length === 0
    ? []
    : await db.select({
        id: aiGoalDependenciesTable.id,
        goalId: aiGoalDependenciesTable.goalId,
        dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
        planRevision: aiGoalDependenciesTable.planRevision,
      }).from(aiGoalDependenciesTable).where(and(
        eq(aiGoalDependenciesTable.projectId, owned.project.id),
        inArray(aiGoalDependenciesTable.goalId, goals.map((goal) => goal.id)),
      ));
  return res.json(goals.map((goal) => ({
    ...goal,
    dependencies: dependencies.filter((dependency) => dependency.goalId === goal.id),
  })));
});

router.get("/ai/goals/:goalId", async (req, res) => {
  const [goal] = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, req.params.goalId))
    .limit(1);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const owned = await loadOwnedMission(goal.missionId, req.userId, res);
  if (!owned) return;
  const dependencies = await db.select({
    id: aiGoalDependenciesTable.id,
    goalId: aiGoalDependenciesTable.goalId,
    dependsOnGoalId: aiGoalDependenciesTable.dependsOnGoalId,
    planRevision: aiGoalDependenciesTable.planRevision,
  }).from(aiGoalDependenciesTable).where(eq(aiGoalDependenciesTable.goalId, goal.id));
  return res.json({ ...goal, dependencies });
});

/**
 * Authenticated Mission event ingress. The event is persisted before the Goal
 * is woken, so delivery before the Goal reaches its wait boundary is replayed
 * by the durable dispatcher instead of being lost.
 */
router.post("/ai/goals/:goalId/events", async (req, res) => {
  const [goal] = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, req.params.goalId))
    .limit(1);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const owned = await loadOwnedMission(goal.missionId, req.userId, res);
  if (!owned) return;

  const body = MissionGoalEventBody.parse(req.body);
  const event = createMissionEventEnvelope({
    eventId: body.eventId ?? randomUUID(),
    type: body.type,
    projectId: goal.projectId,
    goalId: goal.id,
    ...(body.planRevision !== undefined ? { planRevision: body.planRevision } : {}),
    ...(body.correlationId !== undefined ? { correlationId: body.correlationId } : {}),
    ...(body.payload ? { payload: body.payload } : {}),
  });
  const result = await receiveMissionEvent(event);
  return res.status(202).json({
    accepted: result.persisted,
    woken: result.woken,
    duplicate: result.duplicate,
    eventId: result.eventId,
    replayPending: result.persisted && !result.woken,
  });
});

/**
 * Materializes the proof-carrying candidate projection for an already
 * validated proposal. The proof is read from the server-owned acceptance;
 * callers cannot submit or replace it.
 */
router.post("/ai/proposals/:proposalId/skill-candidate", async (req, res) => {
  EmptySkillCandidateBody.parse(req.body);
  const [proposal] = await db
    .select()
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId))
    .limit(1);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  if (!["validated", "committed", "applied"].includes(proposal.lifecycle)) {
    return res.status(409).json({
      error: "A validated proposal is required before a skill candidate can be bound.",
      code: "SKILL_CANDIDATE_PROPOSAL_NOT_VALIDATED",
    });
  }
  if (!proposal.baseRevision || !proposal.candidateTreeHash) {
    return res.status(409).json({
      error: "The proposal is missing its immutable candidate identity.",
      code: "SKILL_CANDIDATE_IDENTITY_MISSING",
    });
  }
  const existingCandidate = parseStoredProposalEvidence(
    parseStoredEvidenceText(proposal.validationEvidence),
  ).skillCandidate;

  const [accepted] = await db
    .select({
      acceptanceId: aiExecutionAcceptancesTable.id,
      executionId: aiExecutionAcceptancesTable.executionId,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(aiExecutionsTable, eq(aiExecutionsTable.id, aiExecutionAcceptancesTable.executionId))
    .where(and(
      eq(aiExecutionAcceptancesTable.projectId, project.id),
      or(
        eq(aiExecutionsTable.proposalId, proposal.id),
        ...(proposal.operationId ? [eq(aiExecutionsTable.operationId, proposal.operationId)] : []),
      ),
    ))
    .orderBy(desc(aiExecutionAcceptancesTable.createdAt), desc(aiExecutionAcceptancesTable.attempt))
    .limit(1);
  const canonicalProof = accepted
    ? await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: accepted.executionId,
        scope: {
          projectId: project.id,
          executionId: accepted.executionId,
          operationId: proposal.operationId,
          sourceRevision: proposal.baseRevision,
          candidateIdentity: proposal.candidateTreeHash,
        },
        // Proposal candidate binding is an execution-level decision. Mission
        // Goal completion, when present, is checked by the Mission gate.
        goalStatus: "completed",
      }))
    : null;
  const proof = canonicalProof?.projection ?? null;
  if (
    !accepted
    || !canonicalProof?.accepted
    || canonicalProof.acceptanceId !== accepted.acceptanceId
    || !proof
  ) {
    return res.status(409).json({
      error: "No matching server-owned proven acceptance exists for this candidate.",
      code: "SKILL_CANDIDATE_PROOF_NOT_AVAILABLE",
    });
  }
  if (existingCandidate) {
    const existingDecision = validateSkillCandidateAgainstCanonicalProof(existingCandidate, canonicalProof, {
      projectId: project.id,
      sourceRevision: proposal.baseRevision,
      candidateTreeHash: proposal.candidateTreeHash,
      changeSetHash: proposal.changeSetHash,
    });
    if (
      existingDecision.allowed
      && existingDecision.envelope
      && existingDecision.envelope.proof.receiptId === canonicalProof.acceptanceId
      && existingDecision.envelope.proof.trajectoryDigest === canonicalProof.trajectoryDigest?.digest
    ) {
      return res.status(200).json({
        candidate: existingDecision.envelope,
        lifecycle: proposal.lifecycle,
        productionExecution: false,
      });
    }
  }

  const candidate = buildSkillCandidateEnvelope({
    proposalId: proposal.id,
    projectId: project.id,
    sourceRevision: proposal.baseRevision,
    candidateTreeHash: proposal.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
    approvedPaths: parseCandidateApprovedPaths(proposal.changes),
      receiptId: accepted.acceptanceId,
    proof,
    runId: `shadow-${randomUUID()}`,
  });
  const candidateDecision = validateSkillCandidateAgainstCanonicalProof(candidate, canonicalProof, {
    projectId: project.id,
    sourceRevision: proposal.baseRevision,
    candidateTreeHash: proposal.candidateTreeHash,
    changeSetHash: proposal.changeSetHash,
  });
  if (!candidateDecision.allowed) {
    return res.status(409).json({
      error: "The server-owned candidate proof binding is incomplete.",
      code: "SKILL_CANDIDATE_CANONICAL_PROOF_REJECTED",
      reasons: candidateDecision.reasons,
    });
  }
  const persisted = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ validationEvidence: aiChangeProposalsTable.validationEvidence })
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, proposal.id),
        eq(aiChangeProposalsTable.projectId, project.id),
      ))
      .for("update");
    if (!locked) return false;
    await tx.update(aiChangeProposalsTable)
      .set({
        validationEvidence: serializeProposalEvidence(
          parseStoredEvidenceText(locked.validationEvidence),
          candidate,
        ),
      })
      .where(eq(aiChangeProposalsTable.id, proposal.id));
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiSkillCandidateBound",
      projectId: project.id,
      severity: "info",
      message: "A proven skill candidate was bound to the proposal.",
      correlationId: proposal.operationId,
      payload: {
        proposalId: proposal.id,
        candidateId: candidate.candidateId,
        candidateTreeHash: candidate.candidateTreeHash,
        sourceRevision: candidate.sourceRevision,
        proofReceiptId: candidate.proof.receiptId,
      },
    });
    return true;
  });
  if (!persisted) {
    return res.status(409).json({
      error: "The proposal changed before the candidate could be bound.",
      code: "SKILL_CANDIDATE_PROPOSAL_CONFLICT",
    });
  }
  return res.status(201).json({
    candidate,
    lifecycle: proposal.lifecycle,
    productionExecution: false,
  });
});

/**
 * Server-owned shadow replay. It creates a durable replay execution, copies the
 * candidate into a disposable workspace, runs the fixed candidate.verify
 * handler, and persists a bounded receipt. It never applies, pushes, opens a
 * browser, or executes candidate-supplied commands.
 */
router.post("/ai/proposals/:proposalId/skill-candidate/shadow-replay", async (req, res) => {
  EmptySkillCandidateBody.parse(req.body);
  const [proposal] = await db
    .select({
      id: aiChangeProposalsTable.id,
      projectId: aiChangeProposalsTable.projectId,
      operationId: aiChangeProposalsTable.operationId,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      changeSetHash: aiChangeProposalsTable.changeSetHash,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
      validationEvidence: aiChangeProposalsTable.validationEvidence,
    })
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId))
    .limit(1);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  if (!proposal.operationId || !proposal.baseRevision || !proposal.candidateTreeHash) {
    return res.status(409).json({
      error: "The proposal is missing the immutable candidate workspace identity required for replay.",
      code: "SKILL_CANDIDATE_REPLAY_IDENTITY_MISSING",
    });
  }
  const storedEvidence = parseStoredEvidenceText(proposal.validationEvidence);
  const { skillCandidate } = parseStoredProposalEvidence(storedEvidence);
  if (!skillCandidate) {
    return res.status(409).json({
      error: "The proposal has no persisted proof-carrying skill candidate.",
      code: "SKILL_CANDIDATE_NOT_BOUND",
    });
  }
  const [candidateAcceptance] = await db
    .select({
      executionId: aiExecutionAcceptancesTable.executionId,
      goalId: aiExecutionsTable.goalId,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(aiExecutionsTable, eq(aiExecutionsTable.id, aiExecutionAcceptancesTable.executionId))
    .where(and(
      eq(aiExecutionAcceptancesTable.id, skillCandidate.proof.receiptId),
      eq(aiExecutionAcceptancesTable.projectId, project.id),
    ))
    .limit(1);
  const [replayScope] = candidateAcceptance?.goalId
    ? await db
      .select({
        goalId: aiGoalsTable.id,
        missionId: aiGoalsTable.missionId,
        goalStatus: aiGoalsTable.status,
        outcomeContract: aiGoalsTable.outcomeContract,
        autonomyPolicy: aiMissionsTable.autonomyPolicy,
      })
      .from(aiGoalsTable)
      .innerJoin(aiMissionsTable, eq(aiMissionsTable.id, aiGoalsTable.missionId))
      .where(and(
        eq(aiGoalsTable.id, candidateAcceptance.goalId),
        eq(aiGoalsTable.projectId, project.id),
        eq(aiMissionsTable.projectId, project.id),
      ))
      .limit(1)
    : [];
  const planRevision = replayScope
    ? readPlanRevision(replayScope.outcomeContract)
    : undefined;
  const activePlanRevision = replayScope
    ? readActivePlanRevision(replayScope.autonomyPolicy)
    : undefined;
  if (
    !candidateAcceptance?.goalId
    || !replayScope
    || replayScope.goalStatus !== "completed"
    || !planRevision
    || !activePlanRevision
    || planRevision !== activePlanRevision
  ) {
    return res.status(409).json({
      error: "The persisted skill candidate is not bound to a completed Mission Goal plan.",
      code: "SKILL_CANDIDATE_REPLAY_SCOPE_REQUIRED",
    });
  }
  const canonicalProof = candidateAcceptance
    ? await db.transaction((tx) => loadCanonicalProof({
        tx,
        executionId: candidateAcceptance.executionId,
        scope: {
          projectId: project.id,
          missionId: replayScope.missionId,
          goalId: replayScope.goalId,
          executionId: candidateAcceptance.executionId,
          operationId: proposal.operationId,
          planRevision,
          activePlanRevision,
          sourceRevision: proposal.baseRevision,
          candidateIdentity: proposal.candidateTreeHash,
        },
        goalStatus: replayScope.goalStatus,
      }))
    : null;
  if (!canonicalProof?.accepted || !canonicalProof.acceptanceId) {
    return res.status(409).json({
      error: "The persisted skill candidate has no current canonical proof.",
      code: "SKILL_CANDIDATE_CANONICAL_PROOF_REQUIRED",
    });
  }
  const decision = validateSkillCandidateAgainstCanonicalProof(skillCandidate, canonicalProof, {
    projectId: project.id,
    sourceRevision: proposal.baseRevision ?? undefined,
    candidateTreeHash: proposal.candidateTreeHash ?? undefined,
    changeSetHash: proposal.changeSetHash,
  });
  if (!decision.allowed) {
    return res.status(409).json({
      error: "The persisted skill candidate failed shadow validation.",
      code: "SKILL_CANDIDATE_SHADOW_REJECTED",
      reasons: decision.reasons,
    });
  }
  try {
    const started = await startShadowReplay({
      userId: req.userId,
      projectId: project.id,
      proposalId: proposal.id,
      operationId: proposal.operationId ?? "",
      sourceRevision: proposal.baseRevision!,
      candidateTreeHash: proposal.candidateTreeHash!,
      changeSetHash: proposal.changeSetHash,
      sourceWorkspaceRoot: proposal.workspaceRoot,
      candidate: skillCandidate,
      canonicalProof,
      missionId: replayScope.missionId,
      goalId: replayScope.goalId,
      planRevision,
      activePlanRevision,
    });
    const status = started.replay.status === "completed"
      ? 200
      : started.replay.status === "queued" || started.replay.status === "running"
        ? 202
        : 409;
    return res.status(status).json({
      replay: started.replay,
      ...(started.replay.receipt ? { receipt: started.replay.receipt } : {}),
      productionExecution: false,
    });
  } catch (error) {
    if (error instanceof ShadowReplayError) {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        productionExecution: false,
      });
    }
    throw error;
  }
});

router.get("/ai/proposals/:proposalId/skill-candidate/shadow-replay/:replayId", async (req, res) => {
  const [proposal] = await db
    .select({ id: aiChangeProposalsTable.id, projectId: aiChangeProposalsTable.projectId })
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId))
    .limit(1);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  const replay = await getShadowReplayForUser(req.params.replayId, req.userId);
  if (!replay || replay.proposalId !== proposal.id || replay.projectId !== project.id) {
    return res.status(404).json({ error: "Shadow replay not found" });
  }
  return res.json({
    replay: toPublicShadowReplay(replay),
    ...(replay.receipt ? { receipt: replay.receipt } : {}),
    productionExecution: false,
  });
});

function publicSkillRegistryRow(row: typeof aiSkillRegistryTable.$inferSelect) {
  const shadowScore = SkillShadowScoreSchema.safeParse(row.shadowScore);
  return {
    id: row.id,
    projectId: row.projectId,
    skillId: row.skillId,
    skillVersion: row.skillVersion,
    candidateId: row.candidateId,
    proposalId: row.proposalId,
    shadowReplayId: row.shadowReplayId,
    proofReceiptId: row.proofReceiptId,
    sourceRevision: row.sourceRevision,
    candidateTreeHash: row.candidateTreeHash,
    shadowScore: shadowScore.success ? shadowScore.data : null,
    promotionStatus: row.promotionStatus,
    revocationStatus: row.revocationStatus,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    revokedBy: row.revokedBy,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Register a skill only after the server has a completed shadow replay and a
 * passing Gate 3 paired baseline. The client supplies only the human-facing
 * skill name/version; every proof and score field comes from durable rows.
 */
router.post("/ai/proposals/:proposalId/skill-registry", async (req, res) => {
  const body = RegisterSkillBody.parse(req.body);
  const [proposal] = await db
    .select({
      id: aiChangeProposalsTable.id,
      projectId: aiChangeProposalsTable.projectId,
      operationId: aiChangeProposalsTable.operationId,
      baseRevision: aiChangeProposalsTable.baseRevision,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      validationEvidence: aiChangeProposalsTable.validationEvidence,
      baseTreeHash: aiChangeProposalsTable.baseTreeHash,
    })
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId))
    .limit(1);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;

  const skillCandidate = parseStoredProposalEvidence(
    parseStoredEvidenceText(proposal.validationEvidence),
  ).skillCandidate;
  if (!skillCandidate) {
    return res.status(409).json({
      error: "A proof-carrying skill candidate must be bound before registry registration.",
      code: "SKILL_REGISTRY_CANDIDATE_REQUIRED",
    });
  }
  if (
    !proposal.baseRevision
    || !proposal.candidateTreeHash
    || skillCandidate.projectId !== project.id
    || skillCandidate.sourceRevision !== proposal.baseRevision
    || skillCandidate.candidateTreeHash !== proposal.candidateTreeHash
  ) {
    return res.status(409).json({
      error: "The candidate identity is not bound to the current proposal revision.",
      code: "SKILL_REGISTRY_CANDIDATE_IDENTITY_MISMATCH",
    });
  }

  const [replay] = await db
    .select()
    .from(aiShadowReplaysTable)
    .where(and(
      eq(aiShadowReplaysTable.projectId, project.id),
      eq(aiShadowReplaysTable.proposalId, proposal.id),
      eq(aiShadowReplaysTable.candidateId, skillCandidate.candidateId),
      eq(aiShadowReplaysTable.status, "completed"),
    ))
    .orderBy(desc(aiShadowReplaysTable.completedAt), desc(aiShadowReplaysTable.createdAt))
    .limit(1);
  const receipt = replay ? parseShadowReplayRegistryReceipt(replay.receipt) : null;
  if (!replay || !receipt) {
    return res.status(409).json({
      error: "A completed, isolated shadow replay receipt is required.",
      code: "SKILL_REGISTRY_SHADOW_REPLAY_REQUIRED",
    });
  }
  if (
    receipt.replayId !== replay.id
    || receipt.replayExecutionId !== replay.executionId
    || receipt.candidateId !== skillCandidate.candidateId
    || receipt.projectId !== project.id
    || receipt.sourceRevision !== proposal.baseRevision
    || receipt.candidateTreeHash !== proposal.candidateTreeHash
    || replay.replayCanonicalAcceptanceId !== receipt.proof.receiptId
    || skillCandidate.proof.receiptId !== replay.canonicalAcceptanceId
    || receipt.postTreeHash !== proposal.candidateTreeHash
  ) {
    return res.status(409).json({
      error: "The shadow replay receipt is not bound to the candidate and proof identities.",
      code: "SKILL_REGISTRY_SHADOW_REPLAY_IDENTITY_MISMATCH",
    });
  }

  const shadowScore = buildSkillShadowScore({
    comparison: receipt.pairedBaseline,
    replayId: replay.id,
    candidateId: skillCandidate.candidateId,
    candidateTreeHash: receipt.postTreeHash,
    baselineTreeHash: proposal.baseTreeHash,
  });
  if (!shadowScore) {
    return res.status(409).json({
      error: "A passing Gate 3 paired baseline is required before registry registration.",
      code: "SKILL_REGISTRY_PAIRED_BASELINE_REQUIRED",
    });
  }

  const existing = await db
    .select()
    .from(aiSkillRegistryTable)
    .where(and(
      eq(aiSkillRegistryTable.projectId, project.id),
      eq(aiSkillRegistryTable.skillId, body.skillId),
      eq(aiSkillRegistryTable.skillVersion, body.skillVersion),
    ))
    .limit(1);
  if (existing[0]) {
    const row = existing[0];
    if (row.candidateId !== skillCandidate.candidateId || row.shadowReplayId !== replay.id) {
      return res.status(409).json({
        error: "This skill version is already bound to a different candidate.",
        code: "SKILL_REGISTRY_VERSION_CONFLICT",
      });
    }
    return res.status(200).json({ registry: publicSkillRegistryRow(row) });
  }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(aiSkillRegistryTable)
      .values({
        id: randomUUID(),
        projectId: project.id,
        skillId: body.skillId,
        skillVersion: body.skillVersion,
        candidateId: skillCandidate.candidateId,
        proposalId: proposal.id,
        shadowReplayId: replay.id,
        proofReceiptId: receipt.proof.receiptId,
        sourceRevision: proposal.baseRevision!,
        candidateTreeHash: proposal.candidateTreeHash!,
        shadowScore,
        promotionStatus: "pending",
        revocationStatus: "active",
      })
      .returning();
    if (!row) return [];
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiSkillRegistryRegistered",
      projectId: project.id,
      severity: "info",
      message: "A proof-carrying skill candidate was registered pending approval.",
      correlationId: proposal.operationId,
      payload: {
        registryId: row.id,
        skillId: row.skillId,
        skillVersion: row.skillVersion,
        candidateId: row.candidateId,
        proofReceiptId: row.proofReceiptId,
        shadowReplayId: row.shadowReplayId,
      },
    });
    return [row];
  });
  if (!created) {
    return res.status(409).json({
      error: "The skill registry changed before registration completed.",
      code: "SKILL_REGISTRY_CONFLICT",
    });
  }
  return res.status(201).json({ registry: publicSkillRegistryRow(created) });
});

router.get("/ai/skill-registry", async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;
  const rows = await db
    .select()
    .from(aiSkillRegistryTable)
    .where(eq(aiSkillRegistryTable.projectId, project.id))
    .orderBy(desc(aiSkillRegistryTable.updatedAt), desc(aiSkillRegistryTable.createdAt));
  return res.json({ registry: rows.map(publicSkillRegistryRow) });
});

router.post("/ai/skill-registry/:registryId/approve", async (req, res) => {
  EmptyRegistryActionBody.parse(req.body);
  const [current] = await db
    .select()
    .from(aiSkillRegistryTable)
    .where(eq(aiSkillRegistryTable.id, req.params.registryId))
    .limit(1);
  if (!current) return res.status(404).json({ error: "Skill registry entry not found" });
  const project = await loadProjectByIdForUser(current.projectId, req.userId, res);
  if (!project) return;
  const now = new Date();
  const promoted = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(aiSkillRegistryTable)
      .where(and(
        eq(aiSkillRegistryTable.id, current.id),
        eq(aiSkillRegistryTable.projectId, project.id),
      ))
      .for("update");
    if (!locked || locked.revocationStatus === "revoked") return null;
    if (locked.promotionStatus === "promoted") return locked;
    if (locked.promotionStatus !== "pending") return null;

    await tx.update(aiSkillRegistryTable)
      .set({
        promotionStatus: "superseded",
        updatedAt: now,
      })
      .where(and(
        eq(aiSkillRegistryTable.projectId, project.id),
        eq(aiSkillRegistryTable.skillId, locked.skillId),
        eq(aiSkillRegistryTable.promotionStatus, "promoted"),
        eq(aiSkillRegistryTable.revocationStatus, "active"),
      ));
    const [row] = await tx.update(aiSkillRegistryTable)
      .set({
        promotionStatus: "promoted",
        approvedBy: req.userId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(aiSkillRegistryTable.id, locked.id))
      .returning();
    if (!row) return null;
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiSkillRegistryApproved",
      projectId: project.id,
      severity: "info",
      message: "A skill registry entry was explicitly approved.",
      payload: {
        registryId: row.id,
        skillId: row.skillId,
        skillVersion: row.skillVersion,
        candidateId: row.candidateId,
      },
    });
    return row;
  });
  if (!promoted) {
    return res.status(409).json({
      error: "Only an active pending skill registry entry can be approved.",
      code: "SKILL_REGISTRY_APPROVAL_REJECTED",
    });
  }
  return res.json({ registry: publicSkillRegistryRow(promoted) });
});

router.post("/ai/skill-registry/:registryId/revoke", async (req, res) => {
  EmptyRegistryActionBody.parse(req.body);
  const [current] = await db
    .select()
    .from(aiSkillRegistryTable)
    .where(eq(aiSkillRegistryTable.id, req.params.registryId))
    .limit(1);
  if (!current) return res.status(404).json({ error: "Skill registry entry not found" });
  const project = await loadProjectByIdForUser(current.projectId, req.userId, res);
  if (!project) return;
  const now = new Date();
  const [revoked] = await db.update(aiSkillRegistryTable)
    .set({
      revocationStatus: "revoked",
      revokedBy: req.userId,
      revokedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(aiSkillRegistryTable.id, current.id),
      eq(aiSkillRegistryTable.projectId, project.id),
      eq(aiSkillRegistryTable.revocationStatus, "active"),
    ))
    .returning();
  if (!revoked) {
    const [alreadyRevoked] = await db
      .select()
      .from(aiSkillRegistryTable)
      .where(eq(aiSkillRegistryTable.id, current.id))
      .limit(1);
    return res.status(200).json({
      registry: alreadyRevoked ? publicSkillRegistryRow(alreadyRevoked) : null,
      alreadyRevoked: true,
    });
  }
  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiSkillRegistryRevoked",
    projectId: project.id,
    severity: "warning",
    message: "A skill registry entry was immediately revoked.",
    payload: {
      registryId: revoked.id,
      skillId: revoked.skillId,
      skillVersion: revoked.skillVersion,
      candidateId: revoked.candidateId,
    },
  });
  return res.json({ registry: publicSkillRegistryRow(revoked) });
});

/**
 * Binds a committed, project-owned proposal to a delivery Goal. Delivery
 * remains server-owned: callers cannot provide an operation identity, remote,
 * branch, workspace, or command controls.
 */
router.post("/ai/goals/:goalId/delivery", async (req, res) => {
  const [goal] = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, req.params.goalId))
    .limit(1);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const owned = await loadOwnedMission(goal.missionId, req.userId, res);
  if (!owned) return;
  const body = BindMissionDeliveryBody.parse(req.body);
  if (owned.project.status === "archived") {
    return res.status(403).json({
      error: "This project is archived and cannot perform external delivery.",
      code: "PROJECT_ARCHIVED",
    });
  }
  if (!owned.project.gitRemoteUrl) {
    return res.status(409).json({
      error: "GitHub delivery requires a configured project remote.",
      code: "DELIVERY_REMOTE_REQUIRED",
    });
  }

  const parsedAction = GoalNextActionSchema.safeParse(goal.nextAction);
  if (!parsedAction.success || parsedAction.data.kind !== "recipe" || parsedAction.data.recipeId !== "delivery.push.github") {
    return res.status(409).json({
      error: "The Goal is not a GitHub delivery recipe.",
      code: "DELIVERY_GOAL_REQUIRED",
    });
  }
  if (["completed", "cancelled"].includes(goal.status)) {
    return res.status(409).json({
      error: "A terminal Goal cannot receive a delivery proposal.",
      code: "DELIVERY_GOAL_TERMINAL",
    });
  }

  const [proposal] = await db
    .select({
      id: aiChangeProposalsTable.id,
      operationId: aiChangeProposalsTable.operationId,
      lifecycle: aiChangeProposalsTable.lifecycle,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, body.proposalId),
      eq(aiChangeProposalsTable.projectId, owned.project.id),
    ))
    .limit(1);
  if (!proposal || proposal.lifecycle !== "committed" || !proposal.operationId) {
    return res.status(409).json({
      error: "Delivery requires a committed proposal owned by this project.",
      code: "DELIVERY_PROPOSAL_NOT_COMMITTED",
    });
  }

  const now = new Date();
  const boundAction = {
    ...parsedAction.data,
    proposalId: proposal.id,
  };
  const [updated] = await db.transaction(async (tx) => {
    const [lockedGoal] = await tx
      .select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, goal.id),
        eq(aiGoalsTable.missionId, owned.mission.id),
        eq(aiGoalsTable.projectId, owned.project.id),
      ))
      .for("update");
    if (!lockedGoal || ["completed", "cancelled"].includes(lockedGoal.status)) return [];
    const rows = await tx.update(aiGoalsTable)
      .set({
        nextAction: boundAction,
        status: "queued",
        blockedReason: null,
        nextWakeAt: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(aiGoalsTable.id, lockedGoal.id))
      .returning();
    if (rows[0]) {
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalDeliveryProposalBound",
        projectId: owned.project.id,
        goalId: lockedGoal.id,
        severity: "info",
        message: `Committed delivery proposal bound to AI goal "${lockedGoal.title}"`,
        correlationId: proposal.operationId,
        payload: {
          missionId: owned.mission.id,
          proposalId: proposal.id,
          operationId: proposal.operationId,
        },
      });
    }
    return rows;
  });
  if (!updated) {
    return res.status(409).json({
      error: "The Goal changed or became terminal before delivery binding.",
      code: "DELIVERY_GOAL_CONFLICT",
    });
  }
  const run = await runMissionGoal({
    goalId: updated.id,
    userId: req.userId,
    trigger: "resume",
  });
  return res.status(202).json({
    goal: updated,
    proposalId: proposal.id,
    operationId: proposal.operationId,
    run,
  });
});

router.patch("/ai/goals/:goalId", async (req, res) => {
  const [goal] = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, req.params.goalId))
    .limit(1);
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  const owned = await loadOwnedMission(goal.missionId, req.userId, res);
  if (!owned) return;
  const body = UpdateGoalBody.parse(req.body);
  if (Object.keys(body).length === 0) return res.status(400).json({ error: "At least one goal field is required" });

  if (Object.prototype.hasOwnProperty.call(body, "parentGoalId") && body.parentGoalId) {
    if (body.parentGoalId === goal.id) {
      return res.status(400).json({ error: "A goal cannot be its own parent" });
    }
    const [parent] = await db
      .select({ id: aiGoalsTable.id })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, body.parentGoalId),
        eq(aiGoalsTable.missionId, owned.mission.id),
        eq(aiGoalsTable.projectId, owned.project.id),
      ))
      .limit(1);
    if (!parent) return res.status(400).json({ error: "parentGoalId must reference a goal in this mission" });
  }

  const now = new Date();
  const {
    nextWakeAt,
    dependsOnGoalIds,
    planRevision,
    outcomeContract,
    ...rest
  } = body;
  const nextOutcomeContract =
    outcomeContract !== undefined
      ? outcomeContract
      : goal.outcomeContract;
  const updateValues: Partial<typeof aiGoalsTable.$inferInsert> = {
    ...rest,
    ...(outcomeContract !== undefined || planRevision
      ? {
          outcomeContract: {
            ...(nextOutcomeContract ?? {}),
            ...(planRevision ? { planRevision: { hash: planRevision } } : {}),
          },
        }
      : {}),
    updatedAt: now,
    ...(Object.prototype.hasOwnProperty.call(body, "nextWakeAt")
      ? { nextWakeAt: nextWakeAt ? new Date(nextWakeAt) : null }
      : {}),
  };
  if (body.status === "completed") {
    const proven = await db.transaction(async (tx) =>
      evaluateGoalCompletion(tx, {
        goalId: goal.id,
        missionId: goal.missionId,
        projectId: goal.projectId,
      }),
    );
    if (!proven) {
      return res.status(409).json({
        error: "goal_completion_requires_proof",
        code: "GOAL_COMPLETION_REQUIRES_PROOF",
      });
    }
    updateValues.completedAt = goal.completedAt ?? now;
  } else if (body.status) {
    updateValues.completedAt = null;
  }

  const correlationId = randomUUID();
  try {
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx.update(aiGoalsTable)
      .set(updateValues)
      .where(eq(aiGoalsTable.id, goal.id))
      .returning();
      if (rows[0] && Object.prototype.hasOwnProperty.call(body, "dependsOnGoalIds")) {
        await setGoalDependencies(tx, {
          missionId: goal.missionId,
          projectId: goal.projectId,
          goalId: goal.id,
          dependsOnGoalIds: dependsOnGoalIds ?? [],
          planRevision,
        });
      }
      if (rows[0]) {
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiGoalUpdated",
          projectId: goal.projectId,
          goalId: goal.id,
          severity: "info",
          message: `AI goal "${rows[0].title}" updated`,
          correlationId,
          payload: {
            missionId: goal.missionId,
            changedFields: Object.keys(body),
            dependencyRevision: planRevision ?? null,
          },
        });
      }
      return rows;
    });
    if (!updated) return res.status(404).json({ error: "Goal not found" });
    return res.json(updated);
  } catch (error) {
    if (error instanceof GoalDependencyValidationError) {
      return res.status(400).json({ error: error.message, code: "INVALID_GOAL_DEPENDENCIES" });
    }
    throw error;
  }
});

router.post("/ai/missions/:missionId/goals", async (req, res) => {
  const body = CreateGoalBody.parse(req.body);
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  if (body.parentGoalId) {
    const [parent] = await db
      .select({ id: aiGoalsTable.id })
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, body.parentGoalId),
        eq(aiGoalsTable.missionId, owned.mission.id),
        eq(aiGoalsTable.projectId, owned.project.id),
      ))
      .limit(1);
    if (!parent) return res.status(400).json({ error: "parentGoalId must reference a goal in this mission" });
  }
  const now = new Date();
  const goalId = randomUUID();
  const nextOutcomeContract = {
    ...(body.outcomeContract ?? {}),
    ...(body.planRevision ? { planRevision: { hash: body.planRevision } } : {}),
  };
  try {
    const [goal] = await db.transaction(async (tx) => {
      const created = await tx.insert(aiGoalsTable).values({
      id: goalId,
      missionId: owned.mission.id,
      projectId: owned.project.id,
      parentGoalId: body.parentGoalId ?? null,
      title: body.title,
      description: body.description ?? null,
      priority: body.priority,
      successCriteria: body.successCriteria ?? {},
      evidenceContract: body.evidenceContract ?? {},
      outcomeContract: nextOutcomeContract,
      nextAction: body.nextAction ?? {},
      createdAt: now,
      updatedAt: now,
      }).returning();
      await setGoalDependencies(tx, {
        missionId: owned.mission.id,
        projectId: owned.project.id,
        goalId,
        dependsOnGoalIds: body.dependsOnGoalIds ?? [],
        planRevision: body.planRevision,
      });
      await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalCreated",
      projectId: owned.project.id,
      goalId,
      severity: "info",
      message: `AI goal "${body.title}" created`,
        payload: {
          missionId: owned.mission.id,
          dependencyRevision: body.planRevision ?? null,
        },
      });
      return created;
    });
    return res.status(201).json(goal);
  } catch (error) {
    if (error instanceof GoalDependencyValidationError) {
      return res.status(400).json({ error: error.message, code: "INVALID_GOAL_DEPENDENCIES" });
    }
    throw error;
  }
});

router.get("/ai/missions/:missionId/projection", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  const goals = await db
    .select()
    .from(aiGoalsTable)
    .where(and(
      eq(aiGoalsTable.missionId, owned.mission.id),
      eq(aiGoalsTable.projectId, owned.project.id),
    ))
    .orderBy(desc(aiGoalsTable.updatedAt), desc(aiGoalsTable.id));
  return res.json(await buildMissionProjection(owned.mission, goals));
});

export default router;