import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  projectsTable,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { resolveProvider } from "./ai-route-helpers.js";
import { checkProjectRateLimitDb } from "./db-rate-limiter.js";
import { recoverAiExecutionResumeToken } from "./ai-execution-state.js";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import { executeTaskLifecycle } from "./task-execution-service.js";

const RECOVERY_ACTIONS = [
  "RESUME_ALLOWED",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;

const RECOVERY_TASK_STATUSES = ["pending", "queued", "verifying"] as const;
const RECOVERY_EXECUTION_STATUSES = ["paused", "failed"] as const;
const MAX_RECOVERY_CANDIDATES = 64;

type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];
type RecoveryTaskStatus = (typeof RECOVERY_TASK_STATUSES)[number];

type RecoveryDisposition = {
  recoveryState?: unknown;
  retryAt?: unknown;
};

export type TaskRecoveryCandidate = {
  taskId: string;
  taskProjectId: string;
  taskStatus: string;
  prompt: string | null;
  retryCount: number;
  maxRetries: number;
  executionId: string;
  executionProjectId: string;
  executionLinkedTaskId: string | null;
  executionStatus: string;
  executionAttempt: number;
  userId: string;
  action: string;
  resumable: number;
  disposition: unknown;
  sourceRevision: string | null;
  projectRevision: string | null;
};

export type TaskRecoveryPlan =
  | {
    kind: "resume" | "retry";
    action: RecoveryAction;
    taskId: string;
    executionId: string;
    executionAttempt: number;
    expectedRetryCount: number;
    delayMs: number;
    queueKey: string;
  }
  | {
    kind: "skip";
    reason:
      | "invalid_scope"
      | "task_not_eligible"
      | "missing_prompt"
      | "budget_exhausted"
      | "resume_not_authorized"
      | "execution_not_recoverable"
      | "revision_changed"
      | "retry_not_due"
      | "unknown_action";
  };

function asDisposition(value: unknown): RecoveryDisposition {
  return value && typeof value === "object" ? value as RecoveryDisposition : {};
}

function parseRetryAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Pure admission gate for automatic task recovery.
 *
 * The planner intentionally knows nothing about provider output. It only
 * accepts a server-owned acceptance decision that is still bound to the same
 * task, project, execution, revision, and retry budget.
 */
export function planTaskRecovery(
  candidate: TaskRecoveryCandidate,
  nowMs = Date.now(),
): TaskRecoveryPlan {
  if (
    candidate.executionProjectId !== candidate.taskProjectId
    || candidate.executionLinkedTaskId !== candidate.taskId
    || !candidate.userId
  ) {
    return { kind: "skip", reason: "invalid_scope" };
  }

  if (!RECOVERY_TASK_STATUSES.includes(candidate.taskStatus as RecoveryTaskStatus)) {
    return { kind: "skip", reason: "task_not_eligible" };
  }

  if (!candidate.prompt?.trim()) {
    return { kind: "skip", reason: "missing_prompt" };
  }

  if (candidate.retryCount >= candidate.maxRetries) {
    return { kind: "skip", reason: "budget_exhausted" };
  }

  if (!RECOVERY_ACTIONS.includes(candidate.action as RecoveryAction)) {
    return { kind: "skip", reason: "unknown_action" };
  }

  const action = candidate.action as RecoveryAction;
  if (!RECOVERY_EXECUTION_STATUSES.includes(candidate.executionStatus as "paused" | "failed")) {
    return { kind: "skip", reason: "execution_not_recoverable" };
  }

  const disposition = asDisposition(candidate.disposition);
  if (disposition.recoveryState !== "REQUIRED") {
    return { kind: "skip", reason: "resume_not_authorized" };
  }

  const retryAtMs = parseRetryAt(disposition.retryAt);
  if (retryAtMs !== undefined && retryAtMs > nowMs) {
    return { kind: "skip", reason: "retry_not_due" };
  }

  if (action === "RESUME_ALLOWED") {
    if (candidate.resumable !== 1) {
      return { kind: "skip", reason: "resume_not_authorized" };
    }
    if (
      candidate.sourceRevision
      && candidate.projectRevision
      && candidate.sourceRevision !== candidate.projectRevision
    ) {
      return { kind: "skip", reason: "revision_changed" };
    }
    return {
      kind: "resume",
      action,
      taskId: candidate.taskId,
      executionId: candidate.executionId,
      executionAttempt: candidate.executionAttempt,
      expectedRetryCount: candidate.retryCount,
      delayMs: 0,
      queueKey: `ai-recovery:${candidate.taskId}:${candidate.executionId}:${candidate.executionAttempt}:resume`,
    };
  }

  return {
    kind: "retry",
    action,
    taskId: candidate.taskId,
    executionId: candidate.executionId,
    executionAttempt: candidate.executionAttempt,
    expectedRetryCount: candidate.retryCount,
    delayMs: 0,
    queueKey: `ai-recovery:${candidate.taskId}:${candidate.executionId}:${candidate.executionAttempt}:retry:${candidate.retryCount}`,
  };
}

