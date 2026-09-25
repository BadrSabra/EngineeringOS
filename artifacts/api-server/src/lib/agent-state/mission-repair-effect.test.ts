import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  EffectContractSchema,
} from "@workspace/ai-orchestrator";
import {
  buildMissionRepairAction,
  buildMissionRepairEffectContract,
  buildMissionRepairToolAction,
  MISSION_REPAIR_CAPABILITY_ID,
  MISSION_REPAIR_EFFECT_ID,
  MISSION_REPAIR_TOOL_CAPABILITY_ID,
  MISSION_REPAIR_TOOL_STAGED_EFFECT_ID,
} from "./mission-repair-effect.js";

describe("Mission repair Action/Effect contracts", () => {
  const actionInput = {
    actionId: "mission-repair:execution-1:attempt-2",
    episodeId: "episode-1",
    projectId: "project-1",
    missionId: "mission-1",
    goalId: "goal-1",
    taskId: "task-1",
    executionId: "execution-1",
    attempt: 2,
    sourceRevision: "revision-1",
    goalRevision: "2026-09-25T12:00:00.000Z",
    planRevision: "plan-1",
    candidateIdentity: "mission-candidate:abc123",
    baseTreeHash: "base-hash",
    approvedPaths: ["src/target.ts"],
  };

  it("builds a server-owned candidate action scoped to the approved Mission attempt", () => {
    const action = AgentActionSchema.parse(buildMissionRepairAction(actionInput));

    expect(action).toMatchObject({
      actionId: actionInput.actionId,
      episodeId: actionInput.episodeId,
      capabilityId: MISSION_REPAIR_CAPABILITY_ID,
      expectedEffects: [MISSION_REPAIR_EFFECT_ID],
      idempotencyKey: "mission-repair-candidate:execution-1:2",
      authorization: {
        source: "server",
        missionId: "mission-1",
        goalId: "goal-1",
        taskId: "task-1",
      },
      scope: {
        executionId: "execution-1",
        attempt: 2,
        sourceRevision: "revision-1",
        candidateIdentity: "mission-candidate:abc123",
        approvedPaths: ["src/target.ts"],
        liveWorkspaceWrites: false,
      },
    });
  });

  it("binds the expected candidate tree hash to both direct evidence references", () => {
    const contract = EffectContractSchema.parse(buildMissionRepairEffectContract({
      projectId: "project-1",
      taskId: "task-1",
      candidateIdentity: "mission-candidate:abc123",
      candidateTreeHash: "candidate-hash",
      beforeEvidenceRef: "before-observation",
      afterEvidenceRef: "after-observation",
    }));

    expect(contract).toMatchObject({
      effectId: MISSION_REPAIR_EFFECT_ID,
      expectedStateChanges: [{
        subject: "project:project-1:task:task-1:candidate:mission-candidate:abc123",
        predicate: "workspace.tree_hash",
        expectedValue: "candidate-hash",
      }],
      requiredEvidence: ["before-observation", "after-observation"],
      allowedResult: "OBSERVED",
    });
  });

  it("builds an idempotent tool action that records candidate staging, not a workspace effect", () => {
    const action = AgentActionSchema.parse(buildMissionRepairToolAction({
      actionId: "mission-repair-tool:execution-1:2:call-1",
      episodeId: "episode-1",
      projectId: "project-1",
      missionId: "mission-1",
      goalId: "goal-1",
      taskId: "task-1",
      executionId: "execution-1",
      attempt: 2,
      sourceRevision: "revision-1",
      goalRevision: "2026-09-25T12:00:00.000Z",
      planRevision: "plan-1",
      toolName: "replace_text",
      targetPath: "src/target.ts",
      toolCallIdentity: "call-identity-hash",
      inputHash: "a".repeat(64),
      approvedPaths: ["src/target.ts"],
    }));

    expect(action).toMatchObject({
      actionId: "mission-repair-tool:execution-1:2:call-1",
      capabilityId: MISSION_REPAIR_TOOL_CAPABILITY_ID,
      expectedEffects: [MISSION_REPAIR_TOOL_STAGED_EFFECT_ID],
      idempotencyKey: "mission-repair-tool:execution-1:2:call-1",
      authorization: {
        source: "server",
        missionId: "mission-1",
        goalId: "goal-1",
        taskId: "task-1",
      },
      scope: {
        executionId: "execution-1",
        attempt: 2,
        sourceRevision: "revision-1",
        planRevision: "plan-1",
        toolName: "replace_text",
        targetPath: "src/target.ts",
        candidateOverlayOnly: true,
        liveWorkspaceWrites: false,
        approvedPaths: ["src/target.ts"],
      },
    });
  });
});