import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Missions from './Missions';

const {
  createMissionMock,
  bindMissionDeliveryMock,
  fetchMissionsMock,
  fetchMissionProjectionMock,
  useListProjectsMock,
  approveMissionGoalMutateMock,
  replanMissionMutateMock,
} = vi.hoisted(() => ({
  createMissionMock: vi.fn(),
  bindMissionDeliveryMock: vi.fn(),
  fetchMissionsMock: vi.fn(),
  fetchMissionProjectionMock: vi.fn(),
  useListProjectsMock: vi.fn(),
  approveMissionGoalMutateMock: vi.fn(),
  replanMissionMutateMock: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  createTask: vi.fn(),
  getListProjectsQueryKey: vi.fn(() => ['projects']),
  useApproveAiMissionGoal: () => ({ mutate: approveMissionGoalMutateMock, isPending: false }),
  useListProjects: useListProjectsMock,
  useReplanAiMission: () => ({ mutate: replanMissionMutateMock, isPending: false }),
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
  bindMissionDelivery: bindMissionDeliveryMock,
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
  approveMissionGoalMutateMock.mockReset();
  replanMissionMutateMock.mockReset();
});

describe('Missions management', () => {
  it('opens the editor, creates a mission, and renders the returned mission immediately', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('button-create-mission')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('button-create-mission'));
    expect(screen.getByRole('heading', { name: 'Start a mission' })).toBeInTheDocument();

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
        status: 'active',
        autonomyPolicy: undefined,
        budget: undefined,
        deadline: null,
      });
    });
    expect(await screen.findByTestId(`button-mission-${mission.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`text-mission-title-${mission.id}`)).toHaveTextContent(mission.title);
    expect(screen.getByRole('status')).toHaveTextContent('Mission started.');
    expect(fetchMissionsMock).toHaveBeenCalledTimes(1);
  });

  it('shows accepted finding provenance with links to its Chat message and Mission execution', async () => {
    const acceptedMission = {
      ...mission,
      status: 'active' as const,
      autonomyPolicy: {
        handoffSource: {
          kind: 'chat',
          sourceType: 'accepted_project_query',
          sessionId: 'session-accepted-1',
          messageId: 'user-message-1',
          assistantMessageId: 'assistant-message-1',
          executionId: 'source-execution-1',
          acceptanceId: 'acceptance-1',
          evidenceSnapshotId: 'evidence-snapshot-1',
          sourceRevision: 'revision-accepted-1',
          acceptedClaimRefs: ['claim-1', 'claim-2'],
          planHash: 'mission-plan-hash-1',
        },
      },
    };
    fetchMissionsMock.mockResolvedValue([acceptedMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: acceptedMission,
      goals: [{
        goal: {
          id: 'goal-1',
          missionId: acceptedMission.id,
          projectId: project.id,
          parentGoalId: null,
          title: 'Verify accepted finding',
          description: null,
          status: 'completed',
          priority: 'p1',
          successCriteria: {},
          evidenceContract: {},
          outcomeContract: {},
          nextAction: null,
          blockedReason: null,
          nextWakeAt: null,
          createdAt: '2026-09-22T00:00:00.000Z',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: '2026-09-22T00:01:00.000Z',
        },
        tasks: [],
        workflows: [],
        executions: [{
          id: 'mission-execution-1',
          status: 'completed',
          attempt: 1,
          operationId: 'mission-operation-1',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: '2026-09-22T00:01:00.000Z',
        }],
        events: [],
      }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 1, events: 0 },
    });

    renderPage();

    expect(await screen.findByTestId(`mission-source-provenance-${mission.id}`)).toBeInTheDocument();
    expect(screen.getByText('session-accepted-1')).toBeInTheDocument();
    expect(screen.getByText('user-message-1')).toBeInTheDocument();
    expect(screen.getByText('assistant-message-1')).toBeInTheDocument();
    expect(screen.getByText('source-execution-1')).toBeInTheDocument();
    expect(screen.getByText('acceptance-1')).toBeInTheDocument();
    expect(screen.getByText('evidence-snapshot-1')).toBeInTheDocument();
    expect(screen.getByText('claim-1, claim-2')).toBeInTheDocument();
    expect(screen.getByText('mission-plan-hash-1')).toBeInTheDocument();
    expect(screen.getByTestId('link-mission-source-chat')).toHaveAttribute(
      'href',
      '/ai?projectId=project-1&sessionId=session-accepted-1&messageId=assistant-message-1',
    );
    expect(await screen.findByTestId('link-mission-source-execution')).toHaveAttribute(
      'href',
      '/mission-control?projectId=project-1&executionId=mission-execution-1',
    );
  });

  it('binds a committed proposal from the delivery goal action', async () => {
    const deliveryGoal = {
      id: 'goal-delivery-1',
      missionId: mission.id,
      projectId: project.id,
      parentGoalId: null,
      title: 'Push verified result',
      description: null,
      status: 'queued' as const,
      priority: 'p1',
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {},
      nextAction: {
        kind: 'recipe',
        recipeId: 'delivery.push.github',
        recipeVersion: 1,
        approvedPaths: [],
        candidateIdentity: null,
      },
      blockedReason: null,
      nextWakeAt: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
      dependencies: [],
    };
    fetchMissionProjectionMock.mockResolvedValue({
      mission: { ...mission, status: 'active' },
      goals: [{ goal: deliveryGoal, tasks: [], workflows: [], executions: [], events: [] }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });
    fetchMissionsMock.mockResolvedValue([{ ...mission, status: 'active' }]);
    bindMissionDeliveryMock.mockResolvedValue({
      goal: { ...deliveryGoal, status: 'waiting_for_event' },
      proposalId: 'proposal-1',
      operationId: 'operation-1',
      run: { status: 'waiting', goalId: deliveryGoal.id, reason: 'dependencies_pending' },
    });

    renderPage();
    expect(await screen.findByTestId(`button-bind-delivery-${deliveryGoal.id}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`button-bind-delivery-${deliveryGoal.id}`));
    fireEvent.change(screen.getByTestId('delivery-proposal-id'), {
      target: { value: 'proposal-1' },
    });
    fireEvent.click(screen.getByTestId('button-save-editor'));

    await waitFor(() => expect(bindMissionDeliveryMock).toHaveBeenCalledWith(deliveryGoal.id, 'proposal-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('Delivery proposal bound.');
  });

  it('confirms a server-owned replan and refreshes mission state after success', async () => {
    const needsReplanMission = { ...mission, status: 'needs_replan' as const };
    fetchMissionsMock.mockResolvedValue([needsReplanMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: needsReplanMission,
      goals: [],
      counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });

    renderPage();
    fireEvent.click(await screen.findByTestId(`button-replan-mission-${mission.id}`));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Previous Goals and evidence remain in the Mission history.',
    );
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));

    await waitFor(() => {
      expect(replanMissionMutateMock).toHaveBeenCalledWith(
        { missionId: mission.id },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = replanMissionMutateMock.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    callbacks.onSuccess();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A new plan revision was created.',
    );
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledTimes(2));
  });

  it('reviews the linked execution before approving a waiting Goal and resumes through the API gate', async () => {
    const activeMission = { ...mission, status: 'active' as const };
    const waitingGoal = {
      id: 'goal-approval-1',
      missionId: activeMission.id,
      projectId: project.id,
      parentGoalId: null,
      title: 'Apply the proposed fix',
      description: null,
      status: 'waiting_for_approval' as const,
      priority: 'p1',
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {},
      nextAction: { proposalId: 'server-owned-proposal-1' },
      blockedReason: null,
      nextWakeAt: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:01:00.000Z',
      completedAt: null,
    };
    fetchMissionsMock.mockResolvedValue([activeMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: activeMission,
      goals: [{
        goal: waitingGoal,
        tasks: [],
        workflows: [],
        executions: [{
          id: 'execution-approval-1',
          status: 'waiting',
          attempt: 1,
          operationId: 'operation-approval-1',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: null,
        }],
        events: [],
      }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 1, events: 0 },
    });

    renderPage();
    fireEvent.click(await screen.findByTestId(`button-review-approval-${waitingGoal.id}`));

    expect(screen.getByTestId('link-review-mission-approval')).toHaveAttribute(
      'href',
      '/mission-control?projectId=project-1&executionId=execution-approval-1',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'it does not apply or deliver files by itself.',
    );
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));

    await waitFor(() => {
      expect(approveMissionGoalMutateMock).toHaveBeenCalledWith(
        { missionId: activeMission.id, goalId: waitingGoal.id },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = approveMissionGoalMutateMock.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    callbacks.onSuccess();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The Goal was approved and Mission execution resumed.',
    );
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledTimes(2));
  });
});