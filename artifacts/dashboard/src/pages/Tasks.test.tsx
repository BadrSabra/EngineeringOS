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
  getListTasksQueryKey: vi.fn(() => ['tasks']),
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
    heading: 'Provider authentication failed',
    action: 'Replace the provider API key with a valid key, then retry.',
    correlationId: 'task-auth-support',
  },
  {
    id: 'task-quota',
    title: 'Recover from provider quota',
    availabilityState: 'quota_exhausted',
    heading: 'Provider quota is exhausted',
    action: 'Add provider credits or configure another provider.',
    correlationId: 'task-quota-support',
  },
  {
    id: 'task-outage',
    title: 'Recover from provider outage',
    availabilityState: 'provider_outage',
    heading: 'The provider is temporarily unavailable',
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

function mockTaskExecutionProjection(taskCorrelationId: string, executionCorrelationId: string) {
  vi.mocked(useGetTask).mockReturnValue({
    data: {
      id: 'task-auth',
      projectId: 'project-1',
      correlationId: taskCorrelationId,
    } as NonNullable<ReturnType<typeof useGetTask>['data']>,
    isLoading: false,
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
    isError: false,
    error: null,
  } as ReturnType<typeof useGetAiExecution>);
}

describe('Tasks recovery rendering', () => {
  it('edits task title, description, and priority through the generated PATCH mutation', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Edit task Repair provider authentication' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete task Repair provider authentication' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete task?' });
    expect(within(confirmation).getByText(/permanently deletes “Repair provider authentication” and its task execution logs/)).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: `Expand task ${item.title}` }));
      const card = screen.getByRole('region', { name: 'Provider recovery actions' });
      expect(within(card).getByRole('heading', { name: item.heading })).toBeInTheDocument();
      expect(within(card).getByText(`Availability: ${item.availabilityState.replaceAll('_', ' ')}`)).toBeInTheDocument();
      expect(within(card).getByText(`Next step: ${item.action}`)).toBeInTheDocument();
      expect(within(card).getByText(`Support reference: ${item.correlationId}`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: `Collapse task ${item.title}` }));
    }
  });

  it('labels the execution attempt separately from provider attempts', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    expect(screen.getByText('Execution attempt: 3')).toBeInTheDocument();
    expect(screen.getByText('Provider attempts: 2')).toBeInTheDocument();
  });

  it('hides a prior execution projection after retry rotates the Task correlation pointer', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-prior');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    expect(screen.queryByTestId('mission-capsule')).not.toBeInTheDocument();
  });

  it('shows the execution projection while its identity matches the current Task pointer', () => {
    mockTaskExecutionProjection('correlation-current', 'correlation-current');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    expect(screen.getByTestId('mission-capsule')).toBeInTheDocument();
  });

  it('renders the server acceptance outcome and safe recovery action', () => {
    vi.mocked(useGetTask).mockReturnValue({
      data: {
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
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    const acceptance = screen.getByRole('region', { name: 'Server acceptance outcome' });
    expect(within(acceptance).getByText('Recovery required')).toBeInTheDocument();
    expect(within(acceptance).getByText('Outcome: FAILED')).toBeInTheDocument();
    expect(within(acceptance).getByText('Resume the saved task checkpoint.')).toBeInTheDocument();
    expect(within(acceptance).getByRole('button', { name: 'Resume task execution' })).toBeInTheDocument();
    expect(within(acceptance).queryByText(/providerPayload/i)).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('Acceptance: Accepted')).toBeInTheDocument();
    expect(screen.getByLabelText('Acceptance: Recovery required')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by acceptance' }), {
      target: { value: 'accepted' },
    });
    expect(screen.getByText('Accepted task')).toBeInTheDocument();
    expect(screen.queryByText('Recovery task')).not.toBeInTheDocument();
  });

  it('does not expose raw provider diagnostics or credentials in task details', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    expect(screen.queryByText(/raw provider diagnostic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-secret-token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-provider-secret/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Internal prompts and provider diagnostics are not shown/i)).toBeInTheDocument();
  });

  it('renders the durable progress timeline from out-of-order logs without duplicates', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [{
        id: 'task-progress',
        projectId: 'project-1',
        title: 'Replay progress timeline',
        status: 'completed',
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
      attempt: 1,
      sequence: 2,
      progressStage: 'context' as const,
      progressStatus: 'completed' as const,
      progressMessage: 'Project context is ready.',
      startedAt: '2026-08-25T10:00:30.000Z',
      finishedAt: '2026-08-25T10:01:00.000Z',
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
          executionId: 'execution-1',
          attempt: 1,
          sequence: 3,
          progressStage: 'result',
          progressStatus: 'completed',
          progressPercent: 100,
          progressMessage: 'Task completed successfully.',
          terminalOutcome: 'SUCCEEDED',
        },
        contextLog,
        contextLog,
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useGetTaskLogs>);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Replay progress timeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(screen.getByText('Build context')).toBeInTheDocument();
    expect(screen.getByText('Final result')).toBeInTheDocument();
    expect(screen.getByText('100% server progress')).toBeInTheDocument();
    expect(screen.getAllByText('Project context is ready.')).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Keep a long timeline readable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(screen.getByRole('status')).toHaveTextContent('latest 79 of 120 activity entries');
    expect(screen.getByText(/activity event 0/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Review a rule with reversals' }));
    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

    expect(screen.getByText('Current decision')).toBeInTheDocument();
    expect(screen.getByText('Passed — evidence recorded')).toBeInTheDocument();
    const history = screen.getByText('Verification history (2)');
    fireEvent.click(history);
    expect(screen.getByText('The behavior still failed.')).toBeInTheDocument();
    expect(screen.getByText(/By operator-a/)).toBeInTheDocument();
    expect(screen.getByText(/By operator-b/)).toBeInTheDocument();
  });
});

describe('Task creation', () => {
  it('opens a clear form and sends the selected project and task fields', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
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