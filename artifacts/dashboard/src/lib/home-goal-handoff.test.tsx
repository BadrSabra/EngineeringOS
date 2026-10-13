import { StrictMode, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOAL_DRAFT_TTL_MS, HOME_GOAL_DRAFT_HANDOFF_KEY,
  readGoalDrafts, removeGoalDraft, storeGoalDraft, updateGoalDraft,
} from './home-goal-handoff';
import { useGoalDraftHandoff } from './use-goal-draft-handoff';

beforeEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('owned, bounded draft persistence', () => {
  it('preserves sources independently and refuses another account’s reads, writes, or deletes', () => {
    const home = storeGoalDraft('owner-a', 'هدف من الرئيسية')!;
    const starter = storeGoalDraft('owner-a', 'وصف المشروع', 'starter', 'project-a')!;
    expect(readGoalDrafts('owner-a').drafts.map((draft) => draft.id)).toEqual([home.id, starter.id]);
    expect(readGoalDrafts('owner-b').drafts).toEqual([]);
    expect(updateGoalDraft('owner-b', home.id, { text: 'replace' })).toBeNull();
    expect(removeGoalDraft('owner-b', home.id)).toBe(false);
    expect(readGoalDrafts('owner-a').drafts[0].text).toBe('هدف من الرئيسية');
  });

  it('expires exactly at the bound lifetime and never infers an owner for legacy text', () => {
    const draft = storeGoalDraft('owner-a', 'هدف')!;
    expect(draft.expiresAt - draft.createdAt).toBe(GOAL_DRAFT_TTL_MS);
    vi.spyOn(Date, 'now').mockReturnValue(draft.expiresAt);
    expect(readGoalDrafts('owner-a').drafts).toEqual([]);
    expect(updateGoalDraft('owner-a', draft.id, { projectId: 'other' })).toBeNull();
    window.sessionStorage.setItem('engineeringos:home-goal-draft:v1', 'legacy text');
    expect(readGoalDrafts('owner-b').drafts).toEqual([]);
  });

  it('fails explicitly without replacing malformed or inaccessible storage', () => {
    window.sessionStorage.setItem(HOME_GOAL_DRAFT_HANDOFF_KEY, 'malformed');
    expect(readGoalDrafts('owner-a').error).not.toBeNull();
    expect(storeGoalDraft('owner-a', 'new')).toBeNull();
    expect(window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY)).toBe('malformed');
    window.sessionStorage.clear();
    const draft = storeGoalDraft('owner-a', 'original')!;
    const before = window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(updateGoalDraft('owner-a', draft.id, { text: 'edited' })).toBeNull();
    spy.mockRestore();
    expect(window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY)).toBe(before);
  });

  it('retains prior drafts when the bounded account capacity is reached', () => {
    for (let i = 0; i < 8; i++) expect(storeGoalDraft('owner-a', `goal ${i}`)).not.toBeNull();
    expect(storeGoalDraft('owner-a', 'overflow')).toBeNull();
    expect(readGoalDrafts('owner-a').drafts).toHaveLength(8);
  });
});

function useDraftHarness(ownerId: string, initialInput = '', routeDraftId: string | null = null) {
  const [input, setInput] = useState(initialInput);
  return {
    input,
    ...useGoalDraftHandoff({ ownerId, routeDraftId, input, setInput, selectedProjectId: 'project-a' }),
  };
}

describe('draft selection and reload contracts', () => {
  it('preserves the active draft and its confirmation gate during StrictMode effect replay', () => {
    storeGoalDraft('owner-a', 'goal');
    const hook = renderHook(() => useDraftHarness('owner-a'), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(hook.result.current.input).toBe('goal');
    expect(hook.result.current.activeDraft?.text).toBe('goal');
    expect(hook.result.current.needsProjectConfirmation).toBe(true);
  });
  it('requires an explicit choice for two sources, preserving edits when replacing', () => {
    const home = storeGoalDraft('owner-a', 'home')!;
    const starter = storeGoalDraft('owner-a', 'starter', 'starter', 'project-a')!;
    const hook = renderHook(() => useDraftHarness('owner-a'));
    expect(hook.result.current.input).toBe('');
    expect(hook.result.current.pendingDrafts).toHaveLength(2);
    act(() => hook.result.current.activate(home.id));
    act(() => hook.result.current.edit('edited home'));
    act(() => hook.result.current.activate(starter.id));
    expect(hook.result.current.input).toBe('edited home');
    expect(hook.result.current.replacementId).toBe(starter.id);
    act(() => hook.result.current.activate(starter.id, true));
    expect(hook.result.current.input).toBe('starter');
    expect(readGoalDrafts('owner-a').drafts.find((draft) => draft.id === home.id)?.text).toBe('edited home');
    expect(hook.result.current.needsProjectConfirmation).toBe(true);
  });

  it('saves existing composer text before replacing it with a pending draft', () => {
    const draft = storeGoalDraft('owner-a', 'saved draft')!;
    const hook = renderHook(() => useDraftHarness('owner-a', 'existing composer'));
    expect(hook.result.current.activeDraft).toBeNull();
    act(() => hook.result.current.activate(draft.id));
    expect(hook.result.current.input).toBe('existing composer');
    act(() => hook.result.current.activate(draft.id, true));
    expect(hook.result.current.input).toBe('saved draft');
    expect(readGoalDrafts('owner-a').drafts.some((entry) => entry.text === 'existing composer')).toBe(true);
  });

  it('clears visible account-owned text when identity changes and never substitutes an unavailable explicit draft', () => {
    const draft = storeGoalDraft('owner-a', 'private goal')!;
    const hook = renderHook(({ ownerId }) => useDraftHarness(ownerId, '', draft.id), {
      initialProps: { ownerId: 'owner-a' },
    });
    expect(hook.result.current.input).toBe('private goal');
    hook.rerender({ ownerId: 'owner-b' });
    expect(hook.result.current.input).toBe('');
    expect(hook.result.current.pendingDrafts).toEqual([]);
    expect(hook.result.current.activeDraft).toBeNull();
    expect(hook.result.current.error).not.toBeNull();
    expect(readGoalDrafts('owner-a').drafts[0].text).toBe('private goal');
  });

  it('keeps attempted text recoverable but never automatically reinserts it on reload', () => {
    const draft = storeGoalDraft('owner-a', 'send this')!;
    const first = renderHook(() => useDraftHarness('owner-a'));
    act(() => first.result.current.confirmProject());
    expect(first.result.current.needsProjectConfirmation).toBe(false);
    act(() => { expect(first.result.current.onSend('send this')).toBe(true); });
    first.unmount();
    const reopened = renderHook(() => useDraftHarness('owner-a'));
    expect(reopened.result.current.input).toBe('');
    expect(reopened.result.current.pendingDrafts[0].id).toBe(draft.id);
    expect(reopened.result.current.pendingDrafts[0].sendAttemptedAt).not.toBeNull();
  });
});
