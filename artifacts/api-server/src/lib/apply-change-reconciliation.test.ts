import { describe, expect, it } from "vitest";
import { classifyApplyRecoveryTrees } from "./apply-change-reconciliation.js";

describe("classifyApplyRecoveryTrees", () => {
  const baseTreeHash = "base-tree";
  const candidateTreeHash = "candidate-tree";

  it("treats an exact base tree as not promoted", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: candidateTreeHash,
      liveTreeHash: baseTreeHash,
      candidateWorkspaceTreeHash: candidateTreeHash,
      rootAvailable: true,
    })).toBe("BASE_TREE_PRESENT");
  });

  it("recognizes the exact candidate only when the candidate workspace also matches", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: candidateTreeHash,
      liveTreeHash: candidateTreeHash,
      candidateWorkspaceTreeHash: candidateTreeHash,
      rootAvailable: true,
    })).toBe("CANDIDATE_TREE_PRESENT");
  });

  it("fails closed when the live tree is mixed or unrelated", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: candidateTreeHash,
      liveTreeHash: "unrelated-tree",
      candidateWorkspaceTreeHash: candidateTreeHash,
      rootAvailable: true,
    })).toBe("MIXED_OR_UNRELATED_TREE");
  });

  it("fails closed when the candidate workspace is missing or changed", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: candidateTreeHash,
      liveTreeHash: candidateTreeHash,
      candidateWorkspaceTreeHash: null,
      rootAvailable: true,
    })).toBe("CANDIDATE_WORKSPACE_MISMATCH");
  });

  it("does not infer a result when the live root is unavailable", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: candidateTreeHash,
      liveTreeHash: null,
      candidateWorkspaceTreeHash: candidateTreeHash,
      rootAvailable: false,
    })).toBe("ROOT_UNAVAILABLE");
  });

  it("treats a no-op candidate matching the base as not promoted", () => {
    expect(classifyApplyRecoveryTrees({
      baseTreeHash,
      expectedCandidateTreeHash: baseTreeHash,
      liveTreeHash: baseTreeHash,
      candidateWorkspaceTreeHash: baseTreeHash,
      rootAvailable: true,
    })).toBe("BASE_TREE_PRESENT");
  });
});