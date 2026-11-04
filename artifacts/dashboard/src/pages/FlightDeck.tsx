import { useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, GitBranch, Circle, GitCommit, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiExecution,
  useGetGitStatus,
  useGetGitLog,
  useGitCommit,
  useGitPush,
} from '@workspace/api-client-react';
import type { OperationEvidenceProjection } from '@workspace/api-client-react';
import { MissionCapsule } from '@/components/MissionCapsule';
import { executionChatHref } from '@/lib/execution-chat-link';
import { resolveExecutionProofPresentation } from '@/lib/execution-proof-presentation';

type FlightNode = {
  id: string;
  title: string;
  status: string;
  allowedFiles: string[];
  dependencies: string[];
  validationProfile: string;
  attempts: number;
};

const PHASES = [
  { label: 'Mission', states: ['BUILDING'] },
  { label: 'Plan', states: ['BUILDING'] },
  { label: 'Explore', states: ['BUILDING'] },
  { label: 'Build', states: ['BUILDING', 'REPAIRING'] },
  { label: 'Validate', states: ['VALIDATING'] },
  { label: 'Repair', states: ['REPAIRING'] },
  { label: 'Review', states: ['READY_FOR_REVIEW'] },
  { label: 'Apply', states: ['APPLIED'] },
  { label: 'Commit', states: ['COMMITTED'] },
  { label: 'Push', states: ['PUSHED'] },
] as const;

function readExecutionId(): string {
  return new URLSearchParams(window.location.search).get('executionId') ?? '';
}

function readQueryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function stateLabel(state: string | undefined): string {
  return (state ?? 'BUILDING').replace(/_/g, ' ');
}

function stateClasses(state: string | undefined): string {
  if (state === 'BLOCKED') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (state === 'CANCELLED') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (state === 'READY_FOR_REVIEW' || state === 'APPLIED' || state === 'COMMITTED' || state === 'PUSHED' || state === 'COMPLETED') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-primary/40 bg-primary/10 text-primary';
}

