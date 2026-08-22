import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Cpu,
  ExternalLink,
  Gauge,
  GitBranch,
  History,
  Layers3,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import { Link } from 'wouter';
import { useGetAiMissionControl } from '@workspace/api-client-react';
import type { AiMissionControl } from '@workspace/api-client-react';

type JsonRecord = Record<string, unknown>;

type MissionExecution = {
  id: string;
  state?: unknown;
  objective?: unknown;
  provider?: unknown;
  model?: unknown;
  attempts?: unknown;
  validationFailures?: unknown;
  evidence?: unknown;
  timestamps?: unknown;
  checkpointVersion?: unknown;
  eventCount?: unknown;
  recentEvents?: unknown;
};

type MetricEntry = {
  key: string;
  label: string;
  value: string;
  numericValue?: number;
};

const COMPLETE_STATES = new Set(['READY_FOR_REVIEW', 'COMPLETED', 'COMMITTED', 'PUSHED', 'APPLIED']);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asExecutions(value: unknown): MissionExecution[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MissionExecution => {
    const record = asRecord(item);
    return Boolean(record && typeof record.id === 'string');
  });
}

function textValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function formatKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value || 'Not recorded';
  if (Array.isArray(value)) return value.length ? `${value.length} recorded` : 'None recorded';
  const object = asRecord(value);
  if (object) {
    const preferred = textValue(object.summary, object.message, object.description, object.value, object.verdict);
    if (preferred) return preferred;
    try {
      return JSON.stringify(value);
    } catch {
      return 'Structured evidence';
    }
  }
  return String(value);
}

function formatDate(value: unknown): string | undefined {
  const raw = textValue(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProviderRecoverySummary({ value }: { value: unknown }) {
  const summary = asRecord(value);
  if (!summary) return null;
  const model = textValue(summary.model) ?? 'Model not recorded';
  const category = textValue(summary.failureCategory) ?? 'Not categorized';
  const action = textValue(summary.recoveryAction) ?? 'No recovery action';
  const evidence = textValue(summary.evidenceStatus) ?? 'Not recorded';
  const attempts = numberValue(summary.attemptCount);
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-200" />
        <span className="text-sm font-semibold">Provider recovery</span>
        <span className="ml-auto rounded-full border border-amber-500/35 px-1.5 py-0.5 text-[10px] uppercase text-amber-200">
          {evidence}
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><div className="text-muted-foreground">Provider / model</div><div className="mt-0.5 font-medium">{textValue(summary.provider) ?? 'Provider not recorded'} · {model}</div></div>
        <div><div className="text-muted-foreground">Failure category</div><div className="mt-0.5 font-medium">{category}</div></div>
        <div><div className="text-muted-foreground">Recovery action</div><div className="mt-0.5 font-medium">{action}</div></div>
        <div><div className="text-muted-foreground">Attempts</div><div className="mt-0.5 font-medium">{attempts ?? 'Not recorded'}</div></div>
      </div>
    </div>
  );
}

function objectiveText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  const object = asRecord(value);
  if (!object) return 'Objective not recorded';
  return textValue(object.objective, object.description, object.title, object.type)
    ?? 'Declared engineering objective';
}

function stateText(state: unknown): string {
  return (textValue(state) ?? 'UNKNOWN').replace(/_/g, ' ');
}

function stateTone(state: unknown): string {
  const normalized = textValue(state)?.toUpperCase();
  if (normalized === 'BLOCKED' || normalized === 'FAILED') {
    return 'border-red-500/35 bg-red-500/10 text-red-200';
  }
  if (normalized === 'CANCELLED') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  }
  if (normalized && COMPLETE_STATES.has(normalized)) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-primary/35 bg-primary/10 text-primary';
}

function EvidenceIcon({ evidence }: { evidence: unknown }) {
  const verdict = asRecord(evidence)?.verdict;
  const normalized = textValue(verdict)?.toUpperCase();
  if (normalized === 'PROVEN' || normalized === 'PASSED' || normalized === 'VERIFIED') {
    return <ShieldCheck className="h-4 w-4 text-emerald-300" />;
  }
  if (normalized === 'BLOCKED' || normalized === 'FAILED') {
    return <XCircle className="h-4 w-4 text-red-300" />;
  }
  return <CircleDashed className="h-4 w-4 text-amber-300" />;
}

