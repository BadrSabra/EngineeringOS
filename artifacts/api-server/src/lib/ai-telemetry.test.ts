import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, aiUsageEventsTable } from "@workspace/db";
import {
  deriveAiContractTelemetry,
  getAiUsageSummary,
  recordAiUsageAttempt,
} from "./ai-telemetry.js";

const createdCorrelations: string[] = [];

afterEach(async () => {
  for (const correlationId of createdCorrelations.splice(0)) {
    await db.delete(aiUsageEventsTable).where(eq(aiUsageEventsTable.correlationId, correlationId));
  }
});

describe("durable AI telemetry", () => {
  it("separates provider success from an incomplete capability contract", () => {
    const telemetry = deriveAiContractTelemetry({
      message: "# AI Model Capability Probe\nC1–C7",
      response: [
        "C1: PASS — isPromptProsePath. Source: `profile-classifier.ts`; Evidence ID: E1",
        "C2: PASS — read_file. Evidence ID: R1",
        "C3: PASS — grounded. Source: `profile-classifier.ts`; Evidence ID: E1",
        "C4: PASS — denylist. Source: `profile-classifier.ts`; Evidence ID: E2",
        "C5: PASS — no writes. Evidence ID: R2",
        "C6: PASS — no eval. Source: `profile-classifier.ts`; Evidence ID: E4",
        "Overall score: 6/7",
      ].join("\n"),
    });

    expect(telemetry).toMatchObject({
      contractOutcome: "missing_claims",
      recoveryOutcome: "not_attempted",
      contractClaimCount: 6,
      contractCitationMatchCount: 4,
      contractFailureKind: "missing:C7",
    });
  });

  it("records a recovered contract separately from provider HTTP success", () => {
    const telemetry = deriveAiContractTelemetry({
      message: "# AI Model Capability Probe\nC1–C7",
      response: [
        "C1: PASS — isPromptProsePath. Source: `profile-classifier.ts`; Evidence ID: E1",
        "C2: PASS — read_file. Evidence ID: R1",
        "C3: PASS — grounded. Source: `profile-classifier.ts`; Evidence ID: E1",
        "C4: PASS — denylist. Source: `profile-classifier.ts`; Evidence ID: E2",
        "C5: PASS — no writes. Evidence ID: R2",
        "C6: PASS — no eval. Source: `profile-classifier.ts`; Evidence ID: E4",
        "C7: PASS — run. Source: `file-tools.ts`; Evidence ID: E3",
        "Overall score: 7/7",
      ].join("\n"),
      recoveryAttempted: true,
      recoveryAccepted: true,
      recoveryLatencyMs: 120,
    });

    expect(telemetry).toMatchObject({
      contractOutcome: "malformed_but_recovered",
      recoveryOutcome: "accepted",
      contractClaimCount: 7,
      contractCitationMatchCount: 5,
      contractRecoveryLatencyMs: 120,
    });
  });

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
    expect(summary.providers[0].models).toEqual([
      expect.objectContaining({
        model: "safe-model",
        attempts: 1,
        successes: 1,
        contract: expect.objectContaining({ evaluated: 0, acceptanceRate: null }),
      }),
    ]);
  });
});