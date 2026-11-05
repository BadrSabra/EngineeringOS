export type SendMessagePreflightReason =
  | 'EMPTY_MESSAGE'
  | 'PROJECT_REQUIRED'
  | 'PROJECT_CONFIRMATION_REQUIRED'
  | 'PROVIDER_CHECKING'
  | 'PROVIDER_UNCONFIGURED'
  | 'PROVIDER_BLOCKED'
  | 'BUSY';

export type SendMessagePreflightNotice = {
  title: string;
  description: string;
  variant: 'default' | 'destructive';
};

const PREFLIGHT_NOTICES: Record<SendMessagePreflightReason, SendMessagePreflightNotice | null> = {
  EMPTY_MESSAGE: null,
  PROJECT_REQUIRED: {
    title: 'اختر مشروعًا للمحادثة',
    description: 'حدد المشروع المقصود قبل إرسال الرسالة.',
    variant: 'destructive',
  },
  PROJECT_CONFIRMATION_REQUIRED: {
    title: 'حدد مشروع هذا الهدف',
    description: 'أكد المشروع المقصود قبل إرسال المسودة. هذا التأكيد لا يوافق على تعديل المشروع.',
    variant: 'default',
  },
  PROVIDER_CHECKING: {
    title: 'جارٍ التحقق من إعداد المساعد',
    description: 'انتظر قليلًا ثم أعد المحاولة صراحةً.',
    variant: 'default',
  },
  PROVIDER_UNCONFIGURED: {
    title: 'المساعد غير مهيّأ للإرسال',
    description: 'راجع إعدادات المزود في بطاقاته. لا تكتب مفتاح الوصول داخل المحادثة.',
    variant: 'destructive',
  },
  PROVIDER_BLOCKED: {
    title: 'الإرسال متوقف بسبب حالة المزود',
    description: 'راجع حالة الإرسال، ثم أعد المحاولة يدويًا بعد انتهائها. لن يحوّل النظام الطلب إلى مزود آخر.',
    variant: 'destructive',
  },
  BUSY: null,
};

export type SendMessagePreflightInput = {
  message: string;
  hasProject: boolean;
  isResume: boolean;
  requiresProjectConfirmation: boolean;
  detectProjectScan: (message: string) => boolean;
  hasActiveProvider: boolean;
  providerConfigured: boolean;
  providerSendBlocked: boolean;
  isSending: boolean;
};

export function getSendMessagePreflightNotice(
  reason: SendMessagePreflightReason | null,
): SendMessagePreflightNotice | null {
  return reason ? PREFLIGHT_NOTICES[reason] : null;
}

/**
 * Purely decide whether a send may proceed. User-visible effects, draft
 * handoff, and stream ownership remain in AiChat.
 */
export function resolveSendMessagePreflight(
  input: SendMessagePreflightInput,
): SendMessagePreflightReason | null {
  if (!input.message.trim()) return 'EMPTY_MESSAGE';
  if (!input.hasProject) return 'PROJECT_REQUIRED';
  if (!input.isResume && input.requiresProjectConfirmation) {
    return 'PROJECT_CONFIRMATION_REQUIRED';
  }

  const isProjectScanRequest = input.detectProjectScan(input.message);
  if (!isProjectScanRequest && !input.hasActiveProvider) return 'PROVIDER_CHECKING';
  if (!isProjectScanRequest && !input.providerConfigured) return 'PROVIDER_UNCONFIGURED';
  if (!isProjectScanRequest && input.providerSendBlocked) return 'PROVIDER_BLOCKED';
  if (input.isSending) return 'BUSY';
  return null;
}
