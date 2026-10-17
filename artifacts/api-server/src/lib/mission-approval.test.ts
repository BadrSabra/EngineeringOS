import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { createAiExecution } from "./ai-execution-state.js";

const { missionRunner } = vi.hoisted(() => ({
  missionRunner: vi.fn(),
}));

vi.mock("./mission-runtime.js", () => ({
  runMissionGoal: missionRunner,
}));

import { approveMissionGoal } from "./mission-approval.js";

const projectIds: string[] = [];

afterEach(async () => {
  missionRunner.mockReset();
  for (const projectId of projectIds.splice(0)) {
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("Mission Goal approval adapter", () => {
  it("atomically opens the current proposal gate and resumes the existing runtime", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    missionRunner.mockResolvedValue({
      status: "scheduled",
      goalId,
      executionId: "resumed-execution",
    });

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-approval-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Apply approved fix",
      intent: "Apply the approved fix and validate it.",
      status: "waiting",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Apply fix",
      status: "waiting_for_approval",
      nextAction: { kind: "wait", reason: "approval", wakeAt: null },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Approval test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "A change is ready for approval.",
      createdAt: now,
    });
    const created = await createAiExecution({
      userId: "test-user",
      request: {
        projectId,
        message: "Apply the approved fix.",
        modelMessage: "Apply the approved fix.",
        validationTargetPaths: [],
      },
      idempotencyKey: `approval-test:${goalId}`,
      projectId,
      goalId,
    });
    await db.update(aiExecutionsTable)
      .set({
        proposalId,
        status: "paused",
        updatedAt: now,
      })
      .where(eq(aiExecutionsTable.id, created.execution.id));
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      status: "pending",
      revision: 4,
      approvalRequired: true,
      lifecycle: "proposed",
      createdAt: now,
    });

    const result = await approveMissionGoal({
      missionId,
      goalId,
      userId: "test-user",
    });

    expect(result).toMatchObject({
      status: "approved",
      missionId,
      goalId,
      executionId: created.execution.id,
      proposalId,
      revision: 4,
      run: { status: "scheduled", goalId },
    });
    expect(missionRunner).toHaveBeenCalledWith({
      goalId,
      userId: "test-user",
      trigger: "resume",
    });

    const [proposal] = await db
      .select({ approvalRequired: aiChangeProposalsTable.approvalRequired })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, proposalId));
    const [goal] = await db
      .select({ status: aiGoalsTable.status })
      .from(aiGoalsTable)
      .where(eq(aiGoalsTable.id, goalId));
    const [mission] = await db
      .select({ status: aiMissionsTable.status })
      .from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId));
    const approvalEvents = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.goalId, goalId),
        eq(eventsTable.type, "AiGoalApprovalGranted"),
      ));
    expect(proposal?.approvalRequired).toBe(false);
    expect(goal?.status).toBe("queued");
    expect(mission?.status).toBe("active");
    expect(approvalEvents).toHaveLength(1);

    const second = await approveMissionGoal({ missionId, goalId, userId: "test-user" });
    expect(second).toMatchObject({
      status: "conflict",
      reason: "goal_not_waiting_for_approval",
    });
  });

  it("does not deadlock against Mission-before-Goal completion locks", async () => {
    const projectId = crypto.randomUUID();
    const missionId = crypto.randomUUID();
    const goalId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const now = new Date();
    projectIds.push(projectId);
    missionRunner.mockResolvedValue({
      status: "scheduled",
      goalId,
      executionId: "resumed-execution",
    });

    await db.insert(projectsTable).values({
      id: projectId,
      ownerId: "test-user",
      name: `mission-approval-lock-order-${projectId.slice(0, 8)}`,
      rootPath: process.cwd(),
      language: "typescript",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiMissionsTable).values({
      id: missionId,
      projectId,
      userId: "test-user",
      title: "Serialize approval",
      intent: "Resume only the current approved proposal",
      status: "waiting",
      scope: { kind: "project", projectId },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiGoalsTable).values({
      id: goalId,
      missionId,
      projectId,
      title: "Approved Goal",
      status: "waiting_for_approval",
      nextAction: { kind: "wait", reason: "approval", wakeAt: null },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatSessionsTable).values({
      id: sessionId,
      projectId,
      title: "Approval lock-order test",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(aiChatMessagesTable).values({
      id: messageId,
      sessionId,
      role: "assistant",
      content: "A change is ready for approval.",
      createdAt: now,
    });
    const created = await createAiExecution({
      userId: "test-user",
      request: {
        projectId,
        message: "Resume the approved Goal.",
        modelMessage: "Resume the approved Goal.",
        validationTargetPaths: [],
      },
      idempotencyKey: `approval-lock-order:${goalId}`,
      projectId,
      goalId,
    });
    await db.update(aiExecutionsTable)
      .set({
        proposalId,
        status: "paused",
        updatedAt: now,
      })
      .where(eq(aiExecutionsTable.id, created.execution.id));
    await db.insert(aiChangeProposalsTable).values({
      id: proposalId,
      projectId,
      sessionId,
      messageId,
      changes: "[]",
      status: "pending",
      revision: 1,
      approvalRequired: true,
      lifecycle: "proposed",
      createdAt: now,
    });

    let releaseMissionLock!: () => void;
    let allowGoalLockAttempt!: () => void;
    let acquiredMissionLock!: () => void;
    const missionLocked = new Promise<void>((resolve) => {
      acquiredMissionLock = resolve;
    });
    const goalLockAttemptAllowed = new Promise<void>((resolve) => {
      allowGoalLockAttempt = resolve;
    });
    const holdMissionThenGoal = db.transaction(async (tx) => {
      await tx.select({ id: aiMissionsTable.id })
        .from(aiMissionsTable)
        .where(eq(aiMissionsTable.id, missionId))
        .for("update");
      acquiredMissionLock();
      await new Promise<void>((resolve) => {
        releaseMissionLock = resolve;
      });
      await goalLockAttemptAllowed;
      await tx.select({ id: aiGoalsTable.id })
        .from(aiGoalsTable)
        .where(eq(aiGoalsTable.id, goalId))
        .for("update");
    });
    await missionLocked;

    const approval = approveMissionGoal({ missionId, goalId, userId: "test-user" });
    const deadline = Date.now() + 10_000;
    let approvalWaitingForMission = false;
    while (Date.now() < deadline && !approvalWaitingForMission) {
      const result = await db.execute(sql`
        SELECT waiting.query
        FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.datname = current_database()
          AND waiting.wait_event_type = 'Lock'
          AND cardinality(pg_blocking_pids(waiting.pid)) > 0
      `);
      const rows = (result as unknown as { rows?: Array<{ query: string | null }> }).rows ?? [];
      approvalWaitingForMission = rows.some((row) => /ai_missions/i.test(row.query ?? ""));
      if (!approvalWaitingForMission) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    releaseMissionLock();
    if (!approvalWaitingForMission) {
      allowGoalLockAttempt();
      await holdMissionThenGoal.catch(() => undefined);
      await approval.catch(() => undefined);
      throw new Error("Approval did not wait for the locked Mission row");
    }

    allowGoalLockAttempt();
    const [lockTransaction, approvalResult] = await Promise.allSettled([
      holdMissionThenGoal,
      approval,
    ]);

    expect(lockTransaction.status).toBe("fulfilled");
    expect(approvalResult).toMatchObject({
      status: "fulfilled",
      value: { status: "approved", missionId, goalId },
    });
  });
});