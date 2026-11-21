import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListRulesQueryKey,
  getListProjectsQueryKey,
  useDeleteRule,
  useEvaluateRule,
  useListProjects,
  useUpdateRule,
  type Rule,
  type RuleEvaluationResult,
  type RuleSeverity,
} from '@workspace/api-client-react';
import { AlertTriangle, Check, LoaderCircle, Pencil, Play, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type RuleDraft = {
  title: string;
  description: string;
  severity: RuleSeverity;
  pattern: string;
  fixDescription: string;
  enabled: boolean;
};

type EvaluationView = RuleEvaluationResult & { note?: string };

const severities: RuleSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const severityLabels: Record<RuleSeverity, string> = {
  critical: 'حرج',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
  info: 'معلومة',
};
const fieldClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

export default function RuleDetailActions({ rule }: { rule: Rule }) {
  const queryClient = useQueryClient();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const evaluateRule = useEvaluateRule();
  const projectsQuery = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey(), staleTime: 30_000 },
  });
  const projects = projectsQuery.data ?? [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [evaluationProjectId, setEvaluationProjectId] = useState('');
  const [evaluationResult, setEvaluationResult] = useState<EvaluationView | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const evaluationRequestVersion = useRef(0);

  // A locally remembered ID is usable only while it remains in the latest
  // owned-project result. Derive the fallback during render so the action
  // cannot submit a removed project ID while the reconciliation effect runs.
  const effectiveEvaluationProjectId = projects.some(
    (project) => project.id === evaluationProjectId,
  )
    ? evaluationProjectId
    : (projects[0]?.id ?? '');

  useEffect(() => {
    if (evaluationProjectId === effectiveEvaluationProjectId) return;

    evaluationRequestVersion.current += 1;
    setEvaluationProjectId(effectiveEvaluationProjectId);
    setEvaluationResult(null);
    setEvaluationError(null);
  }, [evaluationProjectId, effectiveEvaluationProjectId]);

  const invalidateRules = () => {
    void queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
  };

  const beginEdit = () => {
    setDraft({
      title: rule.title,
      description: rule.description ?? '',
      severity: rule.severity,
      pattern: rule.pattern ?? '',
      fixDescription: rule.fixDescription ?? '',
      enabled: rule.enabled,
    });
    setEditing(true);
    setUpdateError(null);
    setActionStatus(null);
  };

  const saveRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const title = draft.title.trim();
    if (!title) {
      setUpdateError('يجب إدخال عنوان للقاعدة.');
      return;
    }

    setUpdateError(null);
    setActionStatus(null);
    updateRule.mutate(
      {
        ruleId: rule.id,
        data: {
          title,
          description: draft.description,
          severity: draft.severity,
          pattern: draft.pattern,
          fixDescription: draft.fixDescription,
          enabled: draft.enabled,
        },
      },
      {
        onSuccess: () => {
          invalidateRules();
          setEditing(false);
          setDraft(null);
          setActionStatus('تم تحديث القاعدة.');
        },
        onError: () => {
          setUpdateError('تعذر تحديث القاعدة. حاول مرة أخرى.');
        },
      },
    );
  };

  const confirmDelete = () => {
    setDeleteError(null);
    setActionStatus(null);
    deleteRule.mutate(
      { ruleId: rule.id },
      {
        onSuccess: () => {
          invalidateRules();
          setDeleteOpen(false);
          setActionStatus('تم حذف القاعدة.');
        },
        onError: () => {
          setDeleteError('تعذر حذف القاعدة. حاول مرة أخرى.');
        },
      },
    );
  };

  const runEvaluation = () => {
    const projectId = effectiveEvaluationProjectId;
    if (!projectId || !rule.pattern || !projects.some((project) => project.id === projectId)) return;

    const requestVersion = ++evaluationRequestVersion.current;
    setEvaluationError(null);
    setEvaluationResult(null);
    setActionStatus(null);
    evaluateRule.mutate(
      { ruleId: rule.id, data: { projectId } },
      {
        onSuccess: (result) => {
          if (requestVersion !== evaluationRequestVersion.current) return;

          const evaluation = result as EvaluationView;
          if (evaluation.projectId !== projectId) return;

          setEvaluationResult(evaluation);
          invalidateRules();
        },
        onError: () => {
          if (requestVersion !== evaluationRequestVersion.current) return;
          setEvaluationError('تعذر فحص القاعدة على المشروع المحدد.');
        },
      },
    );
  };

  const selectedProject = projects.find(
    (project) => project.id === effectiveEvaluationProjectId,
  );
  const showResult = evaluationResult?.projectId === effectiveEvaluationProjectId;

  return (
    <div dir="rtl" lang="ar" className="border-t border-border pt-4">
      {editing && draft ? (
        <form
          className="space-y-4"
          onSubmit={saveRule}
          aria-label={`تعديل القاعدة ${rule.title}`}
          data-testid={`edit-rule-form-${rule.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold">تعديل القاعدة</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                رمز القاعدة وخطوات التحقق للقراءة فقط حاليًا.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(null);
                setUpdateError(null);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
              data-testid={`cancel-edit-rule-${rule.id}`}
            >
              إلغاء
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              عنوان القاعدة
              <input
                required
                dir="auto"
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className={fieldClass}
                data-testid={`input-rule-title-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              مستوى الخطورة
              <select
                value={draft.severity}
                onChange={(event) => setDraft({ ...draft, severity: event.target.value as RuleSeverity })}
                className={fieldClass}
                data-testid={`select-rule-severity-${rule.id}`}
              >
                {severities.map((severity) => (
                  <option key={severity} value={severity}>
                    {severityLabels[severity]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground md:col-span-2">
              الوصف
              <textarea
                rows={2}
                dir="auto"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className={fieldClass}
                data-testid={`input-rule-description-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              نمط الكشف
              <input
                dir="ltr"
                value={draft.pattern}
                onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                className={`${fieldClass} font-mono`}
                data-testid={`input-rule-pattern-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              الإصلاح المقترح
              <textarea
                rows={2}
                dir="auto"
                value={draft.fixDescription}
                onChange={(event) => setDraft({ ...draft, fixDescription: event.target.value })}
                className={fieldClass}
                data-testid={`input-rule-fix-${rule.id}`}
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              className="h-4 w-4 accent-primary"
              data-testid={`toggle-rule-enabled-${rule.id}`}
            />
            القاعدة مفعّلة
          </label>

          {updateError && (
            <p role="alert" className="text-sm text-destructive" data-testid={`rule-update-error-${rule.id}`}>
              {updateError}
            </p>
          )}
          <button
            type="submit"
            disabled={updateRule.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid={`save-rule-${rule.id}`}
          >
            {updateRule.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {updateRule.isPending ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={beginEdit}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-secondary"
              data-testid={`edit-rule-${rule.id}`}
            >
              <Pencil className="h-3.5 w-3.5" /> تعديل القاعدة
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
              data-testid={`delete-rule-${rule.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" /> حذف القاعدة
            </button>
          </div>

          <div className="rounded-md border border-border bg-background/50 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 space-y-1.5 text-xs font-medium text-muted-foreground">
                مشروع الفحص
                <select
                  value={effectiveEvaluationProjectId}
                  onChange={(event) => {
                    evaluationRequestVersion.current += 1;
                    setEvaluationProjectId(event.target.value);
                    setEvaluationResult(null);
                    setEvaluationError(null);
                  }}
                  disabled={projectsQuery.isLoading || projects.length === 0}
                  className={fieldClass}
                  data-testid={`select-rule-project-${rule.id}`}
                >
                  <option value="">اختر مشروعًا من مشاريعك</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id} dir="auto">
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={runEvaluation}
                disabled={
                  evaluateRule.isPending ||
                  !effectiveEvaluationProjectId ||
                  !selectedProject ||
                  !rule.pattern ||
                  projectsQuery.isLoading ||
                  projectsQuery.isError
                }
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`evaluate-rule-${rule.id}`}
              >
                {evaluateRule.isPending
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <Play className="h-3.5 w-3.5" />}
                {evaluateRule.isPending ? 'جارٍ الفحص…' : 'فحص القاعدة'}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              يقرأ ملفات المشروع المحدد، ويحدّث عدد مرات رصد القاعدة ويسجل الإجراء للمراجعة. لا يغيّر ملفات المشروع.
            </p>
            {!rule.pattern && (
              <p className="mt-2 text-xs text-muted-foreground">
                أضف نمط الكشف قبل فحص القاعدة.
              </p>
            )}
            {projectsQuery.isError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
                <span>تعذر تحميل المشاريع.</span>
                <button type="button" onClick={() => void projectsQuery.refetch()} className="underline">
                  أعد المحاولة
                </button>
              </div>
            )}
            {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                أضف مشروعًا أو استورده قبل فحص القواعد.
              </p>
            )}
            {evaluationError && (
              <p role="alert" className="mt-2 text-xs text-destructive" data-testid={`rule-evaluation-error-${rule.id}`}>
                {evaluationError}
              </p>
            )}
            {showResult && evaluationResult && (
              <div
                className="mt-3 rounded-md border border-border bg-secondary/30 p-3"
                role="status"
                data-testid={`rule-evaluation-result-${rule.id}`}
              >
                <p className="text-sm font-medium">
                  {evaluationResult.matchCount === 0
                    ? 'لم تُعثر على مطابقات.'
                    : `عدد المطابقات: ${new Intl.NumberFormat('ar-EG').format(evaluationResult.matchCount)}`}
                  {selectedProject && <> في <bdi dir="auto">{selectedProject.name}</bdi></>}
                </p>
                {evaluationResult.note && (
                  <p dir="auto" className="mt-1 text-xs text-muted-foreground">{evaluationResult.note}</p>
                )}
                {evaluationResult.matches.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {evaluationResult.matches.map((match, index) => (
                      <li key={`${match.file}:${match.line}:${index}`} className="rounded border border-border/70 p-2">
                        <div dir="ltr" className="font-mono text-[11px] text-primary">
                          {match.file}:{match.line}
                        </div>
                        <pre dir="ltr" className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          {match.snippet}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {actionStatus && (
            <p role="status" className="text-xs text-emerald-300" data-testid={`rule-action-status-${rule.id}`}>
              {actionStatus}
            </p>
          )}
        </div>
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (deleteRule.isPending) return;
          setDeleteOpen(open);
          if (!open) setDeleteError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              حذف القاعدة «<bdi dir="auto">{rule.title}</bdi>»؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              سيؤدي هذا إلى إزالة القاعدة نهائيًا من محرك القواعد. لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRule.isPending}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteRule.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`confirm-delete-rule-${rule.id}`}
            >
              {deleteRule.isPending ? 'جارٍ الحذف…' : 'حذف نهائيًا'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}