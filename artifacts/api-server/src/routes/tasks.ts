import { Router } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  taskLogsTable,
  aiExecutionsTable,
} from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  UpdateTaskParams,
  DeleteTaskParams,
  GetTaskParams,
  ExecuteTaskParams,
  RetryTaskParams,
  RollbackTaskParams,
  GetTaskLogsParams,
  ListTasksQueryParams,
  RecordTaskVerificationBody,
  RecordTaskVerificationParams,
} from "@workspace/api-zod";
import { eq, and, desc, gt, asc, inArray, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordAudit, recordAuditInTransaction } from "../lib/audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { runTaskVerification } from "../services/task-service.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { scheduleAiTaskExecution } from "./ai.js";
import { parsePagination } from "../lib/pagination.js";
import { taskTransitionConflict, type TaskStatus } from "../lib/task-state.js";
import {
  buildRuleVerificationChecks,
  markRemediationPlanVerified,
} from "../lib/remediation-plan.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

class TaskStateConflictError extends Error {}

function serverOwnedVerificationChecks(
  plan: typeof tasksTable.$inferSelect["remediationPlan"],
) {
  if (!plan) return [];
  if (Array.isArray(plan.verificationChecks)) {
    return plan.verificationChecks.filter(
      (check): check is { id: string; kind: "operator_attestation"; guidance: string } =>
        Boolean(
          check &&
            typeof check === "object" &&
            typeof (check as { id?: unknown }).id === "string" &&
            (check as { kind?: unknown }).kind === "operator_attestation" &&
            typeof (check as { guidance?: unknown }).guidance === "string",
        ),
    );
  }
  return buildRuleVerificationChecks(
    (plan.verificationSteps ?? []).filter(
      (step): step is string => typeof step === "string",
    ),
  );
}

// List tasks
router.get("/tasks", async (req, res) => {
  const params = ListTasksQueryParams.parse(req.query);
  const pagination = parsePagination(req, { defaultPageSize: 50, maxPageSize: 200 });
  const project = await loadProjectByIdForUser(params.projectId, req.userId, res);
  if (!project) return;

  const conditions: ReturnType<typeof eq>[] = [eq(tasksTable.projectId, project.id)];
  if (params.status) conditions.push(eq(tasksTable.status, params.status));
  if (params.priority)
    conditions.push(eq(tasksTable.priority, params.priority));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt), desc(tasksTable.id))
    .limit(pagination.pageSize)
    .offset(pagination.offset);
  return res.json(tasks);
});

// Create task
router.post("/tasks", async (req, res) => {
  const body = CreateTaskBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;

  const now = new Date();
  const correlationId = randomUUID();
  const task = await db.transaction(async (tx) => {
    const rows = await tx.insert(tasksTable)
      .values({ id: randomUUID(), ...body, correlationId, createdAt: now, updatedAt: now })
      .returning();
    await tx.insert(eventsTable).values({
      id: randomUUID(), type: "TaskCreated", projectId: body.projectId,
      taskId: rows[0].id, severity: "info",
      message: `Task "${body.title}" created (${body.priority})`, correlationId,
    });
    await recordAuditInTransaction(tx, {
      entityType: "task", entityId: rows[0].id, action: "created",
      projectId: body.projectId, actor: req.userId, correlationId,
      stateAfter: rows[0],
    });
    return rows;
  });

  invalidateContextCache(project.id);

  return res.status(201).json(task[0]);
});

// Get task
router.get("/tasks/:taskId", async (req, res) => {
  const { taskId } = GetTaskParams.parse(req.params);
  const task = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(task[0].projectId, req.userId, res);
  if (!project) return;
  return res.json(task[0]);
});

