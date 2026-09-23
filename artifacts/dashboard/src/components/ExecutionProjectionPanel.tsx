import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  GitCompareArrows,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Square,
  Wrench,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { getMissionState } from './mission-state';

export type ProjectionAction = AiExecutionProjection['allowedActions'][number];

type ReviewDiff = {
  path: string;
  originalContent: string | null;
  newContent: string | null;
  truncated: boolean;
};

export type ExecutionProjectionPanelProps = {
  projection?: AiExecutionProjection | null;
  executionId?: string | null;
  executionStatus?: string | null;
  flightState?: string | null;
  evidenceVerdict?: string | null;
  resumable?: boolean | null;
  nextAction?: string | null;
  compact?: boolean;
  onAction?: (action: ProjectionAction) => Promise<void> | void;
  /**
   * Kept for callers that still pass the task identity while surfaces migrate
   * to the shared capsule. The capsule uses it only for identity and recovery
   * routing; the owning surface still controls execution actions.
   */
  taskId?: string | null;
  /** Stable mission identity. Falls back to operationId, then executionId. */
  missionId?: string | null;
  operationId?: string | null;
  proposalId?: string | null;
};

const actionLabels: Record<ProjectionAction, string> = {
  CANCEL: 'Stop run',
  RESUME_CHECKPOINT: 'Resume checkpoint',
  RETRY_CHECKPOINT: 'Retry checkpoint',
  START_NEW_RUN: 'Start new run',
  REVIEW_PROOF: 'Review proof',
  REVIEW_DIFF: 'Review changes',
  APPROVE_CHANGES: 'Approve changes',
};

const actionOrder: ProjectionAction[] = [
  'APPROVE_CHANGES',
  'RESUME_CHECKPOINT',
  'RETRY_CHECKPOINT',
  'CANCEL',
  'REVIEW_DIFF',
  'REVIEW_PROOF',
  'START_NEW_RUN',
];

