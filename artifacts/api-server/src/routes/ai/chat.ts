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
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  buildProjectContext,
  invalidateContextCache,
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
  resolveTurnIntent,
  isImmediateExecutionRequest,
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
  buildPatchHunks,
  hashPatchBase,
  rebasePatchHunks,
  buildProjectFileManifest,
  buildProjectFileSources,
  deriveFlightDeckState,
  isProvenValidation,
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
  ValidationResult,
} from "@workspace/ai-orchestrator";
import type { ValidationProfile } from "@workspace/ai-orchestrator";
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
import { tryAdvisoryLock, LockNamespace } from "../../lib/advisory-lock.js";
import {
  getRepairValidationProfile,
  runRepairValidation,
  validateRepairValidationScope,
  type PendingValidationChange,
  type RepairVerificationResult,
} from "../../lib/ai-repair-validation.js";
import {
  AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT,
  AI_EXECUTION_TRACE_LIMIT,
  buildAiExecutionResumeContext,
  checkpointAiExecution,
  claimAiExecution,
  completeAiExecution,
  createAiExecution,
  failAiExecution,
  getAiExecutionForUser,
  parseAiExecutionCheckpoint,
  parseExecutionRequest,
  requestAiExecutionCancel,
  reconcileExecutionNodeCheckpoint,
  registerAiExecutionController,
  unregisterAiExecutionController,
  type AiExecutionCheckpoint,
  type AiExecutionRequestEnvelope,
} from "../../lib/ai-execution-state.js";
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

function parseStoredJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
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

type ApprovedImplementationPlan = Extract<
  ChatTaskResult,
  { kind: "IMPLEMENTATION_PLAN_RESULT" }
>;

function normalizePlanFilePath(value: string, rootPath: string): string {
  const raw = value.trim().replaceAll("\\", "/");
  const candidate = path.isAbsolute(raw) ? path.relative(rootPath, raw) : raw;
  return path.posix.normalize(candidate).replace(/^(\.\/)+/, "");
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
  | "ROLLBACK_FAILED";

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
  kind: AgentStep["kind"] | "audit_scope";
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
  stopReason?: "response" | "iteration_budget" | "soft_limit" | "repeated_tool_call" | "empty_response" | "provider_timeout" | "cancelled";
  synthesisStarted?: boolean;
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
  }>;
  reason?: string;
  root?: string;
  packetIndex?: number;
  packetCount?: number;
  fileCount?: number;
  status?: "STARTED" | "ACCEPTED" | "REJECTED" | "FAILED";
  diagnosticCodes?: string[];
  details?: string[];
  model?: string;
  provider?: string;
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
  validation?: ValidationResult;
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
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        };
      case "validation":
        return {
          kind: step.kind,
          validation: step.result,
          validationStatus: step.result.status,
          repairState: step.repairState,
          validationProfile: step.result.profile,
          validationScenario: step.result.scenario,
          validationCommand: step.result.command,
          validationExitCode: step.result.exitCode,
          validationFailedTests: step.result.failedTests.map((failure) => failure.name || failure.message),
          validationAffectedFiles: step.result.changedFiles,
          validationFailedTestDetails: step.result.failedTests,
          validationChangedFiles: step.result.changedFiles,
          validationAttempt: step.attempt,
          validationMaxAttempts: step.maxAttempts,
          validationDetail: step.result.detail,
          attempt: step.attempt,
          maxAttempts: step.maxAttempts,
        };
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
        return {
          kind: step.kind,
          code: step.code,
          ...(includeDiagnosticDetails && step.details ? { details: step.details } : {}),
        };
      case "model_call":
        return { kind: step.kind, model: step.model, provider: step.provider };
      case "recovery_model_call":
        return {
          kind: step.kind,
          model: step.model,
          provider: step.provider,
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
          ...(step.evidenceSourceCoverage
            ? { evidenceSourceCoverage: step.evidenceSourceCoverage }
            : {}),
           ...(step.scopeExpansions ? { scopeExpansions: step.scopeExpansions } : {}),
           ...(step.unjustifiedReads ? { unjustifiedReads: step.unjustifiedReads } : {}),
        };
      case "done":
        return {
          kind: step.kind,
          iterations: step.iterations,
          maxIterations: step.maxIterations,
          toolCalls: step.toolCalls,
          prefetchToolCalls: step.prefetchToolCalls,
          loopToolCalls: step.loopToolCalls,
          stopReason: step.stopReason,
          synthesisStarted: step.synthesisStarted,
          ...(steps.some((candidate) => candidate.kind === "forensic_recovery_start")
            ? { recoveryStarted: true }
            : {}),
          modelsUsed: steps
            .filter((candidate): candidate is Extract<AgentStep, { kind: "model_call" | "recovery_model_call" }> =>
              candidate.kind === "model_call" || candidate.kind === "recovery_model_call",
            )
            .map((candidate) => candidate.model)
            .filter((model, index, models) => models.indexOf(model) === index)
            .slice(0, 12),
          diagnosticCodes,
          ...(includeDiagnosticDetails && diagnosticDetails.length > 0 ? { diagnosticDetails } : {}),
        };
    }
  });
  if (scopeDescription) entries.unshift({ kind: "audit_scope", scopeDescription });
  return redactUserFacingText(JSON.stringify(entries));
}

