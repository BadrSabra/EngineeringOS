import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  getGetAiProjectBudgetQueryKey,
  getListAiProjectBudgetAlertsQueryKey,
  useGetAiProjectBudget,
  useListAiProjectBudgetAlerts,
  useUpdateAiProjectBudget,
  useUpdateAiProjectBudgetAlert,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertTriangle, Gauge, RotateCw } from 'lucide-react';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

const budgetFormSchema = z.object({
  dailyAttemptLimit: z.number({ invalid_type_error: 'أدخل عددًا صحيحًا للمحاولات.' })
    .int('يجب أن يكون عدد المحاولات عددًا صحيحًا.')
    .min(1, 'الحد الأدنى محاولة واحدة يوميًا.')
    .max(10_000, 'الحد الأقصى 10,000 محاولة يوميًا.'),
  dailyTokenLimit: z.number({ invalid_type_error: 'أدخل عددًا صحيحًا للرموز.' })
    .int('يجب أن يكون حد الرموز عددًا صحيحًا.')
    .min(1_000, 'الحد الأدنى 1,000 رمز يوميًا.')
    .max(10_000_000, 'الحد الأقصى 10,000,000 رمز يوميًا.'),
  warningThresholdPercent: z.number({ invalid_type_error: 'أدخل نسبة مئوية.' })
    .min(50, 'يجب ألا تقل النسبة عن 50%.')
    .max(99, 'يجب ألا تزيد النسبة عن 99%.'),
});

type BudgetFormValues = z.infer<typeof budgetFormSchema>;

const numberFormat = new Intl.NumberFormat();

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'غير متاح'
    : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBudgetState(state: string): string {
  switch (state) {
    case 'healthy':
    case 'within_limit':
      return 'ضمن الحد';
    case 'warning':
      return 'قريب من الحد';
    case 'exhausted':
      return 'تم استهلاك الحد';
    default:
      return state.replaceAll('_', ' ');
  }
}

function formatAlertStatus(status: string): string {
  switch (status) {
    case 'open':
      return 'مفتوح';
    case 'acknowledged':
      return 'تم تأكيد الاطلاع';
    case 'resolved':
      return 'تمت معالجته';
    default:
      return status;
  }
}

function budgetStateClass(state: string): string {
  if (state === 'exhausted') {
    return 'border-rose-500/30 bg-rose-500/5 text-rose-300';
  }
  if (state === 'warning') {
    return 'border-amber-500/30 bg-amber-500/5 text-amber-200';
  }
  return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300';
}

function alertStatusClass(status: string): string {
  return status === 'open'
    ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
    : 'border-border bg-secondary/40 text-muted-foreground';
}

