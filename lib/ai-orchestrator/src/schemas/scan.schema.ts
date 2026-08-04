import { z } from "zod";
import { SeveritySchema } from "./code-review.schema.js";

// NOTE: These schemas intentionally omit .strict() so that extra fields
// returned by OpenRouter / GPT-class models are silently stripped rather than
// causing SCHEMA_VALIDATION_FAILED → HTTP 422.
export const ScanInsightSchema = z.object({
  category:       z.enum(["architecture", "security", "performance", "reliability", "maintainability"]),
  severity:       SeveritySchema,
  title:          z.string().min(1),
  description:    z.string().min(1),
  recommendation: z.string().min(1),
});

export const ScanSummarySchema = z.object({
  summary:           z.string().min(1),
  overallAssessment: z.string().min(1),
  insights:          z.array(ScanInsightSchema).default([]),
  topPriority:       z.string().min(1),
  estimatedImpact:   z.string().min(1),
});

export type ScanInsight = z.infer<typeof ScanInsightSchema>;
export type ScanAnalysisOutput = z.infer<typeof ScanSummarySchema>;
