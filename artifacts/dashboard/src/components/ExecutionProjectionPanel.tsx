import { useState } from 'react';
import { Loader2, RotateCcw, ShieldCheck, Square, GitCompareArrows } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiExecutionProjection } from '@workspace/api-client-react';

type ProjectionAction = AiExecutionProjection['allowedActions'][number];

type ReviewDiff = {
  path: string;
  originalContent: string | null;
  newContent: string | null;
  truncated: boolean;
};

const actionLabels: Record<ProjectionAction, string> = {
  CANCEL: 'Stop',
  RESUME_CHECKPOINT: 'Resume checkpoint',
  RETRY_CHECKPOINT: 'Retry checkpoint',
  START_NEW_RUN: 'Start new run',
  REVIEW_PROOF: 'Review proof',
  REVIEW_DIFF: 'Review diff',
  APPROVE_CHANGES: 'Approve changes',
};

const statusClasses: Record<string, string> = {
  pending: 'border-border/60 bg-background/30 text-muted-foreground',
  active: 'border-primary/40 bg-primary/10 text-primary',
  completed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  blocked: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  failed: 'border-red-500/40 bg-red-500/10 text-red-200',
};

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function verificationClasses(status: AiExecutionProjection['verification']['status']): string {
  if (status === 'passed') return 'text-emerald-200';
  if (status === 'failed' || status === 'unavailable') return 'text-red-200';
  if (status === 'running') return 'text-sky-200';
  return 'text-amber-200';
}

function reviewLines(originalContent: string | null, newContent: string | null): string[] {
  const before = (originalContent ?? '').split(/\r?\n/);
  const after = (newContent ?? '').split(/\r?\n/);
  const longest = Math.max(before.length, after.length);
  const lines: string[] = [];
  for (let index = 0; index < longest; index += 1) {
    if (before[index] === after[index]) {
      if (before[index] !== undefined) lines.push(`  ${before[index]}`);
      continue;
    }
    if (before[index] !== undefined) lines.push(`- ${before[index]}`);
    if (after[index] !== undefined) lines.push(`+ ${after[index]}`);
  }
  return lines.slice(0, 600);
}

