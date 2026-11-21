import { useState } from 'react';
import { useUser } from '@clerk/react';
import { Sparkles } from 'lucide-react';
import { useLocation } from 'wouter';
import { storeHomeGoalDraft } from '@/lib/home-goal-handoff';

const ALERT_KIND_LABELS: Record<string, string> = {
  ai_budget_warning: 'اقتراب الاستخدام من الحد اليومي',
  ai_budget_exhausted: 'بلوغ الاستخدام الحد اليومي',
};

const ALERT_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  acknowledged: 'تم تأكيد الاطلاع عليه',
};

export default function ProjectBudgetAlertAssistantHandoff({
  projectId,
  alertId,
  alertKind,
  alertStatus,
}: {
  projectId: string;
  alertId: string;
  alertKind: string;
  alertStatus: string;
}) {
  const { isLoaded, user } = useUser();
  const [, setLocation] = useLocation();
  const [saveError, setSaveError] = useState<string | null>(null);
  const kindLabel = ALERT_KIND_LABELS[alertKind];
  const statusLabel = ALERT_STATUS_LABELS[alertStatus];

  if (!kindLabel || !statusLabel || !projectId || !isLoaded || !user?.id) return null;

  const openAssistant = () => {
    const draft = storeHomeGoalDraft([
      'ساعدني على فهم تنبيه ميزانية الذكاء الاصطناعي في هذا المشروع.',
      `نوع التنبيه المسجل: ${kindLabel}.`,
      `حالة التنبيه المسجلة: ${statusLabel}.`,
      'راجع بيانات الميزانية المتاحة لهذا المشروع، واشرح ما تعنيه وما لا تثبته. إذا لم تتوفر البيانات، وضّح ذلك. لا تغيّر حدود الميزانية ولا تؤكد الاطلاع أو تغلق التنبيه قبل موافقتي.',
    ].join('\n\n'), user.id, projectId);
    if (!draft) {
      setSaveError('تعذر حفظ سياق التنبيه. لم نفتح المساعد حتى لا يضيع النص.');
      return;
    }

    setSaveError(null);
    setLocation(
      `/projects/${encodeURIComponent(projectId)}/workspace?goalDraftId=${encodeURIComponent(draft.id)}#workspace-panel-agent`,
    );
  };

  return (
    <div>
      <button
        type="button"
        onClick={openAssistant}
        aria-label={`اسأل مساعد المشروع عن ${kindLabel}`}
        className="rounded-md border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid={`button-budget-alert-assistant-${alertId}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          افهم هذا التنبيه
        </span>
      </button>
      {saveError && (
        <p className="mt-1 max-w-48 text-xs text-destructive" role="alert">
          {saveError}
        </p>
      )}
    </div>
  );
}
