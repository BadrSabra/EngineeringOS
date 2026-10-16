import { describe, expect, it } from "vitest";
import {
  executionProfileForMissionStep,
  isMissionToolLoopProfile,
  missionObjectiveContract,
} from "./mission-execution-profile.js";

describe("Mission execution profiles", () => {
  it("maps server-owned plan steps to the intended executor", () => {
    expect(executionProfileForMissionStep("inspect")).toBe("mission_observe");
    expect(executionProfileForMissionStep("analyze")).toBe("mission_observe");
    expect(executionProfileForMissionStep("execute")).toBe("mission_repair");
    expect(executionProfileForMissionStep("validate")).toBe("mission_validate");
    expect(executionProfileForMissionStep("deliver")).toBe("delivery");
    expect(executionProfileForMissionStep("deliver", false, true)).toBe("mission_observe");
    expect(executionProfileForMissionStep("execute", true)).toBe("delivery");
  });

  it("never treats analysis or delivery as a Mission tool-loop profile", () => {
    expect(isMissionToolLoopProfile("analysis")).toBe(false);
    expect(isMissionToolLoopProfile("delivery")).toBe(false);
    expect(isMissionToolLoopProfile("mission_observe")).toBe(true);
  });

  it("binds scoped read-only observations to one evidence claim per approved path", () => {
    const objective = missionObjectiveContract({
      objective: "Inspect README.md and package.json and summarize only verified facts.",
      profile: "mission_observe",
      targetPaths: ["README.md", "package.json"],
    });

    expect(objective.objectiveType).toBe("PROJECT_QUERY_MISSION_OBSERVE");
    expect(objective.requiredEvidencePaths).toEqual(["README.md", "package.json"]);
    expect(objective.requiredClaims.map((claim) => ({
      claimId: claim.claimId,
      requiredEvidencePaths: claim.requiredEvidencePaths,
    }))).toEqual([
      { claimId: "mission-observe-file-1", requiredEvidencePaths: ["README.md"] },
      { claimId: "mission-observe-file-2", requiredEvidencePaths: ["package.json"] },
    ]);
    expect(objective.requiredClaims.every((claim) => claim.text.split(/\s+/u).length >= 5)).toBe(true);
  });

  it("keeps unscoped Mission observations outside the targeted project-query proof path", () => {
    const objective = missionObjectiveContract({
      objective: "Inspect the relevant project context.",
      profile: "mission_observe",
      targetPaths: [],
    });

    expect(objective.objectiveType).toBe("MISSION_MISSION_OBSERVE");
    expect(objective.requiredClaims).toHaveLength(1);
  });
});