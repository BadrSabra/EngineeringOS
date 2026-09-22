import type { GeneralTaskPlanStepKind } from "@workspace/ai-orchestrator";
import type { ObjectiveContract } from "@workspace/ai-orchestrator";

export const MISSION_EXECUTION_PROFILES = [
  "analysis",
  "mission_observe",
  "mission_repair",
  "mission_validate",
  "delivery",
] as const;

export type MissionExecutionProfile = (typeof MISSION_EXECUTION_PROFILES)[number];

/**
 * Execution profile is derived from the server-owned plan step. The provider
 * and the model never select this value.
 */
export function executionProfileForMissionStep(
  kind: GeneralTaskPlanStepKind,
  hasRecipe = false,
): MissionExecutionProfile {
  if (hasRecipe || kind === "deliver") return "delivery";
  if (kind === "execute") return "mission_repair";
  if (kind === "validate") return "mission_validate";
  if (kind === "inspect" || kind === "analyze") return "mission_observe";
  return "analysis";
}

export function isMissionToolLoopProfile(
  profile: MissionExecutionProfile,
): profile is Exclude<MissionExecutionProfile, "analysis" | "delivery"> {
  return profile === "mission_observe"
    || profile === "mission_repair"
    || profile === "mission_validate";
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export function readMissionExecutionProfile(
  outcomeContract: unknown,
  phase: string | null | undefined,
): MissionExecutionProfile {
  const stored = asRecord(outcomeContract).executionProfile;
  if (typeof stored === "string" && MISSION_EXECUTION_PROFILES.includes(stored as MissionExecutionProfile)) {
    return stored as MissionExecutionProfile;
  }
  if (!["inspect", "analyze", "execute", "validate", "deliver"].includes(phase ?? "")) {
    // Legacy tasks do not carry a Mission plan step. Preserve their existing
    // TaskAgent behavior instead of silently upgrading them to tool execution.
    return "analysis";
  }
  return executionProfileForMissionStep(phase as GeneralTaskPlanStepKind);
}

export function missionObjectiveContract(params: {
  objective: string;
  profile: Exclude<MissionExecutionProfile, "analysis" | "delivery">;
  targetPaths: readonly string[];
}): ObjectiveContract {
  const targetPaths = [...new Set(params.targetPaths.filter(Boolean))].slice(0, 48);
  const claim = {
    claimId: "mission-objective-proven",
    text: params.objective.trim().slice(0, 2_000),
    ...(targetPaths.length > 0 ? { requiredEvidencePaths: targetPaths } : {}),
  };
  return {
    objectiveType: `MISSION_${params.profile.toUpperCase()}`,
    goal: params.objective.trim().slice(0, 2_000),
    ...(targetPaths.length > 0 ? { requiredEvidencePaths: targetPaths } : {}),
    requiredClaims: [claim],
    requiredEvidenceEdges: [],
  };
}