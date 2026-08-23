/**
 * PR-06: Handwritten SSE hook for AI chat streaming — intentional codegen exception.
 *
 * This hook is the ONLY sanctioned consumer of `POST /api/ai/chat/stream`.
 * The contract between this hook and the server is documented in two places
 * that must be kept in sync:
 *
 *   1. `lib/api-spec/openapi.yaml`  — the `AiStreamEvent` event shapes in the
 *      `/api/ai/chat/stream` operation description (x-no-codegen: true).
 *
 *   2. This file — the TypeScript event union below is the authoritative runtime
 *      type for all consumers. Do not add a new event type on the server without
 *      first extending `AiStreamEvent` here and updating the openapi.yaml
 *      description.
 *
 * Why not generated?
 *   Orval does not support Server-Sent Events (text/event-stream). OpenAPI 3.1
 *   has no standard way to describe a multiplexed discriminated event stream.
 *   This hook fills that gap: it wraps native `fetch` + `ReadableStream`, parses
 *   `data: <JSON>\n\n` frames, and routes each parsed event to a typed callback.
 *
 * Usage:
 *   const { send, isPending } = useAiChatStream();
 *   await send({ projectId, message, sessionId }, {
 *     onStage: (stage) => setCurrentStage(stage),
 *     onDelta: (token) => appendToken(token),   // real-time streaming tokens
 *     onDone:  (data)  => handleDone(data),
 *     onError: (err)   => handleError(err),
 *   });
 */

import { useState, useCallback, useRef } from 'react';
import type { BrowserValidationBlockReason, PublicValidationResult, ValidationResult } from '@workspace/ai-orchestrator';

// ── Event shapes ──────────────────────────────────────────────────────────────

export type AiStreamStageEvent = {
  type: 'stage';
  /** Server-defined stage identifier, e.g. "building-context" | "calling-model" | "streaming" */
  stage: string;
};

export type AiStreamDeltaEvent = {
  type: 'delta';
  /** Incremental text fragment from the model's streaming response. */
  delta: string;
};

/** Server-authoritative routing decision emitted before model work begins. */
export type AiStreamIntentEvent = {
  type: 'intent';
  intent: 'CHAT' | 'PROJECT_QUERY' | 'FORENSIC_AUDIT' | 'DELIVERY';
  operationMode: 'CHAT' | 'FORENSIC_AUDIT' | 'DELIVERY';
  requiresEvidence: boolean;
};

/** Bounded forensic state projection; values are contract labels, not prose. */
export type AiStreamAuditStateEvent = {
  type: 'audit_state';
  sourceCoverage: 'COMPLETE' | 'PARTIAL' | 'NONE';
  behaviorAssessment: 'COMPLETE' | 'INCOMPLETE' | 'NOT_STARTED';
  findingStatus: 'PROVEN' | 'NO_FINDING' | 'NOT_PROVEN';
  repairReadiness: 'READY' | 'BLOCKED';
  productionReachability: 'PROVEN' | 'NOT_PROVEN' | 'OUT_OF_SCOPE';
};

/** Verification telemetry emitted after model output is checked. */
export type AiStreamVerificationEvent = {
  type: 'verification';
  stage: 'MODEL_RESPONSE' | 'VERIFIED_RESPONSE';
  responseLength: number;
  sourceCount: number;
  evidenceCount: number;
  acceptedEvidenceCount: number;
  rejectionReasons: string[];
};

/** An accepted behavior-evidence excerpt with its exact source line span (when verifiable). */
export type AiBehaviorEvidence = {
  source: string;
  excerpt?: string;
  sourceSpan?: { startLine: number; endLine: number };
  supportsClaim: boolean;
  citationStatus?: 'ACCEPTED' | 'BLOCKED';
  citationReason?:
    | 'ACCEPTED_SOURCE_SPAN'
    | 'MISSING_LITERAL_MATCH'
    | 'UNRESOLVED_SOURCE_SPAN'
    | 'INSUFFICIENT_BEHAVIORAL_CONTEXT';
  directness?: 'DIRECT' | 'INDIRECT';
  sourceType?: string;
  evidenceClass?: string;
};

