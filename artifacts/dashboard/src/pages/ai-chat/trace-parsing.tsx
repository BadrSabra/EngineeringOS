import { useState } from 'react';
import { ChevronRight, FileSearch, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AiBehaviorEvidence, AiCrossFileSemanticTrace, AiProductionReachabilityTrace, AiStreamExecutionSummary, EvidenceGraph } from '@workspace/api-client-react';
import type { ExecutionLedgerPublicSnapshot, ForensicDiagnostic, PublicValidationResult } from '@workspace/ai-orchestrator';

// AI-specific endpoints use cookie-based Clerk auth (same-origin — no Bearer needed).

/**
 * Safely parse the `sources` field from a chat message.
 * The field is stored as a JSON string in the DB; malformed or missing payloads
 * must never crash the UI — return an empty array as the fallback.
 */
export function parseSources(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalizes behavior evidence from either the parsed done-event array or a persisted JSON string. */
export function parseBehaviorEvidence(raw: AiBehaviorEvidence[] | string | null | undefined): AiBehaviorEvidence[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as AiBehaviorEvidence[]).filter((e) => e && e.source);
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed.filter((e: AiBehaviorEvidence) => e && e.source) : [];
  } catch {
    return [];
  }
}

/** Renders the file:line anchor for an evidence reference, or a copyable source path when no span is known. */
export function evidenceAnchor(evidence: AiBehaviorEvidence): { label: string; copy: string; hasSpan: boolean } {
  const span = evidence.sourceSpan;
  if (span && Number.isFinite(span.startLine)) {
    const range = span.startLine === span.endLine
      ? `${span.startLine}`
      : `${span.startLine}–${span.endLine}`;
    return { label: `${evidence.source}:${range}`, copy: `${evidence.source}:${span.startLine}`, hasSpan: true };
  }
  return { label: evidence.source, copy: evidence.source, hasSpan: false };
}

export type ToolTraceEntry = {
  kind: string;
  taskType?: string;
  scopeDescription?: string;
  tool?: string;
  toolCallId?: string;
  args?: Record<string, string>;
  source?: string;
  cached?: boolean;
  prefetched?: boolean;
  resultSummary?: string;
  resultKind?: 'ok' | 'failed' | 'unavailable' | 'cancelled';
  diagnosticCode?: string;
  stage?: string;
  stepTitle?: string;
  action?: string;
  files?: string[];
  nextStepTitle?: string;
  approvalRequired?: boolean;
  approvalReason?: string;
  /**
   * The agent's reasoning for why it called this tool — present only on fresh
   * (non-cached) read/write tool_call steps where the model produced text
   * before the tool call. Truncated to 500 characters at the source.
   */
  reasoning?: string;
  iter?: number;
  maxIterations?: number;
  code?: string;
  message?: string;
  iterations?: number;
  toolCalls?: number;
  prefetchToolCalls?: number;
  loopToolCalls?: number;
  stopReason?: string;
  synthesisStarted?: boolean;
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
  recoveryStarted?: boolean;
  sourceCoverage?: 'COMPLETE' | 'PARTIAL' | 'NONE';
  behavioralAssessment?: 'COMPLETE' | 'INCOMPLETE' | 'NOT_STARTED';
  findingStatus?: 'PROVEN' | 'NO_FINDING' | 'NOT_PROVEN';
  repairReadiness?: 'READY' | 'BLOCKED';
  /** EI-036: Repair Scope Gate reason when repair is blocked (e.g. REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION). */
  repairBlockReason?: string;
  /** Structured audit scope derived by the server from isFixtureLocal. */
  auditScope?: 'PRODUCTION' | 'FIXTURE_LOCAL';
  /** True when the proven Finding is supported only by fixture/test/spec evidence. */
  isFixtureLocal?: boolean;
  productionReachability?: 'PROVEN' | 'NOT_PROVEN';
  productionTrace?: AiProductionReachabilityTrace;
  crossFileTrace?: AiCrossFileSemanticTrace;
  implementationFiles?: number;
  contextFiles?: number;
  generatedFiles?: number;
  requestedFiles?: string[];
  rootCoverage?: Array<{
    root: string;
    discoveredFiles: number;
    readFiles: number;
    unreadFiles: number;
    status: 'COMPLETE' | 'EMPTY' | 'PARTIAL' | 'BUDGET_EXHAUSTED';
    unreadPaths?: string[];
    truncatedPaths?: string[];
  }>;
  effectiveRoot?: 'PROJECT_ROOT' | 'ROOT_UNAVAILABLE';
  projectRevision?: string;
  completeReads?: boolean;
  appliedBudget?: {
    maxIterations: number;
    maxToolCalls: number;
    synthesisMaxAttempts?: number;
    synthesisTimeoutMs?: number;
  };
  readStatuses?: Array<{
    path: string;
    status: 'READ_COMPLETE' | 'READ_TRUNCATED' | 'READ_FAILED';
  }>;
  synthesisLifecycle?: {
    started: boolean;
    attempted: boolean;
    timedOut: boolean;
    skipped: boolean;
  };
  /** FEG-017: why a forensic investigation's terminal failed (PROVEN/NO_FINDING omit it). */
  terminalKind?:
    | 'INVESTIGATION_NOT_STARTED'
    | 'INVESTIGATION_BUDGET_EXHAUSTED'
    | 'NO_EVIDENCE_FOUND'
    | 'EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED'
    | 'NO_RESPONSE_RECOVERY_BLOCKED';
  reason?: string;
  forensicDiagnostic?: ForensicDiagnostic;
  root?: string;
  packetIndex?: number;
  packetCount?: number;
  fileCount?: number;
  status?: 'STARTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  attempt?: number;
  diagnosticCodes?: string[];
  details?: string[];
  /** Structured, safe context for phase-policy rejection diagnostics. */
  phase?: 'localization' | 'evidence' | 'patch_proposal' | 'validation' | 'repair_recovery' | 'report';
  diagnosticDetails?: string[];
  model?: string;
  provider?: string;
  modelsUsed?: string[];
  maxAttempts?: number;
  // EI-012: run-ledger telemetry reconciliation persisted into the toolTrace.
  consistent?: boolean;
  violations?: string[];
  readAttempts?: number;
  uniqueFilesRead?: number;
  evidenceFileCount?: number;
  acceptedEvidenceCount?: number;
  completedReadFiles?: string[];
  retainedBodyFiles?: string[];
  acceptedEvidenceFiles?: string[];
  acceptedClaimCount?: number;
  acceptedBehavioralClaimCount?: number;
  provenStructuralEdgeCount?: number;
  provenRuntimeEdgeCount?: number;
  objectiveType?: string;
  requiredEdges?: string[];
  provenEdges?: string[];
  provenEdgeProofs?: Array<{
    edge: string;
    basis: 'SOURCE_AST' | 'RUNTIME_OBSERVED' | 'BOTH';
  }>;
  completionGateResult?: string;
  finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
  objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
  evidenceSourceCoverage?: {
    status: 'COMPLETE' | 'PARTIAL' | 'NONE';
    requestedFiles?: string[];
    roots: Array<{
      root: string;
      discoveredFiles: number;
      readFiles: number;
      unreadFiles: number;
      status: 'COMPLETE' | 'EMPTY' | 'PARTIAL' | 'BUDGET_EXHAUSTED';
    }>;
    reason?: string;
  };
  scopeExpansions?: Array<{
    kind: 'JUSTIFIED_SCOPE_EXPANSION' | 'UNJUSTIFIED_SCOPE_EXPANSION';
    path: string;
    matchedPolicyPath?: string;
  }>;
  unjustifiedReads?: string[];
  validation?: PublicValidationResult;
  /** Compatibility projection for persisted traces from older runs. */
  validationStatus?: PublicValidationResult['status'];
  repairState?: 'VALIDATING' | 'REPAIRING' | 'READY_FOR_REVIEW' | 'BLOCKED';
  validationProfile?: string;
  validationScenario?: string;
  validationCommand?: string;
  validationExitCode?: number | null;
  validationFailedTests?: string[];
  validationAffectedFiles?: string[];
  validationFailedTestDetails?: never;
  validationChangedFiles?: string[];
  validationAttempt?: number;
  validationMaxAttempts?: number;
  validationDetail?: string;
};

