import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import request from "supertest";
import app from "../app.js";
import { db, aiUsageEventsTable } from "@workspace/db";
import {
  deriveAiContractTelemetry,
  getAiUsageSummary,
  recordAiUsageAttempt,
} from "./ai-telemetry.js";

const createdCorrelations: string[] = [];
const execFileAsync = promisify(execFile);

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

  it("projects nested claims JSON instead of treating every claim as missing", () => {
    const telemetry = deriveAiContractTelemetry({
      message: "# AI Model Capability Probe\nC1–C7",
      response: JSON.stringify({
        claims: {
          C1: { status: "PASS", evidenceId: "E1" },
          C2: { status: "PASS" },
          C3: { status: "PASS", evidenceId: "E3" },
          C4: { status: "PASS", evidenceId: "E4" },
          C5: { status: "PASS" },
          C6: { status: "PASS", evidenceId: "E6" },
          C7: { status: "PASS", evidenceId: "E7" },
        },
        overallScore: "7/7",
      }),
    });

    expect(telemetry).toMatchObject({
      contractOutcome: "accepted",
      contractClaimCount: 7,
      contractCitationMatchCount: 5,
      contractFailureKind: null,
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
        providerFailureKind: "TIMEOUT",
      }),
      recordAiUsageAttempt(context, {
        attemptId: `${correlationId}:groq:1`,
        provider: "groq",
        outcome: "failure",
        latencyMs: 120,
        attemptNumber: 1,
        fallbackCount: 0,
        usageStatus: "unknown",
        providerFailureKind: "TIMEOUT",
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
      providerFailureKind: "TIMEOUT",
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

  it("records a primary outage and fallback success across a reconnect-safe summary boundary", async () => {
    const correlationId = `telemetry-restart-${crypto.randomUUID()}`;
    const projectId = `telemetry-restart-project-${crypto.randomUUID()}`;
    const secretPrompt = `fixture-prompt-secret-${crypto.randomUUID()}`;
    const secretSource = `/tmp/fixture-source-secret-${crypto.randomUUID()}.ts`;
    const secretProviderKey = `fixture-provider-key-${crypto.randomUUID()}`;
    const originalGroqKey = process.env.GROQ_API_KEY;
    createdCorrelations.push(correlationId);
    process.env.GROQ_API_KEY = secretProviderKey;

    const context = {
      userId: "test-user",
      projectId,
      operationId: correlationId,
      correlationId,
    };
    await recordAiUsageAttempt(context, {
      attemptId: `${correlationId}:openrouter:1`,
      provider: "openrouter",
      model: "primary-fixture-model",
      outcome: "failure",
      latencyMs: 140,
      attemptNumber: 1,
      fallbackCount: 0,
      usageStatus: "unknown",
    });
    await recordAiUsageAttempt(context, {
      attemptId: `${correlationId}:gemini:2`,
      provider: "gemini",
      model: "fallback-fixture-model",
      outcome: "success",
      latencyMs: 90,
      attemptNumber: 2,
      fallbackCount: 1,
      promptTokens: 18,
      completionTokens: 7,
      usageStatus: "known",
    });

    const rows = await db
      .select()
      .from(aiUsageEventsTable)
      .where(eq(aiUsageEventsTable.correlationId, correlationId));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attemptId)).toEqual(expect.arrayContaining([
      `${correlationId}:openrouter:1`,
      `${correlationId}:gemini:2`,
    ]));
    expect(rows.every((row) => row.correlationId === correlationId)).toBe(true);
    expect(rows[0]).not.toHaveProperty("prompt");
    expect(rows[0]).not.toHaveProperty("source");
    expect(JSON.stringify(rows)).not.toContain(secretPrompt);
    expect(JSON.stringify(rows)).not.toContain(secretSource);

    // A reconnect is a fresh read of durable state, not a replay of provider
    // work. Both reads must retain the same attempt history and correlation.
    try {
      const summaryBeforeReconnect = await getAiUsageSummary({
        userId: context.userId,
        projectId,
        days: 7,
      });
      const telemetryModule = pathToFileURL(
        `${process.cwd()}/src/lib/ai-telemetry.ts`,
      ).href;
      const reconnectScript = [
        `import { getAiUsageSummary } from ${JSON.stringify(telemetryModule)};`,
        "(async () => {",
        "  const summary = await getAiUsageSummary({",
        "    userId: process.env.TELEMETRY_USER,",
        "    projectId: process.env.TELEMETRY_PROJECT,",
        "    days: 7,",
        "  });",
        "  console.log(JSON.stringify(summary));",
        "})();",
      ].join("\n");
      const reconnect = await execFileAsync(
        "pnpm",
        ["exec", "tsx", "-e", reconnectScript],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NODE_ENV: "test",
            TELEMETRY_USER: context.userId,
            TELEMETRY_PROJECT: projectId,
          },
        },
      );
      const reconnectSummary = JSON.parse(reconnect.stdout.trim().split("\n").at(-1) ?? "");
      expect(reconnectSummary).toEqual(summaryBeforeReconnect);
      expect(summaryBeforeReconnect).toMatchObject({
        totalAttempts: 2,
        totalSuccesses: 1,
        totalFailures: 1,
        totalFallbackAttempts: 1,
      });

      const response = await request(app)
        .get("/api/ai/metrics")
        .query({ projectId, days: 7 });
      expect(response.status).toBe(200);
      expect(response.body.usage).toEqual(summaryBeforeReconnect);
      expect(JSON.stringify(response.body)).not.toContain(secretProviderKey);
      expect(JSON.stringify(response.body)).not.toContain(secretPrompt);
      expect(JSON.stringify(response.body)).not.toContain(secretSource);
      expect(JSON.stringify(response.body)).not.toMatch(/api[_-]?key|provider[_-]?key/i);
    } finally {
      if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = originalGroqKey;
    }
  });
});