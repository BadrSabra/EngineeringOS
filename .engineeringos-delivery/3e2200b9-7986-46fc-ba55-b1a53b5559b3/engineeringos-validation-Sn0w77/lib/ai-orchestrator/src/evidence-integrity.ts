/**
 * Evidence Integrity & Claim Verification (EI-001…EI-023)
 *
 * Transforms the naive chain
 *     Source Read → Evidence Packet → Model Conclusion → Final Judgment
 * into a claim-centered, auditable chain:
 *     Source Read → Evidence Window → Claim → Claim-to-Evidence Binding
 *       → Verification → Behavioral Answer / Finding → Telemetry
 *
 * Invariant enforced end to end: **no Claim reaches Final Output unless it has
 * DIRECT evidence traceable to the same execution run** (EI-003).
 *
 * The module is deliberately pure and side-effect free so it can be unit-tested
 * exhaustively and reused by the engine, the chat agent, and the SSE layer.
 *
 * Addresses benchmark gaps G-22 (evidence↔claim mismatch) and G-23
 * (telemetry↔evidence-packet mismatch).
 */

import { createHash } from "node:crypto";
import ts from "typescript";
import type { ObjectiveVerdictKind } from "./audit-telemetry.js";
import type { ScopeExpansion } from "./objective-scope.js";

/**
 * Reserved keywords and common English stopwords that must never be chosen as a
 * claim symbol. Used by extractClaimSymbol to avoid issuing a targeted read for
 * a generic token like "return" or "when", which produces no useful line anchor.
 */
const WEAK_SYMBOL_TOKENS = new Set(
  (
    "return if else for while switch case break continue function const let var new class interface type " +
    "import export from default extends try catch finally typeof instanceof this with when where what which " +
    "who whom whose why how that these those it its them their there here " +
    "the and or not no but are was were be been being is has have had do does did will would could should " +
    "can may might shall must to of in on at by for as into across over under within without between during " +
    "through out up down then than also only too very just about again further once " +
    "value val item each every all any some both few more most other another " +
    "your you we us our our get set add remove true false null undefined"
  ).split(/\s+/),
);

/** A compound identifier (camelCase or snake_case) is a much stronger symbol lead. */
function isCompoundIdentifier(token: string): boolean {
  return token.includes("_") || /[a-z][A-Z]/.test(token);
}

/**
 * EI-017: pick the meaningful code symbol to issue a targeted read for.
 *
 * The previous inline regex `evidence.match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b/)`
 * returned the FIRST identifier-like token, which is frequently a generic word
 * ("return", "when", "from"). A search for such a token matches nothing useful,
 * so the targeted read defaulted to lines 1..N — identical to a full read.
 *
 * Preference order (all skipping reserved words + stopwords, min 3 chars):
 *  1. compound (camelCase / snake_case) tokens in the evidence snippet;
 *  2. plain tokens in the evidence snippet;
 *  3. compound tokens in the finding title;
 *  4. plain tokens in the finding title.
 * Returns undefined when nothing meaningful is found so the caller can skip the
 * (useless) targeted read entirely.
 */
export function extractClaimSymbol(evidence: string, title = ""): string | undefined {
  const pickFrom = (text: string, wantCompound: boolean): string | undefined => {
    const stems: string[] = text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    const candidates = stems.filter(
      (token) =>
        token.length >= 3 &&
        !WEAK_SYMBOL_TOKENS.has(token.toLowerCase()) &&
        isCompoundIdentifier(token) === wantCompound,
    );
    // Longest compound / most descriptive identifier is the strongest anchor.
    return candidates.sort((a, b) => b.length - a.length)[0];
  };
  return (
    pickFrom(evidence, true) ??
    pickFrom(evidence, false) ??
    pickFrom(title, true) ??
    pickFrom(title, false)
  );
}

// ── EI-001 Canonical Evidence Identity ─────────────────────────────────────────

/** Read-type classification; mirrors the engine's source-retrieval read status. */
export type EvidenceReadType = "COMPLETE" | "TARGETED" | "TRUNCATED" | "CACHED" | "FAILED";

/** Source category of the evidence window. */
export type EvidenceSourceType = "IMPLEMENTATION" | "TEST" | "CONFIG" | "UNKNOWN";

/**
 * EI-033: the provenance scope of a source window. A window in a fixture can
 * prove a fixture-local claim but must never prove a production claim. Scopes
 * are ordered by how strong a proof they can carry:
 *   PRODUCTION > (FIXTURE | TEST | SPEC) > GENERATED > UNKNOWN
 */
export type EvidenceSourceScope =
  | "PRODUCTION"
  | "FIXTURE"
  | "TEST"
  | "SPEC"
  | "GENERATED"
  | "UNKNOWN";

/**
 * EI-029: the scope a verdict (or a claim) is allowed to assert. This is the
 * "scoped verdict" that replaces the generic `FINDING PROVEN` with an exact
 * proof-boundary. NOT_PROVEN means no proof boundary was established at all.
 */
export type VerdictScope =
  | "PRODUCTION"
  | "FIXTURE_LOCAL"
  | "TEST_LOCAL"
  | "SPEC_LOCAL"
  | "MIXED"
  | "NOT_PROVEN";

/**
 * EI-030: scoped finding statuses that replace the bare `FINDING_PROVEN`.
 * A finding that flips from production to fixture-local must lose the
 * production claim instead of asserting it (EI-031 scope-escalation guard).
 */
export type ScopedFindingStatus =
  | "PRODUCTION_PROVEN"
  | "FIXTURE_PROVEN"
  | "TEST_PROVEN"
  | "MIXED_EVIDENCE"
  | "NOT_PROVEN";

/** EI-002: lifecycle stages of an evidence object. */
export type EvidencePhase = "SOURCE_READ" | "EVIDENCE_CREATED" | "EVIDENCE_SELECTED" | "EVIDENCE_ACCEPTED";

/**
 * A single canonical evidence record. Every source read produces exactly one
 * of these keyed by `evidenceId`, and no evidence may appear in a report that
 * lacks `runId` + `readAttemptId` lineage (EI-001/003/018).
 */
export type EvidenceRecord = {
  evidenceId: string;
  /** Execution run this evidence belongs to. Must equal the current runId to count as fresh proof. */
  runId: string;
  taskId?: string;
  /** Project-relative source path. */
  file: string;
  /** Claim-relevant symbol this window supports (EI-013 selection starts here). */
  symbol?: string;
  startLine?: number;
  endLine?: number;
  sourceSpan?: { startLine: number; endLine: number };
  readType: EvidenceReadType;
  /** Phase in the EI-002 lifecycle (SOURCE_READ/EVIDENCE_CREATED/SELECTED/ACCEPTED). */
  phase: EvidencePhase;
  sourceType: EvidenceSourceType;
  readAttemptId?: string;
  /**
   * When the evidence was served from a cache populated by an earlier run,
   * this holds that origin run. Such evidence is lineage-tagged and is never
   * treated as fresh runtime proof (EI-003/022).
   */
  originRunId?: string;
  /** Present when recovered at an evidence gap (EI-017/018). */
  recoveryAttemptId?: string;
  /** Directness strength for EI-006 (assigned conservatively). */
  strength: EvidenceStrength;
  /**
   * EI-033: the provenance scope of this window (where the source lives). A
   * FIXTURE/TEST/SPEC window must never be treated as production proof.
   */
  sourceScope: EvidenceSourceScope;
  timestamp: number;
};

/** EI-006: evidence strength. CONTEXT_ONLY can never prove Behavior or a Finding. */
export type EvidenceStrength = "DIRECT" | "INDIRECT" | "CONTEXT_ONLY";

// ── EI-004 Claim Record ────────────────────────────────────────────────────────

export type ClaimStatus = "SUPPORTED" | "UNSUPPORTED" | "NOT_PROVEN";

/**
 * A claim about observable behavior. Holds explicit evidenceIds that must bind
 * to (at least one) DIRECT, same-run, production-source EvidenceRecord.
 */
export type ClaimRecord = {
  claimId: string;
  /** The behavior asserted in words (e.g. "partial returned when lastTextSeen exists"). */
  text: string;
  taskType: string;
  /** The symbol the claim is about; evidence selection starts from this (EI-013). */
  symbol?: string;
  /**
   * AI-OBJ-007: the kind of assertion this claim makes. When set,
   * `validateClaim` runs the evidence relevance gate so that e.g. a behavioral
   * excerpt cannot be used to prove a C_PRODUCTION_REACHABILITY claim.
   */
  category?: ClaimCategory;
  /**
   * EI-032: the proof scope the claim asserts. Populated during verification
   * from the sourceScope of its DIRECT evidence; FIXTURE evidence cannot
   * produce a PRODUCTION-scoped claim (EI-031/033).
   */
  scope?: VerdictScope;
  evidenceIds: string[];
  status: ClaimStatus;
  /** EI-005: supporting relation — which evidenceId+span proves the claim. */
  binding?: ClaimEvidenceBinding;
};

/** EI-005 Claim→Evidence binding. Missing binding ⇒ REJECTED (EI-007). */
export type ClaimEvidenceBinding = {
  claimId: string;
  evidenceIds: string[];
  /** File-local source spans, one per evidenceId, in the same order. */
  sourceSpans: { file: string; startLine?: number; endLine?: number }[];
  /** Human-readable "what relation proves the claim". */
  relation: string;
};

// ── EI-007 Verification ────────────────────────────────────────────────────────

export type ClaimValidationResult = "PROVEN" | "NOT_PROVEN" | "REJECTED";

export type ClaimValidation = {
  claimId: string;
  result: ClaimValidationResult;
  /** Which of the EI-007 checks failed (evidence exists / same run / production / symbol / direct / covers). */
  reasons: string[];
};

// ── EI-009 Behavior vs Finding separation ──────────────────────────────────────

export type BehaviorStatus = "PROVEN" | "NOT_PROVEN" | "NO_BEHAVIOR_REQUESTED";
export type FindingStatus = "PROVEN" | "NONE" | "NOT_PROVEN";

/**
 * Behavior and Finding outcomes are independent. A correct behavioral answer
 * can be Behavior=PROVEN with Finding=NONE and must NOT be flattened to
 * NOT_PROVEN (EI-009, AI-009).
 */
export type BehaviorFindingStatus = {
  behavior: BehaviorStatus;
  finding: FindingStatus;
  /** True only when behavior itself lacks direct source proof. */
  behaviorUnsupported: boolean;
};

// ── EI-010 Canonical Run Ledger ────────────────────────────────────────────────

/**
 * Single source of truth for a run. All interfaces/tools read reconciliation
 * from this ledger (EI-010).
 */
export type RunLedger = {
  runId: string;
  taskId?: string;
  readAttempts: number;
  completedReads: number;   // distinct completed SOURCE_READ records
  targetedReads: number;
  cachedReads: number;
  /** Distinct files with at least one completed SOURCE_READ record. */
  uniqueFilesRead: number;
  /**
   * Canonical evidence projection consumed by persisted trace/UI surfaces.
   * These sets must not be reconstructed independently from tool events.
   */
  completedReadFiles?: string[];
  retainedBodyFiles?: string[];
  acceptedEvidenceFiles?: string[];
  acceptedClaimCount?: number;
  sourceCoverage?: CanonicalSourceCoverage;
  evidenceRecords: EvidenceRecord[];
  /** Distinct files with at least one accepted evidence record (packet-side). */
  evidenceFileCount: number;
  claims: ClaimRecord[];
  validations: ClaimValidation[];
  acceptedEvidenceCount: number;
  provenClaims: number;
  recoveryAttempts: number;
  /** EI-029: proof scope of the collected evidence; NOT_PROVEN when none established. */
  verdictScope: VerdictScope;
  /** EI-030: scoped finding status derived from the evidence scope. */
  scopedFindingStatus: ScopedFindingStatus;
  finalResult?: BehaviorFindingStatus;
  /**
   * AI-OBJ-011: objective completion telemetry. Present only when the run
   * declared an objective. `validateTelemetry` fails closed on any objective
   * telemetry that is inconsistent with the gate verdict or the evidence.
   */
  objectiveType?: string;
  requiredClaims?: string[];
  completedClaims?: string[];
  missingClaims?: string[];
  requiredEdges?: string[];
  provenEdges?: string[];
  failedEdges?: string[];
  recoveryTriggered?: boolean;
  recoveryTarget?: string;
  /** AI-OBJ-011: bounded primary/expansion scope telemetry. */
  scopeExpansions?: ScopeExpansion[];
  /** Canonical paths that were attempted outside the objective scope. */
  unjustifiedReads?: string[];
  completionGateResult?: ObjectiveCompletionStatus;
  finalAnswerType?: "PRODUCTION_REACHABILITY_ANSWER" | "BEHAVIORAL_ANSWER" | "NO_ANSWER";
};