export type AiStreamDoneEvent = {
  type: 'done';
  sessionId: string;
  message: {
    id: string;
    role: 'assistant';
    content: string;
    sources: string;
    /** JSON-encoded bounded tool trace kept separate from assistant content. */
    toolTrace?: string | null;
    /** JSON-encoded accepted behavior-evidence references (with exact line spans). */
    behaviorEvidence?: string | null;
    createdAt: string;
    turnIntent?: string;
    executionId?: string | null;
    outcome?: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED';
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  /** Exact source line spans for each accepted behavior-evidence excerpt. */
  behaviorEvidence?: AiBehaviorEvidence[];
  sources: string[];
  /** Same trace as message.toolTrace, exposed for stream consumers. */
  toolTrace?: string | null;
  pendingChanges: Array<{
    path: string;
    absolutePath: string;
    newContent: string;
    originalContent: string | null;
    reason: string;
    validationProfile?: 'ai-orchestrator-tests' | 'knowledge-engine-tests' | 'api-ai-tests';
  }>;
  proposalId?: string;
  /** Stable Plan → Build → Apply operation identity when one exists. */
  operationId?: string;
  /** Distinguishes a read-only audit from the delivery workflow trace. */
  operationMode?: 'FORENSIC_AUDIT' | 'DELIVERY' | 'CHAT';
  proposalUnavailable?: string;
  /** STORY-04: actual model used at runtime (may differ from configured default if fallback occurred). */
  resolvedModel?: { id: string; provider: string; free: boolean };
  telemetry?: { latencyMs: number; provider: string };
  /** Bounded execution diagnostics, kept separate from assistant content. */
  execution?: AiStreamExecutionSummary;
  productionReachability?: AiProductionReachabilityTrace;
  crossFileTraces?: AiCrossFileSemanticTrace[];
  /**
   * AI-008: per-task typed result, discriminated on `kind` by forensicTaskType.
   * Absent for generic chat turns.  Narrow on `kind` before accessing task-specific fields.
   * Do NOT add server-side event changes without extending this union and updating openapi.yaml.
   */
  taskResult?:
    | { kind: 'CODE_EXTRACTION_RESULT'; extractedCode: string; source?: string }
    | { kind: 'BEHAVIOR_ANSWER_RESULT'; answer: Record<string, unknown> }
    | { kind: 'FINDING_RESULT'; finding: Record<string, unknown> }
    | { kind: 'FORENSIC_REPORT_RESULT'; report: string; evidence: Record<string, unknown>[] }
      | { kind: 'WORKSPACE_REVIEW_RESULT'; report: string; evidence: Record<string, unknown>[] }
     | { kind: 'REPAIR_RESULT'; phases: Record<string, unknown>[]; readiness: 'READY' | 'BLOCKED' | 'NOT_PROVEN' }
     | {
         kind: 'IMPLEMENTATION_PLAN_RESULT';
         objective: string;
         summary: string;
         assumptions: string[];
         steps: Record<string, unknown>[];
         validationCommands: string[];
         risks: string[];
         approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
         writeAccess: 'NOT_AUTHORIZED' | 'APPROVED_FOR_BUILD';
       };
  _meta?: { rootPathFallback?: { used: boolean; original?: string } };
};

export type AiStreamSessionStartedEvent = {
  type: 'session_started';
  sessionId: string;
  title: string;
  updatedAt: string;
};

export type AiStreamExecutionStartedEvent = {
  type: 'execution_started';
  executionId: string;
  status: 'running' | 'queued';
  resumeToken?: string;
  resumable: boolean;
};

export type AiExecutionNodeStatus = 'queued' | 'running' | 'passed' | 'failed' | 'blocked';

export type AiExecutionNodeSnapshot = {
  id: string;
  title: string;
  status: AiExecutionNodeStatus;
  allowedFiles: string[];
  dependencies: string[];
  validationProfile: string;
  attempts: number;
};

export type AiStreamExecutionNodesEvent = {
  type: 'execution_nodes';
  executionId: string;
  nodes: AiExecutionNodeSnapshot[];
};

export type AiStreamErrorEvent = {
  type: 'error';
  code: string;
  message: string;
  hint?: string;
  raw?: string;
  parseCode?: string;
  providerContext?: Record<string, unknown>;
  retryable?: boolean;
  suggestedFix?: string;
  executionId?: string;
  sessionId?: string;
  turnIntent?: string;
  outcome?: 'FAILED' | 'INTERRUPTED';
  failureKind?: 'PROVIDER_FORMAT' | 'RATE_LIMIT' | 'CONFIGURATION' | 'PROVIDER_FAILURE' | 'TRANSPORT';
};

export type AiStreamResetEvent = {
  type: 'stream_reset';
};

export type AiStreamToolCallEvent = {
  type: 'tool_call';
  /** Registered tool name, e.g. "read_file", "search_code". */
  tool: string;
  /** Parsed arguments for the tool call. */
  args: Record<string, string>;
  /** True when the result was served from the dedup cache (no real execution). */
  cached: boolean;
};

export type AiStreamToolResultEvent = {
  type: 'tool_result';
  tool: string;
  /** Ground-truth source label (e.g. file path) when available. */
  source?: string;
  cached: boolean;
  /** Bounded, content-free summary of the completed result. */
  resultSummary?: string;
};

export type AiStreamPlanActivityEvent = {
  type: 'plan_activity';
  stage: 'understand' | 'scope' | 'plan' | 'execute' | 'validate';
  status: 'active' | 'done' | 'info';
  stepTitle?: string;
  action?: 'inspect' | 'create' | 'modify' | 'delete' | 'test' | 'configure';
  files?: string[];
  resultSummary?: string;
  nextStepTitle?: string;
  approvalRequired?: boolean;
  approvalReason?: string;
};

export type AiStreamValidationEvent = {
  type: 'validation';
  validation: PublicValidationResult;
  repairState: RepairLoopState;
  /** @deprecated Use validation.status. */
  status?: ValidationResult['status'];
  /** @deprecated Use validation.profile. */
  profile?: string;
  /** @deprecated Use validation.scenario. */
  scenario?: string;
  /** @deprecated Use validation.command. */
  command?: string;
  /** @deprecated Use validation.exitCode. */
  exitCode?: number | null;
  /** @deprecated Use validation.failedTests / changedFiles. */
  failedTests?: string[];
  affectedFiles?: string[];
  failedTestDetails?: ValidationResult['failedTests'];
  changedFiles?: string[];
  attempt: number;
  maxAttempts: number;
  /** @deprecated Use validation.detail. */
  detail?: string;
};

export type RepairLoopState = 'VALIDATING' | 'REPAIRING' | 'READY_FOR_REVIEW' | 'BLOCKED';

export type AiStreamRepairStateEvent = {
  type: 'repair_state';
  state: RepairLoopState;
  detail?: string;
};

/**
 * Keep the dashboard on the API's public validation contract. The server may
 * include compatibility fields on the outer event, but command output,
 * failure details, and changed-file lists are never accepted from the nested
 * payload.
 */
export function parseValidationEvent(raw: unknown): AiStreamValidationEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  const validation = event.validation;
  if (!validation || typeof validation !== 'object') return null;
  const value = validation as Record<string, unknown>;
  if (
    typeof value.profile !== 'string'
    || typeof value.status !== 'string'
    || typeof value.scenario !== 'string'
    || (typeof value.exitCode !== 'number' && value.exitCode !== null)
    || !value.evidence
    || typeof value.evidence !== 'object'
    || typeof event.repairState !== 'string'
    || typeof event.attempt !== 'number'
    || typeof event.maxAttempts !== 'number'
  ) return null;

  const evidence = value.evidence as Record<string, unknown>;
  if (
    typeof evidence.evidenceId !== 'string'
    || typeof evidence.observedAt !== 'string'
    || typeof evidence.artifactRef !== 'string'
  ) return null;

  return {
    type: 'validation',
    validation: {
      profile: value.profile,
      status: value.status as PublicValidationResult['status'],
      scenario: value.scenario,
      exitCode: value.exitCode,
      evidence: {
        evidenceId: evidence.evidenceId,
        observedAt: evidence.observedAt,
        artifactRef: evidence.artifactRef,
      },
      ...(typeof value.detail === 'string' ? { detail: value.detail } : {}),
      ...(value.reasonCode === 'ownership' || value.reasonCode === 'invalid_profile' ||
        value.reasonCode === 'resource_limit' || value.reasonCode === 'stale_revision'
        ? { reasonCode: value.reasonCode as BrowserValidationBlockReason } : {}),
    },
    repairState: event.repairState as RepairLoopState,
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
  };
}

