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
});