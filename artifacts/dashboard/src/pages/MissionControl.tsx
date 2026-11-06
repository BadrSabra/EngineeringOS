import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileUp,
  Gauge,
  GitBranch,
  History,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Search,
  TerminalSquare,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  useGetAiMissionControl,
  useGetAiExecution,
} from '@workspace/api-client-react';
import type { AiMissionControl, AiUsageSummary } from '@workspace/api-client-react';
import { MissionCapsule } from '@/components/MissionCapsule';
import { executionChatHref } from '@/lib/execution-chat-link';
import { fetchMissionProjection, type MissionProjection } from '@/lib/ai-missions';
import { MissionAgentProjectionSummary } from '@/components/MissionAgentProjectionSummary';
import { resolveExecutionProofPresentation } from '@/lib/execution-proof-presentation';
import WorldTransitionTimeline from '@/components/WorldTransitionTimeline';

type JsonRecord = Record<string, unknown>;

type MissionExecution = {
  id: string;
  linkedTaskId?: string | null;
  state?: unknown;
  objective?: unknown;
  provider?: unknown;
  model?: unknown;
  attempts?: unknown;
  validationFailures?: unknown;
  evidence?: unknown;
  timestamps?: unknown;
  checkpointVersion?: unknown;
  eventCount?: unknown;
  recentEvents?: unknown;
  recovery?: unknown;
  recoverySummary?: unknown;
  failureCategory?: unknown;
  recoveryAction?: unknown;
  evidenceStatus?: unknown;
  operationId?: unknown;
  revision?: unknown;
  evidenceProjection?: {
    completeness?: unknown;
    proof?: {
      verdict?: string;
      accepted?: boolean;
    };
  } | null;
  phase?: unknown;
  proofRequired?: unknown;
  acceptance?: unknown;
};

type MetricEntry = {
  key: string;
  label: string;
  value: string;
  numericValue?: number;
};

type HistorySnapshot = {
  executions: MissionExecution[];
  benchmark: JsonRecord;
};

const COMPLETE_STATES = new Set(['READY_FOR_REVIEW', 'COMPLETED', 'COMMITTED', 'PUSHED', 'APPLIED']);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asExecutions(value: unknown): MissionExecution[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MissionExecution => {
    const record = asRecord(item);
    return Boolean(record && typeof record.id === 'string');
  });
}

function validateHistorySnapshot(value: unknown): { snapshot?: HistorySnapshot; error?: string } {
  const root = asRecord(value);
  if (!root) return { error: 'يجب أن يحتوي الملف على كائن JSON.' };
  if (!Array.isArray(root.executions) || root.executions.length === 0) {
    return { error: 'يجب أن يحتوي JSON على مصفوفة تنفيذات غير فارغة.' };
  }
  const invalidExecutionIndex = root.executions.findIndex((execution) => {
    const record = asRecord(execution);
    return !record || typeof record.id !== 'string' || !record.id.trim();
  });
  if (invalidExecutionIndex >= 0) {
    return { error: `يجب أن يكون التنفيذ رقم ${invalidExecutionIndex + 1} كائنًا بمعرّف نصي غير فارغ.` };
  }
  const benchmark = asRecord(root.benchmark);
  if (!benchmark) return { error: 'يجب أن يحتوي JSON على كائن للقياس.' };
  const scorecard = asRecord(benchmark.scorecard);
  const baseline = asRecord(benchmark.baseline);
  if (!scorecard || !asRecord(scorecard.metrics)) {
    return { error: 'يجب أن تكون مقاييس بطاقة الأداء كائنًا متداخلًا داخل بيانات القياس.' };
  }
  if (!baseline || !asRecord(baseline.metrics)) {
    return { error: 'يجب أن تكون مقاييس خط الأساس كائنًا متداخلًا داخل بيانات القياس.' };
  }
  return { snapshot: { executions: asExecutions(root.executions), benchmark } };
}

function textValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function formatKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value || 'Not recorded';
  if (Array.isArray(value)) return value.length ? `${value.length} recorded` : 'None recorded';
  const object = asRecord(value);
  if (object) {
    const preferred = textValue(object.summary, object.message, object.description, object.value, object.verdict);
    if (preferred) return preferred;
    try {
      return JSON.stringify(value);
    } catch {
      return 'Structured evidence';
    }
  }
  return String(value);
}

function acceptanceNextActionLabel(value: unknown): string {
  switch (textValue(value)?.toUpperCase()) {
    case 'RESUME_ALLOWED':
      return 'Resume the saved execution checkpoint.';
    case 'START_NEW_PROBE':
      return 'Start a new scoped probe.';
    case 'REVIEW_INCOMPLETE_EVIDENCE':
      return 'Review the incomplete evidence before relying on this result.';
    case 'RETRY_AFTER_PARSE':
      return 'Retry after correcting the model response format.';
    case 'RETRY_AFTER_TIMEOUT':
      return 'Retry after the timeout window has cleared.';
    case 'ABANDON_EXECUTION':
      return 'Start a new scoped run before relying on this result.';
    case 'NONE':
      return 'No operator action is required.';
    default:
      return 'No operator action is recorded.';
  }
}

type AcceptanceStatus = 'PROVEN' | 'INCOMPLETE' | 'FAILED' | 'CANCELLED' | 'NOT_RECORDED';

function acceptanceStatus(execution: MissionExecution | undefined): AcceptanceStatus {
  if (!execution) return 'NOT_RECORDED';

  const state = textValue(execution.state)?.toUpperCase();
  const acceptance = asRecord(execution.acceptance);
  const proof = asRecord(asRecord(execution.evidenceProjection)?.proof);
  const evidenceVerdict = textValue(proof?.verdict)?.toUpperCase();

  if (acceptance) {
    const terminalStatus = textValue(acceptance.terminalStatus)?.toLowerCase();
    const outcome = textValue(acceptance.outcome)?.toUpperCase();
    if (terminalStatus === 'cancelled' || (state === 'CANCELLED' && outcome === 'INTERRUPTED')) {
      return 'CANCELLED';
    }
    if (outcome === 'FAILED' || state === 'FAILED' || state === 'BLOCKED') {
      return 'FAILED';
    }
    if (proof?.accepted === true && evidenceVerdict === 'PROVEN') return 'PROVEN';
    if (acceptance.evidenceComplete === false) return 'INCOMPLETE';
    if (textValue(acceptance.nextActionCode)?.toUpperCase() !== 'NONE') return 'INCOMPLETE';
  }

  if (execution.proofRequired === true && evidenceVerdict !== 'PROVEN') {
    return 'INCOMPLETE';
  }
  return 'NOT_RECORDED';
}

function taskObjectiveAcceptance(execution: MissionExecution | undefined): JsonRecord | null {
  const acceptance = asRecord(execution?.acceptance);
  const disposition = asRecord(acceptance?.disposition);
  return asRecord(disposition?.taskObjective);
}

function taskObjectiveValidatorLabel(execution: MissionExecution | undefined): string {
  const validators = taskObjectiveAcceptance(execution)?.validatorIds;
  return Array.isArray(validators)
    ? validators.filter((value): value is string => typeof value === 'string').join(', ')
    : 'Not recorded';
}

function acceptanceStatusLabel(status: AcceptanceStatus): string {
  switch (status) {
    case 'PROVEN':
      return 'Acceptance: proven';
    case 'INCOMPLETE':
      return 'Acceptance: incomplete';
    case 'FAILED':
      return 'Acceptance: failed';
    case 'CANCELLED':
      return 'Acceptance: cancelled';
    default:
      return '';
  }
}

function acceptanceStatusClasses(status: AcceptanceStatus): string {
  switch (status) {
    case 'PROVEN':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
    case 'FAILED':
      return 'border-red-500/35 bg-red-500/10 text-red-200';
    case 'CANCELLED':
    case 'INCOMPLETE':
      return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
    default:
      return 'border-border/60 bg-background/20 text-muted-foreground';
  }
}

