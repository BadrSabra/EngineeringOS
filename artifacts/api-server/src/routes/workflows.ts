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
import { eq, desc, and, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordAudit } from "../lib/audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { tryAdvisoryLock, LockNamespace } from "../lib/advisory-lock.js";
import {
  checkAdvanceCondition,
  computePhaseAdvancement,
  type PhaseShape,
} from "../services/workflow-service.js";
import { parsePagination } from "../lib/pagination.js";
import { executeWorkflowPhase } from "../lib/workflow-phase-execution.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

class WorkflowStateConflictError extends Error {}

// List workflows
router.get("/workflows", async (req, res) => {
  const params = ListWorkflowsQueryParams.parse(req.query);
  const pagination = parsePagination(req, { defaultPageSize: 50, maxPageSize: 200 });
  if (!params.projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }
  const project = await loadProjectByIdForUser(params.projectId, req.userId, res);
  if (!project) return;
  const workflows = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.projectId, project.id))
    .orderBy(desc(workflowsTable.createdAt), desc(workflowsTable.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);
  return res.json(workflows);
});

// Create workflow
router.post("/workflows", async (req, res) => {
  const body = CreateWorkflowBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;
  const now = new Date();
  const workflow = await db.transaction(async (tx) => {
    const rows = await tx.insert(workflowsTable)
      .values({ id: randomUUID(), ...body, createdAt: now, updatedAt: now }).returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(), type: "WorkflowCreated", projectId: body.projectId,
      workflowId: rows[0].id, severity: "info",
      message: `Workflow "${body.name}" created with ${body.phases.length} phase(s)`,
    });
    return rows;
  });

  await recordAudit({
    entityType: "workflow",
    entityId: workflow[0].id,
    action: "created",
    projectId: body.projectId,
    stateAfter: workflow[0],
    actor: req.userId,
  });

  invalidateContextCache(project.id);

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

  await db.transaction(async (tx) => {
    await tx.insert(eventsTable).values({
      id: randomUUID(), type: "WorkflowDeleted", projectId: before[0].projectId,
      workflowId, severity: "info", message: `Workflow "${before[0].name}" deleted`,
    });
    await tx.delete(workflowsTable).where(eq(workflowsTable.id, workflowId));
  });

  await recordAudit({
    entityType: "workflow",
    entityId: workflowId,
    action: "deleted",
    projectId: before[0].projectId,
    stateBefore: before[0],
    actor: req.userId,
  });

  invalidateContextCache(before[0].projectId);

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
        payload: {
          phase: firstPhase,
        },
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

  invalidateContextCache(workflow[0].projectId);

  const phase = (workflow[0].phases as Array<{ name: string; steps?: string[] }> | null)?.find((item) => item.name === firstPhase);
  const phaseExecution = firstPhase
    ? await executeWorkflowPhase({
        userId: req.userId,
        projectId: workflow[0].projectId,
        workflowId,
        workflowExecutionId: execution.id,
        workflowName: workflow[0].name,
        phaseName: firstPhase,
        phaseSteps: phase?.steps ?? [],
        revision: workflow[0].updatedAt.toISOString(),
        completedPhaseNames: [],
      })
    : undefined;

  return res.status(202).json({
    ...execution,
    ...(phaseExecution ? {
      operationId: phaseExecution.operationId,
      phaseExecutionStatus: phaseExecution.status,
    } : {}),
  });
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

  invalidateContextCache(workflow[0].projectId);
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
  const pagination = parsePagination(req, { defaultPageSize: 50, maxPageSize: 200 });
  const executions = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.workflowId, workflowId))
    .orderBy(desc(workflowExecutionsTable.startedAt), desc(workflowExecutionsTable.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);
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

  // Serialize the read/check/claim sequence so a competing request cannot
  // observe the same phase and then advance again after the first request.
  const transitionLock = await tryAdvisoryLock(LockNamespace.WORKFLOW_TRANSITION, workflowId);
  if (!transitionLock.acquired) {
    return res.status(409).json({ error: "A workflow transition is already in progress" });
  }

  try {
  // Evaluate the current phase's advance condition using the safe evaluator
  // (replaces the previous `new Function` approach — audit finding R-001/W-001).
  // An empty/absent condition means "always advance".
   const allPhases = (workflow[0].phases as Array<PhaseShape & { steps?: string[] }>) ?? [];
  const currentPhaseObj = allPhases.find((p) => p.name === execution.currentPhase);
  const conditionCheck = checkAdvanceCondition(currentPhaseObj?.condition, {
    qualityScore: advanceOwnerProject.qualityScore ?? null,
    currentPhase: execution.currentPhase ?? "",
    completedPhases: (execution.completedPhases as string[] | null) ?? [],
  });
  if (!conditionCheck.allowed) {
    if (conditionCheck.reason === "condition_evaluation_error") {
      return res.status(400).json({
        error: "condition_evaluation_error",
        condition: conditionCheck.condition,
        detail: conditionCheck.detail,
        hint: "Check condition expression syntax. Available variables: qualityScore (number|null), currentPhase (string), completedPhases (string[])",
      });
    }
    return res.status(409).json({
      error: "condition_not_met",
      condition: conditionCheck.condition,
      hint: `Phase "${execution.currentPhase}" has an advance condition that is not yet satisfied`,
      context: conditionCheck.context,
      // blockers mirrors the AI orchestrator's wait-action shape so the
      // dashboard can display both sources of blocking uniformly.
      blockers: [`condition_not_met: ${conditionCheck.condition}`],
    });
  }

  if (!execution.currentPhase) {
    return res.status(409).json({
      error: "current_phase_missing",
      hint: "A running workflow execution must always have a currentPhase before it can advance",
    });
  }
  if (!currentPhaseObj) {
    return res.status(409).json({
      error: "current_phase_not_found",
      phase: execution.currentPhase,
      hint: "The execution points to a phase name that does not exist in the workflow definition",
    });
  }
  const { nextPhase, completedPhases, isLastPhase } = computePhaseAdvancement(
    allPhases,
    execution.currentPhase,
    (execution.completedPhases as string[] | null) ?? [],
  );
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

  invalidateContextCache(workflow[0].projectId);

  const nextPhaseObj = nextPhase
    ? allPhases.find((phase) => phase.name === nextPhase)
    : undefined;
  const phaseExecution = nextPhase
    ? await executeWorkflowPhase({
        userId: req.userId,
        projectId: workflow[0].projectId,
        workflowId,
        workflowExecutionId: execution.id,
        workflowName: workflow[0].name,
        phaseName: nextPhase,
        phaseSteps: nextPhaseObj?.steps ?? [],
        revision: workflow[0].updatedAt.toISOString(),
        completedPhaseNames: completedPhases,
      })
    : undefined;

  return res.json({
    ...updatedExecution,
    ...(phaseExecution ? {
      operationId: phaseExecution.operationId,
      phaseExecutionStatus: phaseExecution.status,
    } : {}),
  });
  } finally {
    await transitionLock.release();
  }
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

  invalidateContextCache(workflow[0].projectId);

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

  invalidateContextCache(workflow[0].projectId);

  return res.status(202).json(updatedExecution);
});

