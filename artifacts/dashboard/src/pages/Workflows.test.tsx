import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Workflows from './Workflows';

vi.mock('@workspace/api-client-react', () => ({
  useListWorkflows: vi.fn(),
  useListProjects: vi.fn(),
  useCreateWorkflow: vi.fn(),
  useStartWorkflow: vi.fn(),
  useStopWorkflow: vi.fn(),
  useAdvanceWorkflow: vi.fn(),
  useFailWorkflowPhase: vi.fn(),
  useRetryWorkflowPhase: vi.fn(),
  useRollbackWorkflowPhase: vi.fn(),
  useListWorkflowExecutions: vi.fn(),
  getListWorkflowsQueryKey: vi.fn(() => ['workflows']),
  getListWorkflowExecutionsQueryKey: vi.fn((workflowId: string) => ['workflow-executions', workflowId]),
}));

import {
  useAdvanceWorkflow,
  useCreateWorkflow,
  useFailWorkflowPhase,
  useListProjects,
  useListWorkflowExecutions,
  useListWorkflows,
  useRetryWorkflowPhase,
  useRollbackWorkflowPhase,
  useStartWorkflow,
  useStopWorkflow,
} from '@workspace/api-client-react';

const mutation = () => ({ mutate: vi.fn(), isPending: false });

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Workflows />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useListWorkflows).mockReturnValue({
    data: [{
      id: 'workflow-1',
      projectId: 'project-1',
      name: 'Release pipeline',
      description: 'A workflow with a failed execution.',
      status: 'failed',
      currentPhase: 'deploy',
      executionCount: 1,
      phases: [
        { name: 'build', steps: ['Compile'] },
        { name: 'deploy', steps: ['Publish'] },
      ],
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isRefetching: false,
    dataUpdatedAt: 0,
  } as ReturnType<typeof useListWorkflows>);
  vi.mocked(useListProjects).mockReturnValue({ data: [] } as ReturnType<typeof useListProjects>);
  vi.mocked(useListWorkflowExecutions).mockReturnValue({
    data: [{
      id: 'execution-1',
      workflowId: 'workflow-1',
      status: 'failed',
      currentPhase: 'deploy',
      startedAt: '2026-08-25T10:00:00.000Z',
      completedPhases: ['build'],
      errorMessage: 'Internal provider diagnostic: provider-secret-token-123456789',
      recovery: {
        availabilityState: 'provider_outage',
        operatorAction: 'Retry in a moment; configure another provider if the issue persists.',
        correlationId: 'workflow-support-42',
        upstreamMessage: 'raw upstream response with credentials',
      },
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useListWorkflowExecutions>);
  for (const hook of [
    useCreateWorkflow,
    useStartWorkflow,
    useStopWorkflow,
    useAdvanceWorkflow,
    useFailWorkflowPhase,
    useRetryWorkflowPhase,
    useRollbackWorkflowPhase,
  ]) {
    vi.mocked(hook).mockReturnValue(mutation() as never);
  }
});

describe('Workflows recovery rendering', () => {
  it('renders execution recovery metadata and preserves the support reference', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Execution history/i }));

    const card = screen.getByRole('region', { name: 'Provider recovery actions' });
    expect(within(card).getByRole('heading', { name: 'The provider is temporarily unavailable' })).toBeInTheDocument();
    expect(within(card).getByText('Availability: provider outage')).toBeInTheDocument();
    expect(within(card).getByText('Next step: Retry in a moment; configure another provider if the issue persists.')).toBeInTheDocument();
    expect(within(card).getByText('Support reference: workflow-support-42')).toBeInTheDocument();
  });

  it('does not expose raw provider diagnostics or credentials from an execution', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Execution history/i }));

    expect(screen.queryByText(/Internal provider diagnostic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider-secret-token/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw upstream response/i)).not.toBeInTheDocument();
  });
});