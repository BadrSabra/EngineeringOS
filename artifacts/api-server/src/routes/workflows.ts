import { Router } from "express";
import { db } from "@workspace/db";
import { workflowsTable, workflowExecutionsTable, eventsTable } from "@workspace/db";
import {
  CreateWorkflowBody,
  GetWorkflowParams,
  DeleteWorkflowParams,
  StartWorkflowParams,
  StopWorkflowParams,
  ListWorkflowExecutionsParams,
  ListWorkflowsQueryParams,
} from "@workspace/api-zod";
import { eq, desc, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

// List workflows
router.get("/workflows", async (req, res) => {
  const params = ListWorkflowsQueryParams.parse(req.query);
  const workflows = params.projectId
    ? await db
        .select()
        .from(workflowsTable)
        .where(eq(workflowsTable.projectId, params.projectId))
        .orderBy(desc(workflowsTable.createdAt))
    : await db
        .select()
        .from(workflowsTable)
        .orderBy(desc(workflowsTable.createdAt));
  return res.json(workflows);
});

// Create workflow
router.post("/workflows", async (req, res) => {
  const body = CreateWorkflowBody.parse(req.body);
  const now = new Date();
  const workflow = await db
    .insert(workflowsTable)
    .values({ id: randomUUID(), ...body, createdAt: now, updatedAt: now })
    .returning();

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "WorkflowCreated",
    projectId: body.projectId,
    workflowId: workflow[0].id,
    severity: "info",
    message: `Workflow "${body.name}" created with ${body.phases.length} phase(s)`,
  });

  return res.status(201).json(workflow[0]);
});

// Get workflow
router.get("/workflows/:workflowId", async (req, res) => {
  const { workflowId } = GetWorkflowParams.parse(req.params);
  const workflow = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });
  return res.json(workflow[0]);
});

// Delete workflow
router.delete("/workflows/:workflowId", async (req, res) => {
  const { workflowId } = DeleteWorkflowParams.parse(req.params);
  await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
  return res.status(204).send();
});

// Start workflow
router.post("/workflows/:workflowId/start", async (req, res) => {
  const { workflowId } = StartWorkflowParams.parse(req.params);
  const workflow = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const firstPhase =
    Array.isArray(workflow[0].phases) && workflow[0].phases.length > 0
      ? (workflow[0].phases as Array<{ name: string }>)[0].name
      : null;

  const now = new Date();
  const [execution] = await db
    .insert(workflowExecutionsTable)
    .values({
      id: randomUUID(),
      workflowId,
      status: "running",
      currentPhase: firstPhase ?? undefined,
      startedAt: now,
    })
    .returning();

  await db
    .update(workflowsTable)
    .set({
      status: "running",
      currentPhase: firstPhase ?? undefined,
      executionCount: (workflow[0].executionCount ?? 0) + 1,
      lastExecutedAt: now,
      updatedAt: now,
    })
    .where(eq(workflowsTable.id, workflowId));

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "WorkflowStarted",
    projectId: workflow[0].projectId,
    workflowId,
    severity: "info",
    message: `Workflow "${workflow[0].name}" started — phase: ${firstPhase ?? "unknown"}`,
  });

  return res.status(202).json(execution);
});

// Stop workflow
router.post("/workflows/:workflowId/stop", async (req, res) => {
  const { workflowId } = StopWorkflowParams.parse(req.params);
  const workflow = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const now = new Date();

  await db
    .update(workflowsTable)
    .set({ status: "stopped", updatedAt: now })
    .where(eq(workflowsTable.id, workflowId));

  const executions = await db
    .select()
    .from(workflowExecutionsTable)
    .where(
      and(
        eq(workflowExecutionsTable.workflowId, workflowId),
        eq(workflowExecutionsTable.status, "running"),
      ),
    )
    .orderBy(desc(workflowExecutionsTable.startedAt))
    .limit(1);

  if (executions[0]) {
    await db
      .update(workflowExecutionsTable)
      .set({ status: "stopped", completedAt: now })
      .where(eq(workflowExecutionsTable.id, executions[0].id));
  }

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "WorkflowStopped",
    projectId: workflow[0].projectId,
    workflowId,
    severity: "warning",
    message: `Workflow "${workflow[0].name}" stopped`,
  });

  const updatedExecution = executions[0]
    ? { ...executions[0], status: "stopped" as const, completedAt: now }
    : {
        id: randomUUID(),
        workflowId,
        status: "stopped" as const,
        currentPhase: null,
        completedPhases: [],
        startedAt: now,
        completedAt: now,
        errorMessage: null,
      };

  return res.json(updatedExecution);
});

// List workflow executions
router.get("/workflows/:workflowId/executions", async (req, res) => {
  const { workflowId } = ListWorkflowExecutionsParams.parse(req.params);
  const executions = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.workflowId, workflowId))
    .orderBy(desc(workflowExecutionsTable.startedAt));
  return res.json(executions);
});

export default router;
