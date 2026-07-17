import { z } from "zod";

/**
 * Validates the shape of the context object every agent prompt is built from.
 *
 * Every field is a non-empty string: the builder always produces a non-empty
 * value (empty states use explicit fallback strings such as "No tasks yet").
 * z.string().min(1) therefore reflects the real contract and rejects blank
 * fields that indicate a broken builder, rather than silently accepting them.
 *
 * .strict() rejects objects that carry extra keys, so any future builder field
 * that is not declared here fails loudly instead of being silently stripped.
 */
export const AgentContextSchema = z
  .object({
    project: z.string().min(1),
    recentTasks: z.string().min(1),
    latestMetrics: z.string().min(1),
    graphSummary: z.string().min(1),
    recentEvents: z.string().min(1),
  })
  .strict();

export type AgentContext = z.infer<typeof AgentContextSchema>;
