import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cpu,
  Download,
  ExternalLink,
  FileUp,
  Gauge,
  GitBranch,
  History,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Search,
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
  recovery?: unknown;
  recoverySummary?: unknown;
  failureCategory?: unknown;
  recoveryAction?: unknown;
  evidenceStatus?: unknown;
  operationId?: unknown;
  revision?: unknown;
  evidenceProjection?: unknown;
};

type MetricEntry = {
  key: string;
  label: string;
  value: string;
  numericValue?: number;
};

type HistorySnapshot = {
  executions: MissionExecution[];
  benchmark: JsonRecord;
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

function validateHistorySnapshot(value: unknown): { snapshot?: HistorySnapshot; error?: string } {
  const root = asRecord(value);
  if (!root) return { error: 'The file must contain a JSON object.' };
  if (!Array.isArray(root.executions) || root.executions.length === 0) {
    return { error: 'The JSON must contain a non-empty executions array.' };
  }
  const invalidExecutionIndex = root.executions.findIndex((execution) => {
    const record = asRecord(execution);
    return !record || typeof record.id !== 'string' || !record.id.trim();
  });
  if (invalidExecutionIndex >= 0) {
    return { error: `Execution ${invalidExecutionIndex + 1} must be an object with a non-empty string id.` };
  }
  const benchmark = asRecord(root.benchmark);
  if (!benchmark) return { error: 'The JSON must contain a benchmark object.' };
  const scorecard = asRecord(benchmark.scorecard);
  const baseline = asRecord(benchmark.baseline);
  if (!scorecard || !asRecord(scorecard.metrics)) {
    return { error: 'Benchmark scorecard.metrics must be a nested object.' };
  }
  if (!baseline || !asRecord(baseline.metrics)) {
    return { error: 'Benchmark baseline.metrics must be a nested object.' };
  }
  return { snapshot: { executions: asExecutions(root.executions), benchmark } };
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

function ComparisonRunColumn({
  label,
  execution,
}: {
  label: string;
  execution: MissionExecution | undefined;
}) {
  if (!execution) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
        No run selected.
      </div>
    );
  }

  const evidence = asRecord(execution.evidence);
  const evidenceStatus = textValue(asRecord(execution.evidenceProjection)?.completeness)
    ?? recoveryDetail(execution, 'evidenceStatus')
    ?? textValue(evidence?.verdict);
  const failureCategory = recoveryDetail(execution, 'failureCategory');
  const recoveryAction = recoveryDetail(execution, 'recoveryAction');
  const events = Array.isArray(execution.recentEvents) ? execution.recentEvents : [];
  const eventCount = numberValue(execution.eventCount) ?? events.length;
  const evidenceRowsForRun = evidenceRows(execution.evidence);
  const details = [
    ['State', stateText(execution.state)],
    ['Provider / model', `${textValue(execution.provider) ?? 'Not recorded'} / ${textValue(execution.model) ?? 'Not recorded'}`],
    ['Attempts', formatValue(execution.attempts ?? 0)],
    ['Validation failures', formatValue(execution.validationFailures ?? 0)],
    ['Event count', String(eventCount)],
    ['Failure category', failureCategory ?? 'Not categorized'],
    ['Recovery action', recoveryAction ?? 'No recovery action'],
    ['Evidence completeness', evidenceStatus ?? 'Not recorded'],
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-background/20 p-3" data-testid={`comparison-run-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</div>
          <div className="mt-1 break-all font-mono text-xs text-foreground">{execution.id}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateTone(execution.state)}`}>
          {stateText(execution.state)}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5">
        {details.map(([detailLabel, value]) => (
          <div key={detailLabel} className="grid grid-cols-[minmax(105px,0.75fr)_minmax(0,1.25fr)] gap-3 rounded-md border border-border/45 px-2.5 py-2 text-[11px]">
            <span className="text-muted-foreground">{detailLabel}</span>
            <span className="break-words text-right font-medium text-foreground">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border/45 px-2.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Evidence
          <span className={`ml-auto ${evidenceTone(execution.evidence)}`}>{evidenceStatus ?? (evidence ? 'Recorded' : 'Not recorded')}</span>
        </div>
        {evidenceRowsForRun.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {evidenceRowsForRun.slice(0, 4).map((row) => (
              <div key={row.label} className="text-[11px]">
                <span className="text-muted-foreground">{row.label}: </span>
                <span className="break-words text-foreground/90">{row.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">No recorder evidence returned.</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border/45 px-2.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="h-3.5 w-3.5 text-primary" /> Event timeline
          <span className="ml-auto font-mono text-foreground">{eventCount} total</span>
        </div>
        {events.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {events.slice(0, 6).map((event, index) => {
              const parts = eventParts(event);
              return (
                <div key={`${parts.title}-${parts.time ?? index}`} className="flex gap-2 text-[11px]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{parts.title}</span>
                    {parts.time && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{parts.time}</span>}
                    {parts.detail && parts.detail !== parts.title && <div className="break-words text-muted-foreground">{parts.detail}</div>}
                  </div>
                </div>
              );
            })}
            {events.length > 6 && <p className="text-[10px] text-muted-foreground">Showing 6 of {events.length} returned events.</p>}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">No timeline events returned.</p>
        )}
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

function recoveryDetail(execution: MissionExecution, key: string): string | undefined {
  const sources = [
    asRecord(execution.recoverySummary),
    asRecord(execution.recovery),
    execution as unknown as JsonRecord,
    asRecord(execution.evidence),
  ];
  for (const source of sources) {
    const value = source?.[key];
    const result = textValue(value);
    if (result) return result;
  }
  return undefined;
}

function csvCell(value: unknown): string {
  return `"${formatValue(value).replace(/"/g, '""')}"`;
}

