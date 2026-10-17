import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  useListTasks,
  useExecuteTask,
  useRetryTask,
  useRollbackTask,
  useGetTaskLogs,
  useGetTask,
  useGetAiExecution,
  useRecordTaskVerification,
  useAiResumeTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useListProjects,
  getListTasksQueryKey,
  getListProjectsQueryKey,
  getGetTaskLogsQueryKey,
  getGetTaskQueryKey,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskLog,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import {
  Play,
  RotateCcw,
  RefreshCw,
  Search,
  TerminalSquare,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileCode,
  ChevronRight,
  ChevronDown,
  Terminal,
  X,
  Wifi,
  WifiOff,
  ShieldCheck,
  FileCheck2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ProviderRecoveryCard } from '@/components/ProviderRecoveryCard';
import { MissionCapsule } from '@/components/MissionCapsule';

// ─── Task logs sub-component ──────────────────────────────────────────────────
// Separated so the hook always runs unconditionally within the mounted component.

function stepIcon(message: string, level: TaskLog['level']): string {
  if (level === 'error') return '❌';
  if (level === 'warn')  return '⚠️';
  const m = message.toLowerCase();
  if (m.includes('read_file') || m.includes('list_dir'))   return '📂';
  if (m.includes('search_code') || m.includes('search'))   return '🔍';
  if (m.includes('write_file'))                             return '✏️';
  if (m.includes('git_'))                                   return '🔀';
  if (m.includes('calling ai') || m.includes('agent…') || m.includes('model')) return '🧠';
  if (m.includes('project context') || m.includes('context')) return '📋';
  if (m.includes('completed') || m.includes('confidence'))  return '✅';
  if (m.includes('started') || m.includes('trigger'))       return '🚀';
  if (m.includes('auto-execution') || m.includes('auto-trigger')) return '⚡';
  return '·';
}

type TaskView = {
  id: string;
  projectId: string;
  correlationId?: string | null;
  title: string;
  description?: string;
  status: string;
  phase?: string;
  relatedFiles?: string[];
  retryCount?: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  agentResponse?: string;
  verificationResult?: {
    passed: boolean;
    decision?: 'verified' | 'incomplete' | 'failed' | 'cancelled';
    steps: Array<{
      id?: string;
      name: string;
      kind?: 'automatic' | 'operator_attestation';
      guidance?: string;
      passed: boolean;
      evidence?: string;
      output?: string;
    }>;
    history?: Array<{
      id: string;
      checkId: string;
      name: string;
      kind?: 'automatic' | 'operator_attestation';
      guidance?: string;
      passed: boolean;
      evidence?: string;
      actor: string;
      recordedAt: string;
    }>;
  };
  ruleId?: string;
  remediationPlan?: {
    version: number;
    ruleId?: string | null;
    ruleCode: string;
    ruleTitle: string;
    severity: string;
    occurrenceCount: number;
    evidence: Array<{ file: string; line: number; snippet: string; occurrences: number }>;
    relatedFiles: string[];
    fixDescription?: string | null;
    verificationSteps: string[];
    verificationChecks?: Array<{ id: string; kind: 'operator_attestation'; guidance: string }>;
    source: {
      type: string;
      correlationId?: string | null;
      revision?: string | null;
      completeness?: string | null;
    };
    status: 'needs_review' | 'ready' | 'verified';
  } | null;
};

type TaskExecutionReceipt = {
  kind?: string;
  operationId?: string;
  correlationId?: string;
  revision?: string | null;
  provider?: string;
  model?: string;
  attempt?: number;
  attempts?: number;
  durationMs?: number;
  stages?: string[];
  terminalStatus?: 'SUCCEEDED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
  terminalReason?: string;
  summary?: string;
  availabilityState?: string;
  operatorAction?: string | null;
  answerProof?: {
    version?: number;
    status?: string;
    evidenceBindings?: unknown;
  };
};

type TaskAnswerEvidenceBinding = {
  claimId: string;
  source: string;
  startLine: number;
  endLine: number;
  excerptHash: string;
  excerpt?: string;
  excerptRedacted?: boolean;
  excerptUnavailableReason?: 'excerpt_too_large' | 'receipt_size_limit';
};

type TaskAcceptance = {
  attempt: number;
  terminalStatus: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | string;
  reasonCode: string;
  nextActionCode: 'NONE' | 'RESUME_ALLOWED' | 'START_NEW_PROBE' | 'REVIEW_INCOMPLETE_EVIDENCE' | 'ABANDON_EXECUTION' | 'RETRY_AFTER_PARSE' | 'RETRY_AFTER_TIMEOUT' | string;
  evidenceComplete: boolean;
  evidenceRequired: boolean;
  resumable: boolean;
  disposition?: {
    reasonCodes: string[];
    outcome: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
    failureKind?: string;
    recoveryState: 'NONE' | 'REQUIRED' | 'INCOMPLETE';
    nextActionCode: TaskAcceptance['nextActionCode'];
    operatorAction: string;
  };
};

function parseExecutionReceipt(raw: string | undefined): TaskExecutionReceipt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TaskExecutionReceipt;
    return value && value.kind === 'AI_TASK_EXECUTION_RECEIPT' ? value : null;
  } catch {
    return null;
  }
}

function isTaskAnswerEvidenceBinding(value: unknown): value is TaskAnswerEvidenceBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Record<string, unknown>;
  const source = binding.source;
  const safePath = typeof source === 'string'
    && source.length > 0
    && source.length <= 500
    && !source.startsWith('/')
    && !source.includes('\\')
    && source.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
  const safeExcerpt = binding.excerpt === undefined
    || (
      typeof binding.excerpt === 'string'
      && binding.excerpt.length <= 2_048
      && !binding.excerpt.includes('\0')
    );
  return typeof binding.claimId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(binding.claimId)
    && safePath
    && Number.isSafeInteger(binding.startLine)
    && Number(binding.startLine) >= 1
    && Number.isSafeInteger(binding.endLine)
    && Number(binding.endLine) >= Number(binding.startLine)
    && typeof binding.excerptHash === 'string'
    && /^[a-f0-9]{64}$/iu.test(binding.excerptHash)
    && safeExcerpt
    && (
      binding.excerptRedacted === undefined
      || typeof binding.excerptRedacted === 'boolean'
    )
    && (
      binding.excerptUnavailableReason === undefined
      || binding.excerptUnavailableReason === 'excerpt_too_large'
      || binding.excerptUnavailableReason === 'receipt_size_limit'
    );
}

function getTaskAnswerEvidenceBindings(
  receipt: TaskExecutionReceipt,
): TaskAnswerEvidenceBinding[] {
  const proof = receipt.answerProof;
  if (proof?.version !== 3 || proof.status !== 'PROVEN' || !Array.isArray(proof.evidenceBindings)) {
    return [];
  }
  return proof.evidenceBindings.filter(isTaskAnswerEvidenceBinding);
}

