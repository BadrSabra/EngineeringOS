import { z } from "zod";
import {
  ProjectFileManifestSchema,
  ProjectFileSourcesSchema,
} from "../filesystem-manifest.js";

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
    workflows: z.string().min(1),
    /** Structural flag: true only when a real scan has completed successfully. */
    metricsVerified: z.boolean(),
    /**
     * Optional: formatted text summarising files and findings from previous
     * chat sessions for this project, injected via the session-memory layer.
     * Present only when the project has prior session memories.
     */
    sessionMemories: z.string().optional(),
     /** Optional verified filesystem inventory used only by implementation planning. */
     filesystemManifest: ProjectFileManifestSchema.optional(),
    /** Optional bounded source excerpts read specifically for implementation planning. */
    filesystemSources: ProjectFileSourcesSchema.optional(),
  })
  .strict();

export type AgentContext = z.infer<typeof AgentContextSchema>;
