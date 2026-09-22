import { describe, expect, it } from "vitest";
import {
  executionProfileForMissionStep,
  isMissionToolLoopProfile,
} from "./mission-execution-profile.js";

describe("Mission execution profiles", () => {
  it("maps server-owned plan steps to the intended executor", () => {
    expect(executionProfileForMissionStep("inspect")).toBe("mission_observe");
    expect(executionProfileForMissionStep("analyze")).toBe("mission_observe");
    expect(executionProfileForMissionStep("execute")).toBe("mission_repair");
    expect(executionProfileForMissionStep("validate")).toBe("mission_validate");
    expect(executionProfileForMissionStep("deliver")).toBe("delivery");
    expect(executionProfileForMissionStep("execute", true)).toBe("delivery");
  });

  it("never treats analysis or delivery as a Mission tool-loop profile", () => {
    expect(isMissionToolLoopProfile("analysis")).toBe(false);
    expect(isMissionToolLoopProfile("delivery")).toBe(false);
    expect(isMissionToolLoopProfile("mission_observe")).toBe(true);
  });
});