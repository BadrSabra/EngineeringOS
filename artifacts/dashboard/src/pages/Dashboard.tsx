import React from 'react';
import {
  getGetHealthQueryKey,
  useGetDashboard,
  useGetHealth,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderGit2,
  Database,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'wouter';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import { useMonotonicData } from '@/lib/freshness';

function formatHealthTimestamp(value: Date | string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

export default function Dashboard() {
  const dashboardQuery = useGetDashboard();
  const { data: rawDashboard, isLoading, error, refetch, isRefetching, dataUpdatedAt } = dashboardQuery;
  const dashboard = useMonotonicData(rawDashboard, rawDashboard?.freshnessRevision);
  const { data: health, refetch: refetchHealth } = useGetHealth({
    query: {
      queryKey: getGetHealthQueryKey(),
      refetchInterval: 30_000,
      retry: 1,
    },
  });
  const retention = health?.aiDiagnosticsRetention;

  const totalFinished =
    (dashboard?.completedTaskCount ?? 0) + (dashboard?.failedTaskCount ?? 0);
  const successRate =
    totalFinished > 0
      ? Math.round(((dashboard?.completedTaskCount ?? 0) / totalFinished) * 100)
      : null;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-secondary rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-card border border-border rounded-xl"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-card border border-border rounded-xl"></div>
          <div className="h-96 bg-card border border-border rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <RequestError
        title="Failed to load dashboard"
        message="Could not connect to the EngineeringOS API."
        retryLabel="Retry Connection"
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time status of all autonomous engineering operations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton
            onRefresh={async () => { await refetch(); await refetchHealth(); }}
            isRefreshing={isRefetching}
            lastUpdated={dataUpdatedAt}
            label="Refresh status"
          />
          <span className="flex items-center gap-2 text-xs font-mono font-medium text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            SYSTEM ONLINE
          </span>
        </div>
      </div>

      {/* Retention health is deliberately limited to content-free sweep metadata. */}
      <section
        aria-label="AI diagnostics retention health"
        className={`rounded-xl border p-4 shadow-sm ${
          retention?.status === 'failed'
            ? 'border-destructive/30 bg-destructive/5'
            : retention?.status === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-border bg-card'
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                retention?.status === 'failed'
                  ? 'bg-destructive/10 text-destructive'
                  : retention?.status === 'success'
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-secondary text-muted-foreground'
              }`}
            >
              {retention?.status === 'failed' ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Database className="h-4 w-4" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-sm">AI diagnostics retention</h2>
                {retention?.status === 'success' && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-500">
                    Healthy
                  </span>
                )}
                {retention?.status === 'failed' && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                    Sweep failed
                  </span>
                )}
                {!retention && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Checking
                  </span>
                )}
              </div>
              {retention?.status === 'failed' ? (
                <p className="mt-1 text-xs text-destructive/80">
                  The sweep will be retried automatically on the next startup.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last completed {formatHealthTimestamp(retention?.completedAt)}
                </p>
              )}
            </div>
          </div>
          {retention?.status === 'success' && (
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:text-right">
              <span className="text-muted-foreground">Chat rows</span>
              <span className="font-mono font-medium">{retention.chatRowsScanned} scanned / {retention.chatRowsPruned} pruned</span>
              <span className="text-muted-foreground">Execution rows</span>
              <span className="font-mono font-medium">{retention.executionRowsScanned} scanned / {retention.executionRowsPruned} pruned</span>
            </div>
          )}
        </div>
      </section>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">Active Projects</h3>
            <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
              <FolderGit2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono">{dashboard.projectCount}</div>
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <span className="text-primary">{dashboard.taskStatusBreakdown?.['pending'] ?? 0}</span>{' '}
            tasks pending
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">Active Tasks</h3>
            <div className="w-8 h-8 rounded-md bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono">{dashboard.activeTaskCount}</div>
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <span className="text-primary">{dashboard.taskStatusBreakdown?.['running'] || 0}</span>{' '}
            currently executing
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 hover:border-emerald-500/50 transition-colors shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">Tasks Completed</h3>
            <div className="w-8 h-8 rounded-md bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono">{dashboard.completedTaskCount}</div>
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            {successRate !== null ? (
              <>
                <span className="text-emerald-500 flex items-center">
                  <TrendingUp className="w-3 h-3 mr-1" /> {successRate}%
                </span>{' '}
                success rate
              </>
            ) : (
              <span>No completions yet</span>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 hover:border-destructive/50 transition-colors shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-sm text-muted-foreground">Failed Tasks</h3>
            <div className="w-8 h-8 rounded-md bg-destructive/10 text-destructive flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-bold font-mono">{dashboard.failedTaskCount}</div>
          <div className="mt-2 text-xs text-muted-foreground">Require attention</div>
        </div>
      </div>

      {/* Project scores + event stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project scores */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl shadow-sm">
          <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/50">
            <h2 className="font-semibold flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-primary" /> Project Health
            </h2>
            <Link href="/projects" className="text-xs text-primary hover:underline">
              View All
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-xs border-b border-border">
                  <th className="text-left p-4 font-medium">Project</th>
                  <th className="text-left p-4 font-medium">Score</th>
                  <th className="text-left p-4 font-medium">Trend</th>
                  <th className="text-left p-4 font-medium">Quality Bar</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.projectScores?.length ? (
                  dashboard.projectScores.map((ps) => (
                    <tr
                      key={ps.projectId}
                      className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                    >
                      <td className="p-4 font-medium">{ps.projectName}</td>
                      <td className="p-4 font-mono font-bold">
                        <span
                          className={
                            ps.score >= 80
                              ? 'text-emerald-500'
                              : ps.score >= 60
                              ? 'text-yellow-500'
                              : 'text-destructive'
                          }
                        >
                          {ps.score}
                        </span>
                        <span className="text-muted-foreground text-xs font-sans font-normal">
                          {' '}
                          / 100
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`text-xs font-medium ${
                            ps.trend === 'improving'
                              ? 'text-emerald-500'
                              : ps.trend === 'declining'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {ps.trend === 'improving' ? '↑' : ps.trend === 'declining' ? '↓' : '→'}{' '}
                          {ps.trend}
                        </span>
                      </td>
                      <td className="p-4 w-40">
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              ps.score >= 80
                                ? 'bg-emerald-500'
                                : ps.score >= 60
                                ? 'bg-yellow-500'
                                : 'bg-destructive'
                            }`}
                            style={{ width: `${ps.score}%` }}
                          ></div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="p-8 text-center">
                      <p className="text-muted-foreground text-sm mb-3">No projects yet.</p>
                      <Link
                        href="/projects"
                        className="inline-flex items-center gap-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 px-3 py-1.5 rounded-full font-medium transition-colors"
                      >
                        <FolderGit2 className="w-3.5 h-3.5" /> Connect your first repository →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Event stream */}
        <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col">
          <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/50">
            <h2 className="font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Event Stream
            </h2>
            <Link href="/events" className="text-xs text-primary hover:underline">
              View All
            </Link>
          </div>
          <div className="p-0 overflow-y-auto max-h-[400px]">
            {dashboard.recentEvents?.length ? (
              <div className="divide-y divide-border">
                {dashboard.recentEvents.map((event) => (
                  <div key={event.id} className="p-4 hover:bg-secondary/30 transition-colors">
                    <div className="flex gap-3">
                      <div className="mt-0.5">
                        {event.severity === 'error' ? (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        ) : event.severity === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : event.severity === 'warning' ? (
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                        ) : (
                          <Activity className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{event.message || event.type}</div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 font-mono">
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                          {event.projectId && (
                            <span>• Project: {event.projectId.slice(0, 8)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground text-sm">No recent events.</div>
            )}
          </div>
        </div>
      </div>

      {/* Top rules */}
      {dashboard.topRules && dashboard.topRules.length > 0 && (
        <div className="bg-card border border-border rounded-xl shadow-sm">
          <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/50">
            <h2 className="font-semibold">Top Triggered Rules</h2>
            <Link href="/rules" className="text-xs text-primary hover:underline">
              Manage Rules
            </Link>
          </div>
          <div className="divide-y divide-border">
            {dashboard.topRules.map((rule) => (
              <div
                key={rule.ruleId}
                className="p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs bg-secondary px-2 py-1 rounded border border-border">
                    {rule.code}
                  </span>
                  <span className="text-sm font-medium">{rule.title}</span>
                </div>
                <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                  {rule.hitCount} hits
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