export type AiStreamModelCallEvent = {
  type: 'model_call';
  /** Exact model ID that returned the response for this loop iteration. */
  model: string;
  provider: string;
};

export type AiStreamThinkingEvent = {
  type: 'thinking';
  /** Current iteration index (0-based). */
  iter: number;
  /** Maximum iterations for this request. */
  max: number;
};

export type AiStreamExecutionGuardEvent = {
  type: 'execution_guard';
  code: 'REPEATED_TOOL_CALL';
  tool: string;
  message: string;
};

export type AiStreamSynthesisStartEvent = {
  type: 'synthesis_start';
  /** Zero-based iteration at which tool execution was disabled. */
  iter: number;
  /** Maximum iterations allocated to the request. */
  max: number;
};

export type AiStreamForensicStatusEvent = {
  type: 'forensic_status';
  /** Structured audit scope emitted live as evidence is gathered. */
  auditScope?: 'PRODUCTION' | 'FIXTURE_LOCAL';
  /** User-readable boundary approved for the active audit. */
  scopeDescription?: string;
  /** Explicit file manifest retained in request order for scoped audits. */
  requestedFiles?: string[];
  /** True when the proven Finding is supported only by fixture/test/spec evidence. */
  isFixtureLocal?: boolean;
  /** EI-036: Repair Scope Gate reason when repair is blocked (e.g. REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION). */
  repairBlockReason?: string;
};

/** FEG-017: why a forensic investigation's terminal failed (success terminals omit it). */
export type AiStreamForensicTerminalEvent = {
  type: 'forensic_terminal';
  terminalKind:
    | 'INVESTIGATION_NOT_STARTED'
    | 'INVESTIGATION_BUDGET_EXHAUSTED'
    | 'NO_EVIDENCE_FOUND'
    | 'EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED';
};

export type AiSemanticTraceSourceSpan = {
  file: string;
  line: number;
  column?: number;
  snippet?: string;
};

export type AiSemanticTraceNode = {
  id: string;
  name: string;
  path?: string;
  stage: 'ENTRY_POINT' | 'API_ROUTE' | 'ORCHESTRATOR' | 'TOOL_PROVIDER' | 'PERSISTENCE_OUTPUT' | 'OTHER';
};

export type AiSemanticTraceEdge = {
  from: string;
  to: string;
  relation: string;
  status: 'PROVEN' | 'NOT_PROVEN' | 'OUT_OF_SCOPE';
  source?: string;
  evidence?: string;
  sourceSpan?: AiSemanticTraceSourceSpan;
  runtimeObserved: boolean;
};

export type AiCrossFileSemanticTrace = {
  status: 'PROVEN' | 'NOT_PROVEN' | 'OUT_OF_SCOPE';
  nodes: AiSemanticTraceNode[];
  edges: AiSemanticTraceEdge[];
  maxDepth: number;
  reason?: string;
};

export type AiProductionReachabilityTrace = {
  status: 'PROVEN' | 'NOT_PROVEN' | 'OUT_OF_SCOPE';
  nodes: AiSemanticTraceNode[];
  edges: AiSemanticTraceEdge[];
  reason?: string;
};

export type AiStreamProductionTraceEvent = AiProductionReachabilityTrace & {
  type: 'production_trace';
};

