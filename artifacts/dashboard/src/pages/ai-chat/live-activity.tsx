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
  understand: 'فهم الطلب',
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
      return `جارٍ قراءة المصدر${suffix}`;
    case 'search_code':
      return `جارٍ البحث في الشيفرة${suffix}`;
    case 'list_files':
      return `جارٍ فهرسة ملفات المشروع${suffix}`;
    case 'git_status':
      return 'جارٍ فحص حالة المستودع';
    case 'git_diff':
      return 'جارٍ مراجعة التغييرات الأخيرة';
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
        ? `تتطلب التغييرات موافقة مسبقة: ${(entry.files ?? []).join(', ') || 'approved files'}`
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
          label: entry.resultKind === 'cancelled' ? 'أُلغيت الأداة' : 'تعذّر تنفيذ الأداة',
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
        label: 'رد النموذج',
        detail: 'تم استلام رد المزود',
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'iteration_start' && typeof entry.iter === 'number' && entry.iter > 0) {
      events.push({
        id: nextId++,
        kind: 'iteration',
        label: 'تكرار استدلال النموذج',
        detail: `${entry.iter + 1}/${entry.maxIterations ?? '?'}`,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'synthesis_start') {
      events.push({
        id: nextId++,
        kind: 'synthesis',
        label: 'بدأ تجميع النتيجة',
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
             ? `الزمن ${formatValidationDuration(entry.validation.elapsedMs)}`
             : undefined,
           entry.validation?.remainingMs !== undefined
             ? `المتبقي ${formatValidationDuration(entry.validation.remainingMs)}`
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
          ? 'جارٍ التحقق ضمن دورة الإصلاح'
          : state === 'REPAIRING'
            ? 'سُمح بمحاولة تصحيح محدودة'
            : state === 'READY_FOR_REVIEW'
              ? 'جاهز للمراجعة'
              : 'تعذّر الإصلاح',
        detail: state === 'VALIDATING'
          ? `${entry.reason ?? 'التحقق الذي يديره الخادم جارٍ.'} انتظر النتيجة المحدودة؛ يظل الترويج محظورًا حتى اجتياز التحقق.`
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
        label: isPhaseRejection ? 'منعت سياسة المرحلة هذا الإجراء' : 'تشخيص التنفيذ',
        detail: isPhaseRejection && entry.phase && entry.tool
          ? `${entry.tool} رُفضت في مرحلة ${entry.phase}`
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
      ? { ...event, status: 'info', detail: event.detail ?? 'لم تُسجّل نتيجة لهذه الأداة' }
      : event,
  );
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}ث`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}د ${String(remainder).padStart(2, '0')}ث`;
}

type LiveProgressStage = 'preparing' | 'planning' | 'evidence' | 'synthesis' | 'writing' | 'validation' | 'repair' | 'recovery' | 'completed' | 'queued';

const LIVE_PROGRESS_STAGES: Array<{ key: LiveProgressStage; label: string }> = [
  { key: 'preparing', label: 'التهيئة' },
  { key: 'planning', label: 'التخطيط' },
  { key: 'evidence', label: 'جمع الأدلة' },
  { key: 'synthesis', label: 'تجميع النتيجة' },
  { key: 'writing', label: 'صياغة الرد' },
  { key: 'validation', label: 'التحقق' },
  { key: 'repair', label: 'الإصلاح' },
];

function deriveLiveProgressStage(
  stage: string | null,
  streamingContent: string,
  activeStep: LiveAgentToolStep | undefined,
  diagnostics: string[],
): LiveProgressStage {
  const normalized = (stage ?? '').toLowerCase();
  if (/validation\s+passed|passed\s+validation|ready for review|evidence verified|verification completed/.test(normalized)) return 'completed';
  if (/project scan queued/.test(normalized)) return 'queued';
  if (/repairing|repair correction allowed/.test(normalized)) return 'repair';
  if (/disconnect|interrupted|recover|failed|stopped|cancel|blocked|execution ended|execution saved|execution completed|execution cancelled|execution canceled|still running on the server|server is still being checked|incomplete|unavailable/.test(normalized)) return 'recovery';
  if (/validat|verification|audit state/.test(normalized)) return 'validation';
  if (normalized.includes('synthes')) return 'synthesis';
  if (streamingContent || normalized.includes('writing response') || normalized.includes('streaming')) return 'writing';
  if (activeStep || /reading|evidence|source|tool/.test(normalized)) return 'evidence';
  if (/calling|model response|iteration/.test(normalized)) return 'planning';
  if (normalized.includes('diagnostic') || diagnostics.length > 0) return 'recovery';
  if (/building context|connecting|reserved|starting/.test(normalized)) return 'preparing';
  return 'planning';
}

export function localizeLiveStageLabel(stage: string | null): string {
  if (!stage) return 'جارٍ بدء التحليل';
  const normalized = stage.toLowerCase();
  if (/connection interrupted|disconnect|interrupted|server is still being checked/.test(normalized)) return 'انقطع الاتصال؛ جارٍ التحقق من حالة التنفيذ على الخادم';
  if (/execution saved|saved execution|ready to resume/.test(normalized)) return 'تم حفظ التنفيذ؛ وهو جاهز للاستئناف';
  if (/still running on the server/.test(normalized)) return 'ما زال التنفيذ جاريًا على الخادم؛ جارٍ التحقق من حالته';
  if (/project scan queued/.test(normalized)) return 'تم وضع فحص المشروع في قائمة الانتظار';
  if (/execution completed/.test(normalized)) return 'اكتمل التنفيذ؛ جارٍ استعادة النتيجة المحفوظة';
  if (/execution cancelled|execution canceled/.test(normalized)) return 'أُلغي التنفيذ؛ جارٍ استعادة النتيجة المحفوظة';
  if (/evidence state updated/.test(normalized)) return 'تم تحديث حالة الأدلة';
  if (/execution ended/.test(normalized)) return 'انتهى التنفيذ؛ يلزم بدء تشغيل جديد';
  if (/execution stopped|execution guard stopped/.test(normalized)) return 'توقف التنفيذ بفعل حاجز الحماية';
  if (/execution diagnostic:/.test(normalized)) return stage.replace(/^Execution diagnostic:/i, 'تشخيص التنفيذ:');
  if (/evidence verified/.test(normalized)) return 'تم التحقق من الأدلة';
  if (/evidence unavailable|audit remains incomplete/.test(normalized)) return 'الفحص غير مكتمل؛ الأدلة غير كافية';
  if (/validation.*passed|passed.*validation/.test(normalized)) return 'اجتاز التنفيذ التحقق';
  if (/ready for review/.test(normalized)) return 'جاهز للمراجعة';
  if (/validation.*blocked|blocked.*validation/.test(normalized)) return 'حُظر التحقق';
  if (/validation.*failed|failed.*validation/.test(normalized)) return 'فشل التحقق';
  if (/verification completed|evidence verification completed/.test(normalized)) return 'اكتمل التحقق من الأدلة';
  if (/validat|verification/.test(normalized)) return 'جارٍ التحقق من التنفيذ';
  if (/repair.*blocked|blocked.*repair/.test(normalized)) return 'تعذّر الإصلاح';
  if (/^repairing$|repair correction allowed/.test(normalized)) return 'جارٍ تنفيذ محاولة إصلاح محدودة';
  if (/^validating$|repair loop validating/.test(normalized)) return 'جارٍ التحقق من التنفيذ';
  if (/repair.*validat|validat.*repair/.test(normalized)) return 'جارٍ التحقق ضمن دورة الإصلاح';
  if (/repair/.test(normalized)) return 'جارٍ تنفيذ محاولة إصلاح محدودة';
  if (/model response/.test(normalized)) return 'وصل رد النموذج';
  if (/evidence mode/.test(normalized)) return 'وضع جمع الأدلة';
  if (/request mode/.test(normalized)) return 'وضع الطلب';
  if (/synthes/.test(normalized)) return 'جارٍ تجميع النتيجة';
  if (/streaming|writing response/.test(normalized)) return 'جارٍ صياغة الرد';
  if (/building context|connecting|starting/.test(normalized)) return 'جارٍ إعداد سياق المشروع';
  return 'جارٍ تنفيذ الخطوة الحالية';
}

const KNOWN_ACTIVITY_LABELS: Record<string, string> = {
  'Connecting to the AI stream': 'جارٍ الاتصال ببث المساعد',
  'Connecting…': 'جارٍ الاتصال بمساعد الذكاء الاصطناعي',
  'Model response received': 'وصل رد النموذج',
  'Writing response…': 'جارٍ صياغة الرد…',
  'Connection interrupted — checking the saved execution…': 'انقطع الاتصال؛ جارٍ التحقق من حالة التنفيذ المحفوظ…',
  'Saved execution recovered — checking server status…': 'تم استرجاع التنفيذ المحفوظ؛ جارٍ التحقق من حالة الخادم…',
  'Automatic recovery is available — resume manually if it remains paused': 'الاستعادة التلقائية متاحة؛ استأنف التنفيذ يدويًا إذا ظل متوقفًا.',
  'Execution plan loaded': 'تم تحميل خطة التنفيذ',
  'Response verification': 'التحقق من الاستجابة',
  'Audit state': 'حالة التدقيق',
  'Model response': 'رد النموذج',
  'Model iteration': 'تكرار استدلال النموذج',
  'Synthesis started': 'بدأ تجميع النتيجة',
  'Tool cancelled': 'أُلغيت الأداة',
  'Tool failed': 'تعذّر تنفيذ الأداة',
  'Validation passed': 'اجتاز التحقق',
  'Validation blocked': 'حُظر التحقق',
  'Validation failed': 'فشل التحقق',
  'Repair loop validating': 'جارٍ التحقق ضمن دورة الإصلاح',
  'Repair correction allowed': 'سُمح بمحاولة تصحيح محدودة',
  'Ready for review': 'جاهز للمراجعة',
  'Repair blocked': 'تعذّر الإصلاح',
  'Phase policy blocked action': 'منعت سياسة المرحلة هذا الإجراء',
  'Execution diagnostic': 'تشخيص التنفيذ',
  'Execution guard': 'حاجز حماية التنفيذ',
  'Understand': 'فهم الطلب',
  'Scope': 'تحديد النطاق',
  'Plan': 'التخطيط',
  'Execute': 'التنفيذ',
  'Validate': 'التحقق',
};

export function localizeLiveActivityLabel(label: string): string {
  const exact = KNOWN_ACTIVITY_LABELS[label];
  if (exact) return exact;
  const mode = label.match(/^(Evidence|Request) mode:\s*(.*)$/i);
  if (mode) return `${mode[1]?.toLowerCase() === 'evidence' ? 'وضع جمع الأدلة' : 'وضع الطلب'}: ${mode[2] ?? ''}`;
  if (/^Writing response/i.test(label)) return 'جارٍ صياغة الرد';

  const validation = label.match(/^Validation (passed|blocked|failed)(.*)$/i);
  if (validation) {
    const status = validation[1]?.toLowerCase();
    const localized = status === 'passed' ? 'اجتاز التحقق' : status === 'blocked' ? 'حُظر التحقق' : 'فشل التحقق';
    return `${localized}${validation[2] ?? ''}`;
  }
  if (label === 'Stage') return 'المرحلة';
  return label;
}

function liveStageDescription(stage: string | null, streamingContent: string, activeStep: LiveAgentToolStep | undefined): string {
  if (streamingContent) return 'جارٍ صياغة الرد استنادًا إلى السياق الذي تم التحقق منه.';
  if (activeStep) {
    switch (activeStep.tool) {
      case 'read_file':
        return 'جارٍ قراءة محتوى الملفات لربط النتائج بأدلة فعلية.';
      case 'search_code':
        return 'جارٍ تحديد الرموز والمراجع ذات الصلة قبل فتح الملفات.';
      case 'list_files':
        return 'جارٍ استكشاف بنية المستودع لتحديد قراءات دقيقة ومحدودة.';
      default:
        return 'جارٍ تنفيذ فحص محدود للمستودع قبل المتابعة.';
    }
  }
  const normalized = (stage ?? '').toLowerCase();
  if (/repairing|repair correction allowed/.test(normalized)) {
    return 'لم يجتز التنفيذ التحقق السابق؛ جارٍ تنفيذ تصحيح محدود ثم إعادة التحقق.';
  }
  if (/validation\s+passed|passed\s+validation/.test(normalized)) {
    return 'اكتملت نتيجة التحقق بنجاح؛ لا تُعرض المراحل السابقة كمكتملة دون أدلة مستقلة.';
  }
  if (normalized.includes('ready for review')) {
    return 'النتيجة جاهزة للمراجعة؛ لم يُستنتج أي اعتماد أو تطبيق إضافي.';
  }
  if (/execution completed|execution cancelled|execution canceled/.test(normalized)) {
    return 'تم استرجاع النتيجة المحفوظة دون بدء تنفيذ جديد.';
  }
  if (normalized.includes('project scan queued')) {
    return 'تمت جدولة الفحص؛ لم تبدأ مرحلة التنفيذ التالية بعد.';
  }
  if (/evidence unavailable|audit remains incomplete/.test(normalized)) {
    return 'الفحص لم يكتمل؛ لا تكفي الأدلة الحالية لإثبات النتيجة.';
  }
  if (normalized.includes('evidence state updated')) {
    return 'تم تحديث حالة الأدلة وفق الحدث الوارد دون استنتاج تقدم إضافي.';
  }
  if (/execution saved|saved execution|ready to resume/.test(normalized)) {
    return 'حُفظ التنفيذ على الخادم؛ يمكن استئنافه دون اعتبار أي مرحلة غير مسجلة مكتملة.';
  }
  if (/still running on the server/.test(normalized)) {
    return 'التنفيذ ما زال جاريًا على الخادم؛ لم تُستنتج مرحلة نشطة من انقطاع البث.';
  }
  if (/disconnect|interrupted|server is still being checked/.test(normalized)) {
    return 'انقطع الاتصال أو تعذّر تحديثه؛ لا تُعرض أي مرحلة على أنها نشطة حتى تتضح حالة التنفيذ.';
  }
  if (/verification completed|evidence verification completed/.test(normalized)) {
    return 'اكتمل التحقق من الأدلة؛ لا يعني ذلك اعتماد التطبيق أو تسليم الشيفرة.';
  }
  if (normalized.includes('recover') || normalized.includes('diagnostic') || normalized.includes('execution stopped') || normalized.includes('execution saved')) {
    return 'تتطلب حالة التنفيذ معالجة أو تحققًا إضافيًا؛ تظل الأدلة التي جُمعت محفوظة ولا يُفترض اكتمال أي مرحلة.';
  }
  if (normalized.includes('synthes')) {
    return 'توقف جمع الأدلة مؤقتًا أثناء تجميع التقرير النهائي.';
  }
  if (normalized.includes('model response')) {
    return 'يقيم النموذج الحالي السياق المجموع ونتائج الأدوات.';
  }
  if (normalized.includes('building context')) {
    return 'جارٍ إعداد سياق المشروع قبل بدء الفحص المحدد.';
  }
  if (normalized.includes('calling ai') || normalized.includes('calling model')) {
    return 'يُرسل السياق المحدود إلى النموذج لاتخاذ القرار التالي.';
  }
  return 'ينسّق الوكيل الخطوة التالية ضمن نطاق الفحص المحدد.';
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
    ? 'جارٍ صياغة الرد'
    : activeStep
      ? liveToolLabel(activeStep)
      : localizeLiveStageLabel(stage);
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
      dir="rtl"
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
              <span className="font-medium text-primary">آخر تحديث:</span> {localizeLiveActivityLabel(latestProgress)}
            </p>
          )}
          {auditScopeDescription && (
            <div className="mt-2 rounded border border-primary/20 bg-background/25 px-2 py-1.5 text-[10px] leading-4 text-foreground/85">
              <span className="font-medium text-primary">النطاق المصرح به:</span>{' '}
              {auditScopeDescription}
            </div>
          )}
          {isFixtureLocal && (
            <p className="mt-1 text-[10px] leading-4 text-violet-300/80">
              لم يظهر الدليل إلا في مسارات fixture/test؛ ولم يُثبت بعد وصول التنفيذ إلى كود الإنتاج.
            </p>
          )}
          <div
            className="mt-2 grid grid-cols-2 gap-x-1 gap-y-1 sm:grid-cols-4 xl:grid-cols-7"
            aria-label="مراحل النشاط المباشر"
            role="list"
          >
            {LIVE_PROGRESS_STAGES.map(({ key, label }, index) => (
              <div
                key={key}
                className="min-w-0"
                role="listitem"
                aria-current={index === progressStageIndex && !isRecovery ? 'step' : undefined}
              >
                <div className={`h-1 rounded-full ${
                  index === progressStageIndex && !isRecovery ? phaseActiveColor : 'bg-border/70'
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
              تعذّر تحديد مرحلة تنفيذ نشطة؛ تظل الأدلة التي جُمعت محفوظة ولا يُفترض اكتمال أي مرحلة.
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
            الخطوة <span className="text-foreground">{activeStepNumber}</span> نشطة
          </span>
        )}
        {readSources > 0 && (
          <span>
            <span className="text-foreground">{readSources}</span> مصدر تمت قراءته
          </span>
        )}
        {iter && (
          <span>
            <span className="text-foreground">{iter.iter + 1}/{iter.max}</span> جولة
          </span>
        )}
        {diagnostics.length > 0 && (
          <span className="text-amber-300/90">
            {diagnostics.length} تنبيه استعادة
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
                <span className="min-w-0 break-words text-foreground/85">{localizeLiveActivityLabel(event.label)}</span>
                {event.detail && (
                  <code dir="auto" className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
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
            المصادر التي تمت قراءتها
            <span className="ml-1 text-foreground">{sourcePaths.length}</span>
          </div>
          <div className="mt-1 max-h-24 min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border/40 bg-background/20 p-1">
            {sourcePaths.map((source) => (
              <code key={source} dir="ltr" className="block min-w-0 break-all whitespace-normal rounded px-1 py-0.5 text-[9px] leading-4 text-muted-foreground">
                {redactInternalDetails(source)}
              </code>
            ))}
          </div>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="mt-1 break-words text-[10px] leading-4 text-amber-300/90" title={diagnostics[diagnostics.length - 1]}>
          الاستعادة: {diagnostics[diagnostics.length - 1]}
        </div>
      )}

      {lastCompleted && !activeStep && !streamingContent && (
        <div className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
          آخر إجراء مكتمل: {liveToolLabel(lastCompleted)}
        </div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
          title="يوقف عرض النشاط محليًا فقط؛ ويظل التنفيذ على الخادم قابلًا للاستئناف."
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
    <details open={defaultOpen} dir="rtl" className="mt-1 w-full min-w-0 max-w-full">
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
            <span className="min-w-0 break-words text-foreground/85">{localizeLiveActivityLabel(event.label)}</span>
            {event.detail && (
              <code dir="auto" className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
