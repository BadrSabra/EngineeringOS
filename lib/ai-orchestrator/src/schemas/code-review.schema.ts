import { z } from "zod";

export const CodeIssueTypeSchema = z.enum(["bug", "security", "performance", "style", "architecture"]);
export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);

export const CodeIssueSchema = z.object({
  type: CodeIssueTypeSchema,
  severity: SeveritySchema,
  file: z.string().optional(),
  title: z.string(),
  description: z.string(),
  suggestion: z.string(),
});

export const CodeReviewResultSchema = z.object({
  summary: z.string(),
  overallScore: z.number().min(0).max(100),
  strengths: z.array(z.string()).default([]),
  issues: z.array(CodeIssueSchema).default([]),
  refactoringOpportunities: z.array(z.string()).default([]),
  securityConcerns: z.array(z.string()).default([]),
  verdict: z.enum(["approved", "needs_changes", "major_rework"]),
});

export type CodeIssue = z.infer<typeof CodeIssueSchema>;
export type CodeReviewOutput = z.infer<typeof CodeReviewResultSchema>;
