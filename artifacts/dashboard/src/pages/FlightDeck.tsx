import { useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, GitBranch, Circle, GitCommit, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiExecution,
  useGetGitStatus,
  useGetGitLog,
  useGitCommit,
  useGitPush,
} from '@workspace/api-client-react';
import type { OperationEvidenceProjection } from '@workspace/api-client-react';

type FlightNode = {
  id: string;
  title: string;
  status: string;
  allowedFiles: string[];
  dependencies: string[];
  validationProfile: string;
  attempts: number;
};

const PHASES = [
  { label: 'Mission', states: ['BUILDING'] },
  { label: 'Plan', states: ['BUILDING'] },
  { label: 'Explore', states: ['BUILDING'] },
  { label: 'Build', states: ['BUILDING', 'REPAIRING'] },
  { label: 'Validate', states: ['VALIDATING'] },
  { label: 'Repair', states: ['REPAIRING'] },
  { label: 'Review', states: ['READY_FOR_REVIEW'] },
  { label: 'Apply', states: ['APPLIED'] },
  { label: 'Commit', states: ['COMMITTED'] },
  { label: 'Push', states: ['PUSHED'] },
] as const;

function readExecutionId(): string {
  return new URLSearchParams(window.location.search).get('executionId') ?? '';
}

function readQueryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function stateLabel(state: string | undefined): string {
  return (state ?? 'BUILDING').replace(/_/g, ' ');
}

function stateClasses(state: string | undefined): string {
  if (state === 'BLOCKED') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (state === 'CANCELLED') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (state === 'READY_FOR_REVIEW' || state === 'APPLIED' || state === 'COMMITTED' || state === 'PUSHED' || state === 'COMPLETED') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-primary/40 bg-primary/10 text-primary';
}

function evidenceClasses(verdict: string): string {
  if (verdict === 'PROVEN') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  if (verdict === 'PARTIAL') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (verdict === 'BLOCKED' || verdict === 'UNAVAILABLE') return 'border-red-500/40 bg-red-500/10 text-red-200';
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function checkpointNodes(checkpoint: Record<string, unknown> | undefined): FlightNode[] {
  if (!checkpoint || !Array.isArray(checkpoint.nodeStates)) return [];
  return checkpoint.nodeStates.filter((node): node is FlightNode => {
    if (!node || typeof node !== 'object') return false;
    const value = node as Partial<FlightNode>;
    return typeof value.id === 'string'
      && typeof value.title === 'string'
      && typeof value.status === 'string'
      && Array.isArray(value.allowedFiles)
      && Array.isArray(value.dependencies)
      && typeof value.validationProfile === 'string'
      && typeof value.attempts === 'number';
  });
}

function formatElapsed(startedAt?: string | null, completedAt?: string | null, now = Date.now()): string {
  if (!startedAt) return 'Not started';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Unavailable';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function objectiveLabel(objective: Record<string, unknown> | null | undefined): string {
  if (!objective) return 'No declared objective was retained.';
  const value = objective.objective ?? objective.description ?? objective.objectiveType;
  return typeof value === 'string' && value.trim()
    ? value
    : 'Declared engineering objective';
}

function evidenceCompletenessLabel(completeness: OperationEvidenceProjection['completeness']): string {
  return completeness === 'retained-with-gaps'
    ? 'Retained with gaps'
    : completeness.replaceAll('-', ' ');
}

function evidenceStageLabel(kind: string): string {
  switch (kind) {
    case 'provider': return 'Provider';
    case 'validation': return 'Validation';
    case 'promotion': return 'Promotion / delivery';
    case 'commit': return 'Commit';
    case 'push': return 'Delivery';
    default: return 'Execution';
  }
}

function evidenceOutcomeLabel(status: string): string {
  switch (status) {
    case 'passed': return 'Verified';
    case 'failed': return 'Blocked';
    case 'blocked': return 'Blocked';
    case 'cancelled': return 'Incomplete';
    case 'unknown': return 'Uncertain';
    default: return 'In progress';
  }
}

function evidenceOutcomeClasses(status: string): string {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200';
  if (status === 'failed' || status === 'blocked') return 'border-red-500/30 bg-red-500/5 text-red-200';
  if (status === 'cancelled') return 'border-amber-500/30 bg-amber-500/5 text-amber-200';
  return 'border-border/60 bg-background/20 text-muted-foreground';
}

function safeEvidenceAction(completeness: OperationEvidenceProjection['completeness']): string {
  if (completeness === 'blocked' || completeness === 'failed') {
    return 'Review the blocked receipt, then rerun the approved validation before applying or delivering.';
  }
  if (completeness === 'cancelled' || completeness === 'partial' || completeness === 'retained-with-gaps') {
    return 'Do not rely on this result as verified; reconnect or start a new run to rebuild the missing proof.';
  }
  if (completeness === 'uncertain') {
    return 'Refresh the project and reconcile the operation against the current revision before retrying.';
  }
  return 'No operator action is required; continue only through the matching server-owned stage.';
}

type DisplayReceipt = {
  kind: string;
  status: string;
  attempt: number;
  timestamp: string;
  detail?: string;
};

function displayReceipts(evidence: OperationEvidenceProjection): DisplayReceipt[] {
  return evidence.receipts.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const value = raw as Record<string, unknown>;
    if (typeof value.kind !== 'string' || typeof value.status !== 'string' || typeof value.timestamp !== 'string') return [];
    return [{
      kind: value.kind,
      status: value.status,
      attempt: typeof value.attempt === 'number' ? value.attempt : 0,
      timestamp: value.timestamp,
      ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
    }];
  });
}

