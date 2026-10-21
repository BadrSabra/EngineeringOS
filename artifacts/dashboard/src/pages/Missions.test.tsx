import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Missions from './Missions';

const {
  createMissionMock,
  previewMissionPlanMock,
  bindMissionDeliveryMock,
  continueMissionAgentMock,
  executeMissionAgentActionMock,
  fetchMissionsMock,
  fetchMissionProjectionMock,
  updateMissionMock,
  useListProjectsMock,
  approveMissionGoalMutateMock,
  replanMissionMutateMock,
} = vi.hoisted(() => ({
  createMissionMock: vi.fn(),
  previewMissionPlanMock: vi.fn(),
  bindMissionDeliveryMock: vi.fn(),
  continueMissionAgentMock: vi.fn(),
  executeMissionAgentActionMock: vi.fn(),
  fetchMissionsMock: vi.fn(),
  fetchMissionProjectionMock: vi.fn(),
  updateMissionMock: vi.fn(),
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
    code: string | null;

    constructor(status: number, message: string, code: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  createGoal: vi.fn(),
  bindMissionDelivery: bindMissionDeliveryMock,
  continueMissionAgent: continueMissionAgentMock,
  executeMissionAgentAction: executeMissionAgentActionMock,
  createMission: createMissionMock,
  previewMissionPlanFromChat: previewMissionPlanMock,
  fetchMissionProjection: fetchMissionProjectionMock,
  fetchMissions: fetchMissionsMock,
  updateGoal: vi.fn(),
  updateMission: updateMissionMock,
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
    engineeringAgent: {
      schemaVersion: 2,
      state: 'PLANNING',
      nextAction: {
        kind: 'START',
        target: { kind: 'mission', id: mission.id },
        reasonCode: 'mission_draft',
      },
      availableCommands: [],
      intervention: { required: false, kind: 'none', reasonCode: null },
      autonomy: {
        mode: 'assisted',
        allowAutoContinue: false,
        allowAutoApply: false,
        allowAutoCommit: false,
        allowAutoPush: false,
        requireHumanForExternalDelivery: true,
        maxAutoReplans: 0,
      },
      missionId: mission.id,
      sessionId: null,
      goalId: null,
      executionId: null,
    },
    agentControl: null,
    currentPlan: { revision: null, binding: 'legacy_unversioned', goalIds: [] },
    goals: [],
    counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
  });
  createMissionMock.mockResolvedValue(mission);
  updateMissionMock.mockResolvedValue({ ...mission, status: 'active' });
  previewMissionPlanMock.mockImplementation(async ({ message }: { message: string }) => ({
    version: 1,
    objective: message,
    admission: 'project_query',
    admissionReason: 'evidence_or_project_context',
    plan: {
      planHash: 'reviewed-plan-hash',
      steps: [{
        id: 'inspect',
        title: 'Read the requested project files',
        kind: 'inspect',
        dependencies: [],
        files: ['README.md'],
        readOnly: true,
        approvalRequired: false,
      }],
    },
  }));
  approveMissionGoalMutateMock.mockReset();
  replanMissionMutateMock.mockReset();
  executeMissionAgentActionMock.mockReset();
  executeMissionAgentActionMock.mockImplementation(async (missionId: string) => ({
    missionId,
    outcome: 'completed',
    projection: await fetchMissionProjectionMock.getMockImplementation()?.(missionId),
    idempotentReplay: false,
  }));
});

