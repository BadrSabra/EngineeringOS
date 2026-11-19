import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceEventStream } from '@/pages/project-workspace/use-workspace-event-stream';
import PreviewAgentPanel from '@/pages/project-workspace/PreviewAgentPanel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useRoute } from 'wouter';
import { Activity, AlertTriangle, ArrowRight, Check, Clock3, Code2, GitBranch, Layers3, RefreshCw, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { useGetProjectWorkspaceSnapshot, getGetProjectWorkspaceSnapshotQueryKey, getGetAiExecutionQueryKey, useGetTask, getGetTaskQueryKey, useGetTaskLogs, getGetTaskLogsQueryKey, useGetAiExecution } from '@workspace/api-client-react';
import AiChat from '@/pages/AiChat';
import ProjectCanvasPanel from '@/pages/project-workspace/ProjectCanvasPanel';
import WorkspaceExecutionDetail from '@/pages/project-workspace/WorkspaceExecutionDetail';

const statusLabels: Record<string, string> = {
  active: 'نشط',
  scanning: 'قيد الفحص',
  paused: 'متوقف مؤقتًا',
  archived: 'مؤرشف',
  queued: 'في قائمة الانتظار',
  verifying: 'قيد التحقق',
  running: 'قيد التنفيذ',
  cancelling: 'جارٍ الإيقاف',
  completed: 'مكتمل',
  failed: 'تعثر',
  cancelled: 'أُلغي',
  pending: 'بانتظار المراجعة',
  applied: 'طُبّق',
  rejected: 'مرفوض',
  stopped: 'متوقف',
  starting: 'يبدأ الآن',
  unknown: 'غير معروف',
  verified: 'تم التحقق',
  incomplete: 'غير مكتمل',
  proposed: 'مقترح',
  isolated: 'معزول',
  validated: 'اجتاز التحقق',
  conflicted: 'متعارض',
  committed: 'أُنشئ له التزام',
  abandoned: 'متروك',
  blocked: 'محظور',
};

const warningLabels: Record<string, string> = {
  'tasks source unavailable': 'تعذر قراءة مصدر المهام.',
  'executions source unavailable': 'تعذر قراءة مصدر التنفيذ.',
  'candidate source unavailable': 'تعذر قراءة مصدر المرشح.',
  'runtime source unavailable': 'تعذر قراءة مصدر التشغيل.',
};

function label(value: string | null | undefined) {
  if (!value) return 'غير متاح';
  return statusLabels[value] ?? value.replaceAll('_', ' ');
}

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function Identifier({ children }: { children: string | number | null | undefined }) {
  if (children === null || children === undefined || children === '') return <span>—</span>;
  return <bdi dir="ltr" className="workspace-identifier">{children}</bdi>;
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="جارٍ تحميل مساحة المشروع">
      <div className="workspace-skeleton h-36 rounded-2xl" />
      <div className="workspace-layout-skeleton">
        <div className="workspace-skeleton h-[560px] rounded-2xl" />
        <div className="workspace-skeleton h-[560px] rounded-2xl" />
        <div className="space-y-4">
          <div className="workspace-skeleton h-48 rounded-2xl" />
          <div className="workspace-skeleton h-48 rounded-2xl" />
          <div className="workspace-skeleton h-36 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function SourceNote({ available, children }: { available: boolean; children: ReactNode }) {
  return available ? null : (
    <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-200/[.06] px-3 py-2 text-xs leading-6 text-amber-100/80" role="status">
      {children}
    </p>
  );
}


type WorkspaceTaskSummaryItem = {
  id: string;
  title: string;
  status: string;
  verificationDecision: string | null;
  updatedAt: string;
};

function isRecordedAttempt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function WorkspaceTaskCard({
  projectId,
  task,
}: {
  projectId: string;
  task: WorkspaceTaskSummaryItem;
}) {
  const taskQuery = useGetTask(task.id, {
    query: {
      queryKey: getGetTaskQueryKey(task.id),
      staleTime: 0,
    },
  });
  const taskDetails = taskQuery.data;
  const summaryUpdatedAt = Date.parse(task.updatedAt);
  const detailsUpdatedAt = taskDetails ? Date.parse(taskDetails.updatedAt) : Number.NaN;
  const taskMatchesSnapshot = Boolean(
    !taskQuery.isFetching
    && !taskQuery.isError
    && taskDetails
    && taskDetails.id === task.id
    && taskDetails.projectId === projectId
    && taskDetails.status === task.status
    && Number.isFinite(summaryUpdatedAt)
    && Number.isFinite(detailsUpdatedAt)
    && summaryUpdatedAt === detailsUpdatedAt,
  );
  const currentCorrelationId = taskMatchesSnapshot
    && typeof taskDetails?.correlationId === 'string'
    && taskDetails.correlationId.trim()
    ? taskDetails.correlationId.trim()
    : null;
  const taskLogsQuery = useGetTaskLogs(task.id, {
    query: {
      queryKey: getGetTaskLogsQueryKey(task.id),
      enabled: Boolean(currentCorrelationId),
      staleTime: 0,
      refetchInterval: task.status === 'running' ? 5_000 : false,
    },
  });
  // The log endpoint is queried for this task, but keep the response's own
  // identity as an independent boundary before using it to discover executions.
  const taskLogsBelongToTask = (taskLogsQuery.data ?? []).every(
    (log) => log.taskId === task.id,
  );
  const latestExecutionLog = taskLogsBelongToTask
    ? (taskLogsQuery.data ?? [])
      .filter((log) =>
        log.correlationId === currentCorrelationId
        && typeof log.executionId === 'string'
        && log.executionId.trim().length > 0)
      .sort((left, right) =>
        (left.sequence ?? -1) - (right.sequence ?? -1)
        || Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)))
      .at(-1)
    : undefined;
  const executionId = latestExecutionLog?.executionId ?? '';
  const executionQuery = useGetAiExecution(executionId, {
    query: {
      queryKey: getGetAiExecutionQueryKey(executionId),
      enabled: Boolean(executionId),
      staleTime: 0,
      refetchInterval: task.status === 'running' ? 5_000 : false,
    },
  });
  const execution = executionQuery.data;
  const executionMatchesTask = Boolean(
    !taskLogsQuery.isFetching
    && !taskLogsQuery.isError
    && taskLogsBelongToTask
    && !executionQuery.isFetching
    && !executionQuery.isError
    && execution
    && execution.id === executionId
    && execution.projectId === projectId
    && execution.correlationId === currentCorrelationId
    && execution.linkedTaskId === task.id,
  );
  const rawExecutionAttempt = execution?.attempt;
  const executionAttempt = executionMatchesTask && isRecordedAttempt(rawExecutionAttempt)
    ? rawExecutionAttempt
    : null;
  const rawAcceptanceAttempt = taskDetails?.acceptance?.attempt;
  const acceptanceAttempt = taskMatchesSnapshot
    && currentCorrelationId !== null
    && task.status !== 'running'
    && isRecordedAttempt(rawAcceptanceAttempt)
    ? rawAcceptanceAttempt
    : null;
  const attempt = executionAttempt ?? acceptanceAttempt;
  const rawDependencies = taskDetails?.dependsOn;
  const dependencyIds = taskMatchesSnapshot
    && Array.isArray(rawDependencies)
    && rawDependencies.every((dependencyId) =>
      typeof dependencyId === 'string' && dependencyId.trim().length > 0)
    ? [...new Set(rawDependencies.map((dependencyId) => dependencyId.trim()))]
    : null;

  let attemptContext = 'لا تتوفر محاولة مرتبطة في القراءة الحالية.';
  if (taskQuery.isLoading) {
    attemptContext = 'جارٍ مطابقة سجل المهمة مع لقطة Workspace.';
  } else if (taskQuery.isError) {
    attemptContext = 'تعذر قراءة سجل المهمة؛ لم نعرض رقم محاولة غير مؤكد.';
  } else if (taskQuery.isFetching) {
    attemptContext = 'جارٍ تحديث سجل المهمة؛ أخفينا المحاولة مؤقتاً.';
  } else if (!taskMatchesSnapshot) {
    attemptContext = 'تغير سجل المهمة منذ آخر لقطة؛ حدّث مساحة المشروع قبل الاعتماد على المحاولة.';
  } else if (acceptanceAttempt !== null) {
    attemptContext = 'محاولة قبول مسجلة في سجل المهمة.';
  } else if (!taskLogsBelongToTask) {
    attemptContext = 'سجل التنفيذ لا يطابق المهمة الحالية؛ لم نعرض المحاولة.';
  } else if (taskLogsQuery.isFetching || executionQuery.isFetching) {
    attemptContext = 'جارٍ تحديث سجل التنفيذ؛ أخفينا المحاولة مؤقتاً.';
  } else if (attempt !== null) {
    attemptContext = 'محاولة مسجلة من التنفيذ المرتبط بالمهمة.';
  } else if (task.status === 'running' && !currentCorrelationId) {
    attemptContext = 'لا توجد هوية تنفيذ حالية مرتبطة بالمهمة في هذه القراءة.';
  } else if (task.status === 'running' && (taskLogsQuery.isError || executionQuery.isError)) {
    attemptContext = 'تعذر تأكيد المحاولة الحالية من سجل التنفيذ.';
  } else if (task.status === 'running') {
    attemptContext = 'جارٍ تأكيد المحاولة الحالية من التنفيذ المرتبط.';
  }

  return (
    <article className="workspace-task" data-testid={`workspace-task-${task.id}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span className="workspace-task-mark" />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="text-sm leading-5 text-slate-200">{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>{dateLabel(task.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>التحقق: {label(task.verificationDecision)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-slate-400">
            <div className="flex flex-wrap items-center gap-1.5">
              <dt>المصدر:</dt><dd data-testid={`workspace-task-source-${task.id}`}>ملخص مهام Workspace</dd>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <dt>معرّف المهمة:</dt><dd data-testid={`workspace-task-id-${task.id}`}><Identifier>{task.id}</Identifier></dd>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <dt>المحاولة:</dt>
              <dd data-testid={`workspace-task-attempt-${task.id}`}>
                {attempt === null ? 'غير متاحة' : <Identifier>{attempt}</Identifier>}
              </dd>
              <span className="text-slate-500">{attemptContext}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <dt>التبعيات:</dt>
              <dd data-testid={`workspace-task-dependencies-${task.id}`}>
                {dependencyIds === null
                  ? 'غير متاحة في سجل المهمة'
                  : dependencyIds.length === 0
                    ? 'لا توجد تبعيات مسجلة'
                    : dependencyIds.map((dependencyId, index) => (
                      <span key={dependencyId}>
                        {index > 0 ? '، ' : null}
                        <Link
                          href={`/tasks?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(dependencyId)}`}
                          className="text-cyan-300 underline-offset-4 hover:underline"
                          aria-label={`فتح المهمة المعتمَد عليها: ${dependencyId}`}
                        >
                          <Identifier>{dependencyId}</Identifier>
                        </Link>
                      </span>
                    ))}
              </dd>
            </div>
          </dl>
          <Link
            href={`/tasks?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(task.id)}`}
            className="mt-2 inline-flex text-xs font-medium text-cyan-300 underline-offset-4 hover:underline"
            aria-label={`فتح تفاصيل المهمة: ${task.title}`}
          >
            فتح تفاصيل المهمة
          </Link>
        </div>
      </div>
      <span className={`workspace-status status-${task.status}`}>{label(task.status)}</span>
    </article>
  );
}

export default function ProjectWorkspace() {
  const [, params] = useRoute('/projects/:projectId/workspace');
  const projectId = params?.projectId ?? '';
  const queryClient = useQueryClient();
  const snapshotQuery = useGetProjectWorkspaceSnapshot(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectWorkspaceSnapshotQueryKey(projectId),
      refetchInterval: 30_000,
    },
  });
  const { data: snapshot, isLoading, isError, refetch, isFetching } = snapshotQuery;
  const [isRefreshingWorkspace, setIsRefreshingWorkspace] = useState(false);
  const currentProjectIdRef = useRef(projectId);
  currentProjectIdRef.current = projectId;
  const refreshGenerationRef = useRef(0);
  useEffect(() => {
    refreshGenerationRef.current += 1;
    setIsRefreshingWorkspace(false);
  }, [projectId]);
  const hasCurrentSnapshot = snapshot?.project.id === projectId;
  const latestExecutionId = snapshot?.work.executionSource === 'available'
    ? snapshot.work.latestExecution?.id ?? null
    : null;
  const recentTaskIds = snapshot?.work.tasksSource === 'available'
    ? snapshot.work.recentTasks.map((task) => task.id)
    : [];
  const invalidateRecentTaskReads = (taskIds: string[] = recentTaskIds) =>
    Promise.all(taskIds.flatMap((taskId) => [
      queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) }),
      queryClient.invalidateQueries({ queryKey: getGetTaskLogsQueryKey(taskId) }),
    ]));
  const streamStatus = useWorkspaceEventStream({
    projectId,
    enabled: !!projectId && hasCurrentSnapshot && !isError,
    onSnapshotInvalidated: () => {
      void queryClient.invalidateQueries({
        queryKey: getGetProjectWorkspaceSnapshotQueryKey(projectId),
      });
      if (latestExecutionId) {
        void queryClient.invalidateQueries({
          queryKey: getGetAiExecutionQueryKey(latestExecutionId),
        });
      }
      void invalidateRecentTaskReads();
    },
  });

  async function refreshWorkspace() {
    const requestedProjectId = projectId;
    const refreshGeneration = refreshGenerationRef.current;
    if (!requestedProjectId) return;

    setIsRefreshingWorkspace(true);
    try {
      // Refresh the authoritative snapshot first; dependent reads must be
      // selected from that snapshot rather than from the pre-refresh render.
      const refreshedSnapshot = await refetch();
      if (
        currentProjectIdRef.current !== requestedProjectId
        || refreshGenerationRef.current !== refreshGeneration
        || refreshedSnapshot.isError
        || refreshedSnapshot.data?.project.id !== requestedProjectId
      ) {
        return;
      }

      const refreshedWork = refreshedSnapshot.data.work;
      const refreshedExecutionId = refreshedWork.executionSource === 'available'
        ? refreshedWork.latestExecution?.id ?? null
        : null;
      const refreshedTaskIds = refreshedWork.tasksSource === 'available'
        ? refreshedWork.recentTasks.map((task) => task.id)
        : [];

      // Refresh task identities and logs before resolving the execution IDs
      // that the visible task cards use for their attempt/evidence panels.
      await invalidateRecentTaskReads(refreshedTaskIds);
      if (
        currentProjectIdRef.current !== requestedProjectId
        || refreshGenerationRef.current !== refreshGeneration
      ) {
        return;
      }

      const taskExecutionIds = refreshedTaskIds.flatMap((taskId) => {
        const taskDetails = queryClient.getQueryData(getGetTaskQueryKey(taskId)) as
          | { projectId?: string; correlationId?: string | null }
          | undefined;
        const correlationId = typeof taskDetails?.correlationId === 'string'
          ? taskDetails.correlationId.trim()
          : '';
        if (taskDetails?.projectId !== requestedProjectId || !correlationId) return [];

        const logs = queryClient.getQueryData(getGetTaskLogsQueryKey(taskId)) as
          | Array<{
            correlationId?: string | null;
            executionId?: string | null;
            sequence?: number | null;
            timestamp?: string | null;
          }>
          | undefined;
        const latestExecutionLog = (logs ?? [])
          .filter((log) =>
            log.correlationId === correlationId
            && typeof log.executionId === 'string'
            && log.executionId.trim().length > 0)
          .sort((left, right) =>
            (left.sequence ?? -1) - (right.sequence ?? -1)
            || Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)))
          .at(-1);
        return latestExecutionLog?.executionId ? [latestExecutionLog.executionId] : [];
      });
      const executionIds = [...new Set([
        ...(refreshedExecutionId ? [refreshedExecutionId] : []),
        ...taskExecutionIds,
      ])];

      await Promise.all(executionIds.map((executionId) =>
        queryClient.invalidateQueries({
          queryKey: getGetAiExecutionQueryKey(executionId),
        }),
      ));
    } finally {
      // A late completion from project A must not clear project B's refresh state.
      if (
        currentProjectIdRef.current === requestedProjectId
        && refreshGenerationRef.current === refreshGeneration
      ) {
        setIsRefreshingWorkspace(false);
      }
    }
  }

  if (isLoading) return <WorkspaceSkeleton />;
  if (isError && snapshot?.project.id === projectId) {
    return (
      <section
        dir="rtl"
        className="workspace-error"
        role="alert"
        data-testid="workspace-stale-snapshot"
      >
        <div className="workspace-error-mark"><AlertTriangle className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">تعذر تحديث مساحة المشروع</h1>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            احتفظنا بسياق آخر لقطة ناجحة للمشروع، لكن لا يمكن اعتبارها الحالة الحالية. أخفينا تفاصيل العمل والمساعد وإجراءات التنفيذ حتى تنجح قراءة جديدة.
          </p>
          <dl className="mt-4 space-y-2 text-xs text-slate-300">
            <div>
              <dt className="inline text-slate-500">المشروع: </dt>
              <dd className="inline"><Identifier>{snapshot.project.name}</Identifier></dd>
            </div>
            <div>
              <dt className="inline text-slate-500">وقت آخر قراءة ناجحة: </dt>
              <dd className="inline">
                <time data-testid="workspace-stale-snapshot-observed-at" dateTime={snapshot.observedAt}>
                  {dateLabel(snapshot.observedAt)}
                </time>
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => void refetch()}
            className="workspace-retry mt-5"
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'جارٍ إعادة القراءة' : 'إعادة محاولة قراءة مساحة المشروع'}
          </button>
        </div>
      </section>
    );
  }
  if (isError || !snapshot) {
    return (
      <section dir="rtl" className="workspace-error" role="alert">
        <div className="workspace-error-mark"><AlertTriangle className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">تعذر فتح مساحة المشروع</h1>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            لم تصلنا قراءة موثوقة لحالة المشروع. أعد المحاولة؛ لا يعني ذلك عدم وجود عمل.
          </p>
          <button type="button" onClick={() => void refetch()} className="workspace-retry mt-5">
            <RefreshCw className="h-4 w-4" /> إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  if (snapshot.project.id !== projectId) {
    return (
      <section dir="rtl" className="workspace-error" role="alert">
        <div className="workspace-error-mark"><AlertTriangle className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">تعارض هوية المشروع</h1>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            اللقطة المستلمة لا تخص المشروع المطلوب؛ أخفينا محتواها حتى تصل قراءة بهوية مطابقة.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="workspace-retry mt-5"
            disabled={isFetching}
          >
            <RefreshCw className="h-4 w-4" /> إعادة قراءة المشروع
          </button>
        </div>
      </section>
    );
  }

  const { project, work, runtime, freshness } = snapshot;
  // Source availability is authoritative: do not render retained payloads from an unavailable read.
  const candidate = work.candidateSource === 'available' ? work.candidate : null;
  const execution = work.executionSource === 'available' ? work.latestExecution : null;

  return (
    <div dir="rtl" lang="ar" className="project-workspace" data-testid="project-workspace">
      <header className="workspace-project-heading">
        <div className="workspace-heading-top">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
            <Link href="/projects" className="workspace-back" aria-label="العودة إلى المشاريع"><ArrowRight className="h-4 w-4" /></Link>
            <span>المشاريع</span><span aria-hidden="true" className="text-slate-600">/</span>
            <span className="truncate text-slate-300">{project.name}</span>
          </div>
          <button
            type="button"
            className="workspace-refresh"
            onClick={() => void refreshWorkspace()}
            disabled={isFetching || isRefreshingWorkspace}
            aria-busy={isFetching || isRefreshingWorkspace}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching || isRefreshingWorkspace ? 'animate-spin' : ''}`} />
            <span>{isFetching || isRefreshingWorkspace ? 'جارٍ تحديث الحالة والعمل' : 'تحديث الحالة'}</span>
          </button>
        </div>
        <div className="mt-5 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`workspace-eyebrow workspace-stream-${streamStatus}`} role="status" aria-live="polite">
                <span className="workspace-live-dot" />
                {streamStatus === 'connected' && 'متصل بتحديثات مساحة المشروع'}
                {streamStatus === 'connecting' && 'جارٍ الاتصال بالتحديثات'}
                {streamStatus === 'reconnecting' && 'انقطع البث؛ جارٍ إعادة الاتصال'}
                {streamStatus === 'offline' && 'البث غير متاح؛ يستمر التحديث الدوري'}
              </span>
              {freshness.partial && <span className="workspace-partial">قراءة جزئية</span>}
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">{project.name}</h1>
            <p dir="auto" className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {project.description || 'تحدث مع المساعد عن العمل المطلوب، وتابع الحالة المسجلة هنا.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="workspace-meta"><Code2 className="h-3.5 w-3.5" /><Identifier>{project.language}</Identifier></span>
            {project.framework && <span className="workspace-meta"><Layers3 className="h-3.5 w-3.5" /><Identifier>{project.framework}</Identifier></span>}
            <span className="workspace-meta"><Activity className="h-3.5 w-3.5" />{label(project.status)}</span>
          </div>
        </div>
        {freshness.partial && (
          <div className="workspace-warning mt-5" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">بعض المعلومات غير مكتملة</p>
              <p className="mt-0.5 text-xs leading-5 opacity-80">الحالة أدناه تعكس المصادر التي أمكن قراءتها فقط، ولا يستنتج غياب العمل من مصدر غير متاح.</p>
              {freshness.warnings.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs leading-5 opacity-70">
                  {freshness.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warningLabels[warning] ?? 'تعذر تحديث أحد المصادر.'}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </header>

      <nav className="workspace-panel-nav" aria-label="التنقل بين أقسام مساحة المشروع">
        <a href="#workspace-panel-agent">المساعد</a>
        <a href="#workspace-panel-canvas">المعاينة</a>
        <a href="#workspace-panel-trust">العمل والثقة</a>
      </nav>

      <div className="workspace-layout">
        <section
          id="workspace-panel-agent"
          className="workspace-panel workspace-chat-panel"
          aria-label="محادثة المشروع"
        >
          <div className="workspace-panel-heading">
            <span className="workspace-section-icon"><Sparkles className="h-4 w-4" /></span>
            <div>
              <h2>مساحة الحوار</h2>
              <p>صف ما تريد بعباراتك، ولا يُرسل شيء حتى تختار الإرسال.</p>
            </div>
          </div>
          <div className="workspace-chat-body" dir="ltr">
            <AiChat key={project.id} workspaceProjectId={project.id} workspaceMode />
          </div>
        </section>

        <ProjectCanvasPanel
          candidateSourceAvailable={work.candidateSource === 'available'}
          hasCandidate={Boolean(candidate)}
          runtimeSourceAvailable={runtime.source !== 'unavailable'}
          runtimeStatusLabel={label(runtime.status)}
        />

        <aside
          id="workspace-panel-trust"
          className="workspace-panel workspace-trust-column"
          aria-label="العمل والثقة"
        >
          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon work"><Activity className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>العمل الأخير</h2>
                <p>أحدث 8 مهام من المصدر؛ هذه ليست قائمة شاملة.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="workspace-readonly">للاطلاع</span>
                <Link
                  href={`/tasks?projectId=${encodeURIComponent(project.id)}`}
                  className="text-xs font-medium text-cyan-300 underline-offset-4 hover:underline"
                  aria-label="عرض جميع مهام المشروع"
                >
                  عرض الكل
                </Link>
              </div>
            </div>
            <SourceNote available={work.tasksSource === 'available'}>مصدر المهام غير متاح الآن؛ لا يمكن تأكيد قائمة العمل.</SourceNote>
            {work.tasksSource === 'available' && (
              work.recentTasks.length === 0 ? (
                <div className="workspace-empty">
                  <div className="workspace-empty-mark"><Check className="h-4 w-4" /></div>
                  <p className="font-medium text-slate-300">لا توجد مهام حديثة مسجلة</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">هذا ملخص للمهام التي أعادها المصدر، وليس تأكيدًا على عدم وجود عمل خارجها.</p>
                  <a
                    href="#workspace-panel-agent"
                    data-testid="link-start-request-from-empty-work"
                    aria-label="ابدأ طلبًا جديدًا في مساحة الحوار"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    صف ما تريد إنجازه للمساعد
                  </a>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {work.recentTasks.map((task) => (
                    <WorkspaceTaskCard key={task.id} projectId={project.id} task={task} />
                  ))}
                </div>
              )
            )}
            <SourceNote available={work.executionSource === 'available'}>مصدر التنفيذ غير متاح؛ لا يمكن تأكيد حالة تنفيذ حديثة.</SourceNote>
            {execution && (
              <div className="workspace-execution">
                <div className="flex items-center gap-2 text-xs text-slate-400"><Terminal className="h-3.5 w-3.5 text-teal-300" /> آخر تنفيذ</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`workspace-status status-${execution.status}`}>{label(execution.status)}</span>
                  <span className="text-xs text-slate-500">المحاولة <Identifier>{execution.attempt}</Identifier></span>
                  <span className="text-xs text-slate-500">{dateLabel(execution.updatedAt)}</span>
                </div>
                <WorkspaceExecutionDetail
                  executionId={execution.id}
                  projectId={project.id}
                  attempt={execution.attempt}
                  proposalId={execution.proposalId}
                />
              </div>
            )}
          </section>

          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon candidate"><GitBranch className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>النسخة المرشحة</h2>
                <p>حالة المرشح المسجلة للمشروع</p>
              </div>
              {candidate && <span className={`workspace-status status-${candidate.status}`}>{label(candidate.status)}</span>}
            </div>
            <SourceNote available={work.candidateSource === 'available'}>مصدر المرشح غير متاح؛ لا يمكن تأكيد حالة التغييرات.</SourceNote>
            {work.candidateSource === 'available' && !candidate ? (
              <div className="workspace-empty compact">
                <p className="font-medium text-slate-300">لا يوجد مرشح مسجل في هذه القراءة</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">لن نعرض مراجعة أو اعتمادًا ما لم يسجله المصدر.</p>
                <a
                  href="#workspace-panel-agent"
                  data-testid="link-discuss-work-from-empty-candidate"
                  aria-label="ناقش العمل المطلوب في مساحة الحوار"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  صف ما تريد إنجازه للمساعد
                </a>
              </div>
            ) : candidate && (
              <div className="mt-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="workspace-stat"><span>دورة الحياة</span><strong>{label(candidate.lifecycle)}</strong></div>
                  <div className="workspace-stat"><span>المراجعة</span><strong>{candidate.approvalRequired ? 'الموافقة مطلوبة' : 'لا تتطلب موافقة'}</strong></div>
                  <div className="workspace-stat"><span>النسخة</span><strong><Identifier>{candidate.revision}</Identifier></strong></div>
                  <div className="workspace-stat"><span>أُنشئ</span><strong>{dateLabel(candidate.createdAt)}</strong></div>
                </div>
                <details className="workspace-details mt-3">
                  <summary>معلومات تقنية عن المرشح</summary>
                  <dl className="workspace-detail-grid">
                    <dt>معرّف المرشح</dt><dd><Identifier>{candidate.proposalId}</Identifier></dd>
                    <dt>معرّف العملية</dt><dd><Identifier>{candidate.operationId}</Identifier></dd>
                    <dt>نسخة الأساس</dt><dd><Identifier>{candidate.baseRevision}</Identifier></dd>
                    <dt>بصمة شجرة المرشح</dt><dd><Identifier>{candidate.candidateTreeHash}</Identifier></dd>
                    <dt>بصمة مجموعة التغييرات</dt><dd><Identifier>{candidate.changeSetHash}</Identifier></dd>
                  </dl>
                </details>
              </div>
            )}
          </section>

          <section className="workspace-card runtime-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon runtime"><Activity className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>حالة التشغيل</h2>
                <p>حالة جلسة المشروع المسجلة</p>
              </div>
              {runtime.source === 'available' ? (
                <span
                  className={`workspace-status status-${runtime.status}`}
                  data-testid="workspace-runtime-status"
                >
                  {label(runtime.status)}
                </span>
              ) : (
                <span className="workspace-readonly" data-testid="workspace-runtime-status">
                  غير متاح
                </span>
              )}
            </div>
            {runtime.source === 'unavailable' ? (
              <SourceNote available={false}>مصدر التشغيل غير متاح الآن؛ لا يمكن تأكيد الحالة الحالية.</SourceNote>
            ) : (
              <div className="mt-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  {runtime.status === 'running' ? 'بدأت الجلسة' : 'آخر تغيير مسجل'}
                  <span>{dateLabel(runtime.status === 'running' ? runtime.startedAt : runtime.stoppedAt ?? runtime.startedAt)}</span>
                </div>
                {runtime.runtimeRevision && (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    نسخة الجلسة المسجلة: <Identifier>{runtime.runtimeRevision}</Identifier>
                    <span className="block mt-1">هذه النسخة مرتبطة بجلسة التشغيل، ولا تثبت أنها النسخة الحالية للمشروع.</span>
                  </p>
                )}
                <p className="mt-3 border-t border-slate-700/60 pt-3 text-xs leading-5 text-slate-500">
                  لا تتوفر معاينة تفاعلية هنا. هذه الحالة لا تمثل معاينة للمرشح.
                </p>
              </div>
            )}
          </section>

          <PreviewAgentPanel projectId={project.id} />

          <div className="workspace-observed">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>آخر قراءة موحدة: {dateLabel(snapshot.observedAt)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