export type CanonicalSourceCoverage = {
  status: "COMPLETE" | "PARTIAL" | "NONE";
  /** Explicit file manifest retained in request order for scoped audits. */
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

export type TelemetryReconciliation =
  | { consistent: true }
  | { consistent: false; code: "TELEMETRY_INCONSISTENT"; violations: string[] };

// ── EI-029/030/031/033 Scope inference & validation ────────────────────────────

/** EI-029: infer the proof scope a set of evidence is allowed to assert. */
export function deriveVerdictScope(records: readonly EvidenceRecord[]): VerdictScope {
  const observed = new Set(records.map((r) => r.sourceScope ?? "UNKNOWN"));
  const hasProduction = observed.has("PRODUCTION");
  const hasLocal = observed.has("FIXTURE") || observed.has("TEST") || observed.has("SPEC");
  if (hasProduction && hasLocal) return "MIXED";
  if (hasProduction) return "PRODUCTION";
  if (observed.has("FIXTURE")) return "FIXTURE_LOCAL";
  if (observed.has("TEST")) return "TEST_LOCAL";
  if (observed.has("SPEC")) return "SPEC_LOCAL";
  return "NOT_PROVEN";
}

/**
 * EI-030/031: map a set of evidence windows to a scoped finding status. The
 * scope-escalation guard is intrinsic: fixture/test/spec windows can only ever
 * yield a local status, never PRODUCTION_PROVEN.
 */
export function deriveScopedFindingStatus(records: readonly EvidenceRecord[]): ScopedFindingStatus {
  switch (deriveVerdictScope(records)) {
    case "PRODUCTION":
      return "PRODUCTION_PROVEN";
    case "FIXTURE_LOCAL":
      return "FIXTURE_PROVEN";
    case "TEST_LOCAL":
      return "TEST_PROVEN";
    case "SPEC_LOCAL":
      return "TEST_PROVEN";
    case "MIXED":
      return "MIXED_EVIDENCE";
    default:
      return "NOT_PROVEN";
  }
}

/**
 * EI-029/030: human-readable verdict label for a scoped finding status.
 *
 * A bare "FINDING PROVEN" is reserved for production-grade evidence only.
 * Fixture, test, and spec evidence must carry an explicit scope qualifier so
 * the caller cannot mistake a fixture-local proof for production reachability.
 *
 * NOT_PROVEN and MIXED_EVIDENCE return the generic label as a safe default;
 * callers that need a non-generic label must first confirm the finding was
 * accepted before using this helper.
 */
export function buildScopedVerdictLabel(status: ScopedFindingStatus): string {
  switch (status) {
    case "PRODUCTION_PROVEN":
      return "FINDING PROVEN";
    case "FIXTURE_PROVEN":
      return "FIXTURE-LOCAL FINDING PROVEN — PRODUCTION REACHABILITY NOT PROVEN";
    case "TEST_PROVEN":
      return "TEST-LOCAL FINDING PROVEN — PRODUCTION REACHABILITY NOT PROVEN";
    case "MIXED_EVIDENCE":
      return "FINDING PROVEN (MIXED EVIDENCE SCOPE — fixture and production sources combined; production reachability requires additional verification)";
    default:
      return "FINDING PROVEN";
  }
}

/**
 * EI-036: derive a scoped finding status directly from a list of source paths
 * (e.g. a recovered Repair Plan's target files), mirroring the per-file
 * classification that `emitForensicStatus` applies to an audit. This lets the
 * repair execution gate block a plan whose targets are fixture/test-only even
 * when the audit's derived status is not carried across the stateless handoff.
 */
export function deriveScopedFindingStatusFromPaths(
  paths: readonly string[],
): ScopedFindingStatus {
  const observed = new Set(paths.map((file) => classifySourceScope(file)));
  const hasProduction = observed.has("PRODUCTION");
  const hasLocal =
    observed.has("FIXTURE") || observed.has("TEST") || observed.has("SPEC");
  if (hasProduction && hasLocal) return "MIXED_EVIDENCE";
  if (hasProduction) return "PRODUCTION_PROVEN";
  if (observed.has("FIXTURE")) return "FIXTURE_PROVEN";
  if (observed.has("TEST") || observed.has("SPEC")) return "TEST_PROVEN";
  return "NOT_PROVEN";
}

/**
 * EI-033: can evidence of `evidenceScope` prove a claim asserting `claimScope`?
 * A FIXTURE/TEST/SPEC window can never prove a PRODUCTION claim.
 */
export function evidenceScopeSupportsClaimScope(
  evidenceScope: EvidenceSourceScope,
  claimScope: VerdictScope,
): boolean {
  if (claimScope === "NOT_PROVEN") return false;
  if (claimScope === "MIXED") {
    // A mixed claim must be supported by production-grade evidence at least once.
    return evidenceScope === "PRODUCTION";
  }
  if (claimScope === "PRODUCTION") return evidenceScope === "PRODUCTION";
  if (claimScope === "FIXTURE_LOCAL") return evidenceScope === "FIXTURE" || evidenceScope === "PRODUCTION";
  if (claimScope === "TEST_LOCAL") return evidenceScope === "TEST" || evidenceScope === "PRODUCTION";
  // SPEC_LOCAL
  return evidenceScope === "SPEC" || evidenceScope === "PRODUCTION";
}

// ── EI-036 Repair Scope Gate ────────────────────────────────────────────────────

/** Machine-backed reason why a repair step may or may not execute under a scoped verdict. */
export type RepairBlockReason =
  | "REPAIR_ALLOWED"
  | "REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION"
  | "REPAIR_BLOCKED_SCOPE_NOT_PROVEN"
  | "REPAIR_BLOCKED_MIXED_EVIDENCE";

export type ScopedRepairGate =
  | { allowed: true; reason: RepairBlockReason; detail: string }
  | { allowed: false; reason: RepairBlockReason; detail: string };

/**
 * EI-036: gate repair execution on proof scope. Only a production-scope finding
 * is permitted to drive a repair plan. Fixture/test/proven-only, not-proven, and
 * mixed evidence all block repair with an explicit reason so a local proof can
 * never reach a proposed-change surface. Mirrors guardFinalJudgment's shape.
 */
export function scopedRepairGate(scopedFindingStatus: ScopedFindingStatus): ScopedRepairGate {
  switch (scopedFindingStatus) {
    case "PRODUCTION_PROVEN":
      return {
        allowed: true,
        reason: "REPAIR_ALLOWED",
        detail: "Finding proven from production source evidence; repair may proceed.",
      };
    case "FIXTURE_PROVEN":
      return {
        allowed: false,
        reason: "REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION",
        detail: "Finding proven only from fixture evidence (EI-031/033); the defect is not proven in production code.",
      };
    case "TEST_PROVEN":
      return {
        allowed: false,
        reason: "REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION",
        detail: "Finding proven only from test evidence (EI-031/033); the defect is not proven in production code.",
      };
    case "MIXED_EVIDENCE":
      return {
        allowed: false,
        reason: "REPAIR_BLOCKED_MIXED_EVIDENCE",
        detail: "Finding rests on mixed production and fixture/test evidence; repair is blocked until a production-scope proof is established.",
      };
    case "NOT_PROVEN":
    default:
      return {
        allowed: false,
        reason: "REPAIR_BLOCKED_SCOPE_NOT_PROVEN",
        detail: "Finding is not proven; repair cannot be gated to production scope.",
      };
  }
}

// ── Constructors ───────────────────────────────────────────────────────────────

let _idCounter = 0;
/** Short, human-friendly id like `E-001` / `C-001`. */
function seqId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${String(_idCounter).padStart(3, "0")}`;
}

/** Derive a deterministic path span when line info is unknown. */
export function evidenceSpanFromContent(file: string, content: string): {
  startLine?: number;
  endLine?: number;
  sourceSpan?: { startLine: number; endLine: number };
} {
  const lines = content.split("\n");
  if (lines.length === 0) return {};
  const sourceSpan = { startLine: 1, endLine: lines.length };
  return { startLine: 1, endLine: lines.length, sourceSpan };
}

/**
 * EI-006: classify a window's strength. A configured constant that merely
 * exists in the file (`DEFAULT_MAX_ITERATIONS = 30`) is CONTEXT_ONLY. A branch
 * or return that reaches the symbol is DIRECT. Anything in between is INDIRECT.
 */
export function classifyEvidenceStrength(content: string, file = ""): EvidenceStrength {
  if (!content) return "CONTEXT_ONLY";
  // Direct behavioral markers: control flow that returns/produces a distinctive value.
  const hasControlFlow = /\b(?:if|else|switch|case|for|while|return|throw)\b/.test(content);
  const looksLikePureDeclaration =
    /^\s*(?:const|let|var|static|final|public|private|internal|export)\b[^;{}]*=\s*[^;{}\n]*;?\s*$/m.test(
      content,
    );
  // A configured constant like `DEFAULT_MAX_ITERATIONS = 30`.
  const isConfigConstant =
    /(?:DEFAULT|MAX|MIN|LIMIT|THRESHOLD|TIMEOUT|_DEFAULT|_MAX|COUNT)\w*\s*[:=]\s*[-0-9.]+/.test(
      content,
    ) ||
    looksLikePureDeclaration;
  if (hasControlFlow && !isConfigConstant) return "DIRECT";
  if (hasControlFlow || !isConfigConstant) return "INDIRECT";
  return "CONTEXT_ONLY";
}

/** Identity helper (collision-safe regardless of global counter reuse). */
export function buildEvidenceId(runId: string, file: string, readAttemptId: string): string {
  return createHash("sha1")
    .update(`${runId}|${file}|${readAttemptId}`)
    .digest("hex")
    .slice(0, 10);
}

/**
 * EI-001/002: produce a canonical EvidenceRecord for one source read.
 * `phase` selects the lifecycle stage. Defaults to EVIDENCE_CREATED for a
 * completed read that has been admitted into the evidence pool.
 */
export function createEvidenceRecord(input: {
  runId: string;
  taskId?: string;
  file: string;
  content?: string;
  readType?: EvidenceReadType;
  phase?: EvidencePhase;
  sourceType?: EvidenceSourceType;
  readAttemptId?: string;
  originRunId?: string;
  recoveryAttemptId?: string;
  symbol?: string;
  timestamp?: number;
  /**
   * EI-033: explicit provenance scope. When omitted it is derived from the
   * file path so a fixture/test/spec window is never mislabeled as production.
   */
  sourceScope?: EvidenceSourceScope;
  /**
   * File-local coordinates for the evidence window. When provided, overrides
   * the content-derived span so TARGETED reads can record the actual line range
   * within the source file rather than lines 1..N of the extracted window.
   */
  sourceSpan?: { startLine: number; endLine: number };
}): EvidenceRecord {
  const {
    runId,
    taskId,
    file,
    content = "",
    readType = "COMPLETE",
    phase = "EVIDENCE_CREATED",
    sourceType = "IMPLEMENTATION",
    readAttemptId = seqId("RA"),
    originRunId,
    recoveryAttemptId,
    symbol,
    timestamp = Date.now(),
    sourceScope: callerSourceScope,
    sourceSpan: callerSourceSpan,
  } = input;
  // Caller-provided sourceSpan (e.g. from a targeted read) takes priority; fall
  // back to deriving the span from the content length.
  const derived = callerSourceSpan
    ? { startLine: callerSourceSpan.startLine, endLine: callerSourceSpan.endLine, sourceSpan: callerSourceSpan }
    : evidenceSpanFromContent(file, content);
  const { startLine, endLine, sourceSpan } = derived;
  // Cached evidence from an earlier run must never be treated as fresh proof.
  const effectiveReadType: EvidenceReadType =
    originRunId && readType === "COMPLETE" ? "CACHED" : readType;
  const strength = classifyEvidenceStrength(content, file);
  return {
    evidenceId: buildEvidenceId(runId, file, readAttemptId),
    runId,
    taskId,
    file,
    symbol,
    ...(startLine ? { startLine } : {}),
    ...(endLine ? { endLine } : {}),
    ...(sourceSpan ? { sourceSpan } : {}),
    readType: effectiveReadType,
    phase,
    sourceType,
    readAttemptId,
    ...(originRunId ? { originRunId } : {}),
    ...(recoveryAttemptId ? { recoveryAttemptId } : {}),
    strength,
    sourceScope: callerSourceScope ?? classifySourceScope(file),
    timestamp,
  };
}

/**
 * EI-033: infer the provenance scope of a source file from its path. Explicit
 * fixture/test/spec directories are always local scopes; everything else that
 * is real code resolves to PRODUCTION so a runtime window in app code carries
 * the strongest proof it is allowed to.
 */
export function classifySourceScope(file: string): EvidenceSourceScope {
  const normalized = file.replace(/\\/g, "/");
  // Directory-level overrides come first: a file under fixtures/ or mocks/ is
  // always FIXTURE regardless of extension, and a file under tests/ / specs/ is
  // always TEST regardless of extension.
  if (/(?:^|\/)(?:fixtures?|mocks?|__mocks__)\b/i.test(normalized)) return "FIXTURE";
  if (/(?:^|\/)(?:__tests__|tests?)\b/i.test(normalized) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized)) {
    return "TEST";
  }
  if (/(?:^|\/)(?:specs?|features?)\b/i.test(normalized)) return "SPEC";
  if (/(?:^|\/)(?:dist|build|gen[^/]*|generated)\b/i.test(normalized)) return "GENERATED";
  // Language-specific test-file naming conventions that place test files
  // alongside production code (i.e. NOT inside a test/ directory):
  //   Go:     *_test.go
  //   Python: test_*.py  or  *_test.py
  //   Ruby:   *_spec.rb
  //   Rust:   files ending _test.rs (cargo's inline-test convention uses
  //           modules, but separate _test.rs files appear in some projects)
  //   Java/Kotlin: *Test.java, *Tests.java, *Spec.kt, etc.
  const base = normalized.split("/").pop() ?? "";
  if (/_test\.go$/i.test(base)) return "TEST";
  if (/^test_.*\.py$/i.test(base) || /_test\.py$/i.test(base)) return "TEST";
  if (/_spec\.rb$/i.test(base)) return "TEST";
  if (/_test\.rs$/i.test(base)) return "TEST";
  if (/(?:Test|Tests|Spec|IT)\.(?:java|kt)$/i.test(base)) return "TEST";
  // Cover the same implementation extensions as the runtime classifier so that
  // Python, Go, Rust, Java, Kotlin, Ruby, SQL, and shell files are treated as
  // production-scope evidence, not UNKNOWN (which falls through to NOT_PROVEN
  // in deriveVerdictScope and defeats the scoped-verdict boundary).
  if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|sql|sh)$/i.test(normalized)) return "PRODUCTION";
  return "UNKNOWN";
}

/**
 * EI-001 acceptance criterion: every evidence record must carry a runId and a
 * readAttemptId. Returns violations (empty ⇒ compliant).
 */
export function validateEvidenceLineage(records: readonly EvidenceRecord[]): string[] {
  const violations: string[] = [];
  for (const record of records) {
    if (!record.runId) violations.push(`evidence ${record.evidenceId} missing runId`);
    if (!record.readAttemptId) violations.push(`evidence ${record.evidenceId} missing readAttemptId`);
    // EI-003/022: cached evidence from another run is allowed to exist but
    // must carry originRunId and must not be treated as fresh runtime proof.
    if (record.readType === "CACHED" && !record.originRunId) {
      violations.push(`cached evidence ${record.evidenceId} missing originRunId`);
    }
  }
  return violations;
}

// ── EI-004/005/007 Claim handling ─────────────────────────────────────────────

export function createClaim(input: {
  claimId?: string;
  text: string;
  taskType: string;
  symbol?: string;
  scope?: VerdictScope;
  /** AI-OBJ-007: the kind of assertion this claim makes (wires the relevance gate in validateClaim). */
  category?: ClaimCategory;
  evidenceIds?: string[];
  status?: ClaimStatus;
}): ClaimRecord {
  return {
    claimId: input.claimId ?? seqId("C"),
    text: input.text,
    taskType: input.taskType,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.category ? { category: input.category } : {}),
    evidenceIds: input.evidenceIds ?? [],
    status: input.status ?? (input.evidenceIds && input.evidenceIds.length > 0 ? "SUPPORTED" : "NOT_PROVEN"),
  };
}

/** Resolve symbol-match candidates from retained file contents (EI-013). */
export function selectEvidenceForClaim(
  claim: Pick<ClaimRecord, "text" | "symbol">,
  fileContents: ReadonlyMap<string, string>,
): { file: string; symbolHit: boolean; proximity: number; excerpt: string }[] {
  const candidates: { file: string; symbolHit: boolean; proximity: number; excerpt: string }[] = [];
  for (const [file, content] of fileContents) {
    if (!content) continue;
    const symbolHit = Boolean(claim.symbol && content.includes(claim.symbol));
    const claimTokens = claim.text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2);
    const hits = claimTokens.filter((token) => content.toLowerCase().includes(token)).length;
    const proximity = claimTokens.length > 0 ? hits / claimTokens.length : 0;
    // Bounded first window for ranking; not used as proof by itself.
    const firstLine = content.split("\n", 40).join("\n");
    candidates.push({ file, symbolHit, proximity, excerpt: firstLine.slice(0, 300) });
  }
  return candidates.sort((a, b) => rankingscore(b) - rankingscore(a));
}

function rankingscore(c: { symbolHit: boolean; proximity: number }): number {
  return (c.symbolHit ? 1 : 0) * 0.5 + c.proximity * 0.5;
}

/**
 * EI-014: rank evidence candidates for a claim. Higher is better. Factored as
 * symbolMatch + lineProximity + behavioralDirectness + productionConfidence.
 */
export function rankEvidenceForClaim(
  claim: Pick<ClaimRecord, "text" | "symbol">,
  candidates: EvidenceRecord[],
): { evidence: EvidenceRecord; score: number }[] {
  return candidates
    .map((evidence) => {
      const symbolMatch = claim.symbol ? (evidence.symbol === claim.symbol ? 1 : 0.25) : 0.5;
      // Line proximity: a narrower window (smaller relative span) ranks higher,
      // since it pinpoints the control-flow decision the claim is about.
      let spanWidth = Infinity;
      let contentLen = 1;
      if (evidence.sourceSpan && evidence.sourceSpan.endLine >= evidence.sourceSpan.startLine) {
        spanWidth = evidence.sourceSpan.endLine - evidence.sourceSpan.startLine + 1;
        contentLen = Math.max(spanWidth, 1);
      }
      const relativeSpan = spanWidth === Infinity ? 1 : Math.min(spanWidth / contentLen, 1);
      // Direct strength strongly dominates: CONTEXT_ONLY (config) ranks lowest.
      const proximity = 1 - relativeSpan;
      const directnessScore = evidence.strength === "DIRECT" ? 1 : evidence.strength === "INDIRECT" ? 0.5 : 0;
      const productionConfidence =
        evidence.sourceType === "IMPLEMENTATION" ? 1 : evidence.sourceType === "CONFIG" ? 0.4 : 0.6;
      const score = symbolMatch * 0.3 + proximity * 0.2 + directnessScore * 0.3 + productionConfidence * 0.2;
      return { evidence, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** EI-005: build a claim→evidence binding, or return null when no evidence binds. */
export function bindClaimToEvidence(
  claim: ClaimRecord,
  records: readonly EvidenceRecord[],
): ClaimEvidenceBinding | null {
  const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
  // A claim with declared evidenceIds none of which resolve to records is a
  // binding failure → REJECTED via validateClaim.
  if (claim.evidenceIds.length > 0 && bound.length === 0) return null;
  if (bound.length === 0) return null;
  const sourceSpans = bound.map((record) => ({
    file: record.file,
    startLine: record.sourceSpan?.startLine,
    endLine: record.sourceSpan?.endLine,
  }));
  return {
    claimId: claim.claimId,
    evidenceIds: bound.map((record) => record.evidenceId),
    sourceSpans,
    relation: `claim "${claim.text}" proven by ${bound
      .map((record) => `${record.file}${record.sourceSpan ? `:${record.sourceSpan.startLine}-${record.sourceSpan.endLine}` : ""}`)
      .join(", ")}`,
  };
}

// ── EI-007 Claim Validator ─────────────────────────────────────────────────────

export function validateClaim(
  claim: ClaimRecord,
  records: readonly EvidenceRecord[],
  opts: {
    runId: string;
    allowTestSources?: boolean;
    /**
     * AI-OBJ-007: source excerpts keyed by `evidenceId`. When provided and
     * `claim.category` is set, the evidence relevance gate is applied to each
     * bound record. The gate is fail-closed for C_PRODUCTION_REACHABILITY:
     * a missing or behaviorally-typed snippet causes the record to be excluded
     * from the proving set.
     */
    snippets?: ReadonlyMap<string, string>;
  } = { runId: "", allowTestSources: false },
): ClaimValidation {
  const reasons: string[] = [];
  // 1. Evidence exists + binding resolves.
  const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
  if (claim.evidenceIds.length === 0) {
    reasons.push("claim has no evidenceIds (EI-005 REJECTED)");
    return { claimId: claim.claimId, result: "REJECTED", reasons };
  }
  if (bound.length === 0) {
    reasons.push("declared evidenceIds resolve to no records (EI-005 REJECTED)");
    return { claimId: claim.claimId, result: "REJECTED", reasons };
  }
  // A claim is PROVEN iff it has at least one DIRECT-capable, same-run, fresh,
  // production, symbol-linked, relevance-gated record. CONTEXT_ONLY / cached /
  // TEST / relevance-rejected windows cannot be proof (EI-006/003/007#3/AI-OBJ-007).
  const failureKinds: string[] = [];
  for (const record of bound) {
    if (record.strength === "CONTEXT_ONLY") {
      failureKinds.push(`${record.evidenceId} is CONTEXT_ONLY and cannot prove behavior (EI-006)`);
    }
    if (record.runId !== opts.runId) failureKinds.push(`${record.evidenceId} from different run`);
    if (record.readType === "CACHED" && record.originRunId) {
      failureKinds.push(`${record.evidenceId} is cached from run ${record.originRunId}, not fresh proof (EI-003)`);
    }
    if (!opts.allowTestSources && record.sourceType === "TEST") {
      failureKinds.push(`${record.evidenceId} is TEST source, not production (EI-007#3)`);
    }
    // EI-033: scope-escalation guard
    if (claim.scope && !evidenceScopeSupportsClaimScope(record.sourceScope ?? "PRODUCTION", claim.scope)) {
      failureKinds.push(
        `${record.evidenceId} sourceScope ${record.sourceScope ?? "UNKNOWN"} cannot support claim scope ${claim.scope} (EI-033)`,
      );
    }
    if (claim.symbol && record.symbol && record.symbol !== claim.symbol) {
      failureKinds.push(`${record.evidenceId} symbol mismatch`);
    }
    // AI-OBJ-007: evidence relevance gate — applied when the claim carries a
    // category so behavioral/import evidence cannot prove reachability claims.
    if (claim.category) {
      const snippet = opts.snippets?.get(record.evidenceId) ?? "";
      const gate = evidenceRelevanceGate(
        { strength: record.strength, file: record.file },
        claim.category,
        snippet,
        { targetSymbol: claim.symbol },
      );
      if (!gate.relevant) {
        failureKinds.push(`${record.evidenceId} relevance rejected: ${gate.reason}`);
      }
    }
  }
  const provingKinds = bound.filter((record) => {
    if (record.strength === "CONTEXT_ONLY") return false;
    if (record.runId !== opts.runId) return false;
    if (record.readType === "CACHED" && record.originRunId) return false;
    if (!opts.allowTestSources && record.sourceType === "TEST") return false;
    if (claim.scope && !evidenceScopeSupportsClaimScope(record.sourceScope ?? "PRODUCTION", claim.scope)) return false;
    if (claim.symbol && record.symbol && record.symbol !== claim.symbol) return false;
    // AI-OBJ-007: relevance gate — mirrors the per-record failure check above.
    if (claim.category) {
      const snippet = opts.snippets?.get(record.evidenceId) ?? "";
      const gate = evidenceRelevanceGate(
        { strength: record.strength, file: record.file },
        claim.category,
        snippet,
        { targetSymbol: claim.symbol },
      );
      if (!gate.relevant) return false;
    }
    return true;
  });
  if (provingKinds.length === 0) {
    reasons.push(...(failureKinds.length > 0 ? failureKinds : bound.map((r) => `${r.evidenceId} cannot prove the claim (EI-007)`)));
    return { claimId: claim.claimId, result: "NOT_PROVEN", reasons: reasons.slice(0, 6) };
  }
  return { claimId: claim.claimId, result: "PROVEN", reasons: [] };
}

