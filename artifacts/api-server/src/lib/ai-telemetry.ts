import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  aiUsageEventsTable,
  operatorAlertsTable,
  AI_CONTRACT_OUTCOMES,
  AI_RECOVERY_OUTCOMES,
  type AiContractOutcome,
  type AiRecoveryOutcome,
} from "@workspace/db";
import type { ProviderId } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { reconcileAiBudgetReservation } from "./ai-budget.js";

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
  contractOutcome?: AiContractOutcome;
  recoveryOutcome?: AiRecoveryOutcome;
  contractClaimCount?: number;
  contractCitationMatchCount?: number;
  contractRecoveryLatencyMs?: number | null;
  contractFailureKind?: string | null;
  providerFailureKind?: string | null;
};

export type AiContractTelemetry = Pick<
  AiTelemetryAttempt,
  | "contractOutcome"
  | "recoveryOutcome"
  | "contractClaimCount"
  | "contractCitationMatchCount"
  | "contractRecoveryLatencyMs"
  | "contractFailureKind"
>;

/**
 * Classify the capability-probe contract independently from provider HTTP
 * success. This is intentionally derived from the server-owned final report,
 * not from model-reported sources or a 200 response.
 */
export function deriveAiContractTelemetry(params: {
  message: string;
  response: string;
  recoveryAttempted?: boolean;
  recoveryAccepted?: boolean;
  recoveryLatencyMs?: number | null;
}): AiContractTelemetry {
  const isCapabilityProbe =
    /(?:^|\n)\s*#\s*AI Model Capability Probe\b/i.test(params.message) ||
    /\bAI Model Capability Probe\b[\s\S]*\bC[1-7]\b/i.test(params.message);
  if (!isCapabilityProbe) {
    return {
      contractOutcome: "not_applicable",
      recoveryOutcome: "not_attempted",
      contractClaimCount: 0,
      contractCitationMatchCount: 0,
      contractRecoveryLatencyMs: null,
      contractFailureKind: null,
    };
  }

  const lines = params.response.trim().split("\n");
  const claimLines = new Map<string, string>();
  for (const label of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
    const line = lines.find((candidate) =>
      new RegExp(`^\\s*(?:[-*]\\s*)?${label}\\b`, "i").test(candidate),
    );
    if (line) claimLines.set(label, line);
  }
  const structuredPayload = parseCapabilityProbeJson(params.response);
  if (structuredPayload) {
    for (const record of capabilityClaimRecords(structuredPayload)) {
      for (const label of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
        const value = record[label];
        if (value === undefined || claimLines.has(label)) continue;
        claimLines.set(label, typeof value === "string" ? value : JSON.stringify(value));
      }
    }
  }
  const claimCount = claimLines.size;
  const citationClaims = ["C1", "C3", "C4", "C6", "C7"];
  const citationMatchCount = citationClaims.filter((label) =>
    /Evidence\s*ID\s*:\s*[A-Za-z0-9_-]+|evidence[_\s-]*id\s*["']?\s*:\s*["']?[A-Za-z0-9_-]+|Evidence\s*:/i.test(
      claimLines.get(label) ?? "",
    ),
  ).length;
  const missingClaims = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]
    .filter((label) => !claimLines.has(label));
  const failedClaims = [...claimLines.values()].filter((line) => /\bFAIL\b/i.test(line));
  const hasOverallScore =
    /\b(?:overall\s+score|score)\s*:\s*\d+\s*\/\s*7\b/i.test(params.response) ||
    (structuredPayload !== null && capabilityPayloadHasScore(structuredPayload));
  let contractOutcome: AiContractOutcome;
  let contractFailureKind: string | null = null;
  if (!params.response.trim()) {
    contractOutcome = "provider_empty";
    contractFailureKind = "provider_empty";
  } else if (missingClaims.length > 0 || !hasOverallScore) {
    contractOutcome = "missing_claims";
    contractFailureKind = missingClaims.length > 0
      ? `missing:${missingClaims.join(",")}`
      : "missing:overall_score";
  } else if (citationMatchCount < citationClaims.length) {
    contractOutcome = "citation_mismatch";
    contractFailureKind = "citation_mismatch";
  } else if (failedClaims.length > 0 || !hasOverallScore) {
    contractOutcome = "semantic_failure";
    contractFailureKind = failedClaims.length > 0
      ? `failed:${failedClaims.length}`
      : "semantic_failure";
  } else {
    contractOutcome = params.recoveryAccepted ? "malformed_but_recovered" : "accepted";
  }
  const recoveryOutcome: AiRecoveryOutcome = params.recoveryAttempted
    ? params.recoveryAccepted ? "accepted" : "failed"
    : contractOutcome === "accepted"
      ? "not_needed"
      : "not_attempted";
  return {
    contractOutcome,
    recoveryOutcome,
    contractClaimCount: claimCount,
    contractCitationMatchCount: citationMatchCount,
    contractRecoveryLatencyMs: boundedInteger(params.recoveryLatencyMs),
    contractFailureKind,
  };
}

