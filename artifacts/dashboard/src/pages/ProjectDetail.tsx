import React, { useState } from 'react';
import { useRoute } from 'wouter';
import GitPanel from '@/components/GitPanel';
import {
  useGetProject,
  useGetProjectSummary,
  useScanProject,
  useUpdateProject,
  useListTasks,
  useGetGraphSummary,
  getGetProjectSummaryQueryKey,
  getListTasksQueryKey,
  getGetProjectQueryKey,
  getGetGraphSummaryQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
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
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import { useMonotonicData } from '@/lib/freshness';
import WorkspaceRuntimePanel from '@/components/WorkspaceRuntimePanel';
import ProjectAiBudgetPanel from '@/components/ProjectAiBudgetPanel';
import ProjectPluginsPanel from '@/components/ProjectPluginsPanel';
import BrowserValidationProfilesPanel from '@/components/BrowserValidationProfilesPanel';
import { formatProjectTimestamp, projectStatusLabel } from '@/lib/project-detail-copy';

export default function ProjectDetail() {
  const [, params] = useRoute('/projects/:id');
  const projectId = params?.id || '';
  const queryClient = useQueryClient();

  const projectQuery = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectQueryKey(projectId),
      // Scans now run as background jobs (see scan-runner.ts): the project
      // stays "scanning" until the job finishes, so poll while it's active
      // rather than relying on a fixed delay before invalidating once.
      refetchInterval: (query) => (query.state.data?.status === 'scanning' ? 1500 : false),
    },
  });
  const { data: rawProject, isLoading: loadingProject, isError: projectError, error: projectErrorValue, refetch: refetchProject, isRefetching: projectRefreshing, dataUpdatedAt } = projectQuery;
  const project = useMonotonicData(rawProject, rawProject?.updatedAt);
  const updateProject = useUpdateProject();
  const [strategyReplayOptInError, setStrategyReplayOptInError] = useState<string | null>(null);

  const setStrategyReplayOptIn = (nextValue: boolean) => {
    setStrategyReplayOptInError(null);
    updateProject.mutate(
      { projectId, data: { strategyReplayOptIn: nextValue } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetProjectQueryKey(projectId),
          });
        },
        onError: (error) => {
          setStrategyReplayOptInError(
            error instanceof Error ? error.message : 'Could not update Strategy Replay consent.',
          );
        },
      },
    );
  };

  const { data: summary, isLoading: loadingSummary, isError: summaryError, refetch: refetchSummary } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectSummaryQueryKey(projectId) },
  });

  // Prefetch tasks into the query cache for the Tasks tab (result not used directly here).
  useListTasks(
    { projectId },
    { query: { enabled: !!projectId, queryKey: getListTasksQueryKey({ projectId }) } },
  );

  const { data: graphSummary, isLoading: loadingGraphSummary, isError: graphSummaryError } = useGetGraphSummary(projectId, {
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
      <div dir="rtl" className="p-8 text-center animate-pulse text-muted-foreground">
        جارٍ تحميل بيانات المشروع...
      </div>
    );
  }

  if (projectError || summaryError || !project || !summary) {
    return (
      <div dir="rtl">
        <RequestError
          message={projectErrorValue instanceof Error ? projectErrorValue.message : 'بيانات المشروع غير متاحة.'}
          onRetry={() => void Promise.all([refetchProject(), refetchSummary()])}
        />
      </div>
    );
  }

  const metrics = summary.latestMetrics ?? null;
  const hasCurrentScan = Boolean(project.lastScanAt) && project.status !== 'scanning';

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
          aria-label="العودة إلى قائمة المشاريع"
          title="العودة إلى قائمة المشاريع"
        >
          <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="text-sm font-mono text-muted-foreground flex items-center gap-2">
          <span>المشاريع</span>
          <span className="text-border">/</span>
          <span className="text-foreground">{project.name}</span>
        </div>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-xs ${
          project.status === 'scanning'
            ? 'border-primary/30 bg-primary/5 text-primary'
            : hasCurrentScan
              ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
        }`}
        role="status"
      >
        {project.status === 'scanning'
          ? 'الفحص جارٍ الآن. تظل الدرجات وبيانات خريطة المشروع أدناه من آخر فحص مكتمل حتى يعلن الخادم نتيجة الفحص الجديد.'
          : hasCurrentScan
            ? `تعكس هذه البيانات الفحص المكتمل بتاريخ ${formatProjectTimestamp(project.lastScanAt)}.`
            : 'لا يوجد فحص مكتمل لهذا المشروع. لم يُتحقق من الدرجات أو خريطة المشروع للمصدر الحالي.'}
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
              {projectStatusLabel(project.status)}
            </span>
          </div>
          <p className="text-muted-foreground font-mono text-sm flex items-center gap-2">
            <TerminalSquare className="w-4 h-4" /> {project.rootPath}
          </p>
          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md">
              <span className="text-muted-foreground">اللغة:</span>{' '}
              <span className="font-semibold capitalize">{project.language}</span>
            </span>
            {project.framework && (
              <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md">
                <span className="text-muted-foreground">إطار العمل:</span>{' '}
                <span className="font-semibold">{project.framework}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5 border border-border bg-secondary/50 px-2 py-1 rounded-md text-muted-foreground">
              <Clock className="w-3.5 h-3.5" /> آخر فحص:{' '}
              {formatProjectTimestamp(project.lastScanAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <RefreshButton onRefresh={async () => { await refetchProject(); await refetchSummary(); }} isRefreshing={projectRefreshing} lastUpdated={dataUpdatedAt} label="تحديث المشروع" />
          <button
            onClick={() => setShowProjectInfo((v) => !v)}
            className={`p-2 border rounded-md transition-colors ${showProjectInfo ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary text-muted-foreground'}`}
            title="معلومات المشروع"
            aria-label="معلومات المشروع"
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
                <Activity className="w-4 h-4 animate-pulse" /> جارٍ الفحص…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" /> ابدأ الفحص
              </>
            )}
          </button>
        </div>
      </div>

      <div dir="ltr"><WorkspaceRuntimePanel projectId={projectId} /></div>
      <div dir="ltr"><ProjectAiBudgetPanel projectId={projectId} /></div>
      <div dir="ltr"><ProjectPluginsPanel projectId={projectId} /></div>

      {/* Project info panel */}
      {showProjectInfo && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-sm text-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2 text-primary">
              <Settings className="w-4 h-4" /> معلومات المشروع
            </h2>
            <button
              onClick={() => setShowProjectInfo(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary"
              aria-label="إغلاق معلومات المشروع"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
            {[
              { label: 'المعرّف',          value: project.id },
              { label: 'مسار المشروع',     value: project.rootPath },
              { label: 'اللغة',            value: project.language },
              { label: 'إطار العمل',       value: project.framework ?? '—' },
              { label: 'الحالة',           value: project.status },
              { label: 'تاريخ الإضافة',    value: project.createdAt ? formatProjectTimestamp(project.createdAt) : '—' },
              { label: 'آخر فحص',          value: formatProjectTimestamp(project.lastScanAt) },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-0.5 bg-secondary/40 rounded-md px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{label}</span>
                <span dir="auto" className="text-foreground break-all">{value}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-4">
            <div className="flex items-start gap-3">
              <input
                id="strategy-replay-opt-in"
                type="checkbox"
                role="switch"
                checked={Boolean(project.strategyReplayOptIn)}
                disabled={updateProject.isPending}
                onChange={(event) => setStrategyReplayOptIn(event.target.checked)}
                aria-describedby="strategy-replay-opt-in-description"
                data-testid="toggle-strategy-replay-opt-in"
                className="mt-1 h-4 w-4 accent-primary disabled:opacity-50"
              />
              <div className="min-w-0">
                <label
                  htmlFor="strategy-replay-opt-in"
                  className="font-sans text-sm font-medium text-foreground"
                >
                  السماح بتسجيل حالات جديدة لإعادة تشغيل الاستراتيجية
                </label>
                <p
                  id="strategy-replay-opt-in-description"
                  className="mt-1 font-sans text-xs leading-relaxed text-muted-foreground"
                >
                  هذا الخيار معطّل افتراضيًا. لا تُسجّل إلا جلسات الوصفات الجديدة المقبولة
                  التي تطابق مرشحًا معلّقًا ومجمّدًا. تحتوي الحالات المخزنة على معرّفات
                  وبصمات إثبات فقط، ولا تتضمن الطلبات أو المحادثات أو محتوى الملفات.
                </p>
                <p className="mt-1 font-sans text-xs leading-relaxed text-muted-foreground">
                  عند إيقافه، تُحذف الحالات المسجّلة التي لم تُعَد تشغيلها. ولا يتغير المرشح.
                </p>
                <p
                  role="status"
                  data-testid="status-strategy-replay-opt-in"
                  className="mt-2 font-sans text-xs font-medium text-foreground"
                >
                  {updateProject.isPending
                    ? 'جارٍ الحفظ…'
                    : project.strategyReplayOptIn
                      ? 'مفعّل'
                      : 'معطّل'}
                </p>
                {strategyReplayOptInError && (
                  <p
                    role="alert"
                    data-testid="error-strategy-replay-opt-in"
                    className="mt-1 font-sans text-xs text-destructive"
                  >
                    {strategyReplayOptInError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div dir="ltr"><BrowserValidationProfilesPanel projectId={projectId} /></div>

      {/* Knowledge graph summary strip */}
      {loadingGraphSummary ? (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm text-sm text-muted-foreground animate-pulse">
          جارٍ تحميل ملخص خريطة العلاقات…
        </div>
      ) : graphSummaryError ? (
        <div className="bg-card border border-amber-500/30 rounded-xl p-5 shadow-sm text-sm text-amber-200" role="status">
          بيانات خريطة العلاقات غير متاحة. حدّث المشروع قبل الاعتماد على أعداد الاعتماديات.
        </div>
      ) : graphSummary ? (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" /> خريطة العلاقات
            </h2>
            <Link
              href="/graph"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              استكشف الخريطة <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'العناصر',       value: graphSummary.entityCount,      color: 'text-primary' },
              { label: 'العلاقات',      value: graphSummary.relationshipCount, color: 'text-primary' },
              { label: 'المجموعات',     value: graphSummary.clusterCount,      color: 'text-foreground' },
              { label: 'عناصر منفصلة', value: graphSummary.isolatedCount,    color: graphSummary.isolatedCount > 0 ? 'text-yellow-500' : 'text-foreground' },
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
                <GitMerge className="w-3.5 h-3.5" /> الأكثر ارتباطًا
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
      ) : (
        <div className="bg-card border border-dashed border-border rounded-xl p-5 shadow-sm text-sm text-muted-foreground">
          لا تتوفر خريطة علاقات متحقق منها لهذا المشروع بعد. ابدأ فحصًا لاستخراج الاعتماديات.
        </div>
      )}

      {/* GitHub integration */}
      <div dir="ltr"><GitPanel projectId={projectId} /></div>

      {/* Metrics + tasks grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quality score */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <ShieldAlert className="w-4 h-4 text-primary" /> جودة المشروع
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
               {hasCurrentScan ? summary.qualityScore : '—'}
            </div>
            <div className="text-muted-foreground text-sm mt-1">{hasCurrentScan ? '/ 100' : 'غير متحقق منها'}</div>
          </div>

          {metrics && (
            <div className="space-y-4">
              {[
                { label: 'البنية', score: metrics.architectureScore || 0, icon: GitCommit },
                { label: 'الأمان', score: metrics.securityScore || 0, icon: ShieldAlert },
                { label: 'الأداء', score: metrics.performanceScore || 0, icon: Zap },
                { label: 'الاعتمادية', score: metrics.reliabilityScore || 0, icon: Activity },
                {
                  label: 'سهولة الصيانة',
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
            <Activity className="w-4 h-4 text-primary" /> ملخص المهام
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/50 border border-border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono">{summary.taskCounts.total}</div>
              <div className="text-xs text-muted-foreground uppercase mt-1 tracking-wider">
                الإجمالي
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-blue-500">
                {summary.taskCounts.running}
              </div>
              <div className="text-xs text-blue-500/80 uppercase mt-1 tracking-wider">قيد التنفيذ</div>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-emerald-500">
                {summary.taskCounts.completed}
              </div>
              <div className="text-xs text-emerald-500/80 uppercase mt-1 tracking-wider">
                مكتملة
              </div>
            </div>
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold font-mono text-destructive">
                {summary.taskCounts.failed}
              </div>
              <div className="text-xs text-destructive/80 uppercase mt-1 tracking-wider">
                فاشلة
              </div>
            </div>
          </div>
        </div>

        {/* Recent events */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-primary" /> الأحداث الأخيرة
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
                    <div dir="auto" className="text-xs font-medium">{evt.message || evt.type}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground italic">لا توجد أحداث حديثة.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
