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
import {
  claimMissionEventWakeDispatchLease,
  dispatchMissionEventWakeIntent,
  dispatchPendingMissionEventWakes,
  MISSION_EVENT_WAKE_DISPATCHED,
  MISSION_EVENT_WAKE_REQUESTED,
  MISSION_EXTERNAL_EVENT_TYPE,
} from "./mission-event-wake-outbox.js";

const projectIds: string[] = [];

async function createWakeFixture() {
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

  return { projectId, missionId, goalId, eventId, intentId };
}

afterEach(async () => {
  vi.restoreAllMocks();
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

  it("fences a late successful worker from acknowledging the replacement owner's wake", async () => {
    await assertLateWorkerCannotOverwriteNewerOwner("success");
  });

  it("fences a late failure from deferring the replacement owner's wake", async () => {
    await assertLateWorkerCannotOverwriteNewerOwner("failure");
  });
});
