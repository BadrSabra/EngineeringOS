import { useEffect, useState } from 'react';
import { Activity, ChevronRight, ExternalLink, Eye, GitMerge, Pause, Play, ShieldCheck, SkipBack, StepForward } from 'lucide-react';
import { browserValidationBlockExplanation } from './delivery-proof';
import type { ToolTraceEntry } from './trace-parsing';
import { repairRadarStateLabel } from './execution-trace';

type FlightRecorderFilter = 'all' | 'tools' | 'validation' | 'repair' | 'guards' | 'phase_rejections';

function flightRecorderCategory(entry: ToolTraceEntry): Exclude<FlightRecorderFilter, 'all'> {
  if (entry.kind === 'validation') return 'validation';
  if (entry.kind === 'repair_state') return 'repair';
  if (entry.kind === 'diagnostic' && entry.code === 'EXECUTION_PHASE_TOOL_REJECTED') return 'phase_rejections';
  if (entry.kind === 'execution_guard' || entry.kind === 'diagnostic') return 'guards';
  return 'tools';
}

function flightRecorderLabel(entry: ToolTraceEntry): string {
  const toolLabel: Record<string, string> = {
    read_file: 'Read source file',
    read_file_range: 'Read source excerpt',
    search_code: 'Search project source',
    list_directory: 'List project files',
    git_status: 'Check repository status',
    git_diff: 'Review recent changes',
    git_log: 'Review repository history',
    write_file: 'Prepare file change',
    replace_text: 'Prepare focused change',
    run_validation: 'Run registered validation',
  };
  if (entry.kind === 'tool_call') {
    return entry.tool
      ? `Called ${entry.tool} · ${toolLabel[entry.tool] ?? 'Project operation'}`
      : 'Project operation';
  }
  if (entry.kind === 'tool_result') {
    return entry.tool
      ? `${toolLabel[entry.tool] ?? 'Project operation'} completed`
      : 'Project operation completed';
  }
  if (entry.kind === 'model_call' || entry.kind === 'recovery_model_call') {
    return entry.kind === 'recovery_model_call' ? 'Recovery model call' : 'Model call';
  }
  if (entry.kind === 'validation') {
    const status = entry.validation?.status ?? entry.validationStatus;
    return status === 'passed'
      ? 'Validation passed'
      : status === 'failed'
        ? 'Validation failed'
        : 'Validation decision';
  }
  if (entry.kind === 'repair_state') {
    return entry.repairState ? `Repair state: ${repairRadarStateLabel(entry.repairState)}` : 'Repair state';
  }
  if (entry.kind === 'evidence_integrity') return 'Evidence reconciliation';
  if (entry.kind === 'execution_guard') return 'Execution guard';
  if (entry.kind === 'diagnostic' && entry.code === 'EXECUTION_PHASE_TOOL_REJECTED') {
    return 'Phase policy blocked action';
  }
  if (entry.kind === 'diagnostic' && entry.code === 'READ_EVIDENCE_LINKED') {
    return 'Evidence linked';
  }
  if (entry.kind === 'diagnostic' && entry.code === 'REPAIR_ATTEMPT_DIFF') {
    return 'Repair attempt diff';
  }
  if (entry.kind === 'diagnostic') return 'Execution diagnostic';
  return entry.kind.replace(/_/g, ' ');
}

