import React, { useState } from 'react';
import {
  useListTasks,
  useExecuteTask,
  useRetryTask,
  useRollbackTask,
  getListTasksQueryKey,
  type Task,
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
} from 'lucide-react';

export default function Tasks() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');

  const { data: tasks, isLoading } = useListTasks(
    { status: filterStatus as any, priority: filterPriority as any },
    {
      query: {
        queryKey: getListTasksQueryKey({
          status: filterStatus as any,
          priority: filterPriority as any,
        }),
      },
    },
  );

  const executeTask = useExecuteTask();
  const retryTask = useRetryTask();
  const rollbackTask = useRollbackTask();

  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const handleAction = (action: 'execute' | 'retry' | 'rollback', taskId: string) => {
    const options = {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
    };
    if (action === 'execute') executeTask.mutate({ taskId }, options);
    if (action === 'retry') retryTask.mutate({ taskId }, options);
    if (action === 'rollback') rollbackTask.mutate({ taskId }, options);
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'failed':
        return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case 'running':
      case 'verifying':
        return <Activity className="w-4 h-4 text-primary animate-pulse" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
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
      <span
        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
          colors[priority] || colors.p3
        }`}
      >
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
              onChange={(e) => setFilterStatus(e.target.value)}
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
              onChange={(e) => setFilterPriority(e.target.value)}
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
              placeholder="Search tasks..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : tasks?.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <TerminalSquare className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No tasks found</h3>
            <p className="text-muted-foreground text-sm">
              Tasks are created automatically when a project scan detects issues.
            </p>
          </div>
        ) : (
          tasks?.map((task) => (
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
                        task.status === 'completed'
                          ? 'text-emerald-500'
                          : task.status === 'failed'
                          ? 'text-destructive'
                          : task.status === 'running'
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {task.status}
                    </span>
                    <span>•</span>
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {task.status === 'pending' || task.status === 'queued' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('execute', task.id);
                      }}
                      disabled={executeTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="Execute"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  ) : task.status === 'failed' ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('retry', task.id);
                      }}
                      disabled={retryTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="Retry"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  ) : null}
                  {task.status === 'completed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAction('rollback', task.id);
                      }}
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
                <div className="border-t border-border bg-secondary/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
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
                      <div>
                        Retries: {task.retryCount || 0}/{task.maxRetries || 3}
                      </div>
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
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
