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
import { recordAudit } from "../lib/audit.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

class WorkflowStateConflictError extends Error {}

// List workflows
router.get("/workflows", async (req, res) => {
  const params = ListWorkflowsQueryParams.parse(req.query);
  if (!params.projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }
  const project = await loadProjectByIdForUser(params.projectId, req.userId, res);
  if (!project) return;
  const workflows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.projectId, project.id))
    .orderBy(desc(workflowsTable.createdAt));
  return res.json(workflows);
});

// Create workflow
router.post("/workflows", async (req, res) => {
  const body = CreateWorkflowBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
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

  await recordAudit({
    entityType: "workflow",
    entityId: workflow[0].id,
    action: "created",
    projectId: body.projectId,
    stateAfter: workflow[0],
    actor: req.userId,
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
  const ownerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!ownerProject) return;
  return res.json(workflow[0]);
});

// Delete workflow
router.delete("/workflows/:workflowId", async (req, res) => {
  const { workflowId } = DeleteWorkflowParams.parse(req.params);

  const before = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!before[0]) return res.status(404).json({ error: "Workflow not found" });

  const ownerProject = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
  if (!ownerProject) return;

  await db.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "deleted",
    projectId: before[0].projectId,
    stateBefore: before[0],
    actor: req.userId,
  });

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

  const ownerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!ownerProject) return;

  const firstPhase =
    Array.isArray(workflow[0].phases) && workflow[0].phases.length > 0
      ? (workflow[0].phases as Array<{ name: string }>)[0].name
      : null;

  const now = new Date();
  const correlationId = randomUUID();

  // Starting a workflow means: transitioning it out of a non-running state,
  // creating an execution record, and emitting an event — all one logical
  // "phase start" transition. Wrap in a transaction with an atomic claim
  // (status guard) so a double-click / concurrent start request can't
  // create two concurrent execution rows for the same workflow, and a
  // failure partway through can't leave the workflow marked "running" with
  // no execution record to match it.
  let execution: typeof workflowExecutionsTable.$inferSelect;
  try {
    [execution] = await db.transaction(async (tx) => {
      const [claimedWorkflow] = await tx
        .update(workflowsTable)
        .set({
          status: "running",
          currentPhase: firstPhase ?? undefined,
          executionCount: (workflow[0].executionCount ?? 0) + 1,
          lastExecutedAt: now,
          updatedAt: now,
        })
        .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.status, workflow[0].status)))
        .returning();
      if (!claimedWorkflow) {
        throw new WorkflowStateConflictError(
          workflow[0].status === "running"
            ? "Workflow is already running"
            : "Workflow state changed before it could be started",
        );
      }

      const [row] = await tx
        .insert(workflowExecutionsTable)
        .values({
          id: randomUUID(),
          workflowId,
          status: "running",
          currentPhase: firstPhase ?? undefined,
          startedAt: now,
        })
        .returning();

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "WorkflowStarted",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "info",
        message: `Workflow "${workflow[0].name}" started — phase: ${firstPhase ?? "unknown"}`,
        correlationId,
      });

      return [row];
    });
  } catch (err) {
    if (err instanceof WorkflowStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "started",
    projectId: workflow[0].projectId,
    stateBefore: { status: workflow[0].status },
    stateAfter: { status: "running", currentPhase: firstPhase },
    correlationId,
    actor: req.userId,
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

  const stopOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!stopOwnerProject) return;

  const now = new Date();
  const correlationId = randomUUID();

  // Same rationale as start: the workflow status flip, its running
  // execution's terminal state, and the stop event are one transition.
  // Atomically claim the workflow (guard against a concurrent stop) inside
  // the transaction so a race can't leave the workflow "stopped" while its
  // execution row is still "running", or vice versa.
  let updatedExecution: typeof workflowExecutionsTable.$inferSelect;
  try {
    updatedExecution = await db.transaction(async (tx) => {
      const [claimedWorkflow] = await tx
        .update(workflowsTable)
        .set({ status: "stopped", updatedAt: now })
        .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.status, workflow[0].status)))
        .returning();
      if (!claimedWorkflow) {
        throw new WorkflowStateConflictError("Workflow state changed before it could be stopped");
      }

      const executions = await tx
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

      let execution: typeof workflowExecutionsTable.$inferSelect;
      if (executions[0]) {
        [execution] = await tx
          .update(workflowExecutionsTable)
          .set({ status: "stopped", completedAt: now })
          .where(eq(workflowExecutionsTable.id, executions[0].id))
          .returning();
      } else {
        // No running execution found (e.g. workflow was never started, or
        // its execution already finished) — record the stop as a synthetic
        // terminal execution rather than fabricating an ID with no
        // corresponding transition, so the response shape stays consistent.
        [execution] = await tx
          .insert(workflowExecutionsTable)
          .values({
            id: randomUUID(),
            workflowId,
            status: "stopped",
            currentPhase: null,
            startedAt: now,
            completedAt: now,
          })
          .returning();
      }

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "WorkflowStopped",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "warning",
        message: `Workflow "${workflow[0].name}" stopped`,
        correlationId,
      });

      return execution;
    });
  } catch (err) {
    if (err instanceof WorkflowStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "stopped",
    projectId: workflow[0].projectId,
    stateBefore: { status: workflow[0].status },
    stateAfter: { status: "stopped" },
    correlationId,
    actor: req.userId,
  });

  return res.json(updatedExecution);
});