export function ExecutionProjectionPanel({
  projection,
  executionId,
  taskId,
  compact = false,
  onAction,
}: {
  projection?: AiExecutionProjection | null;
  executionId?: string | null;
  taskId?: string | null;
  compact?: boolean;
  onAction?: (action: ProjectionAction) => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ProjectionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ReviewDiff[] | null>(null);
  const [proofOpen, setProofOpen] = useState(false);

  if (!projection) return null;

  const percent = projection.progress.percent;
  const hasPlan = projection.plan.steps.length > 0;
  const hasTools = projection.tools.recent.length > 0;
  const hasFiles = projection.workspace.changedFiles.length > 0;
  const hasActions = projection.allowedActions.length > 0;

  async function loadDiff(): Promise<void> {
    if (!executionId) {
      setDiffError('The execution identity is not available for this review.');
      return;
    }
    setDiffLoading(true);
    setDiffError(null);
    try {
      const response = await fetch(`/api/ai/executions/${encodeURIComponent(executionId)}/diff`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({})) as {
        changes?: ReviewDiff[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || 'The review diff could not be loaded.');
      setDiff(Array.isArray(body.changes) ? body.changes : []);
    } catch (error) {
      setDiffError(error instanceof Error ? error.message : 'The review diff could not be loaded.');
    } finally {
      setDiffLoading(false);
    }
  }

  async function runAction(action: ProjectionAction): Promise<void> {
    if (action === 'REVIEW_DIFF') {
      await loadDiff();
      return;
    }
    if (action === 'REVIEW_PROOF') {
      setProofOpen(true);
      return;
    }
    if (!executionId) {
      setActionError('The execution identity is not available for this action.');
      return;
    }
    setPendingAction(action);
    setActionError(null);
    try {
      if (onAction) {
        await onAction(action);
      } else {
        let endpoint = `/api/ai/executions/${encodeURIComponent(executionId)}/cancel`;
        let body: Record<string, string> | undefined;
        if (action === 'RESUME_CHECKPOINT' || action === 'RETRY_CHECKPOINT') {
          endpoint = taskId
            ? `/api/ai/tasks/${encodeURIComponent(taskId)}/resume`
            : `/api/ai/executions/${encodeURIComponent(executionId)}/recovery`;
          body = taskId ? undefined : { action: 'resume' };
        } else if (action === 'APPROVE_CHANGES') {
          endpoint = `/api/ai/executions/${encodeURIComponent(executionId)}/approve`;
        } else if (action !== 'CANCEL') {
          throw new Error('This action must be completed from the owning execution surface.');
        }
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const responseBody = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(responseBody.error || 'The execution action was rejected.');
      }
      await queryClient.invalidateQueries({ queryKey: [`/api/ai/executions/${executionId}`] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The execution action was rejected.');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className={`border-b border-border/40 bg-background/20 ${compact ? 'px-3 py-2.5' : 'rounded-xl border border-border bg-card p-4'}`}
      aria-label="Server-owned execution projection"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Execution projection</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {titleCase(projection.kind)}
            </span>
            <span className="rounded-full border border-border/60 bg-background/30 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {titleCase(projection.phase)}
            </span>
          </div>
          <p className="mt-1 break-words text-[11px] text-foreground/90">{projection.objective}</p>
        </div>
        {projection.stopped.outcome && (
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
            projection.stopped.outcome === 'SUCCEEDED'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : projection.stopped.outcome === 'INTERRUPTED'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
          }`}>
            {titleCase(projection.stopped.outcome)}
          </span>
        )}
      </div>

      <div className={`mt-2 grid gap-2 text-[10px] ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
          <div className="text-muted-foreground">Progress</div>
          <div className="mt-0.5 font-medium text-foreground">
            {percent == null ? 'In progress' : `${percent}%`}
            {projection.progress.totalSteps != null && (
              <span className="ml-1 text-muted-foreground">
                ({projection.progress.completedSteps}/{projection.progress.totalSteps})
              </span>
            )}
          </div>
          {projection.progress.currentStep && (
            <div className="mt-0.5 truncate text-muted-foreground">{projection.progress.currentStep}</div>
          )}
        </div>
        <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
          <div className="text-muted-foreground">Tools</div>
          <div className="mt-0.5 font-medium text-foreground">{projection.tools.totalCalls} calls</div>
          {projection.tools.activeTool && <div className="mt-0.5 truncate text-primary">{projection.tools.activeTool}</div>}
        </div>
        <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
          <div className="text-muted-foreground">Verification</div>
          <div className={`mt-0.5 font-medium ${verificationClasses(projection.verification.status)}`}>
            {titleCase(projection.verification.status)}
          </div>
          <div className="mt-0.5 truncate text-muted-foreground">{titleCase(projection.verification.evidenceVerdict)}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-background/30 px-2 py-1.5">
          <div className="text-muted-foreground">Approval</div>
          <div className={`mt-0.5 font-medium ${projection.approval.status === 'APPROVED' ? 'text-emerald-200' : projection.approval.status === 'PENDING' ? 'text-amber-200' : 'text-muted-foreground'}`}>
            {titleCase(projection.approval.status)}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {projection.workspace.diffStatus === 'available'
              ? `${projection.workspace.changedFiles.length} changed file${projection.workspace.changedFiles.length === 1 ? '' : 's'}`
              : projection.workspace.diffStatus === 'not_applicable' ? 'No diff required' : 'Diff unavailable'}
          </div>
        </div>
      </div>

      {projection.progress.label && (
        <p className="mt-2 break-words text-[10px] leading-4 text-muted-foreground">{projection.progress.label}</p>
      )}

      {hasPlan && (
        <details className="mt-2 rounded-md border border-border/40 bg-background/20" open={!compact}>
          <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] font-semibold text-foreground">
            Current plan ({projection.plan.steps.length} steps)
          </summary>
          <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
            {projection.plan.steps.map((step) => (
              <div key={step.id} className="flex min-w-0 items-center gap-2 text-[10px]">
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-semibold uppercase ${statusClasses[step.status] ?? statusClasses.pending}`}>
                  {step.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground/90">{step.title}</span>
                {step.files.length > 0 && <span className="shrink-0 text-muted-foreground">{step.files.length} file{step.files.length === 1 ? '' : 's'}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {(hasTools || hasFiles) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {hasTools && (
            <div className="rounded-md border border-border/40 bg-background/20 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-foreground">Recent tools</div>
              <div className="mt-1 space-y-1">
                {projection.tools.recent.slice(-4).map((tool, index) => (
                  <div key={`${tool.tool}-${index}`} className="flex min-w-0 items-center gap-1.5 text-[10px]">
                    <span className={tool.status === 'failed' ? 'text-red-200' : tool.status === 'started' ? 'text-primary' : 'text-emerald-200'}>{tool.status}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{tool.tool}</span>
                    {tool.source && <code className="min-w-0 truncate text-muted-foreground/70">{tool.source}</code>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasFiles && (
            <div className="rounded-md border border-border/40 bg-background/20 px-2.5 py-2">
              <div className="text-[10px] font-semibold text-foreground">Changed files</div>
              <div className="mt-1 space-y-1">
                {projection.workspace.changedFiles.slice(0, 5).map((file) => (
                  <code key={file} className="block truncate text-[10px] text-muted-foreground">{file}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {proofOpen && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[10px]" aria-label="Verification details">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-200" />
            Verification and evidence
          </div>
          <p className="mt-1 leading-4 text-muted-foreground">
            Status: {titleCase(projection.verification.status)} · verdict: {titleCase(projection.verification.evidenceVerdict)}.
            {projection.verification.proofRequired ? ' This execution requires server-owned proof before it can be accepted.' : ' No proof gate is required for this execution.'}
          </p>
        </div>
      )}

      {diff && (
        <div className="mt-2 space-y-2 rounded-md border border-primary/30 bg-background/30 p-2.5" aria-label="Reviewable execution diff">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-foreground">Reviewable diff</span>
            <span className="text-[10px] text-muted-foreground">{diff.length} file{diff.length === 1 ? '' : 's'}</span>
          </div>
          {diff.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No reviewable file content is attached to this execution.</p>
          ) : diff.map((file) => (
            <details key={file.path} className="rounded border border-border/40 bg-black/10" open={!compact}>
              <summary className="cursor-pointer px-2 py-1.5 font-mono text-[10px] text-foreground">{file.path}</summary>
              <pre className="max-h-80 overflow-auto border-t border-border/40 px-2 py-2 text-[9px] leading-4 text-muted-foreground">
                {reviewLines(file.originalContent, file.newContent).join('\n')}
              </pre>
              {file.truncated && <div className="px-2 pb-1 text-[9px] text-amber-200">This file is truncated for safe review.</div>}
            </details>
          ))}
        </div>
      )}
      {diffError && <p className="mt-2 text-[10px] text-red-200">{diffError}</p>}

      {(projection.stopped.reason || hasActions) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {projection.stopped.reason && (
            <span className="text-[10px] text-amber-200">Stopped: {projection.stopped.reason}</span>
          )}
          {actionError && <span className="text-[10px] text-red-200">{actionError}</span>}
          {hasActions && (
            <div className="ml-auto flex flex-wrap justify-end gap-1" aria-label="Allowed execution actions">
              {projection.allowedActions.map((action) => {
                const pending = pendingAction === action;
                const icon = action === 'CANCEL' ? <Square className="mr-1 h-3 w-3" /> : action === 'REVIEW_DIFF' ? <GitCompareArrows className="mr-1 h-3 w-3" /> : <RotateCcw className="mr-1 h-3 w-3" />;
                return (
                  <button
                    key={action}
                    type="button"
                    className="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[9px] font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void runAction(action)}
                    disabled={pendingAction !== null || diffLoading}
                  >
                    {pending || (action === 'REVIEW_DIFF' && diffLoading) ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : icon}
                    {pending ? 'Working…' : action === 'REVIEW_DIFF' && diffLoading ? 'Loading diff…' : actionLabels[action]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}