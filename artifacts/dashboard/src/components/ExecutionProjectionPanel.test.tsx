import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
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

function renderPanel(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ExecutionProjectionPanel', () => {
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
    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('Awaiting approval');
    expect(screen.getByTestId('status-canonical')).toHaveTextContent('Mission state');
    const identities = screen.getByTestId('execution-identities');
    expect(identities).toHaveTextContent('Execution execution-1');
    expect(identities).toHaveTextContent('Operation operation-1');
    expect(identities).not.toHaveTextContent('Mission');
    const destinations = screen.getByRole('navigation', { name: 'Execution destinations' });
    expect(destinations).toHaveTextContent('Open Flight Deck');
    expect(destinations).toHaveTextContent('Run steps and evidence');
    expect(destinations).toHaveTextContent('Open Mission Control');
    expect(destinations).toHaveTextContent('Status, recovery, and validation');
    expect(destinations.querySelector('a[href="/flight-deck?executionId=execution-1"]')).toBeTruthy();
    expect(destinations.querySelector('a[href="/mission-control?executionId=execution-1"]')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Task' })).not.toBeInTheDocument();
    expect(screen.getByTestId('mission-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-validate')).toHaveTextContent('Now');
    expect(screen.getByTestId('status-proof')).toHaveTextContent('Partial');
    expect(screen.getByTestId('text-next-action')).toHaveTextContent('Review the validation evidence');
    expect(screen.getAllByText('Run checks').length).toBeGreaterThan(0);
    expect(screen.getByTestId('tool-0')).toHaveTextContent('Completed');
    expect(screen.getByTestId('tool-0')).toHaveTextContent('read_file');
    expect(screen.getByTestId('button-action-cancel')).toHaveTextContent('Stop run');
    expect(screen.getByTestId('button-action-review_diff')).toHaveTextContent('Review changes');
    expect(screen.getByTestId('button-action-approve_changes')).toHaveTextContent('Approve changes');
    expect(screen.getByTestId('button-action-approve_changes')).toHaveAttribute('data-primary-action', 'true');
    expect(screen.getByTestId('primary-next-action')).toHaveTextContent('Next action');
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
    expect(identities).toHaveTextContent('Mission mission-1');
    expect(identities).toHaveTextContent('Execution execution-1');
    expect(identities).toHaveTextContent('Operation operation-1');
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
    expect(timeline).toHaveTextContent('Delivery stages');
    expect(screen.getByTestId('timeline-approval')).toHaveTextContent('Approval required.');
    expect(screen.getByTestId('timeline-validate')).toHaveTextContent('Now');
    expect(screen.getByTestId('timeline-apply')).toHaveTextContent('Done');
    expect(screen.getByTestId('timeline-commit')).toHaveTextContent('Next');
    expect(screen.getByTestId('timeline-push')).toHaveTextContent('Next');
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

    expect(screen.getByRole('link', { name: 'Open Task' })).toHaveAttribute(
      'href',
      '/tasks?taskId=task-1',
    );
  });

  it('keeps destination links in natural order with visible keyboard focus styling', () => {
    renderPanel(
      <ExecutionProjectionPanel
        projection={projection}
        executionId="execution-1"
        taskId="task-1"
      />,
    );

    const destinations = screen.getByRole('navigation', { name: 'Execution destinations' });
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

    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('Incomplete');
    expect(screen.getByTestId('status-stopped')).toHaveTextContent('Interrupted');
    expect(screen.getByTestId('status-proof')).toHaveTextContent('Unavailable');
    expect(screen.queryByText('Completed and verified')).not.toBeInTheDocument();
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

    expect(screen.getByTestId('text-lifecycle-title')).toHaveTextContent('Needs replan');
    expect(screen.getByTestId('primary-next-action')).toHaveTextContent('Retry checkpoint');
    expect(screen.getByTestId('button-action-retry_checkpoint')).toHaveAttribute(
      'data-primary-action',
      'true',
    );
    expect(screen.getByTestId('status-proof')).toHaveTextContent('Unavailable');
  });
});