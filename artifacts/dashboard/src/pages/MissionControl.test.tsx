import { render, screen } from '@testing-library/react';
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

vi.mock('@workspace/api-client-react', () => ({
  useGetAiMissionControl: () => ({
    data: missionControlFixture,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MissionControl />
    </QueryClientProvider>,
  );
}

describe('Mission Control', () => {
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
});