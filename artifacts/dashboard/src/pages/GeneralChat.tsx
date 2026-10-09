import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Bot,
  CirclePlus,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  getListGeneralChatMessagesQueryKey,
  getListGeneralChatSessionsQueryKey,
  useCreateGeneralChatSession,
  useDeleteGeneralChatSession,
  useListGeneralChatMessages,
  useListGeneralChatSessions,
  useSendGeneralChatMessage,
} from '@workspace/api-client-react';

function createUuid(): string {
  return crypto.randomUUID();
}

export default function GeneralChat() {
  const queryClient = useQueryClient();
  const sessionsQuery = useListGeneralChatSessions({
    query: { queryKey: getListGeneralChatSessionsQueryKey() },
  });
  const [activeSessionId, setActiveSessionId] = useState('');
  const [draft, setDraft] = useState('');
  const [actionError, setActionError] = useState('');
  const createSession = useCreateGeneralChatSession();
  const deleteSession = useDeleteGeneralChatSession();
  const sendMessage = useSendGeneralChatMessage();
  const sessions = sessionsQuery.data ?? [];
  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [sessions],
  );
  const activeSession = orderedSessions.find((session) => session.id === activeSessionId);
  const messagesQuery = useListGeneralChatMessages(activeSessionId, {
    query: {
      enabled: Boolean(activeSessionId),
      queryKey: getListGeneralChatMessagesQueryKey(activeSessionId),
      refetchInterval: (query) => {
        const hasPending = (query.state.data ?? []).some((message) => message.status === 'pending');
        return hasPending ? 1500 : false;
      },
    },
  });
  const messages = messagesQuery.data ?? [];
  const hasPendingReply = messages.some((message) => message.status === 'pending');

  useEffect(() => {
    if (!activeSessionId && orderedSessions.length > 0) setActiveSessionId(orderedSessions[0].id);
    if (activeSessionId && !sessionsQuery.isLoading && !orderedSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(orderedSessions[0]?.id ?? '');
    }
  }, [activeSessionId, orderedSessions, sessionsQuery.isLoading]);

  const handleCreate = () => {
    setActionError('');
    createSession.mutate(undefined, {
      onSuccess: (session) => {
        queryClient.setQueryData(
          getListGeneralChatSessionsQueryKey(),
          (old: typeof sessions | undefined) => [session, ...(old ?? []).filter((item) => item.id !== session.id)],
        );
        setActiveSessionId(session.id);
        setDraft('');
        void queryClient.invalidateQueries({ queryKey: getListGeneralChatSessionsQueryKey() });
      },
      onError: () => setActionError('A new conversation could not be created. Your existing conversations are unchanged.'),
    });
  };

  const handleDelete = (sessionId: string) => {
    const session = orderedSessions.find((item) => item.id === sessionId);
    if (!session || !window.confirm(`Delete “${session.title}” and its messages? This cannot be undone.`)) return;
    setActionError('');
    deleteSession.mutate({ sessionId }, {
      onSuccess: () => {
        const remaining = orderedSessions.filter((item) => item.id !== sessionId);
        queryClient.setQueryData(
          getListGeneralChatSessionsQueryKey(),
          (old: typeof sessions | undefined) => (old ?? []).filter((item) => item.id !== sessionId),
        );
        if (activeSessionId === sessionId) setActiveSessionId(remaining[0]?.id ?? '');
        void queryClient.invalidateQueries({ queryKey: getListGeneralChatSessionsQueryKey() });
        void queryClient.removeQueries({ queryKey: getListGeneralChatMessagesQueryKey(sessionId) });
      },
      onError: () => setActionError('That conversation could not be deleted. It is still available in your list.'),
    });
  };

  const handleSend = () => {
    const message = draft.trim();
    const sessionId = activeSessionId;
    if (!message || !sessionId || sendMessage.isPending || hasPendingReply) return;
    setActionError('');
    setDraft('');
    sendMessage.mutate(
      { sessionId, data: { turnId: createUuid(), message } },
      {
        onSuccess: (output) => {
          queryClient.setQueryData(
            getListGeneralChatMessagesQueryKey(output.sessionId),
            (old: typeof messages | undefined) => {
              const prior = old ?? [];
              const next = [output.userMessage, output.assistantMessage];
              const ids = new Set(prior.map((item) => item.id));
              return [...prior, ...next.filter((item) => !ids.has(item.id))];
            },
          );
          void queryClient.invalidateQueries({ queryKey: getListGeneralChatSessionsQueryKey() });
        },
        onError: () => {
          setDraft(message);
          setActionError('The message was not accepted. Your draft has been restored; retry when ready.');
          void queryClient.invalidateQueries({ queryKey: getListGeneralChatMessagesQueryKey(sessionId) });
        },
      },
    );
  };

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/40 lg:min-h-[calc(100dvh-8rem)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">General engineering chat</h1>
              <span className="hidden rounded border border-border bg-background/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:inline">No project scope</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">A durable conversation space, separate from project workspaces.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={createSession.isPending}
          data-testid="button-create-general-chat"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {createSession.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CirclePlus className="h-4 w-4" />}
          New conversation
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label="Saved conversations" className="flex max-h-52 flex-col border-b border-border bg-background/35 md:max-h-none md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Conversation log</span>
            <span className="font-mono text-[10px] text-muted-foreground">{sessions.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {sessionsQuery.isLoading ? (
              <div className="space-y-2 p-2" aria-label="Loading conversations">
                {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg border border-border/70 bg-secondary/35" />)}
              </div>
            ) : sessionsQuery.isError ? (
              <div className="m-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-muted-foreground">
                <p>Saved conversations could not be loaded.</p>
                <button type="button" onClick={() => void sessionsQuery.refetch()} data-testid="button-retry-general-sessions" className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground"><RefreshCw className="h-3 w-3" /> Retry</button>
              </div>
            ) : orderedSessions.length === 0 ? (
              <div className="m-2 rounded-lg border border-dashed border-border px-3 py-5 text-center">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><MessageSquareText className="h-4 w-4" /></div>
                <p className="text-xs font-medium">No conversations yet</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Create one to start a saved engineering discussion.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {orderedSessions.map((session) => (
                  <div key={session.id} className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${activeSessionId === session.id ? 'border-primary/30 bg-primary/8' : 'border-transparent hover:border-border hover:bg-secondary/45'}`}>
                    <button
                      type="button"
                      onClick={() => { setActiveSessionId(session.id); setActionError(''); }}
                      data-testid={`button-select-general-session-${session.id}`}
                      aria-current={activeSessionId === session.id ? 'true' : undefined}
                      className="min-w-0 flex-1 px-1.5 py-1 text-left"
                    >
                      <span className="block truncate text-xs font-medium">{session.title || 'Untitled conversation'}</span>
                      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">{new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(session.id)}
                      disabled={deleteSession.isPending}
                      aria-label={`Delete ${session.title || 'conversation'}`}
                      data-testid={`button-delete-general-session-${session.id}`}
                      className="rounded p-1.5 text-muted-foreground opacity-100 transition hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-[430px] min-w-0 flex-col md:min-h-0" aria-label="General conversation">
          {activeSession ? (
            <>
              <div className="flex min-w-0 items-center gap-2 border-b border-border/70 px-5 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{activeSession.title}</h2>
                <span className="hidden font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:inline">User-owned / durable</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
                {messagesQuery.isLoading ? (
                  <div className="mx-auto max-w-2xl space-y-4" aria-label="Loading messages">
                    {[0, 1].map((item) => <div key={item} className={`h-20 animate-pulse rounded-xl border border-border bg-secondary/30 ${item ? 'ml-auto w-3/4' : 'w-4/5'}`} />)}
                  </div>
                ) : messagesQuery.isError ? (
                  <div className="mx-auto mt-8 max-w-md rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 text-center">
                    <AlertTriangle className="mx-auto h-5 w-5 text-amber-300" />
                    <p className="mt-2 text-sm font-medium">Messages are unavailable</p>
                    <p className="mt-1 text-xs text-muted-foreground">This conversation is unchanged. Try loading it again.</p>
                    <button type="button" onClick={() => void messagesQuery.refetch()} data-testid="button-retry-general-messages" className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"><RefreshCw className="h-3 w-3" /> Retry</button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="mx-auto mt-12 max-w-md text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/55 text-primary"><Bot className="h-5 w-5" /></div>
                    <h3 className="mt-4 text-base font-semibold">A clean slate</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Ask about an engineering decision, system design, debugging approach, or anything else. This conversation has no project workspace or project tools attached.</p>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-5">
                    {messages.map((message) => (
                      <article key={message.id} data-testid={`message-general-${message.id}`} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${message.role === 'user' ? 'border-primary/20 bg-primary/10 text-primary' : 'border-border bg-secondary text-muted-foreground'}`}>
                          {message.role === 'user' ? <UserRound className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                        </div>
                        <div className={`min-w-0 max-w-[85%] rounded-xl border px-4 py-3 ${message.role === 'user' ? 'border-primary/20 bg-primary/8' : 'border-border bg-card'}`}>
                          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
                            <span>{message.role === 'user' ? 'You' : 'EngineeringOS'}</span>
                            {message.status === 'pending' && <span className="inline-flex items-center gap-1 text-primary"><Activity className="h-3 w-3 animate-pulse" /> In progress</span>}
                            {message.status === 'failed' && <span className="text-amber-300">Could not complete</span>}
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
                          {message.status === 'failed' && <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{message.errorMessage || 'This response did not complete. You can send a follow-up when ready.'}</p>}
                        </div>
                      </article>
                    ))}
                    <div aria-live="polite" className="sr-only">{hasPendingReply ? 'The assistant is preparing a response.' : ''}</div>
                  </div>
                )}
              </div>
              <div className="border-t border-border bg-background/40 px-4 py-4 sm:px-8">
                {actionError && <div role="alert" data-testid="status-general-chat-error" className="mx-auto mb-3 max-w-3xl rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">{actionError}</div>}
                <div className="mx-auto max-w-3xl">
                  <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value.slice(0, 12000))}
                      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }}
                      maxLength={12000}
                      rows={2}
                      placeholder={hasPendingReply ? 'Waiting for the assistant to complete…' : 'Write an engineering question or thought…'}
                      aria-label="Message to EngineeringOS"
                      data-testid="input-general-chat-message"
                      className="max-h-40 min-h-11 min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/65"
                    />
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!draft.trim() || sendMessage.isPending || hasPendingReply}
                      data-testid="button-send-general-message"
                      aria-label="Send message"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sendMessage.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-primary" /> Standalone conversation. No project files or tools are in scope.</span>
                    <span className="shrink-0 font-mono">{draft.length}/12000</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground"><MessageSquareText className="h-6 w-6" /></div>
              <h2 className="mt-4 text-base font-semibold">{sessionsQuery.isLoading ? 'Loading saved conversations' : 'Start a conversation'}</h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{sessionsQuery.isLoading ? 'Your conversation list is being retrieved.' : 'Create an independent engineering thread. It will remain separate from all projects.'}</p>
              {!sessionsQuery.isLoading && !sessionsQuery.isError && (
                <button type="button" onClick={handleCreate} disabled={createSession.isPending} data-testid="button-create-first-general-chat" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Create conversation
                </button>
              )}
              {actionError && <p role="alert" className="mt-4 text-xs text-amber-200">{actionError}</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
