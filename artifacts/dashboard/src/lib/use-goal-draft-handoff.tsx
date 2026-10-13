import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { readGoalDrafts, removeGoalDraft, storeGoalDraft, updateGoalDraft, type GoalDraft } from './home-goal-handoff';

export function useGoalDraftHandoff({
  ownerId, routeProjectId, routeDraftId, selectedProjectId, input, setInput,
}: {
  ownerId: string | null;
  routeProjectId?: string;
  routeDraftId: string | null;
  selectedProjectId?: string;
  input: string;
  setInput: (value: string) => void;
}) {
  const [state, setState] = useState<{ ownerId: string | null; drafts: GoalDraft[]; activeId: string | null }>({
    ownerId: null, drafts: [], activeId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmedProjectId, setConfirmedProjectId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const lastOwner = useRef<string | null>(null);
  const hydratedDraft = useRef<{ ownerId: string | null; id: string | null }>({ ownerId: null, id: null });
  const drafts = state.ownerId === ownerId ? state.drafts : [];
  const activeDraft = drafts.find((draft) => draft.id === state.activeId) ?? null;
  const pendingDrafts = drafts.filter((draft) => draft.id !== activeDraft?.id && draft.text.trim());
  const needsProjectConfirmation = Boolean(activeDraft && confirmedProjectId !== selectedProjectId);

  useEffect(() => setConfirmedProjectId(null), [selectedProjectId]);

  useLayoutEffect(() => {
    const accountChanged = lastOwner.current !== null && lastOwner.current !== ownerId;
    lastOwner.current = ownerId;
    if (accountChanged) {
      setInput('');
      inputRef.current = '';
    }
    setConfirmedProjectId(null);
    setReplacementId(null);
    const snapshot = readGoalDrafts(ownerId);
    setError(snapshot.error);
    let candidate: GoalDraft | undefined;
    const eligible = snapshot.drafts.filter((draft) =>
      draft.text.trim() && draft.sendAttemptedAt === null
      && !(draft.bootstrap && !draft.projectId)
      && (!routeProjectId || !draft.projectId || draft.projectId === routeProjectId));
    if (routeDraftId) {
      candidate = eligible.find((draft) => draft.id === routeDraftId);
      if (!candidate) setError('المسودة المطلوبة غير متاحة لهذا الحساب أو لهذا المشروع، أو انتهت صلاحيتها. لم نستخدم بديلًا تلقائيًا.');
    } else if (eligible.length === 1) {
      candidate = eligible[0];
    }
    const toActivate = candidate && (
      !inputRef.current.trim()
      || (hydratedDraft.current.ownerId === ownerId && hydratedDraft.current.id === candidate.id
        && inputRef.current === candidate.text)
    ) ? candidate : null;
    hydratedDraft.current = { ownerId, id: toActivate?.id ?? null };
    setState({ ownerId, drafts: snapshot.drafts, activeId: toActivate?.id ?? null });
    if (toActivate) setInput(toActivate.text);
    // Input edits must not replay hydration or silently replace a composer.
  }, [ownerId, routeDraftId, routeProjectId, setInput]);

  function refresh(activeId = state.activeId) {
    const snapshot = readGoalDrafts(ownerId);
    setState({ ownerId, drafts: snapshot.drafts, activeId });
    setError(snapshot.error);
  }

  function activate(id: string, preserveInput = false) {
    const snapshot = readGoalDrafts(ownerId);
    const draft = snapshot.drafts.find((entry) => entry.id === id);
    if (!ownerId || !draft || (draft.bootstrap && !draft.projectId)) return;
    if (input.trim() && input.trim() !== draft.text.trim()) {
      if (!preserveInput) {
        setReplacementId(id);
        return;
      }
      // Existing active drafts have already been persisted while editing.
      if (!activeDraft && !storeGoalDraft(ownerId, input, 'home', selectedProjectId ?? null)) {
        setError('تعذر حفظ النص الحالي. لم نستبدله؛ انسخه أو أفرغ خانة الإدخال ثم حاول مجددًا.');
        return;
      }
      if (activeDraft && activeDraft.text !== input
        && !updateGoalDraft(ownerId, activeDraft.id, { text: input })) {
        setError('تعذر حفظ تعديل المسودة الحالية؛ لم نستبدل النص.');
        return;
      }
    }
    if (draft.sendAttemptedAt !== null && !updateGoalDraft(ownerId, id, { sendAttemptedAt: null })) {
      setError('تعذر إعادة فتح نسخة الطلب كمسودة؛ لم نستبدل النص.');
      return;
    }
    setInput(draft.text);
    setConfirmedProjectId(null);
    setReplacementId(null);
    refresh(id);
  }

  function edit(text: string) {
    setInput(text);
    if (!activeDraft || !ownerId) return;
    if (!updateGoalDraft(ownerId, activeDraft.id, { text })) {
      setError('تعذر حفظ التعديل. النص ما زال في خانة الإدخال؛ انسخه قبل المغادرة أو حاول مجددًا.');
      return;
    }
    refresh();
  }

  function confirmProject() {
    if (!ownerId || !activeDraft || !selectedProjectId) return;
    if (!updateGoalDraft(ownerId, activeDraft.id, { text: input, projectId: selectedProjectId })) {
      setError('تعذر حفظ نطاق المسودة. لم نؤكد المشروع ولم نرسل الطلب.');
      return;
    }
    setConfirmedProjectId(selectedProjectId);
    refresh();
  }

  function dismiss(id: string) {
    if (!ownerId || !removeGoalDraft(ownerId, id)) {
      setError('تعذر حذف المسودة؛ بقيت النسخة المحفوظة دون تغيير.');
      return;
    }
    if (id === activeDraft?.id) {
      setInput('');
      setConfirmedProjectId(null);
    }
    setReplacementId(null);
    refresh(id === activeDraft?.id ? null : state.activeId);
  }

  function onSend(text: string): boolean {
    if (!activeDraft || !ownerId) return true;
    if (text.trim() === input.trim()
      && !updateGoalDraft(ownerId, activeDraft.id, { text: input, sendAttemptedAt: Date.now() })) {
      setError('تعذر حفظ نص الطلب قبل الإرسال؛ لم نرسله. احتفظ بالنص وحاول مجددًا.');
      return false;
    }
    // Attempted does not mean accepted. Keep a recoverable copy, but never
    // reinsert or retry it automatically on reload.
    setConfirmedProjectId(null);
    refresh(null);
    return true;
  }

  return {
    activeDraft, pendingDrafts, error, needsProjectConfirmation, replacementId,
    isReady: Boolean(ownerId && state.ownerId === ownerId),
    activate, edit, confirmProject, dismiss, onSend,
    cancelReplacement: () => setReplacementId(null),
  };
}

export function GoalDraftNotice({ handoff }: { handoff: ReturnType<typeof useGoalDraftHandoff> }) {
  return (
    <div dir="rtl" className="space-y-2 mb-2">
      {handoff.error && <p role="alert" className="rounded-lg border border-destructive/30 p-2 text-xs">{handoff.error}</p>}
      {handoff.activeDraft && (
        <div role="status" data-testid="status-project-planning-handoff" className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
          <p><strong>مسودة محفوظة لهذا الحساب في هذا التبويب.</strong> تبقى بعد إعادة التحميل لمدة تصل إلى 24 ساعة من إنشائها. لا تُرسل تلقائيًا ولا تمنح موافقة على التعديل.</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => handoff.dismiss(handoff.activeDraft!.id)}>حذف المسودة الحالية</Button>
        </div>
      )}
      {handoff.pendingDrafts.length > 0 && (
        <details className="rounded-lg border border-border p-2" open={!handoff.activeDraft}>
          <summary className="cursor-pointer text-xs font-medium">مسودات أخرى محفوظة ({handoff.pendingDrafts.length}) — اختر ما تريد استخدامه</summary>
          <ul className="mt-2 space-y-2">
            {handoff.pendingDrafts.map((draft) => (
              <li key={draft.id} className="rounded border border-border/60 p-2 text-xs">
                <p className="mb-1">{draft.source === 'home' ? 'هدف الصفحة الرئيسية' : 'وصف المشروع الجديد'}{draft.sendAttemptedAt !== null ? ' — سبق بدء إرساله؛ ليس إثبات قبول' : ''}</p>
                <p className="break-words whitespace-pre-wrap">{draft.text}</p>
                {draft.bootstrap && !draft.projectId
                  ? <Link href={`/projects?create=1&goalDraftId=${encodeURIComponent(draft.id)}`} className="inline-block mt-2 text-primary">متابعة إنشاء المشروع</Link>
                  : <Button type="button" size="sm" variant="ghost" onClick={() => handoff.activate(draft.id)}>استخدم هذه المسودة</Button>}
                {!draft.bootstrap && <Button type="button" size="sm" variant="ghost" onClick={() => handoff.dismiss(draft.id)}>حذف هذه المسودة</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {handoff.replacementId && (
        <div role="alertdialog" aria-label="اختيار المسودة" className="rounded-lg border border-primary/25 p-3 text-xs">
          <p>سيُستبدل النص الظاهر، مع إبقائه كمسودة محفوظة. لن يُرسل أي من النصين.</p>
          <Button type="button" size="sm" onClick={() => handoff.activate(handoff.replacementId!, true)}>احفظ النص الحالي واستخدم المسودة</Button>
          <Button type="button" size="sm" variant="ghost" onClick={handoff.cancelReplacement}>ابقَ على النص الحالي</Button>
        </div>
      )}
    </div>
  );
}
