import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GitCompareArrows,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Square,
  Wrench,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetTaskLogsQueryKey,
  getGetTaskQueryKey,
  getListTasksQueryKey,
} from '@workspace/api-client-react';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { getExecutionPresentation } from './mission-state';
import { ResultDetailsSummary } from './ResultDetailsSummary';
import type { ExecutionRecoveryView } from '@/lib/execution-recovery-view';

export type ProjectionAction = AiExecutionProjection['allowedActions'][number];

type ReviewDiff = {
  path: string;
  originalContent: string | null;
  newContent: string | null;
  truncated: boolean;
};

export type ExecutionProjectionPanelProps = {
  projection?: AiExecutionProjection | null;
  executionId?: string | null;
  executionStatus?: string | null;
  flightState?: string | null;
  evidenceVerdict?: string | null;
  resumable?: boolean | null;
  nextAction?: string | null;
  compact?: boolean;
  timelineOpenByDefault?: boolean;
  onAction?: (action: ProjectionAction) => Promise<void> | void;
  /**
   * Kept for callers that still pass the task identity while surfaces migrate
   * to the shared capsule. The capsule uses it only for identity and recovery
   * routing; the owning surface still controls execution actions.
   */
  taskId?: string | null;
  /**
   * Only the Task surface may enable recovery after matching this execution
   * to the Task's current correlation identity.
   */
  allowTaskRecovery?: boolean;
    /** Actual Mission identity only; never infer it from operation or execution IDs. */
  missionId?: string | null;
  operationId?: string | null;
  proposalId?: string | null;
  /** AI chat supplies its server-scoped recovery presentation to every surface. */
  recoveryView?: ExecutionRecoveryView;
  readOnly?: boolean;
  hideRecoveryActions?: boolean;
};

const actionLabels: Record<ProjectionAction, string> = {
  CANCEL: 'إيقاف التنفيذ',
  RESUME_CHECKPOINT: 'استئناف من نقطة الحفظ',
  RETRY_CHECKPOINT: 'إعادة المحاولة من نقطة الحفظ',
  START_NEW_RUN: 'بدء تنفيذ جديد',
  REVIEW_PROOF: 'مراجعة الأدلة المسجلة',
  REVIEW_DIFF: 'مراجعة التغييرات',
  APPROVE_CHANGES: 'الموافقة على التغييرات',
};

function actionLabel(action: ProjectionAction, taskId?: string | null): string {
  if (taskId && action === 'RESUME_CHECKPOINT') return 'استئناف المهمة';
  if (taskId && action === 'RETRY_CHECKPOINT') return 'إعادة محاولة المهمة';
  return actionLabels[action];
}

const actionOrder: ProjectionAction[] = [
  'APPROVE_CHANGES',
  'RESUME_CHECKPOINT',
  'RETRY_CHECKPOINT',
  'CANCEL',
  'REVIEW_DIFF',
  'REVIEW_PROOF',
  'START_NEW_RUN',
];

// Presentation only: unknown server values remain visible, never imply success.
const recordedLabels: Record<string, string> = {
  DELIVERY: 'تسليم تغيير', ANALYSIS: 'تحليل', CHAT: 'محادثة', INTAKE: 'استقبال الطلب',
  DISCOVER: 'استكشاف', READ: 'قراءة', PLAN: 'تخطيط', BUILD: 'إعداد التغيير',
  VALIDATE: 'تحقق', REPAIR: 'معالجة', COMPLETE: 'انتهاء مسجل',
  QUEUED: 'في الانتظار', PENDING: 'لم يبدأ بعد', RUNNING: 'جارٍ',
  ACTIVE: 'نشط', STARTED: 'بدأ', COMPLETED: 'انتهى بحسب السجل',
  FAILED: 'لم ينجح', BLOCKED: 'توجد عقبة', PAUSED: 'متوقف مؤقتًا',
  CANCELLED: 'أُلغي', CANCELLING: 'جارٍ الإلغاء', INTERRUPTED: 'منقطع',
  PASSED: 'اجتياز مسجل', UNAVAILABLE: 'غير متاح', NOT_RECORDED: 'غير مسجل',
  NOT_REQUIRED: 'غير مطلوب', PROVEN: 'مثبت بحسب السجل', PARTIAL: 'جزئي',
  UNPROVEN: 'غير مثبت', APPROVED: 'موافقة مسجلة', SUCCEEDED: 'نجاح مسجل',
  APPLIED: 'سُجّل التطبيق', COMMITTED: 'حُفظ في سجل الإصدارات',
  PUSHED: 'سُجّل الإرسال', READY_FOR_REVIEW: 'جاهز للمراجعة',
  VALIDATING: 'جارٍ التحقق', BUILDING: 'جارٍ إعداد التغيير', REPAIRING: 'جارٍ المعالجة',
  NOT_APPLICABLE: 'لا ينطبق',
};

