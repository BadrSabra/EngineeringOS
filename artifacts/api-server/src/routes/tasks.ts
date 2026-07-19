import { Router } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  taskLogsTable,
  rulesTable,
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
import { eq, and, desc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { walkProject, checkPatternInFiles } from "@workspace/scanner";
import { recordAudit } from "../lib/audit.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { loadProjectByIdForUser } from "../middlewares/requireProjectAccess.js";
import { scheduleAiTaskExecution } from "./ai.js";

const router = Router();

// Defense-in-depth: requireAuth is already applied globally in app.ts, but
// adding it here too means this router is safe even if mounted without it.
router.use(requireAuth);

class TaskStateConflictError extends Error {}

// List tasks
router.get("/tasks", async (req, res) => {
  const params = ListTasksQueryParams.parse(req.query);
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
    .orderBy(desc(tasksTable.createdAt));
  return res.json(tasks);
});

// Create task
router.post("/tasks", async (req, res) => {
  const body = CreateTaskBody.parse(req.body);
  const project = await loadProjectByIdForUser(body.projectId, req.userId, res);
  if (!project) return;

  const now = new Date();
  const task = await db
    .insert(tasksTable)
    .values({ id: randomUUID(), ...body, createdAt: now, updatedAt: now })
    .returning();

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "TaskCreated",
    projectId: body.projectId,
    taskId: task[0].id,
    severity: "info",
    message: `Task "${body.title}" created (${body.priority})`,
  });

  await recordAudit({
    entityType: "task",
    entityId: task[0].id,
    action: "created",
    projectId: body.projectId,
    actor: req.userId,
    correlationId: randomUUID(),
    stateAfter: task[0],
  });

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

  const updated = await db
    .update(tasksTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();
  if (!updated[0]) return res.status(404).json({ error: "Task not found" });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "updated",
    projectId: before[0].projectId,
    actor: req.userId,
    correlationId: randomUUID(),
    changedFields: body,
    stateBefore: before[0],
    stateAfter: updated[0],
  });

  // D-03: emit an event for meaningful field changes (status/priority) so the
  // AI context's recentEvents reflects manual edits.  Previously only the
  // audit_log was updated — the AI could see a task's current state in
  // recentTasks but had no event explaining when or why it changed.
  const changes: string[] = [];
  if (body.status && body.status !== before[0].status)
    changes.push(`status: ${before[0].status} → ${body.status}`);
  if (body.priority && body.priority !== before[0].priority)
    changes.push(`priority: ${before[0].priority} → ${body.priority}`);
  if (body.title && body.title !== before[0].title)
    changes.push(`title updated`);

  if (changes.length > 0) {
    // Use TaskStatusChanged (with structured before/after payload) when the
    // status field specifically changed — other field changes keep TaskUpdated.
    const isStatusChange = body.status !== undefined && body.status !== before[0].status;
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: isStatusChange ? "TaskStatusChanged" : "TaskUpdated",
      projectId: before[0].projectId,
      taskId,
      severity: "info",
      message: `Task "${updated[0].title}" updated — ${changes.join(", ")}`,
      ...(isStatusChange
        ? { payload: { before: { status: before[0].status }, after: { status: body.status } } }
        : {}),
    });
  }

  // PR-C: auto-trigger AI execution when a manual PATCH sets status → verifying
  // and the task has a generated prompt.  Fire-and-forget — never blocks response.
  if (body.status === "verifying" && updated[0].prompt) {
    scheduleAiTaskExecution(taskId, req.userId);
  }

  return res.json(updated[0]);
});

// Delete task
router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = DeleteTaskParams.parse(req.params);

  const before = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!before[0]) return res.status(404).json({ error: "Task not found" });
  const project = await loadProjectByIdForUser(before[0].projectId, req.userId, res);
  if (!project) return;

  await db.delete(tasksTable).where(eq(tasksTable.id, taskId));

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "deleted",
    projectId: before[0].projectId,
    actor: req.userId,
    stateBefore: before[0],
  });

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

  type VerificationStep = { name: string; passed: boolean; output?: string };
  const verificationSteps: VerificationStep[] = [];
  let finalStatus: "completed" | "failed" | "verifying" = "verifying";

  const relatedFiles = (task[0].relatedFiles as string[] | null) ?? [];

  let rulePattern: string | null = null;
  if (task[0].ruleId) {
    const rule = await db
      .select()
      .from(rulesTable)
      .where(eq(rulesTable.id, task[0].ruleId))
      .limit(1);
    rulePattern = rule[0]?.pattern ?? null;
  }

  if (rulePattern) {
    const { files: projectFiles } = await walkProject(project.rootPath);

    let targetFiles = projectFiles;
    if (relatedFiles.length > 0) {
      targetFiles = projectFiles.filter((f) =>
        relatedFiles.some((rf) => f.path === rf || f.path.endsWith("/" + rf) || f.path.endsWith(rf)),
      );

      if (targetFiles.length === 0 && projectFiles.length > 0) {
        verificationSteps.push({
          name: "File scan",
          passed: false,
          output: `relatedFiles specified but none found in project tree — cannot confirm fix`,
        });
        finalStatus = "verifying";
      }
    }

    if (targetFiles.length > 0 || relatedFiles.length === 0) {
      const patternStillPresent = checkPatternInFiles(rulePattern, targetFiles);
      verificationSteps.push({
        name: "Pattern check",
        passed: !patternStillPresent,
        output: patternStillPresent
          ? `Pattern still found in ${targetFiles.length > 0 ? "target" : "project"} files`
          : `Pattern no longer detected — fix confirmed`,
      });
      finalStatus = patternStillPresent ? "failed" : "completed";
    }
  } else if (relatedFiles.length > 0) {
    const { files: projectFiles } = await walkProject(project.rootPath);
    const projectFilePaths = new Set(projectFiles.map((f) => f.path));

    const fileChecks = relatedFiles.map((rf) => ({
      file: rf,
      present: projectFilePaths.has(rf) || [...projectFilePaths].some((p) => p.endsWith("/" + rf) || p.endsWith(rf)),
    }));

    const allPresent = fileChecks.every((c) => c.present);
    verificationSteps.push({
      name: "File existence check",
      passed: allPresent,
      output: fileChecks.map((c) => `${c.present ? "✓" : "✗"} ${c.file}`).join(", "),
    });
    finalStatus = allPresent ? "completed" : "failed";
  } else {
    verificationSteps.push({
      name: "Automated verification",
      passed: false,
      output: "No rule pattern or relatedFiles specified. Task queued for AI/human verification.",
    });
    finalStatus = "verifying";
  }

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

export default router;