describe('Missions management', () => {
  it('starts a draft only when the current server decision is START', async () => {
    fetchMissionsMock.mockResolvedValue([mission]);
    renderPage();

    fireEvent.click(await screen.findByTestId(`button-start-mission-${mission.id}`));
    await waitFor(() => {
      expect(executeMissionAgentActionMock).toHaveBeenCalledWith(mission.id, {
        idempotencyKey: expect.any(String),
        expectedDecision: {
          kind: 'START',
          target: { kind: 'mission', id: mission.id },
          reasonCode: 'mission_draft',
        },
      });
    });
  });

  it('does not infer START from draft status when the projection says NONE', async () => {
    fetchMissionsMock.mockResolvedValue([mission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission,
      engineeringAgent: {
        schemaVersion: 2,
        state: 'PLANNING',
        nextAction: { kind: 'NONE', target: null, reasonCode: 'mission_not_active' },
        availableCommands: [],
        intervention: { required: false, kind: 'none', reasonCode: null },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: false,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: mission.id,
        sessionId: null,
        goalId: null,
        executionId: null,
      },
      agentControl: null,
      currentPlan: { revision: null, binding: 'legacy_unversioned', goalIds: [] },
      goals: [],
      counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });

    renderPage();
    await screen.findByTestId(`text-mission-title-${mission.id}`);
    expect(screen.queryByTestId(`button-start-mission-${mission.id}`)).not.toBeInTheDocument();
    expect(updateMissionMock).not.toHaveBeenCalled();
  });

  it('sends AUTO_CONTINUE with the exact projected decision and an idempotency key', async () => {
    const activeMission = { ...mission, status: 'active' as const };
    const queuedGoal = {
      id: 'goal-queued-1',
      missionId: mission.id,
      projectId: project.id,
      parentGoalId: null,
      title: 'Continue the approved step',
      description: null,
      status: 'queued' as const,
      priority: 'p1',
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {},
      nextAction: null,
      blockedReason: null,
      nextWakeAt: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
      completedAt: null,
      dependencies: [],
    };
    const expectedDecision = {
      kind: 'AUTO_CONTINUE',
      target: { kind: 'goal', id: queuedGoal.id },
      reasonCode: 'continuation_authorized',
    } as const;
    const projection = {
      mission: activeMission,
      engineeringAgent: {
        schemaVersion: 2,
        state: 'PLANNING',
        nextAction: expectedDecision,
        availableCommands: [],
        intervention: { required: false, kind: 'none', reasonCode: null },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: true,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: mission.id,
        sessionId: null,
        goalId: queuedGoal.id,
        executionId: null,
      },
      agentControl: null,
      currentPlan: { revision: null, binding: 'legacy_unversioned', goalIds: [queuedGoal.id] },
      goals: [{
        goal: queuedGoal,
        currentAttempt: null,
        tasks: [],
        workflows: [],
        executions: [],
        events: [],
      }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 0, events: 0 },
    };
    fetchMissionsMock.mockResolvedValue([activeMission]);
    fetchMissionProjectionMock.mockResolvedValue(projection);
    executeMissionAgentActionMock.mockResolvedValue({
      missionId: mission.id,
      projection,
      outcome: 'accepted',
      run: {
        status: 'scheduled',
        goalId: queuedGoal.id,
        taskId: 'task-queued-1',
        executionId: 'execution-queued-1',
        reason: null,
      },
      idempotentReplay: false,
    });

    renderPage();
    fireEvent.click(await screen.findByTestId(`button-continue-mission-${mission.id}`));
    await waitFor(() => {
      expect(executeMissionAgentActionMock).toHaveBeenCalledWith(mission.id, {
        idempotencyKey: expect.any(String),
        expectedDecision,
        // AUTO_CONTINUE has no client-selected target or scope.
      });
    });
  });

  it('renders the server-owned Mission decision even when stored Mission status differs', async () => {
    fetchMissionsMock.mockResolvedValue([mission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission,
      engineeringAgent: {
        schemaVersion: 2,
        state: 'AWAITING_APPROVAL',
        nextAction: {
          kind: 'APPROVE',
          target: { kind: 'goal', id: 'goal-1' },
          reasonCode: 'approval_pending',
        },
        availableCommands: [],
        intervention: { required: true, kind: 'approval', reasonCode: 'approval_pending' },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: false,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: mission.id,
        sessionId: null,
        goalId: 'goal-1',
        executionId: 'execution-1',
      },
      agentControl: null,
      currentPlan: { revision: null, binding: 'legacy_unversioned', goalIds: [] },
      goals: [],
      counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });

    renderPage();

    expect(await screen.findByTestId(`mission-agent-state-${mission.id}`))
      .toHaveAttribute('data-state', 'AWAITING_APPROVAL');
    expect(screen.getByTestId(`mission-agent-next-action-${mission.id}`))
      .toHaveTextContent('راجع الموافقة المطلوبة');
  });

  it('rejects malformed advanced JSON in Arabic without granting scope or starting work', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('button-create-mission'));
    const dialog = screen.getByRole('dialog', { name: 'ابدأ هدفًا رئيسيًا' });
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(dialog).toHaveClass('max-h-[calc(100dvh-3rem)]', 'flex', 'flex-col', 'overflow-hidden');
    expect(screen.getByTestId('editor-scroll-fields')).toHaveClass('min-h-0', 'overflow-y-auto');
    expect(screen.getByTestId('editor-fixed-actions')).toHaveClass('shrink-0');
    fireEvent.change(screen.getByTestId('mission-title'), { target: { value: 'هدف تجريبي' } });
    fireEvent.change(screen.getByTestId('mission-intent'), { target: { value: 'وصف النتيجة' } });
    fireEvent.click(screen.getByText('إعدادات متقدمة (اختيارية)'));
    fireEvent.change(screen.getByTestId('mission-autonomy-policy'), { target: { value: '{"unfinished":' } });
    expect(screen.getByTestId('mission-autonomy-policy')).toHaveAttribute('dir', 'ltr');
    fireEvent.click(screen.getByTestId('button-preview-mission-plan'));
    expect(await screen.findByTestId('mission-plan-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-save-editor'));
    expect(screen.getByText('حقل «سياسة الاستقلالية» يحتوي على JSON غير صالح.')).toBeInTheDocument();
    expect(createMissionMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-cancel-editor'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createMissionMock).not.toHaveBeenCalled();
  });

  it('opens the editor, creates a mission, and renders the returned mission immediately', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('button-create-mission')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('button-create-mission'));
    expect(screen.getByRole('heading', { name: 'ابدأ هدفًا رئيسيًا' })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('mission-title'), {
      target: { value: 'Release readiness' },
    });
    fireEvent.change(screen.getByTestId('mission-intent'), {
      target: { value: 'Coordinate a verified release candidate.' },
    });
    fireEvent.click(screen.getByTestId('button-preview-mission-plan'));
    expect(await screen.findByTestId('mission-plan-preview')).toHaveTextContent(
      'Read the requested project files',
    );
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
        expectedPlanHash: 'reviewed-plan-hash',
      });
    });
    expect(await screen.findByTestId(`button-mission-${mission.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`text-mission-title-${mission.id}`)).toHaveTextContent(mission.title);
    expect(screen.getByText(/بدأ الهدف الرئيسي\./)).toBeInTheDocument();
    expect(fetchMissionsMock).toHaveBeenCalledTimes(1);
  });

  it('shows successful execution separately from an incomplete proof verdict', async () => {
    const activeMission = { ...mission, status: 'active' as const };
    const goalId = 'goal-incomplete-proof';
    fetchMissionsMock.mockResolvedValue([activeMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: activeMission,
      agentControl: null,
      currentPlan: { revision: 'revision-1', binding: 'active_revision', goalIds: [goalId] },
      goals: [{
        goal: {
          id: goalId,
          missionId: activeMission.id,
          projectId: project.id,
          parentGoalId: null,
          title: 'Inspect the project',
          description: 'Read-only evidence task.',
          status: 'verifying',
          priority: 'p1',
          successCriteria: {},
          evidenceContract: {},
          outcomeContract: {
            acceptance: {
              outcome: 'SUCCEEDED',
              verdict: 'INCOMPLETE',
            },
          },
          nextAction: null,
          blockedReason: null,
          nextWakeAt: null,
          createdAt: '2026-09-22T00:00:00.000Z',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: null,
        },
        currentAttempt: {
          id: 'execution-incomplete-proof',
          status: 'completed',
          attempt: 1,
          operationId: 'operation-incomplete-proof',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: '2026-09-22T00:01:00.000Z',
        },
        tasks: [],
        workflows: [],
        executions: [],
        events: [],
      }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 1, events: 0 },
    });

    renderPage();

    expect(await screen.findByTestId('mission-status-authority')).toHaveTextContent(
      'حالات Mission المعروضة محفوظة في السجل',
    );
    const notice = await screen.findByTestId(`goal-acceptance-notice-${goalId}`);
    expect(notice).toHaveTextContent('اكتمل التنفيذ');
    expect(notice).toHaveTextContent('الإثبات غير مكتمل');
    expect(notice).toHaveTextContent('نجاح التنفيذ وحده لا يثبت النتيجة');
    expect(notice).toHaveTextContent('ليست فحصاً حديثاً');
  });

  it('labels a stored PROVEN Goal acceptance as historical rather than freshly verified', async () => {
    const activeMission = { ...mission, status: 'active' as const };
    const goalId = 'goal-stored-proven';
    fetchMissionsMock.mockResolvedValue([activeMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: activeMission,
      agentControl: null,
      currentPlan: { revision: 'revision-1', binding: 'active_revision', goalIds: [goalId] },
      goals: [{
        goal: {
          id: goalId,
          missionId: activeMission.id,
          projectId: project.id,
          parentGoalId: null,
          title: 'Inspect the project',
          description: 'Read-only evidence task.',
          status: 'completed',
          priority: 'p1',
          successCriteria: {},
          evidenceContract: {},
          outcomeContract: {
            acceptance: {
              outcome: 'SUCCEEDED',
              verdict: 'PROVEN',
            },
          },
          statusProjection: {
            authority: 'STORED_STATUS_ONLY',
            proofFreshness: 'NOT_REVALIDATED',
          },
          nextAction: null,
          blockedReason: null,
          nextWakeAt: null,
          createdAt: '2026-09-22T00:00:00.000Z',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: '2026-09-22T00:01:00.000Z',
        },
        currentAttempt: null,
        tasks: [],
        workflows: [],
        executions: [],
        events: [],
      }],
      counts: { goals: 1, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });

    renderPage();

    const notice = await screen.findByTestId(`goal-acceptance-notice-${goalId}`);
    expect(notice).toHaveTextContent('الإثبات المسجل: PROVEN (غير معاد التحقق)');
    expect(notice).toHaveTextContent('لم يُعَد فحص Canonical Proof الحالي');
    expect(screen.getByTestId(`goal-status-freshness-${goalId}`)).toHaveTextContent(
      'لا يعيد التحقق من Canonical Proof الحالي',
    );
    expect(notice).not.toHaveTextContent('تم إثبات النتيجة');
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
      agentControl: {
        handoff: {
          kind: 'chat',
          sessionId: 'session-accepted-1',
          messageId: 'user-message-1',
          assistantMessageId: 'assistant-message-1',
          planHash: 'mission-plan-hash-1',
          dispatchStatus: 'dispatched',
          confirmedAt: '2026-09-22T00:00:00.000Z',
          dispatchedAt: '2026-09-22T00:00:01.000Z',
        },
      },
      currentPlan: {
        revision: null,
        binding: 'legacy_unversioned',
        goalIds: ['goal-1'],
      },
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
        currentAttempt: {
          id: 'mission-execution-1',
          status: 'completed',
          attempt: 1,
          operationId: 'mission-operation-1',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: '2026-09-22T00:01:00.000Z',
        },
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
    expect(await screen.findByRole('region', { name: 'Agent control' })).toBeInTheDocument();
    expect(screen.getByText('This Mission is the Agent run')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Return to originating conversation/ })).toHaveAttribute(
      'href',
      '/ai?projectId=project-1&sessionId=session-accepted-1&missionId=mission-1&messageId=assistant-message-1',
    );
    expect(screen.getByTestId('link-mission-source-chat')).toHaveAttribute(
      'href',
      '/ai?projectId=project-1&sessionId=session-accepted-1&messageId=assistant-message-1',
    );
    expect(await screen.findByTestId('link-mission-source-execution')).toHaveAttribute(
      'href',
      '/mission-control?projectId=project-1&missionId=mission-1&executionId=mission-execution-1',
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
      agentControl: null,
      currentPlan: {
        revision: null,
        binding: 'legacy_unversioned',
        goalIds: [deliveryGoal.id],
      },
      goals: [{
        goal: deliveryGoal,
        currentAttempt: null,
        tasks: [],
        workflows: [],
        executions: [],
        events: [],
      }],
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
    expect(screen.getByText(/سيبدأ هذا الإجراء دفعه إلى المستودع والفرع المهيأين/u)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('delivery-proposal-id'), {
      target: { value: 'proposal-1' },
    });
    expect(screen.getByRole('button', { name: 'اربط وابدأ التسليم' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-save-editor'));

    await waitFor(() => expect(bindMissionDeliveryMock).toHaveBeenCalledWith(deliveryGoal.id, 'proposal-1'));
    expect(await screen.findByRole('status')).toHaveTextContent('ينتظر بدء التسليم اكتمال الخطوات التابعة.');
  });

  it('confirms a server-owned replan and refreshes mission state after success', async () => {
    const needsReplanMission = { ...mission, status: 'needs_replan' as const };
    fetchMissionsMock.mockResolvedValue([needsReplanMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: needsReplanMission,
      engineeringAgent: {
        schemaVersion: 2,
        state: 'NEEDS_ATTENTION',
        nextAction: {
          kind: 'REPLAN',
          target: { kind: 'mission', id: mission.id },
          reasonCode: 'goal_requires_replan',
        },
        availableCommands: [],
        intervention: { required: true, kind: 'scope', reasonCode: 'goal_requires_replan' },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: false,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: mission.id,
        sessionId: null,
        goalId: null,
        executionId: null,
      },
      agentControl: null,
      currentPlan: { revision: null, binding: 'legacy_unversioned', goalIds: [] },
      goals: [],
      counts: { goals: 0, tasks: 0, workflows: 0, executions: 0, events: 0 },
    });

    renderPage();
    fireEvent.click(await screen.findByTestId(`button-replan-mission-${mission.id}`));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'تبقى الخطوات والأدلة السابقة في سجل الهدف.',
    );
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));

    await waitFor(() => {
      expect(executeMissionAgentActionMock).toHaveBeenCalledWith(mission.id, {
        idempotencyKey: expect.any(String),
        expectedDecision: {
          kind: 'REPLAN',
          target: { kind: 'mission', id: mission.id },
          reasonCode: 'goal_requires_replan',
        },
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'أُنشئت نسخة خطة جديدة',
    );
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledTimes(2));
  });

  it('reviews the linked execution before approving a waiting Goal and resumes through the API gate', async () => {
    const activeMission = { ...mission, status: 'active' as const };
    const waitingGoal = {
      id: 'goal-approval-1',
      missionId: mission.id,
      projectId: project.id,
      parentGoalId: null,
      title: 'Approve the candidate step',
      description: null,
      status: 'waiting_for_approval' as const,
      priority: 'p1',
      successCriteria: {},
      evidenceContract: {},
      outcomeContract: {},
      nextAction: null,
      blockedReason: null,
      nextWakeAt: null,
      createdAt: '2026-09-22T00:00:00.000Z',
      updatedAt: '2026-09-22T00:01:00.000Z',
      completedAt: null,
      dependencies: [],
    };
    fetchMissionsMock.mockResolvedValue([activeMission]);
    fetchMissionProjectionMock.mockResolvedValue({
      mission: activeMission,
      engineeringAgent: {
        schemaVersion: 2,
        state: 'AWAITING_APPROVAL',
        nextAction: {
          kind: 'APPROVE',
          target: { kind: 'goal', id: waitingGoal.id },
          reasonCode: 'approval_pending',
        },
        availableCommands: [],
        intervention: { required: true, kind: 'approval', reasonCode: 'approval_pending' },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: false,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: mission.id,
        sessionId: null,
        goalId: waitingGoal.id,
        executionId: 'execution-approval-1',
      },
      agentControl: null,
      currentPlan: {
        revision: null,
        binding: 'legacy_unversioned',
        goalIds: [waitingGoal.id],
      },
      goals: [{
        goal: waitingGoal,
        currentAttempt: {
          id: 'execution-approval-1',
          status: 'waiting',
          attempt: 1,
          operationId: 'operation-approval-1',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: null,
        },
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
      '/mission-control?projectId=project-1&missionId=mission-1&executionId=execution-approval-1',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'لا تطبّق الملفات أو تسلّمها بذاتها.',
    );
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));

    await waitFor(() => {
      expect(executeMissionAgentActionMock).toHaveBeenCalledWith(activeMission.id, {
        idempotencyKey: expect.any(String),
        expectedDecision: {
          kind: 'APPROVE',
          target: { kind: 'goal', id: waitingGoal.id },
          reasonCode: 'approval_pending',
        },
      });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'سُجّلت الموافقة على الخطوة واستئناف تنفيذ الهدف الرئيسي. تطبيق الملفات وتسليمها إجراءان منفصلان.',
    );
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledTimes(2));
  });

  it('routes proposal-step approval through the action gateway', async () => {
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
      engineeringAgent: {
        schemaVersion: 2,
        state: 'AWAITING_APPROVAL',
        nextAction: {
          kind: 'APPROVE',
          target: { kind: 'goal', id: waitingGoal.id },
          reasonCode: 'approval_pending',
        },
        availableCommands: [],
        intervention: { required: true, kind: 'approval', reasonCode: 'approval_pending' },
        autonomy: {
          mode: 'assisted',
          allowAutoContinue: false,
          allowAutoApply: false,
          allowAutoCommit: false,
          allowAutoPush: false,
          requireHumanForExternalDelivery: true,
          maxAutoReplans: 0,
        },
        missionId: activeMission.id,
        sessionId: null,
        goalId: waitingGoal.id,
        executionId: 'execution-approval-1',
      },
      agentControl: null,
      currentPlan: {
        revision: null,
        binding: 'legacy_unversioned',
        goalIds: [waitingGoal.id],
      },
      goals: [{
        goal: waitingGoal,
        currentAttempt: {
          id: 'execution-approval-1',
          status: 'waiting',
          attempt: 1,
          operationId: 'operation-approval-1',
          updatedAt: '2026-09-22T00:01:00.000Z',
          completedAt: null,
        },
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
      '/mission-control?projectId=project-1&missionId=mission-1&executionId=execution-approval-1',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'لا تطبّق الملفات أو تسلّمها بذاتها.',
    );
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));

    await waitFor(() => {
      expect(executeMissionAgentActionMock).toHaveBeenCalledWith(activeMission.id, {
        idempotencyKey: expect.any(String),
        expectedDecision: {
          kind: 'APPROVE',
          target: { kind: 'goal', id: waitingGoal.id },
          reasonCode: 'approval_pending',
        },
      });
    });

    expect(approveMissionGoalMutateMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'سُجّلت الموافقة على الخطوة واستئناف تنفيذ الهدف الرئيسي. تطبيق الملفات وتسليمها إجراءان منفصلان.',
    );
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledTimes(2));
  });
});
describe('Missions explicit route targets', () => {
  const other = { ...mission, id: 'mission-other', title: 'Other mission' };
  function setup(search: string) {
    window.history.replaceState(null, '', `/missions${search}`);
    useListProjectsMock.mockReturnValue({ data: [{ id: 'project-0', name: 'First' }, project], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    fetchMissionsMock.mockResolvedValue([other, mission]);
    fetchMissionProjectionMock.mockImplementation(() => new Promise(() => {}));
  }

  it('opens the linked project and mission instead of the first ones', async () => {
    setup('?projectId=project-1&missionId=mission-1');
    renderPage();
    await waitFor(() => expect(fetchMissionProjectionMock).toHaveBeenCalledWith('mission-1', expect.anything()));
    expect(fetchMissionsMock).toHaveBeenCalledWith('project-1', expect.anything());
    expect(fetchMissionsMock).not.toHaveBeenCalledWith('project-0', expect.anything());
    expect(screen.queryByTestId('status-mission-target-unavailable')).toBeNull();
  });

  it('fails closed for an unavailable mission', async () => {
    setup('?projectId=project-1&missionId=missing');
    renderPage();
    expect(await screen.findByTestId('status-mission-target-unavailable')).toBeInTheDocument();
    expect(fetchMissionProjectionMock).not.toHaveBeenCalled();
  });

  it('fails closed for an unavailable project', async () => {
    setup('?projectId=not-owned&missionId=mission-1');
    renderPage();
    expect(await screen.findByTestId('status-mission-target-unavailable')).toBeInTheDocument();
    expect(fetchMissionsMock).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/');
  });
});
