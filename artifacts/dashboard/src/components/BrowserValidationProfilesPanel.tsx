import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListBrowserValidationProfilesQueryKey,
  useDeleteBrowserValidationProfile,
  useListBrowserValidationProfiles,
  useUpsertBrowserValidationProfile,
  type BrowserValidationProfile,
  type BrowserValidationProfileInput,
  type BrowserValidationStep,
} from '@workspace/api-client-react';
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';

type StepType = BrowserValidationStep['type'];
type ProfileDraft = {
  name: string;
  steps: BrowserValidationStep[];
  timeoutMs: number;
};

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const MAX_STEPS = 24;
const MAX_TIMEOUT_MS = 60_000;

function createStep(type: StepType): BrowserValidationStep {
  switch (type) {
    case 'navigate':
      return { type, path: '/' };
    case 'assert_visible':
      return { type, selector: 'body' };
    case 'assert_text':
      return { type, selector: 'body', text: '' };
    case 'read_visible_text':
      return { type };
    case 'screenshot':
      return { type, name: 'check' };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

function validateDraft(draft: ProfileDraft): string | null {
  if (!PROFILE_NAME_PATTERN.test(draft.name)) {
    return 'اكتب اسمًا من 1 إلى 80 حرفًا أو رقمًا أو نقطة أو شرطة سفلية أو واصلة، على أن يبدأ بحرف أو رقم.';
  }
  if (!Number.isInteger(draft.timeoutMs) || draft.timeoutMs < 1 || draft.timeoutMs > MAX_TIMEOUT_MS) {
    return 'يجب أن تكون المهلة عددًا صحيحًا بين 1 و60,000 مللي ثانية.';
  }
  if (draft.steps.length < 1 || draft.steps.length > MAX_STEPS) {
    return `أضف من خطوة واحدة إلى ${MAX_STEPS} خطوة.`;
  }
  for (const [index, step] of draft.steps.entries()) {
    const stepNumber = index + 1;
    if (step.type === 'navigate' && (!/^\/(?!\/)/.test(step.path.trim()) || step.path.trim().length > 500)) {
      return `الخطوة ${stepNumber}: استخدم مسارًا نسبيًا يبدأ بشرطة مائلة واحدة (/).`;
    }
    if ('selector' in step && step.selector !== undefined &&
      (!step.selector.trim() || step.selector.trim().length > 240)) {
      return `الخطوة ${stepNumber}: أدخل محددًا من 1 إلى 240 حرفًا.`;
    }
    if (step.type === 'assert_visible' && !step.selector.trim()) {
      return `الخطوة ${stepNumber}: أدخل محددًا.`;
    }
    if (step.type === 'assert_text' && (!step.text.trim() || step.text.length > 500)) {
      return `الخطوة ${stepNumber}: أدخل نصًا من 1 إلى 500 حرف للتحقق منه.`;
    }
    if (step.type === 'screenshot' && (!step.name.trim() || step.name.trim().length > 80)) {
      return `الخطوة ${stepNumber}: أدخل اسمًا للصورة من 1 إلى 80 حرفًا.`;
    }
  }
  return null;
}

function normalizeSteps(steps: BrowserValidationStep[]): BrowserValidationStep[] {
  return steps.map((step) => {
    if (step.type === 'navigate') return { ...step, path: step.path.trim() };
    if (step.type === 'assert_visible') return { ...step, selector: step.selector.trim() };
    if (step.type === 'assert_text') return { ...step, selector: step.selector.trim() };
    if (step.type === 'read_visible_text') {
      const selector = step.selector?.trim();
      return selector ? { type: step.type, selector } : { type: step.type };
    }
    return { ...step, name: step.name.trim() };
  });
}

function stepSummary(step: BrowserValidationStep): ReactNode {
  switch (step.type) {
    case 'navigate': return <>فتح المسار <bdi dir="ltr">{step.path}</bdi></>;
    case 'assert_visible': return <>التحقق من ظهور العنصر <bdi dir="ltr">{step.selector}</bdi></>;
    case 'assert_text': return <>التحقق من وجود النص داخل <bdi dir="ltr">{step.selector}</bdi></>;
    case 'read_visible_text': return step.selector
      ? <>قراءة النص الظاهر داخل <bdi dir="ltr">{step.selector}</bdi></>
      : 'قراءة النص الظاهر في الصفحة';
    case 'screenshot': return <>التقاط صورة باسم <bdi dir="ltr">{step.name}</bdi></>;
  }
}

export default function BrowserValidationProfilesPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const profilesQuery = useListBrowserValidationProfiles(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: getListBrowserValidationProfilesQueryKey(projectId),
      staleTime: 15_000,
    },
  });
  const upsertProfile = useUpsertBrowserValidationProfile();
  const deleteProfile = useDeleteBrowserValidationProfile();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BrowserValidationProfile | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const profiles = profilesQuery.data ?? [];
  const closeEditor = () => {
    if (upsertProfile.isPending) return;
    setDraft(null);
    setEditingName(null);
    setFormError('');
  };
  const openNewProfile = () => {
    setFeedback('');
    setFormError('');
    setEditingName(null);
    setDraft({
      name: '',
      steps: [createStep('navigate')],
      timeoutMs: MAX_TIMEOUT_MS,
    });
  };
  const openProfileEditor = (profile: BrowserValidationProfile) => {
    setFeedback('');
    setFormError('');
    setEditingName(profile.name);
    setDraft({
      name: profile.name,
      steps: profile.steps.map((step) => ({ ...step })) as BrowserValidationStep[],
      timeoutMs: profile.timeoutMs,
    });
  };
  const replaceStep = (index: number, step: BrowserValidationStep) => {
    setDraft((current) => current
      ? { ...current, steps: current.steps.map((item, itemIndex) => itemIndex === index ? step : item) }
      : current);
  };
  const submitDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const validationError = validateDraft(draft);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError('');
    const data: BrowserValidationProfileInput = {
      steps: normalizeSteps(draft.steps),
      timeoutMs: draft.timeoutMs,
    };
    upsertProfile.mutate(
      { projectId, name: draft.name.trim(), data },
      {
        onSuccess: (saved) => {
          setDraft(null);
          setEditingName(null);
          setFeedback('تم حفظ إعداد الفحص.');
          void queryClient.invalidateQueries({
            queryKey: getListBrowserValidationProfilesQueryKey(projectId),
          });
        },
        onError: (error) => {
          setFormError(errorMessage(error, 'تعذّر حفظ إعداد الفحص.'));
        },
      },
    );
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDeleteError('');
    deleteProfile.mutate(
      { projectId, name: deleteTarget.name },
      {
        onSuccess: () => {
          setFeedback('تم حذف إعداد الفحص.');
          setDeleteTarget(null);
          void queryClient.invalidateQueries({
            queryKey: getListBrowserValidationProfilesQueryKey(projectId),
          });
        },
        onError: (error) => {
          setDeleteError(errorMessage(error, 'تعذّر حذف إعداد الفحص.'));
        },
      },
    );
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="browser-profiles-heading" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="browser-profiles-heading" className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-primary" /> إعدادات فحوص المتصفح
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            حدّد فحوصًا محدودة لمعاينة المشروع المعزولة. الخادم وحده يحدد عنوان المعاينة ومراجعة الملفات التي ستُفحص.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void profilesQuery.refetch()}
            disabled={profilesQuery.isFetching}
            aria-label="تحديث إعدادات فحوص المتصفح"
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${profilesQuery.isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={openNewProfile}
            data-testid="button-add-browser-profile"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> إضافة فحص
          </button>
        </div>
      </div>

      {feedback ? <p role="status" className="mb-3 text-xs text-emerald-400">{feedback}</p> : null}
      {profilesQuery.isLoading ? (
        <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل الفحوص…
        </div>
      ) : profilesQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span dir="auto">{errorMessage(profilesQuery.error, 'إعدادات فحوص المتصفح غير متاحة.')}</span>
          <button type="button" onClick={() => void profilesQuery.refetch()} className="mr-2 underline">إعادة المحاولة</button>
        </div>
      ) : profiles.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          لا توجد فحوص متصفح مسجّلة. أضف إعدادًا لفحص المعاينة بطريقة آمنة وقابلة للتكرار.
        </p>
      ) : (
        <div className="space-y-2" data-testid="browser-profile-list">
          {profiles.map((profile) => {
            const fresh = profile.freshnessStatus === 'fresh';
            return (
              <article key={profile.id} className="rounded-md border border-border/70 bg-secondary/20 px-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-mono text-sm font-semibold" dir="ltr">{profile.name}</h3>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${fresh ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-300'}`}>
                        {fresh ? 'مطابق لمراجعة الملفات الحالية' : 'يخص مراجعة أقدم'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      <bdi dir="ltr">{profile.steps.length}</bdi> خطوات · مهلة <bdi dir="ltr">{profile.timeoutMs.toLocaleString()} ms</bdi> · آخر تحديث {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(profile.updatedAt))}
                    </p>
                    <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {profile.steps.map((step, index) => <li key={`${profile.id}-${index}`}><bdi dir="ltr">{index + 1}.</bdi> {stepSummary(step)}</li>)}
                    </ol>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => openProfileEditor(profile)}
                      aria-label={`تعديل إعداد الفحص ${profile.name}`}
                      className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError('');
                        setDeleteTarget(profile);
                      }}
                      aria-label={`حذف إعداد الفحص ${profile.name}`}
                      className="rounded-md p-2 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10" role="presentation">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-primary/25 bg-card shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="browser-profile-editor-title">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <p className="font-mono text-[10px] text-primary/80">المشروع / فحوص المتصفح</p>
                <h3 id="browser-profile-editor-title" className="mt-1 text-lg font-semibold">{editingName ? 'تعديل إعداد الفحص' : 'إضافة إعداد فحص'}</h3>
              </div>
              <button type="button" onClick={closeEditor} disabled={upsertProfile.isPending} aria-label="إغلاق محرر فحص المتصفح" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submitDraft}>
              <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
                {formError ? <p role="alert" dir="auto" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{formError}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="browser-profile-name" className="mb-1.5 block text-xs font-semibold text-muted-foreground">اسم الإعداد</label>
                    <input
                      id="browser-profile-name"
                      data-testid="input-browser-profile-name"
                      dir="ltr"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                      disabled={Boolean(editingName) || upsertProfile.isPending}
                      required
                      maxLength={80}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}"
                      placeholder="smoke-check"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                    />
                    {editingName ? <p className="mt-1 text-[10px] text-muted-foreground">لا يمكن تغيير اسم الإعداد. أضف إعدادًا جديدًا ثم احذف القديم لإعادة التسمية.</p> : null}
                  </div>
                  <div>
                    <label htmlFor="browser-profile-timeout" className="mb-1.5 block text-xs font-semibold text-muted-foreground">المهلة (مللي ثانية)</label>
                    <input
                      id="browser-profile-timeout"
                      data-testid="input-browser-profile-timeout"
                      type="number"
                      dir="ltr"
                      min={1}
                      max={MAX_TIMEOUT_MS}
                      step={1}
                      value={draft.timeoutMs}
                      onChange={(event) => setDraft((current) => current ? { ...current, timeoutMs: Number(event.target.value) } : current)}
                      disabled={upsertProfile.isPending}
                      required
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">خطوات الفحص</h4>
                      <p className="text-[10px] text-muted-foreground">يقتصر التنقل على المسارات داخل المعاينة المعزولة.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((current) => current && current.steps.length < MAX_STEPS
                        ? { ...current, steps: [...current.steps, createStep('navigate')] }
                        : current)}
                      disabled={draft.steps.length >= MAX_STEPS || upsertProfile.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" /> إضافة خطوة
                    </button>
                  </div>
                  {draft.steps.map((step, index) => (
                    <div key={index} className="rounded-lg border border-border bg-secondary/20 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor={`browser-step-type-${index}`} className="text-xs font-semibold">الخطوة <bdi dir="ltr">{index + 1}</bdi></label>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => current && current.steps.length > 1
                            ? { ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }
                            : current)}
                          disabled={draft.steps.length <= 1 || upsertProfile.isPending}
                          aria-label={`حذف الخطوة ${index + 1}`}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <select
                          id={`browser-step-type-${index}`}
                          aria-label={`نوع الخطوة ${index + 1}`}
                          value={step.type}
                          onChange={(event) => replaceStep(index, createStep(event.target.value as StepType))}
                          disabled={upsertProfile.isPending}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        >
                          <option value="navigate">فتح مسار في المعاينة</option>
                          <option value="assert_visible">التحقق من ظهور عنصر</option>
                          <option value="assert_text">التحقق من نص داخل عنصر</option>
                          <option value="read_visible_text">قراءة النص الظاهر في الصفحة</option>
                          <option value="screenshot">التقاط صورة للمعاينة</option>
                        </select>
                        {step.type === 'navigate' ? (
                          <div>
                            <label htmlFor={`browser-step-path-${index}`} className="mb-1 block text-[10px] text-muted-foreground">مسار داخل المعاينة</label>
                            <input
                              id={`browser-step-path-${index}`}
                              aria-label={`مسار الخطوة ${index + 1}`}
                              dir="ltr"
                              value={step.path}
                              onChange={(event) => replaceStep(index, { ...step, path: event.target.value })}
                              maxLength={500}
                              required
                              placeholder="/"
                              disabled={upsertProfile.isPending}
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>
                        ) : null}
                        {step.type === 'assert_visible' || step.type === 'assert_text' || step.type === 'read_visible_text' ? (
                          <div>
                            <label htmlFor={`browser-step-selector-${index}`} className="mb-1 block text-[10px] text-muted-foreground">محدد CSS {step.type === 'read_visible_text' ? '(اختياري)' : ''}</label>
                            <input
                              id={`browser-step-selector-${index}`}
                              aria-label={`محدد CSS للخطوة ${index + 1}`}
                              dir="ltr"
                              value={step.selector ?? ''}
                              onChange={(event) => {
                                if (step.type === 'assert_visible' || step.type === 'assert_text') {
                                  replaceStep(index, { ...step, selector: event.target.value });
                                } else {
                                  replaceStep(index, { ...step, selector: event.target.value || undefined });
                                }
                              }}
                              maxLength={240}
                              required={step.type !== 'read_visible_text'}
                              placeholder="body"
                              disabled={upsertProfile.isPending}
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>
                        ) : null}
                        {step.type === 'assert_text' ? (
                          <div>
                            <label htmlFor={`browser-step-text-${index}`} className="mb-1 block text-[10px] text-muted-foreground">النص المطلوب التحقق منه</label>
                            <input
                              id={`browser-step-text-${index}`}
                              aria-label={`النص المطلوب في الخطوة ${index + 1}`}
                              dir="auto"
                              value={step.text}
                              onChange={(event) => replaceStep(index, { ...step, text: event.target.value })}
                              maxLength={500}
                              required
                              disabled={upsertProfile.isPending}
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>
                        ) : null}
                        {step.type === 'screenshot' ? (
                          <div>
                            <label htmlFor={`browser-step-screenshot-${index}`} className="mb-1 block text-[10px] text-muted-foreground">اسم الصورة</label>
                            <input
                              id={`browser-step-screenshot-${index}`}
                              aria-label={`اسم الصورة للخطوة ${index + 1}`}
                              dir="ltr"
                              value={step.name}
                              onChange={(event) => replaceStep(index, { ...step, name: event.target.value })}
                              maxLength={80}
                              required
                              disabled={upsertProfile.isPending}
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  يتحقق الخادم من المحددات. لا يمكن لهذه الإعدادات تشغيل أوامر عشوائية أو الوصول إلى مواقع خارج المعاينة المعزولة.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeEditor} disabled={upsertProfile.isPending} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">إلغاء</button>
                <button type="submit" disabled={upsertProfile.isPending} data-testid="button-save-browser-profile" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                  {upsertProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {upsertProfile.isPending ? 'جارٍ الحفظ…' : 'حفظ الإعداد'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-3 py-6 backdrop-blur-sm" role="presentation">
          <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card shadow-2xl" role="alertdialog" aria-modal="true" aria-labelledby="browser-profile-delete-title" aria-describedby="browser-profile-delete-description">
            <div className="space-y-3 px-5 py-5">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <h3 id="browser-profile-delete-title" className="text-lg font-semibold">هل تريد حذف إعداد الفحص؟</h3>
              </div>
              <p id="browser-profile-delete-description" className="text-sm text-muted-foreground">
                لن يتاح الإعداد <bdi dir="ltr">{deleteTarget.name}</bdi> لفحوص المتصفح الجديدة. لا يمكن التراجع عن هذا الحذف.
              </p>
              {deleteError ? <p role="alert" dir="auto" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{deleteError}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteProfile.isPending} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">إلغاء</button>
              <button type="button" onClick={confirmDelete} disabled={deleteProfile.isPending} data-testid="button-confirm-delete-browser-profile" className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60">
                {deleteProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {deleteProfile.isPending ? 'جارٍ الحذف…' : 'حذف الإعداد'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}