function evidenceClasses(verdict: string): string {
  if (verdict === 'PROVEN') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  if (verdict === 'PARTIAL') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (verdict === 'BLOCKED' || verdict === 'UNAVAILABLE') return 'border-red-500/40 bg-red-500/10 text-red-200';
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function deliveryRecoveryRequired(
  execution: {
    recovery?: { uncertain?: boolean } | null;
    operationEvidence?: {
      completeness?: string;
      receipts?: Array<{ kind?: string; status?: string }>;
    } | null;
  },
): boolean {
  if (execution.recovery?.uncertain === true || execution.operationEvidence?.completeness === 'uncertain') {
    return true;
  }
  return (execution.operationEvidence?.receipts ?? []).some((receipt) =>
    (receipt.kind === 'commit' || receipt.kind === 'push') && receipt.status === 'unknown',
  );
}

function checkpointNodes(checkpoint: Record<string, unknown> | undefined): FlightNode[] {
  if (!checkpoint || !Array.isArray(checkpoint.nodeStates)) return [];
  return checkpoint.nodeStates.filter((node): node is FlightNode => {
    if (!node || typeof node !== 'object') return false;
    const value = node as Partial<FlightNode>;
    return typeof value.id === 'string'
      && typeof value.title === 'string'
      && typeof value.status === 'string'
      && Array.isArray(value.allowedFiles)
      && Array.isArray(value.dependencies)
      && typeof value.validationProfile === 'string'
      && typeof value.attempts === 'number';
  });
}

function formatElapsed(startedAt?: string | null, completedAt?: string | null, now = Date.now()): string {
  if (!startedAt) return 'لم يبدأ';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'غير متاح';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function objectiveLabel(objective: Record<string, unknown> | null | undefined): string {
  if (!objective) return 'لم يُحفظ هدف معلن.';
  const value = objective.objective ?? objective.description ?? objective.objectiveType;
  return typeof value === 'string' && value.trim()
    ? value
    : 'هدف هندسي معلن';
}

function evidenceCompletenessLabel(completeness: OperationEvidenceProjection['completeness']): string {
  const labels: Record<OperationEvidenceProjection['completeness'], string> = {
    complete: 'مكتمل',
    partial: 'جزئي',
    blocked: 'محظور',
    failed: 'فشل',
    cancelled: 'ملغى',
    uncertain: 'غير محسوم',
    'retained-with-gaps': 'محفوظ مع نواقص',
  };
  return labels[completeness] ?? 'غير معروف';
}

function evidenceStageLabel(kind: string): string {
  switch (kind) {
    case 'provider': return 'مزود الذكاء الاصطناعي';
    case 'validation': return 'التحقق';
    case 'promotion': return 'الترقية / التسليم';
    case 'commit': return 'تسجيل التغييرات';
    case 'push': return 'النشر إلى المستودع';
    default: return 'التنفيذ';
  }
}

function evidenceOutcomeLabel(status: string): string {
  switch (status) {
    case 'passed': return 'متحقق';
    case 'failed': return 'متعذر';
    case 'blocked': return 'محظور';
    case 'cancelled': return 'غير مكتمل';
    case 'unknown': return 'غير محسوم';
    default: return 'قيد التنفيذ';
  }
}

function evidenceOutcomeClasses(status: string): string {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200';
  if (status === 'failed' || status === 'blocked') return 'border-red-500/30 bg-red-500/5 text-red-200';
  if (status === 'cancelled') return 'border-amber-500/30 bg-amber-500/5 text-amber-200';
  return 'border-border/60 bg-background/20 text-muted-foreground';
}

function fallbackFlightState(execution: {
  status?: string;
  proofRequired?: boolean;
  proofVerdict?: string;
  proposalId?: string | null;
}): string {
  if (execution.status === 'failed') return 'BLOCKED';
  if (execution.status === 'cancelled' || execution.status === 'cancelling') return 'CANCELLED';
  if (execution.status === 'completed') {
    if (!execution.proofRequired || execution.proofVerdict === 'PROVEN') return 'COMPLETED';
    if (
      execution.proposalId
      && ['INCOMPLETE', 'PARTIAL', 'UNAVAILABLE', 'NOT_RECORDED'].includes(execution.proofVerdict ?? '')
    ) {
      return 'READY_FOR_REVIEW';
    }
    return 'BLOCKED';
  }
  return 'BUILDING';
}

function safeEvidenceAction(completeness: OperationEvidenceProjection['completeness']): string {
  if (completeness === 'blocked' || completeness === 'failed') {
    return 'راجع الإيصال المحظور، ثم أعد التحقق المعتمد قبل التطبيق أو التسليم.';
  }
  if (completeness === 'cancelled' || completeness === 'partial' || completeness === 'retained-with-gaps') {
    return 'لا تعتمد هذه النتيجة كأنها متحققة؛ أعد الاتصال أو ابدأ تنفيذًا جديدًا لاستكمال الإثبات الناقص.';
  }
  if (completeness === 'uncertain') {
    return 'حدّث المشروع وطابق العملية مع المراجعة الحالية قبل إعادة المحاولة.';
  }
  return 'لا يلزم إجراء من المشغّل؛ تابع فقط عبر المرحلة المطابقة التي يديرها الخادم.';
}

type DisplayReceipt = {
  kind: string;
  status: string;
  attempt: number;
  timestamp: string;
  detail?: string;
};

function displayReceipts(evidence: OperationEvidenceProjection): DisplayReceipt[] {
  return evidence.receipts.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const value = raw as Record<string, unknown>;
    if (typeof value.kind !== 'string' || typeof value.status !== 'string' || typeof value.timestamp !== 'string') return [];
    return [{
      kind: value.kind,
      status: value.status,
      attempt: typeof value.attempt === 'number' ? value.attempt : 0,
      timestamp: value.timestamp,
      ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
    }];
  });
}

