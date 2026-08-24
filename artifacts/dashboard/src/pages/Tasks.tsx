import React, { useState, useEffect, useRef } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
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
  Wifi,
  WifiOff,
  ShieldCheck,
  FileCheck2,
} from 'lucide-react';

// ─── Task logs sub-component ──────────────────────────────────────────────────
// Separated so the hook always runs unconditionally within the mounted component.

function stepIcon(message: string, level: TaskLog['level']): string {
  if (level === 'error') return '❌';
  if (level === 'warn')  return '⚠️';
  const m = message.toLowerCase();
  if (m.includes('read_file') || m.includes('list_dir'))   return '📂';
  if (m.includes('search_code') || m.includes('search'))   return '🔍';
  if (m.includes('write_file'))                             return '✏️';
  if (m.includes('git_'))                                   return '🔀';
  if (m.includes('calling ai') || m.includes('agent…') || m.includes('model')) return '🧠';
  if (m.includes('project context') || m.includes('context')) return '📋';
  if (m.includes('completed') || m.includes('confidence'))  return '✅';
  if (m.includes('started') || m.includes('trigger'))       return '🚀';
  if (m.includes('auto-execution') || m.includes('auto-trigger')) return '⚡';
  return '·';
}

type TaskView = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  phase?: string;
  relatedFiles?: string[];
  retryCount?: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  agentResponse?: string;
  verificationResult?: {
    passed: boolean;
    steps: Array<{ name: string; passed: boolean; output?: string }>;
  };
};

type TaskExecutionReceipt = {
  kind?: string;
  operationId?: string;
  correlationId?: string;
  revision?: string | null;
  provider?: string;
  model?: string;
  attempt?: number;
  attempts?: number;
  durationMs?: number;
  stages?: string[];
  terminalStatus?: 'SUCCEEDED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  terminalReason?: string;
  summary?: string;
};

function parseExecutionReceipt(raw: string | undefined): TaskExecutionReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TaskExecutionReceipt;
    return value && value.kind === 'AI_TASK_EXECUTION_RECEIPT' ? value : null;
  } catch {
    return null;
  }
}

