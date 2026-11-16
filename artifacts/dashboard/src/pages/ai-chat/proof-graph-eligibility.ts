import type { ChatMessage } from './types';

/**
 * A proof graph is offered only for the exact completed assistant execution
 * whose persisted terminal projection explicitly records a successful attempt.
 */
export function getProofGraphAttempt(
  message: ChatMessage,
  isUser: boolean,
  projectId: string | null | undefined,
): number | null {
  const projection = message.terminalProjection;
  const attempt = projection?.attempt;

  if (
    isUser
    || !projectId?.trim()
    || !message.executionId
    || projection?.executionId !== message.executionId
    || projection.status !== 'completed'
    || projection.outcome !== 'SUCCEEDED'
    || !Number.isSafeInteger(attempt)
    || attempt! < 0
  ) {
    return null;
  }

  return attempt!;
}
