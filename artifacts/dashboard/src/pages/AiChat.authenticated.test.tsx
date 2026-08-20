import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiChat, { BenchmarkMissionControlPanel } from './AiChat';

/** Minimal structural mirror of the AI-008 taskResult union for rendering tests. */
type TaskResultFixture =
  | { kind: 'CODE_EXTRACTION_RESULT'; extractedCode: string; source?: string }
  | { kind: 'BEHAVIOR_ANSWER_RESULT'; answer: Record<string, unknown> }
  | { kind: 'FINDING_RESULT'; finding: Record<string, unknown> }
  | { kind: 'FORENSIC_REPORT_RESULT'; report: string; evidence: Record<string, unknown>[] }
   | { kind: 'WORKSPACE_REVIEW_RESULT'; report: string; evidence: Record<string, unknown>[] }
  | {
      kind: 'REPAIR_RESULT';
      phases: Record<string, unknown>[];
      readiness: 'READY' | 'BLOCKED' | 'NOT_PROVEN';
    }
  | {
      kind: 'IMPLEMENTATION_PLAN_RESULT';
      objective: string;
      summary: string;
      assumptions: string[];
      steps: Record<string, unknown>[];
      validationCommands: string[];
      risks: string[];
      approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
      writeAccess: 'NOT_AUTHORIZED' | 'APPROVED_FOR_BUILD';
    };

const CANCELLED_FORENSIC_REPORT_FIXTURE = [
  '## 1) Executive Verdict',
  'ANALYSIS_INCOMPLETE — cancellation stopped the audit before evidence coverage was complete.',
  '',
  '## 2) Evidence Map',
  'One source read was retained before cancellation.',
  '',
  '## 3) Findings',
  'No verified finding identified from the retained evidence.',
  '',
  '## 4) Repair Plan',
  'No repair phases are authorized for this incomplete audit.',
  '',
  '## 5) Validation Checklist',
  'No executable validation scenario is authorized for this incomplete audit.',
  '',
  '## 6) Final Judgment',
  'ANALYSIS_INCOMPLETE — no verified defect was established because the audit was cancelled during recovery.',
].join('\n');

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    data: undefined,
  });

  return {
    toast: vi.fn(),
    serverProposal: undefined as unknown,
    operationEvents: [] as Array<Record<string, unknown>>,
    projects: [{ id: 'project-1', name: 'demo-service', language: 'TypeScript' }],
    sessions: [{ id: 'session-1', title: 'Existing session', updatedAt: '2026-08-13T00:00:00.000Z' }],
    proposalMessages: [{
      id: 'message-1',
      role: 'assistant',
      content: 'Existing response',
      toolTrace: undefined as string | undefined,
      behaviorEvidence: undefined as string | object | null | undefined,
      taskResult: undefined as TaskResultFixture | undefined,
      createdAt: '2026-08-13T00:00:00.000Z',
    }],
    emptyMessages: [] as unknown[],
    mutations: {
      saveDeepSeek: mutation(),
      applyChanges: mutation(),
      rebaseChanges: mutation(),
      approveRebased: mutation(),
      rejectProposal: mutation(),
      commit: mutation(),
      push: mutation(),
    },
    mutationOptions: {
      saveDeepSeek: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
      applyChanges: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
      rebaseChanges: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
      approveRebased: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
      rejectProposal: undefined as { onSuccess?: () => void; onError?: (error: unknown) => void } | undefined,
      commit: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
      push: undefined as { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void } | undefined,
    },
    fileContent: {
      available: true,
      path: 'src/routes/ai/chat.ts',
      startLine: 1394,
      endLine: 1398,
      fileLines: 500,
      truncated: false,
      lines: [
        { line: 1394, text: '  // real context before the span' },
        { line: 1395, text: '  const ctx = buildContext();' },
        { line: 1396, text: '  const result = await chat(req, res);' },
        { line: 1397, text: '  return result;' },
        { line: 1398, text: '}' },
      ],
    },
    fileContentRequest: undefined as unknown,
    streamIsPending: false,
    activeExecutionStatus: undefined as { status: string } | undefined,
    streamCallbacks: undefined as Record<string, unknown> | undefined,
    sentParams: undefined as {
      projectId: string;
      message: string;
      sessionId?: string;
      executionId?: string;
      resumeToken?: string;
    } | undefined,
    taskStreamCallbacks: undefined as Record<string, unknown> | undefined,
    taskSentParams: undefined as { projectId: string; task: string } | undefined,
  };
});

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@workspace/api-client-react', () => {
  const status = () => ({
    data: { configured: false, last4: null, updatedAt: null },
    isLoading: false,
    isError: false,
    error: null,
  });
  const emptyMutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    data: undefined,
  });

  return {
    useListProjects: vi.fn(() => ({
      data: mocks.projects,
      isLoading: false,
      isError: false,
      error: null,
    })),
    useListEvents: vi.fn(() => ({
      data: mocks.operationEvents,
      isLoading: false,
      isError: false,
      error: null,
    })),
    getListProjectsQueryKey: () => ['projects'],
    classifyProjectError: () => null,
    isRetryableProjectError: () => false,
    emitProjectLoadFailed: vi.fn(),
    useAiChatStream: vi.fn(() => ({
      send: vi.fn((params: unknown, callbacks?: Record<string, unknown>) => {
        mocks.streamCallbacks = callbacks;
        if (params && typeof params === 'object') {
          mocks.sentParams = params as {
            projectId: string;
            message: string;
            sessionId?: string;
            executionId?: string;
            resumeToken?: string;
          };
        }
        return Promise.resolve();
      }),
      cancel: vi.fn(() => {
        mocks.streamIsPending = false;
      }),
      isPending: mocks.streamIsPending,
    })),
    useAiTaskStream: vi.fn(() => ({
      send: vi.fn((params: unknown, callbacks?: Record<string, unknown>) => {
        mocks.taskStreamCallbacks = callbacks;
        if (params && typeof params === 'object') {
          mocks.taskSentParams = params as { projectId: string; task: string };
        }
        return Promise.resolve();
      }),
      cancel: vi.fn(),
      isPending: false,
    })),
    useAiAnalyzeProject: vi.fn(() => emptyMutation()),
    useAiReviewCode: vi.fn(() => emptyMutation()),
    useGetDeepSeekKeyStatus: vi.fn(status),
    useGetGroqKeyStatus: vi.fn(status),
    useGetProviderKeyStatus: vi.fn(status),
    useGetOpenRouterKeyStatus: vi.fn(status),
    useGetActiveProvider: vi.fn(() => ({ data: { provider: null }, isLoading: false, isError: false, error: null })),
    useGetAiMetrics: vi.fn(() => ({ data: { metrics: [], behavioralScorecards: [] }, isLoading: false, isError: false, error: null })),
    useGetAiExecution: vi.fn(() => ({
      data: mocks.activeExecutionStatus,
      isLoading: false,
      isError: false,
      error: null,
    })),
    useListAiChatSessions: vi.fn(() => ({
      data: mocks.sessions,
      isFetched: true,
      isError: false,
      error: null,
    })),
    useListAiChatMessages: vi.fn((sessionId: string) => ({
      data: sessionId && mocks.serverProposal ? mocks.proposalMessages : mocks.emptyMessages,
      isFetched: true,
      isError: false,
      error: null,
    })),
    useGetAiPendingProposal: vi.fn((sessionId: string) => ({
      data: sessionId ? mocks.serverProposal : undefined,
      isFetched: true,
      isError: false,
      error: null,
    })),
    useSaveDeepSeekKey: vi.fn((options: { mutation?: typeof mocks.mutationOptions.saveDeepSeek }) => {
      mocks.mutationOptions.saveDeepSeek = options?.mutation;
      return mocks.mutations.saveDeepSeek;
    }),
    useDeleteDeepSeekKey: vi.fn(() => emptyMutation()),
    useSaveGroqKey: vi.fn(() => emptyMutation()),
    useDeleteGroqKey: vi.fn(() => emptyMutation()),
    useSaveGeminiKey: vi.fn(() => emptyMutation()),
    useDeleteGeminiKey: vi.fn(() => emptyMutation()),
    useSaveOpenRouterKey: vi.fn(() => emptyMutation()),
    useDeleteOpenRouterKey: vi.fn(() => emptyMutation()),
    useAiApplyChanges: vi.fn((options: { mutation?: typeof mocks.mutationOptions.applyChanges }) => {
      mocks.mutationOptions.applyChanges = options?.mutation;
      return mocks.mutations.applyChanges;
    }),
    useAiRebaseChanges: vi.fn((options: { mutation?: typeof mocks.mutationOptions.rebaseChanges }) => {
      mocks.mutationOptions.rebaseChanges = options?.mutation;
      return mocks.mutations.rebaseChanges;
    }),
    useApproveAiRebasedProposal: vi.fn((options: { mutation?: typeof mocks.mutationOptions.approveRebased }) => {
      mocks.mutationOptions.approveRebased = options?.mutation;
      return mocks.mutations.approveRebased;
    }),
    useRejectAiChangeProposal: vi.fn((options: { mutation?: typeof mocks.mutationOptions.rejectProposal }) => {
      mocks.mutationOptions.rejectProposal = options?.mutation;
      return mocks.mutations.rejectProposal;
    }),
    useGitCommit: vi.fn((options: { mutation?: typeof mocks.mutationOptions.commit }) => {
      mocks.mutationOptions.commit = options?.mutation;
      return mocks.mutations.commit;
    }),
    useGitPush: vi.fn((options: { mutation?: typeof mocks.mutationOptions.push }) => {
      mocks.mutationOptions.push = options?.mutation;
      return mocks.mutations.push;
    }),
    useGetAiChatFileContent: vi.fn((params: unknown) => {
      mocks.fileContentRequest = params;
      return {
        data: mocks.fileContent,
        isPending: false,
        isError: false,
        error: null,
      };
    }),
    getGetAiChatFileContentQueryKey: (params?: unknown) => ['ai-file-content', params],
  };
});

