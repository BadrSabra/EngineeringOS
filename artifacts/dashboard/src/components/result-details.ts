import type { AiExecutionProjection } from '@workspace/api-client-react';

/**
 * Display-only explanation of existing records. This module never produces
 * acceptance, enables actions, or promotes checkpoint PROVEN into Canonical Proof.
 */
export type ResultDetailsInput =
  | {
      kind: 'execution';
      projection?: AiExecutionProjection | null;
      executionStatus?: string | null;
      evidenceVerdict?: string | null;
      attempt?: number | null;
    }
  | {
      kind: 'goal';
      status: string;
      planBinding?: 'active_revision' | 'legacy_unversioned' | 'revision_mismatch';
      inCurrentPlan?: boolean;
      attempt?: number | null;
    };

export type ResultDetails = {
  title: string;
  explanation: string;
  tone: 'neutral' | 'working' | 'attention' | 'stopped';
  basis: string;
  verification: string;
  checks: string;
  scope: string;
  attempt: number | null;
};

const normalized = (value: unknown) => typeof value === 'string' ? value.toLowerCase() : '';

export function getResultDetails(input: ResultDetailsInput): ResultDetails {
  const projection = input.kind === 'execution' ? input.projection : null;
  const status = normalized(input.kind === 'goal' ? input.status : input.executionStatus);
  const verificationStatus = normalized(projection?.verification?.status);
  const verdict = normalized(input.kind === 'execution'
    ? input.evidenceVerdict ?? projection?.verification?.evidenceVerdict
    : null);
  const proofRequired = projection?.verification?.proofRequired;
  const approvalPending = projection?.approval?.required === true
    && normalized(projection.approval.status) === 'pending';
  const attempt = typeof input.attempt === 'number' && Number.isSafeInteger(input.attempt) && input.attempt >= 0
    ? input.attempt : null;

  const result: ResultDetails = {
    title: 'الحالة تحتاج تفاصيل',
    explanation: 'لا تتوفر حالة كافية لتحديد نتيجة هذا العمل.',
    tone: 'neutral',
    basis: 'حالة مسجلة، وليست إثباتًا حديثًا لإنجاز العمل.',
    verification: 'لا توجد تفاصيل تحقق كافية في البيانات المتاحة لهذه اللوحة.',
    checks: 'هذه اللوحة لا تتضمن أسماء الفحوص ونتائجها التفصيلية. غيابها هنا لا يعني أن العمل لم يُختبر.',
    scope: 'لا يُستنتج من هذه البيانات سلامة المشروع كله أو صلاحية أحدث نسخة أو اكتمال التسليم.',
    attempt,
  };

  if (input.kind === 'goal') {
    if (input.planBinding === 'revision_mismatch' || input.inCurrentPlan === false) {
      result.scope = 'ارتباط هذا الهدف بالخطة الحالية غير مطابق؛ لا يُحسب ضمن إنجازها من هذه الحالة وحدها.';
    } else if (input.planBinding === 'legacy_unversioned' || !input.planBinding) {
      result.scope = 'لا توجد نسخة خطة مثبتة في هذا العرض. لا تُفترض مطابقة الهدف للخطة الحالية.';
    } else {
      result.scope = 'الهدف مرتبط بالخطة الحالية؛ هذا الارتباط لا يثبت إنجازه أو تحقق أحدث نسخة من المشروع.';
    }
  } else if (verificationStatus === 'failed') {
    result.verification = 'سجّل الخادم أن التحقق لم يجتز. هذا لا يحدد وحده سبب الفشل أو سلامة بقية المشروع.';
  } else if (verificationStatus === 'unavailable') {
    result.verification = 'تفاصيل التحقق الكامل غير متاحة في هذا الإسقاط.';
  } else if (verificationStatus === 'running') {
    result.verification = 'التحقق ما زال جاريًا بحسب السجل، ولم تُسجّل نتيجته النهائية هنا.';
  } else if (verificationStatus === 'passed') {
    result.basis = 'حالة تحقق مسجلة من الخادم؛ تفاصيل الفحوص والإثبات الحديث غير مرفقة هنا.';
    result.verification = proofRequired === true
      ? 'سُجّل اجتياز التحقق، لكن إثبات القبول المطلوب لا يُستنتج من هذا الإسقاط.'
      : 'سُجّلت حالة اجتياز للتحقق في هذا التنفيذ؛ أسماء الفحوص وحدودها التفصيلية غير مرفقة هنا.';
  }
  if (input.kind === 'execution' && proofRequired === false) {
    result.scope = 'إثبات إنجاز هندسي غير مطلوب بحسب السجل. انتهاء الطلب لا يمنحه علامة تحقق هندسي أو يثبت تسليم تغيير.';
  }

  // Terminal records take precedence over pending approval/progress remnants.
  if (status === 'cancelled' || status === 'interrupted') {
    return { ...result, title: status === 'cancelled' ? 'توقف العمل بالإلغاء' : 'انقطع العمل',
      explanation: 'العمل ليس جاريًا بحسب الحالة المسجلة. أي استئناف يخضع للإجراء المسموح في صفحة التفاصيل.',
      tone: 'stopped' };
  }
  if (status === 'failed') {
    return { ...result, title: 'لم يكتمل العمل',
      explanation: 'سُجّلت حالة فشل. لا تعني أن كل الفحوص فشلت أو أن المشروع كله غير سليم.', tone: 'attention' };
  }
  if (approvalPending || ['paused', 'waiting_for_approval', 'blocked', 'needs_replan'].includes(status)) {
    return { ...result, title: 'يحتاج مراجعتك',
      explanation: 'العمل ينتظر مراجعة أو معالجة عائق. لا تُمنح موافقة من هذه الحالة؛ راجع القرار والإجراء المتاحين.', tone: 'attention' };
  }
  if (input.kind === 'execution' && (verificationStatus === 'failed'
    || proofRequired === true && verdict !== 'proven' && status === 'completed')) {
    return { ...result, title: 'لم أتمكن من تأكيد النتيجة',
      explanation: 'انتهاء التنفيذ لا يكفي لإثبات قبوله؛ التحقق المطلوب غير مكتمل أو لم يجتز بحسب البيانات المسجلة.',
      tone: 'attention' };
  }
  if (status === 'completed') {
    return { ...result, title: 'انتهى العمل بحسب السجل',
      explanation: 'هذه حالة انتهاء مسجلة، لا تأكيد حديث بأن النتيجة مقبولة أو مسلّمة أو أن أحدث نسخة سليمة.' };
  }
  if (['queued', 'pending', 'planning', 'draft', 'running', 'active', 'verifying', 'waiting_for_event', 'waiting', 'cancelling'].includes(status)) {
    return { ...result,
      title: status === 'cancelling' ? 'جارٍ إيقاف العمل' : 'العمل لم ينتهِ بعد',
      explanation: 'الحالة المسجلة تشير إلى عمل جارٍ أو منتظر. نسبة التقدم، حتى 100٪، لا تثبت إنجاز النتيجة.',
      tone: 'working' };
  }
  return result;
}