function evidenceTone(evidence: unknown): string {
  const verdict = textValue(asRecord(evidence)?.verdict)?.toUpperCase();
  if (verdict === 'PROVEN' || verdict === 'PASSED' || verdict === 'VERIFIED') {
    return 'text-emerald-200';
  }
  if (verdict === 'BLOCKED' || verdict === 'FAILED') return 'text-red-200';
  return 'text-amber-200';
}

function evidenceRows(evidence: unknown): Array<{ label: string; value: string }> {
  if (typeof evidence === 'string') return [{ label: 'Recorder note', value: evidence }];
  const record = asRecord(evidence);
  if (!record) return [];
  const preferredKeys = ['verdict', 'summary', 'reason', 'recorder', 'checks', 'artifacts', 'proof', 'capturedAt'];
  const keys = preferredKeys.filter((key) => key in record);
  const remaining = Object.keys(record).filter((key) => !keys.includes(key)).slice(0, 4);
  return [...keys, ...remaining].map((key) => ({
    label: formatKey(key),
    value: key === 'capturedAt' ? (formatDate(record[key]) ?? formatValue(record[key])) : formatValue(record[key]),
  }));
}

function metricEntries(value: unknown, prefix = '', depth = 0): MetricEntry[] {
  const record = asRecord(value);
  if (!record || depth > 2) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    if (entry === null || entry === undefined || typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
      const numericValue = numberValue(entry);
      return [{
        key: prefix ? `${prefix}.${key}` : key,
        label: formatKey(prefix ? `${prefix} ${key}` : key),
        value: formatValue(entry),
        ...(numericValue === undefined ? {} : { numericValue }),
      }];
    }
    return metricEntries(entry, prefix ? `${prefix} ${key}` : key, depth + 1);
  });
}

function eventParts(event: unknown): { title: string; detail?: string; time?: string } {
  if (typeof event === 'string') return { title: event };
  const record = asRecord(event);
  if (!record) return { title: formatValue(event) };
  return {
    title: textValue(record.type, record.event, record.kind, record.name, record.state, record.message) ?? 'Recorded event',
    detail: textValue(record.message, record.detail, record.description),
    time: formatDate(record.timestamp ?? record.createdAt ?? record.at),
  };
}

