import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import Tasks from './Tasks';

const createTaskMutate = vi.hoisted(() => vi.fn());
const updateTaskMutate = vi.hoisted(() => vi.fn());
const deleteTaskMutate = vi.hoisted(() => vi.fn());

vi.mock('@workspace/api-client-react', () => ({
  useListTasks: vi.fn(),
  useListProjects: vi.fn(),
  useExecuteTask: vi.fn(),
  useRetryTask: vi.fn(),
  useRollbackTask: vi.fn(),
  useGetTaskLogs: vi.fn(),
  useGetTask: vi.fn(),
  useGetAiExecution: vi.fn(),
  useRecordTaskVerification: vi.fn(),
  useAiResumeTask: vi.fn(),
  useCreateTask: vi.fn(),
  useUpdateTask: vi.fn(),
  useDeleteTask: vi.fn(),
  getListTasksQueryKey: vi.fn((params?: unknown) => ['/api/tasks', ...(params ? [params] : [])]),
  getListProjectsQueryKey: vi.fn(() => ['projects']),
  getGetTaskLogsQueryKey: vi.fn((taskId: string) => ['task-logs', taskId]),
  getGetTaskQueryKey: vi.fn((taskId: string) => ['task', taskId]),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  useExecuteTask,
  useGetTaskLogs,
  useGetTask,
  useGetAiExecution,
  useListTasks,
  useRetryTask,
  useRollbackTask,
  useRecordTaskVerification,
  useAiResumeTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useListProjects,
} from '@workspace/api-client-react';

const mutation = () => ({ mutate: vi.fn(), isPending: false });

const recoveryCases = [
  {
    id: 'task-auth',
    title: 'Repair provider authentication',
    availabilityState: 'authentication_failed',
    heading: 'تعذر التحقق من بيانات وصول المزود',
    action: 'Replace the provider API key with a valid key, then retry.',
    correlationId: 'task-auth-support',
  },
  {
    id: 'task-quota',
    title: 'Recover from provider quota',
    availabilityState: 'quota_exhausted',
    heading: 'انتهت حصة الاستخدام لدى المزود',
    action: 'Add provider credits or configure another provider.',
    correlationId: 'task-quota-support',
  },
  {
    id: 'task-outage',
    title: 'Recover from provider outage',
    availabilityState: 'provider_outage',
    heading: 'المزود غير متاح مؤقتًا',
    action: 'Retry in a moment; configure another provider if the issue persists.',
    correlationId: 'task-outage-support',
  },
] as const;

const executionProjectionFixture: AiExecutionProjection = {
  schemaVersion: 2,
  kind: 'DELIVERY',
  phase: 'VALIDATE',
  objective: 'Repair provider authentication',
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
    totalCalls: 1,
    activeTool: 'read_file',
    recent: [{ tool: 'read_file', status: 'completed', source: 'src/App.tsx' }],
  },
  workspace: { changedFiles: ['src/App.tsx'], diffStatus: 'available' },
  verification: { status: 'running', evidenceVerdict: 'PARTIAL', proofRequired: true },
  approval: { required: true, status: 'PENDING', proposalId: 'proposal-1' },
  stopped: { reason: null, outcome: null },
  timeline: [],
  allowedActions: [],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Tasks />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/tasks');
  vi.mocked(useListProjects).mockReturnValue({
    data: [{ id: 'project-1', name: 'Test Project' }],
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useListProjects>);
  vi.mocked(useListTasks).mockReturnValue({
    data: recoveryCases.map((item) => ({
      ...item,
      projectId: 'project-1',
      description: 'A failed task with a provider recovery receipt.',
      status: 'failed',
      priority: 'p1',
      phase: 'execute',
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:01:00.000Z',
      retryCount: 0,
      maxRetries: 3,
      agentResponse: JSON.stringify({
        kind: 'AI_TASK_EXECUTION_RECEIPT',
        terminalStatus: 'FAILED',
        provider: 'safe-provider-label',
        model: 'safe-model-label',
        attempt: 3,
        attempts: 2,
        durationMs: 1200,
        availabilityState: item.availabilityState,
        operatorAction: item.action,
        correlationId: item.correlationId,
        upstreamMessage: 'raw provider diagnostic: provider-secret-token-123456789',
        apiKey: 'sk-provider-secret-123456789',
      }),
    })),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isRefetching: false,
    dataUpdatedAt: 0,
  } as ReturnType<typeof useListTasks>);
  vi.mocked(useGetTaskLogs).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useGetTaskLogs>);
  vi.mocked(useGetTask).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useGetTask>);
  vi.mocked(useGetAiExecution).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useGetAiExecution>);
  vi.mocked(useExecuteTask).mockReturnValue(mutation() as ReturnType<typeof useExecuteTask>);
  vi.mocked(useRetryTask).mockReturnValue(mutation() as ReturnType<typeof useRetryTask>);
  vi.mocked(useRollbackTask).mockReturnValue(mutation() as ReturnType<typeof useRollbackTask>);
  vi.mocked(useRecordTaskVerification).mockReturnValue(mutation() as ReturnType<typeof useRecordTaskVerification>);
  vi.mocked(useAiResumeTask).mockReturnValue(mutation() as ReturnType<typeof useAiResumeTask>);
  vi.mocked(useCreateTask).mockReturnValue({
    mutate: createTaskMutate,
    isPending: false,
    error: null,
  } as ReturnType<typeof useCreateTask>);
  vi.mocked(useUpdateTask).mockReturnValue({
    mutate: updateTaskMutate,
    isPending: false,
    error: null,
  } as ReturnType<typeof useUpdateTask>);
  vi.mocked(useDeleteTask).mockReturnValue({
    mutate: deleteTaskMutate,
    isPending: false,
    error: null,
  } as ReturnType<typeof useDeleteTask>);
});

