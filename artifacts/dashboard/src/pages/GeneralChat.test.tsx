import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralChat from './GeneralChat';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';
import {
  readAssistantComposerDraft,
  readAssistantScopeContext,
  rememberAssistantScopeContext,
  saveAssistantComposerDraft,
} from '@/lib/assistant-scope-continuity';

vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: 'user-1' }, isLoaded: true }) }));
const mocks = vi.hoisted(() => {
  const session = { id: 'session-1', title: 'نقاش المشروع', updatedAt: '2026-10-14T10:00:00Z' };
  return {
    session,
    sessions: { data: [session], isLoading: false, isError: false, refetch: vi.fn() },
    projects: { data: [{ id: 'project-1', name: 'مشروع واحد' }], isLoading: false, isError: false, refetch: vi.fn() },
    messages: { data: [] as { id: string; role: string; content: string; status: string; errorMessage?: string }[], isLoading: false, isError: false, refetch: vi.fn() },
    create: vi.fn(), remove: vi.fn(), send: vi.fn(),
  };
});

vi.mock('@workspace/api-client-react', () => ({
  getListProjectsQueryKey: () => ['/api/projects'],
  getListGeneralChatSessionsQueryKey: () => ['/api/ai/general-chat/sessions'],
  getListGeneralChatMessagesQueryKey: (id: string) => ['/api/ai/general-chat/sessions', id, 'messages'],
  useListProjects: () => mocks.projects,
  useListGeneralChatSessions: () => mocks.sessions,
  useListGeneralChatMessages: () => mocks.messages,
  useCreateGeneralChatSession: () => ({ mutate: mocks.create, isPending: false }),
  useDeleteGeneralChatSession: () => ({ mutate: mocks.remove, isPending: false }),
  useSendGeneralChatMessage: () => ({ mutate: mocks.send, isPending: false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><GeneralChat /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/general-chat');
  mocks.sessions.data = [mocks.session];
  mocks.sessions.isLoading = false;
  mocks.sessions.isError = false;
  mocks.projects.data = [{ id: 'project-1', name: 'مشروع واحد' }];
  mocks.projects.isLoading = false;
  mocks.projects.isError = false;
  mocks.messages.data = [];
  mocks.messages.isLoading = false;
  mocks.messages.isError = false;
});

describe('Arabic conversation feedback boundaries', () => {
  it('requires choosing a project from the actual project list', () => {
    renderPage();
    expect(screen.getByTestId('select-scope-project')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'مشروع واحد' })).toHaveValue('project-1');
  });

  it('preserves an unsent general draft by account and session before opening the chosen project', () => {
    renderPage();
    fireEvent.change(screen.getByTestId('input-general-chat-message'), {
      target: { value: 'أريد شرح هذه الفكرة' },
    });

    fireEvent.change(screen.getByTestId('select-scope-project'), {
      target: { value: 'project-1' },
    });

    expect(readAssistantComposerDraft('user-1', 'general', 'session-1')).toEqual({
      ok: true,
      text: 'أريد شرح هذه الفكرة',
    });
    expect(readAssistantScopeContext('user-1', 'general')).toEqual({
      scope: 'general',
      sessionId: 'session-1',
    });
    const params = new URLSearchParams(window.location.search);
    expect(window.location.pathname).toBe('/ai');
    expect(params.get('projectId')).toBe('project-1');
    expect(params.get('sessionId')).toBeNull();
    expect(params.get('goalDraftId')).toBeNull();
    expect(window.location.search).not.toContain('أريد شرح هذه الفكرة');
  });

  it('restores only the exact general session draft and never sends it automatically', async () => {
    const text = 'أكمل الشرح لاحقًا';
    saveAssistantComposerDraft('user-1', 'general', 'session-1', text);
    mocks.sessions.data = [
      mocks.session,
      { id: 'session-2', title: 'محادثة أخرى', updatedAt: '2026-10-15T10:00:00Z' },
    ];
    window.history.replaceState({}, '', '/general-chat?sessionId=session-1');

    renderPage();
    await waitFor(() => expect(screen.getByTestId('input-general-chat-message')).toHaveValue(text));
    expect(screen.getByTestId('status-general-scope-draft-restored')).toHaveTextContent('لن يُرسل تلقائيًا');
    expect(mocks.send).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-select-general-session-session-2'));
    await waitFor(() => expect(screen.getByTestId('input-general-chat-message')).toHaveValue(''));
    expect(screen.queryByTestId('status-general-scope-draft-restored')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-select-general-session-session-1'));
    await waitFor(() => expect(screen.getByTestId('input-general-chat-message')).toHaveValue(text));
    expect(screen.getByTestId('status-general-scope-draft-restored')).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('returns to the selected project’s own saved session rather than another project’s session', () => {
    mocks.projects.data = [
      { id: 'project-1', name: 'مشروع واحد' },
      { id: 'project-2', name: 'مشروع اثنان' },
    ];
    rememberAssistantScopeContext('user-1', {
      scope: 'project',
      projectId: 'project-1',
      sessionId: 'session-project-1',
    });
    rememberAssistantScopeContext('user-1', {
      scope: 'project',
      projectId: 'project-2',
      sessionId: 'session-project-2',
    });

    renderPage();
    fireEvent.change(screen.getByTestId('select-scope-project'), {
      target: { value: 'project-2' },
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('projectId')).toBe('project-2');
    expect(params.get('sessionId')).toBe('session-project-2');
    expect(window.location.search).not.toContain('session-project-1');
  });

  it('distinguishes a failed session read from an empty list and retries only the read', () => {
    mocks.sessions.data = [];
    mocks.sessions.isError = true;
    renderPage();
    expect(screen.getByText('تعذر عرض المحادثات')).toBeInTheDocument();
    expect(screen.queryByText('لا توجد محادثات في القائمة بعد')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-create-first-general-chat')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-retry-general-sessions'));
    expect(mocks.sessions.refetch).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('shows the Arabic empty list without creating a conversation automatically', () => {
    mocks.sessions.data = [];
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد محادثات في القائمة بعد');
    expect(screen.getByTestId('button-create-first-general-chat')).toHaveTextContent('إنشاء محادثة');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps a home handoff separate from the latest session until the user creates a new conversation', () => {
    const saved = storeHomeGoalDraft('أريد فهم سبب بطء الصفحة', 'user-1');
    expect(saved).not.toBeNull();
    window.history.replaceState({}, '', `/general-chat?goalDraftId=${saved!.id}`);
    const view = renderPage();

    expect(screen.getByText('هدف محفوظ — لم يُرسل')).toBeInTheDocument();
    expect(screen.getByTestId('button-select-general-session-session-1')).toBeInTheDocument();
    expect(screen.queryByTestId('input-general-chat-message')).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts[0].sendAttemptedAt).toBeNull();

    fireEvent.click(screen.getByTestId('button-continue-home-goal-new-chat'));
    expect(mocks.create).toHaveBeenCalledOnce();
    const onSuccess = mocks.create.mock.calls[0][1].onSuccess;
    const newSession = { id: 'session-new', title: 'محادثة جديدة', createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z' };
    mocks.sessions.data = [newSession, mocks.session];
    act(() => onSuccess(newSession));
    expect(screen.getByTestId('input-general-chat-message')).toHaveValue('أريد فهم سبب بطء الصفحة');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts[0].sendAttemptedAt).toBeNull();
    expect(window.location.search).toContain('sessionId=session-new');

    view.unmount();
    mocks.sessions.data = [
      { ...mocks.session, id: 'session-new', title: 'محادثة جديدة' },
      mocks.session,
    ];
    renderPage();
    expect(screen.getByTestId('input-general-chat-message')).toHaveValue('أريد فهم سبب بطء الصفحة');
    expect(screen.queryByText('هدف محفوظ — لم يُرسل')).not.toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('records a home draft send attempt before sending so reload cannot replay it', () => {
    const saved = storeHomeGoalDraft('راجع فكرة التخزين المؤقت', 'user-1');
    window.history.replaceState({}, '', `/general-chat?goalDraftId=${saved!.id}`);
    const view = renderPage();
    fireEvent.click(screen.getByTestId('button-continue-home-goal-new-chat'));
    const onSuccess = mocks.create.mock.calls[0][1].onSuccess;
    const newSession = { id: 'session-new', title: 'محادثة جديدة', createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z' };
    mocks.sessions.data = [newSession, mocks.session];
    act(() => onSuccess(newSession));
    fireEvent.click(screen.getByTestId('button-send-general-message'));

    expect(mocks.send).toHaveBeenCalledOnce();
    expect(readGoalDrafts('user-1').drafts[0].sendAttemptedAt).not.toBeNull();
    view.unmount();
    renderPage();
    expect(screen.queryByText('تعذر استعادة المسودة')).not.toBeInTheDocument();
    expect(screen.getByTestId('input-general-chat-message')).toHaveValue('');
    expect(screen.queryByText('هدف محفوظ — لم يُرسل')).not.toBeInTheDocument();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('offers a saved general draft again without attaching it to an existing conversation', () => {
    const saved = storeHomeGoalDraft('أريد مقارنة خيارين', 'user-1');
    renderPage();

    const resumeButton = screen.getByTestId(`button-resume-general-goal-${saved!.id}`);
    expect(screen.getByTestId('button-select-general-session-session-1')).toBeInTheDocument();
    fireEvent.click(resumeButton);

    expect(window.location.search).toContain(`goalDraftId=${saved!.id}`);
    expect(screen.getByText('هدف محفوظ — لم يُرسل')).toBeInTheDocument();
    expect(screen.getByTestId('button-select-general-session-session-1')).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('restores the exact draft after send failure without claiming rejection or retrying', () => {
    renderPage();
    const draft = 'قارن الخيارين مع src/App.tsx';
    const input = screen.getByTestId('input-general-chat-message');
    expect(input).toHaveAttribute('dir', 'auto');
    fireEvent.change(input, { target: { value: draft } });
    fireEvent.click(screen.getByTestId('button-send-general-message'));
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-1', data: { message: draft },
    });
    expect(input).toHaveValue('');
    act(() => mocks.send.mock.calls[0][1].onError());
    expect(input).toHaveValue(draft);
    expect(screen.getByRole('alert')).toHaveTextContent('تعذر تأكيد قبول الرسالة');
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('keeps the server error verbatim beside a failed reply and disables sending while pending', () => {
    mocks.messages.data = [
      { id: 'reply-1', role: 'assistant', content: 'Partial reply', status: 'failed', errorMessage: 'Bounded provider timeout' },
      { id: 'reply-2', role: 'assistant', content: '', status: 'pending' },
    ];
    renderPage();
    expect(screen.getByText('لم يكتمل الرد')).toBeInTheDocument();
    expect(screen.getByText('Bounded provider timeout')).toHaveAttribute('dir', 'auto');
    fireEvent.change(screen.getByTestId('input-general-chat-message'), { target: { value: 'متابعة' } });
    expect(screen.getByTestId('button-send-general-message')).toBeDisabled();
    fireEvent.click(screen.getByTestId('button-send-general-message'));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('warns of irreversible deletion and sends no delete when the user cancels', () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(screen.getByTestId('button-delete-general-session-session-1'));
    expect(confirmation).toHaveBeenCalledWith('حذف «نقاش المشروع» ورسائلها نهائيًا؟ لا يمكن التراجع عن ذلك.');
    expect(mocks.remove).not.toHaveBeenCalled();
    confirmation.mockRestore();
  });
});
