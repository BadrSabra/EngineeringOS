import { describe, expect, it } from 'vitest';
import {
  createOptimisticUserMessage,
  initializeStreamStartUi,
  type StreamStartUiActions,
} from './stream-start';

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

describe('initializeStreamStartUi', () => {
  it('clears prior stream projections and starts the connecting activity in order', () => {
    const calls: string[] = [];
    const events: Array<Omit<import('./live-activity').LiveAgentActivityEvent, 'id'>> = [];
    const actions: StreamStartUiActions = {
      setAgentStage: (value) => calls.push(`stage:${value}`),
      setStreamingContent: (value) => calls.push(`content:${value}`),
      clearAgentSteps: () => calls.push('steps'),
      clearLiveActivityEvents: () => calls.push('clear-activity'),
      appendLiveActivityEvent: (event) => {
        events.push(event);
        calls.push('append-activity');
        return 1;
      },
      clearAgentIter: () => calls.push('iteration'),
      clearAgentModel: () => calls.push('model'),
      setAgentStartedAt: (value) => calls.push(`started:${value}`),
      clearAgentElapsedSeconds: () => calls.push('elapsed'),
      clearAgentModelHistory: () => calls.push('model-history'),
      clearAgentDiagnostics: () => calls.push('diagnostics'),
      disableLiveFixture: () => calls.push('fixture'),
      clearLiveEvidenceIntegrity: () => calls.push('evidence-integrity'),
      clearLiveVerdictScope: () => calls.push('verdict-scope'),
    };

    initializeStreamStartUi(actions, 1_762_336_800_000);

    expect(calls).toEqual([
      'stage:Connecting…',
      'content:',
      'steps',
      'clear-activity',
      'append-activity',
      'iteration',
      'model',
      'started:1762336800000',
      'elapsed',
      'model-history',
      'diagnostics',
      'fixture',
      'evidence-integrity',
      'verdict-scope',
    ]);
    expect(events).toEqual([{
      kind: 'stage',
      label: 'Connecting to the AI stream',
      status: 'info',
    }]);
  });
});