// Roll a running, failed, or completed execution back to one of its already
// completed phases. The phase becomes active again and all later completion
// markers are removed, so the execution cannot appear to have skipped work.
router.post("/workflows/:workflowId/executions/:executionId/rollback-phase", async (req, res) => {
  const { workflowId, executionId } = req.params;
  const targetPhase = typeof req.body?.targetPhase === "string" ? req.body.targetPhase.trim() : "";
  if (!targetPhase) {
    return res.status(400).json({
      error: "target_phase_required",
      hint: "Provide the name of a previously completed phase to roll back to",
    });
  }

  const workflow = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, workflowId))
    .limit(1);
  if (!workflow[0]) return res.status(404).json({ error: "Workflow not found" });

  const rollbackOwnerProject = await loadProjectByIdForUser(workflow[0].projectId, req.userId, res);
  if (!rollbackOwnerProject) return;

  const [execution] = await db
    .select()
    .from(workflowExecutionsTable)
    .where(eq(workflowExecutionsTable.id, executionId))
    .limit(1);
  if (!execution || execution.workflowId !== workflowId) {
    return res.status(404).json({ error: "Execution not found" });
  }

  if (!["running", "failed", "completed"].includes(execution.status)) {
    return res.status(409).json({
      error: "execution_not_rollbackable",
      status: execution.status,
      hint: "Only running, failed, or completed executions can be rolled back",
    });
  }

  const allPhases = (workflow[0].phases as PhaseShape[]) ?? [];
  const targetIndex = allPhases.findIndex((phase) => phase.name === targetPhase);
  if (targetIndex < 0) {
    return res.status(409).json({
      error: "target_phase_not_found",
      targetPhase,
      hint: "The target phase must exist in the workflow definition",
    });
  }

  const currentIndex =
    execution.currentPhase === null
      ? execution.status === "completed"
        ? allPhases.length
        : -1
      : allPhases.findIndex((phase) => phase.name === execution.currentPhase);
  if (currentIndex < 0) {
    return res.status(409).json({
      error: "current_phase_not_found",
      phase: execution.currentPhase,
      hint: "The execution points to a phase name that does not exist in the workflow definition",
    });
  }

  const completedPhases = (execution.completedPhases as string[] | null) ?? [];
  if (!completedPhases.includes(targetPhase)) {
    return res.status(409).json({
      error: "target_phase_not_completed",
      targetPhase,
      completedPhases,
      hint: "Rollback can only target a phase already completed by this execution",
    });
  }
  if (targetIndex >= currentIndex) {
    return res.status(409).json({
      error: "target_phase_not_previous",
      targetPhase,
      currentPhase: execution.currentPhase,
      hint: "Rollback must move to an earlier phase than the execution's current position",
    });
  }

  const nextCompletedPhases = allPhases
    .slice(0, targetIndex)
    .map((phase) => phase.name)
    .filter((name) => completedPhases.includes(name));
  const now = new Date();
  const correlationId = randomUUID();
  const executionCurrentPhasePredicate =
    execution.currentPhase === null
      ? isNull(workflowExecutionsTable.currentPhase)
      : eq(workflowExecutionsTable.currentPhase, execution.currentPhase);
  const workflowCurrentPhasePredicate =
    workflow[0].currentPhase === null
      ? isNull(workflowsTable.currentPhase)
      : eq(workflowsTable.currentPhase, workflow[0].currentPhase);

  let updatedExecution: typeof workflowExecutionsTable.$inferSelect;
  try {
    updatedExecution = await db.transaction(async (tx) => {
      const [claimedExecution] = await tx
        .update(workflowExecutionsTable)
        .set({
          status: "running",
          currentPhase: targetPhase,
          completedPhases: nextCompletedPhases,
          completedAt: null,
          errorMessage: null,
        })
        .where(
          and(
            eq(workflowExecutionsTable.id, executionId),
            eq(workflowExecutionsTable.workflowId, workflowId),
            eq(workflowExecutionsTable.status, execution.status),
            executionCurrentPhasePredicate,
          ),
        )
        .returning();
      if (!claimedExecution) {
        throw new WorkflowStateConflictError("Execution state changed before it could be rolled back");
      }

      await tx
        .update(workflowsTable)
        .set({
          status: "running",
          currentPhase: targetPhase,
          updatedAt: now,
        })
        .where(and(eq(workflowsTable.id, workflowId), workflowCurrentPhasePredicate));

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "WorkflowPhaseRolledBack",
        projectId: workflow[0].projectId,
        workflowId,
        severity: "warning",
        message: `Workflow "${workflow[0].name}" rolled back to phase "${targetPhase}"`,
        correlationId,
        payload: {
          before: {
            status: execution.status,
            phase: execution.currentPhase,
            completedPhases,
          },
          after: {
            status: "running",
            phase: targetPhase,
            completedPhases: nextCompletedPhases,
          },
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
    action: "rolled_back",
    projectId: workflow[0].projectId,
    stateBefore: {
      status: execution.status,
      currentPhase: execution.currentPhase,
      completedPhases,
    },
    stateAfter: {
      status: "running",
      currentPhase: targetPhase,
      completedPhases: nextCompletedPhases,
    },
    correlationId,
    actor: req.userId,
  });

  invalidateContextCache(workflow[0].projectId);

  return res.json(updatedExecution);
});

export default router;
