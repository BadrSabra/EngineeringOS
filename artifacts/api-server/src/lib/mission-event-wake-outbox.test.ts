import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { createMissionEventEnvelope } from "./mission-events.js";
import * as missionRuntimeModule from "./mission-runtime.js";
import * as missionAutoReplanModule from "./mission-auto-replan.js";
import {
  claimMissionEventWakeDispatchLease,
  dispatchMissionEventWakeIntent,
  dispatchPendingMissionEventWakes,
  insertMissionEventWakeIntent,
  MISSION_EVENT_WAKE_DEFERRED,
  MISSION_EVENT_WAKE_DISPATCHED,
  MISSION_EVENT_WAKE_REQUESTED,
  MISSION_EXTERNAL_EVENT_TYPE,
} from "./mission-event-wake-outbox.js";

const { autoReplanMission } = vi.hoisted(() => ({
  autoReplanMission: vi.fn(),
}));

vi.mock("./mission-auto-replan.js", () => ({
  autoReplanMission,
}));

const projectIds: string[] = [];

async function createWakeFixture(options: { includeInbox?: boolean } = {}) {
  const projectId = "mission-event-wake-lease-" + randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const eventId = randomUUID();
  const intentId = "mission-event-wake-test:" + randomUUID();
  const now = new Date();
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-event-wake-lease-test",
    name: "Mission event wake lease test",
    rootPath: "/tmp/" + projectId,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-event-wake-lease-test",
    title: "Event wake lease fixture",
    intent: "Verify exclusive Mission event wake delivery",
    status: "active",
    scope: { kind: "project", projectId },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Waiting Goal",
    status: "waiting_for_event",
    nextAction: { kind: "wait", reason: "event", wakeAt: null },
    createdAt: now,
    updatedAt: now,
  });

  if (options.includeInbox !== false) {
    if (options.includeInbox !== false) {
    const event = createMissionEventEnvelope({
        eventId,
        type: "ExternalValidationCompleted",
        projectId,
        goalId,
        payload: { validationId: "lease-regression" },
      });
      await db.insert(eventsTable).values({
        id: eventId,
        type: MISSION_EXTERNAL_EVENT_TYPE,
        projectId,
        goalId,
        severity: "info",
        message: "External event received",
        timestamp: now,
        payload: { missionEvent: event, processedAt: null },
      });
      // Mark this Goal's wait generation as already backfilled so this fixture
      // exercises only the event_received intent under test.
      await db.insert(eventsTable).values({
        id: "mission-event-wait-marker:" + randomUUID(),
        type: MISSION_EVENT_WAKE_DISPATCHED,
        projectId,
        goalId,
        severity: "info",
        message: "Wait generation already backfilled",
        timestamp: now,
        payload: {
          schemaVersion: 1,
          source: "goal_entered_event_wait",
          goalId,
          attemptCount: 0,
          nextAttemptAt: now.toISOString(),
          requestedAt: now.toISOString(),
          dispatchedAt: now.toISOString(),
        },
      });
      await db.insert(eventsTable).values({
        id: intentId,
        type: MISSION_EVENT_WAKE_REQUESTED,
        projectId,
        goalId,
        severity: "info",
        message: "External event requested a Goal wake",
        timestamp: now,
        payload: {
          schemaVersion: 1,
          source: "event_received",
          goalId,
          eventId,
          attemptCount: 0,
          nextAttemptAt: now.toISOString(),
          requestedAt: now.toISOString(),
        },
      });
    }
  
  
  }

  return { projectId, missionId, goalId, eventId, intentId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  autoReplanMission.mockReset();
  for (const projectId of projectIds.splice(0, projectIds.length)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Mission event wake dispatch lease", () => {
  it("serializes competing replicas and reclaims an expired lease", async () => {
    const fixture = await createWakeFixture();
    const contenders = await Promise.all([
      db.transaction((tx) => claimMissionEventWakeDispatchLease(tx, {
        intentId: fixture.intentId,
      })),
      db.transaction((tx) => claimMissionEventWakeDispatchLease(tx, {
        intentId: fixture.intentId,
      })),
    ]);
    const winners = contenders.filter((claim) => claim.acquired);
    expect(winners).toHaveLength(1);
    const firstLease = winners[0]!;
    if (!firstLease.acquired) throw new Error("Expected one Mission event wake lease owner.");

    const [leased] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId))
      .limit(1);
    expect(leased?.payload?.dispatchLease).toMatchObject({
      token: firstLease.token,
      expiresAt: firstLease.expiresAt,
    });

    // Active leases are excluded from the bounded dispatcher page.
    expect(await dispatchPendingMissionEventWakes(10, fixture.projectId)).toBe(0);

    await db.update(eventsTable).set({
      payload: {
        ...(leased?.payload ?? {}),
        dispatchLease: {
          token: firstLease.token,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    }).where(eq(eventsTable.id, fixture.intentId));

    const recovered = await db.transaction((tx) =>
      claimMissionEventWakeDispatchLease(tx, { intentId: fixture.intentId }),
    );
    expect(recovered.acquired).toBe(true);
    if (!recovered.acquired) throw new Error("Expected an expired lease to be recoverable.");
    expect(recovered.token).not.toBe(firstLease.token);

    const blocked = await db.transaction((tx) =>
      claimMissionEventWakeDispatchLease(tx, { intentId: fixture.intentId }),
    );
    expect(blocked).toEqual({ acquired: false, reason: "already_leased" });
  });

  async function assertLateWorkerCannotOverwriteNewerOwner(
    firstOutcome: "success" | "failure",
  ) {
    const fixture = await createWakeFixture();
    let firstCallStarted!: () => void;
    let finishFirstCall!: () => void;
    let calls = 0;
    const firstStarted = new Promise<void>((resolve) => {
      firstCallStarted = resolve;
    });
    const wakeSpy = vi.spyOn(missionRuntimeModule, "wakeMissionGoalsForEvent")
      .mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          firstCallStarted();
          return await new Promise<number>((resolve, reject) => {
            finishFirstCall = () => {
              if (firstOutcome === "success") resolve(1);
              else reject(new Error("late_worker_failure"));
            };
          });
        }
        return 1;
      });

    const firstDispatch = dispatchMissionEventWakeIntent(fixture.intentId);
    await firstStarted;
    try {
      const [leased] = await db.select({ payload: eventsTable.payload })
        .from(eventsTable)
        .where(eq(eventsTable.id, fixture.intentId))
        .limit(1);
      const rawLease = leased?.payload?.dispatchLease;
      const currentLease = rawLease && typeof rawLease === "object" && !Array.isArray(rawLease)
        ? rawLease as Record<string, unknown>
        : {};
      expect(currentLease.token).toBeTruthy();

      // Simulate process loss while the original handler is still returning.
      await db.update(eventsTable).set({
        payload: {
          ...(leased?.payload ?? {}),
          dispatchLease: {
            ...currentLease,
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
          },
        },
      }).where(eq(eventsTable.id, fixture.intentId));

      const replacement = await dispatchMissionEventWakeIntent(fixture.intentId);
      expect(replacement).toEqual({ dispatched: true, woken: 1 });

      finishFirstCall();
      const staleResult = await firstDispatch;
      expect(staleResult).toEqual({ dispatched: false, woken: 0 });

      const [finalIntent] = await db.select({
        type: eventsTable.type,
        payload: eventsTable.payload,
      }).from(eventsTable)
        .where(eq(eventsTable.id, fixture.intentId))
        .limit(1);
      expect(finalIntent?.type).toBe(MISSION_EVENT_WAKE_DISPATCHED);
      expect(finalIntent?.payload).toMatchObject({
        source: "event_received",
        goalId: fixture.goalId,
        wokenEvents: 1,
      });
      expect(finalIntent?.payload).not.toHaveProperty("dispatchLease");
      expect(wakeSpy).toHaveBeenCalledTimes(2);
    } finally {
      finishFirstCall?.();
      await firstDispatch;
    }
  }

  it("retries replanning after the event inbox and Goal transition have already committed", async () => {
    const fixture = await createWakeFixture();
    const wakeSpy = vi.spyOn(missionRuntimeModule, "wakeMissionGoalsForEvent");
    autoReplanMission.mockRejectedValueOnce(new Error("temporary_planner_failure"));

    await expect(dispatchMissionEventWakeIntent(fixture.intentId)).resolves.toEqual({
      dispatched: false,
      woken: 0,
    });

    const [deferred] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId))
      .limit(1);
    expect(deferred?.type).toBe(MISSION_EVENT_WAKE_DEFERRED);
    expect(deferred?.payload).toMatchObject({
      source: "event_received",
      goalId: fixture.goalId,
      replanPending: true,
      replanMissionId: fixture.missionId,
      replanGoalId: fixture.goalId,
      replanEventId: fixture.eventId,
      replanWakeCount: 1,
      attemptCount: 1,
      lastFailureCode: "MISSION_EVENT_WAKE_FAILED",
    });

    const [goalAfterWake] = await db.select({
      status: aiGoalsTable.status,
    }).from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, fixture.goalId))
      .limit(1);
    const [inboxAfterWake] = await db.select({
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, fixture.eventId))
      .limit(1);
    expect(goalAfterWake?.status).toBe("needs_replan");
    expect(typeof inboxAfterWake?.payload?.processedAt).toBe("string");
    expect(wakeSpy).toHaveBeenCalledOnce();

    await db.update(eventsTable).set({
      payload: {
        ...(deferred?.payload ?? {}),
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      },
    }).where(eq(eventsTable.id, fixture.intentId));
    autoReplanMission.mockResolvedValueOnce({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "event-replan-v1",
      plan: {},
      runs: [],
    });

    await expect(dispatchMissionEventWakeIntent(fixture.intentId)).resolves.toEqual({
      dispatched: true,
      woken: 1,
    });

    const [dispatched] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, fixture.intentId))
      .limit(1);
    expect(dispatched?.type).toBe(MISSION_EVENT_WAKE_DISPATCHED);
    expect(dispatched?.payload).toMatchObject({
      replanPending: false,
      replanMissionId: fixture.missionId,
      replanOutcome: "replanned",
      replanRevision: "event-replan-v1",
      wokenEvents: 1,
    });
    expect(autoReplanMission).toHaveBeenCalledTimes(2);
    // Recovery resumes from the atomic marker; it does not consume the inbox twice.
    expect(wakeSpy).toHaveBeenCalledOnce();
  });

  it("fences a late successful worker from acknowledging the replacement owner's wake", async () => {
    await assertLateWorkerCannotOverwriteNewerOwner("success");
  });

  it("fences a late failure from deferring the replacement owner's wake", async () => {
    await assertLateWorkerCannotOverwriteNewerOwner("failure");
  });

  it("dispatches a due scheduled Goal wait through the existing Outbox and replan coordinator", async () => {
    const fixture = await createWakeFixture({ includeInbox: false });
    const wakeAt = new Date("2020-01-01T00:00:00.000Z");
    const generationAt = new Date();
    await db.update(aiGoalsTable).set({
      nextWakeAt: wakeAt,
      updatedAt: generationAt,
      nextAction: { kind: "wait", reason: "event", wakeAt: wakeAt.toISOString() },
    }).where(eq(aiGoalsTable.id, fixture.goalId));

    const intentId = await db.transaction((tx) => insertMissionEventWakeIntent(tx, {
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      source: "scheduled_wake",
      wakeAt,
      generationAt,
    }));
    const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission")
      .mockResolvedValue({
        status: "skipped",
        missionId: fixture.missionId,
        reason: "automatic_replan_not_enabled",
      });

    let dispatched = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // The app clock may lag; the database deadline remains authoritative.
      vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
      dispatched = await dispatchPendingMissionEventWakes(10, fixture.projectId);
    } finally {
      vi.useRealTimers();
    }
    expect(dispatched).toBe(1);
    expect(replanSpy).toHaveBeenCalledOnce();
    expect(replanSpy).toHaveBeenCalledWith(fixture.missionId);

    const [goal] = await db.select({
      status: aiGoalsTable.status,
      nextWakeAt: aiGoalsTable.nextWakeAt,
      nextAction: aiGoalsTable.nextAction,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId)).limit(1);
    expect(goal).toMatchObject({
      status: "needs_replan",
      nextWakeAt: null,
      nextAction: {
        kind: "replan",
        reason: "Scheduled wake reached; replan from current project evidence.",
      },
    });

    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable).where(eq(eventsTable.id, intentId)).limit(1);
    expect(intent?.type).toBe(MISSION_EVENT_WAKE_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      source: "scheduled_wake",
      goalId: fixture.goalId,
      wakeAt: wakeAt.toISOString(),
      generationAt: generationAt.toISOString(),
      wokenEvents: 1,
    });
    expect(intent?.payload).not.toHaveProperty("dispatchLease");
  });

  it("does not dispatch a scheduled Goal wait before its database deadline", async () => {
    const fixture = await createWakeFixture({ includeInbox: false });
    const wakeAt = new Date(Date.now() + 60 * 60_000);
    const generationAt = new Date();
    await db.update(aiGoalsTable).set({
      nextWakeAt: wakeAt,
      updatedAt: generationAt,
      nextAction: { kind: "wait", reason: "event", wakeAt: wakeAt.toISOString() },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    const intentId = await db.transaction((tx) => insertMissionEventWakeIntent(tx, {
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      source: "scheduled_wake",
      wakeAt,
      generationAt,
    }));

    const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // A fast app clock must not dispatch a timer before PostgreSQL reaches it.
      vi.setSystemTime(new Date("2099-01-01T00:00:00.000Z"));
      expect(await dispatchPendingMissionEventWakes(10, fixture.projectId)).toBe(0);
      expect(await dispatchMissionEventWakeIntent(intentId)).toEqual({
        dispatched: false,
        woken: 0,
      });
    } finally {
      vi.useRealTimers();
    }
    expect(replanSpy).not.toHaveBeenCalled();

    const [intent] = await db.select({
      type: eventsTable.type,
    }).from(eventsTable).where(eq(eventsTable.id, intentId)).limit(1);
    expect(intent?.type).toBe(MISSION_EVENT_WAKE_REQUESTED);
  });

  it("supersedes a scheduled wake when the Goal has entered a newer wait generation", async () => {
    const fixture = await createWakeFixture({ includeInbox: false });
    const oldWakeAt = new Date("2020-01-01T00:00:00.000Z");
    const oldGenerationAt = new Date(Date.now() - 60_000);
    await db.update(aiGoalsTable).set({
      nextWakeAt: oldWakeAt,
      updatedAt: oldGenerationAt,
      nextAction: { kind: "wait", reason: "event", wakeAt: oldWakeAt.toISOString() },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    const intentId = await db.transaction((tx) => insertMissionEventWakeIntent(tx, {
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      source: "scheduled_wake",
      wakeAt: oldWakeAt,
      generationAt: oldGenerationAt,
    }));

    const currentWakeAt = new Date("2020-02-01T00:00:00.000Z");
    const currentGenerationAt = new Date();
    await db.update(aiGoalsTable).set({
      nextWakeAt: currentWakeAt,
      updatedAt: currentGenerationAt,
      nextAction: { kind: "wait", reason: "event", wakeAt: currentWakeAt.toISOString() },
    }).where(eq(aiGoalsTable.id, fixture.goalId));

    const replanSpy = vi.spyOn(missionAutoReplanModule, "autoReplanMission");
    expect(await dispatchMissionEventWakeIntent(intentId)).toEqual({
      dispatched: true,
      woken: 0,
    });
    expect(replanSpy).not.toHaveBeenCalled();
    const [goal] = await db.select({
      status: aiGoalsTable.status,
      nextWakeAt: aiGoalsTable.nextWakeAt,
    }).from(aiGoalsTable).where(eq(aiGoalsTable.id, fixture.goalId)).limit(1);
    expect(goal?.status).toBe("waiting_for_event");
    expect(goal?.nextWakeAt?.toISOString()).toBe(currentWakeAt.toISOString());
  });
});