function DeliveryProofTimeline({
  evidence,
  executionVerdict,
}: {
  evidence?: OperationEvidenceProjection;
  executionVerdict?: string;
}) {
  if (!evidence) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
        لا يتوفر إثبات التسليم بعد. لا تعتبر هذا التنفيذ تسليمًا موثّقًا.
      </div>
    );
  }
  const receipts = displayReceipts(evidence);
  const gaps = evidence.gaps ?? [];
  // Operation evidence is intentionally a redacted record, not a delivery
  // attestation. Individual passed receipts are shown as verified, while the
  // chain itself stays conservative until the execution verdict certifies it.
  const isVerified = evidence.completeness === 'complete'
    && evidence.proof?.accepted === true
    && evidence.proof.verdict === 'PROVEN'
    && executionVerdict === 'PROVEN';
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="سلسلة إثبات التسليم">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">سلسلة إثبات التسليم</h2>
            <p className="text-xs text-muted-foreground">إيصالات المرشح والتحقق والترقية والملفات التي جرى تسليمها لهذه العملية</p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${evidenceOutcomeClasses(isVerified ? 'passed' : evidence.completeness === 'blocked' || evidence.completeness === 'failed' ? 'blocked' : 'unknown')}`}>
            {isVerified ? 'سلسلة متحققة' : evidenceCompletenessLabel(evidence.completeness)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>العملية <code dir="ltr" className="text-foreground">{evidence.operationId}</code></span>
          <span>المراجعة <code dir="ltr" className="text-foreground">{evidence.revision ?? 'غير مسجل'}</code></span>
          {evidence.hashes?.changeSet && <span>المرشح <code dir="ltr" className="text-foreground">{evidence.hashes.changeSet}</code></span>}
          {evidence.hashes?.committed && <span>الملفات المسلّمة <code dir="ltr" className="text-foreground">{evidence.hashes.committed}</code></span>}
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {receipts.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">لم تُحفَظ إيصالات منقّحة.</div>
        ) : receipts.map((receipt, index) => (
          <div key={`${receipt.kind}-${receipt.timestamp}-${index}`} className="flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{evidenceStageLabel(receipt.kind)}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${evidenceOutcomeClasses(receipt.status)}`}>{evidenceOutcomeLabel(receipt.status)}</span>
                <span className="text-[10px] text-muted-foreground">المحاولة {receipt.attempt}</span>
              </div>
              {receipt.detail && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{receipt.detail}</p>}
              <time className="mt-1 block text-[10px] text-muted-foreground">{new Date(receipt.timestamp).toLocaleString()}</time>
            </div>
          </div>
        ))}
      </div>
      {gaps.length > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="text-xs font-semibold text-amber-200">ثغرات الإثبات</div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-amber-100/80">
            {gaps.map((gap, index) => <li key={`${gap.source}-${gap.kind}-${index}`}>{gap.detail}</li>)}
          </ul>
        </div>
      )}
      {!isVerified && (
        <div className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
          <span className="font-semibold text-amber-200">الإجراء الآمن التالي: </span>{safeEvidenceAction(evidence.completeness)}
        </div>
      )}
    </section>
  );
}

