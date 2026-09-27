import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Workflows from './Workflows';
import type { AiOrchestrationDecision } from '@workspace/api-client-react';

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
  useAiOrchestrateWorkflow: vi.fn(),
  useDeleteWorkflow: vi.fn(),
  getListWorkflowsQueryKey: vi.fn(() => ['workflows']),
  getListWorkflowExecutionsQueryKey: vi.fn((workflowId: string) => ['workflow-executions', workflowId]),
}));

import {
  useAdvanceWorkflow,
  useAiOrchestrateWorkflow,
  useCreateWorkflow,
  useDeleteWorkflow,
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
const aiOrchestrationMutation = mutation();
const deleteWorkflowMutation = mutation();

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Workflows />
    </QueryClientProvider>,
  );
  return queryClient;
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
    useAiOrchestrateWorkflow,
    useDeleteWorkflow,
  ]) {
    vi.mocked(hook).mockReturnValue(mutation() as never);
  }
  vi.mocked(useAiOrchestrateWorkflow).mockReturnValue(aiOrchestrationMutation as never);
  vi.mocked(useDeleteWorkflow).mockReturnValue(deleteWorkflowMutation as never);
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

  it('shows AI decisions as recommendations without advancing the workflow', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(aiOrchestrationMutation.mutate).toHaveBeenCalledWith(
      { workflowId: 'workflow-1', data: {} },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const decision: AiOrchestrationDecision = {
      action: 'advance',
      reasoning: 'The build phase passed its checks.',
      nextPhase: 'deploy',
      blockers: [],
      suggestions: ['Review the release notes.'],
    };
    const options = aiOrchestrationMutation.mutate.mock.calls[0]?.[1] as {
      onSuccess?: (value: AiOrchestrationDecision) => void;
    };
    act(() => options.onSuccess?.(decision));

    const suggestion = screen.getByRole('region', { name: 'AI workflow suggestion' });
    expect(within(suggestion).getByText('AI suggestion: advance')).toBeInTheDocument();
    expect(within(suggestion).getByText('The build phase passed its checks.')).toBeInTheDocument();
    expect(within(suggestion).getByText('Next phase: deploy')).toBeInTheDocument();
    expect(within(suggestion).getByText('Recommendation only. It does not advance, fail, or complete this workflow.')).toBeInTheDocument();
    expect(within(suggestion).getByText('Review the release notes.')).toBeInTheDocument();
    expect(vi.mocked(useAdvanceWorkflow).mock.results[0]?.value.mutate).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting and warns that history is removed', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalledWith(
      'Delete "Release pipeline"? This also permanently deletes its workflow execution history.',
    );
    expect(deleteWorkflowMutation.mutate).toHaveBeenCalledWith(
      { workflowId: 'workflow-1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    confirm.mockRestore();
  });

  it('does not delete a workflow when the operator cancels confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(deleteWorkflowMutation.mutate).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('invalidates the workflow list and clears its execution cache after deletion', () => {
    const queryClient = renderPage();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const options = deleteWorkflowMutation.mutate.mock.calls[0]?.[1] as {
      onSuccess?: () => void;
    };

    act(() => options.onSuccess?.());

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workflows'] });
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ['workflow-executions', 'workflow-1'],
    });
    confirm.mockRestore();
  });

  it('shows the server reason when deletion is rejected', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const options = deleteWorkflowMutation.mutate.mock.calls[0]?.[1] as {
      onError?: (error: Error) => void;
    };

    act(() => options.onError?.(new Error('Stop the workflow before deleting it')));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Stop the workflow before deleting it',
    );
    confirm.mockRestore();
  });

  it('shows an orchestration error without rendering a recommendation', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    const options = aiOrchestrationMutation.mutate.mock.calls[0]?.[1] as {
      onError?: (error: Error) => void;
    };

    act(() => options.onError?.(new Error('AI service temporarily unavailable')));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'AI service temporarily unavailable',
    );
    expect(
      screen.queryByRole('region', { name: 'AI workflow suggestion' }),
    ).not.toBeInTheDocument();
  });

  it('prevents deletion from the page while the workflow is running', () => {
    vi.mocked(useListWorkflows).mockReturnValue({
      data: [{
        id: 'workflow-1',
        projectId: 'project-1',
        name: 'Release pipeline',
        description: 'An active workflow.',
        status: 'running',
        currentPhase: 'deploy',
        executionCount: 1,
        phases: [{ name: 'deploy', steps: ['Publish'] }],
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: 0,
    } as ReturnType<typeof useListWorkflows>);
    renderPage();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText('Stop this workflow before deleting it.')).toBeInTheDocument();
    expect(deleteWorkflowMutation.mutate).not.toHaveBeenCalled();
  });
});