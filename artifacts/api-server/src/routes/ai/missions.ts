/**
 * Durable Mission/Goal ownership and read-only cross-domain projection.
 *
 * This route deliberately does not schedule work or execute tools. It owns
 * only the durable objective records and reads the existing task, workflow,
 * execution, and event systems through their nullable goal links.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  tasksTable,
  workflowsTable,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { parsePagination } from "../../lib/pagination.js";

const router = Router();
router.use(requireAuth);

const JsonObjectSchema = z.record(z.string(), z.unknown());

const CreateMissionBody = z.object({
  projectId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  intent: z.string().trim().min(1).max(500),
  autonomyPolicy: JsonObjectSchema.optional(),
  budget: JsonObjectSchema.optional(),
  deadline: z.string().datetime().nullable().optional(),
}).strict();

const CreateGoalBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5_000).nullable().optional(),
  parentGoalId: z.string().min(1).max(200).nullable().optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).default("p2"),
  successCriteria: JsonObjectSchema.optional(),
  evidenceContract: JsonObjectSchema.optional(),
  outcomeContract: JsonObjectSchema.optional(),
  nextAction: JsonObjectSchema.optional(),
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
  nextAction: JsonObjectSchema.optional(),
  blockedReason: z.string().trim().max(5_000).nullable().optional(),
  nextWakeAt: z.string().datetime().nullable().optional(),
}).strict();

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

  const [tasks, workflows, executions, events] = await Promise.all([
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
  ]);

  return {
    mission,
    goals: goals.map((goal) => ({
      goal,
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

router.post("/ai/missions", async (req, res) => {
  const body = CreateMissionBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
  const now = new Date();
  const missionId = randomUUID();
  const correlationId = randomUUID();
  const [mission] = await db.transaction(async (tx) => {
    const created = await tx.insert(aiMissionsTable).values({
      id: missionId,
      projectId: project.id,
      userId: req.userId,
      title: body.title,
      intent: body.intent,
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
    return created;
  });
  return res.status(201).json(mission);
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
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(aiMissionsTable)
      .set(updateValues)
      .where(eq(aiMissionsTable.id, before.id))
      .returning();
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
    }
    return rows;
  });
  if (!updated) return res.status(404).json({ error: "Mission not found" });
  return res.json(updated);
});

router.get("/ai/missions/:missionId/goals", async (req, res) => {
  const owned = await loadOwnedMission(req.params.missionId, req.userId, res);
  if (!owned) return;
  const goals = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.missionId, owned.mission.id))
    .orderBy(desc(aiGoalsTable.createdAt), desc(aiGoalsTable.id));
  return res.json(goals);
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
  return res.json(goal);
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
  const { nextWakeAt, ...rest } = body;
  const updateValues: Partial<typeof aiGoalsTable.$inferInsert> = {
    ...rest,
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
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(aiGoalsTable)
      .set(updateValues)
      .where(eq(aiGoalsTable.id, goal.id))
      .returning();
    if (rows[0]) {
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiGoalUpdated",
        projectId: goal.projectId,
        goalId: goal.id,
        severity: "info",
        message: `AI goal "${rows[0].title}" updated`,
        correlationId,
        payload: { missionId: goal.missionId, changedFields: Object.keys(body) },
      });
    }
    return rows;
  });
  if (!updated) return res.status(404).json({ error: "Goal not found" });
  return res.json(updated);
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
      outcomeContract: body.outcomeContract ?? {},
      nextAction: body.nextAction ?? {},
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiGoalCreated",
      projectId: owned.project.id,
      goalId,
      severity: "info",
      message: `AI goal "${body.title}" created`,
      payload: { missionId: owned.mission.id },
    });
    return created;
  });
  return res.status(201).json(goal);
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