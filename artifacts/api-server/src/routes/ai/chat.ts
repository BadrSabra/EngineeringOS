/**
 * AI chat routes.
 *
 * POST /api/ai/chat
 * POST /api/ai/chat/stream
 * GET  /api/ai/chat/sessions
 * GET  /api/ai/chat/:sessionId/messages
 * POST /api/ai/chat/apply-changes
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@workspace/db";
import {
  aiChatSessionsTable,
  aiChatMessagesTable,
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiApplyJournalTable,
  auditLogsTable,
  eventsTable,
  tasksTable,
  browserValidationProfilesTable,
} from "@workspace/db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { walkProject } from "@workspace/scanner";
import {
  buildProjectContext,
  invalidateContextCache,
  contextManifestMatches,
  contextManifestAllowsExecution,
  chat,
  GroqClientError,
  recordRequest,
  recordFailure,
  recordSuccess,
  recordInvalidModel,
  recordLatency,
  recordFallbackSuccess,
  enrichContextWithMemories,
  writeSessionMemories,
  classifyRequest,
  resolveExecutionDecision,
  resolveTurnIntent,
  isWriteCapableTurn,
  isImmediateExecutionRequest,
  isCapabilityProbeRequest,
  isTaskContinuationRequest,
  CONVERSATION_HISTORY_FETCH_MESSAGES,
  buildActiveTaskState,
  buildActiveTaskExecutionPlan,
  isResumableTaskType,
  parseActiveTaskState,
  resumeActiveTaskClassification,
  serializeActiveTaskState,
  touchActiveTaskState,
  mergeActiveTaskEvidence,
  isImplementationPlanContinuation,
  advanceImplementationPlan,
  buildPatchHunks,
  hashPatchBase,
  rebasePatchHunks,
  buildProjectFileManifest,
  buildProjectFileSources,
  deriveFlightDeckState,
  isProvenValidation,
  toPublicValidationResult,
  runRegisteredCommand,
  createServerCapabilityRegistry,
  toPublicRecipeReceipt,
  createExecutionLedger,
  toPublicExecutionLedgerSnapshot,
  deriveForensicDiagnostic,
} from "@workspace/ai-orchestrator";
import type {
  AgentStep,
  ActiveTaskExecutionPlan,
  ExecutionNode,
  CrossFileSemanticTrace,
  ProductionReachabilityTrace,
  ProductionTraceLink,
  RepairLoopState,
  SourceRetrievalTelemetry,
  FilePatchHunk,
  PatchEvidenceLink,
  FlightDeckEvidenceVerdict,
  BrowserValidationBlockReason,
  ValidationResult,
  PublicValidationResult,
  ExecutionLedger,
  ExecutionLedgerPublicSnapshot,
  ExecutionLedgerSnapshot,
  ExecutionTerminalReason,
  ForensicDiagnostic,
  ExecutionPlan,
} from "@workspace/ai-orchestrator";
import type { ValidationProfile } from "@workspace/ai-orchestrator";
import type { QualityFailure } from "@workspace/ai-orchestrator";
import { ListAiChatMessagesResponseItem } from "@workspace/api-zod";
import {
  RepairPlanMetadataSchema,
  type RepairPlanMetadata,
  EvidenceReferenceSchema,
  type EvidenceReference,
  ChatTaskResultSchema,
  type ChatTaskResult,
  ObjectiveContractSchema,
  ValidationProfileSchema,
} from "@workspace/ai-orchestrator";
import { logger } from "../../lib/logger.js";
import { resolveRootPath } from "../../lib/rootpath-validator.js";
import { establishProjectRoot } from "../../lib/project-root.js";
import { tryAdvisoryLock, LockNamespace } from "../../lib/advisory-lock.js";
import {
  getRepairValidationProfile,
  runRepairValidation,
  runRepairPreviewValidation,
  createValidationWorkspace,
  validateRepairValidationScope,
  type PendingValidationChange,
  type RepairVerificationResult,
} from "../../lib/ai-repair-validation.js";
import { PreviewSessionManager, type PreviewBrowser, type PreviewStep } from "../../lib/browser-preview-verification.js";
import {
  AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT,
  AI_EXECUTION_TRACE_LIMIT,
  buildAiExecutionResumeContext,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAutonomousOperationContract,
  createAiExecution,
  failAiExecution,
  getAiExecutionForUser,
  recoverAiExecutionResumeToken,
  parseAiExecutionCheckpoint,
  parseExecutionRequest,
  requestAiExecutionCancel,
  requestAiExecutionRecovery,
  reconcileExecutionNodeCheckpoint,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type AiExecutionCheckpoint,
  type AiExecutionRequestEnvelope,
} from "../../lib/ai-execution-state.js";
import {
  classifyAiTerminalOutcome,
  publicAcceptanceDisposition,
  type AiAcceptanceDisposition,
  type AiTerminalOutcome,
} from "../../lib/ai-terminal-outcome.js";
import { inspectAiChange } from "../../lib/ai-change-guard.js";
import { loadProjectByIdForUser } from "../../middlewares/requireProjectAccess.js";
import { checkProjectRateLimitDb, LLM_RATE_LIMIT } from "../../lib/db-rate-limiter.js";
import {
  requireProvider,
  chatWithFallback,
  handleOrchestratorError,
  redactUserFacingText,
  redactUserFacingValue,
} from "../../lib/ai-route-helpers.js";
import { createProjectAnalysisToolRunner } from "../../lib/ai-analysis-tools.js";
import { scrubHistoricalValidationRecord } from "../../lib/startup-migrations.js";
import {
  createDeliveryWorkspace,
  discardDeliveryWorkspace,
  deliveryWorkspaceExists,
  hashChangeSet,
  hashDeliveryWorkspace,
  hashDeliveryTree,
  DELIVERY_TREE_DIGEST_VERSION,
  atomicallyPromoteFile,
} from "../../lib/delivery-workspace.js";
import { loadOperationEvidence, redactOperationEvidence } from "../../lib/operation-evidence.js";

const FLIGHT_DECK_EVIDENCE_VERDICTS = new Set<FlightDeckEvidenceVerdict>([
  "PROVEN",
  "PARTIAL",
  "UNAVAILABLE",
  "BLOCKED",
  "NOT_RECORDED",
]);

function derivePersistedEvidenceVerdict(params: {
  executionStatus?: string;
  checkpoint: Record<string, unknown>;
  hasPendingProposal: boolean;
}): FlightDeckEvidenceVerdict {
  const explicit = params.checkpoint.evidenceVerdict;
  if (typeof explicit === "string" && FLIGHT_DECK_EVIDENCE_VERDICTS.has(explicit as FlightDeckEvidenceVerdict)) {
    return explicit as FlightDeckEvidenceVerdict;
  }

  const recentSteps = Array.isArray(params.checkpoint.recentSteps)
    ? params.checkpoint.recentSteps
    : [];
  const latestValidation = [...recentSteps]
    .reverse()
    .find((step) => (
      step
      && typeof step === "object"
      && (step as Record<string, unknown>).kind === "validation"
    )) as Record<string, unknown> | undefined;
  const validation = latestValidation?.validation as ValidationResult | undefined;
  const validationStatus = validation?.status;

  if (validationStatus === "passed") {
    return isProvenValidation(validation)
      ? params.hasPendingProposal ? "PARTIAL" : "PROVEN"
      : "BLOCKED";
  }
  if (validationStatus === "unavailable") return "UNAVAILABLE";
  if (validationStatus === "failed" || validationStatus === "blocked") return "BLOCKED";
  if (params.executionStatus === "failed") return "BLOCKED";
  return "NOT_RECORDED";
}

// ── AI-02: Last-resort response sanitizer ────────────────────────────────────
// Even if the AI orchestrator has its own normalisation layer, a JSON envelope
// may slip through (e.g. a provider returns {"response":"...","sources":[...]}).
// This guard sits at the storage + SSE boundary so nothing reaches the DB or
// the client without being cleaned first.
function sanitizeResponseText(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  // Only attempt extraction when the value looks like a JSON object that
  // wraps a string `response` field — not for ordinary markdown/text.
  if (!trimmed.startsWith("{")) return redactUserFacingText(raw);
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)["response"] === "string"
    ) {
      const inner = ((parsed as Record<string, unknown>)["response"] as string).trim();
      logger.warn({ scope: "chat-route", action: "sanitize_envelope", preview: trimmed.slice(0, 120) }, "AI-02: stripped JSON envelope from response before storage");
      return redactUserFacingText(inner || raw);
    }
  } catch {
    // Not valid JSON — leave as-is.
  }
  return redactUserFacingText(raw);
}

function parseRepairPlanMetadata(value: string | null): RepairPlanMetadata[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = z.array(RepairPlanMetadataSchema).max(12).safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseStoredJson(value: unknown): unknown {
  if (!value) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function serializeRepairPlanMetadata(value: RepairPlanMetadata[] | undefined): string | null {
  return value && value.length > 0
    ? JSON.stringify(redactUserFacingValue(value))
    : null;
}

function parseBehaviorEvidence(value: string | null | undefined): EvidenceReference[] | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = z.array(EvidenceReferenceSchema).max(8).safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function serializeBehaviorEvidence(value: EvidenceReference[] | undefined): string | null {
  return value && value.length > 0
    ? JSON.stringify(redactUserFacingValue(value))
    : null;
}

function parseTaskResult(value: string | null | undefined): ChatTaskResult | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = ChatTaskResultSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function serializeTaskResult(value: ChatTaskResult | undefined): string | null {
  return value ? JSON.stringify(redactUserFacingValue(value)) : null;
}

const StoredMissionCorrelationReportSchema =
  ListAiChatMessagesResponseItem.shape.missionCorrelationReport;

function parseMissionCorrelationReportForHistory(value: string | null | undefined): {
  report?: unknown;
  unavailable: boolean;
} {
  if (value === null || value === undefined) return { report: value, unavailable: false };
  const parsed = parseStoredJson(value);
  if (parsed === undefined) return { unavailable: true };
  const result = StoredMissionCorrelationReportSchema.safeParse(parsed);
  return result.success
    ? { report: projectMissionCorrelationReportForExport(result.data), unavailable: false }
    : { unavailable: true };
}

const REPORT_REGENERATION_MAX_MESSAGES = 100;
const REPORT_REGENERATION_MAX_EVENTS = 500;

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  const parsed = value ? parseStoredJson(value) : undefined;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function publicQualityFailure(value: QualityFailure): QualityFailure {
  const score = Number.isFinite(value.score) ? Math.max(0, Math.min(1, value.score)) : 0;
  const threshold = Number.isFinite(value.threshold) ? Math.max(0, Math.min(1, value.threshold)) : 1;
  return {
    code: "QUALITY_REVIEW_LOW",
    score: Number(score.toFixed(4)),
    threshold: Number(threshold.toFixed(4)),
    reasons: (Array.isArray(value.reasons) ? value.reasons : [])
      .filter((reason): reason is string => typeof reason === "string")
      .map((reason) => reason.replace(/\s+/g, " ").trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 8),
  };
}

function terminalMetadataFromTrace(value: string | null | undefined): {
  failureKind?: "QUALITY_REVIEW" | "TOOL_FAILURE" | "CANCELLATION" | "RECOVERY_FAILURE" | "INCOMPLETE";
  retryable?: boolean;
  recoveryState?: "NONE" | "REQUIRED" | "INCOMPLETE";
  forensicDiagnostic?: ForensicDiagnostic;
  acceptanceDisposition?: AiAcceptanceDisposition;
} {
  const parsed = value ? parseStoredJson(value) : undefined;
  if (!Array.isArray(parsed)) return {};
  const terminal = [...parsed].reverse().find((entry) =>
    entry && typeof entry === "object" && (entry as Record<string, unknown>).kind === "terminal_outcome",
  ) as Record<string, unknown> | undefined;
  const failureKind = terminal?.failureKind;
  const forensicDiagnostic = deriveForensicDiagnostic(parsed);
  const acceptanceDisposition = publicAcceptanceDisposition({
    value: terminal?.acceptanceDisposition,
    code: terminal?.code,
    outcome: terminal?.outcome,
    failureKind,
    recoveryState: terminal?.recoveryState,
  });
  return {
    ...(failureKind === "QUALITY_REVIEW"
      || failureKind === "TOOL_FAILURE"
      || failureKind === "CANCELLATION"
      || failureKind === "RECOVERY_FAILURE"
      || failureKind === "INCOMPLETE"
        ? { failureKind }
        : {}),
    ...(typeof terminal?.retryable === "boolean" ? { retryable: terminal.retryable } : {}),
    ...(
      terminal?.recoveryState === "NONE"
      || terminal?.recoveryState === "REQUIRED"
      || terminal?.recoveryState === "INCOMPLETE"
        ? { recoveryState: terminal.recoveryState }
        : {}
    ),
    ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
    ...(acceptanceDisposition ? { acceptanceDisposition } : {}),
  };
}

function boundedPublicErrorCode(value: string | null | undefined): string | null {
  return typeof value === "string"
    && /^[A-Za-z][A-Za-z0-9_]{2,79}$/.test(value)
    ? value
    : null;
}

function safePublicDiagnosticDetails(details: readonly string[] | undefined): string[] {
  return (details ?? [])
    .filter((detail) => !/(?:provider|model|bearer|credential|secret|token|upstream|raw|https?:|\/(?:home|tmp|srv|workspace)\b)/i.test(detail))
    .map((detail) => redactUserFacingText(detail).slice(0, 240))
    .filter(Boolean)
    .slice(0, 8);
}

function projectPublicExecutionSummary<T extends { diagnosticDetails?: string[] }>(
  summary: T | undefined,
  includeSafeDetails: boolean,
): T | undefined {
  if (!summary) return undefined;
  const projected = { ...summary } as T;
  // Source retrieval telemetry includes read paths and is server-side
  // observability, not part of the terminal client contract.
  delete (projected as T & { sourceRetrieval?: unknown }).sourceRetrieval;
  // Provider/model routing is server diagnostics, not user-facing execution
  // evidence. Older summaries are scrubbed here as well as at write time.
  delete (projected as T & { modelsUsed?: unknown; recoveryModelsUsed?: unknown }).modelsUsed;
  delete (projected as T & { modelsUsed?: unknown; recoveryModelsUsed?: unknown }).recoveryModelsUsed;
  if (!includeSafeDetails || summary.diagnosticDetails === undefined) {
    delete projected.diagnosticDetails;
    return projected;
  }
  const safeDetails = safePublicDiagnosticDetails(summary.diagnosticDetails);
  if (safeDetails.length > 0) {
    projected.diagnosticDetails = safeDetails;
  } else {
    delete projected.diagnosticDetails;
  }
  return projected;
}

function executionLedgerMode(intent: { kind: string }): "simple_chat" | "tool_chat" | "forensic" | "repair_plan" | "hierarchical" {
  if (intent.kind === "FORENSIC_AUDIT") return "forensic";
  if (intent.kind === "DELIVERY") return "repair_plan";
  if (intent.kind === "CHAT") return "simple_chat";
  return "tool_chat";
}

function finishExecutionLedger(
  ledger: ExecutionLedger,
  params: {
    outcome?: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
    trace?: AgentStep[];
  } = {},
): ExecutionLedgerPublicSnapshot {
  const existing = ledger.snapshot().terminalReason;
  if (!existing) {
    const lastDone = [...(params.trace ?? [])].reverse().find((step) => step.kind === "done") as
      | (Extract<AgentStep, { kind: "done" }> & { stopReason?: string })
      | undefined;
    const stopReason = lastDone?.stopReason;
    const reason: ExecutionTerminalReason =
      ledger.signal.aborted
        ? (Date.now() >= ledger.deadlineAt ? "deadline" : "cancelled")
        : params.outcome === "INTERRUPTED"
          ? "cancelled"
          : stopReason === "iteration_budget"
            ? "model_budget"
            : stopReason === "tool_failure"
              ? "failed"
              : stopReason === "provider_timeout"
                ? "deadline"
                : params.outcome && params.outcome !== "SUCCEEDED"
                  ? "failed"
                  : "completed";
    ledger.setTerminal(reason);
  }
  return toPublicExecutionLedgerSnapshot(ledger.snapshot());
}

function appendExecutionLedgerTrace(
  serializedTrace: string | null | undefined,
  snapshot: ExecutionLedgerPublicSnapshot,
): string {
  const parsed = parseStoredJson(serializedTrace);
  const entries = Array.isArray(parsed) ? parsed : [];
  return JSON.stringify([...entries, { kind: "execution_ledger", ...snapshot }]);
}

function readExecutionLedgerTrace(value: string | null | undefined): ExecutionLedgerPublicSnapshot | undefined {
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) return undefined;
  const entry = [...parsed].reverse().find(
    (candidate) => candidate && typeof candidate === "object"
      && (candidate as Record<string, unknown>).kind === "execution_ledger",
  );
  if (!entry || typeof entry !== "object") return undefined;
  const candidate = entry as Record<string, unknown>;
  const modes = new Set(["simple_chat", "tool_chat", "forensic", "repair_plan", "hierarchical"]);
  const terminalReasons = new Set([
    "completed", "cancelled", "deadline", "model_budget", "tool_budget",
    "recovery_budget", "provider_exhausted", "failed",
  ]);
  const budgetKeys = [
    "deadlineMs", "modelCalls", "providerAttempts", "toolCalls", "providerChanges",
    "synthesisAttempts", "recoveryAttempts", "plannerCalls", "hierarchicalTasks",
  ];
  const countKeys = [
    "model", "provider_attempt", "tool", "planner", "provider_change",
    "synthesis", "recovery", "hierarchical_task",
  ];
  const isFiniteNumber = (item: unknown): item is number =>
    typeof item === "number" && Number.isFinite(item) && item >= 0;
  const candidateBudget = candidate.budget;
  const candidateCounts = candidate.counts;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.mode !== "string"
    || !modes.has(candidate.mode)
    || !isFiniteNumber(candidate.startedAt)
    || !isFiniteNumber(candidate.deadlineAt)
    || typeof candidate.elapsedMs !== "number"
    || !isFiniteNumber(candidate.elapsedMs)
    || !isFiniteNumber(candidate.remainingMs)
    || !Array.isArray(candidate.providers)
    || !Array.isArray(candidate.models)
    || !candidateBudget
    || typeof candidateBudget !== "object"
    || !candidateCounts
    || typeof candidateCounts !== "object"
    || !budgetKeys.every((key) => isFiniteNumber((candidateBudget as Record<string, unknown>)[key]))
    || !countKeys.every((key) => isFiniteNumber((candidateCounts as Record<string, unknown>)[key]))
    || (candidate.terminalReason !== undefined
      && (typeof candidate.terminalReason !== "string" || !terminalReasons.has(candidate.terminalReason)))
  ) return undefined;
  const snapshot: ExecutionLedgerSnapshot = {
    id: candidate.id,
    mode: candidate.mode as ExecutionLedgerSnapshot["mode"],
    startedAt: candidate.startedAt as number,
    deadlineAt: candidate.deadlineAt as number,
    elapsedMs: candidate.elapsedMs as number,
    remainingMs: candidate.remainingMs as number,
    budget: Object.fromEntries(
      budgetKeys.map((key) => [key, (candidateBudget as Record<string, unknown>)[key]]),
    ) as ExecutionLedgerSnapshot["budget"],
    counts: Object.fromEntries(
      countKeys.map((key) => [key, (candidateCounts as Record<string, unknown>)[key]]),
    ) as ExecutionLedgerSnapshot["counts"],
    providers: candidate.providers.filter((item): item is string => typeof item === "string"),
    models: candidate.models.filter((item): item is string => typeof item === "string"),
    ...(candidate.terminalReason
      ? { terminalReason: candidate.terminalReason as ExecutionTerminalReason }
      : {}),
    events: [],
  };
  return toPublicExecutionLedgerSnapshot(snapshot);
}

/**
 * Redact historical activity without mutating the separately validated
 * execution-ledger snapshot. Generic UUID redaction is still required for
 * ordinary trace entries, but the allowlisted ledger is the public identity
 * shared by live, history, and resume responses.
 */
function redactHistoricalToolTrace(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) {
    return JSON.stringify(redactUserFacingValue(parsed));
  }

  const executionLedger = readExecutionLedgerTrace(value);
  const redactedEntries = redactUserFacingValue(scrubHistoricalValidationRecord(parsed));
  const entries = Array.isArray(redactedEntries)
    ? redactedEntries.filter(
        (entry) => !(
          entry
          && typeof entry === "object"
          && (entry as Record<string, unknown>).kind === "execution_ledger"
        ),
      )
    : [];

  // Invalid historical ledger entries are intentionally dropped rather than
  // exposed through the generic redaction path.
  if (executionLedger) {
    entries.push({ kind: "execution_ledger", ...executionLedger });
  }
  return JSON.stringify(entries);
}

/**
 * Validation receipts are the only proof shape allowed to cross the apply and
 * recovery boundaries. Keep this projection explicit so persisted historical
 * records can never reintroduce commands, output, paths, or diagnostics.
 */
function publicValidationReceipt(
  result: ValidationResult,
  overrides: Partial<Pick<ValidationResult, "status" | "detail" | "reasonCode">> = {},
): PublicValidationResult {
  return toPublicValidationResult({
    ...result,
    ...overrides,
    evidence: {
      ...result.evidence,
      operationId: result.evidence.operationId,
      projectRevision: result.evidence.projectRevision,
      candidateHash: result.evidence.candidateHash,
      changeSetHash: result.evidence.changeSetHash,
      promotedHash: result.evidence.promotedHash,
    },
  });
}

function parsePublicValidationReceipts(value: unknown): PublicValidationResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    // Older records stored one receipt per file. Only retain entries that
    // already satisfy the public contract; never project their raw fields.
    if (
      typeof candidate.profile !== "string"
      || typeof candidate.status !== "string"
      || typeof candidate.scenario !== "string"
      || !("evidence" in candidate)
      || !candidate.evidence
      || typeof candidate.evidence !== "object"
    ) return [];
    const evidence = candidate.evidence as Record<string, unknown>;
    if (
      typeof evidence.evidenceId !== "string"
      || typeof evidence.observedAt !== "string"
      || typeof evidence.artifactRef !== "string"
    ) return [];
    return [{
      profile: candidate.profile,
      status: candidate.status as PublicValidationResult["status"],
      scenario: candidate.scenario,
      exitCode: typeof candidate.exitCode === "number" || candidate.exitCode === null
        ? candidate.exitCode
        : null,
      evidence: {
        evidenceId: evidence.evidenceId,
        observedAt: evidence.observedAt,
        artifactRef: evidence.artifactRef,
        ...(typeof evidence.operationId === "string" ? { operationId: evidence.operationId } : {}),
        ...(typeof evidence.projectRevision === "string" ? { projectRevision: evidence.projectRevision } : {}),
        ...(typeof evidence.treeDigestVersion === "string" ? { treeDigestVersion: evidence.treeDigestVersion } : {}),
        ...(typeof evidence.baseTreeHash === "string" ? { baseTreeHash: evidence.baseTreeHash } : {}),
        ...(typeof evidence.candidateHash === "string" ? { candidateHash: evidence.candidateHash } : {}),
        ...(typeof evidence.changeSetHash === "string" ? { changeSetHash: evidence.changeSetHash } : {}),
        ...(typeof evidence.promotedHash === "string" ? { promotedHash: evidence.promotedHash } : {}),
        ...(typeof evidence.committedTreeHash === "string" ? { committedTreeHash: evidence.committedTreeHash } : {}),
      },
      ...(typeof candidate.reasonCode === "string" ? { reasonCode: candidate.reasonCode as PublicValidationResult["reasonCode"] } : {}),
      ...(typeof candidate.detail === "string" ? { detail: redactUserFacingText(candidate.detail).slice(0, 240) } : {}),
    }];
  });
}

/**
 * Rebuild only the small, redacted correlation envelope from durable evidence.
 * This intentionally does not call a provider or reinterpret assistant prose:
 * an unavailable historical report must never change the conversation.
 */
function buildRegeneratedMissionCorrelationReport(params: {
  projectId: string;
  sessionId: string;
  messageId: string;
  projectUpdatedAt: Date;
  messages: Array<{
    id: string;
    role: string;
    sources: string | null;
    toolTrace: string | null;
    behaviorEvidence: string | null;
    taskResult: string | null;
    outcome: string | null;
    errorCode: string | null;
  }>;
  execution?: {
    id: string;
    operationId: string | null;
    request: string;
    checkpoint: string;
    checkpointVersion: number;
    status: string;
  };
  proposals: number;
  events: Array<{ type: string }>;
}) {
  const target = params.messages.find((message) => message.id === params.messageId);
  if (!target || target.role !== "assistant") {
    throw new Error("Historical mission report target is not eligible.");
  }

  const traces = params.messages.flatMap((message) => {
    const parsed = message.toolTrace ? parseStoredJson(message.toolTrace) : [];
    return Array.isArray(parsed) ? parsed.slice(0, REPORT_REGENERATION_MAX_EVENTS) : [];
  });
  const evidenceCount = params.messages.reduce((total, message) => {
    const behaviorEvidence = message.behaviorEvidence ? parseStoredJson(message.behaviorEvidence) : [];
    const taskResult = message.taskResult ? parseStoredJson(message.taskResult) : undefined;
    const taskEvidence = taskResult && typeof taskResult === "object" && !Array.isArray(taskResult)
      ? (taskResult as { evidence?: unknown }).evidence
      : undefined;
    return total
      + (Array.isArray(behaviorEvidence) ? Math.min(behaviorEvidence.length, 20) : 0)
      + (Array.isArray(taskEvidence) ? Math.min(taskEvidence.length, 20) : 0);
  }, 0);
  const sourceCount = params.messages.reduce((total, message) => {
    const sources = message.sources ? parseStoredJson(message.sources) : [];
    return total + (Array.isArray(sources) ? Math.min(sources.length, 50) : 0);
  }, 0);
  const request = parseJsonRecord(params.execution?.request);
  const operationId = params.execution?.operationId
    ?? (typeof request.operationId === "string" ? request.operationId : undefined)
    ?? params.execution?.id
    ?? params.messageId;
  if (
    !params.execution
    && traces.length === 0
    && evidenceCount === 0
    && sourceCount === 0
    && params.events.length === 0
  ) {
    throw new Error("No retained run evidence is available.");
  }
  const checkpoint = parseJsonRecord(params.execution?.checkpoint);
  const terminalState = params.execution?.status === "cancelled"
    || target.outcome === "INTERRUPTED"
    || traces.some((entry) => entry && typeof entry === "object" && (entry as { stopReason?: unknown }).stopReason === "cancelled")
    ? "CANCELLED"
    : params.execution?.status === "failed" || target.outcome === "FAILED"
      ? "FAILED"
      : "COMPLETED";
  const validationCount = traces.filter((entry) =>
    entry && typeof entry === "object" && (
      (entry as { kind?: unknown }).kind === "validation"
      || (entry as { phase?: unknown }).phase === "validation"
    ),
  ).length + params.events.filter((event) => /validation/i.test(event.type)).length;
  const counts = {
    messages: params.messages.length,
    sseEvents: Math.min(traces.length, REPORT_REGENERATION_MAX_EVENTS),
    executionCheckpoints: params.execution
      ? Math.min(1, Math.max(0, params.execution.checkpointVersion > 0 || Object.keys(checkpoint).length > 0 ? 1 : 0))
      : 0,
    evidence: evidenceCount + sourceCount,
    proposals: params.proposals,
    validation: validationCount,
    correlatedEvents: params.events.length,
  };
  const agreement = {
    execution: Boolean(params.execution),
    messages: counts.messages > 0,
    sse: counts.sseEvents > 0,
    checkpoints: counts.executionCheckpoints > 0,
    dashboard: true,
    evidence: counts.evidence >= 0,
    proposals: counts.proposals >= 0,
    validation: counts.validation >= 0,
  };
  return {
    kind: "mission-correlation-report" as const,
    version: 1 as const,
    redacted: true as const,
    operationId,
    projectId: params.projectId,
    sessionId: params.sessionId,
    generatedAt: new Date().toISOString(),
    workspaceRevision: typeof request.workspaceRevision === "string"
      ? request.workspaceRevision
      : params.projectUpdatedAt.toISOString(),
    terminalState,
    outcomeClass: terminalState === "COMPLETED" ? "success" : "non-success",
    counts,
    agreement,
  };
}

export class MissionCorrelationReportValidationError extends Error {
  readonly code = "mission_correlation_report_invalid";

  constructor() {
    super("Mission correlation report does not match the supported versioned contract.");
    this.name = "MissionCorrelationReportValidationError";
  }
}

/**
 * Validate before any historical report reaches the database. The generated
 * response schema is deliberately the source of truth here; serialising its
 * parsed value also removes fields that are not part of the public contract.
 */
export function serializeMissionCorrelationReport(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  const parsed = StoredMissionCorrelationReportSchema.safeParse(value);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    throw new MissionCorrelationReportValidationError();
  }
  return JSON.stringify(projectMissionCorrelationReportForExport(parsed.data));
}

/**
 * Build the public report projection used by JSON responses and historical
 * audit exports. Keep the optional generatedAt field after schema parsing
 * (Zod coerces it to Date in typed consumers), while applying the normal
 * redaction boundary to identifiers and any provider-derived values.
 */
export function projectMissionCorrelationReportForExport(
  value: unknown,
): Record<string, unknown> {
  const report = value as Record<string, unknown>;
  const normalized = report.generatedAt instanceof Date
    ? { ...report, generatedAt: report.generatedAt.toISOString() }
    : report;
  return redactUserFacingValue(normalized) as Record<string, unknown>;
}

// A turn is persisted only after its provider call completes, but history must
// remain ordered by the time the user submitted each turn. Allocate a unique
// two-millisecond window up front so concurrent completions cannot interleave
// the user/assistant rows or make equal-timestamp ordering database-dependent.
let lastAllocatedTurnTimestamp = 0;
function allocateTurnTimestamps(): { startedAt: Date; assistantAt: Date } {
  const wallClock = Date.now();
  const startedAtMs = Math.max(wallClock, lastAllocatedTurnTimestamp + 2);
  lastAllocatedTurnTimestamp = startedAtMs;
  return {
    startedAt: new Date(startedAtMs),
    assistantAt: new Date(startedAtMs + 1),
  };
}

type ApprovedImplementationPlan = Extract<
  ChatTaskResult,
  { kind: "IMPLEMENTATION_PLAN_RESULT" }
>;

function normalizePlanFilePath(value: string, rootPath: string): string {
  const raw = value.trim().replaceAll("\\", "/");
  const candidate = path.isAbsolute(raw) ? path.relative(rootPath, raw) : raw;
  return path.posix.normalize(candidate).replace(/^(\.\/)+/, "");
}

function safePlanFiles(files: readonly string[] | undefined, rootPath: string | undefined): string[] {
  if (!files) return [];
  return [...new Set(files.map((file) => normalizePlanFilePath(file, rootPath ?? ""))
    .filter((file) => file && file !== "." && !file.startsWith("../") && !path.isAbsolute(file)))]
    .slice(0, 12);
}

function safeForensicTracePath(value: string): string | undefined {
  const raw = value.trim().replaceAll("\\", "/");
  if (!raw || path.isAbsolute(raw)) return undefined;
  const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return undefined;
  }
  return normalized.slice(0, 500);
}

