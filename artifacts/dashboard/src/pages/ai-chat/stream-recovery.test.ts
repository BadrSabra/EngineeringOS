import { describe, expect, it, vi } from 'vitest';
import {
  createStreamResetCallback,
  type StreamResetExecution,
  type StreamResetStatus,
} from './stream-recovery';

function createHarness() {
  let current = true;
  const execution: StreamResetExecution = { id: 'exec-current', sessionId: 'session-current' };
  const status: StreamResetStatus = {
    id: execution.id,
    sessionId: execution.sessionId,
    status: 'running',
    resumable: false,
  };
  const actions = {
    isCurrent: () => current,
    getActiveExecution: () => execution,
    refetchStatus: vi.fn(async () => ({ data: status })),
    clearLiveState: vi.fn(),
    setAgentStage: vi.fn(),
    executionCanResume: vi.fn(() => true),
    onTerminalStatus: vi.fn(),
  };

  return {
    actions,
    execution,
    status,
    setCurrent(value: boolean) {
      current = value;
    },
    callback: createStreamResetCallback(actions),
  };
}

describe('createStreamResetCallback', () => {
  it('ignores reset events from an obsolete stream generation', () => {
    const harness = createHarness();
    harness.setCurrent(false);

    harness.callback();

    expect(harness.actions.clearLiveState).not.toHaveBeenCalled();
    expect(harness.actions.refetchStatus).not.toHaveBeenCalled();
    expect(harness.actions.setAgentStage).not.toHaveBeenCalled();
  });

  it('clears transient UI and reports the durable execution state', async () => {
    const harness = createHarness();
    harness.status.status = 'paused';

    harness.callback();

    expect(harness.actions.clearLiveState).toHaveBeenCalledOnce();
    expect(harness.actions.setAgentStage).toHaveBeenNthCalledWith(
      1,
      'Connection interrupted — checking the saved execution…',
    );
    await vi.waitFor(() => {
      expect(harness.actions.setAgentStage).toHaveBeenLastCalledWith(
        'Execution saved — ready to resume',
      );
    });
    expect(harness.actions.executionCanResume).toHaveBeenCalledWith(harness.status);
  });

  it('does not project a status response for a different execution', async () => {
    const harness = createHarness();
    harness.actions.refetchStatus.mockResolvedValue({
      data: { ...harness.status, id: 'exec-other', status: 'completed' },
    });

    harness.callback();

    await vi.waitFor(() => expect(harness.actions.refetchStatus).toHaveBeenCalledOnce());
    expect(harness.actions.onTerminalStatus).not.toHaveBeenCalled();
    expect(harness.actions.setAgentStage).toHaveBeenCalledTimes(1);
  });

  it('delegates terminal refresh side effects without treating reset as acceptance', async () => {
    const harness = createHarness();
    harness.actions.refetchStatus.mockResolvedValue({
      data: { ...harness.status, status: 'completed' },
    });

    harness.callback();

    await vi.waitFor(() => {
      expect(harness.actions.onTerminalStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: harness.execution.id, status: 'completed' }),
        harness.execution,
      );
    });
    expect(harness.actions.setAgentStage).toHaveBeenLastCalledWith(
      'Execution completed — restoring the saved result…',
    );
  });

  it('keeps the interrupted state visible when status refresh fails', async () => {
    const harness = createHarness();
    harness.actions.refetchStatus.mockRejectedValue(new Error('network unavailable'));

    harness.callback();

    await vi.waitFor(() => {
      expect(harness.actions.setAgentStage).toHaveBeenLastCalledWith(
        'Connection interrupted — the server is still being checked…',
      );
    });
  });
});
