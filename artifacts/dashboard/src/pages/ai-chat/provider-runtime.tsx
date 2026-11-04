import { useEffect, useState } from 'react';
import { AlertCircle, Download, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiProviderMetric, AiStreamErrorEvent, AiUsageSummary, GroqModelAvailability, ProviderLifecycleSnapshot } from '@workspace/api-client-react';
import { ApiError } from '@/lib/api-fetch';
import type { ChatMessage } from './types';

type ProviderKeyStatus = {
  configured: boolean;
  effectiveConfigured?: boolean;
  last4: string | null;
  updatedAt: string | null;
  lifecycle?: ProviderLifecycleSnapshot;
  modelAvailability?: GroqModelAvailability;
};

export type GroqKeyStatus = ProviderKeyStatus;

export type DeepSeekKeyStatus = ProviderKeyStatus;

export type OpenRouterKeyStatus = ProviderKeyStatus;

export type GeminiKeyStatus = ProviderKeyStatus;

export type ActiveProvider     = { provider: 'groq' | 'deepseek' | 'openrouter' | 'gemini' | null; configured: boolean };

/** PR-06: runtime health snapshot returned by /api/ai/metrics */
export type ProviderRuntimeMetric = AiProviderMetric;

export type MetricsResponse = {
  metrics: ProviderRuntimeMetric[];
  usage?: AiUsageSummary;
};

export type MetricsProviderFilter = 'all' | 'groq' | 'deepseek' | 'openrouter' | 'gemini';

const METRICS_PROVIDER_OPTIONS: Array<{ value: MetricsProviderFilter; label: string }> = [
  { value: 'all', label: 'جميع المزودين' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'groq', label: 'Groq' },
];

const METRICS_WINDOW_OPTIONS = [7, 30, 90] as const;

export type PendingChange = {
  path: string;
  absolutePath: string;
  newContent: string;
  originalContent: string | null;
  baseHash?: string;
  hunks?: Array<{
    startLine: number;
    endLine: number;
    expectedText: string;
    replacementText: string;
    reason: string;
    risk?: 'low' | 'medium' | 'high';
    evidence?: Array<{
      kind: 'finding' | 'source' | 'validation';
      id: string;
      label: string;
      file?: string;
      line?: number;
    }>;
  }>;
  reason: string;
  validationProfile?: 'ai-orchestrator-tests' | 'knowledge-engine-tests' | 'api-ai-tests' | 'api-repair-validation-tests' | 'workspace-typecheck';
  risk?: 'low' | 'medium' | 'high';
  evidence?: Array<{
    kind: 'finding' | 'source' | 'validation';
    id: string;
    label: string;
    file?: string;
    line?: number;
  }>;
};

export type ApprovedPendingChange = PendingChange & {
  validationProfile: NonNullable<PendingChange['validationProfile']>;
};

export function hasValidationProfile(change: PendingChange): change is ApprovedPendingChange {
  return Boolean(change.validationProfile);
}

export function validationProfileLabel(profile: PendingChange['validationProfile']): string {
  switch (profile) {
    case 'workspace-typecheck':
      return 'Workspace typecheck (failed changes are rolled back)';
    case 'ai-orchestrator-tests':
      return 'AI orchestrator tests (failed changes are rolled back)';
    case 'knowledge-engine-tests':
      return 'Knowledge engine tests (failed changes are rolled back)';
    case 'api-ai-tests':
      return 'AI API tests (failed changes are rolled back)';
    case 'api-repair-validation-tests':
      return 'AI repair validation tests (failed changes are rolled back)';
    default:
      return 'No registered validation';
  }
}

export type BehavioralVerification = {
  status: 'passed' | 'failed' | 'skipped' | 'unavailable' | 'blocked';
  profile?: string;
  scenario?: string;
  detail?: string;
  conflict?: {
    kind?: 'base_hash_mismatch' | 'hunk_mismatch';
    expectedHash?: string;
    actualHash?: string;
    hunkIndex?: number;
  };
};

// PR-06: AiApiError replaced by the shared ApiError from lib/api-fetch.
// Alias retained only to avoid renaming the one remaining internal reference.
export const AiApiError = ApiError;

const BLOCKING_PROVIDER_STATES = new Set([
  'authentication_failed',
  'incompatible_model',
  'no_compatible_free_model',
  'quota_exhausted',
  'rate_limited',
  'circuit_open',
  'provider_outage',
]);

export function isProviderSendBlocked(metric: ProviderRuntimeMetric | undefined): boolean {
  return Boolean(metric?.circuitOpen || (metric?.availabilityState && BLOCKING_PROVIDER_STATES.has(metric.availabilityState)));
}

/**
 * PR-06: Compact runtime status badge for a provider card.
 * Shows circuit state, consecutive failures, last success, and avg latency.
 */