// List workflow executions
router.get("/workflows/:workflowId/executions", async (req, res) => {
  const { workflowId } = ListWorkflowExecutionsParams.parse(req.params);
  const workflow = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });
  const execOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!execOwnerProject) return;
  const executions = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.workflowId, workflowId))
    .orderBy(desc(workflowExecutionsTable.startedAt));
  return res.json(executions);
});

// ─── Real per-phase orchestration ───────────────────────────────────────────
//
// Before this, "start" only ever set currentPhase to the first phase name —
// there was no way to actually move through a workflow's phase list, retry a
// failed phase, or record a phase failure. These three endpoints make
// `phases` a real state machine instead of a label that never changes after
// start.

async function loadRunningExecution(workflowId: string) {
  const [execution] = await db
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
  return execution;
}

// Advance the current running execution to the next phase (or to
// "completed" if the current phase was the last one).
router.post("/workflows/:workflowId/advance", async (req, res) => {
  const { workflowId } = req.params;
  const workflow = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId)).limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const advanceOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!advanceOwnerProject) return;

  const execution = await loadRunningExecution(workflowId);
  if (!execution) {
    return res.status(409).json({ error: "Workflow has no running execution to advance" });
  }

  const phases = (workflow[0].phases as Array<{ name: string }>) ?? [];
  const currentIndex = phases.findIndex((p) => p.name === execution.currentPhase);
  const isLastPhase = currentIndex === -1 || currentIndex === phases.length - 1;
  const nextPhase = isLastPhase ? null : phases[currentIndex + 1].name;
  const completedPhases = [
    ...((execution.completedPhases as string[] | null) ?? []),
    ...(execution.currentPhase ? [execution.currentPhase] : []),
  ];
  const now = new Date();

  const correlationId = randomUUID();
  let updatedExecution: typeof workflowExecutionsTable.$inferSelect;
  try {
    updatedExecution = await db.transaction(async (tx) => {
      // Atomic claim: only advance an execution that is still exactly where
      // we read it (same currentPhase, still running) — guards against a
      // concurrent advance/stop/fail racing on the same execution.
      const [claimedExecution] = await tx
        .update(workflowExecutionsTable)
        .set({
          status: isLastPhase ? "completed" : "running",
          currentPhase: nextPhase,
          completedPhases,
          completedAt: isLastPhase ? now : null,
        })
        .where(
          and(
            eq(workflowExecutionsTable.id, execution.id),
            eq(workflowExecutionsTable.status, "running"),
            execution.currentPhase
              ? eq(workflowExecutionsTable.currentPhase, execution.currentPhase)
              : undefined,
          ),
        )
        .returning();
      if (!claimedExecution) {
        throw new WorkflowStateConflictError("Execution state changed before it could be advanced");
      }

      await tx
        .update(workflowsTable)
        .set({
          currentPhase: nextPhase,
          status: isLastPhase ? "completed" : "running",
          updatedAt: now,
        })
        .where(eq(workflowsTable.id, workflowId));

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: isLastPhase ? "WorkflowCompleted" : "WorkflowPhaseAdvanced",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "info",
        message: isLastPhase
          ? `Workflow "${workflow[0].name}" completed all phases`
          : `Workflow "${workflow[0].name}" advanced to phase: ${nextPhase}`,
        correlationId,
        payload: {
          before: { phase: execution.currentPhase, status: "running" },
          after: { phase: nextPhase, status: isLastPhase ? "completed" : "running" },
        },
      });

      return claimedExecution;
    });
  } catch (err) {
    if (err instanceof WorkflowStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: isLastPhase ? "completed" : "advanced",
    projectId: workflow[0].projectId,
    stateBefore: { currentPhase: execution.currentPhase },
    stateAfter: { currentPhase: nextPhase },
    correlationId,
    actor: req.userId,
  });

  return res.json(updatedExecution);
});