describe('project-scoped task list contracts', () => {
  it('sends the selected owned project in the list request', () => {
    renderPage();
    expect(useListTasks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1' }),
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it('does not issue a projectless request when there are no projects', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [], isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useListProjects>);
    renderPage();
    expect(useListTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
  });

  it('does not fall back to the first project for an unavailable explicit target', () => {
    window.history.replaceState({}, '', '/tasks?projectId=unavailable-project');
    renderPage();
    expect(useListTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('المشروع المطلوب غير متاح');
    expect(screen.queryByText('Repair provider authentication')).not.toBeInTheDocument();
  });

  it('uses an independent cache key and hides the previous project when switching', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [{ id: 'project-1', name: 'First' }, { id: 'project-2', name: 'Second' }],
      isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useListProjects>);
    const view = renderPage();
    fireEvent.change(screen.getByTestId('select-task-project'), { target: { value: 'project-2' } });
    expect(useListTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'project-2' }),
      expect.objectContaining({
        query: expect.objectContaining({
          queryKey: ['/api/tasks', expect.objectContaining({ projectId: 'project-2' })],
        }),
      }),
    );
    expect(screen.queryByText('Repair provider authentication')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('projectId')).toBe('project-2');
    view.unmount();
    renderPage();
    expect(useListTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'project-2' }), expect.anything(),
    );
  });

  it('resolves the project of a task deep link even when it is outside the first list page', () => {
    window.history.replaceState({}, '', '/tasks?taskId=target-task');
    vi.mocked(useListProjects).mockReturnValue({
      data: [{ id: 'project-1', name: 'First' }, { id: 'project-2', name: 'Second' }],
      isLoading: false, isError: false, error: null,
    } as ReturnType<typeof useListProjects>);
    vi.mocked(useGetTask).mockReturnValue({
      data: {
        id: 'target-task', projectId: 'project-2', title: 'Deep linked work',
        status: 'pending', priority: 'p2', correlationId: null,
        createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
      },
      isLoading: false, isError: false,
    } as ReturnType<typeof useGetTask>);
    renderPage();
    expect(useListTasks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-2' }), expect.anything(),
    );
    expect(screen.getByText('Deep linked work')).toBeInTheDocument();
    expect(screen.queryByText('Repair provider authentication')).not.toBeInTheDocument();
  });

  it('replaces the list when the server returns an empty snapshot after deletion', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = () => <QueryClientProvider client={client}><Tasks /></QueryClientProvider>;
    const view = render(page());
    expect(screen.getByText('Repair provider authentication')).toBeInTheDocument();
    const previous = vi.mocked(useListTasks).mock.results.at(-1)!.value;
    vi.mocked(useListTasks).mockReturnValue({ ...previous, data: [], dataUpdatedAt: 2 });
    view.rerender(page());
    expect(screen.queryByText('Repair provider authentication')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد مهام في هذا العرض');
  });

  it('retries a failed list read without replacing the error with an empty result or executing a task', () => {
    const refetch = vi.fn();
    vi.mocked(useListTasks).mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('Owner-scoped read unavailable'), refetch,
    } as unknown as ReturnType<typeof useListTasks>);
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر تحميل المهام');
    expect(screen.getByRole('alert')).toHaveTextContent('Owner-scoped read unavailable');
    expect(screen.queryByText('لا توجد مهام في هذا العرض')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(vi.mocked(useExecuteTask).mock.results.at(-1)!.value.mutate).not.toHaveBeenCalled();
  });

  it('describes filter emptiness as the current view and preserves the stored status code', () => {
    renderPage();
    const previous = vi.mocked(useListTasks).mock.results.at(-1)!.value;
    vi.mocked(useListTasks).mockImplementation((params) => ({
      ...previous, data: params?.status === 'running' ? [] : previous.data,
    }));
    fireEvent.change(screen.getByRole('combobox', { name: 'تصفية المهام حسب الحالة' }), { target: { value: 'running' } });
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد مهام تطابق الفلاتر');
    expect(screen.getByRole('status')).toHaveTextContent('لا حكم على كل مهام المشروع');
    expect(useListTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'project-1', status: 'running' }), expect.anything(),
    );
  });

  it('keeps Arabic labels separate from server priority codes and local acceptance filtering', () => {
    renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'تصفية المهام حسب الأولوية' }), { target: { value: 'p1' } });
    expect(useListTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'project-1', priority: 'p1' }), expect.anything(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'تصفية المهام حسب القبول' }), { target: { value: 'recovery-required' } });
    expect(screen.getByRole('combobox', { name: 'تصفية المهام حسب القبول' })).toHaveValue('recovery-required');
    expect(useListTasks).toHaveBeenLastCalledWith(
      { projectId: 'project-1', priority: 'p1', status: undefined }, expect.anything(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد مهام ضمن فلتر الاسترداد المطلوب');
    fireEvent.change(screen.getByRole('textbox', { name: 'ابحث عن مهمة' }), { target: { value: 'Repair' } });
    fireEvent.click(screen.getByRole('button', { name: 'مسح البحث عن المهام' }));
    expect(screen.getByRole('textbox', { name: 'ابحث عن مهمة' })).toHaveValue('');
    expect(vi.mocked(useExecuteTask).mock.results.at(-1)!.value.mutate).not.toHaveBeenCalled();
  });

  it('routes a named Arabic retry to the same task without executing, rolling back, or opening its card', () => {
    renderPage();
    const snapshot = vi.mocked(useListTasks).mock.results.at(-1)!.value;
    const task = snapshot.data!.find((item) => item.title === 'Repair provider authentication')!;
    fireEvent.click(screen.getByRole('button', { name: 'إعادة محاولة المهمة: Repair provider authentication' }));
    expect(vi.mocked(useRetryTask).mock.results.at(-1)!.value.mutate).toHaveBeenCalledWith(
      { taskId: task.id }, expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(vi.mocked(useExecuteTask).mock.results.at(-1)!.value.mutate).not.toHaveBeenCalled();
    expect(vi.mocked(useRollbackTask).mock.results.at(-1)!.value.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'نتيجة قبول الخادم' })).not.toBeInTheDocument();
  });
});