// Update task
router.patch("/tasks/:taskId", async (req, res) => {
  const { taskId } = UpdateTaskParams.parse(req.params);
  const body = UpdateTaskBody.parse(req.body);

  const before = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!before[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
  if (!project) return;

  // GAP-B3: reject edits while the AI agent is actively executing the task.
  // Allowing a PATCH on a running task could corrupt the agent's in-flight
  // state (e.g. overwriting the status it's about to transition away from).
  if (before[0].status === "running") {
    return res.status(409).json({
      error: "task_running",
      hint: "This task is currently being executed by the AI — wait for it to finish (or cancel it) before making changes.",
    });
  }
  if (body.status && body.status !== before[0].status) {
    const conflict = taskTransitionConflict(
      before[0].status as TaskStatus,
      body.status as TaskStatus,
      "manual",
    );
    if (conflict) {
      await recordAudit({
        entityType: "task",
        entityId: taskId,
        action: "updated",
        reason: `Rejected task status transition: ${conflict}`,
        projectId: before[0].projectId,
        actor: req.userId,
        correlationId: randomUUID(),
        changedFields: body,
        stateBefore: before[0],
      });
      return res.status(409).json({
        error: "invalid_task_transition",
        reason: conflict,
        from: before[0].status,
        to: body.status,
      });
    }
  }

  const correlationId = randomUUID();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(tasksTable)
      .set({ ...body, updatedAt: new Date() })
      .where(and(
        eq(tasksTable.id, taskId),
        eq(tasksTable.status, before[0].status),
        isNull(tasksTable.workerId),
      )).returning();
    if (rows[0]) {
      const changes: string[] = [];
      if (body.status && body.status !== before[0].status) changes.push(`status: ${before[0].status} → ${body.status}`);
      if (body.priority && body.priority !== before[0].priority) changes.push(`priority: ${before[0].priority} → ${body.priority}`);
      if (body.title && body.title !== before[0].title) changes.push("title updated");
      if (changes.length) {
        const isStatusChange = body.status !== undefined && body.status !== before[0].status;
        await tx.insert(eventsTable).values({
          id: randomUUID(), type: isStatusChange ? "TaskStatusChanged" : "TaskUpdated",
          projectId: before[0].projectId, taskId, severity: "info",
          message: `Task "${rows[0].title}" updated — ${changes.join(", ")}`, correlationId,
          ...(isStatusChange ? { payload: { before: { status: before[0].status }, after: { status: body.status } } } : {}),
        });
      }
      await recordAuditInTransaction(tx, {
        entityType: "task", entityId: taskId, action: "updated",
        projectId: before[0].projectId, actor: req.userId, correlationId,
        changedFields: body, stateBefore: before[0], stateAfter: rows[0],
      });
    }
    return rows;
  });
  if (!updated[0]) {
    return res.status(409).json({
      error: "task_state_changed_concurrently",
      reason: "The task changed while this update was being applied.",
    });
  }

  // PR-C: auto-trigger AI execution when a manual PATCH sets status → verifying
  // and the task has a generated prompt.  Fire-and-forget — never blocks response.
  if (body.status === "verifying" && updated[0].prompt) {
    scheduleAiTaskExecution(taskId, req.userId);
  }

  invalidateContextCache(project.id);

  return res.json(updated[0]);
});

// Delete task
router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = DeleteTaskParams.parse(req.params);

  const before = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!before[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
  if (!project) return;

  const correlationId = randomUUID();
  try {
    await db.transaction(async (tx) => {
    const [lockedTask] = await tx.select().from(tasksTable)
      .where(eq(tasksTable.id, taskId)).for("update");
    const activeExecutions = await tx.select({ id: aiExecutionsTable.id })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.linkedTaskId, taskId),
        inArray(aiExecutionsTable.status, ["queued", "running", "paused", "cancelling"]),
      ))
      .limit(1);
    if (!lockedTask || lockedTask.status === "running" || lockedTask.workerId || lockedTask.leaseUntil || activeExecutions.length > 0) {
      throw new TaskStateConflictError("Cancel and terminalize the task execution before deleting this task.");
    }
    // Insert before the delete so the task FK is valid; ON DELETE SET NULL
    // preserves this operation event after the task row is removed.
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "TaskDeleted",
      projectId: before[0].projectId,
      taskId,
      severity: "info",
      message: `Task "${before[0].title}" deleted`,
      correlationId,
      payload: { before: { status: before[0].status } },
    });
    await recordAuditInTransaction(tx, {
      entityType: "task", entityId: taskId, action: "deleted",
      projectId: before[0].projectId, actor: req.userId, correlationId,
      stateBefore: before[0],
    });
    await tx.delete(tasksTable).where(eq(tasksTable.id, taskId));
    });
  } catch (error) {
    if (error instanceof TaskStateConflictError) {
      return res.status(409).json({ error: "task_active_work", reason: error.message });
    }
    throw error;
  }

  invalidateContextCache(project.id);

  return res.status(204).send();
});

