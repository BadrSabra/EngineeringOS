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