function mockTaskExecutionProjection(
  taskCorrelationId: string,
  executionCorrelationId: string,
  options: { taskStatus?: string; executionIsFetching?: boolean } = {},
) {
  vi.mocked(useGetTask).mockReturnValue({
    data: {
      id: 'task-auth',
      projectId: 'project-1',
      correlationId: taskCorrelationId,
      status: options.taskStatus ?? 'verifying',
    } as NonNullable<ReturnType<typeof useGetTask>['data']>,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useGetTask>);
  vi.mocked(useGetTaskLogs).mockReturnValue({
    data: [{
      id: 'task-log-1',
      taskId: 'task-auth',
      executionId: 'execution-1',
      attempt: 1,
      sequence: 1,
      message: 'Task execution started',
      createdAt: '2026-08-25T10:00:00.000Z',
    }] as NonNullable<ReturnType<typeof useGetTaskLogs>['data']>,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useGetTaskLogs>);
  vi.mocked(useGetAiExecution).mockReturnValue({
    data: {
      id: 'execution-1',
      correlationId: executionCorrelationId,
      linkedTaskId: 'task-auth',
      projectId: 'project-1',
      status: 'running',
      flightState: 'VALIDATING',
      evidenceVerdict: 'PARTIAL',
      proofRequired: true,
      checkpoint: {},
      checkpointVersion: 1,
      resumable: false,
      projection: executionProjectionFixture,
    } as NonNullable<ReturnType<typeof useGetAiExecution>['data']>,
    isLoading: false,
    isFetching: options.executionIsFetching ?? false,
    isError: false,
    error: null,
  } as ReturnType<typeof useGetAiExecution>);
}

describe('Tasks recovery rendering', () => {
  it('edits task title, description, and priority through the generated PATCH mutation', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'تعديل المهمة: Repair provider authentication' }));
    fireEvent.change(screen.getByTestId('input-edit-task-title'), { target: { value: 'Repair authentication flow' } });
    fireEvent.change(screen.getByTestId('input-edit-task-description'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('select-edit-task-priority'), { target: { value: 'p0' } });
    fireEvent.click(screen.getByTestId('button-submit-edit-task'));

    expect(updateTaskMutate).toHaveBeenCalledWith(
      {
        taskId: 'task-auth',
        data: {
          title: 'Repair authentication flow',
          description: '',
          priority: 'p0',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('requires confirmation before deleting and shows server conflicts in the dialog', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'حذف المهمة: Repair provider authentication' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'حذف المهمة؟' });
    expect(confirmation).toHaveTextContent('سيُحذف «Repair provider authentication» نهائيًا مع سجلات تنفيذه. لا يمكن التراجع عن ذلك.');
    fireEvent.click(within(confirmation).getByTestId('button-confirm-delete-task'));

    expect(deleteTaskMutate).toHaveBeenCalledWith(
      { taskId: 'task-auth' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    const [, callbacks] = deleteTaskMutate.mock.calls[0];
    act(() => {
      callbacks.onError(new Error('Cancel and terminalize the task execution before deleting this task.'));
    });
    expect(within(screen.getByRole('alertdialog')).getByRole('alert')).toHaveTextContent(
      'Cancel and terminalize the task execution before deleting this task.',
    );
  });

  it('preserves authentication, quota, and outage guidance from failed receipts', () => {
    renderPage();

    for (const item of recoveryCases) {
      fireEvent.click(screen.getByRole('button', { name: `عرض تفاصيل المهمة: ${item.title}` }));
      const card = screen.getByRole('region', { name: 'إرشادات استعادة جاهزية المزود' });
      expect(within(card).getByRole('heading', { name: item.heading })).toBeInTheDocument();
      expect(within(card).getByText(item.availabilityState)).toHaveAttribute('dir', 'ltr');
      expect(within(card).getByText(item.action)).toHaveAttribute('dir', 'auto');
      expect(within(card).getByText(/مرجع الدعم:/)).toHaveTextContent(item.correlationId);
      fireEvent.click(screen.getByRole('button', { name: `طي تفاصيل المهمة: ${item.title}` }));
    }
  });

  it('labels the execution attempt separately from provider attempts', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.getByText('محاولة التنفيذ: 3')).toBeInTheDocument();
    expect(screen.getByText('محاولات المزوّد: 2')).toBeInTheDocument();
  });

  it('hides a prior execution projection after retry rotates the Task correlation pointer', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-prior');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.queryByTestId('mission-capsule')).not.toBeInTheDocument();
  });

  it('shows the execution projection while its identity matches the current Task pointer', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-current');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.getByTestId('mission-capsule')).toBeInTheDocument();
  });

  it('hides a cached execution projection while the running attempt refreshes', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-current', {
      taskStatus: 'running',
      executionIsFetching: true,
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.queryByTestId('mission-capsule')).not.toBeInTheDocument();
  });

  it('hides the execution projection while a resume request is pending', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-current', {
      taskStatus: 'verifying',
    });
    vi.mocked(useAiResumeTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as ReturnType<typeof useAiResumeTask>);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.queryByTestId('mission-capsule')).not.toBeInTheDocument();
  });

  it('renders the server acceptance outcome and safe recovery action', () => {
    vi.mocked(useGetTask).mockReturnValue({
      data: {
        status: 'verifying',
        acceptance: {
          attempt: 2,
          terminalStatus: 'failed',
          outcome: 'FAILED',
          reasonCode: 'PROVIDER_FAILURE',
          nextActionCode: 'RESUME_ALLOWED',
          evidenceComplete: false,
          evidenceRequired: false,
          resumable: true,
          disposition: {
            reasonCodes: ['PROVIDER_FAILURE'],
            outcome: 'FAILED',
            recoveryState: 'REQUIRED',
            nextActionCode: 'RESUME_ALLOWED',
            operatorAction: 'Resume the saved task checkpoint.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    const acceptance = screen.getByRole('region', { name: 'نتيجة قبول الخادم' });
    expect(within(acceptance).getByText('يتطلب الاسترداد')).toBeInTheDocument();
    expect(within(acceptance).getByText('FAILED')).toHaveAttribute('dir', 'ltr');
    expect(within(acceptance).getByText(
      (_, element) => element?.tagName === 'SPAN' && element.textContent === 'النتيجة: FAILED',
    )).toBeInTheDocument();
    expect(within(acceptance).getByText('Resume the saved task checkpoint.')).toBeInTheDocument();
    expect(within(acceptance).getByRole('button', { name: 'استئناف تنفيذ المهمة' })).toBeInTheDocument();
    expect(within(acceptance).queryByText(/providerPayload/i)).not.toBeInTheDocument();
  });

  it('withholds a cached prior-attempt acceptance while current Task details refresh', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-resuming',
        projectId: 'project-1',
        title: 'Resume accepted execution',
        status: 'running',
        correlationId: 'correlation-current',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:03:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    vi.mocked(useGetTask).mockReturnValue({
      data: {
        status: 'verifying',
        acceptance: {
          attempt: 1,
          terminalStatus: 'paused',
          outcome: 'FAILED',
          reasonCode: 'EXECUTION_LEASE_EXPIRED',
          nextActionCode: 'RESUME_ALLOWED',
          evidenceComplete: false,
          evidenceRequired: false,
          resumable: true,
          disposition: {
            reasonCodes: ['EXECUTION_LEASE_EXPIRED'],
            outcome: 'FAILED',
            recoveryState: 'REQUIRED',
            nextActionCode: 'RESUME_ALLOWED',
            operatorAction: 'Resume the saved task checkpoint.',
          },
        },
      },
      isLoading: false,
      isFetching: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Resume accepted execution' }));

    expect(screen.queryByRole('region', { name: 'نتيجة قبول الخادم' })).not.toBeInTheDocument();
    expect(screen.getByText('جارٍ تحديث قبول المحاولة الحالية…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'استئناف تنفيذ المهمة' })).not.toBeInTheDocument();
  });

  it('does not present the prior acceptance while a resume request is pending', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-resume-pending',
        projectId: 'project-1',
        title: 'Resume in progress',
        status: 'verifying',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:01:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    vi.mocked(useGetTask).mockReturnValue({
      data: {
        status: 'verifying',
        acceptance: {
          attempt: 1,
          terminalStatus: 'paused',
          outcome: 'FAILED',
          reasonCode: 'EXECUTION_LEASE_EXPIRED',
          nextActionCode: 'RESUME_ALLOWED',
          evidenceComplete: false,
          evidenceRequired: false,
          resumable: true,
          disposition: {
            reasonCodes: ['EXECUTION_LEASE_EXPIRED'],
            outcome: 'FAILED',
            recoveryState: 'REQUIRED',
            nextActionCode: 'RESUME_ALLOWED',
            operatorAction: 'Resume the saved task checkpoint.',
          },
        },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetTask>);
    vi.mocked(useAiResumeTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as ReturnType<typeof useAiResumeTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Resume in progress' }));

    expect(screen.queryByRole('region', { name: 'نتيجة قبول الخادم' })).not.toBeInTheDocument();
    expect(screen.getByText('جارٍ استئناف التنفيذ؛ لا تُعرض نتيجة القبول السابقة كحالية.')).toBeInTheDocument();
  });

  it('withholds a cached execution receipt while resume is pending', () => {
    vi.mocked(useAiResumeTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as ReturnType<typeof useAiResumeTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.queryByText('إيصال التنفيذ')).not.toBeInTheDocument();
  });

  it('withholds a prior verification result while resume is pending', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        ...recoveryCases[0]!,
        id: 'task-prior-verification',
        title: 'Task with prior verification',
        projectId: 'project-1',
        status: 'failed',
        priority: 'p1',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:01:00.000Z',
        verificationResult: {
          passed: true,
          decision: 'verified',
          steps: [{ name: 'Typecheck', passed: true }],
        },
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    vi.mocked(useAiResumeTask).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    } as ReturnType<typeof useAiResumeTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Task with prior verification' }));

    expect(screen.queryByText('خطوات التحقق:')).not.toBeInTheDocument();
  });

  it('does not offer resume when the Task status blocks it despite a resumable execution acceptance', () => {
    vi.mocked(useGetTask).mockReturnValue({
      data: {
        status: 'failed',
        acceptance: {
          attempt: 2,
          terminalStatus: 'paused',
          outcome: 'FAILED',
          reasonCode: 'EXECUTION_LEASE_EXPIRED',
          nextActionCode: 'RESUME_ALLOWED',
          evidenceComplete: false,
          evidenceRequired: false,
          resumable: true,
          disposition: {
            reasonCodes: ['EXECUTION_LEASE_EXPIRED'],
            outcome: 'FAILED',
            recoveryState: 'REQUIRED',
            nextActionCode: 'RESUME_ALLOWED',
            operatorAction: 'Resume the saved task checkpoint.',
          },
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetTask>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    const acceptance = screen.getByRole('region', { name: 'نتيجة قبول الخادم' });
    expect(within(acceptance).getByText(/حالة المهمة لا تسمح بالاستئناف/)).toBeInTheDocument();
    expect(within(acceptance).queryByRole('button', { name: 'استئناف تنفيذ المهمة' })).not.toBeInTheDocument();
  });

  it('withholds cached acceptance badges while the Task list refreshes', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-stale-acceptance',
        projectId: 'project-1',
        title: 'Refresh accepted task',
        status: 'verifying',
        priority: 'p1',
        correlationId: 'correlation-current',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:01:00.000Z',
        agentResponse: JSON.stringify({
          kind: 'AI_TASK_EXECUTION_RECEIPT',
          terminalStatus: 'SUCCEEDED',
          attempt: 1,
          operationId: 'execution-current',
          correlationId: 'correlation-current',
        }),
        acceptance: {
          attempt: 1,
          terminalStatus: 'completed',
          outcome: 'SUCCEEDED',
          reasonCode: 'ACCEPTED',
          nextActionCode: 'NONE',
          evidenceComplete: true,
          evidenceRequired: true,
          resumable: false,
        },
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: true,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);

    renderPage();

    expect(screen.queryByLabelText('القبول: مقبول')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Refresh accepted task' }));
    expect(screen.queryByText('إيصال التنفيذ')).not.toBeInTheDocument();
  });

  it('shows public acceptance badges and filters task rows by acceptance outcome', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [
        {
          id: 'task-accepted',
          projectId: 'project-1',
          title: 'Accepted task',
          status: 'completed',
          priority: 'p1',
          createdAt: '2026-08-25T10:00:00.000Z',
          updatedAt: '2026-08-25T10:01:00.000Z',
          acceptance: {
            attempt: 1,
            terminalStatus: 'completed',
            outcome: 'SUCCEEDED',
            reasonCode: 'ACCEPTED',
            nextActionCode: 'NONE',
            evidenceComplete: true,
            evidenceRequired: true,
            resumable: false,
          },
        },
        {
          id: 'task-recovery',
          projectId: 'project-1',
          title: 'Recovery task',
          status: 'failed',
          priority: 'p1',
          createdAt: '2026-08-25T10:00:00.000Z',
          updatedAt: '2026-08-25T10:01:00.000Z',
          acceptance: {
            attempt: 1,
            terminalStatus: 'failed',
            outcome: 'FAILED',
            reasonCode: 'EXECUTION_FAILED',
            nextActionCode: 'RESUME_ALLOWED',
            evidenceComplete: false,
            evidenceRequired: false,
            resumable: true,
            disposition: {
              reasonCodes: ['EXECUTION_FAILED'],
              outcome: 'FAILED',
              recoveryState: 'REQUIRED',
              nextActionCode: 'RESUME_ALLOWED',
              operatorAction: 'Resume the saved task checkpoint.',
            },
          },
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);

    renderPage();
    expect(screen.getByLabelText('القبول: مقبول')).toBeInTheDocument();
    expect(screen.getByLabelText('القبول: يتطلب الاسترداد')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'تصفية المهام حسب القبول' }), {
      target: { value: 'accepted' },
    });
    expect(screen.getByText('Accepted task')).toBeInTheDocument();
    expect(screen.queryByText('Recovery task')).not.toBeInTheDocument();
  });

  it('does not expose raw provider diagnostics or credentials in task details', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Repair provider authentication' }));

    expect(screen.queryByText(/raw provider diagnostic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-secret-token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-provider-secret/i)).not.toBeInTheDocument();
    expect(screen.getByText(/لا تُعرض التعليمات الداخلية أو تفاصيل تشخيص المزوّد/)).toBeInTheDocument();
  });

  it('shows saved Mission answer excerpts and source spans while rejecting unsafe receipt paths', () => {
    const binding = {
      claimId: 'claim-report-status',
      source: 'src/report.mjs',
      startLine: 12,
      endLine: 14,
      excerptHash: 'a'.repeat(64),
      excerpt: 'export function reportStatus() {\n  return "COMPLETED";\n}',
      excerptRedacted: false,
    };
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        ...recoveryCases[0]!,
        id: 'task-answer-evidence',
        title: 'Review proof evidence',
        projectId: 'project-1',
        description: 'Review the durable evidence binding.',
        status: 'completed',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:01:00.000Z',
        retryCount: 0,
        maxRetries: 3,
        agentResponse: JSON.stringify({
          kind: 'AI_TASK_EXECUTION_RECEIPT',
          terminalStatus: 'SUCCEEDED',
          answerProof: {
            version: 3,
            status: 'PROVEN',
            evidenceBindings: [
              binding,
              { ...binding, claimId: 'claim-unsafe-path', source: '../secrets.env' },
            ],
          },
        }),
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Review proof evidence' }));
    fireEvent.click(screen.getByText('مصادر الإجابة من الملفات (1)'));

    const evidencePanel = screen.getByTestId('task-answer-evidence');
    expect(evidencePanel).toHaveTextContent('src/report.mjs:12-14');
    expect(evidencePanel).toHaveTextContent('return "COMPLETED";');
    expect(evidencePanel).toHaveTextContent('a'.repeat(64));
    expect(evidencePanel).not.toHaveTextContent('../secrets.env');
  });

  it('renders the durable progress timeline from out-of-order logs without duplicates', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-progress',
        projectId: 'project-1',
        title: 'Replay progress timeline',
        status: 'completed',
        correlationId: 'correlation-current',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:03:00.000Z',
        completedAt: '2026-08-25T10:03:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    const contextLog = {
      id: 'progress-2',
      taskId: 'task-progress',
      level: 'info' as const,
      message: 'context ready',
      timestamp: '2026-08-25T10:01:00.000Z',
      eventType: 'progress' as const,
      executionId: 'execution-1',
      correlationId: 'correlation-previous',
      attempt: 1,
      sequence: 2,
      progressStage: 'context' as const,
      progressStatus: 'completed' as const,
      progressMessage: 'Previous attempt context was ready.',
      startedAt: '2026-08-25T10:00:30.000Z',
      finishedAt: '2026-08-25T10:01:00.000Z',
    };
    const previousAttemptModelLog = {
      ...contextLog,
      id: 'progress-1',
      message: 'model completed on a prior attempt',
      correlationId: 'correlation-current',
      executionId: 'execution-current',
      attempt: 1,
      sequence: 1,
      progressStage: 'model' as const,
      progressMessage: 'Prior attempt model completed.',
    };
    vi.mocked(useGetTaskLogs).mockReturnValue({
      data: [
        {
          id: 'progress-3',
          taskId: 'task-progress',
          level: 'info',
          message: 'task complete',
          timestamp: '2026-08-25T10:03:00.000Z',
          eventType: 'terminal',
          executionId: 'execution-current',
          correlationId: 'correlation-current',
          attempt: 2,
          sequence: 3,
          progressStage: 'result',
          progressStatus: 'completed',
          progressPercent: 100,
          progressMessage: 'Task completed successfully.',
          terminalOutcome: 'SUCCEEDED',
        },
        previousAttemptModelLog,
        contextLog,
        contextLog,
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useGetTaskLogs>);
    vi.mocked(useGetAiExecution).mockReturnValue({
      data: {
        id: 'execution-current',
        correlationId: 'correlation-current',
        linkedTaskId: 'task-progress',
        attempt: 2,
      } as NonNullable<ReturnType<typeof useGetAiExecution>['data']>,
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetAiExecution>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Replay progress timeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'السجل' }));

    expect(screen.getByText('إعداد سياق المشروع')).toBeInTheDocument();
    const plan = screen.getByRole('region', { name: 'خطة التنفيذ' });
    const contextStep = within(plan).getByText('إعداد سياق المشروع').parentElement?.parentElement;
    expect(contextStep).toHaveTextContent('بانتظار البدء');
    expect(contextStep).not.toHaveTextContent('Previous attempt context was ready.');
    const modelStep = within(plan).getByText('طلب المساعدة من النموذج').parentElement?.parentElement;
    expect(modelStep).toHaveTextContent('بانتظار البدء');
    expect(modelStep).not.toHaveTextContent('Prior attempt model completed.');
    expect(within(plan).getByText('هذه الحالات تصف تقدمًا مسجلًا، ولا تمنح قبولًا للنتيجة أو إثباتًا حديثًا.')).toBeInTheDocument();
    expect(screen.getByText('النتيجة النهائية')).toBeInTheDocument();
    expect(screen.getByText('100% تقدم بحسب الخادم')).toBeInTheDocument();
    expect(screen.getAllByText('تقدم التنفيذ')).toHaveLength(2);
    expect(screen.getByText(/context ready/)).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(/task complete/)).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('الحالة')).toBeInTheDocument();
    expect(screen.getByText('انتهت بحسب السجل', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('انتهت بحسب السجل', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('نتيجة التنفيذ')).toBeInTheDocument();
  });

  it('does not present a prior attempt percentage while a resumed attempt has no progress events', () => {
    const staleProgressLog = {
      id: 'progress-previous',
      taskId: 'task-current',
      level: 'info' as const,
      message: 'Previous correlation nearly complete.',
      timestamp: '2026-08-25T10:02:00.000Z',
      eventType: 'progress' as const,
      executionId: 'execution-previous',
      correlationId: 'correlation-previous',
      attempt: 1,
      sequence: 12,
      progressStage: 'finalization' as const,
      progressStatus: 'active' as const,
      progressPercent: 88,
      progressMessage: 'Previous correlation nearing completion.',
    };
    const staleSameCorrelationLog = {
      ...staleProgressLog,
      id: 'progress-resumed-previous-attempt',
      message: 'Previous resumed attempt nearly complete.',
      executionId: 'execution-current',
      correlationId: 'correlation-current',
      attempt: 1,
      sequence: 13,
      progressPercent: 96,
      progressMessage: 'Previous resumed attempt nearing completion.',
    };
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-current',
        projectId: 'project-1',
        title: 'Retry before progress starts',
        status: 'running',
        correlationId: 'correlation-current',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:03:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    vi.mocked(useGetTaskLogs).mockReturnValue({
      data: [staleProgressLog, staleSameCorrelationLog],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useGetTaskLogs>);
    vi.mocked(useGetAiExecution).mockReturnValue({
      data: {
        id: 'execution-current',
        correlationId: 'correlation-current',
        linkedTaskId: 'task-current',
        attempt: 1,
      } as NonNullable<ReturnType<typeof useGetAiExecution>['data']>,
      isLoading: false,
      isFetching: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useGetAiExecution>);
    class MockEventSource {
      onerror: ((event: Event) => void) | null = null;
      addEventListener = vi.fn();
      close = vi.fn();
    }
    vi.stubGlobal('EventSource', MockEventSource);

    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Retry before progress starts' }));
      fireEvent.click(screen.getByRole('button', { name: 'السجل' }));

      const progressMetric = screen.getByText('التقدم').parentElement;
      expect(progressMetric).not.toHaveTextContent('96%');
      expect(progressMetric).not.toHaveTextContent('88%');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps long activity timelines bounded while preserving the first and latest events', () => {
    const activityLogs = Array.from({ length: 120 }, (_, index) => ({
      id: `activity-${index}`,
      taskId: 'task-long-activity',
      level: 'info' as const,
      message: `activity event ${index}`,
      timestamp: `2026-08-25T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-long-activity',
        projectId: 'project-1',
        title: 'Keep a long timeline readable',
        status: 'completed',
        priority: 'p1',
        phase: 'execute',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:03:00.000Z',
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);
    vi.mocked(useGetTaskLogs).mockReturnValue({
      data: activityLogs,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useGetTaskLogs>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Keep a long timeline readable' }));
    fireEvent.click(screen.getByRole('button', { name: 'السجل' }));

    expect(screen.getByRole('status')).toHaveTextContent('آخر 79 من أصل 120 سجل نشاط');
    const firstUnknownEvent = screen.getByText(/activity event 0/);
    expect(firstUnknownEvent).toHaveAttribute('dir', 'auto');
    expect(firstUnknownEvent.closest('details')).toHaveTextContent('نشاط');
    expect(screen.getByText(/activity event 119/)).toBeInTheDocument();
    expect(screen.queryByText(/activity event 40/)).not.toBeInTheDocument();
  });

  it('separates the current rule decision from its expandable verification history', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-history',
        projectId: 'project-1',
        title: 'Review a rule with reversals',
        status: 'completed',
        priority: 'p1',
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:03:00.000Z',
        remediationPlan: {
          version: 1,
          ruleId: 'rule-1',
          ruleCode: 'TEST-001',
          ruleTitle: 'Evidence-backed check',
          severity: 'high',
          occurrenceCount: 1,
          evidence: [{ file: 'src/example.ts', line: 1, snippet: 'x', occurrences: 1 }],
          relatedFiles: ['src/example.ts'],
          fixDescription: 'Make the check pass.',
          verificationSteps: ['Confirm the result.'],
          verificationChecks: [{
            id: 'rule-verification-1',
            kind: 'operator_attestation',
            guidance: 'Confirm the result.',
          }],
          source: { type: 'scan', correlationId: null, revision: null, completeness: 'COMPLETE' },
          status: 'verified',
        },
        verificationResult: {
          passed: true,
          decision: 'verified',
          steps: [{
            id: 'rule-verification-1',
            name: 'Rule verification #1',
            kind: 'operator_attestation',
            guidance: 'Confirm the result.',
            passed: true,
            evidence: 'Current evidence after the fix.',
          }],
          history: [
            {
              id: 'history-1',
              checkId: 'rule-verification-1',
              name: 'Rule verification #1',
              kind: 'operator_attestation',
              guidance: 'Confirm the result.',
              passed: false,
              evidence: 'The behavior still failed.',
              actor: 'operator-a',
              recordedAt: '2026-08-25T10:01:00.000Z',
            },
            {
              id: 'history-2',
              checkId: 'rule-verification-1',
              name: 'Rule verification #1',
              kind: 'operator_attestation',
              guidance: 'Confirm the result.',
              passed: true,
              evidence: 'Current evidence after the fix.',
              actor: 'operator-b',
              recordedAt: '2026-08-25T10:03:00.000Z',
            },
          ],
        },
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListTasks>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'عرض تفاصيل المهمة: Review a rule with reversals' }));
    fireEvent.click(screen.getByRole('button', { name: 'السجل' }));

    expect(screen.getByText('القرار الحالي المسجل')).toBeInTheDocument();
    expect(screen.getByText('اجتاز بحسب القرار والدليل المسجلين')).toBeInTheDocument();
    const history = screen.getByText('سجل قرارات التحقق (2)');
    fireEvent.click(history);
    const previousEvidence = screen.getByText('The behavior still failed.');
    expect(previousEvidence).toHaveAttribute('dir', 'auto');
    const operatorA = screen.getByText('operator-a');
    const operatorB = screen.getByText('operator-b');
    expect(operatorA).toHaveAttribute('dir', 'auto');
    expect(operatorB).toHaveAttribute('dir', 'auto');
    expect(operatorA.parentElement).toHaveTextContent(/بواسطة\s*operator-a/);
    expect(operatorB.parentElement).toHaveTextContent(/بواسطة\s*operator-b/);
    expect(screen.getByText('قرار التحقق:')).toBeInTheDocument();
    expect(screen.getByText('verified')).toHaveAttribute('dir', 'ltr');
  });
});

describe('Task creation', () => {
  it('keeps the Arabic form local until submit and resets cancelled input on reopen', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'مهمة جديدة' }));
    const dialog = screen.getByRole('dialog', { name: 'إضافة مهمة' });
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('input-create-task-title')).toHaveAttribute('dir', 'auto');
    fireEvent.change(screen.getByTestId('input-create-task-title'), { target: { value: 'مسودة لا تُرسل' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
    expect(createTaskMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'مهمة جديدة' }));
    expect(screen.getByTestId('input-create-task-title')).toHaveValue('');
    expect(screen.getByTestId('select-create-task-priority')).toHaveValue('p2');
    expect(createTaskMutate).not.toHaveBeenCalled();
  });

  it('opens a clear form and sends the selected project and task fields', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'مهمة جديدة' }));
    fireEvent.change(screen.getByTestId('input-create-task-title'), {
      target: { value: 'Add a health check' },
    });
    fireEvent.change(screen.getByTestId('input-create-task-description'), {
      target: { value: 'Expose the endpoint in the dashboard.' },
    });
    fireEvent.change(screen.getByTestId('select-create-task-priority'), {
      target: { value: 'p1' },
    });
    fireEvent.click(screen.getByTestId('button-submit-create-task'));

    expect(createTaskMutate).toHaveBeenCalledWith(
      {
        data: {
          projectId: 'project-1',
          title: 'Add a health check',
          description: 'Expose the endpoint in the dashboard.',
          priority: 'p1',
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});