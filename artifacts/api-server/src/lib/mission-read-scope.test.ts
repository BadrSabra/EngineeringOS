import { describe, expect, it } from "vitest";
import {
  buildMissionReadScopeHash,
  MISSION_READ_SCOPE_POLICY_VERSION,
} from "./mission-read-scope.js";

const baseScope = {
  projectId: "project-1",
  missionId: "mission-1",
  goalId: "goal-1",
  taskId: "task-1",
  profile: "mission_observe",
  projectRevision: "revision-1",
  toolName: "read_file" as const,
  approvedTargetPaths: ["src/one.ts", "src/two.ts"],
  manifestHash: "a".repeat(64),
};

describe("Mission read scope fingerprint", () => {
  it("produces a stable hash for the canonical server-approved path set", () => {
    const first = buildMissionReadScopeHash(baseScope);
    const reordered = buildMissionReadScopeHash({
      ...baseScope,
      approvedTargetPaths: ["src/two.ts", "src/one.ts", "src/one.ts"],
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(reordered);
    expect(first).not.toContain("src/one.ts");
    expect(MISSION_READ_SCOPE_POLICY_VERSION).toBe("mission-read-scope-v1");
  });

  it("changes when the approved scope, revision, profile, or capability policy changes", () => {
    const baseline = buildMissionReadScopeHash(baseScope);

    expect(buildMissionReadScopeHash({
      ...baseScope,
      approvedTargetPaths: ["src/other.ts"],
    })).not.toBe(baseline);
    expect(buildMissionReadScopeHash({
      ...baseScope,
      projectRevision: "revision-2",
    })).not.toBe(baseline);
    expect(buildMissionReadScopeHash({
      ...baseScope,
      profile: "mission_validate",
    })).not.toBe(baseline);
    expect(buildMissionReadScopeHash({
      ...baseScope,
      toolName: "read_file_range",
    })).not.toBe(baseline);
  });

  it("binds project-tree and Git observations to distinct fixed server policies", () => {
    const treeHash = buildMissionReadScopeHash({
      ...baseScope,
      toolName: "project.list_tree",
    });
    const gitHash = buildMissionReadScopeHash({
      ...baseScope,
      toolName: "git_status",
    });

    expect(treeHash).not.toBe(gitHash);
  });
});