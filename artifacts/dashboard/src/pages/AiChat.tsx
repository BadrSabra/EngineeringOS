import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { Bot, Send, Plus, ChevronDown, Loader2, User, Zap, Search, Code2, GitMerge, Key, Trash2, Check, FileCode2, ChevronRight, X, Menu, Activity, ShieldAlert, ShieldCheck, CheckCircle2, FileSearch, RotateCcw, Square, Eye, Play, Pause, SkipBack, StepForward, ExternalLink, Clock3 } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  useListProjects,
  getListProjectsQueryKey,
  classifyProjectError,
  isRetryableProjectError,
  emitProjectLoadFailed,
  useAiChatStream,
  useAiTaskStream,
  useGetDeepSeekKeyStatus,
  useGetGroqKeyStatus,
  useGetProviderKeyStatus,
  useGetOpenRouterKeyStatus,
  useGetActiveProvider,
  useGetAiMetrics,
  useGetAiExecution,
  useListAiChatSessions,
  useListAiChatMessages,
  useGetAiPendingProposal,
  useListEvents,
  useGetAiChatFileContent,
  getGetAiChatFileContentQueryKey,
  useSaveDeepSeekKey,
  useDeleteDeepSeekKey,
  useSaveGroqKey,
  useDeleteGroqKey,
  useSaveGeminiKey,
  useDeleteGeminiKey,
  useSaveOpenRouterKey,
  useDeleteOpenRouterKey,
  useAiApplyChanges,
  useAiRebaseChanges,
  useApproveAiRebasedProposal,
  useRejectAiChangeProposal,
  useGitCommit,
  useGitPush,
} from '@workspace/api-client-react';
// Canonical AI Model Capability Probe prompt — no manual paste of the probe
// body. Imported via ai-orchestrator's leaf subpath so the browser bundle does
// not pull server-only deps (groq-sdk, db) into the client.
import { CAPABILITY_PROBE_MESSAGE } from '@workspace/ai-orchestrator/capability-probe';
import type {
  AiStreamErrorEvent,
  AiExecutionNodeSnapshot,
  AiScanAnalysis,
  AiCodeReview,
  AiStreamExecutionSummary,
  AiCrossFileSemanticTrace,
  AiProductionReachabilityTrace,
  AiBehaviorEvidence,
  MissionCorrelationReport,
  Event as ApiEvent,
} from '@workspace/api-client-react';
import type { ValidationResult } from '@workspace/ai-orchestrator';
// Keep the shared structured error type for translating SSE failures into
// the same user-facing error format as regular API requests.
import { ApiError } from '@/lib/api-fetch';
import {
  readMissionCorrelationReportGeneratedAt,
  readStoredMissionCorrelationReport,
} from '@/lib/mission-correlation-report';

type Project = { id: string; name: string; language: string };
type BenchmarkScorecard = {
  suiteVersion?: string;
  generatedAt?: string;
  provider?: string;
  model?: string | null;
  metrics?: {
    observedCases?: number;
    totalCases?: number;
    gradeCounts?: Record<string, number>;
    providerUnavailableCount?: number;
    falseSuccessRate?: number;
    scopeEscapeRate?: number;
    correctCompletionRate?: number;
  };
  rolloutAllowed?: boolean;
  rolloutBlockers?: string[];
  baseline?: {
    baselineId?: string;
    suiteVersion?: string;
    generatedAt?: string;
  };
  baselineComparison?: {
    status?: 'missing' | 'incompatible' | 'regressed' | 'passed';
    baselineId?: string;
    baselineGeneratedAt?: string;
    metricDeltas?: {
      correctCompletionRate?: number;
      firstAttemptRate?: number;
      safelyBlockedRate?: number;
    };
    blockers?: string[];
  };
};
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string;
  toolTrace?: string | null;
  turnIntent?: string | null;
  executionId?: string | null;
  outcome?: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Optional persisted release report attached to a historical run. */
  missionCorrelationReport?: MissionCorrelationReport | null;
  /** The API found a non-null persisted report that is not readable by this dashboard. */
  missionCorrelationReportError?: boolean;
  /** Safe operational timeline captured from the live SSE run. */
  activityEvents?: LiveAgentActivityEvent[];
  /** Accepted behavior-evidence excerpts, optionally with an exact source line span. */
  behaviorEvidence?: AiBehaviorEvidence[] | string | null;
  /** AI-008: per-task typed result from the SSE done event. Absent on generic turns and reloaded history. */
  taskResult?: AiTaskResult | null;
  operationMode?: OperationMode;
  createdAt: string;
};

type OperationMode = 'FORENSIC_AUDIT' | 'DELIVERY' | 'CHAT';

function inferOperationMode(params: {
  operationMode?: unknown;
  taskResult?: AiTaskResult | null;
  proposalId?: string | null;
}): OperationMode | undefined {
  if (
    params.operationMode === 'FORENSIC_AUDIT'
    || params.operationMode === 'DELIVERY'
    || params.operationMode === 'CHAT'
  ) {
    return params.operationMode;
  }
  if (params.proposalId) return 'DELIVERY';
  if (params.taskResult?.kind === 'IMPLEMENTATION_PLAN_RESULT') return 'DELIVERY';
  if (
    params.taskResult?.kind === 'FORENSIC_REPORT_RESULT'
    || params.taskResult?.kind === 'WORKSPACE_REVIEW_RESULT'
    || params.taskResult?.kind === 'FINDING_RESULT'
    || params.taskResult?.kind === 'BEHAVIOR_ANSWER_RESULT'
    || params.taskResult?.kind === 'REPAIR_RESULT'
  ) {
    return 'FORENSIC_AUDIT';
  }
  return undefined;
}

type ActiveExecution = {
  id: string;
  projectId: string;
  sessionId?: string;
  resumeToken?: string;
  message: string;
  buildPlanMessageId?: string;
};

type StreamOwner = {
  generation: number;
  projectId: string;
  sessionId?: string;
  executionId?: string;
};

/**
 * Local mirror of the AI-008 typed result union. The server sends the nested
 * payloads as plain objects, so accessors below cast defensively rather than
 * trusting the shape at the type level.
 */
type AiTaskResult =
  | {
      kind: 'CODE_EXTRACTION_RESULT';
      extractedCode: string;
      source?: string;
    }
  | { kind: 'BEHAVIOR_ANSWER_RESULT'; answer: Record<string, unknown> }
  | { kind: 'FINDING_RESULT'; finding: Record<string, unknown> }
  | {
      kind: 'FORENSIC_REPORT_RESULT';
      report: string;
      evidence: Record<string, unknown>[];
    }
   | {
       kind: 'WORKSPACE_REVIEW_RESULT';
       report: string;
       evidence: Record<string, unknown>[];
     }
  | {
      kind: 'REPAIR_RESULT';
      phases: Record<string, unknown>[];
      readiness: 'READY' | 'BLOCKED' | 'NOT_PROVEN';
     }
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

function hasSafeImplementationPlanFileScope(
  plan: Extract<AiTaskResult, { kind: 'IMPLEMENTATION_PLAN_RESULT' }>,
): boolean {
  return plan.steps.some((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || !Array.isArray(rawStep.files)) return false;
    return rawStep.files.some((file) => {
      if (typeof file !== 'string') return false;
      const normalized = file.trim().replaceAll('\\', '/');
      return normalized.length > 0 &&
        normalized !== '.' &&
        !normalized.startsWith('/') &&
        !normalized.startsWith('../') &&
        !normalized.includes('/../');
    });
  });
}
type Session = {
  id: string;
  title: string;
  updatedAt: string;
  forensicStatus?: 'INCOMPLETE' | 'NO_FINDING' | 'FINDING_PROVEN' | 'NOT_PROVEN';
};

function sessionForensicStatusLabel(status: Session['forensicStatus']): string | null {
  switch (status) {
    case 'INCOMPLETE': return 'Incomplete';
    case 'NO_FINDING': return 'No finding';
    case 'FINDING_PROVEN': return 'Finding proven';
    case 'NOT_PROVEN': return 'Not proven';
    default: return null;
  }
}
type ProviderKeyStatus  = { configured: boolean; last4: string | null; updatedAt: string | null };
type GroqKeyStatus      = ProviderKeyStatus;
type DeepSeekKeyStatus  = ProviderKeyStatus;
type OpenRouterKeyStatus = ProviderKeyStatus;
type GeminiKeyStatus    = ProviderKeyStatus;
type ActiveProvider     = { provider: 'groq' | 'deepseek' | 'openrouter' | 'gemini' | null; configured: boolean };

/** PR-06: runtime health snapshot returned by /api/ai/metrics */
type ProviderRuntimeMetric = {
  provider: string;
  requests: number;
  failures: number;
  successRate: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  avgLatencyMs: number | null;
  circuitOpen: boolean;
  circuitHalfOpen: boolean;
  cooldownRemainingMs: number | null;
};
type MetricsResponse = { metrics: ProviderRuntimeMetric[] };
type PendingChange = {
  path: string;
  absolutePath: string;
  newContent: string;
  originalContent: string | null;
  baseHash?: string;
  hunks?: Array<{
    startLine: number;
    endLine: number;
    expectedText: string;
    replacementText: string;
    reason: string;
    risk?: 'low' | 'medium' | 'high';
    evidence?: Array<{
      kind: 'finding' | 'source' | 'validation';
      id: string;
      label: string;
      file?: string;
      line?: number;
    }>;
  }>;
  reason: string;
  validationProfile?: 'ai-orchestrator-tests' | 'knowledge-engine-tests' | 'api-ai-tests' | 'workspace-typecheck';
  risk?: 'low' | 'medium' | 'high';
  evidence?: Array<{
    kind: 'finding' | 'source' | 'validation';
    id: string;
    label: string;
    file?: string;
    line?: number;
  }>;
};
type ApprovedPendingChange = PendingChange & {
  validationProfile: NonNullable<PendingChange['validationProfile']>;
};

function hasValidationProfile(change: PendingChange): change is ApprovedPendingChange {
  return Boolean(change.validationProfile);
}

function validationProfileLabel(profile: PendingChange['validationProfile']): string {
  switch (profile) {
    case 'workspace-typecheck':
      return 'Workspace typecheck (failed changes are rolled back)';
    case 'ai-orchestrator-tests':
      return 'AI orchestrator tests (failed changes are rolled back)';
    case 'knowledge-engine-tests':
      return 'Knowledge engine tests (failed changes are rolled back)';
    case 'api-ai-tests':
      return 'AI API tests (failed changes are rolled back)';
    default:
      return 'No registered validation';
  }
}

type BehavioralVerification = {
  status: 'passed' | 'failed' | 'skipped' | 'unavailable';
  profile?: string;
  scenario?: string;
  detail?: string;
  conflict?: {
    kind?: 'base_hash_mismatch' | 'hunk_mismatch';
    expectedHash?: string;
    actualHash?: string;
    hunkIndex?: number;
  };
};

// PR-06: AiApiError replaced by the shared ApiError from lib/api-fetch.
// Alias retained only to avoid renaming the one remaining internal reference.
const AiApiError = ApiError;

/**
 * PR-06: Compact runtime status badge for a provider card.
 * Shows circuit state, consecutive failures, last success, and avg latency.
 */
