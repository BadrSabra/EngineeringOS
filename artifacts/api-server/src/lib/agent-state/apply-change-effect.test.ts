import { describe, expect, it } from "vitest";
import {
  APPLY_CHANGE_CAPABILITY_ID,
  APPLY_CHANGE_EFFECT_ID,
  buildApplyChangeAction,
  buildApplyChangeEffectContract,
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
});
