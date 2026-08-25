import { z } from "zod";
import { ObjectiveScopePolicySchema } from "../objective-scope.js";
import path from "node:path";
import {
  EvidenceReferenceSchema,
  FindingAnalysisSchema,
  SemanticBehaviorAnswerSchema,
} from "../task-contracts.js";
import {
  CrossFileSemanticTraceSchema,
  ProductionReachabilityTraceSchema,
} from "../semantic-trace.js";
import { ImplementationPlanSchema } from "./implementation-plan.schema.js";

export const ValidationProfileSchema = z.enum([
  "ai-orchestrator-tests",
  "knowledge-engine-tests",
  "api-ai-tests",
  "workspace-typecheck",
]);

export type ValidationProfile = z.infer<typeof ValidationProfileSchema>;

/**
 * Server-verified metadata for a Repair Plan phase. This is deliberately
 * separate from the Markdown report: execution handoff must not recover write
 * targets from Evidence Map or Finding prose.
 */
/**
 * AI-OBJ-001: a single required claim a declared objective demands be closed.
 * Only outward payloads are carried; proof is evaluated against evidence/edges.
 */
export const ObjectiveRequiredClaimSchema = z.object({
  claimId: z.string().min(1),
  /** Human-readable assertion the objective must close. */
  text: z.string().min(1),
}).strict();
export type ObjectiveRequiredClaim = z.infer<typeof ObjectiveRequiredClaimSchema>;

/**
 * AI-OBJ-001: a required production-reachability edge in a declared objective.
 * Import alone can never satisfy this — only a directly proved edge can.
 */
export const ObjectiveEvidenceEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relationship: z.string().min(1),
}).strict();
export type ObjectiveEvidenceEdge = z.infer<typeof ObjectiveEvidenceEdgeSchema>;

/**
 * AI-OBJ-001: the task contract's declared objective. Carried on the Repair Plan
 * metadata (persisted) and on ChatOutput so execution handoff restores the SAME
 * objective the verdict was issued under, and so the Objective Completion Gate
 * refuses finalization while any required claim or edge is unproven.
 */
export const ObjectiveContractSchema = z
  .object({
    /** e.g. "PRODUCTION_REACHABILITY". */
    objectiveType: z.string().min(1).max(80),
    requiredClaims: z.array(ObjectiveRequiredClaimSchema).min(0).max(12),
    requiredEvidenceEdges: z.array(ObjectiveEvidenceEdgeSchema).max(12).default([]),
    /** AI-OBJ-008: bounded primary/caller/route/consumer evidence scope. */
    scopePolicy: ObjectiveScopePolicySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // AI-OBJ-014: an edge-only reachability objective (requiredClaims: [] with
    // non-empty requiredEvidenceEdges) is legitimate — proving a caller->target
    // reachability edge does not need a natural-language claim. But an objective
    // requiring nothing at all is meaningless, so at least one of the two
    // requirement carriers must be non-empty.
    if (
      value.requiredClaims.length === 0 &&
      (value.requiredEvidenceEdges ?? []).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredClaims"],
        message:
          "objective must require at least one claim or one evidence edge (or both)",
      });
    }
  });
export type ObjectiveContract = z.infer<typeof ObjectiveContractSchema>;

export const RepairPlanMetadataSchema = z.object({
  findingId: z.string().regex(/^F-\d+$/, "findingId must use the F-XX format"),
  files: z.array(z.string().min(1).max(500)).min(1).max(8),
  steps: z.array(z.string().min(1).max(600)).min(1).max(8),
  validationProfile: ValidationProfileSchema,
  /**
   * Task #46: the verdict's proof scope that produced this phase, persisted so
   * the execution-handoff context builder restores the SAME scope and the
   * Repair Scope Gate re-derives judgement from it instead of a fresh default.
   */
  verdictScope: z
    .enum(["PRODUCTION", "FIXTURE_LOCAL", "TEST_LOCAL", "SPEC_LOCAL", "MIXED", "NOT_PROVEN"])
    .optional(),
  scopedFindingStatus: z
    .enum(["PRODUCTION_PROVEN", "FIXTURE_PROVEN", "TEST_PROVEN", "MIXED_EVIDENCE", "NOT_PROVEN"])
    .optional(),
  /**
   * AI-OBJ-001: the objective this phase was produced under, persisted so a
   * follow-up execution or audit reconciles against the same declared objective.
   */
  objective: ObjectiveContractSchema.optional(),
}).strict();

