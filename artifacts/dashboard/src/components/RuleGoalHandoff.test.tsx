import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';
import RuleGoalHandoff from './RuleGoalHandoff';

const mocks = vi.hoisted(() => ({
  isLoaded: true,
  user: { id: 'user-1' } as { id: string } | null,
  setLocation: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: mocks.isLoaded, user: mocks.user }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/rules', mocks.setLocation],
}));

const projectRule = {
  id: 'rule-1',
  projectId: 'project/one',
  code: 'SEC-001',
  title: 'منع الحقن',
  description: 'افحص بناء الاستعلامات.',
  fixDescription: 'استخدم معاملات آمنة.',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.isLoaded = true;
  mocks.user = { id: 'user-1' };
});

describe('RuleGoalHandoff', () => {
  it('opens the project assistant with a scoped, reviewable rule draft', () => {
    render(<RuleGoalHandoff rule={projectRule} />);

    fireEvent.click(screen.getByTestId('button-rule-goal-handoff-rule-1'));

    const draft = readGoalDrafts('user-1').drafts[0];
    expect(draft).toMatchObject({
      source: 'home',
      projectId: 'project/one',
    });
    expect(draft.text).toContain('قاعدة الفحص «منع الحقن» (SEC-001)');
    expect(draft.text).toContain('افحص بناء الاستعلامات.');
    expect(draft.text).toContain('استخدم معاملات آمنة.');
    expect(draft.text).toContain('لا تغيّر ملفات المشروع قبل موافقتي.');
    expect(mocks.setLocation).toHaveBeenCalledWith(
      `/projects/project%2Fone/workspace?goalDraftId=${draft.id}#workspace-panel-agent`,
    );
  });

  it('does not offer a project handoff for a global rule or unloaded user', () => {
    const globalRule = { ...projectRule, projectId: null };
    const { rerender } = render(<RuleGoalHandoff rule={globalRule} />);

    expect(screen.queryByTestId('button-rule-goal-handoff-rule-1')).not.toBeInTheDocument();

    mocks.isLoaded = false;
    rerender(<RuleGoalHandoff rule={projectRule} />);
    expect(screen.queryByTestId('button-rule-goal-handoff-rule-1')).not.toBeInTheDocument();
  });

  it('stays on the rules page when the draft cannot be saved', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(storeHomeGoalDraft(`هدف ${index}`, 'user-1')).not.toBeNull();
    }
    render(<RuleGoalHandoff rule={projectRule} />);

    fireEvent.click(screen.getByTestId('button-rule-goal-handoff-rule-1'));

    expect(screen.getByRole('alert')).toHaveTextContent('تعذر حفظ سياق القاعدة.');
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(8);
  });
});
