import type { AiExecutionProjection } from '@workspace/api-client-react';
import type { EngineeringAgentProjection } from '@/lib/ai-missions';

export type ExecutionPresentationKey =
  | 'UNDERSTANDING'
  | 'INVESTIGATING'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'BUILDING'
  | 'VALIDATING'
  | 'READY_FOR_REVIEW'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'COMPLETE'
  | 'NEEDS_REPLAN'
  | 'NEEDS_ATTENTION'
  | 'INCOMPLETE';

export type ExecutionPresentation = {
  key: ExecutionPresentationKey;
  label: string;
  detail: string;
  /** The one server-authorized action that should be visually primary. */
  primaryAction: AiExecutionProjection['allowedActions'][number] | null;
  /** Human-readable instruction shown even when the state is waiting-only. */
  primaryActionLabel: string;
};

export type ExecutionPresentationInput = {
  projection: AiExecutionProjection;
  executionStatus?: string | null;
  flightState?: string | null;
  evidenceVerdict?: string | null;
  resumable?: boolean | null;
  nextAction?: string | null;
};

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function phaseMatches(phase: string, ...values: string[]): boolean {
  return values.some((value) => phase.includes(value));
}

function withPrimaryAction(
  state: Omit<ExecutionPresentation, 'primaryAction' | 'primaryActionLabel'>,
  preferredActions: AiExecutionProjection['allowedActions'][number][],
  waitingLabel: string,
  allowedActions: AiExecutionProjection['allowedActions'],
): ExecutionPresentation {
  const primaryAction = preferredActions.find((action) => allowedActions.includes(action)) ?? null;
  return {
    ...state,
    primaryAction,
    primaryActionLabel: primaryAction ? actionLabel(primaryAction) : waitingLabel,
  };
}

function actionLabel(action: AiExecutionProjection['allowedActions'][number]): string {
  switch (action) {
    case 'CANCEL':
      return 'إيقاف هذا التنفيذ';
    case 'RESUME_CHECKPOINT':
      return 'استئناف هذا التنفيذ';
    case 'RETRY_CHECKPOINT':
      return 'إعادة المحاولة من نقطة الحفظ';
    case 'START_NEW_RUN':
      return 'بدء تنفيذ جديد';
    case 'REVIEW_PROOF':
      return 'مراجعة الأدلة المسجلة';
    case 'REVIEW_DIFF':
      return 'مراجعة التغييرات';
    case 'APPROVE_CHANGES':
      return 'الموافقة على التغييرات';
  }
}

/**
 * Reduces the server-owned execution signals to the one state an operator
 * needs first. The raw signals remain available in the technical details.
 */
