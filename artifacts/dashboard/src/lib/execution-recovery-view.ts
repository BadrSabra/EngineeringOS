import type { AiExecutionProjection } from '@workspace/api-client-react';

export type ExecutionRecoveryStatus = {
  status?: string;
  linkedTaskId?: string | null;
  resumable?: boolean;
  proofRequired?: boolean;
  evidenceVerdict?: string | null;
  acceptance?: {
    resumable?: boolean;
    nextActionCode?: string;
  } | null;
  projection?: Pick<AiExecutionProjection, 'allowedActions'> | null;
};

export type ExecutionRecoveryView = {
  title: string;
  detail: string;
  action: 'resume' | 'retry' | null;
  actionLabel: string | null;
  nextStep: string;
};

export function executionCanResume(
  execution: ExecutionRecoveryStatus | null | undefined,
): boolean {
  if (
    !execution
    || execution.linkedTaskId
    || (execution.status !== 'paused' && execution.status !== 'failed')
  ) {
    return false;
  }
  // The durable status response is authoritative. Older records may not
  // contain acceptance or a projection, but an explicit refusal must win.
  return execution.resumable !== false
    && execution.acceptance?.resumable !== false
    && (
      execution.acceptance?.nextActionCode === undefined
      || execution.acceptance.nextActionCode === 'RESUME_ALLOWED'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_PARSE'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_TIMEOUT'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
    );
}

export function getExecutionRecoveryView(
  execution: ExecutionRecoveryStatus | null | undefined,
  historical: boolean,
): ExecutionRecoveryView {
  if (historical) {
    return {
      title: 'سجل سابق — للقراءة فقط',
      detail: 'راجع التنفيذ والأدلة المحفوظة. إجراءات الاسترداد تخص التنفيذ الحالي، لا هذا السجل السابق.',
      action: null,
      actionLabel: null,
      nextStep: 'مراجعة الأدلة المحفوظة',
    };
  }
  if (!execution?.status) {
    return {
      title: 'جارٍ التحقق من حالة التنفيذ المحفوظ',
      detail: 'ننتظر حالة الخادم قبل إتاحة إجراء للاسترداد.',
      action: null,
      actionLabel: null,
      nextStep: 'انتظار حالة الخادم',
    };
  }

  if (
    execution.linkedTaskId
    && (execution.status === 'paused' || execution.status === 'failed')
  ) {
    return {
      title: 'التنفيذ تابع لمهمة — الاسترداد من صفحة المهام',
      detail: 'المهمة المرتبطة تدير هذا التنفيذ. استأنفه أو أعد محاولته من تلك المهمة حتى تُراجع حالتها والميزانية المتبقية.',
      action: null,
      actionLabel: null,
      nextStep: 'فتح المهمة المرتبطة في صفحة المهام',
    };
  }

  const actions = execution.projection?.allowedActions;
  const retryAllowed = execution.status === 'failed'
    && actions?.includes('RETRY_CHECKPOINT')
    && (
      !execution.acceptance?.nextActionCode
      || ['RETRY_AFTER_PARSE', 'RETRY_AFTER_TIMEOUT', 'RETRY_AFTER_RATE_LIMIT']
        .includes(execution.acceptance.nextActionCode)
    );
  if (retryAllowed) {
    return {
      title: 'لم ينجح التنفيذ — يمكن إعادة المحاولة من نقطة الحفظ',
      detail: 'يسمح الخادم بإعادة المحاولة من نقطة الحفظ في التنفيذ نفسه. التسليم اللاحق يظل خاضعًا لسياسة المالك وبوابات الخادم.',
      action: 'retry',
      actionLabel: 'إعادة المحاولة من نقطة الحفظ',
      nextStep: 'إعادة محاولة هذا التنفيذ من نقطة الحفظ',
    };
  }

  const resumeAllowed = executionCanResume(execution)
    && (!actions || actions.includes('RESUME_CHECKPOINT'));
  if (resumeAllowed) {
    return {
      title: execution.status === 'failed'
        ? 'لم ينجح التنفيذ — يمكن استئنافه'
        : 'التنفيذ المحفوظ متوقف — يمكن استئنافه',
      detail: 'تابع التنفيذ المحفوظ من نقطة الحفظ. التسليم اللاحق يظل خاضعًا لسياسة المالك وبوابات الخادم.',
      action: 'resume',
      actionLabel: 'استئناف التنفيذ',
      nextStep: 'استئناف هذا التنفيذ المحفوظ',
    };
  }

  switch (execution.status) {
    case 'queued':
      return {
        title: 'التنفيذ في قائمة انتظار الخادم',
        detail: 'لم يبدأ الخادم هذا التنفيذ بعد.',
        action: null, actionLabel: null, nextStep: 'انتظار بدء التنفيذ',
      };
    case 'running':
      return {
        title: 'التنفيذ جارٍ على الخادم',
        detail: 'تتحدث بيانات التقدم والأدلة مع استمرار عمل الخادم.',
        action: null, actionLabel: null, nextStep: 'انتظار التنفيذ الحالي',
      };
    case 'cancelling':
      return {
        title: 'جارٍ إلغاء التنفيذ',
        detail: 'انتظر تسجيل الخادم للنتيجة النهائية.',
        action: null, actionLabel: null, nextStep: 'انتظار نتيجة الإلغاء',
      };
    case 'completed':
      return {
        title: execution.proofRequired && execution.evidenceVerdict !== 'PROVEN'
          ? 'انتهى التنفيذ — الإثبات غير مقبول'
          : 'انتهى التنفيذ — راجع الأدلة المسجلة',
        detail: 'انتهاء التنفيذ ليس موافقة على تطبيق التغييرات. راجع القبول والأدلة المسجلة.',
        action: null, actionLabel: null, nextStep: 'مراجعة الأدلة المسجلة',
      };
    case 'cancelled':
      return {
        title: 'أُلغي التنفيذ — راجع الأدلة المحفوظة',
        detail: 'توقف التنفيذ. راجع سجله المحفوظ قبل أن تقرر بدء تنفيذ جديد.',
        action: null, actionLabel: null, nextStep: 'مراجعة السجل المحفوظ',
      };
    case 'paused':
    case 'failed':
      return {
        title: 'انتهى التنفيذ — الاستئناف غير متاح',
        detail: 'لم يسمح الخادم باستئناف هذا التنفيذ. راجع أدلته قبل بدء تنفيذ منفصل.',
        action: null, actionLabel: null, nextStep: 'مراجعة الأدلة أو بدء تنفيذ جديد',
      };
    default:
      return {
        title: 'جارٍ التحقق من نتيجة التنفيذ',
        detail: 'هذه الحالة لا تمنح إذن استرداد. راجع سجل الخادم.',
        action: null, actionLabel: null, nextStep: 'مراجعة حالة الخادم',
      };
  }
}