function compoundValidationTargetPaths(message: string): string[] {
  const paths = [...message.matchAll(
    /(?:^|[\s`"'(])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html))\b/giu,
  )]
    .map((match) => safeForensicTracePath(match[1] ?? ""))
    .filter((file): file is string => Boolean(file));
  // A validation-only compound turn may not name a file. "." is the
  // server-owned whole-workspace scope accepted by workspace-typecheck; it
  // does not grant the model any file-write capability.
  return [...new Set(paths.length > 0 ? paths : ["."])].slice(0, 12);
}

function getImplementationPlanScope(
  plan: ApprovedImplementationPlan,
  rootPath: string,
): Set<string> {
  return new Set(
    plan.steps
      .flatMap((step) => step.files)
      .map((file) => normalizePlanFilePath(file, rootPath))
      .filter((file) => file.length > 0 && file !== "." && !file.startsWith("../")),
  );
}

function hasSafeImplementationPlanFileScope(plan: ApprovedImplementationPlan): boolean {
  return plan.steps.some((step) =>
    step.files.some((file) => {
      const normalized = file.trim().replaceAll("\\", "/");
      return normalized.length > 0 &&
        normalized !== "." &&
        !normalized.startsWith("/") &&
        !normalized.startsWith("../") &&
        !normalized.includes("/../");
    }),
  );
}

type PlanContextGateFailure = {
  error: string;
  code: "PLAN_CONTEXT_STALE" | "PLAN_CONTEXT_INCOMPLETE" | "PLAN_FILES_CHANGED";
  reasonCode?: "invalid_profile" | "stale_revision";
};

/**
 * Re-validate the exact context used to create a plan immediately before an
 * approval or Build handoff. This is intentionally a live check: reconnects
 * and dashboard reloads must not turn an old plan into write authorization.
 */
async function validatePlanContextForExecution(
  plan: ApprovedImplementationPlan,
  projectId: string,
  rootPath: string,
): Promise<PlanContextGateFailure | null> {
  if (!plan.contextManifest) {
    return {
      error: "This plan has no verified project context. Complete a fresh scan and rebuild the plan before continuing.",
      code: "PLAN_CONTEXT_INCOMPLETE",
    };
  }

  const currentContext = await buildProjectContext(projectId);
  const currentManifest = currentContext.contextManifest;
  if (!currentManifest) {
    return {
      error: "No verified project context is available. Complete a fresh scan and rebuild the plan before continuing.",
      code: "PLAN_CONTEXT_INCOMPLETE",
    };
  }
  if (!contextManifestAllowsExecution(currentManifest)) {
    return {
      error: "The project scan is incomplete. Complete a fresh scan before approving or starting Build Mode.",
      code: "PLAN_CONTEXT_INCOMPLETE",
    };
  }
  if (!contextManifestMatches(plan.contextManifest, currentManifest)) {
    return {
      error: "This plan was created from stale project context. Complete a fresh scan, rebuild, and explicitly re-approve it.",
      code: "PLAN_CONTEXT_STALE",
    };
  }

  // A source tree can change without a scan. Re-walk it so approval cannot
  // authorize edits against bytes that were not part of the inspected snapshot.
  // Re-establish the persisted root at the point of use. Checking only
  // accessibility leaves a symlink replacement window in which a plan could
  // be approved against a different directory.
  const liveRoot = await establishProjectRoot(rootPath);
  const liveWalk = liveRoot.ok
    ? await walkProject(liveRoot.canonicalPath).catch(() => undefined)
    : undefined;
  if (!liveWalk || liveWalk.revision !== currentManifest.projectRevision) {
    return {
      error: "The project files changed after inspection. Scan again, rebuild, and explicitly re-approve the plan.",
      code: "PLAN_FILES_CHANGED",
    };
  }
  return null;
}

/**
 * Planning must inspect the same source revision represented by the context
 * manifest. The bounded filesystem inventory is useful for grounding paths,
 * but it is not itself a source revision; the scanner walk is the immutable
 * revision contract shared with scan, approval, mutation, and delivery.
 *
 * A mismatch is represented as an unavailable planning inventory so the
 * planner's existing guarded fallback produces an explicitly blocked plan.
 * This avoids asking a provider to plan from a stale or partial snapshot.
 */
async function buildPlanningFilesystemContext(
  baseProjectContext: Awaited<ReturnType<typeof buildProjectContext>>,
  rootPath: string | undefined,
  message: string,
): Promise<Awaited<ReturnType<typeof buildProjectContext>>> {
  const unavailable = (reason: string) => ({
    status: "UNAVAILABLE" as const,
    files: [],
    directories: [],
    packageManifests: [],
    configFiles: [],
    truncated: false,
    reason,
  });
  const unavailableSources = (reason: string) => ({
    status: "UNAVAILABLE" as const,
    files: [],
    truncated: false,
    reason,
  });

  const manifest = baseProjectContext.contextManifest;
  if (!rootPath) {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable("The project root is unavailable; planning is blocked until it is restored."),
      filesystemSources: unavailableSources("The project root is unavailable; no source snapshot can be verified."),
    };
  }
  if (!manifest || manifest.scanCompleteness !== "COMPLETE") {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable("The project scan is incomplete; complete a fresh scan before creating a plan."),
      filesystemSources: unavailableSources("The project scan is incomplete; source excerpts are not planning evidence."),
    };
  }
  // Narrow once after the completeness gate so all subsequent comparisons
  // use the exact manifest that authorized this planning attempt.
  const completeManifest = manifest;

  const rootResult = await establishProjectRoot(rootPath);
  if (!rootResult.ok) {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable(`The project root is unavailable: ${rootResult.reason}.`),
      filesystemSources: unavailableSources("The project root could not be canonically established."),
    };
  }

  const liveWalk = await walkProject(rootResult.canonicalPath).catch(() => undefined);
  if (!liveWalk) {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable("The project source tree could not be read; planning is blocked."),
      filesystemSources: unavailableSources("The project source tree could not be read."),
    };
  }
  if (liveWalk.truncated) {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable("The live source walk is incomplete; planning requires a complete snapshot."),
      filesystemSources: unavailableSources("The live source walk is incomplete."),
    };
  }
  if (liveWalk.revision !== completeManifest.projectRevision) {
    return {
      ...baseProjectContext,
      filesystemManifest: unavailable(
        "The source tree changed after the last scan; complete a fresh scan before creating a plan.",
      ),
      filesystemSources: unavailableSources(
        "The source tree revision is stale relative to the context snapshot.",
      ),
    };
  }

  const filesystemManifest = await buildProjectFileManifest(rootResult.canonicalPath);
  if (filesystemManifest.status !== "VERIFIED" || filesystemManifest.truncated) {
    return {
      ...baseProjectContext,
      filesystemManifest,
      filesystemSources: unavailableSources(
        filesystemManifest.reason ?? "The bounded filesystem inventory is incomplete.",
      ),
    };
  }
  return {
    ...baseProjectContext,
    filesystemManifest,
    filesystemSources: await buildProjectFileSources(rootResult.canonicalPath, filesystemManifest, message),
  };
}

async function validateBrowserProfileForDelivery(
  projectId: string,
  projectRevision: string,
  profileName: string | undefined,
): Promise<PlanContextGateFailure | null> {
  if (!profileName) return null;
  const [profile] = await db.select({
    revision: browserValidationProfilesTable.revision,
  }).from(browserValidationProfilesTable).where(and(
    eq(browserValidationProfilesTable.projectId, projectId),
    eq(browserValidationProfilesTable.name, profileName),
  )).limit(1);
  if (!profile) {
    return {
      error: "The selected browser validation profile is not registered for this project.",
      code: "PLAN_CONTEXT_INCOMPLETE",
      reasonCode: "invalid_profile",
    };
  }
  if (profile.revision !== projectRevision) {
    return {
      error: "The selected browser validation profile belongs to an older project revision. Register a fresh browser check before continuing.",
      code: "PLAN_CONTEXT_STALE",
      reasonCode: "stale_revision",
    };
  }
  return null;
}

function endedBeforeFirstSourceRead(traceSteps: AgentStep[]): boolean {
  const incompleteCode = traceSteps.some(
    (step) =>
      step.kind === "diagnostic" &&
      (step.code === "INCOMPLETE_BEFORE_EVIDENCE" || step.code === "INVESTIGATION_START_FAILURE"),
  );
  if (!incompleteCode) return false;

  return !traceSteps.some(
    (step) =>
      (step.kind === "tool_call" || step.kind === "tool_result") &&
      (step.tool === "read_file" || step.tool === "read_file_range"),
  );
}

function failClosedBeforeEvidenceResponse(message: string): string {
  return /[\u0600-\u06FF]/.test(message)
    ? "توقف التنفيذ قبل قراءة أي ملف مصدر، لذلك لا يمكن اعتبار النتيجة مكتملة أو مثبتة. أعد المحاولة مع هدف أو ملف واضح."
    : "Execution stopped before the first source read, so the result is incomplete and not proven. Retry with a clear target file or objective.";
}

function getOutOfScopeImplementationChanges(
  changes: ServerPendingChange[],
  allowedFiles: Set<string>,
  rootPath: string,
): string[] {
  return changes
    .map((change) => normalizePlanFilePath(change.path, rootPath))
    .filter((file) => !allowedFiles.has(file));
}

type ServerPendingChange = {
  path: string;
  absolutePath: string;
  newContent: string;
  originalContent: string | null;
  baseHash?: string;
  hunks?: FilePatchHunk[];
  reason: string;
  validationProfile?: ValidationProfile;
  risk?: "low" | "medium" | "high";
  evidence?: PatchEvidenceLink[];
};

async function persistFailedChatTurn(params: {
  sessionId: string;
  projectId: string;
  message: string;
  turnIntent: string;
  activeTaskState?: string | null;
  linkedTaskId?: string;
  createSessionIfMissing?: boolean;
  executionId?: string;
  outcome: "FAILED" | "INTERRUPTED";
  errorCode: string;
  errorMessage: string;
  content?: string;
  sources?: unknown;
  taskResult?: unknown;
  behaviorEvidence?: unknown;
  repairPlanMetadata?: unknown;
  terminalOutcome?: Pick<AiTerminalOutcome, "failureKind" | "retryable" | "recoveryState">;
  createdAt: Date;
  assistantAt: Date;
  toolTrace?: AgentStep[];
  executionLedgerSnapshot?: ExecutionLedgerPublicSnapshot;
}): Promise<{ id: string; sessionId: string; role: string; content: string; outcome: string | null; errorCode: string | null; errorMessage: string | null; toolTrace: string | null; createdAt: Date; executionLedger?: ExecutionLedgerPublicSnapshot; acceptanceDisposition?: AiAcceptanceDisposition }> {
  return db.transaction(async (tx) => {
    if (params.createSessionIfMissing) {
      const [session] = await tx
        .select({ id: aiChatSessionsTable.id })
        .from(aiChatSessionsTable)
        .where(eq(aiChatSessionsTable.id, params.sessionId))
        .limit(1);
      if (!session) {
        await tx.insert(aiChatSessionsTable).values({
          id: params.sessionId,
          projectId: params.projectId,
          linkedTaskId: params.linkedTaskId ?? null,
          activeTaskState: params.activeTaskState ?? null,
          title: params.message.trim().slice(0, 60) || "AI chat",
          createdAt: params.createdAt,
          updatedAt: params.createdAt,
        });
      }
    }
    // A provider/network failure may already have persisted the user turn.
    // Resuming that execution must only add the next assistant outcome, not
    // create a second copy of the user's request.
    const existingUserTurn = params.executionId
      ? await (() => {
          const query = tx
            .select({ id: aiChatMessagesTable.id })
            .from(aiChatMessagesTable)
            .where(and(
              eq(aiChatMessagesTable.sessionId, params.sessionId),
              eq(aiChatMessagesTable.executionId, params.executionId),
              eq(aiChatMessagesTable.role, "user"),
            ));
          // The production Drizzle builder supports limit(); the lightweight
          // route fixture only exposes its terminal for() operation.
          if (typeof (query as { limit?: unknown }).limit === "function") {
            return (query as { limit: (count: number) => Promise<unknown[]> }).limit(1);
          }
          if (typeof (query as { for?: unknown }).for === "function") {
            return (query as { for: (mode: string) => Promise<unknown[]> }).for("update");
          }
          return Promise.resolve([]);
        })()
      : [];
    if (existingUserTurn.length === 0) {
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: params.sessionId,
        role: "user",
        content: params.message,
        turnIntent: params.turnIntent,
        executionId: params.executionId ?? null,
        outcome: "SUCCEEDED",
        createdAt: params.createdAt,
      });
    }
    const existingAssistant: Array<{
      id: string;
      content: string;
      outcome: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      toolTrace: string | null;
      createdAt: Date;
    }> = params.executionId
      ? await (() => {
          const query = tx
            .select({
              id: aiChatMessagesTable.id,
              content: aiChatMessagesTable.content,
              outcome: aiChatMessagesTable.outcome,
              errorCode: aiChatMessagesTable.errorCode,
              errorMessage: aiChatMessagesTable.errorMessage,
              toolTrace: aiChatMessagesTable.toolTrace,
              createdAt: aiChatMessagesTable.createdAt,
            })
            .from(aiChatMessagesTable)
            .where(and(
              eq(aiChatMessagesTable.sessionId, params.sessionId),
              eq(aiChatMessagesTable.executionId, params.executionId),
              eq(aiChatMessagesTable.role, "assistant"),
            ));
          if (typeof (query as { limit?: unknown }).limit === "function") {
            return (query as { limit: (count: number) => Promise<typeof existingAssistant> }).limit(1);
          }
          if (typeof (query as { for?: unknown }).for === "function") {
            return (query as { for: (mode: string) => Promise<typeof existingAssistant> }).for("update");
          }
          return Promise.resolve([]);
        })()
      : [];
    if (existingAssistant.length > 0) {
      const existing = existingAssistant[0]!;
      return {
        id: existing.id,
        sessionId: params.sessionId,
        role: "assistant",
        content: existing.content,
        outcome: existing.outcome,
        errorCode: existing.errorCode,
        errorMessage: existing.errorMessage,
        toolTrace: existing.toolTrace,
        ...terminalMetadataFromTrace(existing.toolTrace),
        createdAt: existing.createdAt,
        ...(readExecutionLedgerTrace(existing.toolTrace)
          ? { executionLedger: readExecutionLedgerTrace(existing.toolTrace) }
          : {}),
      };
    }
    if (params.activeTaskState !== undefined) {
      await tx.update(aiChatSessionsTable)
        .set({
          activeTaskState: params.activeTaskState,
          updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${params.assistantAt})`,
        })
        .where(and(
          eq(aiChatSessionsTable.id, params.sessionId),
          sessionTaskStateIsAtOrBefore(params.assistantAt),
        ));
    }
    const trace = params.toolTrace ? serializeToolTrace(params.toolTrace, true) : null;
    const persistedTrace = params.executionLedgerSnapshot
      ? appendExecutionLedgerTrace(trace, params.executionLedgerSnapshot)
      : trace;
    const terminalTrace = params.terminalOutcome && persistedTrace
      ? (() => {
          const parsed = parseStoredJson(persistedTrace);
          const acceptanceDisposition = publicAcceptanceDisposition({
            code: params.errorCode,
            outcome: params.outcome,
            failureKind: params.terminalOutcome?.failureKind,
            recoveryState: params.terminalOutcome?.recoveryState,
          });
          return JSON.stringify([
            ...(Array.isArray(parsed) ? parsed : []),
            {
              kind: "terminal_outcome",
              code: params.errorCode,
              outcome: params.outcome,
              failureKind: params.terminalOutcome.failureKind,
              retryable: params.terminalOutcome.retryable,
              recoveryState: params.terminalOutcome.recoveryState,
              ...(acceptanceDisposition ? { acceptanceDisposition } : {}),
            },
          ]);
        })()
      : persistedTrace;
    const assistantId = randomUUID();
    const assistantContent = params.content ? sanitizeResponseText(params.content).slice(0, 12_000) : "";
    const assistantErrorMessage = redactUserFacingText(params.errorMessage).slice(0, 500);
    await tx.insert(aiChatMessagesTable).values({
      id: assistantId,
      sessionId: params.sessionId,
      role: "assistant",
      // Empty content is intentional: a failed provider turn is not an
      // assistant answer and must not be rendered as one.
      content: assistantContent,
      sources: params.sources !== undefined
        ? JSON.stringify(redactUserFacingValue(params.sources))
        : null,
      taskResult: params.taskResult !== undefined
        ? JSON.stringify(redactUserFacingValue(params.taskResult))
        : null,
      behaviorEvidence: params.behaviorEvidence !== undefined
        ? JSON.stringify(redactUserFacingValue(params.behaviorEvidence))
        : null,
      repairPlanMetadata: params.repairPlanMetadata !== undefined
        ? JSON.stringify(redactUserFacingValue(params.repairPlanMetadata))
        : null,
      turnIntent: params.turnIntent,
      executionId: params.executionId ?? null,
      outcome: params.outcome,
      errorCode: params.errorCode,
      errorMessage: assistantErrorMessage,
      toolTrace: terminalTrace,
      createdAt: params.assistantAt,
    });
    await tx.update(aiChatSessionsTable)
      .set({ updatedAt: params.assistantAt })
      .where(eq(aiChatSessionsTable.id, params.sessionId));
    return {
      id: assistantId,
      sessionId: params.sessionId,
      role: "assistant",
      content: assistantContent,
      outcome: params.outcome,
      errorCode: params.errorCode,
      errorMessage: assistantErrorMessage,
      toolTrace: terminalTrace,
      createdAt: params.assistantAt,
      ...(publicAcceptanceDisposition({
        code: params.errorCode,
        outcome: params.outcome,
        failureKind: params.terminalOutcome?.failureKind,
        recoveryState: params.terminalOutcome?.recoveryState,
      }) ? {
        acceptanceDisposition: publicAcceptanceDisposition({
          code: params.errorCode,
          outcome: params.outcome,
          failureKind: params.terminalOutcome?.failureKind,
          recoveryState: params.terminalOutcome?.recoveryState,
        }),
      } : {}),
      ...(params.executionLedgerSnapshot ? { executionLedger: params.executionLedgerSnapshot } : {}),
    };
  });
}

type ApplySnapshot = {
  path: string;
  realPath: string;
  before: Buffer | null;
};

type ApplyRollbackFailure = {
  path: string;
  error: string;
};

type ApplyJournalStage =
  | "STARTED"
  | "PREFLIGHT_STARTED"
  | "PREFLIGHT_PASSED"
  | "PREFLIGHT_FAILED"
  | "WRITING_STARTED"
  | "WRITTEN"
  | "WRITE_FAILED"
  | "VALIDATING"
  | "BLOCKED"
  | "APPLIED"
  | "ROLLED_BACK"
  | "ROLLBACK_FAILED"
  | "PROMOTION_INTENT"
  | "PROMOTED"
  | "RECOVERY_REQUIRED";

