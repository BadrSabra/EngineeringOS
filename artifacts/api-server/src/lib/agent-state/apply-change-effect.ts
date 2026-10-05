import {
  hashEffectContract,
  type AgentAction,
  type EffectContract,
} from "@workspace/ai-orchestrator";

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

export function buildApplyChangeEffectProofExpectation(input: {
  executionId: string;
  attempt: number;
  proposalId: string;
  candidateTreeHash: string;
}) {
  const contract = buildApplyChangeEffectContract({
    candidateIdentity: `${input.proposalId}:${input.candidateTreeHash}`,
    candidateTreeHash: input.candidateTreeHash,
    beforeEvidenceRef: `apply:${input.executionId}:${input.attempt}:before`,
    afterEvidenceRef: `apply:${input.executionId}:${input.attempt}:after`,
  });
  return { contract, effectContractHash: hashEffectContract(contract) };
}

type ApplyChangeEffectBundleRecord = {
  id: string;
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  effectIds: unknown;
  effectContractHashes: unknown;
  verdict: string;
};

type ApplyChangeEffectRecord = {
  id: string;
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  capabilityId: string;
  effectContractHash: string;
  expectedEffects: unknown;
  status: string;
};

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) =>
    typeof entry !== "string" || entry.trim().length === 0,
  )) return undefined;
  return value as string[];
}

function sameStringMultiset(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return left.length === right.length
    && [...left].sort().every((value, index) => value === sortedRight[index]);
}

function matchesExpectedChange(value: unknown, contract: EffectContract): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const actual = value[0];
  const expected = contract.expectedStateChanges[0];
  if (!actual || typeof actual !== "object" || Array.isArray(actual) || !expected) return false;
  const record = actual as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "expectedValue,predicate,subject"
    && record.subject === expected.subject
    && record.predicate === expected.predicate
    && record.expectedValue === expected.expectedValue;
}

export function isBoundApplyChangeEffectBundle(input: {
  bundle: ApplyChangeEffectBundleRecord;
  effects: readonly ApplyChangeEffectRecord[];
  projectId: string;
  executionId: string;
  attempt: number;
  episodeId: string;
  actionId: string;
  proposalId: string;
  candidateTreeHash: string;
}): boolean {
  const {
    bundle,
    effects,
    projectId,
    executionId,
    attempt,
    episodeId,
    actionId,
    proposalId,
    candidateTreeHash,
  } = input;
  if (
    bundle.projectId !== projectId
    || bundle.executionId !== executionId
    || bundle.attempt !== attempt
    || bundle.episodeId !== episodeId
    || bundle.verdict !== "OBSERVED"
    || !/^[a-f0-9]{64}$/.test(candidateTreeHash)
    || !proposalId.trim()
    || !actionId.trim()
  ) return false;

  const effectIds = stringArray(bundle.effectIds);
  const bundleHashes = stringArray(bundle.effectContractHashes);
  if (
    !effectIds
    || effectIds.length === 0
    || new Set(effectIds).size !== effectIds.length
    || !bundleHashes
  ) return false;

  const effectById = new Map(effects.map((effect) => [effect.id, effect]));
  if (
    effectById.size !== effects.length
    || effects.length !== effectIds.length
    || effectIds.some((id) => !effectById.has(id))
    || !sameStringMultiset(bundleHashes, effects.map((effect) => effect.effectContractHash))
  ) return false;

  const expectation = buildApplyChangeEffectProofExpectation({
    executionId,
    attempt,
    proposalId,
    candidateTreeHash,
  });
  const matchingEffects = effects.filter((effect) => (
    effect.projectId === projectId
    && effect.executionId === executionId
    && effect.attempt === attempt
    && effect.episodeId === episodeId
    && effect.status === "observed"
    && effect.actionId === actionId
    && effect.capabilityId === APPLY_CHANGE_CAPABILITY_ID
    && effect.effectContractHash === expectation.effectContractHash
    && matchesExpectedChange(effect.expectedEffects, expectation.contract)
  ));
  return effects.every((effect) => (
    effect.projectId === projectId
    && effect.executionId === executionId
    && effect.attempt === attempt
    && effect.episodeId === episodeId
    && effect.status === "observed"
  )) && matchingEffects.length === 1;
}
