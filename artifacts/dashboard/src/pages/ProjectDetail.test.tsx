import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectDetail from './ProjectDetail';

const mocks = vi.hoisted(() => ({
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
    recentEvents: [],
  },
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
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetProject: () => ({
    data: mocks.project,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mocks.refetchProject,
    isRefetching: false,
    dataUpdatedAt: Date.parse(mocks.project.updatedAt),
  }),
  useGetProjectSummary: () => ({
    data: mocks.summary,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchSummary,
  }),
  useUpdateProject: () => ({ mutate: mocks.mutate, isPending: false }),
  useListTasks: vi.fn(),
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
  useRoute: () => [true, { id: 'project-1' }],
  Link: 'a',
}));

vi.mock('@/lib/freshness', () => ({
  useMonotonicData: (data: unknown) => data,
}));

vi.mock('@/components/OperatorResilience', () => ({
  RefreshButton: () => null,
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

  it('isolates embedded English operational panels from the page RTL direction', () => {
    const { container } = render(<ProjectDetail />);

    expect(container.querySelectorAll('div[dir="ltr"]')).toHaveLength(5);
  });
});
