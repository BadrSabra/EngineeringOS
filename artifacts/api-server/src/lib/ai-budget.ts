import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  aiProjectBudgetsTable,
  aiBudgetReservationsTable,
  aiUsageEventsTable,
  operatorAlertsTable,
  type AiProjectBudget,
} from "@workspace/db";
import { logger } from "./logger.js";

type BudgetExecutor = Pick<typeof db, "select" | "insert" | "update">;

export const AI_BUDGET_DEFAULT_ATTEMPT_LIMIT = 100;
export const AI_BUDGET_MIN_ATTEMPT_LIMIT = 1;
export const AI_BUDGET_MAX_ATTEMPT_LIMIT = 10_000;
export const AI_BUDGET_DEFAULT_TOKEN_LIMIT = 100_000;
export const AI_BUDGET_MIN_TOKEN_LIMIT = 1_000;
export const AI_BUDGET_MAX_TOKEN_LIMIT = 10_000_000;
export const AI_BUDGET_DEFAULT_WARNING_THRESHOLD = 0.8;
export const AI_BUDGET_MIN_WARNING_THRESHOLD = 0.5;
export const AI_BUDGET_MAX_WARNING_THRESHOLD = 0.99;

export type AiBudgetState = "normal" | "warning" | "exhausted";
export type AiBudgetUsageStatus = "known" | "partial" | "unknown";

export type AiBudgetInput = {
  dailyAttemptLimit: number;
  dailyTokenLimit: number;
  warningThreshold: number;
};