async function restoreApplySnapshots(
  changes: readonly ApplySnapshot[],
): Promise<ApplyRollbackFailure[]> {
  const failures: ApplyRollbackFailure[] = [];
  for (const change of changes) {
    try {
      if (change.before === null) {
        try {
          await fs.unlink(change.realPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      } else {
        await fs.writeFile(change.realPath, change.before);
      }

      let restored: Buffer | null = null;
      try {
        restored = await fs.readFile(change.realPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const matchesSnapshot =
        change.before === null
          ? restored === null
          : restored !== null && restored.equals(change.before);
      if (!matchesSnapshot) {
        throw new Error("Rollback persistence verification failed.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: change.path, error: message });
      logger.error(
        { path: change.path, error: message },
        "AI apply rollback failed or could not be verified",
      );
    }
  }
  return failures;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function serializeCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Verify that every submitted change is a value-exact authorized subset of the
 * stored proposal. The user may omit entire file changes (file-level reject)
 * or omit individual hunks (hunk-level reject), but may not add new paths,
 * alter any non-hunk field, or introduce hunks not present in the proposal.
 *
 * Returns an error string describing the first violation, or null if authorized.
 */
function authorizeChangeSubset(
  submitted: Array<{
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
      risk?: "low" | "medium" | "high";
      evidence?: PatchEvidenceLink[];
    }>;
    reason: string;
    validationProfile?: string;
    risk?: "low" | "medium" | "high";
    evidence?: PatchEvidenceLink[];
  }>,
  stored: ServerPendingChange[],
): string | null {
  const storedByPath = new Map(stored.map((c) => [c.path, c]));
  for (const change of submitted) {
    const storedChange = storedByPath.get(change.path);
    if (!storedChange) {
      return `Path "${change.path}" is not in the stored proposal`;
    }
    if (change.absolutePath !== storedChange.absolutePath) {
      return `absolutePath mismatch for "${change.path}"`;
    }
    if (change.originalContent !== storedChange.originalContent) {
      return `originalContent mismatch for "${change.path}"`;
    }
    if ((change.baseHash ?? null) !== (storedChange.baseHash ?? null)) {
      return `baseHash mismatch for "${change.path}"`;
    }
    if (change.newContent !== storedChange.newContent) {
      return `newContent mismatch for "${change.path}"`;
    }
    if (change.reason !== storedChange.reason) {
      return `reason mismatch for "${change.path}"`;
    }
    if ((change.validationProfile ?? null) !== (storedChange.validationProfile ?? null)) {
      return `validationProfile mismatch for "${change.path}"`;
    }
    if (serializeCanonical(change.risk ?? null) !== serializeCanonical(storedChange.risk ?? null)) {
      return `risk mismatch for "${change.path}"`;
    }
    if (serializeCanonical(change.evidence ?? null) !== serializeCanonical(storedChange.evidence ?? null)) {
      return `evidence mismatch for "${change.path}"`;
    }
    // When the stored change carries hunks the submitted change MUST also carry
    // a non-empty hunk array.  An omitted or empty hunks field for a hunk-bearing
    // stored change is an authorization bypass: the apply loop falls through to
    // writing newContent (the complete file) instead of the selected subset.
    const storedHasHunks = storedChange.hunks != null && storedChange.hunks.length > 0;
    const submittedHunkCount = change.hunks?.length ?? 0;
    if (storedHasHunks && submittedHunkCount === 0) {
      return `Submitted change for "${change.path}" must include at least one accepted hunk (the stored proposal has ${storedChange.hunks!.length})`;
    }
    // Every submitted hunk must exist verbatim in the stored hunk list using
    // multiset (one-to-one) matching: each stored entry can satisfy at most one
    // submitted hunk.  Without this, a client could submit the same valid hunk
    // twice and bypass the authorization boundary.
    if (change.hunks && change.hunks.length > 0) {
      // Work against a mutable copy so each stored slot is consumed at most once.
      const remaining = [...(storedChange.hunks ?? [])];
      for (const hunk of change.hunks) {
        const matchIndex = remaining.findIndex(
          (sh) =>
            sh.startLine === hunk.startLine &&
            sh.endLine === hunk.endLine &&
            sh.expectedText === hunk.expectedText &&
            sh.replacementText === hunk.replacementText &&
            sh.reason === hunk.reason &&
            sh.risk === hunk.risk &&
            serializeCanonical(sh.evidence ?? null) === serializeCanonical(hunk.evidence ?? null),
        );
        if (matchIndex === -1) {
          return `Hunk at lines ${hunk.startLine}–${hunk.endLine} in "${change.path}" is not in the stored proposal (or was submitted more than once)`;
        }
        remaining.splice(matchIndex, 1);
      }
    }
  }
  return null;
}

function serializeServerPendingChanges(changes: ServerPendingChange[]): string {
  return JSON.stringify(changes);
}

function withPatchLabMetadata(
  change: ServerPendingChange,
  metadata: {
    risk: "low" | "medium" | "high";
    evidence: PatchEvidenceLink[];
  },
): ServerPendingChange {
  return {
    ...change,
    risk: metadata.risk,
    evidence: metadata.evidence,
    hunks: change.hunks?.map((hunk) => ({
      ...hunk,
      risk: metadata.risk,
      evidence: metadata.evidence,
    })),
  };
}

function bindPendingChangesToRepairPlan(
  changes: ServerPendingChange[],
  repairPlan: RepairPlanMetadata[] | undefined,
): ServerPendingChange[] {
  if (!repairPlan?.length) return changes;
  return changes.map((change) => {
    const phase = repairPlan.find((candidate) => candidate.files.includes(change.path));
    if (!phase) return change;
    const validationProfile = change.validationProfile ?? phase.validationProfile;
    const risk = phase.verdictScope === "MIXED" || phase.verdictScope === "NOT_PROVEN"
      ? "high"
      : change.path.includes("/") && phase.files.length > 1
        ? "medium"
        : "low";
    return withPatchLabMetadata(
      { ...change, validationProfile },
      {
        risk,
        evidence: [
          {
            kind: "finding",
            id: phase.findingId,
            label: `Verified repair finding ${phase.findingId}`,
            file: change.path,
          },
          {
            kind: "validation",
            id: validationProfile,
            label: `Validation profile: ${validationProfile}`,
          },
        ],
      },
    );
  });
}

function bindPendingChangesToImplementationPlan(
  changes: ServerPendingChange[],
  enabled: boolean,
): ServerPendingChange[] {
  if (!enabled) return changes;
  return changes.map((change) => {
    const validationProfile = change.validationProfile ?? "workspace-typecheck";
    return withPatchLabMetadata(
      { ...change, validationProfile },
      {
        risk: changes.length > 1 ? "medium" : "low",
        evidence: [{
          kind: "validation",
          id: validationProfile,
          label: `Validation profile: ${validationProfile}`,
        }],
      },
    );
  });
}

function bindPendingChangesToCompoundWrite(
  changes: ServerPendingChange[],
  sourceReadObserved: boolean,
): ServerPendingChange[] {
  if (!sourceReadObserved) return changes;
  return changes.map((change) => ({
    ...change,
    // Compound inspect → fix intentionally has no approved repair plan or
    // validation phase. Keep the proposal reviewable without treating the
    // change as already applied; the apply endpoint remains approval-gated.
    validationProfile: change.validationProfile ?? "workspace-typecheck",
  }));
}

export function canCreateProposal(
  changes: ServerPendingChange[],
  repairPlan: RepairPlanMetadata[] | undefined,
  validationReady = true,
  traceSteps: AgentStep[] = [],
): boolean {
  if (!validationReady || !changes.length) return false;
  if (repairPlan?.length) {
    const forensicStatus = [...traceSteps]
      .reverse()
      .find((step): step is Extract<AgentStep, { kind: "forensic_status" }> =>
        step.kind === "forensic_status",
      );
    const evidenceIntegrity = [...traceSteps]
      .reverse()
      .find((step): step is Extract<AgentStep, { kind: "evidence_integrity" }> =>
        step.kind === "evidence_integrity",
      );
    const decisionTrace = [...traceSteps]
      .reverse()
      .find((step): step is Extract<AgentStep, { kind: "decision_trace" }> =>
        step.kind === "decision_trace",
      );

    // A repair proposal is a delivery authorization, not merely a model
    // suggestion. Require the same server-owned proof that made the Finding
    // repair-ready: production scope, complete source coverage, a verified
    // decision, reconciled telemetry, and at least one accepted claim per
    // repair phase.
    if (
      !forensicStatus ||
      forensicStatus.auditScope !== "PRODUCTION" ||
      forensicStatus.productionReachability !== "PROVEN" ||
      forensicStatus.sourceCoverage !== "COMPLETE" ||
      forensicStatus.findingStatus !== "PROVEN" ||
      forensicStatus.repairReadiness !== "READY" ||
      !evidenceIntegrity?.consistent ||
      (evidenceIntegrity.acceptedClaimCount ?? 0) < repairPlan.length ||
      decisionTrace?.trace.finalState !== "VERIFIED" ||
      repairPlan.some((phase) =>
        phase.verdictScope !== "PRODUCTION" ||
        phase.scopedFindingStatus !== "PRODUCTION_PROVEN",
      )
    ) {
      return false;
    }
  }
  return changes.every((change) => {
    if (!change.validationProfile) return false;
    if (!repairPlan?.length) return true;
    return repairPlan.some((phase) =>
      phase.files.includes(change.path) &&
      phase.validationProfile === change.validationProfile,
    );
  });
}

function hasPassedLatestValidation(traceSteps: AgentStep[]): boolean {
  const latestValidation = [...traceSteps]
    .reverse()
    .find((step): step is Extract<AgentStep, { kind: "validation" }> => step.kind === "validation");
  return !latestValidation
    || (
      latestValidation.repairState === "READY_FOR_REVIEW"
      && isProvenValidation(latestValidation.result)
    );
}

function makeSyntheticValidationResult(
  profile: string,
  status: ValidationResult["status"],
  scenario: string,
  detail: string,
): ValidationResult {
  const evidenceId = `validation-attempt:${randomUUID()}`;
  return {
    profile,
    status,
    scenario,
    exitCode: null,
    command: "",
    stdout: "",
    stderr: "",
    failedTests: [],
    changedFiles: [],
    evidence: {
      evidenceId,
      observedAt: new Date().toISOString(),
      artifactRef: evidenceId,
    },
    detail,
  };
}

type PersistedToolTraceEntry = {
  kind: AgentStep["kind"] | "audit_scope" | "forensic_diagnostic";
  scopeDescription?: string;
  tool?: string;
  args?: Record<string, string>;
  source?: string;
  cached?: boolean;
  prefetched?: boolean;
  iter?: number;
  maxIterations?: number;
  code?: string;
  message?: string;
  iterations?: number;
  toolCalls?: number;
  prefetchToolCalls?: number;
  loopToolCalls?: number;
  stopReason?:
    | "response"
    | "iteration_budget"
    | "soft_limit"
    | "repeated_tool_call"
    | "empty_response"
    | "provider_timeout"
    | "tool_failure"
    | "cancelled"
    | "claim_unclosed"
    | "evidence_incomplete"
    | "no_progress"
    | "validation_incomplete";
  synthesisStarted?: boolean;
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
  recoveryStarted?: boolean;
  sourceCoverage?: "COMPLETE" | "PARTIAL" | "NONE";
  behavioralAssessment?: "COMPLETE" | "INCOMPLETE" | "NOT_STARTED";
  findingStatus?: "PROVEN" | "NO_FINDING" | "NOT_PROVEN";
  repairReadiness?: "READY" | "BLOCKED";
  /** Structured audit scope derived from isFixtureLocal. */
  auditScope?: "PRODUCTION" | "FIXTURE_LOCAL";
  /** True when the proven Finding is supported only by fixture/test/spec evidence. */
  isFixtureLocal?: boolean;
  productionReachability?: "PROVEN" | "NOT_PROVEN";
  implementationFiles?: number;
  contextFiles?: number;
  generatedFiles?: number;
  requestedFiles?: string[];
  rootCoverage?: Array<{
    root: string;
    discoveredFiles: number;
    readFiles: number;
    unreadFiles: number;
    status: "COMPLETE" | "EMPTY" | "PARTIAL" | "BUDGET_EXHAUSTED";
    unreadPaths?: string[];
    truncatedPaths?: string[];
  }>;
  effectiveRoot?: "PROJECT_ROOT" | "ROOT_UNAVAILABLE";
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
    status: "READ_COMPLETE" | "READ_TRUNCATED" | "READ_FAILED";
  }>;
  synthesisLifecycle?: {
    started: boolean;
    attempted: boolean;
    timedOut: boolean;
    skipped: boolean;
  };
  forensicDiagnostic?: ForensicDiagnostic;
  reason?: string;
  root?: string;
  packetIndex?: number;
  packetCount?: number;
  fileCount?: number;
  status?: "STARTED" | "ACCEPTED" | "REJECTED" | "FAILED" | "active" | "done" | "info";
  diagnosticCodes?: string[];
  details?: string[];
  /** Structured, safe context for phase-policy rejection diagnostics. */
  phase?: "localization" | "evidence" | "patch_proposal" | "validation" | "repair_recovery" | "report";
  attempt?: number;
  modelsUsed?: string[];
  auditState?: {
    sourceCoverage: "COMPLETE" | "PARTIAL" | "NONE";
    behaviorAssessment: "COMPLETE" | "INCOMPLETE" | "NOT_STARTED";
    findingStatus: "PROVEN" | "NO_FINDING" | "NOT_PROVEN";
    repairReadiness: "READY" | "BLOCKED";
    productionReachability: "PROVEN" | "NOT_PROVEN" | "OUT_OF_SCOPE";
  };
  /** FEG-017: why a forensic investigation's terminal failed (NO_FINDING/PROVEN runs omit it). */
  terminalKind?:
    | "INVESTIGATION_NOT_STARTED"
    | "INVESTIGATION_BUDGET_EXHAUSTED"
    | "NO_EVIDENCE_FOUND"
    | "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED"
    | "NO_RESPONSE_RECOVERY_BLOCKED";
  verificationStage?: "MODEL_RESPONSE" | "VERIFIED_RESPONSE";
  responseLength?: number;
  sourceCount?: number;
  evidenceCount?: number;
  acceptedEvidenceCount?: number;
  completedReadFiles?: string[];
  retainedBodyFiles?: string[];
  acceptedEvidenceFiles?: string[];
  acceptedClaimCount?: number;
  evidenceSourceCoverage?: {
    status: "COMPLETE" | "PARTIAL" | "NONE";
    requestedFiles?: string[];
    roots: Array<{
      root: string;
      discoveredFiles: number;
      readFiles: number;
      unreadFiles: number;
      status: "COMPLETE" | "EMPTY" | "PARTIAL" | "BUDGET_EXHAUSTED";
    }>;
    reason?: string;
  };
  rejectionReasons?: string[];
  taskType?: string;
  allowedFiles?: string[];
  filesRead?: string[];
  evidenceSelected?: number;
  claim?: string;
  validator?: string;
  recoveryAttempt?: number;
  recoveryFailureKind?: string;
  finalState?: "VERIFIED" | "NOT_PROVEN" | "RECOVERY_REQUIRED" | "FAILED";
  /** Task #46: verdict's proof scope persisted from the final runtime ledger. */
  verdictScope?: "PRODUCTION" | "FIXTURE_LOCAL" | "TEST_LOCAL" | "SPEC_LOCAL" | "MIXED" | "NOT_PROVEN";
  scopedFindingStatus?: "PRODUCTION_PROVEN" | "FIXTURE_PROVEN" | "TEST_PROVEN" | "MIXED_EVIDENCE" | "NOT_PROVEN";
  productionTrace?: ProductionReachabilityTrace;
  crossFileTrace?: CrossFileSemanticTrace;
  validation?: import("@workspace/ai-orchestrator").PublicValidationResult;
  /** Deprecated compatibility projection; new consumers must use validation. */
  validationStatus?: ValidationResult["status"];
  repairState?: RepairLoopState;
  /** Deprecated compatibility projection; new consumers must use validation. */
  validationProfile?: string;
  validationScenario?: string;
  validationCommand?: string;
  validationExitCode?: number | null;
  validationFailedTests?: string[];
  validationAffectedFiles?: string[];
  validationFailedTestDetails?: ValidationResult["failedTests"];
  validationChangedFiles?: string[];
  validationAttempt?: number;
  validationMaxAttempts?: number;
  validationDetail?: string;
  resultKind?: "ok" | "failed" | "unavailable" | "cancelled";
  diagnosticCode?: string;
};

/**
 * Keep execution observability separate from the assistant report. The trace
 * contains bounded metadata only — never the tool output body or model text.
 */
function serializeToolTrace(
  steps: AgentStep[],
  includeDiagnosticDetails = true,
  scopeDescription?: string,
): string | null {
  if (steps.length === 0 && !scopeDescription) return null;
  const diagnosticCodes = steps
    .filter((step): step is Extract<AgentStep, { kind: "diagnostic" }> => step.kind === "diagnostic")
    .map((step) => step.code)
    .filter((code, index, codes) => codes.indexOf(code) === index);
  const diagnosticDetails = steps
    .filter((step): step is Extract<AgentStep, { kind: "diagnostic" }> => step.kind === "diagnostic")
    .flatMap((step) => step.details ?? [])
    .filter((detail, index, details) => details.indexOf(detail) === index)
    .filter((detail) => !/(?:provider|model|bearer|credential|secret|token|upstream|raw|https?:|\/(?:home|tmp|srv|workspace)\b)/i.test(detail))
    .map((detail) => redactUserFacingText(detail).slice(0, 240))
    .filter(Boolean)
    .slice(0, 4);
  const entries: PersistedToolTraceEntry[] = steps.slice(-200).map((step) => {
    switch (step.kind) {
      case "tool_call":
        return {
          kind: step.kind,
          tool: step.tool,
          args: step.args,
          cached: step.cached,
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        };
      case "tool_result":
        return {
          kind: step.kind,
          tool: step.tool,
          source: step.source,
          cached: step.cached,
          ...("resultKind" in step && step.resultKind ? { resultKind: step.resultKind } : {}),
          ...("diagnosticCode" in step && step.diagnosticCode ? { diagnosticCode: step.diagnosticCode } : {}),
           ...("commandStatus" in step && step.commandStatus ? { commandStatus: step.commandStatus } : {}),
          ...(step.resultSummary ? { resultSummary: step.resultSummary } : {}),
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        };
      case "plan_activity":
        return {
          kind: step.kind,
          stage: step.stage,
          status: step.status,
          ...(step.stepTitle ? { stepTitle: step.stepTitle } : {}),
          ...(step.action ? { action: step.action } : {}),
          ...(step.files ? { files: step.files } : {}),
          ...(step.resultSummary ? { resultSummary: step.resultSummary } : {}),
          ...(step.nextStepTitle ? { nextStepTitle: step.nextStepTitle } : {}),
          ...(step.approvalRequired ? { approvalRequired: true } : {}),
          ...(step.approvalReason ? { approvalReason: step.approvalReason } : {}),
        };
      case "validation":
        {
        const publicValidation = redactUserFacingValue(toPublicValidationResult(step.result));
        return {
          kind: step.kind,
          validation: publicValidation,
          validationStatus: step.result.status,
          repairState: step.repairState,
          validationProfile: step.result.profile,
          validationScenario: step.result.scenario,
          validationExitCode: step.result.exitCode,
          validationDetail: publicValidation.detail,
          validationAttempt: step.attempt,
          validationMaxAttempts: step.maxAttempts,
          attempt: step.attempt,
          maxAttempts: step.maxAttempts,
        };
        }
      case "repair_state":
        return {
          kind: step.kind,
          repairState: step.state,
          reason: step.detail,
        };
      case "iteration_start":
        return { kind: step.kind, iter: step.iter, maxIterations: step.maxIterations };
      case "execution_guard":
        return { kind: step.kind, code: step.code, tool: step.tool, message: step.message };
      case "soft_limit":
        return { kind: step.kind, iter: step.iter };
      case "synthesis_start":
        return { kind: step.kind, iter: step.iter, maxIterations: step.maxIterations };
      case "forensic_recovery_start":
        return { kind: step.kind, attempt: step.attempt };
      case "forensic_status":
        {
        const rootCoverage =
          "rootCoverage" in step && Array.isArray(step.rootCoverage)
            ? step.rootCoverage as NonNullable<PersistedToolTraceEntry["rootCoverage"]>
            : undefined;
        const readStatuses =
          "readStatuses" in step && Array.isArray(step.readStatuses)
            ? step.readStatuses
                .map((read) => {
                  const safePath = typeof read.path === "string"
                    ? safeForensicTracePath(read.path)
                    : undefined;
                  return safePath ? { path: safePath, status: read.status } : undefined;
                })
                .filter((read): read is NonNullable<PersistedToolTraceEntry["readStatuses"]>[number] =>
                  read !== undefined,
                )
                .slice(0, 48)
            : undefined;
        return {
          kind: step.kind,
          auditScope: step.auditScope,
          productionReachability: step.productionReachability,
          sourceCoverage: step.sourceCoverage,
          behavioralAssessment: step.behavioralAssessment,
          findingStatus: step.findingStatus,
          repairReadiness: step.repairReadiness,
          implementationFiles: step.implementationFiles,
          contextFiles: step.contextFiles,
          generatedFiles: step.generatedFiles,
          ...(step.requestedFiles ? { requestedFiles: step.requestedFiles } : {}),
          ...(rootCoverage ? { rootCoverage } : {}),
          ...(step.reason ? { reason: step.reason } : {}),
          ...(step.isFixtureLocal ? { isFixtureLocal: true } : {}),
          ...("effectiveRoot" in step && step.effectiveRoot ? { effectiveRoot: step.effectiveRoot } : {}),
          ...("projectRevision" in step && step.projectRevision
            ? { projectRevision: redactUserFacingText(step.projectRevision).slice(0, 240) }
            : {}),
          ...("completeReads" in step && step.completeReads !== undefined ? { completeReads: step.completeReads } : {}),
          ...("appliedBudget" in step && step.appliedBudget ? { appliedBudget: step.appliedBudget } : {}),
          ...(readStatuses ? { readStatuses } : {}),
          ...("synthesisLifecycle" in step && step.synthesisLifecycle ? { synthesisLifecycle: step.synthesisLifecycle } : {}),
        };
        }
      case "audit_state":
        return {
          kind: step.kind,
          auditState: step.state,
        };
      case "forensic_terminal":
        return {
          kind: step.kind,
          terminalKind: step.terminalKind,
        };
      case "verification":
        return {
          kind: step.kind,
          verificationStage: step.trace.stage,
          responseLength: step.trace.responseLength,
          sourceCount: step.trace.sourceCount,
          evidenceCount: step.trace.evidenceCount,
          acceptedEvidenceCount: step.trace.acceptedEvidenceCount,
          rejectionReasons: step.trace.rejectionReasons,
        };
      case "decision_trace":
        return {
          kind: step.kind,
          taskType: step.trace.taskType,
          allowedFiles: step.trace.allowedFiles,
          filesRead: step.trace.filesRead,
          evidenceSelected: step.trace.evidenceSelected,
          claim: step.trace.claim,
          validator: step.trace.validator,
          rejectionReason: step.trace.rejectionReason,
          recoveryAttempt: step.trace.recoveryAttempt,
          recoveryFailureKind: step.trace.recoveryFailureKind,
          finalState: step.trace.finalState,
          // Task #46: persist the verdict's proof scope for later reconciliation.
          ...(step.trace.verdictScope ? { verdictScope: step.trace.verdictScope } : {}),
          ...(step.trace.scopedFindingStatus
            ? { scopedFindingStatus: step.trace.scopedFindingStatus }
            : {}),
        };
      case "production_trace":
        return {
          kind: step.kind,
          productionTrace: step.trace,
        };
      case "cross_file_trace":
        return {
          kind: step.kind,
          crossFileTrace: step.trace,
        };
      case "forensic_packet":
        return {
          kind: step.kind,
          root: step.root,
          packetIndex: step.packetIndex,
          packetCount: step.packetCount,
          fileCount: step.fileCount,
          implementationFiles: step.implementationFiles,
          contextFiles: step.contextFiles,
          generatedFiles: step.generatedFiles,
          status: step.status,
          ...(step.reason ? { reason: step.reason } : {}),
        };
      case "diagnostic":
        {
          const safeDetails = safePublicDiagnosticDetails(step.details).slice(0, 4);
          return {
            kind: step.kind,
            code: step.code,
            ...(includeDiagnosticDetails && safeDetails.length > 0 ? { details: safeDetails } : {}),
          ...(step.code === "EXECUTION_PHASE_TOOL_REJECTED" && step.phase
            ? { phase: step.phase, tool: step.tool }
            : {}),
          };
        }
      case "model_call":
        return { kind: step.kind };
      case "recovery_model_call":
        return {
          kind: step.kind,
          attempt: step.attempt,
        };
      case "evidence_integrity":
        return {
          kind: step.kind,
          code: step.code,
          consistent: step.consistent,
          violations: step.violations,
          readAttempts: step.readAttempts,
          uniqueFilesRead: step.uniqueFilesRead,
          evidenceFileCount: step.evidenceFileCount,
          acceptedEvidenceCount: step.acceptedEvidenceCount,
          ...(step.completedReadFiles ? { completedReadFiles: step.completedReadFiles } : {}),
          ...(step.retainedBodyFiles ? { retainedBodyFiles: step.retainedBodyFiles } : {}),
          ...(step.acceptedEvidenceFiles ? { acceptedEvidenceFiles: step.acceptedEvidenceFiles } : {}),
          ...(step.acceptedClaimCount !== undefined ? { acceptedClaimCount: step.acceptedClaimCount } : {}),
          ...(step.objectiveType ? { objectiveType: step.objectiveType } : {}),
          ...(step.requiredEdges ? { requiredEdges: step.requiredEdges } : {}),
          ...(step.provenEdges ? { provenEdges: step.provenEdges } : {}),
          ...(step.completionGateResult ? { completionGateResult: step.completionGateResult } : {}),
          ...(step.finalAnswerType ? { finalAnswerType: step.finalAnswerType } : {}),
          ...(step.evidenceSourceCoverage
            ? { evidenceSourceCoverage: step.evidenceSourceCoverage }
            : {}),
           ...(step.scopeExpansions ? { scopeExpansions: step.scopeExpansions } : {}),
           ...(step.unjustifiedReads ? { unjustifiedReads: step.unjustifiedReads } : {}),
        };
      case "done":
        {
        const synthesisStep = step as typeof step & {
          synthesisAttempts?: number;
          synthesisMaxAttempts?: number;
          synthesisTimeoutMs?: number;
          synthesisElapsedMs?: number;
          synthesisTimedOut?: boolean;
        };
        return {
          kind: step.kind,
          iterations: step.iterations,
          maxIterations: step.maxIterations,
          toolCalls: step.toolCalls,
          prefetchToolCalls: step.prefetchToolCalls,
          loopToolCalls: step.loopToolCalls,
          stopReason: step.stopReason,
          synthesisStarted: step.synthesisStarted,
          ...(synthesisStep.synthesisAttempts !== undefined ? { synthesisAttempts: synthesisStep.synthesisAttempts } : {}),
          ...(synthesisStep.synthesisMaxAttempts !== undefined ? { synthesisMaxAttempts: synthesisStep.synthesisMaxAttempts } : {}),
          ...(synthesisStep.synthesisTimeoutMs !== undefined ? { synthesisTimeoutMs: synthesisStep.synthesisTimeoutMs } : {}),
          ...(synthesisStep.synthesisElapsedMs !== undefined ? { synthesisElapsedMs: synthesisStep.synthesisElapsedMs } : {}),
          ...(synthesisStep.synthesisTimedOut !== undefined ? { synthesisTimedOut: synthesisStep.synthesisTimedOut } : {}),
          ...(steps.some((candidate) => candidate.kind === "forensic_recovery_start")
            ? { recoveryStarted: true }
            : {}),
          diagnosticCodes,
          ...(includeDiagnosticDetails && diagnosticDetails.length > 0 ? { diagnosticDetails } : {}),
        };
        }
    }
  });
  const forensicDiagnostic = deriveForensicDiagnostic(steps);
  if (forensicDiagnostic) {
    entries.push({ kind: "forensic_diagnostic", forensicDiagnostic });
  }
  if (scopeDescription) entries.unshift({ kind: "audit_scope", scopeDescription });
  return redactUserFacingText(JSON.stringify(entries));
}

/**
 * Checkpoint steps are durable too. Keep validation records in the same
 * public-safe shape there so a reconnect cannot recover the raw command,
 * output, failed-test messages, or changed-file list.
 */
function serializeExecutionCheckpointSteps(steps: AgentStep[]): Array<Record<string, unknown>> {
  return steps.slice(-AI_EXECUTION_TRACE_LIMIT).map((step) => (
    step.kind === "validation"
      ? { ...step, result: redactUserFacingValue(toPublicValidationResult(step.result)) }
      : step
  )) as unknown as Array<Record<string, unknown>>;
}

function sanitizeExecutionCheckpointForClient(value: unknown): unknown {
  return redactUserFacingValue(scrubHistoricalValidationRecord(value));
}

// ── Turn policy helpers ───────────────────────────────────────────────────────
// Resolve the plan once at the authenticated route boundary. Every downstream
// context, memory, history, prompt, and provider call receives this same
// immutable value instead of reconstructing policy from augmented text.
function resolveChatExecutionPlan(
  intent: ReturnType<typeof resolveTurnIntent>,
  hasTools: boolean,
  message: string,
): Readonly<ExecutionPlan> {
  const stateless = intent.requiresEvidence ||
    intent.kind === "FORENSIC_AUDIT" ||
    isCapabilityProbeRequest(message);
  return resolveExecutionDecision(intent.executionTaskType, {
    hasTools,
    requireTools: hasTools,
    qualityProfile: intent.executionTaskType,
    ...(stateless
      ? {
          memoryModeOverride: "none" as const,
          historyModeOverride: "none" as const,
        }
      : {}),
    ...(isCapabilityProbeRequest(message)
      ? {
          contextIntensityOverride: "lite" as const,
          graphModeOverride: "off" as const,
        }
      : {}),
  });
}

function historyFetchLimitForPlan(plan: Readonly<ExecutionPlan>): number {
  if (plan.taskProfile.historyMode === "none") return 0;
  // Summarized history needs older messages to build the bounded episode
  // summary; recent history only needs the exact raw window.
  return plan.taskProfile.historyMode === "summarized"
    ? CONVERSATION_HISTORY_FETCH_MESSAGES
    : plan.historyDepth * 2;
}

/**
 * Execution handoff observability.
 *
 * The assistant history is the source of truth for a Repair Plan handoff. Keep
 * this diagnostic bounded and content-free: it proves whether the route loaded
 * a usable audit candidate without logging the audit itself.
 */
function countRepairPlanCandidates(
  rows: Array<{ role: string; content: string; repairPlanMetadata?: string | null }>,
): number {
  const marker = /(?:repair\s+plan|خطة\s+الإصلاح|خطة\s+الاصلاح|findings|النتائج\s+الجنائية|إصلاح\s+مقترح)/i;
  return rows.filter((row) => {
    if (row.role !== "assistant") return false;
    const structuredPlan = parseRepairPlanMetadata(row.repairPlanMetadata ?? null);
    return Boolean(structuredPlan?.length) || marker.test(row.content);
  }).length;
}

function resolveSessionTaskState(
  serializedState: string | null | undefined,
  projectId: string,
): ReturnType<typeof parseActiveTaskState> {
  const state = parseActiveTaskState(serializedState);
  return state?.scope.projectId === projectId ? state : null;
}

function hasStaleTaskStateRevision(
  state: ReturnType<typeof parseActiveTaskState>,
  revision: string,
): boolean {
  return Boolean(state?.scope.revision && state.scope.revision !== revision);
}

async function recoverSessionTaskStateFromExecution(params: {
  sessionId: string | undefined;
  projectId: string;
  rootPath: string | undefined;
}): Promise<ReturnType<typeof parseActiveTaskState>> {
  if (!params.sessionId) return null;
  const executions = await db
    .select({
      id: aiExecutionsTable.id,
      operationId: aiExecutionsTable.operationId,
      request: aiExecutionsTable.request,
      status: aiExecutionsTable.status,
      updatedAt: aiExecutionsTable.updatedAt,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.sessionId, params.sessionId),
      eq(aiExecutionsTable.projectId, params.projectId),
      inArray(aiExecutionsTable.status, ["failed", "paused", "cancelled"]),
    ))
    .orderBy(desc(aiExecutionsTable.updatedAt))
    .limit(16);

  for (const execution of executions) {
    const request = parseExecutionRequest(execution.request);
    if (!request?.proofRequired || request.sessionId !== params.sessionId || !request.workspaceRevision) {
      continue;
    }
    const classification = classifyRequest(request.message);
    if (!isResumableTaskType(classification.taskType)) continue;
    const state = buildActiveTaskState({
      classification,
      projectId: params.projectId,
      rootPath: params.rootPath,
      linkedTaskId: request.linkedTaskId,
      revision: request.workspaceRevision,
      operationId: request.operationId ?? execution.operationId ?? undefined,
      executionId: execution.id,
    });
    if (state) return state;
  }
  return null;
}

function collectReadEvidencePaths(steps: AgentStep[]): string[] {
  return steps
    .filter(
      (step): step is Extract<AgentStep, { kind: "tool_result" }> =>
        step.kind === "tool_result" &&
        (step.tool === "read_file" || step.tool === "read_file_range") &&
        typeof step.source === "string" &&
        step.source.trim().length > 0,
    )
    .map((step) => step.source!.trim())
    .filter((file, index, files) => files.indexOf(file) === index)
    .slice(-48);
}

function nextSessionTaskState(args: {
  persisted: ReturnType<typeof parseActiveTaskState>;
  classification: ReturnType<typeof classifyRequest>;
  resumed: boolean;
  projectId: string;
  rootPath: string | undefined;
  linkedTaskId: string | undefined;
  revision?: string;
  operationId?: string;
  executionId?: string;
  now: Date;
  readFiles: string[];
  executionPlan: ActiveTaskExecutionPlan | null;
}): string | null {
  if (args.persisted && (args.resumed || args.executionPlan)) {
    const touched = touchActiveTaskState(args.persisted, args.now);
    const revised = args.revision && !touched.scope.revision
      ? {
          ...touched,
          scope: { ...touched.scope, revision: args.revision.slice(0, 240) },
        }
      : touched;
    const identityBound = {
      ...revised,
      ...(args.operationId ? { operationId: args.operationId.slice(0, 160) } : {}),
      ...(args.executionId ? { executionId: args.executionId.slice(0, 160) } : {}),
    };
    const existingPlan = identityBound.executionPlan;
    const progressedPlan = existingPlan
      ? advanceImplementationPlan(existingPlan, args.readFiles)
      : null;
    return serializeActiveTaskState(
      {
        ...mergeActiveTaskEvidence(identityBound, args.readFiles, args.now),
        executionPlan: args.executionPlan ?? progressedPlan ?? identityBound.executionPlan,
      },
    );
  }
  const shouldPersistExecutionPlan = Boolean(args.executionPlan);
  if (isResumableTaskType(args.classification.taskType) || shouldPersistExecutionPlan) {
    const stateClassification = isResumableTaskType(args.classification.taskType)
      ? args.classification
      : {
          ...args.classification,
          taskType: "REPAIR_ANALYSIS" as const,
          outputContract: "REPAIR_PLAN" as const,
        };
    const state = buildActiveTaskState({
      classification: stateClassification,
      projectId: args.projectId,
      rootPath: args.rootPath,
      linkedTaskId: args.linkedTaskId,
      revision: args.revision,
      operationId: args.operationId,
      executionId: args.executionId,
      now: args.now,
    });
    return serializeActiveTaskState(state
      ? {
          ...mergeActiveTaskEvidence(state, args.readFiles, args.now),
          executionPlan: args.executionPlan,
        }
      : null);
  }
  // A new non-resumable request (for example a behavior question) ends the
  // previous forensic continuation chain. Otherwise a later "continue" could
  // unexpectedly revive an older audit after the user changed subjects.
  return null;
}

/**
 * Only the turn that is at least as new as the state currently stored on the
 * session may replace or clear that state. Keep this predicate on the UPDATE
 * itself: a CASE expression in an otherwise-unconditional UPDATE can be
 * evaluated from a snapshot taken before the statement waits for a row lock.
 */
function sessionTaskStateIsAtOrBefore(msgNow: Date) {
  return sql`COALESCE(
    NULLIF(${aiChatSessionsTable.activeTaskState}::jsonb->>'lastProgressAt', '')::timestamptz,
    ${aiChatSessionsTable.updatedAt}
  ) <= ${msgNow}
  AND ${aiChatSessionsTable.updatedAt} <= ${msgNow}`;
}

const router = Router();

function runtimeChatTraceLinks(routeName: string): ProductionTraceLink[] {
  return [{
    from: {
      id: `route:${routeName}`,
      name: routeName,
      path: "artifacts/api-server/src/routes/ai/chat.ts",
      stage: "API_ROUTE",
    },
    to: {
      id: "orchestrator:chat",
      name: "chat()",
      path: "lib/ai-orchestrator/src/agents/chat-agent.ts",
      stage: "ORCHESTRATOR",
    },
    relation: "invokes",
    source: "artifacts/api-server/src/routes/ai/chat.ts",
    evidence: "runtime chatWithFallback dispatch",
    runtimeObserved: true,
  }];
}

// ── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post("/ai/chat", async (req, res) => {
  const ChatBodySchema = z.object({
    projectId:    z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    message:      z.string({ required_error: "message is required" }).trim().min(1, "message is required"),
    sessionId:    z.string().uuid("sessionId must be a valid UUID").optional(),
    // AI-TASK-002: optional task linkage — switches agent into task-aware mode
    linkedTaskId: z.string().uuid("linkedTaskId must be a valid UUID").optional(),
    // AI-OBJ-005: optional validated Objective Completion contract; when present
    // the chat() call runs the Objective Completion Gate on the real entry point
    // and refuses finalization while any required claim/edge is unproven.
    objective:    ObjectiveContractSchema.optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { projectId, message, sessionId, linkedTaskId, objective } = chatBody.data;
  const { startedAt: now, assistantAt: msgNow } = allocateTurnTimestamps();

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  // Keep execution handoff fail-closed in the streaming route too. This check
  // happens before provider resolution and before SSE headers are committed.
  if (!sessionId && isImmediateExecutionRequest(message)) {
    return res.status(409).json({
      error: "execution_session_required",
      message: "Repair Plan execution requires the original audit session.",
    });
  }

  const rlChat = await checkProjectRateLimitDb(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    // Prevent cross-project session leakage: reject sessions that belong to a
    // different project even if the UUID is known to the caller.
    if (found && found.projectId !== projectId) {
      return res.status(403).json({ error: "Session does not belong to this project" });
    }
    if (!found) {
      return res.status(404).json({ error: "Chat session not found", code: "SESSION_NOT_FOUND" });
    }
    existingSession = found;
  }

  // AI-TASK-003 & 009: Resolve the effective linked task.
  // Priority: (1) explicit linkedTaskId in request, (2) stored in existing session.
    const effectiveLinkedTaskId = linkedTaskId ?? existingSession?.linkedTaskId ?? undefined;
    let activeTask: { id: string; title: string; description: string | null; priority: string; relatedFiles: string[] } | undefined;
    if (effectiveLinkedTaskId) {
      const [foundTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, effectiveLinkedTaskId))
        .limit(1);
    if (!foundTask) {
      return res.status(404).json({ error: "Task not found", code: "TASK_NOT_FOUND" });
    }
    // AI-TASK-009: Ownership guard — task must belong to the same project.
    if (foundTask.projectId !== projectId) {
      return res.status(400).json({ error: "Invalid task context — task does not belong to this project", code: "INVALID_TASK_CONTEXT" });
    }
    activeTask = {
      id: foundTask.id,
      title: foundTask.title,
      description: foundTask.description ?? null,
      priority: foundTask.priority,
      relatedFiles: foundTask.relatedFiles,
    };
  }

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  // Classify the request upfront — pure sync, zero cost. Short continuation
  // messages reuse the verified contract stored on the session.
  const persistedActiveTaskState = resolveSessionTaskState(existingSession?.activeTaskState, projectId);
  const rawTurnClassification = classifyRequest(message);
  const rawTurnIntent = resolveTurnIntent(message, {
    classification: rawTurnClassification,
  });
  // Any ordinary CHAT request starts an isolated conversational turn unless it
  // is an explicit continuation. This mirrors the SSE path, so stale forensic
  // state cannot turn neutral conversation into an evidence-gated audit.
  const isolatedConversationTurn =
    rawTurnIntent.kind === "CHAT" && !isTaskContinuationRequest(message);
  const recoveredActiveTaskState = !persistedActiveTaskState && isTaskContinuationRequest(message)
    ? await recoverSessionTaskStateFromExecution({
        sessionId: existingSession?.id,
        projectId,
        rootPath: validRootPath,
      })
    : null;
  const resumableStateForTurn = isolatedConversationTurn
    ? null
    : persistedActiveTaskState ?? recoveredActiveTaskState;
  const classificationResolution = resumeActiveTaskClassification(
    message,
    rawTurnClassification,
    resumableStateForTurn,
  );
  const implementationPlanResume = isImplementationPlanContinuation(
    message,
    resumableStateForTurn,
  );
  const chatClassification = classificationResolution.classification;
  const turnIntent = resolveTurnIntent(message, {
    classification: chatClassification,
    resumed: classificationResolution.resumed,
    implementationPlanResume,
  });
  const resumableTaskStateAtStart = nextSessionTaskState({
    persisted: resumableStateForTurn,
    classification: chatClassification,
    resumed: classificationResolution.resumed,
    projectId,
    rootPath: validRootPath,
    linkedTaskId: effectiveLinkedTaskId,
    revision: project.updatedAt.toISOString(),
    now: msgNow,
    readFiles: [],
    executionPlan: null,
  });
  if (classificationResolution.resumed && hasStaleTaskStateRevision(
    resumableStateForTurn,
    project.updatedAt.toISOString(),
  )) {
    return res.status(409).json({
      error: "The resumable analysis belongs to an older project revision; start a new scoped analysis.",
      code: "RESUME_REVISION_STALE",
      outcome: "ANALYSIS_INCOMPLETE",
    });
  }
  if (existingSession) {
    await db.update(aiChatSessionsTable)
      .set({
        activeTaskState: resumableTaskStateAtStart,
        updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
      })
      .where(and(
        eq(aiChatSessionsTable.id, existingSession.id),
        sessionTaskStateIsAtOrBefore(msgNow),
      ));
  }
  const modelHasTools = turnIntent.requiresTools;
  const contextExecutionPlan = resolveChatExecutionPlan(turnIntent, modelHasTools, message);
  let analysisCorrelation: {
    operationId: string;
    projectId: string;
    projectRevision: string;
    rootAvailable: boolean;
    evidenceProvenance: string;
  } = {
    operationId: randomUUID(),
    projectId,
    projectRevision: project.updatedAt.toISOString(),
    rootAvailable: Boolean(validRootPath),
    evidenceProvenance: "project-analysis",
  };
  const analysisToolRunner = turnIntent.requiresTools
    ? createProjectAnalysisToolRunner(projectId, validRootPath ?? project.rootPath ?? "")
    : undefined;
  if (turnIntent.requiresTools && !validRootPath) {
    return res.status(409).json({
      error: "project_root_unavailable",
      code: "TOOL_ANALYSIS_ROOT_UNAVAILABLE",
      failureCategory: "root_unavailable",
      outcome: "FAILED",
      message: "The project analysis root is unavailable; no completed analysis was produced.",
      retryable: true,
    });
  }
  const immediateExecutionRequest = isImmediateExecutionRequest(message);
  // Fetch a stable bounded history for every ordinary request. chat-agent
  // keeps the latest complete turns verbatim and summarizes older turns,
  // while execution handoffs can still recover an older repair plan from this
  // larger fixed window.
  const historyLimit = historyFetchLimitForPlan(contextExecutionPlan);

    const historyRows = existingSession
      ? await db
          .select()
          .from(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
          .orderBy(desc(aiChatMessagesTable.createdAt))
          .limit(historyLimit)
      : [];

  const providerResolved = await requireProvider(req.userId, res, {
    requireTools: modelHasTools,
    qualityProfile: turnIntent.executionTaskType,
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;
  const executionLedger = createExecutionLedger({
    mode: executionLedgerMode(turnIntent),
  });
  const validationOnlyCompoundTurn =
    turnIntent.compoundExecution && !turnIntent.compoundWrite;
  const validationOnlyTargetPaths = validationOnlyCompoundTurn
    ? compoundValidationTargetPaths(message)
    : [];
  // Validation-only compound requests may run one server-owned profile without
  // an approved implementation plan, while the compound tool manifest keeps
  // write_file and replace_text hidden.
  const validationRunner = validationOnlyCompoundTurn && validRootPath
    ? async (
        profile: string,
        targetPaths: string[],
        signal?: AbortSignal,
        _pendingChanges?: readonly PendingValidationChange[],
        evidenceContext?: {
          operationId?: string;
          projectRevision?: string;
        },
      ) => {
        const parsedProfile = ValidationProfileSchema.safeParse(profile);
        if (!parsedProfile.success || parsedProfile.data !== "workspace-typecheck") {
          return {
            status: "unavailable" as const,
            detail: "Validation-only compound requests allow only the registered workspace typecheck profile.",
          };
        }
        return runRepairValidation(
          validRootPath,
          parsedProfile.data,
          targetPaths,
          signal,
          [],
          {
            operationId: evidenceContext?.operationId ?? analysisCorrelation.operationId,
            projectRevision: evidenceContext?.projectRevision ?? analysisCorrelation.projectRevision,
          },
        );
      }
    : undefined;
  let executionLedgerSnapshot: ExecutionLedgerPublicSnapshot | undefined;

  const applyProbe = isWriteCapableTurn(turnIntent)
    ? await tryAdvisoryLock(LockNamespace.APPLY, projectId)
    : { acquired: true, release: async () => undefined };
  if (!applyProbe.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }
  try {
    const baseProjectContext = await buildProjectContext(projectId, {
      plan: contextExecutionPlan,
    });
    const projectContext = chatClassification.implementationPlanMode
      ? await buildPlanningFilesystemContext(baseProjectContext, validRootPath, message)
      : baseProjectContext;
    // Enrich context with cross-session memories (outside cache; always fresh).
    // Failure is non-fatal — agent proceeds without memory context.
    await enrichContextWithMemories(projectContext, projectId, contextExecutionPlan, {
      taskScope: contextExecutionPlan.taskProfile.scope,
      projectRevision: project.updatedAt.toISOString(),
    }).catch((err) => {
      logger.warn({ err, projectId }, "memory-enrich: failed to load session memories");
    });
    // AI-TASK-007: Structured chat context trace.
    logger.info({
      scope: "chat-route",
      action: "pre_chat_trace",
      provider,
      sessionId: existingSession?.id ?? sessionId ?? null,
      projectId,
      linkedTaskId: effectiveLinkedTaskId ?? null,
      taskLoaded: !!activeTask,
      promptMode: activeTask ? "task" : "chat",
      messageCount: historyRows.length,
      turnIntent: turnIntent.kind,
      intentPhases: turnIntent.phases,
      compoundExecution: turnIntent.compoundExecution,
      compoundWrite: turnIntent.compoundWrite,
      requireTools: modelHasTools,
      requiresEvidence: turnIntent.requiresEvidence,
      qualityProfile: turnIntent.executionTaskType,
      contextProfile: chatClassification.contextProfile,
      executionPlan: {
        planned: {
          taskType: contextExecutionPlan.taskProfile.taskType,
          promptProfile: contextExecutionPlan.promptProfile,
          contextIntensity: contextExecutionPlan.taskProfile.contextIntensity,
          memoryMode: contextExecutionPlan.taskProfile.memoryMode,
          graphMode: contextExecutionPlan.taskProfile.graphMode,
          historyMode: contextExecutionPlan.taskProfile.historyMode,
          contextBudget: contextExecutionPlan.contextBudget,
          graphBudget: contextExecutionPlan.graphBudget,
          historyDepth: contextExecutionPlan.historyDepth,
          memoryDepth: contextExecutionPlan.memoryDepth,
          cacheMode: contextExecutionPlan.cacheMode,
        },
        effective: {
          contextSections: ["project", ...(contextExecutionPlan.contextSections ?? [])],
          promptProfile: contextExecutionPlan.promptProfile,
          historyMode: contextExecutionPlan.taskProfile.historyMode,
          historyMessagesFetched: historyRows.length,
          memoryMode: contextExecutionPlan.taskProfile.memoryMode,
          memoryIncluded: Boolean(projectContext.sessionMemories),
          cacheMode: contextExecutionPlan.cacheMode,
        },
      },
      executionHandoff: {
        requested: immediateExecutionRequest || turnIntent.compoundWrite,
        compoundExecution: turnIntent.compoundExecution,
        phases: turnIntent.phases,
        sessionId: existingSession?.id ?? sessionId ?? null,
        historyMessageCount: historyRows.length,
        repairPlanCandidateCount: countRepairPlanCandidates(historyRows),
      },
    }, "chat: dispatching chatWithFallback");

    let result: Awaited<ReturnType<typeof chat>>;
    const traceSteps: AgentStep[] = [];
    try {
      const chatOut = await chatWithFallback(
        req.userId,
        {
          message,
          history: historyRows
            .reverse()
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              ...(m.role === "assistant" && parseRepairPlanMetadata(m.repairPlanMetadata)
                ? { repairPlan: parseRepairPlanMetadata(m.repairPlanMetadata) }
                : {}),
            })),
          projectContext,
          executionPlan: contextExecutionPlan,
          rootPath: validRootPath,
          projectId,
          activeTaskState: resumableStateForTurn,
          activeTask,
          productionTraceLinks: runtimeChatTraceLinks("POST /api/ai/chat"),
          objective,
          turnIntent,
          allowValidationTools: Boolean(validationRunner),
          validationRunner,
          approvedValidationProfiles: validationRunner ? ["workspace-typecheck"] : undefined,
          validationTargetPaths: validationOnlyTargetPaths,
          allowAnalysisTools: Boolean(modelHasTools && analysisToolRunner),
          analysisToolRunner,
          analysisCorrelation,
          executionLedger,
        },
        { provider, apiKey },
        undefined,
        { requireTools: modelHasTools, qualityProfile: turnIntent.executionTaskType },
        undefined,
        (step) => traceSteps.push(step),
      );
      result = chatOut.result;
      if (turnIntent.requiresEvidence && endedBeforeFirstSourceRead(traceSteps)) {
        result = {
          ...result,
          response: failClosedBeforeEvidenceResponse(message),
          sources: [],
          pendingChanges: [],
          repairPlan: undefined,
          taskResult: undefined,
          behaviorEvidence: undefined,
        };
      }
    } catch (err) {
      if (handleOrchestratorError(err, res, {
        projectId,
        operation: "chat",
        provider,
        publicContract: "chat",
        executionLedger,
      })) return;
      throw err;
    }

    const sessionIdToUse = existingSession?.id ?? randomUUID();
    const terminalOutcome = classifyAiTerminalOutcome({
      result,
      trace: traceSteps,
      requiresEvidence: turnIntent.requiresEvidence,
      forensic: turnIntent.kind === "FORENSIC_AUDIT",
      endedBeforeEvidence: turnIntent.requiresEvidence && endedBeforeFirstSourceRead(traceSteps),
    });
    executionLedgerSnapshot = finishExecutionLedger(executionLedger, {
      outcome: terminalOutcome.outcome,
      trace: traceSteps,
    });
    if (terminalOutcome.outcome !== "SUCCEEDED") {
      const forensicDiagnostic = deriveForensicDiagnostic(traceSteps);
      const safeMessage = redactUserFacingText(
        terminalOutcome.message ?? "The AI request did not complete.",
      ).slice(0, 500);
      const report = terminalOutcome.failureKind === "TOOL_FAILURE"
        ? undefined
        : result.response;
      const failedMessage = await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: turnIntent.kind,
        activeTaskState: resumableTaskStateAtStart,
        linkedTaskId: effectiveLinkedTaskId,
        createSessionIfMissing: true,
        outcome: terminalOutcome.outcome,
        errorCode: terminalOutcome.code ?? "AI_EXECUTION_INCOMPLETE",
        errorMessage: safeMessage,
        content: report,
        sources: result.sources,
        taskResult: result.taskResult,
        behaviorEvidence: result.behaviorEvidence,
        repairPlanMetadata: result.repairPlan,
        terminalOutcome,
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
      }) ?? {
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: "assistant",
        content: report ? sanitizeResponseText(report).slice(0, 12_000) : "",
        outcome: terminalOutcome.outcome,
        errorCode: terminalOutcome.code ?? "AI_EXECUTION_INCOMPLETE",
        errorMessage: safeMessage,
        toolTrace: appendExecutionLedgerTrace(
          serializeToolTrace(traceSteps, true),
          executionLedgerSnapshot,
        ),
        createdAt: msgNow,
        acceptanceDisposition: publicAcceptanceDisposition({
          code: terminalOutcome.code,
          outcome: terminalOutcome.outcome,
          failureKind: terminalOutcome.failureKind,
          recoveryState: terminalOutcome.recoveryState,
        }),
      };
      // The HTTP request completed, but the assistant turn did not. Keep the
      // response transport-compatible with normal chat while making the
      // terminal non-success explicit in every field.
      return res.status(200).json({
        sessionId: sessionIdToUse,
        turnIntent: turnIntent.kind,
        outcome: terminalOutcome.outcome,
        failureKind: terminalOutcome.failureKind,
        retryable: terminalOutcome.retryable,
        recoveryState: terminalOutcome.recoveryState,
        code: terminalOutcome.code,
        error: safeMessage,
        errorMessage: safeMessage,
        message: {
          ...failedMessage,
          failureKind: terminalOutcome.failureKind,
          retryable: terminalOutcome.retryable,
          recoveryState: terminalOutcome.recoveryState,
          acceptanceDisposition: publicAcceptanceDisposition({
            code: terminalOutcome.code,
            outcome: terminalOutcome.outcome,
            failureKind: terminalOutcome.failureKind,
            recoveryState: terminalOutcome.recoveryState,
          }),
          executionLedger: executionLedgerSnapshot,
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        },
        executionLedger: executionLedgerSnapshot,
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        ...(report ? { report: sanitizeResponseText(report).slice(0, 12_000) } : {}),
      });
    }

    if (result._qualityError) {
      const quality = publicQualityFailure(result._qualityError);
      const safeMessage = "The AI result did not meet the quality checks required for completion.";
      const forensicDiagnostic = turnIntent.requiresEvidence
        ? deriveForensicDiagnostic(traceSteps)
        : undefined;
      await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: turnIntent.kind,
        activeTaskState: resumableTaskStateAtStart,
        executionId: undefined,
        outcome: "FAILED",
        errorCode: quality.code,
        errorMessage: safeMessage,
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
        terminalOutcome: {
          failureKind: "QUALITY_REVIEW",
          retryable: true,
          recoveryState: "REQUIRED",
        },
      }).catch((persistError) => logger.error({ persistError, sessionId: sessionIdToUse }, "quality failure persistence failed"));
      return res.status(422).json({
        error: "quality_review_low",
        code: quality.code,
        outcome: "FAILED",
        failureKind: "QUALITY_REVIEW",
        retryable: true,
        recoveryState: "REQUIRED",
        quality,
        errorMessage: safeMessage,
        executionLedger: executionLedgerSnapshot,
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      });
    }

    if (result._parseError) {
      if (!result.response) {
        const forensicDiagnostic = turnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        return res.status(422).json({
          error: "model_output_invalid",
          code: "model_output_invalid",
          outcome: "FAILED",
          failureKind: "PROVIDER_FAILURE",
          retryable: false,
          recoveryState: "REQUIRED",
          correlationId: randomUUID(),
          executionLedger: executionLedgerSnapshot,
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
      }
      logger.warn(
        { parseCode: result._parseError.code, rawPreview: result._parseError.raw.slice(0, 200) },
        "AI parse failure — using fallback response",
      );
    }

    let missionCorrelationReport: string | null;
    try {
      missionCorrelationReport = serializeMissionCorrelationReport(
        (result as { missionCorrelationReport?: unknown }).missionCorrelationReport,
      );
    } catch (error) {
      if (error instanceof MissionCorrelationReportValidationError) {
        const forensicDiagnostic = turnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        return res.status(422).json({
          error: "The forensic report could not be validated and was not completed.",
          code: error.code,
          outcome: "FAILED",
          failureKind: "RECOVERY_FAILURE",
          retryable: true,
          recoveryState: "REQUIRED",
          correlationId: randomUUID(),
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
      }
      throw error;
    }

    // Chat turns don't modify project data — no cache invalidation needed.
    // Full invalidation happens only in /apply-changes when files are written.

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const compoundSourceReadObserved = turnIntent.compoundWrite && traceSteps.some(
      (step) =>
        step.kind === "tool_result" &&
        (step.tool === "read_file" || step.tool === "read_file_range"),
    );
    const proposalChanges = bindPendingChangesToCompoundWrite(
      bindPendingChangesToRepairPlan(
        (result.pendingChanges ?? []) as ServerPendingChange[],
        result.repairPlan,
      ),
      !turnIntent.compoundWrite || compoundSourceReadObserved,
    );
    const proposalId = (!turnIntent.compoundWrite || compoundSourceReadObserved) && canCreateProposal(
      proposalChanges,
      result.repairPlan,
      hasPassedLatestValidation(traceSteps),
      traceSteps,
    )
      ? randomUUID()
      : undefined;
    const executionPlan = buildActiveTaskExecutionPlan({
      repairPlan: result.repairPlan,
      implementationPlan: result.taskResult?.kind === "IMPLEMENTATION_PLAN_RESULT"
        ? result.taskResult
        : undefined,
      objective: result.objective ?? objective,
      evidence: result.behaviorEvidence,
      projectId,
      rootPath: validRootPath,
    });
    if (!executionLedgerSnapshot) {
      executionLedgerSnapshot = finishExecutionLedger(executionLedger, {
        outcome: "SUCCEEDED",
        trace: traceSteps,
      });
    }
    const activeTaskState = nextSessionTaskState({
      persisted: resumableStateForTurn,
      classification: chatClassification,
      resumed: classificationResolution.resumed,
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      revision: analysisCorrelation.projectRevision,
      now: msgNow,
      readFiles: collectReadEvidencePaths(traceSteps),
      executionPlan,
    });

    const assistantMsg = await db.transaction(async (tx) => {
      if (existingSession) {
        await tx
          .select({ id: aiChatSessionsTable.id })
          .from(aiChatSessionsTable)
          .where(eq(aiChatSessionsTable.id, sessionIdToUse))
          .for("update");
      }
      if (!existingSession) {
        const [created] = await tx
          .insert(aiChatSessionsTable)
          .values({
            id: sessionIdToUse,
            projectId,
            // AI-TASK-001: persist task linkage so re-opened sessions remain task-aware.
            linkedTaskId: effectiveLinkedTaskId ?? null,
            activeTaskState,
            // BUG-5 fix: don't use a bare greeting as the session title.
            // "مرحبا", "Hello", "Hi" etc. give no context in the sessions list.
            // Use the first 60 chars only when the opener is substantive.
            title: (() => {
              const trimmed = message.trim();
              const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
              return (!isGreeting && trimmed.length > 10)
                ? trimmed.slice(0, 60)
                : `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`;
            })(),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          throw new Error("Failed to create chat session");
        }
      }
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: "user",
        content: message,
        turnIntent: turnIntent.kind,
        outcome: "SUCCEEDED",
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          turnIntent: turnIntent.kind,
          outcome: "SUCCEEDED",
          sources: JSON.stringify(redactUserFacingValue(result.sources)),
          toolTrace: appendExecutionLedgerTrace(
            serializeToolTrace(traceSteps),
            executionLedgerSnapshot!,
          ),
          repairPlanMetadata: serializeRepairPlanMetadata(result.repairPlan),
          behaviorEvidence: serializeBehaviorEvidence(result.behaviorEvidence),
          missionCorrelationReport,
          taskResult: serializeTaskResult(result.taskResult),
          executionId: null,
          createdAt: msgNow,
        })
        .returning();
      if (proposalId || result.repairPlan || result.taskResult?.kind === "IMPLEMENTATION_PLAN_RESULT") {
        const operationId = msg.id;
        if (proposalId) {
        await tx.insert(aiChangeProposalsTable).values({
          id: proposalId,
          projectId,
          sessionId: sessionIdToUse,
          messageId: operationId,
          changes: serializeServerPendingChanges(proposalChanges),
          status: "pending",
          createdAt: msgNow,
        });
        }
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiPlanCreated",
          projectId,
          severity: "info",
          message: "AI implementation plan created and is awaiting approval",
          correlationId: operationId,
          payload: { messageId: operationId, proposalId: proposalId ?? null },
        });
      }
      await tx
        .update(aiChatSessionsTable)
        .set({
          activeTaskState,
          updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
        })
        .where(and(
          eq(aiChatSessionsTable.id, sessionIdToUse),
          sessionTaskStateIsAtOrBefore(msgNow),
        ));
      return msg;
    });
    // Evidence-bound and forensic plans are stateless in both directions:
    // do not persist their source-derived response as future navigation memory.
    if (contextExecutionPlan.taskProfile.memoryMode !== "none") {
      try {
        await writeSessionMemories(
          sessionIdToUse,
          projectId,
          redactUserFacingValue(result.sources),
          sanitizeResponseText(result.response),
          assistantMsg.id,
          {
            outcome: "SUCCEEDED",
            turnIntent: turnIntent.kind,
            memoryMode: contextExecutionPlan.taskProfile.memoryMode,
            userMessage: message,
            taskScope: contextExecutionPlan.taskProfile.scope,
            projectRevision: project.updatedAt.toISOString(),
            taskResult: result.taskResult,
          },
        );
      } catch (err) {
        logger.warn({ err, projectId }, "memory-write: failed to persist session memories");
      }
    }

    const forensicDiagnostic = turnIntent.requiresEvidence
      ? deriveForensicDiagnostic(traceSteps)
      : undefined;
    return res.json({
      sessionId: sessionIdToUse,
      message: {
        ...assistantMsg,
        taskResult: parseTaskResult(assistantMsg.taskResult),
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      },
      executionLedger: executionLedgerSnapshot,
      turnIntent: turnIntent.kind,
      outcome: "SUCCEEDED",
      sources: redactUserFacingValue(result.sources),
      toolTrace: assistantMsg.toolTrace,
      ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      pendingChanges: proposalId
        ? proposalChanges
        : [],
      proposalId,
      proposalUnavailable: (result.pendingChanges?.length ?? 0) > 0 && !proposalId
        ? hasPassedLatestValidation(traceSteps)
          ? "Repair changes require closed Finding/claim evidence before approval."
          : "Repair changes require a verified validation profile before approval."
        : undefined,
      repairPlan: redactUserFacingValue(result.repairPlan),
      productionReachability: result.productionReachability,
      crossFileTraces: redactUserFacingValue(result.crossFileTraces),
      // Exact source line spans for each accepted behavior-evidence excerpt so the
      // dashboard can show where the proof comes from.
      behaviorEvidence: redactUserFacingValue(result.behaviorEvidence),
      // AI-008: per-task typed result discriminated on `kind` by forensicTaskType
      taskResult: redactUserFacingValue(result.taskResult),
      _meta: rootFallbackUsed
        ? { rootPathFallback: { used: true, original: rootOriginalPath } }
        : undefined,
    });
  } finally {
    await applyProbe.release();
  }
});

