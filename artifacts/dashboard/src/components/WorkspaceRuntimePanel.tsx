import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RotateCw, Server, Square, TerminalSquare } from 'lucide-react';

type RuntimeStatus = 'stopped' | 'starting' | 'running' | 'failed';

type RuntimeSnapshot = {
  projectId: string;
  sessionId: string | null;
  status: RuntimeStatus;
  port: number | null;
  command: 'pnpm run dev';
  revision: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  pid: number | null;
  error: string | null;
  logs: string[];
};

const runtimeKey = (projectId: string) => ['workspace-runtime', projectId] as const;

async function readRuntime(projectId: string): Promise<RuntimeSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime`);
  if (!response.ok) throw new Error('Workspace runtime status is unavailable.');
  return response.json() as Promise<RuntimeSnapshot>;
}

async function mutateRuntime(projectId: string, action: 'start' | 'restart' | 'stop'): Promise<RuntimeSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Workspace runtime operation failed.');
  return payload as RuntimeSnapshot;
}

function statusLabel(status: RuntimeStatus): string {
  return status === 'running' ? 'Running' : status === 'starting' ? 'Starting' : status === 'failed' ? 'Failed' : 'Stopped';
}

export default function WorkspaceRuntimePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<'start' | 'restart' | 'stop' | null>(null);
  const runtimeQuery = useQuery({
    queryKey: runtimeKey(projectId),
    enabled: Boolean(projectId),
    queryFn: () => readRuntime(projectId),
    refetchInterval: (query) => {
      const status = (query.state.data as RuntimeSnapshot | undefined)?.status;
      return status === 'starting' || status === 'running' ? 2000 : false;
    },
  });
  const runtime = runtimeQuery.data;

  const runAction = async (nextAction: 'start' | 'restart' | 'stop') => {
    setAction(nextAction);
    try {
      const next = await mutateRuntime(projectId, nextAction);
      queryClient.setQueryData(runtimeKey(projectId), next);
    } catch (error) {
      queryClient.setQueryData(runtimeKey(projectId), (old: RuntimeSnapshot | undefined) => old
        ? { ...old, status: 'failed', error: error instanceof Error ? error.message : 'Runtime operation failed.' }
        : old);
    } finally {
      setAction(null);
      await runtimeQuery.refetch();
    }
  };

  if (runtimeQuery.isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm animate-pulse text-sm text-muted-foreground">
        Loading workspace runtime…
      </div>
    );
  }

  if (runtimeQuery.isError || !runtime) {
    return (
      <div className="bg-card border border-amber-500/30 rounded-xl p-5 shadow-sm text-sm text-amber-200">
        Workspace runtime status is unavailable. Refresh the project and try again.
      </div>
    );
  }

  const busy = action !== null || runtime.status === 'starting';
  const statusClass = runtime.status === 'running'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
    : runtime.status === 'failed'
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
      : runtime.status === 'starting'
        ? 'border-primary/30 bg-primary/5 text-primary'
        : 'border-border bg-secondary/30 text-muted-foreground';

  return (
    <section className="bg-card border border-border rounded-xl p-5 shadow-sm" aria-label="Workspace runtime">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" /> Workspace runtime
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Server-owned preview profile: <span className="font-mono">{runtime.command}</span>
          </p>
        </div>
        <div className={`rounded-md border px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel(runtime.status)}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">Port</div>
          <div className="font-mono text-foreground">{runtime.port ?? '—'}</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">Process</div>
          <div className="font-mono text-foreground">{runtime.pid ?? '—'}</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">Revision</div>
          <div className="font-mono text-foreground truncate">{runtime.revision ?? '—'}</div>
        </div>
      </div>

      {runtime.error && (
        <div className="mt-3 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-200" role="alert">
          {runtime.error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runAction('start')}
          disabled={busy || runtime.status === 'running'}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" /> Start preview
        </button>
        <button
          type="button"
          onClick={() => void runAction('restart')}
          disabled={busy || runtime.status === 'stopped'}
          className="border border-border hover:bg-secondary px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <RotateCw className="w-3.5 h-3.5" /> Restart
        </button>
        <button
          type="button"
          onClick={() => void runAction('stop')}
          disabled={busy || runtime.status === 'stopped'}
          className="border border-border hover:bg-secondary px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <Square className="w-3.5 h-3.5" /> Stop
        </button>
      </div>

      {runtime.logs.length > 0 && (
        <details className="mt-4 rounded-md border border-border/60 bg-secondary/20">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium flex items-center gap-2">
            <TerminalSquare className="w-3.5 h-3.5 text-muted-foreground" /> Recent runtime logs
          </summary>
          <pre className="max-h-48 overflow-auto border-t border-border/60 px-3 py-2 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
            {runtime.logs.join('\n')}
          </pre>
        </details>
      )}
    </section>
  );
}