function flightRecorderDetail(entry: ToolTraceEntry): string | undefined {
  if (entry.kind === 'diagnostic' && entry.code === 'EXECUTION_PHASE_TOOL_REJECTED') {
    return [
      entry.phase && `active phase: ${entry.phase}`,
      entry.tool && `rejected tool: ${entry.tool}`,
      entry.details?.[0],
    ].filter(Boolean).join(' · ') || entry.code;
  }
  if (entry.tool && entry.source) return entry.source;
  if (entry.tool && entry.args) {
    const firstArg = Object.values(entry.args)[0];
    if (firstArg) return String(firstArg).slice(0, 120);
  }
  if (entry.kind === 'validation') {
    return [
      entry.validation?.profile ?? entry.validationProfile,
      (entry.attempt ?? entry.validationAttempt) != null
        ? `attempt ${entry.attempt ?? entry.validationAttempt}/${entry.maxAttempts ?? entry.validationMaxAttempts ?? '?'}`
        : undefined,
      entry.validation?.detail ?? entry.validationDetail,
    ].filter(Boolean).join(' · ') || undefined;
  }
  if (entry.kind === 'diagnostic' && entry.code === 'REPAIR_ATTEMPT_DIFF') {
    return entry.details?.[0] ?? entry.code;
  }
  if (entry.kind === 'diagnostic' && entry.code === 'READ_EVIDENCE_LINKED') {
    return entry.details?.[0] ?? entry.code;
  }
  return entry.reason ?? entry.message ?? entry.code ?? entry.model;
}

/** Returns true for tool_call steps on read/write tools that may carry reasoning. */
function isReadWriteToolCall(entry: ToolTraceEntry): boolean {
  if (entry.kind !== 'tool_call') return false;
  const READ_WRITE_TOOLS = new Set([
    'read_file', 'read_file_range', 'search_code', 'list_directory',
    'write_file', 'replace_text',
  ]);
  return Boolean(entry.tool && READ_WRITE_TOOLS.has(entry.tool));
}

function WhyThisFilePanel({ entry }: { entry: ToolTraceEntry }) {
  const filePath = entry.args?.path ?? entry.source ?? entry.args?.pattern ?? null;
  const toolLabel: Record<string, string> = {
    read_file: 'Read file',
    read_file_range: 'Read file range',
    search_code: 'Search code',
    list_directory: 'List directory',
    write_file: 'Propose edit',
    replace_text: 'Propose replacement',
  };
  const label = entry.tool ? (toolLabel[entry.tool] ?? entry.tool) : 'Tool call';

  return (
    <div className="mt-1.5 rounded border border-primary/20 bg-primary/5 px-3 py-2 text-[10px]" aria-label="Why this file?">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-primary">
        <Eye className="h-3 w-3" />
        <span>Why this file?</span>
        <span className="ml-1 rounded bg-background/40 px-1.5 py-0.5 font-mono font-normal text-muted-foreground">{label}</span>
      </div>
      {filePath && (
        <div className="mb-1">
          <span className="text-muted-foreground">File: </span>
          <code className="break-all text-foreground/90">{filePath}</code>
        </div>
      )}
      {entry.reasoning ? (
        <div>
          <span className="text-muted-foreground">Agent reasoning: </span>
          <span className="whitespace-pre-wrap break-words text-foreground/80">{entry.reasoning}</span>
        </div>
      ) : (
        <span className="text-muted-foreground/60 italic">No reasoning captured for this step (cached or prefetched read).</span>
      )}
    </div>
  );
}

function isRepairAttemptDiff(entry: ToolTraceEntry): boolean {
  return entry.kind === 'diagnostic' && entry.code === 'REPAIR_ATTEMPT_DIFF';
}

function isReadEvidenceLinked(entry: ToolTraceEntry): boolean {
  return entry.kind === 'diagnostic' && entry.code === 'READ_EVIDENCE_LINKED';
}

function isValidationEntry(entry: ToolTraceEntry): boolean {
  return entry.kind === 'validation';
}