// ── EI-008 Final-Judgment guard ────────────────────────────────────────────────

export type FinalJudgmentGuard =
  | { allowed: true; reason: string }
  | { allowed: false; code: "VERIFICATION_FAILURE"; reason: string };

/**
 * A PROVEN Final Judgment is only allowed to pass when it carries claimId →
 * evidenceIds → source spans → validator decision. Anything less is a
 * VERIFICATION_FAILURE and must not be rendered as PROVEN (EI-008).
 */
export function guardFinalJudgment(input: {
  claims: readonly ClaimRecord[];
  validations: readonly ClaimValidation[];
  records: readonly EvidenceRecord[];
  runId: string;
}): FinalJudgmentGuard {
  if (input.claims.length === 0) {
    return { allowed: false, code: "VERIFICATION_FAILURE", reason: "no claim is bound to any evidence (EI-008)" };
  }
  for (const claim of input.claims) {
    const validation = input.validations.find((v) => v.claimId === claim.claimId);
    if (!validation) {
      return { allowed: false, code: "VERIFICATION_FAILURE", reason: `claim ${claim.claimId} lacks a validator decision` };
    }
    if (validation.result !== "PROVEN") {
      return {
        allowed: false,
        code: "VERIFICATION_FAILURE",
        reason: `claim ${claim.claimId} is ${validation.result}: ${validation.reasons.join("; ")}`,
      };
    }
    const binding = claim.binding ?? bindClaimToEvidence(claim, input.records);
    if (!binding || binding.evidenceIds.length === 0) {
      return { allowed: false, code: "VERIFICATION_FAILURE", reason: `claim ${claim.claimId} has no resolved evidence binding` };
    }
    if (binding.sourceSpans.length === 0) {
      return { allowed: false, code: "VERIFICATION_FAILURE", reason: `claim ${claim.claimId} lacks source spans` };
    }
  }
  return { allowed: true, reason: `all ${input.claims.length} claim(s) verified PROVEN with bound evidence` };
}

