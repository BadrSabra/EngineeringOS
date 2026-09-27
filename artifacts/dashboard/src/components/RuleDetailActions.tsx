import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!evaluationProjectId && projects.length > 0) {
      setEvaluationProjectId(projects[0].id);
    }
  }, [evaluationProjectId, projects]);

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
      setUpdateError('A rule title is required.');
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
          setActionStatus('Rule updated.');
        },
        onError: () => {
          setUpdateError('Could not update this rule. Try again.');
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
          setActionStatus('Rule deleted.');
        },
        onError: () => {
          setDeleteError('Could not delete this rule. Try again.');
        },
      },
    );
  };

  const runEvaluation = () => {
    if (!evaluationProjectId || !rule.pattern) return;
    setEvaluationError(null);
    setEvaluationResult(null);
    setActionStatus(null);
    evaluateRule.mutate(
      { ruleId: rule.id, data: { projectId: evaluationProjectId } },
      {
        onSuccess: (result) => {
          setEvaluationResult(result as EvaluationView);
          invalidateRules();
        },
        onError: () => {
          setEvaluationError('Could not evaluate this rule against the selected project.');
        },
      },
    );
  };

  const selectedProject = projects.find((project) => project.id === evaluationProjectId);
  const showResult = evaluationResult?.projectId === evaluationProjectId;

  return (
    <div className="border-t border-border pt-4">
      {editing && draft ? (
        <form
          className="space-y-4"
          onSubmit={saveRule}
          aria-label={`Edit rule ${rule.title}`}
          data-testid={`edit-rule-form-${rule.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold">Edit rule</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Rule code and verification steps are read-only in the current API.
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
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Rule title
              <input
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                className={fieldClass}
                data-testid={`input-rule-title-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Severity
              <select
                value={draft.severity}
                onChange={(event) => setDraft({ ...draft, severity: event.target.value as RuleSeverity })}
                className={fieldClass}
                data-testid={`select-rule-severity-${rule.id}`}
              >
                {severities.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity.charAt(0).toUpperCase() + severity.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground md:col-span-2">
              Description
              <textarea
                rows={2}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className={fieldClass}
                data-testid={`input-rule-description-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Detection pattern
              <input
                value={draft.pattern}
                onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                className={`${fieldClass} font-mono`}
                data-testid={`input-rule-pattern-${rule.id}`}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Recommended fix
              <textarea
                rows={2}
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
            Rule is enabled
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
            {updateRule.isPending ? 'Saving…' : 'Save changes'}
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
              <Pencil className="h-3.5 w-3.5" /> Edit rule
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
              <Trash2 className="h-3.5 w-3.5" /> Delete rule
            </button>
          </div>

          <div className="rounded-md border border-border bg-background/50 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 space-y-1.5 text-xs font-medium text-muted-foreground">
                Evaluate against project
                <select
                  value={evaluationProjectId}
                  onChange={(event) => {
                    setEvaluationProjectId(event.target.value);
                    setEvaluationResult(null);
                    setEvaluationError(null);
                  }}
                  disabled={projectsQuery.isLoading || projects.length === 0}
                  className={fieldClass}
                  data-testid={`select-rule-project-${rule.id}`}
                >
                  <option value="">Select an owned project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
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
                  !evaluationProjectId ||
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
                {evaluateRule.isPending ? 'Evaluating…' : 'Evaluate rule'}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Evaluation reads the selected project’s files, updates this rule’s hit count, and records an audit event. It does not change project files.
            </p>
            {!rule.pattern && (
              <p className="mt-2 text-xs text-muted-foreground">
                Add a detection pattern before evaluating this rule.
              </p>
            )}
            {projectsQuery.isError && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
                <span>Could not load your projects.</span>
                <button type="button" onClick={() => void projectsQuery.refetch()} className="underline">
                  Retry
                </button>
              </div>
            )}
            {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Add or import a project before evaluating rules.
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
                    ? 'No matches found.'
                    : `${evaluationResult.matchCount} match${evaluationResult.matchCount === 1 ? '' : 'es'} found`}
                  {selectedProject ? ` in ${selectedProject.name}` : ''}
                </p>
                {evaluationResult.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{evaluationResult.note}</p>
                )}
                {evaluationResult.matches.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {evaluationResult.matches.map((match, index) => (
                      <li key={`${match.file}:${match.line}:${index}`} className="rounded border border-border/70 p-2">
                        <div className="font-mono text-[11px] text-primary">
                          {match.file}:{match.line}
                        </div>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
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
              <AlertTriangle className="h-5 w-5 text-destructive" /> Delete “{rule.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the rule from the Rules Engine. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRule.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteRule.isPending}
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`confirm-delete-rule-${rule.id}`}
            >
              {deleteRule.isPending ? 'Deleting…' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}