import { z } from "zod";

/**
 * Versioned, server-owned identity for one AI turn.  The model can describe
 * this identity, but it can never create or update it.
 */
// A string keeps the contract compatible with legacy context consumers that
// treat every non-boolean top-level value as string-like metadata.
export const CONTEXT_SCHEMA_VERSION = "1" as const;

export const ContextIntentSchema = z.object({
  kind: z.string().min(1).max(80),
  classification: z.string().min(1).max(80).optional(),
  operationMode: z.string().min(1).max(80).optional(),
  phases: z.array(z.string().min(1).max(80)).max(16),
  requiresEvidence: z.boolean(),
  compoundExecution: z.boolean().optional(),
  compoundWrite: z.boolean().optional(),
}).strict().transform((intent) => {
  // Legacy callers often inspect context values as strings. Keep this
  // compatibility marker non-enumerable while retaining a typed object.
  Object.defineProperty(intent, "length", { value: 1, enumerable: false });
  return intent;
});
export type ContextIntent = z.infer<typeof ContextIntentSchema>;

export const ContextCollectionSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  returnedCount: z.number().int().nonnegative(),
  totalKnown: z.boolean(),
  hasMore: z.boolean(),
  truncated: z.boolean(),
}).strict().transform((collection) => {
  Object.defineProperty(collection, "length", { value: 1, enumerable: false });
  return collection;
});
export type ContextCollection = z.infer<typeof ContextCollectionSchema>;

export const ContextLinkSourceSchema = z.enum([
  "task",
  "workflow",
  "graph",
  "event",
  "metric",
  "scan",
  "file",
  "git",
  "session_memory",
]);
export type ContextLinkSource = z.infer<typeof ContextLinkSourceSchema>;

export const ContextLinkStatusSchema = z.enum([
  "loaded",
  "empty",
  "unavailable",
  "rejected",
  "conflict",
]);
export type ContextLinkStatus = z.infer<typeof ContextLinkStatusSchema>;

export const ContextLinkSchema = z.object({
  anchor: z.string().min(1).max(160),
  source: ContextLinkSourceSchema,
  layer: z.enum(["direct", "derived", "conflict"]),
  direction: z.enum(["outbound", "inbound", "related"]),
  status: ContextLinkStatusSchema,
  freshness: z.enum(["fresh", "stale", "missing"]),
  rowCount: z.number().int().nonnegative(),
  loadedAt: z.number().int().nonnegative(),
  admissionDecision: z.enum(["ADMIT", "REFERENCE", "DEFER", "DROP"]),
  lifetimeStage: z.enum(["fresh", "stale", "archived"]),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/).optional(),
  linkReason: z.string().min(1).max(160),
  sourceRefs: z.array(z.string().min(1).max(256)).max(8),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export type ContextLink = z.infer<typeof ContextLinkSchema>;

export const AuthorizedToolManifestEntrySchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(["file_read", "file_write", "git_read", "analysis", "validation", "execution"]),
  authorization: z.enum(["server_owned"]),
  approvalRequired: z.boolean(),
}).strict();
export type AuthorizedToolManifestEntry = z.infer<typeof AuthorizedToolManifestEntrySchema>;

export const ContextProvenanceSliceSchema = z.object({
  layer: z.string().min(1).max(80),
  source: z.string().min(1).max(80),
  status: z.enum(["not_requested", "empty", "loaded", "load_failed"]),
  freshness: z.enum(["fresh", "stale", "missing"]),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/).optional(),
  admissionDecision: z.enum(["ADMIT", "REFERENCE", "DEFER", "DROP"]).optional(),
  lifetimeStage: z.enum(["fresh", "stale", "archived"]).optional(),
}).strict();
export type ContextProvenanceSlice = z.infer<typeof ContextProvenanceSliceSchema>;

export const ContextProvenanceSchema = z.object({
  schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION),
  intentKind: z.string().min(1).max(80),
  revisionLabel: z.string().min(1).max(200),
  slices: z.array(ContextProvenanceSliceSchema).max(16),
  links: z.object({
    returnedCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    statuses: z.array(ContextLinkStatusSchema).max(48),
  }).strict(),
  citations: z.array(z.string().min(1).max(256)).max(48),
}).strict().transform((provenance) => {
  Object.defineProperty(provenance, "length", { value: 1, enumerable: false });
  return provenance;
});
export type ContextProvenance = z.infer<typeof ContextProvenanceSchema>;

export function contextCollection(
  returnedCount: number,
  pageSize: number,
  hasMore = false,
): ContextCollection {
  const safeCount = Math.max(0, Math.min(returnedCount, pageSize));
  return {
    page: 1,
    pageSize,
    returnedCount: safeCount,
    totalKnown: false,
    hasMore,
    truncated: hasMore,
  };
}