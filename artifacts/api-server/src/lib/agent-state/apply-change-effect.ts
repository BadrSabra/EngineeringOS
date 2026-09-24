import type { AgentAction, EffectContract } from "@workspace/ai-orchestrator";

export const APPLY_CHANGE_CAPABILITY_ID = "approved.source-promotion";
export const APPLY_CHANGE_EFFECT_ID = "approved.source-promotion.observed";

export function buildApplyChangeAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  operationId: string;
  proposalId: string;
  attemptId: string;
  sourceRevision: string;
  baseTreeHash: string;
  candidateTreeHash: string;
  changeSetHash: string;
  approvedPaths: readonly string[];
}): AgentAction {
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: APPLY_CHANGE_CAPABILITY_ID,
    intent: "Promote the approved immutable source candidate into the project root.",
    triggerConditions: [{ kind: "server_route", route: "ai.chat.apply-changes" }],
    scope: {
      projectId: input.projectId,
      operationId: input.operationId,
      proposalId: input.proposalId,
      attemptId: input.attemptId,
      sourceRevision: input.sourceRevision,
      baseTreeHash: input.baseTreeHash,
      candidateTreeHash: input.candidateTreeHash,
      changeSetHash: input.changeSetHash,
      approvedPaths: [...input.approvedPaths],
    },
    preconditions: [
      "The proposal is server-owned, approved, and the submitted changes are an exact authorized subset.",
      "The immutable candidate passed registered validation and live-root drift checks.",
      "The guarded promotion remains owned by this execution attempt.",
    ],
    expectedEffects: [APPLY_CHANGE_EFFECT_ID],
    authorization: {
      source: "server",
      capability: APPLY_CHANGE_CAPABILITY_ID,
      proposalId: input.proposalId,
    },
    risk: "HIGH",
    idempotencyKey: `approved-source-promotion:${input.attemptId}`,
    observationProfile: "WORKSPACE",
    failureSemantics: [
      "A stale lease stops further writes and enters rollback handling.",
      "A missing, stale, or mismatched after observation cannot produce PROVEN.",
      "Rollback or unknown filesystem state requires recovery and cannot be accepted.",
    ],
  };
}

export function buildApplyChangeEffectContract(input: {
  candidateIdentity: string;
  candidateTreeHash: string;
  beforeEvidenceRef: string;
  afterEvidenceRef: string;
}): EffectContract {
  return {
    schemaVersion: "1",
    effectId: APPLY_CHANGE_EFFECT_ID,
    expectedStateChanges: [{
      subject: `project:${input.candidateIdentity}`,
      predicate: "workspace.tree_hash",
      expectedValue: input.candidateTreeHash,
    }],
    observationProfile: "WORKSPACE",
    requiredEvidence: [input.beforeEvidenceRef, input.afterEvidenceRef],
    allowedResult: "OBSERVED",
  };
}
