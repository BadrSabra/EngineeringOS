import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAssistantScopeHref,
  readAssistantComposerDraft,
  readAssistantScopeContext,
  rememberAssistantScopeContext,
  saveAssistantComposerDraft,
} from './assistant-scope-continuity';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('assistant scope continuity', () => {
  it('keeps composer drafts isolated by account, scope, and conversation identity', () => {
    expect(saveAssistantComposerDraft('user-1', 'general', 'session-1', 'سؤال عام')).toBe(true);
    expect(saveAssistantComposerDraft('user-1', 'project', 'project-1:session-1', 'هدف مشروع')).toBe(true);

    expect(readAssistantComposerDraft('user-1', 'general', 'session-1')).toEqual({
      ok: true,
      text: 'سؤال عام',
    });
    expect(readAssistantComposerDraft('user-1', 'general', 'session-2')).toEqual({
      ok: true,
      text: null,
    });
    expect(readAssistantComposerDraft('user-2', 'general', 'session-1')).toEqual({
      ok: true,
      text: null,
    });
    expect(readAssistantComposerDraft('user-1', 'project', 'project-1:session-1')).toEqual({
      ok: true,
      text: 'هدف مشروع',
    });
  });

  it('stores only scope-appropriate return routes', () => {
    expect(rememberAssistantScopeContext('user-1', {
      scope: 'general',
      sessionId: 'general-session',
      draftId: 'general-draft',
    })).toBe(true);
    expect(rememberAssistantScopeContext('user-1', {
      scope: 'project',
      projectId: 'project-1',
      sessionId: 'project-session',
      draftId: 'project-draft',
    })).toBe(true);
    expect(rememberAssistantScopeContext('user-1', {
      scope: 'project',
      projectId: 'project-2',
      sessionId: 'other-project-session',
    })).toBe(true);

    const general = readAssistantScopeContext('user-1', 'general');
    const project = readAssistantScopeContext('user-1', 'project', 'project-1');
    expect(general).toEqual({
      scope: 'general',
      sessionId: 'general-session',
      draftId: 'general-draft',
    });
    expect(project).toEqual({
      scope: 'project',
      projectId: 'project-1',
      sessionId: 'project-session',
      draftId: 'project-draft',
    });
    expect(readAssistantScopeContext('user-1', 'project', 'project-2')).toEqual({
      scope: 'project',
      projectId: 'project-2',
      sessionId: 'other-project-session',
    });
    expect(readAssistantScopeContext('user-1', 'project')).toBeNull();
    expect(buildAssistantScopeHref(general!)).toBe(
      '/general-chat?sessionId=general-session&goalDraftId=general-draft',
    );
    expect(buildAssistantScopeHref(project!)).toBe(
      '/ai?projectId=project-1&sessionId=project-session&goalDraftId=project-draft',
    );
  });
});
