import type { ObjectiveContract } from "./schemas/chat.schema.js";
import {
  buildProjectQueryObjective,
  type ProjectQueryTarget,
} from "./project-query-target.js";

export type ActiveEvidenceContractSource =
  | "explicit"
  | "inferred"
  | "capability_probe"
  | "none";

export type ActiveEvidenceContract = {
  source: ActiveEvidenceContractSource;
  objective?: ObjectiveContract;
  projectQuery?: ProjectQueryTarget;
};

/**
 * Resolve the one evidence contract that governs this turn.
 *
 * Explicit objectives are authoritative. A Capability Probe may retain its
 * own durable identity, but it must not inherit a project-query objective
 * inferred only from the natural-language target. This keeps routing metadata
 * and evidence enforcement on the same contract source.
 */
export function resolveActiveEvidenceContract(params: {
  explicitObjective?: ObjectiveContract;
  projectQueryTarget?: ProjectQueryTarget;
  capabilityProbeTurn: boolean;
  message: string;
}): ActiveEvidenceContract {
  if (params.explicitObjective) {
    return {
      source: "explicit",
      objective: params.explicitObjective,
      projectQuery: params.projectQueryTarget,
    };
  }

  if (params.capabilityProbeTurn) {
    return { source: "capability_probe" };
  }

  if (params.projectQueryTarget) {
    return {
      source: "inferred",
      objective: buildProjectQueryObjective(params.projectQueryTarget, params.message),
      projectQuery: params.projectQueryTarget,
    };
  }

  return { source: "none" };
}