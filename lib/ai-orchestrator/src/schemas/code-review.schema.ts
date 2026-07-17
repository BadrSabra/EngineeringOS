import { z } from "zod";

export const CodeIssueTypeSchema = z.enum(["bug", "security", "performance", "style", "architecture"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

export const CodeIssueSchema = z.object({
  type:        CodeIssueTypeSchema,
  severity:    SeveritySchema,
  file:        z.string().optional(),
  title:       z.string().min(1),
  description: z.string().min(1),
  suggestion:  z.string().min(1),
}).strict();

export const CodeReviewResultSchema = z.object({
  summary:                  z.string().min(1),
  overallScore:             z.number().min(0).max(100),
  strengths:                z.array(z.string().min(1)).default([]),
  issues:                   z.array(CodeIssueSchema).default([]),
  refactoringOpportunities: z.array(z.string().min(1)).default([]),
  securityConcerns:         z.array(z.string().min(1)).default([]),
  verdict:                  z.enum(["approved", "needs_changes", "major_rework"]),
}).strict();

export type CodeIssue = z.infer<typeof CodeIssueSchema>;
export type CodeReviewOutput = z.infer<typeof CodeReviewResultSchema>;
