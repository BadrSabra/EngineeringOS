import React, { useState } from 'react';
import { useRoute } from 'wouter';
import {
  useGetProject,
  useGetProjectSummary,
  useScanProject,
  useListTasks,
  useGetGraphSummary,
  getGetProjectSummaryQueryKey,
  getListTasksQueryKey,
  getGetProjectQueryKey,
  getGetGraphSummaryQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Activity,
  Settings,
  Play,
  ShieldAlert,
  Zap,
  Wrench,
  TerminalSquare,
  CheckCircle2,
  AlertTriangle,
  Clock,
  GitCommit,
  Network,
  GitMerge,
  X,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'wouter';

export default function ProjectDetail() {
  const [, params] = useRoute('/projects/:id');
  const projectId = params?.id || '';
  const queryClient = useQueryClient();

  const { data: project, isLoading: loadingProject } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId),
      // Scans now run as background jobs (see scan-runner.ts): the project
      // stays "scanning" until the job finishes, so poll while it's active
      // rather than relying on a fixed delay before invalidating once.
      refetchInterval: (query) => (query.state.data?.status === 'scanning' ? 1500 : false),
    },
  });

  const { data: summary, isLoading: loadingSummary } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) },
  });

  // Prefetch tasks into the query cache for the Tasks tab (result not used directly here).
  useListTasks(
    { projectId },
    { query: { enabled: !!projectId, queryKey: getListTasksQueryKey({ projectId }) } },
  );

  const { data: graphSummary } = useGetGraphSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetGraphSummaryQueryKey(projectId), staleTime: 60_000 },
  });

  const [showProjectInfo, setShowProjectInfo] = useState(false);

  const scanProject = useScanProject();

  const handleScan = () => {
    if (!projectId) return;
    scanProject.mutate(
      { projectId },
      {
        onSuccess: () => {
          // The scan runs as a background job; optimistically flip to
          // "scanning" so the poll (refetchInterval above) kicks in right
          // away instead of waiting for the next natural refetch.
          queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: any) =>
            old ? { ...old, status: 'scanning' } : old,
          );
        },
      },
    );
  };

  if (loadingProject || loadingSummary) {
    return (
      <div className="p-8 text-center animate-pulse text-muted-foreground">
        Loading project telemetry...
      </div>
    );
  }

  if (!project || !summary) {
    return (
      <div className="p-8 text-center text-destructive border border-destructive/20 bg-destructive/5 rounded-xl">
        Project not found or API error.
      </div>
    );
  }

  const metrics = summary.latestMetrics ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="text-sm font-mono text-muted-foreground flex items-center gap-2">
          <span>PROJECTS</span>
          <span className="text-border">/</span>
          <span className="text-foreground">{project.name}</span>
        </div>
      </div>

      {/* Project header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-card border border-border rounded-xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <span
              className={`px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wider flex items-center gap-1.5
              ${
                project.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : project.status === 'scanning'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-secondary text-muted-foreground border border-border'
              }`}
            >
              {project.status === 'active' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              )}
              {project.status === 'scanning' && <Activity className="w-3 h-3 animate-pulse" />}
              {project.status}
            </span>
          </div>
          <p className="text-muted-foreground font-mono text-sm flex items-center gap-2">
            <TerminalSquare className="w-4 h-4" /> {project.rootPath}
          </p>
          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md">
              <span className="text-muted-foreground">Lang:</span>{' '}
              <span className="font-semibold capitalize">{project.language}</span>
            </span>
            {project.framework && (
              <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md">
                <span className="text-muted-foreground">Framework:</span>{' '}
                <span className="font-semibold">{project.framework}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md text-muted-foreground">
              <Clock className="w-3.5 h-3.5" /> Last Scan:{' '}
              {project.lastScanAt ? new Date(project.lastScanAt).toLocaleString() : 'Never'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowProjectInfo((v) => !v)}
            className={`p-2 border rounded-md transition-colors ${showProjectInfo ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary text-muted-foreground'}`}
            title="Project info"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={handleScan}
            disabled={scanProject.isPending || project.status === 'scanning'}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 disabled:opacity-60 transition-colors"
          >
            {project.status === 'scanning' ? (
              <>
                <Activity className="w-4 h-4 animate-pulse" /> Scanning…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> Trigger Scan
              </>
            )}
          </button>
        </div>
      </div>

      {/* Project info panel */}
      {showProjectInfo && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-sm text-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-primary">
              <Settings className="w-4 h-4" /> Project Info
            </h2>
            <button
              onClick={() => setShowProjectInfo(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
            {[
              { label: 'ID',          value: project.id },
              { label: 'Root path',   value: project.rootPath },
              { label: 'Language',    value: project.language },
              { label: 'Framework',   value: project.framework ?? '—' },
              { label: 'Status',      value: project.status },
              { label: 'Created',     value: project.createdAt ? new Date(project.createdAt).toLocaleString() : '—' },
              { label: 'Last scan',   value: project.lastScanAt ? new Date(project.lastScanAt).toLocaleString() : 'Never' },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-0.5 bg-secondary/40 rounded-md px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{label}</span>
                <span className="text-foreground break-all">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge graph summary strip */}
      {graphSummary && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" /> Knowledge Graph
            </h2>
            <Link
              href="/graph"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Explore in Graph <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Entities',       value: graphSummary.entityCount,      color: 'text-primary' },
              { label: 'Relations',      value: graphSummary.relationshipCount, color: 'text-primary' },
              { label: 'Clusters',       value: graphSummary.clusterCount,      color: 'text-foreground' },
              { label: 'Isolated nodes', value: graphSummary.isolatedCount,    color: graphSummary.isolatedCount > 0 ? 'text-yellow-500' : 'text-foreground' },
            ].map((s) => (
              <div key={s.label} className="bg-secondary/50 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          {graphSummary.topConnected.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5" /> Most connected
              </div>
              <div className="flex flex-wrap gap-2">
                {graphSummary.topConnected.slice(0, 5).map((c) => (
                  <div key={c.entityId} className="flex items-center gap-1.5 text-xs bg-background border border-border rounded-md px-2 py-1">
                    <span className="font-medium truncate max-w-[120px]">{c.entityName}</span>
                    <span className="font-mono text-primary shrink-0">{c.totalDegree}°</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metrics + tasks grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quality score */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <ShieldAlert className="w-4 h-4 text-primary" /> Quality Score
          </h2>
          <div className="text-center mb-6">
            <div
              className={`text-6xl font-bold font-mono ${
                summary.qualityScore >= 80
                  ? 'text-emerald-500'
                  : summary.qualityScore >= 60
                  ? 'text-yellow-500'
                  : 'text-destructive'
              }`}
            >
              {summary.qualityScore}
            </div>
            <div className="text-muted-foreground text-sm mt-1">/ 100</div>
          </div>

          {metrics && (
            <div className="space-y-4">
              {[
                { label: 'Architecture', score: metrics.architectureScore || 0, icon: GitCommit },
                { label: 'Security', score: metrics.securityScore || 0, icon: ShieldAlert },
                { label: 'Performance', score: metrics.performanceScore || 0, icon: Zap },
                { label: 'Reliability', score: metrics.reliabilityScore || 0, icon: Activity },
                {
                  label: 'Maintainability',
                  score: metrics.maintainabilityScore || 0,
                  icon: Wrench,
                },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex justify-between items-end mb-1.5 text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <m.icon className="w-3.5 h-3.5" /> {m.label}
                    </span>
                    <span className="font-mono font-medium">{m.score}</span>
                  </div>
                  <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        m.score >= 80
                          ? 'bg-emerald-500'
                          : m.score >= 60
                          ? 'bg-yellow-500'
                          : 'bg-destructive'
                      }`}
                      style={{ width: `${m.score}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Task breakdown */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-primary" /> Task Breakdown
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/50 border border-border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono">{summary.taskCounts.total}</div>
              <div className="text-xs text-muted-foreground uppercase mt-1 tracking-wider">
                Total
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-blue-500">
                {summary.taskCounts.running}
              </div>
              <div className="text-xs text-blue-500/80 uppercase mt-1 tracking-wider">Running</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-emerald-500">
                {summary.taskCounts.completed}
              </div>
              <div className="text-xs text-emerald-500/80 uppercase mt-1 tracking-wider">
                Completed
              </div>
            </div>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-destructive">
                {summary.taskCounts.failed}
              </div>
              <div className="text-xs text-destructive/80 uppercase mt-1 tracking-wider">
                Failed
              </div>
            </div>
          </div>
        </div>

        {/* Recent events */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-primary" /> Recent Events
          </h2>
          <div className="flex-1 overflow-y-auto space-y-2">
            {summary.recentEvents?.length ? (
              summary.recentEvents.slice(0, 8).map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-2 text-sm p-2 bg-secondary/30 rounded"
                >
                  {evt.severity === 'error' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  ) : evt.severity === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <Activity className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                  )}
                  <div>
                    <div className="text-xs font-medium">{evt.message || evt.type}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground italic">No recent events.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
