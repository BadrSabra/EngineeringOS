import React, { useState } from 'react';
import {
  useListTasks,
  useExecuteTask,
  useRetryTask,
  useRollbackTask,
  useGetTaskLogs,
  getListTasksQueryKey,
  getGetTaskLogsQueryKey,
  type TaskLog,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Play,
  RotateCcw,
  RefreshCw,
  Search,
  TerminalSquare,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileCode,
  ChevronRight,
  ChevronDown,
  Terminal,
  X,
} from 'lucide-react';

// ─── Task logs sub-component ──────────────────────────────────────────────────
// Separated so the hook always runs unconditionally within the mounted component.

function TaskLogsPanel({ taskId }: { taskId: string }) {
  const { data: logs, isLoading } = useGetTaskLogs(taskId, {
    query: {
      queryKey: getGetTaskLogsQueryKey(taskId),
      staleTime: 10_000,
      refetchInterval: 5_000, // poll while running
    },
  });

  const levelColor = (level: TaskLog['level']) => {
    switch (level) {
      case 'error': return 'text-destructive';
      case 'warn':  return 'text-yellow-400';
      case 'info':  return 'text-primary';
      default:      return 'text-muted-foreground';
    }
  };

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <Terminal className="w-3.5 h-3.5" /> Execution Logs
      </h4>
      <div className="bg-background border border-border rounded-lg font-mono text-xs overflow-auto max-h-48 p-3 space-y-0.5">
        {isLoading ? (
          <span className="text-muted-foreground animate-pulse">Loading logs…</span>
        ) : !logs || logs.length === 0 ? (
          <span className="text-muted-foreground italic">No log entries yet.</span>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 leading-5">
              <span className="text-muted-foreground shrink-0 select-none">
                {new Date(log.timestamp).toLocaleTimeString('en', { hour12: false })}
              </span>
              <span className={`uppercase shrink-0 w-8 ${levelColor(log.level)}`}>
                {log.level.slice(0, 4)}
              </span>
              <span className="text-foreground break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Filter type aliases ──────────────────────────────────────────────────────
// Derived from the task_status and task_priority DB enums so the filter state
// is statically checked against the real API values — no `as any` casts needed.
type TaskStatusFilter = 'pending' | 'queued' | 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled';
type TaskPriorityFilter = 'p0' | 'p1' | 'p2' | 'p3';

// ─── Main component ───────────────────────────────────────────────────────────

export default function Tasks() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<TaskStatusFilter | ''>('');
  const [filterPriority, setFilterPriority] = useState<TaskPriorityFilter | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [logsTab, setLogsTab] = useState<Record<string, 'details' | 'logs'>>({});

  const { data: tasks, isLoading } = useListTasks(
    { status: filterStatus || undefined, priority: filterPriority || undefined },
    {
      query: {
        queryKey: getListTasksQueryKey({
          status: filterStatus || undefined,
          priority: filterPriority || undefined,
        }),
      },
    },
  );

  const executeTask = useExecuteTask();
  const retryTask   = useRetryTask();
  const rollbackTask = useRollbackTask();

  const visibleTasks = tasks?.filter((t) =>
    !searchTerm ||
    t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(searchTerm.toLowerCase()),
  ) ?? [];

  const handleAction = (action: 'execute' | 'retry' | 'rollback', taskId: string) => {
    const options = {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
    };
    if (action === 'execute') executeTask.mutate({ taskId }, options);
    if (action === 'retry')   retryTask.mutate({ taskId }, options);
    if (action === 'rollback') rollbackTask.mutate({ taskId }, options);
  };

  const getDetailTab = (taskId: string) => logsTab[taskId] ?? 'details';
  const setDetailTab = (taskId: string, tab: 'details' | 'logs') =>
    setLogsTab((prev) => ({ ...prev, [taskId]: tab }));

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'completed':         return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'failed':            return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case 'running':
      case 'verifying':         return <Activity className="w-4 h-4 text-primary animate-pulse" />;
      default:                  return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const PriorityBadge = ({ priority }: { priority: string }) => {
    const colors: Record<string, string> = {
      p0: 'bg-destructive/20 text-destructive border-destructive/30',
      p1: 'bg-orange-500/20 text-orange-500 border-orange-500/30',
      p2: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
      p3: 'bg-secondary text-muted-foreground border-border',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${colors[priority] ?? colors.p3}`}>
        {priority}
      </span>
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Backlog</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Orchestrate and monitor autonomous agent tasks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-secondary p-1 rounded-md border border-border">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as TaskStatusFilter | '')}
              className="bg-transparent text-sm px-2 py-1 outline-none text-foreground border-r border-border min-w-[120px]"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="verifying">Verifying</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as TaskPriorityFilter | '')}
              className="bg-transparent text-sm px-2 py-1 outline-none text-foreground min-w-[100px]"
            >
              <option value="">All Priorities</option>
              <option value="p0">P0 — Critical</option>
              <option value="p1">P1 — High</option>
              <option value="p2">P2 — Medium</option>
              <option value="p3">P3 — Low</option>
            </select>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search tasks..."
              className="bg-card border border-border rounded-md pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active filter badge */}
      {searchTerm && (
        <div className="shrink-0 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Showing</span>
          <span className="font-semibold">{visibleTasks.length}</span>
          <span className="text-muted-foreground">of {tasks?.length ?? 0} tasks matching</span>
          <span className="bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 rounded font-mono">
            {searchTerm}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <TerminalSquare className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {searchTerm ? 'No tasks match your search' : 'No tasks found'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {searchTerm
                ? 'Try a different search term or clear the filter.'
                : 'Tasks are created automatically when a project scan detects issues.'}
            </p>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <div
              key={task.id}
              className="bg-card border border-border rounded-xl overflow-hidden transition-all"
            >
              <div
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-secondary/30"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              >
                <StatusIcon status={task.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{task.title}</span>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-3">
                    <span
                      className={`uppercase font-bold ${
                        task.status === 'completed' ? 'text-emerald-500'
                        : task.status === 'failed'  ? 'text-destructive'
                        : task.status === 'running' ? 'text-primary'
                        : 'text-muted-foreground'
                      }`}
                    >
                      {task.status}
                    </span>
                    <span>•</span>
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                    {task.phase && (
                      <>
                        <span>•</span>
                        <span className="opacity-70">{task.phase}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(task.status === 'pending' || task.status === 'queued') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('execute', task.id); }}
                      disabled={executeTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="Execute"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('retry', task.id); }}
                      disabled={retryTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="Retry"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                  {task.status === 'completed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('rollback', task.id); }}
                      disabled={rollbackTask.isPending}
                      className="p-1.5 text-muted-foreground hover:bg-secondary rounded transition-colors disabled:opacity-50"
                      title="Rollback"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  {expandedTask === task.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedTask === task.id && (
                <div className="border-t border-border bg-secondary/20">
                  {/* Tab bar */}
                  <div className="flex gap-1 p-3 pb-0">
                    {(['details', 'logs'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(task.id, tab)}
                        className={`text-xs px-3 py-1.5 rounded-t-md font-medium capitalize transition-colors ${
                          getDetailTab(task.id) === tab
                            ? 'bg-card border border-border border-b-card text-foreground -mb-px relative z-10'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'logs' ? <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> Logs</span> : 'Details'}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div className="p-4 pt-3 text-sm">
                    {getDetailTab(task.id) === 'details' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Task Details
                          </h4>
                          {task.description && (
                            <p className="text-muted-foreground mb-3">{task.description}</p>
                          )}
                          {task.relatedFiles && task.relatedFiles.length > 0 && (
                            <div className="mb-4">
                              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                <FileCode className="w-3 h-3" /> Related Files
                              </div>
                              <div className="space-y-1">
                                {task.relatedFiles.map((f, i) => (
                                  <div
                                    key={i}
                                    className="text-xs font-mono bg-background border border-border rounded px-2 py-1 truncate"
                                  >
                                    {f}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2 mt-4 font-mono">
                            <div>Created: {new Date(task.createdAt).toLocaleString()}</div>
                            <div>Phase: {task.phase || 'default'}</div>
                            <div>Retries: {task.retryCount || 0}/{task.maxRetries || 3}</div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Execution Data
                          </h4>
                          {task.prompt ? (
                            <div className="mb-4">
                              <div className="text-xs text-muted-foreground mb-1">Agent Prompt:</div>
                              <div className="bg-background border border-border rounded p-3 text-xs font-mono overflow-auto max-h-32 text-muted-foreground">
                                {task.prompt}
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground italic mb-4">
                              No prompt generated yet.
                            </div>
                          )}
                          {task.verificationResult && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-2">
                                Verification Steps:
                              </div>
                              <div className="space-y-2">
                                {task.verificationResult.steps.map((step, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2 text-sm bg-background border border-border rounded px-3 py-2"
                                  >
                                    {step.passed ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    ) : (
                                      <AlertTriangle className="w-4 h-4 text-destructive" />
                                    )}
                                    <span className="font-mono">{step.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <TaskLogsPanel taskId={task.id} />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