// ── Profile → context sections mapping ──────────────────────────────────────
// Maps the classifier's contextProfile to the DB sections buildProjectContext
// should load. Lite turns load the minimum; deep turns load everything.
type ContextSection = "tasks" | "metrics" | "graphEntities" | "graphRelationships" | "events" | "workflows";
function profileContextSections(profile: "chat-lite" | "chat-normal" | "chat-deep" | "chat"): ContextSection[] {
  switch (profile) {
    case "chat-lite":   return ["tasks"];
    case "chat-normal": return ["tasks", "metrics"];
    case "chat-deep":   return ["tasks", "metrics", "graphEntities", "graphRelationships", "events", "workflows"];
    case "chat":        return ["tasks", "metrics"]; // legacy alias → chat-normal
  }
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
  now: Date;
  readFiles: string[];
  executionPlan: ActiveTaskExecutionPlan | null;
}): string | null {
  if (args.persisted && (args.resumed || args.executionPlan)) {
    const touched = touchActiveTaskState(args.persisted, args.now);
    return serializeActiveTaskState(
      {
        ...mergeActiveTaskEvidence(touched, args.readFiles, args.now),
        executionPlan: args.executionPlan ?? touched.executionPlan,
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

    const now = new Date();

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
  const resumableStateForTurn = isolatedConversationTurn
    ? null
    : persistedActiveTaskState;
  const classificationResolution = resumeActiveTaskClassification(
    message,
    rawTurnClassification,
    resumableStateForTurn,
  );
  const chatClassification = classificationResolution.classification;
  const turnIntent = resolveTurnIntent(message, {
    classification: chatClassification,
    resumed: classificationResolution.resumed,
  });
  const modelHasTools = Boolean(validRootPath && turnIntent.requiresTools);
  const immediateExecutionRequest = isImmediateExecutionRequest(message);
  // Fetch a stable bounded history for every ordinary request. chat-agent
  // keeps the latest complete turns verbatim and summarizes older turns,
  // while execution handoffs can still recover an older repair plan from this
  // larger fixed window.
  const historyLimit = CONVERSATION_HISTORY_FETCH_MESSAGES;

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

  const applyProbe = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
  if (!applyProbe.acquired) {
    return res.status(409).json({
      error: "apply_in_progress",
      hint: "File changes are still being written for this project — wait a moment, then retry.",
    });
  }
  try {
    const baseProjectContext = await buildProjectContext(projectId, {
      sections: profileContextSections(chatClassification.contextProfile),
    });
    const projectContext = chatClassification.implementationPlanMode
      ? {
          ...baseProjectContext,
          ...await (async () => {
            const filesystemManifest = await buildProjectFileManifest(validRootPath);
            return {
              filesystemManifest,
              filesystemSources: await buildProjectFileSources(validRootPath, filesystemManifest, message),
            };
          })(),
        }
      : baseProjectContext;
    // Enrich context with cross-session memories (outside cache; always fresh).
    // Failure is non-fatal — agent proceeds without memory context.
    await enrichContextWithMemories(projectContext, projectId).catch((err) => {
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
      requireTools: modelHasTools,
      requiresEvidence: turnIntent.requiresEvidence,
      qualityProfile: turnIntent.executionTaskType,
      contextProfile: chatClassification.contextProfile,
      executionHandoff: {
        requested: immediateExecutionRequest,
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
          rootPath: validRootPath,
          projectId,
          activeTaskState: resumableStateForTurn,
          activeTask,
          productionTraceLinks: runtimeChatTraceLinks("POST /api/ai/chat"),
          objective,
          turnIntent,
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
      if (handleOrchestratorError(err, res, { projectId, operation: "chat", provider })) return;
      throw err;
    }

    if (result._parseError) {
      if (!result.response) {
        return res.status(422).json({
          error: "model_output_invalid",
          code: "model_output_invalid",
          hint: "The AI model returned an unexpected response — try rephrasing your message.",
          parseCode: result._parseError.code,
        });
      }
      logger.warn(
        { parseCode: result._parseError.code, rawPreview: result._parseError.raw.slice(0, 200) },
        "AI parse failure — using fallback response",
      );
    }

    // Chat turns don't modify project data — no cache invalidation needed.
    // Full invalidation happens only in /apply-changes when files are written.

    const msgNow = new Date();
    const sessionIdToUse = existingSession?.id ?? randomUUID();

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const proposalChanges = bindPendingChangesToRepairPlan(
      (result.pendingChanges ?? []) as ServerPendingChange[],
      result.repairPlan,
    );
    const proposalId = canCreateProposal(
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
    const activeTaskState = nextSessionTaskState({
      persisted: resumableStateForTurn,
      classification: chatClassification,
      resumed: classificationResolution.resumed,
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      now: msgNow,
      readFiles: collectReadEvidencePaths(traceSteps),
      executionPlan,
    });

    const assistantMsg = await db.transaction(async (tx) => {
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
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(redactUserFacingValue(result.sources)),
          toolTrace: serializeToolTrace(traceSteps),
          repairPlanMetadata: serializeRepairPlanMetadata(result.repairPlan),
          behaviorEvidence: serializeBehaviorEvidence(result.behaviorEvidence),
          taskResult: serializeTaskResult(result.taskResult),
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
        .set({ updatedAt: msgNow, activeTaskState })
        .where(eq(aiChatSessionsTable.id, sessionIdToUse));
      return msg;
    });
    // Fire-and-forget memory write — must not block the JSON response.
    writeSessionMemories(
      sessionIdToUse,
      projectId,
      redactUserFacingValue(result.sources),
      sanitizeResponseText(result.response),
    ).catch((err) => {
      logger.warn({ err, projectId }, "memory-write: failed to persist session memories");
    });

    return res.json({
      sessionId: sessionIdToUse,
      message: { ...assistantMsg, taskResult: parseTaskResult(assistantMsg.taskResult) },
      sources: redactUserFacingValue(result.sources),
      toolTrace: assistantMsg.toolTrace,
      pendingChanges: proposalId
        ? proposalChanges
        : [],
      proposalId,
      proposalUnavailable: (result.pendingChanges?.length ?? 0) > 0 && !proposalId
        ? hasPassedLatestValidation(traceSteps)
          ? "Repair changes require closed Finding/claim evidence before approval."
          : "Repair changes require a verified validation profile before approval."
        : undefined,
      // STORY-04: actual model used (may differ from default if fallback occurred)
      resolvedModel: result.resolvedModel,
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
  const streamResumableStateForTurn = isolatedConversationTurn
    ? null
    : persistedActiveTaskState;
  const streamClassificationResolution = resumeActiveTaskClassification(
    message,
    rawTurnClassification,
    streamResumableStateForTurn,
  );
  const streamClassification = streamClassificationResolution.classification;
  const streamTurnIntent = resolveTurnIntent(message, {
    classification: streamClassification,
    resumed: streamClassificationResolution.resumed,
    buildHandoff: Boolean(approvedImplementationPlan && effectiveBuildPlanMessageId),
  });
  // Keep this compatible with consumers that still resolve the pre-scope
  // TurnIntent declaration while the workspace packages are being rebuilt.
  const streamAuditScopeDescription = (streamTurnIntent as unknown as {
    auditScopeDescription?: string;
  }).auditScopeDescription;
  const streamModelHasTools = Boolean(validRootPath && streamTurnIntent.requiresTools);

  // Provider/model routing must use the same authoritative intent as the
  // downstream agent. In particular, a terse continuation can inherit a
  // persisted forensic task and must not be routed from its raw text alone.
  const providerResolved = await requireProvider(req.userId, res, {
    requireTools: streamModelHasTools,
    qualityProfile: streamTurnIntent.executionTaskType,
  });
  if (!providerResolved) return;
  const { provider, apiKey } = providerResolved;

  const applyLock = await tryAdvisoryLock(LockNamespace.APPLY, projectId);
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

    const now = new Date();
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

    const executionRequest: AiExecutionRequestEnvelope = {
      projectId,
      sessionId: sessionIdToUse,
      message,
      modelMessage,
      ...(effectiveLinkedTaskId ? { linkedTaskId: effectiveLinkedTaskId } : {}),
      ...(effectiveBuildPlanMessageId ? { buildPlanMessageId: effectiveBuildPlanMessageId } : {}),
      ...(objective ? { objective } : {}),
      validationTargetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
      proofRequired: Boolean(
        streamTurnIntent.requiresEvidence
        ||
        effectiveLinkedTaskId
        || effectiveBuildPlanMessageId
        || objective
        || (implementationPlanScope && implementationPlanScope.size > 0)
        || isImmediateExecutionRequest(message),
      ),
    };
    const proofRequired = executionRequest.proofRequired === true;
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
      const bindingMatches = storedRequest &&
        storedRequest.projectId === executionRequest.projectId &&
        storedRequest.sessionId === executionRequest.sessionId &&
        storedRequest.message === executionRequest.message &&
        (
          storedRequest.modelMessage === executionRequest.modelMessage
          || legacyBuildModelBinding
        ) &&
        (storedRequest.linkedTaskId ?? undefined) === (executionRequest.linkedTaskId ?? undefined) &&
        (storedRequest.buildPlanMessageId ?? undefined) === (executionRequest.buildPlanMessageId ?? undefined) &&
        JSON.stringify(storedRequest.validationTargetPaths) === JSON.stringify(executionRequest.validationTargetPaths) &&
        JSON.stringify(storedRequest.objective ?? null) === JSON.stringify(executionRequest.objective ?? null) &&
        (
          storedRequest.proofRequired === undefined
          || Boolean(storedRequest.proofRequired) === Boolean(executionRequest.proofRequired)
        );
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
      executionResumeToken = created.resumeToken;
      const claimed = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
      });
      if (!claimed) {
        sse({ type: "error", code: "EXECUTION_CLAIM_CONFLICT", message: "Failed to claim AI execution" });
        res.end();
        return;
      }
      aiExecution = claimed;
    }

    let checkpointSequence = aiExecution.checkpointVersion;
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
    const activeExecutionAbortController = new AbortController();
    executionAbortController = activeExecutionAbortController;
    registerAiExecutionController(aiExecution.id, activeExecutionAbortController);
    let checkpointChain: Promise<void> = Promise.resolve();
    let executionEvidenceVerdict: FlightDeckEvidenceVerdict = "NOT_RECORDED";
    let executionEvidenceReason = proofRequired
      ? "No accepted validation evidence has been recorded."
      : "Ordinary chat response; Flight Deck proof is not required.";
    const persistExecutionCheckpoint = (checkpoint: Omit<AiExecutionCheckpoint, "sequence" | "updatedAt">): void => {
      const sequence = ++checkpointSequence;
      const completeCheckpoint: AiExecutionCheckpoint = {
        ...checkpoint,
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
            logger.warn({ executionId: aiExecution!.id, sequence }, "AI execution checkpoint rejected by lease/state gate");
          }
        })
        .catch((err) => {
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
      persistExecutionCheckpoint({
        stage: "running",
        streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
        recentSteps: traceSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as unknown as Array<Record<string, unknown>>,
      });
    };

    sse({
      type: "execution_started",
      executionId: aiExecution.id,
      status: aiExecution.status,
      ...(executionResumeToken ? { resumeToken: executionResumeToken } : {}),
      resumable: true,
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
          recentSteps: traceSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as unknown as Array<Record<string, unknown>>,
        });
      }
    });

    const streamIsGreetingTurn = isolatedConversationTurn;
    const immediateExecutionRequest = isImmediateExecutionRequest(message);
    const historyLimit = CONVERSATION_HISTORY_FETCH_MESSAGES;

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
      sections: profileContextSections(streamClassification.contextProfile),
    });
    const projectContext = streamClassification.implementationPlanMode
      ? {
          ...baseProjectContext,
          ...await (async () => {
            const filesystemManifest = await buildProjectFileManifest(validRootPath);
            return {
              filesystemManifest,
              filesystemSources: await buildProjectFileSources(validRootPath, filesystemManifest, message),
            };
          })(),
        }
      : baseProjectContext;
    // Enrich with cross-session memories (outside cache; always fresh).
    await enrichContextWithMemories(projectContext, projectId).catch((err) => {
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
      requireTools: streamModelHasTools,
      requiresEvidence: streamTurnIntent.requiresEvidence,
      qualityProfile: streamTurnIntent.executionTaskType,
      contextProfile: streamClassification.contextProfile,
      executionHandoff: {
        requested: immediateExecutionRequest,
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
          stopReason: "response" | "iteration_budget" | "soft_limit" | "repeated_tool_call" | "empty_response" | "provider_timeout" | "cancelled";
          synthesisStarted: boolean;
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
        recentSteps: traceSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as unknown as Array<Record<string, unknown>>,
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
          ...("prefetched" in step && step.prefetched ? { prefetched: true } : {}),
        });
      } else if (step.kind === "validation") {
        sse({
          type: "validation",
          validation: step.result,
          // Compatibility projection for clients that predate ValidationResult.
          status: step.result.status,
          repairState: step.repairState,
          profile: step.result.profile,
          scenario: step.result.scenario,
          command: step.result.command,
          exitCode: step.result.exitCode,
          failedTests: step.result.failedTests.map((failure) => failure.name || failure.message),
          affectedFiles: step.result.changedFiles,
          failedTestDetails: step.result.failedTests,
          changedFiles: step.result.changedFiles,
          attempt: step.attempt,
          maxAttempts: step.maxAttempts,
          detail: step.result.detail,
        });
      } else if (step.kind === "repair_state") {
        sse({
          type: "repair_state",
          state: step.state,
          detail: step.detail,
        });
      } else if (step.kind === "model_call") {
        sse({ type: "model_call", model: step.model, provider: step.provider });
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
        sse({
          type: "forensic_status",
          auditScope: step.auditScope,
          ...(streamAuditScopeDescription
            ? { scopeDescription: streamAuditScopeDescription }
            : {}),
          ...(step.requestedFiles ? { requestedFiles: step.requestedFiles } : {}),
          isFixtureLocal: step.isFixtureLocal === true ? true : undefined,
        });
      } else if (step.kind === "audit_state") {
        sse({ type: "audit_state", ...step.state });
      } else if (step.kind === "forensic_terminal") {
        sse({ type: "forensic_terminal", terminalKind: step.terminalKind });
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
        executionSummary = {
          iterations: step.iterations,
          maxIterations: step.maxIterations,
          toolCalls: step.toolCalls,
          prefetchToolCalls: step.prefetchToolCalls,
          loopToolCalls: step.loopToolCalls,
          stopReason: step.stopReason,
          synthesisStarted: step.synthesisStarted,
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
          ? undefined
          : step.details;
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
        if (executionSummary && step.details) {
          executionSummary.diagnosticDetails = [...executionDiagnosticDetails];
        }
        sse({
          type: "execution_diagnostic",
          code: step.code,
          ...(visibleDiagnosticDetails ? { details: visibleDiagnosticDetails } : {}),
        });
      }
    }

    const validationRunner =
      approvedImplementationPlan && implementationPlanScope && validRootPath
        ? async (
            profile: string,
            targetPaths: string[],
            signal?: AbortSignal,
            pendingChanges?: readonly PendingValidationChange[],
          ) => {
            const parsedProfile = ValidationProfileSchema.safeParse(profile);
            if (!parsedProfile.success) {
              return {
                status: "unavailable" as const,
                detail: `Validation profile "${profile}" is not registered.`,
              };
            }
            return runRepairValidation(
              validRootPath,
              parsedProfile.data,
              targetPaths,
              signal,
              pendingChanges ?? [],
            );
          }
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
          rootPath: validRootPath,
          projectId,
          activeTaskState: streamResumableStateForTurn,
          executionPlanOverride: executionPlanForRun ?? undefined,
          activeTask,
          productionTraceLinks: runtimeChatTraceLinks("POST /api/ai/chat/stream"),
          objective,
          allowValidationTools: Boolean(validationRunner),
          validationRunner,
          validationTargetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
           buildHandoff: Boolean(!streamIsGreetingTurn && approvedImplementationPlan && effectiveBuildPlanMessageId),
          onExecutionNodes: publishExecutionNodes,
          signal: activeExecutionAbortController.signal,
          turnIntent: streamTurnIntent,
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
      if (err instanceof GroqClientError) {
        if (err.code === "MODEL_NOT_FOUND" || err.code === "MODEL_UNAVAILABLE") {
          recordInvalidModel(provider);
        }
        logger.error(
          { code: err.code, message: err.message, provider,
            providerStatus: err.providerStatus, providerModel: err.providerModel },
          "chat stream: all providers failed",
        );

        // PR-009: structured error with provider context so the dashboard can
        // show actionable diagnostics (model name, HTTP status, suggestedFix).
        const providerCtx = err.toProviderContext() ?? {};
        // Provider messages can contain request IDs, file paths, or upstream
        // diagnostics. They remain in the structured server log above, not on
        // the user-facing stream.
        const publicProviderCtx = Object.fromEntries(
          Object.entries(providerCtx).filter(([key]) => key !== "providerMessage"),
        );
        const base: Record<string, unknown> = {
          type: "error",
          code: err.code,
          // PR-007: surface provider context on the wire.
          ...(Object.keys(publicProviderCtx).length > 0
            ? { providerContext: redactUserFacingValue(publicProviderCtx) }
            : {}),
        };

        switch (err.code) {
          case "RATE_LIMITED":
            // SSE headers were flushed before provider execution starts, so
            // the retry hint must travel in the error event rather than via
            // HTTP Retry-After.
            sse({
              ...base,
              message: `Rate limit reached on all configured AI providers — retry after ${Math.max(1, Math.ceil((err.retryAfterMs ?? 30_000) / 1000))} seconds.`,
              retryAfterMs: err.retryAfterMs,
              retryable: true,
              suggestedFix: "Retry after the indicated delay or configure another provider.",
            });
            break;
          case "QUOTA":
            sse({
              ...base,
              message: "AI provider billing quota or credits are exhausted.",
              retryable: false,
              suggestedFix: "Check your OpenRouter/provider account balance and top up credits.",
            });
            break;
          case "AUTH_ERROR":
            sse({
              ...base,
              message: "AI provider key is invalid or unauthorized.",
              retryable: false,
              suggestedFix: "Delete your current provider key and save a valid one in Settings.",
            });
            break;
          case "MODEL_NOT_FOUND":
            sse({
              ...base,
               message: redactUserFacingText(
                 `All AI model fallbacks exhausted${err.providerModel ? ` (last tried: ${err.providerModel})` : ""} — no model was available.`,
               ),
              retryable: false,
              suggestedFix: "Check your OpenRouter API key and model availability on openrouter.ai/models.",
            });
            break;
          case "PLAN_RESTRICTED":
            sse({
              ...base,
              message: "The selected AI model requires a paid plan or credit balance — all free-tier fallbacks failed.",
              retryable: false,
              suggestedFix: "Add credit balance to your OpenRouter account, or save a Groq/Gemini API key as a free fallback.",
            });
            break;
          case "MODEL_UNAVAILABLE":
            sse({
              ...base,
               message: redactUserFacingText(
                 `AI model temporarily unavailable${err.providerModel ? ` (${err.providerModel})` : ""} — all fallbacks also unavailable.`,
               ),
              retryable: true,
              suggestedFix: "Try again in a few minutes; the model may be back online.",
            });
            break;
          case "TIMEOUT":
          case "NETWORK_ERROR":
            sse({
              ...base,
              message: "AI provider is temporarily unreachable — try again in a moment.",
              retryable: true,
              suggestedFix: "Check your network connection and retry.",
            });
            break;
          default:
            sse({ ...base, message: redactUserFacingText(`AI provider error: ${err.message.slice(0, 200)}`), retryable: false });
        }
      } else {
        logger.error({ err }, "chat stream: unexpected non-GroqClientError");
        sse({
          type: "error",
          code: "unknown",
          message: redactUserFacingText(err instanceof Error ? err.message : String(err)),
        });
      }
      res.end();
      return;
    }

    if (result._parseError) {
      if (!result.response) {
        sse({
          type: "error",
          code: "model_output_invalid",
          message: "The AI model returned an unexpected response — try rephrasing your message.",
          parseCode: result._parseError.code,
        });
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

    const msgNow = new Date();

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const proposalChanges = bindPendingChangesToImplementationPlan(
      bindPendingChangesToRepairPlan(
        (result.pendingChanges ?? []) as ServerPendingChange[],
        result.repairPlan,
      ),
      Boolean(approvedImplementationPlan),
    );
    const proposalId = canCreateProposal(
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
      now: msgNow,
      readFiles: collectReadEvidencePaths(traceSteps),
      executionPlan,
    });

    const aiExecutionId = aiExecution.id;
    let assistantOperationId: string | undefined = aiExecution.operationId ?? effectiveBuildPlanMessageId;
    const assistantMsg = await db.transaction(async (tx) => {
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
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: randomUUID(),
          sessionId: sessionIdToUse,
          role: "assistant",
          content: sanitizeResponseText(result.response),
          sources: JSON.stringify(redactUserFacingValue(result.sources)),
          toolTrace: serializeToolTrace(traceSteps, true, streamAuditScopeDescription),
          repairPlanMetadata: serializeRepairPlanMetadata(result.repairPlan),
          behaviorEvidence: serializeBehaviorEvidence(result.behaviorEvidence),
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
        .set({ updatedAt: msgNow, activeTaskState })
        .where(eq(aiChatSessionsTable.id, sessionIdToUse));
      return msg;
    });

    persistExecutionCheckpoint({
      stage: "finalizing",
      streamedPreview: streamedContent.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT),
      recentSteps: traceSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as unknown as Array<Record<string, unknown>>,
    });
    await checkpointChain;
    const finalValidation = [...traceSteps]
      .reverse()
      .find((step) => step.kind === "validation");
    if (finalValidation?.kind === "validation") {
      if (finalValidation.status === "passed") {
        executionEvidenceVerdict = "PARTIAL";
        executionEvidenceReason = "Validation passed, but no server-owned objective or delivery proof has been recorded.";
      } else if (finalValidation.status === "unavailable") {
        executionEvidenceVerdict = "UNAVAILABLE";
        executionEvidenceReason = finalValidation.detail ?? "Validation could not be executed.";
      } else if (finalValidation.status === "failed" || finalValidation.status === "blocked") {
        executionEvidenceVerdict = "BLOCKED";
        executionEvidenceReason = finalValidation.detail ?? "Validation ended with an unresolved failure.";
      }
    }
    if (endedBeforeEvidence) {
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: "Execution stopped before the first source read.",
        cancelled: false,
        nodeStates: executionNodeStates,
      });
    } else {
      await completeAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        finalMessageId: assistantMsg.id,
        proposalId,
        nodeStates: executionNodeStates,
        evidenceVerdict: executionEvidenceVerdict,
        evidenceReason: executionEvidenceReason,
        proofRequired,
      });
    }
    executionTerminal = true;

    // Fire-and-forget memory write — must not block the SSE done event.
    writeSessionMemories(
      sessionIdToUse,
      projectId,
      redactUserFacingValue(result.sources),
      sanitizeResponseText(result.response),
    ).catch((err) => {
      logger.warn({ err, projectId }, "memory-write: failed to persist session memories (stream)");
    });

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
        ? serializeToolTrace(traceSteps, false, streamAuditScopeDescription)
      : assistantMsg.toolTrace;
    // The database row is intentionally retained with full diagnostics, but
    // every SSE projection of that row must use the public trace.
    assistantMsg.toolTrace = publicToolTrace;
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
      // STORY-04: surface the actual model used so the UI can display it accurately
      resolvedModel: result.resolvedModel,
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
        provider,
      },
      execution: executionSummary,
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

  return res.json({
    id: execution.id,
    projectId: execution.projectId,
    sessionId: execution.sessionId,
    objective: storedRequest?.objective,
    linkedTaskId: execution.linkedTaskId,
    buildPlanMessageId: execution.buildPlanMessageId,
    status: execution.status,
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
    evidenceReason: typeof checkpointRecord.evidenceReason === "string"
      ? checkpointRecord.evidenceReason
      : undefined,
    checkpoint,
    checkpointVersion: execution.checkpointVersion,
    finalMessageId: execution.finalMessageId,
    proposalId: execution.proposalId,
    operationId,
    error: execution.error,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    resumable: execution.status === "paused" || execution.status === "failed",
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

// ── GET /api/ai/chat/:sessionId/messages ─────────────────────────────────────

router.get("/ai/chat/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;

  const sessionRows = await db
    .select()
    .from(aiChatSessionsTable)
    .where(eq(aiChatSessionsTable.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return res.json([]);

  if (session.projectId) {
    const ownerProject = await loadProjectByIdForUser(session.projectId, req.userId, res);
    if (!ownerProject) return;
  }

  const messages = await db
    .select()
    .from(aiChatMessagesTable)
    .where(eq(aiChatMessagesTable.sessionId, sessionId))
    .orderBy(aiChatMessagesTable.createdAt);

  return res.json(messages.map((message) => ({
    ...message,
    content: redactUserFacingText(message.content),
    sources: message.sources
      ? JSON.stringify(redactUserFacingValue(parseStoredJson(message.sources)))
      : message.sources,
    toolTrace: message.toolTrace
      ? redactUserFacingText(message.toolTrace)
      : message.toolTrace,
    repairPlan: redactUserFacingValue(parseRepairPlanMetadata(message.repairPlanMetadata)),
    behaviorEvidence: redactUserFacingValue(parseBehaviorEvidence(message.behaviorEvidence)),
    taskResult: redactUserFacingValue(parseTaskResult(message.taskResult)),
  })));
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
    ))
    .orderBy(desc(aiChangeProposalsTable.createdAt))
    .limit(1);
  if (!proposal) return res.json({ proposalId: null, operationId: null, changes: [] });

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
    const changes = proposal.status === "pending"
      ? JSON.parse(proposal.changes) as ServerPendingChange[]
      : [];
    return res.json({
      proposalId: proposal.status === "pending" ? proposal.id : null,
      operationId: canonicalOperationId,
      changes,
      approvalRequired: proposal.status === "pending" ? proposal.approvalRequired : false,
      revision: proposal.status === "pending" ? proposal.revision : null,
    });
  } catch {
    logger.error({ proposalId: proposal.id }, "Invalid stored AI change proposal");
    return res.status(500).json({ error: "Stored change proposal is invalid" });
  }
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
      approvedChanges = JSON.parse(proposal.changes) as ServerPendingChange[];
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
  if (!proposal) return res.status(404).json({ error: "Change proposal not found" });
  const project = await loadProjectByIdForUser(proposal.projectId, req.userId, res);
  if (!project) return;
  if (proposal.status !== "pending") {
    return res.status(409).json({ error: "Change proposal has already been consumed", code: "PROPOSAL_ALREADY_CONSUMED" });
  }
  await db
    .update(aiChangeProposalsTable)
    .set({ status: "rejected", consumedAt: new Date() })
    .where(and(
      eq(aiChangeProposalsTable.id, proposal.id),
      eq(aiChangeProposalsTable.status, "pending"),
    ));
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
      approvedChanges = JSON.parse(proposal.changes) as ServerPendingChange[];
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
    let journalSequence = 0;
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
        payload,
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
    } else {
      await appendApplyJournal("WRITING_STARTED", {
        fileCount: writableChanges.length,
        files: writableChanges.map((change) => change.path),
      });
      let writeFailure: string | undefined;
      try {
        for (const change of writableChanges) {
          attemptedChanges.push(change);
          await fs.writeFile(change.realPath, change.newContent, "utf-8");
          const persisted = await fs.readFile(change.realPath, "utf-8");
          if (persisted !== change.newContent) {
            throw new Error("Post-write persistence verification failed.");
          }
          writtenChanges.push(change);
          results.push({ path: change.path, ok: true });
        }
        await appendApplyJournal("WRITTEN", {
          files: writtenChanges.map((change) => change.path),
        });
      } catch (e) {
        writeFailure = e instanceof Error ? e.message : String(e);
        // Restore every file written in this batch and verify each snapshot.
        // A failed restore leaves the filesystem state indeterminate.
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

    const writtenResults = results.filter((result) => result.ok);
    const profiles = new Map<ValidationProfile, string[]>();
    for (const change of writableChanges) {
      if (!writtenResults.some((result) => result.path === change.path)) continue;
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
      verificationByProfile.set(profile, await runRepairValidation(resolvedRoot, profile, profilePaths));
    }

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
    const verificationNeedsReview = responseResults.some((result) =>
      result.behavioralVerification.status === "failed" ||
      result.behavioralVerification.status === "unavailable" ||
      result.behavioralVerification.status === "skipped",
    );
    if (verificationNeedsReview && responseResults.some((result) => result.ok)) {
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

    const allOk = responseResults.every((r) => r.ok) && !verificationNeedsReview;
    const rollbackFailed = rollbackFailures.length > 0;
    const applyStatus = rollbackFailed
      ? "ROLLBACK_FAILED"
      : allOk
        ? "APPLIED"
        : "BLOCKED";

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
          : appliedPaths.length > 0 && !verificationNeedsReview
            ? (failedPaths.length > 0 ? "warning" : "success")
            : "warning",
        message: appliedPaths.length > 0
          ? `AI applied ${appliedPaths.length} file change${appliedPaths.length !== 1 ? "s" : ""}: ${preview}${failedPaths.length > 0 ? ` (${failedPaths.length} failed)` : ""}${verificationNeedsReview ? " (behavioral verification needs review)" : ""}`
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
          rollbackFailures,
          behavioralVerification: responseResults.map((result) => ({
            path: result.path,
            status: result.behavioralVerification.status,
          })),
        },
      });
      if (appliedPaths.length > 0) {
        await tx
          .update(aiChangeProposalsTable)
          .set({ status: "applied", consumedAt: new Date() })
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
      rollbackFailures,
    });
  } finally {
    await applyLock.release();
  }
});

export default router;
