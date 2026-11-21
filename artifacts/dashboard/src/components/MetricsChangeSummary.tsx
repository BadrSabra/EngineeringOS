import { useMemo } from 'react';
import type { MetricRecord } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

const COMPARABLE_METRICS = [
  { key: 'overallScore', label: 'النتيجة الإجمالية (نقاط)', higherIsBetter: true },
  { key: 'securityScore', label: 'الأمان (نقاط)', higherIsBetter: true },
  { key: 'performanceScore', label: 'الأداء (نقاط)', higherIsBetter: true },
  { key: 'technicalDebt', label: 'الدين التقني (ساعات)', higherIsBetter: false },
  { key: 'lintIssues', label: 'ملاحظات فحص الكود (عدد)', higherIsBetter: false },
] as const satisfies ReadonlyArray<{
  key: keyof MetricRecord;
  label: string;
  higherIsBetter: boolean;
}>;

function formatMetricDate(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString('ar');
}

function formatDelta(delta: number): string {
  return new Intl.NumberFormat('ar', {
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(delta);
}

export default function MetricsChangeSummary({ metrics }: { metrics: MetricRecord[] }) {
  const comparison = useMemo(() => {
    const ordered = metrics
      .filter((metric) => Number.isFinite(Date.parse(metric.timestamp)))
      .slice()
      .sort((first, second) => (
        Date.parse(first.timestamp) - Date.parse(second.timestamp)
        || first.id.localeCompare(second.id)
      ));
    const previous = ordered.at(-2);
    const latest = ordered.at(-1);
    if (!previous || !latest) return null;

    const changes = COMPARABLE_METRICS.flatMap((metric) => {
      const previousValue = previous[metric.key];
      const latestValue = latest[metric.key];
      if (
        typeof previousValue !== 'number'
        || !Number.isFinite(previousValue)
        || typeof latestValue !== 'number'
        || !Number.isFinite(latestValue)
      ) return [];

      return [{ ...metric, delta: latestValue - previousValue }];
    });

    return { previous, latest, changes };
  }, [metrics]);

  if (!comparison) {
    return (
      <p
        role="status"
        data-testid="metrics-change-first-reading"
        className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        هذه أول قراءة؛ ستظهر المقارنة بعد الفحص التالي.
      </p>
    );
  }

  return (
    <section
      aria-labelledby="metrics-change-heading"
      data-testid="metrics-change-summary"
      className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="metrics-change-heading" className="font-semibold">
            ما الذي تغيّر منذ آخر فحص؟
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            الأعلى أفضل للنتيجة والأمان والأداء؛ والأقل أفضل للدين التقني وملاحظات الفحص.
          </p>
        </div>
        <p
          data-testid="metrics-change-period"
          className="text-xs text-muted-foreground"
          dir="auto"
        >
          من {formatMetricDate(comparison.previous.timestamp)} إلى {formatMetricDate(comparison.latest.timestamp)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {comparison.changes.map((metric) => {
          const trend = metric.delta === 0
            ? 'unchanged'
            : (metric.higherIsBetter ? metric.delta > 0 : metric.delta < 0)
              ? 'improved'
              : 'declined';
          const trendLabel = trend === 'improved'
            ? 'تحسّن'
            : trend === 'declined'
              ? 'تراجع'
              : 'بلا تغيير';
          const Icon = trend === 'improved' ? ArrowUp : trend === 'declined' ? ArrowDown : Minus;
          const tone = trend === 'improved'
            ? 'text-emerald-700 dark:text-emerald-300'
            : trend === 'declined'
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-muted-foreground';

          return (
            <div
              key={metric.key}
              role="group"
              aria-label={`${metric.label}: ${trendLabel} ${formatDelta(metric.delta)}`}
              data-testid={`metric-change-${metric.key}`}
              data-trend={trend}
              data-delta={metric.delta}
              className="min-w-0 rounded-lg border border-border/70 bg-background/60 px-3 py-2.5"
            >
              <p className="truncate text-xs text-muted-foreground">{metric.label}</p>
              <div className={`mt-1 flex items-center gap-1.5 font-semibold ${tone}`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formatDelta(metric.delta)}</span>
              </div>
              <p className={`mt-0.5 text-[10px] ${tone}`}>{trendLabel}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
