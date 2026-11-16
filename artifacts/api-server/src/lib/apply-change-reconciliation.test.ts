import { describe, expect, it } from "vitest";
import {
  classifyApplyRecoveryTrees,
  matchApplyTransitionForAction,
  matchesApplyExecutionAttempt,
  resolveApplyJournalAttemptId,
} from "./apply-change-reconciliation.js";

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

describe("matchApplyTransitionForAction", () => {
  const sameAttemptTransitions = [
    { id: "other-action", episodeId: "episode-1", actionId: "action-other" },
    { id: "other-episode", episodeId: "episode-2", actionId: "action-apply" },
  ];

  it("treats unrelated Episode and Action rows as a missing Apply transition", () => {
    expect(matchApplyTransitionForAction(
      sameAttemptTransitions,
      "episode-1",
      "action-apply",
    )).toEqual({ kind: "missing" });
  });

  it("matches only the exact Episode and Action", () => {
    const expected = {
      id: "apply-action",
      episodeId: "episode-1",
      actionId: "action-apply",
    };
    expect(matchApplyTransitionForAction(
      [...sameAttemptTransitions, expected],
      "episode-1",
      "action-apply",
    )).toEqual({ kind: "matched", transition: expected });
  });

  it("fails closed when duplicate transitions share the exact Action identity", () => {
    const duplicate = {
      id: "apply-action-duplicate",
      episodeId: "episode-1",
      actionId: "action-apply",
    };
    const expected = {
      id: "apply-action",
      episodeId: "episode-1",
      actionId: "action-apply",
    };
    expect(matchApplyTransitionForAction(
      [...sameAttemptTransitions, expected, duplicate],
      "episode-1",
      "action-apply",
    )).toEqual({ kind: "ambiguous", count: 2 });
  });
});

describe("resolveApplyJournalAttemptId", () => {
  it("prefers the attempt recorded on the durable Action", () => {
    expect(resolveApplyJournalAttemptId({
      actionAttemptId: "action-attempt",
      request: { applyAttemptId: "request-attempt", operationId: "operation" },
      fallbackExecutionId: "execution",
    })).toBe("action-attempt");
  });

  it("uses the persisted v2 applyAttemptId when ACTION_REQUESTED is missing", () => {
    expect(resolveApplyJournalAttemptId({
      request: { applyAttemptId: "apply-attempt", operationId: "stable-operation" },
      fallbackExecutionId: "execution",
    })).toBe("apply-attempt");
  });

  it("preserves the v1 operationId fallback", () => {
    expect(resolveApplyJournalAttemptId({
      request: { operationId: "legacy-operation" },
      fallbackExecutionId: "execution",
    })).toBe("legacy-operation");
  });

  it("uses the execution identity only when the request has no attempt key", () => {
    expect(resolveApplyJournalAttemptId({
      request: {},
      fallbackExecutionId: "execution",
    })).toBe("execution");
  });
});

describe("matchesApplyExecutionAttempt", () => {
  it("accepts a v2 Action attempt distinct from the stable operation ID", () => {
    expect(matchesApplyExecutionAttempt({
      actionAttemptId: "apply-attempt",
      request: {
        operationId: "stable-operation",
        applyAttemptId: "apply-attempt",
      },
      fallbackExecutionId: "execution",
    })).toBe(true);
  });

  it("rejects an Action that incorrectly uses the stable operation ID as its v2 attempt", () => {
    expect(matchesApplyExecutionAttempt({
      actionAttemptId: "stable-operation",
      request: {
        operationId: "stable-operation",
        applyAttemptId: "apply-attempt",
      },
      fallbackExecutionId: "execution",
    })).toBe(false);
  });

  it("preserves the v1 operation ID as the legacy attempt identity", () => {
    expect(matchesApplyExecutionAttempt({
      actionAttemptId: "legacy-operation",
      request: { operationId: "legacy-operation" },
      fallbackExecutionId: "execution",
    })).toBe(true);
  });

  it("fails closed when the Action attempt identity is empty", () => {
    expect(matchesApplyExecutionAttempt({
      actionAttemptId: " ",
      request: {
        operationId: "stable-operation",
        applyAttemptId: "apply-attempt",
      },
      fallbackExecutionId: "execution",
    })).toBe(false);
  });
});