// ── POST /api/ai/chat/stream ─────────────────────────────────────────────────

router.post("/ai/chat/stream", async (req, res) => {
  const ChatBodySchema = z.object({
    projectId:    z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    message:      z.string({ required_error: "message is required" }).trim().min(1, "message is required"),
    sessionId:    z.string().uuid("sessionId must be a valid UUID").optional(),
    // AI-TASK-002: optional task linkage — switches agent into task-aware mode
    linkedTaskId: z.string().uuid("linkedTaskId must be a valid UUID").optional(),
    /**
     * Build handoff from a previously approved implementation plan. The
     * server validates this message before model execution and enforces its
     * declared file scope before creating a change proposal.
     */
    buildPlanMessageId: z.string().uuid("buildPlanMessageId must be a valid UUID").optional(),
    /** Durable execution identity used to reconnect or explicitly resume a run. */
    executionId: z.string().uuid("executionId must be a valid UUID").optional(),
    /** Opaque token returned with execution_started; never accepted from model content. */
    resumeToken: z.string().min(32).max(128).optional(),
    /** Client retry key; repeated requests reuse the same durable execution. */
    idempotencyKey: z.string().min(8).max(128).optional(),
    // AI-OBJ-005: optional validated Objective Completion contract; when present
    // the chat() call runs the Objective Completion Gate on the real entry point
    // and refuses finalization while any required claim/edge is unproven.
    objective:    ObjectiveContractSchema.optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const {
    projectId,
    message,
    sessionId,
    linkedTaskId,
    objective,
    buildPlanMessageId,
    executionId,
    resumeToken,
    idempotencyKey,
  } = chatBody.data;
  const rawTurnClassification = classifyRequest(message);
  const rawTurnIntent = resolveTurnIntent(message, {
    classification: rawTurnClassification,
  });
  const isolatedConversationTurn =
    rawTurnIntent.kind === "CHAT" && !isTaskContinuationRequest(message);
  const effectiveExecutionId = isolatedConversationTurn ? undefined : executionId;
  const effectiveResumeToken = isolatedConversationTurn ? undefined : resumeToken;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const { startedAt: now, assistantAt: msgNow } = allocateTurnTimestamps();

  // Keep execution handoff fail-closed in the streaming route too. This check
  // happens before provider resolution and before SSE headers are committed.
  if (!sessionId && isImmediateExecutionRequest(message)) {
    return res.status(409).json({
      error: "execution_session_required",
      message: "Repair Plan execution requires the original audit session.",
    });
  }
  if (effectiveExecutionId && !sessionId) {
    return res.status(400).json({
      error: "executionId requires the original chat session",
      code: "EXECUTION_SESSION_REQUIRED",
    });
  }

  const rlChat = await checkProjectRateLimitDb(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  let approvedImplementationPlan: ApprovedImplementationPlan | undefined;
  let approvedImplementationExecutionPlan: ActiveTaskExecutionPlan | undefined;
  let implementationPlanScope: Set<string> | undefined;
  let modelMessage = message;
  // Decide this from the validated user text before any Build handoff
  // augmentation. A greeting must never inherit Build Mode state, even when
  // the client retries with stale buildPlanMessageId metadata.
  const greetingTurnForExecution = isolatedConversationTurn;
  const effectiveBuildPlanMessageId = isolatedConversationTurn ? undefined : buildPlanMessageId;
  if (effectiveBuildPlanMessageId) {
    if (!sessionId) {
      return res.status(400).json({
        error: "Build handoff requires the original chat session",
        code: "BUILD_SESSION_REQUIRED",
      });
    }
    if (!validRootPath) {
      return res.status(409).json({
        error: "The project root is unavailable for Build Mode",
        code: "BUILD_ROOT_UNAVAILABLE",
      });
    }

    const [planRow] = await db
      .select({
        message: aiChatMessagesTable,
        session: aiChatSessionsTable,
      })
      .from(aiChatMessagesTable)
      .innerJoin(
        aiChatSessionsTable,
        eq(aiChatMessagesTable.sessionId, aiChatSessionsTable.id),
      )
      .where(eq(aiChatMessagesTable.id, effectiveBuildPlanMessageId))
      .limit(1);

    if (!planRow) {
      return res.status(404).json({ error: "Implementation plan not found", code: "PLAN_NOT_FOUND" });
    }
    if (planRow.session.projectId !== projectId) {
      return res.status(403).json({ error: "Implementation plan does not belong to this project" });
    }
    if (planRow.session.id !== sessionId) {
      return res.status(409).json({
        error: "Build Mode must use the session that produced the approved plan",
        code: "BUILD_SESSION_MISMATCH",
      });
    }

    const storedPlan = parseTaskResult(planRow.message.taskResult);
    if (!storedPlan || storedPlan.kind !== "IMPLEMENTATION_PLAN_RESULT") {
      return res.status(400).json({ error: "The selected message is not an implementation plan", code: "PLAN_INVALID" });
    }
    if (storedPlan.approvalStatus !== "APPROVED" || storedPlan.writeAccess !== "APPROVED_FOR_BUILD") {
      return res.status(409).json({
        error: "Approve the implementation plan before starting Build Mode",
        code: "PLAN_APPROVAL_REQUIRED",
        approvalStatus: storedPlan.approvalStatus,
      });
    }
    approvedImplementationPlan = storedPlan;
    implementationPlanScope = getImplementationPlanScope(storedPlan, validRootPath);
    if (implementationPlanScope.size === 0) {
      return res.status(409).json({
        error: "This implementation plan has no safe file scope and cannot enter Build Mode",
        code: "PLAN_FILE_SCOPE_REQUIRED",
      });
    }
    // Plans created before the context-manifest contract remain valid when
    // their approved file scope is present; newer plans are checked against
    // the immutable scan context before execution.
    if (storedPlan.contextManifest) {
      const contextFailure = await validatePlanContextForExecution(
        storedPlan,
        projectId,
        validRootPath,
      );
      if (contextFailure) {
        logger.warn({ projectId, code: contextFailure.code }, "Build handoff context blocked");
        return res.status(409).json(contextFailure);
      }
    }
    const browserProfileFailure = await validateBrowserProfileForDelivery(
      projectId,
      project.updatedAt.toISOString(),
      storedPlan.browserValidationProfile,
    );
    if (browserProfileFailure) return res.status(409).json(browserProfileFailure);
    approvedImplementationExecutionPlan = buildActiveTaskExecutionPlan({
      implementationPlan: storedPlan,
      objective,
      projectId,
      rootPath: validRootPath,
    }) ?? undefined;
    if (
      !approvedImplementationExecutionPlan ||
      approvedImplementationExecutionPlan.readiness !== "READY" ||
      approvedImplementationExecutionPlan.nodes.length === 0
    ) {
      logger.warn({
        projectId,
        readiness: approvedImplementationExecutionPlan?.readiness,
        nodeCount: approvedImplementationExecutionPlan?.nodes.length,
      }, "Build handoff plan blocked");
      return res.status(409).json({
        error: "This implementation plan is not executable by the server-owned Build coordinator",
        code: "PLAN_BUILD_BLOCKED",
        readiness: approvedImplementationExecutionPlan?.readiness ?? "BLOCKED",
      });
    }
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiBuildStarted",
      projectId,
      severity: "info",
      message: "Build Mode started from the approved implementation plan",
      correlationId: effectiveBuildPlanMessageId,
      payload: { messageId: effectiveBuildPlanMessageId, approvedFiles: [...implementationPlanScope] },
    });
    modelMessage = [
      message,
      "",
      "BUILD HANDOFF — execute only the approved implementation plan below.",
      `Objective: ${storedPlan.objective}`,
      `Approved files: ${[...implementationPlanScope].join(", ") || "(none)"}`,
      "Use the existing read and deferred-write flow. Prepare pending changes only; do not claim that files were applied, committed, or published.",
      "Do not read, write, or propose changes for files outside the approved file list.",
      `Approved plan JSON: ${JSON.stringify(storedPlan)}`,
    ].join("\n");
  }

  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    if (found && found.projectId !== projectId) {
      return res.status(403).json({ error: "Session does not belong to this project" });
    }
    if (!found) {
      return res.status(404).json({ error: "Chat session not found", code: "SESSION_NOT_FOUND" });
    }
    existingSession = found;
  }

  const persistedActiveTaskState = resolveSessionTaskState(
    existingSession?.activeTaskState,
    projectId,
  );
  const recoveredActiveTaskState = !persistedActiveTaskState && isTaskContinuationRequest(message)
    ? await recoverSessionTaskStateFromExecution({
        sessionId: existingSession?.id,
        projectId,
        rootPath: validRootPath,
      })
    : null;
  const streamResumableStateForTurn = isolatedConversationTurn
    ? null
    : persistedActiveTaskState ?? recoveredActiveTaskState;
  const streamClassificationResolution = resumeActiveTaskClassification(
    message,
    rawTurnClassification,
    streamResumableStateForTurn,
  );
  const streamImplementationPlanResume = isImplementationPlanContinuation(
    message,
    streamResumableStateForTurn,
  );
  const streamClassification = streamClassificationResolution.classification;
  const streamTurnIntent = resolveTurnIntent(message, {
    classification: streamClassification,
    resumed: streamClassificationResolution.resumed,
    implementationPlanResume: streamImplementationPlanResume,
    buildHandoff: Boolean(approvedImplementationPlan && effectiveBuildPlanMessageId),
  });
  // Keep this compatible with consumers that still resolve the pre-scope
  // TurnIntent declaration while the workspace packages are being rebuilt.
  const streamAuditScopeDescription = (streamTurnIntent as unknown as {
    auditScopeDescription?: string;
  }).auditScopeDescription;
  const streamModelHasTools = streamTurnIntent.requiresTools;
  const streamExecutionPlan = resolveChatExecutionPlan(streamTurnIntent, streamModelHasTools, message);
  let analysisCorrelation: {
    operationId: string;
    projectId: string;
    projectRevision: string;
    rootAvailable: boolean;
    evidenceProvenance: string;
  } = {
    operationId: randomUUID(),
    projectId,
    projectRevision: project.updatedAt.toISOString(),
    rootAvailable: Boolean(validRootPath),
    evidenceProvenance: "project-analysis",
  };
  const analysisToolRunner = streamModelHasTools
    ? createProjectAnalysisToolRunner(projectId, validRootPath ?? project.rootPath ?? "")
    : undefined;
  if (streamModelHasTools && !validRootPath) {
    return res.status(409).json({
      error: "project_root_unavailable",
      code: "TOOL_ANALYSIS_ROOT_UNAVAILABLE",
      failureCategory: "root_unavailable",
      outcome: "FAILED",
      message: "The project analysis root is unavailable; no completed analysis was produced.",
      retryable: true,
    });
  }

  // Provider/model routing must use the same authoritative intent as the
  // downstream agent. In particular, a terse continuation can inherit a
  // persisted forensic task and must not be routed from its raw text alone.
  const providerResolved = await requireProvider(req.userId, res, {
    requireTools: streamModelHasTools,
    qualityProfile: streamTurnIntent.executionTaskType,
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  // Read-only project and forensic turns may safely overlap. The apply lock is
  // reserved for an approved Build handoff, where the model can produce a
  // scoped write proposal and the existing write/approval gates apply.
  const requiresApplySerialization = isWriteCapableTurn(streamTurnIntent);
  const applyLock = requiresApplySerialization
    ? await tryAdvisoryLock(LockNamespace.APPLY, projectId)
    : { acquired: true, release: async () => undefined };
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }

  let executionWorkerId: string | undefined;
  let aiExecution: Awaited<ReturnType<typeof getAiExecutionForUser>>;
  let executionAbortController: AbortController | undefined;
  let executionTerminal = false;
  let executionNodeStates: ActiveTaskExecutionPlan["nodes"] = [];
  let resumeCheckpoint: AiExecutionCheckpoint | undefined;
  let autonomousOperation: ReturnType<typeof createAutonomousOperationContract> | undefined;

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    function sse(data: Record<string, unknown>): void {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // AI-TASK-003 & 009: Resolve the effective linked task.
    // Priority: (1) explicit linkedTaskId in request, (2) stored in existing session.
    const effectiveLinkedTaskId = linkedTaskId ?? existingSession?.linkedTaskId ?? undefined;
    let activeTask: { id: string; title: string; description: string | null; priority: string; relatedFiles: string[] } | undefined;
    if (effectiveLinkedTaskId) {
      const [foundTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, effectiveLinkedTaskId))
        .limit(1);
      if (!foundTask) {
        sse({ type: "error", code: "TASK_NOT_FOUND", message: "Task not found" });
        res.end();
        return;
      }
      // AI-TASK-009: Ownership guard — task must belong to the same project.
      if (foundTask.projectId !== projectId) {
        sse({ type: "error", code: "INVALID_TASK_CONTEXT", message: "Invalid task context — task does not belong to this project" });
        res.end();
        return;
      }
      activeTask = {
        id: foundTask.id,
        title: foundTask.title,
        description: foundTask.description ?? null,
        priority: foundTask.priority,
        relatedFiles: foundTask.relatedFiles,
      };
    }

    const sessionIdToUse = existingSession?.id ?? randomUUID();

    // Reserve a new session before the long model/tool loop starts. The client
    // needs a stable identity even if the model is slow, the tab is refreshed,
    // or the stream fails before the final `done` event. The user and assistant
    // messages are still committed together after the model returns.
    if (!existingSession) {
      const [createdSession] = await db
        .insert(aiChatSessionsTable)
        .values({
          id: sessionIdToUse,
          projectId,
          linkedTaskId: effectiveLinkedTaskId ?? null,
          title: (() => {
            const trimmed = message.trim();
            const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
            return (!isGreeting && trimmed.length > 10)
              ? trimmed.slice(0, 60)
              : `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`;
          })(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!createdSession) {
        sse({ type: "error", code: "SESSION_CREATE_FAILED", message: "Failed to create chat session" });
        res.end();
        return;
      }
      existingSession = createdSession;
      sse({
        type: "session_started",
        sessionId: createdSession.id,
        title: createdSession.title,
        updatedAt: createdSession.updatedAt.toISOString(),
      });
    }
    if (streamAuditScopeDescription) {
      sse({
        type: "forensic_status",
        scopeDescription: streamAuditScopeDescription,
      });
    }

    let executionRequest: AiExecutionRequestEnvelope = {
      projectId,
      ...(streamResumableStateForTurn?.operationId
        ? { operationId: streamResumableStateForTurn.operationId }
        : {}),
      sessionId: sessionIdToUse,
      message,
      modelMessage,
      workspaceRevision: analysisCorrelation.projectRevision,
      ...(effectiveLinkedTaskId ? { linkedTaskId: effectiveLinkedTaskId } : {}),
      ...(effectiveBuildPlanMessageId ? { buildPlanMessageId: effectiveBuildPlanMessageId } : {}),
      ...(objective ? { objective } : {}),
      validationTargetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
      // Session task linkage is context, not an autonomous execution request.
      // Only an explicit delivery/task execution, Build handoff, declared
      // objective, scoped implementation plan, or direct execution command
      // enters the proof-required contract.
      proofRequired: Boolean(
        objective
        || effectiveBuildPlanMessageId
        || (effectiveLinkedTaskId && streamTurnIntent.kind === "DELIVERY")
        || (implementationPlanScope && implementationPlanScope.size > 0)
        || isImmediateExecutionRequest(message),
      ),
      ...(isResumableTaskType(streamClassification.taskType)
        ? {
            resumeContract: {
              taskType: streamClassification.taskType,
              outputContract: streamTurnIntent.outputContract,
              contextProfile: streamClassification.contextProfile,
              sessionId: sessionIdToUse,
              projectRevision: analysisCorrelation.projectRevision,
              requiresEvidence: streamTurnIntent.requiresEvidence,
              scope: {
                projectId,
                rootPath: validRootPath ?? null,
                linkedTaskId: effectiveLinkedTaskId ?? null,
              },
            },
          }
        : {}),
    };
    let proofRequired = executionRequest.proofRequired === true;
    executionWorkerId = randomUUID();
    let executionResumeToken: string | undefined;
    aiExecution = effectiveExecutionId
      ? await getAiExecutionForUser(effectiveExecutionId, req.userId)
      : undefined;

    if (effectiveExecutionId && !aiExecution) {
      sse({ type: "error", code: "EXECUTION_NOT_FOUND", message: "AI execution not found" });
      res.end();
      return;
    }

    if (aiExecution) {
      const storedRequest = parseExecutionRequest(aiExecution.request);
      const legacyBuildModelBinding = Boolean(
        storedRequest?.buildPlanMessageId
        && storedRequest.modelMessage === storedRequest.message
        && executionRequest.modelMessage.startsWith(
          `${executionRequest.message}\n\nBUILD HANDOFF`,
        ),
      );
      const optionalBindingMatches = (
        storedValue: unknown,
        requestedValue: unknown,
        requested: boolean,
      ): boolean => !requested || JSON.stringify(storedValue ?? null) === JSON.stringify(requestedValue ?? null);
      const bindingMatches = storedRequest &&
        storedRequest.projectId === executionRequest.projectId &&
        storedRequest.sessionId === executionRequest.sessionId &&
        storedRequest.message === executionRequest.message &&
        (
          storedRequest.modelMessage === executionRequest.modelMessage
          || legacyBuildModelBinding
        ) &&
        optionalBindingMatches(
          storedRequest.linkedTaskId,
          executionRequest.linkedTaskId,
          linkedTaskId !== undefined,
        ) &&
        optionalBindingMatches(
          storedRequest.buildPlanMessageId,
          executionRequest.buildPlanMessageId,
          effectiveBuildPlanMessageId !== undefined,
        ) &&
        optionalBindingMatches(
          storedRequest.validationTargetPaths,
          executionRequest.validationTargetPaths,
          implementationPlanScope !== undefined && implementationPlanScope.size > 0,
        ) &&
        optionalBindingMatches(storedRequest.objective, executionRequest.objective, objective !== undefined);
      if (!bindingMatches) {
        sse({
          type: "error",
          code: "EXECUTION_BINDING_MISMATCH",
          message: "Execution does not match the requested session, plan, or validation scope.",
        });
        res.end();
        return;
      }
      if (aiExecution.status === "running") {
        sse({
          type: "error",
          code: "EXECUTION_ALREADY_RUNNING",
          message: "This execution is already running. Reconnect through its status instead of starting a duplicate.",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (["cancelled", "completed", "cancelling"].includes(aiExecution.status)) {
        sse({
          type: "error",
          code: "EXECUTION_NOT_RESUMABLE",
          message: `Execution is already ${aiExecution.status}.`,
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (!effectiveResumeToken) {
        sse({
          type: "error",
          code: "EXECUTION_RESUME_TOKEN_REQUIRED",
          message: "A resume token is required to continue this execution.",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (
        (!effectiveExecutionId
          && hasStaleTaskStateRevision(
            streamResumableStateForTurn,
            analysisCorrelation.projectRevision,
          ))
        || (effectiveExecutionId
          && hasStaleTaskStateRevision(
            streamResumableStateForTurn,
            storedRequest?.workspaceRevision ?? analysisCorrelation.projectRevision,
          ))
      ) {
        sse({
          type: "error",
          code: "RESUME_REVISION_STALE",
          message: "The saved analysis belongs to an older project revision. Start a new scoped analysis.",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      // The original request owns the analysis revision. A reconnect must not
      // silently move the same operation onto a newer workspace revision.
      if (storedRequest?.workspaceRevision) {
        analysisCorrelation.projectRevision = storedRequest.workspaceRevision;
      }
      // A resume is governed by the immutable request that created the
      // execution. The retry message cannot downgrade or upgrade its proof
      // contract by omitting Build/objective metadata.
      // Older executions predate the explicit proofRequired field. Recover
      // their proof contract only from stored execution metadata; never from
      // the retry message or from a session's ambient task linkage.
      proofRequired = storedRequest?.proofRequired ?? Boolean(
        storedRequest?.buildPlanMessageId
        || storedRequest?.objective
        || storedRequest.validationTargetPaths.length > 0
        || isImmediateExecutionRequest(storedRequest.message),
      );
      executionRequest = {
        ...storedRequest,
        modelMessage: storedRequest.modelMessage,
      };
      modelMessage = storedRequest.modelMessage;
      resumeCheckpoint = parseAiExecutionCheckpoint(aiExecution.checkpoint);
      const resumeContext = buildAiExecutionResumeContext(resumeCheckpoint);
      if (resumeContext) {
        modelMessage = `${modelMessage}\n\n${resumeContext}`;
      }
      const claimed = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
        resumeToken: effectiveResumeToken,
      });
      if (!claimed) {
        sse({
          type: "error",
          code: "EXECUTION_CLAIM_CONFLICT",
          message: "Another resume won the execution claim. Retry after refreshing its status.",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      aiExecution = claimed;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
    } else {
      const created = await createAiExecution({
        userId: req.userId,
        request: executionRequest,
        idempotencyKey: idempotencyKey ?? randomUUID(),
        projectId,
        sessionId: sessionIdToUse,
        linkedTaskId: effectiveLinkedTaskId,
        buildPlanMessageId: effectiveBuildPlanMessageId,
      });
      aiExecution = created.execution;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
      executionResumeToken = created.resumeToken;
      const claimed = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
      });
      if (!claimed) {
        sse({
          type: "error",
          code: "EXECUTION_CLAIM_CONFLICT",
          message: "Another request won the execution claim. Retry after refreshing its status.",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      aiExecution = claimed;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
    }

    const resumableTaskStateAtStart = nextSessionTaskState({
      persisted: streamResumableStateForTurn,
      classification: streamClassification,
      resumed: streamClassificationResolution.resumed || Boolean(aiExecution && effectiveExecutionId),
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      revision: analysisCorrelation.projectRevision,
      operationId: aiExecution.operationId ?? executionRequest.operationId,
      executionId: aiExecution.id,
      now: msgNow,
      readFiles: [],
      executionPlan: null,
    });
    await db.update(aiChatSessionsTable)
      .set({
        activeTaskState: resumableTaskStateAtStart,
        updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
      })
      .where(and(
        eq(aiChatSessionsTable.id, sessionIdToUse),
        sessionTaskStateIsAtOrBefore(msgNow),
      ));

    let checkpointSequence = aiExecution.checkpointVersion;
    const streamCheckpoint = parseAiExecutionCheckpoint(aiExecution.checkpoint);
    let checkpointFailure: unknown;
    const resumableStateForExecution = greetingTurnForExecution ? null : persistedActiveTaskState;
    const executionPlanForRun = !greetingTurnForExecution && approvedImplementationPlan
      ? approvedImplementationExecutionPlan
        ?? buildActiveTaskExecutionPlan({
            implementationPlan: approvedImplementationPlan,
            objective,
            projectId,
            rootPath: validRootPath,
          })
      : resumableStateForExecution?.executionPlan ?? null;
    const persistedExecutionNodes = executionPlanForRun?.nodes ?? [];
    const reconciledExecutionNodes = reconcileExecutionNodeCheckpoint(
      persistedExecutionNodes,
      resumeCheckpoint?.nodeStates,
    );
    if (resumeCheckpoint?.nodeStates && !reconciledExecutionNodes) {
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: "Execution node checkpoint does not match the server-owned plan.",
        cancelled: false,
      });
      executionTerminal = true;
      sse({
        type: "error",
        code: "EXECUTION_NODE_CHECKPOINT_MISMATCH",
        message: "The saved execution progress does not match the approved plan. Start a fresh execution.",
        executionId: aiExecution.id,
      });
      res.end();
      return;
    }
    executionNodeStates = reconciledExecutionNodes ?? persistedExecutionNodes;
    const checkpointOperation = resumeCheckpoint?.operation;
    autonomousOperation = checkpointOperation ?? createAutonomousOperationContract({
      operationId: aiExecution.operationId ?? aiExecution.id,
      objective: executionRequest.objective
        ? JSON.stringify(executionRequest.objective)
        : executionRequest.message,
      revisionManifest: executionRequest.workspaceRevision,
      targetPaths: executionRequest.validationTargetPaths,
      expectedBehavior: executionRequest.message,
      nodes: executionNodeStates.map((node) => ({
        id: node.id,
        kind: executionRequest.validationTargetPaths.length > 0 ? "mutate" : "inspect",
        dependencies: [...node.dependencies],
        status: node.status,
        attempts: node.attempts,
        validationAttempts: node.validationAttempts,
        allowedFiles: [...node.allowedFiles],
        validationProfile: node.validationProfile,
        evidenceRefs: [],
      })),
    });
    const activeExecutionAbortController = new AbortController();
    executionAbortController = activeExecutionAbortController;
    registerAiExecutionController(aiExecution.id, activeExecutionAbortController);
    const executionLedger = createExecutionLedger({
      id: aiExecution.id,
      mode: executionLedgerMode(streamTurnIntent),
      signal: activeExecutionAbortController.signal,
    });
    let executionLedgerSnapshot: ExecutionLedgerPublicSnapshot | undefined;
    let checkpointChain: Promise<void> = Promise.resolve();
    let executionEvidenceVerdict: FlightDeckEvidenceVerdict = "NOT_RECORDED";
    let executionEvidenceReason = proofRequired
      ? "No accepted validation evidence has been recorded."
      : "Ordinary chat response; Flight Deck proof is not required.";
    const persistExecutionCheckpoint = (checkpoint: Omit<AiExecutionCheckpoint, "sequence" | "updatedAt">): void => {
      const sequence = ++checkpointSequence;
      const completeCheckpoint: AiExecutionCheckpoint = {
        ...checkpoint,
        ...(autonomousOperation
          ? {
              operation: {
                ...autonomousOperation,
                nodes: executionNodeStates.map((node) => ({
                  id: node.id,
                  kind: executionRequest.validationTargetPaths.length > 0 ? "mutate" as const : "inspect" as const,
                  dependencies: [...node.dependencies],
                  status: node.status,
                  attempts: node.attempts,
                  validationAttempts: node.validationAttempts,
                  allowedFiles: [...node.allowedFiles],
                  validationProfile: node.validationProfile,
                  evidenceRefs: [],
                })),
                updatedAt: new Date().toISOString(),
              },
            }
          : {}),
        ...(executionNodeStates.length > 0
          ? {
              nodeStates: executionNodeStates,
              completedNodes: executionNodeStates
                .filter((node) => node.status === "passed")
                .map((node) => node.id)
                .slice(0, 24),
              ...(executionNodeStates.find((node) => node.status === "running")
                ? { currentNode: executionNodeStates.find((node) => node.status === "running")?.id }
                : {}),
            }
          : {}),
        evidenceVerdict: executionEvidenceVerdict,
        evidenceReason: executionEvidenceReason,
        proofRequired,
        sequence,
        updatedAt: new Date().toISOString(),
      };
      checkpointChain = checkpointChain
        .then(async () => {
          const persisted = await checkpointAiExecution({
            executionId: aiExecution!.id,
            workerId: executionWorkerId!,
            checkpoint: completeCheckpoint,
          });
          if (!persisted) {
            const error = new Error("AI execution checkpoint rejected by lease/state gate");
            checkpointFailure = error;
            logger.warn({ executionId: aiExecution!.id, sequence }, error.message);
          }
        })
        .catch((err) => {
          checkpointFailure = err;
          logger.warn({ err, executionId: aiExecution!.id }, "AI execution checkpoint failed");
        });
    };
    const publishExecutionNodes = (nodes: ExecutionNode[]): void => {
      executionNodeStates = nodes.map((node) => ({
        ...node,
        allowedFiles: [...node.allowedFiles],
        dependencies: [...node.dependencies],
      }));
      sse({
        type: "execution_nodes",
        executionId: aiExecution!.id,
        nodes: executionNodeStates,
      });
      for (const node of executionNodeStates) {
        sse({
          type: "recipe_node_progress",
          executionId: aiExecution!.id,
          nodeId: node.id,
          status: node.status,
          attempts: node.attempts,
          elapsedMs: 0,
        });
      }
      persistExecutionCheckpoint({
        stage: "running",
        streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
        recentSteps: serializeExecutionCheckpointSteps(traceSteps),
      });
    };

    sse({
      type: "execution_started",
      executionId: aiExecution.id,
      status: aiExecution.status,
      ...(executionResumeToken ? { resumeToken: executionResumeToken } : {}),
      resumable: true,
      recoveryOutcome: (() => {
        const recovery = (streamCheckpoint as (typeof streamCheckpoint & {
          recovery?: unknown;
        }) | undefined)?.recovery;
        if (!recovery || typeof recovery !== "object") return null;
        const outcome = (recovery as Record<string, unknown>).outcome;
        return ["recovery_required", "resume_accepted", "abandoned", "already_abandoned"].includes(String(outcome))
          ? outcome
          : null;
      })(),
    });
    if (executionNodeStates.length > 0) {
      sse({
        type: "execution_nodes",
        executionId: aiExecution.id,
        nodes: executionNodeStates,
      });
    }
    persistExecutionCheckpoint({ stage: "running" });
    res.on("close", () => {
      if (!res.writableEnded && !executionTerminal) {
        persistExecutionCheckpoint({
          stage: "client_disconnected",
          streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
          recentSteps: serializeExecutionCheckpointSteps(traceSteps),
        });
      }
    });

    const streamIsGreetingTurn = isolatedConversationTurn;
    const immediateExecutionRequest = isImmediateExecutionRequest(message);
    const historyLimit = historyFetchLimitForPlan(streamExecutionPlan);

    const historyRows = existingSession
      ? await db
          .select()
          .from(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
          .orderBy(desc(aiChatMessagesTable.createdAt))
          .limit(historyLimit)
      : [];

    sse({ type: "stage", stage: "building-context" });
    const baseProjectContext = await buildProjectContext(projectId, {
      plan: streamExecutionPlan,
    });
    const projectContext = streamClassification.implementationPlanMode
      ? await buildPlanningFilesystemContext(baseProjectContext, validRootPath, message)
      : baseProjectContext;
    // Enrich with cross-session memories (outside cache; always fresh).
    await enrichContextWithMemories(projectContext, projectId, streamExecutionPlan, {
      taskScope: streamExecutionPlan.taskProfile.scope,
      projectRevision: project.updatedAt.toISOString(),
    }).catch((err) => {
      logger.warn({ err, projectId }, "memory-enrich: failed to load session memories (stream)");
    });

    // Public, bounded intent notification. Keep internal prompt construction,
    // provider diagnostics, and raw telemetry out of the SSE contract.
    sse({
      type: "intent",
      intent: streamTurnIntent.kind,
      operationMode: streamTurnIntent.operationMode,
      requiresEvidence: streamTurnIntent.requiresEvidence,
    });

    sse({ type: "stage", stage: "calling-model" });

    // AI-TASK-007: Structured stream context trace.
    logger.info({
      scope: "chat-route",
      action: "pre_stream_trace",
      provider,
      sessionId: existingSession?.id ?? sessionId ?? null,
      projectId,
      linkedTaskId: effectiveLinkedTaskId ?? null,
      taskLoaded: !!activeTask,
      promptMode: activeTask ? "task" : "chat",
      messageCount: historyRows.length,
      turnIntent: streamTurnIntent.kind,
      intentPhases: streamTurnIntent.phases,
      compoundExecution: streamTurnIntent.compoundExecution,
      compoundWrite: streamTurnIntent.compoundWrite,
      requireTools: streamModelHasTools,
      requiresEvidence: streamTurnIntent.requiresEvidence,
      qualityProfile: streamTurnIntent.executionTaskType,
      contextProfile: streamClassification.contextProfile,
      executionPlan: {
        planned: {
          taskType: streamExecutionPlan.taskProfile.taskType,
          promptProfile: streamExecutionPlan.promptProfile,
          contextIntensity: streamExecutionPlan.taskProfile.contextIntensity,
          memoryMode: streamExecutionPlan.taskProfile.memoryMode,
          graphMode: streamExecutionPlan.taskProfile.graphMode,
          historyMode: streamExecutionPlan.taskProfile.historyMode,
          contextBudget: streamExecutionPlan.contextBudget,
          graphBudget: streamExecutionPlan.graphBudget,
          historyDepth: streamExecutionPlan.historyDepth,
          memoryDepth: streamExecutionPlan.memoryDepth,
          cacheMode: streamExecutionPlan.cacheMode,
        },
        effective: {
          contextSections: ["project", ...(streamExecutionPlan.contextSections ?? [])],
          promptProfile: streamExecutionPlan.promptProfile,
          historyMode: streamExecutionPlan.taskProfile.historyMode,
          historyMessagesFetched: historyRows.length,
          memoryMode: streamExecutionPlan.taskProfile.memoryMode,
          memoryIncluded: Boolean(projectContext.sessionMemories),
          cacheMode: streamExecutionPlan.cacheMode,
        },
      },
      executionHandoff: {
        requested: immediateExecutionRequest || streamTurnIntent.compoundWrite,
        compoundExecution: streamTurnIntent.compoundExecution,
        phases: streamTurnIntent.phases,
        sessionId: existingSession?.id ?? sessionId ?? null,
        historyMessageCount: historyRows.length,
        repairPlanCandidateCount: countRepairPlanCandidates(historyRows),
      },
    }, "chat/stream: dispatching chatWithFallback");

    // PR-011: record the request and track latency start.
    recordRequest(provider);
    const chatStartMs = Date.now();

    // Collect deltas as they arrive and forward each one as a real-time SSE
    // delta event. The accumulated string is used below for DB persistence.
    let streamedContent = "";
    let streamingActive = false;
    const traceSteps: AgentStep[] = [];
    const diagnosticCodes: string[] = [];
    const executionDiagnosticDetails: string[] = [];
    let executionSummary:
      | {
          iterations: number;
          maxIterations: number;
          toolCalls: number;
          prefetchToolCalls: number;
          loopToolCalls: number;
          stopReason:
            | "response"
            | "iteration_budget"
            | "soft_limit"
            | "repeated_tool_call"
            | "empty_response"
            | "provider_timeout"
            | "tool_failure"
            | "cancelled"
            | "claim_unclosed"
            | "evidence_incomplete"
            | "no_progress"
            | "validation_incomplete";
          synthesisStarted: boolean;
           synthesisAttempts?: number;
           synthesisMaxAttempts?: number;
           synthesisTimeoutMs?: number;
           synthesisElapsedMs?: number;
           synthesisTimedOut?: boolean;
          recoveryStarted?: boolean;
          diagnosticCodes: string[];
          diagnosticDetails?: string[];
          modelsUsed: string[];
          sourceRetrieval?: SourceRetrievalTelemetry;
          /** EI-012: true when run-ledger telemetry reconciled (no evidence↔read mismatch). */
          evidenceConsistent?: boolean;
        }
      | undefined;
    function onDelta(delta: string): void {
      if (!streamingActive) {
        // First token — signal the client to switch from "stage" indicator to
        // the live streaming bubble.
        sse({ type: "stage", stage: "streaming" });
        streamingActive = true;
      }
      const safeDelta = redactUserFacingText(delta);
      streamedContent += safeDelta;
      sse({ type: "delta", delta: safeDelta });
      if (streamedContent.length % 4096 < delta.length) {
        persistExecutionCheckpoint({
          stage: "model_call",
          streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
        });
      }
    }
    // GAP-A2: Called by chatWithFallback when the native SSE stream broke
    // mid-flight and the agent is falling back to the non-streaming result.
    // Emit stream_reset so the client discards the partial bubble before the
    // full response arrives in the `done` event.
    function onStreamReset(): void {
      if (streamingActive) {
        logger.warn(
          { scope: "chat-route", action: "stream_reset", provider, streamedBytes: streamedContent.length },
          "SSE stream broke mid-flight — emitting stream_reset to client",
        );
        streamedContent = "";
        sse({ type: "stream_reset" });
      }
    }

    // Emit agent tool-loop steps as SSE events so the client gets real-time
    // visibility into what the agent is doing — which files it reads, which
    // searches it runs, and how many iterations it has taken.
    function onStep(step: AgentStep): void {
      traceSteps.push(step);
      if (
        step.kind === "tool_result" &&
        (step.tool === "read_file" || step.tool === "read_file_range") &&
        executionPlanForRun?.implementationPlan
      ) {
        const plan = executionPlanForRun.implementationPlan;
        const current = plan.steps[executionPlanForRun.currentStepIndex];
        const source = step.source?.replaceAll("\\", "/");
        if (
          current?.action === "inspect" &&
          source &&
          current.files.some((file) => normalizePlanFilePath(file, validRootPath ?? "") === normalizePlanFilePath(source, validRootPath ?? ""))
        ) {
          const next = plan.steps[executionPlanForRun.currentStepIndex + 1];
          onStep({
            kind: "plan_activity",
            stage: "execute",
            status: "done",
            stepTitle: current.title,
            action: current.action,
            files: safePlanFiles(current.files, validRootPath),
            resultSummary: step.resultSummary ?? "Read completed.",
            nextStepTitle: next?.title,
          });
          if (next && ["create", "modify", "delete", "configure"].includes(next.action)) {
            onStep({
              kind: "plan_activity",
              stage: "execute",
              status: "info",
              stepTitle: next.title,
              action: next.action,
              files: safePlanFiles(next.files, validRootPath),
              approvalRequired: true,
              approvalReason: "Approval is required before changing these files. No files have been changed.",
            });
          }
        }
      }
      if (step.kind === "validation") {
        if (step.result.status === "passed" && isProvenValidation(step.result)) {
          executionEvidenceVerdict = "PARTIAL";
          executionEvidenceReason = "Validation passed with recorded evidence; the change remains pending explicit review or delivery evidence.";
        } else if (step.result.status === "passed") {
          executionEvidenceVerdict = "BLOCKED";
          executionEvidenceReason = "Validation reported success without complete evidence metadata.";
        } else if (step.result.status === "unavailable") {
          executionEvidenceVerdict = "UNAVAILABLE";
          executionEvidenceReason = step.result.detail ?? "Validation could not be executed.";
        } else if (step.result.status === "failed" || step.result.status === "blocked") {
          executionEvidenceVerdict = "BLOCKED";
          executionEvidenceReason = step.result.detail ?? "Validation evidence contains an unresolved failure.";
        } else {
          executionEvidenceVerdict = "NOT_RECORDED";
          executionEvidenceReason = "Validation did not produce an accepted proof state.";
        }
      }
      persistExecutionCheckpoint({
        stage: step.kind === "model_call" ? "model_call" : "tool_loop",
        streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
        recentSteps: serializeExecutionCheckpointSteps(traceSteps),
      });
      if (step.kind === "tool_call") {
        sse({
          type: "tool_call",
          tool: step.tool,
          args: redactUserFacingValue(step.args),
          cached: step.cached,
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        });
      } else if (step.kind === "tool_result") {
        sse({
          type: "tool_result",
          tool: step.tool,
          source: step.source ? redactUserFacingText(step.source) : step.source,
          cached: step.cached,
          ...("resultKind" in step && step.resultKind ? { resultKind: step.resultKind } : {}),
          ...("diagnosticCode" in step && step.diagnosticCode ? { diagnosticCode: step.diagnosticCode } : {}),
          ...(step.resultSummary ? { resultSummary: redactUserFacingText(step.resultSummary).slice(0, 240) } : {}),
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        });
      } else if (step.kind === "plan_activity") {
        sse({
          type: "plan_activity",
          stage: step.stage,
          status: step.status,
          ...(step.stepTitle ? { stepTitle: redactUserFacingText(step.stepTitle) } : {}),
          ...(step.action ? { action: step.action } : {}),
          ...(step.files ? { files: step.files.map((file) => redactUserFacingText(file)).slice(0, 12) } : {}),
          ...(step.resultSummary ? { resultSummary: redactUserFacingText(step.resultSummary).slice(0, 240) } : {}),
          ...(step.nextStepTitle ? { nextStepTitle: redactUserFacingText(step.nextStepTitle) } : {}),
          ...(step.approvalRequired ? { approvalRequired: true } : {}),
          ...(step.approvalReason ? { approvalReason: redactUserFacingText(step.approvalReason).slice(0, 240) } : {}),
        });
      } else if (step.kind === "validation") {
        const publicValidation = redactUserFacingValue(toPublicValidationResult(step.result));
        sse({
          type: "validation",
          validation: publicValidation,
          // Compatibility projection for clients that predate ValidationResult.
          status: step.result.status,
          repairState: step.repairState,
          profile: step.result.profile,
          scenario: step.result.scenario,
          exitCode: step.result.exitCode,
          attempt: step.attempt,
          maxAttempts: step.maxAttempts,
          detail: publicValidation.detail,
        });
      } else if (step.kind === "repair_state") {
        sse({
          type: "repair_state",
          state: step.state,
          detail: step.detail,
        });
      } else if (step.kind === "model_call") {
        // Model/provider routing is server diagnostics; the public event only
        // signals progress without disclosing provider-owned identifiers.
        sse({ type: "model_call" });
        // Forensic contract recovery runs after the tool-loop emits its
        // `done` step. Keep the summary live so recovery candidates are not
        // omitted from the final SSE execution metadata.
        if (executionSummary && !executionSummary.modelsUsed.includes(step.model)) {
          executionSummary.modelsUsed = [...executionSummary.modelsUsed, step.model].slice(0, 12);
        }
      } else if (step.kind === "execution_guard") {
        sse({ type: "execution_guard", code: step.code, tool: step.tool, message: step.message });
      } else if (step.kind === "synthesis_start") {
        sse({ type: "synthesis_start", iter: step.iter, max: step.maxIterations });
      } else if (step.kind === "forensic_status") {
        const readStatuses = step.readStatuses
          ?.map((read) => {
            const safePath = safeForensicTracePath(read.path);
            return safePath ? { path: safePath, status: read.status } : undefined;
          })
          .filter((read): read is NonNullable<typeof read> => read !== undefined)
          .slice(0, 48);
        sse({
          type: "forensic_status",
          auditScope: step.auditScope,
          ...(streamAuditScopeDescription
            ? { scopeDescription: streamAuditScopeDescription }
            : {}),
          ...(step.requestedFiles ? { requestedFiles: step.requestedFiles } : {}),
          isFixtureLocal: step.isFixtureLocal === true ? true : undefined,
          ...(step.effectiveRoot ? { effectiveRoot: step.effectiveRoot } : {}),
          ...(step.projectRevision
            ? { projectRevision: redactUserFacingText(step.projectRevision).slice(0, 240) }
            : {}),
          ...(step.completeReads !== undefined ? { completeReads: step.completeReads } : {}),
          ...(step.appliedBudget ? { appliedBudget: step.appliedBudget } : {}),
          ...(readStatuses ? { readStatuses } : {}),
          ...(step.synthesisLifecycle ? { synthesisLifecycle: step.synthesisLifecycle } : {}),
        });
      } else if (step.kind === "audit_state") {
        sse({ type: "audit_state", ...step.state });
      } else if (step.kind === "forensic_terminal") {
        const forensicDiagnostic = streamTurnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        sse({
          type: "forensic_terminal",
          terminalKind: step.terminalKind,
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
      } else if (step.kind === "verification") {
        sse({
          type: "verification",
          stage: step.trace.stage,
          responseLength: step.trace.responseLength,
          evidenceCount: step.trace.evidenceCount,
          acceptedEvidenceCount: step.trace.acceptedEvidenceCount,
          rejectionReasons: step.trace.rejectionReasons,
        });
      } else if (step.kind === "evidence_integrity") {
        sse({
          type: "evidence_integrity",
          code: step.code,
          consistent: step.consistent,
          violations: step.violations,
          readAttempts: step.readAttempts,
          uniqueFilesRead: step.uniqueFilesRead,
          evidenceFileCount: step.evidenceFileCount,
          acceptedEvidenceCount: step.acceptedEvidenceCount,
          ...(step.completedReadFiles ? { completedReadFiles: step.completedReadFiles } : {}),
          ...(step.retainedBodyFiles ? { retainedBodyFiles: step.retainedBodyFiles } : {}),
          ...(step.acceptedEvidenceFiles ? { acceptedEvidenceFiles: step.acceptedEvidenceFiles } : {}),
          ...(step.acceptedClaimCount !== undefined ? { acceptedClaimCount: step.acceptedClaimCount } : {}),
          ...(step.objectiveType ? { objectiveType: step.objectiveType } : {}),
          ...(step.requiredEdges ? { requiredEdges: step.requiredEdges } : {}),
          ...(step.provenEdges ? { provenEdges: step.provenEdges } : {}),
          ...(step.completionGateResult ? { completionGateResult: step.completionGateResult } : {}),
          ...(step.finalAnswerType ? { finalAnswerType: step.finalAnswerType } : {}),
          ...(step.evidenceSourceCoverage
            ? { evidenceSourceCoverage: step.evidenceSourceCoverage }
            : {}),
          ...(step.scopeExpansions ? { scopeExpansions: step.scopeExpansions } : {}),
          ...(step.unjustifiedReads ? { unjustifiedReads: step.unjustifiedReads } : {}),
        });
        if (executionSummary) executionSummary.evidenceConsistent = step.consistent;
      } else if (step.kind === "decision_trace") {
        sse({
          type: "decision_trace",
          taskType: step.trace.taskType,
          evidenceSelected: step.trace.evidenceSelected,
          validator: step.trace.validator,
          recoveryAttempt: step.trace.recoveryAttempt,
          recoveryFailureKind: step.trace.recoveryFailureKind,
          finalState: step.trace.finalState,
          rejectionReason: step.trace.rejectionReason,
          // Task #58: surface the verdict's proof scope live on the audit panel.
          ...(step.trace.verdictScope ? { verdictScope: step.trace.verdictScope } : {}),
          ...(step.trace.scopedFindingStatus
            ? { scopedFindingStatus: step.trace.scopedFindingStatus }
            : {}),
        });
        } else if (step.kind === "production_trace") {
          sse({ type: "production_trace", ...step.trace });
        } else if (step.kind === "cross_file_trace") {
          sse({ type: "cross_file_trace", ...step.trace });
      } else if (step.kind === "forensic_recovery_start") {
        if (executionSummary) executionSummary.recoveryStarted = true;
      } else if (step.kind === "iteration_start" && step.iter > 0) {
        // Skip iter 0 to avoid noise before any tools are called.
        sse({ type: "thinking", iter: step.iter, max: step.maxIterations });
      } else if (step.kind === "done") {
        const synthesisStep = step as typeof step & {
          synthesisAttempts?: number;
          synthesisMaxAttempts?: number;
          synthesisTimeoutMs?: number;
          synthesisElapsedMs?: number;
          synthesisTimedOut?: boolean;
        };
        executionSummary = {
          iterations: step.iterations,
          maxIterations: step.maxIterations,
          toolCalls: step.toolCalls,
          prefetchToolCalls: step.prefetchToolCalls,
          loopToolCalls: step.loopToolCalls,
          stopReason: step.stopReason,
          synthesisStarted: step.synthesisStarted,
           ...(synthesisStep.synthesisAttempts !== undefined ? { synthesisAttempts: synthesisStep.synthesisAttempts } : {}),
           ...(synthesisStep.synthesisMaxAttempts !== undefined ? { synthesisMaxAttempts: synthesisStep.synthesisMaxAttempts } : {}),
           ...(synthesisStep.synthesisTimeoutMs !== undefined ? { synthesisTimeoutMs: synthesisStep.synthesisTimeoutMs } : {}),
           ...(synthesisStep.synthesisElapsedMs !== undefined ? { synthesisElapsedMs: synthesisStep.synthesisElapsedMs } : {}),
           ...(synthesisStep.synthesisTimedOut !== undefined ? { synthesisTimedOut: synthesisStep.synthesisTimedOut } : {}),
          ...(step.sourceRetrieval ? { sourceRetrieval: step.sourceRetrieval } : {}),
          ...(traceSteps.some((candidate) => candidate.kind === "forensic_recovery_start")
            ? { recoveryStarted: true }
            : {}),
          modelsUsed: traceSteps
            .filter((candidate): candidate is Extract<AgentStep, { kind: "model_call" | "recovery_model_call" }> =>
              candidate.kind === "model_call" || candidate.kind === "recovery_model_call",
            )
            .map((candidate) => candidate.model)
            .filter((model, index, models) => models.indexOf(model) === index)
            .slice(0, 12),
          diagnosticCodes: [...diagnosticCodes],
           ...(executionDiagnosticDetails.length > 0 && !activeExecutionAbortController.signal.aborted
            ? { diagnosticDetails: [...executionDiagnosticDetails] }
            : {}),
        };
      } else if (step.kind === "diagnostic") {
        // Forensic recovery/provider details are server diagnostics, not user
        // report content. Keep them in the internal trace for debugging, but
        // do not stream them to a forensic audit client.
        const visibleDiagnosticDetails = streamTurnIntent.requiresEvidence
          ? []
          : safePublicDiagnosticDetails(step.details).slice(0, 4);
        if (!diagnosticCodes.includes(step.code)) {
          diagnosticCodes.push(step.code);
        }
        if (step.details) {
          for (const detail of step.details) {
            if (!executionDiagnosticDetails.includes(detail)) {
              executionDiagnosticDetails.push(detail);
            }
          }
        }
        if (executionSummary && !executionSummary.diagnosticCodes.includes(step.code)) {
          executionSummary.diagnosticCodes.push(step.code);
        }
        if (
          executionSummary &&
          (
            step.code === "CAPABILITY_PROBE_EVIDENCE_RECOVERED" ||
            step.code.startsWith("CAPABILITY_PROBE_EVIDENCE_RECOVERY_")
          )
        ) {
          executionSummary.recoveryStarted = true;
        }
        if (executionSummary && step.details) {
          executionSummary.diagnosticDetails = [...executionDiagnosticDetails];
        }
        sse({
          type: "execution_diagnostic",
          code: step.code,
          ...(visibleDiagnosticDetails.length > 0 ? { details: visibleDiagnosticDetails } : {}),
          ...(step.code === "EXECUTION_PHASE_TOOL_REJECTED" && step.phase
            ? { phase: step.phase, tool: step.tool }
            : {}),
        });
      }
    }

    // Persist the same safe lifecycle representation that the live dashboard
    // receives. Only plan-owned relative file names are projected; roots,
    // fingerprints, execution IDs, and provider details stay server-side.
    if (streamImplementationPlanResume && executionPlanForRun?.implementationPlan) {
      const plan = executionPlanForRun.implementationPlan;
      const current = plan.steps[executionPlanForRun.currentStepIndex];
      onStep({ kind: "plan_activity", stage: "understand", status: "done" });
      onStep({ kind: "plan_activity", stage: "scope", status: "done", files: safePlanFiles(current?.files, validRootPath) });
      onStep({ kind: "plan_activity", stage: "plan", status: "done", stepTitle: current?.title });
      if (current) {
        onStep({
          kind: "plan_activity",
          stage: "execute",
          status: "active",
          stepTitle: current.title,
          action: current.action,
          files: safePlanFiles(current.files, validRootPath),
          ...(["create", "modify", "delete", "configure"].includes(current.action)
            ? {
                approvalRequired: true,
                approvalReason: "Approval is required before changing these files. No files have been changed.",
              }
            : {}),
        });
      }
    }

    const validationOnlyCompoundTurn =
      streamTurnIntent.compoundExecution && !streamTurnIntent.compoundWrite;
    const validationOnlyTargetPaths = validationOnlyCompoundTurn
      ? compoundValidationTargetPaths(message)
      : [];
    const validationRunner =
      validRootPath && (
        approvedImplementationPlan && implementationPlanScope
        || validationOnlyCompoundTurn
      )
        ? async (
            profile: string,
            targetPaths: string[],
            signal?: AbortSignal,
            pendingChanges?: readonly PendingValidationChange[],
            evidenceContext?: {
              operationId?: string;
              projectRevision?: string;
              candidateHash?: string;
            },
          ) => {
            const parsedProfile = ValidationProfileSchema.safeParse(profile);
            if (
              !parsedProfile.success ||
              (validationOnlyCompoundTurn && parsedProfile.data !== "workspace-typecheck")
            ) {
              return {
                status: "unavailable" as const,
                detail: validationOnlyCompoundTurn
                  ? "Validation-only compound requests allow only the registered workspace typecheck profile."
                  : `Validation profile "${profile}" is not registered.`,
              };
            }
            return runRepairValidation(
              validRootPath,
              parsedProfile.data,
              validationOnlyCompoundTurn ? validationOnlyTargetPaths : targetPaths,
              signal,
              pendingChanges ?? [],
              evidenceContext,
            );
          }
        : undefined;
    const requestedBrowserValidationProfile = approvedImplementationPlan?.browserValidationProfile;
    const registeredBrowserProfile = requestedBrowserValidationProfile
      ? (await db.select().from(browserValidationProfilesTable).where(and(
          eq(browserValidationProfilesTable.projectId, projectId),
          eq(browserValidationProfilesTable.name, requestedBrowserValidationProfile),
        )).limit(1))[0]
      : undefined;
    // A profile is valid only for the exact project revision it was registered
    // against. Stale profiles are not silently rebound to the current project.
    const browserValidationProfile = registeredBrowserProfile
      && registeredBrowserProfile.revision === analysisCorrelation.projectRevision
      ? registeredBrowserProfile
      : undefined;
    const browserValidationProfileName = requestedBrowserValidationProfile;
    const browserValidationManager = browserValidationProfile ? new PreviewSessionManager() : undefined;
    const browserValidationRunner = browserValidationProfileName && validRootPath
      ? async (request: { profile: string; rootPath: string; pendingChanges?: readonly PendingValidationChange[]; operationId?: string; revision?: string; signal?: AbortSignal }) => {
          if (!browserValidationProfile || request.profile !== browserValidationProfile.name) {
            return {
              profile: request.profile, status: "unavailable" as const,
              scenario: "Registered browser validation profile is unavailable.",
              command: "browser-preview", exitCode: null, stdout: "", stderr: "",
              failedTests: [], changedFiles: [],
              evidence: {
                evidenceId: `browser-profile:${request.profile}`,
                observedAt: new Date().toISOString(),
                artifactRef: "browser-preview:profile-unavailable",
              },
              detail: "The browser validation profile is not approved for this plan.",
              reasonCode: (browserValidationProfile
                ? "invalid_profile"
                : registeredBrowserProfile
                  ? "stale_revision"
                  : "ownership") as BrowserValidationBlockReason,
            };
          }
          const workspace = await createValidationWorkspace(request.rootPath, request.pendingChanges ?? []);
          const session = await browserValidationManager!.start({
            projectRoot: workspace.rootPath,
            revision: request.revision ?? analysisCorrelation.projectRevision,
            port: 4300,
            lifetimeMs: 60_000,
          });
          let browser: PreviewBrowser | undefined;
          try {
            const playwright = await import("playwright");
            browser = await playwright.chromium.launch({ headless: true }) as unknown as PreviewBrowser;
            return await runRepairPreviewValidation({
              session,
              operationId: request.operationId ?? analysisCorrelation.operationId,
              executionId: aiExecution?.id ?? "browser-validation",
              revision: request.revision ?? analysisCorrelation.projectRevision,
              contract: {
                revision: request.revision ?? analysisCorrelation.projectRevision,
                permittedOrigin: browserValidationProfile.permittedOrigin,
                steps: browserValidationProfile.steps as PreviewStep[],
                timeoutMs: browserValidationProfile.timeoutMs,
              },
              steps: browserValidationProfile.steps as PreviewStep[],
              browser,
              profileName: browserValidationProfile.name,
            });
          } catch (error) {
            return {
              profile: "browser-preview", status: "unavailable" as const,
              scenario: "Run the registered browser checks against the project Preview.",
              command: "browser-preview", exitCode: null, stdout: "", stderr: "",
              failedTests: [], changedFiles: [],
              evidence: {
                evidenceId: `browser-start:${request.operationId ?? "unknown"}`,
                observedAt: new Date().toISOString(),
                artifactRef: "browser-preview:startup-failure",
              },
              detail: "Preview browser validation was unavailable.",
              reasonCode: (error instanceof Error && /stale/i.test(error.message)
                ? "stale_revision"
                : error instanceof Error && /limit|timeout|steps|selector|screenshot/i.test(error.message)
                  ? "resource_limit"
                  : "invalid_profile") as BrowserValidationBlockReason,
            };
          } finally {
            await browserValidationManager!.stop();
            await workspace.cleanup();
          }
        }
      : undefined;
    // Terminal execution is deliberately narrower than validation: one
    // server-owned profile, fixed argv, and only during an approved Build
    // handoff. The model can select the profile but cannot select a command,
    // shell, cwd, or arguments.
    const commandProfiles = approvedImplementationPlan && implementationPlanScope && validRootPath
      ? [{
          name: "workspace-typecheck",
          command: "pnpm",
          args: ["run", "typecheck"],
          timeoutMs: 10 * 60 * 1000,
          maxOutputBytes: 8 * 1024 * 1024,
          allowedOperations: ["build"],
          allowedPaths: [...implementationPlanScope],
        }]
      : undefined;

    let result: Awaited<ReturnType<typeof chat>>;
    let endedBeforeEvidence = false;
    try {
      const chatOut = await chatWithFallback(
        req.userId,
        {
          message: modelMessage,
          history: historyRows
            .reverse()
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              ...(m.role === "assistant" && parseRepairPlanMetadata(m.repairPlanMetadata)
                ? { repairPlan: parseRepairPlanMetadata(m.repairPlanMetadata) }
                : {}),
            })),
          projectContext,
          executionPlan: streamExecutionPlan,
          rootPath: validRootPath,
          projectId,
          activeTaskState: streamResumableStateForTurn,
          executionPlanOverride: executionPlanForRun ?? undefined,
          activeTask,
          productionTraceLinks: runtimeChatTraceLinks("POST /api/ai/chat/stream"),
          objective,
          allowValidationTools: Boolean(validationRunner),
          validationRunner,
          browserValidationRunner,
          browserValidationContext: {
            operationId: analysisCorrelation.operationId,
            revision: analysisCorrelation.projectRevision,
          },
          approvedValidationProfiles: validationRunner
            ? validationOnlyCompoundTurn
              ? ["workspace-typecheck"]
              : [
                  "workspace-typecheck",
                  "ai-orchestrator-tests",
                  "knowledge-engine-tests",
                  "api-ai-tests",
                  ...(browserValidationProfileName ? [browserValidationProfileName] : []),
                ]
            : browserValidationProfileName
              ? [browserValidationProfileName]
              : undefined,
           commandProfiles,
           commandRunner: commandProfiles ? runRegisteredCommand : undefined,
           commandContext: {
             operationId: analysisCorrelation.operationId,
             revision: analysisCorrelation.projectRevision,
             targetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
             operation: "build",
           },
          validationTargetPaths: validationOnlyCompoundTurn
            ? validationOnlyTargetPaths
            : implementationPlanScope
              ? [...implementationPlanScope]
              : [],
           buildHandoff: Boolean(!streamIsGreetingTurn && approvedImplementationPlan && effectiveBuildPlanMessageId),
          onExecutionNodes: publishExecutionNodes,
          signal: activeExecutionAbortController.signal,
          turnIntent: streamTurnIntent,
          allowAnalysisTools: Boolean(streamModelHasTools && analysisToolRunner),
          analysisToolRunner,
          analysisCorrelation,
           ...(aiExecution ? { capabilityRegistry: createServerCapabilityRegistry() } : {}),
          executionLedger,
          ...(aiExecution ? { capabilityRegistry: createServerCapabilityRegistry() } : {}),
        },
        { provider, apiKey },
        onDelta,
        { requireTools: streamModelHasTools, qualityProfile: streamTurnIntent.executionTaskType },
        onStreamReset,
        onStep,
      );
      result = chatOut.result;
      endedBeforeEvidence =
        streamTurnIntent.requiresEvidence &&
        !activeExecutionAbortController.signal.aborted &&
        endedBeforeFirstSourceRead(traceSteps);
      if (endedBeforeEvidence) {
        result = {
          ...result,
          response: failClosedBeforeEvidenceResponse(message),
          sources: [],
          pendingChanges: [],
          repairPlan: undefined,
          taskResult: undefined,
          behaviorEvidence: undefined,
        };
      }
      // Classify every terminal result before it can reach the successful
      // assistant-message transaction. This keeps JSON and SSE semantics
      // identical and makes cancellation/tool/recovery precedence explicit.
      const terminalOutcome = classifyAiTerminalOutcome({
        result,
        trace: traceSteps,
        requiresEvidence: streamTurnIntent.requiresEvidence,
        forensic: streamTurnIntent.kind === "FORENSIC_AUDIT",
        cancelled: activeExecutionAbortController.signal.aborted,
        endedBeforeEvidence,
      });
      executionLedgerSnapshot = finishExecutionLedger(executionLedger, {
        outcome: terminalOutcome.outcome,
        trace: traceSteps,
      });
      if (terminalOutcome.outcome !== "SUCCEEDED") {
        const safeMessage = redactUserFacingText(
          terminalOutcome.message ?? "The AI request did not complete.",
        ).slice(0, 500);
        const report = terminalOutcome.failureKind === "TOOL_FAILURE"
          ? undefined
          : result.response;
        const publicToolTrace = appendExecutionLedgerTrace(
          serializeToolTrace(traceSteps, false),
          executionLedgerSnapshot,
        );
        const forensicDiagnostic = deriveForensicDiagnostic(traceSteps);
        const failedMessage = await persistFailedChatTurn({
          sessionId: sessionIdToUse,
          projectId,
          message,
          turnIntent: streamTurnIntent.kind,
          executionId: aiExecution?.id,
          outcome: terminalOutcome.outcome,
          errorCode: terminalOutcome.code ?? "AI_EXECUTION_INCOMPLETE",
          errorMessage: safeMessage,
          content: report,
          sources: result.sources,
          taskResult: result.taskResult,
          behaviorEvidence: result.behaviorEvidence,
          repairPlanMetadata: result.repairPlan,
          terminalOutcome,
          createdAt: now,
          assistantAt: msgNow,
          toolTrace: traceSteps,
          executionLedgerSnapshot,
        }) ?? {
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: report ? sanitizeResponseText(report).slice(0, 12_000) : "",
          outcome: terminalOutcome.outcome,
          errorCode: terminalOutcome.code ?? "AI_EXECUTION_INCOMPLETE",
          errorMessage: safeMessage,
          toolTrace: appendExecutionLedgerTrace(
            serializeToolTrace(traceSteps, true),
            executionLedgerSnapshot,
          ),
          createdAt: msgNow,
        };
        if (terminalOutcome.failureKind === "TOOL_FAILURE") {
          sse({
            type: "recipe_terminal",
            executionId: aiExecution.id,
            status: "blocked",
            completedNodeIds: executionNodeStates.filter((node) => node.status === "passed").map((node) => node.id),
          });
          sse({
            type: "error",
            code: terminalOutcome.code,
            message: safeMessage,
            outcome: terminalOutcome.outcome,
            failureKind: terminalOutcome.failureKind,
            retryable: terminalOutcome.retryable,
            recoveryState: terminalOutcome.recoveryState,
            executionId: aiExecution.id,
            sessionId: sessionIdToUse,
            executionLedger: executionLedgerSnapshot,
            ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
          });
        } else {
          // A failed/incomplete report may still be useful to an operator, but
          // it must be explicitly marked non-success in the done envelope.
          // It is never followed by a success-looking done event.
          const publicContent = report ? sanitizeResponseText(report).slice(0, 12_000) : "";
          sse({
            type: "done",
            sessionId: sessionIdToUse,
            message: {
              id: failedMessage.id,
              sessionId: sessionIdToUse,
              role: "assistant",
              content: publicContent,
              sources: JSON.stringify(redactUserFacingValue(result.sources)),
              toolTrace: publicToolTrace,
              taskResult: redactUserFacingValue(result.taskResult),
              behaviorEvidence: redactUserFacingValue(result.behaviorEvidence),
              repairPlan: redactUserFacingValue(result.repairPlan),
              createdAt: failedMessage.createdAt,
              turnIntent: streamTurnIntent.kind,
              executionId: aiExecution.id,
              outcome: terminalOutcome.outcome,
              errorCode: terminalOutcome.code,
              errorMessage: safeMessage,
              failureKind: terminalOutcome.failureKind,
              retryable: terminalOutcome.retryable,
              recoveryState: terminalOutcome.recoveryState,
              executionLedger: executionLedgerSnapshot,
              ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
            },
            sources: redactUserFacingValue(result.sources),
            toolTrace: publicToolTrace,
            pendingChanges: redactUserFacingValue(result.pendingChanges),
            operationMode: streamTurnIntent.operationMode,
            execution: projectPublicExecutionSummary(executionSummary, false),
            executionLedger: executionLedgerSnapshot,
            telemetry: {
              latencyMs: Date.now() - chatStartMs,
            },
          });
        }
        if (aiExecution) {
          await failAiExecution({
            executionId: aiExecution.id,
            workerId: executionWorkerId!,
            error: safeMessage,
            cancelled: terminalOutcome.outcome === "INTERRUPTED",
            nodeStates: executionNodeStates,
            streamedPreview: streamedContent,
            recentSteps: serializeExecutionCheckpointSteps(traceSteps),
          });
          executionTerminal = true;
        }
        res.end();
        return;
      }
      if (approvedImplementationPlan && implementationPlanScope && validRootPath) {
        const outOfScopeFiles = getOutOfScopeImplementationChanges(
          (result.pendingChanges ?? []) as ServerPendingChange[],
          implementationPlanScope,
          validRootPath,
        );
        if (outOfScopeFiles.length > 0) {
          logger.warn(
            {
              scope: "chat-route",
              code: "IMPLEMENTATION_PLAN_SCOPE_BLOCKED",
              buildPlanMessageId: effectiveBuildPlanMessageId,
              outOfScopeFiles: [...new Set(outOfScopeFiles)].slice(0, 12),
            },
            "Build Mode proposed a file outside the approved implementation plan",
          );
          sse({
            type: "error",
            code: "IMPLEMENTATION_PLAN_SCOPE_BLOCKED",
            message: "Build Mode proposed changes outside the approved implementation plan. No proposal was created.",
            files: [...new Set(outOfScopeFiles)].slice(0, 12),
          });
          res.end();
          return;
        }
      }
      if (approvedImplementationPlan && effectiveBuildPlanMessageId) {
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiBuildCompleted",
          projectId,
          severity: "success",
          message: "Build Mode completed and produced a scoped proposal",
          correlationId: effectiveBuildPlanMessageId,
          payload: {
            messageId: effectiveBuildPlanMessageId,
            proposedChanges: result.pendingChanges?.length ?? 0,
          },
        });
      }
      // PR-05/PR-011: record successful call latency and health.
      const callLatency = Date.now() - chatStartMs;
      const effectiveProvider = chatOut.effectiveProvider ?? provider;
      recordLatency(effectiveProvider, callLatency);
      recordSuccess(effectiveProvider);
      // effectiveProvider differs from `provider` when fallback occurred
      if (chatOut.effectiveProvider && chatOut.effectiveProvider !== provider) {
        recordFallbackSuccess(provider);
      }
    } catch (err) {
      // PR-011: record failure metrics before emitting the SSE error.
      recordFailure(provider);
      executionLedgerSnapshot = executionLedgerSnapshot ?? finishExecutionLedger(executionLedger, {
        outcome: executionAbortController?.signal.aborted ? "INTERRUPTED" : "FAILED",
        trace: traceSteps,
      });
      if (err instanceof GroqClientError) {
        if (err.code === "MODEL_NOT_FOUND" || err.code === "MODEL_UNAVAILABLE") {
          recordInvalidModel(provider);
        }
        logger.error(
          { code: err.code, message: err.message, provider,
            providerStatus: err.providerStatus, providerModel: err.providerModel },
          "chat stream: all providers failed",
        );

        // Provider messages, model identifiers, paths, and upstream diagnostics
        // stay in the structured server log above. The stream exposes only the
        // bounded public error contract.
        const retryable = err.code === "RATE_LIMITED"
          || err.code === "TIMEOUT"
          || err.code === "NETWORK_ERROR"
          || err.code === "SERVER_ERROR"
          || err.code === "MODEL_UNAVAILABLE";
        sse({
          type: "error",
          code: err.code,
          message: retryable
            ? "The AI request could not complete. Please retry."
            : "The AI request was not completed because the provider configuration could not satisfy it.",
          outcome: "FAILED",
          failureKind: "PROVIDER_FAILURE",
          retryable,
          recoveryState: "REQUIRED",
          correlationId: randomUUID(),
          executionLedger: executionLedgerSnapshot,
        });
      } else {
        logger.error({ err }, "chat stream: unexpected non-GroqClientError");
        sse({
          type: "error",
          code: "unknown",
          message: "The AI provider could not complete the request. Retry in a moment or configure another provider.",
          correlationId: randomUUID(),
          executionLedger: executionLedgerSnapshot,
        });
      }
      await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: streamTurnIntent.kind,
        executionId: aiExecution?.id,
        outcome: executionAbortController?.signal.aborted ? "INTERRUPTED" : "FAILED",
        errorCode: err instanceof GroqClientError ? err.code : "UNKNOWN",
        errorMessage: "The AI provider could not complete the request.",
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
      }).catch((persistError) => logger.error({ persistError, sessionId: sessionIdToUse }, "chat stream: failed to persist provider failure"));
      res.end();
      return;
    }

    if (result._qualityError) {
      const quality = publicQualityFailure(result._qualityError);
      const safeMessage = "The AI result did not meet the quality checks required for completion.";
      const forensicDiagnostic = streamTurnIntent.requiresEvidence
        ? deriveForensicDiagnostic(traceSteps)
        : undefined;
      sse({
        type: "error",
        code: quality.code,
        message: safeMessage,
        outcome: "FAILED",
        failureKind: "QUALITY_REVIEW",
        retryable: true,
        recoveryState: "REQUIRED",
        quality,
        correlationId: randomUUID(),
        executionLedger: executionLedgerSnapshot,
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      });
      await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: streamTurnIntent.kind,
        executionId: aiExecution?.id,
        outcome: "FAILED",
        errorCode: quality.code,
        errorMessage: safeMessage,
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
        terminalOutcome: {
          failureKind: "QUALITY_REVIEW",
          retryable: true,
          recoveryState: "REQUIRED",
        },
      }).catch((persistError) => logger.error({ persistError, sessionId: sessionIdToUse }, "chat stream: quality failure persistence failed"));
      res.end();
      return;
    }

    if (result._parseError) {
      if (!result.response) {
        const forensicDiagnostic = streamTurnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        sse({
          type: "error",
          code: "model_output_invalid",
          message: "The AI request returned an unsupported response and was not completed.",
          outcome: "FAILED",
          failureKind: "PROVIDER_FAILURE",
          retryable: false,
          recoveryState: "REQUIRED",
          correlationId: randomUUID(),
          executionLedger: executionLedgerSnapshot,
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
        await persistFailedChatTurn({
          sessionId: sessionIdToUse,
          projectId,
          message,
          turnIntent: streamTurnIntent.kind,
          executionId: aiExecution?.id,
          outcome: "FAILED",
          errorCode: "MODEL_OUTPUT_INVALID",
          errorMessage: "The AI model returned an unexpected response.",
          createdAt: now,
          assistantAt: msgNow,
          toolTrace: traceSteps,
          executionLedgerSnapshot,
        }).catch((persistError) => logger.error({ persistError, sessionId: sessionIdToUse }, "chat stream: failed to persist parse failure"));
        res.end();
        return;
      }
      logger.warn(
        { parseCode: result._parseError.code, rawPreview: result._parseError.raw.slice(0, 200) },
        "AI parse failure — using fallback response",
      );
    }

    invalidateContextCache(projectId);

    // BUG-6: log language anomalies in AI responses.
    // If a response to an Arabic message contains Thai-range characters
    // (U+0E00–U+0E7F) or other unexpected scripts, record it for monitoring.
    // This catches hallucinations like "ภาษته" appearing inside Arabic prose.
    (() => {
      const hasArabic = /[\u0600-\u06FF]/.test(message);
      const thaiBidiRange = /[\u0E00-\u0E7F]/.test(result.response);
      if (hasArabic && thaiBidiRange) {
        logger.warn(
          { scope: "chat-route", action: "language_anomaly", projectId, provider,
            responsePreview: result.response.slice(0, 200) },
          "AI-06: response to Arabic message contains Thai-range characters — possible model hallucination",
        );
      }
    })();

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const compoundSourceReadObserved = streamTurnIntent.compoundWrite && traceSteps.some(
      (step) =>
        step.kind === "tool_result" &&
        (step.tool === "read_file" || step.tool === "read_file_range"),
    );
    const proposalChanges = bindPendingChangesToImplementationPlan(
      bindPendingChangesToCompoundWrite(
        bindPendingChangesToRepairPlan(
          (result.pendingChanges ?? []) as ServerPendingChange[],
          result.repairPlan,
        ),
        !streamTurnIntent.compoundWrite || compoundSourceReadObserved,
      ),
      Boolean(approvedImplementationPlan),
    );
    const proposalId = (!streamTurnIntent.compoundWrite || compoundSourceReadObserved) && canCreateProposal(
      proposalChanges,
      result.repairPlan,
      hasPassedLatestValidation(traceSteps),
      traceSteps,
    )
      ? randomUUID()
      : undefined;
    const executionPlan = buildActiveTaskExecutionPlan({
      repairPlan: result.repairPlan,
      implementationPlan: approvedImplementationPlan
        ?? (result.taskResult?.kind === "IMPLEMENTATION_PLAN_RESULT" ? result.taskResult : undefined),
      objective: result.objective ?? objective,
      evidence: result.behaviorEvidence,
      projectId,
      rootPath: validRootPath,
    });
    const activeTaskState = nextSessionTaskState({
      persisted: streamResumableStateForTurn,
      classification: streamClassification,
      resumed: streamClassificationResolution.resumed,
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      revision: analysisCorrelation.projectRevision,
      operationId: aiExecution.operationId ?? executionRequest.operationId,
      executionId: aiExecution.id,
      now: msgNow,
      readFiles: collectReadEvidencePaths(traceSteps),
      executionPlan,
    });

    const aiExecutionId = aiExecution.id;
    let missionCorrelationReport: string | null;
    try {
      missionCorrelationReport = serializeMissionCorrelationReport(
        (result as { missionCorrelationReport?: unknown }).missionCorrelationReport,
      );
    } catch (error) {
      if (error instanceof MissionCorrelationReportValidationError) {
        const safeMessage = "The forensic report could not be validated and was not completed.";
        const forensicDiagnostic = streamTurnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        sse({
          type: "error",
          code: error.code,
          message: safeMessage,
          outcome: "FAILED",
          failureKind: "RECOVERY_FAILURE",
          retryable: true,
          recoveryState: "REQUIRED",
          correlationId: randomUUID(),
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
        if (aiExecution) {
          await failAiExecution({
            executionId: aiExecution.id,
            workerId: executionWorkerId!,
            error: safeMessage,
            cancelled: false,
            nodeStates: executionNodeStates,
            recentSteps: serializeExecutionCheckpointSteps(traceSteps),
          });
        }
        await persistFailedChatTurn({
          sessionId: sessionIdToUse,
          projectId,
          message,
          turnIntent: streamTurnIntent.kind,
          executionId: aiExecution?.id,
          outcome: "FAILED",
          errorCode: error.code,
          errorMessage: safeMessage,
          createdAt: now,
          assistantAt: msgNow,
          toolTrace: traceSteps,
          executionLedgerSnapshot,
          terminalOutcome: {
            failureKind: "RECOVERY_FAILURE",
            retryable: true,
            recoveryState: "REQUIRED",
          },
        }).catch((persistError) => logger.error(
          { persistError, sessionId: sessionIdToUse },
          "chat stream: failed to persist invalid forensic report",
        ));
        res.end();
        return;
      }
      throw error;
    }
    let assistantOperationId: string | undefined = aiExecution.operationId ?? effectiveBuildPlanMessageId;
    const assistantMsg = await db.transaction(async (tx) => {
      if (existingSession) {
        await tx
          .select({ id: aiChatSessionsTable.id })
          .from(aiChatSessionsTable)
          .where(eq(aiChatSessionsTable.id, sessionIdToUse))
          .for("update");
      }
      if (!existingSession) {
        const [created] = await tx
          .insert(aiChatSessionsTable)
          .values({
            id: sessionIdToUse,
            projectId,
            // AI-TASK-001: persist task linkage so re-opened sessions remain task-aware.
            linkedTaskId: effectiveLinkedTaskId ?? null,
            activeTaskState,
            // BUG-5 fix: don't use a bare greeting as the session title.
            // "مرحبا", "Hello", "Hi" etc. give no context in the sessions list.
            // Use the first 60 chars only when the opener is substantive.
            title: (() => {
              const trimmed = message.trim();
              const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
              return (!isGreeting && trimmed.length > 10)
                ? trimmed.slice(0, 60)
                : `Session ${now.toISOString().slice(0, 16).replace("T", " ")}`;
            })(),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          throw new Error("Failed to create chat session");
        }
      }
      // A resumed execution already owns its original user turn. Only a new
      // execution appends a user message; otherwise reconnecting duplicates
      // the prompt in conversation history.
      if (!effectiveExecutionId) {
        await tx.insert(aiChatMessagesTable).values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "user",
          content: message,
          turnIntent: streamTurnIntent.kind,
          executionId: aiExecutionId,
          outcome: "SUCCEEDED",
          createdAt: now,
        });
      }
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          turnIntent: streamTurnIntent.kind,
          executionId: aiExecutionId,
          outcome: "SUCCEEDED",
          sources: JSON.stringify(redactUserFacingValue(result.sources)),
          toolTrace: appendExecutionLedgerTrace(
            serializeToolTrace(traceSteps, true, streamAuditScopeDescription),
            executionLedgerSnapshot,
          ),
          repairPlanMetadata: serializeRepairPlanMetadata(result.repairPlan),
          behaviorEvidence: serializeBehaviorEvidence(result.behaviorEvidence),
          missionCorrelationReport,
          taskResult: serializeTaskResult(result.taskResult),
          createdAt: msgNow,
        })
        .returning();
      if (proposalId || result.repairPlan || result.taskResult?.kind === "IMPLEMENTATION_PLAN_RESULT") {
        const proposalMessageId = effectiveBuildPlanMessageId ?? msg.id;
        const operationId = assistantOperationId ?? proposalMessageId;
        assistantOperationId = operationId;
        if (proposalId) {
        await tx.insert(aiChangeProposalsTable).values({
          id: proposalId,
          projectId,
          sessionId: sessionIdToUse,
          messageId: proposalMessageId,
          changes: serializeServerPendingChanges(proposalChanges),
          status: "pending",
          createdAt: msgNow,
        });
        await tx
          .update(aiExecutionsTable)
          .set({ proposalId, updatedAt: msgNow })
          .where(eq(aiExecutionsTable.id, aiExecutionId));
        }
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "AiPlanCreated",
          projectId,
          severity: "info",
          message: "AI implementation plan created and is awaiting approval",
          correlationId: operationId,
          payload: {
            messageId: proposalMessageId,
            operationId,
            proposalId: proposalId ?? null,
            buildPlanMessageId: effectiveBuildPlanMessageId ?? null,
          },
        });
      }
      await tx
        .update(aiChatSessionsTable)
        .set({
          activeTaskState,
          updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
        })
        .where(and(
          eq(aiChatSessionsTable.id, sessionIdToUse),
          sessionTaskStateIsAtOrBefore(msgNow),
        ));
      return msg;
    });

    persistExecutionCheckpoint({
      stage: "finalizing",
      streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
      recentSteps: serializeExecutionCheckpointSteps(traceSteps),
    });
    await checkpointChain;
    const finalValidation = [...traceSteps]
      .reverse()
      .find((step) => step.kind === "validation");
    if (finalValidation?.kind === "validation") {
      if (finalValidation.status === "passed") {
        const evidenceBoundToExecution =
          finalValidation.result.evidence.operationId === (aiExecution.operationId ?? aiExecution.id)
          && finalValidation.result.evidence.projectRevision === analysisCorrelation.projectRevision
          && (
            autonomousOperation?.candidateIdentity === null
            || autonomousOperation?.candidateIdentity === undefined
            || finalValidation.result.evidence.candidateHash === autonomousOperation.candidateIdentity
          );
        executionEvidenceVerdict = isProvenValidation(finalValidation.result)
          && evidenceBoundToExecution
          && !proposalId
          ? "PROVEN"
          : "PARTIAL";
        executionEvidenceReason = executionEvidenceVerdict === "PROVEN"
          ? "Registered validation passed with retained evidence bound to this execution."
          : "Validation passed, but required server-owned objective or delivery proof has not been recorded.";
      } else if (finalValidation.status === "unavailable") {
        executionEvidenceVerdict = "UNAVAILABLE";
        executionEvidenceReason = finalValidation.detail ?? "Validation could not be executed.";
      } else if (finalValidation.status === "failed" || finalValidation.status === "blocked") {
        executionEvidenceVerdict = "BLOCKED";
        executionEvidenceReason = finalValidation.detail ?? "Validation ended with an unresolved failure.";
      }
    }
    if (autonomousOperation) {
      const finalEvidenceRef = finalValidation?.kind === "validation"
        ? finalValidation.result.evidence.artifactRef
        : undefined;
      autonomousOperation = {
        ...autonomousOperation,
        state: "validating",
        nodes: executionNodeStates.map((node) => ({
          id: node.id,
          kind: executionRequest.validationTargetPaths.length > 0 ? "mutate" as const : "inspect" as const,
          dependencies: [...node.dependencies],
          status: node.status,
          attempts: node.attempts,
          validationAttempts: node.validationAttempts,
          allowedFiles: [...node.allowedFiles],
          validationProfile: node.validationProfile,
          evidenceRefs: finalEvidenceRef ? [finalEvidenceRef] : [],
        })),
        evidenceRefs: finalEvidenceRef ? [finalEvidenceRef] : autonomousOperation.evidenceRefs,
        updatedAt: new Date().toISOString(),
      };
    }
    if (checkpointFailure && !activeExecutionAbortController.signal.aborted) {
      throw new Error("AI execution checkpoint persistence failed before finalization");
    }
    if (endedBeforeEvidence) {
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: "Execution stopped before the first source read.",
        cancelled: false,
        nodeStates: executionNodeStates,
        operation: autonomousOperation,
      });
    } else if (activeExecutionAbortController.signal.aborted) {
      // Cancellation wins over completion even when the provider returns a
      // bounded incomplete report after observing the abort. The report is
      // still persisted above for reconnect/history, but the execution must
      // remain terminally cancelled rather than entering the normal success
      // finalizer (which can race the cancel endpoint's row update).
      executionTerminal = true;
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: "Execution cancelled by the user.",
        cancelled: true,
        nodeStates: executionNodeStates,
        streamedPreview: streamedContent,
        recentSteps: serializeExecutionCheckpointSteps(traceSteps),
        operation: autonomousOperation,
      });
    } else {
      const completed = await completeAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        finalMessageId: assistantMsg.id,
        proposalId,
        operation: autonomousOperation,
        nodeStates: executionNodeStates,
        evidenceVerdict: executionEvidenceVerdict,
        evidenceReason: executionEvidenceReason,
        proofRequired,
        operationId: aiExecution.operationId ?? aiExecution.id,
        candidateIdentity: autonomousOperation?.candidateIdentity,
        evidenceRefs: finalValidation?.kind === "validation"
          ? [finalValidation.result.evidence.artifactRef]
          : [],
        evidence: finalValidation?.kind === "validation"
          ? [finalValidation.result.evidence]
          : [],
      });
      if (!completed) {
        const acceptanceError = "Execution is incomplete: required acceptance evidence is missing, stale, or not bound to this revision.";
        const acceptanceDisposition = publicAcceptanceDisposition({
          code: "EXECUTION_ACCEPTANCE_INCOMPLETE",
          outcome: "FAILED",
          failureKind: "INCOMPLETE",
          recoveryState: "INCOMPLETE",
        })!;
        await db
          .update(aiChatMessagesTable)
          .set({
            outcome: "FAILED",
            errorCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
            errorMessage: acceptanceError,
            toolTrace: JSON.stringify([
              ...(Array.isArray(parseStoredJson(assistantMsg.toolTrace))
                ? parseStoredJson(assistantMsg.toolTrace) as unknown[]
                : []),
              {
                kind: "terminal_outcome",
                code: "EXECUTION_ACCEPTANCE_INCOMPLETE",
                outcome: "FAILED",
                failureKind: "INCOMPLETE",
                retryable: true,
                recoveryState: "INCOMPLETE",
                acceptanceDisposition,
              },
            ]),
          })
          .where(eq(aiChatMessagesTable.id, assistantMsg.id));
        await failAiExecution({
          executionId: aiExecution.id,
          workerId: executionWorkerId!,
          error: acceptanceError,
          cancelled: false,
          nodeStates: executionNodeStates,
          operation: undefined,
          acceptanceDisposition,
        });
        executionTerminal = true;
        sse({
          type: "error",
          code: "EXECUTION_ACCEPTANCE_INCOMPLETE",
          message: acceptanceError,
          outcome: "FAILED",
          failureKind: "INCOMPLETE",
          retryable: true,
          recoveryState: "INCOMPLETE",
          acceptanceDisposition,
          executionId: aiExecution.id,
          sessionId: sessionIdToUse,
          executionLedger: executionLedgerSnapshot,
        });
        // Do not fall through to the successful done envelope. The retained
        // assistant row is now explicitly failed and remains visible on reload.
        res.end();
        return;
      }
      sse({
        type: "recipe_terminal",
        executionId: aiExecution.id,
        status: activeExecutionAbortController.signal.aborted ? "cancelled" : "completed",
        completedNodeIds: executionNodeStates.filter((node) => node.status === "passed").map((node) => node.id),
      });
    }
    executionTerminal = true;

    // Evidence-bound and forensic plans are stateless in both directions.
    if (streamExecutionPlan.taskProfile.memoryMode !== "none") {
      try {
        await writeSessionMemories(
          sessionIdToUse,
          projectId,
          redactUserFacingValue(result.sources),
          sanitizeResponseText(result.response),
          assistantMsg.id,
          {
            outcome: "SUCCEEDED",
            turnIntent: streamTurnIntent.kind,
            memoryMode: streamExecutionPlan.taskProfile.memoryMode,
            userMessage: message,
            taskScope: streamExecutionPlan.taskProfile.scope,
            projectRevision: project.updatedAt.toISOString(),
            taskResult: result.taskResult,
          },
        );
      } catch (err) {
        logger.warn({ err, projectId }, "memory-write: failed to persist session memories (stream)");
      }
    }

    // PR-010: surface latency and model info in done event.
    const chatLatencyMs = Date.now() - chatStartMs;
    const operationMode =
      proposalId
      || result.repairPlan
      || result.taskResult?.kind === "IMPLEMENTATION_PLAN_RESULT"
      || Boolean(effectiveBuildPlanMessageId)
        ? "DELIVERY"
        : streamTurnIntent.operationMode;

    const publicToolTrace = streamTurnIntent.requiresEvidence
        ? appendExecutionLedgerTrace(
            serializeToolTrace(traceSteps, false, streamAuditScopeDescription),
            executionLedgerSnapshot,
          )
      : assistantMsg.toolTrace;
    const forensicDiagnostic = streamTurnIntent.requiresEvidence
      ? deriveForensicDiagnostic(traceSteps)
      : undefined;
    // The database row is intentionally retained with full diagnostics, but
    // every SSE projection of that row must use the public trace.
    assistantMsg.toolTrace = publicToolTrace;
    const publicExecutionSummary = projectPublicExecutionSummary(executionSummary, true);
    const publicAssistantMsg = {
      id: assistantMsg.id,
      sessionId: assistantMsg.sessionId,
      role: assistantMsg.role,
      content: assistantMsg.content,
      sources: assistantMsg.sources,
      repairPlanMetadata: assistantMsg.repairPlanMetadata,
      behaviorEvidence: assistantMsg.behaviorEvidence,
      createdAt: assistantMsg.createdAt,
      toolTrace: publicToolTrace,
      turnIntent: streamTurnIntent.kind,
      executionId: aiExecutionId,
      outcome: "SUCCEEDED",
      executionLedger: executionLedgerSnapshot,
      ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
    };
    sse({
      type: "done",
      sessionId: sessionIdToUse,
      message: {
        ...publicAssistantMsg,
        taskResult: parseTaskResult(assistantMsg.taskResult),
      },
      sources: redactUserFacingValue(result.sources),
      toolTrace: publicToolTrace,
      pendingChanges: proposalId
        ? proposalChanges
        : [],
      proposalId,
      operationId: assistantOperationId,
      operationMode,
      proposalUnavailable: (result.pendingChanges?.length ?? 0) > 0 && !proposalId
        ? hasPassedLatestValidation(traceSteps)
          ? "Repair changes require closed Finding/claim evidence before approval."
          : "Repair changes require a verified validation profile before approval."
        : undefined,
      repairPlan: redactUserFacingValue(result.repairPlan),
      productionReachability: result.productionReachability,
      crossFileTraces: redactUserFacingValue(result.crossFileTraces),
      // Exact source line spans for each accepted behavior-evidence excerpt so the
      // dashboard can show where the proof comes from.
      behaviorEvidence: redactUserFacingValue(result.behaviorEvidence),
      // AI-008: per-task typed result discriminated on `kind` by forensicTaskType
      taskResult: redactUserFacingValue(result.taskResult),
      // PR-010: telemetry fields for client observability
      telemetry: {
        latencyMs: chatLatencyMs,
      },
      execution: publicExecutionSummary,
      executionLedger: executionLedgerSnapshot,
      ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      _meta: rootFallbackUsed
        ? { rootPathFallback: { used: true, original: rootOriginalPath } }
        : undefined,
    });
    res.end();
    return;
  } finally {
    if (aiExecution && !executionTerminal) {
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: executionAbortController?.signal.aborted
          ? "Execution cancelled by the user."
          : "Execution ended before reaching a terminal result.",
        cancelled: executionAbortController?.signal.aborted,
        nodeStates: executionNodeStates,
      }).catch((err) => {
        logger.warn({ err, executionId: aiExecution!.id }, "AI execution terminal-state update failed");
      });
      executionTerminal = true;
    }
    if (aiExecution) {
      if (executionAbortController) {
        unregisterAiExecutionController(aiExecution.id, executionAbortController);
      }
    }
    await applyLock.release();
  }
});

