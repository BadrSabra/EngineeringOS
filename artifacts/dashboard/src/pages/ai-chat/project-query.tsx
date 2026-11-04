import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AiFallbackDiagnostic } from '@workspace/api-client-react';
import type { AcceptanceNextActionCode, ChatMessage } from './types';

export function getTurnIntentLabel(
  message: Pick<ChatMessage, 'role' | 'turnIntent' | 'operationMode'>,
): string | undefined {
  if (message.role === 'user') return undefined;

  switch (message.turnIntent ?? message.operationMode) {
    case 'CHAT':
      return 'Chat';
    case 'PROJECT_QUERY':
      return 'Project query';
    case 'FORENSIC_AUDIT':
      return 'Forensic audit';
    case 'DELIVERY':
      return 'Delivery';
    default:
      return undefined;
  }
}

const projectQueryTargetCopy: Record<
  NonNullable<ChatMessage['projectQueryTarget']>['mode'],
  { title: string; detail: string; className: string }
> = {
  resolved_target: {
    title: 'حُدد الجزء المقصود من المشروع',
    detail: 'جُمعت المصادر من الجزء المحدد، وهذا وحده لا يثبت صحة الإجابة.',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  },
  bounded_unresolved_hint: {
    title: 'نطاق مرجّح ومحدود',
    detail: 'الجزء المقصود غير واضح؛ اقتصر جمع المصادر على إشارات قليلة مرجّحة.',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  },
  source_first_discovery: {
    title: 'بدء البحث من مصادر المشروع',
    detail: 'تعذّر تحديد الجزء المقصود بأمان؛ بدأ جمع المصادر دون توسيع البحث إلى ملفات مرشحة من خريطة الترابط.',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  },
};

export function ProjectQueryTargetCard({ decision }: { decision: NonNullable<ChatMessage['projectQueryTarget']> }) {
  const copy = projectQueryTargetCopy[decision.mode];
  if (!copy) return null;
  return (
    <div dir="rtl" lang="ar" className={`mt-2 rounded-lg border px-3 py-2 text-[11px] ${copy.className}`}>
      <div className="font-medium">{copy.title}</div>
      <div className="mt-0.5 opacity-85">{copy.detail}</div>
    </div>
  );
}

export function acceptanceFollowUpLabel(code: AcceptanceNextActionCode | undefined): string | undefined {
  switch (code) {
    case 'NONE':
      return 'لا يوجد إجراء إضافي مسجل.';
    case 'RESUME_ALLOWED':
      return 'استأنف التنفيذ من نقطة الحفظ المسجلة.';
    case 'START_NEW_PROBE':
      return 'ابدأ فحصًا جديدًا ضمن النطاق المحدد.';
    case 'REVIEW_INCOMPLETE_EVIDENCE':
      return 'راجع الأدلة غير المكتملة قبل الاعتماد على النتيجة.';
    case 'ABANDON_EXECUTION':
      return 'ابدأ تشغيلًا جديدًا ضمن النطاق المحدد قبل الاعتماد على النتيجة.';
    case 'RETRY_AFTER_PARSE':
      return 'أعد المحاولة بعد تصحيح صيغة رد النموذج.';
    case 'RETRY_AFTER_TIMEOUT':
      return 'أعد المحاولة بعد انتهاء مهلة الانتظار.';
    case 'RETRY_AFTER_RATE_LIMIT':
      return 'انتظر انتهاء مهلة الحدّ ثم أعد المحاولة.';
    default:
      return undefined;
  }
}

