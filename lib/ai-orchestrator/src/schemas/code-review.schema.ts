import { z } from "zod";
import { ReviewScopeSchema } from "../review-scope.js";

export const CodeIssueTypeSchema = z.enum(["bug", "security", "performance", "style", "architecture"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

// Extra provider fields are tolerated for compatibility, but declared fields
// must validate exactly. In particular, unknown issue enums must not be
// normalized into a passing review.
export const CodeIssueSchema = z.object({
  type:        CodeIssueTypeSchema,
  severity:    SeveritySchema,
  file:        z.string().optional(),
  title:       z.string().min(1),
  description: z.string().min(1),
  suggestion:  z.string().min(1),
});

export const CodeReviewResultSchema = z.object({
  summary:                  z.string().min(1),
  // coerce remains compatible with providers that encode numeric JSON fields
  // as strings, while still rejecting values outside the contract.
  overallScore:             z.coerce.number().min(0).max(100),
  strengths:                z.array(z.string().min(1)),
  issues:                   z.array(CodeIssueSchema),
  refactoringOpportunities: z.array(z.string().min(1)),
  securityConcerns:         z.array(z.string().min(1)),
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