export function parseToolTrace(raw: string | undefined | null): ToolTraceEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ToolTraceEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { kind?: unknown }).kind === 'string',
    );
  } catch {
    return [];
  }
}

export function parseEvidenceGraph(raw: string | undefined | null): EvidenceGraph | undefined {
  const entry = [...parseToolTrace(raw)].reverse().find((candidate) => candidate.kind === 'evidence_graph');
  if (!entry || !Array.isArray((entry as { nodes?: unknown }).nodes) || !Array.isArray((entry as { edges?: unknown }).edges)) {
    return undefined;
  }
  const graph = entry as unknown as EvidenceGraph & { kind?: string };
  if (
    graph.version !== 1
    || !Array.isArray(graph.reads)
    || !Array.isArray(graph.contradictionClaimIds)
  ) return undefined;
  return {
    version: 1,
    ...(typeof graph.sourceRevision === 'string' ? { sourceRevision: graph.sourceRevision } : {}),
    nodes: graph.nodes,
    edges: graph.edges,
    reads: graph.reads,
    contradictionClaimIds: graph.contradictionClaimIds,
    ...(graph.statusProjection?.authority === 'EVIDENCE_GRAPH_ONLY'
      && graph.statusProjection.proofFreshness === 'NOT_REVALIDATED'
      ? { statusProjection: graph.statusProjection }
      : {}),
  };
}

export function parseExecutionLedger(trace: ToolTraceEntry[]): ExecutionLedgerPublicSnapshot | null {
  const entry = [...trace].reverse().find((candidate) => candidate.kind === 'execution_ledger');
  if (!entry) return null;
  const snapshot = entry as unknown as ExecutionLedgerPublicSnapshot;
  if (
    typeof snapshot.id !== 'string'
    || typeof snapshot.mode !== 'string'
    || typeof snapshot.elapsedMs !== 'number'
    || !Array.isArray(snapshot.providers)
    || !Array.isArray(snapshot.models)
    || !snapshot.counts
  ) return null;
  return snapshot;
}

function traceStatusClasses(status: 'PROVEN' | 'NOT_PROVEN' | 'OUT_OF_SCOPE'): string {
  switch (status) {
    case 'PROVEN':
      return 'border-green-500/40 bg-green-500/10 text-green-300';
    case 'OUT_OF_SCOPE':
      return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
    default:
      return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  }
}