function DeliveryProofTimeline({
  evidence,
  executionVerdict,
}: {
  evidence?: OperationEvidenceProjection;
  executionVerdict?: string;
}) {
  if (!evidence) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100">
        Delivery proof is not available yet. Do not treat this execution as a verified delivery.
      </div>
    );
  }
  const receipts = displayReceipts(evidence);
  const gaps = evidence.gaps ?? [];
  // Operation evidence is intentionally a redacted record, not a delivery
  // attestation. Individual passed receipts are shown as verified, while the
  // chain itself stays conservative until the execution verdict certifies it.
  const isVerified = evidence.completeness === 'complete' && executionVerdict === 'PROVEN';
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Delivery proof chain">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Delivery proof chain</h2>
            <p className="text-xs text-muted-foreground">Candidate, validation, promotion, and delivered-byte receipts for this operation</p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${evidenceOutcomeClasses(isVerified ? 'passed' : evidence.completeness === 'blocked' || evidence.completeness === 'failed' ? 'blocked' : 'unknown')}`}>
            {isVerified ? 'Verified chain' : evidenceCompletenessLabel(evidence.completeness)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>Operation <code className="text-foreground">{evidence.operationId}</code></span>
          <span>Revision <code className="text-foreground">{evidence.revision ?? 'not recorded'}</code></span>
          {evidence.hashes.changeSet && <span>Candidate <code className="text-foreground">{evidence.hashes.changeSet}</code></span>}
          {evidence.hashes.committed && <span>Delivered bytes <code className="text-foreground">{evidence.hashes.committed}</code></span>}
        </div>
      </div>
      <div className="divide-y divide-border/50">
        {receipts.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">No redacted receipts were retained.</div>
        ) : receipts.map((receipt, index) => (
          <div key={`${receipt.kind}-${receipt.timestamp}-${index}`} className="flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{evidenceStageLabel(receipt.kind)}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${evidenceOutcomeClasses(receipt.status)}`}>{evidenceOutcomeLabel(receipt.status)}</span>
                <span className="text-[10px] text-muted-foreground">attempt {receipt.attempt}</span>
              </div>
              {receipt.detail && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{receipt.detail}</p>}
              <time className="mt-1 block text-[10px] text-muted-foreground">{new Date(receipt.timestamp).toLocaleString()}</time>
            </div>
          </div>
        ))}
      </div>
      {gaps.length > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="text-xs font-semibold text-amber-200">Proof gaps</div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-amber-100/80">
            {gaps.map((gap, index) => <li key={`${gap.source}-${gap.kind}-${index}`}>{gap.detail}</li>)}
          </ul>
        </div>
      )}
      {!isVerified && (
        <div className="border-t border-border/50 px-4 py-3 text-[11px] text-muted-foreground">
          <span className="font-semibold text-amber-200">Next safe action: </span>{safeEvidenceAction(evidence.completeness)}
        </div>
      )}
    </section>
  );
}