function renderAiChat(isDesktop = true) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: isDesktop,
      media: '(min-width: 768px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <AiChat />
    </QueryClientProvider>,
  );
  return { invalidateQueries };
}

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.serverProposal = undefined;
  mocks.projects = [{ id: 'project-1', name: 'demo-service', language: 'TypeScript' }];
  mocks.sessions = [{ id: 'session-1', title: 'Existing session', updatedAt: '2026-08-13T00:00:00.000Z' }];
  mocks.proposalMessages[0].content = 'Existing response';
  mocks.proposalMessages[0].operationMode = undefined;
  mocks.operationEvents = [];
  mocks.proposalMessages[0].toolTrace = undefined;
  mocks.proposalMessages[0].behaviorEvidence = undefined;
  mocks.proposalMessages[0].taskResult = undefined;
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.mutate.mockReset();
    mutation.isPending = false;
    mutation.isError = false;
    mutation.error = null;
    mutation.isSuccess = false;
    mutation.data = undefined;
  }
  mocks.mutationOptions.saveDeepSeek = undefined;
  mocks.mutationOptions.applyChanges = undefined;
  mocks.mutationOptions.rebaseChanges = undefined;
  mocks.mutationOptions.rejectProposal = undefined;
  mocks.mutationOptions.commit = undefined;
  mocks.mutationOptions.push = undefined;
  mocks.streamIsPending = false;
  mocks.activeExecutionStatus = undefined;
  mocks.streamCallbacks = undefined;
  mocks.sentParams = undefined;
  mocks.taskStreamCallbacks = undefined;
  mocks.taskSentParams = undefined;
  localStorage.clear();
});