/**
 * Execute task — real verification state machine.
 *
 * State transition: pending | queued → running → completed | failed | verifying
 *
 * Verification logic:
 * 1. If task has a ruleId with a pattern → scan the project's rootPath and
 *    check whether the pattern still appears in the task's relatedFiles.
 * 2. If task has relatedFiles but no rule pattern → verify files exist.
 * 3. Neither → verifying (awaiting AI/human step).
 */
router.post("/tasks/:taskId/execute", async (req, res) => {
  const { taskId } = ExecuteTaskParams.parse(req.params);
  const task = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task[0]) return res.status(404).json({ error: "Task not found" });

  const project = await loadProjectByIdForUser(task[0].projectId, req.userId, res);
  if (!project) return;

  const now = new Date();

  // Atomic claim: only one concurrent /execute call can move a task out of
  // pending/queued. A conditional UPDATE with a status guard means a second
  // request racing on the same task sees 0 rows affected and gets a clean
  // 409 instead of both requests running verification concurrently.
  const claimed = await db
    .update(tasksTable)
    .set({ status: "running", updatedAt: now })
    .where(and(eq(tasksTable.id, taskId), inArray(tasksTable.status, ["pending", "queued"])))
    .returning();
  if (claimed.length === 0) {
    return res
      .status(409)
      .json({ error: `Cannot execute task with status "${task[0].status}"` });
  }

  // One ID for this entire execute operation — threads through the
  // "started" log line, the verification log/event, and the audit entry so
  // the full execution trace can be retrieved with a single filter.
  const correlationId = randomUUID();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: "Task execution started — running verification against project root",
    metadata: {
      initiatedAt: now.toISOString(),
      projectRoot: project.rootPath,
    },
    correlationId,
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "TaskExecutionStarted",
    projectId: task[0].projectId,
    taskId,
    severity: "info",
    message: `Executing task "${task[0].title}"`,
    correlationId,
    payload: { before: { status: task[0].status }, after: { status: "running" } },
  });

  // Delegate to the task service (business logic extracted from route — audit W-003/PR-03).
  let verification;
  try {
    verification = await runTaskVerification(task[0], project.rootPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .update(tasksTable)
      .set({ status: task[0].status, updatedAt: now })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")));

    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: "error",
      message: `Task execution failed: ${message}`,
      metadata: { error: message, correlationId },
      correlationId,
    });

    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "TaskExecutionFailed",
      projectId: task[0].projectId,
      taskId,
      severity: "error",
      message: `Executing task "${task[0].title}" failed: ${message}`,
      correlationId,
      payload: { before: { status: "running" }, after: { status: task[0].status } },
    });

    await recordAudit({
      entityType: "task",
      entityId: taskId,
      action: "execution_failed",
      projectId: task[0].projectId,
      stateBefore: { status: "running" },
      stateAfter: { status: task[0].status },
      changedFields: { error: message },
      correlationId,
    });

    invalidateContextCache(project.id);

    return res.status(500).json({
      error: "task_execution_failed",
      reason: message,
    });
  }

  const { finalStatus, steps: verificationSteps } = verification;

  const verificationResult = {
    passed: finalStatus === "completed",
    decision:
      finalStatus === "completed"
        ? ("verified" as const)
        : finalStatus === "failed"
          ? ("failed" as const)
          : ("incomplete" as const),
    steps: verificationSteps.map((step) => ({
      ...step,
      kind: step.kind ?? ("automatic" as const),
    })),
  };
  const completedAt = finalStatus === "completed" ? now : null;

  // The verification outcome, its log line, and its event are one logical
  // effect of this execution — persist them atomically so a crash between
  // steps can't leave a task marked "completed" with no corresponding log
  // or event (or vice versa).
  let updated: typeof tasksTable.$inferSelect | undefined;
  try {
    [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tasksTable)
      .set({
        status: finalStatus,
        verificationResult,
        remediationPlan: markRemediationPlanVerified(
          task[0].remediationPlan,
          finalStatus === "completed",
        ),
        updatedAt: now,
        completedAt,
      })
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, "running")))
      .returning();
    if (!row) {
      throw new TaskStateConflictError("Task state changed before verification could be finalized");
    }

    await tx.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId,
      level: finalStatus === "completed" ? "info" : finalStatus === "failed" ? "error" : "warn",
      message: `Verification ${finalStatus}: ${verificationSteps[0]?.output ?? "no details"}`,
      metadata: { verificationResult },
      correlationId,
    });

    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type:
        finalStatus === "completed"
          ? "TaskCompleted"
          : finalStatus === "failed"
            ? "TaskFailed"
            : "TaskVerifying",
      projectId: task[0].projectId,
      taskId,
      severity:
        finalStatus === "completed"
          ? "success"
          : finalStatus === "failed"
            ? "error"
            : "warning",
      message: `Task "${task[0].title}" → ${finalStatus}`,
      correlationId,
      payload: { before: { status: "running" }, after: { status: finalStatus } },
    });
      await recordAuditInTransaction(tx, {
        entityType: "task", entityId: taskId, action: "executed",
        projectId: task[0].projectId, stateBefore: { status: task[0].status },
        stateAfter: { status: finalStatus },
        changedFields: { verificationResult }, correlationId,
      });

      return [row];
    });
  } catch (error) {
    if (error instanceof TaskStateConflictError) {
      return res.status(409).json({ error: "task_state_changed_concurrently" });
    }
    throw error;
  }

  invalidateContextCache(project.id);

  // PR-C: auto-trigger AI execution when the execute path lands on `verifying`
  // and the task already has a generated prompt. Fire-and-forget into the shared
  // heavyJobQueue — never blocks this HTTP response.
  if (finalStatus === "verifying" && task[0].prompt) {
    scheduleAiTaskExecution(taskId, req.userId);
  }

  return res.status(202).json(updated);
});