export type AiStreamCrossFileTraceEvent = AiCrossFileSemanticTrace & {
  type: 'cross_file_trace';
};

/**
 * Task-router trace emitted live as the verdict is decided. Carries the
 * verdict's proof scope (FIXTURE_LOCAL / PRODUCTION / TEST_LOCAL / SPEC_LOCAL /
 * MIXED / NOT_PROVEN) computed by the final runtime ledger, so a user watching
 * a run sees whether the proven Finding is fixture-local before the report lands.
 */
export type AiStreamDecisionTraceEvent = {
  type: 'decision_trace';
  taskType: string;
  evidenceSelected: number;
  validator: string;
  recoveryAttempt: number;
  recoveryFailureKind?: string;
  finalState: 'VERIFIED' | 'NOT_PROVEN' | 'RECOVERY_REQUIRED' | 'FAILED';
  rejectionReason: string[];
  /** Task #46: the verdict's proof scope, computed by the final runtime ledger. */
  verdictScope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
  scopedFindingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
};

export type AiStreamTaskStartedEvent = {
  type: 'task_started';
  task: 'analyze' | 'review';
  projectId: string;
  operationId: string;
  projectRevision: string;
  rootAvailable: boolean;
  incomplete: boolean;
  operationalTrace: AiStructuredAuditTraceEntry[];
};

export type AiStructuredAuditTraceEntry = {
  stage: string;
  status: 'started' | 'completed' | 'failed' | 'incomplete';
  provider?: string;
};

export type AiStructuredAuditMetadata = {
  operationId: string;
  projectId: string;
  projectRevision: string;
  rootAvailable: boolean;
  incomplete: boolean;
  operationalTrace: AiStructuredAuditTraceEntry[];
};

export type AiStreamTaskProgressEvent = {
  type: 'task_progress';
  task: 'analyze' | 'review';
  message: string;
  provider?: string;
  operationId: string;
  projectId: string;
  projectRevision: string;
  rootAvailable: boolean;
  incomplete: boolean;
  operationalTrace: AiStructuredAuditTraceEntry[];
};

export type AiStreamTaskDoneEvent = {
  type: 'task_done';
  task: 'analyze' | 'review';
  result: Record<string, unknown>;
  operationId: string;
  projectId: string;
  projectRevision: string;
  rootAvailable: boolean;
  incomplete: boolean;
  operationalTrace: AiStructuredAuditTraceEntry[];
};

export type AiStreamExecutionDiagnosticEvent = {
  type: 'execution_diagnostic';
  code:
    | 'FORENSIC_CONTRACT_RECOVERY_REJECTED'
    | 'FORENSIC_CONTRACT_RECOVERY_PARSE_FAILED'
    | 'FORENSIC_CONTRACT_RECOVERY_FAILED'
    | 'FORENSIC_STRUCTURED_RECOVERY_ACCEPTED'
    | 'FORENSIC_STRUCTURED_RECOVERY_REJECTED'
    | 'FORENSIC_STRUCTURED_RECOVERY_PARSE_FAILED'
    | 'FORENSIC_STRUCTURED_RECOVERY_NO_FINDING'
    | 'FORENSIC_EVIDENCE_ONLY_FALLBACK'
    | 'FORENSIC_CONTRACT_RECOVERY_SKIPPED_NO_EVIDENCE'
    | 'EXECUTION_RESPONSE_FORMAT_INVALID'
    | 'EXECUTION_JSON_CORRECTION_FAILED'
    | 'EXECUTION_JSON_CORRECTION_RETRY_FAILED'
    | 'EXECUTION_PROVIDER_FAILURE'
    | 'EXECUTION_NO_EDIT_TOOL'
    | 'EXECUTION_PHASE_TOOL_REJECTED';
  /** Bounded contract metadata only; never source contents or model text. */
  details?: string[];
  /** Present only for a server-owned phase-policy rejection. */
  phase?: 'localization' | 'evidence' | 'patch_proposal' | 'validation' | 'repair_recovery' | 'report';
  tool?: string;
};

export type AiStreamExecutionSummary = {
  iterations: number;
  maxIterations: number;
  /** Total tool-call events, including prefetch and cached loop calls. */
  toolCalls: number;
  prefetchToolCalls: number;
  loopToolCalls: number;
  stopReason: 'response' | 'iteration_budget' | 'soft_limit' | 'repeated_tool_call' | 'empty_response' | 'provider_timeout' | 'cancelled';
  synthesisStarted: boolean;
  /** Bounded final-synthesis telemetry safe for operator-facing UI. */
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
  recoveryStarted?: boolean;
  diagnosticCodes: string[];
  diagnosticDetails?: string[];
  /** Distinct model IDs that produced successful loop responses, in order. */
  modelsUsed?: string[];
  /** Distinct model IDs used by the bounded forensic Recovery chain. */
  recoveryModelsUsed?: string[];
  /**
   * EI-012: true when the run-ledger telemetry reconciled with the run's cited
   * evidence (no evidence↔read mismatch). False/null when the reconciliation
   * gate blocked the verdict. Presence here is the client-facing signal that a
   * reconciliation actually ran for this turn.
   */
  evidenceConsistent?: boolean;
  /**
   * FEG-015: source-retrieval read classification and starvation telemetry.
   * `firstEvidenceAcquired` is the key run-summary signal that the
   * investigation actually reached source evidence (versus starving at zero).
   * Reads are split into prefetch / targeted / dependency / duplicate buckets
   * so a regression cannot hide inside a single `filesRead` count.
   */
  sourceRetrieval?: {
    /** True once ANY source evidence was acquired (first read or usable prefetch). */
    firstEvidenceAcquired: boolean;
    /** 0-based loop iteration of the first source read (null = never read a source). */
    iterationsUntilFirstRead: number | null;
    /** Iterations that elapsed without any source evidence. */
    iterationsWithoutEvidence: number;
    /** Loop iterations that issued tool calls but landed no new read. */
    planningIterations: number;
    /** Loop iterations that landed a new source read. */
    evidenceIterations: number;
    /** search/list gather calls issued before the first source read. */
    crossFileQueriesBeforeFirstRead: number;
    /** True when usable source bodies were prefetched before the loop. */
    prefetchBeforeFirstRead: boolean;
    /** Source reads that landed before the loop. */
    prefetchReads: number;
    /** Source reads issued as targeted range reads. */
    targetedReads: number;
    /** New follow-up source reads made after the run already had evidence. */
    dependencyReads: number;
    /** Re-reads of an already-read path. */
    duplicateReads: number;
    /** Distinct paths the loop actually read via read tools. */
    readPaths: string[];
  };
};

