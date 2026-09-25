import {
  canonicalJsonHash,
  type ReadOnlyToolInvocation,
} from "@workspace/ai-orchestrator";

export type MissionReadScopeToolName = Extract<
  ReadOnlyToolInvocation["toolName"],
  | "read_file"
  | "read_file_range"
  | "project.list_tree"
  | "git_status"
  | "git_diff"
  | "git_log"
>;

export const MISSION_READ_SCOPE_POLICY_VERSION = "mission-read-scope-v1";

// Bump these policy identifiers when the server-side path enforcement or the
// fixed tree/Git read behavior changes. The full effective tool manifest hash
// is also included in each scope fingerprint.
const MISSION_READ_TOOL_SCOPE_POLICIES: Record<MissionReadScopeToolName, string> = {
  read_file: "approved-target-path-set-v1",
  read_file_range: "approved-target-path-set-v1",
  "project.list_tree": "server-bounded-metadata-tree-no-model-args-v1",
  git_status: "server-project-git-status-short-untracked-v1",
  git_diff: "server-project-git-diff-head-approved-target-filter-v1",
  git_log: "server-project-git-log-last-15-v1",
};

export function isMissionReadScopeToolName(
  toolName: ReadOnlyToolInvocation["toolName"],
): toolName is MissionReadScopeToolName {
  return Object.prototype.hasOwnProperty.call(MISSION_READ_TOOL_SCOPE_POLICIES, toolName);
}

export type MissionReadScopeHashInput = {
  projectId: string;
  missionId: string | null;
  goalId: string;
  taskId: string;
  profile: string;
  projectRevision: string;
  toolName: MissionReadScopeToolName;
  approvedTargetPaths: readonly string[];
  manifestHash: string;
};

export function buildMissionReadScopeHash(input: MissionReadScopeHashInput): string {
  return canonicalJsonHash({
    kind: "mission_read_scope",
    policyVersion: MISSION_READ_SCOPE_POLICY_VERSION,
    projectId: input.projectId,
    missionId: input.missionId,
    goalId: input.goalId,
    taskId: input.taskId,
    profile: input.profile,
    projectRevision: input.projectRevision,
    toolName: input.toolName,
    toolPolicy: MISSION_READ_TOOL_SCOPE_POLICIES[input.toolName],
    approvedTargetPaths: [...new Set(input.approvedTargetPaths)].sort(),
    manifestHash: input.manifestHash,
  });
}