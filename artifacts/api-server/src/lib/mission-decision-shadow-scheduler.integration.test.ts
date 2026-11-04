import { afterEach, describe, expect, it, vi } from "vitest";

const {
  reconcileShadows,
  dispatchAutonomousTaskRecoveries,
  reconcileAutomaticMissionReplans,
  reconcileApprovedMissionDecisionDispatches,
  dispatchPendingMissionRecipes,
  replayPendingMissionEvents,
  dispatchPendingShadowReplays,
  dispatchPendingMissionChatHandoffs,
  dispatchProjectBootstrapJobs,
  reconcilePendingMissionPlanOutcomes,
  wakeDueMissionGoals,
  wakeReadyMissionGoals,
  wakeRuntimeTransitionMissionGoals,
  wakeApplyChangesMissionGoals,
} = vi.hoisted(() => ({
  reconcileShadows: vi.fn(async () => 0),
  dispatchAutonomousTaskRecoveries: vi.fn(async () => 0),
  reconcileAutomaticMissionReplans: vi.fn(async () => 0),
  reconcileApprovedMissionDecisionDispatches: vi.fn(async () => 0),
  dispatchPendingMissionRecipes: vi.fn(async () => 0),
  replayPendingMissionEvents: vi.fn(async () => 0),
  dispatchPendingShadowReplays: vi.fn(async () => 0),
  dispatchPendingMissionChatHandoffs: vi.fn(async () => 0),
  dispatchProjectBootstrapJobs: vi.fn(async () => 0),
  reconcilePendingMissionPlanOutcomes: vi.fn(async () => 0),
  wakeDueMissionGoals: vi.fn(async () => 0),
  wakeReadyMissionGoals: vi.fn(async () => 0),
  wakeRuntimeTransitionMissionGoals: vi.fn(async () => 0),
  wakeApplyChangesMissionGoals: vi.fn(async () => 0),
}));

vi.mock("./mission-strategy-shadow-store.js", () => ({
  reconcilePendingMissionDecisionShadows: reconcileShadows,
}));
vi.mock("./ai-recovery-coordinator.js", () => ({
  dispatchAutonomousTaskRecoveries,
}));
vi.mock("./mission-auto-replan.js", () => ({
  reconcileAutomaticMissionReplans,
  reconcileApprovedMissionDecisionDispatches,
}));
vi.mock("./mission-runtime.js", () => ({
  dispatchPendingMissionRecipes,
  replayPendingMissionEvents,
  wakeDueMissionGoals,
  wakeReadyMissionGoals,
  wakeRuntimeTransitionMissionGoals,
  wakeApplyChangesMissionGoals,
}));
vi.mock("./mission-strategy-plan-outcome-store.js", () => ({
  reconcilePendingMissionPlanOutcomes,
}));
vi.mock("./shadow-replay.js", () => ({
  dispatchPendingShadowReplays,
}));
vi.mock("./mission-chat-handoffs.js", () => ({
  dispatchPendingMissionChatHandoffs,
}));
vi.mock("./project-bootstrap.js", () => ({
  dispatchProjectBootstrapJobs,
}));

import {
  dispatchPersistedPendingJobs,
  startScopedMissionLifecycleDispatcher,
} from "./job-reconciliation.js";

const allowedProjectId = "cfb1a4f5-68c7-4f65-9fe3-4ef71d0653d2";
const otherProjectId = "7a2fe3de-b1f4-48ba-8dc9-aebde944d294";

async function settleScopedDispatch(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Mission decision shadow scheduler integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    reconcileShadows.mockClear();
    dispatchAutonomousTaskRecoveries.mockClear();
    reconcileAutomaticMissionReplans.mockClear();
    reconcileApprovedMissionDecisionDispatches.mockClear();
    dispatchPendingMissionRecipes.mockClear();
    replayPendingMissionEvents.mockClear();
    dispatchPendingShadowReplays.mockClear();
    dispatchPendingMissionChatHandoffs.mockClear();
    dispatchProjectBootstrapJobs.mockClear();
    reconcilePendingMissionPlanOutcomes.mockClear();
    wakeDueMissionGoals.mockClear();
    wakeReadyMissionGoals.mockClear();
    wakeRuntimeTransitionMissionGoals.mockClear();
    wakeApplyChangesMissionGoals.mockClear();
  });

  it("does not invoke the sidecar writer when shadow mode is unset", async () => {
    vi.stubEnv("MISSION_DECISION_SHADOW_MODE", undefined);
    vi.stubEnv("MISSION_DECISION_SHADOW_PROJECT_ID", allowedProjectId);

    await dispatchPersistedPendingJobs();

    expect(reconcileShadows).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid configured project UUID", "not-a-project-id", undefined],
    ["an invalid requested project UUID", allowedProjectId, "not-a-project-id"],
    ["a project outside the configured allowlist", allowedProjectId, otherProjectId],
  ])("does not start reconciliation for %s", async (_caseName, configuredProjectId, requestedProjectId) => {
    vi.stubEnv("MISSION_DECISION_SHADOW_MODE", "1");
    vi.stubEnv("MISSION_DECISION_SHADOW_PROJECT_ID", configuredProjectId);

    const interval = vi.spyOn(globalThis, "setInterval").mockReturnValue({} as NodeJS.Timeout);
    startScopedMissionLifecycleDispatcher(requestedProjectId ?? allowedProjectId);
    await settleScopedDispatch();
    interval.mockRestore();

    expect(reconcileShadows).not.toHaveBeenCalled();
  });

  it("reconciles only the allowlisted project with the scheduler's bounded batch", async () => {
    vi.stubEnv("MISSION_DECISION_SHADOW_MODE", "1");
    vi.stubEnv("MISSION_DECISION_SHADOW_PROJECT_ID", allowedProjectId);

    await dispatchPersistedPendingJobs();

    expect(reconcileShadows).toHaveBeenCalledTimes(1);
    expect(reconcileShadows).toHaveBeenCalledWith(16, allowedProjectId);
  });
});