function ProviderRuntimeBadge({ metric }: { metric: ProviderRuntimeMetric | undefined }) {
  if (!metric || metric.requests === 0) return null;

  const cooldownSec = metric.cooldownRemainingMs != null
    ? Math.ceil(metric.cooldownRemainingMs / 1000)
    : null;

  const lastSuccessLabel = metric.lastSuccessAt
    ? (() => {
        const secs = Math.floor((Date.now() - new Date(metric.lastSuccessAt).getTime()) / 1000);
        if (secs < 60)   return `${secs}s ago`;
        if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
        return `${Math.floor(secs / 3600)}h ago`;
      })()
    : null;

  if (metric.circuitOpen) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
        <span>Circuit open{cooldownSec != null ? ` · ${cooldownSec}s cooldown` : ''}</span>
      </div>
    );
  }

  const isHealthy = metric.consecutiveFailures === 0 && metric.successRate != null && metric.successRate > 0.8;
  const isDegraded = metric.consecutiveFailures > 0 || (metric.successRate != null && metric.successRate < 0.8);

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isHealthy ? 'bg-green-400' : isDegraded ? 'bg-yellow-400' : 'bg-muted-foreground'}`} />
      <span className="flex-1 truncate">
        {metric.consecutiveFailures > 0
          ? `${metric.consecutiveFailures} consecutive fail${metric.consecutiveFailures > 1 ? 's' : ''}`
          : lastSuccessLabel
            ? `OK · ${lastSuccessLabel}`
            : 'Active'}
        {metric.avgLatencyMs != null ? ` · ${metric.avgLatencyMs}ms` : ''}
      </span>
    </div>
  );
}

/**
 * Maps an AiApiError (or any error) to a concise, user-facing string.
 * Status codes align with what ai.ts returns after handleOrchestratorError.
 */
/** STORY-04: human-readable label for an OpenRouter model ID. */
const OR_MODEL_LABELS: Record<string, string> = {
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "meta-llama/llama-3.1-8b-instruct:free":  "Llama 3.1 8B",
  "deepseek/deepseek-r1:free":               "DeepSeek R1",
  "qwen/qwen3-235b-a22b:free":               "Qwen3 235B",
  "qwen/qwen3-8b:free":                      "Qwen3 8B",
  "qwen/qwen3-30b-a3b:free":                 "Qwen3 30B",
  "mistralai/mistral-7b-instruct:free":      "Mistral 7B",
  "google/gemma-3-27b-it:free":              "Gemma 3 27B",
  "google/gemma-3-12b-it:free":              "Gemma 3 12B",
};
function fmtModelId(id: string): string {
  return OR_MODEL_LABELS[id] ?? (id.split("/").pop()?.replace(/:free$/, "") ?? id);
}

/**
 * Keep implementation details useful to the agent out of the normal chat
 * transcript. Absolute runtime paths and opaque UUIDs can disclose deployment
 * internals without helping the user understand the result.
 */
function redactInternalDetails(value: string): string {
  return value
    .replace(/\/home\/runner\/workspace(?:\/[^\s`"'<>),;]+)*/g, '[project path]')
    .replace(/(?:\/tmp|\/workspace)\/[^\s`"'<>),;]+/g, '[runtime path]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[internal id]');
}

/** Build a provider context suffix for error messages, showing model/status/raw hint. */
function providerContextSuffix(err: ApiError): string {
  const parts: string[] = [];
  const ctx = err.providerContext as Record<string, unknown> | undefined;
  if (ctx) {
    if (ctx['providerName']) parts.push(`Provider: ${ctx['providerName']}`);
    if (ctx['providerModel']) parts.push(`Model: ${fmtModelId(String(ctx['providerModel']))}`);
    if (ctx['providerStatus']) parts.push(`Status: ${ctx['providerStatus']}`);
    if (ctx['providerMessage'] && typeof ctx['providerMessage'] === 'string') {
      // Include raw provider message (truncated) for OpenRouter debugging.
      const raw = ctx['providerMessage'].slice(0, 120);
      if (raw) parts.push(`Detail: ${raw}`);
    }
  }
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}

function describeAiError(err: unknown): string {
  if (err instanceof AiApiError) {
    const suffix = providerContextSuffix(err);
    switch (err.status) {
      case 400: return err.errorMessage + suffix;
      case 401: return (err.errorMessage || err.hint || 'AI API key is invalid — delete it and save a valid key from your provider\'s dashboard.') + suffix;
      case 403: return 'Access denied — you may not have permission on this project.';
      case 429: return (err.errorMessage || err.hint || 'AI rate limit reached — wait 30–60 seconds before retrying.') + suffix;
      case 422:
        if (err.code === 'model_output_invalid') {
          return 'The AI returned an unexpected response format — try rephrasing your message.';
        }
        if (err.code === 'MODEL_NOT_FOUND') {
          return (err.errorMessage || err.hint || 'The selected AI model is unavailable — try again or switch providers.') + suffix;
        }
        return (err.errorMessage || err.hint || 'AI provider configuration is invalid. Re-save your API key.') + suffix;
      case 428: return err.errorMessage || err.hint || 'No AI key configured — save an OpenRouter, DeepSeek, or Groq API key first.';
      case 502: return (err.errorMessage || err.hint || 'AI provider returned an error. Check your API key or try again.') + suffix;
      case 503: return 'AI provider is temporarily unreachable — try again in a moment.';
      default:  return (err.errorMessage || `Request failed (${err.status}).`) + suffix;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// AI-specific endpoints use cookie-based Clerk auth (same-origin — no Bearer needed).

/**
 * Safely parse the `sources` field from a chat message.
 * The field is stored as a JSON string in the DB; malformed or missing payloads
 * must never crash the UI — return an empty array as the fallback.
 */
function parseSources(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Normalizes behavior evidence from either the parsed done-event array or a persisted JSON string. */
function parseBehaviorEvidence(raw: AiBehaviorEvidence[] | string | null | undefined): AiBehaviorEvidence[] {
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
function evidenceAnchor(evidence: AiBehaviorEvidence): { label: string; copy: string; hasSpan: boolean } {
  const span = evidence.sourceSpan;
  if (span && Number.isFinite(span.startLine)) {
    const range = span.startLine === span.endLine
      ? `${span.startLine}`
      : `${span.startLine}–${span.endLine}`;
    return { label: `${evidence.source}:${range}`, copy: `${evidence.source}:${span.startLine}`, hasSpan: true };
  }
  return { label: evidence.source, copy: evidence.source, hasSpan: false };
}

type ToolTraceEntry = {
  kind: string;
  scopeDescription?: string;
  tool?: string;
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
  }>;
  /** FEG-017: why a forensic investigation's terminal failed (PROVEN/NO_FINDING omit it). */
  terminalKind?:
    | 'INVESTIGATION_NOT_STARTED'
    | 'INVESTIGATION_BUDGET_EXHAUSTED'
    | 'NO_EVIDENCE_FOUND'
    | 'EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED'
    | 'NO_RESPONSE_RECOVERY_BLOCKED';
  reason?: string;
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
  validation?: ValidationResult;
  /** Compatibility projection for persisted traces from older runs. */
  validationStatus?: ValidationResult['status'];
  repairState?: 'VALIDATING' | 'REPAIRING' | 'READY_FOR_REVIEW' | 'BLOCKED';
  validationProfile?: string;
  validationScenario?: string;
  validationCommand?: string;
  validationExitCode?: number | null;
  validationFailedTests?: string[];
  validationAffectedFiles?: string[];
  validationFailedTestDetails?: ValidationResult['failedTests'];
  validationChangedFiles?: string[];
  validationAttempt?: number;
  validationMaxAttempts?: number;
  validationDetail?: string;
};

function parseToolTrace(raw: string | undefined | null): ToolTraceEntry[] {
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

function SemanticTraceCard({
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

type DashboardExecutionSummary = AiStreamExecutionSummary & {
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
};

function parseExecutionSummary(trace: ToolTraceEntry[]): DashboardExecutionSummary | null {
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
  const modelsUsed = new Set<string>();
  const recoveryModelsUsed = new Set<string>();
  for (const entry of trace) {
    if (entry.kind === 'diagnostic' && entry.code) diagnosticCodes.add(entry.code);
    if (entry.kind === 'diagnostic') {
      for (const detail of entry.details ?? []) diagnosticDetails.add(detail);
    }
    for (const code of entry.diagnosticCodes ?? []) diagnosticCodes.add(code);
    for (const detail of entry.diagnosticDetails ?? []) diagnosticDetails.add(detail);
    if (entry.kind === 'model_call' && entry.model) modelsUsed.add(entry.model);
    if (entry.kind === 'recovery_model_call' && entry.model) recoveryModelsUsed.add(entry.model);
  }

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
      trace.some((entry) => entry.kind === 'forensic_recovery_start'),
    diagnosticCodes: [...diagnosticCodes],
    // Cancellation diagnostics are internal recovery/provider details. The
    // cancelled report and its terminal state survive history reload, but
    // provider errors must not become visible just because the persisted
    // summary is now restored.
    ...(diagnosticDetails.size > 0 && done.stopReason !== 'cancelled'
      ? { diagnosticDetails: [...diagnosticDetails] }
      : {}),
    ...(modelsUsed.size > 0 ? { modelsUsed: [...modelsUsed].slice(0, 12) } : {}),
    ...(recoveryModelsUsed.size > 0
      ? { recoveryModelsUsed: [...recoveryModelsUsed].slice(0, 2) }
      : {}),
  };
}

function isForensicFallbackMessage(content: string): boolean {
  return (
    content.includes('No verified forensic verdict was produced') ||
    content.includes('No verified finding identified from inspected source code.')
  );
}

function isEvidenceOnlyFallbackMessage(content: string): boolean {
  return content.includes('Completed source reads were preserved') ||
    content.includes('completed source reads were preserved');
}

function isIncompleteBeforeEvidenceSummary(summary: AiStreamExecutionSummary | null): boolean {
  return Boolean(
    summary?.diagnosticCodes.some((code) =>
      code.includes('INCOMPLETE_BEFORE_EVIDENCE') ||
      code.includes('INVESTIGATION_START_FAILURE'),
    ),
  );
}

type FinalForensicVerdict = 'FINDING PROVEN' | 'NO FINDING' | 'NOT PROVEN' | 'INCOMPLETE';

/**
 * The execution trace contains historical attempts. It is useful for
 * diagnostics, but it is not the final forensic verdict. Derive the badge
 * from the report that is actually rendered, with the Final Judgment section
 * taking precedence over earlier model/recovery events.
 */
function getFinalForensicVerdict(
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

type ForensicEvidenceSummary = {
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
    }>;
    /** True when the proven Finding is supported only by fixture/test/spec evidence. */
    isFixtureLocal?: boolean;
  } | null;
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
    completionGateResult?: string;
    finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
    completedReadFiles: string[];
    retainedBodyFiles: string[];
    acceptedEvidenceFiles: string[];
    acceptedClaimCount: number;
    sourceCoverage: ToolTraceEntry['evidenceSourceCoverage'];
    scopeExpansions: Array<{
      kind: 'JUSTIFIED_SCOPE_EXPANSION' | 'UNJUSTIFIED_SCOPE_EXPANSION';
      path: string;
      matchedPolicyPath?: string;
    }>;
    unjustifiedReads: string[];
  } | null;
};

function parseForensicEvidence(trace: ToolTraceEntry[], executionSummary: AiStreamExecutionSummary | null): ForensicEvidenceSummary {
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
            // Normalize from both fields so auditScope-only traces are handled correctly.
            isFixtureLocal:
              (statusEntry.auditScope === 'FIXTURE_LOCAL' || statusEntry.isFixtureLocal === true)
                ? true
                : undefined,
          }
        : null,
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
      completionGateResult: typeof entry.completionGateResult === 'string' ? entry.completionGateResult : undefined,
      finalAnswerType:
        entry.finalAnswerType === 'PRODUCTION_REACHABILITY_ANSWER' ||
        entry.finalAnswerType === 'BEHAVIORAL_ANSWER' ||
        entry.finalAnswerType === 'NO_ANSWER'
          ? entry.finalAnswerType
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
      sourceCoverage: entry.evidenceSourceCoverage,
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

function formatStopReason(reason: string, synthesisStarted = false): string {
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

function forensicRejectionReason(
  summary: ForensicEvidenceSummary,
  finalVerdict: FinalForensicVerdict | null = null,
): string {
  const finalReportIsNotProven = finalVerdict === 'NOT PROVEN';
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

function isForensicRejection(
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
    code.includes('FORENSIC_NO_FINDING') ||
    code.includes('STRUCTURED_RECOVERY_NO_FINDING') ||
    code.includes('SKIPPED_NO_EVIDENCE'),
  ) ?? false;
}

function ForensicEvidenceCard({
  evidence,
  defaultExpanded,
  finalVerdict,
  claimEvidence,
}: {
  evidence: ForensicEvidenceSummary;
  defaultExpanded: boolean;
  finalVerdict: FinalForensicVerdict | null;
  /** NI-35: claim-bound behavioral evidence (accepted excerpts with exact spans). */
  claimEvidence?: AiBehaviorEvidence[];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const uniqueFiles = evidence.evidenceIntegrity
    ? Math.max(evidence.evidenceIntegrity.uniqueFilesRead, evidence.reads.length)
    : evidence.reads.length;
  const hasEvidence = evidence.completedReads > 0;
  const historicalVerdict =
    evidence.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_ACCEPTED')) ||
    evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_DETERMINISTIC_FINDING'))
      ? 'FINDING PROVEN'
      : evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_NO_FINDING'))
        ? 'NO FINDING'
        : 'NOT PROVEN';
  const verdict = finalVerdict ?? historicalVerdict;

  // Normalize fixture-local from either the boolean or the enum field so that
  // auditScope-only traces (written by the incoming-main branch) are treated
  // consistently with isFixtureLocal-only traces (written by this task).
  const isFixtureLocal =
    evidence.forensicStatus?.isFixtureLocal === true ||
    evidence.forensicStatus?.auditScope === 'FIXTURE_LOCAL';

  return (
    <div className={`mt-2 rounded-lg overflow-hidden text-[11px] ${
      isFixtureLocal
        ? 'border border-violet-500/30 bg-violet-500/5'
        : 'border border-amber-500/25 bg-amber-500/5'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
          isFixtureLocal ? 'hover:bg-violet-500/10' : 'hover:bg-amber-500/10'
        }`}
        aria-expanded={expanded}
      >
        <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${isFixtureLocal ? 'text-violet-300' : 'text-amber-300'}`} />
        <span className={`font-medium ${isFixtureLocal ? 'text-violet-200' : 'text-amber-200'}`}>
          Forensic evidence
        </span>
          {evidence.auditScopeDescription && (
            <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground sm:inline">
              · {evidence.auditScopeDescription}
            </span>
          )}
        {isFixtureLocal && (
          <span className="rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200 font-semibold">
            FIXTURE-LOCAL
          </span>
        )}
        <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${
          isFixtureLocal
            ? 'border-violet-500/30 text-violet-200'
            : 'border-amber-500/30 text-amber-200'
        }`}>
          {verdict === 'NOT PROVEN' && evidence.diagnosticCodes.some((code) => code.includes('SKIPPED_NO_EVIDENCE'))
            ? 'NO EVIDENCE'
            : verdict}
        </span>
        <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className={`border-t px-3 py-3 space-y-3 ${isFixtureLocal ? 'border-violet-500/20' : 'border-amber-500/20'}`}>
          {isFixtureLocal && (
            <div className="rounded border border-violet-500/40 bg-violet-500/10 px-2.5 py-2">
              <div className="flex items-center gap-1.5 font-medium text-violet-200">
                <ShieldAlert className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                Fixture-local finding — repair execution blocked
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                All evidence for this Finding comes from fixture, test, or spec paths. The defect pattern has
                not been proven in production source files. Production reachability is{' '}
                <span className="font-semibold text-amber-300">NOT PROVEN</span> and repair execution is blocked
                until caller and input-path evidence from production code is established.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.implementationFiles}</div>
              <div className="text-[10px] text-muted-foreground">implementation files</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.contextFiles}</div>
              <div className="text-[10px] text-muted-foreground">context/config files</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.generatedFiles}</div>
              <div className="text-[10px] text-muted-foreground">generated artifacts</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.completedReads}</div>
              <div className="text-[10px] text-muted-foreground">completed reads</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-amber-300">{evidence.cachedReads}</div>
              <div className="text-[10px] text-muted-foreground">cached repeats</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className={`text-base font-semibold ${evidence.unattributedResults > 0 ? 'text-amber-300' : 'text-green-300'}`}>
                {evidence.unattributedResults}
              </div>
              <div className="text-[10px] text-muted-foreground">unattributed results</div>
            </div>
          </div>

          {/* NI-35/EI-012: run-ledger telemetry reconciliation */}
          {evidence.evidenceIntegrity && (
            <div className={`rounded border px-2.5 py-2 ${
              evidence.evidenceIntegrity.consistent
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`flex items-center gap-1.5 font-medium ${
                  evidence.evidenceIntegrity.consistent ? 'text-green-200' : 'text-red-200'
                }`}>
                  {evidence.evidenceIntegrity.consistent
                    ? <ShieldCheck className="w-3.5 h-3.5 text-green-300" />
                    : <ShieldAlert className="w-3.5 h-3.5 text-red-300" />}
                  Telemetry reconciliation
                </span>
                <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                  evidence.evidenceIntegrity.consistent
                    ? 'border-green-500/40 text-green-200'
                    : 'border-red-500/40 text-red-200'
                }`}>
                  {evidence.evidenceIntegrity.code || (evidence.evidenceIntegrity.consistent ? 'CONSISTENT' : 'INCONSISTENT')}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.uniqueFilesRead}</span>
                  <span className="text-[10px] text-muted-foreground"> unique read</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.evidenceFileCount}</span>
                  <span className="text-[10px] text-muted-foreground"> evidence file</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.acceptedEvidenceCount}</span>
                  <span className="text-[10px] text-muted-foreground"> accepted</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.readAttempts}</span>
                  <span className="text-[10px] text-muted-foreground"> read attempts</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.retainedBodyFiles.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground"> retained bodies</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.acceptedEvidenceFiles.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground"> accepted files</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.acceptedClaimCount}
                  </span>
                  <span className="text-[10px] text-muted-foreground"> accepted claims</span>
                </div>
              </div>
              {(evidence.evidenceIntegrity.objectiveType ||
                evidence.evidenceIntegrity.completionGateResult ||
                evidence.evidenceIntegrity.finalAnswerType ||
                evidence.evidenceIntegrity.requiredEdges.length > 0 ||
                evidence.evidenceIntegrity.provenEdges.length > 0) && (
                <div className="mt-2 rounded border border-primary/20 bg-primary/5 px-2.5 py-2" aria-label="Objective proof details">
                  <div className="text-[10px] font-semibold text-primary">Objective proof</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Completion</div>
                      <div className="font-semibold text-foreground">
                        {evidence.evidenceIntegrity.completionGateResult ?? 'Not declared'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Required edges</div>
                      <div className="font-semibold text-foreground">{evidence.evidenceIntegrity.requiredEdges.length}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Proven edges</div>
                      <div className="font-semibold text-green-300">{evidence.evidenceIntegrity.provenEdges.length}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Final answer</div>
                      <div className="break-words font-semibold text-foreground">
                        {evidence.evidenceIntegrity.finalAnswerType
                          ? evidence.evidenceIntegrity.finalAnswerType.replace(/_ANSWER$/, '').replace(/_/g, ' ')
                          : 'Not recorded'}
                      </div>
                    </div>
                  </div>
                  {evidence.evidenceIntegrity.objectiveType && (
                    <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                      Objective type: <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.objectiveType}</span>
                    </div>
                  )}
                  {evidence.evidenceIntegrity.requiredEdges.length > 0 && (
                    <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
                      <div className="text-[10px] text-muted-foreground">Edge proof ledger</div>
                      {evidence.evidenceIntegrity.requiredEdges.map((edge) => (
                        <div key={edge} className="font-mono text-[10px] text-foreground/80">
                          <span className={evidence.evidenceIntegrity!.provenEdges.includes(edge) ? 'text-green-300' : 'text-amber-200'}>
                            {evidence.evidenceIntegrity!.provenEdges.includes(edge) ? '✓' : '○'}
                          </span>{' '}
                          {edge}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {evidence.evidenceIntegrity.sourceCoverage && (
                <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                  Canonical source coverage:{' '}
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.sourceCoverage.status}
                  </span>{' '}
                  · {evidence.evidenceIntegrity.sourceCoverage.requestedFiles?.length ?? evidence.evidenceIntegrity.sourceCoverage.roots.length} requested file(s)
                  {evidence.evidenceIntegrity.sourceCoverage.requestedFiles &&
                    evidence.evidenceIntegrity.sourceCoverage.requestedFiles.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        <div className="text-muted-foreground">canonical manifest</div>
                        {evidence.evidenceIntegrity.sourceCoverage.requestedFiles.map((file) => (
                          <code key={file} className="block break-all text-foreground/80">{file}</code>
                        ))}
                      </div>
                    )}
                </div>
              )}
              {(evidence.evidenceIntegrity.scopeExpansions.length > 0 ||
                evidence.evidenceIntegrity.unjustifiedReads.length > 0) && (
                <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] leading-relaxed">
                  <span className="text-muted-foreground">Objective scope:</span>{' '}
                  <span className="text-foreground">
                    {evidence.evidenceIntegrity.scopeExpansions.filter(
                      (expansion) => expansion.kind === 'JUSTIFIED_SCOPE_EXPANSION',
                    ).length}{' '}
                    justified expansion(s)
                  </span>
                  {evidence.evidenceIntegrity.unjustifiedReads.length > 0 && (
                    <span className="ml-2 font-semibold text-red-200">
                      {evidence.evidenceIntegrity.unjustifiedReads.length} blocked read(s)
                    </span>
                  )}
                </div>
              )}
              {evidence.evidenceIntegrity.violations.length > 0 && (() => {
                const violatingFiles = evidence.evidenceIntegrity.violations
                  .map((v) => v.match(/:?\s*([^:]+(?:\.(?:ts|tsx|js|jsx|py|go|rs|sql|sh)))$/i)?.[1])
                  .filter((f): f is string => Boolean(f));
                return (
                  <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] leading-relaxed text-red-200">
                    {violatingFiles.length > 0 ? (
                      <>
                        <span className="text-muted-foreground">Evidence with no backing completed read:</span>{' '}
                        <span className="font-mono">{[...new Set(violatingFiles)].join(', ')}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Reconciliation failed closed — the verdict was blocked because cited evidence
                          could not be matched to a completed source read.</span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {evidence.forensicStatus && (
            <div className={`rounded border px-2.5 py-2 ${
              evidence.forensicStatus.isFixtureLocal
                ? 'border-violet-500/30 bg-violet-500/5'
                : 'border-primary/25 bg-primary/5'
            }`}>
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className={`w-3.5 h-3.5 ${evidence.forensicStatus.isFixtureLocal ? 'text-violet-400' : 'text-primary'}`} />
                Audit state
                {evidence.forensicStatus.isFixtureLocal && (
                  <span className="ml-1 rounded border border-violet-500/40 bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold text-violet-300 uppercase tracking-wide">
                    fixture-local
                  </span>
                )}
              </div>
              <div className="mb-2 grid grid-cols-1 gap-2 border-b border-border/40 pb-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">audit scope</span>
                  <Badge
                    variant="outline"
                    className={
                      evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL'
                        ? 'border-violet-500/40 text-violet-200'
                        : 'border-border/60 text-muted-foreground'
                    }
                  >
                    {evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL' ? 'FIXTURE-LOCAL' : 'PRODUCTION'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">production reachability</span>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                    {evidence.forensicStatus.productionReachability}
                  </Badge>
                </div>
              </div>
              {evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL' && (
                <div className="mb-2 rounded border border-violet-500/25 bg-violet-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-violet-100">
                  This Finding is proven only inside the test/fixture source. It does not prove a production execution path, and repair execution is blocked for this scope.
                </div>
              )}
              {!evidence.forensicStatus.isFixtureLocal && evidence.forensicStatus.repairBlockReason && (
                <div className="mb-2 rounded border border-red-500/25 bg-red-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-red-100">
                  <span className="font-medium text-red-200">
                    {REPAIR_BLOCK_REASON_TEXT[evidence.forensicStatus.repairBlockReason]
                      ?? `Repair blocked (${evidence.forensicStatus.repairBlockReason}).`
                    }
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <div>
                  <div className="font-semibold text-foreground">{evidence.forensicStatus.sourceCoverage}</div>
                  <div className="text-[10px] text-muted-foreground">source coverage</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">{evidence.forensicStatus.behavioralAssessment}</div>
                  <div className="text-[10px] text-muted-foreground">behavioral assessment</div>
                </div>
                <div>
                  <div className={`font-semibold ${
                    evidence.forensicStatus.isFixtureLocal ? 'text-violet-300' : 'text-foreground'
                  }`}>
                    {evidence.forensicStatus.isFixtureLocal
                      ? 'FIXTURE-LOCAL'
                      : evidence.forensicStatus.findingStatus}
                  </div>
                  <div className="text-[10px] text-muted-foreground">finding status</div>
                </div>
                <div>
                  <div className={`font-semibold ${evidence.forensicStatus.repairReadiness === 'READY' ? 'text-green-300' : 'text-amber-300'}`}>
                    {evidence.forensicStatus.repairReadiness}
                  </div>
                  <div className="text-[10px] text-muted-foreground">repair readiness</div>
                </div>
                {/* Production reachability — always shown when findingStatus is PROVEN or fixture-local */}
                {(evidence.forensicStatus.productionReachability !== undefined || evidence.forensicStatus.isFixtureLocal) && (
                  <div className="col-span-2 sm:col-span-2">
                    <div className={`font-semibold ${
                      (evidence.forensicStatus.productionReachability ?? 'NOT_PROVEN') === 'PROVEN'
                        ? 'text-green-300'
                        : 'text-amber-300'
                    }`}>
                      {evidence.forensicStatus.productionReachability ?? 'NOT PROVEN'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">production reachability</div>
                  </div>
                )}
              </div>
              {evidence.forensicStatus.isFixtureLocal && (
                <div className="mt-2 border-t border-violet-500/20 pt-2 text-[10px] leading-relaxed text-violet-200">
                  Evidence scope: fixture/test paths only. Production reachability requires caller and
                  input-path evidence from non-fixture source files.
                </div>
              )}
              {!evidence.forensicStatus.isFixtureLocal && evidence.forensicStatus.reason && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-amber-200">
                  {evidence.forensicStatus.reason}
                </div>
              )}
              {evidence.forensicStatus.terminalKind && (
                <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-100">
                  <span className="font-medium text-amber-200">
                    {evidence.forensicStatus.terminalKind.replace(/_/g, ' ')}
                  </span>
                  {' — '}
                  {FORENSIC_TERMINAL_TEXT[evidence.forensicStatus.terminalKind]}
                </div>
              )}
              {evidence.forensicStatus.rootCoverage.length > 0 && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    {evidence.forensicStatus.requestedFiles.length > 0 ? 'requested files' : 'requested roots'}
                  </div>
                  <div className="space-y-1">
                    {evidence.forensicStatus.rootCoverage.map((coverage, index) => (
                      <div key={coverage.root} className="flex items-center gap-2 text-[10px]">
                        <code className="min-w-0 flex-1 break-all text-foreground/80">{coverage.root}</code>
                        <span className={
                          coverage.status === 'COMPLETE' || coverage.status === 'EMPTY'
                            ? 'text-green-300'
                            : 'text-amber-300'
                        }>
                          {coverage.status}
                        </span>
                        <span className="text-muted-foreground">
                          {coverage.readFiles}/{coverage.discoveredFiles} read
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {evidence.forensicPackets.length > 0 && (
            <div className="rounded border border-violet-500/25 bg-violet-500/5 px-2.5 py-2">
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <GitMerge className="w-3.5 h-3.5 text-violet-300" />
                Evidence packets
              </div>
              <div className="space-y-1.5">
                {evidence.forensicPackets.map((packet) => (
                  <div
                    key={`${packet.root}-${packet.packetIndex}-${packet.status}`}
                    className="rounded border border-border/40 bg-background/20 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">{packet.root}</code>
                      <span className={`shrink-0 text-[10px] ${
                        packet.status === 'ACCEPTED'
                          ? 'text-green-300'
                          : packet.status === 'FAILED'
                            ? 'text-red-300'
                            : packet.status === 'STARTED'
                              ? 'text-sky-300'
                              : 'text-amber-300'
                      }`}>
                        {packet.status === 'FAILED' ? 'RECOVERY FAILED' : packet.status}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{packet.fileCount} files</span>
                      <span>{packet.implementationFiles} implementation</span>
                      <span>{packet.contextFiles} context</span>
                      <span>{packet.generatedFiles} generated</span>
                      <span>packet {packet.packetIndex + 1}/{packet.packetCount}</span>
                    </div>
                    {packet.reason && (
                      <div className="mt-1 text-[10px] text-amber-200">{packet.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidence.execution && (
            <div className="rounded border border-border/50 bg-background/20 px-2.5 py-2">
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <Activity className="w-3.5 h-3.5 text-primary" />
                Execution details
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <div>
                    <div className="font-semibold text-foreground">{evidence.execution.toolCalls}</div>
                    <div className="text-[10px] text-muted-foreground">tool calls (all)</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {evidence.execution.iterations}/{evidence.execution.maxIterations}
                  </div>
                  <div className="text-[10px] text-muted-foreground">iterations used</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {evidence.execution.synthesisStarted
                      ? 'attempted'
                      : evidence.execution.recoveryStarted
                        ? 'not entered'
                        : 'not started'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">report synthesis</div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="font-semibold break-words text-foreground">
                    {formatStopReason(
                      evidence.execution.stopReason,
                      evidence.execution.synthesisStarted,
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">stop reason</div>
                </div>
              </div>
              {evidence.execution.recoveryStarted && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] text-amber-200">
                  {evidence.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_ACCEPTED'))
                    ? 'Structured forensic Recovery was accepted and rebuilt deterministically from the verified evidence.'
                    : 'Forensic Recovery started after the tool-loop response but did not produce an accepted six-section report; the preserved-evidence fallback remains active.'}
                </div>
              )}
              {evidence.execution.modelsUsed.length > 0 && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="text-[10px] text-muted-foreground">Models used</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {evidence.execution.modelsUsed.map((model) => (
                      <code key={model} className="rounded border border-border/50 bg-background/30 px-1.5 py-0.5 text-[10px] text-foreground/80">
                        {fmtModelId(model)}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              {evidence.execution.recoveryModelsUsed.length > 0 && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="text-[10px] text-muted-foreground">
                    Recovery models (max 2)
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {evidence.execution.recoveryModelsUsed.map((model) => (
                      <code key={model} className="rounded border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] text-amber-100">
                        {fmtModelId(model)}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              {(evidence.execution.prefetchToolCalls > 0 || evidence.execution.loopToolCalls > 0) && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                   Counted in total: {evidence.execution.prefetchToolCalls} prefetch · {evidence.execution.loopToolCalls} loop
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
              {claimEvidence && claimEvidence.length > 0 ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  These lines prove this behavior
                </>
              ) : (
                <>
                  <FileSearch className="w-3.5 h-3.5 text-primary" />
                  Source reads ({uniqueFiles} unique)
                </>
              )}
            </div>
            {claimEvidence && claimEvidence.length > 0 ? (
              <div className="space-y-1">
                {claimEvidence.map((e) => {
                  const { label, hasSpan } = evidenceAnchor(e);
                  return (
                    <div key={`${e.source}-${e.sourceSpan?.startLine ?? 'nospan'}`} className="rounded border border-border/40 bg-background/20 px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <ChevronRight className={`mt-0.5 w-3 h-3 shrink-0 ${hasSpan ? 'text-green-300' : 'text-muted-foreground'}`} />
                        <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">{label}</code>
                        {e.directness && (
                          <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold ${
                            e.directness === 'DIRECT'
                              ? 'border-green-500/30 text-green-300'
                              : 'border-amber-500/30 text-amber-300'
                          }`}>
                            {e.directness}
                          </span>
                        )}
                      </div>
                      {e.excerpt && (
                        <div className="mt-1 ml-4 text-[10px] leading-relaxed text-muted-foreground">
                          {e.excerpt.length > 220 ? `${e.excerpt.slice(0, 220)}…` : e.excerpt}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : hasEvidence ? (
              <div className="space-y-1">
                {evidence.reads.map((read) => (
                  <div key={read.source} className="rounded border border-border/40 bg-background/20 px-2 py-1.5">
                    <div className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 w-3 h-3 text-green-400 shrink-0" />
                      <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">
                        {read.source}
                      </code>
                      <span className="shrink-0 text-[10px] text-muted-foreground">#{read.firstSeen}</span>
                    </div>
                    <div className="mt-1 ml-4 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{read.completed} completed source bod{read.completed === 1 ? 'y' : 'ies'}</span>
                      {read.prefetched > 0 && <span className="text-sky-300">{read.prefetched} prefetch</span>}
                      {read.loop > 0 && <span className="text-violet-300">{read.loop} loop read{read.loop === 1 ? '' : 's'}</span>}
                      {read.cached > 0 && <span className="text-amber-300">{read.cached} cached repeat{read.cached === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 bg-background/20 px-2 py-2 text-muted-foreground">
                No completed source reads were recorded. Directory listings and failed reads are not source evidence.
              </div>
            )}
          </div>

          <div className="rounded border border-border/40 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">How evidence is classified</div>
            <div>
              <span className="text-green-300">Completed source body</span> can support the Evidence Map.
              <span className="ml-1 text-amber-300">Cached repeat</span> confirms repeated access but does not add new evidence.
              Searches, directory listings, previews, failed reads, and diagnostics are tracked separately and cannot prove a Finding.
            </div>
          </div>

          {evidence.incompleteReads.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-200">
                <RotateCcw className="w-3.5 h-3.5" />
                Reads without a completed result
              </div>
              <div className="space-y-1 text-[10px] text-muted-foreground">
                {evidence.incompleteReads.map((source) => (
                  <div key={source} className="break-all">• {source}</div>
                ))}
              </div>
            </div>
          )}

          {evidence.unattributedResults > 0 && (
            <div className="rounded border border-amber-500/20 bg-background/20 px-2.5 py-2 text-muted-foreground">
              <div className="font-medium text-amber-200">Read result without a source path</div>
              <p className="mt-1 leading-relaxed">
                {evidence.unattributedResults} read result{evidence.unattributedResults === 1 ? '' : 's'} was recorded without a source path.
                It is not counted as completed source evidence, and it is not classified as a failed read.
              </p>
            </div>
          )}

          {finalVerdict === 'FINDING PROVEN' &&
          evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_DETERMINISTIC_FINDING')) ? (
            <div className="rounded border border-green-500/25 bg-green-500/5 px-2.5 py-2">
              <div className="font-medium text-green-300">Final evidence decision: Finding accepted</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                The provider Recovery attempt was not required for acceptance. A deterministic executable pattern was verified against the completed source read and passed the evidence gate.
              </p>
            </div>
          ) : (
            <div className="rounded border border-amber-500/20 bg-background/20 px-2.5 py-2">
              <div className="font-medium text-amber-200">
                {finalVerdict === 'FINDING PROVEN' ? 'Final evidence decision: Finding accepted' : 'Why no repair phase was accepted'}
              </div>
              <p className="mt-1 leading-relaxed text-muted-foreground">{forensicRejectionReason(evidence, finalVerdict)}</p>
            </div>
          )}
          {evidence.diagnosticCodes.some((code) =>
            code.includes('STRUCTURED_RECOVERY_REJECTED') ||
            code.includes('CONTRACT_RECOVERY_REJECTED') ||
            code.includes('RECOVERY_PARSE_FAILED'),
          ) && (
            <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
              <div className="font-medium text-amber-200">Provider Recovery: rejected</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                The provider-generated report did not satisfy the Recovery contract. This status is separate from the final evidence decision above.
              </p>
            </div>
          )}
          <div className="rounded border border-border/40 bg-background/20 px-2.5 py-2">
            {evidence.diagnosticCodes.length > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/80">Diagnostic codes:</span>{' '}
                {evidence.diagnosticCodes.join(' · ')}
              </div>
            )}
            {evidence.diagnosticDetails.length > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/80">Contract notes:</span>{' '}
                {evidence.diagnosticDetails.join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExecutionSummaryBanner({
  summary,
  operatorTraceId,
}: {
  summary: DashboardExecutionSummary | null;
  operatorTraceId?: string;
}) {
  const hasSynthesisTelemetry =
    summary?.synthesisAttempts !== undefined ||
    summary?.synthesisTimeoutMs !== undefined ||
    summary?.synthesisTimedOut !== undefined;
  if (
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
        : 'the response required forensic recovery'}{' '}
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
      {summary.modelsUsed && summary.modelsUsed.length > 1
        ? <div className="mt-1 text-[10px] text-muted-foreground">Models tried: {summary.modelsUsed.map(fmtModelId).join(' → ')}</div>
        : null}
    </div>
  );
}

function PersistedExecutionProof({
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
  const modelsUsed = summary.modelsUsed ?? [];
  const recoveryModelsUsed = summary.recoveryModelsUsed ?? [];
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
        {modelsUsed.length > 0 && (
          <div className="break-words">
            Model path: {modelsUsed.map(fmtModelId).join(' → ')}
            {recoveryModelsUsed.length > 0
              ? ` · recovery: ${recoveryModelsUsed.map(fmtModelId).join(' → ')}`
              : ''}
          </div>
        )}
      </div>
    </details>
  );
}

function OperationTracePanel({
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
  status: ValidationResult['status'];
  state?: ToolTraceEntry['repairState'];
  profile?: string;
  detail?: string;
  failedTests: ValidationResult['failedTests'];
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

function parseRepairRadar(trace: ToolTraceEntry[]): RepairRadarData | null {
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
    const failedTests = entry.validation?.failedTests.slice(0, 4)
      ?? entry.validationFailedTestDetails?.slice(0, 4)
      ?? (entry.validationFailedTests ?? []).map((message) => ({ name: message, message }));
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
      detail,
      failedTests,
      affectedFiles: entry.validation?.changedFiles.slice(0, 6)
        ?? entry.validationChangedFiles?.slice(0, 6)
        ?? entry.validationAffectedFiles?.slice(0, 6)
        ?? [],
      diagnosis: failedTests.length > 0
        ? failedTests.map((test) => test.message || test.name).join(' · ')
        : detail ?? (status === 'passed'
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

function repairRadarStateLabel(state: ToolTraceEntry['repairState']): string {
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

function RepairRadar({ trace }: { trace: ToolTraceEntry[] }) {
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
                      <code className="ml-auto max-w-full break-all text-[9px] text-muted-foreground">{attempt.profile}</code>
                    )}
                  </div>
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
                  {(attempt.failedTests.length > 0 || attempt.affectedFiles.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      {attempt.failedTests.length > 0 && (
                        <span className="text-red-200">
                          failed: {attempt.failedTests.map((test) => test.name || test.message).join(', ')}
                        </span>
                      )}
                      {attempt.affectedFiles.length > 0 && (
                        <span className="break-all">files: {attempt.affectedFiles.join(', ')}</span>
                      )}
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

function ForensicFallbackBanner({
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

function PendingChangesCard({
  changes,
  verificationResults,
  onApply,
  onRebase,
  onReject,
  isPending,
  isRebasePending,
  approvalRequired,
}: {
  changes: PendingChange[];
  verificationResults: Record<string, BehavioralVerification>;
  onApply: (changes: PendingChange[]) => void;
  onRebase: (changes: PendingChange[]) => void;
  onReject: () => void;
  isPending: boolean;
  isRebasePending: boolean;
  approvalRequired: boolean;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [rejectedHunks, setRejectedHunks] = useState<Set<string>>(new Set());
  const hasPatchConflict = changes.some((change) => Boolean(verificationResults[change.path]?.conflict));

  useEffect(() => {
    // Hunk indexes are local to a proposal revision. A successful rebase
    // replaces the source and hunk list, so never carry old reject decisions
    // into the newly approved diff.
    setRejectedHunks(new Set());
  }, [changes]);

  function toggleExpand(p: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  function hunkKey(filePath: string, index: number) {
    return `${filePath}:${index}`;
  }

  function toggleHunk(filePath: string, index: number) {
    setRejectedHunks((prev) => {
      const next = new Set(prev);
      const key = hunkKey(filePath, index);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Build the effective change list honouring per-hunk accept/reject selections.
  // Files where every hunk is rejected are dropped from the apply payload;
  // files with a partial selection forward only the accepted hunks so the
  // server can use rebasePatchHunks to compute the partial result.
  const effectiveChanges = changes.flatMap((change) => {
    if (!change.hunks || change.hunks.length === 0) return [change];
    const accepted = change.hunks.filter((_, i) => !rejectedHunks.has(hunkKey(change.path, i)));
    if (accepted.length === 0) return [];
    if (accepted.length === change.hunks.length) return [change];
    return [{ ...change, hunks: accepted }];
  });

  const totalHunkCount = changes.reduce((s, c) => s + (c.hunks?.length ?? 0), 0);
  const rejectedCount = changes.reduce(
    (s, c) => s + (c.hunks?.filter((_, i) => rejectedHunks.has(hunkKey(c.path, i))).length ?? 0),
    0,
  );
  const acceptedHunkCount = totalHunkCount - rejectedCount;
  const hasPartialSelection = rejectedCount > 0 && totalHunkCount > 0;

  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/10">
          <FileCode2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-400">
            {changes.length} proposed file change{changes.length !== 1 ? 's' : ''}
          </span>
           <span className="text-xs text-muted-foreground ml-auto">
             {approvalRequired ? 'Review and approve this rebased diff' : 'Waiting for your approval'}
           </span>
        </div>

        {/* Changes list */}
        <div className="divide-y divide-border/40">
          {changes.map((change) => {
            const isNew = change.originalContent === null;
            const isExpanded = expandedPaths.has(change.path);
            const newLines = change.newContent.split('\n').length;
            const oldLines = change.originalContent ? change.originalContent.split('\n').length : 0;

            return (
              <div key={change.path} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-foreground truncate max-w-[300px]">
                        {change.path}
                      </code>
                      {isNew ? (
                        <span className="text-xs px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 bg-green-500/10">
                          new file
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {oldLines} → {newLines} lines
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {change.reason}
                    </p>
                    {change.validationProfile && (
                      <p className="text-[11px] text-cyan-300/80 mt-1">
                        Test: {validationProfileLabel(change.validationProfile)}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {change.risk && (
                        <span className={`rounded border px-1.5 py-0.5 ${
                          change.risk === 'high'
                            ? 'border-red-500/30 text-red-300 bg-red-500/10'
                            : change.risk === 'medium'
                              ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                              : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                        }`}>
                          Risk: {change.risk}
                        </span>
                      )}
                      {(change.evidence ?? []).map((evidence) => (
                        <span
                          key={`${evidence.kind}:${evidence.id}`}
                          className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-200"
                          title={evidence.label}
                        >
                          {evidence.kind}: {evidence.id}
                        </span>
                      ))}
                    </div>
                    {verificationResults[change.path] && (
                      <div className={`mt-1.5 text-[11px] ${
                        verificationResults[change.path].status === 'failed' ||
                        verificationResults[change.path].status === 'unavailable'
                          ? 'text-red-400'
                          : verificationResults[change.path].status === 'passed'
                            ? 'text-green-400'
                            : 'text-amber-400'
                      }`}>
                        Behavioral verification: {verificationResults[change.path].status}
                        {verificationResults[change.path].detail
                          ? ` — ${verificationResults[change.path].detail}`
                          : ''}
                      </div>
                    )}
                    {verificationResults[change.path]?.conflict && (
                      <div className="mt-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                        Patch conflict: {verificationResults[change.path].conflict?.kind === 'hunk_mismatch'
                          ? `hunk ${((verificationResults[change.path].conflict?.hunkIndex ?? 0) + 1)} no longer matches`
                          : 'the file base changed since this patch was generated'}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggleExpand(change.path)}
                    className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border/50 hover:border-border shrink-0 transition-colors"
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    {isExpanded ? 'Hide' : 'View'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-200/80">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sky-200">Patch Lab</span>
                        <span className="font-mono text-[9px] text-muted-foreground">
                          base {change.baseHash ? `${change.baseHash.slice(0, 12)}…` : 'legacy'}
                        </span>
                      </div>
                      <p className="mt-1">
                        The patch is checked against this exact source version before it can be applied.
                      </p>
                    </div>
                    {change.hunks && change.hunks.length > 0 ? (
                      change.hunks.map((hunk, index) => (
                        <div key={`${change.path}-hunk-${index}`} className="rounded-lg border border-border/50 bg-black/30 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                            <span className="font-medium text-foreground">
                              Hunk {index + 1}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground">
                                lines {hunk.startLine}–{hunk.endLine}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleHunk(change.path, index); }}
                                aria-label={rejectedHunks.has(hunkKey(change.path, index)) ? 'Rejected — click to accept' : 'Accepted — click to reject'}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors text-[9px] font-medium ${
                                  rejectedHunks.has(hunkKey(change.path, index))
                                    ? 'border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20'
                                    : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                                }`}
                              >
                                {rejectedHunks.has(hunkKey(change.path, index))
                                  ? <><X className="w-2.5 h-2.5" /> Rejected</>
                                  : <><Check className="w-2.5 h-2.5" /> Accepted</>
                                }
                              </button>
                            </div>
                          </div>
                          <p className="mb-2 text-[10px] text-muted-foreground">{hunk.reason}</p>
                            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                              {hunk.risk && (
                                <span className={`rounded border px-1.5 py-0.5 ${
                                  hunk.risk === 'high'
                                    ? 'border-red-500/30 text-red-300 bg-red-500/10'
                                    : hunk.risk === 'medium'
                                      ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                                      : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                }`}>
                                  Risk: {hunk.risk}
                                </span>
                              )}
                              {(hunk.evidence ?? []).map((evidence) => (
                                <span
                                  key={`${evidence.kind}:${evidence.id}`}
                                  className="rounded border border-violet-500/20 bg-violet-500/5 px-1.5 py-0.5 text-violet-200/90"
                                  title={evidence.label}
                                >
                                  {evidence.kind === 'validation' ? 'Test' : 'Evidence'}: {evidence.label}
                                  {evidence.file ? ` (${evidence.file}${evidence.line ? `:${evidence.line}` : ''})` : ''}
                                </span>
                              ))}
                            </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-red-300/80">Expected</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-red-500/20 bg-red-500/5 p-2 text-[10px] leading-relaxed text-foreground/80">
                                {hunk.expectedText || '(empty)'}
                              </pre>
                            </div>
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">Replacement</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-foreground/80">
                                {hunk.replacementText || '(empty)'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <pre className="max-h-72 overflow-auto rounded-lg border border-border/40 bg-black/40 p-3 text-xs font-mono text-foreground/80 leading-relaxed">
                        {change.newContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-amber-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium disabled:opacity-50"
            onClick={() => onApply(effectiveChanges)}
            disabled={isPending || isRebasePending || effectiveChanges.length === 0}
          >
            {isPending
              ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
              : <Check className="w-3 h-3 mr-1.5" />}
            {approvalRequired ? 'Approve & apply' : 'Apply'}{' '}
            {effectiveChanges.length} change{effectiveChanges.length !== 1 ? 's' : ''}
            {hasPartialSelection ? ` (${acceptedHunkCount}/${totalHunkCount} hunks)` : ''}
          </Button>
          {hasPatchConflict && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
              onClick={() => onRebase(changes)}
              disabled={isPending || isRebasePending}
            >
              {isRebasePending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                : <RotateCcw className="w-3 h-3 mr-1.5" />}
              Rebase patch
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={onReject}
            disabled={isPending}
          >
            <X className="w-3 h-3 mr-1" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

function VerifiedCommitCard({
  paths,
  message,
  onMessageChange,
  onCommit,
  isPending,
}: {
  paths: string[];
  message: string;
  onMessageChange: (message: string) => void;
  onCommit: () => void;
  isPending: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-500/20 bg-emerald-500/10">
          <GitMerge className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium text-emerald-400">Verified changes ready to commit</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Apply and behavioral verification passed for {paths.length} file{paths.length !== 1 ? 's' : ''}.
            Commit remains a separate manual action.
          </p>
          <p className="text-[11px] text-amber-300/80 mt-2">
            The current Git endpoint stages all working-tree changes, including unrelated local edits.
          </p>
          <Input
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="Commit message"
            className="mt-3 h-8 text-xs bg-secondary border-border"
            disabled={isPending}
          />
        </div>
        <div className="flex px-4 py-3 border-t border-emerald-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            onClick={onCommit}
            disabled={isPending || !message.trim()}
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <GitMerge className="w-3 h-3 mr-1.5" />}
            Commit verified changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function PushCommitCard({
  onPush,
  isPending,
}: {
  onPush: () => void;
  isPending: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-sky-500/20 bg-sky-500/10">
          <GitMerge className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-sm font-medium text-sky-400">Committed changes ready to push</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The scoped commit was created successfully. Push remains a separate manual action and requires a configured HTTPS remote and GitHub token.
          </p>
        </div>
        <div className="flex px-4 py-3 border-t border-sky-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium"
            onClick={onPush}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <GitMerge className="w-3 h-3 mr-1.5" />}
            Push committed changes
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * UI-01: Last-resort display guard.
 * If the backend somehow passes a JSON envelope such as
 * {"response":"...","sources":[...]} as message content, extract and show
 * only the inner `response` string so the user never sees raw JSON in a bubble.
 */
function extractDisplayText(raw: string): string {
  if (!raw || !raw.trim().startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw.trim());
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)['response'] === 'string'
    ) {
      return ((parsed as Record<string, unknown>)['response'] as string).trim() || raw;
    }
  } catch {
    // Not valid JSON — display as-is.
  }
  return raw;
}

function isInternalTechnicalDump(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    (normalized.includes('aistreamdecisiontraceevent') && normalized.includes('decision_trace')) ||
    (normalized.includes('/home/runner/workspace') && normalized.includes('directory:')) ||
    (normalized.includes('validator:') && normalized.includes('recoveryattempt:') && normalized.includes('finalstate:'))
  );
}

/**
 * Behavior-evidence panel.
 * Shows each citation's safe outcome so analysts can tell exactly where proof
 * came from, or why an otherwise relevant citation stayed incomplete.
 * - Fragments with a verified line span show a copyable `file:start–end` anchor.
 * - Blocked citations expose only a stable, user-facing reason; provider
 *   prompts, diagnostics, and source-window metadata never reach this panel.
 */
function BehaviorEvidencePanel({ evidence, projectId }: { evidence: AiBehaviorEvidence[]; projectId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  if (evidence.length === 0) return null;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      // Clipboard unavailable — not fatal for the panel.
    }
  };

  return (
    <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileSearch className="w-3 h-3" />
          Behavior evidence · {evidence.length} {evidence.length === 1 ? 'excerpt' : 'excerpts'}
        </span>
      </div>
      {evidence.map((e, index) => {
        const { label, copy: copyText, hasSpan } = evidenceAnchor(e);
        const key = `${index}-${label}`;
        const isCopied = copied === key;
        const isViewing = viewing === key;
        // The generated client type can briefly lag the additive citation
        // fields carried by persisted behavior evidence.
        const citation = e as AiBehaviorEvidence & {
          citationStatus?: 'ACCEPTED' | 'BLOCKED';
          citationReason?:
            | 'MISSING_LITERAL_MATCH'
            | 'UNRESOLVED_SOURCE_SPAN'
            | 'INSUFFICIENT_BEHAVIORAL_CONTEXT'
            | 'ACCEPTED_SOURCE_SPAN';
        };
        const accepted = citation.citationStatus === 'ACCEPTED' || (citation.citationStatus === undefined && e.supportsClaim && hasSpan);
        const citationReason = citation.citationReason === 'MISSING_LITERAL_MATCH'
          ? 'Blocked: no matching source text was found.'
          : citation.citationReason === 'UNRESOLVED_SOURCE_SPAN'
            ? 'Blocked: the matching source span could not be resolved uniquely.'
            : citation.citationReason === 'INSUFFICIENT_BEHAVIORAL_CONTEXT'
              ? 'Blocked: the citation does not show enough behavior to prove the claim.'
              : accepted
                ? 'Accepted: source span verified.'
                : 'Blocked: source span could not be verified.';
        return (
          <div key={`${e.source}-${index}`} className="min-w-0">
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <div className={`mb-0.5 flex items-center gap-1 text-[10px] font-medium ${accepted ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {accepted ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                  {citationReason}
                </div>
                <div className={`text-[11px] leading-5 break-words ${hasSpan ? 'text-foreground/90' : 'text-muted-foreground/70 italic'}`}>
                  {e.excerpt && e.excerpt.length > 160 ? `${e.excerpt.slice(0, 160)}…` : e.excerpt}
                </div>
                <div className="mt-0.5 inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    title={hasSpan ? 'Copy file path and line' : 'Copy file path'}
                    onClick={() => copy(copyText, key)}
                    className={`inline-flex items-center gap-1 font-mono text-[10px] transition-colors ${
                      hasSpan
                        ? 'text-primary hover:underline'
                        : 'text-muted-foreground/60 hover:text-muted-foreground'
                    }`}
                  >
                    {hasSpan ? (
                      <><FileCode2 className="w-2.5 h-2.5" />{label}</>
                    ) : (
                      <><FileCode2 className="w-2.5 h-2.5" />{label}<span className="not-italic text-muted-foreground/50">(no span)</span></>
                    )}
                    <Check className={`w-2.5 h-2.5 ${isCopied ? 'text-emerald-400' : 'opacity-0'}`} />
                  </button>
                  {hasSpan && (
                    <button
                      type="button"
                      aria-expanded={isViewing}
                      title={isViewing ? 'Hide file context' : 'View exact source lines'}
                      onClick={() => setViewing(isViewing ? null : key)}
                      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] transition-colors ${
                        isViewing
                          ? 'text-foreground bg-primary/15'
                          : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary'
                      }`}
                    >
                      <Eye className="w-2.5 h-2.5" />
                      {isViewing ? 'Hide source' : 'View file'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {hasSpan && isViewing && <EvidenceSourceLines evidence={e} projectId={projectId} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Reveals the REAL source lines behind an accepted excerpt so an analyst can
 * verify the claim against the actual code instead of trusting the (often
 * trimmed) excerpt. Fetches the actual file line window from the
 * project-authorized /api/ai/chat/file-content endpoint, anchored at the
 * evidence's sourceSpan.startLine, and highlights the span. The line numbers
 * shown are the file's true 1-indexed offsets returned by the server — it never
 * fabricates offsets from the excerpt text. When the file cannot be read
 * (unavailable), it degrades to the excerpt WITHOUT labeling it as exact source
 * lines.
 */
function EvidenceSourceLines({ evidence, projectId }: { evidence: AiBehaviorEvidence; projectId?: string }) {
  const span = evidence.sourceSpan;
  const canLoad = Boolean(projectId && span && evidence.source && Number.isFinite(span.startLine));
  // Request a window WIDER than the exact span (a few lines above and below)
  // so the analyst sees the function/branch around the proof and can scroll
  // beyond the excerpt within the same collapsed panel. The server clamps the
  // window to the file length and a 200-line bound, so this padding is safe
  // even for small files; the span lines are still highlighted client-side.
  const CONTEXT_BEFORE = 6;
  const CONTEXT_AFTER = 12;
  const startLine = span ? Math.max(1, span.startLine - CONTEXT_BEFORE) : 1;
  const endLine = span ? (span.endLine ?? span.startLine) + CONTEXT_AFTER : startLine;
  // MAY-GET: The query is enabled only when a project + span is present.
  const { data, isPending, isError } = useGetAiChatFileContent(
    {
      projectId: projectId ?? '',
      path: evidence.source,
      startLine,
      endLine,
    },
    {
      query: {
        queryKey: getGetAiChatFileContentQueryKey({
          projectId: projectId ?? '',
          path: evidence.source,
          startLine,
          endLine,
        }),
        enabled: canLoad,
        retry: false,
      },
    },
  );

  if (!span || !Number.isFinite(span.startLine)) return null;

  if (isPending) {
    return <div className="mt-1.5 px-2 py-1 text-[10px] text-muted-foreground/70">Loading source lines…</div>;
  }

  // File not readable/authorized — degrade to the raw excerpt but do NOT paint
  // it as exact source lines (we have no true line offsets from the real file).
  if (isError || !data?.available || !data.lines?.length) {
    const reason = data?.reason ? ` · ${data.reason}` : '';
    return (
      <div className="mt-1.5 rounded-md border border-border/40 bg-background/50 px-2 py-1.5">
        <div className="text-[10px] text-muted-foreground/70 italic">
          Source file unavailable{reason} — showing the quoted excerpt (line numbers not verifiable)
        </div>
        {evidence.excerpt && (
          <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground/80">{evidence.excerpt}</pre>
        )}
      </div>
    );
  }

  const inSpan = (line: number) => line >= span.startLine && line <= span.endLine;
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/40 bg-background/50">
      <pre className="max-h-48 overflow-auto px-0 py-1.5 text-[10px] leading-5">
        {data.lines!.map((row) => {
          const inRange = inSpan(row.line);
          return (
            <div
              key={row.line}
              className={`flex px-2 ${inRange ? 'bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'}`}
            >
              <span className="w-8 shrink-0 select-none pr-2 text-right font-mono text-muted-foreground/60">
                {row.line}
              </span>
              <code className={`min-w-0 flex-1 whitespace-pre-wrap break-words font-mono ${inRange ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>
                {row.text || ' '}
              </code>
            </div>
          );
        })}
      </pre>
      {data.truncated && (
        <div className="border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground/60">
          ↕ window truncated (file has {data.fileLines ?? '?'} lines)
        </div>
      )}
    </div>
  );
}

/** Extract the answer shape from the BEHAVIOR_ANSWER_RESULT payload. */
function behaviorAnswerView(answer: Record<string, unknown> | undefined) {
  const text = typeof answer?.answer === 'string' ? answer.answer : '';
  const confidence =
    typeof answer?.confidence === 'number' ? answer.confidence : undefined;
  const scope = Array.isArray(answer?.sourceScope)
    ? answer.sourceScope.filter((s): s is string => typeof s === 'string')
    : [];
  const coverage = answer?.coverage && typeof answer.coverage === 'object'
    ? (answer.coverage as Record<string, unknown>)
    : undefined;
  const evidence = Array.isArray(answer?.evidence)
    ? (answer.evidence as Array<Record<string, unknown>>)
        .filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
    : [];
  const answeredFields = Array.isArray(coverage?.answeredFields)
    ? coverage.answeredFields.filter((s): s is string => typeof s === 'string')
    : [];
  const missingFields = Array.isArray(coverage?.missingFields)
    ? coverage.missingFields.filter((s): s is string => typeof s === 'string')
    : [];
  return { text, confidence, scope, answeredFields, missingFields, evidence };
}

/** Extract the finding shape from the FINDING_RESULT payload. */
function findingView(finding: Record<string, unknown> | undefined) {
  const text = typeof finding?.finding === 'string' ? finding.finding : '';
  const severity = typeof finding?.severity === 'string' ? finding.severity : 'NOT_PROVEN';
  const evidence = Array.isArray(finding?.evidence)
    ? (finding.evidence as Array<Record<string, unknown>>)
        .filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
    : [];
  return { text, severity, evidence };
}

const FINDING_SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-red-500/50 bg-red-500/15 text-red-300',
  HIGH: 'border-red-500/50 bg-red-500/15 text-red-300',
  MEDIUM: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
  LOW: 'border-slate-500/50 bg-slate-500/15 text-slate-300',
  NOT_PROVEN: 'border-slate-500/50 bg-slate-500/10 text-muted-foreground',
};

const READINESS_STYLES: Record<string, string> = {
  READY: 'border-green-500/50 bg-green-500/15 text-green-300',
  BLOCKED: 'border-red-500/50 bg-red-500/15 text-red-300',
  NOT_PROVEN: 'border-slate-500/50 bg-slate-500/10 text-muted-foreground',
};

/** FEG-017: human-readable explanation for a NOT_PROVEN forensic terminal. */
const FORENSIC_TERMINAL_TEXT: Record<
  NonNullable<ForensicEvidenceSummary['forensicStatus']>['terminalKind'] extends infer K ? (K extends undefined ? never : K) : never,
  string
> = {
  INVESTIGATION_NOT_STARTED:
    'Investigation never started — no source read was ever acquired, so no evidence could be gathered. This is not a "no evidence found" verdict.',
  INVESTIGATION_BUDGET_EXHAUSTED:
    'Investigation started and read evidence, but the iteration / soft-limit budget ran out before a verdict was reached.',
  NO_EVIDENCE_FOUND:
    'Investigation ran to a normal end but retained no source evidence that substantiates a defect claim.',
  EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED:
    'Source evidence was retained, but no required claim was closed with a grounded source excerpt. An evidence inventory alone is not a completed answer.',
  NO_RESPONSE_RECOVERY_BLOCKED:
    'Source collection reached an empty provider response, but bounded forensic recovery did not produce an accepted report. The run is blocked without calling it budget exhaustion.',
};

/** EI-036: human-readable Repair Scope Gate reason for the audit panel. */
const REPAIR_BLOCK_REASON_TEXT: Record<string, string> = {
  REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION:
    'Repair blocked: finding proven only from fixture/test evidence — not proven in production code. Gather production source evidence before approving any repair.',
  REPAIR_BLOCKED_SCOPE_NOT_PROVEN:
    'Repair blocked: finding is not proven, so it cannot be gated to production scope.',
  REPAIR_BLOCKED_MIXED_EVIDENCE:
    'Repair blocked: finding rests on mixed production and fixture/test evidence. Establish a production-scope proof before approving any repair.',
};

/**
 * AI-008: render the per-task typed result as a structured panel instead of a
 * single prose wall. Dispatches on `taskResult.kind`. Returns null when no
 * typed result is present (generic chat turns fall back to plain prose).
 */
type PlanDecision = 'approve' | 'reject';

function TaskResultPanel({
  result,
  projectId,
  messageId,
  onPlanDecision,
  planDecisionPending,
  onPlanBuild,
  planBuildPending,
}: {
  result: AiTaskResult | null | undefined;
  projectId?: string;
  messageId?: string;
  onPlanDecision?: (messageId: string, decision: PlanDecision) => void;
  planDecisionPending?: boolean;
  onPlanBuild?: (messageId: string) => void;
  planBuildPending?: boolean;
}) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const [planDetailsExpanded, setPlanDetailsExpanded] = useState(false);
  if (!result) return null;

  switch (result.kind) {
    case 'CODE_EXTRACTION_RESULT': {
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
            <Code2 className="w-3 h-3" />
            <span>Extracted code</span>
            {result.source && <code className="ml-auto truncate text-[10px] font-mono">{result.source}</code>}
          </div>
          <pre className="rounded border border-border/40 bg-black/25 p-2.5 text-[11px] font-mono text-foreground/90 overflow-x-auto leading-relaxed">{result.extractedCode}</pre>
        </div>
      );
    }
    case 'BEHAVIOR_ANSWER_RESULT': {
      const answer = behaviorAnswerView(result.answer);
      const hasCoverage = answer.answeredFields.length > 0 || answer.missingFields.length > 0;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileSearch className="w-3 h-3" />
            <span>Behavior answer</span>
            {typeof answer.confidence === 'number' && (
              <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px]">
                confidence {(answer.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {answer.text && (
            <p className="text-[12px] leading-relaxed text-foreground/90">{answer.text}</p>
          )}
          {answer.scope.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {answer.scope.map((s) => (
                <Badge key={s} variant="outline" className="text-[10px] font-mono text-muted-foreground">{s}</Badge>
              ))}
            </div>
          )}
          {hasCoverage && (
            <div className="text-[10px] text-muted-foreground">
              Answered fields: {answer.answeredFields.length ? answer.answeredFields.join(', ') : '—'}
              {answer.missingFields.length > 0 && (
                <> · Missing: {answer.missingFields.join(', ')}</>
              )}
            </div>
          )}
          <BehaviorEvidencePanel evidence={answer.evidence} projectId={projectId} />
        </div>
      );
    }
    case 'FINDING_RESULT': {
      const finding = findingView(result.finding);
      if (!finding.text) return null;
      const style = FINDING_SEVERITY_STYLES[finding.severity] ?? FINDING_SEVERITY_STYLES.NOT_PROVEN;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Finding</span>
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${style}`}>{finding.severity}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/90 break-words">{finding.text}</p>
          <BehaviorEvidencePanel evidence={finding.evidence} projectId={projectId} />
        </div>
      );
    }
    case 'FORENSIC_REPORT_RESULT':
    case 'WORKSPACE_REVIEW_RESULT': {
      if (!result.report) return null;
      const evidence = Array.isArray(result.evidence)
        ? result.evidence.filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
        : [];
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3 h-3" />
            <span>{result.kind === 'WORKSPACE_REVIEW_RESULT' ? 'Workspace review' : 'Forensic report'}</span>
            {evidence.length > 0 && <span className="ml-auto">{evidence.length} evidence item{evidence.length === 1 ? '' : 's'}</span>}
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{result.report}</p>
          {evidence.length > 0 && (
            <div className="rounded border border-border/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setReportExpanded((expanded) => !expanded)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-background/40 transition-colors"
                aria-expanded={reportExpanded}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${reportExpanded ? 'rotate-90' : ''}`} />
                Evidence
              </button>
              {reportExpanded && (
                <div className="border-t border-border/40">
                  <BehaviorEvidencePanel evidence={evidence} projectId={projectId} />
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
    case 'REPAIR_RESULT': {
      const phases = Array.isArray(result.phases) ? result.phases : [];
      const readiness = result.readiness ?? 'NOT_PROVEN';
      const readinessStyle = READINESS_STYLES[readiness] ?? READINESS_STYLES.NOT_PROVEN;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <GitMerge className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Repair plan</span>
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${readinessStyle}`}>{readiness}</span>
          </div>
          {phases.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No repair phases were warranted.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {phases.map((phase, index) => {
                const findingId = typeof phase?.findingId === 'string' ? phase.findingId : undefined;
                const files = Array.isArray(phase?.files)
                  ? phase.files.filter((f): f is string => typeof f === 'string')
                  : [];
                const steps = Array.isArray(phase?.steps)
                  ? phase.steps.filter((s): s is string => typeof s === 'string')
                  : [];
                return (
                  <li key={findingId ?? index} className="rounded border border-border/40 bg-background/25 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{index + 1}</span>
                      {findingId && <code className="text-[10px] font-mono text-foreground/90">{findingId}</code>}
                    </div>
                    {files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {files.map((file) => (
                          <code key={file} className="text-[10px] font-mono text-muted-foreground">{file}</code>
                        ))}
                      </div>
                    )}
                    {steps.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[11px] text-foreground/80">
                        {steps.map((step) => (
                          <li key={step} className="leading-relaxed">{step}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      );
    }
    case 'IMPLEMENTATION_PLAN_RESULT': {
      const steps = Array.isArray(result.steps) ? result.steps : [];
      const assumptions = Array.isArray(result.assumptions)
        ? result.assumptions.filter((item): item is string => typeof item === 'string')
        : [];
      const validationCommands = Array.isArray(result.validationCommands)
        ? result.validationCommands.filter((item): item is string => typeof item === 'string')
        : [];
      const hasPlanDetails = assumptions.length > 0 || validationCommands.length > 0 ||
        steps.some((step) => {
          if (!step || typeof step !== 'object') return false;
          return (Array.isArray(step.files) && step.files.length > 0) ||
            (Array.isArray(step.validation) && step.validation.length > 0);
        });
      const hasVerifiedFileScope = hasSafeImplementationPlanFileScope(result);
      const approvalBlocked = result.approvalStatus === 'PENDING_APPROVAL' && !hasVerifiedFileScope;
      const statusLabel =
        result.approvalStatus === 'APPROVED'
          ? 'Approved for Build'
          : result.approvalStatus === 'REJECTED'
            ? 'Rejected'
            : approvalBlocked
              ? 'Source scope required'
              : 'Approval required';
      const statusStyle =
        result.approvalStatus === 'APPROVED'
          ? 'border-green-500/50 bg-green-500/10 text-green-300'
          : result.approvalStatus === 'REJECTED'
            ? 'border-red-500/50 bg-red-500/10 text-red-300'
            : approvalBlocked
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
              : '';
      return (
        <div className="mt-1 w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-xs font-medium text-foreground">Implementation plan</span>
            <Badge variant="outline" className={`ml-auto shrink-0 text-[10px] ${statusStyle}`}>{statusLabel}</Badge>
          </div>
          <p className="text-sm font-medium leading-snug text-foreground/95">{result.objective}</p>
          <p className="text-xs leading-relaxed text-foreground/80">{result.summary}</p>
          <ol className="flex flex-col gap-2">
            {steps.map((rawStep, index) => {
              const step = rawStep && typeof rawStep === 'object' ? rawStep : {};
              const title = typeof step.title === 'string' ? step.title : `Step ${index + 1}`;
              const description = typeof step.description === 'string' ? step.description : '';
              const files = Array.isArray(step.files)
                ? step.files.filter((file): file is string => typeof file === 'string')
                : [];
              const validation = Array.isArray(step.validation)
                ? step.validation.filter((item): item is string => typeof item === 'string')
                : [];
              return (
                <li key={typeof step.id === 'string' ? step.id : index} className="rounded border border-border/40 bg-background/25 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 text-xs font-medium leading-snug">{title}</span>
                  </div>
                  {description && <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">{description}</p>}
                  {planDetailsExpanded && (
                    <div className="mt-2 flex flex-col gap-1.5 border-t border-border/30 pt-2">
                      {files.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {files.map((file) => <code key={file} className="max-w-full break-all text-[10px] font-mono text-muted-foreground">{file}</code>)}
                        </div>
                      )}
                      {validation.length > 0 && (
                        <div className="text-[10px] leading-relaxed text-muted-foreground">Validate: {validation.join('; ')}</div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {result.risks.length > 0 && (
            <div className="text-[10px] leading-relaxed text-muted-foreground">Risks: {result.risks.join(' · ')}</div>
          )}
          {hasPlanDetails && (
            <button
              type="button"
              onClick={() => setPlanDetailsExpanded((expanded) => !expanded)}
              className="flex w-full items-center gap-1.5 border-t border-border/30 pt-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
              aria-expanded={planDetailsExpanded}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${planDetailsExpanded ? 'rotate-90' : ''}`} />
              Files, validation, and assumptions
            </button>
          )}
          {planDetailsExpanded && assumptions.length > 0 && (
            <div className="rounded border border-border/30 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Assumptions:</span> {assumptions.join(' · ')}
            </div>
          )}
          {planDetailsExpanded && validationCommands.length > 0 && (
            <div className="rounded border border-border/30 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Validation commands:</span> {validationCommands.join(' · ')}
            </div>
          )}
          {result.approvalStatus === 'PENDING_APPROVAL' && approvalBlocked ? (
            <div className="border-t border-border/40 pt-2 text-[10px] leading-relaxed text-amber-200/90">
              <span className="font-medium text-amber-100">Approval unavailable.</span>{' '}
              This plan has no verified file scope. Retry the plan after the relevant source files are discovered; no Build Mode or write access is available.
            </div>
          ) : result.approvalStatus === 'PENDING_APPROVAL' && messageId && onPlanDecision ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              <span className="mr-auto text-[10px] text-muted-foreground">No files were changed. Approval only stages the next Build step.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={planDecisionPending}
                onClick={() => onPlanDecision(messageId, 'reject')}
                className="h-7 px-2 text-[11px] text-red-300 hover:text-red-200"
              >
                Reject
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={planDecisionPending}
                onClick={() => onPlanDecision(messageId, 'approve')}
                className="h-7 px-2 text-[11px]"
              >
                {planDecisionPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                Approve plan
              </Button>
            </div>
          ) : result.approvalStatus === 'APPROVED' && messageId && onPlanBuild ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              <span className="mr-auto text-[10px] text-muted-foreground">Approved for Build. Changes will remain in a reviewable diff until you apply them.</span>
              <Button
                type="button"
                size="sm"
                disabled={planBuildPending}
                onClick={() => onPlanBuild(messageId)}
                className="h-7 px-2 text-[11px]"
              >
                {planBuildPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                Start Build
              </Button>
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              {result.approvalStatus === 'APPROVED'
                ? 'Plan approved for the next Build step. No files were changed.'
                : result.approvalStatus === 'REJECTED'
                  ? 'Plan rejected. No files were changed.'
                  : 'No files were changed. Approve the plan before Build mode.'}
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function MessageBubble({
  msg,
  projectId,
  proposalId,
  onPlanDecision,
  planDecisionPending,
  onPlanBuild,
  planBuildPending,
  onRegenerateReport,
  reportRegenerationPending,
}: {
  msg: ChatMessage;
  projectId?: string;
  proposalId?: string;
  onPlanDecision?: (messageId: string, decision: PlanDecision) => void;
  planDecisionPending?: boolean;
  onPlanBuild?: (messageId: string) => void;
  planBuildPending?: boolean;
  onRegenerateReport?: (messageId: string) => void;
  reportRegenerationPending?: boolean;
}) {
  const isUser = msg.role === 'user';
  const [technicalDetailsExpanded, setTechnicalDetailsExpanded] = useState(false);
  const sources = parseSources(msg.sources);
  const toolTrace = parseToolTrace(msg.toolTrace);
  const activityEvents = msg.activityEvents ?? activityEventsFromToolTrace(toolTrace);
  const executionSummary = !isUser ? parseExecutionSummary(toolTrace) : null;
  const repairRadar = !isUser ? parseRepairRadar(toolTrace) : null;
  // UI-01: strip any accidental JSON envelope before rendering.
  const displayContent = extractDisplayText(msg.content);
  const redactedDisplayContent = redactInternalDetails(displayContent);
  const internalTechnicalDump = !isUser && isInternalTechnicalDump(displayContent);
  const isStructuredPlan = !isUser && msg.taskResult?.kind === 'IMPLEMENTATION_PLAN_RESULT';
  const failedTurn = !isUser && (msg.outcome === 'FAILED' || msg.outcome === 'INTERRUPTED');
  const userFacingContent = internalTechnicalDump
    ? 'The agent produced internal technical details for this run.'
    : redactedDisplayContent;
  const persistedForensicStatus = !isUser
    ? [...toolTrace].reverse().find((entry) => entry.kind === 'forensic_status')
    : undefined;
  const finalVerdict = !isUser
    ? getFinalForensicVerdict(displayContent, persistedForensicStatus?.findingStatus)
    : null;
  const productionTrace = !isUser
    ? [...toolTrace].reverse().find(
        (entry) => entry.kind === 'production_trace' && entry.productionTrace,
      )?.productionTrace
    : undefined;
  const crossFileTraces = !isUser
    ? toolTrace
        .filter((entry) => entry.kind === 'cross_file_trace' && entry.crossFileTrace)
        .map((entry) => entry.crossFileTrace as AiCrossFileSemanticTrace)
    : [];
  const isForensicFallback = !isUser && isForensicFallbackMessage(displayContent);
  const isEvidenceOnlyFallback = isForensicFallback && isEvidenceOnlyFallbackMessage(displayContent);
  const incompleteBeforeEvidence = !isUser && isIncompleteBeforeEvidenceSummary(executionSummary);
  const isNoFindingFallback = !isUser && Boolean(
    finalVerdict === 'NO FINDING' ||
    (
      !finalVerdict &&
      executionSummary?.diagnosticCodes.some((code) => code.includes('FORENSIC_NO_FINDING')) &&
      !executionSummary.diagnosticCodes.some((code) =>
        code.includes('FORENSIC_DETERMINISTIC_FINDING') ||
        code.includes('STRUCTURED_RECOVERY_ACCEPTED'),
      )
    ),
  );
  const inferredOperationMode = !isUser
    ? inferOperationMode({
        operationMode: msg.operationMode,
        taskResult: msg.taskResult,
        proposalId,
      })
    : undefined;
  const isForensicRun = !isUser && (
    inferredOperationMode === 'FORENSIC_AUDIT'
    || isForensicFallback
    || finalVerdict !== null
    || Boolean(msg.taskResult && ['FINDING_RESULT', 'FORENSIC_REPORT_RESULT', 'WORKSPACE_REVIEW_RESULT', 'BEHAVIOR_ANSWER_RESULT', 'REPAIR_RESULT'].includes(msg.taskResult.kind))
  );
  const isEngineeringExecution = !isUser && !isForensicRun && (
    inferredOperationMode === 'DELIVERY'
    || Boolean(repairRadar)
    || toolTrace.some((entry) => entry.kind === 'validation' || entry.kind === 'repair_state')
  );
  const forensicEvidence = !isUser &&
    (isForensicFallback || finalVerdict !== null || isForensicRejection(executionSummary, finalVerdict))
    ? parseForensicEvidence(toolTrace, executionSummary)
    : null;
  const reportGeneratedAt = !isUser
    ? readMissionCorrelationReportGeneratedAt(msg.missionCorrelationReport)
    : null;

  return (
    <div className={`flex min-w-0 max-w-full gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary border border-border'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
      </div>
      <div className={`flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'} sm:max-w-[75%]`}>
        {!isStructuredPlan && <div
          className={`min-w-0 max-w-full overflow-hidden rounded-xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap'
              : 'bg-secondary border border-border rounded-tl-sm prose prose-sm prose-invert'
          }`}
        >
          {failedTurn ? (
            <>
              <div className="mb-2 whitespace-pre-wrap">{userFacingContent}</div>
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                <div className="font-medium">
                  {msg.outcome === 'INTERRUPTED' ? 'Execution interrupted' : 'Execution failed'}
                </div>
                {msg.errorMessage && <div className="mt-1 text-xs">{msg.errorMessage}</div>}
                {msg.executionId && (
                  <div className="mt-1 text-[10px] opacity-70">Durable execution: {msg.executionId}</div>
                )}
              </div>
            </>
          ) : isUser ? userFacingContent : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                code: ({ children, className }) => (
                  <code className={`${className ?? ''} ${className ? '' : 'break-all'} bg-black/20 rounded px-1 py-0.5 text-xs font-mono`}>
                    {children}
                  </code>
                ),
                pre: ({ children }) => <pre className="mb-2 max-w-full overflow-x-auto rounded bg-black/20 p-2 text-xs font-mono whitespace-pre">{children}</pre>,
                h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
              }}
            >
              {userFacingContent}
            </ReactMarkdown>
          )}
        </div>}
        {internalTechnicalDump && (
          <div className="w-full rounded-lg border border-border/40 bg-background/20">
            <button
              type="button"
              onClick={() => setTechnicalDetailsExpanded((expanded) => !expanded)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
              aria-expanded={technicalDetailsExpanded}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${technicalDetailsExpanded ? 'rotate-90' : ''}`} />
              Technical details
            </button>
            {technicalDetailsExpanded && (
              <pre className="max-h-80 overflow-auto border-t border-border/40 p-3 text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-words">{redactedDisplayContent}</pre>
            )}
          </div>
        )}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {sources.map((s) => (
              <Badge key={s} variant="outline" className="text-xs font-mono text-muted-foreground">
                {s}
              </Badge>
            ))}
          </div>
        )}
        {!isUser && <BehaviorEvidencePanel evidence={parseBehaviorEvidence(msg.behaviorEvidence)} projectId={projectId} />}
        {!isUser && (
          <TaskResultPanel
            result={msg.taskResult}
            projectId={projectId}
            messageId={msg.id}
            onPlanDecision={onPlanDecision}
            planDecisionPending={planDecisionPending}
            onPlanBuild={onPlanBuild}
            planBuildPending={planBuildPending}
          />
        )}
        {!isUser && msg.missionCorrelationReportError && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <span className="min-w-0 flex-1">The historical mission report is unavailable, but this conversation is preserved.</span>
            {onRegenerateReport && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => onRegenerateReport(msg.id)}
                disabled={reportRegenerationPending}
              >
                {reportRegenerationPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                {reportRegenerationPending ? 'Regenerating…' : 'Regenerate report'}
              </Button>
            )}
          </div>
        )}
        {reportGeneratedAt && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            <span>Report regenerated at </span>
            <time dateTime={reportGeneratedAt}>
              {new Date(reportGeneratedAt).toLocaleString()}
            </time>
          </div>
        )}
        {isForensicFallback
          ? <ForensicFallbackBanner
              evidenceOnly={isEvidenceOnlyFallback}
              noFinding={isNoFindingFallback}
            />
          : incompleteBeforeEvidence
            ? null
           : <ExecutionSummaryBanner summary={executionSummary} operatorTraceId={`operator-trace-${msg.id}`} />}
        {isEngineeringExecution && repairRadar && <RepairRadar trace={toolTrace} />}
        {!isUser && !failedTurn && (isForensicRun || isEngineeringExecution) && (
          <PersistedExecutionProof
            summary={executionSummary}
            trace={toolTrace}
            evidence={forensicEvidence}
            finalVerdict={finalVerdict}
            behaviorEvidenceCount={parseBehaviorEvidence(msg.behaviorEvidence).length}
            traceId={`operator-trace-${msg.id}`}
          />
        )}
        <CompletedActivityTimeline
          events={activityEvents}
          defaultOpen={false}
        />
        <SemanticTraceCard
          productionTrace={productionTrace}
          crossFileTraces={crossFileTraces}
        />
        {forensicEvidence && (
          <ForensicEvidenceCard
            evidence={forensicEvidence}
            // Task #43: keep the forensic card expanded by default whenever the
            // audit is fixture-local, so the FIXTURE-LOCAL / NOT PROVEN
            // separation is never hidden behind a collapsed card.
            defaultExpanded={isForensicFallback || forensicEvidence.forensicStatus?.auditScope === 'FIXTURE_LOCAL'}
            finalVerdict={finalVerdict}
            // NI-35: ship the claim-bound behavioral evidence so the card can
            // render "these lines prove this behavior" instead of just the
            // raw list of files that were read.
            claimEvidence={parseBehaviorEvidence(msg.behaviorEvidence)}
          />
        )}
        {isEngineeringExecution && <FlightRecorder trace={toolTrace} />}
      </div>
    </div>
  );
}

function DeepSeekKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetDeepSeekKeyStatus<DeepSeekKeyStatus>({
    query: {
      queryKey: ['deepseek-key-status'],
    },
  });

  const saveMutation = useSaveDeepSeekKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['deepseek-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'DeepSeek key saved', description: `Ends in ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteDeepSeekKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['deepseek-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'DeepSeek key removed' });
      },
      onError: (err) => {
        toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid DeepSeek API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">DeepSeek API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Optional</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Get a free API key at <span className="font-mono">platform.deepseek.com</span> to use DeepSeek as your AI provider.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

function GroqKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetGroqKeyStatus<GroqKeyStatus>({
    query: {
      queryKey: ['groq-key-status'],
    },
  });

  const saveMutation = useSaveGroqKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['groq-key-status'], data);
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'Groq key saved', description: `Ends in ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteGroqKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['groq-key-status'], { configured: false, last4: null, updatedAt: null });
        toast({ title: 'Groq key removed', description: 'Falling back to server default.' });
      },
      onError: (err) => {
        toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid Groq API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">Groq API Key</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">No personal key saved — the server's key will be used if one is configured.</p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="gsk_…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

function GeminiKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetProviderKeyStatus<GeminiKeyStatus>('gemini', {
    query: {
      queryKey: ['gemini-key-status'],
    },
  });

  const saveMutation = useSaveGeminiKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['gemini-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'Gemini key saved', description: `Ends in ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteGeminiKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['gemini-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'Gemini key removed' });
      },
      onError: (err) => {
        toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid Gemini API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">Gemini API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Free · Priority</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Free key at <span className="font-mono">aistudio.google.com/apikey</span> — 1,500 req/day, 1M tokens/day.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function OpenRouterKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetOpenRouterKeyStatus<OpenRouterKeyStatus>({
    query: {
      queryKey: ['openrouter-key-status'],
    },
  });

  const saveMutation = useSaveOpenRouterKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['openrouter-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'OpenRouter key saved', description: `Ends in ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteOpenRouterKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['openrouter-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'OpenRouter key removed' });
      },
      onError: (err) => {
        toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid OpenRouter API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">OpenRouter API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Priority</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Get a free key at <span className="font-mono">openrouter.ai/keys</span> — routes to 300+ models, used first when configured.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Format a scan analysis result as a markdown chat message. */
function formatScanAnalysis(data: AiScanAnalysis): string {
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Scan Analysis\n`,
    `**${data.overallAssessment}**\n`,
    data.summary,
    '',
  ];
  if (data.insights?.length) {
    lines.push('### Key Insights');
    data.insights.forEach((ins) =>
      lines.push(`- ${sev(ins.severity)} **${ins.title}** — ${ins.recommendation}`),
    );
    lines.push('');
  }
  lines.push(`**Top Priority:** ${data.topPriority}`);
  lines.push(`**Estimated Impact:** ${data.estimatedImpact}`);
  return lines.join('\n');
}

/** Format a code review result as a markdown chat message. */
function formatCodeReview(data: AiCodeReview): string {
  const verdictLabel =
    data.verdict === 'approved'
      ? '✅ Approved'
      : data.verdict === 'needs_changes'
        ? '⚠️ Needs Changes'
        : '🔴 Major Rework';
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Code Review — ${data.overallScore}/10  ${verdictLabel}\n`,
    data.summary,
    '',
  ];
  if (data.strengths?.length) {
    lines.push('### Strengths');
    data.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (data.issues?.length) {
    lines.push('### Issues');
    data.issues.slice(0, 5).forEach((issue) =>
      lines.push(
        `- ${sev(issue.severity)} **${issue.title}** (${issue.type}${issue.file ? `, \`${issue.file}\`` : ''}) — ${issue.suggestion}`,
      ),
    );
    lines.push('');
  }
  if (data.securityConcerns?.length) {
    lines.push('### Security Concerns');
    data.securityConcerns.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  lines.push(`**Verdict:** ${data.verdict.replace('_', ' ')}`);
  return lines.join('\n');
}

const AI_ACTIONS = [
  { id: 'analyze', label: 'Analyze Scan', icon: Search, prompt: 'Analyze the latest scan results and suggest the top 3 improvements.' },
  { id: 'review', label: 'Code Review', icon: Code2, prompt: 'Review the codebase and identify the most critical quality issues.' },
  { id: 'tasks', label: 'Task Status', icon: Zap, prompt: 'Summarize the current task backlog and what I should focus on next.' },
  { id: 'workflow', label: 'Workflow Health', icon: GitMerge, prompt: 'How are my workflows progressing? Any blockers or risks?' },
  // #80: one-click model capability probe. Sends the canonical probe body
  // (C1–C7) straight to the chat agent; all SSE diagnostics / forensic_status
  // panels surface per-sub-question in the existing live-activity UI.
  { id: 'probe', label: 'Capability Probe', icon: Activity, prompt: CAPABILITY_PROBE_MESSAGE },
];

type LiveAgentToolStep = {
  activityId?: number;
  tool: string;
  args?: Record<string, string>;
  done: boolean;
  cached?: boolean;
  source?: string;
};

type LiveAgentActivityEvent = {
  id: number;
  kind: 'stage' | 'plan' | 'tool' | 'model' | 'iteration' | 'synthesis' | 'validation' | 'repair_state' | 'diagnostic' | 'phase_rejection' | 'guard';
  label: string;
  tool?: string;
  detail?: string;
  status: 'active' | 'done' | 'info';
};

const PLAN_STAGE_LABELS: Record<string, string> = {
  understand: 'Understand',
  scope: 'Scope',
  plan: 'Plan',
  execute: 'Execute',
  validate: 'Validate',
};

function liveToolLabel(step: LiveAgentToolStep): string {
  const value = step.source ?? (step.args ? Object.values(step.args)[0] : undefined);
  const suffix = value
    ? ` · ${String(value).slice(0, 52)}${String(value).length > 52 ? '…' : ''}`
    : '';
  switch (step.tool) {
    case 'read_file':
      return `Reading source${suffix}`;
    case 'search_code':
      return `Searching the codebase${suffix}`;
    case 'list_files':
      return `Mapping project files${suffix}`;
    case 'git_status':
      return 'Checking repository status';
    case 'git_diff':
      return 'Reviewing recent changes';
    default:
      return `${step.tool.replace(/_/g, ' ')}${suffix}`;
  }
}

function activityEventsFromToolTrace(trace: ToolTraceEntry[]): LiveAgentActivityEvent[] {
  const events: LiveAgentActivityEvent[] = [];
  let nextId = 0;

  for (const entry of trace) {
    if (entry.kind === 'plan_activity' && entry.stage) {
      const approval = entry.approvalRequired
        ? `Approval required before changing: ${(entry.files ?? []).join(', ') || 'approved files'}`
        : undefined;
      events.push({
        id: nextId++,
        kind: 'plan',
        label: `${PLAN_STAGE_LABELS[entry.stage] ?? 'Plan activity'}${entry.stepTitle ? ` · ${entry.stepTitle}` : ''}`,
        detail: approval ?? entry.resultSummary ?? (entry.nextStepTitle ? `Next: ${entry.nextStepTitle}` : undefined),
        status: (entry.status as 'active' | 'done' | 'info' | undefined) === 'active'
          ? 'active'
          : (entry.status as 'active' | 'done' | 'info' | undefined) === 'done'
            ? 'done'
            : 'info',
      });
      continue;
    }
    if (entry.kind === 'tool_call' && entry.tool) {
      events.push({
        id: nextId++,
        kind: 'tool',
        tool: entry.tool,
        label: liveToolLabel({
          tool: entry.tool,
          args: entry.args,
          done: false,
          cached: entry.cached,
        }),
        status: 'active',
      });
      continue;
    }

    if (entry.kind === 'tool_result' && entry.tool) {
      const reverseIndex = [...events].reverse().findIndex(
        (event) => event.kind === 'tool' && event.tool === entry.tool && event.status === 'active',
      );
      if (reverseIndex >= 0) {
        const eventIndex = events.length - 1 - reverseIndex;
        const event = events[eventIndex]!;
        events[eventIndex] = {
          ...event,
          status: entry.resultKind === 'failed' || entry.resultKind === 'unavailable' || entry.resultKind === 'cancelled'
            ? 'info'
            : 'done',
          detail: entry.source
            ? `${entry.cached ? 'cached · ' : ''}${entry.source}`
            : entry.resultKind
              ? `${entry.resultKind}${entry.diagnosticCode ? ` · ${entry.diagnosticCode}` : ''}`
              : entry.cached ? 'cached' : undefined,
        };
        if (entry.resultSummary) events[eventIndex].detail = entry.resultSummary;
      }
      if (entry.resultKind === 'failed' || entry.resultKind === 'unavailable' || entry.resultKind === 'cancelled') {
        events.push({
          id: nextId++,
          kind: 'diagnostic',
          tool: entry.tool,
          label: entry.resultKind === 'cancelled' ? 'Tool cancelled' : 'Tool failed',
          detail: entry.diagnosticCode ?? entry.resultSummary ?? 'The operation did not complete.',
          status: 'info',
        });
      }
      continue;
    }

    if (entry.kind === 'model_call' && entry.model) {
      events.push({
        id: nextId++,
        kind: 'model',
        label: 'Model response',
        detail: `${entry.model}${entry.provider ? ` · ${entry.provider}` : ''}`,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'iteration_start' && typeof entry.iter === 'number' && entry.iter > 0) {
      events.push({
        id: nextId++,
        kind: 'iteration',
        label: 'Model iteration',
        detail: `${entry.iter + 1}/${entry.maxIterations ?? '?'}`,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'synthesis_start') {
      events.push({
        id: nextId++,
        kind: 'synthesis',
        label: 'Synthesis started',
        detail: typeof entry.iter === 'number'
          ? `${entry.iter + 1}/${entry.maxIterations ?? '?'}`
          : undefined,
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'validation') {
      const status = entry.validation?.status ?? entry.validationStatus ?? 'unavailable';
      events.push({
        id: nextId++,
        kind: 'validation',
        label: status === 'passed'
          ? 'Validation passed'
          : status === 'blocked'
            ? 'Validation blocked'
            : 'Validation failed',
        detail: [
          entry.validation?.profile ?? entry.validationProfile,
          (entry.attempt ?? entry.validationAttempt) != null
            ? `attempt ${entry.attempt ?? entry.validationAttempt}/${entry.maxAttempts ?? entry.validationMaxAttempts ?? '?'}`
            : undefined,
          (entry.validation?.exitCode ?? entry.validationExitCode) != null
            ? `exit ${entry.validation?.exitCode ?? entry.validationExitCode}`
            : undefined,
          entry.validation?.detail ?? entry.validationDetail,
        ].filter(Boolean).join(' · '),
        status: status === 'passed' ? 'done' : 'info',
      });
      continue;
    }

    if (entry.kind === 'repair_state' && entry.repairState) {
      const state = entry.repairState;
      events.push({
        id: nextId++,
        kind: 'repair_state',
        label: state === 'VALIDATING'
          ? 'Repair loop validating'
          : state === 'REPAIRING'
            ? 'Repair correction allowed'
            : state === 'READY_FOR_REVIEW'
              ? 'Ready for review'
              : 'Repair blocked',
        detail: entry.reason,
        status: state === 'READY_FOR_REVIEW' ? 'done' : state === 'VALIDATING' ? 'active' : 'info',
      });
      continue;
    }

    if (entry.kind === 'diagnostic' && entry.code) {
      const isPhaseRejection = entry.code === 'EXECUTION_PHASE_TOOL_REJECTED';
      events.push({
        id: nextId++,
        kind: isPhaseRejection ? 'phase_rejection' : 'diagnostic',
        tool: entry.tool,
        label: isPhaseRejection ? 'Phase policy blocked action' : 'Execution diagnostic',
        detail: isPhaseRejection && entry.phase && entry.tool
          ? `${entry.tool} rejected during ${entry.phase} phase`
          : entry.code.replace(/_/g, ' ').toLowerCase(),
        status: 'info',
      });
      continue;
    }

    if (entry.kind === 'execution_guard') {
      events.push({
        id: nextId++,
        kind: 'guard',
        label: 'Execution guard',
        detail: entry.message ?? entry.code,
        status: 'info',
      });
    }
  }

  // A persisted trace is terminal. Do not show an orphaned tool call as
  // running after a reload.
  return events.map((event) =>
    event.status === 'active'
      ? { ...event, status: 'info', detail: event.detail ?? 'No result event recorded' }
      : event,
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function liveStageDescription(stage: string | null, streamingContent: string, activeStep: LiveAgentToolStep | undefined): string {
  if (streamingContent) return 'Turning the verified context into the response you will see below.';
  if (activeStep) {
    switch (activeStep.tool) {
      case 'read_file':
        return 'Reading source bodies so any findings can be tied to real evidence.';
      case 'search_code':
        return 'Locating relevant symbols and references before opening the source.';
      case 'list_files':
        return 'Mapping the repository so the next reads stay focused and bounded.';
      default:
        return 'Running a bounded repository check before continuing.';
    }
  }
  const normalized = (stage ?? '').toLowerCase();
  if (normalized.includes('recover') || normalized.includes('diagnostic')) {
    return 'Checking another model with the evidence already collected; no new source reads are being added.';
  }
  if (normalized.includes('synthes')) {
    return 'Evidence gathering is paused while the final forensic report is assembled.';
  }
  if (normalized.includes('model response')) {
    return 'The current model is evaluating the collected context and tool results.';
  }
  if (normalized.includes('building context')) {
    return 'Preparing project context before the agent starts its focused investigation.';
  }
  if (normalized.includes('calling ai') || normalized.includes('calling model')) {
    return 'Sending the bounded context to the current model for the next decision.';
  }
  return 'The agent is coordinating the next bounded step of the investigation.';
}

function LiveAgentActivity({
  stage,
  steps,
  activityEvents,
  iter,
  model,
  streamingContent,
  busy,
  elapsedSeconds,
  onCancel,
  modelHistory,
  diagnostics,
  isFixtureLocal,
  verdictScope,
  auditScopeDescription,
}: {
  stage: string | null;
  steps: LiveAgentToolStep[];
  activityEvents: LiveAgentActivityEvent[];
  iter: { iter: number; max: number } | null;
  model: string | null;
  streamingContent: string;
  busy: boolean;
  elapsedSeconds: number;
  onCancel?: () => void;
  modelHistory: Array<{ id: string; provider: string }>;
  diagnostics: string[];
  /** True once the live SSE stream reports a fixture-local forensic_status. */
  isFixtureLocal?: boolean;
  /** Task #58: live verdict proof scope from the decision_trace SSE event. */
  verdictScope?: {
    scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
    findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
  };
  auditScopeDescription?: string;
}) {
  const activityLogEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activityLogEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activityEvents.length]);

  if (!busy) return null;

  const completed = steps.filter((step) => step.done).length;
  const readSources = new Set(
    steps
      .filter((step) => step.done && step.tool === 'read_file' && step.source)
      .map((step) => step.source),
  ).size;
  const activeStep = [...steps].reverse().find((step) => !step.done);
  const lastCompleted = [...steps].reverse().find((step) => step.done);
  const sourcePaths = Array.from(new Set(
    steps
      .filter((step) => step.done && step.tool === 'read_file' && step.source)
      .map((step) => step.source as string),
  ));
  const activeStepNumber = activeStep ? steps.indexOf(activeStep) + 1 : completed;
  const isReporting = Boolean(streamingContent) ||
    /synthes|model response|report|diagnostic|recover/i.test(stage ?? '');
  const phaseIndex = isReporting ? 2 : steps.length > 0 || iter ? 1 : 0;
  const phaseLabels = ['Preparing', 'Gathering evidence', 'Writing result'];
  const activityLabel = streamingContent
    ? 'Writing the response'
    : activeStep
      ? liveToolLabel(activeStep)
      : stage ?? (phaseIndex === 2 ? 'Preparing the final result' : 'Starting analysis');

  const borderColor = isFixtureLocal ? 'border-violet-500/30' : 'border-primary/20';
  const bgColor = isFixtureLocal ? 'bg-violet-500/5' : 'bg-primary/5';
  const accentColor = isFixtureLocal ? 'text-violet-300' : 'text-primary';
  const accentBg = isFixtureLocal ? 'bg-violet-500/10' : 'bg-primary/10';
  const phaseActiveColor = isFixtureLocal ? 'bg-violet-400' : 'bg-primary';
  const phaseActiveTextColor = isFixtureLocal ? 'text-violet-300' : 'text-primary';

  return (
    <div
      className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg border ${borderColor} ${bgColor} px-3 py-2.5`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${accentBg}`}>
          <Loader2 className={`h-3.5 w-3.5 animate-spin ${accentColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">{activityLabel}</span>
            {isFixtureLocal && (
              <span className="rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                FIXTURE-LOCAL
              </span>
            )}
            {verdictScope?.scope && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                verdictScope.scope === 'PRODUCTION' || verdictScope.scope === 'MIXED'
                  ? 'border-green-500/50 bg-green-500/15 text-green-200'
                  : 'border-violet-500/50 bg-violet-500/15 text-violet-200'
              }`}>
                {String(verdictScope.scope).replace(/_/g, ' ')}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {formatElapsed(elapsedSeconds)} · Live
            </span>
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
            {liveStageDescription(stage, streamingContent, activeStep)}
          </p>
          {auditScopeDescription && (
            <div className="mt-2 rounded border border-primary/20 bg-background/25 px-2 py-1.5 text-[10px] leading-4 text-foreground/85">
              <span className="font-medium text-primary">Approved scope:</span>{' '}
              {auditScopeDescription}
            </div>
          )}
          {isFixtureLocal && (
            <p className="mt-1 text-[10px] leading-4 text-violet-300/80">
              Evidence found only in fixture/test paths — production reachability not yet proven.
            </p>
          )}
          <div className="mt-2 grid grid-cols-3 gap-1">
            {phaseLabels.map((label, index) => (
              <div key={label} className="min-w-0">
                <div className={`h-1 rounded-full ${index <= phaseIndex ? phaseActiveColor : 'bg-border/70'}`} />
                <div className={`mt-1 truncate text-[9px] ${index === phaseIndex ? phaseActiveTextColor : 'text-muted-foreground'}`}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2 text-[10px] text-muted-foreground`}>
        {steps.length > 0 && (
          <span>
            <span className="text-foreground">{completed}/{steps.length}</span> actions complete
          </span>
        )}
        {activeStep && (
          <span>
            step <span className="text-foreground">{activeStepNumber}</span> active
          </span>
        )}
        {readSources > 0 && (
          <span>
            <span className="text-foreground">{readSources}</span> source{readSources === 1 ? '' : 's'} read
          </span>
        )}
        {iter && (
          <span>
            <span className="text-foreground">{iter.iter + 1}/{iter.max}</span> pass
          </span>
        )}
        {diagnostics.length > 0 && (
          <span className="text-amber-300/90">
            {diagnostics.length} recovery notice{diagnostics.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {activityEvents.length > 0 && (
        <div className={`mt-2 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2`}>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>Live activity</span>
            <span>{activityEvents.length} events</span>
          </div>
          <div className="mt-1 max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border/40 bg-background/20 px-2 py-1.5">
            {activityEvents.map((event) => (
              <div key={event.id} className="flex min-w-0 items-start gap-1.5 py-0.5 text-[10px] leading-4">
                <span className={`mt-0.5 shrink-0 ${
                  event.status === 'done'
                    ? 'text-emerald-400'
                    : event.status === 'active'
                      ? accentColor
                      : 'text-muted-foreground'
                }`}>
                  {event.status === 'done' ? '✓' : event.status === 'active' ? '◌' : '·'}
                </span>
                <span className="min-w-0 break-words text-foreground/85">{event.label}</span>
                {event.detail && (
                  <code className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
                )}
              </div>
            ))}
            <div ref={activityLogEndRef} />
          </div>
        </div>
      )}

      {sourcePaths.length > 0 && (
        <div className={`mt-2 border-t ${isFixtureLocal ? 'border-violet-500/15' : 'border-primary/10'} pt-2`}>
          <div className="text-[10px] text-muted-foreground">
            Sources read
            <span className="ml-1 text-foreground">{sourcePaths.length}</span>
          </div>
          <div className="mt-1 max-h-24 min-w-0 overflow-y-auto overflow-x-hidden rounded border border-border/40 bg-background/20 p-1">
            {sourcePaths.map((source) => (
              <code key={source} className="block min-w-0 break-all whitespace-normal rounded px-1 py-0.5 text-[9px] leading-4 text-muted-foreground">
                {redactInternalDetails(source)}
              </code>
            ))}
          </div>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="mt-1 break-words text-[10px] leading-4 text-amber-300/90" title={diagnostics[diagnostics.length - 1]}>
          Recovery: {diagnostics[diagnostics.length - 1]}
        </div>
      )}

      {lastCompleted && !activeStep && !streamingContent && (
        <div className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">
          Last completed: {liveToolLabel(lastCompleted)}
        </div>
      )}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
        >
          <Square className="h-2.5 w-2.5 fill-current" />
          Stop request
        </button>
      )}
    </div>
  );
}

function CompletedActivityTimeline({
  events,
  defaultOpen = false,
}: {
  events?: LiveAgentActivityEvent[];
  defaultOpen?: boolean;
}) {
  if (!events || events.length === 0) return null;

  return (
    <details open={defaultOpen} className="mt-1 w-full min-w-0 max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
        <Activity className="h-3 w-3" />
        <span>Agent activity</span>
        <span className="text-[10px]">· {events.length} events</span>
        <ChevronRight className="h-3 w-3 transition-transform [[open]>&]:rotate-90" />
      </summary>
      <div className="mt-1 max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-lg border border-border/50 bg-background/30 px-3 py-2 text-[10px]">
        {events.map((event, index) => (
          <div key={`${event.id}-${index}`} className="flex min-w-0 items-start gap-1.5 leading-5">
            <span className={`shrink-0 ${
              event.status === 'done' ? 'text-emerald-400' :
                event.status === 'active' ? 'text-primary' : 'text-muted-foreground'
            }`}>
              {event.status === 'done' ? '✓' : event.status === 'active' ? '◌' : '·'}
            </span>
            <span className="min-w-0 break-words text-foreground/85">{event.label}</span>
            {event.detail && (
              <code className="min-w-0 break-all text-muted-foreground">{redactInternalDetails(event.detail)}</code>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

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
  const failedTests = entry.validationFailedTestDetails ?? validation?.failedTests ?? [];
  const changedFiles = entry.validationChangedFiles ?? validation?.changedFiles ?? [];
  const command = validation?.command ?? entry.validationCommand;
  const stderr = validation?.stderr;

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
      {command && (
        <div className="mt-1">
          <span className="text-muted-foreground">Command: </span>
          <code className="break-all text-foreground/80">{command}</code>
        </div>
      )}
      {failedTests.length > 0 && (
        <div className="mt-1">
          <div className="text-muted-foreground">Failed tests:</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-red-200">
            {failedTests.slice(0, 8).map((failure, index) => (
              <li key={`${failure.name}-${index}`} className="break-words">
                {failure.name || failure.message}
                {failure.name && failure.message && failure.message !== failure.name ? ` — ${failure.message}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {changedFiles.length > 0 && (
        <div className="mt-1">
          <span className="text-muted-foreground">Changed files: </span>
          <span className="break-words text-foreground/80">{changedFiles.slice(0, 8).join(', ')}</span>
        </div>
      )}
      {stderr && (
        <div className="mt-1">
          <span className="text-muted-foreground">Error output: </span>
          <span className="whitespace-pre-wrap break-words text-red-200">{stderr.slice(0, 1200)}</span>
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
          {validation?.failedTests?.length ? ` · ${validation.failedTests[0]?.message ?? validation.failedTests[0]?.name}` : ''}
        </div>
      )}
      {detail && <div className="mt-1 break-words text-amber-100">Next transition signal: {detail}</div>}
    </div>
  );
}

function FlightRecorder({ trace }: { trace: ToolTraceEntry[] }) {
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

type AgentExecutionProofStatus = {
  id?: string;
  status?: string;
  flightState?:
    | 'BUILDING'
    | 'VALIDATING'
    | 'REPAIRING'
    | 'READY_FOR_REVIEW'
    | 'BLOCKED'
    | 'APPLIED'
    | 'COMMITTED'
    | 'PUSHED'
    | 'CANCELLED'
    | 'COMPLETED';
  evidenceVerdict?: 'PROVEN' | 'PARTIAL' | 'UNAVAILABLE' | 'BLOCKED' | 'NOT_RECORDED';
  evidenceReason?: string | null;
  objective?: Record<string, unknown> | null;
  proofRequired?: boolean;
  checkpoint?: Record<string, unknown>;
  checkpointVersion?: number;
  resumable?: boolean;
  error?: string | null;
};

function flightDeckStateLabel(state: AgentExecutionProofStatus['flightState']): string {
  switch (state) {
    case 'READY_FOR_REVIEW':
      return 'Ready for review';
    case 'VALIDATING':
      return 'Validating';
    case 'REPAIRING':
      return 'Repairing';
    case 'BLOCKED':
      return 'Blocked';
    case 'APPLIED':
      return 'Applied';
    case 'COMMITTED':
      return 'Committed';
    case 'PUSHED':
      return 'Pushed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'COMPLETED':
      return 'Completed';
    case 'BUILDING':
      return 'Building';
    default:
      return 'Preparing';
  }
}

function flightDeckStateClasses(state: AgentExecutionProofStatus['flightState']): string {
  if (state === 'BLOCKED') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (state === 'CANCELLED') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (state === 'READY_FOR_REVIEW' || state === 'APPLIED' || state === 'COMMITTED' || state === 'PUSHED') {
    return 'border-green-500/40 bg-green-500/10 text-green-200';
  }
  if (state === 'VALIDATING' || state === 'REPAIRING') {
    return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  }
  return 'border-primary/40 bg-primary/10 text-primary';
}

function flightDeckEvidenceClasses(verdict: AgentExecutionProofStatus['evidenceVerdict']): string {
  if (verdict === 'PROVEN') return 'border-green-500/40 bg-green-500/10 text-green-200';
  if (verdict === 'BLOCKED' || verdict === 'UNAVAILABLE') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (verdict === 'PARTIAL') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  return 'border-border/60 bg-background/30 text-muted-foreground';
}

function checkpointExecutionNodes(
  checkpoint: Record<string, unknown> | undefined,
): AiExecutionNodeSnapshot[] {
  if (!checkpoint || !Array.isArray(checkpoint.nodeStates)) return [];
  return checkpoint.nodeStates.filter((node): node is AiExecutionNodeSnapshot => {
    if (!node || typeof node !== 'object') return false;
    const value = node as Partial<AiExecutionNodeSnapshot>;
    return (
      typeof value.id === 'string' &&
      typeof value.title === 'string' &&
      typeof value.status === 'string' &&
      Array.isArray(value.allowedFiles) &&
      Array.isArray(value.dependencies) &&
      typeof value.validationProfile === 'string' &&
      typeof value.attempts === 'number'
    );
  });
}

function ExecutionMissionControl({
  nodes,
}: {
  nodes: AiExecutionNodeSnapshot[];
}) {
  if (nodes.length === 0) return null;
  const counts = nodes.reduce<Record<string, number>>((summary, node) => {
    summary[node.status] = (summary[node.status] ?? 0) + 1;
    return summary;
  }, {});
  const statusClasses: Record<string, string> = {
    queued: 'border-border/60 bg-background/30 text-muted-foreground',
    running: 'border-primary/40 bg-primary/10 text-primary',
    passed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    failed: 'border-red-500/40 bg-red-500/10 text-red-200',
    blocked: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  };

  return (
    <div className="border-t border-border/40 px-3 py-2.5" aria-label="Execution mission control">
      <div className="flex items-center gap-2">
        <GitMerge className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-semibold text-foreground">Mission Control</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {counts.passed ?? 0}/{nodes.length} complete
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {nodes.map((node) => (
          <div key={node.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${statusClasses[node.status] ?? statusClasses.queued}`}>
              {node.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-foreground/90">{node.title}</span>
            <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
              {node.attempts}/3
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BenchmarkMissionControlPanel({ data }: { data: BenchmarkScorecard }) {
  const metrics = data.metrics;
  const observed = metrics?.observedCases ?? 0;
  const total = metrics?.totalCases ?? 0;
  const complete = total > 0 && observed === total;
  const blockers = data.rolloutBlockers ?? [];
  const gradeCounts = metrics?.gradeCounts ?? {};
  const providerUnavailable = metrics?.providerUnavailableCount ?? gradeCounts.U ?? 0;
  const qualityObserved = Math.max(0, observed - providerUnavailable);
  const baselineStatus = data.baselineComparison?.status ?? 'missing';
  const correctCompletionDelta = data.baselineComparison?.metricDeltas?.correctCompletionRate;

  return (
    <div className="border-t border-border/40 px-3 py-2.5" aria-label="Code Agent benchmark mission control">
      <div className="flex items-center gap-2">
        <ShieldCheck className={`h-3.5 w-3.5 ${data.rolloutAllowed ? 'text-emerald-300' : 'text-amber-300'}`} />
        <span className="text-[11px] font-semibold text-foreground">Code Agent benchmark</span>
        <Link href="/mission-control" className="ml-1 text-[10px] text-primary hover:underline">
          Open Mission Control
        </Link>
        <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
          data.rolloutAllowed
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}>
          {data.rolloutAllowed ? 'rollout allowed' : 'rollout blocked'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
          <div className="text-[9px] text-muted-foreground">Coverage</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {observed}/{total} {complete ? 'complete' : 'observed'}
          </div>
          {providerUnavailable > 0 && (
            <div className="mt-0.5 text-[9px] text-amber-200/80">
              Quality evidence: {qualityObserved}/{observed}
            </div>
          )}
        </div>
        {(['A', 'B', 'C', 'D', 'F', 'U'] as const).map((grade) => (
          <div key={grade} className="rounded-md border border-border/40 bg-background/20 px-2 py-1.5">
            <div className="text-[9px] text-muted-foreground">{grade === 'U' ? 'Provider unavailable' : `Grade ${grade}`}</div>
            <div className={`mt-0.5 text-[11px] font-medium ${
              grade === 'F' && (gradeCounts[grade] ?? 0) > 0
                ? 'text-red-300'
                : grade === 'U' && (gradeCounts[grade] ?? 0) > 0
                  ? 'text-amber-200'
                  : 'text-foreground'
            }`}>
              {gradeCounts[grade] ?? 0}
            </div>
          </div>
        ))}
      </div>
      {blockers.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100/85">
          <div className="font-semibold text-amber-200">Rollout blockers</div>
          <ul className="mt-0.5 list-disc pl-4">
            {blockers.slice(0, 3).map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/40 bg-background/20 px-2 py-1.5 text-[9px]">
        <span className="text-muted-foreground">Baseline gate</span>
        <span className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase ${
          baselineStatus === 'passed'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}>
          {baselineStatus}
        </span>
        {data.baseline?.baselineId && (
          <code className="max-w-[15rem] truncate text-muted-foreground">{data.baseline.baselineId}</code>
        )}
        {typeof correctCompletionDelta === 'number' && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            Completion Δ {correctCompletionDelta >= 0 ? '+' : ''}{(correctCompletionDelta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        {data.provider ? `Provider: ${data.provider}` : 'Provider not recorded'}
        {data.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleString()}` : ''}
      </div>
    </div>
  );
}

function BenchmarkMissionControl() {
  const { data, isLoading, isError } = useQuery<BenchmarkScorecard>({
    queryKey: ['code-agent-benchmark-scorecard'],
    queryFn: async () => {
      const response = await fetch('/api/ai/benchmark/scorecard', { credentials: 'include' });
      if (!response.ok) throw new Error(`Benchmark scorecard unavailable (${response.status})`);
      return response.json() as Promise<BenchmarkScorecard>;
    },
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading || isError || !data) return null;
  return <BenchmarkMissionControlPanel data={data} />;
}

function proofStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'paused':
      return 'Paused';
    case 'failed':
      return 'Failed safely';
    case 'cancelling':
      return 'Stopping';
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'ready-to-apply':
      return 'Ready to apply';
    case 'ready-to-commit':
      return 'Ready to commit';
    case 'ready-to-push':
      return 'Ready to push';
    default:
      return 'Preparing';
  }
}

function proofStatusClasses(status: string | undefined): string {
  if (status === 'failed') return 'border-red-500/40 bg-red-500/10 text-red-200';
  if (status === 'paused' || status === 'cancelling') return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
  if (status === 'completed' || status === 'ready-to-push') return 'border-green-500/40 bg-green-500/10 text-green-200';
  if (status === 'ready-to-apply' || status === 'ready-to-commit') return 'border-sky-500/40 bg-sky-500/10 text-sky-200';
  return 'border-primary/40 bg-primary/10 text-primary';
}

function AgentExecutionProofPanel({
  execution,
  executionId,
  executionNodes,
  busy,
  stage,
  elapsedSeconds,
  steps,
  modelHistory,
  pendingChanges,
  commitReadyPaths,
  pushReady,
  evidenceIntegrity,
  isFixtureLocal,
  verdictScope,
}: {
  execution?: AgentExecutionProofStatus | null;
  executionId?: string;
  executionNodes: AiExecutionNodeSnapshot[];
  busy: boolean;
  stage: string | null;
  elapsedSeconds: number;
  steps: LiveAgentToolStep[];
  modelHistory: Array<{ id: string; provider: string }>;
  pendingChanges: PendingChange[];
  commitReadyPaths: string[];
  pushReady: boolean;
  evidenceIntegrity: {
    consistent: boolean;
    violations: string[];
    objectiveType?: string;
    requiredEdges?: string[];
    provenEdges?: string[];
    completionGateResult?: string;
    finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
  } | null;
  isFixtureLocal: boolean;
  verdictScope?: {
    scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
    findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
  } | null;
}) {
  const persistedStatus = execution?.status;
  const flightState = execution?.flightState;
  const status = busy
    ? persistedStatus ?? 'running'
    : persistedStatus ??
      (executionId
        ? 'running'
        : pushReady
        ? 'ready-to-push'
        : commitReadyPaths.length > 0
          ? 'ready-to-commit'
          : pendingChanges.length > 0
            ? 'ready-to-apply'
            : undefined);
  if (!status) return null;

  const checkpointStage = execution?.checkpoint && typeof execution.checkpoint.stage === 'string'
    ? execution.checkpoint.stage
    : null;
  const missionNodes = executionNodes.length > 0
    ? executionNodes
    : checkpointExecutionNodes(execution?.checkpoint);
  const phase = stage ?? checkpointStage ?? (
    status === 'ready-to-apply'
      ? 'Verified changes are waiting for approval'
      : status === 'ready-to-commit'
        ? 'Verified changes are ready for Git commit'
        : status === 'ready-to-push'
          ? 'Committed changes are ready to push'
          : 'Execution status is being confirmed'
  );
  const completedTools = steps.filter((step) => step.done).length;
  const readSources = new Set(
    steps
      .filter((step) => step.done && step.tool === 'read_file' && step.source)
      .map((step) => step.source),
  ).size;
  const evidenceLabel = evidenceIntegrity
    ? evidenceIntegrity.consistent
      ? 'Telemetry consistent'
      : `${evidenceIntegrity.violations.length || 1} evidence violation${evidenceIntegrity.violations.length === 1 ? '' : 's'}`
    : readSources > 0
      ? `${readSources} source file${readSources === 1 ? '' : 's'} read`
      : isFixtureLocal
        ? 'Fixture-local only'
        : 'Evidence pending';
  const deliveryLabel = pushReady
    ? 'Push is available'
    : commitReadyPaths.length > 0
      ? `${commitReadyPaths.length} file${commitReadyPaths.length === 1 ? '' : 's'} ready to commit`
      : pendingChanges.length > 0
        ? `${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'} awaiting approval`
        : 'No writes applied automatically';
  const scopeLabel = verdictScope?.scope ?? (isFixtureLocal ? 'FIXTURE_LOCAL' : undefined);
  const proofBlocked = execution?.proofRequired === true
    && execution.evidenceVerdict !== 'PROVEN'
    && status === 'completed';
  const objectiveLabel = execution?.objective && typeof execution.objective === 'object'
    ? String(
        execution.objective.objective
        ?? execution.objective.description
        ?? execution.objective.objectiveType
        ?? 'Declared engineering objective',
      )
    : 'No objective was retained for this execution.';
  const requiredEdges = evidenceIntegrity?.requiredEdges ?? [];
  const provenEdges = evidenceIntegrity?.provenEdges ?? [];
  const riskLabel = pendingChanges.some((change) => change.risk === 'high')
    ? 'High risk change present'
    : pendingChanges.some((change) => change.risk === 'medium')
      ? 'Medium risk change present'
      : pendingChanges.length > 0
        ? 'Low risk change set'
        : evidenceIntegrity?.consistent === false
          ? 'Evidence integrity risk'
          : 'No unresolved patch risk recorded';

  return (
    <div
      className={`mx-auto mb-3 w-full max-w-3xl overflow-hidden rounded-xl border ${
        status === 'failed'
          ? 'border-red-500/30 bg-red-500/5'
          : isFixtureLocal
            ? 'border-violet-500/30 bg-violet-500/5'
            : 'border-primary/20 bg-primary/5'
      }`}
      aria-label="Agent execution proof"
    >
      <div className="flex flex-wrap items-start gap-2 border-b border-border/40 px-3 py-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/40">
          {status === 'failed' || proofBlocked
            ? <ShieldAlert className="h-3.5 w-3.5 text-red-300" />
            : status === 'completed' || status.startsWith('ready-')
              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-300" />
              : <Activity className="h-3.5 w-3.5 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Agent execution proof</span>
             <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
               flightState ? flightDeckStateClasses(flightState) : proofStatusClasses(status)
             }`}>
               {flightState ? flightDeckStateLabel(flightState) : proofStatusLabel(status)}
            </span>
             {execution?.evidenceVerdict && (
               <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${flightDeckEvidenceClasses(execution.evidenceVerdict)}`}>
                 Evidence: {execution.evidenceVerdict.replace('_', ' ')}
               </span>
             )}
            {scopeLabel && (
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                scopeLabel === 'PRODUCTION' || scopeLabel === 'MIXED'
                  ? 'border-green-500/40 bg-green-500/10 text-green-200'
                  : 'border-violet-500/40 bg-violet-500/10 text-violet-200'
              }`}>
                {scopeLabel.replace(/_/g, ' ')}
              </span>
            )}
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {busy ? `${formatElapsed(elapsedSeconds)} elapsed` : 'Persisted proof'}
            </span>
          </div>
          <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{phase}</p>
          {(execution?.id ?? executionId) && (
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 truncate text-[9px] text-muted-foreground">
                Execution {execution?.id ?? executionId}
              </code>
              <Link
                href={`/flight-deck?executionId=${encodeURIComponent(execution?.id ?? executionId ?? '')}`}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/30 px-1.5 py-0.5 text-[9px] text-primary hover:bg-primary/10"
                aria-label="Open execution in Flight Deck"
              >
                Flight Deck <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          )}
          {execution?.error && (
            <p className="mt-1 break-words text-[10px] leading-4 text-red-200">{execution.error}</p>
          )}
          {execution?.evidenceReason && (
            <p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{execution.evidenceReason}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border/30 sm:grid-cols-4">
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Evidence</div>
          <div className={`mt-0.5 text-[11px] font-medium ${
            evidenceIntegrity?.consistent ? 'text-green-300' : isFixtureLocal ? 'text-violet-200' : 'text-foreground'
          }`}>
            {evidenceLabel}
          </div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Agent work</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {completedTools}/{steps.length} tools
            {modelHistory.length > 0 ? ` · ${modelHistory.length} model${modelHistory.length === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Delivery</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">{deliveryLabel}</div>
        </div>
        <div className="bg-background/20 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Safety</div>
          <div className={`mt-0.5 text-[11px] font-medium ${
            status === 'failed' || evidenceIntegrity?.consistent === false
              ? 'text-red-300'
              : pendingChanges.length > 0 || status.startsWith('ready-')
                ? 'text-amber-200'
                : 'text-green-300'
          }`}>
            {status === 'failed'
              ? 'No automatic writes'
              : pendingChanges.length > 0
                ? 'Approval required'
                : 'Writes gated'}
          </div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-border/40 px-3 py-2.5 sm:grid-cols-[1.5fr_1fr_1fr]">
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground">Objective</div>
          <div className="mt-0.5 break-words text-[11px] font-medium text-foreground">{objectiveLabel}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Scope</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">
            {missionNodes.reduce((total, node) => total + node.allowedFiles.length, 0)} files · {missionNodes.length} nodes
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Risk</div>
          <div className={`mt-0.5 text-[11px] font-medium ${riskLabel.startsWith('High') || riskLabel.startsWith('Evidence') ? 'text-red-200' : 'text-amber-200'}`}>{riskLabel}</div>
        </div>
      </div>
      {evidenceIntegrity && (
        evidenceIntegrity.objectiveType ||
        evidenceIntegrity.completionGateResult ||
        evidenceIntegrity.finalAnswerType ||
        requiredEdges.length > 0 ||
        provenEdges.length > 0
      ) && (
        <div className="border-t border-border/40 px-3 py-2.5" aria-label="Objective proof details">
          <div className="text-[10px] font-semibold text-primary">Objective proof</div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
            <div>
              <div className="text-[10px] text-muted-foreground">Completion</div>
              <div className="font-semibold text-foreground">{evidenceIntegrity.completionGateResult ?? 'Not declared'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Required edges</div>
              <div className="font-semibold text-foreground">{requiredEdges.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Proven edges</div>
              <div className="font-semibold text-green-300">{provenEdges.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Final answer</div>
              <div className="break-words font-semibold text-foreground">
                {evidenceIntegrity.finalAnswerType
                  ? evidenceIntegrity.finalAnswerType.replace(/_ANSWER$/, '').replace(/_/g, ' ')
                  : 'Not recorded'}
              </div>
            </div>
          </div>
          {evidenceIntegrity.objectiveType && (
            <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
              Objective type: <span className="font-semibold text-foreground">{evidenceIntegrity.objectiveType}</span>
            </div>
          )}
          {requiredEdges.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
              <div className="text-[10px] text-muted-foreground">Edge proof ledger</div>
              {requiredEdges.map((edge) => (
                <div key={edge} className="font-mono text-[10px] text-foreground/80">
                  <span className={provenEdges.includes(edge) ? 'text-green-300' : 'text-amber-200'}>
                    {provenEdges.includes(edge) ? '✓' : '○'}
                  </span>{' '}
                  {edge}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(execution?.checkpointVersion !== undefined || execution?.resumable || evidenceIntegrity?.violations.length) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground">
          {execution?.checkpointVersion !== undefined && (
            <span>checkpoint v{execution.checkpointVersion}</span>
          )}
          {execution?.resumable && <span className="text-amber-200">resume available</span>}
          {evidenceIntegrity && !evidenceIntegrity.consistent && (
            <span className="text-red-200">Evidence gate blocked unsupported claims</span>
          )}
        </div>
      )}
      <ExecutionMissionControl nodes={missionNodes} />
      <BenchmarkMissionControl />
    </div>
  );
}

export default function AiChat() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isLoaded, user } = useUser();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // AI-TASK-006: task linkage — read from URL search params so the Tasks page
  // can deep-link to /ai?taskId=<uuid>&projectId=<id> to open a task-aware session.
  const [linkedTaskId] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('taskId') ?? undefined;
  });
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [historicalReportError, setHistoricalReportError] = useState<string | null>(null);
  const [planDecisionPending, setPlanDecisionPending] = useState<string | null>(null);
  const [planBuildPending, setPlanBuildPending] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [proposalId, setProposalId] = useState<string | undefined>(undefined);
  const [operationId, setOperationId] = useState<string | undefined>(undefined);
  const [operationMode, setOperationMode] = useState<OperationMode | undefined>(undefined);
  const [proposalRequiresApproval, setProposalRequiresApproval] = useState(false);
  const [proposalRevision, setProposalRevision] = useState<number | undefined>(undefined);
  const reapprovalApplyRef = useRef<ApprovedPendingChange[] | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<string, BehavioralVerification>>({});
  const [commitReadyPaths, setCommitReadyPaths] = useState<string[]>([]);
  const [commitProposalId, setCommitProposalId] = useState<string | undefined>(undefined);
  const [commitMessage, setCommitMessage] = useState('Apply verified AI changes');
  const [pushReady, setPushReady] = useState(false);
  // PR-I: agentStage is now driven by real SSE stage events from the server
  // rather than a client-side timer that rotated through fake labels.
  const [agentStage, setAgentStage] = useState<string | null>(null);
  // Streaming: accumulates raw text deltas while Groq is streaming a response.
  // Cleared to '' once the `done` event arrives and the full message is added.
  const [streamingContent, setStreamingContent] = useState('');
  // STORY-04: actual model used at runtime — updated from every SSE done event
  // so the badge always reflects what the model that actually ran the request.
  const [lastResolvedModel, setLastResolvedModel] = useState<{ id: string; provider: string; free: boolean } | undefined>(undefined);
  const { send: streamSend, cancel: cancelStream, isPending: isSending } = useAiChatStream();
  const { send: taskStreamSend, cancel: cancelTaskStream, isPending: isTaskSending } = useAiTaskStream();
  const streamGenerationRef = useRef(0);
  const streamOwnerRef = useRef<StreamOwner | null>(null);
  const { data: operationEvents = [], isLoading: operationEventsLoading } = useListEvents<ApiEvent[]>(
    {
      projectId: selectedProjectId,
      ...(operationId ? { correlationId: operationId } : {}),
      limit: 100,
    },
    {
      query: {
        queryKey: ['operation-trace', selectedProjectId, operationId],
        enabled: isLoaded && !!selectedProjectId && !!operationId,
      },
    },
  );

  useEffect(() => {
    return () => {
      cancelStream();
      cancelTaskStream();
    };
  }, [cancelStream, cancelTaskStream]);

  // Live agent tool-step tracking — updated in real time via SSE callbacks.
  const [agentSteps, setAgentSteps] = useState<LiveAgentToolStep[]>([]);
  const [agentActivityEvents, setAgentActivityEvents] = useState<LiveAgentActivityEvent[]>([]);
  const agentActivityEventsRef = useRef<LiveAgentActivityEvent[]>([]);
  const agentActivityIdRef = useRef(0);
  const [agentIter, setAgentIter] = useState<{ iter: number; max: number } | null>(null);
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [agentElapsedSeconds, setAgentElapsedSeconds] = useState(0);
  const [agentModelHistory, setAgentModelHistory] = useState<Array<{ id: string; provider: string }>>([]);
  const [agentDiagnostics, setAgentDiagnostics] = useState<string[]>([]);
  const [activeExecution, setActiveExecution] = useState<ActiveExecution | null>(null);
  const [executionNodes, setExecutionNodes] = useState<AiExecutionNodeSnapshot[]>([]);
  const activeExecutionRef = useRef<ActiveExecution | null>(null);
  /** True once a live forensic_status SSE step reports isFixtureLocal — lets
   *  LiveAgentActivity show the FIXTURE-LOCAL badge before the report lands. */
  const [liveFixtureLocal, setLiveFixtureLocal] = useState(false);
  /** Task #58: live verdict proof scope + scoped finding status from the
   *  decision_trace SSE event — surfaced during the run, cleared on done so the
   *  persisted forensic card takes over. */
  const [liveVerdictScope, setLiveVerdictScope] = useState<{
    scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
    findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
  } | null>(null);
  const [liveAuditScopeDescription, setLiveAuditScopeDescription] = useState<string | null>(null);
  /** NI-35: live evidence_integrity (EI-012) reconciliation shown during the
   *  stream; cleared on done so the persisted forensic card takes over. */
  const [liveEvidenceIntegrity, setLiveEvidenceIntegrity] = useState<{
    consistent: boolean;
    violations: string[];
    objectiveType?: string;
    requiredEdges: string[];
    provenEdges: string[];
    completionGateResult?: string;
    finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
  } | null>(null);

  // Keep the opaque resume token across tab refreshes. The server stores only
  // its hash, so losing this browser copy would make a paused execution look
  // resumable while making the actual resume impossible.
  const executionPointerKey = selectedProjectId
    ? `eos_ai_execution_current_${selectedProjectId}`
    : undefined;
  const pointedExecutionSessionId = (() => {
    if (!executionPointerKey || sessionId) return undefined;
    const value = localStorage.getItem(executionPointerKey);
    return value && value.trim() ? value : undefined;
  })();
  const executionStorageSessionId = sessionId ?? pointedExecutionSessionId;
  const executionStorageKey = selectedProjectId && executionStorageSessionId
    ? `eos_ai_execution_${selectedProjectId}_${executionStorageSessionId}`
    : undefined;
  const hydratedExecutionScopeRef = useRef<string | null>(null);
  const storedExecution = (() => {
    if (!executionStorageKey) return null;
    try {
      const raw = localStorage.getItem(executionStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ActiveExecution>;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.projectId !== 'string' ||
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.message !== 'string'
      ) {
        localStorage.removeItem(executionStorageKey);
        return null;
      }
      if (
        parsed.projectId !== selectedProjectId ||
        parsed.sessionId !== executionStorageSessionId
      ) {
        localStorage.removeItem(executionStorageKey);
        return null;
      }
      return parsed as ActiveExecution & { sessionId: string };
    } catch {
      localStorage.removeItem(executionStorageKey);
      return null;
    }
  })();

  const { data: activeExecutionStatus } = useGetAiExecution(
    activeExecution?.id ?? '',
    {
      query: {
        queryKey: ['ai-execution', activeExecution?.id],
        enabled: Boolean(activeExecution?.id && isLoaded),
        refetchInterval: isSending || isTaskSending ? 5_000 : 15_000,
      },
    },
  );

  useEffect(() => {
    if (!executionStorageKey || hydratedExecutionScopeRef.current === executionStorageKey) return;
    hydratedExecutionScopeRef.current = executionStorageKey;
    if (!storedExecution) return;
    activeExecutionRef.current = storedExecution;
    setActiveExecution(storedExecution);
    setSessionId((current) => current ?? storedExecution.sessionId);
    setAgentStage('Saved execution recovered — checking server status…');
  }, [executionStorageKey, storedExecution?.id]);

  useEffect(() => {
    if (
      !executionStorageKey ||
      !executionPointerKey ||
      !executionStorageSessionId ||
      !activeExecution
    ) return;
    if (
      activeExecution.projectId !== selectedProjectId ||
      activeExecution.sessionId !== executionStorageSessionId
    ) return;
    localStorage.setItem(
      executionStorageKey,
      JSON.stringify({
        ...activeExecution,
        projectId: selectedProjectId,
        sessionId: executionStorageSessionId,
      }),
    );
    localStorage.setItem(executionPointerKey, executionStorageSessionId);
  }, [
    activeExecution,
    executionPointerKey,
    executionStorageKey,
    executionStorageSessionId,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (!activeExecutionStatus || !activeExecution) return;
    if (
      activeExecution.projectId !== selectedProjectId ||
      activeExecution.sessionId !== sessionId
    ) return;
    if (activeExecutionStatus.status === 'completed' || activeExecutionStatus.status === 'cancelled') {
      const recoveredSessionId = activeExecution.sessionId ?? sessionId;
      if (recoveredSessionId) {
        void qc.invalidateQueries({ queryKey: ['ai-messages', recoveredSessionId] });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', recoveredSessionId] });
      }
      void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
      activeExecutionRef.current = null;
      setActiveExecution(null);
      if (executionStorageKey) localStorage.removeItem(executionStorageKey);
      if (executionPointerKey) localStorage.removeItem(executionPointerKey);
      setAgentStage(null);
      return;
    }
    if (activeExecutionStatus.status === 'paused' || activeExecutionStatus.status === 'failed') {
      setAgentStage('Execution paused — ready to resume from its durable checkpoint');
    } else if (activeExecutionStatus.status === 'running' && !isSending && !isTaskSending) {
      setAgentStage('Execution is still running on the server…');
    }
  }, [
    activeExecutionStatus?.status,
    activeExecution?.id,
    activeExecution?.sessionId,
    isSending,
    isTaskSending,
    qc,
    selectedProjectId,
    sessionId,
    executionPointerKey,
    executionStorageKey,
  ]);

  function clearLiveActivityEvents() {
    agentActivityIdRef.current = 0;
    agentActivityEventsRef.current = [];
    setAgentActivityEvents([]);
  }

  function clearExecutionScopedState(options?: { preserveBuildPending?: boolean }) {
    streamOwnerRef.current = null;
    activeExecutionRef.current = null;
    setActiveExecution(null);
    setExecutionNodes([]);
    setOperationId(undefined);
    setOperationMode(undefined);
    setCommitReadyPaths([]);
    setCommitProposalId(undefined);
    setPushReady(false);
    if (!options?.preserveBuildPending) {
      setPlanBuildPending(null);
      setPlanDecisionPending(null);
    }
  }

  function appendLiveActivityEvent(
    event: Omit<LiveAgentActivityEvent, 'id'>,
  ): number {
    const id = agentActivityIdRef.current++;
    const next = [
      ...agentActivityEventsRef.current,
      { ...event, id },
    ].slice(-160);
    agentActivityEventsRef.current = next;
    setAgentActivityEvents(() => next);
    return id;
  }

  function resetStructuredTaskState() {
    setAgentStage(null);
    setAgentSteps([]);
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setExecutionNodes([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
  }

  function structuredTaskStageLabel(stage: string): string {
    switch (stage) {
      case 'building-context':
        return 'Building project context';
      case 'calling-model':
        return 'Calling AI model';
      case 'persisting-result':
        return 'Saving result';
      case 'completed':
        return 'Task completed';
      default:
        return stage.replace(/[-_]/g, ' ');
    }
  }

  function startStructuredTask(task: 'analyze' | 'review', prompt: string) {
    if (!selectedProjectId || isTaskSending) return;
    const placeholderId = `${task}-placeholder`;
    const title = task === 'analyze' ? 'Analyzing scan…' : 'Reviewing code…';
    const startLabel = task === 'analyze' ? 'Starting scan analysis' : 'Starting code review';

    setLocalMessages((prev) => [
      ...prev,
      { id: placeholderId, role: 'user' as const, content: prompt, createdAt: new Date().toISOString() },
    ]);
    setAgentStage(title);
    setAgentSteps([]);
    clearLiveActivityEvents();
    appendLiveActivityEvent({ kind: 'stage', label: startLabel, status: 'info' });
    setAgentIter(null);
    setAgentModel(null);
    setStreamingContent('');
    setAgentStartedAt(Date.now());
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);

    void taskStreamSend({ projectId: selectedProjectId, task }, {
      onTaskStarted: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: `${event.task === 'analyze' ? 'Analysis' : 'Review'} task accepted`,
          status: 'done',
        });
      },
      onStage: (stage) => {
        const label = structuredTaskStageLabel(stage);
        setAgentStage(label);
        appendLiveActivityEvent({ kind: 'stage', label, status: stage === 'completed' ? 'done' : 'active' });
      },
      onTaskProgress: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: event.message,
          detail: event.provider,
          status: 'info',
        });
      },
      onModelCall: (event) => {
        setAgentModel(event.model);
        setAgentModelHistory((previous) => (
          previous.some((model) => model.id === event.model && model.provider === event.provider)
            ? previous
            : [...previous, { id: event.model, provider: event.provider }]
        ));
        appendLiveActivityEvent({
          kind: 'model',
          label: 'Model response',
          detail: `${event.model} · ${event.provider}`,
          status: 'info',
        });
      },
      onTaskDone: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: task === 'analyze' ? 'Analysis result received' : 'Review result received',
          status: 'done',
        });
        const activityEvents = agentActivityEventsRef.current;
        resetStructuredTaskState();
        setLocalMessages((prev) => [
          ...prev.filter((message) => message.id !== placeholderId),
          {
            id: `${task}-${Date.now()}`,
            role: 'assistant' as const,
            content: task === 'analyze'
              ? formatScanAnalysis(event.result as unknown as AiScanAnalysis)
              : formatCodeReview(event.result as unknown as AiCodeReview),
            activityEvents,
            createdAt: new Date().toISOString(),
          },
        ]);
      },
      onError: (err) => {
        resetStructuredTaskState();
        setLocalMessages((prev) => prev.filter((message) => message.id !== placeholderId));
        toast({
          title: task === 'analyze' ? 'Analysis failed' : 'Code review failed',
          description: describeStreamError(err),
          variant: 'destructive',
        });
      },
    });
  }

  const { data: activeProvider } = useGetActiveProvider<ActiveProvider>({
    query: {
      queryKey: ['active-provider'],
      staleTime: 30_000,
    },
  });

  // PR-06: poll runtime health metrics so provider cards show live state
  const { data: metricsData } = useGetAiMetrics<MetricsResponse>({
    query: {
      queryKey: ['ai-metrics'],
      staleTime: 15_000,
      refetchInterval: 30_000,
      enabled: isLoaded,
    },
  });
  const metricsMap = new Map(
    (metricsData?.metrics ?? []).map((m) => [m.provider, m]),
  );

  // G-06 fix: pending changes are stored with a timestamp so stale entries
  // (from a crashed/closed tab after the server wrote the files but before
  // onSuccess could clear them) expire automatically after 24 hours instead
  // of becoming permanent phantom items.
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  type StoredPending = { changes: PendingChange[]; savedAt: number };
  const pendingKey = sessionId ? `eos_pending_${sessionId}` : undefined;
  const verificationKey = sessionId ? `eos_verification_${sessionId}` : undefined;

  useEffect(() => {
    if (!pendingKey || !verificationKey) return;
    if (pendingChanges.length > 0) {
      const payload: StoredPending = { changes: pendingChanges, savedAt: Date.now() };
      localStorage.setItem(pendingKey, JSON.stringify(payload));
    } else {
      localStorage.removeItem(pendingKey);
    }
    if (Object.keys(verificationResults).length > 0) {
      localStorage.setItem(verificationKey, JSON.stringify(verificationResults));
    } else {
      localStorage.removeItem(verificationKey);
    }
  }, [pendingChanges, pendingKey, verificationKey, verificationResults]);

  useEffect(() => {
    if (!sessionId) {
      setPendingChanges([]);
      setVerificationResults({});
      return;
    }
    if (!pendingKey || !verificationKey) return;
    const storedVerification = localStorage.getItem(verificationKey);
    if (storedVerification) {
      try {
        setVerificationResults(JSON.parse(storedVerification) as Record<string, BehavioralVerification>);
      } catch {
        localStorage.removeItem(verificationKey);
        setVerificationResults({});
      }
    } else {
      setVerificationResults({});
    }
    const raw = localStorage.getItem(pendingKey);
    if (!raw) { setPendingChanges([]); return; }
    try {
      const stored = JSON.parse(raw) as StoredPending | PendingChange[];
      // Handle both the old format (plain array) and the new format ({ changes, savedAt }).
      const changes = Array.isArray(stored) ? stored : stored.changes;
      const savedAt  = Array.isArray(stored) ? 0       : stored.savedAt;
      if (Date.now() - savedAt > PENDING_TTL_MS) {
        // Entry is older than 24 h — the server almost certainly already wrote
        // those files.  Remove the ghost entry rather than confusing the user.
        localStorage.removeItem(pendingKey);
        setPendingChanges([]);
        return;
      }
      if (changes.length > 0) setPendingChanges(changes);
    } catch {
      localStorage.removeItem(pendingKey);
    }
  }, [pendingKey, sessionId, verificationKey]);

  // Use the generated hook (same URL and auth path as Projects.tsx) so this
  // query uses customFetch — which throws ApiError on non-2xx, preserving the
  // HTTP status through to the error classifier below.
  const {
    data: rawProjects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useListProjects({
    query: {
      queryKey: getListProjectsQueryKey(),
      // Wait for Clerk to finish loading before the very first request so we
      // don't race the browser's own session cookie hydration.
      enabled: isLoaded,
      // Classify each failure to decide whether to retry automatically.
       // Clerk can briefly return 401 while its browser session cookie is
       // refreshed during a long-running AI stream. Retry only when Clerk has
       // already loaded a signed-in user; an unauthenticated 401 remains
       // terminal and is shown as a real session-expiry error.
       retry: (failureCount, err) =>
         isRetryableProjectError(err, failureCount, 2, isLoaded && !!user),
    },
  });
  const projects = (rawProjects as Project[] | undefined) ?? [];

  // Derive a classified failure record once and reuse it in all three places
  // where error text is shown — status, kind, and message are all in one place.
  const projectLoadFailure = projectsError ? classifyProjectError(projectsError) : null;

  // Emit telemetry whenever a project-load failure is first observed.
  // TanStack Query v5 removed onError from query options; useEffect is the
  // correct place for side-effects on state changes.
  useEffect(() => {
    if (projectsError) emitProjectLoadFailed(projectsError, { userId: user?.id });
  }, [projectsError, user?.id]);

  const {
    data: sessions = [],
    isFetched: sessionsFetched,
    isError: sessionsError,
  } = useListAiChatSessions<Session[]>(
    { projectId: selectedProjectId ?? '' },
    {
      query: {
        queryKey: ['ai-sessions', selectedProjectId],
        enabled: isLoaded && !!selectedProjectId,
      },
    },
  );

  const { data: serverMessages = [], isFetched: messagesFetched } = useListAiChatMessages<ChatMessage[]>(
    sessionId ?? '',
    {
      query: {
        queryKey: ['ai-messages', sessionId],
        enabled: isLoaded && !!sessionId,
      },
    },
  );

  const { data: serverProposal } = useGetAiPendingProposal<{
    proposalId: string | null;
    operationId: string | null;
    changes: PendingChange[];
    approvalRequired: boolean;
    revision: number | null;
  }>(
    sessionId ?? '',
    {
      query: {
        queryKey: ['ai-pending-proposal', sessionId],
        enabled: isLoaded && !!sessionId,
      },
    },
  );

  const regenerateReportMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(
        `/api/ai/chat/${encodeURIComponent(sessionId ?? '')}/messages/${encodeURIComponent(messageId)}/mission-correlation-report/regenerate`,
        { method: 'POST', credentials: 'include' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'The historical report could not be regenerated.');
      }
      return payload;
    },
    onSuccess: () => {
      if (sessionId) void qc.invalidateQueries({ queryKey: ['ai-messages', sessionId] });
      void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
      toast({ title: 'Historical report regenerated', description: 'The report is now available from the retained run evidence.' });
    },
    onError: (error) => {
      toast({
        title: 'Report regeneration failed',
        description: error instanceof Error ? error.message : 'The conversation was not changed.',
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!messagesFetched) return;

    // A mission report is optional enrichment on an otherwise useful message.
    // Validate each one independently so one old/corrupt report cannot discard
    // the complete conversation or expose parser details in the UI.
    let hasUnavailableReport = false;
    const safeMessages = serverMessages.map((message) => {
      if (message.missionCorrelationReportError) {
        hasUnavailableReport = true;
        return { ...message, missionCorrelationReport: undefined };
      }
      if (message.missionCorrelationReport === undefined || message.missionCorrelationReport === null) {
        return message;
      }
      try {
        readStoredMissionCorrelationReport(message.missionCorrelationReport);
        return message;
      } catch {
        hasUnavailableReport = true;
        return { ...message, missionCorrelationReport: undefined };
      }
    });
    setHistoricalReportError(
      hasUnavailableReport
        ? 'A historical mission report could not be loaded. Your conversation is still available.'
        : null,
    );
    setLocalMessages(safeMessages);
  }, [messagesFetched, serverMessages]);

  useEffect(() => {
    if (!serverProposal) return;
    setProposalId(serverProposal.proposalId ?? undefined);
    setOperationId(serverProposal.operationId ?? undefined);
    setOperationMode(serverProposal.proposalId ? 'DELIVERY' : undefined);
    setProposalRequiresApproval(serverProposal.approvalRequired === true);
    setProposalRevision(serverProposal.revision ?? undefined);
    // The server is authoritative after a session reload. An empty response
    // means the proposal was rejected/consumed (or never existed), so clear
    // any stale localStorage-backed changes instead of showing an unapprovable
    // card that would submit without a valid proposalId.
    setPendingChanges(serverProposal.changes);
    if (serverProposal.changes.length === 0 && pendingKey && verificationKey) {
      localStorage.removeItem(pendingKey);
      localStorage.removeItem(verificationKey);
      setVerificationResults({});
    }
  }, [serverProposal]);

  // A session belongs to exactly one project. If the selected project's
  // session list has been fetched and no longer contains the active session,
  // fail closed instead of sending that session ID with a different project.
  useEffect(() => {
    const sessionOwnsRecoveredExecution = Boolean(
      activeExecution
      && activeExecution.projectId === selectedProjectId
      && activeExecution.sessionId === sessionId,
    );
    if (
      !sessionsFetched ||
      sessionsError ||
      !sessionId ||
      sessionOwnsRecoveredExecution ||
      sessions.some((session) => session.id === sessionId)
    ) {
      return;
    }
    setSessionId(undefined);
    setLocalMessages([]);
    setPendingChanges([]);
    setProposalId(undefined);
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
    setVerificationResults({});
    clearExecutionScopedState();
  }, [
    activeExecution?.projectId,
    activeExecution?.sessionId,
    selectedProjectId,
    sessions,
    sessionsError,
    sessionsFetched,
    sessionId,
  ]);

  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  /** Map server-side stage identifiers to user-facing labels. */
  const STAGE_LABELS: Record<string, string> = {
    'building-context': 'Building context…',
    'calling-model':    'Calling AI model…',
    'streaming':        'Writing response…',
  };

  /** Translate an AiStreamErrorEvent to a user-facing error description. */
  function describeStreamError(err: AiStreamErrorEvent): string {
    // Reuse describeAiError by constructing a temporary AiApiError from
    // the SSE error event's code → HTTP status mapping.
    const statusForCode: Record<string, number> = {
      RATE_LIMITED: 429,
      model_output_invalid: 422,
      AUTH_ERROR: 401,
      request_failed: 400,
    };
    const tmpErr = new AiApiError(
      statusForCode[err.code] ?? 502,
      err.message,
      err.hint,
      err.code,
    );
    return describeAiError(tmpErr);
  }

  const applyMutation = useAiApplyChanges({
    mutation: {
      onSuccess: (data) => {
        const failed = data.results.filter((r) => !r.ok);
        const succeeded = data.results.filter((r) => r.ok);
        const verificationFor = (result: (typeof data.results)[number]): BehavioralVerification => ({
          status: result.behavioralVerification?.status ?? 'unavailable',
          profile: result.behavioralVerification?.profile,
          scenario: result.behavioralVerification?.scenario,
          detail: result.behavioralVerification?.detail ?? 'No behavioral verification result was returned.',
          conflict: result.conflict ?? undefined,
        });

        if (failed.length > 0) {
          toast({
            title: `${failed.length} file(s) failed to apply`,
            description: failed.map((f) => `${f.path}: ${f.error}`).join('\n'),
            variant: 'destructive',
          });
        }
        if (succeeded.length > 0) {
          const verificationText = succeeded
            .map((r) => `${r.path}: ${verificationFor(r).status}`)
            .join('\n');
          const needsReview = succeeded.filter((r) => verificationFor(r).status !== 'passed');
          toast({
            title: needsReview.length > 0
              ? `Wrote ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''} — review required`
              : `Wrote ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''}`,
            description: needsReview.length > 0
              ? `Persistence verified, but behavioral verification is incomplete.\n${verificationText}`
              : `Persistence and behavioral verification passed.\n${verificationText}`,
          });
        }
        setOperationId(data.correlationId);
        setProposalRequiresApproval(false);
        setProposalRevision(undefined);
        setVerificationResults((prev) => ({
          ...prev,
          ...Object.fromEntries(data.results.map((r) => [r.path, verificationFor(r)])),
        }));
        // A persisted change is removed only after behavioral verification passes.
        // Skipped, failed, or unavailable verification remains visible for review.
        const completedPaths = new Set(
          succeeded
            .filter((r) => verificationFor(r).status === 'passed')
            .map((r) => r.path),
        );
        setPendingChanges((prev) => prev.filter((c) => !completedPaths.has(c.path)));
        if (succeeded.length > 0 && failed.length === 0 && completedPaths.size === succeeded.length) {
          setProposalId(undefined);
          setCommitReadyPaths([...completedPaths]);
          setCommitProposalId(proposalId);
          setPushReady(false);
        } else {
          setCommitReadyPaths([]);
          setCommitProposalId(undefined);
          setPushReady(false);
        }

        // G-05: refresh git-status in the GitPanel so it reflects the newly
        // written files (dirty markers, unstaged changes) without a manual reload.
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
      },
      onError: (err) => {
        toast({ title: 'Failed to apply changes', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const reapprovalMutation = useApproveAiRebasedProposal({
    mutation: {
      onSuccess: () => {
        const changesToApply = reapprovalApplyRef.current;
        reapprovalApplyRef.current = null;
        setProposalRequiresApproval(false);
        if (!changesToApply || !selectedProjectId || !proposalId) return;
        applyMutation.mutate({
          data: {
            changes: changesToApply,
            projectId: selectedProjectId,
            proposalId,
            ...(operationId ? { operationId } : {}),
          },
        });
      },
      onError: (err) => {
        reapprovalApplyRef.current = null;
        toast({
          title: 'Re-approval required',
          description: describeAiError(err),
          variant: 'destructive',
        });
      },
    },
  });

  const rebaseMutation = useAiRebaseChanges({
    mutation: {
      onSuccess: (data) => {
        const rebasedChanges = data.changes as PendingChange[];
        setPendingChanges(rebasedChanges);
        setProposalRequiresApproval(data.approvalRequired === true);
        setProposalRevision(data.revision);
        setVerificationResults((prev) => {
          const next = { ...prev };
          for (const change of rebasedChanges) delete next[change.path];
          return next;
        });
        setCommitReadyPaths([]);
        setCommitProposalId(undefined);
        setPushReady(false);
        toast({
          title: 'Patch rebased for review',
          description: `${data.rebasedFiles.length} file${data.rebasedFiles.length !== 1 ? 's' : ''} matched the current workspace. Review and approve the new diff before applying.`,
        });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', sessionId] });
      },
      onError: (err) => {
        toast({
          title: 'Patch could not be rebased',
          description: describeAiError(err),
          variant: 'destructive',
        });
      },
    },
  });

  const commitMutation = useGitCommit({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: 'Changes committed',
          description: data.output || 'The verified changes were committed successfully.',
        });
        setCommitReadyPaths([]);
        setCommitProposalId(undefined);
        setPushReady(true);
        setOperationId(data.correlationId);
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
      },
      onError: (err) => {
        toast({ title: 'Failed to create commit', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const pushMutation = useGitPush({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: 'Changes pushed',
          description: data.output || `Branch ${data.branch} was pushed successfully.`,
        });
        setPushReady(false);
        setOperationId(data.correlationId);
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
      },
      onError: (err) => {
        toast({ title: 'Failed to push changes', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const rejectMutation = useRejectAiChangeProposal({
    mutation: {
      onSuccess: () => {
        setPendingChanges([]);
        setProposalId(undefined);
        setOperationId(undefined);
      },
      onError: (err) => {
        toast({ title: 'Failed to reject proposal', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleApplyChanges(changes: PendingChange[]) {
    if (!selectedProjectId || !proposalId) {
      toast({
        title: 'Proposal unavailable',
        description: 'Refresh the chat before applying these changes.',
        variant: 'destructive',
      });
      return;
    }
    const approvedChanges = changes.filter(hasValidationProfile);
    if (approvedChanges.length !== changes.length) {
      toast({
        title: 'Validation required',
        description: 'One or more changes are not eligible for approval yet.',
        variant: 'destructive',
      });
      return;
    }
    if (proposalRequiresApproval) {
      if (proposalRevision === undefined) {
        toast({
          title: 'Proposal revision unavailable',
          description: 'Refresh the chat before approving this rebased patch.',
          variant: 'destructive',
        });
        return;
      }
      reapprovalApplyRef.current = approvedChanges;
      reapprovalMutation.mutate({
        proposalId,
        data: {
          projectId: selectedProjectId,
          revision: proposalRevision,
        },
      });
      return;
    }
    applyMutation.mutate({
      data: {
        changes: approvedChanges,
        projectId: selectedProjectId,
        proposalId,
        ...(operationId ? { operationId } : {}),
      },
    });
  }

  function handleRebaseChanges(changes: PendingChange[]) {
    if (!selectedProjectId || !proposalId) {
      toast({
        title: 'Proposal unavailable',
        description: 'Refresh the chat before rebasing this patch.',
        variant: 'destructive',
      });
      return;
    }
    rebaseMutation.mutate({
      data: {
        projectId: selectedProjectId,
        proposalId,
        changes,
      },
    });
  }

  function handleRejectProposal() {
    if (!proposalId) {
      setPendingChanges([]);
      return;
    }
    rejectMutation.mutate({ proposalId });
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
  }

  function handleCommitVerifiedChanges() {
    if (!selectedProjectId || commitReadyPaths.length === 0) return;
    if (!commitMessage.trim()) {
      toast({ title: 'Commit message required', description: 'Enter a commit message before committing.', variant: 'destructive' });
      return;
    }
    commitMutation.mutate({
      projectId: selectedProjectId,
      data: {
        message: commitMessage.trim(),
        proposalId: commitProposalId,
        ...(operationId ? { operationId } : {}),
      },
    });
  }

  function handlePushCommittedChanges() {
    if (!selectedProjectId || !pushReady) return;
    const traceData = {
      ...(commitProposalId ? { proposalId: commitProposalId } : {}),
      ...(operationId ? { operationId } : {}),
    };
    pushMutation.mutate(
      Object.keys(traceData).length > 0
        ? { projectId: selectedProjectId, data: traceData }
        : { projectId: selectedProjectId },
    );
  }

  /** Core send — accepts a pre-trimmed message string. Used by handleSend and
   *  handleQuickAction so both paths share the same streaming logic. */
  function sendMessage(
    msg: string,
    options?: {
      buildPlanMessageId?: string;
      executionId?: string;
      resumeToken?: string;
    },
  ) {
    if (!msg.trim()) return;
    if (!selectedProjectId) {
      toast({ title: 'No project selected', description: 'Select a project first to start chatting.', variant: 'destructive' });
      return;
    }
    if (isSending) return;
    const generation = ++streamGenerationRef.current;
    const requestProjectId = selectedProjectId;
    const requestSessionId = sessionId;
    streamOwnerRef.current = {
      generation,
      projectId: requestProjectId,
      ...(requestSessionId ? { sessionId: requestSessionId } : {}),
      ...(options?.executionId ? { executionId: options.executionId } : {}),
    };
    const ownsStream = (binding?: { sessionId?: string; executionId?: string }) => {
      const owner = streamOwnerRef.current;
      if (
        !owner ||
        owner.generation !== generation ||
        owner.projectId !== requestProjectId
      ) return false;
      if (binding?.sessionId && owner.sessionId && binding.sessionId !== owner.sessionId) {
        return false;
      }
      if (
        binding?.executionId &&
        owner.executionId &&
        binding.executionId !== owner.executionId
      ) return false;
      return true;
    };
    setInput('');

    const isResume = Boolean(options?.executionId);
    if (!isResume) {
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        role: 'user',
        content: msg.trim(),
        createdAt: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, optimistic]);
      clearExecutionScopedState({ preserveBuildPending: Boolean(options?.buildPlanMessageId) });
      streamOwnerRef.current = {
        generation,
        projectId: requestProjectId,
        ...(requestSessionId ? { sessionId: requestSessionId } : {}),
      };
    }
    setAgentStage('Connecting…');
    setStreamingContent('');
    setAgentSteps([]);
    clearLiveActivityEvents();
    appendLiveActivityEvent({ kind: 'stage', label: 'Connecting to the AI stream', status: 'info' });
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(Date.now());
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);

    void streamSend(
      {
        projectId: requestProjectId,
        message: msg.trim(),
        sessionId,
        linkedTaskId,
        buildPlanMessageId: options?.buildPlanMessageId,
         executionId: options?.executionId,
         resumeToken: options?.resumeToken,
      },
      {
        onExecutionStarted: (event) => {
          if (!ownsStream({ executionId: event.executionId })) return;
          const owner = streamOwnerRef.current!;
          owner.executionId = event.executionId;
          const next = {
            id: event.executionId,
             projectId: requestProjectId,
             ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
            ...(event.resumeToken ? { resumeToken: event.resumeToken } : {}),
            message: msg.trim(),
            ...(options?.buildPlanMessageId ? { buildPlanMessageId: options.buildPlanMessageId } : {}),
          };
          activeExecutionRef.current = next;
          setActiveExecution(next);
          appendLiveActivityEvent({
            kind: 'stage',
            label: 'Durable execution reserved',
            detail: event.executionId.slice(0, 8),
            status: 'info',
          });
        },
        onExecutionNodes: (event) => {
          if (!ownsStream({ executionId: event.executionId })) return;
          setExecutionNodes(event.nodes);
          appendLiveActivityEvent({
            kind: 'stage',
            label: 'Execution plan loaded',
            detail: `${event.nodes.length} node${event.nodes.length === 1 ? '' : 's'}`,
            status: 'info',
          });
        },
        onSessionStarted: (event) => {
          if (!ownsStream({ sessionId: event.sessionId })) return;
          streamOwnerRef.current!.sessionId = event.sessionId;
          setSessionId(event.sessionId);
          qc.setQueryData<Session[]>(
            ['ai-sessions', requestProjectId],
            (previous = []) => [
              {
                id: event.sessionId,
                title: event.title,
                updatedAt: event.updatedAt,
              },
              ...previous.filter((session) => session.id !== event.sessionId),
            ],
          );
        },
        onStage: (stage) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentStage(STAGE_LABELS[stage] ?? stage);
          appendLiveActivityEvent({
            kind: 'stage',
            label: 'Stage',
            detail: STAGE_LABELS[stage] ?? stage,
            status: 'info',
          });
        },
        onDelta: (delta) => {
          if (generation !== streamGenerationRef.current) return;
          setStreamingContent((prev) => prev + delta);
        },
        onStreamReset: () => {
          if (generation !== streamGenerationRef.current) return;
          // GAP-A2: SSE stream broke mid-flight — clear the partial bubble so
          // the full fallback response in the subsequent `done` event is shown
          // cleanly without a flash of inconsistent partial content.
          setStreamingContent('');
        },
        onToolCall: (event) => {
          if (generation !== streamGenerationRef.current) return;
          const activityId = appendLiveActivityEvent({
            kind: 'tool',
            label: liveToolLabel({ tool: event.tool, args: event.args, done: false, cached: event.cached }),
            tool: event.tool,
            status: 'active',
          });
          setAgentSteps((prev) => [...prev, {
            activityId,
            tool: event.tool,
            args: event.args,
            done: false,
            cached: event.cached,
          }]);
        },
        onToolResult: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentSteps((prev) => prev.map((s) =>
            s.tool === event.tool && !s.done
              ? { ...s, done: true, source: event.source, cached: event.cached }
              : s
          ));
           const targetIndex = [...agentActivityEventsRef.current].reverse().findIndex(
              (activity) => activity.kind === 'tool' && activity.status === 'active' &&
                activity.tool === event.tool,
           );
           if (targetIndex >= 0) {
             const index = agentActivityEventsRef.current.length - 1 - targetIndex;
             const next = agentActivityEventsRef.current.map((activity, activityIndex) => activityIndex === index
              ? {
                  ...activity,
                  status: 'done' as const,
                  detail: event.source
                    ? `${event.cached ? 'cached · ' : ''}${event.source}`
                    : event.cached ? 'cached' : activity.detail,
                }
              : activity);
             agentActivityEventsRef.current = next;
             setAgentActivityEvents(next);
           }
        },
        onPlanActivity: (event) => {
          if (generation !== streamGenerationRef.current) return;
          const files = event.files?.slice(0, 12);
          appendLiveActivityEvent({
            kind: 'plan',
            label: `${PLAN_STAGE_LABELS[event.stage] ?? 'Plan activity'}${event.stepTitle ? ` · ${event.stepTitle}` : ''}`,
            detail: event.approvalRequired
              ? `Approval required before changing: ${files?.join(', ') || 'approved files'}`
              : event.resultSummary ?? (event.nextStepTitle ? `Next: ${event.nextStepTitle}` : undefined),
            status: event.status,
          });
        },
        onValidation: (event) => {
          if (generation !== streamGenerationRef.current) return;
           const status = event.validation.status;
           const statusLabel = status === 'passed'
            ? 'passed'
             : status === 'blocked'
              ? 'blocked'
               : status;
          setAgentStage(
            `Validation ${statusLabel} (${event.attempt}/${event.maxAttempts})`,
          );
          appendLiveActivityEvent({
            kind: 'validation',
             label: status === 'passed'
              ? 'Validation passed'
               : status === 'blocked'
                ? 'Validation blocked'
                : 'Validation failed',
            detail: [
               event.validation.profile,
               event.repairState.replace(/_/g, ' '),
              `attempt ${event.attempt}/${event.maxAttempts}`,
               event.validation.exitCode != null ? `exit ${event.validation.exitCode}` : undefined,
               event.validation.detail,
               event.validation.failedTests.length
                 ? `${event.validation.failedTests.length} failed test signal${event.validation.failedTests.length === 1 ? '' : 's'}`
                : undefined,
            ].filter(Boolean).join(' · '),
             status: status === 'passed' ? 'done' : 'info',
          });
        },
         onRepairState: (event) => {
           if (generation !== streamGenerationRef.current) return;
           const label = event.state === 'VALIDATING'
             ? 'Repair loop validating'
             : event.state === 'REPAIRING'
               ? 'Repair correction allowed'
               : event.state === 'READY_FOR_REVIEW'
                 ? 'Ready for review'
                 : 'Repair blocked';
           setAgentStage(label);
           appendLiveActivityEvent({
             kind: 'repair_state',
             label,
             detail: event.detail,
             status: event.state === 'READY_FOR_REVIEW' ? 'done' : event.state === 'VALIDATING' ? 'active' : 'info',
           });
         },
        onModelCall: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentModel(event.model);
          setAgentModelHistory((prev) => (
            prev.some((attempt) => attempt.id === event.model)
              ? prev
              : [...prev, { id: event.model, provider: event.provider }]
          ));
          setAgentStage(`Model response: ${fmtModelId(event.model)}`);
          appendLiveActivityEvent({
            kind: 'model',
            label: 'Model response',
            detail: `${fmtModelId(event.model)} · ${event.provider}`,
            status: 'info',
          });
        },
        onThinking: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentIter({ iter: event.iter, max: event.max });
          appendLiveActivityEvent({
            kind: 'iteration',
            label: 'Model iteration',
            detail: `${event.iter + 1}/${event.max}`,
            status: 'info',
          });
        },
        onExecutionGuard: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentStage(
            event.code === 'REPEATED_TOOL_CALL'
              ? `Execution stopped: repeated ${event.tool}`
              : 'Execution guard stopped the run',
          );
          appendLiveActivityEvent({
            kind: 'guard',
            label: 'Execution guard',
            detail: event.code === 'REPEATED_TOOL_CALL'
              ? `repeated ${event.tool}`
              : event.code,
            status: 'info',
          });
        },
        onSynthesisStart: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setAgentStage(`Synthesizing from gathered evidence (${event.iter + 1}/${event.max})`);
          appendLiveActivityEvent({
            kind: 'synthesis',
            label: 'Synthesis started',
            detail: `${event.iter + 1}/${event.max}`,
            status: 'active',
          });
        },
        onExecutionDiagnostic: (event) => {
          if (generation !== streamGenerationRef.current) return;
          const detail = event.details?.[0];
          const diagnostic = event.code.replace(/^FORENSIC_CONTRACT_/, '').replace(/_/g, ' ').toLowerCase();
          setAgentDiagnostics((prev) => [...prev, detail ? `${diagnostic}: ${detail}` : diagnostic].slice(-4));
          setAgentStage(
            `Execution diagnostic: ${diagnostic}${detail ? ` — ${detail}` : ''}`,
          );
          appendLiveActivityEvent({
             kind: event.code === 'EXECUTION_PHASE_TOOL_REJECTED' ? 'phase_rejection' : 'diagnostic',
             label: event.code === 'EXECUTION_PHASE_TOOL_REJECTED'
               ? 'Phase policy blocked action'
               : 'Execution diagnostic',
             detail: event.code === 'EXECUTION_PHASE_TOOL_REJECTED' && event.phase && event.tool
               ? `${event.tool} rejected during ${event.phase} phase`
               : detail ? `${diagnostic} — ${detail}` : diagnostic,
            status: 'info',
          });
        },
        onForensicStatus: (event) => {
          if (generation !== streamGenerationRef.current) return;
          if (event.isFixtureLocal === true || event.auditScope === 'FIXTURE_LOCAL') {
            setLiveFixtureLocal(true);
          }
          const scopeDescription = (event as typeof event & { scopeDescription?: string }).scopeDescription;
          if (scopeDescription) {
            setLiveAuditScopeDescription(scopeDescription);
          }
        },
        onEvidenceIntegrity: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setLiveEvidenceIntegrity({
            consistent: event.consistent,
            violations: event.violations,
            objectiveType: event.objectiveType,
            requiredEdges: event.requiredEdges ?? [],
            provenEdges: event.provenEdges ?? [],
            completionGateResult: event.completionGateResult,
            finalAnswerType: event.finalAnswerType,
          });
        },
        // Task #58: surface the verdict's proof scope live in the audit panel
        // as soon as the task router decides it — before the report lands.
        onDecisionTrace: (event) => {
          if (generation !== streamGenerationRef.current) return;
          setLiveVerdictScope({
            scope: event.verdictScope,
            findingStatus: event.scopedFindingStatus,
          });
        },
        onDone: (data) => {
          if (!ownsStream({ sessionId: data.sessionId })) return;
           const activityEvents = agentActivityEventsRef.current;
          setAgentStage(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setAgentModel(null);
          setAgentStartedAt(null);
          setAgentElapsedSeconds(0);
          setAgentModelHistory([]);
          setAgentDiagnostics([]);
          setLiveFixtureLocal(false);
          setLiveEvidenceIntegrity(null);
          setLiveVerdictScope(null);
           setLiveAuditScopeDescription(null);
           activeExecutionRef.current = null;
           setActiveExecution(null);
          setSessionId(data.sessionId);
          qc.setQueryData<Session[]>(
            ['ai-sessions', requestProjectId],
            (previous = []) => {
              const existing = previous.find((session) => session.id === data.sessionId);
              return [
                {
                  id: data.sessionId,
                  title: existing?.title ?? data.message.content.slice(0, 60),
                  updatedAt: data.message.createdAt,
                },
                ...previous.filter((session) => session.id !== data.sessionId),
              ];
            },
          );
          setLocalMessages((prev) => {
            const withoutOpt = prev.filter((m) => !m.id.startsWith('opt-'));
            const base = data.message as ChatMessage;
            return [...withoutOpt, {
              ...base,
               activityEvents,
              behaviorEvidence: data.behaviorEvidence ?? base.behaviorEvidence ?? null,
              taskResult: (data.taskResult as AiTaskResult | undefined) ?? null,
              operationMode: inferOperationMode({
                operationMode: data.operationMode,
                taskResult: data.taskResult as AiTaskResult | undefined,
                proposalId: data.proposalId,
              }),
            }];
          });
          setPendingChanges(data.pendingChanges ?? []);
          setProposalId(data.proposalId ?? undefined);
           const nextOperationMode = inferOperationMode({
             operationMode: data.operationMode,
             taskResult: data.taskResult as AiTaskResult | undefined,
             proposalId: data.proposalId,
           });
           setOperationMode(nextOperationMode);
           setOperationId(
             nextOperationMode === 'DELIVERY'
               ? data.operationId ?? (data.proposalId ? data.message.id : undefined)
               : undefined,
           );
          // STORY-04: update displayed model from the done event
          if (data.resolvedModel) setLastResolvedModel(data.resolvedModel);
          streamOwnerRef.current = null;
          void qc.invalidateQueries({ queryKey: ['ai-sessions', requestProjectId] });
        },
        onError: (err) => {
          if (!ownsStream(err.executionId ? { executionId: err.executionId } : undefined)) return;
           const resumableDisconnect = err.code === 'network_error' || err.code === 'no_body';
           if (resumableDisconnect && activeExecutionRef.current) {
             setAgentStage('Disconnected — execution saved');
             setAgentStartedAt(null);
             setAgentElapsedSeconds(0);
             toast({
               title: 'AI execution saved',
               description: 'The stream disconnected, but the server kept the execution. Resume it below.',
             });
             return;
           }
          setAgentStage(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setAgentModel(null);
          setAgentStartedAt(null);
          setAgentElapsedSeconds(0);
          setAgentModelHistory([]);
          setAgentDiagnostics([]);
          setLiveFixtureLocal(false);
          setLiveEvidenceIntegrity(null);
          setLiveVerdictScope(null);
          setLocalMessages((prev) => prev.filter((m) => !m.id.startsWith('opt-')));
          const failedExecutionId = err.executionId ?? activeExecutionRef.current?.id;
          if (failedExecutionId) {
            void qc.invalidateQueries({ queryKey: ['ai-execution', failedExecutionId] });
          }
          const failedSessionId = activeExecutionRef.current?.sessionId ?? sessionId;
          if (failedSessionId) {
            void qc.invalidateQueries({ queryKey: ['ai-messages', failedSessionId] });
          }
          void qc.invalidateQueries({ queryKey: ['ai-sessions', requestProjectId] });
          toast({ title: 'Failed to send message', description: describeStreamError(err), variant: 'destructive' });
        },
      },
    ).finally(() => {
      if (
        options?.buildPlanMessageId &&
        generation === streamGenerationRef.current
      ) setPlanBuildPending(null);
    });
  }

  function resumeActiveExecution() {
    const execution = activeExecutionRef.current;
    if (!execution?.resumeToken) {
      toast({
        title: 'Resume token unavailable',
        description: 'Refresh the execution status before attempting a resume.',
        variant: 'destructive',
      });
      return;
    }
    sendMessage(execution.message, {
      executionId: execution.id,
      resumeToken: execution.resumeToken,
      buildPlanMessageId: execution.buildPlanMessageId,
    });
  }

  function handleSend() {
    sendMessage(input.trim());
  }

  async function handlePlanDecision(messageId: string, decision: PlanDecision) {
    if (planDecisionPending) return;
    setPlanDecisionPending(messageId);
    try {
      const response = await fetch(
        `/api/ai/chat/plans/${encodeURIComponent(messageId)}/decision`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        taskResult?: AiTaskResult;
      };
      if (!response.ok || !payload.taskResult) {
        throw new Error(payload.error || `Plan decision failed (${response.status})`);
      }

      setLocalMessages((previous) =>
        previous.map((message) =>
          message.id === messageId
            ? { ...message, taskResult: payload.taskResult ?? message.taskResult }
            : message,
        ),
      );
      toast({
        title: decision === 'approve' ? 'Plan approved' : 'Plan rejected',
        description: decision === 'approve'
          ? 'The plan is staged for Build Mode. No files were changed.'
          : 'The plan remains non-executable. No files were changed.',
      });
    } catch (error) {
      toast({
        title: 'Failed to save plan decision',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPlanDecisionPending(null);
    }
  }

  function handlePlanBuild(messageId: string) {
    if (!selectedProjectId || !sessionId || isSending || planBuildPending) return;
    const planMessage = localMessages.find((message) => message.id === messageId);
    const plan = planMessage?.taskResult;
    if (
      !plan ||
      plan.kind !== 'IMPLEMENTATION_PLAN_RESULT' ||
      plan.approvalStatus !== 'APPROVED' ||
      plan.writeAccess !== 'APPROVED_FOR_BUILD'
    ) {
      toast({
        title: 'Approval required',
        description: 'Approve this implementation plan before starting Build Mode.',
        variant: 'destructive',
      });
      return;
    }

    setPlanBuildPending(messageId);
    sendMessage('Build the approved implementation plan.', { buildPlanMessageId: messageId });
  }

  /** Quick-action dispatch:
   *  - 'analyze' → POST /api/ai/projects/:id/analyze (structured result rendered in chat)
   *  - 'review'  → POST /api/ai/projects/:id/review  (structured result rendered in chat)
   *  - others    → send the prompt directly through the chat agent
   */
  function handleQuickAction(action: typeof AI_ACTIONS[number]) {
    if (projectsLoading || !selectedProjectId) return;

    if (action.id === 'analyze') {
      startStructuredTask('analyze', action.prompt);
      return;
    }

    if (action.id === 'review') {
      startStructuredTask('review', action.prompt);
      return;
    }

    // 'tasks' and 'workflow' — route through chat agent, send immediately.
    sendMessage(action.prompt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function resetConversationView(options: { forgetCurrentExecution: boolean }) {
    streamGenerationRef.current += 1;
    cancelStream();
    if (options.forgetCurrentExecution && executionPointerKey) {
      localStorage.removeItem(executionPointerKey);
    }
    clearExecutionScopedState();
    setSessionId(undefined);
    setInput('');
    setLocalMessages([]);
    setPendingChanges([]);
    setProposalId(undefined);
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
    setVerificationResults({});
    setAgentStage(null);
    setAgentSteps([]);
    clearLiveActivityEvents();
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
  }

  function newSession() {
    resetConversationView({ forgetCurrentExecution: true });
  }

  // Derive the subtitle shown in the empty-chat state. Each case maps to a
  // specific root cause — no more "session may have expired" for 500 errors.
  function getStatusSubtitle(): string {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return projectLoadFailure.message;
    if (!selectedProjectId) return 'Create or select a project first to start chatting.';
    return 'Ask about your codebase, tasks, metrics, or workflows. I have full context.';
  }

  // Textarea placeholder follows the same classification.
  function getPlaceholder(): string {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return `${projectLoadFailure.message} Try refreshing\u2026`;
    if (!selectedProjectId) return 'Create a project first to start chatting\u2026';
    return 'Ask about your codebase, tasks, or metrics\u2026 (Enter to send)';
  }

  // Send-button title follows the same classification.
  function getSendTitle(): string | undefined {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return projectLoadFailure.message;
    if (!selectedProjectId) return 'Select a project first';
    return undefined;
  }

  const messages = localMessages;
  const isEmpty = messages.length === 0;
  const isAgentBusy = isSending || isTaskSending;
  const showExecutionProof = Boolean(
    activeExecution ||
    pendingChanges.length > 0 ||
    commitReadyPaths.length > 0 ||
    pushReady ||
    operationMode === 'DELIVERY' ||
    agentSteps.length > 0 ||
    liveEvidenceIntegrity ||
    liveFixtureLocal,
  );

  useEffect(() => {
    if (!isAgentBusy || agentStartedAt === null) return;
    const updateElapsed = () => {
      setAgentElapsedSeconds(Math.max(0, Math.floor((Date.now() - agentStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [agentStartedAt, isAgentBusy]);

  function stopActiveRequest() {
    if (!isSending) return;
    streamGenerationRef.current += 1;
    cancelStream();
    setStreamingContent('');
    setAgentStage(null);
    setAgentSteps([]);
    clearLiveActivityEvents();
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
    setLocalMessages((prev) => prev.filter((message) => !message.id.startsWith('opt-')));
    toast({
      title: 'Request stopped',
      description: 'The unfinished AI request was cancelled. No changes were applied.',
    });
  }

  // UI-01: desktop keeps the sessions sidebar visible; mobile uses it as an
  // overlay drawer so it never steals the chat column's usable width.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  );

  return (
    <div className="relative flex h-full min-h-0 min-w-0 max-w-full overflow-hidden">
      {/* UI-01: closeable mobile drawer backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="absolute inset-0 z-20 bg-black/55 md:hidden"
          aria-label="Close sessions backdrop"
        />
      )}

      {/* Sidebar — sessions */}
      {/* UI-01: desktop sidebar; mobile drawer overlays the chat instead of
       * shrinking it to a narrow unreadable column. */}
      <div
        className={`${sidebarOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-30 w-64 max-w-[calc(100vw-1rem)] min-w-0 border-r border-border flex-col shrink-0 bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:flex md:w-56 md:max-w-none md:shadow-none`}
      >
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Sessions</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={newSession}
              aria-label="New session"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            {/* Collapse button — only shown on narrow screens */}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 md:hidden"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Project selector */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => {
                resetConversationView({ forgetCurrentExecution: false });
                setSelectedProjectId(e.target.value);
                if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
              }}
              className="w-full text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground appearance-none pr-6"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 flex flex-col gap-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                aria-label={s.title}
                onClick={() => {
                  streamGenerationRef.current += 1;
                  cancelStream();
                  clearExecutionScopedState();
                  setSessionId(s.id);
                  setLocalMessages([]);
                  setPendingChanges([]);
                  setProposalId(undefined);
                  setProposalRequiresApproval(false);
                  setProposalRevision(undefined);
                  setVerificationResults({});
                  if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
                }}
                className={`text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                  s.id === sessionId
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{s.title}</span>
                  {sessionForensicStatusLabel(s.forensicStatus) && (
                    <span
                      aria-hidden="true"
                      className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium leading-none ${
                        s.forensicStatus === 'INCOMPLETE'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : s.forensicStatus === 'NO_FINDING'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-border bg-secondary text-muted-foreground'
                      }`}
                    >
                      {sessionForensicStatusLabel(s.forensicStatus)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Provider key cards — bottom of sidebar (priority order: OpenRouter → Gemini → DeepSeek → Groq) */}
        <div className="border-t border-border pt-2">
          <OpenRouterKeyCard runtimeMetric={metricsMap.get('openrouter')} />
          <GeminiKeyCard    runtimeMetric={metricsMap.get('gemini')} />
          <DeepSeekKeyCard  runtimeMetric={metricsMap.get('deepseek')} />
          <GroqKeyCard      runtimeMetric={metricsMap.get('groq')} />
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
          {!sidebarOpen && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 md:hidden"
              onClick={() => setSidebarOpen(true)}
              title="Open sessions"
              aria-label="Open sessions"
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}
          <Bot className="w-4 h-4 text-primary" />
          <span className="min-w-0 truncate text-sm font-medium">EngineeringOS AI</span>
          <Badge variant="outline" className="ml-auto max-w-[48%] truncate text-[10px] font-mono sm:text-xs">
            {activeProvider?.provider === 'deepseek'
              ? 'DeepSeek V3'
              : activeProvider?.provider === 'openrouter'
                ? (lastResolvedModel
                    ? `${fmtModelId(lastResolvedModel.id)} · OpenRouter`
                    : 'OpenRouter')
                : activeProvider?.provider === 'gemini'
                  ? 'Gemini 2.5 Flash'
                  : 'Llama 3.3 · Groq'}
          </Badge>
        </div>

        {/* Messages */}
        <ScrollArea className="min-h-0 min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4">
          {historicalReportError && (
            <div role="alert" className="mb-4 flex min-w-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1">{historicalReportError}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => {
                  if (sessionId) {
                    void qc.invalidateQueries({ queryKey: ['ai-messages', sessionId] });
                  }
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium">How can I help with your project?</p>
                <p className={`text-xs text-center max-w-xs ${projectLoadFailure ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {getStatusSubtitle()}
                </p>
              </div>
               <div className="grid w-full max-w-sm grid-cols-2 gap-2">
                {AI_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleQuickAction(action)}
                    disabled={!isLoaded || projectsLoading || !selectedProjectId || (action.id === 'analyze' && isTaskSending) || (action.id === 'review' && isTaskSending)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-xs text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-secondary"
                  >
                    <action.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto min-w-0 w-full max-w-3xl">
               {showExecutionProof && (
                 <AgentExecutionProofPanel
                   execution={activeExecutionStatus}
                   executionId={activeExecution?.id}
                    executionNodes={executionNodes}
                   busy={isAgentBusy}
                   stage={agentStage}
                   elapsedSeconds={agentElapsedSeconds}
                   steps={agentSteps}
                   modelHistory={agentModelHistory}
                   pendingChanges={pendingChanges}
                   commitReadyPaths={commitReadyPaths}
                   pushReady={pushReady}
                   evidenceIntegrity={liveEvidenceIntegrity}
                   isFixtureLocal={liveFixtureLocal}
                   verdictScope={liveVerdictScope}
                 />
               )}
               {operationMode === 'DELIVERY' && operationId && (
                 <OperationTracePanel
                   operationId={operationId}
                   events={operationEvents}
                   isLoading={operationEventsLoading}
                 />
               )}
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  projectId={selectedProjectId}
                   proposalId={proposalId}
                  onPlanDecision={handlePlanDecision}
                  planDecisionPending={planDecisionPending === msg.id}
                  onPlanBuild={handlePlanBuild}
                  planBuildPending={planBuildPending === msg.id}
                  onRegenerateReport={(messageId) => regenerateReportMutation.mutate(messageId)}
                  reportRegenerationPending={regenerateReportMutation.isPending && regenerateReportMutation.variables === msg.id}
                />
              ))}
              {isAgentBusy ? (
                /* Single unified live bubble — steps always visible above streaming text */
                <div className="flex min-w-0 max-w-full gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 max-w-[calc(100%-2.75rem)] rounded-xl rounded-tl-sm border border-border bg-secondary px-3 py-3 flex flex-col gap-2 sm:max-w-[75%] sm:px-4">
                      <LiveAgentActivity
                       stage={agentStage}
                       steps={agentSteps}
                       activityEvents={agentActivityEvents}
                       iter={agentIter}
                       model={agentModel}
                       streamingContent={streamingContent}
                       busy={isAgentBusy}
                       elapsedSeconds={agentElapsedSeconds}
                       onCancel={isSending ? stopActiveRequest : undefined}
                       modelHistory={agentModelHistory}
                       diagnostics={agentDiagnostics}
                       isFixtureLocal={liveFixtureLocal}
                       verdictScope={liveVerdictScope ?? undefined}
                        auditScopeDescription={liveAuditScopeDescription ?? undefined}
                     />
                     {/* NI-35: live EI-012 reconciliation indicator during the stream */}
                     {liveEvidenceIntegrity && (
                       <div className={`mt-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${
                         liveEvidenceIntegrity.consistent
                           ? 'border-green-500/30 bg-green-500/5 text-green-200'
                           : 'border-red-500/30 bg-red-500/5 text-red-200'
                       }`}>
                         {liveEvidenceIntegrity.consistent
                           ? <ShieldCheck className="w-3 h-3 shrink-0 text-green-300" />
                           : <ShieldAlert className="w-3 h-3 shrink-0 text-red-300" />}
                         <span className="font-medium">
                           {liveEvidenceIntegrity.consistent ? 'Telemetry consistent' : 'Telemetry inconsistent'}
                         </span>
                         {liveEvidenceIntegrity.violations.length > 0 && (
                           <span className="truncate text-muted-foreground">· {liveEvidenceIntegrity.violations.length} violation{liveEvidenceIntegrity.violations.length === 1 ? '' : 's'}</span>
                         )}
                       </div>
                     )}
                     {/* Recent tool activity stays visible below the summary card. */}
                     {agentSteps.length > 0 && (
                       <div className="flex flex-col gap-1 text-xs font-mono">
                         {agentSteps.slice(-6).map((step, i) => (
                           <div key={`${step.tool}-${i}`} className="flex items-center gap-1.5 leading-5">
                             {step.done ? (
                               <span className="text-green-400 shrink-0">✓</span>
                             ) : (
                               <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                             )}
                             <span className={step.done ? 'text-muted-foreground' : 'text-foreground'}>
                               {liveToolLabel(step)}
                             </span>
                             {step.cached && <span className="text-[10px] text-muted-foreground/60">(cached)</span>}
                           </div>
                         ))}
                       </div>
                     )}
                     {streamingContent && <div className="border-t border-border/50 -mx-1" />}

                    {/* Live streaming text */}
                    {streamingContent && (
                      <div className="min-w-0 max-w-full overflow-hidden prose prose-sm prose-invert [overflow-wrap:anywhere]">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                            li: ({ children }) => <li className="mb-0.5">{children}</li>,
                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                            code: ({ children, className }) => (
                              <code className={`${className ?? ''} ${className ? '' : 'break-all'} bg-black/20 rounded px-1 py-0.5 text-xs font-mono`}>
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => <pre className="mb-2 max-w-full overflow-x-auto rounded bg-black/20 p-2 text-xs font-mono whitespace-pre">{children}</pre>,
                            h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                          }}
                        >
                          {streamingContent}
                        </ReactMarkdown>
                        <span className="inline-block w-0.5 h-3.5 bg-primary align-middle ml-0.5 animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              {pendingChanges.length > 0 && (
                <PendingChangesCard
                  changes={pendingChanges}
                  verificationResults={verificationResults}
                  onApply={handleApplyChanges}
                  onRebase={handleRebaseChanges}
                  onReject={handleRejectProposal}
                  isPending={applyMutation.isPending || reapprovalMutation.isPending}
                  isRebasePending={rebaseMutation.isPending}
                  approvalRequired={proposalRequiresApproval}
                />
              )}
              {commitReadyPaths.length > 0 && pendingChanges.length === 0 && (
                <VerifiedCommitCard
                  paths={commitReadyPaths}
                  message={commitMessage}
                  onMessageChange={setCommitMessage}
                  onCommit={handleCommitVerifiedChanges}
                  isPending={commitMutation.isPending}
                />
              )}
              {pushReady && commitReadyPaths.length === 0 && pendingChanges.length === 0 && (
                <PushCommitCard
                  onPush={handlePushCommittedChanges}
                  isPending={pushMutation.isPending}
                />
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input */}
         <div className="shrink-0 border-t border-border p-3 sm:p-4">
          {activeExecution && !isAgentBusy && (
            <div className="mx-auto mb-3 flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                  {activeExecutionStatus?.status === 'running'
                    ? 'The AI execution is still running on the server'
                    : activeExecutionStatus?.status === 'queued'
                      ? 'The AI execution is queued on the server'
                      : 'A saved AI execution is ready to resume'}
                </div>
                <div className="truncate text-muted-foreground">
                  Execution {activeExecution.id.slice(0, 8)}… · no file changes were applied automatically
                </div>
              </div>
              {(activeExecutionStatus?.status === 'paused' ||
                activeExecutionStatus?.status === 'failed' ||
                !activeExecutionStatus) && (
                <Button size="sm" variant="outline" onClick={resumeActiveExecution} className="shrink-0">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Resume
                </Button>
              )}
            </div>
          )}
          <div className="mx-auto flex w-full min-w-0 max-w-3xl items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={applyMutation.isPending ? 'Applying changes… please wait' : isAgentBusy ? 'Working… progress is shown above' : getPlaceholder()}
              className="min-h-[44px] min-w-0 max-h-32 flex-1 resize-none bg-secondary border-border text-sm"
              rows={1}
              disabled={!isLoaded || projectsLoading || !selectedProjectId || applyMutation.isPending || isAgentBusy}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!isLoaded || projectsLoading || !input.trim() || !selectedProjectId || isAgentBusy || applyMutation.isPending}
              className="h-11 w-11 shrink-0"
              title={applyMutation.isPending ? 'Applying changes…' : isAgentBusy ? 'AI is working…' : getSendTitle()}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
