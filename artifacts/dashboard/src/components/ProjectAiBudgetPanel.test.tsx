import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectAiBudgetPanel from './ProjectAiBudgetPanel';

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    data: undefined,
  });

  return {
    budget: {
      schemaVersion: 'v1',
      projectId: 'project-1',
      dailyAttemptLimit: 100,
      dailyTokenLimit: 100_000,
      warningThreshold: 0.8,
      resetAt: '2026-10-01T00:00:00.000Z',
      consumedAttempts: 12,
      reservedAttempts: 2,
      remainingAttempts: 86,
      state: 'warning',
      tokenUsage: {
        promptTokens: 2_000,
        completionTokens: 1_000,
        total: 3_000,
        remaining: 90_000,
        status: 'known',
      },
      updatedAt: '2026-09-30T12:00:00.000Z',
    },
    alerts: {
      alerts: [
        {
          id: 'budget-alert-1',
          fingerprint: 'fingerprint-1',
          kind: 'ai_budget_warning',
          status: 'open',
          provider: 'groq',
          modelRole: 'fast',
          modelId: 'model-1',
          title: 'Daily budget warning',
          message: 'The project is approaching its daily budget.',
          remediation: 'Review daily limits.',
          occurrenceCount: 2,
          firstSeenAt: '2026-09-30T10:00:00.000Z',
          lastSeenAt: '2026-09-30T12:00:00.000Z',
          resolvedAt: null,
          projectId: 'project-1',
          severity: 'warning',
        },
      ],
    },
    mutations: {
      updateBudget: mutation(),
      updateAlert: mutation(),
    },
  };
});

vi.mock('@workspace/api-client-react', () => ({
  getGetAiProjectBudgetQueryKey: (projectId: string) => [
    `/api/ai/projects/${projectId}/budget`,
  ],
  getListAiProjectBudgetAlertsQueryKey: (projectId: string, params?: unknown) =>
    [
      `/api/ai/projects/${projectId}/budget/alerts`,
      ...(params ? [params] : []),
    ],
  useGetAiProjectBudget: () => ({
    data: mocks.budget,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useListAiProjectBudgetAlerts: () => ({
    data: mocks.alerts,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useUpdateAiProjectBudget: () => mocks.mutations.updateBudget,
  useUpdateAiProjectBudgetAlert: () => mocks.mutations.updateAlert,
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectAiBudgetPanel projectId="project-1" />
    </QueryClientProvider>,
  );
  return { queryClient, invalidateQueries };
}

beforeEach(() => {
  mocks.budget = {
    ...mocks.budget,
    dailyAttemptLimit: 100,
    dailyTokenLimit: 100_000,
    warningThreshold: 0.8,
    updatedAt: '2026-09-30T12:00:00.000Z',
  };
  mocks.alerts.alerts[0] = {
    ...mocks.alerts.alerts[0],
    status: 'open',
  };
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.mutate.mockReset();
    mutation.isPending = false;
  }
});

describe('ProjectAiBudgetPanel', () => {
  it('shows project usage and submits the API budget contract', async () => {
    const { invalidateQueries } = renderPanel();

    expect(screen.getByRole('heading', { name: 'ميزانية الذكاء الاصطناعي للمشروع' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3,000')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('الحد اليومي للمحاولات'), {
      target: { value: '250' },
    });
    fireEvent.change(screen.getByLabelText('الحد اليومي للرموز'), {
      target: { value: '250000' },
    });
    fireEvent.change(screen.getByLabelText('نسبة بدء التنبيه (%)'), {
      target: { value: '85' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ الميزانية' }));

    await waitFor(() => {
      expect(mocks.mutations.updateBudget.mutate).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          data: {
            dailyAttemptLimit: 250,
            dailyTokenLimit: 250_000,
            warningThreshold: 0.85,
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.mutations.updateBudget.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (value: typeof mocks.budget) => void },
    ];
    const savedBudget = {
      ...mocks.budget,
      dailyAttemptLimit: 250,
      dailyTokenLimit: 250_000,
      warningThreshold: 0.85,
      updatedAt: '2026-09-30T12:05:00.000Z',
    };
    act(() => callbacks.onSuccess(savedBudget));

    expect(screen.getByTestId('status-project-ai-budget')).toHaveTextContent(
      'تم حفظ ميزانية الذكاء الاصطناعي للمشروع.',
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/ai/projects/project-1/budget'],
    });
  });

  it('acknowledges an alert through the generated mutation and refreshes related data', async () => {
    const { invalidateQueries } = renderPanel();

    expect(screen.getByText('Daily budget warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الاطلاع' }));

    await waitFor(() => {
      expect(mocks.mutations.updateAlert.mutate).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          alertId: 'budget-alert-1',
          data: { action: 'acknowledge' },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.mutations.updateAlert.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => callbacks.onSuccess());

    expect(screen.getByTestId('status-project-ai-budget-alert')).toHaveTextContent(
      'تم تأكيد الاطلاع على التنبيه.',
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/ai/projects/project-1/budget/alerts'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/ai/projects/project-1/budget'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'إغلاق التنبيه' }));
    await waitFor(() => {
      expect(mocks.mutations.updateAlert.mutate).toHaveBeenCalledTimes(2);
      expect(mocks.mutations.updateAlert.mutate).toHaveBeenLastCalledWith(
        {
          projectId: 'project-1',
          alertId: 'budget-alert-1',
          data: { action: 'resolve' },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, resolveCallbacks] = mocks.mutations.updateAlert.mutate.mock.calls[1] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => resolveCallbacks.onSuccess());
    expect(screen.getByTestId('status-project-ai-budget-alert')).toHaveTextContent(
      'تم إغلاق التنبيه.',
    );
  });

  it('blocks values outside the server-supported limit ranges', async () => {
    renderPanel();

    const attemptLimit = screen.getByLabelText('الحد اليومي للمحاولات');
    fireEvent.change(attemptLimit, { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('form', { name: 'تعديل ميزانية الذكاء الاصطناعي للمشروع' }));

    await waitFor(() => {
      expect(attemptLimit).toHaveAttribute('aria-invalid', 'true');
    });
    expect(mocks.mutations.updateBudget.mutate).not.toHaveBeenCalled();
  });
});