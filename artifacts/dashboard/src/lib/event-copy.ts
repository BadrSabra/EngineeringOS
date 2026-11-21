const EVENT_TYPE_LABELS: Record<string, string> = {
  ScanCompleted: 'اكتمل فحص المشروع',
  ProjectCreated: 'أُضيف المشروع',
  ProjectUpdated: 'تحدّثت بيانات المشروع',
  ProjectDeleted: 'حُذف المشروع',
  ProjectImported: 'استُورد المشروع',
  ProjectScanQueued: 'طُلب فحص المشروع',
  ProjectScanFailed: 'تعذّر فحص المشروع',
  TaskCreated: 'أُضيفت خطوة عمل',
  TaskDeleted: 'حُذفت خطوة العمل',
  TaskExecutionStarted: 'بدأ تنفيذ الخطوة',
  TaskExecutionFailed: 'تعثر تنفيذ الخطوة',
  TaskFailed: 'تعثر تنفيذ الخطوة',
  TaskRetried: 'أُعيدت محاولة التنفيذ',
  TaskRolledBack: 'تم التراجع عن التنفيذ',
  GitCommitCreated: 'سُجلت تغييرات المشروع',
  GitPushed: 'رُفعت تغييرات المشروع',
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}
