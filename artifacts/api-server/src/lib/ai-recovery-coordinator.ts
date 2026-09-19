import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
import {
  hasAiExecutionResumeContract,
  parseExecutionRequest,
} from "./ai-execution-state.js";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import { executeTaskLifecycle } from "./task-execution-service.js";
import {
  runChatRecoveryExhaustionFinalization,
  runChatExecutionRecovery,
} from "./chat-recovery-runner.js";

const RECOVERY_ACTIONS = [
  "RESUME_ALLOWED",
  "RETRY_AFTER_TIMEOUT",
  "RETRY_AFTER_RATE_LIMIT",
] as const;

const RECOVERY_TASK_STATUSES = ["pending", "queued", "verifying"] as const;
const RECOVERY_EXECUTION_STATUSES = ["paused", "failed"] as const;
const MAX_RECOVERY_CANDIDATES = 64;
const MAX_AUTOMATIC_CHAT_PARSER_RECOVERY_ATTEMPTS = 2;
const MAX_AUTOMATIC_CHAT_PROVIDER_RECOVERY_ATTEMPTS = 3;

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

export type ChatRecoveryCandidate = {
  executionId: string;
  executionProjectId: string;
  executionStatus: string;
  executionAttempt: number;
  userId: string;
  action: string;
  reasonCode: string | null;
  resumable: number;
  disposition: unknown;
  sourceRevision: string | null;
  /**
   * The current project revision when the persistence layer can provide one.
   * `projects.updatedAt` is not a workspace revision; callers that cannot
   * compute the current root revision must leave this unset and let the
   * recovery handler perform its authoritative provenance check.
   */
  projectRevision?: string | null;
  request: string;
};

export type ChatRecoveryPlan =
  | {
    kind: "resume" | "retry";
    action: "RESUME_ALLOWED" | "RETRY_AFTER_TIMEOUT" | "RETRY_AFTER_RATE_LIMIT";
    executionId: string;
    executionAttempt: number;
    delayMs: number;
    queueKey: string;
  }
  | {
    kind: "skip";
    reason:
      | "invalid_scope"
      | "execution_not_recoverable"
      | "resume_not_authorized"
      | "revision_changed"
      | "retry_not_due"
       | "not_a_resumable_turn"
       | "automatic_recovery_exhausted";
  };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asDisposition(value: unknown): RecoveryDisposition {
  return asRecord(value) as RecoveryDisposition;
}

function parseRetryAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function calculateRecoveryRetryAt(
  retryAfterSec: number | undefined,
  nowMs = Date.now(),
): string | undefined {
  if (!Number.isFinite(retryAfterSec)) return undefined;
  const delayMs = Math.max(1, Math.ceil(retryAfterSec as number)) * 1_000;
  return new Date(nowMs + delayMs).toISOString();
}

/**
 * Rate-limit deferrals must be durable. Without this marker, the 10-second
 * dispatcher sees the same FAILED/REQUIRED acceptance on every tick and keeps
 * spending a database rate-limit check on work that cannot yet start.
 */
