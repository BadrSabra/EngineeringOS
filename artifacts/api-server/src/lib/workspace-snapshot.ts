export type WorkspaceCandidateExecutionBinding =
  | "matched"
  | "not_matched"
  | "unknown";

export type WorkspaceTaskVerificationDecision =
  | "verified"
  | "incomplete"
  | "failed"
  | "cancelled";

const CURRENT_TASK_VERIFICATION_BY_STATUS: Record<
  string,
  WorkspaceTaskVerificationDecision
> = {
  verifying: "incomplete",
  completed: "verified",
  failed: "failed",
  cancelled: "cancelled",
};

export function getWorkspaceCandidateExecutionBinding(params: {
  candidateProposalId: string;
  executionSource: "available" | "unavailable";
  latestExecutionProposalId: string | null;
}): WorkspaceCandidateExecutionBinding {
  if (params.executionSource === "unavailable") return "unknown";
  return params.latestExecutionProposalId === params.candidateProposalId
    ? "matched"
    : "not_matched";
}

export function getWorkspaceTaskVerificationDecision(
  taskStatus: string,
  verificationDecision: string | null | undefined,
): WorkspaceTaskVerificationDecision | null {
  const currentDecision = CURRENT_TASK_VERIFICATION_BY_STATUS[taskStatus];
  if (!currentDecision || currentDecision !== verificationDecision) return null;
  return currentDecision;
}
