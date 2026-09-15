import type { AiExecutionProjection } from '@workspace/api-client-react';

const actionLabels: Record<AiExecutionProjection['allowedActions'][number], string> = {
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

export function ExecutionProjectionPanel({
  projection,
  compact = false,
}: {
  projection?: AiExecutionProjection | null;
  compact?: boolean;
}) {
  if (!projection) return null;

  const percent = projection.progress.percent;
  const hasPlan = projection.plan.steps.length > 0;
  const hasTools = projection.tools.recent.length > 0;
  const hasFiles = projection.workspace.changedFiles.length > 0;
  const hasActions = projection.allowedActions.length > 0;

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

      {(projection.stopped.reason || hasActions) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {projection.stopped.reason && (
            <span className="text-[10px] text-amber-200">Stopped: {projection.stopped.reason}</span>
          )}
          {hasActions && (
            <div className="ml-auto flex flex-wrap justify-end gap-1" aria-label="Allowed execution actions">
              {projection.allowedActions.map((action) => (
                <span key={action} className="rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                  {actionLabels[action]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}