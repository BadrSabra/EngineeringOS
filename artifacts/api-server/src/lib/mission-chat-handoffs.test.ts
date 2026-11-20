import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiMissionHandoffsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  projectsTable,
} from "@workspace/db";
import * as missionRuntime from "./mission-runtime.js";
import {
  dispatchMissionChatHandoff,
  dispatchPendingMissionChatHandoffs,
} from "./mission-chat-handoffs.js";

const projectIds: string[] = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function createHandoffFixture(existingProjectId?: string) {
  const projectId = existingProjectId ?? `mission-chat-handoff-${randomUUID()}`;
  const missionId = randomUUID();
  const goalId = randomUUID();
  const handoffId = randomUUID();
  const planRevision = `chat-plan-${randomUUID()}`;
  const now = new Date();
  if (!existingProjectId) {
    projectIds.push(projectId);
    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "mission-chat-handoff-test",
      name: "Mission Chat handoff lease test",
      rootPath: `/tmp/${projectId}`,
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-chat-handoff-test",
    title: "Chat handoff lease fixture",
    intent: "Dispatch one persisted Chat-to-Mission handoff",
    status: "active",
    scope: { kind: "project", projectId },
    autonomyPolicy: { activePlanRevision: planRevision },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Handoff root Goal",
    status: "queued",
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
    outcomeContract: { planRevision: { hash: planRevision } },
    successCriteria: { planRevision: { hash: planRevision } },
    createdAt: now,
    updatedAt: now,
  });
  const planGoal = {
    stepId: "root-step",
    goalId,
    taskId: null,
    dependencies: [] as string[],
  };
  await db.insert(aiMissionHandoffsTable).values({
    id: handoffId,
    projectId,
    userId: "mission-chat-handoff-test",
    missionId,
    sessionId: null,
    messageId: null,
    assistantMessageId: null,
    idempotencyKey: `handoff-key-${handoffId}`,
    requestHash: "request-hash",
    planHash: planRevision,
    preview: {},
    activationPlan: {
      revision: planRevision,
      goals: [planGoal],
      primary: planGoal,
    },
    dispatchGoalIds: [goalId],
    dispatchStatus: "pending",
    dispatchLease: null,
    createdAt: now,
    updatedAt: now,
  });

  return { projectId, missionId, goalId, handoffId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (projectIds.length > 0) {
    const projectId = projectIds.pop();
    if (!projectId) continue;
    await db.delete(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.projectId, projectId));
    await db.delete(aiGoalsTable).where(eq(aiGoalsTable.projectId, projectId));
    await db.delete(aiMissionsTable).where(eq(aiMissionsTable.projectId, projectId));
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Mission Chat handoff dispatch lease", () => {
  it("allows only one replica to dispatch a pending handoff", async () => {
    const fixture = await createHandoffFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    const runGoal = vi.spyOn(missionRuntime, "runMissionGoal").mockImplementation(
      async (params) => {
        expect(params.expectedHandoffBinding?.dispatchLeaseToken).toEqual(expect.any(String));
        entered.resolve();
        await release.promise;
        return { status: "scheduled", goalId: params.goalId };
      },
    );

    const firstDispatch = dispatchMissionChatHandoff(fixture.handoffId);
    await entered.promise;
    await expect(
      dispatchPendingMissionChatHandoffs(10, fixture.projectId),
    ).resolves.toBe(0);

    const [leased] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, fixture.handoffId));
    expect(leased?.dispatchStatus).toBe("pending");
    expect(leased?.dispatchLease?.token).toEqual(expect.any(String));
    expect(runGoal).toHaveBeenCalledOnce();

    release.resolve();
    await expect(firstDispatch).resolves.toMatchObject([
      { status: "scheduled", goalId: fixture.goalId },
    ]);
    const [settled] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, fixture.handoffId));
    expect(settled?.dispatchStatus).toBe("dispatched");
    expect(settled?.dispatchLease).toBeNull();
    expect(runGoal).toHaveBeenCalledOnce();
  });

  it("fences a stale dispatcher after another replica reclaims an expired lease", async () => {
    const fixture = await createHandoffFixture();
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const tokens: string[] = [];
    const runGoal = vi.spyOn(missionRuntime, "runMissionGoal")
      .mockImplementationOnce(async (params) => {
        const token = params.expectedHandoffBinding?.dispatchLeaseToken;
        if (token) tokens.push(token);
        firstEntered.resolve();
        await releaseFirst.promise;
        return { status: "scheduled", goalId: params.goalId };
      })
      .mockImplementationOnce(async (params) => {
        const token = params.expectedHandoffBinding?.dispatchLeaseToken;
        if (token) tokens.push(token);
        return { status: "scheduled", goalId: params.goalId };
      });

    const staleDispatch = dispatchMissionChatHandoff(fixture.handoffId);
    await firstEntered.promise;
    const [firstLease] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, fixture.handoffId));
    expect(firstLease?.dispatchLease?.token).toEqual(expect.any(String));

    await db.update(aiMissionHandoffsTable).set({
      dispatchLease: {
        token: firstLease!.dispatchLease!.token,
        expiresAt: "2000-01-01T00:00:00.000Z",
      },
    }).where(eq(aiMissionHandoffsTable.id, fixture.handoffId));

    await expect(dispatchMissionChatHandoff(fixture.handoffId)).resolves.toMatchObject([
      { status: "scheduled", goalId: fixture.goalId },
    ]);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);

    releaseFirst.resolve();
    await expect(staleDispatch).resolves.toEqual([]);
    const [settled] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, fixture.handoffId));
    expect(settled?.dispatchStatus).toBe("dispatched");
    expect(settled?.dispatchLease).toBeNull();
  });

  it("does not let an active early lease starve a later ready handoff", async () => {
    const busy = await createHandoffFixture();
    const ready = await createHandoffFixture(busy.projectId);
    const now = new Date();
    await db.update(aiMissionHandoffsTable).set({
      createdAt: new Date(now.getTime() - 60_000),
      dispatchLease: {
        token: randomUUID(),
        expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      },
    }).where(eq(aiMissionHandoffsTable.id, busy.handoffId));
    await db.update(aiMissionHandoffsTable).set({
      createdAt: now,
    }).where(eq(aiMissionHandoffsTable.id, ready.handoffId));

    const runGoal = vi.spyOn(missionRuntime, "runMissionGoal").mockImplementation(
      async (params) => ({ status: "scheduled", goalId: params.goalId }),
    );

    await expect(
      dispatchPendingMissionChatHandoffs(1, busy.projectId),
    ).resolves.toBe(1);
    expect(runGoal).toHaveBeenCalledOnce();
    expect(runGoal).toHaveBeenCalledWith(expect.objectContaining({
      goalId: ready.goalId,
    }));

    const [busyRow] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, busy.handoffId));
    const [readyRow] = await db.select().from(aiMissionHandoffsTable)
      .where(eq(aiMissionHandoffsTable.id, ready.handoffId));
    expect(busyRow?.dispatchStatus).toBe("pending");
    expect(busyRow?.dispatchLease?.token).toEqual(expect.any(String));
    expect(readyRow?.dispatchStatus).toBe("dispatched");
    expect(readyRow?.dispatchLease).toBeNull();
  });

});
