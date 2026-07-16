import { z } from "zod";
import { SeveritySchema } from "./code-review.schema.js";

export const ScanInsightSchema = z.object({
  category: z.enum(["architecture", "security", "performance", "reliability", "maintainability"]),
  severity: SeveritySchema,
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
});

export const ScanSummarySchema = z.object({
  summary: z.string(),
  overallAssessment: z.string(),
  insights: z.array(ScanInsightSchema).default([]),
  topPriority: z.string(),
  estimatedImpact: z.string(),
});

export type ScanInsight = z.infer<typeof ScanInsightSchema>;
export type ScanAnalysisOutput = z.infer<typeof ScanSummarySchema>;