function titleCase(value: unknown, fallback = 'Not recorded'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateTone(value: unknown): string {
  const normalized = typeof value === 'string' ? value.toUpperCase() : '';
  if (['FAILED', 'BLOCKED', 'UNAVAILABLE', 'NEEDS_ATTENTION'].includes(normalized)) {
    return 'border-red-500/35 bg-red-500/10 text-red-200';
  }
  if (['INTERRUPTED', 'CANCELLED', 'PENDING', 'PARTIAL', 'INCOMPLETE', 'AWAITING_APPROVAL'].includes(normalized)) {
    return 'border-amber-500/35 bg-amber-500/10 text-amber-200';
  }
  if (['PASSED', 'PROVEN', 'VERIFIED', 'APPROVED', 'SUCCEEDED', 'DELIVERED', 'COMPLETE', 'READY_FOR_REVIEW'].includes(normalized)) {
    return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200';
  }
  if (['BUILDING', 'VALIDATING', 'DELIVERING', 'INVESTIGATING', 'PLANNING', 'UNDERSTANDING'].includes(normalized)) {
    return 'border-primary/35 bg-primary/10 text-primary';
  }
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function verificationTone(status: unknown): string {
  if (status === 'passed') return 'text-emerald-200';
  if (status === 'failed' || status === 'unavailable') return 'text-red-200';
  if (status === 'running') return 'text-sky-200';
  return 'text-amber-200';
}

function verificationSummary(
  status: AiExecutionProjection['verification']['status'] | undefined,
  proofRequired: boolean | undefined,
): string {
  switch (status) {
    case 'passed':
      return proofRequired
        ? 'Validation passed, but the required proof gate still governs acceptance.'
        : 'Server-owned validation passed for this execution.';
    case 'failed':
      return 'Server-owned validation did not pass. Review the recorded evidence before continuing.';
    case 'unavailable':
      return 'Complete server-owned verification is not available for this execution.';
    case 'running':
      return 'The server is still collecting validation or evidence for this execution.';
    default:
      return proofRequired
        ? 'This execution cannot be accepted until its server-owned proof is complete.'
        : 'Verification has not been recorded yet.';
  }
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

function stepIcon(status: string | undefined) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-200" />;
  if (status === 'active') return <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />;
  if (status === 'failed' || status === 'blocked') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-200" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function timelineIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-200" />;
  if (status === 'active') return <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />;
  if (status === 'blocked') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-200" />;
  if (status === 'not_applicable') return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  return <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

function timelineStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'Done';
    case 'active': return 'Now';
    case 'blocked': return 'Blocked';
    case 'not_applicable': return 'Not needed';
    default: return 'Next';
  }
}

function actionIcon(action: ProjectionAction) {
  if (action === 'CANCEL') return <Square className="mr-1.5 h-3.5 w-3.5" />;
  if (action === 'REVIEW_DIFF') return <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />;
  if (action === 'REVIEW_PROOF') return <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />;
  return <RotateCcw className="mr-1.5 h-3.5 w-3.5" />;
}

export function ExecutionProjectionPanel({
  projection,
  executionId,
  executionStatus,
  flightState,
  evidenceVerdict,
  resumable,
  nextAction,
  compact = false,
  onAction,
  taskId,
  missionId,
  operationId,
  proposalId,
}: ExecutionProjectionPanelProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ProjectionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diff, setDiff] = useState<ReviewDiff[] | null>(null);

  if (!projection) return null;

  const progress = projection.progress;
  const planSteps = projection.plan?.steps ?? [];
  const recentTools = projection.tools?.recent ?? [];
  const changedFiles = projection.workspace?.changedFiles ?? [];
  const allowedActions = projection.allowedActions ?? [];
  const orderedActions = [...allowedActions].sort(
    (left, right) => actionOrder.indexOf(left) - actionOrder.indexOf(right),
  );
  const verdict = evidenceVerdict ?? projection.verification?.evidenceVerdict;
  const missionState = getMissionState({
    projection,
    executionStatus,
    flightState,
    evidenceVerdict,
    resumable,
    nextAction,
  });
  const percent = typeof progress?.percent === 'number' ? Math.max(0, Math.min(100, progress.percent)) : null;
  const approvalPending = projection.approval?.required && projection.approval.status === 'PENDING';
  const isStopped = Boolean(projection.stopped?.outcome);
  const resolvedMissionId = missionId ?? operationId ?? executionId;
  const resolvedProposalId = proposalId ?? projection.approval?.proposalId;
  const primaryAction = missionState.primaryAction;
  const secondaryActions = orderedActions.filter((action) => action !== primaryAction);

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
        if (action === 'RETRY_CHECKPOINT') {
          endpoint = `/api/ai/executions/${encodeURIComponent(executionId)}/retry-capability`;
        } else if (action === 'RESUME_CHECKPOINT') {
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
      className={`border-border/60 bg-card/40 ${compact ? 'border-b px-3 py-3' : 'rounded-xl border p-4'}`}
      aria-label="Mission capsule"
      data-testid="mission-capsule"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Mission capsule</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" data-testid="status-mission-kind">
              {titleCase(projection.kind)}
            </span>
            <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground" data-testid="status-mission-phase">
              {titleCase(projection.phase)}
            </span>
          </div>
          <h2 className="mt-2 text-sm font-semibold text-foreground" data-testid="text-lifecycle-title">{missionState.label}</h2>
          <p className="mt-1 max-w-3xl break-words text-xs leading-5 text-muted-foreground" data-testid="text-mission-objective">
            {projection.objective || 'No objective was retained for this run.'}
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-right ${stateTone(missionState.key)}`} data-testid="status-canonical">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mission state</div>
          <div className="mt-0.5 text-xs font-semibold text-foreground">{missionState.label}</div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px]" role="status" data-testid="text-mission-state-detail">
        {missionState.detail}
      </div>

      {resolvedMissionId && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" data-testid="mission-identity">
          <span className="font-semibold uppercase tracking-wide text-primary">Mission</span>
          <code className="max-w-[18rem] truncate text-foreground" title={resolvedMissionId}>{resolvedMissionId}</code>
          {executionId && executionId !== resolvedMissionId && <span>Execution <code className="text-foreground">{executionId}</code></span>}
          {operationId && operationId !== resolvedMissionId && <span>Operation <code className="text-foreground">{operationId}</code></span>}
          {taskId && <span>Task <code className="text-foreground">{taskId}</code></span>}
          {resolvedProposalId && <span>Proposal <code className="text-foreground">{resolvedProposalId}</code></span>}
        </div>
      )}

      {(executionId || taskId) && (
        <nav className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Mission surfaces" data-testid="mission-links">
          {executionId && (
            <>
              <Link
                href={`/flight-deck?executionId=${encodeURIComponent(executionId)}`}
                className="rounded border border-primary/25 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10"
              >
                Open Flight Deck
              </Link>
              <Link
                href={`/mission-control?executionId=${encodeURIComponent(executionId)}`}
                className="rounded border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground"
              >
                Open Mission Control
              </Link>
            </>
          )}
          {taskId && (
            <Link
              href={`/tasks?taskId=${encodeURIComponent(taskId)}`}
              className="rounded border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground"
            >
              Open Task
            </Link>
          )}
        </nav>
      )}

      {projection.timeline?.length > 0 && (
        <details className="mt-3 rounded-md border border-border/45 bg-background/20" open={!compact} data-testid="mission-timeline">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] font-semibold text-foreground">
            <span>Mission timeline</span>
            <span className="font-normal text-muted-foreground">({projection.timeline.length} stages)</span>
            <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] ${stateTone(missionState.key)}`}>{missionState.label}</span>
          </summary>
          <div className="grid gap-1.5 border-t border-border/40 p-2 sm:grid-cols-2 lg:grid-cols-4">
            {projection.timeline.map((item) => (
              <div
                key={item.id}
                className={`rounded-md border px-2.5 py-2 ${
                  item.status === 'active'
                    ? 'border-primary/35 bg-primary/10'
                    : item.status === 'blocked'
                      ? 'border-red-500/30 bg-red-500/5'
                      : item.status === 'completed'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-border/35 bg-background/20'
                }`}
                data-testid={`timeline-${item.id}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {timelineIcon(item.status)}
                  <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground">{item.label}</span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">{timelineStatusLabel(item.status)}</span>
                </div>
                {item.detail && <p className="mt-1 text-[9px] leading-4 text-muted-foreground">{item.detail}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      <div className={`mt-3 grid gap-2 text-[10px] ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-progress">
          <div className="text-muted-foreground">Progress</div>
          <div className="mt-1 font-medium text-foreground">
            {percent === null ? 'Not recorded' : `${percent}%`}
            {progress?.totalSteps != null && <span className="ml-1 text-muted-foreground">({progress.completedSteps}/{progress.totalSteps})</span>}
          </div>
          {progress?.currentStep && <div className="mt-0.5 truncate text-muted-foreground">{progress.currentStep}</div>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-run">
          <div className="text-muted-foreground">Run status</div>
          <div className="mt-1 font-medium text-foreground">{titleCase(executionStatus)}</div>
          {executionId && <code className="mt-0.5 block truncate text-muted-foreground" title={executionId}>ID {executionId}</code>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-flight">
          <div className="text-muted-foreground">Delivery state</div>
          <div className={`mt-1 font-medium ${stateTone(flightState).split(' ').at(-1)}`}>{titleCase(flightState)}</div>
          {resumable !== undefined && resumable !== null && <div className="mt-0.5 text-muted-foreground">{resumable ? 'Checkpoint can resume' : 'No resume recorded'}</div>}
        </div>
        <div className="rounded-md border border-border/45 bg-background/25 px-2.5 py-2" data-testid="status-proof">
          <div className="text-muted-foreground">Proof posture</div>
          <div className={`mt-1 font-medium ${verificationTone(projection.verification?.status)}`}>{titleCase(projection.verification?.status)}</div>
          <div className="mt-0.5 truncate text-muted-foreground">{titleCase(verdict)}</div>
        </div>
      </div>

      <div className="mt-3" aria-label="Execution progress">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="font-semibold text-foreground">Server-confirmed progress</span>
          <span className="tabular-nums text-muted-foreground">{percent === null ? 'Awaiting server progress' : `${percent}% complete`}</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} aria-label={percent === null ? 'Execution progress is not yet available' : `Execution ${percent}% complete`} data-testid="progress-execution">
          <div className={`h-full rounded-full transition-[width] duration-500 ${projection.verification?.status === 'failed' ? 'bg-red-400' : 'bg-primary'}`} style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>

      {projection.orientation && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-[10px] ${
            projection.orientation.complete
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
          }`}
          data-testid="orientation-coverage"
        >
          <div className="font-semibold">
            Project orientation: {projection.orientation.complete ? 'complete' : 'incomplete'}
          </div>
          {projection.orientation.missingRoles.length > 0 && (
            <div className="mt-0.5 text-muted-foreground">
              Missing roles: {projection.orientation.missingRoles.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2.5" data-testid="primary-next-action">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Next action</div>
            <div className="mt-0.5 text-xs font-semibold text-foreground">{missionState.primaryActionLabel}</div>
            {nextAction && (
              <div className="mt-0.5 text-[10px] text-muted-foreground" data-testid="text-next-action">
                {nextAction}
              </div>
            )}
          </div>
          {primaryAction && (
            <button
              type="button"
              data-testid={`button-action-${primaryAction.toLowerCase()}`}
              data-primary-action="true"
              className="inline-flex items-center rounded border border-primary/40 bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void runAction(primaryAction)}
              disabled={pendingAction !== null}
              title={onAction ? undefined : 'This action is handled by the owning execution surface'}
            >
              {pendingAction === primaryAction
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : actionIcon(primaryAction)}
              {pendingAction === primaryAction ? 'Working…' : actionLabels[primaryAction]}
            </button>
          )}
        </div>
      </div>

      {planSteps.length > 0 && (
        <details className="mt-3 rounded-md border border-border/45 bg-background/20" open={!compact}>
          <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-foreground" data-testid="toggle-plan">
            Current plan <span className="font-normal text-muted-foreground">({planSteps.length} steps)</span>
          </summary>
          <div className="space-y-1 border-t border-border/40 px-2.5 py-2">
            {planSteps.map((step) => (
              <div key={step.id} className="rounded border border-border/35 px-2 py-1.5 text-[10px]" data-testid={`plan-step-${step.id}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {stepIcon(step.status)}
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{step.title}</span>
                  <span className="shrink-0 text-muted-foreground">{titleCase(step.status)}</span>
                </div>
                {(step.action || step.files?.length > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-2 pl-5 text-muted-foreground">
                    {step.action && <span>Action: {step.action}</span>}
                    {step.files?.length > 0 && <span>{step.files.length} scoped file{step.files.length === 1 ? '' : 's'}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {(recentTools.length > 0 || changedFiles.length > 0) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {recentTools.length > 0 && (
            <details className="rounded-md border border-border/45 bg-background/20 px-2.5 py-2" open={!compact}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-foreground" data-testid="toggle-tools">
                <Wrench className="h-3 w-3 text-primary" /> Tools used <span className="font-normal text-muted-foreground">({projection.tools?.totalCalls ?? recentTools.length} calls)</span>
              </summary>
              <div className="mt-1 space-y-1 border-t border-border/30 pt-1.5">
                {recentTools.map((tool, index) => (
                  <div key={`${tool.tool}-${index}`} className="flex min-w-0 items-center gap-1.5 text-[10px]" data-testid={`tool-${index}`}>
                    <span className={tool.status === 'failed' ? 'text-red-200' : tool.status === 'started' ? 'text-primary' : 'text-emerald-200'}>{titleCase(tool.status)}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{tool.tool}</span>
                    {tool.source && <code className="min-w-0 truncate text-muted-foreground/70">{tool.source}</code>}
                  </div>
                ))}
              </div>
            </details>
          )}
          {changedFiles.length > 0 && (
            <details className="rounded-md border border-border/45 bg-background/20 px-2.5 py-2" open={!compact}>
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-semibold text-foreground" data-testid="toggle-files">
                <FileText className="h-3 w-3 text-primary" /> Changed files ({changedFiles.length})
              </summary>
              <div className="mt-1 space-y-1 border-t border-border/30 pt-1.5">
                {changedFiles.map((file) => <code key={file} className="block truncate text-[10px] text-muted-foreground" data-testid={`file-${file}`}>{file}</code>)}
              </div>
            </details>
          )}
        </div>
      )}

      {(diffLoading || diff || diffError) && (
        <div className="mt-2 space-y-2 rounded-md border border-primary/30 bg-background/30 p-2.5" aria-label="Reviewable execution diff">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px] font-semibold text-foreground">Reviewable changes</span>
            {diff && <span className="text-[10px] text-muted-foreground">{diff.length} file{diff.length === 1 ? '' : 's'}</span>}
          </div>
          {diffLoading && <p className="text-[10px] text-muted-foreground">Loading the server-owned diff…</p>}
          {diffError && <p className="text-[10px] text-red-200">{diffError}</p>}
          {diff && (
            diff.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No reviewable file content is attached to this execution.</p>
            ) : diff.map((file) => (
              <details key={file.path} className="rounded border border-border/40 bg-black/10" open={!compact}>
                <summary className="cursor-pointer px-2 py-1.5 font-mono text-[10px] text-foreground">{file.path}</summary>
                <pre className="max-h-80 overflow-auto border-t border-border/40 px-2 py-2 text-[9px] leading-4 text-muted-foreground">
                  {reviewLines(file.originalContent, file.newContent).join('\n')}
                </pre>
                {file.truncated && <div className="px-2 pb-1 text-[9px] text-amber-200">This file is truncated for safe review.</div>}
              </details>
            ))
          )}
        </div>
      )}

      <details
        className={`mt-3 rounded-md border px-3 py-2 text-[10px] ${projection.verification?.status === 'failed' || projection.verification?.status === 'unavailable' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
        open={proofOpen || projection.verification?.status === 'failed' || projection.verification?.status === 'unavailable'}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-foreground" data-testid="toggle-proof">
          <ShieldCheck className={`h-3.5 w-3.5 ${verificationTone(projection.verification?.status)}`} />
          Proof posture
          <span className={`ml-auto font-normal ${verificationTone(projection.verification?.status)}`}>{titleCase(projection.verification?.status)}</span>
        </summary>
        <div className="mt-1 border-t border-border/30 pt-1.5 leading-4 text-muted-foreground" data-testid="text-proof-summary">
          <p>{verificationSummary(projection.verification?.status, projection.verification?.proofRequired)}</p>
          <p className="mt-1">Evidence verdict: <span className="font-medium text-foreground">{titleCase(verdict)}</span>{projection.verification?.proofRequired ? ' · Proof gate required' : ' · No proof gate recorded'}</p>
        </div>
      </details>

      {(isStopped || approvalPending || secondaryActions.length > 0 || actionError) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isStopped && (
            <div className="flex min-w-0 items-start gap-1.5 text-[10px] text-amber-200" role="status" data-testid="status-stopped">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span><span className="font-semibold">Server outcome:</span> {titleCase(projection.stopped?.outcome)}</span>
            </div>
          )}
          {approvalPending && <span className="text-[10px] font-semibold text-amber-200" data-testid="status-approval">Approval required before continuing</span>}
          {actionError && <span className="text-[10px] text-red-200" role="alert" data-testid="text-action-error">{actionError}</span>}
          {secondaryActions.length > 0 && (
            <details className="ml-auto w-full rounded-md border border-border/45 bg-background/20" data-testid="advanced-actions">
              <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground">
                More actions ({secondaryActions.length})
              </summary>
              <div className="flex flex-wrap justify-end gap-1.5 border-t border-border/40 px-2.5 py-2" aria-label="Additional execution actions">
                {secondaryActions.map((action) => {
                  const pending = pendingAction === action;
                  return (
                    <button
                      key={action}
                      type="button"
                      data-testid={`button-action-${action.toLowerCase()}`}
                      className="inline-flex items-center rounded border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void runAction(action)}
                      disabled={pendingAction !== null}
                      title={onAction ? undefined : 'This action is handled by the owning execution surface'}
                    >
                      {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : actionIcon(action)}
                      {pending ? 'Working…' : actionLabels[action]}
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default ExecutionProjectionPanel;