// Record one operator result for a server-owned rule verification check.
// The client submits only the stable check ID and evidence; guidance and
// check names always come from the persisted remediation plan.
router.post("/tasks/:taskId/verification", async (req, res) => {
  const { taskId } = RecordTaskVerificationParams.parse(req.params);
  const body = RecordTaskVerificationBody.parse(req.body);
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const project = await loadProjectByIdForUser(task.projectId, req.userId, res);
  if (!project) return;

  if (task.status !== "verifying") {
    return res.status(409).json({
      error: "task_not_verifying",
      reason: `Verification can only be recorded while the task is verifying, not "${task.status}".`,
    });
  }
  if (task.workerId || task.leaseUntil) {
    return res.status(409).json({
      error: "task_active_work",
      reason: "The active task worker must terminate before verification can be recorded.",
    });
  }
  if (body.passed && (!body.evidence || body.evidence.trim().length === 0)) {
    return res.status(400).json({
      error: "verification_evidence_required",
      reason: "A passed verification check must include explicit operator evidence.",
    });
  }

  const correlationId = randomUUID();
  let updated: typeof tasksTable.$inferSelect;
  try {
    [updated] = await db.transaction(async (tx) => {
      const [lockedTask] = await tx
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .for("update");
      if (
        !lockedTask ||
        lockedTask.status !== "verifying" ||
        lockedTask.workerId ||
        lockedTask.leaseUntil
      ) {
        throw new TaskStateConflictError(
          "Task state changed before verification could be recorded",
        );
      }

      const checks = serverOwnedVerificationChecks(lockedTask.remediationPlan);
      const check = checks.find((candidate) => candidate.id === body.checkId);
      if (!check) {
        throw new Error("verification_check_not_found");
      }
      if (
        !lockedTask.remediationPlan ||
        lockedTask.remediationPlan.status === "needs_review" ||
        !Array.isArray(lockedTask.remediationPlan.evidence) ||
        lockedTask.remediationPlan.evidence.length === 0
      ) {
        throw new Error("verification_plan_requires_review");
      }

      type RecordedStep = {
        id?: string;
        name: string;
        kind?: "automatic" | "operator_attestation";
        guidance?: string;
        passed: boolean;
        evidence?: string;
        output?: string;
      };
      type VerificationHistoryEntry = {
        id: string;
        checkId: string;
        name: string;
        kind?: "automatic" | "operator_attestation";
        guidance?: string;
        passed: boolean;
        evidence?: string;
        actor: string;
        recordedAt: string;
      };
      const existingSteps = (lockedTask.verificationResult?.steps ?? []) as RecordedStep[];
      const existingHistory = (lockedTask.verificationResult?.history ?? []) as VerificationHistoryEntry[];
      const existingById = new Map(
        existingSteps
          .filter((step) => typeof step.id === "string")
          .map((step) => [step.id as string, step]),
      );
      const recordedStep: RecordedStep = {
        id: check.id,
        name: `Rule verification ${check.id.replace("rule-verification-", "#")}`,
        kind: check.kind,
        guidance: check.guidance,
        passed: body.passed,
        ...(body.evidence ? { evidence: body.evidence.trim() } : {}),
        output: body.passed
          ? "Operator evidence recorded"
          : "Operator reported that this check did not pass",
      };
      const recordedHistoryEntry: VerificationHistoryEntry = {
        id: randomUUID(),
        checkId: check.id,
        name: recordedStep.name,
        kind: check.kind,
        guidance: check.guidance,
        passed: body.passed,
        ...(body.evidence ? { evidence: body.evidence.trim() } : {}),
        actor: req.userId,
        recordedAt: new Date().toISOString(),
      };
      existingById.set(check.id, recordedStep);

      const guidanceSteps = checks.map(
        (candidate) =>
          existingById.get(candidate.id) ?? {
            id: candidate.id,
            name: `Rule verification ${candidate.id.replace("rule-verification-", "#")}`,
            kind: candidate.kind,
            guidance: candidate.guidance,
            passed: false,
            output: "Not recorded — operator evidence is required",
          },
      );
      const automaticSteps = existingSteps.filter(
        (step) =>
          step.kind === "automatic" &&
          step.name !== "Manual verification required" &&
          !checks.some((candidate) => candidate.id === step.id),
      );
      const steps = [...automaticSteps, ...guidanceSteps];
      const allChecksPassed = guidanceSteps.every(
        (step) => step.passed && Boolean(step.evidence?.trim()),
      );
      const automaticChecksPassed = automaticSteps.every((step) => step.passed);
      const passed = allChecksPassed && automaticChecksPassed;
      const nextStatus = passed ? "completed" : "verifying";
      const verificationResult = {
        passed,
        decision: passed ? ("verified" as const) : ("incomplete" as const),
        steps,
        history: [...existingHistory, recordedHistoryEntry],
      };

      const [row] = await tx
        .update(tasksTable)
        .set({
          status: nextStatus,
          verificationResult,
          remediationPlan: markRemediationPlanVerified(lockedTask.remediationPlan, passed),
          completedAt: passed ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.status, "verifying"),
            isNull(tasksTable.workerId),
            isNull(tasksTable.leaseUntil),
          ),
        )
        .returning();
      if (!row) {
        throw new TaskStateConflictError(
          "Task state changed before verification could be finalized",
        );
      }

      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: passed ? "info" : "warn",
        message: `Operator verification ${passed ? "completed" : "recorded"}: ${recordedStep.name}`,
        metadata: {
          checkId: check.id,
          passed: body.passed,
          evidenceRecorded: Boolean(body.evidence?.trim()),
        },
        correlationId,
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: passed ? "TaskVerified" : "TaskVerificationRecorded",
        projectId: lockedTask.projectId,
        taskId,
        severity: passed ? "success" : "warning",
        message: `Task "${lockedTask.title}" verification ${passed ? "completed" : "updated"}`,
        correlationId,
        payload: {
          checkId: check.id,
          passed: body.passed,
          overallPassed: passed,
          after: { status: nextStatus },
        },
      });
      await recordAuditInTransaction(tx, {
        entityType: "task",
        entityId: taskId,
        action: "updated",
        projectId: lockedTask.projectId,
        actor: req.userId,
        correlationId,
        reason: "operator_verification_recorded",
        changedFields: { checkId: check.id, passed: body.passed, overallPassed: passed },
        stateBefore: { status: lockedTask.status, verificationResult: lockedTask.verificationResult },
        stateAfter: { status: nextStatus, verificationResult },
      });
      return [row];
    });
  } catch (error) {
    if (error instanceof TaskStateConflictError) {
      return res.status(409).json({ error: "task_state_changed_concurrently" });
    }
    if (error instanceof Error && error.message === "verification_check_not_found") {
      return res.status(400).json({
        error: "verification_check_not_found",
        reason: "The submitted check is not part of this task's server-owned verification plan.",
      });
    }
    if (error instanceof Error && error.message === "verification_plan_requires_review") {
      return res.status(409).json({
        error: "verification_plan_requires_review",
        reason: "Verification is blocked until the remediation plan has complete evidence and guidance.",
      });
    }
    throw error;
  }

  invalidateContextCache(project.id);
  return res.json(updated);
});