/**
 * Live run-ledger telemetry reconciliation (EI-011/012). Emitted as part of the
 * stream when the orchestrator reconciles the files it read with the evidence
 * it cites. `consistent: false` means the verdict failed closed on
 * TELEMETRY_INCONSISTENT, and `violations` are the bounded, content-free reason
 * labels for why.
 */
export type AiStreamEvidenceIntegrityEvent = {
  type: 'evidence_integrity';
  /** "TELEMETRY_CONSISTENT" | "TELEMETRY_INCONSISTENT" (or a variant label). */
  code: string;
  consistent: boolean;
  /** Bounded, content-free violation labels (never source contents). */
  violations: string[];
  readAttempts?: number;
  uniqueFilesRead?: number;
  evidenceFileCount?: number;
  acceptedEvidenceCount?: number;
  /** Objective completion proof, present when the request declared an objective. */
  objectiveType?: string;
  requiredEdges?: string[];
  provenEdges?: string[];
  completionGateResult?: string;
  finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
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
};

export type AiStreamEvent =
  | AiStreamExecutionStartedEvent
  | AiStreamExecutionNodesEvent
  | AiStreamStageEvent
  | AiStreamDeltaEvent
  | AiStreamIntentEvent
  | AiStreamAuditStateEvent
  | AiStreamVerificationEvent
  | AiStreamSessionStartedEvent
  | AiStreamDoneEvent
  | AiStreamErrorEvent
  | AiStreamResetEvent
  | AiStreamToolCallEvent
  | AiStreamToolResultEvent
  | AiStreamPlanActivityEvent
  | AiStreamValidationEvent
  | AiStreamRepairStateEvent
  | AiStreamModelCallEvent
  | AiStreamThinkingEvent
  | AiStreamExecutionGuardEvent
  | AiStreamSynthesisStartEvent
  | AiStreamExecutionDiagnosticEvent
  | AiStreamForensicStatusEvent
  | AiStreamForensicTerminalEvent
  | AiStreamProductionTraceEvent
  | AiStreamCrossFileTraceEvent
  | AiStreamEvidenceIntegrityEvent
  | AiStreamDecisionTraceEvent
  | AiStreamTaskStartedEvent
  | AiStreamTaskProgressEvent
  | AiStreamTaskDoneEvent;

// ── Hook params ───────────────────────────────────────────────────────────────

export type AiChatStreamParams = {
  projectId: string;
  message: string;
  sessionId?: string;
  /** AI-TASK-006: When set, the backend loads this task and builds a task-aware prompt. */
  linkedTaskId?: string;
  /** Build handoff from an approved implementation-plan message. */
  buildPlanMessageId?: string;
  /** Resume an existing paused execution instead of starting a duplicate. */
  executionId?: string;
  /** Opaque token returned in execution_started for explicit resume. */
  resumeToken?: string;
  /** Stable retry key for the first request. */
  idempotencyKey?: string;
};

