import { useState, type FormEvent } from 'react';
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
    return 'Use a profile name with 1–80 letters, numbers, dots, underscores, or hyphens; it must start with a letter or number.';
  }
  if (!Number.isInteger(draft.timeoutMs) || draft.timeoutMs < 1 || draft.timeoutMs > MAX_TIMEOUT_MS) {
    return 'Timeout must be a whole number between 1 and 60,000 milliseconds.';
  }
  if (draft.steps.length < 1 || draft.steps.length > MAX_STEPS) {
    return `Add between 1 and ${MAX_STEPS} steps.`;
  }
  for (const [index, step] of draft.steps.entries()) {
    const stepNumber = index + 1;
    if (step.type === 'navigate' && (!/^\/(?!\/)/.test(step.path.trim()) || step.path.trim().length > 500)) {
      return `Step ${stepNumber}: use a relative path beginning with one slash.`;
    }
    if ('selector' in step && step.selector !== undefined &&
      (!step.selector.trim() || step.selector.trim().length > 240)) {
      return `Step ${stepNumber}: enter a selector of 1–240 characters.`;
    }
    if (step.type === 'assert_visible' && !step.selector.trim()) {
      return `Step ${stepNumber}: enter a selector.`;
    }
    if (step.type === 'assert_text' && (!step.text.trim() || step.text.length > 500)) {
      return `Step ${stepNumber}: enter text of 1–500 characters to check.`;
    }
    if (step.type === 'screenshot' && (!step.name.trim() || step.name.trim().length > 80)) {
      return `Step ${stepNumber}: enter a screenshot name of 1–80 characters.`;
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

function stepSummary(step: BrowserValidationStep): string {
  switch (step.type) {
    case 'navigate': return `Open ${step.path}`;
    case 'assert_visible': return `Check visible: ${step.selector}`;
    case 'assert_text': return `Check text in ${step.selector}`;
    case 'read_visible_text': return step.selector ? `Read text in ${step.selector}` : 'Read visible page text';
    case 'screenshot': return `Capture ${step.name}`;
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
          setFeedback(`Profile “${saved.name}” saved.`);
          void queryClient.invalidateQueries({
            queryKey: getListBrowserValidationProfilesQueryKey(projectId),
          });
        },
        onError: (error) => {
          setFormError(errorMessage(error, 'The profile could not be saved.'));
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
          setFeedback(`Profile “${deleteTarget.name}” deleted.`);
          setDeleteTarget(null);
          void queryClient.invalidateQueries({
            queryKey: getListBrowserValidationProfilesQueryKey(projectId),
          });
        },
        onError: (error) => {
          setDeleteError(errorMessage(error, 'The profile could not be deleted.'));
        },
      },
    );
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="browser-profiles-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="browser-profiles-heading" className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-primary" /> Browser validation profiles
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Define bounded browser checks for the isolated project preview. The server controls the preview origin and revision.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void profilesQuery.refetch()}
            disabled={profilesQuery.isFetching}
            aria-label="Refresh browser validation profiles"
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
            <Plus className="h-3.5 w-3.5" /> Add profile
          </button>
        </div>
      </div>

      {feedback ? <p role="status" className="mb-3 text-xs text-emerald-400">{feedback}</p> : null}
      {profilesQuery.isLoading ? (
        <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
        </div>
      ) : profilesQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {errorMessage(profilesQuery.error, 'Browser validation profiles are unavailable.')}
          <button type="button" onClick={() => void profilesQuery.refetch()} className="ml-2 underline">Retry</button>
        </div>
      ) : profiles.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          No registered browser checks. Add a profile to define a safe, repeatable preview check.
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
                      <h3 className="font-mono text-sm font-semibold">{profile.name}</h3>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium ${fresh ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-300'}`}>
                        {fresh ? 'Fresh for current revision' : 'Stale revision'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {profile.steps.length} steps · {profile.timeoutMs.toLocaleString()} ms timeout · Updated {new Date(profile.updatedAt).toLocaleString()}
                    </p>
                    <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {profile.steps.map((step, index) => <li key={`${profile.id}-${index}`}>{index + 1}. {stepSummary(step)}</li>)}
                    </ol>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => openProfileEditor(profile)}
                      aria-label={`Edit browser profile ${profile.name}`}
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
                      aria-label={`Delete browser profile ${profile.name}`}
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
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/80">Project / browser checks</p>
                <h3 id="browser-profile-editor-title" className="mt-1 text-lg font-semibold">{editingName ? 'Edit browser profile' : 'Add browser profile'}</h3>
              </div>
              <button type="button" onClick={closeEditor} disabled={upsertProfile.isPending} aria-label="Close browser profile editor" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submitDraft}>
              <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5">
                {formError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{formError}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="browser-profile-name" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Profile name</label>
                    <input
                      id="browser-profile-name"
                      data-testid="input-browser-profile-name"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)}
                      disabled={Boolean(editingName) || upsertProfile.isPending}
                      required
                      maxLength={80}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}"
                      placeholder="smoke-check"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                    />
                    {editingName ? <p className="mt-1 text-[10px] text-muted-foreground">Profile names cannot be changed. Add a new profile and delete this one to rename it.</p> : null}
                  </div>
                  <div>
                    <label htmlFor="browser-profile-timeout" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Timeout (milliseconds)</label>
                    <input
                      id="browser-profile-timeout"
                      data-testid="input-browser-profile-timeout"
                      type="number"
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
                      <h4 className="text-sm font-semibold">Check steps</h4>
                      <p className="text-[10px] text-muted-foreground">Navigation is restricted to paths inside the isolated preview.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((current) => current && current.steps.length < MAX_STEPS
                        ? { ...current, steps: [...current.steps, createStep('navigate')] }
                        : current)}
                      disabled={draft.steps.length >= MAX_STEPS || upsertProfile.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" /> Add step
                    </button>
                  </div>
                  {draft.steps.map((step, index) => (
                    <div key={index} className="rounded-lg border border-border bg-secondary/20 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor={`browser-step-type-${index}`} className="text-xs font-semibold">Step {index + 1}</label>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => current && current.steps.length > 1
                            ? { ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }
                            : current)}
                          disabled={draft.steps.length <= 1 || upsertProfile.isPending}
                          aria-label={`Remove step ${index + 1}`}
                          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <select
                          id={`browser-step-type-${index}`}
                          aria-label={`Step ${index + 1} type`}
                          value={step.type}
                          onChange={(event) => replaceStep(index, createStep(event.target.value as StepType))}
                          disabled={upsertProfile.isPending}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        >
                          <option value="navigate">Navigate to a preview path</option>
                          <option value="assert_visible">Check that an element is visible</option>
                          <option value="assert_text">Check text in an element</option>
                          <option value="read_visible_text">Read visible page text</option>
                          <option value="screenshot">Capture a screenshot</option>
                        </select>
                        {step.type === 'navigate' ? (
                          <div>
                            <label htmlFor={`browser-step-path-${index}`} className="mb-1 block text-[10px] text-muted-foreground">Relative path</label>
                            <input
                              id={`browser-step-path-${index}`}
                              aria-label={`Step ${index + 1} path`}
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
                            <label htmlFor={`browser-step-selector-${index}`} className="mb-1 block text-[10px] text-muted-foreground">CSS selector {step.type === 'read_visible_text' ? '(optional)' : ''}</label>
                            <input
                              id={`browser-step-selector-${index}`}
                              aria-label={`Step ${index + 1} CSS selector`}
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
                            <label htmlFor={`browser-step-text-${index}`} className="mb-1 block text-[10px] text-muted-foreground">Text to find</label>
                            <input
                              id={`browser-step-text-${index}`}
                              aria-label={`Step ${index + 1} text to find`}
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
                            <label htmlFor={`browser-step-screenshot-${index}`} className="mb-1 block text-[10px] text-muted-foreground">Screenshot name</label>
                            <input
                              id={`browser-step-screenshot-${index}`}
                              aria-label={`Step ${index + 1} screenshot name`}
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
                  Selectors are validated by the server. Profiles cannot run arbitrary commands or access origins outside the isolated preview.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeEditor} disabled={upsertProfile.isPending} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">Cancel</button>
                <button type="submit" disabled={upsertProfile.isPending} data-testid="button-save-browser-profile" className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                  {upsertProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {upsertProfile.isPending ? 'Saving…' : 'Save profile'}
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
                <h3 id="browser-profile-delete-title" className="text-lg font-semibold">Delete browser profile?</h3>
              </div>
              <p id="browser-profile-delete-description" className="text-sm text-muted-foreground">
                “{deleteTarget.name}” will no longer be available for new browser validation checks. This cannot be undone.
              </p>
              {deleteError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{deleteError}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/20 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteProfile.isPending} className="rounded-md border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-40">Cancel</button>
              <button type="button" onClick={confirmDelete} disabled={deleteProfile.isPending} data-testid="button-confirm-delete-browser-profile" className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60">
                {deleteProfile.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {deleteProfile.isPending ? 'Deleting…' : 'Delete profile'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}