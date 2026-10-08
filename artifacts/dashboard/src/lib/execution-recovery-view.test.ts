import { describe, expect, it } from 'vitest';
import { getExecutionRecoveryView } from './execution-recovery-view';

describe('execution recovery presentation', () => {
  it('waits for a server status instead of advertising a locally retained token', () => {
    const view = getExecutionRecoveryView(null, false);
    expect(view.title).toBe('Checking saved execution status');
    expect(view.action).toBeNull();
  });

  it('offers resume only for a resumable saved execution', () => {
    const view = getExecutionRecoveryView({ status: 'paused', resumable: true }, false);
    expect(view.action).toBe('resume');
    expect(view.actionLabel).toBe('Resume execution');
    expect(getExecutionRecoveryView({
      status: 'failed',
      resumable: false,
      acceptance: { resumable: false, nextActionCode: 'START_NEW_PROBE' },
    }, false).action).toBeNull();
  });

  it('keeps a server-authorized retry separate from denied ordinary resume', () => {
    const view = getExecutionRecoveryView({
      status: 'failed',
      resumable: false,
      acceptance: { resumable: false, nextActionCode: 'RETRY_AFTER_TIMEOUT' },
      projection: { allowedActions: ['RETRY_CHECKPOINT'] },
    }, false);
    expect(view.action).toBe('retry');
    expect(view.actionLabel).toBe('Retry checkpoint');
    expect(getExecutionRecoveryView({
      status: 'failed',
      resumable: false,
      acceptance: { resumable: false, nextActionCode: 'START_NEW_PROBE' },
      projection: { allowedActions: ['RETRY_CHECKPOINT'] },
    }, false).action).toBeNull();
  });

  it('routes Task-linked recovery through the owning Task lifecycle', () => {
    const paused = getExecutionRecoveryView({
      status: 'paused',
      linkedTaskId: 'task-1',
      resumable: true,
      acceptance: { resumable: true, nextActionCode: 'RESUME_ALLOWED' },
      projection: { allowedActions: ['RESUME_CHECKPOINT'] },
    }, false);
    expect(paused.title).toBe('Task-owned execution — recover it from Tasks');
    expect(paused.nextStep).toBe('Open the owning Task in Tasks');
    expect(paused.action).toBeNull();

    const failed = getExecutionRecoveryView({
      status: 'failed',
      linkedTaskId: 'task-1',
      acceptance: { resumable: false, nextActionCode: 'RETRY_AFTER_TIMEOUT' },
      projection: { allowedActions: ['RETRY_CHECKPOINT'] },
    }, false);
    expect(failed.action).toBeNull();
  });

  it('does not treat completion or a historical audit as permission to continue', () => {
    const completed = getExecutionRecoveryView({
      status: 'completed', proofRequired: true, evidenceVerdict: 'BLOCKED',
    }, false);
    expect(completed.title).toBe('Execution ended — proof not accepted');
    expect(completed.action).toBeNull();
    expect(getExecutionRecoveryView({
      status: 'paused', resumable: true,
      projection: { allowedActions: ['RESUME_CHECKPOINT'] },
    }, true).action).toBeNull();
  });
});