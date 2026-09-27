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
      <AlertDialogContent data-testid="mission-action-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            {action?.type === 'replan' ? 'Create a new plan revision?' : `Approve “${action?.goalTitle ?? 'Goal'}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action?.type === 'replan'
              ? `This uses the current intent for “${action.missionTitle}” to create and start a new server-owned plan revision. Previous Goals and evidence remain in the Mission history.`
              : `This approves the server-held proposal for “${action?.goalTitle ?? 'this Goal'}” and resumes “${action?.missionTitle ?? 'the Mission'}”. Approval clears the gate; it does not apply or deliver files by itself.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {action?.type === 'approve' && reviewUrl ? (
          <a
            href={reviewUrl}
            className="text-sm font-medium text-cyan-200 underline underline-offset-4 hover:text-cyan-100"
            data-testid="link-review-mission-approval"
          >
            Review the linked execution in Mission Control
          </a>
        ) : null}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} data-testid="button-cancel-mission-action">
            Cancel
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
              ? 'Working…'
              : action?.type === 'replan'
                ? 'Create new plan'
                : 'Approve and resume'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}