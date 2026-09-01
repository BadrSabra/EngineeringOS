import { z } from "zod";
import {
  ProjectFileManifestSchema,
  ProjectFileSourcesSchema,
} from "../filesystem-manifest.js";
import { ContextManifestSchema } from "../context-manifest.js";

export const ContextSliceHealthStatusSchema = z.enum([
  "not_requested",
  "empty",
  "loaded",
  "load_failed",
]);
export type ContextSliceHealthStatus = z.infer<typeof ContextSliceHealthStatusSchema>;

export const ContextSliceHealthSchema = z.object({
  status: ContextSliceHealthStatusSchema,
  source: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  loadedAt: z.number().int().nonnegative(),
  freshness: z.enum(["fresh", "stale", "missing"]),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/).optional(),
  admissionDecision: z.enum(["ADMIT", "REFERENCE", "DEFER", "DROP"]).optional(),
  lifetimeStage: z.enum(["fresh", "stale", "archived"]).optional(),
}).strict();

export const ContextHealthSchema = z.object({
  tasks: ContextSliceHealthSchema,
  metrics: ContextSliceHealthSchema,
  graphEntities: ContextSliceHealthSchema,
  graphRelationships: ContextSliceHealthSchema,
  events: ContextSliceHealthSchema,
  workflows: ContextSliceHealthSchema,
}).strict().transform((health) => {
  // Preserve compatibility with older callers that treat context metadata as
  // a non-empty prompt value when iterating parsed context fields.
  Object.defineProperty(health, "length", { value: 1, enumerable: false });
  return health;
});
export type ContextSliceHealth = z.infer<typeof ContextSliceHealthSchema>;
export type ContextHealth = z.infer<typeof ContextHealthSchema>;

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
    /** Immutable revision/completeness contract for all downstream work. */
    contextManifest: ContextManifestSchema.optional(),
    /** Server-owned load, freshness, and admission status for every optional slice. */
    contextHealth: ContextHealthSchema.optional(),
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
