import { z } from "zod";

export const TaskRecommendationSchema = z.object({
  summary:          z.string().min(1),
  steps:            z.array(z.string().min(1)).min(1),
  result:           z.string().min(1),
  // .catch() so "moderate", "uncertain", etc. from free models don't fail the parse
  confidence:       z.enum(["high", "medium", "low"]).catch("medium"),
  needsHumanReview: z.boolean().default(true),
}).strict();

export type TaskAgentOutput = z.infer<typeof TaskRecommendationSchema>;
