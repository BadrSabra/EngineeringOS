import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MissionControl from './MissionControl';

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
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
    releaseGate: {
      kind: 'ai-release-quality-decision',
      version: 1,
      status: 'passed',
      liveProviderChecks: 'disabled',
      previewChecks: 'disabled',
      summary: {
        totalCases: 11,
        passedCases: 11,
        failedCases: 0,
        skippedCases: 0,
        blockingFailures: 0,
        informationalFailures: 0,
      },
       blockers: [],
       runtimeOraclePreflight: {
         status: 'passed',
         checks: [{
           scenarioId: 'single-file-002',
           command: 'pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/single-file-002.test.ts',
           status: 'passed',
         }],
         failureIds: [],
       },
    },
    empiricalCampaign: {
      kind: 'empirical-ai-quality-scorecard',
      version: 1,
      corpusRevision: 'public-disposable-v1',
      provider: 'openrouter',
      model: 'test-model',
      measurementOnly: true,
      status: 'COMPLETE',
      empiricalQualityStatus: 'PROVEN',
      blockers: [],
      metrics: {
        totalCases: 2,
        completedCases: 2,
        incompleteCases: 0,
        providerUnavailableCount: 0,
        precision: 1,
        recall: 1,
        f1: 1,
        citationCoverage: 1,
        falseAcceptanceRate: 0,
        falseRejectionRate: 0,
        latencyMs: { p50: 100, p95: 200, p99: 200 },
      },
      cases: [],
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
        }, {
          provider: 'openai',
          model: 'gpt-4o-mini',
          failureCategory: 'CONTEXT_LENGTH',
          recoveryAction: 'Compacted the evidence window',
          evidenceStatus: 'VERIFIED',
          attemptCount: 2,
      }],
    },
  },
}));

let currentMissionControl = missionControlFixture;
let currentExecutionDetail: any = undefined;
const refetchMissionControl = vi.hoisted(() => vi.fn());
const refetchExecutionDetail = vi.hoisted(() => vi.fn());
const selectedExecutionQuery = vi.hoisted(() => ({ options: undefined as any }));

