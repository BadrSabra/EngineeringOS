import { describe, expect, it } from 'vitest';
import { buildMissionOriginChatHref } from './mission-chat-link';

describe('buildMissionOriginChatHref', () => {
  it('encodes the project, origin session, optional Mission selection, and trusted message', () => {
    expect(buildMissionOriginChatHref({
      projectId: 'project / one',
      sessionId: 'session?two',
      missionId: 'mission#three',
      messageId: 'assistant message/4',
    })).toBe(
      '/ai?projectId=project+%2F+one&sessionId=session%3Ftwo&missionId=mission%23three&messageId=assistant+message%2F4',
    );
  });

  it('omits an unavailable source message without losing the valid origin link', () => {
    expect(buildMissionOriginChatHref({
      projectId: 'project-1',
      sessionId: 'session-1',
      missionId: 'mission-1',
      messageId: '  ',
    })).toBe('/ai?projectId=project-1&sessionId=session-1&missionId=mission-1');
  });

  it('returns to the persisted session without adding a Mission selection to the URL', () => {
    expect(buildMissionOriginChatHref({
      projectId: 'project-1',
      sessionId: 'session-1',
      messageId: 'assistant-message-1',
    })).toBe('/ai?projectId=project-1&sessionId=session-1&messageId=assistant-message-1');
  });

  it.each([
    { projectId: '', sessionId: 'session-1' },
    { projectId: 'project-1', sessionId: ' ' },
  ])('does not invent an origin link when required identity is missing', (input) => {
    expect(buildMissionOriginChatHref(input)).toBeNull();
  });
});
