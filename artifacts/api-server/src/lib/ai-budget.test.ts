import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiBudgetReservationsTable,
  aiProjectBudgetsTable,
  aiUsageEventsTable,
  db,
  projectsTable,
} from "@workspace/db";
import { createExecutionLedger } from "@workspace/ai-orchestrator";
import {
  AiBudgetAdmissionError,
  admitAiProviderAttempt,
  getAiProjectBudgetSummary,
  reconcileAiBudgetReservation,
} from "./ai-budget.js";
import { emitLedgerProviderAttempts } from "./ai-route-helpers.js";
import { recordAiUsageAttempt } from "./ai-telemetry.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(aiUsageEventsTable).where(eq(aiUsageEventsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("AI project budget admission", () => {
  it("reserves one provider attempt and rejects the next attempt at the project limit", async () => {
    const projectId = crypto.randomUUID();
    const ownerId = "budget-test-user";
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      name: `ai-budget-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/ai-budget-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiProjectBudgetsTable).values({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      projectId,
      ownerId,
      dailyAttemptLimit: 1,
      dailyTokenLimit: 10_000,
      warningThreshold: 0.8,
      resetAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    });

    await expect(admitAiProviderAttempt({
      ownerId,
      projectId,
      attemptId: "budget-attempt-1",
    })).resolves.toMatchObject({
      projected: 1,
      state: "exhausted",
    });

    await expect(admitAiProviderAttempt({
      ownerId,
      projectId,
      attemptId: "budget-attempt-2",
    })).rejects.toBeInstanceOf(AiBudgetAdmissionError);

    const reservations = await db
      .select({ attemptId: aiBudgetReservationsTable.attemptId })
      .from(aiBudgetReservationsTable)
      .where(eq(aiBudgetReservationsTable.projectId, projectId));
    expect(reservations.map((row) => row.attemptId)).toEqual(["budget-attempt-1"]);
  });

  it("charges a conservative reservation when provider token usage is unknown", async () => {
    const projectId = crypto.randomUUID();
    const ownerId = "budget-token-user";
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      name: `ai-token-budget-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/ai-token-budget-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiProjectBudgetsTable).values({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      projectId,
      ownerId,
      dailyAttemptLimit: 10,
      dailyTokenLimit: 10_000,
      warningThreshold: 0.8,
      resetAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    });

    await expect(admitAiProviderAttempt({
      ownerId,
      projectId,
      attemptId: "token-attempt-1",
    })).resolves.toMatchObject({ projected: 1 });
    await reconcileAiBudgetReservation("token-attempt-1", { usageStatus: "unknown" });

    const [reservation] = await db
      .select({
        status: aiBudgetReservationsTable.status,
        chargedTokens: aiBudgetReservationsTable.chargedTokens,
        estimatedTokens: aiBudgetReservationsTable.estimatedTokens,
      })
      .from(aiBudgetReservationsTable)
      .where(eq(aiBudgetReservationsTable.attemptId, "token-attempt-1"));
    expect(reservation).toMatchObject({
      status: "consumed",
      chargedTokens: 8_192,
      estimatedTokens: 8_192,
    });

    await expect(admitAiProviderAttempt({
      ownerId,
      projectId,
      attemptId: "token-attempt-2",
    })).rejects.toMatchObject({
      code: "AI_BUDGET_EXHAUSTED",
      reason: "tokens",
    });
  });

  it("keeps known and partial usage distinct across retry and resumed executions", async () => {
    const projectId = crypto.randomUUID();
    const ownerId = "budget-resume-user";
    const executionId = `execution-${projectId}`;
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      name: `ai-budget-resume-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/ai-budget-resume-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiProjectBudgetsTable).values({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      projectId,
      ownerId,
      dailyAttemptLimit: 10,
      dailyTokenLimit: 100_000,
      warningThreshold: 0.8,
      resetAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    });

    const attemptIds = [`retry-${projectId}`, `resume-${projectId}`];
    await admitAiProviderAttempt({ ownerId, projectId, attemptId: attemptIds[0]! });
    await recordAiUsageAttempt({
      userId: ownerId,
      projectId,
      executionId,
      operationId: "query",
      correlationId: `correlation-${projectId}`,
    }, {
      attemptId: attemptIds[0]!,
      provider: "openrouter",
      model: "fixture-model",
      outcome: "success",
      latencyMs: 14,
      attemptNumber: 1,
      fallbackCount: 0,
      promptTokens: 24,
      completionTokens: 6,
      usageStatus: "known",
    });

    await admitAiProviderAttempt({ ownerId, projectId, attemptId: attemptIds[1]! });
    await recordAiUsageAttempt({
      userId: ownerId,
      projectId,
      executionId,
      operationId: "query",
      correlationId: `correlation-${projectId}-resume`,
    }, {
      attemptId: attemptIds[1]!,
      provider: "openrouter",
      model: "fixture-model",
      outcome: "success",
      latencyMs: 18,
      attemptNumber: 2,
      fallbackCount: 0,
      promptTokens: 400,
      completionTokens: null,
      usageStatus: "partial",
    });

    const events = await db.select({
      attemptId: aiUsageEventsTable.attemptId,
      executionId: aiUsageEventsTable.executionId,
      usageStatus: aiUsageEventsTable.usageStatus,
    }).from(aiUsageEventsTable).where(eq(aiUsageEventsTable.projectId, projectId));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: attemptIds[0], executionId, usageStatus: "known" }),
      expect.objectContaining({ attemptId: attemptIds[1], executionId, usageStatus: "partial" }),
    ]));

    const summary = await getAiProjectBudgetSummary({ ownerId, projectId });
    expect(summary).toMatchObject({
      consumedAttempts: 2,
      tokenUsage: {
        status: "partial",
        total: 430,
        admissionTotal: 8_222,
      },
    });
  });

  it("keeps a consumed attempt and conservative token charge when usage telemetry is missing", async () => {
    const projectId = crypto.randomUUID();
    const ownerId = "budget-unlogged-user";
    const attemptId = `unlogged-${projectId}`;
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      name: `ai-budget-unlogged-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/ai-budget-unlogged-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiProjectBudgetsTable).values({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      projectId,
      ownerId,
      dailyAttemptLimit: 1,
      dailyTokenLimit: 20_000,
      warningThreshold: 0.8,
      resetAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    });

    await expect(admitAiProviderAttempt({ ownerId, projectId, attemptId })).resolves.toMatchObject({
      projected: 1,
    });
    await reconcileAiBudgetReservation(attemptId, {
      promptTokens: 10_000,
      completionTokens: 2_000,
      usageStatus: "known",
    });

    const summary = await getAiProjectBudgetSummary({ ownerId, projectId });
    expect(summary).toMatchObject({
      consumedAttempts: 1,
      reservedAttempts: 0,
      remainingAttempts: 0,
      tokenUsage: {
        status: "unknown",
        total: null,
        admissionTotal: 12_000,
      },
    });
    await expect(admitAiProviderAttempt({
      ownerId,
      projectId,
      attemptId: `${attemptId}:next`,
    })).rejects.toMatchObject({
      code: "AI_BUDGET_EXHAUSTED",
      reason: "attempts",
    });
  });

  it("counts a durable usage event and its reservation as one provider attempt", async () => {
    const projectId = crypto.randomUUID();
    const ownerId = "budget-dedup-user";
    const attemptId = `tracked-${projectId}`;
    const now = new Date();
    projectIds.push(projectId);

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId,
      name: `ai-budget-dedup-${projectId.slice(0, 8)}`,
      rootPath: `/tmp/ai-budget-dedup-${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiProjectBudgetsTable).values({
      id: crypto.randomUUID(),
      schemaVersion: 1,
      projectId,
      ownerId,
      dailyAttemptLimit: 1,
      dailyTokenLimit: 20_000,
      warningThreshold: 0.8,
      resetAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    });

    const context = {
      userId: ownerId,
      projectId,
      executionId: `execution-${projectId}`,
      operationId: "provider-request",
      correlationId: `budget-event-${projectId}`,
    };
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve: async ({ estimatedTokens }) => {
          await admitAiProviderAttempt({ ownerId, projectId, attemptId, estimatedTokens });
          return attemptId;
        },
        reconcile: async ({ reservationId, usage }) => {
          await reconcileAiBudgetReservation(reservationId, usage);
        },
      },
    });
    const before = ledger.snapshot();
    const admission = await ledger.admitProviderRequest!({
      provider: "openrouter",
      model: "fixture-model",
      estimatedTokens: 8_192,
      operation: "provider_request",
    });
    expect(admission).toMatchObject({ admitted: true, reservationId: attemptId });
    await ledger.completeProviderRequest!({
      reservationId: attemptId,
      provider: "openrouter",
      model: "fixture-model",
      operation: "provider_request",
      status: "completed",
      usage: { promptTokens: 12, completionTokens: 8, usageStatus: "known" },
    });
    await emitLedgerProviderAttempts(
      before,
      ledger.snapshot(),
      { completedEventCount: 0, attemptNumber: 0, fallbackCount: 0 },
      (attempt) => recordAiUsageAttempt(context, attempt),
    );

    const summary = await getAiProjectBudgetSummary({ ownerId, projectId });
    expect(summary).toMatchObject({
      consumedAttempts: 1,
      reservedAttempts: 0,
      tokenUsage: {
        status: "known",
        total: 20,
        admissionTotal: 20,
      },
    });
  });
});