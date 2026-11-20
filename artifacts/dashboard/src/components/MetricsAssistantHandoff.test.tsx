import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricRecord } from '@workspace/api-client-react';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';
import MetricsAssistantHandoff from './MetricsAssistantHandoff';

const mocks = vi.hoisted(() => ({
  isLoaded: true,
  user: { id: 'owner-a' } as { id: string } | null,
  setLocation: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: mocks.isLoaded, user: mocks.user }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/metrics', mocks.setLocation],
}));

function metric(index: number): MetricRecord {
  return {
    id: `metric-${index}`,
    projectId: 'project/alpha',
    timestamp: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    overallScore: 100 + index * 11,
    architectureScore: 90,
    securityScore: 80,
    performanceScore: 70,
    testCoverage: 60,
    lintIssues: 1,
    technicalDebt: 2,
    buildStatus: 'failing',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.isLoaded = true;
  mocks.user = { id: 'owner-a' };
});

describe('MetricsAssistantHandoff', () => {
  it('opens a scoped draft with a bounded sample of recorded metrics', () => {
    const metrics = Array.from({ length: 8 }, (_, index) => metric(index));
    render(
      <MetricsAssistantHandoff
        projectId="project/alpha"
        projectName="متجر الورد"
        dateRange="7d"
        metrics={metrics}
      />,
    );

    fireEvent.click(screen.getByTestId('button-metrics-assistant-handoff'));

    const draft = readGoalDrafts('owner-a').drafts[0];
    expect(draft).toMatchObject({
      source: 'home',
      projectId: 'project/alpha',
      sendAttemptedAt: null,
    });
    expect(draft.text).toContain('النطاق المعروض: آخر ٧ أيام');
    expect(draft.text).toContain('عدد القراءات المعروضة: 8');
    expect(draft.text).toContain('عينة موزعة من 4 قراءات');
    expect(draft.text).toContain('النتيجة الإجمالية: 100');
    expect(draft.text).toContain('النتيجة الإجمالية: 122');
    expect(draft.text).toContain('النتيجة الإجمالية: 155');
    expect(draft.text).toContain('النتيجة الإجمالية: 177');
    expect(draft.text).not.toContain('النتيجة الإجمالية: 111');
    expect(draft.text).toContain('حالة البناء: تعثر بحسب السجل');
    expect(draft.text).not.toContain('failing');
    expect(draft.text).toContain('لا تثبت وحدها جودة المشروع أو أمانه');
    expect(draft.text).toContain('لا تغيّر الملفات ولا تعِد تشغيل الفحص قبل موافقتي.');
    expect(draft.text.length).toBeLessThan(2_000);
    expect(mocks.setLocation).toHaveBeenCalledWith(
      `/projects/project%2Falpha/workspace?goalDraftId=${draft.id}#workspace-panel-agent`,
    );
  });

  it('does not offer a handoff until the signed-in owner is ready', () => {
    mocks.isLoaded = false;
    mocks.user = null;

    render(
      <MetricsAssistantHandoff
        projectId="project/alpha"
        projectName="متجر الورد"
        dateRange="30d"
        metrics={[metric(0)]}
      />,
    );

    expect(screen.queryByTestId('button-metrics-assistant-handoff')).not.toBeInTheDocument();
  });

  it('keeps the page open when a draft cannot be saved', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(storeHomeGoalDraft(`مسودة ${index}`, 'owner-a')).not.toBeNull();
    }

    render(
      <MetricsAssistantHandoff
        projectId="project/alpha"
        projectName="متجر الورد"
        dateRange="all"
        metrics={[metric(0)]}
      />,
    );
    fireEvent.click(screen.getByTestId('button-metrics-assistant-handoff'));

    expect(screen.getByRole('alert')).toHaveTextContent('تعذر حفظ ملخص المؤشرات.');
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('owner-a').drafts).toHaveLength(8);
  });
});