export function ProviderRuntimeBadge({ metric }: { metric: ProviderRuntimeMetric | undefined }) {
  if (!metric) return null;

  const cooldownSec = metric.cooldownRemainingMs != null
    ? Math.ceil(metric.cooldownRemainingMs / 1000)
    : null;

  const lastSuccessLabel = metric.lastSuccessAt
    ? (() => {
        const secs = Math.floor((Date.now() - new Date(metric.lastSuccessAt).getTime()) / 1000);
        if (secs < 60)   return `منذ ${secs} ثانية`;
        if (secs < 3600) return `منذ ${Math.floor(secs / 60)} دقيقة`;
        return `منذ ${Math.floor(secs / 3600)} ساعة`;
      })()
    : null;

  const stateLabels: Record<string, string> = {
    missing_credentials: 'بيانات الوصول غير معدّة',
    authentication_failed: 'رُفضت بيانات الوصول',
    incompatible_model: 'النموذج غير متوافق',
    no_compatible_free_model: 'لا يوجد نموذج متوافق بحسب الفحص',
    catalog_stale: 'قائمة النماذج تحتاج إلى تحديث',
    quota_exhausted: 'نفدت حصة الاستخدام',
    rate_limited: 'بلغ المزود حد الاستخدام',
    circuit_open: 'أُوقفت المحاولات مؤقتًا بعد إخفاقات',
    provider_outage: 'المزود غير متاح',
    degraded: 'توجد مشكلات في الاستجابة',
    healthy: 'المزود متاح بحسب الحالة المسجلة',
    unknown: 'لم تُفحص الحالة بعد',
  };
  const lifecycleState = metric.lifecycle?.overallStatus === 'unconfigured'
    ? 'missing_credentials'
    : metric.lifecycle?.overallStatus === 'unavailable'
      ? (metric.lifecycle.reasonCodes[0] ?? 'provider_outage')
      : metric.lifecycle?.overallStatus === 'degraded'
        ? 'degraded'
        : metric.lifecycle?.overallStatus === 'ready'
          ? (metric.availabilityState === 'unknown' ? 'healthy' : metric.availabilityState)
          : undefined;
  const state = lifecycleState ?? metric.availabilityState ?? (
    metric.circuitOpen ? 'circuit_open' :
      metric.requests === 0 ? 'unknown' :
        metric.consecutiveFailures > 0 ? 'degraded' : 'healthy'
  );
  const isActionable = !['healthy', 'unknown'].includes(state);

  if (state === 'circuit_open' || metric.circuitOpen) {
    return (
      <div dir="rtl" lang="ar" className="mt-1.5 space-y-0.5 text-[10px] text-red-400">
        <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
          <span className="min-w-0 break-words">{stateLabels[state] ?? 'حالة المزود غير معروفة'}{cooldownSec != null ? ` · انتظار ${cooldownSec} ثانية` : ''}</span>
        </div>
        {metric.operatorAction && <div dir="auto" className="break-words ps-3 text-red-300/80">{metric.operatorAction}</div>}
      {cooldownSec != null && (
        <p className="break-words ps-3 text-muted-foreground">
          عدّاد التبريد محلي؛ لا يقدّر موعد استعادة حصة OpenRouter المشتركة.
        </p>
      )}
      </div>
    );
  }

  const isHealthy = state === 'healthy' || (
    metric.consecutiveFailures === 0 && metric.successRate != null && metric.successRate > 0.8
  );
  const isDegraded = metric.consecutiveFailures > 0 || (metric.successRate != null && metric.successRate < 0.8);

  return (
    <div dir="rtl" lang="ar" className={`mt-1.5 space-y-0.5 text-[10px] ${isActionable ? 'text-amber-300' : 'text-muted-foreground'}`}>
      <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isHealthy ? 'bg-green-400' : isDegraded ? 'bg-yellow-400' : 'bg-muted-foreground'}`} />
      <span className="min-w-0 flex-1 break-words">
        {isActionable
          ? stateLabels[state] ?? <>حالة المزود غير معروفة: <bdi dir="ltr">{state}</bdi></>
          : state === 'unknown'
          ? stateLabels.unknown
          : metric.consecutiveFailures > 0
          ? `إخفاقات متتالية: ${metric.consecutiveFailures}`
          : lastSuccessLabel
            ? `آخر استجابة ناجحة · ${lastSuccessLabel}`
            : stateLabels.healthy}
        {metric.avgLatencyMs != null ? ` · متوسط زمن الاستجابة: ${metric.avgLatencyMs} مللي ثانية` : ''}
      </span>
      </div>
      {metric.operatorAction && <div dir="auto" className="break-words ps-3 text-amber-200/80">{metric.operatorAction}</div>}
      {isActionable && metric.correlationId && <div className="break-words ps-3 text-muted-foreground">مرجع المتابعة: <bdi dir="ltr">{metric.correlationId}</bdi></div>}
      <p className="break-words">هذه مؤشرات استجابة المزود، وليست إثباتًا لاكتمال طلبك.</p>
    </div>
  );
}

function contractRate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : '—';
}

function ObservedProviderFailures({
  providers,
  attemptsTruncated,
}: {
  providers: AiUsageSummary['providers'];
  attemptsTruncated: boolean;
}) {
  type FailureCounts = AiUsageSummary['providers'][number]['providerFailures'];
  type ScopeCounts = AiUsageSummary['providers'][number]['rateLimitScopes'];

  const failureLabels: Array<{ key: keyof FailureCounts; label: string }> = [
    { key: 'rateLimited', label: 'حد الاستخدام 429' },
    { key: 'quotaExhausted', label: 'حصة مستنفدة' },
    { key: 'emptyResponse', label: 'استجابة فارغة' },
    { key: 'timeout', label: 'انتهاء المهلة' },
    { key: 'modelUnavailable', label: 'نموذج غير متاح' },
    { key: 'modelRejected', label: 'طلب مرفوض' },
    { key: 'fallbackExhausted', label: 'استنفاد البدائل' },
    { key: 'transportFailure', label: 'فشل اتصال' },
    { key: 'malformedResponse', label: 'استجابة غير صالحة' },
    { key: 'unknown', label: 'سبب غير معروف' },
  ];
  const scopeLabels: Array<{ key: keyof ScopeCounts; label: string }> = [
    { key: 'upstream_shared_pool', label: 'حوض مشترك' },
    { key: 'provider_credential', label: 'بيانات اعتماد المزود' },
    { key: 'account_quota', label: 'حصة الحساب' },
    { key: 'unknown', label: 'نطاق مجهول' },
    { key: 'unclassified', label: 'نطاق غير مسجل' },
  ];
  const failures: FailureCounts = {
    rateLimited: 0,
    quotaExhausted: 0,
    emptyResponse: 0,
    timeout: 0,
    modelUnavailable: 0,
    modelRejected: 0,
    fallbackExhausted: 0,
    transportFailure: 0,
    malformedResponse: 0,
    unknown: 0,
  };
  const scopes: ScopeCounts = {
    upstream_shared_pool: 0,
    provider_credential: 0,
    account_quota: 0,
    unknown: 0,
    unclassified: 0,
  };
  for (const provider of providers) {
    for (const { key } of failureLabels) {
      failures[key] += provider.providerFailures?.[key] ?? 0;
    }
    for (const { key } of scopeLabels) {
      scopes[key] += provider.rateLimitScopes?.[key] ?? 0;
    }
  }
  const totalFailures = failureLabels.reduce((sum, { key }) => sum + failures[key], 0);
  const rateLimited = failures.rateLimited;

  return (
    <section
      className="mt-3 rounded border border-border/60 bg-background/20 p-2.5"
      aria-label="تشخيص إخفاقات مزود الذكاء الاصطناعي"
      data-testid="provider-failure-summary"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-foreground">أسباب الإخفاقات المرصودة</h3>
        <span className="text-[10px] text-muted-foreground">حسب الفترة والمزود المحددين</span>
      </div>
      {totalFailures === 0 ? (
        <p className="mt-2 rounded border border-dashed border-border/70 px-2 py-2 text-center text-[10px] leading-4 text-muted-foreground">
          لا توجد إخفاقات مزود مسجلة ضمن هذه المرشحات؛ لا يثبت ذلك توفر الحصة المجانية المشتركة.
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {failureLabels.filter(({ key }) => failures[key] > 0).map(({ key, label }) => (
            <div key={key} className="rounded border border-border/40 bg-secondary/30 px-2 py-1.5 text-[10px] text-muted-foreground">
              {label} <strong className="font-medium text-foreground">{failures[key]}</strong>
            </div>
          ))}
        </div>
      )}
      {rateLimited > 0 && (
        <div className="mt-2 rounded border border-amber-400/20 bg-amber-500/5 px-2 py-1.5">
          <p className="text-[10px] font-medium text-foreground">نطاقات 429 المسجلة</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {scopeLabels.filter(({ key }) => scopes[key] > 0).map(({ key, label }) => (
              <span key={key}>{label} <strong className="font-medium text-foreground">{scopes[key]}</strong></span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        {attemptsTruncated
          ? 'هذه أعداد آخر 5000 سجل فقط ضمن الفترة، وليست إجمالي المحاولات.'
          : 'هذه أعداد من سجلات المحاولات ضمن الفترة، وليست قراءة للحصة المتبقية.'}{' '}
        الاستجابات الفارغة في عينات عقد المهمة تظهر منفصلة أدناه.
      </p>
    </section>
  );
}

function ModelQualityTrend({
  timeline,
}: {
  timeline: AiUsageSummary['timeline'];
}) {
  return (
    <div className="mt-3 rounded border border-border/60 bg-background/20 p-2.5" aria-label="اتجاه جودة الإجابات">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-foreground">الجودة حسب اليوم</h3>
        <span className="text-[10px] text-muted-foreground">الأيام المسجلة فقط</span>
      </div>
      {timeline.length === 0 ? (
        <p className="mt-2 rounded border border-dashed border-border/70 px-2 py-2 text-center text-[10px] text-muted-foreground">
          لا توجد نتائج قبول أو استشهاد مرتبطة بطلبات المزود ضمن المرشحات المحددة.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {timeline.slice(-14).map((point) => {
            const failureKinds = Object.entries(point.failureKinds)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 2);
            const dayLabel = new Date(`${point.day}T00:00:00Z`).toLocaleDateString('ar', {
              month: 'short',
              day: 'numeric',
            });
            return (
              <div key={point.day} className="rounded border border-border/40 bg-secondary/30 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-medium text-foreground">{dayLabel}</span>
                  <span className="text-muted-foreground">المحاولات: {point.attempts}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                  <span>
                    القبول <strong dir="ltr" className="font-medium text-emerald-200">{contractRate(point.acceptanceRate)}</strong>
                  </span>
                  <span>
                    مطابقة الاستشهادات <strong dir="ltr" className="font-medium text-sky-200">{contractRate(point.citationMatchRate)}</strong>
                  </span>
                  <span>
                    الاسترداد <strong dir="ltr" className="font-medium text-amber-200">
                      {point.recoveryAttempts > 0
                        ? `${point.recoveryAccepted}/${point.recoveryAttempts}`
                        : 'لا توجد محاولات'}
                    </strong>
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground" title={failureKinds.map(([kind, count]) => `${kind} (${count})`).join(', ')}>
                  {failureKinds.length > 0
                    ? <>الإخفاقات: {failureKinds.map(([kind, count], index) => (
                      <span key={kind}>{index > 0 ? '، ' : ''}<bdi dir="ltr">{kind} ({count})</bdi></span>
                    ))}</>
                    : 'لم تُسجل إخفاقات'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ModelContractQualityCard({
  usage,
  projectLabel,
  provider,
  days,
  isLoading,
  isFetching,
  isError,
  onProviderChange,
  onDaysChange,
  onRetry,
  onExport,
  isExporting,
}: {
  usage?: AiUsageSummary;
  projectLabel: string;
  provider: MetricsProviderFilter;
  days: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  onProviderChange: (provider: MetricsProviderFilter) => void;
  onDaysChange: (days: number) => void;
  onRetry: () => void;
  onExport: () => void;
  isExporting: boolean;
}) {
  const models = usage?.providers.flatMap((provider) =>
    provider.models.map((model) => ({ provider: provider.provider, ...model })),
  ) ?? [];
  const sortedModels = [...models].sort((a, b) => b.attempts - a.attempts || a.model.localeCompare(b.model));
  const taskQuality = usage?.modelTaskQuality ?? [];

  return (
    <section dir="rtl" lang="ar" className="mx-2 mb-2 min-w-0 rounded-lg border border-border bg-secondary/50 p-3 text-xs" aria-label="جودة إجابات المساعد">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="font-medium text-foreground">جودة إجابات المساعد</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            نسب قبول الإجابات ومطابقة استشهاداتها بحسب السجل المحفوظ للفترة المحددة. استجابة المزود وحدها لا تعني قبول الإجابة، وهذه النسب ليست إثباتًا لاكتمال طلب بعينه.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            الاسترداد يبيّن المقبول من محاولات الاسترداد المسجلة. الشرطة (—) تعني أن النسبة غير متاحة، لا أنها صفر.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs text-muted-foreground">
          <span className="mb-1 block">المزود</span>
          <select
            aria-label="مزود تقرير الجودة"
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as MetricsProviderFilter)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {METRICS_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          <span className="mb-1 block">الفترة</span>
          <select
            aria-label="فترة تقرير الجودة"
            value={days}
            onChange={(event) => onDaysChange(Number(event.target.value))}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {METRICS_WINDOW_OPTIONS.map((windowDays) => (
              <option key={windowDays} value={windowDays}>{windowDays} يومًا</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={onExport}
          disabled={isExporting || isLoading || isError}
        >
          {isExporting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Download className="mr-1.5 h-3 w-3" />}
          {isExporting ? 'جارٍ تصدير التقرير…' : 'تصدير تقرير الجودة'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        المشروع: <bdi dir="auto" className="text-foreground/80">{projectLabel}</bdi>
        {isFetching && !isLoading && <span className="ms-1.5 text-primary">جارٍ تحديث البيانات…</span>}
      </p>

      {isLoading ? (
        <p className="mt-3 rounded border border-dashed border-border/70 px-2 py-2 text-center text-xs leading-5 text-muted-foreground" role="status">
          جارٍ تحميل بيانات جودة الإجابات…
        </p>
      ) : isError ? (
        <div className="mt-3 rounded border border-dashed border-border/70 px-2 py-2 text-center text-xs leading-5 text-muted-foreground">
          <p>تعذر تحميل بيانات الجودة للمرشحات المحددة.</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 px-2 text-xs" onClick={onRetry}>
            إعادة تحميل تقرير الجودة
          </Button>
        </div>
      ) : (
        <>
          <ObservedProviderFailures
            providers={usage?.providers ?? []}
            attemptsTruncated={usage?.attemptsTruncated ?? false}
          />
          <ModelQualityTrend timeline={usage?.timeline ?? []} />
          <div
            className="mt-3 rounded border border-border/60 bg-background/20 p-2.5"
            aria-label="نتائج عينات عقد المهمة"
            data-testid="model-task-quality-summary"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium text-foreground">عينات عقد المهمة</h3>
              <span className="text-[10px] text-muted-foreground">مقياس منفصل عن استدعاءات المزود</span>
            </div>
            {taskQuality.length === 0 ? (
              <p
                className="mt-2 rounded border border-dashed border-border/70 px-2 py-2 text-center text-[10px] text-muted-foreground"
                data-testid="model-task-quality-empty"
              >
                لا توجد عينات تقييم محفوظة ضمن الفترة والمرشحات المحددة.
              </p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {taskQuality.map((sample) => (
                  <div
                    key={`${sample.provider}:${sample.model}:${sample.contract}`}
                    className="rounded border border-border/40 bg-secondary/30 px-2 py-1.5"
                    data-testid={`model-task-quality-${sample.model}`}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2 text-[10px]">
                      <bdi dir="ltr" className="min-w-0 truncate font-mono text-foreground" title={sample.model}>
                        {sample.model}
                      </bdi>
                      <span className="shrink-0 text-muted-foreground">
                        {sample.contract === 'project_query_no_tools_synthesis' ? 'صياغة إجابة المشروع' : sample.contract}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-muted-foreground sm:grid-cols-4">
                      <span>العينات <strong className="font-medium text-foreground">{sample.samples}</strong></span>
                      <span>مقبول <strong className="font-medium text-emerald-200">{sample.accepted}</strong></span>
                      <span>مرفوض <strong className="font-medium text-amber-200">{sample.rejected}</strong></span>
                      <span>فارغ <strong className="font-medium text-red-200">{sample.emptyResponses}</strong></span>
                      <span className="col-span-2 sm:col-span-4">
                        معدل القبول <strong dir="ltr" className="font-medium text-emerald-200">{contractRate(sample.acceptanceRate)}</strong>
                      </span>
                      <span className="col-span-2 sm:col-span-4">
                        تغطية رموز العقد{' '}
                        <strong dir="ltr" className="font-medium text-foreground">
                          {sample.usageKnownSamples}/{sample.samples} · {contractRate(sample.tokenUsageCoverage)}
                        </strong>
                      </span>
                      <span>
                        إجمالي الرموز{' '}
                        <strong dir="ltr" className="font-medium text-foreground">
                          {sample.promptTokens === null || sample.completionTokens === null
                            ? 'غير متاح'
                            : sample.promptTokens + sample.completionTokens}
                        </strong>
                      </span>
                      <span>
                        الرموز لكل قبول{' '}
                        <strong dir="ltr" className="font-medium text-foreground">
                          {sample.tokensPerAcceptedSample === null
                            ? 'غير متاح'
                            : sample.tokensPerAcceptedSample.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
              هذه النتائج تخص عينات صياغة الإجابة فقط؛ لا تمثل تكلفة المهمة كاملة ولا تُضاف إلى عدد طلبات OpenRouter ولا تثبت اكتمال المهمة. لا نحسب الرموز لكل قبول عند نقص بيانات الاستخدام.
            </p>
          </div>
          {sortedModels.length === 0 ? (
            <p className="mt-3 rounded border border-dashed border-border/70 px-2 py-2 text-center text-xs leading-5 text-muted-foreground">
              لا توجد سجلات جودة مرتبطة باستدعاءات المزود؛ عينات عقود المهام تظهر منفصلة أعلاه.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {sortedModels.map((model) => {
                const failureKinds = Object.entries(model.contract.failureKinds)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3);
                return (
                  <div key={`${model.provider}:${model.model}`} className="rounded border border-border/60 bg-background/25 px-2.5 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs" title={model.model}>{model.model}</bdi>
                      <span className="shrink-0 text-xs text-muted-foreground">المحاولات: {model.attempts}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>القبول <strong dir="ltr" className="font-medium text-emerald-200">{contractRate(model.contract.acceptanceRate)}</strong></span>
                      <span>مطابقة الاستشهادات <strong dir="ltr" className="font-medium text-sky-200">{contractRate(model.contract.citationMatchRate)}</strong></span>
                      <span>
                        الاسترداد{' '}
                        <strong dir="ltr" className="font-medium text-amber-200">
                          {model.contract.recoveryAttempts > 0
                            ? `${model.contract.recoveryAccepted}/${model.contract.recoveryAttempts} · ${contractRate(model.contract.recoveryAcceptanceRate)}`
                            : 'لا توجد محاولات'}
                        </strong>
                      </span>
                      <span>الإجابات المقيّمة <strong className="font-medium text-foreground">{model.contract.evaluated}</strong></span>
                    </div>
                    <div className="mt-1.5 border-t border-border/40 pt-1.5 text-xs text-muted-foreground">
                      {failureKinds.length > 0 ? (
                        <span>
                          أنواع الإخفاق:{' '}
                          {failureKinds.map(([kind, count], index) => (
                            <span key={kind}>
                              {index > 0 ? '، ' : ''}<bdi dir="ltr">{kind} ({count})</bdi>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span>لم تُسجل إخفاقات في شروط قبول الإجابة</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ProviderLifecycleNotice({ lifecycle }: { lifecycle?: ProviderLifecycleSnapshot }) {
  if (!lifecycle || lifecycle.overallStatus === 'unconfigured' || lifecycle.overallStatus === 'ready') return null;

  const isCredentialFailure = lifecycle.credentialStatus === 'credentials_invalid';
  return (
    <div className="mt-1.5 space-y-1 text-xs leading-5 text-amber-300">
      <div className="flex min-w-0 items-start gap-1.5">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span className="min-w-0 break-words">
          {isCredentialFailure
            ? 'رُفضت بيانات الوصول إلى المزود.'
            : lifecycle.overallStatus === 'unavailable'
              ? 'المزود غير متاح بهذه الإعدادات.'
              : 'لم يكتمل التحقق من جاهزية المزود.'}
        </span>
      </div>
      <div className="ps-4 break-words text-amber-200/80">
        {lifecycle.reasonCodes.length
          ? <>رمز السبب المسجل: <bdi dir="ltr">{lifecycle.reasonCodes[0]}</bdi>.</>
          : 'أعد فحص جاهزية المزود قبل الاعتماد عليه.'}
      </div>
    </div>
  );
}

export function GroqModelAvailabilityNotice({
  availability,
}: {
  availability?: GroqModelAvailability;
}) {
  if (!availability) return null;

  if (availability.status === 'available') {
    return (
      <p className="mt-1.5 break-words text-xs leading-5 text-green-300">
        نماذج Groq متاحة بحسب الفحص · السريع: <bdi dir="ltr">{availability.checkedModels.fast}</bdi> · المتقدم: <bdi dir="ltr">{availability.checkedModels.powerful}</bdi>
      </p>
    );
  }

  if (availability.status === 'unavailable' && availability.unavailableRoles.length > 0) {
    return (
      <div className="mt-1.5 space-y-0.5 text-[10px] text-amber-300">
        {availability.unavailableRoles.map((role) => (
          <p key={role} className="break-words">
            اجتازت بيانات وصول Groq الفحص، لكن النموذج {role === 'fast' ? 'السريع' : 'المتقدم'} المحدد (<bdi dir="ltr">{availability.checkedModels[role]}</bdi>) غير متاح.
          </p>
        ))}
        <p className="break-words text-amber-200/80">
          يلزم تحديث معرّف نموذج Groq المتأثر إلى نموذج متاح في القائمة الحالية، ثم إعادة تشغيل خادم API.
        </p>
      </div>
    );
  }

  return null;
}

export function ProviderReadinessNotice({
  activeProvider,
  metric,
}: {
  activeProvider: ActiveProvider | undefined;
  metric: ProviderRuntimeMetric | undefined;
}) {
  if (!activeProvider) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground" role="status">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        <span dir="rtl" lang="ar">جارٍ التحقق من إعداد المساعد…</span>
      </div>
    );
  }

  if (!activeProvider.configured || !activeProvider.provider) {
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300" role="alert">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span dir="rtl" lang="ar">المساعد غير مهيّأ للإرسال. راجع إعدادات المزود في بطاقاته قبل إرسال الرسالة. لا تكتب مفتاح الوصول داخل المحادثة.</span>
      </div>
    );
  }

  if (metric && isProviderSendBlocked(metric)) {
    const cooldown = metric.cooldownRemainingMs != null
      ? ` أعد المحاولة بعد ${Math.ceil(metric.cooldownRemainingMs / 1000)} ثانية.`
      : '';
    const stateLabel =
      metric.availabilityState === 'rate_limited' || metric.availabilityState === 'quota_exhausted'
        ? 'مقيّد مؤقتًا بحد الاستخدام'
        : metric.availabilityState === 'authentication_failed'
          ? 'غير مصرح له بالوصول'
          : 'غير متاح مؤقتًا';
    return (
      <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300" role="status">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span dir="rtl" lang="ar">المزود <bdi dir="ltr">{activeProvider.provider}</bdi> {stateLabel}.{cooldown} لن نرسل الطلب تلقائيًا أو إلى مزود آخر.</span>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-[11px] text-emerald-600 dark:text-emerald-400" role="status">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
      <span dir="rtl" lang="ar">المساعد مُعدّ للإرسال · <bdi dir="ltr">{activeProvider.provider}</bdi></span>
    </div>
  );
}

/**
 * Maps an AiApiError (or any error) to a concise, user-facing string.
 * Status codes align with what ai.ts returns after handleOrchestratorError.
 */
/**
 * Keep implementation details useful to the agent out of the normal chat
 * transcript. Absolute runtime paths and opaque UUIDs can disclose deployment
 * internals without helping the user understand the result.
 */
export function redactInternalDetails(value: string): string {
  return value
    .replace(/\/home\/runner\/workspace(?:\/[^\s`"'<>),;]+)*/g, '[project path]')
    .replace(/(?:\/tmp|\/workspace)\/[^\s`"'<>),;]+/g, '[runtime path]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[internal id]');
}

function availabilitySuffix(err: unknown): string {
  const value = err as { data?: unknown; availabilityState?: unknown; operatorAction?: unknown; correlationId?: unknown };
  const data = value.data && typeof value.data === 'object' ? value.data as Record<string, unknown> : {};
  const state = data.availabilityState ?? value.availabilityState;
  const action = data.operatorAction ?? value.operatorAction;
  const correlationId = data.correlationId ?? value.correlationId;
  const parts = [
    typeof state === 'string' ? `Status: ${state.replace(/_/g, ' ')}` : '',
    typeof action === 'string' ? `Next step: ${action}` : '',
    typeof correlationId === 'string' ? `Reference: ${correlationId}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

export function describeAiError(err: unknown): string {
  if (err instanceof AiApiError) {
    const suffix = availabilitySuffix(err);
    if (err.code === 'LIVE_WORKSPACE_WRITE_UNCOORDINATED') {
      return 'أُوقف تسليم المرشح مؤقتًا حتى يتوفر مسار كتابة ومراجعة آمن. بقي المرشح دون تغيير، ولم تُعدّل ملفات المشروع أو تُنشأ مهمة Apply.';
    }
    switch (err.status) {
      case 400: return err.errorMessage + suffix;
      case 401: return (err.errorMessage || err.hint || 'AI API key is invalid — delete it and save a valid key from your provider\'s dashboard.') + suffix;
      case 403: return 'Access denied — you may not have permission on this project.';
      case 429: return (err.errorMessage || err.hint || 'بلغ OpenRouter حد الاستخدام. انتظر Retry-After أو التبريد المحلي قبل استئناف الطلب؛ لن ينتقل التطبيق إلى مزود آخر أو مسار مدفوع.') + suffix;
      case 422:
        if (err.code === 'model_output_invalid') {
          return 'The AI returned an unexpected response format — try rephrasing your message.';
        }
        if (err.code === 'MODEL_NOT_FOUND') {
          return (err.errorMessage || err.hint || 'نموذج OpenRouter غير متاح؛ اختر نموذجًا مجانيًا مؤهلًا آخر أو أعد المحاولة بعد تحديث الكتالوج.') + suffix;
        }
        return (err.errorMessage || err.hint || 'AI provider configuration is invalid. Re-save your API key.') + suffix;
      case 428: return (err.errorMessage || err.hint || 'لم يُضبط مفتاح OpenRouter. الطلبات تستخدم نماذج OpenRouter المجانية فقط.') + suffix;
      case 502: return (err.errorMessage || err.hint || 'AI provider returned an error. Check your API key or try again.') + suffix;
      case 503: return (err.errorMessage || err.hint || 'AI provider is temporarily unreachable — try again in a moment.') + suffix;
      default:  return (err.errorMessage || `Request failed (${err.status}).`) + suffix;
    }
  }
  if (err instanceof Error) return err.message + availabilitySuffix(err);
  return String(err);
}

/**
 * Chat history can contain provider-shaped diagnostics from older API
 * versions. Failed turns must render stable recovery guidance rather than
 * replaying that persisted payload. Support references are deliberately
 * allowlisted because they are safe for operators to search.
 */
export function providerFailureCategoryLabel(category: AiStreamErrorEvent['providerFailureCategory']): string | null {
  switch (category) {
    case 'TIMEOUT': return 'انتهت مهلة انتظار المزود';
    case 'MODEL_REJECTED': return 'رفض المزود الطلب';
    case 'MODEL_UNAVAILABLE': return 'النموذج غير متاح';
    case 'RATE_LIMITED': return 'بلغ المزود حد الاستخدام';
    case 'FALLBACK_EXHAUSTED': return 'تعذّر الطلب عبر نماذج OpenRouter المجانية المؤهلة';
    case 'TRANSPORT_FAILURE': return 'تعذر الاتصال بالمزود';
    case 'MALFORMED_RESPONSE': return 'صيغة رد المزود غير صالحة';
    case 'UNKNOWN': return 'تعذر إكمال الطلب لدى المزود';
    default: return null;
  }
}

export function providerFailureCategoryGuidance(
  category: AiStreamErrorEvent['providerFailureCategory'],
  rateLimitScope?: ChatMessage['rateLimitScope'],
  retryAfterMs?: number,
  retryAfterSource?: ChatMessage['retryAfterSource'],
): string | null {
  switch (category) {
    case 'TIMEOUT': return 'لم يرد OpenRouter خلال المهلة المحددة. يمكنك إعادة إرسال الطلب يدويًا.';
    case 'MODEL_REJECTED': return 'رفض النموذج المجاني هذا الطلب. راجع شروطه أو أعد صياغة الطلب؛ لن نرسله إلى مزود آخر.';
    case 'MODEL_UNAVAILABLE': return 'نموذج OpenRouter المجاني غير متاح. حدّث قائمة النماذج أو اختر نموذجًا مجانيًا مؤهلًا.';
    case 'RATE_LIMITED': {
      const delaySeconds = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.ceil(retryAfterMs / 1000)
        : undefined;
      const scope = rateLimitScope === 'upstream_shared_pool'
        ? ' الحد يخص الحصة المشتركة لدى المزود.'
        : rateLimitScope === 'provider_credential'
          ? ' الحد يخص بيانات الوصول المستخدمة لدى المزود.'
          : rateLimitScope === 'account_quota'
            ? ' الحد يخص حصة حساب المزود.'
            : rateLimitScope === 'project'
              ? ' الحد يخص هذا المشروع.'
              : '';
      if (!delaySeconds) {
        return `توقف الإرسال بسبب حد الاستخدام.${scope} لم يسجل النظام وقتًا آمنًا للمحاولة التالية؛ لا توجد إعادة تلقائية ولا تحويل إلى مزود آخر.`;
      }
      const provenance = retryAfterSource === 'provider'
        ? 'حدد OpenRouter هذه المهلة.'
        : retryAfterSource === 'adaptive_default'
          ? 'هذه مهلة تبريد تكيفية محلية، وليست موعدًا حدده OpenRouter.'
          : retryAfterSource === 'server_default'
            ? 'هذه مهلة احتياطية محلية، وليست موعدًا حدده OpenRouter.'
            : retryAfterSource === 'local_admission'
              ? 'منع حاجز الإرسال المحلي الطلب؛ هذه ليست مهلة من OpenRouter.'
              : retryAfterSource === 'project_rate_limit'
                ? 'هذه مهلة محلية للمشروع.'
                : 'مصدر المهلة غير محفوظ، لذلك لا ننسبها إلى OpenRouter.';
      return `توقف الإرسال بسبب حد الاستخدام.${scope} ${provenance} انتظر ${delaySeconds} ثانية على الأقل قبل إعادة المحاولة يدويًا.`;
    }
    case 'FALLBACK_EXHAUSTED': return 'تعذّر الطلب عبر نماذج OpenRouter المجانية المؤهلة. أعد المحاولة لاحقًا؛ لا يوجد تحويل إلى مزود آخر.';
    case 'TRANSPORT_FAILURE': return 'تعذر الاتصال بـOpenRouter. أعد المحاولة بعد عودة الاتصال؛ لن نستخدم مزودًا آخر.';
    case 'MALFORMED_RESPONSE': return 'أعاد النموذج ردًا بصيغة غير صالحة. أعد صياغة الطلب أو جرّب نموذج OpenRouter مجانيًا مؤهلًا.';
    case 'UNKNOWN': return 'تعذر إكمال الطلب عبر OpenRouter. أعد المحاولة يدويًا لاحقًا؛ لن نرسله إلى مزود آخر.';
    default: return null;
  }
}

export function projectQueryRateLimitRetryAt(message: ChatMessage): number | null {
  const candidate = message.acceptanceDisposition?.retryAt ?? message.retryAt;
  if (typeof candidate !== 'string') return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProjectQueryRetryButton(props: {
  rateLimited: boolean;
  retryAt: number | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.rateLimited || props.retryAt === null || props.retryAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= props.retryAt!) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [props.rateLimited, props.retryAt]);

  const remainingSeconds = props.retryAt === null
    ? null
    : Math.max(0, Math.ceil((props.retryAt - now) / 1_000));
  const retryBlocked = props.rateLimited
    && (remainingSeconds === null || remainingSeconds > 0);

  return (
    <>
      {props.rateLimited && retryBlocked && (
        <p role="status" className="mt-2 text-xs text-amber-100/80">
          {remainingSeconds === null
            ? 'No safe retry time was recorded. Check the execution status before retrying.'
            : `Waiting for the recorded retry interval: about ${remainingSeconds}s remaining.`}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 h-8 justify-center text-xs"
        onClick={props.onRetry}
        disabled={props.pending || retryBlocked}
        aria-label={retryBlocked && remainingSeconds !== null
          ? `Retry project analysis in ${remainingSeconds} seconds`
          : 'Retry project analysis'}
      >
        {props.pending
          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
        {props.pending
          ? 'Retrying…'
          : retryBlocked && remainingSeconds !== null
            ? `Retry in ${remainingSeconds}s`
            : retryBlocked
              ? 'Retry unavailable'
              : 'Retry project analysis'}
      </Button>
    </>
  );
}

export function safeChatRecoveryMessage(message: Pick<ChatMessage, 'acceptanceDisposition' | 'failureKind' | 'providerFailureCategory' | 'rateLimitScope' | 'retryAfterMs' | 'retryAfterSource' | 'errorCode' | 'errorMessage' | 'content'>): string {
  const categoryGuidance = providerFailureCategoryGuidance(
    message.providerFailureCategory,
    message.rateLimitScope ?? message.acceptanceDisposition?.rateLimitScope,
    message.retryAfterMs ?? message.acceptanceDisposition?.retryAfterMs,
    message.retryAfterSource ?? message.acceptanceDisposition?.retryAfterSource,
  );
  if (categoryGuidance) return categoryGuidance;
  const raw = [
    message.failureKind,
    message.errorCode,
    message.errorMessage,
    message.content,
  ].filter(Boolean).join(' ').toLowerCase();
  const supportReference = [message.errorMessage, message.content]
    .map((value) => value?.match(/\bsupport reference:\s*([a-z0-9][a-z0-9_-]{2,80})\b/i)?.[1])
    .find(Boolean);

  let guidance = 'تعذر إكمال الطلب عبر OpenRouter. أعد المحاولة يدويًا بعد قليل؛ لن نستخدم مزودًا آخر.';
  if (message.failureKind === 'CONFIGURATION' || /authentication|unauthori[sz]|invalid.*key|credential/.test(raw)) {
    guidance = 'تعذر التحقق من مفتاح OpenRouter. راجع إعداداته ثم أعد المحاولة.';
  } else if (message.failureKind === 'RATE_LIMIT' || /rate.?limit|quota|429/.test(raw)) {
    guidance = 'بلغ OpenRouter حد الاستخدام أو انتهت الحصة المتاحة. انتظر قبل إعادة المحاولة يدويًا؛ لن يحوّل النظام الطلب إلى مزود آخر.';
  } else if (message.failureKind === 'TRANSPORT' || /outage|timeout|temporarily unavailable|disconnected|502|503/.test(raw)) {
    guidance = 'OpenRouter غير متاح مؤقتًا. أعد المحاولة بعد عودة الاتصال؛ لن يحوّل النظام الطلب إلى مزود آخر.';
  }

  return supportReference
    ? `${guidance} مرجع الدعم: ${supportReference}`
    : guidance;
}

export function safePartialProviderResponse(
  message: Pick<ChatMessage, 'outcome' | 'errorCode' | 'errorMessage' | 'content'>,
  displayContent: string,
  internalTechnicalDump: boolean,
): string | null {
  const content = displayContent.trim();
  const retainedResponseCode =
    message.errorCode === 'EXECUTION_PROVIDER_FAILURE' ||
    (message.outcome === 'INTERRUPTED' && message.errorCode === 'EXECUTION_CANCELLED');
  if (
    !retainedResponseCode ||
    !content ||
    internalTechnicalDump ||
    content === message.errorMessage?.trim()
  ) {
    return null;
  }
  return redactInternalDetails(content);
}
