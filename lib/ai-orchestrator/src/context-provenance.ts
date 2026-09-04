import type { AgentContext, ContextHealth } from "./schemas/context.schema.js";
import {
  CONTEXT_SCHEMA_VERSION,
  type ContextProvenance,
} from "./context-contract.js";

function safeCitation(value: string): string | undefined {
  if (!value.startsWith("file:")) return undefined;
  const path = value.replace(/^file:/, "").replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//.test(path) || path.includes("..")) return undefined;
  return path.length <= 256 ? path : undefined;
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
    },
    citations,
  };
}