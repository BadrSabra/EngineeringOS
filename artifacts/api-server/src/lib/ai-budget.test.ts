import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  aiBudgetReservationsTable,
  aiProjectBudgetsTable,
  db,
  projectsTable,
} from "@workspace/db";
import {
  AiBudgetAdmissionError,
  admitAiProviderAttempt,
  reconcileAiBudgetReservation,
} from "./ai-budget.js";

const projectIds: string[] = [];

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
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
      dailyTokenLimit: 1_000,
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
      dailyTokenLimit: 1_000,
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
      chargedTokens: 1_000,
      estimatedTokens: 1_000,
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
});