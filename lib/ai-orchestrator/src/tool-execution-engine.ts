/**
 * ToolExecutionEngine — self-contained agentic tool loop.
 *
 * Extracts the tool-calling machinery from chat-agent.ts so it can be tested
 * and evolved independently.
 *
 *   executeSingleTool(opts)  — dispatches one tool call by name (file-tools or
 *                              git-tools), enforces the registry.
 *   executeToolLoop(opts)    — runs the loop until a non-tool response or the
 *                              budget is exhausted.
 *
 * Budget rules: maxIterations caps model API calls; maxToolCalls caps real tool
 * executions; cache is a Map shared with speculative-prefetch — duplicate calls
 * hit the cache for free.
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { GroqClientError } from "./errors.js";
import type {
  AuditState,
  ForensicDecisionTrace,
  ForensicTerminalKind,
  VerificationTrace,
} from "./audit-telemetry.js";
import type { ProductionReachabilityTrace } from "./semantic-trace.js";
import type { CanonicalSourceCoverage, RepairBlockReason } from "./evidence-integrity.js";
import type { RawMessage, RawGroqResponse } from "./groq-client.js";
import type { ProviderStrategy } from "./provider-strategy.js";
import { createExecutionLedger, type ExecutionLedger } from "./execution-ledger.js";
import type { ModelCapability } from "./openrouter/model-catalog.js";
import { authorizeToolInvocation, type ToolDefinitionLike } from "./tool-policy.js";
import type { PendingChange } from "./schemas/chat.schema.js";
import type { TaskType } from "./quality/task-profile.js";
import { getPhaseBudget, isToolAllowedInPhase, type ExecutionPhase } from "./quality/execution-phases.js";
import {
  classifyObjectiveScopePath,
  normalizeObjectivePath,
  type ObjectiveScopePolicy,
  type ScopeExpansion,
} from "./objective-scope.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "./tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS, executeGitTool } from "./tools/git-tools.js";
import {
  EXECUTION_TOOL_DEFINITIONS,
  executeCommandTool,
  executeBrowserValidationTool,
  executeValidationTool,
  MAX_REPAIR_ATTEMPTS,
  type RepairLoopState,
  type ValidationRunner,
  type BrowserValidationRunner,
} from "./tools/execution-tools.js";
import {
  ANALYSIS_TOOL_NAMES,
  executeAnalysisTool,
  type AnalysisToolRunner,
  type AnalysisCorrelation,
} from "./tools/analysis-tools.js";
import { recordProviderTelemetry } from "./provider-registry.js";
import { recordBehavioralFailure } from "./behavioral-scorecard.js";
import { isForensicTestSourcePath } from "./forensic-source-policy.js";
import type { ForensicRootCoverage } from "./forensic-output-guard.js";
import type { ValidationResult } from "./validation-result.js";
import { formatUntrustedContent } from "./untrusted-content.js";

// ── Defaults ────────────────────────

export const DEFAULT_MAX_ITERATIONS = 128;
export const DEFAULT_MAX_TOOL_CALLS = 480;
export const DEFAULT_SEARCH_NOVELTY_BUDGET = 8;

/**
 * Per-scope iteration and tool-call budgets (dynamic, complexity-keyed).
 * Callers pass the entry for their taskProfile instead of DEFAULT_*.
 */
export const BUDGET_BY_SCOPE = {
  chat:           { maxIterations: 64, maxToolCalls: 180 },
  tool_chat:      { maxIterations: 96, maxToolCalls: 300 },
  analysis:       { maxIterations: 180, maxToolCalls: 640 },
  task_execution: { maxIterations: 192, maxToolCalls: 720 },
  code_review:    { maxIterations: 96, maxToolCalls: 300 },
  workflow:       { maxIterations: 160, maxToolCalls: 560 },
} as const satisfies Record<string, { maxIterations: number; maxToolCalls: number }>;

/**
 * Fraction of maxIterations at which a "synthesise now" hint is injected into
 * the message history.  The model is asked to stop calling tools and write a
 * final answer from what it has gathered — avoiding a hard stop with no output.
 *
 * Basis: Agent Patterns Catalog — "Soft Limit + Synthesis" pattern.
 */
const SOFT_LIMIT_RATIO = 0.75;

function syntheticValidationResult(
  profile: string,
  detail: string,
): ValidationResult {
  const evidenceId = randomUUID();
  return {
    profile,
    status: "blocked",
    scenario: "Validation was blocked before execution.",
    exitCode: null,
    command: "",
    stdout: "",
    stderr: "",
    failedTests: [],
    changedFiles: [],
    evidence: {
      evidenceId,
      observedAt: new Date().toISOString(),
      artifactRef: `validation-attempt:${evidenceId}`,
    },
    detail,
  };
}

