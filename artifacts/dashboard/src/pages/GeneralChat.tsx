import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { AssistantScopeSwitch } from '@/components/AssistantScopeSwitch';
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
import { readGoalDrafts, updateGoalDraft, type GoalDraft } from '@/lib/home-goal-handoff';

function createUuid(): string {
  return crypto.randomUUID();
}

export default function GeneralChat() {
  const { user, isLoaded } = useUser();
  const [, setLocation] = useLocation();
  const routeParams = new URLSearchParams(window.location.search);
  const routeDraftId = routeParams.get('goalDraftId');
  const routeSessionId = routeParams.get('sessionId');
  const queryClient = useQueryClient();
  const sessionsQuery = useListGeneralChatSessions({
    query: { queryKey: getListGeneralChatSessionsQueryKey() },
  });
  const [activeSessionId, setActiveSessionId] = useState(() => new URLSearchParams(window.location.search).get('sessionId') ?? '');
  const [draft, setDraft] = useState('');
  const [actionError, setActionError] = useState('');
  const [incomingGoalDraft, setIncomingGoalDraft] = useState<GoalDraft | null>(null);
  const [goalDraftAttached, setGoalDraftAttached] = useState<GoalDraft | null>(null);
  const [goalDraftResolved, setGoalDraftResolved] = useState(!routeDraftId);
  const [goalDraftError, setGoalDraftError] = useState('');
  const [pendingGeneralDrafts, setPendingGeneralDrafts] = useState<GoalDraft[]>([]);
  const [pendingDraftStorageError, setPendingDraftStorageError] = useState('');
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
  const resumableGeneralDrafts = pendingGeneralDrafts.filter((item) =>
    item.id !== routeDraftId
    && item.id !== incomingGoalDraft?.id
    && item.id !== goalDraftAttached?.id);

  useEffect(() => {
    if (!routeDraftId || !isLoaded || !user?.id) return;
    if (routeSessionId && sessionsQuery.isLoading) return;
    if (routeSessionId && sessionsQuery.isError) {
      setGoalDraftError('تعذر التحقق من المحادثة المحددة. لم نستخدم محادثة أخرى تلقائيًا.');
      setGoalDraftResolved(true);
      return;
    }
    if (routeSessionId && !orderedSessions.some((session) => session.id === routeSessionId)) {
      setGoalDraftError('المحادثة المحددة غير متاحة لهذا الحساب. لم نستخدم محادثة أخرى تلقائيًا.');
      setGoalDraftResolved(true);
      return;
    }
    const stored = readGoalDrafts(user.id);
    const candidate = stored.drafts.find((item) =>
      item.id === routeDraftId && item.projectId === null && item.sendAttemptedAt === null && item.text.trim());
    if (stored.error) setGoalDraftError(stored.error);
    else if (candidate && routeSessionId) {
      setGoalDraftError('');
      setActiveSessionId(routeSessionId);
      setDraft(candidate.text);
      setGoalDraftAttached(candidate);
      setIncomingGoalDraft(null);
    } else if (candidate) {
      setGoalDraftError('');
      setIncomingGoalDraft(candidate);
    }
    else setGoalDraftError('المسودة العامة غير متاحة لهذا الحساب أو سبق بدء إرسالها. لم نستخدم محادثة أخرى تلقائيًا.');
    setGoalDraftResolved(true);
  }, [routeDraftId, routeSessionId, isLoaded, user?.id, sessionsQuery.isLoading, sessionsQuery.isError, orderedSessions]);

  useEffect(() => {
    if (!isLoaded) return;
    const stored = readGoalDrafts(user?.id);
    setPendingDraftStorageError(stored.error ?? '');
    setPendingGeneralDrafts(stored.drafts.filter((item) =>
      item.projectId === null && item.sendAttemptedAt === null && item.text.trim()));
  }, [isLoaded, user?.id, routeDraftId, goalDraftAttached?.id, incomingGoalDraft?.id]);

  useEffect(() => {
    if (routeDraftId && !routeSessionId) return;
    if (routeSessionId) {
      if (sessionsQuery.isLoading || sessionsQuery.isError) return;
      if (orderedSessions.some((session) => session.id === routeSessionId)) {
        if (activeSessionId !== routeSessionId) setActiveSessionId(routeSessionId);
      } else if (activeSessionId) {
        setActiveSessionId('');
        setActionError('المحادثة المطلوبة غير متاحة؛ لم نفتح محادثة أخرى بدلًا منها.');
      }
      return;
    }
    if (!activeSessionId && orderedSessions.length > 0) setActiveSessionId(orderedSessions[0].id);
    if (activeSessionId && !sessionsQuery.isLoading && !orderedSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(orderedSessions[0]?.id ?? '');
    }
  }, [routeDraftId, routeSessionId, activeSessionId, orderedSessions, sessionsQuery.isLoading, sessionsQuery.isError]);

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
        setIncomingGoalDraft(null);
        setGoalDraftAttached(null);
        setLocation(`/general-chat?sessionId=${encodeURIComponent(session.id)}`, { replace: true });
        void queryClient.invalidateQueries({ queryKey: getListGeneralChatSessionsQueryKey() });
      },
      onError: () => setActionError('تعذر تأكيد إنشاء محادثة جديدة. لم نغيّر قائمة محادثاتك السابقة في هذا العرض.'),
    });
  };

  const handleContinueHomeDraft = () => {
    if (!incomingGoalDraft || createSession.isPending) return;
    setActionError('');
    createSession.mutate(undefined, {
      onSuccess: (session) => {
        queryClient.setQueryData(
          getListGeneralChatSessionsQueryKey(),
          (old: typeof sessions | undefined) => [session, ...(old ?? []).filter((item) => item.id !== session.id)],
        );
        setActiveSessionId(session.id);
        setDraft(incomingGoalDraft.text);
        setGoalDraftAttached(incomingGoalDraft);
        setIncomingGoalDraft(null);
        setLocation(`/general-chat?sessionId=${encodeURIComponent(session.id)}&goalDraftId=${encodeURIComponent(incomingGoalDraft.id)}`, { replace: true });
        void queryClient.invalidateQueries({ queryKey: getListGeneralChatSessionsQueryKey() });
      },
      onError: () => setActionError('تعذر إنشاء محادثة جديدة. بقي الهدف محفوظًا كمسودة ولم يُرسل.'),
    });
  };

  const handleDelete = (sessionId: string) => {
    const session = orderedSessions.find((item) => item.id === sessionId);
    if (!session || !window.confirm(`حذف «${session.title}» ورسائلها نهائيًا؟ لا يمكن التراجع عن ذلك.`)) return;
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
      onError: () => setActionError('تعذر تأكيد حذف المحادثة. حدّث القائمة لمعرفة حالتها الحالية.'),
    });
  };

  const handleSend = () => {
    const message = draft.trim();
    const sessionId = activeSessionId;
    if (!message || !sessionId || sendMessage.isPending || hasPendingReply) return;
    if (goalDraftAttached) {
      if (!user?.id || !updateGoalDraft(user.id, goalDraftAttached.id, { sendAttemptedAt: Date.now() })) {
        setActionError('تعذر تسجيل محاولة الإرسال للمسودة. لم نرسل النص؛ احتفظ به وحاول مرة أخرى.');
        return;
      }
      setGoalDraftAttached(null);
      setLocation(`/general-chat?sessionId=${encodeURIComponent(sessionId)}`, { replace: true });
    }
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
          setActionError('تعذر تأكيد قبول الرسالة. أعدنا نصها إلى المسودة؛ راجع حالة المحادثة قبل إعادة الإرسال.'),
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
              <h1 dir="rtl" lang="ar" className="truncate text-lg font-semibold tracking-tight">محادثة عامة</h1>
              <span lang="ar" className="hidden rounded border border-border bg-background/70 px-2 py-0.5 text-[9px] text-muted-foreground sm:inline">خارج نطاق المشاريع</span>
            </div>
            <p dir="rtl" lang="ar" className="mt-0.5 text-xs text-muted-foreground">محادثات محفوظة للأسئلة العامة، منفصلة عن العمل داخل مشاريعك.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AssistantScopeSwitch currentScope="general" hasUnsentMessage={Boolean(draft.trim())} />
          <button
            type="button"
            onClick={handleCreate}
            disabled={createSession.isPending || Boolean(incomingGoalDraft) || Boolean(goalDraftAttached)}
            data-testid="button-create-general-chat"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {createSession.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CirclePlus className="h-4 w-4" />}
            محادثة جديدة
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label="المحادثات المحفوظة" className="flex max-h-52 flex-col border-b border-border bg-background/35 md:max-h-none md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-4 py-3">
            <span lang="ar" className="text-[10px] text-muted-foreground">المحادثات المحفوظة</span>
            <span className="font-mono text-[10px] text-muted-foreground">{sessions.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {sessionsQuery.isLoading ? (
              <div className="space-y-2 p-2" aria-label="جارٍ تحميل المحادثات">
                {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg border border-border/70 bg-secondary/35" />)}
              </div>
            ) : sessionsQuery.isError ? (
              <div dir="rtl" lang="ar" role="alert" className="m-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-muted-foreground">
                <p>تعذر تحميل المحادثات المحفوظة.</p>
                <button type="button" onClick={() => void sessionsQuery.refetch()} data-testid="button-retry-general-sessions" className="mt-2 inline-flex items-center gap-1.5 font-medium text-foreground"><RefreshCw className="h-3 w-3" /> إعادة المحاولة</button>
              </div>
            ) : orderedSessions.length === 0 ? (
              <div dir="rtl" lang="ar" role="status" className="m-2 rounded-lg border border-dashed border-border px-3 py-5 text-center">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground"><MessageSquareText className="h-4 w-4" /></div>
                <p className="text-xs font-medium">لا توجد محادثات في القائمة بعد</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">أنشئ محادثة لبدء نقاش محفوظ، منفصل عن مشاريعك.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {orderedSessions.map((session) => (
                  <div key={session.id} className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${activeSessionId === session.id ? 'border-primary/30 bg-primary/8' : 'border-transparent hover:border-border hover:bg-secondary/45'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSessionId(session.id);
                        setActionError('');
                        setLocation(`/general-chat?sessionId=${encodeURIComponent(session.id)}`, { replace: true });
                      }}
                      disabled={Boolean(goalDraftAttached) || Boolean(incomingGoalDraft)}
                      data-testid={`button-select-general-session-${session.id}`}
                      aria-current={activeSessionId === session.id ? 'true' : undefined}
                      className="min-w-0 flex-1 px-1.5 py-1 text-left"
                    >
                      <span dir="auto" className="block truncate text-xs font-medium">{session.title || 'محادثة بلا عنوان'}</span>
                      <span className="mt-1 block font-mono text-[9px] text-muted-foreground">{new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(session.id)}
                      disabled={deleteSession.isPending || Boolean(goalDraftAttached) || Boolean(incomingGoalDraft)}
                       aria-label={`حذف المحادثة: ${session.title || 'محادثة بلا عنوان'}`}
                      data-testid={`button-delete-general-session-${session.id}`}
                      className="rounded p-1.5 text-muted-foreground opacity-100 transition hover:bg-destructive/10 hover:text-destructive md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {pendingDraftStorageError && (
              <p role="alert" className="m-2 rounded-lg border border-destructive/25 p-2 text-[11px] text-muted-foreground">
                تعذر قراءة بعض المسودات المحفوظة لهذا التبويب.
              </p>
            )}
            {resumableGeneralDrafts.length > 0 && (
              <section dir="rtl" lang="ar" aria-label="مسودات عامة غير مرسلة" data-testid="section-pending-general-drafts" className="mt-3 border-t border-border px-2 pt-3">
                <h2 className="px-1 text-[10px] font-medium text-muted-foreground">
                  مسودات عامة غير مرسلة ({resumableGeneralDrafts.length})
                </h2>
                <ul className="mt-2 space-y-2">
                  {resumableGeneralDrafts.map((item) => (
                    <li key={item.id} className="rounded-lg border border-border/70 bg-background/45 p-2">
                      <p dir="auto" className="line-clamp-3 whitespace-pre-wrap break-words text-[11px] leading-5">{item.text}</p>
                      <button
                        type="button"
                        disabled={Boolean(draft.trim()) || Boolean(goalDraftAttached) || Boolean(incomingGoalDraft)}
                        onClick={() => {
                          setActiveSessionId('');
                          setDraft('');
                          setIncomingGoalDraft(null);
                          setGoalDraftResolved(false);
                          setGoalDraftError('');
                          setLocation(`/general-chat?goalDraftId=${encodeURIComponent(item.id)}`, { replace: true });
                        }}
                        data-testid={`button-resume-general-goal-${item.id}`}
                        className="mt-2 text-[11px] font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        متابعة هذه المسودة
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>

        <section className="flex min-h-[430px] min-w-0 flex-col md:min-h-0" aria-label="المحادثة العامة">
          {routeDraftId && routeSessionId && !goalDraftResolved ? (
            <div dir="rtl" lang="ar" role="status" className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              نتحقق من المحادثة ونستعيد المسودة المحفوظة قبل إتاحتها للإرسال.
            </div>
          ) : incomingGoalDraft ? (
            <div dir="rtl" lang="ar" className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <div className="max-w-lg rounded-2xl border border-primary/25 bg-primary/5 p-6 text-right">
                <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4 text-primary" /> هدف محفوظ — لم يُرسل</div>
                <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-background/60 p-3 text-sm leading-6">{incomingGoalDraft.text}</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">هذه محادثة نصية مستقلة. لا يمكنها قراءة ملفات المشاريع أو استخدام أدواتها. اختر إنشاء محادثة جديدة لإضافة الهدف إلى خانة الكتابة فقط؛ لن يُرسل تلقائيًا.</p>
                <button type="button" onClick={handleContinueHomeDraft} disabled={createSession.isPending} data-testid="button-continue-home-goal-new-chat" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {createSession.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CirclePlus className="h-4 w-4" />}
                  متابعة في محادثة جديدة
                </button>
              </div>
            </div>
          ) : activeSession ? (
            <>
              <div className="flex min-w-0 items-center gap-2 border-b border-border/70 px-5 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{activeSession.title}</h2>
                <span lang="ar" className="hidden text-[9px] text-muted-foreground sm:inline">محادثة محفوظة لحسابك</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
                {messagesQuery.isLoading ? (
                  <div className="mx-auto max-w-2xl space-y-4" aria-label="جارٍ تحميل الرسائل">
                    {[0, 1].map((item) => <div key={item} className={`h-20 animate-pulse rounded-xl border border-border bg-secondary/30 ${item ? 'ml-auto w-3/4' : 'w-4/5'}`} />)}
                  </div>
                ) : messagesQuery.isError ? (
                  <div dir="rtl" lang="ar" role="alert" className="mx-auto mt-8 max-w-md rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 text-center">
                    <AlertTriangle className="mx-auto h-5 w-5 text-amber-300" />
                    <p className="mt-2 text-sm font-medium">الرسائل غير متاحة الآن</p>
                    <p className="mt-1 text-xs text-muted-foreground">تعذر تحميل رسائل هذه المحادثة؛ هذا لا يعني حذفها. أعد تحميلها لمعرفة حالتها.</p>
                    <button type="button" onClick={() => void messagesQuery.refetch()} data-testid="button-retry-general-messages" className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"><RefreshCw className="h-3 w-3" /> إعادة المحاولة</button>
                  </div>
                ) : messages.length === 0 ? (
                  <div dir="rtl" lang="ar" role="status" className="mx-auto mt-12 max-w-md text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-secondary/55 text-primary"><Bot className="h-5 w-5" /></div>
                    <h3 className="mt-4 text-base font-semibold">ابدأ برسالتك الأولى</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">ناقش سؤالًا أو فكرة أو قارن بين خيارات. هذه المحادثة منفصلة عن مساحة المشروع وملفاته وأدواته.</p>
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
                            <span>{message.role === 'user' ? 'أنت' : 'EngineeringOS'}</span>
                            {message.status === 'pending' && <span className="inline-flex items-center gap-1 text-primary"><Activity className="h-3 w-3 animate-pulse" /> جارٍ إعداد الرد</span>}
                            {message.status === 'failed' && <span lang="ar" className="text-amber-300">لم يكتمل الرد</span>}
                          </div>
                          <p dir="auto" className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
                          {message.status === 'failed' && <p dir="auto" className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">{message.errorMessage || 'لم يكتمل هذا الرد. راجع ما سُجّل، ويمكنك إرسال رسالة متابعة عندما تكون جاهزًا.'}</p>}
                        </div>
                      </article>
                    ))}
                    <div aria-live="polite" className="sr-only">{hasPendingReply ? 'المساعد يعد ردًا الآن.' : ''}</div>
                  </div>
                )}
              </div>
              <div className="border-t border-border bg-background/40 px-4 py-4 sm:px-8">
                {actionError && <div role="alert" data-testid="status-general-chat-error" className="mx-auto mb-3 max-w-3xl rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">{actionError}</div>}
                <div className="mx-auto max-w-3xl">
                  <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                    <textarea
                      value={draft}
                      onChange={(event) => {
                        const nextDraft = event.target.value.slice(0, goalDraftAttached ? 2_000 : 12_000);
                        setDraft(nextDraft);
                        if (goalDraftAttached && user?.id) {
                          const updated = updateGoalDraft(user.id, goalDraftAttached.id, { text: nextDraft });
                          if (updated) setGoalDraftAttached(updated);
                          else setActionError('تعذر حفظ تعديل المسودة؛ بقي النص في خانة الكتابة.');
                        }
                      }}
                      onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }}
                      maxLength={goalDraftAttached ? 2_000 : 12_000}
                      rows={2}
                      placeholder={hasPendingReply ? 'بانتظار اكتمال رد المساعد…' : 'اكتب سؤالًا أو فكرة لمناقشتها…'}
                      aria-label="رسالتك إلى المساعد"
                      dir="auto"
                      data-testid="input-general-chat-message"
                      className="max-h-40 min-h-11 min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/65"
                    />
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={!draft.trim() || sendMessage.isPending || hasPendingReply}
                      data-testid="button-send-general-message"
                      aria-label="إرسال الرسالة"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sendMessage.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                    <span dir="rtl" lang="ar" className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-primary" /> محادثة مستقلة؛ ملفات المشاريع وأدواتها خارج نطاقها.</span>
                    <span className="shrink-0 font-mono">{draft.length}/12000</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div dir="rtl" lang="ar" className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-secondary/50 text-muted-foreground"><MessageSquareText className="h-6 w-6" /></div>
              <h2 className="mt-4 text-base font-semibold">{!goalDraftResolved ? 'جارٍ استعادة المسودة المحفوظة' : goalDraftError ? 'تعذر استعادة المسودة' : sessionsQuery.isLoading ? 'جارٍ تحميل المحادثات المحفوظة' : sessionsQuery.isError ? 'تعذر عرض المحادثات' : 'ابدأ محادثة عامة'}</h2>
              <p role={goalDraftError ? 'alert' : undefined} className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{goalDraftError || (!goalDraftResolved ? 'نراجع المسودة المحفوظة لهذا الحساب.' : sessionsQuery.isLoading ? 'نحمّل قائمة محادثاتك.' : sessionsQuery.isError ? 'فشل تحميل القائمة لا يعني أنها فارغة. أعد المحاولة من قائمة المحادثات.' : 'أنشئ نقاشًا مستقلًا. سيبقى منفصلًا عن العمل في مشاريعك.')}</p>
              {!sessionsQuery.isLoading && !sessionsQuery.isError && goalDraftResolved && (
                <button type="button" onClick={handleCreate} disabled={createSession.isPending} data-testid="button-create-first-general-chat" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> إنشاء محادثة
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
