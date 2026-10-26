import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  getGetTaskLogsQueryKey,
  getGetTaskQueryKey,
  getListTasksQueryKey,
} from '@workspace/api-client-react';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { ExecutionProjectionPanel } from './ExecutionProjectionPanel';

const projection: AiExecutionProjection = {
  schemaVersion: 2,
  kind: 'DELIVERY',
  phase: 'VALIDATE',
  objective: 'Update the dashboard',
  progress: {
    percent: 50,
    label: 'Validation is running',
    currentStep: 'Run checks',
    completedSteps: 1,
    totalSteps: 2,
  },
  plan: {
    steps: [{
      id: 'step-1',
      title: 'Run checks',
      status: 'active',
      action: 'validate',
      files: ['src/App.tsx'],
    }],
    currentStepId: 'step-1',
  },
  tools: {
    totalCalls: 2,
    activeTool: 'read_file',
    recent: [{ tool: 'read_file', status: 'completed', source: 'src/App.tsx' }],
  },
  workspace: { changedFiles: ['src/App.tsx'], diffStatus: 'available' },
  verification: { status: 'running', evidenceVerdict: 'PARTIAL', proofRequired: true },
  approval: { required: true, status: 'PENDING', proposalId: 'proposal-1' },
  stopped: { reason: null, outcome: null },
  timeline: [
    { id: 'understand', label: 'Understand request', status: 'completed', detail: 'Request retained.' },
    { id: 'investigate', label: 'Investigate project', status: 'completed', detail: null },
    { id: 'plan', label: 'Create bounded plan', status: 'completed', detail: '1 step.' },
    { id: 'approval', label: 'Approve change', status: 'active', detail: 'Approval required.' },
    { id: 'build', label: 'Build candidate', status: 'pending', detail: null },
    { id: 'validate', label: 'Validate candidate', status: 'active', detail: null },
    { id: 'review', label: 'Review changes', status: 'active', detail: null },
    { id: 'deliver', label: 'Deliver to Git', status: 'pending', detail: null },
  ],
  allowedActions: ['CANCEL', 'REVIEW_DIFF', 'APPROVE_CHANGES'],
};

