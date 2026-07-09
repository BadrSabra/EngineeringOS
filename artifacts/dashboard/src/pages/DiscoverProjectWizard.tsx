import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStartDiscovery,
  useGetDiscoverySession,
  useGetDiscoverySummary,
  useImportProject,
  getListProjectsQueryKey,
  getGetDiscoverySessionQueryKey,
  getGetDiscoverySummaryQueryKey,
} from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import {
  X,
  FolderOpen,
  Loader2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronRight,
  Edit2,
  ShieldAlert,
  GitBranch,
  Package,
  Box,
  Terminal,
  Database,
  Cpu,
  TestTube2,
  Hammer,
  GitFork,
  Layers,
  Lock,
  FileCode2,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DiscoveryStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  durationMs?: number;
}

interface DiscoverySession {
  id: string;
  status: 'discovering' | 'ready' | 'imported' | 'error';
  progress: number;
  currentStep: string | null;
  steps: DiscoveryStep[];
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
}

interface DiscoveryReport {
  id: string;
  detectedName: string;
  detectedLanguage: string;
  detectedLanguages: string[];
  detectedFramework: string | null;
  detectedRuntime: string | null;
  detectedPackageManager: string | null;
  detectedArchitecture: string | null;
  detectedDb: string | null;
  detectedOrm: string | null;
  detectedTestFramework: string | null;
  detectedBuildTool: string | null;
  detectedCi: string | null;
  isMonorepo: boolean;
  hasDocker: boolean;
  hasOpenApi: boolean;
  packageCount: number;
  moduleCount: number;
  repoSizeBytes: number;
  detectedApis: string[];
  detectedRisks: string[];
  qualityScore: number;
  confidenceScore: number;
  graphSummary: { entityCount: number; relationshipCount: number };
  ruleViolations: Array<{ code: string; title: string; severity: string; count: number }>;
}

interface Props {
  onClose: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  return 'text-red-400';
}

function severityBadge(sev: string): string {
  const map: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    info: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  return map[sev] ?? map.info;
}

// ─── Step icon ─────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: DiscoveryStep['status'] }) {
  if (status === 'done')
    return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === 'running')
    return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
  if (status === 'error')
    return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />;
}

// ─── Report row ────────────────────────────────────────────────────────────────

