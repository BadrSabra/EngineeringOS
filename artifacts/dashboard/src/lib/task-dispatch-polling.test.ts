import { describe, expect, it } from 'vitest';
import { shouldPollTaskDispatchList } from './task-dispatch-polling';

describe('shouldPollTaskDispatchList', () => {
  it.each(['queued', 'running', 'verifying'])('polls while a Task is %s', (status) => {
    expect(shouldPollTaskDispatchList([{ status }])).toBe(true);
  });

  it('does not poll idle pending Tasks or terminal states', () => {
    expect(shouldPollTaskDispatchList([{ status: 'pending' }])).toBe(false);
    expect(shouldPollTaskDispatchList([
      { status: 'completed' },
      { status: 'failed' },
      { status: 'cancelled' },
    ])).toBe(false);
  });

  it('stops polling when no usable active Task snapshot exists', () => {
    expect(shouldPollTaskDispatchList(undefined)).toBe(false);
    expect(shouldPollTaskDispatchList(null)).toBe(false);
    expect(shouldPollTaskDispatchList([])).toBe(false);
    expect(shouldPollTaskDispatchList([{ status: null }, null, 'queued'])).toBe(false);
  });

  it('continues polling if any Task in the current project snapshot is in flight', () => {
    expect(shouldPollTaskDispatchList([
      { status: 'completed' },
      { status: 'queued' },
      { status: 'pending' },
    ])).toBe(true);
  });
});
