import { describe, expect, it } from 'vitest';
import { getProofGraphAttempt } from './proof-graph-eligibility';
import type { ChatMessage } from './types';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    content: '',
    executionId: 'execution-1',
    terminalProjection: {
      status: 'completed',
      outcome: 'SUCCEEDED',
      executionId: 'execution-1',
      attempt: 3,
    } as ChatMessage['terminalProjection'],
    ...overrides,
  };
}

describe('getProofGraphAttempt', () => {
  it('returns only the explicit successful attempt bound to the same execution and project', () => {
    expect(getProofGraphAttempt(message(), false, 'project-1')).toBe(3);
  });

  it.each([
    ['user message', message({ role: 'user' }), true, 'project-1'],
    ['missing project', message(), false, null],
    ['missing execution', message({ executionId: null }), false, 'project-1'],
    [
      'mismatched execution',
      message({
        terminalProjection: {
          status: 'completed',
          outcome: 'SUCCEEDED',
          executionId: 'another-execution',
          attempt: 3,
        } as ChatMessage['terminalProjection'],
      }),
      false,
      'project-1',
    ],
    [
      'non-terminal projection',
      message({
        terminalProjection: {
          status: 'running',
          outcome: 'SUCCEEDED',
          executionId: 'execution-1',
          attempt: 3,
        } as ChatMessage['terminalProjection'],
      }),
      false,
      'project-1',
    ],
    [
      'failed outcome',
      message({
        terminalProjection: {
          status: 'completed',
          outcome: 'FAILED',
          executionId: 'execution-1',
          attempt: 3,
        } as ChatMessage['terminalProjection'],
      }),
      false,
      'project-1',
    ],
    [
      'invalid attempt',
      message({
        terminalProjection: {
          status: 'completed',
          outcome: 'SUCCEEDED',
          executionId: 'execution-1',
          attempt: -1,
        } as ChatMessage['terminalProjection'],
      }),
      false,
      'project-1',
    ],
  ])('does not expose a graph for %s', (_name, candidate, isUser, projectId) => {
    expect(getProofGraphAttempt(candidate, isUser, projectId)).toBeNull();
  });
});