/**
 * AI-OBJ-007: the category of a claim — what kind of assertion it makes.
 *
 * Different claim categories require fundamentally different evidence. A
 * behavioral excerpt proving _how_ a function computes can never satisfy a
 * production-reachability claim that demands a _call site_ between two symbols.
 *
 * Categories:
 *  - C_BEHAVIOR: how a function behaves (control flow, return values, side effects).
 *  - C_PRODUCTION_REACHABILITY: that a production caller reaches a target symbol
 *    at runtime — requires a direct call-site or data-flow span, never just an
 *    import or a description of what the target does.
 *  - C_FINDING: a defect / bug assertion proven by a code pattern.
 *  - C_STRUCTURAL: presence/absence of declarations, configurations, imports.
 */
export type ClaimCategory =
  | "C_BEHAVIOR"
  | "C_PRODUCTION_REACHABILITY"
  | "C_FINDING"
  | "C_STRUCTURAL";
export function buildBehaviorFindingStatus(input: {
  behaviorSupported: boolean;
  behaviorRequested: boolean;
  findingProven: boolean;
}): BehaviorFindingStatus {
  const { behaviorSupported, behaviorRequested, findingProven } = input;
  if (!behaviorRequested) {
    return { behavior: "NO_BEHAVIOR_REQUESTED", finding: findingProven ? "PROVEN" : "NONE", behaviorUnsupported: false };
  }
  return {
    behavior: behaviorSupported ? "PROVEN" : "NOT_PROVEN",
    finding: findingProven ? "PROVEN" : "NONE",
    behaviorUnsupported: !behaviorSupported,
  };
}

// ── EI-011/012 Run Ledger + Telemetry Reconciliation ───────────────────────────

/**
 * The core inconsistency the plan targets: a packet may claim `1 implementation
 * file` while the run recorded `0 completed source reads`. This reconciles the
 * ledger and fails closed.
 */
export function buildRunLedger(input: {
  runId: string;
  taskId?: string;
  evidenceRecords: EvidenceRecord[];
  claims: ClaimRecord[];
  validations: ClaimValidation[];
  recoveryAttempts?: number;
  acceptedEvidenceCount?: number;
  finalResult?: BehaviorFindingStatus;
  sourceCoverage?: CanonicalSourceCoverage;
}): RunLedger {
  const {
    runId,
    taskId,
    evidenceRecords,
    claims,
    validations,
    recoveryAttempts = 0,
    finalResult,
    sourceCoverage,
  } = input;
  const completed = evidenceRecords.filter(
    (record) => (record.readType === "COMPLETE" || record.readType === "TARGETED") && !record.originRunId,
  );
  const readAttempts = evidenceRecords.length;
  const completedReads = completed.length;
  const targetedReads = evidenceRecords.filter((record) => record.readType === "TARGETED").length;
  const cachedReads = evidenceRecords.filter((record) => record.readType === "CACHED").length;
  const uniqueFilesRead = new Set(completed.map((record) => record.file)).size;
  const evidenceFileCount = new Set(evidenceRecords.map((record) => record.file)).size;
  const acceptedEvidenceCount = evidenceRecords.filter((record) => record.phase === "EVIDENCE_ACCEPTED").length;
  const completedReadFiles = [...new Set(completed.map((record) => record.file))];
  const retainedBodyFiles = [
    ...new Set(
      evidenceRecords
        .filter((record) => record.readType === "COMPLETE" || record.readType === "TARGETED")
        .map((record) => record.file),
    ),
  ];
  const acceptedEvidenceFiles = [
    ...new Set(
      evidenceRecords
        .filter((record) => record.phase === "EVIDENCE_ACCEPTED")
        .map((record) => record.file),
    ),
  ];
  const provenClaims = validations.filter((v) => v.result === "PROVEN").length;
  const verdictScope = deriveVerdictScope(evidenceRecords);
  const scopedFindingStatus = deriveScopedFindingStatus(evidenceRecords);
  return {
    runId,
    taskId,
    readAttempts,
    completedReads,
    targetedReads,
    cachedReads,
    uniqueFilesRead,
    completedReadFiles,
    retainedBodyFiles,
    acceptedEvidenceFiles,
    acceptedClaimCount: provenClaims,
    sourceCoverage,
    evidenceRecords,
    evidenceFileCount,
    claims,
    validations,
    acceptedEvidenceCount,
    provenClaims,
    recoveryAttempts,
    scopeExpansions: [],
    unjustifiedReads: [],
    verdictScope,
    scopedFindingStatus,
    finalResult,
  };
}

/**
 * EI-011/EI-012: enforce the counter invariants:
 *   uniqueFilesRead == distinct completed SOURCE_READ records
 *   evidenceFileCount <= uniqueFilesRead
 *   acceptedEvidenceCount <= evidenceRecords
 *   provenClaims <= claims
 * Any violation ⇒ TELEMETRY_INCONSISTENT, which must block PROVEN/PASS output.
 */
export function validateTelemetry(ledger: RunLedger): TelemetryReconciliation {
  const violations: string[] = [];
  const completedRecords = ledger.evidenceRecords.filter(
    (record) => (record.readType === "COMPLETE" || record.readType === "TARGETED") && !record.originRunId,
  );
  const distinctCompleted = new Set(completedRecords.map((record) => record.file)).size;
  // EI-026: completedReads = count(COMPLETED source reads).
  if (ledger.completedReads !== completedRecords.length) {
    violations.push(
      `completedReads ${ledger.completedReads} != count(COMPLETED source reads) ${completedRecords.length}`,
    );
  }
  // EI-026: uniqueFiles = distinct(files in COMPLETED source reads).
  if (ledger.uniqueFilesRead !== distinctCompleted) {
    violations.push(
      `uniqueFilesRead ${ledger.uniqueFilesRead} != distinct completed SOURCE_READ records ${distinctCompleted}`,
    );
  }
  // EI-026: evidenceFiles <= uniqueFiles.
  if (ledger.evidenceFileCount > ledger.uniqueFilesRead) {
    violations.push(
      `evidenceFileCount ${ledger.evidenceFileCount} > uniqueFilesRead ${ledger.uniqueFilesRead} (evidence without a completed read)`,
    );
  }
  // EI-026: acceptedEvidence <= evidenceRecords.
  if (ledger.acceptedEvidenceCount > ledger.evidenceRecords.length) {
    violations.push(
      `acceptedEvidenceCount ${ledger.acceptedEvidenceCount} > evidenceRecords ${ledger.evidenceRecords.length}`,
    );
  }
  // EI-026: provenClaims <= claims.
  if (ledger.provenClaims > ledger.claims.length) {
    violations.push(`provenClaims ${ledger.provenClaims} > claims ${ledger.claims.length}`);
  }
  // EI-031: a PRODUCTION verdict requires at least one production-grade window.
  // fixture/test/spec-only evidence can never assert production proof.
  if (ledger.verdictScope === "PRODUCTION") {
    const hasProductionEvidence = ledger.evidenceRecords.some(
      (record) => record.sourceScope === "PRODUCTION" || record.sourceScope === "GENERATED",
    );
    if (!hasProductionEvidence) {
      violations.push(
        "verdictScope PRODUCTION asserted with no production-source evidence (EI-031 scope escalation)",
      );
    }
  }
  const lineage = validateEvidenceLineage(ledger.evidenceRecords);
  violations.push(...lineage);
  // AI-OBJ-011: fail-closed objective completion telemetry. Whenever the run
  // declared an objective (objectiveType present), the remaining objective
  // fields must reconcile exactly with the completion gate verdict and the
  // evidence counts — otherwise the run's objective telemetry is judged
  // inconsistent and the verdict is blocked. A malformed objective status must
  // never pass silently as a completed production-reachability proof.
  if (ledger.objectiveType !== undefined) {
    if (
      ledger.requiredClaims === undefined ||
      ledger.completedClaims === undefined ||
      ledger.missingClaims === undefined
    ) {
      violations.push(
        "objective telemetry incomplete: requiredClaims/completedClaims/missingClaims all required when objectiveType is set",
      );
    } else {
      const missingSet = new Set(ledger.missingClaims);
      const overlap = ledger.completedClaims.filter((c) => missingSet.has(c));
      if (overlap.length > 0) {
        violations.push(`objective claims overlap completed+missing: ${overlap.join(", ")}`);
      }
      for (const c of ledger.completedClaims) {
        if (!ledger.requiredClaims.includes(c)) {
          violations.push(`completedClaims ${c} is not a required claim`);
        }
      }
      for (const c of ledger.missingClaims) {
        if (!ledger.requiredClaims.includes(c)) {
          violations.push(`missingClaims ${c} is not a required claim`);
        }
      }
      if (
        ledger.completedClaims.length + ledger.missingClaims.length !==
        ledger.requiredClaims.length
      ) {
        violations.push(
          `objective claim counts misaligned: completed ${ledger.completedClaims.length} + missing ${ledger.missingClaims.length} != required ${ledger.requiredClaims.length}`,
        );
      }
    }
    if (ledger.scopeExpansions === undefined || ledger.unjustifiedReads === undefined) {
      violations.push(
        "objective telemetry incomplete: scopeExpansions/unjustifiedReads are required when objectiveType is set",
      );
    } else {
      const unjustifiedFromExpansions = ledger.scopeExpansions
        .filter((expansion) => expansion.kind === "UNJUSTIFIED_SCOPE_EXPANSION")
        .map((expansion) => expansion.path);
      const missingUnjustifiedTelemetry = unjustifiedFromExpansions.filter(
        (path) => !ledger.unjustifiedReads!.includes(path),
      );
      if (missingUnjustifiedTelemetry.length > 0) {
        violations.push(
          `unjustified scope expansions missing from unjustifiedReads: ${missingUnjustifiedTelemetry.join(", ")}`,
        );
      }
      const foreignUnjustifiedReads = ledger.unjustifiedReads.filter(
        (path) => !unjustifiedFromExpansions.includes(path),
      );
      if (foreignUnjustifiedReads.length > 0) {
        violations.push(
          `unjustifiedReads not represented by scopeExpansions: ${foreignUnjustifiedReads.join(", ")}`,
        );
      }
      if (ledger.unjustifiedReads.length > 0 && ledger.completionGateResult === "PROVEN") {
        violations.push("completionGateResult PROVEN with unjustified objective scope reads");
      }
    }
    // Required edges must be fully partitioned into proven + failed (no
    // overlap, no gaps) so the gate's edge verdict is auditable.
    if (ledger.requiredEdges !== undefined) {
      const failedSet = new Set(ledger.failedEdges ?? []);
      const edgeOverlap = (ledger.provenEdges ?? []).filter((e) => failedSet.has(e));
      if (edgeOverlap.length > 0) {
        violations.push(`objective edges overlap proven+failed: ${edgeOverlap.join(", ")}`);
      }
      const accounted = [...(ledger.provenEdges ?? []), ...(ledger.failedEdges ?? [])];
      const unaccounted = ledger.requiredEdges.filter((e) => !accounted.includes(e));
      const foreign = accounted.filter((e) => !ledger.requiredEdges!.includes(e));
      if (unaccounted.length > 0) {
        violations.push(`required edges unaccounted for: ${unaccounted.join(", ")}`);
      }
      if (foreign.length > 0) {
        violations.push(`proven/failed edges not required: ${foreign.join(", ")}`);
      }
    }
    // Completion verdict consistency: a PROVEN gate result may never be
    // recorded alongside missing claims/edges. Conversely, a gate result that
    // is "*not* blocked" (PROVEN or PARTIALLY_PROVEN) may never be recorded
    // while zero required claims/edges are proven. The special failure statuses
    // (OBJECTIVE_MISMATCH, RECOVERY_SCOPE_FAILURE) and NOT_PROVEN/BLOCKED do not
    // promise any proof, so they are exempt.
    if (ledger.completionGateResult === "PROVEN") {
      if ((ledger.missingClaims?.length ?? 0) > 0) {
        violations.push("completionGateResult PROVEN but missingClaims is non-empty");
      }
      if ((ledger.failedEdges?.length ?? 0) > 0) {
        violations.push("completionGateResult PROVEN but failedEdges is non-empty");
      }
    } else if (
      ledger.completionGateResult !== undefined &&
      ledger.completionGateResult !== "NOT_PROVEN" &&
      ledger.completionGateResult !== "BLOCKED" &&
      ledger.completionGateResult !== "OBJECTIVE_MISMATCH" &&
      ledger.completionGateResult !== "RECOVERY_SCOPE_FAILURE"
    ) {
      const anyProven =
        (ledger.completedClaims?.length ?? 0) > 0 || (ledger.provenEdges?.length ?? 0) > 0;
      if (!anyProven) {
        violations.push(
          `completionGateResult ${ledger.completionGateResult} recorded with zero proven claims/edges`,
        );
      }
    }
  }
  if (violations.length > 0) return { consistent: false, code: "TELEMETRY_INCONSISTENT", violations };
  return { consistent: true };
}

