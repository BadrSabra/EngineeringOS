import { useEffect, useRef } from 'react';
import { Activity, ChevronRight, Code2, GitMerge, Loader2, Search, Square, Zap } from 'lucide-react';
import { CAPABILITY_PROBE_MESSAGE } from '@workspace/ai-orchestrator/capability-probe';
import { formatValidationDuration } from './delivery-proof';
import { redactInternalDetails } from './provider-runtime';
import type { ToolTraceEntry } from './trace-parsing';

export const AI_ACTIONS = [
  { id: 'analyze', label: 'حلّل نتائج الفحص', description: 'اقترح ثلاثة تحسينات عملية من أحدث فحص.', icon: Search, prompt: 'Analyze the latest scan results and suggest the top 3 improvements.' },
  { id: 'review', label: 'راجع جودة المشروع', description: 'حدّد أهم مشكلات الجودة في هذا المشروع.', icon: Code2, prompt: 'Review the codebase and identify the most critical quality issues.' },
  { id: 'tasks', label: 'لخّص المهام', description: 'اعرف ما يحتاج إلى اهتمامك تاليًا.', icon: Zap, prompt: 'Summarize the current task backlog and what I should focus on next.' },
  { id: 'workflow', label: 'راجع تقدم العمل', description: 'راجع التقدم والعوائق والمخاطر.', icon: GitMerge, prompt: 'How are my workflows progressing? Any blockers or risks?' },
  // #80: one-click model capability probe. Sends the canonical probe body
  // (C1–C7) straight to the chat agent; all SSE diagnostics / forensic_status
  // panels surface per-sub-question in the existing live-activity UI.
  { id: 'probe', label: 'افحص قدرات المساعد', description: 'شغّل فحصًا منظمًا لقدرات المساعد ضمن المشروع.', icon: Activity, prompt: CAPABILITY_PROBE_MESSAGE },
];

export const COMMON_AI_ACTIONS = AI_ACTIONS.filter((action) => action.id === 'analyze' || action.id === 'review');

export const ADDITIONAL_AI_ACTIONS = AI_ACTIONS.filter((action) => action.id !== 'analyze' && action.id !== 'review');

export type LiveAgentToolStep = {
  activityId?: number;
  toolCallId?: string;
  tool: string;
  args?: Record<string, string>;
  done: boolean;
  cached?: boolean;
  source?: string;
};

export type LiveAgentActivityEvent = {
  id: number;
  kind: 'stage' | 'plan' | 'tool' | 'model' | 'iteration' | 'synthesis' | 'validation' | 'repair_state' | 'diagnostic' | 'phase_rejection' | 'guard';
  label: string;
  toolCallId?: string;
  tool?: string;
  detail?: string;
  status: 'active' | 'done' | 'info';
};

export const PLAN_STAGE_LABELS: Record<string, string> = {
  understand: 'الفهم',
  scope: 'تحديد النطاق',
  plan: 'التخطيط',
  execute: 'التنفيذ',
  validate: 'التحقق',
};

export function liveToolLabel(step: LiveAgentToolStep): string {
  const value = step.source ?? (step.args ? Object.values(step.args)[0] : undefined);
  const suffix = value
    ? ` · ${String(value).slice(0, 52)}${String(value).length > 52 ? '…' : ''}`
    : '';
  switch (step.tool) {
    case 'read_file':
      return `قراءة المصدر${suffix}`;
    case 'search_code':
      return `البحث في قاعدة الشيفرة${suffix}`;
    case 'list_files':
      return `استكشاف ملفات المشروع${suffix}`;
    case 'git_status':
      return 'فحص حالة المستودع';
    case 'git_diff':
      return 'مراجعة التغييرات الأخيرة';
    default:
      return `${step.tool}${suffix}`;
  }
}

