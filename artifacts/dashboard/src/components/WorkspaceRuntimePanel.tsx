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

class RuntimeProjectScopeError extends Error {
  constructor() {
    super('أعاد الخادم حالة تشغيل تخص مشروعًا آخر. لم نعرض بياناتها داخل مساحة هذا المشروع.');
    this.name = 'RuntimeProjectScopeError';
  }
}

function assertRuntimeProject(value: unknown, projectId: string): RuntimeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as { projectId?: unknown }).projectId !== projectId) {
    throw new RuntimeProjectScopeError();
  }
  return value as RuntimeSnapshot;
}

async function readRuntime(projectId: string): Promise<RuntimeSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime`);
  if (!response.ok) throw new Error('تعذّر تحميل حالة تشغيل المشروع.');
  const payload: unknown = await response.json();
  return assertRuntimeProject(payload, projectId);
}

async function mutateRuntime(projectId: string, action: 'start' | 'restart' | 'stop'): Promise<RuntimeSnapshot> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && typeof payload === 'object'
      && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : 'تعذّر تنفيذ الإجراء على تشغيل المشروع.';
    throw new Error(message);
  }
  return assertRuntimeProject(payload, projectId);
}

function statusLabel(status: RuntimeStatus): string {
  return status === 'running' ? 'قيد التشغيل' : status === 'starting' ? 'جارٍ التشغيل' : status === 'failed' ? 'تعذّر التشغيل' : 'متوقّف';
}

export default function WorkspaceRuntimePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const actionRequestId = useRef(0);
  const [pendingAction, setPendingAction] = useState<{
    projectId: string;
    requestId: number;
    action: 'start' | 'restart' | 'stop';
  } | null>(null);
  const [actionError, setActionError] = useState<{ projectId: string; message: string } | null>(null);
  const runtimeQuery = useQuery({
    queryKey: runtimeKey(projectId),
    enabled: Boolean(projectId),
    queryFn: () => readRuntime(projectId),
    refetchInterval: (query) => {
      const status = (query.state.data as RuntimeSnapshot | undefined)?.status;
      return status === 'starting' || status === 'running' ? 2000 : false;
    },
  });
  const runtime = runtimeQuery.data?.projectId === projectId ? runtimeQuery.data : undefined;
  const projectAction = pendingAction?.projectId === projectId ? pendingAction : null;
  const projectActionError = actionError?.projectId === projectId ? actionError.message : null;

  const runAction = async (nextAction: 'start' | 'restart' | 'stop') => {
    const requestId = ++actionRequestId.current;
    setPendingAction({ projectId, requestId, action: nextAction });
    setActionError(null);
    try {
      const next = await mutateRuntime(projectId, nextAction);
      queryClient.setQueryData(runtimeKey(projectId), next);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'تعذّر تنفيذ الإجراء على تشغيل المشروع.';
      if (error instanceof RuntimeProjectScopeError) {
        // A mismatched response is not authoritative for either project's cache.
        setActionError({ projectId, message });
      } else {
        queryClient.setQueryData(runtimeKey(projectId), (old: RuntimeSnapshot | undefined) => old
          ? { ...old, status: 'failed', error: message }
          : old);
      }
    } finally {
      setPendingAction((current) => current?.requestId === requestId ? null : current);
      // Invalidate the captured project's key. Never refetch whichever project
      // happens to be active after this asynchronous action settles.
      await queryClient.invalidateQueries({ queryKey: runtimeKey(projectId), exact: true });
    }
  };

  if (runtimeQuery.isLoading && !runtime) {
    return (
      <div dir="rtl" className="bg-card border border-border rounded-xl p-5 shadow-sm animate-pulse text-sm text-muted-foreground">
        جارٍ تحميل حالة تشغيل المشروع…
      </div>
    );
  }

  if (runtimeQuery.isError || !runtime) {
    const message = runtimeQuery.error instanceof RuntimeProjectScopeError
      ? runtimeQuery.error.message
      : runtimeQuery.data && runtimeQuery.data.projectId !== projectId
        ? 'بيانات التشغيل المحفوظة تخص مشروعًا آخر؛ لم نعرضها داخل مساحة هذا المشروع.'
        : 'تعذّر تحميل حالة تشغيل المشروع. حدّث المشروع وحاول مرة أخرى.';
    return (
      <div dir="rtl" className="bg-card border border-amber-500/30 rounded-xl p-5 shadow-sm text-sm text-amber-200" role="alert">
        {message}
        <button
          type="button"
          className="mr-2 underline underline-offset-2"
          onClick={() => void runtimeQuery.refetch()}
          disabled={runtimeQuery.isFetching}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  const busy = projectAction !== null || runtime.status === 'starting';
  const action = projectAction?.action ?? null;
  const statusClass = runtime.status === 'running'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
    : runtime.status === 'failed'
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
      : runtime.status === 'starting'
        ? 'border-primary/30 bg-primary/5 text-primary'
        : 'border-border bg-secondary/30 text-muted-foreground';

  return (
    <section className="bg-card border border-border rounded-xl p-5 shadow-sm" aria-label="تشغيل المشروع" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" /> تشغيل المشروع
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            إعداد المعاينة يديره الخادم: <span className="font-mono" dir="ltr">{runtime.command}</span>
          </p>
        </div>
        <div className={`rounded-md border px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel(runtime.status)}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">المنفذ</div>
          <div className="font-mono text-foreground" dir="ltr">{runtime.port ?? '—'}</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">معرّف العملية</div>
          <div className="font-mono text-foreground" dir="ltr">{runtime.pid ?? '—'}</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-muted-foreground mb-1">مراجعة الملفات</div>
          <div className="font-mono text-foreground truncate" dir="ltr">{runtime.revision ?? '—'}</div>
        </div>
      </div>

      {runtime.error && (
        <div className="mt-3 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-200" role="alert">
          <span dir="auto">{runtime.error}</span>
        </div>
      )}
      {projectActionError && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-100" role="alert">
          <span dir="auto">{projectActionError}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runAction('start')}
          disabled={busy || runtime.status === 'running'}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" /> تشغيل المعاينة
        </button>
        <button
          type="button"
          onClick={() => void runAction('restart')}
          disabled={busy || runtime.status === 'stopped'}
          className="border border-border hover:bg-secondary px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <RotateCw className="w-3.5 h-3.5" /> إعادة التشغيل
        </button>
        <button
          type="button"
          onClick={() => void runAction('stop')}
          disabled={busy || runtime.status === 'stopped'}
          className="border border-border hover:bg-secondary px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
        >
          <Square className="w-3.5 h-3.5" /> إيقاف التشغيل
        </button>
      </div>

      {runtime.logs.length > 0 && (
        <details className="mt-4 rounded-md border border-border/60 bg-secondary/20">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium flex items-center gap-2">
            <TerminalSquare className="w-3.5 h-3.5 text-muted-foreground" /> سجل التشغيل الأخير
          </summary>
          <pre dir="ltr" className="max-h-48 overflow-auto border-t border-border/60 px-3 py-2 text-left text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap">
            {runtime.logs.join('\n')}
          </pre>
        </details>
      )}
    </section>
  );
}