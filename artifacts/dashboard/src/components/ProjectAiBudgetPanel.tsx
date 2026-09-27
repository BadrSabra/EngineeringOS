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
  dailyAttemptLimit: z.number().int().min(1).max(10_000),
  dailyTokenLimit: z.number().int().min(1_000).max(10_000_000),
  warningThresholdPercent: z.number().min(50).max(99),
});

type BudgetFormValues = z.infer<typeof budgetFormSchema>;

const numberFormat = new Intl.NumberFormat();

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

function formatBudgetState(state: string): string {
  return state.replaceAll('_', ' ');
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
          setBudgetMessage('Project AI budget saved.');
        },
        onError: () => {
          setBudgetError('Could not save the Project AI budget. Try again.');
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
          setAlertMessage(action === 'acknowledge' ? 'Alert acknowledged.' : 'Alert resolved.');
        },
        onError: () => {
          setAlertError('Could not update this budget alert. Try again.');
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
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 id="project-ai-budget-heading" className="font-semibold flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" /> Project AI budget
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily usage limits and alerts for this project. Mission budgets are managed separately.
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
          Loading project budget…
        </p>
      ) : budgetQuery.isError || !budget ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
          <p className="text-amber-100" role="alert">
            Project AI budget is unavailable.
          </p>
          <button
            type="button"
            onClick={() => void budgetQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
            data-testid="retry-project-ai-budget"
          >
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs text-muted-foreground">Attempts used</div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {numberFormat.format(budget.consumedAttempts)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}+ {numberFormat.format(budget.reservedAttempts)} reserved
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {numberFormat.format(budget.remainingAttempts)} remaining today
              </div>
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-xs text-muted-foreground">Recorded tokens</div>
              <div className="mt-1 font-mono text-lg font-semibold">
                {tokenTotal == null ? '—' : numberFormat.format(tokenTotal)}
              </div>
              <div className="mt-1 text-xs capitalize text-muted-foreground">
                {budget.tokenUsage.status === 'known'
                  ? 'Usage reporting complete'
                  : budget.tokenUsage.status === 'partial'
                    ? 'Partial usage data'
                    : 'Usage data unavailable'}
              </div>
              {tokenProgress != null && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"
                  role="progressbar"
                  aria-label="Recorded token use"
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
              <div className="text-xs text-muted-foreground">Budget resets</div>
              <div className="mt-1 text-sm font-medium">{formatDate(budget.resetAt)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Token headroom: {budget.tokenUsage.remaining == null
                  ? 'unavailable'
                  : numberFormat.format(budget.tokenUsage.remaining)}
              </div>
            </div>
          </div>

          <Form {...form}>
            <form
              className="mt-5 border-t border-border pt-5"
              onSubmit={form.handleSubmit(onSaveBudget)}
              aria-label="Update project AI budget"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="dailyAttemptLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily attempt limit</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1}
                          max={10_000}
                          step={1}
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-attempt-limit"
                        />
                      </FormControl>
                      <FormDescription>1–10,000 attempts per day.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dailyTokenLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Daily token limit</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1_000}
                          max={10_000_000}
                          step={1}
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-token-limit"
                        />
                      </FormControl>
                      <FormDescription>1,000–10,000,000 tokens per day.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="warningThresholdPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warning threshold (%)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={50}
                          max={99}
                          step="any"
                          onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                          disabled={updateBudget.isPending}
                          data-testid="input-ai-budget-warning-threshold"
                        />
                      </FormControl>
                      <FormDescription>Warn between 50% and 99% of the limit.</FormDescription>
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
                  {updateBudget.isPending ? 'Saving…' : 'Save budget'}
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
          <h3 className="text-sm font-semibold">Budget alerts</h3>
          <button
            type="button"
            onClick={() => void alertsQuery.refetch()}
            disabled={alertsQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
            aria-label="Refresh budget alerts"
          >
            <RotateCw className={`h-3.5 w-3.5 ${alertsQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {alertsQuery.isLoading ? (
          <p className="mt-3 animate-pulse text-sm text-muted-foreground" role="status">
            Loading budget alerts…
          </p>
        ) : alertsQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
            <p className="text-amber-100" role="alert">Budget alerts are unavailable.</p>
            <button
              type="button"
              onClick={() => void alertsQuery.refetch()}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
              data-testid="retry-project-ai-budget-alerts"
            >
              Retry alerts
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No active budget alerts.</p>
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
                      <h4 className="text-sm font-medium">{alert.title}</h4>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium capitalize ${alertStatusClass(alert.status)}`}>
                        {alert.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{alert.message}</p>
                    {alert.remediation && (
                      <p className="mt-1 text-xs text-muted-foreground">{alert.remediation}</p>
                    )}
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Last seen {formatDate(alert.lastSeenAt)}
                      {alert.occurrenceCount > 1
                        ? ` · ${numberFormat.format(alert.occurrenceCount)} occurrences`
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
                        Acknowledge
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runAlertAction(alert.id, 'resolve')}
                      disabled={updateAlert.isPending}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                      data-testid={`resolve-budget-alert-${alert.id}`}
                    >
                      Resolve
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