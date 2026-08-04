import { z } from "zod";

export const CodeIssueTypeSchema = z.enum(["bug", "security", "performance", "style", "architecture"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

// NOTE: These schemas intentionally omit .strict() so that extra fields
// returned by OpenRouter / GPT-class models (e.g. "line", "impact", "code")
// are silently stripped rather than causing SCHEMA_VALIDATION_FAILED → HTTP 422.
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
  // coerce handles models that return "85" (string) instead of 85 (number)
  overallScore:             z.coerce.number().min(0).max(100),
  strengths:                z.array(z.string().min(1)).default([]),
  issues:                   z.array(CodeIssueSchema).default([]),
  refactoringOpportunities: z.array(z.string().min(1)).default([]),
  securityConcerns:         z.array(z.string().min(1)).default([]),
  verdict:                  z.enum(["approved", "needs_changes", "major_rework"]),
});

export type CodeIssue = z.infer<typeof CodeIssueSchema>;
export type CodeReviewOutput = z.infer<typeof CodeReviewResultSchema>;
