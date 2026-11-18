import { MonitorPlay, ShieldAlert } from 'lucide-react';

type ProjectCanvasPanelProps = {
  candidateSourceAvailable: boolean;
  hasCandidate: boolean;
  runtimeSourceAvailable: boolean;
  runtimeStatusLabel: string;
};

export default function ProjectCanvasPanel({
  candidateSourceAvailable,
  hasCandidate,
  runtimeSourceAvailable,
  runtimeStatusLabel,
}: ProjectCanvasPanelProps) {
  const candidateContext = !candidateSourceAvailable
    ? 'مصدر المرشح غير متاح الآن؛ لا يمكن تأكيد وجود نسخة مرشحة.'
    : hasCandidate
      ? 'يوجد مرشح مسجل. تسجيل المرشح وحده لا يؤهله للمعاينة التفاعلية.'
      : 'لا يوجد مرشح مسجل في القراءة الحالية.';

  return (
    <section
      id="workspace-panel-canvas"
      className="workspace-panel workspace-card workspace-canvas-panel"
      aria-labelledby="workspace-canvas-heading"
    >
      <div className="workspace-card-heading">
        <div className="workspace-card-icon canvas">
          <MonitorPlay className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="workspace-canvas-heading">معاينة المشروع</h2>
          <p>مساحة العرض المرتبطة بنسخة محددة من المشروع</p>
        </div>
        <span className="workspace-status status-blocked">غير متاحة حالياً</span>
      </div>

      <div className="workspace-canvas-stage" data-testid="workspace-preview-gate">
        <div className="workspace-canvas-lock" aria-hidden="true">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <span className="workspace-canvas-eyebrow">بوابة المعاينة</span>
        <h3>لا توجد معاينة تفاعلية مؤهلة بعد</h3>
        <p>
          لن نفتح جلسة Preview قبل تأهيل بيئة تشغيل معزولة وربطها بالنسخة المرشحة
          نفسها. لا نعرض منفذ Runtime أو تشغيل المشروع العام كمعاينة للمرشح.
        </p>

        <div className="workspace-canvas-context" role="status">
          <div>
            <span>سياق المرشح</span>
            <strong>{candidateContext}</strong>
          </div>
          <div>
            <span>حالة Runtime المسجلة</span>
            <strong>
              {runtimeSourceAvailable
                ? `${runtimeStatusLabel} — ليست إثباتًا على جاهزية Preview`
                : 'غير متاحة؛ لا يمكن تأكيد حالة التشغيل'}
            </strong>
          </div>
        </div>
        <div className="mt-3 flex flex-col items-start gap-2 border-t border-slate-700/60 pt-3">
          <a
            href="#workspace-preview-agents"
            className="workspace-retry"
            aria-label="الانتقال إلى إعداد جهاز Linux للمعاينة"
          >
            الانتقال إلى إعداد جهاز Linux
          </a>
          <p className="text-[11px] leading-5 text-slate-500">
            الاقتران خطوة تجهيز للهوية فقط؛ لا يفتح المعاينة ولا يشغّل النسخة المرشحة.
          </p>
        </div>
      </div>
    </section>
  );
}