function SummaryMetric({
  label,
  value,
  detail,
  icon,
  tone = 'text-foreground',
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/25 p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function MissionSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading mission control" aria-busy="true">
      <div className="h-5 w-44 animate-pulse rounded bg-secondary/70" />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="h-8 w-2/3 animate-pulse rounded bg-secondary/70" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-secondary/50" />
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-secondary/45" />)}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}

export default function MissionControl() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, error, isError, isLoading, isFetching, refetch } = useGetAiMissionControl({
    query: {
      queryKey: ['ai-mission-control'],
      staleTime: 15_000,
      retry: false,
    },
  });

  const typedData = data as AiMissionControl | undefined;
  const executions = useMemo(() => asExecutions(typedData?.executions), [typedData?.executions]);
  const selectedExecution = executions.find((execution) => execution.id === selectedId) ?? executions[0];
  const completedCount = executions.filter((execution) => COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? '')).length;
  const remainingCount = Math.max(0, executions.length - completedCount);
  const scorecardMetrics = useMemo(
    () => metricEntries(asRecord(typedData?.benchmark?.scorecard)?.metrics),
    [typedData?.benchmark?.scorecard],
  );
  const baselineMetrics = useMemo(
    () => metricEntries(asRecord(typedData?.benchmark?.baseline)?.metrics),
    [typedData?.benchmark?.baseline],
  );
  const baselineByKey = useMemo(() => new Map(baselineMetrics.map((metric) => [metric.key, metric])), [baselineMetrics]);
  const recoverySummaries = useMemo(() => {
    const envelope = asRecord(asRecord(typedData?.benchmark)?.freeTierEnvelope);
    return Array.isArray(envelope?.providerRecoverySummaries)
      ? envelope.providerRecoverySummaries
      : [];
  }, [typedData?.benchmark]);
  const selectedEvidenceRows = evidenceRows(selectedExecution?.evidence);
  const selectedEvents = Array.isArray(selectedExecution?.recentEvents) ? selectedExecution.recentEvents : [];
  const updatedLabel = formatDate(typedData?.updatedAt);

  if (isLoading) return <MissionSkeleton />;

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-red-500/30 bg-red-500/5 p-7 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-300" />
        <h1 className="mt-4 text-lg font-semibold">Mission control is offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The durable run ledger could not be read. No execution state is being inferred locally.
        </p>
        <p className="mt-3 font-mono text-[11px] text-red-200/80">{error instanceof Error ? error.message : 'Request failed'}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover-elevate"
        >
          <RefreshCw className="h-4 w-4" /> Retry read
        </button>
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-primary" />
          <span>EngineeringOS</span><span>/</span><span className="text-foreground">Mission Control</span>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-card/70 px-6 py-16 text-center">
          <Layers3 className="mx-auto h-9 w-9 text-primary/80" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">No durable runs in the ledger</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            New AI executions will appear here once their server-owned checkpoints and recorder events exist.
          </p>
          <Link href="/ai" className="mt-6 inline-flex items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover-elevate">
            Open AI Assistant <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 text-primary" />
            <span>EngineeringOS</span><span>/</span><span className="text-foreground">Mission Control</span>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <div className="mt-1 rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-primary">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mission Control</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                A readable ledger for AI delivery runs — state, repair, validation, and recorder proof in one calm view.
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {updatedLabel && <span className="hidden text-[11px] text-muted-foreground sm:block">Updated {updatedLabel}</span>}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover-elevate disabled:opacity-60"
            title="Refresh mission control"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <section className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Zap className="h-3.5 w-3.5" /> Delivery run posture
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {completedCount} complete <span className="px-1 text-border">/</span> {remainingCount} remaining
              <span className="px-1 text-border">·</span> {executions.length} recorded execution{executions.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[540px]">
            <SummaryMetric label="Completed" value={String(completedCount)} detail="terminal delivery states" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />} tone="text-emerald-200" />
            <SummaryMetric label="Remaining" value={String(remainingCount)} detail="active or unresolved" icon={<Clock3 className="h-3.5 w-3.5 text-primary" />} tone="text-primary" />
            <SummaryMetric label="Validation" value={String(executions.reduce((total, execution) => total + (numberValue(execution.validationFailures) ?? 0), 0))} detail="failures across ledger" icon={<ShieldCheck className="h-3.5 w-3.5 text-amber-300" />} tone="text-amber-200" />
            <SummaryMetric label="Events" value={String(executions.reduce((total, execution) => total + (numberValue(execution.eventCount) ?? 0), 0))} detail="server-recorded events" icon={<History className="h-3.5 w-3.5 text-primary" />} />
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5">
            <div>
              <h2 className="font-semibold">Execution ledger</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Select a run to inspect its recorder output.</p>
            </div>
            <span className="rounded-full border border-border/70 bg-background/35 px-2 py-1 font-mono text-[10px] text-muted-foreground">{executions.length} runs</span>
          </div>
          <div className="divide-y divide-border/60">
            {executions.map((execution) => {
              const isSelected = selectedExecution?.id === execution.id;
              const evidence = asRecord(execution.evidence);
              const eventCount = numberValue(execution.eventCount) ?? (Array.isArray(execution.recentEvents) ? execution.recentEvents.length : 0);
              return (
                <button
                  type="button"
                  key={execution.id}
                  onClick={() => setSelectedId(execution.id)}
                  className={`block w-full text-left transition-colors hover:bg-secondary/35 ${isSelected ? 'bg-primary/[0.06]' : ''}`}
                  aria-pressed={isSelected}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${stateTone(execution.state)}`}>
                        {COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? '') ? <CheckCircle2 className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] text-primary">{execution.id}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateTone(execution.state)}`}>{stateText(execution.state)}</span>
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-foreground">{objectiveText(execution.objective)}</h3>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3 text-primary/80" />{textValue(execution.provider) ?? 'Provider not recorded'} / {textValue(execution.model) ?? 'model not recorded'}</span>
                          <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3 text-amber-300/80" />{numberValue(execution.attempts) ?? 0} repair attempts</span>
                          <span className="inline-flex items-center gap-1"><TerminalSquare className="h-3 w-3 text-muted-foreground" />{eventCount} events</span>
                        </div>
                      </div>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-[10px]">
                      <span className={`inline-flex items-center gap-1 ${evidenceTone(execution.evidence)}`}>
                        <EvidenceIcon evidence={execution.evidence} />
                        Evidence: {textValue(evidence?.verdict) ?? (execution.evidence ? 'Recorded' : 'Not recorded')}
                      </span>
                      <span className="text-muted-foreground">Validation failures: {numberValue(execution.validationFailures) ?? 0}</span>
                      <Link
                        href={`/flight-deck?executionId=${encodeURIComponent(execution.id)}`}
                        onClick={(event) => event.stopPropagation()}
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        Open Flight Deck <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="min-w-0 space-y-5">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border/70 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Recorder evidence</h2>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selectedExecution ? `Readable proof for ${selectedExecution.id}` : 'Select an execution'}
              </p>
            </div>
            <div className="p-4">
              {!selectedExecution?.evidence ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
                  No recorder evidence was returned for this execution.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
                    <EvidenceIcon evidence={selectedExecution.evidence} />
                    <span className={`text-sm font-semibold ${evidenceTone(selectedExecution.evidence)}`}>
                      {textValue(asRecord(selectedExecution.evidence)?.verdict) ?? 'Evidence recorded'}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">checkpoint v{formatValue(selectedExecution.checkpointVersion)}</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {selectedEvidenceRows.map((row) => (
                      <div key={row.label} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</div>
                        <div className="mt-1 break-words text-xs leading-5 text-foreground/90">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3.5">
              <GitBranch className="h-4 w-4 text-primary" />
              <div>
                <h2 className="font-semibold">Baseline comparison</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Benchmark values as returned by the server.</p>
              </div>
            </div>
            <div className="p-4">
              {recoverySummaries.length > 0 && (
                <div className="mb-4 space-y-2" aria-label="Historical provider recovery summaries">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Historical report recovery details
                  </div>
                  {recoverySummaries.map((summary, index) => (
                    <ProviderRecoverySummary key={index} value={summary} />
                  ))}
                </div>
              )}
              {scorecardMetrics.length === 0 && baselineMetrics.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">No benchmark metrics were returned.</p>
              ) : (
                <div className="space-y-1.5">
                  {scorecardMetrics.slice(0, 8).map((metric) => {
                    const baseline = baselineByKey.get(metric.key);
                    const delta = metric.numericValue !== undefined && baseline?.numericValue !== undefined
                      ? metric.numericValue - baseline.numericValue
                      : undefined;
                    return (
                      <div key={metric.key} className="flex items-center gap-3 rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{metric.label}</span>
                        <span className="font-mono text-xs text-foreground">{metric.value}</span>
                        <span className="w-20 text-right font-mono text-[10px] text-muted-foreground">
                          {baseline ? `base ${baseline.value}` : 'no baseline'}
                        </span>
                        {delta !== undefined && (
                          <span className={`w-12 text-right font-mono text-[10px] ${delta >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
                            {delta >= 0 ? '+' : ''}{formatValue(delta)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {scorecardMetrics.length === 0 && <p className="text-xs text-muted-foreground">Scorecard metrics not recorded; baseline data is present.</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <div>
              <h2 className="font-semibold">Recent recorder events</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{selectedExecution?.id ?? 'No execution selected'} · server-owned event stream</p>
            </div>
          </div>
          {selectedExecution && (
            <Link href={`/flight-deck?executionId=${encodeURIComponent(selectedExecution.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              Inspect full run <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        <div className="p-4">
          {selectedEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-6 text-center text-xs text-muted-foreground">
              No recent events were returned for this execution.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {selectedEvents.slice(0, 12).map((event, index) => {
                const parts = eventParts(event);
                return (
                  <div key={`${parts.title}-${parts.time ?? index}`} className="flex gap-3 rounded-md border border-border/55 bg-background/20 px-3 py-2.5">
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <span className="text-xs font-medium text-foreground">{parts.title}</span>
                        {parts.time && <span className="font-mono text-[10px] text-muted-foreground">{parts.time}</span>}
                      </div>
                      {parts.detail && parts.detail !== parts.title && <p className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{parts.detail}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}