export function getExecutionPresentation(input: ExecutionPresentationInput): ExecutionPresentation {
  const executionStatus = normalized(input.executionStatus);
  const flightState = normalized(input.flightState);
  const evidenceVerdict = normalized(input.evidenceVerdict ?? input.projection.verification?.evidenceVerdict);
  const nextAction = normalized(input.nextAction);
  const phase = normalized(input.projection.phase);
  const verification = input.projection.verification?.status;
  const stopped = input.projection.stopped?.outcome;
  const deliveryCompleted = input.projection.timeline?.some(
    (item) => item.id === 'deliver' && item.status === 'completed',
  ) ?? false;
  const allowedActions = input.projection.allowedActions ?? [];

  if (nextAction.includes('REPLAN')) {
    return withPrimaryAction({
      key: 'NEEDS_REPLAN',
      label: 'يحتاج تعديل الخطة',
      detail: 'أبقى الخادم هذا التنفيذ غير مكتمل. يلزم تعديل الخطة ضمن النطاق المسموح قبل المتابعة.',
    }, ['RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'REVIEW_PROOF', 'START_NEW_RUN'], 'مراجعة سبب تعديل الخطة', allowedActions);
  }

  if (stopped === 'INTERRUPTED' || executionStatus === 'CANCELLED' || executionStatus === 'CANCELLING' || flightState === 'CANCELLED') {
    return withPrimaryAction({
      key: 'INCOMPLETE',
      label: input.resumable ? 'متوقف — يمكن استئنافه' : 'غير مكتمل',
      detail: input.resumable
        ? 'توقف العمل مع حفظ نقطة للمتابعة. يمكن استئناف التنفيذ نفسه من الإجراء المسموح.'
        : 'توقف العمل قبل تسجيل نتيجة مكتملة ومقبولة.',
    }, ['RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'بدء تنفيذ جديد', allowedActions);
  }

  if (input.projection.approval?.required && input.projection.approval.status === 'PENDING') {
    return withPrimaryAction({
      key: 'AWAITING_APPROVAL',
      label: 'بانتظار موافقتك',
      detail: 'الخطة أو التغييرات المقترحة جاهزة للمراجعة. تطبيق التغييرات يتطلب الموافقة اللازمة.',
    }, ['APPROVE_CHANGES', 'REVIEW_DIFF', 'REVIEW_PROOF'], 'مراجعة الخطة التي تنتظر موافقتك', allowedActions);
  }

  const successfulTerminalClaim = flightState === 'PUSHED'
    || deliveryCompleted
    || executionStatus === 'COMPLETED'
    || stopped === 'SUCCEEDED';
  if (
    successfulTerminalClaim
    && input.projection.verification?.proofRequired === true
    && evidenceVerdict !== 'PROVEN'
  ) {
    return withPrimaryAction({
      key: 'NEEDS_ATTENTION',
      label: 'الإثبات المطلوب غير مكتمل',
      detail: 'سجّل الخادم انتهاءً ناجحًا، لكن الإثبات المطلوب غير مثبت. لا تعتبر النتيجة مقبولة من هذه الحالة.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'مراجعة الإثبات غير المكتمل', allowedActions);
  }

  if (stopped === 'FAILED' || executionStatus === 'FAILED' || flightState === 'BLOCKED' || verification === 'failed' || evidenceVerdict === 'BLOCKED') {
    return withPrimaryAction({
      key: 'NEEDS_ATTENTION',
      label: 'يحتاج مراجعتك',
      detail: 'سجّل الخادم عائقًا أو خطوة لم تنجح. راجع الأدلة، ثم استخدم إجراء الاسترداد المتاح إن وجد.',
    }, ['REVIEW_PROOF', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'مراجعة سبب التوقف المسجل', allowedActions);
  }

  if (flightState === 'PUSHED') {
    return withPrimaryAction({
      key: 'DELIVERED',
      label: 'سُجّل التسليم',
      detail: 'سجّل الخادم تسليم التغيير. راجع إيصال التسليم والأدلة لمعرفة نطاق النتيجة وحدودها.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'فتح إيصال التسليم', allowedActions);
  }

  if (deliveryCompleted) {
    return withPrimaryAction({
      key: 'DELIVERED',
      label: 'سُجّل التسليم',
      detail: 'سجّل الخادم تسليم التغيير. راجع إيصال التسليم والأدلة لمعرفة نطاق النتيجة وحدودها.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'فتح إيصال التسليم', allowedActions);
  }

  if (flightState === 'COMMITTED') {
    return withPrimaryAction({
      key: 'DELIVERING',
      label: 'حُفظ التغيير — لم يُرسل بعد',
      detail: 'سُجّل حفظ التغيير في سجل الإصدارات. إرساله يتم فقط عبر إجراء التسليم المطابق الذي يتيحه الخادم.',
    }, ['REVIEW_PROOF'], 'متابعة التسليم من صفحة التنفيذ المسؤولة', allowedActions);
  }

  if (flightState === 'APPLIED') {
    return withPrimaryAction({
      key: 'DELIVERING',
      label: 'طُبّق التغيير — لم يُحفظ كإصدار بعد',
      detail: 'سُجّل تطبيق التغيير المعتمد على المشروع. حفظه في سجل الإصدارات وتسليمه خطوتان منفصلتان.',
    }, ['REVIEW_PROOF'], 'متابعة التسليم من صفحة التنفيذ المسؤولة', allowedActions);
  }

  if (flightState === 'READY_FOR_REVIEW' || input.projection.workspace?.diffStatus === 'available' && verification === 'passed') {
    return withPrimaryAction({
      key: 'READY_FOR_REVIEW',
      label: 'جاهز للمراجعة',
      detail: 'يوجد تغيير قابل للمراجعة وتحقق مسجل. راجع الفروق قبل التسليم؛ هذه الحالة ليست إثبات قبول حديثًا.',
    }, ['REVIEW_DIFF', 'REVIEW_PROOF'], 'مراجعة التغييرات المسجلة', allowedActions);
  }

  if (verification === 'unavailable' || evidenceVerdict === 'UNAVAILABLE') {
    return withPrimaryAction({
      key: 'NEEDS_ATTENTION',
      label: 'يحتاج مراجعتك',
      detail: 'التحقق أو الأدلة المطلوبة غير مكتملة. لا تعتبر هذا التنفيذ مقبولًا من هذه البيانات.',
    }, ['REVIEW_PROOF', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'مراجعة الأدلة غير المكتملة', allowedActions);
  }

  // Retained checkpoints may still describe the last active phase. Terminal
  // status wins only after approval, delivery, and incomplete-proof guards.
  if (executionStatus === 'COMPLETED' || stopped === 'SUCCEEDED') {
    return withPrimaryAction({
      key: 'COMPLETE',
      label: 'انتهى بحسب السجل',
      detail: 'سجّل الخادم انتهاء التنفيذ. هذا العرض وحده لا يثبت قبول النتيجة أو تسليمها أو سلامة أحدث نسخة.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'فتح سجل النتيجة', allowedActions);
  }

  if (verification === 'running' || flightState === 'VALIDATING' || phaseMatches(phase, 'VALIDAT')) {
    return withPrimaryAction({
      key: 'VALIDATING',
      label: 'جارٍ التحقق',
      detail: 'يفحص الخادم النتيجة الحالية ويجمع الأدلة المطلوبة للقبول.',
    }, ['CANCEL'], 'انتظار انتهاء التحقق', allowedActions);
  }

  if (phaseMatches(phase, 'BUILD', 'REPAIR') || flightState === 'BUILDING' || flightState === 'REPAIRING') {
    return withPrimaryAction({
      key: 'BUILDING',
      label: 'جارٍ إعداد التغيير',
      detail: 'يجري إعداد تغيير داخل نطاق المشروع المعتمد.',
    }, ['CANCEL'], 'انتظار إعداد التغيير المقترح', allowedActions);
  }

  if (phaseMatches(phase, 'PLAN')) {
    return withPrimaryAction({
      key: 'PLANNING',
      label: 'جارٍ إعداد الخطة',
      detail: 'يحوّل الخادم الطلب إلى خطة محددة النطاق ويحدد الملفات اللازمة.',
    }, ['CANCEL'], 'مراجعة الخطة عندما تصبح جاهزة', allowedActions);
  }

  if (phaseMatches(phase, 'DISCOVER', 'ORIENT', 'EXPLORE', 'READ', 'SEARCH')) {
    return withPrimaryAction({
      key: 'INVESTIGATING',
      label: 'جارٍ فحص المشروع',
      detail: 'يجري قراءة المشروع وجمع الأدلة من مصادره للإجابة عن الطلب.',
    }, ['CANCEL'], 'متابعة جمع أدلة المشروع', allowedActions);
  }

  if (executionStatus === 'QUEUED' || phaseMatches(phase, 'CHAT', 'INTAKE')) {
    return withPrimaryAction({
      key: 'UNDERSTANDING',
      label: 'جارٍ فهم الطلب',
      detail: 'يحدد الخادم نطاق الطلب قبل بدء العمل على المشروع.',
    }, ['CANCEL'], 'انتظار بدء التنفيذ', allowedActions);
  }

  return withPrimaryAction({
    key: 'INVESTIGATING',
    label: 'العمل جارٍ',
    detail: 'التنفيذ نشط بحسب السجل. تتحدث هذه الحالة عند تسجيل الخطوة التالية ضمن النطاق المسموح.',
  }, ['CANCEL'], 'متابعة العمل الجاري', allowedActions);
}

export type MissionState = {
  key: EngineeringAgentProjection['state'];
  label: string;
  detail: string;
  nextAction: EngineeringAgentProjection['nextAction']['kind'];
  nextActionLabel: string;
  reasonCode: string;
  interventionRequired: boolean;
  interventionLabel: string;
};

const missionStateLabels: Record<EngineeringAgentProjection['state'], string> = {
  PLANNING: 'قيد التخطيط',
  WORKING: 'العمل جارٍ',
  VERIFYING: 'قيد التحقق',
  AWAITING_APPROVAL: 'بانتظار موافقتك',
  RECOVERING: 'يحتاج إلى استرداد',
  DELIVERING: 'بانتظار مراجعة التسليم',
  COMPLETE: 'اكتمل بإثبات مقبول',
  NEEDS_ATTENTION: 'يحتاج مراجعتك',
};

const missionReasonDetails: Record<string, string> = {
  mission_draft: 'الهدف الرئيسي مسودة ولم يبدأ Mission Runtime العمل عليه.',
  mission_cancelled: 'أُلغيت المهمة؛ يجب ألا يستمر التنفيذ.',
  mission_blocked: 'سجّل الخادم عائقًا أو حاجة إلى تعديل الخطة.',
  mission_not_active: 'المهمة ليست في حالة تسمح بمتابعة التنفيذ.',
  plan_revision_mismatch: 'الخطوة لا تطابق إصدار الخطة النشط؛ راجع الخطة قبل أي متابعة.',
  approval_pending: 'تنتظر هذه الخطوة موافقتك. لن تُنفّذ الموافقة تلقائيًا.',
  required_evidence_incomplete: 'النتيجة لم تستوفِ الأدلة المطلوبة، لذلك لا تُعد مقبولة.',
  required_evidence_unavailable: 'تعذر التحقق من الأدلة الحالية؛ لا تُعد النتيجة مقبولة.',
  required_evidence_stale: 'الأدلة المسجلة قديمة ولا تثبت النسخة الحالية من النتيجة.',
  acceptance_blocked: 'لم يجتز القبول الحالي جميع فحوص الإثبات والارتباط المطلوبة.',
  verification_in_progress: 'يفحص Mission Runtime النتيجة والأدلة المسجلة.',
  execution_in_progress: 'ينفذ Mission Runtime الخطوة الحالية ضمن الخطة النشطة.',
  execution_queued: 'الخطوة مسجلة في قائمة Mission Runtime، ولا يوجد إذن متابعة تلقائية.',
  goal_waiting_for_event: 'تنتظر الخطوة حدثًا أو موعدًا مسجلًا قبل المتابعة.',
  continuation_authorized: 'سمح Mission Runtime بالمتابعة لهذه الخطوة تحديدًا.',
  execution_resumable: 'أكّد سجل القبول أن المحاولة الحالية قابلة للاستئناف.',
  execution_retryable: 'أكّد سجل القبول أن المحاولة الحالية قابلة لإعادة المحاولة.',
  delivery_review_required: 'يتطلب التسليم الخارجي مراجعة منفصلة؛ وضع الاستقلالية لا ينفذه وحده.',
  mission_proven_complete: 'اكتمل الهدف بعد اجتياز بوابة القبول والإثبات الحالية.',
  no_active_goal: 'لا توجد خطوة مرتبطة بإصدار الخطة النشط لتبرير حالة الاكتمال.',
  goal_requires_replan: 'تحتاج الخطوة إلى مراجعة أو خطة جديدة قبل أي متابعة.',
  state_unresolved: 'تعذر حسم الحالة بأمان من بيانات Mission الحالية.',
};

const missionActionLabels: Record<EngineeringAgentProjection['nextAction']['kind'], string> = {
  AUTO_CONTINUE: 'المتابعة مسموحة عبر Mission Runtime',
  RESUME: 'استئناف المحاولة المسجلة عبر Mission Runtime',
  RETRY: 'إعادة المحاولة المسجلة عبر Mission Runtime',
  APPROVE: 'راجع الموافقة المطلوبة في الخطوة',
  REVIEW: 'راجع الخطة أو الإثبات المسجل',
  STOP: 'أوقف متابعة هذا المسار',
  NONE: 'لا يوجد إجراء مطلوب الآن',
};

export function getMissionState(projection: EngineeringAgentProjection): MissionState {
  return {
    key: projection.state,
    label: missionStateLabels[projection.state],
    detail: missionReasonDetails[projection.nextAction.reasonCode]
      ?? 'تُعرض الحالة والقرار كما حددهما الخادم لهذا الإسقاط.',
    nextAction: projection.nextAction.kind,
    nextActionLabel: missionActionLabels[projection.nextAction.kind],
    reasonCode: projection.nextAction.reasonCode,
    interventionRequired: projection.intervention.required,
    interventionLabel: projection.intervention.required
      ? 'يتطلب تدخلًا بشريًا'
      : 'لا يتطلب تدخلًا بشريًا الآن',
  };
}
