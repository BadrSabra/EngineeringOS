import { z } from "zod";

export const TaskRecommendationSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()).default([]),
  result: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  needsHumanReview: z.boolean().default(true),
});

export type TaskAgentOutput = z.infer<typeof TaskRecommendationSchema>;
