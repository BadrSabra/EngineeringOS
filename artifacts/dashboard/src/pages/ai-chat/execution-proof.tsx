import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, CheckCircle2, ChevronRight, Download, ExternalLink, Eye, GitMerge, Loader2, ShieldAlert, ShieldCheck, Square, X } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MissionCapsule } from '@/components/MissionCapsule';
import { type ExecutionRecoveryView } from '@/lib/execution-recovery-view';
import { resolveExecutionProofPresentation } from '@/lib/execution-proof-presentation';
import type { AiExecutionNodeSnapshot, AiExecutionProjection, AiTerminalProjection, ExportAiExecutionAudit200 } from '@workspace/api-client-react';
import type { AcceptanceDispositionView, AcceptanceNextActionCode, BenchmarkScorecard } from './types';
import { acceptanceFollowUpLabel } from './project-query';
import type { PendingChange } from './provider-runtime';
import type { FinalForensicVerdict } from './trace-parsing';
import { type LiveAgentToolStep, formatElapsed } from './live-activity';

export type AgentExecutionProofStatus = {
  id?: string;
  status?: string;
  attempt?: number;
  operationId?: string | null;
  linkedTaskId?: string | null;
  projectRevision?: string | null;
  terminalReason?: string | null;
  flightState?:
    | 'BUILDING'
    | 'VALIDATING'
    | 'REPAIRING'
    | 'READY_FOR_REVIEW'
    | 'BLOCKED'
    | 'APPLIED'
    | 'COMMITTED'
    | 'PUSHED'
    | 'CANCELLED'
    | 'COMPLETED';
  evidenceVerdict?: 'PROVEN' | 'PARTIAL' | 'UNAVAILABLE' | 'BLOCKED' | 'CLAIM_UNCLOSED' | 'NOT_RECORDED';
  evidenceReason?: string | null;
  operationEvidence?: {
    proof?: {
      verdict?: string | null;
      accepted?: boolean | null;
    } | null;
  } | null;
  acceptanceDisposition?: AcceptanceDispositionView | null;
  terminalProjection?: AiTerminalProjection | null;
  acceptance?: {
    attempt: number;
    terminalStatus: string;
    outcome: string;
    reasonCode: string;
    nextActionCode: AcceptanceNextActionCode;
    evidenceComplete: boolean;
    evidenceRequired: boolean;
    resumable: boolean;
  } | null;
  objective?: Record<string, unknown> | null;
  proofRequired?: boolean;
  recovery?: {
    uncertain: boolean;
    operationId: string | null;
    revision: string | null;
    phase: string | null;
    outcome: string | null;
  };
  checkpoint?: Record<string, unknown>;
  checkpointVersion?: number;
  resumable?: boolean;
  error?: string | null;
  projection?: AiExecutionProjection | null;
};

function flightDeckStateLabel(state: AgentExecutionProofStatus['flightState']): string {
  switch (state) {
    case 'READY_FOR_REVIEW':
      return 'جاهز للمراجعة';
    case 'VALIDATING':
      return 'جارٍ التحقق';
    case 'REPAIRING':
      return 'جارٍ الإصلاح';
    case 'BLOCKED':
      return 'متعذّر';
    case 'APPLIED':
      return 'طُبّق';
    case 'COMMITTED':
      return 'أُودع في Git';
    case 'PUSHED':
      return 'أُرسل إلى المستودع';
    case 'CANCELLED':
      return 'أُلغي';
    case 'COMPLETED':
      return 'اكتمل';
    case 'BUILDING':
      return 'جارٍ التنفيذ';
    default:
      return 'جارٍ التجهيز';
  }
}

function flightDeckStateClasses(state: AgentExecutionProofStatus['flightState']): string {
  if (state === 'BLOCKED') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (state === 'CANCELLED') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (state === 'READY_FOR_REVIEW' || state === 'APPLIED' || state === 'COMMITTED' || state === 'PUSHED') {
    return 'border-green-500/40 bg-green-500/10 text-green-200';
  }
  if (state === 'VALIDATING' || state === 'REPAIRING') {
    return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  }
  return 'border-primary/40 bg-primary/10 text-primary';
}

function flightDeckEvidenceClasses(verdict: AgentExecutionProofStatus['evidenceVerdict']): string {
  if (verdict === 'PROVEN') return 'border-green-500/40 bg-green-500/10 text-green-200';
  if (verdict === 'BLOCKED' || verdict === 'UNAVAILABLE' || verdict === 'CLAIM_UNCLOSED') {
    return 'border-red-500/40 bg-red-500/10 text-red-200';
  }
  if (verdict === 'PARTIAL') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function checkpointExecutionNodes(
  checkpoint: Record<string, unknown> | undefined,
): AiExecutionNodeSnapshot[] {
  if (!checkpoint || !Array.isArray(checkpoint.nodeStates)) return [];
  return checkpoint.nodeStates.filter((node): node is AiExecutionNodeSnapshot => {
    if (!node || typeof node !== 'object') return false;
    const value = node as Partial<AiExecutionNodeSnapshot>;
    return (
      typeof value.id === 'string' &&
      typeof value.title === 'string' &&
      typeof value.status === 'string' &&
      Array.isArray(value.allowedFiles) &&
      Array.isArray(value.dependencies) &&
      typeof value.validationProfile === 'string' &&
      typeof value.attempts === 'number'
    );
  });
}

function executionNodeStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'بانتظار البدء';
    case 'running':
      return 'جارٍ تنفيذها';
    case 'passed':
      return 'اكتملت';
    case 'failed':
      return 'لم تكتمل';
    case 'blocked':
      return 'متوقفة بانتظار المعالجة';
    default:
      return 'حالة غير معروفة';
  }
}