/**
 * AI-OBJ-011: attach objective completion telemetry onto a RunLedger from a
 * computed gate result. Returns a new ledger (the original is untouched). When
 * no objective was declared, or the gate is null, returns the ledger unchanged.
 * The callback may supply the recovery flag/target so recovery-triggered runs
 * are recorded too.
 */
export function attachObjectiveTelemetry(
  ledger: RunLedger,
  gate: ObjectiveCompletionGateResult | null,
  objective: { objectiveType: string } | undefined,
  recovery?: { triggered?: boolean; target?: string },
): RunLedger {
  if (!objective || !gate) return ledger;
  return {
    ...ledger,
    objectiveType: objective.objectiveType,
    requiredClaims: gate.requiredClaims,
    completedClaims: gate.completedClaims,
    missingClaims: gate.missingClaims,
    requiredEdges: gate.requiredEdges,
    provenEdges: gate.provenEdges,
    failedEdges: gate.missingEdges,
    recoveryTriggered: Boolean(recovery?.triggered),
    recoveryTarget: recovery?.target,
    completionGateResult: gate.status,
    finalAnswerType:
      gate.status === "PROVEN"
        ? "PRODUCTION_REACHABILITY_ANSWER"
        : gate.answerTypeMismatch
          ? "BEHAVIORAL_ANSWER"
          : "NO_ANSWER",
  };
}

// ── EI-015 Evidence-Backed Final Answer ────────────────────────────────────────

export type EvidenceBackedAnswer = {
  answer: string;
  claimIds: string[];
  evidenceIds: string[];
  status: "PROVEN" | "NOT_PROVEN";
};

/** Render a behavioral answer that is only allowed outward once its claims are PROVEN. */
export function buildEvidenceBackedAnswer(input: {
  answer: string;
  claims: readonly ClaimRecord[];
  validations: readonly ClaimValidation[];
}): EvidenceBackedAnswer {
  const provenClaims = input.claims.filter((claim) =>
    input.validations.some(
      (v) => v.claimId === claim.claimId && v.result === "PROVEN",
    ),
  );
  return {
    answer: input.answer,
    claimIds: provenClaims.map((claim) => claim.claimId),
    evidenceIds: provenClaims.flatMap((claim) => claim.evidenceIds),
    status: provenClaims.length > 0 ? "PROVEN" : "NOT_PROVEN",
  };
}

// ── EI-016 Claim-oriented evidence map ─────────────────────────────────────────

/**
 * Never render "this file was read". Render "these lines prove this behavior".
 * Each entry names the claim, the binding, and the exact supporting spans.
 */
export function buildClaimOrientedEvidenceMap(
  claims: readonly ClaimRecord[],
  records: readonly EvidenceRecord[],
): string[] {
  const lines: string[] = [];
  for (const claim of claims) {
    const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
    if (bound.length === 0) {
      lines.push(`⚠️ claim "${claim.text}" has no bound evidence`);
      continue;
    }
    for (const record of bound) {
      const span = record.sourceSpan
        ? `:${record.sourceSpan.startLine}-${record.sourceSpan.endLine}`
        : "";
      lines.push(`✔️ "${claim.text}" → ${record.file}${span} (${record.strength})`);
    }
  }
  return lines;
}

/**
 * Build a RunLedger from the runtime evidence already collected in chat-agent:
 * the retained file bodies (evidence windows) and the engine's source-retrieval
 * telemetry. This is the single reconciliation seam for EI-011.
 */
export function buildRuntimeLedger(input: {
  runId: string;
  taskId?: string;
  fileContents: ReadonlyMap<string, string>;
  /** Files cited by accepted behavior evidence (claim-relevant windows). */
  acceptedFiles?: string[];
  claims?: readonly ClaimRecord[];
  validations?: readonly ClaimValidation[];
  /** Engine source-retrieval telemetry (SR-008). */
  sourceRetrieval?: {
    readAttempts?: number;
    uniqueReads?: number;
    targetedReads?: number;
    cachedReads?: number;
    readPaths?: readonly string[];
    scopeExpansions?: readonly ScopeExpansion[];
  };
  /**
   * Prefetch completed reads (EI-011). Files retained as evidence bodies via
   * plan/graph/memory prefetch are genuine completed source reads, but the loop
   * engine telemetry (recordRead) never sees them. Fold them in explicitly so
   * the reconciled uniqueFilesRead reflects ALL completed reads this run —
   * otherwise a well-formed prefetch-only run would report 0 reads and trip
   * INCONSISTENT purely because prefetch escapes the loop counter.
   */
  prefetchReads?: number;
  /**
   * Prefer the concrete prefetch paths when available. A count alone cannot
   * distinguish a prefetch that duplicates a loop read or a recovery window,
   * which can inflate uniqueFilesRead and trip EI-026.
   */
  prefetchPaths?: readonly string[];
  recoveryAttempts?: number;
  finalResult?: BehaviorFindingStatus;
  /**
   * EI-017/018: pre-built targeted evidence records produced during claim
   * recovery. These carry `readType: "TARGETED"`, a `recoveryAttemptId`, and
   * the same `runId` as the enclosing run — they are appended to the normal
   * complete-read records so they appear in the run ledger and contribute to
   * `targetedReads` / `recoveryAttempts` counters.
   */
  additionalRecoveryRecords?: readonly EvidenceRecord[];
  /** Deterministic source/root coverage for the same run. */
  sourceCoverage?: CanonicalSourceCoverage;
}): RunLedger {
  const {
    runId,
    taskId,
    fileContents,
    acceptedFiles = [],
    claims = [],
    validations = [],
    sourceRetrieval,
    prefetchReads = 0,
    prefetchPaths = [],
    recoveryAttempts = 0,
    finalResult,
    additionalRecoveryRecords = [],
    sourceCoverage,
  } = input;
  const records: EvidenceRecord[] = [];
  for (const [file, content] of fileContents) {
    const isAccepted = acceptedFiles.includes(file);
    const record = createEvidenceRecord({
      runId,
      taskId,
      file,
      content,
      readType: "COMPLETE",
      phase: isAccepted ? "EVIDENCE_ACCEPTED" : "EVIDENCE_CREATED",
      sourceType: classifySourcePath(file),
    });
    records.push(record);
  }
  // EI-018: append targeted recovery records (already tagged with recoveryAttemptId).
  for (const rec of additionalRecoveryRecords) {
    records.push(rec);
  }
  const ledger = buildRunLedger({
    runId,
    taskId,
    evidenceRecords: records,
    claims: [...claims],
    validations: [...validations],
    recoveryAttempts,
    finalResult,
    sourceCoverage,
  });
  // EI-011: the ledger's uniqueFilesRead must come from the reconciled engine
  // telemetry (loop uniqueReads + prefetch completed reads), NOT re-derived
  // from retained bodies. Prefetch reads are folded in explicitly (they are
  // genuine completed reads the loop counter never sees); any residual gap
  // between evidenceFileCount and uniqueFilesRead is a real telemetry loss that
  // must fail closed — never masked by a silent evidence-derived fallback.
  const observedReadPaths = new Set([
    ...(sourceRetrieval?.readPaths ?? []),
    ...prefetchPaths,
    ...additionalRecoveryRecords.map((record) => record.file),
  ]);
  const reconciledUniqueReads =
    observedReadPaths.size > 0
      ? observedReadPaths.size
      : (sourceRetrieval?.uniqueReads ?? 0) + prefetchReads;
  const scopeExpansions = [...(sourceRetrieval?.scopeExpansions ?? [])];
  const unjustifiedReads = scopeExpansions
    .filter((expansion) => expansion.kind === "UNJUSTIFIED_SCOPE_EXPANSION")
    .map((expansion) => expansion.path);
  return {
    ...ledger,
    uniqueFilesRead: reconciledUniqueReads,
    scopeExpansions,
    unjustifiedReads,
  };
}

function classifySourcePath(file: string): EvidenceSourceType {
  if (/(?:^|\/)(?:__tests__|test|tests|spec|specs|fixtures?)\b/i.test(file)) return "TEST";
  if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s|\.env\b)/i.test(file)) {
    return "CONFIG";
  }
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i.test(file)) return "IMPLEMENTATION";
  return "UNKNOWN";
}

// ── EI-017/018 Recovery ────────────────────────────────────────────────────────

/**
 * Parse the output of `search_code` (grep) and return the first line number
 * whose project-relative file path exactly equals `targetFile`. Returns
 * `undefined` when no match is found in `targetFile` — callers must skip the
 * targeted read rather than falling back to an unanchored default line.
 *
 * grep output format (after root-prefix stripping): `path/to/file:N:content`
 * or `path/to/file:N-content` (context lines). We match both separators.
 *
 * This is a pure helper exported for testability; it is intentionally separate
 * from the recovery orchestration so it can be covered by cheap unit tests.
 */
export function findAnchorInSearchOutput(
  searchOut: string,
  targetFile: string,
): number | undefined {
  for (const line of searchOut.split("\n")) {
    const m = line.match(/^(.+?):(\d+)[:-]/);
    if (m && m[1] === targetFile) {
      return parseInt(m[2], 10);
    }
  }
  return undefined;
}

/**
 * When a claim fails validation (CLAIM_UNSUPPORTED), recovery targets the
 * claim's symbol with a targeted read rather than re-scanning the tree.
 * Returns the read attempt id to persist on recovered evidence (EI-018).
 */
export function planEvidenceRecovery(claim: ClaimRecord): {
  recoveryAttemptId: string;
  missingSymbol: string;
  targetedRead: { path: string; symbol: string };
} {
  const recoveryAttemptId = seqId("REC");
  const missingSymbol = claim.symbol ?? "symbol";
  return {
    recoveryAttemptId,
    missingSymbol,
    targetedRead: { path: claim.symbol ?? "(resolve symbol)", symbol: missingSymbol },
  };
}

/** EI-018: tag recovered evidence with the recovery attempt id + bump recovery count. */
export function tagRecoveredEvidence(
  record: EvidenceRecord,
  recoveryAttemptId: string,
): EvidenceRecord {
  return { ...record, recoveryAttemptId };
}

