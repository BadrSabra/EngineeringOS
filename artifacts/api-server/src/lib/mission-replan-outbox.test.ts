import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";

const { autoReplanMission } = vi.hoisted(() => ({
  autoReplanMission: vi.fn(),
}));

vi.mock("./mission-auto-replan.js", () => ({
  autoReplanMission,
}));

import {
  claimMissionReplanDispatchLease,
  dispatchMissionReplanIntent,
  dispatchPendingMissionReplans,
  insertMissionAdmissionReplanIntent,
  insertMissionReplanIntent,
  missionReplanAdmissionIntentId,
  MISSION_REPLAN_DEFERRED,
  MISSION_REPLAN_DISPATCHED,
  MISSION_REPLAN_SUPERSEDED,
  missionReplanIntentId,
} from "./mission-replan-outbox.js";

const projectIds: string[] = [];

async function createFixture() {
  const projectId = "mission-replan-outbox-" + randomUUID();
  const missionId = randomUUID();
  const goalId = randomUUID();
  const now = new Date();
  projectIds.push(projectId);

  await db.insert(projectsTable).values({
    id: projectId,
    ownerId: "mission-replan-outbox-test",
    name: "Mission replan Outbox test",
    rootPath: "/tmp/" + projectId,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiMissionsTable).values({
    id: missionId,
    projectId,
    userId: "mission-replan-outbox-test",
    title: "Recover a retryable failure",
    intent: "Automatically replan from accepted failure evidence.",
    status: "needs_replan",
    scope: { kind: "project", projectId },
    autonomyPolicy: { mode: "autonomous", maxAutoReplans: 3 },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(aiGoalsTable).values({
    id: goalId,
    missionId,
    projectId,
    title: "Retry the failed objective",
    status: "needs_replan",
    nextAction: { kind: "replan", reason: "retry from current evidence" },
    successCriteria: { kind: "mission_plan_step" },
    outcomeContract: { retryable: true },
    createdAt: now,
    updatedAt: now,
  });
  return { projectId, missionId, goalId, now };
}

async function createIntent(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return db.transaction((tx) => insertMissionReplanIntent(tx, {
    projectId: fixture.projectId,
    missionId: fixture.missionId,
    goalId: fixture.goalId,
    executionId: "execution-" + fixture.goalId,
    attempt: 2,
    acceptanceId: "acceptance-" + fixture.goalId,
    requestedAt: fixture.now,
  }));
}

async function createAdmissionIntent(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  reasonCode: "dependency_proof_unproven" | "dependency_failed" = "dependency_proof_unproven",
  revisionLocation: "successCriteria" | "outcomeContract" = "successCriteria",
) {
  const planRevision = "admission-plan-" + fixture.goalId;
  await db.update(aiMissionsTable).set({
    status: "needs_replan",
    autonomyPolicy: {
      mode: "autonomous",
      maxAutoReplans: 3,
      activePlanRevision: planRevision,
    },
  }).where(eq(aiMissionsTable.id, fixture.missionId));
  await db.update(aiGoalsTable).set({
    status: "needs_replan",
    blockedReason: reasonCode,
    ...(revisionLocation === "outcomeContract"
      ? {
          successCriteria: { kind: "mission_plan_step" },
          outcomeContract: { retryable: true, planRevision: { hash: planRevision } },
        }
      : {
          successCriteria: {
            kind: "mission_plan_step",
            planRevision: { hash: planRevision },
          },
        }),
  }).where(eq(aiGoalsTable.id, fixture.goalId));

  const intentId = await db.transaction((tx) => insertMissionAdmissionReplanIntent(tx, {
    projectId: fixture.projectId,
    missionId: fixture.missionId,
    goalId: fixture.goalId,
    reasonCode,
    planRevision,
    requestedAt: fixture.now,
  }));
  return { intentId, planRevision, reasonCode };
}

afterEach(async () => {
  autoReplanMission.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }
});

describe("Mission replan Outbox", () => {
  it("recovers a committed retryable Task failure after the immediate caller is lost", async () => {
    const fixture = await createFixture();
    const intentId = await createIntent(fixture);
    expect(intentId).toBe(missionReplanIntentId("acceptance-" + fixture.goalId));

    autoReplanMission.mockResolvedValue({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "auto-replan-v2",
      plan: {},
      runs: [],
    });

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(1);
    expect(autoReplanMission).toHaveBeenCalledOnce();
    expect(autoReplanMission).toHaveBeenCalledWith(fixture.missionId);

    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      executionId: "execution-" + fixture.goalId,
      attempt: 2,
      acceptanceId: "acceptance-" + fixture.goalId,
      attemptCount: 0,
      dispatchOutcome: "replanned",
      planRevision: "auto-replan-v2",
    });
    expect(intent?.payload).not.toHaveProperty("dispatchLease");
    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(0);
  });

  it("dispatches a Goal admission replan without inventing an execution acceptance", async () => {
    const fixture = await createFixture();
    const admission = await createAdmissionIntent(fixture, "dependency_proof_unproven");
    expect(admission.intentId).toBe(missionReplanAdmissionIntentId({
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      reasonCode: admission.reasonCode,
      planRevision: admission.planRevision,
    }));

    autoReplanMission.mockResolvedValue({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "admission-replan-v1",
      plan: {},
      runs: [],
    });

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(1);
    expect(autoReplanMission).toHaveBeenCalledOnceWith(fixture.missionId);

    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, admission.intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      source: "goal_admission",
      missionId: fixture.missionId,
      projectId: fixture.projectId,
      goalId: fixture.goalId,
      admissionKey: admission.intentId,
      reasonCode: "dependency_proof_unproven",
      sourcePlanRevision: admission.planRevision,
      dispatchOutcome: "replanned",
      planRevision: "admission-replan-v1",
    });
    expect(intent?.payload).not.toHaveProperty("executionId");
    expect(intent?.payload).not.toHaveProperty("acceptanceId");
    expect(intent?.payload).not.toHaveProperty("attempt");
  });

  it("revalidates against the plan revision stored in the Goal outcome contract", async () => {
    const fixture = await createFixture();
    const admission = await createAdmissionIntent(
      fixture,
      "dependency_proof_unproven",
      "outcomeContract",
    );
    autoReplanMission.mockResolvedValue({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "outcome-contract-replan-v1",
      plan: {},
      runs: [],
    });

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(1);
    expect(autoReplanMission).toHaveBeenCalledOnceWith(fixture.missionId);
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, admission.intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      source: "goal_admission",
      sourcePlanRevision: admission.planRevision,
      dispatchOutcome: "replanned",
    });
  });

  it("dispatches failed-dependency admission requests through the same planner", async () => {
    const fixture = await createFixture();
    const admission = await createAdmissionIntent(fixture, "dependency_failed");
    autoReplanMission.mockResolvedValue({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "failed-dependency-replan-v1",
      plan: {},
      runs: [],
    });

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(1);
    expect(autoReplanMission).toHaveBeenCalledOnceWith(fixture.missionId);
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, admission.intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_DISPATCHED);
    expect(intent?.payload).toMatchObject({
      source: "goal_admission",
      reasonCode: "dependency_failed",
      sourcePlanRevision: admission.planRevision,
      dispatchOutcome: "replanned",
    });
  });

  it("supersedes an admission wake when its blocked reason changes", async () => {
    const fixture = await createFixture();
    const admission = await createAdmissionIntent(fixture);
    await db.update(aiGoalsTable)
      .set({ blockedReason: "dependency_failed" })
      .where(eq(aiGoalsTable.id, fixture.goalId));

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(0);
    expect(autoReplanMission).not.toHaveBeenCalled();
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, admission.intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_SUPERSEDED);
    expect(intent?.payload).toMatchObject({
      source: "goal_admission",
      reason: "mission_or_goal_state_changed",
    });
  });

  it("supersedes an admission wake from an older plan revision", async () => {
    const fixture = await createFixture();
    const admission = await createAdmissionIntent(fixture);
    const newRevision = "new-plan-" + fixture.goalId;
    await db.update(aiGoalsTable).set({
      successCriteria: {
        kind: "mission_plan_step",
        planRevision: { hash: newRevision },
      },
    }).where(eq(aiGoalsTable.id, fixture.goalId));
    await db.update(aiMissionsTable).set({
      autonomyPolicy: {
        mode: "autonomous",
        maxAutoReplans: 3,
        activePlanRevision: newRevision,
      },
    }).where(eq(aiMissionsTable.id, fixture.missionId));

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(0);
    expect(autoReplanMission).not.toHaveBeenCalled();
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, admission.intentId))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_SUPERSEDED);
    expect(intent?.payload).toMatchObject({
      source: "goal_admission",
      reason: "mission_or_goal_state_changed",
    });
  });

  it("serializes cross-replica claims and reclaims an expired dispatch lease", async () => {
    const fixture = await createFixture();
    const intentId = await createIntent(fixture);
    const contenders = await Promise.all([
      db.transaction((tx) => claimMissionReplanDispatchLease(tx, { intentId })),
      db.transaction((tx) => claimMissionReplanDispatchLease(tx, { intentId })),
    ]);
    const winners = contenders.filter((result) => result.acquired);
    expect(winners).toHaveLength(1);
    const firstLease = winners[0];
    if (!firstLease.acquired) throw new Error("Expected one Mission replan lease owner.");

    const [leasedIntent] = await db.select({
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(leasedIntent?.payload?.dispatchLease).toMatchObject({
      token: firstLease.token,
      expiresAt: firstLease.expiresAt,
    });

    await db.update(eventsTable).set({
      payload: {
        ...(leasedIntent?.payload ?? {}),
        dispatchLease: {
          token: firstLease.token,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    }).where(eq(eventsTable.id, intentId));

    const recovered = await db.transaction((tx) =>
      claimMissionReplanDispatchLease(tx, { intentId }),
    );
    expect(recovered.acquired).toBe(true);
    if (!recovered.acquired) throw new Error("Expected an expired Mission replan lease to be recoverable.");
    expect(recovered.token).not.toBe(firstLease.token);
  });

  it("fences an expired replan worker after a replacement dispatch takes over", async () => {
    const fixture = await createFixture();
    const intentId = await createIntent(fixture);

    let releaseFirst!: () => void;
    let announceFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      announceFirst = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const resultFor = (revision: string) => ({
      status: "replanned" as const,
      missionId: fixture.missionId,
      revision,
      plan: {},
      runs: [],
    });
    autoReplanMission
      .mockImplementationOnce(async () => {
        announceFirst();
        await firstRelease;
        return resultFor("stale-worker-revision");
      })
      .mockResolvedValueOnce(resultFor("replacement-worker-revision"));

    const staleDispatch = dispatchMissionReplanIntent(intentId);
    await firstEntered;

    const [leasedIntent] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(leasedIntent?.payload).toMatchObject({
      dispatchLease: { token: expect.any(String) },
    });
    await db.update(eventsTable).set({
      payload: sql`jsonb_set(
        ${eventsTable.payload},
        '{dispatchLease,expiresAt}',
        to_jsonb(to_char(
          (clock_timestamp() - interval '1 second') AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )),
        true
      )`,
    }).where(eq(eventsTable.id, intentId));

    await expect(dispatchMissionReplanIntent(intentId)).resolves.toBe(true);
    const [replacement] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(replacement?.payload).toMatchObject({
      dispatchOutcome: "replanned",
      planRevision: "replacement-worker-revision",
    });
    const replacementProcessedAt = replacement?.payload?.processedAt;
    expect(typeof replacementProcessedAt).toBe("string");

    releaseFirst();
    await expect(staleDispatch).resolves.toBe(false);

    const [finalIntent] = await db.select({ payload: eventsTable.payload })
      .from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(finalIntent?.payload?.processedAt).toBe(replacementProcessedAt);
    expect(finalIntent?.payload?.planRevision).toBe("replacement-worker-revision");
    expect(finalIntent?.payload?.dispatchOutcome).toBe("replanned");
    expect(finalIntent?.payload).not.toHaveProperty("dispatchLease");
    expect(autoReplanMission).toHaveBeenCalledTimes(2);
  });

  it("defers planner errors with bounded retry, then dispatches when due", async () => {
    const fixture = await createFixture();
    const intentId = await createIntent(fixture);
    autoReplanMission.mockRejectedValueOnce(new Error("temporary_planner_failure"));

    expect(await dispatchMissionReplanIntent(intentId)).toBe(false);
    const [deferred] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(eq(eventsTable.id, intentId))
      .limit(1);
    expect(deferred?.type).toBe(MISSION_REPLAN_DEFERRED);
    expect(deferred?.payload).toMatchObject({
      attemptCount: 1,
      lastFailureCode: "MISSION_REPLAN_DISPATCH_FAILED",
    });

    await db.update(eventsTable).set({
      payload: {
        ...(deferred?.payload ?? {}),
        nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      },
    }).where(eq(eventsTable.id, intentId));
    autoReplanMission.mockResolvedValueOnce({
      status: "replanned",
      missionId: fixture.missionId,
      revision: "auto-replan-v3",
      plan: {},
      runs: [],
    });

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(1);
    expect(autoReplanMission).toHaveBeenCalledTimes(2);
  });

  it("retires a request when the accepted Goal is no longer in needs_replan", async () => {
    const fixture = await createFixture();
    const intentId = await createIntent(fixture);
    await db.update(aiGoalsTable)
      .set({ status: "failed" })
      .where(eq(aiGoalsTable.id, fixture.goalId));

    expect(await dispatchPendingMissionReplans(10, fixture.projectId)).toBe(0);
    expect(autoReplanMission).not.toHaveBeenCalled();
    const [intent] = await db.select({
      type: eventsTable.type,
      payload: eventsTable.payload,
    }).from(eventsTable)
      .where(and(
        eq(eventsTable.id, intentId),
        eq(eventsTable.projectId, fixture.projectId),
      ))
      .limit(1);
    expect(intent?.type).toBe(MISSION_REPLAN_SUPERSEDED);
    expect(intent?.payload).toMatchObject({
      goalId: fixture.goalId,
      reason: "mission_or_goal_state_changed",
    });
  });
});
