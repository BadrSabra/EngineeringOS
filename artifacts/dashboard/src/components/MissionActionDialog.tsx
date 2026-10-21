import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle } from 'lucide-react';
import type { EngineeringAgentDecision } from '@/lib/ai-missions';

export type MissionActionConfirmation =
  | {
      type: 'replan';
      missionId: string;
      missionTitle: string;
      expectedDecision: EngineeringAgentDecision;
    }
  | {
      type: 'approve';
      missionId: string;
      missionTitle: string;
      goalId: string;
      goalTitle: string;
      projectId: string;
      executionId: string | null;
      planRevision?: string | null;
      expectedDecision: EngineeringAgentDecision;
    };

type MissionActionDialogProps = {
  action: MissionActionConfirmation | null;
  isPending: boolean;
  isInProgress: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export default function MissionActionDialog({
  action,
  isPending,
  isInProgress,
  error,
  onClose,
  onConfirm,
}: MissionActionDialogProps) {
  const reviewUrl = action?.type === 'approve' && action.executionId
    ? `/mission-control?${new URLSearchParams({
        projectId: action.projectId,
        missionId: action.missionId,
        executionId: action.executionId,
      }).toString()}`
    : null;

  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <AlertDialogContent dir="rtl" lang="ar" data-testid="mission-action-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            {action?.type === 'replan' ? 'إنشاء نسخة جديدة من الخطة؟' : <>الموافقة على «<bdi dir="auto">{action?.goalTitle ?? 'خطوة الهدف'}</bdi>»؟</>}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action?.type === 'replan'
              ? <>سيستخدم الخادم الغاية الحالية للهدف الرئيسي «<bdi dir="auto">{action.missionTitle}</bdi>» لإنشاء نسخة خطة جديدة وبدء تنفيذها. تبقى الخطوات والأدلة السابقة في سجل الهدف.</>
              : action?.executionId
                ? <>ستوافق على المقترح المحفوظ لدى الخادم للخطوة «<bdi dir="auto">{action.goalTitle}</bdi>»، وتستأنف الهدف الرئيسي «<bdi dir="auto">{action.missionTitle}</bdi>». الموافقة تزيل بوابة الانتظار، لكنها لا تطبّق الملفات أو تسلّمها بذاتها.</>
                : <>
                    ستعتمد نسخة الخطة التالية وتبدأ خطوة محدودة لإعداد المرشح. هذه الموافقة لا تعتمد المرشح الناتج ولا تطبّق الملفات أو تسلّمها؛ ستحتاج إلى مراجعة المرشح وموافقة منفصلة قبل التطبيق.
                    {action?.planRevision ? (
                      <span className="mt-2 block text-xs text-slate-300">
                        إصدار الخطة: <bdi dir="ltr" className="break-all font-mono">{action.planRevision}</bdi>
                      </span>
                    ) : null}
                  </>}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {action?.type === 'approve' && reviewUrl ? (
          <a
            href={reviewUrl}
            className="text-sm font-medium text-cyan-200 underline underline-offset-4 hover:text-cyan-100"
            data-testid="link-review-mission-approval"
          >
            راجع التنفيذ المرتبط في صفحة متابعة الأهداف
          </a>
        ) : null}

        {isInProgress ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100"
            data-testid="status-mission-action-in-progress"
          >
            الطلب نفسه قيد التنفيذ بالفعل. نتحقق تلقائيًا من النتيجة، وستظل هذه النافذة مفتوحة حتى يتضح الرد.
          </p>
        ) : null}

        {error ? <p dir="auto" role="alert" className="text-sm text-destructive">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} data-testid="button-cancel-mission-action">
            إلغاء
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !action}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="button-confirm-mission-action"
          >
            {isInProgress
              ? 'جارٍ التحقق من النتيجة…'
              : isPending
                ? 'جارٍ التنفيذ…'
              : action?.type === 'replan'
                 ? 'إنشاء خطة جديدة'
                 : action?.executionId
                   ? 'الموافقة والاستئناف'
                   : 'اعتماد الخطة وبدء التنفيذ'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}