// ── AI-OBJ-005 Objective Completion Gate ────────────────────────────────────────

/**
 * The gate's verdict. PROVEN/PARTIALLY_PROVEN/NOT_PROVEN describe the objective's
 * evidence quality; BLOCKED is the fail-closed outcome when the objective cannot
 * be completed with the evidence at hand and the run MUST NOT emit a final answer.
 */
export type ObjectiveCompletionStatus =
  | "PROVEN"
  | "PARTIALLY_PROVEN"
  | "NOT_PROVEN"
  | "BLOCKED"
  /**
   * AI-OBJ-009/013-T5: recovery exceeded the bounded objective scope (read
   * non-required files) while trying to close a missing edge/symbol. A
   * production-reachability objective may never be finalized from an
   * unjustified over-broad recovery scan.
   */
  | "RECOVERY_SCOPE_FAILURE"
  /**
   * AI-OBJ-007/013-T6: the model answered with a behavioral explanation of the
   * target instead of a production-reachability proof. A behavioral excerpt can
   * never satisfy a reachability claim, so the objective is refused regardless
   * of any evidence an explanation happens to contain.
   */
  | "OBJECTIVE_MISMATCH";

/**
 * AI-OBJ-005: every required edge a run must *directly prove* about a declared
 * objective. Structural shape only (keeps this pure module cycle-free).
 */
export type ObjectiveEvidenceEdgeRef = {
  from: string;
  to: string;
  relationship?: string;
};

/**
 * AI-OBJ-014: strip a path-qualified edge/link endpoint (`path#symbol`) down to
 * its symbol segment. Bare ids ("executor:run", "getGraphCentrality") are
 * returned unchanged. Used to anchor runtime derivations to retained reads.
 */
export function symbolOfPathQualified(id: string): string {
  const hash = id.lastIndexOf("#");
  return hash >= 0 ? id.slice(hash + 1) : id.trim();
}

/**
 * AI-OBJ-013/014: the bounded file scope a PRODUCTION_REACHABILITY objective
 * actually declares. Only derivable when EVERY required edge endpoint is
 * path-qualified (`path#symbol`); a bare-symbol objective ("getGraphCentrality")
 * carries no file bound and returns `null` (indeterminate) so callers never
 * flag a violation they cannot substantiate. Never derived from what was read.
 */
export function deriveObjectiveBoundedFileScope(
  objective: {
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | undefined,
): Set<string> | null {
  const edges = objective?.requiredEvidenceEdges ?? [];
  if (edges.length === 0) return null;
  const files = new Set<string>();
  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      const m = /^(.*?)#[^#]+$/.exec(endpoint);
      if (!m) return null; // bare-symbol endpoint => no derivable bound
      files.add(m[1]!);
    }
  }
  return files.size > 0 ? files : null;
}

/**
 * AI-OBJ-007/013-T6: a candidate is an *answer-type mismatch* when the model
 * answered a PRODUCTION_REACHABILITY objective with accepted behavior evidence
 * (a behavioral substitute) while NO required reachability edge is directly
 * proven. Reviewer constraint honored: only gated for reachability objectives
 * (never behavior objectives), and accepted behavior EVIDENCE is required — an
 * explicit behavior query alone is not proof of a behavioral substitute run.
 */
export function deriveObjectiveAnswerTypeMismatch(input: {
  objective?: {
    objectiveType?: string;
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | null;
  /** True when behavior evidence was actually accepted for the candidate. */
  hasAcceptedBehaviorEvidence: boolean;
  provenEdges?: readonly { from?: string; to?: string }[];
}): boolean {
  const objective = input.objective;
  if (!objective || objective.objectiveType !== "PRODUCTION_REACHABILITY") return false;
  const edges = objective.requiredEvidenceEdges ?? [];
  if (edges.length === 0) return false;
  if (!input.hasAcceptedBehaviorEvidence) return false;
  const provenKeys = new Set(
    (input.provenEdges ?? [])
      .filter((e) => e.from && e.to)
      .map((e) => `${e.from}->${e.to}`),
  );
  const anyEdgeProven = edges.some((e) => provenKeys.has(`${e.from}->${e.to}`));
  return !anyEdgeProven;
}

/**
 * Syntax-aware source parse helper. Parses a retained body as a TypeScript
 * source file so declaration nodes and genuine call sites can be told apart
 * structurally instead of by fragile regex prefix matching. Files whose
 * extension is not TS/JS are parsed in JS mode (best-effort); callers only use
 * this for the reachability edge proof, so an unrecognisable body simply yields
 * no call sites and the edge stays unproven (fail-closed).
 */
function parseRetainedSource(body: string, file = "retained.ts"): ts.SourceFile {
  const isTs = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(file);
  return ts.createSourceFile(
    file,
    body,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
}

/**
 * True when `expr` is a callable reference that resolves to `sym`: a bare
 * identifier `sym(...)` OR a property-access / element-access callee whose bound
 * name is `sym` (e.g. `obj.sym(...)`, `this.sym(...)`, `ns["sym"](...)`).
 * A MethodDeclaration / object-shorthand method `computeCentrality(graph) {}`
 * is NOT a CallExpression, so it is structurally excluded here.
 */
function calleeResolvesTo(expr: ts.Expression, sym: string): boolean {
  if (ts.isIdentifier(expr)) return expr.text === sym;
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name;
    return ts.isIdentifier(name) ? name.text === sym : name.text === sym;
  }
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    return ts.isStringLiteral(arg) ? arg.text === sym : false;
  }
  return false;
}

function sourceLineAt(body: string, pos: number): string {
  const lineStart = body.lastIndexOf("\n", pos) + 1;
  const lineEnd = body.indexOf("\n", pos);
  return body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd).trim();
}

/**
 * Genuine call sites in `body` invoking `sym`. Only true `CallExpression` /
 * `NewExpression` nodes qualify — function/method/typed-method/interface
 * declarations are different AST node kinds and can never be returned here.
 */
