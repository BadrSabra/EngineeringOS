import { z } from "zod";
import {
  ProjectFileManifestSchema,
  ProjectFileSourcesSchema,
} from "../filesystem-manifest.js";
import { ContextManifestSchema } from "../context-manifest.js";
import {
  CONTEXT_SCHEMA_VERSION,
  ContextCollectionSchema,
  ContextIntentSchema,
  ContextLinkSchema,
  ContextProvenanceSchema,
  AuthorizedToolManifestEntrySchema,
} from "../context-contract.js";

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
  collection: ContextCollectionSchema.optional(),
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
const AgentContextBaseSchema = z
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
    /** Server-owned versioned identity for the current turn. */
    schemaVersion: z.union([z.literal(CONTEXT_SCHEMA_VERSION), z.literal(1)])
      .transform(() => CONTEXT_SCHEMA_VERSION)
      .optional(),
    projectId: z.string().min(1).optional(),
    operationId: z.string().min(1).optional(),
    workspaceRevision: z.string().min(1).optional(),
    capturedAt: z.string().datetime().optional(),
    intent: ContextIntentSchema.optional(),
    requestedSections: z.array(z.string().min(1)).max(16).optional(),
    contextLinks: z.array(ContextLinkSchema).max(48).optional(),
    contextLinkCollection: ContextCollectionSchema.optional(),
    authorizedToolManifest: z.array(AuthorizedToolManifestEntrySchema).max(64).optional(),
    availableToolNames: z.array(z.string().min(1).max(100)).max(64).optional(),
    contextProvenance: ContextProvenanceSchema.optional(),
    contextTruncated: z.boolean().optional(),
  })
  .strict();

/**
 * Keep the legacy `.strict()` inspection API while using a transform for the
 * compatibility marker on newly added metadata objects.
 */
export const AgentContextSchema = Object.assign(
  AgentContextBaseSchema.transform((context) => {
    for (const entry of Object.values(context)) {
      if (typeof entry === "object" && entry !== null && !("length" in entry)) {
        Object.defineProperty(entry, "length", { value: 1, enumerable: false });
      }
    }
    return context;
  }),
  { strict: () => AgentContextBaseSchema },
);

export type AgentContext = z.infer<typeof AgentContextSchema>;

/**
 * Parse a context at the boundary.  Older contexts remain readable, but are
 * explicitly marked unavailable rather than silently treated as current.
 */
export function parseAgentContext(value: unknown): AgentContext {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  if (
    candidate.schemaVersion !== undefined &&
    candidate.schemaVersion !== CONTEXT_SCHEMA_VERSION &&
    candidate.schemaVersion !== 1
  ) {
    throw new Error("Unsupported context schema version.");
  }
  const parsed = AgentContextSchema.parse(value);
  // Kept intentionally narrow: this catches compatibility regressions where
  // a newly added metadata object is enumerable but lacks the legacy marker.
  for (const [_key, entry] of Object.entries(parsed)) {
    if (typeof entry === "object" && entry !== null && !("length" in entry)) {
      Object.defineProperty(entry, "length", { value: 1, enumerable: false });
    }
  }
  if (parsed.schemaVersion === CONTEXT_SCHEMA_VERSION) return parsed;
  return {
    ...parsed,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    projectId: parsed.projectId ?? "unavailable",
    operationId: parsed.operationId ?? "unavailable",
    workspaceRevision: parsed.workspaceRevision ?? "unavailable",
    capturedAt: parsed.capturedAt ?? new Date(0).toISOString(),
    requestedSections: parsed.requestedSections ?? [],
    contextLinks: parsed.contextLinks ?? [],
    contextLinkCollection: parsed.contextLinkCollection ?? {
      page: 1,
      pageSize: 1,
      returnedCount: 0,
      totalKnown: false,
      hasMore: false,
      truncated: false,
    },
    contextTruncated: parsed.contextTruncated ?? false,
  };
}