export function ProjectQueryResponseCard({
  source,
  fallbackReason,
  acceptanceDisposition,
  messageId,
  executionId,
  projectId,
  sessionId,
  diagnostic,
  diagnosticPending,
  diagnosticError,
  onExplainFallback,
}: {
  source?: ChatMessage['projectQueryResponseSource'];
  fallbackReason?: ChatMessage['projectQueryResponseFallbackReason'];
  acceptanceDisposition?: ChatMessage['acceptanceDisposition'];
  messageId: string;
  executionId?: string | null;
  projectId?: string | null;
  sessionId?: string;
  diagnostic?: AiFallbackDiagnostic;
  diagnosticPending?: boolean;
  diagnosticError?: boolean;
  onExplainFallback?: () => void;
}) {
  const isFallback = source === 'deterministic_fallback';
  const canExplainFallback = Boolean(
    isFallback
    && messageId
    && executionId
    && projectId
    && sessionId
    && onExplainFallback,
  );
  const hasIncompleteAcceptance = Boolean(acceptanceDisposition);
  if (!source && !hasIncompleteAcceptance) return null;
  const followUpLabel = acceptanceFollowUpLabel(acceptanceDisposition?.nextActionCode);
  const sourceLabel = source === 'provider_synthesis'
    ? 'صياغة من النموذج'
    : source === 'deterministic_fallback'
      ? 'إجابة بديلة مبنية على الأدلة'
      : 'تعذّر قبول الإجابة';
  const reasonLabel = fallbackReason === 'synthesis_failed'
    ? 'تعذّرت صياغة الإجابة من النموذج'
    : fallbackReason === 'provider_candidate_incomplete'
      ? 'ردّ النموذج لم يستوفِ شروط الإجابة'
      : isFallback
        ? 'غير محدد'
        : hasIncompleteAcceptance
          ? 'لم تُقبل الأدلة المطلوبة للهدف'
          : null;
  const className = isFallback || hasIncompleteAcceptance
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  return (
    <div dir="rtl" lang="ar" className={`mt-2 w-full rounded-lg border px-3 py-2 text-[11px] ${className}`} aria-label="مصدر إجابة استعلام المشروع">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{sourceLabel}</span>
        {reasonLabel && (
          <span className="text-current/75">
            <span className="font-medium">{isFallback ? 'سبب الإجابة البديلة:' : 'سبب عدم القبول:'}</span> {reasonLabel}
          </span>
        )}
      </div>
      {hasIncompleteAcceptance && (
        <div className="mt-1 text-current/75">
          لم تكتمل الأدلة المطلوبة؛ لا تعتمد على هذه النتيجة حتى تُراجع الأدلة وتُقبل.
        </div>
      )}
      {followUpLabel && (
        <div className="mt-1 text-current/75">
          <span className="font-medium">المتابعة المسجلة:</span> {followUpLabel}
        </div>
      )}
      {canExplainFallback && onExplainFallback && (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onExplainFallback}
            disabled={diagnosticPending}
            data-testid={`button-explain-fallback-${messageId}`}
          >
            {diagnosticPending
              ? <Loader2 className="me-1 h-3 w-3 animate-spin" />
              : <Search className="me-1 h-3 w-3" />}
            {diagnosticPending ? 'جارٍ التحقق من هذا التشغيل…' : 'اشرح سبب الإجابة البديلة'}
          </Button>
        </div>
      )}
      {diagnostic && diagnostic.messageId === messageId && diagnostic.executionId === executionId && (
        <div
          className="mt-2 rounded-md border border-amber-300/20 bg-background/30 p-2 text-current/90"
          role="status"
          aria-label="تفسير موثّق للإجابة البديلة"
          data-testid={`fallback-explanation-${messageId}`}
        >
          <div className="font-medium">سبب استخدام الإجابة البديلة</div>
          <p className="mt-1">
            {diagnostic.fallbackReason === 'provider_candidate_incomplete'
              ? 'لم يستوفِ الرد الذي أنشأه النموذج شروط الإجابة، لذا عُرضت الإجابة البديلة المبنية على الأدلة.'
              : 'تعذّرت صياغة رد مقبول من النموذج، لذا عُرضت الإجابة البديلة المبنية على الأدلة.'}
          </p>
          {diagnostic.acceptanceOutcome === 'SUCCEEDED'
            && diagnostic.evidenceRequired
            && diagnostic.evidenceComplete && (
              <p className="mt-1">
                هذا يشرح سبب اختيار طريقة الصياغة، لا نقص الأدلة: قُبل التشغيل المشار إليه واكتملت أدلته المطلوبة.
              </p>
            )}
          <div className="mt-1 text-[10px] opacity-75">
            <span>تم التحقق من التشخيص مقابل المحاولة </span>
            <bdi dir="ltr">{diagnostic.attempt}</bdi>.
          </div>
        </div>
      )}
      {diagnosticError && (
        <p className="mt-2 text-[11px] text-amber-100/80" role="alert">
          تعذّر التحقق من تشخيص هذا التشغيل. أعد المحاولة من هذه الرسالة.
        </p>
      )}
    </div>
  );
}

export function isFallbackDiagnosticQuestion(value: string): boolean {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (!normalized || normalized.length > 300) return false;
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 2) {
    return /^(?:evidence-based fallback|اجابة بديلة مبنية على الادلة)$/i.test(lines[0] ?? '')
      && /^(?:fallback reason:\s*(?:provider candidate was incomplete|synthesis failed)|سبب الاجابة البديلة:\s*(?:رد النموذج لم يستوف شروط الاجابة|تعذرت صياغة الاجابة من النموذج))[.!?؟]*$/i
        .test(lines[1] ?? '');
  }
  if (lines.length !== 1) return false;
  return /^(?:explain(?: this)? fallback|why did (?:the )?fallback happen|what does fallback mean|fallback reason|اشرح (?:سبب )?(?:الـ?\s*)?(?:fallback|التراجع|الاجابة البديلة)|ما سبب (?:الـ?\s*)?(?:fallback|التراجع|الاجابة البديلة)|سبب (?:الـ?\s*)?(?:fallback|التراجع|الاجابة البديلة))[.!?؟]*$/i
    .test(lines[0] ?? '');
}