async function deferRecoveryForRateLimit(params: {
  executionId: string;
  executionAttempt: number;
  action: string;
  retryAfterSec?: number;
}): Promise<void> {
  const retryAt = calculateRecoveryRetryAt(params.retryAfterSec);
  if (!retryAt) return;

  try {
    await db.transaction(async (tx) => {
      const [acceptance] = await tx
        .select({
          id: aiExecutionAcceptancesTable.id,
          outcome: aiExecutionAcceptancesTable.outcome,
          nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
          disposition: aiExecutionAcceptancesTable.disposition,
        })
        .from(aiExecutionAcceptancesTable)
        .where(and(
          eq(aiExecutionAcceptancesTable.executionId, params.executionId),
          eq(aiExecutionAcceptancesTable.attempt, params.executionAttempt),
        ))
        .for("update");

      if (
        !acceptance
        || acceptance.outcome !== "FAILED"
        || acceptance.nextActionCode !== params.action
      ) {
        return;
      }

      await tx
        .update(aiExecutionAcceptancesTable)
        .set({
          disposition: {
            ...asRecord(acceptance.disposition),
            retryAt,
            retryAfterMs: Math.max(1, Math.ceil(params.retryAfterSec as number)) * 1_000,
            retryAfterSource: "project_rate_limit",
          },
        })
        .where(eq(aiExecutionAcceptancesTable.id, acceptance.id));
    });
  } catch (error) {
    logger.warn(
      { error, executionId: params.executionId },
      "automatic recovery rate-limit backoff could not be persisted",
    );
  }
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

export function planChatRecovery(
  candidate: ChatRecoveryCandidate,
  nowMs = Date.now(),
): ChatRecoveryPlan {
  const request = parseExecutionRequest(candidate.request);
  const parserFailureRecovery =
    request?.turnIntent === "CHAT"
    && candidate.reasonCode === "MODEL_OUTPUT_INVALID"
    && candidate.action === "RESUME_ALLOWED"
    && candidate.resumable === 1;
  const transientProviderRecovery =
    request?.turnIntent === "CHAT"
    && candidate.reasonCode === "EXECUTION_PROVIDER_FAILURE"
    && (candidate.action === "RETRY_AFTER_TIMEOUT"
      || candidate.action === "RETRY_AFTER_RATE_LIMIT")
    && candidate.resumable === 0;
  const evidenceProviderRecovery =
    request?.turnIntent !== undefined
    && request.turnIntent !== "CHAT"
    && request.proofRequired === true
    && candidate.reasonCode === "EXECUTION_PROVIDER_FAILURE"
    && (candidate.action === "RESUME_ALLOWED"
      || candidate.action === "RETRY_AFTER_TIMEOUT"
      || candidate.action === "RETRY_AFTER_RATE_LIMIT");
  // Ordinary CHAT gets small, explicit recovery budgets. Parser failures stop
  // sooner because repeating the same malformed response is unlikely to help;
  // transient provider failures get one extra bounded attempt because the
  // external outage/rate limit may clear without changing the user turn.
  const recoveryAttemptLimit = transientProviderRecovery
    ? MAX_AUTOMATIC_CHAT_PROVIDER_RECOVERY_ATTEMPTS
    : evidenceProviderRecovery
      ? MAX_AUTOMATIC_CHAT_PROVIDER_RECOVERY_ATTEMPTS
      : MAX_AUTOMATIC_CHAT_PARSER_RECOVERY_ATTEMPTS;
  const automaticRecoveryExhausted =
    (parserFailureRecovery || transientProviderRecovery || evidenceProviderRecovery)
    && candidate.executionAttempt >= recoveryAttemptLimit;
  const boundedChatRecovery =
    (parserFailureRecovery || transientProviderRecovery)
    && candidate.executionAttempt < recoveryAttemptLimit;
  if (
    !request
    || request.projectId !== candidate.executionProjectId
    || !candidate.userId
    || !request.sessionId
    || (!boundedChatRecovery
      && !hasAiExecutionResumeContract(request)
      && !automaticRecoveryExhausted)
  ) {
    return { kind: "skip", reason: "not_a_resumable_turn" };
  }
  if (request.workspaceRevision && candidate.projectRevision
    && request.workspaceRevision !== candidate.projectRevision) {
    return { kind: "skip", reason: "revision_changed" };
  }
  if (!["paused", "failed"].includes(candidate.executionStatus)) {
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
  if (automaticRecoveryExhausted) {
    return { kind: "skip", reason: "automatic_recovery_exhausted" };
  }
  if (candidate.action === "RESUME_ALLOWED") {
    if (candidate.resumable !== 1) {
      return { kind: "skip", reason: "resume_not_authorized" };
    }
    return {
      kind: "resume",
      action: "RESUME_ALLOWED",
      executionId: candidate.executionId,
      executionAttempt: candidate.executionAttempt,
      delayMs: 0,
      queueKey: `ai-recovery:chat:${candidate.executionId}:${candidate.executionAttempt}:resume`,
    };
  }
  if (
    (candidate.action !== "RETRY_AFTER_TIMEOUT"
      && candidate.action !== "RETRY_AFTER_RATE_LIMIT")
    || candidate.resumable !== 0
  ) {
    return { kind: "skip", reason: "resume_not_authorized" };
  }
  return {
    kind: "retry",
    action: candidate.action,
    executionId: candidate.executionId,
    executionAttempt: candidate.executionAttempt,
    delayMs: 0,
    queueKey: `ai-recovery:chat:${candidate.executionId}:${candidate.executionAttempt}:retry`,
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
      eq(aiExecutionAcceptancesTable.attempt, aiExecutionsTable.attempt),
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

async function findChatRecoveryCandidates(): Promise<ChatRecoveryCandidate[]> {
  const rows = await db
    .select({
      executionId: aiExecutionsTable.id,
      executionProjectId: aiExecutionsTable.projectId,
      executionStatus: aiExecutionsTable.status,
      executionAttempt: aiExecutionsTable.attempt,
      userId: aiExecutionsTable.userId,
      action: aiExecutionAcceptancesTable.nextActionCode,
      reasonCode: aiExecutionAcceptancesTable.reasonCode,
      resumable: aiExecutionAcceptancesTable.resumable,
      disposition: aiExecutionAcceptancesTable.disposition,
      sourceRevision: aiExecutionAcceptancesTable.sourceRevision,
      request: aiExecutionsTable.request,
    })
    .from(aiExecutionAcceptancesTable)
    .innerJoin(
      aiExecutionsTable,
      eq(aiExecutionAcceptancesTable.executionId, aiExecutionsTable.id),
    )
    .innerJoin(
      projectsTable,
      eq(projectsTable.id, aiExecutionsTable.projectId),
    )
    .where(and(
      eq(aiExecutionAcceptancesTable.attempt, aiExecutionsTable.attempt),
      inArray(aiExecutionAcceptancesTable.nextActionCode, [
        "RESUME_ALLOWED",
        "RETRY_AFTER_TIMEOUT",
        "RETRY_AFTER_RATE_LIMIT",
      ]),
      eq(aiExecutionAcceptancesTable.outcome, "FAILED"),
      isNull(aiExecutionsTable.linkedTaskId),
      inArray(aiExecutionsTable.status, [...RECOVERY_EXECUTION_STATUSES]),
    ))
    .orderBy(desc(aiExecutionAcceptancesTable.createdAt))
    .limit(MAX_RECOVERY_CANDIDATES);

  return rows.map((row) => ({
    ...row,
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
    await deferRecoveryForRateLimit({
      executionId: candidate.executionId,
      executionAttempt: candidate.executionAttempt,
      action: candidate.action,
      retryAfterSec: rateLimit.retryAfterSec,
    });
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

async function runChatRecovery(
  candidate: ChatRecoveryCandidate,
  plan: Extract<ChatRecoveryPlan, { kind: "resume" | "retry" }>,
): Promise<void> {
  const resolved = await resolveProvider(candidate.userId, {
    qualityProfile: "analysis",
  });
  if (!resolved) {
    logger.warn(
      { executionId: candidate.executionId },
      "automatic chat recovery deferred: no AI provider is available",
    );
    return;
  }
  const rateLimit = await checkProjectRateLimitDb(candidate.executionProjectId);
  if (!rateLimit.allowed) {
    await deferRecoveryForRateLimit({
      executionId: candidate.executionId,
      executionAttempt: candidate.executionAttempt,
      action: candidate.action,
      retryAfterSec: rateLimit.retryAfterSec,
    });
    logger.warn(
      { executionId: candidate.executionId, retryAfterSec: rateLimit.retryAfterSec },
      "automatic chat recovery deferred by project rate limit",
    );
    return;
  }
  const result = await runChatExecutionRecovery({
    executionId: candidate.executionId,
    userId: candidate.userId,
    mode: plan.kind,
  });
  if (!result.ok) {
    logger.warn(
      { executionId: candidate.executionId, reason: result.reason, statusCode: result.statusCode },
      "automatic chat recovery did not complete",
    );
  }
}

/**
 * Dispatch acceptance-authorized task recovery. The database acceptance is
 * the source of truth; the in-memory queue only limits local concurrency.
 */
export async function dispatchAutonomousTaskRecoveries(): Promise<number> {
  let dispatched = 0;
  try {
    const [rows, chatRows] = await Promise.all([
      findRecoveryCandidates(),
      findChatRecoveryCandidates(),
    ]);
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
    const seenExecutions = new Set<string>();
    for (const candidate of chatRows) {
      if (seenExecutions.has(candidate.executionId)) continue;
      seenExecutions.add(candidate.executionId);
      const plan = planChatRecovery(candidate);
      if (plan.kind === "skip") {
        if (plan.reason === "automatic_recovery_exhausted") {
          const queueKey = `ai-recovery:chat:${candidate.executionId}:${candidate.executionAttempt}:recovery-finalize`;
          if (heavyJobQueue.enqueueWithId(queueKey, async () => {
            try {
              const result = await runChatRecoveryExhaustionFinalization({
                executionId: candidate.executionId,
                userId: candidate.userId,
              });
              if (!result.ok) {
                logger.warn(
                  {
                    executionId: candidate.executionId,
                    reason: result.reason,
                    readCount: result.readCount,
                  },
                  "automatic evidence recovery finalization did not complete",
                );
              }
            } catch (error) {
              logger.error(
                { error, executionId: candidate.executionId },
                "automatic evidence recovery finalization failed",
              );
            }
          })) {
            dispatched++;
          }
        }
        continue;
      }
      if (heavyJobQueue.enqueueWithId(plan.queueKey, async () => {
        try {
          await runChatRecovery(candidate, plan);
        } catch (error) {
          logger.error(
            { error, executionId: candidate.executionId },
            "automatic chat recovery failed outside handler",
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