// Retry task
router.post("/tasks/:taskId/retry", async (req, res) => {
  const { taskId } = RetryTaskParams.parse(req.params);
  const task = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(task[0].projectId, req.userId, res);
  if (!project) return;

  const retryCount = task[0].retryCount ?? 0;
  const maxRetries = task[0].maxRetries ?? 3;
  const retryTransition = taskTransitionConflict(task[0].status as TaskStatus, "queued", "retry");
  if (retryTransition) {
    return res.status(409).json({ error: retryTransition });
  }
  if (retryCount >= maxRetries) {
    return res
      .status(409)
      .json({ error: `Task has reached max retries (${maxRetries})` });
  }

  const now = new Date();
  const correlationId = randomUUID();
  let updated: typeof tasksTable.$inferSelect;
  try {
    [updated] = await db.transaction(async (tx) => {
      // Atomic claim + effects in one transaction: the status/retryCount
      // guard means a concurrent retry call on the same task affects 0 rows
      // and the whole transaction rolls back instead of double-incrementing
      // retryCount or racing with another retry/execute call.
      const [row] = await tx
        .update(tasksTable)
        .set({ status: "queued", retryCount: retryCount + 1, updatedAt: now })
        .where(
          and(
            eq(tasksTable.id, taskId),
            inArray(tasksTable.status, ["failed", "cancelled"]),
            eq(tasksTable.retryCount, retryCount),
          ),
        )
        .returning();
      if (!row) {
        throw new TaskStateConflictError(`Cannot retry task with status "${task[0].status}"`);
      }

      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "info",
        message: `Retry attempt #${retryCount + 1}`,
        correlationId,
      });

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "TaskRetried",
        projectId: task[0].projectId,
        taskId,
        severity: "warning",
        message: `Task "${task[0].title}" queued for retry (#${retryCount + 1})`,
        correlationId,
        payload: { before: { status: task[0].status, retryCount }, after: { status: "queued", retryCount: retryCount + 1 } },
      });
      await recordAuditInTransaction(tx, {
        entityType: "task", entityId: taskId, action: "retried",
        projectId: task[0].projectId, stateBefore: { status: task[0].status, retryCount },
        stateAfter: { status: "queued", retryCount: retryCount + 1 }, correlationId,
      });

      return [row];
    });
  } catch (err) {
    if (err instanceof TaskStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  invalidateContextCache(project.id);

  return res.status(202).json(updated);
});

