import { describe, expect, it } from "vitest";
import { buildCandidateValidationAction } from "./candidate-validation-effect.js";

const baseInput = {
  actionId: "candidate-validation-action",
  episodeId: "candidate-validation-episode",
  projectId: "candidate-validation-project",
  operationId: "candidate-validation-operation",
  sourceRevision: "workspace-tree-v1:source",
  candidateIdentity: "candidate-tree-hash",
  approvedPaths: ["README.md"],
};

describe("candidate validation effect", () => {
  it("binds the typed workspace verification recipe to its exact server recipe identity", () => {
    expect(buildCandidateValidationAction({
      ...baseInput,
      recipeId: "candidate.verify.workspace-typecheck",
    }).triggerConditions).toEqual([{
      kind: "server_recipe",
      recipeId: "candidate.verify.workspace-typecheck",
    }]);
  });

  it("retains the legacy recipe identity by default and rejects unrelated recipes", () => {
    expect(buildCandidateValidationAction(baseInput).triggerConditions).toEqual([{
      kind: "server_recipe",
      recipeId: "candidate.verify",
    }]);
    expect(() => buildCandidateValidationAction({
      ...baseInput,
      recipeId: "delivery.push.github",
    })).toThrow(/registered candidate verification recipe/);
  });
});