describe('AiChat authenticated generated mutations', () => {
  it('renders provider-unavailable benchmark evidence without counting it as Grade F', () => {
    render(
      <BenchmarkMissionControlPanel
        data={{
          provider: 'openrouter',
          metrics: {
            observedCases: 2,
            totalCases: 30,
            gradeCounts: { A: 1, F: 0, U: 1 },
            providerUnavailableCount: 1,
          },
          rolloutAllowed: false,
          rolloutBlockers: ['provider unavailable for 1 observed case'],
        }}
      />,
    );

    const missionControl = screen.getByLabelText('Code Agent benchmark mission control');
    expect(missionControl).toHaveTextContent('rollout blocked');
    expect(missionControl).toHaveTextContent('Quality evidence: 1/2');
    expect(missionControl).toHaveTextContent('Provider unavailable');
    expect(missionControl).toHaveTextContent('Grade F');
    expect(missionControl).toHaveTextContent('0');
    expect(missionControl).toHaveTextContent('provider unavailable for 1 observed case');
  });

  it('restores a paused execution after refresh and resumes the same execution', async () => {
    mocks.activeExecutionStatus = { status: 'paused' };
    localStorage.setItem('eos_ai_execution_current_project-1', 'session-1');
    localStorage.setItem('eos_ai_execution_project-1_session-1', JSON.stringify({
      id: 'execution-paused',
      projectId: 'project-1',
      sessionId: 'session-1',
      resumeToken: 'opaque-resume-token',
      message: 'Continue the approved implementation',
    }));

    renderAiChat();

    expect(await screen.findByText('A saved AI execution is ready to resume')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(mocks.sentParams).toEqual(expect.objectContaining({
      projectId: 'project-1',
      sessionId: 'session-1',
      executionId: 'execution-paused',
      resumeToken: 'opaque-resume-token',
      message: 'Continue the approved implementation',
    })));
  });

  it('hydrates persisted chat data and clears stale storage when the server completed offline', async () => {
    mocks.activeExecutionStatus = { status: 'completed' };
    localStorage.setItem('eos_ai_execution_current_project-1', 'session-1');
    localStorage.setItem('eos_ai_execution_project-1_session-1', JSON.stringify({
      id: 'execution-completed',
      projectId: 'project-1',
      sessionId: 'session-1',
      resumeToken: 'opaque-resume-token',
      message: 'Finish the implementation',
    }));

    const { invalidateQueries } = renderAiChat();

    await waitFor(() => {
      expect(localStorage.getItem('eos_ai_execution_project-1_session-1')).toBeNull();
      expect(localStorage.getItem('eos_ai_execution_current_project-1')).toBeNull();
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-messages', 'session-1'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-pending-proposal', 'session-1'] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ai-sessions', 'project-1'] });
    });
    expect(screen.queryByText('A saved AI execution is ready to resume')).not.toBeInTheDocument();
  });

  it('clears execution state for a new session and rejects late callbacks', async () => {
    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const composer = screen.getByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(composer, { target: { value: 'Audit src/app.ts' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    const callbacks = mocks.streamCallbacks as {
      onExecutionStarted?: (event: Record<string, unknown>) => void;
      onDone?: (event: Record<string, unknown>) => void;
    };

    act(() => callbacks.onExecutionStarted?.({
      type: 'execution_started',
      executionId: 'execution-old',
      status: 'running',
      resumable: true,
      resumeToken: 'resume-old',
    }));
    expect(await screen.findByText(/Execution executio…/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(screen.queryByText(/Execution executio…/)).not.toBeInTheDocument();

    act(() => callbacks.onDone?.({
      type: 'done',
      sessionId: 'session-1',
      message: {
        id: 'late-message',
        role: 'assistant',
        content: 'Late stale response',
        sources: '[]',
        createdAt: '2026-08-19T00:00:00.000Z',
      },
      sources: [],
      pendingChanges: [],
      operationMode: 'FORENSIC_AUDIT',
    }));
    expect(screen.queryByText('Late stale response')).not.toBeInTheDocument();
  });

  it('preserves each project execution pointer when switching away and back', async () => {
    mocks.projects = [
      { id: 'project-1', name: 'demo-service', language: 'TypeScript' },
      { id: 'project-2', name: 'worker-service', language: 'TypeScript' },
    ];
    mocks.activeExecutionStatus = { status: 'paused' };
    localStorage.setItem('eos_ai_execution_current_project-1', 'session-1');
    localStorage.setItem('eos_ai_execution_project-1_session-1', JSON.stringify({
      id: 'alpha-execution',
      projectId: 'project-1',
      sessionId: 'session-1',
      resumeToken: 'resume-alpha',
      message: 'Resume project one',
    }));
    localStorage.setItem('eos_ai_execution_current_project-2', 'session-2');
    localStorage.setItem('eos_ai_execution_project-2_session-2', JSON.stringify({
      id: 'beta-execution',
      projectId: 'project-2',
      sessionId: 'session-2',
      resumeToken: 'resume-beta',
      message: 'Resume project two',
    }));

    renderAiChat();
    expect(await screen.findByText(/Execution alpha-ex/)).toBeInTheDocument();

    const projectSelector = screen.getByRole('combobox');
    fireEvent.change(projectSelector, { target: { value: 'project-2' } });
    expect(await screen.findByText(/Execution beta-exe/)).toBeInTheDocument();
    expect(localStorage.getItem('eos_ai_execution_current_project-1')).toBe('session-1');
    expect(localStorage.getItem('eos_ai_execution_current_project-2')).toBe('session-2');

    fireEvent.change(projectSelector, { target: { value: 'project-1' } });
    expect(await screen.findByText(/Execution alpha-ex/)).toBeInTheDocument();
    expect(localStorage.getItem('eos_ai_execution_current_project-1')).toBe('session-1');
    expect(localStorage.getItem('eos_ai_execution_current_project-2')).toBe('session-2');
  });

  it('keeps a previous session execution out of the selected session', async () => {
    mocks.sessions = [
      { id: 'session-1', title: 'Existing session', updatedAt: '2026-08-13T00:00:00.000Z' },
      { id: 'session-2', title: 'Other session', updatedAt: '2026-08-14T00:00:00.000Z' },
    ];
    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const composer = screen.getByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(composer, { target: { value: 'Inspect src/app.ts' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    const callbacks = mocks.streamCallbacks as {
      onExecutionStarted?: (event: Record<string, unknown>) => void;
      onExecutionNodes?: (event: Record<string, unknown>) => void;
    };
    act(() => callbacks.onExecutionStarted?.({
      type: 'execution_started',
      executionId: 'execution-session-1',
      status: 'running',
      resumable: true,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Other session' }));
    act(() => callbacks.onExecutionNodes?.({
      type: 'execution_nodes',
      executionId: 'execution-session-1',
      nodes: [{
        id: 'late-node',
        title: 'Late stale node',
        status: 'running',
        allowedFiles: [],
        dependencies: [],
        validationProfile: 'api-ai-tests',
        attempts: 0,
      }],
    }));

    expect(screen.queryByText('Late stale node')).not.toBeInTheDocument();
    expect(screen.queryByText(/Execution executio…/)).not.toBeInTheDocument();
  });

  it('sends a provider key through the generated mutation and reports success/error', async () => {
    const { invalidateQueries } = renderAiChat();
    const input = await screen.findByPlaceholderText('sk-…');
    fireEvent.change(input, { target: { value: 'sk_test_key_123' } });
    fireEvent.click(input.parentElement?.querySelector('button') as HTMLElement);

    expect(mocks.mutations.saveDeepSeek.mutate).toHaveBeenCalledWith({
      data: { apiKey: 'sk_test_key_123' },
    });

    mocks.mutationOptions.saveDeepSeek?.onSuccess?.({
      configured: true,
      last4: '0123',
      updatedAt: null,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['active-provider'] });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'DeepSeek key saved' }));

    mocks.mutationOptions.saveDeepSeek?.onError?.(new Error('provider rejected key'));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Failed to save key',
      description: 'provider rejected key',
      variant: 'destructive',
    }));
  });

  it('keeps the authenticated mobile chat focused on conversation and protects provider inputs', async () => {
    renderAiChat(false);

    expect(screen.queryByRole('generic', { name: 'Agent execution proof' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('test-model');

    expect(screen.queryByRole('button', { name: 'Open sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Existing session' }).closest('div.absolute')).toHaveClass('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Open sessions' }));
    expect(await screen.findByRole('button', { name: 'Existing session' })).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));
    expect(screen.getByRole('button', { name: 'Existing session' }).closest('div.absolute')).toHaveClass('hidden');
  });

  it('shows persisted forensic session statuses and distinguishes incomplete audits from no findings', async () => {
    mocks.sessions = [
      {
        id: 'cancelled-session',
        title: 'Interrupted audit',
        updatedAt: '2026-08-14T00:00:00.000Z',
        forensicStatus: 'INCOMPLETE',
      },
      {
        id: 'clean-session',
        title: 'Clean audit',
        updatedAt: '2026-08-13T00:00:00.000Z',
        forensicStatus: 'NO_FINDING',
      },
    ];

    renderAiChat();

    const cancelled = await screen.findByRole('button', { name: 'Interrupted audit' });
    const clean = screen.getByRole('button', { name: 'Clean audit' });
    expect(cancelled).toHaveTextContent('Interrupted audit');
    expect(cancelled).toHaveTextContent('Incomplete');
    expect(clean).toHaveTextContent('Clean audit');
    expect(clean).toHaveTextContent('No finding');
    expect(cancelled).not.toHaveTextContent('No finding');
    expect(clean).not.toHaveTextContent('Incomplete');
  });

  it('applies a server-owned proposal with its project and proposal identity', async () => {
    mocks.serverProposal = {
      proposalId: 'proposal-1',
      changes: [{
        path: 'src/app.ts',
        absolutePath: '/project/src/app.ts',
        newContent: 'export const ready = true;',
        originalContent: 'export const ready = false;',
        reason: 'Enable the approved behavior.',
        validationProfile: 'api-ai-tests',
      }],
    };
    const { invalidateQueries } = renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    expect(mocks.mutations.applyChanges.mutate).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        proposalId: 'proposal-1',
        changes: mocks.serverProposal.changes,
      },
    });

    mocks.mutationOptions.applyChanges?.onSuccess?.({
      results: [{
        path: 'src/app.ts',
        ok: true,
        writeStatus: 'written',
        persistenceVerified: true,
        behavioralVerification: { status: 'passed', profile: 'api-ai-tests' },
      }],
      proposalId: 'proposal-1',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['git-status', 'project-1'] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commit verified changes' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Commit verified changes' }));
    expect(mocks.mutations.commit.mutate).toHaveBeenCalledWith({
      projectId: 'project-1',
      data: { message: 'Apply verified AI changes', proposalId: 'proposal-1' },
    });
    mocks.mutationOptions.commit?.onSuccess?.({ ok: true, output: 'created commit' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Commit verified changes' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Push committed changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Push committed changes' }));
    expect(mocks.mutations.push.mutate).toHaveBeenCalledWith({ projectId: 'project-1' });
    mocks.mutationOptions.push?.onSuccess?.({ ok: true, branch: 'main', output: 'pushed' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Push committed changes' })).not.toBeInTheDocument());
  });

  it('renders linked Apply, Commit, and Push evidence and blocks hash mismatches', async () => {
    mocks.serverProposal = {
      proposalId: 'proof-proposal',
      changes: [{
        path: 'src/app.ts',
        absolutePath: '/project/src/app.ts',
        newContent: 'export const ready = true;',
        originalContent: 'export const ready = false;',
        reason: 'Enable the approved behavior.',
        validationProfile: 'api-ai-tests',
      }],
    };
    mocks.operationEvents = [
      {
        id: 'apply-event',
        type: 'AiChangesApplied',
        projectId: 'project-1',
        correlationId: 'operation-proof',
        timestamp: '2026-08-18T10:00:00.000Z',
        payload: {
          proposalId: 'proof-proposal',
          operationId: 'operation-proof',
          applyStatus: 'APPLIED',
          appliedFiles: ['src/app.ts'],
          failedFiles: [],
          rollbackFailures: [],
        },
      },
      {
        id: 'commit-event',
        type: 'GitCommitCreated',
        projectId: 'project-1',
        correlationId: 'operation-proof',
        timestamp: '2026-08-18T10:01:00.000Z',
        payload: {
          proposalId: 'proof-proposal',
          operationId: 'operation-proof',
          commitHash: 'a'.repeat(40),
          committedPaths: ['src/app.ts'],
        },
      },
      {
        id: 'push-event',
        type: 'GitPushed',
        projectId: 'project-1',
        correlationId: 'operation-proof',
        timestamp: '2026-08-18T10:02:00.000Z',
        payload: {
          proposalId: 'proof-proposal',
          operationId: 'operation-proof',
          commitHash: 'b'.repeat(40),
          branch: 'main',
        },
      },
    ];
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    mocks.mutationOptions.applyChanges?.onSuccess?.({
      correlationId: 'operation-proof',
      results: [{
        path: 'src/app.ts',
        ok: true,
        writeStatus: 'written',
        persistenceVerified: true,
        behavioralVerification: { status: 'passed', profile: 'api-ai-tests' },
      }],
    });

    expect(await screen.findByText('Delivery proof')).toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(screen.getByText('commit hash mismatch')).toBeInTheDocument();
    expect(screen.getByText('proposal:')).toBeInTheDocument();
    expect(screen.getByText(/proof-proposal/)).toBeInTheDocument();
  });

  it('offers a safe rebase after an apply conflict and keeps approval required', async () => {
    mocks.serverProposal = {
      proposalId: 'proposal-rebase-1',
      changes: [{
        path: 'src/app.ts',
        absolutePath: '/project/src/app.ts',
        newContent: 'export const ready = true;',
        originalContent: 'export const ready = false;',
        baseHash: 'a'.repeat(64),
        hunks: [{
          startLine: 1,
          endLine: 1,
          expectedText: 'export const ready = false;',
          replacementText: 'export const ready = true;',
          reason: 'Enable the approved behavior.',
        }],
        reason: 'Enable the approved behavior.',
        validationProfile: 'api-ai-tests',
      }],
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    mocks.mutationOptions.applyChanges?.onSuccess?.({
      correlationId: 'operation-rebase-1',
      results: [{
        path: 'src/app.ts',
        ok: false,
        code: 'STALE_BASE',
        error: 'The file changed after the proposal was created.',
        conflict: {
          kind: 'base_hash_mismatch',
          expectedHash: 'a'.repeat(64),
          actualHash: 'b'.repeat(64),
        },
      }],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Rebase patch' }));
    expect(mocks.mutations.rebaseChanges.mutate).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        proposalId: 'proposal-rebase-1',
        changes: mocks.serverProposal.changes,
      },
    });

    const rebasedChange = {
      ...mocks.serverProposal.changes[0],
      originalContent: '// user edit\nexport const ready = false;',
      newContent: '// user edit\nexport const ready = true;',
      baseHash: 'b'.repeat(64),
    };
    mocks.serverProposal = {
      ...mocks.serverProposal,
      changes: [rebasedChange],
      approvalRequired: true,
      revision: 1,
    };
    mocks.mutationOptions.rebaseChanges?.onSuccess?.({
      proposalId: 'proposal-rebase-1',
      changes: [rebasedChange],
      rebasedFiles: ['src/app.ts'],
      approvalRequired: true,
      revision: 1,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve & apply 1 change' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Approve & apply 1 change' }));
    expect(mocks.mutations.approveRebased.mutate).toHaveBeenCalledWith({
      proposalId: 'proposal-rebase-1',
      data: { projectId: 'project-1', revision: 1 },
    });
    mocks.mutationOptions.approveRebased?.onSuccess?.({
      proposalId: 'proposal-rebase-1',
      approvalRequired: false,
      revision: 1,
    });
    expect(mocks.mutations.applyChanges.mutate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        proposalId: 'proposal-rebase-1',
        changes: [rebasedChange],
      }),
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Patch rebased for review',
    }));
    expect(screen.queryByText(/Patch conflict:/)).not.toBeInTheDocument();
  });

  it('rejects the pending proposal through the generated mutation', async () => {
    mocks.serverProposal = {
      proposalId: 'proposal-2',
      changes: [{
        path: 'src/app.ts',
        absolutePath: '/project/src/app.ts',
        newContent: 'export const ready = true;',
        originalContent: null,
        reason: 'Create the approved behavior.',
        validationProfile: 'api-ai-tests',
      }],
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(mocks.mutations.rejectProposal.mutate).toHaveBeenCalledWith({ proposalId: 'proposal-2' });
  });

  it('renders persisted semantic traces with source-span evidence', async () => {
    mocks.serverProposal = { proposalId: 'trace-proposal', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'production_trace',
        productionTrace: {
          status: 'PROVEN',
          nodes: [
            { id: 'route', name: 'POST /api/ai/chat', stage: 'API_ROUTE' },
            { id: 'chat', name: 'chat()', stage: 'ORCHESTRATOR' },
          ],
          edges: [{
            from: 'route',
            to: 'chat',
            relation: 'invokes',
            status: 'PROVEN',
            runtimeObserved: true,
            sourceSpan: { file: 'src/routes/ai/chat.ts', line: 42, column: 8 },
          }],
        },
      },
      {
        kind: 'cross_file_trace',
        crossFileTrace: {
          status: 'NOT_PROVEN',
          maxDepth: 1,
          nodes: [
            { id: 'route', name: 'chat.ts', path: 'src/routes/ai/chat.ts', stage: 'API_ROUTE' },
            { id: 'agent', name: 'chat-agent.ts', path: 'lib/ai-orchestrator/src/agents/chat-agent.ts', stage: 'ORCHESTRATOR' },
          ],
          edges: [{
            from: 'route',
            to: 'agent',
            relation: 'calls',
            status: 'NOT_PROVEN',
            runtimeObserved: false,
            sourceSpan: { file: 'src/routes/ai/chat.ts', line: 91, column: 4, snippet: 'chat(...)' },
          }],
          reason: 'Runtime evidence was not observed for this graph edge.',
        },
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const traceButton = await screen.findByRole('button', { name: /Semantic evidence trace/ });
    expect(traceButton).toHaveTextContent('1/2 proven');

    fireEvent.click(traceButton);
    expect(screen.getByText('Production path')).toBeInTheDocument();
    expect(screen.getByText('Cross-file path 1')).toBeInTheDocument();
    expect(screen.getByText('src/routes/ai/chat.ts:42:8')).toBeInTheDocument();
    expect(screen.getByText('Runtime evidence was not observed for this graph edge.')).toBeInTheDocument();
  });

  it('renders the behavior-evidence panel with exact source line spans', async () => {
    mocks.serverProposal = { proposalId: 'behavior-proposal', changes: [] };
    mocks.proposalMessages[0].behaviorEvidence = JSON.stringify([
      {
        source: 'src/routes/ai/chat.ts',
        excerpt: 'const result = await chat(...)',
        sourceSpan: { startLine: 1396, endLine: 1426 },
        supportsClaim: true,
        evidenceClass: 'BEHAVIOR_PROVEN',
      },
      {
        source: 'src/config/app.ts',
        excerpt: 'const LIMIT = 5',
        supportsClaim: true,
        evidenceClass: 'READ_CONFIRMED',
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const panel = await screen.findByText('Behavior evidence · 2 excerpts');
    expect(panel).toBeInTheDocument();
    // Span-bearing excerpt shows the copyable file:start–end anchor.
    expect(screen.getByText('src/routes/ai/chat.ts:1396–1426')).toBeInTheDocument();
    const excerptText = screen.getByText('const result = await chat(...)');
    expect(excerptText).not.toHaveClass('italic');
    // Span-less fragment is visually marked as unlocated.
    expect(screen.getByText(/const LIMIT = 5/)).toBeInTheDocument();
    expect(screen.getByText('(no span)')).toBeInTheDocument();
  });

  it('renders the EI-012 telemetry reconciliation block with violations', async () => {
    mocks.serverProposal = { proposalId: 'recon-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Forensic audit did not pass the evidence gate.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'evidence_integrity',
        code: 'TELEMETRY_INCONSISTENT',
        consistent: false,
        violations: ['claimed evidence with no backing completed read: src/routes/ai/chat.ts'],
        readAttempts: 12,
        uniqueFilesRead: 8,
        evidenceFileCount: 6,
        acceptedEvidenceCount: 3,
      },
      {
        kind: 'done',
        iterations: 5,
        maxIterations: 6,
        toolCalls: 4,
        prefetchToolCalls: 0,
        loopToolCalls: 4,
        stopReason: 'response',
        synthesisStarted: true,
        diagnosticCodes: ['FORENSIC_STRUCTURED_RECOVERY_REJECTED'],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    // Expand the forensic evidence card to surface reconciliation.
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    expect(await screen.findByText('Telemetry reconciliation')).toBeInTheDocument();
    expect(screen.getByText('TELEMETRY_INCONSISTENT')).toBeInTheDocument();
    expect(screen.getByText('src/routes/ai/chat.ts')).toBeInTheDocument();
    expect(screen.getAllByText('8').length).toBeGreaterThan(0); // uniqueFilesRead + legacy completed-read fallback
  });

  it('uses canonical evidence files when prefetch reads are absent from the persisted trace', async () => {
    mocks.serverProposal = { proposalId: 'canonical-prefetch-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Canonical evidence retained five source bodies.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'evidence_integrity',
        code: 'TELEMETRY_CONSISTENT',
        consistent: true,
        violations: [],
        readAttempts: 6,
        uniqueFilesRead: 5,
        evidenceFileCount: 5,
        acceptedEvidenceCount: 0,
        completedReadFiles: [
          'src/routes/ai/chat.ts',
          'lib/ai-orchestrator/src/agents/chat-agent.ts',
          'lib/ai-orchestrator/src/evidence-integrity.ts',
          'artifacts/dashboard/src/pages/AiChat.tsx',
          'lib/ai-orchestrator/src/tool-execution-engine.ts',
        ],
        retainedBodyFiles: [
          'src/routes/ai/chat.ts',
          'lib/ai-orchestrator/src/agents/chat-agent.ts',
          'lib/ai-orchestrator/src/evidence-integrity.ts',
          'artifacts/dashboard/src/pages/AiChat.tsx',
          'lib/ai-orchestrator/src/tool-execution-engine.ts',
        ],
        acceptedEvidenceFiles: [],
        acceptedClaimCount: 0,
      },
      {
        // Only the loop read was persisted as a tool trace entry. The five
        // prefetch bodies exist only in the canonical evidence projection.
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/ai/chat.ts',
        cached: true,
      },
      {
        kind: 'done',
        iterations: 2,
        maxIterations: 6,
        toolCalls: 6,
        prefetchToolCalls: 5,
        loopToolCalls: 1,
        stopReason: 'response',
        synthesisStarted: true,
        diagnosticCodes: [],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    expect(await screen.findByText('Source reads (5 unique)')).toBeInTheDocument();
    expect(screen.getByText('completed reads')).toBeInTheDocument();
    expect(screen.getByText('lib/ai-orchestrator/src/evidence-integrity.ts')).toBeInTheDocument();
    expect(screen.queryByText('No completed source reads were recorded. Directory listings and failed reads are not source evidence.')).not.toBeInTheDocument();
  });

  it('uses legacy scalar evidence counters when persisted file lists are absent', async () => {
    mocks.serverProposal = { proposalId: 'legacy-scalar-evidence-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Legacy telemetry records two completed source reads.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'evidence_integrity',
        code: 'TELEMETRY_CONSISTENT',
        consistent: true,
        violations: [],
        readAttempts: 2,
        uniqueFilesRead: 2,
        evidenceFileCount: 2,
        acceptedEvidenceCount: 0,
      },
      {
        kind: 'done',
        iterations: 1,
        maxIterations: 6,
        toolCalls: 2,
        prefetchToolCalls: 2,
        loopToolCalls: 0,
        stopReason: 'response',
        synthesisStarted: true,
        diagnosticCodes: [],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    expect(await screen.findByText('Source reads (2 unique)')).toBeInTheDocument();
    expect(screen.getByText('2 source reads')).toBeInTheDocument();
    expect(screen.queryByText('No completed source reads were recorded. Directory listings and failed reads are not source evidence.')).not.toBeInTheDocument();
  });

  it('keeps a proven fixture Finding visible when the final report blocks repair', async () => {
    mocks.serverProposal = { proposalId: 'fixture-proven-blocked-repair', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Verdict',
      'NOT PROVEN — no executable repair phase is authorized for this fixture-local Finding.',
      '## 2) Evidence Map',
      'File: `lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts`',
      'Evidence: `return eval(expression);`',
      '## 3) Findings',
      '* ID: F-01 · Fixture-local dynamic evaluation',
      '* File(s): `lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts`',
      '* Evidence: `return eval(expression);`',
      '## 4) Repair Plan',
      'No executable repair phase is authorized for a fixture-local Finding.',
      '## 6) Final Judgment',
      'NOT PROVEN — production reachability and repair authorization remain blocked.',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'forensic_status',
        auditScope: 'FIXTURE_LOCAL',
        productionReachability: 'NOT_PROVEN',
        sourceCoverage: 'COMPLETE',
        behavioralAssessment: 'COMPLETE',
        findingStatus: 'PROVEN',
        repairReadiness: 'BLOCKED',
        isFixtureLocal: true,
        implementationFiles: 1,
        contextFiles: 0,
        generatedFiles: 0,
      },
      {
        kind: 'evidence_integrity',
        code: 'TELEMETRY_CONSISTENT',
        consistent: true,
        violations: [],
        readAttempts: 1,
        uniqueFilesRead: 1,
        evidenceFileCount: 1,
        acceptedEvidenceCount: 1,
        completedReadFiles: ['lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts'],
        retainedBodyFiles: ['lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts'],
        acceptedEvidenceFiles: ['lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts'],
        acceptedClaimCount: 1,
      },
      {
        kind: 'done',
        iterations: 1,
        maxIterations: 6,
        toolCalls: 1,
        prefetchToolCalls: 1,
        loopToolCalls: 0,
        stopReason: 'response',
        synthesisStarted: true,
        diagnosticCodes: ['FORENSIC_DETERMINISTIC_FINDING'],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    expect((await screen.findAllByText('FINDING PROVEN')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/production reachability and repair authorization remain blocked/i)).toBeInTheDocument();
  });

  it('shows the same ordered five-file manifest in forensic status and evidence integrity', async () => {
    mocks.serverProposal = { proposalId: 'five-file-manifest-proposal', changes: [] };
    const requestedFiles = [
      'lib/flight-deck/src/mission.ts',
      'lib/flight-deck/src/plan.ts',
      'lib/flight-deck/src/explore.ts',
      'lib/flight-deck/src/validate.ts',
      'lib/flight-deck/src/repair.ts',
    ];
    const roots = requestedFiles.map((root) => ({
      root,
      discoveredFiles: 1,
      readFiles: 1,
      unreadFiles: 0,
      status: 'COMPLETE' as const,
    }));
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Five source files were read completely.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'forensic_status',
        auditScope: 'PRODUCTION',
        productionReachability: 'NOT_PROVEN',
        sourceCoverage: 'COMPLETE',
        behavioralAssessment: 'COMPLETE',
        findingStatus: 'NO_FINDING',
        repairReadiness: 'BLOCKED',
        implementationFiles: 5,
        contextFiles: 0,
        generatedFiles: 0,
        requestedFiles,
        rootCoverage: roots,
      },
      {
        kind: 'evidence_integrity',
        code: 'TELEMETRY_CONSISTENT',
        consistent: true,
        violations: [],
        readAttempts: 5,
        uniqueFilesRead: 5,
        evidenceFileCount: 5,
        acceptedEvidenceCount: 0,
        completedReadFiles: requestedFiles,
        retainedBodyFiles: requestedFiles,
        acceptedEvidenceFiles: [],
        acceptedClaimCount: 0,
        evidenceSourceCoverage: {
          status: 'COMPLETE',
          requestedFiles,
          roots,
        },
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    expect(await screen.findByText('canonical manifest')).toBeInTheDocument();
    expect(screen.getByText('requested files')).toBeInTheDocument();
    for (const file of requestedFiles) {
      expect(screen.getAllByText(file).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('replaces the source-reads list with a claim-oriented evidence view', async () => {
    mocks.serverProposal = { proposalId: 'claim-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Behavioral answer with accepted evidence.',
      '## 6) Final Judgment',
      'FINDING PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'done',
        iterations: 3,
        maxIterations: 6,
        toolCalls: 2,
        prefetchToolCalls: 0,
        loopToolCalls: 2,
        stopReason: 'response',
        synthesisStarted: true,
        diagnosticCodes: ['FORENSIC_DETERMINISTIC_FINDING'],
      },
    ]);
    mocks.proposalMessages[0].behaviorEvidence = JSON.stringify([
      {
        source: 'src/routes/ai/chat.ts',
        excerpt: 'const result = await chat(req, res); return result;',
        sourceSpan: { startLine: 1396, endLine: 1426 },
        supportsClaim: true,
        directness: 'DIRECT',
        evidenceClass: 'BEHAVIOR_PROVEN',
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    expect(await screen.findByText('These lines prove this behavior')).toBeInTheDocument();
    // The same anchor also appears in the BehaviorEvidencePanel, so assert the
    // claim-oriented copy exists without requiring it to be unique.
    expect(screen.getAllByText('src/routes/ai/chat.ts:1396–1426').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DIRECT').length).toBeGreaterThan(0);
    // Plain file reads are replaced, not shown alongside.
    expect(screen.queryByText(/Source reads \(\d+ unique\)/)).not.toBeInTheDocument();
  });

  it('reveals the exact source lines behind a span-bearing evidence anchor', async () => {
    mocks.serverProposal = { proposalId: 'behavior-view-proposal', changes: [] };
    // Excerpt is deliberately DIFFERENT in length from the span (single-line
    // excerpt for a 2-line span) — proves the viewer loads the real file from
    // the server rather than mislabelling the excerpt as exact source lines.
    mocks.proposalMessages[0].behaviorEvidence = JSON.stringify([
      {
        source: 'src/routes/ai/chat.ts',
        excerpt: 'const result = await chat(req, res);',
        sourceSpan: { startLine: 1396, endLine: 1397 },
        supportsClaim: true,
        evidenceClass: 'BEHAVIOR_PROVEN',
      },
      {
        source: 'src/config/app.ts',
        excerpt: 'const LIMIT = 5',
        supportsClaim: true,
        evidenceClass: 'READ_CONFIRMED',
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Behavior evidence · 2 excerpts')).toBeInTheDocument();

    // The exact source lines are hidden until the analyst opts in.
    expect(screen.queryByText('1396')).not.toBeInTheDocument();

    // View-file affordance is only exposed for span-bearing evidence.
    const viewButtons = screen.getAllByRole('button', { name: 'View file' });
    expect(viewButtons).toHaveLength(1);

    fireEvent.click(viewButtons[0]);
    // The viewer requests a window WIDER than the exact span (context above and
    // below) so the analyst can see the surrounding function/branch and scroll
    // beyond the excerpt. Span is 1396–1397, so the requested window starts
    // before 1396 and ends after 1397 — surrounding context, not just the quote.
    const req = mocks.fileContentRequest as { startLine?: number; endLine?: number };
    expect(req.startLine).toBeLessThan(1396);
    expect(req.endLine).toBeGreaterThan(1397);
    // The real file window renders the requested line (1396) and its true
    // neighbours (1395 and 1397) — the excerpt's trimmed single line is NOT the
    // source of these offsets. Lines 1395 and 1397 exist ONLY in the fetched
    // file content (never in the excerpt), so their presence proves the viewer
    // loaded the real file rather than relabelling the excerpt. assertText
    // normalizes whitespace, so the leading spaces in the file are stripped.
    const assertText = (text: string) =>
      expect(screen.getByText((content: string) => content.trim() === text)).toBeInTheDocument();
    expect(screen.getByText('1396')).toBeInTheDocument();
    assertText('return result;');
    assertText('const ctx = buildContext();');

    // Collapses again.
    const hideButton = await screen.findByRole('button', { name: 'Hide source' });
    fireEvent.click(hideButton);
    expect(screen.queryByText('1396')).not.toBeInTheDocument();
  });

  it('degrades to the unlabelled excerpt when the real file is unavailable', async () => {
    mocks.serverProposal = { proposalId: 'behavior-unavailable-proposal', changes: [] };
    const prev = mocks.fileContent;
    mocks.fileContent = { available: false, reason: 'file_not_found', lines: [] };
    mocks.proposalMessages[0].behaviorEvidence = JSON.stringify([
      {
        source: 'src/routes/ai/chat.ts',
        excerpt: 'const result = await chat(req, res);',
        sourceSpan: { startLine: 1396, endLine: 1397 },
        supportsClaim: true,
        evidenceClass: 'BEHAVIOR_PROVEN',
      },
    ]);
    try {
      renderAiChat();
      fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
      expect(await screen.findByText('Behavior evidence · 1 excerpt')).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'View file' })[0]);
      // The panel says source is unavailable and does NOT fabricate line 1396.
      expect(await screen.findByText(/Source file unavailable/)).toBeInTheDocument();
      expect(screen.queryByText('1396')).not.toBeInTheDocument();
    } finally {
      mocks.fileContent = prev;
    }
  });

  it('renders a CODE_EXTRACTION_RESULT as a syntax-highlighted code block', async () => {
    mocks.serverProposal = { proposalId: 'code-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'CODE_EXTRACTION_RESULT',
      extractedCode: 'return partial;',
      source: 'src/loop.ts',
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Extracted code')).toBeInTheDocument();
    expect(screen.getByText('return partial;')).toBeInTheDocument();
    expect(screen.getByText('src/loop.ts')).toBeInTheDocument();
  });

  it('renders a BEHAVIOR_ANSWER_RESULT with confidence and answer text', async () => {
    mocks.serverProposal = { proposalId: 'behavior-answer-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'BEHAVIOR_ANSWER_RESULT',
      answer: {
        answer: 'maxIterations returns exhausted once the cap is reached.',
        confidence: 0.85,
        sourceScope: ['src/loop.ts'],
        evidence: [{ source: 'src/loop.ts', excerpt: 'if (i >= MAX) return exhausted;' }],
      },
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Behavior answer')).toBeInTheDocument();
    expect(screen.getByText(/confidence 85%/)).toBeInTheDocument();
    expect(screen.getByText('maxIterations returns exhausted once the cap is reached.')).toBeInTheDocument();
  });

  it('renders a FINDING_RESULT with a severity badge and description', async () => {
    mocks.serverProposal = { proposalId: 'finding-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'FINDING_RESULT',
      finding: {
        finding: 'The loop can exit without returning the exhausted state.',
        severity: 'HIGH',
        evidence: [{ source: 'src/loop.ts', excerpt: 'return exhausted;' }],
      },
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Finding')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('The loop can exit without returning the exhausted state.')).toBeInTheDocument();
  });

  it('renders a FORENSIC_REPORT_RESULT with the report text', async () => {
    mocks.serverProposal = { proposalId: 'report-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'FORENSIC_REPORT_RESULT',
      report: 'No behavioral defect found across reviewed sources.',
      evidence: [{ source: 'src/loop.ts' }],
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Forensic report')).toBeInTheDocument();
    expect(screen.getByText('No behavioral defect found across reviewed sources.')).toBeInTheDocument();
    expect(screen.getByText('1 evidence item')).toBeInTheDocument();
  });

  it('renders a cancelled forensic SSE completion as incomplete without leaking diagnostics', async () => {
    mocks.serverProposal = { proposalId: 'cancelled-forensic-audit', changes: [] };
    mocks.proposalMessages[0].content = CANCELLED_FORENSIC_REPORT_FIXTURE;
    mocks.proposalMessages[0].operationMode = 'FORENSIC_AUDIT';
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'forensic_status',
        auditScope: 'PRODUCTION',
        productionReachability: 'NOT_PROVEN',
        sourceCoverage: 'PARTIAL',
        behavioralAssessment: 'INCOMPLETE',
        // A stale status must not override the cancelled report.
        findingStatus: 'NO_FINDING',
        repairReadiness: 'BLOCKED',
        implementationFiles: 1,
        contextFiles: 0,
        generatedFiles: 0,
      },
      {
        kind: 'diagnostic',
        code: 'FORENSIC_CONTRACT_RECOVERY_FAILED',
        details: [
          'AbortError: recovery provider request was cancelled',
          'provider recovery-provider diagnostic: cancellation requested by user',
          'telemetry.internalAttemptId=secret-fixture-value',
        ],
      },
      {
        kind: 'done',
        iterations: 3,
        maxIterations: 24,
        toolCalls: 1,
        prefetchToolCalls: 0,
        loopToolCalls: 1,
        stopReason: 'cancelled',
        synthesisStarted: true,
        diagnosticCodes: ['FORENSIC_CONTRACT_RECOVERY_FAILED'],
        diagnosticDetails: [
          'AbortError: recovery provider request was cancelled',
          'provider recovery-provider diagnostic: cancellation requested by user',
          'telemetry.internalAttemptId=secret-fixture-value',
        ],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    for (const heading of [
      '1) Executive Verdict',
      '2) Evidence Map',
      '3) Findings',
      '4) Repair Plan',
      '5) Validation Checklist',
      '6) Final Judgment',
    ]) {
      expect(await screen.findByText(heading)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/ANALYSIS_INCOMPLETE/).length).toBeGreaterThan(0);
    expect(screen.queryByText('NO_VERIFIED_FINDING')).not.toBeInTheDocument();
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument();
    expect(screen.queryByText(/provider recovery-provider diagnostic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/telemetry\.internalAttemptId/)).not.toBeInTheDocument();
    expect(screen.queryByText('NO FINDING')).not.toBeInTheDocument();
  });

  it('renders a REPAIR_RESULT with a readiness indicator and phases', async () => {
    mocks.serverProposal = { proposalId: 'repair-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'REPAIR_RESULT',
      readiness: 'READY',
      phases: [{
        findingId: 'F-1',
        files: ['src/loop.ts'],
        steps: ['Add an early return when the cap is reached.'],
      }],
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Repair plan')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByText('F-1')).toBeInTheDocument();
    expect(screen.getByText('Add an early return when the cap is reached.')).toBeInTheDocument();
  });

  it('renders a WORKSPACE_REVIEW_RESULT with its evidence label', async () => {
    mocks.serverProposal = { proposalId: 'workspace-review-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'WORKSPACE_REVIEW_RESULT',
      report: 'Workspace review is NOT PROVEN without completed source reads.',
      evidence: [],
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Workspace review')).toBeInTheDocument();
    expect(screen.getByText('Workspace review is NOT PROVEN without completed source reads.')).toBeInTheDocument();
  });

  it('renders an implementation plan once and keeps its file details collapsed', async () => {
    mocks.serverProposal = { proposalId: 'implementation-plan-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      '## Implementation plan',
      '**Objective:** This prose copy should not be rendered separately.',
    ].join('\n');
    mocks.proposalMessages[0].taskResult = {
      kind: 'IMPLEMENTATION_PLAN_RESULT',
      objective: 'Improve the chat experience',
      summary: 'Make the plan evidence-grounded and easier to review.',
      assumptions: ['The existing chat route remains the entry point.'],
      steps: [{
        id: 'step-1',
        title: 'Read the relevant UI files',
        description: 'Inspect the current message and plan renderers.',
        action: 'inspect',
        files: ['artifacts/dashboard/src/pages/AiChat.tsx'],
        validation: ['Run the dashboard tests'],
      }],
      validationCommands: ['pnpm test'],
      risks: [],
      approvalStatus: 'PENDING_APPROVAL',
      writeAccess: 'NOT_AUTHORIZED',
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Improve the chat experience')).toBeInTheDocument();
    expect(screen.getAllByText('Implementation plan')).toHaveLength(1);
    expect(screen.queryByText('artifacts/dashboard/src/pages/AiChat.tsx')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Files, validation, and assumptions' }));
    expect(screen.getByText('artifacts/dashboard/src/pages/AiChat.tsx')).toBeInTheDocument();
    expect(screen.getByText('The existing chat route remains the entry point.')).toBeInTheDocument();
  });

  it('does not offer approval for a fallback plan without verified file scope', async () => {
    mocks.serverProposal = { proposalId: 'unscoped-plan-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'IMPLEMENTATION_PLAN_RESULT',
      objective: 'Improve the user experience',
      summary: 'A safe implementation plan could not be structured by the provider.',
      assumptions: ['No verified source excerpts were read.'],
      steps: [{
        id: 'step-1',
        title: 'Inspect the requested area',
        description: 'Identify the relevant source files first.',
        action: 'inspect',
        files: [],
        validation: ['Confirm the target files.'],
      }],
      validationCommands: [],
      risks: ['No file-level changes are authorized.'],
      approvalStatus: 'PENDING_APPROVAL',
      writeAccess: 'NOT_AUTHORIZED',
    };
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('Source scope required')).toBeInTheDocument();
    expect(screen.getByText(/Approval unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument();
  });

  it('collapses internal technical trace prose behind Technical details', async () => {
    mocks.serverProposal = { proposalId: 'internal-trace-proposal', changes: [] };
    mocks.proposalMessages[0].content = [
      "export type AiStreamDecisionTraceEvent = {",
      "  type: 'decision_trace';",
      "  finalState: 'VERIFIED';",
      '};',
      'directory: /home/runner/workspace/src',
    ].join('\n');
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText('The agent produced internal technical details for this run.')).toBeInTheDocument();
    expect(screen.queryByText(/AiStreamDecisionTraceEvent/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByText(/AiStreamDecisionTraceEvent/)).toBeInTheDocument();
  });

  it('ignores a generic chat turn with no taskResult (falls back to prose)', async () => {
    mocks.serverProposal = { proposalId: 'generic-proposal', changes: [] };
    mocks.proposalMessages[0].taskResult = undefined;
    mocks.proposalMessages[0].content = 'Plain prose answer';
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText(/Plain prose answer/)).toBeInTheDocument();
    expect(screen.queryByText('Extracted code')).not.toBeInTheDocument();
    expect(screen.queryByText('Behavior answer')).not.toBeInTheDocument();
  });

  it('commits the complete final SSE message instead of leaving streamed partial text', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'Explain the response path' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDelta?: (chunk: string) => void;
      }).onDelta?.('partial answer that should be replaced');
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDone?: (data: Record<string, unknown>) => void;
      }).onDone?.({
        sessionId: 'session-1',
        message: {
          id: 'assistant-2',
          role: 'assistant',
          content: 'The complete final answer with the verified details.',
          createdAt: '2026-08-17T00:00:00.000Z',
        },
      });
    });

    expect(screen.getByText('The complete final answer with the verified details.')).toBeInTheDocument();
    expect(screen.queryByText('partial answer that should be replaced')).not.toBeInTheDocument();
  });

  it('does not render a delivery trace for a forensic audit operation', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'Review the declared source files only' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDone?: (data: Record<string, unknown>) => void;
      }).onDone?.({
        sessionId: 'session-1',
        operationId: 'audit-operation',
        operationMode: 'FORENSIC_AUDIT',
        taskResult: {
          kind: 'WORKSPACE_REVIEW_RESULT',
          report: 'Audit remains blocked until all evidence is retained.',
          evidence: [],
        },
        message: {
          id: 'assistant-forensic',
          role: 'assistant',
          content: 'Audit remains blocked until all evidence is retained.',
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      });
    });

    expect((await screen.findAllByText(/Audit remains blocked/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Unified operation trace')).not.toBeInTheDocument();
  });

  it('renders a delivery trace for an implementation plan before delivery events exist', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'Create an implementation plan for the response path' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDone?: (data: Record<string, unknown>) => void;
      }).onDone?.({
        sessionId: 'session-1',
        operationId: 'delivery-operation',
        operationMode: 'DELIVERY',
        taskResult: {
          kind: 'IMPLEMENTATION_PLAN_RESULT',
          objective: 'Make the response path observable.',
          summary: 'Add a bounded delivery trace.',
          assumptions: [],
          steps: [{ files: ['src/routes/response.ts'] }],
          validationCommands: ['pnpm test'],
          risks: [],
          approvalStatus: 'PENDING_APPROVAL',
          writeAccess: 'NOT_AUTHORIZED',
        },
        message: {
          id: 'assistant-plan',
          role: 'assistant',
          content: 'Implementation plan ready for approval.',
          createdAt: '2026-08-18T00:00:00.000Z',
        },
      });
    });

    expect(await screen.findByText('Unified operation trace')).toBeInTheDocument();
    expect(screen.getByText('delivery not started')).toBeInTheDocument();
  });

  it('keeps the live agent activity timeline on the completed assistant message', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'Trace the response path' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onToolCall?: (event: Record<string, unknown>) => void;
        onToolResult?: (event: Record<string, unknown>) => void;
        onModelCall?: (event: Record<string, unknown>) => void;
        onDone?: (data: Record<string, unknown>) => void;
      }).onToolCall?.({
        type: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/routes/response.ts' },
        cached: false,
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onToolResult?: (event: Record<string, unknown>) => void;
      }).onToolResult?.({
        type: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/response.ts',
        cached: false,
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onModelCall?: (event: Record<string, unknown>) => void;
      }).onModelCall?.({
        type: 'model_call',
        model: 'test-model',
        provider: 'test-provider',
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDone?: (data: Record<string, unknown>) => void;
      }).onDone?.({
        sessionId: 'session-1',
        message: {
          id: 'assistant-activity',
          role: 'assistant',
          content: 'The response path is verified.',
          createdAt: '2026-08-17T00:00:00.000Z',
        },
      });
    });

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.getByText(/Reading source/)).toBeInTheDocument();
    expect(screen.getByText(/Model response/)).toBeInTheDocument();
    expect(screen.getAllByText(/src\/routes\/response\.ts/).length).toBeGreaterThan(0);
  });

  it('shows one execution proof panel as soon as durable work starts', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'Prove the response path' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onExecutionStarted?: (event: Record<string, unknown>) => void;
        onStage?: (stage: string) => void;
        onToolCall?: (event: Record<string, unknown>) => void;
        onToolResult?: (event: Record<string, unknown>) => void;
        onEvidenceIntegrity?: (event: Record<string, unknown>) => void;
      }).onExecutionStarted?.({
        type: 'execution_started',
        executionId: 'execution-proof-1',
        status: 'running',
        resumeToken: 'opaque-resume-token',
        resumable: true,
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onStage?: (stage: string) => void;
      }).onStage?.('building-context');
      (mocks.streamCallbacks as Record<string, unknown> & {
        onToolCall?: (event: Record<string, unknown>) => void;
      }).onToolCall?.({
        type: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/routes/response.ts' },
        cached: false,
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onToolResult?: (event: Record<string, unknown>) => void;
      }).onToolResult?.({
        type: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/response.ts',
        cached: false,
      });
      (mocks.streamCallbacks as Record<string, unknown> & {
        onEvidenceIntegrity?: (event: Record<string, unknown>) => void;
      }).onEvidenceIntegrity?.({
        type: 'evidence_integrity',
        consistent: true,
        violations: [],
      });
    });

    const proofPanel = await screen.findByRole('generic', { name: 'Agent execution proof' });
    expect(proofPanel).toHaveTextContent('Agent execution proof');
    expect(proofPanel).toHaveTextContent('Running');
    expect(proofPanel).toHaveTextContent('execution-proof-1');
    expect(proofPanel).toHaveTextContent('Telemetry consistent');
    expect(proofPanel).toHaveTextContent('No writes applied automatically');
  });

  it('reconstructs the activity timeline from persisted toolTrace history', async () => {
    mocks.serverProposal = { proposalId: 'history-proposal', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/routes/history.ts' },
      },
      {
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/history.ts',
      },
      {
        kind: 'model_call',
        model: 'history-model',
        provider: 'history-provider',
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.getByText(/Reading source/)).toBeInTheDocument();
    expect(screen.getByText(/Model response/)).toBeInTheDocument();
    expect(screen.getAllByText(/src\/routes\/history\.ts/).length).toBeGreaterThan(0);
  });

  it('renders persisted execution proof after reloading a completed assistant message', async () => {
    mocks.serverProposal = { proposalId: 'proof-history', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/routes/history.ts' },
      },
      {
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/history.ts',
      },
      {
        kind: 'model_call',
        model: 'history-model',
        provider: 'history-provider',
      },
      {
        kind: 'done',
        iterations: 2,
        maxIterations: 6,
        toolCalls: 1,
        prefetchToolCalls: 0,
        loopToolCalls: 1,
        stopReason: 'response',
        synthesisStarted: false,
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const proof = await screen.findByText('Persisted execution proof');
    expect(proof).toBeInTheDocument();
    fireEvent.click(proof);

    expect(screen.getByText('1 source read')).toBeInTheDocument();
    expect(screen.getByText('Writes gated')).toBeInTheDocument();
    expect(screen.getByText('response completed')).toBeInTheDocument();
    expect(screen.getByText(/Model path:.*history-model/)).toBeInTheDocument();
  });

  it('keeps zero-read execution diagnostics compact and collapsed', async () => {
    mocks.serverProposal = { proposalId: 'zero-read-proof', changes: [] };
    mocks.proposalMessages[0].content = 'توقف التنفيذ قبل قراءة أي ملف مصدر لذلك لا يمكن اعتبار النتيجة مكتملة أو مثبتة.';
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'diagnostic',
        code: 'INCOMPLETE_BEFORE_EVIDENCE',
        details: ['run ended with zero source reads'],
      },
      {
        kind: 'done',
        iterations: 1,
        maxIterations: 6,
        toolCalls: 0,
        prefetchToolCalls: 0,
        loopToolCalls: 0,
        stopReason: 'response',
        synthesisStarted: false,
        diagnosticCodes: ['INCOMPLETE_BEFORE_EVIDENCE'],
        diagnosticDetails: ['run ended with zero source reads'],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    expect(await screen.findByText(/توقف التنفيذ قبل قراءة/)).toBeInTheDocument();
    expect(screen.queryByText(/Execution diagnostic:/)).not.toBeInTheDocument();

    const activity = screen.queryByText('Agent activity');
    if (activity) {
      expect(activity.closest('details')).not.toHaveAttribute('open');
    }
    expect(screen.getByText('Persisted execution proof')).toBeInTheDocument();
  });

  it('renders Repair Radar from persisted validation and repair-state trace entries', async () => {
    mocks.serverProposal = { proposalId: 'repair-radar', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'repair_state',
        repairState: 'VALIDATING',
        reason: 'Running the focused validation before repair.',
      },
      {
        kind: 'validation',
        validationStatus: 'failed',
        validationProfile: 'api-ai-tests',
        validationAttempt: 1,
        validationMaxAttempts: 3,
        validationExitCode: 1,
        validationDetail: 'One focused assertion failed.',
        validationFailedTests: ['src/routes/ai.test.ts › rejects stale patch'],
        validationAffectedFiles: ['src/routes/ai/chat.ts'],
      },
      {
        kind: 'repair_state',
        repairState: 'REPAIRING',
        reason: 'A bounded correction is allowed.',
      },
      {
        kind: 'tool_call',
        tool: 'replace_text',
        args: {
          path: 'src/routes/ai/chat.ts',
          reason: 'Replace the stale scope check identified by the failed assertion.',
          findingId: 'finding-stale-scope',
          risk: 'medium',
          validationProfile: 'api-ai-tests',
        },
        reasoning: 'The failed assertion points to the stale scope branch, so the second patch narrows the correction to that branch.',
      },
      {
        kind: 'validation',
        validationStatus: 'passed',
        validationProfile: 'api-ai-tests',
        validationAttempt: 2,
        validationMaxAttempts: 3,
        validationExitCode: 0,
        validationDetail: 'Focused validation passed.',
      },
      {
        kind: 'repair_state',
        repairState: 'READY_FOR_REVIEW',
        reason: 'The validated patch is waiting for approval.',
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const radar = await screen.findByRole('generic', { name: 'Repair Radar' });
    expect(radar).toHaveTextContent('Ready for review');
    expect(radar).toHaveTextContent('2 validations');

    fireEvent.click(screen.getByRole('button', { name: /Repair Radar/ }));
    expect(radar).toHaveTextContent('Attempt 1');
    expect(radar).toHaveTextContent('Attempt 2');
    expect(radar).toHaveTextContent('failed');
    expect(radar).toHaveTextContent('passed');
    expect(radar).toHaveTextContent('writes behind the approval gate');
    expect(radar).toHaveTextContent('Patch provenance');
    expect(radar).toHaveTextContent('finding-stale-scope');
    expect(radar).toHaveTextContent('Replace the stale scope check');
  });

  it('renders a read-only Flight Recorder with category filters', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/routes/flight.ts' },
      },
      {
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/flight.ts',
      },
      {
        kind: 'validation',
        validationStatus: 'failed',
        validationProfile: 'api-ai-tests',
        validationAttempt: 1,
        validationMaxAttempts: 3,
        validationDetail: 'Focused test failed.',
      },
      {
        kind: 'execution_guard',
        code: 'WRITE_APPROVAL_REQUIRED',
        message: 'Writes remain approval-gated.',
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const recorder = await screen.findByRole('generic', { name: 'Flight Recorder' });
    expect(recorder).toHaveTextContent('read-only replay');
    expect(recorder).toHaveTextContent('4 events');

    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));
    expect(recorder).toHaveTextContent('Called read_file');
    expect(recorder).toHaveTextContent('Validation failed');
    expect(recorder).toHaveTextContent('Execution guard');
    expect(recorder).toHaveTextContent('no actions are replayed');

    fireEvent.change(screen.getByLabelText('Flight Recorder filter'), { target: { value: 'validation' } });
    expect(recorder).toHaveTextContent('Validation failed');
    expect(recorder).not.toHaveTextContent('Called read_file');

    fireEvent.click(screen.getByRole('button', { name: 'Step Flight Recorder replay' }));
    expect(recorder).toHaveTextContent('Replay event 1');
    expect(recorder).toHaveTextContent('1/4');
    expect(recorder).toHaveTextContent('Called read_file');

    fireEvent.click(screen.getByRole('button', { name: 'Step Flight Recorder replay' }));
    expect(recorder).toHaveTextContent('Replay event 2');
    expect(recorder).toHaveTextContent('2/4');

    fireEvent.click(screen.getByRole('button', { name: 'Step backward in Flight Recorder replay' }));
    expect(recorder).toHaveTextContent('Replay event 1');
    expect(recorder).toHaveTextContent('1/4');

    fireEvent.click(screen.getByRole('button', { name: 'Reset Flight Recorder replay' }));
    expect(recorder).not.toHaveTextContent('Replay event 2');
    expect(recorder).toHaveTextContent('0/4');
  });

  it('renders a collapsible, color-coded repair attempt diff', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder-repair-diff', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'diagnostic',
        code: 'REPAIR_ATTEMPT_DIFF',
        details: [
          'attempt 2 vs 1',
          [
            '--- attempt-N-1/src/auth.ts',
            '+++ attempt-N/src/auth.ts',
            '@@ -1,2 +1,2 @@',
            '-const scope = "user";',
            '+const scope = token.scope;',
          ].join('\n'),
        ],
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const recorder = await screen.findByRole('generic', { name: 'Flight Recorder' });
    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));

    expect(recorder).toHaveTextContent('Repair attempt diff');
    expect(recorder).toHaveTextContent('attempt 2 vs 1');
    expect(recorder).not.toHaveTextContent('What changed in this repair attempt?');

    const showDiff = screen.getByRole('button', { name: 'Show repair attempt diff' });
    fireEvent.click(showDiff);

    const diffPanel = await screen.findByRole('generic', { name: 'Repair attempt diff' });
    expect(diffPanel).toHaveTextContent('What changed in this repair attempt?');
    expect(diffPanel).toHaveTextContent('-const scope = "user";');
    expect(diffPanel).toHaveTextContent('+const scope = token.scope;');
    const removedLine = [...diffPanel.querySelectorAll('span')].find(
      (line) => line.textContent === '-const scope = "user";',
    );
    const addedLine = [...diffPanel.querySelectorAll('span')].find(
      (line) => line.textContent === '+const scope = token.scope;',
    );
    expect(removedLine).toHaveClass('text-red-300');
    expect(addedLine).toHaveClass('text-green-300');

    fireEvent.click(screen.getByRole('button', { name: 'Hide repair attempt diff' }));
    expect(screen.queryByRole('generic', { name: 'Repair attempt diff' })).toBeNull();
  });

  it('renders the evidence claim linked to an execution read', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder-evidence-link', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'diagnostic',
        code: 'READ_EVIDENCE_LINKED',
        details: [
          'src/auth.ts',
          'claim: requireAuth verifies the token scope before calling next().',
        ],
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const recorder = await screen.findByRole('generic', { name: 'Flight Recorder' });
    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));

    expect(recorder).toHaveTextContent('Evidence linked');
    expect(recorder).toHaveTextContent('src/auth.ts');
    expect(recorder).not.toHaveTextContent('Read → extracted evidence');

    fireEvent.click(screen.getByRole('button', { name: 'Show read evidence link' }));
    const evidencePanel = await screen.findByRole('generic', { name: 'Read evidence link' });
    expect(evidencePanel).toHaveTextContent('Read → extracted evidence');
    expect(evidencePanel).toHaveTextContent('src/auth.ts');
    expect(evidencePanel).toHaveTextContent('requireAuth verifies the token scope before calling next().');

    fireEvent.click(screen.getByRole('button', { name: 'Hide read evidence link' }));
    expect(screen.queryByRole('generic', { name: 'Read evidence link' })).toBeNull();
  });

  it('renders failed validation details in the Flight Recorder', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder-validation-details', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'validation',
        validation: {
          profile: 'workspace-typecheck',
          status: 'failed',
          scenario: 'Typecheck after repair',
          command: 'pnpm run typecheck',
          exitCode: 1,
          stdout: '',
          stderr: 'TS2322: Type is not assignable.',
          failedTests: [
            { name: 'Auth scope check', message: 'Expected token.scope to be present.' },
          ],
          changedFiles: ['src/auth.ts'],
          evidence: {
            evidenceId: 'validation-evidence-1',
            observedAt: '2026-08-18T05:00:00.000Z',
            artifactRef: 'validation-attempt:1',
          },
        },
        attempt: 1,
        maxAttempts: 3,
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const recorder = await screen.findByRole('generic', { name: 'Flight Recorder' });
    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));

    expect(recorder).toHaveTextContent('Validation failed');
    expect(recorder).toHaveTextContent('workspace-typecheck');
    expect(recorder).not.toHaveTextContent('Failed tests:');

    fireEvent.click(screen.getByRole('button', { name: 'Show validation details' }));
    const detailsPanel = await screen.findByRole('generic', { name: 'Validation details' });
    expect(detailsPanel).toHaveTextContent('Status: failed');
    expect(detailsPanel).toHaveTextContent('Exit code: 1');
    expect(detailsPanel).toHaveTextContent('pnpm run typecheck');
    expect(detailsPanel).toHaveTextContent('Auth scope check');
    expect(detailsPanel).toHaveTextContent('Expected token.scope to be present.');
    expect(detailsPanel).toHaveTextContent('TS2322: Type is not assignable.');
    expect(detailsPanel).toHaveTextContent('src/auth.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Hide validation details' }));
    expect(screen.queryByRole('generic', { name: 'Validation details' })).toBeNull();
  });

  it('redacts runtime paths while preserving code-block scrolling', async () => {
    mocks.serverProposal = { proposalId: 'long-message', changes: [] };
    mocks.proposalMessages[0].content = [
      'A long path: `src/routes/ai/projects/very-long-project-name/behavior-evidence-controller.ts`',
      '',
      '```ts',
      'const path = "/home/runner/workspace/lib/ai-orchestrator/src/tool-execution-engine.ts";',
      '```',
    ].join('\n');
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    await waitFor(() => {
      expect(document.querySelector('pre code')?.textContent).toContain('[project path]');
    });
    const code = document.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(document.body.textContent).not.toContain('/home/runner/workspace/');
    expect(code?.parentElement).toHaveClass('overflow-x-auto', 'max-w-full');
    expect(code?.closest('.prose')).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
  });

  it('shows per-hunk accept/reject toggles and sends only accepted hunks on apply', async () => {
    renderAiChat();

    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'fix both values' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    const pendingHunkChanges = [{
      path: 'src/service.ts',
      absolutePath: '/tmp/src/service.ts',
      originalContent: 'const a = 1;\nconst b = 2;\n',
      newContent: 'const a = 10;\nconst b = 20;\n',
      baseHash: 'a'.repeat(64),
      hunks: [
        { startLine: 1, endLine: 1, expectedText: 'const a = 1;', replacementText: 'const a = 10;', reason: 'Bump a' },
        { startLine: 2, endLine: 2, expectedText: 'const b = 2;', replacementText: 'const b = 20;', reason: 'Bump b' },
      ],
      reason: 'Update both values',
      validationProfile: 'api-ai-tests' as const,
    }];

    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDone?: (data: Record<string, unknown>) => void;
      }).onDone?.({
        sessionId: 'session-1',
        proposalId: 'hunk-proposal-1',
        pendingChanges: pendingHunkChanges,
        message: {
          id: 'assistant-hunks',
          role: 'assistant',
          content: 'Here are the proposed changes.',
          createdAt: new Date().toISOString(),
        },
      });
    });

    // The card should show both proposed hunks.  Expand the change first.
    const viewBtn = await screen.findByRole('button', { name: /View/ });
    fireEvent.click(viewBtn);

    // Both hunks start as accepted.
    const acceptBtns = await screen.findAllByRole('button', { name: /Accepted — click to reject/i });
    expect(acceptBtns).toHaveLength(2);

    // Reject the second hunk (Bump b).
    fireEvent.click(acceptBtns[1]);

    // After rejection, one hunk is accepted and one is rejected.
    expect(screen.getAllByRole('button', { name: /Accepted — click to reject/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Rejected — click to accept/i })).toHaveLength(1);

    // The apply button should reflect the partial hunk count.
    const applyBtn = screen.getByRole('button', { name: /Apply.*1\/2 hunks/i });
    expect(applyBtn).toBeInTheDocument();

    // Clicking Apply must pass only the first (accepted) hunk to the mutation.
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(mocks.mutations.applyChanges.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changes: [expect.objectContaining({
              path: 'src/service.ts',
              hunks: expect.arrayContaining([
                expect.objectContaining({ reason: 'Bump a' }),
              ]),
            })],
          }),
        }),
      );
    });
    // Only 1 hunk in the forwarded change (the rejected one is dropped).
    const call = mocks.mutations.applyChanges.mutate.mock.calls[0][0] as {
      data: { changes: Array<{ hunks?: Array<{ reason: string }> }> };
    };
    expect(call.data.changes[0].hunks).toHaveLength(1);
    expect(call.data.changes[0].hunks?.[0].reason).toBe('Bump a');
  });

  it('does not leak a fixture-local verdict scope from a failed run into the next stream', async () => {
    renderAiChat();

    // Drive the mocked stream through a real send so the callbacks are captured.
    const textarea = await screen.findByPlaceholderText(/Ask about your codebase/);
    fireEvent.change(textarea, { target: { value: 'audit the fixture' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // The stream is still in flight — mark busy so the live activity bubble renders.
    act(() => {
      mocks.streamIsPending = true;
    });

    // A decision_trace arrives with a fixture-local verdict scope.
    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onDecisionTrace?: (e: Record<string, unknown>) => void;
      }).onDecisionTrace?.({
        type: 'decision_trace',
        verdictScope: 'FIXTURE_LOCAL',
        scopedFindingStatus: 'FIXTURE_PROVEN',
      });
    });
    expect(screen.getAllByText('FIXTURE LOCAL').length).toBeGreaterThan(0);

    // The run fails: the live verdict scope must be cleared, not retained for the next run.
    act(() => {
      (mocks.streamCallbacks as Record<string, unknown> & {
        onError?: (e: unknown) => void;
      }).onError?.(new Error('provider failed'));
    });
    expect(screen.queryByText('FIXTURE LOCAL')).not.toBeInTheDocument();

    // A brand-new stream starts: no decision trace has arrived yet, so the stale
    // FIXTURE LOCAL badge must not reappear before the next run emits its own trace.
    await act(async () => {
      mocks.streamIsPending = true;
    });
    expect(screen.queryByText('FIXTURE LOCAL')).not.toBeInTheDocument();
  });

  it('renders the Capability Probe quick action and, on click, sends the canonical probe message', async () => {
    renderAiChat();

    // Empty-state quick actions include the one-click probe runner.
    const probeButton = await screen.findByRole('button', { name: 'Capability Probe' });
    expect(probeButton).toBeInTheDocument();

    fireEvent.click(probeButton);

    // The stream receives the CANONICAL probe body (not a hand-typed prompt)
    // for the auto-selected project — no manual paste required.
    await waitFor(() => {
      expect(mocks.sentParams?.message ?? '').toContain('# AI Model Capability Probe');
      expect(mocks.sentParams?.message ?? '').toContain('C7');
      expect(mocks.sentParams?.message ?? '').toContain(
        'lib/ai-orchestrator/src/prompts/profile-classifier.ts',
      );
    });
    expect(mocks.sentParams?.projectId).toBe('project-1');
  });

  it('streams Analyze progress and renders its structured result with the activity timeline', async () => {
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Analyze Scan' }));
    expect(mocks.taskSentParams).toEqual({ projectId: 'project-1', task: 'analyze' });

    act(() => {
      (mocks.taskStreamCallbacks as Record<string, unknown> & {
        onStage?: (stage: string) => void;
        onTaskProgress?: (event: Record<string, unknown>) => void;
        onModelCall?: (event: Record<string, unknown>) => void;
        onTaskDone?: (event: Record<string, unknown>) => void;
      }).onStage?.('building-context');
      (mocks.taskStreamCallbacks as Record<string, unknown> & {
        onTaskProgress?: (event: Record<string, unknown>) => void;
      }).onTaskProgress?.({
        type: 'task_progress',
        task: 'analyze',
        message: 'Calling AI model…',
      });
      (mocks.taskStreamCallbacks as Record<string, unknown> & {
        onModelCall?: (event: Record<string, unknown>) => void;
      }).onModelCall?.({
        type: 'model_call',
        model: 'analysis-model',
        provider: 'test-provider',
      });
      (mocks.taskStreamCallbacks as Record<string, unknown> & {
        onTaskDone?: (event: Record<string, unknown>) => void;
      }).onTaskDone?.({
        type: 'task_done',
        task: 'analyze',
        result: {
          summary: 'Analysis complete',
          overallAssessment: 'Healthy',
          insights: [],
          topPriority: 'Keep shipping',
          estimatedImpact: 'Low risk',
        },
      });
    });

    expect(screen.getByText(/Analysis complete/)).toBeInTheDocument();
    expect(screen.getByText('Agent activity')).toBeInTheDocument();
    expect(screen.getByText(/Calling AI model/)).toBeInTheDocument();
    expect(screen.getByText(/analysis-model/)).toBeInTheDocument();
  });

  it('shows "Why this file?" panel with agent reasoning when a read tool step is expanded', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder-reasoning', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/auth/verify-token.ts' },
        cached: false,
        reasoning: 'I need to inspect the authentication module to understand how tokens are validated.',
      },
      {
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/auth/verify-token.ts',
        cached: false,
        outputLength: 512,
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const recorder = await screen.findByRole('generic', { name: 'Flight Recorder' });
    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));

    // "Why?" button is visible for the read_file step.
    const whyButton = await screen.findByRole('button', { name: 'Why this file?' });
    expect(whyButton).toBeInTheDocument();

    // Panel is hidden before clicking.
    expect(recorder).not.toHaveTextContent('Why this file?');

    // Click expands the panel.
    fireEvent.click(whyButton);

    const panel = await screen.findByRole('generic', { name: 'Why this file?' });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('src/auth/verify-token.ts');
    expect(panel).toHaveTextContent(
      'I need to inspect the authentication module to understand how tokens are validated.',
    );

    // Clicking "Why?" again collapses the panel.
    fireEvent.click(whyButton);
    expect(screen.queryByRole('generic', { name: 'Why this file?' })).toBeNull();
  });

  it('shows "No reasoning captured" for a cached read_file step in the Why panel', async () => {
    mocks.serverProposal = { proposalId: 'flight-recorder-cached', changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/utils/helpers.ts' },
        cached: true,
        // no reasoning — cached calls don't produce model reasoning
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    fireEvent.click(screen.getByRole('button', { name: /Flight Recorder/ }));

    const whyButton = await screen.findByRole('button', { name: 'Why this file?' });
    fireEvent.click(whyButton);

    const panel = await screen.findByRole('generic', { name: 'Why this file?' });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('src/utils/helpers.ts');
    expect(panel).toHaveTextContent('No reasoning captured');
  });

  it('does not present forensic audit telemetry as a delivery Flight Recorder', async () => {
    mocks.serverProposal = { proposalId: 'forensic-no-delivery', changes: [] };
    mocks.proposalMessages[0].taskResult = {
      kind: 'FORENSIC_REPORT_RESULT',
      report: 'Audit is not a delivery run.',
      evidence: [],
    };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_call',
        tool: 'read_file',
        args: { path: 'src/unsafe.ts' },
        reasoning: 'Inspect the audit target.',
      },
      {
        kind: 'diagnostic',
        code: 'READ_EVIDENCE_LINKED',
        details: ['src/unsafe.ts', 'claim: the audit evidence is retained'],
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    expect(screen.queryByRole('generic', { name: 'Flight Recorder' })).toBeNull();
    expect(screen.getByText('Audit is not a delivery run.')).toBeInTheDocument();
  });

  it('surfaces first concrete contract violation from diagnosticDetails in rejection reason', async () => {
    mocks.serverProposal = { proposalId: 'contract-violation-detail', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Audit did not satisfy the evidence gate.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'tool_result',
        tool: 'read_file',
        source: 'src/routes/ai/chat.ts',
        completed: true,
      },
      {
        kind: 'done',
        iterations: 3,
        maxIterations: 6,
        toolCalls: 2,
        prefetchToolCalls: 0,
        loopToolCalls: 2,
        stopReason: 'response',
        synthesisStarted: true,
        recoveryStarted: true,
        diagnosticCodes: ['FORENSIC_CONTRACT_RECOVERY_REJECTED'],
        diagnosticDetails: [
          'completed source reads preserved',
          'FULL_FORENSIC_AUDIT response is missing one or more report sections',
          'Evidence Map rebuilt deterministically',
        ],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    // The first operational meta-string is skipped; the concrete violation is shown
    // in the rejection reason paragraph (not just the diagnostic detail list).
    const rejectionParagraph = await screen.findByText(
      /The model response was rejected: FULL_FORENSIC_AUDIT response is missing one or more report sections\./,
    );
    expect(rejectionParagraph).toBeInTheDocument();
    // The generic fallback sentence must NOT appear when a violation is available.
    expect(screen.queryByText(/did not satisfy the required six-section evidence contract/)).toBeNull();
  });

  it('falls back to generic rejection sentence when diagnosticDetails has no concrete violation', async () => {
    mocks.serverProposal = { proposalId: 'no-violation-detail', changes: [] };
    mocks.proposalMessages[0].content = [
      '## 1) Executive Summary',
      'Audit did not satisfy the evidence gate.',
      '## 6) Final Judgment',
      'NOT PROVEN',
    ].join('\n');
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'done',
        iterations: 2,
        maxIterations: 6,
        toolCalls: 1,
        prefetchToolCalls: 0,
        loopToolCalls: 1,
        stopReason: 'response',
        synthesisStarted: true,
        recoveryStarted: true,
        diagnosticCodes: ['FORENSIC_CONTRACT_RECOVERY_REJECTED'],
        diagnosticDetails: [
          'completed source reads preserved',
          'Evidence Map rebuilt deterministically',
          'provider recovery exhausted without an accepted six-section report',
        ],
      },
    ]);
    renderAiChat();

    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));
    const card = await screen.findByRole('button', { name: /Forensic evidence/ });
    fireEvent.click(card);

    // All details are operational meta-strings; generic sentence is shown.
    expect(await screen.findByText(
      /did not satisfy the required six-section evidence contract/,
    )).toBeInTheDocument();
  });

  it.each([
    ['BLOCKED', 'Repair blocked'],
    ['REPAIRING', 'Repair correction allowed'],
    ['READY_FOR_REVIEW', 'Ready for review'],
  ] as const)('surfaces the %s repair state in Repair Radar', async (state, label) => {
    mocks.serverProposal = { proposalId: `repair-state-${state}`, changes: [] };
    mocks.proposalMessages[0].toolTrace = JSON.stringify([
      {
        kind: 'repair_state',
        repairState: state,
        reason: label,
      },
    ]);

    renderAiChat();
    fireEvent.click(await screen.findByRole('button', { name: 'Existing session' }));

    const radar = await screen.findByRole('generic', { name: 'Repair Radar' });
    expect(radar).toHaveTextContent(state === 'READY_FOR_REVIEW' ? 'Ready for review' : state === 'REPAIRING' ? 'Repairing' : 'Blocked');
    fireEvent.click(screen.getByRole('button', { name: /Repair Radar/ }));
    expect(radar).toHaveTextContent(label);
  });

});