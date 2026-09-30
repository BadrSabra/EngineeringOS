type ExecutionConversationIdentity = {
  id: string;
  projectId?: string | null;
  sessionId?: string | null;
};

/**
 * Navigation is advisory: the AI page still verifies that the session belongs
 * to this project. Never derive a chat session from an operation or Mission ID.
 */
export function executionChatHref(
  execution: ExecutionConversationIdentity | null | undefined,
  selectedExecutionId: string | null | undefined,
  selectedProjectId?: string | null,
): string | null {
  if (
    !execution
    || !selectedExecutionId
    || execution.id !== selectedExecutionId
    || !execution.projectId?.trim()
    || !execution.sessionId?.trim()
    || (selectedProjectId && execution.projectId !== selectedProjectId)
  ) {
    return null;
  }
  return `/ai?projectId=${encodeURIComponent(execution.projectId)}&sessionId=${encodeURIComponent(execution.sessionId)}`;
}