import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { ExecutionProjectionPanel } from './ExecutionProjectionPanel';

const projection: AiExecutionProjection = {
  schemaVersion: 1,
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
    recent: [{
      tool: 'read_file',
      status: 'completed',
      source: 'src/App.tsx',
    }],
  },
  workspace: {
    changedFiles: ['src/App.tsx'],
    diffStatus: 'available',
  },
  verification: {
    status: 'running',
    evidenceVerdict: 'PARTIAL',
    proofRequired: true,
  },
  approval: {
    required: true,
    status: 'PENDING',
    proposalId: 'proposal-1',
  },
  stopped: {
    reason: null,
    outcome: null,
  },
  allowedActions: ['CANCEL', 'REVIEW_DIFF', 'APPROVE_CHANGES'],
};

function renderPanel(props: Partial<React.ComponentProps<typeof ExecutionProjectionPanel>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExecutionProjectionPanel
        projection={projection}
        executionId="execution-1"
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExecutionProjectionPanel', () => {
  it('renders the server-owned plan, tools, progress, files, verification, and real actions', () => {
    renderPanel();

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getAllByText('Run checks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('read_file').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/App.tsx').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Partial').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review diff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve changes' })).toBeInTheDocument();
  });

  it('loads and renders the bounded review diff from the execution endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changes: [{
        path: 'src/App.tsx',
        originalContent: 'old line',
        newContent: 'new line',
        truncated: false,
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Review diff' }));

    await waitFor(() => expect(screen.getByText('Reviewable diff')).toBeInTheDocument());
    expect(screen.getAllByText('src/App.tsx').length).toBeGreaterThan(0);
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('- old line');
    expect(pre?.textContent).toContain('+ new line');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/executions/execution-1/diff',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses the server cancellation action and invalidates the execution projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'cancelling' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/executions/execution-1/cancel',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ));
  });

  it('delegates approval to the owning surface instead of inventing client state', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onAction });

    fireEvent.click(screen.getByRole('button', { name: 'Approve changes' }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith('APPROVE_CHANGES'));
  });
});