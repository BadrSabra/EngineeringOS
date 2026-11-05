import type { AiStreamDoneEvent, AiStreamErrorEvent, AiTerminalProjection } from '@workspace/api-client-react';
import { describe, expect, it } from 'vitest';
import type { ActiveExecution } from './delivery-proof';
import type { LiveAgentActivityEvent } from './live-activity';
import {
  isResumableStreamDisconnect,
  projectCompletedAssistantMessage,
  projectFailedAssistantMessage,
  projectMessagesAfterStreamFailure,
  projectRetainedCompletedExecution,
  projectRetainedFailedExecution,
} from './stream-terminal';

const baseDoneEvent: AiStreamDoneEvent = {
  type: 'done',
  sessionId: 'session-1',
  message: {
    id: 'message-1',
    role: 'assistant',
    content: 'completed response',
    sources: '',
    behaviorEvidence: 'persisted evidence reference',
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  sources: [],
  pendingChanges: [],
};

const baseExecution: ActiveExecution = {
  id: 'execution-1',
  projectId: 'project-1',
  message: 'request',
  sessionId: 'session-1',
  proofRequired: true,
};

function makeTerminalProjection(
  overrides: Partial<AiTerminalProjection> = {},
): AiTerminalProjection {
  return {
    executionId: 'execution-1',
    sessionId: 'session-1',
    attempt: 1,
    messageId: 'message-1',
    acceptanceId: 'acceptance-1',
    operationId: 'operation-1',
    correlationId: 'correlation-1',
    status: 'completed',
    outcome: 'SUCCEEDED',
    reasonCode: null,
    nextActionCode: null,
    resumable: false,
    ...overrides,
  };
}

describe('stream terminal projections', () => {
  it('projects the completed message without dropping persisted fallbacks', () => {
    const event: AiStreamDoneEvent = {
      ...baseDoneEvent,
      taskResult: { kind: 'FINDING_RESULT', finding: { title: 'Observed finding' } },
    };
    const activityEvents = [
      { id: 1, kind: 'stage', label: 'Finished', status: 'done' },
    ] as LiveAgentActivityEvent[];

    const message = projectCompletedAssistantMessage(event, activityEvents, 'FORENSIC_AUDIT');

    expect(message).toMatchObject({
      id: 'message-1',
      behaviorEvidence: 'persisted evidence reference',
      taskResult: { kind: 'FINDING_RESULT', finding: { title: 'Observed finding' } },
      operationMode: 'FORENSIC_AUDIT',
      activityEvents,
    });
    expect(message.terminalProjection).toBeNull();
    expect(message.projection).toBeNull();
  });

  it('retains only proof-required execution projections after completion', () => {
    const event: AiStreamDoneEvent = {
      ...baseDoneEvent,
      terminalProjection: makeTerminalProjection({ resumable: true }),
    };
    const retained = projectRetainedCompletedExecution(baseExecution, event);

    expect(retained).toMatchObject({
      id: 'execution-1',
      sessionId: 'session-1',
      terminalProjection: { resumable: true },
    });
    expect(projectRetainedCompletedExecution(
      { ...baseExecution, proofRequired: false },
      event,
    )).toBeNull();
    expect(projectRetainedCompletedExecution(null, event)).toBeNull();
  });

  it('preserves failed execution context only under the established proof rules', () => {
    const error: AiStreamErrorEvent = {
      type: 'error',
      code: 'execution_failed',
      message: 'safe failure',
      terminalProjection: makeTerminalProjection({ status: 'failed', outcome: 'FAILED', resumable: true }),
    };
    const retained = projectRetainedFailedExecution(error, baseExecution);

    expect(retained).toMatchObject({
      id: 'execution-1',
      terminalProjection: { status: 'failed', resumable: true },
    });
    expect(projectRetainedFailedExecution(
      error,
      { ...baseExecution, proofRequired: false, resumable: true },
    )).toBeNull();
    expect(projectRetainedFailedExecution(
      { ...error, terminalProjection: undefined },
      { ...baseExecution, operationMode: 'CHAT', resumable: false },
    )).toMatchObject({ id: 'execution-1' });
  });

  it('classifies only resumable proof-backed transport disconnects for auto-reconnect', () => {
    const disconnect: AiStreamErrorEvent = {
      type: 'error',
      code: 'network_error',
      message: 'connection lost',
    };
    expect(isResumableStreamDisconnect(disconnect, baseExecution)).toBe(true);
    expect(isResumableStreamDisconnect(disconnect, {
      ...baseExecution,
      proofRequired: false,
    })).toBe(false);
    expect(isResumableStreamDisconnect(disconnect, {
      ...baseExecution,
      resumable: false,
    })).toBe(false);
    expect(isResumableStreamDisconnect({
      ...disconnect,
      code: 'provider_failure',
    }, baseExecution)).toBe(false);
  });

  it('builds bounded failure messages with a deterministic rate-limit retry time', () => {
    const error: AiStreamErrorEvent = {
      type: 'error',
      code: 'provider_rate_limited',
      message: 'Provider is temporarily unavailable.',
      outcome: 'INTERRUPTED',
      providerFailureCategory: 'RATE_LIMITED',
      retryAfterMs: 2_000,
      retryAfterSource: 'provider',
      retryable: true,
      recoveryState: 'REQUIRED',
    };
    const message = projectFailedAssistantMessage(error, 'execution-1', 1_000);

    expect(message).toMatchObject({
      id: 'stream-failed-1000',
      executionId: 'execution-1',
      outcome: 'INTERRUPTED',
      errorMessage: 'Provider is temporarily unavailable.',
      retryAt: '1970-01-01T00:00:03.000Z',
      createdAt: '1970-01-01T00:00:01.000Z',
    });
    const boundedMessage = projectFailedAssistantMessage(
      { ...error, message: 'x'.repeat(600) },
      'execution-1',
      1_000,
    );
    expect(boundedMessage?.errorMessage).toHaveLength(500);
    expect(projectFailedAssistantMessage(
      { ...error, message: 'See /home/runner/workspace/private.ts' },
      'execution-1',
      1_000,
    )?.errorMessage).toBe('See [project path]');
    expect(projectFailedAssistantMessage(
      { ...error, outcome: undefined },
      'execution-1',
      1_000,
    )).toBeNull();
  });

  it('removes optimistic messages first and appends a failure projection without mutating history', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Request',
        createdAt: '2026-11-05T12:00:00.000Z',
      },
      {
        id: 'opt-1',
        role: 'user',
        content: 'Pending request',
        createdAt: '2026-11-05T12:00:01.000Z',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Earlier response',
        createdAt: '2026-11-05T12:00:02.000Z',
      },
    ];
    const failedMessage: ChatMessage = {
      id: 'stream-failed-1',
      role: 'assistant',
      content: '',
      outcome: 'FAILED',
      createdAt: '2026-11-05T12:00:03.000Z',
    };

    expect(projectMessagesAfterStreamFailure(messages)).toEqual([
      messages[0],
      messages[2],
    ]);
    expect(projectMessagesAfterStreamFailure(messages, failedMessage)).toEqual([
      messages[0],
      messages[2],
      failedMessage,
    ]);
    expect(messages[1].id).toBe('opt-1');
    expect(messages).toHaveLength(3);
  });
});