export type RepairPlanMetadata = z.infer<typeof RepairPlanMetadataSchema>;

export const PatchEvidenceLinkSchema = z.object({
  kind: z.enum(["finding", "source", "validation"]),
  id: z.string().min(1),
  label: z.string().min(1).max(240),
  file: z.string().min(1).optional(),
  line: z.number().int().min(1).optional(),
}).strict();
export type PatchEvidenceLink = z.infer<typeof PatchEvidenceLinkSchema>;

export const FilePatchHunkSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  expectedText: z.string(),
  replacementText: z.string(),
  reason: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]).optional(),
  evidence: z.array(PatchEvidenceLinkSchema).max(4).optional(),
}).strict();

export type FilePatchHunk = z.infer<typeof FilePatchHunkSchema>;

/**
 * Runtime schema for a proposed file change.
 *
 * PendingChange objects are produced server-side by executeFileTool and are
 * never written by the model directly. The schema exists for two reasons:
 *   1. Defence against bugs in executeFileTool that might produce a malformed
 *      object before it is stored or returned to the client.
 *   2. Validation of the inbound payload when the apply-changes endpoint
 *      receives a PendingChange from the dashboard — `absolutePath` is used
 *      to determine where to write on disk, so it must be verifiably absolute
 *      before the secondary safePath check runs.
 *
 * Field constraints mirror the guarantees provided by file-tools.ts:
 *   path           — normalized relative path (never empty after path.relative)
 *   absolutePath   — absolute OS path; the refine guard enforces this
 *                    structurally so a relative string cannot slip through
 *   newContent     — no min(1): an empty string is a valid "empty the file"
 *   originalContent — null when the file does not yet exist
 *   reason         — non-empty one-sentence explanation from the model
 *
 * .strict() rejects any unrecognised field — a PendingChange with extra keys
 * is a sign of a malformed or tampered payload.
 */
export const PendingChangeSchema = z
  .object({
    path: z.string().min(1),
    absolutePath: z
      .string()
      .min(1)
      .refine(path.isAbsolute, { message: "absolutePath must be an absolute filesystem path" }),
    newContent: z.string(),
    originalContent: z.string().nullable(),
    /** SHA-256 of the source content observed when the patch was generated. */
    baseHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** Line-scoped evidence and replacement metadata for Patch Lab. */
    hunks: z.array(FilePatchHunkSchema).max(100).optional(),
    reason: z.string().min(1),
    validationProfile: ValidationProfileSchema.optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
    evidence: z.array(PatchEvidenceLinkSchema).max(4).optional(),
  })
  .strict();

export type PendingChange = z.infer<typeof PendingChangeSchema>;

export const ChatResponseSchema = z.object({
  response: z.string().min(1),
  sources:  z.array(z.string()).default([]),
}).strict();

/**
 * ChatOutputSchema is the full return value of the chat agent. The LLM-authored
 * fields (response, sources) come from ChatResponseSchema. pendingChanges
 * is appended server-side after the tool loop — it is never written by the
 * model — but it is typed here via PendingChangeSchema so the shape is a
 * single source of truth for both TypeScript and runtime validation.
 */
/**
 * STORY-04: resolved model info appended by the chat agent after the tool
 * loop. Optional — older callers that don't populate it still pass validation.
 */
export const ResolvedModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  free: z.boolean(),
});

export type ResolvedModelInfo = z.infer<typeof ResolvedModelSchema>;

