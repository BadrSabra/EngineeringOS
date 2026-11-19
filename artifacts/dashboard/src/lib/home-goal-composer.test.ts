import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHomeGoalComposer,
  readHomeGoalComposer,
  saveHomeGoalComposer,
} from './home-goal-composer';
import { HOME_GOAL_MAX_LENGTH } from './home-goal-handoff';

describe('home goal composer storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the exact unsent text for the same account', () => {
    const text = '  أريد مراجعة مشروعي\nقبل أن أبدأ  ';

    expect(saveHomeGoalComposer('user-1', text)).toBe('saved');
    expect(readHomeGoalComposer('user-1')).toEqual({ text, status: 'saved' });
    expect(readHomeGoalComposer('user-2')).toEqual({ text: '', status: null });
  });

  it('removes only the selected account draft after a successful handoff', () => {
    saveHomeGoalComposer('user-1', 'هدف الحساب الأول');
    saveHomeGoalComposer('user-2', 'هدف الحساب الثاني');

    expect(clearHomeGoalComposer('user-1')).toBe(true);
    expect(readHomeGoalComposer('user-1')).toEqual({ text: '', status: null });
    expect(readHomeGoalComposer('user-2')).toEqual({ text: 'هدف الحساب الثاني', status: 'saved' });
  });

  it('does not replace a valid draft with text beyond the input limit', () => {
    saveHomeGoalComposer('user-1', 'مسودة سليمة');

    expect(saveHomeGoalComposer('user-1', 'x'.repeat(HOME_GOAL_MAX_LENGTH + 1))).toBe('error');
    expect(readHomeGoalComposer('user-1')).toEqual({ text: 'مسودة سليمة', status: 'saved' });
  });

  it('keeps input usable and reports storage failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'QuotaExceededError');
    });

    expect(saveHomeGoalComposer('user-1', 'هدف غير محفوظ')).toBe('error');
    expect(readHomeGoalComposer('user-1')).toEqual({ text: '', status: null });
  });
});
