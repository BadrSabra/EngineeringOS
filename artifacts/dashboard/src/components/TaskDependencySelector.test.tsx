import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDependencySelector } from './TaskDependencySelector';

vi.mock('@workspace/api-client-react', () => ({
  useListTasks: vi.fn(),
  getListTasksQueryKey: vi.fn((params: unknown) => ['tasks', params]),
}));

import { getListTasksQueryKey, useListTasks } from '@workspace/api-client-react';

function renderSelector({
  projectId = 'project-1',
  selectedTaskIds = [],
  onSelectionChange = vi.fn(),
}: {
  projectId?: string;
  selectedTaskIds?: string[];
  onSelectionChange?: (taskIds: string[]) => void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDependencySelector
        projectId={projectId}
        selectedTaskIds={selectedTaskIds}
        onSelectionChange={onSelectionChange}
      />
    </QueryClientProvider>,
  );
}

const tasksFixture = [
  {
    id: 'task-prerequisite',
    projectId: 'project-1',
    title: 'تهيئة المشروع',
    status: 'completed',
    priority: 'p2',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  },
  {
    id: 'task-foreign',
    projectId: 'project-2',
    title: 'مهمة من مشروع آخر',
    status: 'pending',
    priority: 'p2',
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
  },
] as NonNullable<ReturnType<typeof useListTasks>['data']>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useListTasks).mockReturnValue({
    data: tasksFixture,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useListTasks>);
});

describe('TaskDependencySelector', () => {
  it('offers only tasks from the selected project and reports selected IDs', () => {
    const onSelectionChange = vi.fn();
    renderSelector({ onSelectionChange });

    expect(screen.getByText('تهيئة المشروع')).toBeInTheDocument();
    expect(screen.queryByText('مهمة من مشروع آخر')).not.toBeInTheDocument();
    expect(screen.getByText('اكتملت')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('checkbox-task-dependency-task-prerequisite'));

    expect(onSelectionChange).toHaveBeenCalledWith(['task-prerequisite']);
    expect(getListTasksQueryKey).toHaveBeenCalledWith({
      projectId: 'project-1',
      page: 1,
      pageSize: 200,
    });
  });

  it('shows retry feedback when project tasks cannot be loaded', () => {
    const refetch = vi.fn();
    vi.mocked(useListTasks).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error('list unavailable'),
      refetch,
    } as ReturnType<typeof useListTasks>);
    renderSelector();

    expect(screen.getByTestId('status-dependency-tasks-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-retry-dependency-tasks'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('loads older project tasks in bounded pages', () => {
    const manyTasks = Array.from({ length: 200 }, (_, index) => ({
      ...tasksFixture[0],
      id: `task-${index}`,
      title: `Task ${index}`,
    })) as NonNullable<ReturnType<typeof useListTasks>['data']>;
    vi.mocked(useListTasks).mockReturnValue({
      data: manyTasks,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useListTasks>);
    renderSelector();

    fireEvent.click(screen.getByTestId('button-next-task-dependency-page'));

    expect(useListTasks).toHaveBeenLastCalledWith(
      { projectId: 'project-1', page: 2, pageSize: 200 },
      expect.anything(),
    );
    expect(getListTasksQueryKey).toHaveBeenLastCalledWith({
      projectId: 'project-1',
      page: 2,
      pageSize: 200,
    });
  });

  it('keeps the optional selector clear when a project has no tasks', () => {
    vi.mocked(useListTasks).mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useListTasks>);
    renderSelector();

    expect(screen.getByTestId('status-no-dependency-tasks')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
