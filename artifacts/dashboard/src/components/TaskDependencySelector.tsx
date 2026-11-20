import { useState } from 'react';
import {
  getListTasksQueryKey,
  useListTasks,
  type Task,
} from '@workspace/api-client-react';

const PAGE_SIZE = 200;

type TaskDependencySelectorProps = {
  projectId: string;
  selectedTaskIds: string[];
  onSelectionChange: (taskIds: string[]) => void;
};

const STATUS_LABELS: Partial<Record<Task['status'], string>> = {
  pending: 'بانتظار التنفيذ',
  queued: 'في قائمة الانتظار',
  running: 'قيد التنفيذ',
  verifying: 'قيد التحقق',
  completed: 'اكتملت',
  failed: 'فشل مسجل',
  cancelled: 'أُلغيت',
};

export function TaskDependencySelector({
  projectId,
  selectedTaskIds,
  onSelectionChange,
}: TaskDependencySelectorProps) {
  const [page, setPage] = useState(1);
  const params = { projectId, page, pageSize: PAGE_SIZE };
  const tasksQuery = useListTasks(params, {
    query: {
      queryKey: getListTasksQueryKey(params),
      enabled: Boolean(projectId),
    },
  });
  const projectTasks = (tasksQuery.data ?? [])
    .filter((task) => task.projectId === projectId)
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, 'ar'));

  return (
    <fieldset
      className="rounded-lg border border-border bg-secondary/20 p-3"
      aria-describedby="create-task-dependencies-help"
      data-testid="fieldset-task-dependencies"
    >
      <legend className="px-1 text-xs font-semibold">ترتيب التنفيذ (اختياري)</legend>
      <p id="create-task-dependencies-help" className="mb-3 text-[11px] text-muted-foreground">
        اختر المهام التي يجب إكمالها أولًا. لن يسمح النظام ببدء هذه المهمة قبل اكتمالها.
      </p>

      {!projectId ? (
        <p className="text-xs text-muted-foreground" role="status">اختر مشروعًا لعرض مهامه.</p>
      ) : tasksQuery.isLoading ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="status-dependency-tasks-loading">
          جارٍ تحميل مهام المشروع…
        </p>
      ) : tasksQuery.isError ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive" role="alert" data-testid="status-dependency-tasks-error">
            تعذر تحميل مهام المشروع. يمكنك إنشاء مهمة مستقلة أو إعادة المحاولة.
          </p>
          <button
            type="button"
            onClick={() => { void tasksQuery.refetch(); }}
            disabled={tasksQuery.isFetching}
            data-testid="button-retry-dependency-tasks"
            className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {tasksQuery.isFetching ? 'جارٍ التحديث…' : 'إعادة المحاولة'}
          </button>
        </div>
      ) : projectTasks.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="status-no-dependency-tasks">
          {page > 1 ? 'لا توجد مهام أقدم في هذه الصفحة.' : 'لا توجد مهام أخرى في هذا المشروع بعد.'}
        </p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto" role="group" aria-label="المهام السابقة">
          {projectTasks.map((task) => {
            const checked = selectedTaskIds.includes(task.id);
            return (
              <label
                key={task.id}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary/70"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextTaskIds = event.target.checked
                      ? [...new Set([...selectedTaskIds, task.id])]
                      : selectedTaskIds.filter((selectedId) => selectedId !== task.id);
                    onSelectionChange(nextTaskIds);
                  }}
                  data-testid={`checkbox-task-dependency-${task.id}`}
                  className="mt-0.5 accent-primary"
                />
                <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <bdi dir="auto" className="min-w-0">{task.title}</bdi>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {STATUS_LABELS[task.status] ?? 'حالة غير معروفة'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {!tasksQuery.isLoading && !tasksQuery.isError && projectId && (page > 1 || projectTasks.length === PAGE_SIZE) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          {page > 1 ? (
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={tasksQuery.isFetching}
              data-testid="button-previous-task-dependency-page"
              className="text-[11px] font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            >
              مهام أحدث
            </button>
          ) : <span />}
          <span role="status" data-testid="status-task-dependency-page" className="text-[11px] text-muted-foreground">
            الصفحة {page}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => current + 1)}
            disabled={projectTasks.length < PAGE_SIZE || tasksQuery.isFetching}
            data-testid="button-next-task-dependency-page"
            className="text-[11px] font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            مهام أقدم
          </button>
        </div>
      )}

      {selectedTaskIds.length > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <span role="status" data-testid="status-selected-task-dependencies" className="text-[11px] text-muted-foreground">
            تم اختيار {selectedTaskIds.length} من المتطلبات.
          </span>
          <button
            type="button"
            onClick={() => onSelectionChange([])}
            data-testid="button-clear-task-dependencies"
            className="text-[11px] font-medium text-primary underline-offset-4 hover:underline"
          >
            مسح الاختيار
          </button>
        </div>
      )}
    </fieldset>
  );
}