// Mark the running execution's current phase as failed, stopping the run.
router.post("/workflows/:workflowId/fail-phase", async (req, res) => {
  const { workflowId } = req.params;
  const errorMessage = typeof req.body?.error === "string" ? req.body.error : "Phase failed";

  const workflow = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId)).limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const failOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!failOwnerProject) return;

  const execution = await loadRunningExecution(workflowId);
  if (!execution) {
    return res.status(409).json({ error: "Workflow has no running execution to fail" });
  }

  const now = new Date();
  const correlationId = randomUUID();
  let updatedExecution: typeof workflowExecutionsTable.$inferSelect;
  try {
    updatedExecution = await db.transaction(async (tx) => {
      const [claimedExecution] = await tx
        .update(workflowExecutionsTable)
        .set({ status: "failed", errorMessage, completedAt: now })
        .where(and(eq(workflowExecutionsTable.id, execution.id), eq(workflowExecutionsTable.status, "running")))
        .returning();
      if (!claimedExecution) {
        throw new WorkflowStateConflictError("Execution state changed before the phase could be marked failed");
      }

      await tx
        .update(workflowsTable)
        .set({ status: "failed", updatedAt: now })
        .where(eq(workflowsTable.id, workflowId));

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "WorkflowPhaseFailed",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "error",
        message: `Workflow "${workflow[0].name}" failed at phase "${execution.currentPhase ?? "unknown"}": ${errorMessage}`,
        correlationId,
        payload: {
          before: { status: "running", phase: execution.currentPhase },
          after: { status: "failed", errorMessage },
        },
      });

      return claimedExecution;
    });
  } catch (err) {
    if (err instanceof WorkflowStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "phase_failed",
    projectId: workflow[0].projectId,
    stateBefore: { status: "running", currentPhase: execution.currentPhase },
    stateAfter: { status: "failed", errorMessage },
    correlationId,
    actor: req.userId,
  });

  return res.json(updatedExecution);
});

// Retry a failed execution's phase in place: puts the same phase back into
// "running" rather than restarting the whole workflow from phase one.
router.post("/workflows/:workflowId/executions/:executionId/retry-phase", async (req, res) => {
  const { workflowId, executionId } = req.params;

  const workflow = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId)).limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const retryOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!retryOwnerProject) return;

  const [execution] = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.id, executionId))
    .limit(1);
  if (!execution || execution.workflowId !== workflowId) {
    return res.status(404).json({ error: "Execution not found" });
  }

  const now = new Date();
  const correlationId = randomUUID();
  let updatedExecution: typeof workflowExecutionsTable.$inferSelect;
  try {
    updatedExecution = await db.transaction(async (tx) => {
      const [claimedExecution] = await tx
        .update(workflowExecutionsTable)
        .set({ status: "running", errorMessage: null, completedAt: null })
        .where(and(eq(workflowExecutionsTable.id, executionId), eq(workflowExecutionsTable.status, "failed")))
        .returning();
      if (!claimedExecution) {
        throw new WorkflowStateConflictError(`Cannot retry execution with status "${execution.status}"`);
      }

      await tx
        .update(workflowsTable)
        .set({ status: "running", currentPhase: execution.currentPhase, updatedAt: now })
        .where(eq(workflowsTable.id, workflowId));

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "WorkflowPhaseRetried",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "warning",
        message: `Workflow "${workflow[0].name}" retrying phase "${execution.currentPhase ?? "unknown"}"`,
        correlationId,
        payload: {
          before: { status: "failed", phase: execution.currentPhase },
          after: { status: "running", phase: execution.currentPhase },
        },
      });

      return claimedExecution;
    });
  } catch (err) {
    if (err instanceof WorkflowStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "phase_retried",
    projectId: workflow[0].projectId,
    stateBefore: { status: "failed", currentPhase: execution.currentPhase },
    stateAfter: { status: "running", currentPhase: execution.currentPhase },
    correlationId,
    actor: req.userId,
  });

  return res.status(202).json(updatedExecution);
});

export default router;
