export type SendMessageOptions = {
  buildPlanMessageId?: string;
  executionId?: string;
  resumeToken?: string;
  sessionId?: string;
};

export type StreamRequestContext = {
  projectId: string;
  sessionId: string | undefined;
  message: string;
  executionId: string | undefined;
  resumeToken: string | undefined;
  buildPlanMessageId: string | undefined;
  isResume: boolean;
  preserveBuildPending: boolean;
};

type StreamRequestContextInput = {
  projectId: string;
  activeSessionId: string | undefined;
  message: string;
  options?: SendMessageOptions;
};

/**
 * Snapshot the request binding after preflight. Stream ownership and generation
 * checks remain with the caller.
 */
export function createStreamRequestContext({
  projectId,
  activeSessionId,
  message,
  options,
}: StreamRequestContextInput): StreamRequestContext {
  const executionId = options?.executionId;
  const buildPlanMessageId = options?.buildPlanMessageId;

  return {
    projectId,
    sessionId: options?.sessionId ?? activeSessionId,
    message: message.trim(),
    executionId,
    resumeToken: options?.resumeToken,
    buildPlanMessageId,
    isResume: Boolean(executionId),
    preserveBuildPending: Boolean(buildPlanMessageId),
  };
}
