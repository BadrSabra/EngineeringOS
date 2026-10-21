import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import {
  createTask,
  getListProjectsQueryKey,
  useApproveAiMissionGoal,
  useListProjects,
  useReplanAiMission,
  type CreateTaskInput as ApiCreateTaskInput,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Edit3,
  GitBranch,
  Layers3,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  TimerReset,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import {
  createGoal,
  createMission,
  continueMissionAgent,
  fetchMissionProjection,
  fetchMissions,
  Goal,
  GoalStatus,
  CreateGoalInput,
  bindMissionDelivery,
  createApplyMissionFromProposal,
  previewMissionPlanFromChat,
  CreateMissionInput,
  Mission,
  MissionPlanPreviewResult,
  MissionStatus,
  MissionProjection,
  MissionRequestError,
  type EngineeringAgentDecision,
  ProjectionEvent,
  ProjectionExecution,
  ProjectionTask,
  ProjectionWorkflow,
  updateGoal,
  updateMission,
  UpdateGoalInput,
  UpdateMissionInput,
} from '@/lib/ai-missions';
import MissionActionDialog, {
  type MissionActionConfirmation,
} from '@/components/MissionActionDialog';
import { MissionAgentProjectionSummary } from '@/components/MissionAgentProjectionSummary';
import { ResultDetailsSummary } from '@/components/ResultDetailsSummary';
import { buildMissionOriginChatHref } from '@/lib/mission-chat-link';

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

type ChatHandoffProjection = NonNullable<MissionProjection['agentControl']>['handoff'];

function chatHandoffHref(
  projectId: string,
  missionId: string,
  handoff: ChatHandoffProjection,
): string | null {
  return buildMissionOriginChatHref({
    projectId,
    missionId,
    sessionId: handoff.sessionId,
    messageId: handoff.assistantMessageId ?? handoff.messageId,
  });
}

function compactId(value: string) {
  return value.length > 24 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

type AcceptedProjectQueryHandoffSource = {
  sessionId: string;
  messageId: string;
  assistantMessageId: string;
  executionId: string;
  acceptanceId: string;
  evidenceSnapshotId: string;
  sourceRevision: string;
  acceptedClaimRefs: string[];
  planHash: string;
};

function readAcceptedProjectQueryHandoffSource(
  policy: unknown,
): AcceptedProjectQueryHandoffSource | null {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
  const handoffSource = (policy as Record<string, unknown>).handoffSource;
  if (!handoffSource || typeof handoffSource !== 'object' || Array.isArray(handoffSource)) return null;
  const source = handoffSource as Record<string, unknown>;
  const requiredStrings = [
    'sessionId',
    'messageId',
    'assistantMessageId',
    'executionId',
    'acceptanceId',
    'evidenceSnapshotId',
    'sourceRevision',
    'planHash',
  ] as const;
  if (
    source.kind !== 'chat'
    || source.sourceType !== 'accepted_project_query'
    || requiredStrings.some((key) => typeof source[key] !== 'string' || !source[key].trim())
    || !Array.isArray(source.acceptedClaimRefs)
    || source.acceptedClaimRefs.length === 0
    || source.acceptedClaimRefs.length > 12
    || source.acceptedClaimRefs.some((claim) => typeof claim !== 'string' || !claim.trim())
  ) {
    return null;
  }
  const acceptedClaimRefs = source.acceptedClaimRefs as string[];
  if (new Set(acceptedClaimRefs).size !== acceptedClaimRefs.length) return null;
  return {
    sessionId: source.sessionId as string,
    messageId: source.messageId as string,
    assistantMessageId: source.assistantMessageId as string,
    executionId: source.executionId as string,
    acceptanceId: source.acceptanceId as string,
    evidenceSnapshotId: source.evidenceSnapshotId as string,
    sourceRevision: source.sourceRevision as string,
    acceptedClaimRefs,
    planHash: source.planHash as string,
  };
}

function displayJsonValue(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function errorStatus(error: unknown) {
  return error instanceof MissionRequestError ? error.status : null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeProjection(value: MissionProjection): MissionProjection {
  const goals = Array.isArray(value?.goals)
    ? value.goals.filter((item) => item && item.goal).map((item) => ({
        ...item,
        tasks: Array.isArray(item.tasks) ? item.tasks : [],
        workflows: Array.isArray(item.workflows) ? item.workflows : [],
        executions: Array.isArray(item.executions) ? item.executions : [],
        events: Array.isArray(item.events) ? item.events : [],
      }))
    : [];
  const returnedTasks = goals.reduce((sum, item) => sum + item.tasks.length, 0);
  const returnedWorkflows = goals.reduce((sum, item) => sum + item.workflows.length, 0);
  const returnedExecutions = goals.reduce((sum, item) => sum + item.executions.length, 0);
  const returnedEvents = goals.reduce((sum, item) => sum + item.events.length, 0);
  return {
    ...value,
    goals,
    counts: {
      goals: value?.counts?.goals ?? goals.length,
      tasks: value?.counts?.tasks ?? returnedTasks,
      workflows: value?.counts?.workflows ?? returnedWorkflows,
      executions: value?.counts?.executions ?? returnedExecutions,
      events: value?.counts?.events ?? returnedEvents,
    },
  };
}

function statusTone(status: string) {
  if (['active', 'running', 'verifying', 'completed'].includes(status)) {
    return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
  }
  if (['blocked', 'failed', 'cancelled', 'needs_replan'].includes(status)) {
    return 'border-rose-400/25 bg-rose-400/10 text-rose-300';
  }
  if (['waiting', 'waiting_for_event', 'waiting_for_approval'].includes(status)) {
    return 'border-amber-300/25 bg-amber-300/10 text-amber-200';
  }
  return 'border-slate-400/20 bg-slate-400/10 text-slate-300';
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${statusTone(status)}`}>
      {status}
    </span>
  );
}

function missionStatusMessage(status: MissionStatus) {
  if (status === 'draft') return 'Ready to start';
  if (status === 'active') return 'Working on your objective';
  if (status === 'waiting') return 'Waiting for the next step';
  if (status === 'needs_replan') return 'Needs your attention';
  if (status === 'completed') return 'Mission complete';
  if (status === 'failed') return 'Execution failed';
  if (status === 'cancelled') return 'Mission cancelled';
  return 'Mission is blocked';
}

function Metric({ label, value, accent = 'text-slate-100' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="border-l border-slate-700/70 pl-3 first:border-l-0 first:pl-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800/80 ${className}`} />;
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Layers3;
  title: string;
  description: string;
}) {
  return (
    <div dir="rtl" lang="ar" className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-500">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function ErrorState({
  title,
  message,
  forbidden = false,
  onRetry,
}: {
  title: string;
  message: string;
  forbidden?: boolean;
  onRetry: () => void;
}) {
  return (
    <div dir="rtl" lang="ar" role="alert" className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-rose-300">
        {forbidden ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p dir="auto" className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="button-retry-missions"
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/50 hover:bg-slate-700"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        إعادة المحاولة
      </button>
    </div>
  );
}

function CollectionLine({
  icon: Icon,
  label,
  value,
  empty,
}: {
  icon: typeof Code2;
  label: string;
  value: string;
  empty?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-slate-800/80 py-2.5 last:border-b-0">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-slate-600">{label}</p>
        <p className={`mt-0.5 truncate text-xs ${empty ? 'text-slate-600' : 'text-slate-300'}`}>{value}</p>
      </div>
    </div>
  );
}

function TaskList({ tasks }: { tasks: ProjectionTask[] }) {
  if (tasks.length === 0) {
    return <p dir="rtl" className="text-xs text-slate-600">لا توجد مهام مرتبطة في هذا العرض.</p>;
  }
  return (
    <div className="space-y-1.5">
      {tasks.map((task) => (
        <div key={task.id} data-testid={`row-task-${task.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-cyan-300/70" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{task.title}</span>
          <span className="font-mono text-[10px] text-slate-600">{task.phase ?? '—'}</span>
          <StatusPill status={task.status} />
        </div>
      ))}
    </div>
  );
}

function WorkflowList({ workflows }: { workflows: ProjectionWorkflow[] }) {
  if (workflows.length === 0) {
    return <p dir="rtl" className="text-xs text-slate-600">لا توجد مسارات عمل مرتبطة في هذا العرض.</p>;
  }
  return (
    <div className="space-y-1.5">
      {workflows.map((workflow) => (
        <div key={workflow.id} data-testid={`row-workflow-${workflow.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-300/70" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{workflow.name}</span>
          <span className="font-mono text-[10px] text-slate-600">{workflow.currentPhase ?? '—'}</span>
          <StatusPill status={workflow.status} />
        </div>
      ))}
    </div>
  );
}

function ExecutionList({ executions }: { executions: ProjectionExecution[] }) {
  if (executions.length === 0) {
    return <p dir="rtl" className="text-xs text-slate-600">لا توجد تشغيلات مرتبطة بهذه الخطوة في هذا العرض.</p>;
  }
  return (
    <div className="space-y-1.5">
      {executions.map((execution) => (
        <div key={execution.id} data-testid={`row-execution-${execution.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <TimerReset className="h-3.5 w-3.5 shrink-0 text-amber-200/70" />
          <span className="font-mono text-[10px] text-slate-500">{compactId(execution.id)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">attempt {execution.attempt}</span>
          <StatusPill status={execution.status} />
        </div>
      ))}
    </div>
  );
}

function EventList({ events }: { events: ProjectionEvent[] }) {
  if (events.length === 0) {
    return <p dir="rtl" className="text-xs text-slate-600">لا توجد أحداث مرتبطة بهذه الخطوة في هذا العرض.</p>;
  }
  return (
    <div className="space-y-1.5">
      {events.map((event) => (
        <div key={event.id} data-testid={`row-event-${event.id}`} className="rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <CircleDot className={`h-3.5 w-3.5 shrink-0 ${event.severity === 'error' || event.severity === 'critical' ? 'text-rose-300' : 'text-cyan-300/70'}`} />
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">{event.type}</span>
            <span className="ml-auto font-mono text-[10px] text-slate-600">{formatDate(event.timestamp, true)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{event.message}</p>
        </div>
      ))}
    </div>
  );
}

const goalStatuses: GoalStatus[] = ['queued', 'planning', 'running', 'waiting_for_event', 'waiting_for_approval', 'verifying', 'needs_replan', 'completed', 'blocked', 'failed', 'cancelled'];
const priorities: NonNullable<CreateGoalInput['priority']>[] = ['p0', 'p1', 'p2', 'p3'];

// Display-only Arabic labels. Option values stay the original enum strings.
const priorityLabels: Record<string, string> = {
  p0: 'P0 — حرجة',
  p1: 'P1 — عالية',
  p2: 'P2 — متوسطة',
  p3: 'P3 — منخفضة',
};

const goalStatusLabels: Record<string, string> = {
  queued: 'في الانتظار',
  planning: 'قيد التخطيط',
  running: 'قيد التنفيذ',
  waiting_for_event: 'بانتظار حدث',
  waiting_for_approval: 'بانتظار الموافقة',
  verifying: 'قيد التحقق',
  needs_replan: 'تحتاج إعادة تخطيط',
  completed: 'مكتملة',
  blocked: 'متوقفة',
  failed: 'فشلت',
  cancelled: 'ملغاة',
};

function goalAcceptanceSummary(outcomeContract: unknown) {
  if (!outcomeContract || typeof outcomeContract !== 'object' || Array.isArray(outcomeContract)) {
    return null;
  }
  const acceptance = (outcomeContract as Record<string, unknown>).acceptance;
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) return null;
  const value = acceptance as Record<string, unknown>;
  return typeof value.verdict === 'string'
    ? {
        verdict: value.verdict,
        outcome: typeof value.outcome === 'string' ? value.outcome : undefined,
      }
    : null;
}

function GoalAcceptanceNotice({ goal }: { goal: Goal }) {
  const acceptance = goalAcceptanceSummary(goal.outcomeContract);
  if (!acceptance) return null;
  const proven = acceptance.verdict === 'PROVEN';
  const incomplete = acceptance.verdict === 'INCOMPLETE';
  const label = proven
    ? 'الإثبات المسجل: PROVEN (غير معاد التحقق)'
    : incomplete
      ? 'الإثبات غير مكتمل (حالة مسجلة)'
      : acceptance.verdict === 'UNAVAILABLE'
        ? 'حكم الإثبات المسجل غير متاح'
        : acceptance.verdict === 'FAILED'
          ? 'الإثبات المسجل لم يستوف الشروط'
          : `حالة الإثبات: ${acceptance.verdict}`;
  const explanation = proven
    ? 'هذه قيمة قبول محفوظة في سجل الهدف؛ لم يُعَد فحص Canonical Proof الحالي في هذا العرض.'
    : incomplete
      ? 'الأدلة المطلوبة غير مكتملة؛ نجاح التنفيذ وحده لا يثبت النتيجة. هذه قيمة محفوظة وليست فحصاً حديثاً.'
      : acceptance.verdict === 'UNAVAILABLE'
        ? 'لم يتوفر حكم موثوق محفوظ على الأدلة لهذه المحاولة؛ لا يُعاد تحميل الإثبات هنا.'
        : acceptance.verdict === 'FAILED'
          ? 'لم تثبت الأدلة المحفوظة أن شروط هذه الخطوة تحققت.'
          : 'هذه قيمة محفوظة؛ راجع إثبات المحاولة الحالي قبل اعتبار الخطوة مكتملة.';
  const tone = proven
    ? 'border-emerald-300/20 bg-emerald-300/5 text-emerald-100'
    : incomplete
      ? 'border-amber-300/20 bg-amber-300/5 text-amber-100'
      : 'border-rose-300/20 bg-rose-300/5 text-rose-100';

  return (
    <div
      data-testid={`goal-acceptance-notice-${goal.id}`}
      className={`mt-2 rounded-md border px-2.5 py-2 ${tone}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-semibold">حالة الإثبات</span>
        <span data-testid={`goal-acceptance-verdict-${goal.id}`} className="font-semibold">
          {label}
        </span>
        {acceptance.outcome === 'SUCCEEDED' ? (
          <span className="text-slate-300">اكتمل التنفيذ</span>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] leading-4 opacity-80">{explanation}</p>
    </div>
  );
}

function jsonText(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function localDateValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function isoDateOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function parseJsonObject(value: string, label: string): { value?: Record<string, unknown>; error?: string } {
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `يجب أن يكون حقل «${label}» كائن JSON.` };
    }
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { error: `حقل «${label}» يحتوي على JSON غير صالح.` };
  }
}

function FieldLabel({ htmlFor, children, optional = false }: { htmlFor: string; children: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
      {children} {optional ? <span className="text-slate-600">/ اختياري</span> : null}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  dir = 'auto',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  dir?: 'auto' | 'ltr' | 'rtl';
}) {
  const className = "w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-700 focus:border-cyan-400/70 focus:ring-1 focus:ring-cyan-400/20";
  return multiline ? (
    <textarea id={id} data-testid={id} dir={dir} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className={`${className} resize-y leading-5`} />
  ) : (
    <input id={id} data-testid={id} dir={dir} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={className} />
  );
}

function JsonField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} optional>{label}</FieldLabel>
      <textarea
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        dir="ltr"
        spellCheck={false}
        placeholder={'{\n  "key": "value"\n}'}
        aria-invalid={Boolean(error)}
        className={`w-full resize-y rounded-md border bg-slate-950/70 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none transition-colors placeholder:text-slate-700 focus:ring-1 ${error ? 'border-rose-400/60 focus:ring-rose-400/20' : 'border-slate-700 focus:border-cyan-400/70 focus:ring-cyan-400/20'}`}
      />
      {error ? <p className="mt-1 text-xs text-rose-300">{error}</p> : <p className="mt-1 text-[10px] text-slate-600">كائن JSON فقط (بالمفاتيح الإنجليزية كما هي). اتركه فارغًا لتجاهله.</p>}
    </div>
  );
}

function EditorModal({
  title,
  eyebrow,
  error,
  saving,
  onClose,
  onSubmit,
  children,
  submitLabel,
  submitDisabled = false,
}: {
  title: string;
  eyebrow: string;
  error: unknown;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const status = errorStatus(error);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020811]/80 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10" role="presentation">
      <div className="flex max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-cyan-400/20 bg-[#0b1725] shadow-2xl shadow-cyan-950/20 sm:max-h-[calc(100dvh-5rem)]" role="dialog" aria-modal="true" aria-labelledby="mission-editor-title" dir="rtl" lang="ar">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/70">{eyebrow}</p>
            <h2 id="mission-editor-title" className="mt-1 text-lg font-semibold text-slate-100">{title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="إغلاق النافذة" data-testid="button-close-editor" className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5" data-testid="editor-scroll-fields">
            {error ? (
              <div role="alert" className="flex items-start gap-2.5 rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2.5 text-xs text-rose-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <span>{status === 403 ? 'حسابك لا يملك صلاحية تعديل هذا السجل. ' : ''}<bdi dir="auto">{errorMessage(error, 'رفض الخادم هذا التغيير. راجع الحقول ثم حاول مرة أخرى.')}</bdi></span>
              </div>
            ) : null}
            {children}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950/25 px-5 py-4 sm:flex-row sm:justify-end" data-testid="editor-fixed-actions">
            <button type="button" onClick={onClose} disabled={saving} data-testid="button-cancel-editor" className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40">إلغاء</button>
            <button type="submit" disabled={saving || submitDisabled} data-testid="button-save-editor" className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/25 disabled:cursor-wait disabled:opacity-60">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? 'جارٍ الحفظ…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MissionEditor({
  projectId,
  mission,
  saving,
  error,
  onClose,
  onSave,
}: {
  projectId: string;
  mission?: Mission | null;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: CreateMissionInput | UpdateMissionInput) => void;
}) {
  const editing = Boolean(mission);
  const [title, setTitle] = useState(mission?.title ?? '');
  const [intent, setIntent] = useState(mission?.intent ?? '');
  const status = mission?.status ?? 'draft';
  const [autonomyPolicy, setAutonomyPolicy] = useState(jsonText(mission?.autonomyPolicy));
  const [budget, setBudget] = useState(jsonText(mission?.budget));
  const [deadline, setDeadline] = useState(localDateValue(mission?.deadline));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [planPreview, setPlanPreview] = useState<MissionPlanPreviewResult | null>(null);
  const [planPreviewError, setPlanPreviewError] = useState<string | null>(null);
  const [planPreviewLoading, setPlanPreviewLoading] = useState(false);
  const previewMatchesIntent = Boolean(
    !editing && planPreview && planPreview.objective === intent.trim(),
  );

  const reviewPlan = async () => {
    if (editing || !intent.trim() || planPreviewLoading) return;
    setPlanPreviewLoading(true);
    setPlanPreviewError(null);
    try {
      const preview = await previewMissionPlanFromChat({
        projectId,
        message: intent.trim(),
        objective: intent.trim(),
      });
      setPlanPreview(preview);
    } catch (error) {
      setPlanPreviewError(
        error instanceof Error ? error.message : 'تعذرت معاينة الخطة. حاول مرة أخرى.',
      );
    } finally {
      setPlanPreviewLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = 'العنوان مطلوب.';
    if (!intent.trim()) errors.intent = 'اكتب ما تريد تحقيقه.';
    if (!editing && !previewMatchesIntent) {
      errors.plan = 'راجع الخطة الحالية قبل بدء الهدف الرئيسي.';
    }
    const policy = parseJsonObject(autonomyPolicy, 'سياسة الاستقلالية');
    const budgetValue = parseJsonObject(budget, 'الميزانية');
    if (policy.error) errors.autonomyPolicy = policy.error;
    if (budgetValue.error) errors.budget = budgetValue.error;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (editing) {
      onSave({ title: title.trim(), intent: intent.trim(), status, autonomyPolicy: policy.value, budget: budgetValue.value, deadline: isoDateOrNull(deadline) });
    } else {
      onSave({
        projectId,
        title: title.trim(),
        intent: intent.trim(),
        status: 'active',
        autonomyPolicy: policy.value,
        budget: budgetValue.value,
        deadline: isoDateOrNull(deadline),
        expectedPlanHash: planPreview!.plan.planHash,
      });
    }
  };

  return (
      <EditorModal
        title={editing ? 'تعديل الهدف الرئيسي' : 'ابدأ هدفًا رئيسيًا'}
        eyebrow={editing ? 'الهدف الرئيسي / تعديل' : 'الهدف الرئيسي / جاهز للبدء'}
        error={error}
        saving={saving}
        onClose={onClose}
        onSubmit={submit}
        submitLabel={editing ? 'حفظ التفاصيل' : previewMatchesIntent ? 'تأكيد الخطة وبدء الهدف' : 'ابدأ بعد مراجعة الخطة'}
        submitDisabled={!editing && !previewMatchesIntent}
      >
      <div>
        <FieldLabel htmlFor="mission-title">العنوان</FieldLabel>
        <TextInput id="mission-title" value={title} onChange={setTitle} placeholder="هدف واضح له نهاية يمكن التحقق منها" />
        {fieldErrors.title ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.title}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="mission-intent">ما الذي تريد تحقيقه؟</FieldLabel>
        <TextInput
          id="mission-intent"
          value={intent}
          onChange={(value) => {
            setIntent(value);
            setPlanPreview(null);
            setPlanPreviewError(null);
          }}
          multiline
          rows={3}
          placeholder="صف النتيجة التي يجب أن تصبح حقيقة عند انتهاء هذا الهدف"
        />
        {fieldErrors.intent ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.intent}</p> : null}
      </div>
      {!editing ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void reviewPlan()}
            disabled={saving || planPreviewLoading || !intent.trim()}
            data-testid="button-preview-mission-plan"
            className="inline-flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {planPreviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
            {planPreviewLoading ? 'جارٍ إعداد الخطة…' : 'راجع الخطة قبل البدء'}
          </button>
          {planPreviewError ? (
            <p role="alert" className="text-xs text-rose-300">{planPreviewError}</p>
          ) : null}
          {fieldErrors.plan ? <p className="text-xs text-rose-300">{fieldErrors.plan}</p> : null}
          {planPreview && previewMatchesIntent ? (
            <div data-testid="mission-plan-preview" className="rounded-md border border-cyan-300/20 bg-cyan-300/5 p-3">
              <p className="text-xs font-semibold text-cyan-100">الخطة التي ستبدأ بعد تأكيدك</p>
              <ol className="mt-2 space-y-2">
                {planPreview.plan.steps.map((planStep, index) => (
                  <li key={planStep.id} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-slate-500">{index + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-200">{planStep.title}</span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">
                        {planStep.readOnly
                          ? 'قراءة فقط'
                          : planStep.approvalRequired
                            ? 'تغيير يتطلب موافقتك'
                            : 'خطوة تنفيذية'}
                        {planStep.files.length > 0 ? ` · الملفات: ${planStep.files.join('، ')}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 border-t border-cyan-300/10 pt-2 text-[10px] leading-4 text-slate-400">
                لم يبدأ التنفيذ بعد. سيبدأ فقط بعد تأكيد الخطة.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <div className="rounded-md border border-cyan-400/15 bg-cyan-300/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
          يُدار تنفيذ الهدف الرئيسي تلقائيًا من مساحة العمل الخاصة به. تعديل التفاصيل هنا لا يغيّر حالته.
        </div>
      ) : null}
      <details data-testid="details-mission-advanced" className="rounded-md border border-slate-800 bg-slate-950/25 px-3">
        <summary className="cursor-pointer py-3 text-xs font-semibold text-slate-400">إعدادات متقدمة (اختيارية)</summary>
        <div className="space-y-4 pb-3">
          <div>
            <FieldLabel htmlFor="mission-deadline" optional>الموعد النهائي</FieldLabel>
            <input id="mission-deadline" type="datetime-local" dir="ltr" value={deadline} onChange={(event) => setDeadline(event.target.value)} data-testid="input-mission-deadline" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70" />
            <p className="mt-1 text-[10px] text-slate-600">اتركه فارغًا إن لم يكن هناك موعد نهائي.</p>
          </div>
          <JsonField id="mission-autonomy-policy" label="سياسة الاستقلالية" value={autonomyPolicy} onChange={setAutonomyPolicy} error={fieldErrors.autonomyPolicy} />
          <JsonField id="mission-budget" label="الميزانية" value={budget} onChange={setBudget} error={fieldErrors.budget} />
        </div>
      </details>
    </EditorModal>
  );
}

function GoalEditor({
  goal,
  availableParents,
  saving,
  error,
  onClose,
  onSave,
}: {
  goal?: Goal | null;
  availableParents: Goal[];
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: CreateGoalInput | UpdateGoalInput) => void;
}) {
  const editing = Boolean(goal);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [parentGoalId, setParentGoalId] = useState(goal?.parentGoalId ?? '');
  const [priority, setPriority] = useState<NonNullable<CreateGoalInput['priority']>>(goal?.priority && priorities.includes(goal.priority as NonNullable<CreateGoalInput['priority']>) ? goal.priority as NonNullable<CreateGoalInput['priority']> : 'p2');
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'queued');
  const [successCriteria, setSuccessCriteria] = useState(jsonText(goal?.successCriteria));
  const [evidenceContract, setEvidenceContract] = useState(jsonText(goal?.evidenceContract));
  const [outcomeContract, setOutcomeContract] = useState(jsonText(goal?.outcomeContract));
  const [nextAction, setNextAction] = useState(jsonText(goal?.nextAction));
  const [blockedReason, setBlockedReason] = useState(goal?.blockedReason ?? '');
  const [nextWakeAt, setNextWakeAt] = useState(localDateValue(goal?.nextWakeAt));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = 'العنوان مطلوب.';
    const parsed = {
      successCriteria: parseJsonObject(successCriteria, 'معايير النجاح'),
      evidenceContract: parseJsonObject(evidenceContract, 'عقد الأدلة'),
      outcomeContract: parseJsonObject(outcomeContract, 'عقد النتيجة'),
      nextAction: parseJsonObject(nextAction, 'الإجراء التالي'),
    };
    Object.entries(parsed).forEach(([key, result]) => {
      if (result.error) errors[key] = result.error;
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      parentGoalId: parentGoalId || null,
      priority,
      successCriteria: parsed.successCriteria.value,
      evidenceContract: parsed.evidenceContract.value,
      outcomeContract: parsed.outcomeContract.value,
      nextAction: parsed.nextAction.value,
    };
    onSave(editing ? { ...common, status, blockedReason: blockedReason.trim() || null, nextWakeAt: isoDateOrNull(nextWakeAt) } : common);
  };

  return (
    <EditorModal title={editing ? 'تعديل خطوة الهدف' : 'إضافة خطوة للهدف'} eyebrow={editing ? 'خطوة الهدف / تعديل' : 'خطوة الهدف / جديدة'} error={error} saving={saving} onClose={onClose} onSubmit={submit} submitLabel={editing ? 'حفظ الخطوة' : 'إضافة الخطوة'}>
      <div>
        <FieldLabel htmlFor="goal-title">العنوان</FieldLabel>
        <TextInput id="goal-title" value={title} onChange={setTitle} placeholder="نتيجة محددة ضمن الهدف الرئيسي" />
        {fieldErrors.title ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.title}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="goal-description" optional>الوصف</FieldLabel>
        <TextInput id="goal-description" value={description} onChange={setDescription} multiline rows={2} placeholder="سياق يساعد من يتابع العمل والتشغيلات القادمة" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="goal-priority">الأولوية</FieldLabel>
          <select id="goal-priority" value={priority} onChange={(event) => setPriority(event.target.value as NonNullable<CreateGoalInput['priority']>)} data-testid="select-goal-priority" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
            {priorities.map((option) => <option key={option} value={option}>{priorityLabels[option] ?? option}</option>)}
          </select>
        </div>
        {editing ? (
          <div>
            <FieldLabel htmlFor="goal-status">الحالة</FieldLabel>
            <select id="goal-status" value={status} onChange={(event) => setStatus(event.target.value as GoalStatus)} data-testid="select-goal-status" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
              {goalStatuses.map((option) => <option key={option} value={option}>{goalStatusLabels[option] ?? option}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <details data-testid="details-goal-advanced" className="rounded-md border border-slate-800 bg-slate-950/25 px-3">
        <summary className="cursor-pointer py-3 text-xs font-semibold text-slate-400">إعدادات متقدمة (اختيارية)</summary>
        <div className="space-y-4 pb-3">
          <div>
            <FieldLabel htmlFor="goal-parent" optional>الخطوة الأم</FieldLabel>
            <select id="goal-parent" value={parentGoalId} onChange={(event) => setParentGoalId(event.target.value)} data-testid="select-goal-parent" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
              <option value="">بدون خطوة أم</option>
              {availableParents.filter((item) => item.id !== goal?.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="goal-next-wake" optional>موعد المتابعة التالي</FieldLabel>
                <input id="goal-next-wake" type="datetime-local" dir="ltr" value={nextWakeAt} onChange={(event) => setNextWakeAt(event.target.value)} data-testid="input-goal-next-wake" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70" />
              </div>
              <div>
                <FieldLabel htmlFor="goal-blocked-reason" optional>سبب التوقف</FieldLabel>
                <TextInput id="goal-blocked-reason" value={blockedReason} onChange={setBlockedReason} placeholder="لماذا لا يمكن متابعة التنفيذ؟" />
              </div>
            </div>
          ) : null}
          <div className="border-t border-slate-800 pt-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">العقود والإجراء التالي (للمستخدم المتقدم)</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <JsonField id="goal-success-criteria" label="معايير النجاح" value={successCriteria} onChange={setSuccessCriteria} error={fieldErrors.successCriteria} />
              <JsonField id="goal-evidence-contract" label="عقد الأدلة" value={evidenceContract} onChange={setEvidenceContract} error={fieldErrors.evidenceContract} />
              <JsonField id="goal-outcome-contract" label="عقد النتيجة" value={outcomeContract} onChange={setOutcomeContract} error={fieldErrors.outcomeContract} />
              <JsonField id="goal-next-action" label="الإجراء التالي" value={nextAction} onChange={setNextAction} error={fieldErrors.nextAction} />
            </div>
          </div>
        </div>
      </details>
    </EditorModal>
  );
}

function DeliveryBindingEditor({
  goal,
  saving,
  error,
  onClose,
  onSave,
}: {
  goal: Goal;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (proposalId: string) => void;
}) {
  const [proposalId, setProposalId] = useState('');
  const [fieldError, setFieldError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = proposalId.trim();
    if (!value) {
      setFieldError('معرّف المقترح المعتمَد (commit) مطلوب.');
      return;
    }
    setFieldError('');
    onSave(value);
  };

  return (
    <EditorModal
      title="ربط مقترح التسليم"
      eyebrow={`التسليم / ${goal.title}`}
      error={error}
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="اربط وتابع"
    >
      <div className="rounded-md border border-cyan-400/15 bg-cyan-300/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
        الربط فقط: تُدخل هنا معرّف المقترح (UUID) لتربطه بخطوة التسليم هذه. الربط ليس موافقة ولا تطبيقًا للتغييرات. يتحقق الخادم من الملكية ويحدد هوية العملية والمستودع البعيد والفرع بنفسه.
      </div>
      <div>
        <FieldLabel htmlFor="delivery-proposal-id">معرّف المقترح المعتمَد (Proposal ID)</FieldLabel>
        <TextInput
          id="delivery-proposal-id"
          value={proposalId}
          onChange={setProposalId}
          dir="ltr"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        {fieldError ? <p className="mt-1 text-xs text-rose-300">{fieldError}</p> : (
          <p className="mt-1 text-[10px] text-slate-600">يجب أن يكون المقترح قد اعتُمد (commit) مسبقًا لهذا المشروع.</p>
        )}
      </div>
    </EditorModal>
  );
}

function TaskEditor({
  projectId,
  goal,
  saving,
  error,
  onClose,
  onSave,
}: {
  projectId: string;
  goal: Goal;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: ApiCreateTaskInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ApiCreateTaskInput['priority']>('p2');
  const [fieldError, setFieldError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setFieldError('عنوان المهمة مطلوب.');
      return;
    }
    setFieldError('');
    onSave({
      projectId,
      goalId: goal.id,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    });
  };

  return (
    <EditorModal
      title="إضافة مهمة"
      eyebrow={`مهمة / ${goal.title}`}
      error={error}
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="إضافة المهمة"
    >
      <div className="rounded-md border border-cyan-400/15 bg-cyan-300/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
        ستُحفظ هذه المهمة تحت خطوة الهدف: <bdi dir="auto" className="font-semibold text-cyan-100">{goal.title}</bdi>.
      </div>
      <div>
        <FieldLabel htmlFor="task-title">عنوان المهمة</FieldLabel>
        <TextInput id="task-title" value={title} onChange={setTitle} placeholder="ما الذي يجب إنجازه؟" />
        {fieldError ? <p className="mt-1 text-xs text-rose-300">{fieldError}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="task-description" optional>الوصف</FieldLabel>
        <TextInput id="task-description" value={description} onChange={setDescription} multiline rows={3} placeholder="أضف سياقًا يساعد المتابع أو المساعد الذكي" />
      </div>
      <div>
        <FieldLabel htmlFor="task-priority">الأولوية</FieldLabel>
        <select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value as ApiCreateTaskInput['priority'])} data-testid="select-task-priority" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
          {priorities.map((option) => <option key={option} value={option}>{priorityLabels[option] ?? option}</option>)}
        </select>
      </div>
    </EditorModal>
  );
}

function GoalCard({
  item,
  expanded,
  onToggle,
  onEdit,
  onCreateTask,
  onBindDelivery,
  onReviewApproval,
  approvalAvailable,
  approvalDisabled,
  planBinding,
  inCurrentPlan,
}: {
  planBinding?: MissionProjection['currentPlan']['binding'];
  inCurrentPlan?: boolean;
  item: MissionProjection['goals'][number];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCreateTask: () => void;
  onBindDelivery: () => void;
  onReviewApproval: (executionId: string | null) => void;
  approvalAvailable: boolean;
  approvalDisabled: boolean;
}) {
  const { goal, tasks, workflows, executions, events, skillCandidate } = item;
  const linkedCount = tasks.length + workflows.length + executions.length + events.length;
  const nextAction = goal.nextAction && typeof goal.nextAction === 'object' && !Array.isArray(goal.nextAction)
    ? goal.nextAction as Record<string, unknown>
    : null;
  const isGithubDelivery = nextAction?.kind === 'recipe' && nextAction.recipeId === 'delivery.push.github';
  const hasProposal = typeof nextAction?.proposalId === 'string' && Boolean(nextAction.proposalId);
  return (
    <article data-testid={`card-goal-${goal.id}`} className={`overflow-hidden rounded-lg border transition-colors ${expanded ? 'border-cyan-400/30 bg-slate-900/80' : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'}`}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          data-testid={`button-toggle-goal-${goal.id}`}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${statusTone(goal.status)}`}>
          {goal.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : goal.status === 'blocked' || goal.status === 'failed' ? <XCircle className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{goal.title}</h3>
            <StatusPill status={goal.status} />
          </div>
          <p dir="auto" className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{goal.description || 'لا يوجد وصف مسجل.'}</p>
          <GoalAcceptanceNotice goal={goal} />
          {goal.status === 'completed' ? (
            <p
              data-testid={`goal-status-freshness-${goal.id}`}
              className="mt-1 text-[10px] text-amber-200/80"
            >
              حالة الهدف مكتملة بحسب السجل؛ هذا العرض لا يعيد التحقق من Canonical Proof الحالي.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-slate-600">
            <span>priority {goal.priority ?? '—'}</span>
            <span>{linkedCount} linked records</span>
            {goal.nextWakeAt ? <span>next wake {formatDate(goal.nextWakeAt, true)}</span> : null}
          </div>
        </div>
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180 text-cyan-300' : ''}`} />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onCreateTask} data-testid={`button-create-task-${goal.id}`} className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-300/10 px-2 py-1.5 text-[10px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20">
            <Plus className="h-3 w-3" />
            <span className="hidden sm:inline">مهمة جديدة</span>
            <span className="sm:hidden">مهمة</span>
          </button>
          {isGithubDelivery && !hasProposal && !['completed', 'cancelled'].includes(goal.status) ? (
            <button type="button" onClick={onBindDelivery} data-testid={`button-bind-delivery-${goal.id}`} className="inline-flex items-center gap-1 rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1.5 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/20">
              <GitBranch className="h-3 w-3" />
              <span className="hidden sm:inline">ربط مقترح</span>
              <span className="sm:hidden">ربط</span>
            </button>
          ) : null}
          {goal.status === 'waiting_for_approval' && approvalAvailable ? (
            <button
              type="button"
              onClick={() => onReviewApproval(item.executions[0]?.id ?? null)}
              disabled={approvalDisabled}
              data-testid={`button-review-approval-${goal.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1.5 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-60"
            >
              <ShieldAlert className="h-3 w-3" />
              <span className="hidden sm:inline">مراجعة الموافقة</span>
              <span className="sm:hidden">مراجعة</span>
            </button>
          ) : null}
          <button type="button" onClick={onEdit} data-testid={`button-edit-goal-${goal.id}`} aria-label={`تعديل خطوة الهدف: ${goal.title}`} className="rounded-md border border-transparent p-1.5 text-slate-600 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-cyan-200">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-slate-800 px-4 pb-1">
          <ResultDetailsSummary
            testIdSuffix={`goal-${goal.id}`}
            input={{ kind: 'goal', status: goal.status, planBinding, inCurrentPlan, attempt: item.currentAttempt?.attempt ?? null }}
          />
        </div>
      ) : null}
      {expanded ? (
        <div className="grid gap-4 border-t border-slate-800 px-4 py-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-600">Next action</p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                {displayJsonValue(goal.nextAction, 'لا يوجد إجراء تالٍ مسجل.')}
              </p>
            </div>
            {goal.blockedReason ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/5 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-rose-300/70">Blocked reason</p>
                <p className="mt-1 text-xs leading-5 text-rose-200/80">{goal.blockedReason}</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
              <CollectionLine icon={Clock3} label="Updated" value={formatDate(goal.updatedAt, true)} />
              <CollectionLine icon={CheckCircle2} label="Completed" value={formatDate(goal.completedAt, true)} empty={!goal.completedAt} />
            </div>
            {skillCandidate ? (
              <div data-testid={`skill-candidate-${goal.id}`} className="rounded-md border border-emerald-300/20 bg-emerald-300/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-200/80">Proof-carrying candidate</p>
                </div>
                <div className="mt-2 space-y-1 font-mono text-[10px] text-slate-400">
                  <p>verdict <span className={skillCandidate.canonicalProof.accepted ? 'text-emerald-200' : 'text-amber-200'}>{skillCandidate.canonicalProof.verdict}</span></p>
                  <p>candidate <span className="text-slate-300">{compactId(skillCandidate.candidateId)}</span></p>
                  <p>tree <span className="text-slate-300">{compactId(skillCandidate.canonicalProof.candidateTreeHash ?? skillCandidate.candidateTreeHash)}</span></p>
                   <p data-testid={`skill-candidate-evidence-${goal.id}`}>
                     evidence <span className="text-slate-300">
                         {skillCandidate.canonicalProof.evidenceSnapshotId
                           ? skillCandidate.canonicalProof.accepted && skillCandidate.canonicalProof.verdict === 'PROVEN'
                             ? 'complete'
                             : 'retained'
                           : 'missing'}
                     </span>
                   </p>
                   <p data-testid={`skill-candidate-binding-${goal.id}`}>
                     binding <span className="text-slate-300">
                        {skillCandidate.canonicalProof.sourceRevision && skillCandidate.canonicalProof.candidateIdentity
                         ? 'source + candidate'
                         : 'incomplete'}
                     </span>
                   </p>
                  <p>replay <span className="text-cyan-200">{skillCandidate.shadow.mode} / non-production</span></p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5 text-cyan-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Tasks <span className="text-slate-700">({tasks.length})</span></p>
              </div>
              <TaskList tasks={tasks} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Workflow className="h-3.5 w-3.5 text-violet-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Workflows <span className="text-slate-700">({workflows.length})</span></p>
              </div>
              <WorkflowList workflows={workflows} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TimerReset className="h-3.5 w-3.5 text-amber-200/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Executions <span className="text-slate-700">({executions.length})</span></p>
              </div>
              <ExecutionList executions={executions} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <CircleDot className="h-3.5 w-3.5 text-cyan-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Events <span className="text-slate-700">({events.length})</span></p>
              </div>
              <EventList events={events} />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

type EditorState =
  | { type: 'mission-create' }
  | { type: 'mission-edit'; mission: Mission }
  | { type: 'goal-create'; missionId: string }
  | { type: 'goal-edit'; missionId: string; goal: Goal }
  | { type: 'delivery-bind'; goal: Goal }
  | { type: 'task-create'; goal: Goal; projectId: string }
  | null;

function missionPlanRevisionHash(outcomeContract: unknown): string | null {
  if (!outcomeContract || typeof outcomeContract !== 'object' || Array.isArray(outcomeContract)) {
    return null;
  }
  const planRevision = (outcomeContract as Record<string, unknown>).planRevision;
  if (!planRevision || typeof planRevision !== 'object' || Array.isArray(planRevision)) {
    return null;
  }
  const hash = (planRevision as Record<string, unknown>).hash;
  return typeof hash === 'string' ? hash : null;
}

export default function Missions() {
  const {
    data: rawProjects,
    isLoading: projectsLoading,
    isError: projectsError,
    error: projectsQueryError,
    refetch: refetchProjects,
  } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const replanMission = useReplanAiMission();
  const approveMissionGoal = useApproveAiMissionGoal();
  const projects = useMemo(() => rawProjects ?? [], [rawProjects]);
  const [projectId, setProjectId] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState<unknown>(null);
  const [missionsReload, setMissionsReload] = useState(0);
  const [missionsLoadedFor, setMissionsLoadedFor] = useState<string | null>(null);
  const [projection, setProjection] = useState<MissionProjection | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<unknown>(null);
  const [projectionReload, setProjectionReload] = useState(0);
  const [editor, setEditor] = useState<EditorState>(null);
  const [applyMissionOpen, setApplyMissionOpen] = useState(false);
  const [applyProposalId, setApplyProposalId] = useState('');
  const [applyTitle, setApplyTitle] = useState('');
  const [applyIntent, setApplyIntent] = useState('');
  const [mutationSaving, setMutationSaving] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const [pendingMissionAction, setPendingMissionAction] = useState<MissionActionConfirmation | null>(null);
  const continuationKeys = useRef(new Map<string, string>());
  const [missionActionError, setMissionActionError] = useState<string | null>(null);

  const search = useSearch();
  const routeTarget = useMemo(() => {
    const params = new URLSearchParams(search);
    return { projectId: params.get('projectId') || null, missionId: params.get('missionId') || null };
  }, [search]);
  // An explicit link target stays authoritative until the user picks something else.
  const [routeTargetReleased, setRouteTargetReleased] = useState(false);
  useEffect(() => { setRouteTargetReleased(false); }, [routeTarget]);
  const explicitProjectId = routeTargetReleased ? null : routeTarget.projectId;
  const explicitMissionId = routeTargetReleased ? null : routeTarget.missionId;
  const explicitProjectMissing = Boolean(
    explicitProjectId && !projectsLoading && !projectsError
      && !projects.some((project) => String(project.id) === explicitProjectId),
  );

  useEffect(() => {
    if (projects.length === 0) {
      setProjectId('');
      return;
    }
    if (explicitProjectId) {
      // Fail closed: never fall back to another project for an explicit target.
      setProjectId(projects.some((project) => String(project.id) === explicitProjectId) ? explicitProjectId : '');
      return;
    }
    setProjectId((current) => projects.some((project) => String(project.id) === current) ? current : String(projects[0].id));
  }, [projects, explicitProjectId]);

  useEffect(() => {
    setSelectedMissionId(null);
    setExpandedGoalId(null);
    setProjection(null);
    setProjectionError(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setMissions([]);
      setMissionsError(null);
      setMissionsLoading(false);
      return;
    }
    const controller = new AbortController();
    setMissionsLoading(true);
    setMissionsError(null);
    fetchMissions(projectId, controller.signal)
      .then((data) => { setMissions(Array.isArray(data) ? data : []); setMissionsLoadedFor(projectId); })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setMissionsError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMissionsLoading(false);
      });
    return () => controller.abort();
  }, [projectId, missionsReload]);

  const explicitMissionAwaitingList = Boolean(explicitMissionId && (missionsLoading || missionsError || missionsLoadedFor !== projectId));
  const explicitMissionMissing = Boolean(
    explicitMissionId && !selectedMissionId && !explicitMissionAwaitingList && projectId
      && !missions.some((mission) => mission.id === explicitMissionId),
  );
  const activeMissionId = selectedMissionId && missions.some((mission) => mission.id === selectedMissionId)
    ? selectedMissionId
    : explicitMissionId
      ? (missions.some((mission) => mission.id === explicitMissionId) ? explicitMissionId : null)
      : missions[0]?.id ?? null;
  const activeMission = missions.find((mission) => mission.id === activeMissionId) ?? null;

  useEffect(() => {
    if (!activeMissionId) {
      setProjection(null);
      setProjectionError(null);
      setProjectionLoading(false);
      return;
    }
    const controller = new AbortController();
    setProjectionLoading(true);
    setProjectionError(null);
    setProjection(null);
    fetchMissionProjection(activeMissionId, controller.signal)
      .then((data) => setProjection(normalizeProjection(data)))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setProjectionError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectionLoading(false);
      });
    return () => controller.abort();
  }, [activeMissionId, projectionReload]);

  useEffect(() => {
    setExpandedGoalId(null);
    setPendingMissionAction(null);
    setMissionActionError(null);
  }, [activeMissionId]);

  useEffect(() => {
    if (!activeMissionId || activeMission?.status !== 'active') return;
    const interval = window.setInterval(() => {
      setProjectionReload((value) => value + 1);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activeMissionId, activeMission?.status]);

  const selectedProject = projects.find((project) => String(project.id) === projectId);
  const projectErrorStatus = typeof projectsQueryError === 'object' && projectsQueryError !== null && 'status' in projectsQueryError
    ? Number((projectsQueryError as { status?: unknown }).status)
    : null;
  const projectionGoals = projection?.goals ?? [];
  const decisionProjectionIsCurrent = Boolean(
    activeMission
    && projection?.mission.id === activeMission.id
    && projection.mission.projectId === activeMission.projectId
    && projection?.engineeringAgent?.schemaVersion === 1
    && projection?.engineeringAgent?.missionId === activeMission.id,
  );
  const missionDecision = decisionProjectionIsCurrent
    ? projection!.engineeringAgent.nextAction
    : null;
  const missionDecisionIdentity: EngineeringAgentDecision | null = missionDecision
    ? {
        kind: missionDecision.kind,
        target: missionDecision.target,
        reasonCode: missionDecision.reasonCode,
      }
    : null;
  const decisionTargetIsMission = Boolean(
    activeMission
    && missionDecision?.target?.kind === 'mission'
    && missionDecision.target.id === activeMission.id,
  );
  const decisionTargetIsCurrentGoal = Boolean(
    missionDecision?.target?.kind === 'goal'
    && projectionGoals.some((item) => item.goal.id === missionDecision.target?.id),
  );
  const needsReplan = missionDecision?.kind === 'REPLAN'
    && (decisionTargetIsMission || decisionTargetIsCurrentGoal);
  const approvalGoalId = missionDecision?.kind === 'APPROVE'
    ? projection?.engineeringAgent.goalId ?? null
    : null;
  const approvalGoalIsCurrent = Boolean(
    approvalGoalId
    && missionDecision?.target
    && ['goal', 'proposal'].includes(missionDecision.target.kind)
    && projectionGoals.some((item) => item.goal.id === approvalGoalId && item.goal.status === 'waiting_for_approval'),
  );
  const canStartMission = missionDecision?.kind === 'START' && decisionTargetIsMission;
  const canAutoContinue = missionDecision?.kind === 'AUTO_CONTINUE' && decisionTargetIsCurrentGoal;
  const reviewExecutionId = missionDecision?.kind === 'REVIEW'
    && missionDecision.target?.kind === 'execution'
    ? missionDecision.target.id
    : null;
  const missionActionPending = replanMission.isPending || approveMissionGoal.isPending;
  const acceptedFindingSource = activeMission
    ? readAcceptedProjectQueryHandoffSource(activeMission.autonomyPolicy)
    : null;
  const latestMissionExecution = projectionGoals
    .flatMap((item) => item.executions)
    .sort((left, right) => {
      const leftTime = Date.parse(left.completedAt ?? left.updatedAt);
      const rightTime = Date.parse(right.completedAt ?? right.updatedAt);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })[0];
  const projectionIsPartial = projection
    ? projection.counts.goals !== projectionGoals.length
      || projection.counts.tasks !== projectionGoals.reduce((sum, item) => sum + item.tasks.length, 0)
      || projection.counts.workflows !== projectionGoals.reduce((sum, item) => sum + item.workflows.length, 0)
      || projection.counts.executions !== projectionGoals.reduce((sum, item) => sum + item.executions.length, 0)
      || projection.counts.events !== projectionGoals.reduce((sum, item) => sum + item.events.length, 0)
    : false;

  const openEditor = (next: Exclude<EditorState, null>) => {
    setMutationError(null);
    setMutationNotice(null);
    setEditor(next);
  };

  const closeEditor = () => {
    if (mutationSaving) return;
    setEditor(null);
    setMutationError(null);
  };

  const submitApplyMission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !applyProposalId.trim()) return;
    setMutationSaving(true);
    setMutationError(null);
    try {
      const result = await createApplyMissionFromProposal({
        projectId,
        proposalId: applyProposalId.trim(),
        ...(applyTitle.trim() ? { title: applyTitle.trim() } : {}),
        ...(applyIntent.trim() ? { intent: applyIntent.trim() } : {}),
      });
      setMissions((current) => [result.mission, ...current.filter((item) => item.id !== result.mission.id)]);
      setSelectedMissionId(result.mission.id);
      setApplyMissionOpen(false);
      setApplyProposalId('');
      setApplyTitle('');
      setApplyIntent('');
      setMutationNotice('أُنشئ هدف التطبيق. المقترح الموافَق عليه ينتظر خطوة تطبيق التغييرات.');
      setProjectionReload((value) => value + 1);
    } catch (error: unknown) {
      setMutationError(error);
    } finally {
      setMutationSaving(false);
    }
  };

  const handleSave = async (data: CreateMissionInput | UpdateMissionInput | CreateGoalInput | UpdateGoalInput | ApiCreateTaskInput) => {
    if (!editor) return;
    setMutationSaving(true);
    setMutationError(null);
    try {
      if (editor.type === 'mission-create') {
        const created = await createMission(data as CreateMissionInput);
        setMissions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setSelectedMissionId(created.id);
        setEditor(null);
        setMutationNotice('بدأ الهدف الرئيسي. تابع حالة إعداد الخطة وتنفيذها.');
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'mission-edit') {
        const input = data as UpdateMissionInput;
        const isDraftStart = editor.mission.status === 'draft' && input.status === 'active';
        if (isDraftStart && (!canStartMission || !missionDecisionIdentity)) {
          throw new Error('تعذر البدء لأن قرار الهدف الرئيسي الحالي لا يسمح بذلك. حدّث الحالة ثم حاول مجددًا.');
        }
        const updated = await updateMission(editor.mission.id, {
          ...input,
          ...(isDraftStart ? { expectedDecision: missionDecisionIdentity! } : {}),
        });
        setMissions((current) => current.map((item) => item.id === updated.id ? updated : item));
        setProjection((current) => current && current.mission.id === updated.id ? { ...current, mission: updated } : current);
        setEditor(null);
        setMutationNotice(
          updated.status === 'active' && editor.mission.status !== 'active'
            ? 'فُعّل الهدف الرئيسي، وأُضيف إعداد خطته الأولى إلى قائمة الانتظار.'
            : 'حُفظت تفاصيل الهدف الرئيسي.',
        );
        setMissionsReload((value) => value + 1);
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'goal-create') {
        await createGoal(editor.missionId, data as CreateGoalInput);
        setEditor(null);
        setMutationNotice('أُضيفت خطوة الهدف.');
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'goal-edit') {
        const updated = await updateGoal(editor.goal.id, data as UpdateGoalInput);
        setProjection((current) => current ? {
          ...current,
          goals: current.goals.map((item) => item.goal.id === updated.id ? { ...item, goal: updated } : item),
        } : current);
        setEditor(null);
        setMutationNotice('حُفظت تفاصيل خطوة الهدف.');
        setProjectionReload((value) => value + 1);
      } else {
        const created = await createTask(data as ApiCreateTaskInput);
        setEditor(null);
        setMutationNotice(`أُنشئت المهمة: ${created.title}`);
        setProjectionReload((value) => value + 1);
      }
    } catch (error: unknown) {
      setMutationError(error);
    } finally {
      setMutationSaving(false);
    }
  };

  const handleBindDelivery = async (proposalId: string) => {
    if (editor?.type !== 'delivery-bind') return;
    setMutationSaving(true);
    setMutationError(null);
    try {
      const result = await bindMissionDelivery(editor.goal.id, proposalId);
      setEditor(null);
      setMutationNotice(
        result.run.status === 'waiting'
          ? 'رُبط مقترح التسليم. تنتظر الخطوة اكتمال الخطوات التي تعتمد عليها قبل المتابعة.'
          : 'رُبط مقترح التسليم وأُضيفت الخطوة إلى قائمة انتظار التسليم.',
      );
      setProjectionReload((value) => value + 1);
    } catch (error: unknown) {
      setMutationError(error);
    } finally {
      setMutationSaving(false);
    }
  };

  const startMission = async () => {
    if (!activeMission || mutationSaving || !canStartMission || !missionDecisionIdentity) return;
    setMutationSaving(true);
    setMutationError(null);
    setMutationNotice(null);
    try {
      const updated = await updateMission(activeMission.id, {
        status: 'active',
        expectedDecision: missionDecisionIdentity,
      });
      setMissions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setProjection((current) => current && current.mission.id === updated.id ? { ...current, mission: updated } : current);
      setMutationNotice('بدأ الهدف الرئيسي. تابع حالة إعداد الخطة وتنفيذها.');
      setMissionsReload((value) => value + 1);
      setProjectionReload((value) => value + 1);
    } catch (error: unknown) {
      setMutationError(error);
    } finally {
      setMutationSaving(false);
    }
  };

  const continueMission = async () => {
    if (!activeMission || mutationSaving || !canAutoContinue || !missionDecisionIdentity) return;
    const idempotencyKey = continuationKeys.current.get(activeMission.id) ?? crypto.randomUUID();
    continuationKeys.current.set(activeMission.id, idempotencyKey);
    setMutationSaving(true);
    setMutationError(null);
    setMutationNotice(null);
    try {
      const result = await continueMissionAgent(activeMission.id, {
        idempotencyKey,
        expectedDecision: missionDecisionIdentity,
      });
      setProjection(result.projection);
      if (!result.inProgress) continuationKeys.current.delete(activeMission.id);
      setMutationNotice(
        result.inProgress
          ? 'المتابعة نفسها قيد التنفيذ بالفعل؛ حدّث الحالة لمعرفة نتيجتها.'
          : 'أُرسلت المتابعة إلى مسار التنفيذ الحالي، وسيُعاد التحقق من الحالة قبل أي عمل.',
      );
      setProjectionReload((value) => value + 1);
    } catch (error: unknown) {
      if (error instanceof MissionRequestError) continuationKeys.current.delete(activeMission.id);
      setMutationError(error);
      setMissionsReload((value) => value + 1);
      setProjectionReload((value) => value + 1);
    } finally {
      setMutationSaving(false);
    }
  };

  const confirmMissionAction = () => {
    if (!pendingMissionAction || missionActionPending) return;
    setMissionActionError(null);
    const refreshMissionData = () => {
      setMissionsReload((value) => value + 1);
      setProjectionReload((value) => value + 1);
    };
    if (pendingMissionAction.type === 'replan') {
      replanMission.mutate(
        {
          missionId: pendingMissionAction.missionId,
          data: { expectedDecision: pendingMissionAction.expectedDecision },
        },
        {
          onSuccess: () => {
            setPendingMissionAction(null);
            setMutationNotice('أُنشئت نسخة خطة جديدة وسُجّل استئناف تنفيذ الهدف الرئيسي.');
            refreshMissionData();
          },
          onError: (error) => {
            setMissionActionError(errorMessage(error, 'تعذر إنشاء خطة جديدة للهدف. حدّث البيانات ثم حاول مجددًا.'));
            refreshMissionData();
          },
        },
      );
      return;
    }

    approveMissionGoal.mutate(
      {
        missionId: pendingMissionAction.missionId,
        goalId: pendingMissionAction.goalId,
        data: { expectedDecision: pendingMissionAction.expectedDecision },
      },
      {
        onSuccess: () => {
          setPendingMissionAction(null);
            setMutationNotice(
              pendingMissionAction.executionId === null
                ? 'اعتُمدت نسخة الخطة وبدأت خطوة إعداد المرشح. ستظل موافقة المرشح والتطبيق والتسليم منفصلة.'
                : 'سُجّلت الموافقة على المقترح واستئناف تنفيذ الهدف الرئيسي. تطبيق الملفات وتسليمها إجراءان منفصلان.',
            );
          refreshMissionData();
        },
        onError: (error) => {
          setMissionActionError(errorMessage(error, 'تعذرت الموافقة على الخطوة. حدّث البيانات ثم حاول مجددًا.'));
          refreshMissionData();
        },
      },
    );
  };

  return (
    <main className="min-h-[100dvh] bg-[#08111d] px-4 py-5 text-slate-100 md:px-7 md:py-7">
      <div className="mx-auto max-w-[1700px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/90 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div dir="rtl" lang="ar">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/70">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              العمل نحو هدف
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">الأهداف</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              حدد ما تريد إنجازه، ثم تابع الخطة والقرارات والنتيجة المسجلة.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void refetchProjects();
                setMissionsReload((value) => value + 1);
                setProjectionReload((value) => value + 1);
              }}
              data-testid="button-refresh-missions"
              className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-slate-800 hover:text-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>
          </div>
        </header>

        {mutationNotice ? (
          <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-400/25 bg-emerald-300/10 px-3 py-2.5 text-xs text-emerald-100">
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" />{mutationNotice}</span>
            <button type="button" onClick={() => setMutationNotice(null)} className="text-emerald-200/70 hover:text-emerald-100" aria-label="إغلاق الإشعار"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}

        {explicitProjectMissing || explicitMissionMissing ? (
          <div role="alert" data-testid="status-mission-target-unavailable" className="mb-4 flex flex-col gap-2 rounded-md border border-amber-400/30 bg-amber-300/10 px-3 py-2.5 text-xs text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <span dir="auto">
              {explicitProjectMissing
                ? 'المشروع المطلوب غير متاح لحسابك أو لم يعد موجودًا. لم نفتح مشروعًا آخر بدلًا منه.'
                : 'المهمة المطلوبة غير متاحة في هذا المشروع أو لم تعد موجودة. لم نفتح مهمة أخرى بدلًا منها.'}
            </span>
            <button type="button" data-testid="button-release-mission-target" onClick={() => setRouteTargetReleased(true)} className="font-semibold text-amber-200 hover:underline">
              اختر بنفسك
            </button>
          </div>
        ) : null}

        {projectsLoading ? (
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : projectsError ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50">
            <ErrorState
              title={projectErrorStatus === 403 ? 'لا تملك صلاحية عرض المشاريع' : 'المشاريع غير متاحة الآن'}
              message={projectErrorStatus === 403 ? 'لا يسمح حسابك بعرض قائمة هذه المشاريع.' : errorMessage(projectsQueryError, 'تعذر تحميل قائمة المشاريع.')}
              forbidden={projectErrorStatus === 403}
              onRetry={() => void refetchProjects()}
            />
          </section>
        ) : projects.length === 0 ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50">
            <EmptyState icon={Layers3} title="لا توجد مشاريع متاحة لحسابك" description="تظهر الأهداف هنا عند توفر مشروع تملكه. ابدأ من صفحة المشاريع." />
          </section>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center">
              <label htmlFor="mission-project-select" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <Code2 className="h-3.5 w-3.5 text-cyan-300/70" />
                اختر مشروعًا
              </label>
              <select
                id="mission-project-select"
                dir="auto"
                value={projectId}
                onChange={(event) => { setRouteTargetReleased(true); setProjectId(event.target.value); }}
                data-testid="select-mission-project"
                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-cyan-400/60"
              >
                {projects.map((project) => (
                  <option key={project.id} value={String(project.id)}>{project.name}</option>
                ))}
              </select>
              {selectedProject ? <span className="font-mono text-[10px] text-slate-600">{compactId(String(selectedProject.id))}</span> : null}
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/55">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Your missions</p>
                      <p dir="auto" className="mt-1 text-xs text-slate-600">{selectedProject?.name ?? 'اختر مشروعًا'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 font-mono text-[10px] text-slate-500">{missions.length} total</span>
                      <button type="button" onClick={() => openEditor({ type: 'mission-create' })} data-testid="button-create-mission" className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20">
                        <Plus className="h-3.5 w-3.5" />
                         ابدأ هدفًا رئيسيًا
                      </button>
                       <button type="button" onClick={() => { setMutationError(null); setApplyMissionOpen(true); }} data-testid="button-create-apply-mission" className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/30 bg-amber-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/20">
                         <ArrowUpRight className="h-3.5 w-3.5" />
                         تطبيق مقترح موافَق عليه
                       </button>
                    </div>
                  </div>
                </div>
                <p
                  data-testid="mission-status-authority"
                  className="border-b border-slate-800/70 px-4 py-2 text-[10px] leading-4 text-amber-200/80"
                >
                  حالات Mission المعروضة محفوظة في السجل؛ لا تعني تحققًا حديثًا من Canonical Proof.
                </p>
                {missionsLoading ? (
                  <div className="space-y-2 p-3">
                    {[1, 2, 3].map((item) => <Skeleton key={item} className="h-24" />)}
                  </div>
                ) : missionsError ? (
                  <ErrorState
                    title={errorStatus(missionsError) === 403 ? 'لا تملك صلاحية عرض الأهداف' : 'الأهداف غير متاحة الآن'}
                    message={errorStatus(missionsError) === 403 ? 'لا تتوفر لك صلاحية عرض أهداف هذا المشروع.' : errorMessage(missionsError, 'تعذر تحميل قائمة الأهداف.')}
                    forbidden={errorStatus(missionsError) === 403}
                    onRetry={() => setMissionsReload((value) => value + 1)}
                  />
                ) : missions.length === 0 ? (
                  <EmptyState icon={ListChecks} title="لا توجد أهداف لهذا المشروع في العرض الحالي" description="يمكنك بدء هدف رئيسي وتحديد ما تريد إنجازه في هذا المشروع." />
                ) : (
                  <div className="space-y-2 p-3">
                    {missions.map((mission) => {
                      const isCurrent = mission.id === activeMissionId;
                      return (
                        <button
                          type="button"
                          key={mission.id}
                          onClick={() => setSelectedMissionId(mission.id)}
                          data-testid={`button-mission-${mission.id}`}
                          className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isCurrent ? 'border-cyan-400/35 bg-cyan-300/[0.07]' : 'border-slate-800 bg-slate-950/20 hover:border-slate-700 hover:bg-slate-800/50'}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-cyan-300' : 'bg-slate-600'}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="line-clamp-2 text-sm font-semibold text-slate-200">{mission.title}</span>
                                <StatusPill status={mission.status} />
                              </div>
                              <p dir="auto" className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{mission.intent || 'لا توجد غاية مسجلة.'}</p>
                              <p className="mt-2 font-mono text-[10px] text-slate-600">{compactId(mission.id)} · updated {formatDate(mission.updatedAt, true)}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/55">
                {!activeMission ? (
                  <EmptyState icon={Layers3} title="اختر هدفًا رئيسيًا" description="اختر هدفًا من القائمة لعرض خطواته وسجلات التنفيذ المرتبطة به." />
                ) : (
                  <>
                    <div className="border-b border-slate-800 px-4 py-4 md:px-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <StatusPill status={activeMission.status} />
                          </div>
                          <h2 data-testid={`text-mission-title-${activeMission.id}`} className="text-xl font-semibold tracking-tight text-slate-50">{activeMission.title}</h2>
                          <p dir="auto" className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{activeMission.intent || 'لا توجد غاية مسجلة لهذا الهدف الرئيسي.'}</p>
                        </div>
                        <div className="flex shrink-0 items-start gap-3 sm:flex-col sm:items-end">
                          <div className="flex items-center gap-2">
                            {needsReplan ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setMissionActionError(null);
                                  setPendingMissionAction({
                                    type: 'replan',
                                    missionId: activeMission.id,
                                    missionTitle: activeMission.title,
                                    expectedDecision: missionDecisionIdentity!,
                                  });
                                }}
                                disabled={mutationSaving || missionActionPending}
                                data-testid={`button-replan-mission-${activeMission.id}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-60"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                إنشاء خطة جديدة
                              </button>
                            ) : null}
                            {canStartMission ? (
                              <button type="button" onClick={() => void startMission()} disabled={mutationSaving} data-testid={`button-start-mission-${activeMission.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-300/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/25 disabled:cursor-wait disabled:opacity-60">
                                {mutationSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                                بدء الهدف الرئيسي
                              </button>
                            ) : null}
                            {canAutoContinue ? (
                              <button
                                type="button"
                                onClick={() => void continueMission()}
                                disabled={mutationSaving || missionActionPending}
                                data-testid={`button-continue-mission-${activeMission.id}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-300/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20 disabled:cursor-wait disabled:opacity-60"
                              >
                                {mutationSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                                متابعة التنفيذ
                              </button>
                            ) : null}
                            {reviewExecutionId && activeMission ? (
                              <Link
                                href={`/mission-control?${new URLSearchParams({
                                  projectId: String(activeMission.projectId),
                                  missionId: activeMission.id,
                                  executionId: reviewExecutionId,
                                }).toString()}`}
                                data-testid={`link-review-mission-execution-${activeMission.id}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/35 hover:text-cyan-100"
                              >
                                <ArrowUpRight className="h-3.5 w-3.5" />
                                مراجعة التنفيذ
                              </Link>
                            ) : null}
                            <button type="button" onClick={() => openEditor({ type: 'mission-edit', mission: activeMission })} data-testid={`button-edit-mission-${activeMission.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/40 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-100">
                              <Edit3 className="h-3.5 w-3.5" />
                              تعديل التفاصيل
                            </button>
                            <button type="button" onClick={() => openEditor({ type: 'goal-create', missionId: activeMission.id })} data-testid="button-create-goal" className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20">
                              <Plus className="h-3.5 w-3.5" />
                              إضافة خطوة للهدف
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
                        <Metric label="Status" value={missionStatusMessage(activeMission.status)} accent="text-cyan-200" />
                        <Metric label="Goals" value={projection?.counts.goals ?? '—'} />
                        <Metric label="Tasks" value={projection?.counts.tasks ?? '—'} />
                      </div>
                      {projection?.mission.id === activeMission.id
                        && projection.mission.projectId === activeMission.projectId
                        && projection.engineeringAgent?.missionId === activeMission.id ? (
                        <div className="mt-4" data-testid={`mission-agent-projection-${activeMission.id}`}>
                          <MissionAgentProjectionSummary projection={projection.engineeringAgent} />
                        </div>
                      ) : null}
                    </div>

                    {acceptedFindingSource ? (
                      <section
                        data-testid={`mission-source-provenance-${activeMission.id}`}
                        className="border-b border-cyan-400/15 bg-cyan-300/[0.035] px-4 py-4 md:px-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200/70">
                              Accepted PROJECT_QUERY source
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-400">
                              User-reviewed context only. This finding is not proof or authorization for future changes.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/ai?${new URLSearchParams({
                                projectId: String(activeMission.projectId),
                                sessionId: acceptedFindingSource.sessionId,
                                messageId: acceptedFindingSource.assistantMessageId,
                              }).toString()}`}
                              data-testid="link-mission-source-chat"
                              className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/15"
                            >
                              <ArrowUpRight className="h-3 w-3" />
                              Open original finding in Chat
                            </Link>
                            {latestMissionExecution ? (
                              <a
                                href={`/mission-control?${new URLSearchParams({
                                  projectId: String(activeMission.projectId),
                                  missionId: activeMission.id,
                                  executionId: latestMissionExecution.id,
                                }).toString()}`}
                                data-testid="link-mission-source-execution"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950/40 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-cyan-400/35 hover:text-cyan-100"
                              >
                                <ArrowUpRight className="h-3 w-3" />
                                Inspect linked Mission execution
                              </a>
                            ) : (
                              <span className="self-center text-[11px] text-slate-500">
                                Mission execution not recorded yet
                              </span>
                            )}
                          </div>
                        </div>
                        <dl className="mt-3 grid gap-x-4 gap-y-2 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <dt className="text-slate-500">Source session</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.sessionId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">User message</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.messageId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Assistant message</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.assistantMessageId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Source execution</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.executionId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Acceptance</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.acceptanceId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Evidence snapshot</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.evidenceSnapshotId}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Source revision</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.sourceRevision}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Accepted claims</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">
                              {acceptedFindingSource.acceptedClaimRefs.join(', ')}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Plan hash</dt>
                            <dd className="mt-0.5 break-all font-mono text-slate-300">{acceptedFindingSource.planHash}</dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}

                    {projectionLoading ? (
                      <div className="space-y-3 p-4 md:p-5">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-40" />
                        <Skeleton className="h-40" />
                      </div>
                    ) : projectionError ? (
                      <ErrorState
                        title={errorStatus(projectionError) === 403 ? 'لا تملك صلاحية عرض تفاصيل التنفيذ' : 'تفاصيل التنفيذ غير متاحة الآن'}
                        message={errorStatus(projectionError) === 403 ? 'يمكنك عرض الهدف الرئيسي، لكن سجلاته التشغيلية المرتبطة ليست متاحة لحسابك.' : errorMessage(projectionError, 'تعذر تحميل تفاصيل تنفيذ الهدف الرئيسي.')}
                        forbidden={errorStatus(projectionError) === 403}
                        onRetry={() => setProjectionReload((value) => value + 1)}
                      />
                    ) : projection ? (
                      <div className="p-4 md:p-5">
                        {projectionIsPartial ? (
                          <div className="mb-4 flex items-start gap-2.5 rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs text-amber-100/80">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                            <span>Some activity is still loading. The latest result will appear here automatically.</span>
                          </div>
                        ) : null}
                        {projection.agentControl ? (
                          <section
                            aria-label="Agent control"
                            className="mb-5 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.035] p-3.5"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200/70">
                                  Agent control
                                </p>
                                <p className="mt-1 text-sm font-medium text-slate-200">
                                  This Mission is the Agent run
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Execution and recovery stay with Mission Runtime.
                                </p>
                              </div>
                              <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                                {projection.agentControl.handoff.dispatchStatus === 'dispatched'
                                  ? 'Dispatched'
                                  : 'Dispatch pending'}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                              <div className="text-[11px] text-slate-500">
                                Confirmed {formatDate(projection.agentControl.handoff.confirmedAt, true)}
                                <span className="mx-2 text-slate-700">·</span>
                                Plan {compactId(projection.agentControl.handoff.planHash)}
                              </div>
                              {chatHandoffHref(
                                String(activeMission.projectId),
                                activeMission.id,
                                projection.agentControl.handoff,
                              ) ? (
                                <Link
                                  href={chatHandoffHref(
                                    String(activeMission.projectId),
                                    activeMission.id,
                                    projection.agentControl.handoff,
                                  )!}
                                  data-testid="link-mission-handoff-chat"
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-200 hover:text-cyan-100"
                                >
                                  Return to originating conversation <ArrowUpRight className="h-3.5 w-3.5" />
                                </Link>
                              ) : (
                                <span className="text-xs text-slate-600">No originating conversation is linked to this Mission.</span>
                              )}
                            </div>
                          </section>
                        ) : null}
                         <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Progress</p>
                            <p className="mt-1 text-xs text-slate-600">The system creates and runs the plan for you.</p>
                          </div>
                           <span className="font-mono text-[10px] text-slate-600">{projectionGoals.length} returned</span>
                        </div>
                        {projectionGoals.length === 0 ? (
                          <EmptyState
                            icon={activeMission.status === 'draft' ? ArrowUpRight : ListChecks}
                            title={activeMission.status === 'draft' ? 'جاهز للبدء' : 'لا توجد تفاصيل تقدم في هذا العرض بعد'}
                            description={activeMission.status === 'draft' ? 'ابدأ الهدف الرئيسي لإنشاء الخطة وبدء تنفيذها.' : 'قد تكون الخطة قيد الإعداد. حدّث البيانات بعد قليل لمعرفة الحالة المسجلة.'}
                          />
                        ) : (
                          <div className="space-y-2">
                            {projectionGoals.map((item) => (
                              <GoalCard
                                key={item.goal.id}
                                item={item}
                                planBinding={projection?.currentPlan?.binding}
                                inCurrentPlan={Array.isArray(projection?.currentPlan?.goalIds) ? projection.currentPlan.goalIds.includes(item.goal.id) : undefined}
                                expanded={expandedGoalId === item.goal.id}
                                onToggle={() => setExpandedGoalId((current) => current === item.goal.id ? null : item.goal.id)}
                                onEdit={() => openEditor({ type: 'goal-edit', missionId: activeMission.id, goal: item.goal })}
                                 onCreateTask={() => openEditor({ type: 'task-create', goal: item.goal, projectId })}
                                 onBindDelivery={() => openEditor({ type: 'delivery-bind', goal: item.goal })}
                                onReviewApproval={(executionId) => {
                                  if (
                                    !missionDecisionIdentity
                                    || !approvalGoalIsCurrent
                                    || approvalGoalId !== item.goal.id
                                  ) return;
                                  setMissionActionError(null);
                                  setPendingMissionAction({
                                    type: 'approve',
                                    missionId: activeMission.id,
                                    missionTitle: activeMission.title,
                                    goalId: item.goal.id,
                                    goalTitle: item.goal.title,
                                    projectId: String(activeMission.projectId),
                                    executionId,
                                    planRevision: missionPlanRevisionHash(item.goal.outcomeContract),
                                    expectedDecision: missionDecisionIdentity,
                                  });
                                }}
                                approvalAvailable={approvalGoalIsCurrent && approvalGoalId === item.goal.id}
                                approvalDisabled={mutationSaving || missionActionPending}
                              />
                            ))}
                          </div>
                        )}
                         <details className="mt-5 border-t border-slate-800 pt-4">
                           <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-400">More details</summary>
                           <div className="mt-3 grid gap-3 text-xs text-slate-500 sm:grid-cols-3">
                             <span>Scope: {activeMission.scope ? 'project' : 'not recorded'}</span>
                             <span>Deadline: {formatDate(activeMission.deadline)}</span>
                             <span>Updated: {formatDate(activeMission.updatedAt, true)}</span>
                           </div>
                         </details>
                      </div>
                    ) : (
                      <EmptyState icon={Layers3} title="لم تصل تفاصيل تنفيذ للعرض" description="الهدف الرئيسي موجود، لكن الاستجابة القرائية لا تتضمن تفاصيله. هذا لا يثبت اكتماله أو فشله." />
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </div>
      {applyMissionOpen ? (
        <EditorModal title="تطبيق مقترح موافَق عليه" eyebrow="الهدف الرئيسي / تجهيز التطبيق" error={mutationError} saving={mutationSaving} onClose={() => setApplyMissionOpen(false)} onSubmit={submitApplyMission} submitLabel="إنشاء هدف التطبيق">
          <div className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
            هذا ينشئ هدفًا رئيسيًا لتطبيق مقترح سبقت الموافقة عليه. لا يمنح موافقة جديدة، ولا يطبّق التغييرات فورًا: سيبقى المقترح بانتظار خطوة «تطبيق التغييرات» (Apply Changes).
          </div>
          <div>
            <FieldLabel htmlFor="apply-proposal-id">معرّف المقترح (Proposal ID)</FieldLabel>
            <TextInput id="apply-proposal-id" value={applyProposalId} onChange={setApplyProposalId} dir="ltr" placeholder="Approved proposal UUID" />
            <p className="mt-1 text-[10px] text-slate-600">يحدد الخادم خطوة الهدف المنتظرة وكل البصمات (hashes) بنفسه. لا تُرسَل معرّفات الخطوات ولا JSON المتطلبات.</p>
          </div>
          <div>
            <FieldLabel htmlFor="apply-mission-title" optional>العنوان</FieldLabel>
            <TextInput id="apply-mission-title" value={applyTitle} onChange={setApplyTitle} placeholder="تطبيق هذا التغيير الموافَق عليه" />
          </div>
          <div>
            <FieldLabel htmlFor="apply-mission-intent" optional>الغاية</FieldLabel>
            <TextInput id="apply-mission-intent" value={applyIntent} onChange={setApplyIntent} multiline rows={2} placeholder="ما الذي يجب أن يصبح صحيحًا بعد تحديث ملفات المشروع؟" />
          </div>
        </EditorModal>
      ) : null}
      {editor?.type === 'mission-create' ? (
        <MissionEditor projectId={projectId} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'mission-edit' ? (
        <MissionEditor projectId={projectId} mission={editor.mission} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'goal-create' ? (
        <GoalEditor availableParents={projectionGoals.map((item) => item.goal)} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'goal-edit' ? (
        <GoalEditor goal={editor.goal} availableParents={projectionGoals.map((item) => item.goal)} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'delivery-bind' ? (
        <DeliveryBindingEditor goal={editor.goal} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleBindDelivery} />
      ) : null}
      {editor?.type === 'task-create' ? (
        <TaskEditor projectId={editor.projectId} goal={editor.goal} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      <MissionActionDialog
        action={pendingMissionAction}
        isPending={missionActionPending}
        error={missionActionError}
        onClose={() => {
          setPendingMissionAction(null);
          setMissionActionError(null);
        }}
        onConfirm={confirmMissionAction}
      />
    </main>
  );
}