// ── Durable AI execution control plane ────────────────────────────────────────

router.get("/ai/executions/history", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const parsedLimit = Number(req.query.limit);
  const limit = Number.isInteger(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 20;
  const executions = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.projectId, project.id),
      eq(aiExecutionsTable.userId, req.userId),
      inArray(aiExecutionsTable.status, ["paused", "cancelled", "failed"]),
    ))
    .orderBy(desc(aiExecutionsTable.updatedAt))
    .limit(limit);

  const safeText = (value: unknown, fallback: string, max = 240): string => {
    if (typeof value !== "string" || !value.trim()) return fallback;
    return redactUserFacingText(value).slice(0, max);
  };
  return res.json(executions.map((execution) => {
    const request = parseExecutionRequest(execution.request);
    const checkpoint = parseAiExecutionCheckpoint(execution.checkpoint);
    const checkpointRecord = checkpoint && typeof checkpoint === "object"
      ? checkpoint as Record<string, unknown>
      : {};
    const hasPendingProposal = Boolean(execution.proposalId);
    const proofRequired = checkpointRecord.proofRequired === true
      || Boolean(execution.linkedTaskId || execution.buildPlanMessageId || execution.proposalId);
    const evidenceVerdict = derivePersistedEvidenceVerdict({
      executionStatus: execution.status,
      checkpoint: checkpointRecord,
      hasPendingProposal,
    });
    const acceptanceDisposition = publicAcceptanceDisposition({
      value: checkpointRecord.acceptanceDisposition,
      code: execution.error === "Execution is incomplete: required acceptance evidence is missing, stale, or not bound to this revision."
        ? "EXECUTION_ACCEPTANCE_INCOMPLETE"
        : undefined,
      status: execution.status,
      proofRequired,
      evidenceVerdict,
    });
    const resumable = execution.status === "paused" || execution.status === "failed";
    const disposition = evidenceVerdict === "PROVEN"
      ? "RETAIN_FOR_REVIEW"
      : "NEW_RUN_RECOMMENDED";
    return {
      id: execution.id,
      projectId: execution.projectId,
      sessionId: execution.sessionId,
      status: execution.status,
      objective: safeText(
        typeof request?.objective === "string"
          ? request.objective
          : request?.message,
        "AI audit execution",
        500,
      ),
      evidenceVerdict,
      evidenceReason: acceptanceDisposition
        ? "Required acceptance evidence was not proven for this run."
        : typeof checkpointRecord.evidenceReason === "string"
        ? safeText(checkpointRecord.evidenceReason, "", 500)
        : null,
      ...(acceptanceDisposition ? { acceptanceDisposition } : {}),
      terminalReason: execution.status === "cancelled"
        ? "Audit was cancelled before completion."
        : execution.status === "failed"
          ? "Execution stopped before a complete result was recorded."
          : "Execution is paused at a durable checkpoint.",
      proofRequired,
      disposition,
      recommendedAction: disposition === "RETAIN_FOR_REVIEW"
        ? "REVIEW_RETAINED_PROOF"
        : resumable ? "RESUME_CHECKPOINT" : "START_NEW_RUN",
      resumable,
      checkpointVersion: execution.checkpointVersion,
      operationId: execution.operationId,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
      completedAt: execution.completedAt,
    };
  }));
});