function safeTaskText(value: unknown, fallback = 'No additional detail available.'): string {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/\/(?:home\/runner|workspace|tmp)\/[^\s"'<>),;]+/g, '[project path]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[internal id]')
    .replace(/\b(?:sk|key|token|secret)[-_]?[a-z0-9]{12,}\b/gi, '[redacted]')
    .slice(0, 300);
}

type ActivityItem = {
  key: string;
  kind: 'activity' | 'evidence' | 'warning' | 'error' | 'result';
  label: string;
  summary: string;
  timestamp: string;
  count: number;
};

const MAX_RECONNECT_ATTEMPTS = 5;

function activityItem(log: TaskLog): ActivityItem {
  const message = safeTaskText(log.message);
  const lower = message.toLowerCase();
  const kind = log.level === 'error'
    ? 'error'
    : log.level === 'warn'
      ? 'warning'
      : /verification|confirmed|completed|passed/.test(lower)
        ? 'result'
        : /file|pattern|search|project root/.test(lower)
          ? 'evidence'
          : 'activity';
  const label = kind === 'evidence' ? 'Evidence collected'
    : kind === 'result' ? 'Verification result'
      : kind === 'warning' ? 'Needs attention'
        : kind === 'error' ? 'Execution error'
          : 'Activity';
  return { key: `${kind}:${message}`, kind, label, summary: message, timestamp: log.timestamp, count: 1 };
}

function groupActivity(logs: TaskLog[]): ActivityItem[] {
  const groups: ActivityItem[] = [];
  for (const log of [...logs].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    const item = activityItem(log);
    const previous = groups[groups.length - 1];
    if (previous?.key === item.key) previous.count += 1;
    else groups.push(item);
  }
  return groups;
}

function taskPlan(task: TaskView): Array<{ title: string; status: 'done' | 'active' | 'pending' | 'blocked'; detail: string }> {
  const terminal = ['completed', 'failed', 'cancelled'].includes(task.status);
  const verificationDone = Boolean(task.verificationResult);
  return [
    { title: 'Understand the task', status: 'done', detail: 'Task goal and project scope recorded.' },
    { title: 'Execute the approved workflow', status: task.status === 'pending' || task.status === 'queued' ? 'pending' : 'done', detail: 'Only the existing task execution path is used.' },
    { title: 'Verify the result', status: verificationDone ? 'done' : task.status === 'running' || task.status === 'verifying' ? 'active' : terminal ? 'blocked' : 'pending', detail: verificationDone ? 'Verification result recorded by the server.' : 'Waiting for a server-owned verification result.' },
    { title: 'Report outcome', status: terminal ? 'done' : 'pending', detail: terminal ? 'Final outcome is preserved below.' : 'The final report will remain available after completion.' },
  ];
}

function TaskLogsPanel({ task, taskStatus }: { task: TaskView; taskStatus: string }) {
  const taskId = task.id;
  const isRunning = taskStatus === 'running';

  // Live logs accumulated via SSE while the task is running
  const [liveLogs, setLiveLogs] = useState<TaskLog[]>([]);
  const [sseActive, setSseActive] = useState(false);
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'exhausted' | 'disconnected'>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    if (!isRunning) {
      setLiveLogs([]);
      seenIds.current.clear();
      setSseActive(false);
      setConnectionState('disconnected');
      return;
    }

    const es = new EventSource(`/api/tasks/${taskId}/logs/stream`);
    setSseActive(true);
    setConnectionState('connected');

    es.addEventListener('log', (e) => {
      try {
        const log = JSON.parse(e.data) as TaskLog;
        if (seenIds.current.has(log.id)) return;
        seenIds.current.add(log.id);
        setLiveLogs((prev) => [...prev, log].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)));
      } catch { /* ignore malformed frames */ }
    });

    es.addEventListener('done', () => {
      es.close();
      setSseActive(false);
      setConnectionState('disconnected');
      setReconnectAttempt(0);
    });

    es.onerror = () => {
      es.close();
      setSseActive(false);
      if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('reconnecting');
        reconnectTimer.current = setTimeout(
          () => setReconnectAttempt((attempt) => attempt + 1),
          Math.min(1000 * 2 ** reconnectAttempt, 8000),
        );
      } else {
        setConnectionState('exhausted');
      }
    };

    return () => {
      es.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      setSseActive(false);
      setConnectionState('disconnected');
    };
  }, [taskId, isRunning, reconnectAttempt]);

  // REST fallback: poll after task finishes or when SSE isn't active
  const { data: polledLogs, isLoading, isError: logsError, refetch: refetchLogs } = useGetTaskLogs(taskId, {
    query: {
      queryKey: getGetTaskLogsQueryKey(taskId),
      staleTime: 5_000,
      refetchInterval: 5_000,
      enabled: true,
    },
  });

  // While running show SSE stream (oldest-first); after done show REST result (reversed)
  const allLogs = new Map<string, TaskLog>();
  for (const log of polledLogs ?? []) allLogs.set(log.id, log);
  for (const log of liveLogs) allLogs.set(log.id, log);
  const logs: TaskLog[] = [...allLogs.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const operationId = logs
    .map((log) => log.metadata?.operationId)
    .find((value): value is string => typeof value === 'string');
  const groupedActivity = groupActivity(logs);
  const plan = taskPlan(task);
  const completedSteps = plan.filter((step) => step.status === 'done').length;
  const elapsedMs = Math.max(0, new Date((task.completedAt ?? task.updatedAt)).getTime() - new Date(task.createdAt).getTime());
  const elapsed = `${Math.floor(elapsedMs / 60_000)}m ${Math.floor((elapsedMs % 60_000) / 1000)}s`;
  const final = ['completed', 'failed', 'cancelled'].includes(taskStatus);
  const retryLiveUpdates = () => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    setReconnectAttempt(0);
    setConnectionState('reconnecting');
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {[
          ['Goal', task.title],
          ['Status', taskStatus],
          ['Phase', task.phase || 'Execution'],
          ['Progress', `${completedSteps}/${plan.length} steps`],
          ['Elapsed', elapsed],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-background p-3 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="text-sm font-medium truncate mt-1">{value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mb-4 text-xs">
        <span className="text-muted-foreground">Last confirmed update: {new Date(task.updatedAt).toLocaleString()}</span>
        {isRunning && (
          <span
            className={`flex items-center gap-1.5 ${connectionState === 'connected' ? 'text-emerald-500' : connectionState === 'exhausted' ? 'text-destructive' : 'text-yellow-500'}`}
            aria-live="polite"
          >
            {connectionState === 'connected' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'exhausted'
                ? 'Reconnect exhausted'
                : `Reconnecting… (attempt ${reconnectAttempt + 1} of ${MAX_RECONNECT_ATTEMPTS})`}
          </span>
        )}
      </div>
      {isRunning && connectionState === 'reconnecting' && (
        <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300" role="status">
          Temporary stream failure. Retrying live task updates; the task itself is still running.
        </div>
      )}
      {isRunning && connectionState === 'exhausted' && (
        <div
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs"
          role="alert"
          data-operation-id={operationId}
        >
          <p className="font-medium text-destructive">Live task updates could not reconnect.</p>
          <p className="mt-1 text-muted-foreground">
            Reconnect attempts are exhausted. The task has not been marked failed; refresh the task logs to see the latest confirmed state.
            {operationId && <> Operation: <span className="font-mono">{safeTaskText(operationId)}</span>.</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={retryLiveUpdates} className="inline-flex items-center gap-1.5 font-medium text-foreground underline">
              <RotateCcw className="w-3.5 h-3.5" /> Retry live updates
            </button>
            <button type="button" onClick={() => void refetchLogs()} className="inline-flex items-center gap-1.5 font-medium text-foreground underline">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh task logs
            </button>
          </div>
        </div>
      )}
      <section aria-labelledby={`plan-${taskId}`} className="mb-5">
        <h4 id={`plan-${taskId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Execution plan</h4>
        <div className="border border-border rounded-lg divide-y divide-border bg-background">
          {plan.map((step, index) => (
            <div key={step.title} className="flex items-start gap-3 p-3">
              <span className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${step.status === 'done' ? 'border-emerald-500 text-emerald-500' : step.status === 'active' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                {step.status === 'done' ? '✓' : index + 1}
              </span>
              <div className="min-w-0"><div className="text-sm font-medium">{step.title}</div><div className="text-xs text-muted-foreground mt-0.5">{step.detail}</div></div>
              <span className="ml-auto text-[10px] uppercase text-muted-foreground">{step.status}</span>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby={`activity-${taskId}`}>
        <h4 id={`activity-${taskId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> Activity
          {isRunning && sseActive && <span className="ml-auto text-primary animate-pulse font-normal normal-case tracking-normal">Live updates</span>}
        </h4>
      <div className="bg-background border border-border rounded-lg text-xs overflow-auto max-h-72 p-3 space-y-2">
        {!isRunning && isLoading ? (
          <span className="text-muted-foreground animate-pulse">Loading activity…</span>
        ) : logsError ? (
          <div className="text-destructive">
            <p>Could not load execution logs.</p>
            <button type="button" onClick={() => void refetchLogs()} className="mt-2 underline">Retry logs</button>
          </div>
        ) : logs.length === 0 ? (
          <span className="text-muted-foreground italic">
            {isRunning ? 'Waiting for confirmed activity…' : 'No activity recorded.'}
          </span>
        ) : (
          groupedActivity.map((item) => (
            <details key={item.key} open={item.kind === 'warning' || item.kind === 'error'} className={`rounded-md border p-2 ${item.kind === 'error' ? 'border-destructive/40' : item.kind === 'warning' ? 'border-yellow-500/40' : 'border-border'}`}>
              <summary className="flex items-start gap-2 cursor-pointer list-none">
                <span className={`text-base shrink-0 ${item.kind === 'error' ? 'text-destructive' : item.kind === 'warning' ? 'text-yellow-500' : ''}`}>{item.kind === 'result' ? '✓' : stepIcon(item.summary, item.kind === 'error' ? 'error' : item.kind === 'warning' ? 'warn' : 'info')}</span>
                <span className="flex-1"><span className="font-medium">{item.label}</span><span className="text-muted-foreground"> — {item.summary}</span></span>
                {item.count > 1 && <span className="text-muted-foreground">×{item.count}</span>}
              </summary>
              <div className="pl-6 pt-1 text-[10px] text-muted-foreground">Confirmed {new Date(item.timestamp).toLocaleTimeString('en', { hour12: false })}</div>
            </details>
          ))
        )}
      </div>
      </section>
      {final && (
        <section aria-labelledby={`report-${taskId}`} className="mt-5 rounded-lg border border-border bg-background p-4">
          <h4 id={`report-${taskId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            {task.verificationResult?.passed ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : <FileCheck2 className="w-4 h-4 text-muted-foreground" />}
            Final report
          </h4>
           <p className="text-sm font-medium">
             {taskStatus === 'completed' && task.verificationResult?.passed
               ? 'Task completed and verified by the server.'
               : taskStatus === 'completed'
                 ? 'Task completed, but no passed server verification is recorded.'
                 : taskStatus === 'cancelled'
                   ? 'Task cancelled before completion.'
                   : 'Task ended without a confirmed successful verification.'}
           </p>
          {task.verificationResult?.steps?.length ? (
            <div className="mt-3 space-y-1">{task.verificationResult.steps.map((step) => (
              <div key={step.name} className="flex items-center gap-2 text-xs">
                {step.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
                <span>{step.name}</span><span className="text-muted-foreground">— {safeTaskText(step.output, step.passed ? 'Passed' : 'Not confirmed')}</span>
              </div>
            ))}</div>
          ) : <p className="text-xs text-muted-foreground mt-2">No server-owned verification details were recorded.</p>}
        </section>
      )}
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

  const { data: tasks, isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useListTasks(
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

  const { toast } = useToast();
  const executeTask = useExecuteTask();
  const retryTask   = useRetryTask();
  const rollbackTask = useRollbackTask();

  const visibleTasks = tasks?.filter((t) =>
    !searchTerm ||
    t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(searchTerm.toLowerCase()),
  ) ?? [];

  const handleAction = (action: 'execute' | 'retry' | 'rollback', taskId: string) => {
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    const options = {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
      onError: (err: unknown) => {
        const description = err instanceof Error ? err.message : 'Request failed — check the API server logs.';
        toast({ title: `${label} failed`, description, variant: 'destructive' });
      },
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
          <RefreshButton onRefresh={refetch} isRefreshing={isRefetching} lastUpdated={dataUpdatedAt} label="Refresh tasks" />
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
        ) : isError ? (
          <RequestError
            message={error instanceof Error ? error.message : 'Unable to load tasks.'}
            onRetry={() => void refetch()}
          />
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
                role="button"
                tabIndex={0}
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-secondary/30"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedTask(expandedTask === task.id ? null : task.id);
                  }
                }}
                aria-expanded={expandedTask === task.id}
                aria-controls={`task-details-${task.id}`}
                aria-label={`${expandedTask === task.id ? 'Collapse' : 'Expand'} task ${task.title}`}
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
                <div id={`task-details-${task.id}`} className="border-t border-border bg-secondary/20">
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
                          <div className="mb-4 rounded-lg border border-border bg-background p-3">
                            <div className="text-xs text-muted-foreground mb-1">Execution boundary</div>
                            <div className="text-sm">The agent can report activity and verification here. Internal prompts and provider diagnostics are not shown.</div>
                          </div>
                          {(() => {
                            const receipt = parseExecutionReceipt(task.agentResponse);
                            if (!receipt) return null;
                            return (
                              <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span className="font-semibold uppercase tracking-wider">Execution receipt</span>
                                  <span className={receipt.terminalStatus === 'SUCCEEDED' ? 'text-emerald-500' : receipt.terminalStatus === 'BLOCKED' ? 'text-amber-500' : 'text-destructive'}>
                                    {receipt.terminalStatus ?? 'RECORDED'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-muted-foreground font-mono">
                                  <span>Provider: {receipt.provider ?? '—'}</span>
                                  <span>Model: {receipt.model ?? '—'}</span>
                                  <span>Attempts: {receipt.attempts ?? 1}</span>
                                  <span>Duration: {receipt.durationMs != null ? `${receipt.durationMs}ms` : '—'}</span>
                                </div>
                                {receipt.terminalReason && <div className="mt-2 text-muted-foreground">Reason: {safeTaskText(receipt.terminalReason)}</div>}
                                {receipt.operationId && <div className="mt-2 truncate text-muted-foreground">Operation: {safeTaskText(receipt.operationId)}</div>}
                              </div>
                            );
                          })()}
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
                      <TaskLogsPanel task={task} taskStatus={task.status} />
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
