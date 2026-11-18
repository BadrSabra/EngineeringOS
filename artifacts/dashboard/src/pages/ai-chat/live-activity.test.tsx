import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CompletedActivityTimeline,
  LiveAgentActivity,
  liveToolLabel,
  type LiveAgentActivityEvent,
  type LiveAgentToolStep,
} from './live-activity';

function activityProps(overrides: Partial<React.ComponentProps<typeof LiveAgentActivity>> = {}) {
  return {
    stage: 'Model response received',
    steps: [] as LiveAgentToolStep[],
    activityEvents: [] as LiveAgentActivityEvent[],
    iter: null,
    model: null,
    streamingContent: '',
    busy: true,
    elapsedSeconds: 62,
    modelHistory: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('AI live activity presentation', () => {
  it('marks only the inferred current stage and never implies prior stages completed', () => {
    const { container } = render(<LiveAgentActivity {...activityProps()} />);
    const progress = screen.getByRole('list', { name: 'مراحل النشاط المباشر' });
    const stages = within(progress).getAllByRole('listitem');

    expect(stages).toHaveLength(8);
    expect(stages.filter((stage) => stage.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(stages[0]).not.toHaveAttribute('aria-current');
    expect(stages[1]).toHaveAttribute('aria-current', 'step');
    expect(stages[0].querySelector('.h-1')).toHaveClass('bg-border/70');
    expect(stages[1].querySelector('.h-1')).toHaveClass('bg-primary');
    expect(stages[2].querySelector('.h-1')).toHaveClass('bg-border/70');
    expect(screen.getByText('التخطيط')).toBeInTheDocument();
    expect(screen.getByText('فحص المشروع')).toBeInTheDocument();
    expect(screen.getByText('الإصلاح')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
  });

  it('does not show passed validation or review-ready states as active progress', () => {
    const { rerender, container } = render(<LiveAgentActivity {...activityProps({
      stage: 'Validation passed',
    })} />);
    const progress = screen.getByRole('list', { name: 'مراحل النشاط المباشر' });

    expect(screen.getByText('اجتاز التحقق')).toBeInTheDocument();
    expect(within(progress).getAllByRole('listitem').every((stage) => !stage.hasAttribute('aria-current'))).toBe(true);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'Ready for review' })} />);
    expect(screen.getByText('جاهز للمراجعة')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'Project scan queued' })} />);
    expect(screen.getByText('أُضيف فحص المشروع إلى قائمة الانتظار')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'Execution saved — ready to resume' })} />);
    expect(screen.getByText('تم حفظ التنفيذ؛ وهو جاهز للاستئناف')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'Execution is still running on the server…' })} />);
    expect(screen.getByText('لا يزال التنفيذ جاريًا على الخادم…')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'Execution completed — restoring the saved result…' })} />);
    expect(screen.getByText('اكتمل التنفيذ؛ جارٍ استعادة النتيجة المحفوظة…')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);

    rerender(<LiveAgentActivity {...activityProps({ stage: 'CUSTOM_STAGE: waiting for evidence' })} />);
    expect(screen.getByText('CUSTOM_STAGE: waiting for evidence')).toBeInTheDocument();
    expect(screen.getByText(/حالة الخادم غير معروفة/)).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
  });

  it('shows the explicit server repair state as its own active phase', () => {
    const { container } = render(<LiveAgentActivity {...activityProps({
      stage: 'Repair correction allowed',
    })} />);
    const stages = within(screen.getByRole('list', { name: 'مراحل النشاط المباشر' })).getAllByRole('listitem');

    expect(screen.getByText('سُمح بإجراء تصحيح')).toBeInTheDocument();
    expect(screen.getByText(/تصحيح محدود ثم إعادة التحقق/)).toBeInTheDocument();
    expect(stages[6]).not.toHaveAttribute('aria-current');
    expect(stages[7]).toHaveAttribute('aria-current', 'step');
    expect(stages[7].querySelector('.h-1')).toHaveClass('bg-primary');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('shows an explicitly running project scan as its own active phase', () => {
    const { container } = render(<LiveAgentActivity {...activityProps({
      stage: 'Project scan running',
    })} />);
    const stages = within(screen.getByRole('list', { name: 'مراحل النشاط المباشر' })).getAllByRole('listitem');

    expect(screen.getByText('فحص المشروع قيد التنفيذ')).toBeInTheDocument();
    expect(stages[2]).toHaveAttribute('aria-current', 'step');
    expect(stages[2].querySelector('.h-1')).toHaveClass('bg-primary');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('shows recovery as a non-progress state without marking a phase active', () => {
    const { container } = render(<LiveAgentActivity {...activityProps({
      stage: 'Connection interrupted — checking the saved execution…',
    })} />);
    const stages = within(screen.getByRole('list', { name: 'مراحل النشاط المباشر' })).getAllByRole('listitem');

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(stages.every((stage) => stage.querySelector('.h-1')?.classList.contains('bg-border/70'))).toBe(true);
    expect(screen.getAllByText(/لا توجد مرحلة نشطة مثبتة حاليًا/).length).toBeGreaterThan(0);
    expect(screen.getByText('انقطع الاتصال؛ جارٍ التحقق من حالة التنفيذ المحفوظ…')).toBeInTheDocument();
  });

  it('localizes known tool activity while preserving the exact source path', () => {
    const source = 'lib/ai-orchestrator/src/context-builder.ts';
    const step: LiveAgentToolStep = { tool: 'read_file', source, done: false };
    render(<LiveAgentActivity {...activityProps({ stage: null, steps: [step] })} />);

    expect(screen.getByText(`قراءة المصدر · ${source}`)).toBeInTheDocument();
    expect(liveToolLabel({ tool: 'custom_probe_v2', done: false })).toBe('custom_probe_v2');
  });

  it('localizes the latest activity update as well as its timeline event', () => {
    const event: LiveAgentActivityEvent = {
      id: 42,
      kind: 'stage',
      label: 'Execution plan loaded',
      detail: 'عدد العقد: 2',
      status: 'info',
    };
    render(<LiveAgentActivity {...activityProps({ activityEvents: [event] })} />);

    expect(screen.getByText('آخر تحديث:')).toBeInTheDocument();
    expect(screen.getAllByText('تم تحميل خطة التنفيذ')).toHaveLength(2);
    expect(screen.queryByText('Execution plan loaded')).not.toBeInTheDocument();
  });

  it('localizes historical event labels but leaves diagnostic codes intact', () => {
    const event: LiveAgentActivityEvent = {
      id: 1,
      kind: 'validation',
      label: 'Validation passed',
      detail: 'APPLY_PROOF_OK',
      status: 'done',
    };
    render(<CompletedActivityTimeline events={[event]} defaultOpen />);

    expect(screen.getByText('اجتاز التحقق')).toBeInTheDocument();
    expect(screen.getByText('APPLY_PROOF_OK')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(/أحداث/)).toBeInTheDocument();
  });
});