type HistoryExportFormat = 'csv' | 'json';

function downloadFilteredHistory(
  executions: MissionExecution[],
  benchmark: unknown,
  format: HistoryExportFormat,
): void {
  if (executions.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const json = JSON.stringify({ executions, benchmark }, null, 2);
    const blob = new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mission-control-history-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const benchmarkRecord = asRecord(benchmark);
  const scorecard = asRecord(benchmarkRecord?.scorecard);
  const baseline = asRecord(benchmarkRecord?.baseline);
  const serialize = (value: unknown) => {
    if (!value) return 'Not recorded';
    try {
      return JSON.stringify(value);
    } catch {
      return formatValue(value);
    }
  };
  const benchmarkSuite = textValue(scorecard?.suiteVersion, benchmarkRecord?.suiteVersion) ?? 'Not recorded';
  const benchmarkBaselineId = textValue(baseline?.baselineId, benchmarkRecord?.baselineId) ?? 'Not recorded';
  const benchmarkScorecard = serialize(scorecard?.metrics);
  const benchmarkBaseline = serialize(baseline?.metrics);
  const headers = [
    'Execution ID', 'Objective', 'State', 'Provider', 'Model',
    'Failure Category', 'Recovery Action', 'Evidence Status', 'Attempts',
    'Benchmark Suite Version', 'Benchmark Baseline ID', 'Benchmark Scorecard', 'Benchmark Baseline Metrics',
  ];
  const rows = executions.map((execution) => [
    execution.id,
    objectiveText(execution.objective),
    stateText(execution.state),
    textValue(execution.provider) ?? 'Not recorded',
    textValue(execution.model) ?? 'Not recorded',
    recoveryDetail(execution, 'failureCategory') ?? 'Not categorized',
    recoveryDetail(execution, 'recoveryAction') ?? 'No recovery action',
    recoveryDetail(execution, 'evidenceStatus')
      ?? textValue(asRecord(execution.evidence)?.verdict)
      ?? (execution.evidence ? 'Recorded' : 'Not recorded'),
    numberValue(execution.attempts) ?? 0,
    benchmarkSuite,
    benchmarkBaselineId,
    benchmarkScorecard,
    benchmarkBaseline,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mission-control-history-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function comparisonExportRow(label: 'live' | 'imported', execution: MissionExecution): JsonRecord {
  const events = Array.isArray(execution.recentEvents) ? execution.recentEvents : [];
  return {
    side: label,
    id: execution.id,
    objective: objectiveText(execution.objective),
    state: stateText(execution.state),
    provider: textValue(execution.provider) ?? 'Not recorded',
    model: textValue(execution.model) ?? 'Not recorded',
    attempts: numberValue(execution.attempts) ?? 0,
    validationFailures: numberValue(execution.validationFailures) ?? 0,
    eventCount: numberValue(execution.eventCount) ?? events.length,
    failureCategory: recoveryDetail(execution, 'failureCategory') ?? 'Not categorized',
    recoveryAction: recoveryDetail(execution, 'recoveryAction') ?? 'No recovery action',
    evidenceStatus: recoveryDetail(execution, 'evidenceStatus')
      ?? textValue(asRecord(execution.evidence)?.verdict)
      ?? (execution.evidence ? 'Recorded' : 'Not recorded'),
    evidence: execution.evidence ?? null,
    recovery: execution.recovery ?? execution.recoverySummary ?? null,
    timestamps: execution.timestamps ?? null,
    timeline: events,
  };
}

function downloadComparisonPair(
  liveExecution: MissionExecution | undefined,
  importedExecution: MissionExecution | undefined,
  format: HistoryExportFormat,
): void {
  if (!liveExecution || !importedExecution) return;
  const live = comparisonExportRow('live', liveExecution);
  const imported = comparisonExportRow('imported', importedExecution);
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const json = JSON.stringify({
      exportType: 'mission-control-selected-comparison',
      exportedAt: new Date().toISOString(),
      live,
      imported,
      alignment: {
        evidence: { live: live.evidence, imported: imported.evidence },
        recovery: { live: live.recovery, imported: imported.recovery },
        states: { live: live.state, imported: imported.state },
        eventCounts: { live: live.eventCount, imported: imported.eventCount },
        timelines: { live: live.timeline, imported: imported.timeline },
      },
    }, null, 2);
    const blob = new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mission-control-comparison-${live.id}-${imported.id}-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const headers = [
    'Side', 'Execution ID', 'Objective', 'State', 'Provider', 'Model',
    'Attempts', 'Validation Failures', 'Event Count', 'Failure Category',
    'Recovery Action', 'Evidence Status', 'Evidence', 'Recovery', 'Timestamps', 'Event Timeline',
  ];
  const rows = [live, imported].map((row) => [
    row.side, row.id, row.objective, row.state, row.provider, row.model,
    row.attempts, row.validationFailures, row.eventCount, row.failureCategory,
    row.recoveryAction, row.evidenceStatus, row.evidence, row.recovery,
    row.timestamps, row.timeline,
  ]);
  const serialize = (value: unknown) => {
    if (value === null || value === undefined) return 'Not recorded';
    try {
      return JSON.stringify(value);
    } catch {
      return formatValue(value);
    }
  };
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map((value, index) => csvCell(index >= 12 ? serialize(value) : value)).join(',')),
  ].join('\r\n');
  const blob = new Blob([`${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mission-control-comparison-${live.id}-${imported.id}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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
  const [comparisonLiveId, setComparisonLiveId] = useState<string | null>(null);
  const [comparisonImportedId, setComparisonImportedId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyState, setHistoryState] = useState('ALL');
  const [historyExportFormat, setHistoryExportFormat] = useState<HistoryExportFormat>('csv');
  const [historyPage, setHistoryPage] = useState(1);
  const [importedHistory, setImportedHistory] = useState<HistorySnapshot | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const historyPageSize = 8;
  const { data, error, isError, isLoading, isFetching, refetch } = useGetAiMissionControl({
    query: {
      queryKey: ['ai-mission-control'],
      staleTime: 15_000,
      retry: false,
    },
  });

  const typedData = data as AiMissionControl | undefined;
  const executions = useMemo(() => asExecutions(typedData?.executions), [typedData?.executions]);
  const filteredExecutions = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return executions.filter((execution) => {
      const state = textValue(execution.state)?.toUpperCase() ?? 'UNKNOWN';
      if (historyState !== 'ALL' && state !== historyState) return false;
      if (!query) return true;
      const searchable = [
        execution.id,
        objectiveText(execution.objective),
        execution.provider,
        execution.model,
        recoveryDetail(execution, 'failureCategory'),
        recoveryDetail(execution, 'recoveryAction'),
        recoveryDetail(execution, 'evidenceStatus'),
        execution.evidence,
      ].map(formatValue).join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [executions, historyQuery, historyState]);
  const historyPageCount = Math.max(1, Math.ceil(filteredExecutions.length / historyPageSize));
  const visibleExecutions = filteredExecutions.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );
  const selectedExecution = executions.find((execution) => execution.id === selectedId) ?? executions[0];
  const comparisonLiveExecution = executions.find((execution) => execution.id === comparisonLiveId) ?? executions[0];
  const historyStates = useMemo(
    () => Array.from(new Set(executions.map((execution) => textValue(execution.state)?.toUpperCase() ?? 'UNKNOWN'))),
    [executions],
  );
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
  const importedScorecardMetrics = useMemo(
    () => metricEntries(asRecord(importedHistory?.benchmark.scorecard)?.metrics),
    [importedHistory],
  );
  const importedBaselineMetrics = useMemo(
    () => metricEntries(asRecord(importedHistory?.benchmark.baseline)?.metrics),
    [importedHistory],
  );
  const importedCompletedCount = importedHistory?.executions.filter(
    (execution) => COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? ''),
  ).length ?? 0;
  const importedValidationFailures = importedHistory?.executions.reduce(
    (total, execution) => total + (numberValue(execution.validationFailures) ?? 0),
    0,
  ) ?? 0;
  const importedBaselineByKey = useMemo(
    () => new Map(importedBaselineMetrics.map((metric) => [metric.key, metric])),
    [importedBaselineMetrics],
  );
  const recoverySummaries = useMemo(() => {
    const envelope = asRecord(asRecord(typedData?.benchmark)?.freeTierEnvelope);
    return Array.isArray(envelope?.providerRecoverySummaries)
      ? envelope.providerRecoverySummaries
      : [];
  }, [typedData?.benchmark]);
  const acceptanceSummary = useMemo(
    () => asRecord(asRecord(typedData?.benchmark)?.autonomousDeliveryAcceptance),
    [typedData?.benchmark],
  );
  const acceptanceMetrics = asRecord(acceptanceSummary?.metrics);
  const acceptanceOperations = Array.isArray(acceptanceSummary?.operations)
    ? acceptanceSummary.operations
    : [];
  const selectedEvidenceRows = evidenceRows(selectedExecution?.evidence);
  const selectedEvents = Array.isArray(selectedExecution?.recentEvents) ? selectedExecution.recentEvents : [];
  const selectedImportedExecution = importedHistory?.executions.find((execution) => execution.id === comparisonImportedId)
    ?? importedHistory?.executions[0];
  const updatedLabel = formatDate(typedData?.updatedAt);

  async function handleHistoryImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    setImportError(null);
    setImportStatus(null);
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateHistorySnapshot(parsed);
      if (result.error) {
        setImportError(result.error);
        return;
      }
      setImportedHistory(result.snapshot ?? null);
      setComparisonImportedId(result.snapshot?.executions[0]?.id ?? null);
      setImportStatus(`Imported ${result.snapshot?.executions.length ?? 0} executions from ${file.name}.`);
    } catch {
      setImportError('This file is not valid JSON. Choose a JSON history exported from Mission Control.');
    }
  }

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
  }, [historyPage, historyPageCount]);

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

  if (executions.length === 0 && !importedHistory) {
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
           <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover-elevate">
             <FileUp className="h-4 w-4" /> Import JSON history
             <input
               type="file"
               accept="application/json,.json"
               onChange={(event) => void handleHistoryImport(event)}
               aria-label="Import JSON recovery history"
               className="sr-only"
             />
           </label>
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
           <div className="border-b border-border/70 px-4 py-3.5">
             <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Execution ledger</h2>
               <p className="mt-0.5 text-[11px] text-muted-foreground">Scan the persisted history, then select a run to inspect its recorder output.</p>
            </div>
             <span className="rounded-full border border-border/70 bg-background/35 px-2 py-1 font-mono text-[10px] text-muted-foreground">{filteredExecutions.length} of {executions.length} runs</span>
             </div>
             <div className="mt-3 flex flex-col gap-2 sm:flex-row">
               <label className="relative min-w-0 flex-1">
                 <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                 <input
                   type="search"
                   value={historyQuery}
                   onChange={(event) => { setHistoryQuery(event.target.value); setHistoryPage(1); }}
                   placeholder="Search ID, objective, provider, model, failure, action…"
                   aria-label="Search execution history"
                   className="h-8 w-full rounded-md border border-border bg-background/50 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                 />
               </label>
               <select
                 value={historyState}
                 onChange={(event) => { setHistoryState(event.target.value); setHistoryPage(1); }}
                 aria-label="Filter execution history by state"
                 className="h-8 rounded-md border border-border bg-background/50 px-2 text-xs text-foreground outline-none focus:border-primary/60"
               >
                 <option value="ALL">All states</option>
                 {historyStates.map((state) => <option key={state} value={state}>{state.replace(/_/g, ' ')}</option>)}
               </select>
               <label className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2 text-[11px] text-muted-foreground">
                 <span>Format</span>
                 <select
                   value={historyExportFormat}
                   onChange={(event) => setHistoryExportFormat(event.target.value as HistoryExportFormat)}
                   aria-label="Export format"
                   className="h-7 bg-transparent text-xs font-semibold text-foreground outline-none"
                 >
                   <option value="csv">CSV</option>
                   <option value="json">JSON</option>
                 </select>
               </label>
               <button
                 type="button"
                 onClick={() => downloadFilteredHistory(filteredExecutions, typedData?.benchmark, historyExportFormat)}
                 disabled={filteredExecutions.length === 0}
                 aria-label={filteredExecutions.length === 0 ? 'Export filtered history (no matching executions)' : 'Export filtered history'}
                 title={filteredExecutions.length === 0 ? 'No matching executions to export' : `Download all matching executions as ${historyExportFormat.toUpperCase()}`}
                 className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover-elevate disabled:cursor-not-allowed disabled:opacity-45"
               >
                 <Download className="h-3.5 w-3.5" /> Export filtered history
               </button>
                <label className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background/50 px-3 py-2 text-xs font-semibold text-foreground hover-elevate">
                  <FileUp className="h-3.5 w-3.5 text-primary" /> Import JSON history
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void handleHistoryImport(event)}
                    aria-label="Import JSON recovery history"
                    className="sr-only"
                  />
                </label>
             </div>
              {importError && <p className="mt-2 text-[11px] text-red-200" role="alert">{importError}</p>}
              {importStatus && <p className="mt-2 text-[11px] text-emerald-200" role="status">{importStatus}</p>}
             {filteredExecutions.length === 0 && (
               <p className="mt-2 text-[11px] text-muted-foreground" role="status">
                 There are no matching executions to export. Adjust the search or state filter.
               </p>
             )}
          </div>
          <div className="divide-y divide-border/60">
             {visibleExecutions.map((execution) => {
              const isSelected = selectedExecution?.id === execution.id;
              const evidence = asRecord(execution.evidence);
              const eventCount = numberValue(execution.eventCount) ?? (Array.isArray(execution.recentEvents) ? execution.recentEvents.length : 0);
               const failureCategory = recoveryDetail(execution, 'failureCategory');
               const recoveryAction = recoveryDetail(execution, 'recoveryAction');
               const evidenceStatus = textValue(asRecord(execution.evidenceProjection)?.completeness)
                 ?? recoveryDetail(execution, 'evidenceStatus')
                 ?? textValue(evidence?.verdict);
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
                           {failureCategory && <span>Failure: {failureCategory}</span>}
                           {recoveryAction && <span>Action: {recoveryAction}</span>}
                        </div>
                      </div>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-[10px]">
                      <span className={`inline-flex items-center gap-1 ${evidenceTone(execution.evidence)}`}>
                        <EvidenceIcon evidence={execution.evidence} />
                         Evidence: {evidenceStatus ?? (execution.evidence ? 'Recorded' : 'Not recorded')}
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
             {visibleExecutions.length === 0 && (
               <div className="p-8 text-center text-xs text-muted-foreground">No executions match this search or state filter.</div>
             )}
          </div>
           <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
             <span>
               {filteredExecutions.length === 0 ? '0 runs' : `Showing ${(historyPage - 1) * historyPageSize + 1}–${Math.min(historyPage * historyPageSize, filteredExecutions.length)} of ${filteredExecutions.length}`}
             </span>
             <div className="flex items-center gap-2">
               <button type="button" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={historyPage === 1} aria-label="Previous history page" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 hover-elevate disabled:opacity-40">
                 <ChevronLeft className="h-3.5 w-3.5" /> Previous
               </button>
               <span className="font-mono text-[10px]">Page {historyPage} / {historyPageCount}</span>
               <button type="button" onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))} disabled={historyPage === historyPageCount} aria-label="Next history page" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 hover-elevate disabled:opacity-40">
                 Next <ChevronRight className="h-3.5 w-3.5" />
               </button>
             </div>
           </div>
        </section>

         <div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
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

          <section className="rounded-xl border border-emerald-500/25 bg-card" aria-label="Autonomous delivery acceptance report">
            <div className="flex items-center gap-2 border-b border-emerald-500/20 px-4 py-3.5">
              <ShieldCheck className="h-4 w-4 text-emerald-200" />
              <div>
                <h2 className="font-semibold">Verified delivery outcomes</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Isolated acceptance evidence, separate from deterministic release checks.
                </p>
              </div>
              {acceptanceSummary && (
                <span className="ml-auto rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] uppercase text-emerald-200">
                  {formatValue(acceptanceSummary.operationCount)} operations
                </span>
              )}
            </div>
            <div className="p-4">
              {!acceptanceSummary ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
                  No autonomous delivery acceptance report was returned.
                </p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['Verified completion', acceptanceMetrics?.completionRate],
                      ['Safely blocked', acceptanceMetrics?.safeBlockRate],
                      ['Known failure', acceptanceMetrics?.failureRate],
                      ['Uncertain', acceptanceMetrics?.uncertaintyRate],
                      ['Recovery', acceptanceMetrics?.recoveryRate],
                      ['Scope escape', acceptanceMetrics?.scopeEscapeRate],
                      ['Repeated side effect', acceptanceMetrics?.repeatedSideEffectRate],
                      ['Verified count', acceptanceMetrics?.verifiedCompletionCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{String(label)}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-foreground">
                          {typeof value === 'number' && String(label) !== 'Verified count'
                            ? `${(value * 100).toFixed(1)}%`
                            : formatValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {acceptanceOperations.length > 0 && (
                    <div className="mt-4 space-y-1.5" aria-label="Acceptance operations">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Operations</div>
                      {acceptanceOperations.slice(0, 12).map((raw, index) => {
                        const operation = asRecord(raw);
                        if (!operation) return null;
                        return (
                          <div key={`${textValue(operation.operationId) ?? 'operation'}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/45 bg-background/20 px-3 py-2 text-xs">
                            <span className="font-mono text-foreground">{textValue(operation.operationId) ?? 'Unknown operation'}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{textValue(operation.caseId) ?? 'Unknown case'}</span>
                            <span className="ml-auto rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] uppercase">
                              {textValue(operation.outcome) ?? 'unknown'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {importedHistory && (
        <section className="rounded-xl border border-primary/25 bg-card" aria-label="Imported history comparison">
          <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileUp className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Imported history comparison</h2>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A read-only comparison. The live execution ledger has not been changed.
              </p>
            </div>
              <div className="flex flex-wrap gap-2 self-start">
                <button
                  type="button"
                  onClick={() => downloadComparisonPair(comparisonLiveExecution, selectedImportedExecution, historyExportFormat)}
                  disabled={!comparisonLiveExecution || !selectedImportedExecution}
                  aria-label="Export selected live and imported run pair"
                  title={`Download the selected pair as ${historyExportFormat.toUpperCase()}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover-elevate disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download className="h-3.5 w-3.5" /> Export selected pair
                </button>
                <button
                  type="button"
                  onClick={() => { setImportedHistory(null); setImportStatus(null); }}
                  className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover-elevate"
                >
                  Clear comparison
                </button>
              </div>
          </div>
          <div className="border-b border-border/70 px-4 py-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Run-to-run investigation</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Match one live execution with one archived execution. Imported data stays outside the live ledger.
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-[11px] font-semibold text-muted-foreground">
                Live run
                <select
                  aria-label="Select live run for comparison"
                  value={comparisonLiveExecution?.id ?? ''}
                  onChange={(event) => setComparisonLiveId(event.target.value || null)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background/50 px-2 text-xs font-normal text-foreground outline-none focus:border-primary/60"
                  disabled={executions.length === 0}
                >
                  {executions.length === 0 && <option value="">No live runs available</option>}
                  {executions.map((execution) => (
                    <option key={execution.id} value={execution.id}>{execution.id} — {objectiveText(execution.objective)}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-muted-foreground">
                Imported run
                <select
                  aria-label="Select imported run for comparison"
                  value={importedHistory.executions.find((execution) => execution.id === comparisonImportedId)?.id ?? importedHistory.executions[0]?.id ?? ''}
                  onChange={(event) => setComparisonImportedId(event.target.value || null)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background/50 px-2 text-xs font-normal text-foreground outline-none focus:border-primary/60"
                >
                  {importedHistory.executions.map((execution) => (
                    <option key={execution.id} value={execution.id}>{execution.id} — {objectiveText(execution.objective)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2" aria-label="Selected run comparison">
            <ComparisonRunColumn label="Live run" execution={comparisonLiveExecution} />
            <ComparisonRunColumn
              label="Imported run"
              execution={selectedImportedExecution}
            />
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            {[
              {
                label: 'Live history',
                executions: executions.length,
                completed: completedCount,
                failures: executions.reduce((total, execution) => total + (numberValue(execution.validationFailures) ?? 0), 0),
                metrics: scorecardMetrics,
                baseline: baselineByKey,
              },
              {
                label: 'Imported history',
                executions: importedHistory.executions.length,
                completed: importedCompletedCount,
                failures: importedValidationFailures,
                metrics: importedScorecardMetrics,
                baseline: importedBaselineByKey,
              },
            ].map((column) => (
              <div key={column.label} className="rounded-lg border border-border/60 bg-background/20 p-3">
                <h3 className="text-sm font-semibold">{column.label}</h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <SummaryMetric label="Runs" value={String(column.executions)} detail="recorded executions" icon={<History className="h-3.5 w-3.5 text-primary" />} />
                  <SummaryMetric label="Complete" value={String(column.completed)} detail="terminal states" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />} tone="text-emerald-200" />
                  <SummaryMetric label="Validation" value={String(column.failures)} detail="failure count" icon={<ShieldCheck className="h-3.5 w-3.5 text-amber-300" />} tone="text-amber-200" />
                </div>
                <div className="mt-3 space-y-1.5">
                  {column.metrics.slice(0, 6).map((metric) => {
                    const baseline = column.baseline.get(metric.key);
                    return (
                      <div key={metric.key} className="flex items-center gap-2 rounded-md border border-border/45 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{metric.label}</span>
                        <span className="font-mono text-foreground">{metric.value}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{baseline ? `base ${baseline.value}` : 'no baseline'}</span>
                      </div>
                    );
                  })}
                  {column.metrics.length === 0 && <p className="text-xs text-muted-foreground">No scorecard metrics recorded.</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
            Imported executions: {importedHistory.executions.map((execution) => execution.id).join(', ')}
          </div>
        </section>
      )}

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