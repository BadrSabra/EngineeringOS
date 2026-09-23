import { describe, expect, it } from "vitest";
import {
  buildMissionDelegationBinding,
  validateMissionDelegationBinding,
} from "./mission-delegation.js";

describe("Mission delegation binding", () => {
  it("binds a dispatch to one mission, goal, task, owner, and revision", () => {
    const binding = buildMissionDelegationBinding({
      missionId: "mission",
      goalId: "goal",
      taskId: "task",
      planRevision: "revision",
      userId: "user",
      trigger: "resume",
    });

    expect(validateMissionDelegationBinding(binding, {
      missionId: "mission",
      goalId: "goal",
      taskId: "task",
      planRevision: "revision",
      userId: "user",
    })).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("rejects stale or cross-owner bindings", () => {
    const binding = buildMissionDelegationBinding({
      missionId: "mission",
      goalId: "goal",
      taskId: null,
      planRevision: "old-revision",
      userId: "user",
      trigger: "wake",
    });

    expect(validateMissionDelegationBinding(binding, {
      missionId: "mission",
      goalId: "goal",
      taskId: null,
      planRevision: "new-revision",
      userId: "other-user",
    })).toMatchObject({ allowed: false, reason: "user_mismatch" });
    expect(validateMissionDelegationBinding(binding, {
      missionId: "mission",
      goalId: "goal",
      taskId: null,
      planRevision: "new-revision",
      userId: "user",
    })).toMatchObject({ allowed: false, reason: "plan_revision_mismatch" });
  });
});