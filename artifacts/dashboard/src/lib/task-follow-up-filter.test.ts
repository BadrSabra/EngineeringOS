import { describe, expect, it } from 'vitest';
import { isTaskFollowUpCandidate } from './task-follow-up-filter';

describe('isTaskFollowUpCandidate', () => {
  it.each(['pending', 'queued', 'failed', 'verifying'])(
    'includes %s tasks that have a next step',
    (status) => {
      expect(isTaskFollowUpCandidate(status)).toBe(true);
    },
  );

  it.each(['completed', 'cancelled'])(
    'excludes %s tasks without an unresolved acceptance state',
    (status) => {
      expect(isTaskFollowUpCandidate(status)).toBe(false);
    },
  );

  it.each(['interrupted', 'failed', 'recovery-required'])(
    'includes completed tasks with %s acceptance',
    (acceptanceState) => {
      expect(isTaskFollowUpCandidate('completed', acceptanceState)).toBe(true);
    },
  );

  it('excludes accepted tasks and hides stale acceptance while running', () => {
    expect(isTaskFollowUpCandidate('completed', 'accepted')).toBe(false);
    expect(isTaskFollowUpCandidate('running', 'recovery-required')).toBe(false);
  });
});
