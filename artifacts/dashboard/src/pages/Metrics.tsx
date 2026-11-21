import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListMetrics,
  useListProjects,
  useScanProject,
  useGetScanJob,
  getListMetricsQueryKey,
  getListProjectsQueryKey,
  getGetScanJobQueryKey,
} from '@workspace/api-client-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { BarChart3, AlertTriangle, Play, RefreshCw } from 'lucide-react';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import { Link, useSearch } from 'wouter';

const CHART_COLORS = {
  architecture: '#10b981',
  security:     '#f59e0b',
  techDebt:     '#8b5cf6',
} as const;

type DateRange = '7d' | '30d' | 'all';

function readDateRange(value: string | null): DateRange {
  return value === '7d' || value === 'all' ? value : '30d';
}

export default function Metrics() {
  const routeParams = new URLSearchParams(useSearch());
  const initialProjectId = routeParams.get('projectId') ?? '';
  const initialDateRange = readDateRange(routeParams.get('range'));

  return (
    <MetricsSession
      key={JSON.stringify([initialProjectId, initialDateRange])}
      initialProjectId={initialProjectId}
      initialDateRange={initialDateRange}
    />
  );
}

function MetricsSession({
  initialProjectId,
  initialDateRange,
}: {
  initialProjectId: string;
  initialDateRange: DateRange;
}) {
  const queryClient = useQueryClient();
  const {
    data: projects,
    isError: projectsError,
    isFetching: projectsIsFetching,
    dataUpdatedAt: projectsDataUpdatedAt,
    refetch: refetchProjects,
  } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId);
  const [dateRange, setDateRange] = useState<DateRange>(initialDateRange);
  const [activeScan, setActiveScan] = useState<{ projectId: string; jobId: string } | null>(null);
  const terminalScanJobId = useRef<string | null>(null);

  // A saved selection is valid only while it belongs to the latest project list.
  // Derive the fallback during render so a removed project is never queried for
  // even one render after the owned-project result changes.
  const effectiveProjectId = projects?.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : (projects?.[0]?.id ?? '');
  const projectsLoaded = projects !== undefined;

  useEffect(() => {
    if (projectsLoaded && selectedProjectId !== effectiveProjectId) {
      setSelectedProjectId(effectiveProjectId);
    }
  }, [effectiveProjectId, projectsLoaded, selectedProjectId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (projectsLoaded) {
      if (effectiveProjectId) url.searchParams.set('projectId', effectiveProjectId);
      else url.searchParams.delete('projectId');
    }
    if (dateRange === '30d') url.searchParams.delete('range');
    else url.searchParams.set('range', dateRange);

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, [dateRange, effectiveProjectId, projectsLoaded]);

  const currentProjectIdRef = useRef(effectiveProjectId);
  currentProjectIdRef.current = effectiveProjectId;

  const {
    data: metrics,
    isLoading,
    isError,
    error,
    refetch,
    isFetching: metricsIsFetching,
    dataUpdatedAt: metricsDataUpdatedAt,
  } = useListMetrics(
    { projectId: effectiveProjectId },
    { query: { queryKey: getListMetricsQueryKey({ projectId: effectiveProjectId }), enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );
  const scanProject = useScanProject();
  const scanJob = useGetScanJob(activeScan?.projectId ?? '', activeScan?.jobId ?? '', {
    query: {
      queryKey: getGetScanJobQueryKey(activeScan?.projectId ?? '', activeScan?.jobId ?? ''),
      enabled: Boolean(activeScan),
      refetchInterval: (query) => (
        query.state.data?.status === 'queued' || query.state.data?.status === 'running'
          ? 1500
          : false
      ),
    },
  });
  const activeScanStatus = activeScan && scanJob.data?.id === activeScan.jobId
    ? scanJob.data?.status
    : undefined;

  useEffect(() => {
    if (!activeScan || !activeScanStatus) return;
    if (activeScanStatus !== 'completed' && activeScanStatus !== 'failed') return;
    if (terminalScanJobId.current === activeScan.jobId) return;
    terminalScanJobId.current = activeScan.jobId;
    void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    if (activeScanStatus === 'completed') {
      void queryClient.invalidateQueries({
        queryKey: getListMetricsQueryKey({ projectId: activeScan.projectId }),
      });
    }
  }, [activeScan, activeScanStatus, queryClient]);

  const refreshMetrics = async () => {
    const requestedProjectId = effectiveProjectId;
    const refreshedProjects = await refetchProjects();

    // The current render's refetch() is bound to requestedProjectId. Do not
    // invoke it if the project refresh removed that project or navigation has
    // since selected a different one; the active query will follow the new ID.
    if (
      refreshedProjects.isError ||
      !refreshedProjects.data?.some((project) => project.id === requestedProjectId) ||
      currentProjectIdRef.current !== requestedProjectId
    ) {
      return;
    }

    await refetch();
  };

  const currentProject = projects?.find((project) => project.id === effectiveProjectId);
  const trackedScanMatchesJob = scanJob.data?.id === activeScan?.jobId;
  const trackedScanInProgress = Boolean(activeScan) && (
    !trackedScanMatchesJob
    || activeScanStatus === 'queued'
    || activeScanStatus === 'running'
  );
  const currentTrackedScanIsTerminal = activeScan?.projectId === effectiveProjectId
    && (activeScanStatus === 'completed' || activeScanStatus === 'failed');
  const projectScanInProgress = currentProject?.status === 'scanning' && !currentTrackedScanIsTerminal;
  const scanBusy = scanProject.isPending || trackedScanInProgress || projectScanInProgress;

  const startScan = () => {
    if (!effectiveProjectId || scanBusy) return;
    const projectId = effectiveProjectId;
    scanProject.mutate(
      { projectId },
      {
        onSuccess: (job) => {
          terminalScanJobId.current = null;
          setActiveScan({ projectId, jobId: job.id });
          void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        },
      },
    );
  };

  const isRefreshing = projectsIsFetching || metricsIsFetching;
  const lastUpdated = effectiveProjectId
    && !projectsError
    && !isError
    && projectsDataUpdatedAt > 0
    && metricsDataUpdatedAt > 0
    ? Math.min(projectsDataUpdatedAt, metricsDataUpdatedAt)
    : undefined;

  const allData = useMemo(
    () =>
      metrics?.map((m) => ({
        ...m,
        date: new Date(m.timestamp).toLocaleDateString('ar'),
      })) ?? [],
    [metrics],
  );

  const formatData = useMemo(() => {
    if (dateRange === 'all') return allData;
    const cutoffMs = Date.now() - (dateRange === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    return allData.filter((m) => new Date(m.timestamp).getTime() >= cutoffMs);
  }, [allData, dateRange]);

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" /> المؤشرات والقياسات
          </h1>
          <p className="text-muted-foreground text-sm mt-1">اتجاهات الجودة وتحليلها عبر الزمن.</p>
        </div>
        <div
          data-testid="metrics-controls"
          className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
        >
          <RefreshButton onRefresh={refreshMetrics} isRefreshing={isRefreshing} lastUpdated={lastUpdated} label="تحديث المؤشرات" refreshingLabel="جارٍ التحديث…" updatedLabel="آخر تحديث:" />
          {currentProject && (
            <Link
              href={`/projects/${encodeURIComponent(currentProject.id)}/workspace`}
              aria-label={`افتح مساحة العمل لمشروع ${currentProject.name}`}
              data-testid="link-metrics-project-workspace"
              className="inline-flex min-h-8 w-full shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              مساحة العمل
            </Link>
          )}
          <select
            value={effectiveProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            aria-label="اختر المشروع"
            className="w-full min-w-0 bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none font-medium sm:w-56"
          >
            {projects?.length === 0 ? (
              <option value="" disabled>لا توجد مشاريع متاحة</option>
            ) : projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div
            data-testid="metrics-date-range"
            className="flex w-full min-w-0 items-center border border-border rounded-md overflow-hidden text-xs font-medium sm:w-auto"
          >
            {(['7d', '30d', 'all'] as DateRange[]).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={dateRange === r}
                onClick={() => setDateRange(r)}
                className={`min-w-0 flex-1 px-3 py-2 transition-colors sm:flex-none ${
                  dateRange === r
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-secondary'
                }`}
              >
                {r === 'all' ? 'الكل' : r === '7d' ? '٧ أيام' : '٣٠ يومًا'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {projectsError ? (
        <RequestError message="تعذّر تحميل المشاريع لعرض المؤشرات." retryLabel="حاول مجددًا" onRetry={() => void refetchProjects()} />
      ) : !projectsLoaded ? (
        <div
          role="status"
          data-testid="metrics-projects-loading"
          className="h-64 bg-card border border-border rounded-xl flex items-center justify-center text-muted-foreground"
        >
          جارٍ تحميل قائمة المشاريع…
        </div>
      ) : !effectiveProjectId ? (
        <div
          role="status"
          data-testid="metrics-no-project"
          className="min-h-64 bg-card border border-border rounded-xl flex flex-col items-center justify-center gap-3 px-4 py-8 text-center text-muted-foreground"
        >
          <BarChart3 className="w-8 h-8 text-primary/60" aria-hidden="true" />
          <p>لا يوجد مشروع لعرض مؤشراته بعد.</p>
          <p className="max-w-md text-xs">
            ابدأ بوصف هدفك، أو افتح قائمة المشاريع لاختيار مشروع موجود.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Link
              href="/"
              data-testid="link-metrics-empty-goal"
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ابدأ بهدفك
            </Link>
            <Link
              href="/projects"
              data-testid="link-metrics-empty-projects"
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              اعرض مشاريعي
            </Link>
          </div>
        </div>
      ) : isLoading ? (
        <div className="h-96 bg-card border border-border rounded-xl animate-pulse"></div>
      ) : isError ? (
        <RequestError message={error instanceof Error ? error.message : 'تعذّر تحميل المؤشرات.'} retryLabel="حاول مجددًا" onRetry={() => void refetch()} />
      ) : formatData.length === 0 ? (
        <div className="min-h-64 bg-card border border-border rounded-xl flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
          <p>لا توجد بيانات مؤشرات سابقة لهذا المشروع بعد.</p>
          <p className="text-xs mt-1 opacity-70">شغّل فحصًا لإنشاء أول لقطة للبيانات.</p>
          <button
            type="button"
            onClick={startScan}
            disabled={!effectiveProjectId || scanBusy}
            data-testid="button-start-metrics-scan"
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {scanBusy
              ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Play className="h-4 w-4" aria-hidden="true" />}
            {scanProject.isPending
              ? 'جارٍ طلب الفحص…'
              : trackedScanInProgress
                ? activeScan?.projectId === effectiveProjectId ? 'جارٍ الفحص…' : 'فحص مشروع آخر جارٍ…'
                : projectScanInProgress
                  ? 'الفحص جارٍ بالفعل…'
                  : activeScan?.projectId === effectiveProjectId && activeScanStatus === 'failed'
                    ? 'أعد الفحص'
                    : 'ابدأ الفحص'}
          </button>
          {scanProject.isError && (
            <p role="alert" className="max-w-md text-xs text-destructive">
              {scanProject.error instanceof Error ? scanProject.error.message : 'تعذّر بدء الفحص. حاول مجددًا.'}
            </p>
          )}
          {activeScan?.projectId === effectiveProjectId && scanJob.isError && (
            <div role="alert" className="max-w-md text-xs text-destructive">
              <p>تعذّر التحقق من حالة الفحص؛ لن نبدأ فحصًا مكررًا.</p>
              <button type="button" onClick={() => void scanJob.refetch()} className="mt-1 underline underline-offset-2">
                أعد التحقق
              </button>
            </div>
          )}
          {activeScan?.projectId === effectiveProjectId
            && (activeScanStatus === 'queued' || activeScanStatus === 'running')
            && !scanJob.isError && (
              <p role="status" className="max-w-md text-xs">
                يعمل الفحص في الخلفية؛ ستُحدّث المؤشرات عند اكتماله.
              </p>
            )}
          {activeScan?.projectId === effectiveProjectId
            && activeScanStatus === undefined
            && !scanJob.isError && (
              <p role="status" className="max-w-md text-xs">
                جارٍ التحقق من حالة الفحص.
              </p>
            )}
          {activeScan?.projectId === effectiveProjectId && activeScanStatus === 'failed' && (
            <p role="alert" className="max-w-md text-xs text-destructive">
              {scanJob.data?.error || 'تعذّر إكمال الفحص. يمكنك المحاولة مجددًا.'}
            </p>
          )}
          {activeScan?.projectId === effectiveProjectId
            && activeScanStatus === 'completed'
            && (
              <p role="status" className="max-w-md text-xs">
                اكتمل الفحص، ولم تظهر مؤشرات لهذا المشروع بعد.
              </p>
            )}
          {projectScanInProgress && !trackedScanInProgress && (
            <p role="status" className="max-w-md text-xs">
              يجري فحص هذا المشروع بالفعل. لن نرسل طلب فحص مكررًا.
            </p>
          )}
          {trackedScanInProgress && activeScan?.projectId !== effectiveProjectId && (
            <p role="status" className="max-w-md text-xs">
              يجري فحص مشروع آخر؛ ستتمكن من بدء فحص هذا المشروع بعد انتهائه.
            </p>
          )}
        </div>
      ) : (
        <div className="min-w-0 space-y-6">
          <div className="min-w-0 bg-card border border-border rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold mb-6">اتجاه الجودة الإجمالي</h3>
            <div data-testid="metrics-overall-chart" dir="ltr" className="h-80 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={formatData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Line
                    type="monotone"
                    dataKey="overallScore"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={false}
                    name="النتيجة الإجمالية"
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="architectureScore"
                    stroke={CHART_COLORS.architecture}
                    strokeWidth={2}
                    dot={false}
                    name="البنية"
                  />
                  <Line
                    type="monotone"
                    dataKey="securityScore"
                    stroke={CHART_COLORS.security}
                    strokeWidth={2}
                    dot={false}
                    name="الأمان"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="min-w-0 bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="font-semibold mb-6">تغطية الاختبارات ومشكلات فحص الكود</h3>
              <div data-testid="metrics-tests-chart" dir="ltr" className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={formatData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      yAxisId="left"
                      dataKey="structuralTestEstimate"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                      name="تقدير الاختبارات % (بنيوي)"
                    />
                    <Bar
                      yAxisId="right"
                      dataKey="lintIssues"
                      fill="hsl(var(--destructive))"
                      radius={[4, 4, 0, 0]}
                      name="مشكلات فحص الكود"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="min-w-0 bg-card border border-border rounded-xl p-6 shadow-sm">
              <h3 className="font-semibold mb-6">الدين التقني (ساعات)</h3>
              <div data-testid="metrics-debt-chart" dir="ltr" className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formatData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="step"
                      dataKey="technicalDebt"
                      stroke={CHART_COLORS.techDebt}
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      name="تقدير الدين التقني"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