router.get("/ai/executions/:executionId", async (req, res) => {
  const execution = await getAiExecutionForUser(req.params.executionId, req.userId);
  if (!execution) return res.status(404).json({ error: "AI execution not found" });

  let checkpoint: unknown = {};
  try {
    checkpoint = JSON.parse(execution.checkpoint);
  } catch {
    checkpoint = { stage: "unknown", detail: "Checkpoint is unavailable." };
  }
  const checkpointRecord =
    checkpoint && typeof checkpoint === "object"
      ? checkpoint as Record<string, unknown>
      : {};
  const storedRequest = parseExecutionRequest(execution.request);
  let operationId = execution.operationId ?? execution.buildPlanMessageId ?? execution.proposalId ?? null;
  if (!execution.operationId && execution.proposalId) {
    const [proposal] = await db
      .select({ messageId: aiChangeProposalsTable.messageId })
      .from(aiChangeProposalsTable)
      .where(eq(aiChangeProposalsTable.id, execution.proposalId))
      .limit(1);
    operationId = proposal?.messageId ?? operationId;
  }
  const operationEvents = operationId
    ? await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(and(
        eq(eventsTable.projectId, execution.projectId),
        eq(eventsTable.correlationId, operationId),
      ))
    : [];
  const hasAppliedChanges = operationEvents.some((event) => event.type === "AiChangesApplied");
  const hasCommittedChanges = operationEvents.some((event) => event.type === "GitCommitCreated");
  const hasPushedChanges = operationEvents.some((event) => event.type === "GitPushed");
  const hasPendingProposal = Boolean(execution.proposalId);
  const proofRequired = checkpointRecord.proofRequired === true
    || Boolean(execution.linkedTaskId || execution.buildPlanMessageId || execution.proposalId);
  const evidenceVerdict = derivePersistedEvidenceVerdict({
    executionStatus: execution.status,
    checkpoint: checkpointRecord,
    hasPendingProposal,
  });
  const acceptanceDisposition = publicAcceptanceDisposition({
    value: checkpointRecord.acceptanceDisposition,
    code: execution.error === "Execution is incomplete: required acceptance evidence is missing, stale, or not bound to this revision."
      ? "EXECUTION_ACCEPTANCE_INCOMPLETE"
      : undefined,
    status: execution.status,
    proofRequired,
    evidenceVerdict,
  });
  const operationRecord = checkpointRecord.operation && typeof checkpointRecord.operation === "object"
    ? checkpointRecord.operation as Record<string, unknown>
    : undefined;
  const recoveryRecord = checkpointRecord.recovery && typeof checkpointRecord.recovery === "object"
    ? checkpointRecord.recovery as Record<string, unknown>
    : undefined;
  const operationEvidence = await loadOperationEvidence(execution);

  return res.json({
    id: execution.id,
    projectId: execution.projectId,
    sessionId: execution.sessionId,
    objective: storedRequest?.objective,
    linkedTaskId: execution.linkedTaskId,
    buildPlanMessageId: execution.buildPlanMessageId,
    status: execution.status,
    attempt: execution.attempt,
    projectRevision: typeof storedRequest?.workspaceRevision === "string"
      ? storedRequest.workspaceRevision
      : null,
    flightState: deriveFlightDeckState({
      executionStatus: execution.status,
      checkpointStage: typeof checkpointRecord.stage === "string" ? checkpointRecord.stage : undefined,
      repairState: typeof checkpointRecord.repairState === "string" ? checkpointRecord.repairState : undefined,
      hasPendingProposal,
        hasAppliedChanges,
        hasCommittedChanges,
        hasPushedChanges,
      evidenceVerdict,
      proofRequired,
    }),
    proofRequired,
    evidenceVerdict,
    evidenceReason: acceptanceDisposition
      ? "Required acceptance evidence was not proven for this run."
      : typeof checkpointRecord.evidenceReason === "string"
      ? checkpointRecord.evidenceReason
      : undefined,
    ...(acceptanceDisposition ? { acceptanceDisposition } : {}),
    terminalReason: acceptanceDisposition
      ? "EXECUTION_ACCEPTANCE_INCOMPLETE"
      : execution.error
      ?? (typeof checkpointRecord.detail === "string" ? checkpointRecord.detail : null),
         checkpoint: sanitizeExecutionCheckpointForClient(checkpoint),
    checkpointVersion: execution.checkpointVersion,
    finalMessageId: execution.finalMessageId,
    proposalId: execution.proposalId,
    operationId,
    // Provider and worker errors are retained for server diagnostics only.
    // Historical/operator views receive a safe terminal description instead.
    error: execution.error
      ? "Execution stopped before a complete result was recorded."
      : null,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    resumable: execution.status === "paused" || execution.status === "failed",
    recovery: {
      uncertain: operationRecord?.state === "uncertain",
      operationId,
      revision: typeof storedRequest?.workspaceRevision === "string" ? storedRequest.workspaceRevision : null,
      phase: typeof operationRecord?.state === "string" ? operationRecord.state : null,
      outcome: typeof recoveryRecord?.outcome === "string" ? recoveryRecord.outcome : null,
    },
    // Keep the operator proof chain on the same owner-scoped status response
    // used after reload/reconnect. This is already a redacted projection; raw
    // provider, model, and workspace diagnostics never cross this boundary.
    operationEvidence: redactOperationEvidence(operationEvidence),
      ...(execution.recipeReceipt ? { recipeReceipt: toPublicRecipeReceipt(execution.recipeReceipt) } : {}),
  });
});

/**
 * Return a portable, content-minimized audit record. This deliberately does
 * not reuse the full execution response: checkpoints may contain model
 * previews and event payloads may contain implementation details that are not
 * appropriate for an operator handoff.
 */
router.get("/ai/executions/:executionId/audit-export", async (req, res) => {
  const execution = await getAiExecutionForUser(req.params.executionId, req.userId);
  if (!execution) return res.status(404).json({ error: "AI execution not found" });
  const operationEvidence = await loadOperationEvidence(execution);

  const parseRecord = (raw: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(raw);
      return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  };
  const request = parseRecord(execution.request);
  const checkpoint = parseRecord(execution.checkpoint);
  const safePath = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !value || value.startsWith("/")
      || value.includes("..") || value.includes("\\")
      || /(?:^|\/)(?:home|tmp|private|runtime)(?:\/|$)/i.test(value)) return undefined;
    return value.slice(0, 500);
  };
  const safePaths = (value: unknown): string[] => Array.isArray(value)
    ? value.map(safePath).filter((item): item is string => Boolean(item)).slice(0, 200)
    : [];
  const safeText = (value: unknown, limit = 500): string | undefined =>
    typeof value === "string" ? redactUserFacingText(value).slice(0, limit) : undefined;

  const operationId = execution.operationId ?? execution.correlationId ?? execution.id;
  const events = await db
    .select({
      id: eventsTable.id,
      type: eventsTable.type,
      severity: eventsTable.severity,
      message: eventsTable.message,
      timestamp: eventsTable.timestamp,
      payload: eventsTable.payload,
    })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, execution.projectId),
      eq(eventsTable.correlationId, operationId),
    ))
    .orderBy(eventsTable.timestamp, eventsTable.id);

  const timeline = [
    {
      timestamp: execution.createdAt,
      type: "execution_created",
      status: "queued",
      detail: "Execution created",
    },
    ...events.map((event) => {
      const payload = event.payload ?? {};
      const safePayload: Record<string, unknown> = {};
      for (const key of ["status", "phase", "profile", "scenario", "exitCode", "attempt", "checkpointVersion"]) {
        const value = payload[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          safePayload[key] = value;
        }
      }
      const paths = safePaths(payload.paths ?? payload.files ?? payload.affectedFiles);
      if (paths.length) safePayload.files = paths;
      return {
        timestamp: event.timestamp,
        type: event.type,
        severity: event.severity,
        detail: safeText(event.message, 500),
        ...(Object.keys(safePayload).length ? { details: safePayload } : {}),
      };
    }),
    ...(execution.startedAt ? [{
      timestamp: execution.startedAt,
      type: "execution_started",
      status: "running",
      detail: "Execution started",
    }] : []),
    ...(execution.completedAt ? [{
      timestamp: execution.completedAt,
      type: `execution_${execution.status}`,
      status: execution.status,
      detail: safeText(execution.error ?? checkpoint.detail ?? `Execution ${execution.status}`, 500),
    }] : []),
  ].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  const checkpointNodes = Array.isArray(checkpoint.nodeStates) ? checkpoint.nodeStates : [];
  const affectedFiles = Array.from(new Set([
    ...safePaths(request.validationTargetPaths),
    ...checkpointNodes.flatMap((node) => node && typeof node === "object"
      ? safePaths((node as Record<string, unknown>).allowedFiles)
      : []),
  ])).sort();
  const validations = Array.isArray(checkpoint.recentSteps)
    ? checkpoint.recentSteps.flatMap((step) => {
      if (!step || typeof step !== "object" || (step as Record<string, unknown>).kind !== "validation") return [];
      const value = step as Record<string, unknown>;
      const validation = value.validation && typeof value.validation === "object"
        ? value.validation as Record<string, unknown>
        : value;
      return [{
        status: safeText(validation.status, 80) ?? "unknown",
        profile: safeText(validation.profile, 160),
        scenario: safeText(validation.scenario, 240),
        exitCode: typeof validation.exitCode === "number" ? validation.exitCode : null,
        detail: safeText(validation.detail, 500),
        ...(validation.reasonCode === "ownership"
          || validation.reasonCode === "invalid_profile"
          || validation.reasonCode === "resource_limit"
          || validation.reasonCode === "stale_revision"
          ? { reasonCode: validation.reasonCode } : {}),
      }];
    })
    : [];

  const body = {
    format: "engineeringos.execution-audit.v1",
    exportedAt: new Date().toISOString(),
    execution: {
      id: execution.id,
      projectId: execution.projectId,
      sessionId: execution.sessionId,
      operationId,
      objective: safeText(request.objective, 1_000),
      status: execution.status,
      terminalState: execution.status,
      attempt: execution.attempt,
      revision: safeText(request.workspaceRevision, 200) ?? null,
      proof: {
        required: checkpoint.proofRequired === true,
        verdict: safeText(checkpoint.evidenceVerdict, 80) ?? "NOT_RECORDED",
        reason: safeText(checkpoint.evidenceReason, 500) ?? null,
      },
      checkpointVersion: execution.checkpointVersion,
      createdAt: execution.createdAt,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      terminalReason: safeText(execution.error ?? checkpoint.detail, 500) ?? null,
    },
    operationEvidence: redactOperationEvidence(operationEvidence),
    timeline,
    validations,
    affectedFiles,
    redaction: {
      excluded: ["provider secrets", "raw model output", "private runtime paths"],
    },
  };
  res.setHeader("Content-Disposition", `attachment; filename="execution-${execution.id}-audit.json"`);
  return res.json(body);
});

router.post("/ai/executions/:executionId/recovery", async (req, res) => {
  const parsed = z.object({
    action: z.enum(["resume", "abandon"]),
    revision: z.string().min(1).max(2_000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Recovery action must be resume or abandon." });
  const recovered = await requestAiExecutionRecovery({
    executionId: req.params.executionId,
    userId: req.userId,
    ...parsed.data,
  });
  if (!recovered) return res.status(404).json({ error: "AI execution not found" });
  if (recovered.outcome === "stale") {
    return res.status(409).json({ error: "This recovery request targets a stale workspace revision.", code: "EXECUTION_STALE" });
  }
  if (recovered.outcome === "not_eligible") {
    return res.status(409).json({ error: "This execution is not eligible for operator recovery.", code: "EXECUTION_NOT_RECOVERABLE" });
  }
  return res.json({
    executionId: recovered.execution.id,
    operationId: recovered.execution.operationId,
    status: recovered.execution.status,
    outcome: recovered.outcome,
    ...(recovered.resumeToken ? { resumeToken: recovered.resumeToken } : {}),
  });
});

router.post("/ai/executions/:executionId/resume-capability", async (req, res) => {
  const recovered = await recoverAiExecutionResumeToken({
    executionId: req.params.executionId,
    userId: req.userId,
  });
  if (recovered) {
    return res.json({
      executionId: recovered.execution.id,
      resumeToken: recovered.resumeToken,
    });
  }

  const current = await getAiExecutionForUser(req.params.executionId, req.userId);
  if (!current) return res.status(404).json({ error: "AI execution not found" });
  return res.status(409).json({
    error: "This AI execution is no longer eligible for resume.",
    code: "EXECUTION_NOT_RESUMABLE",
    status: current.status,
  });
});

router.post("/ai/executions/:executionId/cancel", async (req, res) => {
  const execution = await requestAiExecutionCancel({
    executionId: req.params.executionId,
    userId: req.userId,
  });
  if (!execution) {
    const current = await getAiExecutionForUser(req.params.executionId, req.userId);
    if (!current) return res.status(404).json({ error: "AI execution not found" });
    return res.status(409).json({
      error: `Execution is already ${current.status}.`,
      code: "EXECUTION_NOT_CANCELLABLE",
      status: current.status,
    });
  }
  return res.json({
    id: execution.id,
    status: execution.status,
    cancelRequestedAt: execution.cancelRequestedAt,
  });
});

// ── GET /api/ai/chat/sessions ────────────────────────────────────────────────

router.get("/ai/chat/sessions", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const sessions = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.projectId, project.id))
    .orderBy(desc(aiChatSessionsTable.updatedAt))
    .limit(20);

  if (sessions.length === 0) return res.json(sessions);

  const messages = await db
    .select({
      id: aiChatMessagesTable.id,
      sessionId: aiChatMessagesTable.sessionId,
      role: aiChatMessagesTable.role,
      content: aiChatMessagesTable.content,
      toolTrace: aiChatMessagesTable.toolTrace,
      createdAt: aiChatMessagesTable.createdAt,
    })
    .from(aiChatMessagesTable)
    .where(inArray(aiChatMessagesTable.sessionId, sessions.map((session) => session.id)))
    .orderBy(desc(aiChatMessagesTable.createdAt), desc(aiChatMessagesTable.id));

  const latestAssistantBySession = new Map<string, (typeof messages)[number]>();
  for (const message of messages) {
    if (message.role === "assistant" && !latestAssistantBySession.has(message.sessionId)) {
      latestAssistantBySession.set(message.sessionId, message);
    }
  }

  return res.json(sessions.map((session) => {
    const latest = latestAssistantBySession.get(session.id);
    if (!latest) return session;

    const trace = latest.toolTrace ? parseStoredJson(latest.toolTrace) : [];
    const traceEntries = Array.isArray(trace) ? trace : [];
    const cancelled = traceEntries.some(
      (entry) => entry && typeof entry === "object" && (
        (entry as { stopReason?: unknown }).stopReason === "cancelled"
        || (entry as { diagnosticCodes?: unknown }).diagnosticCodes instanceof Array
          && (entry as { diagnosticCodes: unknown[] }).diagnosticCodes.some((code) =>
            typeof code === "string" && code.includes("CANCEL"),
          )
      ),
    ) || /\bANALYSIS_INCOMPLETE\b/i.test(latest.content);
    if (cancelled) return { ...session, forensicStatus: "INCOMPLETE" as const };

    const finalJudgment = latest.content.match(
      /##\s*6\)\s*Final Judgment([\s\S]*?)(?=\n##\s+\d+\)|$)/i,
    )?.[1] ?? "";
    if (/\bNO FINDING\b/i.test(finalJudgment)) {
      return { ...session, forensicStatus: "NO_FINDING" as const };
    }
    if (/\bFINDING PROVEN\b/i.test(finalJudgment)) {
      return { ...session, forensicStatus: "FINDING_PROVEN" as const };
    }
    if (/\bNOT PROVEN\b/i.test(finalJudgment)) {
      return { ...session, forensicStatus: "NOT_PROVEN" as const };
    }
    return session;
  }));
});

