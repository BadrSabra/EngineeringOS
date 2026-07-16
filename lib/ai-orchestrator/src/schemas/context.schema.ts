import { z } from "zod";

/** Validates the shape of the context object every agent prompt is built from. */
export const AgentContextSchema = z.object({
  project: z.string(),
  recentTasks: z.string(),
  latestMetrics: z.string(),
  graphSummary: z.string(),
  recentEvents: z.string(),
});

export type AgentContext = z.infer<typeof AgentContextSchema>;