function formatDate(value: unknown): string | undefined {
  const raw = textValue(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWaitAge(ageMs: number): string {
  const minutes = Math.floor(Math.max(0, ageMs) / 60_000);
  if (minutes < 1) return 'أقل من دقيقة';
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

type ShadowQueueProjection = NonNullable<AiMissionControl['shadowComparisonQueue']>;

function ShadowComparisonQueueCard({ queue }: { queue: ShadowQueueProjection }) {
  const statusLabel = queue.status === 'active'
    ? 'المراقبة مفعّلة'
    : queue.status === 'disabled'
      ? 'المراقبة غير مفعّلة'
      : 'نطاق المشروع غير متاح';
  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      data-testid="shadow-comparison-queue"
      aria-label="تأخر مقارنات الظل"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="h-4 w-4 text-primary" />
            <h2>انتظار مقارنات الظل</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            قراءة تشغيلية مجمّعة فقط؛ لا تغيّر قرارات أو حالات التشغيل.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:min-w-64">
          <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">بانتظار المعالجة</p>
            <p className="mt-1 font-mono text-lg font-semibold" data-testid="shadow-queue-pending-count">
              {queue.pendingCount === null ? '—' : queue.pendingCount}
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">عمر الأقدم</p>
            <p className="mt-1 text-sm font-semibold" data-testid="shadow-queue-oldest-age">
              {queue.oldestPendingAgeMs === null
                ? '—'
                : formatWaitAge(queue.oldestPendingAgeMs)}
            </p>
          </div>
        </div>
      </div>
      {queue.delayAlertStatus === 'open' ? (
        <p
          className="mt-3 rounded-lg border border-amber-400/35 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100"
          role="alert"
          data-testid="shadow-queue-delay-alert"
        >
          تنبيه تشغيلي · الحالة: مفتوح · العدد: {queue.pendingCount ?? '—'} · عمر الأقدم: {queue.oldestPendingAgeMs === null ? '—' : formatWaitAge(queue.oldestPendingAgeMs)}
        </p>
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground" role="status" data-testid="shadow-queue-delay-alert-status">
          حالة تنبيه التأخير: {queue.delayAlertStatus === 'closed' ? 'مغلق' : 'غير نشط'}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground" role="status">
        {queue.status === 'active' && queue.pendingCount === 0
          ? 'لا توجد مقارنات مؤهلة بانتظار المعالجة.'
          : statusLabel}
      </p>
    </section>
  );
}

function ProviderRecoverySummary({ value }: { value: unknown }) {
  const summary = asRecord(value);
  if (!summary) return null;
  const category = textValue(summary.failureCategory) ?? 'غير مصنفة';
  const action = textValue(summary.recoveryAction) ?? 'لا يوجد إجراء استعادة';
  const evidence = textValue(summary.evidenceStatus) ?? 'غير مسجل';
  const attempts = numberValue(summary.attemptCount);
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-200" />
        <span className="text-sm font-semibold">استعادة مزود الذكاء الاصطناعي</span>
        <span className="ml-auto rounded-full border border-amber-500/35 px-1.5 py-0.5 text-[10px] uppercase text-amber-200">
          <bdi dir="ltr">{evidence}</bdi>
        </span>
      </div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <div><div className="text-muted-foreground">فئة الإخفاق</div><div className="mt-0.5 font-medium"><bdi dir="auto">{category}</bdi></div></div>
        <div><div className="text-muted-foreground">إجراء الاستعادة</div><div className="mt-0.5 font-medium"><bdi dir="auto">{action}</bdi></div></div>
        <div><div className="text-muted-foreground">المحاولات</div><div className="mt-0.5 font-medium">{attempts ?? 'غير مسجل'}</div></div>
      </div>
    </div>
  );
}

function ProviderAvailabilityCard({ execution }: { execution: MissionExecution | undefined }) {
  const recovery = asRecord(execution?.recovery) ?? asRecord(execution?.recoverySummary);
  if (!recovery) return null;
  const state = textValue(recovery.availabilityState);
  const action = textValue(recovery.operatorAction);
  const correlationId = textValue(recovery.correlationId);
  if (!state && !action && !correlationId) return null;
  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4" aria-label="توفر مزود الذكاء الاصطناعي">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <h2 className="font-semibold text-amber-100">يتطلب مزود الذكاء الاصطناعي الانتباه</h2>
          {state && <p className="mt-1 text-xs uppercase tracking-wide text-amber-200/80">الحالة: <bdi dir="ltr">{state.replace(/_/g, ' ')}</bdi></p>}
          {action && <p className="mt-2 text-xs leading-5 text-muted-foreground">الخطوة التالية: {action}</p>}
          {correlationId && <p className="mt-2 font-mono text-[10px] text-muted-foreground">المرجع: <bdi dir="ltr">{correlationId}</bdi></p>}
        </div>
      </div>
    </section>
  );
}

function percentageMetric(metrics: JsonRecord | null, key: string): string {
  const value = numberValue(metrics?.[key]);
  return value === undefined ? 'غير مسجل' : `${(value * 100).toFixed(1)}%`;
}

function ReleaseGateCard({ value }: { value: unknown }) {
  const gate = asRecord(value);
  const summary = asRecord(gate?.summary);
  const blockers = Array.isArray(gate?.blockers)
    ? gate.blockers.filter((item): item is string => typeof item === 'string')
    : [];
  const status = textValue(gate?.status)?.toLowerCase();
  const runtimeOracle = asRecord(gate?.runtimeOraclePreflight);
  const runtimeChecks = Array.isArray(runtimeOracle?.checks)
    ? runtimeOracle.checks.map(asRecord).filter((check): check is JsonRecord => Boolean(check))
    : [];
  const runtimeFailureIds = Array.isArray(runtimeOracle?.failureIds)
    ? runtimeOracle.failureIds.filter((item): item is string => typeof item === 'string')
    : [];
  const runtimeStatus = textValue(runtimeOracle?.status)?.toLowerCase();
  return (
    <section className={`rounded-xl border bg-card ${status === 'passed' ? 'border-emerald-500/25' : 'border-amber-500/30'}`} aria-label="بوابة الإصدار الحتمية">
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3.5">
        {status === 'passed'
          ? <CheckCircle2 className="h-4 w-4 text-emerald-200" />
          : <AlertTriangle className="h-4 w-4 text-amber-200" />}
        <div>
          <h2 className="font-semibold">بوابة الإصدار الحتمية</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">يبقى قبول العقد هو المرجع المعتمد للإصدار.</p>
        </div>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase ${status === 'passed' ? 'border-emerald-500/30 text-emerald-200' : 'border-amber-500/30 text-amber-200'}`}>
          {status ? <bdi dir="ltr">{status}</bdi> : 'غير مسجل'}
        </span>
      </div>
      <div className="p-4">
        {!gate ? (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-4 text-center text-xs text-muted-foreground">
            لم يُعَد تقرير لبوابة الإصدار الحتمية.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['الفحوص', summary?.totalCases],
                ['ناجحة', summary?.passedCases],
                ['إخفاقات مانعة', summary?.blockingFailures],
              ].map(([label, metric]) => (
                <div key={String(label)} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{String(label)}</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-foreground">{formatValue(metric)}</div>
                </div>
              ))}
            </div>
            {blockers.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                {blockers.slice(0, 3).join(' · ')}
              </div>
            )}
            <div className="mt-4 rounded-lg border border-border/60 bg-background/20 p-3" aria-label="فحص مسبق لمراقب التشغيل">
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <h3 className="text-xs font-semibold">فحص مسبق لمراقب التشغيل</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">أوامر مسجلة على الخادم تُشغّل على المرشح المحدد.</p>
                </div>
                <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                  runtimeStatus === 'passed'
                    ? 'border-emerald-500/30 text-emerald-200'
                    : runtimeStatus === 'failed'
                      ? 'border-red-500/30 text-red-200'
                      : 'border-border/60 text-muted-foreground'
                }`}>
                  {runtimeStatus ? <bdi dir="ltr">{runtimeStatus}</bdi> : 'غير مسجل'}
                </span>
              </div>
              {!runtimeOracle ? (
                <p className="mt-3 text-[11px] text-muted-foreground">لم يُعَد تقرير الفحص المسبق لمراقب التشغيل.</p>
              ) : (
                <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-border/45 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">السيناريوهات المسجلة</div>
                      <div className="mt-1 font-mono text-sm font-semibold">{runtimeChecks.length}</div>
                    </div>
                    <div className="rounded-md border border-border/45 px-2.5 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">معرّفات الإخفاق</div>
                      <div className="mt-1 font-mono text-sm font-semibold">{runtimeFailureIds.length}</div>
                    </div>
                  </div>
                  {runtimeChecks.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">الفحوص المسجلة</div>
                      {runtimeChecks.map((check, index) => {
                        const checkStatus = textValue(check.status)?.toLowerCase();
                        return (
                          <div key={`${textValue(check.scenarioId) ?? 'scenario'}-${index}`} className="rounded-md border border-border/45 px-2.5 py-2 text-[11px]">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span dir="ltr" className="font-mono text-foreground">{textValue(check.scenarioId) ?? 'سيناريو غير معروف'}</span>
                              <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] uppercase ${
                                checkStatus === 'passed' ? 'border-emerald-500/30 text-emerald-200' : 'border-red-500/30 text-red-200'
                              }`}>
                                {checkStatus ?? 'unknown'}
                              </span>
                            </div>
                            <div dir="ltr" className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                              {textValue(check.command) ?? 'لم يُسجّل الأمر'}
                            </div>
                            {textValue(check.failureCode) && (
                              <div className="mt-1 text-[10px] text-red-200">رمز الإخفاق: <bdi dir="ltr">{textValue(check.failureCode)}</bdi></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {runtimeFailureIds.length > 0 && (
                    <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/5 px-2.5 py-2 text-[11px] text-red-200">
                      <div className="text-[10px] font-semibold uppercase tracking-wide">معرّفات الإخفاق</div>
                      <div dir="ltr" className="mt-1 break-all font-mono">{runtimeFailureIds.join(' · ')}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function EmpiricalQualityCard({ value }: { value: unknown }) {
  const campaign = asRecord(value);
  const metrics = asRecord(campaign?.metrics);
  const status = textValue(campaign?.empiricalQualityStatus)?.toUpperCase();
  const blockers = Array.isArray(campaign?.blockers)
    ? campaign.blockers.filter((item): item is string => typeof item === 'string')
    : [];
  const latency = asRecord(metrics?.latencyMs);
  return (
    <section className="rounded-xl border border-primary/25 bg-card" aria-label="مراجعة الجودة التجريبية">
      <div className="flex items-center gap-2 border-b border-primary/20 px-4 py-3.5">
        <Activity className="h-4 w-4 text-primary" />
        <div>
          <h2 className="font-semibold">مراجعة الجودة التجريبية</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">قياس اختياري فقط — وليس معيارًا للإصدار.</p>
        </div>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase ${status === 'PROVEN' ? 'border-emerald-500/30 text-emerald-200' : 'border-primary/30 text-primary'}`}>
          {status ? <bdi dir="ltr">{status}</bdi> : 'لم يُشغّل بعد'}
        </span>
      </div>
      <div className="p-4">
        {!campaign ? (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-4 text-center text-xs text-muted-foreground">
            لم تُسجل حملة قياس تجريبية اختيارية.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {textValue(campaign.corpusRevision) && <span>إصدار مجموعة البيانات <bdi dir="ltr">{textValue(campaign.corpusRevision)}</bdi></span>}
              {formatDate(campaign.generatedAt) && <span>آخر رصد {formatDate(campaign.generatedAt)}</span>}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                ['الدقة', percentageMetric(metrics, 'precision')],
                ['الاسترجاع', percentageMetric(metrics, 'recall')],
                ['F1', percentageMetric(metrics, 'f1')],
                ['تغطية الاستشهادات', percentageMetric(metrics, 'citationCoverage')],
                ['القبول الخاطئ', percentageMetric(metrics, 'falseAcceptanceRate')],
                ['الرفض الخاطئ', percentageMetric(metrics, 'falseRejectionRate')],
              ].map(([label, metric]) => (
                <div key={String(label)} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {label === 'F1' ? <bdi dir="ltr">{String(label)}</bdi> : String(label)}
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-foreground"><bdi dir="ltr">{String(metric)}</bdi></div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>المكتمل <bdi dir="ltr">{formatValue(metrics?.completedCases)}</bdi> / <bdi dir="ltr">{formatValue(metrics?.totalCases)}</bdi></span>
              <span>غير المتاح <bdi dir="ltr">{formatValue(metrics?.providerUnavailableCount)}</bdi></span>
              <span><bdi dir="ltr">p95</bdi> <bdi dir="ltr">{formatValue(latency?.p95)} ms</bdi></span>
            </div>
            {blockers.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
                القياس غير مكتمل: {blockers.slice(0, 3).join(' · ')}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ComparisonRunColumn({
  label,
  execution,
}: {
  label: string;
  execution: MissionExecution | undefined;
}) {
  if (!execution) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
        لم يُحدّد تنفيذ.
      </div>
    );
  }

  const evidence = asRecord(execution.evidence);
  const evidenceProjection = asRecord(execution.evidenceProjection);
  const proof = asRecord(evidenceProjection?.proof);
  const proofPresentation = resolveExecutionProofPresentation({
    proofRequired: execution.proofRequired === true,
    operationEvidence: proof
      ? {
          proof: {
            verdict: textValue(proof.verdict),
            accepted: proof.accepted === true,
          },
        }
      : null,
  });
  const evidenceStatus = proof || execution.proofRequired === true
    ? proofPresentation.evidenceVerdict
    : textValue(evidenceProjection?.completeness)
      ?? recoveryDetail(execution, 'evidenceStatus')
      ?? textValue(evidence?.verdict);
  const evidenceStatusTone = evidenceStatus
    ? evidenceTone({ verdict: evidenceStatus })
    : evidenceTone(execution.evidence);
  const failureCategory = recoveryDetail(execution, 'failureCategory');
  const recoveryAction = recoveryDetail(execution, 'recoveryAction');
  const events = Array.isArray(execution.recentEvents) ? execution.recentEvents : [];
  const eventCount = numberValue(execution.eventCount) ?? events.length;
  const evidenceRowsForRun = evidenceRows(execution.evidence).map((row) => (
      row.label === 'Verdict'
      ? { ...row, label: 'الحكم المسجل' }
      : row.label === 'Proof'
        ? { ...row, label: 'بيانات الإثبات المسجلة' }
        : row
  ));
  const details = [
    ['الحالة', stateText(execution.state)],
    ['المحاولات', formatValue(execution.attempts ?? 0)],
    ['إخفاقات التحقق', formatValue(execution.validationFailures ?? 0)],
    ['عدد الأحداث', String(eventCount)],
    ['فئة الإخفاق', failureCategory ?? 'غير مصنفة'],
    ['إجراء الاستعادة', recoveryAction ?? 'لا يوجد إجراء استعادة'],
    ['حالة الأدلة', evidenceStatus ?? 'غير مسجل'],
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-background/20 p-3" data-testid={`comparison-run-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{label === 'Live run' ? 'التنفيذ الحالي' : 'التنفيذ المستورد'}</div>
          <div dir="ltr" className="mt-1 break-all font-mono text-xs text-foreground">{execution.id}</div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateTone(execution.state)}`}>
          {stateText(execution.state)}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5">
        {details.map(([detailLabel, value]) => (
          <div key={detailLabel} className="grid grid-cols-[minmax(105px,0.75fr)_minmax(0,1.25fr)] gap-3 rounded-md border border-border/45 px-2.5 py-2 text-[11px]">
            <span className="text-muted-foreground">{detailLabel}</span>
            <span className="break-words text-right font-medium text-foreground"><bdi dir={detailLabel === 'الحالة' || detailLabel === 'حالة الأدلة' ? 'ltr' : 'auto'}>{value}</bdi></span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border/45 px-2.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> الأدلة المسجلة
          <span
            className={`ml-auto ${evidenceStatusTone}`}
            data-testid={`comparison-evidence-status-${label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <bdi dir="ltr">{evidenceStatus ?? (evidence ? 'RECORDED' : 'NOT RECORDED')}</bdi>
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
          بيانات الأدلة المسجلة ليست إثباتًا معتمدًا ولا تثبت القبول.
        </p>
        {evidenceRowsForRun.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {evidenceRowsForRun.slice(0, 4).map((row) => (
              <div key={row.label} className="text-[11px]">
                <span className="text-muted-foreground">{row.label}: </span>
                <span className="break-words text-foreground/90"><bdi dir="auto">{row.value}</bdi></span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">لم تُعَد أدلة من المسجل.</p>
        )}
      </div>

      <div className="mt-3 rounded-md border border-border/45 px-2.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <History className="h-3.5 w-3.5 text-primary" /> الخط الزمني للأحداث
          <span className="ml-auto font-mono text-foreground">{eventCount} إجمالًا</span>
        </div>
        {events.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {events.slice(0, 6).map((event, index) => {
              const parts = eventParts(event);
              return (
                <div key={`${parts.title}-${parts.time ?? index}`} className="flex gap-2 text-[11px]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{parts.title}</span>
                    {parts.time && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{parts.time}</span>}
                    {parts.detail && parts.detail !== parts.title && <div className="break-words text-muted-foreground">{parts.detail}</div>}
                  </div>
                </div>
              );
            })}
            {events.length > 6 && <p className="text-[10px] text-muted-foreground">يُعرض 6 من أصل {events.length} أحداث معادة.</p>}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">لم تُعَد أحداث في الخط الزمني.</p>
        )}
      </div>
    </div>
  );
}

function objectiveText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  const object = asRecord(value);
  if (!object) return 'لم يُسجّل الهدف';
  return textValue(object.objective, object.description, object.title, object.type)
    ?? 'الهدف الهندسي المعلن';
}

function stateText(state: unknown): string {
  return (textValue(state) ?? 'UNKNOWN').replace(/_/g, ' ');
}

function stateTone(state: unknown): string {
  const normalized = textValue(state)?.toUpperCase();
  if (normalized === 'BLOCKED' || normalized === 'FAILED') {
    return 'border-red-500/35 bg-red-500/10 text-red-200';
  }
  if (normalized === 'CANCELLED') {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  }
  if (normalized && COMPLETE_STATES.has(normalized)) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-primary/35 bg-primary/10 text-primary';
}

function EvidenceIcon({ evidence }: { evidence: unknown }) {
  const verdict = asRecord(evidence)?.verdict;
  const normalized = textValue(verdict)?.toUpperCase();
  if (normalized === 'PROVEN' || normalized === 'PASSED' || normalized === 'VERIFIED') {
    return <ShieldCheck className="h-4 w-4 text-emerald-300" />;
  }
  if (normalized === 'BLOCKED' || normalized === 'FAILED') {
    return <XCircle className="h-4 w-4 text-red-300" />;
  }
  return <CircleDashed className="h-4 w-4 text-amber-300" />;
}

function evidenceTone(evidence: unknown): string {
  const verdict = textValue(asRecord(evidence)?.verdict)?.toUpperCase();
  if (verdict === 'PROVEN' || verdict === 'PASSED' || verdict === 'VERIFIED') {
    return 'text-emerald-200';
  }
  if (verdict === 'BLOCKED' || verdict === 'FAILED') return 'text-red-200';
  return 'text-amber-200';
}

function evidenceRows(evidence: unknown): Array<{ label: string; value: string }> {
  if (typeof evidence === 'string') return [{ label: 'Recorder note', value: evidence }];
  const record = asRecord(evidence);
  if (!record) return [];
  const preferredKeys = ['verdict', 'summary', 'reason', 'recorder', 'checks', 'artifacts', 'proof', 'capturedAt'];
  const keys = preferredKeys.filter((key) => key in record);
  const remaining = Object.keys(record).filter((key) => !keys.includes(key)).slice(0, 4);
  return [...keys, ...remaining].map((key) => ({
    label: formatKey(key),
    value: key === 'capturedAt' ? (formatDate(record[key]) ?? formatValue(record[key])) : formatValue(record[key]),
  }));
}

function recoveryDetail(execution: MissionExecution, key: string): string | undefined {
  const sources = [
    asRecord(execution.recoverySummary),
    asRecord(execution.recovery),
    execution as unknown as JsonRecord,
    asRecord(execution.evidence),
  ];
  for (const source of sources) {
    const value = source?.[key];
    const result = textValue(value);
    if (result) return result;
  }
  return undefined;
}

function csvCell(value: unknown): string {
  return `"${formatValue(value).replace(/"/g, '""')}"`;
}

type HistoryExportFormat = 'csv' | 'json';

const SAFE_PUBLIC_IDENTIFIER = /^[a-z0-9][a-z0-9._:/-]{0,199}$/i;
const SAFE_RUNTIME_ORACLE_COMMAND = /^pnpm(?: [^\r\n]{0,238})?$/;
const SAFE_RUNTIME_ORACLE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function safeRuntimeOracleIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const identifier = value.trim();
  return identifier.length <= 160 && SAFE_PUBLIC_IDENTIFIER.test(identifier)
    ? identifier
    : undefined;
}

function runtimeOracleExport(value: unknown): JsonRecord | undefined {
  const report = asRecord(value);
  if (!report ||
      (report.status !== 'passed' && report.status !== 'failed') ||
      !Array.isArray(report.checks) ||
      !Array.isArray(report.failureIds)) {
    return undefined;
  }

  const checks = report.checks.slice(0, 64).flatMap((value): JsonRecord[] => {
    const check = asRecord(value);
    const scenarioId = safeRuntimeOracleIdentifier(check?.scenarioId);
    if (!check ||
        !scenarioId ||
        typeof check.command !== 'string' ||
        !SAFE_RUNTIME_ORACLE_COMMAND.test(check.command) ||
        (check.status !== 'passed' && check.status !== 'failed')) {
      return [];
    }
    const failureCode = check.status === 'failed' &&
      typeof check.failureCode === 'string' &&
      SAFE_RUNTIME_ORACLE_FAILURE_CODE.test(check.failureCode)
      ? check.failureCode
      : undefined;
    return [{
      scenarioId,
      command: check.command.slice(0, 240),
      status: check.status,
      ...(failureCode ? { failureCode } : {}),
    }];
  });
  const failureIds = report.failureIds
    .map(safeRuntimeOracleIdentifier)
    .filter((value): value is string => Boolean(value))
    .slice(0, 64);

  return {
    status: report.status,
    checks,
    failureIds: [...new Set(failureIds)],
  };
}

function releaseGateExport(value: unknown): JsonRecord | undefined {
  const gate = asRecord(value);
  const summary = asRecord(gate?.summary);
  if (!gate ||
      gate.kind !== 'ai-release-quality-decision' ||
      gate.version !== 1 ||
      (gate.status !== 'passed' && gate.status !== 'blocked') ||
      (gate.liveProviderChecks !== 'disabled' && gate.liveProviderChecks !== 'enabled') ||
      (gate.previewChecks !== 'disabled' && gate.previewChecks !== 'enabled') ||
      !summary) {
    return undefined;
  }
  const summaryKeys = [
    'totalCases',
    'passedCases',
    'failedCases',
    'skippedCases',
    'blockingFailures',
    'informationalFailures',
  ];
  if (!summaryKeys.every((key) => typeof summary[key] === 'number' &&
    Number.isInteger(summary[key]) &&
    (summary[key] as number) >= 0)) {
    return undefined;
  }

  const runtimeOracle = runtimeOracleExport(gate.runtimeOraclePreflight);
  const blockers = Array.isArray(gate.blockers)
    ? gate.blockers
      .filter((blocker): blocker is string =>
        typeof blocker === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(blocker))
      .slice(0, 16)
    : [];
  return {
    kind: 'ai-release-quality-decision',
    version: 1,
    ...(typeof gate.generatedAt === 'string' ? { generatedAt: gate.generatedAt } : {}),
    status: gate.status,
    liveProviderChecks: gate.liveProviderChecks,
    previewChecks: gate.previewChecks,
    summary: Object.fromEntries(summaryKeys.map((key) => [key, summary[key]])),
    blockers,
    ...(runtimeOracle ? { runtimeOraclePreflight: runtimeOracle } : {}),
  };
}

const PRIVATE_MISSION_CONTROL_KEYS = new Set([
  'provider',
  'model',
  'providerMessage',
  'providerOutput',
  'rawResponse',
  'sourceBody',
]);

function redactMissionControlExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMissionControlExport);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !PRIVATE_MISSION_CONTROL_KEYS.has(key))
      .map(([key, entry]) => [key, redactMissionControlExport(entry)]),
  );
}

function benchmarkExport(value: unknown): unknown {
  const benchmark = asRecord(value);
  if (!benchmark) return value;
  const { releaseGate, ...rest } = benchmark;
  const projectedReleaseGate = releaseGateExport(releaseGate);
  return redactMissionControlExport({
    ...rest,
    ...(projectedReleaseGate ? { releaseGate: projectedReleaseGate } : {}),
  });
}

function benchmarkRuntimeOracle(value: unknown): JsonRecord | undefined {
  const benchmark = asRecord(value);
  const releaseGate = asRecord(benchmark?.releaseGate);
  return runtimeOracleExport(releaseGate?.runtimeOraclePreflight);
}

function downloadFilteredHistory(
  executions: MissionExecution[],
  benchmark: unknown,
  format: HistoryExportFormat,
): void {
  if (executions.length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const json = JSON.stringify({
      executions: redactMissionControlExport(executions),
      benchmark: benchmarkExport(benchmark),
    }, null, 2);
    const blob = new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mission-control-history-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const benchmarkRecord = asRecord(benchmark);
  const scorecard = asRecord(benchmarkRecord?.scorecard);
  const baseline = asRecord(benchmarkRecord?.baseline);
  const serialize = (value: unknown) => {
    if (!value) return 'Not recorded';
    try {
      return JSON.stringify(value);
    } catch {
      return formatValue(value);
    }
  };
  const benchmarkSuite = textValue(scorecard?.suiteVersion, benchmarkRecord?.suiteVersion) ?? 'Not recorded';
  const benchmarkBaselineId = textValue(baseline?.baselineId, benchmarkRecord?.baselineId) ?? 'Not recorded';
  const benchmarkScorecard = serialize(scorecard?.metrics);
  const benchmarkBaseline = serialize(baseline?.metrics);
  const runtimeOracle = benchmarkRuntimeOracle(benchmark);
  const runtimeOracleStatus = runtimeOracle?.status ?? 'Not recorded';
  const runtimeOracleChecks = serialize(runtimeOracle?.checks);
  const runtimeOracleFailureIds = serialize(runtimeOracle?.failureIds);
  const headers = [
    'Execution ID', 'Objective', 'State',
    'Failure Category', 'Recovery Action', 'Evidence Status', 'Attempts',
    'Benchmark Suite Version', 'Benchmark Baseline ID', 'Benchmark Scorecard', 'Benchmark Baseline Metrics',
    'Runtime Oracle Status', 'Runtime Oracle Checks', 'Runtime Oracle Failure IDs',
  ];
  const rows = executions.map((execution) => [
    execution.id,
    objectiveText(execution.objective),
    stateText(execution.state),
    recoveryDetail(execution, 'failureCategory') ?? 'Not categorized',
    recoveryDetail(execution, 'recoveryAction') ?? 'No recovery action',
    recoveryDetail(execution, 'evidenceStatus')
      ?? textValue(asRecord(execution.evidence)?.verdict)
      ?? (execution.evidence ? 'Recorded' : 'Not recorded'),
    numberValue(execution.attempts) ?? 0,
    benchmarkSuite,
    benchmarkBaselineId,
    benchmarkScorecard,
    benchmarkBaseline,
    runtimeOracleStatus,
    runtimeOracleChecks,
    runtimeOracleFailureIds,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mission-control-history-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function comparisonExportRow(
  label: 'live' | 'imported',
  execution: MissionExecution,
  benchmark: unknown,
): JsonRecord {
  const events = Array.isArray(execution.recentEvents) ? execution.recentEvents : [];
  return redactMissionControlExport({
    side: label,
    id: execution.id,
    objective: objectiveText(execution.objective),
    state: stateText(execution.state),
    attempts: numberValue(execution.attempts) ?? 0,
    validationFailures: numberValue(execution.validationFailures) ?? 0,
    eventCount: numberValue(execution.eventCount) ?? events.length,
    failureCategory: recoveryDetail(execution, 'failureCategory') ?? 'Not categorized',
    recoveryAction: recoveryDetail(execution, 'recoveryAction') ?? 'No recovery action',
    evidenceStatus: recoveryDetail(execution, 'evidenceStatus')
      ?? textValue(asRecord(execution.evidence)?.verdict)
      ?? (execution.evidence ? 'Recorded' : 'Not recorded'),
    evidence: execution.evidence ?? null,
    recovery: execution.recovery ?? execution.recoverySummary ?? null,
    timestamps: execution.timestamps ?? null,
    timeline: events,
    runtimeOraclePreflight: benchmarkRuntimeOracle(benchmark) ?? null,
  }) as JsonRecord;
}

function downloadComparisonPair(
  liveExecution: MissionExecution | undefined,
  importedExecution: MissionExecution | undefined,
  liveBenchmark: unknown,
  importedBenchmark: unknown,
  format: HistoryExportFormat,
): void {
  if (!liveExecution || !importedExecution) return;
  const live = comparisonExportRow('live', liveExecution, liveBenchmark);
  const imported = comparisonExportRow('imported', importedExecution, importedBenchmark);
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    const json = JSON.stringify({
      exportType: 'mission-control-selected-comparison',
      exportedAt: new Date().toISOString(),
      live,
      imported,
      alignment: {
        evidence: { live: live.evidence, imported: imported.evidence },
        recovery: { live: live.recovery, imported: imported.recovery },
        states: { live: live.state, imported: imported.state },
        eventCounts: { live: live.eventCount, imported: imported.eventCount },
        timelines: { live: live.timeline, imported: imported.timeline },
        runtimeOraclePreflight: {
          live: live.runtimeOraclePreflight,
          imported: imported.runtimeOraclePreflight,
        },
      },
    }, null, 2);
    const blob = new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mission-control-comparison-${live.id}-${imported.id}-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const headers = [
    'الجهة', 'معرّف التنفيذ', 'الهدف', 'الحالة',
    'عدد المحاولات', 'إخفاقات التحقق', 'عدد الأحداث', 'فئة الإخفاق',
    'إجراء الاستعادة', 'حالة الأدلة', 'الأدلة', 'الاستعادة', 'الطوابع الزمنية', 'تسلسل الأحداث',
    'حالة التحقق التشغيلي', 'فحوصات التحقق التشغيلي', 'معرّفات إخفاق التحقق التشغيلي',
  ];
  const rows = [live, imported].map((row) => [
    row.side, row.id, row.objective, row.state,
    row.attempts, row.validationFailures, row.eventCount, row.failureCategory,
    row.recoveryAction, row.evidenceStatus, row.evidence, row.recovery,
    row.timestamps, row.timeline,
    asRecord(row.runtimeOraclePreflight)?.status ?? 'Not recorded',
    asRecord(row.runtimeOraclePreflight)?.checks ?? null,
    asRecord(row.runtimeOraclePreflight)?.failureIds ?? null,
  ]);
  const serialize = (value: unknown) => {
    if (value === null || value === undefined) return 'Not recorded';
    try {
      return JSON.stringify(value);
    } catch {
      return formatValue(value);
    }
  };
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map((value, index) => csvCell(
      [10, 11, 12, 13, 15, 16].includes(index) ? serialize(value) : value,
    )).join(',')),
  ].join('\r\n');
  const blob = new Blob([`${csv}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mission-control-comparison-${live.id}-${imported.id}-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function metricEntries(value: unknown, prefix = '', depth = 0): MetricEntry[] {
  const record = asRecord(value);
  if (!record || depth > 2) return [];
  return Object.entries(record).flatMap(([key, entry]) => {
    if (entry === null || entry === undefined || typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
      const numericValue = numberValue(entry);
      return [{
        key: prefix ? `${prefix}.${key}` : key,
        label: formatKey(prefix ? `${prefix} ${key}` : key),
        value: formatValue(entry),
        ...(numericValue === undefined ? {} : { numericValue }),
      }];
    }
    return metricEntries(entry, prefix ? `${prefix} ${key}` : key, depth + 1);
  });
}

function eventParts(event: unknown): { title: string; detail?: string; time?: string } {
  if (typeof event === 'string') return { title: event };
  const record = asRecord(event);
  if (!record) return { title: formatValue(event) };
  return {
      title: textValue(record.type, record.event, record.kind, record.name, record.state, record.message) ?? 'حدث مسجل',
    detail: textValue(record.message, record.detail, record.description),
    time: formatDate(record.timestamp ?? record.createdAt ?? record.at),
  };
}

function SummaryMetric({
  label,
  value,
  detail,
  icon,
  tone = 'text-foreground',
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/25 p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-xl font-semibold tabular-nums tracking-tight ${tone}`}><bdi dir="ltr">{value}</bdi></div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function UsageSummaryCard({ usage }: { usage: AiUsageSummary | undefined }) {
  if (!usage) {
    return (
      <section className="rounded-xl border border-border bg-card p-4" aria-label="ملخص استخدام الذكاء الاصطناعي">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">استخدام الذكاء الاصطناعي</h2>
        </div>
        <p className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/20 p-4 text-center text-xs text-muted-foreground">
          سجل الاستخدام غير متاح حاليًا.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="ملخص استخدام الذكاء الاصطناعي">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">استخدام الذكاء الاصطناعي</h2>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            محاولات مزوّد الذكاء الاصطناعي المحفوظة خلال آخر <bdi dir="ltr">{usage.windowDays}</bdi> يومًا. وتُعرض صحة التشغيل بشكل مستقل.
          </p>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-1 text-[10px] text-muted-foreground">
          الاحتفاظ بالبيانات لمدة <bdi dir="ltr">{usage.retentionDays}</bdi> يومًا
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryMetric label="المحاولات" value={String(usage.totalAttempts)} detail="استدعاءات المزوّد" icon={<Activity className="h-3.5 w-3.5 text-primary" />} />
        <SummaryMetric
          label="النجاح"
          value={String(usage.totalSuccesses)}
          detail={<><bdi dir="ltr">{usage.totalAttempts ? Math.round((usage.totalSuccesses / usage.totalAttempts) * 100) : 0}%</bdi> من إجمالي المحاولات</>}
          icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
          tone="text-emerald-200"
        />
        <SummaryMetric label="الإخفاقات" value={String(usage.totalFailures)} detail="إخفاقات نهائية لدى المزوّد" icon={<XCircle className="h-3.5 w-3.5 text-red-300" />} tone="text-red-200" />
        <SummaryMetric label="المحاولات البديلة" value={String(usage.totalFallbackAttempts)} detail="محاولات استخدام البديل" icon={<RefreshCw className="h-3.5 w-3.5 text-amber-300" />} tone="text-amber-200" />
      </div>
      {usage.providers.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">لم تُسجّل أي محاولات للمزوّد خلال هذه الفترة.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {usage.providers.map((provider) => (
            <div key={provider.provider} className="rounded-lg border border-border/60 bg-background/20 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <bdi dir="ltr" className="font-semibold">{provider.provider}</bdi>
                <span className="text-muted-foreground"><bdi dir="ltr">{provider.attempts}</bdi> محاولة</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  زمن الاستجابة: <bdi dir="ltr">p50 {provider.p50LatencyMs === null ? 'unknown' : `${provider.p50LatencyMs} ms`}</bdi>
                  {' · '}
                  <bdi dir="ltr">p95 {provider.p95LatencyMs === null ? 'unknown' : `${provider.p95LatencyMs} ms`}</bdi>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>نسبة النجاح: <bdi dir="ltr">{provider.successRate === null ? 'unknown' : `${Math.round(provider.successRate * 100)}%`}</bdi></span>
                <span>
                  بيانات الرموز:{' '}
                  {provider.usage.status === 'unknown' ? (
                    <bdi dir="ltr">{provider.usage.status}</bdi>
                  ) : (
                    <>
                      <bdi dir="ltr">{provider.usage.status}</bdi>
                      {': '}
                      <bdi dir="ltr">{provider.usage.promptTokens ?? 0}</bdi> رمز إدخال /{' '}
                      <bdi dir="ltr">{provider.usage.completionTokens ?? 0}</bdi> رمز إخراج
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-[10px] text-muted-foreground">
        لا يُعرض إجمالي الرموز إلا إذا أرسل المزوّد بيانات الاستخدام. ولا تُستنتج أي تكلفة.
      </div>
    </section>
  );
}

function MissionSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading mission control" aria-busy="true">
      <div className="h-5 w-44 animate-pulse rounded bg-secondary/70" />
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="h-8 w-2/3 animate-pulse rounded bg-secondary/70" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-secondary/50" />
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-secondary/45" />)}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-96 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  );
}

export default function MissionControl() {
  const searchParams = new URLSearchParams(window.location.search);
  const projectId = searchParams.get('projectId') ?? '';
  const requestedMissionId = searchParams.get('missionId') ?? '';
  const requestedExecutionId = searchParams.get('executionId') ?? '';
  const missionProjectionQuery = useQuery({
    queryKey: ['mission-agent-projection', projectId, requestedMissionId],
    queryFn: () => fetchMissionProjection(requestedMissionId),
    enabled: Boolean(requestedMissionId && projectId),
    staleTime: 0,
    refetchInterval: (query) => {
      const mission = (query.state.data as MissionProjection | undefined)?.mission;
      return mission?.status === 'active' ? 3_000 : false;
    },
  });
  const missionProjection = missionProjectionQuery.data;
  const matchingMissionDecision = missionProjection?.mission.id === requestedMissionId
    && String(missionProjection.mission.projectId) === projectId
    && missionProjection?.engineeringAgent?.schemaVersion === 2
    && missionProjection?.engineeringAgent?.missionId === requestedMissionId
    ? missionProjection.engineeringAgent
    : null;
  const [selectedId, setSelectedId] = useState<string | null>(() => requestedExecutionId || null);
  const [comparisonLiveId, setComparisonLiveId] = useState<string | null>(null);
  const [comparisonImportedId, setComparisonImportedId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyState, setHistoryState] = useState('ALL');
  const [historyExportFormat, setHistoryExportFormat] = useState<HistoryExportFormat>('csv');
  const [historyPage, setHistoryPage] = useState(1);
  const [importedHistory, setImportedHistory] = useState<HistorySnapshot | null>(null);
  const [importStatus, setImportStatus] = useState<{ count: number; fileName: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const historyPageSize = 8;
  const { data, error, isError, isLoading, isFetching, refetch } = useGetAiMissionControl(
    { projectId: projectId || undefined },
    {
      query: {
        queryKey: ['ai-mission-control', projectId],
        staleTime: 15_000,
        retry: false,
        refetchOnWindowFocus: true,
        refetchInterval: (query) => {
          const snapshot = query.state.data as AiMissionControl | undefined;
          const hasActiveExecution = snapshot?.executions?.some((execution) => {
            const state = textValue((execution as MissionExecution).state)?.toUpperCase();
            return state === 'BUILDING'
              || state === 'RUNNING'
              || state === 'VALIDATING'
              || state === 'REPAIRING'
              || state === 'QUEUED'
              || state === 'CANCELLING';
          }) ?? false;
          return hasActiveExecution
            ? 3_000
            : snapshot?.shadowComparisonQueue?.status === 'active'
              ? 60_000
              : false;
        },
      },
    },
  );
  const typedData = data as AiMissionControl | undefined;
  const executions = useMemo(() => asExecutions(typedData?.executions), [typedData?.executions]);
  const filteredExecutions = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return executions.filter((execution) => {
      const state = textValue(execution.state)?.toUpperCase() ?? 'UNKNOWN';
      if (historyState !== 'ALL' && state !== historyState) return false;
      if (!query) return true;
      const searchable = [
        execution.id,
        objectiveText(execution.objective),
        recoveryDetail(execution, 'failureCategory'),
        recoveryDetail(execution, 'recoveryAction'),
        recoveryDetail(execution, 'evidenceStatus'),
        execution.evidence,
      ].map(formatValue).join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [executions, historyQuery, historyState]);
  const historyPageCount = Math.max(1, Math.ceil(filteredExecutions.length / historyPageSize));
  const visibleExecutions = filteredExecutions.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );
  const selectedExecution = executions.find((execution) => execution.id === selectedId)
    ?? (requestedExecutionId ? undefined : executions[0]);
  const { data: selectedExecutionDetail, refetch: refetchSelectedExecutionDetail } = useGetAiExecution(selectedExecution?.id ?? '', {
    query: {
      queryKey: ['ai-mission-control-execution', selectedExecution?.id],
      enabled: Boolean(selectedExecution?.id),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        const transitionPending = query.state.data?.worldTransitions?.some((transition) => (
          transition.status === 'pending' || transition.status === 'retrying'
        )) ?? false;
        const handoff = query.state.data?.applyMission;
        const successorPending = handoff?.d2.state === 'PROVEN'
          && Boolean(handoff.successor
            && !['completed', 'blocked', 'failed', 'cancelled', 'needs_replan'].includes(handoff.successor.status));
        return status === 'queued' || status === 'running' || status === 'cancelling' || transitionPending || successorPending
          ? 5_000
          : false;
      },
    },
  });
  const conversationHref = executionChatHref(selectedExecutionDetail, selectedExecution?.id, projectId);
  const comparisonLiveExecution = executions.find((execution) => execution.id === comparisonLiveId) ?? executions[0];
  const historyStates = useMemo(
    () => Array.from(new Set(executions.map((execution) => textValue(execution.state)?.toUpperCase() ?? 'UNKNOWN'))),
    [executions],
  );
  const completedCount = executions.filter((execution) => COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? '')).length;
  const remainingCount = Math.max(0, executions.length - completedCount);
  const scorecardMetrics = useMemo(
    () => metricEntries(asRecord(typedData?.benchmark?.scorecard)?.metrics),
    [typedData?.benchmark?.scorecard],
  );
  const baselineMetrics = useMemo(
    () => metricEntries(asRecord(typedData?.benchmark?.baseline)?.metrics),
    [typedData?.benchmark?.baseline],
  );
  const baselineByKey = useMemo(() => new Map(baselineMetrics.map((metric) => [metric.key, metric])), [baselineMetrics]);
  const importedScorecardMetrics = useMemo(
    () => metricEntries(asRecord(importedHistory?.benchmark.scorecard)?.metrics),
    [importedHistory],
  );
  const importedBaselineMetrics = useMemo(
    () => metricEntries(asRecord(importedHistory?.benchmark.baseline)?.metrics),
    [importedHistory],
  );
  const importedCompletedCount = importedHistory?.executions.filter(
    (execution) => COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? ''),
  ).length ?? 0;
  const importedValidationFailures = importedHistory?.executions.reduce(
    (total, execution) => total + (numberValue(execution.validationFailures) ?? 0),
    0,
  ) ?? 0;
  const importedBaselineByKey = useMemo(
    () => new Map(importedBaselineMetrics.map((metric) => [metric.key, metric])),
    [importedBaselineMetrics],
  );
  const recoverySummaries = useMemo(() => {
    const envelope = asRecord(asRecord(typedData?.benchmark)?.freeTierEnvelope);
    return Array.isArray(envelope?.providerRecoverySummaries)
      ? envelope.providerRecoverySummaries
      : [];
  }, [typedData?.benchmark]);
  const acceptanceSummary = useMemo(
    () => asRecord(asRecord(typedData?.benchmark)?.autonomousDeliveryAcceptance),
    [typedData?.benchmark],
  );
  const acceptanceMetrics = asRecord(acceptanceSummary?.metrics);
  const acceptanceOperations = Array.isArray(acceptanceSummary?.operations)
    ? acceptanceSummary.operations
    : [];
  const releaseGate = asRecord(asRecord(typedData?.benchmark)?.releaseGate);
  const empiricalCampaign = asRecord(asRecord(typedData?.benchmark)?.empiricalCampaign);
  const selectedEvidenceRows = evidenceRows(selectedExecution?.evidence);
  const selectedEvents = Array.isArray(selectedExecution?.recentEvents) ? selectedExecution.recentEvents : [];
  const selectedImportedExecution = importedHistory?.executions.find((execution) => execution.id === comparisonImportedId)
    ?? importedHistory?.executions[0];
  const updatedLabel = formatDate(typedData?.updatedAt);
  const selectedExecutionTaskId = selectedExecution?.linkedTaskId
    ?? (selectedExecution && selectedExecutionDetail?.id === selectedExecution.id
      ? selectedExecutionDetail.linkedTaskId
      : undefined);
  const selectedExecutionDetailIsBound = Boolean(
    selectedExecution && selectedExecutionDetail?.id === selectedExecution.id,
  );
  const selectedExecutionProofPresentation = selectedExecutionDetailIsBound
    ? resolveExecutionProofPresentation(selectedExecutionDetail)
    : null;
  const [recoveryPendingId, setRecoveryPendingId] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  async function recoverExecution(execution: MissionExecution, action: 'resume' | 'abandon') {
    const recovery = asRecord(execution.recovery);
    if (recovery?.uncertain !== true || recoveryPendingId) return;
    const owningTaskId = execution.linkedTaskId
      ?? (selectedExecutionDetail?.id === execution.id
        ? selectedExecutionDetail.linkedTaskId
        : undefined);
    if (owningTaskId) {
      setRecoveryMessage('هذا التنفيذ مرتبط بمهمة. استخدم صفحة المهمة للاستعادة.');
      return;
    }
    setRecoveryPendingId(execution.id);
    setRecoveryMessage(null);
    try {
      const response = await fetch(`/api/ai/executions/${encodeURIComponent(execution.id)}/recovery`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action,
          ...(typeof execution.revision === 'string' && execution.revision ? { revision: execution.revision } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; outcome?: string };
      if (!response.ok) throw new Error(body.error || 'لم تعد الاستعادة متاحة لهذا التنفيذ.');
      setRecoveryMessage(body.outcome === 'abandoned'
        ? 'تم التخلي عن التنفيذ بأمان، ولا تزال أدلته الأصلية متاحة.'
        : 'تم قبول الاستئناف. افتح مساعد الذكاء الاصطناعي للمتابعة من نقطة الحفظ.');
      await refetch();
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : 'تعذرت استعادة التنفيذ.');
    } finally {
      setRecoveryPendingId(null);
    }
  }

  async function handleHistoryImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    setImportError(null);
    setImportStatus(null);
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateHistorySnapshot(parsed);
      if (result.error) {
        setImportError(result.error);
        return;
      }
      setImportedHistory(result.snapshot ?? null);
      setComparisonImportedId(result.snapshot?.executions[0]?.id ?? null);
      setImportStatus({ count: result.snapshot?.executions.length ?? 0, fileName: file.name });
    } catch {
      setImportError('الملف ليس بصيغة JSON صالحة. اختر سجل JSON مُصدّرًا من مركز المهام.');
    }
  }

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
  }, [historyPage, historyPageCount]);

  if (isLoading) return <MissionSkeleton />;

  if (isError) {
    return (
      <div dir="rtl" lang="ar" className="mx-auto max-w-2xl rounded-xl border border-red-500/30 bg-red-500/5 p-7 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-300" />
        <h1 className="mt-4 text-lg font-semibold">مركز المهام غير متاح</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          تعذّرت قراءة سجل التنفيذ المحفوظ. لن نستنتج حالة أي تنفيذ محليًا.
        </p>
        <p className="mt-3 font-mono text-[11px] text-red-200/80">{error instanceof Error ? error.message : 'Request failed'}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover-elevate"
        >
          <RefreshCw className="h-4 w-4" /> أعد المحاولة
        </button>
      </div>
    );
  }

  if (executions.length === 0 && !importedHistory) {
    return (
      <div dir="rtl" lang="ar" className="space-y-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-primary" />
          <span>EngineeringOS</span><span>/</span><span className="text-foreground">مركز المهام</span>
        </div>
        {typedData?.shadowComparisonQueue && (
          <ShadowComparisonQueueCard queue={typedData.shadowComparisonQueue} />
        )}
        <div className="rounded-xl border border-dashed border-border bg-card/70 px-6 py-16 text-center">
          <Layers3 className="mx-auto h-9 w-9 text-primary/80" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">لا توجد عمليات محفوظة في السجل</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            ستظهر عمليات الذكاء الاصطناعي الجديدة هنا بعد توفر نقاط الحفظ وأحداث المسجل التي يديرها الخادم.
          </p>
           <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover-elevate">
              <FileUp className="h-4 w-4" /> استيراد سجل JSON
             <input
               type="file"
               accept="application/json,.json"
               onChange={(event) => void handleHistoryImport(event)}
                aria-label="استيراد سجل الاستعادة بصيغة JSON"
               className="sr-only"
             />
           </label>
          <Link href="/ai" className="mt-6 inline-flex items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover-elevate">
             افتح مساعد الذكاء الاصطناعي <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" lang="ar" className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 text-primary" />
            <span>EngineeringOS</span><span>/</span><span className="text-foreground">مركز المهام</span>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <div className="mt-1 rounded-lg border border-primary/25 bg-primary/10 p-2.5 text-primary">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">مركز المهام</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                سجل واضح لعمليات تسليم الذكاء الاصطناعي، يعرض الحالة والإصلاح والتحقق وأدلة المسجل.
              </p>
              {conversationHref && (
                <Link href={conversationHref} data-testid="link-mission-control-ai"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  العودة إلى محادثة الذكاء الاصطناعي <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {updatedLabel && <span className="hidden text-[11px] text-muted-foreground sm:block">آخر تحديث {updatedLabel}</span>}
          <button
            type="button"
            onClick={() => {
              void refetch();
              if (selectedExecution?.id) void refetchSelectedExecutionDetail();
            }}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover-elevate disabled:opacity-60"
            title="تحديث مركز المهام"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>
      </header>

      {requestedMissionId && matchingMissionDecision ? (
        <section
          className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-5"
          data-testid={`mission-control-decision-${requestedMissionId}`}
        >
          <div className="mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">قرار المهمة</p>
            <h2 className="mt-1 text-base font-semibold">{missionProjection?.mission.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">الإجراء الحالي وحالة التدخل للمهمة كما يديرهما الخادم.</p>
          </div>
          <MissionAgentProjectionSummary projection={matchingMissionDecision} />
        </section>
      ) : requestedMissionId && missionProjectionQuery.isError ? (
        <section className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-muted-foreground" role="status">
          قرار المهمة غير متاح. حدّث صفحة المهمة قبل اتخاذ أي إجراء.
        </section>
      ) : null}

      <section className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Zap className="h-3.5 w-3.5" /> حالة عمليات التسليم
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {completedCount} مكتملة <span className="px-1 text-border">/</span> {remainingCount} متبقية
              <span className="px-1 text-border">·</span> {executions.length} عملية مسجلة
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[540px]">
            <SummaryMetric label="مكتملة" value={String(completedCount)} detail="حالات تسليم نهائية" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />} tone="text-emerald-200" />
            <SummaryMetric label="متبقية" value={String(remainingCount)} detail="نشطة أو غير محسومة" icon={<Clock3 className="h-3.5 w-3.5 text-primary" />} tone="text-primary" />
            <SummaryMetric label="التحقق" value={String(executions.reduce((total, execution) => total + (numberValue(execution.validationFailures) ?? 0), 0))} detail="إخفاقات في السجل" icon={<ShieldCheck className="h-3.5 w-3.5 text-amber-300" />} tone="text-amber-200" />
            <SummaryMetric label="الأحداث" value={String(executions.reduce((total, execution) => total + (numberValue(execution.eventCount) ?? 0), 0))} detail="أحداث سجلها الخادم" icon={<History className="h-3.5 w-3.5 text-primary" />} />
          </div>
        </div>
      </section>

      {typedData?.shadowComparisonQueue && (
        <ShadowComparisonQueueCard queue={typedData.shadowComparisonQueue} />
      )}

      <UsageSummaryCard usage={typedData?.usage} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <section className="min-w-0 rounded-xl border border-border bg-card">
           <div className="border-b border-border/70 px-4 py-3.5">
             <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">سجل التنفيذ</h2>
               <p className="mt-0.5 text-[11px] text-muted-foreground">استعرض السجل المحفوظ، ثم اختر عملية لمراجعة مخرجات المسجل.</p>
               <p className="mt-1 text-[11px] text-muted-foreground">الأدلة وقيم القبول سجلات محفوظة؛ ولا يُعاد التحقق من الإثبات المعتمد الحالي في هذا السجل.</p>
            </div>
             <span className="rounded-full border border-border/70 bg-background/35 px-2 py-1 font-mono text-[10px] text-muted-foreground">{filteredExecutions.length} من {executions.length} عملية</span>
             </div>
             <div className="mt-3 flex flex-col gap-2 sm:flex-row">
               <label className="relative min-w-0 flex-1">
                 <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                 <input
                   type="search"
                   value={historyQuery}
                   onChange={(event) => { setHistoryQuery(event.target.value); setHistoryPage(1); }}
                    placeholder="ابحث بالمعرّف أو الهدف أو الإخفاق أو الإجراء…"
                   aria-label="البحث في سجل التنفيذ"
                   className="h-8 w-full rounded-md border border-border bg-background/50 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
                 />
               </label>
               <select
                 value={historyState}
                 onChange={(event) => { setHistoryState(event.target.value); setHistoryPage(1); }}
                 aria-label="تصفية سجل التنفيذ حسب الحالة"
                 className="h-8 rounded-md border border-border bg-background/50 px-2 text-xs text-foreground outline-none focus:border-primary/60"
               >
                 <option value="ALL">كل الحالات</option>
                 {historyStates.map((state) => <option key={state} value={state}>{state.replace(/_/g, ' ')}</option>)}
               </select>
               <label className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background/50 px-2 text-[11px] text-muted-foreground">
                 <span>الصيغة</span>
                 <select
                   value={historyExportFormat}
                   onChange={(event) => setHistoryExportFormat(event.target.value as HistoryExportFormat)}
                   aria-label="صيغة التصدير"
                   className="h-7 bg-transparent text-xs font-semibold text-foreground outline-none"
                 >
                   <option value="csv">CSV</option>
                   <option value="json">JSON</option>
                 </select>
               </label>
               <button
                 type="button"
                 onClick={() => downloadFilteredHistory(filteredExecutions, typedData?.benchmark, historyExportFormat)}
                 disabled={filteredExecutions.length === 0}
                 aria-label={filteredExecutions.length === 0 ? 'تصدير السجل المصفّى (لا توجد عمليات مطابقة)' : 'تصدير السجل المصفّى'}
                 title={filteredExecutions.length === 0 ? 'لا توجد عمليات مطابقة للتصدير' : `تنزيل كل العمليات المطابقة بصيغة ${historyExportFormat.toUpperCase()}`}
                 className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover-elevate disabled:cursor-not-allowed disabled:opacity-45"
               >
                 <Download className="h-3.5 w-3.5" /> تصدير السجل المصفّى
               </button>
                <label className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background/50 px-3 py-2 text-xs font-semibold text-foreground hover-elevate">
                  <FileUp className="h-3.5 w-3.5 text-primary" /> استيراد سجل JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void handleHistoryImport(event)}
                    aria-label="استيراد سجل الاستعادة بصيغة JSON"
                    className="sr-only"
                  />
                </label>
             </div>
              {importError && <p className="mt-2 text-[11px] text-red-200" role="alert">{importError}</p>}
              {importStatus && <p className="mt-2 text-[11px] text-emerald-200" role="status">تم استيراد {importStatus.count} تنفيذًا من الملف <bdi dir="ltr">{importStatus.fileName}</bdi>.</p>}
             {filteredExecutions.length === 0 && (
               <p className="mt-2 text-[11px] text-muted-foreground" role="status">
                 لا توجد عمليات مطابقة للتصدير. عدّل البحث أو مرشح الحالة.
               </p>
             )}
          </div>
          <div className="divide-y divide-border/60">
             {visibleExecutions.map((execution) => {
              const isSelected = selectedExecution?.id === execution.id;
              const evidence = asRecord(execution.evidence);
              const eventCount = numberValue(execution.eventCount) ?? (Array.isArray(execution.recentEvents) ? execution.recentEvents.length : 0);
               const failureCategory = recoveryDetail(execution, 'failureCategory');
               const recoveryAction = recoveryDetail(execution, 'recoveryAction');
               const evidenceStatus = textValue(asRecord(execution.evidenceProjection)?.completeness)
                 ?? recoveryDetail(execution, 'evidenceStatus')
                 ?? textValue(evidence?.verdict);
               const runAcceptanceStatus = acceptanceStatus(execution);
              return (
                <button
                  type="button"
                  key={execution.id}
                  onClick={() => setSelectedId(execution.id)}
                  className={`block w-full text-left transition-colors hover:bg-secondary/35 ${isSelected ? 'bg-primary/[0.06]' : ''}`}
                  aria-pressed={isSelected}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${stateTone(execution.state)}`}>
                        {COMPLETE_STATES.has(textValue(execution.state)?.toUpperCase() ?? '') ? <CheckCircle2 className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] text-primary">{execution.id}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateTone(execution.state)}`}>{stateText(execution.state)}</span>
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-foreground">{objectiveText(execution.objective)}</h3>
                         <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3 text-amber-300/80" />{numberValue(execution.attempts) ?? 0} محاولات إصلاح</span>
                          <span className="inline-flex items-center gap-1"><TerminalSquare className="h-3 w-3 text-muted-foreground" />{eventCount} أحداث</span>
                           {failureCategory && <span>الإخفاق: {failureCategory}</span>}
                           {recoveryAction && <span>الإجراء: {recoveryAction}</span>}
                           {asRecord(execution.recovery)?.uncertain === true && <span className="font-semibold text-amber-200">يلزم استرداد الحالة غير المحسومة</span>}
                        </div>
                      </div>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3 text-[10px]">
                      <span className={`inline-flex items-center gap-1 ${evidenceTone(execution.evidence)}`}>
                        <EvidenceIcon evidence={execution.evidence} />
                          الأدلة المسجلة: {evidenceStatus ?? (execution.evidence ? 'مسجل' : 'غير مسجل')}
                      </span>
                       {runAcceptanceStatus !== 'NOT_RECORDED' && (
                         <span
                           className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase tracking-wide ${acceptanceStatusClasses(runAcceptanceStatus)}`}
                           aria-label={acceptanceStatusLabel(runAcceptanceStatus)}
                         >
                           {acceptanceStatusLabel(runAcceptanceStatus)}
                         </span>
                       )}
                      <span className="text-muted-foreground">إخفاقات التحقق: {numberValue(execution.validationFailures) ?? 0}</span>
                      <Link
                        href={`/flight-deck?executionId=${encodeURIComponent(execution.id)}`}
                        onClick={(event) => event.stopPropagation()}
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        افتح لوحة متابعة التنفيذ <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </button>
              );
            })}
             {visibleExecutions.length === 0 && (
               <div className="p-8 text-center text-xs text-muted-foreground">لا توجد عمليات تطابق البحث أو مرشح الحالة.</div>
             )}
          </div>
           <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
             <span>
               {filteredExecutions.length === 0 ? '٠ عمليات' : `عرض ${(historyPage - 1) * historyPageSize + 1}–${Math.min(historyPage * historyPageSize, filteredExecutions.length)} من ${filteredExecutions.length}`}
             </span>
             <div className="flex items-center gap-2">
               <button type="button" onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} disabled={historyPage === 1} aria-label="صفحة السجل السابقة" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 hover-elevate disabled:opacity-40">
                 <ChevronLeft className="h-3.5 w-3.5" /> السابق
               </button>
               <span className="font-mono text-[10px]">الصفحة {historyPage} / {historyPageCount}</span>
               <button type="button" onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))} disabled={historyPage === historyPageCount} aria-label="صفحة السجل التالية" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 hover-elevate disabled:opacity-40">
                 التالي <ChevronRight className="h-3.5 w-3.5" />
               </button>
             </div>
           </div>
        </section>

         <div className="min-w-0 space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border/70 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">أدلة المسجل</h2>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {selectedExecution ? `أدلة واضحة للتنفيذ ${selectedExecution.id}` : 'اختر تنفيذًا'}
              </p>
            </div>
            <div className="p-4">
              {!selectedExecution?.evidence ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
                  لم تُعَد أدلة من المسجل لهذا التنفيذ.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
                    <EvidenceIcon evidence={selectedExecution.evidence} />
                    <span className={`text-sm font-semibold ${evidenceTone(selectedExecution.evidence)}`}>
                      {textValue(asRecord(selectedExecution.evidence)?.verdict) ?? 'تم تسجيل الأدلة'}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">نقطة الحفظ <bdi dir="ltr">v{formatValue(selectedExecution.checkpointVersion)}</bdi></span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {selectedEvidenceRows.map((row) => (
                      <div key={row.label} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</div>
                        <div className="mt-1 break-words text-xs leading-5 text-foreground/90">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {selectedExecutionDetailIsBound && selectedExecutionDetail?.projection && selectedExecutionProofPresentation && (
            <MissionCapsule
              projection={selectedExecutionDetail.projection}
              executionId={selectedExecution?.id}
              operationId={selectedExecutionDetail.operationId}
              proposalId={selectedExecutionDetail.proposalId}
              taskId={selectedExecutionDetail.linkedTaskId}
              executionStatus={selectedExecutionDetail.status}
              flightState={selectedExecutionProofPresentation.flightState}
              evidenceVerdict={selectedExecutionProofPresentation.evidenceVerdict}
              resumable={selectedExecutionDetail.resumable}
              nextAction={selectedExecutionDetail.evidenceReason ?? selectedExecutionDetail.acceptance?.disposition?.operatorAction}
            />
          )}

          {acceptanceStatus(selectedExecution) !== 'NOT_RECORDED' && (
            <section className="rounded-xl border border-primary/25 bg-primary/5 p-4" aria-label="قبول التنفيذ الحالي">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">قبول المحاولة الحالية</h2>
                <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${acceptanceStatusClasses(acceptanceStatus(selectedExecution))}`}>
                  {acceptanceStatusLabel(acceptanceStatus(selectedExecution))}
                </span>
              </div>
              {asRecord(selectedExecution?.acceptance) ? (
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">المحاولة</div>
                  <div className="font-mono">{formatValue(asRecord(selectedExecution?.acceptance)?.attempt)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">النتيجة</div>
                  <div>{formatValue(asRecord(selectedExecution?.acceptance)?.outcome)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">الخطوة التالية</div>
                  <div className="text-primary">{acceptanceNextActionLabel(asRecord(selectedExecution?.acceptance)?.nextActionCode)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">رمز التشخيص</div>
                  <div className="font-mono text-primary">{formatValue(asRecord(selectedExecution?.acceptance)?.nextActionCode)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">نوع المهمة</div>
                  <div className="font-mono">{formatValue(taskObjectiveAcceptance(selectedExecution)?.kind)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">أداة التحقق</div>
                  <div className="font-mono">{taskObjectiveValidatorLabel(selectedExecution)}</div>
                </div>
              </div>
              ) : (
                <p className="mt-2 text-[11px] text-amber-200">
                  يتطلب هذا التنفيذ المحدد إثبات قبول يديره الخادم، لكن لم تُسجل لقطة قبول مكتملة.
                </p>
              )}
              {asRecord(selectedExecution?.acceptance)?.evidenceComplete === false && (
                <p className="mt-2 text-[11px] text-amber-200">
                  القبول غير مكتمل لأن لقطة الأدلة التي يديرها الخادم غير مكتملة.
                </p>
              )}
            </section>
          )}

          {selectedExecutionDetailIsBound && selectedExecutionDetail && (
            <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="سلسلة الأدلة">
              <div className="border-b border-border/70 px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">سلسلة الأدلة</h2>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    المحاولة {selectedExecutionDetail.attempt} · للقراءة فقط
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  تربط بيانات الحلقة الخاصة بالمحاولة الحالية الأحداث والملاحظات والتأثيرات والحزم. تبقى الحمولات وقيم الملاحظات مخفية، ويظل القبول وحالة العالم سجلين منفصلين.
                </p>
              </div>
              <div className="space-y-3 p-4">
                {selectedExecutionDetail.evidenceBraid?.truncated && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100" role="status">
                    هذا عرض محدود؛ وقد لا يتضمن بعض سجلات المحاولة الحالية.
                  </p>
                )}
                {(selectedExecutionDetail.evidenceBraid?.episodes ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-4 text-center text-xs text-muted-foreground">
                    لا تتوفر سجلات حلقات للمحاولة الحالية.
                  </div>
                ) : (
                  selectedExecutionDetail.evidenceBraid!.episodes.map((episode) => (
                    <article key={episode.id} className="rounded-lg border border-border/70 bg-background/20 p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">الحلقة</div>
                          <div className="mt-1 break-all font-mono text-[11px]">{episode.id}</div>
                        </div>
                        <div className="flex gap-1.5 text-[10px]">
                          <span className="rounded border border-border px-1.5 py-0.5">{episode.state}</span>
                          {episode.verdict && <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-primary">{episode.verdict}</span>}
                        </div>
                      </div>
                      <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
                        <div><span className="text-muted-foreground">مراجعة المشروع · </span><code dir="ltr" className="break-all">{episode.projectRevision ?? 'غير مسجل'}</code></div>
                        <div><span className="text-muted-foreground">مراجعة حالة العالم · </span><code dir="ltr" className="break-all">{episode.worldRevision ?? 'غير مسجل'}</code></div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <section className="rounded-md border border-border/60 bg-card/50 p-2" aria-label={`Episode events ${episode.id}`}>
                          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">الأحداث · {episode.events.length}</h3>
                          {episode.events.length === 0 ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">لا توجد بيانات وصفية للأحداث.</p>
                          ) : (
                            <ul className="mt-1 space-y-1">
                              {episode.events.map((event) => (
                                <li key={event.id} className="flex justify-between gap-2 text-[10px]">
                                  <span className="break-all">{event.eventType}</span>
                                  <span className="shrink-0 font-mono text-muted-foreground">#{event.sequence}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                        <section className="rounded-md border border-border/60 bg-card/50 p-2" aria-label={`Episode observations ${episode.id}`}>
                          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">الملاحظات · {episode.observations.length}</h3>
                          {episode.observations.length === 0 ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">لا توجد بيانات وصفية للملاحظات.</p>
                          ) : (
                            <ul className="mt-1 space-y-1.5">
                              {episode.observations.map((observation) => (
                                <li key={observation.id} className="break-words text-[10px]">
                                  <span className="font-medium">{observation.observationRole ?? observation.kind}</span>
                                  <span className="text-muted-foreground"> · {observation.provenance} · {observation.completeness} · {observation.freshness}</span>
                                  <div className="break-all font-mono text-muted-foreground">{observation.id}</div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                        <section className="rounded-md border border-border/60 bg-card/50 p-2" aria-label={`Episode effects ${episode.id}`}>
                          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">التأثيرات · {episode.effects.length}</h3>
                          {episode.effects.length === 0 ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">لا توجد سجلات للتأثيرات.</p>
                          ) : (
                            <ul className="mt-1 space-y-1.5">
                              {episode.effects.map((effect) => (
                                <li key={effect.id} className="text-[10px]">
                                  <span className="font-medium">{effect.status}</span>
                                  <span className="text-muted-foreground"> · الإجراء <bdi dir="ltr">{effect.actionId} · {effect.capabilityId}</bdi></span>
                                  <div className="text-muted-foreground">
                                    ملاحظات قبل/بعد {effect.beforeObservationIds.length}/{effect.afterObservationIds.length}
                                    {' · '}مفقود {effect.missingEffectCount} · تناقضات {effect.contradictionCount}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                        <section className="rounded-md border border-border/60 bg-card/50 p-2" aria-label={`Episode effect bundles ${episode.id}`}>
                          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">حزم التأثير · {episode.effectBundles.length}</h3>
                          {episode.effectBundles.length === 0 ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">لا توجد سجلات لحزم التأثير.</p>
                          ) : (
                            <ul className="mt-1 space-y-1.5">
                              {episode.effectBundles.map((bundle) => (
                                <li key={bundle.id} className="text-[10px]">
                                  <span className="font-medium">{bundle.verdict}</span>
                                  <span className="text-muted-foreground"> · {bundle.effectIds.length} تأثيرات مرتبطة</span>
                                  <div className="break-all font-mono text-muted-foreground">{bundle.id}</div>
                                  <div className="break-all text-muted-foreground">مراجعة حالة العالم · <bdi dir="ltr">{bundle.worldRevision ?? 'غير مسجل'}</bdi></div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>
                    </article>
                  ))
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[10px]">
                    <div className="font-semibold uppercase tracking-wide text-muted-foreground">القبول · المحاولة الحالية</div>
                    <div className="mt-1">
                      {selectedExecutionDetail.acceptance
                        ? `${selectedExecutionDetail.acceptance.outcome} · ${selectedExecutionDetail.acceptance.terminalStatus}`
                        : 'لم تُسجل لقطة قبول'}
                    </div>
                    <div className="mt-1 text-muted-foreground">يظل سجل القبول الذي يديره الخادم هو المرجع المعتمد.</div>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/20 px-3 py-2 text-[10px]">
                    <div className="font-semibold uppercase tracking-wide text-muted-foreground">حالة العالم · سجلات منفصلة</div>
                    <div className="mt-1">
                      {(selectedExecutionDetail.worldTransitions ?? []).length} سجلات انتقال حالة عالم مرتبطة
                    </div>
                    <div className="mt-1 text-muted-foreground">راجع تفاصيل الانتقال في الخط الزمني أدناه.</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {selectedExecutionDetailIsBound && selectedExecutionDetail && selectedExecutionProofPresentation && (
            <WorldTransitionTimeline
              recipeId={selectedExecutionDetail.recipeReceipt?.recipeId}
              executionId={selectedExecutionDetail.id}
              attempt={selectedExecutionDetail.attempt}
              transitions={selectedExecutionDetail.worldTransitions}
              acceptance={selectedExecutionDetail.acceptance}
              proofVerdict={selectedExecutionProofPresentation.evidenceVerdict}
              applyMission={selectedExecutionDetail.applyMission}
            />
          )}

           {asRecord(selectedExecution?.recovery)?.uncertain === true && selectedExecution && (
             <section className="rounded-xl border border-amber-500/35 bg-amber-500/5 p-4" aria-label="استعادة التنفيذ غير المحسوم">
               <div className="flex items-start gap-3">
                 <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                 <div className="min-w-0 flex-1">
                   <h2 className="font-semibold text-amber-100">التنفيذ غير محسوم ويتطلب قرارًا</h2>
                   <p className="mt-1 text-xs leading-5 text-muted-foreground">
                     العملية <bdi dir="ltr">{textValue(selectedExecution.operationId) ?? selectedExecution.id}</bdi> · المراجعة <bdi dir="ltr">{textValue(selectedExecution.revision) ?? 'NOT RECORDED'}</bdi> · المرحلة <bdi dir="ltr">{textValue(selectedExecution.phase) ?? 'UNKNOWN'}</bdi>.
                     حُفظ طلب المستخدم الأصلي وإيصال الأدلة.
                   </p>
                   {selectedExecutionTaskId ? (
                     <div className="mt-3 flex flex-wrap items-center gap-2">
                       <span className="text-xs text-muted-foreground">تُدار الاستعادة من المهمة المرتبطة بهذا التنفيذ.</span>
                       <Link
                         href={`/tasks?taskId=${encodeURIComponent(selectedExecutionTaskId)}`}
                         className="rounded-md border border-primary/30 px-3 py-2 text-xs font-semibold text-primary hover-elevate"
                         aria-label="افتح المهمة المرتبطة"
                       >
                         افتح المهمة
                       </Link>
                     </div>
                   ) : selectedExecutionDetailIsBound ? (
                     <div className="mt-3 flex flex-wrap gap-2">
                       <button type="button" disabled={recoveryPendingId === selectedExecution.id} onClick={() => void recoverExecution(selectedExecution, 'resume')} className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover-elevate disabled:opacity-50">
                         {recoveryPendingId === selectedExecution.id ? 'جارٍ التنفيذ…' : 'استأنف مرة واحدة'}
                       </button>
                       <button type="button" disabled={recoveryPendingId === selectedExecution.id} onClick={() => void recoverExecution(selectedExecution, 'abandon')} className="rounded-md border border-amber-500/35 px-3 py-2 text-xs font-semibold text-amber-100 hover-elevate disabled:opacity-50">
                         تخلَّ عنه بأمان
                       </button>
                     </div>
                   ) : (
                     <p className="mt-3 text-xs text-muted-foreground" role="status">
                       جارٍ التحقق من مالك التنفيذ قبل إتاحة الاستعادة.
                     </p>
                   )}
                   {recoveryMessage && <p className="mt-2 text-[11px] text-amber-100" role="status">{recoveryMessage}</p>}
                 </div>
               </div>
             </section>
           )}

          <ProviderAvailabilityCard execution={selectedExecution} />

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3.5">
              <GitBranch className="h-4 w-4 text-primary" />
              <div>
                <h2 className="font-semibold">مقارنة خط الأساس</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">قيم القياس كما أعادها الخادم.</p>
              </div>
            </div>
            <div className="p-4">
              {recoverySummaries.length > 0 && (
                <div className="mb-4 space-y-2" aria-label="ملخصات استعادة المزود السابقة">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    تفاصيل الاستعادة في التقارير السابقة
                  </div>
                  {recoverySummaries.map((summary, index) => (
                    <ProviderRecoverySummary key={index} value={summary} />
                  ))}
                </div>
              )}
              {scorecardMetrics.length === 0 && baselineMetrics.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">لم تُعَد مقاييس للقياس.</p>
              ) : (
                <div className="space-y-1.5">
                  {scorecardMetrics.slice(0, 8).map((metric) => {
                    const baseline = baselineByKey.get(metric.key);
                    const delta = metric.numericValue !== undefined && baseline?.numericValue !== undefined
                      ? metric.numericValue - baseline.numericValue
                      : undefined;
                    return (
                      <div key={metric.key} className="flex items-center gap-3 rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{metric.label}</span>
                        <span className="font-mono text-xs text-foreground">{metric.value}</span>
                        <span className="w-20 text-right font-mono text-[10px] text-muted-foreground">
                          {baseline ? <>الأساس <bdi dir="ltr">{baseline.value}</bdi></> : 'لا توجد قيمة أساس'}
                        </span>
                        {delta !== undefined && (
                          <span className={`w-12 text-right font-mono text-[10px] ${delta >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
                            {delta >= 0 ? '+' : ''}{formatValue(delta)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {scorecardMetrics.length === 0 && <p className="text-xs text-muted-foreground">لم تُسجل مقاييس بطاقة الأداء؛ تتوفر بيانات خط الأساس.</p>}
                </div>
              )}
            </div>
          </section>

           <ReleaseGateCard value={releaseGate} />
           <EmpiricalQualityCard value={empiricalCampaign} />

          <section className="rounded-xl border border-emerald-500/25 bg-card" aria-label="تقرير قبول التسليم المستقل">
            <div className="flex items-center gap-2 border-b border-emerald-500/20 px-4 py-3.5">
              <ShieldCheck className="h-4 w-4 text-emerald-200" />
              <div>
                <h2 className="font-semibold">نتائج التسليم المتحقق منها</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  أدلة قبول مستقلة عن فحوص الإصدار الحتمية.
                </p>
              </div>
              {acceptanceSummary && (
                <span className="ml-auto rounded-full border border-emerald-500/30 px-2 py-0.5 text-[10px] uppercase text-emerald-200">
                  {formatValue(acceptanceSummary.operationCount)} عملية
                </span>
              )}
            </div>
            <div className="p-4">
              {!acceptanceSummary ? (
                <p className="rounded-lg border border-dashed border-border/70 bg-background/20 p-5 text-center text-xs text-muted-foreground">
                  لم يُعَد تقرير قبول التسليم المستقل.
                </p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['إكمال متحقق منه', acceptanceMetrics?.completionRate],
                      ['حظر آمن', acceptanceMetrics?.safeBlockRate],
                      ['إخفاق معلوم', acceptanceMetrics?.failureRate],
                      ['غير محسوم', acceptanceMetrics?.uncertaintyRate],
                      ['استعادة', acceptanceMetrics?.recoveryRate],
                      ['تجاوز النطاق', acceptanceMetrics?.scopeEscapeRate],
                      ['أثر جانبي مكرر', acceptanceMetrics?.repeatedSideEffectRate],
                      ['عدد الإكمالات المتحققة', acceptanceMetrics?.verifiedCompletionCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-border/45 bg-background/20 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{String(label)}</div>
                        <div className="mt-1 font-mono text-sm font-semibold text-foreground">
                          {typeof value === 'number' && String(label) !== 'Verified count'
                            ? `${(value * 100).toFixed(1)}%`
                            : formatValue(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {acceptanceOperations.length > 0 && (
                    <div className="mt-4 space-y-1.5" aria-label="عمليات القبول">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">العمليات</div>
                      {acceptanceOperations.slice(0, 12).map((raw, index) => {
                        const operation = asRecord(raw);
                        if (!operation) return null;
                        return (
                          <div key={`${textValue(operation.operationId) ?? 'operation'}-${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/45 bg-background/20 px-3 py-2 text-xs">
                            <span dir="ltr" className="font-mono text-foreground">{textValue(operation.operationId) ?? 'UNKNOWN OPERATION'}</span>
                            <span className="text-muted-foreground">·</span>
                            <bdi dir="ltr" className="text-muted-foreground">{textValue(operation.caseId) ?? 'UNKNOWN CASE'}</bdi>
                            <span className="ml-auto rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] uppercase">
                              {textValue(operation.outcome) ?? 'unknown'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {importedHistory && (
        <section className="rounded-xl border border-primary/25 bg-card" aria-label="مقارنة السجل المستورد">
          <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileUp className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">مقارنة السجل المستورد</h2>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                مقارنة للقراءة فقط؛ لم يتغير سجل التنفيذ الحالي.
              </p>
            </div>
              <div className="flex flex-wrap gap-2 self-start">
                <button
                  type="button"
                  onClick={() => downloadComparisonPair(
                    comparisonLiveExecution,
                    selectedImportedExecution,
                    typedData?.benchmark,
                    importedHistory?.benchmark,
                    historyExportFormat,
                  )}
                  disabled={!comparisonLiveExecution || !selectedImportedExecution}
                  aria-label="صدّر زوج التنفيذ الحالي والمستورد المحدد"
                  title={`تنزيل الزوج المحدد بصيغة ${historyExportFormat.toUpperCase()}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover-elevate disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download className="h-3.5 w-3.5" /> تصدير الزوج المحدد
                </button>
                <button
                  type="button"
                  onClick={() => { setImportedHistory(null); setImportStatus(null); }}
                  className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover-elevate"
                >
                  مسح المقارنة
                </button>
              </div>
          </div>
          <div className="border-b border-border/70 px-4 py-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">مقارنة تنفيذين</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  قارن تنفيذًا حاليًا بتنفيذ مؤرشف. تبقى البيانات المستوردة منفصلة عن سجل التنفيذ الحالي.
                </p>
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-[11px] font-semibold text-muted-foreground">
                التنفيذ الحالي
                <select
                  aria-label="اختر التنفيذ الحالي للمقارنة"
                  value={comparisonLiveExecution?.id ?? ''}
                  onChange={(event) => setComparisonLiveId(event.target.value || null)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background/50 px-2 text-xs font-normal text-foreground outline-none focus:border-primary/60"
                  disabled={executions.length === 0}
                >
                  {executions.length === 0 && <option value="">لا تتوفر تنفيذات حالية</option>}
                  {executions.map((execution) => (
                    <option key={execution.id} value={execution.id}>{execution.id} — {objectiveText(execution.objective)}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold text-muted-foreground">
                التنفيذ المستورد
                <select
                  aria-label="اختر التنفيذ المستورد للمقارنة"
                  value={importedHistory.executions.find((execution) => execution.id === comparisonImportedId)?.id ?? importedHistory.executions[0]?.id ?? ''}
                  onChange={(event) => setComparisonImportedId(event.target.value || null)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background/50 px-2 text-xs font-normal text-foreground outline-none focus:border-primary/60"
                >
                  {importedHistory.executions.map((execution) => (
                    <option key={execution.id} value={execution.id}>{execution.id} — {objectiveText(execution.objective)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2" aria-label="مقارنة التنفيذين المحددين">
            <ComparisonRunColumn label="Live run" execution={comparisonLiveExecution} />
            <ComparisonRunColumn
              label="Imported run"
              execution={selectedImportedExecution}
            />
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            {[
              {
                label: 'السجل الحالي',
                executions: executions.length,
                completed: completedCount,
                failures: executions.reduce((total, execution) => total + (numberValue(execution.validationFailures) ?? 0), 0),
                metrics: scorecardMetrics,
                baseline: baselineByKey,
              },
              {
                label: 'السجل المستورد',
                executions: importedHistory.executions.length,
                completed: importedCompletedCount,
                failures: importedValidationFailures,
                metrics: importedScorecardMetrics,
                baseline: importedBaselineByKey,
              },
            ].map((column) => (
              <div key={column.label} className="rounded-lg border border-border/60 bg-background/20 p-3">
                <h3 className="text-sm font-semibold">{column.label}</h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <SummaryMetric label="التنفيذات" value={String(column.executions)} detail="تنفيذات مسجلة" icon={<History className="h-3.5 w-3.5 text-primary" />} />
                  <SummaryMetric label="مكتملة" value={String(column.completed)} detail="حالات نهائية" icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />} tone="text-emerald-200" />
                  <SummaryMetric label="التحقق" value={String(column.failures)} detail="عدد الإخفاقات" icon={<ShieldCheck className="h-3.5 w-3.5 text-amber-300" />} tone="text-amber-200" />
                </div>
                <div className="mt-3 space-y-1.5">
                  {column.metrics.slice(0, 6).map((metric) => {
                    const baseline = column.baseline.get(metric.key);
                    return (
                      <div key={metric.key} className="flex items-center gap-2 rounded-md border border-border/45 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{metric.label}</span>
                        <span className="font-mono text-foreground">{metric.value}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {baseline ? <>الأساس <bdi dir="ltr">{baseline.value}</bdi></> : 'لا توجد قيمة أساس'}
                        </span>
                      </div>
                    );
                  })}
                  {column.metrics.length === 0 && <p className="text-xs text-muted-foreground">لم تُسجل مقاييس بطاقة الأداء.</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
            التنفيذات المستوردة: <bdi dir="ltr">{importedHistory.executions.map((execution) => execution.id).join(', ')}</bdi>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card" aria-label="أحداث المسجل الأخيرة">
        <div className="flex flex-col gap-2 border-b border-border/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <div>
              <h2 className="font-semibold">أحداث المسجل الأخيرة</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {selectedExecution ? <bdi dir="ltr">{selectedExecution.id}</bdi> : 'لم يُحدّد تنفيذ'} · تدفق أحداث يديره الخادم
              </p>
            </div>
          </div>
          {selectedExecution && (
            <Link href={`/flight-deck?executionId=${encodeURIComponent(selectedExecution.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
              افحص التنفيذ كاملًا <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        <div className="p-4">
          {selectedEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-background/20 p-6 text-center text-xs text-muted-foreground">
              لم تُعَد أحداث حديثة لهذا التنفيذ.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {selectedEvents.slice(0, 12).map((event, index) => {
                const parts = eventParts(event);
                return (
                  <div key={`${parts.title}-${parts.time ?? index}`} className="flex gap-3 rounded-md border border-border/55 bg-background/20 px-3 py-2.5">
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <bdi dir="auto" className="text-xs font-medium text-foreground">{parts.title}</bdi>
                        {parts.time && <span className="font-mono text-[10px] text-muted-foreground">{parts.time}</span>}
                      </div>
                      {parts.detail && parts.detail !== parts.title && <p dir="auto" className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{parts.detail}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}