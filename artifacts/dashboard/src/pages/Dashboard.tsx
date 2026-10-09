import { useState } from 'react';
import {
  getGetHealthQueryKey,
  getListOperatorAlertsQueryKey,
  useListOperatorAlerts,
  useGetDashboard,
  useGetHealth,
} from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  FolderGit2,
  Database,
  TrendingUp,
  ChevronDown,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import { useMonotonicData } from '@/lib/freshness';
import { HOME_GOAL_MAX_LENGTH, storeHomeGoalDraft } from '@/lib/home-goal-handoff';

function formatHealthTimestamp(value: Date | string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function OperatorAlertsCard() {
  const { data, error, isLoading, isFetching, refetch } = useListOperatorAlerts(
    { activeOnly: true, limit: 50 },
    {
      query: {
        queryKey: getListOperatorAlertsQueryKey({ activeOnly: true, limit: 50 }),
        refetchInterval: 30_000,
        retry: 1,
      },
    },
  );
  const alerts = data?.alerts ?? [];

  if (!error && alerts.length === 0) {
    return (
      <section
        aria-label="Operator alerts"
        className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/90"
      >
        {isLoading ? (
          <Activity className="h-3.5 w-3.5 shrink-0 animate-pulse" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span>{isLoading ? 'Checking provider health…' : 'No active provider alerts.'}</span>
        {isFetching && !isLoading && (
          <span className="ml-auto text-[10px] text-muted-foreground">Updating…</span>
        )}
      </section>
    );
  }

  return (
    <section
      aria-label="Operator alerts"
      className={`rounded-xl border p-4 shadow-sm ${
        alerts.length > 0
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-emerald-500/20 bg-emerald-500/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            alerts.length > 0
              ? 'bg-amber-500/10 text-amber-300'
              : 'bg-emerald-500/10 text-emerald-500'
          }`}
        >
          {alerts.length > 0 ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Operator alerts</h2>
            {alerts.length > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                {alerts.length} open
              </span>
            )}
          </div>
          {isLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">Checking provider health…</p>
          ) : error ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive/80">
              <span>Could not load operator alerts.</span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => void refetch()}
              >
                Retry
              </button>
            </div>
          ) : alerts.length === 0 ? (
            <p className="mt-1 text-xs text-emerald-200/80">
              No active provider alerts. Groq defaults are either healthy or not configured.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {alerts.map((alert) => {
                const isCatalogUnavailable = alert.kind === 'groq_model_catalog_unavailable';
                return (
                  <div
                    key={alert.id}
                    className={`rounded-lg border bg-background/30 p-3 ${
                      isCatalogUnavailable
                        ? 'border-blue-500/20'
                        : 'border-amber-500/20'
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isCatalogUnavailable && <Info className="h-3.5 w-3.5 text-blue-300" />}
                        <h3 className={`text-sm font-medium ${
                          isCatalogUnavailable ? 'text-blue-100' : 'text-amber-100'
                        }`}>
                          {alert.title}
                        </h3>
                        {isCatalogUnavailable && (
                          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                            Temporary outage
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Seen {formatHealthTimestamp(alert.lastSeenAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{alert.message}</p>
                    <p className={`mt-2 text-xs leading-5 ${
                      isCatalogUnavailable ? 'text-blue-200/90' : 'text-amber-200/90'
                    }`}>
                      <span className="font-medium">Remediation:</span> {alert.remediation}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      {isCatalogUnavailable ? (
                        <span>Scope: Groq model catalog</span>
                      ) : (
                        <>
                          <span>Role: {alert.modelRole === 'fast' ? 'Fast' : 'Powerful'}</span>
                          <span className="font-mono break-all">{alert.modelId}</span>
                        </>
                      )}
                      {alert.occurrenceCount > 1 && <span>Observed {alert.occurrenceCount} times</span>}
                      <Link href="/ai" className="text-primary hover:underline">
                        Open provider settings
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {isFetching && !isLoading && (
          <span className="text-[10px] text-muted-foreground" aria-label="Refreshing operator alerts">
            Updating…
          </span>
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [goalDraft, setGoalDraft] = useState('');
  const [goalHandoffError, setGoalHandoffError] = useState('');
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

  function continueWithGoal() {
    const normalizedGoal = goalDraft.trim();
    if (!normalizedGoal) return;

    if (!storeHomeGoalDraft(normalizedGoal)) {
      setGoalHandoffError('تعذر نقل المسودة إلى المساعد. احتفظ بنصك وحاول مرة أخرى.');
      return;
    }

    setGoalHandoffError('');
    setLocation('/ai');
  }

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
        title="تعذر تحميل مساحة العمل"
        message="لم نتمكن من جلب حالة العمل الآن."
        retryLabel="أعد المحاولة"
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" dir="rtl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">EngineeringOS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">مساحة العمل</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ابدأ بالنتيجة التي تريدها، وتابع العمل وما تغيّر من مكان واحد.
          </p>
        </div>
        <RefreshButton
          onRefresh={async () => { await refetch(); await refetchHealth(); }}
          isRefreshing={isRefetching}
          lastUpdated={dataUpdatedAt}
          label="تحديث البيانات"
        />
      </div>

      <section
        aria-labelledby="home-goal-heading"
        data-testid="section-home-goal"
        dir="rtl"
        className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-7"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="home-goal-heading" className="text-lg font-semibold">
              ما الذي تريد إنجازه؟
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              اكتب هدفك بلغتك. ستراجع المسودة والمشروع المناسب داخل المساعد قبل إرسالها.
            </p>
          </div>
        </div>

        <label htmlFor="home-goal-draft" className="sr-only">
          اكتب هدفك
        </label>
        <Textarea
          id="home-goal-draft"
          data-testid="input-home-goal"
          dir="auto"
          maxLength={HOME_GOAL_MAX_LENGTH}
          value={goalDraft}
          onChange={(event) => {
            setGoalDraft(event.target.value);
            if (goalHandoffError) setGoalHandoffError('');
          }}
          placeholder="مثال: ساعدني أفهم سبب بطء صفحة تسجيل الدخول وأقترح حلًا آمنًا."
          className="mt-5 min-h-28 resize-y border-border/80 bg-background/80 text-sm leading-6"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">
            لن يُرسل النص تلقائيًا، وكتابته لا توافق على أي تغييرات.
            <span className="mr-2 font-mono" data-testid="text-home-goal-length">
              {goalDraft.length}/{HOME_GOAL_MAX_LENGTH}
            </span>
          </p>
          <Button
            type="button"
            data-testid="button-start-goal"
            disabled={!goalDraft.trim()}
            onClick={continueWithGoal}
            className="w-full gap-2 sm:w-auto"
          >
            ابدأ مع المساعد
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        {goalHandoffError && (
          <p
            role="alert"
            data-testid="status-home-goal-error"
            className="mt-3 text-sm text-destructive"
          >
            {goalHandoffError}
          </p>
        )}
      </section>

      <section
        aria-labelledby="home-work-summary-heading"
        data-testid="section-home-work-summary"
        dir="rtl"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="home-work-summary-heading" className="text-lg font-semibold">
              متابعة العمل
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              ملخص لحالات المهام المسجلة؛ تفاصيل القبول والإثبات تبقى ضمن المهمة.
            </p>
          </div>
          <Link
            href="/tasks"
            data-testid="link-tasks-from-home"
            className="text-sm font-medium text-primary hover:underline"
          >
            عرض المهام
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/tasks"
            data-testid="card-active-work-home"
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <p className="text-sm text-muted-foreground">عمل جارٍ</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums" data-testid="text-active-work-home">
              {dashboard.activeTaskCount}
            </p>
          </Link>
          <Link
            href="/tasks"
            data-testid="card-completed-work-home"
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <p className="text-sm text-muted-foreground">مهام بحالة مكتملة</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums" data-testid="text-completed-work-home">
              {dashboard.completedTaskCount}
            </p>
          </Link>
          <Link
            href="/tasks"
            data-testid="card-failed-work-home"
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-destructive/40"
          >
            <p className="text-sm text-muted-foreground">مهام بحالة متعثرة</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums" data-testid="text-failed-work-home">
              {dashboard.failedTaskCount}
            </p>
          </Link>
          <Link
            href="/projects"
            data-testid="card-project-count-home"
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <p className="text-sm text-muted-foreground">المشاريع</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums" data-testid="text-project-count-home">
              {dashboard.projectCount}
            </p>
          </Link>
        </div>
      </section>

      <section
        aria-labelledby="home-recent-activity-heading"
        data-testid="section-home-recent-activity"
        dir="rtl"
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h2 id="home-recent-activity-heading" className="font-semibold">
              آخر التحديثات
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">أحدث ما سجله النظام عن المشاريع والمهام.</p>
          </div>
          <Link
            href="/events"
            data-testid="link-events-from-home"
            className="text-sm font-medium text-primary hover:underline"
          >
            سجل التحديثات
          </Link>
        </div>
        {dashboard.recentEvents?.length ? (
          <div className="divide-y divide-border">
            {dashboard.recentEvents.slice(0, 3).map((event) => (
              <div
                key={event.id}
                data-testid={`event-home-${event.id}`}
                className="flex gap-3 px-4 py-3 sm:px-5"
              >
                <div className="mt-0.5 shrink-0">
                  {event.severity === 'error' || event.severity === 'warning' ? (
                    <AlertTriangle
                      aria-hidden="true"
                      className={`h-4 w-4 ${event.severity === 'error' ? 'text-destructive' : 'text-yellow-500'}`}
                    />
                  ) : event.severity === 'success' ? (
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Activity aria-hidden="true" className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{event.message || event.type}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatHealthTimestamp(event.timestamp)}
                    {event.projectId && (
                      <span className="mr-2 font-mono" dir="ltr">
                        {event.projectId.slice(0, 8)}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            <p>لا توجد تحديثات مسجلة بعد.</p>
            <Link
              href="/projects"
              data-testid="link-connect-project-from-home"
              className="mt-2 inline-flex font-medium text-primary hover:underline"
            >
              افتح المشاريع للبدء
            </Link>
          </div>
        )}
      </section>

      <details
        aria-label="تفاصيل التشغيل المتقدمة"
        data-testid="details-advanced-dashboard"
        className="group rounded-xl border border-border bg-card"
      >
        <summary
          data-testid="summary-advanced-dashboard"
          dir="rtl"
          className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">تفاصيل تقنية اختيارية</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              التنبيهات، صحة المشاريع، سجل الأحداث، ومؤشرات التشغيل.
            </p>
          </div>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-6 border-t border-border p-4 sm:p-5" dir="ltr">
          <OperatorAlertsCard />

          {/* Retention health is deliberately limited to content-free sweep metadata. */}
          <details
            aria-label="AI diagnostics retention health"
            data-testid="details-ai-diagnostics"
            className="group rounded-xl border border-border bg-card"
          >
            <summary
              data-testid="summary-ai-diagnostics"
              className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden"
            >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
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
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">AI diagnostics</h2>
              <p className={`mt-0.5 truncate text-xs ${
                retention?.status === 'failed'
                  ? 'text-destructive/80'
                  : 'text-muted-foreground'
              }`}>
                {retention?.status === 'failed'
                  ? 'Retention sweep needs attention'
                  : retention?.status === 'success'
                    ? 'Retention health is normal'
                    : 'Checking retention health'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              data-testid="status-ai-diagnostics"
              className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
                retention?.status === 'failed'
                  ? 'bg-destructive/10 text-destructive'
                  : retention?.status === 'success'
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-secondary text-muted-foreground'
              }`}
            >
              {retention?.status === 'failed'
                ? 'Needs attention'
                : retention?.status === 'success'
                  ? 'Healthy'
                  : 'Checking'}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </div>
        </summary>
            <section
              aria-label="AI diagnostics retention details"
              className="border-t border-border px-4 py-3"
            >
              {retention?.status === 'failed' ? (
                <p className="text-xs text-destructive/80">
                  The sweep will be retried automatically on the next startup.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Last completed {formatHealthTimestamp(retention?.completedAt)}
                </p>
              )}
              {retention?.status === 'success' && (
                <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:max-w-xl">
                  <span className="text-muted-foreground">Chat rows</span>
                  <span className="font-mono font-medium">
                    {retention.chatRowsScanned} scanned / {retention.chatRowsPruned} pruned
                  </span>
                  <span className="text-muted-foreground">Execution rows</span>
                  <span className="font-mono font-medium">
                    {retention.executionRowsScanned} scanned / {retention.executionRowsPruned} pruned
                  </span>
                </div>
              )}
            </section>
          </details>

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
      </details>
    </div>
  );
}