function titleCase(value: unknown, fallback = 'غير مسجل'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const label = recordedLabels[value.toUpperCase()];
  if (label) return label;
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateTone(value: unknown): string {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (['FAILED', 'BLOCKED', 'UNAVAILABLE', 'NEEDS_ATTENTION'].includes(normalized)) {
    return 'border-red-500/35 bg-red-500/10 text-red-200';
  }
  if (['INTERRUPTED', 'CANCELLED', 'PENDING', 'PARTIAL', 'INCOMPLETE', 'AWAITING_APPROVAL'].includes(normalized)) {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  }
  if (['PASSED', 'PROVEN', 'VERIFIED', 'APPROVED', 'SUCCEEDED', 'DELIVERED', 'COMPLETE', 'READY_FOR_REVIEW'].includes(normalized)) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  if (['BUILDING', 'VALIDATING', 'DELIVERING', 'INVESTIGATING', 'PLANNING', 'UNDERSTANDING'].includes(normalized)) {
    return 'border-primary/35 bg-primary/10 text-primary';
  }
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function verificationTone(status: unknown): string {
  if (status === 'passed') return 'text-emerald-200';
  if (status === 'failed' || status === 'unavailable') return 'text-red-200';
  if (status === 'running') return 'text-sky-200';
  return 'text-amber-200';
}

function verificationSummary(
  status: AiExecutionProjection['verification']['status'] | undefined,
  proofRequired: boolean | undefined,
): string {
  switch (status) {
    case 'passed':
      return proofRequired
        ? 'سُجّل اجتياز التحقق؛ هذا لا يثبت اكتمال الإثبات المطلوب أو قبول النتيجة.'
        : 'سُجّل اجتياز التحقق لهذا التنفيذ، وليس قبولًا حديثًا للنتيجة.';
    case 'failed':
      return 'لم يجتز تحقق الخادم. راجع الأدلة المسجلة قبل المتابعة.';
    case 'unavailable':
      return 'التحقق الكامل من الخادم غير متاح لهذا التنفيذ.';
    case 'running':
      return 'ما زال الخادم يجمع نتائج التحقق أو الأدلة لهذا التنفيذ.';
    default:
      return proofRequired
        ? 'لا يُستنتج القبول هنا؛ الإثبات المطلوب من الخادم لا يظهر مكتملًا.'
        : 'لم تُسجّل حالة تحقق في هذا العرض بعد.';
  }
}

function reviewLines(originalContent: string | null, newContent: string | null): string[] {
  const before = (originalContent ?? '').split(/\r?\n/);
  const after = (newContent ?? '').split(/\r?\n/);
  const longest = Math.max(before.length, after.length);
  const lines: string[] = [];
  for (let index = 0; index < longest; index += 1) {
    if (before[index] === after[index]) {
      if (before[index] !== undefined) lines.push(`  ${before[index]}`);
      continue;
    }
    if (before[index] !== undefined) lines.push(`- ${before[index]}`);
    if (after[index] !== undefined) lines.push(`+ ${after[index]}`);
  }
  return lines.slice(0, 600);
}

function stepIcon(status: string | undefined) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-200" />;
  if (status === 'active') return <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />;
  if (status === 'failed' || status === 'blocked') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-200" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function timelineIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-200" />;
  if (status === 'active') return <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />;
  if (status === 'blocked') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-200" />;
  if (status === 'not_applicable') return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function timelineStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'انتهت';
    case 'active': return 'الآن';
    case 'blocked': return 'متعطلة';
    case 'not_applicable': return 'غير مطلوبة';
    default: return 'لاحقًا';
  }
}

