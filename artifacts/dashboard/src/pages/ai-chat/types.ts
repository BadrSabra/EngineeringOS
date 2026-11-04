import type { AiBehaviorEvidence, AiCodeReview, AiExecutionProjection, AiStreamErrorEvent, AiTerminalProjection, BrowserValidationProfile, EvidenceGraph, MissionCorrelationReport, QuerySourceSelectionRecord } from '@workspace/api-client-react';
import type { ExecutionLedgerPublicSnapshot, ForensicDiagnostic } from '@workspace/ai-orchestrator';
import type { AiTaskResult } from './session-state';
import type { LiveAgentActivityEvent } from './live-activity';

export type BrowserValidationProfileFreshness = Pick<
  BrowserValidationProfile,
  'name' | 'freshnessStatus' | 'freshnessReason' | 'currentRevision'
>;

export type AcceptanceNextActionCode =
  | 'NONE'
  | 'RESUME_ALLOWED'
  | 'START_NEW_PROBE'
  | 'REVIEW_INCOMPLETE_EVIDENCE'
  | 'ABANDON_EXECUTION'
  | 'RETRY_AFTER_PARSE'
  | 'RETRY_AFTER_TIMEOUT'
  | 'RETRY_AFTER_RATE_LIMIT';

export type AcceptanceDispositionView = {
  reasonCodes: string[];
  outcome: 'FAILED' | 'INTERRUPTED';
  failureKind: string;
  recoveryState: string;
  operatorAction?: string;
  nextActionCode?: AcceptanceNextActionCode;
  retryAfterMs?: number;
  retryAfterSource?: AiStreamErrorEvent['retryAfterSource'];
  retryAt?: string;
  rateLimitScope?: ChatMessage['rateLimitScope'];
};

export type Project = { id: string; name: string; language: string };

export type BenchmarkScorecard = {
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
    status?: 'missing' | 'not_compared' | 'incompatible' | 'regressed' | 'passed';
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

export type ChatMessage = {
  id: string;
  sessionId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  sources?: string;
  toolTrace?: string | null;
  evidenceGraph?: EvidenceGraph | null;
  executionLedger?: ExecutionLedgerPublicSnapshot | null;
  turnIntent?: string | null;
  projectQueryTarget?: {
    mode: 'resolved_target' | 'bounded_unresolved_hint' | 'source_first_discovery';
  } | null;
  projectQueryResponseSource?: 'provider_synthesis' | 'deterministic_fallback';
  projectQueryResponseFallbackReason?: 'synthesis_failed' | 'provider_candidate_incomplete';
  executionId?: string | null;
  outcome?: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerFailureCategory?: AiStreamErrorEvent['providerFailureCategory'];
  rateLimitScope?: 'upstream_shared_pool' | 'provider_credential' | 'account_quota' | 'unknown' | 'project';
  retryAfterMs?: number;
  retryAfterSource?: AiStreamErrorEvent['retryAfterSource'];
  /** Conservative client receipt deadline when the server supplied only Retry-After. */
  retryAt?: string;
  /** Optional persisted release report attached to a historical run. */
  missionCorrelationReport?: MissionCorrelationReport | null;
  /** The API found a non-null persisted report that is not readable by this dashboard. */
  missionCorrelationReportError?: boolean;
  /** Safe operational timeline captured from the live SSE run. */
  activityEvents?: LiveAgentActivityEvent[];
  /** Accepted behavior-evidence excerpts, optionally with an exact source line span. */
  behaviorEvidence?: AiBehaviorEvidence[] | string | null;
  /** AI-008: per-task typed result shared by live SSE and persisted history. */
  taskResult?: AiTaskResult | null;
  /** Allowlisted context health/link projection shared by live and history turns. */
  contextProvenance?: {
    schemaVersion: string;
    intentKind: string;
    revisionLabel: string;
    slices: Array<{
      layer: string;
      source: string;
      status: 'not_requested' | 'empty' | 'loaded' | 'load_failed';
      freshness: 'fresh' | 'stale' | 'missing';
      rowCount: number;
      truncated: boolean;
      failureCode?: string;
      admissionDecision?: string;
      lifetimeStage?: string;
    }>;
    links: {
      returnedCount: number;
      truncated: boolean;
      statuses: string[];
      details: Array<{
        source: string;
        layer: string;
        direction: string;
        status: string;
        freshness: string;
        rowCount: number;
        linkReason: string;
        sourceRefCount: number;
        confidence?: number;
      }>;
    };
    citations: string[];
  };
  /** Server-owned structured review result used for the scope disclosure panel. */
  structuredReview?: AiCodeReview | null;
  operationMode?: OperationMode;
  structuredTask?: 'analyze' | 'review';
  failureKind?: AiStreamErrorEvent['failureKind'];
  retryable?: boolean;
  recoveryState?: 'NONE' | 'REQUIRED' | 'INCOMPLETE';
  acceptanceDisposition?: AcceptanceDispositionView | null;
  terminalProjection?: AiTerminalProjection | null;
  projection?: AiExecutionProjection | null;
  forensicDiagnostic?: ForensicDiagnostic | null;
  /** PR-011: file-level source plan vs actual coverage; present only for PROJECT_QUERY turns. */
  sourceSelectionRecord?: QuerySourceSelectionRecord | null;
  createdAt: string;
};

export type OperationMode = 'FORENSIC_AUDIT' | 'DELIVERY' | 'CHAT';