function ExecutionMissionControl({
  nodes,
}: {
  nodes: AiExecutionNodeSnapshot[];
}) {
  if (nodes.length === 0) return null;
  const counts = nodes.reduce<Record<string, number>>((summary, node) => {
    summary[node.status] = (summary[node.status] ?? 0) + 1;
    return summary;
  }, {});
  const statusClasses: Record<string, string> = {
    queued: 'border-border/60 bg-background/30 text-muted-foreground',
    running: 'border-primary/40 bg-primary/10 text-primary',
    passed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    failed: 'border-red-500/40 bg-red-500/10 text-red-200',
    blocked: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  };

  return (
    <div
      dir="rtl"
      lang="ar"
      className="border-t border-border/40 px-3 py-2.5"
      role="region"
      aria-label="مراحل تنفيذ التشغيل"
    >
      <div className="flex items-center gap-2">
        <GitMerge className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-foreground">خطوات هذا التشغيل</span>
        <span className="ms-auto text-[10px] text-muted-foreground">
          الخطوات المكتملة: {counts.passed ?? 0} من {nodes.length}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {nodes.map((node) => (
          <div key={node.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${statusClasses[node.status] ?? 'border-border/60 bg-background/30 text-muted-foreground'}`}>
              {executionNodeStatusLabel(node.status)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-foreground/90"><bdi dir="auto">{node.title}</bdi></span>
            <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
              المحاولة {node.attempts} من 3
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BenchmarkMissionControlPanel({ data }: { data: BenchmarkScorecard }) {
  const metrics = data.metrics;
  const observed = metrics?.observedCases ?? 0;
  const total = metrics?.totalCases ?? 0;
  const complete = total > 0 && observed === total;
  const blockers = data.rolloutBlockers ?? [];
  const gradeCounts = metrics?.gradeCounts ?? {};
  const providerUnavailable = metrics?.providerUnavailableCount ?? gradeCounts.U ?? 0;
  const qualityObserved = Math.max(0, observed - providerUnavailable);
  const baselineStatus = data.baselineComparison?.status ?? 'missing';
  const baselineStatusLabel = baselineStatus === 'not_compared' ? 'not compared' : baselineStatus;
  const correctCompletionDelta = data.baselineComparison?.metricDeltas?.correctCompletionRate;

  return (
    <div className="border-t border-border/40 px-3 py-2.5" aria-label="Code Agent benchmark mission control">
      <div className="flex items-center gap-2">
        <ShieldCheck className={`h-3.5 w-3.5 ${data.rolloutAllowed ? 'text-emerald-300' : 'text-amber-300'}`} />
        <span className="text-[11px] font-semibold text-foreground">Code Agent benchmark</span>
        <Link href="/mission-control" className="ml-1 text-[10px] text-primary hover:underline">
          Open Mission Control
        </Link>
        <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
          data.rolloutAllowed
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}>
          {data.rolloutAllowed ? 'rollout allowed' : 'rollout blocked'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
          <div className="text-[9px] text-muted-foreground">Coverage</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {observed}/{total} {complete ? 'complete' : 'observed'}
          </div>
          {providerUnavailable > 0 && (
            <div className="mt-0.5 text-[9px] text-amber-200/80">
              Quality evidence: {qualityObserved}/{observed}
            </div>
          )}
        </div>
        {(['A', 'B', 'C', 'D', 'F', 'U'] as const).map((grade) => (
          <div key={grade} className="rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
            <div className="text-[9px] text-muted-foreground">{grade === 'U' ? 'Provider unavailable' : `Grade ${grade}`}</div>
            <div className={`mt-0.5 text-[11px] font-medium ${
              grade === 'F' && (gradeCounts[grade] ?? 0) > 0
                ? 'text-red-300'
                : grade === 'U' && (gradeCounts[grade] ?? 0) > 0
                  ? 'text-amber-200'
                  : 'text-foreground'
            }`}>
              {gradeCounts[grade] ?? 0}
            </div>
          </div>
        ))}
      </div>
      {blockers.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100/85">
          <div className="font-semibold text-amber-200">Rollout blockers</div>
          <ul className="mt-0.5 list-disc pl-4">
            {blockers.slice(0, 3).map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/40 bg-background/20 px-2 py-1.5 text-[9px]">
        <span className="text-muted-foreground">Baseline gate</span>
        <span className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase ${
          baselineStatus === 'passed'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}>
          {baselineStatusLabel}
        </span>
        {data.baseline?.baselineId && (
          <code className="max-w-[15rem] truncate text-muted-foreground">{data.baseline.baselineId}</code>
        )}
        {typeof correctCompletionDelta === 'number' && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            Completion Δ {correctCompletionDelta >= 0 ? '+' : ''}{(correctCompletionDelta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        {data.provider ? `Provider: ${data.provider}` : 'Provider not recorded'}
        {data.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleString()}` : ''}
      </div>
    </div>
  );
}

function BenchmarkMissionControl() {
  const { data, isLoading, isError } = useQuery<BenchmarkScorecard>({
    queryKey: ['code-agent-benchmark-scorecard'],
    queryFn: async () => {
      const response = await fetch('/api/ai/benchmark/scorecard', { credentials: 'include' });
      if (!response.ok) throw new Error(`Benchmark scorecard unavailable (${response.status})`);
      return response.json() as Promise<BenchmarkScorecard>;
    },
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading || isError || !data) return null;
  return <BenchmarkMissionControlPanel data={data} />;
}

function proofStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'checking':
      return 'جارٍ التحقق من الحالة';
    case 'queued':
      return 'في قائمة الانتظار';
    case 'running':
      return 'جارٍ التنفيذ';
    case 'paused':
      return 'متوقف مؤقتًا';
    case 'failed':
      return 'توقف بأمان';
    case 'cancelling':
      return 'جارٍ الإيقاف';
    case 'cancelled':
      return 'أُلغي';
    case 'completed':
      return 'اكتمل التشغيل';
    case 'ready-to-apply':
      return 'التغييرات بانتظار الموافقة';
    case 'ready-to-commit':
      return 'التغييرات جاهزة للإيداع في Git';
    case 'ready-to-push':
      return 'التغييرات جاهزة للإرسال إلى المستودع';
    default:
      return 'جارٍ التجهيز';
  }
}

function evidenceVerdictLabel(verdict: NonNullable<AgentExecutionProofStatus['evidenceVerdict']>): string {
  switch (verdict) {
    case 'PROVEN':
      return 'الأدلة كافية';
    case 'PARTIAL':
      return 'الأدلة جزئية';
    case 'UNAVAILABLE':
      return 'الأدلة غير متاحة';
    case 'BLOCKED':
      return 'لم يثبت اكتمال الأدلة';
    case 'NOT_RECORDED':
      return 'لم تُسجّل حالة الأدلة';
    case 'CLAIM_UNCLOSED':
      return 'لم تُغلق مطالبات الإثبات المطلوبة';
  }
}

function forensicVerdictLabel(verdict: FinalForensicVerdict): string {
  switch (verdict) {
    case 'FINDING PROVEN':
      return 'النتيجة مدعومة بالأدلة';
    case 'NO FINDING':
      return 'لم يظهر دليل على خلل';
    case 'NOT PROVEN':
      return 'لم تثبت النتيجة';
    case 'INCOMPLETE':
      return 'التحليل غير مكتمل';
  }
}

function verdictScopeLabel(scope: string): string {
  switch (scope) {
    case 'PRODUCTION':
      return 'بيئة الإنتاج';
    case 'FIXTURE_LOCAL':
      return 'بيئة اختبار معزولة';
    case 'TEST_LOCAL':
      return 'بيئة الاختبار';
    case 'SPEC_LOCAL':
      return 'بيئة المواصفات';
    case 'MIXED':
      return 'نطاقات متعددة';
    case 'NOT_PROVEN':
      return 'النطاق غير مثبت';
    default:
      return 'نطاق مسجل';
  }
}

function proofStatusClasses(status: string | undefined): string {
  if (status === 'failed') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (status === 'paused' || status === 'cancelling') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'completed' || status === 'ready-to-push') return 'border-green-500/40 bg-green-500/10 text-green-200';
  if (status === 'ready-to-apply' || status === 'ready-to-commit') return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  return 'border-primary/40 bg-primary/10 text-primary';
}

function acceptanceReasonLabel(reasonCode: string): string | undefined {
  switch (reasonCode) {
    case 'EVIDENCE_INCOMPLETE':
    case 'EXECUTION_ACCEPTANCE_INCOMPLETE':
    case 'REVIEW_INCOMPLETE_EVIDENCE':
      return 'الأدلة المطلوبة غير مكتملة، لذلك لم يُقبل إثبات النتيجة.';
    case 'EXECUTION_PROVIDER_FAILURE':
    case 'PROVIDER_FAILURE':
      return 'تعذّر إكمال التشغيل بسبب مشكلة في خدمة الذكاء الاصطناعي.';
    case 'MODEL_OUTPUT_INVALID':
      return 'لم يستوفِ رد النموذج شروط الصيغة المطلوبة.';
    case 'EXECUTION_CANCELLED':
      return 'أُلغي التشغيل قبل اكتمال قبول النتيجة.';
    case 'EXECUTION_ABANDONED':
      return 'توقف التشغيل قبل اكتمال قبول النتيجة.';
    case 'EXECUTION_LEASE_EXPIRED':
      return 'انتهت مدة التشغيل قبل تسجيل قبول النتيجة.';
    case 'CAPABILITY_PROBE_FINAL':
      return 'انتهى فحص الإمكانات، لكنه لا يثبت إنجاز الهدف.';
    default:
      return undefined;
  }
}

export function AcceptanceDispositionNotice({
  disposition,
}: {
  disposition?: AcceptanceDispositionView | null;
}) {
  if (!disposition) return null;
  const reasonLabels = [...new Set(
    disposition.reasonCodes
      .slice(0, 4)
      .map(acceptanceReasonLabel)
      .filter((label): label is string => Boolean(label)),
  )];
  const followUpLabel = acceptanceFollowUpLabel(disposition.nextActionCode);
  const title = disposition.outcome === 'INTERRUPTED'
    ? 'توقف التشغيل قبل اكتمال قبول النتيجة'
    : 'لم يكتمل قبول نتيجة التشغيل';
  return (
    <div
      dir="rtl"
      lang="ar"
      className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-100"
      role="region"
      aria-label="حالة قبول التنفيذ"
    >
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-[11px]">
        <span className="font-medium">السبب المسجل:</span>
        {reasonLabels.length > 0 ? (
          <ul className="mt-0.5 list-disc space-y-0.5 pe-4">
            {reasonLabels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        ) : (
          <span className="ms-1">لا تتوفر تفاصيل موثوقة إضافية لهذا السبب.</span>
        )}
      </div>
      <div className="mt-1 text-[11px]">
        <span className="font-medium">المتابعة المسجلة:</span>{' '}
        {followUpLabel ?? 'لا توجد خطوة متابعة معروفة لهذا التشغيل.'}
      </div>
    </div>
  );
}

export function auditExportFilename(
  contentDisposition: string | null,
  fallback: string,
): string {
  const encodedFilename = contentDisposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plainFilename = contentDisposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let filename = encodedFilename
    ? (() => {
        try {
          return decodeURIComponent(encodedFilename);
        } catch {
          return undefined;
        }
      })()
    : plainFilename?.[1] ?? plainFilename?.[2]?.trim();

  filename = filename?.replace(/[/\\\r\n]/g, '_').trim();
  return filename || fallback;
}

export function auditRedactionCategoryLabel(category: unknown): string {
  if (typeof category !== 'string') return 'فئة بيانات مستبعدة';
  switch (category.trim().toLowerCase()) {
    case 'provider secrets':
      return 'أسرار مزوّد الخدمة';
    case 'raw model output':
      return 'النص الخام الذي أنشأه النموذج';
    case 'raw provider messages':
      return 'رسائل مزوّد الخدمة الخام';
    case 'private runtime paths':
      return 'مسارات بيئة التشغيل الخاصة';
    default:
      return 'فئة بيانات مستبعدة';
  }
}

export function auditExportFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim().toLowerCase() : '';
  if (message === 'no completed execution is selected.') {
    return 'لا يوجد تشغيل مكتمل محدد لتنزيل سجله.';
  }
  if (message === 'ai execution not found') {
    return 'لم يُعثر على سجل لهذا التشغيل. تحقّق من أن التشغيل ما زال متاحًا.';
  }
  if (/network|failed to fetch|connection|timeout/.test(message)) {
    return 'تعذّر الاتصال لتنزيل سجل التدقيق. تحقّق من الاتصال ثم أعد المحاولة.';
  }
  return 'تعذّر تنزيل سجل التدقيق. تحقّق من إمكانية الوصول إلى التشغيل ثم أعد المحاولة.';
}

export function historicalAuditStatusLabel(status: unknown): string {
  switch (status) {
    case 'cancelled':
      return 'ملغى';
    case 'failed':
      return 'غير مكتمل';
    case 'paused':
      return 'متوقف مؤقتًا';
    default:
      return 'حالة غير معروفة';
  }
}

export function historicalAuditDispositionLabel(disposition: unknown): string {
  switch (disposition) {
    case 'NEW_RUN_RECOMMENDED':
      return 'يُنصح ببدء تشغيل جديد';
    case 'RETAIN_FOR_REVIEW':
      return 'محفوظ للمراجعة';
    default:
      return 'إجراء متابعة غير معروف';
  }
}

export type AuditPreview = ExportAiExecutionAudit200;

export function AgentExecutionProofPanel({
  execution,
  recoveryView,
  terminalProjection,
  executionId,
  executionNodes,
  busy,
  stage,
  elapsedSeconds,
  steps,
  modelHistory,
  pendingChanges,
  commitReadyPaths,
  pushReady,
  evidenceIntegrity,
  persistedEvidenceFiles,
  isFixtureLocal,
  verdictScope,
  onCancel,
  onProjectionAction,
  onExport,
  onPreview,
  exportPending,
  previewPending,
  auditPreview,
  auditPreviewError,
  onRetryPreview,
  onClosePreview,
  controlPending,
  forensicVerdict,
}: {
  execution?: AgentExecutionProofStatus | null;
  recoveryView?: ExecutionRecoveryView;
  terminalProjection?: AiTerminalProjection | null;
  executionId?: string;
  executionNodes: AiExecutionNodeSnapshot[];
  busy: boolean;
  stage: string | null;
  elapsedSeconds: number;
  steps: LiveAgentToolStep[];
  modelHistory: Array<{ id: string; provider: string }>;
  pendingChanges: PendingChange[];
  commitReadyPaths: string[];
  pushReady: boolean;
  evidenceIntegrity: {
    consistent: boolean;
    violations: string[];
    objectiveType?: string;
    requiredEdges?: string[];
    provenEdges?: string[];
    completionGateResult?: string;
    finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
    objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
  } | null;
  persistedEvidenceFiles?: string[];
  isFixtureLocal: boolean;
  verdictScope?: {
    scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
    findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
  } | null;
  onCancel?: () => void;
  onProjectionAction?: (action: AiExecutionProjection['allowedActions'][number]) => Promise<void> | void;
  onExport?: () => void;
  onPreview?: () => void;
  exportPending?: boolean;
  previewPending?: boolean;
  auditPreview?: AuditPreview | null;
  auditPreviewError?: string | null;
  onRetryPreview?: () => void;
  onClosePreview?: () => void;
  controlPending?: boolean;
  forensicVerdict?: FinalForensicVerdict | null;
}) {
  const persistedStatus = execution?.status;
  const projectedTerminal = execution?.terminalProjection ?? terminalProjection;
  const proofPresentation = resolveExecutionProofPresentation(execution);
  const flightState = proofPresentation.flightState;
  const evidenceVerdict = proofPresentation.evidenceVerdict;
  const status = busy
    ? persistedStatus ?? 'running'
    : persistedStatus ??
      (executionId
        ? 'checking'
        : pushReady
        ? 'ready-to-push'
        : commitReadyPaths.length > 0
          ? 'ready-to-commit'
          : pendingChanges.length > 0
            ? 'ready-to-apply'
            : undefined);
  if (!status) return null;

  const checkpointStage = execution?.checkpoint && typeof execution.checkpoint.stage === 'string'
    ? execution.checkpoint.stage
    : null;
  const missionNodes = executionNodes.length > 0
    ? executionNodes
    : checkpointExecutionNodes(execution?.checkpoint);
  const phase = stage ?? checkpointStage ?? (
    status === 'ready-to-apply'
      ? 'Verified changes are waiting for approval'
      : status === 'ready-to-commit'
        ? 'Verified changes are ready for Git commit'
        : status === 'ready-to-push'
          ? 'Committed changes are ready to push'
          : 'Execution status is being confirmed'
  );
  const completedTools = steps.filter((step) => step.done).length;
  const liveReadSources = new Set(
    steps
      .filter((step) => step.done && (step.tool === 'read_file' || step.tool === 'read_file_range') && step.source)
      .map((step) => step.source),
  ).size;
  const persistedReadCount = persistedEvidenceFiles?.length ?? 0;
  const readSources = Math.max(liveReadSources, persistedReadCount);
  const evidenceLabel = evidenceIntegrity
    ? evidenceIntegrity.consistent
      ? 'Telemetry consistent'
      : `${evidenceIntegrity.violations.length || 1} evidence violation${evidenceIntegrity.violations.length === 1 ? '' : 's'}`
    : readSources > 0
      ? `${readSources} source file${readSources === 1 ? '' : 's'} read`
      : isFixtureLocal
        ? 'Fixture-local only'
        : 'Evidence pending';
  const deliveryLabel = pushReady
    ? 'Push is available'
    : commitReadyPaths.length > 0
      ? `${commitReadyPaths.length} file${commitReadyPaths.length === 1 ? '' : 's'} ready to commit`
      : pendingChanges.length > 0
        ? `${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'} awaiting approval`
        : 'No writes applied automatically';
  const scopeLabel = verdictScope?.scope ?? (isFixtureLocal ? 'FIXTURE_LOCAL' : undefined);
  const proofBlocked = execution?.proofRequired === true
    && evidenceVerdict !== 'PROVEN'
    && status === 'completed';
  const forensicIncomplete = forensicVerdict === 'INCOMPLETE'
    || (execution?.proofRequired === true && evidenceVerdict !== 'PROVEN');
  const objectiveLabel = execution?.objective && typeof execution.objective === 'object'
    ? String(
        execution.objective.objective
        ?? execution.objective.description
        ?? execution.objective.objectiveType
        ?? 'Declared engineering objective',
      )
    : 'No objective was retained for this execution.';
  const requiredEdges = evidenceIntegrity?.requiredEdges ?? [];
  const provenEdges = evidenceIntegrity?.provenEdges ?? [];
  const riskLabel = pendingChanges.some((change) => change.risk === 'high')
    ? 'High risk change present'
    : pendingChanges.some((change) => change.risk === 'medium')
      ? 'Medium risk change present'
      : pendingChanges.length > 0
        ? 'Low risk change set'
        : evidenceIntegrity?.consistent === false
          ? 'Evidence integrity risk'
          : 'No unresolved patch risk recorded';
  const canCancel = Boolean(onCancel && (status === 'running' || status === 'queued' || status === 'cancelling'));
  const canExport = Boolean(
    executionId
      && onExport
      && (status === 'completed' || status === 'cancelled'),
  );
  const isCancelledAudit = status === 'cancelled';
  const isIncompleteAudit = isCancelledAudit
    || status === 'failed'
    || (execution?.proofRequired === true && evidenceVerdict !== 'PROVEN');
  const needsNewAuditRun = isIncompleteAudit
    && evidenceVerdict !== 'PROVEN';
  const hasRetainedAudit = Boolean(isCancelledAudit && executionId && canExport);

  return (
    <div
      id="region-agent-execution-proof"
      tabIndex={-1}
      role="region"
      className={`mx-auto mb-3 w-full max-w-3xl overflow-hidden rounded-xl border ${
        status === 'failed'
          ? 'border-red-500/30 bg-red-500/5'
          : isFixtureLocal
            ? 'border-violet-500/30 bg-violet-500/5'
            : 'border-primary/20 bg-primary/5'
      }`}
      aria-label="إثبات التنفيذ وحالته"
    >
      <div dir="rtl" lang="ar" className="flex flex-wrap items-start gap-2 border-b border-border/40 px-3 py-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/40">
           {status === 'failed' || proofBlocked || forensicIncomplete
            ? <ShieldAlert className="h-3.5 w-3.5 text-red-300" />
            : status === 'completed' || status.startsWith('ready-')
              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-300" />
              : <Activity className="h-3.5 w-3.5 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">حالة التنفيذ والإثبات</span>
             <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
               flightState ? flightDeckStateClasses(flightState) : proofStatusClasses(status)
             }`}>
               {flightState ? flightDeckStateLabel(flightState) : proofStatusLabel(status)}
            </span>
              {evidenceVerdict && (
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${flightDeckEvidenceClasses(evidenceVerdict)}`}>
                   حالة الأدلة: {evidenceVerdictLabel(evidenceVerdict)}
               </span>
             )}
             {forensicVerdict && (
               <span
                 className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                   forensicVerdict === 'INCOMPLETE'
                     ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                     : forensicVerdict === 'FINDING PROVEN'
                       ? 'border-green-500/40 bg-green-500/10 text-green-200'
                       : 'border-border/60 bg-background/30 text-muted-foreground'
                 }`}
               >
                  نتيجة فحص المشروع: {forensicVerdictLabel(forensicVerdict)}
               </span>
             )}
            {scopeLabel && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                scopeLabel === 'PRODUCTION' || scopeLabel === 'MIXED'
                  ? 'border-green-500/40 bg-green-500/10 text-green-200'
                  : 'border-violet-500/40 bg-violet-500/10 text-violet-200'
              }`}>
                {verdictScopeLabel(scopeLabel)}
              </span>
            )}
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {busy ? `${formatElapsed(elapsedSeconds)} منقضٍ` : 'سجل التنفيذ محفوظ'}
            </span>
            {canExport || canCancel ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {canExport && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onPreview}
                      disabled={controlPending || exportPending || previewPending}
                      aria-busy={previewPending}
                      title="معاينة سجل التدقيق بعد إخفاء البيانات الحساسة"
                    >
                      {previewPending
                        ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                        : <Eye className="me-1.5 h-3.5 w-3.5" />}
                      {previewPending ? 'جارٍ التحميل…' : 'معاينة سجل التدقيق'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onExport}
                      disabled={controlPending || exportPending || previewPending}
                      aria-busy={exportPending}
                      title="تنزيل سجل التدقيق بعد إخفاء البيانات الحساسة"
                    >
                      {exportPending
                        ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                        : <Download className="me-1.5 h-3.5 w-3.5" />}
                      {exportPending ? 'جارٍ التنزيل…' : 'تنزيل سجل التدقيق'}
                    </Button>
                  </>
                )}
                {canCancel && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onCancel}
                    disabled={controlPending || status === 'cancelling'}
                    className="h-6 border-red-500/40 px-2 text-[10px] text-red-200 hover:bg-red-500/10"
                  >
                    <Square className="me-1 h-3 w-3" />
                    {status === 'cancelling' ? 'جارٍ إيقاف التشغيل…' : 'إلغاء التشغيل'}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground"><bdi dir="auto">{phase}</bdi></p>
          {recoveryView && (
            <p className="mt-1 text-[10px] font-medium text-foreground" data-testid="text-execution-recovery-state">
              {recoveryView.title} · {recoveryView.nextStep}
            </p>
          )}
          <p
            className="mt-2 rounded-md border border-border/40 bg-background/20 px-2.5 py-2 text-[10px] leading-4 text-muted-foreground"
            role="note"
            data-testid="text-execution-lifecycle-distinction"
          >
            <span className="font-semibold text-foreground">حالات منفصلة:</span>{' '}
            اكتمال التشغيل لا يعني قبول الإثبات، وقبول الإثبات لا يوافق على تسليم التغييرات.
            تحقّق من كل حالة على حدة.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>المرحلة: <strong className="font-medium text-foreground/80"><bdi dir="auto">{checkpointStage ?? phase}</bdi></strong></span>
            <span>المحاولة: <strong className="font-medium text-foreground/80">{execution?.attempt ?? 0}</strong></span>
            <span>العملية: <code dir="ltr" className="text-foreground/80">{execution?.operationId ?? 'غير مسجل'}</code></span>
            <span>نسخة المشروع: <code dir="ltr" className="text-foreground/80">{execution?.projectRevision ?? 'غير مسجلة'}</code></span>
          </div>
          {(execution?.id ?? executionId) && (
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 truncate text-[9px] text-muted-foreground">
                معرّف التشغيل: <bdi dir="ltr">{execution?.id ?? executionId}</bdi>
              </code>
              <Link
                href={`/flight-deck?executionId=${encodeURIComponent(execution?.id ?? executionId ?? '')}`}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/30 px-1.5 py-0.5 text-[9px] text-primary hover:bg-primary/10"
                aria-label="فتح التشغيل في Flight Deck"
              >
                Flight Deck <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          )}
          {execution?.error && (
            <p className="mt-1 break-words text-[10px] leading-4 text-red-200">{execution.error}</p>
          )}
          {execution?.terminalReason && (
            <p className="mt-1 break-words text-[10px] leading-4 text-amber-200">
              سبب التوقف: <bdi dir="auto">{execution.terminalReason}</bdi>
            </p>
          )}
          {projectedTerminal && (
            <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
              الحالة النهائية: المحاولة {projectedTerminal.attempt}
              {' · '}
              {projectedTerminal.outcome.replace('_', ' ')}
              {' · '}
              {projectedTerminal.resumable ? 'يمكن استئنافها' : 'لا يمكن استئنافها'}
            </p>
          )}
          {execution?.evidenceReason && (
            <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground"><bdi dir="auto">{execution.evidenceReason}</bdi></p>
          )}
          <AcceptanceDispositionNotice disposition={execution?.acceptanceDisposition} />
        </div>
      </div>

      <MissionCapsule
        projection={execution?.projection}
        executionId={execution?.id ?? executionId}
        operationId={execution?.operationId}
        taskId={execution?.linkedTaskId}
        proposalId={execution?.projection?.approval?.proposalId}
        executionStatus={execution?.status}
        flightState={flightState}
        evidenceVerdict={evidenceVerdict}
        resumable={execution?.resumable}
        nextAction={execution?.evidenceReason ?? execution?.acceptanceDisposition?.operatorAction}
        onAction={onProjectionAction}
        recoveryView={recoveryView}
        readOnly={!onProjectionAction}
        hideRecoveryActions
        timelineOpenByDefault={execution?.projection?.kind === 'DELIVERY'}
        compact
      />

      {(auditPreview || auditPreviewError) && (
        <div
          className="border-b border-border/40 bg-background/30 px-3 py-3"
          aria-label="معاينة سجل التدقيق بعد إخفاء البيانات الحساسة"
        >
          {auditPreviewError ? (
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-foreground">تعذّرت معاينة سجل التدقيق مؤقتًا</div>
                <p dir="rtl" lang="ar" className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  ما زال سجل التدقيق المنقّح متاحًا للتنزيل. تحقّق من الاتصال ثم أعد محاولة المعاينة للتشغيل ونسخة المشروع نفسيهما.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRetryPreview}
                    disabled={previewPending}
                    aria-busy={previewPending}
                  >
                    {previewPending && <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />}
                    {previewPending ? 'جارٍ إعادة المحاولة…' : 'إعادة محاولة المعاينة'}
                  </Button>
                  <button
                    type="button"
                    onClick={onClosePreview}
                    className="rounded p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    aria-label="إغلاق معاينة سجل التدقيق"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ) : auditPreview && (
          <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <Eye className="h-3.5 w-3.5 text-primary" />
                معاينة سجل التدقيق المنقّح
              </div>
              <p dir="rtl" lang="ar" className="mt-1 text-[10px] leading-4 text-muted-foreground">
                هذه هي البيانات المنقّحة نفسها التي ستُنزل. الفئات المستبعدة لحماية الخصوصية:
              </p>
            </div>
            <button
              type="button"
              onClick={onClosePreview}
              className="rounded p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
              aria-label="إغلاق معاينة سجل التدقيق"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {((auditPreview.redaction?.excluded ?? []) as unknown[]).map((category) => (
              <span
                key={String(category)}
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-100"
              >
                {auditRedactionCategoryLabel(category)}
              </span>
            ))}
          </div>
          <p dir="rtl" lang="ar" className="mt-2 text-[9px] leading-4 text-muted-foreground">
            يعرض مربع JSON سجل الخادم بصيغته الأصلية للتدقيق؛ وتُشرح فئات الإخفاء بالعربية أعلاه.
          </p>
          <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-lg border border-border/50 bg-background/70 p-2.5 text-start text-[9px] leading-4 text-foreground/80">
            {JSON.stringify(auditPreview, null, 2)}
          </pre>
          </>
          )}
        </div>
      )}

      {isIncompleteAudit && (
        <div
          className={`border-b border-border/40 px-3 py-2.5 ${
            needsNewAuditRun ? 'bg-amber-500/5' : 'bg-emerald-500/5'
          }`}
          aria-label="Audit operator disposition"
        >
          <div className="flex items-start gap-2">
            {needsNewAuditRun
              ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
            <div className="min-w-0">
              <div className={`text-xs font-semibold ${
                needsNewAuditRun ? 'text-amber-200' : 'text-emerald-200'
              }`}>
                {hasRetainedAudit
                  ? 'Cancelled audit retained safely'
                  : 'Audit needs operator attention'}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {hasRetainedAudit
                  ? needsNewAuditRun
                    ? 'Collected evidence and the redacted audit are available for review, but cancellation leaves the audit incomplete. Start a new run before relying on a complete finding.'
                    : 'Collected evidence is retained and the redacted audit is available for review.'
                  : 'This audit does not have complete proof. Start a new run before relying on its result.'}
              </div>
              {execution?.evidenceReason && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Evidence note: {execution.evidenceReason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {evidenceIntegrity?.consistent === false && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200"
          role="alert" data-testid="alert-execution-evidence-integrity">
          Evidence integrity needs attention: {evidenceIntegrity.violations.length || 1} violation
          {evidenceIntegrity.violations.length === 1 ? '' : 's'} recorded. Review the proof before relying on this result.
        </div>
      )}
      {evidenceIntegrity?.completionGateResult && (
        <div className="border-b border-border/40 px-3 py-2 text-[11px] text-foreground"
          data-testid="status-objective-completion">
          Objective completion: <strong>{evidenceIntegrity.completionGateResult.replace(/_/g, ' ')}</strong>
        </div>
      )}
      <details className="border-t border-border/40" data-testid="details-execution-proof-technical">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-medium text-foreground hover:bg-background/30">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Execution and proof details
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {readSources} source {readSources === 1 ? 'file' : 'files'} · {missionNodes.length} nodes
          </span>
        </summary>
      <div className="grid grid-cols-2 gap-px bg-border/30 sm:grid-cols-4">
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Evidence record</div>
          <div className={`mt-0.5 text-[11px] font-medium ${
            evidenceIntegrity?.consistent ? 'text-green-300' : isFixtureLocal ? 'text-violet-200' : 'text-foreground'
          }`}>
            {evidenceLabel}
          </div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Agent work</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {completedTools > 0 || steps.length > 0
              ? `${completedTools}/${steps.length} tools`
              : readSources > 0
                ? `${readSources} source ${readSources === 1 ? 'read' : 'reads'} recorded`
                : 'No tool activity recorded'}
            {modelHistory.length > 0 ? ` · ${modelHistory.length} model${modelHistory.length === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Delivery status</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">{deliveryLabel}</div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Safety</div>
          <div className={`mt-0.5 text-[11px] font-medium ${
            status === 'failed' || evidenceIntegrity?.consistent === false
              ? 'text-red-300'
              : pendingChanges.length > 0 || status.startsWith('ready-')
                ? 'text-amber-200'
                : 'text-green-300'
          }`}>
            {status === 'failed'
              ? 'No automatic writes'
              : pendingChanges.length > 0
                ? 'Approval required'
                : 'Writes gated'}
          </div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-border/40 px-3 py-2.5 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground">Objective</div>
          <div className="mt-0.5 break-words text-[11px] font-medium text-foreground">{objectiveLabel}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Scope</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {missionNodes.reduce((total, node) => total + node.allowedFiles.length, 0)} files · {missionNodes.length} nodes
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Risk</div>
          <div className={`mt-0.5 text-[11px] font-medium ${riskLabel.startsWith('High') || riskLabel.startsWith('Evidence') ? 'text-red-200' : 'text-amber-200'}`}>{riskLabel}</div>
        </div>
      </div>
      {evidenceIntegrity && (
        evidenceIntegrity.objectiveType ||
        evidenceIntegrity.completionGateResult ||
        evidenceIntegrity.finalAnswerType ||
        requiredEdges.length > 0 ||
        provenEdges.length > 0
      ) && (
        <div className="border-t border-border/40 px-3 py-2.5" aria-label="Objective proof details">
          <div className="text-[10px] font-semibold text-primary">Objective proof</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            <div>
              <div className="text-[10px] text-muted-foreground">Completion</div>
              <div className="font-semibold text-foreground">{evidenceIntegrity.completionGateResult ?? 'Not declared'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Required edges</div>
              <div className="font-semibold text-foreground">{requiredEdges.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Proven edges</div>
              <div className="font-semibold text-green-300">{provenEdges.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Final answer</div>
              <div className="break-words font-semibold text-foreground">
                {evidenceIntegrity.finalAnswerType
                  ? evidenceIntegrity.finalAnswerType.replace(/_ANSWER$/, '').replace(/_/g, ' ')
                  : 'Not recorded'}
              </div>
            </div>
          </div>
          {evidenceIntegrity.objectiveType && (
            <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
              Objective type: <span className="font-semibold text-foreground">{evidenceIntegrity.objectiveType}</span>
            </div>
          )}
          {requiredEdges.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
              <div className="text-[10px] text-muted-foreground">Edge proof ledger</div>
              {requiredEdges.map((edge) => (
                <div key={edge} className="font-mono text-[10px] text-foreground/80">
                  <span className={provenEdges.includes(edge) ? 'text-green-300' : 'text-amber-200'}>
                    {provenEdges.includes(edge) ? '✓' : '○'}
                  </span>{' '}
                  {edge}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(execution?.checkpointVersion !== undefined || execution?.resumable || evidenceIntegrity?.violations.length) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
          {execution?.checkpointVersion !== undefined && (
            <span>checkpoint v{execution.checkpointVersion}</span>
          )}
          {execution?.resumable && <span className="text-amber-200">resume available</span>}
          {evidenceIntegrity && !evidenceIntegrity.consistent && (
            <span className="text-red-200">Evidence gate blocked unsupported claims</span>
          )}
        </div>
      )}
      </details>
      <ExecutionMissionControl nodes={missionNodes} />
      <BenchmarkMissionControl />
    </div>
  );
}
