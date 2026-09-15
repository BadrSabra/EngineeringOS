import { and, eq, max } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aiExecutionAcceptancesTable,
  db,
  taskLogsTable,
  tasksTable,
} from "@workspace/db";
import { redactUserFacingText } from "./ai-route-helpers.js";

export const TASK_PROGRESS_STAGES = [
  "acquisition",
  "context",
  "model",
  "attempt",
  "analysis",
  "verification",
  "finalization",
  "result",
] as const;

export type TaskProgressStage = typeof TASK_PROGRESS_STAGES[number];
export type TaskProgressStatus = "pending" | "active" | "completed" | "blocked" | "failed" | "cancelled";

type ProgressInput = {
  stage: TaskProgressStage;
  status: TaskProgressStatus;
  message: string;
  percent?: number;
  stepIndex?: number;
  stepCount?: number;
  terminalOutcome?: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
};

type ProgressEvent = typeof taskLogsTable.$inferSelect;

const MAX_MESSAGE_LENGTH = 240;

function safeProgressMessage(message: string): string {
  return redactUserFacingText(message)
    .replace(/\/(?:home\/runner|workspace|tmp)\/[^\s"'<>),;]+/g, "[project path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function boundedPercent(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Creates the only progress writer used by a task execution. Every write is
 * serialized, ownership checked, and persisted before the SSE route can see it.
 * A terminal event is allowed after finalization only when the matching
 * server-owned acceptance row already exists.
 */
export function createTaskProgressEmitter(params: {
  taskId: string;
  executionId: string;
  attempt: number;
  workerId: string;
  correlationId: string;
  trigger: "manual" | "automatic" | "reconciliation";
}) {
  const stageStarts = new Map<TaskProgressStage, Date>();
  let writeChain = Promise.resolve<ProgressEvent | null>(null);

  const emit = (input: ProgressInput): Promise<ProgressEvent | null> => {
    const operation = writeChain.then(async () => db.transaction(async (tx) => {
      const message = safeProgressMessage(input.message);
      if (!message) return null;

      const [task] = await tx
        .select({ workerId: tasksTable.workerId, status: tasksTable.status })
        .from(tasksTable)
        .where(eq(tasksTable.id, params.taskId))
        .for("update")
        .limit(1);
      const ownsTask = task?.workerId === params.workerId && task.status === "running";
      let acceptance: { id: string; outcome: string } | undefined;
      if (input.terminalOutcome) {
        const [existingTerminal] = await tx
          .select()
          .from(taskLogsTable)
          .where(and(
            eq(taskLogsTable.taskId, params.taskId),
            eq(taskLogsTable.executionId, params.executionId),
            eq(taskLogsTable.attempt, params.attempt),
            eq(taskLogsTable.eventType, "terminal"),
          ))
          .limit(1);
        if (existingTerminal) return existingTerminal;
        const [row] = await tx
          .select({
            id: aiExecutionAcceptancesTable.id,
            outcome: aiExecutionAcceptancesTable.outcome,
          })
          .from(aiExecutionAcceptancesTable)
          .where(and(
            eq(aiExecutionAcceptancesTable.executionId, params.executionId),
            eq(aiExecutionAcceptancesTable.attempt, params.attempt),
          ))
          .limit(1);
        if (!row || row.outcome !== input.terminalOutcome) return null;
        acceptance = row;
      }
      if (!ownsTask && !acceptance) return null;

      const [last] = await tx
        .select({ sequence: max(taskLogsTable.sequence) })
        .from(taskLogsTable)
          .where(eq(taskLogsTable.taskId, params.taskId));
      const sequence = (last?.sequence ?? 0) + 1;
      const now = new Date();
      const startedAt = stageStarts.get(input.stage) ?? now;
      const finishedAt = input.status === "active" ? null : now;
      if (input.status === "active") stageStarts.set(input.stage, startedAt);
      const [row] = await tx.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: params.taskId,
        level: input.status === "failed" || input.status === "cancelled"
          ? "error"
          : input.status === "blocked"
            ? "warn"
            : "info",
        message,
        metadata: {
          trigger: params.trigger,
          stepIndex: input.stepIndex ?? null,
          stepCount: input.stepCount ?? null,
        },
        correlationId: params.correlationId,
        eventType: input.terminalOutcome ? "terminal" : "progress",
        executionId: params.executionId,
        attempt: params.attempt,
        sequence,
        progressStage: input.stage,
        progressStatus: input.status,
        progressPercent: boundedPercent(input.percent),
        progressMessage: message,
        startedAt,
        finishedAt,
        terminalOutcome: input.terminalOutcome ?? null,
      }).returning();
      return row;
    }));
    writeChain = operation.catch(() => null);
    return operation;
  };

  const start = (stage: TaskProgressStage, message: string, percent?: number, stepIndex?: number) => {
    stageStarts.set(stage, new Date());
    return emit({
      stage,
      status: "active",
      message,
      percent,
      stepIndex,
      stepCount: TASK_PROGRESS_STAGES.length,
    });
  };

  const finish = (stage: TaskProgressStage, status: Exclude<TaskProgressStatus, "pending" | "active">, message: string, percent?: number, stepIndex?: number) =>
    emit({
      stage,
      status,
      message,
      percent,
      stepIndex,
      stepCount: TASK_PROGRESS_STAGES.length,
    });

  const terminal = (outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED", message: string, percent = 100) =>
    emit({
      stage: "result",
      status: outcome === "SUCCEEDED" ? "completed" : outcome === "INTERRUPTED" ? "cancelled" : "failed",
      message,
      percent,
      stepIndex: TASK_PROGRESS_STAGES.length,
      stepCount: TASK_PROGRESS_STAGES.length,
      terminalOutcome: outcome,
    });

  return { emit, start, finish, terminal };
}