function ReportRow({
  icon: Icon,
  label,
  value,
  isOverride,
  editable,
  onEdit,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  isOverride?: boolean;
  editable?: boolean;
  onEdit?: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => {
    onEdit?.(draft);
    setEditing(false);
  };

  if (!value && !editing) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-border/30">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs text-muted-foreground/50 w-36 shrink-0">{label}</span>
        <span className="text-xs text-muted-foreground/30 italic">Not detected</span>
        {editable && (
          <button
            className="ml-auto text-xs text-muted-foreground/40 hover:text-primary flex items-center gap-1"
            onClick={() => setEditing(true)}
          >
            <Edit2 className="w-3 h-3" /> Override
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30">
      <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
      <span className="text-xs text-muted-foreground/70 w-36 shrink-0">{label}</span>
      {editing ? (
        <div className="flex gap-2 flex-1">
          <input
            autoFocus
            className="flex-1 bg-secondary border border-primary/40 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button
            className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded"
            onClick={commit}
          >
            Save
          </button>
        </div>
      ) : (
        <>
          <span className="text-sm font-medium font-mono truncate">{value}</span>
          {isOverride && (
            <span className="ml-2 text-[10px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full shrink-0">
              override
            </span>
          )}
          {!isOverride && value && (
            <span className="ml-2 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full shrink-0">
              detected
            </span>
          )}
          {editable && (
            <button
              className="ml-auto text-muted-foreground/40 hover:text-primary shrink-0"
              onClick={() => { setDraft(value ?? ''); setEditing(true); }}
            >
              <Edit2 className="w-3 h-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main wizard ───────────────────────────────────────────────────────────────

export function DiscoverProjectWizard({ onClose }: Props) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [rootPath, setRootPath] = useState('');
  const [source] = useState<'local' | 'workspace'>('local');
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startDiscovery = useStartDiscovery();
  const importProject = useImportProject();

  // Polling via react-query (enabled only when discoveryId set and not done)
  const { data: sessionData } = useGetDiscoverySession(discoveryId ?? '', {
    query: {
      queryKey: getGetDiscoverySessionQueryKey(discoveryId ?? ''),
      enabled: !!discoveryId && step === 2,
      refetchInterval: (query) => {
        const s = query.state.data as DiscoverySession | undefined;
        if (!s) return 800;
        return s.status === 'discovering' ? 800 : false;
      },
    },
  });

  const { data: summaryData } = useGetDiscoverySummary(discoveryId ?? '', {
    query: {
      queryKey: getGetDiscoverySummaryQueryKey(discoveryId ?? ''),
      enabled: !!discoveryId && (session?.status === 'ready' || sessionData?.status === 'ready'),
    },
  });

  // Sync session data
  useEffect(() => {
    if (!sessionData) return;
    const s = sessionData as unknown as DiscoverySession;
    setSession(s);
    if (s.status === 'ready' || s.status === 'error') {
      if (s.status === 'ready') setStep(3);
    }
  }, [sessionData]);

  useEffect(() => {
    if (!summaryData) return;
    setReport(summaryData as unknown as DiscoveryReport);
  }, [summaryData]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rootPath.trim()) return;
    try {
      const result = await startDiscovery.mutateAsync({
        data: { rootPath: rootPath.trim(), source },
      });
      const s = result as unknown as DiscoverySession;
      setDiscoveryId(s.id);
      setSession(s);
      setStep(2);
    } catch (err) {
      // error shown by startDiscovery.isError
    }
  };

  const handleImport = async () => {
    if (!discoveryId || !report) return;
    setImportError(null);
    try {
      const project = await importProject.mutateAsync({
        data: { discoveryId, overrides: Object.keys(overrides).length > 0 ? overrides : undefined },
      });
      setStep(4);
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setTimeout(() => {
        onClose();
        navigate(`/projects/${(project as unknown as { id: string }).id}`);
      }, 2200);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const setOverride = (key: string) => (value: string) =>
    setOverrides((prev) => ({ ...prev, [key]: value }));

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <form onSubmit={handleStart} className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight mb-1">Discover Project</h2>
        <p className="text-sm text-muted-foreground">
          Provide a path and EngineeringOS will automatically analyze the repository.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <label className="relative cursor-pointer group border border-border rounded-xl p-4 flex items-center gap-4 bg-card hover:border-primary/50 transition-colors">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="font-semibold text-sm">Local Workspace Folder</div>
            <div className="text-xs text-muted-foreground mt-0.5">Scan a directory on this server</div>
          </div>
          <div className="ml-auto w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-primary" />
          </div>
        </label>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Repository Root Path
        </label>
        <div className="relative">
          <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            required
            autoFocus
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="/home/runner/workspace"
            className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
        </div>
        <p className="text-xs text-muted-foreground/60">
          The absolute path to the project root on the server filesystem.
        </p>
      </div>

      {startDiscovery.isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to start discovery. Check the path and try again.
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={startDiscovery.isPending || !rootPath.trim()}
          className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
        >
          {startDiscovery.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Start Discovery
        </button>
      </div>
    </form>
  );

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const steps = session?.steps ?? [];
    const progress = session?.progress ?? 0;
    const isError = session?.status === 'error';

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight mb-1">Analyzing Repository…</h2>
          <p className="text-sm text-muted-foreground font-mono truncate">{rootPath}</p>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{isError ? 'Discovery failed' : progress < 100 ? 'Discovering…' : 'Complete'}</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isError ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 py-1.5 px-3 rounded-lg transition-colors ${
                s.status === 'running' ? 'bg-primary/5' : ''
              }`}
            >
              <StepIcon status={s.status} />
              <span
                className={`text-sm flex-1 ${
                  s.status === 'done'
                    ? 'text-foreground/60'
                    : s.status === 'running'
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground/40'
                }`}
              >
                {s.name}
              </span>
              {s.durationMs !== undefined && s.status === 'done' && (
                <span className="text-xs font-mono text-muted-foreground/40">{s.durationMs}ms</span>
              )}
            </div>
          ))}
        </div>

        {isError && (
          <div className="flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-0.5">Discovery failed</div>
              <div className="text-xs opacity-80">{session?.error ?? 'Unknown error'}</div>
            </div>
          </div>
        )}

        {isError && (
          <div className="flex justify-between pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => { setStep(1); setDiscoveryId(null); setSession(null); }}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  const renderStep3 = () => {
    if (!report) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      );
    }

    const name = overrides['name'] ?? report.detectedName;
    const language = overrides['language'] ?? report.detectedLanguage;
    const framework = overrides['framework'] ?? report.detectedFramework;
    const description = overrides['description'] ?? null;

    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight mb-0.5">Discovery Report</h2>
            <p className="text-sm text-muted-foreground">
              EngineeringOS has analyzed your repository. Review and confirm.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-2xl font-bold font-mono ${scoreColor(report.qualityScore)}`}>
              {report.qualityScore}
              <span className="text-sm text-muted-foreground font-sans font-normal">/100</span>
            </div>
            <div className="text-xs text-muted-foreground">Quality Score</div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Detection Confidence</span>
              <span className="font-mono font-semibold text-emerald-400">{report.confidenceScore}%</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${report.confidenceScore}%` }}
              />
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right shrink-0">
            <div className="font-mono">{report.moduleCount} modules</div>
            <div className="font-mono">{fmt(report.repoSizeBytes)}</div>
          </div>
        </div>

        {/* Identity */}
        <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</span>
          </div>
          <div className="px-4 py-1">
            <ReportRow icon={FileCode2} label="Project Name" value={name} isOverride={!!overrides['name']} editable onEdit={setOverride('name')} />
            <ReportRow icon={Terminal} label="Primary Language" value={language} isOverride={!!overrides['language']} editable onEdit={setOverride('language')} />
            <ReportRow icon={Layers} label="Framework" value={framework} isOverride={!!overrides['framework']} editable onEdit={setOverride('framework')} />
            <ReportRow icon={Cpu} label="Runtime" value={report.detectedRuntime} />
            <ReportRow icon={Package} label="Package Manager" value={report.detectedPackageManager} />
            <ReportRow icon={GitBranch} label="Architecture" value={report.detectedArchitecture} />
          </div>
        </div>

        {/* Infrastructure */}
        <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Infrastructure</span>
          </div>
          <div className="px-4 py-1">
            <ReportRow icon={Database} label="Database" value={report.detectedDb} />
            <ReportRow icon={Box} label="ORM" value={report.detectedOrm} />
            <ReportRow icon={TestTube2} label="Test Framework" value={report.detectedTestFramework} />
            <ReportRow icon={Hammer} label="Build Tool" value={report.detectedBuildTool} />
            <ReportRow icon={GitFork} label="CI/CD" value={report.detectedCi} />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'APIs', value: report.detectedApis.length },
            { label: 'Modules', value: report.moduleCount },
            { label: 'Packages', value: report.packageCount },
            { label: 'Graph Nodes', value: report.graphSummary.entityCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border/50 rounded-xl px-3 py-3 text-center">
              <div className="text-lg font-bold font-mono">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {report.isMonorepo && (
            <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <GitBranch className="w-3 h-3" /> Monorepo
            </span>
          )}
          {report.hasDocker && (
            <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <Box className="w-3 h-3" /> Docker
            </span>
          )}
          {report.hasOpenApi && (
            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <FileCode2 className="w-3 h-3" /> OpenAPI
            </span>
          )}
          {report.detectedLanguages.slice(0, 4).map((l) => (
            <span key={l} className="text-xs bg-secondary text-muted-foreground border border-border/50 px-2.5 py-1 rounded-full">
              {l}
            </span>
          ))}
        </div>

        {/* Risks */}
        {report.detectedRisks.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">
                {report.detectedRisks.length} Risk{report.detectedRisks.length !== 1 ? 's' : ''} Detected
              </span>
            </div>
            {report.detectedRisks.map((r, i) => (
              <div key={i} className="text-xs text-yellow-300/80 flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">▸</span>
                {r}
              </div>
            ))}
          </div>
        )}

        {/* Rule violations */}
        {report.ruleViolations.length > 0 && (
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Rule Violations ({report.ruleViolations.length})
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {report.ruleViolations.slice(0, 5).map((v, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`text-[10px] border px-1.5 py-0.5 rounded font-mono ${severityBadge(v.severity)}`}>
                    {v.severity}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{v.code}</span>
                  <span className="text-xs text-muted-foreground flex-1 truncate">{v.title}</span>
                  <span className="text-xs font-mono text-muted-foreground/60 shrink-0">{v.count}×</span>
                </div>
              ))}
              {report.ruleViolations.length > 5 && (
                <div className="px-4 py-2 text-xs text-muted-foreground/50">
                  +{report.ruleViolations.length - 5} more violations…
                </div>
              )}
            </div>
          </div>
        )}

        {importError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {importError}
          </div>
        )}

        <div className="flex justify-between gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importProject.isPending}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {importProject.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            Confirm & Import Project
          </button>
        </div>
      </div>
    );
  };

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  const renderStep4 = () => (
    <div className="space-y-6 py-4">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold tracking-tight mb-1">Project Imported</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {overrides['name'] ?? report?.detectedName}
          </span>{' '}
          is now under autonomous observation.
        </p>
      </div>

      <div className="bg-card border border-emerald-500/20 rounded-xl divide-y divide-border/30">
        {[
          'Project record created',
          'Default rules initialized',
          'Initial metrics calculated',
          `Knowledge graph built (${report?.graphSummary.entityCount ?? 0} entities)`,
          `Tasks created (${report?.ruleViolations.length ?? 0} from rule violations)`,
          'Audit log entry written',
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-sm">{item}</span>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">Redirecting to project dashboard…</p>
    </div>
  );

  // ── Step indicators ─────────────────────────────────────────────────────────
  const stepLabels = ['Select Source', 'Analyzing', 'Discovery Report', 'Importing'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={step === 1 ? onClose : undefined} />

      {/* Panel */}
      <div className="relative bg-background border border-border/60 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2">
            {stepLabels.map((label, i) => {
              const s = (i + 1) as 1 | 2 | 3 | 4;
              const active = s === step;
              const done = s < step;
              return (
                <React.Fragment key={i}>
                  <div
                    className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                      active ? 'text-foreground' : done ? 'text-muted-foreground/60' : 'text-muted-foreground/30'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition-colors ${
                        active
                          ? 'bg-primary text-primary-foreground border-primary'
                          : done
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-secondary/50 text-muted-foreground/30 border-border/30'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    <span className="hidden sm:block">{label}</span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-muted-foreground/20 shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {step <= 2 && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors ml-4 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
      </div>
    </div>
  );
}