// ── POST /api/ai/chat/:sessionId/messages/:messageId/mission-correlation-report/regenerate
//
// This is deliberately report-specific: it updates one nullable enrichment
// field and never creates a chat message or reruns the conversation.
router.post("/ai/chat/:sessionId/messages/:messageId/mission-correlation-report/regenerate", async (req, res) => {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return res.status(400).json({ error: "This report recovery action does not accept a request body.", code: "REPORT_REGENERATION_BODY_NOT_ALLOWED" });
  }
  const { sessionId, messageId } = req.params;
  const sessionRows = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return res.status(404).json({ error: "Chat session not found", code: "SESSION_NOT_FOUND" });
  const project = await loadProjectByIdForUser(session.projectId, req.userId, res);
  if (!project) return;

  const [target] = await db
    .select({
      id: aiChatMessagesTable.id,
      role: aiChatMessagesTable.role,
      missionCorrelationReport: aiChatMessagesTable.missionCorrelationReport,
      executionId: aiChatMessagesTable.executionId,
    })
    .from(aiChatMessagesTable)
    .where(and(
      eq(aiChatMessagesTable.id, messageId),
      eq(aiChatMessagesTable.sessionId, sessionId),
    ))
    .limit(1);
  if (!target) return res.status(404).json({ error: "Chat message not found", code: "MESSAGE_NOT_FOUND" });
  if (target.role !== "assistant") {
    return res.status(409).json({ error: "Only assistant run reports can be regenerated.", code: "REPORT_REGENERATION_NOT_ELIGIBLE" });
  }
  if (!target.missionCorrelationReport) {
    return res.status(409).json({ error: "This historical run has no unavailable report to regenerate.", code: "REPORT_REGENERATION_NOT_ELIGIBLE" });
  }
  if (!parseMissionCorrelationReportForHistory(target.missionCorrelationReport).unavailable) {
    return res.status(409).json({ error: "This historical mission report is already available.", code: "REPORT_ALREADY_AVAILABLE" });
  }

  const messages = await db
    .select({
      id: aiChatMessagesTable.id,
      role: aiChatMessagesTable.role,
      sources: aiChatMessagesTable.sources,
      toolTrace: aiChatMessagesTable.toolTrace,
      behaviorEvidence: aiChatMessagesTable.behaviorEvidence,
      taskResult: aiChatMessagesTable.taskResult,
      outcome: aiChatMessagesTable.outcome,
      errorCode: aiChatMessagesTable.errorCode,
    })
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId))
    .orderBy(aiChatMessagesTable.createdAt)
    .limit(REPORT_REGENERATION_MAX_MESSAGES);
  const [execution] = target.executionId
    ? await db
      .select({
        id: aiExecutionsTable.id,
        operationId: aiExecutionsTable.operationId,
        request: aiExecutionsTable.request,
        checkpoint: aiExecutionsTable.checkpoint,
        checkpointVersion: aiExecutionsTable.checkpointVersion,
        status: aiExecutionsTable.status,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, target.executionId),
        eq(aiExecutionsTable.sessionId, sessionId),
        eq(aiExecutionsTable.projectId, session.projectId),
      ))
      .limit(1)
    : [];
  const proposals = await db
    .select({ id: aiChangeProposalsTable.id })
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.sessionId, sessionId))
    .limit(REPORT_REGENERATION_MAX_EVENTS);
  const operationId = execution?.operationId ?? execution?.id ?? target.executionId ?? messageId;
  const events = await db
    .select({ type: eventsTable.type })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, session.projectId),
      eq(eventsTable.correlationId, operationId),
    ))
    .limit(REPORT_REGENERATION_MAX_EVENTS);

  let report: ReturnType<typeof buildRegeneratedMissionCorrelationReport>;
  try {
    report = buildRegeneratedMissionCorrelationReport({
      projectId: session.projectId,
      sessionId,
      messageId,
      projectUpdatedAt: project.updatedAt,
      messages,
      execution,
      proposals: proposals.length,
      events,
    });
  } catch {
    return res.status(409).json({
      error: "The retained evidence is insufficient to regenerate this report.",
      code: "REPORT_REGENERATION_NOT_ELIGIBLE",
    });
  }
  const serialized = serializeMissionCorrelationReport(report);
  const [updated] = await db
    .update(aiChatMessagesTable)
    .set({ missionCorrelationReport: serialized })
    .where(and(
      eq(aiChatMessagesTable.id, messageId),
      eq(aiChatMessagesTable.sessionId, sessionId),
    ))
    .returning({ id: aiChatMessagesTable.id, missionCorrelationReport: aiChatMessagesTable.missionCorrelationReport });
  if (!updated) return res.status(404).json({ error: "Chat message not found", code: "MESSAGE_NOT_FOUND" });
  return res.json({
    messageId: updated.id,
    missionCorrelationReport: projectMissionCorrelationReportForExport(parseStoredJson(serialized)),
  });
});

// ── GET /api/ai/chat/:sessionId/messages ─────────────────────────────────────

router.get("/ai/chat/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;

  const sessionRows = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return res.status(404).json({ error: "Chat session not found", code: "SESSION_NOT_FOUND" });

  if (session.projectId) {
    const ownerProject = await loadProjectByIdForUser(session.projectId, req.userId, res);
    if (!ownerProject) return;
  }

  const messages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId))
    .orderBy(aiChatMessagesTable.createdAt);

  return res.json(messages.map((message) => {
    const historicalReport = parseMissionCorrelationReportForHistory(message.missionCorrelationReport);
    const terminalMetadata = terminalMetadataFromTrace(message.toolTrace);
    return {
      ...message,
      content: redactUserFacingText(message.content),
      sources: message.sources
        ? JSON.stringify(redactUserFacingValue(parseStoredJson(message.sources)))
        : message.sources,
      toolTrace: redactHistoricalToolTrace(message.toolTrace),
      turnIntent: message.turnIntent,
      executionId: message.executionId,
      outcome: message.outcome,
      errorCode: boundedPublicErrorCode(message.errorCode),
      errorMessage: message.errorMessage ? redactUserFacingText(message.errorMessage) : message.errorMessage,
      ...terminalMetadata,
      repairPlan: redactUserFacingValue(parseRepairPlanMetadata(message.repairPlanMetadata)),
      behaviorEvidence: redactUserFacingValue(parseBehaviorEvidence(message.behaviorEvidence)),
      ...(historicalReport.unavailable
        ? { missionCorrelationReport: undefined, missionCorrelationReportError: true }
        : { missionCorrelationReport: historicalReport.report }),
      taskResult: redactUserFacingValue(parseTaskResult(message.taskResult)),
      executionLedger: readExecutionLedgerTrace(message.toolTrace),
    };
  }));
});

// ── POST /api/ai/chat/plans/:messageId/decision ──────────────────────────────
//
// A plan decision is persisted on the assistant message that produced the
// plan. The session join and project ownership check prevent a user from
// approving a plan from another project. Approval stages Build Mode only; it
// does not apply changes, run commands, commit, or publish.
router.post("/ai/chat/plans/:messageId/decision", async (req, res) => {
  const body = z.object({
    decision: z.enum(["approve", "reject"]),
  }).strict().safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: body.error.issues[0]?.message ?? "decision must be approve or reject",
      code: "PLAN_DECISION_INVALID",
    });
  }

  const [row] = await db
    .select({
      message: aiChatMessagesTable,
      session: aiChatSessionsTable,
    })
    .from(aiChatMessagesTable)
    .innerJoin(
      aiChatSessionsTable,
      eq(aiChatMessagesTable.sessionId, aiChatSessionsTable.id),
    )
    .where(eq(aiChatMessagesTable.id, req.params.messageId))
    .limit(1);

  if (!row) {
    return res.status(404).json({ error: "Implementation plan not found", code: "PLAN_NOT_FOUND" });
  }

  const project = await loadProjectByIdForUser(row.session.projectId, req.userId, res);
  if (!project) return;

  const originalTaskResult = row.message.taskResult;
  if (!originalTaskResult) {
    return res.status(400).json({
      error: "The selected message does not contain an implementation plan",
      code: "PLAN_INVALID",
    });
  }
  const current = parseTaskResult(originalTaskResult);
  if (!current || current.kind !== "IMPLEMENTATION_PLAN_RESULT") {
    return res.status(400).json({
      error: "The selected message does not contain an implementation plan",
      code: "PLAN_INVALID",
    });
  }
  if (current.approvalStatus !== "PENDING_APPROVAL") {
    return res.status(409).json({
      error: "This implementation plan already has a decision",
      code: "PLAN_DECISION_ALREADY_MADE",
      approvalStatus: current.approvalStatus,
    });
  }
  // Older pending plans predate the revision manifest. Keep their review
  // decision migration-compatible; Build Mode still requires a manifest and
  // therefore cannot use one of these plans for writes.
  if (body.data.decision === "approve" && current.contextManifest) {
    const rootCheck = await resolveRootPath(project.rootPath, row.session.projectId);
    if (!rootCheck.validRootPath) {
      return res.status(409).json({
        error: "The project root is unavailable. Restore the project root and complete a fresh scan before approving this plan.",
        code: "PLAN_CONTEXT_INCOMPLETE",
      });
    }
    const contextFailure = await validatePlanContextForExecution(
      current,
      row.session.projectId,
      rootCheck.validRootPath,
    );
    if (contextFailure) return res.status(409).json(contextFailure);
    const browserProfileFailure = await validateBrowserProfileForDelivery(
      project.id,
      project.updatedAt.toISOString(),
      current.browserValidationProfile,
    );
    if (browserProfileFailure) return res.status(409).json(browserProfileFailure);
  }
    if (body.data.decision === "approve" && !hasSafeImplementationPlanFileScope(current)) {
      return res.status(409).json({
        error: "This implementation plan has no verified file scope and cannot enter Build Mode",
        code: "PLAN_FILE_SCOPE_REQUIRED",
        approvalStatus: current.approvalStatus,
      });
    }

  const nextPlan = {
    ...current,
    approvalStatus: body.data.decision === "approve" ? "APPROVED" as const : "REJECTED" as const,
    writeAccess: body.data.decision === "approve"
      ? "APPROVED_FOR_BUILD" as const
      : "NOT_AUTHORIZED" as const,
  };
  const parsed = ChatTaskResultSchema.safeParse(nextPlan);
  if (!parsed.success) {
    logger.error({ scope: "chat-route", code: "PLAN_DECISION_SCHEMA_FAILED", issues: parsed.error.issues });
    return res.status(500).json({ error: "Could not persist the plan decision", code: "PLAN_DECISION_SCHEMA_FAILED" });
  }

  // Compare-and-set against the original JSON to make concurrent clicks
  // one-shot: only the first decision can transition the pending plan.
  const updated = await db
    .update(aiChatMessagesTable)
    .set({ taskResult: serializeTaskResult(parsed.data) })
    .where(and(
      eq(aiChatMessagesTable.id, row.message.id),
      eq(aiChatMessagesTable.taskResult, originalTaskResult),
    ))
    .returning({ id: aiChatMessagesTable.id });

  if (updated.length === 0) {
    return res.status(409).json({
      error: "This implementation plan was decided by another request",
      code: "PLAN_DECISION_CONFLICT",
    });
  }

  await db.insert(eventsTable).values({
    id: randomUUID(),
    type: body.data.decision === "approve" ? "AiPlanApproved" : "AiPlanRejected",
    projectId: project.id,
    severity: body.data.decision === "approve" ? "success" : "warning",
    message: body.data.decision === "approve"
      ? "AI implementation plan approved for build"
      : "AI implementation plan rejected",
    correlationId: row.message.id,
    payload: { messageId: row.message.id, decision: body.data.decision },
  });

  await db
    .update(aiChatSessionsTable)
    .set({ updatedAt: new Date() })
    .where(eq(aiChatSessionsTable.id, row.session.id));

  return res.json({
    messageId: row.message.id,
    projectId: project.id,
    taskResult: parsed.data,
  });
});

// ── GET /api/ai/chat/file-content ─────────────────────────────────────────────
//
// Serves the REAL source lines behind a behavior-evidence span so a verifying
// analyst can see the exact code, not just the (often trimmed) excerpt the model
// quoted. Project-authorized (loadProjectByIdForUser) and path-guarded against
// traversal/symlink escape OUT of the project root (mirrors the apply-changes
// containment logic). Returns the actual file line window around [startLine,
// endLine] with true 1-indexed line numbers — the client highlights that window,
// never fabricates line offsets from a shortened excerpt.
router.get("/ai/chat/file-content", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const relPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!relPath) {
    return res.status(400).json({ error: "path is required", code: "FILE_PATH_REQUIRED" });
  }
  // Reject absolute paths and parent traversal outright before any filesystem
  // access — path.resolve would otherwise let ".." walk above the project root.
  if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes("..")) {
    return res.status(400).json({ error: "path must be a project-relative file path", code: "FILE_PATH_INVALID" });
  }

  const rawStart = Number(req.query.startLine);
  const rawEnd = Number(req.query.endLine);
  const startLine = Number.isFinite(rawStart) ? Math.max(1, Math.floor(rawStart)) : 1;
  const endLine = Number.isFinite(rawEnd) ? Math.max(startLine, Math.floor(rawEnd)) : startLine;

  // IMPORTANT: This endpoint must NOT use resolveRootPath, whose documented
  // behaviour falls back to the global workspace root when the configured
  // project root is inaccessible. Such a fallback would let a user authorized
  // for a stale/inaccessible project request arbitrary files (e.g. .env) from
  // OTHER projects living in the shared workspace — a cross-project data leak.
  // Here the project's own configured rootPath is the ONLY authorization
  // boundary: if it is unusable, we return `available:false` and serve nothing.
  const storedRoot = project.rootPath;
  if (!storedRoot) {
    return res.status(200).json({ available: false, reason: "project_root_unavailable" });
  }

  // Canonicalize the root FIRST (realpath resolves its own symlinks) so both
  // a real absolute path and a symlinked project root resolve to the same
  // canonical directory, and containment can be checked against that truth.
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(storedRoot);
  } catch {
    return res.status(200).json({ available: false, reason: "project_root_unavailable" });
  }

  const resolved = path.resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return res.status(200).json({ available: false, reason: "outside_project_root" });
  }

  let realResolved: string;
  try {
    // realpath follows symlinks in the target — catches a symlink pointing
    // outside the (canonical) project root.
    realResolved = await fs.realpath(resolved);
  } catch {
    return res.status(200).json({ available: false, reason: "file_not_found" });
  }
  if (realResolved !== resolvedRoot && !realResolved.startsWith(resolvedRoot + path.sep)) {
    return res.status(200).json({ available: false, reason: "outside_project_root" });
  }

  let rawFile: string;
  try {
    rawFile = await fs.readFile(realResolved, "utf-8");
  } catch {
    return res.status(200).json({ available: false, reason: "file_unreadable" });
  }

  const allLines = rawFile.split(/\r?\n/);
  // A file typically ends with a trailing newline, which split() turns into a
  // spurious empty line; drop a single trailing empty line so line counts line
  // up with an editor's visible line numbers.
  if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();
  // Bound the requested window so a single huge file never floods the response.
  const MAX_WINDOW = 200;
  const to = Math.min(allLines.length, endLine, startLine + MAX_WINDOW - 1);

  return res.status(200).json({
    available: true,
    path: relPath,
    startLine,
    endLine: to,
    fileLines: allLines.length,
    truncated: to < endLine || to < allLines.length,
    lines: allLines.slice(startLine - 1, to).map((text, i) => ({
      line: startLine + i,
      text,
    })),
  });
});

router.get("/ai/chat/:sessionId/pending-proposal", async (req, res) => {
  const [session] = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, req.params.sessionId))
    .limit(1);
  if (!session) return res.status(404).json({ error: "Chat session not found" });
  const project = await loadProjectByIdForUser(session.projectId, req.userId, res);
  if (!project) return;

  const [proposal] = await db
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.sessionId, req.params.sessionId),
      eq(aiChangeProposalsTable.status, "pending"),
    ))
    .orderBy(desc(aiChangeProposalsTable.createdAt))
    .limit(1);
  if (!proposal) return res.json({ proposalId: null, operationId: null, changes: [], lifecycle: null });

  const [proposalExecution] = await db
    .select({
      id: aiExecutionsTable.id,
      operationId: aiExecutionsTable.operationId,
      buildPlanMessageId: aiExecutionsTable.buildPlanMessageId,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.proposalId, proposal.id),
      eq(aiExecutionsTable.projectId, session.projectId),
    ))
    .orderBy(desc(aiExecutionsTable.updatedAt))
    .limit(1);
  const canonicalOperationId = proposalExecution?.operationId
    ?? proposalExecution?.buildPlanMessageId
    ?? proposalExecution?.id
    ?? proposal.messageId;

  try {
    const changes = parseStoredJson(proposal.changes) as ServerPendingChange[];
    return res.json({
      proposalId: proposal.id,
      operationId: canonicalOperationId,
      changes,
      approvalRequired: proposal.approvalRequired,
      revision: proposal.revision,
      ...(
        proposal.lifecycle !== "proposed"
        || proposal.workspaceRoot
        || proposal.validationEvidence
        ? {
            lifecycle: proposal.lifecycle,
            baseRevision: proposal.baseRevision,
            changeSetHash: proposal.changeSetHash,
            baseTreeHash: proposal.baseTreeHash,
            candidateTreeHash: proposal.candidateTreeHash,
            promotedTreeHash: proposal.promotedTreeHash,
            treeDigestVersion: proposal.treeDigestVersion,
            appliedChanges: proposal.appliedChanges
              ? parseStoredJson(proposal.appliedChanges)
              : [],
            commitHash: proposal.commitHash,
            committedTreeHash: proposal.committedTreeHash,
            conflictReason: proposal.conflictReason
              ? redactUserFacingText(proposal.conflictReason).slice(0, 500)
              : null,
            validationEvidence: proposal.validationEvidence
              ? parsePublicValidationReceipts(parseStoredJson(proposal.validationEvidence))
              : [],
          }
        : {}
      ),
    });
  } catch {
    logger.error({ proposalId: proposal.id }, "Invalid stored AI change proposal");
    return res.status(500).json({ error: "Stored change proposal is invalid" });
  }
});

// Delivery recovery intentionally exposes only relative file names and bounded
// evidence. Workspace roots and change contents remain server-owned.
router.get("/ai/delivery/recoverable", async (req, res) => {
  const project = await loadProjectByIdForUser(
    typeof req.query.projectId === "string" ? req.query.projectId : undefined,
    req.userId,
    res,
  );
  if (!project) return;

  const proposals = await db
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.projectId, project.id),
      inArray(aiChangeProposalsTable.lifecycle, ["isolated", "abandoned", "blocked", "conflicted", "cancelled"]),
    ))
    .orderBy(desc(aiChangeProposalsTable.createdAt))
    .limit(20);

  const operations = await Promise.all(proposals.map(async (proposal) => {
    const workspaceAvailable = Boolean(
      proposal.operationId
      && await deliveryWorkspaceExists(proposal.workspaceRoot, proposal.operationId),
    );
    const recoveryState = proposal.lifecycle === "cancelled" || proposal.status === "rejected"
      ? "discarded"
      : workspaceAvailable
        ? "recoverable"
        : "missing_workspace";
    const operatorExplanation = recoveryState === "discarded"
      ? "This delivery recovery was already discarded."
      : recoveryState === "missing_workspace"
        ? "The saved delivery workspace is no longer available, so recovery cannot continue."
        : proposal.lifecycle === "conflicted"
          ? "The delivery stopped because the retained changes need review before validation can continue."
          : proposal.lifecycle === "isolated"
            ? "The delivery was captured in its isolated workspace before the process stopped; its saved workspace can be checked again."
          : proposal.lifecycle === "abandoned"
            ? "The delivery was interrupted before it finished; its saved workspace can be checked again."
            : "Validation did not complete successfully; the saved workspace can be checked again.";
    const nextAction = recoveryState === "discarded"
      ? "No action is required."
      : recoveryState === "missing_workspace"
        ? "Start a new delivery from the current project rather than retrying this recovery."
        : "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.";
    return {
      proposalId: proposal.id,
      operationId: proposal.operationId ?? proposal.messageId,
      projectRevision: proposal.baseRevision,
      changeSetHash: proposal.changeSetHash,
      sessionId: proposal.sessionId,
      lifecycle: proposal.lifecycle,
      status: proposal.status,
      createdAt: proposal.createdAt,
      conflictReason: proposal.conflictReason
        ? redactUserFacingText(proposal.conflictReason).slice(0, 500)
        : null,
      recoveryState,
      operatorExplanation,
      nextAction,
      validationEvidence: proposal.validationEvidence
        ? redactUserFacingValue(parseStoredJson(proposal.validationEvidence))
        : null,
      workspaceAvailable,
      changeCount: (() => {
        try {
          const changes = parseStoredJson(proposal.changes);
          return Array.isArray(changes) ? changes.length : 0;
        } catch {
          return 0;
        }
      })(),
    };
  }));
  return res.json({ operations });
});

router.post("/ai/delivery/:proposalId/resume-validation", async (req, res) => {
  const [proposal] = await db.select().from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId)).limit(1);
  if (!proposal) return res.status(404).json({ error: "Delivery operation not found", code: "DELIVERY_NOT_FOUND" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;

  if (proposal.lifecycle === "validated") {
    return res.json({ proposalId: proposal.id, operationId: proposal.operationId, lifecycle: proposal.lifecycle, idempotent: true });
  }
  if (!["isolated", "abandoned", "blocked", "conflicted"].includes(proposal.lifecycle)
    || proposal.status !== "pending"
    || !proposal.operationId
    || !(await deliveryWorkspaceExists(proposal.workspaceRoot, proposal.operationId))) {
    const discarded = proposal.lifecycle === "cancelled" || proposal.status === "rejected";
    const workspaceAvailable = Boolean(
      proposal.operationId
      && await deliveryWorkspaceExists(proposal.workspaceRoot, proposal.operationId),
    );
    return res.status(409).json({
      error: discarded
        ? "This delivery recovery was already discarded."
        : "The saved delivery workspace is no longer available, so recovery cannot continue.",
      code: discarded ? "DELIVERY_ALREADY_DISCARDED" : "DELIVERY_NOT_RECOVERABLE",
      lifecycle: proposal.lifecycle,
      recoveryState: discarded ? "discarded" : workspaceAvailable ? "recoverable" : "missing_workspace",
      nextAction: discarded
        ? "No action is required."
        : "Start a new delivery from the current project rather than retrying this recovery.",
    });
  }

  let changes: Array<{ path: string; newContent: string; validationProfile?: ValidationProfile }> = [];
  try {
    const parsed = parseStoredJson(proposal.changes);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    changes = parsed;
  } catch {
    return res.status(409).json({ error: "Stored delivery changes are invalid.", code: "DELIVERY_INVALID" });
  }
  const workspaceRoot = proposal.workspaceRoot!;
  const results: Array<Record<string, unknown>> = [];
  const candidateHash = await hashDeliveryWorkspace(workspaceRoot);
  const changeSetHash = proposal.changeSetHash ?? hashChangeSet(changes);
  if (
    proposal.treeDigestVersion !== DELIVERY_TREE_DIGEST_VERSION
    || !proposal.candidateTreeHash
    || candidateHash !== proposal.candidateTreeHash
  ) {
    const reason = proposal.treeDigestVersion !== DELIVERY_TREE_DIGEST_VERSION
      ? "The saved delivery workspace uses an unsupported tree digest contract."
      : "The saved delivery candidate changed after it was captured.";
    await db.update(aiChangeProposalsTable).set({
      lifecycle: "blocked",
      conflictReason: reason,
    }).where(and(
      eq(aiChangeProposalsTable.id, proposal.id),
      eq(aiChangeProposalsTable.status, "pending"),
    ));
    return res.status(409).json({
      error: reason,
      code: proposal.treeDigestVersion !== DELIVERY_TREE_DIGEST_VERSION
        ? "DELIVERY_TREE_DIGEST_UNSUPPORTED"
        : "DELIVERY_CANDIDATE_DRIFT",
      proposalId: proposal.id,
      operationId: proposal.operationId,
      lifecycle: "blocked",
      integrityOutcome: "blocked",
      treeDigestVersion: proposal.treeDigestVersion,
      candidateTreeHash: candidateHash,
      expectedCandidateTreeHash: proposal.candidateTreeHash,
    });
  }
  const groups = new Map<string, typeof changes>();
  for (const change of changes) {
    if (typeof change.path !== "string" || typeof change.newContent !== "string" || !change.validationProfile) continue;
    const group = groups.get(change.validationProfile) ?? [];
    group.push(change);
    groups.set(change.validationProfile, group);
  }
  for (const [profile, group] of groups) {
    const parsedProfile = ValidationProfileSchema.safeParse(profile);
    if (!parsedProfile.success) continue;
    const result = await runRepairValidation(
      workspaceRoot,
      parsedProfile.data,
      group.map((change) => change.path),
      undefined,
      [],
    );
    if ("evidence" in result) {
      result.evidence.operationId = proposal.operationId ?? proposal.messageId;
      result.evidence.projectRevision = proposal.baseRevision ?? undefined;
      result.evidence.treeDigestVersion = proposal.treeDigestVersion ?? undefined;
      result.evidence.candidateHash = candidateHash;
      result.evidence.changeSetHash = changeSetHash;
    }
    results.push(publicValidationReceipt(result));
  }
  const passed = results.length === groups.size && results.length > 0
    && results.every((result) => result.status === "passed");
  const evidence = JSON.stringify(results);
  const [updated] = await db.update(aiChangeProposalsTable).set({
    lifecycle: passed ? "validated" : "blocked",
    validationEvidence: evidence,
    conflictReason: passed ? null : "Validation recovery did not pass all registered profiles.",
  }).where(and(
    eq(aiChangeProposalsTable.id, proposal.id),
    eq(aiChangeProposalsTable.status, "pending"),
    inArray(aiChangeProposalsTable.lifecycle, ["isolated", "abandoned", "blocked", "conflicted"]),
  )).returning({ id: aiChangeProposalsTable.id });
  if (!updated) {
    const [current] = await db.select({ lifecycle: aiChangeProposalsTable.lifecycle })
      .from(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.id, proposal.id)).limit(1);
    return res.json({ proposalId: proposal.id, operationId: proposal.operationId, lifecycle: current?.lifecycle ?? proposal.lifecycle, idempotent: true });
  }
  return res.json({
    proposalId: proposal.id,
    operationId: proposal.operationId,
    lifecycle: passed ? "validated" : "blocked",
    validationEvidence: parsePublicValidationReceipts(results),
  });
});

router.post("/ai/delivery/:proposalId/discard", async (req, res) => {
  const [proposal] = await db.select().from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId)).limit(1);
  if (!proposal) return res.status(404).json({ error: "Delivery operation not found", code: "DELIVERY_NOT_FOUND" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  if (proposal.lifecycle === "cancelled" || proposal.status === "rejected") {
    return res.json({ proposalId: proposal.id, lifecycle: "cancelled", idempotent: true });
  }
  if (!["isolated", "abandoned", "blocked", "conflicted"].includes(proposal.lifecycle)) {
    return res.status(409).json({ error: "Only recoverable delivery work can be discarded.", code: "DELIVERY_NOT_DISCARDABLE" });
  }
  const [updated] = await db.update(aiChangeProposalsTable).set({
    status: "rejected",
    lifecycle: "cancelled",
    consumedAt: new Date(),
  }).where(and(eq(aiChangeProposalsTable.id, proposal.id), eq(aiChangeProposalsTable.status, "pending"))).returning({ id: aiChangeProposalsTable.id });
  if (updated && proposal.workspaceRoot && proposal.operationId) {
    await discardDeliveryWorkspace(proposal.workspaceRoot, proposal.operationId);
  }
  return res.json({ proposalId: proposal.id, lifecycle: "cancelled", discarded: Boolean(updated) });
});

// ── POST /api/ai/chat/rebase-changes ──────────────────────────────────────────
//
// A stale proposal never writes through automatically. This endpoint attempts a
// deterministic, reviewable rebase onto the current workspace and updates the
// still-pending proposal only when every hunk matches uniquely.
router.post("/ai/chat/rebase-changes", async (req, res) => {
  const RebaseChangeSchema = z.object({
    path: z.string().min(1),
    absolutePath: z.string().min(1).refine(path.isAbsolute, "absolutePath must be an absolute path"),
    newContent: z.string(),
    originalContent: z.string().nullable(),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hunks: z.array(z.object({
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
      expectedText: z.string(),
      replacementText: z.string(),
      reason: z.string().min(1),
      risk: z.enum(["low", "medium", "high"]).optional(),
      evidence: z.array(z.object({
        kind: z.enum(["finding", "source", "validation"]),
        id: z.string().min(1),
        label: z.string().min(1).max(240),
        file: z.string().min(1).optional(),
        line: z.number().int().min(1).optional(),
      }).strict()).max(4).optional(),
    }).strict()).max(100).optional(),
    reason: z.string().min(1),
    validationProfile: z.enum(["ai-orchestrator-tests", "knowledge-engine-tests", "api-ai-tests", "workspace-typecheck"]).optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
    evidence: z.array(z.object({
      kind: z.enum(["finding", "source", "validation"]),
      id: z.string().min(1),
      label: z.string().min(1).max(240),
      file: z.string().min(1).optional(),
      line: z.number().int().min(1).optional(),
    }).strict()).max(4).optional(),
  }).strict();
  const RebaseBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1),
    proposalId: z.string({ required_error: "proposalId is required" }).uuid(),
    changes: z.array(RebaseChangeSchema).min(1).max(50),
  });
  const parsed = RebaseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      error: issue?.message ?? "Invalid rebase request",
      field: String(issue?.path[0] ?? ""),
    });
  }

  const { projectId, proposalId, changes } = parsed.data;
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;
  const rootCheck = await resolveRootPath(project.rootPath, projectId);
  if (!rootCheck.validRootPath) {
    console.error("DEBUG_APPLY_ROOT", projectId, proposalId, project.rootPath);
    return res.status(409).json({
      error: "project_root_unavailable",
      code: "PROJECT_ROOT_UNAVAILABLE",
      message: "The project working directory is unavailable; restore or rescan the project before rebasing changes.",
    });
  }

  const applyLock = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      code: "APPLY_IN_PROGRESS",
      hint: "Another apply or rebase operation is already in progress for this project.",
    });
  }

  try {
    const [proposal] = await db
      .select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, proposalId),
        eq(aiChangeProposalsTable.projectId, projectId),
      ))
      .limit(1);
    if (!proposal) {
      return res.status(404).json({ error: "Change proposal not found", code: "PROPOSAL_NOT_FOUND" });
    }
    if (proposal.status !== "pending") {
      return res.status(409).json({
        error: "Change proposal has already been consumed",
        code: "PROPOSAL_ALREADY_CONSUMED",
      });
    }

    let approvedChanges: ServerPendingChange[];
    try {
      approvedChanges = parseStoredJson(proposal.changes) as ServerPendingChange[];
    } catch {
      return res.status(500).json({ error: "Stored change proposal is invalid", code: "PROPOSAL_INVALID" });
    }
    if (serializeCanonical(changes) !== serializeCanonical(approvedChanges)) {
      return res.status(409).json({
        error: "Submitted changes do not match the approved proposal",
        code: "PROPOSAL_MISMATCH",
      });
    }

    const rebasedChanges: ServerPendingChange[] = [];
    const conflicts: Array<{
      path: string;
      ok: false;
      code: "PATCH_REBASE_UNAVAILABLE" | "PATCH_REBASE_CONFLICT";
      error: string;
      conflict?: {
        kind: "base_hash_mismatch" | "hunk_mismatch";
        expectedHash?: string;
        actualHash?: string;
        hunkIndex?: number;
      };
    }> = [];
    const seenRealPaths = new Set<string>();
    const resolvedRoot = path.resolve(project.rootPath);
    const BLOCKED_WRITE_EXTENSIONS =
      /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;

    for (const change of approvedChanges) {
      if (BLOCKED_WRITE_EXTENSIONS.test(change.path) || BLOCKED_WRITE_EXTENSIONS.test(change.absolutePath)) {
        conflicts.push({
          path: change.path,
          ok: false,
          code: "PATCH_REBASE_UNAVAILABLE",
          error: "Sensitive files cannot be rebased through the AI approval flow.",
        });
        continue;
      }
      if (!change.hunks || change.hunks.length === 0 || !change.baseHash) {
        conflicts.push({
          path: change.path,
          ok: false,
          code: "PATCH_REBASE_UNAVAILABLE",
          error: "This legacy proposal has no Patch Lab hunks/base hash; generate a fresh patch instead.",
        });
        continue;
      }

      const resolved = path.resolve(change.absolutePath);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        conflicts.push({
          path: change.path,
          ok: false,
          code: "PATCH_REBASE_UNAVAILABLE",
          error: "Path is outside the project root.",
        });
        continue;
      }

      try {
        const parentDir = path.dirname(resolved);
        const realParent = await fs.realpath(parentDir);
        const realResolved = path.join(realParent, path.basename(resolved));
        if (realResolved !== resolvedRoot && !realResolved.startsWith(resolvedRoot + path.sep)) {
          conflicts.push({
            path: change.path,
            ok: false,
            code: "PATCH_REBASE_UNAVAILABLE",
            error: "Path is outside the project root after symlink resolution.",
          });
          continue;
        }
        if (seenRealPaths.has(realResolved)) {
          conflicts.push({
            path: change.path,
            ok: false,
            code: "PATCH_REBASE_UNAVAILABLE",
            error: "Duplicate file path in rebase request.",
          });
          continue;
        }
        seenRealPaths.add(realResolved);

        let currentContent: string | null = null;
        try {
          currentContent = await fs.readFile(realResolved, "utf-8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const actualHash = hashPatchBase(currentContent);
        const rebased = rebasePatchHunks(currentContent, change.hunks);
        if (!rebased.ok) {
          conflicts.push({
            path: change.path,
            ok: false,
            code: rebased.kind === "unsupported" ? "PATCH_REBASE_UNAVAILABLE" : "PATCH_REBASE_CONFLICT",
            error: rebased.reason,
            conflict: rebased.kind === "hunk_mismatch"
              ? {
                  kind: "hunk_mismatch",
                  ...(rebased.hunkIndex === undefined ? {} : { hunkIndex: rebased.hunkIndex }),
                  ...(change.baseHash === actualHash ? {} : {
                    expectedHash: change.baseHash,
                    actualHash,
                  }),
                }
              : undefined,
          });
          continue;
        }

        rebasedChanges.push({
          ...change,
          absolutePath: realResolved,
          originalContent: currentContent,
          baseHash: actualHash,
          newContent: rebased.content,
          hunks: buildPatchHunks(currentContent, rebased.content, change.reason, {
            risk: change.risk,
            evidence: change.evidence,
          }),
        });
      } catch (error) {
        conflicts.push({
          path: change.path,
          ok: false,
          code: "PATCH_REBASE_UNAVAILABLE",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (conflicts.length > 0 || rebasedChanges.length !== approvedChanges.length) {
      return res.status(409).json({
        error: "Patch could not be safely rebased. No proposal data was changed.",
        code: "PATCH_REBASE_CONFLICT",
        results: [
          ...conflicts,
          ...rebasedChanges.map((change) => ({
            path: change.path,
            ok: false as const,
            code: "PATCH_REBASE_ABORTED" as const,
            error: "Batch rebase aborted because another file conflicted.",
          })),
        ],
      });
    }

    await db.transaction(async (tx) => {
      const nextRevision = proposal.revision + 1;
      const updated = await tx
        .update(aiChangeProposalsTable)
        .set({
          changes: serializeServerPendingChanges(rebasedChanges),
          revision: nextRevision,
          approvalRequired: true,
        })
        .where(and(
          eq(aiChangeProposalsTable.id, proposalId),
          eq(aiChangeProposalsTable.projectId, projectId),
          eq(aiChangeProposalsTable.status, "pending"),
        ))
        .returning({ id: aiChangeProposalsTable.id });
      if (!updated[0]) throw new Error("Change proposal was consumed during rebase");
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiPatchRebased",
        projectId,
        severity: "info",
        message: `AI patch rebased for ${rebasedChanges.length} file${rebasedChanges.length === 1 ? "" : "s"}; user review is required again.`,
        correlationId: proposalId,
        payload: {
          proposalId,
          rebasedFiles: rebasedChanges.map((change) => change.path),
          approvalRequired: true,
        },
      });
    });

    return res.status(200).json({
      proposalId,
      changes: rebasedChanges,
      rebasedFiles: rebasedChanges.map((change) => change.path),
      approvalRequired: true,
      revision: proposal.revision + 1,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Change proposal was consumed during rebase") {
      return res.status(409).json({
        error: "Change proposal has already been consumed",
        code: "PROPOSAL_ALREADY_CONSUMED",
      });
    }
    throw error;
  } finally {
    await applyLock.release();
  }
});

// ── POST /api/ai/chat/proposals/:proposalId/approve ──────────────────────────
//
// Rebased proposals remain pending but are explicitly blocked from apply until
// the user approves the new revision. The compare-and-set prevents an approval
// from racing with another rebase of the same proposal.
router.post("/ai/chat/proposals/:proposalId/approve", async (req, res) => {
  const body = z.object({
    projectId: z.string().min(1),
    revision: z.number().int().min(0),
  }).strict().safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({
      error: body.error.issues[0]?.message ?? "Invalid proposal approval request",
      code: "PROPOSAL_APPROVAL_INVALID",
    });
  }

  const { projectId, revision } = body.data;
  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const [proposal] = await db
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, req.params.proposalId),
      eq(aiChangeProposalsTable.projectId, projectId),
    ))
    .limit(1);
  if (!proposal) {
    return res.status(404).json({ error: "Change proposal not found", code: "PROPOSAL_NOT_FOUND" });
  }
  if (proposal.status !== "pending") {
    return res.status(409).json({
      error: "Change proposal has already been consumed",
      code: "PROPOSAL_ALREADY_CONSUMED",
    });
  }
  if (!proposal.approvalRequired) {
    return res.status(409).json({
      error: "This proposal does not require re-approval",
      code: "PROPOSAL_REAPPROVAL_NOT_REQUIRED",
      approvalRequired: false,
      revision: proposal.revision,
    });
  }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(aiChangeProposalsTable)
      .set({ approvalRequired: false })
      .where(and(
        eq(aiChangeProposalsTable.id, proposal.id),
        eq(aiChangeProposalsTable.projectId, projectId),
        eq(aiChangeProposalsTable.status, "pending"),
        eq(aiChangeProposalsTable.approvalRequired, true),
        eq(aiChangeProposalsTable.revision, revision),
      ))
      .returning({ id: aiChangeProposalsTable.id });
    if (!rows[0]) return false;

    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "AiPatchReapproved",
      projectId,
      severity: "success",
      message: "AI rebased patch approved for apply",
      correlationId: proposal.messageId,
      payload: {
        proposalId: proposal.id,
        revision,
        approvalRequired: false,
      },
    });
    return true;
  });

  if (!updated) {
    return res.status(409).json({
      error: "The proposal changed before it could be approved; reload and review it again",
      code: "PROPOSAL_APPROVAL_CONFLICT",
    });
  }

  return res.status(200).json({
    proposalId: proposal.id,
    approvalRequired: false,
    revision,
  });
});

