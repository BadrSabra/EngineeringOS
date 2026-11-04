import { useState } from 'react';
import { Activity, CheckCircle2, ChevronRight, Clock3, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AiStreamExecutionSummary, Event as ApiEvent } from '@workspace/api-client-react';
import type { PublicValidationResult } from '@workspace/ai-orchestrator';
import { type DashboardExecutionSummary, type FinalForensicVerdict, type ForensicEvidenceSummary, type ToolTraceEntry, formatStopReason } from './trace-parsing';

export function ExecutionSummaryBanner({
  summary,
  operatorTraceId,
  visible = true,
}: {
  summary: DashboardExecutionSummary | null;
  operatorTraceId?: string;
  visible?: boolean;
}) {
  const hasSynthesisTelemetry =
    summary?.synthesisAttempts !== undefined ||
    summary?.synthesisTimeoutMs !== undefined ||
    summary?.synthesisTimedOut !== undefined;
  if (
    !visible ||
    !summary ||
    (summary.stopReason === 'response' && summary.diagnosticCodes.length === 0 && !hasSynthesisTelemetry)
  ) {
    return null;
  }

  return (
    <div className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-muted-foreground">
      {summary.stopReason !== 'response' && (
        <span className="mr-1 font-semibold text-amber-200">INCOMPLETE:</span>
      )}
      <span className="text-amber-300">Execution diagnostic:</span>{' '}
      {summary.diagnosticCodes.some((code) => code === 'EXECUTION_PROVIDER_FAILURE') ? (
        <span className="text-red-300">provider failure — </span>
      ) : null}
      {String(summary.stopReason) === 'tool_failure' || summary.diagnosticCodes.some((code) =>
        code === 'TOOL_EXECUTION_FAILED' || code === 'TOOL_UNAVAILABLE' || code === 'TOOL_CANCELLED',
      ) ? (
        <span className="font-semibold text-red-300">required tool did not complete — BLOCKED/INCOMPLETE; no completed operation may be claimed — </span>
      ) : null}
      {summary.diagnosticCodes.some((code) => code === 'EXECUTION_NO_EDIT_TOOL') ? (
        <span className="text-amber-200">stopped before an edit tool — </span>
      ) : null}
      {summary.diagnosticCodes.some((code) =>
        code === 'EXECUTION_RESPONSE_FORMAT_INVALID' ||
        code === 'EXECUTION_JSON_CORRECTION_FAILED' ||
        code === 'EXECUTION_JSON_CORRECTION_RETRY_FAILED',
      ) ? (
        <span className="text-amber-200">response format/correction failure — </span>
      ) : null}
      {summary.stopReason !== 'response'
        ? `stopped: ${summary.stopReason.replace(/_/g, ' ')} · ${summary.iterations}/${summary.maxIterations} iterations · ${summary.toolCalls} tool calls`
        : summary.recoveryStarted
          ? 'the response required bounded forensic recovery'
          : summary.synthesisStarted
            ? 'the response completed after synthesis'
            : 'the response completed'}{' '}
      {summary.synthesisStarted ? '· synthesis attempted ' : ''}
      {hasSynthesisTelemetry && (
        <div className="mt-2 rounded border border-border/40 bg-background/20 px-2.5 py-2 text-[10px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-foreground/85">Synthesis</span>
            {summary.synthesisAttempts !== undefined && (
              <span>{summary.synthesisAttempts} attempt{summary.synthesisAttempts === 1 ? '' : 's'}</span>
            )}
            {summary.synthesisMaxAttempts !== undefined && <span>max {summary.synthesisMaxAttempts}</span>}
            {summary.synthesisTimeoutMs !== undefined && <span>budget {summary.synthesisTimeoutMs} ms</span>}
            {summary.synthesisElapsedMs !== undefined && <span>elapsed {summary.synthesisElapsedMs} ms</span>}
            {summary.synthesisTimedOut === true && <span className="font-semibold text-amber-200">timed out</span>}
            {summary.synthesisTimedOut === false && <span className="text-emerald-200">completed within budget</span>}
          </div>
          {summary.synthesisTimedOut === true && operatorTraceId && (
            <a href={`#${operatorTraceId}`} className="mt-1 inline-flex text-primary underline-offset-2 hover:underline">
              ANALYSIS_INCOMPLETE details are preserved in the operator trace below
            </a>
          )}
        </div>
      )}
      {summary.diagnosticCodes.length > 0
        ? `· ${summary.diagnosticCodes.join(', ')}`
        : ''}
      {summary.diagnosticDetails && summary.diagnosticDetails.length > 0
        ? <div className="mt-1 text-[10px] text-muted-foreground">{summary.diagnosticDetails.join(' · ')}</div>
        : null}
    </div>
  );
}