export function SemanticTraceCard({
  productionTrace,
  crossFileTraces,
}: {
  productionTrace?: AiProductionReachabilityTrace;
  crossFileTraces: AiCrossFileSemanticTrace[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!productionTrace && crossFileTraces.length === 0) return null;

  const traces = [
    ...(productionTrace ? [{ label: 'Production path', trace: productionTrace }] : []),
    ...crossFileTraces.map((trace, index) => ({
      label: `Cross-file path ${index + 1}`,
      trace,
    })),
  ];
  const provenCount = traces.filter(({ trace }) => trace.status === 'PROVEN').length;
  const hasUnproven = traces.some(({ trace }) => trace.status !== 'PROVEN');

  return (
    <div className={`mt-2 overflow-hidden rounded-lg border text-[11px] ${
      hasUnproven ? 'border-amber-500/25 bg-amber-500/5' : 'border-green-500/25 bg-green-500/5'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background/30"
        aria-expanded={expanded}
      >
        {hasUnproven
          ? <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />
          : <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-300" />}
        <span className="font-medium text-foreground">Semantic evidence trace</span>
        <span className="text-muted-foreground">
          {provenCount}/{traces.length} proven
        </span>
        <ChevronRight className={`ml-auto h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
          {traces.map(({ label, trace }) => (
            <div key={label} className="rounded border border-border/40 bg-background/25 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <FileSearch className="h-3 w-3 shrink-0 text-primary" />
                <span className="font-medium text-foreground">{label}</span>
                <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${traceStatusClasses(trace.status)}`}>
                  {trace.status}
                </span>
              </div>
              {trace.reason && (
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{trace.reason}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                <span className="rounded border border-border/40 px-1.5 py-0.5">
                  {trace.nodes.length} nodes
                </span>
                <span className="rounded border border-border/40 px-1.5 py-0.5">
                  {trace.edges.length} relationships
                </span>
                {'maxDepth' in trace && typeof trace.maxDepth === 'number' && (
                  <span className="rounded border border-border/40 px-1.5 py-0.5">
                    depth ≤ {trace.maxDepth}
                  </span>
                )}
              </div>
              {trace.nodes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {trace.nodes.slice(0, 6).map((node) => (
                    <div key={node.id} className="flex min-w-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                      <code className="min-w-0 truncate text-foreground/90">{node.name}</code>
                      {node.path && (
                        <code className="min-w-0 truncate text-muted-foreground">· {node.path}</code>
                      )}
                    </div>
                  ))}
                  {trace.nodes.length > 6 && (
                    <div className="text-muted-foreground">+{trace.nodes.length - 6} more nodes</div>
                  )}
                </div>
              )}
              {trace.edges.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/30 pt-2">
                  {trace.edges.slice(0, 8).map((edge, index) => (
                    <div key={`${edge.from}-${edge.to}-${index}`} className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <code className="min-w-0 truncate text-foreground/90">{edge.from}</code>
                        <span className="shrink-0 text-muted-foreground">→</span>
                        <code className="min-w-0 truncate text-foreground/90">{edge.to}</code>
                        <span className={`ml-auto shrink-0 rounded border px-1 py-0.5 text-[9px] ${traceStatusClasses(edge.status)}`}>
                          {edge.status}
                        </span>
                      </div>
                      {(edge.sourceSpan || edge.evidence) && (
                        <div className="ml-3.5 mt-0.5 truncate text-[10px] text-muted-foreground">
                          {edge.sourceSpan
                            ? `${edge.sourceSpan.file}:${edge.sourceSpan.line}${edge.sourceSpan.column != null ? `:${edge.sourceSpan.column}` : ''}`
                            : edge.evidence}
                          {edge.sourceSpan?.snippet ? ` · ${edge.sourceSpan.snippet}` : ''}
                        </div>
                      )}
                    </div>
                  ))}
                  {trace.edges.length > 8 && (
                    <div className="text-muted-foreground">+{trace.edges.length - 8} more relationships</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EXECUTION_STOP_REASONS = [
  'response',
  'iteration_budget',
  'soft_limit',
  'repeated_tool_call',
  'empty_response',
  'provider_timeout',
  'tool_failure',
  // Cancellation is a terminal audit state. Keep its persisted execution
  // summary available after history reload so the incomplete report's
  // recovery context is not replaced by a clean/no-finding fallback.
  'cancelled',
] as const;

export type DashboardExecutionSummary = AiStreamExecutionSummary & {
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
};

export function parseExecutionSummary(trace: ToolTraceEntry[]): DashboardExecutionSummary | null {
  const done = [...trace].reverse().find((entry) => entry.kind === 'done');
  if (!done || !EXECUTION_STOP_REASONS.includes(done.stopReason as typeof EXECUTION_STOP_REASONS[number])) {
    return null;
  }

  const recordedToolCalls = trace.filter((entry) => entry.kind === 'tool_call').length;
  const recordedPrefetchToolCalls = trace.filter(
    (entry) => entry.kind === 'tool_call' && entry.prefetched === true,
  ).length;
  const recordedLoopToolCalls = recordedToolCalls - recordedPrefetchToolCalls;
  const diagnosticCodes = new Set<string>();
  const diagnosticDetails = new Set<string>();
  for (const entry of trace) {
    if (entry.kind === 'diagnostic' && entry.code) diagnosticCodes.add(entry.code);
    if (entry.kind === 'diagnostic') {
      for (const detail of entry.details ?? []) diagnosticDetails.add(detail);
    }
    for (const code of entry.diagnosticCodes ?? []) diagnosticCodes.add(code);
    for (const detail of entry.diagnosticDetails ?? []) diagnosticDetails.add(detail);
  }
  const capabilityProbeRecoveryStarted = [...diagnosticCodes].some(
    (code) =>
      code === 'CAPABILITY_PROBE_EVIDENCE_RECOVERED' ||
      code.startsWith('CAPABILITY_PROBE_EVIDENCE_RECOVERY_'),
  );

  return {
    iterations: typeof done.iterations === 'number' ? done.iterations : 0,
    maxIterations: typeof done.maxIterations === 'number' ? done.maxIterations : 0,
    toolCalls: typeof done.toolCalls === 'number' ? done.toolCalls : recordedToolCalls,
    prefetchToolCalls:
      typeof done.prefetchToolCalls === 'number'
        ? done.prefetchToolCalls
        : recordedPrefetchToolCalls,
    loopToolCalls:
      typeof done.loopToolCalls === 'number'
        ? done.loopToolCalls
        : recordedLoopToolCalls,
    stopReason: done.stopReason as AiStreamExecutionSummary['stopReason'],
    synthesisStarted: done.synthesisStarted === true,
    ...(typeof done.synthesisAttempts === 'number' ? { synthesisAttempts: done.synthesisAttempts } : {}),
    ...(typeof done.synthesisMaxAttempts === 'number' ? { synthesisMaxAttempts: done.synthesisMaxAttempts } : {}),
    ...(typeof done.synthesisTimeoutMs === 'number' ? { synthesisTimeoutMs: done.synthesisTimeoutMs } : {}),
    ...(typeof done.synthesisElapsedMs === 'number' ? { synthesisElapsedMs: done.synthesisElapsedMs } : {}),
    ...(typeof done.synthesisTimedOut === 'boolean' ? { synthesisTimedOut: done.synthesisTimedOut } : {}),
    recoveryStarted:
      done.recoveryStarted === true ||
      trace.some((entry) => entry.kind === 'forensic_recovery_start') ||
      capabilityProbeRecoveryStarted,
    diagnosticCodes: [...diagnosticCodes],
    // Cancellation diagnostics are internal recovery/provider details. The
    // cancelled report and its terminal state survive history reload, but
    // provider errors must not become visible just because the persisted
    // summary is now restored.
    ...(diagnosticDetails.size > 0 && done.stopReason !== 'cancelled'
      ? { diagnosticDetails: [...diagnosticDetails] }
      : {}),
  };
}

export function isForensicFallbackMessage(content: string): boolean {
  return (
    content.includes('No verified forensic verdict was produced') ||
    content.includes('No verified finding identified from inspected source code.')
  );
}

export function isEvidenceOnlyFallbackMessage(content: string): boolean {
  return content.includes('Completed source reads were preserved') ||
    content.includes('completed source reads were preserved');
}

export function isIncompleteBeforeEvidenceSummary(summary: AiStreamExecutionSummary | null): boolean {
  return Boolean(
    summary?.diagnosticCodes.some((code) =>
      code.includes('INCOMPLETE_BEFORE_EVIDENCE') ||
      code.includes('INVESTIGATION_START_FAILURE'),
    ),
  );
}

export type FinalForensicVerdict = 'FINDING PROVEN' | 'NO FINDING' | 'NOT PROVEN' | 'INCOMPLETE';

/**
 * The execution trace contains historical attempts. It is useful for
 * diagnostics, but it is not the final forensic verdict. Derive the badge
 * from the report that is actually rendered, with the Final Judgment section
 * taking precedence over earlier model/recovery events.
 */
export function getFinalForensicVerdict(
  content: string,
  persistedFindingStatus?: 'PROVEN' | 'NO_FINDING' | 'NOT_PROVEN',
): FinalForensicVerdict | null {
  const finalJudgment =
    content.match(/##\s*6\)\s*Final Judgment([\s\S]*?)(?=\n##\s+\d+\)|$)/i)?.[1] ?? '';
  const findingsSection =
    content.match(/##\s*3\)\s*Findings([\s\S]*?)(?=\n##\s*4\)\s*Repair Plan|$)/i)?.[1] ?? '';
  const hasAcceptedFinding = /(?:^|\n)\s*(?:[*-]\s*)?ID:\s*F-\d+\s*·/i.test(findingsSection);

  // Cancellation is a terminal state of the audit, not a finding verdict.
  // Check the rendered report before historical trace fields so a stale
  // NO_FINDING status can never turn an incomplete cancellation into a clean
  // result.
  if (/\bANALYSIS_INCOMPLETE\b/i.test(finalJudgment) || /\bANALYSIS_INCOMPLETE\b/i.test(content)) {
    return 'INCOMPLETE';
  }

  // The report's NOT PROVEN wording can describe a blocked repair handoff,
  // while forensic_status separately records that the Finding itself was
  // proven. Prefer that persisted, server-derived status so fixture-local
  // Findings are not presented as "no Finding" merely because production
  // reachability or repair authorization was not proven.
  if (persistedFindingStatus === 'PROVEN') return 'FINDING PROVEN';
  if (persistedFindingStatus === 'NO_FINDING') return hasAcceptedFinding ? 'NOT PROVEN' : 'NO FINDING';

  if (/\bNOT PROVEN\b/i.test(finalJudgment)) return 'NOT PROVEN';
  if (/\bFINDING PROVEN\b/i.test(finalJudgment)) {
    return hasAcceptedFinding ? 'FINDING PROVEN' : 'NOT PROVEN';
  }
  if (/\bNO FINDING\b/i.test(finalJudgment)) {
    return hasAcceptedFinding ? 'NOT PROVEN' : 'NO FINDING';
  }

  return null;
}

type ForensicReadEvidence = {
  source: string;
  completed: number;
  cached: number;
  prefetched: number;
  loop: number;
  firstSeen: number;
};

export type ForensicEvidenceSummary = {
  reads: ForensicReadEvidence[];
  completedReads: number;
  implementationFiles: number;
  contextFiles: number;
  generatedFiles: number;
  cachedReads: number;
  incompleteReads: string[];
  unattributedResults: number;
  execution: {
    iterations: number;
    maxIterations: number;
    toolCalls: number;
    prefetchToolCalls: number;
    loopToolCalls: number;
    stopReason: string;
    synthesisStarted: boolean;
    recoveryStarted: boolean;
    modelsUsed: string[];
    recoveryModelsUsed: string[];
  } | null;
  diagnosticCodes: string[];
  diagnosticDetails: string[];
  forensicStatus: {
    auditScope: 'PRODUCTION' | 'FIXTURE_LOCAL';
    productionReachability: 'PROVEN' | 'NOT_PROVEN';
    sourceCoverage: 'COMPLETE' | 'PARTIAL' | 'NONE';
    behavioralAssessment: 'COMPLETE' | 'INCOMPLETE' | 'NOT_STARTED';
    findingStatus: 'PROVEN' | 'NO_FINDING' | 'NOT_PROVEN';
    /** FEG-017: why a NOT_PROVEN terminal failed (absent for PROVEN/NO_FINDING). */
    terminalKind?:
      | 'INVESTIGATION_NOT_STARTED'
      | 'INVESTIGATION_BUDGET_EXHAUSTED'
      | 'NO_EVIDENCE_FOUND'
      | 'EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED'
      | 'NO_RESPONSE_RECOVERY_BLOCKED';
    repairReadiness: 'READY' | 'BLOCKED';
    /** EI-036: Repair Scope Gate reason when repair is blocked (absent when READY). */
    repairBlockReason?: string;
    implementationFiles: number;
    contextFiles: number;
    generatedFiles: number;
    requestedFiles: string[];
    reason?: string;
    rootCoverage: Array<{
      root: string;
      discoveredFiles: number;
      readFiles: number;
      unreadFiles: number;
      status: 'COMPLETE' | 'EMPTY' | 'PARTIAL' | 'BUDGET_EXHAUSTED';
      unreadPaths?: string[];
      truncatedPaths?: string[];
    }>;
    effectiveRoot?: 'PROJECT_ROOT' | 'ROOT_UNAVAILABLE';
    projectRevision?: string;
    completeReads?: boolean;
    appliedBudget?: {
      maxIterations: number;
      maxToolCalls: number;
      synthesisMaxAttempts?: number;
      synthesisTimeoutMs?: number;
    };
    readStatuses?: Array<{
      path: string;
      status: 'READ_COMPLETE' | 'READ_TRUNCATED' | 'READ_FAILED';
    }>;
    synthesisLifecycle?: {
      started: boolean;
      attempted: boolean;
      timedOut: boolean;
      skipped: boolean;
    };
    /** True when the proven Finding is supported only by fixture/test/spec evidence. */
    isFixtureLocal?: boolean;
  } | null;
  forensicDiagnostic?: ForensicDiagnostic | null;
  auditScopeDescription?: string;
  forensicPackets: Array<{
    root: string;
    packetIndex: number;
    packetCount: number;
    fileCount: number;
    implementationFiles: number;
    contextFiles: number;
    generatedFiles: number;
    status: 'STARTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
    reason?: string;
  }>;
  /**
   * EI-012: latest run-ledger telemetry reconciliation for this message. Null
   * when the server did not persist an evidence_integrity step (e.g. generic
   * chats). `consistent: false` means the verdict failed closed, and violations
   * are bounded, content-free reason labels.
   */
  evidenceIntegrity: {
    code: string;
    consistent: boolean;
    violations: string[];
    readAttempts: number;
    uniqueFilesRead: number;
    evidenceFileCount: number;
    acceptedEvidenceCount: number;
    objectiveType?: string;
    requiredEdges: string[];
    provenEdges: string[];
    provenEdgeProofs: Array<{
      edge: string;
      basis: 'SOURCE_AST' | 'RUNTIME_OBSERVED' | 'BOTH';
    }>;
    completionGateResult?: string;
    finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
    objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
    completedReadFiles: string[];
    retainedBodyFiles: string[];
    acceptedEvidenceFiles: string[];
    acceptedClaimCount: number;
    acceptedBehavioralClaimCount?: number;
    provenStructuralEdgeCount?: number;
    provenRuntimeEdgeCount?: number;
    sourceCoverage: ToolTraceEntry['evidenceSourceCoverage'];
    scopeExpansions: Array<{
      kind: 'JUSTIFIED_SCOPE_EXPANSION' | 'UNJUSTIFIED_SCOPE_EXPANSION';
      path: string;
      matchedPolicyPath?: string;
    }>;
    unjustifiedReads: string[];
  } | null;
  persistedEvidenceFiles?: string[];
};

export function parseForensicEvidence(
  trace: ToolTraceEntry[],
  executionSummary: AiStreamExecutionSummary | null,
  messageDiagnostic?: ForensicDiagnostic | null,
): ForensicEvidenceSummary {
  const reads = new Map<string, ForensicReadEvidence>();
  const requested = new Map<string, number>();
  const returned = new Map<string, number>();
  let unattributedResults = 0;
  let readSequence = 0;

  for (const entry of trace) {
    if (entry.kind === 'tool_call' && (entry.tool === 'read_file' || entry.tool === 'read_file_range')) {
      const requestedPath = entry.args?.path;
      if (requestedPath) {
        requested.set(requestedPath, (requested.get(requestedPath) ?? 0) + 1);
      }
    }
    if (
      entry.kind !== 'tool_result' ||
      (entry.tool !== 'read_file' && entry.tool !== 'read_file_range')
    ) continue;
    if (!entry.source) {
      unattributedResults += 1;
      continue;
    }

    const source = entry.source;
    const existing = reads.get(source) ?? {
      source,
      completed: 0,
      cached: 0,
      prefetched: 0,
      loop: 0,
      firstSeen: readSequence + 1,
    };
    // Prefetch and uncached tool results are authoritative source reads.
    // Cache hits produced later by the loop are diagnostic repeats, not new
    // completed reads, even though they still carry a valid source label.
    if (entry.cached && !entry.prefetched) {
      existing.cached += 1;
    } else {
      existing.completed += 1;
      if (entry.prefetched) {
        existing.prefetched += 1;
      } else {
        existing.loop += 1;
      }
    }
    readSequence += 1;
    reads.set(source, existing);
    returned.set(source, (returned.get(source) ?? 0) + 1);
  }

  const incompleteReads: string[] = unattributedResults === 0
    ? [...requested.entries()]
      .filter(([source, requestedCount]) => (returned.get(source) ?? 0) < requestedCount)
      .map(([source]) => source)
    : [];
  const statusEntry = [...trace]
    .reverse()
    .find((entry) => entry.kind === 'forensic_status');
  const scopeEntry = [...trace]
    .reverse()
    .find((entry) => entry.kind === 'audit_scope' && entry.scopeDescription);
  const terminalEntry = [...trace]
    .reverse()
    .find((entry) => entry.kind === 'forensic_terminal');
  const packetState = new Map<string, ForensicEvidenceSummary['forensicPackets'][number]>();
  for (const entry of trace) {
    if (entry.kind !== 'forensic_packet' || !entry.root || !entry.status) continue;
    packetState.set(entry.root, {
      root: entry.root,
      packetIndex: entry.packetIndex ?? 0,
      packetCount: entry.packetCount ?? 0,
      fileCount: entry.fileCount ?? 0,
      implementationFiles: entry.implementationFiles ?? 0,
      contextFiles: entry.contextFiles ?? 0,
      generatedFiles: entry.generatedFiles ?? 0,
      status: entry.status,
      reason: entry.reason,
    });
  }
  const forensicPackets = [...packetState.values()];

  const parsedEvidence: ForensicEvidenceSummary = {
    reads: [...reads.values()],
    completedReads: [...reads.values()].reduce((sum, read) => sum + read.completed, 0),
    implementationFiles: [...reads.keys()].filter((source) =>
      /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i.test(source) &&
      !/(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(source),
    ).length,
    contextFiles: [...reads.keys()].filter((source) =>
      /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s)$/i.test(source),
    ).length,
    generatedFiles: [...reads.keys()].filter((source) =>
      /(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(source),
    ).length,
    cachedReads: [...reads.values()].reduce((sum, read) => sum + read.cached, 0),
    incompleteReads,
    unattributedResults,
    execution: executionSummary
      ? {
          iterations: executionSummary.iterations,
          maxIterations: executionSummary.maxIterations,
          toolCalls: executionSummary.toolCalls,
          prefetchToolCalls: executionSummary.prefetchToolCalls,
          loopToolCalls: executionSummary.loopToolCalls,
          stopReason: executionSummary.stopReason,
          synthesisStarted: executionSummary.synthesisStarted,
           recoveryStarted: executionSummary.recoveryStarted === true,
           modelsUsed: executionSummary.modelsUsed ?? [],
           recoveryModelsUsed: executionSummary.recoveryModelsUsed ?? [],
        }
      : null,
    diagnosticCodes: executionSummary?.diagnosticCodes ?? [],
    diagnosticDetails: executionSummary?.diagnosticDetails ?? [],
    forensicStatus:
      statusEntry?.sourceCoverage &&
      statusEntry.behavioralAssessment &&
      statusEntry.findingStatus &&
      statusEntry.repairReadiness
        ? {
            // auditScope: derive from the explicit field if present, otherwise fall back to isFixtureLocal
            auditScope: (statusEntry.auditScope === 'FIXTURE_LOCAL' || statusEntry.isFixtureLocal)
              ? 'FIXTURE_LOCAL'
              : 'PRODUCTION',
            productionReachability: statusEntry.productionReachability === 'PROVEN' ? 'PROVEN' : 'NOT_PROVEN',
            sourceCoverage: statusEntry.sourceCoverage,
            behavioralAssessment: statusEntry.behavioralAssessment,
            findingStatus: statusEntry.findingStatus,
            ...(terminalEntry?.terminalKind ? { terminalKind: terminalEntry.terminalKind } : {}),
            repairReadiness: statusEntry.repairReadiness,
            repairBlockReason: statusEntry.repairBlockReason,
            implementationFiles: statusEntry.implementationFiles ?? 0,
            contextFiles: statusEntry.contextFiles ?? 0,
            generatedFiles: statusEntry.generatedFiles ?? 0,
             requestedFiles: statusEntry.requestedFiles ?? [],
            reason: statusEntry.reason,
            rootCoverage: statusEntry.rootCoverage ?? [],
            effectiveRoot: statusEntry.effectiveRoot,
            projectRevision: statusEntry.projectRevision,
            completeReads: statusEntry.completeReads,
            appliedBudget: statusEntry.appliedBudget,
            readStatuses: statusEntry.readStatuses,
            synthesisLifecycle: statusEntry.synthesisLifecycle,
            // Normalize from both fields so auditScope-only traces are handled correctly.
            isFixtureLocal:
              (statusEntry.auditScope === 'FIXTURE_LOCAL' || statusEntry.isFixtureLocal === true)
                ? true
                : undefined,
          }
        : null,
    forensicDiagnostic:
      messageDiagnostic
      ?? statusEntry?.forensicDiagnostic
      ?? [...trace].reverse().find((entry) => entry.kind === 'forensic_diagnostic')?.forensicDiagnostic
      ?? null,
    auditScopeDescription: scopeEntry?.scopeDescription,
    forensicPackets,
    // EI-012: surface the latest run-ledger telemetry reconciliation for the run.
    ...(extractEvidenceIntegrity(trace)),
  };

  return projectCanonicalEvidence(parsedEvidence);
}

/**
 * EI-011/012: pulls the most recent evidence_integrity step out of the
 * toolTrace so the dashboard can surface whether the run's telemetry
 * reconciled with its cited evidence. If no reconciliation step was persisted
 * (e.g. a generic chat), evidenceIntegrity is null and the block is hidden.
 */
function extractEvidenceIntegrity(trace: ToolTraceEntry[]): {
  evidenceIntegrity: ForensicEvidenceSummary['evidenceIntegrity'];
} {
  const entry = [...trace].reverse().find((e) => e.kind === 'evidence_integrity');
  if (!entry) return { evidenceIntegrity: null };
  // Some persisted runs contain the canonical file projection but predate the
  // nested evidenceSourceCoverage object. Keep those runs readable by
  // rebuilding the display-only manifest from the server-owned file lists.
  const canonicalFiles = [
    ...(Array.isArray(entry.completedReadFiles) ? entry.completedReadFiles : []),
    ...(Array.isArray(entry.retainedBodyFiles) ? entry.retainedBodyFiles : []),
  ].filter(
    (path, index, paths): path is string =>
      typeof path === 'string' && path.trim().length > 0 && paths.indexOf(path) === index,
  );
  const sourceCoverage = entry.evidenceSourceCoverage ?? (
    canonicalFiles.length > 0
      ? {
          status: 'COMPLETE' as const,
          requestedFiles: canonicalFiles,
          roots: canonicalFiles.map((root) => ({
            root,
            discoveredFiles: 1,
            readFiles: 1,
            unreadFiles: 0,
            status: 'COMPLETE' as const,
          })),
        }
      : undefined
  );
  const provenStructuralEdgeCount =
    typeof entry.provenStructuralEdgeCount === 'number'
      ? entry.provenStructuralEdgeCount
      : typeof entry.provenRuntimeEdgeCount !== 'number' && Array.isArray(entry.provenEdges)
        ? entry.provenEdges.filter((edge): edge is string => typeof edge === 'string').length
        : undefined;
  return {
    evidenceIntegrity: {
      code: typeof entry.code === 'string' ? entry.code : '',
      consistent: entry.consistent === true,
      violations: Array.isArray(entry.violations)
        ? entry.violations.filter((v): v is string => typeof v === 'string')
        : [],
      readAttempts: typeof entry.readAttempts === 'number' ? entry.readAttempts : 0,
      uniqueFilesRead: typeof entry.uniqueFilesRead === 'number' ? entry.uniqueFilesRead : 0,
      evidenceFileCount: typeof entry.evidenceFileCount === 'number' ? entry.evidenceFileCount : 0,
      acceptedEvidenceCount: typeof entry.acceptedEvidenceCount === 'number' ? entry.acceptedEvidenceCount : 0,
      objectiveType: typeof entry.objectiveType === 'string' ? entry.objectiveType : undefined,
      requiredEdges: Array.isArray(entry.requiredEdges)
        ? entry.requiredEdges.filter((edge): edge is string => typeof edge === 'string')
        : [],
      provenEdges: Array.isArray(entry.provenEdges)
        ? entry.provenEdges.filter((edge): edge is string => typeof edge === 'string')
        : [],
      provenEdgeProofs: Array.isArray(entry.provenEdgeProofs)
        ? entry.provenEdgeProofs.filter((item): item is {
            edge: string;
            basis: 'SOURCE_AST' | 'RUNTIME_OBSERVED' | 'BOTH';
          } =>
            item !== null &&
            typeof item === 'object' &&
            typeof item.edge === 'string' &&
            (item.basis === 'SOURCE_AST' ||
              item.basis === 'RUNTIME_OBSERVED' ||
              item.basis === 'BOTH'),
          )
        : [],
      completionGateResult: typeof entry.completionGateResult === 'string' ? entry.completionGateResult : undefined,
      finalAnswerType:
        entry.finalAnswerType === 'PRODUCTION_REACHABILITY_ANSWER' ||
        entry.finalAnswerType === 'BEHAVIORAL_ANSWER' ||
        entry.finalAnswerType === 'NO_ANSWER'
          ? entry.finalAnswerType
          : undefined,
      objectiveVerdict:
        entry.objectiveVerdict === 'ANSWER_COMPLETE' ||
        entry.objectiveVerdict === 'ANSWER_PARTIAL' ||
        entry.objectiveVerdict === 'RECOVERY_REQUIRED' ||
        entry.objectiveVerdict === 'OBJECTIVE_BLOCKED'
          ? entry.objectiveVerdict
          : undefined,
      completedReadFiles: Array.isArray(entry.completedReadFiles)
        ? entry.completedReadFiles.filter((path): path is string => typeof path === 'string')
        : [],
      retainedBodyFiles: Array.isArray(entry.retainedBodyFiles)
        ? entry.retainedBodyFiles.filter((path): path is string => typeof path === 'string')
        : [],
      acceptedEvidenceFiles: Array.isArray(entry.acceptedEvidenceFiles)
        ? entry.acceptedEvidenceFiles.filter((path): path is string => typeof path === 'string')
        : [],
      acceptedClaimCount: typeof entry.acceptedClaimCount === 'number' ? entry.acceptedClaimCount : 0,
      acceptedBehavioralClaimCount:
        typeof entry.acceptedBehavioralClaimCount === 'number'
          ? entry.acceptedBehavioralClaimCount
          : undefined,
      provenStructuralEdgeCount:
        provenStructuralEdgeCount,
      provenRuntimeEdgeCount:
        typeof entry.provenRuntimeEdgeCount === 'number'
          ? entry.provenRuntimeEdgeCount
          : undefined,
      sourceCoverage,
      scopeExpansions: Array.isArray(entry.scopeExpansions)
        ? entry.scopeExpansions.filter((item): item is {
            kind: 'JUSTIFIED_SCOPE_EXPANSION' | 'UNJUSTIFIED_SCOPE_EXPANSION';
            path: string;
            matchedPolicyPath?: string;
          } =>
            item !== null &&
            typeof item === 'object' &&
            (item.kind === 'JUSTIFIED_SCOPE_EXPANSION' || item.kind === 'UNJUSTIFIED_SCOPE_EXPANSION') &&
            typeof item.path === 'string',
          )
        : [],
      unjustifiedReads: Array.isArray(entry.unjustifiedReads)
        ? entry.unjustifiedReads.filter((path): path is string => typeof path === 'string')
        : [],
    },
  };
}

/**
 * The persisted tool trace is bounded execution metadata. Prefetch bodies can
 * be present in the runtime ledger and in `done.prefetchToolCalls` without
 * having a synthetic tool_result entry in the persisted trace. Once the
 * evidence-integrity projection exists, it is the only authoritative source
 * for source-read counts and source coverage.
 *
 * Keep the trace-derived per-file counters where available (cached repeats,
 * prefetch vs loop), but merge canonical paths into the visible source list so
 * the UI cannot report "0 completed reads" beside "5 retained bodies".
 */
function projectCanonicalEvidence(evidence: ForensicEvidenceSummary): ForensicEvidenceSummary {
  const integrity = evidence.evidenceIntegrity;
  if (!integrity) return evidence;

  const canonicalPaths = [
    ...integrity.completedReadFiles,
    ...integrity.retainedBodyFiles,
    ...integrity.acceptedEvidenceFiles,
  ].filter((path, index, paths) => path.trim().length > 0 && paths.indexOf(path) === index);
  const canonicalUniqueCount =
    integrity.uniqueFilesRead > 0 ? integrity.uniqueFilesRead : canonicalPaths.length;

  // Older persisted messages can contain only the scalar counts. In that
  // case retain the old trace-derived rows while still using the canonical
  // scalar for the summary counters.
  if (canonicalPaths.length === 0 && canonicalUniqueCount === 0) {
    return evidence;
  }

  const canonicalPathSet = new Set(canonicalPaths);
  const traceReads = new Map(
    evidence.reads
      .filter((read) => canonicalPathSet.has(read.source))
      .map((read) => [read.source, read]),
  );
  let nextFirstSeen = evidence.reads.reduce(
    (max, read) => Math.max(max, read.firstSeen),
    0,
  );
  for (const source of canonicalPaths) {
    if (traceReads.has(source)) continue;
    traceReads.set(source, {
      source,
      completed: 1,
      cached: 0,
      prefetched: 0,
      loop: 0,
      firstSeen: ++nextFirstSeen,
    });
  }

  const canonicalCompletedCount =
    integrity.completedReadFiles.length > 0
      ? integrity.completedReadFiles.length
      : integrity.retainedBodyFiles.length > 0
        ? integrity.retainedBodyFiles.length
        // Older persisted traces may contain only scalar EI counters. In that
        // shape, uniqueFilesRead is the authoritative completed-read count;
        // otherwise the UI can show "0 source reads" beside consistent
        // telemetry proving that source files were read.
        : Math.max(integrity.uniqueFilesRead, evidence.completedReads);

  return {
    ...evidence,
    reads: [...traceReads.values()],
    completedReads: canonicalCompletedCount,
    implementationFiles: countCanonicalSourceFiles(canonicalPaths, 'implementation'),
    contextFiles: countCanonicalSourceFiles(canonicalPaths, 'context'),
    generatedFiles: countCanonicalSourceFiles(canonicalPaths, 'generated'),
  };
}

function countCanonicalSourceFiles(
  paths: string[],
  kind: 'implementation' | 'context' | 'generated',
): number {
  return paths.filter((source) => {
    if (kind === 'generated') {
      return /(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(source);
    }
    if (kind === 'context') {
      return /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s)$/i.test(source);
    }
    return (
      /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i.test(source) &&
      !/(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i.test(source)
    );
  }).length;
}

export function formatStopReason(reason: string, synthesisStarted = false): string {
  switch (reason) {
    case 'response':
      return 'response completed';
    case 'iteration_budget':
      return 'iteration budget reached';
    case 'soft_limit':
      return 'soft limit reached';
    case 'repeated_tool_call':
      return 'repeated tool call blocked';
    case 'empty_response':
      return synthesisStarted
        ? 'synthesis returned empty'
        : 'empty provider response';
    case 'provider_timeout':
      return 'provider timed out — partial report returned';
    case 'tool_failure':
      return 'required tool failed — operation blocked';
    default:
      return reason.replace(/_/g, ' ');
  }
}

/**
 * Returns the first diagnosticDetail string that is a concrete bounded
 * contract or recovery violation rather than an internal operational note.
 * Operational/meta strings are excluded so that only user-surfaceable
 * violation messages reach the UI.
 */
function firstConcreteViolationDetail(details: string[]): string | undefined {
  // Prefixes/substrings that identify internal operational notes rather
  // than bounded contract violations surfaceable to the user.
  const OPERATIONAL_PATTERNS = [
    'provider failure codes:',
    'completed source reads preserved',
    'completed source reads were preserved',
    'evidence map rebuilt deterministically',
    'bounded recovery candidates produced no directly proven finding',
    'provider recovery exhausted without an accepted six-section report',
    'a high-confidence executable pattern was verified',
    'the deterministic finding passed',
    'complete implementation reads were preserved',
    'no directly verifiable deterministic defect pattern was found',
    'a source-grounded no_finding basis was emitted',
    'primary-evidence-target=',
    'first_evidence recovery failed',
    'run ended with zero source reads',
    'telemetry:',
    'status:',
  ];
  return details.find((d) => {
    const lower = d.toLowerCase();
    return (
      d.length >= 10 &&
      !OPERATIONAL_PATTERNS.some((p) => lower.includes(p))
    );
  });
}

export function forensicRejectionReason(
  summary: ForensicEvidenceSummary,
  finalVerdict: FinalForensicVerdict | null = null,
): string {
  const finalReportIsNotProven = finalVerdict === 'NOT PROVEN';
  if (!finalReportIsNotProven && summary.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERED'))) {
    return 'The capability probe Recovery response was accepted after validating all C1–C7 labels and an exact executable excerpt against the declared source reads.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERY_PARSE_FAILED'))) {
    return 'The capability probe Recovery response could not be parsed into a source-grounded C1–C7 report, so the result stayed fail-closed.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERY_FAILED'))) {
    return 'The bounded capability probe Recovery attempt failed, so the result stayed fail-closed instead of accepting unsupported claims.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERY_REJECTED'))) {
    return 'The capability probe Recovery response was rejected because it did not satisfy the exact-source C1–C7 evidence gate.';
  }
  if (!finalReportIsNotProven && summary.diagnosticCodes.some((code) => code.includes('FORENSIC_DETERMINISTIC_FINDING'))) {
    return 'A high-confidence executable pattern was verified from the completed source read, and the Finding passed the forensic contract and evidence gate.';
  }
  if (!finalReportIsNotProven && summary.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_ACCEPTED'))) {
    return 'The structured Recovery envelope was accepted and rebuilt into the six-section forensic report.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('SKIPPED_NO_EVIDENCE'))) {
    return 'Recovery was skipped because no completed source read was available to support a trustworthy report.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_REJECTED'))) {
    return 'Recovery returned a structured envelope, but its Finding evidence or phase linkage failed validation. The candidate was rejected and the next bounded candidate was tried.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_PARSE_FAILED'))) {
    return 'Recovery returned a response that was not a valid structured Findings envelope. The next bounded candidate was tried without weakening the evidence gate.';
  }
  if (summary.diagnosticCodes.some((code) =>
    code.includes('FORENSIC_NO_FINDING') ||
    code.includes('STRUCTURED_RECOVERY_NO_FINDING'),
  )) {
    return 'No defect was directly proven from the completed source reads. This is a valid forensic outcome, so no repair phase is executable.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('EVIDENCE_ONLY_FALLBACK'))) {
    const providerFailure = summary.diagnosticDetails.find((detail) =>
      detail.toLowerCase().includes('provider failure codes:'),
    );
    return providerFailure
      ? `Recovery could not obtain a provider response (${providerFailure.replace(/^.*provider failure codes:\s*/i, '')}). The completed source reads were preserved safely, but Findings and repair phases remain blocked.`
      : 'All bounded recovery attempts failed after the completed source reads were preserved. The Evidence Map was rebuilt safely, but Findings and repair phases remain blocked.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('PARSE_FAILED'))) {
    const violation = firstConcreteViolationDetail(summary.diagnosticDetails);
    return violation
      ? `The recovery response could not be parsed into the required six-section forensic report: ${violation}.`
      : 'The recovery response could not be parsed into the required six-section forensic report.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('RECOVERY_FAILED'))) {
    const violation = firstConcreteViolationDetail(summary.diagnosticDetails);
    return violation
      ? `The bounded recovery attempt failed: ${violation}.`
      : 'The bounded recovery attempt failed, so the report stayed fail-closed instead of accepting unsupported findings.';
  }
  if (summary.diagnosticCodes.some((code) => code.includes('REJECTED'))) {
    const violation = firstConcreteViolationDetail(summary.diagnosticDetails);
    return violation
      ? `The model response was rejected: ${violation}.`
      : 'The model response was rejected because it did not satisfy the required six-section evidence contract.';
  }
  const violation = firstConcreteViolationDetail(summary.diagnosticDetails);
  return violation
    ? `The forensic response did not satisfy the evidence contract: ${violation}.`
    : 'The final forensic response did not provide enough validated evidence for an executable repair phase.';
}

export function isForensicRejection(
  summary: AiStreamExecutionSummary | null,
  finalVerdict: FinalForensicVerdict | null = null,
): boolean {
  if (finalVerdict === 'FINDING PROVEN' || finalVerdict === 'NO FINDING') {
    return false;
  }
  if (finalVerdict === 'NOT PROVEN') {
    return true;
  }
  if (summary?.diagnosticCodes.some((code) =>
    code.includes('STRUCTURED_RECOVERY_ACCEPTED') ||
    code.includes('FORENSIC_DETERMINISTIC_FINDING'),
  )) {
    return false;
  }
  return summary?.diagnosticCodes.some((code) =>
    code.includes('RECOVERY_REJECTED') ||
    code.includes('RECOVERY_FAILED') ||
    code.includes('PARSE_FAILED') ||
    code.includes('CAPABILITY_PROBE_CLAIM_UNCLOSED') ||
    code.includes('CAPABILITY_PROBE_RECOVERY_SKIPPED_INCOMPLETE') ||
    code.includes('FORENSIC_NO_FINDING') ||
    code.includes('STRUCTURED_RECOVERY_NO_FINDING') ||
    code.includes('SKIPPED_NO_EVIDENCE'),
  ) ?? false;
}
