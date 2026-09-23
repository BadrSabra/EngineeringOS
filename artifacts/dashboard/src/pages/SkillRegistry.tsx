import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useListProjects } from '@workspace/api-client-react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  GitCommitHorizontal,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Waypoints,
} from 'lucide-react';
import { RequestError } from '@/components/OperatorResilience';
import {
  approveSkillRegistry,
  fetchSkillRegistry,
  revokeSkillRegistry,
  type RegistryRow,
  type ShadowScore,
} from '@/lib/skill-registry';

function compactId(value: string | null | undefined, edge = 8) {
  if (!value) return 'Not recorded';
  return value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

function scoreTone(score: ShadowScore) {
  if (score.promotionAllowed && score.status.toLowerCase() === 'passed') {
    return {
      panel: 'border-emerald-400/25 bg-emerald-400/[0.06]',
      text: 'text-emerald-300',
      label: 'Gate 3 passed',
    };
  }
  if (score.blockers.length > 0 || score.terminalMismatchCount > 0) {
    return {
      panel: 'border-amber-400/25 bg-amber-400/[0.06]',
      text: 'text-amber-200',
      label: 'Gate 3 blocked',
    };
  }
  return {
    panel: 'border-slate-700 bg-slate-900/40',
    text: 'text-slate-300',
    label: `Gate 3 ${score.status || 'uncertain'}`,
  };
}

const EMPTY_SCORE: ShadowScore = {
  contractVersion: 0,
  status: 'unavailable',
  promotionAllowed: false,
  pairId: '',
  suiteVersion: '',
  baselineWorkspaceHash: '',
  candidateWorkspaceHash: '',
  metricDeltas: {},
  terminalMismatchCount: 0,
  caseCount: 0,
  blockers: ['The server did not return a valid Gate 3 score.'],
};

function StatusPill({ children, tone }: { children: string; tone: 'green' | 'amber' | 'red' | 'slate' }) {
  const tones = {
    green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    red: 'border-rose-400/25 bg-rose-400/10 text-rose-300',
    slate: 'border-slate-500/25 bg-slate-500/10 text-slate-300',
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

function CopyValue({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!value}
      title={value || 'No value recorded'}
      className="group inline-flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-slate-300 transition-colors hover:text-cyan-200 disabled:cursor-default disabled:text-slate-600"
    >
      <span className="truncate">{compactId(value)}</span>
      {value ? <Copy className={`h-3 w-3 shrink-0 transition-opacity ${copied ? 'text-emerald-300 opacity-100' : 'opacity-0 group-hover:opacity-100'}`} /> : null}
      {copied ? <span className="font-sans text-[10px] text-emerald-300">Copied</span> : null}
    </button>
  );
}

function MetricDelta({ name, value }: { name: string; value: number | string | null }) {
  const numeric = typeof value === 'number' ? value : null;
  const isPositive = numeric !== null && numeric <= 0;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 py-2 last:border-0">
      <span className="truncate text-xs text-slate-400">{name}</span>
      <span className={`font-mono text-xs ${numeric === null ? 'text-slate-300' : isPositive ? 'text-emerald-300' : 'text-amber-200'}`}>
        {numeric !== null && numeric > 0 ? '+' : ''}{String(value ?? '—')}
      </span>
    </div>
  );
}

function RegistryEntry({
  row,
  busyAction,
  onApprove,
  onRevoke,
}: {
  row: RegistryRow;
  busyAction: string | null;
  onApprove: (row: RegistryRow) => void;
  onRevoke: (row: RegistryRow) => void;
}) {
  const score = row.shadowScore ?? EMPTY_SCORE;
  const gate = scoreTone(score);
  const canApprove = row.promotionStatus === 'pending' && row.revocationStatus === 'active';
  const canRevoke = row.revocationStatus === 'active' && row.promotionStatus === 'promoted';
  const metricEntries = Object.entries(score.metricDeltas ?? {});
  const actionBusy = busyAction === row.id;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/55 shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
      <div className="flex flex-col gap-4 border-b border-slate-800/80 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={row.promotionStatus === 'promoted' ? 'green' : row.promotionStatus === 'rejected' ? 'red' : row.promotionStatus === 'pending' ? 'amber' : 'slate'}>
              {row.promotionStatus}
            </StatusPill>
            <StatusPill tone={row.revocationStatus === 'revoked' ? 'red' : 'green'}>
              {row.revocationStatus}
            </StatusPill>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">registry/{compactId(row.id, 6)}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="truncate text-lg font-semibold tracking-tight text-slate-100">{row.skillId}</h2>
            <span className="font-mono text-sm text-cyan-300">v{row.skillVersion}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Registered {formatDate(row.createdAt, true)} · updated {formatDate(row.updatedAt, true)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canApprove ? (
            <button
              type="button"
              data-testid={`approve-${row.id}`}
              onClick={() => onApprove(row)}
              disabled={actionBusy}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-wait disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> {actionBusy ? 'Working…' : 'Approve'}
            </button>
          ) : null}
          {canRevoke ? (
            <button
              type="button"
              data-testid={`revoke-${row.id}`}
              onClick={() => onRevoke(row)}
              disabled={actionBusy}
              className="inline-flex items-center gap-2 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-400/20 disabled:cursor-wait disabled:opacity-50"
            >
              <ShieldX className="h-3.5 w-3.5" /> {actionBusy ? 'Working…' : 'Revoke'}
            </button>
          ) : null}
          {!canApprove && !canRevoke ? <span className="text-xs text-slate-600">No operator action</span> : null}
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1fr_1.15fr]">
        <div className="space-y-4">
          <div className={`rounded-lg border p-4 ${gate.panel}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Gate 3 / shadow replay</p>
                <p className={`mt-1 flex items-center gap-2 text-sm font-semibold ${gate.text}`}>
                  {gate.label}
                   {score.promotionAllowed ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                </p>
              </div>
               <span className="font-mono text-xs text-slate-500">{score.contractVersion || '—'}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-700/60 pt-3 text-xs">
               <div><span className="block text-slate-500">Pair</span><CopyValue value={score.pairId} /></div>
               <div><span className="block text-slate-500">Suite</span><span className="font-mono text-slate-300">{score.suiteVersion || 'Not recorded'}</span></div>
               <div><span className="block text-slate-500">Cases</span><span className="font-mono text-slate-300">{score.caseCount}</span></div>
               <div><span className="block text-slate-500">Terminal mismatches</span><span className={`font-mono ${score.terminalMismatchCount ? 'text-amber-200' : 'text-emerald-300'}`}>{score.terminalMismatchCount}</span></div>
            </div>
             {score.blockers.length > 0 ? (
              <div className="mt-3 border-t border-slate-700/60 pt-3">
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-amber-200/70">Blockers</p>
                <ul className="space-y-1 text-xs text-amber-100/80">
                   {score.blockers.map((blocker) => <li key={blocker} className="flex gap-2"><span className="text-amber-300">·</span>{blocker}</li>)}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Promotion trail</p>
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div><span className="mb-1 block text-slate-500">Approved by</span><CopyValue value={row.approvedBy} /></div>
              <div><span className="mb-1 block text-slate-500">Approved at</span><span className="text-slate-300">{formatDate(row.approvedAt, true)}</span></div>
              <div><span className="mb-1 block text-slate-500">Revoked by</span><CopyValue value={row.revokedBy} /></div>
              <div><span className="mb-1 block text-slate-500">Revoked at</span><span className="text-slate-300">{formatDate(row.revokedAt, true)}</span></div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Proof receipt / source</p>
              <LockKeyhole className="h-3.5 w-3.5 text-cyan-300/70" />
            </div>
            <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <div><dt className="text-[11px] text-slate-500">Proof receipt</dt><dd><CopyValue value={row.proofReceiptId} /></dd></div>
              <div><dt className="text-[11px] text-slate-500">Candidate</dt><dd><CopyValue value={row.candidateId} /></dd></div>
              <div><dt className="text-[11px] text-slate-500">Proposal</dt><dd><CopyValue value={row.proposalId} /></dd></div>
              <div><dt className="text-[11px] text-slate-500">Shadow replay</dt><dd><CopyValue value={row.shadowReplayId} /></dd></div>
              <div><dt className="text-[11px] text-slate-500">Source revision</dt><dd><CopyValue value={row.sourceRevision} /></dd></div>
              <div><dt className="text-[11px] text-slate-500">Candidate tree hash</dt><dd><CopyValue value={row.candidateTreeHash} /></dd></div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/25 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Metric deltas</p>
              <span className="text-[10px] text-slate-600">candidate − baseline</span>
            </div>
            {metricEntries.length > 0 ? metricEntries.map(([name, value]) => <MetricDelta key={name} name={name} value={value} />) : <p className="py-2 text-xs text-slate-600">No metric deltas were returned.</p>}
            <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
               <span>Baseline</span><CopyValue value={score.baselineWorkspaceHash} />
              <ArrowUpRight className="ml-auto h-3 w-3 text-slate-600" />
               <span>Candidate</span><CopyValue value={score.candidateWorkspaceHash} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function SkillRegistry() {
  const { data: projects, isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number>();
  const requestVersion = useRef(0);

  const effectiveProjectId = selectedProjectId || String(projects?.[0]?.id ?? '');
  const selectedProject = useMemo(
    () => projects?.find((project) => String(project.id) === effectiveProjectId),
    [projects, effectiveProjectId],
  );

  const loadRegistry = useCallback(async (projectId: string, refresh = false) => {
    if (!projectId) {
      setRegistry([]);
      return;
    }
    const version = ++requestVersion.current;
    setLoadError(null);
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      const response = await fetchSkillRegistry(projectId);
      if (version === requestVersion.current) {
        setRegistry(response.registry ?? []);
        setLastUpdated(Date.now());
      }
    } catch (error) {
      if (version === requestVersion.current) setLoadError(error);
    } finally {
      if (version === requestVersion.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (projects?.length && !selectedProjectId) setSelectedProjectId(String(projects[0].id));
  }, [projects, selectedProjectId]);

  useEffect(() => {
    void loadRegistry(effectiveProjectId);
  }, [effectiveProjectId, loadRegistry]);

  const replaceReturnedRow = useCallback((returned: RegistryRow) => {
    setRegistry((current) => current.map((row) => row.id === returned.id ? returned : row));
    setLastUpdated(Date.now());
  }, []);

  const handleApprove = useCallback(async (row: RegistryRow) => {
    if (!window.confirm(`Approve ${row.skillId} v${row.skillVersion} for immediate promotion?`)) return;
    setBusyAction(row.id);
    setLoadError(null);
    try {
      const response = await approveSkillRegistry(row.id);
      replaceReturnedRow(response.registry);
    } catch (error) {
      setLoadError(error);
    } finally {
      setBusyAction(null);
    }
  }, [replaceReturnedRow]);

  const handleRevoke = useCallback(async (row: RegistryRow) => {
    if (!window.confirm(`Revoke ${row.skillId} v${row.skillVersion} immediately? This removes its active registry status.`)) return;
    setBusyAction(row.id);
    setLoadError(null);
    try {
      const response = await revokeSkillRegistry(row.id);
      replaceReturnedRow(response.registry);
    } catch (error) {
      setLoadError(error);
    } finally {
      setBusyAction(null);
    }
  }, [replaceReturnedRow]);

  const pendingCount = registry.filter((row) => row.promotionStatus === 'pending').length;
  const activePromotedCount = registry.filter((row) => row.promotionStatus === 'promoted' && row.revocationStatus === 'active').length;

  return (
    <div className="min-h-[100dvh] space-y-6 pb-10">
      <header className="flex flex-col gap-5 border-b border-slate-800/80 pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/80">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.7)]" />
            Trusted control surface / Gate 3
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-slate-100 sm:text-4xl">Skill Registry</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Approve proof-carrying skills only when their shadow replay is promotion-eligible. Every receipt, revision, and uncertainty stays visible.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <label className="relative min-w-0 sm:min-w-[260px]">
            <span className="sr-only">Select owned project</span>
            <select
              data-testid="project-select"
              value={effectiveProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              disabled={projectsLoading || !projects?.length}
              className="w-full appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 pr-9 text-sm font-medium text-slate-200 outline-none transition-colors hover:border-slate-600 focus:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {projects?.length ? projects.map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>) : <option>No owned projects</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-500" />
          </label>
          <button
            type="button"
            data-testid="registry-refresh"
            onClick={() => { void refetchProjects(); void loadRegistry(effectiveProjectId, true); }}
            disabled={isRefreshing || !effectiveProjectId}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh registry
          </button>
        </div>
      </header>

      {projectsError ? <RequestError message="Unable to load owned projects." onRetry={() => void refetchProjects()} /> : null}

      {!projectsLoading && !effectiveProjectId ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/35 px-6 py-16 text-center">
          <Waypoints className="mx-auto mb-4 h-8 w-8 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-200">No owned project selected</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Choose an owned project to inspect its proof-backed skill registry.</p>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Registry summary">
            {[
              { label: 'Registry entries', value: registry.length, icon: KeyRound, tone: 'text-cyan-300' },
              { label: 'Pending review', value: pendingCount, icon: Clock3, tone: 'text-amber-200' },
              { label: 'Promoted / active', value: activePromotedCount, icon: ShieldCheck, tone: 'text-emerald-300' },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/45 px-4 py-3">
                <div className="flex items-center justify-between text-xs text-slate-500"><span>{label}</span><Icon className={`h-4 w-4 ${tone}`} /></div>
                <p className="mt-2 font-mono text-2xl text-slate-100">{value}</p>
              </div>
            ))}
          </section>

          <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2"><GitCommitHorizontal className="h-3.5 w-3.5 text-slate-600" /> Viewing <span className="font-medium text-slate-300">{selectedProject?.name ?? effectiveProjectId}</span></p>
            {lastUpdated ? <p>Last checked {new Date(lastUpdated).toLocaleTimeString()}</p> : null}
          </div>

          {loadError ? <RequestError message={loadError instanceof Error ? loadError.message : 'Unable to load the skill registry.'} onRetry={() => void loadRegistry(effectiveProjectId, true)} /> : null}

          {isLoading ? (
            <div className="space-y-4" aria-label="Loading skill registry">
              {[1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-xl border border-slate-800 bg-slate-900/50" />)}
            </div>
          ) : !loadError && registry.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/35 px-6 py-16 text-center">
              <LockKeyhole className="mx-auto mb-4 h-8 w-8 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-200">Registry is clear</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">No proof-carrying skills have been registered for this project. New candidates will appear here with their Gate 3 evidence before promotion.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {registry.map((row) => <RegistryEntry key={row.id} row={row} busyAction={busyAction} onApprove={handleApprove} onRevoke={handleRevoke} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}