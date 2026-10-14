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

export type MissionActionConfirmation =
  | {
      type: 'replan';
      missionId: string;
      missionTitle: string;
    }
  | {
      type: 'approve';
      missionId: string;
      missionTitle: string;
      goalId: string;
      goalTitle: string;
      projectId: string;
      executionId: string | null;
    };

type MissionActionDialogProps = {
  action: MissionActionConfirmation | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export default function MissionActionDialog({
  action,
  isPending,
  error,
  onClose,
  onConfirm,
}: MissionActionDialogProps) {
  const reviewUrl = action?.type === 'approve' && action.executionId
    ? `/mission-control?${new URLSearchParams({
        projectId: action.projectId,
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
              : <>ستوافق على المقترح المحفوظ لدى الخادم للخطوة «<bdi dir="auto">{action?.goalTitle ?? 'هذه الخطوة'}</bdi>»، وتستأنف الهدف الرئيسي «<bdi dir="auto">{action?.missionTitle ?? 'الهدف الرئيسي'}</bdi>». الموافقة تزيل بوابة الانتظار، لكنها لا تطبّق الملفات أو تسلّمها بذاتها.</>}
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
            {isPending
              ? 'جارٍ التنفيذ…'
              : action?.type === 'replan'
                 ? 'إنشاء خطة جديدة'
                 : 'الموافقة والاستئناف'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}