vi.mock('@workspace/api-client-react', () => ({
  useGetAiMissionControl: () => ({
    data: currentMissionControl,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: refetchMissionControl,
  }),
  useGetAiExecution: (_id: string, options: any) => {
    selectedExecutionQuery.options = options.query;
    return {
      data: currentExecutionDetail,
      error: null,
      isError: false,
      isLoading: false,
      isFetching: false,
      refetch: refetchExecutionDetail,
    };
  },
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

function runtimeStartDetail(overrides: Record<string, unknown> = {}) {
  const now = '2026-09-27T10:00:00.000Z';
  return {
    id: 'execution-1',
    attempt: 2,
    recipeReceipt: { recipeId: 'runtime.start' },
    worldTransitions: [{
      id: 'transition-1',
      executionId: 'execution-1',
      attempt: 2,
      episodeId: 'episode-1',
      actionId: 'action-1',
      status: 'materialized',
      parentWorldRevision: 'world-before',
      resultingWorldRevision: 'world-after',
      environmentRevision: 'environment-revision-1',
      freshness: 'fresh',
      beforeObservations: [{
        id: 'observation-before',
        predicate: 'runtime.before_state',
        provenance: 'DIRECT_OBSERVATION',
        completeness: 'complete',
        freshness: 'fresh',
        environmentFreshness: 'fresh',
        runtimeStatus: 'stopped',
        observedAt: now,
      }],
      afterObservations: [{
        id: 'observation-after',
        predicate: 'runtime.after_state',
        provenance: 'DIRECT_OBSERVATION',
        completeness: 'complete',
        freshness: 'fresh',
        environmentFreshness: 'fresh',
        runtimeStatus: 'running',
        observedAt: now,
      }],
      effectBundle: { id: 'effect-1', verdict: 'OBSERVED' },
      failureCode: null,
      createdAt: now,
      materializedAt: now,
    }],
    acceptance: {
      attempt: 2,
      terminalStatus: 'completed',
      outcome: 'SUCCEEDED',
      reasonCode: 'ACCEPTED',
      nextActionCode: 'NONE',
      evidenceComplete: true,
      evidenceRequired: true,
      resumable: false,
    },
    operationEvidence: { proof: { verdict: 'PROVEN', accepted: true } },
    ...overrides,
  };
}

function completedProofProjection() {
  return {
    schemaVersion: 2,
    kind: 'DELIVERY',
    phase: 'COMPLETE',
    objective: 'Confirm current execution proof',
    progress: { percent: 100, label: 'Execution ended', currentStep: null, completedSteps: 2, totalSteps: 2 },
    plan: { steps: [], currentStepId: null },
    tools: { totalCalls: 0, activeTool: null, recent: [] },
    workspace: { changedFiles: [], diffStatus: 'none' },
    verification: { status: 'passed', evidenceVerdict: 'PROVEN', proofRequired: true },
    approval: { required: false, status: 'NOT_REQUIRED', proposalId: null },
    stopped: { reason: null, outcome: 'SUCCEEDED' },
    timeline: [],
    allowedActions: [],
  } as never;
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const nextCharacter = csv[index + 1];

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (character === '\r' && nextCharacter === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
    } else if (character === '\n' && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

describe('Mission Control', () => {
  beforeEach(() => {
    currentMissionControl = missionControlFixture;
    currentExecutionDetail = undefined;
    refetchMissionControl.mockReset();
    refetchExecutionDetail.mockReset();
  });

  it('keeps the Arabic screen RTL while terminal commands remain LTR', () => {
    const { container } = renderPage();
    const command = screen.getByText(
      'pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/single-file-002.test.ts',
      { exact: true },
    );

    expect(container.querySelector('[lang="ar"]')).toHaveAttribute('dir', 'rtl');
    expect(command).toHaveAttribute('dir', 'ltr');
  });

  it('shows a return link only for the selected server-bound execution and current project', () => {
    const originalPath = window.location.pathname + window.location.search;
    try {
      window.history.pushState({}, '', '/mission-control?projectId=project-1&executionId=execution-1');
      currentExecutionDetail = { id: 'execution-1', projectId: 'project-1', sessionId: 'session-1' };
      const page = renderPage();
      expect(screen.getByTestId('link-mission-control-ai'))
        .toHaveAttribute('href', '/ai?projectId=project-1&sessionId=session-1');
      page.unmount();

      // A stale detail response must not link to an unrelated selected run.
      currentExecutionDetail = { id: 'execution-2', projectId: 'project-1', sessionId: 'session-2' };
      const stalePage = renderPage();
      expect(screen.queryByTestId('link-mission-control-ai')).not.toBeInTheDocument();
      stalePage.unmount();

      window.history.pushState({}, '', '/mission-control?projectId=project-2&executionId=execution-1');
      currentExecutionDetail = { id: 'execution-1', projectId: 'project-1', sessionId: 'session-1' };
      renderPage();
      expect(screen.queryByTestId('link-mission-control-ai')).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', originalPath);
    }
  });

  it('shows bounded shadow queue count and oldest wait only when returned by the server', () => {
    currentMissionControl = {
      ...missionControlFixture,
      shadowComparisonQueue: {
        status: 'active',
        pendingCount: 3,
        oldestPendingAgeMs: 6 * 60_000,
        delayAlertStatus: 'closed',
        observedAt: '2026-11-04T12:00:00.000Z',
      },
    } as typeof missionControlFixture;
    renderPage();

    const queue = screen.getByTestId('shadow-comparison-queue');
    expect(within(queue).getByTestId('shadow-queue-pending-count')).toHaveTextContent('3');
    expect(within(queue).getByTestId('shadow-queue-oldest-age')).toHaveTextContent('6 دقيقة');
    expect(within(queue).getByText('قراءة تشغيلية مجمّعة فقط؛ لا تغيّر قرارات أو حالات التشغيل.')).toBeInTheDocument();
    expect(within(queue).getByTestId('shadow-queue-delay-alert-status')).toHaveTextContent('مغلق');
  });

  it('shows only aggregate delay values in the alert and clears it after recovery', () => {
    currentMissionControl = {
      ...missionControlFixture,
      shadowComparisonQueue: {
        status: 'active',
        pendingCount: 4,
        oldestPendingAgeMs: 16 * 60_000,
        delayAlertStatus: 'open',
        observedAt: '2026-11-04T12:00:00.000Z',
      },
    } as typeof missionControlFixture;
    const page = renderPage();
    const queue = screen.getByTestId('shadow-comparison-queue');
    const alert = within(queue).getByRole('alert');
    expect(alert).toHaveTextContent(
      'تنبيه تشغيلي · الحالة: مفتوح · العدد: 4 · عمر الأقدم: 16 دقيقة',
    );
    expect(alert).not.toHaveTextContent(/Mission|Goal|قرار|مهمة/i);

    currentMissionControl = {
      ...missionControlFixture,
      shadowComparisonQueue: {
        status: 'active',
        pendingCount: 0,
        oldestPendingAgeMs: null,
        delayAlertStatus: 'closed',
        observedAt: '2026-11-04T12:01:00.000Z',
      },
    } as typeof missionControlFixture;
    page.rerender(<MissionControl />);
    expect(screen.queryByTestId('shadow-queue-delay-alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('shadow-queue-delay-alert-status')).toHaveTextContent('مغلق');
  });

  it('does not infer a chat session from an execution without a server session ID', () => {
    currentExecutionDetail = { id: 'execution-1', projectId: 'project-1' };
    renderPage();
    expect(screen.queryByTestId('link-mission-control-ai')).not.toBeInTheDocument();
  });

  it('routes uncertain Task-linked recovery to Tasks instead of generic resume or abandon', () => {
    const originalPath = window.location.pathname + window.location.search;
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        recovery: { uncertain: true },
      }],
    } as typeof missionControlFixture;
    currentExecutionDetail = { id: 'execution-1', projectId: 'project-1', linkedTaskId: 'task-1' };

    try {
      window.history.pushState({}, '', '/mission-control?projectId=project-1&executionId=execution-1');
      renderPage();

      const recovery = screen.getByRole('region', { name: 'استعادة التنفيذ غير المحسوم' });
      expect(within(recovery).getByRole('link', { name: 'افتح المهمة المرتبطة' }))
        .toHaveAttribute('href', '/tasks?taskId=task-1');
      expect(within(recovery).queryByRole('button', { name: 'استأنف مرة واحدة' })).not.toBeInTheDocument();
      expect(within(recovery).queryByRole('button', { name: 'تخلَّ عنه بأمان' })).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', originalPath);
    }
  });

  it('shows execution state, operational metrics, evidence, and Flight Deck link', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'مركز المهام' })).toBeInTheDocument();
    expect(await screen.findByText('Repair the auth scope check')).toBeInTheDocument();
    expect(screen.getAllByText('READY FOR REVIEW').length).toBeGreaterThan(0);
    expect(screen.queryByText('openrouter / openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openrouter')).not.toBeInTheDocument();
    expect(screen.queryByText('openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.getByText('إخفاقات التحقق: 1')).toBeInTheDocument();
    expect(screen.getByText('التحقق')).toBeInTheDocument();
    expect(screen.getByText('أدلة المسجل')).toBeInTheDocument();
    expect(screen.getByText('بوابة الإصدار الحتمية')).toBeInTheDocument();
    expect(screen.getByLabelText('فحص مسبق لمراقب التشغيل')).toHaveTextContent('single-file-002');
    expect(screen.getByLabelText('فحص مسبق لمراقب التشغيل')).toHaveTextContent('pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/single-file-002.test.ts');
    expect(screen.getByLabelText('فحص مسبق لمراقب التشغيل')).toHaveTextContent('passed');
    expect(screen.getByText('مراجعة الجودة التجريبية')).toBeInTheDocument();
    expect(screen.getByText('قياس اختياري فقط — وليس معيارًا للإصدار.')).toBeInTheDocument();
    expect(screen.getByText('public-disposable-v1')).toBeInTheDocument();
    expect(screen.getByText('Validation and behavior proof accepted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /افتح لوحة متابعة التنفيذ/i })).toHaveAttribute(
      'href',
      '/flight-deck?executionId=execution-1',
    );
  });

  it('does not show successful completion when the current OperationEvidence proof is unaccepted', () => {
    currentExecutionDetail = runtimeStartDetail({
      status: 'completed',
      proofRequired: true,
      flightState: 'COMPLETED',
      projection: completedProofProjection(),
      operationEvidence: { proof: { verdict: 'PROVEN', accepted: false } },
    });
    renderPage();

    const capsule = screen.getByTestId('mission-capsule');
    expect(within(capsule).getByTestId('text-lifecycle-title')).toHaveTextContent('الإثبات المطلوب غير مكتمل');
    expect(within(capsule).getByTestId('text-mission-state-detail')).toHaveTextContent('لا تعتبر النتيجة مقبولة');
    const timeline = screen.getByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' });
    expect(timeline).toHaveTextContent('الإثبات المعتمد: BLOCKED');
    expect(timeline).not.toHaveTextContent('الإثبات المعتمد: PROVEN');
  });

  it('hides the execution capsule while the selected detail belongs to another execution', () => {
    currentExecutionDetail = runtimeStartDetail({
      id: 'execution-previous',
      projection: completedProofProjection(),
    });
    renderPage();

    expect(screen.queryByTestId('mission-capsule')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'سلسلة الأدلة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' })).not.toBeInTheDocument();
  });

  it('shows the runtime.start observation, effect, acceptance, and materialization as distinct records', async () => {
    currentExecutionDetail = runtimeStartDetail();
    renderPage();

    const timeline = await screen.findByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' });
    expect(within(timeline).getByText('stopped')).toHaveAttribute('dir', 'ltr');
    expect(within(timeline).getByText('running')).toHaveAttribute('dir', 'ltr');
    expect(within(timeline).getByText('observation-before')).toBeInTheDocument();
    expect(within(timeline).getByText('observation-after')).toBeInTheDocument();
    expect(within(timeline).getByText('effect-1')).toBeInTheDocument();
    expect(within(timeline).getByText('world-after')).toHaveAttribute('dir', 'ltr');
    expect(within(timeline).getByText('PROVEN')).toBeInTheDocument();
    expect(timeline).toHaveTextContent('الرصد والأثر والقبول وتحديث حالة العالم سجلات منفصلة؛ ولا يثبت أحدها تحقق الآخر.');
  });

  it('shows the Apply handoff separately from report completion and reloads the actual successor state', async () => {
    const detail = runtimeStartDetail();
    const transition = {
      ...detail.worldTransitions[0],
      id: 'apply-transition',
      beforeObservations: detail.worldTransitions[0].beforeObservations.map((observation) => ({
        ...observation,
        predicate: 'workspace.tree_hash',
        runtimeStatus: null,
      })),
      afterObservations: detail.worldTransitions[0].afterObservations.map((observation) => ({
        ...observation,
        predicate: 'workspace.tree_hash',
        runtimeStatus: null,
      })),
    };
    const applyMission = {
      goalId: 'apply-goal',
      missionId: 'mission-1',
      planRevision: 'revision-1',
      d2: { state: 'PROVEN', transitionId: 'apply-transition', resultingWorldRevision: 'world-after' },
      successor: { goalId: 'report-goal', status: 'running', blockedReason: null, taskId: 'task-1' },
    };
    currentExecutionDetail = runtimeStartDetail({
      recipeReceipt: null,
      worldTransitions: [transition],
      applyMission,
    });
    const firstView = renderPage();
    const timeline = await screen.findByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' });
    const handoff = within(timeline).getByLabelText('إحالة تطبيق الخطة');
    expect(within(timeline).getAllByText('قيمة تجزئة الشجرة غير معروضة')).toHaveLength(2);
    expect(within(handoff).getByTestId('status-apply-d2')).toHaveTextContent('إثبات التطبيق D2: PROVEN');
    expect(within(handoff).getByTestId('status-report-goal')).toHaveTextContent('هدف التقرير الناتج عن التطبيق: running');
    expect(handoff).toHaveTextContent('فالإرسال لا يعني اكتمالًا أو تسليمًا خارجيًا');

    firstView.unmount();
    currentExecutionDetail = runtimeStartDetail({
      recipeReceipt: null,
      worldTransitions: [transition],
      applyMission: {
        ...applyMission,
        successor: { ...applyMission.successor, status: 'completed' },
      },
    });
    renderPage();
    const reloadedHandoff = await screen.findByLabelText('إحالة تطبيق الخطة');
    expect(reloadedHandoff).toHaveTextContent('هدف التقرير الناتج عن التطبيق: completed');
    expect(reloadedHandoff).toHaveTextContent('اكتمل هدف التقرير. ولا يعني ذلك تسليمًا خارجيًا.');
  });

  it('does not show Apply D2 proven when its transition is absent from the current attempt', async () => {
    currentExecutionDetail = runtimeStartDetail({
      recipeReceipt: null,
      worldTransitions: [],
      applyMission: {
        goalId: 'apply-goal',
        missionId: 'mission-1',
        planRevision: 'revision-1',
        d2: { state: 'PROVEN', transitionId: 'old-transition', resultingWorldRevision: 'world-after' },
        successor: { goalId: 'report-goal', status: 'completed', blockedReason: null, taskId: 'task-1' },
      },
    });
    renderPage();
    const handoff = await screen.findByLabelText('إحالة تطبيق الخطة');
    expect(within(handoff).getByTestId('status-apply-d2')).toHaveTextContent('إثبات التطبيق D2: INCOMPLETE');
    expect(handoff).not.toHaveTextContent('اكتمل هدف التقرير.');
    expect(handoff).not.toHaveTextContent('مراجعة حالة العالم:');
  });

  it('shows a stale Apply plan as blocked without claiming a linked report goal', async () => {
    currentExecutionDetail = runtimeStartDetail({
      recipeReceipt: null,
      worldTransitions: [],
      applyMission: {
        goalId: 'apply-goal',
        missionId: 'mission-1',
        planRevision: 'old-revision',
        reason: 'apply_plan_binding_invalid',
        d2: { state: 'BLOCKED', transitionId: null, resultingWorldRevision: null },
        successor: null,
      },
    });
    renderPage();
    const handoff = await screen.findByLabelText('إحالة تطبيق الخطة');
    expect(handoff).toHaveTextContent('إثبات التطبيق D2: BLOCKED');
    expect(handoff).toHaveTextContent('هدف التقرير الناتج عن التطبيق: غير مرتبط');
    expect(handoff).toHaveTextContent('apply_plan_binding_invalid');
    expect(handoff).not.toHaveTextContent('اكتمل هدف التقرير.');
  });

  it('keeps reading a queued report goal until it terminates', () => {
    renderPage();
    const interval = selectedExecutionQuery.options.refetchInterval;
    const detail = (status: string) => ({
      state: { data: { status: 'completed', applyMission: {
        d2: { state: 'PROVEN' },
        successor: { status },
      } } },
    });
    expect(interval(detail('queued'))).toBe(5_000);
    expect(interval(detail('planning'))).toBe(5_000);
    expect(interval(detail('verifying'))).toBe(5_000);
    expect(interval(detail('completed'))).toBe(false);
    expect(interval(detail('blocked'))).toBe(false);
  });

  it('shows a redacted current-attempt Evidence Braid without promoting it to acceptance', async () => {
    const now = '2026-09-27T10:00:00.000Z';
    currentExecutionDetail = runtimeStartDetail({
      evidenceBraid: {
        executionId: 'execution-1',
        projectId: 'project-1',
        attempt: 2,
        truncated: false,
        episodes: [{
          id: 'episode-braid-1',
          attempt: 2,
          missionId: null,
          goalId: null,
          state: 'completed',
          verdict: 'achieved',
          projectRevision: 'project-revision-1',
          environmentRevision: 'environment-revision-1',
          worldRevision: 'world-revision-1',
          planRevision: 'plan-revision-1',
          createdAt: now,
          closedAt: now,
          events: [{
            id: 'event-braid-1',
            sequence: 1,
            eventType: 'ACTION_REQUESTED',
            createdAt: now,
            payload: 'private-event-payload',
          }],
          observations: [{
            id: 'observation-braid-1',
            observationRole: 'after_state',
            kind: 'runtime_state',
            provenance: 'DIRECT_OBSERVATION',
            completeness: 'complete',
            freshness: 'fresh',
            environmentFreshness: 'fresh',
            projectRevision: 'project-revision-1',
            environmentRevision: 'environment-revision-1',
            observedAt: now,
            value: 'private-observation-value',
          }],
          effects: [{
            id: 'effect-braid-1',
            actionId: 'action-braid-1',
            capabilityId: 'runtime.start',
            status: 'observed',
            beforeObservationIds: [],
            afterObservationIds: ['observation-braid-1'],
            missingEffectCount: 0,
            contradictionCount: 0,
          }],
          effectBundles: [{
            id: 'bundle-braid-1',
            verdict: 'OBSERVED',
            worldRevision: 'world-revision-2',
            effectIds: ['effect-braid-1'],
            createdAt: now,
          }],
          scope: 'private-episode-scope',
          workerId: 'private-worker-id',
        }],
      },
    });
    renderPage();

    const braid = await screen.findByRole('region', { name: 'سلسلة الأدلة' });
    expect(braid).toHaveTextContent('ACTION_REQUESTED');
    expect(braid).toHaveTextContent('DIRECT_OBSERVATION');
    expect(braid).toHaveTextContent('observed');
    expect(braid).toHaveTextContent('OBSERVED');
    expect(braid).toHaveTextContent('مراجعة حالة العالم · world-revision-2');
    expect(braid).toHaveTextContent('القبول · المحاولة الحالية');
    expect(braid).toHaveTextContent('1 سجلات انتقال حالة عالم مرتبطة');
    expect(braid).not.toHaveTextContent('private-event-payload');
    expect(braid).not.toHaveTextContent('private-observation-value');
    expect(braid).not.toHaveTextContent('private-episode-scope');
    expect(braid).not.toHaveTextContent('private-worker-id');
  });

  it('does not infer World materialization from a PROVEN acceptance when the transition is absent', async () => {
    currentExecutionDetail = runtimeStartDetail({ worldTransitions: [] });
    renderPage();

    const timeline = await screen.findByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' });
    expect(within(timeline).getByText('PROVEN')).toBeInTheDocument();
    expect(within(timeline).getByText('لا يوجد سجل انتقال حالة عالم لهذه المحاولة.')).toBeInTheDocument();
    expect(within(timeline).queryByText('MATERIALIZED')).not.toBeInTheDocument();
  });

  it('keeps a terminal World materialization failure visible without promoting it to success', async () => {
    const fixture = runtimeStartDetail();
    currentExecutionDetail = runtimeStartDetail({
      worldTransitions: fixture.worldTransitions.map((transition) => ({
        ...transition,
        status: 'terminal_failed',
        resultingWorldRevision: null,
        failureCode: 'WORLD_REVISION_CONFLICT',
        effectBundle: { id: 'effect-1', verdict: 'CONTRADICTED' },
      })),
      acceptance: { ...fixture.acceptance, outcome: 'FAILED', evidenceComplete: false },
      operationEvidence: { proof: { verdict: 'BLOCKED' } },
    });
    renderPage();

    const timeline = await screen.findByRole('region', { name: 'الخط الزمني لانتقال حالة العالم' });
    expect(within(timeline).getByText('terminal_failed')).toBeInTheDocument();
    expect(within(timeline).getByText('WORLD_REVISION_CONFLICT')).toBeInTheDocument();
    expect(within(timeline).getByText('CONTRADICTED')).toBeInTheDocument();
    expect(within(timeline).queryByText('PROVEN')).not.toBeInTheDocument();
    expect(within(timeline).queryByText('MATERIALIZED')).not.toBeInTheDocument();
  });

  it('shows operator next steps while retaining acceptance diagnostic codes', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [
        {
          ...missionControlFixture.executions[0],
          id: 'cancelled-execution',
          state: 'CANCELLED',
          acceptance: {
            attempt: 1,
            terminalStatus: 'cancelled',
            outcome: 'INTERRUPTED',
            reasonCode: 'EXECUTION_CANCELLED',
            nextActionCode: 'ABANDON_EXECUTION',
            evidenceComplete: false,
            evidenceRequired: true,
            resumable: false,
          },
        },
        {
          ...missionControlFixture.executions[0],
          id: 'incomplete-execution',
          objective: 'Review incomplete evidence',
          acceptance: {
            attempt: 2,
            terminalStatus: 'paused',
            outcome: 'INTERRUPTED',
            reasonCode: 'EVIDENCE_INCOMPLETE',
            nextActionCode: 'REVIEW_INCOMPLETE_EVIDENCE',
            evidenceComplete: false,
            evidenceRequired: true,
            resumable: false,
          },
        },
        {
          ...missionControlFixture.executions[0],
          id: 'probe-execution',
          objective: 'Run capability probe',
          acceptance: {
            attempt: 3,
            terminalStatus: 'failed',
            outcome: 'FAILED',
            reasonCode: 'CAPABILITY_PROBE_FINAL',
            nextActionCode: 'START_NEW_PROBE',
            evidenceComplete: true,
            evidenceRequired: true,
            resumable: false,
          },
        },
      ],
    };
    renderPage();

    const acceptance = await screen.findByRole('region', { name: 'قبول التنفيذ الحالي' });
    expect(within(acceptance).getByText('Start a new scoped run before relying on this result.')).toBeInTheDocument();
    expect(within(acceptance).getByText('ABANDON_EXECUTION')).toBeInTheDocument();
    expect(within(acceptance).queryByText('REVIEW_INCOMPLETE_EVIDENCE')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /incomplete evidence/i }));
    expect(within(screen.getByRole('region', { name: 'قبول التنفيذ الحالي' })).getByText(
      'Review the incomplete evidence before relying on this result.',
    )).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'قبول التنفيذ الحالي' })).getByText(
      'REVIEW_INCOMPLETE_EVIDENCE',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run capability probe/i }));
    const probeAcceptance = screen.getByRole('region', { name: 'قبول التنفيذ الحالي' });
    expect(within(probeAcceptance).getByText('Start a new scoped probe.')).toBeInTheDocument();
    expect(within(probeAcceptance).getByText('START_NEW_PROBE')).toBeInTheDocument();
  });

  it('shows targeted incomplete acceptance even when the provider returned no proof snapshot', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        id: 'targeted-incomplete-execution',
        state: 'SUCCEEDED',
        objective: 'Answer a targeted project question',
        proofRequired: true,
        evidence: {
          ...missionControlFixture.executions[0].evidence,
          verdict: 'ANALYSIS_INCOMPLETE',
        },
        acceptance: {
          attempt: 1,
          terminalStatus: 'paused',
          outcome: 'INTERRUPTED',
          reasonCode: 'EVIDENCE_INCOMPLETE',
          nextActionCode: 'REVIEW_INCOMPLETE_EVIDENCE',
          evidenceComplete: false,
          evidenceRequired: true,
          resumable: false,
        },
      }],
    };
    renderPage();

    expect(screen.getByLabelText('Acceptance: incomplete')).toBeInTheDocument();
    const acceptance = await screen.findByRole('region', { name: 'قبول التنفيذ الحالي' });
    expect(acceptance).toHaveTextContent('Acceptance: incomplete');
    expect(acceptance).toHaveTextContent('Review the incomplete evidence before relying on this result.');
    expect(acceptance).toHaveTextContent('REVIEW_INCOMPLETE_EVIDENCE');
  });

  it('shows bounded runtime-oracle failure identifiers without provider output', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      benchmark: {
        ...missionControlFixture.benchmark,
        releaseGate: {
          ...missionControlFixture.benchmark.releaseGate,
          status: 'blocked',
          runtimeOraclePreflight: {
            status: 'failed',
            checks: [{
              scenarioId: 'test-failure-001',
              command: 'pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/test-failure-001.test.ts',
              status: 'failed',
              failureCode: 'RUNTIME_ORACLE_FAILED',
            }],
            failureIds: ['test-failure-001'],
          },
        },
      },
    };
    renderPage();

    const runtimeOracle = await screen.findByLabelText('فحص مسبق لمراقب التشغيل');
    expect(screen.getByLabelText('بوابة الإصدار الحتمية')).toHaveTextContent('blocked');
    expect(runtimeOracle).toHaveTextContent('failed');
    expect(runtimeOracle).toHaveTextContent('test-failure-001');
    expect(runtimeOracle).toHaveTextContent('RUNTIME_ORACLE_FAILED');
    expect(runtimeOracle).toHaveTextContent('معرّفات الإخفاق');
    expect(runtimeOracle).not.toHaveTextContent('provider output');
  });

  it('keeps historical provider recovery details visible after the query is reloaded', async () => {
    currentMissionControl = historicalRecoveryFixture;
    const { rerender } = renderPage();

    expect(await screen.findByText('Switched to a bounded retry')).toBeInTheDocument();
    expect(screen.getByText('RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('RECOVERED')).toBeInTheDocument();
    expect(screen.getByText('CONTEXT_LENGTH')).toBeInTheDocument();
    expect(screen.getByText('Compacted the evidence window')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.queryByText('openrouter · openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openai · gpt-4o-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openrouter')).not.toBeInTheDocument();
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
    expect(screen.getAllByText('المحاولات')).toHaveLength(2);
    expect(within(screen.getByLabelText('ملخصات استعادة المزود السابقة')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByLabelText('ملخصات استعادة المزود السابقة')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث' }));
    expect(refetchMissionControl).toHaveBeenCalledTimes(1);
    expect(refetchExecutionDetail).toHaveBeenCalledTimes(1);

    currentMissionControl = {
      ...historicalRecoveryFixture,
      updatedAt: '2026-08-22T09:30:00.000Z',
    };
    rerender(<MissionControl />);

    expect(await screen.findByText('Switched to a bounded retry')).toBeInTheDocument();
    expect(screen.getByText('RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('RECOVERED')).toBeInTheDocument();
    expect(screen.getByText('CONTEXT_LENGTH')).toBeInTheDocument();
    expect(screen.getByText('Compacted the evidence window')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.queryByText('openrouter · openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openai · gpt-4o-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openrouter')).not.toBeInTheDocument();
    expect(screen.queryByText('gpt-4o-mini')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('ملخصات استعادة المزود السابقة')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByLabelText('ملخصات استعادة المزود السابقة')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();
  });

  it('renders the normal benchmark view for a legacy envelope without recovery summaries', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      benchmark: {
        ...missionControlFixture.benchmark,
        freeTierEnvelope: {
          schemaVersion: 2,
          verdict: 'PASS',
        },
      },
    };
    renderPage();

    expect(await screen.findByText('مقارنة خط الأساس')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();
    expect(screen.queryByText('تفاصيل الاستعادة في التقارير السابقة')).not.toBeInTheDocument();
    expect(screen.queryByText('استعادة مزود الذكاء الاصطناعي')).not.toBeInTheDocument();
  });

  it('helps operators search, filter, and page through the complete execution history', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: Array.from({ length: 10 }, (_, index) => ({
        ...missionControlFixture.executions[0],
        id: `execution-${index + 1}`,
        objective: index === 9 ? 'Investigate the quota recovery path' : `Repair run ${index + 1}`,
        state: index === 9 ? 'BLOCKED' : 'READY_FOR_REVIEW',
        failureCategory: index === 9 ? 'RATE_LIMIT' : undefined,
        recoveryAction: index === 9 ? 'Switch provider' : undefined,
        evidenceStatus: index === 9 ? 'INCOMPLETE' : undefined,
      })),
    };
    renderPage();

    expect(await screen.findByText('10 من 10 عملية')).toBeInTheDocument();
    expect(screen.getByText('عرض 1–8 من 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'صفحة السجل التالية' })).toBeEnabled();
    expect(screen.queryByText('Investigate the quota recovery path')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'صفحة السجل التالية' }));
    expect(screen.getByText('عرض 9–10 من 10')).toBeInTheDocument();
    expect(screen.getByText('Investigate the quota recovery path')).toBeInTheDocument();
    expect(screen.getByText('الإخفاق: RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('الإجراء: Switch provider')).toBeInTheDocument();
    expect(screen.getByText('الأدلة المسجلة: INCOMPLETE')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث في سجل التنفيذ' }), {
      target: { value: 'quota' },
    });
    expect(screen.getByText('1 من 10 عملية')).toBeInTheDocument();
    expect(screen.getByText('عرض 1–1 من 1')).toBeInTheDocument();
    expect(screen.getByText('Investigate the quota recovery path')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'تصفية سجل التنفيذ حسب الحالة' }), {
      target: { value: 'READY_FOR_REVIEW' },
    });
    expect(screen.getByText('لا توجد عمليات تطابق البحث أو مرشح الحالة.')).toBeInTheDocument();
  });

  it('labels execution-history evidence as recorded rather than current Canonical Proof', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        evidenceStatus: 'PROVEN',
        evidence: { verdict: 'PROVEN' },
      }],
    };
    renderPage();

    expect(await screen.findByText('1 من 1 عملية')).toBeInTheDocument();
    expect(screen.getByText('الأدلة المسجلة: PROVEN')).toBeInTheDocument();
    expect(screen.getByText(/لا يُعاد التحقق من الإثبات المعتمد الحالي في هذا السجل/)).toBeInTheDocument();
  });

  it('exports every filtered execution with recovery and benchmark context, not just the current page', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: Array.from({ length: 10 }, (_, index) => ({
        ...missionControlFixture.executions[0],
        id: `execution-${index + 1}`,
        objective: index === 9 ? 'Investigate the quota recovery path' : `Repair run ${index + 1}`,
        state: index === 9 ? 'BLOCKED' : 'READY_FOR_REVIEW',
        failureCategory: index === 9 ? 'RATE_LIMIT' : undefined,
        recoveryAction: index === 9 ? 'Switch provider' : undefined,
        evidenceStatus: index === 9 ? 'INCOMPLETE' : undefined,
      })),
    };
    const createObjectURL = vi.fn(() => 'blob:mission-control');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث في سجل التنفيذ' }), {
      target: { value: 'repair run' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تصدير السجل المصفّى' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('"Execution ID","Objective","State","Failure Category","Recovery Action","Evidence Status","Attempts"');
    expect(csv).not.toContain('Provider');
    expect(csv).not.toContain('Model');
    expect(csv).toContain('"execution-1"');
    expect(csv).toContain('"execution-9"');
    expect(csv).not.toContain('"execution-10"');
    expect(csv).toContain('"flight-deck-v2"');
    expect(csv).toContain('""correctCompletionRate"":1');
    expect(csv).toContain('"baseline-clean-witness"');
    expect(csv).toContain('"Runtime Oracle Status","Runtime Oracle Checks","Runtime Oracle Failure IDs"');
    expect(csv).toContain('""scenarioId"":""single-file-002""');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mission-control');

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('exports filtered executions and the full benchmark context as nested JSON', async () => {
    const nestedEvidence = {
      verdict: 'PROVEN',
      checks: [{ name: 'recovery', passed: true }],
      benchmarkDetails: { threshold: 0.95 },
    };
    currentMissionControl = {
      ...missionControlFixture,
      executions: [
        { ...missionControlFixture.executions[0], id: 'included', evidence: nestedEvidence },
        { ...missionControlFixture.executions[0], id: 'excluded', objective: 'Unrelated execution' },
      ],
    };
    const createObjectURL = vi.fn(() => 'blob:mission-control-json');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث في سجل التنفيذ' }), {
      target: { value: 'included' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'صيغة التصدير' }), {
      target: { value: 'json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تصدير السجل المصفّى' }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const exported = JSON.parse(await blob.text()) as {
      executions: Array<typeof missionControlFixture.executions[number]>;
      benchmark: typeof missionControlFixture.benchmark;
    };
    expect(exported.executions).toHaveLength(1);
    expect(exported.executions[0]).toMatchObject({ id: 'included', evidence: nestedEvidence });
    expect(exported.executions[0]).not.toHaveProperty('provider');
    expect(exported.executions[0]).not.toHaveProperty('model');
    const { provider: _provider, model: _model, ...safeEmpiricalCampaign } =
      missionControlFixture.benchmark.empiricalCampaign;
    expect(exported.benchmark).toMatchObject({
      ...missionControlFixture.benchmark,
      empiricalCampaign: safeEmpiricalCampaign,
    });
    expect(JSON.stringify(exported.benchmark)).not.toContain('openrouter');
    expect(JSON.stringify(exported.benchmark)).not.toContain('test-model');
    expect(exported.benchmark.releaseGate.runtimeOraclePreflight).toEqual(
      missionControlFixture.benchmark.releaseGate.runtimeOraclePreflight,
    );
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mission-control-json');

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('exports failed runtime-oracle status and bounded check metadata without provider output', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      benchmark: {
        ...missionControlFixture.benchmark,
        releaseGate: {
          ...missionControlFixture.benchmark.releaseGate,
          status: 'blocked',
          runtimeOraclePreflight: {
            status: 'failed',
            checks: [{
              scenarioId: 'test-failure-001',
              command: 'pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/test-failure-001.test.ts',
              status: 'failed',
              failureCode: 'RUNTIME_ORACLE_FAILED',
              providerOutput: 'must not be exported',
            }],
            failureIds: ['test-failure-001', 'provider output'],
            providerOutput: 'must not be exported',
          },
        },
      },
    };
    const createObjectURL = vi.fn(() => 'blob:mission-control-failed-oracle');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'تصدير السجل المصفّى' }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('"Runtime Oracle Status","Runtime Oracle Checks","Runtime Oracle Failure IDs"');
    expect(csv).toContain('"failed"');
    expect(csv).toContain('""scenarioId"":""test-failure-001""');
    expect(csv).toContain('""failureCode"":""RUNTIME_ORACLE_FAILED""');
    expect(csv).not.toContain('must not be exported');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mission-control-failed-oracle');

    fireEvent.change(screen.getByRole('combobox', { name: 'صيغة التصدير' }), {
      target: { value: 'json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تصدير السجل المصفّى' }));
    const jsonBlob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    const exported = JSON.parse(await jsonBlob.text()) as {
      benchmark: { releaseGate?: { runtimeOraclePreflight?: unknown } };
    };
    expect(exported.benchmark.releaseGate?.runtimeOraclePreflight).toEqual({
      status: 'failed',
      checks: [{
        scenarioId: 'test-failure-001',
        command: 'pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/test-failure-001.test.ts',
        status: 'failed',
        failureCode: 'RUNTIME_ORACLE_FAILED',
      }],
      failureIds: ['test-failure-001'],
    });
    expect(await jsonBlob.text()).not.toContain('must not be exported');

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('clearly disables export when the active filters match no executions', async () => {
    renderPage();

    fireEvent.change(screen.getByRole('searchbox', { name: 'البحث في سجل التنفيذ' }), {
      target: { value: 'does-not-exist' },
    });

    const exportButton = screen.getByRole('button', { name: 'تصدير السجل المصفّى (لا توجد عمليات مطابقة)' });
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'صيغة التصدير' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد عمليات مطابقة للتصدير.');
  });

  it('imports a nested JSON history and shows a read-only side-by-side comparison', async () => {
    renderPage();
    const imported = {
      executions: [{
        id: 'archived-execution',
        state: 'COMPLETED',
        objective: 'Archived recovery',
        validationFailures: 4,
        evidence: { verdict: 'VERIFIED', checks: [{ passed: true }] },
      }],
      benchmark: {
        scorecard: { suiteVersion: 'archived-suite', metrics: { correctCompletionRate: 0.75 } },
        baseline: { baselineId: 'archived-baseline', metrics: { correctCompletionRate: 0.5 } },
      },
    };
    const file = new File([JSON.stringify(imported)], 'recovery-history.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'مقارنة السجل المستورد' })).toBeInTheDocument();
    expect(screen.getByText('مقارنة للقراءة فقط؛ لم يتغير سجل التنفيذ الحالي.')).toBeInTheDocument();
    expect(screen.getByText(/تم استيراد 1 تنفيذًا من الملف/)).toHaveTextContent('recovery-history.json');
    expect(screen.getByText((_, element) => element?.tagName === 'BDI' && element.textContent === 'archived-execution'))
      .toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByText('السجل الحالي')).toHaveLength(1);
    expect(screen.getAllByText('السجل المستورد')).toHaveLength(1);
    expect(screen.queryByText('archived-suite')).not.toBeInTheDocument();
    expect(screen.getAllByText('Correct Completion Rate')).toHaveLength(3);
    expect(screen.getByText('0.75')).toBeInTheDocument();
    expect(screen.getByText('0.50')).toBeInTheDocument();
    const importedBaselineValue = screen.getByText('0.50');
    expect(importedBaselineValue).toHaveAttribute('dir', 'ltr');
    expect(importedBaselineValue.parentElement).toHaveTextContent('الأساس');
    expect(screen.getByText('Repair the auth scope check')).toBeInTheDocument();
  });

  it('separates current unaccepted proof from recorded evidence in the comparison card', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        proofRequired: true,
        evidenceProjection: {
          completeness: 'complete',
          proof: { verdict: 'PROVEN', accepted: false },
        },
      }],
    };
    renderPage();
    const imported = {
      executions: [{ id: 'archived-run', state: 'COMPLETED', evidence: { verdict: 'VERIFIED' } }],
      benchmark: {
        scorecard: { suiteVersion: 'archived-suite', metrics: { correctCompletionRate: 0.75 } },
        baseline: { baselineId: 'archived-baseline', metrics: { correctCompletionRate: 0.5 } },
      },
    };
    const file = new File([JSON.stringify(imported)], 'comparison.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });

    const liveRun = await screen.findByTestId('comparison-run-live-run');
    const currentEvidenceStatus = within(liveRun).getByTestId('comparison-evidence-status-live-run');
    expect(currentEvidenceStatus).toHaveTextContent('BLOCKED');
    expect(currentEvidenceStatus).not.toHaveTextContent('PROVEN');
    expect(liveRun).toHaveTextContent('بيانات الأدلة المسجلة ليست إثباتًا معتمدًا');
    expect(liveRun).toHaveTextContent('الحكم المسجل');
    expect(liveRun).toHaveTextContent('PROVEN');
  });

  it('lets operators switch the live and imported runs without mutating either history', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [
        missionControlFixture.executions[0],
        {
          ...missionControlFixture.executions[0],
          id: 'execution-2',
          state: 'BLOCKED',
          objective: 'Repair the billing timeout',
          validationFailures: 3,
          eventCount: 1,
          evidence: { verdict: 'BLOCKED', reason: 'The provider remained unavailable.' },
          recoveryAction: 'Escalate to operator',
          failureCategory: 'PROVIDER_UNAVAILABLE',
          recentEvents: [{ kind: 'provider_failure', detail: 'Provider unavailable.' }],
        },
      ],
    };
    renderPage();
    const imported = {
      executions: [
        { id: 'archived-1', state: 'COMPLETED', objective: 'Archived first', attempts: 1, eventCount: 2, evidence: { verdict: 'VERIFIED' }, recoveryAction: 'Retry' },
        { id: 'archived-2', state: 'FAILED', objective: 'Archived second', attempts: 4, eventCount: 5, evidence: { verdict: 'FAILED' }, recoveryAction: 'Escalate' },
      ],
      benchmark: {
        scorecard: { metrics: { correctCompletionRate: 0.5 } },
        baseline: { metrics: { correctCompletionRate: 0.5 } },
      },
    };
    const file = new File([JSON.stringify(imported)], 'comparison.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });

    expect(await screen.findByTestId('comparison-run-live-run')).toHaveTextContent('execution-1');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('archived-1');
    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('3 إجمالًا');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('2 إجمالًا');

    fireEvent.change(screen.getByRole('combobox', { name: 'اختر التنفيذ الحالي للمقارنة' }), { target: { value: 'execution-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'اختر التنفيذ المستورد للمقارنة' }), { target: { value: 'archived-2' } });

    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('execution-2');
    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('Escalate to operator');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('archived-2');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('5 إجمالًا');
    expect(screen.getByText((_, element) => element?.tagName === 'BDI' && element.textContent === 'archived-1, archived-2'))
      .toHaveAttribute('dir', 'ltr');
  });

  it('exports the selected live and imported pair with aligned evidence, recovery, and timelines', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        id: 'live-selected',
        state: 'BLOCKED',
        eventCount: 2,
        failureCategory: 'RATE_LIMIT',
        recoveryAction: 'Bounded retry',
        evidenceStatus: 'INCOMPLETE',
        recovery: { attempt: 2, provider: 'openrouter' },
        timestamps: { startedAt: '2026-08-22T10:00:00.000Z' },
        recentEvents: [
          { type: 'provider_failure', timestamp: '2026-08-22T10:01:00.000Z', detail: 'Rate limited' },
          { type: 'retry', timestamp: '2026-08-22T10:02:00.000Z', detail: 'Retry bounded' },
        ],
      }],
    };
    const imported = {
      executions: [{
        id: 'archived-selected',
        state: 'COMPLETED',
        objective: 'Archived recovery',
        eventCount: 1,
        evidence: { verdict: 'VERIFIED', proof: 'Archived proof' },
        recoverySummary: { recoveryAction: 'Imported retry', attemptCount: 3 },
        timestamps: { completedAt: '2026-08-21T10:00:00.000Z' },
        recentEvents: [{ type: 'complete', timestamp: '2026-08-21T10:01:00.000Z' }],
      }],
      benchmark: {
        scorecard: { metrics: { correctCompletionRate: 0.75 } },
        baseline: { metrics: { correctCompletionRate: 0.5 } },
      },
    };
    const file = new File([JSON.stringify(imported)], 'comparison.json', { type: 'application/json' });
    const createObjectURL = vi.fn(() => 'blob:selected-comparison');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'مقارنة السجل المستورد' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'صيغة التصدير' }), { target: { value: 'json' } });
    fireEvent.click(screen.getByRole('button', { name: 'صدّر زوج التنفيذ الحالي والمستورد المحدد' }));

    const blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    const exported = JSON.parse(await blob.text()) as {
      exportType: string;
      live: Record<string, unknown>;
      imported: Record<string, unknown>;
      alignment: Record<string, Record<string, unknown>>;
    };
    expect(exported.exportType).toBe('mission-control-selected-comparison');
    expect(exported.live).toMatchObject({
      id: 'live-selected',
      state: 'BLOCKED',
      failureCategory: 'RATE_LIMIT',
      recoveryAction: 'Bounded retry',
      eventCount: 2,
      timeline: currentMissionControl.executions[0].recentEvents,
    });
    expect(exported.imported).toMatchObject({
      id: 'archived-selected',
      state: 'COMPLETED',
      recoveryAction: 'Imported retry',
      eventCount: 1,
    });
    expect(exported.alignment.states).toEqual({ live: 'BLOCKED', imported: 'COMPLETED' });
    expect(exported.alignment.eventCounts).toEqual({ live: 2, imported: 1 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:selected-comparison');
    expect(refetchMissionControl).not.toHaveBeenCalled();
  });

  it('exports both selected pair rows completely as CSV without refetching or mutating history', async () => {
    currentMissionControl = {
      ...missionControlFixture,
      executions: [{
        ...missionControlFixture.executions[0],
        id: 'live-selected',
        state: 'BLOCKED',
        objective: 'Repair the "auth", scope\ncheck',
        eventCount: 2,
        failureCategory: 'RATE_LIMIT',
        recoveryAction: 'Bounded, "safe" retry',
        evidenceStatus: 'INCOMPLETE',
        evidence: {
          verdict: 'PROVEN',
          reason: 'Evidence includes commas, "quotes",\nand a second line.',
        },
        recovery: { attempt: 2, provider: 'openrouter', note: 'Retry,\nthen verify' },
        timestamps: { startedAt: '2026-08-22T10:00:00.000Z' },
        recentEvents: [
          { type: 'provider_failure', timestamp: '2026-08-22T10:01:00.000Z', detail: 'Rate limited, "again"\nplease inspect' },
          { type: 'retry', timestamp: '2026-08-22T10:02:00.000Z', detail: 'Retry bounded' },
        ],
      }],
    };
    const imported = {
      executions: [{
        id: 'archived-selected',
        state: 'COMPLETED',
        objective: 'Archived recovery, "verified"\nfrom import',
        eventCount: 1,
        evidence: { verdict: 'VERIFIED', proof: 'Archived proof, "complete"\nwith details' },
        recoverySummary: { recoveryAction: 'Imported retry', attemptCount: 3 },
        timestamps: { completedAt: '2026-08-21T10:00:00.000Z' },
        recentEvents: [{ type: 'complete', timestamp: '2026-08-21T10:01:00.000Z', detail: 'Imported, "complete"\nwith evidence' }],
      }],
      benchmark: {
        scorecard: { metrics: { correctCompletionRate: 0.75 } },
        baseline: { metrics: { correctCompletionRate: 0.5 } },
      },
    };
    const file = new File([JSON.stringify(imported)], 'comparison.json', { type: 'application/json' });
    const createObjectURL = vi.fn(() => 'blob:selected-comparison-csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();
    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'مقارنة السجل المستورد' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'صيغة التصدير' }), { target: { value: 'csv' } });
    fireEvent.click(screen.getByRole('button', { name: 'صدّر زوج التنفيذ الحالي والمستورد المحدد' }));

    const blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const rows = parseCsv(await blob.text());
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.length === 17)).toBe(true);
    expect(rows[0]).toEqual([
      'الجهة', 'معرّف التنفيذ', 'الهدف', 'الحالة',
      'عدد المحاولات', 'إخفاقات التحقق', 'عدد الأحداث', 'فئة الإخفاق',
      'إجراء الاستعادة', 'حالة الأدلة', 'الأدلة', 'الاستعادة', 'الطوابع الزمنية', 'تسلسل الأحداث',
      'حالة التحقق التشغيلي', 'فحوصات التحقق التشغيلي', 'معرّفات إخفاق التحقق التشغيلي',
    ]);
    expect(rows[1]).toEqual([
      'live', 'live-selected', 'Repair the "auth", scope\ncheck', 'BLOCKED',
      '2', '1', '2', 'RATE_LIMIT', 'Bounded, "safe" retry', 'INCOMPLETE',
      JSON.stringify(currentMissionControl.executions[0].evidence),
      JSON.stringify({ attempt: 2, note: 'Retry,\nthen verify' }),
      JSON.stringify(currentMissionControl.executions[0].timestamps),
      JSON.stringify(currentMissionControl.executions[0].recentEvents),
      'passed',
      JSON.stringify(currentMissionControl.benchmark.releaseGate.runtimeOraclePreflight.checks),
      '[]',
    ]);
    expect(rows[2]).toEqual([
      'imported', 'archived-selected', 'Archived recovery, "verified"\nfrom import', 'COMPLETED',
      '0', '0', '1', 'Not categorized', 'Imported retry', 'VERIFIED',
      JSON.stringify(imported.executions[0].evidence),
      JSON.stringify(imported.executions[0].recoverySummary),
      JSON.stringify(imported.executions[0].timestamps),
      JSON.stringify(imported.executions[0].recentEvents),
      'Not recorded',
      'Not recorded',
      'Not recorded',
    ]);

    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:selected-comparison-csv');
    expect(await blob.text()).not.toContain('openrouter');
    expect(await blob.text()).not.toContain('openai/gpt-4.1-mini');
    expect(refetchMissionControl).not.toHaveBeenCalled();
    expect(currentMissionControl.executions).toHaveLength(1);
    expect(imported.executions).toHaveLength(1);

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('rejects JSON histories with missing nested benchmark metrics', async () => {
    renderPage();
    const file = new File([JSON.stringify({
      executions: [{ id: 'archived-execution', state: 'COMPLETED' }],
      benchmark: { scorecard: { metrics: {} }, baseline: { baselineId: 'missing-metrics' } },
    })], 'invalid-history.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('استيراد سجل الاستعادة بصيغة JSON'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('يجب أن تكون مقاييس خط الأساس كائنًا متداخلًا داخل بيانات القياس.');
    expect(screen.queryByRole('heading', { name: 'مقارنة السجل المستورد' })).not.toBeInTheDocument();
    expect(screen.getByText('Repair the auth scope check')).toBeInTheDocument();
  });
});
