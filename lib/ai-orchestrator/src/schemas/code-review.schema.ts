import { z } from "zod";
import { ReviewScopeSchema } from "../review-scope.js";

export const CodeIssueTypeSchema = z.enum(["bug", "security", "performance", "style", "architecture"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

// NOTE: These schemas intentionally omit .strict() so that extra fields
// returned by OpenRouter / GPT-class models (e.g. "line", "impact", "code")
// are silently stripped rather than causing SCHEMA_VALIDATION_FAILED → HTTP 422.
//
// Enum fields use .catch() so unrecognised values (e.g. "warning", "info", "minor")
// fall back to the default rather than failing the entire parse.
export const CodeIssueSchema = z.object({
  type:        CodeIssueTypeSchema.catch("bug"),
  severity:    SeveritySchema.catch("medium"),
  file:        z.string().optional(),
  title:       z.string().min(1),
  description: z.string().min(1),
  suggestion:  z.string().min(1),
});

export const CodeReviewResultSchema = z.object({
  summary:                  z.string().min(1),
  // coerce handles models that return "85" (string) instead of 85 (number)
  overallScore:             z.coerce.number().min(0).max(100),
  strengths:                z.array(z.string().min(1)).default([]),
  // .catch([]) handles models that omit the field or return a non-array.
  issues:                   z.array(CodeIssueSchema).catch([]),
  refactoringOpportunities: z.array(z.string().min(1)).default([]),
  securityConcerns:         z.array(z.string().min(1)).default([]),
  verdict:                  z.enum(["approved", "needs_changes", "major_rework"]),
  // Added by the server after model parsing; models must not author scope.
  reviewScope:              ReviewScopeSchema.optional(),
});

export type CodeIssue = z.infer<typeof CodeIssueSchema>;
export type CodeReviewOutput = z.infer<typeof CodeReviewResultSchema>;
export const CodeReviewPublicResultSchema = CodeReviewResultSchema.extend({
  reviewScope: ReviewScopeSchema,
});
export type CodeReviewPublicOutput = z.infer<typeof CodeReviewPublicResultSchema>;
