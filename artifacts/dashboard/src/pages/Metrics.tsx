import React, { useState, useMemo } from 'react';
import { useListMetrics, useListProjects, getListMetricsQueryKey } from '@workspace/api-client-react';
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
import { BarChart3, AlertTriangle } from 'lucide-react';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';

const CHART_COLORS = {
  architecture: '#10b981',
  security:     '#f59e0b',
  techDebt:     '#8b5cf6',
} as const;

type DateRange = '7d' | '30d' | 'all';

export default function Metrics() {
  const { data: projects, isError: projectsError, refetch: refetchProjects } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>('30d');

  const effectiveProjectId = selectedProjectId || (projects?.[0]?.id ?? '');

  const { data: metrics, isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useListMetrics(
    { projectId: effectiveProjectId },
    { query: { queryKey: getListMetricsQueryKey({ projectId: effectiveProjectId }), enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );

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
          <RefreshButton onRefresh={async () => { await refetchProjects(); await refetch(); }} isRefreshing={isRefetching} lastUpdated={dataUpdatedAt} label="تحديث المؤشرات" refreshingLabel="جارٍ التحديث…" updatedLabel="آخر تحديث:" />
          <select
            value={effectiveProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            aria-label="اختر المشروع"
            className="w-full min-w-0 bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none font-medium sm:w-56"
          >
            {projects?.map((p) => (
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
      ) : !effectiveProjectId ? (
        <div className="h-64 bg-card border border-border rounded-xl flex items-center justify-center text-muted-foreground">
          اختر مشروعًا لعرض مؤشراته.
        </div>
      ) : isLoading ? (
        <div className="h-96 bg-card border border-border rounded-xl animate-pulse"></div>
      ) : isError ? (
        <RequestError message={error instanceof Error ? error.message : 'تعذّر تحميل المؤشرات.'} retryLabel="حاول مجددًا" onRetry={() => void refetch()} />
      ) : formatData.length === 0 ? (
        <div className="h-64 bg-card border border-border rounded-xl flex flex-col items-center justify-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mb-2 opacity-50" />
          <p>لا توجد بيانات مؤشرات سابقة لهذا المشروع بعد.</p>
          <p className="text-xs mt-1 opacity-70">شغّل فحصًا لإنشاء أول لقطة للبيانات.</p>
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