export function activityEventsFromToolTrace(trace: ToolTraceEntry[]): LiveAgentActivityEvent[] {
  const events: LiveAgentActivityEvent[] = [];
  let nextId = 0;

  for (const entry of trace) {
    if (entry.kind === 'plan_activity' && entry.stage) {
      const approval = entry.approvalRequired
        ? `الموافقة مطلوبة قبل تغيير الملفات: ${(entry.files ?? []).join(', ') || 'approved files'}`
        : undefined;
      events.push({
        id: nextId++,
        kind: 'plan',
        label: `${PLAN_STAGE_LABELS[entry.stage] ?? 'نشاط الخطة'}${entry.stepTitle ? ` · ${entry.stepTitle}` : ''}`,
        detail: approval ?? entry.resultSummary ?? (entry.nextStepTitle ? `التالي: ${entry.nextStepTitle}` : undefined),
        status: (entry.status as 'active' | 'done' | 'info' | undefined) === 'active'
          ? 'active'
          : (entry.status as 'active' | 'done' | 'info' | undefined) === 'done'
            ? 'done'
            : 'info',
      });
      continue;
    }
    if (entry.kind === 'tool_call' && entry.tool) {
      events.push({
        id: nextId++,
        kind: 'tool',
        ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
        tool: entry.tool,
        label: liveToolLabel({
          tool: entry.tool,
          args: entry.args,
          done: false,
          cached: entry.cached,
        }),
        status: 'active',
      });
      continue;
    }

    if (entry.kind === 'tool_result' && entry.tool) {
      const reverseIndex = [...events].reverse().findIndex(
        (event) => event.kind === 'tool'
          && event.tool === entry.tool
          && event.status === 'active'
          && (!entry.toolCallId || event.toolCallId === entry.toolCallId),
      );
      if (reverseIndex >= 0) {
        const eventIndex = events.length - 1 - reverseIndex;
        const event = events[eventIndex]!;
        events[eventIndex] = {
          ...event,
          status: entry.resultKind === 'failed' || entry.resultKind === 'unavailable' || entry.resultKind === 'cancelled'
            ? 'info'
            : 'done',
          detail: entry.source
            ? `${entry.cached ? 'مخزّن مؤقتًا · ' : ''}${entry.source}`
            : entry.resultKind
              ? `${entry.resultKind}${entry.diagnosticCode ? ` · ${entry.diagnosticCode}` : ''}`
              : entry.cached ? 'مخزّن مؤقتًا' : undefined,
        };
        if (entry.resultSummary) events[eventIndex].detail = entry.resultSummary;
      }
      if (entry.resultKind === 'failed' || entry.resultKind === 'unavailable' || entry.resultKind === 'cancelled') {
        events.push({
          id: nextId++,
          kind: 'diagnostic',
          tool: entry.tool,
          label: entry.resultKind === 'cancelled' ? 'أُلغيت الأداة' : 'فشل تنفيذ الأداة',
          detail: entry.diagnosticCode ?? entry.resultSummary ?? 'لم تكتمل العملية.',
          status: 'info',
        });
      }
      continue;
    }

    if (entry.kind === 'model_call') {
      events.push({
        id: nextId++,
        kind: 'model',
        label: 'استجابة النموذج',
        detail: 'تم استلام استجابة مزوّد الخدمة',
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'iteration_start' && typeof entry.iter === 'number' && entry.iter > 0) {
      events.push({
        id: nextId++,
        kind: 'iteration',
        label: 'تكرار النموذج',
        detail: `${entry.iter + 1}/${entry.maxIterations ?? '?'}`,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'synthesis_start') {
      events.push({
        id: nextId++,
        kind: 'synthesis',
        label: 'بدأ تركيب النتائج',
        detail: typeof entry.iter === 'number'
          ? `${entry.iter + 1}/${entry.maxIterations ?? '?'}`
          : undefined,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'validation') {
      const status = entry.validation?.status ?? entry.validationStatus ?? 'unavailable';
      events.push({
        id: nextId++,
        kind: 'validation',
        label: status === 'passed'
          ? 'اجتاز التحقق'
          : status === 'blocked'
            ? 'حُظر التحقق'
            : 'فشل التحقق',
        detail: [
          entry.validation?.profile ?? entry.validationProfile,
           entry.validation?.terminalState
             ? `الحالة ${entry.validation.terminalState}`
             : undefined,
          (entry.attempt ?? entry.validationAttempt) != null
            ? `المحاولة ${entry.attempt ?? entry.validationAttempt}/${entry.maxAttempts ?? entry.validationMaxAttempts ?? '?'}`
            : undefined,
           entry.validation?.elapsedMs !== undefined
             ? `الزمن المنقضي ${formatValidationDuration(entry.validation.elapsedMs)}`
             : undefined,
           entry.validation?.remainingMs !== undefined
             ? `الزمن المتبقي ${formatValidationDuration(entry.validation.remainingMs)}`
             : undefined,
          (entry.validation?.exitCode ?? entry.validationExitCode) != null
            ? `رمز الخروج ${entry.validation?.exitCode ?? entry.validationExitCode}`
            : undefined,
          entry.validation?.detail ?? entry.validationDetail,
           entry.validation?.nextAction,
        ].filter(Boolean).join(' · '),
        status: status === 'passed' ? 'done' : 'info',
      });
      continue;
    }

    if (entry.kind === 'repair_state' && entry.repairState) {
      const state = entry.repairState;
      events.push({
        id: nextId++,
        kind: 'repair_state',
        label: state === 'VALIDATING'
          ? 'يجري التحقق ضمن دورة الإصلاح'
          : state === 'REPAIRING'
            ? 'سُمح بإجراء تصحيح'
            : state === 'READY_FOR_REVIEW'
              ? 'جاهز للمراجعة'
              : 'تم حظر الإصلاح',
        detail: state === 'VALIDATING'
          ? `${entry.reason ?? 'Server-owned validation is running.'} Wait for the bounded result; promotion remains blocked until validation passes.`
          : entry.reason,
        status: state === 'READY_FOR_REVIEW' ? 'done' : state === 'VALIDATING' ? 'active' : 'info',
      });
      continue;
    }

    if (entry.kind === 'diagnostic' && entry.code) {
      const isPhaseRejection = entry.code === 'EXECUTION_PHASE_TOOL_REJECTED';
      events.push({
        id: nextId++,
        kind: isPhaseRejection ? 'phase_rejection' : 'diagnostic',
        tool: entry.tool,
        label: isPhaseRejection ? 'سياسة المرحلة منعت الإجراء' : 'تشخيص التنفيذ',
        detail: isPhaseRejection && entry.phase && entry.tool
          ? `رُفضت الأداة ${entry.tool} خلال المرحلة ${entry.phase}`
          : entry.code,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'execution_guard') {
      events.push({
        id: nextId++,
        kind: 'guard',
        label: 'حاجز حماية التنفيذ',
        detail: entry.message ?? entry.code,
        status: 'info',
      });
    }
  }

  // A persisted trace is terminal. Do not show an orphaned tool call as
  // running after a reload.
  return events.map((event) =>
    event.status === 'active'
      ? { ...event, status: 'info', detail: event.detail ?? 'لم تُسجّل نتيجة لهذه الخطوة' }
      : event,
  );
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} ث`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes} د ${String(remainder).padStart(2, '0')} ث`;
}

type LiveProgressStage = 'preparing' | 'planning' | 'evidence' | 'synthesis' | 'writing' | 'validation' | 'recovery';

const LIVE_PROGRESS_STAGES: Array<{ key: LiveProgressStage; label: string }> = [
  { key: 'preparing', label: 'التحضير' },
  { key: 'planning', label: 'التخطيط' },
  { key: 'evidence', label: 'جمع الأدلة' },
  { key: 'synthesis', label: 'تركيب النتائج' },
  { key: 'writing', label: 'كتابة الرد' },
  { key: 'validation', label: 'التحقق' },
];

function deriveLiveProgressStage(
  stage: string | null,
  streamingContent: string,
  activeStep: LiveAgentToolStep | undefined,
  diagnostics: string[],
): LiveProgressStage {
  const normalized = (stage ?? '').toLowerCase();
  if (/disconnect|recover|failed|stopped|cancel/.test(normalized)) return 'recovery';
  if (/validat|verification|audit state|repair|ready for review|blocked/.test(normalized)) return 'validation';
  if (normalized.includes('synthes')) return 'synthesis';
  if (streamingContent || normalized.includes('writing response') || normalized.includes('streaming')) return 'writing';
  if (activeStep || /reading|evidence|source|tool/.test(normalized)) return 'evidence';
  if (/calling|model response|iteration/.test(normalized)) return 'planning';
  if (normalized.includes('diagnostic') || diagnostics.length > 0) return 'recovery';
  if (/building context|connecting|reserved|starting/.test(normalized)) return 'preparing';
  return 'planning';
}

export function liveStageDisplayLabel(stage: string | null): string {
  if (!stage) return 'جارٍ بدء التحليل';
  const mappings: Array<[RegExp, string]> = [
    [/^building context(?:…|\.\.\.)?/i, 'جارٍ تجهيز سياق المشروع…'],
    [/^calling ai model(?:…|\.\.\.)?/i, 'جارٍ استدعاء نموذج الذكاء الاصطناعي…'],
    [/^writing response(?:…|\.\.\.)?/i, 'جارٍ كتابة الرد…'],
    [/^model response received/i, 'تم استلام استجابة النموذج'],
    [/^validation passed/i, 'اجتاز التحقق'],
    [/^validation blocked/i, 'حُظر التحقق'],
    [/^validation failed/i, 'فشل التحقق'],
    [/^repair loop validating/i, 'يجري التحقق ضمن دورة الإصلاح'],
    [/^repair correction allowed/i, 'سُمح بإجراء تصحيح'],
    [/^ready for review/i, 'جاهز للمراجعة'],
    [/^repair blocked/i, 'تم حظر الإصلاح'],
    [/^synthesizing from gathered evidence/i, 'جارٍ تركيب النتائج من الأدلة المجمّعة'],
    [/^synthesizing/i, 'جارٍ تركيب النتائج'],
    [/^execution diagnostic:/i, 'تشخيص التنفيذ:'],
    [/^execution guard stopped the run/i, 'أوقف حاجز حماية التنفيذ العملية'],
    [/^execution stopped: repeated /i, 'توقف التنفيذ بسبب تكرار الأداة: '],
    [/^project scan queued/i, 'أُضيف فحص المشروع إلى قائمة الانتظار'],
    [/^project scan running/i, 'فحص المشروع قيد التنفيذ'],
    [/^project scan completed/i, 'اكتمل فحص المشروع'],
    [/^project scan failed/i, 'فشل فحص المشروع'],
    [/^evidence verified/i, 'تم التحقق من الأدلة'],
    [/^evidence unavailable/i, 'الأدلة غير متاحة'],
    [/^audit remains incomplete/i, 'ما زال التدقيق غير مكتمل'],
    [/^evidence state updated/i, 'تم تحديث حالة الأدلة'],
  ];
  for (const [pattern, label] of mappings) {
    const match = stage.match(pattern);
    if (match) return `${label}${stage.slice(match[0].length)}`;
  }
  // Preserve unknown server stages instead of guessing their meaning.
  return stage;
}

function liveStageDescription(stage: string | null, streamingContent: string, activeStep: LiveAgentToolStep | undefined): string {
  if (streamingContent) return 'يجري تحويل السياق الذي تم التحقق منه إلى الرد المعروض أدناه.';
  if (activeStep) {
    switch (activeStep.tool) {
      case 'read_file':
        return 'قراءة محتوى المصدر لربط النتائج بأدلة فعلية.';
      case 'search_code':
        return 'البحث عن الرموز والمراجع ذات الصلة قبل فتح المصدر.';
      case 'list_files':
        return 'استكشاف ملفات المستودع لحصر القراءات التالية.';
      default:
        return 'تنفيذ فحص محدود للمستودع قبل المتابعة.';
    }
  }
  const normalized = (stage ?? '').toLowerCase();
  if (normalized.includes('recover') || normalized.includes('diagnostic')) {
    return 'فحص نموذج آخر باستخدام الأدلة التي جُمعت؛ لن تُضاف قراءات مصدر جديدة.';
  }
  if (normalized.includes('synthes')) {
    return 'توقف جمع الأدلة مؤقتًا أثناء إعداد التقرير النهائي.';
  }
  if (normalized.includes('model response')) {
    return 'يجري النموذج الحالي تقييم السياق ونتائج الأدوات التي جُمعت.';
  }
  if (normalized.includes('building context')) {
    return 'تجهيز سياق المشروع قبل بدء التحقيق المركز.';
  }
  if (normalized.includes('calling ai') || normalized.includes('calling model')) {
    return 'إرسال السياق المحدود إلى النموذج لاتخاذ القرار التالي.';
  }
  return 'ينسق الوكيل الخطوة التالية المحددة النطاق في التحقيق.';
}

export function LiveAgentActivity({
  stage,
  steps,
  activityEvents,
  iter,
  model,
  streamingContent,
  busy,
  elapsedSeconds,
  onCancel,
  modelHistory,
  diagnostics,
  isFixtureLocal,
  verdictScope,
  auditScopeDescription,
}: {
  stage: string | null;
  steps: LiveAgentToolStep[];
  activityEvents: LiveAgentActivityEvent[];
  iter: { iter: number; max: number } | null;
  model: string | null;
  streamingContent: string;
  busy: boolean;
  elapsedSeconds: number;
  onCancel?: () => void;
  modelHistory: Array<{ id: string; provider: string }>;
  diagnostics: string[];
  /** True once the live SSE stream reports a fixture-local forensic_status. */
  isFixtureLocal?: boolean;
  /** Task #58: live verdict proof scope from the decision_trace SSE event. */
  verdictScope?: {
    scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
    findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
    objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
  };
  auditScopeDescription?: string;
}) {
  const activityLogEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activityLogEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activityEvents.length]);

  if (!busy) return null;

  const completed = steps.filter((step) => step.done).length;
  const readSources = new Set(
    steps
      .filter((step) => step.done && step.tool === 'read_file' && step.source)
      .map((step) => step.source),
  ).size;
  const activeStep = [...steps].reverse().find((step) => !step.done);
  const lastCompleted = [...steps].reverse().find((step) => step.done);
  const sourcePaths = Array.from(new Set(
    steps
      .filter((step) => step.done && step.tool === 'read_file' && step.source)
      .map((step) => step.source as string),
  ));
  const activeStepNumber = activeStep ? steps.indexOf(activeStep) + 1 : completed;
  const progressStage = deriveLiveProgressStage(stage, streamingContent, activeStep, diagnostics);
  const progressStageIndex = LIVE_PROGRESS_STAGES.findIndex(({ key }) => key === progressStage);
  const isRecovery = progressStage === 'recovery';
  const activityLabel = streamingContent
    ? 'جارٍ كتابة الرد'
    : activeStep
      ? liveToolLabel(activeStep)
      : liveStageDisplayLabel(stage);
  const latestProgress = [...activityEvents].reverse().find(
    (event) => event.kind === 'stage' && event.status === 'info',
  )?.label;

  const borderColor = isFixtureLocal ? 'border-violet-500/30' : 'border-primary/20';
  const bgColor = isFixtureLocal ? 'bg-violet-500/5' : 'bg-primary/5';
  const accentColor = isFixtureLocal ? 'text-violet-300' : 'text-primary';
  const accentBg = isFixtureLocal ? 'bg-violet-500/10' : 'bg-primary/10';
  const phaseActiveColor = isFixtureLocal ? 'bg-violet-400' : 'bg-primary';
  const phaseActiveTextColor = isFixtureLocal ? 'text-violet-300' : 'text-primary';

  return (
    <div
      className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg border ${borderColor} ${bgColor} px-3 py-2.5`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${accentBg}`}>
          <Loader2 className={`h-3.5 w-3.5 animate-spin ${accentColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">{activityLabel}</span>
            {isFixtureLocal && (
              <span className="rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                FIXTURE-LOCAL
              </span>
            )}
            {verdictScope?.scope && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                verdictScope.scope === 'PRODUCTION' || verdictScope.scope === 'MIXED'
                  ? 'border-green-500/50 bg-green-500/15 text-green-200'
                  : 'border-violet-500/50 bg-violet-500/15 text-violet-200'
              }`}>
                {String(verdictScope.scope).replace(/_/g, ' ')}
              </span>
            )}
            {verdictScope?.objectiveVerdict && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                verdictScope.objectiveVerdict === 'ANSWER_COMPLETE'
                  ? 'border-green-500/50 bg-green-500/15 text-green-200'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-200'
              }`}>
                {String(verdictScope.objectiveVerdict).replace(/_/g, ' ')}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {formatElapsed(elapsedSeconds)} · مباشر
            </span>
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
            {liveStageDescription(stage, streamingContent, activeStep)}
          </p>
          {latestProgress && (
            <p className="mt-1 break-words text-[10px] leading-4 text-foreground/80">
              <span className="font-medium text-primary">آخر تحديث:</span> {latestProgress}
            </p>
          )}
          {auditScopeDescription && (
            <div className="mt-2 rounded border border-primary/20 bg-background/25 px-2 py-1.5 text-[10px] leading-4 text-foreground/85">
              <span className="font-medium text-primary">النطاق المصرّح به:</span>{' '}
              {auditScopeDescription}
            </div>
          )}
          {isFixtureLocal && (
            <p className="mt-1 text-[10px] leading-4 text-violet-300/80">
              الأدلة موجودة فقط في مسارات fixture/test؛ ولم يُثبت بعد وصولها إلى مسارات الإنتاج.
            </p>
          )}
          <div
            className="mt-2 grid grid-cols-2 gap-x-1 gap-y-1 sm:grid-cols-3 lg:grid-cols-6"
            aria-label={`تقدم الوكيل: ${LIVE_PROGRESS_STAGES[progressStageIndex]?.label ?? 'نشط'}`}
            role="list"
          >
            {LIVE_PROGRESS_STAGES.map(({ key, label }, index) => (
              <div
                key={key}
                className="min-w-0"
                role="listitem"
                aria-current={index === progressStageIndex ? 'step' : undefined}
              >
                <div className={`h-1 rounded-full ${
                  index <= progressStageIndex && !isRecovery ? phaseActiveColor : 'bg-border/70'
                }`} />
                <div className={`mt-1 truncate text-[9px] ${
                  index === progressStageIndex && !isRecovery ? phaseActiveTextColor : 'text-muted-foreground'
                }`}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          {isRecovery && (
            <div className="mt-2 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[10px] leading-4 text-amber-200">
              التنفيذ في حالة استرداد أو توقف؛ تُحتفظ بالأدلة التي جُمعت ولا يعني ذلك اكتمال المهمة.
            </div>
          )}
        </div>
      </div>

      <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2 text-[10px] text-muted-foreground`}>
        {steps.length > 0 && (
          <span>
            <span className="text-foreground">{completed}/{steps.length}</span> إجراء مكتمل
          </span>
        )}
        {activeStep && (
          <span>
            الخطوة <span className="text-foreground">{activeStepNumber}</span> قيد التنفيذ
          </span>
        )}
        {readSources > 0 && (
          <span>
            <span className="text-foreground">{readSources}</span> مصدر مقروء
          </span>
        )}
        {iter && (
          <span>
            <span className="text-foreground">{iter.iter + 1}/{iter.max}</span> جولة
          </span>
        )}
        {diagnostics.length > 0 && (
          <span className="text-amber-300/90">
            {diagnostics.length} تنبيه استرداد
          </span>
        )}
      </div>

      {activityEvents.length > 0 && (
        <div className={`mt-2 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2`}>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>النشاط المباشر</span>
            <span>{activityEvents.length} أحداث</span>
          </div>
          <div className="mt-1 max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border/40 bg-background/20 px-2 py-1.5">
            {activityEvents.map((event) => (
              <div key={event.id} className="flex min-w-0 items-start gap-1.5 py-0.5 text-[10px] leading-4">
                <span className={`mt-0.5 shrink-0 ${
                  event.status === 'done'
                    ? 'text-emerald-400'
                    : event.status === 'active'
                      ? accentColor
                      : 'text-muted-foreground'
                }`}>
                  {event.status === 'done' ? '✓' : event.status === 'active' ? '◌' : '·'}
                </span>
                <span className="min-w-0 break-words text-foreground/85">{event.label}</span>
                {event.detail && (
                  <code className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
                )}
              </div>
            ))}
            <div ref={activityLogEndRef} />
          </div>
        </div>
      )}

      {sourcePaths.length > 0 && (
        <div className={`mt-2 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2`}>
          <div className="text-[10px] text-muted-foreground">
            مصادر تمت قراءتها
            <span className="ml-1 text-foreground">{sourcePaths.length}</span>
          </div>
          <div className="mt-1 max-h-24 min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border/40 bg-background/20 p-1">
            {sourcePaths.map((source) => (
              <code key={source} className="block min-w-0 break-all whitespace-normal rounded px-1 py-0.5 text-[9px] leading-4 text-muted-foreground">
                {redactInternalDetails(source)}
              </code>
            ))}
          </div>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="mt-1 break-words text-[10px] leading-4 text-amber-300/90" title={diagnostics[diagnostics.length - 1]}>
          الاسترداد: {diagnostics[diagnostics.length - 1]}
        </div>
      )}

      {lastCompleted && !activeStep && !streamingContent && (
        <div className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
          آخر خطوة مكتملة: {liveToolLabel(lastCompleted)}
        </div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
          title="يوقف العرض المحلي المباشر فقط؛ ويظل التنفيذ على الخادم قابلاً للاستئناف."
        >
          <Square className="h-2.5 w-2.5 fill-current" />
          إيقاف العرض
        </button>
      )}
    </div>
  );
}

export function CompletedActivityTimeline({
  events,
  defaultOpen = false,
}: {
  events?: LiveAgentActivityEvent[];
  defaultOpen?: boolean;
}) {
  if (!events || events.length === 0) return null;

  return (
    <details open={defaultOpen} className="mt-1 w-full min-w-0 max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
        <Activity className="h-3 w-3" />
        <span>نشاط الوكيل</span>
        <span className="text-[10px]">· {events.length} أحداث</span>
        <ChevronRight className="h-3 w-3 transition-transform [[open]>&]:rotate-90" />
      </summary>
      <div className="mt-1 max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border/50 bg-background/30 px-3 py-2 text-[10px]">
        {events.map((event, index) => (
          <div key={`${event.id}-${index}`} className="flex min-w-0 items-start gap-1.5 leading-5">
            <span className={`shrink-0 ${
              event.status === 'done' ? 'text-emerald-400' :
                event.status === 'active' ? 'text-primary' : 'text-muted-foreground'
            }`}>
              {event.status === 'done' ? '✓' : event.status === 'active' ? '◌' : '·'}
            </span>
            <span className="min-w-0 break-words text-foreground/85">{event.label}</span>
            {event.detail && (
              <code className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
