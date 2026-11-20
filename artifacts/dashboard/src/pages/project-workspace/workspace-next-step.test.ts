import { describe, expect, it } from 'vitest';
import { resolveWorkspaceNextStep } from './workspace-next-step';

const baseInput = {
  projectId: 'project/alpha',
  freshnessPartial: false,
  tasksSource: 'available' as const,
  recentTasks: [],
  candidateSource: 'available' as const,
  candidate: null,
};

describe('resolveWorkspaceNextStep', () => {
  it('starts a new request when current reads are complete and no recent work is returned', () => {
    expect(resolveWorkspaceNextStep(baseInput)).toMatchObject({
      kind: 'link',
      title: 'ابدأ بطلب جديد',
      href: '#workspace-panel-agent',
    });
  });

  it('keeps pending approval first when a failed task is also recorded', () => {
    expect(resolveWorkspaceNextStep({
      ...baseInput,
      recentTasks: [
        { id: 'task-running', title: 'مهمة نشطة', status: 'running' },
        { id: 'task-failed', title: 'مهمة متعثرة', status: 'failed' },
      ],
      candidate: { status: 'pending', approvalRequired: true },
    })).toMatchObject({
      kind: 'link',
      title: 'راجع ملخص النسخة المقترحة',
      actionLabel: 'عرض تفاصيل النسخة',
      href: '#workspace-candidate-summary',
    });
  });

  it('surfaces a recorded failed task before active or newer work without restarting it', () => {
    expect(resolveWorkspaceNextStep({
      ...baseInput,
      recentTasks: [
        { id: 'task-running', title: 'مهمة جارية', status: 'running' },
        { id: 'task-failed', title: 'إصلاح التحميل', status: 'failed' },
        { id: 'task-completed', title: 'مهمة أحدث', status: 'completed' },
      ],
    })).toMatchObject({
      kind: 'link',
      title: 'راجع المهمة المتعثّرة',
      description: expect.stringContaining('لن نعيد تشغيلها تلقائيًا'),
      actionLabel: 'راجع المهمة',
      ariaLabel: 'الخطوة المقترحة: مراجعة المهمة المتعثّرة: إصلاح التحميل',
      href: '/tasks?projectId=project%2Falpha&taskId=task-failed',
    });
  });

  it('prioritizes an active task and keeps its project and task identity in the link', () => {
    expect(resolveWorkspaceNextStep({
      ...baseInput,
      recentTasks: [{ id: 'task/active', title: 'مهمة جارية', status: 'running' }],
    })).toMatchObject({
      kind: 'link',
      title: 'تابع المهمة الحالية',
      href: '/tasks?projectId=project%2Falpha&taskId=task%2Factive',
      ariaLabel: 'الخطوة المقترحة: فتح تفاصيل المهمة: مهمة جارية',
    });
  });

  it('opens the latest recorded task when no task is active', () => {
    expect(resolveWorkspaceNextStep({
      ...baseInput,
      recentTasks: [{ id: 'task-done', title: 'مهمة سابقة', status: 'completed' }],
    })).toMatchObject({
      kind: 'link',
      title: 'راجع أحدث مهمة',
      href: '/tasks?projectId=project%2Falpha&taskId=task-done',
    });
  });

  it.each([
    { freshnessPartial: true },
    { tasksSource: 'unavailable' as const },
    { candidateSource: 'unavailable' as const },
    { projectId: '' },
  ])('asks for a fresh read rather than inferring from incomplete data', (overrides) => {
    expect(resolveWorkspaceNextStep({
      ...baseInput,
      ...overrides,
      recentTasks: [],
    })).toMatchObject({
      kind: 'refresh',
      title: 'لا يمكن تحديد الخطوة التالية الآن',
      actionLabel: 'إعادة قراءة الحالة',
    });
  });
});
