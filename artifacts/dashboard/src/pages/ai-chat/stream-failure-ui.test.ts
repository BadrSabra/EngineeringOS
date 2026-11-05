import { describe, expect, it } from 'vitest';
import { clearFailedStreamUi, type FailedStreamUiActions } from './stream-failure-ui';

describe('clearFailedStreamUi', () => {
  it('clears failed-stream presentation in order without taking recovery or ownership actions', () => {
    const calls: string[] = [];
    const actions: FailedStreamUiActions = {
      setAgentStage: (value) => calls.push(`stage:${value}`),
      clearProjectQueryRetryMessage: () => calls.push('project-query-retry'),
      clearStreamingContent: () => calls.push('content'),
      clearAgentSteps: () => calls.push('steps'),
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

    clearFailedStreamUi(actions);

    expect(calls).toEqual([
      'stage:null',
      'project-query-retry',
      'content',
      'steps',
      'iteration',
      'model',
      'started:null',
      'elapsed',
      'model-history',
      'diagnostics',
      'fixture',
      'evidence-integrity',
      'verdict-scope',
    ]);
  });
});
