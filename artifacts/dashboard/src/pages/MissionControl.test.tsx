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
    refetchMissionControl.mockReset();
  });

  it('shows execution state, operational metrics, evidence, and Flight Deck link', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Mission Control' })).toBeInTheDocument();
    expect(await screen.findByText('Repair the auth scope check')).toBeInTheDocument();
    expect(screen.getAllByText('READY FOR REVIEW').length).toBeGreaterThan(0);
    expect(screen.queryByText('openrouter / openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.queryByText('openrouter')).not.toBeInTheDocument();
    expect(screen.queryByText('openai/gpt-4.1-mini')).not.toBeInTheDocument();
    expect(screen.getByText('Validation failures: 1')).toBeInTheDocument();
    expect(screen.getByText('Validation')).toBeInTheDocument();
    expect(screen.getByText('Recorder evidence')).toBeInTheDocument();
    expect(screen.getByText('Deterministic release gate')).toBeInTheDocument();
    expect(screen.getByLabelText('Runtime oracle preflight')).toHaveTextContent('single-file-002');
    expect(screen.getByLabelText('Runtime oracle preflight')).toHaveTextContent('pnpm --dir lib/ai-orchestrator exec vitest run src/benchmark-scenarios/single-file-002.test.ts');
    expect(screen.getByLabelText('Runtime oracle preflight')).toHaveTextContent('passed');
    expect(screen.getByText('Empirical quality review')).toBeInTheDocument();
    expect(screen.getByText('Opt-in measurement only — never a release control.')).toBeInTheDocument();
    expect(screen.getByText('Corpus public-disposable-v1')).toBeInTheDocument();
    expect(screen.getByText('Validation and behavior proof accepted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Flight Deck/i })).toHaveAttribute(
      'href',
      '/flight-deck?executionId=execution-1',
    );
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

    const runtimeOracle = await screen.findByLabelText('Runtime oracle preflight');
    expect(screen.getByLabelText('Deterministic release gate')).toHaveTextContent('blocked');
    expect(runtimeOracle).toHaveTextContent('failed');
    expect(runtimeOracle).toHaveTextContent('test-failure-001');
    expect(runtimeOracle).toHaveTextContent('RUNTIME_ORACLE_FAILED');
    expect(runtimeOracle).toHaveTextContent('Failure identifiers');
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
    expect(screen.getAllByText('Attempts')).toHaveLength(2);
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchMissionControl).toHaveBeenCalledTimes(1);

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
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Historical provider recovery summaries')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Correct Completion Rate')).toBeInTheDocument();
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

    expect(await screen.findByText('10 of 10 runs')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–8 of 10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next history page' })).toBeEnabled();
    expect(screen.queryByText('Investigate the quota recovery path')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next history page' }));
    expect(screen.getByText('Showing 9–10 of 10')).toBeInTheDocument();
    expect(screen.getByText('Investigate the quota recovery path')).toBeInTheDocument();
    expect(screen.getByText('Failure: RATE_LIMIT')).toBeInTheDocument();
    expect(screen.getByText('Action: Switch provider')).toBeInTheDocument();
    expect(screen.getByText('Evidence: INCOMPLETE')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search execution history' }), {
      target: { value: 'quota' },
    });
    expect(screen.getByText('1 of 10 runs')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Investigate the quota recovery path')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter execution history by state' }), {
      target: { value: 'READY_FOR_REVIEW' },
    });
    expect(screen.getByText('No executions match this search or state filter.')).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search execution history' }), {
      target: { value: 'repair run' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered history' }));

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
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search execution history' }), {
      target: { value: 'included' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
      target: { value: 'json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered history' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered history' }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('"Runtime Oracle Status","Runtime Oracle Checks","Runtime Oracle Failure IDs"');
    expect(csv).toContain('"failed"');
    expect(csv).toContain('""scenarioId"":""test-failure-001""');
    expect(csv).toContain('""failureCode"":""RUNTIME_ORACLE_FAILED""');
    expect(csv).not.toContain('must not be exported');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mission-control-failed-oracle');

    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), {
      target: { value: 'json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export filtered history' }));
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

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search execution history' }), {
      target: { value: 'does-not-exist' },
    });

    const exportButton = screen.getByRole('button', { name: 'Export filtered history (no matching executions)' });
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Export format' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('There are no matching executions to export.');
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

    fireEvent.change(screen.getByLabelText('Import JSON recovery history'), { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'Imported history comparison' })).toBeInTheDocument();
    expect(screen.getByText('A read-only comparison. The live execution ledger has not been changed.')).toBeInTheDocument();
    expect(screen.getByText('Imported 1 executions from recovery-history.json.')).toBeInTheDocument();
    expect(screen.getByText(/Imported executions: archived-execution/)).toBeInTheDocument();
    expect(screen.getAllByText('Live history')).toHaveLength(1);
    expect(screen.getAllByText('Imported history')).toHaveLength(1);
    expect(screen.queryByText('archived-suite')).not.toBeInTheDocument();
    expect(screen.getAllByText('Correct Completion Rate')).toHaveLength(3);
    expect(screen.getByText('0.75')).toBeInTheDocument();
    expect(screen.getByText('base 0.50')).toBeInTheDocument();
    expect(screen.getByText('Repair the auth scope check')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Import JSON recovery history'), { target: { files: [file] } });

    expect(await screen.findByTestId('comparison-run-live-run')).toHaveTextContent('execution-1');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('archived-1');
    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('3 total');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('2 total');

    fireEvent.change(screen.getByRole('combobox', { name: 'Select live run for comparison' }), { target: { value: 'execution-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select imported run for comparison' }), { target: { value: 'archived-2' } });

    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('execution-2');
    expect(screen.getByTestId('comparison-run-live-run')).toHaveTextContent('Escalate to operator');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('archived-2');
    expect(screen.getByTestId('comparison-run-imported-run')).toHaveTextContent('5 total');
    expect(screen.getByText(/Imported executions: archived-1, archived-2/)).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Import JSON recovery history'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Imported history comparison' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), { target: { value: 'json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export selected live and imported run pair' }));

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
    fireEvent.change(screen.getByLabelText('Import JSON recovery history'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Imported history comparison' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export format' }), { target: { value: 'csv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export selected live and imported run pair' }));

    const blob = createObjectURL.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const rows = parseCsv(await blob.text());
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.length === 17)).toBe(true);
    expect(rows[0]).toEqual([
      'Side', 'Execution ID', 'Objective', 'State',
      'Attempts', 'Validation Failures', 'Event Count', 'Failure Category',
      'Recovery Action', 'Evidence Status', 'Evidence', 'Recovery', 'Timestamps', 'Event Timeline',
      'Runtime Oracle Status', 'Runtime Oracle Checks', 'Runtime Oracle Failure IDs',
    ]);
    expect(rows[1]).toEqual([
      'live', 'live-selected', 'Repair the "auth", scope\ncheck', 'BLOCKED',
      '2', '1', '2', 'RATE_LIMIT', 'Bounded, "safe" retry', 'INCOMPLETE',
      JSON.stringify(currentMissionControl.executions[0].evidence),
      JSON.stringify(currentMissionControl.executions[0].recovery),
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

    fireEvent.change(screen.getByLabelText('Import JSON recovery history'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Benchmark baseline.metrics must be a nested object.');
    expect(screen.queryByRole('heading', { name: 'Imported history comparison' })).not.toBeInTheDocument();
    expect(screen.getByText('Repair the auth scope check')).toBeInTheDocument();
  });
});
