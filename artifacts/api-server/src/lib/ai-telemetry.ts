import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, aiUsageEventsTable, operatorAlertsTable } from "@workspace/db";
import type { ProviderId } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";

export const AI_USAGE_RETENTION_DAYS = 90;
export const AI_USAGE_DEFAULT_WINDOW_DAYS = 30;
export const AI_USAGE_MAX_WINDOW_DAYS = 90;
export const AI_USAGE_DAILY_ATTEMPT_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.AI_USAGE_DAILY_ATTEMPT_LIMIT ?? "1000", 10) || 1000,
);

export type AiTelemetryContext = {
  projectId?: string | null;
  userId: string;
  executionId?: string | null;
  operationId?: string | null;
  correlationId: string;
};

export type AiTelemetryAttempt = {
  attemptId?: string;
  provider: ProviderId;
  model?: string | null;
  outcome: "success" | "failure" | "cancelled";
  latencyMs?: number | null;
  fallbackCount?: number;
  attemptNumber?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  usageStatus?: "known" | "partial" | "unknown";
};

function boundedInteger(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : null;
}

function safeText(value: string | null | undefined, max = 240): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Best-effort durable write. Telemetry must never turn a successful AI
 * response into a failed response if the database is temporarily unavailable.
 */
export async function recordAiUsageAttempt(
  context: AiTelemetryContext,
  attempt: AiTelemetryAttempt,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AI_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const promptTokens = boundedInteger(attempt.promptTokens);
  const completionTokens = boundedInteger(attempt.completionTokens);
  const usageStatus = attempt.usageStatus
    ?? (promptTokens !== null && completionTokens !== null ? "known" : "unknown");
  const attemptId = safeText(attempt.attemptId, 200) ?? randomUUID();
  try {
    await db.insert(aiUsageEventsTable).values({
      id: randomUUID(),
      schemaVersion: 1,
      projectId: safeText(context.projectId, 160),
      userId: context.userId.slice(0, 160),
      executionId: safeText(context.executionId, 160),
      operationId: safeText(context.operationId, 160),
      correlationId: context.correlationId.slice(0, 200),
      attemptId,
      provider: attempt.provider,
      model: safeText(attempt.model),
      outcome: attempt.outcome,
      latencyMs: boundedInteger(attempt.latencyMs),
      fallbackCount: Math.max(0, Math.min(32, Math.floor(attempt.fallbackCount ?? 0))),
      attemptNumber: Math.max(1, Math.min(32, Math.floor(attempt.attemptNumber ?? 1))),
      promptTokens,
      completionTokens,
      usageStatus,
      occurredAt: now,
      expiresAt,
    }).onConflictDoNothing({ target: aiUsageEventsTable.attemptId });
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const daily = await db.select({ count: sql<number>`count(*)` })
      .from(aiUsageEventsTable)
      .where(and(eq(aiUsageEventsTable.userId, context.userId), gte(aiUsageEventsTable.occurredAt, dayStart)));
    if (Number(daily[0]?.count ?? 0) >= AI_USAGE_DAILY_ATTEMPT_LIMIT) {
      const fingerprint = `ai_usage_quota_exceeded:user:${context.userId}`;
      await db.insert(operatorAlertsTable).values({
        id: randomUUID(),
        fingerprint,
        kind: "ai_usage_quota_exceeded",
        status: "open",
        provider: attempt.provider,
        modelRole: "usage",
        modelId: "redacted",
        title: "AI daily attempt limit reached",
        message: "An authenticated user reached the configured daily AI attempt limit.",
        remediation: "Review usage history or raise AI_USAGE_DAILY_ATTEMPT_LIMIT deliberately.",
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      }).onConflictDoUpdate({
        target: operatorAlertsTable.fingerprint,
        set: { status: "open", lastSeenAt: now, resolvedAt: null },
      });
    }
  } catch (error) {
    logger.warn(
      { scope: "ai-telemetry", provider: attempt.provider, outcome: attempt.outcome, correlationId: context.correlationId },
      "AI telemetry write failed; continuing without blocking the AI response",
    );
    logger.debug({ err: error }, "AI telemetry write diagnostics");
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
}

export async function getAiUsageSummary(params: {
  userId: string;
  projectId?: string;
  provider?: string;
  days?: number;
}) {
  const days = Math.max(1, Math.min(AI_USAGE_MAX_WINDOW_DAYS, Math.floor(params.days ?? AI_USAGE_DEFAULT_WINDOW_DAYS)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conditions = [
    eq(aiUsageEventsTable.userId, params.userId),
    gte(aiUsageEventsTable.occurredAt, since),
  ];
  if (params.projectId) conditions.push(eq(aiUsageEventsTable.projectId, params.projectId));
  if (params.provider) conditions.push(eq(aiUsageEventsTable.provider, params.provider));
  const rows = await db.select().from(aiUsageEventsTable)
    .where(and(...conditions))
    .orderBy(desc(aiUsageEventsTable.occurredAt))
    .limit(5000);

  const byProvider = new Map<string, typeof rows>();
  for (const row of rows) {
    const entries = byProvider.get(row.provider) ?? [];
    entries.push(row);
    byProvider.set(row.provider, entries);
  }
  const providers = [...byProvider.entries()].map(([provider, entries]) => {
    const latencies = entries.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]);
    const successes = entries.filter((row) => row.outcome === "success").length;
    const knownUsage = entries.filter((row) => row.usageStatus === "known" || row.usageStatus === "partial");
    const promptTokens = knownUsage.reduce((sum, row) => sum + (row.promptTokens ?? 0), 0);
    const completionTokens = knownUsage.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0);
    return {
      provider,
      attempts: entries.length,
      successes,
      failures: entries.filter((row) => row.outcome === "failure").length,
      cancelled: entries.filter((row) => row.outcome === "cancelled").length,
      fallbackAttempts: entries.reduce((sum, row) => sum + row.fallbackCount, 0),
      successRate: entries.length ? Number((successes / entries.length).toFixed(4)) : null,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      usage: {
        promptTokens: knownUsage.some((row) => row.promptTokens !== null) ? promptTokens : null,
        completionTokens: knownUsage.some((row) => row.completionTokens !== null) ? completionTokens : null,
        status: knownUsage.length === 0 ? "unknown" : knownUsage.every((row) => row.usageStatus === "known") ? "known" : "partial",
      },
      lastOccurredAt: entries[0]?.occurredAt?.toISOString() ?? null,
    };
  });
  const timeline = new Map<string, { attempts: number; successes: number; failures: number; promptTokens: number; completionTokens: number; usageKnown: boolean }>();
  for (const row of rows) {
    const day = row.occurredAt.toISOString().slice(0, 10);
    const current = timeline.get(day) ?? { attempts: 0, successes: 0, failures: 0, promptTokens: 0, completionTokens: 0, usageKnown: false };
    current.attempts += 1;
    current.successes += row.outcome === "success" ? 1 : 0;
    current.failures += row.outcome === "failure" ? 1 : 0;
    current.promptTokens += row.promptTokens ?? 0;
    current.completionTokens += row.completionTokens ?? 0;
    current.usageKnown ||= row.usageStatus !== "unknown";
    timeline.set(day, current);
  }
  return {
    schemaVersion: 1,
    windowDays: days,
    retentionDays: AI_USAGE_RETENTION_DAYS,
    totalAttempts: rows.length,
    totalSuccesses: rows.filter((row) => row.outcome === "success").length,
    totalFailures: rows.filter((row) => row.outcome === "failure").length,
    totalFallbackAttempts: rows.reduce((sum, row) => sum + row.fallbackCount, 0),
    providers,
    timeline: [...timeline.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({
      day,
      ...value,
      promptTokens: value.usageKnown ? value.promptTokens : null,
      completionTokens: value.usageKnown ? value.completionTokens : null,
    })),
  };
}

/** Startup/retry maintenance: delete only expired telemetry rows. */
export async function pruneExpiredAiUsage(): Promise<void> {
  try {
    await db.delete(aiUsageEventsTable).where(lte(aiUsageEventsTable.expiresAt, new Date()));
  } catch (error) {
    logger.warn({ scope: "ai-telemetry", err: error }, "AI telemetry retention sweep failed");
  }
}