function parseCapabilityProbeJson(response: string): Record<string, unknown> | null {
  const cleaned = response
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const candidates = [cleaned];
  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(cleaned.slice(firstObject, lastObject + 1));
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Line-based telemetry remains the safe fallback for non-JSON reports.
    }
  }
  return null;
}

function capabilityClaimRecords(
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const response =
    payload.response && typeof payload.response === "object" && !Array.isArray(payload.response)
      ? payload.response as Record<string, unknown>
      : null;
  const records: Array<Record<string, unknown>> = [payload];
  if (response) records.push(response);
  for (const candidate of [payload.claims, response?.claims]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      records.push(candidate as Record<string, unknown>);
    }
  }
  return records;
}

function capabilityPayloadHasScore(payload: Record<string, unknown>): boolean {
  return capabilityClaimRecords(payload).some((record) =>
    ["overallScore", "overall_score", "overall", "score"].some((key) => {
      const value = record[key];
      return typeof value === "number"
        ? Number.isFinite(value)
        : typeof value === "string" && /\d+\s*\/\s*7\b/.test(value);
    }),
  );
}

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
      contractOutcome: AI_CONTRACT_OUTCOMES.includes(attempt.contractOutcome ?? "not_applicable")
        ? attempt.contractOutcome ?? "not_applicable"
        : "not_applicable",
      recoveryOutcome: AI_RECOVERY_OUTCOMES.includes(attempt.recoveryOutcome ?? "not_attempted")
        ? attempt.recoveryOutcome ?? "not_attempted"
        : "not_attempted",
      contractClaimCount: Math.max(0, Math.min(7, Math.floor(attempt.contractClaimCount ?? 0))),
      contractCitationMatchCount: Math.max(0, Math.min(7, Math.floor(attempt.contractCitationMatchCount ?? 0))),
      contractRecoveryLatencyMs: boundedInteger(attempt.contractRecoveryLatencyMs),
      contractFailureKind: safeText(attempt.contractFailureKind, 80),
      providerFailureKind: safeText(attempt.providerFailureKind, 80),
      occurredAt: now,
      expiresAt,
    }).onConflictDoNothing({ target: aiUsageEventsTable.attemptId });
    await reconcileAiBudgetReservation(attemptId);
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

