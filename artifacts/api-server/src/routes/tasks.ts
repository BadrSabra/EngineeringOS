import { Router } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  taskLogsTable,
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
} from "@workspace/api-zod";
import { eq, and, desc, gt, asc, inArray, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { recordAudit } from "../lib/audit.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { runTaskVerification } from "../services/task-service.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { scheduleAiTaskExecution } from "./ai.js";
import { parsePagination } from "../lib/pagination.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

class TaskStateConflictError extends Error {}

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
    return rows;
  });

  await recordAudit({
    entityType: "task",
    entityId: task[0].id,
    action: "created",
    projectId: body.projectId,
    actor: req.userId,
    correlationId,
    stateAfter: task[0],
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

  const correlationId = randomUUID();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx.update(tasksTable)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(tasksTable.id, taskId)).returning();
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
    }
    return rows;
  });
  if (!updated[0]) return res.status(404).json({ error: "Task not found" });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "updated",
    projectId: before[0].projectId,
    actor: req.userId,
    correlationId,
    changedFields: body,
    stateBefore: before[0],
    stateAfter: updated[0],
  });

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
  await db.transaction(async (tx) => {
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
    await tx.delete(tasksTable).where(eq(tasksTable.id, taskId));
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "deleted",
    projectId: before[0].projectId,
    actor: req.userId,
    correlationId,
    stateBefore: before[0],
  });

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

  const verificationResult = { passed: finalStatus === "completed", steps: verificationSteps };
  const completedAt = finalStatus === "completed" ? now : null;

  // The verification outcome, its log line, and its event are one logical
  // effect of this execution — persist them atomically so a crash between
  // steps can't leave a task marked "completed" with no corresponding log
  // or event (or vice versa).
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tasksTable)
      .set({ status: finalStatus, verificationResult, updatedAt: now, completedAt })
      .where(eq(tasksTable.id, taskId))
      .returning();

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

    return [row];
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "executed",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status },
    stateAfter: { status: finalStatus },
    changedFields: { verificationResult },
    correlationId,
  });

  invalidateContextCache(project.id);

  // PR-C: auto-trigger AI execution when the execute path lands on `verifying`
  // and the task already has a generated prompt. Fire-and-forget into the shared
  // heavyJobQueue — never blocks this HTTP response.
  if (finalStatus === "verifying" && task[0].prompt) {
    scheduleAiTaskExecution(taskId, req.userId);
  }

  return res.status(202).json(updated);
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

      return [row];
    });
  } catch (err) {
    if (err instanceof TaskStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "retried",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status, retryCount },
    stateAfter: { status: "queued", retryCount: retryCount + 1 },
    correlationId,
  });

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

      return [row];
    });
  } catch (err) {
    if (err instanceof TaskStateConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "rolled_back",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status },
    stateAfter: { status: "cancelled" },
    correlationId,
  });

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
