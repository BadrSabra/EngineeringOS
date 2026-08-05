import { z } from "zod";
import { SeveritySchema } from "./code-review.schema.js";

// NOTE: These schemas intentionally omit .strict() so that extra fields
// returned by OpenRouter / GPT-class models are silently stripped rather than
// causing SCHEMA_VALIDATION_FAILED → HTTP 422.
//
// Enum fields use .catch() so an unrecognised value (e.g. "code_quality" for
// category, "warning" for severity) falls back to the default instead of
// failing the entire parse.  Array items that fail their own schema are
// filtered out via .catch([]) on the array.
export const ScanInsightSchema = z.object({
  category:       z.enum(["architecture", "security", "performance", "reliability", "maintainability"]).catch("maintainability"),
  severity:       SeveritySchema.catch("medium"),
  title:          z.string().min(1).catch("Finding"),
  description:    z.string().min(1).catch("See analysis above"),
  recommendation: z.string().min(1).catch("Review and address as needed"),
});

export const ScanSummarySchema = z.object({
  summary:           z.string().min(1).catch("Scan analysis completed"),
  overallAssessment: z.string().min(1).catch("See findings below"),
  // .catch([]) handles models that omit the field or return a non-array.
  // Individual items now always succeed because every sub-field has .catch().
  insights:          z.array(ScanInsightSchema).catch([]),
  topPriority:       z.string().min(1).catch("Review the findings above"),
  estimatedImpact:   z.string().min(1).catch("Improved overall code quality"),
});

export type ScanInsight = z.infer<typeof ScanInsightSchema>;
export type ScanAnalysisOutput = z.infer<typeof ScanSummarySchema>;
