import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDetail from './ProjectDetail';
import { useListTasks } from '@workspace/api-client-react';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';

const mocks = vi.hoisted(() => ({
  routeProjectId: 'project-1',
  user: { id: 'user-1' } as { id: string } | null,
  setLocation: vi.fn(),
  project: {
    id: 'project-1',
    name: 'مشروع تجريبي',
    rootPath: '/workspace/example',
    language: 'TypeScript',
    framework: 'React',
    status: 'active',
    createdAt: '2026-10-01T12:00:00.000Z',
    lastScanAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z',
    strategyReplayOptIn: false,
  },
  summary: {
    latestMetrics: null,
    qualityScore: 82,
    taskCounts: { total: 2, running: 1, completed: 1, failed: 0 },
    recentEvents: [] as Array<{
      id: string;
      projectId: string;
      type: string;
      message?: string;
      timestamp: Date | string;
      severity?: string;
      correlationId?: string;
    }>,
  },
  failedTasks: [] as Array<{ id: string; projectId: string; title: string; status: string }>,
  graphSummary: {
    entityCount: 2,
    relationshipCount: 1,
    clusterCount: 1,
    isolatedCount: 0,
    topConnected: [],
  },
  mutate: vi.fn(),
  refetchProject: vi.fn(),
  refetchSummary: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  summaryAvailable: true,
  summaryIsLoading: false,
  summaryIsError: false,
  summaryIsFetching: false,
  summaryUpdatedAt: Date.parse('2026-10-13T12:00:00.000Z'),
  projectIsRefetching: false,
  projectUpdatedAt: Date.parse('2026-10-14T12:00:00.000Z'),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, user: mocks.user }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetProject: (projectId: string) => ({
    data: {
      ...mocks.project,
      id: projectId,
      name: projectId === 'project-2' ? 'مشروع آخر' : 'مشروع تجريبي',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetchProject,
    isRefetching: mocks.projectIsRefetching,
    dataUpdatedAt: mocks.projectUpdatedAt,
  }),
  useGetProjectSummary: () => ({
    data: mocks.summaryAvailable ? mocks.summary : undefined,
    isLoading: mocks.summaryIsLoading,
    isError: mocks.summaryIsError,
    isFetching: mocks.summaryIsFetching,
    dataUpdatedAt: mocks.summaryUpdatedAt,
    refetch: mocks.refetchSummary,
  }),
  useUpdateProject: () => ({ mutate: mocks.mutate, isPending: false }),
  useListTasks: vi.fn(() => ({
    data: mocks.failedTasks,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })),
  useGetGraphSummary: () => ({
    data: mocks.graphSummary,
    isLoading: false,
    isError: false,
  }),
  useScanProject: () => ({ mutate: vi.fn(), isPending: false }),
  getGetProjectQueryKey: (id: string) => ['/api/projects', id],
  getGetProjectSummaryQueryKey: (id: string) => ['/api/projects', id, 'summary'],
  getListTasksQueryKey: (params: unknown) => ['/api/tasks', params],
  getGetGraphSummaryQueryKey: (id: string) => ['/api/graph', id, 'summary'],
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('wouter', () => ({
  useRoute: () => [true, { id: mocks.routeProjectId }],
  useLocation: () => ['/projects/project-1', mocks.setLocation],
  Link: 'a',
}));

vi.mock('@/lib/freshness', () => ({
  useMonotonicData: (data: unknown) => data,
}));

vi.mock('@/components/OperatorResilience', () => ({
  RefreshButton: (props: { isRefreshing: boolean; lastUpdated?: number; onRefresh: () => Promise<void> }) => (
    <button
      type="button"
      data-testid="project-refresh"
      data-last-updated={props.lastUpdated ?? ''}
      disabled={props.isRefreshing}
      onClick={() => void props.onRefresh()}
    >
      refresh
    </button>
  ),
  RequestError: () => null,
}));

vi.mock('@/components/WorkspaceRuntimePanel', () => ({ default: () => null }));
vi.mock('@/components/ProjectAiBudgetPanel', () => ({ default: () => null }));
vi.mock('@/components/ProjectPluginsPanel', () => ({ default: () => null }));
vi.mock('@/components/BrowserValidationProfilesPanel', () => ({ default: () => null }));
vi.mock('@/components/GitPanel', () => ({ default: () => null }));

describe('ProjectDetail Arabic presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.routeProjectId = 'project-1';
    mocks.user = { id: 'user-1' };
    mocks.summaryAvailable = true;
    mocks.summaryIsLoading = false;
    mocks.summaryIsError = false;
    mocks.summaryIsFetching = false;
    mocks.summaryUpdatedAt = Date.parse('2026-10-13T12:00:00.000Z');
    mocks.summary.recentEvents = [];
    mocks.summary.taskCounts.failed = 0;
    mocks.failedTasks = [];
    mocks.projectIsRefetching = false;
    mocks.projectUpdatedAt = Date.parse('2026-10-14T12:00:00.000Z');
  });

  it('renders Arabic project labels while retaining the raw status code in project info', () => {
    const { container } = render(<ProjectDetail />);

    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('نشط')).toBeInTheDocument();
    expect(screen.getByText('اللغة:')).toBeInTheDocument();
    expect(screen.getByText(/آخر فحص:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'معلومات المشروع' }));
    expect(screen.getByText('الحالة')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('opens the knowledge graph with the current project selected', () => {
    render(<ProjectDetail />);

    expect(screen.getByRole('link', { name: 'استكشف خريطة المشروع: مشروع تجريبي' }))
      .toHaveAttribute('href', '/graph?projectId=project-1');
  });

  it('opens the project assistant with a scoped unsent goal draft', () => {
    render(<ProjectDetail />);

    fireEvent.click(screen.getByTestId('button-project-assistant'));

    const draft = readGoalDrafts('user-1').drafts[0];
    expect(draft).toMatchObject({
      source: 'home',
      projectId: 'project-1',
      sendAttemptedAt: null,
    });
    expect(draft.text).toContain('اسألني أولًا عما أريد إنجازه');
    expect(draft.text).toContain('لا تغيّر الملفات أو تبدأ أي عمل');
    expect(mocks.setLocation).toHaveBeenCalledWith(
      `/projects/project-1/workspace?goalDraftId=${draft.id}#workspace-panel-agent`,
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('stays on the project page when the assistant draft cannot be saved', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(storeHomeGoalDraft(`مسودة ${index}`, 'user-1')).not.toBeNull();
    }
    render(<ProjectDetail />);

    fireEvent.click(screen.getByTestId('button-project-assistant'));

    expect(screen.getByTestId('text-project-assistant-error')).toHaveTextContent(
      'تعذر حفظ مسودة طلب المساعدة.',
    );
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(8);
  });

  it('keeps Strategy Replay opt-in off by default, explains its limits, and preserves the mutation value', () => {
    render(<ProjectDetail />);
    fireEvent.click(screen.getByRole('button', { name: 'معلومات المشروع' }));

    const toggle = screen.getByRole('switch', {
      name: 'السماح بتسجيل حالات جديدة لإعادة تشغيل الاستراتيجية',
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/معطّل افتراضيًا/)).toBeInTheDocument();
    expect(screen.getByText(/لا تتضمن الطلبات أو المحادثات أو محتوى الملفات/)).toBeInTheDocument();
    expect(screen.getByText(/ولا يتغير المرشح/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        data: { strategyReplayOptIn: true },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('starts a fresh local session when the project route changes and ignores a late callback from the previous project', () => {
    const { rerender } = render(<ProjectDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'معلومات المشروع' }));
    fireEvent.click(screen.getByRole('switch', {
      name: 'السماح بتسجيل حالات جديدة لإعادة تشغيل الاستراتيجية',
    }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        data: { strategyReplayOptIn: true },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    const previousProjectCallbacks = mocks.mutate.mock.calls[0]![1] as {
      onError: (error: Error) => void;
    };

    mocks.routeProjectId = 'project-2';
    rerender(<ProjectDetail />);

    expect(screen.getByRole('heading', { name: 'مشروع آخر' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', {
      name: 'السماح بتسجيل حالات جديدة لإعادة تشغيل الاستراتيجية',
    })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'معلومات المشروع' }));
    const nextProjectToggle = screen.getByRole('switch', {
      name: 'السماح بتسجيل حالات جديدة لإعادة تشغيل الاستراتيجية',
    });
    expect(nextProjectToggle).not.toBeChecked();

    act(() => previousProjectCallbacks.onError(new Error('Project A update failed.')));

    expect(screen.queryByText('Project A update failed.')).not.toBeInTheDocument();
    expect(nextProjectToggle).not.toBeChecked();
  });

  it('keeps the project page available when the optional summary request fails', () => {
    mocks.summaryAvailable = false;
    mocks.summaryIsError = true;

    render(<ProjectDetail />);

    expect(screen.getByRole('heading', { name: 'مشروع تجريبي' })).toBeInTheDocument();
    expect(screen.getByTestId('link-project-event-log')).toHaveAttribute(
      'href',
      '/events?projectId=project-1',
    );
    expect(screen.getByTestId('project-summary-status')).toHaveTextContent(
      'تظل بيانات المشروع الأساسية متاحة',
    );
    expect(screen.getByTestId('summary-task-counts-unavailable')).toHaveTextContent(
      'لا يمكن استنتاجها من غياب الملخص',
    );
    expect(screen.getByTestId('summary-events-unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'إعادة محاولة الملخص' }));
    expect(mocks.refetchSummary).toHaveBeenCalledTimes(1);
  });

  it('opens the failed-task list for this project directly from a positive failure count', () => {
    mocks.summary.taskCounts.failed = 2;

    render(<ProjectDetail />);

    expect(screen.getByTestId('link-project-failed-tasks')).toHaveAttribute(
      'href',
      '/tasks?projectId=project-1&status=failed',
    );
    expect(screen.getByTestId('link-project-failed-tasks')).toHaveAccessibleName(
      'اعرض 2 مهمة متعثرة في مشروع مشروع تجريبي',
    );
    expect(screen.getByTestId('summary-task-failed')).toHaveTextContent('2');
  });

  it('opens the only failed task directly while keeping review explicit', () => {
    mocks.summary.taskCounts.failed = 1;
    mocks.failedTasks = [{
      id: 'failed-task-1',
      projectId: 'project-1',
      title: 'راجع النتيجة',
      status: 'failed',
    }];

    render(<ProjectDetail />);

    expect(useListTasks).toHaveBeenCalledWith(
      { projectId: 'project-1', status: 'failed', pageSize: 2 },
      expect.objectContaining({
        query: expect.objectContaining({
          enabled: true,
          queryKey: ['/api/tasks', { projectId: 'project-1', status: 'failed', pageSize: 2 }],
        }),
      }),
    );
    expect(screen.getByTestId('link-project-failed-tasks')).toHaveAttribute(
      'href',
      '/tasks?projectId=project-1&taskId=failed-task-1',
    );
    expect(screen.getByTestId('link-project-failed-tasks')).toHaveAccessibleName(
      'راجع تفاصيل المهمة المتعثرة: راجع النتيجة',
    );
  });

  it('keeps the failed-task list fallback when the task read does not match the project', () => {
    mocks.summary.taskCounts.failed = 1;
    mocks.failedTasks = [{
      id: 'failed-task-other-project',
      projectId: 'project-2',
      title: 'مهمة خارج المشروع',
      status: 'failed',
    }];

    render(<ProjectDetail />);

    expect(screen.getByTestId('link-project-failed-tasks')).toHaveAttribute(
      'href',
      '/tasks?projectId=project-1&status=failed',
    );
  });

  it('does not offer an empty failed-task shortcut when the project has no failures', () => {
    render(<ProjectDetail />);

    expect(screen.getByTestId('summary-task-failed')).toHaveTextContent('0');
    expect(screen.queryByTestId('link-project-failed-tasks')).not.toBeInTheDocument();
  });

  it('does not block project details while the optional summary is loading', () => {
    mocks.summaryAvailable = false;
    mocks.summaryIsLoading = true;

    render(<ProjectDetail />);

    expect(screen.getByRole('heading', { name: 'مشروع تجريبي' })).toBeInTheDocument();
    expect(screen.getByTestId('project-summary-status')).toHaveTextContent(
      'جارٍ تحميل ملخص المشروع',
    );
    expect(screen.getByTestId('summary-task-counts-unavailable')).toHaveTextContent(
      'جارٍ تحميل أعداد المهام',
    );
  });

  it('keeps the last available summary visible when its refresh fails', () => {
    mocks.summaryIsError = true;

    render(<ProjectDetail />);

    expect(screen.getByRole('heading', { name: 'مشروع تجريبي' })).toBeInTheDocument();
    expect(screen.getByTestId('project-summary-status')).toHaveTextContent(
      'تُعرض آخر قراءة متاحة',
    );
    expect(screen.getByTestId('summary-task-total')).toHaveTextContent('2');
  });

  it('opens the event log or project assistant directly from a correlated failure', () => {
    mocks.summary.recentEvents = [{
      id: 'event-linked',
      projectId: 'project-1',
      type: 'TaskFailed',
      message: 'تعذّر تنفيذ المهمة',
      timestamp: '2026-10-14T12:30:00.000Z',
      severity: 'error',
      correlationId: 'operation/123',
    }];

    render(<ProjectDetail />);

    expect(screen.getByTestId('link-summary-event-event-linked')).toHaveAttribute(
      'href',
      '/events?projectId=project-1&correlationId=operation%2F123',
    );
    expect(screen.getByRole('link', { name: 'عرض سجل الأحداث للعملية: تعذّر تنفيذ المهمة' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-event-goal-handoff-event-linked'));

    const draft = readGoalDrafts('user-1').drafts[0];
    expect(draft).toMatchObject({ source: 'home', projectId: 'project-1' });
    expect(draft.text).toContain('تعذّر تنفيذ المهمة');
    expect(mocks.setLocation).toHaveBeenCalledWith(
      `/projects/project-1/workspace?goalDraftId=${draft.id}#workspace-panel-agent`,
    );
  });

  it('offers direct assistant help for warnings but not routine events', () => {
    mocks.summary.recentEvents = [
      {
        id: 'event-warning',
        projectId: 'project-1',
        type: 'RuntimeWarning',
        message: 'يحتاج التشغيل إلى مراجعة',
        timestamp: '2026-10-14T12:30:00.000Z',
        severity: 'warning',
        correlationId: 'operation-warning',
      },
      {
        id: 'event-info',
        projectId: 'project-1',
        type: 'ProjectUpdated',
        message: 'تم تحديث المشروع',
        timestamp: '2026-10-14T12:31:00.000Z',
        severity: 'info',
      },
    ];

    render(<ProjectDetail />);

    expect(screen.getByTestId('button-event-goal-handoff-event-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('button-event-goal-handoff-event-info')).not.toBeInTheDocument();
    expect(screen.getByTestId('link-summary-event-event-warning')).toBeInTheDocument();
  });

  it('keeps events without an operation id readable without creating a misleading link', () => {
    mocks.summary.recentEvents = [{
      id: 'event-unlinked',
      projectId: 'project-1',
      type: 'ProjectUpdated',
      message: 'تم تحديث المشروع',
      timestamp: '2026-10-14T12:30:00.000Z',
    }];

    render(<ProjectDetail />);

    expect(screen.getByTestId('text-summary-event-event-unlinked'))
      .toHaveTextContent('تم تحديث المشروع');
    expect(screen.queryByTestId('link-summary-event-event-unlinked')).not.toBeInTheDocument();
  });

  it('keeps the composite refresh busy until both project and summary reads settle and uses the older timestamp', () => {
    mocks.summaryIsFetching = true;
    mocks.summaryUpdatedAt = Date.parse('2026-10-12T12:00:00.000Z');

    render(<ProjectDetail />);

    const refresh = screen.getByTestId('project-refresh');
    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute('data-last-updated', String(mocks.summaryUpdatedAt));
  });

  it('withholds composite freshness when the summary refresh is in an error state', () => {
    mocks.summaryIsError = true;

    render(<ProjectDetail />);

    expect(screen.getByTestId('project-refresh')).toHaveAttribute('data-last-updated', '');
  });

  it('isolates embedded English operational panels from the page RTL direction', () => {
    const { container } = render(<ProjectDetail />);

    expect(container.querySelectorAll('div[dir="ltr"]')).toHaveLength(5);
  });

  it('opens a new task form already scoped to this project', () => {
    render(<ProjectDetail />);

    expect(screen.getByTestId('link-create-project-task')).toHaveAttribute(
      'href',
      '/tasks?projectId=project-1&create=1',
    );
    expect(screen.getByTestId('link-create-project-task')).toHaveAccessibleName(
      'أضف مهمة إلى مشروع مشروع تجريبي',
    );
  });
  it('opens workflow creation already scoped to this project', () => {
    render(<ProjectDetail />);

    expect(screen.getByTestId('link-create-project-workflow')).toHaveAttribute(
      'href',
      '/workflows?projectId=project-1&create=1',
    );
    expect(screen.getByTestId('link-create-project-workflow')).toHaveAccessibleName(
      'إنشاء مسار عمل للمشروع مشروع تجريبي',
    );
  });
});
