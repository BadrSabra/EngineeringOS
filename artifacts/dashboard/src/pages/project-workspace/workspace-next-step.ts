type RecentTask = {
  id: string;
  title: string;
  status: string;
};

type WorkspaceNextStepInput = {
  projectId: string;
  freshnessPartial: boolean;
  tasksSource: 'available' | 'unavailable';
  recentTasks: RecentTask[];
  candidateSource: 'available' | 'unavailable';
  candidate: { status: string; approvalRequired: boolean } | null;
};

export type WorkspaceNextStep =
  | {
      kind: 'refresh';
      title: string;
      description: string;
      actionLabel: string;
      ariaLabel: string;
    }
  | {
      kind: 'link';
      title: string;
      description: string;
      actionLabel: string;
      ariaLabel: string;
      href: string;
    };

const ACTIVE_TASK_STATUSES = new Set([
  'pending',
  'queued',
  'starting',
  'running',
  'verifying',
  'cancelling',
]);

export function resolveWorkspaceNextStep({
  projectId,
  freshnessPartial,
  tasksSource,
  recentTasks,
  candidateSource,
  candidate,
}: WorkspaceNextStepInput): WorkspaceNextStep {
  if (
    !projectId
    || freshnessPartial
    || tasksSource !== 'available'
    || candidateSource !== 'available'
  ) {
    return {
      kind: 'refresh',
      title: 'لا يمكن تحديد الخطوة التالية الآن',
      description: 'بعض معلومات المشروع غير مكتملة. أعد قراءتها قبل الاعتماد على هذه التوصية.',
      actionLabel: 'إعادة قراءة الحالة',
      ariaLabel: 'الخطوة المقترحة: إعادة قراءة حالة المشروع',
    };
  }

  if (candidate?.status === 'pending' && candidate.approvalRequired) {
    return {
      kind: 'link',
      title: 'راجع العمل المقترح',
      description: 'هناك تغييرات مقترحة تنتظر مراجعتك قبل اتخاذ قرار.',
      actionLabel: 'افتح المراجعة',
      ariaLabel: 'الخطوة المقترحة: مراجعة العمل المقترح',
      href: '#workspace-panel-canvas',
    };
  }

  const activeTask = recentTasks.find((task) => ACTIVE_TASK_STATUSES.has(task.status));
  if (activeTask) {
    return {
      kind: 'link',
      title: 'تابع المهمة الحالية',
      description: 'هناك مهمة مسجلة ما زالت نشطة؛ افتح تفاصيلها لمتابعة الحالة.',
      actionLabel: 'افتح المهمة',
      ariaLabel: `الخطوة المقترحة: فتح تفاصيل المهمة: ${activeTask.title}`,
      href: `/tasks?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(activeTask.id)}`,
    };
  }

  const latestTask = recentTasks[0];
  if (latestTask) {
    return {
      kind: 'link',
      title: 'راجع أحدث مهمة',
      description: 'اطّلع على آخر حالة ونتيجة مسجلة للمهمة.',
      actionLabel: 'افتح المهمة',
      ariaLabel: `الخطوة المقترحة: فتح تفاصيل المهمة: ${latestTask.title}`,
      href: `/tasks?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(latestTask.id)}`,
    };
  }

  return {
    kind: 'link',
    title: 'ابدأ بطلب جديد',
    description: 'اكتب النتيجة التي تريدها للمساعد في مساحة الحوار. لن يُرسل النص حتى تختار الإرسال.',
    actionLabel: 'اكتب هدفك',
    ariaLabel: 'الخطوة المقترحة: كتابة طلب جديد في مساحة الحوار',
    href: '#workspace-panel-agent',
  };
}