export default function FlightDeck() {
  const executionId = readExecutionId();
  const requestedProjectId = readQueryParam('projectId');
  const requestedOperationId = readQueryParam('operationId');
  const queryClient = useQueryClient();
  const [commitMessage, setCommitMessage] = useState('');
  const { data: execution, isLoading, isError } = useGetAiExecution(executionId, {
    query: {
      queryKey: ['ai-flight-deck-execution', executionId],
      enabled: Boolean(executionId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'queued' || status === 'running' || status === 'cancelling' ? 1500 : false;
      },
    },
  });
  const projectId = execution?.projectId ?? requestedProjectId;
  const operationId = execution?.operationId ?? requestedOperationId;
  const conversationHref = executionChatHref(execution, executionId, requestedProjectId);
  const gitStatus = useGetGitStatus(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: ['flight-deck-git-status', projectId],
      refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
      retry: false,
    },
  });
  const gitLog = useGetGitLog(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: ['flight-deck-git-log', projectId],
      staleTime: 15_000,
    },
  });
  const commitMutation = useGitCommit({
    mutation: {
      onSuccess: () => {
        setCommitMessage('');
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] });
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-log', projectId] });
        queryClient.invalidateQueries({ queryKey: ['ai-flight-deck-execution', executionId] });
      },
    },
  });
  const pushMutation = useGitPush({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] });
        queryClient.invalidateQueries({ queryKey: ['ai-flight-deck-execution', executionId] });
      },
    },
  });

  if (!executionId) {
    return (
      <div dir="rtl" lang="ar" className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 text-center">
        <Activity className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">لوحة متابعة التنفيذ</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          افتح هذه الصفحة من تنفيذ للذكاء الاصطناعي باستخدام <code dir="ltr">?executionId=…</code>.
        </p>
        <Link href="/ai" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          افتح مساعد الذكاء الاصطناعي
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <div dir="rtl" lang="ar" className="p-8 text-center text-sm text-muted-foreground animate-pulse">جارٍ تحميل إثبات العملية المحفوظ…</div>;
  }

  if (isError || !execution) {
    return (
      <div dir="rtl" lang="ar" className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-center gap-2 font-semibold text-red-200">
          <AlertTriangle className="h-4 w-4" />
          إثبات التنفيذ غير متاح
        </div>
        <p className="mt-2 text-sm text-muted-foreground">لم يُعِد الخادم سجل تنفيذ محفوظًا لهذا المعرّف.</p>
        <Link href="/ai" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> الرجوع إلى مساعد الذكاء الاصطناعي
        </Link>
      </div>
    );
  }

  const proofPresentation = resolveExecutionProofPresentation(execution);
  const evidenceVerdict = proofPresentation.evidenceVerdict;
  const state = proofPresentation.flightState ?? fallbackFlightState({
    ...execution,
    proofVerdict: evidenceVerdict,
  });
  const checkpoint = execution.checkpoint;
  const nodes = checkpointNodes(checkpoint);
  const isDeliveryExecution = execution.proofRequired
    || Boolean(execution.proposalId || execution.buildPlanMessageId || execution.linkedTaskId);
  const activePhase = isDeliveryExecution
    ? PHASES.findIndex((phase) => phase.states.includes(state as never))
    : -1;
  const stage = typeof checkpoint.stage === 'string' ? checkpoint.stage : 'نقطة حفظ الخادم';
  const detail = typeof checkpoint.detail === 'string' ? checkpoint.detail : 'تُحفظ الأدلة ضمن سجل التنفيذ الدائم.';
  const scopeFiles = [...new Set(nodes.flatMap((node) => node.allowedFiles))];
  const blockedNodes = nodes.filter((node) => node.status === 'blocked' || node.status === 'failed').length;
  const riskLabel = blockedNodes > 0
    ? `${blockedNodes} عقد محظورة`
    : evidenceVerdict !== 'PROVEN' && isDeliveryExecution
      ? `الإثبات ${stateLabel(evidenceVerdict)}`
      : nodes.some((node) => node.attempts >= 3)
        ? 'استُنفدت محاولات الإعادة'
        : 'لا توجد مخاطر عالقة مسجلة';
  const elapsed = formatElapsed(execution.startedAt, execution.completedAt);
  const changedFiles = gitStatus.data?.files ?? [];
  const recoveryRequired = deliveryRecoveryRequired(execution);
  const canCommit = isDeliveryExecution && state === 'APPLIED'
    && Boolean(execution.proposalId && operationId)
    && changedFiles.length > 0
    && Boolean(commitMessage.trim())
    && !recoveryRequired;
  const canPush = isDeliveryExecution
    && state === 'COMMITTED'
    && Boolean(execution.proposalId && operationId)
    && !recoveryRequired;

  return (
    <div dir="rtl" lang="ar" className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={conversationHref ?? '/ai'} data-testid="link-flight-deck-ai"
          className="inline-flex items-center gap-1 rounded p-1 hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {conversationHref ? 'الرجوع إلى محادثة الذكاء الاصطناعي' : 'مساعد الذكاء الاصطناعي'}
        </Link>
        <span>/</span><Link href="/mission-control" className="hover:text-foreground hover:underline">مركز المهام</Link><span>/</span><span className="text-foreground">لوحة متابعة التنفيذ</span>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><GitBranch className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">لوحة تسليم الشيفرة</p>
                <h1 className="text-2xl font-bold tracking-tight">{isDeliveryExecution ? 'المهمة ← النشر' : 'مراجعة / محادثة'}</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{detail}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <code dir="ltr" className="rounded border border-border/60 px-2 py-1">execution {execution.id}</code>
              {projectId && <code dir="ltr" className="rounded border border-border/60 px-2 py-1">project {projectId}</code>}
              {execution.proposalId && <code dir="ltr" className="rounded border border-border/60 px-2 py-1">proposal {execution.proposalId}</code>}
              {operationId && <code dir="ltr" className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-primary">operation {operationId}</code>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            {!isDeliveryExecution && (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-500/40 bg-slate-500/10 px-3 py-1.5 text-xs font-semibold text-slate-200">
                تنفيذ لا يتضمن تسليمًا
              </div>
            )}
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${stateClasses(state)}`}>
              {state === 'BLOCKED' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
              {stateLabel(state)}
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${evidenceClasses(evidenceVerdict)}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              الإثبات: {stateLabel(evidenceVerdict)}
            </div>
            {execution.recipeReceipt && (
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200">
                <span>{execution.recipeReceipt.recipeId}</span>
                <span className="text-violet-200/70">
                  {execution.recipeReceipt.completedNodeIds.length}/{execution.recipeReceipt.nodes.length} خطوات
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <MissionCapsule
            projection={execution.projection}
            executionId={executionId}
            operationId={operationId}
            proposalId={execution.proposalId}
            taskId={execution.linkedTaskId}
            executionStatus={execution.status}
            flightState={state}
            evidenceVerdict={evidenceVerdict}
            resumable={execution.resumable}
            nextAction={execution.evidenceReason ?? safeEvidenceAction(execution.operationEvidence?.completeness ?? 'partial')}
          />
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="ملخص مراقبة المهمة">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 lg:col-span-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">الهدف</div>
            <div className="mt-1 break-words text-sm font-medium text-foreground">{objectiveLabel(execution.objective)}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">المدة</div>
            <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{elapsed}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">النطاق</div>
            <div className="mt-1 text-sm font-medium text-foreground">{scopeFiles.length} ملفات · {nodes.length} عُقد</div>
          </div>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">المخاطر</div>
             <div className={`mt-1 text-sm font-medium ${blockedNodes > 0 || evidenceVerdict === 'UNAVAILABLE' ? 'text-red-200' : 'text-amber-200'}`}>{riskLabel}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-5">
          {PHASES.map((phase, index) => {
            const complete = activePhase >= 0 && index < activePhase;
            const active = index === activePhase;
            return (
              <div key={phase.label} className={`rounded-md border px-3 py-2 ${active ? 'border-primary/50 bg-primary/10' : 'border-border/60 bg-background/20'}`}>
                <div className="flex items-center gap-2">
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : active ? <Activity className="h-3.5 w-3.5 text-primary" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className={`text-xs font-medium ${active ? 'text-primary' : complete ? 'text-emerald-200' : 'text-muted-foreground'}`}>{phase.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">عُقد الخطة</h2><p className="text-xs text-muted-foreground">النطاقات والاعتماديات والتحقق التي يديرها الخادم</p></div>
            <span className="text-xs text-muted-foreground">{nodes.length} عُقد</span>
          </div>
          <div className="divide-y divide-border/60">
            {nodes.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">لا تتوفر لقطة للعُقد في نقطة الحفظ هذه بعد.</div>
            ) : nodes.map((node) => (
              <div key={node.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-sm font-medium">{node.title}</div><code className="text-[10px] text-muted-foreground">{node.id}</code></div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stateClasses(node.status === 'failed' || node.status === 'blocked' ? 'BLOCKED' : node.status === 'passed' ? 'COMPLETED' : 'BUILDING')}`}>{node.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span dir="ltr" className="rounded border border-border/60 px-2 py-1">validation: {node.validationProfile}</span>
                  <span dir="ltr" className="rounded border border-border/60 px-2 py-1">attempts: {node.attempts}</span>
                  <span className="rounded border border-border/60 px-2 py-1">النطاق: {node.allowedFiles.length} ملف</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
           <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">سجل الإثبات</h2>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">حالة التنفيذ</span><span dir="ltr" className="font-medium">{execution.status}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">نقطة الحفظ</span><span dir="ltr" className="font-medium">v{execution.checkpointVersion}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">المرحلة الحالية</span><span className="font-medium">{stage}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">الإثبات مطلوب</span><span className="font-medium">{execution.proofRequired ? 'نعم' : 'لا'}</span></div>
               <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">نتيجة الأدلة</span><span dir="ltr" className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${evidenceClasses(evidenceVerdict)}`}>{stateLabel(evidenceVerdict)}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">قابل للاستئناف</span><span className={execution.resumable ? 'text-amber-200' : 'text-emerald-200'}>{execution.resumable ? 'متاح' : 'لا'}</span></div>
            </div>
            {execution.evidenceReason && <p className="mt-3 rounded-md border border-border/50 bg-background/20 p-3 text-xs text-muted-foreground">{execution.evidenceReason}</p>}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">أدوات مساحة العمل</h2>
                <p className="mt-1 text-xs text-muted-foreground">تبقى إجراءات Git مرتبطة بهذه العملية والمقترح المتحقق منه.</p>
              </div>
              <button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] })}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="تحديث حالة مساحة العمل"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${gitStatus.isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {!projectId ? (
              <p className="mt-3 text-xs text-amber-200">لا يشمل هذا التنفيذ مشروعًا، لذا لا تتوفر إجراءات مساحة العمل.</p>
            ) : gitStatus.isError ? (
              <p className="mt-3 text-xs text-red-200">حالة مساحة العمل غير متاحة. لم يُفعّل أي إجراء في Git.</p>
            ) : (
              <>
                {recoveryRequired && (
                  <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
                    يتطلب التسليم استعادة الحالة. طابق العملية مع حالة المشروع والمستودع البعيد قبل إعادة محاولة الإيداع أو الدفع.
                  </p>
                )}
                <div className="mt-3 rounded-md bg-background/30 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">شجرة العمل: </span>
                  <span className={gitStatus.data?.clean ? 'text-emerald-200' : 'text-amber-200'}>
                    {gitStatus.data?.clean ? 'clean' : `${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                {changedFiles.length > 0 && (
                  <div className="mt-2 max-h-24 space-y-1 overflow-y-auto text-[11px] font-mono text-muted-foreground">
                    {changedFiles.map((file) => <div key={file.path}>{file.status || '?'} {file.path}</div>)}
                  </div>
                )}
                <label className="mt-3 block text-xs text-muted-foreground">
                  رسالة الإيداع
                  <input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="صف التغيير الذي تم التحقق منه…"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                    disabled={state !== 'APPLIED' || !execution.proposalId || !operationId}
                  />
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => commitMutation.mutate({
                      projectId,
                      data: { message: commitMessage.trim(), proposalId: execution.proposalId ?? undefined, operationId: operationId || undefined },
                    })}
                    disabled={!canCommit || commitMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {commitMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
                    إيداع التغيير المتحقق منه
                  </button>
                  <button
                    type="button"
                    onClick={() => pushMutation.mutate({
                      projectId,
                      data: { proposalId: execution.proposalId ?? undefined, operationId: operationId || undefined },
                    })}
                    disabled={!canPush || pushMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pushMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    دفع العملية المُودعة
                  </button>
                </div>
                {(commitMutation.isError || pushMutation.isError) && (
                  <p className="mt-2 text-xs text-red-200">
                    {((commitMutation.error ?? pushMutation.error) as Error).message}
                  </p>
                )}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">الإيداعات الأخيرة</p>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    {(gitLog.data?.commits ?? []).slice(0, 3).map((commit) => (
                      <div key={commit.hash} className="flex gap-2">
                        <span className="font-mono text-primary">{commit.shortHash}</span>
                        <span className="truncate">{commit.subject}</span>
                      </div>
                    ))}
                    {!gitLog.isLoading && (gitLog.data?.commits ?? []).length === 0 && <span>لا توجد إيداعات.</span>}
                  </div>
                </div>
              </>
            )}
            {state !== 'APPLIED' && state !== 'COMMITTED' && (
              <p className="mt-3 text-[11px] text-muted-foreground">لا يتاح الإيداع إلا بعد أن تسجل أدلة الخادم تطبيقًا ناجحًا. ولا يتاح الدفع إلا بعد تسجيل حدث الإيداع المطابق.</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">الخط الزمني للعملية</h2>
            <div className="mt-3 space-y-3 text-xs text-muted-foreground">
              {execution.createdAt && <div className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> أُنشئت {new Date(execution.createdAt).toLocaleString('ar')}</div>}
              {execution.updatedAt && <div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5" /> آخر تحديث {new Date(execution.updatedAt).toLocaleString('ar')}</div>}
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-amber-100/80">مساحة العمل هذه مستقلة عن AiChat. وتظل الموافقة والتطبيق صريحين؛ ولا يتاح الإيداع والدفع إلا بعد أحداث الخادم المطابقة.</div>
            </div>
          </div>
        </section>
      </div>
      <DeliveryProofTimeline
        evidence={execution.operationEvidence}
        executionVerdict={evidenceVerdict}
      />
    </div>
  );
}