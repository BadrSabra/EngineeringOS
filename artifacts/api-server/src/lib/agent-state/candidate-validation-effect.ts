import type {
  AgentAction,
  EffectContract,
} from "@workspace/ai-orchestrator";

export const CANDIDATE_VALIDATION_CAPABILITY_ID = "candidate.validation";
export const CANDIDATE_VALIDATION_EFFECT_ID = "candidate.validation.observed";

export function buildCandidateValidationAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  operationId: string;
  sourceRevision: string;
  candidateIdentity: string;
  approvedPaths: readonly string[];
}): AgentAction {
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: CANDIDATE_VALIDATION_CAPABILITY_ID,
    intent: "Validate the immutable candidate against the server-owned validation profile.",
    scope: {
      projectId: input.projectId,
      operationId: input.operationId,
      sourceRevision: input.sourceRevision,
      candidateIdentity: input.candidateIdentity,
      approvedPaths: [...input.approvedPaths],
    },
    preconditions: [
      "The candidate workspace is inside the server-owned disposable root.",
      "The candidate identity and source revision are bound to this execution.",
      "Only the registered validation profile may execute.",
    ],
    expectedEffects: [CANDIDATE_VALIDATION_EFFECT_ID],
    authorization: {
      source: "server",
      capability: CANDIDATE_VALIDATION_CAPABILITY_ID,
    },
    risk: "LOW",
    idempotencyKey: `candidate-validation:${input.operationId}:${input.episodeId}`,
    observationProfile: "WORKSPACE",
    failureSemantics: [
      "A missing or stale after observation cannot produce PROVEN.",
      "A candidate workspace change during validation is a failed effect.",
    ],
  };
}

export function buildCandidateValidationEffectContract(input: {
  candidateIdentity: string;
  beforeEvidenceRef: string;
  afterEvidenceRef: string;
}): EffectContract {
  return {
    schemaVersion: "1",
    effectId: CANDIDATE_VALIDATION_EFFECT_ID,
    expectedStateChanges: [{
      subject: `candidate:${input.candidateIdentity}`,
      predicate: "validation.status",
      expectedValue: "passed",
    }],
    observationProfile: "WORKSPACE",
    requiredEvidence: [input.beforeEvidenceRef, input.afterEvidenceRef],
    allowedResult: "OBSERVED",
  };
}