export type AiChatStreamCallbacks = {
  /** Durable execution identity emitted before model work starts. */
  onExecutionStarted?: (event: AiStreamExecutionStartedEvent) => void;
  /** Bounded execution tree snapshot used by Mission Control. */
  onExecutionNodes?: (event: AiStreamExecutionNodesEvent) => void;
  /** Called once the server has reserved a new session before model work starts. */
  onSessionStarted?: (event: AiStreamSessionStartedEvent) => void;
  onStage?: (stage: string) => void;
  /** Called once the server has resolved the authoritative turn routing contract. */
  onIntent?: (event: AiStreamIntentEvent) => void;
  /** Called when the forensic evidence ledger publishes its bounded state. */
  onAuditState?: (event: AiStreamAuditStateEvent) => void;
  /** Called when the server verifies the model response/evidence boundary. */
  onVerification?: (event: AiStreamVerificationEvent) => void;
  /** Called for each incremental text token from the model's streaming response. */
  onDelta?: (delta: string) => void;
  /** Called when the SSE stream breaks mid-flight so callers can clear partial state. */
  onStreamReset?: () => void;
  onDone?: (data: AiStreamDoneEvent) => void;
  onError?: (err: AiStreamErrorEvent) => void;
  /** Called when the agent starts executing a tool (before the actual call). */
  onToolCall?: (event: AiStreamToolCallEvent) => void;
  /** Called when a tool call completes and a result has been received. */
  onToolResult?: (event: AiStreamToolResultEvent) => void;
  onPlanActivity?: (event: AiStreamPlanActivityEvent) => void;
  /** Called after a server-owned validation profile completes or is blocked. */
  onValidation?: (event: AiStreamValidationEvent) => void;
  /** Called when the approval-gated repair loop changes named state. */
  onRepairState?: (event: AiStreamRepairStateEvent) => void;
  /** Called after a model response is received, including fallback models. */
  onModelCall?: (event: AiStreamModelCallEvent) => void;
  /** Called at each agentic loop iteration after the first (iter > 0). */
  onThinking?: (event: AiStreamThinkingEvent) => void;
  /** Called when a Repair Plan execution is stopped by a deterministic guard. */
  onExecutionGuard?: (event: AiStreamExecutionGuardEvent) => void;
  /** Called when the final no-tool synthesis window begins. */
  onSynthesisStart?: (event: AiStreamSynthesisStartEvent) => void;
  /** Called for bounded report-recovery diagnostics, separate from report text. */
  onExecutionDiagnostic?: (event: AiStreamExecutionDiagnosticEvent) => void;
  /**
   * Called as soon as a `forensic_status` step is emitted live during the
   * audit stream.  Carries `isFixtureLocal` so callers can surface a
   * FIXTURE-LOCAL warning before the full report arrives.
   */
  onForensicStatus?: (event: AiStreamForensicStatusEvent) => void;
  /** FEG-017: called when a forensic investigation's failure terminal is classified. */
  onForensicTerminal?: (event: AiStreamForensicTerminalEvent) => void;
  /** Called when the server proves or rejects runtime production reachability. */
  onProductionTrace?: (event: AiStreamProductionTraceEvent) => void;
  /** Called for bounded graph-grounded cross-file provenance. */
  onCrossFileTrace?: (event: AiStreamCrossFileTraceEvent) => void;
  /**
   * Called when the run-ledger telemetry reconciliation completes. Lets the UI
   * surface EI-011/012 consistency + violations for the run as they happen.
   */
  onEvidenceIntegrity?: (event: AiStreamEvidenceIntegrityEvent) => void;
  /**
   * Called when the task router decides the verdict live. Carries the proof
   * scope so callers can surface a FIXTURE-LOCAL / PRODUCTION badge (and the
   * scoped finding status) before the full report lands.
   */
  onDecisionTrace?: (event: AiStreamDecisionTraceEvent) => void;
  onTaskStarted?: (event: AiStreamTaskStartedEvent) => void;
  onTaskProgress?: (event: AiStreamTaskProgressEvent) => void;
  onTaskDone?: (event: AiStreamTaskDoneEvent) => void;
};

// ── Stream processor ──────────────────────────────────────────────────────────

/**
 * Reads a server-sent-events `body` to completion, parses each `data: {...}\n\n`
 * frame, and dispatches the typed event to the matching callback in `callbacks`.
 *
 * Extracted from `useAiChatStream` so the routing logic can be tested directly
 * without a React / fetch runtime.  The hook calls this function internally;
 * the behaviour is identical to what it was before extraction.
 *
 * @internal Exported for testing — not part of the public API contract.
 */
