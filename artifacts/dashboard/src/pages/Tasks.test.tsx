import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Tasks from './Tasks';

vi.mock('@workspace/api-client-react', () => ({
  useListTasks: vi.fn(),
  useExecuteTask: vi.fn(),
  useRetryTask: vi.fn(),
  useRollbackTask: vi.fn(),
  useGetTaskLogs: vi.fn(),
  getListTasksQueryKey: vi.fn(() => ['tasks']),
  getGetTaskLogsQueryKey: vi.fn((taskId: string) => ['task-logs', taskId]),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  useExecuteTask,
  useGetTaskLogs,
  useListTasks,
  useRetryTask,
  useRollbackTask,
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
  vi.mocked(useExecuteTask).mockReturnValue(mutation() as ReturnType<typeof useExecuteTask>);
  vi.mocked(useRetryTask).mockReturnValue(mutation() as ReturnType<typeof useRetryTask>);
  vi.mocked(useRollbackTask).mockReturnValue(mutation() as ReturnType<typeof useRollbackTask>);
});

describe('Tasks recovery rendering', () => {
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

  it('does not expose raw provider diagnostics or credentials in task details', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Expand task Repair provider authentication' }));

    expect(screen.queryByText(/raw provider diagnostic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-secret-token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-provider-secret/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Internal prompts and provider diagnostics are not shown/i)).toBeInTheDocument();
  });
});