// ── Per-task typed result unions (AI-008) ─────────────────────────────────────
// Each forensicTaskType now produces a discriminated result instead of
// contributing to a single shared envelope. Callers narrow on `kind`.

export const CodeExtractionResultSchema = z.object({
  kind: z.literal("CODE_EXTRACTION_RESULT"),
  extractedCode: z.string(),
  source: z.string().optional(),
}).strict();
export type CodeExtractionResult = z.infer<typeof CodeExtractionResultSchema>;

export const BehaviorAnswerResultSchema = z.object({
  kind: z.literal("BEHAVIOR_ANSWER_RESULT"),
  answer: SemanticBehaviorAnswerSchema,
}).strict();
export type BehaviorAnswerResult = z.infer<typeof BehaviorAnswerResultSchema>;

export const FindingResultSchema = z.object({
  kind: z.literal("FINDING_RESULT"),
  finding: FindingAnalysisSchema,
}).strict();
export type FindingResult = z.infer<typeof FindingResultSchema>;

export const ForensicReportResultSchema = z.object({
  kind: z.literal("FORENSIC_REPORT_RESULT"),
  report: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema).max(20),
}).strict();
export type ForensicReportResult = z.infer<typeof ForensicReportResultSchema>;

export const WorkspaceReviewResultSchema = z.object({
  kind: z.literal("WORKSPACE_REVIEW_RESULT"),
  report: z.string().min(1),
  evidence: z.array(EvidenceReferenceSchema).max(20),
}).strict();
export type WorkspaceReviewResult = z.infer<typeof WorkspaceReviewResultSchema>;

export const RepairResultSchema = z.object({
  kind: z.literal("REPAIR_RESULT"),
  /** Structured, server-verified phase list — mirrors repairPlan on ChatOutput. */
  phases: z.array(RepairPlanMetadataSchema).max(12),
  readiness: z.enum(["READY", "BLOCKED", "NOT_PROVEN"]).default("NOT_PROVEN"),
}).strict();
export type RepairResult = z.infer<typeof RepairResultSchema>;

export const ChatTaskResultSchema = z.discriminatedUnion("kind", [
  CodeExtractionResultSchema,
  BehaviorAnswerResultSchema,
  FindingResultSchema,
  ForensicReportResultSchema,
  WorkspaceReviewResultSchema,
  RepairResultSchema,
  ImplementationPlanSchema,
]);
export type ChatTaskResult = z.infer<typeof ChatTaskResultSchema>;

export const ChatOutputSchema = ChatResponseSchema.extend({
  pendingChanges: z.array(PendingChangeSchema).default([]),
  resolvedModel: ResolvedModelSchema.optional(),
  /** Server-verified Repair Plan phases, absent for ordinary chat turns. */
  repairPlan: z.array(RepairPlanMetadataSchema).max(12).optional(),
  /** Server-verified evidence links for explicit behavior questions. */
  behaviorEvidence: z.array(EvidenceReferenceSchema).max(8).optional(),
  /** Independent semantic answer result; absent for non-behavior tasks. */
  behaviorAnswer: SemanticBehaviorAnswerSchema.optional(),
  /** Runtime-observed production reachability, when the caller supplied links. */
  productionReachability: ProductionReachabilityTraceSchema.optional(),
  /** Bounded graph-grounded cross-file traces for explicit file scope. */
  crossFileTraces: z.array(CrossFileSemanticTraceSchema).max(12).optional(),
  /**
   * AI-008: per-task typed result. Discriminated on `kind` by forensicTaskType.
   * Absent for generic chat turns that don't map to a typed contract.
   */
  taskResult: ChatTaskResultSchema.optional(),
  /**
   * AI-OBJ-001: the declared objective this turn was executed under, surfaced
   * so the dashboard can render the Objective Completion Gate outcome. Absent
   * for turns with no declared objective.
   */
  objective: ObjectiveContractSchema.optional(),
});

export type ChatOutput = z.infer<typeof ChatOutputSchema>;
