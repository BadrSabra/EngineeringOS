import type { AgentContext, ContextHealth } from "./schemas/context.schema.js";
import {
  CONTEXT_SCHEMA_VERSION,
  ContextProvenanceSchema,
  type ContextProvenance,
} from "./context-contract.js";

function safeCitation(value: string): string | undefined {
  if (!value.startsWith("file:")) return undefined;
  const path = value.replace(/^file:/, "").replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//.test(path) || path.includes("..")) return undefined;
  return path.length <= 256 ? path : undefined;
}

/**
 * Read persisted provenance at the boundary.  The trace wrapper's `kind`
 * marker is storage metadata, not part of the public contract.  Older traces
 * also predate the per-link detail projection, so an absent details array is
 * migrated to an empty one rather than making the whole historical message
 * unreadable.
 */
export function parseContextProvenance(value: unknown): ContextProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { kind: _kind, ...candidate } = value as Record<string, unknown>;
  const rawLinks = candidate.links;
  if (rawLinks && typeof rawLinks === "object" && !Array.isArray(rawLinks)) {
    const links = rawLinks as Record<string, unknown>;
    candidate.links = {
      ...links,
      details: Array.isArray(links.details) ? links.details : [],
    };
  }
  const parsed = ContextProvenanceSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** Allowlisted projection shared by API, SSE, persistence, and dashboard. */
export function projectContextProvenance(context: AgentContext): ContextProvenance {
  const health = context.contextHealth as ContextHealth | undefined;
  const slices = health
    ? Object.entries(health).map(([layer, value]) => ({
        layer,
        source: value.source.slice(0, 80),
        status: value.status,
        freshness: value.freshness,
        rowCount: value.rowCount,
        truncated: value.collection?.truncated ?? false,
        ...(value.failureCode ? { failureCode: value.failureCode } : {}),
        ...(value.admissionDecision ? { admissionDecision: value.admissionDecision } : {}),
        ...(value.lifetimeStage ? { lifetimeStage: value.lifetimeStage } : {}),
      }))
    : [];
  const links = context.contextLinks ?? [];
  const citations = [...new Set(
    links.flatMap((entry) => entry.sourceRefs)
      .map(safeCitation)
      .filter((entry): entry is string => Boolean(entry)),
  )].slice(0, 48);
  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    intentKind: context.intent?.kind ?? "unavailable",
    revisionLabel: (context.workspaceRevision ?? "unavailable").slice(0, 200),
    slices,
    links: {
      returnedCount: links.length,
      truncated: context.contextLinkCollection?.truncated ?? false,
      statuses: [...new Set(links.map((entry) => entry.status))],
      details: links.slice(0, 48).map((entry) => ({
        source: entry.source,
        layer: entry.layer,
        direction: entry.direction,
        status: entry.status,
        freshness: entry.freshness,
        rowCount: entry.rowCount,
        linkReason: entry.linkReason,
        sourceRefCount: entry.sourceRefs.length,
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
      })),
    },
    citations,
  };
}