function summarizeContract(entries: Array<{
  contractOutcome: string;
  recoveryOutcome: string;
  contractClaimCount: number;
  contractCitationMatchCount: number;
  contractFailureKind: string | null;
}>) {
  const contractEvaluated = entries.filter((row) => row.contractOutcome !== "not_applicable");
  const contractAccepted = entries.filter((row) =>
    row.contractOutcome === "accepted" || row.contractOutcome === "malformed_but_recovered");
  const recoveryAttempted = entries.filter((row) =>
    row.recoveryOutcome !== "not_attempted" && row.recoveryOutcome !== "not_needed");
  const recoveryAccepted = entries.filter((row) => row.recoveryOutcome === "accepted");
  return {
    evaluated: contractEvaluated.length,
    accepted: contractAccepted.length,
    acceptanceRate: contractEvaluated.length
      ? Number((contractAccepted.length / contractEvaluated.length).toFixed(4))
      : null,
    averageClaims: contractEvaluated.length
      ? Number((
        contractEvaluated.reduce((sum, row) => sum + row.contractClaimCount, 0) /
        contractEvaluated.length
      ).toFixed(2))
      : null,
    citationMatchRate: contractEvaluated.length
      ? Number((
        contractEvaluated.reduce((sum, row) => sum + row.contractCitationMatchCount, 0) /
        Math.max(1, contractEvaluated.reduce((sum, row) => sum + row.contractClaimCount, 0))
      ).toFixed(4))
      : null,
    recoveryAttempts: recoveryAttempted.length,
    recoveryAccepted: recoveryAccepted.length,
    recoveryAcceptanceRate: recoveryAttempted.length
      ? Number((recoveryAccepted.length / recoveryAttempted.length).toFixed(4))
      : null,
    failureKinds: Object.fromEntries(
      entries
        .filter((row) => row.contractFailureKind)
        .reduce((counts, row) => {
          const kind = row.contractFailureKind!;
          counts.set(kind, (counts.get(kind) ?? 0) + 1);
          return counts;
        }, new Map<string, number>()),
    ),
  };
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
      contract: summarizeContract(entries),
      models: [...new Set(entries.map((row) => row.model ?? "unknown"))].map((model) => {
        const modelEntries = entries.filter((row) => (row.model ?? "unknown") === model);
        return {
          model,
          attempts: modelEntries.length,
          successes: modelEntries.filter((row) => row.outcome === "success").length,
          failures: modelEntries.filter((row) => row.outcome === "failure").length,
          cancelled: modelEntries.filter((row) => row.outcome === "cancelled").length,
          contract: summarizeContract(modelEntries),
          p50LatencyMs: percentile(
            modelEntries.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]),
            0.5,
          ),
          p95LatencyMs: percentile(
            modelEntries.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]),
            0.95,
          ),
        };
      }),
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
  const timeline = new Map<string, {
    attempts: number;
    successes: number;
    failures: number;
    promptTokens: number;
    completionTokens: number;
    usageKnown: boolean;
    contractEvaluated: number;
    contractAccepted: number;
    citationMatches: number;
    citationClaims: number;
    recoveryAttempts: number;
    recoveryAccepted: number;
    failureKinds: Map<string, number>;
  }>();
  for (const row of rows) {
    const day = row.occurredAt.toISOString().slice(0, 10);
    const current = timeline.get(day) ?? {
      attempts: 0,
      successes: 0,
      failures: 0,
      promptTokens: 0,
      completionTokens: 0,
      usageKnown: false,
      contractEvaluated: 0,
      contractAccepted: 0,
      citationMatches: 0,
      citationClaims: 0,
      recoveryAttempts: 0,
      recoveryAccepted: 0,
      failureKinds: new Map<string, number>(),
    };
    current.attempts += 1;
    current.successes += row.outcome === "success" ? 1 : 0;
    current.failures += row.outcome === "failure" ? 1 : 0;
    current.promptTokens += row.promptTokens ?? 0;
    current.completionTokens += row.completionTokens ?? 0;
    current.usageKnown ||= row.usageStatus !== "unknown";
    if (row.contractOutcome !== "not_applicable") {
      current.contractEvaluated += 1;
      if (row.contractOutcome === "accepted" || row.contractOutcome === "malformed_but_recovered") {
        current.contractAccepted += 1;
      }
      current.citationMatches += row.contractCitationMatchCount;
      current.citationClaims += row.contractClaimCount;
    }
    if (row.recoveryOutcome !== "not_attempted" && row.recoveryOutcome !== "not_needed") {
      current.recoveryAttempts += 1;
      if (row.recoveryOutcome === "accepted") current.recoveryAccepted += 1;
    }
    if (row.contractFailureKind) {
      current.failureKinds.set(
        row.contractFailureKind,
        (current.failureKinds.get(row.contractFailureKind) ?? 0) + 1,
      );
    }
    timeline.set(day, current);
  }
  return {
    schemaVersion: 2,
    windowDays: days,
    retentionDays: AI_USAGE_RETENTION_DAYS,
    totalAttempts: rows.length,
    totalSuccesses: rows.filter((row) => row.outcome === "success").length,
    totalFailures: rows.filter((row) => row.outcome === "failure").length,
    totalFallbackAttempts: rows.reduce((sum, row) => sum + row.fallbackCount, 0),
    providers,
    timeline: [...timeline.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({
        day,
        attempts: value.attempts,
        successes: value.successes,
        failures: value.failures,
        promptTokens: value.usageKnown ? value.promptTokens : null,
        completionTokens: value.usageKnown ? value.completionTokens : null,
        usageKnown: value.usageKnown,
        contractEvaluated: value.contractEvaluated,
        contractAccepted: value.contractAccepted,
        acceptanceRate: value.contractEvaluated
          ? Number((value.contractAccepted / value.contractEvaluated).toFixed(4))
          : null,
        citationMatches: value.citationMatches,
        citationClaims: value.citationClaims,
        citationMatchRate: value.citationClaims
          ? Number((value.citationMatches / value.citationClaims).toFixed(4))
          : null,
        recoveryAttempts: value.recoveryAttempts,
        recoveryAccepted: value.recoveryAccepted,
        recoveryAcceptanceRate: value.recoveryAttempts
          ? Number((value.recoveryAccepted / value.recoveryAttempts).toFixed(4))
          : null,
        failureKinds: Object.fromEntries(value.failureKinds),
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