export async function processAiStream(
  body: ReadableStream<Uint8Array>,
  callbacks: AiChatStreamCallbacks,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let executionStarted = false;
  let taskStarted = false;
  let terminalEventReceived = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // A proxy/provider can close a healthy-looking SSE response without
      // sending either `done` or `error`. Once the server has issued an
      // execution identity, surface that EOF as a recoverable interruption so
      // callers can resume the same operation instead of silently dropping it.
      if ((executionStarted || taskStarted) && !terminalEventReceived) {
        callbacks.onStreamReset?.();
      }
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by double newlines: "data: {...}\n\n"
    const chunks = buffer.split('\n\n');
    // Last element is the incomplete chunk — keep it for the next read
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;

      let event: AiStreamEvent;
      try {
        event = JSON.parse(dataLine.slice('data: '.length)) as AiStreamEvent;
      } catch {
        continue; // malformed event — skip
      }

      if (event.type === 'execution_started') executionStarted = true;
      if (event.type === 'task_started') taskStarted = true;
      if (event.type === 'done' || event.type === 'error') terminalEventReceived = true;

      switch (event.type) {
        case 'execution_started':
          callbacks.onExecutionStarted?.(event);
          break;
        case 'execution_nodes':
          callbacks.onExecutionNodes?.(event);
          break;
        case 'session_started':
          callbacks.onSessionStarted?.(event);
          break;
        case 'stage':
          callbacks.onStage?.(event.stage);
          break;
        case 'intent':
          callbacks.onIntent?.(event);
          break;
        case 'audit_state':
          callbacks.onAuditState?.(event);
          break;
        case 'verification':
          callbacks.onVerification?.(event);
          break;
        case 'delta':
          callbacks.onDelta?.(event.delta);
          break;
        case 'done':
          callbacks.onDone?.(event);
          break;
        case 'error':
          callbacks.onError?.(event);
          break;
        case 'stream_reset':
          callbacks.onStreamReset?.();
          break;
        case 'tool_call':
          callbacks.onToolCall?.(event);
          break;
        case 'tool_result':
          callbacks.onToolResult?.(event);
          break;
        case 'plan_activity':
          callbacks.onPlanActivity?.(event);
          break;
        case 'validation': {
          const validationEvent = parseValidationEvent(event);
          if (validationEvent) callbacks.onValidation?.(validationEvent);
          break;
        }
        case 'repair_state':
          callbacks.onRepairState?.(event);
          break;
        case 'model_call':
          callbacks.onModelCall?.(event);
          break;
        case 'thinking':
          callbacks.onThinking?.(event);
          break;
        case 'execution_guard':
          callbacks.onExecutionGuard?.(event);
          break;
        case 'synthesis_start':
          callbacks.onSynthesisStart?.(event);
          break;
        case 'execution_diagnostic':
          callbacks.onExecutionDiagnostic?.(event);
          break;
        case 'forensic_status':
          callbacks.onForensicStatus?.(event);
          break;
        case 'forensic_terminal':
          callbacks.onForensicTerminal?.(event);
          break;
        case 'production_trace':
          callbacks.onProductionTrace?.(event);
          break;
        case 'cross_file_trace':
          callbacks.onCrossFileTrace?.(event);
          break;
        case 'evidence_integrity':
          callbacks.onEvidenceIntegrity?.(event);
          break;
        case 'decision_trace':
          callbacks.onDecisionTrace?.(event);
          break;
        case 'task_started':
          callbacks.onTaskStarted?.(event);
          break;
        case 'task_progress':
          callbacks.onTaskProgress?.(event);
          break;
        case 'task_done':
          callbacks.onTaskDone?.(event);
          break;
      }
    }
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAiChatStream() {
  const [isPending, setIsPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const executionRef = useRef<{ id: string; resumeToken?: string } | null>(null);
  const generationRef = useRef(0);

  const send = useCallback(async (
    params: AiChatStreamParams,
    callbacks: AiChatStreamCallbacks = {},
  ): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    controllerRef.current = controller;
    if (params.executionId) {
      executionRef.current = { id: params.executionId, resumeToken: params.resumeToken };
    } else {
      executionRef.current = null;
    }
    setIsPending(true);
    const isCurrent = () => (
      generationRef.current === generation
      && controllerRef.current === controller
      && !controller.signal.aborted
    );
    const guardedCallbacks: AiChatStreamCallbacks = {
      onExecutionStarted: (event) => {
        if (!isCurrent()) return;
        executionRef.current = {
          id: event.executionId,
          ...(event.resumeToken ? { resumeToken: event.resumeToken } : {}),
        };
        callbacks.onExecutionStarted?.(event);
      },
      onExecutionNodes: (event) => { if (isCurrent()) callbacks.onExecutionNodes?.(event); },
      onSessionStarted: (event) => { if (isCurrent()) callbacks.onSessionStarted?.(event); },
      onStage: (event) => { if (isCurrent()) callbacks.onStage?.(event); },
      onIntent: (event) => { if (isCurrent()) callbacks.onIntent?.(event); },
      onAuditState: (event) => { if (isCurrent()) callbacks.onAuditState?.(event); },
      onVerification: (event) => { if (isCurrent()) callbacks.onVerification?.(event); },
      onDelta: (event) => { if (isCurrent()) callbacks.onDelta?.(event); },
      onStreamReset: () => { if (isCurrent()) callbacks.onStreamReset?.(); },
      onDone: (event) => {
        if (!isCurrent()) return;
        executionRef.current = null;
        callbacks.onDone?.(event);
      },
      onError: (event) => { if (isCurrent()) callbacks.onError?.(event); },
      onToolCall: (event) => { if (isCurrent()) callbacks.onToolCall?.(event); },
      onToolResult: (event) => { if (isCurrent()) callbacks.onToolResult?.(event); },
      onPlanActivity: (event) => { if (isCurrent()) callbacks.onPlanActivity?.(event); },
      onValidation: (event) => { if (isCurrent()) callbacks.onValidation?.(event); },
      onRepairState: (event) => { if (isCurrent()) callbacks.onRepairState?.(event); },
      onModelCall: (event) => { if (isCurrent()) callbacks.onModelCall?.(event); },
      onThinking: (event) => { if (isCurrent()) callbacks.onThinking?.(event); },
      onExecutionGuard: (event) => { if (isCurrent()) callbacks.onExecutionGuard?.(event); },
      onSynthesisStart: (event) => { if (isCurrent()) callbacks.onSynthesisStart?.(event); },
      onExecutionDiagnostic: (event) => { if (isCurrent()) callbacks.onExecutionDiagnostic?.(event); },
      onForensicStatus: (event) => { if (isCurrent()) callbacks.onForensicStatus?.(event); },
      onForensicTerminal: (event) => { if (isCurrent()) callbacks.onForensicTerminal?.(event); },
      onProductionTrace: (event) => { if (isCurrent()) callbacks.onProductionTrace?.(event); },
      onCrossFileTrace: (event) => { if (isCurrent()) callbacks.onCrossFileTrace?.(event); },
      onEvidenceIntegrity: (event) => { if (isCurrent()) callbacks.onEvidenceIntegrity?.(event); },
      onDecisionTrace: (event) => { if (isCurrent()) callbacks.onDecisionTrace?.(event); },
      onTaskStarted: (event) => { if (isCurrent()) callbacks.onTaskStarted?.(event); },
      onTaskProgress: (event) => { if (isCurrent()) callbacks.onTaskProgress?.(event); },
      onTaskDone: (event) => { if (isCurrent()) callbacks.onTaskDone?.(event); },
    };
    try {
      const requestParams = {
        ...params,
        idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
      };
      const res = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestParams),
        signal: controller.signal,
      });

      // Handle non-SSE error responses (e.g. 400/401/428/429 before the stream starts)
      if (!res.ok) {
        let parsed: { code?: string; error?: string; hint?: string } = {};
        try { parsed = await res.json() as typeof parsed; } catch { /* ignore */ }

        // HTTP 401 without a structured code means the Clerk session expired
        // (the auth middleware rejected the request before it reached the AI handler).
        // Surface this as AUTH_ERROR so describeStreamError maps it to the
        // correct 401 case with a session-expiry hint rather than the generic
        // "Groq API key is invalid" fallback.
        const isSessionExpiry = res.status === 401 && !parsed.code;
        guardedCallbacks.onError?.({
          type: 'error',
          code: isSessionExpiry ? 'AUTH_ERROR' : (parsed.code ?? 'request_failed'),
          message: parsed.error ?? `Request failed (${res.status})`,
          hint: isSessionExpiry
            ? 'جلستك انتهت — أعد تحميل الصفحة لتسجيل الدخول. / Your session expired — refresh the page to sign in again.'
            : parsed.hint,
        });
        return;
      }

      // Server sets Content-Type: text/event-stream for the happy path.
      // If body is null (shouldn't happen in practice), treat as error.
      if (!res.body) {
        guardedCallbacks.onError?.({ type: 'error', code: 'no_body', message: 'Stream response had no body.' });
        return;
      }

      await processAiStream(res.body, guardedCallbacks);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // Network-level failure (fetch threw)
      guardedCallbacks.onError?.({
        type: 'error',
        code: 'network_error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsPending(false);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    const execution = executionRef.current;
    if (execution) {
      void fetch(`/api/ai/executions/${execution.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => undefined);
    }
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    executionRef.current = null;
    setIsPending(false);
  }, []);

  return { send, cancel, isPending, execution: executionRef.current };
}

export type AiTaskStreamParams = {
  projectId: string;
  task: 'analyze' | 'review';
  fileContents?: Record<string, string>;
};

export type AiTaskStreamCallbacks = Pick<
  AiChatStreamCallbacks,
  'onStage' | 'onModelCall' | 'onTaskStarted' | 'onTaskProgress' | 'onTaskDone' | 'onError' | 'onStreamReset'
>;

/**
 * Streams structured Analyze/Review operations through the shared SSE parser.
 * The existing JSON endpoints remain available for non-streaming clients.
 */
export function useAiTaskStream() {
  const [isPending, setIsPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const send = useCallback(async (
    params: AiTaskStreamParams,
    callbacks: AiTaskStreamCallbacks = {},
  ): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    controllerRef.current = controller;
    setIsPending(true);
    const isCurrent = () => (
      generationRef.current === generation
      && controllerRef.current === controller
      && !controller.signal.aborted
    );
    const guardedCallbacks: AiTaskStreamCallbacks = {
      onStage: (event) => { if (isCurrent()) callbacks.onStage?.(event); },
      onModelCall: (event) => { if (isCurrent()) callbacks.onModelCall?.(event); },
      onTaskStarted: (event) => { if (isCurrent()) callbacks.onTaskStarted?.(event); },
      onTaskProgress: (event) => { if (isCurrent()) callbacks.onTaskProgress?.(event); },
      onTaskDone: (event) => { if (isCurrent()) callbacks.onTaskDone?.(event); },
      onError: (event) => { if (isCurrent()) callbacks.onError?.(event); },
      onStreamReset: () => { if (isCurrent()) callbacks.onStreamReset?.(); },
    };

    try {
      const res = await fetch(`/api/ai/projects/${params.projectId}/${params.task}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.task === 'review' ? { fileContents: params.fileContents } : {}),
        signal: controller.signal,
      });

      if (!res.ok) {
        let parsed: { code?: string; error?: string; hint?: string } = {};
        try { parsed = await res.json() as typeof parsed; } catch { /* ignore */ }
        guardedCallbacks.onError?.({
          type: 'error',
          code: parsed.code ?? 'request_failed',
          message: parsed.error ?? `Request failed (${res.status})`,
          hint: parsed.hint,
          failureKind: res.status === 429
            ? 'RATE_LIMIT'
            : res.status === 401 || res.status === 402 || res.status === 422 || res.status === 428
              ? 'CONFIGURATION'
              : 'PROVIDER_FAILURE',
          outcome: 'FAILED',
        });
        return;
      }

      if (!res.body) {
        guardedCallbacks.onError?.({ type: 'error', code: 'no_body', message: 'Task stream response had no body.', failureKind: 'TRANSPORT', outcome: 'INTERRUPTED' });
        return;
      }

      await processAiStream(res.body, guardedCallbacks);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      guardedCallbacks.onError?.({
        type: 'error',
        code: 'network_error',
        message: err instanceof Error ? err.message : String(err),
        failureKind: 'TRANSPORT',
        outcome: 'INTERRUPTED',
      });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setIsPending(false);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsPending(false);
  }, []);

  return { send, cancel, isPending };
}