// Rollback task
router.post("/tasks/:taskId/rollback", async (req, res) => {
  const { taskId } = RollbackTaskParams.parse(req.params);
  const task = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(task[0].projectId, req.userId, res);
  if (!project) return;
  if (task[0].workerId || task[0].leaseUntil) {
    return res.status(409).json({
      error: "task_active_work",
      reason: "The active task worker must terminate before cancellation can be applied.",
    });
  }
  const activeExecutions = await db.select({ id: aiExecutionsTable.id })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.linkedTaskId, taskId),
      inArray(aiExecutionsTable.status, ["queued", "running", "paused", "cancelling"]),
    ))
    .limit(1);
  if (activeExecutions.length > 0) {
    return res.status(409).json({
      error: "task_active_work",
      reason: "Cancel and terminalize the linked AI execution before rolling back this task.",
    });
  }
  const cancellationConflict = taskTransitionConflict(
    task[0].status as TaskStatus,
    "cancelled",
    "cancellation",
  );
  if (cancellationConflict) {
    return res.status(409).json({
      error: "invalid_task_transition",
      reason: cancellationConflict,
    });
  }

  const now = new Date();
  const correlationId = randomUUID();
  let updated: typeof tasksTable.$inferSelect;
  try {
    [updated] = await db.transaction(async (tx) => {
      // Atomic claim: rollback is only valid from a non-terminal-cancelled
      // state, and only one concurrent rollback call should win. The status
      // guard means a second call (or a racing execute/retry) affects 0
      // rows and rolls back cleanly with a 409 instead of double-logging.
      const [row] = await tx
        .update(tasksTable)
        .set({ status: "cancelled", updatedAt: now })
        .where(and(eq(tasksTable.id, taskId), eq(tasksTable.status, task[0].status)))
        .returning();
      if (!row) {
        throw new TaskStateConflictError(
          `Task state changed before rollback could be applied`,
        );
      }

      await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId,
        level: "warn",
        message: "Task rolled back — changes reverted",
        correlationId,
      });

      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "TaskRolledBack",
        projectId: task[0].projectId,
        taskId,
        severity: "warning",
        message: `Task "${task[0].title}" rolled back`,
        correlationId,
        payload: { before: { status: task[0].status }, after: { status: "cancelled" } },
      });
      await recordAuditInTransaction(tx, {
        entityType: "task", entityId: taskId, action: "rolled_back",
        projectId: task[0].projectId, stateBefore: { status: task[0].status },
        stateAfter: { status: "cancelled" }, correlationId,
      });

      return [row];
    });
  } catch (err) {
    if (err instanceof TaskStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  invalidateContextCache(project.id);

  return res.json(updated);
});