function timelineLabel(id: string, fallback: string): string {
  const labels: Record<string, string> = {
    understand: 'فهم الطلب', investigate: 'فحص المشروع', plan: 'إعداد الخطة',
    approval: 'الموافقة المطلوبة', build: 'إعداد التغيير', validate: 'التحقق',
    review: 'مراجعة التغييرات', apply: 'تطبيق التغيير', commit: 'حفظ الإصدار',
    push: 'إرسال الإصدار', deliver: 'التسليم',
  };
  return labels[id] ?? fallback;
}

function actionIcon(action: ProjectionAction) {
  if (action === 'CANCEL') return <Square className="me-1.5 h-3.5 w-3.5" />;
  if (action === 'REVIEW_DIFF') return <GitCompareArrows className="me-1.5 h-3.5 w-3.5" />;
  if (action === 'REVIEW_PROOF') return <ShieldCheck className="me-1.5 h-3.5 w-3.5" />;
  return <RotateCcw className="me-1.5 h-3.5 w-3.5" />;
}

export function ExecutionProjectionPanel({
  projection,
  executionId,
  executionStatus,
  flightState,
  evidenceVerdict,
  resumable,
  nextAction,
  compact = false,
  onAction,
  taskId,
  allowTaskRecovery = false,
  missionId,
  operationId,
  proposalId,
  recoveryView,
  readOnly = false,
  hideRecoveryActions = false,
  timelineOpenByDefault = false,
}: ExecutionProjectionPanelProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ProjectionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ReviewDiff[] | null>(null);

  if (!projection) return null;

  const progress = projection.progress;
  const planSteps = projection.plan?.steps ?? [];
  const recentTools = projection.tools?.recent ?? [];
  const changedFiles = projection.workspace?.changedFiles ?? [];
  const allowedActions = projection.allowedActions ?? [];
  const orderedActions = allowedActions.filter((action) => {
    if (readOnly && action !== 'REVIEW_PROOF' && action !== 'REVIEW_DIFF') return false;
    if (
      (hideRecoveryActions || (taskId && !allowTaskRecovery))
      && (action === 'RESUME_CHECKPOINT' || action === 'RETRY_CHECKPOINT')
    ) return false;
    if (recoveryView && (action === 'RESUME_CHECKPOINT' || action === 'RETRY_CHECKPOINT')) {
      return action === (recoveryView.action === 'retry' ? 'RETRY_CHECKPOINT'
        : recoveryView.action === 'resume' ? 'RESUME_CHECKPOINT' : null);
    }
    return true;
  }).sort(
    (left, right) => actionOrder.indexOf(left) - actionOrder.indexOf(right),
  );
  const verdict = evidenceVerdict ?? projection.verification?.evidenceVerdict;
  const missionState = getExecutionPresentation({
    projection,
    executionStatus,
    flightState,
    evidenceVerdict,
    resumable,
    nextAction,
  });
  const percent = typeof progress?.percent === 'number' ? Math.max(0, Math.min(100, progress.percent)) : null;
  const approvalPending = projection.approval?.required && projection.approval.status === 'PENDING';
  const isStopped = Boolean(projection.stopped?.outcome);
  const resolvedMissionId = missionId?.trim() || null;
  const resolvedProposalId = proposalId ?? projection.approval?.proposalId;
  const recoveryAction = recoveryView?.action === 'retry' ? 'RETRY_CHECKPOINT'
    : recoveryView?.action === 'resume' ? 'RESUME_CHECKPOINT' : null;
  const recoveryState = readOnly || executionStatus === 'paused' || executionStatus === 'failed';
  const primaryAction = recoveryState && recoveryView && hideRecoveryActions
    ? null
    : recoveryAction && orderedActions.includes(recoveryAction)
    ? recoveryAction
    : missionState.primaryAction && orderedActions.includes(missionState.primaryAction)
      ? missionState.primaryAction
      : null;
  const secondaryActions = orderedActions.filter((action) => action !== primaryAction);

  async function loadDiff(): Promise<void> {
    if (!executionId) {
      setDiffError('معرّف التنفيذ غير متاح لهذه المراجعة.');
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    try {
      const response = await fetch(`/api/ai/executions/${encodeURIComponent(executionId)}/diff`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({})) as {
        changes?: ReviewDiff[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || 'تعذر تحميل فروق التغييرات للمراجعة.');
      setDiff(Array.isArray(body.changes) ? body.changes : []);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : 'تعذر تحميل فروق التغييرات للمراجعة.');
    } finally {
      setDiffLoading(false);
    }
  }

  async function runAction(action: ProjectionAction): Promise<void> {
    if (!orderedActions.includes(action)) return;
    if (action === 'REVIEW_DIFF') {
      await loadDiff();
      return;
    }
    if (action === 'REVIEW_PROOF') {
      setProofOpen(true);
      return;
    }
    if (!executionId) {
      setActionError('معرّف التنفيذ غير متاح لهذا الإجراء.');
      return;
    }
    setPendingAction(action);
    setActionError(null);
    try {
      const taskRecoveryAction = Boolean(taskId)
        && (action === 'RETRY_CHECKPOINT' || action === 'RESUME_CHECKPOINT');
      if (onAction && !taskRecoveryAction) {
        await onAction(action);
      } else {
        let endpoint = `/api/ai/executions/${encodeURIComponent(executionId)}/cancel`;
        let body: Record<string, string> | undefined;
        if (action === 'RETRY_CHECKPOINT') {
          endpoint = taskId
            ? `/api/tasks/${encodeURIComponent(taskId)}/retry`
            : `/api/ai/executions/${encodeURIComponent(executionId)}/retry-capability`;
        } else if (action === 'RESUME_CHECKPOINT') {
          endpoint = taskId
            ? `/api/ai/tasks/${encodeURIComponent(taskId)}/resume`
            : `/api/ai/executions/${encodeURIComponent(executionId)}/recovery`;
          body = taskId ? undefined : { action: 'resume' };
        } else if (action === 'APPROVE_CHANGES') {
          endpoint = `/api/ai/executions/${encodeURIComponent(executionId)}/approve`;
        } else if (action !== 'CANCEL') {
          throw new Error('يجب إتمام هذا الإجراء من صفحة التنفيذ المسؤولة عنه.');
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const responseBody = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(responseBody.error || 'رفض الخادم إجراء التنفيذ.');
      }
      if (taskId && (action === 'RETRY_CHECKPOINT' || action === 'RESUME_CHECKPOINT')) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) }),
          queryClient.invalidateQueries({ queryKey: getGetTaskLogsQueryKey(taskId) }),
        ]);
      }
      await queryClient.invalidateQueries({ queryKey: [`/api/ai/executions/${executionId}`] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'رفض الخادم إجراء التنفيذ.');
    } finally {
      setPendingAction(null);
    }
  }

  const hasTechnicalIdentityDetails = Boolean(
    resolvedMissionId || executionId || operationId || taskId || resolvedProposalId,
  );
  const technicalIdentityContent = (
    <>
      {hasTechnicalIdentityDetails && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" data-testid="execution-identities">
          {resolvedMissionId && (
            <span>
              <span className="font-semibold text-primary">الهدف الرئيسي</span>{' '}
              <code dir="ltr" className="inline-block max-w-full break-all text-foreground" title={resolvedMissionId}>{resolvedMissionId}</code>
            </span>
          )}
          {executionId && executionId !== resolvedMissionId && <span>التنفيذ <code dir="ltr" className="inline-block max-w-full break-all text-foreground">{executionId}</code></span>}
          {operationId && operationId !== resolvedMissionId && <span>العملية <code dir="ltr" className="inline-block max-w-full break-all text-foreground">{operationId}</code></span>}
          {taskId && <span>المهمة <code dir="ltr" className="inline-block max-w-full break-all text-foreground">{taskId}</code></span>}
          {resolvedProposalId && <span>المقترح <code dir="ltr" className="inline-block max-w-full break-all text-foreground">{resolvedProposalId}</code></span>}
        </div>
      )}

      {(executionId || taskId) && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="صفحات تفاصيل التنفيذ" data-testid="execution-destinations">
          {executionId && (
            <>
              <Link
                href={`/flight-deck?executionId=${encodeURIComponent(executionId)}`}
                className="inline-flex min-h-10 min-w-40 flex-col items-start justify-center rounded border border-primary/25 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span>فتح لوحة التشغيل</span>
                <span className="text-[11px] font-normal text-muted-foreground">خطوات التنفيذ والأدلة</span>
              </Link>
              <Link
                href={`/mission-control?executionId=${encodeURIComponent(executionId)}`}
                className="inline-flex min-h-10 min-w-40 flex-col items-start justify-center rounded border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span>فتح متابعة الأهداف</span>
                <span className="text-[11px] font-normal text-muted-foreground">الحالة والاسترداد والتحقق</span>
              </Link>
            </>
          )}
          {taskId && (
            <Link
              href={`/tasks?taskId=${encodeURIComponent(taskId)}`}
              className="inline-flex min-h-10 items-center rounded border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              فتح المهمة
            </Link>
          )}
        </nav>
      )}
    </>
  );

  return (
    <section
      dir="rtl"
      lang="ar"
      className={`border-border/60 bg-card/40 ${compact ? 'border-b px-3 py-3' : 'rounded-xl border p-4'}`}
      aria-label="ملخص التنفيذ"
      data-testid="mission-capsule"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-primary">ملخص التنفيذ</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" data-testid="status-mission-kind">
              {titleCase(projection.kind)}
            </span>
            <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" data-testid="status-mission-phase">
              {titleCase(projection.phase)}
            </span>
          </div>
          <h2 className="mt-2 text-sm font-semibold text-foreground" data-testid="text-lifecycle-title">{missionState.label}</h2>
          <p dir="auto" className="mt-1 max-w-3xl break-words text-xs leading-5 text-muted-foreground" data-testid="text-mission-objective">
            {projection.objective || 'لا يوجد وصف هدف محفوظ لهذا التنفيذ.'}
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-right ${stateTone(missionState.key)}`} data-testid="status-canonical">
          <div className="text-[10px] text-muted-foreground">الحالة المسجلة</div>
          <div className="mt-0.5 text-xs font-semibold text-foreground">{missionState.label}</div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px]" role="status" data-testid="text-mission-state-detail">
        {missionState.detail}
      </div>

      <ResultDetailsSummary input={{ kind: 'execution', projection, executionStatus, evidenceVerdict }} />

      {hasTechnicalIdentityDetails && (compact ? (
        <details
          className="mt-2 rounded-md border border-border/45 bg-background/20"
          data-testid="execution-technical-details"
          aria-label="تفاصيل تقنية للتنفيذ"
        >
          <summary
            className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-muted-foreground"
            data-testid="toggle-technical-details"
          >
            تفاصيل تقنية
          </summary>
          <div className="space-y-2 border-t border-border/40 p-3">
            {technicalIdentityContent}
          </div>
        </details>
      ) : (
        <div className="mt-2 space-y-2">
          {technicalIdentityContent}
        </div>
      ))}

      {projection.timeline?.length > 0 && (
        <details
          className="mt-3 rounded-md border border-border/45 bg-background/20"
          open={!compact || timelineOpenByDefault}
          data-testid="mission-timeline"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] font-semibold text-foreground">
            <span>{projection.kind === 'DELIVERY' ? 'مراحل التسليم' : 'مراحل العمل'}</span>
            <span className="font-normal text-muted-foreground">({projection.timeline.length} مراحل)</span>
            <span className={`ms-auto rounded-full border px-1.5 py-0.5 text-[9px] ${stateTone(missionState.key)}`}>{missionState.label}</span>
          </summary>
          <div className="grid gap-1.5 border-t border-border/40 p-2 sm:grid-cols-2 lg:grid-cols-4">
            {projection.timeline.map((item) => (
              <div
                key={item.id}
                className={`rounded-md border px-2.5 py-2 ${
                  item.status === 'active'
                    ? 'border-primary/35 bg-primary/10'
                    : item.status === 'blocked'
                      ? 'border-red-500/30 bg-red-500/5'
                      : item.status === 'completed'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-border/35 bg-background/20'
                }`}
                data-testid={`timeline-${item.id}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {timelineIcon(item.status)}
                  <span dir="auto" className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground">{timelineLabel(item.id, item.label)}</span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">{timelineStatusLabel(item.status)}</span>
                </div>
                {item.detail && <p dir="auto" className="mt-1 break-words text-[9px] leading-4 text-muted-foreground">{item.detail}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className={`mt-3 grid gap-2 text-[10px] ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-progress">
          <div className="text-muted-foreground">التقدم المسجل</div>
          <div className="mt-1 font-medium text-foreground">
            {percent === null ? 'غير مسجل' : `${percent}٪`}
            {progress?.totalSteps != null && <span dir="ltr" className="ms-1 text-muted-foreground">({progress.completedSteps}/{progress.totalSteps})</span>}
          </div>
          {progress?.currentStep && <div dir="auto" className="mt-0.5 truncate text-muted-foreground">{progress.currentStep}</div>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-run">
          <div className="text-muted-foreground">حالة التنفيذ</div>
          <div className="mt-1 font-medium text-foreground">{titleCase(executionStatus)}</div>
          {executionId && !compact && <code dir="ltr" className="mt-0.5 block truncate text-muted-foreground" title={executionId}>ID {executionId}</code>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-flight">
          <div className="text-muted-foreground">حالة التسليم</div>
          <div className={`mt-1 font-medium ${stateTone(flightState).split(' ').at(-1)}`}>{titleCase(flightState)}</div>
          {resumable !== undefined && resumable !== null && <div className="mt-0.5 text-muted-foreground">{resumable ? 'توجد نقطة قابلة للاستئناف' : 'لم يُسجّل إمكان الاستئناف'}</div>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-proof">
          <div className="text-muted-foreground">حالة التحقق المسجلة</div>
          <div className={`mt-1 font-medium ${verificationTone(projection.verification?.status)}`}>{titleCase(projection.verification?.status)}</div>
          <div className="mt-0.5 truncate text-muted-foreground">{titleCase(verdict)}</div>
        </div>
      </div>

      <div className="mt-3" aria-label="تقدم التنفيذ">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="font-semibold text-foreground">التقدم كما سجله الخادم</span>
          <span className="tabular-nums text-muted-foreground">{percent === null ? 'بانتظار بيانات التقدم' : `${percent}٪`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} aria-label={percent === null ? 'تقدم التنفيذ غير متاح بعد' : `تقدم التنفيذ المسجل ${percent}٪`} data-testid="progress-execution">
          <div className={`h-full rounded-full transition-[width] duration-500 ${projection.verification?.status === 'failed' ? 'bg-red-400' : 'bg-primary'}`} style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>

      {projection.orientation && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-[10px] ${
            projection.orientation.complete
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
          }`}
          data-testid="orientation-coverage"
        >
          <div className="font-semibold">
            قراءة بنية المشروع: {projection.orientation.complete ? 'مكتملة بحسب السجل' : 'غير مكتملة'}
          </div>
          {projection.orientation.missingRoles.length > 0 && (
            <div className="mt-0.5 text-muted-foreground">
              أدوار المصادر الناقصة: <bdi dir="ltr">{projection.orientation.missingRoles.join(', ')}</bdi>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2.5" data-testid="primary-next-action">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold text-primary">الخطوة التالية</div>
            <div className="mt-0.5 text-xs font-semibold text-foreground">
              {recoveryState && recoveryView ? recoveryView.nextStep : missionState.primaryActionLabel}
            </div>
            {recoveryState && recoveryView ? (
              <div className="mt-0.5 text-[10px] text-muted-foreground" data-testid="text-next-action">
                {recoveryView.detail}
              </div>
            ) : nextAction && (
              <div className="mt-0.5 text-[10px] text-muted-foreground" data-testid="text-next-action">
                {nextAction}
              </div>
            )}
          </div>
          {primaryAction && (
            <button
              type="button"
              data-testid={`button-action-${primaryAction.toLowerCase()}`}
              data-primary-action="true"
              className="inline-flex items-center rounded border border-primary/40 bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void runAction(primaryAction)}
              disabled={pendingAction !== null}
              title={onAction ? undefined : 'يتم الإجراء ضمن صفحة التنفيذ المسؤولة عنه'}
            >
              {pendingAction === primaryAction
                ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                : actionIcon(primaryAction)}
              {pendingAction === primaryAction ? 'جارٍ التنفيذ…' : actionLabel(primaryAction, taskId)}
            </button>
          )}
        </div>
      </div>

      {planSteps.length > 0 && (
        <details className="mt-3 rounded-md border border-border/45 bg-background/20" open={!compact}>
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-foreground" data-testid="toggle-plan">
            الخطة الحالية <span className="font-normal text-muted-foreground">({planSteps.length} خطوات)</span>
          </summary>
          <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
            {planSteps.map((step) => (
              <div key={step.id} className="rounded border border-border/35 px-2 py-1.5 text-[10px]" data-testid={`plan-step-${step.id}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {stepIcon(step.status)}
                  <span dir="auto" className="min-w-0 flex-1 truncate font-medium text-foreground/90">{step.title}</span>
                  <span className="shrink-0 text-muted-foreground">{titleCase(step.status)}</span>
                </div>
                {(step.action || step.files?.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-2 ps-5 text-muted-foreground">
                    {step.action && <span>الإجراء: <bdi dir="ltr">{step.action}</bdi></span>}
                    {step.files?.length > 0 && <span>ملفات النطاق: {step.files.length}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {(recentTools.length > 0 || changedFiles.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {recentTools.length > 0 && (
            <details className="rounded-md border border-border/45 bg-background/20 px-2.5 py-2" open={!compact}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-foreground" data-testid="toggle-tools">
                <Wrench className="h-3 w-3 text-primary" /> أدوات التنفيذ <span className="font-normal text-muted-foreground">({projection.tools?.totalCalls ?? recentTools.length} استدعاءات)</span>
              </summary>
              <div className="mt-1 space-y-1 border-t border-border/30 pt-1.5">
                {recentTools.map((tool, index) => (
                  <div key={`${tool.tool}-${index}`} className="flex min-w-0 items-center gap-1.5 text-[10px]" data-testid={`tool-${index}`}>
                    <span className={tool.status === 'failed' ? 'text-red-200' : tool.status === 'started' ? 'text-primary' : 'text-emerald-200'}>{titleCase(tool.status)}</span>
                    <span dir="ltr" className="min-w-0 truncate text-muted-foreground">{tool.tool}</span>
                    {tool.source && <code dir="ltr" className="min-w-0 truncate text-muted-foreground/70">{tool.source}</code>}
                  </div>
                ))}
              </div>
            </details>
          )}
          {changedFiles.length > 0 && (
            <details className="rounded-md border border-border/45 bg-background/20 px-2.5 py-2" open={!compact}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-foreground" data-testid="toggle-files">
                <FileText className="h-3 w-3 text-primary" /> الملفات المتغيرة ({changedFiles.length})
              </summary>
              <div className="mt-1 space-y-1 border-t border-border/30 pt-1.5">
                {changedFiles.map((file) => <code dir="ltr" key={file} className="block truncate text-[10px] text-muted-foreground" data-testid={`file-${file}`}>{file}</code>)}
              </div>
            </details>
          )}
        </div>
      )}

      {(diffLoading || diff || diffError) && (
        <div className="mt-2 space-y-2 rounded-md border border-primary/30 bg-background/30 p-2.5" aria-label="فروق التغييرات القابلة للمراجعة">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-foreground">تغييرات قابلة للمراجعة</span>
            {diff && <span className="text-[10px] text-muted-foreground">الملفات: {diff.length}</span>}
          </div>
          {diffLoading && <p className="text-[10px] text-muted-foreground">جارٍ تحميل الفروق من الخادم…</p>}
          {diffError && <p dir="auto" className="text-[10px] text-red-200">{diffError}</p>}
          {diff && (
            diff.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">لا يوجد محتوى ملفات مرفق قابل للمراجعة في هذا التنفيذ.</p>
            ) : diff.map((file) => (
              <details key={file.path} className="rounded border border-border/40 bg-black/10" open={!compact}>
                <summary dir="ltr" className="cursor-pointer break-all px-2 py-1.5 font-mono text-[10px] text-foreground">{file.path}</summary>
                <pre dir="ltr" className="max-h-80 overflow-auto border-t border-border/40 px-2 py-2 text-left text-[9px] leading-4 text-muted-foreground">
                  {reviewLines(file.originalContent, file.newContent).join('\n')}
                </pre>
                {file.truncated && <div className="px-2 pb-1 text-[9px] text-amber-200">المحتوى المعروض لهذا الملف مختصر ضمن حدود المراجعة.</div>}
              </details>
            ))
          )}
        </div>
      )}

      <details
        className={`mt-3 rounded-md border px-3 py-2 text-[10px] ${projection.verification?.status === 'failed' || projection.verification?.status === 'unavailable' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
        open={proofOpen || projection.verification?.status === 'failed' || projection.verification?.status === 'unavailable'}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-foreground" data-testid="toggle-proof">
          <ShieldCheck className={`h-3.5 w-3.5 ${verificationTone(projection.verification?.status)}`} />
          التحقق والأدلة (سجل تقني)
          <span className={`ms-auto font-normal ${verificationTone(projection.verification?.status)}`}>{titleCase(projection.verification?.status)}</span>
        </summary>
        <div className="mt-1 border-t border-border/30 pt-1.5 leading-4 text-muted-foreground" data-testid="text-proof-summary">
          <p>{verificationSummary(projection.verification?.status, projection.verification?.proofRequired)}</p>
          <p className="mt-1">حكم الأدلة المسجل: <span className="font-medium text-foreground">{titleCase(verdict)}</span>{projection.verification?.proofRequired ? ' · إثبات القبول مطلوب' : ' · لم تُسجّل بوابة إثبات مطلوبة'}</p>
        </div>
      </details>

      {(isStopped || approvalPending || secondaryActions.length > 0 || actionError) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isStopped && (
            <div className="flex min-w-0 items-start gap-1.5 text-[10px] text-amber-200" role="status" data-testid="status-stopped">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span><span className="font-semibold">النتيجة المسجلة من الخادم:</span> {titleCase(projection.stopped?.outcome)}</span>
            </div>
          )}
          {approvalPending && <span className="text-[10px] font-semibold text-amber-200" data-testid="status-approval">تلزم الموافقة قبل المتابعة</span>}
          {actionError && <span dir="auto" className="text-[10px] text-red-200" role="alert" data-testid="text-action-error">{actionError}</span>}
          {secondaryActions.length > 0 && (
            <details className="ms-auto w-full rounded-md border border-border/45 bg-background/20" data-testid="advanced-actions">
              <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground">
                إجراءات أخرى ({secondaryActions.length})
              </summary>
              <div className="flex flex-wrap justify-end gap-1.5 border-t border-border/40 px-2.5 py-2" aria-label="إجراءات التنفيذ الأخرى">
                {secondaryActions.map((action) => {
                  const pending = pendingAction === action;
                  return (
                    <button
                      key={action}
                      type="button"
                      data-testid={`button-action-${action.toLowerCase()}`}
                      className="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void runAction(action)}
                      disabled={pendingAction !== null}
                      title={onAction ? undefined : 'يتم الإجراء ضمن صفحة التنفيذ المسؤولة عنه'}
                    >
                      {pending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : actionIcon(action)}
                      {pending ? 'جارٍ التنفيذ…' : actionLabel(action, taskId)}
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default ExecutionProjectionPanel;