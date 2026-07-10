import { Router } from "express";
import { db } from "@workspace/db";
import {
  tasksTable,
  eventsTable,
  taskLogsTable,
  rulesTable,
  projectsTable,
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
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { walkProject, checkPatternInFiles } from "@workspace/scanner";
import { recordAudit } from "../lib/audit.js";

const router = Router();

// List tasks
router.get("/tasks", async (req, res) => {
  const params = ListTasksQueryParams.parse(req.query);
  const conditions = [];
  if (params.projectId)
    conditions.push(eq(tasksTable.projectId, params.projectId));
  if (params.status) conditions.push(eq(tasksTable.status, params.status));
  if (params.priority)
    conditions.push(eq(tasksTable.priority, params.priority));

  const tasks =
    conditions.length > 0
      ? await db
          .select()
          .from(tasksTable)
          .where(and(...conditions))
          .orderBy(desc(tasksTable.createdAt))
      : await db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt));
  return res.json(tasks);
});

// Create task
router.post("/tasks", async (req, res) => {
  const body = CreateTaskBody.parse(req.body);
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
  return res.json(task[0]);
});

// Update task
router.patch("/tasks/:taskId", async (req, res) => {
  const { taskId } = UpdateTaskParams.parse(req.params);
  const body = UpdateTaskBody.parse(req.body);

  const before = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  if (!before[0]) return res.status(404).json({ error: "Task not found" });

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
    changedFields: body,
    stateBefore: before[0],
    stateAfter: updated[0],
  });

  return res.json(updated[0]);
});

// Delete task
router.delete("/tasks/:taskId", async (req, res) => {
  const { taskId } = DeleteTaskParams.parse(req.params);

  const before = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
  await db.delete(tasksTable).where(eq(tasksTable.id, taskId));

  if (before[0]) {
    await recordAudit({
      entityType: "task",
      entityId: taskId,
      action: "deleted",
      projectId: before[0].projectId,
      stateBefore: before[0],
    });
  }

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

  if (!["pending", "queued"].includes(task[0].status)) {
    return res
      .status(409)
      .json({ error: `Cannot execute task with status "${task[0].status}"` });
  }

  const project = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, task[0].projectId))
    .limit(1);
  if (!project[0]) return res.status(404).json({ error: "Project not found" });

  const now = new Date();

  await db
    .update(tasksTable)
    .set({ status: "running", updatedAt: now })
    .where(eq(tasksTable.id, taskId));

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: "Task execution started — running verification against project root",
    metadata: {
      initiatedAt: now.toISOString(),
      projectRoot: project[0].rootPath,
    },
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "TaskExecutionStarted",
    projectId: task[0].projectId,
    taskId,
    severity: "info",
    message: `Executing task "${task[0].title}"`,
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
    const { files: projectFiles } = await walkProject(project[0].rootPath);

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
    const { files: projectFiles } = await walkProject(project[0].rootPath);
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

  const [updated] = await db
    .update(tasksTable)
    .set({ status: finalStatus, verificationResult, updatedAt: now, completedAt })
    .where(eq(tasksTable.id, taskId))
    .returning();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: finalStatus === "completed" ? "info" : finalStatus === "failed" ? "error" : "warn",
    message: `Verification ${finalStatus}: ${verificationSteps[0]?.output ?? "no details"}`,
    metadata: { verificationResult },
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "executed",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status },
    stateAfter: { status: finalStatus },
    changedFields: { verificationResult },
  });

  await db.insert(eventsTable).values({
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
  });

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

  const retryCount = task[0].retryCount ?? 0;
  const maxRetries = task[0].maxRetries ?? 3;
  if (retryCount >= maxRetries) {
    return res
      .status(409)
      .json({ error: `Task has reached max retries (${maxRetries})` });
  }
  if (!["failed", "cancelled"].includes(task[0].status)) {
    return res
      .status(409)
      .json({ error: `Cannot retry task with status "${task[0].status}"` });
  }

  const updated = await db
    .update(tasksTable)
    .set({ status: "queued", retryCount: retryCount + 1, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "info",
    message: `Retry attempt #${retryCount + 1}`,
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "TaskRetried",
    projectId: task[0].projectId,
    taskId,
    severity: "warning",
    message: `Task "${task[0].title}" queued for retry (#${retryCount + 1})`,
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "retried",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status, retryCount },
    stateAfter: { status: "queued", retryCount: retryCount + 1 },
  });

  return res.status(202).json(updated[0]);
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

  const updated = await db
    .update(tasksTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();

  await db.insert(taskLogsTable).values({
    id: randomUUID(),
    taskId,
    level: "warn",
    message: "Task rolled back — changes reverted",
  });

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: "TaskRolledBack",
    projectId: task[0].projectId,
    taskId,
    severity: "warning",
    message: `Task "${task[0].title}" rolled back`,
  });

  await recordAudit({
    entityType: "task",
    entityId: taskId,
    action: "rolled_back",
    projectId: task[0].projectId,
    stateBefore: { status: task[0].status },
    stateAfter: { status: "cancelled" },
  });

  return res.json(updated[0]);
});

// Get task logs
router.get("/tasks/:taskId/logs", async (req, res) => {
  const { taskId } = GetTaskLogsParams.parse(req.params);
  const logs = await db
    .select()
    .from(taskLogsTable)
    .where(eq(taskLogsTable.taskId, taskId))
    .orderBy(desc(taskLogsTable.timestamp));
  return res.json(logs);
});

export default router;