router.delete("/ai/chat/proposals/:proposalId", async (req, res) => {
  const [proposal] = await db
    .select()
    .from(aiChangeProposalsTable)
    .where(eq(aiChangeProposalsTable.id, req.params.proposalId))
    .limit(1);
  if (!proposal) {
    return res.status(404).json({ error: "Change proposal not found", code: "PROPOSAL_NOT_FOUND" });
  }
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  if (proposal.status !== "pending") {
    return res.status(409).json({ error: "Change proposal has already been consumed", code: "PROPOSAL_ALREADY_CONSUMED" });
  }
  await db
    .update(aiChangeProposalsTable)
    .set({
      status: "rejected",
      lifecycle: "cancelled",
      consumedAt: new Date(),
    })
    .where(and(
      eq(aiChangeProposalsTable.id, proposal.id),
      eq(aiChangeProposalsTable.status, "pending"),
    ));
  if (proposal.workspaceRoot && proposal.operationId) {
    await discardDeliveryWorkspace(proposal.workspaceRoot, proposal.operationId);
  }
  return res.status(204).send();
});

// ── POST /api/ai/chat/apply-changes ─────────────────────────────────────────

router.post("/ai/chat/apply-changes", async (req, res) => {
  const ChangeItemSchema = z.object({
    path:         z.string().min(1, "each change must have a non-empty path"),
    absolutePath: z.string()
                    .min(1, "each change must have a non-empty absolutePath")
                    .refine((v) => path.isAbsolute(v), "absolutePath must be an absolute path"),
    newContent:   z.string(),
    originalContent: z.string().nullable(),
    baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    hunks: z.array(z.object({
      startLine: z.number().int().min(1),
      endLine: z.number().int().min(1),
      expectedText: z.string(),
      replacementText: z.string(),
      reason: z.string().min(1),
      risk: z.enum(["low", "medium", "high"]).optional(),
      evidence: z.array(z.object({
        kind: z.enum(["finding", "source", "validation"]),
        id: z.string().min(1),
        label: z.string().min(1).max(240),
        file: z.string().min(1).optional(),
        line: z.number().int().min(1).optional(),
      }).strict()).max(4).optional(),
    }).strict()).max(100).optional(),
    reason: z.string().min(1, "each change must have a non-empty reason"),
    validationProfile: z.enum(["ai-orchestrator-tests", "knowledge-engine-tests", "api-ai-tests", "workspace-typecheck"]),
    risk: z.enum(["low", "medium", "high"]).optional(),
    evidence: z.array(z.object({
      kind: z.enum(["finding", "source", "validation"]),
      id: z.string().min(1),
      label: z.string().min(1).max(240),
      file: z.string().min(1).optional(),
      line: z.number().int().min(1).optional(),
    }).strict()).max(4).optional(),
  }).strict();
  const ApplyChangesBodySchema = z.object({
    projectId: z.string({ required_error: "projectId is required" }).min(1, "projectId is required"),
    proposalId: z.string({ required_error: "proposalId is required" }).uuid("proposalId must be a valid UUID"),
    operationId: z.string().uuid().optional(),
    changes:   z.array(ChangeItemSchema)
                 .min(1, "changes must be a non-empty array")
                 .max(50, "too many changes — max 50 per request"),
  });
  const applyBody = ApplyChangesBodySchema.safeParse(req.body);
  if (!applyBody.success) {
    const issue = applyBody.error.issues[0];
    const raw   = issue?.message ?? "Invalid request body";
    const field = String(issue?.path[0] ?? "");
    const error = raw === "Required" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const { changes, projectId, proposalId, operationId } = applyBody.data;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;
  // Report tampering deterministically even when the saved project root is
  // unavailable; filesystem readiness is checked immediately afterward.
  const [preflightProposal] = await db
    .select({ status: aiChangeProposalsTable.status, changes: aiChangeProposalsTable.changes })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, proposalId),
      eq(aiChangeProposalsTable.projectId, projectId),
    ))
    .limit(1);
  if (preflightProposal?.status === "pending") {
    try {
      const approvedChanges = (typeof preflightProposal.changes === "string"
        ? JSON.parse(preflightProposal.changes)
        : preflightProposal.changes) as ServerPendingChange[];
      const subsetError = authorizeChangeSubset(changes, approvedChanges);
      if (subsetError) {
        return res.status(409).json({
          error: `Submitted changes are not an authorized subset of the proposal: ${subsetError}`,
          code: "PROPOSAL_MISMATCH",
        });
      }
    } catch {
      // The authoritative validation below reports malformed stored proposals.
    }
  }
  const rootCheck = await resolveRootPath(project.rootPath, projectId);
  if (!rootCheck.validRootPath) {
    return res.status(409).json({
      error: "project_root_unavailable",
      code: "PROJECT_ROOT_UNAVAILABLE",
      message: "The project working directory is unavailable; restore or rescan the project before applying changes.",
    });
  }
  const resolvedRoot = path.resolve(project.rootPath);

  const applyLock = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "An apply operation is already in progress for this project — wait for it to complete before starting another.",
    });
  }

  let results: Array<{
    path: string;
    ok: boolean;
    error?: string;
      code?: string;
    writeStatus?: "written" | "not_written" | "unknown";
    persistenceVerified?: boolean;
      conflict?: {
        kind: "base_hash_mismatch" | "hunk_mismatch";
        expectedHash?: string;
        actualHash?: string;
        hunkIndex?: number;
      };
    behavioralVerification?: RepairVerificationResult;
  }>;
  try {
    // Read and validate the proposal after acquiring the project lock. This
    // prevents two concurrent approvals from both observing "pending" and
    // applying the same one-shot proposal.
    const [proposal] = await db
      .select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, proposalId),
        eq(aiChangeProposalsTable.projectId, projectId),
      ))
      .limit(1);
    if (!proposal) {
      return res.status(404).json({ error: "Change proposal not found", code: "PROPOSAL_NOT_FOUND" });
    }
    if (proposal.status !== "pending") {
      return res.status(409).json({ error: "Change proposal has already been consumed", code: "PROPOSAL_ALREADY_CONSUMED" });
    }
    if (proposal.approvalRequired) {
      return res.status(409).json({
        error: "The rebased patch must be reviewed and approved again before apply",
        code: "PROPOSAL_REAPPROVAL_REQUIRED",
        approvalRequired: true,
        revision: proposal.revision,
      });
    }

    let approvedChanges: ServerPendingChange[];
    try {
      approvedChanges = (typeof proposal.changes === "string"
        ? JSON.parse(proposal.changes)
        : proposal.changes) as ServerPendingChange[];
    } catch {
      return res.status(500).json({ error: "Stored change proposal is invalid", code: "PROPOSAL_INVALID" });
    }
    // Each submitted change must be a value-exact authorized subset of the
    // stored proposal: same field values, and every submitted hunk must be
    // present verbatim in the stored hunk list.  The user may omit entire
    // files (file-level reject) or omit individual hunks (hunk-level reject)
    // but cannot add new paths, alter any non-hunk field, or introduce hunks
    // that were not part of the original proposal.
    const subsetError = authorizeChangeSubset(changes, approvedChanges);
    if (subsetError) {
      return res.status(409).json({
        error: `Submitted changes are not an authorized subset of the proposal: ${subsetError}`,
        code: "PROPOSAL_MISMATCH",
      });
    }
    if (!changes.every((change) => change.validationProfile)) {
      return res.status(409).json({
        error: "Approved repair changes must include a registered validation profile",
        code: "PROPOSAL_VALIDATION_REQUIRED",
      });
    }

    const [proposalExecution] = await db
      .select({
        id: aiExecutionsTable.id,
        operationId: aiExecutionsTable.operationId,
        buildPlanMessageId: aiExecutionsTable.buildPlanMessageId,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.proposalId, proposal.id),
        eq(aiExecutionsTable.projectId, projectId),
      ))
      .orderBy(desc(aiExecutionsTable.updatedAt))
      .limit(1);
    const canonicalOperationId = proposalExecution?.operationId
      ?? proposalExecution?.buildPlanMessageId
      ?? proposalExecution?.id
      ?? proposal.messageId;
    if (operationId && operationId !== canonicalOperationId) {
      return res.status(409).json({
        error: "Operation identity does not match the server-owned execution",
        code: "OPERATION_ID_MISMATCH",
      });
    }
    const applyCorrelationId = canonicalOperationId;
    const applyAttemptId = randomUUID();
    // Materialize the approved change set into an operation-owned workspace
    // before touching the user's checkout. This workspace is retained as the
    // recovery/proof artifact; the durable root is only written after all
    // revision, path, and validation gates below pass.
    const deliveryWorkspace = await createDeliveryWorkspace({
      rootPath: project.rootPath,
      operationId: applyCorrelationId,
      baseRevision: proposal.baseRevision ?? project.updatedAt.toISOString(),
      // The stored proposal is the authorization envelope. Materialize only
      // the exact subset submitted by the approval request.
      changes: [],
    });
    await db.update(aiChangeProposalsTable)
      .set({
        operationId: applyCorrelationId,
        workspaceRoot: deliveryWorkspace.workspaceRoot,
        baseRevision: deliveryWorkspace.baseRevision,
        changeSetHash: deliveryWorkspace.changeSetHash,
        baseTreeHash: deliveryWorkspace.baseTreeHash,
        candidateTreeHash: deliveryWorkspace.candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        lifecycle: "isolated",
        conflictReason: null,
      })
      .where(and(
        eq(aiChangeProposalsTable.id, proposalId),
        eq(aiChangeProposalsTable.status, "pending"),
      ));
    let journalSequence = 0;
    let candidateTreeHash = deliveryWorkspace.candidateTreeHash;
    let promotedTreeHash: string | null = null;
    let promotionMismatch = false;
    let effectiveChangeSetHash = deliveryWorkspace.changeSetHash;
    const appendApplyJournal = async (
      stage: ApplyJournalStage,
      payload: Record<string, unknown> = {},
    ): Promise<void> => {
      journalSequence += 1;
      await db.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: applyCorrelationId,
        attemptId: applyAttemptId,
        projectId,
        proposalId,
        stage,
        sequence: journalSequence,
        payload: {
        operationId: applyCorrelationId,
        baseRevision: deliveryWorkspace.baseRevision,
        baseTreeHash: deliveryWorkspace.baseTreeHash,
        candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        changeSetHash: effectiveChangeSetHash,
        promotedTreeHash,
        ...payload,
        },
      });
    };
    await appendApplyJournal("STARTED", {
      changeCount: changes.length,
      operationId: applyCorrelationId,
    });

    results = [];
    const writableChanges: Array<{
      path: string;
      realPath: string;
      newContent: string;
      before: Buffer | null;
      validationProfile?: ValidationProfile;
    }> = [];
    const writtenChanges: typeof writableChanges = [];
    // Track every file whose write was attempted, including a file whose
    // writeFile call mutates bytes and then throws before the success marker.
    // Rollback must cover that file too.
    const attemptedChanges: typeof writableChanges = [];
    const seenRealPaths = new Set<string>();
    let rollbackFailures: ApplyRollbackFailure[] = [];

    await appendApplyJournal("PREFLIGHT_STARTED", {
      fileCount: changes.length,
    });
    for (const change of changes) {
      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      // Check BOTH the client-supplied path and absolutePath — a mismatch between
      // the two fields can bypass a check on path alone.
      if (BLOCKED_WRITE_EXTENSIONS.test(change.path) || BLOCKED_WRITE_EXTENSIONS.test(change.absolutePath)) {
        results.push({
          path: change.path,
          ok: false,
          error: "File type is classified as sensitive (secrets, credentials, or executable scripts) — apply manually.",
        });
        continue;
      }

      const resolved = path.resolve(change.absolutePath);
      if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        results.push({ path: change.path, ok: false, error: "Path is outside the project root" });
        continue;
      }
      try {
        // Create parent dirs then realpath them to detect symlink escape — path.resolve()
        // is purely lexical and does not follow symlinks.
        const parentDir = path.dirname(resolved);
        await fs.mkdir(parentDir, { recursive: true });
        const realParent = await fs.realpath(parentDir);
        const realResolved = path.join(realParent, path.basename(resolved));
        if (realResolved !== resolvedRoot && !realResolved.startsWith(resolvedRoot + path.sep)) {
          results.push({ path: change.path, ok: false, error: "Path is outside the project root" });
          continue;
        }

        if (seenRealPaths.has(realResolved)) {
          results.push({ path: change.path, ok: false, error: "Duplicate file path in apply request" });
          continue;
        }
        seenRealPaths.add(realResolved);

        let before: Buffer | null = null;
        try {
          before = await fs.readFile(realResolved);
        } catch (readError) {
          const code = (readError as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") throw readError;
        }
        if (change.baseHash) {
          const actualHash = hashPatchBase(before?.toString("utf-8") ?? null);
          if (actualHash !== change.baseHash) {
            results.push({
              path: change.path,
              ok: false,
              code: "STALE_BASE",
              error: "Patch conflict: the file changed after the patch was generated. Read it again and create a fresh patch.",
              conflict: {
                kind: "base_hash_mismatch",
                expectedHash: change.baseHash,
                actualHash,
              },
            });
            continue;
          }
        }
        if (Object.prototype.hasOwnProperty.call(change, "originalContent")) {
          const expected = change.originalContent ?? null;
          const actual = before?.toString("utf-8") ?? null;
          if (actual !== expected) {
            results.push({
              path: change.path,
              ok: false,
              error: "File changed after the AI proposal was created. Read it again and create a fresh focused change.",
            });
            continue;
          }
        }
        // When hunks are present, rebase them against the current file content
        // so that: (a) stale hunks are rejected, and (b) partial hunk selections
        // (only accepted hunks forwarded by the UI) are applied correctly.
        let resolvedContent = change.newContent;
        if (change.hunks && change.hunks.length > 0) {
          const currentContent = before?.toString("utf-8") ?? null;
          const rebaseResult = rebasePatchHunks(currentContent, change.hunks);
          if (!rebaseResult.ok) {
            results.push({
              path: change.path,
              ok: false,
              code: "PATCH_HUNK_MISMATCH",
              error: `Patch conflict: ${rebaseResult.reason}`,
              conflict: {
                kind: "hunk_mismatch" as const,
                ...(rebaseResult.hunkIndex !== undefined
                  ? { hunkIndex: rebaseResult.hunkIndex }
                  : {}),
              },
            });
            continue;
          }
          resolvedContent = rebaseResult.content;
        }
        const guard = inspectAiChange({
          filePath: change.path,
          before: before?.toString("utf-8") ?? null,
          after: resolvedContent,
        });
        if (!guard.allowed) {
          results.push({ path: change.path, ok: false, error: guard.error });
          continue;
        }

        if (change.validationProfile) {
          const profileError = validateRepairValidationScope(change.validationProfile, [change.path]);
          if (profileError) {
            results.push({
              path: change.path,
              ok: false,
              error: profileError,
              behavioralVerification: makeSyntheticValidationResult(
                change.validationProfile,
                "unavailable",
                getRepairValidationProfile(change.validationProfile).scenario,
                profileError,
              ),
            });
            continue;
          }
        }

        writableChanges.push({
          path: change.path,
          realPath: realResolved,
          newContent: resolvedContent,
          before,
          validationProfile: change.validationProfile,
        });
      } catch (e) {
        results.push({ path: change.path, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const preflightFailures = results.filter((result) => !result.ok);
    await appendApplyJournal(
      preflightFailures.length > 0 ? "PREFLIGHT_FAILED" : "PREFLIGHT_PASSED",
      {
        failedFiles: preflightFailures.map((result) => result.path),
      },
    );
    if (preflightFailures.length > 0) {
      // A dangerous or invalid change aborts the whole batch. Do not allow a
      // valid-looking sibling change to slip through beside a blocked write.
      const batchError =
        "Apply aborted because at least one requested change failed preflight; no files were written.";
      for (const change of writableChanges) {
        results.push({ path: change.path, ok: false, error: batchError });
      }
    }

    // Keep the candidate in lockstep with the bytes that passed preflight
    // (including rebased hunk content). Validation must observe these exact
    // bytes before any live-root file is promoted.
    const candidateChanges = writableChanges;
    for (const change of candidateChanges) {
      const candidatePath = path.resolve(deliveryWorkspace.workspaceRoot, change.path);
      if (candidatePath !== deliveryWorkspace.workspaceRoot
        && !candidatePath.startsWith(`${deliveryWorkspace.workspaceRoot}${path.sep}`)) {
        throw new Error("Delivery candidate path escapes isolated workspace");
      }
      await fs.mkdir(path.dirname(candidatePath), { recursive: true });
      await fs.writeFile(candidatePath, change.newContent, "utf8");
    }
    candidateTreeHash = await hashDeliveryTree(deliveryWorkspace.workspaceRoot);
    const candidateHash = candidateTreeHash;
    effectiveChangeSetHash = hashChangeSet(candidateChanges);
    await db.update(aiChangeProposalsTable)
      .set({
        changeSetHash: effectiveChangeSetHash,
        baseTreeHash: deliveryWorkspace.baseTreeHash,
        candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      })
      .where(and(
        eq(aiChangeProposalsTable.id, proposalId),
        eq(aiChangeProposalsTable.status, "pending"),
      ));
    const profiles = new Map<ValidationProfile, string[]>();
    for (const change of writableChanges) {
      if (!change.validationProfile) continue;
      const pathsForProfile = profiles.get(change.validationProfile) ?? [];
      pathsForProfile.push(change.path);
      profiles.set(change.validationProfile, pathsForProfile);
    }

    const verificationByProfile = new Map<ValidationProfile, RepairVerificationResult>();
    if (profiles.size > 0) {
      await appendApplyJournal("VALIDATING", {
        profiles: [...profiles.entries()].map(([profile, paths]) => ({ profile, paths })),
      });
    }
    for (const [profile, profilePaths] of profiles) {
      const validation = await runRepairValidation(
        deliveryWorkspace.workspaceRoot,
        profile,
        profilePaths,
      );
      if ("evidence" in validation) {
        validation.evidence.operationId = applyCorrelationId;
        validation.evidence.projectRevision = deliveryWorkspace.baseRevision;
        validation.evidence.baseTreeHash = deliveryWorkspace.baseTreeHash;
        validation.evidence.treeDigestVersion = DELIVERY_TREE_DIGEST_VERSION;
        validation.evidence.candidateHash = candidateHash;
        validation.evidence.changeSetHash = effectiveChangeSetHash;
      }
      verificationByProfile.set(profile, validation);
    }

    const candidateHashAfterValidation = await hashDeliveryTree(deliveryWorkspace.workspaceRoot);
    const candidateChangedDuringValidation = candidateHashAfterValidation !== candidateHash;
    const liveRootHashBeforePromotion = await hashDeliveryTree(resolvedRoot);
    const liveRootChangedBeforePromotion = liveRootHashBeforePromotion !== deliveryWorkspace.baseTreeHash;
    const validationNeedsReview = candidateChangedDuringValidation || liveRootChangedBeforePromotion || [...verificationByProfile.values()].some((validation) =>
      validation.status === "failed" ||
      validation.status === "unavailable" ||
      validation.status === "skipped" ||
      validation.status === "blocked",
    );
    if (validationNeedsReview) {
      // Behavioral validation is a promotion gate. Keep the candidate for
      // inspection/recovery, but never write an unproven candidate to the
      // user's live project.
      for (const change of candidateChanges) {
        results.push({
          path: change.path,
          ok: false,
          error: "Behavioral verification did not pass; the candidate was not promoted.",
        });
      }
      await appendApplyJournal("BLOCKED", {
        reason: candidateChangedDuringValidation
          ? "candidate_changed_after_validation"
          : liveRootChangedBeforePromotion
            ? "live_root_changed_before_promotion"
            : "behavioral_validation",
        candidateHash,
        changeSetHash: effectiveChangeSetHash,
        baseTreeHash: deliveryWorkspace.baseTreeHash,
        candidateTreeHash,
        treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
        liveRootHashBeforePromotion,
      });
    } else {
      await appendApplyJournal("WRITING_STARTED", {
        fileCount: writableChanges.length,
        files: writableChanges.map((change) => change.path),
      });
      await appendApplyJournal("PROMOTION_INTENT", {
        operationId: applyCorrelationId,
        candidateWorkspace: deliveryWorkspace.workspaceRoot,
        candidateHash,
        baseRevision: deliveryWorkspace.baseRevision,
        changeSetHash: effectiveChangeSetHash,
        files: writableChanges.map((change) => ({
          path: change.path,
          originalContent: change.before?.toString("utf8") ?? null,
          newContent: change.newContent,
        })),
      });
      let writeFailure: string | undefined;
      try {
        for (const change of writableChanges) {
          attemptedChanges.push(change);
          await atomicallyPromoteFile(change.realPath, change.newContent, applyCorrelationId);
          const persisted = await fs.readFile(change.realPath, "utf-8");
          if (persisted !== change.newContent) {
            throw new Error("Post-write persistence verification failed.");
          }
          writtenChanges.push(change);
          results.push({ path: change.path, ok: true });
        }
        await appendApplyJournal("WRITTEN", {
          files: writtenChanges.map((change) => change.path),
          promotionState: "PROMOTED",
        });
      } catch (e) {
        writeFailure = e instanceof Error ? e.message : String(e);
        rollbackFailures = await restoreApplySnapshots([...attemptedChanges].reverse());
        for (const result of results) {
          if (result.ok) {
            result.ok = false;
            result.writeStatus = rollbackFailures.length > 0 ? "unknown" : "not_written";
            result.persistenceVerified = false;
            result.error = rollbackFailures.length > 0
              ? `Apply encountered a write failure and rollback could not be verified: ${writeFailure}`
              : `Apply rolled back after a file write failed: ${writeFailure}`;
          }
        }
        for (const change of writableChanges.slice(writtenChanges.length)) {
          results.push({ path: change.path, ok: false, error: `Apply aborted: ${writeFailure}` });
        }
        await appendApplyJournal("WRITE_FAILED", {
          error: writeFailure,
          writtenFiles: attemptedChanges.map((change) => change.path),
        });
        await appendApplyJournal(
          rollbackFailures.length > 0 ? "ROLLBACK_FAILED" : "ROLLED_BACK",
          {
            failures: rollbackFailures,
            writtenFiles: writtenChanges.map((change) => change.path),
          },
        );
      }
    }

    promotedTreeHash = await hashDeliveryTree(resolvedRoot);
    if (writtenChanges.length > 0 && promotedTreeHash !== candidateHash) {
      promotionMismatch = true;
      for (const result of results) {
        if (result.ok) {
          result.ok = false;
          result.writeStatus = "unknown";
          result.persistenceVerified = false;
          result.error = "Promoted bytes do not match the validated candidate.";
        }
      }
      rollbackFailures = await restoreApplySnapshots([...writtenChanges].reverse());
      const rollbackTreeHash = await hashDeliveryTree(resolvedRoot).catch(() => null);
      await appendApplyJournal(rollbackFailures.length > 0 ? "ROLLBACK_FAILED" : "ROLLED_BACK", {
        reason: "promoted_candidate_hash_mismatch",
        candidateHash,
        changeSetHash: effectiveChangeSetHash,
        promotedTreeHash,
        rollbackTreeHash,
        failures: rollbackFailures,
      });
      if (rollbackFailures.length === 0 && rollbackTreeHash !== deliveryWorkspace.baseTreeHash) {
        await appendApplyJournal("RECOVERY_REQUIRED", {
          reason: "rollback_tree_mismatch",
          promotedTreeHash,
          rollbackTreeHash,
        });
      }
    }
    for (const validation of verificationByProfile.values()) {
      if (
        writtenChanges.length > 0
        && !promotionMismatch
        && promotedTreeHash === candidateHash
        && "evidence" in validation
      ) {
        validation.evidence.promotedHash = promotedTreeHash;
      }
    }
    const validationEvidence = [...verificationByProfile.values()].flatMap((validation) => {
      if (!("evidence" in validation)) return [];
      const stale = candidateChangedDuringValidation || liveRootChangedBeforePromotion || promotionMismatch;
      return [publicValidationReceipt(validation, stale
        ? {
            status: "blocked",
            detail: candidateChangedDuringValidation
              ? "The immutable candidate changed during validation and was not promoted."
              : liveRootChangedBeforePromotion
                ? "The project changed before promotion and the validated candidate was not promoted."
                : "The promoted tree did not match the validated candidate.",
          }
        : undefined)];
    });

    const responseResults = results.map((result) => {
      const change = writableChanges.find((item) => item.path === result.path);
      const verification = change?.validationProfile
        ? verificationByProfile.get(change.validationProfile) ?? {
            ...makeSyntheticValidationResult(
              change.validationProfile,
              "unavailable",
              "Registered validation did not produce a result.",
              "Behavioral verification did not produce a result.",
            ),
          }
        : {
            ...makeSyntheticValidationResult(
              "",
              "skipped",
              "No registered behavioral validation profile was selected.",
              "No registered behavioral validation profile was selected.",
            ),
          };
      return {
        ...result,
        writeStatus: result.writeStatus ?? (result.ok ? "written" as const : "not_written" as const),
        persistenceVerified: result.ok,
        behavioralVerification: result.behavioralVerification ?? verification,
      };
    });
    const verificationNeedsReviewAfterPromotion = responseResults.some((result) =>
      result.behavioralVerification.status === "failed" ||
      result.behavioralVerification.status === "unavailable" ||
      result.behavioralVerification.status === "skipped" ||
      result.behavioralVerification.status === "blocked",
    );
    if (verificationNeedsReviewAfterPromotion && responseResults.some((result) => result.ok)) {
      // Behavioral verification is a correctness gate, not an advisory report.
      // Never leave a persisted AI repair in place when its registered
      // validation did not pass. Keeping the proposal pending allows the user
      // to review the failure and retry with a fresh approved change.
      rollbackFailures = await restoreApplySnapshots([...writtenChanges].reverse());
      await appendApplyJournal(
        rollbackFailures.length > 0 ? "ROLLBACK_FAILED" : "ROLLED_BACK",
        {
          reason: "behavioral_validation",
          failures: rollbackFailures,
          writtenFiles: writtenChanges.map((change) => change.path),
        },
      );
      for (const result of responseResults) {
        if (!result.ok) continue;
        result.ok = false;
        result.writeStatus = rollbackFailures.length > 0 ? "unknown" : "not_written";
        result.persistenceVerified = false;
        result.error = rollbackFailures.length > 0
          ? "Behavioral verification did not pass and rollback could not be verified; filesystem state is unknown."
          : "Behavioral verification did not pass; the file change was rolled back.";
      }
    }

    const appliedPaths = responseResults.filter((r) => r.ok).map((r) => r.path);
    const failedPaths  = responseResults.filter((r) => !r.ok).map((r) => r.path);

    if (appliedPaths.length > 0) {
      invalidateContextCache(projectId);
    }

    const allOk = responseResults.every((r) => r.ok)
      && !verificationNeedsReviewAfterPromotion
      && !promotionMismatch
      && promotedTreeHash === candidateHash;
    const rollbackFailed = rollbackFailures.length > 0;
    const applyStatus = rollbackFailed
      ? "ROLLBACK_FAILED"
      : allOk
        ? "APPLIED"
        : "BLOCKED";
    const integrityOutcome = rollbackFailed
      ? "unknown"
      : promotionMismatch
        ? "mismatch"
        : allOk
          ? "verified"
          : "blocked";

    // Do not record a successful AI execution event until the mandatory
    // behavioral validation has passed. Persistence and behavior remain
    // separate in the payload so a failed validator cannot hide a rollback.
    // proposalId is the durable operation identity. Reusing it makes the
    // plan/apply/commit/push lifecycle queryable as one trace instead of
    // creating a new correlation for every write step.
    const preview = appliedPaths.length > 0
      ? appliedPaths.slice(0, 3).join(", ") + (appliedPaths.length > 3 ? ` +${appliedPaths.length - 3} more` : "")
      : failedPaths.slice(0, 3).join(", ") + (failedPaths.length > 3 ? ` +${failedPaths.length - 3} more` : "");
    await db.transaction(async (tx) => {
      journalSequence += 1;
      await tx.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: applyCorrelationId,
        attemptId: applyAttemptId,
        projectId,
        proposalId,
        stage: applyStatus,
        sequence: journalSequence,
        payload: {
          appliedFiles: appliedPaths,
          failedFiles: failedPaths,
          rollbackFailures,
          candidateHash,
          changeSetHash: effectiveChangeSetHash,
          baseTreeHash: deliveryWorkspace.baseTreeHash,
          candidateTreeHash,
          promotedTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          promotionMismatch,
          integrityOutcome,
        },
      });
      await tx.insert(auditLogsTable).values({
        // Each attempt gets its own audit row; correlationId remains stable
        // across retries of the same plan/apply operation.
        id: randomUUID(),
        entityType: "project",
        entityId: projectId,
        action: "ai_executed",
        projectId,
        actor: req.userId,
        stateBefore: {},
        stateAfter: {
          filesWritten: appliedPaths,
          failedFiles: failedPaths,
          applyStatus,
          proposalId,
          operationId: applyCorrelationId,
          candidateHash,
          changeSetHash: effectiveChangeSetHash,
          baseTreeHash: deliveryWorkspace.baseTreeHash,
          candidateTreeHash,
          promotedTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          promotionMismatch,
          integrityOutcome,
          rollbackFailures,
          behavioralVerification: responseResults.map((result) => ({
            path: result.path,
            status: result.behavioralVerification.status,
          })),
        },
        correlationId: applyCorrelationId,
      });
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "AiChangesApplied",
        projectId,
        severity: rollbackFailed
          ? "error"
          : appliedPaths.length > 0 && !verificationNeedsReviewAfterPromotion
            ? (failedPaths.length > 0 ? "warning" : "success")
            : "warning",
        message: appliedPaths.length > 0
          ? `AI applied ${appliedPaths.length} file change${appliedPaths.length !== 1 ? "s" : ""}: ${preview}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}${verificationNeedsReviewAfterPromotion ? " (behavioral verification needs review)" : ""}`
          : rollbackFailed
            ? `AI apply rollback failed; filesystem state is unknown: ${rollbackFailures.map((failure) => failure.path).join(", ")}`
            : `AI apply made no writable changes: ${preview || "none"}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}`,
        correlationId: applyCorrelationId,
        payload: {
          proposalId,
          operationId: applyCorrelationId,
          appliedFiles: appliedPaths,
          failedFiles: failedPaths,
          applyStatus,
          integrityOutcome,
          rollbackFailures,
          candidateHash,
          changeSetHash: effectiveChangeSetHash,
          baseTreeHash: deliveryWorkspace.baseTreeHash,
          candidateTreeHash,
          promotedTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          promotionMismatch,
          behavioralVerification: responseResults.map((result) => ({
            path: result.path,
            status: result.behavioralVerification.status,
          })),
        },
      });
      if (appliedPaths.length > 0) {
        await tx
          .update(aiChangeProposalsTable)
          .set({
            status: "applied",
            lifecycle: verificationNeedsReviewAfterPromotion ? "blocked" : "applied",
            consumedAt: new Date(),
            validationEvidence: JSON.stringify(validationEvidence),
            baseTreeHash: deliveryWorkspace.baseTreeHash,
            candidateTreeHash,
            promotedTreeHash,
            treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
            committedHash: null,
            appliedChanges: allOk
              ? JSON.stringify(writtenChanges.map((change) => ({
                  path: change.path,
                  newContent: change.newContent,
                })))
              : null,
          })
          .where(and(
            eq(aiChangeProposalsTable.id, proposalId),
            eq(aiChangeProposalsTable.status, "pending"),
          ));
      } else {
        await tx.update(aiChangeProposalsTable)
          .set({
            lifecycle: rollbackFailed || failedPaths.length > 0 ? "conflicted" : "blocked",
            conflictReason: rollbackFailed
              ? "Apply rollback did not fully restore the working tree."
              : failedPaths.length > 0
                ? "One or more approved files could not be applied."
                : "No approved files were applied.",
            validationEvidence: JSON.stringify(validationEvidence),
            baseTreeHash: deliveryWorkspace.baseTreeHash,
            candidateTreeHash,
            promotedTreeHash,
            treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          })
          .where(and(
            eq(aiChangeProposalsTable.id, proposalId),
            eq(aiChangeProposalsTable.status, "pending"),
          ));
      }
    });

    // Applying a pending change proves only that the guarded file write
    // succeeded. It does not prove that the proposed repair is behaviorally
    // correct, so make that distinction explicit in the response contract.
    return res.status(rollbackFailed ? 500 : allOk ? 200 : 207).json({
      results: responseResults,
      correlationId: applyCorrelationId,
      applyStatus,
      integrityOutcome,
      baseTreeHash: deliveryWorkspace.baseTreeHash,
      candidateTreeHash,
      promotedTreeHash,
      changeSetHash: effectiveChangeSetHash,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
      rollbackFailures,
      validationEvidence,
    });
  } finally {
    await applyLock.release();
  }
});

export default router;