export default function ProjectAiBudgetPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);

  const budgetQuery = useGetAiProjectBudget(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: getGetAiProjectBudgetQueryKey(projectId),
      staleTime: 15_000,
    },
  });
  const alertsQuery = useListAiProjectBudgetAlerts(
    projectId,
    { activeOnly: true },
    {
      query: {
        enabled: Boolean(projectId),
        queryKey: getListAiProjectBudgetAlertsQueryKey(projectId, { activeOnly: true }),
        staleTime: 15_000,
      },
    },
  );
  const updateBudget = useUpdateAiProjectBudget();
  const updateAlert = useUpdateAiProjectBudgetAlert();

  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      dailyAttemptLimit: 100,
      dailyTokenLimit: 100_000,
      warningThresholdPercent: 80,
    },
  });

  const budget = budgetQuery.data;
  const resetForm = form.reset;
  useEffect(() => {
    if (!budget) return;
    resetForm({
      dailyAttemptLimit: budget.dailyAttemptLimit,
      dailyTokenLimit: budget.dailyTokenLimit,
      warningThresholdPercent: budget.warningThreshold * 100,
    });
    setBudgetMessage(null);
    setBudgetError(null);
  }, [budget?.updatedAt, budget?.projectId, projectId, resetForm]);

  const onSaveBudget = (values: BudgetFormValues) => {
    setBudgetMessage(null);
    setBudgetError(null);
    updateBudget.mutate(
      {
        projectId,
        data: {
          dailyAttemptLimit: values.dailyAttemptLimit,
          dailyTokenLimit: values.dailyTokenLimit,
          warningThreshold: values.warningThresholdPercent / 100,
        },
      },
      {
        onSuccess: (savedBudget) => {
          queryClient.setQueryData(getGetAiProjectBudgetQueryKey(projectId), savedBudget);
          void queryClient.invalidateQueries({
            queryKey: getGetAiProjectBudgetQueryKey(projectId),
          });
          setBudgetMessage('تم حفظ ميزانية الذكاء الاصطناعي للمشروع.');
        },
        onError: () => {
          setBudgetError('تعذّر حفظ ميزانية الذكاء الاصطناعي للمشروع. حاول مرة أخرى.');
        },
      },
    );
  };

  const runAlertAction = (
    alertId: string,
    action: 'acknowledge' | 'resolve',
  ) => {
    setAlertMessage(null);
    setAlertError(null);
    updateAlert.mutate(
      { projectId, alertId, data: { action } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getListAiProjectBudgetAlertsQueryKey(projectId),
          });
          void queryClient.invalidateQueries({
            queryKey: getGetAiProjectBudgetQueryKey(projectId),
          });
          setAlertMessage(action === 'acknowledge' ? 'تم تأكيد الاطلاع على التنبيه.' : 'تم إغلاق التنبيه.');
        },
        onError: () => {
          setAlertError('تعذّر تحديث تنبيه الميزانية. حاول مرة أخرى.');
        },
      },
    );
  };

  const alerts = alertsQuery.data?.alerts ?? [];
  const tokenTotal = budget?.tokenUsage.total;
  const tokenProgress = budget && tokenTotal != null
    ? Math.min(100, Math.max(0, (tokenTotal / budget.dailyTokenLimit) * 100))
    : null;

  return (
    <section
      className="bg-card border border-border rounded-xl p-5 shadow-sm"
      aria-labelledby="project-ai-budget-heading"
      data-testid="project-ai-budget-panel"
      dir="rtl"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 id="project-ai-budget-heading" className="font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" /> ميزانية الذكاء الاصطناعي للمشروع
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            حدود الاستخدام اليومية وتنبيهاته لهذا المشروع. ميزانية المهمة الرئيسية تُدار بصورة مستقلة.
          </p>
        </div>
        {budget && (
          <span className={`inline-flex w-fit items-center rounded-md border px-2.5 py-1 text-xs font-medium capitalize ${budgetStateClass(budget.state)}`}>
            {formatBudgetState(budget.state)}
          </span>
        )}
      </div>

      {budgetQuery.isLoading ? (
        <p className="mt-5 animate-pulse text-sm text-muted-foreground" role="status">
          جارٍ تحميل الميزانية…
        </p>
      ) : budgetQuery.isError || !budget ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
          <p className="text-amber-100" role="alert">
            ميزانية الذكاء الاصطناعي للمشروع غير متاحة.
          </p>
          <button
            type="button"
            onClick={() => void budgetQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
            data-testid="retry-project-ai-budget"
          >
            <RotateCw className="h-3.5 w-3.5" /> إعادة المحاولة
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs text-muted-foreground">المحاولات المستخدمة</div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {numberFormat.format(budget.consumedAttempts)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}+ {numberFormat.format(budget.reservedAttempts)} محجوزة
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {numberFormat.format(budget.remainingAttempts)} متبقية اليوم
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs text-muted-foreground">الرموز المسجّلة</div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {tokenTotal == null ? '—' : numberFormat.format(tokenTotal)}
              </div>
              <div className="mt-1 text-xs capitalize text-muted-foreground">
                {budget.tokenUsage.status === 'known'
                  ? 'اكتمل تسجيل بيانات الاستخدام'
                  : budget.tokenUsage.status === 'partial'
                    ? 'بيانات الاستخدام جزئية'
                    : 'بيانات الاستخدام غير متاحة'}
              </div>
              {tokenProgress != null && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  aria-label="نسبة الرموز المستخدمة"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(tokenProgress)}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${tokenProgress}%` }}
                  />
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs text-muted-foreground">موعد إعادة ضبط الميزانية</div>
              <div className="mt-1 text-sm font-medium">{formatDate(budget.resetAt)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                المتبقي من حد الرموز: {budget.tokenUsage.remaining == null
                  ? 'غير متاح'
                  : numberFormat.format(budget.tokenUsage.remaining)}
              </div>
            </div>
          </div>

          <Form {...form}>
            <form
              className="mt-5 border-t border-border pt-5"
              onSubmit={form.handleSubmit(onSaveBudget)}
              aria-label="تعديل ميزانية الذكاء الاصطناعي للمشروع"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="dailyAttemptLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحد اليومي للمحاولات</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          dir="ltr"
                          min={1}
                          max={10_000}
                          step={1}
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-attempt-limit"
                        />
                      </FormControl>
                      <FormDescription>من 1 إلى 10,000 محاولة يوميًا.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dailyTokenLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>الحد اليومي للرموز</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          dir="ltr"
                          min={1_000}
                          max={10_000_000}
                          step={1}
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-token-limit"
                        />
                      </FormControl>
                      <FormDescription>من 1,000 إلى 10,000,000 رمز يوميًا.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="warningThresholdPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>نسبة بدء التنبيه (%)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          dir="ltr"
                          min={50}
                          max={99}
                          step="any"
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-warning-threshold"
                        />
                      </FormControl>
                      <FormDescription>يبدأ التنبيه عند بلوغ نسبة بين 50% و99% من الحد.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={updateBudget.isPending || !budget}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="save-project-ai-budget"
                >
                  {updateBudget.isPending ? 'جارٍ الحفظ…' : 'حفظ الميزانية'}
                </button>
                {budgetMessage && (
                  <p role="status" className="text-sm text-emerald-300" data-testid="status-project-ai-budget">
                    {budgetMessage}
                  </p>
                )}
                {budgetError && (
                  <p role="alert" className="text-sm text-destructive" data-testid="error-project-ai-budget">
                    {budgetError}
                  </p>
                )}
              </div>
            </form>
          </Form>
        </>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">تنبيهات الميزانية</h3>
          <button
            type="button"
            onClick={() => void alertsQuery.refetch()}
            disabled={alertsQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            aria-label="تحديث تنبيهات الميزانية"
          >
            <RotateCw className={`h-3.5 w-3.5 ${alertsQuery.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        {alertsQuery.isLoading ? (
          <p className="mt-3 animate-pulse text-sm text-muted-foreground" role="status">
            جارٍ تحميل التنبيهات…
          </p>
        ) : alertsQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
            <p className="text-amber-100" role="alert">تنبيهات الميزانية غير متاحة.</p>
            <button
              type="button"
              onClick={() => void alertsQuery.refetch()}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
              data-testid="retry-project-ai-budget-alerts"
            >
              إعادة تحميل التنبيهات
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">لا توجد تنبيهات ميزانية نشطة.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {alerts.map((alert) => (
              <article
                key={alert.id}
                className="rounded-lg border border-border bg-secondary/20 p-3"
                data-testid={`project-ai-budget-alert-${alert.id}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                        <h4 className="text-sm font-medium" dir="auto">{alert.title}</h4>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium capitalize ${alertStatusClass(alert.status)}`}>
                          {formatAlertStatus(alert.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground" dir="auto">{alert.message}</p>
                    {alert.remediation && (
                      <p className="mt-1 text-xs text-muted-foreground" dir="auto">{alert.remediation}</p>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      آخر ظهور: {formatDate(alert.lastSeenAt)}
                      {alert.occurrenceCount > 1
                        ? ` · مرات الظهور: ${numberFormat.format(alert.occurrenceCount)}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {alert.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => runAlertAction(alert.id, 'acknowledge')}
                        disabled={updateAlert.isPending}
                        className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                        data-testid={`acknowledge-budget-alert-${alert.id}`}
                      >
                        تأكيد الاطلاع
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runAlertAction(alert.id, 'resolve')}
                      disabled={updateAlert.isPending}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                      data-testid={`resolve-budget-alert-${alert.id}`}
                    >
                      إغلاق التنبيه
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {alertMessage && (
          <p role="status" className="mt-3 text-sm text-emerald-300" data-testid="status-project-ai-budget-alert">
            {alertMessage}
          </p>
        )}
        {alertError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="error-project-ai-budget-alert">
            {alertError}
          </p>
        )}
      </div>
    </section>
  );
}