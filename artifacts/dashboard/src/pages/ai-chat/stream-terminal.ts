import type { AiStreamDoneEvent, AiStreamErrorEvent } from '@workspace/api-client-react';
import { redactInternalDetails } from './provider-runtime';
import type { ActiveExecution } from './delivery-proof';
import type { AiTaskResult } from './session-state';
import type { ChatMessage, OperationMode } from './types';
import type { LiveAgentActivityEvent } from './live-activity';

export function projectCompletedAssistantMessage(
  data: AiStreamDoneEvent,
  activityEvents: LiveAgentActivityEvent[],
  operationMode: OperationMode | undefined,
): ChatMessage {
  const base = data.message as ChatMessage;

  return {
    ...base,
    activityEvents,
    behaviorEvidence: data.behaviorEvidence ?? base.behaviorEvidence ?? null,
    taskResult: (data.taskResult as AiTaskResult | undefined) ?? null,
    operationMode,
    terminalProjection: data.terminalProjection ?? base.terminalProjection ?? null,
    projection: data.projection ?? base.projection ?? null,
  };
}

export function projectRetainedCompletedExecution(
  current: ActiveExecution | null,
  data: AiStreamDoneEvent,
): ActiveExecution | null {
  const terminalProjection = data.terminalProjection;
  const executionProjection = data.projection ?? data.message.projection;
  const shouldRetain = Boolean(
    current
    && current.proofRequired !== false
    && (
      terminalProjection?.resumable === true
      || current.proofRequired === true
    ),
  );

  if (!shouldRetain || !current) return null;
  return {
    ...current,
    sessionId: data.sessionId,
    ...(terminalProjection ? { terminalProjection } : {}),
    ...(executionProjection ? { projection: executionProjection } : {}),
  };
}

export function projectRetainedFailedExecution(
  error: AiStreamErrorEvent,
  current: ActiveExecution | null,
): ActiveExecution | null {
  const shouldRetain = Boolean(
    current
    && current.proofRequired !== false
    && (
      error.terminalProjection?.resumable === true
      || current.resumable === true
      || (
        current.proofRequired === true
        && current.operationMode === 'CHAT'
      )
    ),
  );

  if (!shouldRetain || !current) return null;
  return {
    ...current,
    ...(error.terminalProjection ? { terminalProjection: error.terminalProjection } : {}),
    ...(error.projection ? { projection: error.projection } : {}),
  };
}

export function isResumableStreamDisconnect(
  error: AiStreamErrorEvent,
  current: ActiveExecution | null,
): boolean {
  return (
    (error.code === 'network_error' || error.code === 'no_body')
    && Boolean(
      current
      && current.proofRequired !== false
      && current.resumable !== false,
    )
  );
}

export function projectFailedAssistantMessage(
  error: AiStreamErrorEvent,
  failedExecutionId: string | undefined,
  nowMs = Date.now(),
): ChatMessage | null {
  if (error.outcome !== 'FAILED' && error.outcome !== 'INTERRUPTED') return null;

  const safeMessage = error.message
    ? redactInternalDetails(error.message).slice(0, 500)
    : 'The AI request did not complete.';
  const retryAt = error.providerFailureCategory === 'RATE_LIMITED'
    && typeof error.retryAfterMs === 'number'
    && Number.isFinite(error.retryAfterMs)
    && error.retryAfterMs > 0
    ? new Date(nowMs + error.retryAfterMs).toISOString()
    : undefined;

  return {
    id: `stream-failed-${nowMs}`,
    role: 'assistant',
    content: '',
    executionId: error.terminalProjection?.executionId ?? failedExecutionId ?? null,
    outcome: error.outcome,
    errorCode: error.code,
    errorMessage: safeMessage,
    failureKind: error.failureKind,
    providerFailureCategory: error.providerFailureCategory,
    rateLimitScope: error.rateLimitScope,
    retryAfterMs: error.retryAfterMs,
    retryAfterSource: error.retryAfterSource,
    retryAt,
    retryable: error.retryable,
    recoveryState: error.recoveryState,
    acceptanceDisposition: error.acceptanceDisposition,
    executionLedger: error.executionLedger,
    terminalProjection: error.terminalProjection ?? null,
    projection: error.projection ?? null,
    createdAt: new Date(nowMs).toISOString(),
  };
}

export function projectMessagesAfterStreamFailure(
  messages: ChatMessage[],
  failedMessage: ChatMessage | null = null,
): ChatMessage[] {
  const withoutOptimisticMessages = messages.filter((message) => !message.id.startsWith('opt-'));
  return failedMessage
    ? [...withoutOptimisticMessages, failedMessage]
    : withoutOptimisticMessages;
}
