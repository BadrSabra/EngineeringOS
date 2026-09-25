import type { AgentAction, EffectContract } from "@workspace/ai-orchestrator";

export const MISSION_REPAIR_CAPABILITY_ID = "mission.repair.candidate-materialization";
export const MISSION_REPAIR_EFFECT_ID = "mission.repair.candidate-tree-observed";
export const MISSION_REPAIR_TOOL_CAPABILITY_ID = "mission.repair.candidate-change-staging";
export const MISSION_REPAIR_TOOL_STAGED_EFFECT_ID = "mission.repair.pending-change-staged";

export function buildMissionRepairToolAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  missionId: string;
  goalId: string;
  taskId: string;
  executionId: string;
  attempt: number;
  sourceRevision: string;
  goalRevision: string;
  planRevision?: string;
  toolName: "write_file" | "replace_text";
  targetPath: string;
  toolCallIdentity: string;
  inputHash: string;
  approvedPaths: readonly string[];
}): AgentAction {
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: MISSION_REPAIR_TOOL_CAPABILITY_ID,
    intent: "Stage one server-approved Mission repair change in the candidate overlay for later verification.",
    triggerConditions: [{
      kind: "server_route",
      route: "task.executeMissionRepair",
    }],
    scope: {
      projectId: input.projectId,
      missionId: input.missionId,
      goalId: input.goalId,
      taskId: input.taskId,
      executionId: input.executionId,
      attempt: input.attempt,
      sourceRevision: input.sourceRevision,
      goalRevision: input.goalRevision,
      ...(input.planRevision ? { planRevision: input.planRevision } : {}),
      toolName: input.toolName,
      targetPath: input.targetPath,
      toolCallIdentity: input.toolCallIdentity,
      inputHash: input.inputHash,
      approvedPaths: [...input.approvedPaths],
      candidateOverlayOnly: true,
      liveWorkspaceWrites: false,
    },
    preconditions: [
      "The server selected the Mission repair profile and confirmed plan approval.",
      "The target path is normalized and included in the server-approved path scope.",
      "The change is staged only in the in-memory candidate overlay; the live project root is not written.",
    ],
    expectedEffects: [MISSION_REPAIR_TOOL_STAGED_EFFECT_ID],
    authorization: {
      source: "server",
      capability: MISSION_REPAIR_TOOL_CAPABILITY_ID,
      missionId: input.missionId,
      goalId: input.goalId,
      taskId: input.taskId,
    },
    risk: "HIGH",
    idempotencyKey: input.actionId,
    observationProfile: "CANDIDATE_OVERLAY",
    failureSemantics: [
      "Missing action identity, approval, or an in-scope target path blocks the tool call before staging.",
      "ACTION_COMMITTED records candidate-overlay staging only and does not prove a workspace effect.",
      "The aggregate candidate still requires direct before/after observations and the existing effect gate.",
    ],
  };
}

export function buildMissionRepairAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  missionId: string;
  goalId: string;
  taskId: string;
  executionId: string;
  attempt: number;
  sourceRevision: string;
  goalRevision: string;
  planRevision?: string;
  candidateIdentity: string;
  baseTreeHash: string;
  approvedPaths: readonly string[];
}): AgentAction {
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: MISSION_REPAIR_CAPABILITY_ID,
    intent: "Materialize the server-authorized Mission repair candidate in a disposable workspace for verification.",
    triggerConditions: [{
      kind: "server_route",
      route: "task.executeMissionRepair",
    }],
    scope: {
      projectId: input.projectId,
      missionId: input.missionId,
      goalId: input.goalId,
      taskId: input.taskId,
      executionId: input.executionId,
      attempt: input.attempt,
      sourceRevision: input.sourceRevision,
      goalRevision: input.goalRevision,
      ...(input.planRevision ? { planRevision: input.planRevision } : {}),
      candidateIdentity: input.candidateIdentity,
      baseTreeHash: input.baseTreeHash,
      approvedPaths: [...input.approvedPaths],
      liveWorkspaceWrites: false,
    },
    preconditions: [
      "The server selected the Mission repair profile and the plan permits these exact target paths.",
      "The candidate is staged only in a disposable validation workspace; the live project root is not written.",
      "The source tree and candidate workspace hashes are read directly and remain bound to this execution attempt.",
    ],
    expectedEffects: [MISSION_REPAIR_EFFECT_ID],
    authorization: {
      source: "server",
      capability: MISSION_REPAIR_CAPABILITY_ID,
      missionId: input.missionId,
      goalId: input.goalId,
      taskId: input.taskId,
    },
    risk: "HIGH",
    idempotencyKey: `mission-repair-candidate:${input.executionId}:${input.attempt}`,
    observationProfile: "WORKSPACE",
    failureSemantics: [
      "A candidate outside the server-approved path scope is rejected.",
      "A missing, stale, unchanged, or mismatched candidate observation cannot produce an observed effect.",
      "Candidate verification never promotes bytes into the live project root.",
    ],
  };
}

export function buildMissionRepairEffectContract(input: {
  projectId: string;
  taskId: string;
  candidateIdentity: string;
  candidateTreeHash: string;
  beforeEvidenceRef: string;
  afterEvidenceRef: string;
}): EffectContract {
  return {
    schemaVersion: "1",
    effectId: MISSION_REPAIR_EFFECT_ID,
    expectedStateChanges: [{
      subject: `project:${input.projectId}:task:${input.taskId}:candidate:${input.candidateIdentity}`,
      predicate: "workspace.tree_hash",
      expectedValue: input.candidateTreeHash,
    }],
    observationProfile: "WORKSPACE",
    requiredEvidence: [input.beforeEvidenceRef, input.afterEvidenceRef],
    allowedResult: "OBSERVED",
  };
}