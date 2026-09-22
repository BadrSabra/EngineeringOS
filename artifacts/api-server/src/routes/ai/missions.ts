/**
 * Durable Mission/Goal ownership and read-only cross-domain projection.
 *
 * This route owns the durable objective records and delegates activation to
 * the existing task lifecycle. It does not execute tools itself.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiGoalDependenciesTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import {
  GoalNextActionSchema,
  buildMissionPlanPreview,
  type MissionPlanPreview,
} from "@workspace/ai-orchestrator";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { parsePagination } from "../../lib/pagination.js";
import { runMissionGoal, type MissionGoalRunTrigger } from "../../lib/mission-runtime.js";

const router = Router();
router.use(requireAuth);

const JsonObjectSchema = z.record(z.string(), z.unknown());
const ACTIVATION_PLAN_KIND = "mission_activation_plan";

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

type MissionPlanMaterialization = {
  revision: string;
  goals: MissionPlanGoal[];
  primary: MissionPlanGoal;
};

async function createMissionPlanGoal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  mission: typeof aiMissionsTable.$inferSelect,
  now: Date,
  preview: MissionPlanPreview,
  purpose: "activation" | "execution" = "activation",
): Promise<MissionPlanMaterialization | undefined> {
  const planKind = purpose === "activation" ? "mission_plan_step" : "mission_replan_step";
  const legacyActivationKind = ACTIVATION_PLAN_KIND;
  const planSnapshot = {
    version: preview.version,
    hash: preview.plan.planHash,
    admission: preview.admission,
    objective: preview.objective,
    steps: preview.plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind,
      dependencies: step.dependencies,
      files: step.files,
      readOnly: step.readOnly,
      approvalRequired: step.approvalRequired,
    })),
  };
  if (purpose === "activation") {
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
      const goals = existingPlanGoals.flatMap((goal) => {
        const task = existingTasks.find((candidate) => candidate.goalId === goal.id);
        return task ? [{ stepId: goal.id, goalId: goal.id, taskId: task.id, dependencies: [] as string[] }] : [];
      });
      if (goals.length === existingPlanGoals.length) {
        const primary = goals[0];
        return primary ? { revision: planSnapshot.hash, goals, primary } : undefined;
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
    },
    nextAction: {
      kind: "task" as const,
      taskId,
      purpose,
    },
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

  const [tasks, workflows, executions, events, dependencies] = await Promise.all([
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
  ]);

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