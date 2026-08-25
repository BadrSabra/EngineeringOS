import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FlightDeck from './FlightDeck';

const mocks = vi.hoisted(() => ({
  execution: undefined as Record<string, unknown> | undefined,
}));

vi.mock('wouter', () => ({
  Link: ({ href, children }: { href: string; children: unknown }) => <a href={href}>{children}</a>,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAiExecution: vi.fn(() => ({
    data: mocks.execution,
    isLoading: false,
    isError: false,
  })),
  useGetGitStatus: vi.fn(() => ({
    data: { clean: true, files: [] },
    isLoading: false,
    isFetching: false,
    isError: false,
  })),
  useGetGitLog: vi.fn(() => ({ data: { commits: [] }, isLoading: false, isError: false })),
  useGitCommit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useGitPush: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

function baseExecution(state: string, nodeStatus: string = state === 'BLOCKED' ? 'blocked' : 'running') {
  return {
    id: 'execution-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    linkedTaskId: 'task-1',
    buildPlanMessageId: 'plan-1',
    status: state === 'BLOCKED' ? 'failed' : 'running',
    flightState: state,
    proofRequired: true,
    evidenceVerdict: state === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL',
    evidenceReason: 'The current evidence verdict is retained by the execution checkpoint.',
    objective: { objective: 'Repair the authentication scope check' },
    checkpoint: {
      stage: state === 'READY_FOR_REVIEW' ? 'finalizing' : 'tool_loop',
      detail: 'Server-owned execution checkpoint.',
      nodeStates: [{
        id: 'node-auth',
        title: 'Repair auth scope',
        status: nodeStatus,
        allowedFiles: ['src/auth.ts', 'src/auth.test.ts'],
        dependencies: [],
        validationProfile: 'workspace-typecheck',
        attempts: state === 'REPAIRING' ? 2 : 1,
      }],
    },
    checkpointVersion: 4,
    resumable: state === 'BLOCKED',
    createdAt: '2026-08-18T05:00:00.000Z',
    updatedAt: '2026-08-18T05:01:05.000Z',
    startedAt: '2026-08-18T05:00:00.000Z',
    completedAt: '2026-08-18T05:01:05.000Z',
    proposalId: 'proposal-1',
    operationId: 'operation-1',
  };
}

function renderDeck() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FlightDeck />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.pushState({}, '', '/flight-deck?executionId=execution-1');
  mocks.execution = baseExecution('REPAIRING');
});

describe('Flight Deck mission control', () => {
  it.each([
    ['BLOCKED', 'blocked'],
    ['REPAIRING', 'running'],
    ['READY_FOR_REVIEW', 'passed'],
  ] as const)('renders the %s lifecycle state with objective, scope, elapsed, and risk', (state, nodeStatus) => {
    mocks.execution = baseExecution(state, nodeStatus);
    renderDeck();

    expect(screen.getAllByText(state.replaceAll('_', ' ').toUpperCase()).length).toBeGreaterThan(0);
    expect(screen.getByText('Repair the authentication scope check')).toBeInTheDocument();
    expect(screen.getAllByText('1m 05s').length).toBeGreaterThan(0);
    expect(screen.getByText('2 files · 1 nodes')).toBeInTheDocument();
    expect(screen.getByText('Plan nodes')).toBeInTheDocument();
    expect(screen.getAllByText(state === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL').length).toBeGreaterThan(0);
  });

  it('keeps non-delivery audit/chat executions out of the completed delivery presentation', () => {
    mocks.execution = {
      ...baseExecution('COMPLETED', 'passed'),
      proofRequired: false,
      linkedTaskId: null,
      buildPlanMessageId: null,
      proposalId: null,
      operationId: null,
      objective: null,
      status: 'completed',
    };
    renderDeck();

    expect(screen.getByText('Audit / Chat run')).toBeInTheDocument();
    expect(screen.getByText('Non-delivery run')).toBeInTheDocument();
    expect(screen.queryByText('Mission → Push')).toBeNull();
  });

  it('renders the correlated redacted proof chain and delivered-byte hashes', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      flightState: 'COMMITTED',
      evidenceVerdict: 'PROVEN',
      operationEvidence: {
        version: 1,
        redacted: true,
        operationId: 'operation-1',
        projectId: 'project-1',
        revision: 'revision-7',
        terminalState: 'COMPLETED',
        completeness: 'complete',
        verified: false,
        hashes: { changeSet: 'candidate-hash', committed: 'delivered-hash' },
        counts: { executions: 1, checkpoints: 1, events: 4, audit: 0, taskLogs: 0, journal: 2, receipts: 3 },
        receipts: [
          { kind: 'process', status: 'passed', attempt: 1, timestamp: '2026-08-18T05:00:00.000Z', detail: 'Execution started' },
          { kind: 'validation', status: 'passed', attempt: 1, timestamp: '2026-08-18T05:00:30.000Z', detail: 'Approved validation passed' },
          { kind: 'push', status: 'passed', attempt: 1, timestamp: '2026-08-18T05:01:00.000Z', detail: 'Matching delivery recorded' },
        ],
        gaps: [],
      },
    };
    renderDeck();

    expect(screen.getByRole('region', { name: 'Delivery proof chain' })).toBeInTheDocument();
    expect(screen.getByText('candidate-hash')).toBeInTheDocument();
    expect(screen.getByText('delivered-hash')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Next safe action/)).toBeNull();
  });

  it('does not present retained gaps as a verified delivery and gives a safe action', () => {
    mocks.execution = {
      ...baseExecution('BLOCKED', 'blocked'),
      operationEvidence: {
        version: 1,
        redacted: true,
        operationId: 'operation-1',
        projectId: 'project-1',
        revision: 'revision-6',
        terminalState: 'FAILED',
        completeness: 'retained-with-gaps',
        verified: false,
        hashes: { changeSet: null, committed: null },
        counts: { executions: 1, checkpoints: 1, events: 0, audit: 0, taskLogs: 0, journal: 0, receipts: 1 },
        receipts: [{ kind: 'promotion', status: 'unknown', attempt: 1, timestamp: '2026-08-18T05:01:00.000Z', detail: 'Promotion outcome was not recorded' }],
        gaps: [{ kind: 'missing', source: 'event', detail: 'No correlated operational events were retained.' }],
      },
    };
    renderDeck();

    expect(screen.getByText('Retained with gaps')).toBeInTheDocument();
    expect(screen.getByText('No correlated operational events were retained.')).toBeInTheDocument();
    expect(screen.getByText(/Do not rely on this result as verified/)).toBeInTheDocument();
    expect(screen.queryByText('Verified chain')).toBeNull();
  });
});