type RecoveryRow = TaskRecoveryCandidate & {
  acceptanceCreatedAt: Date;
};

async function findRecoveryCandidates(): Promise<RecoveryRow[]> {
  const rows = await db
    .select({
      taskId: tasksTable.id,
      taskProjectId: tasksTable.projectId,
      taskStatus: tasksTable.status,
      prompt: tasksTable.prompt,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
      executionId: aiExecutionsTable.id,
      executionProjectId: aiExecutionsTable.projectId,
      executionLinkedTaskId: aiExecutionsTable.linkedTaskId,
      executionStatus: aiExecutionsTable.status,
      executionAttempt: aiExecutionsTable.attempt,
      userId: aiExecutionsTable.userId,
      action: aiExecutionAcceptancesTable.nextActionCode,
      resumable: aiExecutionAcceptancesTable.resumable,
      disposition: aiExecutionAcceptancesTable.disposition,
      sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
      projectRevision: projectsTable.updatedAt,
      acceptanceCreatedAt: aiExecutionAcceptancesTable.createdAt,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(
      aiExecutionsTable,
      eq(aiExecutionAcceptancesTable.executionId, aiExecutionsTable.id),
    )
    .innerJoin(tasksTable, eq(tasksTable.id, aiExecutionsTable.linkedTaskId))
    .innerJoin(projectsTable, eq(projectsTable.id, tasksTable.projectId))
    .where(and(
      inArray(aiExecutionAcceptancesTable.nextActionCode, [...RECOVERY_ACTIONS]),
      eq(aiExecutionAcceptancesTable.outcome, "FAILED"),
      inArray(aiExecutionsTable.status, [...RECOVERY_EXECUTION_STATUSES]),
      inArray(tasksTable.status, [...RECOVERY_TASK_STATUSES]),
    ))
    .orderBy(desc(aiExecutionAcceptancesTable.createdAt))
    .limit(MAX_RECOVERY_CANDIDATES);

  return rows.map((row) => ({
    ...row,
    projectRevision: row.projectRevision?.toISOString() ?? null,
  }));
}

async function writeRecoveryLog(
  candidate: TaskRecoveryCandidate,
  message: string,
  level: "info" | "warn" | "error",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(taskLogsTable).values({
      id: randomUUID(),
      taskId: candidate.taskId,
      level,
      message,
      correlationId: `ai-recovery:${candidate.executionId}`,
      metadata: { ...metadata, executionId: candidate.executionId, action: candidate.action },
    });
  } catch (error) {
    logger.warn({ error, taskId: candidate.taskId }, "AI recovery log write failed");
  }
}

async function runRecovery(candidate: TaskRecoveryCandidate, plan: Extract<TaskRecoveryPlan, { kind: "resume" | "retry" }>): Promise<void> {
  const resolved = await resolveProvider(candidate.userId, { qualityProfile: "task_execution" });
  if (!resolved) {
    await writeRecoveryLog(candidate, "Automatic recovery deferred: no AI provider is available.", "warn", {
      reason: "no_provider",
    });
    return;
  }

  const rateLimit = await checkProjectRateLimitDb(candidate.taskProjectId);
  if (!rateLimit.allowed) {
    await writeRecoveryLog(candidate, "Automatic recovery deferred by the project rate limit.", "warn", {
      reason: "project_rate_limit",
      retryAfterSec: rateLimit.retryAfterSec,
    });
    return;
  }

  if (plan.kind === "resume") {
    const recovered = await recoverAiExecutionResumeToken({
      executionId: candidate.executionId,
      userId: candidate.userId,
      linkedTaskId: candidate.taskId,
      expectedAttempt: candidate.executionAttempt,
    });
    if (!recovered) {
      await writeRecoveryLog(candidate, "Automatic resume lost its atomic claim to another worker.", "info", {
        reason: "resume_claim_conflict",
      });
      return;
    }

    const lifecycle = await executeTaskLifecycle({
      taskId: candidate.taskId,
      userId: candidate.userId,
      provider: { provider: resolved.provider, apiKey: resolved.apiKey },
      trigger: "reconciliation",
      expectedStatuses: [...RECOVERY_TASK_STATUSES],
      workspaceRevision: candidate.projectRevision ?? undefined,
      resumeExecutionId: candidate.executionId,
      resumeToken: recovered.resumeToken,
    });
    if (!lifecycle.ok && lifecycle.status !== "conflict") {
      logger.warn({ taskId: candidate.taskId, executionId: candidate.executionId, code: lifecycle.errorCode }, "automatic AI resume did not complete");
    }
    return;
  }

  // A new retry must advance the task-owned budget before creating the next
  // execution. The expected retry count is the cross-process idempotency fence.
  const [claimed] = await db
    .update(tasksTable)
    .set({ retryCount: candidate.retryCount + 1, updatedAt: new Date() })
    .where(and(
      eq(tasksTable.id, candidate.taskId),
      eq(tasksTable.projectId, candidate.taskProjectId),
      eq(tasksTable.status, candidate.taskStatus as "pending" | "queued" | "verifying"),
      eq(tasksTable.retryCount, candidate.retryCount),
    ))
    .returning({ id: tasksTable.id });
  if (!claimed) {
    await writeRecoveryLog(candidate, "Automatic retry lost its atomic budget claim to another worker.", "info", {
      reason: "retry_claim_conflict",
    });
    return;
  }

  const lifecycle = await executeTaskLifecycle({
    taskId: candidate.taskId,
    userId: candidate.userId,
    provider: { provider: resolved.provider, apiKey: resolved.apiKey },
    trigger: "reconciliation",
    expectedStatuses: [...RECOVERY_TASK_STATUSES],
    workspaceRevision: candidate.projectRevision ?? undefined,
  });
  if (!lifecycle.ok && lifecycle.status !== "conflict") {
    logger.warn({ taskId: candidate.taskId, executionId: lifecycle.executionId, code: lifecycle.errorCode }, "automatic AI retry did not complete");
  }
}

/**
 * Dispatch acceptance-authorized task recovery. The database acceptance is
 * the source of truth; the in-memory queue only limits local concurrency.
 */
export async function dispatchAutonomousTaskRecoveries(): Promise<number> {
  let dispatched = 0;
  try {
    const rows = await findRecoveryCandidates();
    const seenTasks = new Set<string>();
    for (const candidate of rows) {
      if (seenTasks.has(candidate.taskId)) continue;
      seenTasks.add(candidate.taskId);
      const plan = planTaskRecovery(candidate);
      if (plan.kind === "skip") continue;
      if (heavyJobQueue.enqueueWithId(plan.queueKey, async () => {
        try {
          await runRecovery(candidate, plan);
        } catch (error) {
          logger.error(
            { error, taskId: candidate.taskId, executionId: candidate.executionId, action: candidate.action },
            "automatic AI recovery failed outside lifecycle handling",
          );
        }
      })) {
        dispatched++;
      }
    }
  } catch (error) {
    logger.error({ error, scope: "ai-recovery-coordinator" }, "automatic AI recovery dispatch failed");
  }
  return dispatched;
}