function ValidationDetailPanel({ entry }: { entry: ToolTraceEntry }) {
  const validation = entry.validation;
  const status = validation?.status ?? entry.validationStatus ?? 'unavailable';
  const blockExplanation = browserValidationBlockExplanation(validation?.reasonCode);
  return (
    <div className="mt-1.5 rounded border border-border/50 bg-black/10 px-3 py-2 text-[10px]" aria-label="Validation details">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground/90">
        <ShieldCheck className="h-3 w-3 text-primary" />
        <span>Validation details</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Status: </span>
          <span className={status === 'passed' ? 'text-green-300' : status === 'failed' ? 'text-red-300' : 'text-amber-200'}>
            {status}
          </span>
        </div>
        {(validation?.exitCode ?? entry.validationExitCode) != null && (
          <div>
            <span className="text-muted-foreground">Exit code: </span>
            <span>{validation?.exitCode ?? entry.validationExitCode}</span>
          </div>
        )}
      </div>
      {blockExplanation && (status === 'blocked' || status === 'unavailable') && (
        <div className="mt-2 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-100" role="note" aria-label="Safe browser validation guidance">
          <div className="font-medium">{blockExplanation.title}</div>
          <div className="mt-0.5 text-amber-100/80">{blockExplanation.action}</div>
        </div>
      )}
    </div>
  );
}

function ReadEvidenceLinkedPanel({ entry }: { entry: ToolTraceEntry }) {
  const path = entry.details?.[0] ?? 'Unknown source file';
  const claim = entry.details?.[1]?.replace(/^claim:\s*/i, '') ?? 'No claim was stated before the read.';

  return (
    <div className="mt-1.5 rounded border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-[10px]" aria-label="Read evidence link">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-cyan-200">
        <ExternalLink className="h-3 w-3" />
        <span>Read → extracted evidence</span>
      </div>
      <div>
        <span className="text-muted-foreground">Source: </span>
        <code className="break-all text-foreground/90">{path}</code>
      </div>
      <div className="mt-1">
        <span className="text-muted-foreground">Claim from this read: </span>
        <span className="whitespace-pre-wrap break-words text-foreground/80">{claim}</span>
      </div>
    </div>
  );
}