export default function FlightDeck() {
  const executionId = readExecutionId();
  const requestedProjectId = readQueryParam('projectId');
  const requestedOperationId = readQueryParam('operationId');
  const queryClient = useQueryClient();
  const [commitMessage, setCommitMessage] = useState('');
  const { data: execution, isLoading, isError } = useGetAiExecution(executionId, {
    query: {
      queryKey: ['ai-flight-deck-execution', executionId],
      enabled: Boolean(executionId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'queued' || status === 'running' || status === 'cancelling' ? 1500 : false;
      },
    },
  });
  const projectId = execution?.projectId ?? requestedProjectId;
  const operationId = execution?.operationId ?? requestedOperationId;
  const gitStatus = useGetGitStatus(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: ['flight-deck-git-status', projectId],
      refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
      retry: false,
    },
  });
  const gitLog = useGetGitLog(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: ['flight-deck-git-log', projectId],
      staleTime: 15_000,
    },
  });
  const commitMutation = useGitCommit({
    mutation: {
      onSuccess: () => {
        setCommitMessage('');
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] });
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-log', projectId] });
        queryClient.invalidateQueries({ queryKey: ['ai-flight-deck-execution', executionId] });
      },
    },
  });
  const pushMutation = useGitPush({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] });
        queryClient.invalidateQueries({ queryKey: ['ai-flight-deck-execution', executionId] });
      },
    },
  });

  if (!executionId) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-8 text-center">
        <Activity className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">Flight Deck</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open this view from an AI execution using <code>?executionId=…</code>.
        </p>
        <Link href="/ai" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Open AI Assistant
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">Loading durable operation proof…</div>;
  }

  if (isError || !execution) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-center gap-2 font-semibold text-red-200">
          <AlertTriangle className="h-4 w-4" />
          Execution proof unavailable
        </div>
        <p className="mt-2 text-sm text-muted-foreground">The server did not return a durable execution for this id.</p>
        <Link href="/ai" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to AI Assistant
        </Link>
      </div>
    );
  }

  const state = execution.flightState ?? (
    execution.status === 'failed' || execution.status === 'completed'
      ? 'BLOCKED'
      : execution.status === 'cancelled' || execution.status === 'cancelling'
        ? 'CANCELLED'
        : 'BUILDING'
  );
  const evidenceVerdict = execution.evidenceVerdict ?? 'NOT_RECORDED';
  const checkpoint = execution.checkpoint;
  const nodes = checkpointNodes(checkpoint);
  const isDeliveryExecution = execution.proofRequired
    || Boolean(execution.proposalId || execution.buildPlanMessageId || execution.linkedTaskId);
  const activePhase = isDeliveryExecution
    ? PHASES.findIndex((phase) => phase.states.includes(state as never))
    : -1;
  const stage = typeof checkpoint.stage === 'string' ? checkpoint.stage : 'server checkpoint';
  const detail = typeof checkpoint.detail === 'string' ? checkpoint.detail : 'Evidence is retained by the durable execution record.';
  const scopeFiles = [...new Set(nodes.flatMap((node) => node.allowedFiles))];
  const blockedNodes = nodes.filter((node) => node.status === 'blocked' || node.status === 'failed').length;
  const riskLabel = blockedNodes > 0
    ? `${blockedNodes} blocked node${blockedNodes === 1 ? '' : 's'}`
    : evidenceVerdict !== 'PROVEN' && isDeliveryExecution
      ? `Evidence ${stateLabel(evidenceVerdict).toLowerCase()}`
      : nodes.some((node) => node.attempts >= 3)
        ? 'Retry budget exhausted'
        : 'No unresolved risk recorded';
  const elapsed = formatElapsed(execution.startedAt, execution.completedAt);
  const changedFiles = gitStatus.data?.files ?? [];
  const canCommit = isDeliveryExecution && state === 'APPLIED'
    && Boolean(execution.proposalId && operationId)
    && changedFiles.length > 0
    && Boolean(commitMessage.trim());
  const canPush = isDeliveryExecution && state === 'COMMITTED' && Boolean(execution.proposalId && operationId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/ai" className="rounded p-1 hover:bg-secondary hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link>
        <span>AI Assistant</span><span>/</span><Link href="/mission-control" className="hover:text-foreground hover:underline">Mission Control</Link><span>/</span><span className="text-foreground">Flight Deck</span>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 text-primary"><GitBranch className="h-5 w-5" /></div>
              <div>
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Code Flight Deck</p>
                <h1 className="text-2xl font-bold tracking-tight">{isDeliveryExecution ? 'Mission → Push' : 'Audit / Chat run'}</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{detail}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <code className="rounded border border-border/60 px-2 py-1">execution {execution.id}</code>
              {projectId && <code className="rounded border border-border/60 px-2 py-1">project {projectId}</code>}
              {execution.proposalId && <code className="rounded border border-border/60 px-2 py-1">proposal {execution.proposalId}</code>}
              {operationId && <code className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-primary">operation {operationId}</code>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            {!isDeliveryExecution && (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-500/40 bg-slate-500/10 px-3 py-1.5 text-xs font-semibold text-slate-200">
                Non-delivery run
              </div>
            )}
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${stateClasses(state)}`}>
              {state === 'BLOCKED' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
              {stateLabel(state)}
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${evidenceClasses(evidenceVerdict)}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Proof: {stateLabel(evidenceVerdict)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Mission control summary">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 lg:col-span-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Objective</div>
            <div className="mt-1 break-words text-sm font-medium text-foreground">{objectiveLabel(execution.objective)}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Elapsed</div>
            <div className="mt-1 text-sm font-medium tabular-nums text-foreground">{elapsed}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Scope</div>
            <div className="mt-1 text-sm font-medium text-foreground">{scopeFiles.length} files · {nodes.length} nodes</div>
          </div>
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk</div>
            <div className={`mt-1 text-sm font-medium ${blockedNodes > 0 || evidenceVerdict === 'BLOCKED' ? 'text-red-200' : 'text-amber-200'}`}>{riskLabel}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-5">
          {PHASES.map((phase, index) => {
            const complete = activePhase >= 0 && index < activePhase;
            const active = index === activePhase;
            return (
              <div key={phase.label} className={`rounded-md border px-3 py-2 ${active ? 'border-primary/50 bg-primary/10' : 'border-border/60 bg-background/20'}`}>
                <div className="flex items-center gap-2">
                  {complete ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : active ? <Activity className="h-3.5 w-3.5 text-primary" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className={`text-xs font-medium ${active ? 'text-primary' : complete ? 'text-emerald-200' : 'text-muted-foreground'}`}>{phase.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div><h2 className="font-semibold">Plan nodes</h2><p className="text-xs text-muted-foreground">Server-owned scopes, dependencies, and validation</p></div>
            <span className="text-xs text-muted-foreground">{nodes.length} node{nodes.length === 1 ? '' : 's'}</span>
          </div>
          <div className="divide-y divide-border/60">
            {nodes.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">No node snapshot is available in this checkpoint yet.</div>
            ) : nodes.map((node) => (
              <div key={node.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-sm font-medium">{node.title}</div><code className="text-[10px] text-muted-foreground">{node.id}</code></div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stateClasses(node.status === 'failed' || node.status === 'blocked' ? 'BLOCKED' : node.status === 'passed' ? 'COMPLETED' : 'BUILDING')}`}>{node.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded border border-border/60 px-2 py-1">validation: {node.validationProfile}</span>
                  <span className="rounded border border-border/60 px-2 py-1">attempts: {node.attempts}</span>
                  <span className="rounded border border-border/60 px-2 py-1">scope: {node.allowedFiles.length} file{node.allowedFiles.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5">
           <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Proof ledger</h2>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Execution status</span><span className="font-medium">{execution.status}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Checkpoint</span><span className="font-medium">v{execution.checkpointVersion}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Current stage</span><span className="font-medium">{stage}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Proof required</span><span className="font-medium">{execution.proofRequired ? 'Yes' : 'No'}</span></div>
               <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Evidence verdict</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${evidenceClasses(evidenceVerdict)}`}>{stateLabel(evidenceVerdict)}</span></div>
              <div className="flex items-center justify-between rounded-md bg-background/30 px-3 py-2"><span className="text-muted-foreground">Resumable</span><span className={execution.resumable ? 'text-amber-200' : 'text-emerald-200'}>{execution.resumable ? 'Available' : 'No'}</span></div>
            </div>
            {execution.evidenceReason && <p className="mt-3 rounded-md border border-border/50 bg-background/20 p-3 text-xs text-muted-foreground">{execution.evidenceReason}</p>}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Workspace control rail</h2>
                <p className="mt-1 text-xs text-muted-foreground">Git actions stay bound to this operation and verified proposal.</p>
              </div>
              <button
                type="button"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['flight-deck-git-status', projectId] })}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Refresh workspace status"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${gitStatus.isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {!projectId ? (
              <p className="mt-3 text-xs text-amber-200">This execution has no project scope, so workspace actions are unavailable.</p>
            ) : gitStatus.isError ? (
              <p className="mt-3 text-xs text-red-200">Workspace status unavailable. No Git action is enabled.</p>
            ) : (
              <>
                <div className="mt-3 rounded-md bg-background/30 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Working tree: </span>
                  <span className={gitStatus.data?.clean ? 'text-emerald-200' : 'text-amber-200'}>
                    {gitStatus.data?.clean ? 'clean' : `${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                {changedFiles.length > 0 && (
                  <div className="mt-2 max-h-24 space-y-1 overflow-y-auto text-[11px] font-mono text-muted-foreground">
                    {changedFiles.map((file) => <div key={file.path}>{file.status || '?'} {file.path}</div>)}
                  </div>
                )}
                <label className="mt-3 block text-xs text-muted-foreground">
                  Commit message
                  <input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    placeholder="Describe the verified change…"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
                    disabled={state !== 'APPLIED' || !execution.proposalId || !operationId}
                  />
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => commitMutation.mutate({
                      projectId,
                      data: { message: commitMessage.trim(), proposalId: execution.proposalId ?? undefined, operationId: operationId || undefined },
                    })}
                    disabled={!canCommit || commitMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {commitMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
                    Commit verified apply
                  </button>
                  <button
                    type="button"
                    onClick={() => pushMutation.mutate({
                      projectId,
                      data: { proposalId: execution.proposalId ?? undefined, operationId: operationId || undefined },
                    })}
                    disabled={!canPush || pushMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pushMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Push committed operation
                  </button>
                </div>
                {(commitMutation.isError || pushMutation.isError) && (
                  <p className="mt-2 text-xs text-red-200">
                    {((commitMutation.error ?? pushMutation.error) as Error).message}
                  </p>
                )}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent commits</p>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    {(gitLog.data?.commits ?? []).slice(0, 3).map((commit) => (
                      <div key={commit.hash} className="flex gap-2">
                        <span className="font-mono text-primary">{commit.shortHash}</span>
                        <span className="truncate">{commit.subject}</span>
                      </div>
                    ))}
                    {!gitLog.isLoading && (gitLog.data?.commits ?? []).length === 0 && <span>No commits available.</span>}
                  </div>
                </div>
              </>
            )}
            {state !== 'APPLIED' && state !== 'COMMITTED' && (
              <p className="mt-3 text-[11px] text-muted-foreground">Commit unlocks only after server evidence records a successful Apply. Push unlocks only after the matching Commit event.</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Operation timeline</h2>
            <div className="mt-3 space-y-3 text-xs text-muted-foreground">
              {execution.createdAt && <div className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> Created {new Date(execution.createdAt).toLocaleString()}</div>}
              {execution.updatedAt && <div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5" /> Updated {new Date(execution.updatedAt).toLocaleString()}</div>}
              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-amber-100/80">This workspace is independent from AiChat. Approval and Apply remain explicit; Commit and Push are enabled only from matching server events.</div>
            </div>
          </div>
        </section>
      </div>
      <DeliveryProofTimeline
        evidence={execution.operationEvidence}
        executionVerdict={execution.evidenceVerdict}
      />
    </div>
  );
}