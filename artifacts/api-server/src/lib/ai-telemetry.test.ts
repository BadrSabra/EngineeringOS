import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, aiUsageEventsTable } from "@workspace/db";
import { getAiUsageSummary, recordAiUsageAttempt } from "./ai-telemetry.js";

const createdCorrelations: string[] = [];

afterEach(async () => {
  for (const correlationId of createdCorrelations.splice(0)) {
    await db.delete(aiUsageEventsTable).where(eq(aiUsageEventsTable.correlationId, correlationId));
  }
});

describe("durable AI telemetry", () => {
  it("deduplicates concurrent attempts and represents missing usage as unknown", async () => {
    const correlationId = `telemetry-test-${crypto.randomUUID()}`;
    createdCorrelations.push(correlationId);
    const context = {
      userId: "telemetry-owner",
      projectId: "telemetry-project",
      operationId: correlationId,
      correlationId,
    };
    await Promise.all([
      recordAiUsageAttempt(context, {
        attemptId: `${correlationId}:groq:1`,
        provider: "groq",
        outcome: "failure",
        latencyMs: 120,
        attemptNumber: 1,
        fallbackCount: 0,
        usageStatus: "unknown",
      }),
      recordAiUsageAttempt(context, {
        attemptId: `${correlationId}:groq:1`,
        provider: "groq",
        outcome: "failure",
        latencyMs: 120,
        attemptNumber: 1,
        fallbackCount: 0,
        usageStatus: "unknown",
      }),
    ]);

    const rows = await db.select().from(aiUsageEventsTable)
      .where(eq(aiUsageEventsTable.correlationId, correlationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "telemetry-owner",
      projectId: "telemetry-project",
      usageStatus: "unknown",
      promptTokens: null,
      completionTokens: null,
    });
    expect(Object.keys(rows[0]).some((key) => /source|secret|api_key|provider_key|prompt_content/i.test(key))).toBe(false);
  });

  it("summarizes only the requested owner and preserves partial usage semantics", async () => {
    const correlationId = `telemetry-test-${crypto.randomUUID()}`;
    createdCorrelations.push(correlationId);
    await recordAiUsageAttempt({
      userId: "telemetry-owner",
      projectId: "telemetry-project",
      operationId: correlationId,
      correlationId,
    }, {
      attemptId: `${correlationId}:gemini:1`,
      provider: "gemini",
      model: "safe-model",
      outcome: "success",
      latencyMs: 80,
      promptTokens: 10,
      completionTokens: 4,
      usageStatus: "known",
    });
    await recordAiUsageAttempt({
      userId: "other-owner",
      projectId: "telemetry-project",
      operationId: `${correlationId}:other`,
      correlationId: `${correlationId}:other`,
    }, {
      attemptId: `${correlationId}:other:1`,
      provider: "gemini",
      outcome: "success",
      latencyMs: 1,
      usageStatus: "unknown",
    });

    const summary = await getAiUsageSummary({
      userId: "telemetry-owner",
      projectId: "telemetry-project",
      days: 7,
    });
    expect(summary.totalAttempts).toBe(1);
    expect(summary.providers[0]).toMatchObject({
      provider: "gemini",
      successes: 1,
      usage: { status: "known", promptTokens: 10, completionTokens: 4 },
    });
  });
});