function parseCommandStatus(
  output: string,
): "passed" | "failed" | "timed_out" | "cancelled" | "spawn_error" | undefined {
  try {
    const status = (JSON.parse(output) as { status?: unknown }).status;
    return status === "passed" || status === "failed" || status === "timed_out" ||
      status === "cancelled" || status === "spawn_error" ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * FEG-009/010: run-budget rebalancing. The single maxIterations cap is split
 * into per-category shares so a run cannot spend its whole budget planning
 * without ever acquiring source evidence. The EVIDENCE share is PROTECTED:
 * once the cumulative planning share is exhausted before the first source read,
 * the loop is forced toward a primary-evidence action instead of letting
 * planning consume the iterations reserved for source acquisition.
 */
export const BUDGET_CATEGORY_SHARES = {
  planning: 0.4,
  evidence: 0.3, // protected primary-evidence allocation
  reasoning: 0.2,
  recovery: 0.1, // reserved to force a first read on a zero-evidence run
} as const;

export type RunBudgetCategories = {
  planning: number;
  evidence: number;
  reasoning: number;
  recovery: number;
};

export function splitRunBudget(maxIterations: number): RunBudgetCategories {
  const planning = Math.max(1, Math.floor(maxIterations * BUDGET_CATEGORY_SHARES.planning));
  const evidence = Math.max(1, Math.floor(maxIterations * BUDGET_CATEGORY_SHARES.evidence));
  const reasoning = Math.max(1, Math.floor(maxIterations * BUDGET_CATEGORY_SHARES.reasoning));
  const recovery = Math.max(1, maxIterations - planning - evidence - reasoning);
  return { planning, evidence, reasoning, recovery };
}
/**
 * Prefetch first source evidence marker (incl. eager read in chat-agent).
 * Negative vs 0-based loop iterations keeps the soft limit from being
 * classified as a zero-read start failure.
 */
const PREFETCH_FIRST_READ_ITER = -1;
/**
 * Repair-plan handoffs are not open-ended loops; allow a few repeated reads
 * for provider recovery, then force a bounded decision.
 */
const REPAIR_PLAN_DUPLICATE_TOOL_LIMIT = 3;

function pendingChangesFingerprint(changes: readonly PendingChange[]): string {
  const canonicalChanges = [...changes]
    .map((change) => ({
      path: change.path.replaceAll("\\", "/"),
      newContent: change.newContent,
      originalContent: change.originalContent ?? null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(canonicalChanges)).digest("hex");
}

type RepairPatchSnapshot = Map<string, string>;

const MAX_REPAIR_ATTEMPT_DIFF_CHARS = 12_000;
const MAX_REPAIR_ATTEMPT_DIFF_LINES = 160;

function snapshotPendingChanges(changes: readonly PendingChange[]): RepairPatchSnapshot {
  return new Map(
    changes.map((change) => [
      change.path.replaceAll("\\", "/"),
      change.newContent.replace(/\r\n/g, "\n"),
    ]),
  );
}

/**
 * Produce a bounded, unified-diff-shaped view of one patch file. The diff is
 * intentionally compact: one changed region with a small amount of context is
 * more useful in the persisted Flight Recorder than replaying an entire file.
 */
function compactFileDiff(
  path: string,
  previous: string | undefined,
  current: string | undefined,
): string {
  const oldLines = (previous ?? "").split("\n");
  const newLines = (current ?? "").split("\n");
  const isAdded = previous === undefined;
  const isRemoved = current === undefined;
  const oldLabel = isAdded ? "/dev/null" : `attempt-N-1/${path}`;
  const newLabel = isRemoved ? "/dev/null" : `attempt-N/${path}`;

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = 3;
  const oldStart = Math.max(0, prefix - context);
  const newStart = Math.max(0, prefix - context);
  const oldEnd = Math.min(oldLines.length - suffix + context, oldLines.length);
  const newEnd = Math.min(newLines.length - suffix + context, newLines.length);
  const lines = [
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    `@@ -${oldStart + 1},${Math.max(0, oldEnd - oldStart)} +${newStart + 1},${Math.max(0, newEnd - newStart)} @@`,
    ...oldLines.slice(oldStart, oldEnd).map((line) => ` ${line}`),
  ];

  // Replace the old region with a proper removed/added hunk. Context before
  // and after the changed region remains in the same order as a unified diff.
  const oldChangedEnd = Math.max(oldStart, oldLines.length - suffix);
  const newChangedEnd = Math.max(newStart, newLines.length - suffix);
  const before = oldLines.slice(oldStart, prefix);
  const removed = oldLines.slice(prefix, oldChangedEnd);
  const added = newLines.slice(prefix, newChangedEnd);
  const after = oldLines.slice(oldChangedEnd, oldEnd);
  lines.splice(
    3,
    lines.length,
    ...before.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...after.map((line) => ` ${line}`),
  );

  if (lines.length > MAX_REPAIR_ATTEMPT_DIFF_LINES) {
    lines.splice(
      MAX_REPAIR_ATTEMPT_DIFF_LINES,
      lines.length,
      "... (diff truncated)",
    );
  }
  return lines.join("\n");
}

function buildRepairAttemptDiff(
  previous: RepairPatchSnapshot,
  current: RepairPatchSnapshot,
): string {
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort();
  const fileDiffs = paths
    .filter((path) => previous.get(path) !== current.get(path))
    .map((path) => compactFileDiff(path, previous.get(path), current.get(path)));
  const diff = fileDiffs.join("\n");
  return diff.length > MAX_REPAIR_ATTEMPT_DIFF_CHARS
    ? `${diff.slice(0, MAX_REPAIR_ATTEMPT_DIFF_CHARS)}\n... (diff truncated)`
    : diff;
}

// ── Registry ────────────────────────

// Built once from the authoritative definition arrays.  Any name not in one
// of these sets is an unknown tool and is rejected before touching the budget.
const GIT_TOOL_NAMES = new Set(GIT_TOOL_DEFINITIONS.map((t) => t.function.name));
const FILE_TOOL_NAMES = new Set(FILE_TOOL_DEFINITIONS.map((t) => t.function.name));
const EXECUTION_TOOL_NAMES = new Set(EXECUTION_TOOL_DEFINITIONS.map((t) => t.function.name));

function untrustedToolOutput(name: string, output: string, args: Record<string, string>): string {
  const source = GIT_TOOL_NAMES.has(name)
    ? "git" as const
    : name === "read_file" || name === "read_file_range" || name === "list_directory" || name === "search_code"
      ? "source" as const
    : name === "run_command" || name === "run_validation" || ANALYSIS_TOOL_NAMES.has(name)
      ? "provider_diagnostic" as const
      : "tool_output" as const;
  return formatUntrustedContent(output, {
    source,
    ...(typeof args.path === "string" ? { path: args.path } : {}),
  });
}

// ── Cache key ────────────────────────

/**
 * Canonical cache key for a tool call. Object keys are sorted so argument-order
 * differences produce the same key. Exported so speculative-prefetch seeds the
 * same cache without duplicating the keying logic.
 */
export function toolCacheKey(name: string, args: Record<string, string>): string {
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return `${name}:${JSON.stringify(sorted)}`;
}

type SearchMatch = { path: string; line: number };

function extractSearchMatches(text: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const seen = new Set<string>();
  const pattern =
    /(?:^|\n)\s*(?:[-*]\s*)?([^\s:[\]]+\.[A-Za-z0-9]+):(\d+)(?::|$)/g;
  for (const match of text.matchAll(pattern)) {
    const path = match[1];
    const line = Number(match[2]);
    if (!path || !Number.isInteger(line) || line < 1) continue;
    const key = `${path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ path, line });
    if (matches.length >= 8) break;
  }
  return matches;
}

function duplicateSearchGuidance(
  args: Record<string, string>,
  cached: string,
  duplicateCount: number,
): string {
  const matches = extractSearchMatches(cached);
  const explicitPath =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : matches[0]?.path;
  const matchingLine = matches.find((match) => !explicitPath || match.path === explicitPath)?.line;
  const target = explicitPath ? `\`${explicitPath}\`` : "one of the matching source files";
  const lineHint = matchingLine ? ` at the matching line ${matchingLine}` : "";
  const base =
    "DUPLICATE SEARCH: this exact search_code call already ran. " +
    `Read ${target}${lineHint} with read_file, or use a different, more targeted search instead.`;
  if (duplicateCount >= 3) {
    return (
      `${base} This is the third repeated search, so the next turn is synthesis-only. ` +
      "Do not call search_code again."
    );
  }
  if (duplicateCount >= 2) {
    return `${base} search_code is temporarily hidden for the next model turn; advance using the gathered evidence.`;
  }
  return base;
}

function duplicateSearchSynthesisSummary(
  args: Record<string, string>,
  cached: string,
  toolSources: string[],
  fileContents: Map<string, string>,
): string {
  const matches = extractSearchMatches(cached);
  const readFiles = [...fileContents.keys()].sort();
  const searchSources = [...new Set(toolSources.filter((source) => source.startsWith("search:")))].sort();
  const query = args.pattern?.trim() || args.query?.trim() || "the repeated search";
  const collected = [
    `- Completed search_code result for "${query}".`,
    searchSources.length > 0
      ? `- Completed search operations: ${searchSources.join(", ")}.`
      : "- Completed search operation recorded, but no separate search source label was available.",
    readFiles.length > 0
      ? `- Files already read: ${readFiles.join(", ")}.`
      : "- Files already read: none confirmed.",
    matches.length > 0
      ? `- Matching locations from the cached result: ${matches
          .map((match) => `${match.path}:${match.line}`)
          .join(", ")}.`
      : "- Matching source locations: none could be extracted from the cached result.",
  ];
  const uncollectedMatches = matches.filter((match) => !fileContents.has(match.path));
  const notCollected = [
    uncollectedMatches.length > 0
      ? `- Direct reads still uncollected: ${uncollectedMatches
          .map((match) => `${match.path}:${match.line}`)
          .join(", ")}.`
      : "- No uncollected matching file was inferred; distinguish search evidence from behavioral proof.",
    "- Additional search expansion was intentionally not collected because search_code is now suppressed.",
  ];

  return [
    "DUPLICATE SEARCH ESCALATION SUMMARY",
    "Collected:",
    ...collected,
    "Not collected / not proven:",
    ...notCollected,
    "Synthesis constraint: answer from this summary and the confirmed evidence only; do not call tools.",
  ].join("\n");
}

// ── Single tool execution ────────────

export type SingleToolOpts = {
  /** Registered tool name (e.g. "read_file", "git_status"). */
  name: string;
  /** Parsed arguments from the model's tool_call.function.arguments. */
  args: Record<string, string>;
  /** Absolute path to the project root — required for path containment. */
  rootPath: string;
  /** Accumulated pending changes array — mutated in place by write_file. */
  pendingChanges: PendingChange[];
  /** Force complete source reads for structured forensic audits. */
  completeReads?: boolean;
  /** Server-owned validation runner, enabled only for an approved Build handoff. */
  validationRunner?: ValidationRunner;
  /** Server-owned browser contract runner; model selects a profile only. */
  browserValidationRunner?: BrowserValidationRunner;
  browserValidationContext?: { operationId?: string; revision?: string };
  /** Server-owned command profiles and runner; no model-supplied executable is accepted. */
  commandProfiles?: readonly import("./tools/execution-tools.js").CommandProfile[];
  commandRunner?: import("./tools/execution-tools.js").CommandRunner;
  commandContext?: { operationId?: string; revision?: string; targetPaths?: readonly string[]; operation?: string };
  /** Server-owned, read-only scanner/graph/discovery dispatcher. */
  analysisToolRunner?: AnalysisToolRunner;
  analysisCorrelation?: AnalysisCorrelation;
  analysisDeadlineAt?: number;
  /** Files covered by the approved implementation plan. */
  validationTargetPaths?: string[];
  /** Fail-closed dispatcher gate for execution tools. */
  allowExecutionTools?: boolean;
  /** Server-owned approval and scope manifest; never inferred from model text. */
  approvalState?: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
  approvedFilePaths?: readonly string[];
  approvedValidationProfiles?: readonly string[];
  /** Server-owned effective tool manifest, checked again at dispatch. */
  allowedToolNames?: ReadonlySet<string>;
  /** Cancellation signal owned by the durable execution controller. */
  signal?: AbortSignal;
};

export type SingleToolResult =
  | {
      kind: "ok";
      /** Raw text output of the tool, forwarded as the tool-role message. */
      output: string;
      /**
       * Ground-truth source label, if this call reads observable state.
       * write_file produces no source — it queues a pending change instead.
       */
      source?: string;
    }
  | {
      kind: "unknown_tool";
      /** Human-readable error forwarded to the model as the tool message. */
      errorMessage: string;
    }
  | {
      kind: "failed";
      failureKind: "execution" | "unavailable" | "cancelled";
      diagnosticCode: Extract<AgentDiagnosticCode, `TOOL_${string}`>;
      analysisFailureCategory?: import("./tools/analysis-tools.js").AnalysisFailureCategory;
      /** Safe, bounded context forwarded to the model. Raw diagnostics stay in logs. */
      safeMessage: string;
    };

/**
 * Only a real, complete file response can become forensic source evidence.
 * Error strings, directory listings, synthesis hints, and bounded/truncated
 * previews must remain tool output but must not enter the evidence map.
 */
function isUsableReadOutput(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed || /^Error\b/i.test(trimmed)) return false;
  if (/^Contents of\s+/i.test(trimmed)) return false;
  if (/^Synthesis phase is active\./i.test(trimmed)) return false;
  if (/^Forensic collection stopped\./i.test(trimmed)) return false;
  if (/\[\.\.\.\s*(?:output truncated|forensic read exceeded)/i.test(trimmed)) return false;
  return true;
}

/**
 * Read status for a single source read (SR-001).
 *
 * HEADER_DELIVERED: the tool returned the usual `File: …` fenced wrapper but
 *   the body itself is not source evidence (an Error, listing, synthesis or
 *   policy string, or a truncated preview).
 * SYMBOL_WINDOW: returned via read_file_range — a targeted, bounded window.
 */
export const ReadStatusSchema = {
  values: ["READ_COMPLETE", "READ_TRUNCATED", "READ_FAILED", "READ_CACHED", "READ_TARGETED"],
} as const;
export type ReadStatus =
  | "READ_COMPLETE"
  | "READ_TRUNCATED"
  | "READ_FAILED"
  | "READ_CACHED"
  | "READ_TARGETED";

/**
 * Classify a read tool output into a status. Truncation markers and error /
 * non-source bodies are never treated as a complete source read (SR-001 gate:
 * truncated → READ_TRUNCATED, not READ_COMPLETE/READ_CONFIRMED).
 */
export function classifyReadStatus(toolName: string, output: string): ReadStatus {
  if (toolName === "read_file_range") {
    // A target window is a valid targeted read only when it actually contains
    // source content. An out-of-range request answers "No content in lines …"
    // (non-error), and a window can come back empty — neither is source
    // evidence, so neither may qualify as a successful read (SR-001 gate,
    // FEG-008 force bypass).
    const trimmed = output.trim();
    if (!trimmed || /^Error\b/i.test(trimmed)) return "READ_FAILED";
    if (/^No content in lines\b/i.test(trimmed)) return "READ_FAILED";
    if (!hasUsableSourceBody(output)) return "READ_FAILED";
    return "READ_TARGETED";
  }
  if (toolName !== "read_file") return "READ_COMPLETE";
  const trimmed = output.trim();
  if (!trimmed || /^Error\b/i.test(trimmed)) return "READ_FAILED";
  if (hasReadTruncationMarker(output)) return "READ_TRUNCATED";
  if (!isUsableReadOutput(output)) return "READ_FAILED";
  return "READ_COMPLETE";
}

/** True when a read_file body carries a truncation marker (incomplete source). */
function hasReadTruncationMarker(output: string): boolean {
  return /\[\.\.\.\s*(?:output truncated|forensic read exceeded)/i.test(output);
}

/**
 * True when a read payload actually carries source content, not just a wrapper.
 *
 * A read_file_range window is wrapped as `File: <path>\n```\n<body>\n````. The
 * underlying tool can return a non-error result whose window carries no source
 * (an out-of-range "No content in lines …" answer, or a window whose fenced
 * body is empty). `classifyReadStatus` must reject those as READ_FAILED so they
 * can never clear forced-evidence mode, reset the no-progress streak, or set
 * first-read telemetry despite carrying no evidence.
 */
function hasUsableSourceBody(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;
  // Strip a leading "File: <path>" header, then surrounding ``` fences.
  let body = trimmed.replace(/^File:[^\n]*\r?\n/, "");
  body = body.replace(/^```[ \t]*\s*\r?\n?/, "").replace(/[ \t]*```[ \t]*$/, "");
  return body.trim().length > 0;
}

export type SourceRetrievalTelemetry = {
  readAttempts: number;
  /** Distinct paths the loop actually read via read tools (recordRead). */
  readPaths: string[];
  uniqueReads: number;
  truncatedReads: number;
  targetedReads: number;
  redundantReads: number;
  cachedReads: number;
  evidenceWindows: number;
  /** FEG-015: source reads split into prefetch / targeted / dependency / duplicate buckets. */
  prefetchReads: number;
  dependencyReads: number;
  duplicateReads: number;
  /** FEG-015: true once any source evidence was acquired (first read or usable prefetch). */
  firstEvidenceAcquired: boolean;
  /** FEG-015: iteration of the first source read; null when never read; negative sentinel when prefetched. */
  iterationsUntilFirstRead: number | null;
  /** FEG-015: iterations elapsed with no source evidence. */
  iterationsWithoutEvidence: number;
  /** FEG-015: tool-calling iterations that landed no new read. */
  planningIterations: number;
  /** FEG-015: iterations that landed a new source read. */
  evidenceIterations: number;
  /** FEG-015: gather calls (search_code/list_directory) issued before the first source read. */
  crossFileQueriesBeforeFirstRead: number;
  /** FEG-015: true when usable source bodies were prefetched before the loop. */
  prefetchBeforeFirstRead: boolean;
  /**
   * FEG-007: 0-based loop iteration at which the first source read happened,
   * or null when the loop finished without ever reading a source. Null when
   * the run never started investigating.
   */
  iterationsUntilFirstSourceRead: number | null;
  /**
   * FEG-008: true when a repeated run of NO_PROGRESS planning iterations was
   * broken by forcing a primary-evidence action.
   */
  progressForced: boolean;
  /**
   * FEG-007: classified start-SLA outcome. "ok" when the first source read
   * landed inside the budget; a reason string otherwise (e.g. the soft limit
   * fired before any source read).
   */
  investigationStartSla?: "ok" | "soft_limit_with_zero_reads";
  /**
   * FEG-009/010: run-budget rebalancing. The per-category iteration allocations
   * derived from maxIterations, so callers can observe how the budget was split
   * between planning, protected evidence acquisition, and recovery.
   */
  budgetAllocation?: {
    planning: number;
    evidence: number;
    reasoning: number;
  };
  /** Synthesis-only budget and observed attempts, kept separate from reads. */
  synthesisAttempts?: number;
  synthesisMaxAttempts?: number;
  synthesisTimeoutMs?: number;
  synthesisElapsedMs?: number;
  synthesisTimedOut?: boolean;
  /**
   * FEG-009/010: true when the run ended with ZERO source reads ever acquired
   * (never read, and no usable prefetch). Such a terminal is classified
   * INCOMPLETE_BEFORE_EVIDENCE - it is NOT a normal end of a question. Downstream
   * surfaces may use this to say "investigation never reached evidence" instead
   * of presenting a bare not-proven verdict.
   */
  incompleteBeforeEvidence?: boolean;
  /** AI-OBJ-008: bounded scope changes observed while retrieving evidence. */
  scopeExpansions: ScopeExpansion[];
};

export const EMPTY_SOURCE_RETRIEVAL_TELEMETRY: SourceRetrievalTelemetry = {
  readAttempts: 0,
  readPaths: [],
  uniqueReads: 0,
  truncatedReads: 0,
  targetedReads: 0,
  redundantReads: 0,
  cachedReads: 0,
  evidenceWindows: 0,
  prefetchReads: 0,
  dependencyReads: 0,
  duplicateReads: 0,
  firstEvidenceAcquired: false,
  iterationsUntilFirstRead: null,
  iterationsWithoutEvidence: 0,
  planningIterations: 0,
  evidenceIterations: 0,
  crossFileQueriesBeforeFirstRead: 0,
  prefetchBeforeFirstRead: false,
  iterationsUntilFirstSourceRead: null,
  progressForced: false,
  scopeExpansions: [],
};

/** Final reporting is a bounded phase, not another open-ended tool-loop turn. */
export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 30_000;
export const DEFAULT_SYNTHESIS_MAX_ATTEMPTS = 2;

/**
 * Fresh per-loop telemetry. `readPaths` is mutable and MUST be a newly
 * allocated array on every loop — never shared from `EMPTY_SOURCE_RETRIEVAL_TELEMETRY`,
 * whose spread copies only the array reference. A shared array would leak one
 * request's read paths into subsequent runs and corrupt prefetch/loop dedupe.
 */
export function createSourceRetrievalTelemetry(): SourceRetrievalTelemetry {
  return { ...EMPTY_SOURCE_RETRIEVAL_TELEMETRY, readPaths: [], scopeExpansions: [] };
}

/**
 * Execute a single tool call by name.
 *
 * Routing:
 *   - Names in GIT_TOOL_NAMES   → executeGitTool
 *   - Names in FILE_TOOL_NAMES  → executeFileTool
 *   - Anything else             → unknown_tool (not thrown)
 *
 * Source labels are produced for read operations only (read_file,
 * list_directory, search_code, git_status, git_diff, git_log).
 * write_file never produces a source — it mutates pendingChanges instead.
 */
export async function executeSingleTool(opts: SingleToolOpts): Promise<SingleToolResult> {
  const { name, args, rootPath, pendingChanges } = opts;
  const effectiveArgs =
    opts.completeReads && name === "read_file"
      ? { ...args, complete: "true" }
      : args;

  const isGitTool = GIT_TOOL_NAMES.has(name);
  const isFileTool = FILE_TOOL_NAMES.has(name);
  const isExecutionTool = EXECUTION_TOOL_NAMES.has(name);
  const isAnalysisTool = ANALYSIS_TOOL_NAMES.has(name);

  if (!isGitTool && !isFileTool && !isExecutionTool && !isAnalysisTool) {
    return {
      kind: "unknown_tool",
      errorMessage: `Tool "${name}" is not registered — use one of the tools listed in the system prompt.`,
    };
  }

  try {
    if (isExecutionTool && !opts.allowExecutionTools) {
      return {
        kind: "failed",
        failureKind: "unavailable",
        diagnosticCode: "TOOL_UNAVAILABLE",
        safeMessage: `Tool "${name}" is unavailable in this agent mode; the operation did not complete.`,
      };
    }
    const authorization = authorizeToolInvocation({
      toolName: name,
      args,
      approvalState: opts.approvalState,
      ...(opts.approvedFilePaths ? { approvedFilePaths: opts.approvedFilePaths } : {}),
      ...(opts.approvedValidationProfiles ? { approvedValidationProfiles: opts.approvedValidationProfiles } : {}),
      ...(opts.allowedToolNames ? { allowedTools: opts.allowedToolNames } : {}),
    });
    if (!authorization.allowed) {
      return {
        kind: "failed",
        failureKind: "unavailable",
        diagnosticCode: "TOOL_UNAVAILABLE",
        safeMessage: `Tool "${name}" was blocked by the server authorization gate (${authorization.reason}).`,
      };
    }
    if (isAnalysisTool && !opts.analysisToolRunner) {
      return {
        kind: "failed",
        failureKind: "unavailable",
        diagnosticCode: "TOOL_UNAVAILABLE",
        safeMessage: `Tool "${name}" is unavailable for this turn; the operation did not complete.`,
      };
    }
    let analysisStatus: "complete" | "unavailable" | "failed" | undefined;
    let analysisFailure:
      | {
          failureKind: "execution" | "unavailable" | "cancelled";
          analysisFailureCategory?: import("./tools/analysis-tools.js").AnalysisFailureCategory;
          diagnosticCode: Extract<AgentDiagnosticCode, `TOOL_${string}`>;
          safeMessage: string;
        }
      | undefined;
    const validationEvidenceContext = opts.analysisCorrelation?.operationId
      || opts.analysisCorrelation?.projectRevision
      ? {
          operationId: opts.analysisCorrelation.operationId,
          projectRevision: opts.analysisCorrelation.projectRevision,
        }
      : undefined;
    const output = await (isGitTool
      ? await executeGitTool(name, effectiveArgs, rootPath)
      : isFileTool
        ? await executeFileTool(name, effectiveArgs, rootPath, pendingChanges)
        : name === "run_validation"
        ? await executeValidationTool(
            name,
            effectiveArgs,
            opts.validationTargetPaths ?? [],
            opts.validationRunner,
            opts.signal,
            pendingChanges,
            validationEvidenceContext,
          )
        : name === "run_command"
          ? await executeCommandTool(
              name,
              effectiveArgs,
              rootPath,
              opts.commandProfiles,
              opts.commandRunner,
              opts.signal,
              opts.commandContext,
            )
        : isAnalysisTool
          ? executeAnalysisTool(
            name,
            effectiveArgs,
            opts.analysisToolRunner,
            opts.signal,
            // This is deliberately the same request-owned envelope on every
            // provider retry/resume; the analysis tool validates it before
            // accepting evidence.
            opts.analysisCorrelation,
            opts.analysisDeadlineAt,
          )
            .then((result) => {
              analysisStatus = result.status;
              if (result.status === "complete") return result.output;
              const failureKind = opts.signal?.aborted
                ? "cancelled"
                : result.status === "unavailable"
                  ? "unavailable"
                  : "execution";
              const diagnosticCode = failureKind === "cancelled"
                ? "TOOL_CANCELLED"
                : result.status === "unavailable"
                  ? "TOOL_UNAVAILABLE"
                  : "TOOL_EXECUTION_FAILED";
              analysisFailure = {
                failureKind,
                diagnosticCode,
                safeMessage: result.output,
                analysisFailureCategory: result.failureCategory,
              };
              return result.output;
            })
          : executeBrowserValidationTool(
              name,
              effectiveArgs,
              rootPath,
              opts.browserValidationRunner,
              opts.signal,
              opts.browserValidationContext,
              pendingChanges,
            ));

    if (analysisFailure) {
      console.error(JSON.stringify({
        scope: "tool-execution-engine",
        code: analysisFailure.diagnosticCode,
        tool: name,
        failureKind: analysisFailure.failureKind,
      }));
      return {
        kind: "failed",
        ...analysisFailure,
      };
    }

    // Ground-truth source label for observable reads.
    let source: string | undefined;
    switch (name) {
      case "read_file":
      case "read_file_range":
        if (effectiveArgs.path) source = effectiveArgs.path;
        break;
      case "list_directory":
        source = `directory: ${effectiveArgs.path ?? "."}`;
        break;
      case "search_code":
        if (effectiveArgs.pattern) source = `search: ${effectiveArgs.pattern}`;
        break;
      case "git_status":
        source = "git:status";
        break;
      case "git_diff":
        source = effectiveArgs.path ? `git:diff:${effectiveArgs.path}` : "git:diff";
        break;
      case "git_log":
        source = "git:log";
        break;
      default:
        if (isAnalysisTool && analysisStatus === "complete") source = `analysis:${name}`;
    }

    return { kind: "ok", output, source };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cancelled = opts.signal?.aborted === true;
    console.error(JSON.stringify({
      scope: "tool-execution-engine",
      code: cancelled ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED",
      tool: name,
      error: errorMessage,
    }));
    return {
      kind: "failed",
      failureKind: cancelled ? "cancelled" : "execution",
      diagnosticCode: cancelled ? "TOOL_CANCELLED" : "TOOL_EXECUTION_FAILED",
      safeMessage: cancelled
        ? `Tool "${name}" was cancelled; the operation did not complete.`
        : `Tool "${name}" failed; the operation did not complete. Do not claim that it completed.`,
    };
  }
}

// ── Message sanitisation ─────────────

/**
 * Strip orphaned tool-result messages before sending to the model.
 *
 * Some providers (notably Cohere via OpenRouter) require every `tool` message
 * to reference a `tool_call_id` in the IMMEDIATELY PRECEDING assistant
 * `tool_calls` array. When the provider truncates the context server-side it
 * can drop that assistant turn but keep the `tool` result — a 400 trigger.
 * This walks the messages sequentially and drops any `tool` message whose ID
 * is absent from the most recent assistant turn's IDs.
 *
 * @internal - exported for unit tests only (_stripOrphanedToolMessages)
 */
function stripOrphanedToolMessages(messages: RawMessage[]): RawMessage[] {
  const result: RawMessage[] = [];
  let orphansRemoved = 0;

  // IDs advertised by the most recent assistant turn that carried tool_calls.
  // Resets on every assistant or non-tool message so non-adjacent tool results
  // are treated as orphans even when their ID appears elsewhere in history.
  let currentAssistantIds = new Set<string>();

  for (const m of messages) {
    if (m.role === "assistant") {
      // Refresh the set from this assistant turn's tool_calls.
      currentAssistantIds = new Set<string>();
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          if (tc.id) currentAssistantIds.add(tc.id);
        }
      }
      result.push(m);
    } else if (m.role === "tool") {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (id && !currentAssistantIds.has(id)) {
        orphansRemoved++;
        continue; // drop — no matching tool_call in the preceding assistant turn
      }
      result.push(m);
    } else {
      // user / system — any tool messages after this can't belong to the
      // previous assistant turn.
      currentAssistantIds = new Set<string>();
      result.push(m);
    }
  }

  if (orphansRemoved > 0) {
    console.warn(
      JSON.stringify({
        scope: "tool-execution-engine",
        code: "ORPHANED_TOOL_MESSAGES_STRIPPED",
        count: orphansRemoved,
      }),
    );
  }

  return result;
}

/**
 * @internal — exported for unit tests only.
 * Do not import this from application code.
 */
export const _stripOrphanedToolMessages = stripOrphanedToolMessages;

/**
 * Keep the forensic source bodies private and complete for the evidence gate,
 * but send bounded excerpts to model calls. Tool messages can otherwise grow
 * into a 100k+ token prompt after a broad read pass, causing the provider to
 * return EMPTY_RESPONSE or spend its output budget on a malformed retry.
 *
 * This only transforms the outbound copy. `messages` remains untouched so
 * collectForensicEvidence() can still validate Findings against the complete
 * read bodies.
 */
const SYNTHESIS_TOOL_EXCERPT_CHARS = 2_400;
const SYNTHESIS_TOOL_CONTEXT_CHARS = 42_000;
const SYNTHESIS_OMITTED_TOOL_TEXT =
  "[bounded synthesis excerpt omitted; the complete source read remains available to the server evidence gate]";

function boundSynthesisToolText(content: string, remaining: number): string {
  if (content.length <= remaining) return content;
  if (remaining <= SYNTHESIS_OMITTED_TOOL_TEXT.length) return SYNTHESIS_OMITTED_TOOL_TEXT;

  const available = remaining - SYNTHESIS_OMITTED_TOOL_TEXT.length - 20;
  const headLength = Math.ceil(available * 0.7);
  const tailLength = Math.max(0, available - headLength);
  return (
    content.slice(0, headLength) +
    `\n\n${SYNTHESIS_OMITTED_TOOL_TEXT}\n\n` +
    content.slice(-tailLength)
  );
}

function compactModelMessages(messages: RawMessage[]): RawMessage[] {
  let remaining = SYNTHESIS_TOOL_CONTEXT_CHARS;
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    const bounded = boundSynthesisToolText(
      String(message.content ?? ""),
      Math.min(SYNTHESIS_TOOL_EXCERPT_CHARS, remaining),
    );
    remaining = Math.max(0, remaining - bounded.length);
    return { ...message, content: bounded };
  });
}

/** @internal — exported for bounded-context regression tests only. */
export const _compactSynthesisMessages = compactModelMessages;
export const _compactModelMessages = compactModelMessages;

// ── Tool loop ─────────────────────────

export type AgentLoopPhase = "planning" | "evidence" | "reasoning" | "recovery" | "terminal";

/**
 * Server-owned objective input for callers that need the tool loop itself to
 * enforce completion. Evidence paths are deliberately explicit; model prose
 * can never close a claim.
 */
export type AgentLoopObjective = {
  goal: string;
  requiredEvidencePaths?: string[];
  requiredClaims: Array<{
    claimId: string;
    requiredEvidencePaths?: string[];
  }>;
};

export type AgentLoopClaimState = {
  claimId: string;
  status: "PENDING" | "PROVEN" | "BLOCKED";
  evidenceRefs: string[];
};

export type AgentLoopState = {
  goal?: string;
  phase: AgentLoopPhase;
  iterations: number;
  progress: {
    uniqueSourceReads: number;
    toolCalls: number;
    noProgressStreak: number;
  };
  claims: AgentLoopClaimState[];
  missingEvidencePaths: string[];
  terminalReason?:
    | "goal_met"
    | "claim_unclosed"
    | "evidence_incomplete"
    | "no_progress"
    | "validation_incomplete"
    | "cancelled";
};

export type ToolLoopOpts = {
  /**
   * Conversation messages — mutated in place.
   * The loop appends assistant (with tool_calls) and tool-result messages.
   * The caller owns the initial system + user messages.
   */
  messages: RawMessage[];

  /** Provider strategy used for model API calls. */
  strategy: ProviderStrategy;

  /**
   * Model identifier used for tool-calling iterations.
   * When the strategy returns a transient error, the loop may retry with
   * powerModel before propagating the error.
   */
  model: string;

  /** More capable fallback model used on transient errors from model. */
  powerModel: string;

  /** Provider name used only for structured log attribution. */
  provider: string;

  /** Optional per-user API key forwarded to every strategy.call(). */
  apiKey?: string;

  /** Capability contract for every model call in this loop. */
  capability?: ModelCapability;

  /** Task profile used for behavioral model routing. */
  taskType?: TaskType;

  /**
   * Whether a zero-read terminal is an evidence failure. Ordinary chat,
   * project questions, and delivery turns may complete without forensic
   * evidence and must not emit INCOMPLETE_BEFORE_EVIDENCE diagnostics.
   */
  requiresEvidence?: boolean;

  /**
   * Independent novelty budget for ordinary search_code calls. A search
   * consumes one unit; a previously unseen result hash refills the budget.
   */
  searchNoveltyBudget?: number;

  /**
   * Stop at the soft limit and let the caller build a deterministic execution
   * report. Forensic audits and ordinary tool-assisted chat keep their existing
   * model synthesis behaviour.
   */
  deterministicTaskExecution?: boolean;

  /** Optional provider-level tool selection policy for the first/each call. */
  toolChoice?: "auto" | "required";

  /**
   * Optional response envelope requested for the final no-tools synthesis call.
   * OpenAI-compatible clients ignore this while tools are present and apply it
   * once the forensic loop enters its synthesis window.
   */
  responseFormat?: { type: "json_object" };

  /**
   * Tool definitions passed to the model.  undefined means tools are
   * disabled for this provider/mode and the loop will return on the very
   * first iteration (the model never emits tool_calls without definitions).
   */
  tools: ToolDefinitionLike[] | undefined;

  /**
   * Absolute path to the project root.  Required for executeSingleTool but
   * never touched when tools is undefined.  Pass "" when rootPath is absent.
   */
  rootPath: string;

  /** Accumulated pending changes — mutated in place by write_file calls. */
  pendingChanges: PendingChange[];
  /** Server-owned phase; caps budgets and filters tools when provided. */
  phase?: ExecutionPhase;
  /**
   * Optional server-owned completion contract. When present, a text response
   * is only successful after its required evidence/claims are complete.
   */
  objective?: AgentLoopObjective;
  /** Previously server-verified claim state, restored on resumable execution. */
  claimState?: AgentLoopClaimState[];

  /**
   * Structured forensic mode: every uncached read_file call requests the
   * complete evidence window instead of the normal bounded preview.
   */
  completeReads?: boolean;

  /**
   * Deduplication cache — keyed by toolCacheKey().
   *
   * Pass the same Map instance seeded by speculativePrefetch so pre-fetched
   * files are never re-read.  When omitted a fresh empty Map is used.
   */
  cache?: Map<string, string>;

  /** Complete source bodies loaded by forensic prefetch before the loop. */
  initialFileContents?: Map<string, string>;

  /**
   * Optional per-request evidence handoff shared by provider retries. Only
   * successful read bodies are copied here; it never contains provider or
   * session metadata.
   */
  retainedFileContents?: Map<string, string>;

  /** Maximum number of model API calls (default: DEFAULT_MAX_ITERATIONS = 96). */
  maxIterations?: number;

  /** Maximum real (non-cached) tool executions (default: DEFAULT_MAX_TOOL_CALLS = 360). */
  maxToolCalls?: number;

  /**
   * Optional final synthesis window. Starting at this zero-based iteration,
   * no tools are executed and the provider is asked to finish from gathered
   * evidence. This prevents a large analysis from consuming its entire budget
   * on reads and then ending without a report.
   */
  toolCallsDisabledAfter?: number;

  /**
   * Independent final-report budget. Both the primary and its intentional
   * fallback share this deadline; neither may start a fresh full timeout.
   */
  synthesisTimeoutMs?: number;
  synthesisMaxAttempts?: number;

  /**
   * Narrow execution mode for a recovered Repair Plan. It keeps the normal
   * cache behaviour, but adds a deterministic guard against a model repeatedly
   * reading the same file without reaching replace_text/write_file.
   */
  executionMode?: "repair_plan" | "forensic";

  /**
   * A compound request has already acquired its first source evidence and must
   * advance to a pending edit proposal. This is distinct from a recovered
   * Repair Plan: the user supplied the read → proposal sequence directly, so
   * no prior plan metadata is required.
   */
  compoundWriteMode?: boolean;

  /** Enables the server-owned validation tool for an approved Build handoff. */
  allowExecutionTools?: boolean;

  /** Server-owned callback used by run_validation. */
  validationRunner?: ValidationRunner;
  browserValidationRunner?: BrowserValidationRunner;
  browserValidationContext?: { operationId?: string; revision?: string };
  commandProfiles?: readonly import("./tools/execution-tools.js").CommandProfile[];
  commandRunner?: import("./tools/execution-tools.js").CommandRunner;
  commandContext?: { operationId?: string; revision?: string; targetPaths?: readonly string[]; operation?: string };
  analysisToolRunner?: AnalysisToolRunner;
  analysisCorrelation?: AnalysisCorrelation;

  /** Files covered by the approved implementation plan. */
  validationTargetPaths?: string[];
  /**
   * Maximum number of fresh validation executions in one Build handoff.
   * Re-running the same profile after a pending patch is intentional and must
   * not be swallowed by the normal duplicate-call cache.
   */
  maxValidationAttempts?: number;
  /** Cancellation signal owned by the durable execution controller. */
  signal?: AbortSignal;

  /**
   * Source files named by the recovered Repair Plan. When all of these files
   * are already present in the shared read cache, read_file is removed from
   * the provider tool list so the model must advance to an edit tool.
   */
  executionTargetPaths?: string[];

  /**
   * Optional executable allow-list applied again inside the dispatcher.
   * Tool definitions are only an advisory model boundary; this list is the
   * fail-closed enforcement boundary for isolated capability tests.
   */
  allowedToolNames?: string[];
  /** Server-owned approval/scope manifest, never inferred from repository text. */
  approvalState?: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
  approvedFilePaths?: readonly string[];
  approvedValidationProfiles?: readonly string[];

  /**
   * Dependency-First traversal (FEG-005/006). When enabled, once the first
   * source read has landed the loop refuses to read a NEW dependency file
   * unless the call carries dependency-proof args (from_file / from_symbol /
   * reference / why_required). The FIRST read is never gated — only each
   * subsequent read of a file not yet read this run. Unproven dependency reads
   * are blocked with READ_BLOCKED_NO_DEPENDENCY_PROOF and surfaced to the model
   * instead of being executed.
   */
  requireDependencyProof?: boolean;

  /**
   * Optional read_file path allow-list. Paths are compared as normalized
   * project-relative paths.
   */
  allowedReadPaths?: string[];

  /**
   * AI-OBJ-008: objective-specific evidence scope. Primary paths are ordinary
   * reads; allowed expansion paths are recorded as justified; all other paths
   * are blocked as unjustified scope expansion.
   */
  objectiveScopePolicy?: ObjectiveScopePolicy;

  /**
   * First-Evidence Gate: the explicit primary evidence target. When set this
   * path is always readable as the FIRST source read — no dependency-proof or
   * allow-list prerequisite is needed — and is folded into the allowed-read
   * policy so the gate demonstrably expands tool permission.
   */
  firstEvidenceTargetPath?: string;
  /**
   * Ordered forensic source roots. Only read_file/list_directory calls inside
   * these roots are allowed, and the loop may not move back to an earlier root
   * after it has started a later one.
   */
  orderedForensicRoots?: string[];
  /**
   * Production forensic audits reject reads from tests/specs/fixtures. A
   * capability test may explicitly opt in.
   */
  allowTestSources?: boolean;

  /**
   * OR-003: Max tokens per model call.
   * When omitted the engine picks a conservative provider-aware default:
   *   openrouter → 2 048  (free-tier output caps)
   *   all others → 4 096
   */
  maxTokens?: number;

  /**
   * Optional observer called at each significant step in the loop:
   * iteration start, model call, each tool call/result, soft limit, and done.
   * Never throws — errors inside onStep are silently swallowed so a buggy
   * callback cannot break the agentic loop.
   */
  onStep?: (step: AgentStep) => void;

  /** Request-owned budget shared across every orchestration phase. */
  executionLedger?: ExecutionLedger;
};

export type ToolLoopResult =
  | {
      kind: "response";
      /** Raw model response — contains content but no tool_calls. */
      result: RawGroqResponse;
      /** Ground-truth file/search/git accesses accumulated during the loop. */
      toolSources: string[];
      /** Completed read_file bodies keyed by project-relative path. */
      fileContents?: Map<string, string>;
      /** Source-retrieval read classification and telemetry (SR-008). */
      sourceRetrieval?: SourceRetrievalTelemetry;
       objectiveState?: AgentLoopState;
    }
  | {
      /**
       * Soft-limit hit: the iteration budget ran out but the model produced at
       * least one text response during the loop.  The last such response is
       * returned here so the caller can surface a useful (if partial) answer
       * rather than a generic error message.
       */
      kind: "partial";
      result: RawGroqResponse;
      toolSources: string[];
      /** Completed read_file bodies keyed by project-relative path. */
      fileContents?: Map<string, string>;
      /** Source-retrieval read classification and telemetry (SR-008). */
      sourceRetrieval?: SourceRetrievalTelemetry;
      reason?: "soft_limit" | "empty_response" | "provider_timeout";
       objectiveState?: AgentLoopState;
    }
  | {
      kind: "exhausted";
      /** Ground-truth accesses accumulated before exhaustion. */
      toolSources: string[];
      /** Completed read_file bodies keyed by project-relative path. */
      fileContents?: Map<string, string>;
      /** Source-retrieval read classification and telemetry (SR-008). */
      sourceRetrieval?: SourceRetrievalTelemetry;
      /** Why the loop could not produce a final response. */
      reason?: "iteration_budget" | "empty_response";
       objectiveState?: AgentLoopState;
    }
  | {
      /** A required tool failed; no completed operation may be claimed. */
      kind: "failed";
      toolSources: string[];
      fileContents?: Map<string, string>;
      sourceRetrieval?: SourceRetrievalTelemetry;
      tool: string;
      failureKind: "execution" | "unavailable" | "cancelled";
      diagnosticCode: Extract<AgentDiagnosticCode, `TOOL_${string}`>;
       analysisFailureCategory?: import("./tools/analysis-tools.js").AnalysisFailureCategory;
       objectiveState?: AgentLoopState;
    }
  | {
      /**
       * Deterministic safety stop after a repeated tool-call loop. The caller
       * must surface this reason instead of describing the run as successful.
       */
      kind: "stopped";
      toolSources: string[];
      /** Completed read_file bodies keyed by project-relative path. */
      fileContents?: Map<string, string>;
      /** Source-retrieval read classification and telemetry (SR-008). */
      sourceRetrieval?: SourceRetrievalTelemetry;
      reason: "repeated_tool_call";
      tool: string;
      iterations: number;
       objectiveState?: AgentLoopState;
    }
  | {
      /** Cancellation preserves evidence but never represents a completed audit. */
      kind: "cancelled";
      toolSources: string[];
      fileContents?: Map<string, string>;
      sourceRetrieval?: SourceRetrievalTelemetry;
       objectiveState?: AgentLoopState;
     }
  | {
      /**
       * The loop stopped with useful state but the server-owned objective could
       * not be closed. This is intentionally distinct from provider failure,
       * cancellation, and ordinary budget exhaustion.
       */
      kind: "incomplete";
      reason: "claim_unclosed" | "evidence_incomplete" | "no_progress" | "validation_incomplete";
      result?: RawGroqResponse;
      toolSources: string[];
      fileContents?: Map<string, string>;
      sourceRetrieval?: SourceRetrievalTelemetry;
      objectiveState?: AgentLoopState;
    };

// ── Agent step events ──────────────────

/** Bounded diagnostics that may be persisted in the execution trace. */
export type AgentDiagnosticCode =
  | "CAPABILITY_PROBE_SYNTHESIS_TIMEOUT"
  | "CAPABILITY_PROBE_EVIDENCE_RECOVERED"
  | "CAPABILITY_PROBE_EVIDENCE_RECOVERY_REJECTED"
  | "CAPABILITY_PROBE_EVIDENCE_RECOVERY_PARSE_FAILED"
  | "CAPABILITY_PROBE_EVIDENCE_RECOVERY_FAILED"
  | "CAPABILITY_PROBE_CLAIM_UNCLOSED"
  | "CAPABILITY_PROBE_RECOVERY_SKIPPED_INCOMPLETE"
  | "FORENSIC_CONTRACT_RECOVERY_REJECTED"
  | "FORENSIC_CONTRACT_RECOVERY_PARSE_FAILED"
  | "FORENSIC_CONTRACT_RECOVERY_FAILED"
  | "FORENSIC_CONTRACT_RECOVERY_SKIPPED_NO_EVIDENCE"
  | "FORENSIC_EVIDENCE_ONLY_FALLBACK"
  | "FORENSIC_PARTIAL_SCOPE_FINDING"
  | "FORENSIC_STRUCTURED_RECOVERY_ACCEPTED"
  | "FORENSIC_STRUCTURED_RECOVERY_REJECTED"
  | "FORENSIC_TARGETED_READ_ISSUED"
  | "FORENSIC_STRUCTURED_RECOVERY_PARSE_FAILED"
  | "FORENSIC_STRUCTURED_RECOVERY_NO_FINDING"
  | "FORENSIC_POSITIVE_CLAIM_WITHOUT_EVIDENCE"
  | "FORENSIC_DETERMINISTIC_FINDING"
  | "FORENSIC_DETERMINISTIC_NO_FINDING"
  | "FORENSIC_NO_FINDING"
  | "FORENSIC_REPORT_FALLBACK_EMITTED"
  | "EXECUTION_RESPONSE_FORMAT_INVALID"
  | "EXECUTION_JSON_CORRECTION_FAILED"
  | "EXECUTION_JSON_CORRECTION_RETRY_FAILED"
  | "EXECUTION_PROVIDER_FAILURE"
  | "EXECUTION_DETERMINISTIC_PARTIAL_REPORT"
  | "EXECUTION_NO_EDIT_TOOL"
  | "EXECUTION_NODE_TRANSITION_BLOCKED"
  | "EXECUTION_SCOPE_VIOLATION"
  | "EXECUTION_PHASE_TOOL_REJECTED"
  | "EXECUTION_BEHAVIORAL_PROOF_FAILED"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_UNAVAILABLE"
  | "TOOL_CANCELLED"
  // First-Evidence Gate: the explicit primary evidence target is read directly
  // before any graph/prefetch work.
  | "FIRST_EVIDENCE_READ_ALLOWED"
  // RECOVERY_MODE = FIRST_EVIDENCE: a run that ended with ZERO source reads (and
  // so was classified INCOMPLETE_BEFORE_EVIDENCE) is recovered by reading its
  // single primary evidence target directly — never a repo/graph scan or broad
  // prefetch. FIRST_EVIDENCE_RECOVERED fires when that focused read lands;
  // FIRST_EVIDENCE_UNAVAILABLE replaces the generic "recovery skipped" outcome
  // when the primary-target read fails again, carrying the true reason.
  | "FIRST_EVIDENCE_RECOVERED"
  | "FIRST_EVIDENCE_UNAVAILABLE"
  // Investigation Start SLA (FEG-007): the soft limit fired before the first
  // source read was ever issued, so the run never started investigating.
  | "INCOMPLETE_BEFORE_EVIDENCE"
  | "INVESTIGATION_START_FAILURE"
  // Progress enforcement (FEG-008): several consecutive planning iterations
  // produced no NEW_SOURCE_READ / NEW_SYMBOL / NEW_DEPENDENCY / CLAIM_CLOSED,
  // so the loop is forced toward the primary evidence target instead of
  // continuing to plan.
  | "FORCE_PRIMARY_EVIDENCE_ACTION"
  // Budget rebalancing (FEG-009/010): the run ended with ZERO source reads ever
  // acquired. This is classified as incomplete-before-evidence - it is NOT a
  // normal terminal - and, within the recovery allocation, the loop forces a
  // first source read instead of silently letting the question end unread.
  | "INCOMPLETE_BEFORE_EVIDENCE"
  // Dependency-First traversal (FEG-005/006): after the first source read has
  // landed, a subsequent read of a NEW dependency file must carry proof of why
  // it is required; an unproven dependency read is blocked, not executed.
  | "READ_BLOCKED_NO_DEPENDENCY_PROOF"
  // Required-Claim closure (FEG-011/012): the run retained source evidence but
  // closed no claim with it. An evidence inventory alone is never a completed
  // answer, so this is reported instead of finalizing the verdict.
  | "EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED"
  | "OBJECTIVE_DECOMPOSED"
  | "OBJECTIVE_BLOCKED"
  | "JUSTIFIED_SCOPE_EXPANSION"
   | "UNJUSTIFIED_SCOPE_EXPANSION"
   | "READ_EVIDENCE_LINKED"
   | "REPAIR_ATTEMPT_DIFF";

/**
 * Discriminated union of observable events emitted during executeToolLoop.
 * Callers supply an onStep callback to receive these in real time — useful
 * for streaming live tool-call progress to the UI without polling.
 */
export type AgentStep =
  | {
      kind: "plan_activity";
      stage: "understand" | "scope" | "plan" | "execute" | "validate";
      status: "active" | "done" | "info";
      stepTitle?: string;
      action?: "inspect" | "create" | "modify" | "delete" | "test" | "configure";
      files?: string[];
      resultSummary?: string;
      nextStepTitle?: string;
      approvalRequired?: boolean;
      approvalReason?: string;
    }
  | { kind: "iteration_start"; iter: number; maxIterations: number }
  | { kind: "model_call";      model: string; provider: string }
  | { kind: "recovery_model_call"; model: string; provider: string; attempt: number }
  | {
      kind: "tool_call";
      tool: string;
      args: Record<string, string>;
      cached: boolean;
      /** True when the read happened during forensic prefetch, before the loop. */
      prefetched?: boolean;
      /**
       * The agent's immediate reasoning for why it called this tool: the model's
       * text output that immediately preceded the tool call in this iteration.
       * Present only on fresh (non-cached) calls for read and write tools.
       * Absent for cached cache-hit replays (no new model decision was made).
       * Truncated to 500 characters so the persisted trace stays bounded.
       */
      reasoning?: string;
    }
  | {
      kind: "tool_result";
      tool: string;
      source?: string;
      cached: boolean;
      outputLength: number;
       resultKind?: "ok" | "failed" | "unavailable" | "cancelled";
       diagnosticCode?: Extract<AgentDiagnosticCode, `TOOL_${string}`>;
       analysisFailureCategory?: import("./tools/analysis-tools.js").AnalysisFailureCategory;
      /** Server-owned command status, when the tool is run_command. */
      commandStatus?: "passed" | "failed" | "timed_out" | "cancelled" | "spawn_error";
      /** Bounded, content-free summary safe for activity timelines. */
      resultSummary?: string;
      /** True when the read happened during forensic prefetch, before the loop. */
      prefetched?: boolean;
    }
  | {
      kind: "validation";
      result: ValidationResult;
      repairState: RepairLoopState;
      attempt: number;
      maxAttempts: number;
      /** @deprecated Read `result`; retained only for old trace consumers. */
      status?: ValidationResult["status"];
      /** @deprecated Read `result`; retained only for old trace consumers. */
      profile?: string;
      /** @deprecated Read `result`; retained only for old trace consumers. */
      scenario?: string;
      /** @deprecated Read `result`; retained only for old trace consumers. */
      command?: string;
      /** @deprecated Read `result`; retained only for old trace consumers. */
      exitCode?: number | null;
      /** @deprecated Read `result`; retained only for old trace consumers. */
      failedTests?: string[];
      /** @deprecated Read `result.changedFiles`; retained for old trace consumers. */
      affectedFiles?: string[];
      /** @deprecated Read `result.failedTests`; retained for old trace consumers. */
      failedTestDetails?: ValidationResult["failedTests"];
      /** @deprecated Read `result.changedFiles`; retained for old trace consumers. */
      changedFiles?: string[];
      /** @deprecated Read `result`; retained only for old trace consumers. */
      detail?: string;
    }
  | {
      kind: "repair_state";
      state: RepairLoopState;
      detail?: string;
    }
  | { kind: "soft_limit";      iter: number }
  | { kind: "synthesis_start"; iter: number; maxIterations: number }
  | { kind: "forensic_recovery_start"; attempt: number }
  | {
      kind: "forensic_status";
      /** Structured audit scope: FIXTURE_LOCAL when all impl evidence is from test/spec paths. */
      auditScope: "PRODUCTION" | "FIXTURE_LOCAL";
      /** Whether the Finding was proven from production (non-fixture) source paths. */
      productionReachability: "PROVEN" | "NOT_PROVEN";
      sourceCoverage: "COMPLETE" | "PARTIAL" | "NONE";
      behavioralAssessment: "COMPLETE" | "INCOMPLETE" | "NOT_STARTED";
      findingStatus: "PROVEN" | "NO_FINDING" | "NOT_PROVEN";
      repairReadiness: "READY" | "BLOCKED";
      /**
       * EI-036: reason from scopedRepairGate when repair is blocked by proof
       * scope (e.g. REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION). Absent when allowed.
       */
      repairBlockReason?: RepairBlockReason;
      implementationFiles: number;
      contextFiles: number;
      generatedFiles: number;
      /** Explicit file manifest retained in request order for scoped audits. */
      requestedFiles?: string[];
      rootCoverage?: ForensicRootCoverage[];
      reason?: string;
      /** Bounded server-owned telemetry for forensic terminal reconciliation. */
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
      /**
       * True when the proven Finding is supported only by evidence from
       * fixture/test/spec paths — not from production source files.
       * Mirrors auditScope === "FIXTURE_LOCAL"; kept for backward compatibility.
       */
      isFixtureLocal?: boolean;
    }
  | { kind: "audit_state"; state: AuditState }
  | { kind: "forensic_terminal"; terminalKind: ForensicTerminalKind }
  | { kind: "verification"; trace: VerificationTrace }
  | {
      kind: "evidence_integrity";
      code: "TELEMETRY_CONSISTENT" | "TELEMETRY_INCONSISTENT";
      consistent: boolean;
      violations: string[];
      readAttempts: number;
      uniqueFilesRead: number;
      evidenceFileCount: number;
      acceptedEvidenceCount: number;
      acceptedEvidenceFiles?: string[];
      completedReadFiles?: string[];
      retainedBodyFiles?: string[];
      acceptedClaimCount?: number;
      evidenceSourceCoverage?: CanonicalSourceCoverage;
      scopeExpansions?: ScopeExpansion[];
      unjustifiedReads?: string[];
      /** AI-OBJ-011: objective completion telemetry, when an objective was declared. */
      objectiveType?: string;
      requiredClaims?: string[];
      completedClaims?: string[];
      missingClaims?: string[];
      requiredEdges?: string[];
      provenEdges?: string[];
      failedEdges?: string[];
      recoveryTriggered?: boolean;
      recoveryTarget?: string;
      completionGateResult?: string;
      finalAnswerType?: "PRODUCTION_REACHABILITY_ANSWER" | "BEHAVIORAL_ANSWER" | "NO_ANSWER";
    }
  | { kind: "decision_trace"; trace: ForensicDecisionTrace }
  | { kind: "production_trace"; trace: ProductionReachabilityTrace }
  | { kind: "cross_file_trace"; trace: import("./semantic-trace.js").CrossFileSemanticTrace }
  | {
      kind: "forensic_packet";
      root: string;
      packetIndex: number;
      packetCount: number;
      fileCount: number;
      implementationFiles: number;
      contextFiles: number;
      generatedFiles: number;
      status: "STARTED" | "ACCEPTED" | "REJECTED" | "FAILED";
      reason?: string;
    }
  | {
      kind: "diagnostic";
      code: AgentDiagnosticCode;
      /** Bounded contract metadata; never contains model/source content. */
      details?: string[];
      /** Server-owned context for phase-policy rejections only. */
      phase?: ExecutionPhase;
      tool?: string;
    }
  | { kind: "execution_guard"; code: "REPEATED_TOOL_CALL"; tool: string; message: string }
  | {
      kind: "done";
      iterations: number;
      maxIterations: number;
      /**
       * Total logical tool-call events emitted in the execution trace.
       * Includes forensic prefetch calls and cached loop calls.
       */
      toolCalls: number;
      /** Tool-call events emitted before the agent loop (forensic prefetch). */
      prefetchToolCalls: number;
      /** Tool-call events emitted by the agent loop, including cache hits. */
      loopToolCalls: number;
      stopReason:
        | "response"
        | "iteration_budget"
        | "soft_limit"
        | "repeated_tool_call"
        | "empty_response"
         | "provider_timeout"
         | "tool_failure"
         | "claim_unclosed"
         | "evidence_incomplete"
         | "no_progress"
         | "validation_incomplete"
        | "cancelled";
      synthesisStarted: boolean;
      /** Bounded final-synthesis telemetry for operator diagnostics. */
      synthesisAttempts?: number;
      synthesisMaxAttempts?: number;
      synthesisTimeoutMs?: number;
      synthesisElapsedMs?: number;
      synthesisTimedOut?: boolean;
      diagnosticCodes: AgentDiagnosticCode[];
      /** Source-retrieval read classification and telemetry (SR-008). */
      sourceRetrieval?: SourceRetrievalTelemetry;
       objectiveState?: AgentLoopState;
    };

/**
 * Run the full agentic tool loop until the model stops requesting tools or
 * a budget is hit.
 *
 * The loop:
 *   1. Calls the model with the current message history + tool definitions.
 *   2. If the model returns tool_calls: for each call —
 *        a. Cache hit  → serve cached result (free, no budget).
 *        b. Budget hit → serve canned "exhausted" string (no execution).
 *        c. Unknown    → serve error string (no budget consumed).
 *        d. Execute via executeSingleTool, cache result, record source.
 *      Append all results to messages and loop.
 *   3. If the model returns no tool_calls: return kind:"response".
 *   4. If maxIterations exhausted without a text response: return kind:"exhausted".
 *
 * NON_200 from model: retried once with powerModel before re-throwing.
 * Other errors: re-thrown immediately.
 */
export async function executeToolLoop(opts: ToolLoopOpts): Promise<ToolLoopResult> {
  const {
    messages,
    strategy,
    model,
    powerModel,
    provider,
    apiKey,
    taskType,
    phase,
    requiresEvidence = true,
    deterministicTaskExecution = taskType === "task_execution",
    rootPath,
    pendingChanges,
    maxIterations: requestedMaxIterations,
    maxToolCalls: requestedMaxToolCalls,
    toolCallsDisabledAfter,
    synthesisTimeoutMs = DEFAULT_SYNTHESIS_TIMEOUT_MS,
    synthesisMaxAttempts = DEFAULT_SYNTHESIS_MAX_ATTEMPTS,
    executionMode,
    compoundWriteMode = false,
    executionTargetPaths = [],
    objective,
    claimState,
    allowExecutionTools = false,
    validationRunner,
    browserValidationRunner,
    browserValidationContext,
    commandProfiles,
    commandRunner,
    commandContext,
    validationTargetPaths = [],
    maxValidationAttempts,
    signal,
    allowedToolNames,
    approvalState,
    approvedFilePaths,
    approvedValidationProfiles,
    allowedReadPaths,
    objectiveScopePolicy,
    firstEvidenceTargetPath,
    orderedForensicRoots,
    allowTestSources = false,
    requireDependencyProof = false,
    onStep,
    executionLedger: suppliedExecutionLedger,
  } = opts;
  const executionLedger =
    suppliedExecutionLedger ??
    createExecutionLedger({
      mode: executionMode === "forensic" ? "forensic" : executionMode === "repair_plan" ? "repair_plan" : "tool_chat",
      signal,
      budget: {
        // maxIterations counts loop turns, while the request ledger counts
        // every provider attempt (empty-response retry, model fallback and
        // truncated-output repair included).
        modelCalls:
          (requestedMaxIterations ?? DEFAULT_MAX_ITERATIONS) * 3 +
          synthesisMaxAttempts,
        toolCalls: requestedMaxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
        synthesisAttempts: synthesisMaxAttempts,
      },
    });
  const phaseBudget = phase ? getPhaseBudget(phase) : undefined;
  const maxIterations = Math.min(
    requestedMaxIterations ?? DEFAULT_MAX_ITERATIONS,
    phaseBudget?.maxModelCalls ?? Number.POSITIVE_INFINITY,
  );
  const maxToolCalls = Math.min(
    requestedMaxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    phaseBudget?.maxToolCalls ?? Number.POSITIVE_INFINITY,
  );
  const callWithExecutionBudget = async (
    callMessages: RawMessage[],
    callOptions: Parameters<ProviderStrategy["call"]>[1],
    kind: "model" | "synthesis" = "model",
    callSignal?: AbortSignal,
  ): Promise<RawGroqResponse> => {
    const callStartedAt = Date.now();
    const callModel = callOptions.model ?? model;
    if (!executionLedger.admit(kind, { provider, model: callModel })) {
      throw new GroqClientError(
        executionLedger.signal.aborted ? "TIMEOUT" : "NON_200",
        `Execution ${kind} budget exhausted.`,
      );
    }
    try {
      return await strategy.call(callMessages, {
        ...callOptions,
        timeoutMs: executionLedger.timeoutMs(callOptions.timeoutMs),
        signal: callSignal ?? executionLedger.signal,
        executionLedger,
      });
    } finally {
      executionLedger.complete(kind, {
        provider,
        model: callModel,
        startedAt: callStartedAt,
        status: executionLedger.signal.aborted ? "failed" : "completed",
      });
    }
  };
  const boundedMaxValidationAttempts = Math.max(
    1,
    Math.min(
      Math.floor(Number.isFinite(maxValidationAttempts) ? maxValidationAttempts! : MAX_REPAIR_ATTEMPTS),
      MAX_REPAIR_ATTEMPTS,
    ),
  );

  const toolCallCache = opts.cache ?? new Map<string, string>();
  const toolSources: string[] = [];
  const fileContents = new Map<string, string>(opts.initialFileContents ?? []);
  // Retained SOURCE EVIDENCE keyed by canonical path — the ground truth the
  // dependency-proof gate validates from_file/reference against, populated from
  // prefetched bodies then every successful read this run.
  const canonicalRel = (value: string): string =>
    value.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const sourceEvidenceByCanonical = new Map<string, string>();
  for (const [path, body] of opts.initialFileContents ?? []) {
    sourceEvidenceByCanonical.set(canonicalRel(path), body);
  }
  const recordSourceEvidence = (path: string | undefined, output: string): void => {
    if (typeof path === "string" && path.trim()) {
      sourceEvidenceByCanonical.set(canonicalRel(path), output);
      opts.retainedFileContents?.set(path, output);
    }
  };
  // Fresh-execution budget counter; only fresh calls consume budget while the
  // persisted trace counts cached/prefetched logical calls too.
  let totalToolCalls = 0;
  const prefetchToolCalls = opts.initialFileContents?.size ?? 0;
  let loopToolCalls = 0;
  const executionCounts = (): {
    toolCalls: number;
    prefetchToolCalls: number;
    loopToolCalls: number;
  } => ({
    toolCalls: prefetchToolCalls + loopToolCalls,
    prefetchToolCalls,
    loopToolCalls,
  });
  const duplicateCallCounts = new Map<string, number>();
  const validationAttempts = new Map<string, number>();
  const failedValidationFingerprints = new Map<string, string>();
  const validationAttemptPatches = new Map<string, RepairPatchSnapshot>();
  let synthesisStarted = false;
  const boundedSynthesisTimeoutMs = Math.max(1_000, Math.floor(synthesisTimeoutMs));
  const boundedSynthesisMaxAttempts = Math.max(1, Math.floor(synthesisMaxAttempts));
  let synthesisDeadlineAt: number | null = null;
  let synthesisAttempts = 0;
  let synthesisTimedOut = false;
  let forceSynthesisNext = false;
  let temporarilyDisabledTools = new Set<string>();

  // ── Source-retrieval tracking ────────
  // Tracks per-path read status so a truncated read is never treated as a
  // complete source body and a redundant full re-read of a truncated file is
  // blocked instead of repeated. Telemetry is surfaced to callers so the
  // dashboard can show initial→TRUNCATED→targeted read progression.
  const readStatusByPath = new Map<string, ReadStatus>();
  const sourceRetrieval: SourceRetrievalTelemetry = createSourceRetrievalTelemetry();
  const recordScopeExpansion = (path: string | undefined): ScopeExpansion | undefined => {
    if (!objectiveScopePolicy || !path?.trim()) return undefined;
    const expansion = classifyObjectiveScopePath(path, objectiveScopePolicy);
    if (!expansion) return undefined;
    if (
      !sourceRetrieval.scopeExpansions.some(
        (existing) => existing.kind === expansion.kind && existing.path === expansion.path,
      )
    ) {
      sourceRetrieval.scopeExpansions.push(expansion);
      if (sourceRetrieval.scopeExpansions.length > 24) {
        sourceRetrieval.scopeExpansions.splice(24);
      }
    }
    return expansion;
  };
  const recordRead = (toolName: string, path: string | undefined, output: string): ReadStatus => {
    sourceRetrieval.readAttempts += 1;
    const status = classifyReadStatus(toolName, output);
    if (path !== undefined && path.trim()) {
      if (status === "READ_TRUNCATED" && readStatusByPath.get(path) !== "READ_TRUNCATED") {
        sourceRetrieval.truncatedReads += 1;
      }
      // Duplicate = repeat of SUCCESSFUL evidence, not of an attempted path.
      // A truncated/failed read yields no source body, so a later targeted
      // window is a real first acquisition that also stages the next new path.
      const priorHadEvidence =
        readStatusByPath.get(path) === "READ_COMPLETE" ||
        readStatusByPath.get(path) === "READ_TARGETED";
      readStatusByPath.set(path, status);
      if (status === "READ_COMPLETE" || status === "READ_TARGETED") {
        if (priorHadEvidence) {
          sourceRetrieval.duplicateReads += 1;
        } else {
          const alreadyHasEvidence =
            sourceRetrieval.uniqueReads > 0 || sourceRetrieval.prefetchReads > 0;
          if (alreadyHasEvidence) sourceRetrieval.dependencyReads += 1;
          sourceRetrieval.uniqueReads += 1;
          sourceRetrieval.readPaths.push(path);
        }
        sourceRetrieval.evidenceWindows += 1;
      }
    }
    if (status === "READ_TARGETED") sourceRetrieval.targetedReads += 1;
    return status;
  };
  const isTruncatedPath = (path: string | undefined): boolean =>
    typeof path === "string" && path.trim() !== "" && readStatusByPath.get(path) === "READ_TRUNCATED";
  // Whether the path previously yielded completed source evidence (as opposed
  // to an attempted/truncated/failed read). Duplicate = repeat of completed
  // evidence; a truncated recovery window is NOT a duplicate (FEG-015).
  const isCompletedPath = (path: string | undefined): boolean =>
    typeof path === "string" && path.trim() !== "" &&
    (readStatusByPath.get(path) === "READ_COMPLETE" || readStatusByPath.get(path) === "READ_TARGETED");
  const searchBudgetLimit = Math.max(
    1,
    Math.floor(opts.searchNoveltyBudget ?? DEFAULT_SEARCH_NOVELTY_BUDGET),
  );
  let searchBudgetRemaining = searchBudgetLimit;
  const searchResultHashes = new Set<string>();
  let searchBudgetExhausted = false;
  const searchBudgetEnabled = executionMode !== "forensic" && executionMode !== "repair_plan";
  const registerSearchResult = (output: string): { isNew: boolean; remaining: number } => {
    searchBudgetRemaining = Math.max(0, searchBudgetRemaining - 1);
    const canonical = output
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort()
      .join("\n");
    if (!canonical || /^Error\b/i.test(canonical)) {
      searchBudgetExhausted = searchBudgetRemaining <= 0;
      return { isNew: false, remaining: searchBudgetRemaining };
    }
    const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
    const isNew = !searchResultHashes.has(hash);
    if (isNew) {
      searchResultHashes.add(hash);
      searchBudgetRemaining = searchBudgetLimit;
    }
    searchBudgetExhausted = searchBudgetRemaining <= 0;
    if (!searchBudgetExhausted && isNew) searchBudgetExhausted = false;
    return { isNew, remaining: searchBudgetRemaining };
  };
  let prefetchedSynthesisAttempted = false;
  let lastModelUsed: string | undefined;

  // ── FEG-008 progress novelty ─────────
  // A search_code / list_directory call only counts as NEW evidence for the
  // no-progress streak when it returned USABLE, genuinely NOVEL output.
  // Failed (Error) or EMPTY results are never progress, and a repeat of a
  // canonical output already seen this run is not new evidence either — so a
  // planner cannot orbit by issuing an endless stream of distinct-but-useless
  // searches or listings that perpetually reset noProgressStreak and never
  // enter dispatch-enforced evidence mode. This tracker is INDEPENDENT of the
  // search-novelty budget: that budget keeps its own duplicate-handling /
  // forced-synthesis behavior, while FEG-008 progress is judged solely on
  // usable+novel. (Computed for the tool at hand only; reads are gated by
  // isSuccessfulSourceRead separately.)
  const gatherOutputHashes = new Set<string>();
  const canonicalGatherOutput = (output: string): string =>
    output
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort()
      .join("\n");
  // Neutral, evidence-free outputs the tools return when they found nothing.
  // These carry no usable evidence, so they must be rejected BEFORE novelty
  // hashing: an empty `list_directory` wrapper still embeds the directory path,
  // so distinct empty dirs each produce a fresh hash that would otherwise reset
  // the no-progress streak forever. Classify them as non-usable up front.
  const isEmptySearchOutput = (trimmed: string): boolean =>
    trimmed === "No matches found.";
  // e.g. `Contents of "src":\n(empty)`
  const isEmptyListingOutput = (trimmed: string): boolean =>
    /^Contents of "[^"]*":\n\(empty\)$/.test(trimmed);
  // Whether a search/list result is usable: non-empty, non-error, and not one
  // of the "found nothing" neutral shapes the tools actually emit.
  const isUsableGatherOutput = (output: string): boolean => {
    const trimmed = (output ?? "").trim();
    if (!trimmed) return false;
    if (/^Error\b/i.test(trimmed)) return false;
    if (isEmptySearchOutput(trimmed)) return false;
    if (isEmptyListingOutput(trimmed)) return false;
    return true;
  };
  // Whether a search/list result is usable AND novel (canonical output not
  // already surfaced this run). Every call is evaluated (recording any novel
  // hash even when the caller already knows the turn made progress), so a
  // lateral duplicate can never slip past a previously-saved hash.
  const isNovelGatherResult = (output: string): boolean => {
    if (!isUsableGatherOutput(output)) return false;
    const canonical = canonicalGatherOutput((output ?? "").trim());
    if (!canonical) return false;
    const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
    if (gatherOutputHashes.has(hash)) return false;
    gatherOutputHashes.add(hash);
    return true;
  };

  const cachedReadPaths = (): Set<string> => {
    const paths = new Set<string>();
    for (const key of toolCallCache.keys()) {
      if (!key.startsWith("read_file:")) continue;
      try {
        const parsed = JSON.parse(key.slice("read_file:".length)) as { path?: unknown };
        if (typeof parsed.path === "string") paths.add(parsed.path);
      } catch {
        // Ignore malformed cache keys; the normal tool loop will handle them.
      }
    }
    return paths;
  };

  const repairPlanTools = (): ToolDefinitionLike[] | undefined => {
    if (!opts.tools || executionMode !== "repair_plan") return opts.tools;

    const targets = new Set(executionTargetPaths);
    const reads = cachedReadPaths();
    const allTargetsRead =
      targets.size > 0 && [...targets].every((target) => reads.has(target));

    // Prefetch normally loads every executable target before the first model
    // call. Hiding read_file in that state makes the desired next action
    // structurally unavoidable: replace_text or write_file. After a failed
    // validation, however, the approved repair retry must be able to reread
    // the scoped target before producing its next patch.
    if (allTargetsRead && failedValidationFingerprints.size === 0) {
      return opts.tools.filter((tool) => tool.function.name !== "read_file");
    }

    return opts.tools;
  };

  // Compound write requests are intentionally two-phase. Once a usable source
  // body is available, expose only the pending-change tools so a provider cannot
  // spend the remaining turn budget re-reading the same file or stop after an
  // evidence-only answer. The dispatcher still owns path validation and the
  // tools only append in-memory pending changes.
  let compoundProposalActive =
    compoundWriteMode === true &&
    opts.initialFileContents !== undefined &&
    opts.initialFileContents.size > 0;
  let compoundProposalPromptSent = false;
  let compoundProposalRetrySent = false;
  const compoundProposalTools = (): ToolDefinitionLike[] | undefined => {
    const available = repairPlanTools();
    if (!compoundProposalActive || !available) return available;
    return available.filter((tool) =>
      tool.function.name === "write_file" || tool.function.name === "replace_text",
    );
  };

  const allowedTools = (() => {
    const requested = allowedToolNames ? new Set(allowedToolNames) : null;
    if (!phase) return requested;
    const phaseTools = new Set(
      (opts.tools ?? [])
        .map((tool) => tool.function.name)
        .filter((name) => isToolAllowedInPhase(phase, name)),
    );
    return requested
      ? new Set([...requested].filter((name) => phaseTools.has(name)))
      : phaseTools;
  })();
  // First-Evidence Gate: the explicit primary evidence target is always
  // readable as the first source read, even under an allow-list policy. The
  // gate expands tool permission for exactly this one path.
  const fegTarget = firstEvidenceTargetPath
    ? firstEvidenceTargetPath.replaceAll("\\", "/").replace(/^(\.\/)+/, "")
    : null;
  const allowedReads = allowedReadPaths
    ? (() => {
        const set = new Set(
          allowedReadPaths.map((value) => value.replaceAll("\\", "/").replace(/^(\.\/)+/, "")),
        );
        if (fegTarget) set.add(fegTarget);
        return set;
      })()
    : null;
  // FEG-009/010: whether this run even has a route to source evidence (a read
  // tool configured OR an explicit primary-evidence target). The protected
  // evidence-allocation guard and the recovery-bounds first-read force are only
  // meaningful when such a route exists; a search-only run with no read tool
  // cannot be forced toward evidence, so those guards stay inert there.
  const readToolConfigured = (opts.tools ?? []).some((tool) =>
    ["read_file", "read_file_range"].includes(tool.function.name),
  );
  const evidenceRouteAvailable = fegTarget !== null || readToolConfigured;
  const orderedRoots = (orderedForensicRoots ?? []).map((value) =>
    value.replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, ""),
  );
  let highestOrderedRoot = -1;

  const rootIndexForPath = (value: string): number => {
    const normalized = value.replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    // "." is the explicit project-root scope. Normalization above removes the
    // dot, so it becomes an empty root and must admit every project-relative
    // path; otherwise automatic broad-audit bootstrap would pre-read files but
    // then reject the same paths in the model tool loop.
    return orderedRoots.findIndex((root) =>
      root === "" ||
      root === "." ||
      normalized === root ||
      normalized.startsWith(`${root}/`),
    );
  };

  // Soft-limit state — tracks whether the synthesis hint has been injected and
  // saves the last non-empty text response for the kind:"partial" return path.
  const softLimitIter = Math.floor(maxIterations * SOFT_LIMIT_RATIO);
  let synthesisTriggerSent = false;
  let lastTextSeen: RawGroqResponse | undefined;

  /**
   * OR-003: Conservative token cap per model call.
    * OpenRouter models commonly truncate at the old 2 048-token cap;
    * 4 096 gives synthesis enough room while the existing length-retry and
    * provider-side limits remain the final safety boundary. Other providers
    * default to 4 096.
   * The caller can override with an explicit `maxTokens` option.
   */
  // No application-level token ceiling: when callers do not provide maxTokens,
  // let the provider/model choose its supported completion limit. Providers
  // may still enforce their own account/model maximum.
  const iterMaxTokens = opts.maxTokens ?? 4_096;

  /**
   * OR-004: Transient error codes that warrant a powerModel retry within
   * the same provider. User/validation errors (NON_200, AUTH_ERROR) are not
   * retried. EMPTY_RESPONSE gets one bounded same-model retry below because
   * free-tier providers can occasionally return an empty completion.
   */
  const TRANSIENT_CODES = new Set<string>(["TIMEOUT", "NETWORK_ERROR", "RATE_LIMITED", "SERVER_ERROR"]);
  let emptyResponseRetryUsed = false;
  const emitExecutionDiagnostic = (code: AgentDiagnosticCode, details: string[]): void => {
    if (executionMode !== "repair_plan") return;
    try {
      onStep?.({ kind: "diagnostic", code, details: details.slice(0, 2) });
    } catch { /* ignore */ }
  };
  const terminalInvalidToolCall = (error: GroqClientError, iter: number): ToolLoopResult => {
    // The provider client has already rejected this response against the
    // server-owned manifest. Do not retry it, append a synthetic tool result,
    // or expose the provider's raw diagnostic. A single terminal step keeps
    // the UI and persisted trace honest without turning the request into a
    // generic "failed to send" loop.
    const toolMatch = error.message.match(/\btool\s+["'`]?([A-Za-z][A-Za-z0-9_.-]{0,119})/i);
    const tool = toolMatch?.[1] ?? "provider_tool_call";
    try {
      onStep?.({
        kind: "diagnostic",
        code: "TOOL_UNAVAILABLE",
        details: ["requested tool was rejected by the authorized tool manifest"],
        tool,
      });
      onStep?.({
        kind: "tool_result",
        tool,
        cached: false,
        outputLength: 0,
        resultKind: "unavailable",
        diagnosticCode: "TOOL_UNAVAILABLE",
        resultSummary: "Requested tool was unavailable; operation blocked.",
      });
      onStep?.({
        kind: "done",
        iterations: iter + 1,
        maxIterations,
        ...executionCounts(),
        stopReason: "tool_failure",
        synthesisStarted,
        synthesisAttempts,
        synthesisMaxAttempts: boundedSynthesisMaxAttempts,
        synthesisTimeoutMs: boundedSynthesisTimeoutMs,
        ...(sourceRetrieval.synthesisElapsedMs !== undefined
          ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
          : {}),
        ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
        diagnosticCodes: ["TOOL_UNAVAILABLE"],
        sourceRetrieval,
      });
    } catch { /* observers must not change terminal semantics */ }
    return {
      kind: "failed",
      tool,
      failureKind: "unavailable",
      diagnosticCode: "TOOL_UNAVAILABLE",
      toolSources,
      fileContents,
      sourceRetrieval,
    };
  };
  const emitReadEvidenceLinked = (
    toolName: string,
    path: string | undefined,
    modelContent: string | null | undefined,
    output: string,
  ): void => {
    if (
      executionMode !== "repair_plan" ||
      (toolName !== "read_file" && toolName !== "read_file_range") ||
      typeof path !== "string" ||
      !path.trim() ||
      !isUsableReadOutput(output)
    ) {
      return;
    }
    const claim = modelContent?.trim().replace(/\s+/g, " ").slice(0, 300);
    emitExecutionDiagnostic("READ_EVIDENCE_LINKED", [
      path.trim(),
      claim ? `claim: ${claim}` : "claim: none stated before the read",
    ]);
  };

  const callWithEmptyResponseRetry = async (
    callMessages: RawMessage[],
    callOptions: Parameters<ProviderStrategy["call"]>[1],
  ): Promise<{ result: RawGroqResponse; attemptCount: number }> => {
    try {
      return { result: await callWithExecutionBudget(callMessages, callOptions), attemptCount: 1 };
    } catch (err) {
      if (
        !(err instanceof GroqClientError) ||
        err.code !== "EMPTY_RESPONSE" ||
        emptyResponseRetryUsed
      ) {
        throw err;
      }

      emptyResponseRetryUsed = true;
      console.warn(
        JSON.stringify({
          scope: "tool-execution-engine",
          code: "EMPTY_RESPONSE_RETRY",
          provider,
          model: callOptions.model ?? model,
          reason: err.message,
        }),
      );

      try {
        return {
          result: await callWithExecutionBudget(callMessages, callOptions),
          attemptCount: 2,
        };
      } catch (retryErr) {
        if (retryErr instanceof GroqClientError) {
          emitExecutionDiagnostic("EXECUTION_PROVIDER_FAILURE", [
            `provider failure code: ${retryErr.code}`,
          ]);
        }
        throw retryErr;
      }
    }
  };

  const callWithSynthesisBudget = async (
    callMessages: RawMessage[],
    options: Parameters<ProviderStrategy["call"]>[1],
  ): Promise<RawGroqResponse> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < boundedSynthesisMaxAttempts; attempt += 1) {
      if (synthesisAttempts >= boundedSynthesisMaxAttempts) break;
      if (synthesisDeadlineAt !== null && Date.now() >= synthesisDeadlineAt) {
        synthesisTimedOut = true;
        sourceRetrieval.synthesisTimedOut = true;
        break;
      }
      synthesisAttempts += 1;
      sourceRetrieval.synthesisAttempts = synthesisAttempts;
      const startedAt = Date.now();
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      if (opts.signal?.aborted) controller.abort();
      else opts.signal?.addEventListener("abort", abortFromParent, { once: true });
      const remaining = Math.max(
        1,
        (synthesisDeadlineAt ?? Date.now() + boundedSynthesisTimeoutMs) - Date.now(),
      );
      const timer = setTimeout(() => {
        synthesisTimedOut = true;
        sourceRetrieval.synthesisTimedOut = true;
        controller.abort();
      }, remaining);
      try {
        // Preserve the configured timeout for the first synthesis attempt.
        // Computing the shared deadline and setting up the abort timer can
        // consume a millisecond, which otherwise turns a requested 5,000 ms
        // provider timeout into 4,999 ms and makes the contract needlessly
        // timing-sensitive. The local timer still enforces the shared
        // deadline; retries use the remaining time.
        const attemptTimeoutMs = synthesisAttempts === 1
          ? Math.min(options.timeoutMs ?? 60_000, boundedSynthesisTimeoutMs)
          : Math.min(options.timeoutMs ?? 60_000, remaining);
        return await callWithExecutionBudget(callMessages, {
          ...options,
          ...(opts.capability ? { capability: opts.capability } : {}),
          timeoutMs: attemptTimeoutMs,
          signal: controller.signal,
        }, "synthesis", controller.signal);
      } catch (error) {
        lastError = error;
        if (error instanceof GroqClientError && error.code === "TIMEOUT") {
          synthesisTimedOut = true;
          sourceRetrieval.synthesisTimedOut = true;
        }
        if (!(error instanceof GroqClientError) || error.code !== "EMPTY_RESPONSE") {
          throw error;
        }
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", abortFromParent);
        sourceRetrieval.synthesisElapsedMs =
          (sourceRetrieval.synthesisElapsedMs ?? 0) + (Date.now() - startedAt);
        sourceRetrieval.synthesisTimedOut = synthesisTimedOut;
      }
    }
    throw lastError ?? new GroqClientError("TIMEOUT", "synthesis attempt budget exhausted");
  };

  /**
   * Some OpenRouter models return tool_calls even when the request contains no
   * tools. That response cannot be executed in the synthesis window and often
   * has no text at all. Give the configured power model one bounded chance to
   * produce the no-tools answer before handing the evidence to recovery.
   */
  const callSynthesisWithFallback = async (
    callMessages: RawMessage[],
    callOptions: Parameters<ProviderStrategy["call"]>[1],
  ): Promise<{ result: RawGroqResponse; attemptCount: number }> => {
    const attemptsBefore = synthesisAttempts;
    const first = {
      result: await callWithSynthesisBudget(callMessages, callOptions),
      attemptCount: synthesisAttempts - attemptsBefore,
    };
    if (
      first.result.content?.trim() ||
      !first.result.toolCalls?.length ||
      callOptions.model === powerModel ||
      synthesisAttempts >= boundedSynthesisMaxAttempts
    ) {
      return first;
    }

    console.warn(
      JSON.stringify({
        scope: "tool-execution-engine",
        code: "SYNTHESIS_TOOL_CALL_FALLBACK",
        from: callOptions.model ?? model,
        to: powerModel,
        reason: "provider returned tool_calls during a no-tools synthesis request",
      }),
    );

    try {
      const fallback = await callWithSynthesisBudget(callMessages, {
        ...callOptions,
        model: powerModel,
      });
      return {
        result: fallback,
        attemptCount: synthesisAttempts - attemptsBefore,
      };
    } catch {
      return first;
    }
  };

  // ── Investigation Start SLA (FEG-007) + progress enforcement (FEG-008) ─────
  // Anti-starvation guards. The loop must actually start reading source within
  // a few iterations, and each planning iteration must produce new evidence;
  // otherwise a circular planner settles into a bare NOT_PROVEN / no-reading
  // loop that no single recoverable read can escape.
  // 0-based iteration at which the first source read (fresh or cached) landed.
  let firstSourceReadIter: number | null = null;
  // Consecutive planning iterations (a model turn that issued tool calls) which
  // produced no NEW_SOURCE_READ / NEW_SYMBOL / NEW_DEPENDENCY / CLAIM_CLOSED.
  let noProgressStreak = 0;
  // ── Run-budget rebalancing (FEG-009/010) ─────────────
  // maxIterations is split into planning / evidence / reasoning / recovery
  // allocations, and cumulative spending per category is tracked so a run
  // cannot exhaust the budget on planning before it ever acquires source
  // evidence. The EVIDENCE allocation is PROTECTED: once the PLANNING share is
  // exhausted while the run still has zero source reads, the loop is forced
  // toward a first-evidence action instead of being allowed to keep planning.
  const runBudget = splitRunBudget(maxIterations);
  let planningIterations = 0;
  let evidenceIterations = 0;
  let reasoningIterations = 0;
  sourceRetrieval.budgetAllocation = {
    planning: runBudget.planning,
    evidence: runBudget.evidence,
    reasoning: runBudget.reasoning,
  };
  sourceRetrieval.synthesisMaxAttempts = boundedSynthesisMaxAttempts;
  sourceRetrieval.synthesisTimeoutMs = boundedSynthesisTimeoutMs;
  // True once the progress guard has forced a primary-evidence action, so the
  // directive is injected once per run rather than spamming every turn.
  let forcedPrimaryEvidence = false;
  // Persistent forced-evidence state (FEG-008). Once the guard trips, the loop
  // stays in this state AND ENFORCES IT AT DISPATCH: tool calls outside the
  // permitted set (the primary read target, or any source read when no target
  // was named) are rejected inline, not merely withheld from the provider's
  // tool definitions. The state clears only when a permitted source read lands
  // or the model synthesizes, so a planner cannot resume orbiting.
  let forcedEvidenceActive = false;
  let forcedNoProgressStreak = 0;
  const NO_PROGRESS_FORCE_THRESHOLD = 2;
  // A read (fresh or cached) that satisfies the forced-evidence mandate. A
  // blank / missing path is NOT permitted: while forced, a malformed read call
  // (e.g. a missing path that would resolve to a directory-read error) must not
  // satisfy the mandate, or a planner could "escape" the force without ever
  // acquiring real source evidence. This is the DISPATCH gate only: it restricts
  // what may run while forced. It is intentionally NOT used for progress/first-
  // read accounting, so a run that reads a valid permitted path other than the
  // named target is still credited with real source acquisition.
  const isForcedTargetRead = (
    toolName: string,
    path: string | undefined,
  ): boolean => {
    if (toolName !== "read_file" && toolName !== "read_file_range") return false;
    if (typeof path !== "string" || !path.trim()) return false;
    const normalized = path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
    return fegTarget ? normalized === fegTarget : true;
  };
  // A SUCCESSFUL source-evidence read: a nonempty, permitted source path whose
  // read produced usable, non-error output (READ_COMPLETE or READ_TARGETED).
  // A failed read (error, empty, directory listing) is NOT source evidence, so
  // it neither records a first read nor resets the no-progress streak, and it
  // does not clear the force. This is evaluated INDEPENDENTLY of the forced-
  // target dispatch predicate: "first source read" and the FEG-008 progress
  // reset must reflect any valid permitted read, not only the named primary
  // target, or a run that reads a different valid file first would falsely
  // report a zero-read SLA.
  const isSuccessfulSourceRead = (
    toolName: string,
    path: string | undefined,
    output: string,
  ): boolean => {
    if (toolName !== "read_file" && toolName !== "read_file_range") return false;
    if (typeof path !== "string" || !path.trim()) return false;
    const status = classifyReadStatus(toolName, output);
    return status === "READ_COMPLETE" || status === "READ_TARGETED";
  };

  // ── Prefetch-aware first-read & SLA accounting (FEG-007) ───────────────
  // `initialFileContents` carries source bodies acquired BEFORE the loop
  // (including the eager first-evidence read in `chat-agent`). Those are real,
  // already-landed source reads: register each usable prefetched path so a
  // later replay is recognized as already-read (not "unseen new evidence"),
  // and seed the first-read telemetry with a pre-loop marker. Otherwise a run
  // that prefetched valid evidence and then merely continued planning until
  // the soft limit would falsely report INVESTIGATION_START_FAILURE /
  // soft_limit_with_zero_reads — a zero-read verdict for a run that DID acquire
  // evidence. The negative sentinel PREFETCH_FIRST_READ_ITER is unambiguous
  // versus real 0-based loop iterations.
  if (opts.initialFileContents) {
    let usablePrefetchSeen = false;
    for (const [path, body] of opts.initialFileContents) {
      if (isSuccessfulSourceRead("read_file", path, body)) {
        usablePrefetchSeen = true;
        if (!readStatusByPath.has(path)) {
          readStatusByPath.set(path, classifyReadStatus("read_file", body));
        }
        sourceRetrieval.prefetchReads += 1;
      }
    }
    if (usablePrefetchSeen) {
      firstSourceReadIter = PREFETCH_FIRST_READ_ITER;
      sourceRetrieval.iterationsUntilFirstSourceRead = PREFETCH_FIRST_READ_ITER;
      sourceRetrieval.iterationsUntilFirstRead = PREFETCH_FIRST_READ_ITER;
      sourceRetrieval.firstEvidenceAcquired = true;
      sourceRetrieval.prefetchBeforeFirstRead = true;
      sourceRetrieval.iterationsWithoutEvidence = 0;
    }
  }

  // ── Zero-read terminal classification (FEG-010) ────────────────────────────
  // A run that exits the loop with ZERO source reads never acquired evidence to
  // weigh — that is NOT a normal terminal, it is INCOMPLETE_BEFORE_EVIDENCE.
  // We flag it (telemetry + diagnostic) at every terminal return so a caller
  // can distinguish "investigated and found nothing" from "never got anything
  // to investigate". Prefetch-seeded runs already carry the negative first-read
  // sentinel and are therefore never misclassified here.
  let zeroReadClassified = false;
  // `elapsedIterations` is the loop's actual terminal iteration count (the same
  // value the accompanying done step reports in its `iterations` field). A run
  // that ends after one or a few zero-read turns must report THAT many starving
  // iterations, never the full configured budget.
  const classifyZeroReadTerminal = (when: string, elapsedIterations: number): void => {
    if (!requiresEvidence || firstSourceReadIter !== null || zeroReadClassified) return;
    zeroReadClassified = true;
    sourceRetrieval.incompleteBeforeEvidence = true;
    sourceRetrieval.iterationsWithoutEvidence = elapsedIterations;
    sourceRetrieval.planningIterations = planningIterations;
    sourceRetrieval.evidenceIterations = evidenceIterations;
    try {
      onStep?.({
        kind: "diagnostic",
        code: "INCOMPLETE_BEFORE_EVIDENCE",
        details: [
          `run ended (${when}) with zero source reads; no evidence was ever acquired`,
        ],
      });
    } catch { /* ignore */ }
  };
  let currentIteration = 0;
  let loopPhase: AgentLoopPhase = "planning";
  const normalizedObjectivePath = (value: string): string =>
    value.replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  const verifiedPathSet = (): Set<string> => new Set(
    [...fileContents.keys(), ...sourceEvidenceByCanonical.keys()]
      .map(normalizedObjectivePath),
  );
  const buildObjectiveState = (
    terminalReason?: AgentLoopState["terminalReason"],
  ): AgentLoopState | undefined => {
    if (!objective) return undefined;
    const verifiedPaths = verifiedPathSet();
    const missingEvidencePaths = (objective.requiredEvidencePaths ?? [])
      .map(normalizedObjectivePath)
      .filter((path) => !verifiedPaths.has(path));
    const restored = new Map((claimState ?? []).map((claim) => [claim.claimId, claim]));
    const claims = objective.requiredClaims.map((claim) => {
      const prior = restored.get(claim.claimId);
      if (prior?.status === "PROVEN" || prior?.status === "BLOCKED") {
        return { ...prior, evidenceRefs: prior.evidenceRefs.slice(0, 12) };
      }
      const requiredPaths = (claim.requiredEvidencePaths ?? []).map(normalizedObjectivePath);
      const evidenceRefs = requiredPaths.filter((path) => verifiedPaths.has(path));
      return {
        claimId: claim.claimId,
        status: requiredPaths.length > 0 && evidenceRefs.length === requiredPaths.length
          ? "PROVEN" as const
          : "PENDING" as const,
        evidenceRefs,
      };
    });
    return {
      goal: objective.goal,
      phase: loopPhase,
      iterations: currentIteration,
      progress: {
        uniqueSourceReads: sourceRetrieval.uniqueReads + sourceRetrieval.prefetchReads,
        toolCalls: totalToolCalls,
        noProgressStreak,
      },
      claims,
      missingEvidencePaths,
      ...(terminalReason ? { terminalReason } : {}),
    };
  };
  const objectiveIncompleteReason = (): "claim_unclosed" | "evidence_incomplete" | "no_progress" | undefined => {
    if (!objective) return undefined;
    const state = buildObjectiveState();
    if (state?.missingEvidencePaths.length) return "evidence_incomplete";
    if (state?.claims.some((claim) => claim.status !== "PROVEN")) return "claim_unclosed";
    return undefined;
  };
  const incompleteResult = (
    reason: "claim_unclosed" | "evidence_incomplete" | "no_progress" | "validation_incomplete",
    result?: RawGroqResponse,
  ): ToolLoopResult => {
    loopPhase = "terminal";
    const state = buildObjectiveState(reason);
    try {
      onStep?.({
        kind: "done",
        iterations: currentIteration,
        maxIterations,
        ...executionCounts(),
        stopReason: reason,
        synthesisStarted,
        synthesisAttempts,
        synthesisMaxAttempts: boundedSynthesisMaxAttempts,
        synthesisTimeoutMs: boundedSynthesisTimeoutMs,
        ...(sourceRetrieval.synthesisElapsedMs !== undefined
          ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
          : {}),
        ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
        diagnosticCodes: [],
        sourceRetrieval,
        ...(state ? { objectiveState: state } : {}),
      });
    } catch { /* observers must not change terminal semantics */ }
    return {
      kind: "incomplete",
      reason,
      ...(result ? { result } : {}),
      toolSources,
      fileContents,
      sourceRetrieval,
      ...(state ? { objectiveState: state } : {}),
    };
  };
  const cancelledResult = (): ToolLoopResult => {
    loopPhase = "terminal";
    currentIteration = Math.max(currentIteration, 0);
    try {
      onStep?.({
        kind: "done",
        iterations: currentIteration,
        maxIterations,
        ...executionCounts(),
        stopReason: "cancelled",
        synthesisStarted,
        synthesisAttempts,
        synthesisMaxAttempts: boundedSynthesisMaxAttempts,
        synthesisTimeoutMs: boundedSynthesisTimeoutMs,
        ...(sourceRetrieval.synthesisElapsedMs !== undefined
          ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
          : {}),
        ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
        diagnosticCodes: [],
        sourceRetrieval,
      });
    } catch { /* ignore */ }
    return {
      kind: "cancelled",
      toolSources,
      fileContents,
      sourceRetrieval,
      ...(buildObjectiveState("cancelled")
        ? { objectiveState: buildObjectiveState("cancelled") }
        : {}),
    };
  };
  const failedToolResult = (
    tool: string,
    failureKind: "execution" | "unavailable" | "cancelled",
    diagnosticCode: Extract<AgentDiagnosticCode, `TOOL_${string}`>,
    safeMessage: string,
    analysisFailureCategory?: import("./tools/analysis-tools.js").AnalysisFailureCategory,
  ): ToolLoopResult => {
    try {
      onStep?.({ kind: "diagnostic", code: diagnosticCode, details: [`${tool}: ${failureKind}`] });
      onStep?.({
        kind: "tool_result",
        tool,
        cached: false,
        outputLength: safeMessage.length,
        resultKind: failureKind === "execution" ? "failed" : failureKind,
        diagnosticCode,
        resultSummary: safeMessage,
        ...(analysisFailureCategory ? { analysisFailureCategory } : {}),
      });
      onStep?.({
        kind: "done",
        iterations: currentIteration,
        maxIterations,
        ...executionCounts(),
        stopReason: "tool_failure",
        synthesisStarted,
        diagnosticCodes: [diagnosticCode],
        sourceRetrieval,
      });
    } catch { /* observers must not change the terminal result */ }
    return {
      kind: "failed",
      toolSources,
      fileContents,
      sourceRetrieval,
      tool,
      failureKind,
      diagnosticCode,
      ...(analysisFailureCategory ? { analysisFailureCategory } : {}),
      ...(buildObjectiveState("evidence_incomplete")
        ? { objectiveState: buildObjectiveState("evidence_incomplete") }
        : {}),
    };
  };

  for (let iter = 0; iter < maxIterations; iter++) {
    currentIteration = iter;
    if (signal?.aborted) return cancelledResult();
    try { onStep?.({ kind: "iteration_start", iter, maxIterations }); } catch { /* ignore */ }
    // Reset per-iteration progress attribution before any tool calls dispatch.
    let iterationIssuedToolCalls = false;
    loopPhase = "planning";
    let iterationNewRead = false;
    let iterationNewSearch = false;
    let iterationListDir = false;
    // ── Soft-limit synthesis hint ─────────────────────
    // At 75 % of the iteration budget, inject a user-turn asking the model to
    // wrap up from what it has already gathered.  This gives the model one or
    // two more chances to produce a text response before the hard limit fires,
    // converting a silent "exhausted" into a useful partial answer.
    if (iter >= softLimitIter && !synthesisTriggerSent) {
      synthesisTriggerSent = true;
      if (lastModelUsed) recordBehavioralFailure(lastModelUsed, "soft_limit");
      // ── Investigation Start SLA (FEG-007) ─────────────
      // If the soft limit fires before the FIRST source read, the run never
      // started investigating — report that explicitly rather than letting it
      // degrade into a bare NOT_PROVEN verdict the caller cannot explain.
      if (requiresEvidence && firstSourceReadIter === null) {
        sourceRetrieval.investigationStartSla =
          sourceRetrieval.investigationStartSla ?? "soft_limit_with_zero_reads";
        try {
          onStep?.({
            kind: "diagnostic",
            code: "INVESTIGATION_START_FAILURE",
            details: [
              `soft limit (iter=${iter}) reached before any source read` +
                (fegTarget ? `; primary evidence target was "${fegTarget}"` : ""),
            ],
          });
        } catch { /* ignore */ }
      }
      try { onStep?.({ kind: "soft_limit", iter }); } catch { /* ignore */ }
      if (deterministicTaskExecution) {
        const partialResult: RawGroqResponse = lastTextSeen ?? {
          content: "",
          toolCalls: null,
          model,
          usage: { promptTokens: 0, completionTokens: 0 },
        };
        classifyZeroReadTerminal("soft_limit", iter);
        try {
          onStep?.({
            kind: "done",
            iterations: iter,
            maxIterations,
            ...executionCounts(),
            stopReason: "soft_limit",
            synthesisStarted,
            diagnosticCodes: [],
            sourceRetrieval,
          });
        } catch { /* ignore */ }
        return {
          kind: "partial",
          result: partialResult,
          toolSources,
          sourceRetrieval,
          fileContents,
          reason: "soft_limit",
        };
      }
      const isArabicCtx = messages.some(
        (m) => m.role === "user" && /[\u0600-\u06FF]/.test(String(m.content ?? "")),
      );
       const synthesisHint =
         executionMode === "repair_plan"
           ? (isArabicCtx
             ? "هذه عملية تنفيذ Repair Plan وليست تدقيقًا جديدًا. لا تعاود قراءة الملف نفسه. إذا كانت الأدلة الموجودة كافية، انتقل الآن إلى replace_text أو write_file، وإلا أنهِ المرحلة برسالة واضحة دون ادعاء تطبيق التغيير."
             : "This is a Repair Plan execution, not a new audit. Do not reread the same file. If the gathered evidence is sufficient, call replace_text or write_file now; otherwise end the phase clearly without claiming the change was applied.")
           : (isArabicCtx
             ? "لقد جمعت معلومات كافية. الآن لخّص ما وجدته بشكل مفيد وشامل — لا تستدع أدوات إضافية."
             : "You have gathered enough information. Please synthesize and summarize everything you have found so far — do not call additional tools.");
      messages.push({ role: "user", content: synthesisHint });
      console.warn(
        JSON.stringify({
          scope: "tool-execution-engine",
          code: "SOFT_LIMIT_TRIGGER",
          iter,
          softLimitIter,
          maxIterations,
        }),
      );
    }

    // ── Model call (with transient-error fallback to powerModel) ────────────
    let result: RawGroqResponse;
    let attemptCount = 1;
    let fallbackReason: string | undefined;
    const t0 = Date.now();

    // A repair-plan handoff must start with a real tool call, but subsequent
    // turns must be allowed to synthesize a final answer after the tool result.
    const callToolChoice = iter === 0 ? opts.toolChoice : undefined;
    const synthesisOnly =
      forceSynthesisNext ||
      (toolCallsDisabledAfter !== undefined && iter >= toolCallsDisabledAfter);
    if (synthesisOnly && !synthesisStarted) {
      synthesisStarted = true;
      synthesisDeadlineAt = Date.now() + boundedSynthesisTimeoutMs;
      try {
        onStep?.({
          kind: "synthesis_start",
          iter,
          maxIterations,
        });
      } catch { /* ignore */ }
    }
    const disabledForThisIteration = temporarilyDisabledTools;
    temporarilyDisabledTools = new Set<string>();
    if (
      compoundProposalActive &&
      !compoundProposalPromptSent &&
      opts.initialFileContents &&
      opts.initialFileContents.size > 0
    ) {
      compoundProposalPromptSent = true;
      messages.push({
        role: "user",
        content:
          "The requested source evidence is now available above. Advance to the proposal phase now: " +
          "use replace_text with an exact unique old_text/new_text pair for the requested fix, " +
          "or write_file only when the requested file is new. Do not read, search, validate, or apply changes.",
      });
    }
    // Sanitize after adding the server-owned phase instruction so the current
    // provider call receives that instruction as well as the retained evidence.
    const safeMessages = stripOrphanedToolMessages(messages);
    const availableIterationTools = synthesisOnly ? [] : compoundProposalTools();
    const iterationTools = availableIterationTools?.filter(
      (tool) =>
        !disabledForThisIteration.has(tool.function.name) &&
        !(searchBudgetEnabled && searchBudgetExhausted && tool.function.name === "search_code"),
    );

    // Keep the complete messages in memory for provenance/evidence validation,
    // but never resend unbounded tool bodies to a provider. This applies to
    // ordinary tool-loop turns as well as the no-tools synthesis window.
    const outboundMessages = compactModelMessages(safeMessages);

    try {
      const synthesisAttemptsBeforeCall = synthesisAttempts;
      const callResult = synthesisOnly
        ? {
            result: await callWithSynthesisBudget(outboundMessages, {
              model,
              ...(iterMaxTokens !== undefined ? { maxTokens: iterMaxTokens } : {}),
              timeoutMs: 60_000,
              apiKey,
              taskType,
              ...(opts.capability ? { capability: opts.capability } : {}),
              ...(callToolChoice ? { toolChoice: callToolChoice } : {}),
              ...(iterationTools != null ? { tools: iterationTools } : {}),
              ...(!synthesisOnly && opts.tools ? { toolManifest: opts.tools } : {}),
              ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
            }),
            attemptCount: synthesisAttempts - synthesisAttemptsBeforeCall,
          }
        : await callWithEmptyResponseRetry(outboundMessages, {
        model,
        ...(iterMaxTokens !== undefined ? { maxTokens: iterMaxTokens } : {}),
        timeoutMs: 60_000,
        apiKey,
        ...(opts.signal ? { signal: opts.signal } : {}),
        taskType,
        ...(opts.capability ? { capability: opts.capability } : {}),
        ...(callToolChoice ? { toolChoice: callToolChoice } : {}),
        ...(iterationTools != null ? { tools: iterationTools } : {}),
        ...(!synthesisOnly && opts.tools ? { toolManifest: opts.tools } : {}),
        ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
      });
      result = callResult.result;
      attemptCount = callResult.attemptCount;
    } catch (err) {
      if (signal?.aborted) return cancelledResult();
      if (err instanceof GroqClientError && err.code === "INVALID_TOOL_CALL") {
        return terminalInvalidToolCall(err, iter);
      }
      // OR-004: only fall back to powerModel on transient infrastructure errors,
      // not on user/validation errors like NON_200 or AUTH_ERROR.
      if (
        err instanceof GroqClientError &&
        TRANSIENT_CODES.has(err.code) &&
        model !== powerModel &&
        (!synthesisOnly || synthesisAttempts < boundedSynthesisMaxAttempts)
      ) {
        fallbackReason = err.code;
        attemptCount = 2;
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "MODEL_FALLBACK",
            from: model,
            to: powerModel,
            provider,
            iter,
            errorCode: err.code,
            reason: err.message,
          }),
        );
        try {
          const fallbackResult = synthesisOnly
            ? await callWithSynthesisBudget(outboundMessages, {
                model: powerModel,
                ...(iterMaxTokens !== undefined ? { maxTokens: iterMaxTokens } : {}),
                timeoutMs: 60_000,
                apiKey,
                taskType,
                 ...(opts.capability ? { capability: opts.capability } : {}),
                ...(iterationTools != null ? { tools: iterationTools } : {}),
                ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
            })
          : await callWithExecutionBudget(outboundMessages, {
            model: powerModel,
            ...(iterMaxTokens !== undefined ? { maxTokens: iterMaxTokens } : {}),
            timeoutMs: 60_000,
            apiKey,
             ...(opts.signal ? { signal: opts.signal } : {}),
             taskType,
             ...(opts.capability ? { capability: opts.capability } : {}),
            ...(callToolChoice ? { toolChoice: callToolChoice } : {}),
            ...(iterationTools != null ? { tools: iterationTools } : {}),
             ...(opts.tools ? { toolManifest: opts.tools } : {}),
            ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
            });
          result = fallbackResult;
        } catch (fallbackErr) {
          if (fallbackErr instanceof GroqClientError) {
            emitExecutionDiagnostic("EXECUTION_PROVIDER_FAILURE", [
              `fallback provider failure code: ${fallbackErr.code}`,
            ]);
          }
          if (fallbackErr instanceof GroqClientError && fallbackErr.code === "INVALID_TOOL_CALL") {
            return terminalInvalidToolCall(fallbackErr, iter);
          }
          // TIMEOUT after both primary and fallback: degrade gracefully when
          // evidence has already been collected so the caller can surface a
          // partial report rather than a generic error message.
          if (
            fallbackErr instanceof GroqClientError &&
            fallbackErr.code === "TIMEOUT" &&
            (lastTextSeen !== undefined ||
              synthesisStarted ||
              fileContents.size > 0 ||
              totalToolCalls > 0)
          ) {
            console.warn(
              JSON.stringify({
                scope: "tool-execution-engine",
                code: "TIMEOUT_PARTIAL_DEGRADATION",
                provider,
                iter,
                reason: "both primary and fallback timed out; returning partial from collected evidence",
              }),
            );
            classifyZeroReadTerminal("provider_timeout", iter + 1);
            try {
              onStep?.({
                kind: "done",
                iterations: iter + 1,
                maxIterations,
                ...executionCounts(),
                stopReason: "provider_timeout",
                synthesisStarted,
                synthesisAttempts,
                synthesisMaxAttempts: boundedSynthesisMaxAttempts,
                synthesisTimeoutMs: boundedSynthesisTimeoutMs,
                ...(sourceRetrieval.synthesisElapsedMs !== undefined
                  ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
                  : {}),
                ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
                diagnosticCodes: [],
                sourceRetrieval,
              });
            } catch { /* ignore */ }
            return {
              kind: "partial",
              sourceRetrieval,
              result: lastTextSeen ?? {
                content: "",
                toolCalls: null,
                model,
                usage: { promptTokens: 0, completionTokens: 0 },
              },
              toolSources,
              fileContents,
              reason: "provider_timeout",
            };
          }
          throw fallbackErr;
        }
      } else {
        if (err instanceof GroqClientError) {
          emitExecutionDiagnostic("EXECUTION_PROVIDER_FAILURE", [`provider failure code: ${err.code}`]);
        }
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "MODEL_ERROR",
            provider,
            model,
            iter,
            errorCode: err instanceof GroqClientError ? err.code : "unknown",
            reason: err instanceof Error ? err.message : String(err),
          }),
        );

        // TIMEOUT (already on powerModel, or non-retryable transient): degrade
        // gracefully when evidence has already been collected so the caller can
        // surface a partial report rather than a generic error message.
        if (err instanceof GroqClientError && err.code === "TIMEOUT") {
          if (
            lastTextSeen !== undefined ||
            synthesisStarted ||
            fileContents.size > 0 ||
            totalToolCalls > 0
          ) {
            console.warn(
              JSON.stringify({
                scope: "tool-execution-engine",
                code: "TIMEOUT_PARTIAL_DEGRADATION",
                provider,
                model,
                iter,
                reason: "provider timed out; returning partial from collected evidence",
              }),
            );
            classifyZeroReadTerminal("provider_timeout", iter + 1);
            try {
              onStep?.({
                kind: "done",
                iterations: iter + 1,
                maxIterations,
                ...executionCounts(),
                stopReason: "provider_timeout",
                synthesisStarted,
                synthesisAttempts,
                synthesisMaxAttempts: boundedSynthesisMaxAttempts,
                synthesisTimeoutMs: boundedSynthesisTimeoutMs,
                ...(sourceRetrieval.synthesisElapsedMs !== undefined
                  ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
                  : {}),
                ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
                diagnosticCodes: [],
                sourceRetrieval,
              });
            } catch { /* ignore */ }
            return {
              kind: "partial",
              sourceRetrieval,
              result: lastTextSeen ?? {
                content: "",
                toolCalls: null,
                model,
                usage: { promptTokens: 0, completionTokens: 0 },
              },
              toolSources,
              fileContents,
              reason: "provider_timeout",
            };
          }
          // No evidence yet — fall through and rethrow so the SSE route can
          // surface a meaningful retryable error to the user.
        }

        // EMPTY_RESPONSE: degrade gracefully rather than killing the request.
        // Typically means the context grew too large and the model had nothing
        // to emit. Surface whatever text was produced earlier. During forensic
        // synthesis, return a partial empty result instead of exhausted so the
        // chat agent can run its bounded no-tools contract-recovery attempt
        // against the completed evidence already collected.
        if (err instanceof GroqClientError && err.code === "EMPTY_RESPONSE") {
          emitExecutionDiagnostic("EXECUTION_PROVIDER_FAILURE", ["provider failure code: EMPTY_RESPONSE"]);
          if (lastTextSeen !== undefined) {
            classifyZeroReadTerminal("empty_response", iter + 1);
            try {
              onStep?.({
                kind: "done",
                iterations: iter + 1,
                maxIterations,
                ...executionCounts(),
                stopReason: "empty_response",
                synthesisStarted,
                diagnosticCodes: [],
                sourceRetrieval,
              });
            } catch { /* ignore */ }
            return { kind: "partial", result: lastTextSeen, toolSources, fileContents, sourceRetrieval, reason: "empty_response" };
          }
          // A provider can return EMPTY_RESPONSE on the turn immediately
          // after evidence collection, before the loop has emitted its
          // synthesis hint. In forensic mode the completed reads are still
          // valuable and must reach chat-agent's bounded no-tools recovery;
          // returning exhausted here would discard them and produce a
          // contract failure for an empty response.
          if (
            synthesisStarted ||
            (executionMode === "forensic" && fileContents.size > 0) ||
            (compoundWriteMode && fileContents.size > 0)
          ) {
            classifyZeroReadTerminal("empty_response", iter + 1);
            try {
              onStep?.({
                kind: "done",
                iterations: iter + 1,
                maxIterations,
                ...executionCounts(),
                stopReason: "empty_response",
                synthesisStarted,
                diagnosticCodes: [],
                sourceRetrieval,
              });
            } catch { /* ignore */ }
            return {
              kind: "partial",
              result: {
                content: "",
                toolCalls: null,
                model,
                usage: { promptTokens: 0, completionTokens: 0 },
              },
              toolSources,
              fileContents,
              sourceRetrieval,
              reason: "empty_response",
            };
          }
          classifyZeroReadTerminal("empty_response", iter + 1);
          try {
            onStep?.({
              kind: "done",
              iterations: iter + 1,
              maxIterations,
              ...executionCounts(),
              stopReason: "empty_response",
              synthesisStarted,
              diagnosticCodes: [],
              sourceRetrieval,
            });
          } catch { /* ignore */ }
          return { kind: "exhausted", toolSources, fileContents, sourceRetrieval, reason: "empty_response" };
        }

        throw err;
      }
    }

    // OR-007: Emit per-call telemetry (model used, token usage, timing, fallback).
    const observedModel = result.model || (fallbackReason ? powerModel : model);
    lastModelUsed = observedModel;
    recordProviderTelemetry({
      provider: provider as Parameters<typeof recordProviderTelemetry>[0]["provider"],
      model: observedModel,
      fallbackReason,
      attemptCount,
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      durationMs: Date.now() - t0,
    });
    try {
      onStep?.({
        kind: "model_call",
        model: result.model || (fallbackReason ? powerModel : model),
        provider,
      });
    } catch { /* ignore */ }

    // ── Track last text seen (for kind:"partial" fallback) ──────────────────
    // Save any non-empty text content the model produced this iteration,
    // even when it also requested tool calls.  If the hard limit is reached
    // before the model emits a standalone text response, we return this instead
    // of a generic error message.
    if (result.content && result.content.trim().length > 0) {
      lastTextSeen = result;
    }

    // Free-tier reasoning models can spend the entire output budget on a
    // response that is marked "length".  Treating that text as the final
    // answer leaks a truncated plan/report to the user (and often makes the
    // JSON envelope impossible to parse).  Give the same model one bounded,
    // no-tools completion pass with a larger output budget before accepting
    // the partial text.
    if (
      result.finishReason === "length" &&
      result.content?.trim() &&
      (!result.toolCalls || result.toolCalls.length === 0)
    ) {
      const truncatedContent = result.content.trim();
      const retryMaxTokens = iterMaxTokens === undefined ? undefined : iterMaxTokens * 2;
      const retryMessages = compactModelMessages([
        ...safeMessages,
        { role: "assistant", content: truncatedContent },
        {
          role: "user",
          content:
            "The previous answer was cut off by the output limit. " +
            "Return a complete final answer now, without commentary about the cutoff. " +
            "Preserve the requested response format and do not call tools.",
        },
      ]);
      try {
        const retry = await callWithExecutionBudget(retryMessages, {
          model: result.model || model,
          ...(retryMaxTokens !== undefined ? { maxTokens: retryMaxTokens } : {}),
          timeoutMs: 60_000,
          apiKey,
          ...(opts.capability ? { capability: opts.capability } : {}),
           ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.responseFormat ? { responseFormat: opts.responseFormat } : {}),
        });
        if (retry.content?.trim()) {
          result = retry;
          lastTextSeen = retry;
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "TRUNCATED_FINAL_RETRY_ACCEPTED",
              provider,
              model: retry.model || model,
              previousLength: truncatedContent.length,
              retryMaxTokens,
              finishReason: retry.finishReason ?? null,
            }),
          );
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "TRUNCATED_FINAL_RETRY_FAILED",
            provider,
            model: result.model || model,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    // ── No tool calls → final response ──────────────────────────────────────
    if (!result.toolCalls || result.toolCalls.length === 0) {
      loopPhase = "reasoning";
      // Prefetch gives the model source bodies before the first loop call, but
      // the provider client intentionally omits response_format whenever tools
      // are attached. If the model immediately decides it has enough evidence,
      // give it one explicit no-tools synthesis pass so JSON mode is actually
      // applied. Only do this for the first prefetched response, and only when
      // the response is not already a usable JSON envelope; this preserves the
      // normal read→synthesize loop and avoids a redundant provider call.
      const trimmedContent = result.content?.trim() ?? "";
      let hasJsonEnvelope = false;
      if (trimmedContent) {
        try {
          const candidate = JSON.parse(trimmedContent) as unknown;
          hasJsonEnvelope =
            typeof candidate === "object" &&
            candidate !== null &&
            typeof (candidate as { response?: unknown }).response === "string";
        } catch {
          hasJsonEnvelope = false;
        }
      }
      if (
        executionMode === "forensic" &&
        opts.responseFormat &&
        opts.initialFileContents &&
        opts.initialFileContents.size > 0 &&
        iter === 0 &&
        !prefetchedSynthesisAttempted &&
        !hasJsonEnvelope
      ) {
        prefetchedSynthesisAttempted = true;
        synthesisStarted = true;
        synthesisDeadlineAt = Date.now() + boundedSynthesisTimeoutMs;
        try {
          onStep?.({ kind: "synthesis_start", iter, maxIterations });
        } catch { /* ignore */ }

        const synthesisMessages: RawMessage[] = compactModelMessages([
          ...messages,
          {
            role: "assistant",
            content: result.content ?? "",
          },
          {
            role: "user",
            content:
              "The completed source reads are already available above. " +
              "Now produce the final forensic report as the requested JSON object. " +
              "Do not call tools and do not add facts.",
          },
        ]);
        try {
          const synthesisStartedAt = Date.now();
          const synthesisCall = await callSynthesisWithFallback(synthesisMessages, {
            model: result.model || model,
            ...(iterMaxTokens !== undefined ? { maxTokens: iterMaxTokens } : {}),
            timeoutMs: 60_000,
            apiKey,
            responseFormat: opts.responseFormat,
          });
          const synthesisResult = synthesisCall.result;
          recordProviderTelemetry({
            provider: provider as Parameters<typeof recordProviderTelemetry>[0]["provider"],
            model: synthesisResult.model || result.model || model,
            attemptCount: synthesisCall.attemptCount,
            promptTokens: synthesisResult.usage?.promptTokens ?? 0,
            completionTokens: synthesisResult.usage?.completionTokens ?? 0,
            durationMs: Date.now() - synthesisStartedAt,
          });
          try {
            onStep?.({
              kind: "model_call",
              model: synthesisResult.model || result.model || model,
              provider,
            });
          } catch { /* ignore */ }
          // A provider may ignore the no-tools request and still emit a
          // tool_calls payload. Never feed those calls back into the normal
          // execution branch: this pass exists only to format the already
          // collected evidence. Keep the original response and let the
          // forensic contract/recovery path handle it instead.
          if (synthesisResult.content?.trim()) {
            result = synthesisResult;
          }
        } catch (err) {
          // The original response remains usable as a bounded candidate. The
          // chat agent will still run its strict forensic contract/recovery
          // path, so a failed formatting pass cannot weaken evidence gates.
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "PREFETCH_SYNTHESIS_RETRY_FAILED",
              provider,
              errorCode: err instanceof GroqClientError ? err.code : "unknown",
            }),
          );
        }
      }

      if (
        compoundWriteMode &&
        compoundProposalActive &&
        pendingChanges.length === 0 &&
        !compoundProposalRetrySent
      ) {
        compoundProposalRetrySent = true;
        messages.push(
          { role: "assistant", content: result.content ?? "" },
          {
            role: "user",
            content:
              "Do not stop after describing the evidence. The requested second phase is to create a pending change now. " +
              "Call replace_text with an exact unique old_text/new_text pair, or write_file for a new file. " +
              "Do not read, search, validate, or apply changes.",
          },
        );
        continue;
      }

      currentIteration = iter + 1;
      classifyZeroReadTerminal("response", currentIteration);
      const incompleteReason =
        (objective && forceSynthesisNext && noProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD
          ? "no_progress" as const
          : objective && requiresEvidence && evidenceRouteAvailable && firstSourceReadIter === null
          ? "evidence_incomplete" as const
          : objectiveIncompleteReason());
      if (incompleteReason) {
        return incompleteResult(incompleteReason, result);
      }
      try {
        onStep?.({
          kind: "done",
          iterations: iter + 1,
          maxIterations,
          ...executionCounts(),
          stopReason: "response",
          synthesisStarted,
            synthesisAttempts,
            synthesisMaxAttempts: boundedSynthesisMaxAttempts,
            synthesisTimeoutMs: boundedSynthesisTimeoutMs,
            ...(sourceRetrieval.synthesisElapsedMs !== undefined
              ? { synthesisElapsedMs: sourceRetrieval.synthesisElapsedMs }
              : {}),
            ...(synthesisTimedOut ? { synthesisTimedOut: true } : {}),
          diagnosticCodes: [],
          sourceRetrieval,
        });
      } catch { /* ignore */ }
      return {
        kind: "response",
        result,
        toolSources,
        fileContents,
        sourceRetrieval,
        ...(buildObjectiveState(objective ? "goal_met" : undefined)
          ? { objectiveState: buildObjectiveState(objective ? "goal_met" : undefined) }
          : {}),
      };
    }

    // Some providers still emit tool_calls after the tool schema has been
    // removed for the synthesis phase. Do not append synthetic tool results
    // and spend another iteration on an impossible tool exchange: synthesis
    // must be terminal. Preserve any usable text. When there is no text,
    // return a recoverable empty partial so the forensic caller can run its
    // bounded no-tools contract-recovery pass against the evidence already
    // collected instead of discarding it behind a generic fallback.
    if (synthesisOnly) {
      const terminalResult: RawGroqResponse = { ...result, toolCalls: null };
      loopPhase = "reasoning";
      currentIteration = iter + 1;
      classifyZeroReadTerminal("synthesis", currentIteration);
      const incompleteReason =
        (objective && forceSynthesisNext && noProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD
          ? "no_progress" as const
          : objective && requiresEvidence && evidenceRouteAvailable && firstSourceReadIter === null
          ? "evidence_incomplete" as const
          : objectiveIncompleteReason());
      if (incompleteReason) {
        return incompleteResult(incompleteReason, terminalResult);
      }
      try {
        onStep?.({
          kind: "done",
          iterations: iter + 1,
          maxIterations,
            ...executionCounts(),
          stopReason: result.content?.trim() ? "response" : "empty_response",
          synthesisStarted,
          diagnosticCodes: [],
          sourceRetrieval,
        });
      } catch { /* ignore */ }
      if (result.content?.trim()) {
        return {
          kind: "response",
          result: terminalResult,
          toolSources,
          fileContents,
          sourceRetrieval,
          ...(buildObjectiveState(objective ? "goal_met" : undefined)
            ? { objectiveState: buildObjectiveState(objective ? "goal_met" : undefined) }
            : {}),
        };
      }
      return {
        kind: "partial",
        result: {
          content: "",
          toolCalls: null,
          model,
          usage: result.usage,
        },
        toolSources,
        fileContents,
        sourceRetrieval,
        reason: "empty_response",
      };
    }

    // ── Append assistant turn with tool_calls ────────────────────────────────
    // Defensive belt: `function.arguments` MUST be a stringified JSON object
    // when replayed to strict providers (Cohere via OpenRouter returns 400
    // "tool arguments must be a stringified JSON object" otherwise). Clients
    // normalize at ingestion, but any path that bypasses that (native Groq,
    // future providers) is caught here before the message enters history.
    const safeToolCalls = result.toolCalls.map((tc) => {
      const raw: unknown = tc.function?.arguments;
      if (typeof raw === "string" && raw.trim() !== "") {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return tc;
        } catch { /* fall through to repair */ }
      }
      const repaired =
        raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? JSON.stringify(raw)
          : "{}";
      return { ...tc, function: { ...tc.function, arguments: repaired } };
    });

    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: safeToolCalls,
    });

    // ── Dispatch each requested tool call ───────────────
    // A provider may batch a cached forensic read with more exploration. Once
    // replayed evidence is detected, do not execute the remainder of that
    // batch; preserve the tool-message protocol and synthesize on the next
    // iteration instead.
    let forensicBatchStopped = false;
    loopPhase = "evidence";
    for (const tc of safeToolCalls) {
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, string>;
      } catch {
        // Malformed arguments — leave args empty; handler returns an error string.
      }

      const isValidationCall = tc.function.name === "run_validation";
      const validationProfile = isValidationCall ? args.profile?.trim() : undefined;
      const validationAttempt = isValidationCall
        ? (validationAttempts.get(validationProfile ?? "") ?? 0) + 1
        : undefined;
      if (isValidationCall) {
        validationAttempts.set(validationProfile ?? "", validationAttempt!);
      }
      const validationFingerprint = isValidationCall
        ? pendingChangesFingerprint(pendingChanges)
        : undefined;
      const pendingChangesBeforeTool = pendingChanges.length;
      // Validation is intentionally not replay-cached: after a pending patch,
      // the same profile must execute again against the new workspace state.
      const key = isValidationCall
        ? `${toolCacheKey(tc.function.name, args)}::attempt:${validationAttempt}`
        : toolCacheKey(tc.function.name, args);
      const cached = toolCallCache.get(key);

      if (synthesisOnly) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Synthesis phase is active. No further tools may run. " +
            "Produce the final answer from the evidence already gathered.",
        });
        continue;
      }

      if (forensicBatchStopped) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Forensic collection stopped. This batched tool call was not executed after cached evidence was detected. " +
            "Synthesize from the completed reads already gathered.",
        });
        continue;
      }

      if (isValidationCall && validationAttempt! > boundedMaxValidationAttempts) {
        const blockedOutput = JSON.stringify({
          tool: tc.function.name,
          status: "blocked",
          profile: validationProfile,
          attempt: validationAttempt,
          maxAttempts: boundedMaxValidationAttempts,
          code: "VALIDATION_ATTEMPT_LIMIT_REACHED",
          detail:
            `Validation attempt limit reached for "${validationProfile || "the selected profile"}". ` +
            "Stop repairing and return BLOCKED; no further validation will run in this handoff.",
        });
        messages.push({ role: "tool", tool_call_id: tc.id, content: blockedOutput });
        try {
          onStep?.({
            kind: "validation",
            result: syntheticValidationResult(
              validationProfile ?? "",
              "Validation attempt limit reached; execution is blocked.",
            ),
            repairState: "BLOCKED",
            attempt: validationAttempt!,
            maxAttempts: boundedMaxValidationAttempts,
            status: "blocked",
            profile: validationProfile,
            detail: "Validation attempt limit reached; execution is blocked.",
          });
          onStep?.({
            kind: "repair_state",
            state: "BLOCKED",
            detail: "Validation attempt limit reached; execution is blocked.",
          });
        } catch { /* ignore */ }
        continue;
      }

      if (
        executionMode === "repair_plan"
        &&
        isValidationCall
        && validationAttempt! > 1
        && validationFingerprint
        && failedValidationFingerprints.get(validationProfile ?? "") === validationFingerprint
      ) {
        const detail =
          "Validation was not rerun because the pending changes are identical to the last failed attempt. " +
          "Make a bounded patch change or return BLOCKED; repeated validation without progress is incomplete.";
        const blockedOutput = JSON.stringify({
          tool: tc.function.name,
          status: "blocked",
          repairState: "BLOCKED",
          profile: validationProfile,
          attempt: validationAttempt,
          maxAttempts: boundedMaxValidationAttempts,
          code: "VALIDATION_NO_PROGRESS",
          detail,
        });
        messages.push({ role: "tool", tool_call_id: tc.id, content: blockedOutput });
        try {
          onStep?.({
            kind: "validation",
            result: syntheticValidationResult(validationProfile ?? "", detail),
            repairState: "BLOCKED",
            attempt: validationAttempt!,
            maxAttempts: boundedMaxValidationAttempts,
            status: "blocked",
            profile: validationProfile,
            detail,
          });
          onStep?.({ kind: "repair_state", state: "BLOCKED", detail });
        } catch { /* ignore */ }
        continue;
      }

      // ── Persistent forced-evidence gate (FEG-008) ───────────────────────────
      // Once two consecutive NO_PROGRESS planning iterations trip the guard, the
      // loop stays in forced-evidence mode and ENFORCES it here at dispatch:
      // the only permitted forward action is the primary source read (or, when
      // no explicit target was named, any source read). Anything else — further
      // planning, git operations, further searches — is rejected inline rather
      // than merely withheld from the provider's tool list, so a planner cannot
      // resume orbiting around the evidence requirement. The state clears when a
      // forced-target read lands or the model synthesizes.
      // Build-mode validation is server-authorized execution evidence, not a
      // substitute for forensic source reads. It must still be allowed to run
      // when the read-only FEG is active so a repair attempt cannot consume a
      // retry slot without actually testing the pending workspace state.
      if (
        forcedEvidenceActive &&
        !isValidationCall &&
        !isForcedTargetRead(tc.function.name, typeof args.path === "string" ? args.path : undefined)
      ) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            (fegTarget
              ? `Forced-evidence mode: only a read of the primary evidence target \`${fegTarget}\` is permitted now. ` +
                "Gather that source evidence, then synthesize."
              : "Forced-evidence mode: a source read is required now. " +
                "Read the relevant file to make progress, then synthesize.") +
            " No other tool may run until the required read completes.",
        });
        continue;
      }

      if (phase && !isToolAllowedInPhase(phase, tc.function.name)) {
        const rejectedTool = tc.function.name.slice(0, 120);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            `Tool "${tc.function.name}" is not allowed during the ${phase} phase. ` +
            "Wait for the server to advance the execution phase.",
        });
        try {
          onStep?.({
            kind: "diagnostic",
            code: "EXECUTION_PHASE_TOOL_REJECTED",
            details: [`${rejectedTool} is not allowed in ${phase}`],
            phase,
            tool: rejectedTool,
          });
        } catch { /* observers must not change execution semantics */ }
        continue;
      }

      if (allowedTools && !allowedTools.has(tc.function.name)) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            `Tool "${tc.function.name}" is blocked by the active forensic tool policy. ` +
            "Use only the tools listed in the effective manifest.",
        });
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "TOOL_POLICY_BLOCKED",
            tool: tc.function.name,
          }),
        );
        continue;
      }

      if (
        objectiveScopePolicy &&
        (tc.function.name === "read_file" ||
          tc.function.name === "read_file_range" ||
          tc.function.name === "list_directory")
      ) {
        const requestedPath =
          typeof args.path === "string" && args.path.trim() ? args.path : ".";
        const expansion = recordScopeExpansion(requestedPath);
        if (expansion?.kind === "JUSTIFIED_SCOPE_EXPANSION") {
          try {
            onStep?.({
              kind: "diagnostic",
              code: "JUSTIFIED_SCOPE_EXPANSION",
              details: [
                `objective evidence scope expanded to ${expansion.path}`,
                ...(expansion.matchedPolicyPath ? [`policy path: ${expansion.matchedPolicyPath}`] : []),
              ],
            });
          } catch { /* ignore */ }
        } else if (expansion?.kind === "UNJUSTIFIED_SCOPE_EXPANSION") {
          try {
            onStep?.({
              kind: "diagnostic",
              code: "UNJUSTIFIED_SCOPE_EXPANSION",
              details: [
                `blocked objective evidence read outside declared scope: ${expansion.path}`,
              ],
            });
          } catch { /* ignore */ }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              `UNJUSTIFIED_SCOPE_EXPANSION: \`${normalizeObjectivePath(requestedPath)}\` is outside the ` +
              "declared objective scope. Read the primary target or provide an explicitly allowed " +
              "caller/route/consumer path instead.",
          });
          continue;
        }
      }

      if (
        allowedReads &&
        tc.function.name === "read_file" &&
        (typeof args.path !== "string" ||
          !allowedReads.has(args.path.replaceAll("\\", "/").replace(/^(\.\/)+/, "")))
      ) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "This isolated forensic test permits read_file only for the explicitly named target file.",
        });
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "READ_PATH_POLICY_BLOCKED",
            requestedPath: typeof args.path === "string" ? args.path : null,
            allowedReadPaths: [...allowedReads],
          }),
        );
        continue;
      }

      if (orderedRoots.length > 0 && (tc.function.name === "read_file" || tc.function.name === "list_directory")) {
        const requestedPath = typeof args.path === "string" && args.path.trim() ? args.path : ".";
        const requestedRoot = rootIndexForPath(requestedPath);
        if (requestedRoot < 0) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              "This ordered forensic audit permits source access only inside the requested roots: " +
              orderedRoots.map((root) => `\`${root}\``).join(", "),
          });
          console.warn(JSON.stringify({
            scope: "tool-execution-engine",
            code: "ORDERED_FORENSIC_ROOT_BLOCKED",
            tool: tc.function.name,
            requestedPath,
            orderedRoots,
          }));
          continue;
        }
        if (highestOrderedRoot < 0) {
          if (requestedRoot !== 0) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content:
                `Read the first ordered source root \`${orderedRoots[0]}\` before moving to later roots.`,
            });
            continue;
          }
          highestOrderedRoot = 0;
        } else if (requestedRoot < highestOrderedRoot) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              "This ordered forensic audit cannot return to an earlier source root after a later root has started.",
          });
          continue;
        } else if (requestedRoot > highestOrderedRoot) {
          highestOrderedRoot = requestedRoot;
        }
      }

      // Dependency-First traversal (FEG-005/006): once the FIRST source read
      // has landed, a subsequent read of a NEW dependency file must carry proof
      // of why it is required — which already-read file references it
      // (from_file), which symbol/function within it references it
      // (from_symbol), the exact reference line (reference), and why this
      // dependency must be read now (why_required). The first read is never
      // gated — this gate only fires for reads AFTER the first — and the
      // primary evidence target (fegTarget) is always the needed first read so
      // it is exempt. An unproven dependency read is BLOCKED here and surfaced
      // to the model, never silently executed or ignored, so a planner cannot
      // fan out into an unjustified dependency read chain.
      if (
        requireDependencyProof &&
        firstSourceReadIter !== null &&
        (tc.function.name === "read_file" || tc.function.name === "read_file_range")
      ) {
        const depPath =
          typeof args.path === "string" && args.path.trim()
            ? canonicalRel(args.path)
            : "";
        const rawPath = typeof args.path === "string" ? args.path : "";
        const alreadyRead =
          depPath !== "" && (readStatusByPath.has(depPath) || readStatusByPath.has(rawPath));
        const isPrimaryTarget = fegTarget !== null && depPath !== "" && depPath === fegTarget;
        // A dependency proof is only valid when it is grounded in EVIDENCE this
        // run actually acquired — not when the model supplies four arbitrary
        // strings. It requires:
        //   1. from_file (canonicalized) is a SUCCESSFUL source read this run
        //      (READ_COMPLETE / READ_TARGETED recorded in readStatusByPath, or a
        //      retained source body exists), never a fabricated/unread path.
        //   2. reference is a non-empty line/span that ACTUALLY occurs inside
        //      that retained body — the cited dependency is demonstrably named
        //      by the already-read source, so the read is justified by acquired
        //      evidence rather than claimed.
        // from_symbol and why_required must also be non-empty so the proof
        // names which symbol and why, but only (1) and (2) are evidence-bound.
        const fromFile =
          typeof args.from_file === "string" ? args.from_file.trim() : "";
        const reference =
          typeof args.reference === "string" ? args.reference.trim() : "";
        const fromSymbol =
          typeof args.from_symbol === "string" ? args.from_symbol.trim() : "";
        const whyRequired =
          typeof args.why_required === "string" ? args.why_required.trim() : "";
        let evidenceGrounded = false;
        if (fromFile && reference && fromSymbol && whyRequired) {
          const fromRel = canonicalRel(fromFile);
          const fromStatus =
            readStatusByPath.get(fromRel) ?? readStatusByPath.get(fromFile);
          const fromSuccessful =
            fromStatus === "READ_COMPLETE" || fromStatus === "READ_TARGETED";
          const retainedBody =
            sourceEvidenceByCanonical.get(fromRel) ??
            sourceEvidenceByCanonical.get(canonicalRel(rawPath)) ??
            sourceEvidenceByCanonical.get(fromFile);
          // reference must appear in the retained evidence of from_file (after
          // normalizing line endings and trimming), proving the dependency is
          // named by an already-read source.
          const referenceOccurs =
            retainedBody !== undefined &&
            retainedBody.replace(/\r\n/g, "\n").includes(reference.replace(/\r\n/g, "\n"));
          evidenceGrounded = fromSuccessful && referenceOccurs;
        }
        if (!evidenceGrounded && !alreadyRead && !isPrimaryTarget && depPath !== "") {
          try {
            onStep?.({
              kind: "diagnostic",
              code: "READ_BLOCKED_NO_DEPENDENCY_PROOF",
              details: [
                `read blocked for "${depPath}" after first source read (dependency proof not grounded in acquired evidence)`,
              ],
            });
          } catch { /* ignore */ }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content:
              `READ_BLOCKED_NO_DEPENDENCY_PROOF: reading \`${depPath}\` after the first source read ` +
              "requires evidence-grounded dependency proof. Set from_file to a file you have ALREADY " +
              "read successfully this run, from_symbol to the caller/import/function reference inside it, " +
              "reference to the EXACT import/call line present in that file's content, and why_required to " +
              "why this dependency must be read now. The reference must match text in the already-read " +
              "file; fabricated or unread provenance is rejected.",
          });
          continue;
        }
      }

      if (
        executionMode === "forensic" &&
        !allowTestSources &&
        tc.function.name === "read_file" &&
        typeof args.path === "string" &&
        isForensicTestSourcePath(args.path)
      ) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Production forensic audits exclude test/spec/fixture sources. Read an implementation source file instead.",
        });
        continue;
      }

      // The provider should not be able to bypass the narrowed Repair Plan
      // tool list by replaying a stale read_file call after all executable
      // targets were prefetched. Return a clear tool result so it can advance
      // to replace_text/write_file instead of receiving another copy of the
      // same file.
      if (
        executionMode === "repair_plan" &&
        tc.function.name === "read_file" &&
        !iterationTools?.some((tool) => tool.function.name === "read_file")
      ) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "read_file is unavailable because every executable Repair Plan target is already loaded. " +
            "Call replace_text with an exact unique old_text/new_text pair, or write_file only for a new file.",
        });
        continue;
      }

      if (
        (compoundProposalActive || pendingChanges.length > 0) &&
        tc.function.name !== "write_file" &&
        tc.function.name !== "replace_text" &&
        !(executionMode === "repair_plan" && isValidationCall)
      ) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "The evidence phase is complete and the pending proposal phase is active. " +
            "Gathering tools are unavailable now; " +
            "create the requested pending proposal with replace_text or write_file. " +
            "Changes are not applied to disk.",
        });
        continue;
      }

      if (
        searchBudgetEnabled &&
        tc.function.name === "search_code" &&
        searchBudgetExhausted
      ) {
        forceSynthesisNext = true;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "SEARCH_BUDGET_EXHAUSTED: recent search_code calls did not produce unseen results. " +
            "search_code is unavailable now; use read_file on the matching source locations or synthesize from the confirmed evidence.",
        });
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "SEARCH_NOVELTY_BUDGET_EXHAUSTED",
            budgetLimit: searchBudgetLimit,
            distinctResultCount: searchResultHashes.size,
          }),
        );
        continue;
      }

      // SR-002/SR-007: A repeated full read of a file that was already read as
      // TRUNCATED must not be allowed to repeat the same full request. The
      // previous read returned a window cap marker, not complete source, and a
      // second identical full read cannot recover the missing lines. Route to a
      // targeted range read instead. This also blocks the cached-truncated
      // replay path (the cache would re-serve the exact capped body).
      if (
        tc.function.name === "read_file" &&
        isTruncatedPath(args.path)
      ) {
        sourceRetrieval.redundantReads += 1;
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "REDUNDANT_FULL_READ_BLOCKED",
            tool: tc.function.name,
            path: args.path,
            iter,
            reason: "file previously read as READ_TRUNCATED",
          }),
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            `REDUNDANT_FULL_READ_BLOCKED: "${args.path}" was already read and exceeded the safe evidence window. ` +
            "Repeating the same full read cannot recover the missing lines. " +
            "Use search_code to locate the exact symbol or line, then read_file_range(path, startLine, endLine) to retrieve only the required window.",
        });
        continue;
      }

      // Guard 1: Cache hit — identical call, return cached result for free.
      if (cached !== undefined) {
        const duplicateCount = (duplicateCallCounts.get(key) ?? 0) + 1;
        duplicateCallCounts.set(key, duplicateCount);
        const searchBudgetState =
          tc.function.name === "search_code" && searchBudgetEnabled
            ? registerSearchResult(cached)
            : undefined;
        // A cached/replayed search or listing still consumes a model turn, so
        // it is a planning iteration in the FEG-008 sense — but it only counts
        // as PROGRESS when the replayed result is usable AND novel (the same
        // usable+novel predicate the fresh path uses). An identical cached
        // repeat of a result already surfaced this run, or a cached empty/Error
        // result, is NO_PROGRESS: otherwise a planner sidesteps the forced
        // evidence gate purely by re-issuing cached gather calls. The separate
        // search-duplicate escalation ladder (guidance → hidden → synthesis)
        // still runs independently on top of this progress accounting.
        if (tc.function.name === "search_code") {
          iterationIssuedToolCalls = true;
          if (firstSourceReadIter === null) {
            sourceRetrieval.crossFileQueriesBeforeFirstRead += 1;
          }
          // OR-accumulate: a later duplicate in the same turn must not erase an
          // earlier novel call's progress.
          iterationNewSearch = isNovelGatherResult(cached) || iterationNewSearch;
        }
        if (tc.function.name === "list_directory") {
          iterationIssuedToolCalls = true;
          if (firstSourceReadIter === null) {
            sourceRetrieval.crossFileQueriesBeforeFirstRead += 1;
          }
          iterationListDir = isNovelGatherResult(cached) || iterationListDir;
        }

        if (
          executionMode === "forensic" &&
          ["list_directory", "search_code"].includes(tc.function.name)
        ) {
          // A repeated source read is safe to replay from the request cache.
          // Keep the loop alive so the model can continue with the evidence it
          // just received; only exploratory repeats force synthesis.
          forceSynthesisNext = true;
          forensicBatchStopped = true;
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "FORENSIC_CACHED_READ_GUARD",
              tool: tc.function.name,
              iter,
              duplicateCount,
            }),
          );
        }

        if (executionMode === "repair_plan" && duplicateCount > REPAIR_PLAN_DUPLICATE_TOOL_LIMIT) {
          const message =
            `Repeated identical tool call detected for "${tc.function.name}". ` +
            "Execution stopped before another duplicate read. " +
            "Move to replace_text/write_file using the evidence already gathered, or return a final response.";
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "REPEATED_TOOL_CALL_GUARD",
              tool: tc.function.name,
              iter,
              duplicateCount,
              limit: REPAIR_PLAN_DUPLICATE_TOOL_LIMIT,
            }),
          );
          try {
            onStep?.({
              kind: "execution_guard",
              code: "REPEATED_TOOL_CALL",
              tool: tc.function.name,
              message,
            });
          } catch { /* ignore */ }
          classifyZeroReadTerminal("repeated_tool_call", iter + 1);
          try {
            onStep?.({
              kind: "done",
              iterations: iter + 1,
              maxIterations,
              ...executionCounts(),
              stopReason: "repeated_tool_call",
              synthesisStarted,
              diagnosticCodes: [],
              sourceRetrieval,
            });
          } catch { /* ignore */ }
          return {
            kind: "stopped",
            toolSources,
            fileContents,
            sourceRetrieval,
            reason: "repeated_tool_call",
            tool: tc.function.name,
            iterations: iter + 1,
          };
        }

        loopToolCalls++;
        // A cached/replayed call is still a planning iteration in the FEG-008
        // sense: it consumed a model turn. Only a call that actually surfaces
        // new evidence (a read, a novel search hit, or a directory listing)
        // counts as progress; an identical repeat is NO_PROGRESS.
        iterationIssuedToolCalls = true;
        if (tc.function.name === "read_file" || tc.function.name === "read_file_range") {
          sourceRetrieval.cachedReads += 1;
          const pathForRead = typeof args.path === "string" ? args.path : undefined;
          // A cached READ of a path whose COMPLETED evidence is already in hand
          // is a repeat, not NEW evidence. Only the FIRST completed read of a
          // path — even from the cache (e.g. a prefetched target, or a usable
          // window after a prior truncated/failed full read) — counts as
          // progress for FEG-008, so repeated cached reads can't reset the
          // no-progress streak. A failed/malformed cached read is NOT source
          // evidence and does not clear the forced-evidence state. Judged by
          // completed-evidence status (isCompletedPath), never mere attempt
          // (map.has), so a truncated-recovery window is a real acquisition.
          const alreadyRead = isCompletedPath(pathForRead);
          if (isSuccessfulSourceRead(tc.function.name, pathForRead, cached)) {
            // A permitted cached read that satisfies the mandate clears the
            // persistent force (the required source evidenced on this path is
            // already in hand), regardless of whether it is the first read.
            // Re-arm the one-run fire latch exactly like the fresh-read path so
            // a LATER no-progress streak (after this cache-hit clear) re-enters
            // dispatch-enforced forced mode instead of orbiting. When this cached
            // read is what satisfies the force, the iteration counts as a
            // progress boundary (clearingActiveForce → iterationNewRead), so the
            // controller resets the no-progress streak to zero and the force
            // does not re-fire on the immediately following call: a fresh pair
            // of NO_PROGRESS iterations is required to re-force.
            const clearingActiveForce = forcedEvidenceActive;
            forcedEvidenceActive = false;
            forcedPrimaryEvidence = false;
            if (clearingActiveForce) iterationNewRead = true;
            if (!alreadyRead) {
              iterationNewRead = true;
              if (firstSourceReadIter === null) {
                firstSourceReadIter = iter;
                sourceRetrieval.iterationsUntilFirstSourceRead = iter;
                sourceRetrieval.iterationsUntilFirstRead = iter;
                sourceRetrieval.firstEvidenceAcquired = true;
                sourceRetrieval.iterationsWithoutEvidence = iter;
              }
            }
          }
          recordRead(tc.function.name, args.path, cached);
          recordSourceEvidence(args.path, cached);
          if (compoundWriteMode && fileContents.size > 0) {
            compoundProposalActive = true;
          }
        }
        try { onStep?.({ kind: "tool_call", tool: tc.function.name, args, cached: true }); } catch { /* ignore */ }
        // Preserve the same source label as a fresh read. Persisted traces use
        // this label to pair cached tool results with their requested file;
        // omitting it makes the UI misclassify a valid cached read as
        // "incomplete" after the session is reloaded.
        const cachedSource =
          tc.function.name === "read_file" && typeof args.path === "string" && args.path.trim()
            ? args.path
            : undefined;
        try {
          onStep?.({
            kind: "tool_result",
            tool: tc.function.name,
            source: cachedSource,
            cached: true,
            outputLength: cached.length,
           ...(tc.function.name === "run_command"
             ? { commandStatus: parseCommandStatus(cached) }
             : {}),
            ...((tc.function.name === "read_file" || tc.function.name === "read_file_range")
              ? { resultSummary: `Read completed (${cached.length} characters).` }
              : {}),
          });
        } catch { /* ignore */ }
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "DUPLICATE_TOOL_CALL",
            tool: tc.function.name,
            iter,
            ...(searchBudgetState
              ? {
                  searchBudgetRemaining: searchBudgetState.remaining,
                  searchResultNew: searchBudgetState.isNew,
                }
              : {}),
          }),
        );
        // Every cached duplicate is a behavioral failure sample, not only
        // repeated search_code calls. A Set in the scorecard keeps multiple
        // duplicate tool calls in one model turn from inflating its rate.
        recordBehavioralFailure(result.model || lastModelUsed || model, "loop");
        const generalDuplicateEscalation = executionMode !== "repair_plan";
        if (generalDuplicateEscalation && duplicateCount >= 2) {
          temporarilyDisabledTools.add(tc.function.name);
        }
        if (generalDuplicateEscalation && duplicateCount >= 3) {
          forceSynthesisNext = true;
        }
        const searchDuplicate =
          tc.function.name === "search_code" && duplicateCount > 0;
        if (searchDuplicate && duplicateCount >= 2) {
          temporarilyDisabledTools.add("search_code");
        }
        if (searchDuplicate && duplicateCount >= 3) {
          forceSynthesisNext = true;
        }
        if (searchDuplicate) {
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "DUPLICATE_SEARCH_ESCALATION",
              rung: Math.min(duplicateCount, 3),
              duplicateCount,
              nextTurn:
                duplicateCount >= 3
                  ? "synthesis_only"
                  : duplicateCount >= 2
                    ? "search_hidden"
                    : "guided_retry",
            }),
          );
        }
        if (generalDuplicateEscalation && duplicateCount >= 2 && !searchDuplicate) {
          console.warn(
            JSON.stringify({
              scope: "tool-execution-engine",
              code: "DUPLICATE_TOOL_ESCALATION",
              tool: tc.function.name,
              duplicateCount,
              nextTurn: duplicateCount >= 3 ? "synthesis_only" : "tool_hidden",
            }),
          );
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            untrustedToolOutput(
              tc.function.name,
              duplicateCount >= REPAIR_PLAN_DUPLICATE_TOOL_LIMIT && executionMode === "repair_plan"
              ? `[cached — identical call already executed this request]\n${cached}\n\n` +
                "EXECUTION GUARD: Do not call this same tool with the same arguments again. " +
                "For a Repair Plan, call replace_text/write_file now if the evidence is sufficient, or return a final response."
              : `[cached — identical call already executed this request]\n${cached}` +
                (searchDuplicate
                  ? `\n\n${duplicateSearchGuidance(args, cached, duplicateCount)}`
                  : duplicateCount >= 3
                    ? "\n\nDUPLICATE_TOOL_ESCALATION: stop repeating this exact tool call and synthesize from the evidence already gathered."
                    : duplicateCount >= 2
                      ? "\n\nDUPLICATE_TOOL_ESCALATION: this tool will be hidden on the next turn; use another tool or synthesize."
                  : ""),
              args,
            ),
        });
        if (
          tc.function.name === "read_file" &&
          typeof args.path === "string" &&
          args.path.trim() &&
          isUsableReadOutput(cached)
        ) {
          fileContents.set(args.path, cached);
        }
        emitReadEvidenceLinked(tc.function.name, args.path, result.content, cached);
        if (searchDuplicate && duplicateCount >= 3) {
          messages.push({
            role: "user",
            content: duplicateSearchSynthesisSummary(args, cached, toolSources, fileContents),
          });
        }
        continue;
      }

      // Guard 2: Budget exhausted for fresh calls.
      if (totalToolCalls >= maxToolCalls) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "TOOL_CALL_LIMIT_REACHED",
            tool: tc.function.name,
            iter,
            totalToolCalls,
          }),
        );
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Tool call budget exhausted for this request. " +
            "Synthesize your answer from the information already gathered — do not call further tools.",
        });
        continue;
      }

      // Guard 3: Registry check + dispatch via executeSingleTool.
      loopToolCalls++;
      try {
        // Include the model's preceding text as reasoning for read/write tool
        // calls. Cached calls are skipped — a cache hit is not a new model
        // decision and therefore carries no new reasoning. Truncate to 500
        // characters so the persisted trace remains bounded.
        const REASONING_TOOLS = new Set([
          "read_file", "read_file_range", "search_code", "list_directory",
          "write_file", "replace_text",
        ]);
        const rawReasoning = result.content?.trim();
        onStep?.({
          kind: "tool_call",
          tool: tc.function.name,
          args,
          cached: false,
          reasoning: REASONING_TOOLS.has(tc.function.name) && rawReasoning
            ? rawReasoning.slice(0, 500)
            : undefined,
        });
      } catch { /* ignore */ }
      if (isValidationCall) {
        try {
          onStep?.({
            kind: "repair_state",
            state: "VALIDATING",
            detail: validationProfile
              ? `Running registered validation profile "${validationProfile}".`
              : "Running registered validation.",
          });
        } catch { /* ignore */ }
      }
      if (isValidationCall && executionMode === "repair_plan") {
        const currentPatch = snapshotPendingChanges(pendingChanges);
        const previousPatch = validationAttemptPatches.get(validationProfile ?? "");
        if (validationAttempt! > 1 && previousPatch) {
          const diff = buildRepairAttemptDiff(previousPatch, currentPatch);
          if (diff) {
            emitExecutionDiagnostic("REPAIR_ATTEMPT_DIFF", [
              `attempt ${validationAttempt!} vs ${validationAttempt! - 1}`,
              diff,
            ]);
          }
        }
        // Save only the patch that is actually about to be validated. A
        // blocked no-progress attempt above must not become the baseline for
        // a later repair attempt.
        validationAttemptPatches.set(validationProfile ?? "", currentPatch);
      }
      const toolResult = await executeSingleTool({
        name: tc.function.name,
        args,
        rootPath,
        pendingChanges,
        completeReads: opts.completeReads,
        allowExecutionTools,
        validationRunner,
        browserValidationRunner,
        browserValidationContext,
         commandProfiles,
         commandRunner,
         commandContext,
        validationTargetPaths,
        approvalState,
        approvedFilePaths,
        approvedValidationProfiles,
        allowedToolNames: allowedToolNames ? new Set(allowedToolNames) : undefined,
        analysisToolRunner: opts.analysisToolRunner,
        analysisCorrelation: opts.analysisCorrelation,
        analysisDeadlineAt: executionLedger?.deadlineAt,
        signal,
      });

      if (toolResult.kind === "unknown_tool") {
        console.error(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "UNKNOWN_TOOL",
            tool: tc.function.name,
            iter,
            knownGit: [...GIT_TOOL_NAMES],
            knownFile: [...FILE_TOOL_NAMES],
            knownExecution: [...EXECUTION_TOOL_NAMES],
          }),
        );
        messages.push({ role: "tool", tool_call_id: tc.id, content: "The requested tool is not available. The operation did not complete." });
        return failedToolResult(
          tc.function.name,
          "unavailable",
          "TOOL_UNAVAILABLE",
          "The requested tool is not available. The operation did not complete.",
        );
      }

      if (toolResult.kind === "failed") {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `${toolResult.safeMessage} Diagnostic code: ${toolResult.diagnosticCode}.`,
        });
        return failedToolResult(
          tc.function.name,
          toolResult.failureKind,
          toolResult.diagnosticCode,
          toolResult.safeMessage,
          toolResult.analysisFailureCategory,
        );
      }

      // A compound inspect → fix request has one proposal phase. Once the
      // server has accepted an edit into pendingChanges, stop the model from
      // replaying the same edit from the cache on later iterations. The
      // proposal is already durable and reviewable; the next turn is only for
      // a bounded final response.
      if (
        compoundWriteMode &&
        pendingChangesBeforeTool > 0 &&
        (tc.function.name === "write_file" || tc.function.name === "replace_text")
      ) {
        forceSynthesisNext = true;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "A pending proposal already exists for this compound request. " +
            "Do not create another edit; summarize the pending change without calling tools.",
        });
        continue;
      }

      // Successful execution — consume budget, cache, record source.
      totalToolCalls++;
      toolCallCache.set(key, toolResult.output);
      const searchBudgetState =
        tc.function.name === "search_code" && searchBudgetEnabled
          ? registerSearchResult(toolResult.output)
          : undefined;
      if (searchBudgetState) {
        console.warn(
          JSON.stringify({
            scope: "tool-execution-engine",
            code: "SEARCH_NOVELTY_BUDGET_UPDATE",
            budgetLimit: searchBudgetLimit,
            searchBudgetRemaining: searchBudgetState.remaining,
            searchResultNew: searchBudgetState.isNew,
            distinctResultCount: searchResultHashes.size,
          }),
        );
      }
      iterationIssuedToolCalls = true;
      if (isValidationCall) {
        let validation: ValidationResult | undefined;
        try {
          const parsed = JSON.parse(toolResult.output) as Partial<ValidationResult>;
          if (
            parsed
            && typeof parsed === "object"
            && typeof parsed.status === "string"
            && typeof parsed.profile === "string"
            && parsed.evidence
            && typeof parsed.evidence.evidenceId === "string"
          ) {
            validation = parsed as ValidationResult;
          }
        } catch { /* keep the bounded unavailable fallback below */ }
        if (!validation) {
          const evidenceId = randomUUID();
          validation = {
            profile: validationProfile ?? "",
            status: "unavailable",
            scenario: "Validation returned an unreadable result.",
            exitCode: null,
            command: "",
            stdout: "",
            stderr: "",
            failedTests: [],
            changedFiles: [],
            evidence: {
              evidenceId,
              observedAt: new Date().toISOString(),
              artifactRef: `validation-attempt:${evidenceId}`,
            },
            detail: "Validation returned an unreadable result.",
          };
        }
        const repairState: RepairLoopState =
          validation.status === "passed"
            ? "READY_FOR_REVIEW"
            : validation.status === "failed" && validationAttempt! < boundedMaxValidationAttempts
              ? "REPAIRING"
              : "BLOCKED";
        try {
          onStep?.({
            kind: "validation",
            result: validation,
            repairState,
            attempt: validationAttempt!,
            maxAttempts: boundedMaxValidationAttempts,
            status: validation.status,
            profile: validation.profile,
            scenario: validation.scenario,
            command: validation.command,
            exitCode: validation.exitCode,
            failedTests: validation.failedTests.map((failure) => failure.name || failure.message),
            affectedFiles: validation.changedFiles,
            failedTestDetails: validation.failedTests,
            changedFiles: validation.changedFiles,
            detail: validation.detail,
          });
          onStep?.({
            kind: "repair_state",
            state: repairState,
            detail: repairState === "REPAIRING"
              ? "Validation failed; bounded repair correction is still allowed."
              : repairState === "READY_FOR_REVIEW"
                ? "Validation passed; pending changes are ready for review."
                : "Validation did not produce an approved repair state.",
          });
        } catch { /* ignore */ }
        if (repairState === "REPAIRING") {
          if (executionMode === "repair_plan" && validationFingerprint) {
            failedValidationFingerprints.set(validationProfile ?? "", validationFingerprint);
          }
          // A validation failure is new, actionable execution evidence. Do not
          // let a stale forced-evidence latch reject the bounded repair patch
          // that is allowed to respond to that failure.
          forcedEvidenceActive = false;
          forcedPrimaryEvidence = false;
          noProgressStreak = 0;
        } else if (executionMode === "repair_plan" && validation.status === "passed") {
          failedValidationFingerprints.delete(validationProfile ?? "");
        }
      }
      if (tc.function.name === "read_file" || tc.function.name === "read_file_range") {
        // Only a SUCCESSFUL source-evidence read counts as progress and clears
        // forced-evidence mode. A failed read (error, empty body, directory
        // listing, malformed path) is not source evidence, so it must neither
        // reset the no-progress streak, set first-read telemetry, nor let a
        // planner escape the force with a bogus read attempt.
        if (isSuccessfulSourceRead(tc.function.name, typeof args.path === "string" ? args.path : undefined, toolResult.output)) {
          // FEG-015: evidence-iteration progress is only a read that acquires
          // NEW completed evidence for its path. A duplicate re-read of an
          // already-completed path is NOT new evidence (it counts as planning),
          // so it must not reset the no-progress streak.
          if (!isCompletedPath(typeof args.path === "string" ? args.path : undefined)) {
            iterationNewRead = true;
          }
          // Force-clearing re-arms the one-run fire latch so circular planning
          // that resumes AFTER this successful read can be re-forced by a later
          // no-progress pair (reusable force lifecycle).
          forcedEvidenceActive = false;
          forcedPrimaryEvidence = false;
          if (firstSourceReadIter === null) {
            firstSourceReadIter = iter;
            sourceRetrieval.iterationsUntilFirstSourceRead = iter;
            sourceRetrieval.iterationsUntilFirstRead = iter;
            sourceRetrieval.firstEvidenceAcquired = true;
            sourceRetrieval.iterationsWithoutEvidence = iter;
          }
        }
      }
      // A fresh evidence-gathering call — read, symbol search, or dependency
      // listing — counts as progress for the FEG-008 gating only when it
      // produced USABLE, GENUINELY NOVEL evidence (non-empty, non-error output
      // whose canonical form was not already surfaced this run). An Error,
      // empty, or repeated result is NO_PROGRESS: otherwise a circled planner
      // could issue endless distinct-but-useless searches/listings that keep
      // resetting noProgressStreak and never enter dispatch-enforced evidence
      // mode. Reads are gated separately by isSuccessfulSourceRead above.
      if (tc.function.name === "list_directory") {
        // OR-accumulate: a later duplicate/failed call in the same turn must
        // not erase an earlier novel call's progress.
        iterationListDir = isNovelGatherResult(toolResult.output) || iterationListDir;
      }
      if (tc.function.name === "search_code") {
        if (firstSourceReadIter === null) {
          sourceRetrieval.crossFileQueriesBeforeFirstRead += 1;
        }
        iterationNewSearch = isNovelGatherResult(toolResult.output) || iterationNewSearch;
      }
      if (tc.function.name === "list_directory" && firstSourceReadIter === null) {
        sourceRetrieval.crossFileQueriesBeforeFirstRead += 1;
      }
      const usableRead =
        (tc.function.name === "read_file" || tc.function.name === "read_file_range") &&
        isUsableReadOutput(toolResult.output);
      if (
        usableRead &&
        typeof args.path === "string" &&
        args.path.trim()
      ) {
        fileContents.set(args.path, toolResult.output);
      }
      if (tc.function.name === "read_file" || tc.function.name === "read_file_range") {
        recordRead(tc.function.name, args.path, toolResult.output);
        // Retain the body as source evidence so a later dependency proof may
        // cite `from_file` and reference text grounded in what was actually read.
        recordSourceEvidence(args.path, toolResult.output);
        if (compoundWriteMode && fileContents.size > 0) {
          compoundProposalActive = true;
        }
      }
      if (
        toolResult.source &&
        (tc.function.name !== "read_file" && tc.function.name !== "read_file_range"
          ? true
          : usableRead)
      ) {
        toolSources.push(toolResult.source);
      }
      emitReadEvidenceLinked(tc.function.name, args.path, result.content, toolResult.output);
      try {
        onStep?.({
          kind: "tool_result",
          tool: tc.function.name,
          source: toolResult.source,
          cached: false,
          outputLength: toolResult.output.length,
          ...(tc.function.name === "run_command"
            ? { commandStatus: parseCommandStatus(toolResult.output) }
            : {}),
          ...((tc.function.name === "read_file" || tc.function.name === "read_file_range")
            ? { resultSummary: `Read completed (${toolResult.output.length} characters).` }
            : {}),
        });
      } catch { /* ignore */ }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: untrustedToolOutput(tc.function.name, toolResult.output, args),
      });
      if (
        compoundWriteMode &&
        (tc.function.name === "write_file" || tc.function.name === "replace_text") &&
        pendingChanges.length > 0
      ) {
        forceSynthesisNext = true;
      }
    }

    // ── Progress enforcement (FEG-008) ────────────────
    // A "planning iteration" issued tool calls but gathered no new evidence.
    // Two consecutive NO_PROGRESS iterations force a primary-evidence action
    // instead of letting the loop keep planning in circles.
    if (iterationIssuedToolCalls) {
      const iterationMadeProgress =
        iterationNewRead || iterationNewSearch || iterationListDir;
      // FEG-009/010 category accounting: an iteration that landed a NEW source
      // read is evidence work; any other tool-calling iteration is planning.
      // Reasoning iterations (no tool calls) are tallied after the dispatch.
      if (iterationNewRead) {
        evidenceIterations += 1;
        sourceRetrieval.evidenceIterations = evidenceIterations;
      } else {
        planningIterations += 1;
        sourceRetrieval.planningIterations = planningIterations;
      }
      if (iterationMadeProgress) {
        noProgressStreak = 0;
        forcedNoProgressStreak = 0;
      } else {
        noProgressStreak += 1;
        if (forcedEvidenceActive) {
          forcedNoProgressStreak += 1;
          if (forcedNoProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD) {
            // Preserve one bounded chance to satisfy the forced read; if the
            // model still cannot progress, the next turn is synthesis-only.
            forceSynthesisNext = true;
          }
        }
        if (
          executionMode !== "repair_plan" &&
          noProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD &&
          !forcedPrimaryEvidence
        ) {
          forcedPrimaryEvidence = true;
          forcedEvidenceActive = true;
          sourceRetrieval.progressForced = true;
          try {
            onStep?.({
              kind: "diagnostic",
              code: "FORCE_PRIMARY_EVIDENCE_ACTION",
              details: [
                `${noProgressStreak} consecutive planning iterations without new evidence` +
                  (fegTarget
                    ? `; forcing read of primary evidence target "${fegTarget}"`
                    : "; forcing a source read"),
              ],
            });
          } catch { /* ignore */ }
          // Force the primary evidence target into the allow/read policy on the
          // next iteration so the model cannot keep planning past this point.
          if (fegTarget && allowedReads) allowedReads.add(fegTarget);
          // Hide planning tools on the next turn so the only route forward is
          // a read (or a synthesis of already-gathered evidence). The
          // dispatch-level forced-evidence gate independently rejects
          // out-of-set calls, so this tool-hiding is a secondary nudge.
          temporarilyDisabledTools.add("search_code");
          temporarilyDisabledTools.add("list_directory");
        }
      }
      // FEG-009/010 protected primary-evidence allocation. Unlike a (brief)
      // no-progress streak, a planner can keep issuing NOVEL-but-useless
      // searches forever - each resets noProgressStreak, so the FEG-008
      // consecutive guard never fires and the whole iteration budget drains
      // on planning with zero source reads. Cap cumulative PLANNING spending
      // at its allocation: once it is consumed with zero source reads, force
      // a first-evidence action so planning cannot exhaust the evidence
      // budget. Only meaningful when an evidence route actually exists.
      //
      // A minimum of 2 planning iterations guards against forcing on the very
      // first turn of a tiny budget (e.g. maxIterations=4 has a planning
      // allocation of only 1): one novel search that made progress is not yet
      // evidence starvation — the model may naturally read next turn — so we
      // only redirect once planning has demonstrably spent its share AND the
      // run has had more than a single planning turn to reach evidence.
      if (
        executionMode !== "repair_plan" &&
        planningIterations >= runBudget.planning &&
        planningIterations >= 2 &&
        firstSourceReadIter === null &&
        !forcedPrimaryEvidence &&
        evidenceRouteAvailable
      ) {
        forcedPrimaryEvidence = true;
        forcedEvidenceActive = true;
        sourceRetrieval.progressForced = true;
        try {
          onStep?.({
            kind: "diagnostic",
            code: "FORCE_PRIMARY_EVIDENCE_ACTION",
            details: [
              `planning budget exhausted (${planningIterations} planning iters >= ${runBudget.planning} allocation) before the first source read` +
                (fegTarget
                  ? `; forcing read of primary evidence target "${fegTarget}"`
                  : "; forcing a source read"),
            ],
          });
        } catch { /* ignore */ }
        if (fegTarget && allowedReads) allowedReads.add(fegTarget);
        temporarilyDisabledTools.add("search_code");
        temporarilyDisabledTools.add("list_directory");
      }
    } else {
      // FEG-009/010: an iteration that issued no tool calls is reasoning /
      // synthesis work, not planning - it cannot be blamed for starving the
      // evidence budget.
      reasoningIterations += 1;
    }
  }

  // Iteration budget exhausted.
  console.warn(
    JSON.stringify({
      scope: "tool-execution-engine",
      code: "TOOL_LOOP_EXHAUSTED",
      iterations: maxIterations,
      hasPartialText: lastTextSeen !== undefined,
    }),
  );

  // If the model produced any text during the loop (e.g. after the soft-limit
  // synthesis hint fired), surface it as a kind:"partial" result so the caller
  // can give the user a useful answer instead of a generic error message.
  if (lastTextSeen !== undefined) {
    currentIteration = maxIterations;
    const incompleteReason =
      objective && forceSynthesisNext && noProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD
        ? "no_progress" as const
        : objective && requiresEvidence && evidenceRouteAvailable && firstSourceReadIter === null
          ? "evidence_incomplete" as const
          : objectiveIncompleteReason();
    if (incompleteReason) return incompleteResult(incompleteReason, lastTextSeen);
    classifyZeroReadTerminal("soft_limit", maxIterations);
    try {
      onStep?.({
        kind: "done",
        iterations: maxIterations,
        maxIterations,
        ...executionCounts(),
        stopReason: "soft_limit",
        synthesisStarted,
        diagnosticCodes: [],
        sourceRetrieval,
      });
    } catch { /* ignore */ }
    return { kind: "partial", result: lastTextSeen, toolSources, fileContents, sourceRetrieval, reason: "soft_limit" };
  }

  currentIteration = maxIterations;
  const incompleteReason =
    objective && forceSynthesisNext && noProgressStreak >= NO_PROGRESS_FORCE_THRESHOLD
      ? "no_progress" as const
      : objective && requiresEvidence && evidenceRouteAvailable && firstSourceReadIter === null
        ? "evidence_incomplete" as const
        : objectiveIncompleteReason();
  if (incompleteReason) return incompleteResult(incompleteReason);
  classifyZeroReadTerminal("iteration_budget", maxIterations);
  try {
    onStep?.({
      kind: "done",
      iterations: maxIterations,
      maxIterations,
      ...executionCounts(),
      stopReason: "iteration_budget",
      synthesisStarted,
      diagnosticCodes: [],
      sourceRetrieval,
    });
  } catch { /* ignore */ }
  return { kind: "exhausted", toolSources, fileContents, sourceRetrieval, reason: "iteration_budget" };
}