export class AiBudgetAdmissionError extends Error {
  readonly code = "AI_BUDGET_EXHAUSTED" as const;
  constructor() {
    super("The project's daily AI attempt budget is exhausted.");
    this.name = "AiBudgetAdmissionError";
  }
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function utcDayStart(day = utcDay()): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function validateAiBudgetInput(input: Partial<AiBudgetInput>): string | undefined {
  if (!Number.isSafeInteger(input.dailyAttemptLimit)
    || input.dailyAttemptLimit! < AI_BUDGET_MIN_ATTEMPT_LIMIT
    || input.dailyAttemptLimit! > AI_BUDGET_MAX_ATTEMPT_LIMIT) {
    return `dailyAttemptLimit must be an integer between ${AI_BUDGET_MIN_ATTEMPT_LIMIT} and ${AI_BUDGET_MAX_ATTEMPT_LIMIT}`;
  }
  if (!Number.isSafeInteger(input.dailyTokenLimit)
    || input.dailyTokenLimit! < AI_BUDGET_MIN_TOKEN_LIMIT
    || input.dailyTokenLimit! > AI_BUDGET_MAX_TOKEN_LIMIT) {
    return `dailyTokenLimit must be an integer between ${AI_BUDGET_MIN_TOKEN_LIMIT} and ${AI_BUDGET_MAX_TOKEN_LIMIT}`;
  }
  if (typeof input.warningThreshold !== "number"
    || !Number.isFinite(input.warningThreshold)
    || input.warningThreshold < AI_BUDGET_MIN_WARNING_THRESHOLD
    || input.warningThreshold > AI_BUDGET_MAX_WARNING_THRESHOLD) {
    return `warningThreshold must be between ${AI_BUDGET_MIN_WARNING_THRESHOLD} and ${AI_BUDGET_MAX_WARNING_THRESHOLD}`;
  }
  return undefined;
}

export function defaultAiBudgetInput(): AiBudgetInput {
  return {
    dailyAttemptLimit: AI_BUDGET_DEFAULT_ATTEMPT_LIMIT,
    dailyTokenLimit: AI_BUDGET_DEFAULT_TOKEN_LIMIT,
    warningThreshold: AI_BUDGET_DEFAULT_WARNING_THRESHOLD,
  };
}

async function loadOrCreateBudget(
  executor: BudgetExecutor,
  projectId: string,
  ownerId: string,
): Promise<AiProjectBudget> {
  const existing = await executor
    .select()
    .from(aiProjectBudgetsTable)
    .where(and(eq(aiProjectBudgetsTable.projectId, projectId), eq(aiProjectBudgetsTable.ownerId, ownerId)))
    .for("update");
  if (existing[0]) return existing[0];
  const now = new Date();
  const defaults = defaultAiBudgetInput();
  await executor.insert(aiProjectBudgetsTable).values({
    id: randomUUID(),
    schemaVersion: 1,
    projectId,
    ownerId,
    ...defaults,
    resetAt: new Date(utcDayStart().getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: aiProjectBudgetsTable.projectId });
  const created = await executor
    .select()
    .from(aiProjectBudgetsTable)
    .where(and(eq(aiProjectBudgetsTable.projectId, projectId), eq(aiProjectBudgetsTable.ownerId, ownerId)))
    .for("update");
  if (!created[0]) throw new Error("AI budget could not be initialized");
  return created[0];
}

async function usageForDay(executor: BudgetExecutor, projectId: string, day: string) {
  const since = utcDayStart(day);
  const [attempts, reservations, tokenUsage] = await Promise.all([
    executor.select({ value: count() }).from(aiUsageEventsTable).where(and(
      eq(aiUsageEventsTable.projectId, projectId),
      gte(aiUsageEventsTable.occurredAt, since),
    )),
    executor.select({ value: count() }).from(aiBudgetReservationsTable).where(and(
      eq(aiBudgetReservationsTable.projectId, projectId),
      eq(aiBudgetReservationsTable.utcDay, day),
      eq(aiBudgetReservationsTable.status, "reserved"),
    )),
    executor.select({
      prompt: sql<number>`coalesce(sum(${aiUsageEventsTable.promptTokens}), 0)`,
      completion: sql<number>`coalesce(sum(${aiUsageEventsTable.completionTokens}), 0)`,
      unknown: sql<number>`coalesce(sum(case when ${aiUsageEventsTable.usageStatus} = 'unknown' then 1 else 0 end), 0)`,
      partial: sql<number>`coalesce(sum(case when ${aiUsageEventsTable.usageStatus} = 'partial' then 1 else 0 end), 0)`,
    }).from(aiUsageEventsTable).where(and(
      eq(aiUsageEventsTable.projectId, projectId),
      gte(aiUsageEventsTable.occurredAt, since),
    )),
  ]);
  const consumed = Number(attempts[0]?.value ?? 0);
  const pending = Number(reservations[0]?.value ?? 0);
  const promptTokens = Number(tokenUsage[0]?.prompt ?? 0);
  const completionTokens = Number(tokenUsage[0]?.completion ?? 0);
  const unknownCount = Number(tokenUsage[0]?.unknown ?? 0);
  const partialCount = Number(tokenUsage[0]?.partial ?? 0);
  return {
    consumed,
    reserved: pending,
    projected: consumed + pending,
    promptTokens,
    completionTokens,
    tokenTotal: promptTokens + completionTokens,
    usageStatus: unknownCount > 0 ? "unknown" as const : partialCount > 0 ? "partial" as const : "known" as const,
  };
}

function stateFor(projected: number, limit: number, warningThreshold: number): AiBudgetState {
  if (projected >= limit) return "exhausted";
  if (projected / limit >= warningThreshold) return "warning";
  return "normal";
}

async function upsertBudgetAlert(
  budget: AiProjectBudget,
  state: AiBudgetState,
  now = new Date(),
): Promise<void> {
  const kind = state === "warning"
    ? "ai_budget_warning"
    : state === "exhausted"
      ? "ai_budget_exhausted"
      : "ai_budget_recovered";
  const fingerprint = `ai_budget:${budget.ownerId}:${budget.projectId}:${utcDay()}:${kind}`;
  if (state === "normal") {
    await db.update(operatorAlertsTable).set({ status: "resolved", resolvedAt: now })
      .where(and(
        eq(operatorAlertsTable.ownerId, budget.ownerId),
        eq(operatorAlertsTable.projectId, budget.projectId),
        sql`${operatorAlertsTable.kind} in ('ai_budget_warning', 'ai_budget_exhausted')`,
        inArray(operatorAlertsTable.status, ["open", "acknowledged"]),
      ));
    await db.insert(operatorAlertsTable).values({
      id: randomUUID(),
      fingerprint,
      kind: "ai_budget_recovered",
      status: "resolved",
      provider: "system",
      modelRole: "usage",
      modelId: "redacted",
      title: "AI project budget recovered",
      message: "This project's daily AI budget is available again after reset or reduced usage.",
      remediation: "No action is required.",
      occurrenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedAt: now,
      ownerId: budget.ownerId,
      projectId: budget.projectId,
      severity: "info",
    }).onConflictDoUpdate({
      target: operatorAlertsTable.fingerprint,
      set: { lastSeenAt: now, occurrenceCount: sql`${operatorAlertsTable.occurrenceCount} + 1`, resolvedAt: now },
    });
    return;
  }
  const title = state === "warning" ? "AI project budget warning" : "AI project budget exhausted";
  const message = state === "warning"
    ? "This project's daily AI attempt budget is approaching its limit."
    : "This project's daily AI attempt budget has been exhausted.";
  await db.insert(operatorAlertsTable).values({
    id: randomUUID(),
    fingerprint,
    kind,
    status: "open",
    provider: "system",
    modelRole: "usage",
    modelId: "redacted",
    title,
    message,
    remediation: state === "warning"
      ? "Review project AI usage or adjust the daily budget before it is exhausted."
      : "Wait for the next UTC reset or adjust this project's daily budget.",
    occurrenceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    ownerId: budget.ownerId,
    projectId: budget.projectId,
    severity: state === "warning" ? "warning" : "critical",
  }).onConflictDoUpdate({
    target: operatorAlertsTable.fingerprint,
    set: {
      status: "open",
      lastSeenAt: now,
      resolvedAt: null,
      occurrenceCount: sql`${operatorAlertsTable.occurrenceCount} + 1`,
      title,
      message,
    },
  });
}

export async function admitAiProviderAttempt(params: {
  ownerId: string;
  projectId: string;
  attemptId: string;
}): Promise<{ budget: AiProjectBudget; state: AiBudgetState; projected: number }> {
  const result = await db.transaction(async (tx) => {
    const budget = await loadOrCreateBudget(tx, params.projectId, params.ownerId);
    const existing = await tx.select()
      .from(aiBudgetReservationsTable)
      .where(and(
        eq(aiBudgetReservationsTable.attemptId, params.attemptId),
        eq(aiBudgetReservationsTable.projectId, params.projectId),
      ))
      .limit(1);
    if (existing[0]) {
      const usage = await usageForDay(tx, params.projectId, utcDay());
      return { budget, state: stateFor(usage.projected, budget.dailyAttemptLimit, budget.warningThreshold), projected: usage.projected };
    }
    const usage = await usageForDay(tx, params.projectId, utcDay());
    if (usage.projected >= budget.dailyAttemptLimit) {
      throw new AiBudgetAdmissionError();
    }
    await tx.insert(aiBudgetReservationsTable).values({
      id: randomUUID(),
      projectId: params.projectId,
      ownerId: params.ownerId,
      attemptId: params.attemptId,
      utcDay: utcDay(),
      status: "reserved",
    });
    return {
      budget,
      state: stateFor(usage.projected + 1, budget.dailyAttemptLimit, budget.warningThreshold),
      projected: usage.projected + 1,
    };
  });
  await upsertBudgetAlert(result.budget, result.state).catch((error) => {
    logger.warn({ error, projectId: params.projectId }, "AI budget alert update failed");
  });
  return result;
}

export async function getAiProjectBudgetSummary(params: { ownerId: string; projectId: string }) {
  const budget = await loadOrCreateBudget(db, params.projectId, params.ownerId);
  const usage = await usageForDay(db, params.projectId, utcDay());
  const state = stateFor(usage.projected, budget.dailyAttemptLimit, budget.warningThreshold);
  return {
    schemaVersion: budget.schemaVersion,
    projectId: budget.projectId,
    dailyAttemptLimit: budget.dailyAttemptLimit,
    dailyTokenLimit: budget.dailyTokenLimit,
    warningThreshold: budget.warningThreshold,
    resetAt: budget.resetAt.toISOString(),
    consumedAttempts: usage.consumed,
    reservedAttempts: usage.reserved,
    remainingAttempts: Math.max(0, budget.dailyAttemptLimit - usage.projected),
    state,
    tokenUsage: {
      promptTokens: usage.usageStatus === "unknown" ? null : usage.promptTokens,
      completionTokens: usage.usageStatus === "unknown" ? null : usage.completionTokens,
      total: usage.usageStatus === "unknown" ? null : usage.tokenTotal,
      status: usage.usageStatus,
      remaining: usage.usageStatus === "unknown" ? null : Math.max(0, budget.dailyTokenLimit - usage.tokenTotal),
    },
    updatedAt: budget.updatedAt.toISOString(),
  };
}

export async function updateAiProjectBudget(
  params: { ownerId: string; projectId: string } & AiBudgetInput,
) {
  const error = validateAiBudgetInput(params);
  if (error) throw new Error(error);
  const now = new Date();
  await db.insert(aiProjectBudgetsTable).values({
    id: randomUUID(),
    schemaVersion: 1,
    projectId: params.projectId,
    ownerId: params.ownerId,
    dailyAttemptLimit: params.dailyAttemptLimit,
    dailyTokenLimit: params.dailyTokenLimit,
    warningThreshold: params.warningThreshold,
    resetAt: new Date(utcDayStart().getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: aiProjectBudgetsTable.projectId,
    set: {
      dailyAttemptLimit: params.dailyAttemptLimit,
      dailyTokenLimit: params.dailyTokenLimit,
      warningThreshold: params.warningThreshold,
      updatedAt: now,
    },
  });
  return getAiProjectBudgetSummary(params);
}

export async function reconcileAiBudgetReservation(attemptId: string): Promise<void> {
  await db.update(aiBudgetReservationsTable)
    .set({ status: "consumed", reconciledAt: new Date() })
    .where(and(eq(aiBudgetReservationsTable.attemptId, attemptId), isNull(aiBudgetReservationsTable.reconciledAt)));
}