function invocationSitesFor(body: string, sym: string, file?: string): string[] {
  const source = parseRetainedSource(body, file);
  const lines: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (calleeResolvesTo(node.expression, sym)) {
        lines.push(sourceLineAt(body, node.getStart(source)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/**
 * AI-OBJ-013/014: direct invocation site of `sym` inside a retained body, or
 * `null` when the only appearances are imports/declarations. A bare `import { x }`,
 * `function x(`, an object/class method shorthand `x(...) {...}`, or a typed
 * method `x(...): T` are all declaration AST nodes and are NEVER returned here —
 * only a genuine `x(...)` call expression proves a runtime invocation.
 */
export function directInvocationEvidence(body: string, sym: string): string | null {
  return invocationSitesFor(body, sym)?.[0] ?? null;
}

/**
 * AI-OBJ-014 (review fix 3): derive runtime-observed production edges from the
 * run's *retained reads* (the intended runtime-observation path) instead of
 * injecting pre-fabricated `productionTraceLinks`. An objective edge `from->to`
 * is proven only when a retained PRODUCTION read (a) structurally DECLARES the
 * `from` symbol as a callable scoped object and (b) contains a DIRECT invocation
 * of the `to` symbol INSIDE that caller's body.
 *
 * Unlike the earlier co-occurrence test (which only required `from` to appear
 * somewhere in the file), the invocation is now BOUND to the caller: it must
 * live within a function-like node named `from`, not merely in the same file.
 * For a path-qualified `from` endpoint (`path#symbol`), the retained file must
 * also be the declared caller file.
 */
export function deriveObjectiveRuntimeEdgesFromRetainedReads(input: {
  objective?: {
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | null;
  fileContents: ReadonlyMap<string, string>;
}): { from: string; to: string; source?: string; evidence?: string }[] {
  const edges = input.objective?.requiredEvidenceEdges ?? [];
  if (edges.length === 0 || input.fileContents.size === 0) return [];
  const out: { from: string; to: string; source?: string; evidence?: string }[] = [];
  for (const edge of edges) {
    const rawFrom = symbolOfPathQualified(edge.from);
    const toSym = symbolOfPathQualified(edge.to);
    if (!rawFrom || !toSym) continue;
    const fromFile = pathSegmentOfQualified(edge.from);

    for (const [file, body] of input.fileContents) {
      if (classifySourceScope(file) !== "PRODUCTION") continue;
      if (fromFile) {
        const f = normalizeScopePath(file);
        if (f !== fromFile && !f.endsWith(`/${fromFile}`) && !fromFile.endsWith(`/${f}`)) continue;
      }
      // Structurally bind the invocation to the caller's body.
      const evidence = invocationInsideCaller(body, rawFrom, toSym, file);
      if (evidence) {
        out.push({ from: edge.from, to: edge.to, source: file, evidence });
        break;
      }
    }
  }
  return out;
}

/** Normalise a file path for caller-file binding (leading `./`, backslashes). */
function normalizeScopePath(pathLike: string): string {
  return pathLike.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

/** The `path` segment of a `path#symbol` endpoint, or `null` when not qualified. */
function pathSegmentOfQualified(endpoint: string): string | null {
  const m = /^(.*?)#[^#]+$/.exec(endpoint);
  return m ? normalizeScopePath(m[1]!) : null;
}

/**
 * Find a genuine `toSym(...)` call that lives within a function-like node named
 * `callerSym` in `body`. Returns the call's source line, or `null`. This binds
 * the edge proof to the caller's actual body rather than symbol co-occurrence.
 */
function invocationInsideCaller(
  body: string,
  callerSym: string,
  toSym: string,
  file: string,
): string | null {
  const source = parseRetainedSource(body, file);
  const callers: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    const nameOf = (n?: ts.Node): string | undefined =>
      n && ts.isIdentifier(n) ? n.text : undefined;
    if (ts.isFunctionDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isMethodDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isClassDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isVariableDeclaration(node) && nameOf(node.name) === callerSym) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) callers.push(node);
    } else if (ts.isPropertyAssignment(node) && nameOf(node.name) === callerSym) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) callers.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (callers.length === 0) return null;
  // Search within each caller subtree — a call to `toSym` only counts if it is
  // actually inside the caller's body, never a same-file independent occurrence.
  for (const caller of callers) {
    let found: string | null = null;
    const scan = (node: ts.Node): boolean => {
      if (found) return true;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (calleeResolvesTo(node.expression, toSym)) {
          found = sourceLineAt(body, node.getStart(source));
          return true;
        }
      }
      return ts.forEachChild(node, scan) as unknown as boolean;
    };
    scan(caller);
    if (found) return found;
  }
  return null;
}

export type ObjectiveCompletionGateResult = {
  status: ObjectiveCompletionStatus;
  /** True only when status === "PROVEN" — the only state that may finalize. */
  complete: boolean;
  /** True when the gate refuses finalization (NOT PROVEN or PARTIALLY PROVEN). */
  blocked: boolean;
  /** The declared objective's required claim ids (AI-OBJ-011). */
  requiredClaims: string[];
  /** Required claim ids the run actually closed with direct evidence (AI-OBJ-011). */
  completedClaims: string[];
  /** Objective claim ids that are still UNCLOSED. */
  missingClaims: string[];
  /** The declared objective's required edge keys (`from->to`) (AI-OBJ-011). */
  requiredEdges: string[];
  /** Required edge keys (`from->to`) that lack direct proof. */
  missingEdges: string[];
  /** Required edge keys that ARE directly proven at runtime. */
  provenEdges: string[];
  /** Whether the candidate answer was a behavioral substitute (object kind) for
   *  a production-reachability objective (AI-OBJ-007/013-T6), when detected. */
  answerTypeMismatch: boolean;
  /** Whether recovery exceeded the bounded objective scope (AI-OBJ-009/013-T5). */
  recoveryScopeViolated: boolean;
  /** Human-readable reason for the verdict, usage bounded. */
  reasons: string[];
};

/**
 * AI-OBJ-005: the Objective Completion Gate. Runs BEFORE a final answer is
 * emitted and refuses finalization while any required claim or required evidence
 * edge is unproven. Import/package membership can never satisfy an edge — only a
 * directly proven, runtime-observed edge carried in `provenEdges` does.
 *
 * - PROVEN: every required claim and required edge is closed/proven.
 * - PARTIALLY_PROVEN: at least one required element is proven but not all.
 * - NOT_PROVEN: no required claim/edge is proven (nothing to sustain the objective).
 * - BLOCKED: the declared objective cannot be completed; combined with the
 *   caller's must-complete policy this fails closed and emits NO final answer.
 */
export function objectiveCompletionGate(input: {
  ledger: RunLedger;
  objective: {
    objectiveType: string;
    requiredClaims: readonly { claimId: string; text: string }[];
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  };
  /** Directly proven reachability edges from this run (runtime/evidence proof only). */
  provenEdges?: readonly { from?: string; to?: string }[];
  /**
   * Claim ids already closed by the run (e.g. via closeObjectiveClaimsFromEdges).
   * Falls back to any PROVEN/SUPPORTED ledger claim when not supplied.
   */
  closedClaimIds?: readonly string[];
  /**
   * AI-OBJ-009/013-T5: true when recovery reads stepped outside the bounded
   * objective scope (non-required files) while closing a missing edge/symbol.
   * Enforced fail-closed: an over-broad recovery scan can never finalize the
   * objective, even if some evidence was collected.
   */
  recoveryScopeViolated?: boolean;
  /**
   * AI-OBJ-007/013-T6: true when the candidate answer is a behavioral
   * explanation of the target rather than a production-reachability proof.
   * A behavioral excerpt can never satisfy a reachability claim.
   */
  answerTypeMismatch?: boolean;
}): ObjectiveCompletionGateResult {
  const { ledger, objective } = input;
  const provenEdgeKeys = new Set(
    (input.provenEdges ?? [])
      .filter((e) => e.from && e.to)
      .map((e) => `${e.from}->${e.to}`),
  );
  // Claim closure: prefer explicit closedClaimIds, else use ledger claims that
  // reached SUPPORTED with a matching objective-scoped claimId.
  const suppliedClosed = new Set(input.closedClaimIds ?? []);

  const missingClaims = objective.requiredClaims
    .filter((rc) => {
      const objectiveId = `objective:${rc.claimId}`;
      if (suppliedClosed.has(rc.claimId) || suppliedClosed.has(objectiveId)) return false;
      if (ledger.claims.some((c) => c.claimId === objectiveId && c.status === "SUPPORTED")) {
        return false;
      }
      return true;
    })
    .map((rc) => rc.claimId);

  const requiredEdgeKeys = (objective.requiredEvidenceEdges ?? []).map(
    (e) => `${e.from}->${e.to}`,
  );
  const missingEdges = requiredEdgeKeys.filter((k) => !provenEdgeKeys.has(k));
  const provenEdges = requiredEdgeKeys.filter((k) => provenEdgeKeys.has(k));

  const allClosed = missingClaims.length === 0 && missingEdges.length === 0;
  // "Any proven" means at least ONE required element — a required claim closed
  // OR a required edge directly proven — is actually demonstrated. A closed
  // claim is itself proof, so it counts here, not merely ledger.provenClaims.
  const closedRequiredClaimCount = objective.requiredClaims.length - missingClaims.length;
  const anyProven = provenEdges.length > 0 || closedRequiredClaimCount > 0;
  const hasEvidence = ledger.evidenceRecords.length > 0 || ledger.claims.length > 0;

  const completedClaims = objective.requiredClaims
    .map((rc) => rc.claimId)
    .filter((id) => !missingClaims.includes(id));

  const reasons: string[] = [];

  // Fail-closed precedence (AI-OBJ-013): the two scope/object-kind failures
  // override every evidence-quality verdict. Even a fully-evidenced objective
  // is refused if the model answered behaviorally (T6) or recovery over-read the
  // bounded scope (T5) — no amount of collected evidence repairs those.
  let status: ObjectiveCompletionStatus;
  if (input.answerTypeMismatch) {
    status = "OBJECTIVE_MISMATCH";
  } else if (input.recoveryScopeViolated) {
    status = "RECOVERY_SCOPE_FAILURE";
  } else if (allClosed && !hasEvidence) {
    status = "NOT_PROVEN";
  } else if (allClosed) {
    status = "PROVEN";
  } else if (anyProven) {
    status = "PARTIALLY_PROVEN";
  } else {
    status = hasEvidence ? "BLOCKED" : "NOT_PROVEN";
  }

  if (input.answerTypeMismatch) {
    reasons.push(
      "answer is a behavioral explanation of the target, not a production-reachability proof (AI-OBJ-007)",
    );
  }
  if (input.recoveryScopeViolated) {
    reasons.push(
      "recovery reads escaped the bounded objective scope; unjustified broad scan (AI-OBJ-009)",
    );
  }
  if (missingClaims.length) reasons.push(`unclosed required claims: ${missingClaims.join(", ")}`);
  if (missingEdges.length) reasons.push(`proved edges missing: ${missingEdges.join(", ")}`);

  return {
    status,
    complete: status === "PROVEN",
    blocked: status !== "PROVEN",
    requiredClaims: objective.requiredClaims.map((rc) => rc.claimId),
    completedClaims,
    missingClaims,
    requiredEdges: requiredEdgeKeys,
    missingEdges,
    provenEdges,
    answerTypeMismatch: Boolean(input.answerTypeMismatch),
    recoveryScopeViolated: Boolean(input.recoveryScopeViolated),
    reasons: reasons.slice(0, 6),
  };
}

export type FinalAnswerValidation = {
  verdict: ObjectiveVerdictKind;
  /**
   * Zero-length when verdict is ANSWER_COMPLETE; populated with structured
   * rule-violation strings (R1:…R6:) for every other verdict.
   */
  violations: string[];
};

/**
 * AI-OBJ-007: gate that rejects evidence before it enters claim validation if
 * the evidence does not prove the category of claim it is attached to.
 *
 * Rules enforced structurally (not via prompt):
 *  R0. C_PRODUCTION_REACHABILITY is fail-closed on missing snippet: an absent
 *      excerpt cannot prove that a caller reaches a target.
 *  R1. A CONTEXT_ONLY record can prove only C_STRUCTURAL.
 *  R2. A behavioral excerpt (pure algorithm body) cannot prove
 *      C_PRODUCTION_REACHABILITY.
 *  R3. Import / package-membership evidence cannot prove
 *      C_PRODUCTION_REACHABILITY.
 *  R4. For C_PRODUCTION_REACHABILITY + a non-empty snippet: the snippet must
 *      contain a positive invocation/data-flow pattern (allowlist). A snippet
 *      that avoids the behavioral/import denylists but contains no call-site is
 *      still rejected — ambiguous evidence cannot prove a caller reaches a
 *      target.
 *  R5. When `opts.targetSymbol` is provided the allowlist invocation must
 *      reference that specific symbol, not just any function. This prevents
 *      generic call-sites (e.g. `new Map()`) from satisfying a claim about
 *      `computeCentrality`.
 *  R6. A declaration is NOT a call-site. A function/class/object-shorthand
 *      method that *defines* the target (`computeCentrality(graph) {`, 
 *      `export function computeCentrality(`, `const f = (g) => …`) proves where
 *      the symbol is defined, not that it is invoked from a caller. Such excerpts
 *      are rejected for C_PRODUCTION_REACHABILITY even when they lexically
 *      contain `symbol(`, because R5 alone would wrongly read the method name
 *      as an invocation.
 *
 * `snippet` is the human-readable excerpt extracted from the source window
 * (the same text that appears in an EvidenceReference.excerpt).
 * Pass `opts.targetSymbol` (from `claim.symbol`) to enable symbol-specific
 * validation (R5).
 */
export function evidenceRelevanceGate(
  record: Pick<EvidenceRecord, "strength" | "file">,
  claimCategory: ClaimCategory,
  snippet = "",
  opts?: { targetSymbol?: string },
): EvidenceRelevanceVerdict {
  // Rule 1: CONTEXT_ONLY strength cannot prove behavioral / reachability / finding claims.
  if (record.strength === "CONTEXT_ONLY" && claimCategory !== "C_STRUCTURAL") {
    return {
      relevant: false,
      code: "RELEVANCE_MISMATCH",
      reason: `CONTEXT_ONLY evidence from ${record.file} cannot prove ${claimCategory} (AI-OBJ-007 R1)`,
    };
  }

  if (claimCategory === "C_PRODUCTION_REACHABILITY") {
    // Rule 0: fail-closed — absent snippet cannot prove a call-site relationship.
    if (!snippet) {
      return {
        relevant: false,
        code: "RELEVANCE_MISMATCH",
        reason:
          `no source excerpt was provided for ${record.file}; ` +
          `C_PRODUCTION_REACHABILITY requires a call-site snippet to prove that a caller ` +
          `actually invokes the target (AI-OBJ-007 R0)`,
      };
    }
    // Rule 6: a declaration is not a call-site. This is checked first so that a
    // definition of the target (method shorthand, class method, function
    // declaration, arrow assignment) is never treated as invocation evidence —
    // R5's `symbol(` match alone would otherwise accept the method name.
    const declarationGuard = DECLARATION_PATTERNS.find((re) => re.test(snippet));
    if (declarationGuard) {
      return {
        relevant: false,
        code: "RELEVANCE_MISMATCH",
        reason:
          `snippet from ${record.file} is a symbol declaration (${declarationGuard.source} match), ` +
          `not a call-site — a definition proves where the target lives, not that a caller ` +
          `invokes it, and cannot prove C_PRODUCTION_REACHABILITY (AI-OBJ-007 R6)`,
      };
    }
    // Rule 2: behavioral computation excerpts cannot prove reachability.
    // Exception: if the snippet also matches an INVOCATION_PATTERNS entry, the
    // snippet is a call-site — the function name may contain a behavioral keyword
    // (e.g. `computeCentrality`), but the line itself is an invocation, not a
    // description. Invocation evidence wins over the behavioral denylist.
    const snippetIsInvocation = INVOCATION_PATTERNS.some((re) => re.test(snippet));
    if (!snippetIsInvocation && BEHAVIORAL_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: "RELEVANCE_MISMATCH",
        reason:
          `behavioral excerpt from ${record.file} proves C_BEHAVIOR, not C_PRODUCTION_REACHABILITY — ` +
          `a call-site or data-flow span is required (AI-OBJ-007 R2)`,
      };
    }
    // Rule 3: import / package-membership evidence cannot prove reachability.
    if (IMPORT_MEMBERSHIP_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: "RELEVANCE_MISMATCH",
        reason:
          `import / package-membership excerpt from ${record.file} proves C_STRUCTURAL, ` +
          `not C_PRODUCTION_REACHABILITY — an invocation span is required (AI-OBJ-007 R3)`,
      };
    }
    // Rule 4: positive-evidence gate — the snippet must contain a recognisable
    // call-site or data-flow pattern.
    if (!INVOCATION_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: "RELEVANCE_MISMATCH",
        reason:
          `snippet from ${record.file} contains no recognisable invocation or data-flow pattern; ` +
          `a call-site excerpt (e.g. "return computeCentrality(graph, opts)") is required ` +
          `to prove C_PRODUCTION_REACHABILITY (AI-OBJ-007 R4)`,
      };
    }
    // Rule 5: symbol-specific invocation — when the target symbol is known the
    // snippet must contain an invocation of THAT symbol, not just any function.
    // This prevents generic call-sites (new Map(), fs.readFile(), etc.) from
    // satisfying a claim about a specific target.
    if (opts?.targetSymbol) {
      const symbolInvocationRe = new RegExp(`\\b${escapeRegExp(opts.targetSymbol)}\\s*\\(`);
      if (!symbolInvocationRe.test(snippet)) {
        return {
          relevant: false,
          code: "RELEVANCE_MISMATCH",
          reason:
            `snippet from ${record.file} contains no invocation of target symbol "${opts.targetSymbol}"; ` +
            `generic call-sites do not prove that a specific caller reaches this target (AI-OBJ-007 R5)`,
        };
      }
    }
  }

  return { relevant: true };
}

/**
 * Heuristic patterns that indicate a window is purely behavioral (describes what
 * a function *does*) rather than where it is *called from* in production.
 */
const BEHAVIORAL_PATTERNS: readonly RegExp[] = [
  // Algorithm / computation body patterns
  /\b(?:totalDegree|inDegree|outDegree|pageRank|betweenness|closeness)\b/,
  /\b(?:centrality|clustering|coefficient|eigenvector)\b/i,
  // Pure arithmetic expression (e.g. `= inDegree + outDegree`)
  /return\s+\w+\s*[+\-*/]\s*\w+/,
  // "Describes behaviour" narrative prose inside a code snippet
  /\/\/\s*(?:returns|computes|calculates|iterates|accumulates)\b/i,
];

export type EvidenceRelevanceVerdict =
  | { relevant: true }
  | { relevant: false; code: "RELEVANCE_MISMATCH"; reason: string };

/**
 * Heuristic patterns that indicate import / package membership rather than an
 * invocation or data-flow.
 */
