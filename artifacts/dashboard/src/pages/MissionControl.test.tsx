import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MissionControl from './MissionControl';

vi.mock('wouter', () => ({
  Link: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: React.MouseEventHandler<HTMLAnchorElement> }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

const missionControlFixture = vi.hoisted(() => ({
  updatedAt: '2026-08-19T01:03:24.000Z',
  benchmark: {
    scorecard: {
      suiteVersion: 'flight-deck-v2',
      metrics: {
        totalCases: 34,
        observedCases: 34,
        correctCompletionRate: 1,
        gradeCounts: { A: 0, B: 20, C: 0, D: 14, F: 0, U: 0 },
      },
    },
    baseline: {
      baselineId: 'baseline-clean-witness',
      metrics: {
        correctCompletionRate: 1,
      },
    },
  },
  executions: [{
    id: 'execution-1',
    state: 'READY_FOR_REVIEW',
    objective: 'Repair the auth scope check',
    provider: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    attempts: 2,
    validationFailures: 1,
    evidence: { verdict: 'PROVEN', reason: 'Validation and behavior proof accepted.' },
    checkpointVersion: 4,
    eventCount: 3,
    recentEvents: [{ kind: 'validation', status: 'passed', detail: 'Tests passed.' }],
  }],
}));

const historicalRecoveryFixture = vi.hoisted(() => ({
  ...missionControlFixture,
  updatedAt: '2026-08-21T12:15:00.000Z',
  benchmark: {
    ...missionControlFixture.benchmark,
    freeTierEnvelope: {
      providerRecoverySummaries: [{
        provider: 'openrouter',
        model: 'openai/gpt-4.1-mini',
        failureCategory: 'RATE_LIMIT',
        recoveryAction: 'Switched to a bounded retry',
        evidenceStatus: 'RECOVERED',
        attemptCount: 3,
      }],
    },
  },
}));

let currentMissionControl = missionControlFixture;
const refetchMissionControl = vi.hoisted(() => vi.fn());

vi.mock('@workspace/api-client-react', () => ({
  useGetAiMissionControl: () => ({
    data: currentMissionControl,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: refetchMissionControl,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<MissionControl />, {
    wrapper: function QueryWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  });
}

describe('Mission Control', () => {
  beforeEach(() => {
    currentMissionControl = missionControlFixture;
    refetchMissionControl.mockReset();
  });

  it('shows execution state, operational metrics, evidence, and Flight Deck link', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Mission Control' })).toBeInTheDocument();
    expect(await screen.findByText('Repair the auth scope check')).toBeInTheDocument();
    expect(screen.getAllByText('READY FOR REVIEW').length).toBeGreaterThan(0);
    expect(screen.getByText('openrouter / openai/gpt-4.1-mini')).toBeInTheDocument();
    expect(screen.getByText('Validation failures: 1')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText('Recorder evidence')).toBeInTheDocument();
    expect(screen.getByText('Validation and behavior proof accepted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Flight Deck/i })).toHaveAttribute(
      'href',
      '/flight-deck?executionId=execution-1',
    );
  });

  it('keeps historical provider recovery details visible after the query is reloaded', async () => {
    currentMissionControl = historicalRecoveryFixture;
    const { rerender } = renderPage();

    expect(await screen.findByText('openrouter · openai/gpt-4.1-mini')).toBeInTheDocument();
    expect(screen.getByText('RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('Switched to a bounded retry')).toBeInTheDocument();
    expect(screen.getByText('RECOVERED')).toBeInTheDocument();
    expect(screen.getByText('Attempts')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchMissionControl).toHaveBeenCalledTimes(1);

    currentMissionControl = {
      ...historicalRecoveryFixture,
      updatedAt: '2026-08-22T09:30:00.000Z',
    };
    rerender(<MissionControl />);

    expect(await screen.findByText('openrouter · openai/gpt-4.1-mini')).toBeInTheDocument();
    expect(screen.getByText('RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('Switched to a bounded retry')).toBeInTheDocument();
    expect(screen.getByText('RECOVERED')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('3')).toBeInTheDocument();
  });

  it('renders the normal benchmark view for a legacy envelope without recovery summaries', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      benchmark: {
        ...missionControlFixture.benchmark,
        freeTierEnvelope: {
          schemaVersion: 1,
          verdict: 'PASS',
        },
      },
    };
    renderPage();

    expect(await screen.findByText('Baseline comparison')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();
    expect(screen.queryByText('Historical report recovery details')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider recovery')).not.toBeInTheDocument();
  });
});