function TaskAnswerEvidencePanel({ receipt }: { receipt: TaskExecutionReceipt }) {
  const bindings = getTaskAnswerEvidenceBindings(receipt);
  if (bindings.length === 0) return null;

  return (
    <details
      className="mt-3 rounded-md border border-border bg-background p-3"
      data-testid="task-answer-evidence"
    >
      <summary className="cursor-pointer font-semibold">
        مصادر الإجابة من الملفات ({bindings.length})
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          هذه المقتطفات حُفظت من لقطة المصدر التي جرى التحقق منها؛ لا تُقرأ من ملفات متغيرة حالياً.
        </p>
        {bindings.map((binding) => (
          <section
            key={`${binding.claimId}:${binding.source}:${binding.startLine}:${binding.endLine}`}
            className="rounded border border-border p-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted-foreground">مرجع المطالبة</span>
              <bdi dir="ltr" className="font-mono">{binding.claimId}</bdi>
            </div>
            <bdi dir="ltr" className="mt-1 block break-all font-mono text-foreground">
              {binding.source}:{binding.startLine}-{binding.endLine}
            </bdi>
            {binding.excerpt ? (
              <pre
                dir="auto"
                className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-xs"
              >
                {binding.excerpt}
              </pre>
            ) : (
              <p className="mt-2 text-muted-foreground">
                {binding.excerptUnavailableReason === 'excerpt_too_large'
                  ? 'المقتطف أطول من حد العرض؛ المدى والبصمة محفوظان.'
                  : 'لم يُضمّن نص المقتطف بسبب حد حجم الإيصال؛ المدى والبصمة محفوظان.'}
              </p>
            )}
            {binding.excerptRedacted && (
              <p className="mt-1 text-muted-foreground">
                حُجبت أنماط حساسة من النص المعروض؛ البصمة تخص المقتطف الأصلي.
              </p>
            )}
            <div className="mt-2 text-muted-foreground">
              بصمة المقتطف الأصلي:{' '}
              <bdi dir="ltr" className="break-all font-mono text-foreground">
                {binding.excerptHash}
              </bdi>
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

function acceptanceStatus(acceptance: TaskAcceptance): {
  label: string;
  className: string;
} {
  if (acceptance.disposition?.recoveryState && acceptance.disposition.recoveryState !== 'NONE') {
    return { label: 'يتطلب الاسترداد', className: 'text-amber-500' };
  }
  if (acceptance.outcome === 'SUCCEEDED') {
    return { label: 'مقبول', className: 'text-emerald-500' };
  }
  if (acceptance.outcome === 'INTERRUPTED') {
    return { label: 'منقطع', className: 'text-amber-500' };
  }
  return { label: 'فشل مسجل', className: 'text-destructive' };
}

function taskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'بانتظار التنفيذ',
    queued: 'في قائمة الانتظار',
    running: 'قيد التنفيذ',
    verifying: 'قيد التحقق',
    completed: 'انتهت بحسب السجل',
    failed: 'فشل مسجل',
    cancelled: 'أُلغيت',
  };
  return labels[status] ?? status;
}

function timelineStatusLabel(status: TimelineStep['status']): string {
  const labels: Record<TimelineStep['status'], string> = {
    done: 'اكتملت',
    active: 'جارية',
    pending: 'بانتظار البدء',
    blocked: 'متوقفة',
    failed: 'فشلت',
  };
  return labels[status];
}

function acceptanceNextAction(acceptance: TaskAcceptance): string {
  if (acceptance.disposition?.operatorAction) return acceptance.disposition.operatorAction;
  switch (acceptance.nextActionCode) {
    case 'RESUME_ALLOWED': return 'استأنف التنفيذ من نقطة الحفظ المسجلة.';
    case 'START_NEW_PROBE': return 'ابدأ فحصًا جديدًا ضمن النطاق المحدد.';
    case 'REVIEW_INCOMPLETE_EVIDENCE': return 'راجع الأدلة الناقصة قبل الاعتماد على هذه النتيجة.';
    case 'RETRY_AFTER_PARSE': return 'أعد المحاولة بعد تصحيح صيغة رد النموذج.';
    case 'RETRY_AFTER_TIMEOUT': return 'أعد المحاولة بعد انتهاء مهلة الانتظار.';
    case 'ABANDON_EXECUTION': return 'ابدأ تشغيلًا جديدًا ضمن النطاق المحدد قبل الاعتماد على هذه النتيجة.';
    default: return 'لا يوجد إجراء إضافي مسجل للمستخدم.';
  }
}

function TaskAcceptancePanel({
  taskId,
  taskStatus,
  onResume,
  isResuming,
}: {
  taskId: string;
  taskStatus: string;
  onResume: () => void;
  isResuming: boolean;
}) {
  const { data, isLoading, isFetching, isError } = useGetTask(taskId, {
    query: {
      queryKey: getGetTaskQueryKey(taskId),
      staleTime: 0,
    },
  });
  const taskDetails = data as { status?: string; acceptance?: TaskAcceptance } | undefined;
  const acceptance = taskDetails?.acceptance;
  const taskCanResume = ["pending", "queued", "verifying"].includes(taskDetails?.status ?? "");

  if (isLoading) {
    return (
      <div className="mb-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        جارٍ تحميل سجل قبول الخادم…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        سجل قبول الخادم غير متاح الآن. حدّث تفاصيل المهمة لمعرفة نتيجتها المسجلة؛ تعذر التحميل لا يثبت نجاحها أو فشلها.
      </div>
    );
  }
  if (!acceptance) return null;
  if (isResuming) {
    return (
      <div role="status" className="mb-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        جارٍ استئناف التنفيذ؛ لا تُعرض نتيجة القبول السابقة كحالية.
      </div>
    );
  }
  if (isFetching) {
    return (
      <div role="status" className="mb-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        جارٍ تحديث قبول المحاولة الحالية…
      </div>
    );
  }
  if (taskStatus === 'running') {
    return (
      <div role="status" className="mb-4 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        قبول المحاولة السابقة غير معروض أثناء التنفيذ الجاري.
      </div>
    );
  }

  const status = acceptanceStatus(acceptance);
  const acceptanceOffersResume =
    acceptance.resumable && acceptance.nextActionCode === "RESUME_ALLOWED";
  const nextAction =
    acceptanceOffersResume && !taskCanResume
      ? "حالة المهمة لا تسمح بالاستئناف الآن. حدّث تفاصيلها لمعرفة الإجراء المتاح."
      : acceptanceNextAction(acceptance);
  return (
    <section
      className="mb-4 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs"
      aria-label="نتيجة قبول الخادم"
      dir="rtl"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">قبول الخادم</span>
        <span className={`font-semibold ${status.className}`}>{status.label}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground">
        <span>النتيجة: <bdi dir="ltr" className="font-mono">{acceptance.outcome}</bdi></span>
        <span>المحاولة: <bdi dir="ltr" className="font-mono">{acceptance.attempt}</bdi></span>
        <span>رمز السبب: <bdi dir="ltr" className="font-mono">{acceptance.reasonCode}</bdi></span>
        <span>الأدلة: {acceptance.evidenceComplete ? 'مكتملة' : 'غير مكتملة'}</span>
      </div>
      <div className="mt-3 border-t border-primary/15 pt-2 text-muted-foreground" dir="rtl">
        <span className="font-semibold text-foreground">الإجراء التالي: </span>
        <span dir="auto">{nextAction}</span>
      </div>
      <div className="mt-1 text-muted-foreground">
        لا تُعرض تفاصيل تشخيص المزوّد أو بيانات الوصول.
      </div>
      {taskCanResume
        && acceptance.resumable
        && acceptance.nextActionCode === 'RESUME_ALLOWED'
        && acceptance.disposition?.recoveryState === 'REQUIRED' && (
        <button
          type="button"
          onClick={onResume}
          disabled={isResuming}
          className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="استئناف تنفيذ المهمة"
        >
          <Play className={`h-3.5 w-3.5 ${isResuming ? 'animate-pulse' : ''}`} />
          {isResuming ? 'جارٍ الاستئناف…' : 'استئناف'}
        </button>
      )}
    </section>
  );
}

function TaskExecutionProjection({ taskId }: { taskId: string }) {
  const { data: task } = useGetTask(taskId, {
    query: {
      queryKey: getGetTaskQueryKey(taskId),
      staleTime: 0,
      refetchInterval: 5_000,
    },
  });
  const { data: logs } = useGetTaskLogs(taskId, {
    query: {
      queryKey: getGetTaskLogsQueryKey(taskId),
      staleTime: 2_000,
      refetchInterval: 5_000,
    },
  });
  const executionId = [...(logs ?? [])]
    .reverse()
    .find((log) => typeof log.executionId === 'string' && log.executionId.trim())?.executionId ?? '';
  const { data: execution } = useGetAiExecution(executionId, {
    query: {
      queryKey: ['task-execution-projection', taskId, executionId],
      enabled: Boolean(executionId),
      refetchInterval: executionId ? 5_000 : false,
    },
  });

  const taskCorrelationId = task?.correlationId;
  const executionMatchesCurrentTask = Boolean(
    taskCorrelationId
    && execution?.correlationId === taskCorrelationId
    && execution.linkedTaskId === taskId,
  );
  if (!executionId || !execution?.projection || !executionMatchesCurrentTask) return null;
  return (
    <MissionCapsule
      projection={execution.projection}
      executionId={executionId}
      operationId={execution.operationId}
      proposalId={execution.proposalId}
      taskId={taskId}
      allowTaskRecovery={executionMatchesCurrentTask}
      executionStatus={execution.status}
      flightState={execution.flightState}
      evidenceVerdict={execution.evidenceVerdict}
      resumable={execution.resumable}
      nextAction={execution.evidenceReason ?? execution.acceptance?.disposition?.operatorAction}
      compact
    />
  );
}

function safeTaskText(value: unknown, fallback = 'لا تتوفر تفاصيل إضافية مسجلة.'): string {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/\/(?:home\/runner|workspace|tmp)\/[^\s"'<>),;]+/g, '[project path]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[internal id]')
    .replace(/\b(?:sk|key|token|secret)[-_]?[a-z0-9]{12,}\b/gi, '[redacted]')
    .slice(0, 300);
}

type ActivityItem = {
  key: string;
  kind: 'activity' | 'evidence' | 'warning' | 'error' | 'result';
  label: string;
  summary: string;
  timestamp: string;
  count: number;
};

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_VISIBLE_ACTIVITY_ITEMS = 80;

function activityItem(log: TaskLog): ActivityItem {
  const message = safeTaskText(log.message);
  const lower = message.toLowerCase();
  const kind = log.level === 'error'
    ? 'error'
    : log.level === 'warn'
      ? 'warning'
      : /verification|confirmed|completed|passed/.test(lower)
        ? 'result'
        : /file|pattern|search|project root/.test(lower)
          ? 'evidence'
          : 'activity';
  const label = log.eventType === 'progress' ? 'تقدم التنفيذ'
    : log.eventType === 'terminal' ? 'نتيجة التنفيذ'
      : kind === 'evidence' ? 'أدلة مسجلة'
        : kind === 'result' ? 'نتيجة التحقق'
          : kind === 'warning' ? 'يتطلب الانتباه'
            : kind === 'error' ? 'خطأ في التنفيذ'
              : 'نشاط';
  return { key: `${kind}:${message}`, kind, label, summary: message, timestamp: log.timestamp, count: 1 };
}

function groupActivity(logs: TaskLog[]): ActivityItem[] {
  const groups: ActivityItem[] = [];
  for (const log of [...logs].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    const item = activityItem(log);
    const previous = groups[groups.length - 1];
    if (previous?.key === item.key) previous.count += 1;
    else groups.push(item);
  }
  return groups;
}

function visibleActivityItems(items: ActivityItem[]): ActivityItem[] {
  if (items.length <= MAX_VISIBLE_ACTIVITY_ITEMS) return items;
  return [
    ...items.slice(0, 1),
    ...items.slice(-(MAX_VISIBLE_ACTIVITY_ITEMS - 1)),
  ];
}

type TimelineStep = {
  title: string;
  stage: string;
  status: 'done' | 'active' | 'pending' | 'blocked' | 'failed';
  detail: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  percent?: number | null;
};

const TIMELINE_STAGES: Array<{ stage: string; title: string }> = [
  { stage: 'acquisition', title: 'انتظار بدء التنفيذ' },
  { stage: 'context', title: 'إعداد سياق المشروع' },
  { stage: 'model', title: 'طلب المساعدة من النموذج' },
  { stage: 'attempt', title: 'محاولة التنفيذ أو البديل' },
  { stage: 'analysis', title: 'تحليل الرد' },
  { stage: 'verification', title: 'التحقق من النتيجة' },
  { stage: 'finalization', title: 'إنهاء التنفيذ' },
  { stage: 'result', title: 'النتيجة النهائية' },
];

function currentTaskProgressLogs(
  task: TaskView,
  logs: TaskLog[],
  currentAttempt: number | null | undefined,
): TaskLog[] {
  const currentCorrelationId = typeof task.correlationId === 'string' && task.correlationId.trim()
    ? task.correlationId.trim()
    : null;
  if (
    !currentCorrelationId
    || typeof currentAttempt !== 'number'
    || !Number.isSafeInteger(currentAttempt)
    || currentAttempt < 0
  ) return [];
  return logs.filter((log) =>
    (log.eventType === 'progress' || log.eventType === 'terminal')
    && log.correlationId === currentCorrelationId
    && log.attempt === currentAttempt);
}

function taskPlan(
  task: TaskView,
  logs: TaskLog[],
  currentAttempt: number | null | undefined,
): TimelineStep[] {
  const structured = currentTaskProgressLogs(task, logs, currentAttempt);
  if (structured.length > 0) {
    const latestByStage = new Map<string, TaskLog>();
    for (const log of [...structured].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
      if (log.progressStage) latestByStage.set(log.progressStage, log);
    }
    return TIMELINE_STAGES.map(({ stage, title }) => {
      const latest = latestByStage.get(stage);
      const status = latest?.progressStatus;
      return {
        stage,
        title,
        status: status === 'completed'
          ? 'done'
          : status === 'failed'
            ? 'failed'
            : status === 'blocked' || status === 'cancelled'
              ? 'blocked'
              : status === 'active'
                ? 'active'
                : 'pending',
        detail: latest?.progressMessage ?? 'بانتظار بدء هذه المرحلة من الخادم.',
        startedAt: latest?.startedAt,
        finishedAt: latest?.finishedAt,
        percent: latest?.progressPercent,
      };
    });
  }

  const terminal = ['completed', 'failed', 'cancelled'].includes(task.status);
  const verificationDone = Boolean(task.verificationResult);
  return [
    { stage: 'legacy-goal', title: 'فهم المطلوب', status: 'done', detail: 'سُجّل هدف المهمة ونطاق المشروع.' },
    { stage: 'legacy-execute', title: 'تنفيذ مسار العمل المعتمد', status: task.status === 'pending' || task.status === 'queued' ? 'pending' : 'done', detail: 'يُستخدم مسار تنفيذ المهمة المعتمد فقط.' },
    { stage: 'legacy-verify', title: 'التحقق من النتيجة', status: verificationDone ? 'done' : task.status === 'running' || task.status === 'verifying' ? 'active' : terminal ? 'blocked' : 'pending', detail: verificationDone ? 'سجّل الخادم نتيجة التحقق.' : 'بانتظار نتيجة تحقق يسجلها الخادم.' },
    { stage: 'legacy-result', title: 'عرض النتيجة', status: terminal ? 'done' : 'pending', detail: terminal ? 'النتيجة النهائية موضحة أدناه.' : 'سيظل التقرير النهائي متاحًا بعد اكتمال المهمة.' },
  ];
}

function logOrder(a: TaskLog, b: TaskLog): number {
  if (a.sequence !== null && a.sequence !== undefined && b.sequence !== null && b.sequence !== undefined) {
    return a.sequence - b.sequence;
  }
  if (a.sequence !== null && a.sequence !== undefined) return 1;
  if (b.sequence !== null && b.sequence !== undefined) return -1;
  return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
}

function stageDuration(step: TimelineStep): string | null {
  if (!step.startedAt) return null;
  const end = step.finishedAt ? new Date(step.finishedAt).getTime() : Date.now();
  const start = new Date(step.startedAt).getTime();
  if (!Number.isFinite(start) || end < start) return null;
  const seconds = Math.floor((end - start) / 1000);
  return seconds < 60 ? `${seconds} ث` : `${Math.floor(seconds / 60)} د ${seconds % 60} ث`;
}

function TaskLogsPanel({ task, taskStatus }: { task: TaskView; taskStatus: string }) {
  const taskId = task.id;
  const isRunning = taskStatus === 'running';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const recordVerification = useRecordTaskVerification();
  const [verificationEvidence, setVerificationEvidence] = useState<Record<string, string>>({});

  // Live logs accumulated via SSE while the task is running
  const [liveLogs, setLiveLogs] = useState<TaskLog[]>([]);
  const [sseActive, setSseActive] = useState(false);
  const [connectionState, setConnectionState] = useState<'connected' | 'reconnecting' | 'exhausted' | 'disconnected'>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef(new Set<string>());
  const cursor = useRef(0);

  useEffect(() => {
    if (!isRunning) {
      setLiveLogs([]);
      seenIds.current.clear();
      setSseActive(false);
      setConnectionState('disconnected');
      return;
    }

    const streamUrl = cursor.current > 0
      ? `/api/tasks/${taskId}/logs/stream?after=${cursor.current}`
      : `/api/tasks/${taskId}/logs/stream`;
    const es = new EventSource(streamUrl);
    setSseActive(true);
    setConnectionState('connected');

    es.addEventListener('log', (e) => {
      try {
        const log = JSON.parse(e.data) as TaskLog;
        if (seenIds.current.has(log.id)) return;
        seenIds.current.add(log.id);
        if (log.sequence !== null && log.sequence !== undefined) cursor.current = Math.max(cursor.current, log.sequence);
        setLiveLogs((prev) => [...prev, log].sort(logOrder));
      } catch { /* ignore malformed frames */ }
    });

    es.addEventListener('done', () => {
      es.close();
      setSseActive(false);
      setConnectionState('disconnected');
      setReconnectAttempt(0);
    });

    es.onerror = () => {
      es.close();
      setSseActive(false);
      if (reconnectAttempt < MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('reconnecting');
        reconnectTimer.current = setTimeout(
          () => setReconnectAttempt((attempt) => attempt + 1),
          Math.min(1000 * 2 ** reconnectAttempt, 8000),
        );
      } else {
        setConnectionState('exhausted');
      }
    };

    return () => {
      es.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      setSseActive(false);
      setConnectionState('disconnected');
    };
  }, [taskId, isRunning, reconnectAttempt]);

  // REST fallback: poll after task finishes or when SSE isn't active
  const { data: polledLogs, isLoading, isError: logsError, refetch: refetchLogs } = useGetTaskLogs(taskId, {
    query: {
      queryKey: getGetTaskLogsQueryKey(taskId),
      staleTime: 5_000,
      refetchInterval: 5_000,
      enabled: true,
    },
  });

  // Merge REST snapshots and SSE replay by durable row identity. The server
  // sequence wins over arrival order, so reconnects cannot reverse the timeline.
  const logs = useMemo(() => {
    const allLogs = new Map<string, TaskLog>();
    for (const log of polledLogs ?? []) {
      allLogs.set(log.id, log);
      if (log.sequence !== null && log.sequence !== undefined) cursor.current = Math.max(cursor.current, log.sequence);
    }
    for (const log of liveLogs) allLogs.set(log.id, log);
    return [...allLogs.values()].sort((a, b) => logOrder(a, b));
  }, [liveLogs, polledLogs]);
  const currentCorrelationId = typeof task.correlationId === 'string' && task.correlationId.trim()
    ? task.correlationId.trim()
    : null;
  const currentExecutionId = currentCorrelationId
    ? [...logs].reverse().find((log) =>
      log.correlationId === currentCorrelationId
      && typeof log.executionId === 'string'
      && log.executionId.trim())?.executionId ?? ''
    : '';
  const { data: currentExecution, isFetching: currentExecutionFetching } = useGetAiExecution(currentExecutionId, {
    query: {
      queryKey: ['task-execution-projection', taskId, currentExecutionId],
      enabled: Boolean(currentExecutionId),
      refetchInterval: currentExecutionId ? 5_000 : false,
    },
  });
  const currentExecutionAttempt = task.status === 'running' && currentExecutionFetching
    ? null
    : currentExecution?.id === currentExecutionId
      && currentExecution.correlationId === currentCorrelationId
      && currentExecution.linkedTaskId === taskId
      ? currentExecution.attempt
      : null;
  const operationId = logs
    .map((log) => log.metadata?.operationId)
    .find((value): value is string => typeof value === 'string');
  const groupedActivity = useMemo(() => groupActivity(logs), [logs]);
  const activityItems = useMemo(() => visibleActivityItems(groupedActivity), [groupedActivity]);
  const plan = useMemo(
    () => taskPlan(task, logs, currentExecutionAttempt),
    [currentExecutionAttempt, logs, task],
  );
  const completedSteps = plan.filter((step) => step.status === 'done').length;
  const serverPercent = currentTaskProgressLogs(task, logs, currentExecutionAttempt)
    .filter((log) => log.progressPercent !== null && log.progressPercent !== undefined)
    .sort(logOrder)
    .at(-1)?.progressPercent;
  const elapsedMs = Math.max(0, new Date((task.completedAt ?? task.updatedAt)).getTime() - new Date(task.createdAt).getTime());
  const elapsed = `${Math.floor(elapsedMs / 60_000)} د ${Math.floor((elapsedMs % 60_000) / 1000)} ث`;
  const final = ['completed', 'failed', 'cancelled'].includes(taskStatus);
  const retryLiveUpdates = () => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    setReconnectAttempt(0);
    setConnectionState('reconnecting');
  };
  const verificationChecks = task.remediationPlan
    ? task.remediationPlan.verificationChecks ??
      task.remediationPlan.verificationSteps.map((guidance, index) => ({
        id: `rule-verification-${index + 1}`,
        kind: 'operator_attestation' as const,
        guidance,
      }))
    : [];
  const verificationHistory = task.verificationResult?.history ?? [];
  const recordCheck = (checkId: string, passed: boolean) => {
    const evidence = verificationEvidence[checkId]?.trim();
    recordVerification.mutate(
      { taskId, data: { checkId, passed, ...(evidence ? { evidence } : {}) } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
        onError: (err: unknown) => {
          toast({
            title: 'تعذر حفظ قرار التحقق',
            description: err instanceof Error ? err.message : 'تعذر تأكيد حفظ قرار هذا الفحص لدى الخادم.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {[
          ['الهدف', task.title],
          ['الحالة', taskStatusLabel(taskStatus)],
          ['المرحلة', task.phase || 'التنفيذ'],
          ['التقدم', serverPercent !== null && serverPercent !== undefined
            ? `${serverPercent}%`
            : plan.some((step) => step.status === 'active')
              ? 'غير محدد'
              : `${completedSteps}/${plan.length} خطوات`],
          ['الوقت المنقضي', elapsed],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-background p-3 min-w-0">
          <div className="text-[10px] tracking-wider text-muted-foreground">{label}</div>
            <div dir="auto" className="text-sm font-medium truncate mt-1">{value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mb-4 text-xs">
        <span className="text-muted-foreground">آخر تحديث مؤكد: {new Date(task.updatedAt).toLocaleString('ar-EG')}</span>
        {isRunning && (
          <span
            className={`flex items-center gap-1.5 ${connectionState === 'connected' ? 'text-emerald-500' : connectionState === 'exhausted' ? 'text-destructive' : 'text-yellow-500'}`}
            aria-live="polite"
          >
            {connectionState === 'connected' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {connectionState === 'connected'
              ? 'متصل'
              : connectionState === 'exhausted'
                ? 'انتهت محاولات إعادة الاتصال'
                : `جارٍ إعادة الاتصال… (المحاولة ${reconnectAttempt + 1} من ${MAX_RECONNECT_ATTEMPTS})`}
          </span>
        )}
      </div>
      {isRunning && connectionState === 'reconnecting' && (
        <div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300" role="status">
          انقطعت التحديثات الحية مؤقتًا، ونحاول إعادة الاتصال. انقطاع التحديثات ليس حكمًا بفشل المهمة.
        </div>
      )}
      {isRunning && connectionState === 'exhausted' && (
        <div
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs"
          role="alert"
          data-operation-id={operationId}
        >
          <p dir="rtl" className="font-medium text-destructive">تعذرت إعادة الاتصال بتحديثات المهمة الحية.</p>
          <p className="mt-1 text-muted-foreground">
            انتهت محاولات إعادة الاتصال. لم نغيّر حالة المهمة إلى فاشلة؛ حدّث سجلها لمعرفة أحدث حالة مؤكدة.
            {operationId && <> معرّف العملية: <bdi dir="ltr" className="font-mono">{safeTaskText(operationId)}</bdi>.</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={retryLiveUpdates} className="inline-flex items-center gap-1.5 font-medium text-foreground underline">
              <RotateCcw className="w-3.5 h-3.5" /> أعد الاتصال بالتحديثات الحية
            </button>
            <button type="button" onClick={() => void refetchLogs()} className="inline-flex items-center gap-1.5 font-medium text-foreground underline">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث سجل المهمة
            </button>
          </div>
        </div>
      )}
      <section aria-labelledby={`plan-${taskId}`} className="mb-5">
        <h4 id={`plan-${taskId}`} className="text-xs font-semibold tracking-wider text-muted-foreground mb-2">خطة التنفيذ</h4>
        <p className="mb-2 text-[10px] text-muted-foreground">
          هذه الحالات تصف تقدمًا مسجلًا، ولا تمنح قبولًا للنتيجة أو إثباتًا حديثًا.
        </p>
        <div className="border border-border rounded-lg divide-y divide-border bg-background">
          {plan.map((step, index) => (
            <div key={step.stage} className="flex items-start gap-3 p-3">
              <span className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${step.status === 'done' ? 'border-emerald-500 text-emerald-500' : step.status === 'active' ? 'border-primary text-primary animate-pulse' : step.status === 'failed' || step.status === 'blocked' ? 'border-destructive text-destructive' : 'border-border text-muted-foreground'}`}>
                {step.status === 'done' ? '✓' : step.status === 'failed' || step.status === 'blocked' ? '!' : index + 1}
              </span>
              <div className="min-w-0 flex-1">
              <div dir="rtl" className="text-sm font-medium">{step.title}</div>
                <div dir="auto" className="text-xs text-muted-foreground mt-0.5">{step.detail}</div>
                {(step.startedAt || step.percent !== null && step.percent !== undefined) && (
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    {step.startedAt && <span>بدأت {new Date(step.startedAt).toLocaleTimeString('ar-EG', { hour12: false })}</span>}
                    {stageDuration(step) && <span>المدة {stageDuration(step)}</span>}
                    {step.percent !== null && step.percent !== undefined && <span>{step.percent}% تقدم بحسب الخادم</span>}
                  </div>
                )}
              </div>
              <span className="ml-auto text-[10px] text-muted-foreground">{timelineStatusLabel(step.status)}</span>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby={`activity-${taskId}`}>
        <h4 id={`activity-${taskId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> سجل النشاط
          {isRunning && sseActive && <span className="ml-auto text-primary animate-pulse font-normal normal-case tracking-normal">تحديثات مباشرة</span>}
        </h4>
      <div className="bg-background border border-border rounded-lg text-xs overflow-auto max-h-72 p-3 space-y-2">
        {!isRunning && isLoading ? (
          <span dir="rtl" className="text-muted-foreground animate-pulse">جارٍ تحميل سجل النشاط…</span>
        ) : logsError ? (
          <div className="text-destructive">
            <p dir="rtl">تعذر تحميل سجل التنفيذ.</p>
            <button type="button" onClick={() => void refetchLogs()} className="mt-2 underline">إعادة تحميل السجل</button>
          </div>
        ) : logs.length === 0 ? (
          <span className="text-muted-foreground italic">
            {isRunning ? 'بانتظار نشاط مسجل من الخادم…' : 'لا يوجد نشاط مسجل في هذا العرض.'}
          </span>
        ) : (
          <>
            {groupedActivity.length > MAX_VISIBLE_ACTIVITY_ITEMS && (
              <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground" role="status">
                نعرض أول حدث مؤكد وآخر {MAX_VISIBLE_ACTIVITY_ITEMS - 1} من أصل {groupedActivity.length} سجل نشاط.
              </div>
            )}
            {activityItems.map((item) => (
              <details key={item.key} open={item.kind === 'warning' || item.kind === 'error'} className={`rounded-md border p-2 ${item.kind === 'error' ? 'border-destructive/40' : item.kind === 'warning' ? 'border-yellow-500/40' : 'border-border'}`}>
                <summary className="flex items-start gap-2 cursor-pointer list-none">
                  <span className={`text-base shrink-0 ${item.kind === 'error' ? 'text-destructive' : item.kind === 'warning' ? 'text-yellow-500' : ''}`}>{item.kind === 'result' ? '✓' : stepIcon(item.summary, item.kind === 'error' ? 'error' : item.kind === 'warning' ? 'warn' : 'info')}</span>
                  <span className="flex-1"><span className="font-medium">{item.label}</span><span dir="auto" className="text-muted-foreground"> — {item.summary}</span></span>
                  {item.count > 1 && <span className="text-muted-foreground">×{item.count}</span>}
                </summary>
                <div className="pl-6 pt-1 text-[10px] text-muted-foreground">وقت التسجيل: {new Date(item.timestamp).toLocaleTimeString('ar-EG', { hour12: false })}</div>
              </details>
            ))}
          </>
        )}
      </div>
      </section>
      {verificationChecks.length > 0 && (
        <section
          aria-labelledby={`operator-verification-${taskId}`}
          className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h4 id={`operator-verification-${taskId}`} className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> فحوص تتحقق منها بنفسك
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                هذه إرشادات من الخادم. نفّذ الفحص ثم سجّل ما لاحظته؛ لا يُنفّذ أي أمر يقترحه النموذج هنا. تسجيلك ليس اختبارًا آليًا أو إثبات قبول شاملًا.
              </p>
            </div>
            <span className={`text-[10px] uppercase font-semibold shrink-0 ${
              task.verificationResult?.passed ? 'text-emerald-500' : 'text-amber-500'
            }`}>
              {task.verificationResult?.passed ? 'اجتياز مسجل' : 'السجل غير مكتمل'}
            </span>
          </div>
          <div className="space-y-3">
            {verificationChecks.map((check) => {
              const result = task.verificationResult?.steps.find((step) => step.id === check.id);
              const evidence = verificationEvidence[check.id] ?? (taskStatus === 'verifying' ? result?.evidence ?? '' : '');
              const history = verificationHistory
                .filter((entry) => entry.checkId === check.id)
                .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));
              return (
                <div key={check.id} className="rounded-md border border-border bg-background p-3">
                  <div className="rounded-md border border-border/70 bg-secondary/20 p-2.5">
                    <div className="flex items-start gap-2 text-sm">
                      {result?.passed
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">القرار الحالي المسجل</div>
                        <div dir="auto" className="font-medium">{check.guidance}</div>
                        <div dir="auto" className="text-[11px] text-muted-foreground mt-1">
                          {result?.passed ? 'اجتاز بحسب القرار والدليل المسجلين' : result?.output ?? 'لا يوجد قرار مسجل بعد'}
                        </div>
                      </div>
                    </div>
                  </div>
                  {taskStatus === 'verifying' && (
                    <>
                      <textarea
                        aria-label={`دليل الفحص: ${check.guidance}`}
                        value={evidence}
                        onChange={(event) => setVerificationEvidence((previous) => ({ ...previous, [check.id]: event.target.value }))}
                        placeholder="صف ما لاحظته أو أضف مرجع دليل ضمن نطاق الفحص"
                        dir="auto"
                        maxLength={2000}
                        rows={2}
                        className="mt-2 w-full rounded border border-border bg-card px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                        disabled={recordVerification.isPending}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => recordCheck(check.id, true)}
                          disabled={recordVerification.isPending || evidence.trim().length === 0}
                          className="rounded border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          سجّل اجتياز الفحص
                        </button>
                        <button
                          type="button"
                          onClick={() => recordCheck(check.id, false)}
                          disabled={recordVerification.isPending}
                          className="rounded border border-amber-500/40 px-2.5 py-1 text-xs text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          سجّل فشل الفحص
                        </button>
                      </div>
                    </>
                  )}
                  <details className="mt-3 border-t border-border/70 pt-2" open={false}>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                      سجل قرارات التحقق ({history.length})
                    </summary>
                    {history.length === 0 ? (
                      <p dir="rtl" className="mt-2 text-[11px] text-muted-foreground italic">لا توجد قرارات تحقق سابقة مسجلة.</p>
                    ) : (
                      <ol className="mt-2 space-y-2">
                        {history.map((entry, index) => (
                          <li key={entry.id} className="rounded border border-border/70 px-2.5 py-2 text-xs">
                            <div className="flex items-center gap-2">
                              {entry.passed
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                : <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                              <span className="font-semibold">{entry.passed ? 'اجتاز' : 'لم يجتز'}</span>
                              <span className="text-muted-foreground">· القرار {history.length - index}</span>
                            </div>
                            <div dir="auto" className="mt-1 text-muted-foreground">
                              {entry.evidence ? safeTaskText(entry.evidence) : 'لا يوجد دليل مرفق بهذا القرار.'}
                            </div>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              بواسطة <bdi dir="auto">{safeTaskText(entry.actor, 'جهة غير معروفة')}</bdi> · {new Date(entry.recordedAt).toLocaleString('ar-EG')}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {final && (
        <section aria-labelledby={`report-${taskId}`} className="mt-5 rounded-lg border border-border bg-background p-4">
          <h4 id={`report-${taskId}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            {task.verificationResult?.passed ? <ShieldCheck className="w-4 h-4 text-emerald-500" /> : <FileCheck2 className="w-4 h-4 text-muted-foreground" />}
            التقرير النهائي
          </h4>
           <p className="text-sm font-medium">
             {taskStatus === 'completed' && task.verificationResult?.passed
               ? 'اكتملت المهمة وسجّل الخادم اجتياز التحقق.'
               : taskStatus === 'completed'
                 ? 'اكتملت المهمة، لكن لا يوجد اجتياز تحقق مسجل من الخادم.'
                 : taskStatus === 'cancelled'
                   ? 'أُلغيت المهمة قبل اكتمالها.'
                   : 'انتهت المهمة دون تأكيد اجتياز التحقق.'}
           </p>
          {task.verificationResult?.decision && (
            <div className="mt-2 text-xs text-muted-foreground">
              قرار التحقق: <bdi dir="ltr" className="font-semibold uppercase">{task.verificationResult.decision}</bdi>
            </div>
          )}
          {task.verificationResult?.steps?.length ? (
            <div className="mt-3 space-y-1">{task.verificationResult.steps.map((step) => (
              <div key={step.name} className="flex items-center gap-2 text-xs">
                {step.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
                <span dir="auto">{step.guidance ?? step.name}</span><span dir="auto" className="text-muted-foreground">— {safeTaskText(step.evidence ?? step.output, step.passed ? 'اجتاز' : 'لم يُؤكد')}</span>
              </div>
            ))}</div>
          ) : <p dir="rtl" className="text-xs text-muted-foreground mt-2">لا تتوفر تفاصيل تحقق مسجلة من الخادم. هذا لا يثبت أن المهمة لم تُختبر.</p>}
        </section>
      )}
    </div>
  );
}

// ─── Filter type aliases ──────────────────────────────────────────────────────
// Derived from the task_status and task_priority DB enums so the filter state
// is statically checked against the real API values — no `as any` casts needed.
type TaskStatusFilter = 'pending' | 'queued' | 'running' | 'verifying' | 'completed' | 'failed' | 'cancelled';
type TaskPriorityFilter = 'p0' | 'p1' | 'p2' | 'p3';
type TaskAcceptanceFilter = 'accepted' | 'interrupted' | 'failed' | 'recovery-required';

function acceptanceFilterKey(acceptance: TaskAcceptance): TaskAcceptanceFilter {
  if (acceptance.disposition?.recoveryState && acceptance.disposition.recoveryState !== 'NONE') {
    return 'recovery-required';
  }
  if (acceptance.outcome === 'SUCCEEDED') return 'accepted';
  if (acceptance.outcome === 'INTERRUPTED') return 'interrupted';
  return 'failed';
}

function TaskCreateDialog({
  projects,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  projects: Array<{ id: string | number; name: string }>;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (data: CreateTaskInput) => void;
}) {
  const [projectId, setProjectId] = useState(String(projects[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CreateTaskInput['priority']>('p2');
  const [fieldError, setFieldError] = useState('');

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(String(projects[0].id));
  }, [projectId, projects]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) {
      setFieldError('اختر مشروعًا أولًا.');
      return;
    }
    if (!title.trim()) {
      setFieldError('عنوان المهمة مطلوب.');
      return;
    }
    setFieldError('');
    onSubmit({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10" role="presentation">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-primary/25 bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="task-create-title" dir="rtl" lang="ar">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/80">مهمة / عمل جديد</p>
            <h2 id="task-create-title" className="mt-1 text-lg font-semibold">إضافة مهمة</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="إغلاق نافذة المهمة" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="space-y-4 px-5 py-5">
            {error ? (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <bdi dir="auto">{error instanceof Error ? error.message : 'تعذر إنشاء المهمة. حاول مرة أخرى.'}</bdi>
              </div>
            ) : null}
            <div>
              <label htmlFor="create-task-project" className="mb-1.5 block text-xs font-semibold text-muted-foreground">المشروع</label>
              <select id="create-task-project" data-testid="select-create-task-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="">اختر مشروعًا</option>
                {projects.map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="create-task-title" className="mb-1.5 block text-xs font-semibold text-muted-foreground">عنوان المهمة</label>
              <input id="create-task-title" data-testid="input-create-task-title" dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ما الذي يجب إنجازه؟" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary" />
            </div>
            <div>
              <label htmlFor="create-task-description" className="mb-1.5 block text-xs font-semibold text-muted-foreground">الوصف <span className="font-normal text-muted-foreground/70">(اختياري)</span></label>
              <textarea id="create-task-description" data-testid="input-create-task-description" dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="أضف سياقًا يساعد المتابع أو المساعد الذكي" className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary" />
            </div>
            <div>
              <label htmlFor="create-task-priority" className="mb-1.5 block text-xs font-semibold text-muted-foreground">الأولوية</label>
              <select id="create-task-priority" data-testid="select-create-task-priority" value={priority} onChange={(event) => setPriority(event.target.value as CreateTaskInput['priority'])} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="p0">P0 — حرجة</option>
                <option value="p1">P1 — عالية</option>
                <option value="p2">P2 — متوسطة</option>
                <option value="p3">P3 — منخفضة</option>
              </select>
            </div>
            {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">إلغاء</button>
            <button type="submit" disabled={saving || projects.length === 0} data-testid="button-submit-create-task" className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/25 disabled:cursor-wait disabled:opacity-60">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? 'جارٍ الإنشاء…' : 'إضافة المهمة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskEditDialog({
  task,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  task: { id: string; title: string; description?: string; priority: TaskPriorityFilter };
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (data: UpdateTaskInput) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState<TaskPriorityFilter>(task.priority);
  const [fieldError, setFieldError] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setFieldError('عنوان المهمة مطلوب.');
      return;
    }
    setFieldError('');
    onSubmit({
      title: title.trim(),
      // An explicit empty string clears an existing description in the PATCH API.
      description: description.trim(),
      priority,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10" role="presentation">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-primary/25 bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="task-edit-title" dir="rtl" lang="ar">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/80">مهمة / تعديل</p>
            <h2 id="task-edit-title" className="mt-1 text-lg font-semibold">تعديل المهمة</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="إغلاق نافذة المهمة" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="space-y-4 px-5 py-5">
            {error ? (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                <bdi dir="auto">{error instanceof Error ? error.message : 'تعذر تحديث المهمة. حاول مرة أخرى.'}</bdi>
              </div>
            ) : null}
            <div>
              <label htmlFor="edit-task-title" className="mb-1.5 block text-xs font-semibold text-muted-foreground">عنوان المهمة</label>
              <input id="edit-task-title" data-testid="input-edit-task-title" dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label htmlFor="edit-task-description" className="mb-1.5 block text-xs font-semibold text-muted-foreground">الوصف <span className="font-normal text-muted-foreground/70">(اختياري)</span></label>
              <textarea id="edit-task-description" data-testid="input-edit-task-description" dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label htmlFor="edit-task-priority" className="mb-1.5 block text-xs font-semibold text-muted-foreground">الأولوية</label>
              <select id="edit-task-priority" data-testid="select-edit-task-priority" value={priority} onChange={(event) => setPriority(event.target.value as TaskPriorityFilter)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="p0">P0 — حرجة</option>
                <option value="p1">P1 — عالية</option>
                <option value="p2">P2 — متوسطة</option>
                <option value="p3">P3 — منخفضة</option>
              </select>
            </div>
            {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">إلغاء</button>
            <button type="submit" disabled={saving} data-testid="button-submit-edit-task" className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/25 disabled:cursor-wait disabled:opacity-60">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Tasks() {
  const queryClient = useQueryClient();
  const requestedTaskId = new URLSearchParams(window.location.search).get('taskId') ?? '';
  const requestedProjectId = new URLSearchParams(window.location.search).get('projectId') ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [filterStatus, setFilterStatus] = useState<TaskStatusFilter | ''>('');
  const [filterPriority, setFilterPriority] = useState<TaskPriorityFilter | ''>('');
  const [filterAcceptance, setFilterAcceptance] = useState<TaskAcceptanceFilter | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedTask, setExpandedTask] = useState<string | null>(() => requestedTaskId || null);
  const [logsTab, setLogsTab] = useState<Record<string, 'details' | 'logs'>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<{
    id: string;
    title: string;
    description?: string;
    priority: TaskPriorityFilter;
  } | null>(null);
  const [deletingTask, setDeletingTask] = useState<{ id: string; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, error: projectError, refetch: refetchProjects } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const { data: requestedTask, isLoading: requestedTaskLoading, isError: requestedTaskError, error: taskTargetError } = useGetTask(requestedTaskId, {
    query: {
      queryKey: getGetTaskQueryKey(requestedTaskId),
      enabled: Boolean(requestedTaskId),
    },
  });
  const targetProjectId = selectedProjectId || requestedProjectId
    || (requestedTaskId ? requestedTask?.projectId : projects[0]?.id) || '';
  const projectId = projects.find((project) => project.id === targetProjectId)?.id;
  const listParams = { projectId, status: filterStatus || undefined, priority: filterPriority || undefined };
  const { data: rawTasks, isLoading: tasksLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useListTasks(
    listParams,
    {
      query: {
        queryKey: getListTasksQueryKey(listParams),
        enabled: Boolean(projectId),
      },
    },
  );
  // Query identity separates project/filter snapshots. Item timestamps cannot
  // order deletions or an empty list; use the accepted query result directly.
  const tasks = projectId ? (rawTasks ?? []).filter((task) => task.projectId === projectId) : [];
  if (
    requestedTaskId && requestedTask?.id === requestedTaskId
    && requestedTask.projectId === projectId
    && (!filterStatus || requestedTask.status === filterStatus)
    && (!filterPriority || requestedTask.priority === filterPriority)
    && !tasks.some((task) => task.id === requestedTaskId)
  ) {
    tasks.push(requestedTask);
  }
  const isLoading = projectsLoading || Boolean(requestedTaskId && requestedTaskLoading)
    || Boolean(projectId && tasksLoading);

  useEffect(() => {
    if (requestedTaskId && tasks?.some((task) => task.id === requestedTaskId)) {
      setExpandedTask(requestedTaskId);
    }
  }, [requestedTaskId, tasks]);

  const { toast } = useToast();
  const executeTask = useExecuteTask();
  const retryTask   = useRetryTask();
  const rollbackTask = useRollbackTask();
  const resumeTask = useAiResumeTask();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const taskAcceptanceIsCurrent = (task: (typeof tasks)[number]) =>
    !isRefetching && !resumeTask.isPending && task.status !== 'running';
  const visibleTasks = tasks?.filter((t) =>
    (!searchTerm ||
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(searchTerm.toLowerCase())) &&
    (!filterAcceptance ||
      (taskAcceptanceIsCurrent(t)
        && t.acceptance
        && acceptanceFilterKey(t.acceptance) === filterAcceptance)),
  ) ?? [];

  const handleAction = (action: 'execute' | 'retry' | 'rollback' | 'resume', taskId: string) => {
    const label = { execute: 'التنفيذ', retry: 'إعادة المحاولة', rollback: 'التراجع', resume: 'الاستئناف' }[action];
    const options = {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        void queryClient.invalidateQueries({ queryKey: getGetTaskLogsQueryKey(taskId) });
      },
      onError: (err: unknown) => {
        const description = err instanceof Error ? err.message : 'تعذر إتمام الطلب. راجع تفاصيل المهمة قبل المحاولة مجددًا.';
        toast({ title: `تعذر ${label}`, description, variant: 'destructive' });
      },
    };
    if (action === 'execute') executeTask.mutate({ taskId }, options);
    if (action === 'retry')   retryTask.mutate({ taskId }, options);
    if (action === 'rollback') rollbackTask.mutate({ taskId }, options);
    if (action === 'resume') resumeTask.mutate({ taskId }, options);
  };

  const getDetailTab = (taskId: string) => logsTab[taskId] ?? 'details';
  const setDetailTab = (taskId: string, tab: 'details' | 'logs') =>
    setLogsTab((prev) => ({ ...prev, [taskId]: tab }));

  const selectProject = (nextProjectId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('projectId', nextProjectId);
    url.searchParams.delete('taskId');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setSelectedProjectId(nextProjectId);
  };

  const handleCreateTask = (data: CreateTaskInput) => {
    createTask.mutate(
      { data },
      {
        onSuccess: (created) => {
          setCreateOpen(false);
          selectProject(created.projectId);
          void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast({ title: 'أُنشئت المهمة', description: `أُضيفت «${created.title}» إلى قائمة مهام المشروع.` });
        },
        onError: (err: unknown) => {
          toast({
            title: 'تعذر إنشاء المهمة',
            description: err instanceof Error ? err.message : 'رفض الخادم طلب إنشاء المهمة.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleUpdateTask = (data: UpdateTaskInput) => {
    if (!editingTask) return;
    const taskId = editingTask.id;
    updateTask.mutate(
      { taskId, data },
      {
        onSuccess: (updated) => {
          setEditingTask(null);
          void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
          toast({ title: 'حُفظ تعديل المهمة', description: `حُفظت تفاصيل «${updated.title}».` });
        },
        onError: (err: unknown) => {
          toast({
            title: 'تعذر تعديل المهمة',
            description: err instanceof Error ? err.message : 'رفض الخادم طلب تعديل المهمة.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleDeleteTask = () => {
    if (!deletingTask) return;
    const taskId = deletingTask.id;
    setDeleteError('');
    deleteTask.mutate(
      { taskId },
      {
        onSuccess: () => {
          setDeletingTask(null);
          setExpandedTask((current) => current === taskId ? null : current);
          setLogsTab((current) => {
            const next = { ...current };
            delete next[taskId];
            return next;
          });
          queryClient.removeQueries({ queryKey: getGetTaskQueryKey(taskId) });
          queryClient.removeQueries({ queryKey: getGetTaskLogsQueryKey(taskId) });
          void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast({ title: 'حُذفت المهمة', description: 'أُزيلت المهمة من قائمة العمل.' });
        },
        onError: (err: unknown) => {
          const message = err instanceof Error
            ? err.message
            : 'تعذر حذف المهمة. قد يكون لها تنفيذ جارٍ.';
          setDeleteError(message);
          toast({ title: 'تعذر حذف المهمة', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const StatusIcon = ({ status }: { status: string }) => {
    switch (status) {
      case 'completed':         return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'failed':            return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case 'running':
      case 'verifying':         return <Activity className="w-4 h-4 text-primary animate-pulse" />;
      default:                  return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const PriorityBadge = ({ priority }: { priority: string }) => {
    const colors: Record<string, string> = {
      p0: 'bg-destructive/20 text-destructive border-destructive/30',
      p1: 'bg-orange-500/20 text-orange-500 border-orange-500/30',
      p2: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
      p3: 'bg-secondary text-muted-foreground border-border',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${colors[priority] ?? colors.p3}`}>
        {priority}
      </span>
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div dir="rtl" lang="ar">
          <h1 className="text-2xl font-bold tracking-tight">المهام</h1>
          <p className="text-muted-foreground text-sm mt-1">
            تابع مهام المشروع وافتح تفاصيلها لمراجعة العمل والتحقق المسجل.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="مشروع المهام"
            data-testid="select-task-project"
            value={projectId ?? ''}
            onChange={(event) => {
              selectProject(event.target.value);
              setExpandedTask(null);
              setEditingTask(null);
              setDeletingTask(null);
              setCreateOpen(false);
            }}
            className="rounded-md border border-border bg-secondary px-3 py-2 text-sm"
          >
            {!projectId && <option value="">اختر مشروعًا</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" onClick={() => setCreateOpen(true)} data-testid="button-open-create-task" aria-label="مهمة جديدة" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <span className="text-base leading-none">+</span>
            مهمة جديدة
          </button>
          {projectId && <RefreshButton onRefresh={refetch} isRefreshing={isRefetching} lastUpdated={dataUpdatedAt} label="تحديث المهام" refreshingLabel="جارٍ التحديث…" updatedLabel="آخر تحديث:" />}
          <div dir="rtl" lang="ar" className="flex flex-wrap items-center gap-2 bg-secondary p-1 rounded-md border border-border">
            <select
              aria-label="تصفية المهام حسب الحالة"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as TaskStatusFilter | '')}
              className="bg-transparent text-sm px-2 py-1 outline-none text-foreground border-r border-border min-w-[120px]"
            >
              <option value="">كل الحالات</option>
              <option value="pending">بانتظار التنفيذ</option>
              <option value="running">قيد التنفيذ</option>
              <option value="verifying">قيد التحقق</option>
              <option value="completed">انتهت بحسب السجل</option>
              <option value="failed">فشل مسجل</option>
            </select>
            <select
              aria-label="تصفية المهام حسب الأولوية"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as TaskPriorityFilter | '')}
              className="bg-transparent text-sm px-2 py-1 outline-none text-foreground min-w-[100px]"
            >
              <option value="">كل الأولويات</option>
              <option value="p0">حرجة (P0)</option>
              <option value="p1">عالية (P1)</option>
              <option value="p2">متوسطة (P2)</option>
              <option value="p3">منخفضة (P3)</option>
            </select>
            <select
              aria-label="تصفية المهام حسب القبول"
              value={filterAcceptance}
              onChange={(e) => setFilterAcceptance(e.target.value as TaskAcceptanceFilter | '')}
              className="bg-transparent text-sm px-2 py-1 outline-none text-foreground min-w-[145px]"
            >
              <option value="">كل حالات القبول</option>
              <option value="accepted">قبول مسجل</option>
              <option value="interrupted">تنفيذ منقطع</option>
              <option value="failed">فشل مسجل</option>
              <option value="recovery-required">يتطلب استردادًا</option>
            </select>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="ابحث عن مهمة"
              placeholder="ابحث عن مهمة..."
              dir="auto"
              className="bg-card border border-border rounded-md pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                aria-label="مسح البحث عن المهام"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active filter badge */}
      {(searchTerm || filterAcceptance) && (
        <div className="shrink-0 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">يعرض الفلتر</span>
          <span className="font-semibold">{visibleTasks.length}</span>
          <span className="text-muted-foreground">من {tasks?.length ?? 0} مهمة في القائمة المحمّلة</span>
          {searchTerm && (
            <span className="bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 rounded font-mono">
              {searchTerm}
            </span>
          )}
          {filterAcceptance && (
            <span className="bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 rounded">
              {{ accepted: 'قبول مسجل', interrupted: 'تنفيذ منقطع', failed: 'فشل مسجل', 'recovery-required': 'يتطلب استردادًا' }[filterAcceptance]}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : projectsError ? (
          <RequestError title="تعذر تحميل المشاريع" retryLabel="إعادة المحاولة" message={projectError instanceof Error ? projectError.message : 'تعذر تحميل المشاريع.'} onRetry={() => void refetchProjects()} />
        ) : !projectId ? (
          <div role="status" className="rounded-xl border border-border p-6 text-sm">
            {requestedTaskId && requestedTaskError
              ? (taskTargetError instanceof Error ? taskTargetError.message : 'تعذر فتح المهمة المطلوبة.')
              : targetProjectId
                ? 'المشروع المطلوب غير متاح. اختر مشروعًا آخر صراحةً للمتابعة.'
                : 'اختر مشروعًا لعرض مهامه. يمكنك إنشاء مشروع من صفحة المشاريع.'}
          </div>
        ) : isError ? (
          <RequestError
            title="تعذر تحميل المهام"
            retryLabel="إعادة المحاولة"
            message={error instanceof Error ? error.message : 'تفاصيل المهام غير متاحة الآن.'}
            onRetry={() => void refetch()}
          />
        ) : visibleTasks.length === 0 ? (
          <div dir="rtl" lang="ar" role="status" className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <TerminalSquare className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {filterAcceptance
                ? `لا توجد مهام ضمن فلتر ${{
                    accepted: 'القبول المسجل', interrupted: 'التنفيذ المنقطع',
                    failed: 'الفشل المسجل', 'recovery-required': 'الاسترداد المطلوب',
                  }[filterAcceptance]}`
                : searchTerm ? 'لا توجد مهام تطابق بحثك' : filterStatus || filterPriority ? 'لا توجد مهام تطابق الفلاتر' : 'لا توجد مهام في هذا العرض'}
            </h3>
            <p className="text-muted-foreground text-sm">
              {filterAcceptance || searchTerm || filterStatus || filterPriority
                ? 'جرّب عبارة بحث أخرى أو أزل الفلاتر. هذه نتيجة العرض الحالي، لا حكم على كل مهام المشروع.'
                 : 'يمكنك إنشاء مهمة هنا، أو مراجعة المهام التي تنشأ عن مشكلات يكشفها فحص المشروع.'}
            </p>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <div
              key={task.id}
              className="bg-card border border-border rounded-xl overflow-hidden transition-all"
            >
              <div
                role="button"
                tabIndex={0}
                className="p-4 flex items-center gap-4 cursor-pointer hover:bg-secondary/30"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedTask(expandedTask === task.id ? null : task.id);
                  }
                }}
                aria-expanded={expandedTask === task.id}
                aria-controls={`task-details-${task.id}`}
                aria-label={`${expandedTask === task.id ? 'طي تفاصيل المهمة' : 'عرض تفاصيل المهمة'}: ${task.title}`}
              >
                <StatusIcon status={task.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{task.title}</span>
                    <PriorityBadge priority={task.priority} />
                    {taskAcceptanceIsCurrent(task) && task.acceptance && (() => {
                      const acceptance = acceptanceStatus(task.acceptance);
                      return (
                        <span
                          aria-label={`القبول: ${acceptance.label}`}
                          className={`rounded-full border border-current/25 px-2 py-0.5 text-[10px] font-semibold ${acceptance.className}`}
                        >
                          {acceptance.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-3">
                    <span
                      className={`uppercase font-bold ${
                        task.status === 'completed' ? 'text-emerald-500'
                        : task.status === 'failed'  ? 'text-destructive'
                        : task.status === 'running' ? 'text-primary'
                        : 'text-muted-foreground'
                      }`}
                    >
                      {taskStatusLabel(task.status)}
                    </span>
                    <span>•</span>
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                    {task.phase && (
                      <>
                        <span>•</span>
                        <span className="opacity-70">{task.phase}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {(task.status === 'pending' || task.status === 'queued') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('execute', task.id); }}
                      disabled={executeTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="بدء تنفيذ المهمة"
                      aria-label={`بدء تنفيذ المهمة: ${task.title}`}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('retry', task.id); }}
                      disabled={retryTask.isPending}
                      className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                      title="إعادة محاولة المهمة"
                      aria-label={`إعادة محاولة المهمة: ${task.title}`}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                  {task.status === 'completed' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAction('rollback', task.id); }}
                      disabled={rollbackTask.isPending}
                      className="p-1.5 text-muted-foreground hover:bg-secondary rounded transition-colors disabled:opacity-50"
                      title="التراجع عن المهمة"
                      aria-label={`التراجع عن المهمة: ${task.title}`}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingTask({
                        id: task.id,
                        title: task.title,
                        description: task.description ?? '',
                        priority: task.priority as TaskPriorityFilter,
                      });
                    }}
                    aria-label={`تعديل المهمة: ${task.title}`}
                    title="تعديل المهمة"
                    className="p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground rounded transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteError('');
                      setDeletingTask({ id: task.id, title: task.title });
                    }}
                    aria-label={`حذف المهمة: ${task.title}`}
                    title="حذف المهمة"
                    className="p-1.5 text-destructive/80 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expandedTask === task.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedTask === task.id && (
                <div id={`task-details-${task.id}`} className="border-t border-border bg-secondary/20">
                  {/* Tab bar */}
                  <div className="flex gap-1 p-3 pb-0">
                    {(['details', 'logs'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(task.id, tab)}
                        className={`text-xs px-3 py-1.5 rounded-t-md font-medium capitalize transition-colors ${
                          getDetailTab(task.id) === tab
                            ? 'bg-card border border-border border-b-card text-foreground -mb-px relative z-10'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'logs' ? <span className="flex items-center gap-1"><Terminal className="w-3 h-3" /> السجل</span> : 'التفاصيل'}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div className="p-4 pt-3 text-sm">
                    {getDetailTab(task.id) === 'details' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            Task Details
                          </h4>
                          {task.remediationPlan && (
                            <section
                              aria-labelledby={`remediation-${task.id}`}
                              className="mb-4 rounded-lg border border-primary/25 bg-primary/5 p-3"
                            >
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <h5 id={`remediation-${task.id}`} className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                                  <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                                  Remediation plan
                                </h5>
                                <span className={`text-[10px] rounded-full border px-2 py-0.5 font-semibold ${
                                  task.remediationPlan.status === 'verified'
                                    ? 'border-emerald-500/30 text-emerald-500'
                                    : task.remediationPlan.status === 'ready'
                                      ? 'border-primary/30 text-primary'
                                      : 'border-amber-500/30 text-amber-500'
                                }`}>
              {task.remediationPlan.status === 'verified'
                                    ? 'تم التحقق'
                                    : task.remediationPlan.status === 'ready'
                                      ? 'جاهزة للتنفيذ'
                                      : 'تحتاج إلى مراجعة'}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs mb-3">
                                <span className="font-mono font-semibold">{task.remediationPlan.ruleCode}</span>
                                <span className="text-muted-foreground">·</span>
                                <span>{task.remediationPlan.ruleTitle}</span>
                                <span className="rounded border border-border px-1.5 py-0.5 uppercase">{task.remediationPlan.severity}</span>
                                <span className="text-muted-foreground">{task.remediationPlan.occurrenceCount} تكرار</span>
                              </div>
                              {task.remediationPlan.fixDescription ? (
                                <p className="text-xs text-muted-foreground mb-3">
                                  <span className="font-semibold text-foreground">الإصلاح المقترح: </span>
                                  <span dir="auto">{task.remediationPlan.fixDescription}</span>
                                </p>
                              ) : (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                                  لا توجد إرشادات للإصلاح؛ راجع القاعدة قبل التنفيذ.
                                </p>
                              )}
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <div>
                                  <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">الأدلة</div>
                                  {task.remediationPlan.evidence.length > 0 ? (
                                    <div className="space-y-1.5">
                                      {task.remediationPlan.evidence.slice(0, 5).map((match, index) => (
                                        <div key={`${match.file}:${match.line}:${index}`} className="rounded border border-border bg-background px-2 py-1.5 text-[11px]">
                                          <div dir="ltr" className="font-mono">{match.file}:{match.line}</div>
                                          <div dir="auto" className="text-muted-foreground truncate">{match.snippet}</div>
                                        </div>
                                      ))}
                                      {task.remediationPlan.evidence.length > 5 && (
                                        <div className="text-[11px] text-muted-foreground">و{task.remediationPlan.evidence.length - 5} من الأدلة الأخرى</div>
                                      )}
                                    </div>
                                  ) : (
                                    <div dir="rtl" className="text-xs text-amber-600 dark:text-amber-400">لا تتوفر أدلة محفوظة لهذا النطاق.</div>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">التحقق المطلوب</div>
                                  {task.remediationPlan.verificationSteps.length > 0 ? (
                                    <ol className="space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                                      {task.remediationPlan.verificationSteps.map((step, index) => (
                                      <li key={`${step}:${index}`} dir="auto">{step}</li>
                                      ))}
                                    </ol>
                                  ) : (
                                    <div dir="rtl" className="text-xs text-amber-600 dark:text-amber-400">لا توجد خطوات تحقق مرفقة في هذا السجل.</div>
                                  )}
                                </div>
                              </div>
                              <div className="mt-3 text-[11px] text-muted-foreground font-mono">
                                مصدر الخطة: <bdi dir="ltr">{task.remediationPlan.source.type}</bdi>
                                {task.remediationPlan.source.revision
                                  ? <> · المراجعة <bdi dir="ltr">{task.remediationPlan.source.revision.slice(0, 12)}</bdi></>
                                  : ' · المراجعة غير متاحة'}
                              </div>
                              {task.status === 'verifying' &&
                                (task.remediationPlan.verificationChecks?.length ?? task.remediationPlan.verificationSteps.length) > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setDetailTab(task.id, 'logs')}
                                    className="mt-3 inline-flex items-center gap-1.5 rounded border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                                  >
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    نفّذ الفحوص وسجّل نتائجها
                                  </button>
                                )}
                            </section>
                          )}
                          {task.description && (
                            <p dir="auto" className="text-muted-foreground mb-3">{task.description}</p>
                          )}
                          {task.relatedFiles && task.relatedFiles.length > 0 && (
                            <div className="mb-4">
                              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                <FileCode className="w-3 h-3" /> الملفات ذات الصلة
                              </div>
                              <div className="space-y-1">
                                {task.relatedFiles.map((f, i) => (
                                  <div
                                    key={i}
                                    className="text-xs font-mono bg-background border border-border rounded px-2 py-1 truncate"
                                  >
                                    <bdi dir="ltr">{f}</bdi>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2 mt-4 font-mono">
                            <div>تاريخ الإنشاء: {new Date(task.createdAt).toLocaleString('ar-EG')}</div>
                            <div>المرحلة: <bdi dir="ltr">{task.phase || 'default'}</bdi></div>
                            <div>المحاولات: {task.retryCount || 0}/{task.maxRetries || 3}</div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                            بيانات التنفيذ
                          </h4>
                          <div className="mb-4 rounded-lg border border-border bg-background p-3">
                            <div className="text-xs text-muted-foreground mb-1">حدود ما يظهر هنا</div>
                            <div className="text-sm">يعرض هذا القسم النشاط ونتائج التحقق المسجلة. لا تُعرض التعليمات الداخلية أو تفاصيل تشخيص المزوّد.</div>
                          </div>
                          <TaskExecutionProjection taskId={task.id} />
                          <TaskAcceptancePanel
                            taskId={task.id}
                            taskStatus={task.status}
                            onResume={() => handleAction('resume', task.id)}
                            isResuming={resumeTask.isPending}
                          />
                          {(() => {
                            const receipt = parseExecutionReceipt(task.agentResponse);
                            if (!receipt) return null;
                            return (
                              <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span className="font-semibold">إيصال التنفيذ</span>
                                  <span className={receipt.terminalStatus === 'SUCCEEDED' ? 'text-emerald-500' : receipt.terminalStatus === 'BLOCKED' ? 'text-amber-500' : 'text-destructive'}>
                                    {receipt.terminalStatus ?? 'RECORDED'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-muted-foreground font-mono">
                                  <span>محاولة التنفيذ: {receipt.attempt ?? '—'}</span>
                                  <span>محاولات المزوّد: {receipt.attempts ?? 1}</span>
                                  <span>المدة: {receipt.durationMs != null ? `${receipt.durationMs} مللي ثانية` : '—'}</span>
                                </div>
                                <div className="mt-2 text-muted-foreground">
                                  لا تُعرض تفاصيل تشخيص المزوّد أو بيانات الوصول.
                                </div>
                                <ProviderRecoveryCard
                                  recovery={receipt}
                                  className="mt-3"
                                />
                                <TaskAnswerEvidencePanel receipt={receipt} />
                              </div>
                            );
                          })()}
                          {task.verificationResult && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-2">
                                خطوات التحقق:
                              </div>
                              <div className="space-y-2">
                                {task.verificationResult.steps.map((step, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2 text-sm bg-background border border-border rounded px-3 py-2"
                                  >
                                    {step.passed ? (
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                    ) : (
                                      <AlertTriangle className="w-4 h-4 text-destructive" />
                                    )}
                                    <span dir="auto" className="font-mono">{step.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <TaskLogsPanel task={task} taskStatus={task.status} />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {createOpen ? (
        <TaskCreateDialog
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          saving={createTask.isPending}
          error={createTask.error}
          onClose={() => {
            if (!createTask.isPending) setCreateOpen(false);
          }}
          onSubmit={handleCreateTask}
        />
      ) : null}
      {editingTask ? (
        <TaskEditDialog
          task={editingTask}
          saving={updateTask.isPending}
          error={updateTask.error}
          onClose={() => setEditingTask(null)}
          onSubmit={handleUpdateTask}
        />
      ) : null}
      {deletingTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-3 py-6 backdrop-blur-sm" role="presentation">
          <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="task-delete-title" aria-describedby="task-delete-description" dir="rtl" lang="ar">
            <div className="space-y-3 px-5 py-5">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <h2 id="task-delete-title" className="text-lg font-semibold">حذف المهمة؟</h2>
              </div>
              <p id="task-delete-description" className="text-sm text-muted-foreground">
                سيُحذف «<bdi dir="auto">{deletingTask.title}</bdi>» نهائيًا مع سجلات تنفيذه. لا يمكن التراجع عن ذلك.
              </p>
              {deleteError ? <p role="alert" dir="auto" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{deleteError}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeletingTask(null)} disabled={deleteTask.isPending} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40">إلغاء</button>
              <button type="button" onClick={handleDeleteTask} disabled={deleteTask.isPending} data-testid="button-confirm-delete-task" className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:cursor-wait disabled:opacity-60">
                {deleteTask.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                {deleteTask.isPending ? 'جارٍ الحذف…' : 'حذف المهمة'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