const IMPORT_MEMBERSHIP_PATTERNS: readonly RegExp[] = [
  /^\s*import\s+/m,
  /^\s*from\s+['"][^'"]+['"]\s*import\b/m,
  /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/,
  /^\s*export\s*\{[^}]*\}\s*from\b/m,
  // package.json / tsconfig membership
  /["']dependencies["']/,
  /["']peerDependencies["']/,
];

/**
 * Positive invocation / data-flow patterns required for a snippet to prove
 * C_PRODUCTION_REACHABILITY. A snippet provided for a reachability claim must
 * contain at least ONE of these to be accepted — absence of behavioral patterns
 * is not sufficient; the snippet must positively demonstrate a call site or
 * data-flow relationship (AI-OBJ-007 R4 — positive-evidence gate).
 *
 * Patterns:
 *  - Method call:         `.methodName(`
 *  - Assignment from call:`= identifier(`
 *  - return invocation:   `return identifier(`
 *  - await invocation:    `await identifier`
 *  - Constructor call:    `new UpperCase(`
 *  - Pipe / then:         `.pipe(` / `.then(`
 */
const INVOCATION_PATTERNS: readonly RegExp[] = [
  /\.\w+\s*\(/,                       // .methodName(
  /=\s*[a-zA-Z_]\w*\s*\(/,           // = someFunc(
  /\breturn\s+[a-zA-Z_]\w*\s*\(/,    // return someFunc(
  /\bawait\s+[a-zA-Z_]\w*/,          // await someFunc
  /\bnew\s+[A-Z][a-zA-Z0-9_]*\s*\(/, // new ClassName(
  /\.(?:pipe|then|call|apply)\s*\(/,  // .pipe( / .then( / .call( / .apply(
  /^\s*[a-zA-Z_]\w*\s*\(/,           // standalone call at line start: computeCentrality(
];

/**
 * Declaration forms that must NOT be read as invocation evidence
 * (AI-OBJ-007 R6). A pattern here indicates the snippet *defines* a symbol
 * rather than calling it. Detection is structural so a method named like the
 * target (`computeCentrality(graph) { … }`, class shorthand, arrow assignment)
 * can never satisfy R5 on its own.
 */
const DECLARATION_PATTERNS: readonly RegExp[] = [
  // Named function declaration: `function foo(`, `export function foo(`,
  // `export default function foo(`, `async function foo(`
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+/,
  // Function expression-ish arrow assignment: `const foo = (…)=>` / `… = (…)=>`
  /=\s*(?:async\s+)?\([^=]*?\)\s*=>/,
  /=\s*(?:async\s+)?\w+\s*=>/,
  // Class declaration
  /^\s*(?:export\s+)?(?:default\s+)?class\s+\w+/,
  // Class method shorthand:  `fooBar(…) {` at line start (also covers object
  // literal shorthand methods and getters/setters). Anchored so a standalone
  // call-line like `computeCentrality(graph, …);` is NOT rejected.
  /^\s*(?:(?:async|get|set)\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:/, // `name(args): Type` after param close
  /^\s*(?:(?:async|get|set)\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/, // `name(args) {`
  // `constructor(…)` / class-constructor style
  /^\s*constructor\s*\(/,
];
/** Escape a string for use in a RegExp so symbol names with special chars are safe. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * AI-OBJ-010: validate a final answer against 6 structural rules before it is
 * emitted. Returns ANSWER_COMPLETE only when every rule passes.
 *
 * Rules:
 *  1. Core question must be answered (primary claim closed).
 *  2. Every core claim must have at least one PROVEN validation.
 *  3. No behavioral evidence may substitute for the primary objective when the
 *     claim category is C_PRODUCTION_REACHABILITY.
 *  4. NOT_PROVEN is only acceptable when a reachability edge genuinely lacks a
 *     source span — it must not be used as a blanket investigation failure.
 *  5. No fabricated Findings: every Finding claim needs a real source-span binding.
 *  6. Production reachability must not be proven by import or package membership
 *     alone (structural check on the ReachabilityProof summary when provided).
 */
export function validateFinalAnswer(input: {
  /** Whether the run's primary claim was closed by grounded evidence. */
  primaryClaimClosed: boolean;
  /** All claim validations from the final run ledger. */
  validations: readonly ClaimValidation[];
  /** Claims from the final run ledger. */
  claims: readonly ClaimRecord[];
  /**
   * The category of the primary claim. When C_PRODUCTION_REACHABILITY, evidence
   * that is purely behavioral is rejected by rule 3.
   */
  primaryClaimCategory?: ClaimCategory;
  /**
   * Behavioral evidence snippets that were actually used to close the primary claim.
   * Rule 3 inspects these when primaryClaimCategory is C_PRODUCTION_REACHABILITY.
   */
  primaryClaimEvidence?: Array<{ snippet: string; file: string; strength: EvidenceStrength }>;
  /**
   * When the run included reachability edges, pass the summary so rules 4 and 6
   * can check for import-only proof and blanket NOT_PROVEN misuse.
   */
  reachabilityProofStatus?: "PROVEN" | "PARTIALLY_PROVEN" | "NOT_PROVEN" | "NO_EDGES";
  hasImportOnlyHops?: boolean;
  recoveryAvailable?: boolean;
}): FinalAnswerValidation {
  const violations: string[] = [];

  // Rule 1: primary claim must be closed.
  if (!input.primaryClaimClosed) {
    violations.push(
      "R1: core question is unanswered — the primary claim was not closed by any grounded source excerpt (AI-OBJ-010 R1)",
    );
  }

  // Rule 2a: every supplied validation must be PROVEN.
  const unprovenValidations = input.validations.filter((v) => v.result !== "PROVEN");
  if (unprovenValidations.length > 0) {
    violations.push(
      `R2: ${unprovenValidations.length} validation(s) are not PROVEN: ` +
        unprovenValidations
          .slice(0, 3)
          .map((v) => `${v.claimId}=${v.result}`)
          .join(", ") +
        " (AI-OBJ-010 R2)",
    );
  }

  // Rule 2b: one-to-one correspondence — every supplied claim must have a
  // matching PROVEN validation by claimId. A PROVEN validation for a different
  // claim cannot prove an unvalidated claim.
  const nonFindingClaims = input.claims.filter(
    (c) =>
      !c.taskType.toLowerCase().includes("finding") &&
      !c.claimId.toLowerCase().includes("finding"),
  );
  for (const claim of nonFindingClaims) {
    const validation = input.validations.find((v) => v.claimId === claim.claimId);
    if (!validation || validation.result !== "PROVEN") {
      violations.push(
        `R2-BINDING: claim ${claim.claimId} has no corresponding PROVEN validation ` +
          `(found: ${validation?.result ?? "NONE"}) — every supplied claim must be individually proven (AI-OBJ-010 R2)`,
      );
    }
  }

  // Rule 3: behavioral evidence must not substitute for primary reachability objective.
  if (
    input.primaryClaimCategory === "C_PRODUCTION_REACHABILITY" &&
    input.primaryClaimEvidence?.length
  ) {
    for (const ev of input.primaryClaimEvidence) {
      const gate = evidenceRelevanceGate(
        { strength: ev.strength, file: ev.file },
        "C_PRODUCTION_REACHABILITY",
        ev.snippet,
      );
      if (!gate.relevant) {
        violations.push(`R3: ${gate.reason} (AI-OBJ-010 R3)`);
        break; // one violation is enough to flag the rule
      }
    }
  }

  // Rule 4: NOT_PROVEN must not be a blanket failure label when reachability edges exist.
  // A chain that has import-only hops but no genuinely unproven invocation edges is
  // actually an incomplete investigation, not a "the answer is NOT_PROVEN" verdict.
  if (
    input.reachabilityProofStatus === "NOT_PROVEN" &&
    input.hasImportOnlyHops &&
    input.primaryClaimCategory === "C_PRODUCTION_REACHABILITY"
  ) {
    violations.push(
      "R4: NOT_PROVEN must not be used as a blanket verdict when all edges are import-only; " +
        "these hops prove package membership, not production reachability — report OBJECTIVE_BLOCKED instead (AI-OBJ-010 R4)",
    );
  }

  // Rule 5: no fabricated Findings — every Finding claim needs at least one source-span binding.
  const findingClaims = input.claims.filter((c) =>
    c.taskType.toLowerCase().includes("finding") || c.claimId.toLowerCase().includes("finding"),
  );
  for (const fc of findingClaims) {
    if (!fc.binding || fc.binding.sourceSpans.length === 0) {
      violations.push(
        `R5: Finding claim ${fc.claimId} has no source-span binding — fabricated Findings are rejected (AI-OBJ-010 R5)`,
      );
    }
  }

  // Rule 6: production reachability must not be proven by import / package membership alone.
  if (
    input.primaryClaimCategory === "C_PRODUCTION_REACHABILITY" &&
    input.hasImportOnlyHops &&
    input.reachabilityProofStatus === "PROVEN"
  ) {
    violations.push(
      "R6: production reachability is marked PROVEN but the chain contains IMPORT_ONLY hops; " +
        "imports prove accessibility, not execution — this proof is rejected (AI-OBJ-010 R6)",
    );
  }

  // Positive-proof completeness gate (AI-OBJ-010 R-PROOF):
  // ANSWER_COMPLETE must not be derived from absent proof data. The
  // `primaryClaimClosed` flag is a caller-supplied hint that cannot stand
  // alone — the validator must see at least one of:
  //   (a) a PROVEN claim validation from the run's reachability-specific claims, OR
  //   (b) an explicit PROVEN reachabilityProofStatus without import-only hops
  //       (externally validated trace, e.g. runtimeObserved links).
  //
  // In the chat-agent path, `validations` contains only reachability-specific
  // claim validations (not arbitrary behavioral validations), so condition (a)
  // is structurally tied to the reachability claim model — not to any unrelated
  // proof. Each of those validations passed the evidenceRelevanceGate (R2/R3/R5),
  // so a PROVEN source-backed call-site validation is genuine proof and suffices
  // on its own. For non-reachability tasks the same OR gate applies; either
  // evidence type suffices.
  const hasProvenValidation = input.validations.some((v) => v.result === "PROVEN");
  const hasExplicitReachabilityProof =
    input.reachabilityProofStatus === "PROVEN" && !input.hasImportOnlyHops;
  // R-PROOF fails when NEITHER condition is met.
  if (!hasProvenValidation && !hasExplicitReachabilityProof) {
    violations.push(
      "R-PROOF: no positive proof found — ANSWER_COMPLETE requires either a PROVEN " +
        "claim validation (from source-backed reachability claims) OR an explicit PROVEN " +
        "reachabilityProofStatus without import-only hops; " +
        "primaryClaimClosed alone is insufficient (AI-OBJ-010 R-PROOF)",
    );
  }

  if (violations.length === 0) {
    return { verdict: "ANSWER_COMPLETE", violations: [] };
  }

  // Map violations to the most precise ObjectiveVerdictKind.
  //
  // R1 / R3 / R4 / R6 → the primary objective or claim chain is structurally
  // blocked regardless of partial progress.
  //
  // R-PROOF is intentionally excluded from objectiveBlocked: failing R-PROOF
  // means the positive-proof bar for ANSWER_COMPLETE wasn't met, but it does
  // NOT force OBJECTIVE_BLOCKED when some claims are individually proven
  // (anyProven → ANSWER_PARTIAL is more accurate). ANSWER_COMPLETE is still
  // guarded by the violations.length === 0 check above.
  const objectiveBlocked = violations.some(
    (v) =>
      v.startsWith("R1:") ||
      v.startsWith("R3:") ||
      v.startsWith("R4:") ||
      v.startsWith("R6:"),
  );
  // R2 with a partial claim proof → ANSWER_PARTIAL.
  const anyProven = input.validations.some((v) => v.result === "PROVEN");
  // No evidence at all: zero validations and no reachability proof.
  const noEvidence = input.validations.length === 0 && !hasExplicitReachabilityProof && !input.primaryClaimClosed;

  let verdict: ObjectiveVerdictKind;
  if (noEvidence) {
    verdict = "EVIDENCE_INSUFFICIENT";
  } else if (objectiveBlocked) {
    verdict = input.recoveryAvailable ? "RECOVERY_REQUIRED" : "OBJECTIVE_BLOCKED";
  } else if (anyProven) {
    verdict = "ANSWER_PARTIAL";
  } else {
    verdict = "OBJECTIVE_BLOCKED";
  }

  return { verdict, violations };
}
