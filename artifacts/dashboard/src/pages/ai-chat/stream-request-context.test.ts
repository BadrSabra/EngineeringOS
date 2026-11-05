import { describe, expect, it } from 'vitest';
import { createStreamRequestContext } from './stream-request-context';

describe('createStreamRequestContext', () => {
  it('uses the active session by default and trims the outbound message once', () => {
    expect(createStreamRequestContext({
      projectId: 'project-1',
      activeSessionId: 'session-active',
      message: '  Inspect the project  ',
    })).toEqual({
      projectId: 'project-1',
      sessionId: 'session-active',
      message: 'Inspect the project',
      executionId: undefined,
      resumeToken: undefined,
      buildPlanMessageId: undefined,
      isResume: false,
      preserveBuildPending: false,
    });
  });

  it('keeps explicit session and execution bindings for a resume', () => {
    expect(createStreamRequestContext({
      projectId: 'project-1',
      activeSessionId: 'session-active',
      message: ' Continue ',
      options: {
        sessionId: 'session-requested',
        executionId: 'execution-1',
        resumeToken: 'resume-1',
      },
    })).toMatchObject({
      projectId: 'project-1',
      sessionId: 'session-requested',
      message: 'Continue',
      executionId: 'execution-1',
      resumeToken: 'resume-1',
      isResume: true,
      preserveBuildPending: false,
    });
  });

  it('binds a plan message and preserves its pending state without marking a resume', () => {
    expect(createStreamRequestContext({
      projectId: 'project-1',
      activeSessionId: undefined,
      message: ' Build ',
      options: { buildPlanMessageId: 'plan-message-1' },
    })).toMatchObject({
      sessionId: undefined,
      message: 'Build',
      buildPlanMessageId: 'plan-message-1',
      isResume: false,
      preserveBuildPending: true,
    });
  });
});
