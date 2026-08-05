import { z } from "zod";

export const TaskRecommendationSchema = z.object({
  summary:          z.string().min(1),
  steps:            z.array(z.string().min(1)).min(1),
  result:           z.string().min(1),
  confidence:       z.enum(["high", "medium", "low"]),
  needsHumanReview: z.boolean().default(true),
}).strict();

export type TaskAgentOutput = z.infer<typeof TaskRecommendationSchema>;