export function PersistedExecutionProof({
  summary,
  trace,
  evidence,
  finalVerdict,
  behaviorEvidenceCount,
  traceId,
}: {
  summary: AiStreamExecutionSummary | null;
  trace: ToolTraceEntry[];
  evidence: ForensicEvidenceSummary | null;
  finalVerdict: FinalForensicVerdict | null;
  behaviorEvidenceCount: number;
  traceId?: string;
}) {
  if (!summary) return null;

  const readCalls = trace.filter(
    (entry) =>
      entry.kind === 'tool_call' &&
      (entry.tool === 'read_file' || entry.tool === 'read_file_range'),
  ).length;
  const completedReads = evidence?.completedReads ?? readCalls;
  const sourceReadLabel = completedReads === 1 ? 'source read' : 'source reads';
  const integrity = evidence?.evidenceIntegrity;
  const incompleteBeforeEvidence =
    summary.toolCalls === 0 &&
    summary.diagnosticCodes.some((code) =>
      code.includes('INCOMPLETE_BEFORE_EVIDENCE') || code.includes('INVESTIGATION_START_FAILURE'),
    );
  const verdict =
    finalVerdict ??
    (evidence?.forensicStatus?.findingStatus
      ? evidence.forensicStatus.findingStatus
      : incompleteBeforeEvidence ? 'INCOMPLETE' : 'COMPLETED');
  const isBlocked = verdict === 'NOT PROVEN' || verdict === 'INCOMPLETE' || integrity?.consistent === false;
  const verdictClass = isBlocked
    ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
    : verdict === 'FINDING PROVEN' || verdict === 'PROVEN'
      ? 'border-green-500/30 bg-green-500/5 text-green-200'
      : 'border-border/50 bg-background/20 text-foreground';

  return (
    <details id={traceId} className="mt-1 w-full min-w-0 max-w-full rounded-lg border border-border/50 bg-background/20 text-[10px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
        <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${isBlocked ? 'text-amber-300' : 'text-green-300'}`} />
        <span className="font-medium text-foreground">Persisted execution proof</span>
        <span className={`rounded-full border px-1.5 py-0.5 font-semibold ${verdictClass}`}>
          {String(verdict).replace(/_/g, ' ')}
        </span>
        <span className="ml-auto text-[9px]">
          {summary.toolCalls} tools · {completedReads} {sourceReadLabel}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 transition-transform [[open]>&]:rotate-90" />
      </summary>
      <div className="grid grid-cols-2 gap-px border-t border-border/40 bg-border/30 sm:grid-cols-4">
        <div className="bg-background/25 px-3 py-2">
          <div className="text-muted-foreground">Execution</div>
          <div className="mt-0.5 font-medium text-foreground">
            {summary.iterations}/{summary.maxIterations} iterations
          </div>
        </div>
        <div className="bg-background/25 px-3 py-2">
          <div className="text-muted-foreground">Evidence</div>
          <div className={`mt-0.5 font-medium ${isBlocked ? 'text-amber-200' : 'text-foreground'}`}>
            {completedReads > 0 ? `${completedReads} ${sourceReadLabel}` : 'No source reads'}
          </div>
        </div>
        <div className="bg-background/25 px-3 py-2">
          <div className="text-muted-foreground">Safety</div>
          <div className="mt-0.5 font-medium text-green-300">Writes gated</div>
        </div>
        <div className="bg-background/25 px-3 py-2">
          <div className="text-muted-foreground">Terminal</div>
          <div className="mt-0.5 break-words font-medium text-foreground">
            {formatStopReason(summary.stopReason, summary.synthesisStarted)}
          </div>
        </div>
      </div>
      <div className="space-y-1 border-t border-border/40 px-3 py-2 text-muted-foreground">
        {integrity && (
          <div className={integrity.consistent ? 'text-green-200' : 'text-red-200'}>
            {integrity.consistent
              ? 'Telemetry reconciliation passed'
              : `Telemetry reconciliation blocked ${integrity.violations.length || 1} unsupported claim${integrity.violations.length === 1 ? '' : 's'}`}
          </div>
        )}
        {evidence?.forensicStatus && (
          <div>
            Evidence scope: {evidence.forensicStatus.auditScope.replace(/_/g, ' ')} · source coverage: {evidence.forensicStatus.sourceCoverage}
          </div>
        )}
        {behaviorEvidenceCount > 0 && (
          <div>{behaviorEvidenceCount} claim-bound evidence excerpt{behaviorEvidenceCount === 1 ? '' : 's'} retained</div>
        )}
      </div>
    </details>
  );
}

export function OperationTracePanel({
  operationId,
  events,
  isLoading,
}: {
  operationId?: string;
  events: ApiEvent[];
  isLoading: boolean;
}) {
  if (!operationId) return null;

  const phases = [
    { label: 'Plan', types: ['AiPlanCreated'] },
    { label: 'Approval', types: ['AiPlanApproved'] },
    { label: 'Build', types: ['AiBuildStarted', 'AiBuildCompleted'] },
    { label: 'Validation', types: [] as string[] },
    { label: 'Apply', types: ['AiChangesApplied'] },
    { label: 'Commit', types: ['GitCommitCreated'] },
    { label: 'Push', types: ['GitPushed'] },
  ];
  const hasValidation = events.some((event) => {
    if (event.type !== 'AiChangesApplied') return false;
    const verification = (event.payload as { behavioralVerification?: unknown } | undefined)?.behavioralVerification;
    return Array.isArray(verification) && verification.length > 0 &&
      verification.every((item) => (item as { status?: unknown })?.status === 'passed');
  });
  const applyEvent = events.find((event) => event.type === 'AiChangesApplied');
  const commitEvent = events.find((event) => event.type === 'GitCommitCreated');
  const pushEvent = events.find((event) => event.type === 'GitPushed');
  const applyPayload = applyEvent?.payload ?? {};
  const commitPayload = commitEvent?.payload ?? {};
  const pushPayload = pushEvent?.payload ?? {};
  const appliedFiles = Array.isArray(applyPayload.appliedFiles)
    ? applyPayload.appliedFiles.filter((file): file is string => typeof file === 'string')
    : [];
  const failedFiles = Array.isArray(applyPayload.failedFiles)
    ? applyPayload.failedFiles.filter((file): file is string => typeof file === 'string')
    : [];
  const rollbackFailures = Array.isArray(applyPayload.rollbackFailures)
    ? applyPayload.rollbackFailures
    : [];
  const commitHash = typeof commitPayload.commitHash === 'string' ? commitPayload.commitHash : undefined;
  const committedPaths = Array.isArray(commitPayload.committedPaths)
    ? commitPayload.committedPaths.filter((file): file is string => typeof file === 'string')
    : [];
  const pushHash = typeof pushPayload.commitHash === 'string' ? pushPayload.commitHash : undefined;
  const pushBranch = typeof pushPayload.branch === 'string' ? pushPayload.branch : undefined;
  const applyBlocked = Boolean(applyEvent) && (
    applyPayload.applyStatus !== 'APPLIED'
    || failedFiles.length > 0
    || rollbackFailures.length > 0
  );
  const commitBlocked = Boolean(commitEvent) && !commitHash;
  const pushBlocked = Boolean(pushEvent) && (!pushHash || pushHash !== commitHash);
  const deliveryProven = Boolean(
    applyEvent
    && !applyBlocked
    && commitEvent
    && commitHash
    && pushEvent
    && !pushBlocked,
  );
  const deliveryBlocked = applyBlocked || commitBlocked || pushBlocked;
  const deliveryVerdict = deliveryProven ? 'PROVEN' : deliveryBlocked ? 'BLOCKED' : 'INCOMPLETE';
  const proposalId = typeof applyPayload.proposalId === 'string'
    ? applyPayload.proposalId
    : typeof commitPayload.proposalId === 'string'
      ? commitPayload.proposalId
      : undefined;
  const phaseEvents = phases.map((phase) => {
    const event = phase.types.length > 0
      ? events.find((candidate) => phase.types.includes(candidate.type))
      : undefined;
    const recorded = Boolean(event) || (phase.label === 'Validation' && hasValidation);
    return { ...phase, event, recorded };
  });
  const missingCount = phaseEvents.filter((phase) => !phase.recorded).length;

  return (
    <details className="mt-2 w-full rounded-lg border border-sky-500/25 bg-sky-500/5 text-[10px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground">
        <Activity className="h-3.5 w-3.5 shrink-0 text-sky-300" />
        <span className="font-medium text-foreground">Unified operation trace</span>
        <span className={missingCount === 0 ? 'text-green-300' : 'text-amber-200'}>
          {isLoading
            ? 'loading…'
            : events.length === 0
              ? 'delivery not started'
              : `${events.length} events · ${missingCount} step${missingCount === 1 ? '' : 's'} not recorded`}
        </span>
        <code className="ml-auto hidden max-w-[12rem] truncate text-[9px] text-muted-foreground sm:block">{operationId}</code>
        <ChevronRight className="h-3 w-3 shrink-0" />
      </summary>
      <div className="grid grid-cols-2 gap-px border-t border-border/40 bg-border/30 sm:grid-cols-4 lg:grid-cols-7">
        {phaseEvents.map((phase) => (
          <div key={phase.label} className="bg-background/25 px-2.5 py-2">
            <div className="text-muted-foreground">{phase.label}</div>
            <div className={`mt-0.5 font-medium ${phase.recorded ? 'text-green-300' : 'text-amber-200'}`}>
              {phase.recorded ? 'recorded' : 'not recorded'}
            </div>
            {phase.event && (
              <div className="mt-0.5 truncate text-[9px] text-muted-foreground" title={phase.event.message}>
                {new Date(phase.event.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border/40 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium text-foreground">Delivery proof</div>
            <div className="text-[9px] text-muted-foreground">
              The chain is proven only when Apply, Commit, and Push match this operation.
            </div>
          </div>
          <span className={`rounded-full border px-2 py-0.5 font-semibold ${
            deliveryVerdict === 'PROVEN'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : deliveryVerdict === 'BLOCKED'
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}>
            {deliveryVerdict}
          </span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            {
              label: 'Apply',
              proven: Boolean(applyEvent) && !applyBlocked,
              blocked: applyBlocked,
              detail: applyEvent
                ? applyBlocked
                  ? `${applyPayload.applyStatus ?? 'blocked'}${failedFiles.length > 0 ? ` · ${failedFiles.length} failed` : ''}`
                  : `${appliedFiles.length} file${appliedFiles.length === 1 ? '' : 's'} applied`
                : 'not recorded',
            },
            {
              label: 'Commit',
              proven: Boolean(commitEvent && commitHash),
              blocked: commitBlocked,
              detail: commitEvent
                ? commitHash
                  ? `${commitHash.slice(0, 12)}… · ${committedPaths.length} file${committedPaths.length === 1 ? '' : 's'}`
                  : 'hash missing from evidence'
                : 'not recorded',
            },
            {
              label: 'Push',
              proven: Boolean(pushEvent && !pushBlocked),
              blocked: pushBlocked,
              detail: pushEvent
                ? pushBlocked
                  ? pushHash && commitHash ? 'commit hash mismatch' : 'hash missing from evidence'
                  : `${pushBranch ?? 'branch unknown'} · ${pushHash!.slice(0, 12)}…`
                : 'not recorded',
            },
          ].map((step) => (
            <div key={step.label} className="rounded-md border border-border/50 bg-background/20 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                {step.proven
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-300" />
                  : step.blocked
                    ? <ShieldAlert className="h-3 w-3 text-red-300" />
                    : <Clock3 className="h-3 w-3 text-amber-300" />}
                <span className="font-medium text-foreground">{step.label}</span>
              </div>
              <div className={`mt-1 break-words ${
                step.proven ? 'text-emerald-200' : step.blocked ? 'text-red-200' : 'text-amber-200'
              }`}>
                {step.proven ? 'proven' : step.blocked ? 'blocked' : 'not recorded'}
              </div>
              <div className="mt-0.5 break-words text-[9px] text-muted-foreground">{step.detail}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
          <span>operation: <code>{operationId}</code></span>
          {proposalId && <span>proposal: <code>{proposalId}</code></span>}
          {commitHash && <span title={commitHash}>commit: <code>{commitHash.slice(0, 12)}…</code></span>}
        </div>
      </div>
      <div className="space-y-1 border-t border-border/40 px-3 py-2">
        {isLoading ? (
          <div className="text-muted-foreground">Loading persisted operation events…</div>
        ) : events.length === 0 ? (
          <div className="text-amber-200">No delivery events have been recorded for this operation yet.</div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="flex min-w-0 gap-2 text-muted-foreground">
              <span className="w-32 shrink-0 text-[9px]">{new Date(event.timestamp).toLocaleTimeString()}</span>
              <span className="w-36 shrink-0 truncate text-sky-200">{event.type}</span>
              <span className="min-w-0 truncate">{event.message || 'No event message'}</span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

type RepairRadarAttempt = {
  id: string;
  attempt: number | null;
  status: PublicValidationResult['status'];
  state?: ToolTraceEntry['repairState'];
  profile?: string;
  permittedOrigin?: string;
  revision?: string;
  detail?: string;
  failedTests: never[];
  affectedFiles: string[];
  diagnosis: string;
  patches: Array<{
    path: string;
    reason?: string;
    finding?: string;
    risk?: string;
    expectedValidation?: string;
  }>;
  remainingRisk: string;
};

type RepairRadarData = {
  attempts: RepairRadarAttempt[];
  state: ToolTraceEntry['repairState'];
  stateReason?: string;
};

export function parseRepairRadar(trace: ToolTraceEntry[]): RepairRadarData | null {
  const validationEntries = trace.filter((entry) => entry.kind === 'validation');
  const repairStateEntries = trace.filter(
    (entry) => entry.kind === 'repair_state' && entry.repairState,
  );
  if (validationEntries.length === 0 && repairStateEntries.length === 0) return null;

  const patchEntries = trace
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) =>
      entry.kind === 'tool_call' &&
      (entry.tool === 'write_file' || entry.tool === 'replace_text'),
    );
  let previousValidationIndex = -1;
  const attempts = validationEntries.map((entry, index) => {
    const validationIndex = trace.indexOf(entry);
    const patches = patchEntries
      .filter(({ index: patchIndex }) => patchIndex > previousValidationIndex && patchIndex < validationIndex)
      .map(({ entry: patch }) => ({
        path: patch.args?.path ?? patch.args?.file ?? patch.source ?? 'Unknown file',
        reason: patch.args?.reason ?? patch.reasoning,
        finding: patch.args?.findingId ?? patch.args?.finding ?? patch.args?.evidenceId,
        risk: patch.args?.risk,
        expectedValidation: patch.args?.validationProfile ?? patch.args?.profile,
      }));
    previousValidationIndex = validationIndex;
    const status = entry.validation?.status ?? entry.validationStatus ?? 'unavailable';
    const detail = entry.validation?.detail ?? entry.validationDetail;
    return {
      // The canonical object is authoritative; the remaining values only let
      // previously persisted traces remain readable after the contract change.
      validation: entry.validation,
      id: `${entry.kind}-${index}`,
      attempt: typeof entry.attempt === 'number'
        ? entry.attempt
        : typeof entry.validationAttempt === 'number' ? entry.validationAttempt : null,
      status,
      profile: entry.validation?.profile ?? entry.validationProfile,
      permittedOrigin: entry.validation?.evidence?.permittedOrigin,
      revision: entry.validation?.evidence?.revision,
      detail,
      failedTests: [],
      affectedFiles: [],
      diagnosis: detail ?? (status === 'passed'
          ? 'The previous patch passed its registered validation.'
          : 'No diagnosis was persisted for this attempt.'),
      patches,
      remainingRisk: status === 'passed'
        ? 'Validation passed; approval and scope gates still protect the workspace.'
        : status === 'failed'
          ? 'The validation failure remains unresolved; another bounded repair or manual review is required.'
          : 'The execution did not produce enough validation evidence to clear delivery.',
    };
  });
  const latestState = repairStateEntries.at(-1);

  return {
    attempts,
    state: latestState?.repairState,
    stateReason: latestState?.reason,
  };
}

export function repairRadarStateLabel(state: ToolTraceEntry['repairState']): string {
  switch (state) {
    case 'VALIDATING':
      return 'Validating';
    case 'REPAIRING':
      return 'Repairing';
    case 'READY_FOR_REVIEW':
      return 'Ready for review';
    case 'BLOCKED':
      return 'Blocked';
    default:
      return 'Evidence captured';
  }
}

function repairRadarStatusClasses(status: RepairRadarAttempt['status']): string {
  switch (status) {
    case 'passed':
      return 'border-green-500/40 bg-green-500/10 text-green-200';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-200';
    case 'blocked':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
    case 'skipped':
      return 'border-border/60 bg-background/30 text-muted-foreground';
    default:
      return 'border-amber-500/30 bg-amber-500/5 text-amber-100';
  }
}

export function RepairRadar({ trace }: { trace: ToolTraceEntry[] }) {
  const radar = parseRepairRadar(trace);
  const [expanded, setExpanded] = useState(false);
  if (!radar) return null;

  const passed = radar.attempts.filter((attempt) => attempt.status === 'passed').length;
  const failed = radar.attempts.filter((attempt) => attempt.status === 'failed').length;
  const stateClasses =
    radar.state === 'READY_FOR_REVIEW'
      ? 'border-green-500/40 bg-green-500/10 text-green-200'
      : radar.state === 'BLOCKED'
        ? 'border-red-500/40 bg-red-500/10 text-red-200'
        : 'border-primary/35 bg-primary/10 text-primary';

  return (
    <div className="mt-1 w-full overflow-hidden rounded-lg border border-border/50 bg-background/20 text-[11px]" aria-label="Repair Radar">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background/40"
      >
        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">Repair Radar</span>
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${stateClasses}`}>
          {repairRadarStateLabel(radar.state)}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {radar.attempts.length} validation{radar.attempts.length === 1 ? '' : 's'}
          {radar.attempts.length > 0 ? ` · ${passed} passed · ${failed} failed` : ''}
        </span>
        <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
          {radar.stateReason && (
            <div className="rounded border border-border/40 bg-background/30 px-2 py-1.5 text-muted-foreground">
              {radar.stateReason}
            </div>
          )}
          {radar.attempts.length > 0 ? (
            <div className="space-y-1.5">
              {radar.attempts.map((attempt) => (
                <div key={attempt.id} className="rounded border border-border/40 bg-background/20 px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-foreground">
                      {attempt.attempt != null ? `Attempt ${attempt.attempt}` : 'Validation'}
                    </span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${repairRadarStatusClasses(attempt.status)}`}>
                      {attempt.status}
                    </span>
                    {attempt.state && (
                      <span className="text-[10px] text-muted-foreground">
                        · {repairRadarStateLabel(attempt.state)}
                      </span>
                    )}
                    {attempt.profile && (
                      <span className="text-[10px] text-cyan-200">profile: {attempt.profile}</span>
                    )}
                    {attempt.profile && (
                      <code className="ml-auto max-w-full break-all text-[9px] text-muted-foreground">{attempt.profile}</code>
                    )}
                  </div>
                  {(attempt.permittedOrigin || attempt.revision) && (
                    <div className="mt-1 break-words text-[9px] text-muted-foreground">
                      Safe browser evidence
                      {attempt.permittedOrigin ? ` · origin ${attempt.permittedOrigin}` : ''}
                      {attempt.revision ? ` · revision ${attempt.revision}` : ''}
                    </div>
                  )}
                  {attempt.detail && (
                    <div className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{attempt.detail}</div>
                  )}
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    <div className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-red-200/80">Diagnosis</div>
                      <div className="mt-0.5 break-words text-[10px] text-foreground/80">{attempt.diagnosis}</div>
                    </div>
                    <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-200/80">Remaining risk</div>
                      <div className="mt-0.5 break-words text-[10px] text-foreground/80">{attempt.remainingRisk}</div>
                    </div>
                  </div>
                  {attempt.patches.length > 0 && (
                    <div className="mt-2 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-primary">Patch provenance</div>
                      <div className="mt-1 space-y-1">
                        {attempt.patches.map((patch, patchIndex) => (
                          <div key={`${patch.path}-${patchIndex}`} className="text-[10px] text-foreground/80">
                            <code className="break-all text-primary">{patch.path}</code>
                            {patch.finding && <span className="text-muted-foreground"> · driven by {patch.finding}</span>}
                            {patch.risk && <span className="text-muted-foreground"> · risk {patch.risk}</span>}
                            {(patch.reason || patch.expectedValidation) && (
                              <div className="mt-0.5 break-words text-muted-foreground">
                                {patch.reason ?? 'No patch rationale captured.'}
                                {patch.expectedValidation ? ` · expected ${patch.expectedValidation}` : ''}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">No validation result was persisted for this repair state.</div>
          )}
          <div className="text-[10px] leading-4 text-muted-foreground">
            Validation evidence is shown here; a ready state still keeps writes behind the approval gate.
          </div>
        </div>
      )}
    </div>
  );
}

export function ForensicFallbackBanner({
  evidenceOnly,
  noFinding,
}: {
  evidenceOnly: boolean;
  noFinding: boolean;
}) {
  return (
    <div className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="text-amber-300">Forensic report:</span>{' '}
      {noFinding
        ? 'The completed source reads did not directly prove a defect. This is a valid NO FINDING result; no repair phase was accepted.'
        : evidenceOnly
        ? 'Completed source reads were preserved and the Evidence Map was rebuilt deterministically, but the report remained NOT PROVEN; no repair phase was accepted.'
        : 'No verified report was produced from the available evidence. The response was safely downgraded to NOT PROVEN; no repair phase was accepted.'}
    </div>
  );
}