// Get task logs
router.get("/tasks/:taskId/logs", async (req, res) => {
  const { taskId } = GetTaskLogsParams.parse(req.params);
  const task = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task[0]) return res.status(404).json({ error: "Task not found" });
  const _project = await loadProjectByIdForUser(task[0].projectId, req.userId, res);
  if (!_project) return;

  const logs = await db
    .select()
    .from(taskLogsTable)
    .where(eq(taskLogsTable.taskId, taskId))
    .orderBy(desc(taskLogsTable.timestamp));
  return res.json(logs);
});

// SSE: stream task logs in real-time while a task is running
// GET /tasks/:taskId/logs/stream
router.get("/tasks/:taskId/logs/stream", async (req, res) => {
  const { taskId } = GetTaskLogsParams.parse(req.params);

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const _project = await loadProjectByIdForUser(task.projectId, req.userId, res);
  if (!_project) return;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Send all existing logs immediately (oldest first)
  const existing = await db
    .select()
    .from(taskLogsTable)
    .where(eq(taskLogsTable.taskId, taskId))
    .orderBy(asc(taskLogsTable.timestamp));
  for (const log of existing) send("log", log);

  // Track cursor as the latest timestamp seen
  let cursor = existing.length > 0
    ? { timestamp: existing[existing.length - 1].timestamp, id: existing[existing.length - 1].id }
    : { timestamp: new Date(0), id: "" };

  let closed = false;
  req.on("close", () => { closed = true; });

  // 5-minute max stream lifetime
  const ttl = setTimeout(() => {
    if (!closed) { send("done", { reason: "timeout" }); res.end(); }
  }, 5 * 60_000);

  const interval = setInterval(async () => {
    if (closed) { clearInterval(interval); clearTimeout(ttl); return; }
    try {
      // Fetch new log rows since cursor
      const newLogs = await db
        .select()
        .from(taskLogsTable)
        .where(and(
          eq(taskLogsTable.taskId, taskId),
          or(
            gt(taskLogsTable.timestamp, cursor.timestamp),
            and(eq(taskLogsTable.timestamp, cursor.timestamp), gt(taskLogsTable.id, cursor.id)),
          ),
        ))
        .orderBy(asc(taskLogsTable.timestamp), asc(taskLogsTable.id));

      for (const log of newLogs) {
        send("log", log);
        cursor = { timestamp: log.timestamp, id: log.id };
      }

      // Check task status — close stream when no longer running
      const [current] = await db
        .select({ status: tasksTable.status })
        .from(tasksTable)
        .where(eq(tasksTable.id, taskId))
        .limit(1);

      if (!current || current.status !== "running") {
        clearInterval(interval);
        clearTimeout(ttl);
        send("done", { status: current?.status ?? "unknown" });
        res.end();
      }
    } catch {
      // Swallow transient DB errors — client will reconnect if needed
    }
  }, 500);
  return;
});

export default router;
