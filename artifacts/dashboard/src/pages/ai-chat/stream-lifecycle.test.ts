import { describe, expect, it, vi } from 'vitest';
import { createStreamIdentityCallbacks } from './stream-lifecycle';
import type { Session, StreamOwner } from './session-state';
import type { ActiveExecution } from './delivery-proof';

function createHarness(ownsStream = true) {
  const ownerRef: { current: StreamOwner | null } = {
    current: { generation: 4, projectId: 'project-1', sessionId: 'session-1' },
  };
  const actions = {
    ownerRef,
    ownsStream: vi.fn(() => ownsStream),
    projectId: 'project-1',
    linkedTaskId: 'task-1',
    message: 'Inspect the project',
    buildPlanMessageId: 'plan-message-1',
    publishExecution: vi.fn<(execution: ActiveExecution) => void>(),
    persistSessionSelection: vi.fn<(sessionId: string) => void>(),
    setSessionId: vi.fn<(sessionId: string) => void>(),
    upsertSession: vi.fn<(session: Session) => void>(),
    appendActivityEvent: vi.fn(() => 1),
  };

  return { actions, callbacks: createStreamIdentityCallbacks(actions) };
}

describe('createStreamIdentityCallbacks', () => {
  it('ignores execution and session identities from a non-owning stream', () => {
    const { actions, callbacks } = createHarness(false);

    callbacks.onExecutionStarted?.({
      type: 'execution_started',
      executionId: 'execution-old',
      resumable: true,
    });
    callbacks.onSessionStarted?.({
      type: 'session_started',
      sessionId: 'session-old',
      title: 'Old session',
      updatedAt: '2026-11-05T12:00:00.000Z',
    });

    expect(actions.ownerRef.current).toEqual({
      generation: 4,
      projectId: 'project-1',
      sessionId: 'session-1',
    });
    expect(actions.publishExecution).not.toHaveBeenCalled();
    expect(actions.persistSessionSelection).not.toHaveBeenCalled();
    expect(actions.setSessionId).not.toHaveBeenCalled();
    expect(actions.upsertSession).not.toHaveBeenCalled();
    expect(actions.appendActivityEvent).not.toHaveBeenCalled();
  });

  it('publishes the execution snapshot only after the owner fence passes', () => {
    const { actions, callbacks } = createHarness();

    callbacks.onExecutionStarted?.({
      type: 'execution_started',
      executionId: 'execution-123456789',
      resumeToken: 'opaque-resume-token',
      resumable: true,
      proofRequired: true,
      operationMode: 'CHAT',
    });

    expect(actions.ownsStream).toHaveBeenCalledWith({ executionId: 'execution-123456789' });
    expect(actions.ownerRef.current?.executionId).toBe('execution-123456789');
    expect(actions.publishExecution).toHaveBeenCalledWith({
      id: 'execution-123456789',
      projectId: 'project-1',
      sessionId: 'session-1',
      linkedTaskId: 'task-1',
      resumeToken: 'opaque-resume-token',
      resumable: true,
      proofRequired: true,
      operationMode: 'CHAT',
      message: 'Inspect the project',
      buildPlanMessageId: 'plan-message-1',
    });
    expect(actions.appendActivityEvent).toHaveBeenCalledWith({
      kind: 'stage',
      label: 'Durable execution reserved',
      detail: 'executio',
      status: 'info',
    });
  });

  it('persists and upserts a session only after the owner fence passes', () => {
    const { actions, callbacks } = createHarness();

    callbacks.onSessionStarted?.({
      type: 'session_started',
      sessionId: 'session-2',
      title: 'New session',
      updatedAt: '2026-11-05T12:30:00.000Z',
    });

    expect(actions.ownsStream).toHaveBeenCalledWith({ sessionId: 'session-2' });
    expect(actions.ownerRef.current?.sessionId).toBe('session-2');
    expect(actions.persistSessionSelection).toHaveBeenCalledWith('session-2');
    expect(actions.setSessionId).toHaveBeenCalledWith('session-2');
    expect(actions.upsertSession).toHaveBeenCalledWith({
      id: 'session-2',
      title: 'New session',
      updatedAt: '2026-11-05T12:30:00.000Z',
    });
  });

  it('does not write when ownership disappears before the callback runs', () => {
    const { actions, callbacks } = createHarness();
    actions.ownerRef.current = null;

    callbacks.onExecutionStarted?.({
      type: 'execution_started',
      executionId: 'execution-orphaned',
      resumable: false,
    });
    callbacks.onSessionStarted?.({
      type: 'session_started',
      sessionId: 'session-orphaned',
      title: 'Orphaned',
      updatedAt: '2026-11-05T12:30:00.000Z',
    });

    expect(actions.publishExecution).not.toHaveBeenCalled();
    expect(actions.persistSessionSelection).not.toHaveBeenCalled();
    expect(actions.upsertSession).not.toHaveBeenCalled();
  });
});
