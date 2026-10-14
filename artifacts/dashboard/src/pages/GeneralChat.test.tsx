import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GeneralChat from './GeneralChat';

const mocks = vi.hoisted(() => {
  const session = { id: 'session-1', title: 'نقاش المشروع', updatedAt: '2026-10-14T10:00:00Z' };
  return {
    session,
    sessions: { data: [session], isLoading: false, isError: false, refetch: vi.fn() },
    messages: { data: [] as { id: string; role: string; content: string; status: string; errorMessage?: string }[], isLoading: false, isError: false, refetch: vi.fn() },
    create: vi.fn(), remove: vi.fn(), send: vi.fn(),
  };
});

vi.mock('@workspace/api-client-react', () => ({
  getListGeneralChatSessionsQueryKey: () => ['/api/ai/general-chat/sessions'],
  getListGeneralChatMessagesQueryKey: (id: string) => ['/api/ai/general-chat/sessions', id, 'messages'],
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
  mocks.sessions.data = [mocks.session];
  mocks.sessions.isLoading = false;
  mocks.sessions.isError = false;
  mocks.messages.data = [];
  mocks.messages.isLoading = false;
  mocks.messages.isError = false;
});

describe('Arabic conversation feedback boundaries', () => {
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