function renderPanel(ui: React.ReactNode, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ExecutionProjectionPanel', () => {
  it('keeps source bytes LTR and exposes only a server-allowed Arabic review action', () => {
    const onAction = vi.fn();
    renderPanel(<ExecutionProjectionPanel
      projection={{ ...projection, allowedActions: ['REVIEW_PROOF'] }}
      executionId="execution-source"
      onAction={onAction}
    />);
    expect(screen.getByRole('region', { name: 'ملخص التنفيذ' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('file-src/App.tsx')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('file-src/App.tsx')).toHaveTextContent('src/App.tsx');
    expect(screen.getByTestId('execution-identities').querySelector('code')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByTestId('button-action-approve_changes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-action-cancel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة الأدلة المسجلة' }));
    expect(screen.getByTestId('toggle-proof').closest('details')).toHaveAttribute('open');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not translate unknown record values into success or treat 100 percent as acceptance', () => {
    renderPanel(<ExecutionProjectionPanel
      projection={{
        ...projection,
        phase: 'CUSTOM_PHASE',
        workspace: { changedFiles: [], diffStatus: 'not_available' },
        progress: { ...projection.progress, percent: 100 },
        approval: { required: false, status: 'NOT_REQUIRED', proposalId: null },
        verification: { status: 'passed', evidenceVerdict: 'PROVEN', proofRequired: true },
        allowedActions: [],
      }}
      executionStatus="completed"
    />);
    expect(screen.getByTestId('status-mission-phase')).toHaveTextContent('Custom Phase');
    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('انتهى بحسب السجل');
    expect(screen.getByTestId('text-mission-state-detail')).toHaveTextContent('لا يثبت قبول النتيجة');
    expect(screen.getByTestId('status-progress')).toHaveTextContent('100٪');
    expect(screen.queryAllByTestId(/^button-action-/)).toHaveLength(0);
  });

  it('keeps the shared result explanation read-only even when the projection lists mutating actions', () => {
    const onAction = vi.fn();
    renderPanel(
      <ExecutionProjectionPanel
        projection={{
          ...projection,
          verification: { status: 'passed', evidenceVerdict: 'PROVEN', proofRequired: true },
          allowedActions: ['APPROVE_CHANGES', 'CANCEL', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN', 'REVIEW_PROOF', 'REVIEW_DIFF'],
        }}
        executionId="execution-read-only"
        executionStatus="completed"
        readOnly
        onAction={onAction}
      />,
    );
    expect(screen.getByText('يحتاج مراجعتك')).toBeInTheDocument();
    for (const action of ['approve_changes', 'cancel', 'resume_checkpoint', 'retry_checkpoint', 'start_new_run']) {
      expect(screen.queryByTestId(`button-action-${action}`)).not.toBeInTheDocument();
    }
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByText(/لا يُستنتج من هذا الإسقاط/)).toBeInTheDocument();
  });

  it('renders lifecycle, proof posture, concise technical details, and only allowed actions', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        executionId="execution-1"
        operationId="operation-1"
        executionStatus="running"
        flightState="VALIDATING"
        resumable
        nextAction="Review the validation evidence before accepting the change."
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mission-capsule')).toBeInTheDocument();
    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('بانتظار موافقتك');
    expect(screen.getByTestId('status-canonical')).toHaveTextContent('الحالة المسجلة');
    const identities = screen.getByTestId('execution-identities');
    expect(identities).toHaveTextContent('التنفيذ execution-1');
    expect(identities).toHaveTextContent('العملية operation-1');
    expect(identities).not.toHaveTextContent('الهدف الرئيسي');
    const destinations = screen.getByRole('navigation', { name: 'صفحات تفاصيل التنفيذ' });
    expect(destinations).toHaveTextContent('فتح لوحة التشغيل');
    expect(destinations).toHaveTextContent('خطوات التنفيذ والأدلة');
    expect(destinations).toHaveTextContent('فتح متابعة الأهداف');
    expect(destinations).toHaveTextContent('الحالة والاسترداد والتحقق');
    expect(destinations.querySelector('a[href="/flight-deck?executionId=execution-1"]')).toBeTruthy();
    expect(destinations.querySelector('a[href="/mission-control?executionId=execution-1"]')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'فتح المهمة' })).not.toBeInTheDocument();
    expect(screen.getByTestId('mission-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-validate')).toHaveTextContent('الآن');
    expect(screen.getByTestId('status-proof')).toHaveTextContent('جزئي');
    expect(screen.getByTestId('text-next-action')).toHaveTextContent('Review the validation evidence');
    expect(screen.getAllByText('Run checks').length).toBeGreaterThan(0);
    expect(screen.getByTestId('tool-0')).toHaveTextContent('انتهى بحسب السجل');
    expect(screen.getByTestId('tool-0')).toHaveTextContent('read_file');
    expect(screen.getByTestId('button-action-cancel')).toHaveTextContent('إيقاف التنفيذ');
    expect(screen.getByTestId('button-action-review_diff')).toHaveTextContent('مراجعة التغييرات');
    expect(screen.getByTestId('button-action-approve_changes')).toHaveTextContent('الموافقة على التغييرات');
    expect(screen.getByTestId('button-action-approve_changes')).toHaveAttribute('data-primary-action', 'true');
    expect(screen.getByTestId('primary-next-action')).toHaveTextContent('الخطوة التالية');
    expect(screen.queryByTestId('button-action-resume_checkpoint')).not.toBeInTheDocument();
  });

  it('shows a Mission identity only when an actual Mission ID is supplied', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        missionId="mission-1"
        executionId="execution-1"
        operationId="operation-1"
      />,
    );

    const identities = screen.getByTestId('execution-identities');
    expect(identities).toHaveTextContent('الهدف الرئيسي mission-1');
    expect(identities).toHaveTextContent('التنفيذ execution-1');
    expect(identities).toHaveTextContent('العملية operation-1');
  });

  it('keeps compact identifiers and technical destinations behind explicit disclosure', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        missionId="mission-compact"
        executionId="execution-compact"
        operationId="operation-compact"
        compact
      />,
    );

    const technicalDetails = screen.getByTestId('execution-technical-details');
    expect(technicalDetails).not.toHaveAttribute('open');
    const identities = screen.getByTestId('execution-identities');
    const destinations = screen.getByTestId('execution-destinations');
    expect(identities.closest('details')).toBe(technicalDetails);
    expect(destinations.closest('details')).toBe(technicalDetails);
    expect(identities).not.toBeVisible();
    expect(destinations).not.toBeVisible();
    expect(screen.getByTestId('status-run')).not.toHaveTextContent('execution-compact');

    fireEvent.click(screen.getByTestId('toggle-technical-details'));

    expect(technicalDetails).toHaveAttribute('open');
    expect(identities).toBeVisible();
    expect(identities).toHaveTextContent('execution-compact');
    expect(identities).toHaveTextContent('operation-compact');
    expect(screen.getByRole('navigation', { name: 'صفحات تفاصيل التنفيذ' }))
      .toHaveTextContent('فتح لوحة التشغيل');
  });

  it('keeps delivery gates and recorded apply/commit/push progress visible in compact chat capsules', () => {
    const deliveryProjection: AiExecutionProjection = {
      ...projection,
      timeline: [
        ...projection.timeline.filter((item) => item.id !== 'deliver'),
        { id: 'apply', label: 'Apply changes', status: 'completed', detail: 'Apply receipt recorded.' },
        { id: 'commit', label: 'Commit changes', status: 'pending', detail: 'Apply is recorded; commit remains pending.' },
        { id: 'push', label: 'Push to Git', status: 'pending', detail: null },
        { id: 'deliver', label: 'Deliver to Git', status: 'active', detail: 'Apply is recorded; commit and push remain pending.' },
      ],
    };

    renderPanel(
      <ExecutionProjectionPanel
        projection={deliveryProjection}
        executionId="execution-delivery"
        executionStatus="completed"
        flightState="APPLIED"
        compact
        timelineOpenByDefault
      />,
    );

    const timeline = screen.getByTestId('mission-timeline');
    expect(timeline).toHaveAttribute('open');
    expect(timeline).toHaveTextContent('مراحل التسليم');
    expect(screen.getByTestId('timeline-approval')).toHaveTextContent('Approval required.');
    expect(screen.getByTestId('timeline-validate')).toHaveTextContent('الآن');
    expect(screen.getByTestId('timeline-apply')).toHaveTextContent('انتهت');
    expect(screen.getByTestId('timeline-commit')).toHaveTextContent('لاحقًا');
    expect(screen.getByTestId('timeline-push')).toHaveTextContent('لاحقًا');
    expect(screen.getByTestId('timeline-deliver'))
      .toHaveTextContent('Apply is recorded; commit and push remain pending.');
  });

  it('links to a Task only when the execution has a linked Task ID', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        executionId="execution-1"
        taskId="task-1"
      />,
    );

    expect(screen.getByRole('link', { name: 'فتح المهمة' })).toHaveAttribute(
      'href',
      '/tasks?taskId=task-1',
    );
  });

  it('routes a linked Task retry through the Task retry lifecycle', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id: 'task-1' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    renderPanel(
      <ExecutionProjectionPanel
        projection={{ ...projection, allowedActions: ['RETRY_CHECKPOINT'] }}
        executionId="execution-task-linked"
        executionStatus="failed"
        taskId="task-1"
        allowTaskRecovery
      />,
      queryClient,
    );

    expect(screen.getByRole('button', { name: 'إعادة محاولة المهمة' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-action-retry_checkpoint'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/api/tasks/task-1/retry',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ));
    expect(fetchSpy).not.toHaveBeenCalledWith(
      '/api/ai/executions/execution-task-linked/retry-capability',
      expect.anything(),
    );
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: getListTasksQueryKey() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: getGetTaskQueryKey('task-1') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: getGetTaskLogsQueryKey('task-1') });
    });
    fetchSpy.mockRestore();
  });

  it('hides Task recovery actions unless the owning Task surface opts in', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={{ ...projection, allowedActions: ['RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'REVIEW_PROOF'] }}
        executionId="execution-task-linked"
        executionStatus="failed"
        taskId="task-1"
      />,
    );

    expect(screen.queryByRole('button', { name: 'استئناف المهمة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إعادة محاولة المهمة' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مراجعة الأدلة المسجلة' })).toBeInTheDocument();
  });

  it('keeps destination links in natural order with visible keyboard focus styling', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        executionId="execution-1"
        taskId="task-1"
      />,
    );

    const destinations = screen.getByRole('navigation', { name: 'صفحات تفاصيل التنفيذ' });
    const links = Array.from(destinations.querySelectorAll('a'));

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/flight-deck?executionId=execution-1',
      '/mission-control?executionId=execution-1',
      '/tasks?taskId=task-1',
    ]);
    for (const link of links) {
      expect(link).toHaveClass(
        'focus-visible:outline-none',
        'focus-visible:ring-2',
        'focus-visible:ring-ring',
        'focus-visible:ring-offset-2',
      );
    }
  });

  it('delegates every displayed action to the owning surface without making an API request', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    renderPanel(<ExecutionProjectionPanel projection={projection} executionId="execution-1" onAction={onAction} />);

    fireEvent.click(screen.getByTestId('button-action-approve_changes'));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith('APPROVE_CHANGES'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders safely without projection and does not infer success from missing data', () => {
    const { container } = renderPanel(
      <ExecutionProjectionPanel
        projection={null}
        executionStatus="completed"
        flightState={null}
        evidenceVerdict={null}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps an interrupted or incomplete run conservative', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={{
          ...projection,
          verification: { status: 'unavailable', evidenceVerdict: 'UNAVAILABLE', proofRequired: true },
          stopped: { reason: 'Checkpoint expired', outcome: 'INTERRUPTED' },
          allowedActions: [],
        }}
        executionStatus="cancelled"
      />,
    );

    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('غير مكتمل');
    expect(screen.getByTestId('status-stopped')).toHaveTextContent('منقطع');
    expect(screen.getByTestId('status-proof')).toHaveTextContent('غير متاح');
    expect(screen.queryByText('اكتمل مع التحقق')).not.toBeInTheDocument();
  });

  it('keeps a durable replan requirement visible as the primary recovery state', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={{
          ...projection,
          verification: { status: 'unavailable', evidenceVerdict: 'UNAVAILABLE', proofRequired: true },
          stopped: { reason: 'The prior plan can no longer continue safely.', outcome: 'FAILED' },
          allowedActions: ['RETRY_CHECKPOINT', 'REVIEW_PROOF', 'START_NEW_RUN'],
        }}
        executionStatus="failed"
        flightState="BLOCKED"
        nextAction="NEEDS_REPLAN"
      />,
    );

    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('يحتاج تعديل الخطة');
    expect(screen.getByTestId('primary-next-action')).toHaveTextContent('إعادة المحاولة من نقطة الحفظ');
    expect(screen.getByTestId('button-action-retry_checkpoint')).toHaveAttribute(
      'data-primary-action',
      'true',
    );
    expect(screen.getByTestId('status-proof')).toHaveTextContent('غير متاح');
  });
});