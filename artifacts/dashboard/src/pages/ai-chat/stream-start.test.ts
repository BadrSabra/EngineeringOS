import { describe, expect, it } from 'vitest';
import { createOptimisticUserMessage } from './stream-start';

describe('createOptimisticUserMessage', () => {
  it('projects the normalized request into the local user message without changing identity or time', () => {
    expect(createOptimisticUserMessage({
      message: 'Inspect the project',
      idTimestamp: 1_762_336_800_000,
      createdAt: '2026-11-05T12:00:00.000Z',
    })).toEqual({
      id: 'opt-1762336800000',
      role: 'user',
      content: 'Inspect the project',
      createdAt: '2026-11-05T12:00:00.000Z',
    });
  });
});
