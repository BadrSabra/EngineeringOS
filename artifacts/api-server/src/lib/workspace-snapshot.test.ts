import { describe, expect, it } from "vitest";
import {
  getWorkspaceCandidateExecutionBinding,
  getWorkspaceTaskVerificationDecision,
} from "./workspace-snapshot.js";

describe("getWorkspaceCandidateExecutionBinding", () => {
  it("matches only an exact proposal identity", () => {
    expect(
      getWorkspaceCandidateExecutionBinding({
        candidateProposalId: "proposal-current",
        executionSource: "available",
        latestExecutionProposalId: "proposal-current",
      }),
    ).toBe("matched");
  });

  it("does not associate a different or absent proposal with the latest execution", () => {
    for (const latestExecutionProposalId of ["proposal-other", null]) {
      expect(
        getWorkspaceCandidateExecutionBinding({
          candidateProposalId: "proposal-current",
          executionSource: "available",
          latestExecutionProposalId,
        }),
      ).toBe("not_matched");
    }
  });

  it("reports unknown when the execution source is unavailable", () => {
    expect(
      getWorkspaceCandidateExecutionBinding({
        candidateProposalId: "proposal-current",
        executionSource: "unavailable",
        latestExecutionProposalId: "proposal-current",
      }),
    ).toBe("unknown");
  });
});

describe("getWorkspaceTaskVerificationDecision", () => {
  it("keeps verification only when it matches the task's current state", () => {
    expect(getWorkspaceTaskVerificationDecision("verifying", "incomplete")).toBe("incomplete");
    expect(getWorkspaceTaskVerificationDecision("completed", "verified")).toBe("verified");
    expect(getWorkspaceTaskVerificationDecision("failed", "failed")).toBe("failed");
    expect(getWorkspaceTaskVerificationDecision("cancelled", "cancelled")).toBe("cancelled");
  });

  it("hides verification from active retries and mismatched terminal results", () => {
    expect(getWorkspaceTaskVerificationDecision("queued", "verified")).toBeNull();
    expect(getWorkspaceTaskVerificationDecision("running", "failed")).toBeNull();
    expect(getWorkspaceTaskVerificationDecision("completed", "failed")).toBeNull();
    expect(getWorkspaceTaskVerificationDecision("failed", "incomplete")).toBeNull();
    expect(getWorkspaceTaskVerificationDecision("pending", undefined)).toBeNull();
  });
});
