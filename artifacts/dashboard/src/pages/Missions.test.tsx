import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Missions from './Missions';

const {
  createMissionMock,
  fetchMissionsMock,
  fetchMissionProjectionMock,
  useListProjectsMock,
} = vi.hoisted(() => ({
  createMissionMock: vi.fn(),
  fetchMissionsMock: vi.fn(),
  fetchMissionProjectionMock: vi.fn(),
  useListProjectsMock: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  createTask: vi.fn(),
  getListProjectsQueryKey: vi.fn(() => ['projects']),
  useListProjects: useListProjectsMock,
}));

vi.mock('@/lib/ai-missions', () => ({
  MissionRequestError: class MissionRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  createGoal: vi.fn(),
  createMission: createMissionMock,
  fetchMissionProjection: fetchMissionProjectionMock,
  fetchMissions: fetchMissionsMock,
  updateGoal: vi.fn(),
  updateMission: vi.fn(),
}));

const project = { id: 'project-1', name: 'Test Project' };
const mission = {
  id: 'mission-1',
  projectId: project.id,
  userId: 'user-1',
  title: 'Release readiness',
  intent: 'Coordinate a verified release candidate.',
  status: 'draft' as const,
  scope: { kind: 'project', projectId: project.id },
  autonomyPolicy: {},
  budget: {},
  deadline: null,
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
  completedAt: null,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Missions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useListProjectsMock.mockReturnValue({
    data: [project],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  fetchMissionsMock.mockResolvedValue([]);
  fetchMissionProjectionMock.mockResolvedValue({
    mission,
    goals: [],
    counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
  });
  createMissionMock.mockResolvedValue(mission);
});

describe('Missions management', () => {
  it('opens the editor, creates a mission, and renders the returned mission immediately', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('button-create-mission')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('button-create-mission'));
    expect(screen.getByRole('heading', { name: 'Create mission' })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('mission-title'), {
      target: { value: 'Release readiness' },
    });
    fireEvent.change(screen.getByTestId('mission-intent'), {
      target: { value: 'Coordinate a verified release candidate.' },
    });
    fireEvent.click(screen.getByTestId('button-save-editor'));

    await waitFor(() => {
      expect(createMissionMock).toHaveBeenCalledWith({
        projectId: project.id,
        title: mission.title,
        intent: mission.intent,
        autonomyPolicy: undefined,
        budget: undefined,
        deadline: null,
      });
    });
    expect(await screen.findByTestId(`button-mission-${mission.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`text-mission-title-${mission.id}`)).toHaveTextContent(mission.title);
    expect(screen.getByRole('status')).toHaveTextContent('Mission created.');
    expect(fetchMissionsMock).toHaveBeenCalledTimes(1);
  });
});