function RepairAttemptDiffPanel({ entry }: { entry: ToolTraceEntry }) {
  const diff = entry.details?.slice(1).join('\n') || entry.details?.join('\n') || 'No patch difference captured.';
  const lines = diff.split('\n');

  return (
    <div className="mt-1.5 overflow-hidden rounded border border-amber-500/25 bg-black/20 text-[10px]" aria-label="Repair attempt diff">
      <div className="flex items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-3 py-1.5 font-semibold text-amber-200">
        <GitMerge className="h-3 w-3" />
        <span>What changed in this repair attempt?</span>
      </div>
      <pre className="max-h-56 overflow-auto px-3 py-2 font-mono leading-4">
        {lines.map((line, lineIndex) => {
          const lineClass = line.startsWith('+')
            ? 'text-green-300'
            : line.startsWith('-')
              ? 'text-red-300'
              : line.startsWith('@@')
                ? 'text-cyan-300'
                : line.startsWith('---') || line.startsWith('+++')
                  ? 'text-muted-foreground'
                  : 'text-foreground/75';
          return (
            <span key={`${lineIndex}-${line}`} className={`block whitespace-pre-wrap break-words ${lineClass}`}>
              {line || ' '}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function ReplayCausalNarrative({
  entry,
  index,
  trace,
}: {
  entry: ToolTraceEntry;
  index: number;
  trace: ToolTraceEntry[];
}) {
  const target = entry.args?.path ?? entry.args?.file ?? entry.source;
  const linkedEvidence = entry.kind === 'tool_call' && (
    entry.tool === 'read_file'
    || entry.tool === 'read_file_range'
    || entry.tool === 'search_code'
  )
    ? trace.slice(index + 1).find((candidate) =>
        candidate.kind === 'diagnostic'
        && candidate.code === 'READ_EVIDENCE_LINKED'
        && (!target || candidate.details?.[0] === target),
      )
    : undefined;
  const reason = entry.reasoning ?? entry.args?.reason ?? entry.reason;
  const patchContext = entry.kind === 'tool_call'
    && (entry.tool === 'write_file' || entry.tool === 'replace_text')
    ? [
        target ? `Patch target: ${target}` : undefined,
        entry.args?.findingId ? `Driven by finding: ${entry.args.findingId}` : undefined,
        entry.args?.evidenceId ? `Evidence: ${entry.args.evidenceId}` : undefined,
        entry.args?.validationProfile ? `Expected validation: ${entry.args.validationProfile}` : undefined,
      ].filter(Boolean)
    : [];
  const validation = entry.kind === 'validation' ? entry.validation : undefined;
  const validationStatus = validation?.status ?? entry.validationStatus;
  const detail = entry.kind === 'diagnostic'
    ? entry.details?.slice(0, 3).join(' · ') ?? entry.message
    : undefined;
  if (!reason && !linkedEvidence && patchContext.length === 0 && !validationStatus && !detail) return null;

  return (
    <div className="mt-2 rounded border border-primary/20 bg-primary/5 px-2.5 py-2 text-[10px]" aria-label="Replay causal narrative">
      <div className="mb-1 font-semibold text-primary">Causal narrative</div>
      {reason && (
        <div className="break-words">
          <span className="text-muted-foreground">Why: </span>
          <span className="whitespace-pre-wrap text-foreground/85">{reason}</span>
        </div>
      )}
      {linkedEvidence && (
        <div className="mt-1 break-words text-cyan-100">
          <span className="text-muted-foreground">Evidence produced: </span>
          {linkedEvidence.details?.slice(1).join(' · ') ?? 'Read evidence was linked.'}
        </div>
      )}
      {patchContext.length > 0 && (
        <div className="mt-1 space-y-0.5 text-foreground/80">
          {patchContext.map((item) => <div key={item}>{item}</div>)}
        </div>
      )}
      {validationStatus && (
        <div className={`mt-1 ${validationStatus === 'passed' ? 'text-emerald-200' : validationStatus === 'failed' ? 'text-red-200' : 'text-amber-200'}`}>
          Validation outcome: {validationStatus}
        </div>
      )}
      {detail && <div className="mt-1 break-words text-amber-100">Next transition signal: {detail}</div>}
    </div>
  );
}

export function FlightRecorder({ trace }: { trace: ToolTraceEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<FlightRecorderFilter>('all');
  const [replayIndex, setReplayIndex] = useState(-1);
  const [isReplaying, setIsReplaying] = useState(false);
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(null);
  const [expandedDiffIndex, setExpandedDiffIndex] = useState<number | null>(null);
  const [expandedEvidenceIndex, setExpandedEvidenceIndex] = useState<number | null>(null);
  const [expandedValidationIndex, setExpandedValidationIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isReplaying) return;
    if (replayIndex >= trace.length - 1) {
      setIsReplaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setReplayIndex((current) => Math.min(current + 1, trace.length - 1));
    }, 850);
    return () => window.clearTimeout(timer);
  }, [isReplaying, replayIndex, trace.length]);

  useEffect(() => {
    if (replayIndex >= trace.length) {
      setReplayIndex(trace.length - 1);
    }
  }, [replayIndex, trace.length]);

  if (trace.length === 0) return null;

  const counts = trace.reduce<Record<string, number>>((result, entry) => {
    const category = flightRecorderCategory(entry);
    result[category] = (result[category] ?? 0) + 1;
    return result;
  }, {});
  const visibleTrace = trace
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => filter === 'all' || flightRecorderCategory(entry) === filter);
  const replayEntry = replayIndex >= 0 ? trace[replayIndex] : undefined;
  const replayProgress = replayIndex < 0 ? 0 : replayIndex + 1;

  return (
    <div className="mt-1 w-full overflow-hidden rounded-lg border border-border/50 bg-background/20 text-[11px]" aria-label="Flight Recorder">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-background/40"
      >
        <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">Flight Recorder</span>
        <span className="text-[10px] text-muted-foreground">read-only replay · {trace.length} events</span>
        <ChevronRight className={`ml-auto h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-border/40">
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <label htmlFor="flight-recorder-filter" className="text-[10px] text-muted-foreground">Show</label>
            <select
              id="flight-recorder-filter"
              aria-label="Flight Recorder filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as FlightRecorderFilter)}
              className="rounded border border-border/60 bg-background px-1.5 py-1 text-[10px] text-foreground outline-none focus:border-primary/60"
            >
              <option value="all">All ({trace.length})</option>
              <option value="tools">Tools ({counts.tools ?? 0})</option>
              <option value="validation">Validation ({counts.validation ?? 0})</option>
              <option value="repair">Repair ({counts.repair ?? 0})</option>
              <option value="guards">Guards ({counts.guards ?? 0})</option>
              <option value="phase_rejections">Phase blocks ({counts.phase_rejections ?? 0})</option>
            </select>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Persisted trace · display-only replay · no actions are replayed
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/30 px-3 py-2">
            <button
              type="button"
              aria-label="Reset Flight Recorder replay"
              title="Reset replay"
              onClick={() => {
                setIsReplaying(false);
                setReplayIndex(-1);
              }}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <SkipBack className="h-3 w-3" />
              Reset
            </button>
            <button
              type="button"
              aria-label={isReplaying ? 'Pause Flight Recorder replay' : 'Play Flight Recorder replay'}
              title={isReplaying ? 'Pause replay' : 'Play replay'}
              onClick={() => {
                if (replayIndex >= trace.length - 1) setReplayIndex(-1);
                setIsReplaying((playing) => !playing);
              }}
              className="inline-flex items-center gap-1 rounded border border-primary/50 bg-primary/10 px-2 py-1 text-[10px] text-primary transition-colors hover:bg-primary/20"
            >
              {isReplaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {isReplaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              aria-label="Step backward in Flight Recorder replay"
              title="Go back one event"
              disabled={replayIndex <= 0}
              onClick={() => {
                setIsReplaying(false);
                setReplayIndex((current) => Math.max(current - 1, -1));
              }}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SkipBack className="h-3 w-3" />
              Back
            </button>
            <button
              type="button"
              aria-label="Step Flight Recorder replay"
              title="Advance one event"
              disabled={replayIndex >= trace.length - 1}
              onClick={() => {
                setIsReplaying(false);
                setReplayIndex((current) => Math.min(current + 1, trace.length - 1));
              }}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <StepForward className="h-3 w-3" />
              Step
            </button>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {replayProgress}/{trace.length}
            </span>
            {replayEntry && (
              <span className="min-w-0 truncate text-[10px] text-foreground/80">
                {flightRecorderLabel(replayEntry)}
              </span>
            )}
          </div>
           {replayEntry && (
             <div className="border-t border-primary/20 bg-primary/5 px-3 py-2 text-[10px]" aria-live="polite">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-primary">Replay event {replayIndex + 1}</span>
                <span className="text-muted-foreground">{flightRecorderCategory(replayEntry)}</span>
                <code className="min-w-0 break-all text-foreground/80">{flightRecorderDetail(replayEntry) ?? 'No additional metadata'}</code>
              </div>
               <ReplayCausalNarrative entry={replayEntry} index={replayIndex} trace={trace} />
              <div className="mt-1 text-muted-foreground">
                This replay only advances persisted telemetry; it never invokes tools or changes files.
              </div>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto overflow-x-hidden border-t border-border/30 px-3 py-2">
            {visibleTrace.length > 0 ? (
              <div className="relative space-y-1.5 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border/60">
                {visibleTrace.map(({ entry, index }) => {
                  const category = flightRecorderCategory(entry);
                  const isCurrent = replayIndex === index;
                  const statusClass =
                    entry.kind === 'tool_result' || (entry.validation?.status ?? entry.validationStatus) === 'passed'
                      ? 'text-green-300'
                      : (entry.validation?.status ?? entry.validationStatus) === 'failed' || entry.repairState === 'BLOCKED'
                        ? 'text-red-300'
                        : entry.kind === 'execution_guard'
                          ? 'text-amber-300'
                          : 'text-primary';
                  return (
                    <div
                      key={`${entry.kind}-${index}`}
                      className={`relative flex min-w-0 items-start gap-2 rounded ${isCurrent ? 'bg-primary/10 ring-1 ring-primary/40' : ''}`}
                      aria-current={isCurrent ? 'step' : undefined}
                    >
                      <span className={`z-10 mt-1 h-2 w-2 shrink-0 rounded-full border border-background bg-current ${statusClass}`} />
                      <div className="min-w-0 flex-1 rounded border border-border/30 bg-background/20 px-2 py-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-foreground">{flightRecorderLabel(entry)}</span>
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{category}</span>
                          {isReadWriteToolCall(entry) && (
                            <button
                              type="button"
                              aria-label="Why this file?"
                              title="Show agent reasoning for this step"
                              onClick={() => setExpandedStepIndex(expandedStepIndex === index ? null : index)}
                              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] transition-colors ${expandedStepIndex === index ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-background/40 hover:text-foreground'}`}
                            >
                              <Eye className="h-2.5 w-2.5" />
                              Why?
                            </button>
                          )}
                          {isRepairAttemptDiff(entry) && (
                            <button
                              type="button"
                              aria-label={expandedDiffIndex === index ? 'Hide repair attempt diff' : 'Show repair attempt diff'}
                              title="Show what changed from the previous repair attempt"
                              onClick={() => setExpandedDiffIndex(expandedDiffIndex === index ? null : index)}
                              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] transition-colors ${expandedDiffIndex === index ? 'bg-amber-500/20 text-amber-200' : 'text-muted-foreground hover:bg-background/40 hover:text-foreground'}`}
                            >
                              <GitMerge className="h-2.5 w-2.5" />
                              {expandedDiffIndex === index ? 'Hide diff' : 'Show diff'}
                            </button>
                          )}
                          {isReadEvidenceLinked(entry) && (
                            <button
                              type="button"
                              aria-label={expandedEvidenceIndex === index ? 'Hide read evidence link' : 'Show read evidence link'}
                              title="Show the evidence claim linked to this read"
                              onClick={() => setExpandedEvidenceIndex(expandedEvidenceIndex === index ? null : index)}
                              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] transition-colors ${expandedEvidenceIndex === index ? 'bg-cyan-500/20 text-cyan-200' : 'text-muted-foreground hover:bg-background/40 hover:text-foreground'}`}
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                              {expandedEvidenceIndex === index ? 'Hide evidence' : 'Show evidence'}
                            </button>
                          )}
                          {isValidationEntry(entry) && (
                            <button
                              type="button"
                              aria-label={expandedValidationIndex === index ? 'Hide validation details' : 'Show validation details'}
                              title="Show validation result details"
                              onClick={() => setExpandedValidationIndex(expandedValidationIndex === index ? null : index)}
                              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] transition-colors ${expandedValidationIndex === index ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-background/40 hover:text-foreground'}`}
                            >
                              <ShieldCheck className="h-2.5 w-2.5" />
                              {expandedValidationIndex === index ? 'Hide validation' : 'Show validation'}
                            </button>
                          )}
                        </div>
                        {flightRecorderDetail(entry) && (
                          <code className="mt-0.5 block break-all text-[10px] leading-4 text-muted-foreground">
                            {flightRecorderDetail(entry)}
                          </code>
                        )}
                        {expandedStepIndex === index && isReadWriteToolCall(entry) && (
                          <WhyThisFilePanel entry={entry} />
                        )}
                        {expandedDiffIndex === index && isRepairAttemptDiff(entry) && (
                          <RepairAttemptDiffPanel entry={entry} />
                        )}
                        {expandedEvidenceIndex === index && isReadEvidenceLinked(entry) && (
                          <ReadEvidenceLinkedPanel entry={entry} />
                        )}
                        {expandedValidationIndex === index && isValidationEntry(entry) && (
                          <ValidationDetailPanel entry={entry} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-2 text-muted-foreground">No persisted events match this filter.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
