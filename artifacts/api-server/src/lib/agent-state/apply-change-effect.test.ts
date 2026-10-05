import { describe, expect, it } from "vitest";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  APPLY_CHANGE_EFFECT_ID,
  buildApplyChangeAction,
  buildApplyChangeEffectContract,
  buildApplyChangeEffectProofExpectation,
  isBoundApplyChangeEffectBundle,
} from "./apply-change-effect.js";

describe("approved source promotion action/effect contract", () => {
  it("binds approval, attempt, candidate and exact source promotion identity", () => {
    const action = buildApplyChangeAction({
      actionId: "action:execution:0:apply",
      episodeId: "episode-1",
      projectId: "project-1",
      operationId: "operation-1",
      proposalId: "proposal-1",
      attemptId: "attempt-1",
      sourceRevision: "revision-1",
      baseTreeHash: "a".repeat(64),
      candidateTreeHash: "b".repeat(64),
      changeSetHash: "c".repeat(64),
      approvedPaths: ["src/example.ts"],
    });
    const contract = buildApplyChangeEffectContract({
      candidateIdentity: `proposal-1:${"b".repeat(64)}`,
      candidateTreeHash: "b".repeat(64),
      beforeEvidenceRef: "apply:before",
      afterEvidenceRef: "apply:after",
    });

    expect(action).toMatchObject({
      capabilityId: APPLY_CHANGE_CAPABILITY_ID,
      episodeId: "episode-1",
      expectedEffects: [APPLY_CHANGE_EFFECT_ID],
      scope: {
        proposalId: "proposal-1",
        attemptId: "attempt-1",
        approvedPaths: ["src/example.ts"],
      },
    });
    expect(contract).toMatchObject({
      effectId: APPLY_CHANGE_EFFECT_ID,
      observationProfile: "WORKSPACE",
      allowedResult: "OBSERVED",
      expectedStateChanges: [{
        predicate: "workspace.tree_hash",
        expectedValue: "b".repeat(64),
      }],
    });
  });

  it("requires the exact observed action and effect contract in the durable bundle", () => {
    const binding = {
      projectId: "project-1",
      executionId: "execution-1",
      attempt: 2,
      episodeId: "episode-1",
      actionId: "action:execution-1:2:apply",
      proposalId: "proposal-1",
      candidateTreeHash: "b".repeat(64),
    };
    const expectation = buildApplyChangeEffectProofExpectation(binding);
    const effect = {
      id: "effect-1",
      projectId: binding.projectId,
      executionId: binding.executionId,
      attempt: binding.attempt,
      episodeId: binding.episodeId,
      actionId: binding.actionId,
      capabilityId: APPLY_CHANGE_CAPABILITY_ID,
      effectContractHash: expectation.effectContractHash,
      expectedEffects: expectation.contract.expectedStateChanges,
      status: "observed",
    };
    const bundle = {
      id: "bundle-1",
      projectId: binding.projectId,
      executionId: binding.executionId,
      attempt: binding.attempt,
      episodeId: binding.episodeId,
      effectIds: [effect.id],
      effectContractHashes: [expectation.effectContractHash],
      verdict: "OBSERVED",
    };

    expect(isBoundApplyChangeEffectBundle({ ...binding, bundle, effects: [effect] })).toBe(true);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      bundle: { ...bundle, effectIds: [], effectContractHashes: [] },
      effects: [],
    })).toBe(false);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      bundle,
      effects: [{ ...effect, actionId: "action:wrong" }],
    })).toBe(false);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      bundle,
      effects: [{ ...effect, effectContractHash: "wrong-contract" }],
    })).toBe(false);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      bundle,
      effects: [{ ...effect, expectedEffects: [{
        subject: "project:other",
        predicate: "workspace.tree_hash",
        expectedValue: binding.candidateTreeHash,
      }] }],
    })).toBe(false);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      attempt: binding.attempt + 1,
      bundle,
      effects: [effect],
    })).toBe(false);
    expect(isBoundApplyChangeEffectBundle({
      ...binding,
      episodeId: "episode-other",
      bundle,
      effects: [effect],
    })).toBe(false);
  });
});
