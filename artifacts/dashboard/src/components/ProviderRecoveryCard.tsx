import { AlertTriangle } from 'lucide-react';

export type ProviderAvailabilityState =
  | 'missing_credentials'
  | 'authentication_failed'
  | 'incompatible_model'
  | 'no_compatible_free_model'
  | 'catalog_stale'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'circuit_open'
  | 'provider_outage'
  | 'degraded'
  | 'healthy'
  | 'unknown'
  | (string & {});

export type ProviderRecoveryDetails = {
  availabilityState?: unknown;
  operatorAction?: unknown;
  correlationId?: unknown;
};

const stateCopy: Record<string, { label: string; action: string }> = {
  missing_credentials: { label: 'بيانات الوصول إلى المزود غير معدّة', action: 'راجع إعدادات مزود مدعوم، ثم أعد المحاولة صراحةً. لا تكتب مفتاح الوصول في المحادثة.' },
  authentication_failed: { label: 'تعذر التحقق من بيانات وصول المزود', action: 'راجع صلاحية بيانات الوصول في إعدادات المزود، ثم أعد المحاولة.' },
  incompatible_model: { label: 'النموذج المحدد غير متاح', action: 'اختر نموذجًا متوافقًا ومتاحًا أو مزودًا آخر، ثم أعد المحاولة.' },
  no_compatible_free_model: { label: 'لا يتوفر نموذج مجاني متوافق', action: 'اختر نموذجًا متوافقًا آخر أو مزودًا آخر، ثم أعد المحاولة.' },
  catalog_stale: { label: 'قائمة نماذج المزود تحتاج إلى تحديث', action: 'أعد المحاولة بعد قليل، أو اختر مزودًا آخر إذا بقيت القائمة غير متاحة.' },
  quota_exhausted: { label: 'انتهت حصة الاستخدام لدى المزود', action: 'راجع حصة الاستخدام في حساب المزود أو اختر مزودًا آخر مهيّأ للإرسال.' },
  rate_limited: { label: 'بلغ المزود حد الاستخدام', action: 'انتظر انتهاء فترة حد الاستخدام، ثم أعد المحاولة صراحةً أو اختر مزودًا آخر.' },
  circuit_open: { label: 'الاتصال بالمزود معلّق مؤقتًا', action: 'انتظر انتهاء فترة التعليق، ثم أعد المحاولة صراحةً أو اختر مزودًا آخر.' },
  provider_outage: { label: 'المزود غير متاح مؤقتًا', action: 'أعد المحاولة بعد قليل، أو اختر مزودًا آخر إذا استمر العطل.' },
  degraded: { label: 'خدمة المزود تعمل بصورة متدهورة', action: 'أعد المحاولة بعد قليل أو اختر مزودًا آخر.' },
  healthy: { label: 'المزود متاح بحسب الحالة المسجلة', action: 'يمكنك إعادة محاولة العملية صراحةً.' },
  unknown: { label: 'جاهزية المزود غير معروفة', action: 'أعد المحاولة بعد قليل أو اختر مزودًا آخر.' },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function ProviderRecoveryCard({
  recovery,
  className = '',
}: {
  recovery: ProviderRecoveryDetails | null | undefined;
  className?: string;
}) {
  if (!recovery || typeof recovery !== 'object') return null;
  const state = text(recovery.availabilityState);
  const operatorAction = text(recovery.operatorAction);
  const correlationId = text(recovery.correlationId);
  if (!state && !operatorAction && !correlationId) return null;

  const copy = stateCopy[state ?? 'unknown'] ?? {
    label: 'حالة المزود غير معروفة',
    action: 'راجع الحالة المسجلة، ثم أعد المحاولة بعد قليل أو اختر مزودًا آخر.',
  };
  const displayState = state;

  return (
    <section
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 ${className}`}
      aria-label="إرشادات استعادة جاهزية المزود"
      dir="rtl"
      lang="ar"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-amber-100">{copy.label}</h4>
          {displayState && (
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-200/70">
              الحالة المسجلة: <bdi dir="ltr">{displayState}</bdi>
            </p>
          )}
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            الخطوة التالية: <bdi dir="auto">{operatorAction ?? copy.action}</bdi>
          </p>
          {correlationId && (
            <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={correlationId}>
              مرجع الدعم: <bdi dir="ltr">{correlationId}</bdi>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}