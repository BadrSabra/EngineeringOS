import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FlightDeck from './FlightDeck';

const mocks = vi.hoisted(() => ({
  execution: undefined as Record<string, unknown> | undefined,
  executionQuery: {
    isLoading: false,
    isError: false,
    isFetching: false,
    dataUpdatedAt: 1787032800000,
    refetch: vi.fn(),
  },
  gitStatusQuery: {
    data: { clean: true, files: [] as Array<{ path: string; status?: string }> },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  gitLogQuery: {
    data: { commits: [] as Array<{ hash: string; shortHash: string; subject: string }> } as { commits: Array<{ hash: string; shortHash: string; subject: string }> } | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/MissionCapsule', () => ({
  MissionCapsule: ({ taskId }: { taskId?: string | null }) => (
    <div data-testid="mission-capsule-task-id">{taskId ?? 'none'}</div>
  ),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAiExecution: vi.fn(() => ({
    data: mocks.execution,
    ...mocks.executionQuery,
  })),
  useGetGitStatus: vi.fn(() => ({ ...mocks.gitStatusQuery })),
  useGetGitLog: vi.fn(() => ({ ...mocks.gitLogQuery })),
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
    operationEvidence: {
      completeness: state === 'BLOCKED' ? 'blocked' : 'partial',
      proof: {
        verdict: state === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL',
        accepted: false,
        failureReasons: state === 'BLOCKED' ? ['execution_failed'] : ['evidence_incomplete'],
      },
      receipts: [],
      gaps: [],
    },
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
  mocks.executionQuery.isLoading = false;
  mocks.executionQuery.isError = false;
  mocks.executionQuery.isFetching = false;
  mocks.executionQuery.dataUpdatedAt = 1787032800000;
  mocks.executionQuery.refetch.mockClear();
  mocks.gitStatusQuery.data = { clean: true, files: [] };
  mocks.gitStatusQuery.isLoading = false;
  mocks.gitStatusQuery.isFetching = false;
  mocks.gitStatusQuery.isError = false;
  mocks.gitStatusQuery.refetch.mockClear();
  mocks.gitLogQuery.data = { commits: [] };
  mocks.gitLogQuery.isLoading = false;
  mocks.gitLogQuery.isFetching = false;
  mocks.gitLogQuery.isError = false;
  mocks.gitLogQuery.refetch.mockClear();
});

describe('Flight Deck mission control', () => {
  it('resets the Git commit draft when the requested execution context changes in-place', () => {
    const originalPath = window.location.pathname + window.location.search;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const pageContent = () => (
      <QueryClientProvider client={queryClient}>
        <FlightDeck />
      </QueryClientProvider>
    );

    try {
      mocks.execution = { ...baseExecution('APPLIED'), id: 'execution-1', projectId: 'project-1' };
      const page = render(pageContent());
      const commitInput = screen.getByLabelText('رسالة الإيداع');

      fireEvent.change(commitInput, { target: { value: 'Commit for project one' } });
      expect(commitInput).toHaveValue('Commit for project one');

      mocks.execution = {
        ...baseExecution('APPLIED'),
        id: 'execution-2',
        projectId: 'project-2',
        sessionId: 'session-2',
      };
      window.history.pushState({}, '', '/flight-deck?executionId=execution-2&projectId=project-2');
      page.rerender(pageContent());

      expect(screen.getByLabelText('رسالة الإيداع')).toHaveValue('');
      expect(screen.getByTestId('link-flight-deck-ai'))
        .toHaveAttribute('href', '/ai?projectId=project-2&sessionId=session-2');
    } finally {
      window.history.pushState({}, '', originalPath);
    }
  });

  it('returns to the server-bound AI session, including on a fresh page load', () => {
    renderDeck();
    expect(screen.getByTestId('link-flight-deck-ai'))
      .toHaveAttribute('href', '/ai?projectId=project-1&sessionId=session-1');
    expect(screen.getByText('الرجوع إلى محادثة الذكاء الاصطناعي')).toBeInTheDocument();
  });

  it('does not claim a conversation when the server session is absent or the requested project differs', () => {
    mocks.execution = { ...baseExecution('REPAIRING'), sessionId: undefined };
    const first = renderDeck();
    expect(screen.getByTestId('link-flight-deck-ai')).toHaveAttribute('href', '/ai');
    first.unmount();

    mocks.execution = baseExecution('REPAIRING');
    window.history.pushState({}, '', '/flight-deck?executionId=execution-1&projectId=other-project');
    const second = renderDeck();
    expect(screen.getByTestId('link-flight-deck-ai')).toHaveAttribute('href', '/ai');
    expect(screen.queryByText('الرجوع إلى محادثة الذكاء الاصطناعي')).not.toBeInTheDocument();
    second.unmount();

    window.history.pushState({}, '', '/flight-deck?executionId=another-execution');
    renderDeck();
    expect(screen.getByTestId('link-flight-deck-ai')).toHaveAttribute('href', '/ai');
  });

  it.each([
    ['BLOCKED', 'blocked'],
    ['REPAIRING', 'running'],
    ['READY_FOR_REVIEW', 'passed'],
  ] as const)('renders the %s lifecycle state with objective, scope, elapsed, and risk', (state, nodeStatus) => {
    mocks.execution = baseExecution(state, nodeStatus);
    renderDeck();

    expect(screen.getByTestId('mission-capsule-task-id')).toHaveTextContent('task-1');
    expect(screen.getAllByText(state.replaceAll('_', ' ').toUpperCase()).length).toBeGreaterThan(0);
    expect(screen.getByText('Repair the authentication scope check')).toBeInTheDocument();
    expect(screen.getAllByText('1د 05ث').length).toBeGreaterThan(0);
    expect(screen.getByText('2 ملفات · 1 عُقد')).toBeInTheDocument();
    expect(screen.getByText('عُقد الخطة')).toBeInTheDocument();
    expect(screen.getAllByText(state === 'BLOCKED' ? 'BLOCKED' : 'PARTIAL').length).toBeGreaterThan(0);
  });

  it.each([
    ['BUILDING', 'البناء'],
    ['VALIDATING', 'التحقق'],
    ['REPAIRING', 'الإصلاح'],
    ['READY_FOR_REVIEW', 'المراجعة'],
    ['APPLIED', 'التطبيق'],
    ['COMMITTED', 'إيداع التغييرات'],
    ['PUSHED', 'دفع التغييرات'],
  ] as const)('marks only the canonical %s lifecycle state as active', (state, label) => {
    const proofAccepted = ['APPLIED', 'COMMITTED', 'PUSHED'].includes(state);
    mocks.execution = {
      ...baseExecution(state),
      ...(proofAccepted ? {
        operationEvidence: {
          completeness: 'complete',
          proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
          receipts: [],
          gaps: [],
        },
        evidenceVerdict: 'PROVEN',
      } : {}),
    };
    renderDeck();

    const lifecycle = screen.getByTestId('flight-deck-lifecycle');
    const activePhases = lifecycle.querySelectorAll('[aria-current="step"]');
    expect(activePhases).toHaveLength(1);
    expect(activePhases[0]).toHaveAttribute('data-testid', `flight-deck-phase-${state}`);
    expect(activePhases[0]).toHaveTextContent(label);
    expect(lifecycle.querySelectorAll('[data-phase-active="true"]')).toHaveLength(1);
    expect(lifecycle).not.toHaveTextContent('الخطة');
    expect(lifecycle).not.toHaveTextContent('الاستكشاف');
    expect(lifecycle.querySelectorAll('[data-phase-active="false"]')).toHaveLength(6);
  });

  it.each([
    ['BLOCKED', 'failed', 'التنفيذ محظور'],
    ['CANCELLED', 'cancelled', 'أُلغي التنفيذ'],
    ['COMPLETED', 'completed', 'اكتملت حالة التنفيذ المسجلة'],
  ] as const)('shows %s as terminal without inventing a completed delivery phase', (state, status, message) => {
    mocks.execution = {
      ...baseExecution(state),
      status,
      ...(state === 'COMPLETED' ? {
        evidenceVerdict: 'PROVEN',
        operationEvidence: {
          completeness: 'complete',
          proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
          receipts: [],
          gaps: [],
        },
      } : {}),
    };
    renderDeck();

    const lifecycle = screen.getByTestId('flight-deck-lifecycle');
    expect(screen.getByTestId('flight-deck-terminal-phase')).toHaveTextContent(message);
    expect(lifecycle.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(lifecycle.querySelectorAll('[data-phase-active="true"]')).toHaveLength(0);
    expect(screen.getByTestId('flight-deck-phase-PUSHED')).not.toHaveAttribute('aria-current');
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

    expect(screen.getByText('مراجعة / محادثة')).toBeInTheDocument();
    expect(screen.getByText('تنفيذ لا يتضمن تسليمًا')).toBeInTheDocument();
    expect(screen.getByTestId('flight-deck-no-delivery-phases')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-deck-lifecycle')).not.toBeInTheDocument();
    expect(screen.queryByText('المهمة ← الدفع')).toBeNull();
  });

  it('uses evidence-aware fallback states for legacy executions without flightState', () => {
    mocks.execution = {
      ...baseExecution('COMPLETED', 'passed'),
      flightState: undefined,
      status: 'completed',
      proofRequired: false,
      linkedTaskId: null,
      buildPlanMessageId: null,
      proposalId: null,
      operationId: null,
      objective: null,
    };
    renderDeck();

    expect(screen.getAllByText('COMPLETED').length).toBeGreaterThan(0);
    expect(screen.getByText('مراجعة / محادثة')).toBeInTheDocument();
  });

  it('keeps legacy completed delivery runs reviewable when evidence is partial', () => {
    mocks.execution = {
      ...baseExecution('READY_FOR_REVIEW', 'passed'),
      flightState: undefined,
      status: 'completed',
      proofRequired: true,
      evidenceVerdict: 'PARTIAL',
      proposalId: 'proposal-1',
    };
    renderDeck();

    expect(screen.getAllByText('READY FOR REVIEW').length).toBeGreaterThan(0);
  });

  it('does not show a completed delivery state when current Canonical Proof is unproven', () => {
    mocks.execution = {
      ...baseExecution('COMPLETED', 'passed'),
      status: 'completed',
      flightState: 'COMPLETED',
      proofRequired: true,
      evidenceVerdict: 'PROVEN',
      operationEvidence: {
        completeness: 'complete',
        proof: {
          verdict: 'INCOMPLETE',
          accepted: false,
          failureReasons: ['acceptance_missing'],
        },
        receipts: [],
        gaps: [],
      },
    };
    renderDeck();

    expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
    expect(screen.getAllByText('BLOCKED').length).toBeGreaterThan(0);
    expect(screen.getByText(/الإثبات: BLOCKED/)).toBeInTheDocument();
  });

  it('does not use a checkpoint PROVEN verdict when the current proof projection is missing', () => {
    mocks.execution = {
      ...baseExecution('COMPLETED', 'passed'),
      status: 'completed',
      flightState: 'COMPLETED',
      proofRequired: true,
      evidenceVerdict: 'PROVEN',
      operationEvidence: undefined,
    };
    renderDeck();

    expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(screen.getByText(/الإثبات: UNAVAILABLE/)).toBeInTheDocument();
  });

  it('retains the completed state when the current proof is accepted', () => {
    mocks.execution = {
      ...baseExecution('COMPLETED', 'passed'),
      status: 'completed',
      flightState: 'COMPLETED',
      proofRequired: true,
      evidenceVerdict: 'PROVEN',
      operationEvidence: {
        proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
        completeness: 'complete',
        receipts: [],
        gaps: [],
      },
    };
    renderDeck();

    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText(/الإثبات: PROVEN/)).toBeInTheDocument();
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
        proof: {
          contractVersion: 1,
          verdict: 'PROVEN',
          accepted: true,
          failureReasons: [],
          executionId: 'execution-1',
          acceptanceId: 'acceptance-1',
          attempt: 1,
          operationId: 'operation-1',
          evidenceSnapshotId: 'evidence-1',
          sourceRevision: 'revision-7',
          candidateIdentity: 'candidate-hash',
          candidateTreeHash: 'candidate-hash',
          treeHash: 'delivered-hash',
        },
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
    const { container } = renderDeck();

    expect(container.querySelector('[lang="ar"]')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('region', { name: 'سلسلة إثبات التسليم' })).toBeInTheDocument();
    expect(screen.getByText('candidate-hash')).toBeInTheDocument();
    expect(screen.getByText('delivered-hash')).toBeInTheDocument();
    expect(screen.getAllByText('التحقق').length).toBeGreaterThan(0);
    expect(screen.getAllByText('متحقق').length).toBeGreaterThan(0);
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

    expect(screen.getByText('محفوظ مع نواقص')).toBeInTheDocument();
    expect(screen.getByText('No correlated operational events were retained.')).toBeInTheDocument();
    expect(screen.getByText(/لا تعتمد هذه النتيجة كأنها متحققة/)).toBeInTheDocument();
    expect(screen.queryByText('سلسلة متحققة')).toBeNull();
  });

  it('keeps the last successful execution snapshot visible after a failed refresh but blocks delivery actions', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      operationEvidence: {
        completeness: 'complete',
        proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
        receipts: [],
        gaps: [],
      },
    };
    mocks.executionQuery.isError = true;

    renderDeck();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'تعذّر تحديث سجل التنفيذ. اللقطة المعروضة هي آخر قراءة ناجحة',
    );
    expect(screen.getByText('إعادة تحميل سجل التنفيذ')).toBeInTheDocument();
    expect(screen.getByTestId('flight-deck-execution-read-warning').querySelector('time'))
      .toHaveAttribute('dateTime', new Date(1787032800000).toISOString());
    expect(screen.getByRole('button', { name: 'دفع العملية المُودعة' })).toBeDisabled();
    expect(screen.getByText('عُقد الخطة')).toBeInTheDocument();
    expect(screen.queryByText('لم تتوفر قراءة لسجل التنفيذ الآن.')).not.toBeInTheDocument();
  });

  it('blocks delivery actions while a newer execution read is still in progress', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      operationEvidence: {
        completeness: 'complete',
        proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
        receipts: [],
        gaps: [],
      },
    };
    mocks.executionQuery.isFetching = true;

    renderDeck();

    expect(screen.getByRole('status')).toHaveTextContent(
      'يجري تحديث سجل التنفيذ؛ اللقطة المعروضة هي آخر قراءة ناجحة.',
    );
    expect(screen.getByRole('button', { name: 'دفع العملية المُودعة' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'جارٍ تحديث السجل…' })).toBeDisabled();
  });

  it('offers a retry when the first execution read fails without cached data', () => {
    mocks.execution = undefined;
    mocks.executionQuery.isError = true;

    renderDeck();

    expect(screen.getByText(/تعذّر تحميل سجل التنفيذ/)).toBeInTheDocument();
    expect(screen.getByText(/فشل القراءة لا يثبت أن التنفيذ غير موجود/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة تحميل سجل التنفيذ' })).toBeInTheDocument();
    expect(screen.queryByText('لم يُعِد الخادم سجل تنفيذ محفوظًا لهذا المعرّف.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'إعادة تحميل سجل التنفيذ' }));
    expect(mocks.executionQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('allows delivery actions again after a current successful read', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      operationEvidence: {
        completeness: 'complete',
        proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
        receipts: [],
        gaps: [],
      },
    };

    renderDeck();

    expect(screen.queryByTestId('flight-deck-execution-read-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دفع العملية المُودعة' })).toBeEnabled();
  });

  it('does not describe a failed Git history read as an empty repository and offers retry', () => {
    mocks.gitLogQuery.data = undefined;
    mocks.gitLogQuery.isError = true;

    renderDeck();

    expect(screen.getByTestId('git-log-read-warning')).toHaveTextContent(
      'تعذّر تحميل سجل الإيداعات. لا يمكن استنتاج أن المستودع خالٍ من الإيداعات.',
    );
    expect(screen.queryByText('لا توجد إيداعات.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'إعادة محاولة سجل الإيداعات' }));
    expect(mocks.gitLogQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('labels retained Git history as stale after a failed refresh without discarding it', () => {
    mocks.gitLogQuery.data = {
      commits: [{ hash: 'abc123', shortHash: 'abc123', subject: 'Previously observed commit' }],
    };
    mocks.gitLogQuery.isError = true;

    renderDeck();

    expect(screen.getByTestId('git-log-read-warning')).toHaveTextContent(
      'المعروض هو آخر سجل ناجح ولا يمثل قراءة حالية',
    );
    expect(screen.getByText('Previously observed commit')).toBeInTheDocument();
    expect(screen.queryByText('لا توجد إيداعات.')).not.toBeInTheDocument();
  });

  it('blocks delivery actions while Git workspace status is refreshing', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      operationEvidence: {
        completeness: 'complete',
        proof: { verdict: 'PROVEN', accepted: true, failureReasons: [] },
        receipts: [],
        gaps: [],
      },
    };
    mocks.gitStatusQuery.isFetching = true;

    renderDeck();

    expect(screen.getByTestId('git-status-refreshing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دفع العملية المُودعة' })).toBeDisabled();
  });

  it('refreshes Git status and history together from the workspace toolbar', () => {
    renderDeck();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث بيانات Git' }));

    expect(mocks.gitStatusQuery.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.gitLogQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it('blocks delivery actions when a commit or push receipt is uncertain', () => {
    mocks.execution = {
      ...baseExecution('COMMITTED', 'passed'),
      status: 'completed',
      evidenceVerdict: 'PROVEN',
      operationEvidence: {
        completeness: 'complete',
        receipts: [{
          kind: 'push',
          status: 'unknown',
          attempt: 1,
          timestamp: '2026-08-18T05:01:00.000Z',
        }],
      },
    };
    renderDeck();

    expect(screen.getByText(/يتطلب التسليم استعادة الحالة/)).toBeInTheDocument();
    const pushButton = screen.getByRole('button', { name: 'دفع العملية المُودعة' });
    expect(pushButton).toBeDisabled();
  });
});